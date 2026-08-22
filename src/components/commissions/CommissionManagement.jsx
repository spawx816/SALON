import React, { useState, useEffect } from 'react';
import { 
  Percent, DollarSign, Calendar, User, Filter, CheckCircle2, Clock, 
  CreditCard, Search, ArrowRight, ShieldCheck, Download, Plus, FileText, CheckSquare, Square
} from 'lucide-react';
import { dataService } from '../../utils/dataService';

const CommissionManagement = () => {
  const [commissions, setCommissions] = useState([]);
  const [metrics, setMetrics] = useState({ totalGenerado: 0, totalPendiente: 0, totalPagado: 0, count: 0 });
  const [employees, setEmployees] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Active Tab
  const [activeTab, setActiveTab] = useState('pendientes'); // 'pendientes' | 'liquidaciones' | 'reglas'

  // Filters
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [statusFilter, setStatusFilter] = useState('Todos');
  const [serviceSearch, setServiceSearch] = useState('');

  // Selection for Payout
  const [selectedCommissions, setSelectedCommissions] = useState([]);
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [payoutMethod, setPayoutMethod] = useState('Efectivo');
  const [payoutNotes, setPayoutNotes] = useState('');

  // Rules Config State
  const [rules, setRules] = useState([]);
  const [ruleEmployee, setRuleEmployee] = useState('');
  const [ruleService, setRuleService] = useState('General');
  const [ruleType, setRuleType] = useState('Porcentaje');
  const [ruleValue, setRuleValue] = useState('');

  useEffect(() => {
    loadEmployees();
    loadCommissions();
    loadPayouts();
    loadRules();
  }, [startDate, endDate, selectedEmployee, statusFilter, serviceSearch]);

  const loadEmployees = async () => {
    try {
      const data = await dataService.getEmployees();
      setEmployees(data || []);
    } catch (e) {
      console.error('Error cargando empleados:', e);
    }
  };

  const loadCommissions = async () => {
    setLoading(true);
    try {
      const params = {};
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      if (selectedEmployee) params.employee_id = selectedEmployee;
      if (statusFilter !== 'Todos') params.status = statusFilter;
      if (serviceSearch) params.service_name = serviceSearch;

      const res = await dataService.getCommissions(params);
      setCommissions(res.commissions || []);
      setMetrics(res.metrics || { totalGenerado: 0, totalPendiente: 0, totalPagado: 0, count: 0 });
    } catch (e) {
      console.error('Error cargando comisiones:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadPayouts = async () => {
    try {
      const data = await dataService.getCommissionPayouts();
      setPayouts(data || []);
    } catch (e) {
      console.error('Error cargando historial de liquidaciones:', e);
    }
  };

  const loadRules = async () => {
    try {
      const res = await fetch('http://127.0.0.1:5005/api/commissions/rules');
      if (res.ok) {
        const data = await res.json();
        setRules(data || []);
      }
    } catch (e) {}
  };

  const toggleSelectCommission = (id) => {
    if (selectedCommissions.includes(id)) {
      setSelectedCommissions(selectedCommissions.filter(item => item !== id));
    } else {
      setSelectedCommissions([...selectedCommissions, id]);
    }
  };

  const toggleSelectAll = () => {
    const pendingIds = commissions.filter(c => c.status === 'Pendiente').map(c => c.id);
    if (selectedCommissions.length === pendingIds.length && pendingIds.length > 0) {
      setSelectedCommissions([]);
    } else {
      setSelectedCommissions(pendingIds);
    }
  };

  const handleProcessPayout = async (e) => {
    e.preventDefault();
    if (selectedCommissions.length === 0) {
      alert('Por favor selecciona al menos una comisión pendiente.');
      return;
    }

    // Identify target employee
    const selectedItems = commissions.filter(c => selectedCommissions.includes(c.id));
    const targetEmpId = selectedItems[0].employee_id;
    const targetEmpName = selectedItems[0].employee_name;

    // Verify all selected items belong to the same employee
    const multiEmp = selectedItems.some(c => c.employee_id !== targetEmpId);
    if (multiEmp) {
      alert('Para procesar un pago de comisión, todas las líneas seleccionadas deben pertenecer al mismo colaborador.');
      return;
    }

    setLoading(true);
    try {
      const res = await dataService.processCommissionPayout({
        employee_id: targetEmpId,
        employee_name: targetEmpName,
        commission_ids: selectedCommissions,
        metodo_pago: payoutMethod,
        notas: payoutNotes,
        usuario_liquidador: 'Administrador'
      });

      alert(res.message || '✅ Liquidación registrada exitosamente.');
      setShowPayoutModal(false);
      setSelectedCommissions([]);
      setPayoutNotes('');
      await loadCommissions();
      await loadPayouts();
    } catch (err) {
      alert('Error procesando liquidación: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRule = async (e) => {
    e.preventDefault();
    if (!ruleEmployee) {
      alert('Por favor selecciona un colaborador.');
      return;
    }
    const val = parseFloat(ruleValue);
    if (isNaN(val) || val <= 0) {
      alert('Por favor ingresa un valor de comisión válido.');
      return;
    }

    setLoading(true);
    try {
      const res = await dataService.saveCommissionRule({
        employee_id: ruleEmployee,
        service_name: ruleService,
        tipo_comision: ruleType,
        comision_valor: val
      });
      alert(res.message || '✅ Regla guardada exitosamente.');
      setRuleValue('');
      await loadRules();
    } catch (e) {
      alert('Error guardando regla: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // Selected totals for Payout modal
  const selectedItemsList = commissions.filter(c => selectedCommissions.includes(c.id));
  const selectedTotalAmount = selectedItemsList.reduce((sum, item) => sum + Number(item.monto_comision), 0);

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '1.5rem' }}>
      
      {/* HEADER BANNER */}
      <div style={{ background: '#0f172a', color: '#ffffff', padding: '1.5rem 2rem', borderRadius: '20px', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 10px 25px -5px rgba(15,23,42,0.3)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.25rem' }}>
            <Percent size={24} style={{ color: '#be185d' }} />
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.5px' }}>
              Módulo de Comisiones y Liquidación a Colaboradores
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#94a3b8' }}>
            Cálculo automático en facturación POS, control por colaborador y registro de pagos de nómina.
          </p>
        </div>

        {selectedCommissions.length > 0 && (
          <button
            onClick={() => setShowPayoutModal(true)}
            style={{
              background: '#166534', color: '#ffffff', border: 'none', padding: '0.75rem 1.5rem',
              borderRadius: '12px', fontWeight: 800, fontSize: '0.9rem', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: '0 4px 12px rgba(22,101,52,0.3)'
            }}
            className="hover-lift"
          >
            <DollarSign size={18} />
            <span>Liquidación Seleccionada (RD$ {selectedTotalAmount.toFixed(2)})</span>
          </button>
        )}
      </div>

      {/* METRICS SUMMARY CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem' }}>
          <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>💰 TOTAL COMISIONES GENERADAS</span>
          <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#0f172a', marginTop: '0.25rem' }}>
            RD$ {metrics.totalGenerado.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
          </div>
          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{metrics.count} registros evaluados</span>
        </div>

        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '16px', padding: '1.25rem' }}>
          <span style={{ fontSize: '0.75rem', color: '#b45309', fontWeight: 800, textTransform: 'uppercase' }}>🟡 PENDIENTE DE LIQUIDACIÓN</span>
          <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#d97706', marginTop: '0.25rem' }}>
            RD$ {metrics.totalPendiente.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
          </div>
          <span style={{ fontSize: '0.75rem', color: '#b45309' }}>Elegible para pago de nómina</span>
        </div>

        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '16px', padding: '1.25rem' }}>
          <span style={{ fontSize: '0.75rem', color: '#15803d', fontWeight: 800, textTransform: 'uppercase' }}>🟢 COMISIONES LIQUIDADAS (PAGADAS)</span>
          <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#166534', marginTop: '0.25rem' }}>
            RD$ {metrics.totalPagado.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
          </div>
          <span style={{ fontSize: '0.75rem', color: '#166534' }}>Pagadas con recibo emitido</span>
        </div>
      </div>

      {/* NAVIGATION TABS */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', background: '#e2e8f0', padding: '4px', borderRadius: '12px', width: 'fit-content' }}>
        {[
          { id: 'pendientes', label: '📋 Registro de Comisiones' },
          { id: 'liquidaciones', label: '🟢 Historial de Liquidaciones / Pagos' },
          { id: 'reglas', label: '⚙️ Reglas Específicas por Empleado' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '0.65rem 1.25rem',
              borderRadius: '9px',
              border: 'none',
              background: activeTab === tab.id ? '#ffffff' : 'transparent',
              color: activeTab === tab.id ? '#be185d' : '#475569',
              fontWeight: 800,
              fontSize: '0.85rem',
              cursor: 'pointer',
              boxShadow: activeTab === tab.id ? '0 2px 4px rgba(0,0,0,0.08)' : 'none'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: REGISTRO Y FILTROS DE COMISIONES */}
      {activeTab === 'pendientes' && (
        <div>
          {/* FILTERS TOOLBAR */}
          <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '16px', border: '1px solid #e2e8f0', marginBottom: '1.5rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
            
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

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}>Estado:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ padding: '0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.8rem', fontWeight: 700 }}
              >
                <option value="Todos">Todos</option>
                <option value="Pendiente">🟡 Pendientes</option>
                <option value="Pagado">🟢 Liquidadas / Pagadas</option>
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
          <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
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
                    <th style={{ padding: '0.75rem 1rem', width: '40px' }}>
                      <button onClick={toggleSelectAll} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                        {selectedCommissions.length > 0 ? <CheckSquare size={18} style={{ color: '#be185d' }} /> : <Square size={18} style={{ color: '#94a3b8' }} />}
                      </button>
                    </th>
                    <th style={{ padding: '0.75rem 1rem' }}>Ticket</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Fecha</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Colaborador</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Servicio Realizado</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Monto Base</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Regla Aplicada</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Comisión Ganada</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((c) => (
                    <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9', background: selectedCommissions.includes(c.id) ? '#fdf2f8' : 'transparent' }}>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        {c.status === 'Pendiente' ? (
                          <button onClick={() => toggleSelectCommission(c.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                            {selectedCommissions.includes(c.id) ? <CheckSquare size={18} style={{ color: '#be185d' }} /> : <Square size={18} style={{ color: '#cbd5e1' }} />}
                          </button>
                        ) : (
                          <CheckCircle2 size={16} style={{ color: '#16a34a' }} />
                        )}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 800, color: '#0f172a' }}>
                        {c.ticket_number || `TK-${c.visit_id}`}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: '#64748b', fontSize: '0.78rem' }}>
                        {new Date(c.created_at).toLocaleDateString('es-DO')} {new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 800, color: '#be185d' }}>
                        👤 {c.employee_name}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: '#334155', fontWeight: 700 }}>
                        {c.service_name} (x{c.cantidad})
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#64748b' }}>
                        RD$ {Number(c.monto_base).toFixed(2)}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                        <span style={{ background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 800 }}>
                          {c.tipo_comision === 'Porcentaje' ? `${c.comision_valor}%` : `RD$ ${c.comision_valor}`}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 900, color: '#15803d', fontSize: '0.95rem' }}>
                        RD$ {Number(c.monto_comision).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                        <span style={{
                          padding: '3px 10px', borderRadius: '12px', fontSize: '0.72rem', fontWeight: 800,
                          background: c.status === 'Pendiente' ? '#fffbeb' : '#dcfce7',
                          color: c.status === 'Pendiente' ? '#b45309' : '#15803d',
                          border: `1px solid ${c.status === 'Pendiente' ? '#fde68a' : '#86efac'}`
                        }}>
                          {c.status === 'Pendiente' ? '🟡 PENDIENTE' : '🟢 PAGADO'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: HISTORIAL DE LIQUIDACIONES / PAGOS EMITIDOS */}
      {activeTab === 'liquidaciones' && (
        <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '1.25rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>
            🟢 Historial de Recibos y Liquidaciones de Nómina
          </h3>

          {payouts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
              No se han realizado liquidaciones de comisiones todavía.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 800 }}>
                  <th style={{ padding: '0.75rem 1rem' }}>No. Recibo</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Fecha de Pago</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Colaborador Beneficiario</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Servicios Liquidados</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Método de Pago</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Monto Total Pagado</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Emitido Por</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.75rem 1rem', fontWeight: 800, color: '#0f172a' }}>{p.payout_number}</td>
                    <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>
                      {new Date(p.created_at).toLocaleDateString('es-DO')} {new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', fontWeight: 800, color: '#be185d' }}>👤 {p.employee_name}</td>
                    <td style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 700 }}>{p.total_items} ítems de comisión</td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span style={{ background: '#f1f5f9', color: '#334155', padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 800 }}>
                        {p.metodo_pago}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 900, color: '#166534', fontSize: '1rem' }}>
                      RD$ {Number(p.monto_total).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#64748b', fontSize: '0.78rem' }}>{p.usuario_liquidador || 'Admin'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* TAB 3: REGLAS ESPECÍFICAS DE COMISIÓN */}
      {activeTab === 'reglas' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1.5rem' }}>
          
          {/* FORM: AGREGAR / ACTUALIZAR REGLA */}
          <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '1.25rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>
              ⚙️ Asignar Comisión Específica
            </h3>

            <form onSubmit={handleSaveRule}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>
                  Colaborador *:
                </label>
                <select
                  required
                  value={ruleEmployee}
                  onChange={(e) => setRuleEmployee(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                >
                  <option value="">Selecciona un colaborador...</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>
                  Servicio (o General para todos):
                </label>
                <input
                  type="text"
                  placeholder="General"
                  value={ruleService}
                  onChange={(e) => setRuleService(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>
                    Esquema:
                  </label>
                  <select
                    value={ruleType}
                    onChange={(e) => setRuleType(e.target.value)}
                    style={{ width: '100%', padding: '0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                  >
                    <option value="Porcentaje">Porcentaje (%)</option>
                    <option value="Monto_Fijo">Monto Fijo (RD$)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>
                    Valor *:
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="20"
                    value={ruleValue}
                    onChange={(e) => setRuleValue(e.target.value)}
                    style={{ width: '100%', padding: '0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 800 }}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: 'none', background: '#be185d', color: '#ffffff', fontWeight: 800, cursor: 'pointer' }}
              >
                💾 Guardar Esquema de Comisión
              </button>
            </form>
          </div>

          {/* TABLE: REGLAS REGISTRADAS */}
          <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '1.25rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>
              📋 Reglas de Comisión Configuradas
            </h3>

            {rules.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                No hay reglas personalizadas activas. Se aplicarán los valores por defecto del catálogo de servicios.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 800 }}>
                    <th style={{ padding: '0.6rem 0.75rem' }}>ID Empleado</th>
                    <th style={{ padding: '0.6rem 0.75rem' }}>Servicio Aplica</th>
                    <th style={{ padding: '0.6rem 0.75rem' }}>Tipo</th>
                    <th style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>Valor Asignado</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.6rem 0.75rem', fontWeight: 800, color: '#0f172a' }}>{r.employee_id}</td>
                      <td style={{ padding: '0.6rem 0.75rem', color: '#be185d', fontWeight: 700 }}>{r.service_name}</td>
                      <td style={{ padding: '0.6rem 0.75rem', color: '#64748b' }}>{r.tipo_comision}</td>
                      <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', fontWeight: 900, color: '#166534' }}>
                        {r.tipo_comision === 'Porcentaje' ? `${r.comision_valor}%` : `RD$ ${r.comision_valor}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

        </div>
      )}

      {/* MODAL PROCESAR LIQUIDACIÓN DE COMISIÓN */}
      {showPayoutModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: '480px', borderRadius: '20px', padding: '1.75rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
              <DollarSign size={38} style={{ color: '#166534', marginBottom: '0.4rem' }} />
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                Liquidación de Comisiones
              </h3>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                Se liquidarán <strong>{selectedCommissions.length} ítems</strong> de comisión para {selectedItemsList[0]?.employee_name}
              </p>
            </div>

            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '1rem', borderRadius: '12px', textAlign: 'center', marginBottom: '1.25rem' }}>
              <span style={{ fontSize: '0.75rem', color: '#166534', fontWeight: 800, textTransform: 'uppercase' }}>MONTO TOTAL A PAGAR EN NÓMINA:</span>
              <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#15803d', marginTop: '0.2rem' }}>
                RD$ {selectedTotalAmount.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
              </div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#334155', marginBottom: '0.25rem' }}>
                Método de Pago Empleado:
              </label>
              <select
                value={payoutMethod}
                onChange={(e) => setPayoutMethod(e.target.value)}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 800 }}
              >
                <option value="Efectivo">💵 Efectivo</option>
                <option value="Transferencia">🏦 Transferencia Bancaria</option>
                <option value="Cheque">📜 Cheque de Nómina</option>
              </select>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
                Notas / Referencia de Pago:
              </label>
              <textarea
                rows={2}
                placeholder="Ej: Pago quincenal de comisiones, transferencia ref #98341..."
                value={payoutNotes}
                onChange={(e) => setPayoutNotes(e.target.value)}
                style={{ width: '100%', padding: '0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 600, fontSize: '0.85rem' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setShowPayoutModal(false)}
                style={{ flex: 1, padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', background: '#ffffff', fontWeight: 700, cursor: 'pointer', color: '#475569' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleProcessPayout}
                disabled={loading}
                style={{ flex: 1, padding: '0.75rem', borderRadius: '10px', border: 'none', background: '#166534', color: '#ffffff', fontWeight: 800, cursor: 'pointer' }}
              >
                Confirmar Pago y Emitir Recibo
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default CommissionManagement;
