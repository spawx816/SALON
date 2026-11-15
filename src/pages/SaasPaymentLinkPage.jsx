import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ShieldCheck, AlertTriangle, ArrowLeft, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import SaasCheckoutPanel from '../components/saas/SaasCheckoutPanel';

export default function SaasPaymentLinkPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [order, setOrder] = useState(null);
  const [gateway, setGateway] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadPaymentLink = useCallback(async () => {
    if (!user || !token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/saas/billing/payment-links/${encodeURIComponent(token)}`, {
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo cargar el enlace de pago.');
      }
      setOrder(data.order || null);
      setGateway(data.gateway || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, token]);

  useEffect(() => {
    loadPaymentLink();
  }, [loadPaymentLink]);

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '40px 16px' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, margin: 0, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldCheck size={22} color="#2563eb" />
            Pago de suscripción Etereas
          </h1>
          <button type="button" className="sb-btn-secondary" onClick={() => navigate(user ? '/mi-suscripcion' : '/login')}>
            <ArrowLeft size={14} /> {user ? 'Mi Suscripción' : 'Iniciar sesión'}
          </button>
        </div>

        {!user ? (
          <div className="sb-card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#0f172a', marginBottom: 8 }}>
              <Lock size={20} color="#2563eb" />
              <h2 style={{ fontSize: 18, margin: 0 }}>Inicia sesión para completar el pago</h2>
            </div>
            <p style={{ color: '#475569', fontSize: 14, marginBottom: 16 }}>
              Por seguridad, este enlace de pago está vinculado a tu empresa. Inicia sesión con tu cuenta de propietario para revisar el resumen y pagar de forma segura en CardNet.
            </p>
            <button
              type="button"
              className="sb-btn-primary"
              onClick={() => navigate(`/login?redirect=${encodeURIComponent(`/pago-saas/${token}`)}`)}
            >
              Iniciar sesión para pagar
            </button>
          </div>
        ) : loading ? (
          <div className="sb-card" style={{ padding: 24 }}>
            Cargando detalles de la orden de pago...
          </div>
        ) : error ? (
          <div className="sb-card" style={{ padding: 24 }}>
            <div className="sb-alert sb-alert-danger">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          </div>
        ) : order ? (
          <SaasCheckoutPanel
            orders={[order]}
            gatewayStatus={gateway}
            onOrderUpdated={loadPaymentLink}
            initiateEndpointBuilder={() => `/api/saas/billing/payment-links/${encodeURIComponent(token)}/initiate-cardnet`}
            verifyEndpointBuilder={(o) => `/api/saas/billing/checkout/orders/${encodeURIComponent(o.id)}/verify`}
          />
        ) : null}
      </div>
    </div>
  );
}
