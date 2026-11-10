const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'components', 'visits', 'VisitRecorder.jsx');
let raw = fs.readFileSync(filePath, 'utf8');
const isCrlf = raw.includes('\r\n');
let content = raw.replace(/\r\n/g, '\n');

// 1. Update Razón Social label
const oldLabel = '<label style={{ display: \'block\', fontSize: \'0.675rem\', fontWeight: 700, color: \'#1e40af\', marginBottom: \'0.15rem\' }}>\n                        Razón Social / Nombre Comercial (Opcional)\n                      </label>';
const newLabel = '<label style={{ display: \'block\', fontSize: \'0.675rem\', fontWeight: 700, color: \'#1e40af\', marginBottom: \'0.15rem\' }}>\n                        Razón Social / Nombre Comercial * (Requerido para Crédito Fiscal E31)\n                      </label>';

if (content.includes(oldLabel)) {
  content = content.replace(oldLabel, newLabel);
  console.log('Replaced Razón Social label');
} else {
  console.warn('Could not find oldLabel in VisitRecorder.jsx');
}

// 2. In handleFinalizeCheckout: validate and fallback Razón Social
const oldCheck = `    // If user marked Credito Fiscal checkbox, validate that RNC/Cedula is filled
    if (isCreditoFiscal && !clientRncInput.trim()) {
      alert('⚠️ Por favor ingresa el RNC o Cédula del receptor para emitir la Factura con Crédito Fiscal (E31).');
      return;
    }`;

const newCheck = `    // If user marked Credito Fiscal checkbox, validate that RNC/Cedula is filled and ensure Razón Social
    if (isCreditoFiscal) {
      if (!clientRncInput.trim()) {
        alert('⚠️ Por favor ingresa el RNC o Cédula del receptor para emitir la Factura con Crédito Fiscal (E31).');
        return;
      }
      if (!clientRazonSocialInput.trim()) {
        const fallbackName = clientFound?.nombre || selectedTicket?.client_name;
        if (fallbackName && fallbackName.trim().length >= 3 && !['cliente general', 'invitado'].includes(fallbackName.trim().toLowerCase())) {
          setClientRazonSocialInput(fallbackName.trim());
        } else {
          alert('⚠️ Por favor ingresa la Razón Social del receptor para emitir la Factura de Crédito Fiscal (E31).');
          return;
        }
      }
    }`;

if (content.includes(oldCheck)) {
  content = content.replace(oldCheck, newCheck);
  console.log('Replaced handleFinalizeCheckout RNC/Razón Social validation');
} else {
  console.warn('Could not find oldCheck in VisitRecorder.jsx');
}

// 3. Update catch block in executeCheckout
const oldCatchVR = `      } catch (err) {
        if (err.status === 409 || err.code === 'FISCAL_SEQUENCES_EXHAUSTED' || (err.data && err.data.code === 'FISCAL_SEQUENCES_EXHAUSTED')) {
          setBlockedSequenceInfo({
            tipo_comprobante: err.data?.tipo_comprobante || ncfTypeToSend,
            nombre_comprobante: err.data?.nombre_comprobante || (ncfTypeToSend === 'E31' ? 'Factura de Crédito Fiscal Electrónico (E31)' : 'Factura de Consumo Electrónica (E32)'),
            message: err.data?.message || err.message,
            ticket_id: ticketIdToUse,
            ticket_number: err.data?.ticket_number || selectedTicket?.ticket_number
          });
          setShowBlockedSequenceModal(true);
          await fetchSequenceAvailability();
          await fetchPendingTickets();
          return;
        }
        throw err;
      }`;

const newCatchVR = `      } catch (err) {
        const isFiscalRejection = err.status === 409 || 
          err.code === 'FISCAL_SEQUENCES_EXHAUSTED' || 
          err.code === 'LOTE_AGOTADO' || 
          err.code === 'LOTE_VENCIDO' || 
          err.code === 'LOTE_INACTIVO' || 
          err.code === 'LOTE_NO_AUTORIZADO' || 
          err.code === 'LOTE_INEXISTENTE' || 
          err.code === 'ERROR_CORRESPONDENCIA_TIPO' ||
          (err.data && (err.data.code === 'FISCAL_SEQUENCES_EXHAUSTED' || String(err.data.code || '').startsWith('LOTE_')));

        if (isFiscalRejection) {
          setBlockedSequenceInfo({
            tipo_comprobante: err.data?.tipo_comprobante || ncfTypeToSend,
            nombre_comprobante: err.data?.nombre_comprobante || (ncfTypeToSend === 'E31' ? 'Factura de Crédito Fiscal Electrónico (E31)' : 'Factura de Consumo Electrónica (E32)'),
            message: err.data?.message || err.message,
            code: err.data?.code || err.code,
            ticket_id: ticketIdToUse,
            ticket_number: err.data?.ticket_number || selectedTicket?.ticket_number
          });
          setShowBlockedSequenceModal(true);
          await fetchSequenceAvailability();
          await fetchPendingTickets();
          return;
        }
        throw err;
      }`;

if (content.includes(oldCatchVR)) {
  content = content.replace(oldCatchVR, newCatchVR);
  console.log('Replaced executeCheckout catch block in VisitRecorder.jsx');
} else {
  console.warn('Could not find oldCatchVR in VisitRecorder.jsx');
}

// 4. Update the modal text to render blockedSequenceInfo.message and code
const oldModalMsg = `              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', padding: '1rem', marginBottom: '1.25rem' }}>
                <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: '1.6', fontWeight: 700, color: '#991b1b', whiteSpace: 'pre-line' }}>
                  {\`No hay comprobantes fiscales disponibles.\\n\\nSe agotaron las secuencias autorizadas para este tipo de factura.\\n\\nFavor de notificar al administrador para agregar nuevas secuencias fiscales.\\n\\nPuede guardar o imprimir una precuenta, pero no finalizar la factura ni registrar el cobro.\`}
                </p>
              </div>`;

const newModalMsg = `              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', padding: '1rem', marginBottom: '1.25rem' }}>
                <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: '1.6', fontWeight: 700, color: '#991b1b', whiteSpace: 'pre-line' }}>
                  {blockedSequenceInfo?.message || \`No hay comprobantes fiscales disponibles.\\n\\nSe agotaron las secuencias autorizadas para este tipo de factura.\\n\\nFavor de notificar al administrador para agregar nuevas secuencias fiscales.\\n\\nPuede guardar o imprimir una precuenta, pero no finalizar la factura ni registrar el cobro.\`}
                </p>
                {blockedSequenceInfo?.code && (
                  <div style={{ marginTop: '0.65rem', paddingTop: '0.5rem', borderTop: '1px dashed #fca5a5', fontSize: '0.75rem', fontWeight: 800, color: '#b91c1c' }}>
                    Motivo técnico: <span style={{ fontFamily: 'monospace', background: '#fee2e2', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>[{blockedSequenceInfo.code}]</span>
                  </div>
                )}
              </div>`;

if (content.includes(oldModalMsg)) {
  content = content.replace(oldModalMsg, newModalMsg);
  console.log('Replaced modal message in VisitRecorder.jsx');
} else {
  console.warn('Could not find oldModalMsg in VisitRecorder.jsx');
}

if (isCrlf) {
  content = content.replace(/\n/g, '\r\n');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Finished updating VisitRecorder.jsx');

