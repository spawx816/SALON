'use strict';

/**
 * Migration: RBAC Hardening, Scoped Branches & Admin Delegation Flag
 * Idempotent: safe to run multiple times.
 * Never widens existing permissions or degrades owners.
 */
async function up(conn) {
  await conn.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS authorized_branch_ids TEXT DEFAULT '[]';
  `);
  await conn.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS all_branches_access BOOLEAN NOT NULL DEFAULT FALSE;
  `);
  await conn.query(`
    ALTER TABLE security_settings ADD COLUMN IF NOT EXISTS allow_admin_role_delegation BOOLEAN NOT NULL DEFAULT FALSE;
  `);
  await conn.query(`
    ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_nombre_key;
  `);
  await conn.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_tenant_nombre_unique ON roles (tenant_id, LOWER(nombre));
  `);
}

module.exports = { up };
