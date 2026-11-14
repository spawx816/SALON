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
import './SaasBillingModule.css';

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
  const [requestingAddon, setRequestingAddon] = useState(false);

  const [showAddCardModal, setShowAddCardModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  const [payingInvoiceId, setPayingInvoiceId] = useState(null);
  const [cardLast4, setCardLast4] = useState('');
  const [cardBrand, setCardBrand] = useState('visa');
  const [cardExpMonth, setCardExpMonth] = useState('12');
  const [cardExpYear, setCardExpYear] = useState(String(new Date().getFullYear() + 3));
  const [savingCard, setSavingCard] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [canceling, setCanceling] = useState(false);

  const loadBillingData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [subRes, invRes, pmRes] = await Promise.all([
        dataService.getSaasSubscription(),
        dataService.getSaasInvoices(),
        dataService.getSaasPaymentMethods(),
      ]);

      setSubscription(subRes?.subscription || null);
      setSubPricing(subRes?.pricing || null);
      setInvoices(Array.isArray(invRes?.invoices) ? invRes.invoices : []);
      setPaymentMethods(Array.isArray(pmRes?.paymentMethods) ? pmRes.paymentMethods : []);
    } catch (err) {
      setError(err.message || 'Error al cargar la información de suscripción');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBillingData();
  }, [loadBillingData]);

  const handleRequestAddon = async (e) => {
    e.preventDefault();
    try {
      setRequestingAddon(true);
      setError(null);
      const res = await dataService.requestSaasAddon('memberships', addonNote.trim());
      setSuccessMsg(
        res?.message ||
          'Solicitud registrada. Nuestro equipo comercial te contactará para coordinar la activación del módulo adicional.'
      );
      setShowAddonModal(false);
      setAddonNote('');
    } catch (err) {
      setError(err.message || 'No se pudo enviar la solicitud.');
    } finally {
      setRequestingAddon(false);
    }
  };

  const handlePayInvoice = async (invoiceId) => {
    try {
      setPayingInvoiceId(invoiceId);
      setError(null);
      const res = await dataService.paySaasInvoice(invoiceId);
      setSuccessMsg(res?.message || 'Factura pagada exitosamente.');
      await Promise.all([loadBillingData(), refetchEntitlements()]);
    } catch (err) {
      setError(err.message || 'No se pudo procesar el pago de la factura.');
    } finally {
      setPayingInvoiceId(null);
    }
  };

  const handleSaveCard = async (e) => {
    e.preventDefault();
    if (cardLast4.length !== 4) {
      setError('Ingresa exactamente los últimos 4 dígitos de la tarjeta.');
      return;
    }

    try {
      setSavingCard(true);
      setError(null);
      await dataService.saveSaasPaymentMethod({
        paymentMethodToken: `tok_${Date.now()}_${cardLast4}`,
        last4: cardLast4,
        brand: cardBrand,
        expMonth: Number(cardExpMonth) || 12,
        expYear: Number(cardExpYear) || new Date().getFullYear() + 3,
        isDefault: true,
      });
      setSuccessMsg('Método de pago guardado correctamente.');
      setShowAddCardModal(false);
      setCardLast4('');
      await loadBillingData();
    } catch (err) {
      setError(err.message || 'Error al registrar el método de pago.');
    } finally {
      setSavingCard(false);
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
                : 'Suscripción activa.'}
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
              <div className="sb-pm-box">
                <span className="sb-pm-brand">{defaultPm.brand || 'CARD'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '14px' }}>
                    {String(defaultPm.brand || 'Tarjeta').toUpperCase()} •••• {defaultPm.last4}
                  </div>
                  <div className="sb-meta-text" style={{ margin: 0 }}>
                    Vence {String(defaultPm.expMonth).padStart(2, '0')}/{defaultPm.expYear}
                  </div>
                </div>
                <span className="sb-badge sb-badge-active">Principal</span>
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
                    ? 'Activo (Transición)'
                    : 'Activo'
                  : 'No contratado'}
              </span>
            </div>
            <p className="sb-meta-text" style={{ margin: '4px 0 0' }}>
              Módulo adicional para ofrecer planes mensuales, contratos digitales y cobros recurrentes a los clientes de tu salón.
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
              Este módulo adicional habilita la creación de planes de membresía B2C, contratos digitales y cobros recurrentes para los clientes de tu salón.
            </p>
            <p className="sb-meta-text" style={{ marginBottom: '16px' }}>
              Esta solicitud no genera cargos automáticos; nuestro equipo comercial confirmará condiciones y activación contigo.
            </p>

            <form onSubmit={handleRequestAddon}>
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

              <div className="sb-modal-footer">
                <button
                  type="button"
                  className="sb-btn"
                  onClick={() => setShowAddonModal(false)}
                  disabled={requestingAddon}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="sb-btn sb-btn-primary"
                  disabled={requestingAddon}
                >
                  {requestingAddon ? 'Enviando...' : 'Enviar solicitud'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Card Modal */}
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
                {defaultPm ? 'Actualizar tarjeta' : 'Agregar método de pago'}
              </h3>
              <button
                type="button"
                className="sb-modal-close"
                onClick={() => setShowAddCardModal(false)}
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>

            <p className="sb-meta-text" style={{ marginBottom: '16px' }}>
              La tarjeta se tokeniza mediante pasarela segura. El sistema no almacena números completos de tarjeta ni códigos de seguridad.
            </p>

            <form onSubmit={handleSaveCard}>
              <div className="sb-field">
                <label htmlFor="sb-card-brand">Franquicia</label>
                <select
                  id="sb-card-brand"
                  className="sb-input"
                  value={cardBrand}
                  onChange={(e) => setCardBrand(e.target.value)}
                >
                  <option value="visa">Visa</option>
                  <option value="mastercard">Mastercard</option>
                  <option value="amex">American Express</option>
                </select>
              </div>

              <div className="sb-field">
                <label htmlFor="sb-card-last4">Últimos 4 dígitos</label>
                <input
                  id="sb-card-last4"
                  type="text"
                  maxLength={4}
                  value={cardLast4}
                  onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, ''))}
                  placeholder="0000"
                  required
                  className="sb-input"
                />
              </div>

              <div className="sb-grid-2" style={{ marginBottom: 0 }}>
                <div className="sb-field">
                  <label htmlFor="sb-card-month">Mes vencimiento</label>
                  <input
                    id="sb-card-month"
                    type="number"
                    min={1}
                    max={12}
                    value={cardExpMonth}
                    onChange={(e) => setCardExpMonth(e.target.value)}
                    required
                    className="sb-input"
                  />
                </div>
                <div className="sb-field">
                  <label htmlFor="sb-card-year">Año vencimiento</label>
                  <input
                    id="sb-card-year"
                    type="number"
                    min={new Date().getFullYear()}
                    max={new Date().getFullYear() + 20}
                    value={cardExpYear}
                    onChange={(e) => setCardExpYear(e.target.value)}
                    required
                    className="sb-input"
                  />
                </div>
              </div>

              <div className="sb-modal-footer">
                <button
                  type="button"
                  className="sb-btn"
                  onClick={() => setShowAddCardModal(false)}
                  disabled={savingCard}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="sb-btn sb-btn-primary"
                  disabled={savingCard}
                >
                  {savingCard ? (
                    <>
                      <Loader2 size={15} className="sb-spin" />
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <span>Guardar tarjeta</span>
                  )}
                </button>
              </div>
            </form>
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
              <div className="sb-kv-row">
                <span className="sb-kv-label">Fecha</span>
                <span className="sb-kv-value">{formatDateEs(selectedInvoice.created_at) || '—'}</span>
              </div>
              <div className="sb-kv-row">
                <span className="sb-kv-label">Concepto</span>
                <span className="sb-kv-value">
                  Etereas {selectedInvoice.plan_code} ({selectedInvoice.billing_cycle === 'annual' ? 'anual' : 'mensual'})
                </span>
              </div>
              <div className="sb-kv-row">
                <span className="sb-kv-label">Importe</span>
                <span className="sb-kv-value">
                  {formatMinor(selectedInvoice.total_minor, selectedInvoice.currency)}
                </span>
              </div>
              <div className="sb-kv-row">
                <span className="sb-kv-label">Estado</span>
                <span className="sb-kv-value">
                  {(INVOICE_STATUS_META[selectedInvoice.status] || { label: selectedInvoice.status }).label}
                </span>
              </div>
            </div>

            <div className="sb-modal-footer">
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
