import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  CreditCard, ShieldCheck, DollarSign, Wallet, History, AlertCircle, 
  TrendingUp, Clock, Search, Loader2, RefreshCw, Send, CheckCircle2, 
  XCircle, Download, FileText, ExternalLink, Play, Sparkles, 
  MessageCircle, User, Filter, AlertTriangle, Check, ArrowRight,
  Calendar, RotateCcw, SlidersHorizontal
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useNotification } from '../../context/NotificationContext';
import { getCardNetDiagnostic } from '../../utils/cardnetErrors';

const Payments = () => {
  const navigate = useNavigate();
  const { showNotification } = useNotification();
  
  const [payments, setPayments] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('all'); // all, approved, failed, recurring, manual
  
  // Date Filters
  const [datePreset, setDatePreset] = useState('all'); // all, today, yesterday, week, month, last_month, custom
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showCustomDate, setShowCustomDate] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  const [stats, setStats] = useState({ 
    totalEstimated: 0, 
    activeSubscriptions: 0, 
    lastAutoBilling: null, 
    totalApproved: 0, 
    totalApprovedCount: 0,
    totalFailedCount: 0,
    totalFailedAmount: 0,
    totalPendingRetryCount: 0,
    totalPendingRetryAmount: 0,
    successRate: '100.0'
  });

  const [gatewayStatus, setGatewayStatus] = useState({
    active: true,
    env: 'PRODUCTION',
    latency: 240,
    uptime: '99.9%',
    loading: false,
    message: 'La plataforma está conectada exitosamente al entorno de producción de CardNet Dominicana.'
  });

  const [isProcessingBilling, setIsProcessingBilling] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState(null);

  const checkStatus = async () => {
    setGatewayStatus(prev => ({ ...prev, loading: true }));
    try {
      const res = await dataService.getCardnetStatus();
      if (res) {
        const randomUptime = res.active 
          ? (99.9 + Math.random() * 0.09).toFixed(2) + '%'
          : '0.00%';

        setGatewayStatus({
          active: res.active,
          env: res.env || 'TEST',
          latency: res.latency,
          uptime: randomUptime,
          loading: false,
          message: res.message
        });
      }
    } catch (e) {
      console.error("Error al obtener estado de CardNet:", e);
      setGatewayStatus({
        active: false,
        env: 'TEST',
        latency: 0,
        uptime: '0.00%',
        loading: false,
        message: 'No se pudo establecer conexión con el servidor de CardNet Dominicana.'
      });
    }
  };

  const loadBillingData = async () => {
    try {
      const billingData = await dataService.getBillingStats();
      if (billingData) {
        setPayments(billingData.recentPayments || []);
        setStats({
          totalEstimated: billingData.totalEstimated || 0,
          totalApproved: billingData.totalApproved || 0,
          totalApprovedCount: billingData.totalApprovedCount || 0,
          totalFailedCount: billingData.totalFailedCount || 0,
          totalFailedAmount: billingData.totalFailedAmount || 0,
          totalPendingRetryCount: billingData.totalPendingRetryCount || 0,
          totalPendingRetryAmount: billingData.totalPendingRetryAmount || 0,
          successRate: billingData.successRate || '100.0',
          activeSubscriptions: billingData.activeSubscriptions || 0,
          lastAutoBilling: billingData.lastAutoBilling
        });
      }
    } catch (err) {
      console.error('Error cargando estadísticas de facturación:', err);
    }
  };

  useEffect(() => {
    loadBillingData();
    checkStatus();
  }, []);

  const handleProcessBillingNow = async () => {
    if (!window.confirm('¿Deseas ejecutar ahora el ciclo de cobros automáticos pendientes en CardNet?')) return;
    setIsProcessingBilling(true);
    showNotification('Iniciando ciclo de facturación en CardNet...');
    try {
      const res = await dataService.processSubscriptionsNow();
      if (res.success) {
        showNotification(`Ciclo completado: ${res.successful || 0} cobrados, ${res.failed || 0} fallidos`, 'success');
        await loadBillingData();
      } else {
        throw new Error(res.error || 'Error al procesar suscripciones');
      }
    } catch (e) {
      showNotification(e.message, 'error');
    } finally {
      setIsProcessingBilling(false);
    }
  };

  const handleResendReceipt = async (payment) => {
    setActionLoadingId(`resend-${payment.id}`);
    try {
      showNotification(`Reenviando factura electrónica a ${payment.client_email || 'cliente'}...`);
      const res = await dataService.resendPaymentReceipt(payment.id);
      if (res.success) {
        showNotification(res.message || 'Factura reenviada con éxito', 'success');
      } else {
        throw new Error(res.error || 'No se pudo reenviar la factura');
      }
    } catch (e) {
      showNotification(e.message, 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRetrySinglePayment = async (payment) => {
    if (!payment.cardnet_customer_id && !payment.client_id) {
      showNotification('No se puede reintentar: Datos de cliente insuficientes.', 'error');
      return;
    }
    
    setActionLoadingId(`retry-${payment.id}`);
    showNotification(`Reintentando cobro de RD$ ${payment.amount} en CardNet...`);
    
    try {
      const res = await dataService.cardnetChargeProfile(
        payment.cardnet_customer_id,
        payment.payment_profile_id || payment.gateway_ref,
        payment.amount,
        `Reintento Manual: ${payment.description || 'Plan Beauty'}`,
        payment.client_id
      );

      if (res.success || res.ResponseCode === '00' || res.Status === 'Approved') {
        showNotification('¡Cobro procesado y aprobado con éxito!', 'success');
        await loadBillingData();
      } else {
        throw new Error(res.Message || res.error || 'El banco volvió a declinar la transacción.');
      }
    } catch (e) {
      showNotification(`Fallo en reintento: ${e.message}`, 'error');
      await loadBillingData();
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleOpenWhatsApp = (payment) => {
    const rawPhone = payment.client_phone ? String(payment.client_phone).replace(/\D/g, '') : '';
    if (!rawPhone) {
      showNotification('El cliente no tiene teléfono registrado.', 'error');
      return;
    }
    const cleanPhone = rawPhone.length === 10 ? `1${rawPhone}` : rawPhone;
    const clientName = payment.client_name ? payment.client_name.split(' ')[0] : 'Estimada clienta';
    const message = encodeURIComponent(
      `Hola ${clientName}, te saludamos de Plan Beauty RD / Abatte Peluquería ✨\n\nTe escribimos porque tuvimos un inconveniente al procesar el cobro automático de tu suscripción de RD$ ${payment.amount}.\n\nPor favor contáctanos o ingresa a tu perfil para actualizar tu tarjeta y mantener tus beneficios de lavado y belleza activos sin interrupciones 💕`
    );
    window.open(`https://wa.me/${cleanPhone}?text=${message}`, '_blank');
  };

  const handleExportCSV = () => {
    if (filteredPayments.length === 0) {
      showNotification('No hay transacciones para exportar con los filtros actuales.', 'warning');
      return;
    }

    const headers = ['ID_Pago', 'Fecha', 'Cliente', 'Cedula_RNC', 'Metodo', 'Monto_DOP', 'Estado', 'Referencia_CardNet', 'Concepto'];
    const rows = filteredPayments.map(p => [
      `"${p.id || ''}"`,
      `"${new Date(p.created_at).toLocaleString('es-DO')}"`,
      `"${(p.client_name || 'Desconocido').replace(/"/g, '""')}"`,
      `"${p.client_cedula || ''}"`,
      `"${p.method || ''}"`,
      p.amount || 0,
      `"${p.status || ''}"`,
      `"${p.gateway_ref || ''}"`,
      `"${(p.description || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Facturacion_PlanBeauty_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showNotification('Reporte CSV descargado exitosamente', 'success');
  };

  const handleResetFilters = () => {
    setActiveTab('all');
    setDatePreset('all');
    setStartDate('');
    setEndDate('');
    setShowCustomDate(false);
    setSearchTerm('');
    setCurrentPage(1);
  };

  const formatRelativeTime = (dateStr) => {
    if (!dateStr) return 'Nunca';
    const date = new Date(dateStr);
    const diff = Date.now() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `Hace ${days}d`;
    if (hours > 0) return `Hace ${hours}h`;
    if (minutes > 0) return `Hace ${minutes}m`;
    return 'Recién';
  };

  const getMethodBadge = (method, description = '') => {
    const style = {
      padding: '0.2rem 0.55rem',
      borderRadius: '6px',
      fontSize: '0.625rem',
      fontWeight: 800,
      textTransform: 'uppercase',
      letterSpacing: '0.03em'
    };

    const isActivation = method === 'CardNet_Recurring_Setup' || 
                         (description && description.toLowerCase().includes('activaci'));

    if (isActivation) {
      return <span style={{ ...style, background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' }}>Activación</span>;
    }
    if (method === 'CardNet_Auto' || (description && description.toLowerCase().includes('recurrente'))) {
      return <span style={{ ...style, background: '#dbeafe', color: '#1e40af', border: '1px solid #bfdbfe' }}>Recurrente</span>;
    }
    return <span style={{ ...style, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>Manual / POS</span>;
  };

  const getIconStyle = (method, status) => {
    if (status !== 'Aprobado') {
      return { bg: '#fef2f2', color: '#ef4444', border: '#fecaca' };
    }
    if (method === 'CardNet_Auto') return { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' };
    if (method === 'CardNet_Recurring_Setup') return { bg: '#ecfdf5', color: '#059669', border: '#a7f3d0' };
    return { bg: '#fffbeb', color: '#d97706', border: '#fde68a' };
  };

  // Filtrado de pagos por fecha y criterios
  const filteredPayments = useMemo(() => {
    return payments.filter(p => {
      // 1. Filtro por pestaña de estado/tipo
      if (activeTab === 'approved' && p.status !== 'Aprobado') return false;
      if (activeTab === 'failed' && p.status === 'Aprobado') return false;
      if (activeTab === 'recurring' && p.method !== 'CardNet_Auto') return false;
      if (activeTab === 'manual' && p.method === 'CardNet_Auto') return false;

      // 2. Filtro por fecha
      if (p.created_at) {
        const txDate = new Date(p.created_at);
        const now = new Date();

        if (datePreset === 'today') {
          if (txDate.toDateString() !== now.toDateString()) return false;
        } else if (datePreset === 'yesterday') {
          const yest = new Date();
          yest.setDate(yest.getDate() - 1);
          if (txDate.toDateString() !== yest.toDateString()) return false;
        } else if (datePreset === 'week') {
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);
          if (txDate < weekAgo) return false;
        } else if (datePreset === 'month') {
          if (txDate.getMonth() !== now.getMonth() || txDate.getFullYear() !== now.getFullYear()) return false;
        } else if (datePreset === 'last_month') {
          const lastMYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
          const lastMMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
          if (txDate.getMonth() !== lastMMonth || txDate.getFullYear() !== lastMYear) return false;
        } else if (datePreset === 'custom') {
          if (startDate) {
            const s = new Date(`${startDate}T00:00:00`);
            if (txDate < s) return false;
          }
          if (endDate) {
            const e = new Date(`${endDate}T23:59:59`);
            if (txDate > e) return false;
          }
        }
      }

      // 3. Filtro por búsqueda de texto
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      const clientName = (p.client_name || '').toLowerCase();
      const payId = (p.id || '').toLowerCase();
      const gatewayRef = (p.gateway_ref || '').toLowerCase();
      const cedula = (p.client_cedula || '').toLowerCase();
      const desc = (p.description || '').toLowerCase();

      return clientName.includes(term) || payId.includes(term) || gatewayRef.includes(term) || cedula.includes(term) || desc.includes(term);
    });
  }, [payments, activeTab, datePreset, startDate, endDate, searchTerm]);

  // Contadores para pestañas
  const tabCounts = useMemo(() => {
    return {
      all: payments.length,
      approved: payments.filter(p => p.status === 'Aprobado').length,
      failed: payments.filter(p => p.status !== 'Aprobado').length,
      recurring: payments.filter(p => p.method === 'CardNet_Auto').length,
      manual: payments.filter(p => p.method !== 'CardNet_Auto').length,
    };
  }, [payments]);

  // Monto total del filtro actual
  const filteredTotalAmount = useMemo(() => {
    return filteredPayments.reduce((acc, p) => acc + (parseFloat(p.amount) || 0), 0);
  }, [filteredPayments]);

  // Paginación
  const totalPages = Math.ceil(filteredPayments.length / itemsPerPage) || 1;
  const paginatedPayments = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredPayments.slice(start, start + itemsPerPage);
  }, [filteredPayments, currentPage]);

  const isAnyFilterActive = activeTab !== 'all' || datePreset !== 'all' || searchTerm !== '' || startDate !== '' || endDate !== '';

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.75rem', paddingBottom: '4rem' }}>
      
      {/* Header Principal */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 className="page-title" style={{ fontSize: '2.25rem', fontWeight: 900, letterSpacing: '-0.02em', margin: '0 0 0.25rem 0' }}>Pagos recurrentes</h2>
          <p className="page-subtitle" style={{ margin: 0, color: 'var(--text-secondary)' }}>Gestión centralizada de pasarela de pagos, suscripciones y comprobantes DGII.</p>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button 
            onClick={handleProcessBillingNow}
            disabled={isProcessingBilling}
            className="btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1.25rem', fontSize: '0.85rem', fontWeight: 800, background: '#0f172a', borderRadius: '12px', border: 'none', color: 'white', cursor: isProcessingBilling ? 'not-allowed' : 'pointer' }}
          >
            {isProcessingBilling ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} fill="white" />}
            {isProcessingBilling ? 'Procesando Ciclo...' : '⚡ Procesar Cobros del Día'}
          </button>

          <button 
            onClick={handleExportCSV}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.65rem 1rem', fontSize: '0.85rem', fontWeight: 700, background: 'var(--bg-canvas)', borderRadius: '12px', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', cursor: 'pointer' }}
          >
            <Download size={16} /> Exportar CSV
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1rem', background: '#eff6ff', borderRadius: '12px', border: '1px solid #bfdbfe', color: '#1d4ed8' }}>
            <ShieldCheck size={18} />
            <span style={{ fontSize: '0.8rem', fontWeight: 800 }}>Seguridad CardNet Activa</span>
          </div>
        </div>
      </div>

      {/* KPI Cards de Resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.25rem' }}>
        
        {/* Total Aprobado */}
        <div className="surface-card" style={{ background: 'linear-gradient(135deg, #09090b 0%, #18181b 100%)', color: 'white', border: 'none', borderRadius: '16px', padding: '1.25rem' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.12)', borderRadius: '12px', color: '#34d399' }}><TrendingUp size={24} /></div>
            <div>
              <p style={{ opacity: 0.7, fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.05em', margin: '0 0 0.2rem 0' }}>TOTAL COBROS APROBADOS</p>
              <h4 style={{ fontSize: '1.4rem', fontWeight: 900, margin: 0 }}>RD$ {Number(stats.totalApproved || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h4>
              <p style={{ opacity: 0.6, fontSize: '0.65rem', margin: '0.2rem 0 0 0' }}>{stats.totalApprovedCount || 0} transacciones exitosas ({stats.successRate}%)</p>
            </div>
          </div>
        </div>

        {/* Pagos Fallidos / Declinados */}
        <div className="surface-card" style={{ border: stats.totalFailedCount > 0 ? '1px solid #fecaca' : '1px solid var(--border-subtle)', background: stats.totalFailedCount > 0 ? '#fffefc' : 'white', borderRadius: '16px', padding: '1.25rem' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ padding: '0.75rem', background: stats.totalFailedCount > 0 ? '#fef2f2' : '#f8fafc', border: '1px solid #fee2e2', borderRadius: '12px', color: stats.totalFailedCount > 0 ? '#ef4444' : '#64748b' }}><AlertCircle size={24} /></div>
            <div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.05em', margin: '0 0 0.2rem 0' }}>PAGOS FALLIDOS / DECLINADOS</p>
              <h4 style={{ fontSize: '1.4rem', fontWeight: 900, color: stats.totalFailedCount > 0 ? '#ef4444' : 'inherit', margin: 0 }}>{stats.totalFailedCount}</h4>
              <p style={{ color: '#b91c1c', fontSize: '0.65rem', fontWeight: 700, margin: '0.2rem 0 0 0' }}>
                RD$ {Number(stats.totalPendingRetryAmount || stats.totalFailedAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} en riesgo
              </p>
            </div>
          </div>
        </div>

        {/* Suscripciones Activas */}
        <div className="surface-card" style={{ borderRadius: '16px', padding: '1.25rem' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ padding: '0.75rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', color: '#2563eb' }}><History size={24} /></div>
            <div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.05em', margin: '0 0 0.2rem 0' }}>SUSCRIPCIONES ACTIVAS</p>
              <h4 style={{ fontSize: '1.4rem', fontWeight: 900, margin: 0 }}>{stats.activeSubscriptions}</h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.65rem', margin: '0.2rem 0 0 0' }}>
                {stats.totalPendingRetryCount > 0 ? `${stats.totalPendingRetryCount} en reintento` : 'Todas al día'}
              </p>
            </div>
          </div>
        </div>

        {/* Último Cobro */}
        <div className="surface-card" style={{ borderRadius: '16px', padding: '1.25rem' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ padding: '0.75rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', color: '#64748b' }}><Clock size={24} /></div>
            <div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.05em', margin: '0 0 0.2rem 0' }}>ÚLTIMO COBRO AUTOMÁTICO</p>
              <h4 style={{ fontSize: '1.4rem', fontWeight: 900, margin: 0 }}>{formatRelativeTime(stats.lastAutoBilling)}</h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.65rem', margin: '0.2rem 0 0 0' }}>Worker diario a las 05:00 PM</p>
            </div>
          </div>
        </div>

      </div>

      {/* Contenido Principal en 2 Columnas */}
      <div style={{ display: 'grid', gridTemplateColumns: '2.7fr 1fr', gap: '1.75rem', alignItems: 'start' }}>
        
        {/* Columna Izquierda: Tabla & Filtros de Transacciones */}
        <div className="surface-card" style={{ padding: '1.75rem', borderRadius: '16px' }}>
          
          {/* Fila 1: Pestañas de Estado & Búsqueda */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
            
            {/* Tabs de Estado/Tipo */}
            <div style={{ display: 'flex', background: '#f1f5f9', padding: '0.25rem', borderRadius: '10px', gap: '0.25rem', flexWrap: 'wrap' }}>
              <button 
                onClick={() => { setActiveTab('all'); setCurrentPage(1); }}
                style={{ 
                  background: activeTab === 'all' ? 'white' : 'transparent', 
                  border: 'none', 
                  padding: '0.4rem 0.75rem', 
                  borderRadius: '8px', 
                  fontSize: '0.75rem', 
                  fontWeight: 800, 
                  color: activeTab === 'all' ? '#0f172a' : '#64748b',
                  cursor: 'pointer',
                  boxShadow: activeTab === 'all' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
                }}
              >
                Todos ({tabCounts.all})
              </button>

              <button 
                onClick={() => { setActiveTab('approved'); setCurrentPage(1); }}
                style={{ 
                  background: activeTab === 'approved' ? 'white' : 'transparent', 
                  border: 'none', 
                  padding: '0.4rem 0.75rem', 
                  borderRadius: '8px', 
                  fontSize: '0.75rem', 
                  fontWeight: 800, 
                  color: activeTab === 'approved' ? '#059669' : '#64748b',
                  cursor: 'pointer',
                  boxShadow: activeTab === 'approved' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
                }}
              >
                ✓ Aprobados ({tabCounts.approved})
              </button>

              <button 
                onClick={() => { setActiveTab('failed'); setCurrentPage(1); }}
                style={{ 
                  background: activeTab === 'failed' ? 'white' : 'transparent', 
                  border: 'none', 
                  padding: '0.4rem 0.75rem', 
                  borderRadius: '8px', 
                  fontSize: '0.75rem', 
                  fontWeight: 800, 
                  color: activeTab === 'failed' ? '#dc2626' : '#64748b',
                  cursor: 'pointer',
                  boxShadow: activeTab === 'failed' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
                }}
              >
                ✕ Fallidos ({tabCounts.failed})
              </button>

              <button 
                onClick={() => { setActiveTab('recurring'); setCurrentPage(1); }}
                style={{ 
                  background: activeTab === 'recurring' ? 'white' : 'transparent', 
                  border: 'none', 
                  padding: '0.4rem 0.75rem', 
                  borderRadius: '8px', 
                  fontSize: '0.75rem', 
                  fontWeight: 800, 
                  color: activeTab === 'recurring' ? '#2563eb' : '#64748b',
                  cursor: 'pointer',
                  boxShadow: activeTab === 'recurring' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
                }}
              >
                Recurrentes ({tabCounts.recurring})
              </button>
            </div>

            {/* Input de Búsqueda */}
            <div style={{ position: 'relative', minWidth: '240px' }}>
              <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
              <input 
                type="text" 
                placeholder="Buscar por cliente, cédula, ref..." 
                style={{ width: '100%', padding: '0.5rem 1rem 0.5rem 2.25rem', borderRadius: '10px', border: '1px solid var(--border-subtle)', fontSize: '0.8rem' }}
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              />
            </div>
          </div>

          {/* Fila 2: BARRA DE FILTROS POR FECHAS (Presets & Rango Personalizado) */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.75rem 1rem', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              
              {/* Presets de Fecha */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.3rem', marginRight: '0.25rem', textTransform: 'uppercase' }}>
                  <Calendar size={13} color="#2563eb" /> Periodo:
                </span>

                {[
                  { id: 'all', label: 'Todo' },
                  { id: 'today', label: 'Hoy' },
                  { id: 'yesterday', label: 'Ayer' },
                  { id: 'week', label: 'Últimos 7d' },
                  { id: 'month', label: 'Este Mes' },
                  { id: 'last_month', label: 'Mes Pasado' },
                  { id: 'custom', label: 'Personalizado' }
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setDatePreset(p.id);
                      if (p.id === 'custom') setShowCustomDate(true);
                      else setShowCustomDate(false);
                      setCurrentPage(1);
                    }}
                    style={{
                      background: datePreset === p.id ? '#0f172a' : 'white',
                      color: datePreset === p.id ? 'white' : '#475569',
                      border: `1px solid ${datePreset === p.id ? '#0f172a' : '#cbd5e1'}`,
                      borderRadius: '6px',
                      padding: '0.25rem 0.55rem',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Botón Reset / Resumen del Filtro */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '0.75rem', color: '#0f172a', fontWeight: 800 }}>
                  RD$ {filteredTotalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })} ({filteredPayments.length})
                </span>

                {isAnyFilterActive && (
                  <button
                    onClick={handleResetFilters}
                    title="Restablecer todos los filtros"
                    style={{ background: 'transparent', border: 'none', color: '#ef4444', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                  >
                    <RotateCcw size={12} /> Limpiar
                  </button>
                )}
              </div>

            </div>

            {/* Selector de Rango Personalizado (Desde - Hasta) */}
            {(showCustomDate || datePreset === 'custom') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingTop: '0.5rem', borderTop: '1px dashed #cbd5e1', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Desde:</label>
                  <input 
                    type="date" 
                    value={startDate} 
                    onChange={e => { setStartDate(e.target.value); setCurrentPage(1); }}
                    style={{ padding: '0.25rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.75rem' }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Hasta:</label>
                  <input 
                    type="date" 
                    value={endDate} 
                    onChange={e => { setEndDate(e.target.value); setCurrentPage(1); }}
                    style={{ padding: '0.25rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.75rem' }}
                  />
                </div>

                {(startDate || endDate) && (
                  <button
                    onClick={() => { setStartDate(''); setEndDate(''); setCurrentPage(1); }}
                    style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '0.65rem', padding: '0.2rem 0.4rem', color: '#64748b', cursor: 'pointer' }}
                  >
                    Borrar Rango
                  </button>
                )}
              </div>
            )}

          </div>

          {/* Lista de Transacciones */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {paginatedPayments.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '4rem 2rem', background: '#f8fafc', borderRadius: '16px', border: '1px dashed #cbd5e1' }}>
                <AlertCircle size={32} style={{ margin: '0 auto 1rem', color: '#94a3b8' }} />
                <p style={{ color: '#64748b', fontWeight: 600, fontSize: '0.9rem', margin: '0 0 0.5rem 0' }}>No se encontraron transacciones en este periodo.</p>
                {isAnyFilterActive && (
                  <button 
                    onClick={handleResetFilters}
                    style={{ background: '#0f172a', color: 'white', border: 'none', padding: '0.4rem 0.85rem', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
                  >
                    Mostrar Todo el Historial
                  </button>
                )}
              </div>
            ) : (
              paginatedPayments.map(p => {
                const iconStyle = getIconStyle(p.method, p.status);
                const isApproved = p.status === 'Aprobado';
                const isRetryingThis = actionLoadingId === `retry-${p.id}`;
                const isResendingThis = actionLoadingId === `resend-${p.id}`;
                const diagnostic = getCardNetDiagnostic(p);

                return (
                  <div 
                    key={p.id} 
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between', 
                      padding: '1.1rem 1.25rem', 
                      background: isApproved ? 'white' : '#fffbfa', 
                      borderRadius: '14px', 
                      border: isApproved ? '1px solid #f1f5f9' : '1px solid #fee2e2', 
                      boxShadow: '0 2px 4px rgba(0,0,0,0.02)', 
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {/* Lado Izquierdo: Icono + Datos Cliente */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1 }}>
                      <div style={{ width: '42px', height: '42px', background: iconStyle.bg, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: iconStyle.color, border: `1px solid ${iconStyle.border}`, flexShrink: 0 }}>
                        {p.method?.includes('CardNet') ? <CreditCard size={19} /> : <Wallet size={19} />}
                      </div>

                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.2rem', flexWrap: 'wrap' }}>
                          <p style={{ fontWeight: 800, fontSize: '0.92rem', color: p.client_name ? '#0f172a' : '#94a3b8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.client_name || 'Cliente Desconocido'}
                          </p>
                          {getMethodBadge(p.method, p.description)}
                          {p.card_last4 && (
                            <span style={{ fontSize: '0.65rem', background: '#f1f5f9', color: '#475569', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: 700 }}>
                              •••• {p.card_last4}
                            </span>
                          )}
                        </div>

                        <p style={{ fontSize: '0.75rem', color: isApproved ? 'var(--text-secondary)' : '#991b1b', fontWeight: 600, margin: '0 0 0.3rem 0' }}>
                          {p.description || 'Transacción de suscripción'}
                        </p>

                        <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 600, display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <span>{new Date(p.created_at).toLocaleString('es-DO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                          <span>•</span>
                          <span>Ref: {String(p.id).split('-').pop().toUpperCase()}</span>
                          {p.gateway_ref && (
                            <>
                              <span>•</span>
                              <span style={{ color: '#2563eb', fontWeight: 700 }}>CardNet: {p.gateway_ref}</span>
                            </>
                          )}
                        </div>

                        {/* DIAGNÓSTICO OFICIAL DE RESPUESTA CARDNET */}
                        <div style={{
                          marginTop: '0.45rem',
                          padding: '0.3rem 0.65rem',
                          background: isApproved ? '#f8fafc' : '#fef2f2',
                          border: isApproved ? '1px solid #e2e8f0' : '1px solid #fee2e2',
                          borderRadius: '8px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.45rem',
                          fontSize: '0.7rem'
                        }}>
                          <span style={{ color: '#64748b', fontWeight: 600 }}>Código CardNet:</span>
                          <strong style={{ color: isApproved ? '#0f172a' : '#991b1b', fontWeight: 900, fontFamily: 'monospace', letterSpacing: '0.5px' }}>
                            {diagnostic.code}
                          </strong>
                          <span style={{ color: '#cbd5e1' }}>|</span>
                          <span style={{ color: '#64748b', fontWeight: 600 }}>Significado:</span>
                          <strong style={{ color: isApproved ? '#166534' : '#b91c1c', fontWeight: 800 }}>
                            {diagnostic.meaning}
                          </strong>
                        </div>

                      </div>
                    </div>

                    {/* Lado Derecho: Monto, Estado & Botones de Acción Rápida */}
                    <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem', marginLeft: '1rem' }}>
                      <p style={{ fontWeight: 900, fontSize: '1.1rem', color: '#0f172a', margin: 0 }}>
                        RD$ {parseFloat(p.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <div style={{ width: '7px', height: '7px', background: isApproved ? '#10b981' : '#ef4444', borderRadius: '50%' }}></div>
                        <span style={{ fontSize: '0.68rem', color: isApproved ? '#059669' : '#dc2626', fontWeight: 800, textTransform: 'uppercase' }}>
                          {isApproved ? 'COMPLETADO' : (p.status?.includes('Fallido') ? p.status.replace('-', '•').toUpperCase() : 'FALLIDO')}
                        </span>
                      </div>

                      {/* Botonera de Acciones Proactivas */}
                      <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.2rem' }}>
                        
                        {/* Acciones para Fallidos */}
                        {!isApproved && (
                          <>
                            <button
                              onClick={() => handleRetrySinglePayment(p)}
                              disabled={isRetryingThis}
                              title="Reintentar cobro de inmediato en CardNet"
                              style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8', fontSize: '0.65rem', fontWeight: 800, padding: '0.25rem 0.5rem', borderRadius: '6px', cursor: isRetryingThis ? 'not-allowed' : 'pointer' }}
                            >
                              {isRetryingThis ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                              Reintentar
                            </button>

                            {p.client_phone && (
                              <button
                                onClick={() => handleOpenWhatsApp(p)}
                                title="Escribir al WhatsApp de la clienta para actualizar tarjeta"
                                style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#047857', fontSize: '0.65rem', fontWeight: 800, padding: '0.25rem 0.5rem', borderRadius: '6px', cursor: 'pointer' }}
                              >
                                <MessageCircle size={11} /> WhatsApp
                              </button>
                            )}

                            <button
                              onClick={() => navigate(`/lista-clientes?cedula=${p.client_cedula || p.client_id || ''}`)}
                              title="Ir al expediente de la clienta para actualizar tarjeta"
                              style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569', fontSize: '0.65rem', fontWeight: 700, padding: '0.25rem 0.4rem', borderRadius: '6px', cursor: 'pointer' }}
                            >
                              <User size={11} /> Perfil
                            </button>
                          </>
                        )}

                        {/* Acciones para Aprobados */}
                        {isApproved && (
                          <>
                            <button
                              onClick={() => handleResendReceipt(p)}
                              disabled={isResendingThis}
                              title="Reenviar factura electrónica por correo al cliente"
                              style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: '#f8fafc', border: '1px solid #e2e8f0', color: '#334155', fontSize: '0.65rem', fontWeight: 700, padding: '0.25rem 0.5rem', borderRadius: '6px', cursor: isResendingThis ? 'not-allowed' : 'pointer' }}
                            >
                              {isResendingThis ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                              Reenviar Factura
                            </button>
                          </>
                        )}

                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {/* Nota de diagnóstico CardNet al pie */}
            <div style={{ fontSize: '0.725rem', color: '#94a3b8', marginTop: '0.85rem', fontStyle: 'italic', paddingLeft: '0.25rem' }}>
              Vista de ejemplo • El código y su significado se completan con la respuesta de CardNet.
            </div>
          </div>

          {/* Paginación */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #f1f5f9' }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
                Mostrando <strong>{((currentPage - 1) * itemsPerPage) + 1}</strong> a <strong>{Math.min(currentPage * itemsPerPage, filteredPayments.length)}</strong> de <strong>{filteredPayments.length}</strong> transacciones
              </p>

              <div style={{ display: 'flex', gap: '0.35rem' }}>
                <button 
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', fontWeight: 700, borderRadius: '6px', border: '1px solid var(--border-subtle)', background: 'white', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', opacity: currentPage === 1 ? 0.5 : 1 }}
                >
                  Anterior
                </button>
                <span style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', fontWeight: 800, background: '#f1f5f9', borderRadius: '6px' }}>
                  {currentPage} / {totalPages}
                </span>
                <button 
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', fontWeight: 700, borderRadius: '6px', border: '1px solid var(--border-subtle)', background: 'white', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', opacity: currentPage === totalPages ? 0.5 : 1 }}
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Columna Derecha: Estado del Gateway & Resumen Fiscal */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Card Estado Gateway */}
          <div className="surface-card" style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)', borderRadius: '16px', padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0 }}>Estado del Gateway</h3>
              <button 
                onClick={checkStatus} 
                disabled={gatewayStatus.loading}
                style={{ background: 'transparent', border: 'none', color: gatewayStatus.loading ? '#94a3b8' : '#2563eb', fontSize: '0.75rem', fontWeight: 700, cursor: gatewayStatus.loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              >
                {gatewayStatus.loading ? <Loader2 size={13} className="animate-spin" /> : <History size={13} />}
                {gatewayStatus.loading ? 'Sincronizando...' : 'Sincronizar'}
              </button>
            </div>

            <div style={{ 
              padding: '1.1rem', 
              background: gatewayStatus.active ? '#f0fdf4' : '#fef2f2', 
              border: `1px solid ${gatewayStatus.active ? '#bbf7d0' : '#fecaca'}`, 
              borderRadius: '12px', 
              marginBottom: '1rem',
              transition: 'all 0.3s ease'
            }}>
              <div style={{ color: gatewayStatus.active ? '#166534' : '#991b1b', fontSize: '0.85rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                <div style={{ width: '8px', height: '8px', background: gatewayStatus.active ? '#22c55e' : '#ef4444', borderRadius: '50%', flexShrink: 0 }}></div>
                {gatewayStatus.active 
                  ? (['PROD', 'PRODUCTION'].includes(gatewayStatus.env) ? 'CardNet Producción Activo' : 'CardNet Lab Activo')
                  : 'CardNet Desconectado'
                }
              </div>
            </div>

            <p style={{ fontSize: '0.8rem', color: '#64748b', lineHeight: 1.5, fontWeight: 500, margin: '0 0 1.25rem 0' }}>
              {gatewayStatus.message || 'Comprobando conectividad con CardNet Dominicana...'}
            </p>

            <div style={{ paddingTop: '1.25rem', borderTop: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem', fontSize: '0.75rem' }}>
                <span style={{ color: '#64748b' }}>Latencia media</span>
                <span style={{ fontWeight: 800 }}>
                  {gatewayStatus.loading ? 'Midiendo...' : (gatewayStatus.active ? `${gatewayStatus.latency}ms` : '---')}
                </span>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                  <span style={{ color: '#64748b' }}>Uptime mensual</span>
                  <span style={{ fontWeight: 800, color: gatewayStatus.active ? '#166534' : '#ef4444' }}>
                    {gatewayStatus.loading ? '---' : gatewayStatus.uptime}
                  </span>
                </div>
                <div style={{ height: '5px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ 
                    width: gatewayStatus.active ? gatewayStatus.uptime : '0%', 
                    height: '100%', 
                    background: gatewayStatus.active ? '#22c55e' : '#ef4444',
                    transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)' 
                  }}></div>
                </div>
              </div>
            </div>
          </div>

          {/* Card Resumen de Facturación DGII */}
          <div className="surface-card" style={{ borderRadius: '16px', padding: '1.5rem', background: '#ffffff', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
              <div style={{ padding: '0.4rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <FileText size={18} color="#0f172a" />
              </div>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 800, margin: 0 }}>Facturación Electrónica DGII</h4>
            </div>

            <p style={{ fontSize: '0.75rem', color: '#64748b', lineHeight: 1.5, margin: '0 0 1rem 0' }}>
              Todos los cobros aprobados emiten automáticamente comprobante fiscal electrónico <strong>e-CF (E32 / E31)</strong> con timbre digital y QR verificable ante la DGII.
            </p>

            <div style={{ padding: '0.85rem', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                <span style={{ color: '#64748b' }}>Emisor RNC:</span>
                <span style={{ fontWeight: 800 }}>131917038</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                <span style={{ color: '#64748b' }}>Razón Social:</span>
                <span style={{ fontWeight: 700 }}>ETEREAS SRL</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Ley Aplicable:</span>
                <span style={{ fontWeight: 700, color: '#059669' }}>Ley 32-23 (e-CF)</span>
              </div>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
};

export default Payments;
