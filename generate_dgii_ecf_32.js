/**
 * generate_dgii_ecf_32.js
 * Generador de Facturas de Consumo Electrónica < 250k (e-CF 32)
 * Conforme al Manual Técnico DGII Versión 1.0 (Octubre 2025, 87 páginas)
 */

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const forge = require('node-forge');
const { SignedXml } = require('xml-crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// 1. Cargar Certificado Digital Oficial
let certPath = process.env.DGII_CERT_PATH ? path.resolve(__dirname, process.env.DGII_CERT_PATH) : path.resolve(__dirname, 'certs/20209102_identity.p12');
if (!fs.existsSync(certPath)) {
  certPath = path.resolve(__dirname, '../20209102_identity.p12');
}
if (!fs.existsSync(certPath)) {
  certPath = path.resolve(__dirname, 'certs/20209102_identity.p12');
}
const certPassword = process.env.DGII_CERT_PASSWORD || '';

if (!fs.existsSync(certPath)) {
  console.error('❌ No se encontró el certificado en:', certPath);
  process.exit(1);
}

console.log('1. Cargando certificado digital desde:', certPath);
const p12Buffer = fs.readFileSync(certPath);
const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, certPassword);

let privateKeyPem = null;
let certificatePem = null;
let certBase64 = null;

for (const safeContent of p12.safeContents) {
  for (const safeBag of safeContent.safeBags) {
    if (safeBag.key) {
      privateKeyPem = forge.pki.privateKeyToPem(safeBag.key);
    }
    if (safeBag.cert) {
      certificatePem = forge.pki.certificateToPem(safeBag.cert);
      certBase64 = forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(safeBag.cert)).getBytes()).replace(/\r?\n|\r/g, '');
    }
  }
}

if (!privateKeyPem || !certificatePem) {
  console.error('❌ No se pudo extraer la clave privada o certificado del archivo .p12');
  process.exit(1);
}
console.log('✅ Certificado oficial cargado correctamente');

// 2. Función de Firma XML (Idéntica a 202609291154192_180926.xml aceptada por DGII)
function signDgiiXml(rawXml) {
  const sig = new SignedXml();
  sig.privateKey = privateKeyPem;
  sig.publicCert = certificatePem;
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';

  sig.keyInfoProvider = {
    getKeyInfo: function(key, prefix) {
      prefix = prefix ? prefix + ':' : '';
      return '<' + prefix + 'X509Data><' + prefix + 'X509Certificate>' + certBase64 + '</' + prefix + 'X509Certificate></' + prefix + 'X509Data>';
    },
    getKey: function() {
      return certificatePem;
    }
  };

  sig.addReference({
    xpath: '/*',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature'
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    isEmptyUri: true
  });

  sig.computeSignature(rawXml, {
    prefix: '',
    location: {
      reference: '/*',
      action: 'append'
    }
  });

  return sig.getSignedXml();
}

// 3. Limpieza de datos
function cleanVal(v) {
  if (v === undefined || v === null || v === '#e' || v === '') return null;
  return String(v).trim();
}

// 4. Construcción de e-CF 32 (< 250k) siguiendo la secuencia exacta del XSD DGII
function buildECF32(row) {
  const xml = [];
  xml.push('<?xml version="1.0" encoding="utf-8"?>');
  xml.push('<eCF xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">');
  
  // ==================== SECCIÓN A: ENCABEZADO ====================
  xml.push('  <Encabezado>');
  // Campo 1: Versión (Pág. 6 de 87)
  xml.push(`    <Version>${cleanVal(row.Version) || '1.0'}</Version>`);

  // --- ÁREA IdDoc (Pág. 6 - 10 de 87) ---
  xml.push('    <IdDoc>');
  // Campo 2: TipoeCF
  xml.push(`      <TipoeCF>32</TipoeCF>`);
  // Campo 3: eNCF
  xml.push(`      <eNCF>${cleanVal(row.ENCF)}</eNCF>`);
  // (Nota: Campo 4 FechaVencimientoSecuencia tiene obligatoriedad 0 en Tipo 32)
  // Campo 7: IndicadorMontoGravado (Pág. 7 de 87)
  if (cleanVal(row.IndicadorMontoGravado) !== null) {
    xml.push(`      <IndicadorMontoGravado>${cleanVal(row.IndicadorMontoGravado)}</IndicadorMontoGravado>`);
  }
  // Campo 8: TipoIngresos (Pág. 7 de 87)
  xml.push(`      <TipoIngresos>${cleanVal(row.TipoIngresos) || '01'}</TipoIngresos>`);
  // Campo 9: TipoPago (Pág. 8 de 87)
  xml.push(`      <TipoPago>${cleanVal(row.TipoPago) || '1'}</TipoPago>`);
  xml.push('    </IdDoc>');

  // --- ÁREA Emisor (Pág. 10 - 12 de 87) ---
  xml.push('    <Emisor>');
  // Campo 20: RNCEmisor
  xml.push(`      <RNCEmisor>${cleanVal(row.RNCEmisor)}</RNCEmisor>`);
  // Campo 21: RazonSocialEmisor
  xml.push(`      <RazonSocialEmisor>${cleanVal(row.RazonSocialEmisor)}</RazonSocialEmisor>`);
  // Campo 22: NombreComercial
  if (cleanVal(row.NombreComercial)) {
    xml.push(`      <NombreComercial>${cleanVal(row.NombreComercial)}</NombreComercial>`);
  }
  // Campo 24: DireccionEmisor
  xml.push(`      <DireccionEmisor>${cleanVal(row.DireccionEmisor)}</DireccionEmisor>`);
  
  // Campo 27: TablaTelefonoEmisor
  if (cleanVal(row[`TelefonoEmisor[1]`])) {
    xml.push('      <TablaTelefonoEmisor>');
    xml.push(`        <TelefonoEmisor>${cleanVal(row[`TelefonoEmisor[1]`])}</TelefonoEmisor>`);
    if (cleanVal(row[`TelefonoEmisor[2]`])) {
      xml.push(`        <TelefonoEmisor>${cleanVal(row[`TelefonoEmisor[2]`])}</TelefonoEmisor>`);
    }
    xml.push('      </TablaTelefonoEmisor>');
  }

  // Campo 28: CorreoEmisor
  if (cleanVal(row.CorreoEmisor)) {
    xml.push(`      <CorreoEmisor>${cleanVal(row.CorreoEmisor)}</CorreoEmisor>`);
  }
  // Campo 37: FechaEmision (dd-MM-AAAA)
  xml.push(`      <FechaEmision>${cleanVal(row.FechaEmision)}</FechaEmision>`);
  xml.push('    </Emisor>');

  // --- ÁREA Comprador (Pág. 12 - 15 de 87) ---
  xml.push('    <Comprador>');
  // Campo 38: RNCComprador
  if (cleanVal(row.RNCComprador)) {
    xml.push(`      <RNCComprador>${cleanVal(row.RNCComprador)}</RNCComprador>`);
  }
  // Campo 40: RazonSocialComprador
  if (cleanVal(row.RazonSocialComprador)) {
    xml.push(`      <RazonSocialComprador>${cleanVal(row.RazonSocialComprador)}</RazonSocialComprador>`);
  }
  // Campo 42: CorreoComprador
  if (cleanVal(row.CorreoComprador)) {
    xml.push(`      <CorreoComprador>${cleanVal(row.CorreoComprador)}</CorreoComprador>`);
  }
  // Campo 43: DireccionComprador
  if (cleanVal(row.DireccionComprador)) {
    xml.push(`      <DireccionComprador>${cleanVal(row.DireccionComprador)}</DireccionComprador>`);
  }
  // Campo 44: MunicipioComprador
  if (cleanVal(row.MunicipioComprador)) {
    xml.push(`      <MunicipioComprador>${cleanVal(row.MunicipioComprador)}</MunicipioComprador>`);
  }
  // Campo 45: ProvinciaComprador
  if (cleanVal(row.ProvinciaComprador)) {
    xml.push(`      <ProvinciaComprador>${cleanVal(row.ProvinciaComprador)}</ProvinciaComprador>`);
  }
  // Campo 50: TelefonoAdicional
  if (cleanVal(row.TelefonoAdicional)) {
    xml.push(`      <TelefonoAdicional>${cleanVal(row.TelefonoAdicional)}</TelefonoAdicional>`);
  }
  xml.push('    </Comprador>');

  // --- ÁREA Totales (Pág. 18 - 27 de 87) ---
  xml.push('    <Totales>');
  // Campo 92: MontoGravadoTotal
  if (cleanVal(row.MontoGravadoTotal)) {
    xml.push(`      <MontoGravadoTotal>${cleanVal(row.MontoGravadoTotal)}</MontoGravadoTotal>`);
  }
  // Campo 93: MontoGravadoI1
  if (cleanVal(row.MontoGravadoI1)) {
    xml.push(`      <MontoGravadoI1>${cleanVal(row.MontoGravadoI1)}</MontoGravadoI1>`);
  }
  // Campo 97: ITBIS1 (Tasa: 18)
  if (cleanVal(row.ITBIS1)) {
    xml.push(`      <ITBIS1>${cleanVal(row.ITBIS1)}</ITBIS1>`);
  }
  // Campo 100: TotalITBIS
  if (cleanVal(row.TotalITBIS)) {
    xml.push(`      <TotalITBIS>${cleanVal(row.TotalITBIS)}</TotalITBIS>`);
  }
  // Campo 101: TotalITBIS1
  if (cleanVal(row.TotalITBIS1)) {
    xml.push(`      <TotalITBIS1>${cleanVal(row.TotalITBIS1)}</TotalITBIS1>`);
  }
  // Campo 110: MontoTotal (Obligatorio)
  xml.push(`      <MontoTotal>${cleanVal(row.MontoTotal)}</MontoTotal>`);
  xml.push('    </Totales>');

  xml.push('  </Encabezado>');

  // ==================== SECCIÓN B: DETALLE DE BIENES O SERVICIOS (Pág. 35 - 44 de 87) ====================
  xml.push('  <DetallesItem>');
  
  for (let i = 1; i <= 250; i++) {
    const numLinea = cleanVal(row[`NumeroLinea[${i}]`]);
    const nomItem = cleanVal(row[`NombreItem[${i}]`]);
    if (!numLinea && !nomItem) continue;

    xml.push('    <Item>');
    // Campo 1: NumeroLinea
    xml.push(`      <NumeroLinea>${numLinea || String(i)}</NumeroLinea>`);
    // Campo 4: IndicadorFacturacion
    if (cleanVal(row[`IndicadorFacturacion[${i}]`])) {
      xml.push(`      <IndicadorFacturacion>${cleanVal(row[`IndicadorFacturacion[${i}]`])}</IndicadorFacturacion>`);
    }
    // Campo 8: NombreItem
    xml.push(`      <NombreItem>${nomItem}</NombreItem>`);
    // Campo 9: IndicadorBienoServicio (1=Bien, 2=Servicio)
    xml.push(`      <IndicadorBienoServicio>${cleanVal(row[`IndicadorBienoServicio[${i}]`]) || '1'}</IndicadorBienoServicio>`);
    // Campo 11: CantidadItem
    xml.push(`      <CantidadItem>${cleanVal(row[`CantidadItem[${i}]`]) || '1'}</CantidadItem>`);
    // Campo 12: UnidadMedida
    if (cleanVal(row[`UnidadMedida[${i}]`])) {
      xml.push(`      <UnidadMedida>${cleanVal(row[`UnidadMedida[${i}]`])}</UnidadMedida>`);
    }
    // Campo 25: PrecioUnitarioItem
    xml.push(`      <PrecioUnitarioItem>${cleanVal(row[`PrecioUnitarioItem[${i}]`]) || '0.00'}</PrecioUnitarioItem>`);
    // Campo 39: MontoItem
    xml.push(`      <MontoItem>${cleanVal(row[`MontoItem[${i}]`]) || '0.00'}</MontoItem>`);
    xml.push('    </Item>');
  }
  
  xml.push('  </DetallesItem>');

  // ==================== SECCIÓN G: FECHA Y HORA DE LA FIRMA DIGITAL (Pág. 58 de 87) ====================
  const fechaEmision = cleanVal(row.FechaEmision) || '01-04-2020';
  xml.push(`  <FechaHoraFirma>${fechaEmision} 18:20:06</FechaHoraFirma>`);

  xml.push('</eCF>');
  return xml.join('\n');
}

// 5. Procesar Excel y Generar Archivos
const EXCEL_FILE = path.resolve(__dirname, '../131917038-29092026182006.xlsx');
const workbook = XLSX.readFile(EXCEL_FILE);
const sheet = workbook.Sheets['ECF'];
const allRows = XLSX.utils.sheet_to_json(sheet);

const fcCases = allRows.filter(r => r.TipoeCF == '32' && parseFloat(r.MontoTotal) < 250000);
console.log(`\n2. Generando ${fcCases.length} Facturas de Consumo < 250k...`);

const OUT_DIRS = [
  path.resolve(__dirname, '../Facturas_Consumo_Menor_250k'),
  path.resolve(__dirname, 'dgii_test_output/4_Cuarto_Facturas_Consumo_Menor_250k')
];

OUT_DIRS.forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

fcCases.forEach((row, i) => {
  const encf = cleanVal(row.ENCF);
  console.log(`\n--- [${i + 1}/${fcCases.length}] Factura ${encf} (RD$ ${row.MontoTotal}) ---`);
  
  const rawXml = buildECF32(row);
  const signedXml = signDgiiXml(rawXml);
  
  OUT_DIRS.forEach(dir => {
    const filePath = path.join(dir, `${encf}.xml`);
    fs.writeFileSync(filePath, signedXml, 'utf8');
    console.log(`✅ Archivo generado y firmado: ${filePath}`);
  });
});

console.log('\n=== ✅ TODAS LAS FACTURAS DE CONSUMO < 250K HAN SIDO ACTUALIZADAS Y FIRMADAS EXITOSAMENTE ===');
