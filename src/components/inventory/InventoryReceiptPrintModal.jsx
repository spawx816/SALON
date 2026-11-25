import React, { useEffect } from 'react';
import { Printer, X, FileCheck2 } from 'lucide-react';
import { useTenantBranding } from '../../context/TenantBrandingContext';

export default function InventoryReceiptPrintModal({ receipt, isOpen, onClose, autoPrint = true }) {
  const { branding } = useTenantBranding();

  useEffect(() => {
    if (isOpen && receipt && autoPrint) {
      const timer = setTimeout(() => {
        window.print();
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [isOpen, receipt, autoPrint]);

  if (!isOpen || !receipt) return null;

  const isTransfer = receipt.kind === 'transfer';
  const companyName =
    branding?.business_name && branding.business_name !== 'SalonPro'
      ? branding.business_name
      : 'SalonPro';
  const dateObj = new Date(receipt.date || Date.now());
  const formattedDate = dateObj.toLocaleDateString('es-DO', {
    timeZone: 'America/Santo_Domingo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const formattedTime = dateObj.toLocaleTimeString('es-DO', {
    timeZone: 'America/Santo_Domingo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <div
      className="inv-receipt-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(9, 9, 11, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1rem',
      }}
    >
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #printable-inventory-receipt,
          #printable-inventory-receipt * {
            visibility: visible !important;
          }
          #printable-inventory-receipt {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: 190mm !important;
            margin: 0 !important;
            padding: 8mm !important;
            box-shadow: none !important;
            border: none !important;
            background: #ffffff !important;
            color: #09090b !important;
          }
          .inv-receipt-no-print {
            display: none !important;
          }
        }
      `}</style>

      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '680px',
          maxHeight: '92vh',
          overflowY: 'auto',
          boxShadow: '0 24px 60px rgba(9, 9, 11, 0.28)',
        }}
      >
        <div
          className="inv-receipt-no-print"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '1rem 1.25rem',
            borderBottom: '1px solid #e2e8f0',
            background: '#f8fafc',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800, color: '#09090b' }}>
            <FileCheck2 size={18} />
            <span>{isTransfer ? 'Acuse de Transferencia de Inventario' : 'Acuse de Ajuste de Stock'}</span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => window.print()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.45rem 0.9rem',
                borderRadius: '8px',
                border: 'none',
                background: '#09090b',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '0.84rem',
                cursor: 'pointer',
              }}
            >
              <Printer size={15} /> Imprimir Acuse
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              style={{
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                borderRadius: '8px',
                width: '32px',
                height: '32px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div id="printable-inventory-receipt" style={{ padding: '1.5rem', color: '#09090b', fontSize: '0.88rem' }}>
          {/* Cabecera */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #09090b', paddingBottom: '0.85rem', marginBottom: '1rem' }}>
            <div>
              {branding?.logo_url && (
                <img src={branding.logo_url} alt={companyName} style={{ maxHeight: '42px', objectFit: 'contain', marginBottom: '0.35rem' }} />
              )}
              <div style={{ fontSize: '1.15rem', fontWeight: 900, letterSpacing: '-0.01em' }}>{companyName}</div>
              <div style={{ fontSize: '0.8rem', color: '#475569', fontWeight: 600 }}>
                {isTransfer ? 'COMPROBANTE / ACUSE DE TRANSFERENCIA DE INVENTARIO' : 'COMPROBANTE / ACUSE DE AJUSTE DE STOCK'}
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: '0.8rem' }}>
              <div style={{ fontWeight: 800, fontSize: '0.92rem' }}>Folio: {receipt.folio || 'S/N'}</div>
              <div>Fecha: <strong>{formattedDate}</strong></div>
              <div>Hora: <strong>{formattedTime}</strong></div>
            </div>
          </div>

          {/* Datos Básicos */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem 1.2rem', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.85rem 1rem', marginBottom: '1.1rem', fontSize: '0.84rem' }}>
            <div>
              <span style={{ color: '#64748b', fontWeight: 600 }}>Tipo de Operación: </span>
              <strong style={{ color: '#09090b' }}>{receipt.operationLabel}</strong>
            </div>
            <div>
              <span style={{ color: '#64748b', fontWeight: 600 }}>Registrado por: </span>
              <strong style={{ color: '#09090b' }}>{receipt.operatorName || 'Usuario'}</strong>
            </div>
            {isTransfer ? (
              <>
                <div>
                  <span style={{ color: '#64748b', fontWeight: 600 }}>Ubicación Origen: </span>
                  <strong style={{ color: '#09090b' }}>{receipt.sourceLocation || '—'}</strong>
                </div>
                <div>
                  <span style={{ color: '#64748b', fontWeight: 600 }}>Ubicación Destino: </span>
                  <strong style={{ color: '#09090b' }}>{receipt.destinationLocation || '—'}</strong>
                </div>
              </>
            ) : (
              <div style={{ gridColumn: '1 / -1' }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Almacén / Sucursal: </span>
                <strong style={{ color: '#09090b' }}>{receipt.locationName || 'Almacén Principal'}</strong>
              </div>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              <span style={{ color: '#64748b', fontWeight: 600 }}>Motivo / Observaciones: </span>
              <strong style={{ color: '#09090b' }}>{receipt.reason || 'Sin observaciones adicionales'}</strong>
            </div>
          </div>

          {/* Tabla de Artículos */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '2.25rem', fontSize: '0.84rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #09090b', background: '#f1f5f9', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem 0.6rem' }}>Código / SKU</th>
                <th style={{ padding: '0.5rem 0.6rem' }}>Producto</th>
                <th style={{ padding: '0.5rem 0.6rem', textAlign: 'right' }}>Cantidad</th>
                {!isTransfer && (
                  <>
                    <th style={{ padding: '0.5rem 0.6rem', textAlign: 'right' }}>Stock Ant.</th>
                    <th style={{ padding: '0.5rem 0.6rem', textAlign: 'right' }}>Stock Nuevo</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {(receipt.items || []).map((item, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #cbd5e1' }}>
                  <td style={{ padding: '0.55rem 0.6rem', fontFamily: 'monospace' }}>{item.sku || '—'}</td>
                  <td style={{ padding: '0.55rem 0.6rem', fontWeight: 700 }}>{item.name || 'Producto'}</td>
                  <td style={{ padding: '0.55rem 0.6rem', textAlign: 'right', fontWeight: 800 }}>
                    {item.quantity} {item.unit || ''}
                  </td>
                  {!isTransfer && (
                    <>
                      <td style={{ padding: '0.55rem 0.6rem', textAlign: 'right' }}>{item.previousStock ?? '—'}</td>
                      <td style={{ padding: '0.55rem 0.6rem', textAlign: 'right', fontWeight: 700 }}>{item.newStock ?? '—'}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Firmas */}
          {isTransfer ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem', marginTop: '2.75rem', paddingTop: '0.5rem', textAlign: 'center', fontSize: '0.78rem' }}>
              <div>
                <div style={{ borderTop: '1px solid #09090b', paddingTop: '0.4rem', fontWeight: 700 }}>Entregado / Despachado por</div>
                <div style={{ color: '#64748b', marginTop: '2px' }}>Nombre, Firma y Fecha</div>
              </div>
              <div>
                <div style={{ borderTop: '1px solid #09090b', paddingTop: '0.4rem', fontWeight: 700 }}>Autorizado por</div>
                <div style={{ color: '#64748b', marginTop: '2px' }}>Administración / Supervisión</div>
              </div>
              <div>
                <div style={{ borderTop: '1px solid #09090b', paddingTop: '0.4rem', fontWeight: 700 }}>Recibido Conforme por</div>
                <div style={{ color: '#64748b', marginTop: '2px' }}>Nombre, Firma y Fecha</div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2.5rem', marginTop: '2.75rem', paddingTop: '0.5rem', textAlign: 'center', fontSize: '0.8rem' }}>
              <div>
                <div style={{ borderTop: '1px solid #09090b', paddingTop: '0.4rem', fontWeight: 700 }}>
                  Realizado por ({receipt.operatorName || 'Operador'})
                </div>
                <div style={{ color: '#64748b', marginTop: '2px' }}>Firma del Responsable</div>
              </div>
              <div>
                <div style={{ borderTop: '1px solid #09090b', paddingTop: '0.4rem', fontWeight: 700 }}>
                  Autorizado / Verificado por
                </div>
                <div style={{ color: '#64748b', marginTop: '2px' }}>Administración / Auditoría</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
