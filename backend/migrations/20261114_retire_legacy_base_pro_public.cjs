'use strict';

/**
 * Idempotent Migration: Retire legacy BASE and PRO plans from public/active offer
 * while preserving historical rows and billing/tenant FK references.
 */
async function runMigration(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      UPDATE saas_plans
      SET is_public = FALSE,
          is_active = FALSE
      WHERE UPPER(COALESCE(code, '')) IN ('BASE', 'PRO')
        AND (is_public IS DISTINCT FROM FALSE OR is_active IS DISTINCT FROM FALSE);
    `);
    await client.query('COMMIT');
    return { success: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  const { Pool } = require('pg');
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'salon_saas_staging'
  });
  runMigration(pool)
    .then(() => {
      console.log('Migration 20261114_retire_legacy_base_pro_public completed.');
      return pool.end();
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exitCode = 1;
      return pool.end();
    });
}

module.exports = { runMigration };

