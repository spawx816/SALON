const path = require('path');
const fs = require('fs');

let forge = null;
try { forge = require('node-forge'); } catch(e) { console.warn('node-forge optional require notice in dgii.service:', e.message); }
let dgiiEcfLib = {};
try { dgiiEcfLib = require('dgii-ecf'); } catch(e) { console.warn('dgii-ecf optional require notice in dgii.service:', e.message); }
const { Signature, ECF, ENVIRONMENT, convertECF32ToRFCE } = dgiiEcfLib;

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function createDgiiService(pool) {
  // Load certificate
  let dgiiCertPath = process.env.DGII_CERT_PATH ? path.resolve(__dirname, '..', process.env.DGII_CERT_PATH) : path.resolve(__dirname, '../certs/20209102_identity.p12');
  if (!fs.existsSync(dgiiCertPath)) dgiiCertPath = path.resolve(__dirname, '../../20209102_identity.p12');
  if (!fs.existsSync(dgiiCertPath)) dgiiCertPath = path.resolve(__dirname, '../certs/20209102_identity.p12');

  const dgiiCertPassword = process.env.DGII_CERT_PASSWORD || 'Amelia29';
  let dgiiPrivateKeyPem = null;
  let dgiiCertificatePem = null;

  try {
    if (fs.existsSync(dgiiCertPath) && forge) {
      const p12Buffer = fs.readFileSync(dgiiCertPath);
      const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, dgiiCertPassword);

      for (const safeContent of p12.safeContents) {
        for (const safeBag of safeContent.safeBags) {
          if (safeBag.key) dgiiPrivateKeyPem = forge.pki.privateKeyToPem(safeBag.key);
          if (safeBag.cert) dgiiCertificatePem = forge.pki.certificateToPem(safeBag.cert);
        }
      }
      console.log('✅ [DGII SERVICE] Certificado digital cargado exitosamente para firma digital X.509.');
    }
  } catch (e) {
    console.warn('⚠️ [DGII SERVICE] No se pudo inicializar certificado digital:', e.message);
  }

  function formatDRDate(dateInput) {
    const d = dateInput ? new Date(dateInput) : new Date();
    const validDate = isNaN(d.getTime()) ? new Date() : d;
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Santo_Domingo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(validDate);
    const map = {};
    parts.forEach(p => { map[p.type] = p.value; });
    const fecha = `${map.day}-${map.month}-${map.year}`;
    const hora = `${map.hour}:${map.minute}:${map.second}`;
    return { fecha, fechaHora: `${fecha} ${hora}` };
  }

  function buildAndSignEcfXml(visit, items) {
    const encf = visit.ncf || 'E320000000001';
    const tipoEcf = encf.startsWith('E31') ? '31' : '32';
    const total = Number(visit.total || 0);
    const { fecha: fechaEmision, fechaHora: fechaHoraFirma } = formatDRDate(visit.visited_at || Date.now());

    const rncClean = String(visit.rnc_cliente || '').replace(/\D/g, '');
    const hasValidRnc = rncClean.length === 9 || rncClean.length === 11;

    const itemsXml = (items || []).map((item, idx) => {
      const precio = Number(item.precioAplicado || item.precio || 0);
      const cant = Number(item.cantidad || 1);
      const itemTotal = precio * cant;
      return `    <Item>
      <NumeroLinea>${idx + 1}</NumeroLinea>
      <IndicadorFacturacion>4</IndicadorFacturacion>
      <NombreItem>${escapeXml(item.nombre || item.service_name || 'Servicio')}</NombreItem>
      <IndicadorBienoServicio>2</IndicadorBienoServicio>
      <CantidadItem>${cant.toFixed(2)}</CantidadItem>
      <UnidadMedida>55</UnidadMedida>
      <PrecioUnitarioItem>${precio.toFixed(2)}</PrecioUnitarioItem>
      <MontoItem>${itemTotal.toFixed(2)}</MontoItem>
    </Item>`;
    }).join('\n');

    const fechaVencimientoXml = tipoEcf === '31'
      ? `\n      <FechaVencimientoSecuencia>31-12-2027</FechaVencimientoSecuencia>`
      : '';

    const rncCompradorXml = hasValidRnc
      ? `      <RNCComprador>${rncClean}</RNCComprador>\n`
      : '';

    const rawXml = `<?xml version="1.0" encoding="utf-8"?>
<ECF>
  <Encabezado>
    <Version>1.0</Version>
    <IdDoc>
      <TipoeCF>${tipoEcf}</TipoeCF>
      <eNCF>${encf}</eNCF>${fechaVencimientoXml}
      <IndicadorMontoGravado>0</IndicadorMontoGravado>
      <TipoIngresos>01</TipoIngresos>
      <TipoPago>1</TipoPago>
    </IdDoc>
    <Emisor>
      <RNCEmisor>131917038</RNCEmisor>
      <RazonSocialEmisor>ETEREAS SRL</RazonSocialEmisor>
      <NombreComercial>ETÉREAS</NombreComercial>
      <DireccionEmisor>LOS PALMEROS, No. 3, APTO. PLAZA BRAVO, BARRIO NUEVO</DireccionEmisor>
      <Municipio>010100</Municipio>
      <Provincia>010000</Provincia>
      <TablaTelefonoEmisor>
        <TelefonoEmisor>809-792-3555</TelefonoEmisor>
      </TablaTelefonoEmisor>
      <CorreoEmisor>RODRIGUEZ1619@HOTMAIL.COM</CorreoEmisor>
      <FechaEmision>${fechaEmision}</FechaEmision>
    </Emisor>
    <Comprador>
${rncCompradorXml}      <RazonSocialComprador>${escapeXml(visit.rzn_soc_cliente || visit.client_name || 'CONSUMIDOR FINAL')}</RazonSocialComprador>
    </Comprador>
    <Totales>
      <MontoExento>${total.toFixed(2)}</MontoExento>
      <MontoTotal>${total.toFixed(2)}</MontoTotal>
    </Totales>
  </Encabezado>
  <DetallesItems>
${itemsXml}
  </DetallesItems>
  <FechaHoraFirma>${fechaHoraFirma}</FechaHoraFirma>
</ECF>`;

    let signedXml = rawXml;
    if (dgiiPrivateKeyPem && dgiiCertificatePem && Signature) {
      try {
        const signatureObj = new Signature(dgiiPrivateKeyPem, dgiiCertificatePem);
        signedXml = signatureObj.signXml(rawXml, 'ECF');
      } catch (signErr) {
        console.warn('⚠️ [DGII] Error firmando XML e-CF con clave privada:', signErr.message);
      }
    }

    return { signedXml, fechaEmision, fechaHoraFirma };
  }

  async function allocateNextDgiiSequence(tipo = 'E34') {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [batches] = await connection.query(
        `SELECT * FROM dgii_ncf_sequences 
         WHERE tipo_comprobante = ? AND estado = 'Activo' AND cantidad_usada < cantidad_aprobada 
         ORDER BY id ASC LIMIT 1 FOR UPDATE`,
        [tipo]
      );

      if (batches.length === 0) {
        await connection.rollback();
        console.warn(`⚠️ [DGII NCF] No hay secuencias ${tipo} activas con saldo disponible.`);
        return null;
      }

      const seq = batches[0];
      const prefix = seq.tipo_comprobante || seq.numero_desde.slice(0, 3);
      const rawSeqStr = seq.numero_desde.slice(prefix.length);
      const startNum = parseInt(rawSeqStr, 10) || 1;
      const currentAssignedNum = startNum + seq.cantidad_usada;
      const encfNumber = prefix + String(currentAssignedNum).padStart(10, '0');

      const newCantidadUsada = seq.cantidad_usada + 1;
      const newSecuenciaActual = currentAssignedNum;
      const newEstado = newCantidadUsada >= seq.cantidad_aprobada ? 'Agotado' : 'Activo';

      await connection.query(
        `UPDATE dgii_ncf_sequences 
         SET cantidad_usada = ?, secuencia_actual = ?, estado = ?, updated_at = NOW() 
         WHERE id = ?`,
        [newCantidadUsada, newSecuenciaActual, newEstado, seq.id]
      );

      await connection.commit();
      console.log(`✅ [DGII NOTA CRÉDITO SECUENCIA ATÓMICA]: Asignado ${encfNumber} (Usados ${newCantidadUsada}/${seq.cantidad_aprobada})`);
      return encfNumber;
    } catch (err) {
      await connection.rollback();
      console.error('[DGII ALLOCATE SEQUENCE ERROR]:', err);
      return null;
    } finally {
      connection.release();
    }
  }

  function buildAndSignNotaCreditoXml(visit, encfE34, voidReasonText, items) {
    const total = Number(visit.total || 0);
    const { fecha: fechaEmision, fechaHora: fechaHoraFirma } = formatDRDate(new Date());
    const { fecha: fechaNCFModificado } = formatDRDate(visit.visited_at || Date.now());

    const rncClean = String(visit.rnc_cliente || '').replace(/\D/g, '');
    const hasValidRnc = rncClean.length === 9 || rncClean.length === 11;

    const itemsXml = (items || []).map((item, idx) => {
      const precio = Number(item.precioAplicado || item.precio || 0);
      const cant = Number(item.cantidad || 1);
      const itemTotal = precio * cant;
      return `    <Item>
      <NumeroLinea>${idx + 1}</NumeroLinea>
      <IndicadorFacturacion>4</IndicadorFacturacion>
      <NombreItem>${escapeXml(item.nombre || item.service_name || 'Servicio')}</NombreItem>
      <IndicadorBienoServicio>2</IndicadorBienoServicio>
      <CantidadItem>${cant.toFixed(2)}</CantidadItem>
      <UnidadMedida>55</UnidadMedida>
      <PrecioUnitarioItem>${precio.toFixed(2)}</PrecioUnitarioItem>
      <MontoItem>${itemTotal.toFixed(2)}</MontoItem>
    </Item>`;
    }).join('\n');

    const rncCompradorXml = hasValidRnc
      ? `      <RNCComprador>${rncClean}</RNCComprador>\n`
      : '';

    const rawXml = `<?xml version="1.0" encoding="utf-8"?>
<ECF>
  <Encabezado>
    <Version>1.0</Version>
    <IdDoc>
      <TipoeCF>34</TipoeCF>
      <eNCF>${encfE34}</eNCF>
      <IndicadorNotaCredito>0</IndicadorNotaCredito>
      <IndicadorMontoGravado>0</IndicadorMontoGravado>
      <TipoIngresos>01</TipoIngresos>
      <TipoPago>1</TipoPago>
    </IdDoc>
    <Emisor>
      <RNCEmisor>131917038</RNCEmisor>
      <RazonSocialEmisor>ETEREAS SRL</RazonSocialEmisor>
      <NombreComercial>ETÉREAS</NombreComercial>
      <DireccionEmisor>LOS PALMEROS, No. 3, APTO. PLAZA BRAVO, BARRIO NUEVO</DireccionEmisor>
      <Municipio>010100</Municipio>
      <Provincia>010000</Provincia>
      <TablaTelefonoEmisor>
        <TelefonoEmisor>809-792-3555</TelefonoEmisor>
      </TablaTelefonoEmisor>
      <CorreoEmisor>RODRIGUEZ1619@HOTMAIL.COM</CorreoEmisor>
      <FechaEmision>${fechaEmision}</FechaEmision>
    </Emisor>
    <Comprador>
${rncCompradorXml}      <RazonSocialComprador>${escapeXml(visit.rzn_soc_cliente || visit.client_name || 'CONSUMIDOR FINAL')}</RazonSocialComprador>
    </Comprador>
    <Totales>
      <MontoExento>${total.toFixed(2)}</MontoExento>
      <MontoTotal>${total.toFixed(2)}</MontoTotal>
    </Totales>
  </Encabezado>
  <DetallesItems>
${itemsXml}
  </DetallesItems>
  <InformacionReferencia>
    <NCFModificado>${visit.ncf}</NCFModificado>
    <FechaNCFModificado>${fechaNCFModificado}</FechaNCFModificado>
    <CodigoModificacion>1</CodigoModificacion>
    <RazonModificacion>${escapeXml(voidReasonText || 'Anulación Total de Factura')}</RazonModificacion>
  </InformacionReferencia>
  <FechaHoraFirma>${fechaHoraFirma}</FechaHoraFirma>
</ECF>`;

    if (dgiiPrivateKeyPem && dgiiCertificatePem && Signature) {
      try {
        const signatureObj = new Signature(dgiiPrivateKeyPem, dgiiCertificatePem);
        const signed = signatureObj.signXml(rawXml, 'ECF');
        return { signedXml: signed, fechaHoraFirma, fechaEmision };
      } catch (e) {
        console.error('Error signing Nota Credito XML:', e.message);
      }
    }

    return { signedXml: rawXml, fechaHoraFirma, fechaEmision };
  }

  async function transmitInvoiceDirectlyToDgii(visitId) {
    try {
      if (!dgiiPrivateKeyPem || !dgiiCertificatePem || !ECF) {
        console.warn('[DGII AUTO-TRANSMIT] Certificado digital o librería no disponible.');
        return null;
      }

      const [visitRows] = await pool.query('SELECT * FROM visits WHERE id = ?', [visitId]);
      if (!visitRows || visitRows.length === 0) return null;
      const visit = visitRows[0];
      if (!visit.ncf) return null;

      let items = [];
      if (visit.items_detail) {
        try {
          items = typeof visit.items_detail === 'string' ? JSON.parse(visit.items_detail) : visit.items_detail;
        } catch (_) {}
      }
      if (!items || items.length === 0) {
        items = [{
          nombre: 'Servicio Profesional de Belleza',
          precio: Number(visit.total || 0),
          cantidad: 1
        }];
      }

      const { signedXml, fechaEmision, fechaHoraFirma } = buildAndSignEcfXml(visit, items);
      const rncEmisor = '131917038';
      const totalNum = Number(visit.total || 0);
      const encf = String(visit.ncf).trim();
      const isE32 = encf.startsWith('E32');

      const ecfClient = new ECF({ key: dgiiPrivateKeyPem, cert: dgiiCertificatePem }, ENVIRONMENT.PROD);
      await ecfClient.authenticate();

      let securityCode = visit.codigo_seguridad_ecf;
      let qrUrl = visit.qr_code_url;

      if (isE32 && totalNum < 250000 && convertECF32ToRFCE) {
        const { xml: rfceRaw, securityCode: code } = convertECF32ToRFCE(signedXml);
        const signature = new Signature(dgiiPrivateKeyPem, dgiiCertificatePem);
        const signedRfce = signature.signXml(rfceRaw, 'RFCE');
        securityCode = code || securityCode;

        const rfceFileName = `${rncEmisor}${encf}.xml`;
        const resp = await ecfClient.sendSummary(signedRfce, rfceFileName);
        console.log(`✅ [DGII TRANSMISIÓN EN TIEMPO REAL E32]: ${encf} -> Estado: ${resp?.estado || 'Aceptado'}`);
        
        qrUrl = `https://fc.dgii.gov.do/eCF/ConsultaTimbreFC?RncEmisor=${rncEmisor}&ENCF=${encf}&MontoTotal=${totalNum.toFixed(2)}&CodigoSeguridad=${securityCode}`;
      } else {
        const fileName = `${rncEmisor}${encf}.xml`;
        const resp = await ecfClient.sendElectronicDocument(signedXml, fileName);
        console.log(`✅ [DGII TRANSMISIÓN EN TIEMPO REAL e-CF]: ${encf} -> TrackID: ${resp?.trackId}`);
        
        qrUrl = `https://fc.dgii.gov.do/eCF/ConsultaTimbre?RncEmisor=${rncEmisor}&RncComprador=${visit.rnc_cliente || ''}&ENCF=${encf}&MontoTotal=${totalNum.toFixed(2)}&FechaEmision=${fechaEmision}&FechaFirma=${fechaHoraFirma}&CodigoSeguridad=${securityCode}`;
      }

      await pool.query(
        'UPDATE visits SET codigo_seguridad_ecf = ?, qr_code_url = ? WHERE id = ?',
        [securityCode, qrUrl, visitId]
      );

      return { success: true, encf, securityCode, qrUrl };
    } catch (err) {
      console.warn(`⚠️ [DGII AUTO-TRANSMIT NOTICE] (${visitId}):`, err.message || err);
      return null;
    }
  }

  async function generateAndTransmitNotaCredito(visit, voidReasonText, userWhoVoided) {
    if (!visit) return null;

    if (typeof visit === 'string' || typeof visit === 'number') {
      const [rows] = await pool.query('SELECT * FROM visits WHERE id = ?', [visit]);
      visit = rows[0];
      if (!visit) return null;
    }

    // Validación Fiscal 1: No generar nota de crédito para facturas sin comprobante o no fiscales
    const originalNcf = (visit.ncf || '').trim();
    const isFiscalNcf = originalNcf && originalNcf !== 'NONE' && (
      originalNcf.startsWith('E31') || 
      originalNcf.startsWith('E32') || 
      originalNcf.startsWith('E34') || 
      originalNcf.startsWith('B')
    );
    if (!isFiscalNcf) {
      console.warn(`⚠️ [DGII NOTA CREDITO OMITIDA]: La visita ${visit.id} no posee e-NCF fiscal válido (NCF='${originalNcf}'). No se emite Nota de Crédito E34.`);
      return null;
    }

    // Validación Fiscal 2: Prevención de doble consumo de secuencia para la misma factura
    if (visit.ncf_nota_credito && visit.nota_credito_track_id) {
      console.warn(`ℹ️ [DGII NOTA CREDITO EXISTENTE]: La visita ${visit.id} ya posee Nota de Crédito transmitida (${visit.ncf_nota_credito}, TrackID: ${visit.nota_credito_track_id}). Reutilizando registro sin consumir secuencia adicional.`);
      return Object.assign(new String(visit.ncf_nota_credito), {
        encf: visit.ncf_nota_credito,
        trackId: visit.nota_credito_track_id,
        signedXml: visit.nota_credito_xml || null,
        alreadyIssued: true
      });
    }

    try {
      const encfE34 = visit.ncf_nota_credito || await allocateNextDgiiSequence('E34');
      if (!encfE34) {
        console.warn('⚠️ [DGII NOTA CREDITO]: No hay secuencias E34 disponibles.');
        return null;
      }

      let items = [];
      if (visit.items_detail) {
        try {
          items = typeof visit.items_detail === 'string' ? JSON.parse(visit.items_detail) : visit.items_detail;
        } catch (_) {}
      }
      if (!items || items.length === 0) {
        items = [{
          nombre: 'Servicio Profesional de Belleza (Anulación)',
          precio: Number(visit.total || 0),
          cantidad: 1
        }];
      }

      const { signedXml } = buildAndSignNotaCreditoXml(visit, encfE34, voidReasonText, items);
      const rncEmisor = '131917038';
      const fileName = `${rncEmisor}${encfE34}.xml`;

      let trackId = null;
      if (dgiiPrivateKeyPem && dgiiCertificatePem && ECF) {
        try {
          const ecfClient = new ECF({ key: dgiiPrivateKeyPem, cert: dgiiCertificatePem }, ENVIRONMENT.PROD);
          await ecfClient.authenticate();
          const resp = await ecfClient.sendElectronicDocument(signedXml, fileName);
          trackId = resp?.trackId || null;
          console.log(`✅ [DGII NOTA DE CRÉDITO TRANSMITIDA]: ${encfE34} modificando ${visit.ncf} -> TrackID: ${trackId}`);
        } catch (txErr) {
          console.error(`⚠️ [DGII NOTA DE CRÉDITO TRANSMISIÓN FALLÓ]: ${encfE34}:`, txErr.message);
        }
      }

      await pool.query(
        `UPDATE visits SET 
          ncf_nota_credito = ?, 
          nota_credito_motivo = ?, 
          nota_credito_fecha = NOW(),
          nota_credito_track_id = ?,
          nota_credito_xml = ?
         WHERE id = ?`,
        [encfE34, voidReasonText, trackId, signedXml, visit.id]
      );

      const result = Object.assign(new String(encfE34), {
        encf: encfE34,
        trackId: trackId,
        signedXml: signedXml
      });

      return result;
    } catch (err) {
      console.error('❌ [DGII NOTA CREDITO ERROR]:', err);
      return null;
    }
  }

  return {
    buildAndSignEcfXml,
    allocateNextDgiiSequence,
    buildAndSignNotaCreditoXml,
    transmitInvoiceDirectlyToDgii,
    generateAndTransmitNotaCredito
  };
}

module.exports = { createDgiiService };
