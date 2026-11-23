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
 * Implementa transición limpia: Resumen -> Checkout CardNet (capa única) -> Verificación -> Resultado.
 */
function ensureCardnetHiddenForm(formId = 'etereas_saas_checkout_form') {
  let form = document.forms?.[formId] || document.getElementById(formId);
  if (!form) {
    form = document.createElement('form');
    form.id = formId;
    form.name = formId;
    form.style.display = 'none';
    form.setAttribute('aria-hidden', 'true');
    document.body.appendChild(form);
  }
  // Limpiar inputs ocultos previos (PWToken/PWBin) para evitar residuos entre intentos
  form.innerHTML = '';
  return form;
}

function patchCardnetIframeClose(PWCheckout) {
  if (!PWCheckout?.Iframe?.Close || PWCheckout.Iframe.__etereasClosePatched) return;
  const originalClose = PWCheckout.Iframe.Close;
  PWCheckout.Iframe.Close = function safeClose() {
    const frame = document.getElementById(PWCheckout.Iframe.frameId);
    const modal = document.getElementById(PWCheckout.Iframe.modalId);
    if (!frame && !modal) {
      return;
    }
    if (!frame || !modal) {
      if (frame?.parentNode) frame.parentNode.removeChild(frame);
      if (modal?.parentNode) modal.parentNode.removeChild(modal);
      if (typeof PWCheckout.Iframe.Closed === 'function') {
        PWCheckout.Iframe.Closed();
      }
      return;
    }
    return originalClose.apply(this, arguments);
  };
  PWCheckout.Iframe.__etereasClosePatched = true;
}

export async function executeCardnetCheckout({
  orderId,
  order = null,
  customerEmail = '',
  checkout,
  onCheckoutOpening,
  onVerifying,
  onCheckoutClosed,
  onActivated,
  onError,
}) {
  if (checkout?.mode === 'pwcheckout_iframe' && checkout?.uniqueId && checkout?.captureUrl && checkout?.publicKey) {
    const PWCheckout = await loadCardNetScript(checkout.publicKey, checkout.captureUrl);
    const formId = 'etereas_saas_checkout_form';
    ensureCardnetHiddenForm(formId);
    patchCardnetIframeClose(PWCheckout);

    if (typeof PWCheckout.Unbind === 'function') {
      try {
        PWCheckout.Unbind('tokenCreated');
        PWCheckout.Unbind('closed');
        PWCheckout.Unbind('opened');
      } catch {
        // ignore if event was not bound yet
      }
    }

    let handled = false;
    let isVerifying = false;

    PWCheckout.Bind('tokenCreated', async (tokenPayload) => {
      if (handled) return;
      handled = true;
      isVerifying = true;
      if (onVerifying) onVerifying('Tarjeta registrada en CardNet. Procesando cobro...');

      const trxToken =
        tokenPayload?.TokenId ||
        tokenPayload?.Token ||
        tokenPayload?.trxToken ||
        (typeof tokenPayload === 'string' ? tokenPayload : null);

      if (!trxToken) {
        isVerifying = false;
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

    PWCheckout.Bind('closed', () => {
      if (!isVerifying && onCheckoutClosed) {
        onCheckoutClosed();
      }
    });

    if (typeof PWCheckout.SetProperties === 'function') {
      PWCheckout.SetProperties({
        name: 'Etereas',
        email: customerEmail || '',
        button_label: order?.total_minor
          ? `Pagar ${formatOrderMoney(order.metadata?.fx_snapshot?.usd?.total_minor ?? order.total_minor, order.metadata?.fx_snapshot?.usd ? 'USD' : (order.currency || 'USD'))}`
          : 'Confirmar pago',
        description: order?.order_number ? `Orden #${order.order_number}` : 'Suscripción Etereas',
        currency: order?.currency || 'DOP',
        amount: String(order?.total_minor || '0'),
        lang: 'ESP',
        form_id: 'etereas_saas_checkout_form',
        checkout_card: '1',
        session_id: checkout.uniqueId,
        autoSubmit: 'false',
      });
    }

    // Cerrar/desmontar cualquier modal previo antes de abrir CardNet para evitar superposición
    if (onCheckoutOpening) {
      onCheckoutOpening();
    }

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
  invoices = [],
  gatewayStatus = null,
  onOrderUpdated,
  onViewInvoice,
  initiateEndpointBuilder,
  verifyEndpointBuilder,
}) {
  const [busyOrderId, setBusyOrderId] = useState(null);
  const [panelError, setPanelError] = useState(null);
  const hasPendingOrders = orders.some(
    (o) =>
      ['pending_payment', 'processing', 'unknown_timeout'].includes(o.status) ||
      (o.status === 'approved' && !o.activated_at)
  );
  const isCompletedSummary = !hasPendingOrders && orders.length > 0 && orders[0].status === 'approved' && Boolean(orders[0].activated_at);
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
        order: data.order || order,
        checkout: data.checkout,
        onActivated: async (activatedData) => {
          if (onOrderUpdated) {
            await onOrderUpdated(activatedData);
          }
          window.location.href = '/';
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
            {isCompletedSummary ? <CheckCircle2 size={18} color="#15803d" /> : <ShieldCheck size={18} color="#2563eb" />}
            {isCompletedSummary ? 'Último pago confirmado' : 'Checkout seguro con CardNet'}
          </h3>
          <p className="sb-muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
            {isCompletedSummary
              ? 'Tu suscripción está activa y el último pago fue conciliado con éxito.'
              : 'Pago alojado en CardNet (3D Secure). Etereas no captura ni almacena los datos de tu tarjeta.'}
          </p>
        </div>
        {gatewayStatus && !isCompletedSummary && (
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

      {hasPendingOrders && gatewayStatus?.environment === 'production' && (
        <div
          role="note"
          style={{
            background: '#fffbeb',
            border: '1px solid #fcd34d',
            color: '#92400e',
            borderRadius: 8,
            padding: '8px 12px',
            margin: '10px 0',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Pago real. Se realizará un cargo a tu tarjeta.
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
                  {order.status === 'approved' && (
                    <div style={{ fontSize: 12, color: '#15803d', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <CheckCircle2 size={14} />
                      <span>
                        Autorización: {order.cardnet_authorization_code || 'Verificada'}
                        {order.masked_card ? ` · Tarjeta ${order.masked_card}` : ''}
                        {order.total_minor !== undefined && order.total_minor !== null
                          ? ` · ${formatOrderMoney(order.metadata?.fx_snapshot?.usd?.total_minor ?? order.total_minor, order.metadata?.fx_snapshot?.usd ? 'USD' : (order.currency || 'USD'))}`
                          : ''}
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
                  {isPayable && (() => {
                    const gatewayNotConfigured = Boolean(gatewayStatus && gatewayStatus.configured === false);
                    return (
                      <button
                        type="button"
                        className="sb-btn-primary"
                        disabled={isBusy || gatewayNotConfigured}
                        title={gatewayNotConfigured ? 'Los pagos con tarjeta están en proceso de habilitación. Contacta a soporte para activar tu orden.' : undefined}
                        onClick={() => handlePayWithCardnet(order)}
                      >
                        <CreditCard size={15} />
                        {gatewayNotConfigured
                          ? 'Pasarela en habilitación'
                          : isBusy
                            ? 'Conectando...'
                            : order.status === 'processing'
                              ? 'Retomar pago CardNet'
                              : 'Pagar con CardNet'}
                        {!gatewayNotConfigured && <ExternalLink size={13} />}
                      </button>
                    );
                  })()}
                  {order.status === 'approved' && order.activated_at && onViewInvoice && (() => {
                    const matchedInv = invoices.find((inv) => inv.id === order.invoice_id || inv.order_number === order.order_number);
                    if (!matchedInv) return null;
                    return (
                      <button
                        type="button"
                        className="sb-btn"
                        onClick={() => onViewInvoice(matchedInv)}
                      >
                        Ver comprobante
                      </button>
                    );
                  })()}
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
      )
      }
    </div >
  );
}
