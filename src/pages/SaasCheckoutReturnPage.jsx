import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, Clock, AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';
import { formatOrderMoney } from '../components/saas/SaasCheckoutPanel';

export default function SaasCheckoutReturnPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const orderId = searchParams.get('orderId') || '';
  const cancelled = searchParams.get('cancelled') === '1';

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const verifyOrder = useCallback(async () => {
    if (!orderId) {
      setError('No se recibió el identificador de la orden.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/saas/billing/checkout/orders/${encodeURIComponent(orderId)}/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo verificar el resultado del pago con CardNet.');
      }
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [orderId, cancelled]);

  useEffect(() => {
    verifyOrder();
  }, [verifyOrder]);

  const order = result?.order;

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 520, width: '100%', background: '#ffffff', borderRadius: 16, border: '1px solid #e2e8f0', padding: 28, boxShadow: '0 8px 30px rgba(15, 23, 42, 0.06)' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <Clock size={36} color="#2563eb" style={{ margin: '0 auto 12px' }} />
            <h2 style={{ fontSize: 20, margin: '0 0 8px', color: '#0f172a' }}>Verificando pago con CardNet...</h2>
            <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>
              Estamos confirmando el estado real de tu transacción antes de activar tu suscripción.
            </p>
          </div>
        ) : error ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#b91c1c', marginBottom: 12 }}>
              <AlertTriangle size={24} />
              <h2 style={{ fontSize: 18, margin: 0 }}>No se pudo confirmar el pago</h2>
            </div>
            <p style={{ color: '#475569', fontSize: 14 }}>{error}</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button type="button" className="sb-btn-primary" onClick={verifyOrder}>
                <RefreshCw size={15} /> Reintentar verificación
              </button>
              <button type="button" className="sb-btn-secondary" onClick={() => navigate('/mi-suscripcion')}>
                <ArrowLeft size={15} /> Ir a Mi Suscripción
              </button>
            </div>
          </div>
        ) : order?.status === 'approved' && result?.activated ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#15803d', marginBottom: 12 }}>
              <CheckCircle2 size={28} />
              <h2 style={{ fontSize: 20, margin: 0 }}>Pago aprobado y suscripción activa</h2>
            </div>
            <p style={{ color: '#475569', fontSize: 14 }}>
              Tu pago ha sido verificado directamente con CardNet y tu plan ya está activo.
            </p>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginTop: 14, fontSize: 13 }}>
              <div><strong>Comprobante / Orden:</strong> #{order.order_number}</div>
              <div><strong>Importe pagado:</strong> {formatOrderMoney(order.total_minor, order.currency)} ({order.currency})</div>
              <div><strong>Autorización CardNet:</strong> {order.cardnet_authorization_code || 'Confirmada'}</div>
              {order.masked_card && <div><strong>Tarjeta:</strong> {order.masked_card}</div>}
            </div>
            <button type="button" className="sb-btn-primary" style={{ marginTop: 20, width: '100%' }} onClick={() => navigate('/mi-suscripcion')}>
              Ir a Mi Suscripción
            </button>
          </div>
        ) : order?.status === 'approved' && !result?.activated ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#b45309', marginBottom: 12 }}>
              <Clock size={26} />
              <h2 style={{ fontSize: 19, margin: 0 }}>Pago aprobado — activación pendiente de conciliar</h2>
            </div>
            <p style={{ color: '#475569', fontSize: 14 }}>
              Tu pago en CardNet fue aprobado, pero ocurrió un error temporal actualizando el plan. No se realizará ningún cobro adicional al conciliar.
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button type="button" className="sb-btn-primary" onClick={verifyOrder}>
                <RefreshCw size={15} /> Completar activación
              </button>
              <button type="button" className="sb-btn-secondary" onClick={() => navigate('/mi-suscripcion')}>
                Ir a Mi Suscripción
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: order?.status === 'unknown_timeout' ? '#b45309' : '#b91c1c', marginBottom: 12 }}>
              {order?.status === 'unknown_timeout' ? <Clock size={26} /> : <XCircle size={26} />}
              <h2 style={{ fontSize: 19, margin: 0 }}>
                {order?.status === 'cancelled'
                  ? 'Checkout cancelado'
                  : order?.status === 'expired'
                    ? 'Sesión de pago expirada'
                    : order?.status === 'unknown_timeout'
                      ? 'Resultado pendiente de conciliación'
                      : 'Pago no aprobado'}
              </h2>
            </div>
            <p style={{ color: '#475569', fontSize: 14 }}>
              {order?.cardnet_response_message || order?.last_error || 'La suscripción no fue activada.'}
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              {order?.status === 'unknown_timeout' && (
                <button type="button" className="sb-btn-primary" onClick={verifyOrder}>
                  <RefreshCw size={15} /> Conciliar con CardNet
                </button>
              )}
              <button type="button" className="sb-btn-secondary" onClick={() => navigate('/mi-suscripcion')}>
                <ArrowLeft size={15} /> Volver a Mi Suscripción
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
