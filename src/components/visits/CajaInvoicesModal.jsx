import React from 'react';
import { Receipt, X, RefreshCw, Printer, Mail, Trash2 } from 'lucide-react';

/**
 * Modal to display invoices processed during the current active cash register shift.
 */
const CajaInvoicesModal = ({
  isOpen,
  onClose,
  activeRegister,
  loadingCajaInvoices,
  cajaInvoices = [],
  emailSendingId,
  onPrintInvoice,
  onSendEmailInvoice,
  onOpenVoidModal
}) => {
  if (!isOpen) return null;

  const activeInvoices = cajaInvoices.filter(inv => inv.status !== 'Anulado');
  const totals = activeInvoices.reduce((acc, inv) => {
    const amt = Number(inv.total || 0);
    const m = (inv.metodo_pago || 'Efectivo').toLowerCase();
    acc.total += amt;
    if (m.includes('efectivo')) acc.efectivo += amt;
    else if (m.includes('tarjeta')) acc.tarjeta += amt;
    else if (m.includes('transferencia')) acc.transferencia += amt;
    else if (m.includes('plan')) acc.planBeauty += amt;
    else acc.otros += amt;
    return acc;
  }, { total: 0, efectivo: 0, tarjeta: 0, transferencia: 0, planBeauty: 0, otros: 0 });

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.65)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1055,
      padding: '1rem'
    }}>
      <div style={{
        background: '#ffffff',
        width: '100%',
        maxWidth: '920px',
        maxHeight: '88vh',
        borderRadius: '20px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)'
      }}>

        {/* Modal Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          background: '#0f172a',
          color: 'white',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <h3 style={{
              margin: 0,
              fontSize: '1.1rem',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <Receipt size={20} color="#be185d" />
              Facturas de la Caja Activa ({activeRegister?.register_number || 'Caja en Turno'})
            </h3>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>
              Mostrando únicamente las facturas procesadas durante la sesión abierta de esta caja
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer' }}
          >
            <X size={22} />
          </button>
        </div>

        {/* Resumen rápido de totales desglosados */}
        {cajaInvoices.length > 0 && !loadingCajaInvoices && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '0.5rem',
            padding: '0.75rem 1.25rem',
            background: '#f8fafc',
            borderBottom: '1px solid #e2e8f0'
          }}>
            <div style={{ background: '#ecfdf5', padding: '0.5rem 0.75rem', borderRadius: '10px', border: '1px solid #a7f3d0' }}>
              <span style={{ fontSize: '0.65rem', color: '#047857', fontWeight: 800, textTransform: 'uppercase' }}>💵 Efectivo</span>
              <p style={{ margin: '0.1rem 0 0', fontSize: '0.95rem', fontWeight: 900, color: '#065f46' }}>
                RD$ {totals.efectivo.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div style={{ background: '#eff6ff', padding: '0.5rem 0.75rem', borderRadius: '10px', border: '1px solid #bfdbfe' }}>
              <span style={{ fontSize: '0.65rem', color: '#1d4ed8', fontWeight: 800, textTransform: 'uppercase' }}>💳 Tarjeta</span>
              <p style={{ margin: '0.1rem 0 0', fontSize: '0.95rem', fontWeight: 900, color: '#1e40af' }}>
                RD$ {totals.tarjeta.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
              </p>
            </div>
            {totals.transferencia > 0 && (
              <div style={{ background: '#faf5ff', padding: '0.5rem 0.75rem', borderRadius: '10px', border: '1px solid #e9d5ff' }}>
                <span style={{ fontSize: '0.65rem', color: '#7e22ce', fontWeight: 800, textTransform: 'uppercase' }}>🏦 Transferencia</span>
                <p style={{ margin: '0.1rem 0 0', fontSize: '0.95rem', fontWeight: 900, color: '#6b21a8' }}>
                  RD$ {totals.transferencia.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                </p>
              </div>
            )}
            <div style={{ background: '#0f172a', padding: '0.5rem 0.75rem', borderRadius: '10px' }}>
              <span style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase' }}>🧾 Total Facturado</span>
              <p style={{ margin: '0.1rem 0 0', fontSize: '0.95rem', fontWeight: 900, color: '#ffffff' }}>
                RD$ {totals.total.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        )}

        {/* Invoices Table Body */}
        <div style={{ padding: '1.25rem', overflowY: 'auto', flex: 1 }}>
          {loadingCajaInvoices ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
              <RefreshCw size={24} className="spin" style={{ margin: '0 auto 0.5rem' }} />
              <p>Cargando facturas de la caja...</p>
            </div>
          ) : cajaInvoices.length === 0 ? (
            <div style={{
              padding: '3rem',
              textAlign: 'center',
              color: '#64748b',
              background: '#f8fafc',
              borderRadius: '12px',
              border: '1px dashed #cbd5e1'
            }}>
              <p style={{ margin: 0, fontWeight: 700 }}>No hay facturas registradas en esta caja aún.</p>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}>Las facturas generadas en el turno aparecerán aquí en tiempo real.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem' }}>
                <thead>
                  <tr style={{
                    background: '#f8fafc',
                    borderBottom: '1px solid #e2e8f0',
                    textAlign: 'left',
                    color: '#475569',
                    fontSize: '0.725rem',
                    textTransform: 'uppercase'
                  }}>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Ticket / Factura</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Hora</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Cliente</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Método</th>
                    <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Total</th>
                    <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>Estado</th>
                    <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {cajaInvoices.map((inv) => {
                    const isVoid = inv.status === 'Anulado';
                    const timeStr = new Date(inv.visited_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    return (
                      <tr key={inv.id} style={{
                        borderBottom: '1px solid #f1f5f9',
                        opacity: isVoid ? 0.6 : 1,
                        background: isVoid ? '#fef2f2' : 'transparent'
                      }}>
                        <td style={{ padding: '0.75rem 0.5rem', fontWeight: 800, color: '#0f172a' }}>
                          {inv.ticket_number || `SD-${inv.id}`}
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem', color: '#64748b' }}>{timeStr}</td>
                        <td style={{ padding: '0.75rem 0.5rem', fontWeight: 700, color: '#1e293b' }}>
                          {inv.client_name || 'Cliente General'}
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem', color: '#475569' }}>
                          <span style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem' }}>
                            {inv.metodo_pago || 'Efectivo'}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontWeight: 900, color: isVoid ? '#dc2626' : '#0f172a' }}>
                          RD$ {Number(inv.total || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: '99px', fontSize: '0.7rem', fontWeight: 800,
                            background: isVoid ? '#fee2e2' : '#dcfce7',
                            color: isVoid ? '#b91c1c' : '#15803d'
                          }}>
                            {isVoid ? 'ANULADA' : 'FACTURADA'}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                            <button
                              type="button"
                              onClick={() => onPrintInvoice(inv)}
                              style={{
                                background: '#f1f5f9',
                                border: '1px solid #cbd5e1',
                                padding: '0.35rem 0.6rem',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '3px'
                              }}
                              title="Ver / Imprimir Factura Electrónica Oficial (e-CF DGII)"
                            >
                              <Printer size={13} />
                              <span>Factura</span>
                            </button>

                            <button
                              type="button"
                              disabled={emailSendingId === inv.id}
                              onClick={() => onSendEmailInvoice(inv)}
                              style={{
                                background: '#fdf2f8',
                                border: '1px solid #fbcfe8',
                                color: '#be185d',
                                padding: '0.35rem 0.6rem',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontSize: '0.75rem',
                                fontWeight: 800,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '3px'
                              }}
                              title="Enviar factura al correo electrónico del cliente"
                            >
                              <Mail size={13} />
                              <span>{emailSendingId === inv.id ? 'Enviando...' : 'Email'}</span>
                            </button>

                            {!isVoid && (
                              <button
                                type="button"
                                onClick={() => onOpenVoidModal(inv)}
                                style={{
                                  background: '#fef2f2',
                                  border: '1px solid #fecaca',
                                  color: '#dc2626',
                                  padding: '0.35rem 0.6rem',
                                  borderRadius: '8px',
                                  cursor: 'pointer',
                                  fontSize: '0.75rem',
                                  fontWeight: 700,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '3px'
                                }}
                                title="Anular Factura con Auditoría"
                              >
                                <Trash2 size={13} />
                                <span>Anular</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div style={{
          padding: '0.85rem 1.5rem',
          background: '#f8fafc',
          borderTop: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
            Total Facturas de la Caja: <strong>{cajaInvoices.length}</strong>
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: '#0f172a',
              color: 'white',
              border: 'none',
              padding: '0.5rem 1.25rem',
              borderRadius: '10px',
              fontSize: '0.85rem',
              fontWeight: 800,
              cursor: 'pointer'
            }}
          >
            Cerrar
          </button>
        </div>

      </div>
    </div>
  );
};

export default CajaInvoicesModal;
