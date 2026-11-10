const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'backend', 'routes', 'dgii.routes.js');
let content = fs.readFileSync(filePath, 'utf8');

// Unified helpers and endpoints for dgii_ncf_sequences
const newCode = `// === DGII NCF SEQUENCES MANAGEMENT APIs ===
// ==========================================

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
      message: \`No existe ningún lote de secuencias fiscales registrado para el tipo de comprobante \${targetType}.\`
    };
  }

  const allInactive = rowsForType.every(r => r.estado === 'Inactivo');
  if (allInactive) {
    return {
      code: 'LOTE_INACTIVO',
      message: \`Todos los lotes registrados para \${targetType} se encuentran en estado Inactivo.\`
    };
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const activeRows = rowsForType.filter(r => r.estado !== 'Inactivo');
  const allExpired = activeRows.length > 0 && activeRows.every(r => r.fecha_vencimiento && new Date(r.fecha_vencimiento) < now);
  if (allExpired) {
    return {
      code: 'LOTE_VENCIDO',
      message: \`Las secuencias fiscales autorizadas para \${targetType} se encuentran vencidas ante la DGII.\`
    };
  }

  return {
    code: 'LOTE_AGOTADO',
    message: \`Se agotaron los comprobantes fiscales disponibles. No quedan secuencias en el rango autorizado para \${targetType}.\`
  };
}

// GET /api/dgii/sequences/availability - Real-time e-NCF sequence availability and threshold alerts
const getSequenceAvailability = async (req, res) => {
  try {
    const [allRows] = await pool.query(\`
      SELECT id, tipo_comprobante, nombre_comprobante, no_solicitud, no_autorizacion,
             numero_desde, numero_hasta, secuencia_actual, cantidad_aprobada, cantidad_usada,
             fecha_vencimiento, estado, alerta_minima
      FROM dgii_ncf_sequences
      ORDER BY id ASC
    \`);

    const now = new Date();
    const availability = {
      E31: { tipo: 'E31', nombre: 'Factura de Crédito Fiscal Electrónico', disponibles: 0, isExhausted: true, alertLevel: 'exhausted', batches: [], diagnosticCode: null },
      E32: { tipo: 'E32', nombre: 'Factura de Consumo Electrónica', disponibles: 0, isExhausted: true, alertLevel: 'exhausted', batches: [], diagnosticCode: null },
      E34: { tipo: 'E34', nombre: 'Nota de Crédito Electrónica', disponibles: 0, isExhausted: true, alertLevel: 'exhausted', batches: [], diagnosticCode: null },
      hasAlerts: false,
      alerts: []
    };

    for (const row of allRows) {
      const tipo = row.tipo_comprobante;
      if (!availability[tipo]) continue;

      const evalRes = evaluateBatchFiscalStatus(row, now);

      if (evalRes.estadoCalculado === 'Activo' && evalRes.realDisponibles > 0) {
        availability[tipo].disponibles += evalRes.realDisponibles;
        availability[tipo].batches.push({
          id: row.id,
          disponibles: evalRes.realDisponibles,
          secuencia_actual: row.secuencia_actual,
          cantidad_usada: row.cantidad_usada,
          cantidad_aprobada: evalRes.cantidadAprobada,
          is_authorized: evalRes.isAuthorized,
          no_solicitud: row.no_solicitud,
          no_autorizacion: row.no_autorizacion
        });
      }
    }

    // Compute thresholds for each type (20, 10, 5, 0)
    for (const tipo of ['E31', 'E32', 'E34']) {
      const disp = availability[tipo].disponibles;
      availability[tipo].isExhausted = (disp <= 0);

      let level = 'none';
      let alertMsg = null;

      if (disp === 0) {
        level = 'exhausted';
        const typeRows = allRows.filter(r => r.tipo_comprobante === tipo);
        const diag = diagnoseSequenceFailure(typeRows, tipo);
        availability[tipo].diagnosticCode = diag.code;
        availability[tipo].diagnosticMessage = diag.message;
        alertMsg = \`⛔ ALERTA PERSISTENTE: Se agotaron los comprobantes fiscales de \${tipo} (\${availability[tipo].nombre}). [\${diag.code}] \${diag.message}\`;
      } else if (disp <= 5) {
        level = 'critical_5';
        alertMsg = \`🚨 Alerta Crítica: Quedan solo \${disp} secuencias autorizadas de \${tipo}. Bloqueo inminente al llegar a cero.\`;
      } else if (disp <= 10) {
        level = 'warning_10';
        alertMsg = \`⚠️ Advertencia: Quedan solo \${disp} secuencias autorizadas de \${tipo}. Favor notificar al administrador para solicitar nuevas secuencias a la DGII.\`;
      } else if (disp <= 20) {
        level = 'warning_20';
        alertMsg = \`ℹ️ Aviso: Quedan \${disp} secuencias autorizadas de \${tipo}.\`;
      }

      availability[tipo].alertLevel = level;
      availability[tipo].message = alertMsg;
      if (level !== 'none') {
        availability.hasAlerts = true;
        availability.alerts.push({
          tipo,
          disponibles: disp,
          level,
          message: alertMsg,
          code: availability[tipo].diagnosticCode || null
        });
      }
    }

    availability.success = true;
    availability.sequences = [availability.E31, availability.E32, availability.E34];

    res.json(availability);
  } catch (err) {
    console.error('[DGII AVAILABILITY ERROR]:', err);
    res.status(500).json({ error: err.message });
  }
};

router.get('/sequences/availability', getSequenceAvailability);
router.getSequenceAvailability = getSequenceAvailability;

// GET /api/dgii/sequences - List all authorized NCF sequence batches
router.get('/sequences', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM dgii_ncf_sequences ORDER BY id DESC');
    const now = new Date();

    const formatted = rows.map(seq => {
      const evalRes = evaluateBatchFiscalStatus(seq, now);

      return {
        ...seq,
        cantidad_aprobada: evalRes.cantidadAprobada,
        cantidad_disponible: evalRes.realDisponibles,
        porcentaje_disponible: evalRes.porcentajeDisponible,
        is_alerta_minima: evalRes.isAlertaMinima,
        is_vencido: evalRes.isVencido,
        estado_calculado: evalRes.estadoCalculado,
        motivo_inactividad: evalRes.motivoInactividad,
        is_authorized: evalRes.isAuthorized,
        has_solicitud: evalRes.hasSolicitud,
        has_autorizacion: evalRes.hasAutorizacion
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error('[DGII SEQUENCES GET ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});`;

// Find start and end
const startPattern = '// === DGII NCF SEQUENCES MANAGEMENT APIs ===';
const endPattern = '// POST /api/dgii/sequences - Add new authorized sequence batch from DGII';

const startIdx = content.indexOf(startPattern);
const endIdx = content.indexOf(endPattern);

if (startIdx === -1 || endIdx === -1) {
  console.error('Could not find markers in file!');
  process.exit(1);
}

const before = content.slice(0, startIdx);
const after = content.slice(endIdx);

content = before + newCode + '\n\n' + after;

// Also update module.exports at the end of file
const oldExport = 'module.exports = { createDgiiRouter, extractPaymentBreakdown };';
const newExport = 'module.exports = { createDgiiRouter, extractPaymentBreakdown, evaluateBatchFiscalStatus, diagnoseSequenceFailure };';

if (content.includes(oldExport)) {
  content = content.replace(oldExport, newExport);
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated dgii.routes.js');

