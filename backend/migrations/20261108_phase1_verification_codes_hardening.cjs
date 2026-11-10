/**
 * Migration: 20261108_phase1_verification_codes_hardening
 * 
 * Hardens verification_codes with tenant binding, cryptographic hashing,
 * purpose, channel, identity, and brute-force attempt tracking.
 */
const { pool } = require('../db');

async function up(targetPool = pool, targetSchema = null) {
  console.log('🛡️ [MIGRATION] Reforzando esquema de verification_codes...');
  const conn = await targetPool.getConnection();
  try {
    await conn.beginTransaction();

    if (targetSchema) {
      await conn.query(`SET search_path TO ${targetSchema}, public;`);
    }

    await conn.query(`
      ALTER TABLE verification_codes 
        ADD COLUMN IF NOT EXISTS user_id VARCHAR(255),
        ADD COLUMN IF NOT EXISTS identity VARCHAR(255),
        ADD COLUMN IF NOT EXISTS purpose VARCHAR(50) DEFAULT 'password_reset',
        ADD COLUMN IF NOT EXISTS channel VARCHAR(50) DEFAULT 'email',
        ADD COLUMN IF NOT EXISTS code_hash VARCHAR(255),
        ADD COLUMN IF NOT EXISTS attempts INT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS max_attempts INT DEFAULT 5,
        ADD COLUMN IF NOT EXISTS used_at TIMESTAMP WITH TIME ZONE;
    `);

    // Backfill user_id from client_id if null
    await conn.query(`
      UPDATE verification_codes 
      SET user_id = client_id 
      WHERE user_id IS NULL AND client_id IS NOT NULL;
    `);

    // Add index for fast scoped lookups
    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_lookup 
      ON verification_codes (tenant_id, user_id, purpose, is_used);
    `);

    await conn.commit();
    console.log('✅ [MIGRATION] verification_codes reforzada exitosamente.');
  } catch (err) {
    await conn.rollback();
    console.error('❌ [MIGRATION ERROR]: Error reforzando verification_codes:', err.message);
    throw err;
  } finally {
    conn.release();
  }
}

async function down(targetPool = pool) {
  const conn = await targetPool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DROP INDEX IF EXISTS idx_verification_lookup;');
    await conn.commit();
    console.log('✅ [MIGRATION ROLLBACK] Rollback de verification_codes completado.');
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  up()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { up, down };

