/**
 * Migración Fase 2B: Modelo de Inventario Multi-Tenant Real (Base y Pro)
 * 
 * ATENCIÓN: ESTE ARCHIVO DEFINE LA ESTRUCTURA DDL IDEMPOTENTE PARA POSTGRESQL.
 * ESTÁ TERMINANTEMENTE PROHIBIDO EJECUTAR ESTA MIGRACIÓN CONTRA LA BASE DE DATOS
 * OPERATIVA O SIN AUTORIZACIÓN EXPRESA DEL DBA EN INFRAESTRUCTURA DE PRUEBAS AISLADA.
 * 
 * Cumplimiento estricto:
 * 1. Toda tabla tenant-owned incluye `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`.
 * 2. Índices B-Tree con `tenant_id` como primera columna en todas las tablas.
 * 3. Restricciones UNIQUE y de integridad por tenant.
 * 4. Ledger inmutable de movimientos con idempotencia (`idempotency_key`).
 * 5. Control de transferencias multisucursal y órdenes de compra para el Plan PRO.
 */

async function up(client) {
  // 1. Catálogo Físico de Productos
  await client.query(`
    CREATE TABLE IF NOT EXISTS inventory_products (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      sku VARCHAR(100) NOT NULL,
      barcode VARCHAR(100),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      category VARCHAR(100) DEFAULT 'General',
      unit_of_measure VARCHAR(50) DEFAULT 'unit',
      sale_price NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
      cost NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
      tax_rate NUMERIC(6,4) NOT NULL DEFAULT 0.1800,
      min_stock NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
      track_stock BOOLEAN NOT NULL DEFAULT TRUE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT chk_inv_product_sale_price CHECK (sale_price >= 0),
      CONSTRAINT chk_inv_product_cost CHECK (cost >= 0),
      CONSTRAINT chk_inv_product_min_stock CHECK (min_stock >= 0),
      CONSTRAINT uq_inv_products_tenant_sku UNIQUE (tenant_id, sku)
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_products_tenant ON inventory_products(tenant_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_products_tenant_sku ON inventory_products(tenant_id, sku);`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_products_tenant_barcode ON inventory_products(tenant_id, barcode) WHERE barcode IS NOT NULL;`);

  // 2. Almacenes y Ubicaciones de Inventario
  await client.query(`
    CREATE TABLE IF NOT EXISTS inventory_locations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      salon_id VARCHAR(100) REFERENCES salons(id) ON DELETE SET NULL,
      name VARCHAR(150) NOT NULL,
      code VARCHAR(50),
      type VARCHAR(50) DEFAULT 'STORE',
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT uq_inv_locations_tenant_code UNIQUE (tenant_id, code)
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_locations_tenant ON inventory_locations(tenant_id);`);

  // 3. Balance de Existencias Actuales por Producto y Ubicación
  await client.query(`
    CREATE TABLE IF NOT EXISTS inventory_stock (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      product_id UUID NOT NULL REFERENCES inventory_products(id) ON DELETE CASCADE,
      location_id UUID NOT NULL REFERENCES inventory_locations(id) ON DELETE CASCADE,
      quantity NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
      average_cost NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
      last_movement_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT uq_inv_stock_tenant_prod_loc UNIQUE (tenant_id, product_id, location_id),
      CONSTRAINT chk_inv_stock_quantity CHECK (quantity >= 0),
      CONSTRAINT chk_inv_stock_avg_cost CHECK (average_cost >= 0)
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_stock_tenant ON inventory_stock(tenant_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_stock_tenant_prod_loc ON inventory_stock(tenant_id, product_id, location_id);`);

  // 4. Ledger Inmutable de Movimientos
  await client.query(`
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      product_id UUID NOT NULL REFERENCES inventory_products(id) ON DELETE CASCADE,
      location_id UUID NOT NULL REFERENCES inventory_locations(id) ON DELETE CASCADE,
      movement_type VARCHAR(50) NOT NULL,
      quantity NUMERIC(14,4) NOT NULL,
      unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
      total_cost NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
      balance_after NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
      reference_type VARCHAR(50),
      reference_id VARCHAR(100),
      idempotency_key VARCHAR(150),
      reason TEXT,
      user_id VARCHAR(100),
      user_name VARCHAR(150),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT chk_inv_movement_quantity_nonzero CHECK (quantity != 0),
      CONSTRAINT chk_inv_movement_unit_cost CHECK (unit_cost >= 0),
      CONSTRAINT uq_inv_movements_tenant_idempotency UNIQUE (tenant_id, idempotency_key)
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_movements_tenant ON inventory_movements(tenant_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_movements_tenant_prod ON inventory_movements(tenant_id, product_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_movements_tenant_idempotency ON inventory_movements(tenant_id, idempotency_key);`);

  // 5. Directorio de Proveedores (Plan PRO)
  await client.query(`
    CREATE TABLE IF NOT EXISTS inventory_suppliers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name VARCHAR(200) NOT NULL,
      rnc_tax_id VARCHAR(50),
      contact_name VARCHAR(150),
      phone VARCHAR(50),
      email VARCHAR(150),
      address TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_suppliers_tenant ON inventory_suppliers(tenant_id);`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_suppliers_tenant_rnc ON inventory_suppliers(tenant_id, rnc_tax_id) WHERE rnc_tax_id IS NOT NULL;`);

  // 6. Órdenes de Compra (Plan PRO)
  await client.query(`
    CREATE TABLE IF NOT EXISTS inventory_purchase_orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      supplier_id UUID NOT NULL REFERENCES inventory_suppliers(id) ON DELETE RESTRICT,
      location_id UUID NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
      order_number VARCHAR(100) NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
      total_amount NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
      notes TEXT,
      created_by VARCHAR(100),
      approved_by VARCHAR(100),
      approved_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT uq_inv_po_tenant_number UNIQUE (tenant_id, order_number),
      CONSTRAINT chk_inv_po_status CHECK (status IN ('DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED'))
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_po_tenant ON inventory_purchase_orders(tenant_id);`);

  // 7. Renglones de Órdenes de Compra (Plan PRO)
  await client.query(`
    CREATE TABLE IF NOT EXISTS inventory_purchase_order_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      purchase_order_id UUID NOT NULL REFERENCES inventory_purchase_orders(id) ON DELETE CASCADE,
      product_id UUID NOT NULL REFERENCES inventory_products(id) ON DELETE RESTRICT,
      quantity_ordered NUMERIC(14,4) NOT NULL,
      quantity_received NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
      unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
      total_cost NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
      CONSTRAINT chk_inv_poi_qty_ordered CHECK (quantity_ordered > 0),
      CONSTRAINT chk_inv_poi_qty_received CHECK (quantity_received >= 0),
      CONSTRAINT chk_inv_poi_qty_max CHECK (quantity_received <= quantity_ordered)
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_poi_tenant ON inventory_purchase_order_items(tenant_id);`);

  // 8. Transferencias Multisucursal / Multialmacén (Plan PRO)
  await client.query(`
    CREATE TABLE IF NOT EXISTS inventory_transfers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      transfer_number VARCHAR(100) NOT NULL,
      source_location_id UUID NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
      destination_location_id UUID NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
      status VARCHAR(50) NOT NULL DEFAULT 'REQUESTED',
      notes TEXT,
      requested_by VARCHAR(100),
      dispatched_by VARCHAR(100),
      received_by VARCHAR(100),
      dispatched_at TIMESTAMP WITH TIME ZONE,
      received_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT chk_inv_transfer_diff_loc CHECK (source_location_id != destination_location_id),
      CONSTRAINT uq_inv_transfers_tenant_number UNIQUE (tenant_id, transfer_number),
      CONSTRAINT chk_inv_transfer_status CHECK (status IN ('REQUESTED', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'CANCELLED'))
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_transfers_tenant ON inventory_transfers(tenant_id);`);

  // 9. Renglones de Transferencias Multisucursal (Plan PRO)
  await client.query(`
    CREATE TABLE IF NOT EXISTS inventory_transfer_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      transfer_id UUID NOT NULL REFERENCES inventory_transfers(id) ON DELETE CASCADE,
      product_id UUID NOT NULL REFERENCES inventory_products(id) ON DELETE RESTRICT,
      quantity_requested NUMERIC(14,4) NOT NULL,
      quantity_transferred NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
      CONSTRAINT chk_inv_ti_qty_req CHECK (quantity_requested > 0),
      CONSTRAINT chk_inv_ti_qty_trans CHECK (quantity_transferred >= 0)
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_inv_transfer_items_tenant ON inventory_transfer_items(tenant_id);`);
}

async function down(client) {
  await client.query(`DROP TABLE IF EXISTS inventory_transfer_items CASCADE;`);
  await client.query(`DROP TABLE IF EXISTS inventory_transfers CASCADE;`);
  await client.query(`DROP TABLE IF EXISTS inventory_purchase_order_items CASCADE;`);
  await client.query(`DROP TABLE IF EXISTS inventory_purchase_orders CASCADE;`);
  await client.query(`DROP TABLE IF EXISTS inventory_suppliers CASCADE;`);
  await client.query(`DROP TABLE IF EXISTS inventory_movements CASCADE;`);
  await client.query(`DROP TABLE IF EXISTS inventory_stock CASCADE;`);
  await client.query(`DROP TABLE IF EXISTS inventory_locations CASCADE;`);
  await client.query(`DROP TABLE IF EXISTS inventory_products CASCADE;`);
}

module.exports = { up, down };

