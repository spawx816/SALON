import React, { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { 
  DollarSign, Users, Calendar, Download, Plus, Search, Filter, 
  ChevronLeft, ChevronRight, CheckCircle2, AlertCircle, Printer, 
  Sliders, ArrowUpRight, ArrowDownRight, Edit2, Trash2, Eye, 
  Settings, FileText, Check, X, RefreshCw, Layers, PieChart as PieIcon, 
  CreditCard, Sparkles, Building2, Briefcase, ChevronDown, CheckSquare, Square,
  RotateCcw, History, ShieldAlert, Lock, Info, FileSpreadsheet, UserCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { dataService } from '../../utils/dataService';
import { formatDateDisplay } from '../../utils/formatters';
import { useNotification } from '../../context/NotificationContext';
import PayrollHistoryView from './PayrollHistoryView';

export default function PayrollModule({ initialTab }) {
  const { showNotification } = useNotification();
  const location = useLocation();
  const navigate = useNavigate();

  // Estados principales
  const [loading, setLoading] = useState(false);
  const [periods, setPeriods] = useState([]);
  const [currentPeriod, setCurrentPeriod] = useState(null);
  const [items, setItems] = useState([]);
  const [concepts, setConcepts] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);

  // Pila de Deshacer (Undo Stack) para cambios masivos / ediciones en borrador
  const [undoStack, setUndoStack] = useState([]);

  // Pestaña principal activa: 'payroll' (Procesar nómina) | 'historical' (Histórico inmutable) | 'regalias' (Regalías del año)
  const [mainTab, setMainTab] = useState(() => {
    if (initialTab) return initialTab;
    if (location.pathname.includes('/nomina/historial') || location.search.includes('tab=historial') || location.search.includes('tab=historical')) return 'historical';
    if (location.pathname.includes('/nomina/regalias') || location.search.includes('tab=regalias')) return 'regalias';
    return 'payroll';
  });

  // Sincronizar mainTab con cambios de ruta
  useEffect(() => {
    if (initialTab) {
      setMainTab(initialTab);
    } else if (location.pathname.includes('/nomina/historial') || location.search.includes('tab=historial') || location.search.includes('tab=historical')) {
      setMainTab('historical');
    } else if (location.pathname.includes('/nomina/regalias') || location.search.includes('tab=regalias')) {
      setMainTab('regalias');
    } else if (location.pathname === '/nomina') {
      if (!location.search) setMainTab('payroll');
    }
  }, [location.pathname, location.search, initialTab]);

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
  const [editReason, setEditReason] = useState('');
  const [newConceptForm, setNewConceptForm] = useState({ show: false, type: 'ingreso', label: '', amount: '' });

  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [summaryTab, setSummaryTab] = useState('ingresos'); // 'ingresos' | 'descuentos' | 'distribucion'

  const [showNewPeriodModal, setShowNewPeriodModal] = useState(false);
  const [newPeriodForm, setNewPeriodForm] = useState({
    period_name: '1ra quincena · Octubre 2026',
    start_date: '2026-10-01',
    end_date: '2026-10-15',
    sucursal: 'Todas',
    departamento: 'Todos'
  });

  // Modal de Aprobación de Nómina
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [approverName, setApproverName] = useState('Administrador');

  // Modal de Acciones Masivas
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkForm, setBulkForm] = useState({
    concept_type: 'Ingreso', // 'Ingreso' | 'Descuento'
    concept_label: 'Bono de Desempeño',
    custom_label: '',
    amount: '',
    operation: 'add', // 'add' (sumar) | 'set' (fijar)
    reason: 'Incentivo de producción general'
  });

  // Modal de Asignación Masiva de TSS
  const [showBulkTssModal, setShowBulkTssModal] = useState(false);
  const [bulkTssValue, setBulkTssValue] = useState('591.00');
  const [bulkTssMode, setBulkTssMode] = useState('fixed'); // 'fixed' | 'law_percentage'
  const [bulkTssScope, setBulkTssScope] = useState('all'); // 'all' | 'selected'

  // Control de visibilidad de columnas (casillas para ocultar / mostrar)
  const [visibleColumns, setVisibleColumns] = useState(() => {
    try {
      const saved = localStorage.getItem('payroll_visible_columns_v1');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {
      salario_fijo: true,
      comisiones: true,
      feriados: true,
      horas_extras: true,
      otros_ingresos: true,
      total_ingresos: true,
      tss: true,
      servicios: true,
      prestamos: true,
      ausencias: true,
      tardanzas: true,
      otros_descuentos: true,
      total_descuentos: true,
      neto_pagar: true
    };
  });
  const [showColumnsPopover, setShowColumnsPopover] = useState(false);

  const handleToggleColumn = (colKey) => {
    setVisibleColumns(prev => {
      const updated = { ...prev, [colKey]: !prev[colKey] };
      try {
        localStorage.setItem('payroll_visible_columns_v1', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  const handleSetAllColumns = (val) => {
    const updated = {
      salario_fijo: val,
      comisiones: val,
      feriados: val,
      horas_extras: val,
      otros_ingresos: val,
      total_ingresos: true,
      tss: val,
      servicios: val,
      prestamos: val,
      ausencias: val,
      tardanzas: val,
      otros_descuentos: val,
      total_descuentos: true,
      neto_pagar: true
    };
    setVisibleColumns(updated);
    try {
      localStorage.setItem('payroll_visible_columns_v1', JSON.stringify(updated));
    } catch (e) {}
  };

  const handleSetEssentialColumns = () => {
    const updated = {
      salario_fijo: true,
      comisiones: true,
      feriados: false,
      horas_extras: false,
      otros_ingresos: false,
      total_ingresos: true,
      tss: true,
      servicios: true,
      prestamos: true,
      ausencias: false,
      tardanzas: false,
      otros_descuentos: false,
      total_descuentos: true,
      neto_pagar: true
    };
    setVisibleColumns(updated);
    try {
      localStorage.setItem('payroll_visible_columns_v1', JSON.stringify(updated));
    } catch (e) {}
  };

  // Lista de sucursales registradas
  const [salonsList, setSalonsList] = useState([]);

  // Modal de Auditoría
  const [showAuditModal, setShowAuditModal] = useState(false);

  // Estados para Regalías
  const [regaliasYear, setRegaliasYear] = useState(new Date().getFullYear());
  const [regaliasData, setRegaliasData] = useState(null);
  const [selectedRegaliaEmployee, setSelectedRegaliaEmployee] = useState(null);
  const [showRegaliaDetailModal, setShowRegaliaDetailModal] = useState(false);

  // Cargar datos al montar
  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const [periodsRes, conceptsRes, salonsRes] = await Promise.all([
        dataService.getPayrollPeriods(),
        dataService.getPayrollConcepts(),
        dataService.getSalons ? dataService.getSalons() : Promise.resolve([])
      ]);

      setPeriods(periodsRes || []);
      setConcepts(conceptsRes || []);
      if (salonsRes && Array.isArray(salonsRes)) setSalonsList(salonsRes);

      if (periodsRes && periodsRes.length > 0) {
        // Cargar el último período activo o el primero de la lista
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
        setUndoStack([]); // Reset undo stack al cambiar de período

        // Cargar logs de auditoría para este período
        const logs = await dataService.getPayrollAuditLogs(periodId);
        setAuditLogs(logs || []);
      }
    } catch (err) {
      showNotification('Error cargando detalles del período: ' + err.message, 'error');
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
      
      const itemSuc = (item.sucursal || '').toLowerCase();
      const filterSuc = (filterSucursal || 'Todas').toLowerCase();

      let matchSucursal = filterSuc === 'todas';
      if (!matchSucursal) {
        if (filterSuc.includes('disponible')) {
          matchSucursal = itemSuc.includes('disponible');
        } else if (filterSuc.includes('villa mella') || filterSuc.includes('mella')) {
          matchSucursal = itemSuc.includes('mella');
        } else if (filterSuc.includes('san vicente') || filterSuc.includes('vicente')) {
          matchSucursal = itemSuc.includes('vicente');
        } else {
          matchSucursal = itemSuc.includes(filterSuc);
        }
      }

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

  // Abrir modal de empleado individual
  const handleOpenEmployeeModal = (item, indexInFiltered) => {
    setEditingItem(JSON.parse(JSON.stringify(item)));
    setActiveEmployeeIndex(indexInFiltered);
    setEditReason('');
    setNewConceptForm({ show: false, type: 'ingreso', label: '', amount: '' });
    setShowEmployeeModal(true);
  };

  const handleNavigateEmployee = (direction) => {
    let nextIdx = activeEmployeeIndex + direction;
    if (nextIdx < 0) nextIdx = filteredItems.length - 1;
    if (nextIdx >= filteredItems.length) nextIdx = 0;
    setActiveEmployeeIndex(nextIdx);
    setEditingItem(JSON.parse(JSON.stringify(filteredItems[nextIdx])));
    setEditReason('');
    setNewConceptForm({ show: false, type: 'ingreso', label: '', amount: '' });
  };

  // Actualizar un concepto estándar en el modal de edición
  const handleUpdateConceptValue = (type, key, value) => {
    if (!editingItem) return;
    if (currentPeriod?.status === 'Aprobada') {
      showNotification('Esta nómina está aprobada y es inmutable', 'warning');
      return;
    }
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

  // Agregar un concepto personalizado a un empleado individual
  const handleAddCustomConceptToEmployee = () => {
    if (!editingItem || !newConceptForm.label || !newConceptForm.amount) return;
    const amountNum = parseFloat(newConceptForm.amount) || 0;
    if (amountNum <= 0) {
      showNotification('El monto debe ser mayor a 0', 'warning');
      return;
    }

    const copy = JSON.parse(JSON.stringify(editingItem));
    if (!copy.detalles_json) copy.detalles_json = {};
    if (!copy.detalles_json.conceptos_ingresos) copy.detalles_json.conceptos_ingresos = [];
    if (!copy.detalles_json.conceptos_descuentos) copy.detalles_json.conceptos_descuentos = [];

    if (newConceptForm.type === 'ingreso') {
      copy.detalles_json.conceptos_ingresos.push({
        id: `c_${Date.now()}`,
        label: newConceptForm.label,
        monto: amountNum,
        custom: true
      });
      copy.otros_ingresos = Number((parseFloat(copy.otros_ingresos || 0) + amountNum).toFixed(2));
    } else {
      copy.detalles_json.conceptos_descuentos.push({
        id: `d_${Date.now()}`,
        label: newConceptForm.label,
        monto: amountNum,
        custom: true
      });
      copy.otros_descuentos = Number((parseFloat(copy.otros_descuentos || 0) + amountNum).toFixed(2));
    }

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
    setNewConceptForm({ show: false, type: 'ingreso', label: '', amount: '' });
    showNotification(`Concepto "${newConceptForm.label}" agregado`, 'success');
  };

  // Guardar cambios individuales de un empleado
  const handleSaveEmployeeChanges = async () => {
    if (!editingItem || !currentPeriod) return;
    if (currentPeriod.status === 'Aprobada') {
      showNotification('Esta nómina está aprobada y es inmutable', 'warning');
      return;
    }

    // Guardar estado previo para Deshacer
    setUndoStack(prev => [...prev, JSON.parse(JSON.stringify(items))]);

    const updatedItems = items.map(it => it.id === editingItem.id ? editingItem : it);
    setItems(updatedItems);
    setShowEmployeeModal(false);

    // Persistir borrador y auditoría
    try {
      await dataService.savePayrollDraft({
        payroll_id: currentPeriod.id,
        items: updatedItems,
        status: currentPeriod.status || 'En preparación',
        reason: editReason || `Ajuste manual individual en ${editingItem.employee_name}`,
        user_name: 'Administrador'
      });
      showNotification(`Cambios guardados y auditados para ${editingItem.employee_name}`, 'success');
      loadPeriodDetail(currentPeriod.id);
    } catch (err) {
      showNotification('Error al guardar cambios: ' + err.message, 'error');
    }
  };

  // Guardar Borrador
  const handleSaveDraft = async () => {
    if (!currentPeriod) return;
    if (currentPeriod.status === 'Aprobada') {
      showNotification('Esta nómina está aprobada y es inmutable', 'warning');
      return;
    }
    setLoading(true);
    try {
      await dataService.savePayrollDraft({
        payroll_id: currentPeriod.id,
        items: items,
        status: currentPeriod.status || 'En preparación',
        reason: 'Guardado manual de borrador',
        user_name: 'Administrador'
      });
      showNotification('Nómina guardada como borrador correctamente', 'success');
      loadPeriodDetail(currentPeriod.id);
    } catch (err) {
      showNotification('Error al guardar borrador: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Aplicar Concepto Masivo
  const handleApplyBulkConcept = async (e) => {
    e.preventDefault();
    if (selectedItemIds.length === 0) {
      showNotification('Debes seleccionar al menos un colaborador', 'warning');
      return;
    }
    const finalAmount = parseFloat(bulkForm.amount) || 0;
    if (finalAmount <= 0) {
      showNotification('El monto debe ser mayor a 0', 'warning');
      return;
    }

    const conceptLabel = bulkForm.concept_label === 'Otro...' ? bulkForm.custom_label : bulkForm.concept_label;
    if (!conceptLabel) {
      showNotification('Especifica el nombre del concepto', 'warning');
      return;
    }

    // Guardar estado previo para Deshacer
    setUndoStack(prev => [...prev, JSON.parse(JSON.stringify(items))]);

    setLoading(true);
    try {
      await dataService.bulkApplyPayrollConcept({
        payroll_id: currentPeriod.id,
        item_ids: selectedItemIds,
        concept_label: conceptLabel,
        concept_type: bulkForm.concept_type,
        amount: finalAmount,
        operation: bulkForm.operation,
        reason: bulkForm.reason || 'Aplicación masiva',
        user_name: 'Administrador'
      });

      showNotification(`¡Concepto "${conceptLabel}" aplicado a ${selectedItemIds.length} colaboradores!`, 'success');
      setShowBulkModal(false);
      setSelectedItemIds([]);
      await loadPeriodDetail(currentPeriod.id);
    } catch (err) {
      showNotification('Error al aplicar concepto masivo: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Aplicar TSS Masivo a empleados
  const handleApplyBulkTss = async (e) => {
    if (e) e.preventDefault();
    if (!currentPeriod) return;
    if (currentPeriod.status === 'Aprobada') {
      showNotification('Esta nómina está aprobada y es inmutable', 'warning');
      return;
    }

    const targetIds = bulkTssScope === 'selected' && selectedItemIds.length > 0
      ? selectedItemIds
      : items.map(it => it.id);

    if (targetIds.length === 0) {
      showNotification('No hay colaboradores seleccionados para aplicar el cambio', 'warning');
      return;
    }

    // Guardar estado previo para Deshacer (Undo)
    setUndoStack(prev => [...prev, JSON.parse(JSON.stringify(items))]);

    const fixedVal = parseFloat(bulkTssValue) || 0;

    const updatedItems = items.map(it => {
      if (!targetIds.includes(it.id)) return it;

      let newTss = 0;
      if (bulkTssMode === 'law_percentage') {
        // TSS de ley en RD: 5.91% del salario fijo
        const baseSalary = parseFloat(it.salario_fijo || 0);
        newTss = Number((baseSalary * 0.0591).toFixed(2));
      } else {
        newTss = fixedVal;
      }

      const copy = { ...it, tss: newTss };

      const totalIng = (
        parseFloat(copy.salario_fijo || 0) +
        parseFloat(copy.comisiones || 0) +
        parseFloat(copy.feriados || 0) +
        parseFloat(copy.horas_extras || 0) +
        parseFloat(copy.otros_ingresos || 0)
      );

      const totalDesc = (
        newTss +
        parseFloat(copy.servicios || 0) +
        parseFloat(copy.prestamos || 0) +
        parseFloat(copy.ausencias || 0) +
        parseFloat(copy.tardanzas || 0) +
        parseFloat(copy.otros_descuentos || 0)
      );

      copy.total_ingresos = Number(totalIng.toFixed(2));
      copy.total_descuentos = Number(totalDesc.toFixed(2));
      copy.neto_pagar = Number((totalIng - totalDesc).toFixed(2));

      return copy;
    });

    setItems(updatedItems);
    setShowBulkTssModal(false);

    setLoading(true);
    try {
      await dataService.savePayrollDraft({
        payroll_id: currentPeriod.id,
        items: updatedItems,
        status: currentPeriod.status || 'En preparación',
        reason: bulkTssMode === 'law_percentage'
          ? `Recálculo masivo de TSS al 5.91% de ley (${targetIds.length} colaboradores)`
          : `Asignación masiva de TSS fijo RD$ ${fixedVal.toFixed(2)} (${targetIds.length} colaboradores)`,
        user_name: 'Administrador'
      });

      showNotification(
        bulkTssMode === 'law_percentage'
          ? `¡TSS recalculado al 5.91% de ley para ${targetIds.length} colaboradores!`
          : `¡TSS de RD$ ${fixedVal.toLocaleString('es-DO', { minimumFractionDigits: 2 })} asignado a ${targetIds.length} colaboradores!`,
        'success'
      );
      await loadPeriodDetail(currentPeriod.id);
    } catch (err) {
      showNotification('Error guardando cambios de TSS: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Deshacer último cambio (Undo)
  const handleUndo = async () => {
    if (undoStack.length === 0) {
      showNotification('No hay cambios recientes para deshacer', 'info');
      return;
    }
    if (currentPeriod?.status === 'Aprobada') {
      showNotification('Esta nómina ya está aprobada y es inmutable', 'warning');
      return;
    }

    const previousItems = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, prev.length - 1));
    setItems(previousItems);

    try {
      await dataService.savePayrollDraft({
        payroll_id: currentPeriod.id,
        items: previousItems,
        status: currentPeriod.status || 'En preparación',
        reason: 'Reversión / Deshacer de cambio anterior',
        user_name: 'Administrador'
      });
      showNotification('¡Último cambio deshecho exitosamente!', 'success');
      loadPeriodDetail(currentPeriod.id);
    } catch (err) {
      showNotification('Error al revertir cambios: ' + err.message, 'error');
    }
  };

  // Sincronizar datos reales de comisiones y descuentos en tiempo real
  const handleSyncRealData = async () => {
    if (!currentPeriod) return;
    if (currentPeriod.status === 'Aprobada') {
      showNotification('Esta nómina está aprobada y es inmutable', 'warning');
      return;
    }
    setLoading(true);
    try {
      const res = await dataService.syncPayrollRealData(currentPeriod.id);
      if (res && res.period) {
        setCurrentPeriod(res.period);
        setItems(res.items || []);
        showNotification('¡Comisiones y descuentos sincronizados desde la base de datos en tiempo real!', 'success');
        const logs = await dataService.getPayrollAuditLogs(currentPeriod.id);
        setAuditLogs(logs || []);
      }
    } catch (err) {
      showNotification('Error al sincronizar datos reales: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Aprobar Nómina Definitivamente (Inmutable)
  const handleApprovePayrollConfirm = async () => {
    if (!currentPeriod) return;
    setLoading(true);
    try {
      await dataService.approvePayroll({
        payroll_id: currentPeriod.id,
        approved_by: approverName || 'Administrador'
      });
      showNotification('¡Nómina aprobada exitosamente! Descuentos saldados y comisiones liquidadas.', 'success');
      setShowApproveModal(false);
      await loadPeriodDetail(currentPeriod.id);
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
      showNotification('Nuevo período generado automáticamente con datos del personal', 'success');
      setShowNewPeriodModal(false);
      await loadInitialData();
    } catch (err) {
      showNotification('Error al generar período: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Totales y Desglose para el Modal de Resumen y KPIs
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

    // Aporte Patronal TSS Estimado (SFS 7.09% + AFP 7.10% + SRL 1.20% = 15.39%)
    const aportePatronalTss = Number((totSalario * 0.1539).toFixed(2));

    const ingresosBreakdown = [
      { label: 'Salario fijo', monto: totSalario, color: '#0066ff' },
      { label: 'Comisiones', monto: totComisiones, color: '#00b4d8' },
      { label: 'Horas extras', monto: totHorasExtras, color: '#48cae4' },
      { label: 'Feriados', monto: totFeriados, color: '#805ad5' },
      { label: 'Otros ingresos / Bonos', monto: totOtrosIng, color: '#6b46c1' }
    ].map(item => ({
      ...item,
      percent: totalIngresos > 0 ? ((item.monto / totalIngresos) * 100).toFixed(1) : '0.0'
    }));

    const descuentosBreakdown = [
      { label: 'TSS (Seguro/AFP 5.91%)', monto: totTss, color: '#ef4444' },
      { label: 'Servicios de salón', monto: totServicios, color: '#f97316' },
      { label: 'Préstamos y Anticipos', monto: totPrestamos, color: '#f59e0b' },
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
      aportePatronalTss,
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
          body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 30px; color: #1e293b; max-width: 800px; margin: 0 auto; }
          .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 15px; margin-bottom: 20px; }
          .title { font-size: 20px; font-weight: 900; margin: 0; }
          .subtitle { font-size: 13px; color: #64748b; margin-top: 5px; }
          .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px; font-size: 13px; background: #f8fafc; padding: 12px; border-radius: 8px; }
          .tables-container { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 25px; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; }
          th { background: #f1f5f9; text-align: left; padding: 8px; border-bottom: 1px solid #cbd5e1; font-weight: 800; }
          td { padding: 8px; border-bottom: 1px solid #f1f5f9; }
          .total-box { background: #eff6ff; border: 2px solid #3b82f6; border-radius: 12px; padding: 15px; text-align: center; margin-bottom: 30px; }
          .total-amount { font-size: 24px; font-weight: 900; color: #1d4ed8; }
          .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 50px; margin-top: 50px; text-align: center; font-size: 12px; }
          .sig-line { border-top: 1px solid #000; margin-top: 40px; padding-top: 5px; font-weight: 700; }
          .stamp-approved { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 900; background: #dcfce7; color: #166534; border: 1px solid #86efac; margin-top: 5px; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="header">
          <h1 class="title">ABATTE PELUQUERÍA / PLAN BEAUTY RD</h1>
          <p class="subtitle">VOLANTE OFICIAL DE PAGO DE NÓMINA · ${currentPeriod?.period_name || 'Octubre 2026'}</p>
          ${currentPeriod?.status === 'Aprobada' ? '<div class="stamp-approved">✓ NÓMINA APROBADA E INMUTABLE</div>' : '<div style="color:#d97706; font-size:11px; font-weight:bold;">● DOCUMENTO EN BORRADOR</div>'}
        </div>

        <div class="meta-grid">
          <div><strong>Colaborador:</strong> ${item.employee_name}</div>
          <div><strong>ID / Cédula:</strong> ${item.employee_id}</div>
          <div><strong>Posición:</strong> ${item.posicion}</div>
          <div><strong>Sucursal:</strong> ${item.sucursal}</div>
          <div><strong>Período:</strong> ${formatDateDisplay(currentPeriod?.start_date)} al ${formatDateDisplay(currentPeriod?.end_date)}</div>
          <div><strong>Fecha Emisión:</strong> ${new Date().toLocaleDateString('es-DO')}</div>
        </div>

        <div class="tables-container">
          <div>
            <table>
              <thead><tr><th>INGRESOS</th><th style="text-align: right;">MONTO (RD$)</th></tr></thead>
              <tbody>
                <tr><td>Salario Fijo (Quincenal)</td><td style="text-align: right;">${parseFloat(item.salario_fijo).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr><td>Comisiones por Servicios</td><td style="text-align: right;">${parseFloat(item.comisiones).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr><td>Horas Extras</td><td style="text-align: right;">${parseFloat(item.horas_extras).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr><td>Feriados Trabajados</td><td style="text-align: right;">${parseFloat(item.feriados).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr><td>Otros Ingresos / Bonos</td><td style="text-align: right;">${parseFloat(item.otros_ingresos).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr style="font-weight: bold; background: #f0fdf4;"><td>TOTAL INGRESOS</td><td style="text-align: right; color: #16a34a;">RD$ ${parseFloat(item.total_ingresos).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
              </tbody>
            </table>
          </div>

          <div>
            <table>
              <thead><tr><th>DESCUENTOS</th><th style="text-align: right;">MONTO (RD$)</th></tr></thead>
              <tbody>
                <tr><td>TSS (AFP 2.87% + SFS 3.04%)</td><td style="text-align: right;">${parseFloat(item.tss).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr><td>Servicios / Consumos Salón</td><td style="text-align: right;">${parseFloat(item.servicios).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr><td>Préstamos y Anticipos</td><td style="text-align: right;">${parseFloat(item.prestamos).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr><td>Ausencias</td><td style="text-align: right;">${parseFloat(item.ausencias).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr><td>Tardanzas</td><td style="text-align: right;">${parseFloat(item.tardanzas).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr><td>Otros Descuentos</td><td style="text-align: right;">${parseFloat(item.otros_descuentos).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr style="font-weight: bold; background: #fef2f2;"><td>TOTAL DESCUENTOS</td><td style="text-align: right; color: #dc2626;">RD$ ${parseFloat(item.total_descuentos).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="total-box">
          <div style="font-size: 12px; font-weight: bold; color: #64748b; text-transform: uppercase;">MONTO NETO A DESEMBOLSAR</div>
          <div class="total-amount">RD$ ${parseFloat(item.neto_pagar).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
        </div>

        <div class="signatures">
          <div>
            <div class="sig-line">Firma del Colaborador</div>
            <div>${item.employee_name}</div>
          </div>
          <div>
            <div class="sig-line">Por la Administración</div>
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

  // Imprimir Nómina Completa
  const handlePrintFullPayroll = () => {
    const printWin = window.open('', '_blank');
    const rowsHtml = items.map((it, idx) => `
      <tr style="border-bottom: 1px solid #e2e8f0; font-size: 12px;">
        <td style="padding: 6px;">${idx + 1}</td>
        <td style="padding: 6px; font-weight: bold;">${it.employee_name}</td>
        <td style="padding: 6px;">${it.posicion}</td>
        <td style="padding: 6px;">${it.sucursal}</td>
        <td style="padding: 6px; text-align: right;">${parseFloat(it.salario_fijo).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
        <td style="padding: 6px; text-align: right;">${parseFloat(it.comisiones).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
        <td style="padding: 6px; text-align: right; color: #16a34a; font-weight: bold;">${parseFloat(it.total_ingresos).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
        <td style="padding: 6px; text-align: right;">${parseFloat(it.tss).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
        <td style="padding: 6px; text-align: right; color: #dc2626; font-weight: bold;">${parseFloat(it.total_descuentos).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
        <td style="padding: 6px; text-align: right; font-weight: 900; color: #0052cc;">RD$ ${parseFloat(it.neto_pagar).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
      </tr>
    `).join('');

    const content = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Planilla General de Nómina - ${currentPeriod?.period_name}</title>
        <style>
          body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 20px; color: #1e293b; }
          table { width: 100%; border-collapse: collapse; margin-top: 15px; }
          th { background: #0f172a; color: #fff; padding: 8px; font-size: 12px; text-align: left; }
          .summary-kpi { display: flex; gap: 20px; margin: 15px 0; font-size: 14px; }
          .kpi-card { background: #f8fafc; padding: 10px 15px; border-radius: 8px; border: 1px solid #cbd5e1; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <h2>ABATTE PELUQUERÍA / PLAN BEAUTY RD</h2>
        <h3>PLANILLA GENERAL DE NÓMINA · ${currentPeriod?.period_name}</h3>
        <p>Período: ${formatDateDisplay(currentPeriod?.start_date)} al ${formatDateDisplay(currentPeriod?.end_date)} | Estado: ${currentPeriod?.status}</p>

        <div class="summary-kpi">
          <div class="kpi-card"><strong>Empleados:</strong> ${summaryData.totalEmpleados}</div>
          <div class="kpi-card"><strong>Total Bruto:</strong> RD$ ${summaryData.totalIngresos.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
          <div class="kpi-card"><strong>Total Descuentos:</strong> RD$ ${summaryData.totalDescuentos.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
          <div class="kpi-card" style="background:#eff6ff; border-color:#93c5fd;"><strong>Total Neto a Desembolsar:</strong> RD$ ${summaryData.totalNeto.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
        </div>

        <table>
          <thead>
            <tr>
              <th>#</th><th>Empleado</th><th>Cargo</th><th>Sucursal</th>
              <th style="text-align: right;">S. Fijo</th><th style="text-align: right;">Comisiones</th>
              <th style="text-align: right;">T. Ingresos</th><th style="text-align: right;">TSS</th>
              <th style="text-align: right;">T. Descuentos</th><th style="text-align: right;">Neto Pagar</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>

        <script>window.onload = function() { window.print(); }</script>
      </body>
      </html>
    `;
    printWin.document.write(content);
    printWin.document.close();
  };

  return (
    <div className="payroll-module-container" style={{ padding: '1.5rem', maxWidth: '1600px', margin: '0 auto' }}>
      
      {/* PESTAÑAS PRINCIPALES SUPERIORES (Procesar Nómina | Histórico Inmutable | Regalías del Año) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', background: '#f1f5f9', padding: '6px', borderRadius: '14px' }}>
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
            onClick={() => setMainTab('historical')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.65rem 1.4rem',
              borderRadius: '10px',
              border: 'none',
              background: mainTab === 'historical' ? '#0f172a' : 'transparent',
              color: mainTab === 'historical' ? '#ffffff' : '#64748b',
              fontWeight: 800,
              fontSize: '0.9rem',
              cursor: 'pointer',
              boxShadow: mainTab === 'historical' ? '0 4px 14px rgba(15, 23, 42, 0.25)' : 'none',
              transition: 'all 0.2s ease'
            }}
          >
            <History size={18} style={{ color: mainTab === 'historical' ? '#38bdf8' : '#64748b' }} /> Histórico de Nóminas
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
            <Sparkles size={18} style={{ color: mainTab === 'regalias' ? '#d4af37' : '#64748b' }} /> Regalías del Año (Ley 16-92)
          </button>
        </div>

        {mainTab === 'payroll' && (
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button 
              onClick={() => setShowNewPeriodModal(true)}
              className="btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1.25rem', fontSize: '0.85rem', fontWeight: 800 }}
            >
              <Plus size={16} /> Generar Nueva Nómina
            </button>
          </div>
        )}
      </div>

      {mainTab === 'payroll' ? (
        <>
          {/* HEADER PRINCIPAL CON ESTADO Y SELECTOR DE PERÍODO */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1.5rem' }}>
            <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 900, color: '#0f172a', margin: '0 0 0.4rem 0', letterSpacing: '-0.02em' }}>
                Procesar nómina
              </h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <select
                  value={currentPeriod?.id || ''}
                  onChange={(e) => loadPeriodDetail(e.target.value)}
                  style={{
                    fontSize: '1.05rem',
                    fontWeight: 700,
                    color: '#0f172a',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '10px',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    cursor: 'pointer'
                  }}
                >
                  {periods.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.period_name} ({p.status})
                    </option>
                  ))}
                </select>

                {/* BADGE CON LAS FECHAS DEL PERÍODO FORMATEADAS */}
                {currentPeriod && (
                  <div style={{
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    color: '#1d4ed8',
                    padding: '4px 12px',
                    borderRadius: '20px',
                    fontSize: '0.8rem',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    <Calendar size={13} color="#0066ff" />
                    <span>{formatDateDisplay(currentPeriod.start_date)} al {formatDateDisplay(currentPeriod.end_date)}</span>
                  </div>
                )}

                <span style={{
                  background: currentPeriod?.status === 'Aprobada' ? '#dcfce7' : '#fef3c7',
                  color: currentPeriod?.status === 'Aprobada' ? '#15803d' : '#d97706',
                  padding: '4px 14px',
                  borderRadius: '20px',
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  border: currentPeriod?.status === 'Aprobada' ? '1px solid #86efac' : '1px solid #fde68a'
                }}>
                  {currentPeriod?.status === 'Aprobada' ? <Lock size={13} /> : <Edit2 size={13} />}
                  {currentPeriod?.status === 'Aprobada' ? 'Aprobada (Inmutable)' : 'Borrador (Editable)'}
                </span>

                {auditLogs.length > 0 && (
                  <button
                    onClick={() => setShowAuditModal(true)}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      color: '#475569',
                      padding: '4px 10px',
                      borderRadius: '12px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    <History size={13} color="#0066ff" /> {auditLogs.length} cambios auditados
                  </button>
                )}
              </div>
            </div>

            {/* BOTONES DE ACCIÓN SUPERIORES */}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {currentPeriod?.status !== 'Aprobada' && (
                <button 
                  onClick={handleSyncRealData}
                  disabled={loading}
                  className="btn-secondary"
                  style={{ background: '#ffffff', border: '1.5px solid #0066ff', color: '#0066ff', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1.2rem', borderRadius: '12px', fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer', boxShadow: '0 2px 6px rgba(0, 102, 255, 0.08)' }}
                  title="Recalcular con comisiones y descuentos reales actuales de la base de datos para este período"
                >
                  <RefreshCw size={16} /> Sincronizar Datos Reales
                </button>
              )}

              <button 
                onClick={() => setShowAuditModal(true)}
                className="btn-secondary"
                style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#334155', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1.2rem', borderRadius: '12px', fontWeight: 700, fontSize: '0.85rem' }}
              >
                <History size={16} /> Auditoría
              </button>

              <button 
                onClick={handlePrintFullPayroll}
                className="btn-secondary"
                style={{ background: '#ffffff', border: '1px solid #e2e8f0', color: '#334155', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1.2rem', borderRadius: '12px', fontWeight: 700, fontSize: '0.85rem' }}
              >
                <Printer size={16} /> Imprimir planilla
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

          {/* TARJETAS RESUMEN KPI EN VISTA PRINCIPAL */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem', boxShadow: '0 2px 6px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#64748b', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.4rem' }}>
                <Users size={16} color="#0066ff" /> Empleados
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#0f172a' }}>
                {summaryData.totalEmpleados}
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem', boxShadow: '0 2px 6px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#16a34a', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.4rem' }}>
                <ArrowUpRight size={16} /> Total Bruto / Ingresos
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#16a34a' }}>
                RD$ {summaryData.totalIngresos.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem', boxShadow: '0 2px 6px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#dc2626', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.4rem' }}>
                <ArrowDownRight size={16} /> Total Descuentos & TSS
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#dc2626' }}>
                RD$ {summaryData.totalDescuentos.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>

            <div style={{ background: '#eff6ff', border: '2px solid #93c5fd', borderRadius: '16px', padding: '1.25rem', boxShadow: '0 4px 12px rgba(0, 102, 255, 0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#1d4ed8', fontSize: '0.8rem', fontWeight: 800, marginBottom: '0.4rem' }}>
                <CreditCard size={16} /> Neto Total a Desembolsar
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#0052cc' }}>
                RD$ {summaryData.totalNeto.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          {/* BARRA DE FILTROS Y SELECTOR DE COLUMNAS */}
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
              <select 
                value={filterSucursal}
                onChange={(e) => setFilterSucursal(e.target.value)}
                className="input-field"
                style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: '10px', background: '#f8fafc', border: '1px solid #e2e8f0', fontWeight: 600, fontSize: '0.875rem' }}
              >
                <option value="Todas">Todas las sucursales</option>
                <option value="San Vicente">Abatte San Vicente</option>
                <option value="Villa Mella">Abatte Villa Mella</option>
                <option value="Disponibles (*)">Disponibles (*)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                Departamento / Cargo
              </label>
              <select 
                value={filterDepartamento}
                onChange={(e) => setFilterDepartamento(e.target.value)}
                className="input-field"
                style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: '10px', background: '#f8fafc', border: '1px solid #e2e8f0', fontWeight: 600, fontSize: '0.875rem' }}
              >
                <option value="Todos">Todos los cargos</option>
                <option value="Estilista">Estilistas / Peluqueras</option>
                <option value="Barbero">Barberos</option>
                <option value="Manicurista">Manicuristas</option>
                <option value="Recepción">Recepción / Caja</option>
                <option value="Administración">Administración</option>
                <option value="Soporte">Soporte / Mantenimiento</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                Buscar colaborador
              </label>
              <div style={{ position: 'relative' }}>
                <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)' }} />
                <input 
                  type="text"
                  placeholder="Nombre o cargo..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.65rem 1rem 0.65rem 2.4rem',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                    background: '#f8fafc',
                    fontSize: '0.875rem',
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            {/* SELECTOR DE COLUMNAS VISIBLES (CASILLAS) */}
            <div style={{ position: 'relative' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                Columnas de Tabla
              </label>
              <button
                type="button"
                onClick={() => setShowColumnsPopover(prev => !prev)}
                style={{
                  width: '100%',
                  padding: '0.65rem 1rem',
                  borderRadius: '10px',
                  background: showColumnsPopover ? '#eff6ff' : '#f8fafc',
                  border: showColumnsPopover ? '1.5px solid #0066ff' : '1px solid #e2e8f0',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  color: '#1e293b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  gap: '0.5rem',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Sliders size={15} color="#0066ff" />
                  <span>Columnas ({Object.values(visibleColumns).filter(Boolean).length}/14)</span>
                </span>
                <ChevronDown size={14} color="#64748b" style={{ transform: showColumnsPopover ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
              </button>

              {/* POPOVER FLOTANTE DE CASILLAS */}
              {showColumnsPopover && (
                <div 
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    right: 0,
                    zIndex: 50,
                    background: '#ffffff',
                    borderRadius: '16px',
                    border: '1px solid #cbd5e1',
                    boxShadow: '0 12px 36px rgba(15, 23, 42, 0.18)',
                    padding: '1.25rem',
                    minWidth: '320px',
                    maxWidth: '380px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.5rem' }}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a' }}>Ocultar / Mostrar Columnas</strong>
                    <button 
                      type="button" 
                      onClick={() => setShowColumnsPopover(false)} 
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div style={{ maxHeight: '300px', overflowY: 'auto', paddingRight: '4px' }}>
                    {/* GRUPO INGRESOS */}
                    <div style={{ marginBottom: '0.85rem' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#0066ff', textTransform: 'uppercase', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <ArrowUpRight size={12} /> Ingresos
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem' }}>
                        {[
                          { key: 'salario_fijo', label: 'S. Fijo' },
                          { key: 'comisiones', label: 'Comisiones' },
                          { key: 'feriados', label: 'Feriados' },
                          { key: 'horas_extras', label: 'H. Extras' },
                          { key: 'otros_ingresos', label: 'Otros Ing.' },
                          { key: 'total_ingresos', label: 'Total Ingresos' }
                        ].map(col => (
                          <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: '#334155', cursor: 'pointer', background: visibleColumns[col.key] ? '#eff6ff' : '#f8fafc', padding: '4px 7px', borderRadius: '6px', border: '1px solid', borderColor: visibleColumns[col.key] ? '#bfdbfe' : '#e2e8f0' }}>
                            <input 
                              type="checkbox"
                              checked={!!visibleColumns[col.key]}
                              onChange={() => handleToggleColumn(col.key)}
                              style={{ accentColor: '#0066ff', cursor: 'pointer' }}
                            />
                            <span style={{ fontWeight: visibleColumns[col.key] ? 700 : 500 }}>{col.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* GRUPO DESCUENTOS */}
                    <div style={{ marginBottom: '0.85rem' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#dc2626', textTransform: 'uppercase', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <ArrowDownRight size={12} /> Descuentos
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem' }}>
                        {[
                          { key: 'tss', label: 'TSS (Ley)' },
                          { key: 'servicios', label: 'Servicios' },
                          { key: 'prestamos', label: 'Préstamos' },
                          { key: 'ausencias', label: 'Ausencias' },
                          { key: 'tardanzas', label: 'Tardanzas' },
                          { key: 'otros_descuentos', label: 'Otros Desc.' },
                          { key: 'total_descuentos', label: 'Total Descuentos' }
                        ].map(col => (
                          <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: '#334155', cursor: 'pointer', background: visibleColumns[col.key] ? '#fef2f2' : '#f8fafc', padding: '4px 7px', borderRadius: '6px', border: '1px solid', borderColor: visibleColumns[col.key] ? '#fecaca' : '#e2e8f0' }}>
                            <input 
                              type="checkbox"
                              checked={!!visibleColumns[col.key]}
                              onChange={() => handleToggleColumn(col.key)}
                              style={{ accentColor: '#dc2626', cursor: 'pointer' }}
                            />
                            <span style={{ fontWeight: visibleColumns[col.key] ? 700 : 500 }}>{col.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* GRUPO NETO */}
                    <div>
                      <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#16a34a', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                        A Desembolsar
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: '#334155', cursor: 'pointer', background: visibleColumns.neto_pagar ? '#f0fdf4' : '#f8fafc', padding: '4px 7px', borderRadius: '6px', border: '1px solid', borderColor: visibleColumns.neto_pagar ? '#bbf7d0' : '#e2e8f0' }}>
                        <input 
                          type="checkbox"
                          checked={!!visibleColumns.neto_pagar}
                          onChange={() => handleToggleColumn('neto_pagar')}
                          style={{ accentColor: '#16a34a', cursor: 'pointer' }}
                        />
                        <span style={{ fontWeight: visibleColumns.neto_pagar ? 800 : 500 }}>Neto a Pagar</span>
                      </label>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.85rem', paddingTop: '0.65rem', borderTop: '1px solid #f1f5f9', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={() => handleSetAllColumns(true)}
                      style={{ background: '#f1f5f9', border: 'none', padding: '4px 8px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 700, color: '#475569', cursor: 'pointer' }}
                    >
                      Mostrar todas
                    </button>
                    <button
                      type="button"
                      onClick={handleSetEssentialColumns}
                      style={{ background: '#eff6ff', border: 'none', padding: '4px 8px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 700, color: '#0066ff', cursor: 'pointer' }}
                    >
                      Solo esenciales
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* BARRA FLOTANTE DE ACCIONES MASIVAS */}
          {selectedItemIds.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                background: '#0f172a',
                color: '#ffffff',
                borderRadius: '14px',
                padding: '0.85rem 1.5rem',
                marginBottom: '1rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '1rem',
                boxShadow: '0 8px 24px rgba(15, 23, 42, 0.25)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ background: '#0066ff', padding: '4px 12px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 900 }}>
                  {selectedItemIds.length} seleccionados
                </span>
                <span style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
                  Aplica cambios en lote a los colaboradores seleccionados.
                </span>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <button
                  onClick={() => setShowBulkModal(true)}
                  disabled={currentPeriod?.status === 'Aprobada'}
                  style={{
                    background: '#0066ff',
                    border: 'none',
                    color: '#ffffff',
                    padding: '0.5rem 1.25rem',
                    borderRadius: '10px',
                    fontWeight: 800,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}
                >
                  <Plus size={16} /> Aplicar Concepto Masivo
                </button>

                {undoStack.length > 0 && currentPeriod?.status !== 'Aprobada' && (
                  <button
                    onClick={handleUndo}
                    style={{
                      background: 'rgba(255,255,255,0.15)',
                      border: '1px solid rgba(255,255,255,0.3)',
                      color: '#ffffff',
                      padding: '0.5rem 1rem',
                      borderRadius: '10px',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem'
                    }}
                  >
                    <RotateCcw size={15} /> Deshacer ({undoStack.length})
                  </button>
                )}

                <button
                  onClick={() => setSelectedItemIds([])}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 600
                  }}
                >
                  Deseleccionar
                </button>
              </div>
            </motion.div>
          )}

          {/* TABLA PRINCIPAL DE NÓMINA */}
          {(() => {
            const ingresosCount = [
              visibleColumns.salario_fijo,
              visibleColumns.comisiones,
              visibleColumns.feriados,
              visibleColumns.horas_extras,
              visibleColumns.otros_ingresos,
              visibleColumns.total_ingresos
            ].filter(Boolean).length;

            const descuentosCount = [
              visibleColumns.tss,
              visibleColumns.servicios,
              visibleColumns.prestamos,
              visibleColumns.ausencias,
              visibleColumns.tardanzas,
              visibleColumns.otros_descuentos,
              visibleColumns.total_descuentos
            ].filter(Boolean).length;

            return (
              <div style={{
                background: '#ffffff',
                borderRadius: '20px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
                overflow: 'hidden',
                marginBottom: '1.5rem'
              }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                    <thead>
                      {/* Fila Superior de Grupos */}
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
                        <th style={{ padding: '0.85rem 1rem', color: '#64748b', fontWeight: 800 }}>Colaborador</th>
                        <th style={{ padding: '0.85rem 1rem', color: '#64748b', fontWeight: 700 }}>Posición</th>
                        <th style={{ padding: '0.85rem 1rem', color: '#64748b', fontWeight: 700 }}>Sucursal</th>
                        
                        {/* Grupo Ingresos */}
                        {ingresosCount > 0 && (
                          <th colSpan={ingresosCount} style={{ background: '#eff6ff', color: '#1e40af', fontWeight: 900, textAlign: 'center', borderLeft: '1px solid #dbeafe', borderRight: '1px solid #dbeafe', padding: '0.6rem' }}>
                            Ingresos (RD$)
                          </th>
                        )}

                        {/* Grupo Descuentos */}
                        {descuentosCount > 0 && (
                          <th colSpan={descuentosCount} style={{ background: '#fef2f2', color: '#991b1b', fontWeight: 900, textAlign: 'center', borderRight: '1px solid #fee2e2', padding: '0.6rem' }}>
                            Descuentos (RD$)
                          </th>
                        )}

                        {/* A Pagar */}
                        {visibleColumns.neto_pagar && (
                          <th style={{ background: '#f0fdf4', color: '#166534', fontWeight: 900, textAlign: 'right', padding: '0.85rem 1.25rem' }}>
                            Neto a pagar (RD$)
                          </th>
                        )}
                        <th style={{ background: '#f8fafc', textAlign: 'center', padding: '0.85rem 1rem', color: '#64748b', fontWeight: 700 }}>
                          Acciones
                        </th>
                      </tr>

                      {/* Fila Inferior con Columnas Individuales */}
                      <tr style={{ background: '#ffffff', borderBottom: '2px solid #e2e8f0', fontSize: '0.75rem', color: '#64748b', fontWeight: 700 }}>
                        <th colSpan="5"></th>
                        
                        {/* Columnas Ingresos */}
                        {visibleColumns.salario_fijo && <th style={{ background: '#f8faff', padding: '0.6rem 0.75rem', textAlign: 'right', borderLeft: '1px solid #dbeafe' }}>S. Fijo</th>}
                        {visibleColumns.comisiones && <th style={{ background: '#f8faff', padding: '0.6rem 0.75rem', textAlign: 'right' }}>Comisiones</th>}
                        {visibleColumns.feriados && <th style={{ background: '#f8faff', padding: '0.6rem 0.75rem', textAlign: 'right' }}>Feriados</th>}
                        {visibleColumns.horas_extras && <th style={{ background: '#f8faff', padding: '0.6rem 0.75rem', textAlign: 'right' }}>H. Extras</th>}
                        {visibleColumns.otros_ingresos && <th style={{ background: '#f8faff', padding: '0.6rem 0.75rem', textAlign: 'right' }}>Otros Ing.</th>}
                        {visibleColumns.total_ingresos && <th style={{ background: '#eff6ff', padding: '0.6rem 0.75rem', textAlign: 'right', fontWeight: 900, color: '#1d4ed8', borderRight: '1px solid #dbeafe' }}>Total Ingresos</th>}

                        {/* Columnas Descuentos */}
                        {visibleColumns.tss && (
                          <th style={{ background: '#fffafb', padding: '0.45rem 0.6rem', textAlign: 'right', verticalAlign: 'middle' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.35rem' }}>
                              <span>TSS (Ley)</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setBulkTssValue('591.00');
                                  setBulkTssMode('fixed');
                                  setBulkTssScope('all');
                                  setShowBulkTssModal(true);
                                }}
                                title="Asignar el mismo valor de TSS masivo a todos los empleados"
                                style={{
                                  background: '#fee2e2',
                                  color: '#b91c1c',
                                  border: '1px solid #fca5a5',
                                  borderRadius: '6px',
                                  padding: '2px 5px',
                                  fontSize: '0.65rem',
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '2px',
                                  lineHeight: 1,
                                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                  transition: 'all 0.15s ease'
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = '#fecaca'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = '#fee2e2'; }}
                              >
                                <Sliders size={10} />
                                <span>Fijar</span>
                              </button>
                            </div>
                          </th>
                        )}
                        {visibleColumns.servicios && <th style={{ background: '#fffafb', padding: '0.6rem 0.75rem', textAlign: 'right' }}>Servicios</th>}
                        {visibleColumns.prestamos && <th style={{ background: '#fffafb', padding: '0.6rem 0.75rem', textAlign: 'right' }}>Préstamos</th>}
                        {visibleColumns.ausencias && <th style={{ background: '#fffafb', padding: '0.6rem 0.75rem', textAlign: 'right' }}>Ausencias</th>}
                        {visibleColumns.tardanzas && <th style={{ background: '#fffafb', padding: '0.6rem 0.75rem', textAlign: 'right' }}>Tardanzas</th>}
                        {visibleColumns.otros_descuentos && <th style={{ background: '#fffafb', padding: '0.6rem 0.75rem', textAlign: 'right' }}>Otros Desc.</th>}
                        {visibleColumns.total_descuentos && <th style={{ background: '#fef2f2', padding: '0.6rem 0.75rem', textAlign: 'right', fontWeight: 900, color: '#b91c1c', borderRight: '1px solid #fee2e2' }}>Total Descuentos</th>}

                        {visibleColumns.neto_pagar && <th style={{ background: '#f0fdf4' }}></th>}
                        <th></th>
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
                            {visibleColumns.salario_fijo && (
                              <td style={{ padding: '1rem 0.75rem', textAlign: 'right', color: '#334155', borderLeft: '1px solid #f1f5f9' }}>
                                {parseFloat(item.salario_fijo || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </td>
                            )}
                            {visibleColumns.comisiones && (
                              <td style={{ padding: '1rem 0.75rem', textAlign: 'right', color: '#334155' }}>
                                {parseFloat(item.comisiones || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </td>
                            )}
                            {visibleColumns.feriados && (
                              <td style={{ padding: '1rem 0.75rem', textAlign: 'right', color: '#334155' }}>
                                {parseFloat(item.feriados || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </td>
                            )}
                            {visibleColumns.horas_extras && (
                              <td style={{ padding: '1rem 0.75rem', textAlign: 'right', color: '#334155' }}>
                                {parseFloat(item.horas_extras || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </td>
                            )}
                            {visibleColumns.otros_ingresos && (
                              <td style={{ padding: '1rem 0.75rem', textAlign: 'right', color: '#334155' }}>
                                {parseFloat(item.otros_ingresos || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </td>
                            )}
                            {visibleColumns.total_ingresos && (
                              <td style={{ padding: '1rem 0.75rem', textAlign: 'right', fontWeight: 800, color: '#0284c7', background: '#f0f9ff', borderRight: '1px solid #e0f2fe' }}>
                                {parseFloat(item.total_ingresos || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </td>
                            )}

                            {/* Descuentos */}
                            {visibleColumns.tss && (
                              <td style={{ padding: '1rem 0.75rem', textAlign: 'right', color: '#475569' }}>
                                {parseFloat(item.tss || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </td>
                            )}
                            {visibleColumns.servicios && (
                              <td style={{ padding: '1rem 0.75rem', textAlign: 'right', color: '#475569' }}>
                                {parseFloat(item.servicios || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </td>
                            )}
                            {visibleColumns.prestamos && (
                              <td style={{ padding: '1rem 0.75rem', textAlign: 'right', color: '#475569' }}>
                                {parseFloat(item.prestamos || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </td>
                            )}
                            {visibleColumns.ausencias && (
                              <td style={{ padding: '1rem 0.75rem', textAlign: 'right', color: '#475569' }}>
                                {parseFloat(item.ausencias || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </td>
                            )}
                            {visibleColumns.tardanzas && (
                              <td style={{ padding: '1rem 0.75rem', textAlign: 'right', color: '#475569' }}>
                                {parseFloat(item.tardanzas || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </td>
                            )}
                            {visibleColumns.otros_descuentos && (
                              <td style={{ padding: '1rem 0.75rem', textAlign: 'right', color: '#475569' }}>
                                {parseFloat(item.otros_descuentos || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </td>
                            )}
                            {visibleColumns.total_descuentos && (
                              <td style={{ padding: '1rem 0.75rem', textAlign: 'right', fontWeight: 800, color: '#dc2626', background: '#fff5f5', borderRight: '1px solid #fee2e2' }}>
                                {parseFloat(item.total_descuentos || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </td>
                            )}

                            {/* A Pagar */}
                            {visibleColumns.neto_pagar && (
                              <td style={{ padding: '1rem 1.25rem', textAlign: 'right', fontWeight: 900, color: '#16a34a', background: '#f0fdf4' }}>
                                RD$ {parseFloat(item.neto_pagar || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </td>
                            )}

                            {/* Acciones individuales */}
                            <td style={{ padding: '1rem', textAlign: 'center' }}>
                              <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                                <button
                                  onClick={() => handleOpenEmployeeModal(item, (currentPage - 1) * itemsPerPage + idx)}
                                  title="Ver / Editar Detalle"
                                  style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '5px 8px', borderRadius: '6px', cursor: 'pointer', color: '#334155' }}
                                >
                                  <Edit2 size={13} />
                                </button>
                                <button
                                  onClick={() => handlePrintSlip(item)}
                                  title="Imprimir Volante Individual"
                                  style={{ background: '#eff6ff', border: '1px solid #bfdbfe', padding: '5px 8px', borderRadius: '6px', cursor: 'pointer', color: '#0066ff' }}
                                >
                                  <Printer size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* BARRA DE PAGINACIÓN */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', background: '#ffffff', borderTop: '1px solid #f1f5f9', flexWrap: 'wrap', gap: '1rem' }}>
                  <div style={{ fontSize: '0.875rem', color: '#64748b', fontWeight: 600 }}>
                    Mostrando {paginatedItems.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0} - {Math.min(currentPage * itemsPerPage, filteredItems.length)} de {filteredItems.length} colaboradores
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
            );
          })()}

          {/* BARRA INFERIOR DE ACCIONES DE NÓMINA */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem', padding: '0.5rem 0 3rem' }}>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              {undoStack.length > 0 && currentPeriod?.status !== 'Aprobada' && (
                <button 
                  onClick={handleUndo}
                  className="btn-secondary"
                  style={{ background: '#f8fafc', border: '1px solid #cbd5e1', color: '#475569', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1.25rem', borderRadius: '12px', fontWeight: 700 }}
                >
                  <RotateCcw size={16} /> Deshacer último cambio ({undoStack.length})
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              {currentPeriod?.status !== 'Aprobada' && (
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
              )}

              {currentPeriod?.status !== 'Aprobada' ? (
                <button 
                  onClick={() => setShowApproveModal(true)}
                  disabled={loading}
                  style={{
                    background: '#0066ff',
                    border: 'none',
                    color: '#ffffff',
                    padding: '0.75rem 1.85rem',
                    borderRadius: '12px',
                    fontWeight: 900,
                    fontSize: '0.95rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(0, 102, 255, 0.35)'
                  }}
                >
                  <Check size={18} /> Aprobar nómina
                </button>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#dcfce7', border: '1px solid #86efac', color: '#15803d', padding: '0.75rem 1.5rem', borderRadius: '12px', fontWeight: 800, fontSize: '0.9rem' }}>
                  <Lock size={16} /> Nómina Aprobada e Inmutable
                </div>
              )}
            </div>
          </div>
        </>
      ) : mainTab === 'historical' ? (
        /* VISTA DE HISTÓRICO DE NÓMINAS APROBADAS */
        <PayrollHistoryView 
          periods={periods}
          onViewPeriod={(periodId) => {
            loadPeriodDetail(periodId);
            setMainTab('payroll');
          }}
          onRefresh={loadInitialData}
        />
      ) : (
        /* VISTA DE REGALÍAS DEL AÑO (SALARIO DE NAVIDAD LEY 16-92 RD) */
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h1 style={{ fontSize: '1.85rem', fontWeight: 900, color: '#0f172a', margin: '0 0 0.4rem 0' }}>
                Cálculo de Regalías del Año (Doble Sueldo)
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
      {/* MODAL 1: VOLANTE / DETALLE POR EMPLEADO INDIVIDUAL */}
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
                maxWidth: '960px',
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
                        Activo
                      </span>
                    </div>
                    <p style={{ margin: '0.2rem 0 0 0', color: '#64748b', fontSize: '0.875rem' }}>
                      {editingItem.posicion} · Abatte {editingItem.sucursal} · ID: {editingItem.employee_id}
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
                Período: {currentPeriod?.period_name} ({formatDateDisplay(currentPeriod?.start_date)} al {formatDateDisplay(currentPeriod?.end_date)})
              </div>

              {/* DOS COLUMNAS: INGRESOS Y DESCUENTOS */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                
                {/* COLUMNA 1: INGRESOS (VERDE) */}
                <div style={{ background: '#fafcfa', border: '1px solid #e2ece2', borderRadius: '18px', padding: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #e8f3e8', paddingBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#16a34a', fontWeight: 800 }}>
                      <ArrowUpRight size={18} />
                      <span>Ingresos</span>
                    </div>
                    {currentPeriod?.status !== 'Aprobada' && (
                      <button 
                        onClick={() => setNewConceptForm({ show: true, type: 'ingreso', label: '', amount: '' })}
                        style={{ background: '#ffffff', border: '1px solid #d1e7dd', color: '#0066ff', padding: '4px 10px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        <Plus size={13} /> Agregar ingreso
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {[
                      { label: 'Salario Fijo (Quincenal)', key: 'salario_fijo' },
                      { label: 'Comisiones por Servicios', key: 'comisiones' },
                      { label: 'Feriados Trabajados', key: 'feriados' },
                      { label: 'Horas Extras', key: 'horas_extras' },
                      { label: 'Otros Ingresos / Bonos', key: 'otros_ingresos' }
                    ].map(field => (
                      <div key={field.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>{field.label}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>RD$</span>
                          <input 
                            type="number"
                            step="0.01"
                            disabled={currentPeriod?.status === 'Aprobada'}
                            value={editingItem[field.key] || 0}
                            onChange={(e) => handleUpdateConceptValue('ingreso', field.key, e.target.value)}
                            style={{
                              width: '110px',
                              textAlign: 'right',
                              padding: '0.4rem 0.6rem',
                              borderRadius: '8px',
                              border: '1px solid #d8e2dc',
                              background: currentPeriod?.status === 'Aprobada' ? '#f1f5f9' : '#ffffff',
                              fontWeight: 700,
                              fontSize: '0.85rem'
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem', paddingTop: '1rem', borderTop: '2px dashed #d1e7dd' }}>
                    <span style={{ fontWeight: 800, color: '#166534', fontSize: '0.9rem' }}>Total ingresos</span>
                    <span style={{ fontWeight: 900, color: '#16a34a', fontSize: '1.25rem' }}>
                      RD$ {parseFloat(editingItem.total_ingresos || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
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
                    {currentPeriod?.status !== 'Aprobada' && (
                      <button 
                        onClick={() => setNewConceptForm({ show: true, type: 'descuento', label: '', amount: '' })}
                        style={{ background: '#ffffff', border: '1px solid #fcd5ce', color: '#0066ff', padding: '4px 10px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        <Plus size={13} /> Agregar descuento
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {[
                      { label: 'TSS (AFP 2.87% + SFS 3.04%)', key: 'tss' },
                      { label: 'Servicios de salón consumidos', key: 'servicios' },
                      { label: 'Préstamos y Anticipos', key: 'prestamos' },
                      { label: 'Ausencias no justificadas', key: 'ausencias' },
                      { label: 'Tardanzas', key: 'tardanzas' },
                      { label: 'Otros descuentos', key: 'otros_descuentos' }
                    ].map(field => (
                      <div key={field.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>{field.label}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>RD$</span>
                          <input 
                            type="number"
                            step="0.01"
                            disabled={currentPeriod?.status === 'Aprobada'}
                            value={editingItem[field.key] || 0}
                            onChange={(e) => handleUpdateConceptValue('descuento', field.key, e.target.value)}
                            style={{
                              width: '110px',
                              textAlign: 'right',
                              padding: '0.4rem 0.6rem',
                              borderRadius: '8px',
                              border: '1px solid #f0ded9',
                              background: currentPeriod?.status === 'Aprobada' ? '#f1f5f9' : '#ffffff',
                              fontWeight: 700,
                              fontSize: '0.85rem'
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem', paddingTop: '1rem', borderTop: '2px dashed #fcd5ce' }}>
                    <span style={{ fontWeight: 800, color: '#991b1b', fontSize: '0.9rem' }}>Total descuentos</span>
                    <span style={{ fontWeight: 900, color: '#dc2626', fontSize: '1.25rem' }}>
                      RD$ {parseFloat(editingItem.total_descuentos || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>

              {/* FORMULARIO INLINE PARA AGREGAR CONCEPTO DINÁMICO */}
              {newConceptForm.show && (
                <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '14px', padding: '1rem', marginBottom: '1.25rem' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.5rem' }}>
                    Agregar nuevo concepto de {newConceptForm.type === 'ingreso' ? 'Ingreso (+)' : 'Descuento (-)'}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: '0.75rem', alignItems: 'center' }}>
                    <input 
                      type="text"
                      placeholder="Nombre del concepto (ej. Incentivo transporte, Seguro complementario...)"
                      value={newConceptForm.label}
                      onChange={(e) => setNewConceptForm(prev => ({ ...prev, label: e.target.value }))}
                      style={{ padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                    />
                    <input 
                      type="number"
                      placeholder="Monto RD$"
                      value={newConceptForm.amount}
                      onChange={(e) => setNewConceptForm(prev => ({ ...prev, amount: e.target.value }))}
                      style={{ padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                    />
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        onClick={handleAddCustomConceptToEmployee}
                        style={{ background: '#0066ff', color: '#fff', border: 'none', padding: '0.5rem 1rem', borderRadius: '8px', fontWeight: 800, cursor: 'pointer', fontSize: '0.85rem' }}
                      >
                        Agregar
                      </button>
                      <button
                        onClick={() => setNewConceptForm({ show: false, type: 'ingreso', label: '', amount: '' })}
                        style={{ background: '#e2e8f0', color: '#334155', border: 'none', padding: '0.5rem 0.75rem', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* MOTIVO DEL AJUSTE MANUAL (PARA AUDITORÍA) */}
              {currentPeriod?.status !== 'Aprobada' && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>
                    Motivo del cambio manual (opcional para auditoría):
                  </label>
                  <input 
                    type="text"
                    placeholder="Ej. Ajuste de horas extras por jornada especial / Corrección de propina..."
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                    style={{ width: '100%', padding: '0.55rem 0.85rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                  />
                </div>
              )}

              {/* BANNER INFERIOR MONTO NETO A PAGAR */}
              <div style={{
                background: '#f0f7ff',
                border: '1px solid #d0e5ff',
                borderRadius: '16px',
                padding: '1.25rem 1.5rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '1.75rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: '#e0efff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0066ff' }}>
                    <CreditCard size={24} />
                  </div>
                  <div>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b', display: 'block' }}>
                      Monto neto a pagar al colaborador
                    </span>
                    <span style={{ fontSize: '1.75rem', fontWeight: 900, color: '#0052cc' }}>
                      RD$ {parseFloat(editingItem.neto_pagar || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                <div style={{ fontSize: '0.8rem', color: '#64748b', textAlign: 'right' }}>
                  <div>Ingresos: <strong>RD$ {parseFloat(editingItem.total_ingresos || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></div>
                  <div>Descuentos: <strong>- RD$ {parseFloat(editingItem.total_descuentos || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></div>
                </div>
              </div>

              {/* BOTONES INFERIORES */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  onClick={() => handlePrintSlip(editingItem)}
                  className="btn-secondary"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.25rem', borderRadius: '12px', fontWeight: 700 }}
                >
                  <Printer size={16} /> Imprimir Volante de Pago
                </button>

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button
                    onClick={() => setShowEmployeeModal(false)}
                    className="btn-secondary"
                    style={{ padding: '0.75rem 1.5rem', borderRadius: '12px', fontWeight: 700 }}
                  >
                    Cerrar
                  </button>
                  {currentPeriod?.status !== 'Aprobada' && (
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
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* MODAL 2: APLICAR CONCEPTO MASIVO */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {showBulkModal && (
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
                maxWidth: '600px',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                padding: '2rem'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div>
                  <h2 style={{ fontSize: '1.35rem', fontWeight: 900, color: '#0f172a', margin: 0 }}>
                    Aplicar Concepto Masivo
                  </h2>
                  <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0.25rem 0 0 0' }}>
                    Aplicarás este concepto a <strong>{selectedItemIds.length} colaboradores</strong> seleccionados.
                  </p>
                </div>
                <button 
                  onClick={() => setShowBulkModal(false)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleApplyBulkConcept} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                    Tipo de Concepto
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <button
                      type="button"
                      onClick={() => setBulkForm(prev => ({ ...prev, concept_type: 'Ingreso' }))}
                      style={{
                        padding: '0.65rem',
                        borderRadius: '10px',
                        border: bulkForm.concept_type === 'Ingreso' ? '2px solid #16a34a' : '1px solid #cbd5e1',
                        background: bulkForm.concept_type === 'Ingreso' ? '#f0fdf4' : '#ffffff',
                        color: bulkForm.concept_type === 'Ingreso' ? '#16a34a' : '#475569',
                        fontWeight: 800,
                        cursor: 'pointer'
                      }}
                    >
                      + Ingreso / Bono
                    </button>

                    <button
                      type="button"
                      onClick={() => setBulkForm(prev => ({ ...prev, concept_type: 'Descuento' }))}
                      style={{
                        padding: '0.65rem',
                        borderRadius: '10px',
                        border: bulkForm.concept_type === 'Descuento' ? '2px solid #dc2626' : '1px solid #cbd5e1',
                        background: bulkForm.concept_type === 'Descuento' ? '#fef2f2' : '#ffffff',
                        color: bulkForm.concept_type === 'Descuento' ? '#dc2626' : '#475569',
                        fontWeight: 800,
                        cursor: 'pointer'
                      }}
                    >
                      - Descuento / Deducción
                    </button>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                    Nombre del Concepto
                  </label>
                  <select
                    value={bulkForm.concept_label}
                    onChange={(e) => setBulkForm(prev => ({ ...prev, concept_label: e.target.value }))}
                    className="input-field"
                    style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: '10px', fontWeight: 600 }}
                  >
                    {bulkForm.concept_type === 'Ingreso' ? (
                      <>
                        <option value="Bono de Desempeño">Bono de Desempeño</option>
                        <option value="Incentivo de Puntualidad">Incentivo de Puntualidad</option>
                        <option value="Ajuste Horas Extras">Ajuste Horas Extras</option>
                        <option value="Bono Feriado">Bono Feriado</option>
                        <option value="Otro...">Otro concepto personalizado...</option>
                      </>
                    ) : (
                      <>
                        <option value="Descuento Uniforme">Descuento Uniforme</option>
                        <option value="Seguro Complementario">Seguro Complementario</option>
                        <option value="Anticipo Extra">Anticipo Extraordinario</option>
                        <option value="Ajuste Ausencias">Ajuste Ausencias</option>
                        <option value="Otro...">Otro concepto personalizado...</option>
                      </>
                    )}
                  </select>

                  {bulkForm.concept_label === 'Otro...' && (
                    <input 
                      type="text"
                      placeholder="Escribe el nombre del concepto..."
                      value={bulkForm.custom_label}
                      onChange={(e) => setBulkForm(prev => ({ ...prev, custom_label: e.target.value }))}
                      style={{ width: '100%', marginTop: '0.5rem', padding: '0.6rem 0.85rem', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                      required
                    />
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                      Monto (RD$)
                    </label>
                    <input 
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={bulkForm.amount}
                      onChange={(e) => setBulkForm(prev => ({ ...prev, amount: e.target.value }))}
                      style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 800 }}
                      required
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                      Modo de Aplicación
                    </label>
                    <select
                      value={bulkForm.operation}
                      onChange={(e) => setBulkForm(prev => ({ ...prev, operation: e.target.value }))}
                      className="input-field"
                      style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: '10px', fontWeight: 600 }}
                    >
                      <option value="add">Sumar al monto existente</option>
                      <option value="set">Fijar este valor exacto</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                    Motivo / Justificación (Auditoría)
                  </label>
                  <input 
                    type="text"
                    placeholder="Ej. Aprobado por Gerencia General para el período..."
                    value={bulkForm.reason}
                    onChange={(e) => setBulkForm(prev => ({ ...prev, reason: e.target.value }))}
                    style={{ width: '100%', padding: '0.6rem 0.85rem', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                  />
                </div>

                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '0.85rem' }}>
                  <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: '0.25rem' }}>Vista previa de impacto:</div>
                  <div style={{ color: '#475569' }}>
                    Se aplicará <strong>RD$ {parseFloat(bulkForm.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong> como <strong>{bulkForm.concept_type}</strong> a <strong>{selectedItemIds.length} colaboradores</strong>.
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => setShowBulkModal(false)}
                    className="btn-secondary"
                    style={{ padding: '0.7rem 1.5rem', borderRadius: '10px', fontWeight: 700 }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    style={{
                      background: '#0066ff',
                      border: 'none',
                      color: '#ffffff',
                      padding: '0.7rem 1.75rem',
                      borderRadius: '10px',
                      fontWeight: 800,
                      cursor: 'pointer'
                    }}
                  >
                    Confirmar y Aplicar
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* MODAL: ASIGNACIÓN MASIVA DE TSS (LEY) */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {showBulkTssModal && (
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
                maxWidth: '560px',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                padding: '2rem'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: '#fef2f2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Sliders size={22} />
                  </div>
                  <div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#0f172a', margin: 0 }}>
                      Asignación Masiva de TSS (Ley)
                    </h2>
                    <p style={{ color: '#64748b', fontSize: '0.8rem', margin: '0.2rem 0 0 0' }}>
                      Establece un valor uniforme de TSS o recalcula la tasa oficial de Ley.
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowBulkTssModal(false)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleApplyBulkTss} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Modo de asignación */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                    Modo de Operación
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <button
                      type="button"
                      onClick={() => setBulkTssMode('fixed')}
                      style={{
                        padding: '0.75rem 0.5rem',
                        borderRadius: '12px',
                        border: bulkTssMode === 'fixed' ? '2px solid #dc2626' : '1px solid #cbd5e1',
                        background: bulkTssMode === 'fixed' ? '#fef2f2' : '#ffffff',
                        color: bulkTssMode === 'fixed' ? '#991b1b' : '#475569',
                        fontWeight: 800,
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '0.2rem'
                      }}
                    >
                      <span>Monto Fijo Uniforme</span>
                      <span style={{ fontSize: '0.7rem', fontWeight: 600, opacity: 0.8 }}>Mismo valor a todos</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setBulkTssMode('law_percentage')}
                      style={{
                        padding: '0.75rem 0.5rem',
                        borderRadius: '12px',
                        border: bulkTssMode === 'law_percentage' ? '2px solid #0284c7' : '1px solid #cbd5e1',
                        background: bulkTssMode === 'law_percentage' ? '#f0f9ff' : '#ffffff',
                        color: bulkTssMode === 'law_percentage' ? '#0369a1' : '#475569',
                        fontWeight: 800,
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '0.2rem'
                      }}
                    >
                      <span>Cálculo Automático Ley</span>
                      <span style={{ fontSize: '0.7rem', fontWeight: 600, opacity: 0.8 }}>5.91% de salario base</span>
                    </button>
                  </div>
                </div>

                {/* Input de Monto Fijo si está en modo fixed */}
                {bulkTssMode === 'fixed' && (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                      Valor de TSS a Asignar (RD$)
                    </label>
                    <input 
                      type="number"
                      step="0.01"
                      placeholder="591.00"
                      value={bulkTssValue}
                      onChange={(e) => setBulkTssValue(e.target.value)}
                      style={{ 
                        width: '100%', 
                        padding: '0.75rem 1rem', 
                        borderRadius: '12px', 
                        border: '1px solid #cbd5e1', 
                        fontWeight: 900,
                        fontSize: '1.1rem',
                        color: '#b91c1c'
                      }}
                      required
                    />

                    {/* Botones de valores rápidos comunes */}
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700 }}>Valores rápidos:</span>
                      {['591.00', '561.45', '600.00', '0.00'].map(val => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setBulkTssValue(val)}
                          style={{
                            background: bulkTssValue === val ? '#fee2e2' : '#f1f5f9',
                            color: bulkTssValue === val ? '#991b1b' : '#334155',
                            border: `1px solid ${bulkTssValue === val ? '#fca5a5' : '#e2e8f0'}`,
                            padding: '0.25rem 0.6rem',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          RD$ {val}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Alcance del cambio */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                    Aplicar a:
                  </label>
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: '#334155', cursor: 'pointer', fontWeight: 600 }}>
                      <input 
                        type="radio" 
                        name="bulkTssScope" 
                        checked={bulkTssScope === 'all'} 
                        onChange={() => setBulkTssScope('all')} 
                      />
                      Todos los colaboradores del período ({items.length})
                    </label>
                    {selectedItemIds.length > 0 && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: '#334155', cursor: 'pointer', fontWeight: 600 }}>
                        <input 
                          type="radio" 
                          name="bulkTssScope" 
                          checked={bulkTssScope === 'selected'} 
                          onChange={() => setBulkTssScope('selected')} 
                        />
                        Solo seleccionados ({selectedItemIds.length})
                      </label>
                    )}
                  </div>
                </div>

                {/* Resumen de impacto */}
                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '14px', border: '1px solid #e2e8f0', fontSize: '0.84rem' }}>
                  <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: '0.2rem' }}>Resumen del cambio:</div>
                  <div style={{ color: '#475569', lineHeight: 1.4 }}>
                    {bulkTssMode === 'law_percentage' ? (
                      <span>Se recalculará automáticamente el <strong>5.91% de TSS legal</strong> basado en el salario fijo de cada colaborador.</span>
                    ) : (
                      <span>Se fijará la retención de TSS en <strong>RD$ {parseFloat(bulkTssValue || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong> a cada colaborador. Los totales de descuentos y neto a pagar se recalcularán automáticamente.</span>
                    )}
                  </div>
                </div>

                {/* Botones de acción */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => setShowBulkTssModal(false)}
                    className="btn-secondary"
                    style={{ padding: '0.7rem 1.5rem', borderRadius: '10px', fontWeight: 700 }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    style={{
                      background: '#dc2626',
                      border: 'none',
                      color: '#ffffff',
                      padding: '0.7rem 1.75rem',
                      borderRadius: '10px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      boxShadow: '0 2px 8px rgba(220, 38, 38, 0.25)'
                    }}
                  >
                    {loading ? 'Aplicando...' : 'Aplicar TSS Masivo'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* MODAL 3: CONFIRMACIÓN DE APROBACIÓN DE NÓMINA (INMUTABLE) */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {showApproveModal && currentPeriod && (
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.7)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1.5rem'
          }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              style={{
                background: '#ffffff',
                borderRadius: '24px',
                width: '100%',
                maxWidth: '620px',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.3)',
                padding: '2.5rem'
              }}
            >
              <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
                <div style={{ width: '64px', height: '64px', borderRadius: '20px', background: '#eff6ff', color: '#0066ff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem auto' }}>
                  <ShieldAlert size={32} />
                </div>
                <h2 style={{ fontSize: '1.6rem', fontWeight: 900, color: '#0f172a', margin: '0 0 0.5rem 0' }}>
                  Aprobar Nómina Definitiva
                </h2>
                <p style={{ color: '#64748b', fontSize: '0.9rem', margin: 0 }}>
                  Por favor confirma los detalles de la nómina antes de proceder al cierre oficial.
                </p>
              </div>

              <div style={{ background: '#f8fafc', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '1.25rem', marginBottom: '1.5rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.85rem' }}>
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontSize: '0.75rem' }}>Período</span>
                    <strong style={{ color: '#0f172a', fontSize: '0.95rem' }}>{currentPeriod.period_name}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontSize: '0.75rem' }}>Fechas</span>
                    <strong style={{ color: '#0f172a' }}>{formatDateDisplay(currentPeriod.start_date)} al {formatDateDisplay(currentPeriod.end_date)}</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontSize: '0.75rem' }}>Cantidad de Colaboradores</span>
                    <strong style={{ color: '#0066ff', fontSize: '1.1rem' }}>{summaryData.totalEmpleados} colaboradores</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontSize: '0.75rem' }}>Monto Total a Desembolsar</span>
                    <strong style={{ color: '#16a34a', fontSize: '1.2rem' }}>RD$ {summaryData.totalNeto.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong>
                  </div>
                </div>
              </div>

              {/* ALERTA DE INMUTABILIDAD Y LIQUIDACIÓN AUTOMÁTICA */}
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '14px', padding: '1.15rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.75rem' }}>
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                  <Lock size={18} color="#0066ff" />
                  <strong style={{ color: '#1e40af', fontSize: '0.875rem' }}>Acciones automáticas al aprobar:</strong>
                </div>
                <ul style={{ margin: 0, paddingLeft: '1.4rem', color: '#1e3a8a', fontSize: '0.825rem', lineHeight: '1.5' }}>
                  <li><strong>Descuentos y Préstamos:</strong> Se marcarán automáticamente como <em>Saldados</em> en el módulo de descuentos para que no se vuelvan a descontar.</li>
                  <li><strong>Comisiones por Servicios:</strong> Se registrarán como <em>Pagadas</em> en el historial de comisiones de la quincena.</li>
                  <li><strong>Inmutabilidad:</strong> El período quedará congelado e inmutable para histórico contable.</li>
                </ul>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.3rem' }}>
                  Aprobado por:
                </label>
                <input 
                  type="text"
                  value={approverName}
                  onChange={(e) => setApproverName(e.target.value)}
                  style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => setShowApproveModal(false)}
                  className="btn-secondary"
                  style={{ padding: '0.75rem 1.5rem', borderRadius: '12px', fontWeight: 700 }}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleApprovePayrollConfirm}
                  disabled={loading}
                  style={{
                    background: '#16a34a',
                    border: 'none',
                    color: '#ffffff',
                    padding: '0.75rem 2rem',
                    borderRadius: '12px',
                    fontWeight: 900,
                    cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(22, 163, 74, 0.35)'
                  }}
                >
                  Confirmar y Aprobar Nómina
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* MODAL 4: RESUMEN DE NÓMINA CON GRÁFICOS Y DESGLOSE */}
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
                    Resumen general de nómina
                  </h2>
                  <p style={{ color: '#64748b', margin: 0, fontWeight: 600, fontSize: '0.9rem' }}>
                    {currentPeriod?.period_name} ({formatDateDisplay(currentPeriod?.start_date)} al {formatDateDisplay(currentPeriod?.end_date)})
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <button 
                    onClick={() => setShowSummaryModal(false)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                  >
                    <X size={22} />
                  </button>
                </div>
              </div>

              {/* 4 TARJETAS KPI */}
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
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', display: 'block' }}>Total Ingresos</span>
                    <span style={{ fontSize: '1.15rem', fontWeight: 900, color: '#16a34a' }}>
                      RD$ {summaryData.totalIngresos.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#fef2f2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ArrowDownRight size={22} />
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', display: 'block' }}>Total Descuentos</span>
                    <span style={{ fontSize: '1.15rem', fontWeight: 900, color: '#dc2626' }}>
                      RD$ {summaryData.totalDescuentos.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                <div style={{ background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: '16px', padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#ffffff', color: '#0066ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CreditCard size={22} />
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#1d4ed8', display: 'block' }}>Neto a Pagar</span>
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
                  Desglose de Ingresos
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
                  Desglose de Descuentos & TSS
                </button>
              </div>

              {/* GRÁFICO CIRCULAR + TABLA DE DESGLOSE */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '3rem', alignItems: 'center', marginBottom: '2.5rem' }}>
                
                {/* DONUT SVG INTERACTIVO */}
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative' }}>
                  <svg width="280" height="280" viewBox="0 0 280 280">
                    <circle cx="140" cy="140" r="100" fill="transparent" stroke="#f1f5f9" strokeWidth="32" />
                    
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
                    <div style={{ fontSize: '1.3rem', fontWeight: 900, color: '#0f172a' }}>
                      RD$ {(summaryTab === 'ingresos' ? summaryData.totalIngresos : summaryData.totalDescuentos).toLocaleString('en-US', { minimumFractionDigits: 0 })}
                    </div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b' }}>
                      Total {summaryTab}
                    </div>
                  </div>
                </div>

                {/* TABLA DE PORCENTAJES */}
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
                            RD$ {row.monto.toLocaleString('en-US', { minimumFractionDigits: 2 })}
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
                  Cerrar Resumen
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* MODAL 5: HISTORIAL DE AUDITORÍA DE NÓMINA */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {showAuditModal && (
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
                maxWidth: '900px',
                maxHeight: '85vh',
                overflowY: 'auto',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                padding: '2rem'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div>
                  <h2 style={{ fontSize: '1.4rem', fontWeight: 900, color: '#0f172a', margin: 0 }}>
                    Registro de Auditoría de Nómina
                  </h2>
                  <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0.2rem 0 0 0' }}>
                    Trazabilidad de todos los cambios manuales y modificaciones aplicadas al período.
                  </p>
                </div>
                <button 
                  onClick={() => setShowAuditModal(false)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                >
                  <X size={22} />
                </button>
              </div>

              {auditLogs.length > 0 ? (
                <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '14px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 800 }}>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Fecha / Hora</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Colaborador</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Campo / Concepto</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Valor Original</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Nuevo Valor</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Tipo</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Motivo</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Usuario</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map((log, i) => (
                        <tr key={log.id || i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>
                            {new Date(log.created_at).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' })}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#0f172a' }}>
                            {log.employee_name || 'Nómina General'}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: '#334155' }}>
                            {log.field_name}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#dc2626', fontWeight: 600 }}>
                            RD$ {log.old_value}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#16a34a', fontWeight: 800 }}>
                            RD$ {log.new_value}
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: '8px',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              background: log.action_type === 'Aprobación Definitiva' ? '#dcfce7' : '#f1f5f9',
                              color: log.action_type === 'Aprobación Definitiva' ? '#15803d' : '#475569'
                            }}>
                              {log.action_type}
                            </span>
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>
                            {log.reason || 'Sin motivo especificado'}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: '#475569', fontWeight: 600 }}>
                            {log.user_name}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                  <History size={36} color="#cbd5e1" style={{ marginBottom: '0.75rem' }} />
                  <p style={{ margin: 0, fontWeight: 600 }}>No hay cambios manuales registrados en este período.</p>
                </div>
              )}

              <div style={{ textAlign: 'right', marginTop: '1.5rem' }}>
                <button
                  onClick={() => setShowAuditModal(false)}
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

      {/* ========================================================================= */}
      {/* MODAL 6: CREAR / GENERAR NUEVA NÓMINA */}
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
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              style={{
                background: '#ffffff',
                borderRadius: '24px',
                width: '100%',
                maxWidth: '560px',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                padding: '2.5rem'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 900, color: '#0f172a', margin: 0 }}>
                  Generar Nuevo Período de Nómina
                </h2>
                <button 
                  onClick={() => setShowNewPeriodModal(false)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleCreateNewPeriod} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                    Nombre del Período
                  </label>
                  <input 
                    type="text"
                    value={newPeriodForm.period_name}
                    onChange={(e) => setNewPeriodForm(prev => ({ ...prev, period_name: e.target.value }))}
                    style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                      Fecha de Inicio
                    </label>
                    <input 
                      type="date"
                      value={newPeriodForm.start_date}
                      onChange={(e) => setNewPeriodForm(prev => ({ ...prev, start_date: e.target.value }))}
                      style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                      required
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                      Fecha de Fin (Corte)
                    </label>
                    <input 
                      type="date"
                      value={newPeriodForm.end_date}
                      onChange={(e) => setNewPeriodForm(prev => ({ ...prev, end_date: e.target.value }))}
                      style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                      required
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                      Sucursal
                    </label>
                    <select
                      value={newPeriodForm.sucursal}
                      onChange={(e) => setNewPeriodForm(prev => ({ ...prev, sucursal: e.target.value }))}
                      className="input-field"
                      style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: '10px', fontWeight: 600 }}
                    >
                      <option value="Todas">Todas las sucursales</option>
                      <option value="San Vicente">Abatte San Vicente</option>
                      <option value="Villa Mella">Abatte Villa Mella</option>
                      <option value="Disponibles (*)">Disponibles (*)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                      Departamento
                    </label>
                    <select
                      value={newPeriodForm.departamento}
                      onChange={(e) => setNewPeriodForm(prev => ({ ...prev, departamento: e.target.value }))}
                      className="input-field"
                      style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: '10px', fontWeight: 600 }}
                    >
                      <option value="Todos">Todos los departamentos</option>
                      <option value="Estilista">Estilistas</option>
                      <option value="Barbero">Barberos</option>
                      <option value="Manicurista">Manicuristas</option>
                    </select>
                  </div>
                </div>

                <div style={{ background: '#f0f7ff', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '1rem', fontSize: '0.825rem', color: '#1e40af' }}>
                  <Info size={16} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'text-bottom' }} />
                  El sistema calculará automáticamente para cada empleado: salarios fijos proporcionales, comisiones del período, horas extras, feriados, TSS legal (5.91%), préstamos y consumos de salón.
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => setShowNewPeriodModal(false)}
                    className="btn-secondary"
                    style={{ padding: '0.7rem 1.5rem', borderRadius: '10px', fontWeight: 700 }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    style={{
                      background: '#0066ff',
                      border: 'none',
                      color: '#ffffff',
                      padding: '0.7rem 1.75rem',
                      borderRadius: '10px',
                      fontWeight: 800,
                      cursor: 'pointer'
                    }}
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
      {/* MODAL 7: DESGLOSE MENSUAL DE REGALÍA */}
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
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              style={{
                background: '#ffffff',
                borderRadius: '24px',
                width: '100%',
                maxWidth: '750px',
                maxHeight: '85vh',
                overflowY: 'auto',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                padding: '2rem'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div>
                  <h2 style={{ fontSize: '1.35rem', fontWeight: 900, color: '#0f172a', margin: 0 }}>
                    Desglose de Regalía · {selectedRegaliaEmployee.employee_name}
                  </h2>
                  <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0.2rem 0 0 0' }}>
                    {selectedRegaliaEmployee.posicion} · Abatte {selectedRegaliaEmployee.sucursal} · Año Fiscal {regaliasYear}
                  </p>
                </div>
                <button 
                  onClick={() => setShowRegaliaDetailModal(false)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                >
                  <X size={20} />
                </button>
              </div>

              <div style={{ background: '#f8fafc', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: '1.5rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: '#0f172a', color: '#fff', fontWeight: 800 }}>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'left' }}>Mes</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Salario Fijo</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Comisiones</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Devengado Mes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRegaliaEmployee.desglose_mensual?.map((m, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#0f172a' }}>{m.mes}</td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#475569' }}>
                          RD$ {parseFloat(m.salario_ordinario || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#475569' }}>
                          RD$ {parseFloat(m.comisiones || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 800, color: '#0066ff' }}>
                          RD$ {parseFloat(m.total_mes || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                    <tr style={{ background: '#eff6ff', fontWeight: 900, borderTop: '2px solid #bfdbfe' }}>
                      <td style={{ padding: '1rem', color: '#1d4ed8' }}>Total Devengado Anual</td>
                      <td colSpan="2"></td>
                      <td style={{ padding: '1rem', textAlign: 'right', color: '#0052cc', fontSize: '1rem' }}>
                        RD$ {parseFloat(selectedRegaliaEmployee.total_acumulado_anual).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ background: '#f0fdf4', border: '1.5px solid #86efac', borderRadius: '16px', padding: '1.25rem', textAlign: 'center', marginBottom: '1.5rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#166534', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>
                  Regalía Pascual (Salario de Navidad · Duodécima Parte / 12)
                </span>
                <span style={{ fontSize: '1.8rem', fontWeight: 900, color: '#16a34a' }}>
                  RD$ {parseFloat(selectedRegaliaEmployee.monto_regalia).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>

              <div style={{ textAlign: 'right' }}>
                <button
                  onClick={() => setShowRegaliaDetailModal(false)}
                  className="btn-secondary"
                  style={{ padding: '0.65rem 1.75rem', borderRadius: '10px', fontWeight: 700 }}
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
