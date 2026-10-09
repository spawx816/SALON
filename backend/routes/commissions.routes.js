const express = require('express');

/**
 * Commissions router module for Salon Pro & Plan Beauty RD
 * Handles commission logs, schemes, categories, custom rules, and employee payouts.
 * 
 * @param {import('mysql2/promise').Pool} pool 
 * @param {Function} processVisitCommissions 
 */
function createCommissionsRouter(pool, processVisitCommissions) {
  const router = express.Router();

  // --- Sincronización manual / background de comisiones ---
  router.post('/sync', async (req, res) => {
    try {
      if (typeof processVisitCommissions === 'function') {
        const [visitsToProcess] = await pool.query(`
          SELECT v.id, v.ticket_number, v.items_detail, v.visited_at 
          FROM visits v 
          WHERE v.status = 'Facturado' AND v.items_detail IS NOT NULL 
          ORDER BY v.visited_at DESC LIMIT 200
        `);
        for (const uv of visitsToProcess) {
          await processVisitCommissions(uv.id, uv.items_detail, uv.ticket_number, uv.visited_at);
        }
      }
      res.json({ success: true, message: 'Comisiones sincronizadas correctamente' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Listado general y métricas de comisiones (Ultra-rápido) ---
  router.get('/', async (req, res) => {
    try {
      const { start_date, end_date, employee_id, status, service_name, localidad } = req.query;

      let query = `
        SELECT c.*, s.localidad as emp_localidad 
        FROM employee_commissions_log c
        LEFT JOIN staff_records s ON c.employee_id = s.id
        WHERE 1=1
      `;
      const params = [];

      if (start_date) {
        query += ' AND c.created_at >= ?';
        params.push(`${start_date} 00:00:00`);
      }
      if (end_date) {
        query += ' AND c.created_at <= ?';
        params.push(`${end_date} 23:59:59`);
      }
      if (employee_id) {
        const cleanEmpId = String(employee_id).replace('EMP-', '').replace('COMM-', '').trim();
        query += ' AND (c.employee_id = ? OR c.employee_id = ? OR s.id = ? OR c.employee_name LIKE ?)';
        params.push(cleanEmpId, employee_id, cleanEmpId, `%${employee_id}%`);
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
        else if (r.status === 'Pagado') totalPagado += amt;
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
      const [cats] = await pool.query('SELECT * FROM commission_categories ORDER BY id ASC');
      for (let cat of cats) {
        const [srvs] = await pool.query('SELECT COUNT(*) as count FROM services WHERE categoria = ?', [cat.nombre]);
        cat.servicios_vinculados = srvs[0]?.count || 0;
      }
      res.json(cats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/categories', async (req, res) => {
    try {
      const { id, nombre, porcentaje, tipo, estado } = req.body;
      if (!nombre) return res.status(400).json({ error: 'El nombre de la categoría es obligatorio.' });
      
      if (id) {
        await pool.query(
          'UPDATE commission_categories SET nombre=?, porcentaje=?, tipo=?, estado=? WHERE id=?',
          [nombre, parseFloat(porcentaje) || 0, tipo || 'Porcentaje', estado || 'Activa', id]
        );
      } else {
        await pool.query(
          'INSERT INTO commission_categories (nombre, porcentaje, tipo, estado) VALUES (?, ?, ?, ?)',
          [nombre, parseFloat(porcentaje) || 0, tipo || 'Porcentaje', estado || 'Activa']
        );
      }
      res.json({ success: true, message: 'Categoría guardada exitosamente' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/categories/:id', async (req, res) => {
    try {
      const { id } = req.params;
      await pool.query('DELETE FROM commission_categories WHERE id = ?', [id]);
      res.json({ success: true, message: 'Categoría eliminada' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Esquemas de Comisión ---
  router.get('/schemes', async (req, res) => {
    try {
      const [schemes] = await pool.query('SELECT * FROM commission_schemes ORDER BY id ASC');
      for (let s of schemes) {
        const [emps] = await pool.query('SELECT COUNT(*) as count FROM staff_records WHERE commission_scheme_id = ?', [s.id]);
        s.colaboradores_asignados = emps[0]?.count || 0;
      }
      res.json(schemes);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/schemes', async (req, res) => {
    try {
      const { id, nombre, descripcion, tipo, estado } = req.body;
      if (!nombre) return res.status(400).json({ error: 'El nombre del esquema es obligatorio.' });

      if (id) {
        await pool.query(
          'UPDATE commission_schemes SET nombre=?, descripcion=?, tipo=?, estado=? WHERE id=?',
          [nombre, descripcion || '', tipo || 'Por Categorías', estado || 'Activo', id]
        );
      } else {
        await pool.query(
          'INSERT INTO commission_schemes (nombre, descripcion, tipo, estado) VALUES (?, ?, ?, ?)',
          [nombre, descripcion || '', tipo || 'Por Categorías', estado || 'Activo']
        );
      }
      res.json({ success: true, message: 'Esquema de comisión guardado exitosamente' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/schemes/:id', async (req, res) => {
    try {
      const { id } = req.params;
      await pool.query('DELETE FROM commission_schemes WHERE id = ?', [id]);
      await pool.query('DELETE FROM commission_scheme_rules WHERE scheme_id = ?', [id]);
      res.json({ success: true, message: 'Esquema y sus reglas eliminados' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Asignar Colaboradores al Esquema ---
  router.post('/schemes/:id/assign-employees', async (req, res) => {
    try {
      const { id } = req.params;
      const { employee_ids } = req.body;
      const schemeId = parseInt(id, 10);
      if (isNaN(schemeId)) return res.status(400).json({ error: 'ID de esquema inválido' });

      const empIds = Array.isArray(employee_ids) ? employee_ids.map(x => parseInt(x, 10)).filter(x => !isNaN(x)) : [];

      if (empIds.length > 0) {
        const placeholders = empIds.map(() => '?').join(',');
        // Asignar esquema a los seleccionados
        await pool.query(`UPDATE staff_records SET commission_scheme_id = ?, scheme_effective_date = NOW() WHERE id IN (${placeholders})`, [schemeId, ...empIds]);
        // Quitar esquema a los que antes pertenecían a este esquema y no fueron seleccionados
        await pool.query(`UPDATE staff_records SET commission_scheme_id = NULL WHERE commission_scheme_id = ? AND id NOT IN (${placeholders})`, [schemeId, ...empIds]);
      } else {
        // Quitar todos los colaboradores de este esquema
        await pool.query('UPDATE staff_records SET commission_scheme_id = NULL WHERE commission_scheme_id = ?', [schemeId]);
      }

      // Auto-limpiar comisiones de empleados que quedaron sin esquema
      await pool.query(`
        DELETE c FROM employee_commissions_log c
        LEFT JOIN staff_records s ON (c.employee_id = s.id OR c.employee_name = s.nombre)
        WHERE (s.commission_scheme_id IS NULL OR s.commission_scheme_id = 0)
      `);

      // Recalcular comisiones pendientes de visitas facturadas para actualizar con el nuevo esquema
      try {
        const [visitsToProcess] = await pool.query(`
          SELECT v.id, v.ticket_number, v.items_detail, v.visited_at 
          FROM visits v 
          WHERE v.status = 'Facturado' AND v.items_detail IS NOT NULL 
          ORDER BY v.visited_at DESC LIMIT 200
        `);
        if (typeof processVisitCommissions === 'function') {
          for (const uv of visitsToProcess) {
            await processVisitCommissions(uv.id, uv.items_detail, uv.ticket_number, uv.visited_at);
          }
        }
      } catch (recalcErr) {
        console.warn('[RECALC ASSIGNED ERROR]:', recalcErr.message);
      }

      res.json({ success: true, message: 'Colaboradores asignados al esquema correctamente' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Reglas por Esquema ---
  router.get('/schemes/:id/rules', async (req, res) => {
    try {
      const { id } = req.params;
      const [rules] = await pool.query('SELECT * FROM commission_scheme_rules WHERE scheme_id = ? ORDER BY rule_type DESC, prioridad ASC, id ASC', [id]);
      res.json(rules);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/schemes/:id/rules', async (req, res) => {
    try {
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

      await pool.query(
        `INSERT INTO commission_scheme_rules (
          scheme_id, rule_type, category_name, service_name, tipo_calculo, valor, prioridad,
          operacion, monto_ajuste, porcentaje_comision, cantidad_meta, bono_monto, bono_tipo,
          periodo, repeticion, repeticion_limite, detalles_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, 
          rule_type, 
          category_name || null, 
          service_name || null, 
          tipo_calculo || 'Porcentaje', 
          parseFloat(valor) || 0, 
          parseInt(prioridad) || 1,
          operacion || (rule_type === 'especial' ? 'Restar' : null),
          parseFloat(monto_ajuste) || 0,
          parseFloat(porcentaje_comision) || (rule_type === 'especial' && operacion !== 'Contar' ? parseFloat(valor) || 0 : 0),
          parseInt(cantidad_meta) || 0,
          parseFloat(bono_monto) || 0,
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

  router.delete('/rules/:id', async (req, res) => {
    try {
      const { id } = req.params;
      await pool.query('DELETE FROM commission_scheme_rules WHERE id = ?', [id]);
      res.json({ success: true, message: 'Regla eliminada' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/rules', async (req, res) => {
    try {
      const [rules] = await pool.query('SELECT * FROM employee_commission_rules ORDER BY employee_id ASC');
      res.json(rules);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/rules', async (req, res) => {
    try {
      const { employee_id, service_name, tipo_comision, comision_valor } = req.body;
      if (!employee_id) return res.status(400).json({ error: 'Empleado es obligatorio.' });

      await pool.query(
        `INSERT INTO employee_commission_rules (employee_id, service_name, tipo_comision, comision_valor)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE tipo_comision = VALUES(tipo_comision), comision_valor = VALUES(comision_valor)`,
        [employee_id, service_name || 'General', tipo_comision || 'Porcentaje', parseFloat(comision_valor) || 0]
      );

      res.json({ success: true, message: 'Regla de comisión guardada exitosamente' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Liquidaciones (Payouts) ---
  router.post('/payout', async (req, res) => {
    try {
      const { employee_id, employee_name, commission_ids, metodo_pago, notas, usuario_liquidador } = req.body;

      if (!employee_id || !Array.isArray(commission_ids) || commission_ids.length === 0) {
        return res.status(400).json({ error: 'Empleado y comisiones seleccionadas son obligatorias.' });
      }

      const placeholders = commission_ids.map(() => '?').join(',');
      const [commRows] = await pool.query(
        `SELECT * FROM employee_commissions_log WHERE id IN (${placeholders}) AND status = 'Pendiente'`,
        commission_ids
      );

      if (commRows.length === 0) {
        return res.status(400).json({ error: 'No se encontraron comisiones pendientes elegibles para liquidar.' });
      }

      const montoTotal = commRows.reduce((acc, c) => acc + Number(c.monto_comision), 0);
      const dateCode = new Date().toISOString().slice(0,10).replace(/-/g,'');
      const payoutNumber = `LIQ-${dateCode}-${Math.floor(1000 + Math.random() * 9000)}`;

      const [payoutResult] = await pool.query(
        `INSERT INTO commission_payouts (payout_number, employee_id, employee_name, monto_total, total_items, metodo_pago, notas, usuario_liquidador, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          payoutNumber,
          employee_id,
          employee_name || commRows[0].employee_name || 'Empleado',
          montoTotal,
          commRows.length,
          metodo_pago || 'Efectivo',
          notas || '',
          usuario_liquidador || 'Admin'
        ]
      );

      const payoutId = payoutResult.insertId;

      await pool.query(
        `UPDATE employee_commissions_log SET status = 'Pagado', payout_id = ? WHERE id IN (${placeholders})`,
        [payoutId, ...commission_ids]
      );

      res.json({
        success: true,
        payoutNumber,
        montoTotal,
        message: `Liquidación ${payoutNumber} realizada exitosamente por RD$ ${montoTotal.toFixed(2)}`
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/payouts', async (req, res) => {
    try {
      const [payouts] = await pool.query('SELECT * FROM commission_payouts ORDER BY created_at DESC');
      res.json(payouts);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createCommissionsRouter };
