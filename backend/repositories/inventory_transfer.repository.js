/**
 * Repositorio de Transferencias Multisucursal / Multialmacén (Plan PRO)
 * Toda consulta tenant-owned incluye obligatoriamente tenant_id.
 */

class InventoryTransferRepository {
  constructor(pool = null) {
    this.pool = pool;
  }

  async createTransfer(tenantId, transferData, items = []) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    const { transfer_number, source_location_id, destination_location_id, notes, requested_by } = transferData;

    if (!transfer_number || !source_location_id || !destination_location_id) {
      throw new Error('transfer_number, source_location_id y destination_location_id son obligatorios');
    }

    if (source_location_id === destination_location_id) {
      throw new Error('La ubicación de origen y destino no pueden ser iguales');
    }

    if (this.pool) {
      const [transferRes] = await this.pool.query(`
        INSERT INTO inventory_transfers (
          tenant_id, transfer_number, source_location_id, destination_location_id,
          status, notes, requested_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'REQUESTED', ?, ?, NOW(), NOW())
        RETURNING *
      `, [tenantId, transfer_number.trim(), source_location_id, destination_location_id, notes || null, requested_by || null]);

      const transfer = transferRes[0];

      const insertedItems = [];
      for (const it of items) {
        const [itRes] = await this.pool.query(`
          INSERT INTO inventory_transfer_items (
            tenant_id, transfer_id, product_id, quantity_requested, quantity_transferred
          ) VALUES (?, ?, ?, ?, 0.0000)
          RETURNING *
        `, [tenantId, transfer.id, it.product_id, Number(it.quantity_requested)]);
        insertedItems.push(itRes[0]);
      }

      return { ...transfer, items: insertedItems };
    }
    return null;
  }

  async getTransferById(tenantId, transferId) {
    if (!tenantId || !transferId) throw new Error('tenant_id y transferId son requeridos');
    if (this.pool) {
      const [transferRows] = await this.pool.query(`
        SELECT t.*, sl.name as source_location_name, dl.name as destination_location_name
        FROM inventory_transfers t
        INNER JOIN inventory_locations sl ON t.source_location_id = sl.id AND t.tenant_id = sl.tenant_id
        INNER JOIN inventory_locations dl ON t.destination_location_id = dl.id AND t.tenant_id = dl.tenant_id
        WHERE t.id = ? AND t.tenant_id = ? LIMIT 1
      `, [transferId, tenantId]);

      if (!transferRows || transferRows.length === 0) return null;

      const [itemRows] = await this.pool.query(`
        SELECT ti.*, COALESCE(p.nombre, p.name) as product_name, p.sku
        FROM inventory_transfer_items ti
        INNER JOIN services p ON ti.product_id = p.id AND ti.tenant_id = p.tenant_id
        WHERE ti.transfer_id = ? AND ti.tenant_id = ?
        ORDER BY COALESCE(p.nombre, p.name) ASC
      `, [transferId, tenantId]);

      return { ...transferRows[0], items: itemRows || [] };
    }
    return null;
  }

  async listTransfers(tenantId, { status, sourceLocationId, destinationLocationId } = {}) {
    if (!tenantId) throw new Error('tenant_id es requerido');
    if (this.pool) {
      let sql = `
        SELECT t.*, sl.name as source_location_name, dl.name as destination_location_name
        FROM inventory_transfers t
        INNER JOIN inventory_locations sl ON t.source_location_id = sl.id AND t.tenant_id = sl.tenant_id
        INNER JOIN inventory_locations dl ON t.destination_location_id = dl.id AND t.tenant_id = dl.tenant_id
        WHERE t.tenant_id = ?
      `;
      const params = [tenantId];
      if (status) {
        sql += ' AND t.status = ?';
        params.push(status);
      }
      if (sourceLocationId) {
        sql += ' AND t.source_location_id = ?';
        params.push(sourceLocationId);
      }
      if (destinationLocationId) {
        sql += ' AND t.destination_location_id = ?';
        params.push(destinationLocationId);
      }
      sql += ' ORDER BY t.created_at DESC';
      const [rows] = await this.pool.query(sql, params);
      return rows || [];
    }
    return [];
  }

  async updateTransferStatus(tenantId, transferId, newStatus, meta = {}) {
    if (!tenantId || !transferId || !newStatus) throw new Error('Parámetros requeridos faltantes');
    if (this.pool) {
      const { dispatched_by, dispatched_at, received_by, received_at } = meta;
      const [result] = await this.pool.query(`
        UPDATE inventory_transfers
        SET status = ?,
            dispatched_by = COALESCE(?, dispatched_by),
            dispatched_at = COALESCE(?, dispatched_at),
            received_by = COALESCE(?, received_by),
            received_at = COALESCE(?, received_at),
            updated_at = NOW()
        WHERE id = ? AND tenant_id = ?
        RETURNING *
      `, [newStatus, dispatched_by || null, dispatched_at || null, received_by || null, received_at || null, transferId, tenantId]);
      return result[0] || null;
    }
    return null;
  }

  async updateTransferItemQuantity(tenantId, itemId, transferredQuantity) {
    if (!tenantId || !itemId) throw new Error('Parámetros requeridos faltantes');
    if (this.pool) {
      const [result] = await this.pool.query(`
        UPDATE inventory_transfer_items
        SET quantity_transferred = ?
        WHERE id = ? AND tenant_id = ?
        RETURNING *
      `, [Number(transferredQuantity), itemId, tenantId]);
      return result[0] || null;
    }
    return null;
  }
}

module.exports = { InventoryTransferRepository };

