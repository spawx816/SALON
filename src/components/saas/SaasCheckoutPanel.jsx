import React, { useState } from 'react';
import {
  CreditCard,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
  ShieldCheck,
  ExternalLink,
  XCircle,
} from 'lucide-react';
import { loadCardNetScript } from '../../utils/cardnetScriptLoader';

const ORDER_STATUS_META = {
  pending_payment: { label: 'Pendiente de pago', badge: 'sb-badge-warning' },
  processing: { label: 'En procesamiento', badge: 'sb-badge-warning' },
  approved: { label: 'Pago aprobado', badge: 'sb-badge-active' },
  declined: { label: 'Pago rechazado', badge: 'sb-badge-danger' },
  cancelled: { label: 'Checkout cancelado', badge: 'sb-badge-neutral' },
  expired: { label: 'Sesión expirada', badge: 'sb-badge-neutral' },
  unknown_timeout: { label: 'Pendiente de conciliación', badge: 'sb-badge-warning' },
};

export function formatOrderMoney(minorStr, currency = 'USD') {
  const numeric = Number(minorStr || 0) / 100;
  const code = String(currency || 'USD').toUpperCase();
  if (code === 'USD') {
    return `US$${numeric.toLocaleString('en-US', {
      minimumFractionDigits: numeric % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `RD$${numeric.toLocaleString('es-DO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Envía el navegador al entorno seguro alojado de CardNet mediante POST (Integración con Pantalla).
 * Nunca captura PAN ni CVC en Etereas.
 */
export function submitCardnetHostedPost({ authorizeUrl, sessionId }) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = authorizeUrl;
  form.style.display = 'none';

  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'SESSION';
  input.value = sessionId;
  form.appendChild(input);

  document.body.appendChild(form);
  form.submit();
}

/**
 * Ejecuta el checkout seguro de CardNet (PWCheckout iframe o Hosted POST) sin capturar PAN/CVC en Etereas.
 */
export async function executeCardnetCheckout({ orderId, checkout, onActivated, onError }) {
  if (checkout?.mode === 'pwcheckout_iframe' && checkout?.uniqueId && checkout?.captureUrl && checkout?.publicKey) {
    const PWCheckout = await loadCardNetScript(checkout.publicKey, checkout.captureUrl);
    let handled = false;

    PWCheckout.Bind('tokenCreated', async (tokenPayload) => {
      if (handled) return;
      handled = true;
      const trxToken =
        tokenPayload?.TokenId ||
        tokenPayload?.Token ||
        tokenPayload?.trxToken ||
        (typeof tokenPayload === 'string' ? tokenPayload : null);

      if (!trxToken) {
        if (onError) onError('CardNet no devolvió un token de transacción válido.');
        return;
      }

      try {
        const res = await fetch(`/api/saas/billing/checkout/orders/${encodeURIComponent(orderId)}/charge-token`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trxToken }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || 'No se pudo procesar el cobro con CardNet.');
        }
        if (data.activated) {
          try {
            const rawUser = localStorage.getItem('salon_pro_user');
            if (rawUser) {
              const parsed = JSON.parse(rawUser);
              if (parsed?.tenant) {
                parsed.tenant.status = 'active';
                localStorage.setItem('salon_pro_user', JSON.stringify(parsed));
              }
            }
          } catch {
            // ignore storage errors
          }
          if (onActivated) await onActivated(data);
          return;
        }
        if (data.declined) {
          throw new Error(data.message || 'Pago rechazado por CardNet.');
        }
        throw new Error('No se pudo confirmar la activación del pago.');
      } catch (err) {
        if (onError) onError(err.message);
      }
    });

    const cleanCaptureUrl = checkout.captureUrl.endsWith('/') ? checkout.captureUrl : `${checkout.captureUrl}/`;
    PWCheckout.OpenIframeCustom(
      `${cleanCaptureUrl}?key=${encodeURIComponent(checkout.publicKey)}&session_id=${encodeURIComponent(checkout.uniqueId)}`,
      checkout.uniqueId
    );
    return;
  }

  if (checkout?.authorizeUrl && checkout?.sessionId) {
    submitCardnetHostedPost(checkout);
    return;
  }

  throw new Error('Respuesta incompleta de CardNet al iniciar sesión.');
}

export default function SaasCheckoutPanel({
  orders = [],
  gatewayStatus = null,
  onOrderUpdated,
  initiateEndpointBuilder,
  verifyEndpointBuilder,
}) {
  const [busyOrderId, setBusyOrderId] = useState(null);
  const [panelError, setPanelError] = useState(null);
  const [missingReqs, setMissingReqs] = useState([]);

  const handlePayWithCardnet = async (order) => {
    setBusyOrderId(order.id);
    setPanelError(null);
    setMissingReqs([]);
    try {
      const url = initiateEndpointBuilder
        ? initiateEndpointBuilder(order)
        : `/api/saas/billing/checkout/orders/${order.id}/initiate-cardnet`;
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.requirements?.missingCredentials?.length) {
          setMissingReqs(data.requirements.missingCredentials);
        }
        throw new Error(data.error || 'No se pudo iniciar el checkout con CardNet.');
      }
      await executeCardnetCheckout({
        orderId: order.id,
        checkout: data.checkout,
        onActivated: async (activatedData) => {
          if (onOrderUpdated) {
            await onOrderUpdated(activatedData);
          }
          window.location.href = '/dashboard';
        },
        onError: (msg) => setPanelError(msg),
      });
    } catch (err) {
      setPanelError(err.message);
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleReconcile = async (order) => {
    setBusyOrderId(order.id);
    setPanelError(null);
    try {
      const url = verifyEndpointBuilder
        ? verifyEndpointBuilder(order)
        : `/api/saas/billing/checkout/orders/${order.id}/verify`;
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo verificar el estado de la orden.');
      }
      if (onOrderUpdated) {
        await onOrderUpdated(data);
      }
    } catch (err) {
      setPanelError(err.message);
    } finally {
      setBusyOrderId(null);
    }
  };

  return (
    <div className="sb-card" style={{ marginTop: 16 }}>
      <div className="sb-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 className="sb-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldCheck size={18} color="#2563eb" />
            Checkout seguro con CardNet
          </h3>
          <p className="sb-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
            Pago alojado en CardNet (3D Secure). Etereas no captura ni almacena los datos de tu tarjeta.
          </p>
        </div>
        {gatewayStatus && (
          <span className={`sb-badge ${gatewayStatus.configured ? 'sb-badge-active' : 'sb-badge-warning'}`}>
            {gatewayStatus.configured
              ? `CardNet ${gatewayStatus.environment === 'production' ? 'Producción' : 'Sandbox'} listo`
              : 'Pendiente de credenciales CardNet'}
          </span>
        )}
      </div>

      {panelError && (
        <div className="sb-alert sb-alert-danger" style={{ margin: '12px 0' }}>
          <AlertTriangle size={16} />
          <div>
            <div>{panelError}</div>
            {missingReqs.length > 0 && (
              <div style={{ fontSize: 12, marginTop: 4 }}>
                Variables requeridas: {missingReqs.join(', ')}
              </div>
            )}
          </div>
        </div>
      )}

      {orders.length === 0 ? (
        <p className="sb-muted" style={{ marginTop: 12, fontSize: 13 }}>
          No hay órdenes de checkout registradas para esta cuenta.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          {orders.map((order) => {
            const meta = ORDER_STATUS_META[order.status] || { label: order.status, badge: 'sb-badge-neutral' };
            const isPayable = ['pending_payment', 'processing', 'unknown_timeout'].includes(order.status);
            const canReconcile =
              ['processing', 'unknown_timeout'].includes(order.status) ||
              (order.status === 'approved' && !order.activated_at);
            const isBusy = busyOrderId === order.id;

            return (
              <div
                key={order.id}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: 14,
                  background: '#f8fafc',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ minWidth: 240 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong>Orden #{order.order_number}</strong>
                    <span className={`sb-badge ${meta.badge}`}>{meta.label}</span>
                    {order.status === 'approved' && !order.activated_at && (
                      <span className="sb-badge sb-badge-warning">Pendiente de activar</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: '#475569', marginTop: 6 }}>
                    Plan Principal ({order.branches_count} sucursal{order.branches_count === 1 ? '' : 'es'})
                    {order.extra_users_count > 0 ? ` · ${order.extra_users_count} usuario(s) extra` : ''}
                    {order.memberships_addon_enabled ? ` · Add-on Membresías (${order.addon_branches_count} suc.)` : ''}
                    {` · Mensual`}
                  </div>
                  <div style={{ fontSize: 13, color: '#0f172a', marginTop: 4, fontWeight: 600 }}>
                    Total: {formatOrderMoney(order.total_minor, order.currency)} ({order.currency})
                    {Number(order.tax_minor || 0) > 0
                      ? ` · Impuestos: ${formatOrderMoney(order.tax_minor, order.currency)}`
                      : ' · Impuestos: US$0'}
                  </div>
                  {order.status === 'approved' && (
                    <div style={{ fontSize: 12, color: '#15803d', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <CheckCircle2 size={14} />
                      <span>
                        Autorización: {order.cardnet_authorization_code || 'Verificada'}
                        {order.masked_card ? ` · Tarjeta ${order.masked_card}` : ''}
                      </span>
                    </div>
                  )}
                  {['declined', 'cancelled', 'expired'].includes(order.status) && order.cardnet_response_message && (
                    <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <XCircle size={14} />
                      <span>{order.cardnet_response_message}</span>
                    </div>
                  )}
                  {order.last_error && order.status !== 'approved' && (
                    <div style={{ fontSize: 12, color: '#b45309', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Clock size={14} />
                      <span>{order.last_error}</span>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {isPayable && (
                    <button
                      type="button"
                      className="sb-btn-primary"
                      disabled={isBusy}
                      onClick={() => handlePayWithCardnet(order)}
                    >
                      <CreditCard size={15} />
                      {isBusy
                        ? 'Conectando...'
                        : order.status === 'processing'
                          ? 'Retomar pago CardNet'
                          : 'Pagar con CardNet'}
                      <ExternalLink size={13} />
                    </button>
                  )}
                  {canReconcile && (
                    <button
                      type="button"
                      className="sb-btn-secondary"
                      disabled={isBusy}
                      onClick={() => handleReconcile(order)}
                    >
                      <RefreshCw size={14} />
                      {order.status === 'approved' ? 'Completar activación' : 'Conciliar estado'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
