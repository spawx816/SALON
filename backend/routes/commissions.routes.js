const express = require('express');
const { requirePermission } = require('../middleware/rbac.middleware');

/**
 * Commissions router module for Empresa Pro & Plan Beauty RD (Scoped strictly by tenant_id)
 * Permisos separados:
 * - commissions.view: consultar registros, categorías, esquemas, reglas y liquidaciones
 * - commissions.configure: crear/editar/eliminar categorías, esquemas, reglas, asignaciones y sync
 * - commissions.approve: liquidar y pagar comisiones (/payout)
 */
function createCommissionsRouter(pool, processVisitCommissions, processBatchVisitCommissions = null) {
  const router = express.Router();

  // --- Sincronización manual / background de comisiones (Batch O(1) queries) ---
  // Por seguridad histórica, NO sobrescribe facturas que ya tienen comisiones calculadas a menos que se solicite force_recalculate=true explícitamente.
  router.post('/sync', requirePermission('commissions.configure'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const forceRecalculate = req.body?.force_recalculate === true || req.query?.force_recalculate === 'true';
      const [visitsToProcess] = await pool.query(`
        SELECT v.id, v.ticket_number, v.items_detail, v.visited_at 
        FROM visits v 
        WHERE v.tenant_id = ?
          AND v.status = 'Facturado'
          AND v.items_detail IS NOT NULL
          ${forceRecalculate ? '' : 'AND NOT EXISTS (SELECT 1 FROM employee_commissions_log c WHERE c.visit_id = v.id AND c.tenant_id = v.tenant_id)'}
        ORDER BY v.visited_at DESC LIMIT 200
      `, [tenantId]);

      if (typeof processBatchVisitCommissions === 'function') {
        await processBatchVisitCommissions(visitsToProcess, tenantId);
      } else if (typeof processVisitCommissions === 'function') {
        for (const uv of visitsToProcess) {
          await processVisitCommissions(uv.id, uv.items_detail, uv.ticket_number, uv.visited_at, tenantId);
        }
      }
      res.json({ success: true, message: 'Comisiones sincronizadas correctamente', count: visitsToProcess.length, force_recalculate: forceRecalculate });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Listado general y métricas de comisiones ---
  router.get('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { start_date, end_date, employee_id, status, service_name, localidad } = req.query;

      let query = `
        SELECT c.*, s.localidad as emp_localidad 
        FROM employee_commissions_log c
        LEFT JOIN staff_records s ON c.employee_id::text = s.id::text AND s.tenant_id = c.tenant_id
        WHERE c.tenant_id = ?
      `;
      const params = [tenantId];

      if (start_date) {
        const sDate = String(start_date).trim().slice(0, 10);
        query += ' AND c.created_at >= ?';
        params.push(`${sDate} 00:00:00-04:00`);
      }
      if (end_date) {
        const eDate = String(end_date).trim().slice(0, 10);
        query += ' AND c.created_at <= ?';
        params.push(`${eDate} 23:59:59.999-04:00`);
      }
      if (employee_id) {
        const cleanEmpId = String(employee_id).replace('EMP-', '').replace('COMM-', '').trim();
        query += ' AND (c.employee_id = ? OR c.employee_id = ? OR s.id::text = ? OR c.employee_name LIKE ?)';
        params.push(cleanEmpId, String(employee_id), cleanEmpId, `%${employee_id}%`);
      }
      if (status) {
        query += ' AND c.status = ?';
        params.push(status);
      } else {
        query += " AND c.status != 'Anulada'";
      }
      if (service_name) {
        query += ' AND c.service_name LIKE ?';
        params.push(`%${service_name}%`);
      }
      if (localidad) {
        query += ' AND (c.localidad = ? OR s.localidad = ?)';
        params.push(localidad, localidad);
      }

      query += ' ORDER BY c.created_at DESC';

      const [rows] = await pool.query(query, params);

      let totalGenerado = 0;
      let totalPendiente = 0;
      let totalPagado = 0;

      rows.forEach(r => {
        const amt = Number(r.monto_comision) || 0;
        totalGenerado += amt;
        if (r.status === 'Pendiente') totalPendiente += amt;
        else if (r.status === 'Pagado' || r.status === 'Pagada') totalPagado += amt;
      });

      res.json({
        commissions: rows,
        metrics: {
          totalGenerado,
          totalPendiente,
          totalPagado,
          count: rows.length
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Categorías de Comisión ---
  router.get('/categories', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [cats] = await pool.query('SELECT * FROM commission_categories WHERE tenant_id = ? ORDER BY id ASC', [tenantId]);
      for (const cat of cats) {
        const [srvs] = await pool.query(
          'SELECT COUNT(*) as count FROM services WHERE categoria = ? AND tenant_id = ?',
          [cat.nombre, tenantId]
        );
        cat.servicios_vinculados = srvs[0]?.count || 0;
      }
      res.json(cats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/categories', requirePermission('commissions.configure'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id, nombre, porcentaje, tipo, estado } = req.body;
      if (!nombre) return res.status(400).json({ error: 'El nombre de la categoría es obligatorio.' });

      if (id) {
        await pool.query(
          'UPDATE commission_categories SET nombre=?, porcentaje=?, tipo=?, estado=? WHERE id=? AND tenant_id=?',
          [nombre, parseFloat(porcentaje) || 0, tipo || 'Porcentaje', estado || 'Activa', id, tenantId]
        );
      } else {
        await pool.query(
          'INSERT INTO commission_categories (tenant_id, nombre, porcentaje, tipo, estado) VALUES (?, ?, ?, ?, ?)',
          [tenantId, nombre, parseFloat(porcentaje) || 0, tipo || 'Porcentaje', estado || 'Activa']
        );
      }
      res.json({ success: true, message: 'Categoría guardada exitosamente' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/categories/:id', requirePermission('commissions.configure'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const [existing] = await pool.query(
        'SELECT id, nombre FROM commission_categories WHERE id = ? AND tenant_id = ?',
        [id, tenantId]
      );
      if (!existing || existing.length === 0) {
        return res.status(404).json({ error: 'Categoría no encontrada en esta empresa.', code: 'CATEGORY_NOT_FOUND' });
      }
      const catName = existing[0].nombre;
      const [linkedServices] = await pool.query(
        'SELECT COUNT(*)::int AS cnt FROM services WHERE tenant_id = ? AND (commission_category_id = ? OR LOWER(COALESCE(categoria, \'\')) = LOWER(?))',
        [tenantId, id, catName]
      );
      const [linkedRules] = await pool.query(
        'SELECT COUNT(*)::int AS cnt FROM commission_scheme_rules WHERE tenant_id = ? AND LOWER(COALESCE(category_name, \'\')) = LOWER(?)',
        [tenantId, catName]
      );
      const srvCount = Number(linkedServices[0]?.cnt || 0);
      const ruleCount = Number(linkedRules[0]?.cnt || 0);
      if (srvCount > 0 || ruleCount > 0) {
        return res.status(409).json({
          error: `No se puede eliminar la categoría "${catName}" porque tiene ${srvCount} ítem(s) en catálogo y ${ruleCount} regla(s) de comisión vinculadas. Desactívala cambiando su estado a Inactiva para conservar el historial.`,
          code: 'CATEGORY_IN_USE',
          linked_services: srvCount,
          linked_rules: ruleCount,
        });
      }
      await pool.query('DELETE FROM commission_categories WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      res.json({ success: true, message: 'Categoría eliminada' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Esquemas de Comisión ---
  router.get('/schemes', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [schemes] = await pool.query('SELECT * FROM commission_schemes WHERE tenant_id = ? ORDER BY id ASC', [tenantId]);
      for (const s of schemes) {
        const [emps] = await pool.query(
          'SELECT COUNT(*) as count FROM staff_records WHERE commission_scheme_id = ? AND tenant_id = ?',
          [s.id, tenantId]
        );
        s.colaboradores_asignados = emps[0]?.count || 0;
      }
      res.json(schemes);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/schemes', requirePermission('commissions.configure'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id, nombre, descripcion, tipo, estado } = req.body;
      if (!nombre) return res.status(400).json({ error: 'El nombre del esquema es obligatorio.' });

      if (id) {
        await pool.query(
          'UPDATE commission_schemes SET nombre=?, descripcion=?, tipo=?, estado=? WHERE id=? AND tenant_id=?',
          [nombre, descripcion || '', tipo || 'Por Categorías', estado || 'Activo', id, tenantId]
        );
      } else {
        await pool.query(
          'INSERT INTO commission_schemes (tenant_id, nombre, descripcion, tipo, estado) VALUES (?, ?, ?, ?, ?)',
          [tenantId, nombre, descripcion || '', tipo || 'Por Categorías', estado || 'Activo']
        );
      }
      res.json({ success: true, message: 'Esquema de comisión guardado exitosamente' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/schemes/:id', requirePermission('commissions.configure'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const [existing] = await pool.query(
        'SELECT id, nombre FROM commission_schemes WHERE id = ? AND tenant_id = ?',
        [id, tenantId]
      );
      if (!existing || existing.length === 0) {
        return res.status(404).json({ error: 'Esquema no encontrado en esta empresa.', code: 'SCHEME_NOT_FOUND' });
      }
      const schemeName = existing[0].nombre;
      const [assignedStaff] = await pool.query(
        'SELECT COUNT(*)::int AS cnt FROM staff_records WHERE tenant_id = ? AND commission_scheme_id = ?',
        [tenantId, id]
      );
      const [histLogs] = await pool.query(
        'SELECT COUNT(*)::int AS cnt FROM employee_commissions_log WHERE tenant_id = ? AND scheme_id = ?',
        [tenantId, id]
      );
      const staffCnt = Number(assignedStaff[0]?.cnt || 0);
      const histCnt = Number(histLogs[0]?.cnt || 0);
      if (staffCnt > 0 || histCnt > 0) {
        return res.status(409).json({
          error: `No se puede eliminar el esquema "${schemeName}" porque tiene ${staffCnt} colaborador(es) asignado(s) y ${histCnt} comisión(es) histórica(s). Desactívalo cambiando su estado a Inactivo para conservar el historial.`,
          code: 'SCHEME_IN_USE',
          assigned_staff: staffCnt,
          historical_commissions: histCnt,
        });
      }
      await pool.query('DELETE FROM commission_scheme_rules WHERE scheme_id = ? AND tenant_id = ?', [id, tenantId]);
      await pool.query('DELETE FROM commission_schemes WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      res.json({ success: true, message: 'Esquema y sus reglas eliminados' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Asignar Colaboradores al Esquema ---
  router.post('/schemes/:id/assign-employees', requirePermission('commissions.configure'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const { employee_ids } = req.body;
      const schemeId = parseInt(id, 10);
      if (isNaN(schemeId)) return res.status(400).json({ error: 'ID de esquema inválido' });

      const [schRows] = await pool.query(
        'SELECT id FROM commission_schemes WHERE id = ? AND tenant_id = ?',
        [schemeId, tenantId]
      );
      if (!schRows || schRows.length === 0) {
        return res.status(404).json({ error: 'Esquema no encontrado en esta empresa.', code: 'SCHEME_NOT_FOUND' });
      }

      const empIds = Array.isArray(employee_ids) ? employee_ids.map(x => parseInt(x, 10)).filter(x => !isNaN(x)) : [];

      if (empIds.length > 0) {
        const placeholders = empIds.map(() => '?').join(',');
        await pool.query(
          `UPDATE staff_records SET commission_scheme_id = ?, scheme_effective_date = COALESCE(scheme_effective_date, NOW()) WHERE tenant_id = ? AND id IN (${placeholders})`,
          [schemeId, tenantId, ...empIds]
        );
        await pool.query(
          `UPDATE staff_records SET commission_scheme_id = NULL WHERE tenant_id = ? AND commission_scheme_id = ? AND id NOT IN (${placeholders})`,
          [tenantId, schemeId, ...empIds]
        );
      } else {
        await pool.query('UPDATE staff_records SET commission_scheme_id = NULL WHERE tenant_id = ? AND commission_scheme_id = ?', [tenantId, schemeId]);
      }

      res.json({ success: true, message: 'Colaboradores asignados al esquema correctamente' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Reglas por Esquema ---
  router.get('/schemes/:id/rules', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const [rules] = await pool.query(
        'SELECT * FROM commission_scheme_rules WHERE scheme_id = ? AND tenant_id = ? ORDER BY rule_type DESC, prioridad ASC, id ASC',
        [id, tenantId]
      );
      res.json(rules);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/schemes/:id/rules', requirePermission('commissions.configure'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const {
        rule_type,
        category_name,
        service_name,
        tipo_calculo,
        valor,
        prioridad,
        operacion,
        monto_ajuste,
        porcentaje_comision,
        cantidad_meta,
        bono_monto,
        bono_tipo,
        periodo,
        repeticion,
        repeticion_limite,
        detalles_json
      } = req.body;
      if (!rule_type) return res.status(400).json({ error: 'El tipo de regla es obligatorio.' });

      const cleanRuleType = String(rule_type).trim().toLowerCase();
      const isCategoria = cleanRuleType === 'categoria';
      const isServicio = cleanRuleType === 'servicio';
      const isEspecial = cleanRuleType === 'especial';

      const finalCategoryName = isCategoria ? (category_name ? String(category_name).trim() : null) : null;
      const finalServiceName = (isServicio || isEspecial) ? (service_name ? String(service_name).trim() : null) : null;
      const finalOperacion = isEspecial ? (operacion || 'Restar') : null;
      const finalMontoAjuste = isEspecial && (finalOperacion === 'Restar' || finalOperacion === 'Sumar')
        ? (parseFloat(monto_ajuste) || 0)
        : 0;
      const finalPorcentajeComision = isEspecial && finalOperacion !== 'Contar'
        ? (parseFloat(porcentaje_comision) || parseFloat(valor) || 0)
        : (isCategoria || isServicio ? (parseFloat(valor) || 0) : 0);
      const finalCantidadMeta = isEspecial && finalOperacion === 'Contar' ? (parseInt(cantidad_meta, 10) || 0) : 0;
      const finalBonoMonto = isEspecial && finalOperacion === 'Contar' ? (parseFloat(bono_monto) || 0) : 0;

      // Verificar pertenencia del esquema al tenant y evitar reglas contradictorias/duplicadas
      const [schCheck] = await pool.query(
        'SELECT id FROM commission_schemes WHERE id = ? AND tenant_id = ?',
        [id, tenantId]
      );
      if (!schCheck || schCheck.length === 0) {
        return res.status(404).json({ error: 'Esquema no encontrado en esta empresa.', code: 'SCHEME_NOT_FOUND' });
      }
      if (isCategoria && finalCategoryName) {
        const [dupCat] = await pool.query(
          `SELECT id FROM commission_scheme_rules WHERE tenant_id = ? AND scheme_id = ? AND LOWER(rule_type) = 'categoria' AND LOWER(COALESCE(category_name, '')) = LOWER(?) LIMIT 1`,
          [tenantId, id, finalCategoryName]
        );
        if (dupCat && dupCat.length > 0) {
          return res.status(409).json({
            error: `Ya existe una regla de categoría para "${finalCategoryName}" en este esquema. Elimina la regla anterior para evitar reglas contradictorias.`,
            code: 'DUPLICATE_SCHEME_RULE',
          });
        }
      } else if ((isServicio || isEspecial) && finalServiceName) {
        const [dupSrv] = await pool.query(
          `SELECT id FROM commission_scheme_rules WHERE tenant_id = ? AND scheme_id = ? AND LOWER(rule_type) = ? AND LOWER(COALESCE(service_name, '')) = LOWER(?) LIMIT 1`,
          [tenantId, id, cleanRuleType, finalServiceName]
        );
        if (dupSrv && dupSrv.length > 0) {
          return res.status(409).json({
            error: `Ya existe una regla de tipo "${cleanRuleType}" para "${finalServiceName}" en este esquema. Elimina la regla anterior para evitar contradicciones.`,
            code: 'DUPLICATE_SCHEME_RULE',
          });
        }
      }

      await pool.query(
        `INSERT INTO commission_scheme_rules (
          tenant_id, scheme_id, rule_type, category_name, service_name, tipo_calculo, valor, prioridad,
          operacion, monto_ajuste, porcentaje_comision, cantidad_meta, bono_monto, bono_tipo,
          periodo, repeticion, repeticion_limite, detalles_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          id,
          cleanRuleType,
          finalCategoryName,
          finalServiceName,
          tipo_calculo || 'Porcentaje',
          parseFloat(valor) || 0,
          parseInt(prioridad) || 1,
          finalOperacion,
          finalMontoAjuste,
          finalPorcentajeComision,
          finalCantidadMeta,
          finalBonoMonto,
          bono_tipo || 'Fijo',
          periodo || 'Mensual',
          repeticion || 'Una vez por período',
          parseInt(repeticion_limite) || 1,
          typeof detalles_json === 'object' ? JSON.stringify(detalles_json) : (detalles_json || null)
        ]
      );

      res.json({ success: true, message: 'Regla agregada exitosamente' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/rules/:id', requirePermission('commissions.configure'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      await pool.query('DELETE FROM commission_scheme_rules WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      res.json({ success: true, message: 'Regla eliminada' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/rules', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [rules] = await pool.query('SELECT * FROM employee_commission_rules WHERE tenant_id = ? ORDER BY employee_id ASC', [tenantId]);
      res.json(rules);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/rules', requirePermission('commissions.configure'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { employee_id, service_name, tipo_comision, comision_valor } = req.body;
      if (!employee_id) return res.status(400).json({ error: 'Empleado es obligatorio.' });

      await pool.query(
        `INSERT INTO employee_commission_rules (tenant_id, employee_id, service_name, tipo_comision, comision_valor)
         VALUES (?, ?, ?, ?, ?)`,
        [tenantId, employee_id, service_name || 'General', tipo_comision || 'Porcentaje', parseFloat(comision_valor) || 0]
      );

      res.json({ success: true, message: 'Regla de comisión guardada exitosamente' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Liquidaciones (Payouts) — Atómico con FOR UPDATE + Auditoría + Anti doble pago ---
  router.post('/payout', requirePermission('commissions.approve'), async (req, res) => {
    const conn = typeof pool.getConnection === 'function' ? await pool.getConnection() : null;
    const db = conn || pool;
    try {
      const tenantId = req.tenantId;
      const { employee_id, employee_name, commission_ids, metodo_pago, notas, usuario_liquidador } = req.body;

      if (!employee_id || !Array.isArray(commission_ids) || commission_ids.length === 0) {
        return res.status(400).json({ error: 'Empleado y comisiones seleccionadas son obligatorias.' });
      }

      const uniqueIds = [...new Set(commission_ids.map((x) => parseInt(x, 10)).filter((x) => !isNaN(x)))];
      if (uniqueIds.length === 0) {
        return res.status(400).json({ error: 'IDs de comisiones inválidos.' });
      }

      if (conn) await conn.beginTransaction();

      const placeholders = uniqueIds.map(() => '?').join(',');
      const cleanEmpId = String(employee_id).replace('EMP-', '').trim();
      const [commRows] = await db.query(
        `SELECT * FROM employee_commissions_log
         WHERE tenant_id = ?
           AND id IN (${placeholders})
           AND status = 'Pendiente'
           AND payout_id IS NULL
           AND (employee_id::text = ? OR employee_id::text = ?)
         ORDER BY id ASC
         FOR UPDATE`,
        [tenantId, ...uniqueIds, cleanEmpId, `EMP-${cleanEmpId}`]
      );

      if (commRows.length === 0) {
        if (conn) await conn.rollback();
        return res.status(409).json({
          error: 'No se encontraron comisiones pendientes elegibles para liquidar (ya fueron liquidadas, anuladas o pertenecen a otro colaborador/empresa).',
          code: 'NO_ELIGIBLE_PENDING_COMMISSIONS',
        });
      }

      const lockedIds = commRows.map((c) => c.id);
      const lockedPh = lockedIds.map(() => '?').join(',');
      const montoTotalCents = commRows.reduce((acc, c) => acc + Math.round((Number(c.monto_comision) || 0) * 100), 0);
      const montoTotal = Number((montoTotalCents / 100).toFixed(2));
      const dateCode = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const payoutNumber = `LIQ-${dateCode}-${Math.floor(1000 + Math.random() * 9000)}`;
      const actorName = usuario_liquidador || req.auth?.name || req.auth?.email || 'Admin';

      const [payoutResult] = await db.query(
        `INSERT INTO commission_payouts (tenant_id, payout_number, employee_id, employee_name, monto_total, total_items, metodo_pago, notas, usuario_liquidador, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         RETURNING id`,
        [
          tenantId,
          payoutNumber,
          cleanEmpId,
          employee_name || commRows[0].employee_name || 'Empleado',
          montoTotal,
          commRows.length,
          metodo_pago || 'Efectivo',
          notas || '',
          actorName
        ]
      );

      const payoutId = payoutResult.insertId || payoutResult[0]?.id;

      await db.query(
        `UPDATE employee_commissions_log
         SET status = 'Pagado', payout_id = ?
         WHERE tenant_id = ? AND id IN (${lockedPh}) AND status = 'Pendiente' AND payout_id IS NULL`,
        [payoutId, tenantId, ...lockedIds]
      );

      await db.query(
        `INSERT INTO audit_logs (tenant_id, entity_type, entity_id, action, reason, user_name, details, metadata, created_at)
         VALUES (?, 'commission_payout', ?, 'COMMISSION_PAYOUT', ?, ?, ?, ?::jsonb, NOW())`,
        [
          tenantId,
          String(payoutId),
          notas || `Liquidación ${payoutNumber}`,
          actorName,
          `Liquidación ${payoutNumber} por RD$ ${montoTotal.toFixed(2)} (${commRows.length} comisión(es))`,
          JSON.stringify({
            payout_id: payoutId,
            payout_number: payoutNumber,
            employee_id: cleanEmpId,
            commission_ids: lockedIds,
            monto_total: montoTotal,
            metodo_pago: metodo_pago || 'Efectivo',
          }),
        ]
      ).catch(() => {});

      if (conn) await conn.commit();

      res.json({
        success: true,
        payoutId,
        payoutNumber,
        montoTotal,
        settledCount: lockedIds.length,
        message: `Liquidación ${payoutNumber} realizada exitosamente por RD$ ${montoTotal.toFixed(2)}`
      });
    } catch (err) {
      if (conn) await conn.rollback().catch(() => {});
      res.status(500).json({ error: err.message });
    } finally {
      if (conn) conn.release();
    }
  });

  router.get('/payouts', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [payouts] = await pool.query('SELECT * FROM commission_payouts WHERE tenant_id = ? ORDER BY created_at DESC', [tenantId]);
      res.json(payouts);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createCommissionsRouter };
