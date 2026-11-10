/**
 * Inventory Physical Session Service (REM-P2-03 & Addendum 3)
 *
 * Implements:
 * 1. Physical inventory counting sessions (DRAFT -> COUNTING -> REVIEW -> POSTED / CANCELLED).
 * 2. Concurrent sales accounting formula:
 *    expected_at_post = system_stock_snapshot + movements_since_snapshot
 *    variance = physical_count - expected_at_post
 * 3. Pessimistic locking (SELECT ... FOR UPDATE) during posting.
 * 4. Single active session enforcement per tenant + branch + location.
 * 5. Minor currency units for valuation and cost variances.
 */

'use strict';

const crypto = require('crypto');

class InventoryPhysicalSessionService {
  constructor(pool) {
    this.pool = pool;
  }

  async resolveLocationId(conn, tenantId, locationId) {
    if (locationId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(locationId)) {
      const [rows] = await conn.query(`SELECT id FROM inventory_locations WHERE tenant_id = ? AND id = ?`, [tenantId, locationId]);
      if (rows.length > 0) return rows[0].id;
    }
    const [byCode] = await conn.query(
      `SELECT id FROM inventory_locations WHERE tenant_id = ? AND (code = ? OR name = ? OR is_default = true) ORDER BY is_default DESC LIMIT 1`,
      [tenantId, locationId || 'ALM-01', locationId || 'Almacén Principal']
    );
    if (byCode.length > 0) return byCode[0].id;

    const [created] = await conn.query(`
      INSERT INTO inventory_locations (tenant_id, name, code, is_default, is_active)
      VALUES (?, 'Almacén Principal', 'ALM-01', true, true)
      RETURNING id
    `, [tenantId]);
    return created[0].id;
  }

  async createSession({ tenantId, branchId = null, locationId = 'main_storage', notes = '', userId = null }) {
    if (!tenantId) {
      const err = new Error('TENANT_REQUIRED: tenantId is mandatory.');
      err.status = 403;
      throw err;
    }

    const locId = String(locationId || 'main_storage').trim();

    // 1. Check for existing active session for this tenant, branch, and location
    const [existing] = await this.pool.query(`
      SELECT id, session_number, status
      FROM inventory_physical_sessions
      WHERE tenant_id = ?
        AND COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(?, '00000000-0000-0000-0000-000000000000'::uuid)
        AND location_id = ?
        AND status IN ('DRAFT', 'COUNTING', 'REVIEW')
      LIMIT 1
    `, [tenantId, branchId, locId]);

    if (existing.length > 0) {
      const err = new Error(`ACTIVE_SESSION_EXISTS: Ya existe una sesión activa (${existing[0].session_number} [${existing[0].status}]) en esta sucursal y ubicación.`);
      err.status = 409;
      err.code = 'ACTIVE_SESSION_EXISTS';
      throw err;
    }

    // 2. Generate sequential session number
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
    const sessionNumber = `TF-${dateStr}-${randSuffix}`;

    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      // Insert session
      const [sessRes] = await conn.query(`
        INSERT INTO inventory_physical_sessions (
          tenant_id, branch_id, location_id, session_number, status, notes, created_by
        ) VALUES (?, ?, ?, ?, 'DRAFT', ?, ?)
        RETURNING id
      `, [tenantId, branchId || null, locId, sessionNumber, notes || null, userId || null]);

      const sessionId = sessRes[0].id;

      // 3. Take initial system stock snapshot
      const [products] = await conn.query(`
        SELECT p.id,
               CAST(ROUND(COALESCE(p.cost, 0) * 100) AS INTEGER) as cost_cents,
               COALESCE(s.quantity, 0) as current_qty
        FROM inventory_products p
        LEFT JOIN inventory_stock s ON s.product_id = p.id AND s.tenant_id = p.tenant_id
        WHERE p.tenant_id = ?
      `, [tenantId]);

      for (const prod of products) {
        const initialQty = Number(prod.current_qty) || 0;
        const unitCostCents = Number(prod.cost_cents) || 0;

        await conn.query(`
          INSERT INTO inventory_physical_session_items (
            session_id, tenant_id, product_id, system_stock_snapshot,
            movements_since_snapshot, expected_stock_at_post,
            unit_cost_snapshot_cents
          ) VALUES (?, ?, ?, ?, 0.0000, ?, ?)
        `, [sessionId, tenantId, prod.id, initialQty, initialQty, unitCostCents]);
      }

      await conn.commit();

      return {
        id: sessionId,
        session_number: sessionNumber,
        status: 'DRAFT',
        branch_id: branchId,
        location_id: locId,
        items_count: products.length
      };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async getSession({ tenantId, sessionId }) {
    const [sessRows] = await this.pool.query(`
      SELECT s.*,
             u1.name as created_by_name,
             u2.name as posted_by_name,
             b.name as branch_name
      FROM inventory_physical_sessions s
      LEFT JOIN users u1 ON u1.id = s.created_by
      LEFT JOIN users u2 ON u2.id = s.posted_by
      LEFT JOIN branches b ON b.id = s.branch_id
      WHERE s.id = ? AND s.tenant_id = ?
    `, [sessionId, tenantId]);

    if (sessRows.length === 0) {
      const err = new Error('Sesión de inventario físico no encontrada.');
      err.status = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    const session = sessRows[0];

    const [items] = await this.pool.query(`
      SELECT i.*,
             p.name as product_name,
             p.sku as product_code,
             p.category as category
      FROM inventory_physical_session_items i
      INNER JOIN inventory_products p ON p.id = i.product_id
      WHERE i.session_id = ? AND i.tenant_id = ?
      ORDER BY p.name ASC
    `, [sessionId, tenantId]);

    return {
      session,
      items
    };
  }

  async listSessions({ tenantId, limit = 20, offset = 0 }) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const [rows] = await this.pool.query(`
      SELECT s.*,
             b.name as branch_name,
             COUNT(i.id) as items_count,
             COUNT(i.physical_count) as counted_items_count
      FROM inventory_physical_sessions s
      LEFT JOIN branches b ON b.id = s.branch_id
      LEFT JOIN inventory_physical_session_items i ON i.session_id = s.id
      WHERE s.tenant_id = ?
      GROUP BY s.id, b.name
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?
    `, [tenantId, safeLimit, safeOffset]);

    return rows;
  }

  async recordCounts({ tenantId, sessionId, items = [] }) {
    const [sessRows] = await this.pool.query(`
      SELECT id, status FROM inventory_physical_sessions
      WHERE id = ? AND tenant_id = ?
    `, [sessionId, tenantId]);

    if (sessRows.length === 0) {
      const err = new Error('Sesión de inventario no encontrada.');
      err.status = 404;
      throw err;
    }

    const currentStatus = sessRows[0].status;
    if (currentStatus === 'POSTED' || currentStatus === 'CANCELLED') {
      const err = new Error(`INVALID_SESSION_STATUS: No se pueden registrar conteos en una sesión ${currentStatus}.`);
      err.status = 409;
      err.code = 'INVALID_SESSION_STATUS';
      throw err;
    }

    for (const item of items) {
      if (!item.product_id || item.physical_count === undefined || item.physical_count === null) continue;
      const countVal = Number(item.physical_count) || 0;

      await this.pool.query(`
        UPDATE inventory_physical_session_items
        SET physical_count = ?,
            notes = COALESCE(?, notes),
            counted_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND tenant_id = ? AND product_id = ?
      `, [countVal, item.notes || null, sessionId, tenantId, item.product_id]);
    }

    // Update status to COUNTING or REVIEW
    await this.pool.query(`
      UPDATE inventory_physical_sessions
      SET status = 'REVIEW',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ? AND status = 'DRAFT'
    `, [sessionId, tenantId]);

    return { success: true, updated_items: items.length };
  }

  async postSession({ tenantId, sessionId, userId = null }) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      // 1. Lock session row
      const [sessRows] = await conn.query(`
        SELECT * FROM inventory_physical_sessions
        WHERE id = ? AND tenant_id = ?
        FOR UPDATE
      `, [sessionId, tenantId]);

      if (sessRows.length === 0) {
        const err = new Error('Sesión de inventario no encontrada.');
        err.status = 404;
        throw err;
      }

      const session = sessRows[0];
      if (session.status === 'POSTED') {
        const err = new Error('ALREADY_POSTED: La sesión ya ha sido confirmada y aplicada anteriormente.');
        err.status = 409;
        err.code = 'ALREADY_POSTED';
        throw err;
      }

      if (session.status === 'CANCELLED') {
        const err = new Error('SESSION_CANCELLED: No se puede confirmar una sesión cancelada.');
        err.status = 409;
        err.code = 'SESSION_CANCELLED';
        throw err;
      }

      // 2. Fetch items to post
      const [items] = await conn.query(`
        SELECT * FROM inventory_physical_session_items
        WHERE session_id = ? AND tenant_id = ?
      `, [sessionId, tenantId]);

      let totalAdjustmentsCount = 0;
      let totalVarianceCostCents = 0;

      for (const item of items) {
        if (item.physical_count === null || item.physical_count === undefined) {
          // If uncounted, default to expected system stock (zero variance)
          continue;
        }

        const physicalCount = Number(item.physical_count);
        const snapshotStock = Number(item.system_stock_snapshot) || 0;
        const unitCostCents = Number(item.unit_cost_snapshot_cents) || 0;

        // Lock product stock row in inventory_stock
        const [stockRows] = await conn.query(`
          SELECT quantity FROM inventory_stock
          WHERE tenant_id = ? AND product_id = ?
          FOR UPDATE
        `, [tenantId, item.product_id]);

        const currentDbStock = stockRows.length > 0 ? (Number(stockRows[0].quantity) || 0) : 0;

        // Compute movements occurred since session creation (concurrent sales, adjustments)
        const [moveRows] = await conn.query(`
          SELECT COALESCE(SUM(quantity), 0) as moves_since
          FROM inventory_movements
          WHERE tenant_id = ? AND product_id = ? AND created_at > ?
        `, [tenantId, item.product_id, session.created_at]);

        const movesSinceSnapshot = Number(moveRows[0].moves_since) || 0;

        // FORMULA (Addendum 3):
        // expected_at_post = snapshot + movimientos_desde_snapshot
        // variance = physical_count - expected_at_post
        const expectedAtPost = snapshotStock + movesSinceSnapshot;
        const varianceQty = physicalCount - expectedAtPost;
        const varianceCostCents = Math.round(varianceQty * unitCostCents);

        totalVarianceCostCents += varianceCostCents;

        // Update item row with final variance metrics
        await conn.query(`
          UPDATE inventory_physical_session_items
          SET movements_since_snapshot = ?,
              expected_stock_at_post = ?,
              variance_quantity = ?,
              variance_cost_cents = ?
          WHERE id = ? AND tenant_id = ?
        `, [movesSinceSnapshot, expectedAtPost, varianceQty, varianceCostCents, item.id, tenantId]);

        // If variance !== 0, apply atomic stock adjustment
        if (Math.abs(varianceQty) > 0.0001) {
          totalAdjustmentsCount++;
          const newActualStock = currentDbStock + varianceQty;
          const resolvedLocationId = await this.resolveLocationId(conn, tenantId, session.location_id);

          if (stockRows.length > 0) {
            await conn.query(`
              UPDATE inventory_stock
              SET quantity = ?, updated_at = CURRENT_TIMESTAMP
              WHERE tenant_id = ? AND product_id = ?
            `, [newActualStock, tenantId, item.product_id]);
          } else {
            await conn.query(`
              INSERT INTO inventory_stock (tenant_id, product_id, location_id, quantity)
              VALUES (?, ?, ?, ?)
            `, [tenantId, item.product_id, resolvedLocationId, newActualStock]);
          }

          // Record formal inventory movement
          await conn.query(`
            INSERT INTO inventory_movements (
              tenant_id, product_id, location_id, movement_type, quantity,
              unit_cost, total_cost, balance_after, reason, created_at
            ) VALUES (?, ?, ?, 'ADJUSTMENT', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `, [
            tenantId,
            item.product_id,
            resolvedLocationId,
            varianceQty,
            unitCostCents / 100,
            Math.abs(varianceQty * (unitCostCents / 100)),
            newActualStock,
            `Ajuste automático por toma física sesión ${session.session_number} (Conteo: ${physicalCount}, Esperado: ${expectedAtPost})`
          ]);
        }
      }

      // 3. Mark session as POSTED
      await conn.query(`
        UPDATE inventory_physical_sessions
        SET status = 'POSTED',
            posted_by = ?,
            posted_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND tenant_id = ?
      `, [userId || null, sessionId, tenantId]);

      await conn.commit();

      return {
        success: true,
        session_id: sessionId,
        status: 'POSTED',
        adjustments_applied: totalAdjustmentsCount,
        total_variance_cost_cents: totalVarianceCostCents
      };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async cancelSession({ tenantId, sessionId, userId = null }) {
    const [sessRows] = await this.pool.query(`
      SELECT status FROM inventory_physical_sessions
      WHERE id = ? AND tenant_id = ?
    `, [sessionId, tenantId]);

    if (sessRows.length === 0) {
      const err = new Error('Sesión de inventario no encontrada.');
      err.status = 404;
      throw err;
    }

    if (sessRows[0].status === 'POSTED') {
      const err = new Error('INVALID_OPERATION: No se puede cancelar una sesión que ya ha sido confirmada y aplicada.');
      err.status = 409;
      err.code = 'ALREADY_POSTED';
      throw err;
    }

    await this.pool.query(`
      UPDATE inventory_physical_sessions
      SET status = 'CANCELLED',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `, [sessionId, tenantId]);

    return { success: true, status: 'CANCELLED' };
  }
}

module.exports = { InventoryPhysicalSessionService };

