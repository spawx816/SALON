import React, { useState, useEffect } from 'react';
import { 
  Percent, DollarSign, Calendar, User, Filter, CheckCircle2, Clock, 
  Search, ShieldCheck, Plus, FileText, Tag, Sparkles, Layers,
  Trash2, Edit2, Info, ArrowRight, MapPin, ChevronDown, Check, X
} from 'lucide-react';
import { dataService } from '../../utils/dataService';

const CommissionManagement = () => {
  const [activeTab, setActiveTab] = useState('esquemas'); // 'esquemas' | 'registro'

  // Categories, Schemes, Services & Rules Data
  const [categories, setCategories] = useState([]);
  const [schemes, setSchemes] = useState([]);
  const [allServices, setAllServices] = useState([]);
  const [selectedSchemeId, setSelectedSchemeId] = useState(null);
  const [schemeRules, setSchemeRules] = useState([]);

  // Commissions Log & Metrics
  const [commissions, setCommissions] = useState([]);
  const [metrics, setMetrics] = useState({ totalGenerado: 0, count: 0 });
  const [employees, setEmployees] = useState([]);
  const [salons, setSalons] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters for Registro tab
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [serviceSearch, setServiceSearch] = useState('');

  // Modals
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryForm, setCategoryForm] = useState({ nombre: '', porcentaje: '', tipo: 'Porcentaje', estado: 'Activa' });

  const [showSchemeModal, setShowSchemeModal] = useState(false);
  const [editingScheme, setEditingScheme] = useState(null);
  const [schemeForm, setSchemeForm] = useState({ nombre: '', descripcion: '', tipo: 'Por Categorías', estado: 'Activo' });

  const [showRuleModal, setShowRuleModal] = useState(false);
  const [ruleForm, setRuleForm] = useState({
    rule_type: 'servicio', // 'servicio' | 'categoria'
    category_name: '',
    service_name: '',
    service_id: '',
    tipo_calculo: 'Porcentaje', // 'Porcentaje' | 'Monto_Fijo'
    valor: '',
    prioridad: 1
  });

  useEffect(() => {
    loadAllData();
  }, []);

  useEffect(() => {
    if (activeTab === 'registro') {
      loadCommissions();
    }
  }, [activeTab, startDate, endDate, selectedEmployee, selectedLocation, serviceSearch]);

  useEffect(() => {
    if (selectedSchemeId) {
      loadSchemeRules(selectedSchemeId);
    }
  }, [selectedSchemeId]);

  const loadAllData = async () => {
    setLoading(true);
    try {
      const [cats, schs, emps, sals, servs] = await Promise.all([
        dataService.getCommissionCategories(),
        dataService.getCommissionSchemes(),
        dataService.getEmployees(),
        dataService.getSalons(),
        dataService.getServices().catch(() => [])
      ]);
      setCategories(cats || []);
      setSchemes(schs || []);
      setEmployees(emps || []);
      setSalons(sals || []);
      setAllServices(Array.isArray(servs) ? servs : []);

      if (schs && schs.length > 0 && !selectedSchemeId) {
        setSelectedSchemeId(schs[0].id);
      }
    } catch (e) {
      console.error('Error cargando datos de comisiones:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadSchemeRules = async (schemeId) => {
    try {
      const rules = await dataService.getSchemeRules(schemeId);
      setSchemeRules(rules || []);
    } catch (e) {
      console.error('Error cargando reglas de esquema:', e);
    }
  };

  const loadCommissions = async () => {
    setLoading(true);
    try {
      const params = {};
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      if (selectedEmployee) params.employee_id = selectedEmployee;
      if (selectedLocation) params.localidad = selectedLocation;
      if (serviceSearch) params.service_name = serviceSearch;

      const res = await dataService.getCommissions(params);
      setCommissions(res.commissions || []);
      setMetrics(res.metrics || { totalGenerado: 0, count: 0 });
    } catch (e) {
      console.error('Error cargando comisiones:', e);
    } finally {
      setLoading(false);
    }
  };

  // --- HANDLERS: CATEGORÍAS ---
  const handleOpenCategoryModal = (cat = null) => {
    if (cat) {
      setEditingCategory(cat);
      setCategoryForm({ nombre: cat.nombre, porcentaje: cat.porcentaje, tipo: cat.tipo || 'Porcentaje', estado: cat.estado || 'Activa' });
    } else {
      setEditingCategory(null);
      setCategoryForm({ nombre: '', porcentaje: '', tipo: 'Porcentaje', estado: 'Activa' });
    }
    setShowCategoryModal(true);
  };

  const handleSaveCategory = async (e) => {
    e.preventDefault();
    if (!categoryForm.nombre) return alert('El nombre de la categoría es obligatorio');
    try {
      const payload = editingCategory ? { ...categoryForm, id: editingCategory.id } : categoryForm;
      await dataService.saveCommissionCategory(payload);
      setShowCategoryModal(false);
      loadAllData();
      alert('Categoría guardada exitosamente');
    } catch (err) {
      alert('Error guardando categoría: ' + err.message);
    }
  };

  const handleDeleteCategory = async (id) => {
    if (!window.confirm('¿Estás seguro de eliminar esta categoría de comisión?')) return;
    try {
      await dataService.deleteCommissionCategory(id);
      loadAllData();
    } catch (err) {
      alert('Error eliminando categoría');
    }
  };

  // --- HANDLERS: ESQUEMAS ---
  const handleOpenSchemeModal = (sch = null) => {
    if (sch) {
      setEditingScheme(sch);
      setSchemeForm({ nombre: sch.nombre, descripcion: sch.descripcion || '', tipo: sch.tipo || 'Por Categorías', estado: sch.estado || 'Activo' });
    } else {
      setEditingScheme(null);
      setSchemeForm({ nombre: '', descripcion: '', tipo: 'Por Categorías', estado: 'Activo' });
    }
    setShowSchemeModal(true);
  };

  const handleSaveScheme = async (e) => {
    e.preventDefault();
    if (!schemeForm.nombre) return alert('El nombre del esquema es obligatorio');
    try {
      const payload = editingScheme ? { ...schemeForm, id: editingScheme.id } : schemeForm;
      await dataService.saveCommissionScheme(payload);
      setShowSchemeModal(false);
      loadAllData();
      alert('Esquema guardado exitosamente');
    } catch (err) {
      alert('Error guardando esquema: ' + err.message);
    }
  };

  const handleDeleteScheme = async (id) => {
    if (!window.confirm('¿Estás seguro de eliminar este esquema y sus reglas asociadas?')) return;
    try {
      await dataService.deleteCommissionScheme(id);
      if (selectedSchemeId === id) setSelectedSchemeId(null);
      loadAllData();
    } catch (err) {
      alert('Error eliminando esquema');
    }
  };

  // --- HANDLERS: REGLAS DE ESQUEMA ---
  const handleOpenRuleModal = () => {
    if (!selectedSchemeId) return alert('Selecciona primero un esquema');
    const firstService = allServices[0];
    setRuleForm({
      rule_type: 'servicio',
      category_name: categories[0]?.nombre || '',
      service_name: firstService ? firstService.nombre : '',
      service_id: firstService ? firstService.id : '',
      tipo_calculo: 'Porcentaje',
      valor: '',
      prioridad: 1
    });
    setShowRuleModal(true);
  };

  const handleSaveRule = async (e) => {
    e.preventDefault();
    if (ruleForm.rule_type === 'categoria' && !ruleForm.category_name) {
      return alert('Selecciona una categoría para la regla.');
    }
    if (ruleForm.rule_type === 'servicio' && !ruleForm.service_name) {
      return alert('Ingresa el nombre del servicio para la excepción.');
    }
    const val = parseFloat(ruleForm.valor);
    if (isNaN(val) || val < 0) return alert('Ingresa un valor válido');

    try {
      await dataService.saveSchemeRule(selectedSchemeId, ruleForm);
      setShowRuleModal(false);
      loadSchemeRules(selectedSchemeId);
    } catch (err) {
      alert('Error guardando regla: ' + err.message);
    }
  };

  const handleDeleteRule = async (ruleId) => {
    if (!window.confirm('¿Deseas eliminar esta regla del esquema?')) return;
    try {
      await dataService.deleteSchemeRule(ruleId);
      loadSchemeRules(selectedSchemeId);
    } catch (err) {
      alert('Error eliminando regla');
    }
  };

  // Filter rules into Category Rules vs Service Exceptions
  const catRules = schemeRules.filter(r => r.rule_type === 'categoria');
  const serviceExceptions = schemeRules.filter(r => r.rule_type === 'servicio');
  const selectedSchemeObj = schemes.find(s => s.id === selectedSchemeId);

  // Unique employee count for metrics
  const uniqueEmpsCount = new Set(commissions.map(c => c.employee_id)).size;

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '1.5rem', fontFamily: 'Inter, system-ui, sans-serif' }}>
      
      {/* HEADER BANNER */}
      <div style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)', color: '#ffffff', padding: '1.75rem 2rem', borderRadius: '24px', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 12px 30px -10px rgba(15,23,42,0.4)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
            <div style={{ background: '#be185d', padding: '0.45rem', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Percent size={22} style={{ color: '#ffffff' }} />
            </div>
            <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.5px' }}>
              Comisiones
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: '0.88rem', color: '#94a3b8' }}>
            Configura categorías, esquemas y reglas para calcular las comisiones de tus colaboradores.
          </p>
        </div>

        {/* TOP TAB SWITCHER */}
        <div style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(10px)', padding: '5px', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.12)', display: 'flex', gap: '4px' }}>
          <button
            onClick={() => setActiveTab('esquemas')}
            style={{
              padding: '0.65rem 1.25rem',
              borderRadius: '10px',
              border: 'none',
              background: activeTab === 'esquemas' ? '#be185d' : 'transparent',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '0.85rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'all 0.2s ease'
            }}
          >
            <Layers size={16} />
            <span>Configuración de Esquemas</span>
          </button>

          <button
            onClick={() => setActiveTab('registro')}
            style={{
              padding: '0.65rem 1.25rem',
              borderRadius: '10px',
              border: 'none',
              background: activeTab === 'registro' ? '#be185d' : 'transparent',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '0.85rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'all 0.2s ease'
            }}
          >
            <FileText size={16} />
            <span>Registro de Comisiones Generadas</span>
          </button>
        </div>
      </div>

      {/* TAB 1: ESQUEMAS Y CATEGORÍAS (3 COLUMNAS / PASOS) */}
      {activeTab === 'esquemas' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr 1.3fr', gap: '1.25rem', marginBottom: '1.5rem' }}>

            {/* STEP 1: CATEGORÍAS DE COMISIÓN */}
            <div style={{ background: '#ffffff', borderRadius: '20px', border: '1px solid #e2e8f0', padding: '1.25rem', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ background: '#be185d', color: '#ffffff', width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 900 }}>1</span>
                  <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>Categorías de Comisión</h2>
                </div>
                <button
                  onClick={() => handleOpenCategoryModal()}
                  style={{ background: '#fdf2f8', border: '1px solid #fbcfe8', color: '#be185d', padding: '0.4rem 0.75rem', borderRadius: '9px', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Plus size={14} /> Gestionar Categorías
                </button>
              </div>

              <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0 0 1rem' }}>
                Define la base de pago de los servicios.
              </p>

              {/* Blue Alert Notice */}
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '0.75rem', marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
                <Info size={16} style={{ color: '#2563eb', flexShrink: 0, marginTop: '2px' }} />
                <span style={{ fontSize: '0.73rem', color: '#1e40af', lineHeight: '1.35' }}>
                  Las comisiones se calculan sobre el precio final del servicio. Si aplicas descuentos, la comisión se genera en base al precio con descuento.
                </span>
              </div>

              {/* CATEGORIES TABLE */}
              <div style={{ flex: 1, overflowX: 'auto', marginBottom: '1rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', color: '#64748b', textAlign: 'left', fontWeight: 800, borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Categoría de Comisión</th>
                      <th style={{ padding: '0.5rem 0.6rem', textAlign: 'center' }}>% Comisión</th>
                      <th style={{ padding: '0.5rem 0.6rem', textAlign: 'center' }}>Servicios Vinculados</th>
                      <th style={{ padding: '0.5rem 0.6rem', textAlign: 'center' }}>Estado</th>
                      <th style={{ padding: '0.5rem 0.4rem', textAlign: 'center' }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((cat) => (
                      <tr key={cat.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.55rem 0.6rem', fontWeight: 700, color: '#1e293b' }}>{cat.nombre}</td>
                        <td style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontWeight: 800, color: '#be185d' }}>
                          {cat.tipo === 'Porcentaje' ? `${cat.porcentaje}%` : `RD$ ${cat.porcentaje}`}
                        </td>
                        <td style={{ padding: '0.55rem 0.6rem', textAlign: 'center', fontWeight: 700, color: '#64748b' }}>
                          {cat.servicios_vinculados || 0}
                        </td>
                        <td style={{ padding: '0.55rem 0.6rem', textAlign: 'center' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: cat.estado === 'Activa' ? '#f0fdf4' : '#fef2f2', color: cat.estado === 'Activa' ? '#166534' : '#991b1b', padding: '2px 7px', borderRadius: '99px', fontSize: '0.68rem', fontWeight: 800 }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: cat.estado === 'Activa' ? '#22c55e' : '#ef4444' }}></span>
                            {cat.estado}
                          </span>
                        </td>
                        <td style={{ padding: '0.55rem 0.4rem', textAlign: 'center' }}>
                          <button onClick={() => handleOpenCategoryModal(cat)} style={{ border: 'none', background: 'transparent', color: '#64748b', cursor: 'pointer', padding: '2px' }}><Edit2 size={13} /></button>
                          <button onClick={() => handleDeleteCategory(cat.id)} style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer', padding: '2px' }}><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Bottom Info Box */}
              <div style={{ background: '#faf5ff', border: '1px solid #f3e8ff', borderRadius: '12px', padding: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#7e22ce', fontWeight: 800, fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                  <Sparkles size={14} /> ¿Cómo funciona?
                </div>
                <p style={{ margin: 0, fontSize: '0.72rem', color: '#6b21a8', lineHeight: '1.4' }}>
                  Cada servicio debe pertenecer a una categoría. El porcentaje definido en la categoría será la base para la comisión de todos los servicios que la utilicen.
                </p>
              </div>

            </div>

            {/* STEP 2: ESQUEMAS DE COMISIÓN */}
            <div style={{ background: '#ffffff', borderRadius: '20px', border: '1px solid #e2e8f0', padding: '1.25rem', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ background: '#be185d', color: '#ffffff', width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 900 }}>2</span>
                  <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>Esquemas de Comisión</h2>
                </div>
                <button
                  onClick={() => handleOpenSchemeModal()}
                  style={{ background: '#be185d', color: '#ffffff', border: 'none', padding: '0.45rem 0.85rem', borderRadius: '9px', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', boxShadow: '0 2px 6px rgba(190,24,93,0.3)' }}
                >
                  <Plus size={14} /> Crear Esquema
                </button>
              </div>

              <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0 0 1rem' }}>
                Crea y administra los diferentes esquemas de pago. Asigna un esquema a cada colaborador desde el módulo de RRHH.
              </p>

              {/* SCHEMES TABLE */}
              <div style={{ flex: 1, overflowX: 'auto', marginBottom: '1rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', color: '#64748b', textAlign: 'left', fontWeight: 800, borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Esquema</th>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Tipo</th>
                      <th style={{ padding: '0.5rem 0.6rem', textAlign: 'center' }}>Colaboradores Asignados</th>
                      <th style={{ padding: '0.5rem 0.6rem', textAlign: 'center' }}>Estado</th>
                      <th style={{ padding: '0.5rem 0.4rem', textAlign: 'center' }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schemes.map((s) => (
                      <tr 
                        key={s.id} 
                        onClick={() => setSelectedSchemeId(s.id)}
                        style={{ 
                          borderBottom: '1px solid #f1f5f9', 
                          background: selectedSchemeId === s.id ? '#fdf2f8' : 'transparent',
                          cursor: 'pointer',
                          transition: 'background 0.15s'
                        }}
                      >
                        <td style={{ padding: '0.6rem 0.6rem' }}>
                          <div style={{ fontWeight: 800, color: selectedSchemeId === s.id ? '#be185d' : '#0f172a' }}>{s.nombre}</div>
                          {s.descripcion && <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>{s.descripcion}</div>}
                        </td>
                        <td style={{ padding: '0.6rem 0.6rem' }}>
                          <span style={{ background: '#f1f5f9', color: '#475569', padding: '2px 7px', borderRadius: '6px', fontSize: '0.68rem', fontWeight: 800 }}>
                            {s.tipo}
                          </span>
                        </td>
                        <td style={{ padding: '0.6rem 0.6rem', textAlign: 'center', fontWeight: 800, color: '#334155' }}>
                          {s.colaboradores_asignados || 0}
                        </td>
                        <td style={{ padding: '0.6rem 0.6rem', textAlign: 'center' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: s.estado === 'Activo' ? '#f0fdf4' : '#fef2f2', color: s.estado === 'Activo' ? '#166534' : '#991b1b', padding: '2px 7px', borderRadius: '99px', fontSize: '0.68rem', fontWeight: 800 }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: s.estado === 'Activo' ? '#22c55e' : '#ef4444' }}></span>
                            {s.estado}
                          </span>
                        </td>
                        <td style={{ padding: '0.6rem 0.4rem', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => handleOpenSchemeModal(s)} style={{ border: 'none', background: 'transparent', color: '#64748b', cursor: 'pointer', padding: '2px' }}><Edit2 size={13} /></button>
                          <button onClick={() => handleDeleteScheme(s.id)} style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer', padding: '2px' }}><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Bottom Info Box */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.75rem' }}>
                <div style={{ fontWeight: 800, fontSize: '0.75rem', color: '#334155', marginBottom: '0.35rem' }}>
                  Tipos de esquema:
                </div>
                <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.71rem', color: '#64748b', lineHeight: '1.45' }}>
                  <li><strong>Por Categorías:</strong> Aplica un porcentaje o monto según la categoría del servicio.</li>
                  <li><strong>Personalizado:</strong> Permite reglas distintas por categoría y por servicio.</li>
                  <li><strong>Mixto:</strong> Combina categorías y servicios específicos con montos o porcentajes.</li>
                </ul>
              </div>

            </div>

            {/* STEP 3: REGLAS DEL ESQUEMA SELECCIONADO */}
            <div style={{ background: '#ffffff', borderRadius: '20px', border: '1px solid #e2e8f0', padding: '1.25rem', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ background: '#be185d', color: '#ffffff', width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 900 }}>3</span>
                  <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>Reglas del Esquema Seleccionado</h2>
                </div>
              </div>

              <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0 0 0.85rem' }}>
                Define las reglas que utilizará el esquema para calcular las comisiones.
              </p>

              {/* SCHEME SELECTOR DROPDOWN */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 800, color: '#64748b', marginBottom: '0.25rem' }}>
                  Esquema seleccionado:
                </label>
                <select
                  value={selectedSchemeId || ''}
                  onChange={(e) => setSelectedSchemeId(Number(e.target.value))}
                  style={{ width: '100%', padding: '0.55rem', borderRadius: '10px', border: '1px solid #be185d', background: '#fdf2f8', fontSize: '0.85rem', fontWeight: 800, color: '#be185d', cursor: 'pointer' }}
                >
                  {schemes.map(s => (
                    <option key={s.id} value={s.id}>{s.nombre} ({s.tipo})</option>
                  ))}
                </select>
              </div>

              {/* REGLAS POR CATEGORÍA */}
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.4rem' }}>
                  Reglas por Categoría
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', color: '#64748b', textAlign: 'left', fontWeight: 800, borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '0.4rem 0.5rem' }}>Categoría</th>
                      <th style={{ padding: '0.4rem 0.5rem' }}>Tipo</th>
                      <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>Valor</th>
                      <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>Prioridad</th>
                      <th style={{ padding: '0.4rem 0.4rem', textAlign: 'center' }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catRules.length === 0 ? (
                      <tr><td colSpan={5} style={{ padding: '0.75rem', textAlign: 'center', color: '#94a3b8' }}>Sin reglas por categoría configuradas.</td></tr>
                    ) : (
                      catRules.map(r => (
                        <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '0.45rem 0.5rem', fontWeight: 700, color: '#334155' }}>{r.category_name}</td>
                          <td style={{ padding: '0.45rem 0.5rem', color: '#64748b' }}>{r.tipo_calculo}</td>
                          <td style={{ padding: '0.45rem 0.5rem', textAlign: 'center', fontWeight: 800, color: '#be185d' }}>
                            {r.tipo_calculo === 'Porcentaje' ? `${r.valor}%` : `RD$ ${r.valor}`}
                          </td>
                          <td style={{ padding: '0.45rem 0.5rem', textAlign: 'center', fontWeight: 800 }}>{r.prioridad || 1}</td>
                          <td style={{ padding: '0.45rem 0.4rem', textAlign: 'center' }}>
                            <button onClick={() => handleDeleteRule(r.id)} style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={13} /></button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* EXCEPCIONES POR SERVICIO */}
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#991b1b', marginBottom: '0.4rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Excepciones por Servicio (Mayor prioridad)</span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', color: '#64748b', textAlign: 'left', fontWeight: 800, borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '0.4rem 0.5rem' }}>Servicio</th>
                      <th style={{ padding: '0.4rem 0.5rem' }}>Tipo</th>
                      <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>Valor</th>
                      <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>Prioridad</th>
                      <th style={{ padding: '0.4rem 0.4rem', textAlign: 'center' }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serviceExceptions.length === 0 ? (
                      <tr><td colSpan={5} style={{ padding: '0.75rem', textAlign: 'center', color: '#94a3b8' }}>Sin excepciones por servicio configuradas.</td></tr>
                    ) : (
                      serviceExceptions.map(r => (
                        <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '0.45rem 0.5rem', fontWeight: 800, color: '#be185d' }}>{r.service_name}</td>
                          <td style={{ padding: '0.45rem 0.5rem', color: '#64748b' }}>{r.tipo_calculo}</td>
                          <td style={{ padding: '0.45rem 0.5rem', textAlign: 'center', fontWeight: 800, color: '#166534' }}>
                            {r.tipo_calculo === 'Porcentaje' ? `${r.valor}%` : `RD$ ${r.valor}`}
                          </td>
                          <td style={{ padding: '0.45rem 0.5rem', textAlign: 'center', fontWeight: 800 }}>{r.prioridad || 1}</td>
                          <td style={{ padding: '0.45rem 0.4rem', textAlign: 'center' }}>
                            <button onClick={() => handleDeleteRule(r.id)} style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={13} /></button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Add Rule Button */}
              <button
                onClick={handleOpenRuleModal}
                style={{ background: '#fdf2f8', border: '1px solid #fbcfe8', color: '#be185d', padding: '0.55rem', borderRadius: '10px', fontSize: '0.78rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', marginBottom: '1rem' }}
              >
                <Plus size={15} /> Agregar Regla o Excepción
              </button>

              {/* Bottom Priority Legend Box */}
              <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: '12px', padding: '0.75rem', marginTop: 'auto' }}>
                <div style={{ fontWeight: 800, fontSize: '0.74rem', color: '#d48806', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Sparkles size={14} /> Prioridad de Aplicación
                </div>
                <div style={{ fontSize: '0.71rem', color: '#8c6b00', lineHeight: '1.45' }}>
                  El sistema aplica las reglas en este orden:<br/>
                  <strong>1. Excepción por Servicio</strong> (si existe - Mayor prioridad)<br/>
                  <strong>2. Regla por Categoría</strong><br/>
                  <strong>3. Regla General del Esquema / Catálogo</strong>
                </div>
              </div>

            </div>

          </div>

          {/* BOTTOM FULL-WIDTH CALCULATION EXPLANATION CARD */}
          <div style={{ background: '#fff0f6', border: '1px solid #fcc2d7', borderRadius: '20px', padding: '1.25rem 1.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', boxShadow: '0 4px 15px rgba(190,24,93,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ background: '#be185d', color: '#ffffff', width: '42px', height: '42px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Percent size={22} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#831843' }}>
                  Las comisiones se calculan siempre sobre el precio final del servicio
                </h3>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: '#9f1239' }}>
                  Cuando aplicas descuentos en el POS, el sistema calcula automáticamente la comisión en base al precio con descuento y excluyendo el ITBIS.
                </p>
              </div>
            </div>

            <div style={{ background: '#ffffff', padding: '0.85rem 1.5rem', borderRadius: '14px', border: '1px solid #fbcfe8', display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
              <div>
                <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Precio inicial: <strong>RD$ 1,000.00</strong></div>
                <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Descuento aplicado: <strong>20% (RD$ 200.00)</strong></div>
                <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#0f172a' }}>Precio final: RD$ 800.00</div>
              </div>
              <ArrowRight size={20} style={{ color: '#be185d' }} />
              <div>
                <span style={{ fontSize: '0.72rem', color: '#be185d', fontWeight: 800, textTransform: 'uppercase' }}>Comisión 20%</span>
                <div style={{ fontSize: '1.3rem', fontWeight: 900, color: '#be185d' }}>RD$ 160.00</div>
                <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>(Calculado sobre RD$ 800.00)</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: REGISTRO DE COMISIONES GENERADAS */}
      {activeTab === 'registro' && (
        <div>
          {/* METRICS SUMMARY CARDS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem', boxShadow: '0 4px 10px rgba(0,0,0,0.02)' }}>
              <span style={{ fontSize: '0.73rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>💰 TOTAL COMISIONES GENERADAS</span>
              <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#166534', marginTop: '0.25rem' }}>
                RD$ {metrics.totalGenerado.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
              </div>
              <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Generadas automáticamente por POS</span>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem', boxShadow: '0 4px 10px rgba(0,0,0,0.02)' }}>
              <span style={{ fontSize: '0.73rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>👤 COLABORADORES CON COMISIÓN</span>
              <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#0f172a', marginTop: '0.25rem' }}>
                {uniqueEmpsCount} Colaboradores
              </div>
              <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Con servicios realizados en el período</span>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem', boxShadow: '0 4px 10px rgba(0,0,0,0.02)' }}>
              <span style={{ fontSize: '0.73rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>📋 SERVICIOS REGISTRADOS</span>
              <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#be185d', marginTop: '0.25rem' }}>
                {metrics.count} Servicios
              </div>
              <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Líneas de servicio facturadas</span>
            </div>
          </div>

          {/* FILTERS TOOLBAR */}
          <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '16px', border: '1px solid #e2e8f0', marginBottom: '1.5rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', boxShadow: '0 4px 10px rgba(0,0,0,0.02)' }}>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Calendar size={16} style={{ color: '#64748b' }} />
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}>Desde:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{ padding: '0.5rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.8rem', fontWeight: 700 }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}>Hasta:</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ padding: '0.5rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.8rem', fontWeight: 700 }}
              />
            </div>

            {/* FILTER BY LOCALIDAD / SUCURSAL */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <MapPin size={16} style={{ color: '#be185d' }} />
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}>Localidad:</span>
              <select
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                style={{ padding: '0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.8rem', fontWeight: 700 }}
              >
                <option value="">Todas las localidades</option>
                {salons.map(s => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <User size={16} style={{ color: '#64748b' }} />
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}>Empleado:</span>
              <select
                value={selectedEmployee}
                onChange={(e) => setSelectedEmployee(e.target.value)}
                style={{ padding: '0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.8rem', fontWeight: 700 }}
              >
                <option value="">Todos los Colaboradores</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.nombre}</option>
                ))}
              </select>
            </div>

            <div style={{ flex: 1, minWidth: '200px' }}>
              <input
                type="text"
                placeholder="Buscar por servicio..."
                value={serviceSearch}
                onChange={(e) => setServiceSearch(e.target.value)}
                style={{ width: '100%', padding: '0.55rem 0.8rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.8rem', fontWeight: 600 }}
              />
            </div>
          </div>

          {/* TABLE OF COMMISSIONS */}
          <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 4px 10px rgba(0,0,0,0.03)' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                Cargando registros de comisión...
              </div>
            ) : commissions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                No se encontraron registros de comisiones con los filtros aplicados.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 800 }}>
                    <th style={{ padding: '0.75rem 1rem' }}>Ticket</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Fecha y Hora</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Colaborador</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Localidad</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Servicio Realizado</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Monto Base (Sin ITBIS)</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Regla Aplicada</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Comisión Ganada</th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((c) => (
                    <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 800, color: '#0f172a' }}>
                        {c.ticket_number || `TK-${c.visit_id}`}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: '#64748b', fontSize: '0.78rem' }}>
                        {new Date(c.created_at).toLocaleDateString('es-DO')} {new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 800, color: '#be185d' }}>
                        👤 {c.employee_name}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: '#475569', fontSize: '0.8rem' }}>
                        <MapPin size={12} style={{ display: 'inline', marginRight: '3px' }} />
                        {c.localidad || c.emp_localidad || 'Global'}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: '#334155', fontWeight: 700 }}>
                        {c.service_name} (x{c.cantidad})
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#64748b' }}>
                        RD$ {Number(c.monto_base).toFixed(2)}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                        <span style={{ background: '#fdf2f8', color: '#be185d', padding: '2px 8px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 800 }}>
                          {c.tipo_comision === 'Porcentaje' ? `${c.comision_valor}%` : `RD$ ${c.comision_valor}`}
                        </span>
                        {c.rule_applied_description && (
                          <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>{c.rule_applied_description}</div>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 900, color: '#15803d', fontSize: '0.95rem' }}>
                        RD$ {Number(c.monto_comision).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* --- MODAL 1: CREAR/EDITAR CATEGORÍA DE COMISIÓN --- */}
      {showCategoryModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#ffffff', borderRadius: '20px', width: '100%', maxWidth: '440px', padding: '1.75rem', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                {editingCategory ? 'Editar Categoría' : 'Nueva Categoría de Comisión'}
              </h3>
              <button onClick={() => setShowCategoryModal(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8' }}><X size={20} /></button>
            </div>

            <form onSubmit={handleSaveCategory}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>Nombre de Categoría *</label>
                <input
                  type="text" required placeholder="Ej: Servicios 20%"
                  value={categoryForm.nombre} onChange={e => setCategoryForm({ ...categoryForm, nombre: e.target.value })}
                  style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>Tipo</label>
                  <select
                    value={categoryForm.tipo} onChange={e => setCategoryForm({ ...categoryForm, tipo: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                  >
                    <option value="Porcentaje">Porcentaje (%)</option>
                    <option value="Monto_Fijo">Monto Fijo (RD$)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>Valor *</label>
                  <input
                    type="number" step="0.01" required placeholder="20"
                    value={categoryForm.porcentaje} onChange={e => setCategoryForm({ ...categoryForm, porcentaje: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 800 }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>Estado</label>
                <select
                  value={categoryForm.estado} onChange={e => setCategoryForm({ ...categoryForm, estado: e.target.value })}
                  style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                >
                  <option value="Activa">Activa</option>
                  <option value="Inactiva">Inactiva</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowCategoryModal(false)} style={{ padding: '0.65rem 1.25rem', borderRadius: '10px', border: '1px solid #cbd5e1', background: '#ffffff', fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" style={{ padding: '0.65rem 1.25rem', borderRadius: '10px', border: 'none', background: '#be185d', color: '#ffffff', fontWeight: 800, cursor: 'pointer' }}>Guardar Categoría</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL 2: CREAR/EDITAR ESQUEMA DE COMISIÓN --- */}
      {showSchemeModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#ffffff', borderRadius: '20px', width: '100%', maxWidth: '480px', padding: '1.75rem', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                {editingScheme ? 'Editar Esquema' : 'Crear Nuevo Esquema de Comisión'}
              </h3>
              <button onClick={() => setShowSchemeModal(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8' }}><X size={20} /></button>
            </div>

            <form onSubmit={handleSaveScheme}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>Nombre del Esquema *</label>
                <input
                  type="text" required placeholder="Ej: Comisión Estándar, Comisión Senior..."
                  value={schemeForm.nombre} onChange={e => setSchemeForm({ ...schemeForm, nombre: e.target.value })}
                  style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>Descripción</label>
                <input
                  type="text" placeholder="Ej: Esquema general para la mayoría del personal"
                  value={schemeForm.descripcion} onChange={e => setSchemeForm({ ...schemeForm, descripcion: e.target.value })}
                  style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 600 }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.5rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>Tipo de Esquema</label>
                  <select
                    value={schemeForm.tipo} onChange={e => setSchemeForm({ ...schemeForm, tipo: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                  >
                    <option value="Por Categorías">Por Categorías</option>
                    <option value="Personalizado">Personalizado</option>
                    <option value="Mixto">Mixto</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>Estado</label>
                  <select
                    value={schemeForm.estado} onChange={e => setSchemeForm({ ...schemeForm, estado: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                  >
                    <option value="Activo">Activo</option>
                    <option value="Inactivo">Inactivo</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowSchemeModal(false)} style={{ padding: '0.65rem 1.25rem', borderRadius: '10px', border: '1px solid #cbd5e1', background: '#ffffff', fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" style={{ padding: '0.65rem 1.25rem', borderRadius: '10px', border: 'none', background: '#be185d', color: '#ffffff', fontWeight: 800, cursor: 'pointer' }}>Guardar Esquema</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL 3: AGREGAR REGLA O EXCEPCIÓN A ESQUEMA --- */}
      {showRuleModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#ffffff', borderRadius: '20px', width: '100%', maxWidth: '460px', padding: '1.75rem', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                Agregar Regla / Excepción al Esquema
              </h3>
              <button onClick={() => setShowRuleModal(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8' }}><X size={20} /></button>
            </div>

            <form onSubmit={handleSaveRule}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#334155', marginBottom: '0.35rem' }}>Aplica a:</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => setRuleForm({ ...ruleForm, rule_type: 'categoria' })}
                    style={{ padding: '0.6rem', borderRadius: '8px', border: ruleForm.rule_type === 'categoria' ? '2px solid #be185d' : '1px solid #cbd5e1', background: ruleForm.rule_type === 'categoria' ? '#fdf2f8' : '#ffffff', color: ruleForm.rule_type === 'categoria' ? '#be185d' : '#475569', fontWeight: 800, fontSize: '0.8rem', cursor: 'pointer' }}
                  >
                    Por Categoría
                  </button>
                  <button
                    type="button"
                    onClick={() => setRuleForm({ ...ruleForm, rule_type: 'servicio' })}
                    style={{ padding: '0.6rem', borderRadius: '8px', border: ruleForm.rule_type === 'servicio' ? '2px solid #be185d' : '1px solid #cbd5e1', background: ruleForm.rule_type === 'servicio' ? '#fdf2f8' : '#ffffff', color: ruleForm.rule_type === 'servicio' ? '#be185d' : '#475569', fontWeight: 800, fontSize: '0.8rem', cursor: 'pointer' }}
                  >
                    Excepción por Servicio
                  </button>
                </div>
              </div>

              {ruleForm.rule_type === 'categoria' ? (
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>Categoría de Comisión *</label>
                  <select
                    value={ruleForm.category_name} onChange={e => setRuleForm({ ...ruleForm, category_name: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                  >
                    {categories.map(c => (
                      <option key={c.id} value={c.nombre}>{c.nombre}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 800, color: '#334155' }}>
                      Servicio / Ítem del Catálogo *
                    </label>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#be185d', background: '#fdf2f8', padding: '2px 8px', borderRadius: '9999px', border: '1px solid #fce7f3' }}>
                      {allServices.length} ítems registrados
                    </span>
                  </div>
                  {allServices.length > 0 ? (
                    <select
                      value={ruleForm.service_name}
                      onChange={e => {
                        const selected = allServices.find(s => s.nombre === e.target.value);
                        setRuleForm({
                          ...ruleForm,
                          service_name: e.target.value,
                          service_id: selected?.id || ''
                        });
                      }}
                      style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1.5px solid #be185d', fontWeight: 700, fontSize: '0.85rem', background: '#ffffff' }}
                      required
                    >
                      <option value="">-- Selecciona un Servicio / Ítem --</option>
                      {allServices.map(s => (
                        <option key={s.id} value={s.nombre}>
                          {s.nombre} {s.precio ? `· RD$ ${Number(s.precio).toLocaleString('es-DO')}` : ''} {s.categoria ? `· [${s.categoria}]` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      required
                      placeholder="Ej: Keratina, Alisado Brasileño..."
                      value={ruleForm.service_name}
                      onChange={e => setRuleForm({ ...ruleForm, service_name: e.target.value })}
                      style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                    />
                  )}
                  <span style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
                    💡 Selecciona el ítem al que deseas aplicar esta comisión específica o monto fijo.
                  </span>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.5rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>Tipo de Cálculo</label>
                  <select
                    value={ruleForm.tipo_calculo} onChange={e => setRuleForm({ ...ruleForm, tipo_calculo: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                  >
                    <option value="Porcentaje">Porcentaje (%)</option>
                    <option value="Monto_Fijo">Monto Fijo (RD$)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>Valor *</label>
                  <input
                    type="number" step="0.01" required placeholder="25"
                    value={ruleForm.valor} onChange={e => setRuleForm({ ...ruleForm, valor: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 800 }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowRuleModal(false)} style={{ padding: '0.65rem 1.25rem', borderRadius: '10px', border: '1px solid #cbd5e1', background: '#ffffff', fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" style={{ padding: '0.65rem 1.25rem', borderRadius: '10px', border: 'none', background: '#be185d', color: '#ffffff', fontWeight: 800, cursor: 'pointer' }}>Guardar Regla</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default CommissionManagement;
