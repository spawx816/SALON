import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import SaasCheckoutPanel, { executeCardnetCheckout } from './SaasCheckoutPanel';
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
  const [addonQuote, setAddonQuote] = useState(null);
  const [addonQuoteLoading, setAddonQuoteLoading] = useState(false);
  const [addonQuoteError, setAddonQuoteError] = useState('');
  const [addonPaymentChoice, setAddonPaymentChoice] = useState('saved_card');

  const [showExtraUsersModal, setShowExtraUsersModal] = useState(false);
  const [extraSeatsToBuy, setExtraSeatsToBuy] = useState(1);
  const [seatsQuote, setSeatsQuote] = useState(null);
  const [seatsQuoteLoading, setSeatsQuoteLoading] = useState(false);
  const [seatsQuoteError, setSeatsQuoteError] = useState('');
  const [seatsPaymentChoice, setSeatsPaymentChoice] = useState('saved_card');
  const [contractingSeats, setContractingSeats] = useState(false);

  const [showAddCardModal, setShowAddCardModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const cancelInFlightRef = useRef(false);
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
  const [renewalQuote, setRenewalQuote] = useState(null);
  const [renewalState, setRenewalState] = useState(null);
  const [showChargeBreakdown, setShowChargeBreakdown] = useState(false);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [showConditionChangeModal, setShowConditionChangeModal] = useState(false);
  const [recurringConsentChecked, setRecurringConsentChecked] = useState(false);
  const [authorizingRenewal, setAuthorizingRenewal] = useState(false);

  const loadBillingData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [subRes, invRes, pmRes, ordersRes, cfgRes, quoteRes] = await Promise.all([
        dataService.getSaasSubscription(),
        dataService.getSaasInvoices(),
        dataService.getSaasPaymentMethods(),
        fetch('/api/saas/billing/checkout/orders', { credentials: 'include' }).then((r) => (r.ok ? r.json() : { orders: [] })).catch(() => ({ orders: [] })),
        fetch('/api/saas/billing/checkout/config', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/saas/billing/renewal/quote', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);

      setSubscription(subRes?.subscription || null);
      setSubPricing(subRes?.pricing || null);
      setBranches(Array.isArray(subRes?.branches) ? subRes.branches : []);
      setInvoices(Array.isArray(invRes?.invoices) ? invRes.invoices : []);
      setPaymentMethods(Array.isArray(pmRes?.paymentMethods) ? pmRes.paymentMethods : []);
      setCheckoutOrders(Array.isArray(ordersRes?.orders) ? ordersRes.orders : []);
      setGatewayStatus(cfgRes?.gateway || null);
      setRenewalQuote(quoteRes?.quote || null);
      setRenewalState(quoteRes?.renewalState || null);
    } catch (err) {
      setError(err.message || 'Error al cargar la información de suscripción');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBillingData();
  }, [loadBillingData]);

  const fetchAddonQuote = useCallback(async (branchIdsToQuote) => {
    if (!Array.isArray(branchIdsToQuote) || branchIdsToQuote.length === 0) {
      setAddonQuote(null);
      setAddonQuoteError('');
      return;
    }
    setAddonQuoteLoading(true);
    setAddonQuoteError('');
    try {
      const res = await dataService.quoteSaasAddon('memberships', branchIdsToQuote);
      setAddonQuote(res.quote || null);
      if (res.defaultPaymentMethod) {
        setAddonPaymentChoice('saved_card');
      } else {
        setAddonPaymentChoice('cardnet');
      }
    } catch (err) {
      setAddonQuote(null);
      setAddonQuoteError(err.message || 'No se pudo calcular la cotización del add-on.');
    } finally {
      setAddonQuoteLoading(false);
    }
  }, []);

  const handleOpenAddonModal = async () => {
    const initialIds = Array.isArray(membershipsAddon?.branchIds) && membershipsAddon.branchIds.length > 0
      ? membershipsAddon.branchIds.map(String)
      : (branches.length > 0 ? [String(branches[0].id)] : []);
    setSelectedBranchIds(initialIds);
    setAddonQuoteError('');
    setShowAddonModal(true);
    if (initialIds.length > 0) {
      await fetchAddonQuote(initialIds);
    }
  };

  const toggleAddonBranch = (branchId) => {
    setSelectedBranchIds((prev) => {
      const next = prev.includes(branchId) ? prev.filter((id) => id !== branchId) : [...prev, branchId];
      fetchAddonQuote(next);
      return next;
    });
  };

  const handleRequestAddon = async (e) => {
    e.preventDefault();
    if (branches.length > 0 && selectedBranchIds.length === 0) {
      setError('Selecciona al menos una sucursal con licencia para habilitar el módulo.');
      return;
    }
    try {
      setRequestingAddon(true);
      setError(null);
      setAddonQuoteError('');
      const res = await dataService.contractSaasAddon('memberships', {
        branchIds: selectedBranchIds,
        paymentMethodChoice: addonPaymentChoice,
      });

      if (res.withinAcquiredCapacity || (res.paid && res.activated)) {
        setSuccessMsg(
          res.message ||
            'Add-on de Suscripciones y Membresías B2C actualizado y habilitado exitosamente.'
        );
        setShowAddonModal(false);
        setAddonNote('');
        await Promise.all([loadBillingData(), refetchEntitlements()]);
        return;
      }

      if (res.needsCheckout && res.checkout && res.order) {
        await executeCardnetCheckout({
          orderId: res.order.id,
          order: res.order,
          checkout: res.checkout,
          onCheckoutOpening: () => {
            setShowAddonModal(false);
          },
          onVerifying: () => {},
          onActivated: async () => {
            setSuccessMsg('¡Pago verificado y Add-on de Membresías B2C activado exitosamente!');
            setShowAddonModal(false);
            await Promise.all([loadBillingData(), refetchEntitlements()]);
          },
          onError: (errMsg) => {
            setAddonQuoteError('Error en pago CardNet: ' + errMsg);
            setError('Error en pago CardNet: ' + errMsg);
          },
          onCheckoutClosed: async () => {
            await Promise.all([loadBillingData(), refetchEntitlements()]);
          },
        });
      }
    } catch (err) {
      setAddonQuoteError(err.message || 'No se pudo procesar la contratación del add-on.');
      setError(err.message || 'No se pudo procesar la contratación del add-on.');
    } finally {
      setRequestingAddon(false);
    }
  };

  const fetchSeatsQuote = useCallback(async (count) => {
    const num = Math.max(1, parseInt(count, 10) || 1);
    setSeatsQuoteLoading(true);
    setSeatsQuoteError('');
    try {
      const res = await dataService.quoteSaasExtraSeats(num);
      setSeatsQuote(res.quote || null);
      if (res.defaultPaymentMethod) {
        setSeatsPaymentChoice('saved_card');
      } else {
        setSeatsPaymentChoice('cardnet');
      }
    } catch (err) {
      setSeatsQuote(null);
      setSeatsQuoteError(err.message || 'No se pudo cotizar los usuarios adicionales.');
    } finally {
      setSeatsQuoteLoading(false);
    }
  }, []);

  const handleOpenExtraUsersModal = async () => {
    setExtraSeatsToBuy(1);
    setSeatsQuoteError('');
    setShowExtraUsersModal(true);
    await fetchSeatsQuote(1);
  };

  const handleContractExtraSeats = async (e) => {
    e.preventDefault();
    try {
      setContractingSeats(true);
      setSeatsQuoteError('');
      setError(null);
      const res = await dataService.contractSaasExtraSeats({
        additionalSeats: extraSeatsToBuy,
        paymentMethodChoice: seatsPaymentChoice,
      });
      if (res.paid && res.activated) {
        setSuccessMsg(res.message || 'Usuarios adicionales contratados y activados con éxito.');
        setShowExtraUsersModal(false);
        await Promise.all([loadBillingData(), refetchEntitlements()]);
        return;
      }
      if (res.needsCheckout && res.checkout && res.order) {
        await executeCardnetCheckout({
          orderId: res.order.id,
          order: res.order,
          checkout: res.checkout,
          onCheckoutOpening: () => {
            setShowExtraUsersModal(false);
          },
          onVerifying: () => {},
          onActivated: async () => {
            setSuccessMsg('¡Pago verificado y usuarios adicionales activados!');
            setShowExtraUsersModal(false);
            await Promise.all([loadBillingData(), refetchEntitlements()]);
          },
          onError: (errMsg) => {
            setSeatsQuoteError('Error en pago CardNet: ' + errMsg);
            setError('Error en pago CardNet: ' + errMsg);
          },
          onCheckoutClosed: async () => {
            await Promise.all([loadBillingData(), refetchEntitlements()]);
          },
        });
      }
    } catch (err) {
      setSeatsQuoteError(err.message || 'No se pudo contratar usuarios adicionales.');
    } finally {
      setContractingSeats(false);
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
        // Desmontar el modal local antes de abrir el iframe oficial de CardNet para evitar superposición
        setShowAddCardModal(false);
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
    if (cancelInFlightRef.current || canceling) return;
    cancelInFlightRef.current = true;
    try {
      setCanceling(true);
      setCancelError('');
      setError(null);
      const res = await dataService.cancelSaasSubscription(cancelReason.trim() || undefined);
      setSubscription((prev) => ({
        ...(prev || {}),
        status: res?.status || 'cancelled',
        current_period_end: res?.accessUntil !== undefined ? res.accessUntil : prev?.current_period_end,
        cancelled_at: res?.cancelledAt || new Date().toISOString(),
      }));
      const effectiveLabel = res?.accessUntil ? formatDateEs(res.accessUntil) : 'inmediata';
      setSuccessMsg(
        res?.message ||
        `Cancelación confirmada (vigencia: ${effectiveLabel}).`
      );
      setShowCancelModal(false);
      setCancelReason('');
      await Promise.all([loadBillingData(), refetchEntitlements()]);
    } catch (err) {
      const msg = err.message || 'No se pudo procesar la solicitud de cancelación.';
      setCancelError(msg);
      setError(msg);
    } finally {
      setCanceling(false);
      cancelInFlightRef.current = false;
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
    subscription?.current_period_end || subscription?.next_billing_date || renewalQuote?.nextChargeDate
  );
  const cancelAtPeriodEnd = Boolean(subscription?.cancel_at_period_end);
  const isSubscriptionCancelled = status === 'canceled' || status === 'cancelled' || cancelAtPeriodEnd;

  const branchesUsed = entitlements?.usage?.branches ?? 0;
  const branchesLimit = Number(entitlements?.limits?.branches ?? subscription?.branches_count ?? 1) || 1;
  const usersUsed = entitlements?.usage?.users ?? 0;
  const usersLimit = Number(entitlements?.limits?.users ?? 3) || 3;
  const usersIncludedPerBranch = 3;
  const extraUsersCount = Math.max(
    0,
    Number(
      subscription?.extra_users_count !== undefined && subscription?.extra_users_count !== null
        ? subscription.extra_users_count
        : Math.max(0, usersLimit - branchesLimit * usersIncludedPerBranch)
    ) || 0
  );
  const addonBlocksCount = Math.max(
    0,
    Number(
      membershipsAddon?.acquiredBlocks ??
      subscription?.addon_blocks_count ??
      (membershipsAddon?.enabled ? Math.ceil(Math.max(1, membershipsAddon?.branchIds?.length || 1) / 3) : 0)
    ) || 0
  );

  const branchUnitUsd = Number(
    activePricing?.principal?.usd ??
    (hasRealSubPrice && currency === 'USD' ? Number(subscription.price_minor) / 100 : 99)
  );
  const extraUserUnitUsd = Number(activePricing?.principal?.extraUserUsd ?? 30);
  const addonBlockUnitUsd = Number(activePricing?.addons?.memberships?.usd ?? 99);

  const branchesMonthlyUsd = Number((branchesLimit * branchUnitUsd).toFixed(2));
  const extraUsersMonthlyUsd = Number((extraUsersCount * extraUserUnitUsd).toFixed(2));
  const addonMonthlyUsd = Number((addonBlocksCount * addonBlockUnitUsd).toFixed(2));
  const totalMonthlyUsd = Number((branchesMonthlyUsd + extraUsersMonthlyUsd + addonMonthlyUsd).toFixed(2));

  const formatUsdClean = (val) => {
    const num = Number(val || 0);
    return Number.isInteger(num)
      ? `US$${num.toLocaleString('en-US')}`
      : `US$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const defaultPm = paymentMethods.find((pm) => pm.isDefault) || paymentMethods[0] || null;

  // Estado real de renovación automática derivado del servidor (sin preferencia del frontend)
  const customerAuthorized = Boolean(
    renewalState
      ? renewalState.customerAuthorized
      : (!isSubscriptionCancelled && subscription?.auto_renew !== false && subscription?.recurring_consent_at && subscription?.recurring_consent_version)
  );
  const requiresConditionAcceptance = Boolean(renewalState?.requiresConditionAcceptance);
  const hasEligiblePaymentMethod = Boolean(
    renewalState !== null && renewalState !== undefined
      ? renewalState.hasEligiblePaymentMethod
      : defaultPm
  );
  const billingServiceAvailable = Boolean(renewalState?.serviceAvailable);
  const effectiveRenewalStatus = (() => {
    if (isSubscriptionCancelled || renewalState?.isCancelled) return 'cancelled';
    if (renewalState?.effectiveStatus) return renewalState.effectiveStatus;
    if (!customerAuthorized) return 'missing_consent';
    if (requiresConditionAcceptance) return 'condition_change_pending';
    if (!hasEligiblePaymentMethod) return 'missing_payment_method';
    if (!billingServiceAvailable) return 'authorized_service_inactive';
    return 'active';
  })();

  const renewalBadgeMeta = (() => {
    switch (effectiveRenewalStatus) {
      case 'active':
        return { label: 'Renovación automática activa', badgeClass: 'sb-badge-active' };
      case 'authorized_service_inactive':
        return { label: 'Autorizada · Servicio de cobro en espera', badgeClass: 'sb-badge-neutral' };
      case 'missing_payment_method':
        return { label: 'Método de pago no disponible', badgeClass: 'sb-badge-warning' };
      case 'condition_change_pending':
        return { label: 'Requiere aceptar condiciones', badgeClass: 'sb-badge-warning' };
      case 'missing_consent':
        return { label: 'Sin autorización automática', badgeClass: 'sb-badge-neutral' };
      case 'cancelled':
      default:
        return { label: 'Renovación desactivada', badgeClass: 'sb-badge-neutral' };
    }
  })();

  const realRenewalSummaryText = (() => {
    switch (effectiveRenewalStatus) {
      case 'active':
        return 'Renovación automática activa (autorización del cliente vigente, método de pago apto y servicio de cobro habilitado).';
      case 'authorized_service_inactive':
        return 'Autorización del cliente y método de pago apto registrados; el servicio de cobro automático no está habilitado.';
      case 'missing_payment_method':
        return 'Autorización del cliente registrada, pero no hay un método de pago reutilizable apto disponible.';
      case 'condition_change_pending':
        return 'Renovación en pausa hasta aceptar la actualización de condiciones vigente.';
      case 'missing_consent':
        return 'Cobro manual — no existe consentimiento de renovación automática registrado.';
      case 'cancelled':
      default:
        return 'Renovación automática desactivada — no se realizarán cargos recurrentes futuros.';
    }
  })();

  const contractedPeriodicityLabel = (() => {
    if (subscription?.billing_cycle === 'annual') return 'Anual';
    const mode = renewalState?.periodicityMode || subscription?.periodicity_mode || renewalQuote?.periodicityMode;
    if (mode === 'calendar_month') return 'Mensual (mes calendario)';
    return 'Mensual (ciclo de 30 días)';
  })();

  const estimatedChargeDisplay = renewalQuote?.totalDopMinor !== undefined && renewalQuote?.totalDopMinor !== null
    ? `${formatMinor(renewalQuote.totalDopMinor, 'DOP')} DOP`
    : (formattedPrice ? `${formattedPrice} ${currency}` : 'Según acuerdo comercial');

  const dependsOnFxConversion = Boolean(
    renewalQuote?.fxSnapshot ||
    renewalQuote?.currency === 'DOP' ||
    currency === 'USD'
  );

  const maskedPaymentMethodLabel = defaultPm
    ? `${String(defaultPm.brand || 'Tarjeta').toUpperCase()} •••• ${defaultPm.last4}`
    : null;

  const handleSubmitRecurringAuthorization = async (e) => {
    e.preventDefault();
    if (!recurringConsentChecked || authorizingRenewal) return;
    try {
      setAuthorizingRenewal(true);
      setError(null);
      const targetVersion = renewalState?.requiredTermsVersion || 'v2026.1';
      const res = await fetch('/api/saas/billing/renewal/authorize', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorize_recurring: true,
          consent_version: targetVersion,
          accept_calendar_migration: false,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo registrar la autorización.');
      setSuccessMsg('Autorización de cobro recurrente registrada.');
      setShowConsentModal(false);
      setShowConditionChangeModal(false);
      setRecurringConsentChecked(false);
      await loadBillingData();
    } catch (err) {
      setError(err.message || 'No se pudo registrar la autorización.');
    } finally {
      setAuthorizingRenewal(false);
    }
  };
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
                  Resumen de tu suscripción
                </h2>
                <span className={`sb-badge ${statusMeta.badgeClass}`}>
                  {statusMeta.label}
                </span>
              </div>
            </div>

            <div className="sb-price-line">
              <span className="sb-price-amount">{formatUsdClean(totalMonthlyUsd)}</span>
              <span className="sb-price-period">
                / {subscription?.billing_cycle === 'annual' ? 'año' : 'mes'}
              </span>
            </div>

            <div
              style={{
                marginTop: '12px',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 14px',
                  borderBottom: '1px solid #e2e8f0',
                }}
              >
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                    {branchesLimit} {branchesLimit === 1 ? 'sucursal' : 'sucursales'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                    {formatUsdClean(branchUnitUsd)} por sucursal · {usersIncludedPerBranch} usuarios incluidos por sucursal
                  </div>
                </div>
                <strong style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' }}>
                  {formatUsdClean(branchesMonthlyUsd)}
                </strong>
              </div>

              {extraUsersCount > 0 && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 14px',
                    borderBottom: '1px solid #e2e8f0',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                      {extraUsersCount} {extraUsersCount === 1 ? 'usuario adicional' : 'usuarios adicionales'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                      {formatUsdClean(extraUserUnitUsd)} por usuario adicional
                    </div>
                  </div>
                  <strong style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' }}>
                    {formatUsdClean(extraUsersMonthlyUsd)}
                  </strong>
                </div>
              )}

              {addonBlocksCount > 0 && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 14px',
                    borderBottom: '1px solid #e2e8f0',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                      Módulo de membresías
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                      Incluye hasta {addonBlocksCount * 3} sucursales{addonBlocksCount > 1 ? ` (${addonBlocksCount} bloques)` : ''}
                    </div>
                  </div>
                  <strong style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' }}>
                    {formatUsdClean(addonMonthlyUsd)}
                  </strong>
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '11px 14px',
                  background: '#f8fafc',
                }}
              >
                <span style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                  Total mensual
                </span>
                <strong style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
                  {formatUsdClean(totalMonthlyUsd)}
                </strong>
              </div>
            </div>

            <p className="sb-meta-text" style={{ marginTop: '10px' }}>
              Plan Principal · Incluye POS, cajas, facturación y gestión de comprobantes, Clientes/CRM, inventario avanzado, nómina, comisiones, marketing y reportes. Integración de facturación electrónica DGII: contratación y habilitación por separado.
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
              <span className={`sb-badge ${renewalBadgeMeta.badgeClass}`}>
                {renewalBadgeMeta.label}
              </span>
            </div>

            <div className="sb-price-line" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <span className="sb-price-amount" style={{ fontSize: '26px' }}>
                {nextBillingFormatted || 'Sin fecha programada'}
              </span>
              <span style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                {estimatedChargeDisplay}
              </span>
            </div>

            {dependsOnFxConversion && (
              <p className="sb-meta-text" style={{ marginTop: '2px', fontSize: '12.5px' }}>
                El importe en pesos se calcula con la tasa aplicable al emitir el cobro.
              </p>
            )}

            <div className="sb-kv-list" style={{ marginTop: '12px' }}>
              <div className="sb-kv-row">
                <span className="sb-kv-label">Periodicidad contratada</span>
                <span className="sb-kv-value">{contractedPeriodicityLabel}</span>
              </div>
              <div className="sb-kv-row">
                <span className="sb-kv-label">Método de pago</span>
                <span className="sb-kv-value">
                  {maskedPaymentMethodLabel || (latestApprovedOrder?.masked_card
                    ? `No disponible (${latestApprovedOrder.masked_card} fue pago único)`
                    : 'No disponible')}
                </span>
              </div>
              <div className="sb-kv-row">
                <span className="sb-kv-label">Autorización del cliente</span>
                <span className="sb-kv-value">
                  {isSubscriptionCancelled
                    ? 'Desactivada por cancelación'
                    : requiresConditionAcceptance
                      ? `Requiere aceptar actualización (${renewalState?.requiredTermsVersion || 'v2026.1'})`
                      : customerAuthorized
                        ? `Autorizada (${renewalState?.consentVersion || subscription?.recurring_consent_version || 'v2026.1'})`
                        : 'Sin consentimiento registrado'}
                </span>
              </div>
              <div className="sb-kv-row">
                <span className="sb-kv-label">Servicio de cobro automático</span>
                <span className="sb-kv-value">
                  {billingServiceAvailable ? 'Disponible' : 'No habilitado'}
                </span>
              </div>
            </div>

            <p className="sb-meta-text" style={{ marginTop: '10px' }}>
              {realRenewalSummaryText}
            </p>

            {Array.isArray(renewalQuote?.lineItems) && renewalQuote.lineItems.length > 0 && (
              <div style={{ marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowChargeBreakdown((prev) => !prev)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: '#2563eb',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  {showChargeBreakdown ? 'Ocultar desglose' : 'Ver desglose'}
                </button>

                {showChargeBreakdown && (
                  <div
                    className="sb-kv-list"
                    style={{
                      marginTop: '8px',
                      padding: '10px 12px',
                      borderRadius: '10px',
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    {renewalQuote.lineItems.map((it, idx) => (
                      <div className="sb-kv-row" key={idx}>
                        <span className="sb-kv-label">{it.description}</span>
                        <span className="sb-kv-value">
                          {formatMinor(it.amount_minor, 'DOP')} DOP
                        </span>
                      </div>
                    ))}
                    <div className="sb-kv-row">
                      <span className="sb-kv-label" style={{ fontWeight: 700, color: '#0f172a' }}>
                        Importe estimado
                      </span>
                      <span className="sb-kv-value" style={{ fontWeight: 800 }}>
                        {formatMinor(renewalQuote.totalDopMinor, 'DOP')} DOP
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!isSubscriptionCancelled && (!customerAuthorized || requiresConditionAcceptance) && (
              <div className="sb-card-actions" style={{ marginTop: '12px' }}>
                {!customerAuthorized && (
                  <button
                    type="button"
                    className="sb-btn"
                    onClick={() => {
                      setRecurringConsentChecked(false);
                      setShowConsentModal(true);
                    }}
                  >
                    Autorizar renovación automática
                  </button>
                )}
                {customerAuthorized && requiresConditionAcceptance && (
                  <button
                    type="button"
                    className="sb-btn"
                    onClick={() => {
                      setRecurringConsentChecked(false);
                      setShowConditionChangeModal(true);
                    }}
                  >
                    Revisar actualización de condiciones
                  </button>
                )}
              </div>
            )}
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
                <span className="sb-kv-label">Usuarios facturables</span>
                <span className="sb-kv-value">
                  {usersUsed} de {usersLimit} usuarios facturables
                </span>
              </div>
              {Number(entitlements?.usage?.exemptKioskUsers || 0) > 0 && (
                <div className="sb-kv-row">
                  <span className="sb-kv-label">Cuentas exentas (Kiosco)</span>
                  <span className="sb-kv-value">
                    {entitlements.usage.exemptKioskUsers} (sin consumo de licencia)
                  </span>
                </div>
              )}
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
            <button
              type="button"
              className="sb-btn sb-btn-primary"
              onClick={handleOpenExtraUsersModal}
            >
              <span>+ Contratar usuarios adicionales</span>
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
                  {effectiveRenewalStatus === 'active'
                    ? 'Tarjeta registrada con la pasarela y habilitada para renovación automática.'
                    : 'Tarjeta registrada con la pasarela. No se realizan cobros automáticos mientras el servicio o la autorización no estén activos.'}
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
              Actualizar método de pago
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
            <p className="sb-meta-text" style={{ margin: '4px 0 0', fontWeight: 700, color: '#0f172a' }}>
              US$99/mes por bloque de capacidad de hasta 3 sucursales habilitadas (1–3 sucursales: US$99/mes · 4–6: US$198/mes · 7–9: US$297/mes) + implementación e integración con pasarela de pago por separado.
            </p>

            {/* Resumen de Capacidad Adquirida, Utilizada y Disponible */}
            <div
              data-testid="memberships-addon-capacity-summary"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '12px',
                marginTop: '8px',
                padding: '8px 12px',
                borderRadius: '10px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                fontSize: '12.5px',
                color: '#334155',
              }}
            >
              <span>
                <strong>Capacidad adquirida:</strong>{' '}
                {Number(membershipsAddon?.acquiredBranchCapacity || 0)} sucursales ({Number(membershipsAddon?.acquiredBlocks || 0)} {Number(membershipsAddon?.acquiredBlocks || 0) === 1 ? 'bloque' : 'bloques'})
              </span>
              <span>·</span>
              <span>
                <strong>Capacidad utilizada:</strong>{' '}
                {Number(membershipsAddon?.usedBranchCapacity || membershipsAddon?.enabledBranchCount || 0)} sucursales
              </span>
              <span>·</span>
              <span>
                <strong>Capacidad disponible:</strong>{' '}
                {Number(membershipsAddon?.availableBranchCapacity || 0)} sucursales
              </span>
            </div>

            {hasMembershipsAddon && isLegacyTransition && (
              <p className="sb-meta-text" style={{ margin: '6px 0 0', color: '#92400e', fontWeight: 600 }}>
                Procedencia: {membershipsAddon?.reason || 'Permiso heredado de transición'} · Vigencia:{' '}
                {membershipsAddon?.expiresAt
                  ? new Date(membershipsAddon.expiresAt).toLocaleDateString('es-DO')
                  : 'Sin fecha de expiración definida'} (se respetan condiciones previas sin modificar retroactivamente facturas ni autorizaciones).
              </p>
            )}
            {hasMembershipsAddon && Array.isArray(membershipsAddon?.branches) && membershipsAddon.branches.length > 0 && (
              <p className="sb-meta-text" style={{ margin: '6px 0 0', color: '#047857', fontWeight: 600 }}>
                Sucursales habilitadas ({membershipsAddon.branches.length}): {membershipsAddon.branches.map(b => b.name).join(', ')}
              </p>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          {hasMembershipsAddon ? (
            <>
              <button
                type="button"
                className="sb-btn"
                onClick={handleOpenAddonModal}
              >
                Gestionar sucursales / Capacidad
              </button>
              <button
                type="button"
                className="sb-btn sb-btn-primary"
                onClick={() => navigate('/planes')}
              >
                Configurar módulo
              </button>
            </>
          ) : (
            <button
              type="button"
              className="sb-btn sb-btn-primary"
              onClick={handleOpenAddonModal}
            >
              <Sparkles size={15} />
              <span>Contratar Add-on Membresías</span>
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

      {/* Add-on Contracting & Capacity Assignment Modal (Blocks of up to 3 branches) */}
      {showAddonModal && (
        <div
          className="sb-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sb-addon-modal-title"
        >
          <div className="sb-modal-card" style={{ maxWidth: '580px' }}>
            <div className="sb-modal-header">
              <h3 id="sb-addon-modal-title">
                {hasMembershipsAddon ? 'Gestionar sucursales y capacidad de Membresías' : 'Contratar Add-on Suscripciones y Membresías B2C'}
              </h3>
              <button
                type="button"
                className="sb-modal-close"
                onClick={() => setShowAddonModal(false)}
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>

            <p className="sb-meta-text" style={{ marginBottom: '10px' }}>
              Habilita planes mensuales de membresía B2C, contratos digitales y cobros recurrentes en las sucursales con licencia principal que elijas.
            </p>
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '10px 12px', marginBottom: '14px', fontSize: '12.5px', color: '#1e40af', lineHeight: 1.45 }}>
              <strong>Regla de bloques de capacidad:</strong> <strong>US$99/mes por bloque de hasta 3 sucursales habilitadas</strong> (1 a 3 sucursales = US$99/mes · 4 a 6 sucursales = US$198/mes · 7 a 9 sucursales = US$297/mes). La implementación y pasarela B2C se cotizan por separado.
            </div>

            <form onSubmit={handleRequestAddon}>
              <div className="sb-field" style={{ marginBottom: '14px' }}>
                <label>Elige las sucursales con licencia que usarán Membresías ({selectedBranchIds.length} seleccionadas)</label>
                {branches.length === 0 ? (
                  <p className="sb-meta-text" style={{ margin: '6px 0 0' }}>
                    No se detectaron sucursales activas.
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
                      maxHeight: '200px',
                      overflowY: 'auto',
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
                          <span style={{ fontSize: '0.78rem', color: '#047857', fontWeight: 700 }}>
                            Licencia principal activa
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {addonQuoteError && (
                <div className="sb-alert sb-alert-error" role="alert" style={{ marginBottom: '12px' }}>
                  <AlertCircle size={16} />
                  <span>{addonQuoteError}</span>
                </div>
              )}

              {addonQuoteLoading ? (
                <div style={{ padding: '14px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                  Calculando bloques de capacidad y cotización...
                </div>
              ) : addonQuote ? (
                <div
                  style={{
                    border: '1px solid #cbd5e1',
                    borderRadius: '10px',
                    padding: '12px',
                    background: '#ffffff',
                    marginBottom: '14px',
                    fontSize: '0.86rem',
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
                    Cotización por bloques de capacidad (hasta 3 sucursales por bloque)
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', color: '#334155' }}>
                    <span>Capacidad actual adquirida</span>
                    <strong>{addonQuote.currentAcquiredCapacity} sucursales ({addonQuote.currentAcquiredBlocks} {addonQuote.currentAcquiredBlocks === 1 ? 'bloque' : 'bloques'})</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', color: '#334155' }}>
                    <span>Sucursales seleccionadas (utilizadas)</span>
                    <strong>{addonQuote.selectedBranchesCount} de {addonQuote.newAcquiredCapacity} sucursales</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', color: '#334155' }}>
                    <span>Capacidad disponible resultante</span>
                    <strong>{addonQuote.newAvailableCapacity} sucursales libres</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', color: '#334155' }}>
                    <span>Bloques requeridos ({Math.ceil(addonQuote.selectedBranchesCount / 3)} × US${addonQuote.blockMonthlyUsd}/mes)</span>
                    <strong>US${addonQuote.newAddonMonthlyUsd}/mes</strong>
                  </div>

                  {addonQuote.withinAcquiredCapacity ? (
                    <div style={{ marginTop: '8px', padding: '8px 10px', borderRadius: '8px', background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', fontWeight: 700, fontSize: '12.5px' }}>
                      ✓ Cubierto por tu capacidad ya adquirida ({addonQuote.currentAcquiredBlocks} {addonQuote.currentAcquiredBlocks === 1 ? 'bloque' : 'bloques'} = hasta {addonQuote.currentAcquiredCapacity} sucursales). Costo adicional hoy: US$0.00.
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '6px', borderTop: '1px solid #e2e8f0', marginTop: '6px', color: '#0f172a' }}>
                        <span>Bloques adicionales a contratar hoy (+{addonQuote.additionalBlocksToBuy} {addonQuote.additionalBlocksToBuy === 1 ? 'bloque' : 'bloques'}, prorrateo {addonQuote.remainingDays} días)</span>
                        <strong>{formatMinor(addonQuote.totalUsdMinor, 'USD')}</strong>
                      </div>
                      {addonQuote.totalDopMinor !== undefined && addonQuote.totalDopMinor !== null && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', color: '#475569', fontSize: '12px' }}>
                          <span>Total a cobrar hoy en DOP</span>
                          <strong style={{ color: '#0f172a', fontSize: '14px' }}>{formatMinor(addonQuote.totalDopMinor, 'DOP')} DOP</strong>
                        </div>
                      )}

                      <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '6px', textTransform: 'uppercase' }}>
                          Método de pago para confirmar contratación
                        </div>
                        {defaultPm ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', cursor: 'pointer' }}>
                              <input
                                type="radio"
                                name="addonPmChoice"
                                value="saved_card"
                                checked={addonPaymentChoice === 'saved_card'}
                                onChange={() => setAddonPaymentChoice('saved_card')}
                              />
                              <span>Tarjeta guardada: {String(defaultPm.brand || 'CARD').toUpperCase()} •••• {defaultPm.last4}</span>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', cursor: 'pointer' }}>
                              <input
                                type="radio"
                                name="addonPmChoice"
                                value="cardnet"
                                checked={addonPaymentChoice === 'cardnet'}
                                onChange={() => setAddonPaymentChoice('cardnet')}
                              />
                              <span>Pagar con otra tarjeta vía pasarela CardNet</span>
                            </label>
                          </div>
                        ) : (
                          <div style={{ fontSize: '12px', color: '#475569' }}>
                            Se abrirá la pasarela oficial CardNet para completar el pago.
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ) : null}

              <div className="sb-modal-footer">
                <button
                  type="button"
                  className="sb-btn"
                  onClick={() => {
                    setShowAddonModal(false);
                  }}
                  disabled={requestingAddon}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="sb-btn sb-btn-primary"
                  disabled={requestingAddon || addonQuoteLoading || selectedBranchIds.length === 0}
                >
                  {requestingAddon
                    ? 'Procesando...'
                    : addonQuote?.withinAcquiredCapacity
                      ? 'Guardar sucursales asignadas (Sin cargo)'
                      : addonQuote
                        ? `Confirmar y contratar (${formatMinor(addonQuote.totalDopMinor, 'DOP')})`
                        : 'Confirmar contratación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Extra User Seats Contracting Modal */}
      {showExtraUsersModal && (
        <div
          className="sb-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sb-extra-users-modal-title"
        >
          <div className="sb-modal-card" style={{ maxWidth: '520px' }}>
            <div className="sb-modal-header">
              <h3 id="sb-extra-users-modal-title">Contratar usuarios adicionales</h3>
              <button
                type="button"
                className="sb-modal-close"
                onClick={() => !contractingSeats && setShowExtraUsersModal(false)}
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>

            <p className="sb-meta-text" style={{ marginBottom: '12px' }}>
              Cada licencia de sucursal incluye 3 usuarios facturables. Puedes ampliar tu capacidad contratando asientos de usuario adicionales (+US$30/mes por usuario).
            </p>

            <form onSubmit={handleContractExtraSeats}>
              <div className="sb-field" style={{ marginBottom: '14px' }}>
                <label htmlFor="sb-extra-seats-input">Cantidad de usuarios adicionales a contratar</label>
                <input
                  id="sb-extra-seats-input"
                  type="number"
                  min={1}
                  max={50}
                  className="sb-input"
                  value={extraSeatsToBuy}
                  onChange={(e) => {
                    const val = Math.max(1, parseInt(e.target.value, 10) || 1);
                    setExtraSeatsToBuy(val);
                    fetchSeatsQuote(val);
                  }}
                />
              </div>

              {seatsQuoteError && (
                <div className="sb-alert sb-alert-error" role="alert" style={{ marginBottom: '12px' }}>
                  <AlertCircle size={16} />
                  <span>{seatsQuoteError}</span>
                </div>
              )}

              {seatsQuoteLoading ? (
                <div style={{ padding: '12px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                  Calculando cotización prorrateada...
                </div>
              ) : seatsQuote ? (
                <div style={{ border: '1px solid #cbd5e1', borderRadius: '10px', padding: '12px', background: '#f8fafc', marginBottom: '14px', fontSize: '0.86rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span>Capacidad actual de usuarios</span>
                    <strong>{seatsQuote.currentMaxUsers} usuarios</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span>Nueva capacidad tras contratar (+{seatsQuote.additionalSeats})</span>
                    <strong>{seatsQuote.newMaxUsers} usuarios</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span>Importe prorrateado ({seatsQuote.remainingDays} días restantes)</span>
                    <strong>{formatMinor(seatsQuote.totalUsdMinor, 'USD')}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '6px', borderTop: '1px solid #e2e8f0', marginTop: '6px' }}>
                    <strong>Total a cobrar hoy</strong>
                    <strong>{formatMinor(seatsQuote.totalDopMinor, 'DOP')} DOP</strong>
                  </div>
                </div>
              ) : null}

              <div className="sb-modal-footer">
                <button
                  type="button"
                  className="sb-btn"
                  onClick={() => setShowExtraUsersModal(false)}
                  disabled={contractingSeats}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="sb-btn sb-btn-primary"
                  disabled={contractingSeats || seatsQuoteLoading || !seatsQuote}
                >
                  {contractingSeats ? 'Procesando...' : 'Confirmar y contratar'}
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
                onClick={() => {
                  if (!canceling) {
                    setCancelError('');
                    setShowCancelModal(false);
                  }
                }}
                disabled={canceling}
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>

            {status === 'cancelled' ? (
              <div style={{ padding: '12px 14px', borderRadius: '10px', background: '#f8fafc', border: '1px solid #e2e8f0', marginBottom: '16px', fontSize: '0.88rem', color: '#334155' }}>
                <strong>Esta suscripción ya está cancelada.</strong>
                {subscription?.current_period_end && (
                  <div style={{ marginTop: '4px' }}>
                    Acceso restante hasta: <strong>{formatDateEs(subscription.current_period_end)}</strong>.
                  </div>
                )}
              </div>
            ) : (
              <div style={{ padding: '12px 14px', borderRadius: '10px', background: '#f8fafc', border: '1px solid #e2e8f0', marginBottom: '16px', fontSize: '0.88rem', color: '#334155', lineHeight: 1.55 }}>
                <div>
                  Al confirmar, la renovación automática y futuros cargos recurrentes se desactivarán de inmediato conforme a los términos aceptados.
                </div>
                <div style={{ marginTop: '8px' }}>
                  <strong>Fecha efectiva:</strong>{' '}
                  {['pending', 'suspended', 'past_due'].includes(status)
                    ? 'Inmediata (se detienen futuros reintentos de cobro; las facturas ya devengadas se mantienen por separado).'
                    : (subscription?.current_period_end
                        ? `Fin del ciclo actual — acceso restante hasta el ${formatDateEs(subscription.current_period_end)}.`
                        : 'Inmediata.')}
                </div>
              </div>
            )}

            {cancelError && (
              <div
                role="alert"
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#b91c1c',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  marginBottom: '14px',
                }}
              >
                {cancelError}
              </div>
            )}

            <form onSubmit={handleCancelSubscription}>
              <div className="sb-field">
                <label htmlFor="sb-cancel-reason">Motivo (opcional)</label>
                <textarea
                  id="sb-cancel-reason"
                  rows={3}
                  className="sb-input"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  disabled={canceling || status === 'cancelled'}
                  placeholder="Cuéntanos brevemente el motivo de tu solicitud..."
                />
              </div>

              <div className="sb-modal-footer">
                <button
                  type="button"
                  className="sb-btn"
                  onClick={() => {
                    setCancelError('');
                    setShowCancelModal(false);
                  }}
                  disabled={canceling}
                >
                  Volver
                </button>
                {status !== 'cancelled' && (
                  <button
                    type="submit"
                    className="sb-btn"
                    style={{ borderColor: '#fecaca', color: '#dc2626', background: '#fef2f2' }}
                    disabled={canceling}
                  >
                    {canceling ? 'Procesando...' : 'Confirmar cancelación'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Flujo contextual único para cuentas existentes sin consentimiento válido */}
      {showConsentModal && (
        <div
          className="sb-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sb-consent-modal-title"
        >
          <div className="sb-modal-card">
            <div className="sb-modal-header">
              <h3 id="sb-consent-modal-title">Autorizar renovación automática</h3>
              <button
                type="button"
                className="sb-modal-close"
                onClick={() => {
                  if (!authorizingRenewal) {
                    setShowConsentModal(false);
                    setRecurringConsentChecked(false);
                  }
                }}
                disabled={authorizingRenewal}
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>

            <p className="sb-meta-text" style={{ marginBottom: '12px' }}>
              Esta autorización se registra una sola vez para tu suscripción actual ({contractedPeriodicityLabel}, importe estimado {estimatedChargeDisplay}). El importe en pesos se calcula con la tasa aplicable al emitir el cobro.
            </p>

            <form onSubmit={handleSubmitRecurringAuthorization}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '12px',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  fontSize: '13.5px',
                  color: '#0f172a',
                  cursor: 'pointer',
                  lineHeight: 1.5,
                }}
              >
                <input
                  type="checkbox"
                  checked={recurringConsentChecked}
                  onChange={(e) => setRecurringConsentChecked(e.target.checked)}
                />
                <span>
                  Autorizo de forma expresa el cobro recurrente automático de mi suscripción conforme a los términos aceptados ({renewalState?.requiredTermsVersion || 'v2026.1'}). Puedo cancelar en cualquier momento desde Mi suscripción.
                </span>
              </label>

              <div className="sb-modal-footer">
                <button
                  type="button"
                  className="sb-btn"
                  onClick={() => {
                    setShowConsentModal(false);
                    setRecurringConsentChecked(false);
                  }}
                  disabled={authorizingRenewal}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="sb-btn sb-btn-primary"
                  disabled={authorizingRenewal || !recurringConsentChecked}
                >
                  {authorizingRenewal ? 'Guardando...' : 'Guardar autorización'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Flujo específico cuando cambia una condición que requiere aceptación */}
      {showConditionChangeModal && (
        <div
          className="sb-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sb-condition-modal-title"
        >
          <div className="sb-modal-card">
            <div className="sb-modal-header">
              <h3 id="sb-condition-modal-title">Actualización de condiciones de suscripción</h3>
              <button
                type="button"
                className="sb-modal-close"
                onClick={() => {
                  if (!authorizingRenewal) {
                    setShowConditionChangeModal(false);
                    setRecurringConsentChecked(false);
                  }
                }}
                disabled={authorizingRenewal}
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>

            <p className="sb-meta-text" style={{ marginBottom: '12px' }}>
              Existe una actualización en las condiciones de renovación ({renewalState?.requiredTermsVersion || 'v2026.1'}). Tu periodicidad contratada ({contractedPeriodicityLabel}) se conserva sin cambios.
            </p>

            <form onSubmit={handleSubmitRecurringAuthorization}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '12px',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  fontSize: '13.5px',
                  color: '#0f172a',
                  cursor: 'pointer',
                  lineHeight: 1.5,
                }}
              >
                <input
                  type="checkbox"
                  checked={recurringConsentChecked}
                  onChange={(e) => setRecurringConsentChecked(e.target.checked)}
                />
                <span>
                  Acepto la actualización de condiciones ({renewalState?.requiredTermsVersion || 'v2026.1'}) manteniendo mi autorización de cobro recurrente.
                </span>
              </label>

              <div className="sb-modal-footer">
                <button
                  type="button"
                  className="sb-btn"
                  onClick={() => {
                    setShowConditionChangeModal(false);
                    setRecurringConsentChecked(false);
                  }}
                  disabled={authorizingRenewal}
                >
                  Cerrar
                </button>
                <button
                  type="submit"
                  className="sb-btn sb-btn-primary"
                  disabled={authorizingRenewal || !recurringConsentChecked}
                >
                  {authorizingRenewal ? 'Guardando...' : 'Aceptar actualización'}
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
                  <span className="sb-kv-label">Precio (USD)</span>
                  <span className="sb-kv-value">
                    {formatMinor(selectedInvoice.fx_snapshot.usd.total_minor, 'USD')}
                  </span>
                </div>
              )}
              <div className="sb-kv-row">
                <span className="sb-kv-label">Impuestos</span>
                <span className="sb-kv-value">
                  {formatMinor(
                    selectedInvoice.fx_snapshot?.usd?.tax_minor ?? selectedInvoice.tax_minor ?? 0,
                    selectedInvoice.fx_snapshot?.usd ? 'USD' : selectedInvoice.currency
                  )}
                </span>
              </div>
              <div className="sb-kv-row">
                <span className="sb-kv-label">Total cobrado</span>
                <span className="sb-kv-value" style={{ fontWeight: 700 }}>
                  {formatMinor(
                    selectedInvoice.fx_snapshot?.usd?.total_minor ?? selectedInvoice.total_minor,
                    selectedInvoice.fx_snapshot?.usd ? 'USD' : selectedInvoice.currency
                  )}
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
