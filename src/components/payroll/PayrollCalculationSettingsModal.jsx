import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Sliders, DollarSign, Clock, Calendar, Check, X, RefreshCw, 
  AlertCircle, ShieldCheck, HelpCircle, ArrowRight, Sparkles 
} from 'lucide-react';

/**
 * Modal de Configuración Salarial & Tarifa Base por Minuto
 * Permite configurar el salario mensual garantizado ($18,421 por defecto),
 * factor legal de 23.83 días laborables (Art. 85 / 115 CT República Dominicana),
 * y calcular en tiempo real la unidad base por minuto para descontar tardanzas,
 * ausencias diferenciadas de 8 horas vs 4 horas, y pagar horas extras y feriados.
 */
export default function PayrollCalculationSettingsModal({
  isOpen,
  onClose,
  initialConfig,
  onSave,
  loading = false,
  hasActivePeriod = false
}) {
  const [form, setForm] = useState({
    salario_mensual_base: 18421.00,
    dias_laborables_mes: 23.83,
    horas_jornada_completa: 8.00,
    horas_media_jornada: 4.00,
    recargo_horas_extras: 1.35,
    recargo_feriado: 1.00
  });

  useEffect(() => {
    if (initialConfig) {
      setForm({
        salario_mensual_base: parseFloat(initialConfig.salario_mensual_base || 18421.00),
        dias_laborables_mes: parseFloat(initialConfig.dias_laborables_mes || 23.83),
        horas_jornada_completa: parseFloat(initialConfig.horas_jornada_completa || 8.00),
        horas_media_jornada: parseFloat(initialConfig.horas_media_jornada || 4.00),
        recargo_horas_extras: parseFloat(initialConfig.recargo_horas_extras || 1.35),
        recargo_feriado: parseFloat(initialConfig.recargo_feriado || 1.00)
      });
    }
  }, [initialConfig, isOpen]);

  // Cálculos matemáticos en vivo
  const sm = Math.max(0, parseFloat(form.salario_mensual_base) || 0);
  const dm = Math.max(1, parseFloat(form.dias_laborables_mes) || 23.83);
  const hc = Math.max(1, parseFloat(form.horas_jornada_completa) || 8.00);
  const hm = Math.max(1, parseFloat(form.horas_media_jornada) || 4.00);
  const rhe = Math.max(1, parseFloat(form.recargo_horas_extras) || 1.35);
  const rf = Math.max(1, parseFloat(form.recargo_feriado) || 1.00);

  const liveDiario = sm / dm;
  const liveHora = liveDiario / hc;
  const liveMinuto = liveHora / 60; // ¡Unidad base por minuto!

  const liveAusencia8 = liveHora * hc;
  const liveAusencia4 = liveHora * hm;

  const liveHoraExtra = liveHora * rhe;
  const liveMinutoExtra = liveHoraExtra / 60;

  const liveHoraFeriado = liveHora * rf;
  const liveMinutoFeriado = liveHoraFeriado / 60;

  const handleResetDefaults = () => {
    setForm({
      salario_mensual_base: 18421.00,
      dias_laborables_mes: 23.83,
      horas_jornada_completa: 8.00,
      horas_media_jornada: 4.00,
      recargo_horas_extras: 1.35,
      recargo_feriado: 1.00
    });
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.72)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: '1.25rem'
      }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          style={{
            background: '#ffffff',
            borderRadius: '24px',
            width: '100%',
            maxWidth: '820px',
            maxHeight: '90vh',
            overflowY: 'auto',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {/* HEADER */}
          <div style={{
            padding: '1.5rem 1.75rem',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'linear-gradient(135deg, #fbfbfe 0%, #f5f3ff 100%)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
              <div style={{
                background: '#8b5cf6',
                color: '#ffffff',
                padding: '10px',
                borderRadius: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(139, 92, 246, 0.35)'
              }}>
                <Sliders size={22} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#0f172a', margin: 0 }}>
                    Configuración Salarial & Unidad por Minuto
                  </h2>
                  <span style={{
                    background: '#ede9fe',
                    color: '#6d28d9',
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    padding: '3px 8px',
                    borderRadius: '20px'
                  }}>
                    Ley 16-92 RD
                  </span>
                </div>
                <p style={{ color: '#64748b', fontSize: '0.82rem', margin: '0.2rem 0 0 0' }}>
                  Define el salario garantizado base y el factor de 23.83 días para convertirlo en minutos de tardanza y horas de ausencia.
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              style={{
                background: '#f1f5f9',
                border: 'none',
                cursor: 'pointer',
                color: '#64748b',
                padding: '8px',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s'
              }}
              title="Cerrar"
            >
              <X size={18} />
            </button>
          </div>

          {/* CONTENIDO DEL MODAL */}
          <div style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {/* AVISO EXPLICATIVO DE LA REGLA */}
            <div style={{
              background: '#f8fafc',
              border: '1.5px solid #e2e8f0',
              borderRadius: '16px',
              padding: '1rem 1.25rem',
              display: 'flex',
              gap: '0.85rem',
              alignItems: 'flex-start'
            }}>
              <ShieldCheck size={20} color="#7c3aed" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div style={{ fontSize: '0.82rem', color: '#475569', lineHeight: 1.5 }}>
                <strong style={{ color: '#0f172a' }}>Regla Oficial de Nómina: </strong>
                Aunque las comisiones varían para cada colaboradora, los descuentos de <strong>tardanzas</strong>, <strong>ausencias (8h o 4h)</strong> y el pago de <strong>horas extras y feriados</strong> se calculan estrictamente en base a este salario mensual garantizado convertido a minutos mediante el factor de <strong>23.83 días</strong> laborales al mes.
              </div>
            </div>

            {/* FORMULARIO DE ENTRADA DE DATOS */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '1.25rem'
            }}>
              {/* CAMPO 1: SALARIO MENSUAL GARANTIZADO */}
              <div style={{
                background: '#ffffff',
                border: '2px solid #8b5cf6',
                borderRadius: '16px',
                padding: '1.1rem',
                boxShadow: '0 4px 14px rgba(139, 92, 246, 0.08)'
              }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  color: '#6d28d9',
                  marginBottom: '0.5rem'
                }}>
                  <DollarSign size={15} /> Salario Mensual Base (RD$)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontWeight: 800, color: '#94a3b8', fontSize: '0.9rem' }}>RD$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={form.salario_mensual_base}
                    onChange={(e) => setForm(prev => ({ ...prev, salario_mensual_base: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '10px',
                      border: '1.5px solid #cbd5e1',
                      fontSize: '1.1rem',
                      fontWeight: 900,
                      color: '#0f172a',
                      outline: 'none'
                    }}
                  />
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.4rem' }}>
                  Garantizado por defecto: <strong>$18,421.00</strong>
                </div>
              </div>

              {/* CAMPO 2: DÍAS LABORALES DEL MES (23.83) */}
              <div style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '16px',
                padding: '1.1rem'
              }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  color: '#334155',
                  marginBottom: '0.5rem'
                }}>
                  <Calendar size={15} color="#0066ff" /> Días Laborales Mes (Factor Ley)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="number"
                    step="0.01"
                    value={form.dias_laborables_mes}
                    onChange={(e) => setForm(prev => ({ ...prev, dias_laborables_mes: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '10px',
                      border: '1.5px solid #cbd5e1',
                      fontSize: '1.1rem',
                      fontWeight: 900,
                      color: '#0f172a',
                      outline: 'none'
                    }}
                  />
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#64748b' }}>días</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.4rem' }}>
                  Estándar Art. 85 / 115 CT: <strong>23.83</strong> días
                </div>
              </div>

              {/* CAMPO 3: JORNADA COMPLETA (8 HORAS) */}
              <div style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '16px',
                padding: '1.1rem'
              }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  color: '#334155',
                  marginBottom: '0.5rem'
                }}>
                  <Clock size={15} color="#16a34a" /> Jornada Día Completo
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="number"
                    step="0.5"
                    value={form.horas_jornada_completa}
                    onChange={(e) => setForm(prev => ({ ...prev, horas_jornada_completa: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '10px',
                      border: '1.5px solid #cbd5e1',
                      fontSize: '1.1rem',
                      fontWeight: 900,
                      color: '#0f172a',
                      outline: 'none'
                    }}
                  />
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#64748b' }}>horas</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.4rem' }}>
                  Jornada ordinaria: <strong>8 hrs</strong> (480 mins)
                </div>
              </div>

              {/* CAMPO 4: MEDIA JORNADA (4 HORAS) */}
              <div style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '16px',
                padding: '1.1rem'
              }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  color: '#334155',
                  marginBottom: '0.5rem'
                }}>
                  <Clock size={15} color="#f59e0b" /> Jornada Medio Día / Turno Corto
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="number"
                    step="0.5"
                    value={form.horas_media_jornada}
                    onChange={(e) => setForm(prev => ({ ...prev, horas_media_jornada: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '10px',
                      border: '1.5px solid #cbd5e1',
                      fontSize: '1.1rem',
                      fontWeight: 900,
                      color: '#0f172a',
                      outline: 'none'
                    }}
                  />
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#64748b' }}>horas</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.4rem' }}>
                  Turno parcial: <strong>4 hrs</strong> (240 mins)
                </div>
              </div>

              {/* CAMPO 5: MULTIPLICADOR FERIADO */}
              <div style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '16px',
                padding: '1.1rem'
              }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  color: '#334155',
                  marginBottom: '0.5rem'
                }}>
                  🎈 Factor de Día Feriado
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="number"
                    step="0.05"
                    value={form.recargo_feriado}
                    onChange={(e) => setForm(prev => ({ ...prev, recargo_feriado: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '10px',
                      border: '1.5px solid #cbd5e1',
                      fontSize: '1.1rem',
                      fontWeight: 900,
                      color: '#0f172a',
                      outline: 'none'
                    }}
                  />
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#64748b' }}>x</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.4rem' }}>
                  <strong>1.00x</strong>: Se paga al mismo monto de la hora regular
                </div>
              </div>
            </div>

            {/* SECCIÓN VISUAL EN VIVO: LA CALCULADORA DE TARIFAS Y MINUTOS */}
            <div style={{
              background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
              borderRadius: '20px',
              padding: '1.5rem',
              color: '#ffffff',
              boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.3)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Sparkles size={18} color="#a78bfa" />
                  <span style={{ fontSize: '0.9rem', fontWeight: 800, letterSpacing: '0.3px', textTransform: 'uppercase', color: '#c4b5fd' }}>
                    Desglose Matemático en Tiempo Real
                  </span>
                </div>
                <span style={{ background: 'rgba(255,255,255,0.1)', padding: '3px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, color: '#e2e8f0' }}>
                  Base: RD$ {sm.toLocaleString('en-US', { minimumFractionDigits: 2 })} / {dm} días
                </span>
              </div>

              {/* GRID DE RESULTADOS DERIVADOS */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '1rem'
              }}>
                {/* TARJETA DESTACADA: UNIDAD POR MINUTO */}
                <div style={{
                  background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                  borderRadius: '16px',
                  padding: '1.1rem',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  gridColumn: 'span 2'
                }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#ddd6fe', marginBottom: '0.25rem' }}>
                    ⚡ UNIDAD BASE POR MINUTO (Tardanzas)
                  </div>
                  <div style={{ fontSize: '1.85rem', fontWeight: 900, color: '#ffffff', letterSpacing: '-0.5px' }}>
                    RD$ {liveMinuto.toFixed(4)} <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>/ minuto</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#ede9fe', marginTop: '0.35rem' }}>
                    Fórmula: Salario Mensual ÷ 23.83 ÷ 8h ÷ 60m (ej. 30 min = RD$ {(liveMinuto * 30).toFixed(2)})
                  </div>
                </div>

                {/* TARJETA: SALARIO POR HORA */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  borderRadius: '16px',
                  padding: '1rem',
                  border: '1px solid rgba(255, 255, 255, 0.08)'
                }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', marginBottom: '0.25rem' }}>
                    SALARIO POR HORA
                  </div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#38bdf8' }}>
                    RD$ {liveHora.toFixed(2)}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.2rem' }}>
                    Diario (RD$ {liveDiario.toFixed(2)}) ÷ 8h
                  </div>
                </div>

                {/* TARJETA: SALARIO DIARIO */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  borderRadius: '16px',
                  padding: '1rem',
                  border: '1px solid rgba(255, 255, 255, 0.08)'
                }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', marginBottom: '0.25rem' }}>
                    SALARIO DIARIO
                  </div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#4ade80' }}>
                    RD$ {liveDiario.toFixed(2)}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.2rem' }}>
                    Mensual ÷ 23.83 días
                  </div>
                </div>

                {/* TARJETA: AUSENCIA DÍA COMPLETO (8H) */}
                <div style={{
                  background: 'rgba(239, 68, 68, 0.12)',
                  borderRadius: '16px',
                  padding: '1rem',
                  border: '1px solid rgba(239, 68, 68, 0.3)'
                }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#fca5a5', marginBottom: '0.25rem' }}>
                    🛑 AUSENCIA DÍA COMPLETO (8H)
                  </div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#f87171' }}>
                    - RD$ {liveAusencia8.toFixed(2)}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#fecaca', marginTop: '0.2rem' }}>
                    Descuento total por 8 horas (480 min)
                  </div>
                </div>

                {/* TARJETA: AUSENCIA MEDIO DÍA (4H) */}
                <div style={{
                  background: 'rgba(245, 158, 11, 0.12)',
                  borderRadius: '16px',
                  padding: '1rem',
                  border: '1px solid rgba(245, 158, 11, 0.3)'
                }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#fde68a', marginBottom: '0.25rem' }}>
                    ⚠️ AUSENCIA MEDIO DÍA (4H)
                  </div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#fbbf24' }}>
                    - RD$ {liveAusencia4.toFixed(2)}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#fef3c7', marginTop: '0.2rem' }}>
                    Descuento turno corto (240 min)
                  </div>
                </div>

                {/* TARJETA: HORA EXTRA (+35%) */}
                <div style={{
                  background: 'rgba(34, 197, 94, 0.12)',
                  borderRadius: '16px',
                  padding: '1rem',
                  border: '1px solid rgba(34, 197, 94, 0.3)'
                }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#86efac', marginBottom: '0.25rem' }}>
                    ⭐ HORA EXTRA (+35% LEY)
                  </div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#4ade80' }}>
                    + RD$ {liveHoraExtra.toFixed(2)} / h
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#bbf7d0', marginTop: '0.2rem' }}>
                    RD$ {liveMinutoExtra.toFixed(4)} / min extra
                  </div>
                </div>

                {/* TARJETA: DÍA FERIADO (TARIFA REGULAR) */}
                <div style={{
                  background: 'rgba(59, 130, 246, 0.12)',
                  borderRadius: '16px',
                  padding: '1rem',
                  border: '1px solid rgba(59, 130, 246, 0.3)'
                }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#93c5fd', marginBottom: '0.25rem' }}>
                    🎈 HORA FERIADO ({rf.toFixed(2)}x REGULAR)
                  </div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#60a5fa' }}>
                    + RD$ {liveHoraFeriado.toFixed(2)} / h
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#bfdbfe', marginTop: '0.2rem' }}>
                    Mismo monto hora regular (RD$ {liveHora.toFixed(2)}/h)
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* FOOTER CON BOTONES DE ACCIÓN */}
          <div style={{
            padding: '1.25rem 1.75rem',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#f8fafc',
            flexWrap: 'wrap',
            gap: '0.75rem'
          }}>
            <button
              onClick={handleResetDefaults}
              type="button"
              className="btn-secondary"
              style={{
                fontSize: '0.8rem',
                padding: '0.6rem 1rem',
                borderRadius: '10px',
                color: '#64748b'
              }}
            >
              Restablecer Valores de Ley ($18,421 / 23.83d)
            </button>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button
                onClick={onClose}
                type="button"
                className="btn-secondary"
                style={{
                  padding: '0.65rem 1.4rem',
                  borderRadius: '12px',
                  fontWeight: 700
                }}
              >
                Cancelar
              </button>

              <button
                onClick={() => onSave(form, false)}
                disabled={loading}
                style={{
                  background: '#ffffff',
                  border: '2px solid #7c3aed',
                  color: '#7c3aed',
                  padding: '0.65rem 1.4rem',
                  borderRadius: '12px',
                  fontWeight: 800,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  transition: 'all 0.2s'
                }}
              >
                <Check size={16} /> Guardar Parámetros
              </button>

              {hasActivePeriod && (
                <button
                  onClick={() => onSave(form, true)}
                  disabled={loading}
                  style={{
                    background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                    border: 'none',
                    color: '#ffffff',
                    padding: '0.65rem 1.5rem',
                    borderRadius: '12px',
                    fontWeight: 800,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    boxShadow: '0 4px 14px rgba(124, 58, 237, 0.35)',
                    transition: 'all 0.2s'
                  }}
                  title="Guarda los parámetros y recalcula automáticamente tardanzas, ausencias y feriados del período activo"
                >
                  <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                  Guardar y Recalcular Período
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
