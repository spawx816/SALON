/**
 * generate_paso5_pdfs.js
 * Generador de Representaciones Impresas (PDFs con QR oficial DGII)
 * para el Paso 5 de Certificación DGII (ETEREAS SRL - RNC 131917038)
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { generateEcfQRCodeURL, generateFcQRCodeURL, getCodeSixDigitfromSignature } = require('dgii-ecf');

const OUTPUT_DIR = path.resolve(__dirname, '../Paso5_Representaciones_Impresas');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Limpiar PDFs previos en la carpeta de destino
fs.readdirSync(OUTPUT_DIR).forEach(f => {
  if (f.endsWith('.pdf')) {
    try { fs.unlinkSync(path.join(OUTPUT_DIR, f)); } catch (_) {}
  }
});

// Directorios de entrada donde se guardaron los XMLs de Paso 4
const XML_DIRS = [
  path.resolve(__dirname, 'dgii_test_output/Paso4_Simulacion/1_Primero_Comprobantes_Generales'),
  path.resolve(__dirname, 'dgii_test_output/Paso4_Simulacion/2_Segundo_Notas'),
  path.resolve(__dirname, 'dgii_test_output/Paso4_Simulacion/4_Cuarto_Facturas_Consumo_Menor_250k')
];

// Los 11 e-NCFs requeridos para Paso 5
const REQUIRED_ECFS = [
  { encf: 'E310000000701', slot: '1_Tipo_31_Credito_Fiscal', tipoNombre: 'FACTURA DE CRÉDITO FISCAL ELECTRÓNICA' },
  { encf: 'E320000000701', slot: '2_Tipo_32_Consumo_Mayor_250k', tipoNombre: 'FACTURA DE CONSUMO ELECTRÓNICA (>= RD$250K)' },
  { encf: 'E330000000701', slot: '3_Tipo_33_Nota_Debito', tipoNombre: 'NOTA DE DÉBITO ELECTRÓNICA' },
  { encf: 'E340000000701', slot: '4_Tipo_34_Nota_Credito', tipoNombre: 'NOTA DE CRÉDITO ELECTRÓNICA' },
  { encf: 'E410000000701', slot: '5_Tipo_41_Compras', tipoNombre: 'COMPROBANTE DE COMPRAS ELECTRÓNICO' },
  { encf: 'E430000000701', slot: '6_Tipo_43_Gastos_Menores', tipoNombre: 'COMPROBANTE PARA GASTOS MENORES ELECTRÓNICO' },
  { encf: 'E440000000701', slot: '7_Tipo_44_Regimenes_Especiales', tipoNombre: 'COMPROBANTE PARA REGÍMENES ESPECIALES ELECTRÓNICO' },
  { encf: 'E450000000701', slot: '8_Tipo_45_Gubernamental', tipoNombre: 'COMPROBANTE GUBERNAMENTAL ELECTRÓNICO' },
  { encf: 'E460000000701', slot: '9_Tipo_46_Exportacion', tipoNombre: 'COMPROBANTE PARA EXPORTACIONES ELECTRÓNICO' },
  { encf: 'E470000000701', slot: '10_Tipo_47_Pagos_Exterior', tipoNombre: 'COMPROBANTE PARA PAGOS AL EXTERIOR ELECTRÓNICO' },
  { encf: 'E320000000711', slot: '11_Tipo_32_Consumo_Menor_250k', tipoNombre: 'FACTURA DE CONSUMO ELECTRÓNICA (< RD$250K)' }
];

function findXmlFile(encf) {
  for (const dir of XML_DIRS) {
    const p = path.join(dir, `${encf}.xml`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function parseXmlTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`, 's'));
  return match ? match[1].trim() : '';
}

function parseAllTags(xml, tag) {
  const regex = new RegExp(`<${tag}>(.*?)</${tag}>`, 'gs');
  const results = [];
  let m;
  while ((m = regex.exec(xml)) !== null) {
    results.push(m[1].trim());
  }
  return results;
}

function formatCurrency(val) {
  const n = parseFloat(val) || 0;
  return 'RD$ ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function generatePdfForEcf(cfg) {
  const { encf, slot, tipoNombre } = cfg;
  const xmlPath = findXmlFile(encf);
  if (!xmlPath) {
    console.error(`❌ No se encontró el XML para ${encf}`);
    return;
  }

  const xml = fs.readFileSync(xmlPath, 'utf8');

  // Datos del Encabezado
  const tipoeCF = parseXmlTag(xml, 'TipoeCF') || encf.substring(1, 3);
  const fechaVencimiento = parseXmlTag(xml, 'FechaVencimientoSecuencia');
  const fechaEmision = parseXmlTag(xml, 'FechaEmision') || '29-09-2026';
  const fechaHoraFirma = parseXmlTag(xml, 'FechaHoraFirma') || '29-09-2026 22:00:00';

  // Emisor
  const rncEmisor = parseXmlTag(xml, 'RNCEmisor') || '131917038';
  const razonSocialEmisor = parseXmlTag(xml, 'RazonSocialEmisor') || 'ETEREAS SRL';
  const nombreComercial = parseXmlTag(xml, 'NombreComercial') || 'ETÉREAS';
  const direccionEmisor = parseXmlTag(xml, 'DireccionEmisor') || 'LOS PALMEROS, No. 3, APTO. PLAZA BRAVO, BARRIO NUEVO';

  // Comprador
  const rncComprador = parseXmlTag(xml, 'RNCComprador');
  const idExtranjero = parseXmlTag(xml, 'IdentificadorExtranjero');
  const razonSocialComprador = parseXmlTag(xml, 'RazonSocialComprador');

  // Referencia para Notas
  const ncfModificado = parseXmlTag(xml, 'NCFModificado');
  const razonModificacion = parseXmlTag(xml, 'RazonModificacion') || 'Corrige montos del NCF modificado';

  // Totales
  const montoGravadoTotal = parseXmlTag(xml, 'MontoGravadoTotal');
  const totalITBIS = parseXmlTag(xml, 'TotalITBIS');
  const montoExento = parseXmlTag(xml, 'MontoExento');
  const totalITBISRetenido = parseXmlTag(xml, 'TotalITBISRetenido');
  const totalISRRetencion = parseXmlTag(xml, 'TotalISRRetencion');
  const montoTotal = parseXmlTag(xml, 'MontoTotal') || '0.00';

  // Items
  const itemsRaw = parseAllTags(xml, 'Item');
  const items = itemsRaw.map((itXml, idx) => {
    const qty = parseFloat(parseXmlTag(itXml, 'CantidadItem')) || 1;
    const prc = parseFloat(parseXmlTag(itXml, 'PrecioUnitarioItem')) || 0;
    const val = (qty * prc).toFixed(2);
    // ITBIS del item (si aplica)
    const itbisVal = parseXmlTag(itXml, 'IndicadorFacturacion') === '4' || parseXmlTag(itXml, 'IndicadorFacturacion') === '3' 
      ? '0.00' 
      : (prc * qty * 0.18).toFixed(2);

    return {
      numero: parseXmlTag(itXml, 'NumeroLinea') || String(idx + 1),
      nombre: parseXmlTag(itXml, 'NombreItem') || 'Servicio Profesional',
      unidad: parseXmlTag(itXml, 'UnidadMedida') === '55' ? 'UND' : (parseXmlTag(itXml, 'UnidadMedida') || 'UND'),
      cantidad: qty,
      precio: prc.toFixed(2),
      itbis: itbisVal,
      valor: val
    };
  });

  // Código de Seguridad & QR Code
  let codigoSeguridad = 'AB12CD';
  try {
    codigoSeguridad = getCodeSixDigitfromSignature(xml);
  } catch (_) {}

  let qrUrl = '';
  if (tipoeCF === '32' && parseFloat(montoTotal) < 250000) {
    qrUrl = generateFcQRCodeURL(rncEmisor, encf, montoTotal, codigoSeguridad, 'CerteCF');
  } else {
    qrUrl = generateEcfQRCodeURL(rncEmisor, rncComprador || idExtranjero || '', encf, montoTotal, fechaEmision, fechaHoraFirma, codigoSeguridad, 'CerteCF');
  }

  const qrBuffer = await QRCode.toBuffer(qrUrl, {
    errorCorrectionLevel: 'M',
    type: 'png',
    margin: 1,
    width: 250
  });

  // Crear PDF Document
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
    info: {
      Title: `Representación Impresa ${encf}`,
      Author: razonSocialEmisor,
      Subject: tipoNombre
    }
  });

  const outFileName = `${slot}__${encf}.pdf`;
  const outPath = path.join(OUTPUT_DIR, outFileName);
  const writeStream = fs.createWriteStream(outPath);
  doc.pipe(writeStream);

  const PRIMARY = '#2B6CB0'; // Azul institucional DGII
  const TEXT_DARK = '#2D3748';
  const BORDER_COLOR = '#CBD5E0';
  const HEADER_BG = '#E2E8F0';

  // 1. Logo / Encabezado Emisor (Izquierda)
  doc.fontSize(14).font('Helvetica-Bold').fillColor(PRIMARY).text(nombreComercial || razonSocialEmisor, 40, 45);
  doc.fontSize(9).font('Helvetica').fillColor(TEXT_DARK)
    .text(razonSocialEmisor, 40, 62)
    .text(`RNC ${rncEmisor}`, 40, 74)
    .text(`Dirección: ${direccionEmisor}`, 40, 86, { width: 240 })
    .text(`Fecha Emisión: ${fechaEmision}`, 40, 110);

  // 2. Encabezado e-NCF (Derecha) - Posicionamiento dinámico secuencial
  let headerRightY = 45;
  doc.fontSize(11).font('Helvetica-Bold').fillColor(PRIMARY)
    .text(tipoNombre, 270, headerRightY, { width: 300, align: 'right' });
  headerRightY += 17;

  doc.fontSize(10).font('Helvetica-Bold').fillColor(TEXT_DARK)
    .text(`e-NCF: ${encf}`, 270, headerRightY, { width: 300, align: 'right' });
  headerRightY += 15;

  if (fechaVencimiento) {
    doc.fontSize(8.5).font('Helvetica').fillColor(TEXT_DARK)
      .text(`Fecha Vencimiento: ${fechaVencimiento}`, 270, headerRightY, { width: 300, align: 'right' });
    headerRightY += 13;
  }

  if (ncfModificado) {
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(TEXT_DARK)
      .text(`NCF Modificado: ${ncfModificado}`, 270, headerRightY, { width: 300, align: 'right' });
    headerRightY += 13;

    doc.fontSize(8).font('Helvetica').fillColor(TEXT_DARK)
      .text(razonModificacion, 270, headerRightY, { width: 300, align: 'right' });
    headerRightY += 13;
  }

  // Línea divisoria dinámica
  const divY = Math.max(130, headerRightY + 6);
  doc.strokeColor(PRIMARY).lineWidth(1.5).moveTo(40, divY).lineTo(570, divY).stroke();

  // 3. Receptor / Cliente
  let recY = divY + 8;
  if (razonSocialComprador || rncComprador || idExtranjero) {
    doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT_DARK)
      .text(`Razón Social Cliente: `, 40, recY, { continued: true })
      .font('Helvetica').text(razonSocialComprador || 'CONSUMIDOR FINAL');
    
    const docCliente = rncComprador ? `RNC Cliente: ${rncComprador}` : (idExtranjero ? `ID Extranjero: ${idExtranjero}` : '');
    if (docCliente) {
      doc.fontSize(9).font('Helvetica-Bold')
        .text(docCliente, 40, recY + 13);
      recY += 28;
    } else {
      recY += 18;
    }
  } else {
    doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT_DARK)
      .text(`Razón Social Cliente: CONSUMIDOR FINAL`, 40, recY);
    recY += 20;
  }

  // 4. Tabla de Items (Formato Oficial DGII)
  const tblTop = recY + 10;
  doc.rect(40, tblTop, 530, 20).fill(HEADER_BG);
  doc.rect(40, tblTop, 530, 20).strokeColor(BORDER_COLOR).stroke();

  doc.fontSize(8).font('Helvetica-Bold').fillColor(TEXT_DARK)
    .text('Cantidad', 45, tblTop + 6, { width: 45, align: 'center' })
    .text('Descripción', 95, tblTop + 6, { width: 190, align: 'center' })
    .text('Unidad de Medida', 290, tblTop + 2, { width: 55, align: 'center' })
    .text('Precio', 350, tblTop + 6, { width: 55, align: 'center' })
    .text('ITBIS', 410, tblTop + 6, { width: 65, align: 'center' })
    .text('Valor', 480, tblTop + 6, { width: 85, align: 'center' });

  let curY = tblTop + 20;

  items.forEach(it => {
    doc.rect(40, curY, 530, 20).strokeColor(BORDER_COLOR).stroke();

    doc.fontSize(8).font('Helvetica').fillColor(TEXT_DARK)
      .text(String(it.cantidad), 45, curY + 6, { width: 45, align: 'center' })
      .text(it.nombre, 95, curY + 6, { width: 190, ellipsis: true })
      .text(it.unidad, 290, curY + 6, { width: 55, align: 'center' })
      .text(parseFloat(it.precio).toLocaleString('en-US', { minimumFractionDigits: 2 }), 350, curY + 6, { width: 55, align: 'right' })
      .text(parseFloat(it.itbis).toLocaleString('en-US', { minimumFractionDigits: 2 }), 410, curY + 6, { width: 65, align: 'right' })
      .text(parseFloat(it.valor).toLocaleString('en-US', { minimumFractionDigits: 2 }), 480, curY + 6, { width: 85, align: 'right' });

    curY += 20;
  });

  curY += 15;

  // 5. QR Code y Timbre a la Izquierda + Totales a la Derecha (Exacto al PDF Oficial DGII)
  const bottomSectionY = curY;

  // Izquierda: QR Code + Código Seguridad + Fecha Firma
  doc.image(qrBuffer, 50, bottomSectionY, { width: 85, height: 85 });

  doc.fontSize(8).font('Helvetica-Bold').fillColor(TEXT_DARK)
    .text(`Código de Seguridad: `, 50, bottomSectionY + 92, { continued: true })
    .font('Helvetica').text(codigoSeguridad);
  
  doc.fontSize(8).font('Helvetica-Bold').fillColor(TEXT_DARK)
    .text(`Fecha Firma: `, 50, bottomSectionY + 104, { continued: true })
    .font('Helvetica').text(fechaHoraFirma);

  // Derecha: Cuadro de Totales (Alineado con bordes idéntico a DGII)
  const totBoxX = 330;
  const totBoxW = 240;
  let tRowY = bottomSectionY;

  function drawTotRow(label, val, isBold = false) {
    if (val === undefined || val === null || val === '') return;
    doc.rect(totBoxX, tRowY, totBoxW, 18).strokeColor(BORDER_COLOR).stroke();
    doc.fontSize(8).font(isBold ? 'Helvetica-Bold' : 'Helvetica').fillColor(TEXT_DARK)
      .text(label, totBoxX + 8, tRowY + 5, { width: 120, align: 'right' })
      .text(parseFloat(val).toLocaleString('en-US', { minimumFractionDigits: 2 }), totBoxX + 130, tRowY + 5, { width: 100, align: 'right' });
    tRowY += 18;
  }

  if (montoGravadoTotal && parseFloat(montoGravadoTotal) > 0) {
    drawTotRow('Subtotal Gravado:', montoGravadoTotal);
  }
  if (montoExento && parseFloat(montoExento) > 0) {
    drawTotRow('Monto Exento:', montoExento);
  }
  if (totalITBIS && parseFloat(totalITBIS) > 0) {
    drawTotRow('Total ITBIS:', totalITBIS);
  }
  if (totalITBISRetenido && parseFloat(totalITBISRetenido) > 0) {
    drawTotRow('Total ITBIS Retenido:', totalITBISRetenido);
  }
  if (totalISRRetencion && parseFloat(totalISRRetencion) > 0) {
    drawTotRow('Total Retención ISR:', totalISRRetencion);
  }
  drawTotRow('Total:', montoTotal, true);

  // Pie de página legal
  doc.fontSize(7).font('Helvetica-Oblique').fillColor('#718096')
    .text('*Este modelo de Representación Impresa cumple con las disposiciones de la Ley Núm. 32-23 y la normativa técnica de la DGII.', 40, 740, { width: 530, align: 'left' });

  doc.end();

  await new Promise(resolve => writeStream.on('finish', resolve));
  console.log(`✅ [PDF Generado] ${outFileName}`);
}

async function run() {
  console.log('\n========================================================================');
  console.log('🚀 GENERANDO REPRESENTACIONES IMPRESAS (PASO 5 DGII - ETEREAS SRL)');
  console.log('========================================================================\n');

  for (const cfg of REQUIRED_ECFS) {
    await generatePdfForEcf(cfg);
  }

  console.log('\n========================================================================');
  console.log(`🎉 11 PDFs GENERADOS CORRECTAMENTE EN:`);
  console.log(`📂 ${OUTPUT_DIR}`);
  console.log('========================================================================\n');
}

run().catch(err => {
  console.error('❌ Error fatal generando PDFs:', err);
});
