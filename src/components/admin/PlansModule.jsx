import React, { useState, useEffect } from 'react';
import { Plus, MapPin, Layers, CheckCircle2, MoreVertical, Edit2, Trash2, X, Save } from 'lucide-react';
import { useTranslation } from '../../context/LanguageContext';
import { dataService } from '../../utils/dataService';
import BulkItemImporter from './BulkItemImporter';

const PlanCard = ({ plan, onEdit, onDelete, t }) => {
  const hasDiscount = plan.discount && plan.discount > 0;
  const originalPrice = parseFloat(plan.price);
  const discountedPrice = hasDiscount ? (originalPrice - (originalPrice * plan.discount / 100)).toFixed(2) : plan.price;

  const isFeatured = plan.location.includes('Abatte');

  return (
    <div className="surface-card" style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100%', 
      position: 'relative', 
      overflow: 'hidden',
      border: isFeatured ? '2px solid #d4af37' : '1px solid var(--border-subtle)',
      boxShadow: isFeatured ? '0 12px 24px rgba(212, 175, 55, 0.1)' : 'none'
    }}>
      <div style={{ position: 'absolute', top: '-2rem', right: '-2rem', width: '6rem', height: '6rem', borderRadius: '50%', opacity: 0.1, background: plan.color || '#d4af37' }}></div>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div style={{ padding: '0.75rem', borderRadius: '1rem', background: '#09090b', color: 'white' }}>
          <Layers size={24} />
        </div>
        {isFeatured && (
          <span style={{ 
            background: '#d4af37', 
            color: 'white', 
            fontSize: '0.6rem', 
            fontWeight: 900, 
            padding: '0.4rem 0.75rem', 
            borderRadius: '99px',
            textTransform: 'uppercase',
            letterSpacing: '0.1em'
          }}>Sede Principal</span>
        )}
      </div>

      <h3 style={{ fontSize: '1.25rem', fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, marginBottom: '0.5rem' }}>{plan.title}</h3>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '1.5rem' }}>
        {hasDiscount && (
          <span style={{ textDecoration: 'line-through', color: 'var(--text-secondary)', fontSize: '1rem', fontWeight: 600 }}>
            RD${parseFloat(plan.price).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
          <span style={{ fontSize: '2.5rem', fontWeight: 800 }}>RD${Number(discountedPrice).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 600 }}>{t('plans.month')}</span>
          {hasDiscount && <span style={{ background: '#fef2f2', color: '#ef4444', padding: '0.25rem 0.5rem', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 800, marginLeft: 'auto' }}>-{plan.discount}% OFERTA</span>}
        </div>
      </div>

    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: isFeatured ? '#92400e' : 'var(--text-secondary)', background: isFeatured ? '#fef3c7' : 'var(--bg-canvas)', border: isFeatured ? '1px solid #fde68a' : '1px solid var(--border-subtle)', padding: '0.5rem 0.75rem', borderRadius: '0.5rem', width: 'fit-content', marginBottom: '1.5rem', fontWeight: 700 }}>
      <MapPin size={14} />
      {plan.location}
    </div>

    <ul style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flexGrow: 1, marginBottom: '2rem' }}>
      {(Array.isArray(plan.services) ? plan.services : []).map((s, i) => (
        <li key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.875rem', fontWeight: 600 }}>
          <CheckCircle2 size={18} color="#10b981" style={{ flexShrink: 0 }} />
          {s}
        </li>
      ))}
    </ul>

    <div style={{ display: 'flex', gap: '0.5rem' }}>
      <button onClick={() => onEdit(plan)} className="btn-secondary" style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '0.75rem' }}>
        <Edit2 size={16} style={{ marginRight: '0.5rem' }} /> {t('plans.edit')}
      </button>
      <button onClick={() => onDelete(plan.id)} style={{ padding: '0.75rem', background: '#fef2f2', color: '#ef4444', border: 'none', borderRadius: '12px', cursor: 'pointer', transition: 'all 0.2s' }}>
        <Trash2 size={18} />
      </button>
    </div>
  </div>
  );
};

const PlansModule = () => {
  const { t } = useTranslation();
  const [plans, setPlans] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);

  // Form State
  const [formTitle, setFormTitle] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formLocation, setFormLocation] = useState('Central');
  const [formColor, setFormColor] = useState('#d4af37');
  const [formUsageLimits, setFormUsageLimits] = useState({ visits: '', services: '' });
  const [formServices, setFormServices] = useState(['', '', '']);
  const [formPromoServices, setFormPromoServices] = useState(['', '', '']);
  const [formPromoDuration, setFormPromoDuration] = useState('0');
  const [formDiscount, setFormDiscount] = useState('');
  const [formActivationFee, setFormActivationFee] = useState('');
  const [salons, setSalons] = useState([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [plansData, salonsData] = await Promise.all([
      dataService.getPlans(),
      dataService.getSalons()
    ]);
    setPlans(plansData);
    setSalons(salonsData);
  };

  const openForm = (plan = null) => {
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

    if (plan) {
      setEditingPlan(plan);
      setFormTitle(plan.title);
      setFormPrice(plan.price);
      setFormLocation(plan.location);
      setFormColor(plan.color);
      setFormDiscount(plan.discount || '');
      setFormActivationFee(plan.activation_fee || '');
      setFormUsageLimits(plan.usage_limits || { visits: '', services: '' });
      
      const srv = safeArray(plan.services);
      setFormServices(srv.length > 0 ? srv : ['', '', '']);
      
      const prm = safeArray(plan.promo_services);
      setFormPromoServices(prm.length > 0 ? prm : ['', '', '']);
      
      setFormPromoDuration(plan.promo_duration_months || '0');
    } else {
      setEditingPlan(null);
      setFormTitle('');
      setFormPrice('');
      setFormLocation('Sede Central');
      setFormColor('#d4af37');
      setFormDiscount('');
      setFormActivationFee('');
      setFormUsageLimits({ visits: '', services: '' });
      setFormServices(['', '', '']);
      setFormPromoServices(['', '', '']);
      setFormPromoDuration('0');
    }
    setIsModalOpen(true);
  };

  const handleServiceChange = (index, value) => {
    const newServices = [...formServices];
    newServices[index] = value;
    setFormServices(newServices);
  };

  const handlePromoServiceChange = (index, value) => {
    const newPromo = [...formPromoServices];
    newPromo[index] = value;
    setFormPromoServices(newPromo);
  };

  const savePlan = async (e) => {
    e.preventDefault();
    const cleanServices = formServices.filter(s => s && s.trim() !== '');
    const cleanPromo = formPromoServices.filter(s => s && s.trim() !== '');

    let applyToExisting = false;
    if (editingPlan) {
      applyToExisting = window.confirm('¿Deseas aplicar estos cambios a los clientes que ya tienen este plan contratado?');
    }
    
    const targetPlan = {
      id: editingPlan ? editingPlan.id : Date.now().toString(),
      title: formTitle,
      price: formPrice,
      activation_fee: formActivationFee || 0,
      discount: formDiscount ? parseInt(formDiscount, 10) : 0,
      location: formLocation,
      color: formColor,
      services: cleanServices.length > 0 ? cleanServices : ['Lavado Incluido'],
      promo_services: cleanPromo,
      promo_duration_months: parseInt(formPromoDuration, 10) || 0,
      usage_limits: formUsageLimits
    };

    let updatedPlans;
    if (editingPlan) {
      updatedPlans = plans.map(p => p.id === editingPlan.id ? targetPlan : p);
    } else {
      updatedPlans = [...plans, targetPlan];
    }
    
    setPlans(updatedPlans);
    await dataService.savePlans(updatedPlans, applyToExisting);
    await loadData(); // Refresh to update locations grid if needed
    setIsModalOpen(false);
  };

  const deletePlan = async (id) => {
    if (window.confirm('¿Seguro que deseas eliminar este plan?')) {
      const updatedPlans = plans.filter(p => p.id !== id);
      setPlans(updatedPlans);
      await dataService.savePlans(updatedPlans);
    }
  };

  return (
    <div>
      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: '2rem' }}>
        <div>
          <h2 className="page-title">{t('plans.title')}</h2>
          <p className="page-subtitle">{t('plans.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <MapPin size={18} />
            <span>{t('plans.loc')}</span>
          </button>
          <button onClick={() => openForm()} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Plus size={18} />
            <span>{t('plans.new')}</span>
          </button>
        </div>
      </div>

      <div className="grid-layout-3" style={{ marginBottom: '3rem' }}>
        {plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} onEdit={openForm} onDelete={deletePlan} t={t} />
        ))}
        
        {/* Add Plan Placeholder */}
        <button onClick={() => openForm()} style={{ 
          border: '2px dashed var(--border-subtle)', 
          borderRadius: '24px', 
          background: 'transparent',
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center', 
          gap: '1rem', 
          color: 'var(--text-secondary)', 
          cursor: 'pointer',
          minHeight: '400px',
          transition: 'all 0.2s'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--text-primary)';
          e.currentTarget.style.color = 'var(--text-primary)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--border-subtle)';
          e.currentTarget.style.color = 'var(--text-secondary)';
        }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Plus size={32} />
          </div>
          <span style={{ fontWeight: 800, fontFamily: "'Plus Jakarta Sans', sans-serif", textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.875rem' }}>{t('plans.create')}</span>
        </button>
      </div>

      {/* Locations Summary */}
      <div className="surface-card">
        <h3 style={{ fontSize: '1.25rem', fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <MapPin size={24} />
          {t('plans.active')}
        </h3>
        <div className="grid-layout-3">
          {salons.map(l => (
            <div key={l.id} style={{ background: 'var(--bg-canvas)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border-subtle)' }}>
              <h4 style={{ fontWeight: 800, fontSize: '1.125rem', marginBottom: '0.25rem' }}>{l.name}</h4>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '1.5rem', fontWeight: 600 }}>{l.address || 'Sin dirección'}</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{l.client_count || 0} Clientes</span>
                <span style={{ color: 'var(--text-primary)' }}>RD$ {(l.total_revenue || 0).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* MODAL overlay */}
      {isModalOpen && (
        <div style={{ 
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', 
          backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, 
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)' 
        }}>
          <div className="surface-card" style={{ width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto', position: 'relative', padding: '2.5rem' }}>
            <button 
              onClick={() => setIsModalOpen(false)} 
              className="icon-btn" 
              style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', background: '#f4f4f5', border: 'none' }}
            >
              <X size={20} />
            </button>
            <h2 style={{ fontSize: '1.5rem', fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, marginBottom: '2rem' }}>
              {editingPlan ? 'Editar Plan de Membresía' : 'Crear Nuevo Plan'}
            </h2>

            <form onSubmit={savePlan} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Nombre del Plan</label>
                <input required className="input-field" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="Ej: Elite VIP" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Precio (RD$)</label>
                  <input required type="number" step="0.01" className="input-field" value={formPrice} onChange={(e) => setFormPrice(e.target.value)} placeholder="0.00" />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Activación (RD$)</label>
                  <input type="number" step="0.01" className="input-field" value={formActivationFee} onChange={(e) => setFormActivationFee(e.target.value)} placeholder="0.00" />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Descuento (%)</label>
                  <input type="number" min="0" max="100" className="input-field" value={formDiscount} onChange={(e) => setFormDiscount(e.target.value)} placeholder="Ej. 15" />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Color</label>
                  <input type="color" className="input-field" value={formColor} onChange={(e) => setFormColor(e.target.value)} style={{ padding: '0.5rem', height: '3.3rem', width: '100%' }} />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sucursal de Emisión</label>
                <select className="input-field" value={formLocation} onChange={(e) => setFormLocation(e.target.value)}>
                  <option value="Todas las Sedes">Todas las Sedes</option>
                  {salons.map(s => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ padding: '1.5rem', background: 'var(--bg-canvas)', borderRadius: '16px', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <label style={{ fontSize: '0.875rem', fontWeight: 800, marginBottom: '0.5rem' }}>Límites de Uso Mensual</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 700 }}>Visitas Totales</label>
                    <input type="number" className="input-field" placeholder="Ilimitadas" value={formUsageLimits.visits} onChange={e => setFormUsageLimits({...formUsageLimits, visits: e.target.value})} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 700 }}>Servicios Específicos</label>
                    <input type="number" className="input-field" placeholder="Ilimitados" value={formUsageLimits.services} onChange={e => setFormUsageLimits({...formUsageLimits, services: e.target.value})} />
                  </div>
                </div>
              </div>

              <div style={{ padding: '1.5rem', background: 'var(--bg-canvas)', borderRadius: '16px', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <label style={{ fontSize: '0.875rem', fontWeight: 800, marginBottom: '0.5rem' }}>Lista de Servicios Incluidos</label>

                {[0, 1, 2, 3].map(i => (
                  <input 
                    key={i} 
                    className="input-field" 
                    placeholder={`Servicio ${i+1}`}
                    value={formServices[i] || ''}
                    onChange={(e) => handleServiceChange(i, e.target.value)} 
                    style={{ padding: '0.75rem' }} 
                  />
                ))}
              </div>

              {/* Promo Section */}
              <div style={{ padding: '1.5rem', background: '#f0fdf4', borderRadius: '16px', border: '1px solid #bbf7d0', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <label style={{ fontSize: '0.875rem', fontWeight: 800, marginBottom: '0.5rem', color: '#166534' }}>Oferta por Tiempo Limitado (Opcional)</label>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700 }}>Duración de la Oferta (Meses)</label>
                  <input type="number" className="input-field" placeholder="Ej: 3 meses" value={formPromoDuration} onChange={e => setFormPromoDuration(e.target.value)} />
                  <p style={{ fontSize: '0.65rem', color: '#166534', fontWeight: 600 }}>El cliente recibirá estos servicios durante los primeros X meses, luego volverá al plan normal.</p>
                </div>

                <label style={{ fontSize: '0.75rem', fontWeight: 700, marginTop: '0.5rem' }}>Servicios durante la Oferta</label>
                {[0, 1, 2].map(i => (
                  <input 
                    key={i} 
                    className="input-field" 
                    placeholder={`Servicio Promo ${i+1}`}
                    value={formPromoServices[i] || ''}
                    onChange={(e) => handlePromoServiceChange(i, e.target.value)} 
                    style={{ padding: '0.75rem' }} 
                  />
                ))}
              </div>

              <button type="submit" className="btn-primary" style={{ padding: '1.25rem', display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem' }}>
                <Save size={20} />
                Guardar Plan
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Carga Masiva de Ítems / Catálogo */}
      <BulkItemImporter />
    </div>
  );
};

export default PlansModule;
