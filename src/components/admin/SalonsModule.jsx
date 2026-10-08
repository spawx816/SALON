import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  MapPin, Plus, Trash2, Building, ArrowRight, Sparkles, Phone, 
  ExternalLink, Edit2, Users, DollarSign, CheckCircle2, Store, X, Save
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useNotification } from '../../context/NotificationContext';

const SalonsModule = () => {
  const [salons, setSalons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingSalon, setEditingSalon] = useState(null);
  const [formData, setFormData] = useState({ name: '', address: '', phone: '', maps_url: '' });
  const { showNotification } = useNotification();

  useEffect(() => {
    loadSalons();
  }, []);

  const loadSalons = async () => {
    setLoading(true);
    try {
      const data = await dataService.getSalons();
      setSalons(data || []);
    } catch (e) {
      console.error('Error cargando sucursales:', e);
      showNotification('Error al cargar la lista de sucursales', 'error');
    } finally {
      setLoading(false);
    }
  };

  const openForm = (salon = null) => {
    if (salon) {
      setEditingSalon(salon);
      setFormData({
        name: salon.name || '',
        address: salon.address || '',
        phone: salon.phone || '',
        maps_url: salon.maps_url || ''
      });
    } else {
      setEditingSalon(null);
      setFormData({ name: '', address: '', phone: '', maps_url: '' });
    }
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      showNotification('El nombre del salón es obligatorio', 'warning');
      return;
    }

    try {
      if (editingSalon) {
        await dataService.updateSalon(editingSalon.id, formData);
        showNotification('Sucursal actualizada con éxito', 'success');
      } else {
        await dataService.saveSalon(formData);
        showNotification('Nueva sucursal registrada con éxito', 'success');
      }
      setShowModal(false);
      setFormData({ name: '', address: '', phone: '', maps_url: '' });
      await loadSalons();
    } catch (err) {
      showNotification('Error al guardar sucursal: ' + err.message, 'error');
    }
  };

  const handleDeleteSalon = async (salon) => {
    const clientCount = salon.client_count || 0;
    const confirmMsg = clientCount > 0
      ? `⚠️ ATENCIÓN: La sucursal "${salon.name}" tiene ${clientCount} clienta(s) afiliada(s).\n\n¿Seguro que deseas eliminarla? Las clientas quedarán sin sede asignada.`
      : `¿Estás seguro de eliminar la sucursal "${salon.name}"?`;

    if (window.confirm(confirmMsg)) {
      try {
        await dataService.deleteSalon(salon.id);
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
            Administra los locales físicos, ubicaciones y puntos de servicio de tu cadena de salones.
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
        {salons.map((salon) => (
          <motion.div 
            key={salon.id}
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
              </div>

              {/* Título y Dirección */}
              <h3 style={{ fontSize: '1.2rem', fontWeight: 900, margin: '0 0 0.5rem 0', color: '#0f172a' }}>
                {salon.name}
              </h3>
              
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.75rem 0', display: 'flex', alignItems: 'flex-start', gap: '0.5rem', lineHeight: 1.4 }}>
                <MapPin size={15} color="#2563eb" style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>{salon.address || 'Sin dirección registrada'}</span>
              </p>

              {/* Teléfono */}
              {salon.phone && (
                <p style={{ fontSize: '0.78rem', color: '#475569', margin: '0 0 1.25rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                  <Phone size={14} color="#64748b" />
                  <a href={`tel:${salon.phone}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                    {salon.phone}
                  </a>
                </p>
              )}

              {/* Métricas de la Sede */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.85rem 1rem', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Clientas Afiliadas:</span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#1d4ed8' }}>{salon.client_count || 0}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Facturación Estimada:</span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#0f172a' }}>
                    RD$ {Number(salon.total_revenue || 0).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Acciones y Links */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1rem', borderTop: '1px solid #f1f5f9', gap: '0.5rem' }}>
              
              {salon.maps_url ? (
                <a 
                  href={salon.maps_url} 
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
                <button 
                  onClick={() => openForm(salon)}
                  title="Editar Sucursal"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: '#f8fafc', border: '1px solid #e2e8f0', color: '#334155', borderRadius: '8px', padding: '0.45rem 0.75rem', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  <Edit2 size={13} /> Editar
                </button>

                <button 
                  onClick={() => handleDeleteSalon(salon)}
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
              padding: '1rem'
            }}
            onClick={() => setShowModal(false)}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="surface-card"
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: '480px', borderRadius: '20px', padding: '2rem', position: 'relative' }}
            >
              <button 
                onClick={() => setShowModal(false)} 
                style={{ position: 'absolute', top: '1.25rem', right: '1.25rem', background: '#f1f5f9', border: 'none', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>

              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '0.75rem' }}>
                  <Store size={22} />
                </div>
                <h3 style={{ fontWeight: 900, fontSize: '1.35rem', margin: '0 0 0.2rem 0' }}>
                  {editingSalon ? 'Editar Sucursal' : 'Nueva Sucursal'}
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: 0 }}>
                  Configura los datos del punto de servicio para facturación y asignación de clientas.
                </p>
              </div>

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase' }}>
                    Nombre de la Sucursal
                  </label>
                  <input 
                    type="text" 
                    className="input-field" 
                    placeholder="Ej: ABATTE Peluquería San Vicente"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    required
                    style={{ borderRadius: '10px', padding: '0.65rem' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase' }}>
                    Dirección Física
                  </label>
                  <textarea 
                    className="input-field" 
                    placeholder="Av. San Vicente de Paúl, Plaza..."
                    value={formData.address}
                    onChange={e => setFormData({ ...formData, address: e.target.value })}
                    rows={2}
                    style={{ borderRadius: '10px', padding: '0.65rem', resize: 'none' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase' }}>
                    Teléfono de Contacto
                  </label>
                  <input 
                    type="text" 
                    className="input-field" 
                    placeholder="Ej: 809-561-5000"
                    value={formData.phone}
                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                    style={{ borderRadius: '10px', padding: '0.65rem' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase' }}>
                    Enlace de Google Maps (URL)
                  </label>
                  <input 
                    type="text" 
                    className="input-field" 
                    placeholder="https://maps.app.goo.gl/..."
                    value={formData.maps_url}
                    onChange={e => setFormData({ ...formData, maps_url: e.target.value })}
                    style={{ borderRadius: '10px', padding: '0.65rem' }}
                  />
                </div>

                <button 
                  type="submit" 
                  className="btn-primary" 
                  style={{ width: '100%', marginTop: '0.5rem', padding: '0.85rem', borderRadius: '12px', fontSize: '0.9rem', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                >
                  <Save size={16} />
                  <span>{editingSalon ? 'Guardar Cambios' : 'Registrar Sucursal'}</span>
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};

export default SalonsModule;
