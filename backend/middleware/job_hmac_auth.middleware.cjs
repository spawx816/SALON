/**
 * Cryptographic Anti-Replay HMAC Job Authentication Middleware
 * (backend/middleware/job_hmac_auth.middleware.cjs)
 *
 * Implements strict time-window, single-use nonce hashing, and HMAC-SHA256 signature
 * verification for cron / background job triggers with fail-closed DB persistence.
 *
 * Requirements (Phase 3B.0.2):
 * 1. Global table job_request_nonces (nonce_hash, body_hash, signed_timestamp, consumed_at, expires_at).
 * 2. Raw nonce NEVER stored; stores SHA-256 hash (nonce_hash).
 * 3. Fail-closed: returns 503 JOB_AUTH_STATE_UNAVAILABLE if DB is down.
 * 4. Zero automatic/implicit fallback to in-memory on error.
 * 5. Atomic idempotency claim: claimJobExecution() using INSERT ... ON CONFLICT ... RETURNING.
 * 6. Strict tenant_id UUID validation: rejects SYSTEM_CRON or malformed strings.
 * 7. Supports cleanupExpiredNonces().
 * 8. Secret: JOB_SIGNATURE_SECRET (preferred) or CRON_SECRET (deprecated).
 */

'use strict';

const crypto = require('crypto');

let defaultPool = null;
function getDefaultPool() {
  if (!defaultPool) {
    try {
      defaultPool = require('../db').pool;
    } catch (_) {}
  }
  return defaultPool;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function executeDbQuery(pool, sql, params = []) {
  if (!pool || typeof pool.query !== 'function') {
    const err = new Error('Database pool not available');
    err.code = 'JOB_AUTH_STATE_UNAVAILABLE';
    throw err;
  }

  const queryExecutor = pool.query;

  // If pool is project adapter or in-memory mock, it accepts '?' and returns [rows, fields]
  if (pool.isPostgres || (typeof pool.getConnection === 'function' && !pool.connect) || pool.tables) {
    return queryExecutor.call(pool, sql, params);
  }

  // Raw pg Pool or Client: convert '?' to $1, $2, ...
  let paramIdx = 1;
  const pgSql = sql.replace(/\?/g, () => `$${paramIdx++}`);
  const res = await queryExecutor.call(pool, pgSql, params);
  if (res && Array.isArray(res.rows)) {
    return [res.rows, res];
  }
  if (Array.isArray(res)) {
    return res;
  }
  return [[res], res];
}

function getCanonicalBodyHash(body, rawBody) {
  if (rawBody !== undefined && rawBody !== null && typeof rawBody === 'string') {
    return crypto.createHash('sha256').update(rawBody).digest('hex');
  }
  if (body === undefined || body === null) {
    return crypto.createHash('sha256').update('').digest('hex');
  }
  const str = typeof body === 'string' ? body : JSON.stringify(body);
  return crypto.createHash('sha256').update(str).digest('hex');
}

function buildCanonicalJobString({ method, path, timestamp, nonce, bodyHash }) {
  const normMethod = String(method || '').toUpperCase();
  const normPath = String(path || '');
  const normTimestamp = String(timestamp || '');
  const normNonce = String(nonce || '');
  const normBodyHash = String(bodyHash || '');
  return `${normMethod}\n${normPath}\n${normTimestamp}\n${normNonce}\n${normBodyHash}`;
}

function computeJobSignature({ method, path, timestamp, nonce, body, rawBody, secret }) {
  if (!secret) throw new Error('Secret is required to compute job signature');
  const bodyHash = getCanonicalBodyHash(body, rawBody);
  const canonicalString = buildCanonicalJobString({ method, path, timestamp, nonce, bodyHash });
  return crypto.createHmac('sha256', secret).update(canonicalString).digest('hex');
}

function generateJobAuthHeaders({ method, path, body, rawBody, secret, timestamp, nonce } = {}) {
  const ts = String(timestamp || Date.now());
  const n = String(nonce || crypto.randomBytes(16).toString('hex'));
  const s = secret || process.env.JOB_SIGNATURE_SECRET || process.env.CRON_SECRET;
  const sig = computeJobSignature({ method, path, timestamp: ts, nonce: n, body, rawBody, secret: s });
  return {
    'x-job-timestamp': ts,
    'x-job-nonce': n,
    'x-job-signature': sig
  };
}

/**
 * Persists and validates a single-use nonce via its SHA-256 hash.
 * Fail-closed: throws JOB_AUTH_STATE_UNAVAILABLE on any DB failure.
 */
async function recordAndCheckNonce(pool, nonce, bodyHash, signedTimestamp, options = {}) {
  const nonceHash = crypto.createHash('sha256').update(String(nonce).trim()).digest('hex');
  const explicitStore = options.explicitNonceStore;

  // Explicit test mock store injected purposefully
  if (explicitStore && typeof explicitStore.has === 'function') {
    if (explicitStore.has(nonceHash)) return false;
    explicitStore.set(nonceHash, { consumedAt: Date.now(), bodyHash });
    return true;
  }

  const hasDb = pool && typeof pool.query === 'function';
  if (!hasDb) {
    const err = new Error('Database pool not available for job nonce authentication');
    err.code = 'JOB_AUTH_STATE_UNAVAILABLE';
    throw err;
  }

  try {
    const tsInt = parseInt(signedTimestamp, 10) || Date.now();
    await executeDbQuery(
      pool,
      `INSERT INTO job_request_nonces (nonce_hash, body_hash, signed_timestamp, consumed_at, expires_at)
       VALUES (?, ?, ?, NOW(), NOW() + INTERVAL '10 minutes')`,
      [nonceHash, bodyHash, tsInt]
    );
    return true;
  } catch (err) {
    // Unique constraint violation (replay detected)
    if (err.code === '23505' || String(err.message).toLowerCase().includes('unique') || String(err.message).toLowerCase().includes('duplicate')) {
      return false;
    }
    // Fail-closed: database unavailable or query failure
    const dbErr = new Error('Database error during nonce validation: ' + err.message);
    dbErr.code = 'JOB_AUTH_STATE_UNAVAILABLE';
    dbErr.originalError = err;
    throw dbErr;
  }
}

/**
 * Purges expired nonces from the global table.
 */
async function cleanupExpiredNonces(pool) {
  const [rows, meta] = await executeDbQuery(pool, 'DELETE FROM job_request_nonces WHERE expires_at < NOW()');
  if (meta && typeof meta.rowCount === 'number') return meta.rowCount;
  if (meta && typeof meta.affectedRows === 'number') return meta.affectedRows;
  if (rows && typeof rows.affectedRows === 'number') return rows.affectedRows;
  if (Array.isArray(rows)) return rows.length;
  return 0;
}

/**
 * Atomic execution claim for tenant background jobs.
 * Uses atomic INSERT ... ON CONFLICT DO NOTHING RETURNING.
 * Fails closed (throws JOB_AUTH_STATE_UNAVAILABLE) on DB errors.
 */
async function claimJobExecution(pool, { tenantId, jobType, date, options = {} }) {
  if (!tenantId || !UUID_REGEX.test(String(tenantId))) {
    const err = new Error(`Invalid tenant_id for job execution: "${tenantId}". Must be a valid UUID.`);
    err.code = 'INVALID_TENANT_UUID';
    throw err;
  }

  const explicitStore = options.explicitJobStore;
  const key = `job:${jobType}:${date}`;

  if (explicitStore && typeof explicitStore.has === 'function') {
    const composite = `${tenantId}:${key}`;
    if (explicitStore.has(composite)) {
      return { claimed: false, reason: 'ALREADY_CLAIMED', status_code: explicitStore.get(composite).status_code };
    }
    explicitStore.set(composite, { status_code: 102, claimedAt: new Date() });
    return { claimed: true, claimId: 'mem_' + Date.now() };
  }

  const payloadHash = crypto.createHash('sha256').update(key).digest('hex');

  try {
    const [insertResult] = await executeDbQuery(
      pool,
      `INSERT INTO idempotency_keys (tenant_id, idempotency_key, payload_hash, status_code, response_body, expires_at)
       VALUES (?, ?, ?, 102, '{"status":"processing"}'::jsonb, NOW() + INTERVAL '2 hours')
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
       RETURNING id, status_code;`,
      [tenantId, key, payloadHash]
    );

    if (insertResult && insertResult.length > 0) {
      return { claimed: true, claimId: insertResult[0].id };
    }

    // Row already exists - fetch current state
    const [existingRows] = await executeDbQuery(
      pool,
      'SELECT id, status_code, response_body FROM idempotency_keys WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1',
      [tenantId, key]
    );

    const existing = existingRows && existingRows[0] ? existingRows[0] : null;
    const statusCode = existing ? existing.status_code : 102;
    let reason = 'ALREADY_CLAIMED';
    if (statusCode === 200) reason = 'ALREADY_COMPLETED';
    else if (statusCode === 102) reason = 'EXECUTION_IN_PROGRESS';
    else if (statusCode >= 400) reason = 'PREVIOUS_EXECUTION_FAILED';

    return {
      claimed: false,
      claimId: existing?.id,
      reason,
      status_code: statusCode,
      details: existing?.response_body
    };
  } catch (err) {
    if (err.code === '23503') {
      const fkErr = new Error(`Tenant "${tenantId}" does not exist in tenants catalog (FK 23503)`);
      fkErr.code = 'TENANT_NOT_FOUND';
      throw fkErr;
    }
    const dbErr = new Error('Database error during job claim: ' + err.message);
    dbErr.code = 'JOB_AUTH_STATE_UNAVAILABLE';
    dbErr.originalError = err;
    throw dbErr;
  }
}

/**
 * Completes a successfully executed job claim with status 200.
 */
async function completeJobExecution(pool, { tenantId, jobType, date, metadata = {}, options = {} }) {
  if (!tenantId || !UUID_REGEX.test(String(tenantId))) {
    const err = new Error(`Invalid tenant_id for job execution: "${tenantId}". Must be a valid UUID.`);
    err.code = 'INVALID_TENANT_UUID';
    throw err;
  }

  const explicitStore = options.explicitJobStore;
  const key = `job:${jobType}:${date}`;

  if (explicitStore && typeof explicitStore.set === 'function') {
    const composite = `${tenantId}:${key}`;
    explicitStore.set(composite, { status_code: 200, completedAt: new Date(), metadata });
    return;
  }

  try {
    await executeDbQuery(
      pool,
      `UPDATE idempotency_keys
       SET status_code = 200, response_body = ?::jsonb, expires_at = NOW() + INTERVAL '30 days'
       WHERE tenant_id = ? AND idempotency_key = ?`,
      [JSON.stringify(metadata), tenantId, key]
    );
  } catch (err) {
    const dbErr = new Error('Database error completing job execution: ' + err.message);
    dbErr.code = 'JOB_AUTH_STATE_UNAVAILABLE';
    throw dbErr;
  }
}

/**
 * Records a failed job execution with status 500.
 */
async function failJobExecution(pool, { tenantId, jobType, date, error = {}, options = {} }) {
  if (!tenantId || !UUID_REGEX.test(String(tenantId))) {
    const err = new Error(`Invalid tenant_id for job execution: "${tenantId}". Must be a valid UUID.`);
    err.code = 'INVALID_TENANT_UUID';
    throw err;
  }

  const explicitStore = options.explicitJobStore;
  const key = `job:${jobType}:${date}`;

  if (explicitStore && typeof explicitStore.set === 'function') {
    const composite = `${tenantId}:${key}`;
    explicitStore.set(composite, { status_code: 500, failedAt: new Date(), error });
    return;
  }

  try {
    await executeDbQuery(
      pool,
      `UPDATE idempotency_keys
       SET status_code = 500, response_body = ?::jsonb
       WHERE tenant_id = ? AND idempotency_key = ?`,
      [JSON.stringify(error), tenantId, key]
    );
  } catch (err) {
    const dbErr = new Error('Database error recording job failure: ' + err.message);
    dbErr.code = 'JOB_AUTH_STATE_UNAVAILABLE';
    throw dbErr;
  }
}

// Backward compatibility check helper
async function checkJobIdempotency(pool, { tenantId, jobType, date, options = {} }) {
  const claim = await claimJobExecution(pool, { tenantId, jobType, date, options });
  return !claim.claimed;
}

// Backward compatibility record helper
async function recordJobExecution(pool, { tenantId, jobType, date, metadata = {}, options = {} }) {
  return completeJobExecution(pool, { tenantId, jobType, date, metadata, options });
}

function createJobHmacAuthMiddleware(customPool = null, middlewareOptions = {}) {
  return async function verifyJobHmacSignature(req, res, next) {
    const pool = customPool || getDefaultPool();
    const secret = process.env.JOB_SIGNATURE_SECRET || process.env.CRON_SECRET;

    if (!secret || String(secret).trim().length < 16) {
      return res.status(403).json({
        error: 'CRON_SECRET_UNCONFIGURED',
        message: 'Servicio de jobs deshabilitado: JOB_SIGNATURE_SECRET no configurado o longitud menor a 16 caracteres.',
        code: 'CRON_SECRET_UNCONFIGURED'
      });
    }

    // Explicitly reject if secret is sent in headers (security policy)
    if (req.headers['x-cron-secret'] || req.headers['x-job-secret']) {
      return res.status(401).json({
        error: 'STATIC_SECRET_PROHIBITED',
        message: 'El secreto no puede transmitirse en la cabecera. Use autenticación HMAC con x-job-signature.',
        code: 'STATIC_SECRET_PROHIBITED'
      });
    }

    const timestampRaw = req.headers['x-job-timestamp'];
    const nonceRaw = req.headers['x-job-nonce'];
    const signatureRaw = req.headers['x-job-signature'];

    if (!timestampRaw) {
      return res.status(401).json({
        error: 'JOB_TIMESTAMP_REQUIRED',
        message: 'Cabecera x-job-timestamp requerida.',
        code: 'JOB_TIMESTAMP_REQUIRED'
      });
    }

    if (!nonceRaw || String(nonceRaw).trim().length < 16) {
      return res.status(401).json({
        error: 'JOB_NONCE_REQUIRED',
        message: 'Cabecera x-job-nonce requerida (longitud mínima 16 caracteres).',
        code: 'JOB_NONCE_REQUIRED'
      });
    }

    if (!signatureRaw) {
      return res.status(401).json({
        error: 'JOB_SIGNATURE_REQUIRED',
        message: 'Cabecera x-job-signature requerida.',
        code: 'JOB_SIGNATURE_REQUIRED'
      });
    }

    // 1. Time Window Verification (Max 5 minutes = 300,000 ms)
    let tsInt = parseInt(timestampRaw, 10);
    if (isNaN(tsInt)) {
      return res.status(401).json({
        error: 'JOB_TIMESTAMP_INVALID',
        message: 'Cabecera x-job-timestamp debe ser un número entero.',
        code: 'JOB_TIMESTAMP_INVALID'
      });
    }
    if (tsInt < 1e11) tsInt *= 1000;

    const diffMs = Math.abs(Date.now() - tsInt);
    const MAX_WINDOW_MS = 5 * 60 * 1000;

    if (diffMs > MAX_WINDOW_MS) {
      return res.status(401).json({
        error: 'JOB_REQUEST_EXPIRED',
        message: `La solicitud del job ha expirado (diferencia: ${Math.round(diffMs / 1000)}s, máximo permitido: 300s).`,
        code: 'JOB_REQUEST_EXPIRED'
      });
    }

    // 2. Canonical Signature Verification
    const bodyHash = getCanonicalBodyHash(req.body, req.rawBody);
    const requestPath = req.originalUrl ? req.originalUrl.split('?')[0] : (req.path || '').split('?')[0];

    const canonicalString = buildCanonicalJobString({
      method: req.method,
      path: requestPath,
      timestamp: timestampRaw,
      nonce: nonceRaw,
      bodyHash
    });

    const expectedSig = crypto.createHmac('sha256', secret).update(canonicalString).digest('hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    const providedBuf = Buffer.from(String(signatureRaw).trim(), 'hex');

    if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
      return res.status(401).json({
        error: 'INVALID_JOB_SIGNATURE',
        message: 'Firma HMAC de autenticación del job inválida.',
        code: 'INVALID_JOB_SIGNATURE'
      });
    }

    // 3. Single-Use Nonce Hash Persistence Verification (Fail-Closed)
    try {
      const isNonceUnique = await recordAndCheckNonce(pool, String(nonceRaw).trim(), bodyHash, tsInt, middlewareOptions);
      if (!isNonceUnique) {
        return res.status(401).json({
          error: 'NONCE_ALREADY_USED',
          message: 'El nonce ya ha sido utilizado previamente (ataque de replay detectado).',
          code: 'NONCE_ALREADY_USED'
        });
      }
    } catch (err) {
      if (err.code === 'JOB_AUTH_STATE_UNAVAILABLE') {
        return res.status(503).json({
          error: 'JOB_AUTH_STATE_UNAVAILABLE',
          message: 'Estado de autenticación o persistencia del job no disponible (fail-closed).',
          code: 'JOB_AUTH_STATE_UNAVAILABLE'
        });
      }
      return res.status(503).json({
        error: 'JOB_AUTH_STATE_UNAVAILABLE',
        message: 'Error inesperado de base de datos durante la verificación de nonce.',
        code: 'JOB_AUTH_STATE_UNAVAILABLE'
      });
    }

    req.jobAuth = {
      timestamp: tsInt,
      nonce: String(nonceRaw).trim(),
      nonceHash: crypto.createHash('sha256').update(String(nonceRaw).trim()).digest('hex'),
      bodyHash,
      authenticatedAt: new Date()
    };

    next();
  };
}

module.exports = {
  createJobHmacAuthMiddleware,
  computeJobSignature,
  generateJobAuthHeaders,
  getCanonicalBodyHash,
  buildCanonicalJobString,
  recordAndCheckNonce,
  cleanupExpiredNonces,
  claimJobExecution,
  completeJobExecution,
  failJobExecution,
  checkJobIdempotency,
  recordJobExecution
};
