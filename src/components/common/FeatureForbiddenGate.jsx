import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, Sparkles, ArrowLeft, ArrowUpRight } from 'lucide-react';
import './FeatureForbiddenGate.css';

export default function FeatureForbiddenGate({
  featureName = 'Esta funcionalidad'
}) {
  const navigate = useNavigate();

  return (
    <div
      role="alert"
      aria-live="polite"
      className="ffg-wrapper"
    >
      <div className="ffg-card">
        {/* Icon & Badge */}
        <div className="ffg-header">
          <div className="ffg-icon-box">
            <ShieldAlert className="ffg-icon-lg" aria-hidden="true" />
          </div>
          <span className="ffg-badge">
            <Sparkles className="ffg-icon-xs" aria-hidden="true" />
            Add-on Requerido
          </span>
        </div>

        {/* Text Details */}
        <div className="ffg-body">
          <h1 className="ffg-title">
            Acceso Restringido (403)
          </h1>
          <p className="ffg-description">
            {featureName} requiere el add-on de Suscripciones y Membresías B2C. Puedes solicitar su activación desde Mi suscripción sin afectar tu operación ni tus registros de clientes.
          </p>
        </div>

        {/* Benefits Pill */}
        <div className="ffg-benefits">
          <div className="ffg-benefits-title">
            <Sparkles className="ffg-icon-sm" aria-hidden="true" />
            <span>Incluye el add-on Suscripciones y Membresías B2C:</span>
          </div>
          <ul className="ffg-benefits-list">
            <li>Planes de membresía B2C y control de beneficios por ciclo</li>
            <li>Contratos digitales firmados por tus clientas</li>
            <li>Seguimiento de cobros recurrentes de membresías</li>
          </ul>
        </div>

        {/* Actions */}
        <div className="ffg-actions">
          <button
            type="button"
            onClick={() => navigate('/facturacion-saas')}
            className="ffg-btn ffg-btn-primary"
          >
            <span>Ir a Mi suscripción</span>
            <ArrowUpRight className="ffg-icon-sm" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="ffg-btn ffg-btn-secondary"
          >
            <ArrowLeft className="ffg-icon-sm" aria-hidden="true" />
            <span>Volver al Inicio</span>
          </button>
        </div>
      </div>
    </div>
  );
}

