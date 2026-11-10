const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../db');

/**
 * Rollback Migration: Phase 1 Schema Compatibility
 */
async function rollbackSchemaCompatMigration() {
  console.log('--- Rollback migración de compatibilidad de esquema Fase 1 ---');
  try {
    await pool.query('BEGIN');
    await pool.query('DROP TABLE IF EXISTS expenses CASCADE');
    await pool.query('ALTER TABLE clients DROP COLUMN IF EXISTS direccion');
    await pool.query('ALTER TABLE contracts DROP COLUMN IF EXISTS plan_name');
    await pool.query('ALTER TABLE contracts DROP COLUMN IF EXISTS precio_mensual');
    await pool.query('ALTER TABLE contracts DROP COLUMN IF EXISTS wash_quota');
    await pool.query('ALTER TABLE contracts DROP COLUMN IF EXISTS washes_used');
    await pool.query('ALTER TABLE contracts DROP COLUMN IF EXISTS current_period_start');
    await pool.query('ALTER TABLE contracts DROP COLUMN IF EXISTS current_period_end');
    await pool.query('ALTER TABLE tenants DROP COLUMN IF EXISTS owner_name');
    await pool.query('ALTER TABLE tenants DROP COLUMN IF EXISTS owner_email');
    await pool.query('ALTER TABLE tenants DROP COLUMN IF EXISTS owner_phone');
    await pool.query('ALTER TABLE tenants DROP COLUMN IF EXISTS max_users');
    await pool.query('ALTER TABLE tenants DROP COLUMN IF EXISTS max_branches');
    await pool.query('ALTER TABLE tenants DROP COLUMN IF EXISTS modules_config');
    await pool.query('ALTER TABLE branches DROP COLUMN IF EXISTS is_active');
    await pool.query('ALTER TABLE salons DROP COLUMN IF EXISTS status');
    await pool.query('ALTER TABLE plans DROP COLUMN IF EXISTS name');
    await pool.query('ALTER TABLE plans DROP COLUMN IF EXISTS description');
    await pool.query('ALTER TABLE plans DROP COLUMN IF EXISTS features');
    await pool.query('COMMIT');
    console.log('✅ Rollback completado exitosamente.');
    process.exit(0);
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('❌ Error en rollback:', err);
    process.exit(1);
  }
}

rollbackSchemaCompatMigration();
