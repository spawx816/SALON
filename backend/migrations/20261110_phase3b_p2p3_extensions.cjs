/**
 * Migration: 20261110_phase3b_p2p3_extensions
 *
 * Implements:
 * 1. Physical Inventory Sessions (REM-P2-03) with location support, initial snapshot,
 *    and minor currency unit valuation.
 * 2. Data Retention & Purga Management (REM-P2-09) with configurable policies,
 *    legal hold protections, and dry-run execution audits.
 * 3. Cash Register Reconciliation Extension (REM-P2-02) with minor currency discrepancy tracking,
 *    mandatory reason, supervisor user identity, and correlation ID.
 * 4. High-Performance Composite Indexes (REM-P2-08) with leading tenant_id column.
 */

'use strict';

async function up(targetPool, targetSchema = 'public') {
  const conn = await targetPool.getConnection();
  try {
    const schema = targetSchema || 'public';
    await conn.query(`SET search_path TO "${schema}";`);

    console.log(`[MIGRATION 20261110_phase3b_p2p3_extensions] Aplicando extensiones P2/P3 en esquema "${schema}"...`);

    // 1. inventory_physical_sessions
    await conn.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".inventory_physical_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES "${schema}".tenants(id) ON DELETE CASCADE,
        branch_id UUID REFERENCES "${schema}".branches(id) ON DELETE SET NULL,
        location_id VARCHAR(100) NOT NULL DEFAULT 'main_storage',
        session_number VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'COUNTING', 'REVIEW', 'POSTED', 'CANCELLED')),
        notes TEXT,
        created_by UUID REFERENCES "${schema}".users(id) ON DELETE SET NULL,
        posted_by UUID REFERENCES "${schema}".users(id) ON DELETE SET NULL,
        posted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_inv_phys_sess_tenant
      ON "${schema}".inventory_physical_sessions (tenant_id, created_at DESC);
    `);

    // Partial unique index: only 1 active session (DRAFT, COUNTING, REVIEW) per tenant + branch + location
    await conn.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_phys_sess_active
      ON "${schema}".inventory_physical_sessions (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), location_id)
      WHERE status IN ('DRAFT', 'COUNTING', 'REVIEW');
    `);

    // 2. inventory_physical_session_items
    await conn.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".inventory_physical_session_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL REFERENCES "${schema}".inventory_physical_sessions(id) ON DELETE CASCADE,
        tenant_id UUID NOT NULL REFERENCES "${schema}".tenants(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES "${schema}".inventory_products(id) ON DELETE CASCADE,
        system_stock_snapshot NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
        movements_since_snapshot NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
        expected_stock_at_post NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
        physical_count NUMERIC(12, 4),
        variance_quantity NUMERIC(12, 4),
        unit_cost_snapshot_cents INTEGER NOT NULL DEFAULT 0,
        variance_cost_cents INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        counted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_inv_phys_item_product UNIQUE (session_id, product_id)
      );
    `);

    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_inv_phys_items_tenant_sess
      ON "${schema}".inventory_physical_session_items (tenant_id, session_id);
    `);

    // 3. data_retention_policies
    await conn.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".data_retention_policies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        category VARCHAR(60) NOT NULL UNIQUE,
        default_retention_days INTEGER NOT NULL,
        legal_hold BOOLEAN NOT NULL DEFAULT false,
        action VARCHAR(30) NOT NULL DEFAULT 'PURGE' CHECK (action IN ('PURGE', 'ANONYMIZE', 'ARCHIVE')),
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed provisional technical default retention policies (not final legal terms)
    await conn.query(`
      INSERT INTO "${schema}".data_retention_policies (category, default_retention_days, legal_hold, action, description)
      VALUES
        ('attendance_photos', 90, false, 'PURGE', 'Almacenamiento privado de fotos biométricas temporales de kiosco'),
        ('temp_exports', 1, false, 'PURGE', 'Archivos cifrados temporales de exportación GDPR de tenant'),
        ('system_job_nonces', 7, false, 'PURGE', 'Nonces de jobs y peticiones idempotentes expiradas'),
        ('invoices', 3650, true, 'ARCHIVE', 'Facturas fiscales sujetas a conservación legal obligatoria (Código Tributario RD). Purga no permitida.'),
        ('contracts', 1825, true, 'ARCHIVE', 'Contratos digitales y firmas bajo prescripción comercial. Purga no permitida.')
      ON CONFLICT (category) DO UPDATE SET
        legal_hold = EXCLUDED.legal_hold,
        description = EXCLUDED.description,
        updated_at = CURRENT_TIMESTAMP;
    `);

    // 4. data_retention_runs
    await conn.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".data_retention_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES "${schema}".tenants(id) ON DELETE CASCADE,
        category VARCHAR(60) NOT NULL,
        is_dry_run BOOLEAN NOT NULL DEFAULT true,
        records_scanned INTEGER NOT NULL DEFAULT 0,
        records_eligible INTEGER NOT NULL DEFAULT 0,
        records_purged INTEGER NOT NULL DEFAULT 0,
        summary JSONB NOT NULL DEFAULT '{}'::jsonb,
        executed_by UUID REFERENCES "${schema}".users(id) ON DELETE SET NULL,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_retention_runs_tenant_date
      ON "${schema}".data_retention_runs (tenant_id, executed_at DESC);
    `);

    // 5. Cash Register Reconciliation Extensions (REM-P2-02)
    await conn.query(`
      ALTER TABLE "${schema}".cash_registers
      ADD COLUMN IF NOT EXISTS difference_amount_cents INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS discrepancy_reason TEXT,
      ADD COLUMN IF NOT EXISTS supervisor_user_id UUID REFERENCES "${schema}".users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS supervisor_authorized_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS authorization_event_type VARCHAR(50),
      ADD COLUMN IF NOT EXISTS correlation_id UUID,
      ADD COLUMN IF NOT EXISTS closed_by VARCHAR(255);
    `);

    await conn.query(`
      ALTER TABLE "${schema}".cash_shifts
      ADD COLUMN IF NOT EXISTS difference_amount_cents INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS discrepancy_reason TEXT,
      ADD COLUMN IF NOT EXISTS supervisor_user_id UUID REFERENCES "${schema}".users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS supervisor_authorized_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS authorization_event_type VARCHAR(50),
      ADD COLUMN IF NOT EXISTS correlation_id UUID;
    `);

    // 6. High-Performance Composite Indexes (REM-P2-08)
    // Non-redundant, justified composite indexes with leading tenant_id
    console.log(`[MIGRATION 20261110_phase3b_p2p3_extensions] Creando índices compuestos de alto rendimiento...`);

    // Visits: index for recent visits per tenant and for client search per tenant
    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_visits_tenant_visited
      ON "${schema}".visits (tenant_id, visited_at DESC);
    `);
    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_visits_tenant_client
      ON "${schema}".visits (tenant_id, client_id);
    `);

    // Attendance: index for date range logs and employee attendance history
    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_attendance_tenant_time
      ON "${schema}".attendance (tenant_id, timestamp DESC);
    `);
    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_attendance_tenant_emp_time
      ON "${schema}".attendance (tenant_id, employee_id, timestamp DESC);
    `);

    // Employee commissions log: index for payroll and employee statement by date
    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_emp_comm_tenant_emp_date
      ON "${schema}".employee_commissions_log (tenant_id, employee_id, created_at DESC);
    `);

    // Invoices: index for NCF lookup per tenant
    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_invoices_tenant_ncf
      ON "${schema}".invoices (tenant_id, ncf);
    `);

    // Cash register movements: index for register movements in descending order
    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_cash_mov_tenant_reg
      ON "${schema}".cash_register_movements (tenant_id, cash_register_id, created_at DESC);
    `);

    console.log(`✅ [MIGRATION 20261110_phase3b_p2p3_extensions] Extensiones P2/P3 instaladas exitosamente.`);
  } finally {
    conn.release();
  }
}

module.exports = { up };

