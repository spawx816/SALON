/**
 * send_paso3_aprobaciones_comerciales.js
 * Procesa el archivo Excel del Paso 3 de la DGII (131917038-29092026213342.xlsx),
 * genera los 11 XMLs de Aprobación Comercial (ACECF), los firma digitalmente
 * y los envía directamente al Web Service de Aprobación Comercial en CerteCF.
 */

const { ECF, ENVIRONMENT, Signature } = require('dgii-ecf');
const forge = require('node-forge');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// 1. Cargar Certificado Digital
let certPath = process.env.DGII_CERT_PATH ? path.resolve(__dirname, process.env.DGII_CERT_PATH) : path.resolve(__dirname, 'certs/20209102_identity.p12');
if (!fs.existsSync(certPath)) certPath = path.resolve(__dirname, '../20209102_identity.p12');
if (!fs.existsSync(certPath)) certPath = path.resolve(__dirname, 'certs/20209102_identity.p12');

const certPassword = process.env.DGII_CERT_PASSWORD || '';
const p12Buffer = fs.readFileSync(certPath);
const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, certPassword);

let privateKeyPem = null;
let certificatePem = null;

for (const safeContent of p12.safeContents) {
  for (const safeBag of safeContent.safeBags) {
    if (safeBag.key) privateKeyPem = forge.pki.privateKeyToPem(safeBag.key);
    if (safeBag.cert) certificatePem = forge.pki.certificateToPem(safeBag.cert);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function formatMonto(val) {
  if (val === undefined || val === null || val === '') return '0.00';
  const num = parseFloat(val);
  return num.toFixed(2);
}

function buildACECFXml(row) {
  const monto = formatMonto(row.MontoTotal);
  const fechaHora = row.FechaHoraAprobacionComercial || '29-09-2026 21:33:41';
  
  let xml = [];
  xml.push('<?xml version="1.0" encoding="utf-8"?>');
  xml.push('<ACECF xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">');
  xml.push('  <DetalleAprobacionComercial>');
  xml.push(`    <Version>${row.Version || '1.0'}</Version>`);
  xml.push(`    <RNCEmisor>${row.RNCEmisor}</RNCEmisor>`);
  xml.push(`    <eNCF>${row.eNCF}</eNCF>`);
  xml.push(`    <FechaEmision>${row.FechaEmision}</FechaEmision>`);
  xml.push(`    <MontoTotal>${monto}</MontoTotal>`);
  xml.push(`    <RNCComprador>${row.RNCComprador}</RNCComprador>`);
  xml.push(`    <Estado>${row.Estado || '1'}</Estado>`);
  if (row.DetalleMotivoRechazo && String(row.DetalleMotivoRechazo).trim() !== '') {
    xml.push(`    <DetalleMotivoRechazo>${row.DetalleMotivoRechazo}</DetalleMotivoRechazo>`);
  }
  xml.push(`    <FechaHoraAprobacionComercial>${fechaHora}</FechaHoraAprobacionComercial>`);
  xml.push('  </DetalleAprobacionComercial>');
  xml.push('</ACECF>');
  
  return xml.join('\n');
}

async function run() {
  const excelPath = path.resolve(__dirname, '../131917038-29092026213342.xlsx');
  const wb = XLSX.readFile(excelPath);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  
  console.log(`\n================ PASO 3: APROBACIONES COMERCIALES DGII (${rows.length} APROBACIONES) ================`);
  
  const signature = new Signature(privateKeyPem, certificatePem);
  const ecf = new ECF({ key: privateKeyPem, cert: certificatePem }, ENVIRONMENT.CERT);
  
  console.log('1. Autenticando con DGII CerteCF...');
  await ecf.authenticate();
  console.log('✅ Autenticación exitosa.\n');
  
  const outDir = path.resolve(__dirname, 'dgii_test_output/Paso3_Aprobaciones_Comerciales');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  
  let acceptedCount = 0;
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawXml = buildACECFXml(row);
    const signedXml = signature.signXml(rawXml, 'ACECF');
    const fileName = `${row.RNCComprador}${row.eNCF}.xml`;
    const filePath = path.join(outDir, fileName);
    fs.writeFileSync(filePath, signedXml, 'utf8');
    
    try {
      console.log(`📡 [${i + 1}/${rows.length}] Enviando Aprobación Comercial: ${row.eNCF} (Monto: ${row.MontoTotal})...`);
      const resp = await ecf.sendCommercialApproval(signedXml, fileName);
      console.log(`   📌 Respuesta DGII:`, JSON.stringify(resp));
      if (resp && (resp.estado === 'Aceptado' || resp.codigo === 1 || resp.codigo === '1' || resp.mensaje === 'Aprobación Comercial Aceptada')) {
        acceptedCount++;
      }
      await sleep(2500);
    } catch (e) {
      console.error(`   ❌ Error enviando ${row.eNCF}:`, e.message, e.response ? e.response.data : '');
    }
  }
  
  console.log('\n========================================================================');
  console.log(`🎉 PROCESO COMPLETADO: ${acceptedCount}/${rows.length} Aprobaciones Comerciales Procesadas`);
  console.log('========================================================================\n');
}

run();
