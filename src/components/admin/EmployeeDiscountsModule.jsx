import React, { useState, useEffect, useMemo } from 'react';
import { 
  DollarSign, Users, Plus, Search, Filter, Calendar, FileSpreadsheet, 
  Trash2, Edit3, CheckCircle2, Clock, XCircle, AlertCircle, RefreshCw,
  ArrowDownRight, User, FileText, X, Save, ShoppingBag, Scissors, CreditCard,
  Percent, Sparkles, MapPin, Receipt, Check
} from 'lucide-react';
import { dataService } from '../../utils/dataService';

const DISCOUNT_TYPES = [
  { id: 'Consumo_Servicio', label: 'Consumo de Servicio', icon: Scissors, color: '#be185d', bg: '#fdf2f8', border: '#fbcfe8' },
  { id: 'Consumo_Producto', label: 'Consumo de Producto', icon: ShoppingBag, color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  { id: 'Prestamo', label: 'Préstamo / Adelanto', icon: DollarSign, color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  { id: 'Uniforme', label: 'Uniforme / Materiales', icon: FileText, color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  { id: 'Sancion', label: 'Tardanza / Penalidad', icon: AlertCircle, color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  { id: 'Otro', label: 'Otro Descuento', icon: CreditCard, color: '#475569', bg: '#f8fafc', border: '#e2e8f0' }
];

const EmployeeDiscountsModule = () => {
  const [discounts, setDiscounts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedEmployee, setSelectedEmployee] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedType, setSelectedType] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Default to current month quincena
  const getInitialDates = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const day = now.getDate();
    if (day <= 15) {
      return {
        start: new Date(year, month, 1).toISOString().split('T')[0],
        end: new Date(year, month, 15).toISOString().split('T')[0]
      };
    } else {
      return {
        start: new Date(year, month, 16).toISOString().split('T')[0],
        end: new Date(year, month + 1, 0).toISOString().split('T')[0]
      };
    }
  };

  const initialDates = getInitialDates();
  const [startDate, setStartDate] = useState(initialDates.start);
  const [endDate, setEndDate] = useState(initialDates.end);

  // Modal Create/Edit
  const [showModal, setShowModal] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState(null);
  const [formData, setFormData] = useState({
    employee_id: '',
    employee_name: '',
    type: 'Consumo_Servicio',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    notes: '',
    status: 'Pendiente'
  });
  const [saving, setSaving] = useState(false);
  const [useEmployee20Discount, setUseEmployee20Discount] = useState(true);
  const [serviceBasePrice, setServiceBasePrice] = useState('');

  useEffect(() => {
    loadEmployees();
  }, []);

  useEffect(() => {
    loadDiscounts();
  }, [startDate, endDate, selectedEmployee, selectedStatus, selectedType]);

  const loadEmployees = async () => {
    try {
      const empList = await dataService.getEmployees(true).catch(() => []);
      const combined = [];
      const seen = new Set();

      (empList || []).forEach(e => {
        if (e.nombre && !seen.has(e.nombre.toLowerCase().trim())) {
          seen.add(e.nombre.toLowerCase().trim());
          combined.push({ 
            id: e.id, 
            nombre: e.nombre, 
            posicion: e.rol || e.posicion || 'Colaborador',
            localidad: e.localidad || 'Principal'
          });
        }
      });

      setEmployees(combined);
    } catch (err) {
      console.error('Error cargando colaboradores:', err);
    }
  };

  const loadDiscounts = async () => {
    setLoading(true);
    try {
      const discList = await dataService.getEmployeeDiscounts({
        employee_id: selectedEmployee,
        status: selectedStatus,
        type: selectedType,
        start_date: startDate,
        end_date: endDate
      });
      setDiscounts(discList || []);
    } catch (err) {
      console.error('Error cargando descuentos de empleados:', err);
    } finally {
      setLoading(false);
    }
  };

  // Quincena & Month Quick Presets
  const handleSetQuincena = (type) => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    
    if (type === 'q1_actual') {
      const s = new Date(year, month, 1);
      const e = new Date(year, month, 15);
      setStartDate(s.toISOString().split('T')[0]);
      setEndDate(e.toISOString().split('T')[0]);
    } else if (type === 'q2_actual') {
      const s = new Date(year, month, 16);
      const e = new Date(year, month + 1, 0);
      setStartDate(s.toISOString().split('T')[0]);
      setEndDate(e.toISOString().split('T')[0]);
    } else if (type === 'mes_actual') {
      const s = new Date(year, month, 1);
      const e = new Date(year, month + 1, 0);
      setStartDate(s.toISOString().split('T')[0]);
      setEndDate(e.toISOString().split('T')[0]);
    } else if (type === 'mes_anterior') {
      const s = new Date(year, month - 1, 1);
      const e = new Date(year, month, 0);
      setStartDate(s.toISOString().split('T')[0]);
      setEndDate(e.toISOString().split('T')[0]);
    }
  };

  const handleOpenCreateModal = () => {
    setEditingDiscount(null);
    setFormData({
      employee_id: employees[0]?.id || '',
      employee_name: employees[0]?.nombre || '',
      type: 'Consumo_Servicio',
      amount: '',
      date: new Date().toISOString().split('T')[0],
      notes: '',
      status: 'Pendiente'
    });
    setUseEmployee20Discount(true);
    setServiceBasePrice('');
    setShowModal(true);
  };

  const handleOpenEditModal = (item) => {
    setEditingDiscount(item);
    setFormData({
      employee_id: item.employee_id,
      employee_name: item.employee_name,
      type: item.type,
      amount: item.amount,
      date: item.date ? item.date.split('T')[0] : new Date().toISOString().split('T')[0],
      notes: item.notes || '',
      status: item.status || 'Pendiente'
    });
    setUseEmployee20Discount(false);
    setServiceBasePrice('');
    setShowModal(true);
  };

  const handleSaveDiscount = async (e) => {
    e.preventDefault();
    if (!formData.employee_id) return alert('Debes seleccionar un colaborador.');
    if (!formData.amount || Number(formData.amount) <= 0) return alert('Debes ingresar un monto válido mayor a 0.');

    setSaving(true);
    try {
      const selectedEmp = employees.find(emp => String(emp.id) === String(formData.employee_id));
      const payload = {
        ...formData,
        employee_name: selectedEmp?.nombre || formData.employee_name || 'Colaborador'
      };

      if (editingDiscount) {
        await dataService.updateEmployeeDiscount(editingDiscount.id, payload);
      } else {
        await dataService.createEmployeeDiscount(payload);
      }
      setShowModal(false);
      loadDiscounts();
    } catch (err) {
      alert('Error al guardar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDiscount = async (id) => {
    if (!window.confirm('¿Estás seguro de que deseas eliminar este registro de descuento?')) return;
    try {
      await dataService.deleteEmployeeDiscount(id);
      loadDiscounts();
    } catch (err) {
      alert('Error eliminando: ' + err.message);
    }
  };

  const handleToggleStatus = async (item) => {
    const newStatus = item.status === 'Pendiente' ? 'Aplicado' : 'Pendiente';
    const cleanDate = item.date ? (String(item.date).includes('T') ? String(item.date).split('T')[0] : String(item.date).split(' ')[0]) : new Date().toISOString().split('T')[0];
    try {
      await dataService.updateEmployeeDiscount(item.id, { 
        ...item, 
        date: cleanDate,
        status: newStatus 
      });
      loadDiscounts();
    } catch (err) {
      alert('Error actualizando estatus: ' + err.message);
    }
  };

  // Filtered list based on search term
  const filteredDiscounts = useMemo(() => {
    return discounts.filter(d => {
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      return (
        (d.employee_name || '').toLowerCase().includes(term) ||
        (d.type || '').toLowerCase().includes(term) ||
        (d.notes || '').toLowerCase().includes(term) ||
        (d.status || '').toLowerCase().includes(term) ||
        (d.localidad || '').toLowerCase().includes(term)
      );
    });
  }, [discounts, searchTerm]);

  // Overall KPI Calculations
  const totalAmount = filteredDiscounts.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  const totalPending = filteredDiscounts.filter(d => d.status === 'Pendiente').reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  const totalApplied = filteredDiscounts.filter(d => d.status === 'Aplicado').reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  const countPending = filteredDiscounts.filter(d => d.status === 'Pendiente').length;

  // Group discounts by Employee for clean per-employee visual breakdown
  const groupedDiscounts = useMemo(() => {
    if (!Array.isArray(filteredDiscounts) || filteredDiscounts.length === 0) return [];
    
    const groupsMap = new Map();
    
    filteredDiscounts.forEach(d => {
      const empKey = d.employee_id || d.employee_name || 'Desconocido';
      const empName = d.employee_name || 'Colaborador';
      const location = d.localidad || 'Principal';
      const position = d.employee_position || 'Colaborador';
      
      if (!groupsMap.has(empKey)) {
        groupsMap.set(empKey, {
          id: empKey,
          name: empName,
          position: position,
          location: location,
          totalAmount: 0,
          totalPending: 0,
          totalApplied: 0,
          items: []
        });
      }
      
      const group = groupsMap.get(empKey);
      const amt = Number(d.amount || 0);
      group.totalAmount += amt;
      if (d.status === 'Pendiente') group.totalPending += amt;
      else if (d.status === 'Aplicado') group.totalApplied += amt;
      group.items.push(d);
    });
    
    return Array.from(groupsMap.values()).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [filteredDiscounts]);

  const uniqueEmpsCount = groupedDiscounts.length;

  const handleExportCSV = () => {
    if (filteredDiscounts.length === 0) return alert('No hay datos para exportar.');
    const headers = ['ID', 'Colaborador', 'Posición', 'Sucursal', 'Tipo de Descuento', 'Monto (RD$)', 'Fecha', 'Estatus', 'Notas / Concepto'];
    const rows = filteredDiscounts.map(d => [
      d.id,
      d.employee_name || 'Colaborador',
      d.employee_position || 'Colaborador',
      d.localidad || 'Principal',
      d.type,
      Number(d.amount || 0).toFixed(2),
      d.date ? d.date.split('T')[0] : '',
      d.status,
      (d.notes || '').replace(/"/g, '""')
    ]);

    const csvContent = [headers, ...rows].map(e => e.map(val => `"${val}"`).join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `descuentos_empleados_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '1.5rem', fontFamily: 'Inter, system-ui, sans-serif' }}>
      
      {/* HEADER BANNER */}
      <div style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)', color: '#ffffff', padding: '1.75rem 2rem', borderRadius: '24px', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 12px 30px -10px rgba(15,23,42,0.4)', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
            <div style={{ background: '#be185d', padding: '0.45rem', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <DollarSign size={24} color="#ffffff" />
            </div>
            <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 900, letterSpacing: '-0.02em' }}>
              Descuentos y Deducciones de Empleados
            </h1>
          </div>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.85rem' }}>
            Control de cargos a nómina por servicios del salón, préstamos y consumos organizados por colaborador
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.45rem',
            background: 'rgba(219, 39, 119, 0.15)',
            border: '1px solid rgba(244, 114, 182, 0.3)',
            color: '#f472b6',
            padding: '0.55rem 0.95rem',
            borderRadius: '12px',
            fontSize: '0.78rem',
            fontWeight: 800
          }}>
            <Sparkles size={15} color="#f472b6" />
            <span>Beneficio Nómina: 20% en Servicios</span>
          </div>

          <button
            type="button"
            onClick={handleExportCSV}
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.65rem 1.1rem', borderRadius: '12px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', fontSize: '0.825rem', fontWeight: 800, color: '#ffffff', cursor: 'pointer', backdropFilter: 'blur(10px)' }}
          >
            <FileSpreadsheet size={16} color="#34d399" />
            <span>Exportar Nómina</span>
          </button>

          <button
            type="button"
            onClick={handleOpenCreateModal}
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.65rem 1.25rem', borderRadius: '12px', background: '#be185d', border: 'none', fontSize: '0.825rem', fontWeight: 800, color: '#ffffff', cursor: 'pointer', boxShadow: '0 4px 14px rgba(190,24,93,0.4)' }}
          >
            <Plus size={16} />
            <span>+ Registrar Descuento</span>
          </button>
        </div>
      </div>

      {/* KPI SUMMARY METRICS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: '#ffffff', padding: '1.25rem 1.5rem', borderRadius: '20px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Total Deducciones Período</span>
            <DollarSign size={18} color="#0f172a" />
          </div>
          <h2 style={{ margin: '0.35rem 0 0', fontSize: '1.85rem', fontWeight: 900, color: '#0f172a' }}>
            RD$ {totalAmount.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
          </h2>
          <span style={{ fontSize: '0.725rem', color: '#64748b', fontWeight: 600 }}>{filteredDiscounts.length} registros en el rango seleccionado</span>
        </div>

        <div style={{ background: '#ffffff', padding: '1.25rem 1.5rem', borderRadius: '20px', border: '1.5px solid #fecaca', boxShadow: '0 4px 12px rgba(220,38,38,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#dc2626', textTransform: 'uppercase' }}>Pendiente por Descontar</span>
            <Clock size={18} color="#dc2626" />
          </div>
          <h2 style={{ margin: '0.35rem 0 0', fontSize: '1.85rem', fontWeight: 900, color: '#dc2626' }}>
            RD$ {totalPending.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
          </h2>
          <span style={{ fontSize: '0.725rem', color: '#b91c1c', fontWeight: 700 }}>{countPending} deducciones pendientes de nómina</span>
        </div>

        <div style={{ background: '#ffffff', padding: '1.25rem 1.5rem', borderRadius: '20px', border: '1.5px solid #bbf7d0', boxShadow: '0 4px 12px rgba(22,163,74,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#16a34a', textTransform: 'uppercase' }}>Aplicado en Nómina</span>
            <CheckCircle2 size={18} color="#16a34a" />
          </div>
          <h2 style={{ margin: '0.35rem 0 0', fontSize: '1.85rem', fontWeight: 900, color: '#16a34a' }}>
            RD$ {totalApplied.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
          </h2>
          <span style={{ fontSize: '0.725rem', color: '#15803d', fontWeight: 600 }}>Deducciones ya procesadas</span>
        </div>

        <div style={{ background: '#ffffff', padding: '1.25rem 1.5rem', borderRadius: '20px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Colaboradores Activos</span>
            <Users size={18} color="#64748b" />
          </div>
          <h2 style={{ margin: '0.35rem 0 0', fontSize: '1.85rem', fontWeight: 900, color: '#0f172a' }}>
            {uniqueEmpsCount} {uniqueEmpsCount === 1 ? 'Colaborador' : 'Colaboradores'}
          </h2>
          <span style={{ fontSize: '0.725rem', color: '#64748b', fontWeight: 600 }}>Con consumos o préstamos en el período</span>
        </div>
      </div>

      {/* FILTER TOOLBAR & QUINCENA PRESETS */}
      <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '20px', border: '1px solid #e2e8f0', marginBottom: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
        {/* QUINCENA PRESETS ROW */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', paddingBottom: '1rem', borderBottom: '1px solid #f1f5f9', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>
              Período de Nómina:
            </span>
            <button
              type="button"
              onClick={() => handleSetQuincena('q1_actual')}
              style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.4rem 0.75rem', fontSize: '0.75rem', fontWeight: 800, color: '#0f172a', cursor: 'pointer' }}
            >
              1ra Quincena (1-15)
            </button>
            <button
              type="button"
              onClick={() => handleSetQuincena('q2_actual')}
              style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.4rem 0.75rem', fontSize: '0.75rem', fontWeight: 800, color: '#0f172a', cursor: 'pointer' }}
            >
              2da Quincena (16-Fin)
            </button>
            <button
              type="button"
              onClick={() => handleSetQuincena('mes_actual')}
              style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.4rem 0.75rem', fontSize: '0.75rem', fontWeight: 800, color: '#0f172a', cursor: 'pointer' }}
            >
              Mes Completo
            </button>
            <button
              type="button"
              onClick={() => handleSetQuincena('mes_anterior')}
              style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.4rem 0.75rem', fontSize: '0.75rem', fontWeight: 800, color: '#0f172a', cursor: 'pointer' }}
            >
              Mes Anterior
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700 }}>Desde:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ padding: '0.35rem 0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.78rem', fontWeight: 700 }}
            />
            <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700 }}>Hasta:</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{ padding: '0.35rem 0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.78rem', fontWeight: 700 }}
            />
          </div>
        </div>

        {/* DROPDOWNS & SEARCH ROW */}
        <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              type="text"
              placeholder="Buscar por colaborador, ticket o servicios..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '0.55rem 0.75rem 0.55rem 2.25rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.825rem', outline: 'none' }}
            />
          </div>

          <select
            value={selectedEmployee}
            onChange={(e) => setSelectedEmployee(e.target.value)}
            style={{ padding: '0.55rem 0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.825rem', fontWeight: 700, outline: 'none', background: '#ffffff' }}
          >
            <option value="all">Todos los Colaboradores</option>
            {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.nombre}</option>)}
          </select>

          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            style={{ padding: '0.55rem 0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.825rem', fontWeight: 700, outline: 'none', background: '#ffffff' }}
          >
            <option value="all">Todos los Tipos</option>
            {DISCOUNT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            style={{ padding: '0.55rem 0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.825rem', fontWeight: 700, outline: 'none', background: '#ffffff' }}
          >
            <option value="all">Todos los Estatus</option>
            <option value="Pendiente">⏳ Pendiente</option>
            <option value="Aplicado">✅ Aplicado</option>
          </select>

          <button
            type="button"
            onClick={loadDiscounts}
            style={{ padding: '0.55rem 1.1rem', borderRadius: '10px', background: '#09090b', color: '#ffffff', border: 'none', fontSize: '0.825rem', fontWeight: 800, cursor: 'pointer' }}
          >
            Actualizar
          </button>
        </div>
      </div>

      {/* ================= GROUPED BY EMPLOYEE ACCORDIONS / CARDS ================= */}
      {loading ? (
        <div style={{ background: '#ffffff', borderRadius: '24px', padding: '4rem', textAlign: 'center', border: '1px solid #e2e8f0', color: '#64748b' }}>
          <RefreshCw size={28} className="spin" style={{ margin: '0 auto 0.75rem' }} />
          <p style={{ margin: 0, fontWeight: 800, fontSize: '1rem', color: '#0f172a' }}>Cargando deducciones de colaboradores...</p>
        </div>
      ) : groupedDiscounts.length === 0 ? (
        <div style={{ background: '#ffffff', borderRadius: '24px', padding: '4rem 2rem', textAlign: 'center', border: '1px solid #e2e8f0' }}>
          <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: '#fdf2f8', color: '#be185d', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', fontSize: '1.5rem' }}>
            🏷️
          </div>
          <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
            No hay descuentos de empleados registrados
          </h3>
          <p style={{ margin: '0.35rem auto 1.25rem', fontSize: '0.85rem', color: '#64748b', maxWidth: '440px' }}>
            Los cargos por servicios facturados con nómina y préstamos en este período aparecerán aquí agrupados automáticamente por colaborador.
          </p>
          <button
            type="button"
            onClick={handleOpenCreateModal}
            style={{ padding: '0.65rem 1.25rem', borderRadius: '12px', background: '#be185d', color: '#ffffff', border: 'none', fontWeight: 800, cursor: 'pointer' }}
          >
            + Registrar Primer Descuento
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {groupedDiscounts.map((group) => {
            const initials = group.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

            return (
              <div 
                key={group.id} 
                style={{ 
                  background: '#ffffff', 
                  borderRadius: '20px', 
                  border: '1px solid #e2e8f0', 
                  overflow: 'hidden',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.03)'
                }}
              >
                {/* EMPLOYEE HEADER BAR */}
                <div style={{ 
                  background: '#f8fafc', 
                  padding: '1.1rem 1.5rem', 
                  borderBottom: '1.5px solid #e2e8f0', 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  flexWrap: 'wrap', 
                  gap: '1rem' 
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                    <div style={{ 
                      width: '44px', 
                      height: '44px', 
                      borderRadius: '12px', 
                      background: 'linear-gradient(135deg, #be185d 0%, #db2777 100%)', 
                      color: '#ffffff', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      fontWeight: 900, 
                      fontSize: '1rem',
                      boxShadow: '0 4px 10px rgba(190,24,93,0.25)'
                    }}>
                      {initials}
                    </div>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900, color: '#0f172a' }}>
                          {group.name}
                        </h3>
                        <span style={{ fontSize: '0.72rem', background: '#e2e8f0', color: '#475569', padding: '2px 8px', borderRadius: '6px', fontWeight: 800 }}>
                          {group.position}
                        </span>
                        <span style={{ fontSize: '0.72rem', background: '#f1f5f9', color: '#64748b', padding: '2px 8px', borderRadius: '6px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          <MapPin size={11} /> {group.location}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>
                        {group.items.length} {group.items.length === 1 ? 'deducción registrada' : 'deducciones registradas'} en el período
                      </span>
                    </div>
                  </div>

                  {/* TOTALS PILLS FOR THIS EMPLOYEE */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '0.45rem 0.85rem', borderRadius: '12px', textAlign: 'right' }}>
                      <span style={{ fontSize: '0.68rem', color: '#b91c1c', fontWeight: 800, textTransform: 'uppercase', display: 'block' }}>Pendiente Nómina</span>
                      <strong style={{ fontSize: '0.9rem', color: '#dc2626', fontWeight: 900 }}>
                        RD$ {group.totalPending.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </strong>
                    </div>

                    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '0.45rem 0.85rem', borderRadius: '12px', textAlign: 'right' }}>
                      <span style={{ fontSize: '0.68rem', color: '#15803d', fontWeight: 800, textTransform: 'uppercase', display: 'block' }}>Aplicado</span>
                      <strong style={{ fontSize: '0.9rem', color: '#16a34a', fontWeight: 900 }}>
                        RD$ {group.totalApplied.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </strong>
                    </div>

                    <div style={{ background: '#0f172a', border: '1.5px solid #1e293b', padding: '0.45rem 1rem', borderRadius: '12px', textAlign: 'right', color: '#ffffff', boxShadow: '0 2px 8px rgba(15,23,42,0.15)' }}>
                      <span style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase', display: 'block' }}>Total Deducciones</span>
                      <strong style={{ fontSize: '1.15rem', color: '#ffffff', fontWeight: 900 }}>
                        RD$ {group.totalAmount.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* DETAILED DEDUCTIONS TABLE FOR THIS EMPLOYEE */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.825rem' }}>
                    <thead>
                      <tr style={{ background: '#ffffff', borderBottom: '1px solid #f1f5f9', color: '#64748b', fontWeight: 800, fontSize: '0.725rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                        <th style={{ padding: '0.65rem 1rem' }}>Ticket / Ref</th>
                        <th style={{ padding: '0.65rem 1rem' }}>Fecha</th>
                        <th style={{ padding: '0.65rem 1rem' }}>Tipo de Deducción</th>
                        <th style={{ padding: '0.65rem 1rem' }}>Detalle / Servicios Realizados</th>
                        <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Monto Descontado</th>
                        <th style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>Estatus Nómina</th>
                        <th style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item) => {
                        const typeObj = DISCOUNT_TYPES.find(t => t.id === item.type) || DISCOUNT_TYPES[0];
                        const Icon = typeObj.icon;
                        const isPending = item.status === 'Pendiente';

                        // Extract ticket number if present in notes or ticket field
                        let displayTicket = `DISC-${item.id}`;
                        if (item.notes && item.notes.includes('Factura #')) {
                          const match = item.notes.match(/Factura\s*#([A-Za-z0-9-_]+)/i);
                          if (match) displayTicket = match[1];
                        }

                        return (
                          <tr key={item.id} style={{ borderBottom: '1px solid #f8fafc' }}>
                            <td style={{ padding: '0.65rem 1rem', fontWeight: 800, color: '#0f172a' }}>
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#f1f5f9', padding: '2px 8px', borderRadius: '6px', fontSize: '0.78rem' }}>
                                <Receipt size={12} color="#64748b" />
                                <span>{displayTicket}</span>
                              </div>
                            </td>

                            <td style={{ padding: '0.65rem 1rem', color: '#475569', fontSize: '0.78rem', fontWeight: 600 }}>
                              {item.date ? new Date(item.date).toLocaleDateString('es-DO') : 'N/A'}
                            </td>

                            <td style={{ padding: '0.65rem 1rem' }}>
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: typeObj.bg, border: `1px solid ${typeObj.border}`, color: typeObj.color, padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 800 }}>
                                <Icon size={12} />
                                <span>{typeObj.label}</span>
                              </div>
                            </td>

                            <td style={{ padding: '0.65rem 1rem', color: '#1e293b', fontWeight: 600, maxWidth: '340px' }}>
                              <span style={{ display: 'block', fontSize: '0.8rem' }}>
                                {item.notes || '(Sin observaciones detalladas)'}
                              </span>
                            </td>

                            <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontWeight: 900, color: '#dc2626', fontSize: '0.92rem' }}>
                              - RD$ {Number(item.amount || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                            </td>

                            <td style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>
                              <button
                                type="button"
                                onClick={() => handleToggleStatus(item)}
                                style={{
                                  border: 'none', cursor: 'pointer', padding: '3px 10px', borderRadius: '99px',
                                  fontSize: '0.7rem', fontWeight: 900,
                                  background: isPending ? '#fee2e2' : '#dcfce7',
                                  color: isPending ? '#b91c1c' : '#15803d'
                                }}
                                title="Haz clic para alternar entre Pendiente y Aplicado"
                              >
                                {isPending ? '⏳ PENDIENTE' : '✔ APLICADO'}
                              </button>
                            </td>

                            <td style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditModal(item)}
                                  style={{ background: '#f8fafc', border: '1px solid #cbd5e1', padding: '0.35rem', borderRadius: '6px', cursor: 'pointer', color: '#0f172a' }}
                                  title="Editar"
                                >
                                  <Edit3 size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteDiscount(item.id)}
                                  style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '0.35rem', borderRadius: '6px', cursor: 'pointer', color: '#dc2626' }}
                                  title="Eliminar"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: '#fdf2f8', borderTop: '1.5px solid #fbcfe8' }}>
                        <td colSpan={4} style={{ padding: '0.75rem 1rem', fontWeight: 800, color: '#831843', fontSize: '0.8rem' }}>
                          SUBTOTAL DEDUCCIONES PARA {group.name.toUpperCase()} ({group.items.length} {group.items.length === 1 ? 'registro' : 'registros'}):
                        </td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 900, color: '#dc2626', fontSize: '0.92rem' }}>
                          - RD$ {group.totalAmount.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                        </td>
                        <td colSpan={2} style={{ padding: '0.75rem 1rem', textAlign: 'center', fontSize: '0.725rem', color: '#9d174d', fontWeight: 700 }}>
                          (Pendiente: RD$ {group.totalPending.toLocaleString('es-DO', { minimumFractionDigits: 2 })} | Aplicado: RD$ {group.totalApplied.toLocaleString('es-DO', { minimumFractionDigits: 2 })})
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ================= MODAL CREATE / EDIT ================= */}
      {showModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1050, padding: '1rem' }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: '520px', borderRadius: '20px', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
            
            <div style={{ padding: '1.25rem 1.5rem', background: '#0f172a', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>
                {editingDiscount ? 'Editar Descuento / Deducción' : 'Registrar Nuevo Descuento a Empleado'}
              </h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveDiscount} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, color: '#334155', marginBottom: '0.3rem', textTransform: 'uppercase' }}>
                  Colaborador / Empleado *
                </label>
                <select
                  value={formData.employee_id}
                  onChange={(e) => {
                    const emp = employees.find(em => String(em.id) === String(e.target.value));
                    setFormData({ ...formData, employee_id: e.target.value, employee_name: emp?.nombre || '' });
                  }}
                  required
                  style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.85rem', fontWeight: 700 }}
                >
                  <option value="">Seleccionar Colaborador...</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.nombre} ({emp.posicion || 'Colaborador'})</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, color: '#334155', marginBottom: '0.3rem', textTransform: 'uppercase' }}>
                    Tipo de Deducción *
                  </label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.85rem', fontWeight: 700 }}
                  >
                    {DISCOUNT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, color: '#334155', marginBottom: '0.3rem', textTransform: 'uppercase' }}>
                    Monto a Deducir (RD$) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    placeholder="Ej. 1200.00"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.85rem', fontWeight: 800 }}
                  />
                </div>
              </div>

              {formData.type === 'Consumo_Servicio' && (
                <div style={{
                  background: '#fdf2f8',
                  border: '1.5px dashed #f472b6',
                  borderRadius: '14px',
                  padding: '0.85rem 1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.65rem'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <Sparkles size={16} color="#be185d" />
                      <strong style={{ fontSize: '0.82rem', color: '#be185d' }}>
                        Calculadora de Beneficio Colaborador (-20%)
                      </strong>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 800, color: '#be185d' }}>
                      <input
                        type="checkbox"
                        checked={useEmployee20Discount}
                        onChange={(e) => {
                          const isChecked = e.target.checked;
                          setUseEmployee20Discount(isChecked);
                          if (serviceBasePrice && isChecked) {
                            const discounted = (Number(serviceBasePrice) * 0.8).toFixed(2);
                            setFormData(prev => ({
                              ...prev,
                              amount: discounted,
                              notes: prev.notes ? prev.notes : `Consumo con beneficio 20% (Precio regular: RD$ ${Number(serviceBasePrice).toFixed(2)})`
                            }));
                          } else if (serviceBasePrice && !isChecked) {
                            setFormData(prev => ({ ...prev, amount: Number(serviceBasePrice).toFixed(2) }));
                          }
                        }}
                      />
                      Aplicar -20%
                    </label>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', alignItems: 'center' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 800, color: '#9d174d', marginBottom: '0.2rem' }}>
                        PRECIO REGULAR DEL SERVICIO:
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Ej. 1500.00"
                        value={serviceBasePrice}
                        onChange={(e) => {
                          const val = e.target.value;
                          setServiceBasePrice(val);
                          if (val && useEmployee20Discount) {
                            const discounted = (Number(val) * 0.8).toFixed(2);
                            setFormData(prev => ({
                              ...prev,
                              amount: discounted,
                              notes: prev.notes && !prev.notes.includes('beneficio 20%') ? prev.notes : `Consumo con beneficio 20% (Precio regular: RD$ ${Number(val).toFixed(2)})`
                            }));
                          } else if (val) {
                            setFormData(prev => ({ ...prev, amount: Number(val).toFixed(2) }));
                          }
                        }}
                        style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid #fbcfe8', fontSize: '0.85rem', fontWeight: 700, background: '#ffffff' }}
                      />
                    </div>

                    {Number(serviceBasePrice) > 0 && useEmployee20Discount && (
                      <div style={{ background: '#ffffff', borderRadius: '8px', padding: '0.5rem 0.75rem', border: '1px solid #fbcfe8' }}>
                        <span style={{ display: 'block', fontSize: '0.68rem', color: '#64748b', fontWeight: 700 }}>MONTO CON 20% DESC:</span>
                        <strong style={{ fontSize: '0.95rem', color: '#15803d', fontWeight: 900 }}>
                          RD$ {(Number(serviceBasePrice) * 0.8).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                        </strong>
                        <span style={{ display: 'block', fontSize: '0.68rem', color: '#be185d', fontWeight: 700 }}>
                          (Ahorro: -RD$ {(Number(serviceBasePrice) * 0.2).toFixed(2)})
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, color: '#334155', marginBottom: '0.3rem', textTransform: 'uppercase' }}>
                    Fecha del Registro *
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.85rem', fontWeight: 700 }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, color: '#334155', marginBottom: '0.3rem', textTransform: 'uppercase' }}>
                    Estatus
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.85rem', fontWeight: 700 }}
                  >
                    <option value="Pendiente">⏳ Pendiente de Nómina</option>
                    <option value="Aplicado">✅ Aplicado / Descontado</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, color: '#334155', marginBottom: '0.3rem', textTransform: 'uppercase' }}>
                  Concepto / Observaciones
                </label>
                <textarea
                  rows="3"
                  placeholder="Detalle de servicios o motivo del descuento/préstamo..."
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.85rem', resize: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{ padding: '0.65rem 1.25rem', borderRadius: '10px', background: '#f1f5f9', border: '1px solid #cbd5e1', fontSize: '0.85rem', fontWeight: 800, color: '#475569', cursor: 'pointer' }}
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  style={{ padding: '0.65rem 1.5rem', borderRadius: '10px', background: '#be185d', border: 'none', fontSize: '0.85rem', fontWeight: 800, color: '#ffffff', cursor: 'pointer' }}
                >
                  {saving ? 'Guardando...' : 'Guardar Descuento'}
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

    </div>
  );
};

export default EmployeeDiscountsModule;
