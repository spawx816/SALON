import React, { useState, useEffect } from 'react';
import { 
  DollarSign, Users, Plus, Search, Filter, Calendar, FileSpreadsheet, 
  Trash2, Edit3, CheckCircle2, Clock, XCircle, AlertCircle, RefreshCw,
  ArrowDownRight, User, FileText, X, Save, ShoppingBag, Scissors, CreditCard
} from 'lucide-react';
import { dataService } from '../../utils/dataService';

const DISCOUNT_TYPES = [
  { id: 'Consumo_Servicio', label: 'Consumo de Servicio', icon: Scissors, color: '#ec4899' },
  { id: 'Consumo_Producto', label: 'Consumo de Producto', icon: ShoppingBag, color: '#f59e0b' },
  { id: 'Prestamo', label: 'Préstamo / Adelanto de Sueldo', icon: DollarSign, color: '#3b82f6' },
  { id: 'Uniforme', label: 'Uniforme / Materiales', icon: FileText, color: '#8b5cf6' },
  { id: 'Sancion', label: 'Tardanza / Penalidad', icon: AlertCircle, color: '#ef4444' },
  { id: 'Otro', label: 'Otro Descuento', icon: CreditCard, color: '#64748b' }
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
  const [startDate, setStartDate] = useState(new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);

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

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [staffList, usersList, posEmpList, discList] = await Promise.all([
        dataService.getStaffRecords().catch(() => []),
        dataService.getUsers().catch(() => []),
        dataService.getEmployees().catch(() => []),
        dataService.getEmployeeDiscounts({
          employee_id: selectedEmployee,
          status: selectedStatus,
          type: selectedType,
          start_date: startDate,
          end_date: endDate
        })
      ]);

      const combined = [];
      const seen = new Set();

      (staffList || []).forEach(s => {
        if (s.nombre && !seen.has(s.nombre.toLowerCase().trim())) {
          seen.add(s.nombre.toLowerCase().trim());
          combined.push({ id: s.id, nombre: s.nombre, posicion: s.posicion || 'Colaborador' });
        }
      });

      (usersList || []).forEach(u => {
        if (u.nombre && !seen.has(u.nombre.toLowerCase().trim())) {
          seen.add(u.nombre.toLowerCase().trim());
          combined.push({ id: u.id, nombre: u.nombre, posicion: u.role_name || u.posicion || 'Personal' });
        }
      });

      (posEmpList || []).forEach(e => {
        if (e.nombre && !seen.has(e.nombre.toLowerCase().trim())) {
          seen.add(e.nombre.toLowerCase().trim());
          combined.push({ id: e.id, nombre: e.nombre, posicion: e.rol || e.posicion || 'Estilista' });
        }
      });

      setEmployees(combined);
      setDiscounts(discList || []);
    } catch (err) {
      console.error('Error cargando descuentos de empleados:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFilter = (e) => {
    if (e) e.preventDefault();
    loadData();
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
      loadData();
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
      loadData();
    } catch (err) {
      alert('Error eliminando: ' + err.message);
    }
  };

  const handleToggleStatus = async (item) => {
    const newStatus = item.status === 'Pendiente' ? 'Aplicado' : 'Pendiente';
    try {
      await dataService.updateEmployeeDiscount(item.id, { ...item, status: newStatus });
      loadData();
    } catch (err) {
      alert('Error actualizando estatus: ' + err.message);
    }
  };

  // KPI Calculations
  const filteredDiscounts = discounts.filter(d => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      (d.employee_name || '').toLowerCase().includes(term) ||
      (d.type || '').toLowerCase().includes(term) ||
      (d.notes || '').toLowerCase().includes(term) ||
      (d.status || '').toLowerCase().includes(term)
    );
  });

  const totalAmount = filteredDiscounts.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  const totalPending = filteredDiscounts.filter(d => d.status === 'Pendiente').reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  const totalApplied = filteredDiscounts.filter(d => d.status === 'Aplicado').reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  const countPending = filteredDiscounts.filter(d => d.status === 'Pendiente').length;

  const handleExportCSV = () => {
    if (filteredDiscounts.length === 0) return alert('No hay datos para exportar.');
    const headers = ['ID', 'Colaborador', 'Posición', 'Sucursal', 'Tipo de Descuento', 'Monto (RD$)', 'Fecha', 'Estatus', 'Notas / Concepto'];
    const rows = filteredDiscounts.map(d => [
      d.id,
      d.employee_name || 'Colaborador',
      d.employee_position || 'N/A',
      d.localidad || 'Central',
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
    <div style={{ padding: '0 0.5rem 2rem' }}>
      
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'linear-gradient(135deg, #be185d 0%, #db2777 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff' }}>
            <DollarSign size={22} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.45rem', fontWeight: 900, color: '#0f172a' }}>
              Descuentos y Deducciones de Empleados
            </h1>
            <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>
              Gestión de préstamos, consumos de productos/servicios y descuentos para nómina
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <button
            type="button"
            onClick={handleExportCSV}
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.6rem 1.1rem', borderRadius: '12px', background: '#f8fafc', border: '1px solid #cbd5e1', fontSize: '0.825rem', fontWeight: 800, color: '#0f172a', cursor: 'pointer' }}
          >
            <FileSpreadsheet size={16} color="#059669" />
            <span>Exportar Nómina</span>
          </button>

          <button
            type="button"
            onClick={handleOpenCreateModal}
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.6rem 1.25rem', borderRadius: '12px', background: '#be185d', border: 'none', fontSize: '0.825rem', fontWeight: 800, color: '#ffffff', cursor: 'pointer', boxShadow: '0 4px 12px rgba(190,24,93,0.25)' }}
          >
            <Plus size={16} />
            <span>+ Registrar Descuento</span>
          </button>
        </div>
      </div>

      {/* KPI METRICS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Total Descuentos</span>
          <h2 style={{ margin: '0.35rem 0 0', fontSize: '1.85rem', fontWeight: 900, color: '#0f172a' }}>
            RD$ {totalAmount.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
          </h2>
          <span style={{ fontSize: '0.725rem', color: '#64748b' }}>{filteredDiscounts.length} registros en el periodo</span>
        </div>

        <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '16px', border: '1px solid #fee2e2' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#dc2626', textTransform: 'uppercase' }}>Pendiente por Descontar</span>
          <h2 style={{ margin: '0.35rem 0 0', fontSize: '1.85rem', fontWeight: 900, color: '#dc2626' }}>
            RD$ {totalPending.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
          </h2>
          <span style={{ fontSize: '0.725rem', color: '#b91c1c', fontWeight: 700 }}>{countPending} deducciones pendientes de nómina</span>
        </div>

        <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '16px', border: '1px solid #bbf7d0' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#16a34a', textTransform: 'uppercase' }}>Aplicado en Nómina</span>
          <h2 style={{ margin: '0.35rem 0 0', fontSize: '1.85rem', fontWeight: 900, color: '#16a34a' }}>
            RD$ {totalApplied.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
          </h2>
          <span style={{ fontSize: '0.725rem', color: '#15803d', fontWeight: 600 }}>Deducciones liquidadas / cobradas</span>
        </div>
      </div>

      {/* FILTER BAR */}
      <div style={{ background: '#ffffff', padding: '1rem 1.25rem', borderRadius: '16px', border: '1px solid #e2e8f0', marginBottom: '1.5rem', display: 'flex', gap: '0.85rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
          <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          <input
            type="text"
            placeholder="Buscar por colaborador o concepto..."
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

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <Calendar size={16} color="#64748b" />
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{ padding: '0.45rem 0.55rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.8rem', fontWeight: 700 }}
          />
          <span style={{ color: '#94a3b8' }}>-</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{ padding: '0.45rem 0.55rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.8rem', fontWeight: 700 }}
          />
        </div>

        <button
          type="button"
          onClick={handleFilter}
          style={{ padding: '0.55rem 1.25rem', borderRadius: '10px', background: '#09090b', color: '#ffffff', border: 'none', fontSize: '0.825rem', fontWeight: 800, cursor: 'pointer' }}
        >
          Filtrar
        </button>
      </div>

      {/* TABLE */}
      <div style={{ background: '#ffffff', borderRadius: '20px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
        <div className="table-responsive">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'left', fontSize: '0.725rem', textTransform: 'uppercase' }}>
                <th style={{ padding: '0.85rem 0.75rem', fontWeight: 800 }}>Colaborador</th>
                <th style={{ padding: '0.85rem 0.75rem', fontWeight: 800 }}>Tipo de Deducción</th>
                <th style={{ padding: '0.85rem 0.75rem', fontWeight: 800 }}>Fecha</th>
                <th style={{ padding: '0.85rem 0.75rem', fontWeight: 800, textAlign: 'right' }}>Monto</th>
                <th style={{ padding: '0.85rem 0.75rem', fontWeight: 800 }}>Notas / Detalle</th>
                <th style={{ padding: '0.85rem 0.75rem', fontWeight: 800, textAlign: 'center' }}>Estatus</th>
                <th style={{ padding: '0.85rem 0.75rem', fontWeight: 800, textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7" style={{ padding: '4rem 1rem', textAlign: 'center', color: '#64748b' }}>
                    <RefreshCw size={24} className="spin" style={{ margin: '0 auto 0.5rem' }} />
                    <p style={{ margin: 0, fontWeight: 700 }}>Cargando deducciones...</p>
                  </td>
                </tr>
              ) : filteredDiscounts.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ padding: '4rem 1rem', textAlign: 'center', color: '#64748b' }}>
                    <p style={{ margin: 0, fontWeight: 800, fontSize: '1rem', color: '#0f172a' }}>No hay registros de descuentos de empleados</p>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}>Haz clic en "+ Registrar Descuento" para añadir una deducción o préstamo.</p>
                  </td>
                </tr>
              ) : (
                filteredDiscounts.map((item) => {
                  const typeObj = DISCOUNT_TYPES.find(t => t.id === item.type) || DISCOUNT_TYPES[0];
                  const Icon = typeObj.icon;
                  const isPending = item.status === 'Pendiente';

                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.85rem 0.75rem' }}>
                        <strong style={{ color: '#0f172a', display: 'block', fontSize: '0.85rem' }}>{item.employee_name}</strong>
                        <span style={{ fontSize: '0.725rem', color: '#64748b' }}>{item.employee_position || item.localidad || 'Colaborador'}</span>
                      </td>

                      <td style={{ padding: '0.85rem 0.75rem' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#f8fafc', padding: '3px 8px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '0.75rem', fontWeight: 700, color: typeObj.color }}>
                          <Icon size={13} />
                          <span>{typeObj.label}</span>
                        </div>
                      </td>

                      <td style={{ padding: '0.85rem 0.75rem', color: '#475569', fontWeight: 600 }}>
                        {item.date ? new Date(item.date).toLocaleDateString('es-DO') : 'N/A'}
                      </td>

                      <td style={{ padding: '0.85rem 0.75rem', textAlign: 'right', fontWeight: 900, color: '#dc2626', fontSize: '0.9rem' }}>
                        - RD$ {Number(item.amount || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </td>

                      <td style={{ padding: '0.85rem 0.75rem', color: '#475569', maxWidth: '240px' }}>
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.notes}>
                          {item.notes || '(Sin observaciones)'}
                        </span>
                      </td>

                      <td style={{ padding: '0.85rem 0.75rem', textAlign: 'center' }}>
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

                      <td style={{ padding: '0.85rem 0.75rem', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(item)}
                            style={{ background: '#f8fafc', border: '1px solid #cbd5e1', padding: '0.35rem', borderRadius: '6px', cursor: 'pointer', color: '#0f172a' }}
                            title="Editar"
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteDiscount(item.id)}
                            style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '0.35rem', borderRadius: '6px', cursor: 'pointer', color: '#dc2626' }}
                            title="Eliminar"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ================= MODAL CREATE / EDIT ================= */}
      {showModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1050, padding: '1rem' }}>
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
                    Monto (RD$) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    placeholder="Ej. 1500.00"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.85rem', fontWeight: 800 }}
                  />
                </div>
              </div>

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
                  placeholder="Detalle o motivo del descuento/préstamo..."
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
