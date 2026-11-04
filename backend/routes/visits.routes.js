const express = require('express');
const crypto = require('crypto');
const { evaluateBatchFiscalStatus, diagnoseSequenceFailure } = require('./dgii.routes');

/**
 * Validador de RNC de Personas Jurídicas Dominicanas (9 dígitos)
 * Algoritmo: Módulo 11 con pesos [7, 9, 8, 6, 5, 4, 3, 2]
 */
function isValidRnc(rnc) {
  const clean = String(rnc || '').replace(/\D/g, '');
  if (clean.length !== 9) return false;
  const weights = [7, 9, 8, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += parseInt(clean[i], 10) * weights[i];
  }
  const rem = sum % 11;
  let digit = 0;
  if (rem === 0) digit = 2;
  else if (rem === 1) digit = 1;
  else digit = 11 - rem;
  return digit === parseInt(clean[8], 10);
}

/**
 * Validador de Cédula de Identidad de Personas Físicas Dominicanas (11 dígitos)
 * Algoritmo: Módulo 10 alternado (Luhn con pesos [1, 2, 1, 2, 1, 2, 1, 2, 1, 2])
 */
function isValidCedula(cedula) {
  const clean = String(cedula || '').replace(/\D/g, '');
  if (clean.length !== 11) return false;
  const weights = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let p = parseInt(clean[i], 10) * weights[i];
    if (p >= 10) p -= 9;
    sum += p;
  }
  const digit = (10 - (sum % 10)) % 10;
  return digit === parseInt(clean[10], 10);
}

/**
 * Valida si un identificador fiscal corresponde a un RNC o Cédula dominicano válido
 */
function validateReceptorTaxId(rncOrCedula) {
  if (!rncOrCedula) return { isValid: false, type: null, error: 'RNC o Cédula no proporcionado' };
  const clean = String(rncOrCedula).replace(/\D/g, '');
  if (clean.length === 9) {
    if (isValidRnc(clean)) return { isValid: true, type: 'RNC', cleanId: clean };
    return { isValid: false, type: 'RNC', cleanId: clean, error: 'RNC con dígito verificador inválido (Módulo 11)' };
  } else if (clean.length === 11) {
    if (isValidCedula(clean)) return { isValid: true, type: 'CEDULA', cleanId: clean };
    return { isValid: false, type: 'CEDULA', cleanId: clean, error: 'Cédula con dígito verificador inválido (Luhn)' };
  }
  return { isValid: false, type: null, cleanId: clean, error: 'Longitud inválida: RNC debe tener 9 dígitos y Cédula 11 dígitos' };
}

/**
 * Valida que la Razón Social del receptor no esté vacía ni contenga nombres genéricos
 */
function isValidRazonSocial(name) {
  if (!name || typeof name !== 'string') return false;
  const clean = name.trim();
  if (clean.length < 3) return false;
  const lower = clean.toLowerCase();
  const genericNames = ['cliente general', 'invitado', 'n/a', 'na', 'consumidor final', 'sin nombre', 'test', 'prueba', 'ninguno', 'cliente'];
  if (genericNames.includes(lower)) return false;
  return true;
}

/**
 * Creates the Visits and POS Ticketing Router
 * 
 * @param {import('mysql2/promise').Pool} pool 
 * @param {Object} deps
 * @param {Function} deps.transmitInvoiceDirectlyToDgii
 * @param {Function} deps.generateAndTransmitNotaCredito
 * @param {Function} deps.sendSurveyEmail
 */
function createVisitsRouter(pool, deps = {}) {
  const router = express.Router();
  const { transmitInvoiceDirectlyToDgii, generateAndTransmitNotaCredito, sendSurveyEmail } = deps;

  // Monotonic Ticket Sequence Generator (Never repeats or reuses numbers when tickets are deleted/cancelled)
  const getNextTicketNumber = async (salonId = 1, prefix = 'SD') => {
    const sId = parseInt(salonId) || 1;

    try {
      // 1. Ensure record exists in ticket_sequences
      await pool.query(`
        INSERT INTO ticket_sequences (salon_id, prefix, last_sequence)
        VALUES (?, ?, 0)
        ON DUPLICATE KEY UPDATE prefix = VALUES(prefix)
      `, [sId, prefix]);

      // 2. Find maximum numeric sequence in visits table to prevent collision with historical records
      const [maxRows] = await pool.query(
        `SELECT MAX(CAST(SUBSTRING_INDEX(ticket_number, '-', -1) AS UNSIGNED)) as max_num 
         FROM visits 
         WHERE salon_id = ? AND ticket_number LIKE ?`,
        [sId, `${prefix}-%`]
      );
      const maxInVisits = Number(maxRows[0]?.max_num) || 0;

      // 3. Get current sequence from ticket_sequences
      const [seqRows] = await pool.query('SELECT last_sequence FROM ticket_sequences WHERE salon_id = ?', [sId]);
      let currentSeq = Number(seqRows[0]?.last_sequence) || 0;

      let nextSeq = Math.max(currentSeq, maxInVisits) + 1;

      // 4. Update sequence table monotonically
      await pool.query('UPDATE ticket_sequences SET last_sequence = ? WHERE salon_id = ?', [nextSeq, sId]);

      return `${prefix}-${String(nextSeq).padStart(4, '0')}`;
    } catch (err) {
      console.error('[TICKET SEQUENCE ERROR]:', err);
      return `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
    }
  };

  // Robust visit commissions processor for assigned employees
  async function processVisitCommissions(visitId, itemsDetail, ticketNumber = null, createdAt = null) {
    try {
      let items = itemsDetail;
      if (typeof items === 'string') {
        try { items = JSON.parse(items); } catch(e) { items = []; }
      }
      if (!Array.isArray(items) || items.length === 0) return;

      let ticketNum = ticketNumber;
      if (!ticketNum) {
        const [vRows] = await pool.query('SELECT ticket_number, visited_at FROM visits WHERE id = ?', [visitId]);
        ticketNum = vRows[0]?.ticket_number || `TK-${visitId}`;
        if (!createdAt && vRows[0]?.visited_at) createdAt = vRows[0].visited_at;
      }

      for (const item of items) {
        // 1. Identify employee by id or name
        let empId = item.empleado_id || item.employee_id || item.empleado || item.employee;
        let empName = item.empleado_nombre || item.employee_name || item.empleado || item.employee || '';

        if (!empId && !empName) continue;
        if (empId === 'N/A' || empName === 'N/A') continue;

        const cleanEmpId = empId ? String(empId).replace('EMP-', '').replace('COMM-', '').trim() : '';

        const [empRows] = await pool.query(
          'SELECT id, nombre, localidad, salon_id, commission_scheme_id FROM staff_records WHERE id = ? OR id = ? OR nombre = ? LIMIT 1',
          [cleanEmpId || 0, empId || 0, empName || '']
        );

        let empLocalidad = '';
        let schemeId = null;

        if (empRows.length > 0) {
          empId = empRows[0].id;
          empName = empRows[0].nombre;
          empLocalidad = empRows[0].localidad || '';
          schemeId = empRows[0].commission_scheme_id || null;
        }

        if (!empId) continue;

        const rawServiceName = item.nombre || item.servicio || item.name || item.service_name || item.descripcion || item.description || 'Servicio';
        const cleanServiceName = rawServiceName.replace(/\s*\(Plan Beauty\)/i, '').replace(/\s*\(Adicional\)/i, '').trim();
        const serviceName = rawServiceName;

        // REGLA CRÍTICA: Si el empleado no tiene un esquema de comisiones asignado, NO se le calcula comisión
        if (!schemeId || isNaN(parseInt(schemeId, 10)) || parseInt(schemeId, 10) <= 0) {
          await pool.query(
            'DELETE FROM employee_commissions_log WHERE visit_id = ? AND employee_id = ? AND service_name = ? AND status = "Pendiente"',
            [visitId, empId, serviceName]
          );
          continue;
        }

        // Verificar que el esquema asignado exista y esté activo
        const [schemeInfo] = await pool.query(
          'SELECT id, nombre, estado FROM commission_schemes WHERE id = ?',
          [schemeId]
        );
        if (schemeInfo.length === 0 || schemeInfo[0].estado === 'Inactivo') {
          await pool.query(
            'DELETE FROM employee_commissions_log WHERE visit_id = ? AND employee_id = ? AND service_name = ? AND status = "Pendiente"',
            [visitId, empId, serviceName]
          );
          continue;
        }
        const schemeName = schemeInfo[0].nombre || 'Esquema';

        const price = parseFloat(item.precioAplicado !== undefined ? item.precioAplicado : (item.precio || item.precioBase || 0));
        const qty = parseInt(item.cantidad) || 1;
        const desc = parseFloat(item.descuento) || 0;

        // Calculate price after line discounts
        const finalLinePrice = Math.max(0, (price * qty) - desc);

        // Exclude ITBIS (18%) from base amount if applicable
        const appliesItbis = item.aplica_itbis === 1 || item.aplica_itbis === true;
        let baseAmt = finalLinePrice;
        if (appliesItbis && finalLinePrice > 0) {
          baseAmt = parseFloat((finalLinePrice / 1.18).toFixed(2));
        }

        let commissionType = 'Porcentaje';
        let commissionVal = 0.00;
        let ruleDesc = '';
        let earnedCommission = 0.00;

        // Fetch service details (category)
        const [srvRows] = await pool.query(
          'SELECT categoria, genera_comision FROM services WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)) OR LOWER(TRIM(nombre)) = LOWER(TRIM(?)) OR id = ? LIMIT 1',
          [cleanServiceName, rawServiceName, item.service_id || '']
        );
        const srvData = srvRows[0] || {};
        const serviceCategory = (srvData.categoria || '').trim();

        if (srvData.genera_comision === 0) {
          commissionVal = 0;
          ruleDesc = 'Servicio no genera comisión';
        } else {
          const [schemeRules] = await pool.query(
            'SELECT * FROM commission_scheme_rules WHERE scheme_id = ? ORDER BY prioridad ASC, id ASC',
            [schemeId]
          );

          let ruleFound = false;

          // Prioridad 1: Regla Especial por Servicio (Restar / Sumar)
          const specialRule = schemeRules.find(r => 
            r.rule_type === 'especial' && 
            r.service_name && 
            (r.service_name.toLowerCase().trim() === cleanServiceName.toLowerCase().trim() || 
             r.service_name.toLowerCase().trim() === rawServiceName.toLowerCase().trim())
          );

          if (specialRule) {
            const operacion = specialRule.operacion || 'Restar';
            const ajuste = parseFloat(specialRule.monto_ajuste) || 0;
            const pct = parseFloat(specialRule.porcentaje_comision) || parseFloat(specialRule.valor) || 0;

            if (operacion === 'Restar') {
              const adjustedBase = Math.max(0, baseAmt - (ajuste * qty));
              earnedCommission = (adjustedBase * pct) / 100;
              ruleDesc = `Esquema (${schemeName}) - Regla Especial: Restar RD$${ajuste} y pagar ${pct}% (Base: RD$${baseAmt} → RD$${adjustedBase})`;
              commissionType = 'Porcentaje';
              commissionVal = pct;
              ruleFound = true;
            } else if (operacion === 'Sumar') {
              const adjustedBase = baseAmt + (ajuste * qty);
              earnedCommission = (adjustedBase * pct) / 100;
              ruleDesc = `Esquema (${schemeName}) - Regla Especial: Sumar RD$${ajuste} y pagar ${pct}% (Base: RD$${baseAmt} → RD$${adjustedBase})`;
              commissionType = 'Porcentaje';
              commissionVal = pct;
              ruleFound = true;
            } else if (operacion === 'Contar') {
              // Si tiene porcentaje base definido, aplicarlo; si no, buscar regla regular por servicio/categoría
              if (pct > 0) {
                earnedCommission = (baseAmt * pct) / 100;
                ruleDesc = `Esquema (${schemeName}) - Regla Especial (Contar Meta): ${pct}% base + Bono`;
                commissionType = 'Porcentaje';
                commissionVal = pct;
                ruleFound = true;
              }
            }
          }

          // Prioridad 2: Regla específica por Servicio dentro del esquema del empleado
          if (!ruleFound) {
            const serviceRule = schemeRules.find(r => 
              r.rule_type === 'servicio' && 
              r.service_name && 
              (r.service_name.toLowerCase().trim() === cleanServiceName.toLowerCase().trim() || 
               r.service_name.toLowerCase().trim() === rawServiceName.toLowerCase().trim())
            );

            if (serviceRule) {
              commissionType = serviceRule.tipo_calculo === 'Monto_Fijo' ? 'Monto_Fijo' : 'Porcentaje';
              commissionVal = parseFloat(serviceRule.valor) || 0;
              ruleDesc = `Esquema (${schemeName}) - Servicio: ${serviceRule.service_name}`;
              ruleFound = true;
            }
          }

          // Prioridad 3: Regla por Categoría dentro del esquema del empleado
          if (!ruleFound && serviceCategory) {
            const catRule = schemeRules.find(r => 
              r.rule_type === 'categoria' && 
              r.category_name && 
              (r.category_name.toLowerCase().trim() === serviceCategory.toLowerCase().trim())
            );
            if (catRule) {
              commissionType = catRule.tipo_calculo === 'Monto_Fijo' ? 'Monto_Fijo' : 'Porcentaje';
              commissionVal = parseFloat(catRule.valor) || 0;
              ruleDesc = `Esquema (${schemeName}) - Categoría: ${serviceCategory}`;
              ruleFound = true;
            }
          }

          // Prioridad 4: Regla General del Esquema
          if (!ruleFound) {
            const generalRule = schemeRules.find(r => 
              r.rule_type === 'general' || 
              (r.rule_type === 'categoria' && (r.category_name?.toLowerCase() === 'general' || r.category_name?.toLowerCase() === 'todos'))
            );
            if (generalRule) {
              commissionType = generalRule.tipo_calculo === 'Monto_Fijo' ? 'Monto_Fijo' : 'Porcentaje';
              commissionVal = parseFloat(generalRule.valor) || 0;
              ruleDesc = `Esquema (${schemeName}) - Regla General (${generalRule.valor}%)`;
              ruleFound = true;
            }
          }

          // Si el servicio no coincide con ninguna regla del esquema
          if (!ruleFound) {
            commissionVal = 0;
            ruleDesc = `Sin regla en esquema (${schemeName})`;
          }
        }

        if (earnedCommission === 0 && commissionVal > 0) {
          if (commissionType === 'Porcentaje') {
            earnedCommission = (baseAmt * commissionVal) / 100;
          } else {
            earnedCommission = commissionVal * qty;
          }
        }
        earnedCommission = parseFloat(Number(earnedCommission).toFixed(2));

        if (earnedCommission > 0) {
          const [existingLog] = await pool.query(
            'SELECT id, status, monto_comision, rule_applied_description, comision_valor FROM employee_commissions_log WHERE visit_id = ? AND employee_id = ? AND service_name = ?',
            [visitId, empId, serviceName]
          );

          if (existingLog.length === 0) {
            await pool.query(
              `INSERT INTO employee_commissions_log 
                (visit_id, ticket_number, employee_id, employee_name, service_name, precio_servicio, cantidad, descuento_aplicado, monto_base, tipo_comision, comision_valor, monto_comision, status, localidad, scheme_id, rule_applied_description, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?, ?, ?)`,
              [visitId, ticketNum, empId, empName, serviceName, price, qty, desc, baseAmt, commissionType, commissionVal, earnedCommission, empLocalidad, schemeId, ruleDesc, createdAt || new Date()]
            );
          } else if (existingLog[0].status === 'Pendiente') {
            const currentLog = existingLog[0];
            if (Number(currentLog.monto_comision) !== earnedCommission || currentLog.rule_applied_description !== ruleDesc || currentLog.comision_valor !== commissionVal) {
              await pool.query(
                `UPDATE employee_commissions_log SET 
                  tipo_comision = ?, 
                  comision_valor = ?, 
                  monto_comision = ?, 
                  monto_base = ?, 
                  scheme_id = ?, 
                  rule_applied_description = ? 
                 WHERE id = ?`,
                [commissionType, commissionVal, earnedCommission, baseAmt, schemeId, ruleDesc, currentLog.id]
              );
            }
          }
        } else {
          await pool.query(
            'DELETE FROM employee_commissions_log WHERE visit_id = ? AND employee_id = ? AND service_name = ? AND status = "Pendiente"',
            [visitId, empId, serviceName]
          );
        }
      }
    } catch (err) {
      console.error('[PROCESS VISIT COMMISSIONS ERROR]:', err);
    }
  }

  // Helper to atomically allocate the next DGII e-NCF sequence for an invoice/visit
  async function assignDgiiSequenceToVisit(visitId, requestedType = null, clientRnc = null, clientRazonSocial = null, totalAmount = 0, metodoPago = 'Efectivo', options = {}) {
    try {
      const totalNum = Number(totalAmount || 0);
      const isCommercialSale = totalNum > 0;
      const isPlanBeautyCanje = (
        !isCommercialSale &&
        metodoPago &&
        (metodoPago.toLowerCase().includes('plan') || metodoPago.toLowerCase().includes('canje') || metodoPago.toLowerCase().includes('membresía') || metodoPago.toLowerCase().includes('membresia'))
      );

      // Reglas fiscales por tipo de operación y contribuyente:
      // 1. Operaciones no comerciales / Canjes a costo 0 amparados en suscripción o ajustes internos:
      if (!isCommercialSale) {
        const docName = isPlanBeautyCanje ? 'Comprobante de Canje Plan Beauty' : 'Comprobante de Cortesía / Ajuste Interno';
        console.log(`ℹ️ [DGII OPERACIÓN NO FISCAL]: Visita ${visitId} por RD$ ${totalNum} registrada como '${docName}'.`);
        await pool.query(
          "UPDATE visits SET ncf = NULL, ncf_type = 'NONE', ncf_name = ?, codigo_seguridad_ecf = NULL, qr_code_url = NULL WHERE id = ?",
          [docName, visitId]
        );
        return { ncf: null, ncf_type: 'NONE', ncf_name: docName };
      }

      // 2. Clasificación fiscal del contribuyente para ventas comerciales (total > 0):
      // - Crédito Fiscal (E31) para empresas/contribuyentes con RNC/Cédula y Razón Social válidos.
      // - Consumo (E32) para consumidores finales en ventas comerciales generales (nunca se omite comprobante).
      const hasValidTaxReceptor = validateReceptorTaxId(clientRnc).isValid && isValidRazonSocial(clientRazonSocial);
      const isTargetFiscal = (requestedType === 'E31' || requestedType === 'CREDITO_FISCAL' || hasValidTaxReceptor);
      let targetType = 'E32';
      if (requestedType && String(requestedType).startsWith('TEST_')) {
        targetType = String(requestedType).toUpperCase();
      } else if (isTargetFiscal) {
        targetType = 'E31';
      }

      // Validación de correspondencia de tipo y empresa (RNC emisor fijo 131917038)
      const validTypes = ['E31', 'E32', 'E33', 'E34', 'E41'];
      if (!validTypes.includes(targetType) && !targetType.startsWith('TEST_')) {
        const err = new Error(`El tipo de comprobante ${targetType} no corresponde a la empresa o no está soportado.`);
        err.code = 'ERROR_CORRESPONDENCIA_TIPO';
        err.tipo_comprobante = targetType;
        throw err;
      }
      
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // Bloqueo atómico estricto seleccionando lotes candidatos activos no vencidos (sin LIMIT 1 para permitir rotación entre lotes)
        const [batches] = await connection.query(
          `SELECT * FROM dgii_ncf_sequences 
           WHERE tipo_comprobante = ?
             AND estado = 'Activo'
             AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= CURDATE())
           ORDER BY id ASC
           FOR UPDATE`,
          [targetType]
        );

        let selectedBatch = null;
        let batchEval = null;

        const now = new Date();
        for (const candidate of batches) {
          const evalRes = evaluateBatchFiscalStatus(candidate, now);
          if (evalRes.estadoCalculado === 'Agotado' || evalRes.realDisponibles <= 0) {
            // Actualizar lote agotado para que no consuma consultas activas futuras
            await connection.query(
              "UPDATE dgii_ncf_sequences SET estado = 'Agotado', updated_at = NOW() WHERE id = ?",
              [candidate.id]
            );
            continue;
          }

          if (evalRes.estadoCalculado === 'Activo' && evalRes.realDisponibles > 0) {
            selectedBatch = candidate;
            batchEval = evalRes;
            break;
          }
        }

        if (!selectedBatch || !batchEval) {
          await connection.rollback();

          // Diagnóstico preciso de la causa de no disponibilidad
          const [allTypeBatches] = await pool.query(
            "SELECT * FROM dgii_ncf_sequences WHERE tipo_comprobante = ? ORDER BY id ASC",
            [targetType]
          );

          const diag = diagnoseSequenceFailure(allTypeBatches, targetType);

          // Registro interno de auditoría de la incidencia de bloqueo fiscal
          try {
            await pool.query(
              `INSERT INTO audit_logs (entity_type, entity_id, action, user_name, reason, metadata, created_at)
               VALUES ('dgii_sequence', ?, 'FISCAL_SEQUENCE_BLOCKED', ?, ?, ?, NOW())`,
              [
                visitId,
                options.user_name || 'Cajero/POS',
                `[${diag.code}] ${diag.message}`,
                JSON.stringify({
                  targetType,
                  code: diag.code,
                  visitId,
                  total: totalNum,
                  batchesCount: allTypeBatches.length
                })
              ]
            );
          } catch (auditErr) {
            console.error('[AUDIT BLOCK LOG ERROR]:', auditErr.message);
          }

          console.warn(`⚠️ [DGII NCF BLOQUEO]: ${diag.code} para ${targetType}: ${diag.message}`);
          const err = new Error(diag.message);
          err.code = diag.code;
          err.tipo_comprobante = targetType;
          throw err;
        }

        const seq = selectedBatch;
        const currentAssignedNum = batchEval.currentAssignedNum;
        const encfNumber = batchEval.prefix + String(currentAssignedNum).padStart(10, '0');

        const newCantidadUsada = seq.cantidad_usada + 1;
        const newSecuenciaActual = currentAssignedNum;
        const isNowAgotado = (newCantidadUsada >= batchEval.cantidadAprobada || currentAssignedNum >= batchEval.endNum);
        const newEstado = isNowAgotado ? 'Agotado' : 'Activo';

        await connection.query(
          `UPDATE dgii_ncf_sequences 
           SET cantidad_usada = ?, secuencia_actual = ?, estado = ?, updated_at = NOW() 
           WHERE id = ?`,
          [newCantidadUsada, newSecuenciaActual, newEstado, seq.id]
        );

        const securityCode = crypto.randomBytes(3).toString('hex').toUpperCase();
        const emisorRnc = '131917038';
        const totalFormatted = Number(totalAmount || 0).toFixed(2);
        const qrUrl = seq.tipo_comprobante === 'E32'
          ? `https://fc.dgii.gov.do/eCF/ConsultaTimbreFC?RncEmisor=${emisorRnc}&ENCF=${encfNumber}&MontoTotal=${totalFormatted}&CodigoSeguridad=${securityCode}`
          : `https://fc.dgii.gov.do/eCF/ConsultaTimbre?RncEmisor=${emisorRnc}&RncComprador=${clientRnc || ''}&ENCF=${encfNumber}&MontoTotal=${totalFormatted}&FechaEmision=02-10-2026&FechaFirma=02-10-2026&CodigoSeguridad=${securityCode}`;

        await connection.query(
          `UPDATE visits 
           SET ncf = ?, ncf_type = ?, ncf_name = ?, rnc_cliente = ?, rzn_soc_cliente = ?, codigo_seguridad_ecf = ?, qr_code_url = ? 
           WHERE id = ?`,
          [encfNumber, seq.tipo_comprobante, seq.nombre_comprobante, clientRnc || null, clientRazonSocial || null, securityCode, qrUrl, visitId]
        );

        await connection.commit();
        console.log(`✅ [DGII e-NCF Asignado Atómicamente]: ${encfNumber} (${seq.nombre_comprobante}) para Factura/Visita ${visitId}.`);

        return {
          ncf: encfNumber,
          ncf_type: seq.tipo_comprobante,
          ncf_name: seq.nombre_comprobante,
          codigo_seguridad: securityCode,
          qr_code_url: qrUrl,
          secuencia_id: seq.id,
          secuencia_actual: newSecuenciaActual,
          cantidad_usada: newCantidadUsada,
          cantidad_aprobada: batchEval.cantidadAprobada,
          cantidad_restante: batchEval.cantidadAprobada - newCantidadUsada
        };
      } catch (allocErr) {
        await connection.rollback();
        throw allocErr;
      } finally {
        connection.release();
      }
    } catch (err) {
      console.error('[DGII NCF ASSIGN ERROR]:', err);
      return { ncf: null, error: err.message, code: err.code || 'LOTE_AGOTADO', tipo_comprobante: err.tipo_comprobante };
    }
  }

  // Finalize checkout and mark as Facturado
  async function handleCheckoutVisit(req, res) {
    try {
      const id = req.params?.id || req.body?.ticketId || req.body?.id || `VIS-${Date.now()}`;
      const { 
        total, monto_recibido, devuelta, metodo_pago, items_detail, 
        client_id, client_name, salon_id, servicios, employee_consumption, gift_card_redemption,
        ncf_type, tipo_comprobante, rnc_cliente, rnc, rzn_soc_cliente, applied_payments
      } = req.body;

      const [existing] = await pool.query('SELECT id, ticket_number, status, servicios, ncf, ncf_type, ncf_name, codigo_seguridad_ecf, qr_code_url FROM visits WHERE id = ?', [id]);

      let ticketNum = existing[0]?.ticket_number;
      if (!ticketNum) {
        ticketNum = await getNextTicketNumber(salon_id || 1, 'SD');
      }

      // Protección contra doble facturación: una precuenta o visita sólo puede facturarse una vez
      if (existing.length > 0) {
        if (existing[0]?.status === 'Facturado') {
          return res.status(409).json({
            success: false,
            error: 'Esta visita ya fue facturada previamente.',
            code: 'VISIT_ALREADY_BILLED',
            ticketNumber: existing[0].ticket_number,
            ncf: existing[0].ncf,
            ncf_type: existing[0].ncf_type,
            ncf_name: existing[0].ncf_name,
            codigo_seguridad: existing[0].codigo_seguridad_ecf,
            qr_code_url: existing[0].qr_code_url,
            message: `Esta visita ya fue facturada previamente con el comprobante ${existing[0].ncf || 'emitido'}. No se permite doble facturación.`
          });
        }

        if (existing[0]?.status === 'Anulado') {
          return res.status(409).json({
            success: false,
            error: 'Esta visita fue anulada previamente.',
            code: 'VISIT_ALREADY_VOIDED',
            ticketNumber: existing[0].ticket_number,
            message: 'Esta visita fue anulada previamente. No se puede facturar una visita anulada.'
          });
        }

        // Transición atómica exclusiva de Pendiente (o Procesando sin NCF abandonado) -> Procesando
        const [claimResult] = await pool.query(
          `UPDATE visits 
           SET status = 'Procesando' 
           WHERE id = ? 
             AND (status = 'Pendiente' OR (status = 'Procesando' AND ncf IS NULL AND visited_at < NOW() - INTERVAL 15 SECOND))`,
          [id]
        );
        if (claimResult.affectedRows === 0) {
          return res.status(409).json({
            success: false,
            error: 'La visita ya está siendo procesada en otra solicitud concurrente o ya fue finalizada.',
            code: 'CONCURRENT_CHECKOUT_BLOCKED'
          });
        }
      } else {
        // Nueva visita directa a checkout: inserción atómica con estado Procesando
        try {
          await pool.query(
            "INSERT INTO visits (id, ticket_number, client_id, client_name, total, metodo_pago, status, visited_at) VALUES (?, ?, ?, ?, ?, ?, 'Procesando', NOW())",
            [id, ticketNum, client_id || 'INVITADO', client_name || 'Cliente General', total || 0, metodo_pago || 'Efectivo']
          );
        } catch (insertErr) {
          if (insertErr.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
              success: false,
              error: 'La visita ya está siendo procesada en otra solicitud concurrente.',
              code: 'CONCURRENT_CHECKOUT_BLOCKED'
            });
          }
          throw insertErr;
        }
      }

      let serviceNames = [];
      if (Array.isArray(items_detail) && items_detail.length > 0) {
        serviceNames = items_detail.map(i => i.nombre || i.servicio || i.name || 'Servicio').filter(Boolean);
      } else if (req.body.servicios && Array.isArray(req.body.servicios)) {
        serviceNames = req.body.servicios;
      } else if (existing[0]?.servicios) {
        try {
          serviceNames = typeof existing[0].servicios === 'string' ? JSON.parse(existing[0].servicios) : existing[0].servicios;
        } catch (e) {
          serviceNames = [];
        }
      }

      // 1. Validación y clasificación fiscal previa:
      const requestedNcfType = (ncf_type || tipo_comprobante || '').toUpperCase();
      const clientTaxId = rnc_cliente || rnc;
      const clientRazonSocial = rzn_soc_cliente;
      const totalNum = Number(total || 0);
      const isCommercialSale = totalNum > 0;
      const isExplicitCreditoFiscal = (requestedNcfType === 'E31' || requestedNcfType === 'CREDITO_FISCAL' || (clientTaxId && String(clientTaxId).trim().length >= 9));

      // Regla E31: Si se solicita Factura de Crédito Fiscal, validar RNC/Cédula y Razón Social obligatorios
      let finalClientRazonSocial = clientRazonSocial;
      if (isExplicitCreditoFiscal) {
        const taxValidation = validateReceptorTaxId(clientTaxId);
        if (!taxValidation.isValid) {
          await pool.query("UPDATE visits SET status = 'Pendiente' WHERE id = ? AND status = 'Procesando'", [id]);
          return res.status(400).json({
            error: `Identificación fiscal del receptor inválida para Factura de Crédito Fiscal (E31): ${taxValidation.error || 'Verifique el RNC (9 dígitos) o Cédula (11 dígitos)'}`
          });
        }

        // Auto-fallback a client_name si clientRazonSocial está vacío pero client_name es válido
        let effectiveRazonSocial = finalClientRazonSocial ? String(finalClientRazonSocial).trim() : '';
        if (!isValidRazonSocial(effectiveRazonSocial) && client_name && isValidRazonSocial(client_name)) {
          effectiveRazonSocial = String(client_name).trim();
        }

        if (!isValidRazonSocial(effectiveRazonSocial)) {
          await pool.query("UPDATE visits SET status = 'Pendiente' WHERE id = ? AND status = 'Procesando'", [id]);
          return res.status(400).json({
            error: 'La Razón Social del receptor es obligatoria para Factura de Crédito Fiscal (E31) y no puede ser vacía ni genérica.'
          });
        }
        finalClientRazonSocial = effectiveRazonSocial;
      }

      // Regla NONE vs E32:
      // - Las ventas comerciales (total > 0) DEVENGAN COMPROBANTE FISCAL OBLIGATORIO.
      // - Una simple opción 'NONE' enviada por el frontend NUNCA omitirá el comprobante en una venta comercial.
      // - Ventas comerciales emiten E31 si cumplen los requisitos fiscales de receptor, o E32 (Consumidor Final) por defecto.
      // - Solamente transacciones no comerciales (total <= 0) como Canjes de membresía Plan Beauty o ajustes internos pueden omitir comprobante.
      const isPlanBeautyCanje = (
        !isCommercialSale &&
        metodo_pago &&
        (metodo_pago.toLowerCase().includes('plan') || metodo_pago.toLowerCase().includes('canje') || metodo_pago.toLowerCase().includes('membresía') || metodo_pago.toLowerCase().includes('membresia'))
      );

      // --- VALIDACIONES OPERATIVAS DE MEMBRESÍAS Y BENEFICIOS ---
      const hasPlanBenefitInItems = Array.isArray(items_detail) && items_detail.some(i => {
        const name = (i.nombre || i.name || '').toLowerCase();
        const sId = String(i.service_id || '').toLowerCase();
        const isFree = Number(i.precioAplicado ?? i.price ?? 0) === 0;
        const isPlanFlag = Boolean(i.isPlanWash || i.isPromoGift || i.isPlanBenefit);
        const hasPlanKeyword = name.includes('plan beauty') || name.includes('regalo') || name.includes('tratamiento') || name.includes('lavado extra') || sId.includes('plan') || sId.includes('promo');
        return isFree && (isPlanFlag || hasPlanKeyword);
      });
      const effectiveServiceList = Array.isArray(servicios) ? servicios : serviceNames;
      const hasPlanServiceInList = Array.isArray(effectiveServiceList) && effectiveServiceList.some(s => {
        const str = (typeof s === 'string' ? s : (s?.name || s?.nombre || '')).toLowerCase();
        return str.includes('plan beauty') || str.includes('regalo') || str.includes('tratamiento') || str.includes('lavado extra');
      });
      const isAttemptingCanje = isPlanBeautyCanje || hasPlanBenefitInItems || (
        totalNum === 0 && (hasPlanServiceInList || (metodo_pago && (
          metodo_pago.toLowerCase().includes('plan') || 
          metodo_pago.toLowerCase().includes('canje') || 
          metodo_pago.toLowerCase().includes('membres')
        )))
      );

      // Punto 1 & 4: Bloquear canje si la membresía tiene cobro pendiente (protege TODOS los beneficios: lavado, secado, tratamiento, regalo)
      let promoLockAcquired = false;
      let promoLockKey = null;

      if (isAttemptingCanje && client_id && client_id !== 'INVITADO') {
        const [contracts] = await pool.query(
          "SELECT id, status, retry_count, contract_promo_services FROM contracts WHERE client_id = ? ORDER BY id DESC",
          [client_id]
        );
        const pendingContract = contracts.find(c => 
          c.status === 'Pending_Payment' || 
          c.status === 'Pending_Retry' || 
          c.status === 'Past_Due' || 
          c.status === 'Suspended' || 
          c.status === 'Suspendido' || 
          c.status === 'Pendiente'
        );
        const hasActiveContract = contracts.some(c => c.status === 'Active' || c.status === 'Activo');

        if (pendingContract || (!hasActiveContract && contracts.length > 0)) {
          return res.status(400).json({
            success: false,
            error: 'Membresía con cobro pendiente. Regularice el pago para utilizar sus beneficios.',
            code: 'MEMBERSHIP_PAYMENT_PENDING'
          });
        }

        // Punto 4: Prevención atómica de doble canje del regalo de bienvenida (Lavado extra o Tratamiento profundo) ante solicitudes simultáneas
        const hasPromoGiftItem = (Array.isArray(items_detail) && items_detail.some(i => {
          const name = (i.nombre || i.name || '').toLowerCase();
          const sId = String(i.service_id || '').toLowerCase();
          const isFree = Number(i.precioAplicado ?? i.price ?? 0) === 0;
          return isFree && (i.isPromoGift || name.includes('regalo') || name.includes('tratamiento profundo') || name.includes('lavado extra') || sId.includes('promo'));
        })) || (hasPlanServiceInList && (effectiveServiceList.some(s => {
          const str = (typeof s === 'string' ? s : (s?.name || s?.nombre || '')).toLowerCase();
          return str.includes('regalo') || str.includes('tratamiento profundo') || str.includes('lavado extra');
        })));

        if (hasPromoGiftItem) {
          promoLockKey = `promo_gift_claim_${client_id}`;
          try {
            const [lockRows] = await pool.query("SELECT GET_LOCK(?, 10) as acquired", [promoLockKey]);
            promoLockAcquired = lockRows && lockRows[0] && lockRows[0].acquired === 1;
          } catch (e) {
            console.warn('[PROMO LOCK WARNING]:', e.message);
          }

          const [pastPromoVisits] = await pool.query(
            `SELECT id FROM visits 
             WHERE client_id = ? 
               AND status != 'Anulado' 
               AND (
                 items_detail LIKE '%Regalo Plan Beauty%' 
                 OR items_detail LIKE '%plan-beauty-promo%' 
                 OR items_detail LIKE '%plan-beauty-treatment-promo%'
                 OR items_detail LIKE '%Tratamiento Profundo%'
                 OR items_detail LIKE '%Lavado Extra%'
                 OR servicios LIKE '%Regalo Plan Beauty%'
                 OR servicios LIKE '%Tratamiento Profundo%'
                 OR servicios LIKE '%Lavado Extra%'
               ) 
               AND id != ?`,
            [client_id, id]
          );
          if (pastPromoVisits.length > 0) {
            if (promoLockAcquired && promoLockKey) {
              try { await pool.query("SELECT RELEASE_LOCK(?)", [promoLockKey]); } catch (_) {}
              promoLockAcquired = false;
            }
            return res.status(400).json({
              success: false,
              error: 'El regalo de bienvenida ya fue canjeado previamente para esta membresía.',
              code: 'PROMO_GIFT_ALREADY_REDEEMED'
            });
          }
        }
      }

      let effectiveNcfType = 'E32';
      if (!isCommercialSale) {
        effectiveNcfType = 'NONE';
      } else if (requestedNcfType && requestedNcfType.startsWith('TEST_')) {
        effectiveNcfType = requestedNcfType;
      } else if (isExplicitCreditoFiscal) {
        effectiveNcfType = 'E31';
      } else {
        effectiveNcfType = 'E32';
      }

      // 2. Control de Disponibilidad y Asignación Atómica de e-NCF ANTES de marcar como 'Facturado':
      let dgiiResult = null;
      if (existing.length > 0 && existing[0]?.ncf) {
        // Reutilizar de forma consistente el e-NCF ya reservado para evitar consumo duplicado al reintentar tras un error
        dgiiResult = {
          ncf: existing[0].ncf,
          ncf_type: existing[0].ncf_type,
          ncf_name: existing[0].ncf_name,
          codigo_seguridad: existing[0].codigo_seguridad_ecf,
          qr_code_url: existing[0].qr_code_url
        };
        console.log(`ℹ️ [DGII REINTENTO]: Reutilizando e-NCF ${existing[0].ncf} ya reservado en visita ${id}.`);
      } else if (effectiveNcfType !== 'NONE') {
        try {
          const assignSequenceFn = deps.assignDgiiSequenceToVisit || assignDgiiSequenceToVisit;
          dgiiResult = await assignSequenceFn(
            id,
            effectiveNcfType,
            clientTaxId,
            finalClientRazonSocial || client_name,
            totalNum,
            metodo_pago || 'Efectivo',
            { user_name: req.body?.user_name || 'Cajero' }
          );

          if (!dgiiResult || !dgiiResult.ncf) {
            const err = new Error(dgiiResult?.error || `No hay comprobantes fiscales disponibles para ${effectiveNcfType}.`);
            err.code = dgiiResult?.code || 'LOTE_AGOTADO';
            err.tipo_comprobante = effectiveNcfType;
            throw err;
          }
        } catch (dgiiErr) {
          console.error('[DGII ASSIGN IN CHECKOUT FAILED]:', dgiiErr.message);

          // Si existe un cobro previamente autorizado electrónicamente antes de detectar el agotamiento:
          const hasAuthorizedPayment = (Array.isArray(applied_payments) && applied_payments.some(p =>
            p.authorization_code || p.authCode || p.remoteId || p.transaction_id ||
            (String(p.method || '').toLowerCase().includes('tarjeta') && p.reference)
          )) || req.body?.cardnet_authorization || req.body?.authorization_code;

          if (hasAuthorizedPayment) {
            try {
              await pool.query(
                `INSERT INTO audit_logs (entity_type, entity_id, action, user_name, reason, metadata, created_at)
                 VALUES ('fiscal_incident', ?, 'COBRO_PREVIO_BLOQUEADO_POR_AGOTAMIENTO', ?, ?, ?, NOW())`,
                [
                  id,
                  req.body?.user_name || 'Cajero',
                  `Cobro previamente autorizado pero bloqueado por agotamiento de secuencias fiscales ${effectiveNcfType}`,
                  JSON.stringify({
                    ticketId: id,
                    ticketNumber: ticketNum,
                    total: totalNum,
                    metodo_pago,
                    applied_payments,
                    tipo_comprobante: effectiveNcfType
                  })
                ]
              );
              console.warn(`⚠️ [INCIDENCIA REGISTRADA]: Cobro previo de visita ${id} bloqueado por agotamiento ${effectiveNcfType}. No se ejecutan nuevos cobros.`);
            } catch (auditErr) {
              console.error('[AUDIT INCIDENT ERROR]:', auditErr.message);
            }
          }

          // Conservar los servicios, productos, cliente e importes preparados como PRECUENTA / PENDIENTE:
          await pool.query(
            `UPDATE visits SET 
              total = ?, 
              monto_recibido = ?, 
              devuelta = ?, 
              metodo_pago = ?, 
              items_detail = ?, 
              servicios = ?,
              status = 'Pendiente'
             WHERE id = ?`,
            [totalNum, monto_recibido || 0, devuelta || 0, metodo_pago || 'Efectivo', JSON.stringify(items_detail || []), JSON.stringify(serviceNames || []), id]
          );

          const fiscalErrorCode = dgiiErr.code || 'LOTE_AGOTADO';
          const fiscalErrorMessage = dgiiErr.message || 'No hay comprobantes fiscales disponibles.';

          // Bloqueo de facturación: Responder HTTP 409 con diagnóstico exacto requerido
          return res.status(409).json({
            success: false,
            error: fiscalErrorMessage,
            code: fiscalErrorCode,
            diagnostic_code: fiscalErrorCode,
            tipo_comprobante: effectiveNcfType,
            nombre_comprobante: effectiveNcfType === 'E31' ? 'Factura de Crédito Fiscal Electrónico (E31)' : 'Factura de Consumo Electrónica (E32)',
            message: `${fiscalErrorMessage}\n\nFavor de verificar las secuencias en Administración → Secuencias Fiscales.\nPuede guardar o imprimir una precuenta provisional, pero no finalizar la factura fiscal.`,
            ticket_id: id,
            ticket_number: ticketNum,
            can_print_precuenta: true
          });
        }
      }

      // 3. Si la asignación fiscal fue exitosa o no requería e-NCF, AHORA SÍ registrar como 'Facturado':
      await pool.query(
        `UPDATE visits SET 
          status = 'Facturado', 
          total = ?, 
          monto_recibido = ?, 
          devuelta = ?, 
          metodo_pago = ?, 
          items_detail = ?, 
          servicios = ?,
          ncf = COALESCE(?, ncf),
          ncf_type = COALESCE(?, ncf_type),
          ncf_name = COALESCE(?, ncf_name),
          rnc_cliente = COALESCE(?, rnc_cliente),
          rzn_soc_cliente = COALESCE(?, rzn_soc_cliente),
          codigo_seguridad_ecf = COALESCE(?, codigo_seguridad_ecf),
          qr_code_url = COALESCE(?, qr_code_url),
          visited_at = NOW() 
         WHERE id = ?`,
        [
          total || 0,
          monto_recibido || 0,
          devuelta || 0,
          metodo_pago || 'Efectivo',
          JSON.stringify(items_detail || []),
          JSON.stringify(serviceNames || []),
          dgiiResult?.ncf || null,
          dgiiResult?.ncf_type || null,
          dgiiResult?.ncf_name || null,
          rnc_cliente || null,
          finalClientRazonSocial || finalClientRazonSocial || rzn_soc_cliente || null,
          dgiiResult?.codigo_seguridad || null,
          dgiiResult?.qr_code_url || null,
          id
        ]
      );

      if (effectiveNcfType === 'NONE') {
        const docName = isPlanBeautyCanje ? 'Comprobante de Canje Plan Beauty' : 'Comprobante de Cortesía / Ajuste Interno';
        await pool.query(
          "UPDATE visits SET ncf = NULL, ncf_type = 'NONE', ncf_name = ?, codigo_seguridad_ecf = NULL, qr_code_url = NULL WHERE id = ?",
          [docName, id]
        );
      }

      if (dgiiResult?.ncf && typeof transmitInvoiceDirectlyToDgii === 'function') {
        transmitInvoiceDirectlyToDgii(id).catch(e => console.warn('[DGII REALTIME AUTO-SEND NOTICE]:', e.message));
      } else if (existing[0]?.ncf && typeof transmitInvoiceDirectlyToDgii === 'function') {
        transmitInvoiceDirectlyToDgii(id).catch(e => console.warn('[DGII REALTIME AUTO-SEND NOTICE]:', e.message));
      }

      // Record Gift Card Redemption if applicable
      if (gift_card_redemption && gift_card_redemption.code && gift_card_redemption.amount_redeemed > 0) {
        const [cards] = await pool.query('SELECT * FROM gift_cards WHERE code = ?', [gift_card_redemption.code]);
        if (cards.length > 0) {
          const card = cards[0];
          const redeemed = Number(gift_card_redemption.amount_redeemed);
          const newBalance = Math.max(0, Number(card.balance) - redeemed);
          const newStatus = newBalance <= 0 ? 'Redeemed' : 'Partially_Redeemed';

          await pool.query(
            'UPDATE gift_cards SET balance = ?, status = ?, used_at = NOW() WHERE id = ?',
            [newBalance, newStatus, card.id]
          );

          await pool.query(
            'INSERT INTO gift_card_logs (gift_card_id, amount_redeemed, balance_before, balance_after, created_at) VALUES (?, ?, ?, ?, NOW())',
            [card.id, redeemed, card.balance, newBalance]
          );
        }
      }

      // Record employee consumption for payroll deduction if applicable
      const isNominaPayment = metodo_pago === 'Nomina' || (Array.isArray(applied_payments) && applied_payments.some(p => p.method === 'Nomina' || p.method === 'Consumo Empleado' || p.method === 'Descuento Nómina'));

      // CRÍTICO: SOLO registrar consumo/descuento a nómina si el método de pago elegido fue explícitamente Nómina.
      // Si la empleada pagó en Efectivo, Tarjeta, etc., es una venta normal cobrada en caja y NUNCA se descuenta de nómina.
      if (isNominaPayment) {
        const [vRows] = await pool.query('SELECT ticket_number, salon_id FROM visits WHERE id = ?', [id]);
        const ticketNum = vRows[0]?.ticket_number || `TK-${id}`;
        const branchId = salon_id || vRows[0]?.salon_id || 1;

        let empId = employee_consumption?.employee_id || client_id;
        let rawEmpId = parseInt(String(empId || '').replace('EMP-', '').replace('COMM-', '')) || 0;
        let empName = employee_consumption?.employee_name || client_name || 'Colaborador';

        if (rawEmpId) {
          const [st] = await pool.query('SELECT id, nombre, localidad FROM staff_records WHERE id = ? LIMIT 1', [rawEmpId]);
          if (st.length > 0) {
            empName = st[0].nombre || empName;
          }
        } else if (empName && empName !== 'Cliente General') {
          const [st] = await pool.query('SELECT id, nombre, localidad FROM staff_records WHERE nombre = ? LIMIT 1', [empName]);
          if (st.length > 0) {
            rawEmpId = st[0].id;
            empName = st[0].nombre;
          }
        }

        let serviceNames = [];
        if (employee_consumption?.servicios && Array.isArray(employee_consumption.servicios) && employee_consumption.servicios.length > 0) {
          serviceNames = employee_consumption.servicios;
        } else if (Array.isArray(items_detail) && items_detail.length > 0) {
          serviceNames = items_detail.map(i => i.nombre || i.servicio || i.name || 'Servicio');
        }

        const servicesStr = serviceNames.join(', ');
        const discountNotes = `Factura #${ticketNum}${servicesStr ? ` - Servicios: ${servicesStr}` : ''}`;
        const nominaPart = Array.isArray(applied_payments) 
          ? applied_payments.find(p => p.method === 'Nomina' || p.method === 'Consumo Empleado' || p.method === 'Descuento Nómina' || p.method === 'Descuento Nmina')?.amount 
          : null;
        const discountAmount = parseFloat(nominaPart || employee_consumption?.monto || total || 0);

        const consumptionId = 'CONS-' + Date.now();
        try {
          await pool.query(
            `INSERT INTO employee_consumptions (id, employee_id, employee_name, monto, servicios, visit_id, salon_id, created_at, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 'Pendiente_Nomina')`,
            [consumptionId, rawEmpId || empId || 'EMP', empName, discountAmount, JSON.stringify(serviceNames), id, branchId]
          );
        } catch (consErr) {
          console.error('[CHECKOUT CONSUMPTION ERROR]:', consErr.message);
        }

        try {
          await pool.query(
            `INSERT INTO employee_discounts (employee_id, employee_name, type, amount, date, notes, status, created_by, visit_id, created_at)
             VALUES (?, ?, 'Consumo_Servicio', ?, CURDATE(), ?, 'Pendiente', 'Caja POS (Nómina)', ?, NOW())`,
            [rawEmpId, empName, discountAmount, discountNotes, id]
          );
        } catch (discErr) {
          console.error('[CHECKOUT EMPLOYEE DISCOUNT ERROR]:', discErr.message);
        }
      }

      // Auto-calculate and record commissions per line-item for assigned employees
      if (Array.isArray(items_detail) && items_detail.length > 0) {
        await processVisitCommissions(id, items_detail);
      }

      // Auto-record sale movement into active cash register session
      const sId = salon_id || 1;
      let activeRegId = req.body.cash_register_id || null;
      if (!activeRegId) {
        const [openRegisters] = await pool.query(
          "SELECT id FROM cash_registers WHERE status = 'Abierta' AND (salon_id = ? OR salon_id IS NULL) ORDER BY opened_at DESC LIMIT 1",
          [sId]
        );
        if (openRegisters.length > 0) {
          activeRegId = openRegisters[0].id;
        }
      }

      if (activeRegId) {
        await pool.query('UPDATE visits SET cash_register_id = ? WHERE id = ?', [activeRegId, id]);

        if (Array.isArray(applied_payments) && applied_payments.length > 0) {
          const devueltaVal = parseFloat(devuelta) || 0;
          const invoiceTotal = parseFloat(total) || 0;

          // Calcular total no-efectivo para conocer el remanente neto exacto que le corresponde a efectivo
          const nonCashTotal = applied_payments
            .filter(p => !(p.method || '').toLowerCase().includes('efectivo'))
            .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
          const maxCashNet = Math.max(0, invoiceTotal - nonCashTotal);

          for (const p of applied_payments) {
            let pAmt = parseFloat(p.amount) || 0;
            const pMethod = p.method || 'Efectivo';

            if (pMethod.toLowerCase().includes('efectivo')) {
              // Si el monto de efectivo enviado supera el neto que le corresponde (ej: enviaron el monto recibido bruto con devuelta)
              if (devueltaVal > 0 && pAmt > maxCashNet) {
                pAmt = Math.max(0, pAmt - devueltaVal);
              }
              // En cualquier circunstancia, el efectivo neto ingresado a caja nunca puede superar el remanente de la factura
              if (maxCashNet > 0 && pAmt > maxCashNet) {
                pAmt = maxCashNet;
              } else if (maxCashNet === 0 && invoiceTotal > 0) {
                pAmt = 0;
              }
            } else if (applied_payments.length === 1 && pAmt > invoiceTotal && invoiceTotal > 0) {
              pAmt = invoiceTotal;
            }

            if (pAmt > 0 || pMethod.toLowerCase().includes('plan')) {
              await pool.query(
                `INSERT INTO cash_register_movements (cash_register_id, type, payment_method, amount, concept, visit_id, created_at)
                 VALUES (?, 'Ingreso_Venta', ?, ?, ?, ?, NOW())`,
                [activeRegId, pMethod, pAmt, `Cobro Factura #${ticketNum || id} (${pMethod})`, id]
              );
            }
          }
        } else {
          const rawMetodo = (metodo_pago || 'Efectivo').toString();

          if (rawMetodo.toLowerCase().includes('mixto')) {
            let ef = 0, tj = 0, tr = 0, gc = 0;
            const efMatch = rawMetodo.match(/Efectivo:\s*RD\$\s*([\d,.]+)/i);
            const tjMatch = rawMetodo.match(/Tarjeta:\s*RD\$\s*([\d,.]+)/i);
            const trMatch = rawMetodo.match(/Transferencia:\s*RD\$\s*([\d,.]+)/i);
            const gcMatch = rawMetodo.match(/Gift Card:\s*RD\$\s*([\d,.]+)/i);

            if (efMatch) ef = parseFloat(efMatch[1].replace(/,/g, '')) || 0;
            if (tjMatch) tj = parseFloat(tjMatch[1].replace(/,/g, '')) || 0;
            if (trMatch) tr = parseFloat(trMatch[1].replace(/,/g, '')) || 0;
            if (gcMatch) gc = parseFloat(gcMatch[1].replace(/,/g, '')) || 0;

            if (ef === 0 && tj === 0 && tr === 0 && gc === 0) {
              ef = Number(total || 0) / 2;
              tj = Number(total || 0) / 2;
            }

            if (ef > 0) {
              await pool.query(
                `INSERT INTO cash_register_movements (cash_register_id, type, payment_method, amount, concept, visit_id, created_at)
                 VALUES (?, 'Ingreso_Venta', 'Efectivo', ?, ?, ?, NOW())`,
                [activeRegId, ef, `Cobro Factura #${ticketNum || id} (Parte Efectivo)`, id]
              );
            }
            if (tj > 0) {
              await pool.query(
                `INSERT INTO cash_register_movements (cash_register_id, type, payment_method, amount, concept, visit_id, created_at)
                 VALUES (?, 'Ingreso_Venta', 'Tarjeta', ?, ?, ?, NOW())`,
                [activeRegId, tj, `Cobro Factura #${ticketNum || id} (Parte Tarjeta)`, id]
              );
            }
            if (tr > 0) {
              await pool.query(
                `INSERT INTO cash_register_movements (cash_register_id, type, payment_method, amount, concept, visit_id, created_at)
                 VALUES (?, 'Ingreso_Venta', 'Transferencia', ?, ?, ?, NOW())`,
                [activeRegId, tr, `Cobro Factura #${ticketNum || id} (Parte Transferencia)`, id]
              );
            }
            if (gc > 0) {
              await pool.query(
                `INSERT INTO cash_register_movements (cash_register_id, type, payment_method, amount, concept, visit_id, created_at)
                 VALUES (?, 'Ingreso_Venta', 'Gift Card', ?, ?, ?, NOW())`,
                [activeRegId, gc, `Cobro Factura #${ticketNum || id} (Parte Gift Card)`, id]
              );
            }
          } else {
            await pool.query(
              `INSERT INTO cash_register_movements (cash_register_id, type, payment_method, amount, concept, visit_id, created_at)
               VALUES (?, 'Ingreso_Venta', ?, ?, ?, ?, NOW())`,
              [activeRegId, rawMetodo, total || 0, `Cobro Factura #${ticketNum || id}`, id]
            );
          }
        }
      }

      const [finalVisitRows] = await pool.query('SELECT ncf, ncf_type, ncf_name, codigo_seguridad_ecf, qr_code_url FROM visits WHERE id = ?', [id]);
      const fv = finalVisitRows[0] || {};

      // Auto-dispatch satisfaction survey email if client has a registered email
      (async () => {
        try {
          if (typeof sendSurveyEmail !== 'function') return;

          const effectiveClientId = client_id || existing[0]?.client_id || null;
          const effectiveClientName = client_name || existing[0]?.client_name || null;

          let targetEmail = req.body.client_email || req.body.email || null;
          let targetClientId = effectiveClientId;
          let targetClientName = effectiveClientName;

          if (!targetEmail && effectiveClientId && effectiveClientId !== 'INVITADO') {
            const cleanId = String(effectiveClientId).replace(/\D/g, '');
            const [cRows] = await pool.query(
              `SELECT id, nombre, email, cedula FROM clients 
               WHERE id = ? OR cedula = ? OR REPLACE(cedula, '-', '') = ? LIMIT 1`,
              [effectiveClientId, effectiveClientId, cleanId]
            );
            if (cRows.length > 0 && cRows[0].email) {
              targetEmail = cRows[0].email.trim();
              targetClientId = cRows[0].id;
              targetClientName = targetClientName || cRows[0].nombre;
            }
          }

          if (!targetEmail && effectiveClientName && effectiveClientName !== 'Cliente General') {
            const [cByName] = await pool.query(
              `SELECT id, nombre, email, cedula FROM clients 
               WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)) AND email IS NOT NULL AND email != '' LIMIT 1`,
              [effectiveClientName]
            );
            if (cByName.length > 0 && cByName[0].email) {
              targetEmail = cByName[0].email.trim();
              targetClientId = targetClientId || cByName[0].id;
              targetClientName = targetClientName || cByName[0].nombre;
            }
          }

          if (targetEmail && targetEmail.includes('@')) {
            console.log(`[CHECKOUT SURVEY] Dispatching survey email to ${targetEmail} for ticket ${ticketNum || id}`);
            await sendSurveyEmail(targetClientId || 'INVITADO', targetClientName || 'Estimada clienta', targetEmail);
          }
        } catch (surveyErr) {
          console.error('[CHECKOUT SURVEY DISPATCH ERROR]:', surveyErr.message);
        }
      })().catch(e => console.error('[UNHANDLED CHECKOUT SURVEY ERROR]:', e));

      if (promoLockAcquired && promoLockKey) {
        try { await pool.query("SELECT RELEASE_LOCK(?)", [promoLockKey]); } catch (_) {}
        promoLockAcquired = false;
      }

      res.json({ 
        success: true, 
        ticketNumber: ticketNum || id,
        ncf: dgiiResult?.ncf || fv.ncf || null,
        ncf_type: dgiiResult?.ncf_type || fv.ncf_type || null,
        ncf_name: dgiiResult?.ncf_name || fv.ncf_name || null,
        codigo_seguridad: dgiiResult?.codigo_seguridad || fv.codigo_seguridad_ecf || null,
        qr_code_url: dgiiResult?.qr_code_url || fv.qr_code_url || null
      });
    } catch (err) {
      if (typeof promoLockAcquired !== 'undefined' && promoLockAcquired && promoLockKey) {
        try { await pool.query("SELECT RELEASE_LOCK(?)", [promoLockKey]); } catch (_) {}
      }
      try {
        await pool.query("UPDATE visits SET status = 'Pendiente' WHERE id = ? AND status = 'Procesando'", [id]);
      } catch (_) {}
      res.status(500).json({ error: err.message });
    }
  }

  // Delete pending ticket / visit
  const handleDeleteVisit = async (req, res) => {
    try {
      const { id } = req.params;
      await pool.query('DELETE FROM visits WHERE id = ? AND status = "Pendiente"', [id]);
      res.json({ success: true, message: 'Ticket descartado exitosamente' });
    } catch (err) {
      console.error('[API DELETE VISIT ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  };

  // Delete all pending tickets / visits
  const handleClearAllPendingVisits = async (req, res) => {
    try {
      const salonId = req.query.salon_id || req.body?.salon_id;
      let query = 'DELETE FROM visits WHERE status = "Pendiente"';
      const params = [];
      if (salonId && salonId !== 'all') {
        query += ' AND salon_id = ?';
        params.push(salonId);
      }
      const [result] = await pool.query(query, params);
      res.json({ success: true, message: 'Todos los tickets pendientes fueron eliminados', affectedRows: result.affectedRows });
    } catch (err) {
      console.error('[API CLEAR ALL PENDING VISITS ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  };

  // --- ROUTES ---

  router.get('/', async (req, res) => {
    try {
      const [rows] = await pool.query('SELECT v.*, s.name as salon_name FROM visits v LEFT JOIN salons s ON v.salon_id = s.id ORDER BY v.visited_at DESC');
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/pending', async (req, res) => {
    try {
      // Auto-recuperación de visitas abandonadas o interrumpidas en Procesando sin comprobante asignado
      try {
        await pool.query(
          "UPDATE visits SET status = 'Pendiente' WHERE status = 'Procesando' AND ncf IS NULL AND visited_at < NOW() - INTERVAL 15 SECOND"
        );
      } catch (autoRecErr) {
        console.warn('[AUTO-RECOVER PROCESANDO ERROR]:', autoRecErr.message);
      }

      const { salon_id } = req.query;
      let query = `
        SELECT v.*, COALESCE(s.name, 'Sucursal San Vicente de Paúl') as salon_name 
        FROM visits v 
        LEFT JOIN salons s ON v.salon_id = s.id 
        WHERE v.status = 'Pendiente'
      `;
      const params = [];
      if (salon_id && salon_id !== 'all') {
        query += ' AND (v.salon_id = ? OR v.salon_id IS NULL)';
        params.push(salon_id);
      }
      query += ' ORDER BY v.visited_at ASC';
      const [rows] = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/stats/fiscal-summary', async (req, res) => {
    try {
      const { salon_id, startDate, endDate, periodo } = req.query;
      let dateCondition = '';
      const params = [];

      if (periodo && /^\d{6}$/.test(periodo)) {
        dateCondition = " AND DATE_FORMAT(v.visited_at, '%Y%m') = ?";
        params.push(periodo);
      } else if (startDate && endDate) {
        dateCondition = " AND DATE(v.visited_at) BETWEEN ? AND ?";
        params.push(startDate, endDate);
      }

      let salonCondition = '';
      if (salon_id && salon_id !== 'all') {
        salonCondition = ' AND v.salon_id = ?';
        params.push(salon_id);
      }

      const [rows] = await pool.query(`
        SELECT
          COUNT(*) as total_operaciones,
          COALESCE(SUM(CASE WHEN v.status != 'Anulado' THEN 1 ELSE 0 END), 0) as operaciones_vigentes,
          COALESCE(SUM(CASE WHEN v.status = 'Anulado' THEN 1 ELSE 0 END), 0) as operaciones_anuladas,
          COALESCE(SUM(CASE WHEN v.status != 'Anulado' AND v.ncf IS NOT NULL AND TRIM(v.ncf) != '' AND v.ncf != 'NONE' THEN 1 ELSE 0 END), 0) as vigentes_con_comprobante,
          COALESCE(SUM(CASE WHEN v.status != 'Anulado' AND (v.ncf IS NULL OR TRIM(v.ncf) = '' OR v.ncf = 'NONE') THEN 1 ELSE 0 END), 0) as vigentes_sin_comprobante,
          COALESCE(SUM(CASE WHEN v.status = 'Anulado' AND v.ncf IS NOT NULL AND TRIM(v.ncf) != '' AND v.ncf != 'NONE' THEN 1 ELSE 0 END), 0) as anuladas_con_comprobante,
          COALESCE(SUM(CASE WHEN v.status = 'Anulado' AND (v.ncf IS NULL OR TRIM(v.ncf) = '' OR v.ncf = 'NONE') THEN 1 ELSE 0 END), 0) as anuladas_sin_comprobante,

          -- Montos
          COALESCE(SUM(CASE WHEN v.status != 'Anulado' THEN v.total ELSE 0 END), 0) as monto_vigente,
          COALESCE(SUM(CASE WHEN v.status = 'Anulado' THEN v.total ELSE 0 END), 0) as monto_anulado,

          -- Desglose por método de pago (Efectivo)
          COALESCE(SUM(CASE WHEN (v.metodo_pago LIKE '%Efectivo%' OR v.metodo_pago LIKE '%Cash%') THEN 1 ELSE 0 END), 0) as efectivo_total,
          COALESCE(SUM(CASE WHEN (v.metodo_pago LIKE '%Efectivo%' OR v.metodo_pago LIKE '%Cash%') AND v.status != 'Anulado' THEN 1 ELSE 0 END), 0) as efectivo_vigente,
          COALESCE(SUM(CASE WHEN (v.metodo_pago LIKE '%Efectivo%' OR v.metodo_pago LIKE '%Cash%') AND v.status != 'Anulado' AND v.ncf IS NOT NULL AND TRIM(v.ncf) != '' AND v.ncf != 'NONE' THEN 1 ELSE 0 END), 0) as efectivo_vigente_con_comprobante,
          COALESCE(SUM(CASE WHEN (v.metodo_pago LIKE '%Efectivo%' OR v.metodo_pago LIKE '%Cash%') AND v.status != 'Anulado' AND (v.ncf IS NULL OR TRIM(v.ncf) = '' OR v.ncf = 'NONE') THEN 1 ELSE 0 END), 0) as efectivo_vigente_sin_comprobante,
          COALESCE(SUM(CASE WHEN (v.metodo_pago LIKE '%Efectivo%' OR v.metodo_pago LIKE '%Cash%') AND v.status = 'Anulado' THEN 1 ELSE 0 END), 0) as efectivo_anuladas,

          -- Desglose por método de pago (Tarjeta)
          COALESCE(SUM(CASE WHEN v.metodo_pago LIKE '%Tarjeta%' THEN 1 ELSE 0 END), 0) as tarjeta_total,
          COALESCE(SUM(CASE WHEN v.metodo_pago LIKE '%Tarjeta%' AND v.status != 'Anulado' THEN 1 ELSE 0 END), 0) as tarjeta_vigente,
          COALESCE(SUM(CASE WHEN v.metodo_pago LIKE '%Tarjeta%' AND v.status != 'Anulado' AND v.ncf IS NOT NULL AND TRIM(v.ncf) != '' AND v.ncf != 'NONE' THEN 1 ELSE 0 END), 0) as tarjeta_vigente_con_comprobante,
          COALESCE(SUM(CASE WHEN v.metodo_pago LIKE '%Tarjeta%' AND v.status != 'Anulado' AND (v.ncf IS NULL OR TRIM(v.ncf) = '' OR v.ncf = 'NONE') THEN 1 ELSE 0 END), 0) as tarjeta_vigente_sin_comprobante,
          COALESCE(SUM(CASE WHEN v.metodo_pago LIKE '%Tarjeta%' AND v.status = 'Anulado' THEN 1 ELSE 0 END), 0) as tarjeta_anuladas,

          -- Desglose por método de pago (Transferencia)
          COALESCE(SUM(CASE WHEN v.metodo_pago LIKE '%Transferencia%' THEN 1 ELSE 0 END), 0) as transferencia_total,
          COALESCE(SUM(CASE WHEN v.metodo_pago LIKE '%Transferencia%' AND v.status != 'Anulado' THEN 1 ELSE 0 END), 0) as transferencia_vigente,
          COALESCE(SUM(CASE WHEN v.metodo_pago LIKE '%Transferencia%' AND v.status != 'Anulado' AND v.ncf IS NOT NULL AND TRIM(v.ncf) != '' AND v.ncf != 'NONE' THEN 1 ELSE 0 END), 0) as transferencia_vigente_con_comprobante,
          COALESCE(SUM(CASE WHEN v.metodo_pago LIKE '%Transferencia%' AND v.status != 'Anulado' AND (v.ncf IS NULL OR TRIM(v.ncf) = '' OR v.ncf = 'NONE') THEN 1 ELSE 0 END), 0) as transferencia_vigente_sin_comprobante,
          COALESCE(SUM(CASE WHEN v.metodo_pago LIKE '%Transferencia%' AND v.status = 'Anulado' THEN 1 ELSE 0 END), 0) as transferencia_anuladas
        FROM visits v
        WHERE 1=1 ${dateCondition} ${salonCondition}
      `, params);

      const r = rows[0];
      return res.json({
        total_operaciones: Number(r.total_operaciones || 0),
        operaciones_vigentes: Number(r.operaciones_vigentes || 0),
        operaciones_anuladas: Number(r.operaciones_anuladas || 0),
        vigentes_con_comprobante: Number(r.vigentes_con_comprobante || 0),
        vigentes_sin_comprobante: Number(r.vigentes_sin_comprobante || 0),
        anuladas_con_comprobante: Number(r.anuladas_con_comprobante || 0),
        anuladas_sin_comprobante: Number(r.anuladas_sin_comprobante || 0),
        monto_vigente: Number(r.monto_vigente || 0),
        monto_anulado: Number(r.monto_anulado || 0),
        desglose_por_metodo: {
          efectivo: {
            total: Number(r.efectivo_total || 0),
            vigentes: Number(r.efectivo_vigente || 0),
            con_comprobante: Number(r.efectivo_vigente_con_comprobante || 0),
            sin_comprobante: Number(r.efectivo_vigente_sin_comprobante || 0),
            anuladas: Number(r.efectivo_anuladas || 0)
          },
          tarjeta: {
            total: Number(r.tarjeta_total || 0),
            vigentes: Number(r.tarjeta_vigente || 0),
            con_comprobante: Number(r.tarjeta_vigente_con_comprobante || 0),
            sin_comprobante: Number(r.tarjeta_vigente_sin_comprobante || 0),
            anuladas: Number(r.tarjeta_anuladas || 0)
          },
          transferencia: {
            total: Number(r.transferencia_total || 0),
            vigentes: Number(r.transferencia_vigente || 0),
            con_comprobante: Number(r.transferencia_vigente_con_comprobante || 0),
            sin_comprobante: Number(r.transferencia_vigente_sin_comprobante || 0),
            anuladas: Number(r.transferencia_anuladas || 0)
          }
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/client/:clientId', async (req, res) => {
    try {
      const target = req.params.clientId;
      const [rows] = await pool.query(
        `SELECT v.*, COALESCE(s.name, 'Sucursal San Vicente de Paúl') as salon_name 
         FROM visits v 
         LEFT JOIN salons s ON v.salon_id = s.id 
         LEFT JOIN clients c ON (v.client_id = c.id OR LOWER(TRIM(v.client_name)) = LOWER(TRIM(c.nombre)))
         WHERE v.client_id = ? 
            OR LOWER(TRIM(v.client_name)) = LOWER(?) 
            OR c.id = ? 
            OR c.cedula = ?
            OR v.client_name LIKE ?
         ORDER BY v.visited_at DESC`,
        [target, target, target, target, `%${target}%`]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/ticket', async (req, res) => {
    try {
      const id = Date.now().toString();
      const { clientId, clientName, servicios, empleadoPeluquera, empleadoLavaPelo, empleadoManicurista, salon_id, draft_data } = req.body;
      const sId = salon_id || 1;

      const [salonRows] = await pool.query("SELECT name FROM salons WHERE id = ?", [sId]);
      const salonName = salonRows[0]?.name || 'Sucursal San Vicente de Paúl';

      let prefix = 'SD';
      const sNameLower = salonName.toLowerCase();
      if (sNameLower.includes('villa mella') || sNameLower.includes('mella')) {
        prefix = 'VM';
      } else if (sNameLower.includes('frailes')) {
        prefix = 'LF';
      } else if (sNameLower.includes('san vicente')) {
        prefix = 'SD';
      } else {
        prefix = salonName.split(' ').filter(w => w.length > 2).map(w => w[0]).join('').slice(0, 3).toUpperCase() || 'TK';
      }

      const ticketNumber = await getNextTicketNumber(sId, prefix);

      await pool.query(
        `INSERT INTO visits (id, client_id, client_name, servicios, draft_data, empleado_peluquera, empleado_lava_pelo, empleado_manicurista, salon_id, status, ticket_number, visited_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?, NOW())`,
        [id, clientId || 'INVITADO', clientName || 'Cliente General', JSON.stringify(servicios || []), JSON.stringify(draft_data || {}), empleadoPeluquera || 'N/A', empleadoLavaPelo || 'N/A', empleadoManicurista || 'N/A', sId, ticketNumber]
      );

      res.json({ id, ticketNumber, salonName, clientName: clientName || 'Cliente General', createdAt: new Date().toISOString(), success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/:id/draft', async (req, res) => {
    try {
      const { id } = req.params;
      const { draft_data, items_detail, total, servicios, empleado_peluquera, empleado_lava_pelo, empleado_manicurista } = req.body;

      await pool.query(
        `UPDATE visits SET 
          draft_data = ?, 
          items_detail = ?, 
          total = ?, 
          servicios = ?, 
          empleado_peluquera = ?, 
          empleado_lava_pelo = ?, 
          empleado_manicurista = ?
         WHERE id = ?`,
        [
          JSON.stringify(draft_data || {}),
          JSON.stringify(items_detail || []),
          total || 0.00,
          JSON.stringify(servicios || []),
          empleado_peluquera || 'N/A',
          empleado_lava_pelo || 'N/A',
          empleado_manicurista || 'N/A',
          id
        ]
      );

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Endpoint explícito de Precuenta (No fiscal, no registra ingresos, no emite e-NCF)
  const handlePrecuenta = async (req, res) => {
    try {
      const id = req.body?.ticketId || req.body?.id || `VIS-${Date.now()}`;
      const { total, items_detail, client_id, client_name, salon_id, metodo_pago } = req.body;

      const [existing] = await pool.query('SELECT id, ticket_number FROM visits WHERE id = ?', [id]);
      let ticketNum = existing[0]?.ticket_number;
      if (!ticketNum) {
        ticketNum = await getNextTicketNumber(salon_id || 1, 'SD');
      }

      let serviceNames = [];
      if (Array.isArray(items_detail) && items_detail.length > 0) {
        serviceNames = items_detail.map(i => i.nombre || i.servicio || i.name || 'Servicio').filter(Boolean);
      }

      if (existing.length === 0) {
        await pool.query(
          `INSERT INTO visits
            (id, ticket_number, client_id, client_name, total, metodo_pago, items_detail, servicios, salon_id, status, ncf, ncf_type, ncf_name, visited_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', NULL, 'PRECUENTA', 'Precuenta No Fiscal', NOW())`,
          [id, ticketNum, client_id || 'INVITADO', client_name || 'Cliente General', total || 0, metodo_pago || 'Pendiente', JSON.stringify(items_detail || []), JSON.stringify(serviceNames || []), salon_id || 1]
        );
      } else {
        await pool.query(
          `UPDATE visits SET
            total = ?,
            metodo_pago = ?,
            items_detail = ?,
            servicios = ?,
            status = 'Pendiente',
            ncf = NULL,
            ncf_type = 'PRECUENTA',
            ncf_name = 'Precuenta No Fiscal'
           WHERE id = ?`,
          [total || 0, metodo_pago || 'Pendiente', JSON.stringify(items_detail || []), JSON.stringify(serviceNames || []), id]
        );
      }

      res.json({
        success: true,
        is_precuenta: true,
        ticket_id: id,
        ticket_number: ticketNum,
        total: total || 0,
        status: 'Pendiente',
        message: 'PRECUENTA — NO ES FACTURA FISCAL — PENDIENTE DE PAGO'
      });
    } catch (err) {
      console.error('[API PRECUENTA ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  };

  router.post('/precuenta', handlePrecuenta);
  router.post('/:id/precuenta', async (req, res) => {
    req.body = req.body || {};
    req.body.id = req.params.id;
    return handlePrecuenta(req, res);
  });

  router.post('/checkout', async (req, res) => {
    const visitId = req.body.ticketId || req.body.id || `VIS-${Date.now()}`;
    req.params = { id: visitId };
    return handleCheckoutVisit(req, res);
  });

  router.post('/:id/checkout', handleCheckoutVisit);

  router.post('/:id/void', async (req, res) => {
    try {
      const { id } = req.params;
      const { reason, voided_by } = req.body;

      if (!reason || !reason.trim()) {
        return res.status(400).json({ error: 'Debes proporcionar un motivo claro para la anulación de la factura.' });
      }

      const [visits] = await pool.query('SELECT * FROM visits WHERE id = ?', [id]);
      if (visits.length === 0) {
        return res.status(404).json({ error: 'Factura/Ticket no encontrado.' });
      }

      const visit = visits[0];

      if (visit.status === 'Anulado') {
        return res.status(400).json({ error: 'Esta factura ya se encuentra anulada.' });
      }

      const wasActuallyBilled = (visit.status === 'Facturado');
      const userWhoVoided = voided_by || 'Cajero/Admin';
      const voidReasonText = reason.trim();

      await pool.query(
        `UPDATE visits SET 
          status = 'Anulado', 
          void_reason = ?, 
          voided_by = ?, 
          voided_at = NOW() 
         WHERE id = ?`,
        [voidReasonText, userWhoVoided, id]
      );

      await pool.query(
        "UPDATE employee_commissions_log SET status = 'Anulada' WHERE (visit_id = ? OR ticket_number = ?) AND status != 'Anulada'",
        [id, visit.ticket_number || id]
      );

      try {
        await pool.query("UPDATE employee_consumptions SET status = 'Anulado' WHERE visit_id = ?", [id]);
      } catch(e) {}

      try {
        await pool.query(
          "UPDATE employee_discounts SET status = 'Anulado' WHERE (visit_id = ? OR notes LIKE ? OR notes LIKE ? OR notes LIKE ?)",
          [id, `%#${visit.ticket_number}%`, `%#${id}%`, `%${visit.ticket_number}%`]
        );
      } catch(e) {}

      const visitTotal = Number(visit.total || 0);

      // Ajuste de cuadre de caja al anular:
      // REGLA OPERATIVA DE SEGURIDAD:
      // 1. Sólo se generan movimientos de Anulacion_Venta si la visita tuvo ingresos reales registrados (Ingreso_Venta) o fue previamente Facturada.
      //    Precuentas, borradores y visitas que nunca ingresaron dinero a caja NO deben restar dinero de la caja.
      // 2. Si existen Ingreso_Venta previos en cash_register_movements para esta visita, anularlos en SU MISMA CAJA.
      // 3. NUNCA cruzar movimientos a cajas de otras sucursales (salon_id distinto).
      const [existingIncomeMoves] = await pool.query(
        "SELECT id, cash_register_id, payment_method, amount FROM cash_register_movements WHERE visit_id = ? AND type = 'Ingreso_Venta'",
        [id]
      );

      const [existingVoidMoves] = await pool.query(
        "SELECT id, cash_register_id FROM cash_register_movements WHERE visit_id = ? AND type = 'Anulacion_Venta'",
        [id]
      );

      if (existingIncomeMoves.length > 0 && existingVoidMoves.length === 0) {
        for (const inc of existingIncomeMoves) {
          const incAmt = Math.abs(parseFloat(inc.amount) || 0);
          if (incAmt > 0) {
            await pool.query(
              `INSERT INTO cash_register_movements (cash_register_id, type, payment_method, amount, concept, user_name, visit_id, created_at)
               VALUES (?, 'Anulacion_Venta', ?, ?, ?, ?, ?, NOW())`,
              [
                inc.cash_register_id,
                inc.payment_method || 'Efectivo',
                -incAmt,
                `Anulación Factura ${visit.ticket_number || id} - ${voidReasonText}`,
                userWhoVoided,
                id
              ]
            );
          }
        }
      } else if (existingVoidMoves.length === 0 && wasActuallyBilled && visitTotal > 0) {
        let targetRegId = null;
        if (visit.cash_register_id) {
          const [regRow] = await pool.query('SELECT id, salon_id FROM cash_registers WHERE id = ?', [visit.cash_register_id]);
          if (regRow.length > 0 && (!visit.salon_id || regRow[0].salon_id === visit.salon_id)) {
            targetRegId = regRow[0].id;
          }
        }
        if (!targetRegId && visit.salon_id) {
          const [openRegs] = await pool.query(
            "SELECT id FROM cash_registers WHERE salon_id = ? AND status = 'Abierta' ORDER BY opened_at DESC LIMIT 1",
            [visit.salon_id]
          );
          if (openRegs.length > 0) targetRegId = openRegs[0].id;
        }

        if (targetRegId) {
          await pool.query(
            `INSERT INTO cash_register_movements (cash_register_id, type, payment_method, amount, concept, user_name, visit_id, created_at)
             VALUES (?, 'Anulacion_Venta', ?, ?, ?, ?, ?, NOW())`,
            [
              targetRegId,
              visit.metodo_pago || 'Efectivo',
              -Math.abs(visitTotal),
              `Anulación Factura ${visit.ticket_number || id} - ${voidReasonText}`,
              userWhoVoided,
              id
            ]
          );
        }
      }

      await pool.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, user_name, reason, metadata, created_at)
         VALUES ('invoice', ?, 'ANULAR_FACTURA', ?, ?, ?, NOW())`,
        [
          id,
          userWhoVoided,
          voidReasonText,
          JSON.stringify({
            ticket_number: visit.ticket_number || id,
            client_name: visit.client_name,
            total: visitTotal,
            metodo_pago: visit.metodo_pago
          })
        ]
      );

      // Nota: No se decrementa el contador de operaciones al anular.
      // Las estadísticas se calculan sobre registros reales (status != 'Anulado')
      // y la anulación de facturas pasadas no altera la clasificación ni secuencias de nuevas ventas.

      // Distinción de estados fiscales en la anulación:
      // 1. Facturas con e-NCF emitido: generan Nota de Crédito Electrónica E34 con transmisión y firmado fiscal.
      // 2. Comprobantes no fiscales / Canjes / Documentos sin e-NCF: se anulan en auditoría sin consumir secuencia E34.
      const hasFiscalNcf = visit.ncf && visit.ncf !== 'NONE' && (visit.ncf.startsWith('E31') || visit.ncf.startsWith('E32') || visit.ncf.startsWith('E34') || visit.ncf.startsWith('B'));
      let notaCreditoInfo = null;
      let fiscalStatusDescription = 'Documento no fiscal / canje interno anulado directamente sin consumo de e-NCF.';

      if (hasFiscalNcf && typeof generateAndTransmitNotaCredito === 'function') {
        try {
          notaCreditoInfo = await generateAndTransmitNotaCredito(visit, voidReasonText, userWhoVoided);
          const ncNumber = (typeof notaCreditoInfo === 'object' && notaCreditoInfo?.encf) ? notaCreditoInfo.encf : (notaCreditoInfo ? String(notaCreditoInfo) : null);
          const trackId = (typeof notaCreditoInfo === 'object' && notaCreditoInfo?.trackId) ? notaCreditoInfo.trackId : null;
          fiscalStatusDescription = `Factura fiscal con e-NCF ${visit.ncf} anulada mediante Nota de Crédito Electrónica ${ncNumber}${trackId ? ` (TrackID: ${trackId})` : ''}.`;
        } catch (ncErr) {
          console.error('[DGII VOID NOTA CREDITO FAILED]:', ncErr);
          fiscalStatusDescription = `Factura fiscal con e-NCF ${visit.ncf} anulada en base de datos. Error al generar Nota de Crédito: ${ncErr.message}`;
        }
      }

      res.json({ 
        success: true, 
        message: 'Factura anulada correctamente con registro de auditoría.',
        ncf_original: visit.ncf || null,
        ncf_nota_credito: (typeof notaCreditoInfo === 'object' && notaCreditoInfo?.encf) ? notaCreditoInfo.encf : (notaCreditoInfo || null),
        track_id_nota_credito: (typeof notaCreditoInfo === 'object' && notaCreditoInfo?.trackId) ? notaCreditoInfo.trackId : null,
        fiscal_status: fiscalStatusDescription
      });
    } catch (err) {
      console.error('[API VOID VISIT ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Reasignar comisionista / colaborador asociado a una factura existente
  router.put('/:id/commission-recipient', async (req, res) => {
    try {
      const { id } = req.params;
      const { updatedItems, reason, user_name } = req.body;

      if (!reason || !reason.trim()) {
        return res.status(400).json({ error: 'Debes proporcionar un motivo para la edición del comisionista.' });
      }

      if (!Array.isArray(updatedItems) || updatedItems.length === 0) {
        return res.status(400).json({ error: 'Debes proporcionar el desglose de servicios y comisionistas actualizados.' });
      }

      const [visits] = await pool.query('SELECT * FROM visits WHERE id = ?', [id]);
      if (visits.length === 0) {
        return res.status(404).json({ error: 'Factura/Ticket no encontrado.' });
      }

      const visit = visits[0];

      if (visit.status === 'Anulado') {
        return res.status(400).json({ error: 'No se puede modificar una factura que se encuentra anulada.' });
      }

      // Parse existing items_detail
      let currentItems = [];
      try {
        if (visit.items_detail) {
          currentItems = typeof visit.items_detail === 'string' ? JSON.parse(visit.items_detail) : visit.items_detail;
        }
      } catch (e) {
        currentItems = [];
      }

      // Check if any existing commission for this visit has already been paid
      const [paidComms] = await pool.query(
        "SELECT * FROM employee_commissions_log WHERE (visit_id = ? OR ticket_number = ?) AND status = 'Pagado'",
        [id, visit.ticket_number || id]
      );

      // Verify that no modified service item belongs to an already paid commission
      if (paidComms.length > 0) {
        for (const item of updatedItems) {
          const serviceName = (item.nombre || item.service_name || item.servicio || '').toLowerCase().trim();
          const isPaid = paidComms.some(pc => (pc.service_name || '').toLowerCase().trim() === serviceName);
          if (isPaid) {
            return res.status(400).json({
              error: `La comisión para el servicio "${item.nombre || item.service_name || item.servicio}" ya fue pagada en nómina y no puede ser reasignada.`
            });
          }
        }
      }

      // Fetch all active staff to validate names and IDs
      const [staffList] = await pool.query(
        'SELECT id, nombre, localidad, commission_scheme_id FROM staff_records WHERE status = "Activo" OR status = "Active"'
      );

      // Build new items_detail array with updated employees
      // We strictly preserve prices, quantities, discounts, totals, and ONLY modify the employee assignment!
      const changes = [];
      const newItemsDetail = currentItems.map((origItem, idx) => {
        const update = updatedItems[idx] || updatedItems.find(u => u.index === idx) || {};
        
        let newEmpId = update.empleado_id !== undefined ? update.empleado_id : (origItem.empleado_id || origItem.employee_id);
        let newEmpName = update.empleado_nombre !== undefined ? update.empleado_nombre : (origItem.empleado_nombre || origItem.employee_name || origItem.empleado);

        // Normalize employee name from staff records if ID was provided
        if (newEmpId && newEmpId !== 'N/A' && newEmpId !== 'Sin Asignar') {
          const cleanId = parseInt(String(newEmpId).replace(/\D/g, ''), 10);
          const foundStaff = staffList.find(s => s.id === cleanId || s.nombre.toLowerCase().trim() === String(newEmpName || '').toLowerCase().trim());
          if (foundStaff) {
            newEmpId = foundStaff.id;
            newEmpName = foundStaff.nombre;
          }
        } else if (newEmpName && newEmpName !== 'N/A' && newEmpName !== 'Sin Asignar') {
          const foundStaff = staffList.find(s => s.nombre.toLowerCase().trim() === String(newEmpName).toLowerCase().trim());
          if (foundStaff) {
            newEmpId = foundStaff.id;
            newEmpName = foundStaff.nombre;
          }
        }

        const prevEmpName = origItem.empleado_nombre || origItem.employee_name || origItem.empleado || 'Sin Asignar';
        const prevEmpId = origItem.empleado_id || origItem.employee_id || null;

        const isNameChanged = String(prevEmpName).trim().toLowerCase() !== String(newEmpName || 'Sin Asignar').trim().toLowerCase();
        const isIdChanged = String(prevEmpId || '') !== String(newEmpId || '');

        if (isNameChanged || isIdChanged) {
          changes.push({
            item_index: idx,
            service_name: origItem.nombre || origItem.service_name || origItem.servicio || `Servicio #${idx + 1}`,
            previous_employee: { id: prevEmpId, name: prevEmpName },
            new_employee: { id: newEmpId || null, name: newEmpName || 'Sin Asignar' }
          });
        }

        return {
          ...origItem,
          empleado_id: newEmpId || null,
          empleado_nombre: newEmpName || 'Sin Asignar',
          employee_id: newEmpId || null,
          employee_name: newEmpName || 'Sin Asignar',
          empleado: newEmpName || 'Sin Asignar'
        };
      });

      if (changes.length === 0) {
        return res.json({ success: true, message: 'No se detectaron cambios en los comisionistas asignados.', noChanges: true });
      }

      // 1. UPDATE items_detail in visits table (KEEP ALL FINANCIAL AMOUNTS, TOTALS, CLIENT AND PAYMENT DATA STRICTLY INTACT)
      await pool.query(
        'UPDATE visits SET items_detail = ? WHERE id = ?',
        [JSON.stringify(newItemsDetail), id]
      );

      // 2. DELETE only 'Pendiente' commissions in employee_commissions_log for this visit
      await pool.query(
        "DELETE FROM employee_commissions_log WHERE (visit_id = ? OR ticket_number = ?) AND status = 'Pendiente'",
        [id, visit.ticket_number || id]
      );

      // 3. RE-PROCESS commissions with the new employees and their commission schemes
      await processVisitCommissions(id, newItemsDetail, visit.ticket_number, visit.visited_at);

      // 4. INSERT record into audit_logs for traceability
      const actorName = user_name || 'Administrador';
      const reasonText = reason.trim();

      await pool.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, user_name, reason, metadata, created_at)
         VALUES ('invoice', ?, 'REASIGNAR_COMISIONISTA', ?, ?, ?, NOW())`,
        [
          id,
          actorName,
          reasonText,
          JSON.stringify({
            ticket_number: visit.ticket_number || id,
            client_name: visit.client_name,
            total: visit.total,
            changes
          })
        ]
      );

      // 5. Also log into security_audit_logs
      try {
        await pool.query(
          `INSERT INTO security_audit_logs (user_name, action, details, ip_address, user_agent, created_at)
           VALUES (?, 'REASIGNAR_COMISIONISTA', ?, ?, ?, NOW())`,
          [
            actorName,
            `Reasignación de comisionista en factura #${visit.ticket_number || id}: ${reasonText} (${changes.length} cambio(s))`,
            req.ip || '127.0.0.1',
            req.headers['user-agent'] || 'Salon Pro Web'
          ]
        );
      } catch (secErr) {}

      res.json({
        success: true,
        message: 'Comisionista actualizado y comisiones recalculadas exitosamente.',
        changes,
        updatedItems: newItemsDetail
      });
    } catch (err) {
      console.error('[API REASSIGN COMMISSION ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Consultar auditoría de una factura específica
  router.get('/:id/audit', async (req, res) => {
    try {
      const { id } = req.params;
      const [rows] = await pool.query(
        "SELECT * FROM audit_logs WHERE entity_type = 'invoice' AND entity_id = ? ORDER BY created_at DESC",
        [id]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });


  router.delete('/pending/all', handleClearAllPendingVisits);
  router.post('/pending/clear-all', handleClearAllPendingVisits);
  router.delete('/:id', handleDeleteVisit);
  router.post('/:id/delete', handleDeleteVisit);

  router.post('/', async (req, res) => {
    try {
      const id = Date.now().toString();
      const { clientId, clientName, servicios, empleadoPeluquera, empleadoManicurista, proximaFecha, autoReminder, salon_id } = req.body;
      const ticketNumber = await getNextTicketNumber(salon_id || 1, 'SD');
      await pool.query(
        "INSERT INTO visits (id, ticket_number, client_id, client_name, servicios, empleado_peluquera, empleado_manicurista, proxima_fecha, recordatorio_auto, salon_id, status, visited_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', NOW())",
        [id, ticketNumber, clientId, clientName, JSON.stringify(servicios || []), empleadoPeluquera, empleadoManicurista, proximaFecha || null, autoReminder ? 1 : 0, salon_id || 1]
      );

      try {
        const cleanId = clientId ? String(clientId).replace(/\D/g, '') : '';
        const [clientData] = await pool.query('SELECT id, nombre, email FROM clients WHERE id = ? OR cedula = ? OR REPLACE(cedula, "-", "") = ? LIMIT 1', [clientId, clientId, cleanId]);
        const targetEmail = req.body.client_email || clientData[0]?.email;
        if (targetEmail && typeof sendSurveyEmail === 'function') {
          sendSurveyEmail(clientId, clientName || clientData[0]?.nombre, targetEmail);
        }
      } catch (sErr) {
        console.error('[POST /visits SURVEY DISPATCH ERROR]:', sErr.message);
      }

      res.json({ id, ticketNumber, success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return {
    router,
    getNextTicketNumber,
    processVisitCommissions,
    assignDgiiSequenceToVisit,
    handleCheckoutVisit,
    handlePrecuenta,
    validateReceptorTaxId,
    isValidRnc,
    isValidCedula,
    isValidRazonSocial
  };
}

module.exports = {
  createVisitsRouter,
  validateReceptorTaxId,
  isValidRnc,
  isValidCedula,
  isValidRazonSocial
};
