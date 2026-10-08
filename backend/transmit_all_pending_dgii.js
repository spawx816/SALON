const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
const forge = require('node-forge');
const { ECF, ENVIRONMENT, convertECF32ToRFCE, Signature } = require('dgii-ecf');
require('dotenv').config({ path: path.join(__dirname, '.env') });

let dgiiCertPath = process.env.DGII_CERT_PATH ? path.resolve(__dirname, process.env.DGII_CERT_PATH) : path.resolve(__dirname, 'certs/20209102_identity.p12');
if (!fs.existsSync(dgiiCertPath)) dgiiCertPath = path.resolve(__dirname, '../20209102_identity.p12');
if (!fs.existsSync(dgiiCertPath)) dgiiCertPath = path.resolve(__dirname, 'certs/20209102_identity.p12');

const dgiiCertPassword = process.env.DGII_CERT_PASSWORD || 'Amelia29';
let dgiiPrivateKeyPem = null;
let dgiiCertificatePem = null;

try {
  if (fs.existsSync(dgiiCertPath)) {
    const p12Buffer = fs.readFileSync(dgiiCertPath);
    const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, dgiiCertPassword);

    for (const safeContent of p12.safeContents) {
      for (const safeBag of safeContent.safeBags) {
        if (safeBag.key) dgiiPrivateKeyPem = forge.pki.privateKeyToPem(safeBag.key);
        if (safeBag.cert) dgiiCertificatePem = forge.pki.certificateToPem(safeBag.cert);
      }
    }
    console.log('✅ Certificado oficial cargado.');
  }
} catch (e) {
  console.error('❌ Error cargando certificado:', e.message);
  process.exit(1);
}

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildAndSignEcfXml(visit, items) {
  const encf = visit.ncf;
  const tipoEcf = encf.startsWith('E31') ? '31' : '32';
  const total = Number(visit.total || 0);
  const dateObj = new Date(visit.visited_at || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  const fechaEmision = `${pad(dateObj.getDate())}-${pad(dateObj.getMonth() + 1)}-${dateObj.getFullYear()}`;
  const fechaHoraFirma = `${fechaEmision} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}:${pad(dateObj.getSeconds())}`;

  const itemsXml = items.map((item, idx) => {
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
      <FechaVencimientoSecuencia>31-12-2027</FechaVencimientoSecuencia>
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
  <FechaHoraFirma>${fechaHoraFirma}</FechaHoraFirma>
</ECF>`;

  const signature = new Signature(dgiiPrivateKeyPem, dgiiCertificatePem);
  const signed = signature.signXml(rawXml, 'ECF');
  return { signedXml: signed, fechaHoraFirma, fechaEmision };
}

async function transmitAll() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  const ecfClient = new ECF({ key: dgiiPrivateKeyPem, cert: dgiiCertificatePem }, ENVIRONMENT.PROD);
  console.log('Autenticando con Web Service DGII...');
  await ecfClient.authenticate();
  console.log('✅ Autenticado con DGII exitosamente.');

  const [visits] = await pool.query(`
    SELECT * FROM visits 
    WHERE ncf IS NOT NULL AND status != 'Anulado' 
    ORDER BY visited_at DESC
  `);

  console.log(`Enviando ${visits.length} facturas a la DGII...`);

  for (const visit of visits) {
    try {
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

      let securityCode = visit.codigo_seguridad_ecf;
      let qrUrl = visit.qr_code_url;

      if (isE32 && totalNum < 250000) {
        const { xml: rfceRaw, securityCode: code } = convertECF32ToRFCE(signedXml);
        const signature = new Signature(dgiiPrivateKeyPem, dgiiCertificatePem);
        const signedRfce = signature.signXml(rfceRaw, 'RFCE');
        securityCode = code || securityCode;

        const rfceFileName = `${rncEmisor}${encf}.xml`;
        const resp = await ecfClient.sendSummary(signedRfce, rfceFileName);
        console.log(`✅ [DGII E32 ENVIADO]: ${encf} (${visit.ticket_number}) -> Estado: ${resp?.estado || 'Aceptado'}`);

        qrUrl = `https://fc.dgii.gov.do/eCF/ConsultaTimbreFC?RncEmisor=${rncEmisor}&ENCF=${encf}&MontoTotal=${totalNum.toFixed(2)}&CodigoSeguridad=${securityCode}`;
      } else {
        const fileName = `${rncEmisor}${encf}.xml`;
        const resp = await ecfClient.sendElectronicDocument(signedXml, fileName);
        console.log(`✅ [DGII e-CF ENVIADO]: ${encf} (${visit.ticket_number}) -> TrackID: ${resp?.trackId}`);

        qrUrl = `https://fc.dgii.gov.do/eCF/ConsultaTimbre?RncEmisor=${rncEmisor}&RncComprador=${visit.rnc_cliente || ''}&ENCF=${encf}&MontoTotal=${totalNum.toFixed(2)}&FechaEmision=${fechaEmision}&FechaFirma=${fechaHoraFirma}&CodigoSeguridad=${securityCode}`;
      }

      await pool.query(
        'UPDATE visits SET codigo_seguridad_ecf = ?, qr_code_url = ? WHERE id = ?',
        [securityCode, qrUrl, visit.id]
      );
    } catch (e) {
      console.warn(`⚠️ Error enviando ${visit.ncf} (${visit.ticket_number}):`, e.message);
    }
  }

  console.log('🎉 Transmisión completada.');
  process.exit(0);
}

transmitAll().catch(console.error);
