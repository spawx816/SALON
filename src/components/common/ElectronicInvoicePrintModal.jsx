import React, { useEffect } from 'react';
import { Printer, X, ShieldCheck } from 'lucide-react';
import { QRCodeSVG } from '../../utils/qrCodeGenerator';

/**
 * Modal de Representación Impresa Oficial de Factura Electrónica (e-CF DGII)
 * Formato térmico homologado 80mm / 60mm según especificaciones oficiales de la DGII.
 */
export default function ElectronicInvoicePrintModal({ invoice, isOpen, onClose }) {
  if (!isOpen || !invoice) return null;

  // Items parsing
  let items = [];
  try {
    if (invoice.items_detail) {
      items = typeof invoice.items_detail === 'string' ? JSON.parse(invoice.items_detail) : invoice.items_detail;
    }
  } catch (e) {
    items = [];
  }

  if (!Array.isArray(items) || items.length === 0) {
    if (invoice.servicios) {
      const srvs = typeof invoice.servicios === 'string' && invoice.servicios.startsWith('[')
        ? JSON.parse(invoice.servicios)
        : (Array.isArray(invoice.servicios) ? invoice.servicios : [invoice.servicios]);
      items = srvs.map(s => ({
        nombre: typeof s === 'string' ? s : (s.nombre || 'Servicio'),
        cantidad: s.cantidad || 1,
        precioAplicado: s.precioAplicado || s.precio || invoice.total || 0
      }));
    } else {
      items = [{ nombre: 'Servicio General', cantidad: 1, precioAplicado: invoice.total || 0 }];
    }
  }

  const dateObj = new Date(invoice.visited_at || Date.now());
  const dateFormatted = dateObj.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeFormatted = dateObj.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  const encfNumber = invoice.ncf || `E32${String(invoice.ticket_number || invoice.id || '1').replace(/\D/g, '').padStart(10, '0').slice(-10)}`;
  const encfName = invoice.ncf_name || (encfNumber.startsWith('E31') ? 'Factura de Crédito Fiscal Electrónica' : 'Factura de Consumo Electrónica');
  const totalVal = Number(invoice.total || 0);
  const securityCode = invoice.codigo_seguridad_ecf || 'S/DqDu';

  const emisorRnc = '131917038';
  const compradorRnc = invoice.rnc_cliente || '000000000';
  const qrUrl = invoice.qr_code_url || `https://ecf.dgii.gov.do/consultatimbre?RncEmisor=${emisorRnc}&RncComprador=${compradorRnc}&eNCF=${encfNumber}&MontoTotal=${totalVal.toFixed(2)}&CodigoSeguridad=${securityCode}`;

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem' }}>
      
      {/* Estilos específicos para impresión térmica 80mm / 60mm de la Factura Oficial */}
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
            font-family: 'Courier New', Courier, monospace, monospace !important;
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
            <ShieldCheck size={18} style={{ color: '#10b981' }} />
            <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>Factura Electrónica (e-CF DGII)</span>
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
              boxSizing: 'border-box'
            }}
          >
            {/* 1. ENCABEZADO EMISOR */}
            <div style={{ textAlign: 'left', marginBottom: '8px' }}>
              <div style={{ fontWeight: 900, fontSize: '11px', textTransform: 'uppercase' }}>PLAN BEAUTY RD</div>
              <div style={{ fontWeight: 800 }}>ABATTE PELUQUERIA, SRL</div>
              <div>Sucursal San Vicente de Paúl</div>
              <div>Dirección: Av. San Vicente de Paúl #48, SDE</div>
              <div>RNC: 131917038</div>
            </div>

            {/* SEPARADOR ASTERISCOS */}
            <div style={{ textAlign: 'center', letterSpacing: '1px', margin: '4px 0', fontSize: '8.5px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              ************************************
            </div>

            {/* 2. TIPO DE COMPROBANTE Y E-NCF */}
            <div style={{ margin: '4px 0' }}>
              <div style={{ fontWeight: 900, fontSize: '10px' }}>{encfName}</div>
              <div style={{ fontWeight: 900, fontSize: '11px', letterSpacing: '0.5px' }}>
                e-NCF: {encfNumber}
              </div>
            </div>

            {/* SEPARADOR ASTERISCOS */}
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
              {invoice.metodo_pago && (
                <div><strong>Método de pago:</strong> {invoice.metodo_pago}</div>
              )}
            </div>

            {/* LÍNEA GUIONES */}
            <div style={{ textAlign: 'center', letterSpacing: '1px', margin: '4px 0', fontSize: '8.5px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              ------------------------------------
            </div>

            {/* 4. ENCABEZADO DE TABLA DE PRODUCTOS / SERVICIOS */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '8.5px', marginBottom: '2px' }}>
              <span>Cant.  Descripción</span>
              <span>Unidad</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '8.5px', marginBottom: '4px' }}>
              <span>Precio</span>
              <span>ITBIS</span>
              <span>Valor</span>
            </div>

            {/* LÍNEA GUIONES */}
            <div style={{ textAlign: 'center', letterSpacing: '1px', margin: '2px 0 6px', fontSize: '8.5px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              ------------------------------------
            </div>

            {/* 5. LISTA DE ÍTEMS FACTURADOS */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {items.map((it, idx) => {
                const qty = Number(it.cantidad || 1);
                const precio = Number(it.precioAplicado || it.precio || 0);
                const totalItem = qty * precio;

                return (
                  <div key={idx} style={{ fontSize: '9px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                      <span>{qty}   {it.nombre || it.service_name || 'Servicio'}</span>
                      <span>UND</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#111827', marginTop: '1px' }}>
                      <span>RD$ {precio.toFixed(2)}</span>
                      <span>0.00</span>
                      <span style={{ fontWeight: 800 }}>RD$ {totalItem.toFixed(2)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* LÍNEA GUIONES */}
            <div style={{ textAlign: 'center', letterSpacing: '1px', margin: '8px 0 4px', fontSize: '8.5px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              ------------------------------------
            </div>

            {/* 6. TOTALES */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'right', fontSize: '9px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700 }}>Subtotal Gravado:</span>
                <span>RD$ 0.00</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700 }}>Subtotal Exento:</span>
                <span>RD$ {totalVal.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700 }}>Total ITBIS (18%):</span>
                <span>RD$ 0.00</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: '11px', marginTop: '4px', borderTop: '1px solid #000000', paddingTop: '3px' }}>
                <span>TOTAL A PAGAR:</span>
                <span>RD$ {totalVal.toLocaleString('es-DO', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

            {/* LÍNEA GUIONES */}
            <div style={{ textAlign: 'center', letterSpacing: '1px', margin: '6px 0', fontSize: '8.5px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              ------------------------------------
            </div>

            {/* 7. QR CODE OFICIAL DGII Y CÓDIGO DE SEGURIDAD */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '8px 0 4px' }}>
              <div style={{ background: '#ffffff', padding: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <QRCodeSVG value={qrUrl} size={68} level="M" />
              </div>
              <div style={{ fontSize: '8px', fontWeight: 800, marginTop: '5px', textAlign: 'center' }}>
                Código de Seguridad: {securityCode}<br />
                Fecha Firma: {dateFormatted} {timeFormatted}
              </div>
            </div>

            {/* 8. LEYENDA OFICIAL DE REPRESENTACIÓN IMPRESA */}
            <div style={{ fontSize: '7px', textAlign: 'center', color: '#4b5563', marginTop: '6px', lineHeight: '1.2' }}>
              *Este documento es una Representación Impresa (RI) de un Comprobante Fiscal Electrónico (e-CF) certificado por la DGII.
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
            <span>Imprimir Factura e-CF</span>
          </button>
        </div>

      </div>
    </div>
  );
}
