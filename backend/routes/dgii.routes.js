const express = require('express');

let PDFDocument = null;
try { PDFDocument = require('pdfkit'); } catch(e) { console.warn('pdfkit optional require notice in dgii.routes:', e.message); }
let QRCode = null;
try { QRCode = require('qrcode'); } catch(e) { console.warn('qrcode optional require notice in dgii.routes:', e.message); }
let dgiiEcfLib = {};
try { dgiiEcfLib = require('dgii-ecf'); } catch(e) { console.warn('dgii-ecf optional require notice in dgii.routes:', e.message); }
const { getCodeSixDigitfromSignature, generateEcfQRCodeURL, generateFcQRCodeURL } = dgiiEcfLib;

/**
 * DGII Electronic Invoicing, Sequences, Credit Notes & 607 Report Router
 * 
 * @param {import('mysql2/promise').Pool} pool
 * @param {Object} helpers
 */
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
      qrUrl = generateEcfQRCodeURL(rncEmisor, rncComprador || idExtranjero || '', encf, total.toFixed(2), fechaEmision, fechaHoraFirma, codigoSeguridad, 'CerteCF');
    } else {
      qrUrl = `https://fc.dgii.gov.do/eCF/ConsultaTimbre?RncEmisor=${rncEmisor}&RncComprador=${rncComprador}&ENCF=${encf}&MontoTotal=${total.toFixed(2)}&FechaEmision=${fechaEmision}&FechaFirma=${fechaHoraFirma}&CodigoSeguridad=${codigoSeguridad}`;
    }

    let qrBuffer = null;
    if (QRCode) {
      try {
        qrBuffer = await QRCode.toBuffer(qrUrl, { errorCorrectionLevel: 'M', type: 'png', margin: 1, width: 250 });
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

    const voidReason = visit.nota_credito_motivo || visit.void_reason || 'Anulación Total de Factura';
    const encf = await generateAndTransmitNotaCredito(visit, voidReason, visit.voided_by || 'Administrador');
    res.json({ success: true, message: `Nota de Crédito ${encf} transmitida exitosamente a la DGII.`, ncf_nota_credito: encf });
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
      const paymentMethod = String(v.metodo_pago || 'Efectivo').toLowerCase();

      let efectivo = 0;
      let chequeTransferencia = 0;
      let tarjeta = 0;
      let bonos = 0;
      let otras = 0;

      let applied = [];
      try {
        if (typeof v.applied_payments === 'string') applied = JSON.parse(v.applied_payments);
        else if (Array.isArray(v.applied_payments)) applied = v.applied_payments;
      } catch (_) {}

      if (applied && applied.length > 0) {
        for (const p of applied) {
          const amt = Number(p.amount || 0);
          const m = String(p.method || '').toLowerCase();
          if (m.includes('efectivo') || m.includes('cash')) efectivo += amt;
          else if (m.includes('tarjeta') || m.includes('card') || m.includes('cardnet') || m.includes('pos')) tarjeta += amt;
          else if (m.includes('transf') || m.includes('cheque') || m.includes('deposito')) chequeTransferencia += amt;
          else if (m.includes('bono') || m.includes('gift') || m.includes('certificado')) bonos += amt;
          else otras += amt;
        }
      } else {
        if (paymentMethod.includes('efectivo') || paymentMethod.includes('cash')) {
          efectivo = totalAmount;
        } else if (paymentMethod.includes('tarjeta') || paymentMethod.includes('card') || paymentMethod.includes('cardnet') || paymentMethod.includes('pos')) {
          tarjeta = totalAmount;
        } else if (paymentMethod.includes('transf') || paymentMethod.includes('cheque') || paymentMethod.includes('deposito')) {
          chequeTransferencia = totalAmount;
        } else if (paymentMethod.includes('bono') || paymentMethod.includes('gift') || paymentMethod.includes('certificado')) {
          bonos = totalAmount;
        } else {
          efectivo = totalAmount;
        }
      }

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
      const paymentMethod = String(v.metodo_pago || 'Efectivo').toLowerCase();
      let efectivo = (paymentMethod.includes('efectivo') || paymentMethod.includes('cash')) ? total : '0.00';
      let tarjeta = (paymentMethod.includes('tarjeta') || paymentMethod.includes('card') || paymentMethod.includes('cardnet') || paymentMethod.includes('pos')) ? total : '0.00';
      let transf = (paymentMethod.includes('transf') || paymentMethod.includes('cheque') || paymentMethod.includes('deposito')) ? total : '0.00';
      let bonos = (paymentMethod.includes('bono') || paymentMethod.includes('gift') || paymentMethod.includes('certificado')) ? total : '0.00';

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
        '0.00'
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

// GET /api/dgii/sequences - List all authorized NCF sequence batches
router.get('/sequences', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM dgii_ncf_sequences ORDER BY id DESC');
    const now = new Date();

    const formatted = rows.map(seq => {
      const disponibles = Math.max(0, seq.cantidad_aprobada - seq.cantidad_usada);
      const porcentajeDisponibles = seq.cantidad_aprobada > 0 ? Math.round((disponibles / seq.cantidad_aprobada) * 100) : 0;
      const isExpiring = seq.fecha_vencimiento ? new Date(seq.fecha_vencimiento) < now : false;
      const isLow = disponibles <= (seq.alerta_minima || 5);

      let estadoActual = seq.estado;
      if (isExpiring) estadoActual = 'Vencido';
      else if (disponibles <= 0) estadoActual = 'Agotado';

      return {
        ...seq,
        cantidad_disponible: disponibles,
        porcentaje_disponible: porcentajeDisponibles,
        is_alerta_minima: isLow && disponibles > 0,
        is_vencido: isExpiring,
        estado_calculado: estadoActual
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
      parseInt(alerta_minima) || 5
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
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM dgii_ncf_sequences WHERE id = ?', [id]);
    res.json({ success: true, message: 'Secuencia eliminada correctamente.' });
  } catch (err) {
    console.error('[DGII SEQUENCES DELETE ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});


  return router;
}

module.exports = { createDgiiRouter };
