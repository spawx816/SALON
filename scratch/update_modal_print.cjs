const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'components', 'common', 'ElectronicInvoicePrintModal.jsx');
let raw = fs.readFileSync(filePath, 'utf8');
const isCrlf = raw.includes('\r\n');
let content = raw.replace(/\r\n/g, '\n');

// Update logic around lines 40-53
const oldMeta = `  const encfNumber = invoice.ncf || \`E32\${String(invoice.ticket_number || invoice.id || '1').replace(/\\D/g, '').padStart(10, '0').slice(-10)}\`;
  const encfName = invoice.ncf_name || (encfNumber.startsWith('E31') ? 'Factura de Crédito Fiscal Electrónica' : 'Factura de Consumo Electrónica');
  const totalVal = Number(invoice.total || 0);
  const securityCode = invoice.codigo_seguridad_ecf || 'S/DqDu';

  const emisorRnc = '131917038';
  const compradorRnc = invoice.rnc_cliente || '';
  const qrUrl = invoice.qr_code_url || (
    encfNumber.startsWith('E32') && totalVal < 250000
      ? \`https://fc.dgii.gov.do/eCF/ConsultaTimbreFC?RncEmisor=\${emisorRnc}&ENCF=\${encfNumber}&MontoTotal=\${totalVal.toFixed(2)}&CodigoSeguridad=\${securityCode}\`
      : \`https://fc.dgii.gov.do/eCF/ConsultaTimbre?RncEmisor=\${emisorRnc}&RncComprador=\${compradorRnc}&ENCF=\${encfNumber}&MontoTotal=\${totalVal.toFixed(2)}&FechaEmision=\${dateFormatted}&FechaFirma=\${dateFormatted}&CodigoSeguridad=\${securityCode}\`
  );`;

const newMeta = `  const isFiscalOfficial = Boolean(invoice.ncf && invoice.status === 'Facturado');
  const encfNumber = isFiscalOfficial ? invoice.ncf : 'SIN COMPROBANTE FISCAL (PRE-CUENTA)';
  const encfName = isFiscalOfficial
    ? (invoice.ncf_name || (invoice.ncf.startsWith('E31') ? 'Factura de Crédito Fiscal Electrónica' : 'Factura de Consumo Electrónica'))
    : 'Precuenta de Servicios (Documento No Fiscal)';
  const totalVal = Number(invoice.total || 0);
  const securityCode = isFiscalOfficial ? (invoice.codigo_seguridad_ecf || 'S/DqDu') : null;

  const emisorRnc = '131917038';
  const compradorRnc = invoice.rnc_cliente || '';
  const qrUrl = isFiscalOfficial
    ? (invoice.qr_code_url || (
        encfNumber.startsWith('E32') && totalVal < 250000
          ? \`https://fc.dgii.gov.do/eCF/ConsultaTimbreFC?RncEmisor=\${emisorRnc}&ENCF=\${encfNumber}&MontoTotal=\${totalVal.toFixed(2)}&CodigoSeguridad=\${securityCode}\`
          : \`https://fc.dgii.gov.do/eCF/ConsultaTimbre?RncEmisor=\${emisorRnc}&RncComprador=\${compradorRnc}&ENCF=\${encfNumber}&MontoTotal=\${totalVal.toFixed(2)}&FechaEmision=\${dateFormatted}&FechaFirma=\${dateFormatted}&CodigoSeguridad=\${securityCode}\`
      ))
    : \`https://planbeauty.app/tickets/\${invoice.ticket_number || invoice.id}\`;`;

if (content.includes(oldMeta)) {
  content = content.replace(oldMeta, newMeta);
  console.log('Replaced metadata section in ElectronicInvoicePrintModal');
} else {
  console.warn('oldMeta not found in ElectronicInvoicePrintModal');
}

// Update section 2: Tipo de comprobante
const oldSec2 = `            {/* 2. TIPO DE COMPROBANTE Y E-NCF */}
            <div style={{ margin: '4px 0' }}>
              <div style={{ fontWeight: 900, fontSize: '10px' }}>{encfName}</div>
              <div style={{ fontWeight: 900, fontSize: '11px', letterSpacing: '0.5px' }}>
                e-NCF: {encfNumber}
              </div>
            </div>`;

const newSec2 = `            {/* 2. TIPO DE COMPROBANTE Y E-NCF */}
            <div style={{ margin: '4px 0' }}>
              <div style={{ fontWeight: 900, fontSize: '10px' }}>{encfName}</div>
              <div style={{ fontWeight: 900, fontSize: '11px', letterSpacing: '0.5px' }}>
                {isFiscalOfficial ? \`e-NCF: \${encfNumber}\` : '*** DOCUMENTO NO FISCAL ***'}
              </div>
              {!isFiscalOfficial && (
                <div style={{ fontSize: '7.5px', color: '#b91c1c', fontWeight: 700, marginTop: '2px' }}>
                  Pendiente de Facturar ante la DGII
                </div>
              )}
            </div>`;

if (content.includes(oldSec2)) {
  content = content.replace(oldSec2, newSec2);
  console.log('Replaced section 2 in ElectronicInvoicePrintModal');
}

// Update QR section and disclaimer
const oldQrSec = `            {/* 7. QR CODE OFICIAL DGII Y CÓDIGO DE SEGURIDAD */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '8px 0 4px' }}>
              <div style={{ background: '#ffffff', padding: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <QRCodeSVG value={qrUrl} size={68} level="M" />
              </div>
              <div style={{ fontSize: '8px', fontWeight: 800, marginTop: '5px', textAlign: 'center' }}>
                Código de Seguridad: {securityCode}<br />
                Fecha Firma: {dateFormatted} {timeFormatted}
              </div>
            </div>

            {/* 8. LEYENDA OFICIAL DE REPRESENTACIÓN IMPRESA */}
            <div style={{ fontSize: '7px', textAlign: 'center', color: '#4b5563', marginTop: '6px', lineHeight: '1.2' }}>
              *Este documento es una Representación Impresa (RI) de un Comprobante Fiscal Electrónico (e-CF) certificado por la DGII.
            </div>`;

const newQrSec = `            {/* 7. QR CODE OFICIAL DGII Y CÓDIGO DE SEGURIDAD */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '8px 0 4px' }}>
              <div style={{ background: '#ffffff', padding: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <QRCodeSVG value={qrUrl} size={68} level="M" />
              </div>
              {isFiscalOfficial ? (
                <div style={{ fontSize: '8px', fontWeight: 800, marginTop: '5px', textAlign: 'center' }}>
                  Código de Seguridad: {securityCode}<br />
                  Fecha Firma: {dateFormatted} {timeFormatted}
                </div>
              ) : (
                <div style={{ fontSize: '8px', fontWeight: 700, color: '#6b7280', marginTop: '5px', textAlign: 'center' }}>
                  Comprobante Interno Provisional<br />
                  Fecha Emisión: {dateFormatted} {timeFormatted}
                </div>
              )}
            </div>

            {/* 8. LEYENDA OFICIAL O PRECUENTA */}
            <div style={{ fontSize: '7px', textAlign: 'center', color: '#4b5563', marginTop: '6px', lineHeight: '1.2' }}>
              {isFiscalOfficial
                ? '*Este documento es una Representación Impresa (RI) de un Comprobante Fiscal Electrónico (e-CF) certificado por la DGII.'
                : '*Este documento es una pre-cuenta interna sin valor tributario ante la DGII. Válido únicamente como detalle informativo.'
              }
            </div>`;

if (content.includes(oldQrSec)) {
  content = content.replace(oldQrSec, newQrSec);
  console.log('Replaced QR section in ElectronicInvoicePrintModal');
}

// Update print button text
content = content.replace(
  '<span>Imprimir Factura e-CF</span>',
  '<span>{isFiscalOfficial ? "Imprimir Factura e-CF" : "Imprimir Precuenta Provisional"}</span>'
);

if (isCrlf) {
  content = content.replace(/\n/g, '\r\n');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Finished updating ElectronicInvoicePrintModal.jsx');

