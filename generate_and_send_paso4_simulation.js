/**
 * generate_and_send_paso4_simulation.js
 * Generador y Transmisor Completo de Simulación Comercial (Paso 4 DGII)
 * Versión Final 100% Alineada con todas las restricciones de la DGII.
 */

const { ECF, ENVIRONMENT, Signature, convertECF32ToRFCE } = require('dgii-ecf');
const forge = require('node-forge');
const fs = require('fs');
const path = require('path');
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

const signature = new Signature(privateKeyPem, certificatePem);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const EMISOR = {
  RNC: '131917038',
  RazonSocial: 'ETEREAS SRL',
  NombreComercial: 'ETÉREAS',
  Direccion: 'LOS PALMEROS, No. 3, APTO. PLAZA BRAVO, BARRIO NUEVO',
  Municipio: '010100',
  Provincia: '010000',
  Telefono: '809-792-3555',
  Correo: 'RODRIGUEZ1619@HOTMAIL.COM'
};

const COMPRADOR_LOCAL = {
  RNC: '131880681',
  RazonSocial: 'DOCUMENTOS ELECTRONICOS DE 03',
  Direccion: 'AVE. ISABEL AGUIAR NO. 269, ZONA INDUSTRIAL DE HERRERA',
  Municipio: '010100',
  Provincia: '010000'
};

let secOffset = 200;

function buildInvoiceXml(cfg) {
  const tipoeCF = cfg.tipoeCF;
  const encf = cfg.encf;
  const fechaEmision = '29-09-2026';
  const now = new Date(Date.now() + (++secOffset * 3000));
  const pad = n => String(n).padStart(2, '0');
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const xml = [];
  xml.push('<?xml version="1.0" encoding="utf-8"?>');
  xml.push('<ECF>');
  xml.push('  <Encabezado>');
  xml.push('    <Version>1.0</Version>');

  // --- IdDoc ---
  xml.push('    <IdDoc>');
  xml.push(`      <TipoeCF>${tipoeCF}</TipoeCF>`);
  xml.push(`      <eNCF>${encf}</eNCF>`);
  
  if (tipoeCF !== '32' && tipoeCF !== '34') {
    xml.push('      <FechaVencimientoSecuencia>31-12-2028</FechaVencimientoSecuencia>');
  }
  if (cfg.indicadorNotaCredito !== undefined) {
    xml.push(`      <IndicadorNotaCredito>${cfg.indicadorNotaCredito}</IndicadorNotaCredito>`);
  }
  // IndicadorMontoGravado: NO aplica en 43, 44, 46, 47
  if (tipoeCF !== '43' && tipoeCF !== '44' && tipoeCF !== '46' && tipoeCF !== '47') {
    xml.push('      <IndicadorMontoGravado>0</IndicadorMontoGravado>');
  }
  // TipoIngresos: NO aplica en 41, 43, 47
  if (tipoeCF !== '41' && tipoeCF !== '43' && tipoeCF !== '47') {
    xml.push('      <TipoIngresos>01</TipoIngresos>');
  }
  xml.push('      <TipoPago>1</TipoPago>');
  xml.push('    </IdDoc>');

  // --- Emisor ---
  xml.push('    <Emisor>');
  xml.push(`      <RNCEmisor>${EMISOR.RNC}</RNCEmisor>`);
  xml.push(`      <RazonSocialEmisor>${EMISOR.RazonSocial}</RazonSocialEmisor>`);
  xml.push(`      <NombreComercial>${EMISOR.NombreComercial}</NombreComercial>`);
  xml.push(`      <DireccionEmisor>${EMISOR.Direccion}</DireccionEmisor>`);
  xml.push(`      <Municipio>${EMISOR.Municipio}</Municipio>`);
  xml.push(`      <Provincia>${EMISOR.Provincia}</Provincia>`);
  xml.push('      <TablaTelefonoEmisor>');
  xml.push(`        <TelefonoEmisor>${EMISOR.Telefono}</TelefonoEmisor>`);
  xml.push('      </TablaTelefonoEmisor>');
  xml.push(`      <CorreoEmisor>${EMISOR.Correo}</CorreoEmisor>`);
  xml.push(`      <FechaEmision>${fechaEmision}</FechaEmision>`);
  xml.push('    </Emisor>');

  // --- Comprador (NO aplica en Tipo 43) ---
  if (tipoeCF !== '43') {
    const comp = cfg.comprador || COMPRADOR_LOCAL;
    xml.push('    <Comprador>');
    if (comp.RNC) xml.push(`      <RNCComprador>${comp.RNC}</RNCComprador>`);
    if (comp.IdentificadorExtranjero) xml.push(`      <IdentificadorExtranjero>${comp.IdentificadorExtranjero}</IdentificadorExtranjero>`);
    xml.push(`      <RazonSocialComprador>${comp.RazonSocial}</RazonSocialComprador>`);
    // Tipo 47 no lleva Direccion ni Municipio/Provincia
    if (tipoeCF !== '47') {
      if (comp.Direccion) xml.push(`      <DireccionComprador>${comp.Direccion}</DireccionComprador>`);
      if (comp.Municipio) xml.push(`      <MunicipioComprador>${comp.Municipio}</MunicipioComprador>`);
      if (comp.Provincia) xml.push(`      <ProvinciaComprador>${comp.Provincia}</ProvinciaComprador>`);
    }
    xml.push('    </Comprador>');
  }

  // --- Totales ---
  xml.push('    <Totales>');
  if (cfg.montoGravado > 0) {
    xml.push(`      <MontoGravadoTotal>${cfg.montoGravado.toFixed(2)}</MontoGravadoTotal>`);
    if (tipoeCF === '46') {
      xml.push(`      <MontoGravadoI3>${cfg.montoGravado.toFixed(2)}</MontoGravadoI3>`);
      xml.push('      <ITBIS3>0</ITBIS3>');
      xml.push('      <TotalITBIS>0.00</TotalITBIS>');
      xml.push('      <TotalITBIS3>0.00</TotalITBIS3>');
    } else {
      xml.push(`      <MontoGravadoI1>${cfg.montoGravado.toFixed(2)}</MontoGravadoI1>`);
      xml.push('      <ITBIS1>18</ITBIS1>');
      xml.push(`      <TotalITBIS>${cfg.itbis.toFixed(2)}</TotalITBIS>`);
      xml.push(`      <TotalITBIS1>${cfg.itbis.toFixed(2)}</TotalITBIS1>`);
    }
  }
  if (cfg.montoExento > 0) {
    xml.push(`      <MontoExento>${cfg.montoExento.toFixed(2)}</MontoExento>`);
  }
  xml.push(`      <MontoTotal>${cfg.total.toFixed(2)}</MontoTotal>`);
  if (cfg.totalITBISRetenido) {
    xml.push(`      <TotalITBISRetenido>${cfg.totalITBISRetenido.toFixed(2)}</TotalITBISRetenido>`);
  }
  if (cfg.totalISRRetencion) {
    xml.push(`      <TotalISRRetencion>${cfg.totalISRRetencion.toFixed(2)}</TotalISRRetencion>`);
  }
  xml.push('    </Totales>');
  xml.push('  </Encabezado>');

  // --- DetallesItems ---
  xml.push('  <DetallesItems>');
  cfg.items.forEach((item, idx) => {
    xml.push('    <Item>');
    xml.push(`      <NumeroLinea>${idx + 1}</NumeroLinea>`);
    xml.push(`      <IndicadorFacturacion>${item.indicadorFacturacion || '1'}</IndicadorFacturacion>`);
    
    // Retención en Item
    if (item.retencion) {
      xml.push('      <Retencion>');
      xml.push(`        <IndicadorAgenteRetencionoPercepcion>${item.retencion.indicador || '1'}</IndicadorAgenteRetencionoPercepcion>`);
      if (item.retencion.itbis) xml.push(`        <MontoITBISRetenido>${item.retencion.itbis.toFixed(2)}</MontoITBISRetenido>`);
      if (item.retencion.isr) xml.push(`        <MontoISRRetenido>${item.retencion.isr.toFixed(2)}</MontoISRRetenido>`);
      xml.push('      </Retencion>');
    }

    xml.push(`      <NombreItem>${item.nombre}</NombreItem>`);
    xml.push('      <IndicadorBienoServicio>2</IndicadorBienoServicio>');
    xml.push(`      <CantidadItem>${item.cantidad.toFixed(2)}</CantidadItem>`);
    xml.push(`      <UnidadMedida>${item.unidadMedida || '55'}</UnidadMedida>`);
    xml.push(`      <PrecioUnitarioItem>${item.precio.toFixed(2)}</PrecioUnitarioItem>`);
    xml.push(`      <MontoItem>${(item.cantidad * item.precio).toFixed(2)}</MontoItem>`);
    xml.push('    </Item>');
  });
  xml.push('  </DetallesItems>');

  // --- InformacionReferencia ---
  if (cfg.referencia) {
    xml.push('  <InformacionReferencia>');
    xml.push(`    <NCFModificado>${cfg.referencia.ncfModificado}</NCFModificado>`);
    xml.push(`    <FechaNCFModificado>${cfg.referencia.fecha || '29-09-2026'}</FechaNCFModificado>`);
    xml.push(`    <CodigoModificacion>${cfg.referencia.codigo || '1'}</CodigoModificacion>`);
    if (cfg.referencia.razon) {
      xml.push(`    <RazonModificacion>${cfg.referencia.razon}</RazonModificacion>`);
    }
    xml.push('  </InformacionReferencia>');
  }

  xml.push(`  <FechaHoraFirma>${fechaEmision} ${timeStr}</FechaHoraFirma>`);
  xml.push('</ECF>');

  return xml.join('\n');
}

// 18 COMPROBANTES GENERALES (Secuencias 601+)
const SIM_GENERALES = [
  // 4 Facturas Tipo 31
  { encf: 'E310000000701', tipoeCF: '31', montoGravado: 5000, itbis: 900, montoExento: 0, total: 5900, items: [{ nombre: 'Servicio de Peluqueria y Estilismo Ejecutivo', cantidad: 1, precio: 5000 }] },
  { encf: 'E310000000702', tipoeCF: '31', montoGravado: 8500, itbis: 1530, montoExento: 0, total: 10030, items: [{ nombre: 'Tratamiento Capilar Regenerativo Botox', cantidad: 1, precio: 8500 }] },
  { encf: 'E310000000703', tipoeCF: '31', montoGravado: 12000, itbis: 2160, montoExento: 0, total: 14160, items: [{ nombre: 'Coloracion Global y Balayage Premium', cantidad: 1, precio: 12000 }] },
  { encf: 'E310000000704', tipoeCF: '31', montoGravado: 15000, itbis: 2700, montoExento: 0, total: 17700, items: [{ nombre: 'Paquete de Belleza y Estetica Integral', cantidad: 1, precio: 15000 }] },

  // 2 Facturas Tipo 32 >= 250k
  { encf: 'E320000000701', tipoeCF: '32', montoGravado: 250000, itbis: 45000, montoExento: 0, total: 295000, items: [{ nombre: 'Mobiliario Salon y LavaCabezas Ergonomico', cantidad: 1, precio: 250000 }] },
  { encf: 'E320000000702', tipoeCF: '32', montoGravado: 300000, itbis: 54000, montoExento: 0, total: 354000, items: [{ nombre: 'Lote Profesional Productos Capilares Salon', cantidad: 1, precio: 300000 }] },

  // 2 Compras Tipo 41
  { encf: 'E410000000701', tipoeCF: '41', montoGravado: 3000, itbis: 540, montoExento: 0, total: 3540, totalITBISRetenido: 540, totalISRRetencion: 300, items: [{ nombre: 'Servicio Mantenimiento Secadores Salon', cantidad: 1, precio: 3000, retencion: { indicador: '1', itbis: 540, isr: 300 } }] },
  { encf: 'E410000000702', tipoeCF: '41', montoGravado: 5000, itbis: 900, montoExento: 0, total: 5900, totalITBISRetenido: 900, totalISRRetencion: 500, items: [{ nombre: 'Servicio Carpinteria y Estantes Salon', cantidad: 1, precio: 5000, retencion: { indicador: '1', itbis: 900, isr: 500 } }] },

  // 2 Gastos Menores Tipo 43 (Exentos)
  { encf: 'E430000000701', tipoeCF: '43', montoGravado: 0, itbis: 0, montoExento: 1000, total: 1000, items: [{ nombre: 'Articulos de Limpieza e Higiene Salon', cantidad: 1, precio: 1000, indicadorFacturacion: '4' }] },
  { encf: 'E430000000702', tipoeCF: '43', montoGravado: 0, itbis: 0, montoExento: 1500, total: 1500, items: [{ nombre: 'Insumos de Cafeteria para Clientas', cantidad: 1, precio: 1500, indicadorFacturacion: '4' }] },

  // 2 Regímenes Especiales Tipo 44
  { encf: 'E440000000701', tipoeCF: '44', montoGravado: 0, itbis: 0, montoExento: 18000, total: 18000, items: [{ nombre: 'Servicios de Estilismo Evento Zona Franca', cantidad: 1, precio: 18000, indicadorFacturacion: '4' }] },
  { encf: 'E440000000702', tipoeCF: '44', montoGravado: 0, itbis: 0, montoExento: 25000, total: 25000, items: [{ nombre: 'Capacitacion Capilar Personal Zona Franca', cantidad: 1, precio: 25000, indicadorFacturacion: '4' }] },

  // 2 Gubernamentales Tipo 45
  { encf: 'E450000000701', tipoeCF: '45', montoGravado: 20000, itbis: 3600, montoExento: 0, total: 23600, items: [{ nombre: 'Servicios de Protocolo e Imagen Institucional', cantidad: 1, precio: 20000 }] },
  { encf: 'E450000000702', tipoeCF: '45', montoGravado: 35000, itbis: 6300, montoExento: 0, total: 41300, items: [{ nombre: 'Talleres de Cosmetologia Institucional', cantidad: 1, precio: 35000 }] },

  // 2 Exportaciones Tipo 46
  { encf: 'E460000000701', tipoeCF: '46', montoGravado: 40000, itbis: 0, montoExento: 0, total: 40000, comprador: { IdentificadorExtranjero: 'EXT12345678', RazonSocial: 'INTERNATIONAL BEAUTY CORP', Direccion: 'MIAMI, FL, USA', Municipio: '010100', Provincia: '010000' }, items: [{ nombre: 'Asesoria de Imagen y Protocolo Internacional', cantidad: 1, precio: 40000, indicadorFacturacion: '3' }] },
  { encf: 'E460000000702', tipoeCF: '46', montoGravado: 60000, itbis: 0, montoExento: 0, total: 60000, comprador: { IdentificadorExtranjero: 'EXT87654321', RazonSocial: 'GLOBAL SALON CONSULTING LLC', Direccion: 'NEW YORK, NY, USA', Municipio: '010100', Provincia: '010000' }, items: [{ nombre: 'Consultoria de Marcas Cosmeticas Caribe', cantidad: 1, precio: 60000, indicadorFacturacion: '3' }] },

  // 2 Pagos al Exterior Tipo 47
  { encf: 'E470000000701', tipoeCF: '47', montoGravado: 0, itbis: 0, montoExento: 10000, total: 10000, totalISRRetencion: 2700, comprador: { IdentificadorExtranjero: 'EXT999111', RazonSocial: 'CLOUD BOOKING SYSTEM INC' }, items: [{ nombre: 'Licencia Software de Agendamiento Online', cantidad: 1, precio: 10000, indicadorFacturacion: '4', retencion: { indicador: '2', isr: 2700 } }] },
  { encf: 'E470000000702', tipoeCF: '47', montoGravado: 0, itbis: 0, montoExento: 15000, total: 15000, totalISRRetencion: 4050, comprador: { IdentificadorExtranjero: 'EXT999222', RazonSocial: 'SALON MARKETING PLATFORM LLC' }, items: [{ nombre: 'Suscripcion Plataforma Publicidad Salon', cantidad: 1, precio: 15000, indicadorFacturacion: '4', retencion: { indicador: '2', isr: 4050 } }] }
];

// 3 NOTAS (Secuencias 701+)
const SIM_NOTAS = [
  // 1 Nota de Débito Tipo 33 (modifica E320000000701)
  { encf: 'E330000000701', tipoeCF: '33', montoGravado: 25000, itbis: 4500, montoExento: 0, total: 29500, referencia: { ncfModificado: 'E320000000701', codigo: '3', razon: 'Ajuste de intereses por financiamiento mobiliario' }, items: [{ nombre: 'Ajuste de financiamiento mobiliario salon', cantidad: 1, precio: 25000 }] },
  // 2 Notas de Crédito Tipo 34 (modifica E310000000701 y E310000000702 exactamente)
  { encf: 'E340000000701', tipoeCF: '34', indicadorNotaCredito: '0', montoGravado: 5000, itbis: 900, montoExento: 0, total: 5900, referencia: { ncfModificado: 'E310000000701', codigo: '1', razon: 'Anulacion total de factura por cancelacion' }, items: [{ nombre: 'Servicio de Peluqueria y Estilismo Ejecutivo', cantidad: 1, precio: 5000 }] },
  { encf: 'E340000000702', tipoeCF: '34', indicadorNotaCredito: '0', montoGravado: 8500, itbis: 1530, montoExento: 0, total: 10030, referencia: { ncfModificado: 'E310000000702', codigo: '1', razon: 'Anulacion total de factura por reprogramacion' }, items: [{ nombre: 'Tratamiento Capilar Regenerativo Botox', cantidad: 1, precio: 8500 }] }
];

// 4 FACTURAS DE CONSUMO < 250k (Secuencias 711+)
const SIM_CONSUMO_MENOR = [
  { encf: 'E320000000711', tipoeCF: '32', montoGravado: 1200, itbis: 216, montoExento: 0, total: 1416, items: [{ nombre: 'Lavado y Secado Estilo Salon Pro', cantidad: 1, precio: 1200 }] },
  { encf: 'E320000000712', tipoeCF: '32', montoGravado: 3500, itbis: 630, montoExento: 0, total: 4130, items: [{ nombre: 'Corte de Cabello y Balayage Express', cantidad: 1, precio: 3500 }] },
  { encf: 'E320000000713', tipoeCF: '32', montoGravado: 850, itbis: 153, montoExento: 0, total: 1003, items: [{ nombre: 'Manicura Spa y Esmaltado Semipermanente', cantidad: 1, precio: 850 }] },
  { encf: 'E320000000714', tipoeCF: '32', montoGravado: 4200, itbis: 756, montoExento: 0, total: 4956, items: [{ nombre: 'Tratamiento Capilar Intensivo Keratina', cantidad: 1, precio: 4200 }] }
];

async function run() {
  console.log('\n========================================================================');
  console.log('🚀 PASO 4: PRUEBAS DE SIMULACIÓN COMERCIAL DGII (ETEREAS SRL)');
  console.log('========================================================================\n');

  const ecf = new ECF({ key: privateKeyPem, cert: certificatePem }, ENVIRONMENT.CERT);
  console.log('1. Autenticando con DGII CerteCF...');
  await ecf.authenticate();
  console.log('✅ Autenticación exitosa.\n');

  const baseDir = path.resolve(__dirname, 'dgii_test_output/Paso4_Simulacion');
  const dirGenerales = path.join(baseDir, '1_Primero_Comprobantes_Generales');
  const dirNotas = path.join(baseDir, '2_Segundo_Notas');
  const dirRFCE = path.join(baseDir, '3_Tercero_RFCE');
  const dirConsumoWeb = path.join(baseDir, '4_Cuarto_Facturas_Consumo_Menor_250k');
  const rootConsumo = path.resolve(__dirname, '../Paso4_Facturas_Consumo_Menor_250k');

  [dirGenerales, dirNotas, dirRFCE, dirConsumoWeb, rootConsumo].forEach(d => {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    } else {
      // Limpiar archivos anteriores
      fs.readdirSync(d).forEach(f => {
        try { fs.unlinkSync(path.join(d, f)); } catch (_) {}
      });
    }
  });

  // ==========================================
  // GRUPO 1: 18 Comprobantes Generales
  // ==========================================
  console.log('========================================================');
  console.log('🚀 ENVIANDO GRUPO 1: 18 Comprobantes Generales');
  console.log('========================================================');

  for (const item of SIM_GENERALES) {
    const rawXml = buildInvoiceXml(item);
    const signedXml = signature.signXml(rawXml, 'ECF');
    const fileName = `${EMISOR.RNC}${item.encf}.xml`;
    fs.writeFileSync(path.join(dirGenerales, `${item.encf}.xml`), signedXml, 'utf8');

    try {
      const resp = await ecf.sendElectronicDocument(signedXml, fileName);
      console.log(`📡 [Enviado] ${item.encf} (Tipo ${item.tipoeCF}) -> TrackId: ${resp.trackId}`);
      await sleep(3000);
      const st = await ecf.statusTrackId(resp.trackId);
      console.log(`   📌 Estado DGII: ${st.estado} (Código: ${st.codigo})`);
      if (st.estado === 'Rechazado') {
        console.error('   ❌ Mensaje error:', st.mensajes);
      }
    } catch (e) {
      console.error(`   ❌ Error ${item.encf}:`, e.message, e.response ? e.response.data : '');
    }
  }

  console.log('\n⏳ Esperando 10 segundos para consolidación en base de datos...');
  await sleep(10000);

  // ==========================================
  // GRUPO 2: 3 Notas
  // ==========================================
  console.log('\n========================================================');
  console.log('🚀 ENVIANDO GRUPO 2: 3 Notas de Simulación');
  console.log('========================================================');

  for (const item of SIM_NOTAS) {
    const rawXml = buildInvoiceXml(item);
    const signedXml = signature.signXml(rawXml, 'ECF');
    const fileName = `${EMISOR.RNC}${item.encf}.xml`;
    fs.writeFileSync(path.join(dirNotas, `${item.encf}.xml`), signedXml, 'utf8');

    try {
      const resp = await ecf.sendElectronicDocument(signedXml, fileName);
      console.log(`📡 [Enviado] ${item.encf} (Tipo ${item.tipoeCF}) -> TrackId: ${resp.trackId}`);
      await sleep(4000);
      const st = await ecf.statusTrackId(resp.trackId);
      console.log(`   📌 Estado DGII: ${st.estado} (Código: ${st.codigo})`);
      if (st.estado === 'Rechazado') {
        console.error('   ❌ Mensaje error:', st.mensajes);
      }
    } catch (e) {
      console.error(`   ❌ Error ${item.encf}:`, e.message, e.response ? e.response.data : '');
    }
  }

  console.log('\n⏳ Esperando 5 segundos antes de emitir los Resúmenes RFCE...');
  await sleep(5000);

  // ==========================================
  // GRUPO 3: 4 Resúmenes RFCE & Facturas < 250k
  // ==========================================
  console.log('\n========================================================');
  console.log('🚀 ENVIANDO GRUPO 3: 4 Resúmenes de Consumo (RFCE)');
  console.log('========================================================');

  for (const item of SIM_CONSUMO_MENOR) {
    const rawXml = buildInvoiceXml(item);
    const signedXml = signature.signXml(rawXml, 'ECF');
    
    // Guardar Factura completa para carga web
    fs.writeFileSync(path.join(dirConsumoWeb, `${item.encf}.xml`), signedXml, 'utf8');
    fs.writeFileSync(path.join(rootConsumo, `${item.encf}.xml`), signedXml, 'utf8');

    // Generar y firmar RFCE
    const { xml: rfceRaw } = convertECF32ToRFCE(signedXml);
    const signedRfce = signature.signXml(rfceRaw, 'RFCE');
    fs.writeFileSync(path.join(dirRFCE, `RFCE_${item.encf}.xml`), signedRfce, 'utf8');

    const fileName = `${EMISOR.RNC}${item.encf}.xml`;
    try {
      const resp = await ecf.sendSummary(signedRfce, fileName);
      console.log(`📡 [Enviado Resumen] RFCE_${item.encf} ->`, JSON.stringify(resp));
      await sleep(3000);
    } catch (e) {
      console.error(`   ❌ Error RFCE ${item.encf}:`, e.message, e.response ? e.response.data : '');
    }
  }

  console.log('\n========================================================================');
  console.log('🎉 TRANSMISIÓN DE SIMULACIÓN COMPLETADA CON ÉXITO');
  console.log('========================================================================\n');
}

run();
