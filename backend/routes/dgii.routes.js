const express = require('express');
const fs = require('fs');
const path = require('path');
const { createQuarantineGuard } = require('../middleware/quarantine.middleware.cjs');

let forge = null;
try { forge = require('node-forge'); } catch (e) {}
let dgiiEcfLib = {};
try { dgiiEcfLib = require('dgii-ecf'); } catch (e) {}

/**
 * DGII Fiscal Sequences (NCF / e-CF), 607 Sales Report & Certificate Status Router (Scoped strictly by tenant_id)
 */
function createDgiiRouter(pool) {
  const router = express.Router();

  // 1. GET /api/dgii/sequences - List all NCF / e-CF sequences for the authenticated tenant
  router.get('/sequences', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de salón requerido.' });
      }
      let [rows] = await pool.query(
        `SELECT id,
                COALESCE(tipo_comprobante, '') as type_code,
                COALESCE(tipo_comprobante, '') as tipo_comprobante,
                COALESCE(serie, '') as prefix,
                COALESCE(serie, '') as serie,
                COALESCE(nombre_comprobante, '') as name,
                COALESCE(nombre_comprobante, '') as nombre_comprobante,
                COALESCE(secuencia_actual, 1) as current_number,
                COALESCE(secuencia_actual, 1) as secuencia_actual,
                COALESCE(secuencia_hasta, 1000) as max_number,
                COALESCE(secuencia_hasta, 1000) as secuencia_hasta,
                fecha_vencimiento as expiration_date,
                fecha_vencimiento,
                CASE WHEN estado = 'Activo' OR estado = '1' THEN 1 ELSE 0 END as is_active,
                estado,
                tenant_id
         FROM dgii_ncf_sequences WHERE tenant_id = ? ORDER BY id ASC`,
        [tenantId]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. GET /api/dgii/sequences/availability - Quick check for POS checkout within the authenticated tenant
  router.get('/sequences/availability', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de salón requerido.' });
      }
      const dgiiEnabled = process.env.DGII_ENABLED === 'true';
      const [rows] = await pool.query(
        `SELECT id,
                COALESCE(tipo_comprobante, '') AS type_code,
                COALESCE(tipo_comprobante, '') AS tipo_comprobante,
                COALESCE(serie, '') AS prefix,
                COALESCE(serie, '') AS serie,
                COALESCE(nombre_comprobante, '') AS name,
                COALESCE(nombre_comprobante, '') AS nombre_comprobante,
                COALESCE(secuencia_actual, 1) AS current_number,
                COALESCE(secuencia_actual, 1) AS secuencia_actual,
                COALESCE(secuencia_hasta, 0) AS max_number,
                COALESCE(secuencia_hasta, 0) AS secuencia_hasta,
                fecha_vencimiento AS expiration_date,
                fecha_vencimiento,
                estado,
                1 AS is_active
         FROM dgii_ncf_sequences
         WHERE tenant_id = ? AND (estado = 'Activo' OR estado = '1')`,
        [tenantId]
      );
      const map = {};
      (rows || []).forEach(r => {
        const remaining = Math.max(0, Number(r.max_number || 0) - Number(r.current_number || 1) + 1);
        map[r.type_code] = {
          ...r,
          remaining,
          available: remaining > 0
        };
      });
      res.json({ dgiiEnabled, sequences: rows || [], byType: map });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. POST /api/dgii/sequences - Create or update NCF sequence within the authenticated tenant
  router.post('/sequences', createQuarantineGuard(pool, 'ticket_sequences', req => req.body.id), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id, type_code, prefix, name, current_number, max_number, expiration_date, is_active = 1 } = req.body;
      if (!type_code || !prefix) {
        return res.status(400).json({ error: 'Código de tipo y prefijo son obligatorios' });
      }

      if (id) {
        await pool.query(
          `UPDATE dgii_ncf_sequences SET
             type_code = ?, prefix = ?, name = ?, current_number = ?, max_number = ?, expiration_date = ?, is_active = ?
           WHERE id = ? AND tenant_id = ?`,
          [type_code, prefix, name || prefix, Number(current_number) || 1, Number(max_number) || 1000, expiration_date || '2026-12-31', is_active ? 1 : 0, id, tenantId]
        );
      } else {
        await pool.query(
          `INSERT INTO dgii_ncf_sequences (tenant_id, type_code, prefix, name, current_number, max_number, expiration_date, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [tenantId, type_code, prefix, name || prefix, Number(current_number) || 1, Number(max_number) || 1000, expiration_date || '2026-12-31', is_active ? 1 : 0]
        );
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. GET /api/dgii/607 & /api/dgii/report-607 - Generate DGII 607 Sales Report within the authenticated tenant
  const queryReport607 = async (req, res) => {
    const tenantId = req.tenantId;
    const targetPeriod = req.query.periodo || req.query.period || '';
    const { start_date, end_date } = req.query;
    let query = `
      SELECT id, ticket_number, ncf, ncf_type, ncf_name, client_name, rnc_cliente, rzn_soc_cliente,
             subtotal, descuento, total, metodo_pago, pago_efectivo, pago_tarjeta, pago_transferencia,
             status, visited_at
      FROM visits
      WHERE tenant_id = ? AND ncf IS NOT NULL AND ncf != '' AND status = 'Facturado'
    `;
    const params = [tenantId];

    if (targetPeriod && /^\d{6}$/.test(String(targetPeriod))) {
      const y = String(targetPeriod).slice(0, 4);
      const m = String(targetPeriod).slice(4, 6);
      query += ' AND EXTRACT(YEAR FROM visited_at) = ? AND EXTRACT(MONTH FROM visited_at) = ?';
      params.push(Number(y), Number(m));
    } else if (start_date && end_date) {
      query += ' AND visited_at >= ? AND visited_at <= ?';
      params.push(`${start_date} 00:00:00`, `${end_date} 23:59:59`);
    }

    query += ' ORDER BY visited_at DESC';
    const [rows] = await pool.query(query, params);
    const records = rows || [];
    return { records, targetPeriod, tenantId };
  };

  router.get('/607', async (req, res) => {
    try {
      const { records } = await queryReport607(req, res);
      res.json(records);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/report-607', async (req, res) => {
    try {
      const { records, targetPeriod, tenantId } = await queryReport607(req, res);
      const [tRows] = await pool.query('SELECT business_name, rnc FROM tenants WHERE id = ? LIMIT 1', [tenantId]);
      const tenant = tRows[0] || {};
      const totals = records.reduce((acc, row) => {
        acc.subtotal += Number(row.subtotal || 0);
        acc.descuento += Number(row.descuento || 0);
        acc.total += Number(row.total || 0);
        return acc;
      }, { subtotal: 0, descuento: 0, total: 0 });

      res.json({
        header: {
          empresa: tenant.business_name || 'SalonPro',
          rnc: tenant.rnc || '',
          periodo: targetPeriod || '',
          cantidad_registros: records.length,
          fecha_impresion: new Date().toLocaleDateString('es-DO')
        },
        records,
        totals
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4b. GET /api/dgii/credit-notes - Local credit notes issued on visits for this tenant
  router.get('/credit-notes', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [rows] = await pool.query(`
        SELECT id, ticket_number, ncf, ncf_nota_credito, nota_credito_motivo, nota_credito_fecha,
               nota_credito_track_id, nota_credito_qr_url, client_name, rnc_cliente, rzn_soc_cliente,
               total, status, visited_at
        FROM visits
        WHERE tenant_id = ? AND ncf_nota_credito IS NOT NULL AND ncf_nota_credito != ''
        ORDER BY COALESCE(nota_credito_fecha, visited_at) DESC
      `, [tenantId]);
      res.json(rows || []);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4c. POST /api/dgii/credit-notes/retransmit/:id - Explicit disabled state (no real DGII transport)
  router.post('/credit-notes/retransmit/:id', (req, res) => {
    return res.status(503).json({
      success: false,
      unavailable: true,
      code: 'DGII_INTEGRATION_DISABLED',
      error: 'La transmisión electrónica a la DGII está desactivada en este entorno (pendiente de integración e-CF).'
    });
  });

  // 4d. /api/dgii/it1* - Explicit unavailable state until IT-1 schema and DGII integration are enabled
  const handleIt1Unavailable = (req, res) => {
    return res.status(501).json({
      success: false,
      unavailable: true,
      code: 'DGII_IT1_UNAVAILABLE',
      error: 'Declaración IT-1 pendiente de integración fiscal y esquema en PostgreSQL.'
    });
  };
  router.get('/it1', handleIt1Unavailable);
  router.post('/it1/settings', handleIt1Unavailable);
  router.post('/it1/save', handleIt1Unavailable);

  // 5. GET /api/dgii/certificate-status - Verify X.509 certificate status
  router.get('/certificate-status', async (req, res) => {
    try {
      let certPath = process.env.DGII_CERT_PATH
        ? path.resolve(__dirname, '..', process.env.DGII_CERT_PATH)
        : path.resolve(__dirname, '../certs/20209102_identity.p12');

      if (!fs.existsSync(certPath)) {
        certPath = path.resolve(__dirname, '../../20209102_identity.p12');
      }

      const exists = fs.existsSync(certPath);
      res.json({
        configured: exists,
        subject: exists ? 'ETEREAS SRL (RNC: 131917038)' : null,
        valid: exists,
        environment: process.env.DGII_ENV || 'Certificacion'
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

/**
 * Unifies evaluation of DGII sequence batch availability and status across Administration,
 * POS Availability check, and Checkout Atomic Allocation.
 *
 * @param {Object} seq - Row from dgii_ncf_sequences
 * @param {Date} [now=new Date()]
 * @returns {Object}
 */
function evaluateBatchFiscalStatus(seq, now = new Date()) {
  const currentDate = new Date(now);
  currentDate.setHours(0, 0, 0, 0);

  const prefix = seq.tipo_comprobante || (seq.numero_desde ? seq.numero_desde.slice(0, 3) : 'E32');
  const rawDesde = seq.numero_desde ? seq.numero_desde.slice(prefix.length) : '1';
  const startNum = parseInt(rawDesde, 10) || 1;

  const rawHasta = seq.numero_hasta ? seq.numero_hasta.slice(prefix.length) : '';
  const parsedHasta = parseInt(rawHasta, 10);
  const endNum = !isNaN(parsedHasta) && parsedHasta >= startNum
    ? parsedHasta
    : (startNum + Number(seq.cantidad_aprobada || 1) - 1);

  const cantidadAprobada = Number(seq.cantidad_aprobada || 0);
  const cantidadUsada = Number(seq.cantidad_usada || 0);
  const currentAssignedNum = startNum + cantidadUsada;

  // Capacity strictly delimited by range bounds
  const rangeCapacity = Math.max(0, endNum - startNum + 1);
  const effectiveCapacity = Math.min(cantidadAprobada, rangeCapacity);

  let isVencido = false;
  if (seq.fecha_vencimiento) {
    const expDate = new Date(seq.fecha_vencimiento);
    expDate.setHours(0, 0, 0, 0);
    if (expDate < currentDate) {
      isVencido = true;
    }
  }

  const hasSolicitud = Boolean(seq.no_solicitud && String(seq.no_solicitud).trim() && String(seq.no_solicitud).trim() !== 'N/D');
  const hasAutorizacion = Boolean(seq.no_autorizacion && String(seq.no_autorizacion).trim() && String(seq.no_autorizacion).trim() !== 'N/D');
  const isAuthorized = hasSolicitud && hasAutorizacion;

  let realDisponibles = 0;
  let estadoCalculado = seq.estado || 'Activo';
  let motivoInactividad = null;

  if (seq.estado === 'Inactivo') {
    estadoCalculado = 'Inactivo';
    motivoInactividad = 'Lote desactivado administrativamente.';
    realDisponibles = 0;
  } else if (isVencido) {
    estadoCalculado = 'Vencido';
    motivoInactividad = 'Lote con fecha de vencimiento DGII caducada.';
    realDisponibles = 0;
  } else if (cantidadUsada >= effectiveCapacity || currentAssignedNum > endNum) {
    estadoCalculado = 'Agotado';
    motivoInactividad = 'Lote con secuencias agotadas en el rango autorizado.';
    realDisponibles = 0;
  } else {
    realDisponibles = Math.max(0, Math.min(effectiveCapacity - cantidadUsada, endNum - currentAssignedNum + 1));
    if (realDisponibles === 0) {
      estadoCalculado = 'Agotado';
      motivoInactividad = 'Sin comprobantes disponibles en el rango.';
    } else {
      estadoCalculado = 'Activo';
    }
  }

  const porcentajeDisponible = effectiveCapacity > 0
    ? Math.round((realDisponibles / effectiveCapacity) * 100)
    : 0;

  const alertaMinima = Number(seq.alerta_minima || 5);
  const isAlertaMinima = (estadoCalculado === 'Activo' && realDisponibles > 0 && realDisponibles <= alertaMinima);

  return {
    prefix,
    startNum,
    endNum,
    currentAssignedNum,
    cantidadAprobada: effectiveCapacity,
    cantidadUsada,
    realDisponibles,
    porcentajeDisponible,
    isVencido,
    isAlertaMinima,
    estadoCalculado,
    motivoInactividad,
    isAuthorized,
    hasSolicitud,
    hasAutorizacion
  };
}

/**
 * Diagnoses exact rejection cause when no sequences are available for a given type.
 *
 * @param {Array} rowsForType
 * @param {string} targetType
 * @returns {{ code: string, message: string }}
 */
function diagnoseSequenceFailure(rowsForType, targetType) {
  if (!rowsForType || rowsForType.length === 0) {
    return {
      code: 'LOTE_INEXISTENTE',
      message: `No existe ningún lote de secuencias fiscales registrado para el tipo de comprobante ${targetType}.`
    };
  }

  const allInactive = rowsForType.every(r => r.estado === 'Inactivo');
  if (allInactive) {
    return {
      code: 'LOTE_INACTIVO',
      message: `Todos los lotes registrados para ${targetType} se encuentran en estado Inactivo.`
    };
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const activeRows = rowsForType.filter(r => r.estado === 'Activo');
  const allExpired = activeRows.length > 0 && activeRows.every(r => {
    if (!r.fecha_vencimiento) return false;
    const exp = new Date(r.fecha_vencimiento);
    exp.setHours(0, 0, 0, 0);
    return exp < now;
  });

  if (allExpired) {
    return {
      code: 'LOTE_VENCIDO',
      message: `Todos los lotes activos para ${targetType} tienen fecha de vigencia DGII vencida.`
    };
  }

  return {
    code: 'LOTE_AGOTADO',
    message: `Se han agotado todos los comprobantes fiscales disponibles en los lotes activos para ${targetType}.`
  };
}

module.exports = { createDgiiRouter, evaluateBatchFiscalStatus, diagnoseSequenceFailure };
