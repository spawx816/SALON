import React, { useEffect } from 'react';
import { Printer, X } from 'lucide-react';
import { QRCodeSVG } from '../../utils/qrCodeGenerator';

/**
 * Modal de Impresión de Ticket Térmico Homologado POS (80mm / 60mm de cabezal)
 * Sigue estrictamente la regla #2 de GEMINI.md
 */
export const ThermalTicketModal = ({
  isOpen,
  onClose,
  printableTicketData = {},
  currentUser = null
}) => {
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        window.print();
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(3px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '1rem'
    }}>
      {/* Print CSS Rules for Thermal Printing (60mm printable safety width) */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #pos-thermal-ticket-80mm, #pos-thermal-ticket-80mm * {
            visibility: visible !important;
          }
          #pos-thermal-ticket-80mm {
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
            box-sizing: border-box !important;
          }
          .no-print-thermal {
            display: none !important;
          }
        }
      `}</style>

      <div style={{
        background: '#ffffff',
        width: '100%',
        maxWidth: '380px',
        maxHeight: '92vh',
        borderRadius: '16px',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
        overflow: 'hidden'
      }}>
        {/* Modal Actions Bar (Header) */}
        <div className="no-print-thermal" style={{
          padding: '0.85rem 1.25rem',
          background: '#f8fafc',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Printer size={18} style={{ color: '#be185d' }} />
            <span style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}>Pre-cuenta Impresora Térmica 80mm</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '0.2rem' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Container with exact Physical Preview */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '1rem', background: '#f1f5f9', display: 'flex', justifyContent: 'center' }}>
          {/* === TICKET FÍSICO 80MM (COMPACTO Y AJUSTADO A LA IZQUIERDA) === */}
          <div
            id="pos-thermal-ticket-80mm"
            style={{
              width: '250px',
              background: '#ffffff',
              padding: '10px 6px 14px 6px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
              borderRadius: '6px',
              color: '#000000',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
              fontSize: '9.5px',
              lineHeight: '1.2',
              boxSizing: 'border-box'
            }}
          >
            {/* 1. CABECERA PRINCIPAL (MARCA ABATTE PELUQUERIA + PLAN BEAUTY) */}
            <div style={{ textAlign: 'center', marginBottom: '6px' }}>
              <div style={{
                display: 'inline-block',
                borderRight: '2px solid #000000',
                padding: '0 6px 0 2px',
                textAlign: 'center'
              }}>
                <div style={{
                  fontSize: '22px',
                  fontWeight: 900,
                  letterSpacing: '2.5px',
                  lineHeight: '1',
                  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                }}>
                  ABATTE
                </div>
                <div style={{
                  borderTop: '2px solid #000000',
                  borderBottom: '2px solid #000000',
                  padding: '2px 0',
                  marginTop: '3px',
                  fontSize: '9.5px',
                  fontWeight: 900,
                  letterSpacing: '3px',
                  lineHeight: '1.1'
                }}>
                  PELUQUERIA
                </div>
              </div>
              <div style={{
                fontSize: '13px',
                fontWeight: 900,
                letterSpacing: '3px',
                marginTop: '4px',
                color: '#000000'
              }}>
                PLAN BEAUTY
              </div>
            </div>

            {/* LÍNEA SEPARADORA PUNTEADA */}
            <div style={{ borderBottom: '1.5px dotted #000000', margin: '5px 0 7px 0' }} />

            {/* 2. METADATOS DEL TICKET */}
            <div style={{ fontSize: '9.5px', lineHeight: '1.35', marginBottom: '5px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '2px' }}>
                <span style={{ fontWeight: 800, minWidth: '78px' }}>TICKET No.:</span>
                <span style={{ fontWeight: 900, fontSize: '12px', letterSpacing: '0.5px' }}>
                  {printableTicketData.ticketNumber || 'SD-0251'}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '2px' }}>
                <span style={{ fontWeight: 800, minWidth: '50px' }}>FECHA:</span>
                <span style={{ borderBottom: '1px solid #000000', flex: 1, paddingLeft: '3px', fontWeight: 600 }}>
                  {printableTicketData.dateFormatted || new Date().toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '2px' }}>
                <span style={{ fontWeight: 800, minWidth: '50px' }}>HORA:</span>
                <span style={{ borderBottom: '1px solid #000000', flex: 1, paddingLeft: '3px', fontWeight: 600 }}>
                  {printableTicketData.timeFormatted || new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', hour12: true })}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '2px' }}>
                <span style={{ fontWeight: 800, minWidth: '55px' }}>CLIENTE:</span>
                <span style={{ borderBottom: '1px solid #000000', flex: 1, paddingLeft: '3px', fontWeight: 800, textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {printableTicketData.clientName || 'CLIENTE GENERAL'}
                </span>
              </div>

              {printableTicketData.ncf && (
                <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '2px', background: '#f8fafc', border: '1px solid #000000', padding: '1px 3px', borderRadius: '2px' }}>
                  <span style={{ fontWeight: 900, minWidth: '50px' }}>e-NCF:</span>
                  <span style={{ fontWeight: 900, fontSize: '11px', letterSpacing: '0.5px' }}>
                    {printableTicketData.ncf}
                  </span>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'baseline' }}>
                <span style={{ fontWeight: 800, minWidth: '90px' }}>RECEPCIONISTA:</span>
                <span style={{ borderBottom: '1px solid #000000', flex: 1, paddingLeft: '3px', fontWeight: 600, textTransform: 'capitalize' }}>
                  {printableTicketData.receptionistName || currentUser?.nombre || currentUser?.name || 'Staff Recepción'}
                </span>
              </div>
            </div>

            {/* 3. CAJA DE BENEFICIOS (PLAN BEAUTY Y CUMPLEAÑOS) */}
            <div style={{
              border: '1.5px solid #000000',
              borderRadius: '4px',
              display: 'flex',
              margin: '5px 0 7px 0',
              padding: '4px 5px',
              alignItems: 'center'
            }}>
              {/* Tarjeta Plan Beauty */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px', borderRight: '1.5px solid #000000', paddingRight: '4px' }}>
                <span style={{ fontSize: '14px', lineHeight: 1 }}>💎</span>
                <div style={{ fontSize: '7px', lineHeight: 1.15 }}>
                  <div style={{ fontWeight: 900, textTransform: 'uppercase' }}>PLAN BEAUTY ACTIVO</div>
                  <div style={{ fontSize: '9.5px', fontWeight: 900, marginTop: '1px' }}>
                    {printableTicketData.isPlanBeauty ? (printableTicketData.planWashesAvailable ? `${printableTicketData.planWashesAvailable} disp.` : 'Lavado disp.') : 'Lavado disp.'}
                  </div>
                </div>
              </div>

              {/* Tarjeta Cumpleaños */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px', paddingLeft: '5px' }}>
                <span style={{ fontSize: '14px', lineHeight: 1 }}>📅</span>
                <div style={{ fontSize: '7px', lineHeight: 1.15 }}>
                  <div style={{ fontWeight: 900, textTransform: 'uppercase' }}>SEMANA CUMPLEAÑOS</div>
                  <div style={{ fontSize: '7.5px', fontWeight: 800, marginTop: '1px' }}>
                    15% DESC. DISPONIBLE
                  </div>
                </div>
              </div>
            </div>

            {/* 4. TABLA DE SERVICIOS PRE-IMPRESA */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontWeight: 900,
              fontSize: '9px',
              letterSpacing: '0.8px',
              borderBottom: '1.5px solid #000000',
              paddingBottom: '2px',
              marginBottom: '3px'
            }}>
              <span>SERVICIO</span>
              <span style={{ paddingRight: '4px' }}>PRECIO</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                'Lavado y secado con línea',
                'Lavado y secado',
                'Corte',
                'Tinte',
                'Texturizado',
                'Aplicación productos',
                'Maquillaje',
                'Cejas',
                'Depilación tintado',
                'Manicure',
                'Pedicure',
                'Gel',
                'Uñas acrílicas',
                'Extensiones'
              ].map((srv, idx) => {
                const matchedService = printableTicketData.services?.find?.(s =>
                  s.nombre?.toLowerCase()?.trim() === srv.toLowerCase().trim() ||
                  s.nombre?.toLowerCase()?.includes(srv.toLowerCase()) ||
                  srv.toLowerCase()?.includes(s.nombre?.toLowerCase() || '')
                );
                return (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '9px', padding: '2px 0' }}>
                    <span style={{ fontWeight: 600, color: '#000000' }}>{srv}</span>
                    <div style={{ display: 'flex', alignItems: 'baseline', minWidth: '74px', justifyContent: 'flex-end', paddingRight: '2px' }}>
                      <span style={{ fontWeight: 700, marginRight: '3px', fontSize: '8px' }}>RD$</span>
                      <span style={{ borderBottom: '1px solid #777777', width: '46px', display: 'inline-block', textAlign: 'right', fontWeight: 800, fontSize: '8.5px' }}>
                        {matchedService?.precio ? Number(matchedService.precio).toLocaleString('es-DO') : ''}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 5. SECCIÓN TOTAL RD$ */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '7px 0 5px 0', paddingTop: '2px' }}>
              <span style={{ fontSize: '13px', fontWeight: 900, letterSpacing: '0.5px' }}>
                TOTAL RD$
              </span>
              <div style={{
                border: '1.5px solid #000000',
                width: '85px',
                height: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 900,
                fontSize: '10.5px',
                marginRight: '2px'
              }}>
                {printableTicketData.totalAmount ? `RD$ ${Number(printableTicketData.totalAmount).toLocaleString('es-DO', { minimumFractionDigits: 2 })}` : ''}
              </div>
            </div>

            {/* 6. PIE DEL TICKET CON QR REAL Y MENÚ DE SERVICIOS / DGII */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', margin: '6px 0 4px 0' }}>
              <div style={{ background: '#ffffff', padding: '1px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <QRCodeSVG 
                  value={
                    printableTicketData.qrUrl || 
                    (printableTicketData.ncf 
                      ? (printableTicketData.ncf.startsWith('E32') && Number(printableTicketData.totalAmount || 0) < 250000
                          ? `https://fc.dgii.gov.do/eCF/ConsultaTimbreFC?RncEmisor=131917038&ENCF=${printableTicketData.ncf}&MontoTotal=${Number(printableTicketData.totalAmount || 0).toFixed(2)}&CodigoSeguridad=${printableTicketData.securityCode || '000000'}`
                          : `https://fc.dgii.gov.do/eCF/ConsultaTimbre?RncEmisor=131917038&RncComprador=${printableTicketData.clientRnc || ''}&ENCF=${printableTicketData.ncf}&MontoTotal=${Number(printableTicketData.totalAmount || 0).toFixed(2)}&FechaEmision=02/10/2026&FechaFirma=02/10/2026&CodigoSeguridad=${printableTicketData.securityCode || '000000'}`)
                      : 'https://planbeauty.do/servicios'
                    )
                  } 
                  size={46} 
                  level="M"
                  includeMargin={false} 
                />
              </div>

              <div style={{ height: '34px', borderLeft: '1.5px solid #000000' }} />

              <div style={{
                fontSize: '8.5px',
                fontWeight: 900,
                letterSpacing: '1px',
                lineHeight: '1.3',
                textAlign: 'left'
              }}>
                {printableTicketData.ncf ? (
                  <>TIMBRE FISCAL<br />DGII OFICIAL</>
                ) : (
                  <>MENÚ DE<br />SERVICIOS</>
                )}
              </div>
            </div>

            {/* Cursiva Gracias por preferirnos */}
            <div style={{
              textAlign: 'center',
              marginTop: '4px',
              fontFamily: '"Dancing Script", "Brush Script MT", "Caveat", cursive',
              fontSize: '18px',
              fontWeight: 700,
              color: '#000000'
            }}>
              Gracias por preferirnos !
            </div>
            <div style={{ textAlign: 'center', fontSize: '15px', lineHeight: '1', marginTop: '1px' }}>
              ♡
            </div>
          </div>
        </div>

        {/* Modal Footer Controls */}
        <div className="no-print-thermal" style={{ padding: '0.85rem 1.25rem', background: '#f8fafc', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '0.75rem' }}>
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
            style={{ flex: 1.5, padding: '0.65rem', borderRadius: '8px', border: 'none', background: '#be185d', color: '#ffffff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', cursor: 'pointer', boxShadow: '0 4px 12px rgba(190,24,93,0.3)' }}
          >
            <Printer size={16} />
            <span>Imprimir Ticket (80mm)</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ThermalTicketModal;
