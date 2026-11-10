/**
 * Cryptographically Signed Cursor Pagination Utility (REM-P2-05 & Addendum 7)
 *
 * Implements:
 * 1. Stable ordering on (created_at DESC, id DESC).
 * 2. HMAC-SHA256 signature to prevent tampering.
 * 3. Strict tenant_id binding preventing cross-tenant cursor reuse.
 * 4. Filter hash validation to prevent cursor replay across divergent queries.
 * 5. Optional totalCount execution to eliminate expensive COUNT(*) queries by default.
 */

'use strict';

const crypto = require('crypto');

function getHmacSecret() {
  return process.env.CURSOR_HMAC_SECRET || process.env.COOKIE_SECRET || process.env.JWT_SECRET || 'salonpro-cursor-secret-key-32b';
}

function computeFilterHash(filterParams = {}) {
  const sorted = Object.keys(filterParams).sort().reduce((acc, k) => {
    if (filterParams[k] !== undefined && filterParams[k] !== null && filterParams[k] !== '') {
      acc[k] = filterParams[k];
    }
    return acc;
  }, {});
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex').substring(0, 16);
}

function encodeCursor({ tenant_id, last_created_at, last_id, filters_hash = '' }) {
  const createdAtIso = last_created_at instanceof Date
    ? last_created_at.toISOString()
    : new Date(last_created_at).toISOString();

  const payload = JSON.stringify({
    t: tenant_id,
    c: createdAtIso,
    i: String(last_id),
    f: filters_hash || ''
  });

  const sig = crypto.createHmac('sha256', getHmacSecret()).update(payload).digest('hex');
  const token = Buffer.from(JSON.stringify({ p: payload, s: sig })).toString('base64url');
  return token;
}

function decodeCursor(cursorToken, expectedTenantId, currentFiltersHash = '') {
  if (!cursorToken || typeof cursorToken !== 'string' || cursorToken.trim() === '') {
    return null;
  }

  try {
    const raw = Buffer.from(cursorToken.trim(), 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.p || !parsed.s) {
      const err = new Error('MALFORMED_CURSOR: Missing cursor payload or signature structure.');
      err.code = 'INVALID_CURSOR';
      err.status = 400;
      throw err;
    }

    const { p: payload, s: sig } = parsed;
    const expectedSig = crypto.createHmac('sha256', getHmacSecret()).update(payload).digest('hex');

    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expectedSig, 'hex');

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      const err = new Error('INVALID_CURSOR_SIGNATURE: Cursor payload has been tampered with or modified.');
      err.code = 'INVALID_CURSOR';
      err.status = 400;
      throw err;
    }

    const data = JSON.parse(payload);

    // Cross-tenant verification
    if (String(data.t) !== String(expectedTenantId)) {
      const err = new Error('CROSS_TENANT_CURSOR_FORBIDDEN: Cursor does not match the active authenticated tenant.');
      err.code = 'CROSS_TENANT_CURSOR';
      err.status = 400;
      throw err;
    }

    // Filter drift verification
    if (currentFiltersHash && data.f && data.f !== currentFiltersHash) {
      const err = new Error('CURSOR_FILTER_MISMATCH: Pagination cursor was generated for a different query filter.');
      err.code = 'CURSOR_FILTER_MISMATCH';
      err.status = 400;
      throw err;
    }

    return {
      tenant_id: data.t,
      last_created_at: new Date(data.c),
      last_id: data.i
    };
  } catch (err) {
    if (err.code) throw err;
    const malformed = new Error('MALFORMED_CURSOR: Invalid Base64URL cursor format.');
    malformed.code = 'INVALID_CURSOR';
    malformed.status = 400;
    throw malformed;
  }
}

/**
 * Builds standard paginated response envelope
 */
function buildPaginatedResponse({
  items,
  limit,
  tenant_id,
  filters_hash = '',
  total_count = null,
  getCreatedAt = (item) => item.created_at,
  getId = (item) => item.id
}) {
  const hasMore = items.length > limit;
  const pageItems = hasMore ? items.slice(0, limit) : items;

  let nextCursor = null;
  if (hasMore && pageItems.length > 0) {
    const lastItem = pageItems[pageItems.length - 1];
    nextCursor = encodeCursor({
      tenant_id,
      last_created_at: getCreatedAt(lastItem),
      last_id: getId(lastItem),
      filters_hash
    });
  }

  const response = {
    data: pageItems,
    pagination: {
      limit,
      has_more: hasMore,
      next_cursor: nextCursor
    }
  };

  if (total_count !== null && total_count !== undefined) {
    response.pagination.total_count = total_count;
  }

  return response;
}

module.exports = {
  encodeCursor,
  decodeCursor,
  computeFilterHash,
  buildPaginatedResponse
};

