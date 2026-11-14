import React, { useState } from 'react';
import { Sparkles, Check, ArrowRight, AlertCircle, Loader2, X } from 'lucide-react';
import './SaasBillingModule.css';

export default function SaasUpgradeModal({
  isOpen,
  onClose,
  currentPlan = 'BASE',
  onConfirmUpgrade,
  currency = 'DOP',
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    try {
      setLoading(true);
      setError(null);
      await onConfirmUpgrade();
      onClose();
    } catch (err) {
      setError(err.message || 'Error al procesar el cambio de plan');
    } finally {
      setLoading(false);
    }
  };

  const isProTarget = String(currentPlan).toUpperCase() === 'BASE';
  const proMonthly = currency === 'USD' ? 'US$99' : 'RD$5,900.00';
  const baseMonthly = currency === 'USD' ? 'US$49' : 'RD$2,900.00';

  return (
    <div
      className="sb-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sb-upgrade-modal-title"
    >
      <div className="sb-modal-card">
        <div className="sb-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="sb-icon-box" aria-hidden="true">
              <Sparkles size={16} />
            </span>
            <div>
              <h3 id="sb-upgrade-modal-title">
                {isProTarget ? 'Cambiar a Plan PRO' : 'Cambiar a Plan Base'}
              </h3>
              <p className="sb-meta-text" style={{ margin: 0 }}>
                {isProTarget
                  ? 'Desbloquea membresías, contratos, marketing y multi-sucursal.'
                  : 'El cambio a Plan Base se programará para el final del período actual.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="sb-modal-close"
            onClick={onClose}
            disabled={loading}
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="sb-alert sb-alert-error" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <div className="sb-kv-list" style={{ marginBottom: '16px' }}>
          <div className="sb-kv-row">
            <span className="sb-kv-label">Plan seleccionado</span>
            <span className="sb-kv-value">{isProTarget ? 'Plan PRO' : 'Plan Base'}</span>
          </div>
          <div className="sb-kv-row">
            <span className="sb-kv-label">Tarifa mensual</span>
            <span className="sb-kv-value">
              {isProTarget ? `${proMonthly} / mes` : `${baseMonthly} / mes`}
            </span>
          </div>
        </div>

        {isProTarget ? (
          <div className="sb-empty-box" style={{ textAlign: 'left', marginBottom: '16px' }}>
            <div style={{ fontWeight: 600, marginBottom: '8px', color: '#0f172a' }}>
              Incluye todo lo del Plan Base (POS, Clientes/CRM, caja y nómina) más:
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '6px' }}>
              <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Check size={14} color="#059669" />
                <span>Módulo de membresías, contratos y cobros recurrentes</span>
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Check size={14} color="#059669" />
                <span>Automatizaciones de marketing</span>
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Check size={14} color="#059669" />
                <span>Capacidad ampliada de sucursales y usuarios</span>
              </li>
            </ul>
          </div>
        ) : (
          <div className="sb-empty-box" style={{ textAlign: 'left', marginBottom: '16px' }}>
            <div style={{ fontWeight: 600, marginBottom: '6px', color: '#0f172a' }}>
              Requisitos para cambiar a Plan Base:
            </div>
            <div>• Máximo 1 sucursal activa</div>
            <div>• Máximo 3 usuarios colaboradores</div>
            <div style={{ marginTop: '6px' }}>
              Mantiene POS, Clientes/CRM, facturación y nómina; los módulos exclusivos de PRO se desactivan al finalizar el ciclo actual.
            </div>
          </div>
        )}

        <div className="sb-modal-footer">
          <button
            type="button"
            className="sb-btn"
            onClick={onClose}
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="sb-btn sb-btn-primary"
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 size={15} className="sb-spin" />
                <span>Procesando...</span>
              </>
            ) : (
              <>
                <span>{isProTarget ? 'Confirmar cambio a PRO' : 'Confirmar cambio a Base'}</span>
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
