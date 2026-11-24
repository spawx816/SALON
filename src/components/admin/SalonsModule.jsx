import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  MapPin, Plus, Trash2, Building, ArrowRight, Sparkles, Phone, 
  ExternalLink, Edit2, Users, DollarSign, CheckCircle2, Store, X, Save,
  CreditCard, ShieldCheck, AlertCircle, Calendar, Clock, RefreshCw, AlertTriangle
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useNotification } from '../../context/NotificationContext';
import { executeCardnetCheckout } from '../saas/SaasCheckoutPanel';

const SalonsModule = () => {
  const [salons, setSalons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingSalon, setEditingSalon] = useState(null);
  const [formData, setFormData] = useState({ name: '', address: '', phone: '', maps_url: '' });
  
  // Estado de cotización y contratación de sucursales adicionales
  const [licensingStatus, setLicensingStatus] = useState(null);
  const [quote, setQuote] = useState(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const [wantsMembershipsAddon, setWantsMembershipsAddon] = useState(false);
  const [paymentMethodChoice, setPaymentMethodChoice] = useState('saved_card');
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [checkoutVerifyingMsg, setCheckoutVerifyingMsg] = useState(null);

  const { showNotification } = useNotification();

  useEffect(() => {
    loadSalons();
  }, []);

  const loadSalons = async () => {
    setLoading(true);
    try {
      const [salonsData, licensingData] = await Promise.all([
        dataService.getSalons(),
        dataService.getBranchLicensingStatus().catch(() => null)
      ]);
      setSalons(salonsData || []);
      if (licensingData) {
        setLicensingStatus(licensingData);
      }
    } catch (e) {
      console.error('Error cargando sucursales:', e);
      showNotification('Error al cargar la lista de sucursales', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchQuote = useCallback(async (withAddon = false) => {
    setLoadingQuote(true);
    setQuoteError(null);
    try {
      const res = await dataService.quoteAddBranch({ wantsMembershipsAddon: withAddon });
      setQuote(res.quote);
      if (res.defaultPaymentMethod) {
        setPaymentMethodChoice('saved_card');
      } else {
        setPaymentMethodChoice('cardnet');
      }
    } catch (err) {
      console.error('Error al generar cotización:', err);
      setQuoteError(err.message || 'Error al calcular la cotización de la sucursal.');
    } finally {
      setLoadingQuote(false);
    }
  }, []);

  const openForm = async (empresa = null) => {
    setQuoteError(null);
    setWantsMembershipsAddon(false);
    setSubmittingPayment(false);
    setCheckoutVerifyingMsg(null);

    if (empresa) {
      setEditingSalon(empresa);
      setFormData({
        name: empresa.name || '',
        address: empresa.address || '',
        phone: empresa.phone || '',
        maps_url: empresa.maps_url || ''
      });
      setShowModal(true);
    } else {
      setEditingSalon(null);
      setFormData({ name: '', address: '', phone: '', maps_url: '' });

      // Consultar estado de licencias antes de abrir el modal
      try {
        const lic = await dataService.getBranchLicensingStatus();
        setLicensingStatus(lic);
        if (lic.canCreateWithoutPayment) {
          setQuote(null);
        } else {
          await fetchQuote(false);
        }
      } catch (err) {
        console.warn('No se pudo precargar licencias:', err.message);
      }
      setShowModal(true);
    }
  };

  const handleToggleAddon = async (checked) => {
    setWantsMembershipsAddon(checked);
    await fetchQuote(checked);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      showNotification('El nombre de la sucursal es obligatorio', 'warning');
      return;
    }

    // 1. Edición de sucursal existente
    if (editingSalon) {
      try {
        await dataService.updateSalon(editingSalon.id, formData);
        showNotification('Sucursal actualizada con éxito', 'success');
        setShowModal(false);
        setFormData({ name: '', address: '', phone: '', maps_url: '' });
        await loadSalons();
      } catch (err) {
        showNotification('Error al actualizar sucursal: ' + err.message, 'error');
      }
      return;
    }

    // 2. Creación con licencia pagada ya disponible (sin cobro)
    if (licensingStatus?.canCreateWithoutPayment || quote?.canCreateWithoutPayment) {
      try {
        const res = await dataService.contractBranch({
          branchData: formData,
          wantsMembershipsAddon: false,
          paymentMethodChoice: 'saved_card'
        });
        showNotification(res.message || 'Sucursal activada con éxito sin costo adicional.', 'success');
        setShowModal(false);
        setFormData({ name: '', address: '', phone: '', maps_url: '' });
        await loadSalons();
      } catch (err) {
        showNotification('Error al registrar sucursal: ' + err.message, 'error');
      }
      return;
    }

    // 3. Contratación pagada con cotización y confirmación personal del Owner
    setSubmittingPayment(true);
    try {
      const res = await dataService.contractBranch({
        branchData: formData,
        wantsMembershipsAddon,
        paymentMethodChoice
      });

      // Caso A: Cobro exitoso inmediato con tarjeta guardada
      if (res.paid && res.activated) {
        showNotification('¡Pago aprobado y sucursal activada con éxito!', 'success');
        setShowModal(false);
        setFormData({ name: '', address: '', phone: '', maps_url: '' });
        await loadSalons();
        return;
      }

      // Caso B: Requiere checkout interactivo en CardNet
      if (res.needsCheckout && res.checkout && res.order) {
        setCheckoutVerifyingMsg('Abriendo checkout seguro de CardNet...');
        await executeCardnetCheckout({
          orderId: res.order.id,
          order: res.order,
          checkout: res.checkout,
          onCheckoutOpening: () => {
            // Desmontar el modal de sucursal antes de abrir el iframe de CardNet para evitar superposición
            setShowModal(false);
          },
          onVerifying: (msg) => setCheckoutVerifyingMsg(msg),
          onActivated: async () => {
            showNotification('¡Pago CardNet verificado y sucursal activada!', 'success');
            setShowModal(false);
            setSubmittingPayment(false);
            setCheckoutVerifyingMsg(null);
            setFormData({ name: '', address: '', phone: '', maps_url: '' });
            await loadSalons();
          },
          onError: (errMsg) => {
            showNotification('Error en pago CardNet: ' + errMsg, 'error');
            setSubmittingPayment(false);
            setCheckoutVerifyingMsg(null);
            setShowModal(true);
          },
          onCheckoutClosed: () => {
            setSubmittingPayment(false);
            setCheckoutVerifyingMsg(null);
            loadSalons();
          }
        });
      }
    } catch (err) {
      showNotification('Error al procesar contratación: ' + err.message, 'error');
      setSubmittingPayment(false);
      setCheckoutVerifyingMsg(null);
    }
  };

  const handleResumePendingBranch = (empresa) => {
    openForm(null);
    setFormData({
      name: empresa.name || '',
      address: empresa.address || '',
      phone: empresa.phone || '',
      maps_url: empresa.maps_url || ''
    });
  };

  const handleDeleteSalon = async (empresa) => {
    const clientCount = empresa.client_count || 0;
    const confirmMsg = clientCount > 0
      ? `⚠️ ATENCIÓN: La sucursal "${empresa.name}" tiene ${clientCount} clienta(s) afiliada(s).\n\n¿Seguro que deseas eliminarla? Las clientas quedarán sin sede asignada.`
      : `¿Estás seguro de eliminar la sucursal "${empresa.name}"?`;

    if (window.confirm(confirmMsg)) {
      try {
        await dataService.deleteSalon(empresa.id);
        showNotification('Sucursal eliminada correctamente', 'warning');
        await loadSalons();
      } catch (e) {
        showNotification('Error al eliminar sucursal', 'error');
      }
    }
  };

  // Métricas generales
  const totalClients = salons.reduce((acc, s) => acc + (parseInt(s.client_count) || 0), 0);
  const totalRevenue = salons.reduce((acc, s) => acc + (parseFloat(s.total_revenue) || 0), 0);

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem', paddingBottom: '4rem' }}>
      
      {/* Header Principal */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 className="page-title" style={{ fontSize: '2.25rem', fontWeight: 900, letterSpacing: '-0.02em', margin: '0 0 0.25rem 0' }}>
            Gestión de Sucursales
          </h2>
          <p className="page-subtitle" style={{ margin: 0, color: 'var(--text-secondary)' }}>
            Administra los locales físicos, ubicaciones y puntos de servicio de tu cadena de empresas.
          </p>
        </div>

        <button 
          className="btn-primary" 
          onClick={() => openForm()}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 1.35rem', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 800 }}
        >
          <Plus size={18} />
          <span>Añadir Sucursal</span>
        </button>
      </div>

      {/* KPI Cards de Resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem' }}>
        
        <div className="surface-card" style={{ padding: '1.25rem', borderRadius: '16px', background: 'white' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ padding: '0.75rem', background: '#eff6ff', borderRadius: '12px', color: '#2563eb' }}>
              <Store size={22} />
            </div>
            <div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em', margin: '0 0 0.2rem 0', textTransform: 'uppercase' }}>
                Total Sucursales
              </p>
              <h4 style={{ fontSize: '1.4rem', fontWeight: 900, margin: 0 }}>{salons.length} Sedes</h4>
            </div>
          </div>
        </div>

        <div className="surface-card" style={{ padding: '1.25rem', borderRadius: '16px', background: 'white' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ padding: '0.75rem', background: '#f0fdf4', borderRadius: '12px', color: '#16a34a' }}>
              <Users size={22} />
            </div>
            <div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em', margin: '0 0 0.2rem 0', textTransform: 'uppercase' }}>
                Clientas Afiliadas
              </p>
              <h4 style={{ fontSize: '1.4rem', fontWeight: 900, margin: 0 }}>{totalClients} Miembros</h4>
            </div>
          </div>
        </div>

        <div className="surface-card" style={{ padding: '1.25rem', borderRadius: '16px', background: 'white' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ padding: '0.75rem', background: '#fef3c7', borderRadius: '12px', color: '#d97706' }}>
              <DollarSign size={22} />
            </div>
            <div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em', margin: '0 0 0.2rem 0', textTransform: 'uppercase' }}>
                Facturación Estimada Mensual
              </p>
              <h4 style={{ fontSize: '1.4rem', fontWeight: 900, margin: 0 }}>
                RD$ {totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </h4>
            </div>
          </div>
        </div>

      </div>

      {/* Grid de Sucursales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.5rem' }}>
        {salons.map((empresa) => (
          <motion.div 
            key={empresa.id}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="surface-card"
            style={{ 
              borderRadius: '20px', 
              padding: '1.75rem', 
              display: 'flex', 
              flexDirection: 'column', 
              justifyContent: 'space-between',
              background: 'white',
              boxShadow: '0 4px 14px rgba(0,0,0,0.03)',
              position: 'relative'
            }}
          >
            <div>
              {/* Header de la Tarjeta */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
                <div style={{ width: '46px', height: '46px', borderRadius: '14px', background: '#eff6ff', color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #bfdbfe' }}>
                  <Building size={22} />
                </div>
                
                {empresa.status === 'PendingPayment' || empresa.is_active === false ? (
                  <span style={{ 
                    background: '#fef3c7', 
                    color: '#92400e', 
                    border: '1px solid #fde68a', 
                    padding: '0.25rem 0.65rem', 
                    borderRadius: '99px', 
                    fontSize: '0.68rem', 
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem'
                  }}>
                    <div style={{ width: '6px', height: '6px', background: '#d97706', borderRadius: '50%' }}></div>
                    PENDIENTE DE PAGO
                  </span>
                ) : (
                  <span style={{ 
                    background: '#f0fdf4', 
                    color: '#166534', 
                    border: '1px solid #bbf7d0', 
                    padding: '0.25rem 0.65rem', 
                    borderRadius: '99px', 
                    fontSize: '0.68rem', 
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem'
                  }}>
                    <div style={{ width: '6px', height: '6px', background: '#22c55e', borderRadius: '50%' }}></div>
                    OPERATIVA
                  </span>
                )}
              </div>

              {/* Título y Dirección */}
              <h3 style={{ fontSize: '1.2rem', fontWeight: 900, margin: '0 0 0.5rem 0', color: '#0f172a' }}>
                {empresa.name}
              </h3>
              
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.75rem 0', display: 'flex', alignItems: 'flex-start', gap: '0.5rem', lineHeight: 1.4 }}>
                <MapPin size={15} color="#2563eb" style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>{empresa.address || 'Sin dirección registrada'}</span>
              </p>

              {/* Teléfono */}
              {empresa.phone && (
                <p style={{ fontSize: '0.78rem', color: '#475569', margin: '0 0 1.25rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                  <Phone size={14} color="#64748b" />
                  <a href={`tel:${empresa.phone}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                    {empresa.phone}
                  </a>
                </p>
              )}

              {/* Métricas de la Sede */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.85rem 1rem', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Clientas Afiliadas:</span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#1d4ed8' }}>{empresa.client_count || 0}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Facturación Estimada:</span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#0f172a' }}>
                    RD$ {Number(empresa.total_revenue || 0).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Acciones y Links */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1rem', borderTop: '1px solid #f1f5f9', gap: '0.5rem' }}>
              
              {empresa.maps_url ? (
                <a 
                  href={empresa.maps_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', fontWeight: 700, color: '#2563eb', textDecoration: 'none' }}
                >
                  <ExternalLink size={13} /> Ver en Maps
                </a>
              ) : (
                <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Sin GPS</span>
              )}

              <div style={{ display: 'flex', gap: '0.4rem' }}>
                {empresa.status === 'PendingPayment' && (
                  <button 
                    onClick={() => handleResumePendingBranch(empresa)}
                    title="Completar pago de la sucursal"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: '#fffbeb', border: '1px solid #fcd34d', color: '#b45309', borderRadius: '8px', padding: '0.45rem 0.75rem', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer' }}
                  >
                    <CreditCard size={13} /> Pagar
                  </button>
                )}

                <button 
                  onClick={() => openForm(empresa)}
                  title="Editar Sucursal"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: '#f8fafc', border: '1px solid #e2e8f0', color: '#334155', borderRadius: '8px', padding: '0.45rem 0.75rem', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  <Edit2 size={13} /> Editar
                </button>

                <button 
                  onClick={() => handleDeleteSalon(empresa)}
                  title="Eliminar Sucursal"
                  style={{ background: '#fef2f2', border: '1px solid #fee2e2', color: '#ef4444', borderRadius: '8px', padding: '0.45rem 0.65rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Trash2 size={14} />
                </button>
              </div>

            </div>
          </motion.div>
        ))}

        {/* Card Placeholder para Crear Nueva */}
        <button 
          onClick={() => openForm()} 
          style={{ 
            border: '2px dashed var(--border-subtle)', 
            borderRadius: '20px', 
            background: '#fafafa',
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center', 
            gap: '1rem', 
            color: 'var(--text-secondary)', 
            cursor: 'pointer',
            minHeight: '280px',
            padding: '2rem',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#0f172a';
            e.currentTarget.style.color = '#0f172a';
            e.currentTarget.style.background = '#f8fafc';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-subtle)';
            e.currentTarget.style.color = 'var(--text-secondary)';
            e.currentTarget.style.background = '#fafafa';
          }}
        >
          <div style={{ width: '54px', height: '54px', borderRadius: '50%', background: 'white', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 10px rgba(0,0,0,0.04)' }}>
            <Plus size={24} />
          </div>
          <span style={{ fontWeight: 800, fontSize: '0.88rem', letterSpacing: '0.02em' }}>
            + Registrar Nueva Sucursal
          </span>
        </button>
      </div>

      {/* Modal: Crear / Editar Sucursal */}
      <AnimatePresence>
        {showModal && (
          <div 
            style={{ 
              position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', 
              backgroundColor: 'rgba(15, 23, 42, 0.65)', zIndex: 1000, 
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backdropFilter: 'blur(5px)',
              padding: '1rem',
              overflowY: 'auto'
            }}
            onClick={() => !submittingPayment && setShowModal(false)}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="surface-card"
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto', borderRadius: '20px', padding: '2rem', position: 'relative' }}
            >
              <button 
                onClick={() => setShowModal(false)} 
                disabled={submittingPayment}
                style={{ position: 'absolute', top: '1.25rem', right: '1.25rem', background: '#f1f5f9', border: 'none', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>

              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '0.75rem' }}>
                  <Store size={22} />
                </div>
                <h3 style={{ fontWeight: 900, fontSize: '1.35rem', margin: '0 0 0.2rem 0' }}>
                  {editingSalon ? 'Editar Sucursal' : (licensingStatus?.canCreateWithoutPayment || quote?.canCreateWithoutPayment) ? 'Nueva Sucursal (Licencia Disponible)' : 'Contratar Nueva Sucursal'}
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: 0 }}>
                  {editingSalon 
                    ? 'Actualiza los datos del punto de servicio.' 
                    : (licensingStatus?.canCreateWithoutPayment || quote?.canCreateWithoutPayment)
                      ? 'Cuentas con una licencia pagada en tu suscripción. Activa tu nueva sede sin costo adicional.'
                      : 'Contratación comercial de sucursal adicional con prorrateo canónico y cobro seguro CardNet.'}
                </p>
              </div>

              {checkoutVerifyingMsg && (
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '12px 16px', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px', color: '#1e40af', fontSize: '13px', fontWeight: 600 }}>
                  <RefreshCw size={16} className="sb-spin" />
                  <span>{checkoutVerifyingMsg}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase' }}>
                    Nombre de la Sucursal *
                  </label>
                  <input 
                    type="text" 
                    className="input-field" 
                    placeholder="Ej: Empresa Piantini Central"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    required
                    disabled={submittingPayment}
                    style={{ borderRadius: '10px', padding: '0.65rem' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase' }}>
                    Dirección Física
                  </label>
                  <textarea 
                    className="input-field" 
                    placeholder="Av. Gustavo Mejía Ricart, Plaza..."
                    value={formData.address}
                    onChange={e => setFormData({ ...formData, address: e.target.value })}
                    rows={2}
                    disabled={submittingPayment}
                    style={{ borderRadius: '10px', padding: '0.65rem', resize: 'none' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase' }}>
                      Teléfono
                    </label>
                    <input 
                      type="text" 
                      className="input-field" 
                      placeholder="809-561-5000"
                      value={formData.phone}
                      onChange={e => setFormData({ ...formData, phone: e.target.value })}
                      disabled={submittingPayment}
                      style={{ borderRadius: '10px', padding: '0.65rem' }}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase' }}>
                      Google Maps (URL)
                    </label>
                    <input 
                      type="text" 
                      className="input-field" 
                      placeholder="https://maps.app..."
                      value={formData.maps_url}
                      onChange={e => setFormData({ ...formData, maps_url: e.target.value })}
                      disabled={submittingPayment}
                      style={{ borderRadius: '10px', padding: '0.65rem' }}
                    />
                  </div>
                </div>

                {/* Confirmación Comercial cuando NO es edición */}
                {!editingSalon && (
                  <>
                    {(licensingStatus?.canCreateWithoutPayment || quote?.canCreateWithoutPayment) ? (
                      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '14px', padding: '14px 16px', color: '#166534', fontSize: '13px' }}>
                        <div style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', fontSize: '14px' }}>
                          <CheckCircle2 size={16} color="#16a34a" />
                          <span>Licencia disponible ya pagada</span>
                        </div>
                        <p style={{ margin: 0, lineHeight: 1.4 }}>
                          Tienes <strong>{licensingStatus?.availableLicenses || 1}</strong> licencia(s) de sucursal disponible(s) en tu suscripción. No se realizará ningún cobro adicional y la sede se activará de inmediato.
                        </p>
                      </div>
                    ) : (
                      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
                          <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 900, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Building size={16} color="#2563eb" />
                            Confirmación Comercial
                          </h4>
                          <span style={{ fontSize: '11px', fontWeight: 800, background: '#eff6ff', color: '#1d4ed8', padding: '2px 8px', borderRadius: '99px' }}>
                            Prorrateo Canónico
                          </span>
                        </div>

                        {loadingQuote ? (
                          <div style={{ padding: '16px', textAlign: 'center', color: '#64748b', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                            <RefreshCw size={16} className="sb-spin" />
                            <span>Calculando cotización...</span>
                          </div>
                        ) : quoteError ? (
                          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '10px 14px', color: '#b91c1c', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <AlertTriangle size={16} />
                            <span>{quoteError}</span>
                          </div>
                        ) : quote ? (
                          <>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
                              <div>
                                <span style={{ color: '#64748b' }}>Incremento de sucursales:</span>{' '}
                                <strong>{quote.currentBranches} actuales → {quote.newBranchesCount} tras contratar (+1 sede)</strong>
                              </div>
                              <div>
                                <span style={{ color: '#64748b' }}>Precio mensual licencia:</span>{' '}
                                <strong>US$ {Number(quote.branchMonthlyUsd).toFixed(2)}/mes</strong>
                              </div>
                              <div>
                                <span style={{ color: '#64748b' }}>Usuarios incluidos:</span>{' '}
                                <strong>+3 usuarios facturables (+1 sucursal)</strong>
                              </div>
                              <div>
                                <span style={{ color: '#64748b' }}>Prorrateo del ciclo:</span>{' '}
                                <strong>{quote.remainingDays} días restantes</strong>
                              </div>
                            </div>

                            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '10px 12px', fontSize: '11.5px', color: '#1e40af', lineHeight: 1.45 }}>
                              <strong>Nota sobre Membresías B2C:</strong> El módulo adicional de Suscripciones y Membresías se gestiona y contrata exclusivamente desde <em>Mi suscripción → Add-on Suscripciones y Membresías</em> (por bloques de hasta 3 sucursales). Crear una sucursal aquí solo contrata la licencia del Plan Principal.
                            </div>

                            {/* Desglose Financiero */}
                            <div style={{ background: '#0f172a', color: 'white', borderRadius: '12px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                                <span>Importe USD prorrateado (+1 sucursal):</span>
                                <strong style={{ color: 'white' }}>US$ {(Number(quote.totalUsdMinor) / 100).toFixed(2)}</strong>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                                <span>Impuestos aplicables:</span>
                                <strong style={{ color: 'white' }}>US$ 0.00 (Exento B2B)</strong>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #334155', paddingTop: '8px', marginTop: '4px' }}>
                                <span style={{ fontWeight: 800, fontSize: '13px', color: '#f8fafc' }}>Total exacto a cobrar hoy:</span>
                                <span style={{ fontSize: '16px', fontWeight: 900, color: '#4ade80' }}>
                                  US$ {(Number(quote.totalUsdMinor) / 100).toFixed(2)}
                                </span>
                              </div>
                              <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                                Nuevo total recurrente de licencias principales: <strong>US$ {Number(quote.nextMonthlyUsd).toFixed(2)}/mes</strong> · Próxima renovación: <strong>{new Date(quote.periodEnd).toLocaleDateString('es-DO')}</strong>
                              </div>
                            </div>

                            {/* Método de Pago */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              <label style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: '#475569' }}>
                                Método de Pago
                              </label>

                              {licensingStatus?.defaultPaymentMethod ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', cursor: 'pointer', background: paymentMethodChoice === 'saved_card' ? '#eff6ff' : 'white' }}>
                                    <input 
                                      type="radio" 
                                      name="pmChoice" 
                                      value="saved_card" 
                                      checked={paymentMethodChoice === 'saved_card'}
                                      onChange={() => setPaymentMethodChoice('saved_card')}
                                      disabled={submittingPayment}
                                    />
                                    <CreditCard size={15} color="#2563eb" />
                                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                                      Tarjeta guardada: {licensingStatus.defaultPaymentMethod.brand} •••• {licensingStatus.defaultPaymentMethod.last4}
                                    </span>
                                  </label>

                                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', cursor: 'pointer', background: paymentMethodChoice === 'cardnet' ? '#eff6ff' : 'white' }}>
                                    <input 
                                      type="radio" 
                                      name="pmChoice" 
                                      value="cardnet" 
                                      checked={paymentMethodChoice === 'cardnet'}
                                      onChange={() => setPaymentMethodChoice('cardnet')}
                                      disabled={submittingPayment}
                                    />
                                    <ShieldCheck size={15} color="#16a34a" />
                                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                                      Pagar con otra tarjeta vía CardNet (3D Secure)
                                    </span>
                                  </label>
                                </div>
                              ) : (
                                <div style={{ padding: '8px 12px', background: 'white', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '12px', color: '#475569', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <ShieldCheck size={16} color="#2563eb" />
                                  <span>Pago seguro mediante pasarela CardNet (3D Secure). Se solicitará tu tarjeta en el checkout oficial.</span>
                                </div>
                              )}
                            </div>
                          </>
                        ) : null}
                      </div>
                    )}
                  </>
                )}

                {/* Botones de Acción */}
                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <button 
                    type="button" 
                    className="btn-secondary"
                    onClick={() => setShowModal(false)}
                    disabled={submittingPayment}
                    style={{ flex: 1, padding: '0.85rem', borderRadius: '12px', fontSize: '0.88rem', fontWeight: 800, background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#334155', cursor: 'pointer' }}
                  >
                    Cancelar
                  </button>

                  <button 
                    type="submit" 
                    className="btn-primary" 
                    disabled={submittingPayment || (!editingSalon && !licensingStatus?.canCreateWithoutPayment && !quote) || loadingQuote}
                    style={{ flex: 2, padding: '0.85rem', borderRadius: '12px', fontSize: '0.88rem', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', cursor: 'pointer' }}
                  >
                    {submittingPayment ? (
                      <>
                        <RefreshCw size={16} className="sb-spin" />
                        <span>Procesando...</span>
                      </>
                    ) : editingSalon ? (
                      <>
                        <Save size={16} />
                        <span>Guardar Cambios</span>
                      </>
                    ) : (licensingStatus?.canCreateWithoutPayment || quote?.canCreateWithoutPayment) ? (
                      <>
                        <CheckCircle2 size={16} />
                        <span>Activar sucursal (Sin costo adicional)</span>
                      </>
                    ) : quote ? (
                      <>
                        <CreditCard size={16} />
                        <span>Continuar al pago (US$ {(Number(quote.totalUsdMinor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>
                      </>
                    ) : (
                      <>
                        <CreditCard size={16} />
                        <span>Continuar</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};

export default SalonsModule;
