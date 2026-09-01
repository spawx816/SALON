import React, { useState, useEffect } from 'react';
import { 
  Sparkles, Plus, Search, Edit3, Trash2, Power, CheckCircle2, XCircle, 
  Tag, DollarSign, Percent, ShieldCheck, ArrowUpDown, Filter, AlertCircle,
  FileSpreadsheet, Upload, Download, FileText, ShoppingBag, Scissors, Package, X, Save, Check, User
} from 'lucide-react';
import { dataService } from '../../utils/dataService';

const ServiceManagement = () => {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [statusFilter, setStatusFilter] = useState('Todos');

  // Modal States for Single Item
  const [showModal, setShowModal] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [formData, setFormData] = useState({
    nombre: '',
    descripcion: '',
    categoria: 'Peluquería',
    precio: '',
    tipo_item: 'Servicio',
    activo: 1,
    genera_comision: 1,
    tipo_comision: 'Porcentaje',
    comision_valor: '15',
    aplica_itbis: 0,
    orden_visualizacion: '0',
    imagen_url: ''
  });

  // Modal States for Bulk Import (Carga Masiva)
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [parsedItems, setParsedItems] = useState([]);
  const [bulkLoading, setBulkLoading] = useState(false);

  const [categoriesList, setCategoriesList] = useState(['Peluquería', 'Coloración', 'Tratamientos', 'Uñas', 'Estética', 'Productos', 'General']);

  useEffect(() => {
    loadServices();
  }, []);

  const loadServices = async () => {
    setLoading(true);
    try {
      const [data, commCats] = await Promise.all([
        dataService.getServices(),
        dataService.getCommissionCategories().catch(() => [])
      ]);
      setServices(data || []);

      const commCatNames = Array.isArray(commCats) ? commCats.map(c => c.nombre).filter(Boolean) : [];
      const serviceCatNames = Array.isArray(data) ? data.map(s => s.categoria).filter(Boolean) : [];
      const defaultCats = ['Peluquería', 'Coloración', 'Tratamientos', 'Uñas', 'Estética', 'Productos', 'General'];

      const combined = Array.from(new Set([...commCatNames, ...serviceCatNames, ...defaultCats])).filter(Boolean);
      setCategoriesList(combined);
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
      categoria: categoriesList[0] || 'Peluquería',
      precio: '',
      tipo_item: 'Servicio',
      activo: 1,
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
      categoria: service.categoria || 'Peluquería',
      precio: service.precio || '',
      tipo_item: service.tipo_item || (service.categoria === 'Productos' ? 'Producto' : 'Servicio'),
      activo: service.activo !== undefined ? service.activo : 1,
      genera_comision: service.genera_comision !== undefined ? service.genera_comision : 1,
      tipo_comision: service.tipo_comision || 'Porcentaje',
      comision_valor: service.comision_valor !== undefined ? service.comision_valor : '15',
      aplica_itbis: service.aplica_itbis !== undefined ? service.aplica_itbis : 0,
      orden_visualizacion: service.orden_visualizacion || '0',
      imagen_url: service.imagen_url || ''
    });
    setShowModal(true);
  };

  const handleSaveService = async (e) => {
    e.preventDefault();
    if (!formData.nombre.trim()) {
      alert('El nombre del servicio es obligatorio.');
      return;
    }
    if (isNaN(parseFloat(formData.precio)) || parseFloat(formData.precio) < 0) {
      alert('Por favor ingresa un precio válido.');
      return;
    }

    setLoading(true);
    try {
      if (editingService) {
        await dataService.updateService(editingService.id, formData);
        alert('✅ Servicio actualizado exitosamente.');
      } else {
        await dataService.createService(formData);
        alert('✅ Nuevo servicio registrado exitosamente.');
      }
      setShowModal(false);
      await loadServices();
    } catch (e) {
      alert('Error guardando servicio: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (id) => {
    try {
      const res = await dataService.toggleServiceStatus(id);
      await loadServices();
    } catch (e) {
      alert('Error cambiando estado del servicio: ' + e.message);
    }
  };

  const handleDeleteService = async (id) => {
    if (!window.confirm('¿Estás seguro de que deseas eliminar este servicio? Si ha sido facturado anteriormente, se desactivará en su lugar para proteger el histórico.')) {
      return;
    }
    try {
      const res = await dataService.deleteService(id);
      alert(res.message || 'Operación completada exitosamente.');
      await loadServices();
    } catch (e) {
      alert('Error eliminando servicio: ' + e.message);
    }
  };

  // --- CARGA MASIVA (BULK IMPORT LOGIC) ---
  const handleParseBulkText = (text) => {
    setBulkText(text);
    if (!text.trim()) {
      setParsedItems([]);
      return;
    }

    const lines = text.split('\n').filter(l => l.trim() !== '');
    const items = [];

    lines.forEach((line, index) => {
      // Ignore header line if present
      if (index === 0 && (line.toLowerCase().includes('nombre') || line.toLowerCase().includes('precio'))) {
        return;
      }

      // Split by comma, semicolon, or tab
      let cols = [];
      if (line.includes('\t')) cols = line.split('\t');
      else if (line.includes(';')) cols = line.split(';');
      else cols = line.split(',');

      if (cols.length >= 2) {
        const nombre = cols[0].trim();
        const categoria = cols[1] ? cols[1].trim() : 'General';
        const precio = parseFloat(cols[2]) || 0;
        const comision = cols[3] ? parseFloat(cols[3]) : 15;
        const aplicaItbis = cols[4] ? (cols[4].trim() === '1' || cols[4].toLowerCase().includes('si') ? 1 : 0) : 0;

        if (nombre) {
          items.push({
            nombre,
            categoria,
            precio,
            comision_valor: comision,
            tipo_comision: 'Porcentaje',
            aplica_itbis: aplicaItbis,
            genera_comision: 1,
            activo: 1
          });
        }
      }
    });

    setParsedItems(items);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target.result;
      handleParseBulkText(content);
    };
    reader.readAsText(file);
  };

  const handleLoadSampleBulkData = () => {
    const sample = `Nombre,Categoría,Precio,Comisión %,Aplica ITBIS
Corte de Dama Profesional,Peluquería,1200,15,0
Secado con Estilizado Avanzado,Peluquería,750,15,0
Manicura Rusa Spa,Uñas,850,20,0
Pedicura Spa Rejuvenecedora,Uñas,1150,20,0
Tinte Balayage Completo,Coloración,3800,18,0
Tratamiento de Botulinica Capilar,Tratamientos,2500,15,0
Depilación Facial Completa,Estética,600,20,0`;
    handleParseBulkText(sample);
  };

  const handleExecuteBulkImport = async () => {
    if (parsedItems.length === 0) {
      alert('Por favor agrega al menos un ítem válido para importar.');
      return;
    }

    setBulkLoading(true);
    try {
      const res = await dataService.bulkImportServices(parsedItems);
      alert(`🎉 ${res.message || 'Carga masiva completada exitosamente.'}`);
      setShowBulkModal(false);
      setBulkText('');
      setParsedItems([]);
      await loadServices();
    } catch (err) {
      alert('Error ejecutando carga masiva: ' + err.message);
    } finally {
      setBulkLoading(false);
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

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={() => setShowBulkModal(true)}
            style={{
              background: '#334155', color: '#ffffff', border: '1px solid #475569', padding: '0.75rem 1.25rem',
              borderRadius: '12px', fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '0.5rem'
            }}
            className="hover-lift"
          >
            <FileSpreadsheet size={18} style={{ color: '#38bdf8' }} />
            <span>📥 Carga Masiva (Excel / CSV)</span>
          </button>

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
      </div>

      {/* HISTORICAL INTEGRITY AUDIT BANNER */}
      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '14px', padding: '0.875rem 1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <ShieldCheck size={22} style={{ color: '#2563eb', flexShrink: 0 }} />
        <div style={{ fontSize: '0.82rem', color: '#1e40af', lineHeight: 1.4 }}>
          <strong>Protección de Datos Históricos Garantizada:</strong> Los cambios de precios realizados en esta sección aplican únicamente para nuevas facturas. Las facturas anteriores conservan su precio histórico sin alteración alguna.
        </div>
      </div>

      {/* FILTERS TOOLBAR */}
      <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '16px', border: '1px solid #e2e8f0', marginBottom: '1.5rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
        
        {/* Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: '260px', background: '#f8fafc', padding: '0.5rem 0.875rem', borderRadius: '10px', border: '1px solid #cbd5e1' }}>
          <Search size={18} style={{ color: '#64748b' }} />
          <input
            type="text"
            placeholder="Buscar por nombre o descripción de servicio..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: '0.85rem', fontWeight: 600 }}
          />
        </div>

        {/* Category Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Tag size={16} style={{ color: '#64748b' }} />
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}>Categoría:</span>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            style={{ padding: '0.55rem 0.875rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.8rem', fontWeight: 700, background: '#ffffff' }}
          >
            <option value="Todas">Todas</option>
            {categoriesList.map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        </div>

        {/* Status Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Filter size={16} style={{ color: '#64748b' }} />
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}>Estado:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: '0.55rem 0.875rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.8rem', fontWeight: 700, background: '#ffffff' }}
          >
            <option value="Todos">Todos ({services.length})</option>
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
            No se encontraron servicios que coincidan con la búsqueda.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 800 }}>
                <th style={{ padding: '0.875rem 1rem' }}>Servicio</th>
                <th style={{ padding: '0.875rem 1rem' }}>Categoría</th>
                <th style={{ padding: '0.875rem 1rem', textAlign: 'right' }}>Precio Base</th>
                <th style={{ padding: '0.875rem 1rem', textAlign: 'center' }}>ITBIS</th>
                <th style={{ padding: '0.875rem 1rem', textAlign: 'center' }}>Estado</th>
                <th style={{ padding: '0.875rem 1rem', textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredServices.map(s => (
                <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9', opacity: s.activo === 1 ? 1 : 0.65 }}>
                  
                  {/* Service Info */}
                  <td style={{ padding: '0.875rem 1rem' }}>
                    <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.9rem' }}>{s.nombre}</div>
                    {s.descripcion && <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>{s.descripcion}</div>}
                  </td>

                  {/* Category Badge */}
                  <td style={{ padding: '0.875rem 1rem' }}>
                    <span style={{ background: '#f1f5f9', color: '#475569', padding: '3px 10px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 700 }}>
                      {s.categoria}
                    </span>
                  </td>

                  {/* Price */}
                  <td style={{ padding: '0.875rem 1rem', textAlign: 'right', fontWeight: 900, color: '#0f172a', fontSize: '0.95rem' }}>
                    RD$ {Number(s.precio).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                  </td>



                  {/* ITBIS */}
                  <td style={{ padding: '0.875rem 1rem', textAlign: 'center' }}>
                    {s.aplica_itbis === 1 ? (
                      <span style={{ background: '#f0fdf4', color: '#166534', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 800 }}>
                        18% ITBIS
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Exento</span>
                    )}
                  </td>

                  {/* Status Toggle */}
                  <td style={{ padding: '0.875rem 1rem', textAlign: 'center' }}>
                    <button
                      onClick={() => handleToggleStatus(s.id)}
                      style={{
                        background: s.activo === 1 ? '#dcfce7' : '#fee2e2',
                        color: s.activo === 1 ? '#15803d' : '#b91c1c',
                        border: `1px solid ${s.activo === 1 ? '#86efac' : '#fca5a5'}`,
                        padding: '4px 10px',
                        borderRadius: '20px',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem'
                      }}
                    >
                      {s.activo === 1 ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                      <span>{s.activo === 1 ? 'ACTIVO' : 'INACTIVO'}</span>
                    </button>
                  </td>

                  {/* Actions */}
                  <td style={{ padding: '0.875rem 1rem', textAlign: 'center' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem' }}>
                      <button
                        onClick={() => handleOpenEditModal(s)}
                        title="Editar Servicio"
                        style={{ background: '#f1f5f9', color: '#334155', border: 'none', borderRadius: '8px', padding: '0.4rem 0.6rem', cursor: 'pointer' }}
                      >
                        <Edit3 size={15} />
                      </button>
                      <button
                        onClick={() => handleDeleteService(s.id)}
                        title="Eliminar o Desactivar"
                        style={{ background: '#fef2f2', color: '#ef4444', border: 'none', borderRadius: '8px', padding: '0.4rem 0.6rem', cursor: 'pointer' }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>

                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* SINGLE ITEM CREATE / EDIT MODAL - MODERN DESIGN (MATCHING MOCKUP) */}
      {showModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1100, padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff', width: '100%', maxWidth: '520px',
            borderRadius: '24px', padding: '2rem',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
            maxHeight: '92vh', overflowY: 'auto', position: 'relative'
          }}>
            
            {/* CLOSE BUTTON */}
            <button
              type="button"
              onClick={() => setShowModal(false)}
              style={{
                position: 'absolute', top: '1.25rem', right: '1.25rem',
                border: 'none', background: '#f4f4f5', color: '#71717a',
                width: '32px', height: '32px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', transition: 'all 0.2s'
              }}
            >
              <X size={18} />
            </button>

            {/* MODAL HEADER */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{
                background: '#f3e8ff', color: '#9333ea', width: '52px', height: '52px',
                borderRadius: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0
              }}>
                <ShoppingBag size={26} />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.3px' }}>
                  {editingService ? 'Editar Ítem' : 'Agregar Nuevo Ítem'}
                </h2>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                  Crea un nuevo servicio o producto para tu catálogo.
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveService}>
              
              {/* NOMBRE DEL ÍTEM */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 800, color: '#1e293b', marginBottom: '0.35rem' }}>
                  Nombre del Ítem <span style={{ color: '#ec4899' }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Corte de Dama Profesional"
                  value={formData.nombre}
                  onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                  style={{
                    width: '100%', padding: '0.75rem 1rem', borderRadius: '12px',
                    border: '1px solid #e4e4e7', fontSize: '0.9rem', fontWeight: 600,
                    color: '#0f172a', background: '#fafafa', outline: 'none'
                  }}
                />
              </div>

              {/* CATEGORÍA Y PRECIO */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 800, color: '#1e293b', marginBottom: '0.35rem' }}>
                    Categoría <span style={{ color: '#ec4899' }}>*</span>
                  </label>
                  <select
                    value={formData.categoria}
                    onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
                    style={{
                      width: '100%', padding: '0.75rem 1rem', borderRadius: '12px',
                      border: '1px solid #e4e4e7', fontSize: '0.88rem', fontWeight: 700,
                      color: '#0f172a', background: '#fafafa', outline: 'none', cursor: 'pointer'
                    }}
                  >
                    {categoriesList.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 800, color: '#1e293b', marginBottom: '0.35rem' }}>
                    Precio <span style={{ color: '#ec4899' }}>*</span>
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #e4e4e7', borderRadius: '12px', background: '#fafafa', overflow: 'hidden' }}>
                    <span style={{ padding: '0.75rem 0.85rem', background: '#f4f4f5', color: '#71717a', fontSize: '0.85rem', fontWeight: 800, borderRight: '1px solid #e4e4e7' }}>
                      RD$
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      required
                      placeholder="0.00"
                      value={formData.precio}
                      onChange={(e) => setFormData({ ...formData, precio: e.target.value })}
                      style={{
                        width: '100%', padding: '0.75rem', border: 'none', background: 'transparent',
                        fontSize: '0.9rem', fontWeight: 800, color: '#0f172a', outline: 'none'
                      }}
                    />
                  </div>
                  <span style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.25rem', display: 'block' }}>
                    Precio base del ítem
                  </span>
                </div>
              </div>

              {/* TIPO DE ÍTEM (RADIO CARDS) */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 800, color: '#1e293b', marginBottom: '0.5rem' }}>
                  Tipo de Ítem <span style={{ color: '#ec4899' }}>*</span>
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                  
                  {/* CARD 1: SERVICIO */}
                  <div
                    onClick={() => setFormData({ ...formData, tipo_item: 'Servicio' })}
                    style={{
                      border: formData.tipo_item === 'Servicio' ? '2px solid #d946ef' : '1px solid #e4e4e7',
                      background: formData.tipo_item === 'Servicio' ? '#fdf4ff' : '#ffffff',
                      borderRadius: '16px', padding: '1rem 0.85rem', textAlign: 'center',
                      cursor: 'pointer', transition: 'all 0.2s', position: 'relative'
                    }}
                  >
                    <div style={{
                      position: 'absolute', top: '0.75rem', right: '0.75rem',
                      width: '18px', height: '18px', borderRadius: '50%',
                      border: formData.tipo_item === 'Servicio' ? '5px solid #d946ef' : '2px solid #cbd5e1',
                      background: '#ffffff'
                    }}></div>

                    <div style={{
                      width: '42px', height: '42px', borderRadius: '50%',
                      background: '#fbcfe8', color: '#be185d', margin: '0 auto 0.6rem',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      <Scissors size={20} />
                    </div>
                    <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#d946ef', marginBottom: '0.2rem' }}>
                      Servicio
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#71717a', lineHeight: '1.25' }}>
                      Mano de obra o procedimiento realizado
                    </div>
                  </div>

                  {/* CARD 2: PRODUCTO */}
                  <div
                    onClick={() => setFormData({ ...formData, tipo_item: 'Producto', categoria: 'Productos' })}
                    style={{
                      border: formData.tipo_item === 'Producto' ? '2px solid #d946ef' : '1px solid #e4e4e7',
                      background: formData.tipo_item === 'Producto' ? '#fdf4ff' : '#ffffff',
                      borderRadius: '16px', padding: '1rem 0.85rem', textAlign: 'center',
                      cursor: 'pointer', transition: 'all 0.2s', position: 'relative'
                    }}
                  >
                    <div style={{
                      position: 'absolute', top: '0.75rem', right: '0.75rem',
                      width: '18px', height: '18px', borderRadius: '50%',
                      border: formData.tipo_item === 'Producto' ? '5px solid #d946ef' : '2px solid #cbd5e1',
                      background: '#ffffff'
                    }}></div>

                    <div style={{
                      width: '42px', height: '42px', borderRadius: '50%',
                      background: '#f3e8ff', color: '#9333ea', margin: '0 auto 0.6rem',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      <Package size={20} />
                    </div>
                    <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#9333ea', marginBottom: '0.2rem' }}>
                      Producto
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#71717a', lineHeight: '1.25' }}>
                      Artículo o producto físico para la venta
                    </div>
                  </div>

                </div>
              </div>

              {/* ITBIS (18%) CARD SECTION */}
              <div style={{
                background: 'linear-gradient(135deg, #fdf4ff 0%, #faf5ff 100%)',
                border: '1px solid #f0abfc', borderRadius: '18px',
                padding: '1.1rem 1.25rem', marginBottom: '1.25rem', position: 'relative', overflow: 'hidden'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
                  <div style={{ background: '#c084fc', color: '#ffffff', padding: '4px 7px', borderRadius: '7px', fontSize: '0.75rem', fontWeight: 900 }}>
                    %
                  </div>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#0f172a' }}>
                    ITBIS (18%)
                  </h3>
                </div>

                <p style={{ margin: '0 0 0.85rem', fontSize: '0.78rem', color: '#64748b' }}>
                  Indica si este ítem está sujeto al impuesto ITBIS.
                </p>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={formData.aplica_itbis === 1}
                    onChange={(e) => setFormData({ ...formData, aplica_itbis: e.target.checked ? 1 : 0 })}
                    style={{ width: '18px', height: '18px', accentColor: '#c084fc', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#1e293b' }}>
                    Aplicar ITBIS (18%) a este ítem
                  </span>
                </label>
                <span style={{ fontSize: '0.73rem', color: '#64748b', display: 'block', marginLeft: '1.75rem', marginTop: '0.15rem' }}>
                  Este ítem tendrá el impuesto ITBIS del 18% en la facturación.
                </span>
              </div>



              {/* FOOTER ACTION BUTTONS */}
              <div style={{ display: 'flex', gap: '1rem', paddingTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{
                    flex: 1, padding: '0.85rem', borderRadius: '14px',
                    border: '1px solid #e4e4e7', background: '#ffffff',
                    fontWeight: 800, fontSize: '0.9rem', cursor: 'pointer', color: '#3f3f46'
                  }}
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    flex: 1.3, padding: '0.85rem', borderRadius: '14px',
                    border: 'none', background: 'linear-gradient(135deg, #a855f7 0%, #d946ef 50%, #ec4899 100%)',
                    color: '#ffffff', fontWeight: 800, fontSize: '0.9rem',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                    boxShadow: '0 4px 15px rgba(217,70,239,0.35)'
                  }}
                >
                  <Save size={18} />
                  <span>{editingService ? 'Guardar Cambios' : 'Guardar Ítem'}</span>
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* CARGA MASIVA (BULK IMPORT) MODAL */}
      {showBulkModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: '750px', borderRadius: '20px', padding: '1.75rem', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <FileSpreadsheet size={24} style={{ color: '#0284c7' }} />
                <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: '#0f172a' }}>
                  Carga Masiva de Ítems y Servicios
                </h2>
              </div>
              <button onClick={() => setShowBulkModal(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                <XCircle size={20} />
              </button>
            </div>

            <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '12px', padding: '0.875rem 1rem', marginBottom: '1.25rem', fontSize: '0.8rem', color: '#0369a1', lineHeight: 1.4 }}>
              <strong>💡 Formato Admitido:</strong> Puedes copiar y pegar directamente desde <strong>Excel</strong> o pegar contenido CSV con el formato: <br />
              <code>Nombre, Categoría, Precio, % Comisión, Aplica ITBIS</code>
            </div>

            {/* ACTION TOOLBAR INSIDE BULK MODAL */}
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
              <label style={{ flex: 1, background: '#f1f5f9', border: '1px dashed #cbd5e1', padding: '0.6rem 1rem', borderRadius: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '0.8rem', fontWeight: 700, color: '#334155' }}>
                <Upload size={16} />
                <span>Subir Archivo (.csv / .txt)</span>
                <input type="file" accept=".csv,.txt,.json" onChange={handleFileUpload} style={{ display: 'none' }} />
              </label>

              <button
                type="button"
                onClick={handleLoadSampleBulkData}
                style={{ background: '#fdf2f8', border: '1px solid #fbcfe8', color: '#be185d', padding: '0.6rem 1rem', borderRadius: '10px', fontSize: '0.8rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <FileText size={16} />
                <span>Cargar Datos de Ejemplo</span>
              </button>
            </div>

            {/* TEXTAREA FOR DIRECT PASTE */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#334155', marginBottom: '0.35rem' }}>
                Pega tus datos estructurados aquí:
              </label>
              <textarea
                rows={6}
                placeholder="Nombre, Categoría, Precio, Comisión %, Aplica ITBIS&#10;Corte de Dama, Peluquería, 1200, 15, 0&#10;Secado Avanzado, Peluquería, 750, 15, 0"
                value={bulkText}
                onChange={(e) => handleParseBulkText(e.target.value)}
                style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 600 }}
              />
            </div>

            {/* PREVIEW TABLE OF PARSED ITEMS */}
            {parsedItems.length > 0 && (
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#166534' }}>
                    ✅ {parsedItems.length} Ítems válidos reconocidos para importar:
                  </span>
                </div>

                <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                    <thead style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                      <tr style={{ color: '#475569', fontWeight: 800 }}>
                        <th style={{ padding: '6px 10px' }}>Nombre</th>
                        <th style={{ padding: '6px 10px' }}>Categoría</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right' }}>Precio</th>
                        <th style={{ padding: '6px 10px', textAlign: 'center' }}>Comisión %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedItems.map((item, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '6px 10px', fontWeight: 700, color: '#0f172a' }}>{item.nombre}</td>
                          <td style={{ padding: '6px 10px', color: '#64748b' }}>{item.categoria}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 800 }}>RD$ {item.precio}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'center', color: '#be185d', fontWeight: 700 }}>{item.comision_valor}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* MODAL ACTION BUTTONS */}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setShowBulkModal(false)}
                style={{ flex: 1, padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', background: '#ffffff', fontWeight: 700, cursor: 'pointer', color: '#475569' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExecuteBulkImport}
                disabled={bulkLoading || parsedItems.length === 0}
                style={{ flex: 1.5, padding: '0.75rem', borderRadius: '10px', border: 'none', background: '#0284c7', color: '#ffffff', fontWeight: 800, cursor: 'pointer' }}
              >
                {bulkLoading ? 'Importando...' : `🚀 Confirmar e Importar ${parsedItems.length} Ítems`}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

export default ServiceManagement;
