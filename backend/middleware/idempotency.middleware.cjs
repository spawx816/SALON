/**
 * Financial Idempotency Middleware
 * (backend/middleware/idempotency.middleware.cjs)
 * 
 * Guarantees that financial mutations (charges, checkouts, voids, refunds, transfers)
 * cannot be duplicated due to retries, network glitches, or double-clicks.
 * 
 * Scoped strictly by tenant_id.
 */

'use strict';

const crypto = require('crypto');

class InMemoryIdempotencyRepository {
  constructor() {
    this._records = new Map(); // key: `${tenantId}:${key}`
  }

  async get(tenantId, idempotencyKey) {
    const compositeKey = `${tenantId}:${idempotencyKey}`;
    return this._records.get(compositeKey) || null;
  }

  async save(tenantId, idempotencyKey, record) {
    const compositeKey = `${tenantId}:${idempotencyKey}`;
    this._records.set(compositeKey, {
      tenantId,
      idempotencyKey,
      ...record,
      createdAt: new Date()
    });
  }

  async clear() {
    this._records.clear();
  }
}

const defaultRepository = new InMemoryIdempotencyRepository();

/**
 * Creates the Idempotency Middleware.
 * 
 * @param {object} options
 * @param {InMemoryIdempotencyRepository} [options.repository]
 * @param {number} [options.ttlSeconds=86400]
 */
function createIdempotencyMiddleware(options = {}) {
  const repository = options.repository || defaultRepository;

  return async function idempotencyMiddleware(req, res, next) {
    // Only apply to mutating methods
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
      return next();
    }

    const rawKey = req.headers['idempotency-key'] ||
                   req.headers['x-idempotency-key'] ||
                   req.body?.idempotency_key;

    if (!rawKey || typeof rawKey !== 'string') {
      // If no idempotency key provided, proceed without replay caching
      return next();
    }

    const cleanKey = String(rawKey).trim();
    if (cleanKey.length < 4 || cleanKey.length > 255) {
      return res.status(400).json({
        error: 'La cabecera o campo Idempotency-Key debe tener entre 4 y 255 caracteres alfanuméricos.',
        code: 'INVALID_IDEMPOTENCY_KEY'
      });
    }

    const tenantId = req.verifiedTenantId || req.tenantId || req.auth?.tenantId || 'global';

    // Compute deterministic payload hash (method + normalized path + body string)
    const normalizedPath = req.baseUrl ? `${req.baseUrl}${req.path}` : req.path;
    const bodyStr = req.body ? JSON.stringify(req.body) : '';
    const payloadHash = crypto
      .createHash('sha256')
      .update(`${req.method.toUpperCase()}:${normalizedPath}:${bodyStr}`)
      .digest('hex');

    try {
      const existing = await repository.get(tenantId, cleanKey);

      if (existing) {
        // If the same key is used with a different request payload, throw conflict
        if (existing.payloadHash !== payloadHash) {
          return res.status(409).json({
            error: 'Conflicto de idempotencia: Se ha reutilizado la clave de idempotencia con una petición o payload diferente.',
            code: 'IDEMPOTENCY_CONFLICT',
            idempotencyKey: cleanKey
          });
        }

        // Exact match replay: Return cached status and response body
        res.setHeader('X-Idempotency-Replay', 'true');
        res.setHeader('X-Idempotency-Key', cleanKey);
        return res.status(existing.statusCode).json(existing.responseBody);
      }

      // Intercept response to store result atomically upon completion
      const originalJson = res.json.bind(res);
      const originalSend = res.send.bind(res);

      res.json = function interceptedJson(body) {
        // Only cache terminal responses (e.g. 2xx, 4xx)
        if (res.statusCode < 500) {
          repository.save(tenantId, cleanKey, {
            payloadHash,
            statusCode: res.statusCode,
            responseBody: body
          }).catch(err => {
            console.error('[IDEMPOTENCY SAVE ERROR]:', err.message);
          });
        }
        res.setHeader('X-Idempotency-Key', cleanKey);
        return originalJson(body);
      };

      res.send = function interceptedSend(body) {
        if (res.statusCode < 500 && typeof body === 'string') {
          try {
            const parsed = JSON.parse(body);
            repository.save(tenantId, cleanKey, {
              payloadHash,
              statusCode: res.statusCode,
              responseBody: parsed
            }).catch(() => {});
          } catch (_) {}
        }
        res.setHeader('X-Idempotency-Key', cleanKey);
        return originalSend(body);
      };

      next();
    } catch (err) {
      console.error('[IDEMPOTENCY MIDDLEWARE ERROR]:', err);
      next(err);
    }
  };
}

module.exports = {
  createIdempotencyMiddleware,
  InMemoryIdempotencyRepository,
  defaultRepository
};

