import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = String(searchParams.get('token') || '').trim();

  const [validating, setValidating] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [tokenError, setTokenError] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [success, setSuccess] = useState(false);

  // Enforce Referrer-Policy: no-referrer without third-party assets or localStorage token storage
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.appendChild(meta);
    return () => {
      if (meta.parentNode) meta.parentNode.removeChild(meta);
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!token) {
      setValidating(false);
      setTokenValid(false);
      setTokenError('El enlace de recuperación es inválido o está incompleto.');
      return () => { active = false; };
    }

    fetch(`/api/auth/reset-password/validate?token=${encodeURIComponent(token)}`, {
      method: 'GET',
      referrerPolicy: 'no-referrer',
    })
      .then(async (res) => {
        const raw = await res.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
        if (!res.ok || !data.valid) {
          throw new Error(data.error || 'El enlace de recuperación es inválido o ha expirado.');
        }
        if (active) {
          setTokenValid(true);
        }
      })
      .catch((err) => {
        if (active) {
          setTokenValid(false);
          setTokenError(err.message || 'El enlace de recuperación es inválido o ha expirado.');
        }
      })
      .finally(() => {
        if (active) setValidating(false);
      });

    return () => { active = false; };
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError('');

    if (newPassword.length < 4) {
      setSubmitError('La nueva contraseña debe tener al menos 4 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setSubmitError('Las contraseñas no coinciden.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        referrerPolicy: 'no-referrer',
        body: JSON.stringify({ token, newPassword }),
      });
      const raw = await res.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
      if (!res.ok) {
        throw new Error(data.error || `No se pudo restablecer la contraseña (HTTP ${res.status}).`);
      }
      setSuccess(true);
    } catch (err) {
      setSubmitError(err.message || 'No se pudo restablecer la contraseña.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f1f5f9',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    }}>
      <div style={{
        width: '100%',
        maxWidth: '460px',
        backgroundColor: '#ffffff',
        borderRadius: '16px',
        border: '1px solid #e2e8f0',
        padding: '32px',
        boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <img
            src="/icon-192x192.png"
            alt="Etereas"
            width="48"
            height="48"
            style={{ borderRadius: '10px', marginBottom: '12px' }}
          />
          <h1 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>
            Restablece tu contraseña
          </h1>
        </div>

        {validating ? (
          <p style={{ textAlign: 'center', color: '#64748b', fontSize: '0.95rem' }}>
            Verificando enlace de recuperación...
          </p>
        ) : success ? (
          <div>
            <div role="status" style={{
              padding: '14px 16px',
              borderRadius: '10px',
              backgroundColor: '#ecfdf5',
              border: '1px solid #a7f3d0',
              color: '#065f46',
              fontSize: '0.92rem',
              lineHeight: 1.5,
              marginBottom: '20px',
            }}>
              Tu contraseña ha sido actualizada y tus sesiones anteriores fueron cerradas por seguridad.
            </div>
            <Link
              to="/login"
              style={{
                display: 'block',
                textAlign: 'center',
                padding: '12px 18px',
                borderRadius: '10px',
                backgroundColor: '#2563eb',
                color: '#ffffff',
                fontWeight: 700,
                textDecoration: 'none',
              }}
            >
              Iniciar sesión
            </Link>
          </div>
        ) : !tokenValid ? (
          <div>
            <div role="alert" style={{
              padding: '14px 16px',
              borderRadius: '10px',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#b91c1c',
              fontSize: '0.92rem',
              marginBottom: '20px',
            }}>
              {tokenError}
            </div>
            <Link
              to="/"
              style={{
                display: 'block',
                textAlign: 'center',
                padding: '12px 18px',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                color: '#0f172a',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Volver al inicio
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {submitError && (
              <div role="alert" style={{
                padding: '12px 14px',
                borderRadius: '10px',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                fontSize: '0.88rem',
                fontWeight: 600,
                marginBottom: '16px',
              }}>
                {submitError}
              </div>
            )}

            <div style={{ marginBottom: '16px' }}>
              <label htmlFor="rp-new-pass" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                Nueva contraseña
              </label>
              <input
                id="rp-new-pass"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={4}
                autoComplete="new-password"
                style={{ width: '100%', padding: '11px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.95rem', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label htmlFor="rp-confirm-pass" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                Confirmar contraseña
              </label>
              <input
                id="rp-confirm-pass"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={4}
                autoComplete="new-password"
                style={{ width: '100%', padding: '11px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.95rem', boxSizing: 'border-box' }}
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              style={{
                width: '100%',
                padding: '12px 18px',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: '#2563eb',
                color: '#ffffff',
                fontSize: '0.95rem',
                fontWeight: 700,
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? 'Guardando...' : 'Guardar nueva contraseña'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
