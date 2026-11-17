import React, { useEffect, useState, useCallback } from 'react';
import { Tablet, ShieldAlert, RefreshCw, Save } from 'lucide-react';

export default function KioskDevicesPanel() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [biometricMode, setBiometricMode] = useState('pin_photo');
  const [faceThreshold, setFaceThreshold] = useState(0.75);
  const [comprefaceConfigured, setComprefaceConfigured] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [devRes, setRes] = await Promise.all([
        fetch('/api/kiosk/devices', { credentials: 'include' }),
        fetch('/api/kiosk/settings', { credentials: 'include' }),
      ]);
      const devData = devRes.ok ? await devRes.json() : { devices: [] };
      const setData = setRes.ok ? await setRes.json() : {};
      setDevices(Array.isArray(devData?.devices) ? devData.devices : []);
      if (setData?.kiosk_biometric_mode) setBiometricMode(setData.kiosk_biometric_mode);
      if (setData?.kiosk_face_match_threshold) setFaceThreshold(Number(setData.kiosk_face_match_threshold));
      setComprefaceConfigured(Boolean(setData?.compreface_configured));
    } catch {
      setError('Error cargando dispositivos y configuración de kiosco.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleRevoke = async (deviceId, deviceName) => {
    if (!window.confirm(`¿Revocar el acceso del dispositivo "${deviceName}"? Tendrá que volver a vincularse.`)) return;
    setError('');
    setMessage('');
    try {
      const res = await fetch(`/api/kiosk/devices/${deviceId}/revoke`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Revocado por administración' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo revocar.');
      setMessage('Dispositivo revocado correctamente.');
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSavingSettings(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/kiosk/settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kiosk_biometric_mode: biometricMode,
          kiosk_face_match_threshold: Number(faceThreshold),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || 'Error guardando configuración.');
      setMessage('Política biométrica del kiosco actualizada.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {message && (
        <div style={{ padding: '0.75rem 1rem', borderRadius: '10px', background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', fontWeight: 600, fontSize: '0.85rem' }}>
          {message}
        </div>
      )}
      {error && (
        <div style={{ padding: '0.75rem 1rem', borderRadius: '10px', background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', fontWeight: 600, fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {/* Política Biométrica */}
      <form onSubmit={handleSaveSettings} style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem' }}>
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
          Política de Verificación en Kiosco
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', alignItems: 'end' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
              Modo de Verificación
            </label>
            <select
              value={biometricMode}
              onChange={(e) => setBiometricMode(e.target.value)}
              style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 600 }}
            >
              <option value="pin_photo">PIN / Contraseña + Fotografía de evidencia</option>
              <option value="pin_face_verify">PIN / Contraseña + Verificación Facial (CompreFace)</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
              Umbral de Similitud Facial (0.40 - 0.99)
            </label>
            <input
              type="number"
              min="0.40"
              max="0.99"
              step="0.01"
              value={faceThreshold}
              onChange={(e) => setFaceThreshold(e.target.value)}
              style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 600 }}
            />
          </div>
          <div>
            <button
              type="submit"
              disabled={savingSettings}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.6rem 1.1rem', borderRadius: '8px', border: 'none', background: '#0ea5e9', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
            >
              <Save size={16} /> {savingSettings ? 'Guardando...' : 'Guardar política'}
            </button>
          </div>
        </div>
        <div style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: comprefaceConfigured ? '#059669' : '#b45309', fontWeight: 600 }}>
          {comprefaceConfigured
            ? 'Estado CompreFace: Conectado y configurado en servidor.'
            : 'Estado CompreFace: No configurado en el servidor. Si activas "Verificación Facial", los ponches serán rechazados hasta configurar CompreFace (no se degrada silenciosamente).'}
        </div>
      </form>

      {/* Lista de Dispositivos */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Tablet size={18} /> Dispositivos Kiosco Vinculados
          </h3>
          <button
            type="button"
            onClick={loadAll}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.45rem 0.85rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}
          >
            <RefreshCw size={14} /> Actualizar
          </button>
        </div>

        {loading ? (
          <p style={{ color: '#64748b', fontSize: '0.85rem' }}>Cargando dispositivos...</p>
        ) : devices.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: '0.85rem' }}>
            No hay dispositivos vinculados aún. Abre la vista de Kiosco en la tableta o equipo de recepción para vincularlo.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                  <th style={{ padding: '0.6rem' }}>Dispositivo</th>
                  <th style={{ padding: '0.6rem' }}>Sucursal</th>
                  <th style={{ padding: '0.6rem' }}>Vinculado por</th>
                  <th style={{ padding: '0.6rem' }}>Última actividad</th>
                  <th style={{ padding: '0.6rem' }}>Estado</th>
                  <th style={{ padding: '0.6rem', textAlign: 'right' }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.6rem', fontWeight: 700 }}>{d.device_name}</td>
                    <td style={{ padding: '0.6rem' }}>{d.branch_name || d.branch_id}</td>
                    <td style={{ padding: '0.6rem' }}>{d.bound_by_name || 'Administrador'}</td>
                    <td style={{ padding: '0.6rem' }}>{d.last_seen_at ? new Date(d.last_seen_at).toLocaleString('es-DO') : '-'}</td>
                    <td style={{ padding: '0.6rem' }}>
                      <span style={{
                        padding: '0.2rem 0.55rem',
                        borderRadius: '999px',
                        fontWeight: 700,
                        fontSize: '0.72rem',
                        background: d.status === 'active' ? '#dcfce7' : '#fee2e2',
                        color: d.status === 'active' ? '#166534' : '#991b1b',
                      }}>
                        {d.status === 'active' ? 'Activo' : 'Revocado'}
                      </span>
                    </td>
                    <td style={{ padding: '0.6rem', textAlign: 'right' }}>
                      {d.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => handleRevoke(d.id, d.device_name)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.35rem 0.7rem', borderRadius: '8px', border: '1px solid #fca5a5', background: '#fef2f2', color: '#b91c1c', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}
                        >
                          <ShieldAlert size={13} /> Revocar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
