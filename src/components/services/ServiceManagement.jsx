import React, { useState, useEffect } from 'react';
import { 
  Sparkles, Plus, Search, Edit3, Trash2, Power, CheckCircle2, XCircle, 
  Tag, DollarSign, Percent, ShieldCheck, ArrowUpDown, Filter, AlertCircle
} from 'lucide-react';
import { dataService } from '../../utils/dataService';

const ServiceManagement = () => {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [statusFilter, setStatusFilter] = useState('Todos');

  // Modal States
  const [showModal, setShowModal] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [formData, setFormData] = useState({
    nombre: '',
    descripcion: '',
    categoria: 'Peluquería',
    precio: '',
    activo: 1,
    genera_comision: 1,
    tipo_comision: 'Porcentaje',
    comision_valor: '15',
    aplica_itbis: 0,
    orden_visualizacion: '0',
    imagen_url: ''
  });

  const categories = ['Todas', 'Peluquería', 'Coloración', 'Tratamientos', 'Uñas', 'Estética', 'Productos', 'General'];

  useEffect(() => {
    loadServices();
  }, []);

  const loadServices = async () => {
    setLoading(true);
    try {
      const data = await dataService.getServices();
      setServices(data || []);
    } catch (e) {
      console.error('Error cargando servicios:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenNewModal = () => {
    setEditingService(null);
    setFormData({
      nombre: '',
      descripcion: '',
      categoria: 'Peluquería',
      precio: '',
      activo: 1,
      genera_comision: 1,
      tipo_comision: 'Porcentaje',
      comision_valor: '15',
      aplica_itbis: 0,
      orden_visualizacion: '0',
      imagen_url: ''
    });
    setShowModal(true);
  };

  const handleOpenEditModal = (service) => {
    setEditingService(service);
    setFormData({
      nombre: service.nombre || '',
      descripcion: service.descripcion || '',
      categoria: service.categoria || 'General',
      precio: service.precio || '',
      activo: service.activo ? 1 : 0,
      genera_comision: service.genera_comision ? 1 : 0,
      tipo_comision: service.tipo_comision || 'Porcentaje',
      comision_valor: service.comision_valor || '0',
      aplica_itbis: service.aplica_itbis ? 1 : 0,
      orden_visualizacion: service.orden_visualizacion || '0',
      imagen_url: service.imagen_url || ''
    });
    setShowModal(true);
  };

  const handleSaveService = async (e) => {
    e.preventDefault();
    if (!formData.nombre.trim()) {
      alert('Por favor ingresa el nombre del servicio.');
      return;
    }
    const price = parseFloat(formData.precio);
    if (isNaN(price) || price < 0) {
      alert('Por favor ingresa un precio válido.');
      return;
    }

    setLoading(true);
    try {
      if (editingService) {
        const res = await dataService.updateService(editingService.id, formData);
        alert(res.message || '✅ Servicio actualizado exitosamente.');
      } else {
        const res = await dataService.createService(formData);
        alert(res.message || '✅ Servicio creado exitosamente.');
      }
      setShowModal(false);
      await loadServices();
    } catch (err) {
      alert('Error guardando servicio: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (service) => {
    try {
      const res = await dataService.toggleServiceStatus(service.id);
      await loadServices();
    } catch (e) {
      alert('Error cambiando estado: ' + e.message);
    }
  };

  const handleDeleteService = async (service) => {
    if (!window.confirm(`¿Estás seguro de eliminar el servicio "${service.nombre}"?`)) return;
    try {
      const res = await dataService.deleteService(service.id);
      alert(res.message);
      await loadServices();
    } catch (e) {
      alert('Error eliminando servicio: ' + e.message);
    }
  };

  // Filtering
  const filteredServices = services.filter(s => {
    const matchesSearch = s.nombre.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (s.descripcion && s.descripcion.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = selectedCategory === 'Todas' || s.categoria === selectedCategory;
    const matchesStatus = statusFilter === 'Todos' || 
                          (statusFilter === 'Activos' && s.activo === 1) || 
                          (statusFilter === 'Inactivos' && s.activo === 0);
    return matchesSearch && matchesCategory && matchesStatus;
  });

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '1.5rem' }}>
      
      {/* HEADER BANNER */}
      <div style={{ background: '#0f172a', color: '#ffffff', padding: '1.5rem 2rem', borderRadius: '20px', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 10px 25px -5px rgba(15,23,42,0.3)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.25rem' }}>
            <Sparkles size={24} style={{ color: '#ec4899' }} />
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.5px' }}>
              Gestión de Ítems y Catálogo de Servicios
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#94a3b8' }}>
            Administra los servicios, precios, comisiones e impuestos disponibles para facturación POS.
          </p>
        </div>

        <button
          onClick={handleOpenNewModal}
          style={{
            background: '#be185d', color: '#ffffff', border: 'none', padding: '0.75rem 1.5rem',
            borderRadius: '12px', fontWeight: 800, fontSize: '0.9rem', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: '0 4px 12px rgba(190,24,93,0.3)'
          }}
          className="hover-lift"
        >
          <Plus size={18} />
          <span>+ Agregar Nuevo Servicio</span>
        </button>
      </div>

      {/* HISTORICAL INTEGRITY AUDIT BANNER */}
      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '14px', padding: '0.875rem 1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <ShieldCheck size={22} style={{ color: '#2563eb', flexShrink: 0 }} />
        <span style={{ fontSize: '0.825rem', color: '#1e40af', fontWeight: 600 }}>
          <strong>Protección de Histórico Garantizada:</strong> La actualización de precios en esta sección actualiza únicamente el catálogo para nuevas ventas. Las facturas y tickets emitidos previamente preservan de forma inalterable su precio histórico.
        </span>
      </div>

      {/* FILTERS AND SEARCH */}
      <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '16px', border: '1px solid #e2e8f0', marginBottom: '1.5rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
        
        {/* Search */}
        <div style={{ position: 'relative', flex: 1, minWidth: '260px' }}>
          <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          <input
            type="text"
            placeholder="Buscar por nombre o descripción de servicio..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '0.65rem 1rem 0.65rem 2.6rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.875rem', fontWeight: 600 }}
          />
        </div>

        {/* Category Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Filter size={16} style={{ color: '#64748b' }} />
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}>Categoría:</span>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            style={{ padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 700, fontSize: '0.85rem' }}
          >
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Status Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}>Estado:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 700, fontSize: '0.85rem' }}
          >
            <option value="Todos">Todos los Estados</option>
            <option value="Activos">🟢 Solo Activos</option>
            <option value="Inactivos">🔴 Solo Inactivos</option>
          </select>
        </div>
      </div>

      {/* SERVICES TABLE */}
      <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
            Cargando catálogo de servicios...
          </div>
        ) : filteredServices.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
            No se encontraron servicios registrados con los filtros aplicados.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 800 }}>
                <th style={{ padding: '1rem' }}>Orden</th>
                <th style={{ padding: '1rem' }}>Servicio / Ítem</th>
                <th style={{ padding: '1rem' }}>Categoría</th>
                <th style={{ padding: '1rem' }}>Precio Base</th>
                <th style={{ padding: '1rem' }}>Comisión</th>
                <th style={{ padding: '1rem' }}>ITBIS</th>
                <th style={{ padding: '1rem' }}>Estado</th>
                <th style={{ padding: '1rem', textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredServices.map((service, index) => (
                <tr key={service.id} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s' }} className="hover:bg-slate-50">
                  <td style={{ padding: '1rem', fontWeight: 800, color: '#94a3b8' }}>
                    #{service.orden_visualizacion || index + 1}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <strong style={{ fontSize: '0.925rem', color: '#0f172a', display: 'block' }}>{service.nombre}</strong>
                    {service.descripcion && (
                      <span style={{ fontSize: '0.78rem', color: '#64748b' }}>{service.descripcion}</span>
                    )}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <span style={{ background: '#f1f5f9', color: '#334155', padding: '4px 10px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 800 }}>
                      <Tag size={12} style={{ display: 'inline', marginRight: '4px' }} />
                      {service.categoria || 'General'}
                    </span>
                  </td>
                  <td style={{ padding: '1rem', fontWeight: 900, color: '#166534', fontSize: '0.95rem' }}>
                    RD$ {Number(service.precio).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    {service.genera_comision ? (
                      <span style={{ color: '#0369a1', fontWeight: 700, fontSize: '0.8rem' }}>
                        {service.tipo_comision === 'Porcentaje' ? `${service.comision_valor}%` : `RD$ ${service.comision_valor}`}
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>Sin comisión</span>
                    )}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    {service.aplica_itbis ? (
                      <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 6px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 800 }}>
                        ITBIS 18%
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Exento</span>
                    )}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <button
                      onClick={() => handleToggleStatus(service)}
                      style={{
                        background: service.activo === 1 ? '#dcfce7' : '#fef2f2',
                        color: service.activo === 1 ? '#15803d' : '#dc2626',
                        border: `1px solid ${service.activo === 1 ? '#86efac' : '#fca5a5'}`,
                        padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 800,
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem'
                      }}
                    >
                      {service.activo === 1 ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                      <span>{service.activo === 1 ? 'ACTIVO' : 'INACTIVO'}</span>
                    </button>
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => handleOpenEditModal(service)}
                        style={{ background: '#f1f5f9', border: 'none', padding: '0.4rem 0.6rem', borderRadius: '8px', cursor: 'pointer', color: '#3b82f6' }}
                        title="Editar Servicio"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteService(service)}
                        style={{ background: '#fef2f2', border: 'none', padding: '0.4rem 0.6rem', borderRadius: '8px', cursor: 'pointer', color: '#dc2626' }}
                        title="Eliminar o Desactivar Servicio"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* MODAL CREAR / EDITAR SERVICIO */}
      {showModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: '560px', borderRadius: '20px', padding: '1.75rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>
                {editingService ? '✏️ Editar Ítem de Servicio' : '✨ Agregar Nuevo Servicio al Catálogo'}
              </h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' }}>
                <XCircle size={22} />
              </button>
            </div>

            <form onSubmit={handleSaveService}>
              
              {/* Nombre */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>
                  Nombre del Servicio *:
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Lavado y Secado Especial, Tinte Balayage..."
                  value={formData.nombre}
                  onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 700, fontSize: '0.9rem' }}
                />
              </div>

              {/* Categoría & Precio */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>
                    Categoría:
                  </label>
                  <select
                    value={formData.categoria}
                    onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                  >
                    {categories.filter(c => c !== 'Todas').map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>
                    Precio Base (RD$) *:
                  </label>
                  <input
                    type="number"
                    required
                    step="0.01"
                    placeholder="0.00"
                    value={formData.precio}
                    onChange={(e) => setFormData({ ...formData, precio: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 800, fontSize: '1rem' }}
                  />
                </div>
              </div>

              {/* Descripción */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
                  Descripción u Observaciones:
                </label>
                <textarea
                  rows={2}
                  placeholder="Detalles sobre lo que incluye el servicio..."
                  value={formData.descripcion}
                  onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
                  style={{ width: '100%', padding: '0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 600, fontSize: '0.85rem' }}
                />
              </div>

              {/* Comisiones */}
              <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 800, color: '#0f172a' }}>
                    ¿Genera Comisión al Empleado?
                  </label>
                  <input
                    type="checkbox"
                    checked={formData.genera_comision === 1}
                    onChange={(e) => setFormData({ ...formData, genera_comision: e.target.checked ? 1 : 0 })}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                </div>

                {formData.genera_comision === 1 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.2rem' }}>
                        Tipo de Comisión:
                      </label>
                      <select
                        value={formData.tipo_comision}
                        onChange={(e) => setFormData({ ...formData, tipo_comision: e.target.value })}
                        style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 700, fontSize: '0.8rem' }}
                      >
                        <option value="Porcentaje">Porcentaje (%)</option>
                        <option value="Monto_Fijo">Monto Fijo (RD$)</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.2rem' }}>
                        Valor de Comisión:
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="15"
                        value={formData.comision_valor}
                        onChange={(e) => setFormData({ ...formData, comision_valor: e.target.value })}
                        style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 800, fontSize: '0.85rem' }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Impuesto ITBIS & Estado */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    id="itbis"
                    checked={formData.aplica_itbis === 1}
                    onChange={(e) => setFormData({ ...formData, aplica_itbis: e.target.checked ? 1 : 0 })}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  <label htmlFor="itbis" style={{ fontSize: '0.8rem', fontWeight: 800, color: '#334155', cursor: 'pointer' }}>
                    Aplica ITBIS (18%)
                  </label>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    id="activo"
                    checked={formData.activo === 1}
                    onChange={(e) => setFormData({ ...formData, activo: e.target.checked ? 1 : 0 })}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  <label htmlFor="activo" style={{ fontSize: '0.8rem', fontWeight: 800, color: '#334155', cursor: 'pointer' }}>
                    Servicio Activo en POS
                  </label>
                </div>
              </div>

              {/* Orden de visualización */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
                  Orden de Visualización:
                </label>
                <input
                  type="number"
                  placeholder="0"
                  value={formData.orden_visualizacion}
                  onChange={(e) => setFormData({ ...formData, orden_visualizacion: e.target.value })}
                  style={{ width: '100%', padding: '0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                />
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{ flex: 1, padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', background: '#ffffff', fontWeight: 700, cursor: 'pointer', color: '#475569' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  style={{ flex: 1, padding: '0.75rem', borderRadius: '10px', border: 'none', background: '#be185d', color: '#ffffff', fontWeight: 800, cursor: 'pointer' }}
                >
                  {editingService ? '💾 Guardar Cambios' : '✨ Crear Servicio'}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default ServiceManagement;
