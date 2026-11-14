/**
 * Migración Idempotente: Catálogo Único (services) como fuente canónica de Productos y Servicios
 *
 * - Agrega columnas comerciales de producto en `services`:
 *   item_type ('SERVICIO' | 'PRODUCTO'), sku, barcode, unit_of_measure, tax_rate, min_stock, track_stock, updated_at.
 * - Reconcilia registros de `inventory_products` hacia `services` preservando su UUID `id`
 *   o vinculando por SKU / Barcode verificable dentro del mismo tenant (NUNCA por nombre).
 * - Reporta casos ambiguos sin fusionar automáticamente.
 * - Reapunta las FKs de inventario (stock, movimientos, compras, transferencias, toma física) hacia `services(id)`.
 */

const FK_TABLES = [
  { table: 'inventory_stock', constraint: 'inventory_stock_product_id_fkey', onDelete: 'CASCADE' },
  { table: 'inventory_movements', constraint: 'inventory_movements_product_id_fkey', onDelete: 'CASCADE' },
  { table: 'inventory_purchase_order_items', constraint: 'inventory_purchase_order_items_product_id_fkey', onDelete: 'RESTRICT' },
  { table: 'inventory_transfer_items', constraint: 'inventory_transfer_items_product_id_fkey', onDelete: 'RESTRICT' },
  { table: 'inventory_physical_session_items', constraint: 'inventory_physical_session_items_product_id_fkey', onDelete: 'CASCADE' },
];

async function up(targetPool) {
  const conn = await targetPool.getConnection();
  const ambiguousCases = [];

  try {
    await conn.beginTransaction();

    // 1. Extender `services` con columnas de producto canónico
    await conn.query(`
      ALTER TABLE services
        ADD COLUMN IF NOT EXISTS item_type VARCHAR(20) NOT NULL DEFAULT 'SERVICIO',
        ADD COLUMN IF NOT EXISTS sku VARCHAR(100),
        ADD COLUMN IF NOT EXISTS barcode VARCHAR(100),
        ADD COLUMN IF NOT EXISTS unit_of_measure VARCHAR(50) NOT NULL DEFAULT 'unit',
        ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(6,4) NOT NULL DEFAULT 0.1800,
        ADD COLUMN IF NOT EXISTS min_stock NUMERIC(14,4) NOT NULL DEFAULT 0.0000,
        ADD COLUMN IF NOT EXISTS track_stock BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
    `);

    await conn.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_services_item_type'
        ) THEN
          ALTER TABLE services
            ADD CONSTRAINT chk_services_item_type CHECK (item_type IN ('SERVICIO', 'PRODUCTO'));
        END IF;
      END $$;
    `);

    await conn.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_services_tenant_sku
        ON services (tenant_id, sku)
        WHERE sku IS NOT NULL AND sku <> ''
    `);

    await conn.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_services_tenant_barcode
        ON services (tenant_id, barcode)
        WHERE barcode IS NOT NULL AND barcode <> ''
    `);

    // 2. Marcar como PRODUCTO ítems del catálogo ya clasificados en categoría Productos
    await conn.query(`
      UPDATE services
      SET item_type = 'PRODUCTO',
          track_stock = TRUE,
          updated_at = NOW()
      WHERE LOWER(COALESCE(categoria, category, '')) IN ('productos', 'producto')
        AND item_type = 'SERVICIO'
    `);

    // 3. Reconciliar filas existentes de `inventory_products` hacia `services`
    const [invTableExists] = await conn.query(`
      SELECT to_regclass('public.inventory_products') AS tbl
    `);

    if (invTableExists && invTableExists[0] && invTableExists[0].tbl) {
      const [invRows] = await conn.query('SELECT * FROM inventory_products ORDER BY created_at ASC');

      for (const p of invRows || []) {
        // Verificar si ya existe por mismo UUID
        const [byId] = await conn.query(
          'SELECT id FROM services WHERE id = ? AND tenant_id = ? LIMIT 1',
          [p.id, p.tenant_id]
        );
        if (byId.length > 0) {
          await conn.query(`
            UPDATE services
            SET item_type = 'PRODUCTO',
                sku = COALESCE(NULLIF(sku, ''), ?),
                barcode = COALESCE(NULLIF(barcode, ''), ?),
                unit_of_measure = COALESCE(NULLIF(unit_of_measure, ''), ?),
                tax_rate = COALESCE(tax_rate, ?),
                min_stock = COALESCE(min_stock, ?),
                track_stock = COALESCE(track_stock, ?),
                updated_at = NOW()
            WHERE id = ? AND tenant_id = ?
          `, [
            p.sku || null,
            p.barcode || null,
            p.unit_of_measure || 'unit',
            p.tax_rate ?? 0.18,
            p.min_stock ?? 0,
            p.track_stock !== false,
            p.id,
            p.tenant_id,
          ]);
          continue;
        }

        // Detectar colisión ambigua por mismo nombre sin SKU/barcode coincidente (solo reportar, no fusionar)
        const [sameNameRows] = await conn.query(
          `SELECT id, nombre, name, sku, barcode FROM services
           WHERE tenant_id = ? AND LOWER(TRIM(COALESCE(nombre, name, ''))) = LOWER(TRIM(?))`,
          [p.tenant_id, p.name || '']
        );
        if (sameNameRows.length > 0) {
          ambiguousCases.push({
            tenant_id: p.tenant_id,
            inventory_product_id: p.id,
            inventory_sku: p.sku,
            name: p.name,
            matching_service_ids: sameNameRows.map((r) => r.id),
            reason: 'Mismo nombre sin SKU/código de barras verificable; preservado con su UUID original sin fusionar.',
          });
        }

        // Verificar unicidad de SKU/barcode antes de insertar con su UUID original
        let targetSku = p.sku ? String(p.sku).trim() : null;
        if (targetSku) {
          const [skuCollision] = await conn.query(
            'SELECT id FROM services WHERE tenant_id = ? AND sku = ? LIMIT 1',
            [p.tenant_id, targetSku]
          );
          if (skuCollision.length > 0) {
            ambiguousCases.push({
              tenant_id: p.tenant_id,
              inventory_product_id: p.id,
              inventory_sku: targetSku,
              reason: 'Colisión de SKU en services; se conserva referencia histórica sin sobrescribir.',
            });
            targetSku = `${targetSku}-INV-${String(p.id).slice(0, 6)}`;
          }
        }

        let targetBarcode = p.barcode ? String(p.barcode).trim() : null;
        if (targetBarcode) {
          const [bcCollision] = await conn.query(
            'SELECT id FROM services WHERE tenant_id = ? AND barcode = ? LIMIT 1',
            [p.tenant_id, targetBarcode]
          );
          if (bcCollision.length > 0) {
            ambiguousCases.push({
              tenant_id: p.tenant_id,
              inventory_product_id: p.id,
              inventory_barcode: targetBarcode,
              reason: 'Colisión de barcode en services; se conserva referencia histórica.',
            });
            targetBarcode = null;
          }
        }

        await conn.query(`
          INSERT INTO services (
            id, tenant_id, name, nombre, description, descripcion,
            categoria, category, subcategoria,
            price, precio, costo, duration_minutes, duracion,
            activo, is_active, item_type, sku, barcode,
            unit_of_measure, tax_rate, min_stock, track_stock,
            created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, 'General',
            ?, ?, ?, 0, 0,
            ?, ?, 'PRODUCTO', ?, ?,
            ?, ?, ?, ?,
            COALESCE(?, NOW()), NOW()
          )
          ON CONFLICT (id) DO NOTHING
        `, [
          p.id,
          p.tenant_id,
          p.name,
          p.name,
          p.description || null,
          p.description || null,
          p.category || 'Productos',
          p.category || 'Productos',
          Number(p.sale_price) || 0,
          Number(p.sale_price) || 0,
          Number(p.cost) || 0,
          p.is_active !== false ? 1 : 0,
          p.is_active !== false,
          targetSku,
          targetBarcode,
          p.unit_of_measure || 'unit',
          p.tax_rate ?? 0.18,
          Number(p.min_stock) || 0,
          p.track_stock !== false,
          p.created_at || null,
        ]);
      }
    }

    // 4. Reapuntar FKs de las tablas de inventario hacia `services(id)`
    for (const fk of FK_TABLES) {
      await conn.query(`
        DO $$
        BEGIN
          IF to_regclass('public.${fk.table}') IS NOT NULL THEN
            IF EXISTS (
              SELECT 1 FROM pg_constraint WHERE conname = '${fk.constraint}'
            ) THEN
              ALTER TABLE ${fk.table} DROP CONSTRAINT ${fk.constraint};
            END IF;
            ALTER TABLE ${fk.table}
              ADD CONSTRAINT ${fk.constraint}
              FOREIGN KEY (product_id) REFERENCES services(id) ON DELETE ${fk.onDelete};
          END IF;
        END $$;
      `);
    }

    await conn.commit();
    return { success: true, ambiguousCases };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { up };
