const express = require('express');
const { getBranchScope, requirePermission } = require('../middleware/rbac.middleware');

const toCents = (val) => Math.round(Number(val || 0) * 100);
const fromCents = (cents) => Number((Number(cents || 0) / 100).toFixed(2));
const toIsoDateOnly = (val) => {
  if (!val) return '';
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  const s = String(val).trim();
  return s.includes('T') ? s.split('T')[0] : s.slice(0, 10);
};
const addDaysIso = (isoDate, days) => {
  if (!isoDate) return '';
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Creates and configures the Express Router for Payroll & Regalías management.
 * Scoped strictly by tenant_id (Multi-Tenant Architecture)
 * 
 * @param {import('mysql2/promise').Pool} pool - Database connection pool
 * @returns {express.Router}
 */
function createPayrollRouter(pool) {
  const router = express.Router();
  const isPositiveIntId = (v) => /^\d+$/.test(String(v || '').trim()) && Number(v) > 0;
  const ALLOWED_DRAFT_STATUSES = new Set(['En preparación', 'En revisión', 'Borrador']);

  // Helper middleware to strictly require verified tenant context
  const requireTenant = (req, res, next) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Contexto de tenant requerido para operaciones de nómina.' });
    }
    req.verifiedTenantId = tenantId;
    next();
  };

  router.use(requireTenant);

  async function resolveAuthorizedBranchDescriptors(req, tenantId) {
    const scope = getBranchScope(req);
    if (scope.allBranches) {
      return { allBranches: true, ids: [], names: [] };
    }
    const ids = Array.isArray(scope.branchIds) ? scope.branchIds.map(String) : [];
    if (ids.length === 0) {
      return { allBranches: false, ids: [], names: [] };
    }
    const placeholders = ids.map(() => '?').join(', ');
    const [rows] = await pool.query(
      `SELECT id::text AS id, name FROM branches WHERE tenant_id = ? AND id::text IN (${placeholders})`,
      [tenantId, ...ids]
    );
    return {
      allBranches: false,
      ids,
      names: (rows || []).map((r) => String(r.name || '').trim().toLowerCase()).filter(Boolean),
    };
  }

  function isSucursalAllowedForActor(sucursalValue, authBranches) {
    if (authBranches.allBranches) return true;
    const raw = String(sucursalValue || '').trim();
    if (!raw || raw.toLowerCase() === 'todas') return false;
    if (authBranches.ids.includes(raw)) return true;
    if (authBranches.names.includes(raw.toLowerCase())) return true;
    return false;
  }

  /**
   * Helper para obtener o inicializar la configuración de cálculos de nómina por tenant
   */
  async function getCalculationSettings(pool, tenantId) {
    try {
      const [rows] = await pool.query(
        'SELECT * FROM payroll_calculation_settings WHERE tenant_id = ? LIMIT 1',
        [tenantId]
      );
      if (rows.length === 0) {
        return {
          salario_mensual_base: 18421.00,
          dias_laborables_mes: 23.83,
          horas_jornada_completa: 8.00,
          horas_media_jornada: 4.00,
          recargo_horas_extras: 1.35,
          recargo_feriado: 1.00
        };
      }
      return {
        salario_mensual_base: parseFloat(rows[0].salario_mensual_base || 18421.00),
        dias_laborables_mes: parseFloat(rows[0].dias_laborables_mes || 23.83),
        horas_jornada_completa: parseFloat(rows[0].horas_jornada_completa || 8.00),
        horas_media_jornada: parseFloat(rows[0].horas_media_jornada || 4.00),
        recargo_horas_extras: parseFloat(rows[0].recargo_horas_extras || 1.35),
        recargo_feriado: parseFloat(rows[0].recargo_feriado || 1.00)
      };
    } catch (e) {
      console.warn('[GET CALCULATION SETTINGS WARN]:', e.message);
      return {
        salario_mensual_base: 18421.00,
        dias_laborables_mes: 23.83,
        horas_jornada_completa: 8.00,
        horas_media_jornada: 4.00,
        recargo_horas_extras: 1.35,
        recargo_feriado: 1.00
      };
    }
  }

  // 1. Obtener lista de períodos de nómina (Scoped strictly by tenant_id y alcance de sucursales)
  router.get('/periods', async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      const authBranches = await resolveAuthorizedBranchDescriptors(req, tenantId);
      const [rows] = await pool.query(`
        SELECT id, period_name, 
               TO_CHAR(start_date, 'YYYY-MM-DD') as start_date, 
               TO_CHAR(end_date, 'YYYY-MM-DD') as end_date,
               total_empleados, total_neto, total_ingresos, total_descuentos,
               status, sucursal, departamento, is_immutable,
               TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
               TO_CHAR(approved_at, 'YYYY-MM-DD HH24:MI:SS') as approved_at,
               approved_by
        FROM payroll_periods
        WHERE tenant_id = ?
        ORDER BY id DESC
      `, [tenantId]);
      const scopedRows = authBranches.allBranches
        ? rows
        : (rows || []).filter((p) => isSucursalAllowedForActor(p.sucursal, authBranches));
      res.json(scopedRows);
    } catch (err) {
      console.error('[PAYROLL PERIODS GET ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 1.1 Obtener configuración de parámetros salariales y tarifas calculadas
  router.get('/settings/calculation-config', async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      const cfg = await getCalculationSettings(pool, tenantId);
      const salarioMensual = cfg.salario_mensual_base;
      const diasMes = cfg.dias_laborables_mes;
      const horasCompleta = cfg.horas_jornada_completa;
      const horasMedia = cfg.horas_media_jornada;
      const recargoExtras = cfg.recargo_horas_extras;
      const recargoFeriado = cfg.recargo_feriado;

      const salarioDiario = Number((salarioMensual / diasMes).toFixed(2));
      const salarioHora = Number((salarioDiario / horasCompleta).toFixed(2));
      const salarioMinuto = Number((salarioHora / 60).toFixed(4));

      const descuentoAusenciaDiaCompleto = Number((horasCompleta * salarioHora).toFixed(2));
      const descuentoAusenciaMedioDia = Number((horasMedia * salarioHora).toFixed(2));

      const tarifaHoraExtra = Number((salarioHora * recargoExtras).toFixed(2));
      const tarifaMinutoExtra = Number((tarifaHoraExtra / 60).toFixed(4));
      const tarifaHoraFeriado = Number((salarioHora * recargoFeriado).toFixed(2));
      const tarifaMinutoFeriado = Number((tarifaHoraFeriado / 60).toFixed(4));

      res.json({
        ...cfg,
        salario_diario: salarioDiario,
        salario_hora: salarioHora,
        salario_minuto: salarioMinuto,
        descuento_ausencia_dia_completo: descuentoAusenciaDiaCompleto,
        descuento_ausencia_medio_dia: descuentoAusenciaMedioDia,
        tarifa_hora_extra: tarifaHoraExtra,
        tarifa_minuto_extra: tarifaMinutoExtra,
        tarifa_hora_feriado: tarifaHoraFeriado,
        tarifa_minuto_feriado: tarifaMinutoFeriado
      });
    } catch (err) {
      console.error('[PAYROLL CALC CONFIG GET ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 1.2 Actualizar parámetros de cálculo salarial (Scoped strictly by tenant_id)
  router.post('/settings/calculation-config', requirePermission('payroll.generate'), async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      const {
        salario_mensual_base,
        dias_laborables_mes,
        horas_jornada_completa,
        horas_media_jornada,
        recargo_horas_extras,
        recargo_feriado
      } = req.body;

      const [existing] = await pool.query(
        'SELECT id FROM payroll_calculation_settings WHERE tenant_id = ? LIMIT 1',
        [tenantId]
      );

      if (existing.length > 0) {
        await pool.query(`
          UPDATE payroll_calculation_settings
          SET salario_mensual_base = ?,
              dias_laborables_mes = ?,
              horas_jornada_completa = ?,
              horas_media_jornada = ?,
              recargo_horas_extras = ?,
              recargo_feriado = ?,
              updated_at = NOW()
          WHERE tenant_id = ?
        `, [
          parseFloat(salario_mensual_base || 18421.00),
          parseFloat(dias_laborables_mes || 23.83),
          parseFloat(horas_jornada_completa || 8.00),
          parseFloat(horas_media_jornada || 4.00),
          parseFloat(recargo_horas_extras || 1.35),
          parseFloat(recargo_feriado || 1.00),
          tenantId
        ]);
      } else {
        await pool.query(`
          INSERT INTO payroll_calculation_settings 
            (salario_mensual_base, dias_laborables_mes, horas_jornada_completa, horas_media_jornada, recargo_horas_extras, recargo_feriado, tenant_id)
          VALUES 
            (?, ?, ?, ?, ?, ?, ?)
        `, [
          parseFloat(salario_mensual_base || 18421.00),
          parseFloat(dias_laborables_mes || 23.83),
          parseFloat(horas_jornada_completa || 8.00),
          parseFloat(horas_media_jornada || 4.00),
          parseFloat(recargo_horas_extras || 1.35),
          parseFloat(recargo_feriado || 1.00),
          tenantId
        ]);
      }

      res.json({
        success: true,
        message: 'Configuración salarial actualizada exitosamente para esta empresa'
      });
    } catch (err) {
      console.error('[PAYROLL CALC CONFIG POST ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 2. Obtener detalle de un período con todos los empleados e items (Scoped by tenant_id)
  router.get('/periods/:id', async (req, res) => {
    try {
      const { id } = req.params;
      if (!isPositiveIntId(id)) {
        return res.status(404).json({ error: 'Período de nómina no encontrado en esta empresa.' });
      }
      const tenantId = req.verifiedTenantId;

      const [periods] = await pool.query(`
        SELECT id, period_name, 
               TO_CHAR(start_date, 'YYYY-MM-DD') as start_date, 
               TO_CHAR(end_date, 'YYYY-MM-DD') as end_date,
               total_empleados, total_neto, total_ingresos, total_descuentos,
               status, sucursal, departamento, is_immutable,
               TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
               TO_CHAR(approved_at, 'YYYY-MM-DD HH24:MI:SS') as approved_at,
               approved_by
        FROM payroll_periods WHERE id = ? AND tenant_id = ?
      `, [id, tenantId]);

      if (!periods || periods.length === 0) {
        return res.status(404).json({ error: 'Período de nómina no encontrado en esta empresa.' });
      }
      const authBranches = await resolveAuthorizedBranchDescriptors(req, tenantId);
      if (!isSucursalAllowedForActor(periods[0].sucursal, authBranches)) {
        return res.status(403).json({ error: 'No tienes permiso para consultar la nómina de esta sucursal.', code: 'FORBIDDEN_BRANCH_SCOPE' });
      }

      const [items] = await pool.query(`
        SELECT * FROM payroll_items 
        WHERE payroll_id = ? AND tenant_id = ?
        ORDER BY id ASC
      `, [id, tenantId]);

      const startDate = periods[0].start_date ? String(periods[0].start_date).split('T')[0] : '';
      const endDate = periods[0].end_date ? String(periods[0].end_date).split('T')[0] : '';
      const evalStaff = await evaluateTenantStaffForPayrollPeriod(pool, tenantId, {
        start_date: startDate,
        end_date: endDate,
        sucursal: periods[0].sucursal || 'Todas',
        departamento: periods[0].departamento || 'Todos',
      });

      // Si el período está en borrador editable, incorporar colaboradores elegibles recién creados en staff_records que aún no tengan fila en payroll_items
      const isDraftPeriod = PAYROLL_DRAFT_STATUSES.has(String(periods[0].status || '')) && Number(periods[0].is_immutable) !== 1;
      const existingEmpIds = new Set(items.map((it) => String(it.employee_id)));
      const missingEligibleStaff = isDraftPeriod
        ? evalStaff.eligible.filter((emp) => !existingEmpIds.has(String(emp.id)))
        : [];

      if (missingEligibleStaff.length > 0) {
        for (const emp of missingEligibleStaff) {
          const itemData = await calculateEmployeePayrollValues(pool, emp, startDate, endDate, tenantId);
          itemData.payroll_id = parseInt(id, 10);
          const [resItem] = await pool.query(`
            INSERT INTO payroll_items (
              payroll_id, employee_id, employee_name, posicion, sucursal, departamento,
              salario_fijo, comisiones, feriados, horas_extras, otros_ingresos, total_ingresos,
              tss, servicios, prestamos, ausencias, tardanzas, otros_descuentos, total_descuentos,
              neto_pagar, detalles_json, tenant_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            itemData.payroll_id, itemData.employee_id, itemData.employee_name, itemData.posicion, itemData.sucursal, itemData.departamento,
            itemData.salario_fijo, itemData.comisiones, itemData.feriados, itemData.horas_extras, itemData.otros_ingresos, itemData.total_ingresos,
            itemData.tss, itemData.servicios, itemData.prestamos, itemData.ausencias, itemData.tardanzas, itemData.otros_descuentos, itemData.total_descuentos,
            itemData.neto_pagar, JSON.stringify(itemData.detalles_json), tenantId
          ]);
          itemData.id = resItem.insertId || resItem[0]?.id;
          items.push(itemData);
        }

        let sumIng = 0, sumDesc = 0, sumNeto = 0;
        for (const it of items) {
          sumIng = Number((sumIng + Number(it.total_ingresos || 0)).toFixed(2));
          sumDesc = Number((sumDesc + Number(it.total_descuentos || 0)).toFixed(2));
          sumNeto = Number((sumNeto + Number(it.neto_pagar || 0)).toFixed(2));
        }
        await pool.query(
          'UPDATE payroll_periods SET total_ingresos = ?, total_descuentos = ?, total_neto = ?, total_empleados = ? WHERE id = ? AND tenant_id = ?',
          [sumIng, sumDesc, sumNeto, items.length, id, tenantId]
        );
        periods[0].total_ingresos = sumIng;
        periods[0].total_descuentos = sumDesc;
        periods[0].total_neto = sumNeto;
        periods[0].total_empleados = items.length;
      }

      // Refrescar automáticamente las comisiones ganadas en períodos en borrador para que el Volante de Pago siempre refleje las ventas recientes
      if (isDraftPeriod && items.length > 0 && startDate && endDate) {
        let draftTotalsChanged = false;
        const periodStartTz = `${startDate} 00:00:00-04:00`;
        const periodEndTz = `${endDate} 23:59:59.999-04:00`;

        for (const it of items) {
          let detObj = {};
          try {
            detObj = typeof it.detalles_json === 'string' ? JSON.parse(it.detalles_json || '{}') : (it.detalles_json || {});
          } catch { detObj = {}; }

          if (detObj.manual_commissions_override === true) continue;

          const empMatch = evalStaff.eligible.find((e) => String(e.id) === String(it.employee_id));
          const tipoSal = String(empMatch?.tipo_salario || 'fijo_mas_comision').toLowerCase();
          if (tipoSal === 'fijo_puro' || tipoSal === 'solo_fijo') continue;

          const empIdStr = String(it.employee_id);
          const empNameStr = String(it.employee_name || '');
          const [liveCommRows] = await pool.query(
            `SELECT COALESCE(SUM(monto_comision), 0) AS total_comm
             FROM employee_commissions_log
             WHERE tenant_id = ?
               AND (employee_id::text = ? OR employee_id::text = ? OR employee_name = ?)
               AND created_at >= ? AND created_at <= ?
               AND COALESCE(status, 'Pendiente') NOT IN ('Anulada', 'Pagada', 'Pagado')
               AND payout_id IS NULL`,
            [tenantId, empIdStr, `EMP-${empIdStr}`, empNameStr, periodStartTz, periodEndTz]
          );
          const liveComm = Number(parseFloat(liveCommRows[0]?.total_comm || 0).toFixed(2));
          const storedComm = Number(parseFloat(it.comisiones || 0).toFixed(2));

          if (Math.abs(liveComm - storedComm) > 0.009) {
            const newTotalIng = Number((
              parseFloat(it.salario_fijo || 0) +
              liveComm +
              parseFloat(it.feriados || 0) +
              parseFloat(it.horas_extras || 0) +
              parseFloat(it.descanso || 0) +
              parseFloat(it.otros_ingresos || 0)
            ).toFixed(2));
            const newNeto = Number((newTotalIng - parseFloat(it.total_descuentos || 0)).toFixed(2));

            if (Array.isArray(detObj.conceptos_ingresos)) {
              const c2 = detObj.conceptos_ingresos.find((c) => c && c.id === 'c2');
              if (c2) c2.monto = liveComm;
              else detObj.conceptos_ingresos.push({ id: 'c2', label: 'Comisiones', monto: liveComm });
            }

            it.comisiones = liveComm;
            it.total_ingresos = newTotalIng;
            it.neto_pagar = newNeto;
            it.detalles_json = detObj;
            draftTotalsChanged = true;

            await pool.query(
              `UPDATE payroll_items
               SET comisiones = ?, total_ingresos = ?, neto_pagar = ?, detalles_json = ?
               WHERE id = ? AND payroll_id = ? AND tenant_id = ?`,
              [liveComm, newTotalIng, newNeto, JSON.stringify(detObj), it.id, id, tenantId]
            );
          }
        }

        if (draftTotalsChanged) {
          let sumIng = 0, sumDesc = 0, sumNeto = 0;
          for (const it of items) {
            sumIng = Number((sumIng + Number(it.total_ingresos || 0)).toFixed(2));
            sumDesc = Number((sumDesc + Number(it.total_descuentos || 0)).toFixed(2));
            sumNeto = Number((sumNeto + Number(it.neto_pagar || 0)).toFixed(2));
          }
          await pool.query(
            'UPDATE payroll_periods SET total_ingresos = ?, total_descuentos = ?, total_neto = ?, total_empleados = ? WHERE id = ? AND tenant_id = ?',
            [sumIng, sumDesc, sumNeto, items.length, id, tenantId]
          );
          periods[0].total_ingresos = sumIng;
          periods[0].total_descuentos = sumDesc;
          periods[0].total_neto = sumNeto;
          periods[0].total_empleados = items.length;
        }
      }

      const parsedItems = items.map(item => ({
        ...item,
        detalles_json: typeof item.detalles_json === 'string' ? JSON.parse(item.detalles_json || '{}') : (item.detalles_json || {})
      }));

      return res.json({
        period: periods[0],
        items: parsedItems,
        excluded_employees: evalStaff.excluded,
        review_summary: buildReviewSummary(parsedItems),
      });
    } catch (err) {
      console.error('[PAYROLL PERIOD DETAIL ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Construye resumen de novedades de revisión y efecto económico acumulado antes de aprobar
   */
  function buildReviewSummary(items = []) {
    let totalFlagged = 0;
    let pendingCount = 0;
    let resolvedCount = 0;
    let totalDeltaNetoCents = 0;
    const summaryItems = [];

    for (const it of items) {
      let det = {};
      try {
        det = typeof it.detalles_json === 'string' ? JSON.parse(it.detalles_json || '{}') : (it.detalles_json || {});
      } catch { det = {}; }
      if (det.requires_review !== true) continue;
      totalFlagged += 1;
      const resObj = det.review_resolution && typeof det.review_resolution === 'object' ? det.review_resolution : null;
      const isValidResolved = det.review_resolved === true && Boolean(
        resObj &&
        (resObj.decision === 'accept_as_is' || resObj.decision === 'adjust') &&
        typeof resObj.reason === 'string' && resObj.reason.trim().length >= 5 &&
        resObj.resolved_at &&
        resObj.resolved_by
      );
      if (isValidResolved) {
        resolvedCount += 1;
        const deltaCents = Number(resObj.economic_delta?.neto_pagar_delta_cents || 0);
        totalDeltaNetoCents += deltaCents;
      } else {
        pendingCount += 1;
      }
      summaryItems.push({
        item_id: it.id,
        employee_id: it.employee_id,
        employee_name: it.employee_name,
        resolved: isValidResolved,
        flags: Array.isArray(det.review_flags) ? det.review_flags : [],
        resolution: isValidResolved ? resObj : null,
        invalidated_previous_resolution: det.invalidated_previous_resolution || null,
      });
    }

    return {
      total_flagged: totalFlagged,
      pending_count: pendingCount,
      resolved_count: resolvedCount,
      total_economic_delta_neto_cents: totalDeltaNetoCents,
      total_economic_delta_neto: fromCents(totalDeltaNetoCents),
      items: summaryItems,
    };
  }

  // 2b. Resolución individual auditada de novedades (altas/bajas parciales o turnos nocturnos)
  const RESOLVE_ALLOWED_ADJUSTABLE_FIELDS = new Set([
    'salario_fijo',
    'comisiones',
    'feriados',
    'horas_extras',
    'otros_ingresos',
    'tss',
    'servicios',
    'prestamos',
    'ausencias',
    'tardanzas',
    'otros_descuentos',
  ]);
  const PAYROLL_DRAFT_STATUSES = new Set(['En preparación', 'Borrador']);

  router.post('/periods/:id/items/:itemId/resolve-review', requirePermission('payroll.approve', 'payroll.generate'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const { id: payrollId, itemId } = req.params;
      const tenantId = req.verifiedTenantId;
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      const { decision, reason, adjustments } = body;

      if (decision !== 'accept_as_is' && decision !== 'adjust') {
        return res.status(400).json({
          error: 'Debes indicar una decisión válida: "accept_as_is" o "adjust".',
          code: 'INVALID_REVIEW_DECISION',
        });
      }
      const cleanReason = String(reason || '').trim();
      if (cleanReason.length < 5) {
        return res.status(400).json({
          error: 'Debes indicar un motivo de resolución (mínimo 5 caracteres).',
          code: 'REVIEW_REASON_REQUIRED',
        });
      }

      if (adjustments !== undefined && (typeof adjustments !== 'object' || adjustments === null || Array.isArray(adjustments))) {
        return res.status(400).json({
          error: 'El campo adjustments debe ser un objeto válido.',
          code: 'INVALID_ADJUSTMENT_FIELDS',
        });
      }
      const safeAdjustments = adjustments || {};
      const adjustmentKeys = Object.keys(safeAdjustments);
      const disallowedKeys = adjustmentKeys.filter((k) => !RESOLVE_ALLOWED_ADJUSTABLE_FIELDS.has(k));
      if (disallowedKeys.length > 0) {
        return res.status(400).json({
          error: `Campos no permitidos en adjustments: ${disallowedKeys.join(', ')}. No se permite alterar empleado, empresa, período ni totales derivados.`,
          code: 'INVALID_ADJUSTMENT_FIELDS',
          rejected_fields: disallowedKeys,
        });
      }
      if (decision === 'accept_as_is' && adjustmentKeys.length > 0) {
        return res.status(400).json({
          error: 'No se permiten ajustes numéricos cuando decision es "accept_as_is".',
          code: 'ADJUSTMENTS_NOT_ALLOWED_FOR_ACCEPT',
        });
      }
      for (const k of adjustmentKeys) {
        const raw = safeAdjustments[k];
        if (raw === undefined || raw === null || raw === '') continue;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return res.status(400).json({
            error: `Valor inválido para "${k}": debe ser un número finito mayor o igual a 0.`,
            code: 'INVALID_ADJUSTMENT_VALUE',
            field: k,
          });
        }
      }

      const actorName = req.auth?.name || req.auth?.email || 'Administrador';
      const actorMeta = {
        user_id: req.auth?.userId || null,
        email: req.auth?.email || null,
        name: actorName,
      };
      const authBranches = await resolveAuthorizedBranchDescriptors(req, tenantId);

      await conn.beginTransaction();
      const [periodRows] = await conn.query(
        'SELECT id, status, is_immutable, sucursal FROM payroll_periods WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [payrollId, tenantId]
      );
      if (periodRows.length === 0) {
        await conn.rollback();
        return res.status(404).json({ error: 'Período no encontrado en esta empresa.' });
      }
      if (!isSucursalAllowedForActor(periodRows[0].sucursal, authBranches)) {
        await conn.rollback();
        return res.status(403).json({ error: 'No tienes permiso para resolver novedades en esta sucursal.', code: 'FORBIDDEN_BRANCH_SCOPE' });
      }
      if (!PAYROLL_DRAFT_STATUSES.has(String(periodRows[0].status || '')) || Number(periodRows[0].is_immutable) === 1) {
        await conn.rollback();
        return res.status(403).json({ error: 'Solo se pueden resolver novedades en períodos en borrador. Esta nómina es inmutable.', code: 'PAYROLL_IMMUTABLE' });
      }

      const [itemRows] = await conn.query(
        'SELECT * FROM payroll_items WHERE id = ? AND payroll_id = ? AND tenant_id = ? FOR UPDATE',
        [itemId, payrollId, tenantId]
      );
      if (itemRows.length === 0) {
        await conn.rollback();
        return res.status(404).json({ error: 'Ítem de nómina no encontrado en este período.' });
      }
      const it = itemRows[0];
      let det = {};
      try {
        det = typeof it.detalles_json === 'string' ? JSON.parse(it.detalles_json || '{}') : (it.detalles_json || {});
      } catch { det = {}; }

      if (det.requires_review !== true) {
        await conn.rollback();
        return res.status(400).json({ error: 'Este colaborador no tiene novedades pendientes de revisión.', code: 'NO_REVIEW_REQUIRED' });
      }

      const prevSalarioCents = toCents(it.salario_fijo);
      const prevComisionesCents = toCents(it.comisiones);
      const prevFeriadosCents = toCents(it.feriados);
      const prevHorasExtrasCents = toCents(it.horas_extras);
      const prevOtrosIngCents = toCents(it.otros_ingresos);
      const prevTotalIngCents = toCents(it.total_ingresos);

      const prevTssCents = toCents(it.tss);
      const prevServiciosCents = toCents(it.servicios);
      const prevPrestamosCents = toCents(it.prestamos);
      const prevAusenciasCents = toCents(it.ausencias);
      const prevTardanzasCents = toCents(it.tardanzas);
      const prevOtrosDescCents = toCents(it.otros_descuentos);
      const prevTotalDescCents = toCents(it.total_descuentos);
      const prevNetoCents = toCents(it.neto_pagar);

      const pickCents = (key, fallbackCents) => {
        if (decision !== 'adjust' || safeAdjustments[key] === undefined || safeAdjustments[key] === null || safeAdjustments[key] === '') {
          return fallbackCents;
        }
        return toCents(Number(safeAdjustments[key]));
      };

      const newSalarioCents = pickCents('salario_fijo', prevSalarioCents);
      const newComisionesCents = pickCents('comisiones', prevComisionesCents);
      const newFeriadosCents = pickCents('feriados', prevFeriadosCents);
      const newHorasExtrasCents = pickCents('horas_extras', prevHorasExtrasCents);
      const newOtrosIngCents = pickCents('otros_ingresos', prevOtrosIngCents);

      // Si el salario fijo cambia y no se envió un TSS manual explícito, recalcular TSS con el parámetro configurado (5.91%)
      const newTssCents = (decision === 'adjust' && safeAdjustments.tss !== undefined && safeAdjustments.tss !== null && safeAdjustments.tss !== '')
        ? pickCents('tss', prevTssCents)
        : (newSalarioCents !== prevSalarioCents ? Math.round(newSalarioCents * 0.0591) : prevTssCents);
      const newServiciosCents = pickCents('servicios', prevServiciosCents);
      const newPrestamosCents = pickCents('prestamos', prevPrestamosCents);
      const newAusenciasCents = pickCents('ausencias', prevAusenciasCents);
      const newTardanzasCents = pickCents('tardanzas', prevTardanzasCents);
      const newOtrosDescCents = pickCents('otros_descuentos', prevOtrosDescCents);

      const newTotalIngCents = newSalarioCents + newComisionesCents + newFeriadosCents + newHorasExtrasCents + newOtrosIngCents;
      const newTotalDescCents = newTssCents + newServiciosCents + newPrestamosCents + newAusenciasCents + newTardanzasCents + newOtrosDescCents;
      const newNetoCents = newTotalIngCents - newTotalDescCents;

      const changedAnyField =
        newSalarioCents !== prevSalarioCents ||
        newComisionesCents !== prevComisionesCents ||
        newFeriadosCents !== prevFeriadosCents ||
        newHorasExtrasCents !== prevHorasExtrasCents ||
        newOtrosIngCents !== prevOtrosIngCents ||
        newTssCents !== prevTssCents ||
        newServiciosCents !== prevServiciosCents ||
        newPrestamosCents !== prevPrestamosCents ||
        newAusenciasCents !== prevAusenciasCents ||
        newTardanzasCents !== prevTardanzasCents ||
        newOtrosDescCents !== prevOtrosDescCents;

      if (decision === 'adjust' && !changedAnyField) {
        await conn.rollback();
        return res.status(400).json({
          error: 'Para resolver con "adjust" debes modificar al menos un importe; si el importe calculado es correcto, utiliza "accept_as_is".',
          code: 'NO_ADJUSTMENT_DETECTED',
        });
      }

      const resolvedAt = new Date().toISOString();
      const reviewResolution = {
        decision,
        reason: cleanReason,
        resolved_by: actorMeta,
        resolved_at: resolvedAt,
        previous_values: {
          salario_fijo: fromCents(prevSalarioCents),
          total_ingresos: fromCents(prevTotalIngCents),
          total_descuentos: fromCents(prevTotalDescCents),
          neto_pagar: fromCents(prevNetoCents),
          neto_pagar_cents: prevNetoCents,
        },
        new_values: {
          salario_fijo: fromCents(newSalarioCents),
          total_ingresos: fromCents(newTotalIngCents),
          total_descuentos: fromCents(newTotalDescCents),
          neto_pagar: fromCents(newNetoCents),
          neto_pagar_cents: newNetoCents,
        },
        economic_delta: {
          salario_fijo_delta: fromCents(newSalarioCents - prevSalarioCents),
          total_ingresos_delta: fromCents(newTotalIngCents - prevTotalIngCents),
          total_descuentos_delta: fromCents(newTotalDescCents - prevTotalDescCents),
          neto_pagar_delta: fromCents(newNetoCents - prevNetoCents),
          neto_pagar_delta_cents: newNetoCents - prevNetoCents,
        },
      };

      det.review_resolved = true;
      det.review_resolution = reviewResolution;
      det.minor_units_cents = {
        currency: 'DOP',
        salario_fijo_cents: newSalarioCents,
        comisiones_cents: newComisionesCents,
        feriados_cents: newFeriadosCents,
        horas_extras_cents: newHorasExtrasCents,
        otros_ingresos_cents: newOtrosIngCents,
        total_ingresos_cents: newTotalIngCents,
        tss_cents: newTssCents,
        servicios_cents: newServiciosCents,
        prestamos_cents: newPrestamosCents,
        ausencias_cents: newAusenciasCents,
        tardanzas_cents: newTardanzasCents,
        otros_descuentos_cents: newOtrosDescCents,
        total_descuentos_cents: newTotalDescCents,
        neto_pagar_cents: newNetoCents,
      };

      await conn.query(`
        UPDATE payroll_items
        SET salario_fijo = ?, comisiones = ?, feriados = ?, horas_extras = ?, otros_ingresos = ?, total_ingresos = ?,
            tss = ?, servicios = ?, prestamos = ?, ausencias = ?, tardanzas = ?, otros_descuentos = ?, total_descuentos = ?,
            neto_pagar = ?, detalles_json = ?
        WHERE id = ? AND payroll_id = ? AND tenant_id = ?
      `, [
        fromCents(newSalarioCents), fromCents(newComisionesCents), fromCents(newFeriadosCents), fromCents(newHorasExtrasCents), fromCents(newOtrosIngCents), fromCents(newTotalIngCents),
        fromCents(newTssCents), fromCents(newServiciosCents), fromCents(newPrestamosCents), fromCents(newAusenciasCents), fromCents(newTardanzasCents), fromCents(newOtrosDescCents), fromCents(newTotalDescCents),
        fromCents(newNetoCents), JSON.stringify(det),
        itemId, payrollId, tenantId,
      ]);

      // Recalcular totales del período en centavos
      const [allItems] = await conn.query(
        'SELECT * FROM payroll_items WHERE payroll_id = ? AND tenant_id = ? ORDER BY id ASC',
        [payrollId, tenantId]
      );
      let sumIngCents = 0;
      let sumDescCents = 0;
      let sumNetoCents = 0;
      for (const row of allItems) {
        sumIngCents += toCents(row.total_ingresos);
        sumDescCents += toCents(row.total_descuentos);
        sumNetoCents += toCents(row.neto_pagar);
      }

      await conn.query(
        'UPDATE payroll_periods SET total_ingresos = ?, total_descuentos = ?, total_neto = ?, total_empleados = ? WHERE id = ? AND tenant_id = ?',
        [fromCents(sumIngCents), fromCents(sumDescCents), fromCents(sumNetoCents), allItems.length, payrollId, tenantId]
      );

      await conn.query(`
        INSERT INTO payroll_audit_logs (payroll_id, employee_id, employee_name, field_name, old_value, new_value, action_type, reason, user_name, tenant_id)
        VALUES (?, ?, ?, 'REVISION_INDIVIDUAL', ?, ?, ?, ?, ?, ?)
      `, [
        payrollId,
        it.employee_id,
        it.employee_name,
        `salario=${fromCents(prevSalarioCents)}|neto=${fromCents(prevNetoCents)}`,
        `salario=${fromCents(newSalarioCents)}|neto=${fromCents(newNetoCents)}|delta=${fromCents(newNetoCents - prevNetoCents)}`,
        decision === 'adjust' ? 'Resolución con Ajuste' : 'Resolución Aceptada',
        cleanReason.slice(0, 250),
        actorName,
        tenantId,
      ]);

      await conn.commit();

      const updatedItem = allItems.find((row) => String(row.id) === String(itemId));
      const parsedAll = allItems.map((row) => ({
        ...row,
        detalles_json: typeof row.detalles_json === 'string' ? JSON.parse(row.detalles_json || '{}') : (row.detalles_json || {}),
      }));

      return res.json({
        success: true,
        item: {
          ...updatedItem,
          detalles_json: det,
        },
        resolution: reviewResolution,
        review_summary: buildReviewSummary(parsedAll),
      });
    } catch (err) {
      await conn.rollback().catch(() => { });
      console.error('[PAYROLL RESOLVE REVIEW ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    } finally {
      conn.release();
    }
  });

  /**
   * Helper para calcular de forma 100% real los valores de nómina de un empleado
   */
  async function calculateEmployeePayrollValues(pool, emp, start_date, end_date, tenantId) {
    const empId = String(emp.id);
    const empName = emp.nombre || 'Colaborador';
    const posicion = emp.posicion || 'General';
    const sucursalEmp = emp.localidad || (emp.salon_id == 2 ? 'Villa Mella' : 'San Vicente');

    let salarioFijo = parseFloat(emp.salario_base || 0.00);
    if (salarioFijo > 0) {
      salarioFijo = Number((salarioFijo / 2).toFixed(2));
    }
    const tipoSalario = (emp.tipo_salario || 'fijo_mas_comision').toLowerCase();

    // 1. COMISIONES REALES (Scoped strictly by tenant_id)
    let comisiones = 0.00;
    if (tipoSalario !== 'fijo_puro' && tipoSalario !== 'solo_fijo') {
      try {
        const [commRows] = await pool.query(`
          SELECT COALESCE(SUM(monto_comision), 0) as total_comm 
          FROM employee_commissions_log 
          WHERE tenant_id = ?
            AND (employee_id::text = ? OR employee_id::text = ? OR employee_name = ?)
            AND created_at >= ? AND created_at <= ?
            AND COALESCE(status, 'Pendiente') NOT IN ('Anulada', 'Pagada', 'Pagado')
            AND payout_id IS NULL
        `, [tenantId, empId, `EMP-${empId}`, empName, `${start_date} 00:00:00-04:00`, `${end_date} 23:59:59.999-04:00`]);
        comisiones = Number(parseFloat(commRows[0]?.total_comm || 0).toFixed(2));
      } catch (e) {
        console.warn(`[COMMISSIONS CALC WARN for ${empName}]:`, e.message);
      }
    }

    // 2. DESCUENTOS REALES (Scoped strictly by tenant_id)
    let serviciosConsumo = 0.00;
    let prestamosMonto = 0.00;
    let ausenciasMonto = 0.00;
    let tardanzasMonto = 0.00;
    let otrosDescuentos = 0.00;
    const descuentosItemsList = [];

    try {
      const [discountRows] = await pool.query(`
        SELECT id, type, amount, notes, status, TO_CHAR(date, 'YYYY-MM-DD') as d_date
        FROM employee_discounts
        WHERE tenant_id = ?
          AND (employee_id::text = ? OR employee_id::text = ? OR employee_name = ?)
          AND date BETWEEN ? AND ?
          AND COALESCE(status, 'Pendiente') NOT IN ('Anulado', 'Saldado')
      `, [tenantId, empId, `EMP-${empId}`, empName, start_date, end_date]);

      for (const d of discountRows) {
        const amt = Number(parseFloat(d.amount || 0).toFixed(2));
        const typeLower = (d.type || '').toLowerCase();
        if (typeLower.includes('servicio')) {
          serviciosConsumo += amt;
        } else if (typeLower.includes('prestamo') || typeLower.includes('préstamo') || typeLower.includes('adelanto')) {
          prestamosMonto += amt;
        } else if (typeLower.includes('ausencia')) {
          ausenciasMonto += amt;
        } else if (typeLower.includes('tardanza')) {
          tardanzasMonto += amt;
        } else {
          otrosDescuentos += amt;
        }

        descuentosItemsList.push({
          id: `d_db_${d.id}`,
          label: `${d.type || 'Descuento'}${d.notes ? ' - ' + d.notes : ''}`,
          monto: amt,
          db_id: d.id
        });
      }
    } catch (e) {
      console.warn(`[EMPLOYEE DISCOUNTS CALC WARN for ${empName}]:`, e.message);
    }

    // 3. ASISTENCIA: Ausencias, Tardanzas, Turnos nocturnos (cruce de medianoche) e Ingreso/Salida parcial
    const cfg = await getCalculationSettings(pool, tenantId);
    const salarioBaseGarantizado = parseFloat(cfg.salario_mensual_base || 18421.00);
    const diasLaboralesMes = parseFloat(cfg.dias_laborables_mes || 23.83);
    const horasDiaCompleto = parseFloat(cfg.horas_jornada_completa || 8.00);
    const horasMediaJornada = parseFloat(cfg.horas_media_jornada || 4.00);
    const recargoHorasExtras = parseFloat(cfg.recargo_horas_extras || 1.35);
    const recargoFeriado = parseFloat(cfg.recargo_feriado || 1.00);

    const salarioDiarioGarantizado = salarioBaseGarantizado / diasLaboralesMes;
    const salarioHoraGarantizado = salarioDiarioGarantizado / horasDiaCompleto;
    const salarioMinutoGarantizado = salarioHoraGarantizado / 60;

    let feriados = 0.00;
    let horasExtras = 0.00;

    const reviewFlags = [];
    const attendanceBreakdown = [];

    // 3a. Detectar ingreso o salida a mitad de período (sin aprobar quincena completa silenciosamente)
    const hireDate = toIsoDateOnly(emp.fecha_entrada);
    const termDate = toIsoDateOnly(emp.fecha_salida);
    if (hireDate && hireDate > start_date && hireDate <= end_date) {
      reviewFlags.push({
        code: 'MID_PERIOD_HIRE',
        severity: 'warning',
        date: hireDate,
        message: `Ingreso durante el período (${hireDate}). Requiere revisión/prorrateo manual antes de aprobar.`,
      });
    }
    if (termDate && termDate >= start_date && termDate < end_date) {
      reviewFlags.push({
        code: 'MID_PERIOD_TERMINATION',
        severity: 'warning',
        date: termDate,
        message: `Salida durante el período (${termDate}). Requiere revisión/prorrateo manual antes de aprobar.`,
      });
    }

    // Separar control anti-duplicación por concepto (manual vs automático)
    const hasManualAbsenceDiscount = ausenciasMonto > 0;
    const hasManualLatenessDiscount = tardanzasMonto > 0;
    if (hasManualAbsenceDiscount) {
      attendanceBreakdown.push({
        type: 'Ausencia',
        source: 'manual_discount',
        rule_used: 'Descuento manual autorizado en employee_discounts (suprime deducción automática de ausencia)',
        base_salary_monthly: salarioBaseGarantizado,
        amount: ausenciasMonto,
        amount_cents: toCents(ausenciasMonto),
      });
    }
    if (hasManualLatenessDiscount) {
      attendanceBreakdown.push({
        type: 'Tardanza',
        source: 'manual_discount',
        rule_used: 'Descuento manual autorizado en employee_discounts (suprime deducción automática de tardanza)',
        base_salary_monthly: salarioBaseGarantizado,
        amount: tardanzasMonto,
        amount_cents: toCents(tardanzasMonto),
      });
    }

    try {
      const extendedEndDate = addDaysIso(end_date, 1);
      const [attPunches] = await pool.query(`
        SELECT id, type, status, lateness_minutes, extra_minutes, timestamp, TO_CHAR(timestamp, 'YYYY-MM-DD') as p_date
        FROM attendance
        WHERE tenant_id = ?
          AND (employee_id = ? OR employee_id = ?) 
          AND DATE(timestamp) BETWEEN ? AND ?
        ORDER BY timestamp ASC
      `, [tenantId, empId, empName, start_date, extendedEndDate]);

      // 3b. Detectar turnos que cruzan medianoche (Check-In en día D sin Check-Out ese día, seguido de Check-Out en D+1 <= 16h)
      const overnightConsumedIds = new Set();
      for (let i = 0; i < attPunches.length - 1; i++) {
        const cur = attPunches[i];
        const nxt = attPunches[i + 1];
        if (cur.type === 'Check-In' && nxt.type === 'Check-Out' && cur.p_date !== nxt.p_date) {
          const tIn = new Date(cur.timestamp).getTime();
          const tOut = new Date(nxt.timestamp).getTime();
          const diffHours = (tOut - tIn) / 3600000;
          if (diffHours > 0 && diffHours <= 16 && cur.p_date >= start_date && cur.p_date <= end_date) {
            overnightConsumedIds.add(cur.id);
            overnightConsumedIds.add(nxt.id);
            const workedMins = Math.round((tOut - tIn) / 60000);
            reviewFlags.push({
              code: 'OVERNIGHT_SHIFT_DETECTED',
              severity: 'warning',
              date: cur.p_date,
              check_in: cur.timestamp,
              check_out: nxt.timestamp,
              worked_minutes: workedMins,
              message: `Turno nocturno detectado (${cur.p_date} → ${nxt.p_date}, ${workedMins} min). No se trató como ponches independientes ni se descontó automáticamente; requiere revisión.`,
            });
            attendanceBreakdown.push({
              type: 'TurnoNocturno',
              source: 'automatic_detection',
              date: cur.p_date,
              minutes: workedMins,
              rule_used: 'Cruce de medianoche detectado (pendiente de regla de turno nocturno; sin deducción automática)',
              amount: 0,
              amount_cents: 0,
            });
          }
        }
      }

      const punchesByDay = {};
      attPunches.forEach(p => {
        if (overnightConsumedIds.has(p.id)) return;
        if (p.p_date < start_date || p.p_date > end_date) return;
        if (!punchesByDay[p.p_date]) punchesByDay[p.p_date] = [];
        punchesByDay[p.p_date].push(p);
      });

      let totalNetLatenessMins = 0;
      let totalOvertimeMins = 0;
      let totalCalculatedAusenciasCents = 0;
      let totalAbsenceDays = 0;

      Object.keys(punchesByDay).forEach(dateStr => {
        const dayPunches = punchesByDay[dateStr];
        const ins = dayPunches.filter(p => p.type === 'Check-In');
        const outs = dayPunches.filter(p => p.type === 'Check-Out');
        const abs = dayPunches.find(p => p.type === 'Ausencia');

        if (abs && ins.length === 0) {
          totalAbsenceDays += 1;
          if (!hasManualAbsenceDiscount) {
            const descuentoDiaCents = toCents(horasDiaCompleto * salarioHoraGarantizado);
            totalCalculatedAusenciasCents += descuentoDiaCents;
            attendanceBreakdown.push({
              type: 'Ausencia',
              source: 'automatic_attendance',
              date: dateStr,
              days: 1,
              hours: horasDiaCompleto,
              base_salary_monthly: salarioBaseGarantizado,
              rule_used: `Jornada completa (${horasDiaCompleto}h × RD$${salarioHoraGarantizado.toFixed(2)}/h sobre base RD$${salarioBaseGarantizado})`,
              amount: fromCents(descuentoDiaCents),
              amount_cents: descuentoDiaCents,
            });
          }
        } else if (ins.length > 0) {
          const checkIn = ins[0];
          const checkOut = outs.length > 0 ? outs[outs.length - 1] : null;
          const morningLate = Number(checkIn.lateness_minutes) || 0;

          if (checkOut) {
            const inTime = new Date(checkIn.timestamp).getTime();
            const outTime = new Date(checkOut.timestamp).getTime();
            if (outTime > inTime) {
              const workedSecs = Math.max(0, Math.round((outTime - inTime) / 1000));
              const scheduledSecs = horasDiaCompleto * 3600;
              if (workedSecs >= scheduledSecs) {
                const surplusSecs = workedSecs - scheduledSecs;
                totalOvertimeMins += Math.round(surplusSecs / 60);
              } else {
                const missingMins = Math.round((scheduledSecs - workedSecs) / 60);
                totalNetLatenessMins += missingMins;
                if (!hasManualLatenessDiscount && missingMins > 0) {
                  const lateCents = toCents(missingMins * salarioMinutoGarantizado);
                  attendanceBreakdown.push({
                    type: 'Tardanza',
                    source: 'automatic_attendance',
                    date: dateStr,
                    minutes: missingMins,
                    base_salary_monthly: salarioBaseGarantizado,
                    rule_used: `Minutos faltantes jornada (${missingMins} min × RD$${salarioMinutoGarantizado.toFixed(4)}/min)`,
                    amount: fromCents(lateCents),
                    amount_cents: lateCents,
                  });
                }
              }
            }
          } else if (morningLate > 0) {
            totalNetLatenessMins += morningLate;
            if (!hasManualLatenessDiscount) {
              const lateCents = toCents(morningLate * salarioMinutoGarantizado);
              attendanceBreakdown.push({
                type: 'Tardanza',
                source: 'automatic_attendance',
                date: dateStr,
                minutes: morningLate,
                base_salary_monthly: salarioBaseGarantizado,
                rule_used: `Minutos de tardanza en entrada (${morningLate} min × RD$${salarioMinutoGarantizado.toFixed(4)}/min)`,
                amount: fromCents(lateCents),
                amount_cents: lateCents,
              });
            }
          }
        }
      });

      if (!hasManualAbsenceDiscount && totalCalculatedAusenciasCents > 0) {
        ausenciasMonto = fromCents(totalCalculatedAusenciasCents);
      }
      if (!hasManualLatenessDiscount && totalNetLatenessMins > 0) {
        tardanzasMonto = fromCents(toCents(totalNetLatenessMins * salarioMinutoGarantizado));
      }
      if (totalOvertimeMins > 0) {
        horasExtras = fromCents(toCents(totalOvertimeMins * salarioMinutoGarantizado * recargoHorasExtras));
      }
    } catch (e) {
      console.warn(`[ATTENDANCE CALC WARN for ${empName}]:`, e.message);
    }

    // 4. FERIADOS (Scoped by tenant_id)
    try {
      const [periodHolidays] = await pool.query(`
        SELECT TO_CHAR(date, 'YYYY-MM-DD') as holiday_date, name, rate_multiplier 
        FROM holidays 
        WHERE tenant_id = ? AND date BETWEEN ? AND ? AND is_active = 1
      `, [tenantId, start_date, end_date]);

      if (periodHolidays.length > 0) {
        const holidayDates = periodHolidays.map(h => h.holiday_date);
        const [holidayPunches] = await pool.query(`
          SELECT id, type, timestamp, TO_CHAR(timestamp, 'YYYY-MM-DD') as punch_date
          FROM attendance
          WHERE tenant_id = ?
            AND (employee_id = ? OR employee_id = ?)
            AND DATE(timestamp) IN (?)
          ORDER BY timestamp ASC
        `, [tenantId, empId, empName, holidayDates]);

        const punchesByDate = {};
        holidayPunches.forEach(p => {
          if (!punchesByDate[p.punch_date]) punchesByDate[p.punch_date] = [];
          punchesByDate[p.punch_date].push(p);
        });

        periodHolidays.forEach(h => {
          const dayPunches = punchesByDate[h.holiday_date] || [];
          const ins = dayPunches.filter(p => p.type === 'Check-In');
          const outs = dayPunches.filter(p => p.type === 'Check-Out');
          if (ins.length > 0) {
            const inTime = new Date(ins[0].timestamp).getTime();
            let outTime = outs.length > 0 ? new Date(outs[outs.length - 1].timestamp).getTime() : null;
            let workedHours = 0;
            if (outTime && outTime > inTime) {
              const mins = Math.floor((outTime - inTime) / 60000);
              workedHours = Number((mins / 60).toFixed(2));
            } else {
              workedHours = horasDiaCompleto;
            }

            const multiplier = parseFloat(recargoFeriado !== undefined ? recargoFeriado : (h.rate_multiplier || 1.00));
            const holidayPay = Number((workedHours * salarioHoraGarantizado * multiplier).toFixed(2));
            feriados += holidayPay;
          }
        });
        feriados = Number(feriados.toFixed(2));
      }
    } catch (hErr) { }

    let otrosIngresos = 0.00;
    const ingresosItemsList = [];

    // 4.1. EVALUAR REGLAS ESPECIALES (Fallback solo si no se generó ya como Bono_Meta en employee_commissions_log)
    if (emp.commission_scheme_id) {
      try {
        const [countRules] = await pool.query(
          "SELECT * FROM commission_scheme_rules WHERE tenant_id = ? AND scheme_id = ? AND rule_type = 'especial' AND operacion = 'Contar'",
          [tenantId, emp.commission_scheme_id]
        );
        for (const cr of countRules) {
          const targetCount = parseInt(cr.cantidad_meta) || 0;
          const bonusAmt = parseFloat(cr.bono_monto) || 0;
          if (targetCount > 0 && bonusAmt > 0 && cr.service_name) {
            const [alreadyAwarded] = await pool.query(
              `SELECT COUNT(*) AS cnt FROM employee_commissions_log
               WHERE tenant_id = ?
                 AND (employee_id::text = ? OR employee_id::text = ? OR employee_name = ?)
                 AND visit_id LIKE ?
                 AND created_at >= ? AND created_at <= ?
                 AND COALESCE(status, 'Pendiente') != 'Anulada'`,
              [tenantId, empId, `EMP-${empId}`, empName, `BONO-META-${cr.id}-%`, `${start_date} 00:00:00-04:00`, `${end_date} 23:59:59.999-04:00`]
            );
            if (Number(alreadyAwarded?.[0]?.cnt || 0) > 0) {
              continue; // Ya incluido automáticamente en la columna de comisiones
            }

            const [performed] = await pool.query(`
              SELECT COALESCE(SUM(cantidad), 0) as count 
              FROM employee_commissions_log 
              WHERE tenant_id = ?
                AND (employee_id::text = ? OR employee_id::text = ? OR employee_name = ?)
                AND LOWER(TRIM(service_name)) = LOWER(TRIM(?))
                AND visit_id NOT LIKE 'BONO-META-%'
                AND created_at >= ? AND created_at <= ?
                AND COALESCE(status, 'Pendiente') != 'Anulada'
            `, [tenantId, empId, `EMP-${empId}`, empName, cr.service_name, `${start_date} 00:00:00-04:00`, `${end_date} 23:59:59.999-04:00`]);

            const totalPerformed = Number(performed[0]?.count || 0);
            const completedGoals = Math.floor(totalPerformed / targetCount);
            if (completedGoals >= 1) {
              const repStr = String(cr.repeticion || '').toLowerCase();
              const times = repStr.includes('sin l') ? completedGoals : (repStr.includes('dos') ? Math.min(2, completedGoals) : 1);
              const totalBonus = Number((bonusAmt * times).toFixed(2));
              otrosIngresos += totalBonus;
              ingresosItemsList.push({
                id: `bono_meta_${cr.id}`,
                label: `Bono Meta: ${cr.service_name} (${totalPerformed}/${targetCount})`,
                monto: totalBonus
              });
            }
          }
        }
      } catch (err) {
        console.warn(`[BONUS CONTAR CALC WARN for ${empName}]:`, err.message);
      }
    }
    otrosIngresos = Number(otrosIngresos.toFixed(2));

    // 5. TSS y aritmética exacta en unidades menores (centavos DOP)
    const salarioFijoCents = toCents(salarioFijo);
    const comisionesCents = toCents(comisiones);
    const feriadosCents = toCents(feriados);
    const horasExtrasCents = toCents(horasExtras);
    const otrosIngresosCents = toCents(otrosIngresos);

    const tssCents = salarioFijoCents > 0 ? Math.round(salarioFijoCents * 0.0591) : 0;
    const serviciosCents = toCents(serviciosConsumo);
    const prestamosCents = toCents(prestamosMonto);
    const ausenciasCents = toCents(ausenciasMonto);
    const tardanzasCents = toCents(tardanzasMonto);
    const otrosDescuentosCents = toCents(otrosDescuentos);

    const totalIngresosCents = salarioFijoCents + comisionesCents + feriadosCents + horasExtrasCents + otrosIngresosCents;
    const totalDescuentosCents = tssCents + serviciosCents + prestamosCents + ausenciasCents + tardanzasCents + otrosDescuentosCents;
    const netoPagarCents = totalIngresosCents - totalDescuentosCents;

    salarioFijo = fromCents(salarioFijoCents);
    comisiones = fromCents(comisionesCents);
    feriados = fromCents(feriadosCents);
    horasExtras = fromCents(horasExtrasCents);
    otrosIngresos = fromCents(otrosIngresosCents);
    const tss = fromCents(tssCents);
    serviciosConsumo = fromCents(serviciosCents);
    prestamosMonto = fromCents(prestamosCents);
    ausenciasMonto = fromCents(ausenciasCents);
    tardanzasMonto = fromCents(tardanzasCents);
    otrosDescuentos = fromCents(otrosDescuentosCents);

    const totalIngresos = fromCents(totalIngresosCents);
    const totalDescuentos = fromCents(totalDescuentosCents);
    const netoPagar = fromCents(netoPagarCents);

    return {
      employee_id: empId,
      employee_name: empName,
      posicion: posicion,
      sucursal: sucursalEmp,
      departamento: posicion,
      salario_fijo: salarioFijo,
      comisiones: comisiones,
      feriados: feriados,
      horas_extras: horasExtras,
      otros_ingresos: otrosIngresos,
      total_ingresos: totalIngresos,
      tss: tss,
      servicios: serviciosConsumo,
      prestamos: prestamosMonto,
      ausencias: ausenciasMonto,
      tardanzas: tardanzasMonto,
      otros_descuentos: otrosDescuentos,
      total_descuentos: totalDescuentos,
      neto_pagar: netoPagar,
      tenant_id: tenantId,
      detalles_json: {
        requires_review: reviewFlags.length > 0,
        review_resolved: reviewFlags.length === 0,
        review_flags: reviewFlags,
        attendance_deductions_breakdown: {
          manual_absence_override: hasManualAbsenceDiscount,
          manual_lateness_override: hasManualLatenessDiscount,
          events: attendanceBreakdown,
        },
        minor_units_cents: {
          currency: 'DOP',
          salario_fijo_cents: salarioFijoCents,
          comisiones_cents: comisionesCents,
          feriados_cents: feriadosCents,
          horas_extras_cents: horasExtrasCents,
          otros_ingresos_cents: otrosIngresosCents,
          total_ingresos_cents: totalIngresosCents,
          tss_cents: tssCents,
          servicios_cents: serviciosCents,
          prestamos_cents: prestamosCents,
          ausencias_cents: ausenciasCents,
          tardanzas_cents: tardanzasCents,
          otros_descuentos_cents: otrosDescuentosCents,
          total_descuentos_cents: totalDescuentosCents,
          neto_pagar_cents: netoPagarCents,
        },
        deductions_policy_metadata: {
          tss: {
            rate: 0.0591,
            components: { sfs: 0.0304, afp: 0.0287 },
            base_concept: 'salario_fijo_quincenal',
            cap_applied: false,
            isr_applied: false,
            source: 'software_default_parameter',
            note: 'Parámetro configurado en software (5.91% sobre salario fijo sin topes salariales SFS/AFP ni retención ISR automática). Verificar contra resoluciones vigentes TSS/DGII RD.',
          },
        },
        conceptos_ingresos: [
          { id: 'c1', label: 'Salario fijo', monto: salarioFijo },
          { id: 'c2', label: 'Comisiones', monto: comisiones },
          { id: 'c3', label: 'Feriados', monto: feriados },
          { id: 'c4', label: 'Horas extras', monto: horasExtras },
          { id: 'c5', label: 'Otros ingresos / Bonos', monto: otrosIngresos },
          ...ingresosItemsList
        ],
        conceptos_descuentos: [
          { id: 'd1', label: 'TSS (Ley 5.91%)', monto: tss },
          { id: 'd2', label: 'Servicios de Empresa', monto: serviciosConsumo },
          { id: 'd3', label: 'Préstamos / Adelantos', monto: prestamosMonto },
          { id: 'd4', label: 'Ausencias', monto: ausenciasMonto },
          { id: 'd5', label: 'Tardanzas', monto: tardanzasMonto },
          { id: 'd6', label: 'Otros descuentos', monto: otrosDescuentos },
          ...descuentosItemsList
        ]
      }
    };
  }

  /**
   * Evalúa todos los colaboradores de staff_records del tenant frente a un período de nómina
   * sin exigir cuenta de usuario (users) facturable y devolviendo motivos explícitos de exclusión.
   */
  async function evaluateTenantStaffForPayrollPeriod(executor, tenantId, { start_date, end_date, sucursal = 'Todas', departamento = 'Todos' }) {
    const [allStaff] = await executor.query(
      `SELECT s.*,
              b.name AS branch_name,
              sal.name AS salon_ref_name
       FROM staff_records s
       LEFT JOIN branches b ON s.salon_id::text = b.id::text AND b.tenant_id = s.tenant_id
       LEFT JOIN salons sal ON s.salon_id::text = sal.id::text AND sal.tenant_id = s.tenant_id
       WHERE s.tenant_id = ?
       ORDER BY s.id ASC`,
      [tenantId]
    );

    const eligible = [];
    const excluded = [];

    const normText = (v) => String(v || '').trim().toLowerCase();
    const stripBranchPrefix = (v) => {
      const s = normText(v);
      const parts = s.split(' - ');
      return parts[parts.length - 1].trim();
    };

    const filterSuc = normText(sucursal);
    const hasSucFilter = Boolean(filterSuc && filterSuc !== 'todas' && filterSuc !== 'all');
    const filterSucShort = stripBranchPrefix(sucursal);

    const filterDept = normText(departamento);
    const hasDeptFilter = Boolean(filterDept && filterDept !== 'todos' && filterDept !== 'todas' && filterDept !== 'all');

    for (const emp of (allStaff || [])) {
      const empId = String(emp.id);
      const empName = emp.nombre || 'Colaborador';
      const posicion = emp.posicion || 'General';
      const empBranchLabel = emp.branch_name || emp.salon_ref_name || emp.localidad || 'Principal';
      const rawStatus = String(emp.status || 'Activo').trim();
      const statusLower = rawStatus.toLowerCase();
      const hireDate = toIsoDateOnly(emp.fecha_entrada);
      const termDate = toIsoDateOnly(emp.fecha_salida);

      // 1. Validar estado laboral y fecha de salida
      const isActiveStatus = statusLower === 'activo' || statusLower === 'active' || statusLower === '';
      const hasExitInPeriod = Boolean(termDate && start_date && end_date && termDate >= start_date && termDate <= end_date);

      if (!isActiveStatus && !hasExitInPeriod) {
        excluded.push({
          employee_id: empId,
          employee_name: empName,
          posicion,
          sucursal: empBranchLabel,
          status: rawStatus,
          fecha_entrada: hireDate,
          fecha_salida: termDate,
          reason_code: 'INACTIVE_STATUS',
          reason: termDate && start_date && termDate < start_date
            ? `Excluido: Fecha de salida (${termDate}) anterior al inicio del período (${start_date}).`
            : `Excluido: Estado laboral "${rawStatus}" (no activo durante el período ${start_date} al ${end_date}).`,
        });
        continue;
      }

      if (termDate && start_date && termDate < start_date) {
        excluded.push({
          employee_id: empId,
          employee_name: empName,
          posicion,
          sucursal: empBranchLabel,
          status: rawStatus,
          fecha_entrada: hireDate,
          fecha_salida: termDate,
          reason_code: 'TERMINATED_BEFORE_PERIOD',
          reason: `Excluido: Fecha de salida (${termDate}) anterior al inicio del período (${start_date}).`,
        });
        continue;
      }

      // 2. Validar fecha de ingreso frente al cierre del período
      if (hireDate && end_date && hireDate > end_date) {
        excluded.push({
          employee_id: empId,
          employee_name: empName,
          posicion,
          sucursal: empBranchLabel,
          status: rawStatus,
          fecha_entrada: hireDate,
          fecha_salida: termDate,
          reason_code: 'HIRED_AFTER_PERIOD_END',
          reason: `Excluido: Fecha de ingreso (${hireDate}) posterior al cierre del período seleccionado (${end_date}).`,
        });
        continue;
      }

      // 3. Validar filtro de sucursal
      if (hasSucFilter) {
        const candidates = [
          String(emp.salon_id || ''),
          emp.localidad,
          emp.branch_name,
          emp.salon_ref_name,
          stripBranchPrefix(emp.localidad),
          stripBranchPrefix(emp.branch_name),
        ].map(normText).filter(Boolean);

        const matchesBranch = candidates.some((c) =>
          c === filterSuc ||
          c === filterSucShort ||
          c.includes(filterSuc) ||
          filterSuc.includes(c) ||
          (filterSucShort && (c.includes(filterSucShort) || filterSucShort.includes(c)))
        );

        if (!matchesBranch) {
          excluded.push({
            employee_id: empId,
            employee_name: empName,
            posicion,
            sucursal: empBranchLabel,
            status: rawStatus,
            fecha_entrada: hireDate,
            fecha_salida: termDate,
            reason_code: 'BRANCH_FILTER_MISMATCH',
            reason: `Excluido por filtro de sucursal: asignado a "${empBranchLabel}" (período filtrado por "${sucursal}").`,
          });
          continue;
        }
      }

      // 4. Validar filtro de departamento / cargo
      if (hasDeptFilter) {
        const posNorm = normText(emp.posicion);
        if (!posNorm.includes(filterDept) && !filterDept.includes(posNorm)) {
          excluded.push({
            employee_id: empId,
            employee_name: empName,
            posicion,
            sucursal: empBranchLabel,
            status: rawStatus,
            fecha_entrada: hireDate,
            fecha_salida: termDate,
            reason_code: 'DEPARTMENT_FILTER_MISMATCH',
            reason: `Excluido por filtro de cargo/departamento: "${posicion}" no coincide con "${departamento}".`,
          });
          continue;
        }
      }

      eligible.push({
        ...emp,
        localidad: empBranchLabel,
      });
    }

    return { allStaff: allStaff || [], eligible, excluded };
  }

  // 3. Generar / Procesar Nómina Automática con Datos Reales (Atómico con lock por empresa y anti-duplicado)
  router.post('/generate', requirePermission('payroll.generate'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const tenantId = req.verifiedTenantId;
      const {
        period_name,
        start_date,
        end_date,
        sucursal = 'Todas',
        departamento = 'Todos'
      } = req.body;

      if (!period_name || !start_date || !end_date) {
        return res.status(400).json({ error: 'El nombre del período y las fechas de inicio y fin son obligatorios' });
      }

      const authBranches = await resolveAuthorizedBranchDescriptors(req, tenantId);
      if (!isSucursalAllowedForActor(sucursal, authBranches)) {
        return res.status(403).json({
          error: 'No tienes permiso para generar nómina fuera de tus sucursales autorizadas.',
          code: 'FORBIDDEN_BRANCH_SCOPE'
        });
      }

      await conn.beginTransaction();
      // Lock por empresa para impedir creación concurrente de períodos duplicados
      await conn.query('SELECT id FROM tenants WHERE id = ? FOR UPDATE', [tenantId]);

      const [dupPeriods] = await conn.query(
        `SELECT id, status FROM payroll_periods
         WHERE tenant_id = ? AND start_date = ? AND end_date = ?
           AND COALESCE(sucursal, 'Todas') = ? AND COALESCE(departamento, 'Todos') = ?
         LIMIT 1`,
        [tenantId, start_date, end_date, sucursal, departamento]
      );
      if (dupPeriods && dupPeriods.length > 0) {
        await conn.rollback();
        return res.status(409).json({
          error: `Ya existe un período de nómina (#${dupPeriods[0].id}, estado ${dupPeriods[0].status}) para esas fechas y alcance. Recalcula el borrador existente en lugar de duplicarlo.`,
          code: 'PAYROLL_DUPLICATE_PERIOD',
          existing_payroll_id: dupPeriods[0].id
        });
      }

      // 1. Evaluar todos los colaboradores de staff_records del tenant (sin exigir cuenta en users) y registrar motivos de exclusión
      const evalStaff = await evaluateTenantStaffForPayrollPeriod(conn, tenantId, {
        start_date,
        end_date,
        sucursal,
        departamento,
      });
      const staffList = evalStaff.eligible;

      if (staffList.length === 0) {
        await conn.rollback();
        const exclusionSummary = evalStaff.excluded.length > 0
          ? ` Se evaluaron ${evalStaff.allStaff.length} colaborador(es), pero quedaron excluidos: ${evalStaff.excluded.map((e) => `${e.employee_name} (${e.reason})`).join('; ')}`
          : '';
        return res.status(400).json({
          error: `No se encontraron colaboradores elegibles para procesar la nómina en este período.${exclusionSummary}`,
          excluded_employees: evalStaff.excluded,
        });
      }

      // 2. Crear registro del período con tenant_id
      const [periodRes] = await conn.query(`
        INSERT INTO payroll_periods (period_name, start_date, end_date, sucursal, departamento, status, tenant_id)
        VALUES (?, ?, ?, ?, ?, 'En preparación', ?)
        RETURNING id
      `, [period_name, start_date, end_date, sucursal, departamento, tenantId]);
      const payrollId = periodRes.insertId || periodRes[0]?.id;

      let sumTotalIngresos = 0;
      let sumTotalDescuentos = 0;
      let sumTotalNeto = 0;
      const generatedItems = [];

      // 3. Procesar y calcular cada empleado de forma 100% real
      for (const emp of staffList) {
        const itemData = await calculateEmployeePayrollValues(conn, emp, start_date, end_date, tenantId);
        itemData.payroll_id = payrollId;

        const [resItem] = await conn.query(`
          INSERT INTO payroll_items (
            payroll_id, employee_id, employee_name, posicion, sucursal, departamento,
            salario_fijo, comisiones, feriados, horas_extras, otros_ingresos, total_ingresos,
            tss, servicios, prestamos, ausencias, tardanzas, otros_descuentos, total_descuentos,
            neto_pagar, detalles_json, tenant_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          itemData.payroll_id, itemData.employee_id, itemData.employee_name, itemData.posicion, itemData.sucursal, itemData.departamento,
          itemData.salario_fijo, itemData.comisiones, itemData.feriados, itemData.horas_extras, itemData.otros_ingresos, itemData.total_ingresos,
          itemData.tss, itemData.servicios, itemData.prestamos, itemData.ausencias, itemData.tardanzas, itemData.otros_descuentos, itemData.total_descuentos,
          itemData.neto_pagar, JSON.stringify(itemData.detalles_json), tenantId
        ]);

        itemData.id = resItem.insertId || resItem[0]?.id;
        generatedItems.push(itemData);

        sumTotalIngresos = Number((sumTotalIngresos + itemData.total_ingresos).toFixed(2));
        sumTotalDescuentos = Number((sumTotalDescuentos + itemData.total_descuentos).toFixed(2));
        sumTotalNeto = Number((sumTotalNeto + itemData.neto_pagar).toFixed(2));
      }

      // Hook controlado exclusivamente para pruebas de rollback atómico
      if (
        process.env.NODE_ENV === 'test' &&
        process.env.ALLOW_TEST_FAULT_INJECTION === 'true' &&
        req.headers['x-test-fail-payroll-generate'] === 'true'
      ) {
        throw new Error('SIMULATED_PAYROLL_GENERATE_FAILURE');
      }

      // 4. Actualizar totales del período
      await conn.query(`
        UPDATE payroll_periods 
        SET total_ingresos = ?, total_descuentos = ?, total_neto = ?, total_empleados = ?
        WHERE id = ? AND tenant_id = ?
      `, [sumTotalIngresos, sumTotalDescuentos, sumTotalNeto, generatedItems.length, payrollId, tenantId]);

      await conn.commit();

      res.json({
        success: true,
        payroll_id: payrollId,
        period: {
          id: payrollId,
          period_name,
          start_date,
          end_date,
          sucursal,
          departamento,
          status: 'En preparación',
          total_ingresos: sumTotalIngresos,
          total_descuentos: sumTotalDescuentos,
          total_neto: sumTotalNeto,
          total_empleados: generatedItems.length
        },
        items: generatedItems,
        excluded_employees: evalStaff.excluded
      });
    } catch (err) {
      await conn.rollback().catch(() => { });
      console.error('[PAYROLL GENERATE ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    } finally {
      conn.release();
    }
  });

  // 4. Guardar borrador / Actualizar items de nómina (Scoped strictly by tenant_id)
  router.post('/save-draft', requirePermission('payroll.generate'), async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      const { payroll_id, items, status = 'En preparación', reason = 'Ajuste de borrador', user_name = 'Administrador' } = req.body;
      if (!payroll_id || !Array.isArray(items)) {
        return res.status(400).json({ error: 'payroll_id e items son requeridos' });
      }
      if (!isPositiveIntId(payroll_id)) {
        return res.status(404).json({ error: 'Período no encontrado en esta empresa.' });
      }
      const cleanDraftStatus = String(status || 'En preparación').trim();
      if (!ALLOWED_DRAFT_STATUSES.has(cleanDraftStatus)) {
        return res.status(400).json({
          error: `Estatus de borrador inválido ('${cleanDraftStatus}'). Utiliza el flujo oficial de aprobación o pago.`,
          code: 'INVALID_DRAFT_STATUS'
        });
      }

      const authBranches = await resolveAuthorizedBranchDescriptors(req, tenantId);
      const [periodRows] = await pool.query(
        'SELECT status, is_immutable, sucursal FROM payroll_periods WHERE id = ? AND tenant_id = ?',
        [payroll_id, tenantId]
      );
      if (periodRows.length === 0) {
        return res.status(404).json({ error: 'Período no encontrado en esta empresa.' });
      }
      if (!isSucursalAllowedForActor(periodRows[0].sucursal, authBranches)) {
        return res.status(403).json({ error: 'No tienes permiso para modificar la nómina de esta sucursal.', code: 'FORBIDDEN_BRANCH_SCOPE' });
      }
      if (periodRows[0].status === 'Aprobada' || periodRows[0].status === 'Pagada' || Number(periodRows[0].is_immutable) === 1) {
        return res.status(403).json({ error: 'Esta nómina ya ha sido aprobada o pagada y es inmutable. No se pueden realizar modificaciones.', code: 'PAYROLL_IMMUTABLE' });
      }

      const [currentDbItems] = await pool.query(
        'SELECT * FROM payroll_items WHERE payroll_id = ? AND tenant_id = ?',
        [payroll_id, tenantId]
      );
      const currentMap = {};
      currentDbItems.forEach(it => { currentMap[it.id] = it; });

      let sumTotalIngresos = 0;
      let sumTotalDescuentos = 0;
      let sumTotalNeto = 0;

      for (const it of items) {
        const totalIngresos = Number((
          parseFloat(it.salario_fijo || 0) +
          parseFloat(it.comisiones || 0) +
          parseFloat(it.feriados || 0) +
          parseFloat(it.horas_extras || 0) +
          parseFloat(it.otros_ingresos || 0)
        ).toFixed(2));

        const totalDescuentos = Number((
          parseFloat(it.tss || 0) +
          parseFloat(it.servicios || 0) +
          parseFloat(it.prestamos || 0) +
          parseFloat(it.ausencias || 0) +
          parseFloat(it.tardanzas || 0) +
          parseFloat(it.otros_descuentos || 0)
        ).toFixed(2));

        const netoPagar = Number((totalIngresos - totalDescuentos).toFixed(2));

        sumTotalIngresos += totalIngresos;
        sumTotalDescuentos += totalDescuentos;
        sumTotalNeto += netoPagar;

        const oldItem = currentMap[it.id];
        if (oldItem && oldItem.neto_pagar !== netoPagar) {
          try {
            await pool.query(`
              INSERT INTO payroll_audit_logs (payroll_id, employee_id, employee_name, field_name, old_value, new_value, action_type, reason, user_name, tenant_id)
              VALUES (?, ?, ?, 'neto_pagar', ?, ?, 'Modificación Manual', ?, ?, ?)
            `, [payroll_id, it.employee_id, it.employee_name, String(oldItem.neto_pagar), String(netoPagar), reason, user_name, tenantId]);
          } catch (e) { }
        }

        const nextDetJson = (it.detalles_json && typeof it.detalles_json === 'object') ? { ...it.detalles_json } : {};
        if (oldItem && Math.abs(parseFloat(it.comisiones || 0) - parseFloat(oldItem.comisiones || 0)) > 0.009) {
          nextDetJson.manual_commissions_override = true;
        }

        await pool.query(`
          UPDATE payroll_items 
          SET salario_fijo = ?, comisiones = ?, feriados = ?, horas_extras = ?, otros_ingresos = ?, total_ingresos = ?,
              tss = ?, servicios = ?, prestamos = ?, ausencias = ?, tardanzas = ?, otros_descuentos = ?, total_descuentos = ?,
              neto_pagar = ?, detalles_json = ?
          WHERE id = ? AND payroll_id = ? AND tenant_id = ?
        `, [
          parseFloat(it.salario_fijo || 0), parseFloat(it.comisiones || 0), parseFloat(it.feriados || 0), parseFloat(it.horas_extras || 0), parseFloat(it.otros_ingresos || 0), totalIngresos,
          parseFloat(it.tss || 0), parseFloat(it.servicios || 0), parseFloat(it.prestamos || 0), parseFloat(it.ausencias || 0), parseFloat(it.tardanzas || 0), parseFloat(it.otros_descuentos || 0), totalDescuentos,
          netoPagar, JSON.stringify(nextDetJson),
          it.id, payroll_id, tenantId
        ]);
      }

      await pool.query(`
        UPDATE payroll_periods 
        SET total_ingresos = ?, total_descuentos = ?, total_neto = ?, total_empleados = ?, status = ?
        WHERE id = ? AND tenant_id = ?
      `, [sumTotalIngresos, sumTotalDescuentos, sumTotalNeto, items.length, cleanDraftStatus, payroll_id, tenantId]);

      res.json({ success: true, message: 'Borrador de nómina actualizado exitosamente' });
    } catch (err) {
      console.error('[PAYROLL SAVE DRAFT ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 5. Aplicar concepto masivo a selección de colaboradores (Scoped strictly by tenant_id)
  router.post('/bulk-apply', requirePermission('payroll.generate'), async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      const { payroll_id, item_ids, concept_name, concept_type, amount, is_percentage = false, percentage = 0 } = req.body;

      if (!payroll_id || !Array.isArray(item_ids) || item_ids.length === 0 || !concept_name || amount === undefined) {
        return res.status(400).json({ error: 'Parámetros incompletos para aplicación masiva' });
      }

      const [periodRows] = await pool.query(
        'SELECT status, is_immutable FROM payroll_periods WHERE id = ? AND tenant_id = ?',
        [payroll_id, tenantId]
      );
      if (periodRows.length === 0) return res.status(404).json({ error: 'Período no encontrado en esta empresa.' });
      if (periodRows[0].status === 'Aprobada' || periodRows[0].is_immutable === 1) {
        return res.status(403).json({ error: 'Esta nómina es inmutable' });
      }

      for (const itId of item_ids) {
        const [rows] = await pool.query(
          'SELECT * FROM payroll_items WHERE id = ? AND payroll_id = ? AND tenant_id = ?',
          [itId, payroll_id, tenantId]
        );
        if (rows.length === 0) continue;

        const it = rows[0];
        let calculatedAmount = parseFloat(amount || 0);
        if (is_percentage) {
          calculatedAmount = Number(((parseFloat(it.salario_fijo || 0) * parseFloat(percentage || 0)) / 100).toFixed(2));
        }

        const isIncome = concept_type.toLowerCase() === 'ingreso';
        const detalles = typeof it.detalles_json === 'string' ? JSON.parse(it.detalles_json || '{}') : (it.detalles_json || {});
        if (!detalles.conceptos_ingresos) detalles.conceptos_ingresos = [];
        if (!detalles.conceptos_descuentos) detalles.conceptos_descuentos = [];

        if (isIncome) {
          it.otros_ingresos = Number((parseFloat(it.otros_ingresos || 0) + calculatedAmount).toFixed(2));
          detalles.conceptos_ingresos.push({ id: `c_bulk_${Date.now()}`, label: concept_name, monto: calculatedAmount });
        } else {
          it.otros_descuentos = Number((parseFloat(it.otros_descuentos || 0) + calculatedAmount).toFixed(2));
          detalles.conceptos_descuentos.push({ id: `d_bulk_${Date.now()}`, label: concept_name, monto: calculatedAmount });
        }

        const totalIngresos = Number((
          parseFloat(it.salario_fijo || 0) + parseFloat(it.comisiones || 0) + parseFloat(it.feriados || 0) + parseFloat(it.horas_extras || 0) + parseFloat(it.otros_ingresos || 0)
        ).toFixed(2));

        const totalDescuentos = Number((
          parseFloat(it.tss || 0) + parseFloat(it.servicios || 0) + parseFloat(it.prestamos || 0) + parseFloat(it.ausencias || 0) + parseFloat(it.tardanzas || 0) + parseFloat(it.otros_descuentos || 0)
        ).toFixed(2));

        const netoPagar = Number((totalIngresos - totalDescuentos).toFixed(2));

        await pool.query(`
          UPDATE payroll_items 
          SET otros_ingresos = ?, otros_descuentos = ?, total_ingresos = ?, total_descuentos = ?, neto_pagar = ?, detalles_json = ?
          WHERE id = ? AND payroll_id = ? AND tenant_id = ?
        `, [it.otros_ingresos, it.otros_descuentos, totalIngresos, totalDescuentos, netoPagar, JSON.stringify(detalles), itId, payroll_id, tenantId]);

        try {
          await pool.query(`
            INSERT INTO payroll_audit_logs (payroll_id, employee_id, employee_name, field_name, old_value, new_value, action_type, reason, user_name, tenant_id)
            VALUES (?, ?, ?, ?, '0', ?, 'Aplicación Masiva', ?, 'Administrador', ?)
          `, [payroll_id, it.employee_id, it.employee_name, concept_name, String(calculatedAmount), `Concepto masivo aplicado: ${concept_name}`, tenantId]);
        } catch (e) { }
      }

      const [allItems] = await pool.query(
        'SELECT total_ingresos, total_descuentos, neto_pagar FROM payroll_items WHERE payroll_id = ? AND tenant_id = ?',
        [payroll_id, tenantId]
      );
      let totIng = 0; let totDesc = 0; let totNet = 0;
      allItems.forEach(i => {
        totIng += parseFloat(i.total_ingresos || 0);
        totDesc += parseFloat(i.total_descuentos || 0);
        totNet += parseFloat(i.neto_pagar || 0);
      });

      await pool.query(`
        UPDATE payroll_periods
        SET total_ingresos = ?, total_descuentos = ?, total_neto = ?
        WHERE id = ? AND tenant_id = ?
      `, [totIng, totDesc, totNet, payroll_id, tenantId]);

      res.json({ success: true, message: `Concepto aplicado exitosamente a ${item_ids.length} colaboradores` });
    } catch (err) {
      console.error('[PAYROLL BULK APPLY ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 6. Aprobar Nómina con Inmutabilidad y Liquidación Atómica (Scoped strictly by tenant_id y empleados incluidos)
  router.post('/approve', requirePermission('payroll.approve'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const tenantId = req.verifiedTenantId;
      let { payroll_id, approved_by = 'Administrador', acknowledge_review_flags = false, review_resolution_note = '' } = req.body;
      if (!payroll_id && req.body && typeof req.body === 'object') {
        if (req.body.id) payroll_id = req.body.id;
      }
      if (!payroll_id) {
        return res.status(400).json({ error: 'payroll_id es requerido' });
      }
      if (!isPositiveIntId(payroll_id)) {
        return res.status(404).json({ error: 'Período no encontrado en esta empresa.' });
      }

      const actorName = req.auth?.name || req.auth?.email || approved_by || 'Administrador';
      const authBranches = await resolveAuthorizedBranchDescriptors(req, tenantId);
      const calcSettingsSnapshot = await getCalculationSettings(pool, tenantId);

      await conn.beginTransaction();
      const [periodRows] = await conn.query(
        `SELECT id, period_name,
                TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
                total_empleados, total_neto, total_ingresos, total_descuentos,
                status, sucursal, departamento, is_immutable, approved_by, approved_at, snapshot_json, tenant_id
         FROM payroll_periods WHERE id = ? AND tenant_id = ? FOR UPDATE`,
        [payroll_id, tenantId]
      );
      if (periodRows.length === 0) {
        await conn.rollback();
        return res.status(404).json({ error: 'Período no encontrado en esta empresa.' });
      }

      const period = periodRows[0];
      if (!isSucursalAllowedForActor(period.sucursal, authBranches)) {
        await conn.rollback();
        return res.status(403).json({ error: 'No tienes permiso para aprobar la nómina de esta sucursal.', code: 'FORBIDDEN_BRANCH_SCOPE' });
      }
      if (period.status === 'Aprobada' || period.status === 'Pagada' || Number(period.is_immutable) === 1) {
        await conn.rollback();
        return res.status(409).json({
          error: 'Esta nómina ya fue aprobada anteriormente y es inmutable.',
          code: 'PAYROLL_ALREADY_APPROVED'
        });
      }

      const formatIsoDate = (val) => {
        if (!val) return '';
        if (val instanceof Date) return val.toISOString().slice(0, 10);
        return String(val).split('T')[0];
      };
      const startDate = formatIsoDate(period.start_date);
      const endDate = formatIsoDate(period.end_date);

      const [items] = await conn.query(
        'SELECT * FROM payroll_items WHERE payroll_id = ? AND tenant_id = ? ORDER BY id ASC',
        [payroll_id, tenantId]
      );

      // Bloquear aprobación si existen novedades sin resolución individual auditada
      // (NO se acepta un booleano global para omitir la resolución por colaborador)
      const reviewSummary = buildReviewSummary(items);
      if (reviewSummary.pending_count > 0) {
        await conn.rollback();
        return res.status(409).json({
          error: `Hay ${reviewSummary.pending_count} colaborador(es) con novedades pendientes de resolución individual (ingreso/salida parcial o turno nocturno). Resuelve cada caso individualmente (ajuste explícito o aceptación justificada) antes de aprobar.`,
          code: 'PAYROLL_PENDING_REVIEW',
          pending_review_items: reviewSummary.items.filter((x) => !x.resolved),
          review_summary: reviewSummary,
        });
      }

      const snapshot = {
        period: period,
        rules_snapshot: {
          ...calcSettingsSnapshot,
          tss_rate: 0.0591,
          currency: 'DOP',
          legal_compliance_notice: 'Parámetros configurados en software (no contempla todavía topes salariales SFS/AFP vigentes ni retención automática ISR DGII).',
        },
        review_summary: reviewSummary,
        items: items.map(it => ({
          ...it,
          detalles_json: typeof it.detalles_json === 'string' ? JSON.parse(it.detalles_json || '{}') : (it.detalles_json || {})
        })),
        approved_at: new Date().toISOString(),
        approved_by: actorName
      };

      await conn.query(`
        UPDATE payroll_periods 
        SET status = 'Aprobada', approved_at = NOW(), approved_by = ?, is_immutable = 1, snapshot_json = ?
        WHERE id = ? AND tenant_id = ?
      `, [actorName, JSON.stringify(snapshot), payroll_id, tenantId]);

      const includedEmpIds = [...new Set(items.map((it) => String(it.employee_id)).filter(Boolean))];
      if (startDate && endDate && includedEmpIds.length > 0) {
        const empPlaceholders = includedEmpIds.map(() => '?').join(', ');
        const empPrefixedIds = includedEmpIds.map((id) => `EMP-${id}`);
        const empNames = [...new Set(items.map((it) => String(it.employee_name || '')).filter(Boolean))];
        const namePlaceholders = empNames.length > 0 ? empNames.map(() => '?').join(', ') : null;

        const discWhereEmp = namePlaceholders
          ? `(employee_id::text IN (${empPlaceholders}) OR employee_id::text IN (${empPlaceholders}) OR employee_name IN (${namePlaceholders}))`
          : `(employee_id::text IN (${empPlaceholders}) OR employee_id::text IN (${empPlaceholders}))`;
        const discParams = [
          String(payroll_id), String(payroll_id), tenantId, startDate, endDate,
          ...includedEmpIds, ...empPrefixedIds,
          ...(namePlaceholders ? empNames : []),
        ];
        await conn.query(`
          UPDATE employee_discounts 
          SET status = 'Saldado', 
              notes = CASE 
                WHEN notes IS NULL OR notes = '' THEN ('Liquidado en Nómina ID #' || ?::text)
                ELSE (notes || ' [Liquidado en Nómina ID #' || ?::text || ']')
              END
          WHERE tenant_id = ?
            AND date BETWEEN ? AND ? 
            AND COALESCE(status, 'Pendiente') NOT IN ('Anulado', 'Saldado')
            AND ${discWhereEmp}
        `, discParams);

        const commWhereEmp = namePlaceholders
          ? `(employee_id::text IN (${empPlaceholders}) OR employee_id::text IN (${empPlaceholders}) OR employee_name IN (${namePlaceholders}))`
          : `(employee_id::text IN (${empPlaceholders}) OR employee_id::text IN (${empPlaceholders}))`;
        const commParams = [
          tenantId, `${startDate} 00:00:00-04:00`, `${endDate} 23:59:59.999-04:00`,
          ...includedEmpIds, ...empPrefixedIds,
          ...(namePlaceholders ? empNames : []),
        ];
        await conn.query(`
          UPDATE employee_commissions_log 
          SET status = 'Pagada'
          WHERE tenant_id = ?
            AND created_at >= ? AND created_at <= ? 
            AND COALESCE(status, 'Pendiente') NOT IN ('Anulada', 'Pagada', 'Pagado')
            AND payout_id IS NULL
            AND ${commWhereEmp}
        `, commParams);
      }

      await conn.query(`
        INSERT INTO payroll_audit_logs (payroll_id, field_name, old_value, new_value, action_type, reason, user_name, tenant_id)
        VALUES (?, 'ESTADO_NOMINA', 'En preparación', 'Aprobada', 'Aprobación Definitiva', 'Nómina aprobada e inmutable.', ?, ?)
      `, [payroll_id, actorName, tenantId]);

      await conn.commit();

      res.json({
        success: true,
        status: 'Aprobada',
        message: 'Nómina aprobada exitosamente. Se han saldado los descuentos y liquidado las comisiones de los colaboradores incluidos en este período.'
      });
    } catch (err) {
      await conn.rollback().catch(() => { });
      console.error('[PAYROLL APPROVE ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    } finally {
      conn.release();
    }
  });

  // 6.0b Registrar pago administrativo interno de una nómina aprobada (NO ejecuta transferencia bancaria)
  router.post('/periods/:id/register-payment', requirePermission('payroll.pay'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const { id } = req.params;
      if (!isPositiveIntId(id)) {
        return res.status(404).json({ error: 'Período de nómina no encontrado en esta empresa.' });
      }
      const tenantId = req.verifiedTenantId;
      const { payment_method = 'Registro administrativo interno', payment_reference = '', notes = '' } = req.body || {};
      const actorName = req.auth?.name || req.auth?.email || 'Administrador';
      const authBranches = await resolveAuthorizedBranchDescriptors(req, tenantId);

      await conn.beginTransaction();
      const [rows] = await conn.query(
        'SELECT * FROM payroll_periods WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [id, tenantId]
      );
      if (!rows || rows.length === 0) {
        await conn.rollback();
        return res.status(404).json({ error: 'Período de nómina no encontrado en esta empresa.' });
      }
      const period = rows[0];
      if (!isSucursalAllowedForActor(period.sucursal, authBranches)) {
        await conn.rollback();
        return res.status(403).json({ error: 'No tienes permiso para registrar el pago de esta sucursal.', code: 'FORBIDDEN_BRANCH_SCOPE' });
      }
      if (period.status === 'Pagada') {
        await conn.rollback();
        return res.status(409).json({ error: 'El pago administrativo de esta nómina ya fue registrado.', code: 'PAYROLL_ALREADY_PAID' });
      }
      if (period.status !== 'Aprobada') {
        await conn.rollback();
        return res.status(409).json({ error: 'Debes aprobar la nómina antes de registrar su pago administrativo.', code: 'PAYROLL_NOT_APPROVED' });
      }

      let snap = {};
      try {
        snap = typeof period.snapshot_json === 'string' ? JSON.parse(period.snapshot_json || '{}') : (period.snapshot_json || {});
      } catch { snap = {}; }

      const paymentRecord = {
        type: 'administrative_payment_record',
        registered_at: new Date().toISOString(),
        registered_by: actorName,
        payment_method: String(payment_method).slice(0, 100),
        payment_reference: String(payment_reference || '').slice(0, 120),
        notes: String(notes || '').slice(0, 250),
      };
      snap.administrative_payment = paymentRecord;

      await conn.query(
        `UPDATE payroll_periods
         SET status = 'Pagada', is_immutable = 1, snapshot_json = ?
         WHERE id = ? AND tenant_id = ?`,
        [JSON.stringify(snap), id, tenantId]
      );

      await conn.query(
        `INSERT INTO payroll_audit_logs (payroll_id, field_name, old_value, new_value, action_type, reason, user_name, tenant_id)
         VALUES (?, 'ESTADO_NOMINA', 'Aprobada', 'Pagada', 'Registro Administrativo de Pago', ?, ?, ?)`,
        [id, `Registro administrativo interno (${paymentRecord.payment_method}${paymentRecord.payment_reference ? ' · Ref: ' + paymentRecord.payment_reference : ''})`, actorName, tenantId]
      );

      await conn.commit();
      res.json({
        success: true,
        status: 'Pagada',
        administrative_payment: paymentRecord,
        message: 'Pago administrativo registrado internamente (no ejecuta transferencia bancaria automática).'
      });
    } catch (err) {
      await conn.rollback().catch(() => { });
      console.error('[PAYROLL REGISTER PAYMENT ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    } finally {
      conn.release();
    }
  });

  // 6.1 Sincronizar datos reales de comisiones y descuentos en tiempo real (Transaccional con FOR UPDATE)
  router.post('/periods/:id/sync-real-data', requirePermission('payroll.generate'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const { id } = req.params;
      const tenantId = req.verifiedTenantId;
      const authBranches = await resolveAuthorizedBranchDescriptors(req, tenantId);

      await conn.beginTransaction();
      const [periodRows] = await conn.query(`
        SELECT id, period_name, 
               TO_CHAR(start_date, 'YYYY-MM-DD') as start_date, 
               TO_CHAR(end_date, 'YYYY-MM-DD') as end_date,
               total_empleados, total_neto, total_ingresos, total_descuentos,
               status, sucursal, departamento, is_immutable,
               TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
               TO_CHAR(approved_at, 'YYYY-MM-DD HH24:MI:SS') as approved_at,
               approved_by
        FROM payroll_periods WHERE id = ? AND tenant_id = ? FOR UPDATE
      `, [id, tenantId]);
      if (periodRows.length === 0) {
        await conn.rollback();
        return res.status(404).json({ error: 'Período no encontrado en esta empresa.' });
      }

      const period = periodRows[0];
      if (!isSucursalAllowedForActor(period.sucursal, authBranches)) {
        await conn.rollback();
        return res.status(403).json({ error: 'No tienes permiso para recalcular la nómina de esta sucursal.', code: 'FORBIDDEN_BRANCH_SCOPE' });
      }
      if (period.status === 'Aprobada' || period.status === 'Pagada' || Number(period.is_immutable) === 1) {
        await conn.rollback();
        return res.status(403).json({ error: 'Esta nómina ya está aprobada o pagada y es inmutable', code: 'PAYROLL_IMMUTABLE' });
      }

      const startDate = period.start_date ? String(period.start_date).split('T')[0] : '';
      const endDate = period.end_date ? String(period.end_date).split('T')[0] : '';

      const evalStaff = await evaluateTenantStaffForPayrollPeriod(conn, tenantId, {
        start_date: startDate,
        end_date: endDate,
        sucursal: period.sucursal || 'Todas',
        departamento: period.departamento || 'Todos',
      });
      let staffList = evalStaff.eligible;

      if (staffList.length === 0) {
        const [existingItems] = await conn.query(
          'SELECT * FROM payroll_items WHERE payroll_id = ? AND tenant_id = ?',
          [id, tenantId]
        );
        staffList = existingItems.map(it => ({
          id: it.employee_id,
          nombre: it.employee_name,
          posicion: it.posicion,
          localidad: it.sucursal,
          salario_base: it.salario_fijo ? parseFloat(it.salario_fijo) * 2 : 20000
        }));
      }

      // Capturar resoluciones individuales previas antes de recalcular para invalidarlas explícitamente
      const [prevItemsBeforeSync] = await conn.query(
        'SELECT id, employee_id, employee_name, detalles_json FROM payroll_items WHERE payroll_id = ? AND tenant_id = ?',
        [id, tenantId]
      );
      const priorResolvedByEmp = new Map();
      for (const prevIt of prevItemsBeforeSync) {
        let pDet = {};
        try {
          pDet = typeof prevIt.detalles_json === 'string' ? JSON.parse(prevIt.detalles_json || '{}') : (prevIt.detalles_json || {});
        } catch { pDet = {}; }
        if (pDet.review_resolved === true && pDet.review_resolution) {
          priorResolvedByEmp.set(String(prevIt.employee_id), pDet.review_resolution);
        }
      }

      await conn.query('DELETE FROM payroll_items WHERE payroll_id = ? AND tenant_id = ?', [id, tenantId]);

      let sumTotalIngresos = 0;
      let sumTotalDescuentos = 0;
      let sumTotalNeto = 0;
      let invalidatedResolutionsCount = 0;
      const syncActor = req.auth?.name || req.auth?.email || 'Administrador';
      const syncNowIso = new Date().toISOString();
      const generatedItems = [];

      for (const emp of staffList) {
        const itemData = await calculateEmployeePayrollValues(conn, emp, startDate, endDate, tenantId);
        itemData.payroll_id = parseInt(id, 10);

        const priorRes = priorResolvedByEmp.get(String(itemData.employee_id));
        if (priorRes && itemData.detalles_json?.requires_review === true) {
          invalidatedResolutionsCount += 1;
          itemData.detalles_json.review_resolved = false;
          itemData.detalles_json.review_resolution = null;
          itemData.detalles_json.invalidated_previous_resolution = {
            ...priorRes,
            invalidated_at: syncNowIso,
            invalidated_by: syncActor,
            invalidation_reason: 'Recálculo de borrador (sync-real-data)',
          };
          await conn.query(`
            INSERT INTO payroll_audit_logs (payroll_id, employee_id, employee_name, field_name, old_value, new_value, action_type, reason, user_name, tenant_id)
            VALUES (?, ?, ?, 'INVALIDACION_REVISION', 'Resuelto', 'Pendiente', 'Invalidación por Recálculo', ?, ?, ?)
          `, [
            id,
            itemData.employee_id,
            itemData.employee_name,
            `Resolución previa (${priorRes.decision}) invalidada al recalcular el borrador.`,
            syncActor,
            tenantId,
          ]);
        }

        const [resItem] = await conn.query(`
          INSERT INTO payroll_items (
            payroll_id, employee_id, employee_name, posicion, sucursal, departamento,
            salario_fijo, comisiones, feriados, horas_extras, otros_ingresos, total_ingresos,
            tss, servicios, prestamos, ausencias, tardanzas, otros_descuentos, total_descuentos,
            neto_pagar, detalles_json, tenant_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          itemData.payroll_id, itemData.employee_id, itemData.employee_name, itemData.posicion, itemData.sucursal, itemData.departamento,
          itemData.salario_fijo, itemData.comisiones, itemData.feriados, itemData.horas_extras, itemData.otros_ingresos, itemData.total_ingresos,
          itemData.tss, itemData.servicios, itemData.prestamos, itemData.ausencias, itemData.tardanzas, itemData.otros_descuentos, itemData.total_descuentos,
          itemData.neto_pagar, JSON.stringify(itemData.detalles_json), tenantId
        ]);

        itemData.id = resItem.insertId || resItem[0]?.id;
        generatedItems.push(itemData);

        sumTotalIngresos = Number((sumTotalIngresos + itemData.total_ingresos).toFixed(2));
        sumTotalDescuentos = Number((sumTotalDescuentos + itemData.total_descuentos).toFixed(2));
        sumTotalNeto = Number((sumTotalNeto + itemData.neto_pagar).toFixed(2));
      }

      await conn.query(`
        UPDATE payroll_periods 
        SET total_ingresos = ?, total_descuentos = ?, total_neto = ?, total_empleados = ?
        WHERE id = ? AND tenant_id = ?
      `, [sumTotalIngresos, sumTotalDescuentos, sumTotalNeto, generatedItems.length, id, tenantId]);

      await conn.query(`
        INSERT INTO payroll_audit_logs (payroll_id, field_name, old_value, new_value, action_type, reason, user_name, tenant_id)
        VALUES (?, 'SINCRONIZACION_DATOS', 'Anterior', 'Datos Reales', 'Sincronización', 'Sincronización automática de comisiones y descuentos en tiempo real', ?, ?)
      `, [id, syncActor, tenantId]);

      await conn.commit();

      res.json({
        success: true,
        message: invalidatedResolutionsCount > 0
          ? `Datos recalculados. Se invalidaron ${invalidatedResolutionsCount} resolución(es) previa(s) de revisión; requieren nueva confirmación.`
          : 'Datos reales de comisiones y descuentos sincronizados exitosamente',
        invalidated_resolutions_count: invalidatedResolutionsCount,
        review_summary: buildReviewSummary(generatedItems),
        period: {
          ...period,
          total_ingresos: sumTotalIngresos,
          total_descuentos: sumTotalDescuentos,
          total_neto: sumTotalNeto,
          total_empleados: generatedItems.length
        },
        items: generatedItems,
        excluded_employees: evalStaff.excluded
      });
    } catch (err) {
      await conn.rollback().catch(() => { });
      console.error('[PAYROLL SYNC REAL DATA ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    } finally {
      conn.release();
    }
  });

  // 7. Consultar Historial de Auditoría de la Nómina (Scoped strictly by tenant_id)
  router.get('/audit-logs/:payroll_id', async (req, res) => {
    try {
      const { payroll_id } = req.params;
      const tenantId = req.verifiedTenantId;
      const [rows] = await pool.query(`
        SELECT * FROM payroll_audit_logs 
        WHERE payroll_id = ? AND tenant_id = ?
        ORDER BY id DESC
      `, [payroll_id, tenantId]);
      res.json(rows);
    } catch (err) {
      console.error('[PAYROLL AUDIT LOGS ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 8. Eliminar Período de Nómina (Solo borradores no aprobados; scoped by tenant_id y sucursal)
  router.delete('/periods/:id', requirePermission('payroll.generate'), async (req, res) => {
    try {
      const { id } = req.params;
      if (!isPositiveIntId(id)) {
        return res.status(404).json({ error: 'Período de nómina no encontrado en esta empresa.' });
      }
      const tenantId = req.verifiedTenantId;
      const authBranches = await resolveAuthorizedBranchDescriptors(req, tenantId);
      const [existing] = await pool.query(
        'SELECT id, status, is_immutable, sucursal FROM payroll_periods WHERE id = ? AND tenant_id = ?',
        [id, tenantId]
      );
      if (!existing || existing.length === 0) {
        return res.status(404).json({ error: 'Período de nómina no encontrado en esta empresa.' });
      }
      if (!isSucursalAllowedForActor(existing[0].sucursal, authBranches)) {
        return res.status(403).json({ error: 'No tienes permiso para eliminar la nómina de esta sucursal.', code: 'FORBIDDEN_BRANCH_SCOPE' });
      }
      if (existing[0].status === 'Aprobada' || existing[0].status === 'Pagada' || Number(existing[0].is_immutable) === 1) {
        return res.status(403).json({
          error: 'No se puede eliminar una nómina aprobada o pagada (es inmutable).',
          code: 'PAYROLL_IMMUTABLE'
        });
      }

      await pool.query('DELETE FROM payroll_items WHERE payroll_id = ? AND tenant_id = ?', [id, tenantId]);
      await pool.query('DELETE FROM payroll_periods WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      res.json({ success: true, message: 'Período de nómina eliminado correctamente' });
    } catch (err) {
      console.error('[PAYROLL DELETE ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 9. Cálculo y Reporte Real de Regalías del Año (Salario de Navidad Ley 16-92 RD - Scoped by tenant_id)
  router.get('/regalias/:year', async (req, res) => {
    try {
      const year = parseInt(req.params.year, 10) || new Date().getFullYear();
      const tenantId = req.verifiedTenantId;
      const scope = await resolveAuthorizedBranchDescriptors(req, tenantId);

      let [staffList] = await pool.query(
        `SELECT * FROM staff_records
         WHERE tenant_id = ?
           AND (
             status = 'Activo' OR status = 'Active' OR status IS NULL
             OR (fecha_salida IS NOT NULL AND EXTRACT(YEAR FROM fecha_salida) >= ?)
           )
         ORDER BY nombre ASC`,
        [tenantId, year]
      );

      if (scope.restricted) {
        staffList = (staffList || []).filter((emp) => isEmployeeInBranchScope(emp, scope));
      }

      // 1. Nóminas reales registradas en el año (excluyendo anuladas)
      const [payrollRows] = await pool.query(
        `SELECT
           pi.employee_id,
           pi.employee_name,
           EXTRACT(MONTH FROM COALESCE(pp.end_date, pp.start_date))::INT AS mes_num,
           COALESCE(SUM(COALESCE(pi.salario_fijo, 0) + COALESCE(pi.feriados, 0)), 0) AS salario_ordinario,
           COALESCE(SUM(COALESCE(pi.comisiones, 0)), 0) AS comisiones
         FROM payroll_items pi
         JOIN payroll_periods pp ON pp.id = pi.payroll_id AND pp.tenant_id = pi.tenant_id
         WHERE pi.tenant_id = ?
           AND EXTRACT(YEAR FROM COALESCE(pp.end_date, pp.start_date)) = ?
           AND LOWER(COALESCE(pp.status, '')) != 'anulada'
         GROUP BY pi.employee_id, pi.employee_name, EXTRACT(MONTH FROM COALESCE(pp.end_date, pp.start_date))`,
        [tenantId, year]
      );

      // 2. Comisiones reales del POS para meses donde aún no se haya cerrado nómina
      const [commRows] = await pool.query(
        `SELECT
           employee_id::text AS emp_id,
           employee_name,
           EXTRACT(MONTH FROM (created_at AT TIME ZONE 'America/Santo_Domingo'))::INT AS mes_num,
           COALESCE(SUM(COALESCE(monto_comision, commission_amount, 0)), 0) AS total_comisiones
         FROM employee_commissions_log
         WHERE tenant_id = ?
           AND EXTRACT(YEAR FROM (created_at AT TIME ZONE 'America/Santo_Domingo')) = ?
           AND COALESCE(status, 'Pendiente') != 'Anulada'
         GROUP BY employee_id::text, employee_name, EXTRACT(MONTH FROM (created_at AT TIME ZONE 'America/Santo_Domingo'))`,
        [tenantId, year]
      );

      const payrollMap = new Map();
      for (const r of payrollRows || []) {
        const keyById = `${String(r.employee_id)}:${r.mes_num}`;
        payrollMap.set(keyById, {
          salario_ordinario: Number(r.salario_ordinario || 0),
          comisiones: Number(r.comisiones || 0),
        });
        if (r.employee_name) {
          const nameKey = `NAME:${String(r.employee_name).trim().toLowerCase()}:${r.mes_num}`;
          if (!payrollMap.has(nameKey)) {
            payrollMap.set(nameKey, {
              salario_ordinario: Number(r.salario_ordinario || 0),
              comisiones: Number(r.comisiones || 0),
            });
          }
        }
      }

      const commMap = new Map();
      for (const c of commRows || []) {
        const keyById = `${String(c.emp_id)}:${c.mes_num}`;
        commMap.set(keyById, (commMap.get(keyById) || 0) + Number(c.total_comisiones || 0));
        if (c.employee_name) {
          const nameKey = `NAME:${String(c.employee_name).trim().toLowerCase()}:${c.mes_num}`;
          commMap.set(nameKey, (commMap.get(nameKey) || 0) + Number(c.total_comisiones || 0));
        }
      }

      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1; // 1..12
      const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      const regaliasList = [];
      let granTotalAcumulado = 0;
      let granTotalRegalias = 0;

      for (const emp of staffList || []) {
        const empId = String(emp.id);
        const empNameNorm = String(emp.nombre || '').trim().toLowerCase();
        const baseMensual = Math.max(0, Number(emp.salario_base || 0));

        const hireDate = emp.fecha_entrada ? new Date(emp.fecha_entrada) : null;
        const exitDate = emp.fecha_salida ? new Date(emp.fecha_salida) : null;
        if (hireDate && !isNaN(hireDate.getTime()) && hireDate.getFullYear() > year) {
          continue;
        }
        if (exitDate && !isNaN(exitDate.getTime()) && exitDate.getFullYear() < year) {
          continue;
        }

        const desglose = [];
        let totalAcumulado = 0;
        let mesesTrabajados = 0;

        for (let m = 0; m < 12; m++) {
          const monthNum = m + 1;
          const isFutureMonth = year > currentYear || (year === currentYear && monthNum > currentMonth);
          const monthStart = new Date(year, m, 1);
          const monthEnd = new Date(year, m + 1, 0, 23, 59, 59);

          const pEntry =
            payrollMap.get(`${empId}:${monthNum}`) ||
            payrollMap.get(`EMP-${empId}:${monthNum}`) ||
            (empNameNorm ? payrollMap.get(`NAME:${empNameNorm}:${monthNum}`) : null);

          let salarioOrd = 0;
          let comisionMes = 0;

          if (pEntry) {
            salarioOrd = Number(pEntry.salario_ordinario.toFixed(2));
            comisionMes = Number(pEntry.comisiones.toFixed(2));
          } else if (!isFutureMonth) {
            const hiredAfterMonth = hireDate && !isNaN(hireDate.getTime()) && hireDate > monthEnd;
            const exitedBeforeMonth = exitDate && !isNaN(exitDate.getTime()) && exitDate < monthStart;

            if (!hiredAfterMonth && !exitedBeforeMonth) {
              // Prorratear días activos del mes si ingresó o salió a mitad de mes, o si es el mes en curso
              const totalDaysInMonth = new Date(year, m + 1, 0).getDate();
              let activeStartDay = 1;
              let activeEndDay = year === currentYear && monthNum === currentMonth ? now.getDate() : totalDaysInMonth;

              if (hireDate && !isNaN(hireDate.getTime()) && hireDate.getFullYear() === year && hireDate.getMonth() === m) {
                activeStartDay = Math.max(activeStartDay, hireDate.getDate());
              }
              if (exitDate && !isNaN(exitDate.getTime()) && exitDate.getFullYear() === year && exitDate.getMonth() === m) {
                activeEndDay = Math.min(activeEndDay, exitDate.getDate());
              }

              const workedDays = Math.max(0, activeEndDay - activeStartDay + 1);
              if (workedDays > 0 && baseMensual > 0) {
                const ratio = workedDays >= totalDaysInMonth ? 1 : workedDays / 30;
                salarioOrd = Number(Math.min(baseMensual, baseMensual * ratio).toFixed(2));
              }

              const posComm =
                commMap.get(`${empId}:${monthNum}`) ??
                commMap.get(`EMP-${empId}:${monthNum}`) ??
                (empNameNorm ? commMap.get(`NAME:${empNameNorm}:${monthNum}`) : 0) ??
                0;
              comisionMes = Number(Number(posComm).toFixed(2));
            }
          }

          const totalMes = Number((salarioOrd + comisionMes).toFixed(2));
          if (totalMes > 0) {
            mesesTrabajados++;
          }
          totalAcumulado = Number((totalAcumulado + totalMes).toFixed(2));

          desglose.push({
            mes: meses[m],
            mes_numero: monthNum,
            salario_ordinario: salarioOrd,
            comisiones: comisionMes,
            total_mes: totalMes,
          });
        }

        // Ley 16-92 Art. 219: Salario de Navidad = 1/12 del total devengado en el año calendario
        const montoRegalia = Number((totalAcumulado / 12).toFixed(2));
        granTotalAcumulado = Number((granTotalAcumulado + totalAcumulado).toFixed(2));
        granTotalRegalias = Number((granTotalRegalias + montoRegalia).toFixed(2));

        regaliasList.push({
          year,
          employee_id: empId,
          employee_name: emp.nombre || 'Colaborador',
          posicion: emp.posicion || 'Colaborador',
          sucursal: emp.localidad || 'Principal',
          salario_base_mensual: baseMensual,
          meses_trabajados: mesesTrabajados,
          total_acumulado_anual: totalAcumulado,
          monto_regalia: montoRegalia,
          desglose_mensual: desglose,
          status: 'Calculada'
        });
      }

      res.json({
        year,
        total_empleados: regaliasList.length,
        gran_total_acumulado: Number(granTotalAcumulado.toFixed(2)),
        gran_total_regalias: Number(granTotalRegalias.toFixed(2)),
        regalias: regaliasList
      });
    } catch (err) {
      console.error('[REGALIAS CALCULATION ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 10. Conceptos de Nómina (Scoped by tenant_id)
  router.get('/concepts', async (req, res) => {
    try {
      const tenantId = req.verifiedTenantId;
      const [rows] = await pool.query(
        'SELECT * FROM payroll_concepts WHERE tenant_id = ? AND activo = 1 ORDER BY id ASC',
        [tenantId]
      );
      if (rows.length === 0) {
        return res.json([
          { id: 1, tipo: 'Ingreso', nombre: 'Salario fijo', formula_tipo: 'Fijo', porcentaje: 0 },
          { id: 2, tipo: 'Ingreso', nombre: 'Comisiones', formula_tipo: 'Variable', porcentaje: 0 },
          { id: 3, tipo: 'Ingreso', nombre: 'Feriados', formula_tipo: 'Fijo', porcentaje: 0 },
          { id: 4, tipo: 'Ingreso', nombre: 'Horas extras', formula_tipo: 'Variable', porcentaje: 0 },
          { id: 5, tipo: 'Ingreso', nombre: 'Otros ingresos', formula_tipo: 'Fijo', porcentaje: 0 },
          { id: 6, tipo: 'Descuento', nombre: 'TSS', formula_tipo: 'Porcentaje', porcentaje: 5.91 },
          { id: 7, tipo: 'Descuento', nombre: 'Servicios', formula_tipo: 'Variable', porcentaje: 0 },
          { id: 8, tipo: 'Descuento', nombre: 'Préstamos', formula_tipo: 'Fijo', porcentaje: 0 },
          { id: 9, tipo: 'Descuento', nombre: 'Ausencias', formula_tipo: 'Variable', porcentaje: 0 },
          { id: 10, tipo: 'Descuento', nombre: 'Tardanzas', formula_tipo: 'Variable', porcentaje: 0 },
          { id: 11, tipo: 'Descuento', nombre: 'Otros desc.', formula_tipo: 'Fijo', porcentaje: 0 }
        ]);
      }
      res.json(rows);
    } catch (err) {
      console.error('[PAYROLL CONCEPTS GET ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createPayrollRouter };
