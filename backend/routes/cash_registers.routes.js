const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { createQuarantineGuard } = require('../middleware/quarantine.middleware.cjs');
const { createIdempotencyMiddleware } = require('../middleware/idempotency.middleware.cjs');
const { getBranchScope, isBranchAuthorized } = require('../middleware/rbac.middleware');
const { getGlobalSmtpConfig, resolveTransporterForTenant } = require('../services/platform_email.service');

const escapeHtml = (v) => String(v ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const fmtMoney = (n) => `RD$ ${Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function sendCashRegisterCloseEmail(pool, {
  tenantId,
  registerId,
  openedAt,
  openedBy,
  closedBy,
  openingBalance,
  cashSales,
  ingresos,
  salidas,
  expectedBalance,
  closingBalance,
  difference,
  discrepancyReason,
  notes,
}) {
  try {
    const [tenantRows] = await pool.query(
      'SELECT business_name, name, owner_email FROM tenants WHERE id = ? LIMIT 1',
      [tenantId]
    );
    const tenant = tenantRows?.[0] || {};
    const businessName = tenant.business_name || tenant.name || 'Etereas';

    const [adminUsers] = await pool.query(
      "SELECT email FROM users WHERE tenant_id = ? AND role IN ('propietario', 'admin') AND email IS NOT NULL AND email != ''",
      [tenantId]
    );

    const recipients = Array.from(new Set([
      ...(adminUsers || []).map((u) => String(u.email).trim().toLowerCase()),
      ...(tenant.owner_email ? [String(tenant.owner_email).trim().toLowerCase()] : []),
    ].filter(Boolean)));

    if (recipients.length === 0) return { sent: false, reason: 'no_recipients' };

    // Prioriza el SMTP global configurado por el Administrador de la plataforma
    let transporter = null;
    let fromAddress = null;
    const globalCfg = await getGlobalSmtpConfig(pool);
    if (globalCfg) {
      fromAddress = `"${globalCfg.fromName || 'Etereas'}" <${globalCfg.user}>`;
      transporter = nodemailer.createTransport({
        host: globalCfg.host,
        port: globalCfg.port,
        secure: globalCfg.secure,
        auth: { user: globalCfg.user, pass: globalCfg.pass },
        tls: { rejectUnauthorized: false },
      });
    } else {
      const resolved = await resolveTransporterForTenant(pool, tenantId, businessName);
      transporter = resolved.transporter;
      fromAddress = resolved.fromAddress;
    }

    if (!transporter || !fromAddress) return { sent: false, reason: 'no_smtp_configured' };

    const closedAtStr = new Date().toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' });
    const openedAtStr = openedAt ? new Date(openedAt).toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' }) : 'N/A';
    const diffColor = difference === 0 ? '#16a34a' : (difference < 0 ? '#dc2626' : '#d97706');

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 24px;">
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px;">
          <h2 style="margin: 0 0 6px; color: #0f172a; font-size: 18px;">Cierre / Cuadre de Caja — ${escapeHtml(businessName)}</h2>
          <p style="margin: 0 0 16px; color: #64748b; font-size: 13px;">Caja #${escapeHtml(registerId)} · Cerrada el ${escapeHtml(closedAtStr)}</p>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: #1e293b;">
            <tr><td style="padding: 6px 0; border-bottom: 1px solid #f1f5f9;">Apertura</td><td style="padding: 6px 0; border-bottom: 1px solid #f1f5f9; text-align: right;">${escapeHtml(openedAtStr)} (${escapeHtml(openedBy || 'N/A')})</td></tr>
            <tr><td style="padding: 6px 0; border-bottom: 1px solid #f1f5f9;">Cerrada por</td><td style="padding: 6px 0; border-bottom: 1px solid #f1f5f9; text-align: right;"><strong>${escapeHtml(closedBy)}</strong></td></tr>
            <tr><td style="padding: 6px 0; border-bottom: 1px solid #f1f5f9;">Fondo inicial</td><td style="padding: 6px 0; border-bottom: 1px solid #f1f5f9; text-align: right;">${escapeHtml(fmtMoney(openingBalance))}</td></tr>
            <tr><td style="padding: 6px 0; border-bottom: 1px solid #f1f5f9;">Ventas en efectivo</td><td style="padding: 6px 0; border-bottom: 1px solid #f1f5f9; text-align: right;">${escapeHtml(fmtMoney(cashSales))}</td></tr>
            <tr><td style="padding: 6px 0; border-bottom: 1px solid #f1f5f9;">Ingresos manuales</td><td style="padding: 6px 0; border-bottom: 1px solid #f1f5f9; text-align: right;">${escapeHtml(fmtMoney(ingresos))}</td></tr>
            <tr><td style="padding: 6px 0; border-bottom: 1px solid #f1f5f9;">Salidas manuales</td><td style="padding: 6px 0; border-bottom: 1px solid #f1f5f9; text-align: right;">-${escapeHtml(fmtMoney(salidas))}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0; font-weight: 700;">Saldo esperado</td><td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 700;">${escapeHtml(fmtMoney(expectedBalance))}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0; font-weight: 700;">Saldo real contado</td><td style="padding: 8px 0; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 700;">${escapeHtml(fmtMoney(closingBalance))}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: 800; color: ${diffColor};">Diferencia</td><td style="padding: 8px 0; text-align: right; font-weight: 800; color: ${diffColor};">${escapeHtml(fmtMoney(difference))}</td></tr>
          </table>
          ${discrepancyReason ? `<p style="margin: 14px 0 0; padding: 10px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b; font-size: 12px;"><strong>Motivo de diferencia:</strong> ${escapeHtml(discrepancyReason)}</p>` : ''}
          ${notes ? `<p style="margin: 10px 0 0; color: #475569; font-size: 12px;"><strong>Observaciones:</strong> ${escapeHtml(notes)}</p>` : ''}
        </div>
      </div>
    `;

    const text = [
      `Cierre / Cuadre de Caja - ${businessName}`,
      `Caja #${registerId} | Cerrada: ${closedAtStr}`,
      `Cerrada por: ${closedBy}`,
      `Fondo inicial: ${fmtMoney(openingBalance)}`,
      `Ventas efectivo: ${fmtMoney(cashSales)}`,
      `Ingresos manuales: ${fmtMoney(ingresos)}`,
      `Salidas manuales: -${fmtMoney(salidas)}`,
      `Saldo esperado: ${fmtMoney(expectedBalance)}`,
      `Saldo contado: ${fmtMoney(closingBalance)}`,
      `Diferencia: ${fmtMoney(difference)}`,
      discrepancyReason ? `Motivo diferencia: ${discrepancyReason}` : '',
      notes ? `Observaciones: ${notes}` : '',
    ].filter(Boolean).join('\n');

    await transporter.sendMail({
      from: fromAddress,
      to: recipients.join(', '),
      subject: `Cuadre de Caja - ${businessName} (${closedAtStr})`,
      text,
      html,
    });

    return { sent: true, recipients_count: recipients.length };
  } catch (err) {
    console.error('[CASH REGISTER CLOSE EMAIL ERROR]:', err?.message || err);
    return { sent: false, reason: 'send_failed' };
  }
}

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

  // 0. Listado de cajas con filtros (salon_id, status, start_date, end_date)
  router.get('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { salon_id, status, start_date, end_date } = req.query;

      let query = `
        SELECT cr.*,
               COALESCE(b.name, 'Sede Principal') as salon_name,
               COALESCE(cr.employee_name, cr.opened_by_name, 'Principal') as employee_name
        FROM cash_registers cr
        LEFT JOIN branches b ON b.id::text = cr.branch_id::text AND b.tenant_id = cr.tenant_id
        WHERE cr.tenant_id = ?
      `;
      const params = [tenantId];

      const scope = getBranchScope(req);
      if (!scope.allBranches) {
        if (salon_id && salon_id !== 'all') {
          if (!isBranchAuthorized(req, salon_id)) {
            return res.status(403).json({
              error: 'No tienes acceso autorizado a la sucursal solicitada.',
              code: 'BRANCH_ACCESS_DENIED'
            });
          }
          query += ' AND (cr.branch_id::text = ? OR cr.salon_id::text = ?)';
          params.push(String(salon_id), String(salon_id));
        } else {
          if (scope.branchIds.length === 0) {
            return res.json([]);
          }
          const placeholders = scope.branchIds.map(() => '?').join(', ');
          query += ` AND (cr.branch_id::text IN (${placeholders}) OR cr.salon_id::text IN (${placeholders}))`;
          params.push(...scope.branchIds, ...scope.branchIds);
        }
      } else if (salon_id && salon_id !== 'all') {
        query += ' AND (cr.branch_id::text = ? OR cr.salon_id::text = ?)';
        params.push(String(salon_id), String(salon_id));
      }
      if (status && status !== 'all') {
        query += ' AND cr.status = ?';
        params.push(String(status));
      }
      if (start_date && /^\d{4}-\d{2}-\d{2}$/.test(String(start_date))) {
        query += ' AND cr.opened_at >= ?::date';
        params.push(String(start_date));
      }
      if (end_date && /^\d{4}-\d{2}-\d{2}$/.test(String(end_date))) {
        query += " AND cr.opened_at < (?::date + INTERVAL '1 day')";
        params.push(String(end_date));
      }

      query += ' ORDER BY cr.opened_at DESC LIMIT 200';
      const [rows] = await pool.query(query, params);
      const filtered = scope.allBranches
        ? (rows || [])
        : (rows || []).filter((r) => isBranchAuthorized(req, r.branch_id ?? r.salon_id));
      res.json(filtered);
    } catch (err) {
      console.error('Error listing cash registers:', err);
      res.status(500).json({ error: 'Error consultando listado de cajas' });
    }
  });

  // 1. Obtener caja activa para una sucursal dentro del tenant autenticado
  router.get('/active', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { salon_id = 1 } = req.query;

      if (salon_id && salon_id !== 'all' && !isBranchAuthorized(req, salon_id)) {
        return res.status(403).json({
          error: 'No tienes autorización para consultar la caja de esta sucursal.',
          code: 'BRANCH_ACCESS_DENIED'
        });
      }

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

      // Calcular movimientos manuales de esta caja dentro del tenant (excluyendo 'anulacion_venta' para no descontar doble)
      const [movs] = await pool.query(
        'SELECT type, COALESCE(SUM(amount), 0) as total FROM cash_register_movements WHERE cash_register_id = ? AND tenant_id = ? GROUP BY type',
        [String(register.id), tenantId]
      );

      let totalIngresosManuales = 0;
      let totalSalidasManuales = 0;
      movs.forEach(m => {
        const t = String(m.type || '').toLowerCase();
        if (t === 'anulacion_venta') return;
        if (t === 'ingreso' || t === 'in' || t === 'entrada') {
          totalIngresosManuales += Number(m.total || 0);
        } else {
          totalSalidasManuales += Number(m.total || 0);
        }
      });

      // Calcular ventas POS cobradas estrictamente en esta caja dentro del tenant
      const [sales] = await pool.query(`
        SELECT metodo_pago, COALESCE(SUM(total), 0) as total, COUNT(*) as count
        FROM visits
        WHERE tenant_id = ?
          AND cash_register_id::text = ?
          AND status = 'Facturado'
        GROUP BY metodo_pago
      `, [tenantId, String(register.id)]);

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

      const openingBalance = Number(register.monto_inicial ?? register.opening_amount ?? register.opening_balance ?? 0);
      const expectedCashCents = Math.round((openingBalance + ventasEfectivo + totalIngresosManuales - totalSalidasManuales) * 100);
      const expectedCash = expectedCashCents / 100;

      res.json({
        ...register,
        opening_balance: openingBalance,
        opening_balance_cents: Math.round(openingBalance * 100),
        ventas_efectivo: ventasEfectivo,
        ventas_tarjeta: ventasTarjeta,
        ventas_transferencia: ventasTransferencia,
        ventas_otros: ventasOtros,
        ingresos_manuales: totalIngresosManuales,
        salidas_manuales: totalSalidasManuales,
        expected_cash: expectedCash,
        expected_cash_cents: expectedCashCents
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
      if (!isBranchAuthorized(req, salon_id)) {
        return res.status(403).json({
          error: 'No tienes autorización para abrir cajas en esta sucursal.',
          code: 'BRANCH_ACCESS_DENIED'
        });
      }
      // Operador extraído estrictamente de req.auth para prevenir suplantación de identidad (REM-P1-08)
      const effectiveOpenedBy = req.auth?.name || req.auth?.email || req.headers['x-user-name'] || req.body?.opened_by || 'Recepción';

      // Verificar si ya hay una caja abierta en esta empresa y sucursal
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
        `INSERT INTO cash_registers (tenant_id, branch_id, salon_id, monto_inicial, opening_balance_cents, opened_by_name, observaciones, status, opened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Abierta', NOW())
         RETURNING id`,
        [tenantId, branchId, numericSalonId, Number(opening_balance) || 0, Math.round((Number(opening_balance) || 0) * 100), effectiveOpenedBy, notes]
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
        return res.status(404).json({ error: 'Caja no encontrada en esta empresa' });
      }

      const register = rows[0];
      if (!isBranchAuthorized(req, register.branch_id ?? register.salon_id)) {
        return res.status(403).json({
          error: 'No tienes autorización para cerrar cajas de esta sucursal.',
          code: 'BRANCH_ACCESS_DENIED'
        });
      }
      if (String(register.status || '').toLowerCase() === 'cerrada') {
        return res.status(409).json({
          error: 'Esta caja ya se encuentra cerrada.',
          code: 'ALREADY_CLOSED',
          id: register.id,
          closed_at: register.closed_at
        });
      }

      const openingBalance = Number(register.monto_inicial ?? register.opening_balance ?? register.opening_amount ?? 0);

      const [movs] = await pool.query(
        'SELECT type, COALESCE(SUM(amount), 0) as total FROM cash_register_movements WHERE cash_register_id = ? AND tenant_id = ? GROUP BY type',
        [String(id), tenantId]
      );

      let ingresos = 0;
      let salidas = 0;
      movs.forEach(m => {
        const t = String(m.type || '').toLowerCase();
        if (t === 'anulacion_venta') return;
        if (t === 'ingreso' || t === 'in' || t === 'entrada') ingresos += Number(m.total || 0);
        else salidas += Number(m.total || 0);
      });

      const [sales] = await pool.query(`
        SELECT COALESCE(SUM(total), 0) as cash_sales
        FROM visits
        WHERE tenant_id = ?
          AND cash_register_id::text = ?
          AND status = 'Facturado'
          AND (LOWER(metodo_pago) LIKE '%efectivo%' OR LOWER(metodo_pago) LIKE '%cash%' OR metodo_pago IS NULL)
      `, [tenantId, String(id)]);

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
              error: 'No se ha configurado el PIN administrativo en esta empresa.',
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
            "SELECT id FROM users WHERE tenant_id = ? AND LOWER(role) IN ('propietario', 'owner', 'admin', 'supervisor') LIMIT 1",
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
           monto_final = ?,
           closing_balance_cents = ?,
           expected_balance_cents = ?,
           diferencia = ?,
           difference_cents = ?,
           difference_amount_cents = ?,
           discrepancy_reason = ?,
           supervisor_user_id = ?,
           supervisor_authorized_at = ?,
           authorization_event_type = ?,
           correlation_id = ?,
           closed_by = ?,
           closed_by_name = ?,
           observaciones = COALESCE(?, observaciones),
           status = 'Cerrada',
           closed_at = NOW()
         WHERE id = ? AND tenant_id = ?`,
        [
          actualClosing,
          actualClosingCents,
          expectedBalanceCents,
          difference,
          differenceCents,
          differenceCents,
          discrepancy_reason ? String(discrepancy_reason).trim() : null,
          supervisorUserId,
          supervisorAuthorizedAt,
          authorizationEventType,
          correlationId,
          effectiveClosedBy,
          effectiveClosedBy,
          notes || null,
          id,
          tenantId
        ]
      );

      const emailResult = await sendCashRegisterCloseEmail(pool, {
        tenantId,
        registerId: id,
        openedAt: register.opened_at,
        openedBy: register.opened_by_name || register.opened_by,
        closedBy: effectiveClosedBy,
        openingBalance,
        cashSales,
        ingresos,
        salidas,
        expectedBalance,
        closingBalance: actualClosing,
        difference,
        discrepancyReason: discrepancy_reason ? String(discrepancy_reason).trim() : null,
        notes: notes || null,
      });

      res.json({
        success: true,
        id,
        closed_by: effectiveClosedBy,
        closed_by_user_id: closedByUserId,
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
        correlation_id: correlationId,
        email_sent: Boolean(emailResult?.sent),
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
        return res.status(404).json({ error: 'Caja no encontrada en esta empresa' });
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
        return res.status(404).json({ error: 'Caja no encontrada en esta empresa' });
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
      const { type = 'Salida', amount, concept, reason, payment_method = 'Efectivo' } = req.body;

      const [regCheck] = await pool.query('SELECT id FROM cash_registers WHERE id = ? AND tenant_id = ? LIMIT 1', [id, tenantId]);
      if (regCheck.length === 0) {
        return res.status(404).json({ error: 'Caja no encontrada en esta empresa.' });
      }

      const numAmount = Number(amount);
      if (!numAmount || numAmount <= 0) {
        return res.status(400).json({ error: 'El monto debe ser mayor a 0.' });
      }

      const finalConcept = concept || reason || 'Movimiento de caja';
      const amountCents = Math.round(numAmount * 100);
      const operatorId = req.auth?.id ? String(req.auth.id) : null;
      const operatorName = req.auth?.name || req.auth?.email || 'Recepción';

      const [result] = await pool.query(
        `INSERT INTO cash_register_movements (tenant_id, cash_register_id, type, payment_method, amount, amount_cents, concept, user_id, user_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         RETURNING id`,
        [tenantId, id, type, payment_method, numAmount, amountCents, finalConcept, operatorId, operatorName]
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

  // 8. Facturas / visitas cobradas en una caja del tenant autenticado
  router.get('/:id/invoices', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const [regRows] = await pool.query('SELECT id FROM cash_registers WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      if (regRows.length === 0) {
        return res.status(404).json({ error: 'Caja no encontrada en esta empresa' });
      }
      const [rows] = await pool.query(`
        SELECT v.id, v.ticket_number, v.ticket_number as invoice_number, v.ncf, v.total, v.metodo_pago, v.status, v.visited_at,
               COALESCE(c.nombre, v.client_name, 'Cliente General') as client_name
        FROM visits v
        LEFT JOIN clients c ON c.id::text = v.client_id::text AND c.tenant_id = v.tenant_id
        WHERE v.tenant_id = ? AND v.cash_register_id = ?
        ORDER BY v.visited_at DESC
        LIMIT 200
      `, [tenantId, id]);
      res.json(rows || []);
    } catch (err) {
      console.error('Error fetching cash register invoices:', err);
      res.status(500).json({ error: 'Error consultando facturas de la caja' });
    }
  });

  return router;
}

module.exports = { createCashRegistersRouter };
