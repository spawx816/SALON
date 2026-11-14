const { pool: defaultPool } = require('../db');

async function up(targetPool = defaultPool, targetSchema = 'public') {
  const conn = await targetPool.getConnection();
  try {
    const schema = targetSchema || 'public';
    await conn.query('BEGIN');

    // 1. Vincular services.commission_category_id -> commission_categories(id)
    await conn.query(`
      ALTER TABLE ${schema}.services
      ADD COLUMN IF NOT EXISTS commission_category_id INTEGER NULL
      REFERENCES ${schema}.commission_categories(id) ON DELETE SET NULL;
    `);
    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_services_tenant_comm_cat
      ON ${schema}.services (tenant_id, commission_category_id);
    `);

    // Backfill seguro por tenant_id y nombre de categoría existente
    await conn.query(`
      UPDATE ${schema}.services s
      SET commission_category_id = cc.id
      FROM ${schema}.commission_categories cc
      WHERE s.commission_category_id IS NULL
        AND s.tenant_id = cc.tenant_id
        AND LOWER(TRIM(COALESCE(s.categoria, s.category, ''))) = LOWER(TRIM(cc.nombre));
    `);

    // 2. Configuración general de alertas de inventario por tenant
    await conn.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.inventory_alert_settings (
        tenant_id UUID PRIMARY KEY REFERENCES ${schema}.tenants(id) ON DELETE CASCADE,
        alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        default_min_stock NUMERIC(14,4) NOT NULL DEFAULT 5 CHECK (default_min_stock >= 0),
        updated_by VARCHAR(255),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 3. Excepciones (overrides) por producto y opcionalmente por ubicación/sucursal
    await conn.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.inventory_alert_overrides (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES ${schema}.tenants(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES ${schema}.services(id) ON DELETE CASCADE,
        location_id UUID NULL REFERENCES ${schema}.inventory_locations(id) ON DELETE CASCADE,
        alerts_enabled BOOLEAN NULL,
        min_stock NUMERIC(14,4) NULL CHECK (min_stock IS NULL OR min_stock >= 0),
        updated_by VARCHAR(255),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await conn.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_alert_overrides_unique
      ON ${schema}.inventory_alert_overrides (
        tenant_id,
        product_id,
        COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid)
      );
    `);
    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_inv_alert_overrides_tenant
      ON ${schema}.inventory_alert_overrides (tenant_id, product_id);
    `);

    // 4. Estado por episodio de stock bajo para evitar notificaciones duplicadas
    await conn.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.inventory_alert_states (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES ${schema}.tenants(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES ${schema}.services(id) ON DELETE CASCADE,
        location_id UUID NOT NULL REFERENCES ${schema}.inventory_locations(id) ON DELETE CASCADE,
        is_in_low_stock BOOLEAN NOT NULL DEFAULT FALSE,
        last_threshold NUMERIC(14,4),
        last_quantity NUMERIC(14,4),
        last_triggered_at TIMESTAMPTZ,
        resolved_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (tenant_id, product_id, location_id)
      );
    `);
    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_inv_alert_states_tenant
      ON ${schema}.inventory_alert_states (tenant_id, is_in_low_stock);
    `);

    await conn.query('COMMIT');
    return { success: true };
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { up };

