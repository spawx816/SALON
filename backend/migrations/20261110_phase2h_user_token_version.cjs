/**
 * Migration: 20261110_phase2h_user_token_version
 * 
 * Adds token_version to users table to support cryptographically verified
 * remote session revocation and credential change invalidation (REM-P1-01).
 * Idempotent: checks IF NOT EXISTS before executing.
 */

'use strict';

async function up(pool, targetSchema = 'public') {
  const schema = targetSchema || 'public';
  const query = `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = '${schema}'
          AND table_name = 'users'
          AND column_name = 'token_version'
      ) THEN
        ALTER TABLE "${schema}"."users" ADD COLUMN token_version integer DEFAULT 1;
      END IF;
    END $$;
  `;

  await pool.query(query);
  return { success: true };
}

async function down(pool, targetSchema = 'public') {
  const schema = targetSchema || 'public';
  await pool.query(`ALTER TABLE "${schema}"."users" DROP COLUMN IF EXISTS token_version;`);
  return { success: true };
}

module.exports = { up, down };
