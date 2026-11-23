import React, { useState } from 'react';
import { X, Send, CheckCircle2, AlertTriangle, LifeBuoy } from 'lucide-react';
import { getRecentClientErrors } from '../../utils/errorReporter';

const CATEGORIES = [
  'Error / algo no funciona',
  'Cálculo o monto incorrecto',
  'No encuentro una opción',
  'Lentitud o carga infinita',
  'Otro',
];

export default function ReportIssueModal({ isOpen, onClose }) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [sentReportId, setSentReportId] = useState('');

  if (!isOpen) return null;

  const handleClose = () => {
    setError('');
    setSentReportId('');
    setDescription('');
    setCategory(CATEGORIES[0]);
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = description.trim();
    if (trimmed.length < 5) {
      setError('Describe brevemente qué ocurrió (mínimo 5 caracteres).');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/support/report-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          category,
          description: trimmed,
          currentUrl: window.location.href,
          recentErrors: getRecentClientErrors(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'No se pudo enviar el reporte.');
      }
      setSentReportId(data.reportId || 'OK');
    } catch (err) {
      setError(err.message || 'Error al enviar el reporte.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={handleClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          background: '#ffffff',
          borderRadius: '18px',
          boxShadow: '0 24px 48px rgba(15, 23, 42, 0.22)',
          overflow: 'hidden',
          color: '#0f172a',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1rem 1.25rem',
            borderBottom: '1px solid #e2e8f0',
            background: '#f8fafc',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <LifeBuoy size={18} color="#2563eb" />
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Reportar un problema</h3>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Cerrar"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '1.25rem' }}>
          {sentReportId ? (
            <div style={{ textAlign: 'center', padding: '1rem 0.5rem' }}>
              <CheckCircle2 size={42} color="#16a34a" style={{ marginBottom: '0.75rem' }} />
              <h4 style={{ margin: '0 0 0.4rem', fontSize: '1.05rem', fontWeight: 700 }}>¡Reporte enviado!</h4>
              <p style={{ margin: '0 0 1rem', fontSize: '0.88rem', color: '#475569' }}>
                Nuestro equipo recibió tu aviso con la pantalla actual y los detalles técnicos.
              </p>
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '1.25rem' }}>
                Referencia: <code style={{ fontWeight: 700, color: '#0f172a' }}>{sentReportId}</code>
              </div>
              <button
                type="button"
                onClick={handleClose}
                style={{
                  background: '#0f172a',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.6rem 1.4rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Entendido
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#334155', marginBottom: '0.35rem' }}>
                  Tipo de situación
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.75rem',
                    borderRadius: '10px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.9rem',
                    background: '#fff',
                  }}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#334155', marginBottom: '0.35rem' }}>
                  ¿Qué estabas intentando hacer y qué ocurrió?
                </label>
                <textarea
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ej: Intenté guardar una factura y el total no coincidió..."
                  maxLength={1500}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.75rem',
                    borderRadius: '10px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.9rem',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              <p style={{ margin: 0, fontSize: '0.76rem', color: '#64748b' }}>
                Se adjuntará automáticamente tu pantalla actual (<code>{window.location.pathname}</code>) y los últimos errores técnicos de la sesión.
              </p>

              {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fef2f2', color: '#b91c1c', padding: '0.55rem 0.75rem', borderRadius: '8px', fontSize: '0.82rem' }}>
                  <AlertTriangle size={15} />
                  <span>{error}</span>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.25rem' }}>
                <button
                  type="button"
                  onClick={handleClose}
                  style={{
                    background: '#f1f5f9',
                    color: '#334155',
                    border: '1px solid #cbd5e1',
                    borderRadius: '10px',
                    padding: '0.55rem 1rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    background: '#2563eb',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '0.55rem 1.15rem',
                    fontWeight: 600,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    opacity: submitting ? 0.7 : 1,
                  }}
                >
                  <Send size={15} />
                  <span>{submitting ? 'Enviando...' : 'Enviar reporte'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
