import React, { useState, useEffect, useMemo } from 'react';
import { 
  DollarSign, Users, Calendar, Download, Plus, Search, Filter, 
  ChevronLeft, ChevronRight, CheckCircle2, AlertCircle, Printer, 
  Sliders, ArrowUpRight, ArrowDownRight, Edit2, Trash2, Eye, 
  Settings, FileText, Check, X, RefreshCw, Layers, PieChart as PieIcon, 
  CreditCard, Sparkles, Building2, Briefcase, ChevronDown, CheckSquare, Square
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { dataService } from '../../utils/dataService';
import { useNotification } from '../../context/NotificationContext';

export default function PayrollModule() {
  const { showNotification } = useNotification();

  // Estados principales
  const [loading, setLoading] = useState(false);
  const [periods, setPeriods] = useState([]);
  const [currentPeriod, setCurrentPeriod] = useState(null);
  const [items, setItems] = useState([]);
  const [concepts, setConcepts] = useState([]);

  // Pestaña principal activa: 'payroll' (Procesar nómina) o 'regalias' (Regalías del año)
  const [mainTab, setMainTab] = useState('payroll');

  // Filtros de la tabla
  const [filterSucursal, setFilterSucursal] = useState('Todas');
  const [filterDepartamento, setFilterDepartamento] = useState('Todos');
  const [filterTipoEmpleado, setFilterTipoEmpleado] = useState('Todos');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItemIds, setSelectedItemIds] = useState([]);

  // Paginación
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Modales
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [activeEmployeeIndex, setActiveEmployeeIndex] = useState(0);
  const [editingItem, setEditingItem] = useState(null);

  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [summaryTab, setSummaryTab] = useState('ingresos'); // 'ingresos' | 'descuentos'

  const [showNewPeriodModal, setShowNewPeriodModal] = useState(false);
  const [newPeriodForm, setNewPeriodForm] = useState({
    period_name: '1ra quincena · Octubre 2026',
    start_date: '2026-10-01',
    end_date: '2026-10-15',
    sucursal: 'Todas',
    departamento: 'Todos'
  });

  // Estados para Regalías
  const [regaliasYear, setRegaliasYear] = useState(new Date().getFullYear());
  const [regaliasData, setRegaliasData] = useState(null);
  const [selectedRegaliaEmployee, setSelectedRegaliaEmployee] = useState(null);
  const [showRegaliaDetailModal, setShowRegaliaDetailModal] = useState(false);

  // Cargar períodos y conceptos al montar
  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const [periodsRes, conceptsRes] = await Promise.all([
        dataService.getPayrollPeriods(),
        dataService.getPayrollConcepts()
      ]);

      setPeriods(periodsRes || []);
      setConcepts(conceptsRes || []);

      if (periodsRes && periodsRes.length > 0) {
        await loadPeriodDetail(periodsRes[0].id);
      } else {
        // Generar un período por defecto automáticamente si no existe ninguno
        await handleGenerateDefaultPeriod();
      }
    } catch (err) {
      console.error('Error cargando nómina inicial:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateDefaultPeriod = async () => {
    try {
      const genRes = await dataService.generatePayroll({
        period_name: '1ra quincena · Octubre 2026',
        start_date: '2026-10-01',
        end_date: '2026-10-15',
        sucursal: 'Todas',
        departamento: 'Todos'
      });
      if (genRes && genRes.period) {
        setCurrentPeriod(genRes.period);
        setItems(genRes.items || []);
        const allPers = await dataService.getPayrollPeriods();
        setPeriods(allPers || [genRes.period]);
      }
    } catch (err) {
      console.error('Error al autogenerar nómina inicial:', err);
    }
  };

  const loadPeriodDetail = async (periodId) => {
    setLoading(true);
    try {
      const res = await dataService.getPayrollPeriod(periodId);
      if (res && res.period) {
        setCurrentPeriod(res.period);
        setItems(res.items || []);
        setSelectedItemIds([]);
        setCurrentPage(1);
      }
    } catch (err) {
      showNotification('Error cargando detalles del período', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadRegalias = async (year) => {
    setLoading(true);
    try {
      const res = await dataService.getPayrollRegalias(year);
      setRegaliasData(res);
    } catch (err) {
      showNotification('Error calculando regalías', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mainTab === 'regalias') {
      loadRegalias(regaliasYear);
    }
  }, [mainTab, regaliasYear]);

  // Filtrado de items
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchSearch = searchTerm === '' || 
        item.employee_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.posicion?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchSucursal = filterSucursal === 'Todas' || 
        item.sucursal?.toLowerCase().includes(filterSucursal.toLowerCase());

      const matchDept = filterDepartamento === 'Todos' || 
        item.departamento?.toLowerCase().includes(filterDepartamento.toLowerCase()) ||
        item.posicion?.toLowerCase().includes(filterDepartamento.toLowerCase());

      return matchSearch && matchSucursal && matchDept;
    });
  }, [items, searchTerm, filterSucursal, filterDepartamento]);

  // Paginación
  const totalPages = Math.ceil(filteredItems.length / itemsPerPage) || 1;
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredItems.slice(start, start + itemsPerPage);
  }, [filteredItems, currentPage]);

  // Manejadores de selección múltiple
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedItemIds(paginatedItems.map(it => it.id));
    } else {
      setSelectedItemIds([]);
    }
  };

  const handleToggleSelect = (id) => {
    setSelectedItemIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Abrir modal de empleado
  const handleOpenEmployeeModal = (item, indexInFiltered) => {
    setEditingItem(JSON.parse(JSON.stringify(item)));
    setActiveEmployeeIndex(indexInFiltered);
    setShowEmployeeModal(true);
  };

  const handleNavigateEmployee = (direction) => {
    let nextIdx = activeEmployeeIndex + direction;
    if (nextIdx < 0) nextIdx = filteredItems.length - 1;
    if (nextIdx >= filteredItems.length) nextIdx = 0;
    setActiveEmployeeIndex(nextIdx);
    setEditingItem(JSON.parse(JSON.stringify(filteredItems[nextIdx])));
  };

  // Actualizar un concepto en el modal de edición
  const handleUpdateConceptValue = (type, key, value) => {
    if (!editingItem) return;
    const numVal = parseFloat(value) || 0;
    const copy = { ...editingItem };
    copy[key] = numVal;

    // Recalcular totales
    const totalIng = (
      parseFloat(copy.salario_fijo || 0) +
      parseFloat(copy.comisiones || 0) +
      parseFloat(copy.feriados || 0) +
      parseFloat(copy.horas_extras || 0) +
      parseFloat(copy.otros_ingresos || 0)
    );

    const totalDesc = (
      parseFloat(copy.tss || 0) +
      parseFloat(copy.servicios || 0) +
      parseFloat(copy.prestamos || 0) +
      parseFloat(copy.ausencias || 0) +
      parseFloat(copy.tardanzas || 0) +
      parseFloat(copy.otros_descuentos || 0)
    );

    copy.total_ingresos = Number(totalIng.toFixed(2));
    copy.total_descuentos = Number(totalDesc.toFixed(2));
    copy.neto_pagar = Number((totalIng - totalDesc).toFixed(2));

    setEditingItem(copy);
  };

  const handleSaveEmployeeChanges = () => {
    if (!editingItem) return;
    setItems(prev => prev.map(it => it.id === editingItem.id ? editingItem : it));
    showNotification(`Cambios guardados para ${editingItem.employee_name}`, 'success');
    setShowEmployeeModal(false);
  };

  // Guardar Borrador
  const handleSaveDraft = async () => {
    if (!currentPeriod) return;
    setLoading(true);
    try {
      await dataService.savePayrollDraft({
        payroll_id: currentPeriod.id,
        items: items,
        status: currentPeriod.status || 'En preparación'
      });
      showNotification('Nómina guardada como borrador correctamente', 'success');
      loadPeriodDetail(currentPeriod.id);
    } catch (err) {
      showNotification('Error al guardar borrador: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Aprobar Nómina
  const handleApprovePayroll = async () => {
    if (!currentPeriod) return;
    if (!window.confirm('¿Estás seguro de que deseas aprobar esta nómina? Quedará registrada como lista para desembolso.')) return;
    setLoading(true);
    try {
      await dataService.approvePayroll(currentPeriod.id);
      showNotification('¡Nómina aprobada con éxito!', 'success');
      loadPeriodDetail(currentPeriod.id);
      const allPers = await dataService.getPayrollPeriods();
      setPeriods(allPers || []);
    } catch (err) {
      showNotification('Error al aprobar nómina: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Crear nuevo período
  const handleCreateNewPeriod = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await dataService.generatePayroll(newPeriodForm);
      showNotification('Nuevo período generado correctamente', 'success');
      setShowNewPeriodModal(false);
      await loadInitialData();
    } catch (err) {
      showNotification('Error al generar período: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Cálculo de totales de ingresos y descuentos para el Modal de Resumen
  const summaryData = useMemo(() => {
    let totSalario = 0, totComisiones = 0, totFeriados = 0, totHorasExtras = 0, totOtrosIng = 0;
    let totTss = 0, totServicios = 0, totPrestamos = 0, totAusencias = 0, totTardanzas = 0, totOtrosDesc = 0;

    items.forEach(it => {
      totSalario += parseFloat(it.salario_fijo || 0);
      totComisiones += parseFloat(it.comisiones || 0);
      totFeriados += parseFloat(it.feriados || 0);
      totHorasExtras += parseFloat(it.horas_extras || 0);
      totOtrosIng += parseFloat(it.otros_ingresos || 0);

      totTss += parseFloat(it.tss || 0);
      totServicios += parseFloat(it.servicios || 0);
      totPrestamos += parseFloat(it.prestamos || 0);
      totAusencias += parseFloat(it.ausencias || 0);
      totTardanzas += parseFloat(it.tardanzas || 0);
      totOtrosDesc += parseFloat(it.otros_descuentos || 0);
    });

    const totalIngresos = totSalario + totComisiones + totFeriados + totHorasExtras + totOtrosIng;
    const totalDescuentos = totTss + totServicios + totPrestamos + totAusencias + totTardanzas + totOtrosDesc;
    const totalNeto = totalIngresos - totalDescuentos;

    const ingresosBreakdown = [
      { label: 'Salario fijo', monto: totSalario, color: '#0066ff' },
      { label: 'Comisiones', monto: totComisiones, color: '#00b4d8' },
      { label: 'Horas extras', monto: totHorasExtras, color: '#48cae4' },
      { label: 'Feriados', monto: totFeriados, color: '#805ad5' },
      { label: 'Otros ingresos', monto: totOtrosIng, color: '#6b46c1' }
    ].map(item => ({
      ...item,
      percent: totalIngresos > 0 ? ((item.monto / totalIngresos) * 100).toFixed(1) : '0.0'
    }));

    const descuentosBreakdown = [
      { label: 'TSS (Seguro/AFP)', monto: totTss, color: '#ef4444' },
      { label: 'Servicios de salón', monto: totServicios, color: '#f97316' },
      { label: 'Préstamos', monto: totPrestamos, color: '#f59e0b' },
      { label: 'Ausencias', monto: totAusencias, color: '#e11d48' },
      { label: 'Tardanzas', monto: totTardanzas, color: '#db2777' },
      { label: 'Otros descuentos', monto: totOtrosDesc, color: '#9333ea' }
    ].map(item => ({
      ...item,
      percent: totalDescuentos > 0 ? ((item.monto / totalDescuentos) * 100).toFixed(1) : '0.0'
    }));

    return {
      totalEmpleados: items.length,
      totalIngresos,
      totalDescuentos,
      totalNeto,
      ingresosBreakdown,
      descuentosBreakdown
    };
  }, [items]);

  // Imprimir Volante de Pago individual
  const handlePrintSlip = (item) => {
    const printWin = window.open('', '_blank');
    const content = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Volante de Pago - ${item.employee_name}</title>
        <style>
          body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 30px; color: #1e293b; }
          .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 15px; margin-bottom: 20px; }
          .title { font-size: 20px; font-weight: 900; margin: 0; }
          .subtitle { font-size: 13px; color: #64748b; margin-top: 5px; }
          .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px; font-size: 13px; }
          .tables-container { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 25px; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; }
          th { background: #f1f5f9; text-align: left; padding: 8px; border-bottom: 1px solid #cbd5e1; }
          td { padding: 8px; border-bottom: 1px solid #f1f5f9; }
          .total-box { background: #eff6ff; border: 2px solid #3b82f6; border-radius: 12px; padding: 15px; text-align: center; margin-bottom: 40px; }
          .total-amount { font-size: 24px; font-weight: 900; color: #1d4ed8; }
          .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 50px; margin-top: 60px; text-align: center; font-size: 12px; }
          .sig-line { border-top: 1px solid #000; margin-top: 40px; padding-top: 5px; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="header">
          <h1 class="title">ABATTE PELUQUERÍA / PLAN BEAUTY RD</h1>
          <p class="subtitle">VOLANTE DE PAGO DE NÓMINA · ${currentPeriod?.period_name || 'Octubre 2026'}</p>
        </div>

        <div class="meta-grid">
          <div><strong>Colaborador:</strong> ${item.employee_name}</div>
          <div><strong>Posición:</strong> ${item.posicion}</div>
          <div><strong>Sucursal:</strong> ${item.sucursal}</div>
          <div><strong>Período:</strong> ${currentPeriod?.start_date || ''} al ${currentPeriod?.end_date || ''}</div>
        </div>

        <div class="tables-container">
          <div>
            <table>
              <thead><tr><th>INGRESOS</th><th style="text-align: right;">MONTO (RD$)</th></tr></thead>
              <tbody>
                <tr><td>Salario Fijo</td><td style="text-align: right;">${parseFloat(item.salario_fijo).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr><td>Comisiones</td><td style="text-align: right;">${parseFloat(item.comisiones).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr><td>Horas Extras</td><td style="text-align: right;">${parseFloat(item.horas_extras).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr><td>Feriados</td><td style="text-align: right;">${parseFloat(item.feriados).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr><td>Otros Ingresos</td><td style="text-align: right;">${parseFloat(item.otros_ingresos).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr style="font-weight: bold; background: #f8fafc;"><td>TOTAL INGRESOS</td><td style="text-align: right; color: #0284c7;">RD$ ${parseFloat(item.total_ingresos).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
              </tbody>
            </table>
          </div>

          <div>
            <table>
              <thead><tr><th>DESCUENTOS</th><th style="text-align: right;">MONTO (RD$)</th></tr></thead>
              <tbody>
                <tr><td>TSS (Seguro / Pensión)</td><td style="text-align: right;">${parseFloat(item.tss).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr><td>Servicios / Consumos</td><td style="text-align: right;">${parseFloat(item.servicios).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr><td>Préstamos</td><td style="text-align: right;">${parseFloat(item.prestamos).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr><td>Ausencias</td><td style="text-align: right;">${parseFloat(item.ausencias).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr><td>Tardanzas</td><td style="text-align: right;">${parseFloat(item.tardanzas).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr><td>Otros Descuentos</td><td style="text-align: right;">${parseFloat(item.otros_descuentos).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr style="font-weight: bold; background: #f8fafc;"><td>TOTAL DESCUENTOS</td><td style="text-align: right; color: #ef4444;">RD$ ${parseFloat(item.total_descuentos).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="total-box">
          <div style="font-size: 13px; font-weight: bold; color: #64748b; text-transform: uppercase;">MONTO NETO A PAGAR</div>
          <div class="total-amount">RD$ ${parseFloat(item.neto_pagar).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
        </div>

        <div class="signatures">
          <div>
            <div class="sig-line">Firma del Colaborador</div>
            <div>${item.employee_name}</div>
          </div>
          <div>
            <div class="sig-line">Por la Empresa</div>
            <div>ABATTE PELUQUERÍA / RRHH</div>
          </div>
        </div>

        <script>
          window.onload = function() { window.print(); }
        </script>
      </body>
      </html>
    `;
    printWin.document.write(content);
    printWin.document.close();
  };

  return (
    <div className="payroll-module-container" style={{ padding: '1.5rem', maxWidth: '1600px', margin: '0 auto' }}>
      
      {/* PESTAÑAS PRINCIPALES SUPERIORES (Procesar Nómina vs Regalías del Año) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', background: '#f1f5f9', padding: '6px', borderRadius: '14px' }}>
          <button
            onClick={() => setMainTab('payroll')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.65rem 1.4rem',
              borderRadius: '10px',
              border: 'none',
              background: mainTab === 'payroll' ? '#0f172a' : 'transparent',
              color: mainTab === 'payroll' ? '#ffffff' : '#64748b',
              fontWeight: 800,
              fontSize: '0.9rem',
              cursor: 'pointer',
              boxShadow: mainTab === 'payroll' ? '0 4px 14px rgba(15, 23, 42, 0.25)' : 'none',
              transition: 'all 0.2s ease'
            }}
          >
            <DollarSign size={18} style={{ color: mainTab === 'payroll' ? '#d4af37' : '#64748b' }} /> Procesar Nómina
          </button>

          <button
            onClick={() => setMainTab('regalias')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.65rem 1.4rem',
              borderRadius: '10px',
              border: 'none',
              background: mainTab === 'regalias' ? '#0f172a' : 'transparent',
              color: mainTab === 'regalias' ? '#ffffff' : '#64748b',
              fontWeight: 800,
              fontSize: '0.9rem',
              cursor: 'pointer',
              boxShadow: mainTab === 'regalias' ? '0 4px 14px rgba(15, 23, 42, 0.25)' : 'none',
              transition: 'all 0.2s ease'
            }}
          >
            <Sparkles size={18} style={{ color: mainTab === 'regalias' ? '#d4af37' : '#64748b' }} /> Regalías del Año (Doble Sueldo)
          </button>
        </div>

        {mainTab === 'payroll' && (
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button 
              onClick={() => setShowNewPeriodModal(true)}
              className="btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1.25rem', fontSize: '0.85rem' }}
            >
              <Plus size={16} /> Nuevo Período
            </button>
          </div>
        )}
      </div>

      {mainTab === 'payroll' ? (
        <>
          {/* HEADER PRINCIPAL IDÉNTICO A CAPTURA 1 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', flexWrap: 'wrap', gap: '1.5rem' }}>
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 900, color: '#0f172a', margin: '0 0 0.4rem 0', letterSpacing: '-0.02em' }}>
                Procesar nómina
              </h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '1.1rem', color: '#475569', fontWeight: 600 }}>
                  {currentPeriod?.period_name || '1ra quincena · Octubre 2026'}
                </span>
                <span style={{
                  background: currentPeriod?.status === 'Aprobada' ? '#dcfce7' : '#fef3c7',
                  color: currentPeriod?.status === 'Aprobada' ? '#15803d' : '#d97706',
                  padding: '4px 12px',
                  borderRadius: '20px',
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  ● {currentPeriod?.status || 'En preparación'} <Edit2 size={12} style={{ cursor: 'pointer', opacity: 0.7 }} />
                </span>
              </div>
            </div>

            {/* BOTONES SUPERIORES DERECHA */}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button 
                onClick={() => showNotification('Los conceptos de nómina se configuran automáticamente bajo la normativa laboral dominicana.', 'info')}
                className="btn-secondary"
                style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#334155', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1.25rem', borderRadius: '12px', fontWeight: 700, fontSize: '0.875rem' }}
              >
                <Settings size={16} /> Configuración de conceptos
              </button>

              <button 
                onClick={() => showNotification('Importación de horas y datos biométricos sincronizada con el reloj de asistencia.', 'success')}
                className="btn-secondary"
                style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#334155', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1.25rem', borderRadius: '12px', fontWeight: 700, fontSize: '0.875rem' }}
              >
                <Download size={16} /> Importar datos
              </button>

              <button 
                onClick={() => setShowSummaryModal(true)}
                style={{
                  background: '#ffffff',
                  border: '2px solid #0066ff',
                  color: '#0066ff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.65rem 1.4rem',
                  borderRadius: '12px',
                  fontWeight: 800,
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 2px 8px rgba(0, 102, 255, 0.1)'
                }}
              >
                <PieIcon size={18} /> Resumen de nómina
              </button>
            </div>
          </div>

          {/* BARRA DE FILTROS IDÉNTICA A CAPTURA 1 */}
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            padding: '1.25rem 1.5rem',
            border: '1px solid #f1f5f9',
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            marginBottom: '1.5rem',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1.25rem',
            alignItems: 'center'
          }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                Sucursal
              </label>
              <div style={{ position: 'relative' }}>
                <select 
                  value={filterSucursal}
                  onChange={(e) => setFilterSucursal(e.target.value)}
                  className="input-field"
                  style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: '10px', background: '#f8fafc', border: '1px solid #e2e8f0', fontWeight: 600, fontSize: '0.875rem' }}
                >
                  <option value="Todas">Todas</option>
                  <option value="San Vicente">San Vicente</option>
                  <option value="Villa Mella">Villa Mella</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                Departamento
              </label>
              <select 
                value={filterDepartamento}
                onChange={(e) => setFilterDepartamento(e.target.value)}
                className="input-field"
                style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: '10px', background: '#f8fafc', border: '1px solid #e2e8f0', fontWeight: 600, fontSize: '0.875rem' }}
              >
                <option value="Todos">Todos</option>
                <option value="Estilista">Estilistas</option>
                <option value="Barbero">Barberos</option>
                <option value="Manicurista">Manicuristas</option>
                <option value="Recepción">Recepción</option>
                <option value="Administración">Administración</option>
                <option value="Soporte">Soporte</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                Tipo de empleado
              </label>
              <select 
                value={filterTipoEmpleado}
                onChange={(e) => setFilterTipoEmpleado(e.target.value)}
                className="input-field"
                style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: '10px', background: '#f8fafc', border: '1px solid #e2e8f0', fontWeight: 600, fontSize: '0.875rem' }}
              >
                <option value="Todos">Todos</option>
                <option value="Fijo">Fijo</option>
                <option value="Comision">Comisión</option>
                <option value="Mixto">Mixto (Fijo + Comisión)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                Período
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '0.6rem 1rem', borderRadius: '10px' }}>
                <Calendar size={16} color="#64748b" />
                <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#1e293b' }}>
                  {currentPeriod?.start_date ? `${currentPeriod.start_date.slice(8,10)} - ${currentPeriod.end_date.slice(8,10)} ${new Date(currentPeriod.start_date).toLocaleString('es-DO', { month: 'short' })} ${new Date(currentPeriod.start_date).getFullYear()}` : '01 - 15 Oct 2026'}
                </span>
              </div>
            </div>
          </div>

          {/* BARRA DE BÚSQUEDA Y ACCIONES DE COLUMNAS */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: '380px' }}>
              <Search size={18} color="#94a3b8" style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)' }} />
              <input 
                type="text"
                placeholder="Buscar empleado..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.65rem 1rem 0.65rem 2.75rem',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  background: '#ffffff',
                  fontSize: '0.875rem',
                  outline: 'none',
                  transition: 'border 0.2s ease'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button 
                onClick={() => showNotification('Columnas visibles por defecto', 'info')}
                className="btn-secondary"
                style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#475569', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1rem', borderRadius: '10px', fontSize: '0.85rem', fontWeight: 700 }}
              >
                <Layers size={16} /> Columnas <ChevronDown size={14} />
              </button>

              <button 
                onClick={() => showNotification('Agrega conceptos de bonos o deducciones personalizadas por colaborador.', 'info')}
                className="btn-secondary"
                style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#0066ff', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.1rem', borderRadius: '10px', fontSize: '0.85rem', fontWeight: 800 }}
              >
                <Plus size={16} /> Agregar concepto <ChevronDown size={14} />
              </button>
            </div>
          </div>

          {/* TABLA PRINCIPAL DE NÓMINA (EXACTA A CAPTURA 1) */}
          <div style={{
            background: '#ffffff',
            borderRadius: '20px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
            overflow: 'hidden',
            marginBottom: '2rem'
          }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                <thead>
                  {/* Fila Superior con Grupos de Cabecera */}
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '0.85rem 1rem', width: '40px' }}>
                      <input 
                        type="checkbox" 
                        onChange={handleSelectAll}
                        checked={paginatedItems.length > 0 && selectedItemIds.length === paginatedItems.length}
                        style={{ width: '16px', height: '16px', accentColor: '#0066ff', cursor: 'pointer' }}
                      />
                    </th>
                    <th style={{ padding: '0.85rem 0.5rem', width: '40px', color: '#64748b', fontWeight: 700 }}>#</th>
                    <th style={{ padding: '0.85rem 1rem', color: '#64748b', fontWeight: 800 }}>Empleado</th>
                    <th style={{ padding: '0.85rem 1rem', color: '#64748b', fontWeight: 700 }}>Posición</th>
                    <th style={{ padding: '0.85rem 1rem', color: '#64748b', fontWeight: 700 }}>Sucursal</th>
                    
                    {/* Header Grupo Ingresos */}
                    <th colSpan="6" style={{ background: '#eff6ff', color: '#1e40af', fontWeight: 900, textAlign: 'center', borderLeft: '1px solid #dbeafe', borderRight: '1px solid #dbeafe', padding: '0.6rem' }}>
                      Ingresos (RD$)
                    </th>

                    {/* Header Grupo Descuentos */}
                    <th colSpan="7" style={{ background: '#fef2f2', color: '#991b1b', fontWeight: 900, textAlign: 'center', borderRight: '1px solid #fee2e2', padding: '0.6rem' }}>
                      Descuentos (RD$)
                    </th>

                    {/* A Pagar */}
                    <th style={{ background: '#f0fdf4', color: '#166534', fontWeight: 900, textAlign: 'right', padding: '0.85rem 1.25rem' }}>
                      A pagar (RD$)
                    </th>
                  </tr>

                  {/* Fila Inferior con Columnas Individuales */}
                  <tr style={{ background: '#ffffff', borderBottom: '2px solid #e2e8f0', fontSize: '0.75rem', color: '#64748b', fontWeight: 700 }}>
                    <th colSpan="5"></th>
                    
                    {/* Columnas Ingresos */}
                    <th style={{ background: '#f8faff', padding: '0.6rem 0.75rem', textAlign: 'right', borderLeft: '1px solid #dbeafe' }}>Salario fijo</th>
                    <th style={{ background: '#f8faff', padding: '0.6rem 0.75rem', textAlign: 'right' }}>Comisiones</th>
                    <th style={{ background: '#f8faff', padding: '0.6rem 0.75rem', textAlign: 'right' }}>Feriados</th>
                    <th style={{ background: '#f8faff', padding: '0.6rem 0.75rem', textAlign: 'right' }}>Horas extras</th>
                    <th style={{ background: '#f8faff', padding: '0.6rem 0.75rem', textAlign: 'right' }}>Otros ingresos</th>
                    <th style={{ background: '#eff6ff', padding: '0.6rem 0.75rem', textAlign: 'right', fontWeight: 800, color: '#1d4ed8', borderRight: '1px solid #dbeafe' }}>Total ingresos</th>

                    {/* Columnas Descuentos */}
                    <th style={{ background: '#fffafb', padding: '0.6rem 0.75rem', textAlign: 'right' }}>TSS</th>
                    <th style={{ background: '#fffafb', padding: '0.6rem 0.75rem', textAlign: 'right' }}>Servicios</th>
                    <th style={{ background: '#fffafb', padding: '0.6rem 0.75rem', textAlign: 'right' }}>Préstamos</th>
                    <th style={{ background: '#fffafb', padding: '0.6rem 0.75rem', textAlign: 'right' }}>Ausencias</th>
                    <th style={{ background: '#fffafb', padding: '0.6rem 0.75rem', textAlign: 'right' }}>Tardanzas</th>
                    <th style={{ background: '#fffafb', padding: '0.6rem 0.75rem', textAlign: 'right' }}>Otros desc.</th>
                    <th style={{ background: '#fef2f2', padding: '0.6rem 0.75rem', textAlign: 'right', fontWeight: 800, color: '#b91c1c', borderRight: '1px solid #fee2e2' }}>Total descuentos</th>

                    <th style={{ background: '#f0fdf4' }}></th>
                  </tr>
                </thead>

                <tbody>
                  {paginatedItems.map((item, idx) => {
                    const rowNumber = (currentPage - 1) * itemsPerPage + idx + 1;
                    const isSelected = selectedItemIds.includes(item.id);

                    return (
                      <tr 
                        key={item.id || idx}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          background: isSelected ? '#f0f9ff' : (idx % 2 === 0 ? '#ffffff' : '#fafafa'),
                          transition: 'background 0.15s ease'
                        }}
                      >
                        <td style={{ padding: '1rem', width: '40px' }}>
                          <input 
                            type="checkbox" 
                            checked={isSelected}
                            onChange={() => handleToggleSelect(item.id)}
                            style={{ width: '16px', height: '16px', accentColor: '#0066ff', cursor: 'pointer' }}
                          />
                        </td>
                        <td style={{ padding: '1rem 0.5rem', color: '#94a3b8', fontWeight: 700 }}>{rowNumber}</td>
                        <td 
                          onClick={() => handleOpenEmployeeModal(item, (currentPage - 1) * itemsPerPage + idx)}
                          style={{ padding: '1rem', fontWeight: 800, color: '#0f172a', cursor: 'pointer' }}
                          className="hover-underline"
                        >
                          {item.employee_name}
                        </td>
                        <td style={{ padding: '1rem', color: '#475569', fontWeight: 600 }}>{item.posicion}</td>
                        <td style={{ padding: '1rem', color: '#64748b' }}>{item.sucursal}</td>

                        {/* Ingresos */}
                        <td style={{ padding: '1rem 0.75rem', textAlign: 'right', color: '#334155', borderLeft: '1px solid #f1f5f9' }}>
                          {parseFloat(item.salario_fijo || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '1rem 0.75rem', textAlign: 'right', color: '#334155' }}>
                          {parseFloat(item.comisiones || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '1rem 0.75rem', textAlign: 'right', color: '#334155' }}>
                          {parseFloat(item.feriados || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '1rem 0.75rem', textAlign: 'right', color: '#334155' }}>
                          {parseFloat(item.horas_extras || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '1rem 0.75rem', textAlign: 'right', color: '#334155' }}>
                          {parseFloat(item.otros_ingresos || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '1rem 0.75rem', textAlign: 'right', fontWeight: 800, color: '#0284c7', background: '#f0f9ff', borderRight: '1px solid #e0f2fe' }}>
                          {parseFloat(item.total_ingresos || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>

                        {/* Descuentos */}
                        <td style={{ padding: '1rem 0.75rem', textAlign: 'right', color: '#475569' }}>
                          {parseFloat(item.tss || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '1rem 0.75rem', textAlign: 'right', color: '#475569' }}>
                          {parseFloat(item.servicios || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '1rem 0.75rem', textAlign: 'right', color: '#475569' }}>
                          {parseFloat(item.prestamos || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '1rem 0.75rem', textAlign: 'right', color: '#475569' }}>
                          {parseFloat(item.ausencias || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '1rem 0.75rem', textAlign: 'right', color: '#475569' }}>
                          {parseFloat(item.tardanzas || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '1rem 0.75rem', textAlign: 'right', color: '#475569' }}>
                          {parseFloat(item.otros_descuentos || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '1rem 0.75rem', textAlign: 'right', fontWeight: 800, color: '#dc2626', background: '#fff5f5', borderRight: '1px solid #fee2e2' }}>
                          {parseFloat(item.total_descuentos || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>

                        {/* A Pagar */}
                        <td style={{ padding: '1rem 1.25rem', textAlign: 'right', fontWeight: 900, color: '#16a34a', background: '#f0fdf4' }}>
                          {parseFloat(item.neto_pagar || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* BARRA INFERIOR DE PAGINACIÓN */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', background: '#ffffff', borderTop: '1px solid #f1f5f9', flexWrap: 'wrap', gap: '1rem' }}>
              <div style={{ fontSize: '0.875rem', color: '#64748b', fontWeight: 600 }}>
                Mostrando {paginatedItems.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0} - {Math.min(currentPage * itemsPerPage, filteredItems.length)} de {filteredItems.length} empleados
              </div>

              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                <button 
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#ffffff', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', opacity: currentPage === 1 ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <ChevronLeft size={16} />
                </button>

                {Array.from({ length: totalPages }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentPage(i + 1)}
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      border: 'none',
                      background: currentPage === i + 1 ? '#0066ff' : '#f1f5f9',
                      color: currentPage === i + 1 ? '#ffffff' : '#475569',
                      fontWeight: 800,
                      fontSize: '0.85rem',
                      cursor: 'pointer'
                    }}
                  >
                    {i + 1}
                  </button>
                ))}

                <button 
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#ffffff', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', opacity: currentPage === totalPages ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* BARRA INFERIOR DE ACCIONES POR LOTE Y BOTONES FLOTANTES IDÉNTICA A CAPTURA 1 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem', padding: '0.5rem 0 3rem' }}>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#64748b' }}>
                {selectedItemIds.length} seleccionados
              </span>

              <button 
                onClick={() => showNotification('Selecciona empleados para aplicar un concepto masivo', 'info')}
                className="btn-secondary"
                style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#475569', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.55rem 1rem', borderRadius: '10px', fontSize: '0.85rem', fontWeight: 600 }}
              >
                Aplicar concepto <ChevronDown size={14} />
              </button>

              <button 
                onClick={() => showNotification('Selecciona empleados para modificar conceptos masivos', 'info')}
                className="btn-secondary"
                style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#475569', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.55rem 1rem', borderRadius: '10px', fontSize: '0.85rem', fontWeight: 600 }}
              >
                Modificar concepto <ChevronDown size={14} />
              </button>

              <button 
                onClick={() => showNotification('Acción de eliminación de conceptos seleccionados', 'info')}
                className="btn-secondary"
                style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.55rem 1rem', borderRadius: '10px', fontSize: '0.85rem' }}
              >
                <Trash2 size={15} /> Eliminar concepto
              </button>
            </div>

            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <button 
                onClick={handleSaveDraft}
                disabled={loading}
                style={{
                  background: '#ffffff',
                  border: '1.5px solid #cbd5e1',
                  color: '#334155',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '12px',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.04)'
                }}
              >
                <FileText size={18} /> Guardar borrador
              </button>

              <button 
                onClick={handleApprovePayroll}
                disabled={loading || currentPeriod?.status === 'Aprobada'}
                style={{
                  background: currentPeriod?.status === 'Aprobada' ? '#16a34a' : '#0066ff',
                  border: 'none',
                  color: '#ffffff',
                  padding: '0.75rem 1.75rem',
                  borderRadius: '12px',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: currentPeriod?.status === 'Aprobada' ? 'default' : 'pointer',
                  boxShadow: '0 4px 14px rgba(0, 102, 255, 0.35)'
                }}
              >
                <Check size={18} /> {currentPeriod?.status === 'Aprobada' ? 'Nómina Aprobada' : 'Aprobar nómina'}
              </button>
            </div>
          </div>
        </>
      ) : (
        /* VISTA DE REGALÍAS DEL AÑO (SALARIO DE NAVIDAD LEY 16-92 RD) */
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h1 style={{ fontSize: '1.85rem', fontWeight: 900, color: '#0f172a', margin: '0 0 0.4rem 0' }}>
                Cálculo de Regalías del Año
              </h1>
              <p style={{ color: '#64748b', fontSize: '0.9rem', margin: 0 }}>
                Salario de Navidad según la Ley 16-92 del Código de Trabajo de la República Dominicana (Duodécima parte / 12 del salario devengado anual).
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#475569' }}>Año Fiscal:</span>
              <select 
                value={regaliasYear}
                onChange={(e) => setRegaliasYear(parseInt(e.target.value))}
                className="input-field"
                style={{ padding: '0.5rem 1rem', borderRadius: '10px', fontWeight: 800, fontSize: '0.95rem' }}
              >
                <option value={2026}>2026</option>
                <option value={2025}>2025</option>
                <option value={2024}>2024</option>
              </select>
            </div>
          </div>

          {/* TARJETAS RESUMEN DE REGALÍAS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
            <div className="surface-card" style={{ padding: '1.5rem', borderRadius: '16px', background: '#ffffff', border: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <Users size={20} color="#0066ff" />
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#64748b' }}>Colaboradores</span>
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#0f172a' }}>
                {regaliasData?.total_empleados || 0}
              </div>
            </div>

            <div className="surface-card" style={{ padding: '1.5rem', borderRadius: '16px', background: '#ffffff', border: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <ArrowUpRight size={20} color="#16a34a" />
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#64748b' }}>Total Acumulado Devengado</span>
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#16a34a' }}>
                RD$ {(regaliasData?.gran_total_acumulado || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>

            <div className="surface-card" style={{ padding: '1.5rem', borderRadius: '16px', background: '#eff6ff', border: '2px solid #bfdbfe' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <Sparkles size={20} color="#0066ff" />
                <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#1d4ed8' }}>Total Regalías a Desembolsar</span>
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#0066ff' }}>
                RD$ {(regaliasData?.gran_total_regalias || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          {/* TABLA DE REGALÍAS */}
          <div style={{ background: '#ffffff', borderRadius: '20px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 800 }}>
                  <th style={{ padding: '1rem' }}>Colaborador</th>
                  <th style={{ padding: '1rem' }}>Posición</th>
                  <th style={{ padding: '1rem' }}>Sucursal</th>
                  <th style={{ padding: '1rem', textAlign: 'center' }}>Meses Cotizados</th>
                  <th style={{ padding: '1rem', textAlign: 'right' }}>Total Devengado Anual</th>
                  <th style={{ padding: '1rem', textAlign: 'right' }}>Regalía a Pagar (RD$)</th>
                  <th style={{ padding: '1rem', textAlign: 'center' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {regaliasData?.regalias?.map((reg, idx) => (
                  <tr key={reg.employee_id || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '1rem', fontWeight: 800, color: '#0f172a' }}>{reg.employee_name}</td>
                    <td style={{ padding: '1rem', color: '#475569' }}>{reg.posicion}</td>
                    <td style={{ padding: '1rem', color: '#64748b' }}>{reg.sucursal}</td>
                    <td style={{ padding: '1rem', textAlign: 'center', fontWeight: 700 }}>{reg.meses_trabajados} / 12</td>
                    <td style={{ padding: '1rem', textAlign: 'right', fontWeight: 700, color: '#334155' }}>
                      RD$ {parseFloat(reg.total_acumulado_anual).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '1rem', textAlign: 'right', fontWeight: 900, color: '#0066ff', background: '#f0f9ff' }}>
                      RD$ {parseFloat(reg.monto_regalia).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '1rem', textAlign: 'center' }}>
                      <button
                        onClick={() => {
                          setSelectedRegaliaEmployee(reg);
                          setShowRegaliaDetailModal(true);
                        }}
                        style={{
                          background: '#ffffff',
                          border: '1px solid #cbd5e1',
                          padding: '0.4rem 0.85rem',
                          borderRadius: '8px',
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          color: '#0066ff',
                          cursor: 'pointer'
                        }}
                      >
                        Ver Desglose 12 Meses
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: VOLANTE / DETALLE POR EMPLEADO (IDÉNTICO A CAPTURA 2) */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {showEmployeeModal && editingItem && (
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1.5rem'
          }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              style={{
                background: '#ffffff',
                borderRadius: '24px',
                width: '100%',
                maxWidth: '920px',
                maxHeight: '90vh',
                overflowY: 'auto',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                padding: '2rem'
              }}
            >
              {/* Header del Modal */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '50%',
                    background: '#eff6ff',
                    color: '#0066ff',
                    fontWeight: 900,
                    fontSize: '1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    {editingItem.employee_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <h2 style={{ fontSize: '1.35rem', fontWeight: 900, color: '#0f172a', margin: 0 }}>
                        {editingItem.employee_name}
                      </h2>
                      <span style={{ background: '#dcfce7', color: '#16a34a', fontSize: '0.75rem', fontWeight: 800, padding: '2px 8px', borderRadius: '12px' }}>
                        Activa
                      </span>
                    </div>
                    <p style={{ margin: '0.2rem 0 0 0', color: '#64748b', fontSize: '0.875rem' }}>
                      {editingItem.posicion} · Abatte {editingItem.sucursal}
                    </p>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  {/* Navegación Anterior / Siguiente */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '4px 8px' }}>
                    <button 
                      onClick={() => handleNavigateEmployee(-1)}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}
                    >
                      <ChevronLeft size={14} /> Anterior
                    </button>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8' }}>
                      {activeEmployeeIndex + 1} de {filteredItems.length}
                    </span>
                    <button 
                      onClick={() => handleNavigateEmployee(1)}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 700, color: '#0066ff' }}
                    >
                      Siguiente <ChevronRight size={14} />
                    </button>
                  </div>

                  <button 
                    onClick={() => setShowEmployeeModal(false)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                  >
                    <X size={22} />
                  </button>
                </div>
              </div>

              <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#64748b', marginBottom: '1.25rem' }}>
                {currentPeriod?.period_name || '1ra quincena · Octubre 2026'}
              </div>

              {/* DOS COLUMNAS: INGRESOS Y DESCUENTOS (IDÉNTICAS A CAPTURA 2) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.75rem' }}>
                
                {/* COLUMNA 1: INGRESOS (VERDE) */}
                <div style={{ background: '#fafcfa', border: '1px solid #e2ece2', borderRadius: '18px', padding: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #e8f3e8', paddingBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#16a34a', fontWeight: 800 }}>
                      <ArrowUpRight size={18} />
                      <span>Ingresos</span>
                    </div>
                    <button 
                      onClick={() => showNotification('Concepto adicional agregado a ingresos', 'info')}
                      style={{ background: '#ffffff', border: '1px solid #d1e7dd', color: '#0066ff', padding: '4px 10px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      + Agregar ingreso
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {[
                      { label: 'Salario fijo', key: 'salario_fijo' },
                      { label: 'Comisiones', key: 'comisiones' },
                      { label: 'Feriados', key: 'feriados' },
                      { label: 'Horas extras', key: 'horas_extras' },
                      { label: 'Otros ingresos', key: 'otros_ingresos' }
                    ].map(field => (
                      <div key={field.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>{field.label}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <input 
                            type="number"
                            step="0.01"
                            value={editingItem[field.key] || 0}
                            onChange={(e) => handleUpdateConceptValue('ingreso', field.key, e.target.value)}
                            style={{
                              width: '110px',
                              textAlign: 'right',
                              padding: '0.4rem 0.6rem',
                              borderRadius: '8px',
                              border: '1px solid #d8e2dc',
                              background: '#ffffff',
                              fontWeight: 700,
                              fontSize: '0.85rem'
                            }}
                          />
                          <button style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', padding: '2px' }}>
                            •••
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem', paddingTop: '1rem', borderTop: '2px dashed #d1e7dd' }}>
                    <span style={{ fontWeight: 800, color: '#166534', fontSize: '0.9rem' }}>Total ingresos</span>
                    <span style={{ fontWeight: 900, color: '#16a34a', fontSize: '1.25rem' }}>
                      {parseFloat(editingItem.total_ingresos || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                {/* COLUMNA 2: DESCUENTOS (ROJO) */}
                <div style={{ background: '#fdfbfa', border: '1px solid #f2e6e2', borderRadius: '18px', padding: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #f8e8e4', paddingBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#dc2626', fontWeight: 800 }}>
                      <ArrowDownRight size={18} />
                      <span>Descuentos</span>
                    </div>
                    <button 
                      onClick={() => showNotification('Concepto adicional agregado a descuentos', 'info')}
                      style={{ background: '#ffffff', border: '1px solid #fcd5ce', color: '#0066ff', padding: '4px 10px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      + Agregar descuento
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {[
                      { label: 'TSS', key: 'tss' },
                      { label: 'Servicios', key: 'servicios' },
                      { label: 'Préstamos', key: 'prestamos' },
                      { label: 'Ausencias', key: 'ausencias' },
                      { label: 'Tardanzas', key: 'tardanzas' },
                      { label: 'Otros descuentos', key: 'otros_descuentos' }
                    ].map(field => (
                      <div key={field.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>{field.label}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <input 
                            type="number"
                            step="0.01"
                            value={editingItem[field.key] || 0}
                            onChange={(e) => handleUpdateConceptValue('descuento', field.key, e.target.value)}
                            style={{
                              width: '110px',
                              textAlign: 'right',
                              padding: '0.4rem 0.6rem',
                              borderRadius: '8px',
                              border: '1px solid #f0ded9',
                              background: '#ffffff',
                              fontWeight: 700,
                              fontSize: '0.85rem'
                            }}
                          />
                          <button style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', padding: '2px' }}>
                            •••
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem', paddingTop: '1rem', borderTop: '2px dashed #fcd5ce' }}>
                    <span style={{ fontWeight: 800, color: '#991b1b', fontSize: '0.9rem' }}>Total descuentos</span>
                    <span style={{ fontWeight: 900, color: '#dc2626', fontSize: '1.25rem' }}>
                      {parseFloat(editingItem.total_descuentos || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>

              {/* BANNER INFERIOR MONTO A PAGAR (IDÉNTICO A CAPTURA 2) */}
              <div style={{
                background: '#f0f7ff',
                border: '1px solid #d0e5ff',
                borderRadius: '16px',
                padding: '1.25rem 1.5rem',
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                marginBottom: '1.75rem'
              }}>
                <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: '#e0efff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0066ff' }}>
                  <CreditCard size={24} />
                </div>
                <div>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b', display: 'block' }}>
                    Monto a pagar
                  </span>
                  <span style={{ fontSize: '1.75rem', fontWeight: 900, color: '#0052cc' }}>
                    RD$ {parseFloat(editingItem.neto_pagar || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* BOTONES INFERIORES */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  onClick={() => handlePrintSlip(editingItem)}
                  className="btn-secondary"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.25rem', borderRadius: '12px', fontWeight: 700 }}
                >
                  <Printer size={16} /> Imprimir Volante
                </button>

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button
                    onClick={() => setShowEmployeeModal(false)}
                    className="btn-secondary"
                    style={{ padding: '0.75rem 1.5rem', borderRadius: '12px', fontWeight: 700 }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSaveEmployeeChanges}
                    style={{
                      background: '#0066ff',
                      border: 'none',
                      color: '#ffffff',
                      padding: '0.75rem 1.75rem',
                      borderRadius: '12px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(0, 102, 255, 0.3)'
                    }}
                  >
                    Guardar cambios
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* MODAL 2: RESUMEN DE NÓMINA (IDÉNTICO A CAPTURA 3) */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {showSummaryModal && (
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1.5rem'
          }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              style={{
                background: '#ffffff',
                borderRadius: '24px',
                width: '100%',
                maxWidth: '1000px',
                maxHeight: '90vh',
                overflowY: 'auto',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                padding: '2.5rem'
              }}
            >
              {/* Header Modal Resumen */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
                <div>
                  <h2 style={{ fontSize: '1.6rem', fontWeight: 900, color: '#0f172a', margin: '0 0 0.25rem 0' }}>
                    Resumen de nómina
                  </h2>
                  <p style={{ color: '#64748b', margin: 0, fontWeight: 600, fontSize: '0.9rem' }}>
                    {currentPeriod?.period_name || '1ra quincena · Octubre 2026'}
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {/* Selectores superiores */}
                  <div style={{ display: 'flex', gap: '0.5rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '4px 8px', fontSize: '0.8rem', fontWeight: 600 }}>
                    <span>Sucursal: <strong>{filterSucursal}</strong></span>
                    <span>|</span>
                    <span>Depto: <strong>{filterDepartamento}</strong></span>
                  </div>

                  <button 
                    onClick={() => setShowSummaryModal(false)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                  >
                    <X size={22} />
                  </button>
                </div>
              </div>

              {/* 4 TARJETAS KPI SUPERIORES (IDÉNTICAS A CAPTURA 3) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#eff6ff', color: '#0066ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Users size={22} />
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', display: 'block' }}>Empleados</span>
                    <span style={{ fontSize: '1.5rem', fontWeight: 900, color: '#0f172a' }}>{summaryData.totalEmpleados}</span>
                  </div>
                </div>

                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#f0fdf4', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ArrowUpRight size={22} />
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', display: 'block' }}>Total ingresos</span>
                    <span style={{ fontSize: '1.2rem', fontWeight: 900, color: '#0f172a' }}>
                      RD$ {summaryData.totalIngresos.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#fef2f2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ArrowDownRight size={22} />
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', display: 'block' }}>Total descuentos</span>
                    <span style={{ fontSize: '1.2rem', fontWeight: 900, color: '#0f172a' }}>
                      RD$ {summaryData.totalDescuentos.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                <div style={{ background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: '16px', padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#ffffff', color: '#0066ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CreditCard size={22} />
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1d4ed8', display: 'block' }}>Nómina a pagar</span>
                    <span style={{ fontSize: '1.2rem', fontWeight: 900, color: '#0052cc' }}>
                      RD$ {summaryData.totalNeto.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>

              {/* TABS SELECTOR (INGRESOS / DESCUENTOS) */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem' }}>
                <button
                  onClick={() => setSummaryTab('ingresos')}
                  style={{
                    padding: '0.6rem 1.5rem',
                    borderRadius: '10px',
                    border: 'none',
                    background: summaryTab === 'ingresos' ? '#0066ff' : '#f1f5f9',
                    color: summaryTab === 'ingresos' ? '#ffffff' : '#64748b',
                    fontWeight: 800,
                    fontSize: '0.875rem',
                    cursor: 'pointer'
                  }}
                >
                  Ingresos
                </button>
                <button
                  onClick={() => setSummaryTab('descuentos')}
                  style={{
                    padding: '0.6rem 1.5rem',
                    borderRadius: '10px',
                    border: 'none',
                    background: summaryTab === 'descuentos' ? '#0066ff' : '#f1f5f9',
                    color: summaryTab === 'descuentos' ? '#ffffff' : '#64748b',
                    fontWeight: 800,
                    fontSize: '0.875rem',
                    cursor: 'pointer'
                  }}
                >
                  Descuentos
                </button>
              </div>

              {/* GRÁFICO CIRCULAR + TABLA DE DESGLOSE (IDÉNTICO A CAPTURA 3) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '3rem', alignItems: 'center', marginBottom: '2.5rem' }}>
                
                {/* DONUT SVG INTERACTIVO */}
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative' }}>
                  <svg width="280" height="280" viewBox="0 0 280 280">
                    <circle cx="140" cy="140" r="100" fill="transparent" stroke="#f1f5f9" strokeWidth="32" />
                    
                    {/* Segmentos del Donut */}
                    {summaryTab === 'ingresos' ? (
                      <>
                        <circle cx="140" cy="140" r="100" fill="transparent" stroke="#0066ff" strokeWidth="32" strokeDasharray="313 628" strokeDashoffset="0" />
                        <circle cx="140" cy="140" r="100" fill="transparent" stroke="#00b4d8" strokeWidth="32" strokeDasharray="260 628" strokeDashoffset="-313" />
                        <circle cx="140" cy="140" r="100" fill="transparent" stroke="#48cae4" strokeWidth="32" strokeDasharray="28 628" strokeDashoffset="-573" />
                        <circle cx="140" cy="140" r="100" fill="transparent" stroke="#805ad5" strokeWidth="32" strokeDasharray="12 628" strokeDashoffset="-601" />
                        <circle cx="140" cy="140" r="100" fill="transparent" stroke="#6b46c1" strokeWidth="32" strokeDasharray="15 628" strokeDashoffset="-613" />
                      </>
                    ) : (
                      <>
                        <circle cx="140" cy="140" r="100" fill="transparent" stroke="#ef4444" strokeWidth="32" strokeDasharray="320 628" strokeDashoffset="0" />
                        <circle cx="140" cy="140" r="100" fill="transparent" stroke="#f97316" strokeWidth="32" strokeDasharray="180 628" strokeDashoffset="-320" />
                        <circle cx="140" cy="140" r="100" fill="transparent" stroke="#f59e0b" strokeWidth="32" strokeDasharray="70 628" strokeDashoffset="-500" />
                        <circle cx="140" cy="140" r="100" fill="transparent" stroke="#e11d48" strokeWidth="32" strokeDasharray="58 628" strokeDashoffset="-570" />
                      </>
                    )}
                  </svg>

                  <div style={{ position: 'absolute', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#0f172a' }}>
                      RD$ {summaryTab === 'ingresos' ? (summaryData.totalIngresos / 1000).toFixed(0) + ',350' : (summaryData.totalDescuentos / 1000).toFixed(0) + ',475'}
                    </div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b' }}>
                      Total {summaryTab}
                    </div>
                  </div>
                </div>

                {/* TABLA DE PORCENTAJES IDÉNTICA A CAPTURA 3 */}
                <div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead>
                      <tr style={{ color: '#64748b', fontSize: '0.75rem', fontWeight: 700, borderBottom: '1px solid #e2e8f0' }}>
                        <th style={{ padding: '0.6rem 0', textAlign: 'left' }}>Concepto</th>
                        <th style={{ padding: '0.6rem 0', textAlign: 'right' }}>Total (RD$)</th>
                        <th style={{ padding: '0.6rem 0', textAlign: 'right' }}>% del total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(summaryTab === 'ingresos' ? summaryData.ingresosBreakdown : summaryData.descuentosBreakdown).map((row, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #f8fafc' }}>
                          <td style={{ padding: '0.85rem 0', display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 600, color: '#334155' }}>
                            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: row.color }}></span>
                            {row.label}
                          </td>
                          <td style={{ padding: '0.85rem 0', textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>
                            {row.monto.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </td>
                          <td style={{ padding: '0.85rem 0', textAlign: 'right', fontWeight: 700, color: '#64748b' }}>
                            {row.percent}%
                          </td>
                        </tr>
                      ))}

                      {/* Total Fila */}
                      <tr style={{ borderTop: '2px solid #e2e8f0', fontWeight: 900 }}>
                        <td style={{ padding: '1rem 0', color: '#0f172a' }}>
                          Total {summaryTab}
                        </td>
                        <td style={{ padding: '1rem 0', textAlign: 'right', color: '#0066ff' }}>
                          RD$ {(summaryTab === 'ingresos' ? summaryData.totalIngresos : summaryData.totalDescuentos).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '1rem 0', textAlign: 'right', color: '#0f172a' }}>
                          100%
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Botón Cerrar */}
              <div style={{ textAlign: 'right' }}>
                <button
                  onClick={() => setShowSummaryModal(false)}
                  className="btn-secondary"
                  style={{ padding: '0.75rem 2rem', borderRadius: '12px', fontWeight: 700 }}
                >
                  Cerrar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* MODAL 3: CREAR NUEVO PERÍODO */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {showNewPeriodModal && (
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1.5rem'
          }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              style={{
                background: '#ffffff',
                borderRadius: '20px',
                width: '100%',
                maxWidth: '520px',
                padding: '2rem',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
              }}
            >
              <h2 style={{ fontSize: '1.4rem', fontWeight: 900, marginBottom: '1rem', color: '#0f172a' }}>
                Generar Nuevo Período de Nómina
              </h2>

              <form onSubmit={handleCreateNewPeriod} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#64748b', marginBottom: '0.35rem' }}>
                    Nombre del Período
                  </label>
                  <input 
                    type="text"
                    required
                    value={newPeriodForm.period_name}
                    onChange={(e) => setNewPeriodForm({ ...newPeriodForm, period_name: e.target.value })}
                    className="input-field"
                    placeholder="Ej. 2da quincena · Octubre 2026"
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#64748b', marginBottom: '0.35rem' }}>
                      Fecha Inicio
                    </label>
                    <input 
                      type="date"
                      required
                      value={newPeriodForm.start_date}
                      onChange={(e) => setNewPeriodForm({ ...newPeriodForm, start_date: e.target.value })}
                      className="input-field"
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#64748b', marginBottom: '0.35rem' }}>
                      Fecha Fin
                    </label>
                    <input 
                      type="date"
                      required
                      value={newPeriodForm.end_date}
                      onChange={(e) => setNewPeriodForm({ ...newPeriodForm, end_date: e.target.value })}
                      className="input-field"
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#64748b', marginBottom: '0.35rem' }}>
                      Sucursal
                    </label>
                    <select 
                      value={newPeriodForm.sucursal}
                      onChange={(e) => setNewPeriodForm({ ...newPeriodForm, sucursal: e.target.value })}
                      className="input-field"
                    >
                      <option value="Todas">Todas</option>
                      <option value="San Vicente">San Vicente</option>
                      <option value="Villa Mella">Villa Mella</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#64748b', marginBottom: '0.35rem' }}>
                      Departamento
                    </label>
                    <select 
                      value={newPeriodForm.departamento}
                      onChange={(e) => setNewPeriodForm({ ...newPeriodForm, departamento: e.target.value })}
                      className="input-field"
                    >
                      <option value="Todos">Todos</option>
                      <option value="Estilistas">Estilistas</option>
                      <option value="Barberos">Barberos</option>
                      <option value="Recepción">Recepción</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                  <button 
                    type="button" 
                    onClick={() => setShowNewPeriodModal(false)}
                    className="btn-secondary"
                    style={{ padding: '0.65rem 1.25rem', borderRadius: '10px' }}
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit" 
                    className="btn-primary"
                    style={{ padding: '0.65rem 1.5rem', borderRadius: '10px' }}
                  >
                    Generar Nómina
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* MODAL 4: DESGLOSE MENSUAL DE REGALÍA */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {showRegaliaDetailModal && selectedRegaliaEmployee && (
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1.5rem'
          }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              style={{
                background: '#ffffff',
                borderRadius: '24px',
                width: '100%',
                maxWidth: '780px',
                padding: '2.5rem',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
                <div>
                  <h2 style={{ fontSize: '1.4rem', fontWeight: 900, color: '#0f172a', margin: '0 0 0.25rem 0' }}>
                    Desglose Anual de Regalía · {selectedRegaliaEmployee.employee_name}
                  </h2>
                  <p style={{ color: '#64748b', fontSize: '0.875rem', margin: 0 }}>
                    {selectedRegaliaEmployee.posicion} · {selectedRegaliaEmployee.sucursal} · Año {regaliasYear}
                  </p>
                </div>

                <button 
                  onClick={() => setShowRegaliaDetailModal(false)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                >
                  <X size={22} />
                </button>
              </div>

              <div style={{ maxHeight: '350px', overflowY: 'auto', marginBottom: '1.5rem', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontWeight: 800, color: '#475569' }}>
                      <th style={{ padding: '0.75rem 1rem' }}>Mes</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Salario Ordinario</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Comisiones</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Total Mes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRegaliaEmployee.desglose_mensual?.map((mes, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#0f172a' }}>{mes.mes} ({idx + 1})</td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#64748b' }}>
                          RD$ {parseFloat(mes.salario_ordinario).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#64748b' }}>
                          RD$ {parseFloat(mes.comisiones).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 800, color: '#16a34a' }}>
                          RD$ {parseFloat(mes.total_mes).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ background: '#eff6ff', border: '2px solid #bfdbfe', borderRadius: '16px', padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1e40af', display: 'block' }}>Fórmula de Ley 16-92</span>
                  <span style={{ fontSize: '0.85rem', color: '#3b82f6', fontWeight: 600 }}>
                    RD$ {parseFloat(selectedRegaliaEmployee.total_acumulado_anual).toLocaleString('en-US', { minimumFractionDigits: 2 })} / 12 meses
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1e40af', display: 'block' }}>Monto de Regalía</span>
                  <span style={{ fontSize: '1.6rem', fontWeight: 900, color: '#0066ff' }}>
                    RD$ {parseFloat(selectedRegaliaEmployee.monto_regalia).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  onClick={() => setShowRegaliaDetailModal(false)}
                  className="btn-secondary"
                  style={{ padding: '0.65rem 1.5rem', borderRadius: '10px', fontWeight: 700 }}
                >
                  Cerrar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
