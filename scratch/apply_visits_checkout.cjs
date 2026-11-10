const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'backend', 'routes', 'visits.routes.js');
let raw = fs.readFileSync(filePath, 'utf8');
const isCrlf = raw.includes('\r\n');
let content = raw.replace(/\r\n/g, '\n');

// 1. Tax validation
const oldTaxSection = `      // Regla E31: Si se solicita Factura de Crédito Fiscal, validar RNC/Cédula y Razón Social obligatorios
      if (isExplicitCreditoFiscal) {
        const taxValidation = validateReceptorTaxId(clientTaxId);
        if (!taxValidation.isValid) {
          return res.status(400).json({
            error: \`Identificación fiscal del receptor inválida para Factura de Crédito Fiscal (E31): \${taxValidation.error || 'Verifique el RNC (9 dígitos) o Cédula (11 dígitos)'}\`
          });
        }
        if (!isValidRazonSocial(clientRazonSocial)) {
          return res.status(400).json({
            error: 'La Razón Social del receptor es obligatoria para Factura de Crédito Fiscal (E31) y no puede ser vacía ni genérica.'
          });
        }
      }`;

const newTaxSection = `      // Regla E31: Si se solicita Factura de Crédito Fiscal, validar RNC/Cédula y Razón Social obligatorios
      let finalClientRazonSocial = clientRazonSocial;
      if (isExplicitCreditoFiscal) {
        const taxValidation = validateReceptorTaxId(clientTaxId);
        if (!taxValidation.isValid) {
          await pool.query("UPDATE visits SET status = 'Pendiente' WHERE id = ? AND status = 'Procesando'", [id]);
          return res.status(400).json({
            error: \`Identificación fiscal del receptor inválida para Factura de Crédito Fiscal (E31): \${taxValidation.error || 'Verifique el RNC (9 dígitos) o Cédula (11 dígitos)'}\`
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
      }`;

if (content.includes(oldTaxSection)) {
  content = content.replace(oldTaxSection, newTaxSection);
  console.log('Replaced tax validation section');
} else {
  console.warn('Old tax section still not found, checking substring...');
}

// 2. Also ensure clientRazonSocial references in handleCheckoutVisit use finalClientRazonSocial
content = content.replace(
  'clientRazonSocial || client_name,',
  'finalClientRazonSocial || clientRazonSocial || client_name,'
);
content = content.replace(
  'rzn_soc_cliente || null,',
  'finalClientRazonSocial || rzn_soc_cliente || null,'
);

// 3. Update the assignSequenceFn call in handleCheckoutVisit to pass options
const oldAssignCall = `          dgiiResult = await assignSequenceFn(
            id,
            effectiveNcfType,
            clientTaxId,
            finalClientRazonSocial || clientRazonSocial || client_name,
            totalNum,
            metodo_pago || 'Efectivo'
          );

          if (!dgiiResult || !dgiiResult.ncf) {
            throw Object.assign(new Error(\`No hay comprobantes fiscales disponibles para \${effectiveNcfType}.\`), {
              code: 'FISCAL_SEQUENCES_EXHAUSTED',
              tipo_comprobante: effectiveNcfType
            });
          }`;

const newAssignCall = `          dgiiResult = await assignSequenceFn(
            id,
            effectiveNcfType,
            clientTaxId,
            finalClientRazonSocial || clientRazonSocial || client_name,
            totalNum,
            metodo_pago || 'Efectivo',
            { user_name: req.body?.user_name || 'Cajero' }
          );

          if (!dgiiResult || !dgiiResult.ncf) {
            const err = new Error(dgiiResult?.error || \`No hay comprobantes fiscales disponibles para \${effectiveNcfType}.\`);
            err.code = dgiiResult?.code || 'LOTE_AGOTADO';
            err.tipo_comprobante = effectiveNcfType;
            throw err;
          }`;

if (content.includes(oldAssignCall)) {
  content = content.replace(oldAssignCall, newAssignCall);
  console.log('Replaced assignSequenceFn call in handleCheckoutVisit');
}

// 4. Update the catch block return in handleCheckoutVisit
const oldCatchReturn = `          // Bloqueo de facturación: Responder HTTP 409 con mensaje exacto requerido
          return res.status(409).json({
            success: false,
            error: 'No hay comprobantes fiscales disponibles.',
            code: 'FISCAL_SEQUENCES_EXHAUSTED',
            tipo_comprobante: effectiveNcfType,
            nombre_comprobante: effectiveNcfType === 'E31' ? 'Factura de Crédito Fiscal Electrónico (E31)' : 'Factura de Consumo Electrónica (E32)',
            message: 'No hay comprobantes fiscales disponibles.\\n\\nSe agotaron las secuencias autorizadas para este tipo de factura.\\n\\nFavor de notificar al administrador para agregar nuevas secuencias fiscales.\\n\\nPuede guardar o imprimir una precuenta, pero no finalizar la factura ni registrar el cobro.',
            ticket_id: id,
            ticket_number: ticketNum,
            can_print_precuenta: true
          });`;

const newCatchReturn = `          const fiscalErrorCode = dgiiErr.code || 'LOTE_AGOTADO';
          const fiscalErrorMessage = dgiiErr.message || 'No hay comprobantes fiscales disponibles.';

          // Bloqueo de facturación: Responder HTTP 409 con diagnóstico exacto requerido
          return res.status(409).json({
            success: false,
            error: fiscalErrorMessage,
            code: fiscalErrorCode,
            diagnostic_code: fiscalErrorCode,
            tipo_comprobante: effectiveNcfType,
            nombre_comprobante: effectiveNcfType === 'E31' ? 'Factura de Crédito Fiscal Electrónico (E31)' : 'Factura de Consumo Electrónica (E32)',
            message: \`\${fiscalErrorMessage}\\n\\nFavor de verificar las secuencias en Administración → Secuencias Fiscales.\\nPuede guardar o imprimir una precuenta provisional, pero no finalizar la factura fiscal.\`,
            ticket_id: id,
            ticket_number: ticketNum,
            can_print_precuenta: true
          });`;

if (content.includes(oldCatchReturn)) {
  content = content.replace(oldCatchReturn, newCatchReturn);
  console.log('Replaced catch return block');
}

if (isCrlf) {
  content = content.replace(/\n/g, '\r\n');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Finished updating visits.routes.js');
