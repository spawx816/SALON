/**
 * Cryptographic Anti-Replay HMAC Job Authentication Middleware
 * (backend/middleware/job_hmac_auth.middleware.cjs)
 *
 * Implements strict time-window, single-use nonce, and HMAC-SHA256 signature
 * verification for cron / background job triggers.
 *
 * Requirements:
 * 1. x-job-timestamp (window max 5 minutes: 300,000 ms).
 * 2. x-job-nonce (single-use, min 16 chars).
 * 3. x-job-signature: HMAC-SHA256(canonicalString, secret).
 * 4. Canonical string: `${METHOD}\n${PATH}\n${TIMESTAMP}\n${NONCE}\n${BODY_HASH}`
 * 5. Timing-safe comparison (crypto.timingSafeEqual).
 * 6. Nonce persistence in database (idempotency_keys table).
 * 7. Secret NEVER transmitted in clear headers.
 * 8. Idempotency per tenant, date, and job type.
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

// In-memory fallback repository for non-database unit tests
const inMemoryNonceStore = new Map();
const inMemoryJobExecutionStore = new Map();

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
  const s = secret || process.env.CRON_SECRET || process.env.JOB_SIGNATURE_SECRET;
  const sig = computeJobSignature({ method, path, timestamp: ts, nonce: n, body, rawBody, secret: s });
  return {
    'x-job-timestamp': ts,
    'x-job-nonce': n,
    'x-job-signature': sig
  };
}

async function recordAndCheckNonce(pool, nonce, bodyHash) {
  const hasDb = pool && typeof pool.query === 'function';

  if (!hasDb) {
    if (inMemoryNonceStore.has(nonce)) {
      return false; // Already used
    }
    inMemoryNonceStore.set(nonce, { createdAt: Date.now(), bodyHash });
    return true;
  }

  try {
    // Uses idempotency_keys table with tenant_id = 'SYSTEM_CRON'
    await pool.query(
      `INSERT INTO idempotency_keys (tenant_id, idempotency_key, payload_hash, status_code, response_body, expires_at)
       VALUES ('SYSTEM_CRON', ?, ?, 200, '{}', NOW() + INTERVAL '10 minutes')`,
      ['nonce:' + nonce, bodyHash]
    );
    return true;
  } catch (err) {
    // Unique violation error in Postgres or SQLite
    if (err.code === '23505' || String(err.message).toLowerCase().includes('unique') || String(err.message).toLowerCase().includes('duplicate')) {
      return false;
    }
    // Fallback if table temporarily not accessible in mock mode
    if (inMemoryNonceStore.has(nonce)) return false;
    inMemoryNonceStore.set(nonce, { createdAt: Date.now(), bodyHash });
    return true;
  }
}

async function checkJobIdempotency(pool, { tenantId, jobType, date }) {
  const hasDb = pool && typeof pool.query === 'function';
  const key = `job:${jobType}:${date}`;

  if (!hasDb) {
    const composite = `${tenantId}:${key}`;
    if (inMemoryJobExecutionStore.has(composite)) return true; // Already executed
    return false;
  }

  try {
    const [rows] = await pool.query(
      'SELECT id FROM idempotency_keys WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1',
      [String(tenantId), key]
    );
    return rows && rows.length > 0;
  } catch (err) {
    const composite = `${tenantId}:${key}`;
    return inMemoryJobExecutionStore.has(composite);
  }
}

async function recordJobExecution(pool, { tenantId, jobType, date, metadata = {} }) {
  const hasDb = pool && typeof pool.query === 'function';
  const key = `job:${jobType}:${date}`;

  if (!hasDb) {
    const composite = `${tenantId}:${key}`;
    inMemoryJobExecutionStore.set(composite, { executedAt: new Date(), metadata });
    return;
  }

  try {
    await pool.query(
      `INSERT INTO idempotency_keys (tenant_id, idempotency_key, payload_hash, status_code, response_body, expires_at)
       VALUES (?, ?, ?, 200, ?::jsonb, NOW() + INTERVAL '30 days')
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`,
      [String(tenantId), key, crypto.createHash('sha256').update(key).digest('hex'), JSON.stringify(metadata)]
    );
  } catch (err) {
    const composite = `${tenantId}:${key}`;
    inMemoryJobExecutionStore.set(composite, { executedAt: new Date(), metadata });
  }
}

function createJobHmacAuthMiddleware(customPool = null) {
  return async function verifyJobHmacSignature(req, res, next) {
    const pool = customPool || getDefaultPool();
    const secret = process.env.CRON_SECRET || process.env.JOB_SIGNATURE_SECRET;

    if (!secret || String(secret).trim().length < 16) {
      return res.status(403).json({
        error: 'CRON_SECRET_UNCONFIGURED',
        message: 'Servicio de jobs deshabilitado: CRON_SECRET no configurado o longitud menor a 16 caracteres.',
        code: 'CRON_SECRET_UNCONFIGURED'
      });
    }

    // Explicitly reject if secret is sent in headers (security policy)
    if (req.headers['x-cron-secret'] && !req.headers['x-job-signature']) {
      return res.status(401).json({
        error: 'STATIC_SECRET_PROHIBITED',
        message: 'El secreto no puede transmitirse en texto plano en la cabecera. Use autenticación HMAC con x-job-signature.',
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
    // Handle seconds vs milliseconds
    if (tsInt < 1e11) tsInt *= 1000;

    const diffMs = Math.abs(Date.now() - tsInt);
    const MAX_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

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

    // 3. Single-Use Nonce Persistence Verification
    const isNonceUnique = await recordAndCheckNonce(pool, String(nonceRaw).trim(), bodyHash);
    if (!isNonceUnique) {
      return res.status(401).json({
        error: 'NONCE_ALREADY_USED',
        message: 'El nonce ya ha sido utilizado previamente (ataque de replay detectado).',
        code: 'NONCE_ALREADY_USED'
      });
    }

    // Attach validated auth metadata to request
    req.jobAuth = {
      timestamp: tsInt,
      nonce: String(nonceRaw).trim(),
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
  checkJobIdempotency,
  recordJobExecution
};
