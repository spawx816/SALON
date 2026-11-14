/**
 * Repositorio de Compras y Proveedores de Inventario (Plan PRO)
 * Toda consulta tenant-owned incluye obligatoriamente tenant_id.
 */

class InventoryPurchaseRepository {
  constructor(pool = null) {
    this.pool = pool;
  }

  async createSupplier(tenantId, supplierData) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    const { name, rnc_tax_id, contact_name, phone, email, address, is_active } = supplierData;
    if (!name) throw new Error('name de proveedor es obligatorio');

    if (this.pool) {
      const [result] = await this.pool.query(`
        INSERT INTO inventory_suppliers (
          tenant_id, name, rnc_tax_id, contact_name, phone, email, address, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        RETURNING *
      `, [
        tenantId, name.trim(), rnc_tax_id ? rnc_tax_id.trim() : null,
        contact_name || null, phone || null, email || null, address || null,
        is_active !== false
      ]);
      return result[0];
    }
    return null;
  }

  async getSupplierById(tenantId, supplierId) {
    if (!tenantId || !supplierId) throw new Error('tenant_id y supplierId son requeridos');
    if (this.pool) {
      const [rows] = await this.pool.query(
        'SELECT * FROM inventory_suppliers WHERE id = ? AND tenant_id = ? LIMIT 1',
        [supplierId, tenantId]
      );
      return rows[0] || null;
    }
    return null;
  }

  async listSuppliers(tenantId, { activeOnly = true } = {}) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    if (this.pool) {
      let sql = 'SELECT * FROM inventory_suppliers WHERE tenant_id = ?';
      const params = [tenantId];
      if (activeOnly) {
        sql += ' AND is_active = TRUE';
      }
      sql += ' ORDER BY name ASC';
      const [rows] = await this.pool.query(sql, params);
      return rows || [];
    }
    return [];
  }

  async createPurchaseOrder(tenantId, orderData, items = []) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    const { supplier_id, location_id, order_number, notes, created_by } = orderData;
    if (!supplier_id || !location_id || !order_number) {
      throw new Error('supplier_id, location_id y order_number son requeridos');
    }

    if (this.pool) {
      let totalAmount = 0;
      for (const item of items) {
        totalAmount += (Number(item.quantity_ordered) || 0) * (Number(item.unit_cost) || 0);
      }

      const [orderRes] = await this.pool.query(`
        INSERT INTO inventory_purchase_orders (
          tenant_id, supplier_id, location_id, order_number, status, total_amount, notes, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, NOW(), NOW())
        RETURNING *
      `, [tenantId, supplier_id, location_id, order_number.trim(), totalAmount, notes || null, created_by || null]);

      const order = orderRes[0];

      const insertedItems = [];
      for (const it of items) {
        const itemTotal = (Number(it.quantity_ordered) || 0) * (Number(it.unit_cost) || 0);
        const [itRes] = await this.pool.query(`
          INSERT INTO inventory_purchase_order_items (
            tenant_id, purchase_order_id, product_id, quantity_ordered, quantity_received, unit_cost, total_cost
          ) VALUES (?, ?, ?, ?, 0.0000, ?, ?)
          RETURNING *
        `, [tenantId, order.id, it.product_id, Number(it.quantity_ordered), Number(it.unit_cost) || 0, itemTotal]);
        insertedItems.push(itRes[0]);
      }

      return { ...order, items: insertedItems };
    }
    return null;
  }

  async getPurchaseOrderById(tenantId, orderId) {
    if (!tenantId || !orderId) throw new Error('tenant_id y orderId son requeridos');
    if (this.pool) {
      const [orderRows] = await this.pool.query(`
        SELECT po.*, s.name as supplier_name, l.name as location_name
        FROM inventory_purchase_orders po
        INNER JOIN inventory_suppliers s ON po.supplier_id = s.id AND po.tenant_id = s.tenant_id
        INNER JOIN inventory_locations l ON po.location_id = l.id AND po.tenant_id = l.tenant_id
        WHERE po.id = ? AND po.tenant_id = ? LIMIT 1
      `, [orderId, tenantId]);

      if (!orderRows || orderRows.length === 0) return null;

      const [itemRows] = await this.pool.query(`
        SELECT poi.*, COALESCE(p.nombre, p.name) as product_name, p.sku
        FROM inventory_purchase_order_items poi
        INNER JOIN services p ON poi.product_id = p.id AND poi.tenant_id = p.tenant_id
        WHERE poi.purchase_order_id = ? AND poi.tenant_id = ?
        ORDER BY COALESCE(p.nombre, p.name) ASC
      `, [orderId, tenantId]);

      return { ...orderRows[0], items: itemRows || [] };
    }
    return null;
  }

  async listPurchaseOrders(tenantId, { status, supplierId } = {}) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    if (this.pool) {
      let sql = `
        SELECT po.*, s.name as supplier_name, l.name as location_name
        FROM inventory_purchase_orders po
        INNER JOIN inventory_suppliers s ON po.supplier_id = s.id AND po.tenant_id = s.tenant_id
        INNER JOIN inventory_locations l ON po.location_id = l.id AND po.tenant_id = l.tenant_id
        WHERE po.tenant_id = ?
      `;
      const params = [tenantId];
      if (status) {
        sql += ' AND po.status = ?';
        params.push(status);
      }
      if (supplierId) {
        sql += ' AND po.supplier_id = ?';
        params.push(supplierId);
      }
      sql += ' ORDER BY po.created_at DESC';
      const [rows] = await this.pool.query(sql, params);
      return rows || [];
    }
    return [];
  }

  async updatePurchaseOrderStatus(tenantId, orderId, newStatus, { approvedBy = null, approvedAt = null } = {}) {
    if (!tenantId || !orderId || !newStatus) throw new Error('Parámetros requeridos faltantes');
    if (this.pool) {
      const [result] = await this.pool.query(`
        UPDATE inventory_purchase_orders
        SET status = ?,
            approved_by = COALESCE(?, approved_by),
            approved_at = COALESCE(?, approved_at),
            updated_at = NOW()
        WHERE id = ? AND tenant_id = ?
        RETURNING *
      `, [newStatus, approvedBy, approvedAt, orderId, tenantId]);
      return result[0] || null;
    }
    return null;
  }

  async updatePurchaseOrderItemReceived(tenantId, itemId, quantityReceived) {
    if (!tenantId || !itemId) throw new Error('Parámetros requeridos faltantes');
    if (this.pool) {
      const [result] = await this.pool.query(`
        UPDATE inventory_purchase_order_items
        SET quantity_received = quantity_received + ?
        WHERE id = ? AND tenant_id = ?
        RETURNING *
      `, [Number(quantityReceived), itemId, tenantId]);
      return result[0] || null;
    }
    return null;
  }
}

module.exports = { InventoryPurchaseRepository };

