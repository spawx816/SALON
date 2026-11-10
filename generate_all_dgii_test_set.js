/**
 * generate_all_dgii_test_set.js
 * Generador Completo y Exhaustivo del Set de Pruebas DGII
 * Incluye wrappers correctos <ImpuestoAdicional> y <SubcantidadItem>
 */

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const forge = require('node-forge');
const { Signature, convertECF32ToRFCE } = require('dgii-ecf');
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

function signDgiiXml(rawXml, rootTag = 'ECF') {
  const signature = new Signature(privateKeyPem, certificatePem);
  return signature.signXml(rawXml, rootTag);
}

function cleanVal(v) {
  if (v === undefined || v === null || v === '#e' || v === '') return null;
  return String(v).trim();
}

let globalSecOffset = Math.floor(Math.random() * 100);

function buildECF(row) {
  const xml = [];
  xml.push('<?xml version="1.0" encoding="utf-8"?>');
  xml.push('<ECF>');
  
  // ==================== ENCABEZADO ====================
  xml.push('  <Encabezado>');
  xml.push(`    <Version>${cleanVal(row.Version) || '1.0'}</Version>`);

  // --- IdDoc ---
  xml.push('    <IdDoc>');
  xml.push(`      <TipoeCF>${cleanVal(row.TipoeCF)}</TipoeCF>`);
  xml.push(`      <eNCF>${cleanVal(row.ENCF)}</eNCF>`);
  
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

  // Tabla Formas de Pago (solo si viene en el Excel y NO es Nota de Credito 34)
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
  if (cleanVal(row.NombreComercial)) {
    xml.push(`      <NombreComercial>${cleanVal(row.NombreComercial)}</NombreComercial>`);
  }
  if (cleanVal(row.Sucursal)) {
    xml.push(`      <Sucursal>${cleanVal(row.Sucursal)}</Sucursal>`);
  }
  xml.push(`      <DireccionEmisor>${cleanVal(row.DireccionEmisor)}</DireccionEmisor>`);
  if (cleanVal(row.Municipio)) {
    xml.push(`      <Municipio>${cleanVal(row.Municipio)}</Municipio>`);
  }
  if (cleanVal(row.Provincia)) {
    xml.push(`      <Provincia>${cleanVal(row.Provincia)}</Provincia>`);
  }
  if (cleanVal(row[`TelefonoEmisor[1]`])) {
    xml.push('      <TablaTelefonoEmisor>');
    xml.push(`        <TelefonoEmisor>${cleanVal(row[`TelefonoEmisor[1]`])}</TelefonoEmisor>`);
    if (cleanVal(row[`TelefonoEmisor[2]`])) {
      xml.push(`        <TelefonoEmisor>${cleanVal(row[`TelefonoEmisor[2]`])}</TelefonoEmisor>`);
    }
    if (cleanVal(row[`TelefonoEmisor[3]`])) {
      xml.push(`        <TelefonoEmisor>${cleanVal(row[`TelefonoEmisor[3]`])}</TelefonoEmisor>`);
    }
    xml.push('      </TablaTelefonoEmisor>');
  }
  if (cleanVal(row.CorreoEmisor)) {
    xml.push(`      <CorreoEmisor>${cleanVal(row.CorreoEmisor)}</CorreoEmisor>`);
  }
  if (cleanVal(row.WebSite)) {
    xml.push(`      <WebSite>${cleanVal(row.WebSite)}</WebSite>`);
  }
  if (cleanVal(row.ActividadEconomica)) {
    xml.push(`      <ActividadEconomica>${cleanVal(row.ActividadEconomica)}</ActividadEconomica>`);
  }
  if (cleanVal(row.CodigoVendedor)) {
    xml.push(`      <CodigoVendedor>${cleanVal(row.CodigoVendedor)}</CodigoVendedor>`);
  }
  if (cleanVal(row.NumeroFacturaInterna)) {
    xml.push(`      <NumeroFacturaInterna>${cleanVal(row.NumeroFacturaInterna)}</NumeroFacturaInterna>`);
  }
  if (cleanVal(row.NumeroPedidoInterno)) {
    xml.push(`      <NumeroPedidoInterno>${cleanVal(row.NumeroPedidoInterno)}</NumeroPedidoInterno>`);
  }
  if (cleanVal(row.ZonaVenta)) {
    xml.push(`      <ZonaVenta>${cleanVal(row.ZonaVenta)}</ZonaVenta>`);
  }
  if (cleanVal(row.RutaVenta)) {
    xml.push(`      <RutaVenta>${cleanVal(row.RutaVenta)}</RutaVenta>`);
  }
  if (cleanVal(row.InformacionAdicionalEmisor)) {
    xml.push(`      <InformacionAdicionalEmisor>${cleanVal(row.InformacionAdicionalEmisor)}</InformacionAdicionalEmisor>`);
  }
  xml.push(`      <FechaEmision>${cleanVal(row.FechaEmision)}</FechaEmision>`);
  xml.push('    </Emisor>');

  // --- Comprador ---
  if (cleanVal(row.RNCComprador) || cleanVal(row.RazonSocialComprador) || cleanVal(row.IdentificadorExtranjero)) {
    xml.push('    <Comprador>');
    if (cleanVal(row.RNCComprador)) {
      xml.push(`      <RNCComprador>${cleanVal(row.RNCComprador)}</RNCComprador>`);
    }
    if (cleanVal(row.IdentificadorExtranjero)) {
      xml.push(`      <IdentificadorExtranjero>${cleanVal(row.IdentificadorExtranjero)}</IdentificadorExtranjero>`);
    }
    if (cleanVal(row.RazonSocialComprador)) {
      xml.push(`      <RazonSocialComprador>${cleanVal(row.RazonSocialComprador)}</RazonSocialComprador>`);
    }
    if (cleanVal(row.ContactoComprador)) {
      xml.push(`      <ContactoComprador>${cleanVal(row.ContactoComprador)}</ContactoComprador>`);
    }
    if (cleanVal(row.CorreoComprador)) {
      xml.push(`      <CorreoComprador>${cleanVal(row.CorreoComprador)}</CorreoComprador>`);
    }
    if (cleanVal(row.DireccionComprador)) {
      xml.push(`      <DireccionComprador>${cleanVal(row.DireccionComprador)}</DireccionComprador>`);
    }
    if (cleanVal(row.MunicipioComprador)) {
      xml.push(`      <MunicipioComprador>${cleanVal(row.MunicipioComprador)}</MunicipioComprador>`);
    }
    if (cleanVal(row.ProvinciaComprador)) {
      xml.push(`      <ProvinciaComprador>${cleanVal(row.ProvinciaComprador)}</ProvinciaComprador>`);
    }
    if (cleanVal(row.PaisComprador)) {
      xml.push(`      <PaisComprador>${cleanVal(row.PaisComprador)}</PaisComprador>`);
    }
    if (cleanVal(row.FechaEntrega)) {
      xml.push(`      <FechaEntrega>${cleanVal(row.FechaEntrega)}</FechaEntrega>`);
    }
    if (cleanVal(row.ContactoEntrega)) {
      xml.push(`      <ContactoEntrega>${cleanVal(row.ContactoEntrega)}</ContactoEntrega>`);
    }
    if (cleanVal(row.DireccionEntrega)) {
      xml.push(`      <DireccionEntrega>${cleanVal(row.DireccionEntrega)}</DireccionEntrega>`);
    }
    if (cleanVal(row.TelefonoAdicional)) {
      xml.push(`      <TelefonoAdicional>${cleanVal(row.TelefonoAdicional)}</TelefonoAdicional>`);
    }
    if (cleanVal(row.FechaOrdenCompra)) {
      xml.push(`      <FechaOrdenCompra>${cleanVal(row.FechaOrdenCompra)}</FechaOrdenCompra>`);
    }
    if (cleanVal(row.NumeroOrdenCompra)) {
      xml.push(`      <NumeroOrdenCompra>${cleanVal(row.NumeroOrdenCompra)}</NumeroOrdenCompra>`);
    }
    if (cleanVal(row.CodigoInternoComprador)) {
      xml.push(`      <CodigoInternoComprador>${cleanVal(row.CodigoInternoComprador)}</CodigoInternoComprador>`);
    }
    if (cleanVal(row.ResponsablePago)) {
      xml.push(`      <ResponsablePago>${cleanVal(row.ResponsablePago)}</ResponsablePago>`);
    }
    if (cleanVal(row.InformacionAdicionalComprador) || cleanVal(row.Informacionadicionalcomprador)) {
      xml.push(`      <Informacionadicionalcomprador>${cleanVal(row.InformacionAdicionalComprador) || cleanVal(row.Informacionadicionalcomprador)}</Informacionadicionalcomprador>`);
    }
    xml.push('    </Comprador>');
  }

  // --- Informaciones Adicionales ---
  const numContenedor = cleanVal(row['NumeroContenedor ']) || cleanVal(row.NumeroContenedor);
  if (cleanVal(row.FechaEmbarque) || cleanVal(row.NumeroEmbarque) || numContenedor || cleanVal(row.NumeroReferencia) || cleanVal(row.TotalFob) || cleanVal(row.Seguro) || cleanVal(row.Flete)) {
    xml.push('    <InformacionesAdicionales>');
    if (cleanVal(row.FechaEmbarque)) xml.push(`      <FechaEmbarque>${cleanVal(row.FechaEmbarque)}</FechaEmbarque>`);
    if (cleanVal(row.NumeroEmbarque)) xml.push(`      <NumeroEmbarque>${cleanVal(row.NumeroEmbarque)}</NumeroEmbarque>`);
    if (numContenedor) xml.push(`      <NumeroContenedor>${numContenedor}</NumeroContenedor>`);
    if (cleanVal(row.NumeroReferencia)) xml.push(`      <NumeroReferencia>${cleanVal(row.NumeroReferencia)}</NumeroReferencia>`);
    if (cleanVal(row.NombrePuertoEmbarque)) xml.push(`      <NombrePuertoEmbarque>${cleanVal(row.NombrePuertoEmbarque)}</NombrePuertoEmbarque>`);
    if (cleanVal(row.CondicionesEntrega)) xml.push(`      <CondicionesEntrega>${cleanVal(row.CondicionesEntrega)}</CondicionesEntrega>`);
    if (cleanVal(row.TotalFob)) xml.push(`      <TotalFob>${cleanVal(row.TotalFob)}</TotalFob>`);
    if (cleanVal(row.Seguro)) xml.push(`      <Seguro>${cleanVal(row.Seguro)}</Seguro>`);
    if (cleanVal(row.Flete)) xml.push(`      <Flete>${cleanVal(row.Flete)}</Flete>`);
    if (cleanVal(row.OtrosGastos)) xml.push(`      <OtrosGastos>${cleanVal(row.OtrosGastos)}</OtrosGastos>`);
    if (cleanVal(row.TotalCif)) xml.push(`      <TotalCif>${cleanVal(row.TotalCif)}</TotalCif>`);
    if (cleanVal(row.RegimenAduanero)) xml.push(`      <RegimenAduanero>${cleanVal(row.RegimenAduanero)}</RegimenAduanero>`);
    if (cleanVal(row.NombrePuertoSalida)) xml.push(`      <NombrePuertoSalida>${cleanVal(row.NombrePuertoSalida)}</NombrePuertoSalida>`);
    if (cleanVal(row.NombrePuertoDesembarque)) xml.push(`      <NombrePuertoDesembarque>${cleanVal(row.NombrePuertoDesembarque)}</NombrePuertoDesembarque>`);
    if (cleanVal(row.PesoBruto)) xml.push(`      <PesoBruto>${cleanVal(row.PesoBruto)}</PesoBruto>`);
    if (cleanVal(row.PesoNeto)) xml.push(`      <PesoNeto>${cleanVal(row.PesoNeto)}</PesoNeto>`);
    if (cleanVal(row.UnidadPesoBruto)) xml.push(`      <UnidadPesoBruto>${cleanVal(row.UnidadPesoBruto)}</UnidadPesoBruto>`);
    if (cleanVal(row.UnidadPesoNeto)) xml.push(`      <UnidadPesoNeto>${cleanVal(row.UnidadPesoNeto)}</UnidadPesoNeto>`);
    if (cleanVal(row.CantidadBulto)) xml.push(`      <CantidadBulto>${cleanVal(row.CantidadBulto)}</CantidadBulto>`);
    if (cleanVal(row.UnidadBulto)) xml.push(`      <UnidadBulto>${cleanVal(row.UnidadBulto)}</UnidadBulto>`);
    if (cleanVal(row.VolumenBulto)) xml.push(`      <VolumenBulto>${cleanVal(row.VolumenBulto)}</VolumenBulto>`);
    if (cleanVal(row.UnidadVolumen)) xml.push(`      <UnidadVolumen>${cleanVal(row.UnidadVolumen)}</UnidadVolumen>`);
    xml.push('    </InformacionesAdicionales>');
  }

  // --- Transporte ---
  if (cleanVal(row.ViaTransporte) || cleanVal(row.PaisDestino)) {
    xml.push('    <Transporte>');
    if (cleanVal(row.ViaTransporte)) xml.push(`      <ViaTransporte>${cleanVal(row.ViaTransporte)}</ViaTransporte>`);
    if (cleanVal(row.PaisOrigen)) xml.push(`      <PaisOrigen>${cleanVal(row.PaisOrigen)}</PaisOrigen>`);
    if (cleanVal(row.DireccionDestino)) xml.push(`      <DireccionDestino>${cleanVal(row.DireccionDestino)}</DireccionDestino>`);
    if (cleanVal(row.PaisDestino)) xml.push(`      <PaisDestino>${cleanVal(row.PaisDestino)}</PaisDestino>`);
    if (cleanVal(row.RNCIdentificacionCompaniaTransportista)) xml.push(`      <RNCIdentificacionCompaniaTransportista>${cleanVal(row.RNCIdentificacionCompaniaTransportista)}</RNCIdentificacionCompaniaTransportista>`);
    if (cleanVal(row.NombreCompaniaTransportista)) xml.push(`      <NombreCompaniaTransportista>${cleanVal(row.NombreCompaniaTransportista)}</NombreCompaniaTransportista>`);
    if (cleanVal(row.NumeroViaje)) xml.push(`      <NumeroViaje>${cleanVal(row.NumeroViaje)}</NumeroViaje>`);
    if (cleanVal(row.Conductor)) xml.push(`      <Conductor>${cleanVal(row.Conductor)}</Conductor>`);
    if (cleanVal(row.DocumentoTransporte)) xml.push(`      <DocumentoTransporte>${cleanVal(row.DocumentoTransporte)}</DocumentoTransporte>`);
    if (cleanVal(row.Ficha)) xml.push(`      <Ficha>${cleanVal(row.Ficha)}</Ficha>`);
    if (cleanVal(row.Placa)) xml.push(`      <Placa>${cleanVal(row.Placa)}</Placa>`);
    if (cleanVal(row.RutaTransporte)) xml.push(`      <RutaTransporte>${cleanVal(row.RutaTransporte)}</RutaTransporte>`);
    if (cleanVal(row.ZonaTransporte)) xml.push(`      <ZonaTransporte>${cleanVal(row.ZonaTransporte)}</ZonaTransporte>`);
    if (cleanVal(row.NumeroAlbaran)) xml.push(`      <NumeroAlbaran>${cleanVal(row.NumeroAlbaran)}</NumeroAlbaran>`);
    xml.push('    </Transporte>');
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

  // Tabla Impuestos Adicionales
  if (cleanVal(row['TipoImpuesto[1]'])) {
    xml.push('      <ImpuestosAdicionales>');
    for (let t = 1; t <= 20; t++) {
      if (cleanVal(row[`TipoImpuesto[${t}]`])) {
        xml.push('        <ImpuestoAdicional>');
        xml.push(`          <TipoImpuesto>${cleanVal(row[`TipoImpuesto[${t}]`])}</TipoImpuesto>`);
        if (cleanVal(row[`TasaImpuestoAdicional[${t}]`])) xml.push(`          <TasaImpuestoAdicional>${cleanVal(row[`TasaImpuestoAdicional[${t}]`])}</TasaImpuestoAdicional>`);
        if (cleanVal(row[`MontoImpuestoSelectivoConsumoEspecifico[${t}]`])) xml.push(`          <MontoImpuestoSelectivoConsumoEspecifico>${cleanVal(row[`MontoImpuestoSelectivoConsumoEspecifico[${t}]`])}</MontoImpuestoSelectivoConsumoEspecifico>`);
        if (cleanVal(row[`MontoImpuestoSelectivoConsumoAdvalorem[${t}]`])) xml.push(`          <MontoImpuestoSelectivoConsumoAdvalorem>${cleanVal(row[`MontoImpuestoSelectivoConsumoAdvalorem[${t}]`])}</MontoImpuestoSelectivoConsumoAdvalorem>`);
        if (cleanVal(row[`OtrosImpuestosAdicionales[${t}]`])) xml.push(`          <OtrosImpuestosAdicionales>${cleanVal(row[`OtrosImpuestosAdicionales[${t}]`])}</OtrosImpuestosAdicionales>`);
        xml.push('        </ImpuestoAdicional>');
      }
    }
    xml.push('      </ImpuestosAdicionales>');
  }

  xml.push(`      <MontoTotal>${cleanVal(row.MontoTotal)}</MontoTotal>`);
  if (cleanVal(row.MontoNoFacturable)) xml.push(`      <MontoNoFacturable>${cleanVal(row.MontoNoFacturable)}</MontoNoFacturable>`);
  if (cleanVal(row.MontoPeriodo)) xml.push(`      <MontoPeriodo>${cleanVal(row.MontoPeriodo)}</MontoPeriodo>`);
  if (cleanVal(row.SaldoAnterior)) xml.push(`      <SaldoAnterior>${cleanVal(row.SaldoAnterior)}</SaldoAnterior>`);
  if (cleanVal(row.MontoAvancePago)) xml.push(`      <MontoAvancePago>${cleanVal(row.MontoAvancePago)}</MontoAvancePago>`);
  if (cleanVal(row.ValorPagar)) xml.push(`      <ValorPagar>${cleanVal(row.ValorPagar)}</ValorPagar>`);
  if (cleanVal(row.TotalITBISRetenido) && cleanVal(row.TipoeCF) !== '32') xml.push(`      <TotalITBISRetenido>${cleanVal(row.TotalITBISRetenido)}</TotalITBISRetenido>`);
  if (cleanVal(row.TotalISRRetencion) && cleanVal(row.TipoeCF) !== '32') xml.push(`      <TotalISRRetencion>${cleanVal(row.TotalISRRetencion)}</TotalISRRetencion>`);
  if (cleanVal(row.TotalITBISPercepcion)) xml.push(`      <TotalITBISPercepcion>${cleanVal(row.TotalITBISPercepcion)}</TotalITBISPercepcion>`);
  if (cleanVal(row.TotalISRPercepcion)) xml.push(`      <TotalISRPercepcion>${cleanVal(row.TotalISRPercepcion)}</TotalISRPercepcion>`);
  xml.push('    </Totales>');

  // --- Otra Moneda ---
  if (cleanVal(row.TipoMoneda)) {
    xml.push('    <OtraMoneda>');
    xml.push(`      <TipoMoneda>${cleanVal(row.TipoMoneda)}</TipoMoneda>`);
    xml.push(`      <TipoCambio>${cleanVal(row.TipoCambio)}</TipoCambio>`);
    if (cleanVal(row.MontoGravadoTotalOtraMoneda)) xml.push(`      <MontoGravadoTotalOtraMoneda>${cleanVal(row.MontoGravadoTotalOtraMoneda)}</MontoGravadoTotalOtraMoneda>`);
    if (cleanVal(row.MontoGravado1OtraMoneda)) xml.push(`      <MontoGravado1OtraMoneda>${cleanVal(row.MontoGravado1OtraMoneda)}</MontoGravado1OtraMoneda>`);
    if (cleanVal(row.MontoGravado2OtraMoneda)) xml.push(`      <MontoGravado2OtraMoneda>${cleanVal(row.MontoGravado2OtraMoneda)}</MontoGravado2OtraMoneda>`);
    if (cleanVal(row.MontoGravado3OtraMoneda)) xml.push(`      <MontoGravado3OtraMoneda>${cleanVal(row.MontoGravado3OtraMoneda)}</MontoGravado3OtraMoneda>`);
    if (cleanVal(row.MontoExentoOtraMoneda)) xml.push(`      <MontoExentoOtraMoneda>${cleanVal(row.MontoExentoOtraMoneda)}</MontoExentoOtraMoneda>`);
    if (cleanVal(row.TotalITBISOtraMoneda)) xml.push(`      <TotalITBISOtraMoneda>${cleanVal(row.TotalITBISOtraMoneda)}</TotalITBISOtraMoneda>`);
    if (cleanVal(row.TotalITBIS1OtraMoneda)) xml.push(`      <TotalITBIS1OtraMoneda>${cleanVal(row.TotalITBIS1OtraMoneda)}</TotalITBIS1OtraMoneda>`);
    if (cleanVal(row.TotalITBIS2OtraMoneda)) xml.push(`      <TotalITBIS2OtraMoneda>${cleanVal(row.TotalITBIS2OtraMoneda)}</TotalITBIS2OtraMoneda>`);
    if (cleanVal(row.TotalITBIS3OtraMoneda)) xml.push(`      <TotalITBIS3OtraMoneda>${cleanVal(row.TotalITBIS3OtraMoneda)}</TotalITBIS3OtraMoneda>`);
    if (cleanVal(row.MontoImpuestoAdicionalOtraMoneda)) xml.push(`      <MontoImpuestoAdicionalOtraMoneda>${cleanVal(row.MontoImpuestoAdicionalOtraMoneda)}</MontoImpuestoAdicionalOtraMoneda>`);
    if (cleanVal(row.MontoTotalOtraMoneda)) xml.push(`      <MontoTotalOtraMoneda>${cleanVal(row.MontoTotalOtraMoneda)}</MontoTotalOtraMoneda>`);
    xml.push('    </OtraMoneda>');
  }

  xml.push('  </Encabezado>');

  // ==================== DETALLE DE BIENES O SERVICIOS ====================
  xml.push('  <DetallesItems>');
  for (let i = 1; i <= 250; i++) {
    const numLinea = cleanVal(row[`NumeroLinea[${i}]`]);
    const nomItem = cleanVal(row[`NombreItem[${i}]`]);
    if (!numLinea && !nomItem) continue;

    xml.push('    <Item>');
    xml.push(`      <NumeroLinea>${numLinea || String(i)}</NumeroLinea>`);
    
    // TablaCodigosItem
    if (cleanVal(row[`TipoCodigo[${i}][1]`])) {
      xml.push('      <TablaCodigosItem>');
      for (let tc = 1; tc <= 5; tc++) {
        if (cleanVal(row[`TipoCodigo[${i}][${tc}]`])) {
          xml.push('        <CodigosItem>');
          xml.push(`          <TipoCodigo>${cleanVal(row[`TipoCodigo[${i}][${tc}]`])}</TipoCodigo>`);
          xml.push(`          <CodigoItem>${cleanVal(row[`CodigoItem[${i}][${tc}]`])}</CodigoItem>`);
          xml.push('        </CodigosItem>');
        }
      }
      xml.push('      </TablaCodigosItem>');
    }

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
    if (cleanVal(row[`DescripcionItem[${i}]`])) {
      xml.push(`      <DescripcionItem>${cleanVal(row[`DescripcionItem[${i}]`])}</DescripcionItem>`);
    }
    xml.push(`      <CantidadItem>${cleanVal(row[`CantidadItem[${i}]`]) || '1'}</CantidadItem>`);
    if (cleanVal(row[`UnidadMedida[${i}]`])) {
      xml.push(`      <UnidadMedida>${cleanVal(row[`UnidadMedida[${i}]`])}</UnidadMedida>`);
    }
    if (cleanVal(row[`CantidadReferencia[${i}]`])) {
      xml.push(`      <CantidadReferencia>${cleanVal(row[`CantidadReferencia[${i}]`])}</CantidadReferencia>`);
    }
    if (cleanVal(row[`UnidadReferencia[${i}]`])) {
      xml.push(`      <UnidadReferencia>${cleanVal(row[`UnidadReferencia[${i}]`])}</UnidadReferencia>`);
    }
    if (cleanVal(row[`Subcantidad[${i}][1]`])) {
      xml.push('      <TablaSubcantidad>');
      for (let sc = 1; sc <= 5; sc++) {
        if (cleanVal(row[`Subcantidad[${i}][${sc}]`])) {
          xml.push('        <SubcantidadItem>');
          xml.push(`          <Subcantidad>${cleanVal(row[`Subcantidad[${i}][${sc}]`])}</Subcantidad>`);
          if (cleanVal(row[`CodigoSubcantidad[${i}][${sc}]`])) {
            xml.push(`          <CodigoSubcantidad>${cleanVal(row[`CodigoSubcantidad[${i}][${sc}]`])}</CodigoSubcantidad>`);
          }
          xml.push('        </SubcantidadItem>');
        }
      }
      xml.push('      </TablaSubcantidad>');
    }
    if (cleanVal(row[`GradosAlcohol[${i}]`])) {
      xml.push(`      <GradosAlcohol>${cleanVal(row[`GradosAlcohol[${i}]`])}</GradosAlcohol>`);
    }
    if (cleanVal(row[`PrecioUnitarioReferencia[${i}]`])) {
      xml.push(`      <PrecioUnitarioReferencia>${cleanVal(row[`PrecioUnitarioReferencia[${i}]`])}</PrecioUnitarioReferencia>`);
    }
    if (cleanVal(row[`FechaElaboracion[${i}]`])) {
      xml.push(`      <FechaElaboracion>${cleanVal(row[`FechaElaboracion[${i}]`])}</FechaElaboracion>`);
    }
    if (cleanVal(row[`FechaVencimientoItem[${i}]`])) {
      xml.push(`      <FechaVencimientoItem>${cleanVal(row[`FechaVencimientoItem[${i}]`])}</FechaVencimientoItem>`);
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
            if (cleanVal(row[`SubDescuentoPorcentaje[${i}][${sd}]`])) xml.push(`          <SubDescuentoPorcentaje>${cleanVal(row[`SubDescuentoPorcentaje[${i}][${sd}]`])}</SubDescuentoPorcentaje>`);
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
            const subRecargoPorc = cleanVal(row[`SubRecargoPorcentaje[${i}][${sr}]`]) || cleanVal(row[`SubrecargoPorcentaje[${i}][${sr}]`]);
            if (subRecargoPorc) xml.push(`          <SubRecargoPorcentaje>${subRecargoPorc}</SubRecargoPorcentaje>`);
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
      if (cleanVal(row[`DescuentoOtraMoneda[${i}]`])) xml.push(`        <DescuentoOtraMoneda>${cleanVal(row[`DescuentoOtraMoneda[${i}]`])}</DescuentoOtraMoneda>`);
      if (cleanVal(row[`RecargoOtraMoneda[${i}]`])) xml.push(`        <RecargoOtraMoneda>${cleanVal(row[`RecargoOtraMoneda[${i}]`])}</RecargoOtraMoneda>`);
      if (cleanVal(row[`MontoItemOtraMoneda[${i}]`])) xml.push(`        <MontoItemOtraMoneda>${cleanVal(row[`MontoItemOtraMoneda[${i}]`])}</MontoItemOtraMoneda>`);
      xml.push('      </OtraMonedaDetalle>');
    }

    xml.push(`      <MontoItem>${cleanVal(row[`MontoItem[${i}]`]) || '0.00'}</MontoItem>`);
    xml.push('    </Item>');
  }
  xml.push('  </DetallesItems>');

  // ==================== INFORMACIÓN DE REFERENCIA ====================
  if (cleanVal(row.NCFModificado)) {
    xml.push('  <InformacionReferencia>');
    xml.push(`    <NCFModificado>${cleanVal(row.NCFModificado)}</NCFModificado>`);
    if (cleanVal(row.RNCOtroContribuyente)) xml.push(`    <RNCOtroContribuyente>${cleanVal(row.RNCOtroContribuyente)}</RNCOtroContribuyente>`);
    if (cleanVal(row.FechaNCFModificado)) xml.push(`    <FechaNCFModificado>${cleanVal(row.FechaNCFModificado)}</FechaNCFModificado>`);
    if (cleanVal(row.CodigoModificacion)) xml.push(`    <CodigoModificacion>${cleanVal(row.CodigoModificacion)}</CodigoModificacion>`);
    if (cleanVal(row.RazonModificacion)) xml.push(`    <RazonModificacion>${cleanVal(row.RazonModificacion)}</RazonModificacion>`);
    xml.push('  </InformacionReferencia>');
  }

  // ==================== FECHA Y HORA FIRMA ====================
  const now = new Date(Date.now() + (++globalSecOffset * 2000));
  const pad = n => String(n).padStart(2, '0');
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const fechaEmision = cleanVal(row.FechaEmision) || '01-04-2020';
  xml.push(`  <FechaHoraFirma>${fechaEmision} ${timeStr}</FechaHoraFirma>`);

  xml.push('</ECF>');
  return xml.join('\n');
}

// 3. Generar Archivos
const EXCEL_FILE = path.resolve(__dirname, '../131917038-29092026182006.xlsx');
const workbook = XLSX.readFile(EXCEL_FILE);
const ecfRows = XLSX.utils.sheet_to_json(workbook.Sheets['ECF']);

const BASE_OUT = path.resolve(__dirname, 'dgii_test_output');
const DIRS = {
  generales: path.join(BASE_OUT, '1_Primero_Comprobantes_Generales'),
  notas: path.join(BASE_OUT, '2_Segundo_Notas_Debito_Credito'),
  rfce: path.join(BASE_OUT, '3_Tercero_Resumenes_Consumo_RFCE'),
  consumo250k: path.join(BASE_OUT, '4_Cuarto_Facturas_Consumo_Menor_250k'),
  rootConsumo250k: path.resolve(__dirname, '../Facturas_Consumo_Menor_250k')
};

Object.values(DIRS).forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

console.log('\n================ GENERANDO SET COMPLETO DE PRUEBAS DGII ================');

// A. Facturas de Consumo < 250k y sus RFCE
const fcRows = ecfRows.filter(r => r.TipoeCF == '32' && parseFloat(r.MontoTotal) < 250000);
fcRows.forEach(row => {
  const encf = cleanVal(row.ENCF);
  const rawXml = buildECF(row);
  const signedXml = signDgiiXml(rawXml, 'ECF');
  
  fs.writeFileSync(path.join(DIRS.consumo250k, `${encf}.xml`), signedXml, 'utf8');
  fs.writeFileSync(path.join(DIRS.rootConsumo250k, `${encf}.xml`), signedXml, 'utf8');
  
  // Generar RFCE exacto
  const { xml: rfceRaw } = convertECF32ToRFCE(signedXml);
  const signedRfce = signDgiiXml(rfceRaw, 'RFCE');
  fs.writeFileSync(path.join(DIRS.rfce, `RFCE_${encf}.xml`), signedRfce, 'utf8');
  
  console.log(`✅ [Consumo & RFCE] ${encf} generado y firmado.`);
});

// B. Notas de Débito y Crédito
const ncRows = ecfRows.filter(r => r.TipoeCF == '33' || r.TipoeCF == '34');
ncRows.forEach(row => {
  const encf = cleanVal(row.ENCF);
  const rawXml = buildECF(row);
  const signedXml = signDgiiXml(rawXml, 'ECF');
  fs.writeFileSync(path.join(DIRS.notas, `${encf}.xml`), signedXml, 'utf8');
  console.log(`✅ [Notas] ${encf}.xml generado y firmado.`);
});

// C. Comprobantes Generales
const genRows = ecfRows.filter(r => {
  const t = String(r.TipoeCF);
  if (t === '33' || t === '34') return false;
  if (t === '32' && parseFloat(r.MontoTotal) < 250000) return false;
  return true;
});

genRows.forEach(row => {
  const encf = cleanVal(row.ENCF);
  const rawXml = buildECF(row);
  const signedXml = signDgiiXml(rawXml, 'ECF');
  fs.writeFileSync(path.join(DIRS.generales, `${encf}.xml`), signedXml, 'utf8');
  console.log(`✅ [General] ${encf}.xml (Tipo ${row.TipoeCF}) generado y firmado.`);
});

console.log('\n========================================================================');
console.log('🎉 TODOS LOS COMPROBANTES DEL SET DE PRUEBAS HAN SIDO ACTUALIZADOS CON ÉXITO');
console.log('========================================================================\n');
