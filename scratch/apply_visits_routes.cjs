const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'backend', 'routes', 'visits.routes.js');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add import for evaluateBatchFiscalStatus and diagnoseSequenceFailure if not present
if (!content.includes('evaluateBatchFiscalStatus')) {
  content = content.replace(
    "const crypto = require('crypto');",
    "const crypto = require('crypto');\nconst { evaluateBatchFiscalStatus, diagnoseSequenceFailure } = require('./dgii.routes');"
  );
}

// 2. Replace assignDgiiSequenceToVisit implementation
const oldAssignStart = '  // Helper to atomically allocate the next DGII e-NCF sequence for an invoice/visit\n  async function assignDgiiSequenceToVisit(';
const oldAssignEnd = '  // Finalize checkout and mark as Facturado\n  async function handleCheckoutVisit(req, res) {';

const startIdx = content.indexOf('  // Helper to atomically allocate the next DGII e-NCF sequence for an invoice/visit');
const endIdx = content.indexOf('  // Finalize checkout and mark as Facturado');

if (startIdx === -1 || endIdx === -1) {
  console.error('Could not locate assignDgiiSequenceToVisit boundaries!');
  process.exit(1);
}

const newAssignFunction = `  // Helper to atomically allocate the next DGII e-NCF sequence for an invoice/visit
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
        console.log(\`ℹ️ [DGII OPERACIÓN NO FISCAL]: Visita \${visitId} por RD$ \${totalNum} registrada como '\${docName}'.\`);
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
        const err = new Error(\`El tipo de comprobante \${targetType} no corresponde a la empresa o no está soportado.\`);
        err.code = 'ERROR_CORRESPONDENCIA_TIPO';
        err.tipo_comprobante = targetType;
        throw err;
      }
      
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // Bloqueo atómico estricto seleccionando lotes candidatos activos no vencidos (sin LIMIT 1 para permitir rotación entre lotes)
        const [batches] = await connection.query(
          \`SELECT * FROM dgii_ncf_sequences 
           WHERE tipo_comprobante = ?
             AND estado = 'Activo'
             AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= CURDATE())
           ORDER BY id ASC
           FOR UPDATE\`,
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
              \`INSERT INTO audit_logs (entity_type, entity_id, action, user_name, reason, metadata, created_at)
               VALUES ('dgii_sequence', ?, 'FISCAL_SEQUENCE_BLOCKED', ?, ?, ?, NOW())\`,
              [
                visitId,
                options.user_name || 'Cajero/POS',
                \`[\${diag.code}] \${diag.message}\`,
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

          console.warn(\`⚠️ [DGII NCF BLOQUEO]: \${diag.code} para \${targetType}: \${diag.message}\`);
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
          \`UPDATE dgii_ncf_sequences 
           SET cantidad_usada = ?, secuencia_actual = ?, estado = ?, updated_at = NOW() 
           WHERE id = ?\`,
          [newCantidadUsada, newSecuenciaActual, newEstado, seq.id]
        );

        const securityCode = crypto.randomBytes(3).toString('hex').toUpperCase();
        const emisorRnc = '131917038';
        const totalFormatted = Number(totalAmount || 0).toFixed(2);
        const qrUrl = seq.tipo_comprobante === 'E32'
          ? \`https://fc.dgii.gov.do/eCF/ConsultaTimbreFC?RncEmisor=\${emisorRnc}&ENCF=\${encfNumber}&MontoTotal=\${totalFormatted}&CodigoSeguridad=\${securityCode}\`
          : \`https://fc.dgii.gov.do/eCF/ConsultaTimbre?RncEmisor=\${emisorRnc}&RncComprador=\${clientRnc || ''}&ENCF=\${encfNumber}&MontoTotal=\${totalFormatted}&FechaEmision=02-10-2026&FechaFirma=02-10-2026&CodigoSeguridad=\${securityCode}\`;

        await connection.query(
          \`UPDATE visits 
           SET ncf = ?, ncf_type = ?, ncf_name = ?, rnc_cliente = ?, rzn_soc_cliente = ?, codigo_seguridad_ecf = ?, qr_code_url = ? 
           WHERE id = ?\`,
          [encfNumber, seq.tipo_comprobante, seq.nombre_comprobante, clientRnc || null, clientRazonSocial || null, securityCode, qrUrl, visitId]
        );

        await connection.commit();
        console.log(\`✅ [DGII e-NCF Asignado Atómicamente]: \${encfNumber} (\${seq.nombre_comprobante}) para Factura/Visita \${visitId}.\`);

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
  }\n\n`;

content = content.slice(0, startIdx) + newAssignFunction + content.slice(endIdx);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated assignDgiiSequenceToVisit in visits.routes.js');

