import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Users, TrendingUp, DollarSign, CalendarCheck, ArrowUpRight, 
  ShieldCheck, Award, User, X, BarChart3, MoreHorizontal, Sparkles
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useTranslation } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';

const WeeklyBilling8BarsChart = ({ billingData, onRefresh }) => {
  const [viewType, setViewType] = useState('bars'); // 'bars' | 'line'
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  // Default fallback data if empty or initial loading
  const defaultDays = [
    { dayName: 'Lun', dayLabel: '29 sep', currentAmount: 58400, previousAmount: 52000, variationPercent: 12.3 },
    { dayName: 'Mar', dayLabel: '30 sep', currentAmount: 73450, previousAmount: 68800, variationPercent: 6.8 },
    { dayName: 'Mié', dayLabel: '1 oct', currentAmount: 62100, previousAmount: 64100, variationPercent: -3.1 },
    { dayName: 'Jue', dayLabel: '2 oct', currentAmount: 68900, previousAmount: 65200, variationPercent: 5.6 },
    { dayName: 'Vie', dayLabel: '3 oct', currentAmount: 81750, previousAmount: 74700, variationPercent: 9.4 },
    { dayName: 'Sáb', dayLabel: '4 oct', currentAmount: 103200, previousAmount: 90400, variationPercent: 14.2 },
    { dayName: 'Dom', dayLabel: '5 oct', currentAmount: 80850, previousAmount: 75100, variationPercent: 7.6 },
  ];

  const defaultMonth = {
    title: 'Mes',
    subtitle: 'Octubre 2026',
    total: 1356780,
    variationPercent: 10.8
  };

  const days = billingData?.days?.length > 0 ? billingData.days : defaultDays;
  const month = billingData?.month || defaultMonth;

  // Max value among daily data to compute relative bar height (between 0% and 100%)
  const maxDaily = Math.max(
    ...days.map(d => Math.max(Number(d.currentAmount || 0), Number(d.previousAmount || 0))),
    10000
  );

  // Ceiling for grid lines (e.g. 140000, 120000, etc.)
  const ceiling = Math.max(Math.ceil(maxDaily / 20000) * 20000, 120000);
  const yTicks = [ceiling, ceiling * 0.85, ceiling * 0.7, ceiling * 0.55, ceiling * 0.4, ceiling * 0.25, 0];

  // Export to CSV
  const handleExportCSV = () => {
    const headers = ['Día', 'Fecha', 'Esta Semana (RD$)', 'Semana Anterior (RD$)', 'Variación (%)'];
    const rows = days.map(d => [
      d.dayName,
      d.dayLabel,
      d.currentAmount || 0,
      d.previousAmount || 0,
      `${d.variationPercent || 0}%`
    ]);
    rows.push([]);
    rows.push(['Mes', month.subtitle, month.total || 0, month.prev_to_date_total || 0, `${month.variationPercent || 0}%`]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `facturacion_semanal_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setIsMenuOpen(false);
  };

  // Copy Summary to Clipboard
  const handleCopySummary = () => {
    const weekTotal = days.reduce((sum, d) => sum + (Number(d.currentAmount) || 0), 0);
    const summaryText = `📊 Resumen de Facturación Plan Beauty:
• Total Semana en Curso: RD$ ${weekTotal.toLocaleString()}
• Acumulado Mes (${month.subtitle}): RD$ ${Number(month.total || 0).toLocaleString()} (Variación: ${month.variationPercent >= 0 ? '+' : ''}${month.variationPercent}%)`;
    navigator.clipboard.writeText(summaryText);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
    setIsMenuOpen(false);
  };

  // Compute SVG Points for Line View (Width = 700, Height = 165)
  const linePointsCurrent = days.map((d, i) => {
    const x = 50 + i * 85;
    const y = 165 - (d.isFuture ? 0 : (Math.min(Number(d.currentAmount || 0), ceiling) / ceiling) * 150);
    return { x, y, day: d };
  });

  const linePointsPrev = days.map((d, i) => {
    const x = 50 + i * 85;
    const y = 165 - (Math.min(Number(d.previousAmount || 0), ceiling) / ceiling) * 150;
    return { x, y, day: d };
  });

  const makePath = (points) => {
    return points.reduce((acc, p, i, a) => {
      if (i === 0) return `M ${p.x},${p.y}`;
      const prev = a[i - 1];
      const cpX1 = prev.x + (p.x - prev.x) / 2;
      const cpY1 = prev.y;
      const cpX2 = prev.x + (p.x - prev.x) / 2;
      const cpY2 = p.y;
      return `${acc} C ${cpX1},${cpY1} ${cpX2},${cpY2} ${p.x},${p.y}`;
    }, '');
  };

  const pathCurrent = makePath(linePointsCurrent.filter(p => !p.day.isFuture));
  const pathPrev = makePath(linePointsPrev);

  return (
    <div className="surface-card" style={{ marginTop: '1.5rem', background: '#ffffff', borderRadius: '24px', border: '1px solid #e2e8f0', boxShadow: '0 4px 20px rgba(0,0,0,0.03)', padding: '1.75rem 2rem', position: 'relative' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h3 style={{ fontSize: '1.35rem', fontWeight: 900, color: '#09090b', margin: '0 0 0.5rem 0', letterSpacing: '-0.02em' }}>Facturación</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, color: '#09090b' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#2563eb', display: 'inline-block' }} />
              Esta semana
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, color: '#64748b' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#bfdbfe', display: 'inline-block' }} />
              Semana anterior
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', position: 'relative' }}>
          <div style={{ display: 'flex', background: '#f1f5f9', padding: '0.25rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <button 
              type="button"
              onClick={() => setViewType('bars')} 
              style={{ 
                background: viewType === 'bars' ? '#09090b' : 'transparent', 
                color: viewType === 'bars' ? '#ffffff' : '#64748b',
                border: 'none', 
                borderRadius: '8px', 
                padding: '0.4rem 0.65rem', 
                display: 'flex', 
                alignItems: 'center', 
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: viewType === 'bars' ? '0 2px 6px rgba(0,0,0,0.1)' : 'none'
              }}
              title="Vista de Barras"
            >
              <BarChart3 size={16} />
            </button>
            <button 
              type="button"
              onClick={() => setViewType('line')} 
              style={{ 
                background: viewType === 'line' ? '#09090b' : 'transparent', 
                color: viewType === 'line' ? '#ffffff' : '#64748b',
                border: 'none', 
                borderRadius: '8px', 
                padding: '0.4rem 0.65rem', 
                display: 'flex', 
                alignItems: 'center', 
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: viewType === 'line' ? '0 2px 6px rgba(0,0,0,0.1)' : 'none'
              }}
              title="Vista de Tendencia (Líneas)"
            >
              <TrendingUp size={16} />
            </button>
          </div>

          <button 
            type="button"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            style={{ 
              background: isMenuOpen ? '#09090b' : '#f8fafc', 
              border: '1px solid #e2e8f0', 
              borderRadius: '12px', 
              padding: '0.4rem 0.65rem', 
              color: isMenuOpen ? '#ffffff' : '#64748b', 
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              transition: 'all 0.2s'
            }}
            title="Opciones"
          >
            <MoreHorizontal size={18} />
          </button>

          {/* 3-Dots Dropdown Menu */}
          {isMenuOpen && (
            <>
              <div 
                style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 90 }} 
                onClick={() => setIsMenuOpen(false)} 
              />
              <div style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '0.5rem',
                background: '#ffffff',
                borderRadius: '16px',
                boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                border: '1px solid #e2e8f0',
                padding: '0.5rem',
                zIndex: 100,
                minWidth: '210px',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem'
              }}>
                <button
                  type="button"
                  onClick={() => { onRefresh(); setIsMenuOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.65rem 0.85rem',
                    background: 'none', border: 'none', borderRadius: '10px', fontSize: '0.8rem',
                    fontWeight: 600, color: '#09090b', cursor: 'pointer', textAlign: 'left',
                    transition: 'background 0.2s'
                  }}
                  onMouseOver={e => e.currentTarget.style.background = '#f1f5f9'}
                  onMouseOut={e => e.currentTarget.style.background = 'none'}
                >
                  <span>🔄</span> Actualizar Datos
                </button>
                <button
                  type="button"
                  onClick={handleExportCSV}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.65rem 0.85rem',
                    background: 'none', border: 'none', borderRadius: '10px', fontSize: '0.8rem',
                    fontWeight: 600, color: '#09090b', cursor: 'pointer', textAlign: 'left',
                    transition: 'background 0.2s'
                  }}
                  onMouseOver={e => e.currentTarget.style.background = '#f1f5f9'}
                  onMouseOut={e => e.currentTarget.style.background = 'none'}
                >
                  <span>📥</span> Exportar a Excel (CSV)
                </button>
                <button
                  type="button"
                  onClick={handleCopySummary}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.65rem 0.85rem',
                    background: 'none', border: 'none', borderRadius: '10px', fontSize: '0.8rem',
                    fontWeight: 600, color: '#09090b', cursor: 'pointer', textAlign: 'left',
                    transition: 'background 0.2s'
                  }}
                  onMouseOver={e => e.currentTarget.style.background = '#f1f5f9'}
                  onMouseOut={e => e.currentTarget.style.background = 'none'}
                >
                  <span>📋</span> Copiar Resumen
                </button>
              </div>
            </>
          )}

          {copyFeedback && (
            <div style={{
              position: 'absolute',
              top: '-35px',
              right: 0,
              background: '#09090b',
              color: '#ffffff',
              fontSize: '0.75rem',
              fontWeight: 700,
              padding: '0.3rem 0.75rem',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              zIndex: 110,
              whiteSpace: 'nowrap'
            }}>
              ✓ ¡Copiado al portapapeles!
            </div>
          )}
        </div>
      </div>

      {/* Chart Canvas Area */}
      <div style={{ position: 'relative', height: '330px', width: '100%', display: 'flex', alignItems: 'flex-end', paddingTop: '40px', paddingBottom: '30px' }}>
        
        {/* Horizontal Background Grid Lines */}
        <div style={{ position: 'absolute', top: 40, left: 0, right: 0, bottom: 30, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', pointerEvents: 'none' }}>
          {yTicks.map((tickVal, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              <span style={{ width: '85px', fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, textAlign: 'left' }}>
                RD$ {Math.round(tickVal).toLocaleString()}
              </span>
              <div style={{ flex: 1, borderBottom: '1px dashed #e2e8f0', height: '1px' }} />
            </div>
          ))}
        </div>

        {/* Content Container (Bars vs Line Trend) */}
        <div style={{ position: 'relative', zIndex: 2, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr) 1.25fr', width: '100%', height: '100%', paddingLeft: '90px', gap: '0.75rem' }}>
          
          {/* First 7 Daily Columns */}
          {days.map((day, idx) => {
            const curHeightPct = day.isFuture ? 0 : Math.min(Math.max((Number(day.currentAmount || 0) / ceiling) * 100, (day.currentAmount > 0 ? 4 : 0)), 100);
            const prevHeightPct = Math.min(Math.max((Number(day.previousAmount || 0) / ceiling) * 100, (day.previousAmount > 0 ? 4 : 0)), 100);
            const isPositive = (day.variationPercent || 0) >= 0;

            return (
              <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', position: 'relative' }}>
                
                {/* Metric Tooltip / Amount Above Bars */}
                <div style={{ textAlign: 'center', marginBottom: '0.5rem', whiteSpace: 'nowrap' }}>
                  <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 800, color: day.isFuture ? '#94a3b8' : '#09090b', letterSpacing: '-0.01em' }}>
                    {day.isFuture ? 'RD$ 0' : `RD$ ${Number(day.currentAmount || 0).toLocaleString()}`}
                  </p>
                  {day.isFuture ? (
                    <span style={{ fontSize: '0.68rem', fontWeight: 600, color: '#94a3b8', display: 'inline-block', marginTop: '0.1rem' }}>
                      —
                    </span>
                  ) : (
                    <span style={{ 
                      fontSize: '0.68rem', 
                      fontWeight: 700, 
                      color: isPositive ? '#16a34a' : '#dc2626',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.15rem',
                      marginTop: '0.1rem'
                    }}>
                      {isPositive ? '↑' : '↓'} {Math.abs(day.variationPercent || 0)}%
                    </span>
                  )}
                </div>

                {/* BARS VIEW */}
                {viewType === 'bars' && (
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '5px', height: '165px', width: '100%', justifyContent: 'center' }}>
                    {/* Current Week Bar */}
                    <div 
                      title={`Esta semana (${day.dayName}): RD$ ${Number(day.currentAmount || 0).toLocaleString()}`}
                      style={{ 
                        width: '42%', 
                        maxWidth: '30px',
                        height: `${curHeightPct}%`, 
                        background: 'linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)', 
                        borderRadius: '8px 8px 0 0',
                        transition: 'height 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                        boxShadow: '0 4px 10px rgba(37, 99, 235, 0.2)'
                      }} 
                    />
                    {/* Previous Week Bar */}
                    <div 
                      title={`Semana anterior: RD$ ${Number(day.previousAmount || 0).toLocaleString()}`}
                      style={{ 
                        width: '42%', 
                        maxWidth: '30px',
                        height: `${prevHeightPct}%`, 
                        background: '#dbeafe', 
                        borderRadius: '8px 8px 0 0',
                        transition: 'height 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
                      }} 
                    />
                  </div>
                )}

                {/* LINE VIEW (Dots on column) */}
                {viewType === 'line' && (
                  <div style={{ display: 'flex', alignItems: 'flex-end', height: '165px', width: '100%', justifyContent: 'center', position: 'relative' }}>
                    {/* Dot Current Week */}
                    {!day.isFuture && (
                      <div 
                        title={`Esta semana: RD$ ${Number(day.currentAmount || 0).toLocaleString()}`}
                        style={{
                          position: 'absolute',
                          bottom: `${curHeightPct}%`,
                          width: '12px',
                          height: '12px',
                          borderRadius: '50%',
                          background: '#2563eb',
                          border: '2.5px solid #ffffff',
                          boxShadow: '0 0 10px rgba(37, 99, 235, 0.5)',
                          transform: 'translateY(50%)',
                          zIndex: 5
                        }}
                      />
                    )}
                    {/* Dot Prev Week */}
                    <div 
                      title={`Semana anterior: RD$ ${Number(day.previousAmount || 0).toLocaleString()}`}
                      style={{
                        position: 'absolute',
                        bottom: `${prevHeightPct}%`,
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: '#93c5fd',
                        border: '2px solid #ffffff',
                        transform: 'translateY(50%)',
                        zIndex: 4
                      }}
                    />
                    {/* Soft column highlight */}
                    <div style={{ width: '2px', height: '100%', background: 'rgba(226, 232, 240, 0.4)' }} />
                  </div>
                )}

                {/* Bottom Day Label */}
                <div style={{ textAlign: 'center', marginTop: '0.75rem' }}>
                  <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 800, color: '#0f172a' }}>{day.dayName}</p>
                  <p style={{ margin: '0.1rem 0 0 0', fontSize: '0.68rem', color: '#64748b', fontWeight: 500 }}>{day.dayLabel}</p>
                </div>
              </div>
            );
          })}

          {/* 8th Column: Mes en Curso */}
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'flex-end', 
            height: '100%', 
            position: 'relative',
            borderLeft: '2px dashed #cbd5e1',
            paddingLeft: '0.75rem'
          }}>
            {/* Amount Above Month Bar */}
            <div style={{ textAlign: 'center', marginBottom: '0.5rem', whiteSpace: 'nowrap' }}>
              <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 900, color: '#09090b', letterSpacing: '-0.01em' }}>
                RD$ {Number(month.total || 0).toLocaleString()}
              </p>
              <span style={{ 
                fontSize: '0.7rem', 
                fontWeight: 800, 
                color: (month.variationPercent || 0) >= 0 ? '#16a34a' : '#dc2626',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.15rem',
                marginTop: '0.1rem'
              }}>
                {(month.variationPercent || 0) >= 0 ? '↑' : '↓'} {Math.abs(month.variationPercent || 0)}%
              </span>
            </div>

            {/* Month Bar / Metric */}
            <div style={{ display: 'flex', alignItems: 'flex-end', height: '165px', width: '100%', justifyContent: 'center' }}>
              <div 
                title={`Total Mes: RD$ ${Number(month.total || 0).toLocaleString()} (Comparado del 1 al día actual del mes anterior: ${month.variationPercent >= 0 ? '+' : ''}${month.variationPercent}%)`}
                style={{ 
                  width: '55%', 
                  maxWidth: '42px',
                  height: '82%', 
                  background: 'linear-gradient(180deg, #6366f1 0%, #4f46e5 100%)', 
                  borderRadius: '10px 10px 0 0',
                  boxShadow: '0 6px 16px rgba(79, 70, 229, 0.25)',
                  transition: 'height 0.4s ease-out'
                }} 
              />
            </div>

            {/* Bottom Month Label */}
            <div style={{ textAlign: 'center', marginTop: '0.75rem' }}>
              <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 900, color: '#0f172a' }}>{month.title || 'Mes'}</p>
              <p style={{ margin: '0.1rem 0 0 0', fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>{month.subtitle}</p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

const MetricCard = ({ title, value, trend, icon: Icon, color = '#09090b', bg = '#f8fafc', onViewDetails }) => (
  <div className="surface-card" style={{ border: '1px solid var(--border-subtle)', boxShadow: '0 4px 12px rgba(0,0,0,0.03)', position: 'relative', overflow: 'hidden' }}>
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '4px', background: color }}></div>
    <div className="metric-header" style={{ marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div className="metric-icon" style={{ background: bg, border: 'none', width: '40px', height: '40px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={20} strokeWidth={2.5} color={color} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {trend && (
          <div className="metric-trend" style={{ fontWeight: 800, background: bg, color: color, padding: '0.2rem 0.6rem', borderRadius: '20px', fontSize: '0.65rem' }}>
            {trend}
          </div>
        )}
      </div>
    </div>
    <div>
      <p className="metric-title" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', fontWeight: 800 }}>{title}</p>
      <h3 className="metric-value" style={{ fontSize: '2rem', marginTop: '0.25rem', letterSpacing: '-0.02em', fontWeight: 900 }}>{value}</h3>
    </div>
    {onViewDetails && (
      <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px dashed #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
        <button 
          onClick={onViewDetails}
          style={{ 
            background: 'none', 
            border: 'none', 
            color: color, 
            fontSize: '0.75rem', 
            fontWeight: 700, 
            cursor: 'pointer', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.3rem',
            padding: '0.2rem 0'
          }}
        >
          Ver detalles <ArrowUpRight size={14} />
        </button>
      </div>
    )}
  </div>
);

const Dashboard = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();

  const [stats, setStats] = useState({ todayVisits: 0, activeClients: 0, monthlyRevenue: 0, dailySales: 0 });
  const [breakdowns, setBreakdowns] = useState({ salons: [], visits: [], memberships: [], dailySales: [] });
  const [activeDetailModal, setActiveDetailModal] = useState(null); // 'visits' | 'memberships' | 'dailySales' | null
  const [recentVisits, setRecentVisits] = useState([]);
  const [allVisits, setAllVisits] = useState([]);
  const [planUsages, setPlanUsages] = useState([]);
  const [trafficData, setTrafficData] = useState([]);
  const [billingComparison, setBillingComparison] = useState(null);
  const [securityRequests, setSecurityRequests] = useState([]);
  const [isVisitsModalOpen, setIsVisitsModalOpen] = useState(false);
  const [loadingVisits, setLoadingVisits] = useState(false);

  const isPlanBeautyVisit = (v) => {
    if (!v) return false;
    const isGuest = !v.client_id || 
                    v.client_id === 'INVITADO' || 
                    v.client_id === 'generico' || 
                    (typeof v.client_id === 'string' && v.client_id.toLowerCase().includes('invitado')) ||
                    (v.client_name && v.client_name.toLowerCase().includes('invitado'));
    if (isGuest) return false;

    const paymentIsPlan = typeof v.metodo_pago === 'string' && v.metodo_pago.toLowerCase().includes('plan');
    const serviceIsPlan = (typeof v.servicios === 'string' && v.servicios.toLowerCase().includes('plan')) ||
                          (Array.isArray(v.servicios) && v.servicios.some(s => typeof s === 'string' && s.toLowerCase().includes('plan')));
    const hasPlanBenefit = Boolean(v.is_plan_benefit || v.plan_name || v.membership);

    return Boolean(paymentIsPlan || serviceIsPlan || hasPlanBenefit);
  };

  const handleViewAllVisits = async () => {
    setIsVisitsModalOpen(true);
    setLoadingVisits(true);
    try {
      const visits = await dataService.getVisits();
      // Filter Plan Beauty visits only (exclude generic and guests)
      const planVisits = (visits || []).filter(isPlanBeautyVisit);
      setAllVisits(planVisits);
    } catch (e) {
      console.error("Error al obtener visitas", e);
    } finally {
      setLoadingVisits(false);
    }
  };

  const fetchBillingComparison = async () => {
    const data = await dataService.getWeeklyBillingComparison();
    if (data) {
      setBillingComparison(data);
    }
  };

  useEffect(() => {
    const load = async () => {
      const summary = await dataService.getDashboardSummary();
      const usages = await dataService.getPlanUsages();
      if (summary) {
        setStats({
          visits: summary.metrics.todayVisits,
          clients: summary.metrics.activeClients,
          revenue: summary.metrics.monthlyRevenue,
          dailySales: summary.metrics.dailySales
        });
        if (summary.breakdowns) {
          setBreakdowns(summary.breakdowns);
        }
        // Filter recent visits exclusively for Plan Beauty members
        const planVisits = (summary.recentVisits || []).filter(isPlanBeautyVisit);
        setRecentVisits(planVisits);
        setAllVisits(planVisits);
      }
      setPlanUsages(usages);
    };

    const fetchSecurity = async () => {
      const security = await dataService.getSecurityRequests();
      setSecurityRequests(security);
    };

    load();
    fetchSecurity();
    fetchBillingComparison();
    
    // Auto-refresh security requests every 10 seconds
    const interval = setInterval(fetchSecurity, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleExport = async () => {
    try {
      // 1. Obtener todas las visitas históricas del servidor
      const visits = await dataService.getVisits();
      if (!visits || visits.length === 0) {
        alert("No hay visitas para exportar.");
        return;
      }

      // 2. Obtener todas las sucursales para mapear sus nombres
      const salonsMap = new Map();
      try {
        const salonsList = await dataService.getSalons();
        if (salonsList && Array.isArray(salonsList)) {
          salonsList.forEach(s => salonsMap.set(s.id?.toString(), s.name));
        }
      } catch (err) {
        console.error("Error cargando sucursales para exportación:", err);
      }

      // 3. Cabeceras claras, profesionales e inteligibles
      const headers = [
        "ID de Visita",
        "Nombre del Cliente",
        "Fecha de la Visita",
        "Servicios Prestados",
        "Estilista / Peluquera",
        "Manicurista",
        "Monto Facturado (RD$)",
        "Sucursal / Localidad",
        "Próxima Cita Planificada",
        "Recordatorio Enviado"
      ];

      // 4. Mapear filas con formatos limpios y medibles
      const rows = visits.map(v => {
        const visitedDate = v.visited_at ? new Date(v.visited_at) : null;
        const formattedDate = visitedDate 
          ? `${visitedDate.getFullYear()}-${String(visitedDate.getMonth() + 1).padStart(2, '0')}-${String(visitedDate.getDate()).padStart(2, '0')} ${String(visitedDate.getHours()).padStart(2, '0')}:${String(visitedDate.getMinutes()).padStart(2, '0')}`
          : 'N/A';

        const nextDate = v.proxima_fecha ? new Date(v.proxima_fecha) : null;
        const formattedNextDate = nextDate
          ? `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`
          : 'Sin programar';

        // Valores numéricos limpios para que Excel pueda sumarlos
        const totalFormatted = v.total ? Number(v.total).toFixed(2) : '0.00';
        const recordatorioText = v.recordatorio_auto === 1 || v.recordatorio_auto === true ? "Sí" : "No";
        const sucursalName = salonsMap.get(v.salon_id?.toString()) || v.salon_name || "Sede Central";

        return [
          v.id,
          v.client_name || v.clientName || "Cliente Desconocido",
          formattedDate,
          Array.isArray(v.servicios) ? v.servicios.join(' + ') : (v.servicios || 'Ninguno'),
          v.empleado_peluquera || 'No asignada',
          v.empleado_manicurista || 'No asignada',
          totalFormatted,
          sucursalName,
          formattedNextDate,
          recordatorioText
        ];
      });

      // 5. Generar CSV con punto y coma (;) como delimitador estándar para Excel en español
      const csvContent = [headers, ...rows].map(e => e.map(val => {
        const cleaned = String(val ?? '').replace(/"/g, '""');
        return `"${cleaned}"`;
      }).join(";")).join("\n");

      // 6. Añadir el BOM de UTF-8 (\uFEFF) para evitar que se rompan las tildes/eñes en Excel
      const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `reporte_visitas_completo_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Error al exportar reporte:", err);
      alert("Hubo un error al generar el reporte de exportación.");
    }
  };

  return (
    <div style={{ background: '#ffffff', minHeight: '100%', padding: '0 0 2rem 0' }}>
      <div className="metrics-grid" style={{ marginTop: 0, paddingTop: 0 }}>
        <MetricCard 
          title="Visitas de Hoy" 
          value={stats.visits || 0} 
          trend="Real-time" 
          icon={CalendarCheck} 
          color="#3b82f6" 
          bg="#eff6ff" 
          onViewDetails={() => setActiveDetailModal('visits')}
        />
        <MetricCard 
          title="Membresías Activas" 
          value={stats.clients || 0} 
          trend="Live" 
          icon={Users} 
          color="#10b981" 
          bg="#ecfdf5" 
          onViewDetails={() => setActiveDetailModal('memberships')}
        />
        <MetricCard 
          title="Ventas Diarias" 
          value={`RD$ ${stats.dailySales ? Number(stats.dailySales).toLocaleString(undefined, {maximumFractionDigits:0}) : '0'}`} 
          trend="Hoy" 
          icon={TrendingUp} 
          color="#8b5cf6" 
          bg="#f5f3ff" 
          onViewDetails={() => setActiveDetailModal('dailySales')}
        />
        <MetricCard 
          title="Ingresos Estimados" 
          value={`RD$ ${stats.revenue ? Number(stats.revenue).toLocaleString() : '0'}`} 
          trend="Monthly" 
          icon={DollarSign} 
          color="#09090b" 
          bg="#f1f5f9" 
        />
      </div>

      {/* 8-Bar Facturación Weekly & Monthly Comparison Chart */}
      <WeeklyBilling8BarsChart billingData={billingComparison} onRefresh={fetchBillingComparison} />

      {/* Security Requests Section */}
      {(securityRequests.length > 0 || (currentUser?.role === 'admin' || currentUser?.role_name === 'Administrador')) && (
        <div className="surface-card" style={{ marginTop: '1.5rem', border: '1px solid #e2e8f0', background: 'white' }}>
          <div className="chart-header" style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
               <div style={{ background: '#09090b', color: 'white', padding: '0.5rem', borderRadius: '12px' }}>
                 <Users size={18} />
               </div>
               <div>
                 <h3 className="chart-title">Monitor de Seguridad</h3>
                 <p className="chart-subtitle">Códigos activos para autorizar servicios en recepción.</p>
               </div>
            </div>
            <button 
              onClick={async () => {
                const security = await dataService.getSecurityRequests();
                setSecurityRequests(security);
              }}
              style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '0.5rem 1rem', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 700, color: '#09090b', cursor: 'pointer' }}
            >
              🔄 Sincronizar
            </button>
          </div>
          
          {securityRequests.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
              {securityRequests.map((req, idx) => (
                <div key={idx} style={{ background: '#fafafa', padding: '1.5rem', borderRadius: '24px', border: '1px solid #f1f5f9', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1.25rem' }}>
                     <div>
                       <p style={{ fontSize: '1rem', fontWeight: 900, margin: 0, color: '#09090b' }}>{req.client_name}</p>
                       <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0.25rem 0 0', fontWeight: 500 }}>Solicitado: {new Date(req.created_at).toLocaleTimeString()}</p>
                     </div>
                     <span style={{ fontSize: '0.65rem', fontWeight: 800, background: '#fefce8', color: '#a16207', padding: '0.4rem 0.75rem', borderRadius: '8px', border: '1px solid #fef08a' }}>PENDIENTE</span>
                  </div>
                  <div style={{ background: 'white', padding: '1rem', borderRadius: '16px', border: '1px solid #f1f5f9', marginBottom: '1.25rem' }}>
                     <p style={{ fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', marginBottom: '0.4rem', textTransform: 'uppercase' }}>Servicio Solicitado</p>
                     <p style={{ fontSize: '0.85rem', fontWeight: 700, margin: 0, color: '#1e293b' }}>{req.service_name}</p>
                  </div>
                  <div style={{ textAlign: 'center', padding: '1.25rem', background: '#09090b', borderRadius: '18px', boxShadow: '0 10px 20px rgba(0,0,0,0.1)' }}>
                     <p style={{ fontSize: '0.65rem', fontWeight: 800, color: 'rgba(255,255,255,0.4)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Código para Recepción</p>
                     <p style={{ fontSize: '2rem', fontWeight: 900, color: '#d4af37', letterSpacing: '6px', margin: 0, fontFamily: 'monospace' }}>
                       {req.active_code}
                     </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '3.5rem 2rem', background: '#f8fafc', borderRadius: '24px', border: '1px dashed #cbd5e1' }}>
               <div style={{ width: '56px', height: '56px', background: '#f1f5f9', borderRadius: '50%', margin: '0 auto 1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
                 <ShieldCheck size={28} />
               </div>
               <h4 style={{ color: '#334155', fontWeight: 800, fontSize: '1.05rem', marginBottom: '0.4rem' }}>Sistema Seguro</h4>
               <p style={{ color: '#64748b', fontWeight: 500, fontSize: '0.85rem' }}>No hay solicitudes de seguridad activas en este momento.</p>
            </div>
          )}
        </div>
      )}

      {/* Grid: Uso de Servicios por Plan & Visitas Recientes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
        {/* Plan Usage Section */}
        <div className="surface-card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div className="chart-header" style={{ marginBottom: '1.25rem' }}>
            <div>
              <h3 className="chart-title">Uso de Servicios por Plan</h3>
              <p className="chart-subtitle">Clientes atendidos con suscripción este mes</p>
            </div>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto', maxHeight: '460px', paddingRight: '0.25rem' }} className="hide-scrollbar">
            {planUsages.length > 0 ? planUsages.map((usage, idx) => (
              <div key={idx} style={{ 
                padding: '1.25rem', 
                border: '1px solid #e2e8f0', 
                borderRadius: '16px',
                backgroundColor: 'white',
                boxShadow: '0 2px 6px rgba(0,0,0,0.02)'
              }}>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <div style={{ width: '36px', height: '36px', background: '#f8fafc', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#09090b', border: '1px solid #f1f5f9' }}>
                    <Award size={18} />
                  </div>
                  <div>
                    <h4 style={{ fontWeight: '800', margin: 0, color: '#09090b', fontSize: '0.95rem' }}>
                      {usage.plan_name}
                    </h4>
                  </div>
                </div>
                <p style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '1rem', fontWeight: 500 }}>
                  Incluye: {usage.plan_services?.join(', ') || 'N/A'}
                </p>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div style={{ background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '12px', border: '1px solid #f1f5f9' }}>
                    <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#94a3b8', fontWeight: '800', letterSpacing: '0.05em', margin: 0 }}>
                      Clientes
                    </p>
                    <p style={{ fontSize: '1.35rem', fontWeight: '800', color: '#0f172a', margin: '0.2rem 0 0' }}>
                      {usage.unique_clients_used}
                    </p>
                  </div>
                  <div style={{ background: '#f0fdf4', padding: '0.75rem 1rem', borderRadius: '12px', border: '1px solid #dcfce7' }}>
                    <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#166534', fontWeight: '800', letterSpacing: '0.05em', margin: 0 }}>
                      Servicios (Visitas)
                    </p>
                    <p style={{ fontSize: '1.35rem', fontWeight: '800', color: '#14532d', margin: '0.2rem 0 0' }}>
                      {usage.total_visits}
                    </p>
                  </div>
                </div>
              </div>
            )) : (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#71717a', background: '#f8fafc', borderRadius: '16px', border: '1px dashed #e2e8f0' }}>
                No hay clientes que hayan utilizado sus planes este mes.
              </div>
            )}
          </div>
        </div>

        {/* Recent Traffic */}
        <div className="surface-card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div className="chart-header" style={{ marginBottom: '1.25rem' }}>
            <div>
              <h3 className="chart-title">{t('dash.recent.title')}</h3>
              <p className="chart-subtitle">Últimas socias Plan Beauty atendidas</p>
            </div>
            <button 
              onClick={handleViewAllVisits} 
              style={{ border: '1px solid #e2e8f0', background: '#f8fafc', padding: '0.4rem 0.8rem', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', color: '#09090b', fontSize: '0.8rem' }}
            >
              {t('dash.recent.all')}
            </button>
          </div>
          <div className="visits-list hide-scrollbar" style={{ overflowY: 'auto', maxHeight: '460px' }}>
            {recentVisits.length > 0 ? recentVisits.map((visit, idx) => (
              <div key={idx} className="visit-item" style={{ padding: '0.75rem 0', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div className="visit-avatar" style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#f1f5f9', color: '#09090b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', fontWeight: 800, border: '1px solid #e2e8f0', flexShrink: 0 }}>
                  {(visit.client_name || visit.clientName)?.charAt(0) || <User size={18} />}
                </div>
                <div className="visit-details" style={{ flex: 1, minWidth: 0 }}>
                  <p className="visit-name" style={{ fontSize: '0.875rem', fontWeight: 800, color: '#09090b', marginBottom: '0.1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{visit.client_name || visit.clientName || 'Cliente'}</p>
                  <p className="visit-service" style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {Array.isArray(visit.servicios) ? visit.servicios.join(', ') : (typeof visit.servicios === 'string' ? visit.servicios : t('dash.service.fallback'))}
                  </p>
                </div>
                <div className="visit-meta" style={{ textAlign: 'right', flexShrink: 0 }}>
                  <p className="visit-date" style={{ fontWeight: 800, fontSize: '0.8rem', color: '#09090b' }}>
                    {new Date(visit.visited_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })} - {new Date(visit.visited_at).toLocaleTimeString(undefined, {hour: '2-digit', minute:'2-digit'})}
                  </p>
                  <p className="visit-status" style={{ fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>{visit.salon_name || 'Central'}</p>
                </div>
              </div>
            )) : (
              <div style={{ textAlign: 'center', padding: '2rem 0', color: '#71717a', fontSize: '0.875rem' }}>{t('dash.recent.empty')}</div>
            )}
          </div>
        </div>
      </div>

             {/* Modal de Visitas */}
      {isVisitsModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(9, 9, 11, 0.6)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', animation: 'fadeIn 0.2s ease-out' }}>
          <div style={{ background: '#fff', borderRadius: '24px', width: '100%', maxWidth: '650px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', overflow: 'hidden' }}>
            
            <div style={{ padding: '1.75rem 2rem', borderBottom: '1px solid rgba(226, 232, 240, 0.8)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(to right, #fafafa, #ffffff)' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '800', color: '#09090b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CalendarCheck size={20} color="#8b5cf6" /> Historial de Visitas Plan Beauty
                </h3>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>Registro detallado de visitas de socias Plan Beauty</p>
              </div>
              <button 
                onClick={() => setIsVisitsModalOpen(false)} 
                style={{ border: 'none', background: '#f1f5f9', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748b', transition: 'all 0.2s' }}
                onMouseOver={(e) => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.color = '#0f172a'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#64748b'; }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '1rem 2rem', overflowY: 'auto', flex: 1, background: '#fafafa' }}>
              {loadingVisits ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8b5cf6', padding: '3rem' }}>
                  <div className="spinner" style={{ width: '40px', height: '40px', border: '3px solid rgba(139, 92, 246, 0.2)', borderTopColor: '#8b5cf6', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: '1rem' }}></div>
                  <p style={{ fontWeight: 600 }}>Cargando visitas...</p>
                </div>
              ) : allVisits.length > 0 ? (
                <div className="visits-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {allVisits.map((visit, idx) => (
                    <div key={idx} className="visit-item" style={{ background: '#fff', padding: '1.25rem', borderRadius: '16px', border: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '1rem', transition: 'all 0.2s', cursor: 'default', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}
                      onMouseOver={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0,0,0,0.05)'; }}
                      onMouseOut={(e) => { e.currentTarget.style.borderColor = '#f1f5f9'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.02)'; }}
                    >
                      <div className="visit-avatar" style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)', color: '#09090b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', fontWeight: 800, border: '1px solid #e2e8f0' }}>
                        {(visit.client_name || visit.clientName)?.charAt(0).toUpperCase() || <User size={24} color="#94a3b8" />}
                      </div>
                      
                      <div className="visit-details" style={{ flex: 1 }}>
                        <p className="visit-name" style={{ fontSize: '0.95rem', fontWeight: 800, color: '#09090b', margin: '0 0 0.25rem 0' }}>{visit.client_name || visit.clientName || 'Cliente No Registrado'}</p>
                        <p className="visit-service" style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 500, margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#8b5cf6' }}></span>
                          {Array.isArray(visit.servicios) ? visit.servicios.join(', ') : (typeof visit.servicios === 'string' ? visit.servicios : 'Servicio General')}
                        </p>
                      </div>

                      <div className="visit-time" style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
                        <span style={{ display: 'inline-block', padding: '0.25rem 0.6rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 700, color: '#334155' }}>
                          {new Date(visit.visited_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })} - {new Date(visit.visited_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: '#8b5cf6', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {visit.salon_name || 'SUCURSAL'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center', color: '#64748b', padding: '4rem 2rem', background: '#fff', borderRadius: '16px', border: '1px dashed #cbd5e1' }}>
                  <CalendarCheck size={48} color="#cbd5e1" style={{ marginBottom: '1rem' }} />
                  <h4 style={{ margin: '0 0 0.5rem 0', color: '#0f172a', fontSize: '1.1rem' }}>No hay visitas</h4>
                  <p style={{ margin: 0, fontSize: '0.9rem' }}>Aún no se han registrado visitas en el sistema.</p>
                </div>
              )}
            </div>
          </div>
          <style>{`
            @keyframes fadeIn {
              from { opacity: 0; backdrop-filter: blur(0px); }
              to { opacity: 1; backdrop-filter: blur(4px); }
            }
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}

      {/* Modal de Desglose de Métricas (Ver Detalles) */}
      {activeDetailModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(9, 9, 11, 0.65)', backdropFilter: 'blur(6px)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', animation: 'fadeIn 0.2s ease-out' }}>
          <div style={{ background: '#fff', borderRadius: '24px', width: '100%', maxWidth: '800px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.3)', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
            
            {/* Modal Header */}
            <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, #09090b 0%, #18181b 100%)', color: 'white' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '900', color: 'white', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  {activeDetailModal === 'visits' && <><CalendarCheck size={22} color="#60a5fa" /> Desglose de Visitas de Hoy</>}
                  {activeDetailModal === 'memberships' && <><Users size={22} color="#34d399" /> Desglose de Membresías Activas</>}
                  {activeDetailModal === 'dailySales' && <><TrendingUp size={22} color="#c084fc" /> Desglose de Ventas Diarias (Hoy)</>}
                </h3>
                <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.8rem', color: '#a1a1aa' }}>
                  {activeDetailModal === 'visits' && 'Distribución en tiempo real por sucursal y tipo de atención (Plan Beauty vs. Genérica).'}
                  {activeDetailModal === 'memberships' && 'Cantidad de contratos activos segmentados por sucursal de afiliación.'}
                  {activeDetailModal === 'dailySales' && 'Ingresos facturados y cobrados en el día clasificados por sucursal.'}
                </p>
              </div>
              <button 
                onClick={() => setActiveDetailModal(null)} 
                style={{ border: 'none', background: 'rgba(255,255,255,0.15)', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'white' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ padding: '2rem', overflowY: 'auto', flex: 1, background: '#fafafa' }}>
              
              {/* Matrix: Visitas de Hoy */}
              {activeDetailModal === 'visits' && (() => {
                const salons = breakdowns.salons && breakdowns.salons.length > 0 ? breakdowns.salons : [{ id: 1, name: 'Sede Principal' }];
                const visitsData = breakdowns.visits || [];
                const getSalonVisits = (sId) => visitsData.find(v => v.salon_id === sId) || { plan_beauty: 0, generica: 0, total: 0 };

                const totalPlanBeauty = salons.reduce((acc, s) => acc + (getSalonVisits(s.id).plan_beauty || 0), 0);
                const totalGenerica = salons.reduce((acc, s) => acc + (getSalonVisits(s.id).generica || 0), 0);
                const totalGlobal = totalPlanBeauty + totalGenerica;

                return (
                  <div>
                    <div style={{ overflowX: 'auto', background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                        <thead>
                          <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                            <th style={{ padding: '1rem 1.25rem', fontWeight: 800, color: '#334155' }}>Categoría / Tipo</th>
                            {salons.map(s => (
                              <th key={s.id} style={{ padding: '1rem 1.25rem', fontWeight: 800, color: '#09090b', textAlign: 'center' }}>
                                📍 {s.name}
                              </th>
                            ))}
                            <th style={{ padding: '1rem 1.25rem', fontWeight: 900, color: '#1e40af', background: '#eff6ff', textAlign: 'center' }}>
                              Total General
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '1.25rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#3b82f6' }}></span>
                              Plan Beauty (Membresía)
                            </td>
                            {salons.map(s => (
                              <td key={s.id} style={{ padding: '1.25rem', textAlign: 'center', fontWeight: 800, fontSize: '1.05rem', color: '#0f172a' }}>
                                {getSalonVisits(s.id).plan_beauty}
                              </td>
                            ))}
                            <td style={{ padding: '1.25rem', textAlign: 'center', fontWeight: 900, fontSize: '1.1rem', color: '#1d4ed8', background: '#f8fafc' }}>
                              {totalPlanBeauty}
                            </td>
                          </tr>
                          <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '1.25rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f59e0b' }}></span>
                              Visitas Genéricas (Sin Plan)
                            </td>
                            {salons.map(s => (
                              <td key={s.id} style={{ padding: '1.25rem', textAlign: 'center', fontWeight: 800, fontSize: '1.05rem', color: '#0f172a' }}>
                                {getSalonVisits(s.id).generica}
                              </td>
                            ))}
                            <td style={{ padding: '1.25rem', textAlign: 'center', fontWeight: 900, fontSize: '1.1rem', color: '#d97706', background: '#f8fafc' }}>
                              {totalGenerica}
                            </td>
                          </tr>
                          <tr style={{ background: '#f8fafc', fontWeight: 900, borderTop: '2px solid #e2e8f0' }}>
                            <td style={{ padding: '1.25rem', color: '#09090b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              TOTAL VISITAS HOY
                            </td>
                            {salons.map(s => (
                              <td key={s.id} style={{ padding: '1.25rem', textAlign: 'center', fontWeight: 900, fontSize: '1.2rem', color: '#09090b' }}>
                                {getSalonVisits(s.id).total}
                              </td>
                            ))}
                            <td style={{ padding: '1.25rem', textAlign: 'center', fontWeight: 900, fontSize: '1.3rem', color: '#2563eb', background: '#eff6ff' }}>
                              {totalGlobal}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              {/* Breakdown: Membresías Activas */}
              {activeDetailModal === 'memberships' && (() => {
                const salons = breakdowns.salons && breakdowns.salons.length > 0 ? breakdowns.salons : [{ id: 1, name: 'Sede Principal' }];
                const membersData = breakdowns.memberships || [];
                const getSalonMembers = (sId) => membersData.find(m => m.salon_id === sId) || { count: 0 };
                const grandTotal = salons.reduce((acc, s) => acc + (getSalonMembers(s.id).count || 0), 0);

                return (
                  <div>
                    <div style={{ overflowX: 'auto', background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                        <thead>
                          <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                            <th style={{ padding: '1rem 1.25rem', fontWeight: 800, color: '#334155' }}>Sucursal / Localidad</th>
                            <th style={{ padding: '1rem 1.25rem', fontWeight: 800, color: '#334155', textAlign: 'center' }}>Membresías Activas</th>
                            <th style={{ padding: '1rem 1.25rem', fontWeight: 800, color: '#334155', textAlign: 'right' }}>% de Distribución</th>
                          </tr>
                        </thead>
                        <tbody>
                          {salons.map(s => {
                            const count = getSalonMembers(s.id).count || 0;
                            const pct = grandTotal > 0 ? Math.round((count / grandTotal) * 100) : 0;
                            return (
                              <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td style={{ padding: '1.25rem', fontWeight: 700, color: '#09090b', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#ecfdf5', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>
                                    <Users size={18} />
                                  </div>
                                  {s.name}
                                </td>
                                <td style={{ padding: '1.25rem', textAlign: 'center', fontWeight: 900, fontSize: '1.15rem', color: '#059669' }}>
                                  {count}
                                </td>
                                <td style={{ padding: '1.25rem', textAlign: 'right' }}>
                                  <span style={{ fontWeight: 800, color: '#64748b', background: '#f1f5f9', padding: '0.3rem 0.6rem', borderRadius: '12px', fontSize: '0.8rem' }}>
                                    {pct}%
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                          <tr style={{ background: '#f8fafc', fontWeight: 900, borderTop: '2px solid #e2e8f0' }}>
                            <td style={{ padding: '1.25rem', color: '#09090b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              TOTAL MEMBRESÍAS ACTIVAS
                            </td>
                            <td style={{ padding: '1.25rem', textAlign: 'center', fontWeight: 900, fontSize: '1.3rem', color: '#059669' }}>
                              {grandTotal}
                            </td>
                            <td style={{ padding: '1.25rem', textAlign: 'right', fontWeight: 900, color: '#059669' }}>
                              100%
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              {/* Matrix: Ventas Diarias */}
              {activeDetailModal === 'dailySales' && (() => {
                const salons = breakdowns.salons && breakdowns.salons.length > 0 ? breakdowns.salons : [{ id: 1, name: 'Sede Principal' }];
                const salesData = breakdowns.dailySales || [];
                const getSalonSales = (sId) => salesData.find(s => s.salon_id === sId) || { plan_beauty: 0, generica: 0, total: 0 };

                const totalPlanSales = salons.reduce((acc, s) => acc + (getSalonSales(s.id).plan_beauty || 0), 0);
                const totalGenericaSales = salons.reduce((acc, s) => acc + (getSalonSales(s.id).generica || 0), 0);
                const grandTotalSales = totalPlanSales + totalGenericaSales;

                return (
                  <div>
                    {/* Resumen Superior Rápido */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                      <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '14px', padding: '1rem 1.25rem' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Total Facturado Hoy
                        </div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#5b21b6', marginTop: '0.25rem' }}>
                          RD$ {Number(grandTotalSales).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </div>
                      </div>

                      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '1rem 1.25rem' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', justifyContent: 'space-between' }}>
                          <span>Plan Beauty</span>
                          <span style={{ color: '#8b5cf6' }}>{grandTotalSales > 0 ? Math.round((totalPlanSales / grandTotalSales) * 100) : 0}%</span>
                        </div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#09090b', marginTop: '0.25rem' }}>
                          RD$ {Number(totalPlanSales).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </div>
                      </div>

                      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '1rem 1.25rem' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', justifyContent: 'space-between' }}>
                          <span>Servicios POS</span>
                          <span style={{ color: '#0891b2' }}>{grandTotalSales > 0 ? Math.round((totalGenericaSales / grandTotalSales) * 100) : 0}%</span>
                        </div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#09090b', marginTop: '0.25rem' }}>
                          RD$ {Number(totalGenericaSales).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </div>
                      </div>
                    </div>

                    <div style={{ overflowX: 'auto', background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                        <thead>
                          <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                            <th style={{ padding: '1rem 1.25rem', fontWeight: 800, color: '#334155' }}>Concepto de Venta</th>
                            {salons.map(s => (
                              <th key={s.id} style={{ padding: '1rem 1.25rem', fontWeight: 800, color: '#09090b', textAlign: 'center' }}>
                                📍 {s.name}
                              </th>
                            ))}
                            <th style={{ padding: '1rem 1.25rem', fontWeight: 900, color: '#7c3aed', background: '#f5f3ff', textAlign: 'center' }}>
                              Total Facturado
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '1.25rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#8b5cf6' }}></span>
                              Plan Beauty (Suscripciones / Cuotas)
                            </td>
                            {salons.map(s => (
                              <td key={s.id} style={{ padding: '1.25rem', textAlign: 'center', fontWeight: 800, fontSize: '1rem', color: '#0f172a' }}>
                                RD$ {Number(getSalonSales(s.id).plan_beauty).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </td>
                            ))}
                            <td style={{ padding: '1.25rem', textAlign: 'center', fontWeight: 900, fontSize: '1.05rem', color: '#7c3aed', background: '#f8fafc' }}>
                              RD$ {Number(totalPlanSales).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </td>
                          </tr>
                          <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '1.25rem', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#06b6d4' }}></span>
                              Ventas Genéricas / Servicios Sueltos
                            </td>
                            {salons.map(s => (
                              <td key={s.id} style={{ padding: '1.25rem', textAlign: 'center', fontWeight: 800, fontSize: '1rem', color: '#0f172a' }}>
                                RD$ {Number(getSalonSales(s.id).generica).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </td>
                            ))}
                            <td style={{ padding: '1.25rem', textAlign: 'center', fontWeight: 900, fontSize: '1.05rem', color: '#0891b2', background: '#f8fafc' }}>
                              RD$ {Number(totalGenericaSales).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </td>
                          </tr>
                          <tr style={{ background: '#f8fafc', fontWeight: 900, borderTop: '2px solid #e2e8f0' }}>
                            <td style={{ padding: '1.25rem', color: '#09090b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              TOTAL RECAUDADO HOY
                            </td>
                            {salons.map(s => (
                              <td key={s.id} style={{ padding: '1.25rem', textAlign: 'center', fontWeight: 900, fontSize: '1.15rem', color: '#09090b' }}>
                                RD$ {Number(getSalonSales(s.id).total).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </td>
                            ))}
                            <td style={{ padding: '1.25rem', textAlign: 'center', fontWeight: 900, fontSize: '1.25rem', color: '#7c3aed', background: '#f5f3ff' }}>
                              RD$ {Number(grandTotalSales).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

            </div>

            {/* Modal Footer */}
            <div style={{ padding: '1.25rem 2rem', borderTop: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'flex-end' }}>
              <button 
                onClick={() => setActiveDetailModal(null)}
                className="btn-primary" 
                style={{ borderRadius: '12px', background: '#09090b', padding: '0.6rem 1.5rem', fontWeight: 700 }}
              >
                Cerrar Desglose
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
