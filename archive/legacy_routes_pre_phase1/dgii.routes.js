const express = require('express');

let PDFDocument = null;
try { PDFDocument = require('pdfkit'); } catch(e) { console.warn('pdfkit optional require notice in dgii.routes:', e.message); }
let QRCode = null;
try { QRCode = require('qrcode'); } catch(e) { console.warn('qrcode optional require notice in dgii.routes:', e.message); }
let dgiiEcfLib = {};
try { dgiiEcfLib = require('dgii-ecf'); } catch(e) { console.warn('dgii-ecf optional require notice in dgii.routes:', e.message); }
const { getCodeSixDigitfromSignature, generateEcfQRCodeURL, generateFcQRCodeURL } = dgiiEcfLib;

/**
 * Robust, centralized payment method breakdown parser for DGII 607 / e-CF compliance.
 * Works with integer cents to eliminate floating-point precision issues.
 *
 * @param {string|null|undefined} metodoPagoRaw - Legacy string representation of payment method(s)
 * @param {number|string|null|undefined} totalAmount - Total amount of the transaction
 * @param {Array|string|null|undefined} appliedPayments - Structured payments array if available
 * @returns {{
 *   efectivo: number,
 *   tarjeta: number,
 *   transferencia: number,
 *   bonos: number,
 *   otras: number,
 *   sumTotal: number,
 *   isValid: boolean,
 *   discrepancyCents: number,
 *   cents: { efectivo: number, tarjeta: number, transferencia: number, bonos: number, otras: number, total: number }
 * }}
 */
function extractPaymentBreakdown(metodoPagoRaw, totalAmount, appliedPayments = null) {
  const totalNum = Number(totalAmount || 0);
  const totalCents = Math.round((isNaN(totalNum) ? 0 : totalNum) * 100);

  let efectivoCents = 0;
  let tarjetaCents = 0;
  let transfCents = 0;
  let bonosCents = 0;
  let otrasCents = 0;

  // Helper to parse amount string into integer cents
  const parseAmountToCents = (str) => {
    if (!str) return 0;
    const clean = String(str).replace(/,/g, '').trim();
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : Math.round(num * 100);
  };

  // 1. Prioritize structured data if provided
  let structured = null;
  if (Array.isArray(appliedPayments) && appliedPayments.length > 0) {
    structured = appliedPayments;
  } else if (typeof appliedPayments === 'string' && appliedPayments.trim()) {
    try {
      const parsed = JSON.parse(appliedPayments);
      if (Array.isArray(parsed) && parsed.length > 0) structured = parsed;
    } catch (_) {}
  }

  if (structured && structured.length > 0) {
    for (const p of structured) {
      const amtCents = Math.round(Number(p.amount || 0) * 100);
      if (amtCents <= 0) continue;
      const m = String(p.method || '').toLowerCase();
      if (m.includes('efectivo') || m.includes('cash')) {
        efectivoCents += amtCents;
      } else if (m.includes('tarjeta') || m.includes('card') || m.includes('cardnet') || m.includes('pos') || m.includes('visa') || m.includes('mastercard')) {
        tarjetaCents += amtCents;
      } else if (m.includes('transf') || m.includes('transferencia') || m.includes('cheque') || m.includes('deposito')) {
        transfCents += amtCents;
      } else if (m.includes('bono') || m.includes('gift') || m.includes('certificado')) {
        bonosCents += amtCents;
      } else {
        otrasCents += amtCents;
      }
    }
  } else {
    // 2. Parse legacy string
    const raw = String(metodoPagoRaw || '').trim();
    const lower = raw.toLowerCase();

    if (!raw || totalCents <= 0) {
      // Nothing to distribute
    } else if (lower.includes('mixto')) {
      // Robust regex for multiple parts
      const efMatch = raw.match(/Efectivo:\s*RD\$\s*([\d,.]+)/i);
      const tjMatch = raw.match(/Tarjeta:\s*RD\$\s*([\d,.]+)/i);
      const trMatch = raw.match(/Transferencia:\s*RD\$\s*([\d,.]+)/i);
      const bnMatch = raw.match(/(?:Gift\s*Card|Bono|Certificado):\s*RD\$\s*([\d,.]+)/i);
      const chMatch = raw.match(/Cheque:\s*RD\$\s*([\d,.]+)/i);
      const otMatch = raw.match(/Otr[ao]s?:\s*RD\$\s*([\d,.]+)/i);

      if (efMatch) efectivoCents += parseAmountToCents(efMatch[1]);
      if (tjMatch) tarjetaCents += parseAmountToCents(tjMatch[1]);
      if (trMatch) transfCents += parseAmountToCents(trMatch[1]);
      if (bnMatch) bonosCents += parseAmountToCents(bnMatch[1]);
      if (chMatch) transfCents += parseAmountToCents(chMatch[1]);
      if (otMatch) otrasCents += parseAmountToCents(otMatch[1]);
    } else {
      // Direct methods
      if (lower.includes('efectivo') || lower.includes('cash')) {
        efectivoCents = totalCents;
      } else if (lower.includes('tarjeta') || lower.includes('card') || lower.includes('cardnet') || lower.includes('pos')) {
        tarjetaCents = totalCents;
      } else if (lower.includes('transf') || lower.includes('transferencia') || lower.includes('cheque') || lower.includes('deposito')) {
        transfCents = totalCents;
      } else if (lower.includes('bono') || lower.includes('gift') || lower.includes('certificado')) {
        bonosCents = totalCents;
      } else if (lower.includes('plan') || lower.includes('canje') || lower.includes('membres')) {
        // Canjes de membresía (RD$ 0 o bonos)
        bonosCents = totalCents;
      } else {
        // Condition 7: Do NOT default unknown methods to cash!
        otrasCents = totalCents;
      }
    }
  }

  const sumCents = efectivoCents + tarjetaCents + transfCents + bonosCents + otrasCents;
  const discrepancyCents = Math.abs(totalCents - sumCents);
  const isValid = (discrepancyCents === 0);

  return {
    efectivo: efectivoCents / 100,
    tarjeta: tarjetaCents / 100,
    transferencia: transfCents / 100,
    bonos: bonosCents / 100,
    otras: otrasCents / 100,
    sumTotal: sumCents / 100,
    isValid,
    discrepancyCents,
    cents: {
      efectivo: efectivoCents,
      tarjeta: tarjetaCents,
      transferencia: transfCents,
      bonos: bonosCents,
      otras: otrasCents,
      total: totalCents
    }
  };
}


/**
 * DGII Electronic Invoicing, Sequences, Credit Notes & 607 Report Router
 * 
 * @param {import('mysql2/promise').Pool} pool
 * @param {Object} helpers
 */
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

  const alertaMinima = Number(seq.alerta_minima !== undefined && seq.alerta_minima !== null ? seq.alerta_minima : 2);
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

  const activeRows = rowsForType.filter(r => r.estado !== 'Inactivo');
  const allExpired = activeRows.length > 0 && activeRows.every(r => r.fecha_vencimiento && new Date(r.fecha_vencimiento) < now);
  if (allExpired) {
    return {
      code: 'LOTE_VENCIDO',
      message: `Las secuencias fiscales autorizadas para ${targetType} se encuentran vencidas ante la DGII.`
    };
  }

  return {
    code: 'LOTE_AGOTADO',
    message: `Se agotaron los comprobantes fiscales disponibles. No quedan secuencias en el rango autorizado para ${targetType}.`
  };
}


function createDgiiRouter(pool, helpers = {}) {
  const router = express.Router();
  const { allocateNextDgiiSequence, buildAndSignNotaCreditoXml, generateAndTransmitNotaCredito } = helpers;

  async function generateNotaCreditoPdf(visit, items, signedXml, fechaEmision, fechaHoraFirma, voidReason) {
    const encf = visit.ncf_nota_credito || 'E340000000001';
    const ncfModificado = visit.ncf || 'B0200000001';
    const total = Number(visit.total || 0);
    const rncEmisor = '131917038';
    const razonSocialEmisor = 'ETEREAS SRL';
    const nombreComercial = 'ETÉREAS';
    const direccionEmisor = 'LOS PALMEROS, No. 3, APTO. PLAZA BRAVO, BARRIO NUEVO';
    const rncComprador = visit.rnc_cliente || '';
    const idExtranjero = visit.id_extranjero || '';
    const razonSocialComprador = visit.rzn_soc_cliente || visit.client_name || '';

    let codigoSeguridad = 'AB12CD';
    if (signedXml && typeof getCodeSixDigitfromSignature === 'function') {
      try {
        codigoSeguridad = getCodeSixDigitfromSignature(signedXml);
      } catch (_) {}
    }

    let qrUrl = '';
    if (typeof generateEcfQRCodeURL === 'function') {
      qrUrl = generateEcfQRCodeURL(rncEmisor, rncComprador || idExtranjero || '', encf, total.toFixed(2), fechaEmision, fechaHoraFirma, codigoSeguridad, 'eCF');
    } else {
      qrUrl = `https://ecf.dgii.gov.do/eCF/ConsultaTimbre?RncEmisor=${rncEmisor}&RncComprador=${rncComprador}&ENCF=${encf}&MontoTotal=${total.toFixed(2)}&FechaEmision=${fechaEmision}&FechaFirma=${encodeURIComponent(fechaHoraFirma)}&CodigoSeguridad=${encodeURIComponent(codigoSeguridad)}`;
    }

    let qrBuffer = null;
    if (QRCode) {
      try {
        qrBuffer = await QRCode.toBuffer(qrUrl, { errorCorrectionLevel: 'L', type: 'png', margin: 2, width: 300 });
      } catch(e){}
    }

    return new Promise((resolve, reject) => {
      if (!PDFDocument) return reject(new Error('PDFDocument no disponible en el servidor'));
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 40, bottom: 40, left: 40, right: 40 },
        info: {
          Title: `Representación Impresa ${encf}`,
          Author: razonSocialEmisor,
          Subject: 'Nota de Crédito Electrónica (e-NC)'
        }
      });

      const buffers = [];
      doc.on('data', b => buffers.push(b));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const PRIMARY = '#2B6CB0'; // Azul institucional DGII homologado
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
        .text('NOTA DE CRÉDITO ELECTRÓNICA', 270, headerRightY, { width: 300, align: 'right' });
      headerRightY += 17;

      doc.fontSize(10).font('Helvetica-Bold').fillColor(TEXT_DARK)
        .text(`e-NCF: ${encf}`, 270, headerRightY, { width: 300, align: 'right' });
      headerRightY += 15;

      doc.fontSize(8.5).font('Helvetica').fillColor(TEXT_DARK)
        .text(`Fecha Vencimiento: 31-12-2028`, 270, headerRightY, { width: 300, align: 'right' });
      headerRightY += 13;

      if (ncfModificado) {
        doc.fontSize(8.5).font('Helvetica-Bold').fillColor(TEXT_DARK)
          .text(`NCF Modificado: ${ncfModificado}`, 270, headerRightY, { width: 300, align: 'right' });
        headerRightY += 13;

        doc.fontSize(8).font('Helvetica').fillColor(TEXT_DARK)
          .text(voidReason || 'Error de cobro / método de pago', 270, headerRightY, { width: 300, align: 'right' });
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

      const itemList = (items && items.length > 0) ? items : [{ nombre: 'Servicios de Peluquería / Estética', precioAplicado: total, cantidad: 1 }];

      itemList.forEach(it => {
        const qty = parseFloat(it.cantidad || 1);
        const prc = parseFloat(it.precioAplicado || it.precio || 0);
        const itbisVal = parseFloat(it.itbis || 0);
        const val = parseFloat(it.valor || (qty * prc));

        doc.rect(40, curY, 530, 20).strokeColor(BORDER_COLOR).stroke();

        doc.fontSize(8).font('Helvetica').fillColor(TEXT_DARK)
          .text(String(qty), 45, curY + 6, { width: 45, align: 'center' })
          .text(it.nombre || it.service_name || 'Servicio Profesional', 95, curY + 6, { width: 190, ellipsis: true })
          .text(it.unidad || 'UND', 290, curY + 6, { width: 55, align: 'center' })
          .text(prc.toLocaleString('en-US', { minimumFractionDigits: 2 }), 350, curY + 6, { width: 55, align: 'right' })
          .text(itbisVal.toLocaleString('en-US', { minimumFractionDigits: 2 }), 410, curY + 6, { width: 65, align: 'right' })
          .text(val.toLocaleString('en-US', { minimumFractionDigits: 2 }), 480, curY + 6, { width: 85, align: 'right' });

        curY += 20;
      });

      curY += 15;

      // 5. QR Code y Timbre a la Izquierda + Totales a la Derecha (Exacto al PDF Oficial DGII)
      const bottomSectionY = curY;

      if (qrBuffer) {
        doc.image(qrBuffer, 50, bottomSectionY, { width: 85, height: 85 });
      }

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

      drawTotRow('Monto Exento:', total);
      drawTotRow('Total:', total, true);

      // Pie de página legal
      doc.fontSize(7).font('Helvetica-Oblique').fillColor('#718096')
        .text('*Este modelo de Representación Impresa cumple con las disposiciones de la Ley Núm. 32-23 y la normativa técnica de la DGII.', 40, 740, { width: 530, align: 'left' });

      doc.end();
    });
  }

// === DGII NOTAS DE CRÉDITO API ===
router.get('/credit-notes', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        v.id,
        v.ticket_number,
        v.client_id,
        v.client_name,
        v.rnc_cliente,
        v.rzn_soc_cliente,
        COALESCE(v.rnc_cliente, '') as cedula,
        v.ncf,
        v.ncf_type,
        v.ncf_nota_credito,
        v.nota_credito_motivo,
        v.nota_credito_fecha,
        v.nota_credito_track_id,
        v.void_reason,
        v.voided_by,
        v.voided_at,
        v.total,
        v.metodo_pago,
        v.items_detail,
        v.servicios,
        v.status,
        v.visited_at
      FROM visits v
      WHERE (v.ncf_nota_credito IS NOT NULL AND TRIM(v.ncf_nota_credito) != '')
         OR (v.status = 'Anulado' AND v.ncf IS NOT NULL AND TRIM(v.ncf) != '' AND v.ncf != 'NONE')
      ORDER BY COALESCE(v.nota_credito_fecha, v.voided_at, v.visited_at) DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('[API GET CREDIT NOTES ERROR]:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/credit-notes/:id/pdf', async (req, res) => {
  try {
    const { id } = req.params;
    const [visits] = await pool.query('SELECT * FROM visits WHERE id = ?', [id]);
    if (!visits.length) return res.status(404).json({ error: 'Nota de crédito no encontrada' });
    const visit = visits[0];

    let items = [];
    try {
      items = typeof visit.items_detail === 'string' ? JSON.parse(visit.items_detail) : (visit.items_detail || []);
    } catch(e){}
    if (!items.length && visit.servicios) {
      const srvs = typeof visit.servicios === 'string' && visit.servicios.startsWith('[') ? JSON.parse(visit.servicios) : (Array.isArray(visit.servicios) ? visit.servicios : [visit.servicios]);
      items = srvs.map(s => ({ nombre: s, precioAplicado: visit.total, cantidad: 1 }));
    }

    let encfE34 = visit.ncf_nota_credito;
    if (!encfE34) {
      encfE34 = await allocateNextDgiiSequence('E34') || 'E340000000001';
      await pool.query('UPDATE visits SET ncf_nota_credito = ? WHERE id = ?', [encfE34, visit.id]);
      visit.ncf_nota_credito = encfE34;
    }

    const voidReason = visit.nota_credito_motivo || visit.void_reason || 'Anulación Total de Factura';
    const { signedXml, fechaEmision, fechaHoraFirma } = buildAndSignNotaCreditoXml(visit, encfE34, voidReason, items);
    const pdfBuffer = await generateNotaCreditoPdf(visit, items, signedXml, fechaEmision, fechaHoraFirma, voidReason);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="NotaCredito_${encfE34}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[CREDIT NOTE PDF ERROR]:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/credit-notes/:id/xml', async (req, res) => {
  try {
    const { id } = req.params;
    const [visits] = await pool.query('SELECT * FROM visits WHERE id = ?', [id]);
    if (!visits.length) return res.status(404).json({ error: 'Nota de crédito no encontrada' });
    const visit = visits[0];

    if (visit.nota_credito_xml) {
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', `attachment; filename="${visit.ncf_nota_credito || 'NotaCredito'}.xml"`);
      return res.send(visit.nota_credito_xml);
    }

    let items = [];
    try {
      items = typeof visit.items_detail === 'string' ? JSON.parse(visit.items_detail) : (visit.items_detail || []);
    } catch(e){}

    const encfE34 = visit.ncf_nota_credito || 'E340000000001';
    const voidReason = visit.nota_credito_motivo || visit.void_reason || 'Anulación Total de Factura';
    const { signedXml } = buildAndSignNotaCreditoXml(visit, encfE34, voidReason, items);

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${encfE34}.xml"`);
    res.send(signedXml);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/credit-notes/retransmit/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [visits] = await pool.query('SELECT * FROM visits WHERE id = ?', [id]);
    if (!visits.length) return res.status(404).json({ error: 'Factura no encontrada' });
    const visit = visits[0];

    const originalNcf = (visit.ncf || '').trim();
    const isFiscalNcf = originalNcf && originalNcf !== 'NONE' && (
      originalNcf.startsWith('E31') || 
      originalNcf.startsWith('E32') || 
      originalNcf.startsWith('E34') || 
      originalNcf.startsWith('B')
    );
    if (!isFiscalNcf) {
      return res.status(400).json({ 
        error: 'Esta factura no posee un comprobante fiscal válido emitido (es no fiscal o canje interno). No requiere ni admite Nota de Crédito Electrónica.',
        code: 'NO_FISCAL_NCF_ON_INVOICE'
      });
    }

    const voidReason = visit.nota_credito_motivo || visit.void_reason || 'Anulación Total de Factura';
        const encf = await generateAndTransmitNotaCredito(visit, voidReason, visit.voided_by || 'Administrador');
    const encfCode = (typeof encf === 'object' && encf?.encf) ? encf.encf : String(encf || '');
    const trackId = (typeof encf === 'object' && encf?.trackId) ? encf.trackId : null;
    res.json({ 
      success: true, 
      message: `Nota de Crédito ${encfCode} transmitida exitosamente a la DGII.${trackId ? ` TrackID: ${trackId}` : ''}`, 
      ncf_nota_credito: encfCode,
      track_id: trackId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === DGII REPORTE 607 (VENTAS DE BIENES Y SERVICIOS) ===
router.get('/report-607', async (req, res) => {
  try {
    const { periodo, startDate, endDate, salonId } = req.query;

    let dateCondition = '';
    let queryParams = [];

    if (periodo && /^\d{6}$/.test(periodo)) {
      dateCondition = "AND (DATE_FORMAT(v.visited_at, '%Y%m') = ? OR DATE_FORMAT(v.nota_credito_fecha, '%Y%m') = ?)";
      queryParams.push(periodo, periodo);
    } else if (startDate && endDate) {
      dateCondition = "AND (DATE(v.visited_at) BETWEEN ? AND ? OR DATE(v.nota_credito_fecha) BETWEEN ? AND ?)";
      queryParams.push(startDate, endDate, startDate, endDate);
    } else {
      const currentPeriod = new Date().toISOString().slice(0, 7).replace('-', '');
      dateCondition = "AND (DATE_FORMAT(v.visited_at, '%Y%m') = ? OR DATE_FORMAT(v.nota_credito_fecha, '%Y%m') = ?)";
      queryParams.push(currentPeriod, currentPeriod);
    }

    let salonCondition = '';
    if (salonId && salonId !== 'all') {
      salonCondition = 'AND v.salon_id = ?';
      queryParams.push(salonId);
    }

    const [rows] = await pool.query(
      `SELECT 
        v.id,
        v.ticket_number,
        v.client_id,
        v.client_name,
        v.rnc_cliente,
        v.rzn_soc_cliente,
        COALESCE(v.rnc_cliente, '') as cedula,
        v.ncf,
        v.ncf_type,
        v.ncf_nota_credito,
        v.nota_credito_motivo,
        v.nota_credito_fecha,
        v.total,
        v.metodo_pago,
        v.status,
        v.visited_at,
        v.voided_at,
        v.void_reason
       FROM visits v
       WHERE (v.ncf IS NOT NULL AND TRIM(v.ncf) != '' AND v.ncf != 'NONE')
       ${dateCondition}
       ${salonCondition}
       ORDER BY v.visited_at ASC`,
      queryParams
    );

    const pad = (n) => String(n).padStart(2, '0');
    const formatDt = (d) => {
      if (!d) return '';
      const date = new Date(d);
      if (isNaN(date.getTime())) return '';
      return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
    };

    let reportRows = [];
    let grandTotals = {
      montoFacturado: 0,
      itbisFacturado: 0,
      itbisRetenido: 0,
      retencionRenta: 0,
      isrPercibido: 0,
      impuestoSelectivo: 0,
      otrosImpuestos: 0,
      propinaLegal: 0,
      efectivo: 0,
      chequeTransferencia: 0,
      tarjeta: 0,
      ventaCredito: 0,
      bonosCertificados: 0,
      permuta: 0,
      otrasFormas: 0
    };

    let rowCounter = 1;

    for (const v of rows) {
      const clientName = v.rzn_soc_cliente || v.client_name || 'CONSUMIDOR FINAL';
      const cleanRnc = String(v.rnc_cliente || v.cedula || '').replace(/\D/g, '');
      
      let tipoId = '3';
      if (cleanRnc.length === 9) tipoId = '1';
      else if (cleanRnc.length === 11) tipoId = '2';

      const totalAmount = Number(v.total || 0);
      const breakdown = extractPaymentBreakdown(v.metodo_pago, totalAmount, v.applied_payments);

      const efectivo = breakdown.efectivo;
      const chequeTransferencia = breakdown.transferencia;
      const tarjeta = breakdown.tarjeta;
      const bonos = breakdown.bonos;
      const otras = breakdown.otras;

      // Fila de la Factura Original
      const facturaRow = {
        id: rowCounter++,
        cliente: clientName,
        rnc_cedula: cleanRnc || '',
        tipo_identificacion: tipoId,
        numero_comprobante: v.ncf,
        ncf_modificado: '',
        tipo_ingreso: '01 - Ingresos por Operaciones (No Financieros)',
        fecha_comprobante: formatDt(v.visited_at || v.created_at),
        fecha_retencion: '',
        monto_facturado: totalAmount,
        itbis_facturado: 0,
        itbis_retenido: 0,
        retencion_renta: 0,
        isr_percibido: 0,
        impuesto_selectivo: 0,
        otros_impuestos: 0,
        propina_legal: 0,
        efectivo: efectivo,
        cheque_transferencia: chequeTransferencia,
        tarjeta: tarjeta,
        venta_credito: 0,
        bonos_certificados: bonos,
        permuta: 0,
        otras_formas: otras,
        tipo_registro: 'FACTURA',
        status: v.status
      };

      reportRows.push(facturaRow);

      grandTotals.montoFacturado += totalAmount;
      grandTotals.efectivo += efectivo;
      grandTotals.chequeTransferencia += chequeTransferencia;
      grandTotals.tarjeta += tarjeta;
      grandTotals.bonosCertificados += bonos;
      grandTotals.otrasFormas += otras;

      // Fila de Nota de Crédito si fue anulada con comprobante E34 / B04
      if (v.status === 'Anulado' && v.ncf_nota_credito) {
        const ncRow = {
          id: rowCounter++,
          cliente: clientName,
          rnc_cedula: cleanRnc || '',
          tipo_identificacion: tipoId,
          numero_comprobante: v.ncf_nota_credito,
          ncf_modificado: v.ncf,
          tipo_ingreso: '01 - Ingresos por Operaciones (No Financieros)',
          fecha_comprobante: formatDt(v.nota_credito_fecha || v.voided_at || v.visited_at),
          fecha_retencion: '',
          monto_facturado: -totalAmount,
          itbis_facturado: 0,
          itbis_retenido: 0,
          retencion_renta: 0,
          isr_percibido: 0,
          impuesto_selectivo: 0,
          otros_impuestos: 0,
          propina_legal: 0,
          efectivo: -efectivo,
          cheque_transferencia: -chequeTransferencia,
          tarjeta: -tarjeta,
          venta_credito: 0,
          bonos_certificados: -bonos,
          permuta: 0,
          otras_formas: -otras,
          tipo_registro: 'NOTA_CREDITO',
          status: 'Anulado',
          motivo_anulacion: v.nota_credito_motivo || v.void_reason
        };

        reportRows.push(ncRow);
        grandTotals.montoFacturado -= totalAmount;
        grandTotals.efectivo -= efectivo;
        grandTotals.chequeTransferencia -= chequeTransferencia;
        grandTotals.tarjeta -= tarjeta;
        grandTotals.bonosCertificados -= bonos;
        grandTotals.otrasFormas -= otras;
      }
    }

    const currentPeriodStr = periodo || new Date().toISOString().slice(0, 7).replace('-', '');
    res.json({
      success: true,
      header: {
        empresa: 'ETEREAS SRL',
        rnc: '131917038',
        periodo: currentPeriodStr,
        cantidad_registros: reportRows.length,
        fecha_impresion: formatDt(new Date())
      },
      records: reportRows,
      totals: grandTotals
    });
  } catch (err) {
    console.error('[REPORT 607 ERROR]:', err);
    res.status(500).json({ error: err.message });
  }
});

// Download standard DGII 607 pipe-delimited text file
router.get('/report-607/txt', async (req, res) => {
  try {
    const { periodo } = req.query;
    const currentPeriodStr = (periodo && /^\d{6}$/.test(periodo)) 
      ? periodo 
      : new Date().toISOString().slice(0, 7).replace('-', '');

    const [rows] = await pool.query(
      `SELECT * FROM visits 
       WHERE (ncf IS NOT NULL AND TRIM(ncf) != '' AND ncf != 'NONE')
       AND (DATE_FORMAT(visited_at, '%Y%m') = ? OR DATE_FORMAT(nota_credito_fecha, '%Y%m') = ?)
       ORDER BY visited_at ASC`,
      [currentPeriodStr, currentPeriodStr]
    );

    const pad = (n) => String(n).padStart(2, '0');
    const toYmd = (d) => {
      if (!d) return '';
      const date = new Date(d);
      if (isNaN(date.getTime())) return '';
      return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
    };

    let lines = [];
    const rncEmisor = '131917038';
    
    // Rows
    for (const v of rows) {
      const cleanRnc = String(v.rnc_cliente || v.cedula || '').replace(/\D/g, '');
      let tipoId = '3';
      if (cleanRnc.length === 9) tipoId = '1';
      else if (cleanRnc.length === 11) tipoId = '2';

      const total = Number(v.total || 0).toFixed(2);
      const breakdown = extractPaymentBreakdown(v.metodo_pago, v.total, v.applied_payments);
      const efectivo = breakdown.efectivo.toFixed(2);
      const transf = breakdown.transferencia.toFixed(2);
      const tarjeta = breakdown.tarjeta.toFixed(2);
      const bonos = breakdown.bonos.toFixed(2);
      const otras = breakdown.otras.toFixed(2);

      // Factura
      lines.push([
        cleanRnc || '',
        tipoId,
        v.ncf,
        '',
        '01',
        toYmd(v.visited_at || v.created_at),
        '',
        total,
        '0.00',
        '0.00',
        '0.00',
        '0.00',
        '0.00',
        '0.00',
        '0.00',
        efectivo,
        transf,
        tarjeta,
        '0.00',
        bonos,
        '0.00',
        otras
      ].join('|'));

      // Nota de Crédito
      if (v.status === 'Anulado' && v.ncf_nota_credito) {
        lines.push([
          cleanRnc || '',
          tipoId,
          v.ncf_nota_credito,
          v.ncf,
          '01',
          toYmd(v.nota_credito_fecha || v.voided_at || v.visited_at),
          '',
          total,
          '0.00',
          '0.00',
          '0.00',
          '0.00',
          '0.00',
          '0.00',
          '0.00',
          efectivo,
          transf,
          tarjeta,
          '0.00',
          bonos,
          '0.00',
          '0.00'
        ].join('|'));
      }
    }

    // Encabezado estándar 607: 607|RNC|PERIODO|CANTIDAD
    const fileContent = `607|${rncEmisor}|${currentPeriodStr}|${lines.length}\n` + lines.join('\n');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="DGII_F_607_${rncEmisor}_${currentPeriodStr}.txt"`);
    res.send(fileContent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === DGII NCF SEQUENCES MANAGEMENT APIs ===
// ==========================================

// GET /api/dgii/sequences/availability - Real-time e-NCF sequence availability and threshold alerts
const getSequenceAvailability = async (req, res) => {
  try {
    const [allRows] = await pool.query(`
      SELECT id, tipo_comprobante, nombre_comprobante, no_solicitud, no_autorizacion,
             numero_desde, numero_hasta, secuencia_actual, cantidad_aprobada, cantidad_usada,
             fecha_vencimiento, estado, alerta_minima
      FROM dgii_ncf_sequences
      ORDER BY id ASC
    `);

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
        alertMsg = `⛔ ALERTA PERSISTENTE: Se agotaron los comprobantes fiscales de ${tipo} (${availability[tipo].nombre}). [${diag.code}] ${diag.message}`;
      } else if (disp <= 2) {
        level = 'critical_2';
        alertMsg = `🚨 Alerta: Quedan solo ${disp} comprobante(s) restante(s) de ${tipo}. Bloqueo inminente al llegar a cero.`;
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
});

// POST /api/dgii/sequences - Add new authorized sequence batch from DGII
router.post('/sequences', async (req, res) => {
  const callerRole = (req.headers['x-user-role'] || '').toLowerCase();
  if (callerRole === 'contador') {
    return res.status(403).json({ error: 'Permiso denegado: El rol Contador puede consultar secuencias pero no crear nuevos lotes.', code: 'FORBIDDEN_CONTADOR' });
  }
  try {
    const {
      tipo_comprobante,
      nombre_comprobante,
      no_solicitud,
      no_autorizacion,
      numero_desde,
      numero_hasta,
      cantidad_aprobada,
      fecha_vencimiento,
      alerta_minima
    } = req.body;

    if (!tipo_comprobante || !numero_desde || !numero_hasta || !cantidad_aprobada) {
      return res.status(400).json({ error: 'Faltan campos obligatorios para registrar la secuencia.' });
    }

    const defaultNames = {
      'E31': 'Factura de Crédito Fiscal Electrónico',
      'E32': 'Factura de Consumo Electrónica',
      'E33': 'Nota de Débito Electrónica',
      'E34': 'Nota de Crédito Electrónica',
      'E41': 'Compras Electrónicas',
      'E43': 'Gastos Menores Electrónicos',
      'E44': 'Regímenes Especiales Electrónicos',
      'E45': 'Gubernamental Electrónico'
    };

    const finalNombre = nombre_comprobante || defaultNames[tipo_comprobante.toUpperCase()] || `Comprobante ${tipo_comprobante}`;

    const [result] = await pool.query(`
      INSERT INTO dgii_ncf_sequences 
      (tipo_comprobante, nombre_comprobante, no_solicitud, no_autorizacion, numero_desde, numero_hasta, secuencia_actual, cantidad_aprobada, cantidad_usada, fecha_vencimiento, alerta_minima, estado)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, 'Activo')
    `, [
      tipo_comprobante.toUpperCase(),
      finalNombre,
      no_solicitud || null,
      no_autorizacion || null,
      numero_desde.trim().toUpperCase(),
      numero_hasta.trim().toUpperCase(),
      parseInt(cantidad_aprobada) || 1,
      fecha_vencimiento || null,
      parseInt(alerta_minima) || 2
    ]);

    res.json({ success: true, message: 'Secuencia de e-NCF registrada con éxito.', id: result.insertId });
  } catch (err) {
    console.error('[DGII SEQUENCES POST ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/dgii/sequences/:id - Update an existing sequence batch
router.put('/sequences/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nombre_comprobante,
      no_solicitud,
      no_autorizacion,
      numero_desde,
      numero_hasta,
      cantidad_aprobada,
      cantidad_usada,
      fecha_vencimiento,
      alerta_minima,
      estado
    } = req.body;

    await pool.query(`
      UPDATE dgii_ncf_sequences 
      SET nombre_comprobante = COALESCE(?, nombre_comprobante),
          no_solicitud = COALESCE(?, no_solicitud),
          no_autorizacion = COALESCE(?, no_autorizacion),
          numero_desde = COALESCE(?, numero_desde),
          numero_hasta = COALESCE(?, numero_hasta),
          cantidad_aprobada = COALESCE(?, cantidad_aprobada),
          cantidad_usada = COALESCE(?, cantidad_usada),
          fecha_vencimiento = COALESCE(?, fecha_vencimiento),
          alerta_minima = COALESCE(?, alerta_minima),
          estado = COALESCE(?, estado)
      WHERE id = ?
    `, [
      nombre_comprobante,
      no_solicitud,
      no_autorizacion,
      numero_desde,
      numero_hasta,
      cantidad_aprobada,
      cantidad_usada,
      fecha_vencimiento,
      alerta_minima,
      estado,
      id
    ]);

    res.json({ success: true, message: 'Secuencia actualizada correctamente.' });
  } catch (err) {
    console.error('[DGII SEQUENCES PUT ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/dgii/sequences/:id - Delete a sequence batch
router.delete('/sequences/:id', async (req, res) => {
  const callerRole = (req.headers['x-user-role'] || '').toLowerCase();
  if (callerRole === 'contador') {
    return res.status(403).json({ error: 'Permiso denegado: El rol Contador no puede eliminar lotes de secuencias fiscales.', code: 'FORBIDDEN_CONTADOR' });
  }
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM dgii_ncf_sequences WHERE id = ?', [id]);
    res.json({ success: true, message: 'Secuencia eliminada correctamente.' });
  } catch (err) {
    console.error('[DGII SEQUENCES DELETE ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// =========================================================================
// === DGII ITBIS (IT-1 & ANEXO A) AUTOMATIC DECLARATION FROM 606 & 607 ===
// =========================================================================
const ensureIt1Tables = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dgii_it1_settings (
      id INT PRIMARY KEY DEFAULT 1,
      regimen VARCHAR(20) NOT NULL DEFAULT 'exento',
      empresa_nombre VARCHAR(255) DEFAULT 'ETEREAS SRL',
      rnc VARCHAR(20) DEFAULT '131917038',
      tasa_itbis DECIMAL(5,2) DEFAULT 18.00,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    INSERT IGNORE INTO dgii_it1_settings (id, regimen, empresa_nombre, rnc, tasa_itbis)
    VALUES (1, 'exento', 'ETEREAS SRL', '131917038', 18.00)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dgii_it1_declarations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      periodo VARCHAR(6) NOT NULL,
      salon_id VARCHAR(20) NOT NULL DEFAULT 'all',
      regimen VARCHAR(20) NOT NULL DEFAULT 'exento',
      estado VARCHAR(20) NOT NULL DEFAULT 'Borrador',
      datos_complementarios_revisados TINYINT(1) DEFAULT 0,
      saldo_favor_anterior DECIMAL(14,2) DEFAULT 0,
      retenciones_tarjetas DECIMAL(14,2) DEFAULT 0,
      retenciones_terceros DECIMAL(14,2) DEFAULT 0,
      pagos_computables_importaciones DECIMAL(14,2) DEFAULT 0,
      otros_ajustes DECIMAL(14,2) DEFAULT 0,
      notas TEXT DEFAULT NULL,
      snapshot_ventas_totales DECIMAL(14,2) DEFAULT 0,
      snapshot_itbis_generado DECIMAL(14,2) DEFAULT 0,
      snapshot_itbis_compras DECIMAL(14,2) DEFAULT 0,
      snapshot_resultado DECIMAL(14,2) DEFAULT 0,
      snapshot_tipo_resultado VARCHAR(30) DEFAULT 'exento',
      updated_by VARCHAR(100) DEFAULT 'Sistema',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_periodo_salon (periodo, salon_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dgii_606_purchases (
      id INT AUTO_INCREMENT PRIMARY KEY,
      periodo VARCHAR(6) NOT NULL,
      rnc_cedula VARCHAR(20) NOT NULL,
      tipo_id INT NOT NULL DEFAULT 1,
      tipo_bienes_servicios VARCHAR(4) NOT NULL DEFAULT '02',
      proveedor VARCHAR(255) NOT NULL,
      ncf VARCHAR(20) NOT NULL,
      ncf_modificado VARCHAR(20) DEFAULT '',
      fecha_factura VARCHAR(10) NOT NULL,
      fecha_pago VARCHAR(10) DEFAULT '',
      tipo_compra VARCHAR(50) DEFAULT 'Bienes',
      clasificacion_gasto VARCHAR(255) DEFAULT '02 - Gastos por trabajos, suministros y servicios',
      monto_servicios DECIMAL(14,2) DEFAULT 0,
      monto_bienes DECIMAL(14,2) DEFAULT 0,
      total_facturado DECIMAL(14,2) NOT NULL DEFAULT 0,
      itbis_facturado DECIMAL(14,2) DEFAULT 0,
      itbis_retenido DECIMAL(14,2) DEFAULT 0,
      itbis_proporcionalidad DECIMAL(14,2) DEFAULT 0,
      itbis_costo DECIMAL(14,2) DEFAULT 0,
      itbis_adelantar DECIMAL(14,2) DEFAULT 0,
      itbis_percibido DECIMAL(14,2) DEFAULT 0,
      tipo_retencion_isr VARCHAR(4) DEFAULT '',
      isr_retenido DECIMAL(14,2) DEFAULT 0,
      isr_percibido DECIMAL(14,2) DEFAULT 0,
      isc DECIMAL(14,2) DEFAULT 0,
      otros_impuestos DECIMAL(14,2) DEFAULT 0,
      propina_legal DECIMAL(14,2) DEFAULT 0,
      forma_pago VARCHAR(4) DEFAULT '02',
      estado VARCHAR(20) DEFAULT 'Completa',
      errores_validacion TEXT DEFAULT NULL,
      notas TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_periodo (periodo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  try {
    await pool.query(`ALTER TABLE dgii_606_purchases ADD COLUMN errores_validacion TEXT DEFAULT NULL AFTER estado`);
  } catch (_) {}
};

// GET /api/dgii/it1 - Calculate IT-1 & Anexo A automatically from 606 and 607
router.get('/it1', async (req, res) => {
  try {
    await ensureIt1Tables();

    const now = new Date();
    const defaultPeriodo = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const periodo = (req.query.periodo && /^\d{6}$/.test(req.query.periodo))
      ? req.query.periodo
      : defaultPeriodo;
    const salonId = req.query.salonId || 'all';

    // 1. Fetch global IT-1 configuration (exento vs gravado)
    const [settingsRows] = await pool.query('SELECT * FROM dgii_it1_settings WHERE id = 1 LIMIT 1');
    const settings = settingsRows[0] || {
      regimen: 'exento',
      empresa_nombre: 'ETEREAS SRL',
      rnc: '131917038',
      tasa_itbis: 18.00
    };
    const regimen = req.query.regimen || settings.regimen || 'exento';

    // 2. Fetch 607 Sales for the period
    const params607 = [periodo, periodo];
    let salonCond607 = '';
    if (salonId && salonId !== 'all') {
      salonCond607 = 'AND v.salon_id = ?';
      params607.push(salonId);
    }

    const [rows607] = await pool.query(
      `SELECT 
        v.id, v.ncf, v.ncf_type, v.ncf_nota_credito, v.nota_credito_fecha,
        v.total, v.metodo_pago, v.status, v.visited_at, v.voided_at,
        DATE_FORMAT(v.visited_at, '%Y%m') as visited_period,
        DATE_FORMAT(COALESCE(v.nota_credito_fecha, v.voided_at, v.visited_at), '%Y%m') as nc_period
       FROM visits v
       WHERE (v.ncf IS NOT NULL AND TRIM(v.ncf) != '' AND v.ncf != 'NONE')
       AND (DATE_FORMAT(v.visited_at, '%Y%m') = ? OR DATE_FORMAT(v.nota_credito_fecha, '%Y%m') = ?)
       ${salonCond607}
       ORDER BY v.visited_at ASC`,
      params607
    );

    const summary607 = {
      cantidad_registros: 0,
      monto_total: 0,
      itbis_facturado: 0,
      por_ncf: {
        credito_fiscal: { codigo: '01 / 31', nombre: 'Comprobantes Válidos para Crédito Fiscal (01 y 31)', cantidad: 0, monto: 0 },
        consumo: { codigo: '02 / 32', nombre: 'Comprobantes de Consumo (02 y 32)', cantidad: 0, monto: 0 },
        notas_debito: { codigo: '03 / 33', nombre: 'Comprobantes Notas de Débito (03 y 33)', cantidad: 0, monto: 0 },
        notas_credito: { codigo: '04 / 34', nombre: 'Comprobantes Notas de Crédito (04 y 34)', cantidad: 0, monto: 0 },
        regimenes_especiales: { codigo: '14 / 44', nombre: 'Comprobantes Regímenes Especiales (14 y 44)', cantidad: 0, monto: 0 },
        gubernamentales: { codigo: '15 / 45', nombre: 'Comprobantes Gubernamentales (15 y 45)', cantidad: 0, monto: 0 },
        otras_operaciones: { codigo: 'Otros', nombre: 'Otras Operaciones (Positivas / Negativas)', cantidad: 0, monto: 0 }
      },
      por_tipo_venta: {
        efectivo: 0,
        cheque_transferencia: 0,
        tarjeta: 0,
        venta_credito: 0,
        bonos_certificados: 0,
        permuta: 0,
        otras_formas: 0
      }
    };

    for (const v of rows607) {
      const totalAmount = Number(v.total || 0);
      const breakdown = extractPaymentBreakdown(v.metodo_pago, totalAmount);
      const ncfClean = String(v.ncf || '').trim().toUpperCase();

      if (!v.visited_period || v.visited_period === periodo) {
        summary607.cantidad_registros += 1;
        summary607.monto_total += totalAmount;
        summary607.por_tipo_venta.efectivo += breakdown.efectivo;
        summary607.por_tipo_venta.cheque_transferencia += breakdown.transferencia;
        summary607.por_tipo_venta.tarjeta += breakdown.tarjeta;
        summary607.por_tipo_venta.bonos_certificados += breakdown.bonos;
        summary607.por_tipo_venta.otras_formas += breakdown.otras;

        if (ncfClean.startsWith('B01') || ncfClean.startsWith('E31')) {
          summary607.por_ncf.credito_fiscal.cantidad += 1;
          summary607.por_ncf.credito_fiscal.monto += totalAmount;
        } else if (ncfClean.startsWith('B02') || ncfClean.startsWith('E32')) {
          summary607.por_ncf.consumo.cantidad += 1;
          summary607.por_ncf.consumo.monto += totalAmount;
        } else if (ncfClean.startsWith('B14') || ncfClean.startsWith('E44')) {
          summary607.por_ncf.regimenes_especiales.cantidad += 1;
          summary607.por_ncf.regimenes_especiales.monto += totalAmount;
        } else if (ncfClean.startsWith('B15') || ncfClean.startsWith('E45')) {
          summary607.por_ncf.gubernamentales.cantidad += 1;
          summary607.por_ncf.gubernamentales.monto += totalAmount;
        } else {
          summary607.por_ncf.otras_operaciones.cantidad += 1;
          summary607.por_ncf.otras_operaciones.monto += totalAmount;
        }
      }

      if (v.status === 'Anulado' && v.ncf_nota_credito && (!v.nc_period || v.nc_period === periodo)) {
        summary607.cantidad_registros += 1;
        summary607.monto_total -= totalAmount;
        summary607.por_ncf.notas_credito.cantidad += 1;
        summary607.por_ncf.notas_credito.monto += totalAmount;
        summary607.por_tipo_venta.efectivo -= breakdown.efectivo;
        summary607.por_tipo_venta.cheque_transferencia -= breakdown.transferencia;
        summary607.por_tipo_venta.tarjeta -= breakdown.tarjeta;
        summary607.por_tipo_venta.bonos_certificados -= breakdown.bonos;
        summary607.por_tipo_venta.otras_formas -= breakdown.otras;
      }
    }

    // 3. Fetch 606 Purchases for the period
    const [rows606] = await pool.query(
      `SELECT * FROM dgii_606_purchases WHERE periodo = ? ORDER BY fecha_factura DESC, id DESC`,
      [periodo]
    );

    const summary606 = {
      cantidad_registros: rows606.length,
      monto_servicios: 0,
      monto_bienes: 0,
      total_facturado: 0,
      itbis_facturado: 0,
      itbis_retenido: 0,
      itbis_proporcionalidad: 0,
      itbis_costo: 0,
      itbis_adelantar: 0,
      isr_retenido: 0,
      por_categoria: {}
    };

    for (const r of rows606) {
      const mServ = Number(r.monto_servicios || 0);
      const mBien = Number(r.monto_bienes || 0);
      const tFact = Number(r.total_facturado || 0);
      const itbisFact = Number(r.itbis_facturado || 0);
      const itbisRet = Number(r.itbis_retenido || 0);
      const itbisProp = Number(r.itbis_proporcionalidad || 0);
      const itbisCost = Number(r.itbis_costo || 0);
      const itbisAdel = Number(r.itbis_adelantar || 0);
      const isrRet = Number(r.isr_retenido || 0);

      summary606.monto_servicios += mServ;
      summary606.monto_bienes += mBien;
      summary606.total_facturado += tFact;
      summary606.itbis_facturado += itbisFact;
      summary606.itbis_retenido += itbisRet;
      summary606.itbis_proporcionalidad += itbisProp;
      summary606.itbis_costo += itbisCost;
      summary606.itbis_adelantar += itbisAdel;
      summary606.isr_retenido += isrRet;

      const catKey = r.clasificacion_gasto || `${r.tipo_bienes_servicios || '02'} - Gastos por trabajos, suministros y servicios`;
      if (!summary606.por_categoria[catKey]) {
        summary606.por_categoria[catKey] = {
          categoria: catKey,
          cantidad: 0,
          total_facturado: 0,
          itbis_facturado: 0
        };
      }
      summary606.por_categoria[catKey].cantidad += 1;
      summary606.por_categoria[catKey].total_facturado += tFact;
      summary606.por_categoria[catKey].itbis_facturado += itbisFact;
    }

    // 4. Fetch saved declaration for (periodo, salonId) and previous period balance
    const [savedRows] = await pool.query(
      'SELECT * FROM dgii_it1_declarations WHERE periodo = ? AND salon_id = ? LIMIT 1',
      [periodo, String(salonId)]
    );
    const savedDeclaration = savedRows[0] || null;

    const yr = parseInt(periodo.slice(0, 4), 10);
    const mo = parseInt(periodo.slice(4, 6), 10);
    const prevYr = mo === 1 ? yr - 1 : yr;
    const prevMo = mo === 1 ? 12 : mo - 1;
    const prevPeriodo = `${prevYr}${String(prevMo).padStart(2, '0')}`;

    const [prevRows] = await pool.query(
      'SELECT * FROM dgii_it1_declarations WHERE periodo = ? AND salon_id = ? LIMIT 1',
      [prevPeriodo, String(salonId)]
    );
    const prevDeclaration = prevRows[0] || null;
    const suggestedSaldoFavorAnterior = (prevDeclaration && prevDeclaration.snapshot_tipo_resultado === 'a_favor')
      ? Math.abs(Number(prevDeclaration.snapshot_resultado || 0))
      : 0;

    // 5. Compute IT-1 Metrics according to Regimen ('exento' vs 'gravado')
    const tasaDecimal = Number(settings.tasa_itbis || 18) / 100;
    const ventasNetas607 = Math.max(0, Number(summary607.monto_total.toFixed(2)));
    const itbisCompras606 = Number(summary606.itbis_facturado.toFixed(2));

    const saldoFavorAnterior = savedDeclaration
      ? Number(savedDeclaration.saldo_favor_anterior || 0)
      : suggestedSaldoFavorAnterior;
    const retencionesTarjetas = savedDeclaration ? Number(savedDeclaration.retenciones_tarjetas || 0) : 0;
    const retencionesTerceros = savedDeclaration ? Number(savedDeclaration.retenciones_terceros || 0) : 0;
    const pagosImportaciones = savedDeclaration ? Number(savedDeclaration.pagos_computables_importaciones || 0) : 0;
    const otrosAjustes = savedDeclaration ? Number(savedDeclaration.otros_ajustes || 0) : 0;
    const totalComplementos = Number((retencionesTarjetas + retencionesTerceros + pagosImportaciones + otrosAjustes).toFixed(2));

    let calculation = {};
    if (regimen === 'exento') {
      const itbisRetenidoPorPagar = Number(summary606.itbis_retenido.toFixed(2));
      const resultadoNeto = Number(Math.max(0, itbisRetenidoPorPagar - totalComplementos - saldoFavorAnterior).toFixed(2));

      calculation = {
        regimen: 'exento',
        ventas_totales: ventasNetas607,
        ventas_exentas: ventasNetas607,
        ventas_gravadas: 0,
        itbis_generado_ventas: 0,
        itbis_pagado_compras: itbisCompras606,
        itbis_al_costo_gasto: itbisCompras606,
        itbis_deducible: 0,
        itbis_acreditable: 0,
        itbis_retenido_compras: itbisRetenidoPorPagar,
        saldo_favor_anterior: saldoFavorAnterior,
        retenciones_y_ajustes: totalComplementos,
        resultado_a_pagar: resultadoNeto,
        saldo_a_favor: 0,
        tipo_resultado: resultadoNeto > 0 ? 'a_pagar' : 'exento'
      };
    } else {
      const itbisGenerado = summary607.itbis_facturado > 0
        ? Number(summary607.itbis_facturado.toFixed(2))
        : Number((ventasNetas607 * tasaDecimal).toFixed(2));
      const itbisDeducible = summary606.itbis_adelantar > 0
        ? Number(summary606.itbis_adelantar.toFixed(2))
        : itbisCompras606;

      const diff = Number((itbisGenerado - itbisDeducible - saldoFavorAnterior - totalComplementos).toFixed(2));
      const resultadoAPagar = diff > 0 ? diff : 0;
      const saldoAFavor = diff < 0 ? Math.abs(diff) : 0;

      calculation = {
        regimen: 'gravado',
        ventas_totales: ventasNetas607,
        ventas_exentas: 0,
        ventas_gravadas: ventasNetas607,
        itbis_generado_ventas: itbisGenerado,
        itbis_pagado_compras: itbisCompras606,
        itbis_al_costo_gasto: Number(summary606.itbis_costo.toFixed(2)),
        itbis_deducible: itbisDeducible,
        itbis_acreditable: itbisDeducible,
        itbis_retenido_compras: Number(summary606.itbis_retenido.toFixed(2)),
        saldo_favor_anterior: saldoFavorAnterior,
        retenciones_y_ajustes: totalComplementos,
        resultado_a_pagar: resultadoAPagar,
        saldo_a_favor: saldoAFavor,
        tipo_resultado: diff >= 0 ? 'a_pagar' : 'a_favor'
      };
    }

    // 6. Fetch all saved periods for "Períodos guardados"
    const [allSavedPeriods] = await pool.query(
      `SELECT * FROM dgii_it1_declarations WHERE salon_id = ? ORDER BY periodo DESC LIMIT 24`,
      [String(salonId)]
    );

    res.json({
      success: true,
      periodo,
      salonId,
      settings: {
        ...settings,
        regimen_activo: regimen
      },
      source606: {
        loaded: true,
        cantidad_registros: summary606.cantidad_registros,
        monto_servicios: Number(summary606.monto_servicios.toFixed(2)),
        monto_bienes: Number(summary606.monto_bienes.toFixed(2)),
        total_facturado: Number(summary606.total_facturado.toFixed(2)),
        itbis_facturado: itbisCompras606,
        itbis_retenido: Number(summary606.itbis_retenido.toFixed(2)),
        itbis_costo: Number(summary606.itbis_costo.toFixed(2)),
        itbis_adelantar: Number(summary606.itbis_adelantar.toFixed(2)),
        por_categoria: Object.values(summary606.por_categoria)
      },
      source607: {
        loaded: true,
        cantidad_registros: summary607.cantidad_registros,
        monto_total: ventasNetas607,
        itbis_facturado: Number(summary607.itbis_facturado.toFixed(2)),
        por_ncf: summary607.por_ncf,
        por_tipo_venta: summary607.por_tipo_venta
      },
      calculation,
      declaration: savedDeclaration || {
        periodo,
        salon_id: String(salonId),
        regimen,
        estado: 'Borrador',
        datos_complementarios_revisados: 0,
        saldo_favor_anterior: saldoFavorAnterior,
        retenciones_tarjetas: 0,
        retenciones_terceros: 0,
        pagos_computables_importaciones: 0,
        otros_ajustes: 0,
        notas: ''
      },
      savedPeriods: allSavedPeriods
    });
  } catch (err) {
    console.error('[DGII IT-1 GET ERROR]:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dgii/it1/settings - Update company ITBIS regime ('exento' vs 'gravado')
router.post('/it1/settings', async (req, res) => {
  try {
    await ensureIt1Tables();
    const { regimen, tasa_itbis } = req.body;
    const validRegimen = regimen === 'gravado' ? 'gravado' : 'exento';
    const validTasa = tasa_itbis !== undefined ? Number(tasa_itbis) : 18.00;

    await pool.query(
      `UPDATE dgii_it1_settings SET regimen = ?, tasa_itbis = ? WHERE id = 1`,
      [validRegimen, validTasa]
    );

    res.json({
      success: true,
      regimen: validRegimen,
      tasa_itbis: validTasa,
      message: validRegimen === 'exento'
        ? 'Configuración actualizada: Empresa en Régimen Exento (Servicios exentos de ITBIS).'
        : 'Configuración actualizada: Empresa en Régimen Gravado (Genera ITBIS en ventas).'
    });
  } catch (err) {
    console.error('[DGII IT-1 SETTINGS ERROR]:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dgii/it1/save - Save IT-1 declaration draft or mark as reviewed
router.post('/it1/save', async (req, res) => {
  try {
    await ensureIt1Tables();
    const {
      periodo,
      salon_id = 'all',
      regimen = 'exento',
      estado = 'Borrador',
      datos_complementarios_revisados = 0,
      saldo_favor_anterior = 0,
      retenciones_tarjetas = 0,
      retenciones_terceros = 0,
      pagos_computables_importaciones = 0,
      otros_ajustes = 0,
      notas = '',
      snapshot_ventas_totales = 0,
      snapshot_itbis_generado = 0,
      snapshot_itbis_compras = 0,
      snapshot_resultado = 0,
      snapshot_tipo_resultado = 'exento'
    } = req.body;

    if (!periodo || !/^\d{6}$/.test(String(periodo))) {
      return res.status(400).json({ error: 'El período debe tener formato YYYYMM.' });
    }

    const updatedBy = req.headers['x-user-name'] || 'Administrador';

    await pool.query(
      `INSERT INTO dgii_it1_declarations (
        periodo, salon_id, regimen, estado, datos_complementarios_revisados,
        saldo_favor_anterior, retenciones_tarjetas, retenciones_terceros,
        pagos_computables_importaciones, otros_ajustes, notas,
        snapshot_ventas_totales, snapshot_itbis_generado, snapshot_itbis_compras,
        snapshot_resultado, snapshot_tipo_resultado, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        regimen = VALUES(regimen),
        estado = VALUES(estado),
        datos_complementarios_revisados = VALUES(datos_complementarios_revisados),
        saldo_favor_anterior = VALUES(saldo_favor_anterior),
        retenciones_tarjetas = VALUES(retenciones_tarjetas),
        retenciones_terceros = VALUES(retenciones_terceros),
        pagos_computables_importaciones = VALUES(pagos_computables_importaciones),
        otros_ajustes = VALUES(otros_ajustes),
        notas = VALUES(notas),
        snapshot_ventas_totales = VALUES(snapshot_ventas_totales),
        snapshot_itbis_generado = VALUES(snapshot_itbis_generado),
        snapshot_itbis_compras = VALUES(snapshot_itbis_compras),
        snapshot_resultado = VALUES(snapshot_resultado),
        snapshot_tipo_resultado = VALUES(snapshot_tipo_resultado),
        updated_by = VALUES(updated_by)`,
      [
        String(periodo),
        String(salon_id),
        regimen === 'gravado' ? 'gravado' : 'exento',
        estado === 'Revisado' ? 'Revisado' : 'Borrador',
        datos_complementarios_revisados ? 1 : 0,
        Number(saldo_favor_anterior || 0),
        Number(retenciones_tarjetas || 0),
        Number(retenciones_terceros || 0),
        Number(pagos_computables_importaciones || 0),
        Number(otros_ajustes || 0),
        notas || null,
        Number(snapshot_ventas_totales || 0),
        Number(snapshot_itbis_generado || 0),
        Number(snapshot_itbis_compras || 0),
        Number(snapshot_resultado || 0),
        snapshot_tipo_resultado || 'exento',
        updatedBy
      ]
    );

    res.json({
      success: true,
      message: estado === 'Revisado'
        ? `Declaración IT-1 del período ${periodo} marcada como Revisada.`
        : `Borrador IT-1 del período ${periodo} guardado correctamente.`
    });
  } catch (err) {
    console.error('[DGII IT-1 SAVE ERROR]:', err);
    res.status(500).json({ error: err.message });
  }
});

  return router;
}

module.exports = { createDgiiRouter, extractPaymentBreakdown, evaluateBatchFiscalStatus, diagnoseSequenceFailure };
