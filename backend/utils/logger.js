/**
 * Structured JSON Logger & PII Sanitizer (REM-P2-04 & REM-P3-03)
 *
 * Implements:
 * 1. ISO 8601 UTC timestamps, standardized log levels, correlation IDs, and tenant tracking.
 * 2. Recursive sanitization of prohibited fields (passwords, PINs, tokens, CVVs, signatures, photos).
 * 3. Preserves legitimate operational fields (service_name, salon_name, role, event_name).
 * 4. Zero full body dumps by default; sanitized route normalization.
 */

'use strict';

const crypto = require('crypto');

// Exact list of sensitive fields that must ALWAYS be redacted
const FORBIDDEN_FIELDS = new Set([
  'password',
  'pin',
  'current_pin',
  'supervisor_pin',
  'admin_pin',
  'new_pin',
  'token',
  'jwt',
  'secret',
  'card_number',
  'card_token',
  'pan',
  'cvv',
  'cvc',
  'authorization',
  'cookie',
  'signature_data',
  'photo',
  'signature',
  'access_token',
  'refresh_token',
  'apikey',
  'api_key',
  'private_key',
  'public_key'
]);

// Personal identifier maskers
function maskEmail(val) {
  if (typeof val !== 'string' || !val.includes('@')) return '[REDACTED_EMAIL]';
  const parts = val.split('@');
  const user = parts[0];
  const domain = parts[1];
  const maskedUser = user.length > 2 ? `${user[0]}***${user[user.length - 1]}` : `${user[0]}***`;
  return `${maskedUser}@${domain}`;
}

function maskPhone(val) {
  if (typeof val !== 'string') return '[REDACTED_PHONE]';
  const clean = val.replace(/\D/g, '');
  if (clean.length < 4) return '***-***-****';
  return `***-***-${clean.slice(-4)}`;
}

function maskCedula(val) {
  if (typeof val !== 'string') return '[REDACTED_ID]';
  const clean = val.replace(/\D/g, '');
  if (clean.length < 4) return '***-*****--*';
  return `***-*****${clean.slice(-4, -1)}-${clean.slice(-1)}`;
}

/**
 * Deep recursive object sanitization
 * Does NOT redact generic 'name' if it represents an operational entity (service, category, salon).
 */
function sanitizePayload(data, depth = 0) {
  if (depth > 6) return '[MAX_DEPTH_REACHED]';
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    // Redact raw authorization bearer patterns
    if (data.toLowerCase().startsWith('bearer ')) return 'Bearer [REDACTED_TOKEN]';
    if (data.startsWith('data:image/') || data.length > 1000) return '[BINARY_OR_OVERSIZED_DATA]';
    return data;
  }

  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map(item => sanitizePayload(item, depth + 1));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();

    // 1. Strict forbidden fields check
    if (FORBIDDEN_FIELDS.has(lowerKey)) {
      sanitized[key] = '[REDACTED_SECRET]';
      continue;
    }

    // 2. Specific PII format masking
    if (lowerKey === 'email' || lowerKey.endsWith('_email')) {
      sanitized[key] = typeof value === 'string' ? maskEmail(value) : '[REDACTED_EMAIL]';
      continue;
    }

    if (lowerKey === 'phone' || lowerKey === 'telefono' || lowerKey.endsWith('_phone')) {
      sanitized[key] = typeof value === 'string' ? maskPhone(value) : '[REDACTED_PHONE]';
      continue;
    }

    if (lowerKey === 'cedula' || lowerKey === 'cedula_rnc' || lowerKey === 'rnc') {
      sanitized[key] = typeof value === 'string' ? maskCedula(value) : '[REDACTED_ID]';
      continue;
    }

    // 3. Operational fields preservation (service_name, product_name, salon_name, event_name, role)
    // NEVER redact operational names
    if (lowerKey === 'service_name' || lowerKey === 'salon_name' || lowerKey === 'branch_name' ||
        lowerKey === 'category_name' || lowerKey === 'role' || lowerKey === 'event_name') {
      sanitized[key] = value;
      continue;
    }

    // 4. Recursive sanitization
    sanitized[key] = sanitizePayload(value, depth + 1);
  }

  return sanitized;
}

class JsonLogger {
  constructor(options = {}) {
    this.service = options.service || 'salonpro-api';
    this.env = options.env || process.env.NODE_ENV || 'staging';
    this.output = options.output || console.log;
  }

  _log(level, event, metadata = {}) {
    const timestamp = new Date().toISOString();
    const correlationId = metadata.correlation_id || metadata.correlationId || crypto.randomUUID();
    const actorId = metadata.actor_id || metadata.actorId || null;
    const tenantId = metadata.tenant_id || metadata.tenantId || null;

    const safeMeta = sanitizePayload(metadata);
    delete safeMeta.correlation_id;
    delete safeMeta.correlationId;
    delete safeMeta.actor_id;
    delete safeMeta.actorId;
    delete safeMeta.tenant_id;
    delete safeMeta.tenantId;

    const logEntry = {
      timestamp,
      level,
      service: this.service,
      env: this.env,
      correlation_id: correlationId,
      actor_id: actorId,
      tenant_id: tenantId,
      event,
      ...safeMeta
    };

    const serialized = JSON.stringify(logEntry);
    this.output(serialized);
    return logEntry;
  }

  info(event, metadata) {
    return this._log('info', event, metadata);
  }

  warn(event, metadata) {
    return this._log('warn', event, metadata);
  }

  error(event, metadata) {
    return this._log('error', event, metadata);
  }

  debug(event, metadata) {
    if (this.env !== 'production') {
      return this._log('debug', event, metadata);
    }
  }

  /**
   * Express HTTP Request Middleware
   */
  middleware() {
    return (req, res, next) => {
      const startTime = Date.now();
      const correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
      req.correlationId = correlationId;
      res.setHeader('X-Correlation-Id', correlationId);

      res.on('finish', () => {
        const durationMs = Date.now() - startTime;
        const statusCode = res.statusCode;
        const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

        // Omit bodies by default; only record route and metadata
        const routePath = req.baseUrl ? `${req.baseUrl}${req.path}` : req.path;

        this._log(level, 'HTTP_REQUEST_COMPLETED', {
          correlation_id: correlationId,
          actor_id: req.auth?.userId || req.auth?.id || null,
          tenant_id: req.tenantId || null,
          method: req.method,
          path: routePath,
          status: statusCode,
          duration_ms: durationMs,
          error_code: res.locals?.errorCode || (statusCode >= 400 ? `HTTP_${statusCode}` : null)
        });
      });

      next();
    };
  }
}

const defaultLogger = new JsonLogger();

module.exports = {
  JsonLogger,
  logger: defaultLogger,
  sanitizePayload,
  maskEmail,
  maskPhone,
  maskCedula
};

