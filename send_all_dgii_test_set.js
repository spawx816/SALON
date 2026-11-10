/**
 * send_all_dgii_test_set.js
 * Envia automáticamente los 21 Comprobantes (Primero + Segundo) y los 4 Resúmenes RFCE (Tercero)
 * directamente al Web Service de Recepción de la DGII en ambiente CerteCF.
 */

const { ECF, ENVIRONMENT } = require('dgii-ecf');
const forge = require('node-forge');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// 1. Cargar Certificado Digital Oficial
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

async function run() {
  const ecf = new ECF({ key: privateKeyPem, cert: certificatePem }, ENVIRONMENT.CERT);
  
  console.log('1. Autenticando con DGII CerteCF...');
  await ecf.authenticate();
  console.log('✅ Autenticación exitosa.\n');

  // ==========================================
  // GRUPO 1: Comprobantes Generales (18 archivos)
  // ==========================================
  console.log('========================================================');
  console.log('🚀 ENVIANDO GRUPO 1: Comprobantes Generales (18)');
  console.log('========================================================');
  const dir1 = path.resolve(__dirname, 'dgii_test_output/1_Primero_Comprobantes_Generales');
  const files1 = fs.readdirSync(dir1).filter(f => f.endsWith('.xml'));

  for (const file of files1) {
    const filePath = path.join(dir1, file);
    const xmlContent = fs.readFileSync(filePath, 'utf8');
    const fileNameDGII = `131917038${file}`;
    
    try {
      const resp = await ecf.sendElectronicDocument(xmlContent, fileNameDGII);
      console.log(`📡 [Enviado] ${file} -> TrackId: ${resp.trackId}`);
      await sleep(3000);
      const status = await ecf.statusTrackId(resp.trackId);
      console.log(`   📌 Estado DGII: ${status.estado} (Código: ${status.codigo})`);
      if (status.estado === 'Rechazado') {
        console.error('   ❌ Mensaje error:', status.mensajes);
      }
    } catch (e) {
      console.error(`   ❌ Error enviando ${file}:`, e.message, e.response ? e.response.data : '');
    }
  }

  console.log('\n⏳ Esperando 10 segundos para que la DGII registre y consolide los 18 comprobantes en base de datos...');
  await sleep(10000);

  // ==========================================
  // GRUPO 2: Notas de Débito y Crédito (3 archivos)
  // ==========================================
  console.log('\n========================================================');
  console.log('🚀 ENVIANDO GRUPO 2: Notas de Débito y Crédito (3)');
  console.log('========================================================');
  const dir2 = path.resolve(__dirname, 'dgii_test_output/2_Segundo_Notas_Debito_Credito');
  const files2 = ['E330000000001.xml', 'E340000000002.xml', 'E340000000018.xml'];

  for (const file of files2) {
    const filePath = path.join(dir2, file);
    const xmlContent = fs.readFileSync(filePath, 'utf8');
    const fileNameDGII = `131917038${file}`;
    
    try {
      const resp = await ecf.sendElectronicDocument(xmlContent, fileNameDGII);
      console.log(`📡 [Enviado] ${file} -> TrackId: ${resp.trackId}`);
      await sleep(4000);
      const status = await ecf.statusTrackId(resp.trackId);
      console.log(`   📌 Estado DGII: ${status.estado} (Código: ${status.codigo})`);
      if (status.estado === 'Rechazado') {
        console.error('   ❌ Mensaje error:', status.mensajes);
      }
    } catch (e) {
      console.error(`   ❌ Error enviando ${file}:`, e.message, e.response ? e.response.data : '');
    }
  }

  console.log('\n⏳ Esperando 5 segundos antes de enviar los Resúmenes RFCE...');
  await sleep(5000);

  // ==========================================
  // GRUPO 3: Resúmenes de Consumo RFCE (4 archivos)
  // ==========================================
  console.log('\n========================================================');
  console.log('🚀 ENVIANDO GRUPO 3: Resúmenes de Consumo RFCE (4)');
  console.log('========================================================');
  const dir3 = path.resolve(__dirname, 'dgii_test_output/3_Tercero_Resumenes_Consumo_RFCE');
  const files3 = fs.readdirSync(dir3).filter(f => f.endsWith('.xml'));

  for (const file of files3) {
    const filePath = path.join(dir3, file);
    const xmlContent = fs.readFileSync(filePath, 'utf8');
    const encf = file.replace('RFCE_', '');
    const fileNameDGII = `131917038${encf}`;
    
    try {
      const resp = await ecf.sendSummary(xmlContent, fileNameDGII);
      console.log(`📡 [Enviado Resumen] ${file} -> TrackId: ${resp.trackId || JSON.stringify(resp)}`);
      await sleep(3000);
      if (resp.trackId) {
        const status = await ecf.statusTrackId(resp.trackId);
        console.log(`   📌 Estado DGII: ${status.estado} (Código: ${status.codigo})`);
        if (status.estado === 'Rechazado') {
          console.error('   ❌ Mensaje error:', status.mensajes);
        }
      }
    } catch (e) {
      console.error(`   ❌ Error enviando ${file}:`, e.message, e.response ? e.response.data : '');
    }
  }

  console.log('\n========================================================');
  console.log('🎉 PROCESO DE TRANSMISIÓN DE PRUEBAS COMPLETADO');
  console.log('========================================================\n');
}

run();
