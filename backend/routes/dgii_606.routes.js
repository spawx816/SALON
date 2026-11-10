const express = require('express');

/**
 * DGII 606 Purchases & Expenses Report Router (Scoped strictly by tenant_id)
 */
function createDgii606Router(pool) {
  const router = express.Router();

  // 1. GET /api/dgii-606 - List 606 purchases for the authenticated tenant
  router.get('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { period, start_date, end_date, salon_id } = req.query;
      let query = 'SELECT * FROM dgii_606_purchases WHERE tenant_id = ?';
      const params = [tenantId];

      if (period && String(period).length === 6) {
        const y = String(period).slice(0, 4);
        const m = String(period).slice(4, 6);
        query += ' AND YEAR(fecha_comprobante) = ? AND MONTH(fecha_comprobante) = ?';
        params.push(Number(y), Number(m));
      } else if (start_date && end_date) {
        query += ' AND fecha_comprobante BETWEEN ? AND ?';
        params.push(start_date, end_date);
      }

      if (salon_id && salon_id !== 'all') {
        query += ' AND salon_id::text = ?';
        params.push(String(salon_id));
      }

      query += ' ORDER BY fecha_comprobante DESC, id DESC';
      const [rows] = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. POST /api/dgii-606 - Record a new 606 fiscal purchase within the authenticated tenant
  router.post('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const {
        rnc_cedula,
        tipo_id = '1',
         razon_social,
        tipo_bienes_servicios = '02',
        ncf,
        ncf_modificado = '',
        fecha_comprobante,
        fecha_pago,
        monto_servicios = 0,
        monto_bienes = 0,
        total_facturado = 0,
        itbis_facturado = 0,
        itbis_retenido = 0,
        monto_propina_legal = 0,
        isr_retenido = 0,
        forma_pago = '01',
        salon_id = 1,
        notes = ''
      } = req.body;

      if (!rnc_cedula || !ncf) {
        return res.status(400).json({ error: 'RNC/Cédula y NCF son obligatorios para el reporte 606.' });
      }

      const cleanFechaComp = fecha_comprobante ? String(fecha_comprobante).split('T')[0] : new Date().toISOString().split('T')[0];
      const cleanFechaPago = fecha_pago ? String(fecha_pago).split('T')[0] : cleanFechaComp;
      const calcTotal = Number(total_facturado) || (Number(monto_servicios || 0) + Number(monto_bienes || 0));

      const [result] = await pool.query(
        `INSERT INTO dgii_606_purchases (
           tenant_id, rnc_cedula, tipo_id, razon_social, tipo_bienes_servicios, ncf, ncf_modificado,
           fecha_comprobante, fecha_pago, monto_servicios, monto_bienes, total_facturado,
           itbis_facturado, itbis_retenido, monto_propina_legal, isr_retenido, forma_pago, salon_id, notes, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         RETURNING id`,
        [
          tenantId,
          String(rnc_cedula).replace(/\D/g, ''),
          tipo_id,
          razon_social || 'Proveedor',
          tipo_bienes_servicios,
          String(ncf).trim().toUpperCase(),
          ncf_modificado || null,
          cleanFechaComp,
          cleanFechaPago,
          Number(monto_servicios) || 0,
          Number(monto_bienes) || 0,
          calcTotal,
          Number(itbis_facturado) || 0,
          Number(itbis_retenido) || 0,
          Number(monto_propina_legal) || 0,
          Number(isr_retenido) || 0,
          forma_pago,
          salon_id,
          notes
        ]
      );

      res.json({ id: result.insertId || result[0]?.id, success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. PUT /api/dgii-606/:id - Update 606 record within the authenticated tenant
  router.put('/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const {
        rnc_cedula,
        razon_social,
        tipo_bienes_servicios,
        ncf,
        fecha_comprobante,
        monto_servicios,
        monto_bienes,
        total_facturado,
        itbis_facturado,
        forma_pago,
        notes
      } = req.body;

      await pool.query(
        `UPDATE dgii_606_purchases SET
           rnc_cedula = COALESCE(?, rnc_cedula),
           razon_social = COALESCE(?, razon_social),
           tipo_bienes_servicios = COALESCE(?, tipo_bienes_servicios),
           ncf = COALESCE(?, ncf),
           fecha_comprobante = COALESCE(?, fecha_comprobante),
           monto_servicios = COALESCE(?, monto_servicios),
           monto_bienes = COALESCE(?, monto_bienes),
           total_facturado = COALESCE(?, total_facturado),
           itbis_facturado = COALESCE(?, itbis_facturado),
           forma_pago = COALESCE(?, forma_pago),
           notes = COALESCE(?, notes)
         WHERE id = ? AND tenant_id = ?`,
        [
          rnc_cedula ? String(rnc_cedula).replace(/\D/g, '') : null,
          razon_social || null,
          tipo_bienes_servicios || null,
          ncf ? String(ncf).trim().toUpperCase() : null,
          fecha_comprobante ? String(fecha_comprobante).split('T')[0] : null,
          monto_servicios !== undefined ? Number(monto_servicios) : null,
          monto_bienes !== undefined ? Number(monto_bienes) : null,
          total_facturado !== undefined ? Number(total_facturado) : null,
          itbis_facturado !== undefined ? Number(itbis_facturado) : null,
          forma_pago || null,
          notes !== undefined ? notes : null,
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
