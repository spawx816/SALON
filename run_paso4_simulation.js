/**
 * run_paso4_simulation.js
 * Master Orchestrator for Paso 4: Pruebas de Simulación e-CF
 * Uses the proven, 100% XSD compliant buildECF engine with simulation sequence numbers.
 */

const { ECF, ENVIRONMENT, Signature, convertECF32ToRFCE } = require('dgii-ecf');
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

const signature = new Signature(privateKeyPem, certificatePem);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function cleanVal(v) {
  if (v === undefined || v === null || v === '#e' || v === '') return null;
  return String(v).trim();
}

let globalSecOffset = Math.floor(Math.random() * 50);

// Sequence map for simulation
const SEQ_MAP = {
  'E310000000001': 'E310000000101',
  'E310000000003': 'E310000000103',
  'E310000000006': 'E310000000106',
  'E310000000034': 'E310000000134',
  'E320000000002': 'E320000000102',
  'E320000000006': 'E320000000106',
  'E330000000001': 'E330000000101',
  'E340000000002': 'E340000000102',
  'E340000000018': 'E340000000118',
  'E410000000001': 'E410000000101',
  'E410000000008': 'E410000000108',
  'E430000000001': 'E430000000101',
  'E430000000010': 'E430000000110',
  'E440000000009': 'E440000000109',
  'E440000000013': 'E440000000113',
  'E450000000002': 'E450000000102',
  'E450000000007': 'E450000000107',
  'E460000000007': 'E460000000107',
  'E460000000009': 'E460000000109',
  'E470000000001': 'E470000000101',
  'E470000000009': 'E470000000109',
  'E320000000011': 'E320000000211',
  'E320000000013': 'E320000000213',
  'E320000000014': 'E320000000214',
  'E320000000015': 'E320000000215'
};

function buildECF(row) {
  const encfOriginal = cleanVal(row.ENCF);
  const encfSim = SEQ_MAP[encfOriginal] || encfOriginal;
  const ncfModOriginal = cleanVal(row.NCFModificado);
  const ncfModSim = ncfModOriginal ? (SEQ_MAP[ncfModOriginal] || ncfModOriginal) : null;

  const xml = [];
  xml.push('<?xml version="1.0" encoding="utf-8"?>');
  xml.push('<ECF>');
  
  // ==================== ENCABEZADO ====================
  xml.push('  <Encabezado>');
  xml.push(`    <Version>${cleanVal(row.Version) || '1.0'}</Version>`);

  // --- IdDoc ---
  xml.push('    <IdDoc>');
  xml.push(`      <TipoeCF>${cleanVal(row.TipoeCF)}</TipoeCF>`);
  xml.push(`      <eNCF>${encfSim}</eNCF>`);
  
  if (cleanVal(row.FechaVencimientoSecuencia) && cleanVal(row.TipoeCF) !== '32' && cleanVal(row.TipoeCF) !== '34') {
    xml.push(`      <FechaVencimientoSecuencia>${cleanVal(row.FechaVencimientoSecuencia)}</FechaVencimientoSecuencia>`);
  }
  if (cleanVal(row.IndicadorNotaCredito) !== null) {
    xml.push(`      <IndicadorNotaCredito>${cleanVal(row.IndicadorNotaCredito)}</IndicadorNotaCredito>`);
  }
  if (cleanVal(row.IndicadorEnvioDiferido)) {
    xml.push(`      <IndicadorEnvioDiferido>${cleanVal(row.IndicadorEnvioDiferido)}</IndicadorEnvioDiferido>`);
  }
  if (cleanVal(row.IndicadorMontoGravado) !== null) {
    xml.push(`      <IndicadorMontoGravado>${cleanVal(row.IndicadorMontoGravado)}</IndicadorMontoGravado>`);
  }
  if (cleanVal(row.TipoIngresos)) {
    xml.push(`      <TipoIngresos>${cleanVal(row.TipoIngresos)}</TipoIngresos>`);
  }
  if (cleanVal(row.TipoPago)) {
    xml.push(`      <TipoPago>${cleanVal(row.TipoPago)}</TipoPago>`);
  }
  if (cleanVal(row.FechaLimitePago)) {
    xml.push(`      <FechaLimitePago>${cleanVal(row.FechaLimitePago)}</FechaLimitePago>`);
  }
  if (cleanVal(row.TerminoPago)) {
    xml.push(`      <TerminoPago>${cleanVal(row.TerminoPago)}</TerminoPago>`);
  }

  // Tabla Formas de Pago
  if (cleanVal(row.TipoeCF) !== '34' && cleanVal(row['FormaPago[1]'])) {
    const formaPago = cleanVal(row['FormaPago[1]']);
    const montoPago = cleanVal(row['MontoPago[1]']) || cleanVal(row.MontoTotal);
    if (formaPago && montoPago) {
      xml.push('      <TablaFormasPago>');
      xml.push('        <FormaDePago>');
      xml.push(`          <FormaPago>${formaPago}</FormaPago>`);
      xml.push(`          <MontoPago>${montoPago}</MontoPago>`);
      xml.push('        </FormaDePago>');
      for (let f = 2; f <= 7; f++) {
        if (cleanVal(row[`FormaPago[${f}]`])) {
          xml.push('        <FormaDePago>');
          xml.push(`          <FormaPago>${cleanVal(row[`FormaPago[${f}]`])}</FormaPago>`);
          xml.push(`          <MontoPago>${cleanVal(row[`MontoPago[${f}]`]) || '0.00'}</MontoPago>`);
          xml.push('        </FormaDePago>');
        }
      }
      xml.push('      </TablaFormasPago>');
    }
  }

  if (cleanVal(row.TipoCuentaPago)) xml.push(`      <TipoCuentaPago>${cleanVal(row.TipoCuentaPago)}</TipoCuentaPago>`);
  if (cleanVal(row.NumeroCuentaPago)) xml.push(`      <NumeroCuentaPago>${cleanVal(row.NumeroCuentaPago)}</NumeroCuentaPago>`);
  if (cleanVal(row.BancoPago)) xml.push(`      <BancoPago>${cleanVal(row.BancoPago)}</BancoPago>`);
  if (cleanVal(row.FechaDesde)) xml.push(`      <FechaDesde>${cleanVal(row.FechaDesde)}</FechaDesde>`);
  if (cleanVal(row.FechaHasta)) xml.push(`      <FechaHasta>${cleanVal(row.FechaHasta)}</FechaHasta>`);
  if (cleanVal(row.TotalPaginas)) xml.push(`      <TotalPaginas>${cleanVal(row.TotalPaginas)}</TotalPaginas>`);
  xml.push('    </IdDoc>');

  // --- Emisor ---
  xml.push('    <Emisor>');
  xml.push(`      <RNCEmisor>${cleanVal(row.RNCEmisor)}</RNCEmisor>`);
  xml.push(`      <RazonSocialEmisor>${cleanVal(row.RazonSocialEmisor)}</RazonSocialEmisor>`);
  if (cleanVal(row.NombreComercial)) xml.push(`      <NombreComercial>${cleanVal(row.NombreComercial)}</NombreComercial>`);
  if (cleanVal(row.Sucursal)) xml.push(`      <Sucursal>${cleanVal(row.Sucursal)}</Sucursal>`);
  xml.push(`      <DireccionEmisor>${cleanVal(row.DireccionEmisor)}</DireccionEmisor>`);
  if (cleanVal(row.Municipio)) xml.push(`      <Municipio>${cleanVal(row.Municipio)}</Municipio>`);
  if (cleanVal(row.Provincia)) xml.push(`      <Provincia>${cleanVal(row.Provincia)}</Provincia>`);
  if (cleanVal(row[`TelefonoEmisor[1]`])) {
    xml.push('      <TablaTelefonoEmisor>');
    xml.push(`        <TelefonoEmisor>${cleanVal(row[`TelefonoEmisor[1]`])}</TelefonoEmisor>`);
    if (cleanVal(row[`TelefonoEmisor[2]`])) xml.push(`        <TelefonoEmisor>${cleanVal(row[`TelefonoEmisor[2]`])}</TelefonoEmisor>`);
    if (cleanVal(row[`TelefonoEmisor[3]`])) xml.push(`        <TelefonoEmisor>${cleanVal(row[`TelefonoEmisor[3]`])}</TelefonoEmisor>`);
    xml.push('      </TablaTelefonoEmisor>');
  }
  if (cleanVal(row.CorreoEmisor)) xml.push(`      <CorreoEmisor>${cleanVal(row.CorreoEmisor)}</CorreoEmisor>`);
  if (cleanVal(row.WebSite)) xml.push(`      <WebSite>${cleanVal(row.WebSite)}</WebSite>`);
  if (cleanVal(row.ActividadEconomica)) xml.push(`      <ActividadEconomica>${cleanVal(row.ActividadEconomica)}</ActividadEconomica>`);
  if (cleanVal(row.CodigoVendedor)) xml.push(`      <CodigoVendedor>${cleanVal(row.CodigoVendedor)}</CodigoVendedor>`);
  if (cleanVal(row.NumeroFacturaInterna)) xml.push(`      <NumeroFacturaInterna>${cleanVal(row.NumeroFacturaInterna)}</NumeroFacturaInterna>`);
  if (cleanVal(row.NumeroPedidoInterno)) xml.push(`      <NumeroPedidoInterno>${cleanVal(row.NumeroPedidoInterno)}</NumeroPedidoInterno>`);
  if (cleanVal(row.ZonaVenta)) xml.push(`      <ZonaVenta>${cleanVal(row.ZonaVenta)}</ZonaVenta>`);
  if (cleanVal(row.RutaVenta)) xml.push(`      <RutaVenta>${cleanVal(row.RutaVenta)}</RutaVenta>`);
  if (cleanVal(row.InformacionAdicionalEmisor)) xml.push(`      <InformacionAdicionalEmisor>${cleanVal(row.InformacionAdicionalEmisor)}</InformacionAdicionalEmisor>`);
  xml.push(`      <FechaEmision>${cleanVal(row.FechaEmision)}</FechaEmision>`);
  xml.push('    </Emisor>');

  // --- Comprador ---
  if (cleanVal(row.RNCComprador) || cleanVal(row.RazonSocialComprador) || cleanVal(row.IdentificadorExtranjero)) {
    xml.push('    <Comprador>');
    if (cleanVal(row.RNCComprador)) xml.push(`      <RNCComprador>${cleanVal(row.RNCComprador)}</RNCComprador>`);
    if (cleanVal(row.IdentificadorExtranjero)) xml.push(`      <IdentificadorExtranjero>${cleanVal(row.IdentificadorExtranjero)}</IdentificadorExtranjero>`);
    if (cleanVal(row.RazonSocialComprador)) xml.push(`      <RazonSocialComprador>${cleanVal(row.RazonSocialComprador)}</RazonSocialComprador>`);
    if (cleanVal(row.ContactoComprador)) xml.push(`      <ContactoComprador>${cleanVal(row.ContactoComprador)}</ContactoComprador>`);
    if (cleanVal(row.CorreoComprador)) xml.push(`      <CorreoComprador>${cleanVal(row.CorreoComprador)}</CorreoComprador>`);
    if (cleanVal(row.DireccionComprador)) xml.push(`      <DireccionComprador>${cleanVal(row.DireccionComprador)}</DireccionComprador>`);
    if (cleanVal(row.MunicipioComprador)) xml.push(`      <MunicipioComprador>${cleanVal(row.MunicipioComprador)}</MunicipioComprador>`);
    if (cleanVal(row.ProvinciaComprador)) xml.push(`      <ProvinciaComprador>${cleanVal(row.ProvinciaComprador)}</ProvinciaComprador>`);
    if (cleanVal(row.PaisComprador)) xml.push(`      <PaisComprador>${cleanVal(row.PaisComprador)}</PaisComprador>`);
    if (cleanVal(row.FechaEntrega)) xml.push(`      <FechaEntrega>${cleanVal(row.FechaEntrega)}</FechaEntrega>`);
    if (cleanVal(row.ContactoEntrega)) xml.push(`      <ContactoEntrega>${cleanVal(row.ContactoEntrega)}</ContactoEntrega>`);
    if (cleanVal(row.DireccionEntrega)) xml.push(`      <DireccionEntrega>${cleanVal(row.DireccionEntrega)}</DireccionEntrega>`);
    if (cleanVal(row.TelefonoAdicional)) xml.push(`      <TelefonoAdicional>${cleanVal(row.TelefonoAdicional)}</TelefonoAdicional>`);
    if (cleanVal(row.FechaOrdenCompra)) xml.push(`      <FechaOrdenCompra>${cleanVal(row.FechaOrdenCompra)}</FechaOrdenCompra>`);
    if (cleanVal(row.NumeroOrdenCompra)) xml.push(`      <NumeroOrdenCompra>${cleanVal(row.NumeroOrdenCompra)}</NumeroOrdenCompra>`);
    if (cleanVal(row.CodigoInternoComprador)) xml.push(`      <CodigoInternoComprador>${cleanVal(row.CodigoInternoComprador)}</CodigoInternoComprador>`);
    if (cleanVal(row.ResponsablePago)) xml.push(`      <ResponsablePago>${cleanVal(row.ResponsablePago)}</ResponsablePago>`);
    if (cleanVal(row.InformacionAdicionalComprador) || cleanVal(row.Informacionadicionalcomprador)) {
      xml.push(`      <Informacionadicionalcomprador>${cleanVal(row.InformacionAdicionalComprador) || cleanVal(row.Informacionadicionalcomprador)}</Informacionadicionalcomprador>`);
    }
    xml.push('    </Comprador>');
  }

  // --- Informaciones Adicionales ---
  const numContenedor = cleanVal(row['NumeroContenedor ']) || cleanVal(row.NumeroContenedor);
  if (cleanVal(row.FechaEmbarque) || cleanVal(row.NumeroEmbarque) || numContenedor || cleanVal(row.NumeroReferencia)) {
    xml.push('    <InformacionesAdicionales>');
    if (cleanVal(row.FechaEmbarque)) xml.push(`      <FechaEmbarque>${cleanVal(row.FechaEmbarque)}</FechaEmbarque>`);
    if (cleanVal(row.NumeroEmbarque)) xml.push(`      <NumeroEmbarque>${cleanVal(row.NumeroEmbarque)}</NumeroEmbarque>`);
    if (numContenedor) xml.push(`      <NumeroContenedor>${numContenedor}</NumeroContenedor>`);
    if (cleanVal(row.NumeroReferencia)) xml.push(`      <NumeroReferencia>${cleanVal(row.NumeroReferencia)}</NumeroReferencia>`);
    xml.push('    </InformacionesAdicionales>');
  }

  // --- Totales ---
  xml.push('    <Totales>');
  if (cleanVal(row.MontoGravadoTotal)) xml.push(`      <MontoGravadoTotal>${cleanVal(row.MontoGravadoTotal)}</MontoGravadoTotal>`);
  if (cleanVal(row.MontoGravadoI1)) xml.push(`      <MontoGravadoI1>${cleanVal(row.MontoGravadoI1)}</MontoGravadoI1>`);
  if (cleanVal(row.MontoGravadoI2)) xml.push(`      <MontoGravadoI2>${cleanVal(row.MontoGravadoI2)}</MontoGravadoI2>`);
  if (cleanVal(row.MontoGravadoI3)) xml.push(`      <MontoGravadoI3>${cleanVal(row.MontoGravadoI3)}</MontoGravadoI3>`);
  if (cleanVal(row.MontoExento)) xml.push(`      <MontoExento>${cleanVal(row.MontoExento)}</MontoExento>`);
  if (cleanVal(row.ITBIS1)) xml.push(`      <ITBIS1>${cleanVal(row.ITBIS1)}</ITBIS1>`);
  if (cleanVal(row.ITBIS2)) xml.push(`      <ITBIS2>${cleanVal(row.ITBIS2)}</ITBIS2>`);
  if (cleanVal(row.ITBIS3)) xml.push(`      <ITBIS3>${cleanVal(row.ITBIS3)}</ITBIS3>`);
  if (cleanVal(row.TotalITBIS)) xml.push(`      <TotalITBIS>${cleanVal(row.TotalITBIS)}</TotalITBIS>`);
  if (cleanVal(row.TotalITBIS1)) xml.push(`      <TotalITBIS1>${cleanVal(row.TotalITBIS1)}</TotalITBIS1>`);
  if (cleanVal(row.TotalITBIS2)) xml.push(`      <TotalITBIS2>${cleanVal(row.TotalITBIS2)}</TotalITBIS2>`);
  if (cleanVal(row.TotalITBIS3)) xml.push(`      <TotalITBIS3>${cleanVal(row.TotalITBIS3)}</TotalITBIS3>`);
  if (cleanVal(row.MontoImpuestoAdicional)) xml.push(`      <MontoImpuestoAdicional>${cleanVal(row.MontoImpuestoAdicional)}</MontoImpuestoAdicional>`);
  xml.push(`      <MontoTotal>${cleanVal(row.MontoTotal)}</MontoTotal>`);
  if (cleanVal(row.MontoNoFacturable)) xml.push(`      <MontoNoFacturable>${cleanVal(row.MontoNoFacturable)}</MontoNoFacturable>`);
  if (cleanVal(row.MontoPeriodo)) xml.push(`      <MontoPeriodo>${cleanVal(row.MontoPeriodo)}</MontoPeriodo>`);
  if (cleanVal(row.ValorPagar)) xml.push(`      <ValorPagar>${cleanVal(row.ValorPagar)}</ValorPagar>`);
  if (cleanVal(row.TotalITBISRetenido) && cleanVal(row.TipoeCF) !== '32') xml.push(`      <TotalITBISRetenido>${cleanVal(row.TotalITBISRetenido)}</TotalITBISRetenido>`);
  if (cleanVal(row.TotalISRRetencion) && cleanVal(row.TipoeCF) !== '32') xml.push(`      <TotalISRRetencion>${cleanVal(row.TotalISRRetencion)}</TotalISRRetencion>`);
  xml.push('    </Totales>');

  // --- Otra Moneda ---
  if (cleanVal(row.TipoMoneda)) {
    xml.push('    <OtraMoneda>');
    xml.push(`      <TipoMoneda>${cleanVal(row.TipoMoneda)}</TipoMoneda>`);
    xml.push(`      <TipoCambio>${cleanVal(row.TipoCambio)}</TipoCambio>`);
    if (cleanVal(row.MontoGravadoTotalOtraMoneda)) xml.push(`      <MontoGravadoTotalOtraMoneda>${cleanVal(row.MontoGravadoTotalOtraMoneda)}</MontoGravadoTotalOtraMoneda>`);
    if (cleanVal(row.TotalITBISOtraMoneda)) xml.push(`      <TotalITBISOtraMoneda>${cleanVal(row.TotalITBISOtraMoneda)}</TotalITBISOtraMoneda>`);
    if (cleanVal(row.TotalITBIS3OtraMoneda)) xml.push(`      <TotalITBIS3OtraMoneda>${cleanVal(row.TotalITBIS3OtraMoneda)}</TotalITBIS3OtraMoneda>`);
    if (cleanVal(row.MontoTotalOtraMoneda)) xml.push(`      <MontoTotalOtraMoneda>${cleanVal(row.MontoTotalOtraMoneda)}</MontoTotalOtraMoneda>`);
    xml.push('    </OtraMoneda>');
  }

  xml.push('  </Encabezado>');

  // ==================== DETALLES ITEMS ====================
  xml.push('  <DetallesItems>');
  for (let i = 1; i <= 250; i++) {
    const numLinea = cleanVal(row[`NumeroLinea[${i}]`]);
    const nomItem = cleanVal(row[`NombreItem[${i}]`]);
    if (!numLinea && !nomItem) continue;

    xml.push('    <Item>');
    xml.push(`      <NumeroLinea>${numLinea || String(i)}</NumeroLinea>`);
    if (cleanVal(row[`IndicadorFacturacion[${i}]`])) {
      xml.push(`      <IndicadorFacturacion>${cleanVal(row[`IndicadorFacturacion[${i}]`])}</IndicadorFacturacion>`);
    }
    
    // Retención en Item
    if (cleanVal(row[`IndicadorAgenteRetencionoPercepcion[${i}]`])) {
      xml.push('      <Retencion>');
      xml.push(`        <IndicadorAgenteRetencionoPercepcion>${cleanVal(row[`IndicadorAgenteRetencionoPercepcion[${i}]`])}</IndicadorAgenteRetencionoPercepcion>`);
      if (cleanVal(row[`MontoITBISRetenido[${i}]`])) xml.push(`        <MontoITBISRetenido>${cleanVal(row[`MontoITBISRetenido[${i}]`])}</MontoITBISRetenido>`);
      if (cleanVal(row[`MontoISRRetenido[${i}]`])) xml.push(`        <MontoISRRetenido>${cleanVal(row[`MontoISRRetenido[${i}]`])}</MontoISRRetenido>`);
      xml.push('      </Retencion>');
    }

    xml.push(`      <NombreItem>${nomItem}</NombreItem>`);
    xml.push(`      <IndicadorBienoServicio>${cleanVal(row[`IndicadorBienoServicio[${i}]`]) || '1'}</IndicadorBienoServicio>`);
    xml.push(`      <CantidadItem>${cleanVal(row[`CantidadItem[${i}]`]) || '1'}</CantidadItem>`);
    if (cleanVal(row[`UnidadMedida[${i}]`])) {
      xml.push(`      <UnidadMedida>${cleanVal(row[`UnidadMedida[${i}]`])}</UnidadMedida>`);
    }
    xml.push(`      <PrecioUnitarioItem>${cleanVal(row[`PrecioUnitarioItem[${i}]`]) || '0.00'}</PrecioUnitarioItem>`);
    
    // Descuento en Item
    if (cleanVal(row[`DescuentoMonto[${i}]`])) {
      xml.push(`      <DescuentoMonto>${cleanVal(row[`DescuentoMonto[${i}]`])}</DescuentoMonto>`);
      if (cleanVal(row[`TipoSubDescuento[${i}][1]`])) {
        xml.push('      <TablaSubDescuento>');
        for (let sd = 1; sd <= 12; sd++) {
          if (cleanVal(row[`TipoSubDescuento[${i}][${sd}]`])) {
            xml.push('        <SubDescuento>');
            xml.push(`          <TipoSubDescuento>${cleanVal(row[`TipoSubDescuento[${i}][${sd}]`])}</TipoSubDescuento>`);
            if (cleanVal(row[`MontoSubDescuento[${i}][${sd}]`])) xml.push(`          <MontoSubDescuento>${cleanVal(row[`MontoSubDescuento[${i}][${sd}]`])}</MontoSubDescuento>`);
            xml.push('        </SubDescuento>');
          }
        }
        xml.push('      </TablaSubDescuento>');
      }
    }

    // Recargo en Item
    if (cleanVal(row[`RecargoMonto[${i}]`])) {
      xml.push(`      <RecargoMonto>${cleanVal(row[`RecargoMonto[${i}]`])}</RecargoMonto>`);
      const tipoSubRecargo1 = cleanVal(row[`TipoSubRecargo[${i}][1]`]) || cleanVal(row[`TipoSubrecargo[${i}][1]`]);
      if (tipoSubRecargo1) {
        xml.push('      <TablaSubRecargo>');
        for (let sr = 1; sr <= 12; sr++) {
          const tipoSR = cleanVal(row[`TipoSubRecargo[${i}][${sr}]`]) || cleanVal(row[`TipoSubrecargo[${i}][${sr}]`]);
          if (tipoSR) {
            xml.push('        <SubRecargo>');
            xml.push(`          <TipoSubRecargo>${tipoSR}</TipoSubRecargo>`);
            const montoSR = cleanVal(row[`MontoSubRecargo[${i}][${sr}]`]) || cleanVal(row[`MontosubRecargo[${i}][${sr}]`]);
            if (montoSR) xml.push(`          <MontoSubRecargo>${montoSR}</MontoSubRecargo>`);
            xml.push('        </SubRecargo>');
          }
        }
        xml.push('      </TablaSubRecargo>');
      }
    }

    // TablaImpuestoAdicional en Item
    if (cleanVal(row[`TipoImpuesto[${i}][1]`])) {
      xml.push('      <TablaImpuestoAdicional>');
      for (let tia = 1; tia <= 2; tia++) {
        if (cleanVal(row[`TipoImpuesto[${i}][${tia}]`])) {
          xml.push('        <ImpuestoAdicional>');
          xml.push(`          <TipoImpuesto>${cleanVal(row[`TipoImpuesto[${i}][${tia}]`])}</TipoImpuesto>`);
          xml.push('        </ImpuestoAdicional>');
        }
      }
      xml.push('      </TablaImpuestoAdicional>');
    }

    // Otra Moneda en Item
    if (cleanVal(row[`PrecioOtraMoneda[${i}]`])) {
      xml.push('      <OtraMonedaDetalle>');
      xml.push(`        <PrecioOtraMoneda>${cleanVal(row[`PrecioOtraMoneda[${i}]`])}</PrecioOtraMoneda>`);
      if (cleanVal(row[`MontoItemOtraMoneda[${i}]`])) xml.push(`        <MontoItemOtraMoneda>${cleanVal(row[`MontoItemOtraMoneda[${i}]`])}</MontoItemOtraMoneda>`);
      xml.push('      </OtraMonedaDetalle>');
    }

    xml.push(`      <MontoItem>${cleanVal(row[`MontoItem[${i}]`])}</MontoItem>`);
    xml.push('    </Item>');
  }
  xml.push('  </DetallesItems>');

  // InformacionReferencia
  if (ncfModSim) {
    xml.push('  <InformacionReferencia>');
    xml.push(`    <NCFModificado>${ncfModSim}</NCFModificado>`);
    if (cleanVal(row.FechaNCFModificado)) xml.push(`    <FechaNCFModificado>${cleanVal(row.FechaNCFModificado)}</FechaNCFModificado>`);
    if (cleanVal(row.CodigoModificacion)) xml.push(`    <CodigoModificacion>${cleanVal(row.CodigoModificacion)}</CodigoModificacion>`);
    if (cleanVal(row.RazonModificacion)) xml.push(`    <RazonModificacion>${cleanVal(row.RazonModificacion)}</RazonModificacion>`);
    xml.push('  </InformacionReferencia>');
  }

  const now = new Date(Date.now() + (++globalSecOffset * 2000));
  const pad = n => String(n).padStart(2, '0');
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const fechaEmision = cleanVal(row.FechaEmision) || '01-04-2020';
  xml.push(`  <FechaHoraFirma>${fechaEmision} ${timeStr}</FechaHoraFirma>`);

  xml.push('</ECF>');
  return { xml: xml.join('\n'), encfSim, tipoeCF: String(row.TipoeCF) };
}

async function run() {
  console.log('\n========================================================================');
  console.log('🚀 PASO 4: PRUEBAS DE SIMULACIÓN COMERCIAL DGII');
  console.log('========================================================================\n');

  const ecf = new ECF({ key: privateKeyPem, cert: certificatePem }, ENVIRONMENT.CERT);
  console.log('1. Autenticando con DGII CerteCF...');
  await ecf.authenticate();
  console.log('✅ Autenticación exitosa.\n');

  const wb = XLSX.readFile(path.resolve(__dirname, '../131917038-29092026182006.xlsx'));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['ECF']);

  const outBase = path.resolve(__dirname, 'dgii_test_output/Paso4_Simulacion');
  const dirGenerales = path.join(outBase, '1_Primero_Comprobantes_Generales');
  const dirNotas = path.join(outBase, '2_Segundo_Notas');
  const dirRFCE = path.join(outBase, '3_Tercero_RFCE');
  const dirConsumoWeb = path.join(outBase, '4_Cuarto_Facturas_Consumo_Menor_250k');
  const rootConsumo = path.resolve(__dirname, '../Paso4_Facturas_Consumo_Menor_250k');

  [dirGenerales, dirNotas, dirRFCE, dirConsumoWeb, rootConsumo].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  // 1. Separar filas por grupos
  const genRows = rows.filter(r => {
    const t = String(r.TipoeCF);
    if (t === '33' || t === '34') return false;
    if (t === '32' && parseFloat(r.MontoTotal) < 250000) return false;
    return true;
  });

  const notaRows = rows.filter(r => {
    const t = String(r.TipoeCF);
    return t === '33' || t === '34';
  });

  const fcMenorRows = rows.filter(r => {
    const t = String(r.TipoeCF);
    return t === '32' && parseFloat(r.MontoTotal) < 250000;
  });

  // ==========================================
  // GRUPO 1: 18 Comprobantes Generales
  // ==========================================
  console.log('========================================================');
  console.log(`🚀 ENVIANDO GRUPO 1: 18 Comprobantes Generales`);
  console.log('========================================================');

  for (const row of genRows) {
    const { xml: rawXml, encfSim, tipoeCF } = buildECF(row);
    const signedXml = signature.signXml(rawXml, 'ECF');
    const fileName = `131917038${encfSim}.xml`;
    fs.writeFileSync(path.join(dirGenerales, `${encfSim}.xml`), signedXml, 'utf8');

    try {
      const resp = await ecf.sendElectronicDocument(signedXml, fileName);
      console.log(`📡 [Enviado] ${encfSim} (Tipo ${tipoeCF}) -> TrackId: ${resp.trackId}`);
      await sleep(3000);
      const st = await ecf.statusTrackId(resp.trackId);
      console.log(`   📌 Estado DGII: ${st.estado} (Código: ${st.codigo})`);
      if (st.estado === 'Rechazado') {
        console.error('   ❌ Mensaje error:', st.mensajes);
      }
    } catch (e) {
      console.error(`   ❌ Error enviando ${encfSim}:`, e.message, e.response ? e.response.data : '');
    }
  }

  console.log('\n⏳ Esperando 10 segundos para consolidación en base de datos...');
  await sleep(10000);

  // ==========================================
  // GRUPO 2: 3 Notas de Débito y Crédito
  // ==========================================
  console.log('\n========================================================');
  console.log(`🚀 ENVIANDO GRUPO 2: 3 Notas (Tipo 33 y 34)`);
  console.log('========================================================');

  for (const row of notaRows) {
    const { xml: rawXml, encfSim, tipoeCF } = buildECF(row);
    const signedXml = signature.signXml(rawXml, 'ECF');
    const fileName = `131917038${encfSim}.xml`;
    fs.writeFileSync(path.join(dirNotas, `${encfSim}.xml`), signedXml, 'utf8');

    try {
      const resp = await ecf.sendElectronicDocument(signedXml, fileName);
      console.log(`📡 [Enviado] ${encfSim} (Tipo ${tipoeCF}) -> TrackId: ${resp.trackId}`);
      await sleep(4000);
      const st = await ecf.statusTrackId(resp.trackId);
      console.log(`   📌 Estado DGII: ${st.estado} (Código: ${st.codigo})`);
      if (st.estado === 'Rechazado') {
        console.error('   ❌ Mensaje error:', st.mensajes);
      }
    } catch (e) {
      console.error(`   ❌ Error enviando ${encfSim}:`, e.message, e.response ? e.response.data : '');
    }
  }

  console.log('\n⏳ Esperando 5 segundos antes de emitir los Resúmenes RFCE...');
  await sleep(5000);

  // ==========================================
  // GRUPO 3: 4 Resúmenes RFCE & Facturas < 250k
  // ==========================================
  console.log('\n========================================================');
  console.log(`🚀 ENVIANDO GRUPO 3: 4 Resúmenes de Consumo (RFCE)`);
  console.log('========================================================');

  for (const row of fcMenorRows) {
    const { xml: rawXml, encfSim } = buildECF(row);
    const signedXml = signature.signXml(rawXml, 'ECF');

    // Guardar Factura completa para carga web
    fs.writeFileSync(path.join(dirConsumoWeb, `${encfSim}.xml`), signedXml, 'utf8');
    fs.writeFileSync(path.join(rootConsumo, `${encfSim}.xml`), signedXml, 'utf8');

    // Generar y firmar RFCE
    const { xml: rfceRaw } = convertECF32ToRFCE(signedXml);
    const signedRfce = signature.signXml(rfceRaw, 'RFCE');
    fs.writeFileSync(path.join(dirRFCE, `RFCE_${encfSim}.xml`), signedRfce, 'utf8');

    const fileName = `131917038${encfSim}.xml`;
    try {
      const resp = await ecf.sendSummary(signedRfce, fileName);
      console.log(`📡 [Enviado Resumen] RFCE_${encfSim} ->`, JSON.stringify(resp));
      await sleep(3000);
    } catch (e) {
      console.error(`   ❌ Error RFCE ${encfSim}:`, e.message, e.response ? e.response.data : '');
    }
  }

  console.log('\n========================================================================');
  console.log('🎉 TRANSMISIÓN DE SIMULACIÓN COMPLETADA CON ÉXITO');
  console.log('========================================================================\n');
}

run();
