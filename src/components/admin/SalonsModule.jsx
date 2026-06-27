import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Plus, Trash2, Building, ArrowRight, Sparkles } from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useNotification } from '../../context/NotificationContext';

const SalonsModule = () => {
  const [salons, setSalons] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSalon, setNewSalon] = useState({ name: '', address: '', phone: '', maps_url: '' });
  const { showNotification } = useNotification();

  useEffect(() => {
    loadSalons();
  }, []);

  const loadSalons = async () => {
    const data = await dataService.getSalons();
    setSalons(data);
  };

  const handleAddSalon = async (e) => {
    e.preventDefault();
    if (!newSalon.name) return;
    
    await dataService.saveSalon(newSalon);
    showNotification('Sucursal registrada con éxito');
    setNewSalon({ name: '', address: '', phone: '', maps_url: '' });
    setShowAddModal(false);
    loadSalons();
  };

  const handleDeleteSalon = async (id) => {
    if (window.confirm('¿Estás seguro de eliminar esta sucursal?')) {
      await dataService.deleteSalon(id);
      showNotification('Sucursal eliminada', 'warning');
      loadSalons();
    }
  };

  return (
    <div className="analytics-container">
      <div className="header-flex">
        <div>
          <h2 className="section-title">Gestión de Sucursales</h2>
          <p className="section-subtitle">Administra los locales físicos de tu cadena de salones.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowAddModal(true)}>
          <Plus size={18} />
          Añadir Sucursal
        </button>
      </div>

      <div className="grid-3" style={{ marginTop: '2rem' }}>
        {salons.map((salon) => (
          <motion.div 
            key={salon.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="surface-card salon-card"
            style={{ position: 'relative' }}
          >
            <div className="card-icon-container" style={{ background: 'var(--brand-accent-light)', color: 'var(--brand-accent)' }}>
              <Building size={24} />
            </div>
            <h3 style={{ marginTop: '1rem', fontWeight: 800 }}>{salon.name}</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <MapPin size={14} />
              {salon.address || 'Sin dirección registrada'}
            </p>
            
            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="badge badge-active">Operativa</span>
              <button 
                onClick={() => handleDeleteSalon(salon.id)}
                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0.5rem' }}
              >
                <Trash2 size={18} />
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Add Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="modal-content"
              onClick={e => e.stopPropagation()}
              style={{ maxWidth: '450px' }}
            >
              <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                <div className="form-icon-hero">
                  <Sparkles size={24} />
                </div>
                <h3 style={{ fontWeight: 800, fontSize: '1.5rem' }}>Nueva Sucursal</h3>
                <p style={{ color: 'var(--text-secondary)' }}>Configura un nuevo punto de servicio.</p>
              </div>

              <form onSubmit={handleAddSalon}>
                <div className="input-group">
                  <label>Nombre del Salón</label>
                  <input 
                    type="text" 
                    className="input-field" 
                    placeholder="Ej: PLAN BEAUTY Piantini"
                    value={newSalon.name}
                    onChange={e => setNewSalon({...newSalon, name: e.target.value})}
                    required
                  />
                </div>
                <div className="input-group">
                  <label>Dirección Física</label>
                  <textarea 
                    className="input-field" 
                    placeholder="Calle, número, sector..."
                    value={newSalon.address}
                    onChange={e => setNewSalon({...newSalon, address: e.target.value})}
                    rows={2}
                  />
                </div>
                <div className="input-group">
                  <label>Teléfono de la Sucursal</label>
                  <input 
                    type="text" 
                    className="input-field" 
                    placeholder="Ej: 809-000-0000"
                    value={newSalon.phone}
                    onChange={e => setNewSalon({...newSalon, phone: e.target.value})}
                  />
                </div>
                <div className="input-group">
                  <label>Google Maps URL</label>
                  <input 
                    type="text" 
                    className="input-field" 
                    placeholder="https://goo.gl/maps/..."
                    value={newSalon.maps_url}
                    onChange={e => setNewSalon({...newSalon, maps_url: e.target.value})}
                  />
                </div>
                <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
                  Guardar Sucursal
                  <ArrowRight size={18} />
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
