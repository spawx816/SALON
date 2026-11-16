import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CreditCard,
  Receipt,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Lock,
  Sparkles,
  RefreshCw,
  Calendar,
  Users,
  Tag,
  Layers,
  X,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useEntitlements } from '../../context/EntitlementsContext';
import { loadCardNetScript } from '../../utils/cardnetScriptLoader';
import SaasCheckoutPanel from './SaasCheckoutPanel';
import './SaasBillingModule.css';

function ensureCardnetMethodForm(formId = 'etereas_cardnet_method_form') {
  let form = document.forms?.[formId] || document.getElementById(formId);
  if (!form) {
    form = document.createElement('form');
    form.id = formId;
    form.name = formId;
    form.style.display = 'none';
    form.setAttribute('aria-hidden', 'true');
    document.body.appendChild(form);
  }
  form.innerHTML = '';
  return form;
}

function patchCardnetMethodClose(PWCheckout) {
  if (!PWCheckout?.Iframe?.Close || PWCheckout.Iframe.__etereasCardClosePatched) return;
  const originalClose = PWCheckout.Iframe.Close;
  PWCheckout.Iframe.Close = function safeClose() {
    const frame = document.getElementById(PWCheckout.Iframe.frameId);
    const modal = document.getElementById(PWCheckout.Iframe.modalId);
    if (!frame && !modal) return;
    if (!frame || !modal) {
      if (frame?.parentNode) frame.parentNode.removeChild(frame);
      if (modal?.parentNode) modal.parentNode.removeChild(modal);
      if (typeof PWCheckout.Iframe.Closed === 'function') PWCheckout.Iframe.Closed();
      return;
    }
    return originalClose.apply(this, arguments);
  };
  PWCheckout.Iframe.__etereasCardClosePatched = true;
}

const STATUS_META = {
  active: { label: 'Activa', badgeClass: 'sb-badge-active' },
  trialing: { label: 'Prueba', badgeClass: 'sb-badge-active' },
  past_due: { label: 'Gracia', badgeClass: 'sb-badge-warning' },
  suspended: { label: 'Suspendida', badgeClass: 'sb-badge-danger' },
  cancelled: { label: 'Cancelada', badgeClass: 'sb-badge-neutral' },
  canceled: { label: 'Cancelada', badgeClass: 'sb-badge-neutral' },
};

const INVOICE_STATUS_META = {
  paid: { label: 'Pagada', badgeClass: 'sb-badge-active' },
  open: { label: 'Pendiente', badgeClass: 'sb-badge-warning' },
  partially_refunded: { label: 'Reemb. parcial', badgeClass: 'sb-badge-neutral' },
  refunded: { label: 'Reembolsada', badgeClass: 'sb-badge-neutral' },
  void: { label: 'Anulada', badgeClass: 'sb-badge-neutral' },
};

function formatMinor(minorStr, currency = 'DOP') {
  const numeric = Number(minorStr || 0) / 100;
  const code = String(currency || 'DOP').toUpperCase();
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

function formatDateEs(dateValue) {
  if (!dateValue) return null;
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('es-DO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function SaasBillingModule() {
  const navigate = useNavigate();
  const { entitlements, hasMembershipsAddon, membershipsAddon, pricing: entPricing, refetch: refetchEntitlements } = useEntitlements();

  const [subscription, setSubscription] = useState(null);
  const [subPricing, setSubPricing] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const [showAddonModal, setShowAddonModal] = useState(false);
  const [addonNote, setAddonNote] = useState('');
  const [branches, setBranches] = useState([]);
  const [selectedBranchIds, setSelectedBranchIds] = useState([]);
  const [requestingAddon, setRequestingAddon] = useState(false);

  const [showAddCardModal, setShowAddCardModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  const [payingInvoiceId, setPayingInvoiceId] = useState(null);
  const [cardnetLoading, setCardnetLoading] = useState(false);
  const [cardnetStatusMsg, setCardnetStatusMsg] = useState('');
  const [cardnetNotice, setCardnetNotice] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [canceling, setCanceling] = useState(false);
  const [checkoutOrders, setCheckoutOrders] = useState([]);
  const [gatewayStatus, setGatewayStatus] = useState(null);
  const [creatingOrder, setCreatingOrder] = useState(false);

  const loadBillingData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [subRes, invRes, pmRes, ordersRes, cfgRes] = await Promise.all([
        dataService.getSaasSubscription(),
        dataService.getSaasInvoices(),
        dataService.getSaasPaymentMethods(),
        fetch('/api/saas/billing/checkout/orders', { credentials: 'include' }).then((r) => (r.ok ? r.json() : { orders: [] })).catch(() => ({ orders: [] })),
        fetch('/api/saas/billing/checkout/config', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);

      setSubscription(subRes?.subscription || null);
      setSubPricing(subRes?.pricing || null);
      setBranches(Array.isArray(subRes?.branches) ? subRes.branches : []);
      setInvoices(Array.isArray(invRes?.invoices) ? invRes.invoices : []);
      setPaymentMethods(Array.isArray(pmRes?.paymentMethods) ? pmRes.paymentMethods : []);
      setCheckoutOrders(Array.isArray(ordersRes?.orders) ? ordersRes.orders : []);
      setGatewayStatus(cfgRes?.gateway || null);
    } catch (err) {
      setError(err.message || 'Error al cargar la información de suscripción');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBillingData();
  }, [loadBillingData]);

  const toggleAddonBranch = (branchId) => {
    setSelectedBranchIds((prev) =>
      prev.includes(branchId) ? prev.filter((id) => id !== branchId) : [...prev, branchId]
    );
  };

  const handleRequestAddon = async (e) => {
    e.preventDefault();
    if (branches.length > 0 && selectedBranchIds.length === 0) {
      setError('Selecciona al menos una sucursal para solicitar el módulo adicional.');
      return;
    }
    try {
      setRequestingAddon(true);
      setError(null);
      const res = await dataService.requestSaasAddon('memberships', {
        note: addonNote.trim(),
        branchIds: selectedBranchIds,
      });
      setSuccessMsg(
        res?.message ||
          'Solicitud registrada. Nuestro equipo comercial te contactará para coordinar la activación del módulo adicional.'
      );
      setShowAddonModal(false);
      setAddonNote('');
      setSelectedBranchIds([]);
    } catch (err) {
      setError(err.message || 'No se pudo enviar la solicitud.');
    } finally {
      setRequestingAddon(false);
    }
  };

  const handleCreatePlanOrder = async () => {
    try {
      setCreatingOrder(true);
      setError(null);
      const res = await fetch('/api/saas/billing/checkout/orders', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'self_service',
          branchesCount: Math.max(1, branches.length || 1),
          extraUsersCount: 0,
          wantsMembershipsAddon: Boolean(hasMembershipsAddon),
          addonBranchesCount: hasMembershipsAddon ? Math.max(1, branches.length || 1) : 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo generar la orden de pago.');
      }
      setSuccessMsg(`Orden #${data.order?.order_number} creada. Presiona "Pagar con CardNet" para completar el pago.`);
      await loadBillingData();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingOrder(false);
    }
  };

  const handlePayInvoice = async (invoiceId) => {
    try {
      setPayingInvoiceId(invoiceId);
      setError(null);
      const res = await fetch('/api/saas/billing/checkout/orders', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'debt_payment',
          invoiceId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo generar la orden de pago para esta factura.');
      }
      setSuccessMsg(`Orden #${data.order?.order_number} lista para pago seguro con CardNet.`);
      await loadBillingData();
    } catch (err) {
      setError(err.message || 'No se pudo iniciar el pago de la factura.');
    } finally {
      setPayingInvoiceId(null);
    }
  };

  const handleLaunchCardnetGateway = async () => {
    try {
      setCardnetLoading(true);
      setError(null);
      setCardnetNotice(null);
      setCardnetStatusMsg('Iniciando sesión segura con CardNet...');

      const initRes = await fetch('/api/saas/billing/payment-methods/initiate-cardnet', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const initData = await initRes.json().catch(() => ({}));
      if (!initRes.ok) {
        throw new Error(initData.error || 'No se pudo iniciar la sesión con CardNet.');
      }

      setCardnetStatusMsg('Cargando pasarela oficial de CardNet...');
      const PWCheckout = await loadCardNetScript(initData.publicKey, initData.captureUrl);
      const formId = 'etereas_cardnet_method_form';
      ensureCardnetMethodForm(formId);
      patchCardnetMethodClose(PWCheckout);

      if (typeof PWCheckout.Unbind === 'function') {
        try {
          PWCheckout.Unbind('tokenCreated');
          PWCheckout.Unbind('closed');
        } catch {
          // ignore
        }
      }

      let handled = false;

      PWCheckout.Bind('tokenCreated', async (tokenPayload) => {
        if (handled) return;
        handled = true;
        setCardnetStatusMsg('Tarjeta registrada en CardNet. Confirmando de forma segura...');

        try {
          const confRes = await fetch('/api/saas/billing/payment-methods/confirm-cardnet', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customerId: initData.customerId,
              tokenPayload,
              uniqueId: initData.uniqueId,
            }),
          });
          const confData = await confRes.json().catch(() => ({}));
          if (!confRes.ok) {
            throw new Error(confData.error || 'No se pudo confirmar el método de pago.');
          }

          setSuccessMsg(confData.message || 'Método de pago registrado exitosamente.');
          setShowAddCardModal(false);
          await loadBillingData();
        } catch (err) {
          setError(err.message || 'Error al confirmar el método de pago.');
        } finally {
          setCardnetLoading(false);
          setCardnetStatusMsg('');
        }
      });

      PWCheckout.Bind('closed', () => {
        setCardnetLoading(false);
        setCardnetStatusMsg('');
      });

      if (typeof PWCheckout.SetProperties === 'function') {
        PWCheckout.SetProperties({
          name: 'Etereas',
          email: '',
          button_label: 'Registrar tarjeta',
          description: 'Registro seguro de medio de pago Etereas',
          currency: 'DOP',
          amount: '0',
          lang: 'ESP',
          form_id: formId,
          checkout_card: '1',
        });
      }

      if (typeof PWCheckout.Iframe?.Open === 'function') {
        PWCheckout.Iframe.Open({
          customerId: initData.customerId,
          uniqueId: initData.uniqueId,
          formId,
        });
      }
    } catch (err) {
      console.error('Error opening CardNet checkout:', err);
      setError(err.message || 'Error al abrir pasarela de CardNet.');
      setCardnetLoading(false);
      setCardnetStatusMsg('');
    }
  };

  const handleCancelSubscription = async (e) => {
    e.preventDefault();
    try {
      setCanceling(true);
      setError(null);
      const res = await dataService.cancelSaasSubscription(cancelReason.trim() || undefined);
      setSuccessMsg(res?.message || 'Cancelación solicitada correctamente.');
      setShowCancelModal(false);
      setCancelReason('');
      await Promise.all([loadBillingData(), refetchEntitlements()]);
    } catch (err) {
      setError(err.message || 'No se pudo procesar la solicitud de cancelación.');
    } finally {
      setCanceling(false);
    }
  };

  const currency = String(subscription?.currency || 'USD').toUpperCase();
  const status = String(subscription?.status || entitlements?.status || 'active').toLowerCase();
  const statusMeta = STATUS_META[status] || { label: status, badgeClass: 'sb-badge-neutral' };

  const activePricing = subPricing || entPricing;
  const configuredUsd = activePricing?.principal?.usd;
  const configuredDop = activePricing?.principal?.dop;
  const hasRealSubPrice = subscription?.price_minor !== undefined && subscription?.price_minor !== null && Number(subscription.price_minor) > 0;

  let formattedPrice = null;
  if (hasRealSubPrice) {
    formattedPrice = formatMinor(subscription.price_minor, currency);
  } else if (currency === 'DOP' && configuredDop !== null && configuredDop !== undefined) {
    formattedPrice = formatMinor(Math.round(Number(configuredDop) * 100), 'DOP');
  } else if (configuredUsd !== null && configuredUsd !== undefined) {
    formattedPrice = formatMinor(Math.round(Number(configuredUsd) * 100), 'USD');
  }

  const nextBillingFormatted = formatDateEs(
    subscription?.current_period_end || subscription?.next_billing_date
  );
  const cancelAtPeriodEnd = Boolean(subscription?.cancel_at_period_end);

  const branchesUsed = entitlements?.usage?.branches ?? 0;
  const branchesLimit = entitlements?.limits?.branches ?? 1;
  const usersUsed = entitlements?.usage?.users ?? 0;
  const usersLimit = entitlements?.limits?.users ?? 3;

  const defaultPm = paymentMethods.find((pm) => pm.isDefault) || paymentMethods[0] || null;
  const isLegacyTransition = membershipsAddon?.source === 'legacy_pro_transition';
  const hasOpenInvoice = invoices.some((inv) => inv.status === 'open' || inv.status === 'past_due');
  const hasOpenCheckoutOrder = checkoutOrders.some(
    (o) =>
      ['pending_payment', 'processing', 'unknown_timeout'].includes(o.status) ||
      (o.status === 'approved' && !o.activated_at)
  );
  const showCreateOrderButton = status !== 'active' || hasOpenInvoice || hasOpenCheckoutOrder;
  const latestApprovedOrder = checkoutOrders.find((o) => o.status === 'approved') || null;

  const handleDownloadReceipt = async (invoice) => {
    if (!invoice?.id) return;
    try {
      const res = await fetch(`/api/saas/billing/invoices/${invoice.id}/receipt?download=1`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('No se pudo descargar el comprobante.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `comprobante-${invoice.invoice_number || invoice.id}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Error al descargar el comprobante.');
    }
  };

  if (loading && !subscription && invoices.length === 0) {
    return (
      <div className="sb-page">
        <div className="sb-loading-box">
          <RefreshCw size={24} className="sb-spin" />
          <span>Cargando suscripción...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="sb-page">
      {/* Header */}
      <div className="sb-header">
        <div>
          <h1>Mi suscripción</h1>
          <p>Tu plan, pagos, licencias y módulos adicionales en un solo lugar.</p>
        </div>
        <div className="sb-header-actions">
          <button
            type="button"
            className="sb-btn"
            onClick={loadBillingData}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? 'sb-spin' : ''} />
            <span>Actualizar</span>
          </button>
        </div>
      </div>

      {/* Status & Feedback Alerts */}
      {status === 'past_due' && (
        <div className="sb-alert sb-alert-warning" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>Pago pendiente — Período de gracia activo.</strong>{' '}
            El cobro de tu última factura no pudo completarse. Actualiza tu método de pago o salda la factura pendiente para evitar la suspensión del servicio.
          </div>
        </div>
      )}

      {status === 'suspended' && (
        <div className="sb-alert sb-alert-error" role="alert">
          <Lock size={18} />
          <div>
            <strong>Suscripción suspendida por falta de pago.</strong>{' '}
            Salda la factura pendiente en el historial para reactivar el acceso completo.
          </div>
        </div>
      )}

      {error && (
        <div className="sb-alert sb-alert-error" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="sb-alert sb-alert-success" role="status">
          <CheckCircle2 size={18} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Row 1: Plan Principal + Próximo cobro */}
      <div className="sb-grid-2">
        <section className="sb-card" aria-labelledby="sb-plan-title">
          <div>
            <div className="sb-card-head">
              <div className="sb-card-title-wrap">
                <span className="sb-icon-box" aria-hidden="true">
                  <Layers size={18} />
                </span>
                <h2 id="sb-plan-title" className="sb-card-title">
                  Plan Principal
                </h2>
                <span className={`sb-badge ${statusMeta.badgeClass}`}>
                  {statusMeta.label}
                </span>
              </div>
            </div>

            <div className="sb-price-line">
              {formattedPrice ? (
                <>
                  <span className="sb-price-amount">{formattedPrice}</span>
                  <span className="sb-price-period">
                    / {subscription?.billing_cycle === 'annual' ? 'año' : 'mes'}
                  </span>
                </>
              ) : (
                <span className="sb-price-amount" style={{ fontSize: '22px' }}>
                  Tarifa según acuerdo comercial
                </span>
              )}
            </div>

            <p className="sb-meta-text">
              {branchesLimit} {branchesLimit === 1 ? 'sucursal incluida' : 'sucursales incluidas'} · Hasta {usersLimit} usuarios
            </p>
            <p className="sb-meta-text" style={{ marginTop: '4px' }}>
              Incluye POS, cajas, comprobantes DGII e-CF, Clientes/CRM, inventario avanzado, nómina, comisiones, marketing y reportes.
            </p>
          </div>
        </section>

        <section className="sb-card" aria-labelledby="sb-next-charge-title">
          <div>
            <div className="sb-card-head">
              <div className="sb-card-title-wrap">
                <span className="sb-icon-box" aria-hidden="true">
                  <Calendar size={18} />
                </span>
                <h2 id="sb-next-charge-title" className="sb-card-title">
                  Próximo cobro
                </h2>
              </div>
            </div>

            <div className="sb-price-line">
              <span className="sb-price-amount" style={{ fontSize: '26px' }}>
                {nextBillingFormatted || 'Sin fecha programada'}
              </span>
            </div>

            <p className="sb-meta-text">
              {formattedPrice ? `${formattedPrice} · ` : ''}
              {subscription?.billing_cycle === 'annual' ? 'Facturación anual' : 'Facturación mensual'}
            </p>
            <p className="sb-meta-text" style={{ marginTop: '4px' }}>
              {cancelAtPeriodEnd || status === 'canceled' || status === 'cancelled'
                ? 'Renovación automática desactivada.'
                : subscription?.auto_renew_enabled
                  ? 'Suscripción activa · Renovación automática habilitada.'
                  : 'Suscripción activa · Renovación automática desactivada (cobro manual).'}
            </p>
          </div>
        </section>
      </div>

      {/* Row 2: Tus licencias + Método de pago */}
      <div className="sb-grid-2">
        <section className="sb-card" aria-labelledby="sb-licenses-title">
          <div>
            <div className="sb-card-head">
              <div className="sb-card-title-wrap">
                <span className="sb-icon-box" aria-hidden="true">
                  <Users size={18} />
                </span>
                <h2 id="sb-licenses-title" className="sb-card-title">
                  Tus licencias
                </h2>
              </div>
            </div>

            <div className="sb-kv-list">
              <div className="sb-kv-row">
                <span className="sb-kv-label">Sucursales</span>
                <span className="sb-kv-value">
                  {branchesUsed} de {branchesLimit} en uso
                </span>
              </div>
              <div className="sb-kv-row">
                <span className="sb-kv-label">Usuarios</span>
                <span className="sb-kv-value">
                  {usersUsed} de {usersLimit} en uso
                </span>
              </div>
            </div>

            <p className="sb-footnote">El kiosco no consume licencias.</p>
          </div>

          <div className="sb-card-actions">
            <button
              type="button"
              className="sb-btn"
              onClick={() => navigate('/sucursales')}
            >
              <span>Sucursales</span>
              <ExternalLink size={14} />
            </button>
            <button
              type="button"
              className="sb-btn"
              onClick={() => navigate('/personal')}
            >
              <span>Usuarios</span>
              <ExternalLink size={14} />
            </button>
          </div>
        </section>

        <section className="sb-card" aria-labelledby="sb-pm-title">
          <div>
            <div className="sb-card-head">
              <div className="sb-card-title-wrap">
                <span className="sb-icon-box" aria-hidden="true">
                  <CreditCard size={18} />
                </span>
                <h2 id="sb-pm-title" className="sb-card-title">
                  Método de pago
                </h2>
              </div>
            </div>

            {defaultPm ? (
              <div>
                <div className="sb-pm-box">
                  <span className="sb-pm-brand">{defaultPm.brand || 'CARD'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '14px' }}>
                      {String(defaultPm.brand || 'Tarjeta').toUpperCase()} •••• {defaultPm.last4}
                    </div>
                    <div className="sb-meta-text" style={{ margin: 0 }}>
                      {defaultPm.expMonth && defaultPm.expYear
                        ? `Vence ${String(defaultPm.expMonth).padStart(2, '0')}/${defaultPm.expYear}`
                        : 'Método registrado en pasarela'}
                    </div>
                  </div>
                  <span className="sb-badge sb-badge-active">Principal</span>
                </div>
                <p className="sb-meta-text" style={{ marginTop: '8px', fontSize: '12px' }}>
                  Tarjeta guardada con la pasarela. No hay cobro recurrente automático activo.
                </p>
              </div>
            ) : latestApprovedOrder ? (
              <div className="sb-empty-box" style={{ textAlign: 'left', fontSize: '13px' }}>
                El pago anterior se realizó con un token de un solo uso ({latestApprovedOrder.masked_card || 'CardNet'}). No hay método guardado reutilizable ni cobro automático activo.
              </div>
            ) : (
              <div className="sb-empty-box">
                No hay ningún método de pago registrado.
              </div>
            )}
          </div>

          <div className="sb-card-actions">
            <button
              type="button"
              className="sb-btn"
              onClick={() => setShowAddCardModal(true)}
            >
              {defaultPm ? 'Actualizar tarjeta' : 'Agregar método de pago'}
            </button>
          </div>
        </section>
      </div>

      {/* Row 3: Add-on Suscripciones / Membresías B2C */}
      <section className="sb-row-card" aria-labelledby="sb-memberships-title">
        <div className="sb-card-title-wrap">
          <span className="sb-icon-box" aria-hidden="true">
            <Tag size={18} />
          </span>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h2 id="sb-memberships-title" className="sb-card-title">
                Add-on Suscripciones y Membresías B2C
              </h2>
              <span className={`sb-badge ${hasMembershipsAddon ? 'sb-badge-active' : 'sb-badge-neutral'}`}>
                {hasMembershipsAddon
                  ? isLegacyTransition
                    ? 'Activo (Transición heredada)'
                    : 'Activo'
                  : 'No contratado'}
              </span>
            </div>
            <p className="sb-meta-text" style={{ margin: '4px 0 0' }}>
              Módulo adicional para ofrecer planes mensuales, contratos digitales y cobros recurrentes a los clientes de tu empresa.
            </p>
            {hasMembershipsAddon && isLegacyTransition && (
              <p className="sb-meta-text" style={{ margin: '4px 0 0', color: '#92400e', fontWeight: 600 }}>
                Procedencia: {membershipsAddon?.reason || 'Permiso heredado de transición'} · Vigencia:{' '}
                {membershipsAddon?.expiresAt
                  ? new Date(membershipsAddon.expiresAt).toLocaleDateString('es-DO')
                  : 'Sin fecha de expiración definida'} (no corresponde a contratación pagada adicional).
              </p>
            )}
            {hasMembershipsAddon && Array.isArray(membershipsAddon?.branches) && membershipsAddon.branches.length > 0 && (
              <p className="sb-meta-text" style={{ margin: '4px 0 0', color: '#047857', fontWeight: 600 }}>
                Sucursales habilitadas ({membershipsAddon.branches.length}): {membershipsAddon.branches.map(b => b.name).join(', ')}
              </p>
            )}
            <p className="sb-meta-text" style={{ margin: '4px 0 0', fontWeight: 600, color: '#0f172a' }}>
              {subPricing?.addons?.memberships?.pricingDisplay ||
                entPricing?.addons?.memberships?.pricingDisplay ||
                'US$99/mes por sucursal + implementación e integración con pasarela de pago'}
            </p>
          </div>
        </div>

        <div>
          {hasMembershipsAddon ? (
            <button
              type="button"
              className="sb-btn"
              onClick={() => navigate('/planes')}
            >
              Ver módulo
            </button>
          ) : (
            <button
              type="button"
              className="sb-btn sb-btn-primary"
              onClick={() => setShowAddonModal(true)}
            >
              <Sparkles size={15} />
              <span>Solicitar contratación</span>
            </button>
          )}
        </div>
      </section>

      {/* Row 3b: Checkout seguro con CardNet */}
      <div style={{ marginBottom: 16 }}>
        {showCreateOrderButton && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button
              type="button"
              className="sb-btn-primary"
              disabled={creatingOrder}
              onClick={handleCreatePlanOrder}
            >
              <CreditCard size={15} />
              {creatingOrder ? 'Generando orden...' : 'Generar orden de pago del plan (CardNet)'}
            </button>
          </div>
        )}
        <SaasCheckoutPanel
          orders={checkoutOrders}
          invoices={invoices}
          gatewayStatus={gatewayStatus}
          onViewInvoice={(inv) => setSelectedInvoice(inv)}
          onOrderUpdated={async () => {
            await Promise.all([loadBillingData(), refetchEntitlements()]);
          }}
        />
      </div>

      {/* Row 4: Historial de facturas */}
      <section className="sb-card sb-card-mb" aria-labelledby="sb-invoices-title">
        <div className="sb-card-head">
          <div className="sb-card-title-wrap">
            <span className="sb-icon-box" aria-hidden="true">
              <Receipt size={18} />
            </span>
            <h2 id="sb-invoices-title" className="sb-card-title">
              Historial de facturas
            </h2>
          </div>
          <span className="sb-meta-text" style={{ margin: 0 }}>
            {invoices.length} {invoices.length === 1 ? 'factura' : 'facturas'}
          </span>
        </div>

        {invoices.length === 0 ? (
          <div className="sb-empty-box">
            No hay facturas registradas en el historial de suscripción.
          </div>
        ) : (
          <div className="sb-table-wrap">
            <table className="sb-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Concepto</th>
                  <th>Importe</th>
                  <th>Estado</th>
                  <th style={{ textAlign: 'right' }}>Comprobante</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const invMeta = INVOICE_STATUS_META[inv.status] || {
                    label: inv.status,
                    badgeClass: 'sb-badge-neutral',
                  };
                  return (
                    <tr key={inv.id}>
                      <td>{formatDateEs(inv.created_at) || '—'}</td>
                      <td>
                        Etereas {inv.plan_code} ({inv.billing_cycle === 'annual' ? 'anual' : 'mensual'})
                      </td>
                      <td style={{ fontWeight: 600, color: '#0f172a' }}>
                        {formatMinor(inv.total_minor, inv.currency)}
                      </td>
                      <td>
                        <span className={`sb-badge ${invMeta.badgeClass}`}>
                          {invMeta.label}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {inv.status === 'open' ? (
                          <button
                            type="button"
                            className="sb-btn sb-btn-primary"
                            onClick={() => handlePayInvoice(inv.id)}
                            disabled={payingInvoiceId === inv.id}
                          >
                            {payingInvoiceId === inv.id ? 'Pagando...' : 'Pagar ahora'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="sb-btn"
                            onClick={() => setSelectedInvoice(inv)}
                          >
                            Ver detalle
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Row 5: Cancelación */}
      <div className="sb-cancel-bar">
        <div className="sb-meta-text" style={{ margin: 0 }}>
          Estado de la suscripción: <strong>{statusMeta.label}</strong>
          {cancelAtPeriodEnd && ' (cancelación programada al fin del ciclo)'}
        </div>
        {status !== 'canceled' && status !== 'cancelled' && !cancelAtPeriodEnd ? (
          <button
            type="button"
            className="sb-btn-danger-link"
            onClick={() => setShowCancelModal(true)}
          >
            Solicitar cancelación
          </button>
        ) : (
          <span className="sb-badge sb-badge-neutral">Cancelación registrada</span>
        )}
      </div>

      {/* Add-on Request Modal */}
      {showAddonModal && (
        <div
          className="sb-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sb-addon-modal-title"
        >
          <div className="sb-modal-card">
            <div className="sb-modal-header">
              <h3 id="sb-addon-modal-title">Solicitar add-on de Membresías B2C</h3>
              <button
                type="button"
                className="sb-modal-close"
                onClick={() => setShowAddonModal(false)}
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>

            <p className="sb-meta-text" style={{ marginBottom: '12px' }}>
              Este módulo adicional habilita la creación de planes de membresía B2C, contratos digitales y cobros recurrentes para los clientes de tu empresa.
            </p>
            <p className="sb-meta-text" style={{ marginBottom: '14px', fontWeight: 600, color: '#0f172a' }}>
              {subPricing?.addons?.memberships?.pricingDisplay ||
                entPricing?.addons?.memberships?.pricingDisplay ||
                'US$99/mes por sucursal + implementación e integración con pasarela de pago'}
            </p>

            <form onSubmit={handleRequestAddon}>
              <div className="sb-field" style={{ marginBottom: '14px' }}>
                <label>Sucursales donde deseas habilitar el add-on</label>
                {branches.length === 0 ? (
                  <p className="sb-meta-text" style={{ margin: '6px 0 0' }}>
                    No se detectaron sucursales adicionales; nuestro equipo confirmará la sucursal a habilitar antes de activar el servicio.
                  </p>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      marginTop: '6px',
                      padding: '10px 12px',
                      border: '1px solid #e2e8f0',
                      borderRadius: '10px',
                      background: '#f8fafc',
                    }}
                  >
                    {branches.map((branch) => {
                      const checked = selectedBranchIds.includes(branch.id);
                      return (
                        <label
                          key={branch.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '10px',
                            cursor: 'pointer',
                            fontWeight: 500,
                            color: '#0f172a',
                          }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleAddonBranch(branch.id)}
                            />
                            <span>{branch.name}</span>
                          </span>
                          <span style={{ fontSize: '0.85rem', color: '#475569' }}>
                            US${subPricing?.addons?.memberships?.usd ?? 99}/mes
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div
                style={{
                  border: '1px solid #cbd5e1',
                  borderRadius: '10px',
                  padding: '12px',
                  background: '#ffffff',
                  marginBottom: '14px',
                  fontSize: '0.88rem',
                }}
              >
                <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
                  Desglose antes de confirmar
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', color: '#334155' }}>
                  <span>Sucursales seleccionadas</span>
                  <strong>{selectedBranchIds.length}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', color: '#334155' }}>
                  <span>Tarifa por sucursal habilitada</span>
                  <span>US${subPricing?.addons?.memberships?.usd ?? 99}/mes</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '6px', borderTop: '1px solid #e2e8f0', marginBottom: '6px', color: '#0f172a' }}>
                  <strong>Total mensual estimado del add-on</strong>
                  <strong>
                    US${selectedBranchIds.length * (subPricing?.addons?.memberships?.usd ?? 99)}/mes
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', color: '#475569', fontSize: '0.82rem' }}>
                  <span>Implementación e integración con pasarela de pago</span>
                  <span style={{ textAlign: 'right', fontWeight: 600 }}>Cotización por separado</span>
                </div>
              </div>

              <div className="sb-field">
                <label htmlFor="sb-addon-note">Comentarios o consulta (opcional)</label>
                <textarea
                  id="sb-addon-note"
                  rows={3}
                  className="sb-input"
                  value={addonNote}
                  onChange={(e) => setAddonNote(e.target.value)}
                  placeholder="Cuéntanos sobre tus necesidades de membresías o sucursales..."
                />
              </div>

              <p className="sb-meta-text" style={{ margin: '8px 0 12px' }}>
                Esta solicitud no genera cargos automáticos; nuestro equipo comercial confirmará la cotización de implementación y activación contigo.
              </p>

              <div className="sb-modal-footer">
                <button
                  type="button"
                  className="sb-btn"
                  onClick={() => {
                    setShowAddonModal(false);
                    setSelectedBranchIds([]);
                  }}
                  disabled={requestingAddon}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="sb-btn sb-btn-primary"
                  disabled={requestingAddon || (branches.length > 0 && selectedBranchIds.length === 0)}
                >
                  {requestingAddon ? 'Enviando...' : 'Confirmar solicitud'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Card Modal via CardNet PWCheckout */}
      {showAddCardModal && (
        <div
          className="sb-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sb-add-card-title"
        >
          <div className="sb-modal-card">
            <div className="sb-modal-header">
              <h3 id="sb-add-card-title">
                {defaultPm ? 'Actualizar tarjeta con CardNet' : 'Agregar tarjeta con CardNet'}
              </h3>
              <button
                type="button"
                className="sb-modal-close"
                onClick={() => {
                  if (!cardnetLoading) {
                    setShowAddCardModal(false);
                  }
                }}
                disabled={cardnetLoading}
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>

            {defaultPm && (
              <div style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '0.85rem 1rem',
                marginBottom: '1rem',
                fontSize: '0.82rem',
                color: '#334155'
              }}>
                <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '0.2rem' }}>
                  Tarjeta actualmente activa:
                </div>
                <div>
                  {String(defaultPm.brand || 'Tarjeta').toUpperCase()} terminada en •••• {defaultPm.last4}
                </div>
                <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.25rem' }}>
                  Tu tarjeta actual se mantendrá intacta hasta que confirmes la nueva en CardNet. Cancelar o cerrar no alterará tu método guardado.
                </div>
              </div>
            )}

            <p className="sb-meta-text" style={{ marginBottom: '16px' }}>
              La tarjeta se registra mediante la pasarela segura oficial de <strong>CardNet</strong>. Etereas jamás almacena números completos de tarjeta (PAN) ni códigos de seguridad (CVC).
            </p>

            <div style={{
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '10px',
              padding: '0.75rem',
              marginBottom: '1.25rem',
              fontSize: '0.8rem',
              color: '#166534',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
              <span>Esta operación solo tokeniza y registra tu tarjeta. <strong>NO</strong> realiza ningún cobro de suscripción en este momento.</span>
            </div>

            {cardnetStatusMsg && (
              <div style={{
                background: '#f1f5f9',
                border: '1px solid #cbd5e1',
                borderRadius: '10px',
                padding: '0.75rem',
                marginBottom: '1.25rem',
                fontSize: '0.82rem',
                color: '#334155',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <Loader2 size={16} className="sb-spin" />
                <span>{cardnetStatusMsg}</span>
              </div>
            )}

            <div className="sb-modal-footer">
              <button
                type="button"
                className="sb-btn"
                onClick={() => setShowAddCardModal(false)}
                disabled={cardnetLoading}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="sb-btn sb-btn-primary"
                onClick={handleLaunchCardnetGateway}
                disabled={cardnetLoading}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                {cardnetLoading ? (
                  <>
                    <Loader2 size={15} className="sb-spin" />
                    <span>Conectando con CardNet...</span>
                  </>
                ) : (
                  <>
                    <CreditCard size={16} />
                    <span>Abrir pasarela CardNet</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Subscription Modal */}
      {showCancelModal && (
        <div
          className="sb-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sb-cancel-modal-title"
        >
          <div className="sb-modal-card">
            <div className="sb-modal-header">
              <h3 id="sb-cancel-modal-title">Solicitar cancelación</h3>
              <button
                type="button"
                className="sb-modal-close"
                onClick={() => setShowCancelModal(false)}
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>

            <p className="sb-meta-text" style={{ marginBottom: '16px' }}>
              Al confirmar, la renovación automática de tu suscripción se desactivará conforme a las condiciones del servicio.
            </p>

            <form onSubmit={handleCancelSubscription}>
              <div className="sb-field">
                <label htmlFor="sb-cancel-reason">Motivo (opcional)</label>
                <textarea
                  id="sb-cancel-reason"
                  rows={3}
                  className="sb-input"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Cuéntanos brevemente el motivo de tu solicitud..."
                />
              </div>

              <div className="sb-modal-footer">
                <button
                  type="button"
                  className="sb-btn"
                  onClick={() => setShowCancelModal(false)}
                  disabled={canceling}
                >
                  Volver
                </button>
                <button
                  type="submit"
                  className="sb-btn"
                  style={{ borderColor: '#fecaca', color: '#dc2626', background: '#fef2f2' }}
                  disabled={canceling}
                >
                  {canceling ? 'Procesando...' : 'Confirmar cancelación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        <div
          className="sb-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sb-invoice-detail-title"
        >
          <div className="sb-modal-card">
            <div className="sb-modal-header">
              <h3 id="sb-invoice-detail-title">Detalle de factura</h3>
              <button
                type="button"
                className="sb-modal-close"
                onClick={() => setSelectedInvoice(null)}
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="sb-kv-list">
              <div className="sb-kv-row">
                <span className="sb-kv-label">Comprobante</span>
                <span className="sb-kv-value">{selectedInvoice.invoice_number || selectedInvoice.id}</span>
              </div>
              {selectedInvoice.order_number && (
                <div className="sb-kv-row">
                  <span className="sb-kv-label">Orden</span>
                  <span className="sb-kv-value">#{selectedInvoice.order_number}</span>
                </div>
              )}
              <div className="sb-kv-row">
                <span className="sb-kv-label">Fecha</span>
                <span className="sb-kv-value">{formatDateEs(selectedInvoice.paid_at || selectedInvoice.created_at) || '—'}</span>
              </div>
              <div className="sb-kv-row">
                <span className="sb-kv-label">Concepto</span>
                <span className="sb-kv-value">
                  {selectedInvoice.items?.[0]?.description ||
                    `Etereas ${selectedInvoice.plan_code} (${selectedInvoice.billing_cycle === 'annual' ? 'anual' : 'mensual'})`}
                </span>
              </div>
              {selectedInvoice.fx_snapshot?.usd?.total_minor && (
                <div className="sb-kv-row">
                  <span className="sb-kv-label">Precio original (USD)</span>
                  <span className="sb-kv-value">
                    {formatMinor(selectedInvoice.fx_snapshot.usd.total_minor, 'USD')}
                  </span>
                </div>
              )}
              {selectedInvoice.fx_snapshot?.rate_formatted && (
                <div className="sb-kv-row">
                  <span className="sb-kv-label">Tasa FX aplicada</span>
                  <span className="sb-kv-value">RD$ {selectedInvoice.fx_snapshot.rate_formatted} / US$1</span>
                </div>
              )}
              <div className="sb-kv-row">
                <span className="sb-kv-label">Impuestos</span>
                <span className="sb-kv-value">
                  {formatMinor(selectedInvoice.tax_minor || 0, selectedInvoice.currency)}
                </span>
              </div>
              <div className="sb-kv-row">
                <span className="sb-kv-label">Total cobrado</span>
                <span className="sb-kv-value" style={{ fontWeight: 700 }}>
                  {formatMinor(selectedInvoice.total_minor, selectedInvoice.currency)}
                </span>
              </div>
              {(selectedInvoice.cardnet_authorization_code || selectedInvoice.payment_reference) && (
                <div className="sb-kv-row">
                  <span className="sb-kv-label">Autorización / Ref.</span>
                  <span className="sb-kv-value">
                    {selectedInvoice.cardnet_authorization_code || selectedInvoice.payment_reference}
                  </span>
                </div>
              )}
              {selectedInvoice.masked_card && (
                <div className="sb-kv-row">
                  <span className="sb-kv-label">Tarjeta</span>
                  <span className="sb-kv-value">{selectedInvoice.masked_card}</span>
                </div>
              )}
              <div className="sb-kv-row">
                <span className="sb-kv-label">Estado</span>
                <span className="sb-kv-value">
                  {(INVOICE_STATUS_META[selectedInvoice.status] || { label: selectedInvoice.status }).label}
                </span>
              </div>
            </div>

            <p className="sb-meta-text" style={{ marginTop: 12, fontSize: 12 }}>
              Comprobante comercial de suscripción SaaS — No es comprobante fiscal e-CF / NCF.
            </p>

            <div className="sb-modal-footer">
              <button
                type="button"
                className="sb-btn"
                onClick={() => handleDownloadReceipt(selectedInvoice)}
              >
                Descargar comprobante
              </button>
              <button
                type="button"
                className="sb-btn sb-btn-primary"
                onClick={() => setSelectedInvoice(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
