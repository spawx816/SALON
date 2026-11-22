import React from 'react';
import { Printer, X, ShieldCheck, Receipt } from 'lucide-react';
import { QRCodeSVG } from '../../utils/qrCodeGenerator';
import { useTenantBranding } from '../../context/TenantBrandingContext';

/**
 * Modal de Impresión de Documentos POS:
 * 1. Precuenta (status !== 'Facturado'): documento informativo, sin NCF, sin QR público.
 * 2. Factura Comercial / NCF Convencional (B01, B02, B14, B15 o sin NCF):
 *    documento persistido de venta finalizada, sin QR fiscal simulado ni texto "Pendiente ante la DGII".
 * 3. Factura Electrónica e-CF: únicamente cuando existe emisión electrónica real (dgii_track_id / codigo_seguridad_ecf).
 */
export default function ElectronicInvoicePrintModal({ invoice, isOpen, onClose }) {
  const { branding } = useTenantBranding();
  if (!isOpen || !invoice) return null;

  const isDefaultBranding = !branding?.business_name || branding.business_name === 'SalonPro';
  const issuerName =
    invoice.emisor_razon_social ||
    invoice.company_name ||
    invoice.business_name ||
    (!isDefaultBranding ? branding.business_name : '') ||
    'Mi Empresa';
  const issuerLogo = invoice.logo_url || branding?.logo_url || null;
  const issuerBranch = invoice.branch_name || invoice.sucursal || '';
  const issuerAddress = invoice.emisor_direccion || invoice.address || branding?.address || '';
  const issuerPhone = invoice.emisor_telefono || invoice.phone || branding?.phone || '';
  const issuerRnc = invoice.emisor_rnc || invoice.rnc || branding?.rnc || '';
  const issuerReceiptHeader = invoice.receipt_header || branding?.receipt_header || '';
  const issuerReceiptFooter = invoice.receipt_footer || branding?.receipt_footer || '';

  // Items parsing
  let items = [];
  try {
    if (invoice.items_detail) {
      items = typeof invoice.items_detail === 'string' ? JSON.parse(invoice.items_detail) : invoice.items_detail;
    }
  } catch {
    items = [];
  }

  if (!Array.isArray(items) || items.length === 0) {
    if (invoice.servicios) {
      const srvs = typeof invoice.servicios === 'string' && invoice.servicios.startsWith('[')
        ? JSON.parse(invoice.servicios)
        : (Array.isArray(invoice.servicios) ? invoice.servicios : [invoice.servicios]);
      items = srvs.map((s) => ({
        nombre: typeof s === 'string' ? s : (s.nombre || 'Servicio'),
        cantidad: s.cantidad || 1,
        precioAplicado: s.precioAplicado || s.precio || invoice.total || 0,
      }));
    } else {
      items = [{ nombre: 'Servicio General', cantidad: 1, precioAplicado: invoice.total || 0 }];
    }
  }

  const dateObj = new Date(invoice.visited_at || Date.now());
  const dateFormatted = dateObj.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeFormatted = dateObj.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  const isBilled = String(invoice.status || '').toLowerCase() === 'facturado';
  const isVoided = String(invoice.status || '').toLowerCase() === 'anulado';
  const ncfNumber = invoice.ncf ? String(invoice.ncf).trim() : '';
  const ncfType = invoice.ncf_type ? String(invoice.ncf_type).trim().toUpperCase() : '';
  const isRealElectronicEcf = Boolean(
    isBilled &&
    ncfNumber &&
    ncfNumber.toUpperCase().startsWith('E') &&
    (invoice.dgii_track_id || invoice.codigo_seguridad_ecf)
  );
  const isConventionalNcf = Boolean(isBilled && ncfNumber && !isRealElectronicEcf);

  let modalHeaderTitle = 'Precuenta Informativa';
  let docTitle = 'Precuenta (Pendiente de Pago)';
  let docSubtitle = '*** DOCUMENTO INFORMATIVO — NO ES FACTURA ***';
  let printButtonLabel = 'Imprimir Precuenta';
  let footerLegend = '*Documento informativo de pre-cuenta. No constituye factura ni comprobante fiscal.';

  if (isRealElectronicEcf) {
    modalHeaderTitle = 'Factura Electrónica (e-CF)';
    docTitle = invoice.ncf_name || (ncfNumber.startsWith('E31') ? 'Factura de Crédito Fiscal Electrónica' : 'Factura de Consumo Electrónica');
    docSubtitle = `e-NCF: ${ncfNumber}`;
    printButtonLabel = 'Imprimir Factura e-CF';
    footerLegend = '*Representación Impresa (RI) de Comprobante Fiscal Electrónico (e-CF).';
  } else if (isConventionalNcf) {
    modalHeaderTitle = `Factura con Comprobante (${ncfType || ncfNumber.slice(0, 3)})`;
    docTitle = invoice.ncf_name || (ncfNumber.startsWith('B01') ? 'Factura de Crédito Fiscal' : 'Factura de Consumo');
    docSubtitle = `NCF: ${ncfNumber}`;
    printButtonLabel = 'Imprimir Factura';
    footerLegend = '*Factura comercial con número de comprobante (NCF) asignado por la empresa.';
  } else if (isBilled || isVoided) {
    modalHeaderTitle = isVoided ? 'Factura Anulada' : 'Factura Comercial';
    docTitle = isVoided ? 'FACTURA ANULADA' : 'Factura Comercial';
    docSubtitle = 'Comprobante comercial interno';
    printButtonLabel = 'Imprimir Factura';
    footerLegend = '*Factura comercial emitida por la empresa (sin comprobante fiscal NCF).';
  }

  const totalVal = Number(invoice.total || 0);
  const discountVal = Number(invoice.descuento || 0);
  const itbisVal = Number(invoice.itbis || 0);
  const subtotalVal = Number(invoice.subtotal || (totalVal + discountVal - itbisVal));
  const hasTax = itbisVal > 0.004;

  // Solo mostrar QR fiscal cuando existe emisión electrónica e-CF real con URL oficial
  const officialEcfQrUrl = isRealElectronicEcf && invoice.qr_code_url ? invoice.qr_code_url : null;

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem' }}>
      <style>{`
        @media print {
          @page {
            size: 80mm auto;
            margin: 0mm !important;
          }
          body * {
            visibility: hidden !important;
          }
          #pos-electronic-invoice-ri, #pos-electronic-invoice-ri * {
            visibility: visible !important;
          }
          #pos-electronic-invoice-ri {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 60mm !important;
            max-width: 60mm !important;
            margin: 0 !important;
            padding: 1mm 1mm 6mm 0.5mm !important;
            background: #ffffff !important;
            color: #000000 !important;
            box-shadow: none !important;
            border: none !important;
            font-family: 'Courier New', Courier, monospace !important;
            font-size: 8.5px !important;
            line-height: 1.25 !important;
            display: block !important;
            box-sizing: border-box !important;
          }
          .no-print-invoice-modal {
            display: none !important;
          }
        }
      `}</style>

      <div style={{ background: '#ffffff', width: '100%', maxWidth: '400px', maxHeight: '92vh', borderRadius: '16px', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)', overflow: 'hidden' }}>
        {/* Header Modal */}
        <div className="no-print-invoice-modal" style={{ padding: '0.85rem 1.25rem', background: '#09090b', color: '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {isRealElectronicEcf ? <ShieldCheck size={18} style={{ color: '#10b981' }} /> : <Receipt size={18} style={{ color: '#38bdf8' }} />}
            <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>{modalHeaderTitle}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#a1a1aa', cursor: 'pointer', padding: '0.2rem' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Vista previa térmica */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '1.25rem', background: '#e2e8f0', display: 'flex', justifyContent: 'center' }}>
          <div
            id="pos-electronic-invoice-ri"
            style={{
              width: '260px',
              background: '#ffffff',
              padding: '14px 10px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
              borderRadius: '6px',
              color: '#000000',
              fontFamily: '"Courier New", Courier, monospace',
              fontSize: '9.5px',
              lineHeight: '1.3',
              boxSizing: 'border-box',
            }}
          >
            {/* 1. ENCABEZADO EMISOR (DATOS REALES DE LA EMPRESA) */}
            <div style={{ textAlign: 'left', marginBottom: '8px' }}>
              {issuerLogo && (
                <div style={{ textAlign: 'center', marginBottom: '6px' }}>
                  <img
                    src={issuerLogo}
                    alt={issuerName}
                    style={{ maxWidth: '130px', maxHeight: '42px', objectFit: 'contain', filter: 'grayscale(100%) contrast(180%)' }}
                  />
                </div>
              )}
              <div style={{ fontWeight: 900, fontSize: '11px', textTransform: 'uppercase' }}>{issuerName}</div>
              {issuerBranch && <div>{issuerBranch}</div>}
              {issuerAddress && <div>Dirección: {issuerAddress}</div>}
              {issuerPhone && <div>Tel.: {issuerPhone}</div>}
              {issuerRnc && <div>RNC: {issuerRnc}</div>}
              {issuerReceiptHeader && issuerReceiptHeader !== 'SalonPro - Sistema de Gestión' && (
                <div style={{ marginTop: '3px', fontSize: '8.5px', fontWeight: 700 }}>{issuerReceiptHeader}</div>
              )}
            </div>

            <div style={{ textAlign: 'center', letterSpacing: '1px', margin: '4px 0', fontSize: '8.5px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              ************************************
            </div>

            {/* 2. TIPO DE DOCUMENTO Y NCF */}
            <div style={{ margin: '4px 0' }}>
              <div style={{ fontWeight: 900, fontSize: '10px' }}>{docTitle}</div>
              <div style={{ fontWeight: 900, fontSize: '11px', letterSpacing: '0.5px' }}>
                {docSubtitle}
              </div>
              {isVoided && (
                <div style={{ fontSize: '8px', color: '#b91c1c', fontWeight: 800, marginTop: '2px' }}>
                  DOCUMENTO ANULADO
                </div>
              )}
            </div>

            <div style={{ textAlign: 'center', letterSpacing: '1px', margin: '4px 0', fontSize: '8.5px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              ************************************
            </div>

            {/* 3. METADATOS DE EMISIÓN Y RECEPTOR */}
            <div style={{ margin: '6px 0', fontSize: '9px' }}>
              <div><strong>Fecha Emisión:</strong> {dateFormatted}</div>
              <div><strong>Hora:</strong> {timeFormatted}</div>
              <div><strong>Ticket Ref:</strong> {invoice.ticket_number || `SD-${invoice.id}`}</div>
              <div style={{ marginTop: '3px' }}>
                <strong>Cliente:</strong> {invoice.client_name || 'Cliente General'}
              </div>
              {invoice.rnc_cliente && (
                <div><strong>RNC/Cédula:</strong> {invoice.rnc_cliente}</div>
              )}
              {invoice.rzn_soc_cliente && (
                <div><strong>Razón Social:</strong> {invoice.rzn_soc_cliente}</div>
              )}
              {invoice.metodo_pago && (
                <div><strong>Método de pago:</strong> {invoice.metodo_pago}</div>
              )}
            </div>

            <div style={{ textAlign: 'center', letterSpacing: '1px', margin: '4px 0', fontSize: '8.5px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              ------------------------------------
            </div>

            {/* 4. ENCABEZADO DE TABLA */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '8.5px', marginBottom: '2px' }}>
              <span>Cant.  Descripción</span>
              <span>Valor</span>
            </div>

            <div style={{ textAlign: 'center', letterSpacing: '1px', margin: '2px 0 6px', fontSize: '8.5px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              ------------------------------------
            </div>

            {/* 5. LISTA DE ÍTEMS */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {items.map((it, idx) => {
                const qty = Number(it.cantidad || 1);
                const precio = Number(it.precioAplicado ?? it.precio ?? 0);
                const totalItem = qty * precio;

                return (
                  <div key={idx} style={{ fontSize: '9px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                      <span>{qty} x {it.nombre || it.service_name || 'Servicio'}</span>
                      <span style={{ fontWeight: 800 }}>RD$ {totalItem.toFixed(2)}</span>
                    </div>
                    <div style={{ fontSize: '8px', color: '#374151' }}>
                      P.U.: RD$ {precio.toFixed(2)}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ textAlign: 'center', letterSpacing: '1px', margin: '8px 0 4px', fontSize: '8.5px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              ------------------------------------
            </div>

            {/* 6. TOTALES COHERENTES (SIN TASA APLICADA EN EXENTOS) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'right', fontSize: '9px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700 }}>{hasTax ? 'Subtotal:' : 'Subtotal Exento:'}</span>
                <span>RD$ {subtotalVal.toFixed(2)}</span>
              </div>
              {discountVal > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 700 }}>Descuento:</span>
                  <span>- RD$ {discountVal.toFixed(2)}</span>
                </div>
              )}
              {hasTax ? (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 700 }}>ITBIS:</span>
                  <span>RD$ {itbisVal.toFixed(2)}</span>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 700 }}>ITBIS:</span>
                  <span>Exento (RD$ 0.00)</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: '11px', marginTop: '4px', borderTop: '1px solid #000000', paddingTop: '3px' }}>
                <span>TOTAL A PAGAR:</span>
                <span>RD$ {totalVal.toLocaleString('es-DO', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

            <div style={{ textAlign: 'center', letterSpacing: '1px', margin: '6px 0', fontSize: '8.5px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              ------------------------------------
            </div>

            {/* 7. QR ÚNICAMENTE EN E-CF ELECTRÓNICO REAL EMITIDO */}
            {officialEcfQrUrl && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '8px 0 4px' }}>
                <div style={{ background: '#ffffff', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <QRCodeSVG value={officialEcfQrUrl} size={115} level="L" includeMargin={true} />
                </div>
                {invoice.codigo_seguridad_ecf && (
                  <div style={{ fontSize: '8px', fontWeight: 800, marginTop: '5px', textAlign: 'center' }}>
                    Código de Seguridad: {invoice.codigo_seguridad_ecf}
                  </div>
                )}
              </div>
            )}

            {/* 8. PIE DE RECIBO CONFIGURADO POR LA EMPRESA + LEYENDA DEL DOCUMENTO */}
            {issuerReceiptFooter && (
              <div style={{ fontSize: '8.5px', textAlign: 'center', fontWeight: 700, color: '#111827', marginTop: '4px', lineHeight: '1.3' }}>
                {issuerReceiptFooter}
              </div>
            )}
            <div style={{ fontSize: '7.5px', textAlign: 'center', color: '#4b5563', marginTop: '6px', lineHeight: '1.25' }}>
              {footerLegend}
            </div>
          </div>
        </div>

        {/* Modal Footer Controls */}
        <div className="no-print-invoice-modal" style={{ padding: '0.85rem 1.25rem', background: '#f8fafc', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '0.75rem' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ flex: 1, padding: '0.65rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#ffffff', fontWeight: 700, color: '#475569', cursor: 'pointer' }}
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            style={{ flex: 1.5, padding: '0.65rem', borderRadius: '8px', border: 'none', background: '#09090b', color: '#ffffff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}
          >
            <Printer size={16} />
            <span>{printButtonLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
