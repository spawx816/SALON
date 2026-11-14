const express = require('express');

/**
 * DGII 606 Purchases & Expenses Report Router (Scoped strictly by tenant_id)
 */
function createDgii606Router(pool) {
  const router = express.Router();

  // 1. GET /api/dgii/report-606 - List 606 purchases for the authenticated tenant
  router.get('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const targetPeriod = req.query.periodo || req.query.period || '';
      const { start_date, end_date } = req.query;
      let query = 'SELECT * FROM dgii_606_purchases WHERE tenant_id = ?';
      const params = [tenantId];

      if (targetPeriod && /^\d{6}$/.test(String(targetPeriod))) {
        const y = String(targetPeriod).slice(0, 4);
        const m = String(targetPeriod).slice(4, 6);
        query += ' AND (periodo = ? OR (LEFT(fecha_factura, 4) = ? AND SUBSTRING(fecha_factura, 6, 2) = ?))';
        params.push(String(targetPeriod), y, m);
      } else if (start_date && end_date) {
        query += ' AND fecha_factura BETWEEN ? AND ?';
        params.push(start_date, end_date);
      }

      query += ' ORDER BY fecha_factura DESC, id DESC';
      const [rows] = await pool.query(query, params);
      const records = rows || [];

      const [tRows] = await pool.query('SELECT business_name, rnc FROM tenants WHERE id = ? LIMIT 1', [tenantId]);
      const tenant = tRows[0] || {};

      const totals = records.reduce((acc, row) => {
        acc.monto_servicios += Number(row.monto_servicios || 0);
        acc.monto_bienes += Number(row.monto_bienes || 0);
        acc.total_facturado += Number(row.total_facturado || 0);
        acc.itbis_facturado += Number(row.itbis_facturado || 0);
        acc.itbis_retenido += Number(row.itbis_retenido || 0);
        acc.isr_retenido += Number(row.isr_retenido || 0);
        acc.propina_legal += Number(row.propina_legal || 0);
        return acc;
      }, {
        monto_servicios: 0,
        monto_bienes: 0,
        total_facturado: 0,
        itbis_facturado: 0,
        itbis_retenido: 0,
        isr_retenido: 0,
        propina_legal: 0
      });

      const pendingCount = records.filter(r => r.estado && r.estado !== 'Completa').length;
      res.json({
        header: {
          empresa: tenant.business_name || 'SalonPro',
          rnc: tenant.rnc || '',
          periodo: targetPeriod || '',
          cantidad_registros: records.length,
          facturas_por_revisar: pendingCount,
          fecha_impresion: new Date().toLocaleDateString('es-DO')
        },
        records,
        totals
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. POST /api/dgii/report-606 - Record a new 606 fiscal purchase within the authenticated tenant
  router.post('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const {
        periodo,
        rnc_cedula,
        tipo_id = 1,
        proveedor,
        razon_social,
        tipo_bienes_servicios = '02',
        ncf,
        ncf_modificado = '',
        fecha_factura,
        fecha_comprobante,
        fecha_pago,
        tipo_compra = 'Bienes',
        clasificacion_gasto = '02 - Gastos por trabajos, suministros y servicios',
        monto_servicios = 0,
        monto_bienes = 0,
        total_facturado = 0,
        itbis_facturado = 0,
        itbis_retenido = 0,
        propina_legal = 0,
        monto_propina_legal = 0,
        isr_retenido = 0,
        forma_pago = '02',
        notas,
        notes = ''
      } = req.body;

      if (!rnc_cedula || !ncf) {
        return res.status(400).json({ error: 'RNC/Cédula y NCF son obligatorios para el reporte 606.' });
      }

      const rawFecha = fecha_factura || fecha_comprobante;
      const cleanFechaFact = rawFecha ? String(rawFecha).split('T')[0] : new Date().toISOString().split('T')[0];
      const cleanFechaPago = fecha_pago ? String(fecha_pago).split('T')[0] : cleanFechaFact;
      const cleanPeriodo = periodo && /^\d{6}$/.test(String(periodo))
        ? String(periodo)
        : cleanFechaFact.slice(0, 7).replace('-', '');
      const calcTotal = Number(total_facturado) || (Number(monto_servicios || 0) + Number(monto_bienes || 0));

      const [result] = await pool.query(
        `INSERT INTO dgii_606_purchases (
           tenant_id, periodo, rnc_cedula, tipo_id, proveedor, tipo_bienes_servicios, ncf, ncf_modificado,
           fecha_factura, fecha_pago, tipo_compra, clasificacion_gasto, monto_servicios, monto_bienes, total_facturado,
           itbis_facturado, itbis_retenido, propina_legal, isr_retenido, forma_pago, notas, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         RETURNING id`,
        [
          tenantId,
          cleanPeriodo,
          String(rnc_cedula).replace(/\D/g, ''),
          parseInt(tipo_id, 10) || 1,
          proveedor || razon_social || 'Proveedor',
          tipo_bienes_servicios,
          String(ncf).trim().toUpperCase(),
          ncf_modificado || '',
          cleanFechaFact,
          cleanFechaPago,
          tipo_compra,
          clasificacion_gasto,
          Number(monto_servicios) || 0,
          Number(monto_bienes) || 0,
          calcTotal,
          Number(itbis_facturado) || 0,
          Number(itbis_retenido) || 0,
          Number(propina_legal || monto_propina_legal) || 0,
          Number(isr_retenido) || 0,
          forma_pago,
          notas !== undefined ? notas : notes
        ]
      );

      res.json({ id: result.insertId || result[0]?.id, success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. PUT /api/dgii/report-606/:id - Update 606 record within the authenticated tenant
  router.put('/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const {
        rnc_cedula,
        proveedor,
        razon_social,
        tipo_bienes_servicios,
        ncf,
        fecha_factura,
        fecha_comprobante,
        monto_servicios,
        monto_bienes,
        total_facturado,
        itbis_facturado,
        forma_pago,
        notas,
        notes
      } = req.body;

      const resolvedProveedor = proveedor || razon_social || null;
      const resolvedFecha = fecha_factura || fecha_comprobante || null;
      const resolvedNotas = notas !== undefined ? notas : notes;

      await pool.query(
        `UPDATE dgii_606_purchases SET
           rnc_cedula = COALESCE(?, rnc_cedula),
           proveedor = COALESCE(?, proveedor),
           tipo_bienes_servicios = COALESCE(?, tipo_bienes_servicios),
           ncf = COALESCE(?, ncf),
           fecha_factura = COALESCE(?, fecha_factura),
           monto_servicios = COALESCE(?, monto_servicios),
           monto_bienes = COALESCE(?, monto_bienes),
           total_facturado = COALESCE(?, total_facturado),
           itbis_facturado = COALESCE(?, itbis_facturado),
           forma_pago = COALESCE(?, forma_pago),
           notas = COALESCE(?, notas),
           updated_at = NOW()
         WHERE id = ? AND tenant_id = ?`,
        [
          rnc_cedula ? String(rnc_cedula).replace(/\D/g, '') : null,
          resolvedProveedor,
          tipo_bienes_servicios || null,
          ncf ? String(ncf).trim().toUpperCase() : null,
          resolvedFecha ? String(resolvedFecha).split('T')[0] : null,
          monto_servicios !== undefined ? Number(monto_servicios) : null,
          monto_bienes !== undefined ? Number(monto_bienes) : null,
          total_facturado !== undefined ? Number(total_facturado) : null,
          itbis_facturado !== undefined ? Number(itbis_facturado) : null,
          forma_pago || null,
          resolvedNotas !== undefined ? resolvedNotas : null,
          id,
          tenantId
        ]
      );

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. DELETE /api/dgii-606/:id - Delete 606 record within the authenticated tenant
  router.delete('/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      await pool.query('DELETE FROM dgii_606_purchases WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createDgii606Router };
