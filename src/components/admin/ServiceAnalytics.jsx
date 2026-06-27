import React, { useState, useEffect } from 'react';
import { 
  DollarSign, Users, UserX, Calendar, CreditCard, Filter, ChevronRight, 
  MapPin, Clock, ArrowDown, ArrowUp, BarChart2, List, Banknote
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useTranslation } from '../../context/LanguageContext';
import { motion, AnimatePresence } from 'framer-motion';

const ServiceAnalytics = () => {
  const { t } = useTranslation();
  const [salons, setSalons] = useState([]);
  const [selectedSalon, setSelectedSalon] = useState('all');
  const [reports, setReports] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeReport, setActiveReport] = useState('sales');
  
  // Date range state
  const [startDate, setStartDate] = useState(new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    const init = async () => {
      const s = await dataService.getSalons();
      setSalons(s || []);
      loadReports('all', startDate, endDate);
    };
    init();
  }, []);

  const loadReports = async (salonId, sDate, eDate) => {
    setLoading(true);
    try {
      const data = await dataService.getAnalyticsReports(salonId, sDate || startDate, eDate || endDate);
      setReports(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterSubmit = (e) => {
    e.preventDefault();
    loadReports(selectedSalon, startDate, endDate);
  };

  const handleSalonChange = (e) => {
    const val = e.target.value;
    setSelectedSalon(val);
    loadReports(val, startDate, endDate);
  };

  const reportMenu = [
    { id: 'sales', label: 'Ventas Diarias', icon: DollarSign, color: '#10b981' },
    { id: 'cash', label: 'Pagos en Efectivo', icon: Banknote, color: '#059669' },
    { id: 'clients', label: 'Estado de Clientes', icon: Users, color: '#3b82f6' },
    { id: 'inactive', label: 'Clientes Inactivos (>15d)', icon: Clock, color: '#ef4444' },
    { id: 'payments', label: 'Desglose de Pagos', icon: CreditCard, color: '#8b5cf6' },
    { id: 'frequency', label: 'Frecuencia de Visitas', icon: Calendar, color: '#f59e0b' },
  ];

  const formatSafeDate = (dateVal) => {
    if (!dateVal) return 'N/A';
    let d = new Date(dateVal);
    if (isNaN(d.getTime()) && typeof dateVal === 'string') {
      d = new Date(dateVal + 'T12:00:00');
    }
    if (isNaN(d.getTime()) && typeof dateVal === 'string') {
      const parts = dateVal.split('/');
      if (parts.length === 3) {
        d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`);
      }
    }
    return isNaN(d.getTime()) ? String(dateVal) : d.toLocaleDateString('es-DO', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  const renderActiveReport = () => {
    if (!reports) return null;

    switch (activeReport) {
      case 'sales':
        return (
          <div className="report-view">
            <h3 style={{ marginBottom: '1.5rem', fontWeight: 800 }}>Ventas Diarias ({startDate} al {endDate})</h3>
            
            {/* New Prominent Indicator */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '1.5rem', 
              background: '#09090b', 
              color: 'white', 
              padding: '1.5rem 2rem', 
              borderRadius: '24px', 
              marginBottom: '2rem',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)'
            }}>
              <div style={{ background: 'rgba(255,255,255,0.1)', padding: '1rem', borderRadius: '16px' }}>
                <DollarSign size={24} color="#d4af37" />
              </div>
              <div>
                <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', opacity: 0.6, letterSpacing: '0.05em' }}>Total Cobrado por Renovación</p>
                <p style={{ margin: 0, fontSize: '2rem', fontWeight: 900 }}>RD$ {Number(reports.renewalRevenue || 0).toLocaleString()}</p>
              </div>
            </div>

            <div className="table-responsive">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                    <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Fecha</th>
                    <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Total Ingresos</th>
                    <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.dailySales.map((day, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--border-subtle)', background: idx % 2 === 0 ? 'var(--bg-canvas)' : 'transparent' }}>
                      <td style={{ padding: '1rem', fontSize: '0.9rem', fontWeight: 600 }}>
                        {formatSafeDate(day.date || day.fecha)}
                      </td>
                      <td style={{ padding: '1rem', fontSize: '0.9rem', fontWeight: 800 }}>RD$ {Number(day.total).toLocaleString()}</td>
                      <td style={{ padding: '1rem' }}>
                        <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: '99px', background: '#dcfce7', color: '#166534', fontWeight: 700 }}>PAGO APROBADO</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

      case 'clients':
        return (
          <div className="report-view">
            <h3 style={{ marginBottom: '1.5rem', fontWeight: 800 }}>Resumen de Estado de Clientes</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
              <div style={{ padding: '2rem', borderRadius: '24px', background: '#eff6ff', border: '1px solid #bfdbfe' }}>
                <Users size={32} color="#3b82f6" style={{ marginBottom: '1rem' }} />
                <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700, color: '#1d4ed8' }}>Clientes Activos</p>
                <p style={{ margin: 0, fontSize: '2.5rem', fontWeight: 900, color: '#1e3a8a' }}>{reports.clientSummary.active}</p>
              </div>
              <div style={{ padding: '2rem', borderRadius: '24px', background: '#fef2f2', border: '1px solid #fecaca' }}>
                <UserX size={32} color="#ef4444" style={{ marginBottom: '1rem' }} />
                <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700, color: '#b91c1c' }}>Clientes Cancelados</p>
                <p style={{ margin: 0, fontSize: '2.5rem', fontWeight: 900, color: '#7f1d1d' }}>{reports.clientSummary.cancelled}</p>
              </div>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              * Los clientes activos son aquellos con contratos vigentes en el sistema.
            </p>
          </div>
        );

      case 'inactive':
        return (
          <div className="report-view">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
               <h3 style={{ margin: 0, fontWeight: 800 }}>Clientes Inactivos ({reports.inactiveClients.length})</h3>
               <span style={{ fontSize: '0.75rem', color: '#ef4444', fontWeight: 800, background: '#fee2e2', padding: '0.25rem 0.75rem', borderRadius: '99px' }}>Riesgo de Abandono</span>
            </div>
            <div className="table-responsive">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                    <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Cliente</th>
                    <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Última Visita</th>
                    <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Días Inactivo</th>
                    <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Teléfono</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.inactiveClients.map((cl, idx) => {
                    const lastVisit = cl.last_visit ? new Date(cl.last_visit) : null;
                    const days = lastVisit ? Math.floor((new Date() - lastVisit) / (1000 * 60 * 60 * 24)) : 'N/A';
                    return (
                      <tr key={cl.id} style={{ borderBottom: '1px solid var(--border-subtle)', background: idx % 2 === 0 ? 'var(--bg-canvas)' : 'transparent' }}>
                        <td style={{ padding: '1rem', fontSize: '0.9rem', fontWeight: 700 }}>{cl.nombre}</td>
                        <td style={{ padding: '1rem', fontSize: '0.9rem' }}>{lastVisit ? lastVisit.toLocaleDateString() : 'Nunca'}</td>
                        <td style={{ padding: '1rem', fontSize: '0.9rem', fontWeight: 800, color: '#ef4444' }}>{days} días</td>
                        <td style={{ padding: '1rem', fontSize: '0.9rem' }}>{cl.telefono}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );

      case 'payments':
        return (
          <div className="report-view">
            <h3 style={{ marginBottom: '1.5rem', fontWeight: 800 }}>Desglose de Pagos por Método</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {reports.paymentBreakdown.map((pay, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem', background: 'var(--bg-canvas)', borderRadius: '16px', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ background: 'var(--text-primary)', color: 'white', padding: '0.75rem', borderRadius: '12px' }}>
                      {pay.method.toLowerCase().includes('tarjeta') ? <CreditCard size={20} /> : <DollarSign size={20} />}
                    </div>
                    <div>
                      <p style={{ margin: 0, fontWeight: 800, fontSize: '1rem' }}>{pay.method}</p>
                      <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{pay.count} transacciones aprobadas</p>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ margin: 0, fontWeight: 900, fontSize: '1.25rem' }}>RD$ {Number(pay.total).toLocaleString()}</p>
                    <p style={{ margin: 0, fontSize: '0.7rem', color: '#10b981', fontWeight: 800 }}>{((pay.total / reports.paymentBreakdown.reduce((acc, curr) => acc + Number(curr.total), 0)) * 100).toFixed(1)}% del total</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case 'frequency':
        return (
          <div className="report-view">
            <h3 style={{ marginBottom: '1.5rem', fontWeight: 800 }}>Frecuencia de Visitas</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {reports.visitFrequency.map((freq, idx) => {
                const totalClients = reports.visitFrequency.reduce((acc, curr) => acc + curr.client_count, 0);
                const percent = (freq.client_count / totalClients) * 100;
                return (
                  <div key={idx} style={{ position: 'relative', padding: '1.25rem', borderRadius: '12px', background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', background: '#f59e0b', opacity: 0.1, width: `${percent}%` }}></div>
                    <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700 }}>Clientes con {freq.visit_count} {freq.visit_count === 1 ? 'visita' : 'visitas'}</span>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontWeight: 800, display: 'block' }}>{freq.client_count} Clientes</span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 800 }}>{percent.toFixed(1)}% de la base</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );

      case 'cash':
        return (
          <div className="report-view">
            <h3 style={{ marginBottom: '1.5rem', fontWeight: 800 }}>Pagos en Efectivo ({reports.cashPayments ? reports.cashPayments.length : 0})</h3>
            <div className="table-responsive">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                    <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Fecha</th>
                    <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Cliente</th>
                    <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Sucursal</th>
                    <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Aplicado Por</th>
                    <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', textAlign: 'right' }}>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.cashPayments && reports.cashPayments.length > 0 ? reports.cashPayments.map((pay, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--border-subtle)', background: idx % 2 === 0 ? 'var(--bg-canvas)' : 'transparent' }}>
                      <td style={{ padding: '1rem', fontSize: '0.9rem', fontWeight: 600 }}>{formatSafeDate(pay.created_at)}</td>
                      <td style={{ padding: '1rem', fontSize: '0.9rem' }}>{pay.client_name || 'Desconocido'}</td>
                      <td style={{ padding: '1rem', fontSize: '0.9rem' }}>{pay.salon_name || 'General'}</td>
                      <td style={{ padding: '1rem', fontSize: '0.9rem' }}>{pay.applied_by || 'Sistema'}</td>
                      <td style={{ padding: '1rem', fontSize: '0.9rem', fontWeight: 800, textAlign: 'right' }}>RD$ {Number(pay.amount).toLocaleString()}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan="5" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No hay pagos en efectivo registrados en este periodo.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="analytics-container">
      <div className="page-header" style={{ marginBottom: '2rem' }}>
        <div>
          <h2 className="page-title">Centro de Reportes y Analítica</h2>
          <p className="page-subtitle">Información estratégica para la toma de decisiones basada en datos reales.</p>
        </div>
        
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <form onSubmit={handleFilterSubmit} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <div className="filter-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'white', padding: '0.5rem 1rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
              <Calendar size={16} color="var(--text-secondary)" />
              <input 
                type="date" 
                value={startDate} 
                onChange={(e) => setStartDate(e.target.value)}
                style={{ border: 'none', fontWeight: 700, fontSize: '0.8rem', outline: 'none', background: 'transparent' }} 
              />
              <span style={{ color: 'var(--text-secondary)', fontWeight: 800 }}>-</span>
              <input 
                type="date" 
                value={endDate} 
                onChange={(e) => setEndDate(e.target.value)}
                style={{ border: 'none', fontWeight: 700, fontSize: '0.8rem', outline: 'none', background: 'transparent' }} 
              />
            </div>
            
            <div className="filter-group" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'white', padding: '0.5rem 1rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
              <MapPin size={18} color="var(--text-secondary)" />
              <select 
                className="select-minimal" 
                value={selectedSalon} 
                onChange={handleSalonChange}
                style={{ border: 'none', fontWeight: 700, fontSize: '0.875rem', outline: 'none', background: 'transparent' }}
              >
                <option value="all">Todas las Sucursales</option>
                {salons.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <button type="submit" className="btn-primary" style={{ padding: '0.6rem 2rem', borderRadius: '12px', fontSize: '0.875rem', background: '#000', fontWeight: 800 }}>
              FILTRAR RESULTADOS
            </button>
          </form>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '2rem' }}>
        {/* Sidebar Menu */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <p style={{ fontSize: '0.7rem', fontWeight: 900, color: 'var(--text-secondary)', textTransform: 'uppercase', paddingLeft: '1rem', marginBottom: '0.5rem', letterSpacing: '0.1em' }}>Reportes Disponibles</p>
          {reportMenu.map(item => {
            const Icon = item.icon;
            const isActive = activeReport === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveReport(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '1rem',
                  borderRadius: '16px',
                  border: 'none',
                  background: isActive ? 'var(--text-primary)' : 'transparent',
                  color: isActive ? 'white' : 'var(--text-primary)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  textAlign: 'left'
                }}
              >
                <div style={{ 
                  background: isActive ? 'rgba(255,255,255,0.2)' : 'var(--bg-canvas)', 
                  color: isActive ? 'white' : item.color,
                  padding: '0.5rem',
                  borderRadius: '10px'
                }}>
                  <Icon size={18} />
                </div>
                <span style={{ fontSize: '0.9rem', fontWeight: isActive ? 800 : 600 }}>{item.label}</span>
                {isActive && <ChevronRight size={16} style={{ marginLeft: 'auto' }} />}
              </button>
            );
          })}
        </div>

        {/* Content Area */}
        <div className="surface-card" style={{ minHeight: '600px', padding: '2.5rem' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem' }}>
               <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
               >
                 <BarChart2 size={40} color="var(--border-subtle)" />
               </motion.div>
               <p style={{ fontWeight: 800, color: 'var(--text-secondary)' }}>Generando reporte detallado...</p>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeReport}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {renderActiveReport()}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
};

export default ServiceAnalytics;
