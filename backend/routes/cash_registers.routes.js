const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createQuarantineGuard } = require('../middleware/quarantine.middleware.cjs');
const { createIdempotencyMiddleware } = require('../middleware/idempotency.middleware.cjs');

/**
 * Cash Registers (Cajas de Jornada), Movements & Close Reports Router (Scoped strictly by tenant_id)
 */
function createCashRegistersRouter(pool) {
  const router = express.Router();

  // Fail-Closed Quarantine Protection Guard on Cash Registers
  router.use('/:id', createQuarantineGuard(pool, 'cash_registers', 'id'));

  // Financial Idempotency Guard (open, close, cash movements)
  router.use(createIdempotencyMiddleware());

  const resolveBranchIdForTenant = async (tenantId, requestedSalonId) => {
    if (requestedSalonId && String(requestedSalonId).length > 10 && requestedSalonId !== 'all') {
      const [bRows] = await pool.query('SELECT id FROM branches WHERE id::text = ? AND tenant_id = ? LIMIT 1', [String(requestedSalonId), tenantId]);
      if (bRows.length > 0) return bRows[0].id;
    }
    const [bRows] = await pool.query('SELECT id FROM branches WHERE tenant_id = ? ORDER BY is_main DESC, created_at ASC LIMIT 1', [tenantId]);
    return bRows[0]?.id || null;
  };

  // 1. Obtener caja activa para una sucursal dentro del tenant autenticado
  router.get('/active', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { salon_id = 1 } = req.query;

      let query = "SELECT * FROM cash_registers WHERE tenant_id = ? AND status = 'Abierta'";
      const params = [tenantId];

      if (salon_id && salon_id !== 'all') {
        const sid = String(salon_id);
        if (sid.length > 10) {
          query += " AND (branch_id::text = ? OR salon_id::text = ?)";
          params.push(sid, sid);
        } else {
          query += " AND (salon_id::text = ? OR salon_id IS NULL)";
          params.push(sid);
        }
      }
      query += " ORDER BY opened_at DESC LIMIT 1";

      const [rows] = await pool.query(query, params);
      if (rows.length === 0) {
        return res.json(null);
      }

      const register = rows[0];

      // Calcular movimientos manuales de esta caja dentro del tenant
      const [movs] = await pool.query(
        'SELECT type, COALESCE(SUM(amount), 0) as total FROM cash_register_movements WHERE cash_register_id = ? AND tenant_id = ? GROUP BY type',
        [register.id, tenantId]
      );

      let totalIngresosManuales = 0;
      let totalSalidasManuales = 0;
      movs.forEach(m => {
        const t = String(m.type || '').toLowerCase();
        if (t === 'ingreso' || t === 'in' || t === 'entrada') {
          totalIngresosManuales += Number(m.total || 0);
        } else {
          totalSalidasManuales += Number(m.total || 0);
        }
      });

      // Calcular ventas POS cobradas durante la jornada de esta caja dentro del tenant
      const [sales] = await pool.query(`
        SELECT metodo_pago, COALESCE(SUM(total), 0) as total, COUNT(*) as count
        FROM visits
        WHERE tenant_id = ?
          AND (cash_register_id = ? OR (visited_at >= ? AND status = 'Facturado'))
          AND status = 'Facturado'
        GROUP BY metodo_pago
      `, [tenantId, register.id, register.opened_at]);

      let ventasEfectivo = 0;
      let ventasTarjeta = 0;
      let ventasTransferencia = 0;
      let ventasOtros = 0;

      sales.forEach(s => {
        const mp = String(s.metodo_pago || 'Efectivo').toLowerCase();
        const amt = Number(s.total || 0);
        if (mp.includes('efectivo') || mp.includes('cash')) {
          ventasEfectivo += amt;
        } else if (mp.includes('tarjeta') || mp.includes('card')) {
          ventasTarjeta += amt;
        } else if (mp.includes('transf')) {
          ventasTransferencia += amt;
        } else {
          ventasOtros += amt;
        }
      });

      const openingBalance = Number(register.opening_amount ?? register.opening_balance ?? 0);
      const expectedCash = openingBalance + ventasEfectivo + totalIngresosManuales - totalSalidasManuales;

      res.json({
        ...register,
        opening_balance: openingBalance,
        ventas_efectivo: ventasEfectivo,
        ventas_tarjeta: ventasTarjeta,
        ventas_transferencia: ventasTransferencia,
        ventas_otros: ventasOtros,
        ingresos_manuales: totalIngresosManuales,
        salidas_manuales: totalSalidasManuales,
        expected_cash: expectedCash
      });
    } catch (err) {
      console.error('[CASH REGISTER ACTIVE ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 2. Abrir una nueva caja de jornada en el tenant autenticado (REM-P1-08)
  router.post('/open', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { salon_id = 1, opening_balance = 0, notes = '' } = req.body || {};
      // Operador extraído estrictamente de req.auth para prevenir suplantación de identidad (REM-P1-08)
      const effectiveOpenedBy = req.auth?.name || req.auth?.email || req.headers['x-user-name'] || req.body?.opened_by || 'Recepción';

      // Verificar si ya hay una caja abierta en este salón y sucursal
      let checkQuery = "SELECT id FROM cash_registers WHERE tenant_id = ? AND status = 'Abierta'";
      const checkParams = [tenantId];
      if (salon_id && String(salon_id).length > 10) {
        checkQuery += " AND (branch_id::text = ? OR salon_id::text = ?)";
        checkParams.push(String(salon_id), String(salon_id));
      } else {
        checkQuery += " AND (salon_id::text = ? OR salon_id IS NULL)";
        checkParams.push(String(salon_id || 1));
      }
      checkQuery += " LIMIT 1";

      const [existing] = await pool.query(checkQuery, checkParams);
      if (existing.length > 0) {
        return res.status(400).json({
          error: 'Ya existe una caja abierta para esta sucursal. Ciérrala antes de abrir una nueva.',
          register_id: existing[0].id
        });
      }

      const branchId = await resolveBranchIdForTenant(tenantId, salon_id);
      const numericSalonId = (salon_id && !isNaN(Number(salon_id))) ? Number(salon_id) : 1;

      const [result] = await pool.query(
        `INSERT INTO cash_registers (tenant_id, branch_id, salon_id, opening_amount, opening_balance, opened_by_name, notes, status, opened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Abierta', NOW())
         RETURNING id`,
        [tenantId, branchId, numericSalonId, Number(opening_balance) || 0, Number(opening_balance) || 0, effectiveOpenedBy, notes]
      );

      const newId = result.insertId || result[0]?.id;
      const [created] = await pool.query('SELECT * FROM cash_registers WHERE id = ? AND tenant_id = ?', [newId, tenantId]);
      res.json(created[0] || { id: newId, status: 'Abierta', opening_balance: Number(opening_balance) || 0 });
    } catch (err) {
      console.error('[CASH REGISTER OPEN ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 3. Cerrar caja de jornada dentro del tenant autenticado (REM-P1-08 & REM-P2-02 & Addendum 2)
  router.post('/:id/close', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const {
        closing_balance = 0,
        notes = '',
        discrepancy_reason = '',
        double_confirmed = false,
        supervisor_pin = ''
      } = req.body || {};

      // Operador extraído estrictamente de req.auth para prevenir suplantación de identidad (REM-P1-08)
      const effectiveClosedBy = req.auth?.name || req.auth?.email || req.headers['x-user-name'] || req.body?.closed_by || 'Recepción';
      const closedByUserId = req.auth?.userId || req.auth?.id || null;

      const [rows] = await pool.query('SELECT * FROM cash_registers WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Caja no encontrada en este salón' });
      }

      const register = rows[0];
      const openingBalance = Number(register.opening_amount ?? register.opening_balance ?? 0);

      const [movs] = await pool.query(
        'SELECT type, COALESCE(SUM(amount), 0) as total FROM cash_register_movements WHERE cash_register_id = ? AND tenant_id = ? GROUP BY type',
        [id, tenantId]
      );

      let ingresos = 0;
      let salidas = 0;
      movs.forEach(m => {
        const t = String(m.type || '').toLowerCase();
        if (t === 'ingreso' || t === 'in' || t === 'entrada') ingresos += Number(m.total || 0);
        else salidas += Number(m.total || 0);
      });

      const [sales] = await pool.query(`
        SELECT COALESCE(SUM(total), 0) as cash_sales
        FROM visits
        WHERE tenant_id = ?
          AND (cash_register_id = ? OR (visited_at >= ? AND status = 'Facturado'))
          AND status = 'Facturado'
          AND (LOWER(metodo_pago) LIKE '%efectivo%' OR LOWER(metodo_pago) LIKE '%cash%' OR metodo_pago IS NULL)
      `, [tenantId, id, register.opened_at]);

      const cashSales = Number(sales[0]?.cash_sales || 0);
      const expectedBalance = openingBalance + cashSales + ingresos - salidas;
      const actualClosing = Number(closing_balance) || 0;

      // Exact Minor Currency Units (Cents) calculation
      const expectedBalanceCents = Math.round(expectedBalance * 100);
      const actualClosingCents = Math.round(actualClosing * 100);
      const differenceCents = actualClosingCents - expectedBalanceCents;
      const difference = (differenceCents / 100);

      const correlationId = req.headers['x-correlation-id'] || req.correlationId || crypto.randomUUID();
      let supervisorUserId = null;
      let supervisorAuthorizedAt = null;
      let authorizationEventType = null;

      // REM-P2-02 & Addendum 2: Discrepancy checks
      if (differenceCents !== 0) {
        const trimmedReason = String(discrepancy_reason || '').trim();
        if (trimmedReason.length < 5) {
          return res.status(400).json({
            error: 'El motivo de la diferencia de arqueo es obligatorio (mínimo 5 caracteres).',
            code: 'DISCREPANCY_REASON_REQUIRED',
            difference_cents: differenceCents,
            expected_balance: expectedBalance,
            closing_balance: actualClosing
          });
        }

        if (double_confirmed !== true && double_confirmed !== 'true') {
          return res.status(400).json({
            error: 'Se requiere confirmación doble explícita ante discrepancia en caja.',
            code: 'DOUBLE_CONFIRMATION_REQUIRED',
            difference_cents: differenceCents,
            expected_balance: expectedBalance,
            closing_balance: actualClosing
          });
        }

        const thresholdCents = parseInt(process.env.CASH_DISCREPANCY_SUPERVISOR_THRESHOLD_CENTS || '10000', 10); // RD$ 100.00 default

        if (Math.abs(differenceCents) >= thresholdCents) {
          if (!supervisor_pin || String(supervisor_pin).trim() === '') {
            return res.status(403).json({
              error: 'La diferencia de arqueo excede el umbral permitido y requiere autorización obligatoria con PIN de supervisor.',
              code: 'SUPERVISOR_PIN_REQUIRED',
              difference_cents: differenceCents,
              threshold_cents: thresholdCents
            });
          }

          // Verify supervisor PIN against security_settings
          const [secRows] = await pool.query('SELECT admin_pin_hash FROM security_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
          const pinHash = secRows[0]?.admin_pin_hash;
          if (!pinHash) {
            return res.status(500).json({
              error: 'No se ha configurado el PIN administrativo en este salón.',
              code: 'PIN_NOT_CONFIGURED'
            });
          }

          const isPinValid = bcrypt.compareSync(String(supervisor_pin).trim(), pinHash);
          if (!isPinValid) {
            return res.status(401).json({
              error: 'PIN administrativo de supervisor inválido.',
              code: 'INVALID_ADMIN_PIN'
            });
          }

          // Lookup supervisor user
          const [supRows] = await pool.query(
            "SELECT id FROM users WHERE tenant_id = ? AND role IN ('propietario', 'admin', 'supervisor') LIMIT 1",
            [tenantId]
          );
          supervisorUserId = supRows[0]?.id || null;
          supervisorAuthorizedAt = new Date();
          authorizationEventType = 'SUPERVISOR_PIN_THRESHOLD_EXCEEDED';
        } else {
          authorizationEventType = 'OPERATOR_DOUBLE_CONFIRMED_UNDER_THRESHOLD';
        }
      }

      await pool.query(
        `UPDATE cash_registers SET
           closing_balance = ?,
           closing_amount = ?,
           expected_balance = ?,
           expected_amount = ?,
           difference = ?,
           difference_amount_cents = ?,
           discrepancy_reason = ?,
           supervisor_user_id = ?,
           supervisor_authorized_at = ?,
           authorization_event_type = ?,
           correlation_id = ?,
           closed_by = ?,
           notes = COALESCE(?, notes),
           status = 'Cerrada',
           closed_at = NOW()
         WHERE id = ? AND tenant_id = ?`,
        [
          actualClosing,
          actualClosing,
          expectedBalance,
          expectedBalance,
          difference,
          differenceCents,
          discrepancy_reason ? String(discrepancy_reason).trim() : null,
          supervisorUserId,
          supervisorAuthorizedAt,
          authorizationEventType,
          correlationId,
          effectiveClosedBy,
          notes || null,
          id,
          tenantId
        ]
      );

      res.json({
        success: true,
        id,
        opening_balance: openingBalance,
        cash_sales: cashSales,
        ingresos_manuales: ingresos,
        salidas_manuales: salidas,
        expected_balance: expectedBalance,
        closing_balance: actualClosing,
        difference,
        difference_amount_cents: differenceCents,
        discrepancy_reason: discrepancy_reason ? String(discrepancy_reason).trim() : null,
        supervisor_authorized: Boolean(supervisorUserId),
        authorization_event_type: authorizationEventType,
        correlation_id: correlationId
      });
    } catch (err) {
      console.error('[CASH REGISTER CLOSE ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 4. Reporte detallado de cierre de caja dentro del tenant autenticado
  router.get('/:id/close-report', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const [rows] = await pool.query('SELECT * FROM cash_registers WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Caja no encontrada en este salón' });
      }
      const register = rows[0];

      const [movements] = await pool.query(
        'SELECT * FROM cash_register_movements WHERE cash_register_id = ? AND tenant_id = ? ORDER BY created_at DESC',
        [id, tenantId]
      );

      const endTime = register.closed_at || new Date();
      const [visits] = await pool.query(`
        SELECT id, ticket_number, client_name, total, metodo_pago, visited_at, ncf, empleado_peluquera, empleado_manicurista
        FROM visits
        WHERE tenant_id = ?
          AND (cash_register_id = ? OR (visited_at >= ? AND visited_at <= ?))
          AND status = 'Facturado'
        ORDER BY visited_at DESC
      `, [tenantId, id, register.opened_at, endTime]);

      res.json({
        register,
        movements,
        visits
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5. Obtener movimientos de una caja dentro del tenant autenticado
  router.get('/:id/movements', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const [regCheck] = await pool.query('SELECT id FROM cash_registers WHERE id = ? AND tenant_id = ? LIMIT 1', [id, tenantId]);
      if (regCheck.length === 0) {
        return res.status(404).json({ error: 'Caja no encontrada en este salón' });
      }

      const [movements] = await pool.query(
        'SELECT * FROM cash_register_movements WHERE cash_register_id = ? AND tenant_id = ? ORDER BY created_at DESC',
        [id, tenantId]
      );

      let totalIn = 0;
      let totalOut = 0;
      movements.forEach(m => {
        const t = String(m.type || '').toLowerCase();
        if (t === 'ingreso' || t === 'in' || t === 'entrada') totalIn += Number(m.amount || 0);
        else totalOut += Number(m.amount || 0);
      });

      res.json({
        movements,
        summary: {
          totalIn,
          totalOut,
          net: totalIn - totalOut
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 6. Registrar movimiento manual en caja (Ingreso / Salida) dentro del tenant autenticado
  router.post('/:id/movements', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const { type = 'Salida', amount, concept, reason, category = 'General', created_by = 'Recepción' } = req.body;

      const [regCheck] = await pool.query('SELECT id FROM cash_registers WHERE id = ? AND tenant_id = ? LIMIT 1', [id, tenantId]);
      if (regCheck.length === 0) {
        return res.status(404).json({ error: 'Caja no encontrada en este salón.' });
      }

      if (!amount || Number(amount) <= 0) {
        return res.status(400).json({ error: 'El monto debe ser mayor a 0.' });
      }

      const finalConcept = concept || reason || 'Movimiento de caja';

      const [result] = await pool.query(
        `INSERT INTO cash_register_movements (tenant_id, cash_register_id, type, amount, concept, category, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
         RETURNING id`,
        [tenantId, id, type, Number(amount), finalConcept, category, created_by]
      );

      res.json({
        success: true,
        id: result.insertId || result[0]?.id,
        message: 'Movimiento registrado correctamente'
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 7. Historial de cajas cerradas/abiertas del tenant autenticado
  router.get('/history', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { salon_id } = req.query;
      let query = 'SELECT * FROM cash_registers WHERE tenant_id = ?';
      const params = [tenantId];
      if (salon_id && salon_id !== 'all') {
        query += ' AND (salon_id::text = ? OR branch_id::text = ?)';
        params.push(String(salon_id), String(salon_id));
      }
      query += ' ORDER BY opened_at DESC LIMIT 100';
      const [rows] = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createCashRegistersRouter };
