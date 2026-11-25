import React, { useState, useEffect } from 'react';
import { Printer, X, Ticket } from 'lucide-react';
import DocumentPrintRenderer from './DocumentPrintRenderer';
import { useTenantBranding } from '../../context/TenantBrandingContext';

export default function TurnTicketModal({ isOpen, onClose, branchId = 'default', simpleMode = false }) {
  const { branding } = useTenantBranding();
  const [serviceName, setServiceName] = useState('');
  const [observations, setObservations] = useState('');
  const [emitting, setEmitting] = useState(false);
  const [error, setError] = useState('');
  const [activeTicket, setActiveTicket] = useState(null);
  const [recentTickets, setRecentTickets] = useState([]);

  const loadRecent = async () => {
    try {
      const q = branchId && branchId !== 'default' ? `?branch_id=${encodeURIComponent(branchId)}` : '';
      const res = await fetch(`/api/turn-tickets${q}`, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.tickets)) {
        setRecentTickets(data.tickets);
      }
    } catch {
      // Ignore non-blocking history error
    }
  };

  useEffect(() => {
    if (isOpen) {
      setError('');
      if (!simpleMode) {
        loadRecent();
      }
    }
  }, [isOpen, branchId, simpleMode]);

  if (!isOpen) return null;

  const handleEmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (emitting) return;
    setEmitting(true);
    setError('');
    try {
      const res = await fetch('/api/turn-tickets', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `pos_turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        },
        body: JSON.stringify({
          branch_id: branchId || 'default',
          service_name: simpleMode ? null : (serviceName.trim() || null),
          observations: simpleMode ? null : (observations.trim() || null),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo emitir el ticket de turno.');
      setActiveTicket(data.ticket);
      setServiceName('');
      setObservations('');
      if (!simpleMode) {
        await loadRecent();
      }
      setTimeout(() => window.print(), 200);
    } catch (err) {
      setError(err.message);
    } finally {
      setEmitting(false);
    }
  };

  if (simpleMode) {
    return (
      <div
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
        <div
          style={{
            background: '#ffffff',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '400px',
            padding: '1.5rem',
            boxShadow: '0 24px 60px rgba(9, 9, 11, 0.25)',
            textAlign: 'center',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Ticket size={18} /> Ticket de Turno
            </h3>
            <button type="button" onClick={onClose} aria-label="Cerrar" style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: '8px', width: '32px', height: '32px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={16} />
            </button>
          </div>

          {error && (
            <div role="alert" style={{ padding: '0.75rem', borderRadius: '8px', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '0.88rem', marginBottom: '1rem' }}>
              {error}
            </div>
          )}

          <button
            type="button"
            disabled={emitting}
            onClick={handleEmit}
            style={{ width: '100%', padding: '0.9rem 1rem', borderRadius: '12px', border: 'none', background: '#09090b', color: '#ffffff', fontWeight: 800, fontSize: '0.95rem', cursor: emitting ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
          >
            <Printer size={17} />
            <span>{emitting ? 'Generando...' : 'Generar ticket'}</span>
          </button>

          {activeTicket && (
            <div style={{ marginTop: '1rem', background: '#f8fafc', borderRadius: '12px', padding: '0.85rem', border: '1px solid #e2e8f0' }}>
              <DocumentPrintRenderer
                template={activeTicket.template_snapshot}
                data={activeTicket}
                branding={branding}
                isPreview={false}
                printableId="etereas-pos-turn-ticket"
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1rem',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '720px',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '1.5rem',
          boxShadow: '0 24px 60px rgba(15, 23, 42, 0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Ticket size={18} /> Emitir Ticket de Turno (Sin cobro)
          </h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: '8px', width: '32px', height: '32px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={16} />
          </button>
        </div>

        {error && (
          <div role="alert" style={{ padding: '0.75rem', borderRadius: '8px', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '0.88rem', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.25rem' }}>
          <div>
            <form onSubmit={handleEmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>Servicio (opcional)</label>
                <input
                  type="text"
                  placeholder="Ej. Lavado Completo"
                  value={serviceName}
                  onChange={(e) => setServiceName(e.target.value)}
                  style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>Observaciones (opcional)</label>
                <textarea
                  rows={2}
                  placeholder="Ej. Placa / Vehículo / Nota"
                  value={observations}
                  onChange={(e) => setObservations(e.target.value)}
                  style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                />
              </div>
              <button
                type="submit"
                disabled={emitting}
                style={{ padding: '0.7rem 1rem', borderRadius: '10px', border: 'none', background: '#0f172a', color: '#ffffff', fontWeight: 700, cursor: emitting ? 'not-allowed' : 'pointer' }}
              >
                {emitting ? 'Emitiendo...' : 'Emitir e Imprimir Turno'}
              </button>
            </form>

            {recentTickets.length > 0 && (
              <div style={{ marginTop: '1.25rem' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b', marginBottom: '0.45rem' }}>
                  Reimprimir turnos recientes
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {recentTickets.slice(0, 8).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setActiveTicket(t);
                        setTimeout(() => window.print(), 150);
                      }}
                      style={{ padding: '0.35rem 0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                    >
                      <Printer size={12} /> #{t.display_number}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={{ background: '#f1f5f9', borderRadius: '12px', padding: '1rem' }}>
            {activeTicket ? (
              <>
                <DocumentPrintRenderer
                  template={activeTicket.template_snapshot}
                  data={activeTicket}
                  branding={branding}
                  isPreview={false}
                  printableId="etereas-pos-turn-ticket"
                />
                <button
                  type="button"
                  onClick={() => window.print()}
                  style={{ width: '100%', marginTop: '0.75rem', padding: '0.55rem', borderRadius: '8px', border: '1px solid #0f172a', background: '#fff', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                >
                  <Printer size={15} /> Reimprimir #{activeTicket.display_number}
                </button>
              </>
            ) : (
              <div style={{ textAlign: 'center', color: '#64748b', fontSize: '0.85rem', padding: '2rem 1rem' }}>
                Emite un turno o selecciona uno reciente para previsualizar e imprimir.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
