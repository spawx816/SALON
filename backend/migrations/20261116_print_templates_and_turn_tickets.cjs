const { pool: defaultPool } = require('../db');

/**
 * Migración Canónica: Plantillas de Impresión Versionadas y Tickets de Turno (Car Wash / POS)
 * - Tablas: print_templates, turn_ticket_counters, turn_tickets (todas tenant-owned).
 * - Idempotente sobre cualquier esquema objetivo.
 */
async function up(targetPool = defaultPool, targetSchema = 'public') {
  const conn = await targetPool.getConnection();
  try {
    const schema = targetSchema || 'public';
    await conn.query('BEGIN');

    await conn.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".print_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES "${schema}".tenants(id) ON DELETE CASCADE,
        branch_id VARCHAR(100) NULL,
        document_type VARCHAR(40) NOT NULL CHECK (document_type IN ('ticket_turno', 'ticket_venta', 'factura_comercial', 'comanda_restaurante')),
        name VARCHAR(120) NOT NULL,
        paper_width VARCHAR(10) NOT NULL DEFAULT '80mm' CHECK (paper_width IN ('58mm', '80mm', 'A4')),
        numbering_mode VARCHAR(20) NOT NULL DEFAULT 'daily_reset' CHECK (numbering_mode IN ('daily_reset', 'continuous')),
        timezone VARCHAR(80) NOT NULL DEFAULT 'America/Santo_Domingo',
        status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        version INTEGER NOT NULL DEFAULT 1,
        config_json JSONB NOT NULL,
        published_config_json JSONB NULL,
        published_version INTEGER NULL,
        updated_by_user_id VARCHAR(100) NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_print_templates_tenant_id
      ON "${schema}".print_templates USING btree (tenant_id);
    `);

    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_print_templates_tenant_doc_branch
      ON "${schema}".print_templates USING btree (tenant_id, document_type, branch_id, is_default);
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".turn_ticket_counters (
        id SERIAL PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES "${schema}".tenants(id) ON DELETE CASCADE,
        branch_id VARCHAR(100) NOT NULL DEFAULT 'default',
        operational_date VARCHAR(20) NOT NULL,
        last_number INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (tenant_id, branch_id, operational_date)
      );
    `);

    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_turn_ticket_counters_tenant_id
      ON "${schema}".turn_ticket_counters USING btree (tenant_id);
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".turn_tickets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES "${schema}".tenants(id) ON DELETE CASCADE,
        branch_id VARCHAR(100) NOT NULL DEFAULT 'default',
        operational_date VARCHAR(20) NOT NULL,
        turn_number INTEGER NOT NULL,
        display_number VARCHAR(20) NOT NULL,
        numbering_mode VARCHAR(20) NOT NULL DEFAULT 'daily_reset',
        timezone VARCHAR(80) NOT NULL DEFAULT 'America/Santo_Domingo',
        service_name VARCHAR(200) NULL,
        observations TEXT NULL,
        customer_label VARCHAR(120) NULL,
        template_id UUID NULL,
        template_version INTEGER NOT NULL DEFAULT 1,
        template_snapshot JSONB NOT NULL,
        idempotency_key VARCHAR(120) NULL,
        issued_by_user_id VARCHAR(100) NULL,
        issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (tenant_id, branch_id, operational_date, turn_number)
      );
    `);

    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_turn_tickets_tenant_id
      ON "${schema}".turn_tickets USING btree (tenant_id);
    `);

    await conn.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_turn_tickets_tenant_idempotency
      ON "${schema}".turn_tickets (tenant_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
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
      console.log('✅ Migración 20261116_print_templates_and_turn_tickets completada.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Error en migración 20261116_print_templates_and_turn_tickets:', err);
      process.exit(1);
    });
}

module.exports = { up };
