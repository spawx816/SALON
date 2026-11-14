import React, { useState } from 'react';
import { Sparkles, Check, ArrowRight, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';

export default function SaasUpgradeModal({ isOpen, onClose, currentPlan = 'BASE', onConfirmUpgrade, currency = 'DOP' }) {
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

  const isProTarget = currentPlan === 'BASE';
  const proMonthly = currency === 'USD' ? 'US$ 99.00' : 'RD$ 5,900.00';
  const baseMonthly = currency === 'USD' ? 'US$ 49.00' : 'RD$ 2,900.00';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className={`p-6 ${isProTarget ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white' : 'bg-slate-900 text-white'}`}>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-5 h-5 text-amber-200" />
            <span className="text-xs uppercase tracking-widest font-bold text-amber-200">
              {isProTarget ? 'Upgrade de Nivel Empresarial' : 'Cambio a Plan Base'}
            </span>
          </div>
          <h3 className="text-2xl font-bold">
            {isProTarget ? 'Evoluciona a SalonPro PRO' : 'Solicitar Plan Base'}
          </h3>
          <p className="text-sm opacity-90 mt-1">
            {isProTarget
              ? 'Desbloquea membresías Plan Beauty, contratos, marketing y transferencias multi-sucursal.'
              : 'Regresa al plan operativo esencial con POS, DGII y nómina.'}
          </p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {isProTarget ? (
            <div className="space-y-4">
              <div className="bg-amber-50/70 border border-amber-200/60 rounded-xl p-4">
                <div className="text-xs font-semibold text-amber-800 uppercase tracking-wider mb-1">
                  Transparencia de Prorrateo Matemático
                </div>
                <p className="text-xs text-amber-900 leading-relaxed">
                  Solo pagarás la diferencia proporcional por los días restantes de tu ciclo mensual actual. El crédito no utilizado de tu Plan Base ({baseMonthly}) se deducirá automáticamente del cargo del nuevo Plan PRO ({proMonthly}).
                </p>
              </div>

              <div className="space-y-2 text-sm">
                <div className="font-semibold text-slate-800">Todo lo incluido en tu nuevo Plan PRO:</div>
                <div className="flex items-center gap-2 text-slate-600">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Directorio y fichas completas de Clientas (CRM)</span>
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Membresías mensuales recurrentes Plan Beauty</span>
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Transferencias de stock entre sucursales y proveedores</span>
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Ampliación hasta 5 sucursales y 15 usuarios</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-sm text-slate-600">
              <p>
                El cambio a Plan Base se programará para entrar en vigencia al final de tu período de facturación actual.
              </p>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
                <div className="font-semibold text-slate-700">Requisitos de Límites:</div>
                <div>• Máximo 1 sucursal activa</div>
                <div>• Máximo 3 usuarios colaboradores</div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm shadow-md transition-all ${
                isProTarget
                  ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20'
                  : 'bg-slate-800 hover:bg-slate-900 text-white shadow-slate-800/20'
              }`}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Procesando...</span>
                </>
              ) : (
                <>
                  <span>{isProTarget ? 'Confirmar Upgrade a PRO' : 'Confirmar Downgrade'}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

