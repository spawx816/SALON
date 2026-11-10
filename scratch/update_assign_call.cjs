const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'backend', 'routes', 'visits.routes.js');
let raw = fs.readFileSync(filePath, 'utf8');
const isCrlf = raw.includes('\r\n');
let content = raw.replace(/\r\n/g, '\n');

const oldTarget = `          const assignSequenceFn = deps.assignDgiiSequenceToVisit || assignDgiiSequenceToVisit;
          dgiiResult = await assignSequenceFn(
            id,
            effectiveNcfType,
            clientTaxId,
            finalClientRazonSocial || finalClientRazonSocial || clientRazonSocial || client_name,
            totalNum,
            metodo_pago || 'Efectivo'
          );

          if (!dgiiResult || !dgiiResult.ncf) {
            throw Object.assign(new Error(\`No hay comprobantes fiscales disponibles para \${effectiveNcfType}.\`), {
              code: 'FISCAL_SEQUENCES_EXHAUSTED',
              tipo_comprobante: effectiveNcfType
            });
          }`;

const newTarget = `          const assignSequenceFn = deps.assignDgiiSequenceToVisit || assignDgiiSequenceToVisit;
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
            const err = new Error(dgiiResult?.error || \`No hay comprobantes fiscales disponibles para \${effectiveNcfType}.\`);
            err.code = dgiiResult?.code || 'LOTE_AGOTADO';
            err.tipo_comprobante = effectiveNcfType;
            throw err;
          }`;

if (content.includes(oldTarget)) {
  content = content.replace(oldTarget, newTarget);
  console.log('Successfully updated assignSequenceFn call');
} else {
  console.warn('Could not find oldTarget in content!');
}

if (isCrlf) {
  content = content.replace(/\n/g, '\r\n');
}
fs.writeFileSync(filePath, content, 'utf8');

