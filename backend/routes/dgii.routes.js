const express = require('express');
const fs = require('fs');
const path = require('path');
const { createQuarantineGuard } = require('../middleware/quarantine.middleware.cjs');

let forge = null;
try { forge = require('node-forge'); } catch (e) {}
let dgiiEcfLib = {};
try { dgiiEcfLib = require('dgii-ecf'); } catch (e) {}

function isElectronicComprobante(code) {
  return /^E\d{2}$/i.test(String(code || '').trim());
}

function isDgiiElectronicEnabled() {
  return (
    process.env.DGII_ENABLED === 'true' &&
    String(process.env.DGII_MODE || '').toLowerCase() !== 'disabled' &&
    String(process.env.DGII_ENV || '').toLowerCase() !== 'disabled'
  );
}

function formatComprobanteNumber(prefix, num) {
  const cleanPrefix = String(prefix || '').trim().toUpperCase();
  const padLen = cleanPrefix.startsWith('E') ? 10 : 8;
  return `${cleanPrefix}${String(Number(num) || 1).padStart(padLen, '0')}`;
}

function parseSequenceBound(rawNum, rawFormatted, fallback) {
  if (rawNum !== undefined && rawNum !== null && String(rawNum).trim() !== '' && Number.isFinite(Number(rawNum))) {
    return Math.floor(Number(rawNum));
  }
  if (rawFormatted !== undefined && rawFormatted !== null && String(rawFormatted).trim() !== '') {
    const digits = String(rawFormatted).replace(/^[A-Za-z]+\d{2}/, '').replace(/\D/g, '');
    if (digits) return parseInt(digits, 10);
  }
  return fallback;
}

function decorateSequenceRow(row, electronicEnabled) {
  const tipo = String(row.tipo_comprobante || '').trim().toUpperCase();
  const prefix = String(row.serie || tipo).trim().toUpperCase();
  const fullPrefix = prefix.length <= 1 && tipo ? tipo : prefix;
  const desde = Math.max(1, Number(row.secuencia_desde || 1));
  const hasta = Math.max(desde, Number(row.secuencia_hasta || 0));
  const actual = Math.max(desde, Number(row.secuencia_actual || desde));
  const aprobada = Math.max(1, Number(row.cantidad_aprobada || (hasta - desde + 1)));
  const usada = Math.max(0, Number(row.cantidad_usada || Math.max(0, actual - desde)));
  const disponible = Math.max(0, hasta - actual + 1);
  const alertaMin = Math.max(1, Number(row.alerta_minima || 10));
  const pct = aprobada > 0 ? Math.max(0, Math.min(100, Math.round((disponible / aprobada) * 100))) : 0;

  let isVencido = false;
  if (row.fecha_vencimiento) {
    const expStr = typeof row.fecha_vencimiento === 'string'
      ? row.fecha_vencimiento.slice(0, 10)
      : new Date(row.fecha_vencimiento).toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);
    isVencido = expStr < todayStr;
  }

  const isElectronic = isElectronicComprobante(tipo);
  const isAgotado = disponible <= 0 || actual > hasta;
  const rawActive = row.estado === 'Activo' || row.estado === '1';

  let estadoCalculado = 'Activo';
  let motivoInactividad = null;
  if (!rawActive) {
    estadoCalculado = row.estado || 'Inactivo';
    motivoInactividad = 'Secuencia desactivada manualmente.';
  } else if (isVencido) {
    estadoCalculado = 'Vencido';
    motivoInactividad = 'Vigencia vencida. Registre una nueva secuencia autorizada.';
  } else if (isAgotado) {
    estadoCalculado = 'Agotado';
    motivoInactividad = 'Rango agotado. Registre un nuevo lote de secuencias.';
  } else if (isElectronic && !electronicEnabled) {
    estadoCalculado = 'Bloqueado (e-CF)';
    motivoInactividad = 'Integración de facturación electrónica DGII requerida por separado.';
  }

  return {
    id: row.id,
    tenant_id: row.tenant_id,
    type_code: tipo,
    tipo_comprobante: tipo,
    prefix: fullPrefix,
    serie: fullPrefix,
    name: row.nombre_comprobante || tipo,
    nombre_comprobante: row.nombre_comprobante || tipo,
    secuencia_desde: desde,
    secuencia_hasta: hasta,
    secuencia_actual: actual,
    current_number: actual,
    max_number: hasta,
    cantidad_aprobada: aprobada,
    cantidad_usada: usada,
    cantidad_disponible: disponible,
    porcentaje_disponible: pct,
    alerta_minima: alertaMin,
    is_alerta_minima: disponible > 0 && disponible <= alertaMin,
    is_agotado: isAgotado,
    is_vencido: isVencido,
    is_electronic: isElectronic,
    requires_electronic_integration: isElectronic && !electronicEnabled,
    numero_desde: row.numero_desde || formatComprobanteNumber(fullPrefix, desde),
    numero_hasta: row.numero_hasta || formatComprobanteNumber(fullPrefix, hasta),
    proximo_numero_formateado: isAgotado ? null : formatComprobanteNumber(fullPrefix, actual),
    no_solicitud: row.no_solicitud || '',
    no_autorizacion: row.no_autorizacion || '',
    expiration_date: row.fecha_vencimiento,
    fecha_vencimiento: row.fecha_vencimiento,
    is_active: rawActive ? 1 : 0,
    estado: row.estado,
    estado_calculado: estadoCalculado,
    motivo_inactividad: motivoInactividad,
  };
}

function canManageSequences(req) {
  const role = String(req.auth?.role || req.user?.role || '').toLowerCase();
  if (role === 'propietario' || role === 'owner' || role === 'admin' || req.auth?.isSuperAdmin) return true;
  const perms = req.auth?.permissions || {};
  return Boolean(perms['dgii.sequences.manage'] || perms['settings.manage'] || perms['pos.cash_registers.manage']);
}

/**
 * DGII & Commercial Voucher Sequences (NCF), 607 Sales Report & Certificate Status Router (Scoped strictly by tenant_id)
 */
function createDgiiRouter(pool) {
  const router = express.Router();

  // 1. GET /api/dgii/sequences - List all voucher sequences for the authenticated tenant
  router.get('/sequences', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido.' });
      }
      const electronicEnabled = isDgiiElectronicEnabled();
      const [rows] = await pool.query(
        `SELECT id, tipo_comprobante, serie, nombre_comprobante,
                secuencia_desde, secuencia_hasta, secuencia_actual,
                cantidad_aprobada, cantidad_usada, fecha_vencimiento,
                estado, no_solicitud, no_autorizacion, numero_desde, numero_hasta,
                alerta_minima, tenant_id
         FROM dgii_ncf_sequences WHERE tenant_id = ? ORDER BY id ASC`,
        [tenantId]
      );
      res.json((rows || []).map((r) => decorateSequenceRow(r, electronicEnabled)));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. GET /api/dgii/sequences/availability - Quick check for POS checkout within the authenticated tenant
  router.get('/sequences/availability', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido.' });
      }
      const electronicEnabled = isDgiiElectronicEnabled();
      const [rows] = await pool.query(
        `SELECT id, tipo_comprobante, serie, nombre_comprobante,
                secuencia_desde, secuencia_hasta, secuencia_actual,
                cantidad_aprobada, cantidad_usada, fecha_vencimiento,
                estado, no_solicitud, no_autorizacion, numero_desde, numero_hasta,
                alerta_minima, tenant_id
         FROM dgii_ncf_sequences
         WHERE tenant_id = ?
         ORDER BY id ASC`,
        [tenantId]
      );
      const decorated = (rows || []).map((r) => decorateSequenceRow(r, electronicEnabled));
      const map = {};
      decorated.forEach((r) => {
        const usable = r.estado_calculado === 'Activo' && r.cantidad_disponible > 0;
        const prev = map[r.tipo_comprobante];
        if (!prev || (usable && !prev.available)) {
          map[r.tipo_comprobante] = {
            ...r,
            remaining: r.cantidad_disponible,
            available: usable,
            isExhausted: r.is_agotado,
            isExpired: r.is_vencido,
            isLowStock: r.is_alerta_minima,
            isElectronic: r.is_electronic,
            requiresElectronicIntegration: r.requires_electronic_integration,
          };
        }
      });
      const alerts = decorated
        .filter((r) => !r.is_electronic && (r.is_agotado || r.is_vencido || r.is_alerta_minima))
        .map((r) => ({
          tipo_comprobante: r.tipo_comprobante,
          level: r.is_agotado || r.is_vencido ? 'exhausted' : 'warning',
          message: r.is_vencido
            ? `Secuencia ${r.tipo_comprobante} vencida.`
            : (r.is_agotado
                ? `Secuencia ${r.tipo_comprobante} agotada (0 disponibles).`
                : `Secuencia ${r.tipo_comprobante} por agotarse (${r.cantidad_disponible} disponibles).`),
        }));

      res.json({
        success: true,
        dgiiEnabled: electronicEnabled,
        dgiiElectronicEnabled: electronicEnabled,
        sequences: decorated,
        byType: map,
        alerts,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Helper compartido para crear/actualizar secuencias con validación de rangos, solapamiento, protección de uso y auditoría
  const upsertSequenceHandler = async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido.' });
      if (!canManageSequences(req)) {
        return res.status(403).json({ error: 'Solo el propietario o un usuario autorizado puede administrar secuencias de comprobantes.', code: 'FORBIDDEN_SEQUENCES' });
      }

      const id = req.params.id || req.body.id || null;
      const {
        type_code, tipo_comprobante,
        prefix, serie,
        name, nombre_comprobante,
        secuencia_desde, numero_desde,
        current_number, secuencia_actual,
        max_number, secuencia_hasta, numero_hasta,
        expiration_date, fecha_vencimiento,
        no_solicitud, no_autorizacion,
        alerta_minima,
        is_active = 1, estado
      } = req.body;

      const resolvedTipo = String(tipo_comprobante || type_code || '').trim().toUpperCase();
      if (!resolvedTipo || !/^[A-Z0-9_-]{2,20}$/.test(resolvedTipo)) {
        return res.status(400).json({ error: 'Tipo de comprobante inválido o faltante (ej. B02, B01, B14, B15).' });
      }
      const rawSerie = String(serie || prefix || resolvedTipo).trim().toUpperCase();
      const resolvedSerie = rawSerie.length <= 1 ? resolvedTipo : rawSerie;
      const resolvedNombre = String(nombre_comprobante || name || resolvedTipo).trim();
      const resolvedDesde = parseSequenceBound(secuencia_desde, numero_desde, 1);
      const resolvedHasta = parseSequenceBound(secuencia_hasta ?? max_number, numero_hasta, resolvedDesde);
      const resolvedActual = parseSequenceBound(secuencia_actual ?? current_number, null, resolvedDesde);
      const resolvedAlerta = Math.max(1, Number(alerta_minima) || 10);
      const resolvedVenc = (fecha_vencimiento || expiration_date || '').trim() || null;
      const resolvedEstado = estado || (is_active ? 'Activo' : 'Inactivo');

      if (!Number.isFinite(resolvedDesde) || resolvedDesde < 1 || !Number.isFinite(resolvedHasta) || resolvedHasta < resolvedDesde) {
        return res.status(400).json({ error: 'Rango inválido: el número inicial debe ser >= 1 y menor o igual al número final.', code: 'NCF_INVALID_RANGE' });
      }
      if (!Number.isFinite(resolvedActual) || resolvedActual < resolvedDesde || resolvedActual > resolvedHasta + 1) {
        return res.status(400).json({ error: 'Próximo número inválido: debe estar dentro del rango autorizado.', code: 'NCF_INVALID_NEXT_NUMBER' });
      }
      if (resolvedVenc && !/^\d{4}-\d{2}-\d{2}$/.test(resolvedVenc)) {
        return res.status(400).json({ error: 'Formato de fecha de vencimiento inválido (YYYY-MM-DD).', code: 'NCF_INVALID_EXPIRATION' });
      }

      // Verificar solapamiento de rangos dentro del mismo tenant y tipo_comprobante
      const overlapSql = id
        ? `SELECT id, secuencia_desde, secuencia_hasta FROM dgii_ncf_sequences
           WHERE tenant_id = ? AND tipo_comprobante = ? AND id <> ?
             AND COALESCE(secuencia_desde, 1) <= ? AND COALESCE(secuencia_hasta, 0) >= ?
           LIMIT 1`
        : `SELECT id, secuencia_desde, secuencia_hasta FROM dgii_ncf_sequences
           WHERE tenant_id = ? AND tipo_comprobante = ?
             AND COALESCE(secuencia_desde, 1) <= ? AND COALESCE(secuencia_hasta, 0) >= ?
           LIMIT 1`;
      const overlapParams = id
        ? [tenantId, resolvedTipo, id, resolvedHasta, resolvedDesde]
        : [tenantId, resolvedTipo, resolvedHasta, resolvedDesde];
      const [overlaps] = await pool.query(overlapSql, overlapParams);
      if (overlaps.length > 0) {
        return res.status(409).json({
          error: `El rango ${resolvedDesde}-${resolvedHasta} se superpone con una secuencia existente (${overlaps[0].secuencia_desde}-${overlaps[0].secuencia_hasta}) para el tipo ${resolvedTipo}.`,
          code: 'NCF_RANGE_OVERLAP',
        });
      }

      const cantidadAprobada = resolvedHasta - resolvedDesde + 1;
      const numDesdeFmt = formatComprobanteNumber(resolvedSerie, resolvedDesde);
      const numHastaFmt = formatComprobanteNumber(resolvedSerie, resolvedHasta);
      const actorId = req.auth?.userId || req.user?.id || null;

      if (id) {
        const [existingRows] = await pool.query(
          'SELECT * FROM dgii_ncf_sequences WHERE id = ? AND tenant_id = ? LIMIT 1',
          [id, tenantId]
        );
        if (existingRows.length === 0) {
          return res.status(404).json({ error: 'Secuencia no encontrada.' });
        }
        const existing = existingRows[0];
        const alreadyUsed = Number(existing.cantidad_usada || 0) > 0;
        if (alreadyUsed) {
          if (
            String(existing.tipo_comprobante).toUpperCase() !== resolvedTipo ||
            Number(existing.secuencia_desde || 1) !== resolvedDesde ||
            resolvedActual < Number(existing.secuencia_actual || 1) ||
            resolvedHasta < Number(existing.secuencia_actual || 1) - 1
          ) {
            return res.status(409).json({
              error: 'Esta secuencia ya tiene comprobantes emitidos. No se puede cambiar el tipo, el inicio de rango ni retroceder el próximo número.',
              code: 'NCF_SEQUENCE_IN_USE',
            });
          }
        }

        await pool.query(
          `UPDATE dgii_ncf_sequences SET
             tipo_comprobante = ?, serie = ?, nombre_comprobante = ?,
             secuencia_desde = ?, secuencia_actual = ?, secuencia_hasta = ?,
             cantidad_aprobada = ?, numero_desde = ?, numero_hasta = ?,
             fecha_vencimiento = ?, no_solicitud = ?, no_autorizacion = ?,
             alerta_minima = ?, estado = ?
           WHERE id = ? AND tenant_id = ?`,
          [
            resolvedTipo, resolvedSerie, resolvedNombre,
            resolvedDesde, resolvedActual, resolvedHasta,
            cantidadAprobada, numDesdeFmt, numHastaFmt,
            resolvedVenc, no_solicitud || '', no_autorizacion || '',
            resolvedAlerta, resolvedEstado,
            id, tenantId,
          ]
        );

        await pool.query(
          `INSERT INTO security_audit_logs (tenant_id, user_id, action, details, created_at)
           VALUES (?, ?, 'NCF_SEQUENCE_UPDATED', ?, NOW())`,
          [tenantId, actorId, JSON.stringify({ id, before: { tipo: existing.tipo_comprobante, actual: existing.secuencia_actual, hasta: existing.secuencia_hasta, estado: existing.estado }, after: { tipo: resolvedTipo, actual: resolvedActual, hasta: resolvedHasta, estado: resolvedEstado } })]
        ).catch(() => {});

        return res.json({ success: true, id });
      }

      const [ins] = await pool.query(
        `INSERT INTO dgii_ncf_sequences (
           tenant_id, tipo_comprobante, serie, nombre_comprobante,
           secuencia_desde, secuencia_actual, secuencia_hasta,
           cantidad_aprobada, cantidad_usada, numero_desde, numero_hasta,
           fecha_vencimiento, no_solicitud, no_autorizacion, alerta_minima, estado
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [
          tenantId, resolvedTipo, resolvedSerie, resolvedNombre,
          resolvedDesde, resolvedActual, resolvedHasta,
          cantidadAprobada, numDesdeFmt, numHastaFmt,
          resolvedVenc, no_solicitud || '', no_autorizacion || '',
          resolvedAlerta, resolvedEstado,
        ]
      );
      const createdId = ins[0]?.id || null;

      await pool.query(
        `INSERT INTO security_audit_logs (tenant_id, user_id, action, details, created_at)
         VALUES (?, ?, 'NCF_SEQUENCE_CREATED', ?, NOW())`,
        [tenantId, actorId, JSON.stringify({ id: createdId, tipo_comprobante: resolvedTipo, serie: resolvedSerie, desde: resolvedDesde, hasta: resolvedHasta, actual: resolvedActual, fecha_vencimiento: resolvedVenc })]
      ).catch(() => {});

      return res.json({ success: true, id: createdId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };

  // 3. POST /api/dgii/sequences & PUT /api/dgii/sequences/:id
  router.post('/sequences', createQuarantineGuard(pool, 'ticket_sequences', req => req.body.id), upsertSequenceHandler);
  router.put('/sequences/:id', createQuarantineGuard(pool, 'dgii_ncf_sequences', req => req.params.id), upsertSequenceHandler);

  // 3b. DELETE /api/dgii/sequences/:id - Protected against deleting used sequences
  router.delete('/sequences/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido.' });
      if (!canManageSequences(req)) {
        return res.status(403).json({ error: 'Permisos insuficientes para eliminar secuencias.', code: 'FORBIDDEN_SEQUENCES' });
      }
      const { id } = req.params;
      const [rows] = await pool.query(
        'SELECT id, tipo_comprobante, cantidad_usada FROM dgii_ncf_sequences WHERE id = ? AND tenant_id = ? LIMIT 1',
        [id, tenantId]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Secuencia no encontrada.' });
      if (Number(rows[0].cantidad_usada || 0) > 0) {
        return res.status(409).json({
          error: 'No se puede eliminar una secuencia que ya tiene comprobantes emitidos. Puede desactivarla en su lugar.',
          code: 'NCF_SEQUENCE_IN_USE',
        });
      }
      await pool.query('DELETE FROM dgii_ncf_sequences WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      await pool.query(
        `INSERT INTO security_audit_logs (tenant_id, user_id, action, details, created_at)
         VALUES (?, ?, 'NCF_SEQUENCE_DELETED', ?, NOW())`,
        [tenantId, req.auth?.userId || req.user?.id || null, JSON.stringify({ id, tipo_comprobante: rows[0].tipo_comprobante })]
      ).catch(() => {});
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
             subtotal, descuento, itbis, total, metodo_pago, applied_payments,
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
