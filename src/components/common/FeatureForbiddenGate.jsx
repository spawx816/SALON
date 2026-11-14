import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, Sparkles, ArrowLeft, ArrowUpRight } from 'lucide-react';

export default function FeatureForbiddenGate({
  featureName = 'Esta funcionalidad',
  requiredPlan = 'PRO'
}) {
  const navigate = useNavigate();

  return (
    <div
      role="alert"
      aria-live="polite"
      className="min-h-[70vh] flex items-center justify-center p-4 sm:p-6"
    >
      <div className="max-w-lg w-full bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden p-6 sm:p-8 text-center space-y-6">
        {/* Icon & Badge */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center">
            <ShieldAlert className="w-8 h-8" aria-hidden="true" />
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold tracking-wide uppercase bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            Exclusivo Plan {requiredPlan}
          </span>
        </div>

        {/* Text Details */}
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Acceso Restringido (403)
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm sm:text-base leading-relaxed">
            {featureName} no está disponible en tu plan actual. Para acceder a este módulo y desbloquear todas sus capacidades operativas, actualiza tu suscripción a SalonPro {requiredPlan}.
          </p>
        </div>

        {/* Benefits Pill */}
        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-700/60 text-left text-xs sm:text-sm text-slate-700 dark:text-slate-300 space-y-2">
          <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500 shrink-0" aria-hidden="true" />
            <span>Beneficios incluidos en Plan PRO:</span>
          </div>
          <ul className="space-y-1 pl-6 list-disc text-slate-600 dark:text-slate-400">
            <li>Membresías recurrentes Plan Beauty RD con contratos digitales</li>
            <li>Marketing, encuestas y Gift Cards</li>
            <li>Transferencias de inventario entre sucursales</li>
            <li>Hasta 5 sucursales y 15 usuarios colaboradores</li>
          </ul>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            type="button"
            onClick={() => navigate('/facturacion-saas')}
            className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-bold shadow-lg shadow-amber-500/20 transition-all focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
          >
            <span>Actualizar a Plan PRO</span>
            <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span>Volver al Inicio</span>
          </button>
        </div>
      </div>
    </div>
  );
}

