/**
 * Repositorio de Inventario y Catálogo de Productos (Base y Pro)
 * Toda consulta tenant-owned incluye obligatoriamente tenant_id.
 */

class InventoryRepository {
  constructor(pool = null) {
    this.pool = pool;
  }

  async createProduct(tenantId, productData) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    const {
      sku, barcode, name, description, category, unit_of_measure,
      sale_price, cost, tax_rate, min_stock, track_stock, is_active
    } = productData;

    if (!sku || !name) throw new Error('sku y name son obligatorios');

    if (this.pool) {
      const [result] = await this.pool.query(`
        INSERT INTO inventory_products (
          tenant_id, sku, barcode, name, description, category, unit_of_measure,
          sale_price, cost, tax_rate, min_stock, track_stock, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        RETURNING *
      `, [
        tenantId, sku.trim(), barcode ? barcode.trim() : null, name.trim(),
        description || null, category || 'General', unit_of_measure || 'unit',
        Number(sale_price) || 0, Number(cost) || 0, Number(tax_rate ?? 0.18),
        Number(min_stock) || 0, track_stock !== false, is_active !== false
      ]);
      return result[0];
    }
    return null;
  }

  async updateProduct(tenantId, productId, updateData) {
    if (!tenantId || !productId) throw new Error('tenant_id y productId son requeridos');

    if (this.pool) {
      const fields = [];
      const values = [];

      const allowedFields = [
        'name', 'description', 'category', 'unit_of_measure',
        'sale_price', 'cost', 'tax_rate', 'min_stock', 'track_stock', 'is_active', 'barcode'
      ];

      for (const key of allowedFields) {
        if (updateData[key] !== undefined) {
          fields.push(`${key} = ?`);
          values.push(updateData[key]);
        }
      }

      if (fields.length === 0) return this.getProductById(tenantId, productId);

      fields.push('updated_at = NOW()');
      values.push(productId, tenantId);

      const [result] = await this.pool.query(`
        UPDATE inventory_products
        SET ${fields.join(', ')}
        WHERE id = ? AND tenant_id = ?
        RETURNING *
      `, values);

      return result[0] || null;
    }
    return null;
  }

  _mapServiceToProduct(row) {
    if (!row) return null;
    const isActive =
      row.is_active !== undefined && row.is_active !== null
        ? Boolean(row.is_active)
        : Number(row.activo ?? 1) === 1;
    return {
      ...row,
      name: row.nombre || row.name || 'Producto',
      description: row.descripcion || row.description || null,
      category: row.categoria || row.category || 'Productos',
      sale_price: Number(row.precio ?? row.price ?? row.sale_price ?? 0),
      cost: Number(row.costo ?? row.cost ?? 0),
      unit_of_measure: row.unit_of_measure || 'unit',
      tax_rate: row.tax_rate !== undefined && row.tax_rate !== null ? Number(row.tax_rate) : 0.18,
      min_stock: Number(row.min_stock ?? 0),
      track_stock: row.track_stock !== undefined && row.track_stock !== null ? Boolean(row.track_stock) : true,
      is_active: isActive,
      item_type: row.item_type || 'PRODUCTO',
      sku: row.sku || null,
      barcode: row.barcode || null,
    };
  }

  async getProductById(tenantId, productId) {
    if (!tenantId || !productId) throw new Error('tenant_id y productId son requeridos');
    if (this.pool) {
      const [rows] = await this.pool.query(
        "SELECT * FROM services WHERE id = ? AND tenant_id = ? AND item_type = 'PRODUCTO' LIMIT 1",
        [productId, tenantId]
      );
      return this._mapServiceToProduct(rows[0] || null);
    }
    return null;
  }

  async getProductBySku(tenantId, sku) {
    if (!tenantId || !sku) throw new Error('tenant_id y sku son requeridos');
    if (this.pool) {
      const [rows] = await this.pool.query(
        "SELECT * FROM services WHERE sku = ? AND tenant_id = ? AND item_type = 'PRODUCTO' LIMIT 1",
        [sku.trim(), tenantId]
      );
      return this._mapServiceToProduct(rows[0] || null);
    }
    return null;
  }

  async getProductByBarcode(tenantId, barcode) {
    if (!tenantId || !barcode) throw new Error('tenant_id y barcode son requeridos');
    if (this.pool) {
      const [rows] = await this.pool.query(
        "SELECT * FROM services WHERE barcode = ? AND tenant_id = ? AND item_type = 'PRODUCTO' LIMIT 1",
        [barcode.trim(), tenantId]
      );
      return this._mapServiceToProduct(rows[0] || null);
    }
    return null;
  }

  async listProducts(tenantId, { search, category, activeOnly, limit = 50, offset = 0 } = {}) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    if (this.pool) {
      let sql = "SELECT * FROM services WHERE tenant_id = ? AND item_type = 'PRODUCTO'";
      const params = [tenantId];

      if (activeOnly) {
        sql += ' AND COALESCE(is_active, TRUE) = TRUE AND COALESCE(activo, 1) = 1';
      }
      if (category && category !== 'Todas') {
        sql += ' AND COALESCE(categoria, category) = ?';
        params.push(category);
      }
      if (search) {
        sql += " AND (COALESCE(nombre, name, '') ILIKE ? OR COALESCE(sku, '') ILIKE ? OR COALESCE(barcode, '') ILIKE ?)";
        const term = `%${search}%`;
        params.push(term, term, term);
      }

      sql += " ORDER BY COALESCE(nombre, name, '') ASC LIMIT ? OFFSET ?";
      params.push(Number(limit), Number(offset));

      const [rows] = await this.pool.query(sql, params);
      return (rows || []).map((r) => this._mapServiceToProduct(r));
    }
    return [];
  }

  async getOrCreateDefaultLocation(tenantId, salonId = null) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    if (this.pool) {
      const [rows] = await this.pool.query(
        'SELECT * FROM inventory_locations WHERE tenant_id = ? AND is_default = TRUE LIMIT 1',
        [tenantId]
      );
      if (rows && rows.length > 0) return rows[0];

      // Crear ubicación principal por defecto
      const [created] = await this.pool.query(`
        INSERT INTO inventory_locations (tenant_id, salon_id, name, code, type, is_default, is_active, created_at, updated_at)
        VALUES (?, ?, 'Almacén Principal', 'LOC-MAIN', 'STORE', TRUE, TRUE, NOW(), NOW())
        RETURNING *
      `, [tenantId, salonId]);
      return created[0];
    }
    return null;
  }

  async getLocationById(tenantId, locationId) {
    if (!tenantId || !locationId) throw new Error('tenant_id y locationId son requeridos');
    if (this.pool) {
      const [rows] = await this.pool.query(
        'SELECT * FROM inventory_locations WHERE id = ? AND tenant_id = ? LIMIT 1',
        [locationId, tenantId]
      );
      return rows[0] || null;
    }
    return null;
  }

  async listLocations(tenantId) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    if (this.pool) {
      const [rows] = await this.pool.query(
        'SELECT * FROM inventory_locations WHERE tenant_id = ? AND is_active = TRUE ORDER BY is_default DESC, name ASC',
        [tenantId]
      );
      return rows || [];
    }
    return [];
  }

  async createLocation(tenantId, locationData) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    const { name, code, type, salon_id, is_default } = locationData;
    if (!name) throw new Error('name es requerido');

    if (this.pool) {
      const [created] = await this.pool.query(`
        INSERT INTO inventory_locations (tenant_id, salon_id, name, code, type, is_default, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, TRUE, NOW(), NOW())
        RETURNING *
      `, [tenantId, salon_id || null, name.trim(), code ? code.trim() : null, type || 'STORE', Boolean(is_default)]);
      return created[0];
    }
    return null;
  }

  async getStock(tenantId, productId, locationId) {
    if (!tenantId || !productId || !locationId) throw new Error('tenant_id, productId y locationId son requeridos');
    if (this.pool) {
      const [rows] = await this.pool.query(
        'SELECT * FROM inventory_stock WHERE tenant_id = ? AND product_id = ? AND location_id = ? LIMIT 1',
        [tenantId, productId, locationId]
      );
      if (rows && rows[0]) {
        return {
          ...rows[0],
          quantity: Number(rows[0].quantity) || 0,
          average_cost: Number(rows[0].average_cost) || 0
        };
      }
      return { tenant_id: tenantId, product_id: productId, location_id: locationId, quantity: 0, average_cost: 0 };
    }
    return { tenant_id: tenantId, product_id: productId, location_id: locationId, quantity: 0, average_cost: 0 };
  }

  async listStock(tenantId, { locationId, lowStockOnly = false, limit = 100, offset = 0 } = {}) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    if (this.pool) {
      let sql = `
        SELECT s.*, p.sku, COALESCE(p.nombre, p.name) as product_name,
               COALESCE(p.categoria, p.category, 'Productos') as category,
               p.unit_of_measure,
               COALESCE(iao_loc.min_stock, iao_prod.min_stock, ias.default_min_stock, 5) AS min_stock,
               COALESCE(iao_loc.alerts_enabled, iao_prod.alerts_enabled, ias.alerts_enabled, TRUE) AS alerts_enabled,
               CASE
                 WHEN iao_loc.min_stock IS NOT NULL THEN 'location'
                 WHEN iao_prod.min_stock IS NOT NULL THEN 'product'
                 ELSE 'general'
               END AS threshold_source,
               COALESCE(p.precio, p.price, 0) as sale_price,
               l.name as location_name
        FROM inventory_stock s
        INNER JOIN services p ON s.product_id = p.id AND s.tenant_id = p.tenant_id AND p.item_type = 'PRODUCTO'
        INNER JOIN inventory_locations l ON s.location_id = l.id AND s.tenant_id = l.tenant_id
        LEFT JOIN inventory_alert_settings ias ON ias.tenant_id = s.tenant_id
        LEFT JOIN inventory_alert_overrides iao_loc
          ON iao_loc.tenant_id = s.tenant_id AND iao_loc.product_id = s.product_id AND iao_loc.location_id = s.location_id
        LEFT JOIN inventory_alert_overrides iao_prod
          ON iao_prod.tenant_id = s.tenant_id AND iao_prod.product_id = s.product_id AND iao_prod.location_id IS NULL
        WHERE s.tenant_id = ?
      `;
      const params = [tenantId];
      if (locationId) {
        sql += ' AND s.location_id = ?';
        params.push(locationId);
      }
      if (lowStockOnly) {
        sql += ' AND COALESCE(iao_loc.alerts_enabled, iao_prod.alerts_enabled, ias.alerts_enabled, TRUE) = TRUE AND s.quantity <= COALESCE(iao_loc.min_stock, iao_prod.min_stock, ias.default_min_stock, 5)';
      }
      sql += " ORDER BY COALESCE(p.nombre, p.name) ASC LIMIT ? OFFSET ?";
      params.push(Number(limit), Number(offset));

      const [rows] = await this.pool.query(sql, params);
      return rows || [];
    }
    return [];
  }

  async getMovementByIdempotencyKey(tenantId, idempotencyKey) {
    if (!tenantId || !idempotencyKey) return null;
    if (this.pool) {
      const [rows] = await this.pool.query(
        'SELECT * FROM inventory_movements WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1',
        [tenantId, idempotencyKey]
      );
      return rows[0] || null;
    }
    return null;
  }

  async recordMovement(tenantId, movementData) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    const {
      product_id, location_id, movement_type, quantity, unit_cost, total_cost,
      balance_after, reference_type, reference_id, idempotency_key, reason, user_id, user_name
    } = movementData;

    if (!product_id || !location_id || !movement_type || quantity === 0) {
      throw new Error('Parámetros de movimiento incompletos o cantidad cero');
    }

    if (this.pool) {
      const [created] = await this.pool.query(`
        INSERT INTO inventory_movements (
          tenant_id, product_id, location_id, movement_type, quantity, unit_cost, total_cost,
          balance_after, reference_type, reference_id, idempotency_key, reason, user_id, user_name, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        RETURNING *
      `, [
        tenantId, product_id, location_id, movement_type, Number(quantity),
        Number(unit_cost) || 0, Number(total_cost) || 0, Number(balance_after) || 0,
        reference_type || null, reference_id || null, idempotency_key || null,
        reason || null, user_id || null, user_name || null
      ]);
      return created[0];
    }
    return null;
  }

  async updateStockBalance(tenantId, productId, locationId, newQuantity, newAvgCost) {
    if (!tenantId || !productId || !locationId) throw new Error('tenant_id, productId y locationId son requeridos');
    if (newQuantity < 0) throw new Error('El stock no puede ser negativo');

    if (this.pool) {
      const [result] = await this.pool.query(`
        INSERT INTO inventory_stock (tenant_id, product_id, location_id, quantity, average_cost, last_movement_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NOW(), NOW())
        ON CONFLICT (tenant_id, product_id, location_id) DO UPDATE SET
          quantity = EXCLUDED.quantity,
          average_cost = EXCLUDED.average_cost,
          last_movement_at = NOW(),
          updated_at = NOW()
        RETURNING *
      `, [tenantId, productId, locationId, Number(newQuantity), Number(newAvgCost) || 0]);
      return result[0];
    }
    return null;
  }

  /**
   * Atomic, serializable deduction of inventory for POS sale (REM-P1-18)
   * Uses SELECT ... FOR UPDATE with lock_timeout and automatic retry on contention.
   */
  async executeAtomicSaleDeduction(tenantId, { productId, locationId, quantity, visitId, lineId = null, userId = null, userName = null }) {
    if (!tenantId || !productId || !locationId) throw new Error('tenantId, productId y locationId son requeridos');
    const qty = Number(quantity);
    if (qty <= 0) return { skipped: true };

    const idempotencyKey = `sale:${visitId}:${productId}${lineId ? `:${lineId}` : ''}`;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const conn = await this.pool.getConnection();
      try {
        await conn.query('BEGIN');
        await conn.query("SET LOCAL lock_timeout = '5s'");

        // 1. Check idempotency under transaction lock
        const [existingMovements] = await conn.query(
          'SELECT * FROM inventory_movements WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1 FOR UPDATE',
          [tenantId, idempotencyKey]
        );

        if (existingMovements && existingMovements.length > 0) {
          await conn.query('COMMIT');
          return {
            idempotent: true,
            movement: existingMovements[0],
            message: 'Descuento de inventario previamente procesado'
          };
        }

        // 2. Lock stock row FOR UPDATE (enforces single-threaded deduction on this item)
        const [stockRows] = await conn.query(
          'SELECT * FROM inventory_stock WHERE tenant_id = ? AND product_id = ? AND location_id = ? LIMIT 1 FOR UPDATE',
          [tenantId, productId, locationId]
        );

        const currentStock = stockRows && stockRows.length > 0
          ? stockRows[0]
          : { quantity: 0, average_cost: 0 };

        const available = Number(currentStock.quantity) || 0;
        if (available < qty) {
          await conn.query('ROLLBACK');
          const err = new Error(`Stock insuficiente. Disponible: ${available}, Requerido: ${qty}`);
          err.code = 'INSUFFICIENT_STOCK';
          err.available = available;
          err.required = qty;
          throw err;
        }

        const newQty = available - qty;
        if (newQty < 0) {
          await conn.query('ROLLBACK');
          const err = new Error(`Stock insuficiente (resultado negativo prevenido)`);
          err.code = 'INSUFFICIENT_STOCK';
          err.available = available;
          err.required = qty;
          throw err;
        }

        const avgCost = Number(currentStock.average_cost) || 0;

        // 3. Record movement
        const [movementResult] = await conn.query(`
          INSERT INTO inventory_movements (
            tenant_id, product_id, location_id, movement_type, quantity, unit_cost, total_cost,
            balance_after, reference_type, reference_id, idempotency_key, reason, user_id, user_name, created_at
          ) VALUES (?, ?, ?, 'SALE', ?, ?, ?, ?, 'VISIT_SALE', ?, ?, ?, ?, ?, NOW())
          RETURNING *
        `, [
          tenantId, productId, locationId, -qty,
          avgCost, qty * avgCost, newQty,
          String(visitId), idempotencyKey,
          `Venta POS Ticket/Visita #${visitId}`,
          userId || null, userName || null
        ]);

        // 4. Update stock balance
        await conn.query(`
          INSERT INTO inventory_stock (tenant_id, product_id, location_id, quantity, average_cost, last_movement_at, updated_at)
          VALUES (?, ?, ?, ?, ?, NOW(), NOW())
          ON CONFLICT (tenant_id, product_id, location_id) DO UPDATE SET
            quantity = EXCLUDED.quantity,
            average_cost = EXCLUDED.average_cost,
            last_movement_at = NOW(),
            updated_at = NOW()
        `, [tenantId, productId, locationId, newQty, avgCost]);

        await conn.query('COMMIT');

        return {
          success: true,
          movement: movementResult[0],
          previous_stock: available,
          new_stock: newQty
        };
      } catch (err) {
        try { await conn.query('ROLLBACK'); } catch (_) {}
        const isRetryable = err.code === '40001' || err.code === '40P01' || err.code === '55P03';
        if (isRetryable && attempt < maxRetries) {
          const jitter = Math.floor(Math.random() * 50) + attempt * 25;
          await new Promise(r => setTimeout(r, jitter));
          continue;
        }
        throw err;
      } finally {
        conn.release();
      }
    }
  }

  /**
   * Atomic reversal of inventory deduction for POS void (REM-P1-18)
   */
  async executeAtomicSaleVoid(tenantId, { productId, locationId, quantity, visitId, lineId = null, userId = null, userName = null, reason = 'Anulación de venta POS' }) {
    if (!tenantId || !productId || !locationId) throw new Error('tenantId, productId y locationId son requeridos');
    const qty = Number(quantity);
    if (qty <= 0) return { skipped: true };

    const idempotencyKey = `void:sale:${visitId}:${productId}${lineId ? `:${lineId}` : ''}`;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const conn = await this.pool.getConnection();
      try {
        await conn.query('BEGIN');
        await conn.query("SET LOCAL lock_timeout = '5s'");

        // 1. Check idempotency (prevent double reversal)
        const [existingVoid] = await conn.query(
          'SELECT * FROM inventory_movements WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1 FOR UPDATE',
          [tenantId, idempotencyKey]
        );

        if (existingVoid && existingVoid.length > 0) {
          await conn.query('COMMIT');
          return {
            idempotent: true,
            movement: existingVoid[0],
            message: 'Reversión de inventario previamente procesada'
          };
        }

        // 2. Lock stock row FOR UPDATE
        const [stockRows] = await conn.query(
          'SELECT * FROM inventory_stock WHERE tenant_id = ? AND product_id = ? AND location_id = ? LIMIT 1 FOR UPDATE',
          [tenantId, productId, locationId]
        );

        const currentStock = stockRows && stockRows.length > 0
          ? stockRows[0]
          : { quantity: 0, average_cost: 0 };

        const available = Number(currentStock.quantity) || 0;
        const newQty = available + qty;
        const avgCost = Number(currentStock.average_cost) || 0;

        // 3. Record void movement
        const [movementResult] = await conn.query(`
          INSERT INTO inventory_movements (
            tenant_id, product_id, location_id, movement_type, quantity, unit_cost, total_cost,
            balance_after, reference_type, reference_id, idempotency_key, reason, user_id, user_name, created_at
          ) VALUES (?, ?, ?, 'SALE_VOID', ?, ?, ?, ?, 'VISIT_VOID', ?, ?, ?, ?, ?, NOW())
          RETURNING *
        `, [
          tenantId, productId, locationId, qty,
          avgCost, qty * avgCost, newQty,
          String(visitId), idempotencyKey,
          reason,
          userId || null, userName || null
        ]);

        // 4. Update stock balance
        await conn.query(`
          INSERT INTO inventory_stock (tenant_id, product_id, location_id, quantity, average_cost, last_movement_at, updated_at)
          VALUES (?, ?, ?, ?, ?, NOW(), NOW())
          ON CONFLICT (tenant_id, product_id, location_id) DO UPDATE SET
            quantity = EXCLUDED.quantity,
            average_cost = EXCLUDED.average_cost,
            last_movement_at = NOW(),
            updated_at = NOW()
        `, [tenantId, productId, locationId, newQty, avgCost]);

        await conn.query('COMMIT');

        return {
          success: true,
          movement: movementResult[0],
          previous_stock: available,
          new_stock: newQty
        };
      } catch (err) {
        try { await conn.query('ROLLBACK'); } catch (_) {}
        const isRetryable = err.code === '40001' || err.code === '40P01' || err.code === '55P03';
        if (isRetryable && attempt < maxRetries) {
          const jitter = Math.floor(Math.random() * 50) + attempt * 25;
          await new Promise(r => setTimeout(r, jitter));
          continue;
        }
        throw err;
      } finally {
        conn.release();
      }
    }
  }

  async listMovements(tenantId, { productId, locationId, movementType, limit = 50, offset = 0 } = {}) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    if (this.pool) {
      let sql = `
        SELECT m.*, COALESCE(p.nombre, p.name) as product_name, p.sku, l.name as location_name
        FROM inventory_movements m
        INNER JOIN services p ON m.product_id = p.id AND m.tenant_id = p.tenant_id AND p.item_type = 'PRODUCTO'
        INNER JOIN inventory_locations l ON m.location_id = l.id AND m.tenant_id = l.tenant_id
        WHERE m.tenant_id = ?
      `;
      const params = [tenantId];
      if (productId) {
        sql += ' AND m.product_id = ?';
        params.push(productId);
      }
      if (locationId) {
        sql += ' AND m.location_id = ?';
        params.push(locationId);
      }
      if (movementType) {
        sql += ' AND m.movement_type = ?';
        params.push(movementType);
      }
      sql += ' ORDER BY m.created_at DESC LIMIT ? OFFSET ?';
      params.push(Number(limit), Number(offset));

      const [rows] = await this.pool.query(sql, params);
      return rows || [];
    }
    return [];
  }

  async getLowStockAlerts(tenantId, locationId = null) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    if (this.pool) {
      let sql = `
        SELECT p.id as product_id, p.sku, COALESCE(p.nombre, p.name) as product_name,
               COALESCE(p.categoria, p.category, 'Productos') as category,
               COALESCE(iao_loc.min_stock, iao_prod.min_stock, ias.default_min_stock, 5) AS min_stock,
               COALESCE(iao_loc.alerts_enabled, iao_prod.alerts_enabled, ias.alerts_enabled, TRUE) AS alerts_enabled,
               CASE
                 WHEN iao_loc.min_stock IS NOT NULL THEN 'location'
                 WHEN iao_prod.min_stock IS NOT NULL THEN 'product'
                 ELSE 'general'
               END AS threshold_source,
               COALESCE(SUM(s.quantity), 0) as current_stock,
               l.name as location_name, l.id as location_id
        FROM services p
        LEFT JOIN inventory_stock s ON p.id = s.product_id AND p.tenant_id = s.tenant_id
        LEFT JOIN inventory_locations l ON s.location_id = l.id AND s.tenant_id = l.tenant_id
        LEFT JOIN inventory_alert_settings ias ON ias.tenant_id = p.tenant_id
        LEFT JOIN inventory_alert_overrides iao_loc
          ON iao_loc.tenant_id = p.tenant_id AND iao_loc.product_id = p.id AND iao_loc.location_id = s.location_id
        LEFT JOIN inventory_alert_overrides iao_prod
          ON iao_prod.tenant_id = p.tenant_id AND iao_prod.product_id = p.id AND iao_prod.location_id IS NULL
        WHERE p.tenant_id = ? AND p.item_type = 'PRODUCTO' AND p.track_stock = TRUE
          AND COALESCE(p.is_active, TRUE) = TRUE AND COALESCE(p.activo, 1) = 1
      `;
      const params = [tenantId];
      if (locationId) {
        sql += ' AND s.location_id = ?';
        params.push(locationId);
      }
      sql += `
        GROUP BY p.id, p.sku, p.nombre, p.name, p.categoria, p.category, l.name, l.id,
                 iao_loc.min_stock, iao_prod.min_stock, ias.default_min_stock,
                 iao_loc.alerts_enabled, iao_prod.alerts_enabled, ias.alerts_enabled
        HAVING COALESCE(iao_loc.alerts_enabled, iao_prod.alerts_enabled, ias.alerts_enabled, TRUE) = TRUE
           AND COALESCE(SUM(s.quantity), 0) <= COALESCE(iao_loc.min_stock, iao_prod.min_stock, ias.default_min_stock, 5)
        ORDER BY (COALESCE(SUM(s.quantity), 0) - COALESCE(iao_loc.min_stock, iao_prod.min_stock, ias.default_min_stock, 5)) ASC
      `;
      const [rows] = await this.pool.query(sql, params);
      return rows || [];
    }
    return [];
  }

  async getValuationReport(tenantId) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    if (this.pool) {
      const [rows] = await this.pool.query(`
        SELECT 
          p.id as product_id, p.sku, COALESCE(p.nombre, p.name) as product_name,
          COALESCE(p.categoria, p.category, 'Productos') as category,
          s.location_id, l.name as location_name,
          s.quantity, s.average_cost,
          (s.quantity * s.average_cost) as total_valuation,
          COALESCE(p.precio, p.price, 0) as sale_price,
          (s.quantity * COALESCE(p.precio, p.price, 0)) as total_potential_revenue
        FROM inventory_stock s
        INNER JOIN services p ON s.product_id = p.id AND s.tenant_id = p.tenant_id AND p.item_type = 'PRODUCTO'
        INNER JOIN inventory_locations l ON s.location_id = l.id AND s.tenant_id = l.tenant_id
        WHERE s.tenant_id = ? AND s.quantity > 0
        ORDER BY total_valuation DESC
      `, [tenantId]);
      return rows || [];
    }
    return [];
  }

  /**
   * Atomic manual stock adjustment (creates inventory_stock balance if missing, inside the same transaction).
   */
  async executeAtomicAdjustment(tenantId, {
    productId,
    locationId,
    quantity,
    adjustmentType,
    reason,
    userId = null,
    userName = null,
    productCost = 0
  }) {
    if (!tenantId || !productId || !locationId) {
      throw new Error('tenantId, productId y locationId son requeridos');
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error('La cantidad de ajuste debe ser mayor a cero');
    }

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const conn = await this.pool.getConnection();
      try {
        await conn.query('BEGIN');
        await conn.query("SET LOCAL lock_timeout = '5s'");

        // 1. Validate canonical product in services
        const [prodRows] = await conn.query(
          'SELECT id, item_type, costo, cost FROM services WHERE tenant_id = ? AND id = ? LIMIT 1',
          [tenantId, productId]
        );
        if (!prodRows || prodRows.length === 0) {
          const err = new Error('Producto no encontrado');
          err.code = 'NOT_FOUND';
          throw err;
        }
        if (String(prodRows[0].item_type || '').toUpperCase() !== 'PRODUCTO') {
          const err = new Error('Solo se puede ajustar stock de ítems tipo PRODUCTO del Catálogo');
          err.code = 'INVALID_ITEM_TYPE';
          throw err;
        }

        // 2. Lock stock row FOR UPDATE (may be empty if first movement)
        const [stockRows] = await conn.query(
          'SELECT * FROM inventory_stock WHERE tenant_id = ? AND product_id = ? AND location_id = ? LIMIT 1 FOR UPDATE',
          [tenantId, productId, locationId]
        );

        const currentStock = stockRows && stockRows.length > 0
          ? stockRows[0]
          : { quantity: 0, average_cost: Number(prodRows[0].costo ?? prodRows[0].cost ?? productCost) || 0 };

        const curQty = Number(currentStock.quantity) || 0;
        const avgCost = Number(currentStock.average_cost) || Number(productCost) || 0;
        let signedQty = 0;
        let newQty = 0;

        if (adjustmentType === 'ADJUSTMENT_IN') {
          signedQty = qty;
          newQty = curQty + qty;
        } else if (adjustmentType === 'ADJUSTMENT_OUT') {
          if (curQty < qty) {
            const err = new Error(`Stock insuficiente para ajuste de salida. Actual: ${curQty}, Solicitado: ${qty}`);
            err.code = 'INSUFFICIENT_STOCK';
            throw err;
          }
          signedQty = -qty;
          newQty = curQty - qty;
        } else {
          throw new Error(`Tipo de ajuste inválido: ${adjustmentType}. Use ADJUSTMENT_IN o ADJUSTMENT_OUT.`);
        }

        const idempotencyKey = `adj:${productId}:${locationId}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;

        // 3. Record movement
        const [movementResult] = await conn.query(`
          INSERT INTO inventory_movements (
            tenant_id, product_id, location_id, movement_type, quantity, unit_cost, total_cost,
            balance_after, reference_type, reference_id, idempotency_key, reason, user_id, user_name, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL_ADJUSTMENT', NULL, ?, ?, ?, ?, NOW())
          RETURNING *
        `, [
          tenantId, productId, locationId, adjustmentType, signedQty,
          avgCost, qty * avgCost, newQty,
          idempotencyKey, reason || 'Ajuste manual de inventario',
          userId || null, userName || null
        ]);

        // 4. Create or update inventory_stock balance atomically
        await conn.query(`
          INSERT INTO inventory_stock (tenant_id, product_id, location_id, quantity, average_cost, last_movement_at, updated_at)
          VALUES (?, ?, ?, ?, ?, NOW(), NOW())
          ON CONFLICT (tenant_id, product_id, location_id) DO UPDATE SET
            quantity = EXCLUDED.quantity,
            average_cost = EXCLUDED.average_cost,
            last_movement_at = NOW(),
            updated_at = NOW()
        `, [tenantId, productId, locationId, newQty, avgCost]);

        await conn.query('COMMIT');

        return {
          success: true,
          movement: movementResult[0],
          previous_stock: curQty,
          new_stock: newQty
        };
      } catch (err) {
        try { await conn.query('ROLLBACK'); } catch (_) {}
        const isRetryable = err.code === '40001' || err.code === '40P01' || err.code === '55P03';
        if (isRetryable && attempt < maxRetries) {
          const jitter = Math.floor(Math.random() * 50) + attempt * 25;
          await new Promise(r => setTimeout(r, jitter));
          continue;
        }
        throw err;
      } finally {
        conn.release();
      }
    }
  }

  _validateMinStockPrecision(value, unitOfMeasure = 'unit') {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
      const err = new Error('El stock mínimo debe ser un número válido mayor o igual a 0.');
      err.code = 'INVALID_THRESHOLD';
      err.status = 400;
      throw err;
    }
    const unit = String(unitOfMeasure || 'unit').trim().toLowerCase();
    const discreteUnits = new Set(['unit', 'unidad', 'unidades', 'botella', 'caja', 'frasco', 'paquete', 'pieza']);
    if (discreteUnits.has(unit) && !Number.isInteger(num)) {
      const err = new Error(`La unidad de medida "${unitOfMeasure}" requiere un umbral entero (sin decimales).`);
      err.code = 'INVALID_THRESHOLD_PRECISION';
      err.status = 400;
      throw err;
    }
    return Math.round(num * 10000) / 10000;
  }

  async getAlertSettings(tenantId) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    if (!this.pool) {
      return {
        settings: { tenant_id: tenantId, alerts_enabled: true, default_min_stock: 5, is_default: true },
        overrides: []
      };
    }
    const [settingsRows] = await this.pool.query(
      'SELECT tenant_id, alerts_enabled, default_min_stock, updated_by, updated_at FROM inventory_alert_settings WHERE tenant_id = ? LIMIT 1',
      [tenantId]
    );
    const settings = settingsRows && settingsRows.length > 0
      ? {
          ...settingsRows[0],
          alerts_enabled: Boolean(settingsRows[0].alerts_enabled),
          default_min_stock: Number(settingsRows[0].default_min_stock ?? 5),
          is_default: false
        }
      : { tenant_id: tenantId, alerts_enabled: true, default_min_stock: 5, is_default: true };

    const [overrideRows] = await this.pool.query(`
      SELECT o.*, COALESCE(p.nombre, p.name) AS product_name, p.sku, p.unit_of_measure,
             l.name AS location_name
      FROM inventory_alert_overrides o
      INNER JOIN services p ON p.id = o.product_id AND p.tenant_id = o.tenant_id AND p.item_type = 'PRODUCTO'
      LEFT JOIN inventory_locations l ON l.id = o.location_id AND l.tenant_id = o.tenant_id
      WHERE o.tenant_id = ?
      ORDER BY COALESCE(p.nombre, p.name) ASC, l.name ASC NULLS FIRST
    `, [tenantId]);

    const overrides = (overrideRows || []).map(r => ({
      ...r,
      min_stock: r.min_stock !== null && r.min_stock !== undefined ? Number(r.min_stock) : null,
      alerts_enabled: r.alerts_enabled !== null && r.alerts_enabled !== undefined ? Boolean(r.alerts_enabled) : null
    }));

    return { settings, overrides };
  }

  async upsertAlertSettings(tenantId, { alerts_enabled, default_min_stock, updated_by = null }) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    const cleanMin = default_min_stock !== undefined && default_min_stock !== null
      ? this._validateMinStockPrecision(default_min_stock, 'decimal')
      : 5;
    const enabled = alerts_enabled !== undefined ? Boolean(alerts_enabled) : true;

    const [rows] = await this.pool.query(`
      INSERT INTO inventory_alert_settings (tenant_id, alerts_enabled, default_min_stock, updated_by, updated_at)
      VALUES (?, ?, ?, ?, NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET
        alerts_enabled = EXCLUDED.alerts_enabled,
        default_min_stock = EXCLUDED.default_min_stock,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING tenant_id, alerts_enabled, default_min_stock, updated_by, updated_at
    `, [tenantId, enabled, cleanMin, updated_by]);

    return {
      ...rows[0],
      alerts_enabled: Boolean(rows[0].alerts_enabled),
      default_min_stock: Number(rows[0].default_min_stock),
      is_default: false
    };
  }

  async upsertAlertOverride(tenantId, { product_id, location_id = null, alerts_enabled = null, min_stock = null, updated_by = null }) {
    if (!tenantId || !product_id) {
      const err = new Error('tenant_id y product_id son requeridos');
      err.status = 400;
      throw err;
    }
    const [prodRows] = await this.pool.query(
      'SELECT id, item_type, unit_of_measure FROM services WHERE id = ? AND tenant_id = ? LIMIT 1',
      [product_id, tenantId]
    );
    if (!prodRows || prodRows.length === 0) {
      const err = new Error('Producto no encontrado en el catálogo del negocio.');
      err.status = 404;
      throw err;
    }
    if (String(prodRows[0].item_type || '').toUpperCase() !== 'PRODUCTO') {
      const err = new Error('Las alertas de inventario solo aplican a ítems tipo PRODUCTO, no a servicios.');
      err.status = 400;
      err.code = 'INVALID_ITEM_TYPE';
      throw err;
    }

    const cleanLocId = location_id || null;
    if (cleanLocId) {
      const [locRows] = await this.pool.query(
        'SELECT id FROM inventory_locations WHERE id = ? AND tenant_id = ? LIMIT 1',
        [cleanLocId, tenantId]
      );
      if (!locRows || locRows.length === 0) {
        const err = new Error('Ubicación/sucursal de inventario no encontrada.');
        err.status = 404;
        throw err;
      }
    }

    const cleanMin = min_stock !== null && min_stock !== undefined && min_stock !== ''
      ? this._validateMinStockPrecision(min_stock, prodRows[0].unit_of_measure)
      : null;
    const cleanEnabled = alerts_enabled !== null && alerts_enabled !== undefined
      ? Boolean(alerts_enabled)
      : null;

    const [rows] = await this.pool.query(`
      INSERT INTO inventory_alert_overrides (tenant_id, product_id, location_id, alerts_enabled, min_stock, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
      ON CONFLICT (tenant_id, product_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid))
      DO UPDATE SET
        alerts_enabled = EXCLUDED.alerts_enabled,
        min_stock = EXCLUDED.min_stock,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING *
    `, [tenantId, product_id, cleanLocId, cleanEnabled, cleanMin, updated_by]);

    return {
      ...rows[0],
      min_stock: rows[0].min_stock !== null ? Number(rows[0].min_stock) : null,
      alerts_enabled: rows[0].alerts_enabled !== null ? Boolean(rows[0].alerts_enabled) : null
    };
  }

  async deleteAlertOverride(tenantId, overrideId) {
    if (!tenantId || !overrideId) throw new Error('tenant_id y overrideId son requeridos');
    const [result] = await this.pool.query(
      'DELETE FROM inventory_alert_overrides WHERE id = ? AND tenant_id = ? RETURNING id',
      [overrideId, tenantId]
    );
    return result && result.length > 0;
  }

  async evaluateAndRecordAlertState(tenantId, productId, locationId) {
    if (!this.pool || !tenantId || !productId || !locationId) {
      return { evaluated: false };
    }
    const [prodRows] = await this.pool.query(
      `SELECT id, COALESCE(nombre, name) AS product_name, sku, item_type, track_stock,
              COALESCE(is_active, TRUE) AS is_active, COALESCE(activo, 1) AS activo
       FROM services WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [productId, tenantId]
    );
    if (!prodRows || prodRows.length === 0) return { evaluated: false, reason: 'NOT_FOUND' };
    const prod = prodRows[0];
    if (String(prod.item_type || '').toUpperCase() !== 'PRODUCTO' || !prod.track_stock || !prod.is_active || Number(prod.activo) !== 1) {
      return { evaluated: false, reason: 'NOT_TRACKED_PRODUCT' };
    }

    const [ruleRows] = await this.pool.query(`
      SELECT
        COALESCE(iao_loc.min_stock, iao_prod.min_stock, ias.default_min_stock, 5) AS effective_min_stock,
        COALESCE(iao_loc.alerts_enabled, iao_prod.alerts_enabled, ias.alerts_enabled, TRUE) AS effective_enabled,
        CASE
          WHEN iao_loc.min_stock IS NOT NULL THEN 'location'
          WHEN iao_prod.min_stock IS NOT NULL THEN 'product'
          ELSE 'general'
        END AS threshold_source,
        COALESCE(st.quantity, 0) AS current_stock,
        l.name AS location_name
      FROM (SELECT 1) AS _
      LEFT JOIN inventory_alert_settings ias ON ias.tenant_id = ?
      LEFT JOIN inventory_alert_overrides iao_loc
        ON iao_loc.tenant_id = ? AND iao_loc.product_id = ? AND iao_loc.location_id = ?
      LEFT JOIN inventory_alert_overrides iao_prod
        ON iao_prod.tenant_id = ? AND iao_prod.product_id = ? AND iao_prod.location_id IS NULL
      LEFT JOIN inventory_stock st
        ON st.tenant_id = ? AND st.product_id = ? AND st.location_id = ?
      LEFT JOIN inventory_locations l
        ON l.tenant_id = ? AND l.id = ?
      LIMIT 1
    `, [tenantId, tenantId, productId, locationId, tenantId, productId, tenantId, productId, locationId, tenantId, locationId]);

    const rule = ruleRows[0] || {};
    const effectiveEnabled = Boolean(rule.effective_enabled);
    const effectiveMinStock = Number(rule.effective_min_stock ?? 5);
    const currentStock = Number(rule.current_stock ?? 0);
    const isLow = effectiveEnabled && currentStock <= effectiveMinStock;

    const [stateRows] = await this.pool.query(
      'SELECT * FROM inventory_alert_states WHERE tenant_id = ? AND product_id = ? AND location_id = ? LIMIT 1',
      [tenantId, productId, locationId]
    );
    const prev = stateRows[0] || null;
    let newlyTriggered = false;
    let resolved = false;

    if (!prev) {
      newlyTriggered = isLow;
      await this.pool.query(`
        INSERT INTO inventory_alert_states (
          tenant_id, product_id, location_id, is_in_low_stock, last_threshold, last_quantity,
          last_triggered_at, resolved_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NOW())
      `, [tenantId, productId, locationId, isLow, effectiveMinStock, currentStock, isLow ? new Date() : null]);
    } else if (!prev.is_in_low_stock && isLow) {
      newlyTriggered = true;
      await this.pool.query(`
        UPDATE inventory_alert_states
        SET is_in_low_stock = TRUE, last_threshold = ?, last_quantity = ?, last_triggered_at = NOW(), updated_at = NOW()
        WHERE id = ? AND tenant_id = ?
      `, [effectiveMinStock, currentStock, prev.id, tenantId]);
    } else if (prev.is_in_low_stock && isLow) {
      // Mismo episodio de stock bajo: actualizar último valor sin duplicar notificación
      await this.pool.query(`
        UPDATE inventory_alert_states
        SET last_threshold = ?, last_quantity = ?, updated_at = NOW()
        WHERE id = ? AND tenant_id = ?
      `, [effectiveMinStock, currentStock, prev.id, tenantId]);
    } else if (prev.is_in_low_stock && !isLow) {
      // Se recuperó estrictamente por encima del umbral: cerrar episodio para permitir nueva alerta futura
      resolved = true;
      await this.pool.query(`
        UPDATE inventory_alert_states
        SET is_in_low_stock = FALSE, last_threshold = ?, last_quantity = ?, resolved_at = NOW(), updated_at = NOW()
        WHERE id = ? AND tenant_id = ?
      `, [effectiveMinStock, currentStock, prev.id, tenantId]);
    } else {
      await this.pool.query(`
        UPDATE inventory_alert_states
        SET last_threshold = ?, last_quantity = ?, updated_at = NOW()
        WHERE id = ? AND tenant_id = ?
      `, [effectiveMinStock, currentStock, prev.id, tenantId]);
    }

    return {
      evaluated: true,
      product_id: productId,
      product_name: prod.product_name,
      sku: prod.sku,
      location_id: locationId,
      location_name: rule.location_name || null,
      current_stock: currentStock,
      min_stock: effectiveMinStock,
      alerts_enabled: effectiveEnabled,
      threshold_source: rule.threshold_source || 'general',
      is_in_low_stock: isLow,
      newlyTriggered,
      resolved
    };
  }
}

module.exports = { InventoryRepository };

