const DEFAULT_FX_PAIR = 'USD_DOP';
const FX_SCALE = 10000n;
const FX_HALF_SCALE = 5000n;

function createFxError(message, statusCode = 400, code = 'FX_RATE_ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function mapFxStorageError(err) {
  if (
    err?.code === '42P01' ||
    /relation\s+"?(?:[\w.]+\.)?saas_fx_rate/i.test(String(err?.message || ''))
  ) {
    return createFxError(
      'La migración de tasas de cambio USD → DOP (20261115_saas_fx_rates) no ha sido aplicada en la base de datos.',
      503,
      'FX_MIGRATION_MISSING'
    );
  }
  return err;
}

/**
 * Parses and validates a positive decimal FX rate with up to 4 decimal places.
 * Never uses floating point for scaling.
 * @param {string|number} rawRate
 * @returns {{ rateStr: string, rateScaledBigInt: bigint, rateNumber: number }}
 */
function parseAndScaleRate(rawRate) {
  if (rawRate === null || rawRate === undefined) {
    throw createFxError('La tasa de cambio USD → DOP es obligatoria.', 400, 'INVALID_FX_RATE');
  }

  let str;
  if (typeof rawRate === 'number') {
    if (!Number.isFinite(rawRate)) {
      throw createFxError('La tasa de cambio debe ser un número válido.', 400, 'INVALID_FX_RATE');
    }
    str = String(rawRate);
  } else if (typeof rawRate === 'string') {
    str = rawRate.trim().replace(',', '.');
  } else {
    throw createFxError('Formato de tasa de cambio inválido.', 400, 'INVALID_FX_RATE');
  }

  if (!/^\d+(?:\.\d{1,4})?$/.test(str)) {
    throw createFxError(
      'La tasa de cambio debe ser un número positivo con hasta 4 decimales.',
      400,
      'INVALID_FX_RATE'
    );
  }

  const [intPartRaw, fracPartRaw = ''] = str.split('.');
  const intPart = intPartRaw.replace(/^0+(?=\d)/, '') || '0';
  const fracPadded = fracPartRaw.padEnd(4, '0');
  const rateScaledBigInt = BigInt(`${intPart}${fracPadded}`);

  if (rateScaledBigInt <= 0n) {
    throw createFxError('La tasa de cambio debe ser mayor que cero.', 400, 'INVALID_FX_RATE');
  }

  const rateStr = `${intPart}.${fracPadded}`;
  return {
    rateStr,
    rateScaledBigInt,
    rateNumber: Number(rateStr),
  };
}

/**
 * Exact BigInt conversion from USD minor units (cents) to DOP minor units (centavos).
 * Uses half-up rounding: (usdMinor * rateScaled + 5000n) / 10000n.
 * @param {bigint|number|string} usdMinorInput
 * @param {bigint|number|string} rateScaledInput
 * @returns {bigint}
 */
function convertUsdMinorToDopMinor(usdMinorInput, rateScaledInput) {
  const usdMinor = BigInt(usdMinorInput);
  const rateScaled = BigInt(rateScaledInput);
  if (rateScaled <= 0n) {
    throw createFxError('La tasa de cambio configurada no es válida.', 409, 'FX_RATE_NOT_CONFIGURED');
  }
  if (usdMinor === 0n) return 0n;
  if (usdMinor > 0n) {
    return (usdMinor * rateScaled + FX_HALF_SCALE) / FX_SCALE;
  }
  const abs = -usdMinor;
  return -((abs * rateScaled + FX_HALF_SCALE) / FX_SCALE);
}

function mapRateRow(row) {
  if (!row) return null;
  const scaled = BigInt(row.rate_scaled_10000 || 0);
  if (scaled <= 0n) return null;
  return {
    id: row.id,
    pair: row.pair,
    rate: Number(row.rate),
    rateFormatted: String(row.rate),
    rateScaled10000: String(row.rate_scaled_10000),
    updatedByUserId: row.updated_by_user_id ?? null,
    updatedByEmail: row.updated_by_email ?? null,
    reason: row.reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapHistoryRow(row) {
  return {
    id: row.id,
    pair: row.pair,
    previousRate: row.previous_rate !== null && row.previous_rate !== undefined ? Number(row.previous_rate) : null,
    previousRateFormatted: row.previous_rate !== null && row.previous_rate !== undefined ? String(row.previous_rate) : null,
    newRate: Number(row.new_rate),
    newRateFormatted: String(row.new_rate),
    actorUserId: row.actor_user_id ?? null,
    actorEmail: row.actor_email ?? null,
    reason: row.reason ?? null,
    createdAt: row.created_at,
  };
}

function extractRows(res) {
  if (Array.isArray(res)) return Array.isArray(res[0]) ? res[0] : [];
  return Array.isArray(res?.rows) ? res.rows : [];
}

class SaasFxRateService {
  constructor({ pool }) {
    this.pool = pool;
  }

  async getCurrentRate(pair = DEFAULT_FX_PAIR) {
    try {
      const res = await this.pool.query(
        `SELECT id, pair, rate, rate_scaled_10000, updated_by_user_id, updated_by_email, reason, created_at, updated_at
         FROM saas_fx_rates
         WHERE pair = $1
         LIMIT 1`,
        [pair]
      );
      const rows = extractRows(res);
      return mapRateRow(rows[0]);
    } catch (err) {
      throw mapFxStorageError(err);
    }
  }

  async requireCurrentRate(pair = DEFAULT_FX_PAIR) {
    const current = await this.getCurrentRate(pair);
    if (!current) {
      throw createFxError(
        'No hay una tasa de cambio USD → DOP válida configurada. El administrador debe configurarla antes de generar cobros.',
        409,
        'FX_RATE_NOT_CONFIGURED'
      );
    }
    return current;
  }

  async getRateWithHistory(pair = DEFAULT_FX_PAIR, limit = 30) {
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30));
    try {
      const [current, histRes] = await Promise.all([
        this.getCurrentRate(pair),
        this.pool.query(
          `SELECT id, pair, previous_rate, new_rate, previous_rate_scaled_10000, new_rate_scaled_10000,
                  actor_user_id, actor_email, reason, created_at
           FROM saas_fx_rate_history
           WHERE pair = $1
           ORDER BY created_at DESC, id DESC
           LIMIT $2`,
          [pair, safeLimit]
        ),
      ]);
      const histRows = extractRows(histRes);
      return {
        current,
        history: histRows.map(mapHistoryRow),
      };
    } catch (err) {
      throw mapFxStorageError(err);
    }
  }

  async updateRate({ pair = DEFAULT_FX_PAIR, rate, reason = null, actorUserId = null, actorEmail = null }) {
    const parsed = parseAndScaleRate(rate);
    const cleanReason = reason ? String(reason).trim().slice(0, 500) : null;
    const cleanActorId = actorUserId !== null && actorUserId !== undefined ? String(actorUserId).slice(0, 100) : null;

    const client = typeof this.pool.getConnection === 'function'
      ? await this.pool.getConnection()
      : await this.pool.connect();
    try {
      if (typeof client.beginTransaction === 'function') {
        await client.beginTransaction();
      } else {
        await client.query('BEGIN');
      }

      const existingRes = await client.query(
        `SELECT id, pair, rate, rate_scaled_10000
         FROM saas_fx_rates
         WHERE pair = $1
         FOR UPDATE`,
        [pair]
      );
      const existing = extractRows(existingRes)[0] || null;

      const upsertRes = await client.query(
        `INSERT INTO saas_fx_rates (
           pair, rate, rate_scaled_10000, updated_by_user_id, updated_by_email, reason, created_at, updated_at
         ) VALUES ($1, $2::numeric, $3::bigint, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (pair) DO UPDATE SET
           rate = EXCLUDED.rate,
           rate_scaled_10000 = EXCLUDED.rate_scaled_10000,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_by_email = EXCLUDED.updated_by_email,
           reason = EXCLUDED.reason,
           updated_at = NOW()
         RETURNING id, pair, rate, rate_scaled_10000, updated_by_user_id, updated_by_email, reason, created_at, updated_at`,
        [
          pair,
          parsed.rateStr,
          parsed.rateScaledBigInt.toString(),
          cleanActorId,
          actorEmail ? String(actorEmail).slice(0, 255) : null,
          cleanReason,
        ]
      );

      const histRes = await client.query(
        `INSERT INTO saas_fx_rate_history (
           pair, previous_rate, new_rate, previous_rate_scaled_10000, new_rate_scaled_10000,
           actor_user_id, actor_email, reason, created_at
         ) VALUES ($1, $2, $3::numeric, $4, $5::bigint, $6, $7, $8, NOW())
         RETURNING id, pair, previous_rate, new_rate, previous_rate_scaled_10000, new_rate_scaled_10000,
                   actor_user_id, actor_email, reason, created_at`,
        [
          pair,
          existing ? existing.rate : null,
          parsed.rateStr,
          existing ? existing.rate_scaled_10000 : null,
          parsed.rateScaledBigInt.toString(),
          cleanActorId,
          actorEmail ? String(actorEmail).slice(0, 255) : null,
          cleanReason,
        ]
      );

      if (typeof client.commit === 'function') {
        await client.commit();
      } else {
        await client.query('COMMIT');
      }
      return {
        current: mapRateRow(extractRows(upsertRes)[0]),
        historyEntry: mapHistoryRow(extractRows(histRes)[0]),
      };
    } catch (err) {
      if (typeof client.rollback === 'function') {
        await client.rollback().catch(() => {});
      } else {
        await client.query('ROLLBACK').catch(() => {});
      }
      throw mapFxStorageError(err);
    } finally {
      client.release();
    }
  }
}

module.exports = {
  DEFAULT_FX_PAIR,
  FX_SCALE,
  SaasFxRateService,
  parseAndScaleRate,
  convertUsdMinorToDopMinor,
  createFxError,
};
