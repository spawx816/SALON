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

  function buildAndSignEcfXml(visit, items) {
    const encf = visit.ncf || 'E320000000001';
    const tipoEcf = encf.startsWith('E31') ? '31' : '32';
    const total = Number(visit.total || 0);
    const dateObj = new Date(visit.visited_at || Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    const fechaEmision = `${pad(dateObj.getDate())}-${pad(dateObj.getMonth() + 1)}-${dateObj.getFullYear()}`;
    const fechaHoraFirma = `${fechaEmision} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}:${pad(dateObj.getSeconds())}`;

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
      <PrecioUnitarioItem>${precio.toFixed(2)}</PrecioUnitarioItem>
      <MontoItem>${itemTotal.toFixed(2)}</MontoItem>
    </Item>`;
    }).join('\n');

    const rawXml = `<?xml version="1.0" encoding="utf-8"?>
<ECF>
  <Encabezado>
    <Version>1.0</Version>
    <IdDoc>
      <TipoeCF>${tipoEcf}</TipoeCF>
      <eNCF>${encf}</eNCF>
      <FechaVencimientoSecuencia>31-12-2026</FechaVencimientoSecuencia>
      <IndicadorMontoGravado>0</IndicadorMontoGravado>
      <TipoIngresos>01</TipoIngresos>
      <TipoPago>1</TipoPago>
      <FechaEmision>${fechaEmision}</FechaEmision>
    </IdDoc>
    <Emisor>
      <RNCEmisor>131917038</RNCEmisor>
      <RazonSocialEmisor>ETEREAS SRL</RazonSocialEmisor>
      <NombreComercial>ETÉREAS</NombreComercial>
      <Sucursal>01</Sucursal>
      <DireccionEmisor>LOS PALMEROS, No. 3, APTO. PLAZA BRAVO, BARRIO NUEVO</DireccionEmisor>
      <Municipio>Santo Domingo Este</Municipio>
      <Provincia>Santo Domingo</Provincia>
      <TelefonoEmisor>8095615000</TelefonoEmisor>
      <CorreoEmisor>hola@planbeautyrd.com</CorreoEmisor>
      <FechaEmision>${fechaEmision}</FechaEmision>
    </Emisor>
    <Comprador>
      <RNCComprador>${escapeXml(visit.rnc_cliente || '')}</RNCComprador>
      <RazonSocialComprador>${escapeXml(visit.rzn_soc_cliente || visit.client_name || 'CONSUMIDOR FINAL')}</RazonSocialComprador>
    </Comprador>
    <Totales>
      <MontoTotal>${total.toFixed(2)}</MontoTotal>
      <MontoGravadoTotal>0.00</MontoGravadoTotal>
      <MontoGravadoI1>0.00</MontoGravadoI1>
      <MontoExento>${total.toFixed(2)}</MontoExento>
      <TotalITBIS>0.00</TotalITBIS>
      <TotalITBIS1>0.00</TotalITBIS1>
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
    try {
      const [batches] = await pool.query(
        `SELECT * FROM dgii_ncf_sequences 
         WHERE tipo_comprobante = ? AND estado = 'Activo' AND cantidad_usada < cantidad_aprobada 
         ORDER BY id ASC LIMIT 1`,
        [tipo]
      );

      if (batches.length === 0) {
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

      await pool.query(
        `UPDATE dgii_ncf_sequences 
         SET cantidad_usada = ?, secuencia_actual = ?, estado = ?, updated_at = NOW() 
         WHERE id = ?`,
        [newCantidadUsada, newSecuenciaActual, newEstado, seq.id]
      );

      console.log(`✅ [DGII NOTA CRÉDITO SECUENCIA]: Asignado ${encfNumber} (Usados ${newCantidadUsada}/${seq.cantidad_aprobada})`);
      return encfNumber;
    } catch (err) {
      console.error('[DGII ALLOCATE SEQUENCE ERROR]:', err);
      return null;
    }
  }

  function buildAndSignNotaCreditoXml(visit, encfE34, voidReasonText, items) {
    const total = Number(visit.total || 0);
    const dateObj = new Date();
    const origDateObj = new Date(visit.visited_at || Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    const fechaEmision = `${pad(dateObj.getDate())}-${pad(dateObj.getMonth() + 1)}-${dateObj.getFullYear()}`;
    const fechaNCFModificado = `${pad(origDateObj.getDate())}-${pad(origDateObj.getMonth() + 1)}-${origDateObj.getFullYear()}`;
    const fechaHoraFirma = `${fechaEmision} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}:${pad(dateObj.getSeconds())}`;

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
        <PrecioUnitarioItem>${precio.toFixed(2)}</PrecioUnitarioItem>
        <MontoItem>${itemTotal.toFixed(2)}</MontoItem>
      </Item>`;
    }).join('\n');

    const rawXml = `<?xml version="1.0" encoding="utf-8"?>
<ECF>
  <Encabezado>
    <Version>1.0</Version>
    <IdDoc>
      <TipoeCF>34</TipoeCF>
      <eNCF>${encfE34}</eNCF>
      <FechaVencimientoSecuencia>31-12-2028</FechaVencimientoSecuencia>
      <IndicadorMontoGravado>0</IndicadorMontoGravado>
      <TipoIngresos>01</TipoIngresos>
      <TipoPago>1</TipoPago>
      <FechaEmision>${fechaEmision}</FechaEmision>
    </IdDoc>
    <Emisor>
      <RNCEmisor>131917038</RNCEmisor>
      <RazonSocialEmisor>ETEREAS SRL</RazonSocialEmisor>
      <NombreComercial>ETÉREAS</NombreComercial>
      <DireccionEmisor>LOS PALMEROS, No. 3, APTO. PLAZA BRAVO, BARRIO NUEVO</DireccionEmisor>
      <FechaEmision>${fechaEmision}</FechaEmision>
    </Emisor>
    <Comprador>
      <RNCComprador>${visit.rnc_cliente || ''}</RNCComprador>
      <RazonSocialComprador>${escapeXml(visit.rzn_soc_cliente || visit.client_name || 'CONSUMIDOR FINAL')}</RazonSocialComprador>
    </Comprador>
    <Totales>
      <MontoGravadoTotal>0.00</MontoGravadoTotal>
      <MontoExento>${total.toFixed(2)}</MontoExento>
      <TotalITBIS>0.00</TotalITBIS>
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
    if (!visit || !visit.ncf) return null;
    try {
      const encfE34 = await allocateNextDgiiSequence('E34');
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

      if (dgiiPrivateKeyPem && dgiiCertificatePem && ECF) {
        const ecfClient = new ECF({ key: dgiiPrivateKeyPem, cert: dgiiCertificatePem }, ENVIRONMENT.PROD);
        await ecfClient.authenticate();
        const resp = await ecfClient.sendElectronicDocument(signedXml, fileName);
        console.log(`✅ [DGII NOTA DE CRÉDITO TRANSMITIDA]: ${encfE34} modificando ${visit.ncf} -> TrackID: ${resp?.trackId}`);
      }

      await pool.query(
        `UPDATE visits SET 
          ncf_nota_credito = ?, 
          nota_credito_motivo = ?, 
          nota_credito_fecha = NOW() 
         WHERE id = ?`,
        [encfE34, voidReasonText, visit.id]
      );

      return encfE34;
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
