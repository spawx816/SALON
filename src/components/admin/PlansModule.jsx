import React, { useState, useEffect } from 'react';
import { 
  Plus, MapPin, Layers, CheckCircle2, MoreVertical, Edit2, Trash2, X, Save, 
  Sparkles, Users, Crown, Gift, AlertTriangle, ShieldCheck, Clock
} from 'lucide-react';
import { useTranslation } from '../../context/LanguageContext';
import { useNotification } from '../../context/NotificationContext';
import { dataService } from '../../utils/dataService';

const safeArray = (data) => {
  if (Array.isArray(data)) return data;
  if (typeof data === 'string') {
    try {
      const p = JSON.parse(data);
      return Array.isArray(p) ? p : [p];
    } catch {
      return data.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  return [];
};

const PlanCard = ({ plan, onEdit, onDelete, t }) => {
  const hasDiscount = plan.discount && plan.discount > 0;
  const originalPrice = parseFloat(plan.price || 0);
  const discountedPrice = hasDiscount ? (originalPrice - (originalPrice * plan.discount / 100)).toFixed(2) : plan.price;
  const isFeatured = (plan.location || '').includes('Abatte') || (plan.title || '').toLowerCase().includes('beauty');

  const regularServices = safeArray(plan.services);
  const promoServices = safeArray(plan.promo_services);
  const hasPromo = promoServices.length > 0 && (plan.promo_duration_months > 0);
  const activeSubscribers = plan.subscribers_count || 0;

  return (
    <div className="surface-card" style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100%', 
      position: 'relative', 
      overflow: 'hidden',
      borderRadius: '20px',
      border: isFeatured ? '2px solid #d4af37' : '1px solid var(--border-subtle)',
      boxShadow: isFeatured ? '0 12px 28px rgba(212, 175, 55, 0.12)' : '0 4px 12px rgba(0,0,0,0.03)',
      background: 'white',
      padding: '1.75rem'
    }}>
      {/* Glow Decorativo */}
      <div style={{ position: 'absolute', top: '-2.5rem', right: '-2.5rem', width: '7rem', height: '7rem', borderRadius: '50%', opacity: 0.12, background: plan.color || '#d4af37' }}></div>
      
      {/* Header de la Card */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ padding: '0.75rem', borderRadius: '14px', background: plan.color || '#09090b', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Crown size={22} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 900, margin: '0 0 0.15rem 0', letterSpacing: '-0.01em' }}>{plan.title}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                <MapPin size={12} /> {plan.location || 'Todas las sedes'}
              </span>
            </div>
          </div>
        </div>

        {/* Badges superiores */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
          {activeSubscribers > 0 && (
            <span style={{ 
              background: '#eff6ff', 
              color: '#1d4ed8', 
              border: '1px solid #bfdbfe',
              fontSize: '0.65rem', 
              fontWeight: 800, 
              padding: '0.25rem 0.6rem', 
              borderRadius: '99px',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem'
            }}>
              <Users size={11} /> {activeSubscribers} {activeSubscribers === 1 ? 'Activa' : 'Activas'}
            </span>
          )}
          {isFeatured && (
            <span style={{ 
              background: '#fef3c7', 
              color: '#92400e', 
              border: '1px solid #fde68a',
              fontSize: '0.6rem', 
              fontWeight: 900, 
              padding: '0.2rem 0.5rem', 
              borderRadius: '99px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>Destacado</span>
          )}
        </div>
      </div>

      {/* Bloque de Precio */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', marginBottom: '1.25rem', paddingBottom: '1rem', borderBottom: '1px solid #f1f5f9' }}>
        {hasDiscount && (
          <span style={{ textDecoration: 'line-through', color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: 600 }}>
            RD$ {parseFloat(plan.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '2.25rem', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.02em' }}>
            RD$ {Number(discountedPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 700 }}>/ mes</span>
          {hasDiscount && (
            <span style={{ background: '#fef2f2', color: '#ef4444', border: '1px solid #fee2e2', padding: '0.2rem 0.5rem', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 800, marginLeft: 'auto' }}>
              -{plan.discount}% OFERTA
            </span>
          )}
        </div>
        {parseFloat(plan.activation_fee || 0) > 0 && (
          <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>
            + Cuota de activación: RD$ {Number(plan.activation_fee).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </span>
        )}
      </div>

      {/* Oferta Promocional Inicial (si aplica) */}
      {hasPromo && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', padding: '0.75rem 0.9rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#166534', fontWeight: 800, fontSize: '0.75rem', marginBottom: '0.35rem' }}>
            <Sparkles size={14} color="#16a34a" />
            <span>Beneficios Meses 1 al {plan.promo_duration_months}:</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.75rem', color: '#166534', fontWeight: 600, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            {promoServices.map((ps, idx) => (
              <li key={idx}>{ps}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Servicios Regulares Incluidos */}
      <div style={{ flexGrow: 1, marginBottom: '1.5rem' }}>
        <p style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 0.75rem 0' }}>
          Beneficios del Plan:
        </p>
        <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', margin: 0, padding: 0, listStyle: 'none' }}>
          {regularServices.map((s, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
              <CheckCircle2 size={16} color="#10b981" style={{ flexShrink: 0 }} />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Botonera de Acciones */}
      <div style={{ display: 'flex', gap: '0.6rem', paddingTop: '1rem', borderTop: '1px solid #f1f5f9' }}>
        <button 
          onClick={() => onEdit(plan)} 
          className="btn-secondary" 
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', padding: '0.65rem 1rem', fontSize: '0.85rem', fontWeight: 700, borderRadius: '12px' }}
        >
          <Edit2 size={15} /> {t('plans.edit') || 'Editar'}
        </button>
        <button 
          onClick={() => onDelete(plan)} 
          title="Eliminar Plan"
          style={{ padding: '0.65rem 0.85rem', background: '#fef2f2', color: '#ef4444', border: '1px solid #fee2e2', borderRadius: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s ease' }}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
};

const PlansModule = () => {
  const { t } = useTranslation();
  const { showNotification } = useNotification();
  const [plans, setPlans] = useState([]);
  const [salons, setSalons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);

  // Form State
  const [formTitle, setFormTitle] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formLocation, setFormLocation] = useState('Todas las Sedes');
  const [formColor, setFormColor] = useState('#d4af37');
  const [formUsageLimits, setFormUsageLimits] = useState({ visits: '4', services: '' });
  const [formServices, setFormServices] = useState(['4 Lavados y Secados']);
  const [formPromoServices, setFormPromoServices] = useState(['1 Lavado Extra o Tratamiento Profundo']);
  const [formPromoDuration, setFormPromoDuration] = useState('3');
  const [formDiscount, setFormDiscount] = useState('');
  const [formActivationFee, setFormActivationFee] = useState('0');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [plansData, salonsData] = await Promise.all([
        dataService.getPlans().catch(() => []),
        dataService.getSalons().catch(() => [])
      ]);
      setPlans(plansData || []);
      setSalons(salonsData || []);
    } catch (err) {
      console.error('Error cargando planes:', err);
      showNotification('Error al cargar datos de planes', 'error');
    } finally {
      setLoading(false);
    }
  };

  const openForm = (plan = null) => {
    if (plan) {
      setEditingPlan(plan);
      setFormTitle(plan.title || '');
      setFormPrice(plan.price || '');
      setFormLocation(plan.location || 'Todas las Sedes');
      setFormColor(plan.color || '#d4af37');
      setFormDiscount(plan.discount || '');
      setFormActivationFee(plan.activation_fee || '0');
      setFormUsageLimits(plan.usage_limits || { visits: '4', services: '' });
      
      const srv = safeArray(plan.services);
      setFormServices(srv.length > 0 ? srv : ['4 Lavados y Secados']);
      
      const prm = safeArray(plan.promo_services);
      setFormPromoServices(prm.length > 0 ? prm : ['']);
      setFormPromoDuration(String(plan.promo_duration_months ?? 0));
    } else {
      setEditingPlan(null);
      setFormTitle('');
      setFormPrice('1950.00');
      setFormLocation('Todas las Sedes');
      setFormColor('#d4af37');
      setFormDiscount('');
      setFormActivationFee('0');
      setFormUsageLimits({ visits: '4', services: '' });
      setFormServices(['4 Lavados y Secados']);
      setFormPromoServices(['1 Lavado Extra o Tratamiento']);
      setFormPromoDuration('3');
    }
    setIsModalOpen(true);
  };

  const handleAddService = () => {
    setFormServices([...formServices, '']);
  };

  const handleRemoveService = (index) => {
    if (formServices.length <= 1) return;
    setFormServices(formServices.filter((_, i) => i !== index));
  };

  const handleServiceChange = (index, value) => {
    const updated = [...formServices];
    updated[index] = value;
    setFormServices(updated);
  };

  const handleAddPromoService = () => {
    setFormPromoServices([...formPromoServices, '']);
  };

  const handleRemovePromoService = (index) => {
    setFormPromoServices(formPromoServices.filter((_, i) => i !== index));
  };

  const handlePromoServiceChange = (index, value) => {
    const updated = [...formPromoServices];
    updated[index] = value;
    setFormPromoServices(updated);
  };

  const savePlan = async (e) => {
    e.preventDefault();
    const cleanServices = formServices.map(s => s.trim()).filter(Boolean);
    const cleanPromo = formPromoServices.map(s => s.trim()).filter(Boolean);

    if (cleanServices.length === 0) {
      showNotification('Debes ingresar al menos un servicio incluido.', 'warning');
      return;
    }

    let applyToExisting = false;
    if (editingPlan && (editingPlan.subscribers_count || 0) > 0) {
      applyToExisting = window.confirm(
        `Este plan cuenta con ${editingPlan.subscribers_count} contratos activos.\n\n¿Deseas aplicar estos cambios de tarifa y servicios a las clientas existentes?`
      );
    }
    
    const targetPlan = {
      id: editingPlan ? editingPlan.id : Date.now().toString(),
      title: formTitle,
      price: formPrice,
      activation_fee: formActivationFee || 0,
      discount: formDiscount ? parseInt(formDiscount, 10) : 0,
      location: formLocation,
      color: formColor,
      services: cleanServices,
      promo_services: cleanPromo,
      promo_duration_months: parseInt(formPromoDuration, 10) || 0,
      usage_limits: formUsageLimits
    };

    let updatedPlans;
    if (editingPlan) {
      updatedPlans = plans.map(p => p.id === editingPlan.id ? { ...p, ...targetPlan } : p);
    } else {
      updatedPlans = [...plans, targetPlan];
    }
    
    setPlans(updatedPlans);
    try {
      showNotification('Guardando plan de membresía...');
      const res = await dataService.savePlans(updatedPlans, applyToExisting);
      if (res && res.success !== false) {
        showNotification(editingPlan ? 'Plan actualizado exitosamente' : 'Nuevo plan creado exitosamente', 'success');
        await loadData();
        setIsModalOpen(false);
      } else {
        throw new Error(res?.error || 'Error al guardar el plan');
      }
    } catch (err) {
      showNotification(err.message, 'error');
    }
  };

  const deletePlan = async (plan) => {
    const activeCount = plan.subscribers_count || 0;
    const confirmMsg = activeCount > 0
      ? `⚠️ ATENCIÓN: El plan "${plan.title}" tiene ${activeCount} clienta(s) con contratos activos.\n\n¿Seguro que deseas eliminarlo? Los contratos existentes mantendrán su historial pero no se podrán registrar nuevas afiliaciones a este plan.`
      : `¿Seguro que deseas eliminar el plan "${plan.title}"?`;

    if (window.confirm(confirmMsg)) {
      const updatedPlans = plans.filter(p => p.id !== plan.id);
      setPlans(updatedPlans);
      try {
        await dataService.savePlans(updatedPlans);
        showNotification('Plan eliminado correctamente', 'success');
        await loadData();
      } catch (err) {
        showNotification('Error al eliminar el plan', 'error');
      }
    }
  };

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem', paddingBottom: '4rem' }}>
      
      {/* Page Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 className="page-title" style={{ fontSize: '2.25rem', fontWeight: 900, letterSpacing: '-0.02em', margin: '0 0 0.25rem 0' }}>
            Planes de Membresía
          </h2>
          <p className="page-subtitle" style={{ margin: 0, color: 'var(--text-secondary)' }}>
            Configuración de cuotas mensuales, cupo de servicios, promociones y sincronización de contratos.
          </p>
        </div>
        
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button 
            onClick={() => openForm()} 
            className="btn-primary" 
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 1.35rem', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 800 }}
          >
            <Plus size={18} />
            <span>Crear Nuevo Plan</span>
          </button>
        </div>
      </div>

      {/* Grid de Planes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
        {plans.map((plan) => (
          <PlanCard 
            key={plan.id} 
            plan={plan} 
            onEdit={openForm} 
            onDelete={deletePlan} 
            t={t} 
          />
        ))}
        
        {/* Card Placeholder para Crear Nuevo */}
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
            minHeight: '380px',
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
          <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'white', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 10px rgba(0,0,0,0.04)' }}>
            <Plus size={28} />
          </div>
          <span style={{ fontWeight: 800, fontSize: '0.9rem', letterSpacing: '0.02em' }}>
            + Diseñar Nuevo Plan de Membresía
          </span>
        </button>
      </div>

      {/* MODAL: Crear / Editar Plan */}
      {isModalOpen && (
        <div style={{ 
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', 
          backgroundColor: 'rgba(15, 23, 42, 0.65)', zIndex: 1000, 
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(5px)',
          padding: '1rem'
        }}>
          <div className="surface-card" style={{ width: '100%', maxWidth: '620px', maxHeight: '90vh', overflowY: 'auto', position: 'relative', padding: '2rem', borderRadius: '20px' }}>
            
            <button 
              onClick={() => setIsModalOpen(false)} 
              className="icon-btn" 
              style={{ position: 'absolute', top: '1.25rem', right: '1.25rem', background: '#f1f5f9', border: 'none', borderRadius: '50%', width: '34px', height: '34px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <X size={18} />
            </button>

            <h2 style={{ fontSize: '1.4rem', fontWeight: 900, marginBottom: '0.25rem' }}>
              {editingPlan ? `Editar: ${editingPlan.title}` : 'Crear Nuevo Plan de Membresía'}
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 1.5rem 0' }}>
              Define los precios, cupos de lavado y promociones iniciales para los contratos.
            </p>

            <form onSubmit={savePlan} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              
              {/* Nombre y Color */}
              <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase' }}>Nombre del Plan</label>
                  <input 
                    required 
                    className="input-field" 
                    value={formTitle} 
                    onChange={(e) => setFormTitle(e.target.value)} 
                    placeholder="Ej: Plan Beauty VIP" 
                    style={{ borderRadius: '10px', padding: '0.65rem' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase' }}>Color</label>
                  <input 
                    type="color" 
                    value={formColor} 
                    onChange={(e) => setFormColor(e.target.value)} 
                    style={{ padding: '0.2rem', height: '2.5rem', width: '100%', borderRadius: '10px', border: '1px solid var(--border-subtle)', cursor: 'pointer' }} 
                  />
                </div>
              </div>

              {/* Precios y Descuento */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase' }}>Precio Mensual (RD$)</label>
                  <input 
                    required 
                    type="number" 
                    step="0.01" 
                    className="input-field" 
                    value={formPrice} 
                    onChange={(e) => setFormPrice(e.target.value)} 
                    placeholder="1950.00" 
                    style={{ borderRadius: '10px', padding: '0.65rem', fontWeight: 800 }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase' }}>Activación (RD$)</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    className="input-field" 
                    value={formActivationFee} 
                    onChange={(e) => setFormActivationFee(e.target.value)} 
                    placeholder="0.00" 
                    style={{ borderRadius: '10px', padding: '0.65rem' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase' }}>Descuento (%)</label>
                  <input 
                    type="number" 
                    min="0" 
                    max="100" 
                    className="input-field" 
                    value={formDiscount} 
                    onChange={(e) => setFormDiscount(e.target.value)} 
                    placeholder="0" 
                    style={{ borderRadius: '10px', padding: '0.65rem' }}
                  />
                </div>
              </div>

              {/* Sucursal de Emisión */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase' }}>Sede o Sucursal Aplicable</label>
                <select 
                  className="input-field" 
                  value={formLocation} 
                  onChange={(e) => setFormLocation(e.target.value)}
                  style={{ borderRadius: '10px', padding: '0.65rem', background: 'white' }}
                >
                  <option value="Todas las Sedes">Todas las Sedes (Red Afiliada Plan Beauty)</option>
                  {salons.map(s => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Lista Dinámica de Servicios Regulares */}
              <div style={{ padding: '1.25rem', background: '#f8fafc', borderRadius: '14px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 800, color: '#0f172a' }}>
                    Servicios Incluidos en la Membresía
                  </label>
                  <button
                    type="button"
                    onClick={handleAddService}
                    style={{ background: 'white', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.25rem 0.6rem', fontSize: '0.7rem', fontWeight: 800, color: '#2563eb', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                  >
                    <Plus size={12} /> Agregar Servicio
                  </button>
                </div>

                {formServices.map((srv, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input 
                      className="input-field" 
                      placeholder={`Ej: 4 Lavados y Secados por mes`}
                      value={srv}
                      onChange={(e) => handleServiceChange(idx, e.target.value)} 
                      style={{ borderRadius: '8px', padding: '0.55rem 0.75rem', fontSize: '0.82rem', flex: 1 }} 
                    />
                    {formServices.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveService(idx)}
                        style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#ef4444', borderRadius: '8px', padding: '0.5rem', cursor: 'pointer' }}
                        title="Eliminar línea"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Oferta Promocional Inicial (Opcional) */}
              <div style={{ padding: '1.25rem', background: '#f0fdf4', borderRadius: '14px', border: '1px solid #bbf7d0', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Sparkles size={16} color="#16a34a" />
                    <label style={{ fontSize: '0.85rem', fontWeight: 800, color: '#166534' }}>
                      Oferta Promocional de Bienvenida (Opcional)
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddPromoService}
                    style={{ background: 'white', border: '1px solid #86efac', borderRadius: '8px', padding: '0.25rem 0.6rem', fontSize: '0.7rem', fontWeight: 800, color: '#166534', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                  >
                    <Plus size={12} /> Agregar Beneficio
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#166534' }}>Duración:</label>
                  <input 
                    type="number" 
                    min="0" 
                    max="12" 
                    className="input-field" 
                    placeholder="Meses" 
                    value={formPromoDuration} 
                    onChange={e => setFormPromoDuration(e.target.value)} 
                    style={{ width: '80px', borderRadius: '8px', padding: '0.4rem 0.6rem', fontSize: '0.8rem', background: 'white' }}
                  />
                  <span style={{ fontSize: '0.72rem', color: '#166534', fontWeight: 600 }}>meses iniciales con este beneficio extra</span>
                </div>

                {formPromoServices.map((prm, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input 
                      className="input-field" 
                      placeholder={`Ej: 1 Lavado Extra o Tratamiento Profundo`}
                      value={prm}
                      onChange={(e) => handlePromoServiceChange(idx, e.target.value)} 
                      style={{ borderRadius: '8px', padding: '0.55rem 0.75rem', fontSize: '0.82rem', flex: 1, background: 'white' }} 
                    />
                    <button
                      type="button"
                      onClick={() => handleRemovePromoService(idx)}
                      style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#ef4444', borderRadius: '8px', padding: '0.5rem', cursor: 'pointer' }}
                      title="Eliminar beneficio promo"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Botón Guardar */}
              <button 
                type="submit" 
                className="btn-primary" 
                style={{ padding: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', borderRadius: '12px', fontSize: '0.95rem', fontWeight: 800 }}
              >
                <Save size={18} />
                Guardar y Sincronizar Plan
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlansModule;
