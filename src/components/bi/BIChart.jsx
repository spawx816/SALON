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

