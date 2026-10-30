import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  Sparkles, DollarSign, Users, UserX, Calendar, CreditCard, Filter, ChevronRight, 
  MapPin, Clock, ArrowDown, ArrowUp, BarChart2, List, Banknote, Receipt, Search,
  ChevronLeft, ChevronsLeft, ChevronsRight, X, MessageCircle, TrendingUp, ShieldCheck,
  CheckCircle2, AlertCircle, ArrowUpRight, Percent
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useTranslation } from '../../context/LanguageContext';
import { motion, AnimatePresence } from 'framer-motion';
import InvoiceHistory from './InvoiceHistory';
import BusinessIntelligence from '../bi/BusinessIntelligence';
import { formatName } from '../../utils/formatters';

const normalizeQuery = (text) => {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
};

const ServiceAnalytics = () => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [salons, setSalons] = useState([]);
  const [selectedSalon, setSelectedSalon] = useState('all');
  const [reports, setReports] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeReport, setActiveReport] = useState(searchParams.get('tab') || 'bi_executive');
  const [clientPaymentSearch, setClientPaymentSearch] = useState('');
  const [clientPaymentsPage, setClientPaymentsPage] = useState(1);
  const [clientPaymentsPageSize, setClientPaymentsPageSize] = useState(25);

  // Search states for other operational reports
  const [cashSearch, setCashSearch] = useState('');
  const [inactiveSearch, setInactiveSearch] = useState('');
  const [commissionsSearch, setCommissionsSearch] = useState('');
  
  // Date range state (default: current month)
  const [startDate, setStartDate] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  );
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);

  // Sync tab with query param
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && tab !== activeReport) {
      setActiveReport(tab);
    }
  }, [searchParams]);

  useEffect(() => {
    const init = async () => {
      try {
        const s = await dataService.getSalons();
        setSalons(s || []);
      } catch (err) {
        console.warn('Error fetching salons in analytics:', err);
      }
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
      console.error('Error fetching analytics reports:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterSubmit = (e) => {
    if (e) e.preventDefault();
    loadReports(selectedSalon, startDate, endDate);
  };

  const handleSalonChange = (e) => {
    const val = e.target.value;
    setSelectedSalon(val);
    loadReports(val, startDate, endDate);
  };

  const handleTabChange = (newTab) => {
    setActiveReport(newTab);
    setSearchParams({ tab: newTab });
  };

  const handleWhatsAppClick = (phone, clientName) => {
    if (!phone) {
      alert('Este cliente no tiene un teléfono registrado.');
      return;
    }
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const targetPhone = cleanPhone.startsWith('1') ? cleanPhone : (cleanPhone.length === 10 ? `1${cleanPhone}` : `1809${cleanPhone}`);
    const message = encodeURIComponent(`Hola ${clientName || 'estimada socia'}, le saludamos de Abatte Peluquería & Plan Beauty RD. Notamos que hace unos días no nos visita y queremos saber cómo se encuentra.`);
    window.open(`https://wa.me/${targetPhone}?text=${message}`, '_blank');
  };

  const reportMenu = [
    { id: 'bi_executive', label: 'Tablero BI Ejecutivo (30)', icon: Sparkles, color: '#2563eb', bg: '#eff6ff' },
    { id: 'sales', label: 'Ventas Diarias', icon: DollarSign, color: '#10b981', bg: '#ecfdf5' },
    { id: 'client_payments', label: 'Cobros por Cliente', icon: CreditCard, color: '#8b5cf6', bg: '#f5f3ff' },
    { id: 'invoices', label: 'Facturas & Ventas', icon: Receipt, color: '#be185d', bg: '#fdf2f8' },
    { id: 'cash', label: 'Pagos en Efectivo', icon: Banknote, color: '#059669', bg: '#ecfdf5' },
    { id: 'commissions', label: 'Comisiones Colaboradores', icon: Users, color: '#ec4899', bg: '#fdf2f8' },
    { id: 'clients', label: 'Estado de Clientes', icon: Users, color: '#3b82f6', bg: '#eff6ff' },
    { id: 'inactive', label: 'Clientes Inactivos (>15d)', icon: Clock, color: '#ef4444', bg: '#fef2f2' },
    { id: 'payments', label: 'Desglose de Pagos', icon: BarChart2, color: '#6366f1', bg: '#eef2ff' },
    { id: 'frequency', label: 'Frecuencia de Visitas', icon: Calendar, color: '#f59e0b', bg: '#fffbeb' },
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
    if (!reports && activeReport !== 'invoices' && activeReport !== 'bi_executive') return null;

    switch (activeReport) {
      // 0. Nuevo Tablero BI Ejecutivo
      case 'bi_executive':
        return <BusinessIntelligence standalone={false} />;

      // 1. Facturas & Ventas (InvoiceHistory)
      case 'invoices':
        return (
          <div style={{ margin: '-1rem' }}>
            <InvoiceHistory />
          </div>
        );

      // 2. Ventas Diarias
      case 'sales':
        return (
          <div>
            {/* Header with Title and Shortcuts */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                  Ventas Diarias
                </h3>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                  Período analizado: {startDate} al {endDate}
                </p>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => handleTabChange('client_payments')}
                  style={{
                    background: '#ffffff',
                    color: '#7c3aed',
                    border: '1px solid #ddd6fe',
                    padding: '0.55rem 1rem',
                    borderRadius: '0.75rem',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    boxShadow: '0 1px 2px rgba(124,58,237,0.06)',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f5f3ff'}
                  onMouseLeave={(e) => e.currentTarget.style.background = '#ffffff'}
                >
                  <CreditCard size={15} />
                  <span>Ver Cobros por Cliente</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleTabChange('invoices')}
                  style={{
                    background: '#ffffff',
                    color: '#be185d',
                    border: '1px solid #fbcfe8',
                    padding: '0.55rem 1rem',
                    borderRadius: '0.75rem',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    boxShadow: '0 1px 2px rgba(190,24,93,0.06)',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#fdf2f8'}
                  onMouseLeave={(e) => e.currentTarget.style.background = '#ffffff'}
                >
                  <Receipt size={15} />
                  <span>Registro de Facturas</span>
                </button>
              </div>
            </div>
            
            {/* Executive Indicator Banner */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '1.25rem', 
              background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', 
              color: 'white', 
              padding: '1.5rem 2rem', 
              borderRadius: '1.25rem', 
              marginBottom: '1.75rem',
              boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.25)',
              border: '1px solid rgba(255,255,255,0.08)'
            }}>
              <div style={{ 
                background: 'rgba(250, 204, 21, 0.15)', 
                padding: '0.85rem', 
                borderRadius: '1rem',
                border: '1px solid rgba(250, 204, 21, 0.3)'
              }}>
                <DollarSign size={28} color="#facc15" />
              </div>
              <div>
                <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', opacity: 0.7, letterSpacing: '0.08em' }}>
                  Total Cobrado por Renovación
                </p>
                <p style={{ margin: '0.2rem 0 0', fontSize: '2rem', fontWeight: 900, letterSpacing: '-0.02em', color: '#facc15' }}>
                  RD$ {Number(reports.renewalRevenue || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            {/* Daily Sales Table */}
            <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '1rem', background: '#ffffff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Fecha</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Total Ingresos</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, textAlign: 'center' }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {(reports.dailySales || []).map((day, idx) => (
                    <tr 
                      key={idx} 
                      style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s ease' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={(e) => e.currentTarget.style.background = '#ffffff'}
                    >
                      <td style={{ padding: '0.95rem 1.25rem', fontWeight: 600, color: '#1e293b' }}>
                        {formatSafeDate(day.date || day.fecha)}
                      </td>
                      <td style={{ padding: '0.95rem 1.25rem', fontWeight: 800, color: '#0f172a', fontSize: '0.95rem' }}>
                        RD$ {Number(day.total || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '0.95rem 1.25rem', textAlign: 'center' }}>
                        <span style={{ 
                          fontSize: '0.72rem', 
                          padding: '0.25rem 0.65rem', 
                          borderRadius: '9999px', 
                          background: '#ecfdf5', 
                          color: '#059669', 
                          fontWeight: 700,
                          border: '1px solid #a7f3d0'
                        }}>
                          PAGO APROBADO
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

      // 3. Cobros por Cliente (Tabular Powerhouse)
      case 'client_payments': {
        const rawPayments = reports.detailedPayments || [];
        const filteredPayments = rawPayments.filter(p => {
          if (!clientPaymentSearch.trim()) return true;
          const query = normalizeQuery(clientPaymentSearch);
          const name = normalizeQuery(p.client_name);
          const phone = normalizeQuery(p.client_phone);
          const salon = normalizeQuery(p.salon_name);
          const desc = normalizeQuery(p.description);
          const method = normalizeQuery(p.method);
          return name.includes(query) || phone.includes(query) || salon.includes(query) || desc.includes(query) || method.includes(query);
        });

        const totalCharged = filteredPayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
        const avgTicket = filteredPayments.length > 0 ? totalCharged / filteredPayments.length : 0;

        const totalPages = Math.ceil(filteredPayments.length / clientPaymentsPageSize) || 1;
        const currentPageSafe = Math.min(Math.max(1, clientPaymentsPage), totalPages);
        const startIndex = (currentPageSafe - 1) * clientPaymentsPageSize;
        const paginatedPayments = filteredPayments.slice(startIndex, startIndex + clientPaymentsPageSize);

        const getPageNumbers = () => {
          const pages = [];
          const maxVisible = 5;
          if (totalPages <= maxVisible) {
            for (let i = 1; i <= totalPages; i++) pages.push(i);
          } else {
            if (currentPageSafe <= 3) {
              pages.push(1, 2, 3, 4, '...', totalPages);
            } else if (currentPageSafe >= totalPages - 2) {
              pages.push(1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
            } else {
              pages.push(1, '...', currentPageSafe - 1, currentPageSafe, currentPageSafe + 1, '...', totalPages);
            }
          }
          return pages;
        };

        return (
          <div>
            {/* Header + Search */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                  Cobros por Cliente
                </h3>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                  Historial de cobros de suscripciones y tickets de caja ({startDate} al {endDate})
                </p>
              </div>

              {/* Search Box */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative' }}>
                  <Search size={15} style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  <input
                    type="text"
                    placeholder="Buscar cliente, teléfono, sucursal..."
                    value={clientPaymentSearch}
                    onChange={(e) => {
                      setClientPaymentSearch(e.target.value);
                      setClientPaymentsPage(1);
                    }}
                    style={{
                      padding: '0.55rem 2rem 0.55rem 2.2rem',
                      borderRadius: '0.75rem',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#0f172a',
                      fontSize: '0.85rem',
                      outline: 'none',
                      minWidth: '270px',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
                    }}
                  />
                  {clientPaymentSearch && (
                    <button
                      type="button"
                      onClick={() => { setClientPaymentSearch(''); setClientPaymentsPage(1); }}
                      style={{
                        position: 'absolute',
                        right: '0.6rem',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: '#94a3b8',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                      title="Limpiar búsqueda"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Quick KPI summary cards */}
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', 
              gap: '1rem', 
              marginBottom: '1.5rem' 
            }}>
              <div style={{ 
                background: 'linear-gradient(135deg, #065f46 0%, #047857 100%)', 
                color: 'white', 
                padding: '1.15rem 1.35rem', 
                borderRadius: '1rem',
                boxShadow: '0 4px 12px rgba(6,95,70,0.15)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.85rem'
              }}>
                <div style={{ background: 'rgba(255,255,255,0.2)', padding: '0.65rem', borderRadius: '0.75rem' }}>
                  <DollarSign size={20} color="#ffffff" />
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', opacity: 0.85, letterSpacing: '0.04em' }}>Total Recaudado</p>
                  <p style={{ margin: '0.1rem 0 0', fontSize: '1.3rem', fontWeight: 900, color: '#ffffff' }}>
                    RD$ {Number(totalCharged).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>

              <div style={{ 
                background: '#ffffff', 
                padding: '1.15rem 1.35rem', 
                borderRadius: '1rem',
                border: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                gap: '0.85rem',
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
              }}>
                <div style={{ background: '#f5f3ff', color: '#7c3aed', padding: '0.65rem', borderRadius: '0.75rem' }}>
                  <CreditCard size={20} />
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.04em' }}>Transacciones</p>
                  <p style={{ margin: '0.1rem 0 0', fontSize: '1.3rem', fontWeight: 900, color: '#0f172a' }}>
                    {filteredPayments.length} <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#64748b' }}>cobros</span>
                  </p>
                </div>
              </div>

              <div style={{ 
                background: '#ffffff', 
                padding: '1.15rem 1.35rem', 
                borderRadius: '1rem',
                border: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                gap: '0.85rem',
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
              }}>
                <div style={{ background: '#eff6ff', color: '#2563eb', padding: '0.65rem', borderRadius: '0.75rem' }}>
                  <TrendingUp size={20} />
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.04em' }}>Ticket Promedio</p>
                  <p style={{ margin: '0.1rem 0 0', fontSize: '1.3rem', fontWeight: 900, color: '#0f172a' }}>
                    RD$ {Number(avgTicket).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '1rem', background: '#ffffff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Fecha</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Cliente</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Teléfono</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Sucursal</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Concepto</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Método</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, textAlign: 'right' }}>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedPayments.length > 0 ? (
                    paginatedPayments.map((pay, idx) => {
                      const formattedClient = formatName(pay.client_name || 'Cliente General');
                      const methodClean = pay.method || 'Efectivo';
                      const isSirena = String(pay.salon_name || '').toLowerCase().includes('sirena') || String(pay.salon_name || '').toLowerCase().includes('mella');

                      return (
                        <tr 
                          key={pay.id || idx}
                          style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s ease' }}
                          onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                          onMouseLeave={(e) => e.currentTarget.style.background = '#ffffff'}
                        >
                          <td style={{ padding: '0.85rem 1.25rem', color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap' }}>
                            {formatSafeDate(pay.created_at)}
                          </td>
                          <td style={{ padding: '0.85rem 1.25rem', fontWeight: 700, color: '#0f172a' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: '#ede9fe', color: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 800 }}>
                                {formattedClient.charAt(0).toUpperCase()}
                              </div>
                              <span>{formattedClient}</span>
                            </div>
                          </td>
                          <td style={{ padding: '0.85rem 1.25rem' }}>
                            <span style={{ padding: '0.2rem 0.5rem', borderRadius: '0.375rem', background: '#f1f5f9', fontFamily: 'monospace', fontSize: '0.78rem', color: '#475569', fontWeight: 600 }}>
                              {pay.client_phone || 'N/D'}
                            </span>
                          </td>
                          <td style={{ padding: '0.85rem 1.25rem' }}>
                            <span style={{ 
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              fontSize: '0.8rem', 
                              fontWeight: 700, 
                              color: isSirena ? '#0369a1' : '#6d28d9',
                              background: isSirena ? '#e0f2fe' : '#ede9fe',
                              padding: '0.2rem 0.55rem',
                              borderRadius: '0.375rem'
                            }}>
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isSirena ? '#0284c7' : '#7c3aed' }}></span>
                              {pay.salon_name || 'San Vicente'}
                            </span>
                          </td>
                          <td style={{ padding: '0.85rem 1.25rem', color: '#334155', fontWeight: 500 }}>
                            {pay.description || 'Cobro de Plan / Servicio'}
                          </td>
                          <td style={{ padding: '0.85rem 1.25rem' }}>
                            <span style={{
                              display: 'inline-block',
                              fontSize: '0.75rem',
                              padding: '0.2rem 0.55rem',
                              borderRadius: '0.375rem',
                              fontWeight: 700,
                              background: methodClean.toLowerCase().includes('cardnet') || methodClean.toLowerCase().includes('tarjeta') ? '#ede9fe' : methodClean.toLowerCase().includes('efectivo') ? '#ecfdf5' : '#eff6ff',
                              color: methodClean.toLowerCase().includes('cardnet') || methodClean.toLowerCase().includes('tarjeta') ? '#7c3aed' : methodClean.toLowerCase().includes('efectivo') ? '#059669' : '#2563eb'
                            }}>
                              {methodClean}
                            </span>
                          </td>
                          <td style={{ padding: '0.85rem 1.25rem', textAlign: 'right', fontWeight: 800, color: '#0f172a', fontSize: '0.92rem' }}>
                            RD$ {Number(pay.amount || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={7} style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                        No se encontraron cobros registrados con ese filtro.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Pagination */}
              {filteredPayments.length > 0 && (
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.95rem 1.25rem',
                  borderTop: '1px solid #e2e8f0',
                  background: '#f8fafc',
                  flexWrap: 'wrap',
                  gap: '1rem',
                  fontSize: '0.82rem',
                  color: '#64748b'
                }}>
                  <div>
                    Mostrando <strong>{startIndex + 1}</strong> - <strong>{Math.min(startIndex + clientPaymentsPageSize, filteredPayments.length)}</strong> de <strong>{filteredPayments.length}</strong> cobros
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span>Filas:</span>
                    <select
                      value={clientPaymentsPageSize}
                      onChange={(e) => {
                        setClientPaymentsPageSize(Number(e.target.value));
                        setClientPaymentsPage(1);
                      }}
                      style={{ padding: '0.25rem 0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', fontSize: '0.8rem', fontWeight: 700 }}
                    >
                      <option value={15}>15</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <button
                      type="button"
                      disabled={currentPageSafe === 1}
                      onClick={() => setClientPaymentsPage(1)}
                      style={{ padding: '0.3rem 0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', background: '#ffffff', cursor: currentPageSafe === 1 ? 'not-allowed' : 'pointer', opacity: currentPageSafe === 1 ? 0.4 : 1 }}
                    >
                      <ChevronsLeft size={15} />
                    </button>
                    <button
                      type="button"
                      disabled={currentPageSafe === 1}
                      onClick={() => setClientPaymentsPage(prev => Math.max(1, prev - 1))}
                      style={{ padding: '0.3rem 0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', background: '#ffffff', cursor: currentPageSafe === 1 ? 'not-allowed' : 'pointer', opacity: currentPageSafe === 1 ? 0.4 : 1 }}
                    >
                      <ChevronLeft size={15} />
                    </button>
                    {getPageNumbers().map((p, pIdx) => {
                      if (p === '...') return <span key={pIdx} style={{ padding: '0 0.2rem' }}>...</span>;
                      const isAct = p === currentPageSafe;
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setClientPaymentsPage(p)}
                          style={{
                            minWidth: '30px',
                            height: '30px',
                            borderRadius: '0.375rem',
                            border: isAct ? 'none' : '1px solid #cbd5e1',
                            background: isAct ? '#2563eb' : '#ffffff',
                            color: isAct ? '#ffffff' : '#0f172a',
                            fontWeight: isAct ? 800 : 600,
                            cursor: 'pointer'
                          }}
                        >
                          {p}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      disabled={currentPageSafe === totalPages}
                      onClick={() => setClientPaymentsPage(prev => Math.min(totalPages, prev + 1))}
                      style={{ padding: '0.3rem 0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', background: '#ffffff', cursor: currentPageSafe === totalPages ? 'not-allowed' : 'pointer', opacity: currentPageSafe === totalPages ? 0.4 : 1 }}
                    >
                      <ChevronRight size={15} />
                    </button>
                    <button
                      type="button"
                      disabled={currentPageSafe === totalPages}
                      onClick={() => setClientPaymentsPage(totalPages)}
                      style={{ padding: '0.3rem 0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e1', background: '#ffffff', cursor: currentPageSafe === totalPages ? 'not-allowed' : 'pointer', opacity: currentPageSafe === totalPages ? 0.4 : 1 }}
                    >
                      <ChevronsRight size={15} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      }

      // 4. Pagos en Efectivo
      case 'cash': {
        const rawCash = reports.cashPayments || [];
        const filteredCash = rawCash.filter(pay => {
          if (!cashSearch.trim()) return true;
          const q = normalizeQuery(cashSearch);
          return normalizeQuery(pay.client_name).includes(q) ||
                 normalizeQuery(pay.salon_name).includes(q) ||
                 normalizeQuery(pay.applied_by).includes(q);
        });
        const totalCashAmount = filteredCash.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                  Pagos en Efectivo ({filteredCash.length})
                </h3>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                  Cobros directos en caja física ({startDate} al {endDate}) • Total: <strong>RD$ {totalCashAmount.toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong>
                </p>
              </div>

              {/* Search Box */}
              <div style={{ position: 'relative' }}>
                <Search size={15} style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  placeholder="Buscar cliente, cajero o sucursal..."
                  value={cashSearch}
                  onChange={(e) => setCashSearch(e.target.value)}
                  style={{
                    padding: '0.55rem 2rem 0.55rem 2.2rem',
                    borderRadius: '0.75rem',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#0f172a',
                    fontSize: '0.85rem',
                    outline: 'none',
                    minWidth: '260px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
                  }}
                />
                {cashSearch && (
                  <button
                    type="button"
                    onClick={() => setCashSearch('')}
                    style={{
                      position: 'absolute',
                      right: '0.6rem',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#94a3b8'
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '1rem', background: '#ffffff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Fecha</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Cliente</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Sucursal</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Cajero / Aplicado Por</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, textAlign: 'right' }}>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCash.length > 0 ? (
                    filteredCash.map((pay, idx) => (
                      <tr 
                        key={idx} 
                        style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s ease' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                        onMouseLeave={(e) => e.currentTarget.style.background = '#ffffff'}
                      >
                        <td style={{ padding: '0.95rem 1.25rem', color: '#64748b', fontWeight: 500 }}>
                          {formatSafeDate(pay.created_at)}
                        </td>
                        <td style={{ padding: '0.95rem 1.25rem', fontWeight: 700, color: '#0f172a' }}>
                          {pay.client_name || 'Desconocido'}
                        </td>
                        <td style={{ padding: '0.95rem 1.25rem' }}>
                          <span style={{ padding: '0.2rem 0.5rem', borderRadius: '0.375rem', background: '#eff6ff', color: '#2563eb', fontWeight: 700, fontSize: '0.78rem' }}>
                            {pay.salon_name || 'San Vicente'}
                          </span>
                        </td>
                        <td style={{ padding: '0.95rem 1.25rem', color: '#475569', fontWeight: 600 }}>
                          {pay.applied_by || 'Caja Principal'}
                        </td>
                        <td style={{ padding: '0.95rem 1.25rem', fontWeight: 800, textAlign: 'right', color: '#059669', fontSize: '0.95rem' }}>
                          RD$ {Number(pay.amount || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                        No hay pagos en efectivo registrados en este período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      // 5. Comisiones de Colaboradores
      case 'commissions': {
        const rawCommissions = reports.commissions || [];
        const filteredCommissions = rawCommissions.filter(item => {
          if (!commissionsSearch.trim()) return true;
          const q = normalizeQuery(commissionsSearch);
          return normalizeQuery(item.nombre).includes(q) || normalizeQuery(item.posicion).includes(q);
        });
        const totalCommissionsSum = filteredCommissions.reduce((sum, item) => sum + (Number(item.comision) || 0), 0);

        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                  Comisiones de Colaboradores ({filteredCommissions.length})
                </h3>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                  Cálculo de comisiones por servicios ({startDate} al {endDate}) • Total: <strong>RD$ {totalCommissionsSum.toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong>
                </p>
              </div>

              {/* Search Box */}
              <div style={{ position: 'relative' }}>
                <Search size={15} style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  placeholder="Buscar colaboradora o posición..."
                  value={commissionsSearch}
                  onChange={(e) => setCommissionsSearch(e.target.value)}
                  style={{
                    padding: '0.55rem 2rem 0.55rem 2.2rem',
                    borderRadius: '0.75rem',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#0f172a',
                    fontSize: '0.85rem',
                    outline: 'none',
                    minWidth: '260px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
                  }}
                />
                {commissionsSearch && (
                  <button
                    type="button"
                    onClick={() => setCommissionsSearch('')}
                    style={{
                      position: 'absolute',
                      right: '0.6rem',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#94a3b8'
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '1rem', background: '#ffffff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Colaborador</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Posición</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, textAlign: 'center' }}>Servicios</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, textAlign: 'right' }}>Comisión Generada</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCommissions.length > 0 ? (
                    filteredCommissions.map((item, idx) => (
                      <tr 
                        key={idx} 
                        style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s ease' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                        onMouseLeave={(e) => e.currentTarget.style.background = '#ffffff'}
                      >
                        <td style={{ padding: '0.95rem 1.25rem', fontWeight: 700, color: '#0f172a' }}>
                          {item.nombre}
                        </td>
                        <td style={{ padding: '0.95rem 1.25rem', color: '#64748b' }}>
                          <span style={{ padding: '0.2rem 0.55rem', borderRadius: '0.375rem', background: '#f1f5f9', fontWeight: 600, fontSize: '0.78rem' }}>
                            {item.posicion}
                          </span>
                        </td>
                        <td style={{ padding: '0.95rem 1.25rem', textAlign: 'center', fontWeight: 700, color: '#334155' }}>
                          {item.servicios}
                        </td>
                        <td style={{ padding: '0.95rem 1.25rem', textAlign: 'right', fontWeight: 900, color: '#be185d', fontSize: '0.95rem' }}>
                          RD$ {Number(item.comision || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                        No hay comisiones registradas en este período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      // 6. Estado de Clientes
      case 'clients':
        return (
          <div>
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                Resumen de Estado de Clientes
              </h3>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                Membresías vigentes y contratos cancelados en la plataforma
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
              <div style={{ 
                padding: '1.75rem', 
                borderRadius: '1.25rem', 
                background: '#eff6ff', 
                border: '1px solid #bfdbfe',
                boxShadow: '0 2px 8px rgba(37,99,235,0.06)'
              }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '1rem', background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
                  <Users size={24} color="#2563eb" />
                </div>
                <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 700, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Clientes Activos
                </p>
                <p style={{ margin: '0.25rem 0 0', fontSize: '2.5rem', fontWeight: 900, color: '#1e3a8a', letterSpacing: '-0.02em' }}>
                  {reports.clientSummary?.active || 0}
                </p>
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem', color: '#3b82f6' }}>
                  Contratos vigentes Plan Beauty
                </p>
              </div>

              <div style={{ 
                padding: '1.75rem', 
                borderRadius: '1.25rem', 
                background: '#fff1f2', 
                border: '1px solid #fecdd3',
                boxShadow: '0 2px 8px rgba(225,29,72,0.06)'
              }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '1rem', background: '#ffe4e6', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
                  <UserX size={24} color="#e11d48" />
                </div>
                <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 700, color: '#be123c', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Clientes Cancelados
                </p>
                <p style={{ margin: '0.25rem 0 0', fontSize: '2.5rem', fontWeight: 900, color: '#881337', letterSpacing: '-0.02em' }}>
                  {reports.clientSummary?.cancelled || 0}
                </p>
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem', color: '#e11d48' }}>
                  Histórico acumulado de bajas
                </p>
              </div>
            </div>
          </div>
        );

      // 7. Clientes Inactivos (con botón WhatsApp directo)
      case 'inactive': {
        const rawInactive = reports.inactiveClients || [];
        const filteredInactive = rawInactive.filter(cl => {
          if (!inactiveSearch.trim()) return true;
          const q = normalizeQuery(inactiveSearch);
          return normalizeQuery(cl.nombre).includes(q) || normalizeQuery(cl.telefono).includes(q);
        });

        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                  Clientes Inactivos ({filteredInactive.length})
                </h3>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                  Socias con más de 15 días sin registrar visita al salón
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                {/* Search Box */}
                <div style={{ position: 'relative' }}>
                  <Search size={15} style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  <input
                    type="text"
                    placeholder="Buscar cliente o teléfono..."
                    value={inactiveSearch}
                    onChange={(e) => setInactiveSearch(e.target.value)}
                    style={{
                      padding: '0.55rem 2rem 0.55rem 2.2rem',
                      borderRadius: '0.75rem',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#0f172a',
                      fontSize: '0.85rem',
                      outline: 'none',
                      minWidth: '240px',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
                    }}
                  />
                  {inactiveSearch && (
                    <button
                      type="button"
                      onClick={() => setInactiveSearch('')}
                      style={{
                        position: 'absolute',
                        right: '0.6rem',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: '#94a3b8'
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                <span style={{ 
                  fontSize: '0.75rem', 
                  color: '#be123c', 
                  fontWeight: 800, 
                  background: '#ffe4e6', 
                  border: '1px solid #fecdd3',
                  padding: '0.35rem 0.85rem', 
                  borderRadius: '9999px' 
                }}>
                  Riesgo de Abandono
                </span>
              </div>
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '1rem', background: '#ffffff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Cliente</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Última Visita</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, textAlign: 'center' }}>Días Inactivo</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Teléfono</th>
                    <th style={{ padding: '0.85rem 1.25rem', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, textAlign: 'center' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInactive.length > 0 ? (
                    filteredInactive.map((cl, idx) => {
                      const lastVisit = cl.last_visit ? new Date(cl.last_visit) : null;
                      const days = lastVisit ? Math.floor((new Date() - lastVisit) / (1000 * 60 * 60 * 24)) : 'N/A';
                      return (
                        <tr 
                          key={cl.id || idx} 
                          style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s ease' }}
                          onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                          onMouseLeave={(e) => e.currentTarget.style.background = '#ffffff'}
                        >
                          <td style={{ padding: '0.95rem 1.25rem', fontWeight: 700, color: '#0f172a' }}>{cl.nombre}</td>
                          <td style={{ padding: '0.95rem 1.25rem', color: '#475569' }}>{lastVisit ? lastVisit.toLocaleDateString('es-DO') : 'Nunca ha visitado'}</td>
                          <td style={{ padding: '0.95rem 1.25rem', textAlign: 'center' }}>
                            <span style={{ padding: '0.2rem 0.55rem', borderRadius: '9999px', background: '#ffe4e6', color: '#e11d48', fontWeight: 800, fontSize: '0.78rem' }}>
                              {days} días
                            </span>
                          </td>
                          <td style={{ padding: '0.95rem 1.25rem', fontFamily: 'monospace', color: '#334155' }}>{cl.telefono || 'Sin teléfono'}</td>
                          <td style={{ padding: '0.95rem 1.25rem', textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => handleWhatsAppClick(cl.telefono, cl.nombre)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.4rem',
                                background: '#ecfdf5',
                                color: '#059669',
                                border: '1px solid #a7f3d0',
                                borderRadius: '0.5rem',
                                padding: '0.35rem 0.75rem',
                                fontSize: '0.78rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = '#d1fae5'}
                              onMouseLeave={(e) => e.currentTarget.style.background = '#ecfdf5'}
                            >
                              <MessageCircle size={14} />
                              <span>Contactar</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                        No se encontraron clientas inactivas que coincidan con la búsqueda.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      // 8. Desglose de Pagos
      case 'payments': {
        const totalPaymentSum = (reports.paymentBreakdown || []).reduce((acc, curr) => acc + Number(curr.total || 0), 0);
        return (
          <div>
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                Desglose de Pagos por Método
              </h3>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                Participación porcentual de efectivo, tarjeta y transferencias ({startDate} al {endDate})
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {(reports.paymentBreakdown || []).map((pay, idx) => {
                const percent = totalPaymentSum > 0 ? ((Number(pay.total || 0) / totalPaymentSum) * 100).toFixed(1) : '0.0';
                return (
                  <div key={idx} style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    padding: '1.25rem 1.5rem', 
                    background: '#ffffff', 
                    borderRadius: '1rem', 
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div style={{ background: '#f8fafc', color: '#2563eb', padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid #e2e8f0' }}>
                        {pay.method && pay.method.toLowerCase().includes('tarjeta') ? <CreditCard size={20} /> : <DollarSign size={20} />}
                      </div>
                      <div>
                        <p style={{ margin: 0, fontWeight: 800, fontSize: '1rem', color: '#0f172a' }}>{pay.method || 'General'}</p>
                        <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: '#64748b' }}>{pay.count} transacciones aprobadas</p>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ margin: 0, fontWeight: 900, fontSize: '1.2rem', color: '#0f172a' }}>
                        RD$ {Number(pay.total || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </p>
                      <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: '#059669', fontWeight: 800 }}>
                        {percent}% del total
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      }

      // 9. Frecuencia de Visitas
      case 'frequency': {
        const totalClients = (reports.visitFrequency || []).reduce((acc, curr) => acc + curr.client_count, 0);
        return (
          <div>
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                Frecuencia de Visitas de Clientes
              </h3>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                Distribución de clientes por número de visitas ({startDate} al {endDate})
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {(reports.visitFrequency || []).map((freq, idx) => {
                const percent = totalClients > 0 ? (freq.client_count / totalClients) * 100 : 0;
                return (
                  <div key={idx} style={{ 
                    position: 'relative', 
                    padding: '1.15rem 1.35rem', 
                    borderRadius: '1rem', 
                    background: '#ffffff', 
                    border: '1px solid #e2e8f0', 
                    overflow: 'hidden',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                  }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', background: '#eff6ff', width: `${percent}%`, opacity: 0.6 }}></div>
                    <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.9rem' }}>
                        Clientes con {freq.visit_count} {freq.visit_count === 1 ? 'visita' : 'visitas'}
                      </span>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontWeight: 800, color: '#2563eb', display: 'block', fontSize: '0.95rem' }}>
                          {freq.client_count} Clientes
                        </span>
                        <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700 }}>
                          {percent.toFixed(1)}% de la base
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f8fafc',
      padding: '1.75rem 2rem 3rem',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#0f172a'
    }}>
      {/* 1. SaaS Master Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1.25rem',
        marginBottom: '1.75rem'
      }}>
        <div>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            background: '#eff6ff',
            color: '#2563eb',
            border: '1px solid #bfdbfe',
            padding: '0.25rem 0.65rem',
            borderRadius: '9999px',
            fontSize: '0.75rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: '0.4rem'
          }}>
            <Sparkles size={12} />
            <span>Módulo de Inteligencia de Negocios</span>
          </div>

          <h1 style={{
            margin: 0,
            fontSize: '1.75rem',
            fontWeight: 900,
            color: '#0f172a',
            letterSpacing: '-0.025em'
          }}>
            Inteligencia de Negocios & Analítica
          </h1>
          <p style={{
            margin: '0.2rem 0 0',
            fontSize: '0.88rem',
            color: '#64748b'
          }}>
            Monitoreo en tiempo real, cobros por cliente, ventas, comisiones y toma de decisiones.
          </p>
        </div>

        {/* Top Controls Bar (Visible only for operational/classic reports) */}
        {activeReport !== 'bi_executive' && (
          <form 
            onSubmit={handleFilterSubmit} 
            style={{ 
              display: 'flex', 
              gap: '0.65rem', 
              alignItems: 'center',
              background: '#ffffff',
              padding: '0.4rem',
              borderRadius: '1rem',
              border: '1px solid #e2e8f0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              flexWrap: 'wrap'
            }}
          >
            {/* Date Picker Group */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: '#f8fafc',
              padding: '0.45rem 0.85rem',
              borderRadius: '0.75rem',
              border: '1px solid #cbd5e1'
            }}>
              <Calendar size={15} color="#64748b" />
              <input 
                type="date" 
                value={startDate} 
                onChange={(e) => setStartDate(e.target.value)}
                style={{ border: 'none', fontWeight: 600, fontSize: '0.8rem', outline: 'none', background: 'transparent', color: '#0f172a' }} 
              />
              <span style={{ color: '#94a3b8', fontWeight: 800 }}>—</span>
              <input 
                type="date" 
                value={endDate} 
                onChange={(e) => setEndDate(e.target.value)}
                style={{ border: 'none', fontWeight: 600, fontSize: '0.8rem', outline: 'none', background: 'transparent', color: '#0f172a' }} 
              />
            </div>
            
            {/* Branch Picker Group */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: '#f8fafc',
              padding: '0.45rem 0.85rem',
              borderRadius: '0.75rem',
              border: '1px solid #cbd5e1'
            }}>
              <MapPin size={15} color="#64748b" />
              <select 
                value={selectedSalon} 
                onChange={handleSalonChange}
                style={{ border: 'none', fontWeight: 600, fontSize: '0.82rem', outline: 'none', background: 'transparent', color: '#0f172a', cursor: 'pointer' }}
              >
                <option value="all">Todas las Sucursales</option>
                {salons.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* Quick Report Switcher */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: '#f8fafc',
              padding: '0.45rem 0.85rem',
              borderRadius: '0.75rem',
              border: '1px solid #cbd5e1'
            }}>
              <List size={15} color="#64748b" />
              <select
                value={activeReport}
                onChange={(e) => handleTabChange(e.target.value)}
                style={{
                  border: 'none',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  outline: 'none',
                  background: 'transparent',
                  color: '#0f172a',
                  cursor: 'pointer'
                }}
              >
                {reportMenu.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <button 
              type="submit" 
              style={{ 
                padding: '0.55rem 1.35rem', 
                borderRadius: '0.75rem', 
                fontSize: '0.82rem', 
                background: '#2563eb', 
                color: '#ffffff',
                border: 'none',
                fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(37,99,235,0.25)',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#1d4ed8'}
              onMouseLeave={(e) => e.currentTarget.style.background = '#2563eb'}
            >
              Actualizar
            </button>
          </form>
        )}
      </div>

      {/* Main Full-Width Content Container */}
      <div style={{
        width: '100%',
        background: '#ffffff',
        borderRadius: '1.25rem',
        padding: activeReport === 'bi_executive' ? '0' : '1.75rem 2rem',
        border: activeReport === 'bi_executive' ? 'none' : '1px solid #e2e8f0',
        boxShadow: activeReport === 'bi_executive' ? 'none' : '0 1px 3px rgba(0,0,0,0.03)',
        minHeight: '620px'
      }}>
        {loading && activeReport !== 'invoices' && activeReport !== 'bi_executive' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '400px', gap: '1rem' }}>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            >
              <BarChart2 size={36} color="#94a3b8" />
            </motion.div>
            <p style={{ fontWeight: 700, color: '#64748b', fontSize: '0.9rem' }}>
              Consultando indicadores del salón...
            </p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeReport}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
            >
              {renderActiveReport()}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
};

export default ServiceAnalytics;
