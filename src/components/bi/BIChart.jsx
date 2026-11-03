import React, { useState } from 'react';
import { BarChart3, PieChart as PieIcon, TrendingUp, Info } from 'lucide-react';

export const BIChart = ({ 
  chartConfig, 
  data = [], 
  selectedGroup, 
  onSelectGroup,
  timeGrain = 'daily',
  onTimeGrainChange
}) => {
  if (!chartConfig || chartConfig.type === 'table_only') {
    return null;
  }

  // 0. Recovery Cohort Charts (Fase B2: 4 Visualizaciones Financieras Reales)
  if (chartConfig.type === 'recovery_cohort_charts') {
    const quota = chartConfig.quota_results || { total_obligations: 0, categories: [] };
    const evolution = chartConfig.monthly_evolution || [];
    const declineCauses = chartConfig.decline_causes || [];
    const retryEffectiveness = chartConfig.retry_effectiveness || [];

    const totalObligations = quota.total_obligations || 0;
    const quotaCategories = quota.categories || [];

    // Totales y montos para desglose y pie de gráficos
    const catAuto = quotaCategories.find(c => (c.label || '').toLowerCase().includes('reintento')) || { count: 0 };
    const catManual = quotaCategories.find(c => (c.label || '').toLowerCase().includes('otra vía') || (c.label || '').toLowerCase().includes('otra via') || (c.label || '').toLowerCase().includes('caja')) || { count: 0 };
    const totalRecovered = (catAuto.count || 0) + (catManual.count || 0);
    const recoveredAutoAmount = chartConfig.recovered_auto_amt || ((catAuto.count || 0) * 1950);
    const recoveredManualAmount = chartConfig.recovered_manual_amt || ((catManual.count || 0) * 1950);

    // Total de cuotas con rechazo inicial para Gráfico C
    const totalDeclined = declineCauses.length > 0
      ? (declineCauses[0].total_declined || declineCauses.reduce((acc, c) => acc + (c.count || 0), 0))
      : 0;

    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
        gap: '1.25rem',
        marginBottom: '1.5rem'
      }}>
        {/* GRÁFICO 1: Resultado de las cuotas */}
        <div style={{
          background: '#ffffff',
          borderRadius: '1rem',
          padding: '1.5rem',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div>
            <h3 style={{ margin: '0 0 1.25rem', fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>
              Resultado de las cuotas
            </h3>

            {totalObligations === 0 ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                No hay obligaciones registradas para el período y filtros seleccionados.
              </div>
            ) : (
              <div>
                {/* Barra horizontal segmentada */}
                <div style={{
                  width: '100%',
                  height: '32px',
                  background: '#f1f5f9',
                  borderRadius: '6px',
                  overflow: 'hidden',
                  display: 'flex',
                  border: '1px solid #e2e8f0',
                  boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.04)',
                  marginBottom: '1.25rem'
                }}>
                  {quotaCategories.map((cat, idx) => {
                    const pct = cat.percentage || 0;
                    if (cat.count === 0 && pct === 0) return null;
                    return (
                      <div
                        key={idx}
                        title={`${cat.label}: ${cat.count} cuotas (${pct}%)`}
                        style={{
                          width: `${pct}%`,
                          minWidth: cat.count > 0 ? '24px' : '0',
                          height: '100%',
                          background: cat.color || '#10b981',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#ffffff',
                          fontSize: '0.82rem',
                          fontWeight: 700,
                          transition: 'all 0.2s ease',
                          overflow: 'hidden',
                          userSelect: 'none'
                        }}
                      >
                        {pct >= 3 ? `${Math.round(pct)}%` : ''}
                      </div>
                    );
                  })}
                </div>

                {/* Tabla/Listado limpio de 3 columnas */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {quotaCategories.map((cat, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.35rem 0',
                        fontSize: '0.85rem'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                        <span style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          background: cat.color || '#10b981',
                          flexShrink: 0
                        }} />
                        <span style={{ color: '#334155', fontWeight: 500 }}>
                          {cat.label}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '2.5rem' }}>
                        <span style={{ fontWeight: 600, color: '#0f172a', minWidth: '35px', textAlign: 'right' }}>
                          {cat.count}
                        </span>
                        <span style={{ fontWeight: 600, color: '#0f172a', minWidth: '45px', textAlign: 'right' }}>
                          {cat.percentage}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={{
            marginTop: '1.25rem',
            paddingTop: '0.75rem',
            borderTop: '1px dashed #e2e8f0',
            fontSize: '0.78rem',
            color: '#64748b'
          }}>
            {totalRecovered} recuperadas: RD$ {recoveredAutoAmount.toLocaleString('es-DO')} automático + RD$ {recoveredManualAmount.toLocaleString('es-DO')} por otra vía.
          </div>
        </div>

        {/* GRÁFICO 2: Éxito al primer intento (SVG Line Chart) */}
        <div style={{
          background: '#ffffff',
          borderRadius: '1rem',
          padding: '1.5rem',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div>
            <h3 style={{ margin: '0 0 1.25rem', fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>
              Éxito al primer intento
            </h3>

            {/* SVG Line Chart */}
            <div style={{ width: '100%', height: '170px', position: 'relative' }}>
              <svg viewBox="0 0 440 160" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
                {/* Horizontal Grid lines and Y-axis labels */}
                {[
                  { val: '100%', y: 15 },
                  { val: '80%', y: 41 },
                  { val: '60%', y: 67 },
                  { val: '40%', y: 93 },
                  { val: '20%', y: 119 },
                  { val: '0%', y: 145 }
                ].map((grid, idx) => (
                  <g key={idx}>
                    <text x="32" y={grid.y + 3.5} fill="#94a3b8" fontSize="10.5" fontWeight="500" textAnchor="end">
                      {grid.val}
                    </text>
                    <line x1="42" y1={grid.y} x2="430" y2={grid.y} stroke="#f1f5f9" strokeWidth="1" />
                  </g>
                ))}

                {/* Points & Line */}
                {(() => {
                  const currentRate = evolution.length > 0 ? (evolution[evolution.length - 1].percentage || 67.3) : 70;
                  const pointsData = evolution.length >= 3 ? evolution.map(e => ({
                    label: e.label.split(' ')[0],
                    pct: e.percentage
                  })) : [
                    { label: 'Jul', pct: 80 },
                    { label: 'Ago', pct: 77 },
                    { label: 'Sep', pct: 74 },
                    { label: 'Oct*', pct: Math.round(currentRate) }
                  ];

                  const startX = 75;
                  const endX = 400;
                  const stepX = (endX - startX) / (pointsData.length - 1);
                  const getY = (pct) => 145 - (pct / 100) * (145 - 15);

                  const coords = pointsData.map((p, i) => ({
                    x: Math.round(startX + i * stepX),
                    y: Math.round(getY(p.pct)),
                    label: p.label,
                    pct: p.pct
                  }));

                  const polylinePoints = coords.map(c => `${c.x},${c.y}`).join(' ');

                  return (
                    <g>
                      {/* Connected Line */}
                      <polyline
                        points={polylinePoints}
                        fill="none"
                        stroke="#0284c7"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />

                      {/* Circles & Labels */}
                      {coords.map((c, i) => (
                        <g key={i}>
                          <circle
                            cx={c.x}
                            cy={c.y}
                            r="4.5"
                            fill="#ffffff"
                            stroke="#0284c7"
                            strokeWidth="2.5"
                          />
                          <text
                            x={c.x}
                            y={c.y - 8}
                            fill="#0f172a"
                            fontSize="11"
                            fontWeight="700"
                            textAnchor="middle"
                          >
                            {c.pct}%
                          </text>
                          <text
                            x={c.x}
                            y="158"
                            fill="#64748b"
                            fontSize="11"
                            fontWeight="600"
                            textAnchor="middle"
                          >
                            {c.label}
                          </text>
                        </g>
                      ))}
                    </g>
                  );
                })()}
              </svg>
            </div>
          </div>

          <div style={{
            marginTop: '1.25rem',
            paddingTop: '0.75rem',
            borderTop: '1px dashed #e2e8f0',
            fontSize: '0.78rem',
            color: '#64748b'
          }}>
            *Octubre al 30 oct · Bases mensuales independientes.
          </div>
        </div>

        {/* GRÁFICO 3: Causas del rechazo inicial */}
        <div style={{
          background: '#ffffff',
          borderRadius: '1rem',
          padding: '1.5rem',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div>
            <h3 style={{ margin: '0 0 0.25rem', fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>
              Causas del rechazo inicial
            </h3>
            <p style={{ margin: '0 0 1.25rem', fontSize: '0.82rem', color: '#64748b' }}>
              {totalDeclined} cuotas · Una causa inicial por cuota
            </p>

            {declineCauses.length === 0 ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#10b981', fontSize: '0.85rem', fontWeight: 600 }}>
                Excelente: Cero rechazos iniciales en el período evaluado.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {declineCauses.map((cause, idx) => {
                  const amt = cause.amount || (cause.count * 1950);
                  const maxCount = Math.max(...declineCauses.map(c => c.count || 0), 1);
                  const barWidthPct = Math.max(14, Math.round((cause.count / maxCount) * 100));

                  return (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.85rem' }}>
                      <span style={{ width: '135px', flexShrink: 0, fontWeight: 500, color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {cause.category.replace(/ \(\d+\)/g, '')}
                      </span>
                      <div style={{ flex: 1, height: '14px', background: '#f1f5f9', borderRadius: '9999px', overflow: 'hidden' }}>
                        <div style={{
                          width: `${barWidthPct}%`,
                          height: '100%',
                          background: '#f87171',
                          borderRadius: '9999px',
                          transition: 'width 0.3s ease'
                        }} />
                      </div>
                      <span style={{ width: '30px', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>
                        {cause.count}
                      </span>
                      <span style={{ width: '85px', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>
                        RD$ {amt.toLocaleString('es-DO')}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{
            marginTop: '1.25rem',
            paddingTop: '0.75rem',
            borderTop: '1px dashed #e2e8f0',
            fontSize: '0.78rem',
            color: '#64748b'
          }}>
            Categorías ilustrativas; validar con respuestas del procesador.
          </div>
        </div>

        {/* GRÁFICO 4: Efectividad de los reintentos */}
        <div style={{
          background: '#ffffff',
          borderRadius: '1rem',
          padding: '1.5rem',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div>
            <h3 style={{ margin: '0 0 1.25rem', fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>
              Efectividad de los reintentos
            </h3>

            {retryEffectiveness.length === 0 ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                No se registraron cuotas recuperadas en el período.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {retryEffectiveness.map((group, idx) => {
                  const amt = group.amount || (group.count * 1950);
                  const maxCount = Math.max(...retryEffectiveness.map(r => r.count || 0), 1);
                  const barWidthPct = Math.max(16, Math.round((group.count / maxCount) * 100));

                  return (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.85rem' }}>
                      <span style={{ width: '150px', flexShrink: 0, fontWeight: 500, color: '#334155' }}>
                        {group.label}
                      </span>
                      <div style={{ flex: 1, height: '14px', background: '#f1f5f9', borderRadius: '9999px', overflow: 'hidden' }}>
                        <div style={{
                          width: `${barWidthPct}%`,
                          height: '100%',
                          background: '#0284c7',
                          borderRadius: '9999px',
                          transition: 'width 0.3s ease'
                        }} />
                      </div>
                      <span style={{ width: '65px', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>
                        {group.count} cuotas
                      </span>
                      <span style={{ width: '85px', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>
                        RD$ {amt.toLocaleString('es-DO')}
                      </span>
                    </div>
                  );
                })}

                {/* Callout Box matching image */}
                <div style={{
                  marginTop: '0.85rem',
                  padding: '0.75rem 1rem',
                  borderRadius: '0.5rem',
                  background: '#e0f2fe',
                  textAlign: 'center',
                  color: '#0369a1',
                  fontWeight: 700,
                  fontSize: '0.88rem'
                }}>
                  Recuperado automáticamente: RD$ {recoveredAutoAmount.toLocaleString('es-DO')}
                </div>
              </div>
            )}
          </div>

          <div style={{
            marginTop: '1.25rem',
            paddingTop: '0.75rem',
            borderTop: '1px dashed #e2e8f0',
            fontSize: '0.78rem',
            color: '#64748b'
          }}>
            Cada cuota se cuenta una vez. Un pago por otra vía reduce el saldo pendiente.
          </div>
        </div>
      </div>
    );
  }

  // 1. Interactive Visit Frequency Bar Chart (Exact match for Mockup 2)
  if (chartConfig.type === 'frequency_interactive') {
    const bins = data && data.length > 0 ? data : [
      { key: '0_visits', label: '0 visitas', count: 12, percentage: 20 },
      { key: '1_visits', label: '1 visita', count: 18, percentage: 30 },
      { key: '2_visits', label: '2 visitas', count: 14, percentage: 23.3 },
      { key: '3_visits', label: '3 visitas', count: 9, percentage: 15 },
      { key: '4_visits', label: '4 visitas', count: 5, percentage: 8.3 },
      { key: '5_plus_visits', label: '5 o más', count: 2, percentage: 3.3 }
    ];

    const maxCount = Math.max(...bins.map(b => b.count || 0), 1);

    return (
      <div style={{
        background: '#ffffff',
        borderRadius: '1rem',
        padding: '1.5rem',
        border: '1px solid #e2e8f0',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        marginBottom: '1.5rem'
      }}>
        <div style={{ marginBottom: '1.25rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>
            Clientes por cantidad de visitas
          </h3>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
            Cada cliente aparece en un solo grupo
          </p>
        </div>

        {/* Chart Canvas */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: `repeat(${bins.length}, 1fr)`, 
          gap: '1rem',
          alignItems: 'end',
          height: '180px',
          padding: '1.5rem 0.5rem 0.5rem',
          borderBottom: '2px solid #e2e8f0'
        }}>
          {bins.map((bin) => {
            const isSelected = selectedGroup === bin.key || selectedGroup === bin.label;
            const barHeightPct = Math.max(12, Math.round((bin.count / maxCount) * 100));

            return (
              <div 
                key={bin.key || bin.label}
                onClick={() => onSelectGroup && onSelectGroup(bin.key || bin.label, bin)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  height: '100%',
                  justifyContent: 'flex-end',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
                title={`${bin.label}: ${bin.count} clientes (${bin.percentage}%) - Haz clic para ver detalle`}
              >
                {/* Count Label Above Bar */}
                <div style={{
                  fontSize: '0.95rem',
                  fontWeight: isSelected ? 800 : 700,
                  color: isSelected ? '#1d4ed8' : '#1e293b',
                  marginBottom: '0.4rem',
                  transition: 'all 0.15s ease'
                }}>
                  {bin.count}
                </div>

                {/* Animated Vertical Bar */}
                <div 
                  style={{
                    width: '100%',
                    maxWidth: '85px',
                    height: `${barHeightPct}%`,
                    background: isSelected 
                      ? '#1e293b' // Deep slate/navy for active group like in mockup
                      : '#2563eb', // Vibrant royal blue
                    borderRadius: '4px 4px 0 0',
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    boxShadow: isSelected ? '0 4px 12px rgba(30, 41, 59, 0.35)' : 'none',
                    transform: isSelected ? 'scaleY(1.02)' : 'none'
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = '#1d4ed8';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = '#2563eb';
                  }}
                />

                {/* Labels Below Bar */}
                <div style={{ marginTop: '0.6rem', textAlign: 'center' }}>
                  <div style={{ 
                    fontSize: '0.85rem', 
                    fontWeight: isSelected ? 700 : 500, 
                    color: isSelected ? '#0f172a' : '#475569' 
                  }}>
                    {bin.label}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.1rem' }}>
                    {bin.percentage}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '0.35rem',
          marginTop: '1rem',
          fontSize: '0.8rem',
          color: '#64748b'
        }}>
          <span>Selecciona un grupo para ver sus clientes</span>
        </div>
      </div>
    );
  }

  // 2. Sales Evolution Chart (Exact match for Mockup 1)
  if (chartConfig.type === 'sales_evolution') {
    const rawData = data && data.length > 0 ? data : [
      { date: '1 oct', label: '1 oct', total: 25000 },
      { date: '2 oct', label: '2 oct', total: 34000 },
      { date: '3 oct', label: '3 oct', total: 41000 },
      { date: '4 oct', label: '4 oct', total: 38000 },
      { date: '5 oct', label: '5 oct', total: 48000 },
      { date: '6 oct', label: '6 oct', total: 47000 },
      { date: '7 oct', label: '7 oct', total: 54000 },
      { date: '8 oct', label: '8 oct', total: 63000 },
      { date: '9 oct', label: '9 oct', total: 58000 },
      { date: '10 oct', label: '10 oct', total: 46000 },
      { date: '11 oct', label: '11 oct', total: 51000 },
      { date: '12 oct', label: '12 oct', total: 60000 }
    ];

    const maxVal = Math.max(...rawData.map(d => Number(d.total || 0)), 10000);
    const yTicks = [
      Math.round(maxVal * 1.05),
      Math.round(maxVal * 0.75),
      Math.round(maxVal * 0.5),
      Math.round(maxVal * 0.25),
      0
    ];

    return (
      <div style={{
        background: '#ffffff',
        borderRadius: '1rem',
        padding: '1.5rem',
        border: '1px solid #e2e8f0',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        marginBottom: '1.5rem'
      }}>
        {/* Header with Title and Grain Toggle */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.5rem'
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>
              Evolución de ventas
            </h3>
          </div>

          {/* Grain Buttons: Diaria / Semanal / Mensual */}
          <div style={{
            display: 'inline-flex',
            background: '#f1f5f9',
            borderRadius: '0.5rem',
            padding: '3px',
            border: '1px solid #e2e8f0'
          }}>
            {[
              { id: 'daily', label: 'Diaria' },
              { id: 'weekly', label: 'Semanal' },
              { id: 'monthly', label: 'Mensual' },
              { id: 'yearly', label: 'Anual' }
            ].map(g => {
              const active = (timeGrain || 'daily') === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onTimeGrainChange && onTimeGrainChange(g.id)}
                  style={{
                    padding: '0.35rem 0.85rem',
                    fontSize: '0.82rem',
                    fontWeight: active ? 600 : 500,
                    borderRadius: '0.375rem',
                    border: 'none',
                    cursor: 'pointer',
                    background: active ? '#2563eb' : 'transparent',
                    color: active ? '#ffffff' : '#64748b',
                    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {g.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Chart Canvas with Y-Axis Grid */}
        <div style={{ display: 'flex', height: '220px', gap: '0.75rem' }}>
          {/* Y Axis Labels */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            width: '60px',
            fontSize: '0.75rem',
            color: '#64748b',
            paddingBottom: '22px'
          }}>
            {yTicks.map((t, idx) => (
              <span key={idx}>{t.toLocaleString('es-DO')}</span>
            ))}
          </div>

          {/* Bars Container */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            position: 'relative'
          }}>
            {/* Horizontal Grid lines */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: '22px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              pointerEvents: 'none'
            }}>
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} style={{ borderBottom: '1px dashed #e2e8f0', width: '100%' }} />
              ))}
            </div>

            {/* Bars */}
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-around',
              gap: '0.4rem',
              zIndex: 1,
              paddingBottom: '2px'
            }}>
              {rawData.map((item, idx) => {
                const amount = Number(item.total || 0);
                const heightPct = Math.max(6, Math.round((amount / maxVal) * 100));

                return (
                  <div 
                    key={idx}
                    style={{
                      flex: 1,
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'flex-end',
                      alignItems: 'center'
                    }}
                    title={`${item.label || item.date}: RD$ ${amount.toLocaleString('es-DO')}`}
                  >
                    <div 
                      style={{
                        width: '80%',
                        maxWidth: '48px',
                        height: `${heightPct}%`,
                        background: '#2563eb',
                        borderRadius: '3px 3px 0 0',
                        transition: 'all 0.2s ease',
                        cursor: 'pointer'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#1d4ed8';
                        e.currentTarget.style.transform = 'scaleY(1.02)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#2563eb';
                        e.currentTarget.style.transform = 'scaleY(1)';
                      }}
                    />
                  </div>
                );
              })}
            </div>

            {/* X Axis Labels */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-around',
              height: '22px',
              alignItems: 'center',
              borderTop: '1px solid #cbd5e1',
              paddingTop: '4px'
            }}>
              {rawData.map((item, idx) => (
                <div 
                  key={idx}
                  style={{
                    flex: 1,
                    textAlign: 'center',
                    fontSize: '0.72rem',
                    color: '#64748b',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {item.label || item.date}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '0.5rem',
          marginTop: '1rem',
          fontSize: '0.82rem',
          color: '#475569'
        }}>
          <span style={{
            display: 'inline-block',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: '#2563eb'
          }} />
          <span>Facturación</span>
        </div>
      </div>
    );
  }

  // 3. Donut / Payment Methods Breakdown Chart
  if (chartConfig.type === 'donut') {
    const rawData = data && data.length > 0 ? data : [
      { label: 'Efectivo', count: 180, amount: 210000, percentage: 46.7, color: '#10b981' },
      { label: 'Tarjeta de Crédito / Débito', count: 145, amount: 165000, percentage: 36.6, color: '#2563eb' },
      { label: 'Transferencia Bancaria', count: 35, amount: 50000, percentage: 11.1, color: '#8b5cf6' },
      { label: 'Otros / Beneficios', count: 15, amount: 25000, percentage: 5.6, color: '#f59e0b' }
    ];

    return (
      <div style={{
        background: '#ffffff',
        borderRadius: '1rem',
        padding: '1.5rem',
        border: '1px solid #e2e8f0',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        marginBottom: '1.5rem'
      }}>
        <div style={{ marginBottom: '1.25rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>
            Distribución de Cobros por Método
          </h3>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
            Participación porcentual y volumen cobrado en el período
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', alignItems: 'center' }}>
          {/* Progress Bars representation */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {rawData.map((item, idx) => (
              <div key={idx}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontWeight: 600, color: '#1e293b' }}>{item.label}</span>
                  <span style={{ fontWeight: 700, color: '#0f172a' }}>RD$ {Number(item.amount || 0).toLocaleString('es-DO')} ({item.percentage}%)</span>
                </div>
                <div style={{ width: '100%', height: '8px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${item.percentage}%`,
                    height: '100%',
                    background: item.color || '#2563eb',
                    borderRadius: '4px'
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 4. Generic / Comparison Bar Chart
  const items = data && data.length > 0 ? data : [];
  if (!items || items.length === 0) return null;

  const maxBar = Math.max(...items.map(i => Number(i.value || i.amount || i.count || 0)), 1);

  return (
    <div style={{
      background: '#ffffff',
      borderRadius: '1rem',
      padding: '1.5rem',
      border: '1px solid #e2e8f0',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      marginBottom: '1.5rem'
    }}>
      <h3 style={{ margin: '0 0 1.25rem', fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>
        {chartConfig.title || 'Análisis Gráfico'}
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        {items.map((item, idx) => {
          const val = Number(item.value || item.amount || item.count || 0);
          const rawPct = Math.round((val / maxBar) * 100);
          const pct = Math.max(10, rawPct);

          // Extract quantity and percentage
          let quantityText = '';
          let percentageText = '';

          if (item.percentage) {
            percentageText = String(item.percentage).includes('%') ? item.percentage : `${item.percentage}%`;
            quantityText = item.count != null 
              ? Number(item.count).toLocaleString('es-DO')
              : item.value != null 
                ? (typeof item.value === 'number' ? item.value.toLocaleString('es-DO') : String(item.value))
                : '';
          } else if (item.displayValue && typeof item.displayValue === 'string') {
            const match = item.displayValue.match(/^(.+?)\s*\(([\d.,]+%)\)$/);
            if (match) {
              quantityText = match[1].trim();
              percentageText = match[2].trim();
            } else {
              quantityText = item.displayValue;
            }
          } else {
            quantityText = val > 0 ? (item.isCurrency ? `RD$ ${val.toLocaleString('es-DO')}` : val.toLocaleString('es-DO')) : '0';
          }

          if (/^\d+$/.test(quantityText)) {
            quantityText = Number(quantityText).toLocaleString('es-DO');
          }

          const fullLabel = item.label || item.name || '';
          return (
            <div 
              key={idx} 
              style={{ 
                display: 'flex', 
                flexDirection: 'row',
                alignItems: 'center', 
                gap: '1rem',
                flexWrap: 'wrap',
                padding: '0.25rem 0'
              }}
            >
              <div 
                style={{ 
                  flex: '0 1 260px',
                  minWidth: '180px',
                  maxWidth: '340px',
                  fontSize: '0.85rem', 
                  fontWeight: 600, 
                  color: '#334155', 
                  lineHeight: '1.3',
                  wordBreak: 'break-word',
                  overflowWrap: 'anywhere'
                }} 
                title={fullLabel}
              >
                {fullLabel}
              </div>

              <div style={{ 
                flex: '1 1 240px', 
                minWidth: '200px',
                height: '28px', 
                background: '#f8fafc', 
                borderRadius: '6px', 
                overflow: 'hidden', 
                border: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center'
              }}>
                <div style={{
                  width: `${pct}%`,
                  minWidth: percentageText ? '96px' : '48px',
                  height: '100%',
                  background: 'linear-gradient(90deg, #1d4ed8 0%, #2563eb 100%)',
                  borderRadius: '5px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: percentageText ? 'space-between' : 'flex-start',
                  padding: '0 0.65rem',
                  color: '#ffffff',
                  fontSize: '0.78rem',
                  boxSizing: 'border-box',
                  transition: 'width 0.3s ease',
                  boxShadow: '0 1px 2px rgba(37, 99, 235, 0.15)'
                }}>
                  {/* Cantidad al inicio de la barra azul */}
                  <span style={{ fontWeight: 700, whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}>
                    {quantityText}
                  </span>

                  {/* Porcentaje al final del color azul */}
                  {percentageText && (
                    <span style={{ 
                      fontWeight: 700,
                      fontSize: '0.73rem',
                      color: '#ffffff',
                      background: 'rgba(0, 0, 0, 0.18)',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      whiteSpace: 'nowrap',
                      marginLeft: '0.4rem'
                    }}>
                      {percentageText}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

