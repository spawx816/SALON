const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../db');

/**
 * Migration: Phase 1 Schema Compatibility
 * Ensures non-destructive compatibility columns exist in PostgreSQL.
 */
async function runSchemaCompatMigration() {
  console.log('--- Iniciando migración de compatibilidad de esquema Fase 1 ---');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Table expenses
    await conn.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID,
        salon_id VARCHAR(100),
        branch_id VARCHAR(100),
        concept VARCHAR(255),
        description TEXT,
        category VARCHAR(100) DEFAULT 'Operativo',
        amount NUMERIC(14,2) NOT NULL DEFAULT 0.00,
        date DATE,
        expense_date DATE,
        payment_method VARCHAR(100) DEFAULT 'Efectivo',
        rnc_proveedor VARCHAR(50),
        ncf VARCHAR(50),
        created_by VARCHAR(150),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await conn.query('CREATE INDEX IF NOT EXISTS idx_expenses_tenant ON expenses(tenant_id)');

    // 2. Table clients: add direccion
    await conn.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS direccion TEXT');

    // 3. Table contracts: add compatibility fields
    await conn.query('ALTER TABLE contracts ADD COLUMN IF NOT EXISTS plan_name VARCHAR(255)');
    await conn.query('ALTER TABLE contracts ADD COLUMN IF NOT EXISTS precio_mensual NUMERIC(10,2)');
    await conn.query('ALTER TABLE contracts ADD COLUMN IF NOT EXISTS wash_quota INT DEFAULT 4');
    await conn.query('ALTER TABLE contracts ADD COLUMN IF NOT EXISTS washes_used INT DEFAULT 0');
    await conn.query('ALTER TABLE contracts ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMP WITH TIME ZONE');
    await conn.query('ALTER TABLE contracts ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMP WITH TIME ZONE');

    // 4. Table tenants: add SaaS fields
    await conn.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_name VARCHAR(255)');
    await conn.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_email VARCHAR(255)');
    await conn.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_phone VARCHAR(50)');
    await conn.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS max_users INT DEFAULT 5');
    await conn.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS max_branches INT DEFAULT 1');
    await conn.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS modules_config JSONB DEFAULT \'{}\'::jsonb');

    // 5. Table branches & plans compatibility fields
    await conn.query('ALTER TABLE branches ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true');
    await conn.query('ALTER TABLE salons ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT \'Active\'');
    await conn.query('ALTER TABLE plans ADD COLUMN IF NOT EXISTS name VARCHAR(255)');
    await conn.query('ALTER TABLE plans ADD COLUMN IF NOT EXISTS description TEXT');
    await conn.query('ALTER TABLE plans ADD COLUMN IF NOT EXISTS features JSONB');

    // 6. Register version
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(100) PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        actor VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL
      )
    `);
    await conn.query(`
      INSERT INTO schema_migrations (version, actor, status)
      VALUES ('20261108_phase1_schema_compat', 'system_security', 'applied')
      ON CONFLICT (version) DO UPDATE SET applied_at = NOW(), status = 'applied'
    `);

    await conn.commit();
    console.log('✅ Migración de compatibilidad completada exitosamente.');
    process.exit(0);
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error en migración de compatibilidad:', err);
    process.exit(1);
  } finally {
    conn.release();
  }
}

runSchemaCompatMigration();
