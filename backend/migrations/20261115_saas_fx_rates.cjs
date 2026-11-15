const { pool: defaultPool } = require('../db');

/**
 * Migración Canónica: Tablas Globales de Tasa de Cambio Manual USD -> DOP
 * (saas_fx_rates, saas_fx_rate_history)
 * - Clasificación: Tablas Globales / Control Plane (sin tenant_id).
 * - Idempotente sobre cualquier esquema objetivo.
 */
async function up(targetPool = defaultPool, targetSchema = 'public') {
  const conn = await targetPool.getConnection();
  try {
    const schema = targetSchema || 'public';
    await conn.query('BEGIN');

    await conn.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".saas_fx_rates (
        id SERIAL PRIMARY KEY,
        pair VARCHAR(16) NOT NULL UNIQUE,
        rate NUMERIC(14, 4) NOT NULL CHECK (rate > 0),
        rate_scaled_10000 BIGINT NOT NULL CHECK (rate_scaled_10000 > 0),
        updated_by_user_id VARCHAR(100),
        updated_by_email VARCHAR(255),
        reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".saas_fx_rate_history (
        id SERIAL PRIMARY KEY,
        pair VARCHAR(16) NOT NULL,
        previous_rate NUMERIC(14, 4),
        new_rate NUMERIC(14, 4) NOT NULL CHECK (new_rate > 0),
        previous_rate_scaled_10000 BIGINT,
        new_rate_scaled_10000 BIGINT NOT NULL CHECK (new_rate_scaled_10000 > 0),
        actor_user_id VARCHAR(100),
        actor_email VARCHAR(255),
        reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_saas_fx_rate_history_pair_created
      ON "${schema}".saas_fx_rate_history (pair, created_at DESC, id DESC);
    `);

    await conn.query('COMMIT');
    return true;
  } catch (err) {
    await conn.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  up()
    .then(() => {
      console.log('✅ Migración 20261115_saas_fx_rates completada.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Error en migración 20261115_saas_fx_rates:', err);
      process.exit(1);
    });
}

module.exports = { up };
