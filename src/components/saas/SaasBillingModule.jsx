import React, { useState, useEffect, useCallback } from 'react';
import {
  CreditCard, Calendar, CheckCircle2, AlertTriangle, AlertCircle,
  Clock, ArrowUpRight, ShieldCheck, Download, RefreshCw, Sparkles,
  Receipt, FileText, ChevronRight, Lock
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useEntitlements } from '../../context/EntitlementsContext';
import SaasUpgradeModal from './SaasUpgradeModal';

export default function SaasBillingModule() {
  const { refetch: refetchEntitlements } = useEntitlements();
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showAddCardModal, setShowAddCardModal] = useState(false);
  const [cardLast4, setCardLast4] = useState('');
  const [cardBrand, setCardBrand] = useState('visa');
  const [submittingCard, setSubmittingCard] = useState(false);
  const [payingInvoiceId, setPayingInvoiceId] = useState(null);

  const loadBillingData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [subRes, invRes, pmRes] = await Promise.all([
        dataService.getSaasSubscription().catch(() => ({ subscription: null })),
        dataService.getSaasInvoices().catch(() => ({ invoices: [] })),
        dataService.getSaasPaymentMethods().catch(() => ({ paymentMethods: [] }))
      ]);

      setSubscription(subRes.subscription);
      setInvoices(invRes.invoices || []);
      setPaymentMethods(pmRes.paymentMethods || []);
    } catch (err) {
      setError(err.message || 'Error al cargar los datos de facturación');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBillingData();
  }, [loadBillingData]);

  const handleUpgrade = async () => {
    await dataService.upgradeSaasSubscription();
    setSuccessMsg('¡Plan actualizado a SalonPro PRO exitosamente!');
    loadBillingData();
    if (refetchEntitlements) refetchEntitlements();
  };

  const handleDowngrade = async () => {
    await dataService.downgradeSaasSubscription();
    setSuccessMsg('Downgrade a Plan BASE programado para el final de tu ciclo actual.');
    loadBillingData();
    if (refetchEntitlements) refetchEntitlements();
  };

  const handlePayInvoice = async (invoiceId) => {
    try {
      setPayingInvoiceId(invoiceId);
      setError(null);
      await dataService.paySaasInvoice(invoiceId);
      setSuccessMsg('Pago de factura procesado exitosamente.');
      loadBillingData();
      if (refetchEntitlements) refetchEntitlements();
    } catch (err) {
      setError(err.message || 'Error al procesar el pago de la factura');
    } finally {
      setPayingInvoiceId(null);
    }
  };

  const handleSaveCard = async (e) => {
    e.preventDefault();
    try {
      setSubmittingCard(true);
      setError(null);
      // Simulación de tokenización segura del lado del cliente (sin PAN ni CVC en backend)
      const token = `pm_tok_${Date.now()}_${cardLast4 || '4242'}`;
      await dataService.saveSaasPaymentMethod({
        paymentMethodToken: token,
        last4: cardLast4.slice(-4) || '4242',
        brand: cardBrand,
        expMonth: 12,
        expYear: 2028,
        isDefault: true
      });
      setShowAddCardModal(false);
      setCardLast4('');
      setSuccessMsg('Método de pago registrado exitosamente.');
      loadBillingData();
    } catch (err) {
      setError(err.message || 'Error al guardar el método de pago');
    } finally {
      setSubmittingCard(false);
    }
  };

  const formatMinor = (minor, currency = 'DOP') => {
    if (minor === undefined || minor === null) return '0.00';
    const num = Number(minor) / 100;
    const prefix = currency === 'USD' ? 'US$' : 'RD$';
    return `${prefix} ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const planCode = subscription?.plan_code || 'BASE';
  const isPro = planCode === 'PRO';
  const status = subscription?.status || 'active';
  const currency = subscription?.currency || 'DOP';

  const defaultPm = paymentMethods.find(m => m.isDefault) || paymentMethods[0];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      {/* Top Banner / Alerts */}
      {status === 'past_due' && (
        <div className="flex items-start gap-4 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900 shadow-sm">
          <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <div className="font-bold text-base text-amber-950">Pago Pendiente — Período de Gracia Activo</div>
            <p className="mt-1 text-amber-800">
              El cobro de tu última factura no pudo ser procesado. Tu acceso al sistema continúa habilitado bajo el período de gracia de 5 días. Por favor actualiza tu tarjeta o salda la factura para evitar la suspensión comercial.
            </p>
          </div>
        </div>
      )}

      {status === 'suspended' && (
        <div className="flex items-start gap-4 p-4 bg-red-50 border border-red-200 rounded-2xl text-red-900 shadow-sm">
          <Lock className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <div className="font-bold text-base text-red-950">Suscripción Suspendida por Falta de Pago</div>
            <p className="mt-1 text-red-800">
              El período de gracia ha finalizado sin regularizar el cobro. Las operaciones comerciales están congeladas. Paga tu factura pendiente a continuación para reactivar el sistema inmediatamente.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Facturación del SaaS</h1>
            <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
              status === 'active' ? 'bg-emerald-100 text-emerald-800' :
              status === 'past_due' ? 'bg-amber-100 text-amber-800' :
              status === 'suspended' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'
            }`}>
              {status === 'active' ? '● Activa' :
               status === 'past_due' ? '▲ Gracia' :
               status === 'suspended' ? '✕ Suspendida' : status}
            </span>
          </div>
          <p className="text-slate-500 text-sm mt-1">
            Gestión de plan de suscripción B2B, método de pago y comprobantes de facturación.
          </p>
        </div>

        <button
          onClick={loadBillingData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors self-start md:self-auto"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Actualizar</span>
        </button>
      </div>

      {/* Grid: Plan Overview + Payment Method */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: Plan Actual */}
        <div className="md:col-span-2 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Tu Plan Actual</span>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                isPro ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-800'
              }`}>
                SalonPro {planCode}
              </span>
            </div>

            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-4xl font-extrabold text-slate-900">
                {isPro
                  ? (currency === 'USD' ? 'US$ 99.00' : 'RD$ 5,900.00')
                  : (currency === 'USD' ? 'US$ 49.00' : 'RD$ 2,900.00')}
              </span>
              <span className="text-slate-500 text-sm">/ mes por sucursal</span>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl">
                <span className="text-slate-400 block font-medium">Ciclo de Renovación</span>
                <span className="text-slate-800 font-bold capitalize mt-0.5 block">
                  {subscription?.billing_cycle || 'Mensual'}
                </span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl">
                <span className="text-slate-400 block font-medium">Próxima Facturación</span>
                <span className="text-slate-800 font-bold mt-0.5 block">
                  {subscription?.current_period_end
                    ? new Date(subscription.current_period_end).toLocaleDateString()
                    : 'Renovación automática'}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-slate-500">
              {isPro
                ? 'Plan PRO incluye CRM de clientes, membresías y multi-sucursal.'
                : 'Plan Base incluye POS, inventario, DGII, cajas y nómina.'}
            </span>
            <button
              onClick={() => setShowUpgradeModal(true)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm ${
                isPro
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                  : 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isPro ? 'Cambiar a Plan Base' : 'Evolucionar a Plan PRO'}</span>
            </button>
          </div>
        </div>

        {/* Card 2: Tarjeta / Método de Pago */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Método de Pago</span>
              <CreditCard className="w-5 h-5 text-slate-400" />
            </div>

            {defaultPm ? (
              <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700">{defaultPm.brand}</span>
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-bold">Principal</span>
                </div>
                <div className="text-base font-mono font-bold text-slate-800">
                  •••• •••• •••• {defaultPm.last4}
                </div>
                <div className="text-[11px] text-slate-500">
                  Vence: {defaultPm.expMonth}/{defaultPm.expYear}
                </div>
              </div>
            ) : (
              <div className="p-6 bg-slate-50 rounded-xl border border-dashed border-slate-300 text-center">
                <CreditCard className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-xs text-slate-500 font-medium">Sin tarjeta registrada</p>
              </div>
            )}
          </div>

          <button
            onClick={() => setShowAddCardModal(true)}
            className="w-full mt-4 py-2 px-3 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            {defaultPm ? 'Actualizar Tarjeta' : 'Registrar Tarjeta'}
          </button>
        </div>
      </div>

      {/* Invoices List */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-slate-500" />
            <h2 className="text-lg font-bold text-slate-900">Historial de Facturas SaaS</h2>
          </div>
          <span className="text-xs text-slate-500 font-medium">{invoices.length} facturas emitidas</span>
        </div>

        {invoices.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            No hay facturas registradas en el historial de suscripción.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider font-bold text-slate-500 border-b border-slate-200/60">
                <tr>
                  <th className="py-3 px-6">Comprobante</th>
                  <th className="py-3 px-6">Fecha</th>
                  <th className="py-3 px-6">Plan / Concepto</th>
                  <th className="py-3 px-6">Total</th>
                  <th className="py-3 px-6">Estado</th>
                  <th className="py-3 px-6 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-4 px-6 font-mono font-bold text-slate-900">{inv.invoice_number}</td>
                    <td className="py-4 px-6 text-xs">{new Date(inv.created_at).toLocaleDateString()}</td>
                    <td className="py-4 px-6 text-xs font-medium">
                      SalonPro {inv.plan_code} ({inv.billing_cycle})
                    </td>
                    <td className="py-4 px-6 font-semibold text-slate-900">
                      {formatMinor(inv.total_minor, inv.currency)}
                    </td>
                    <td className="py-4 px-6">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        inv.status === 'paid' ? 'bg-emerald-100 text-emerald-800' :
                        inv.status === 'open' ? 'bg-amber-100 text-amber-800' :
                        inv.status === 'partially_refunded' ? 'bg-indigo-100 text-indigo-800' :
                        inv.status === 'refunded' ? 'bg-purple-100 text-purple-800' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right">
                      {inv.status === 'open' ? (
                        <button
                          onClick={() => handlePayInvoice(inv.id)}
                          disabled={payingInvoiceId === inv.id}
                          className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold transition-colors shadow-sm disabled:opacity-50"
                        >
                          {payingInvoiceId === inv.id ? 'Pagando...' : 'Pagar Ahora'}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400 font-medium">Saldada</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Upgrade / Downgrade Modal */}
      <SaasUpgradeModal
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        currentPlan={planCode}
        currency={currency}
        onConfirmUpgrade={isPro ? handleDowngrade : handleUpgrade}
      />

      {/* Add Card Modal */}
      {showAddCardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-100 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Registrar Método de Pago</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              La tarjeta se tokeniza mediante pasarela segura bajo certificación PCI DSS. El backend de SalonPro nunca procesa ni almacena números de tarjeta (PAN) ni códigos de seguridad (CVC).
            </p>

            <form onSubmit={handleSaveCard} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Últimos 4 Dígitos (Simulado)</label>
                <input
                  type="text"
                  maxLength={4}
                  value={cardLast4}
                  onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, ''))}
                  placeholder="4242"
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-mono focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Franquicia</label>
                <select
                  value={cardBrand}
                  onChange={(e) => setCardBrand(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none"
                >
                  <option value="visa">Visa</option>
                  <option value="mastercard">Mastercard</option>
                  <option value="amex">American Express</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddCardModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingCard}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  {submittingCard ? 'Guardando...' : 'Tokenizar Tarjeta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

