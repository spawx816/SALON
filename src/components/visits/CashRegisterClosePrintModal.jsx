import React, { useEffect } from 'react';
import { Printer, X, CheckCircle, AlertTriangle, ArrowDownRight, DollarSign } from 'lucide-react';

/**
 * Modal de Impresión de Cierre y Arqueo de Caja
 * Replica fielmente el reporte oficial administrativo de cierre de caja en negro/escala nítida.
 * Compatible con impresoras de tickets POS (80mm) y hojas estándar de oficina.
 */
export const CashRegisterClosePrintModal = ({
  isOpen,
  onClose,
  reportData = null,
  autoPrint = true
}) => {
  useEffect(() => {
    if (isOpen && autoPrint) {
      const timer = setTimeout(() => {
        window.print();
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [isOpen, autoPrint]);

  if (!isOpen || !reportData) return null;

  const fmtRD = (num) => 'RD$ ' + Number(num || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  const formatDateDO = (dateVal) => {
    if (!dateVal) return 'N/A';
    try {
      return new Date(dateVal).toLocaleString('es-DO', {
        timeZone: 'America/Santo_Domingo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch (e) {
      return String(dateVal);
    }
  };

  const {
    registerNumber = 'CAJA-001',
    employeeName = 'Recepción',
    salonName = 'Abatte Peluquería',
    openedAt,
    closedAt,
    initialAmt = 0,
    finalAmt = 0,
    montoEsperado = 0,
    diferencia = 0,
    observaciones = '',
    stats = {}
  } = reportData;

  const efectivoTotal = stats.efectivoTotal || 0;
  const tarjetaTotal = stats.tarjetaTotal || 0;
  const transferenciaTotal = stats.transferenciaTotal || 0;
  const giftCardTotal = stats.giftCardTotal || 0;
  const consumoTotal = stats.consumoTotal || 0;
  const planBeautyTotal = stats.planBeautyTotal || 0;
  const otrosTotal = stats.otrosTotal || 0;
  const totalFacturado = stats.totalFacturado || (efectivoTotal + tarjetaTotal + transferenciaTotal + giftCardTotal + consumoTotal + otrosTotal);
  const countVentas = stats.countVentas || 0;

  const gastosTotal = stats.gastosTotal || 0;
  const prestamosTotal = stats.prestamosTotal || 0;
  const retirosTotal = stats.retirosTotal || 0;
  const entradasTotal = stats.entradasTotal || 0;

  const listaGastos = stats.listaGastos || [];
  const listaPrestamos = stats.listaPrestamos || [];
  const listaRetiros = stats.listaRetiros || [];
  const listaEntradas = stats.listaEntradas || [];
  const listaAnulaciones = stats.listaAnulaciones || [];

  const diffVal = Number(diferencia || 0);
  const isPerfect = Math.abs(diffVal) < 0.01;
  const isSurplus = diffVal > 0.01;
  const isShortage = diffVal < -0.01;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(15, 23, 42, 0.75)',
      backdropFilter: 'blur(5px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 99999,
      padding: '1rem'
    }}>
      {/* Reglas de Impresión: Aislar el ticket y asegurar que se imprima perfectamente */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #printable-cierre-caja-root, #printable-cierre-caja-root * {
            visibility: visible !important;
          }
          #printable-cierre-caja-root {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: 80mm !important;
            margin: 0 auto !important;
            padding: 2mm !important;
            background: #ffffff !important;
            color: #000000 !important;
            box-shadow: none !important;
            border: none !important;
          }
          .no-print-cierre {
            display: none !important;
          }
        }
      `}</style>

      {/* Contenedor Modal en Pantalla */}
      <div style={{
        background: '#ffffff',
        width: '100%',
        maxWidth: '540px',
        maxHeight: '94vh',
        borderRadius: '20px',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)',
        overflow: 'hidden'
      }}>
        {/* Barra de Controles Superior (No imprimible) */}
        <div className="no-print-cierre" style={{
          padding: '1rem 1.25rem',
          background: '#0f172a',
          color: '#ffffff',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #1e293b'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Printer size={18} color="#38bdf8" />
            <span style={{ fontSize: '0.95rem', fontWeight: 800 }}>Imprimir Reporte de Cierre de Caja</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => window.print()}
              style={{
                background: '#2563eb',
                color: '#ffffff',
                border: 'none',
                padding: '0.45rem 0.9rem',
                borderRadius: '8px',
                fontSize: '0.8rem',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem'
              }}
            >
              <Printer size={14} /> Imprimir Ahora
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'rgba(255,255,255,0.1)',
                color: '#cbd5e1',
                border: 'none',
                padding: '6px',
                borderRadius: '8px',
                cursor: 'pointer'
              }}
              title="Cerrar"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* CONTENIDO IMPRIMIBLE DEL REPORTE */}
        <div style={{ overflowY: 'auto', padding: '1rem 1.25rem', background: '#f8fafc' }}>
          <div id="printable-cierre-caja-root" style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            padding: '1.25rem',
            color: '#0f172a',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
          }}>
            
            {/* CABECERA OFICIAL EN NEGRO */}
            <div style={{ textAlign: 'center', borderBottom: '2px solid #000000', paddingBottom: '12px', marginBottom: '14px' }}>
              <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 900, letterSpacing: '1px', color: '#000000', textTransform: 'uppercase' }}>
                ABATTE PELUQUERÍA
              </h1>
              <h2 style={{ margin: '4px 0 0 0', fontSize: '12px', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Reporte Oficial de Cierre y Arqueo de Caja
              </h2>
            </div>

            {/* METADATOS DE LA CAJA */}
            <div style={{ background: '#f1f5f9', borderRadius: '10px', padding: '10px 12px', marginBottom: '14px', fontSize: '11.5px', lineHeight: 1.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                <span style={{ color: '#475569', fontWeight: 700 }}>Caja N°:</span>
                <span style={{ fontWeight: 800, color: '#000000' }}>{registerNumber}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                <span style={{ color: '#475569', fontWeight: 700 }}>Responsable / Cajera:</span>
                <span style={{ fontWeight: 800, color: '#000000' }}>{employeeName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                <span style={{ color: '#475569', fontWeight: 700 }}>Sucursal:</span>
                <span style={{ fontWeight: 600 }}>{salonName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                <span style={{ color: '#475569', fontWeight: 700 }}>Apertura:</span>
                <span>{formatDateDO(openedAt)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                <span style={{ color: '#475569', fontWeight: 700 }}>Cierre:</span>
                <span>{formatDateDO(closedAt)}</span>
              </div>
            </div>

            {/* SECCIÓN 1: RESUMEN DE VENTAS FACTURADAS */}
            <div style={{ border: '1px solid #cbd5e1', borderRadius: '10px', padding: '10px 12px', marginBottom: '12px' }}>
              <div style={{ fontSize: '11px', fontWeight: 900, textTransform: 'uppercase', color: '#000000', borderBottom: '1px solid #e2e8f0', paddingBottom: '4px', marginBottom: '6px' }}>
                💳 Resumen de Ventas ({countVentas} Transacciones)
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                <tbody>
                  <tr style={{ borderBottom: '1px dashed #e2e8f0' }}>
                    <td style={{ padding: '3px 0' }}>💵 Efectivo Neto</td>
                    <td style={{ padding: '3px 0', textAlign: 'right', fontWeight: 700 }}>{fmtRD(efectivoTotal)}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px dashed #e2e8f0' }}>
                    <td style={{ padding: '3px 0' }}>💳 Tarjeta / Verifone</td>
                    <td style={{ padding: '3px 0', textAlign: 'right', fontWeight: 700 }}>{fmtRD(tarjetaTotal)}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px dashed #e2e8f0' }}>
                    <td style={{ padding: '3px 0' }}>📲 Transferencia</td>
                    <td style={{ padding: '3px 0', textAlign: 'right', fontWeight: 700 }}>{fmtRD(transferenciaTotal)}</td>
                  </tr>
                  {giftCardTotal > 0 && (
                    <tr style={{ borderBottom: '1px dashed #e2e8f0' }}>
                      <td style={{ padding: '3px 0' }}>🎁 Gift Card / Bono</td>
                      <td style={{ padding: '3px 0', textAlign: 'right', fontWeight: 700 }}>{fmtRD(giftCardTotal)}</td>
                    </tr>
                  )}
                  {consumoTotal > 0 && (
                    <tr style={{ borderBottom: '1px dashed #e2e8f0' }}>
                      <td style={{ padding: '3px 0' }}>👥 Consumo Nómina</td>
                      <td style={{ padding: '3px 0', textAlign: 'right', fontWeight: 700 }}>{fmtRD(consumoTotal)}</td>
                    </tr>
                  )}
                  {planBeautyTotal > 0 && (
                    <tr style={{ borderBottom: '1px dashed #e2e8f0' }}>
                      <td style={{ padding: '3px 0' }}>💎 Plan Beauty (Canjes)</td>
                      <td style={{ padding: '3px 0', textAlign: 'right', fontWeight: 700 }}>{fmtRD(planBeautyTotal)}</td>
                    </tr>
                  )}
                  {otrosTotal > 0 && (
                    <tr style={{ borderBottom: '1px dashed #e2e8f0' }}>
                      <td style={{ padding: '3px 0' }}>🏷️ Otros Métodos</td>
                      <td style={{ padding: '3px 0', textAlign: 'right', fontWeight: 700 }}>{fmtRD(otrosTotal)}</td>
                    </tr>
                  )}
                  <tr style={{ borderTop: '1.5px solid #000000', fontWeight: 900, fontSize: '12px' }}>
                    <td style={{ padding: '6px 0', color: '#000000' }}>TOTAL FACTURADO</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', color: '#000000' }}>{fmtRD(totalFacturado)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* FACTURAS ANULADAS SI EXISTEN */}
            {listaAnulaciones.length > 0 && (
              <div style={{ border: '1px solid #fca5a5', background: '#fef2f2', borderRadius: '10px', padding: '8px 10px', marginBottom: '12px', fontSize: '10.5px' }}>
                <div style={{ fontWeight: 800, color: '#991b1b', marginBottom: '4px' }}>
                  🚫 Facturas Anuladas Descontadas ({listaAnulaciones.length})
                </div>
                {listaAnulaciones.map((a, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                    <span>{a.concept} ({a.payment_method})</span>
                    <span style={{ fontWeight: 800, color: '#dc2626' }}>-{fmtRD(a.amount)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* SECCIÓN 2: SALIDAS Y PRÉSTAMOS */}
            {(gastosTotal > 0 || prestamosTotal > 0 || retirosTotal > 0 || entradasTotal > 0) && (
              <div style={{ border: '1px solid #cbd5e1', borderRadius: '10px', padding: '10px 12px', marginBottom: '12px' }}>
                <div style={{ fontSize: '11px', fontWeight: 900, textTransform: 'uppercase', color: '#000000', borderBottom: '1px solid #e2e8f0', paddingBottom: '4px', marginBottom: '6px' }}>
                  📉 Salidas, Préstamos y Entradas
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                  <tbody>
                    {gastosTotal > 0 && (
                      <tr style={{ borderBottom: '1px dashed #e2e8f0' }}>
                        <td style={{ padding: '3px 0' }}>🔻 Gastos / Compras:</td>
                        <td style={{ padding: '3px 0', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>-{fmtRD(gastosTotal)}</td>
                      </tr>
                    )}
                    {prestamosTotal > 0 && (
                      <tr style={{ borderBottom: '1px dashed #e2e8f0' }}>
                        <td style={{ padding: '3px 0' }}>👥 Préstamos Colaboradoras:</td>
                        <td style={{ padding: '3px 0', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>-{fmtRD(prestamosTotal)}</td>
                      </tr>
                    )}
                    {retirosTotal > 0 && (
                      <tr style={{ borderBottom: '1px dashed #e2e8f0' }}>
                        <td style={{ padding: '3px 0' }}>🏦 Retiros de Efectivo:</td>
                        <td style={{ padding: '3px 0', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>-{fmtRD(retirosTotal)}</td>
                      </tr>
                    )}
                    {entradasTotal > 0 && (
                      <tr style={{ borderBottom: '1px dashed #e2e8f0' }}>
                        <td style={{ padding: '3px 0' }}>➕ Entradas Adicionales:</td>
                        <td style={{ padding: '3px 0', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>+{fmtRD(entradasTotal)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {/* DETALLE PRÉSTAMOS */}
                {listaPrestamos.length > 0 && (
                  <div style={{ marginTop: '6px', paddingTop: '4px', borderTop: '1px solid #f1f5f9', fontSize: '10.5px' }}>
                    <div style={{ fontWeight: 800, color: '#475569', marginBottom: '2px' }}>Detalle de Préstamos:</div>
                    {listaPrestamos.map((p, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}>
                        <span><strong>{p.employee_name}</strong>: {p.concept}</span>
                        <span style={{ fontWeight: 700 }}>{fmtRD(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* SECCIÓN 3: ARQUEO DE EFECTIVO FÍSICO */}
            <div style={{ border: '2px solid #000000', borderRadius: '10px', padding: '10px 12px', marginBottom: '12px', background: '#fafafa' }}>
              <div style={{ fontSize: '11px', fontWeight: 900, textTransform: 'uppercase', color: '#000000', borderBottom: '1.5px solid #000000', paddingBottom: '4px', marginBottom: '6px' }}>
                💵 Cuadre y Arqueo de Efectivo Físico
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '3px 0' }}>(+) Fondo Inicial de Caja:</td>
                    <td style={{ padding: '3px 0', textAlign: 'right', fontWeight: 700 }}>{fmtRD(initialAmt)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '3px 0' }}>(+) Ventas Netas Efectivo:</td>
                    <td style={{ padding: '3px 0', textAlign: 'right', fontWeight: 700 }}>+{fmtRD(efectivoTotal)}</td>
                  </tr>
                  {entradasTotal > 0 && (
                    <tr>
                      <td style={{ padding: '3px 0' }}>(+) Entradas Adicionales:</td>
                      <td style={{ padding: '3px 0', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>+{fmtRD(entradasTotal)}</td>
                    </tr>
                  )}
                  {(gastosTotal + prestamosTotal) > 0 && (
                    <tr>
                      <td style={{ padding: '3px 0' }}>(-) Gastos y Préstamos:</td>
                      <td style={{ padding: '3px 0', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>-{fmtRD(gastosTotal + prestamosTotal)}</td>
                    </tr>
                  )}
                  {retirosTotal > 0 && (
                    <tr>
                      <td style={{ padding: '3px 0' }}>(-) Retiros de Efectivo:</td>
                      <td style={{ padding: '3px 0', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>-{fmtRD(retirosTotal)}</td>
                    </tr>
                  )}
                  <tr style={{ borderTop: '1px solid #cbd5e1', fontWeight: 800 }}>
                    <td style={{ padding: '5px 0' }}>(=) EFECTIVO ESPERADO:</td>
                    <td style={{ padding: '5px 0', textAlign: 'right' }}>{fmtRD(montoEsperado)}</td>
                  </tr>
                  <tr style={{ borderTop: '1.5px solid #000000', fontWeight: 900, fontSize: '12px' }}>
                    <td style={{ padding: '6px 0', color: '#000000' }}>(💵) EFECTIVO CONTADO:</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', color: '#000000' }}>{fmtRD(finalAmt)}</td>
                  </tr>
                  <tr style={{ fontWeight: 800 }}>
                    <td style={{ padding: '4px 0' }}>Resultado de Cuadre:</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: isPerfect ? '#16a34a' : isSurplus ? '#2563eb' : '#dc2626' }}>
                      {isPerfect ? '🟢 Cuadre Exacto' : isSurplus ? `🔷 Sobrante: +${fmtRD(diffVal)}` : `🔴 Faltante: -${fmtRD(Math.abs(diffVal))}`}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* SECCIÓN 4: OBSERVACIONES */}
            {observaciones ? (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '8px 10px', fontSize: '10.5px', marginBottom: '14px', color: '#92400e' }}>
                <strong>Observaciones de Cierre:</strong><br />
                <span style={{ fontStyle: 'italic' }}>"{observaciones}"</span>
              </div>
            ) : null}

            {/* SECCIÓN 5: ESPACIOS DE FIRMA */}
            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px dashed #cbd5e1', display: 'flex', justifyContent: 'space-between', gap: '20px', textAlign: 'center' }}>
              <div style={{ flex: 1 }}>
                <div style={{ borderBottom: '1px solid #000000', height: '35px', marginBottom: '4px' }}></div>
                <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase' }}>Firma Cajera / Recepcionista</div>
                <div style={{ fontSize: '9px', color: '#64748b' }}>{employeeName}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ borderBottom: '1px solid #000000', height: '35px', marginBottom: '4px' }}></div>
                <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase' }}>Firma Supervisor / Admin</div>
                <div style={{ fontSize: '9px', color: '#64748b' }}>Revisión y Aprobación</div>
              </div>
            </div>

            {/* PIE DEL TICKET */}
            <div style={{ textAlign: 'center', fontSize: '9.5px', color: '#64748b', marginTop: '14px', paddingTop: '8px', borderTop: '1px solid #f1f5f9' }}>
              Sistema POS & Gestión Salon Pro • Plan Beauty RD<br />
              Reporte Oficial de Cierre y Arqueo de Caja
            </div>

          </div>
        </div>

        {/* Barra de Acciones Inferior (No imprimible) */}
        <div className="no-print-cierre" style={{
          padding: '0.85rem 1.25rem',
          background: '#ffffff',
          borderTop: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: '#f1f5f9',
              color: '#475569',
              border: 'none',
              padding: '0.55rem 1.1rem',
              borderRadius: '10px',
              fontSize: '0.85rem',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            Cerrar Ventana
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            style={{
              background: '#000000',
              color: '#ffffff',
              border: 'none',
              padding: '0.55rem 1.3rem',
              borderRadius: '10px',
              fontSize: '0.85rem',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem'
            }}
          >
            <Printer size={16} /> Imprimir Comprobante
          </button>
        </div>

      </div>
    </div>
  );
};

export default CashRegisterClosePrintModal;
