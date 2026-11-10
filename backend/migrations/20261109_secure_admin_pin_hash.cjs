/**
 * Migration: 20261109_secure_admin_pin_hash.cjs
 * 
 * Prepares the security_settings table to support adaptive bcrypt hashes
 * for administrative PINs, tracking failed attempts, and rate-limiting lockout.
 * 
 * IDEMPOTENT — DO NOT EXECUTE DIRECTLY IN TEST HARNESS (IN-MEMORY MOCK USED).
 * Ready for physical execution when PostgreSQL infrastructure is unpaused.
 */

'use strict';

async function up(pool) {
  console.log('[MIGRATION] Applying 20261109_secure_admin_pin_hash...');

  await pool.query(`
    ALTER TABLE security_settings 
      ADD COLUMN IF NOT EXISTS admin_pin_hash VARCHAR(255) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS pin_failed_attempts INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMP WITH TIME ZONE DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS legacy_pin_pending_rotation BOOLEAN DEFAULT FALSE;
  `);

  // Flag legacy plaintext records for mandatory rotation without copying plaintext blindly
  await pool.query(`
    UPDATE security_settings 
    SET legacy_pin_pending_rotation = TRUE 
    WHERE admin_pin IS NOT NULL 
      AND admin_pin NOT LIKE '$2%' 
      AND admin_pin_hash IS NULL;
  `);

  console.log('[MIGRATION] 20261109_secure_admin_pin_hash applied successfully.');
}

async function down(pool) {
  console.log('[MIGRATION] Reverting 20261109_secure_admin_pin_hash...');
  await pool.query(`
    ALTER TABLE security_settings 
      DROP COLUMN IF EXISTS admin_pin_hash,
      DROP COLUMN IF EXISTS pin_failed_attempts,
      DROP COLUMN IF EXISTS pin_locked_until,
      DROP COLUMN IF EXISTS legacy_pin_pending_rotation;
  `);
  console.log('[MIGRATION] Reverted 20261109_secure_admin_pin_hash.');
}

module.exports = {
  up,
  down
};

