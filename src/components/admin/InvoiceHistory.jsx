import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { 
  Receipt, Search, Calendar, Filter, Download, Printer, XCircle, 
  CheckCircle, AlertTriangle, ChevronDown, ChevronUp, User, DollarSign, 
  CreditCard, Wallet, FileText, RefreshCw, Clock, Landmark, Layers, Sparkles, FileSpreadsheet
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useAuth } from '../../context/AuthContext';

export default function InvoiceHistory() {
  const { user } = useAuth();
  const isAdmin = user?.role?.toLowerCase() === 'admin' || user?.role?.toLowerCase() === 'administrador';
  const canVoid = isAdmin || Boolean(user?.permissions?.void_invoices) || Boolean(user?.permissions?.manage_staff);

  const [visits, setVisits] = useState([]);
  const [salons, setSalons] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [salonFilter, setSalonFilter] = useState('all'); // 'all' | salonId
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'Facturado' | 'Anulado' | 'Pendiente'
  const [paymentFilter, setPaymentFilter] = useState('all'); // 'all' | 'Efectivo' | 'Tarjeta' | 'Transferencia' | 'Plan Beauty' | 'Mixto'
  const [dateFilter, setDateFilter] = useState('month'); // 'today' | 'yesterday' | 'week' | 'month' | 'last_month' | 'all' | 'custom'
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Row Expand, Void Modal, Print Modal State
  const [expandedId, setExpandedId] = useState(null);
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [targetVisitToVoid, setTargetVisitToVoid] = useState(null);
  const [voidReasonCategory, setVoidReasonCategory] = useState('Error de cobro / método de pago');
  const [voidCustomReason, setVoidCustomReason] = useState('');
  const [voidUser, setVoidUser] = useState(user?.nombre || user?.name || 'Administrador');
  const [isSubmittingVoid, setIsSubmittingVoid] = useState(false);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      const [vData, sData] = await Promise.all([
        dataService.getVisits(),
        dataService.getSalons()
      ]);
      setVisits(Array.isArray(vData) ? vData : []);
      setSalons(Array.isArray(sData) ? sData : []);
    } catch (err) {
      console.error('Error cargando historial general de facturas:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  // Helper to extract visit timing (Start, End, Duration)
  const getVisitTiming = (visit) => {
    const end = new Date(visit.visited_at || Date.now());
    let start = null;

    if (visit.checkin_time) {
      start = new Date(visit.checkin_time);
    } else if (visit.start_time) {
      start = new Date(visit.start_time);
    } else if (visit.id && !isNaN(Number(visit.id)) && Number(visit.id) > 1700000000000) {
      start = new Date(Number(visit.id));
    } else if (typeof visit.id === 'string' && visit.id.startsWith('TKT-')) {
      const rawTs = parseInt(visit.id.replace('TKT-', ''), 10);
      if (!isNaN(rawTs) && rawTs > 1700000000000) {
        start = new Date(rawTs);
      }
    }

    if (!start || isNaN(start.getTime()) || start.getTime() > end.getTime()) {
      start = new Date(end.getTime() - (45 * 60 * 1000));
    }

    const diffMs = Math.max(0, end.getTime() - start.getTime());
    const diffMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;

    let durationText = '';
    if (hours > 0) {
      durationText = `${hours}h ${mins > 0 ? `${mins}m` : ''}`;
    } else {
      durationText = `${Math.max(1, mins)} min`;
    }

    return {
      formattedDate: end.toLocaleDateString('es-DO'),
      formattedStartTime: start.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }),
      formattedEndTime: end.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }),
      durationText,
      diffMins
    };
  };

  // Helper to extract payment breakdown (Efectivo, Tarjeta, Transferencia, Plan Beauty)
  const getPaymentBreakdown = (visit) => {
    const isVoided = visit.status === 'Anulado';
    const total = Number(visit.total || 0);
    const rawMethod = (visit.metodo_pago || '').toLowerCase();

    // Check if it's a Plan Beauty redemption
    const isPlan = rawMethod.includes('plan') || total === 0 || 
      (visit.servicios && String(visit.servicios).toLowerCase().includes('plan beauty')) || 
      (visit.items_detail && String(visit.items_detail).toLowerCase().includes('plan beauty'));

    if (isPlan && total === 0) {
      return {
        displayMethod: 'Plan Beauty',
        isPlanBeauty: true,
        efectivo: 0,
        tarjeta: 0,
        transferencia: 0,
        total: 0,
        isVoided
      };
    }

    if (isVoided) {
      return {
        displayMethod: visit.metodo_pago || 'Efectivo',
        isPlanBeauty: isPlan,
        efectivo: 0,
        tarjeta: 0,
        transferencia: 0,
        total: 0,
        isVoided: true
      };
    }

    // Check if Mixed payment
    if (rawMethod.includes('mixto')) {
      let ef = 0;
      let tj = 0;
      let tr = 0;

      const efMatch = visit.metodo_pago.match(/Efectivo:\s*RD\$\s*([\d,.]+)/i);
      const tjMatch = visit.metodo_pago.match(/Tarjeta:\s*RD\$\s*([\d,.]+)/i);
      const trMatch = visit.metodo_pago.match(/Transferencia:\s*RD\$\s*([\d,.]+)/i);

      if (efMatch) ef = parseFloat(efMatch[1].replace(/,/g, '')) || 0;
      if (tjMatch) tj = parseFloat(tjMatch[1].replace(/,/g, '')) || 0;
      if (trMatch) tr = parseFloat(trMatch[1].replace(/,/g, '')) || 0;

      if (ef === 0 && tj === 0 && tr === 0) {
        if (Number(visit.monto_recibido) > 0 && Number(visit.monto_recibido) < total) {
          ef = Number(visit.monto_recibido);
          if (rawMethod.includes('tarjeta')) tj = Math.max(0, total - ef);
          else if (rawMethod.includes('transferencia')) tr = Math.max(0, total - ef);
          else tj = Math.max(0, total - ef);
        } else {
          ef = total / 2;
          tj = total / 2;
        }
      }

      return {
        displayMethod: 'Mixto',
        isPlanBeauty: false,
        efectivo: ef,
        tarjeta: tj,
        transferencia: tr,
        total,
        isVoided: false
      };
    }

    // Pure Card
    if (rawMethod.includes('tarjeta') || rawMethod.includes('card')) {
      return {
        displayMethod: 'Tarjeta',
        isPlanBeauty: false,
        efectivo: 0,
        tarjeta: total,
        transferencia: 0,
        total,
        isVoided: false
      };
    }

    // Pure Transfer
    if (rawMethod.includes('transferencia') || rawMethod.includes('transfer')) {
      return {
        displayMethod: 'Transferencia',
        isPlanBeauty: false,
        efectivo: 0,
        tarjeta: 0,
        transferencia: total,
        total,
        isVoided: false
      };
    }

    // Gift Card
    if (rawMethod.includes('gift')) {
      return {
        displayMethod: 'Gift Card',
        isPlanBeauty: false,
        efectivo: 0,
        tarjeta: 0,
        transferencia: 0,
        total,
        isVoided: false
      };
    }

    // Default to Cash
    return {
      displayMethod: 'Efectivo',
      isPlanBeauty: false,
      efectivo: total,
      tarjeta: 0,
      transferencia: 0,
      total,
      isVoided: false
    };
  };

  // Filter Logic
  const filteredVisits = useMemo(() => {
    return visits.filter(v => {
      // Search term (ticket, client name, services, employee)
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const ticketMatch = (v.ticket_number || `TKT-${v.id}`).toLowerCase().includes(term);
        const clientMatch = (v.client_name || '').toLowerCase().includes(term);
        const methodMatch = (v.metodo_pago || '').toLowerCase().includes(term);
        
        let servicesMatch = false;
        try {
          if (v.items_detail) {
            const parsed = typeof v.items_detail === 'string' ? JSON.parse(v.items_detail) : v.items_detail;
            if (Array.isArray(parsed)) {
              servicesMatch = parsed.some(i => 
                (i.nombre || i.service_name || '').toLowerCase().includes(term) ||
                (i.empleado_nombre || i.employee_name || i.empleado || '').toLowerCase().includes(term)
              );
            }
          }
        } catch (e) {}

        if (!ticketMatch && !clientMatch && !methodMatch && !servicesMatch) return false;
      }

      // Salon / Localidad filter
      if (salonFilter !== 'all') {
        const sMatch = String(v.salon_id) === String(salonFilter) || 
                       (v.salon_nombre && v.salon_nombre.toLowerCase().includes(String(salonFilter).toLowerCase())) ||
                       (v.salon_name && v.salon_name.toLowerCase().includes(String(salonFilter).toLowerCase()));
        if (!sMatch) return false;
      }

      // Status filter
      if (statusFilter !== 'all') {
        if (statusFilter === 'Facturado' && v.status !== 'Facturado' && v.status !== 'Completado') return false;
        if (statusFilter === 'Anulado' && v.status !== 'Anulado') return false;
        if (statusFilter === 'Pendiente' && v.status !== 'Pendiente') return false;
      }

      // Payment method filter
      if (paymentFilter !== 'all') {
        const breakdown = getPaymentBreakdown(v);
        if (paymentFilter === 'Efectivo' && (breakdown.efectivo <= 0 || breakdown.displayMethod === 'Mixto')) return false;
        if (paymentFilter === 'Tarjeta' && (breakdown.tarjeta <= 0 || breakdown.displayMethod === 'Mixto')) return false;
        if (paymentFilter === 'Transferencia' && (breakdown.transferencia <= 0 || breakdown.displayMethod === 'Mixto')) return false;
        if (paymentFilter === 'Plan Beauty' && !breakdown.isPlanBeauty) return false;
        if (paymentFilter === 'Mixto' && breakdown.displayMethod !== 'Mixto') return false;
        if (paymentFilter === 'Gift Card' && breakdown.displayMethod !== 'Gift Card') return false;
      }

      // Date filter
      const vTime = new Date(v.visited_at || Date.now()).getTime();
      const now = new Date();
      if (dateFilter === 'today') {
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        if (vTime < startOfDay) return false;
      } else if (dateFilter === 'yesterday') {
        const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
        const endOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - 1;
        if (vTime < startOfYesterday || vTime > endOfYesterday) return false;
      } else if (dateFilter === 'week') {
        const sevenDaysAgo = now.getTime() - (7 * 24 * 60 * 60 * 1000);
        if (vTime < sevenDaysAgo) return false;
      } else if (dateFilter === 'month') {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        if (vTime < startOfMonth) return false;
      } else if (dateFilter === 'last_month') {
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).getTime();
        if (vTime < startOfLastMonth || vTime > endOfLastMonth) return false;
      } else if (dateFilter === 'custom') {
        if (startDate && vTime < new Date(startDate + 'T00:00:00').getTime()) return false;
        if (endDate && vTime > new Date(endDate + 'T23:59:59').getTime()) return false;
      }

      return true;
    });
  }, [visits, searchTerm, salonFilter, statusFilter, paymentFilter, dateFilter, startDate, endDate]);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25); // 25, 50, 100, 250, 'all'

  // Reset page when any filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, salonFilter, statusFilter, paymentFilter, dateFilter, startDate, endDate]);

  // Pre-process items for ultra-fast rendering & calculations
  const processedVisits = useMemo(() => {
    return filteredVisits.map(visit => {
      const isVoided = visit.status === 'Anulado';
      const timing = getVisitTiming(visit);
      const breakdown = getPaymentBreakdown(visit);

      let itemsList = [];
      try {
        if (visit.items_detail) {
          const parsed = typeof visit.items_detail === 'string' ? JSON.parse(visit.items_detail) : visit.items_detail;
          if (Array.isArray(parsed)) itemsList = parsed;
        }
      } catch (e) {}

      let staffNames = new Set();
      const isInvalidName = (n) => !n || ['n/a', 'sin asignar', 'no asignado', 'null', 'undefined', 'general', ''].includes(String(n).trim().toLowerCase());
      if (!isInvalidName(visit.empleado_peluquera)) staffNames.add(visit.empleado_peluquera.trim());
      if (!isInvalidName(visit.empleado_manicurista)) staffNames.add(visit.empleado_manicurista.trim());
      itemsList.forEach(item => {
        const emp = item.empleado_nombre || item.employee_name || item.empleado;
        if (!isInvalidName(emp)) staffNames.add(String(emp).trim());
      });
      const staffDisplay = Array.from(staffNames);

      let sNames = itemsList.map(i => i.nombre || i.service_name || i.servicio).filter(Boolean);
      if (sNames.length === 0 && visit.servicios) {
        try {
          if (Array.isArray(visit.servicios)) sNames = visit.servicios;
          else if (typeof visit.servicios === 'string' && visit.servicios.startsWith('[')) sNames = JSON.parse(visit.servicios);
          else if (visit.servicios && visit.servicios !== 'Servicio en preparación') sNames = [String(visit.servicios)];
        } catch (e) {}
      }

      let displayService = sNames.join(' + ');
      if (!displayService || displayService === 'Ticket en Construcción') {
        displayService = breakdown.isPlanBeauty ? 'Lavado y Secado (Plan Beauty)' : 'Servicio General';
      }

      return {
        ...visit,
        _timing: timing,
        _breakdown: breakdown,
        _itemsList: itemsList,
        _staffDisplay: staffDisplay,
        _displayService: displayService,
        _isVoided: isVoided
      };
    });
  }, [filteredVisits]);

  // Paginated Sliced List
  const totalPages = rowsPerPage === 'all' ? 1 : Math.max(1, Math.ceil(processedVisits.length / (Number(rowsPerPage) || 25)));
  const paginatedVisits = useMemo(() => {
    if (rowsPerPage === 'all') return processedVisits;
    const rpp = Number(rowsPerPage) || 25;
    const start = (currentPage - 1) * rpp;
    return processedVisits.slice(start, start + rpp);
  }, [processedVisits, currentPage, rowsPerPage]);

  // Financial Totals & KPIs
  const kpis = useMemo(() => {
    let totalBilled = 0;
    let totalCash = 0;
    let totalCard = 0;
    let totalTransfer = 0;
    let voidedCount = 0;
    let voidedAmount = 0;
    let activeCount = 0;
    let planCount = 0;

    processedVisits.forEach(v => {
      const amt = Number(v.total || 0);
      const isVoid = v._isVoided;
      const breakdown = v._breakdown;

      if (isVoid) {
        voidedCount += 1;
        voidedAmount += amt;
      } else {
        activeCount += 1;
        totalBilled += breakdown.total;
        totalCash += breakdown.efectivo;
        totalCard += breakdown.tarjeta;
        totalTransfer += breakdown.transferencia;
        if (breakdown.isPlanBeauty) planCount += 1;
      }
    });

    return {
      totalBilled,
      totalCash,
      totalCard,
      totalTransfer,
      voidedCount,
      voidedAmount,
      activeCount,
      planCount,
      totalVisits: processedVisits.length
    };
  }, [processedVisits]);

  // Branch / Location label
  const getSalonLabel = () => {
    if (salonFilter === 'all') return 'Todas las localidades';
    const found = salons.find(s => String(s.id) === String(salonFilter) || s.name === salonFilter);
    return found ? found.name : `Sucursal #${salonFilter}`;
  };

  // Period label for export titles
  const getPeriodLabel = () => {
    if (dateFilter === 'today') return 'Hoy (' + new Date().toLocaleDateString('es-DO') + ')';
    if (dateFilter === 'yesterday') {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      return 'Ayer (' + y.toLocaleDateString('es-DO') + ')';
    }
    if (dateFilter === 'week') return 'Últimos 7 días';
    if (dateFilter === 'month') return 'Este Mes (' + new Date().toLocaleDateString('es-DO', { month: 'long', year: 'numeric' }) + ')';
    if (dateFilter === 'last_month') return 'Mes Pasado';
    if (dateFilter === 'custom') return `${startDate || 'Inicio'} al ${endDate || 'Hoy'}`;
    return 'Todo el Historial Histórico';
  };

  // Void Handler
  const handleConfirmVoidVisit = async () => {
    if (!targetVisitToVoid) return;
    const finalReason = voidCustomReason.trim() ? `${voidReasonCategory}: ${voidCustomReason.trim()}` : voidReasonCategory;
    setIsSubmittingVoid(true);
    try {
      await dataService.voidVisit(targetVisitToVoid.id, {
        reason: finalReason,
        user_name: voidUser || 'Administrador',
        ticket_number: targetVisitToVoid.ticket_number,
        total: targetVisitToVoid.total,
        metodo_pago: targetVisitToVoid.metodo_pago,
        salon_id: targetVisitToVoid.salon_id || 1
      });
      alert(`✅ Factura #${targetVisitToVoid.ticket_number || targetVisitToVoid.id} anulada exitosamente.`);
      setShowVoidModal(false);
      setTargetVisitToVoid(null);
      setVoidCustomReason('');
      await fetchAllData();
    } catch (err) {
      alert(`❌ Error al anular factura: ${err.message}`);
    } finally {
      setIsSubmittingVoid(false);
    }
  };

  // NATIVE EXCEL (.xlsx) EXPORT USING SHEETJS
  const handleExportExcel = () => {
    const periodStr = getPeriodLabel();
    const generationDate = new Date().toLocaleString('es-DO');

    // Build worksheet data (Array of Arrays)
    const excelRows = [];

    // Header metadata
    excelRows.push(['PLAN BEAUTY RD - SALON & SPA']);
    excelRows.push(['REPORTE GENERAL DE FACTURACIÓN Y VENTAS POR MÉTODOS DE PAGO']);
    excelRows.push([`Sucursal: ${getSalonLabel()}`, `Período: ${periodStr}`, `Fecha de Emisión: ${generationDate}`]);
    excelRows.push([
      `Facturas Activas: ${kpis.activeCount} (${kpis.voidedCount} anuladas)`,
      `Total Facturado: RD$ ${kpis.totalBilled.toFixed(2)}`,
      `Efectivo: RD$ ${kpis.totalCash.toFixed(2)}`,
      `Tarjeta: RD$ ${kpis.totalCard.toFixed(2)}`,
      `Transferencia: RD$ ${kpis.totalTransfer.toFixed(2)}`
    ]);
    excelRows.push([]); // Blank row

    // Table Column Headers
    excelRows.push([
      'Ticket #',
      'Fecha',
      'Hora Entrada',
      'Hora Facturación',
      'Duración Salón',
      'Cliente',
      'ID Cliente',
      'Servicios Realizados',
      'Personal Asignado',
      'Método de Pago',
      'Efectivo (RD$)',
      'Tarjeta (RD$)',
      'Transferencia (RD$)',
      'Total Facturado (RD$)',
      'Estado',
      'Auditoría / Motivo Anulación'
    ]);

    // Data Rows
    filteredVisits.forEach(v => {
      let sNames = [];
      let staffNames = [];
      try {
        if (v.items_detail) {
          const parsed = typeof v.items_detail === 'string' ? JSON.parse(v.items_detail) : v.items_detail;
          if (Array.isArray(parsed)) {
            sNames = parsed.map(i => i.nombre || i.service_name || '');
            staffNames = parsed.map(i => i.empleado_nombre || i.employee_name || i.empleado || '');
          }
        }
      } catch (e) {}

      const timing = getVisitTiming(v);
      const breakdown = getPaymentBreakdown(v);

      let displayService = sNames.join(' + ');
      if (!displayService && v.servicios) {
        try {
          if (Array.isArray(v.servicios)) displayService = v.servicios.join(' + ');
          else if (typeof v.servicios === 'string' && v.servicios.startsWith('[')) displayService = JSON.parse(v.servicios).join(' + ');
          else if (v.servicios !== 'Ticket en Construcción' && v.servicios !== 'Servicio en preparación') displayService = String(v.servicios);
        } catch (e) {}
      }
      if (!displayService || displayService === 'Ticket en Construcción') {
        displayService = breakdown.isPlanBeauty ? 'Lavado y Secado (Plan Beauty)' : 'Servicio General';
      }

      excelRows.push([
        v.ticket_number || `SD-${String(v.id).slice(-4)}`,
        timing.formattedDate,
        timing.formattedStartTime,
        timing.formattedEndTime,
        timing.durationText,
        v.client_name || 'Cliente General',
        v.client_id || 'INVITADO',
        displayService,
        [...new Set(staffNames.filter(Boolean))].join(', ') || 'Personal de turno',
        breakdown.displayMethod,
        breakdown.efectivo,
        breakdown.tarjeta,
        breakdown.transferencia,
        breakdown.total,
        v.status || 'Facturado',
        v.void_reason ? `Anulado por ${v.voided_by || 'Admin'}: ${v.void_reason}` : ''
      ]);
    });

    excelRows.push([]); // Blank row before totals

    // Totals Row
    excelRows.push([
      'TOTALES GENERALES',
      '',
      '',
      '',
      '',
      `${kpis.activeCount} facturas activas`,
      '',
      '',
      '',
      '',
      kpis.totalCash,
      kpis.totalCard,
      kpis.totalTransfer,
      kpis.totalBilled,
      `${kpis.voidedCount} anuladas`,
      ''
    ]);

    // Create Worksheet
    const ws = XLSX.utils.aoa_to_sheet(excelRows);

    // Set Column Widths in Excel
    ws['!cols'] = [
      { wch: 13 }, // Ticket #
      { wch: 13 }, // Fecha
      { wch: 15 }, // Hora Entrada
      { wch: 17 }, // Hora Facturación
      { wch: 16 }, // Duración
      { wch: 26 }, // Cliente
      { wch: 16 }, // ID
      { wch: 34 }, // Servicios
      { wch: 28 }, // Personal
      { wch: 16 }, // Método
      { wch: 16 }, // Efectivo
      { wch: 16 }, // Tarjeta
      { wch: 19 }, // Transferencia
      { wch: 22 }, // Total Facturado
      { wch: 14 }, // Estado
      { wch: 38 }  // Auditoría
    ];

    // Create Workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Facturación y Ventas');

    // Download native .xlsx file
    XLSX.writeFile(wb, `PlanBeauty_Reporte_Facturacion_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // Trigger Print View
  const handlePrintDocument = () => {
    window.print();
  };

  return (
    <div style={{ padding: '1rem 1.25rem', maxWidth: '1600px', margin: '0 auto', fontFamily: 'inherit' }}>
      
      {/* PRINT CSS STYLES (Applies only when printing) */}
      <style>{`
        @media print {
          @page {
            size: landscape;
            margin: 10mm;
          }
          body * {
            visibility: hidden !important;
          }
          #printable-financial-report, #printable-financial-report * {
            visibility: visible !important;
          }
          #printable-financial-report {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            padding: 10px !important;
            background: #ffffff !important;
            color: #000000 !important;
          }
          .no-print {
            display: none !important;
          }
          table {
            width: 100% !important;
            font-size: 7.5pt !important;
            border-collapse: collapse !important;
          }
          thead {
            display: table-header-group !important;
          }
          tr {
            page-break-inside: avoid !important;
          }
          th, td {
            padding: 4px 5px !important;
            border: 1px solid #cbd5e1 !important;
          }
        }
      `}</style>

      {/* HEADER */}
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <div style={{ background: 'linear-gradient(135deg, #be185d, #e11d48)', color: '#ffffff', width: '40px', height: '40px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 10px rgba(190,24,93,0.3)' }}>
              <Receipt size={20} />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 900, color: '#0f172a' }}>
                Centro de Facturas & Ventas
              </h1>
              <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b' }}>
                Reporte Financiero Oficial • Desglose por Métodos de Pago, Tiempos y Auditoría
              </p>
            </div>
          </div>
        </div>

        {/* TOP ACTION BUTTONS: REFRESH, PRINT/PDF, EXCEL */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          
          <button
            type="button"
            onClick={fetchAllData}
            style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#334155', padding: '0.5rem 0.85rem', borderRadius: '9px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Actualizar</span>
          </button>

          {/* PRINT & PDF PREVIEW BUTTON */}
          <button
            type="button"
            onClick={() => setShowPrintModal(true)}
            style={{ background: '#f8fafc', border: '1px solid #94a3b8', color: '#0f172a', padding: '0.5rem 0.95rem', borderRadius: '9px', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
            title="Abrir vista de impresión y exportación en PDF formal"
          >
            <Printer size={14} color="#0f172a" />
            <span>Imprimir / Guardar PDF</span>
          </button>

          {/* NATIVE EXCEL .XLSX BUTTON */}
          <button
            type="button"
            onClick={handleExportExcel}
            style={{ background: '#047857', border: 'none', color: '#ffffff', padding: '0.5rem 1.05rem', borderRadius: '9px', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', boxShadow: '0 2px 6px rgba(4,120,87,0.3)' }}
            title="Descargar archivo oficial de Excel (.xlsx) con columnas separadas y números formateados"
          >
            <FileSpreadsheet size={15} />
            <span>Descargar Excel (.xlsx)</span>
          </button>

        </div>
      </div>

      {/* KPI METRIC CARDS */}
      <div className="no-print" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem', marginBottom: '1.25rem' }}>
        
        {/* TOTAL FACTURADO */}
        <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '0.9rem 1rem', boxShadow: '0 2px 6px rgba(0,0,0,0.02)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: '0.675rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Facturado</span>
            <h3 style={{ margin: '0.15rem 0 0', fontSize: '1.3rem', fontWeight: 900, color: '#0f172a' }}>
              RD$ {kpis.totalBilled.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
            </h3>
            <span style={{ fontSize: '0.65rem', color: '#16a34a', fontWeight: 700 }}>
              {kpis.activeCount} facturas activas
            </span>
          </div>
          <div style={{ background: '#dcfce7', width: '38px', height: '38px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#16a34a' }}>
            <DollarSign size={20} />
          </div>
        </div>

        {/* EFECTIVO */}
        <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '0.9rem 1rem', boxShadow: '0 2px 6px rgba(0,0,0,0.02)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: '0.675rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Ingresos Efectivo</span>
            <h3 style={{ margin: '0.15rem 0 0', fontSize: '1.3rem', fontWeight: 900, color: '#047857' }}>
              RD$ {kpis.totalCash.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
            </h3>
            <span style={{ fontSize: '0.65rem', color: '#64748b' }}>Cobrado en caja física</span>
          </div>
          <div style={{ background: '#ecfdf5', width: '38px', height: '38px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#059669' }}>
            <Wallet size={20} />
          </div>
        </div>

        {/* TARJETAS */}
        <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '0.9rem 1rem', boxShadow: '0 2px 6px rgba(0,0,0,0.02)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: '0.675rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tarjeta / POS</span>
            <h3 style={{ margin: '0.15rem 0 0', fontSize: '1.3rem', fontWeight: 900, color: '#2563eb' }}>
              RD$ {kpis.totalCard.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
            </h3>
            <span style={{ fontSize: '0.65rem', color: '#64748b' }}>Cobro electrónico</span>
          </div>
          <div style={{ background: '#eff6ff', width: '38px', height: '38px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6' }}>
            <CreditCard size={20} />
          </div>
        </div>

        {/* TRANSFERENCIAS */}
        <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '0.9rem 1rem', boxShadow: '0 2px 6px rgba(0,0,0,0.02)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: '0.675rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Transferencias</span>
            <h3 style={{ margin: '0.15rem 0 0', fontSize: '1.3rem', fontWeight: 900, color: '#7c3aed' }}>
              RD$ {kpis.totalTransfer.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
            </h3>
            <span style={{ fontSize: '0.65rem', color: '#64748b' }}>Bancos / Transfer</span>
          </div>
          <div style={{ background: '#f5f3ff', width: '38px', height: '38px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7c3aed' }}>
            <Landmark size={20} />
          </div>
        </div>

        {/* ANULACIONES */}
        <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '0.9rem 1rem', boxShadow: '0 2px 6px rgba(0,0,0,0.02)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: '0.675rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Anulaciones</span>
            <h3 style={{ margin: '0.15rem 0 0', fontSize: '1.3rem', fontWeight: 900, color: '#dc2626' }}>
              {kpis.voidedCount}
            </h3>
            <span style={{ fontSize: '0.65rem', color: '#ef4444', fontWeight: 700 }}>
              RD$ {kpis.voidedAmount.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div style={{ background: '#fef2f2', width: '38px', height: '38px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#dc2626' }}>
            <XCircle size={20} />
          </div>
        </div>

      </div>

      {/* FILTER CONTROLS BAR */}
      <div className="no-print" style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '0.85rem 1.15rem', marginBottom: '1.25rem', boxShadow: '0 2px 6px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', alignItems: 'center' }}>
          
          {/* SEARCH INPUT */}
          <div style={{ position: 'relative', flex: '1 1 200px', minWidth: '170px' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              type="text"
              placeholder="Buscar # ticket, cliente, colaborador..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '0.45rem 0.5rem 0.45rem 1.9rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.75rem', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          {/* LOCALIDAD / SUCURSAL SELECTOR */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.725rem', color: '#64748b', fontWeight: 700 }}>🏢 Localidad:</span>
            <select
              value={salonFilter}
              onChange={(e) => setSalonFilter(e.target.value)}
              style={{ padding: '0.45rem 0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.75rem', background: '#ffffff', fontWeight: 600 }}
            >
              <option value="all">Todas las localidades</option>
              {salons.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* DATE SELECTOR */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.725rem', color: '#64748b', fontWeight: 700 }}>📅 Rango:</span>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              style={{ padding: '0.45rem 0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.75rem', background: '#ffffff', fontWeight: 600 }}
            >
              <option value="today">Hoy</option>
              <option value="yesterday">Ayer</option>
              <option value="week">Últimos 7 días</option>
              <option value="month">Este Mes</option>
              <option value="last_month">Mes Pasado</option>
              <option value="all">Todo el historial</option>
              <option value="custom">Personalizado (Elegir fechas)</option>
            </select>
          </div>

          {/* CUSTOM DATE PICKERS */}
          {dateFilter === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: '#f8fafc', padding: '0.2rem 0.45rem', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
              <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700 }}>Desde:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{ padding: '0.3rem 0.4rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.725rem' }}
              />
              <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700 }}>Hasta:</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ padding: '0.3rem 0.4rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.725rem' }}
              />
            </div>
          )}

          {/* STATUS SELECTOR */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.725rem', color: '#64748b', fontWeight: 700 }}>Estado:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ padding: '0.45rem 0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.75rem', background: '#ffffff', fontWeight: 600 }}
            >
              <option value="all">Todos los estados</option>
              <option value="Facturado">Facturados (Completos)</option>
              <option value="Anulado">Anulados</option>
              <option value="Pendiente">Pendientes / En atención</option>
            </select>
          </div>

          {/* PAYMENT METHOD SELECTOR */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.725rem', color: '#64748b', fontWeight: 700 }}>Método:</span>
            <select
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value)}
              style={{ padding: '0.45rem 0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.75rem', background: '#ffffff', fontWeight: 600 }}
            >
              <option value="all">Todos los métodos</option>
              <option value="Efectivo">Efectivo</option>
              <option value="Tarjeta">Tarjeta</option>
              <option value="Transferencia">Transferencia</option>
              <option value="Plan Beauty">Plan Beauty</option>
              <option value="Gift Card">Gift Card</option>
              <option value="Mixto">Pago Mixto</option>
            </select>
          </div>

          {(searchTerm || salonFilter !== 'all' || statusFilter !== 'all' || paymentFilter !== 'all' || dateFilter !== 'month' || startDate || endDate) && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setSalonFilter('all');
                setStatusFilter('all');
                setPaymentFilter('all');
                setDateFilter('month');
                setStartDate('');
                setEndDate('');
              }}
              style={{ background: '#f1f5f9', border: 'none', color: '#64748b', padding: '0.45rem 0.7rem', borderRadius: '7px', fontSize: '0.725rem', fontWeight: 700, cursor: 'pointer' }}
            >
              Limpiar filtros
            </button>
          )}

        </div>
      </div>

      {/* ROBUST FINANCIAL TABLE WITH MULTI-METHOD COLUMNS & TIMING */}
      <div id="printable-financial-report" style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.02)', overflowX: 'auto', width: '100%' }}>
        
        {/* TABLE HEADER BAR */}
        <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.775rem', fontWeight: 800, color: '#334155' }}>
            📋 Mostrando {filteredVisits.length} facturas registradas ({getPeriodLabel()})
          </span>
          <span style={{ fontSize: '0.725rem', color: '#64748b' }}>
            {kpis.activeCount} activas • {kpis.voidedCount} anuladas • {kpis.planCount} Plan Beauty
          </span>
        </div>

        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
            Cargando historial de facturas y operaciones...
          </div>
        ) : filteredVisits.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
            No se encontraron facturas con los filtros seleccionados.
          </div>
        ) : (
          <table style={{ width: '100%', minWidth: '1150px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.75rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc', color: '#334155', fontWeight: 800 }}>
                <th style={{ padding: '0.6rem 0.65rem' }}>Ticket #</th>
                <th style={{ padding: '0.6rem 0.65rem' }}>Fecha & Entrada</th>
                <th style={{ padding: '0.6rem 0.65rem' }}>Hora Factura</th>
                <th style={{ padding: '0.6rem 0.65rem' }}>Duración</th>
                <th style={{ padding: '0.6rem 0.65rem' }}>Cliente</th>
                <th style={{ padding: '0.6rem 0.65rem' }}>Servicios & Personal</th>
                <th style={{ padding: '0.6rem 0.65rem' }}>Método</th>
                
                {/* SPECIFIC PAYMENT COLUMNS */}
                <th style={{ padding: '0.6rem 0.65rem', textAlign: 'right', background: '#f0fdf4', color: '#166534' }}>💵 Efectivo</th>
                <th style={{ padding: '0.6rem 0.65rem', textAlign: 'right', background: '#eff6ff', color: '#1e40af' }}>💳 Tarjeta</th>
                <th style={{ padding: '0.6rem 0.65rem', textAlign: 'right', background: '#faf5ff', color: '#6b21a8' }}>🏦 Transferencia</th>
                <th style={{ padding: '0.6rem 0.65rem', textAlign: 'right', background: '#fdf2f8', color: '#9d174d' }}>💰 Total Facturado</th>
                
                <th style={{ padding: '0.6rem 0.65rem', textAlign: 'center' }}>Estado</th>
                <th className="no-print" style={{ padding: '0.6rem 0.65rem', textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {paginatedVisits.map((visit, index) => {
                const isVoided = visit._isVoided;
                const isExpanded = expandedId === (visit.id || index);
                const timing = visit._timing;
                const breakdown = visit._breakdown;
                const itemsList = visit._itemsList;
                const staffDisplay = visit._staffDisplay;
                const displayService = visit._displayService;

                return (
                  <React.Fragment key={visit.id || index}>
                    <tr 
                      style={{ 
                        borderBottom: isExpanded ? 'none' : '1px solid #f1f5f9', 
                        background: isVoided ? '#fef2f2' : (isExpanded ? '#f8fafc' : '#ffffff'),
                        transition: 'background 0.15s ease'
                      }}
                    >
                      {/* TICKET # */}
                      <td style={{ padding: '0.55rem 0.65rem' }}>
                        <strong style={{ color: isVoided ? '#991b1b' : '#0f172a', fontWeight: 800, textDecoration: isVoided ? 'line-through' : 'none', whiteSpace: 'nowrap' }}>
                          {visit.ticket_number || `SD-${String(visit.id).slice(-4)}`}
                        </strong>
                        <span style={{ display: 'block', fontSize: '0.625rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                          {visit.salon_nombre || 'San Vicente'}
                        </span>
                      </td>

                      {/* FECHA & HORA ENTRADA */}
                      <td style={{ padding: '0.55rem 0.65rem', whiteSpace: 'nowrap' }}>
                        <span style={{ fontWeight: 700, color: '#0f172a' }}>{timing.formattedDate}</span>
                        <span style={{ display: 'block', fontSize: '0.625rem', color: '#64748b' }}>
                          Entrada: {timing.formattedStartTime}
                        </span>
                      </td>

                      {/* HORA FACTURACION */}
                      <td style={{ padding: '0.55rem 0.65rem', whiteSpace: 'nowrap' }}>
                        <strong style={{ color: '#0f172a', fontWeight: 700 }}>
                          {timing.formattedEndTime}
                        </strong>
                      </td>

                      {/* TIEMPO TRANSCURRIDO (DURACION) */}
                      <td style={{ padding: '0.55rem 0.65rem', whiteSpace: 'nowrap' }}>
                        <span style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#334155', padding: '2px 5px', borderRadius: '5px', fontSize: '0.65rem', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                          <Clock size={10} color="#64748b" />
                          {timing.durationText}
                        </span>
                      </td>

                      {/* CLIENTE */}
                      <td style={{ padding: '0.55rem 0.65rem' }}>
                        <strong style={{ color: '#0f172a', display: 'block', whiteSpace: 'nowrap', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {visit.client_name || 'Cliente General'}
                        </strong>
                        <span style={{ fontSize: '0.625rem', color: '#64748b' }}>
                          ID: {visit.client_id || 'INVITADO'}
                        </span>
                      </td>

                      {/* SERVICIOS & PERSONAL */}
                      <td style={{ padding: '0.55rem 0.65rem' }}>
                        <div style={{ fontWeight: 700, color: isVoided ? '#991b1b' : '#0f172a', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {displayService}
                        </div>
                        <span style={{ fontSize: '0.65rem', color: '#64748b', display: 'block', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          💇‍♀️ {staffDisplay.length > 0 ? staffDisplay.join(', ') : 'Personal de turno'}
                        </span>
                      </td>

                      {/* METODO BADGE */}
                      <td style={{ padding: '0.55rem 0.65rem', whiteSpace: 'nowrap' }}>
                        {breakdown.isPlanBeauty ? (
                          <span style={{ background: '#fdf2f8', color: '#be185d', border: '1px solid #fbcfe8', padding: '2px 6px', borderRadius: '5px', fontSize: '0.65rem', fontWeight: 800 }}>
                            💎 Plan Beauty
                          </span>
                        ) : breakdown.displayMethod === 'Mixto' ? (
                          <span style={{ background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a', padding: '2px 6px', borderRadius: '5px', fontSize: '0.65rem', fontWeight: 800 }}>
                            🔀 Mixto
                          </span>
                        ) : breakdown.displayMethod === 'Tarjeta' ? (
                          <span style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '2px 6px', borderRadius: '5px', fontSize: '0.65rem', fontWeight: 800 }}>
                            💳 Tarjeta
                          </span>
                        ) : breakdown.displayMethod === 'Transferencia' ? (
                          <span style={{ background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe', padding: '2px 6px', borderRadius: '5px', fontSize: '0.65rem', fontWeight: 800 }}>
                            🏦 Transfer
                          </span>
                        ) : breakdown.displayMethod === 'Gift Card' ? (
                          <span style={{ background: '#faf5ff', color: '#9333ea', border: '1px solid #e9d5ff', padding: '2px 6px', borderRadius: '5px', fontSize: '0.65rem', fontWeight: 800 }}>
                            🎁 Gift Card
                          </span>
                        ) : (
                          <span style={{ background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', padding: '2px 6px', borderRadius: '5px', fontSize: '0.65rem', fontWeight: 800 }}>
                            💵 Efectivo
                          </span>
                        )}
                      </td>

                      {/* COLUMNA 1: EFECTIVO (RD$) */}
                      <td style={{ padding: '0.55rem 0.65rem', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700, color: isVoided ? '#991b1b' : (breakdown.efectivo > 0 ? '#15803d' : '#94a3b8') }}>
                        {breakdown.efectivo > 0 ? `RD$ ${breakdown.efectivo.toLocaleString('es-DO', { minimumFractionDigits: 2 })}` : '-'}
                      </td>

                      {/* COLUMNA 2: TARJETA (RD$) */}
                      <td style={{ padding: '0.55rem 0.65rem', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700, color: isVoided ? '#991b1b' : (breakdown.tarjeta > 0 ? '#1d4ed8' : '#94a3b8') }}>
                        {breakdown.tarjeta > 0 ? `RD$ ${breakdown.tarjeta.toLocaleString('es-DO', { minimumFractionDigits: 2 })}` : '-'}
                      </td>

                      {/* COLUMNA 3: TRANSFERENCIA (RD$) */}
                      <td style={{ padding: '0.55rem 0.65rem', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700, color: isVoided ? '#991b1b' : (breakdown.transferencia > 0 ? '#6d28d9' : '#94a3b8') }}>
                        {breakdown.transferencia > 0 ? `RD$ ${breakdown.transferencia.toLocaleString('es-DO', { minimumFractionDigits: 2 })}` : '-'}
                      </td>

                      {/* COLUMNA 4: TOTAL FACTURADO (RD$) */}
                      <td style={{ padding: '0.55rem 0.65rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {breakdown.isPlanBeauty ? (
                          <span style={{ color: '#be185d', fontWeight: 800, fontSize: '0.7rem' }}>
                            💎 Plan Beauty
                          </span>
                        ) : (
                          <strong style={{ fontSize: '0.825rem', fontWeight: 900, color: isVoided ? '#991b1b' : '#0f172a', textDecoration: isVoided ? 'line-through' : 'none' }}>
                            RD$ {Number(visit.total || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                          </strong>
                        )}
                      </td>

                      {/* ESTADO */}
                      <td style={{ padding: '0.55rem 0.65rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {isVoided ? (
                          <span style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', padding: '2px 5px', borderRadius: '4px', fontSize: '0.625rem', fontWeight: 800 }}>
                            🚫 ANULADA
                          </span>
                        ) : (
                          <span style={{ background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0', padding: '2px 5px', borderRadius: '4px', fontSize: '0.625rem', fontWeight: 800 }}>
                            ✅ Facturado
                          </span>
                        )}
                      </td>

                      {/* ACCIONES */}
                      <td className="no-print" style={{ padding: '0.55rem 0.65rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : (visit.id || index))}
                            style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '3px 5px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.15rem' }}
                            title="Ver desglose detallado de servicios"
                          >
                            {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                            <span>Detalle</span>
                          </button>

                          {!isVoided && canVoid && (
                            <button
                              type="button"
                              onClick={() => {
                                setTargetVisitToVoid(visit);
                                setShowVoidModal(true);
                              }}
                              style={{ background: '#fff1f2', color: '#be185d', border: '1px solid #fbcfe8', padding: '3px 5px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.15rem' }}
                              title="Anular esta factura con trazabilidad"
                            >
                              <XCircle size={10} />
                              Anular
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* EXPANDED ROW: DETAILS & BREAKDOWN */}
                    {isExpanded && (
                      <tr className="no-print" style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                        <td colSpan={13} style={{ padding: '0.75rem 1.5rem 1rem' }}>
                          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.9rem', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                            <h5 style={{ margin: '0 0 0.5rem', fontSize: '0.775rem', fontWeight: 800, color: '#334155' }}>
                              Desglose de Servicios & Colaboradores Asignados
                            </h5>
                            {itemsList.length > 0 ? (
                              <table style={{ width: '100%', fontSize: '0.725rem', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead>
                                  <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                                    <th style={{ padding: '0.35rem' }}>Servicio</th>
                                    <th style={{ padding: '0.35rem' }}>Colaborador Asignado</th>
                                    <th style={{ padding: '0.35rem', textAlign: 'right' }}>Precio</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {itemsList.map((it, iIdx) => (
                                    <tr key={iIdx} style={{ borderBottom: iIdx === itemsList.length - 1 ? 'none' : '1px solid #f1f5f9' }}>
                                      <td style={{ padding: '0.35rem', fontWeight: 700, color: '#0f172a' }}>
                                        {it.nombre || it.service_name || it.servicio}
                                      </td>
                                      <td style={{ padding: '0.35rem', color: '#475569' }}>
                                        {it.empleado_nombre || it.employee_name || it.empleado || 'Personal Salón'}
                                      </td>
                                      <td style={{ padding: '0.35rem', textAlign: 'right', fontWeight: 800, color: '#059669' }}>
                                        RD$ {Number(it.precioAplicado || it.precio || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <p style={{ margin: 0, fontSize: '0.725rem', color: '#64748b' }}>
                                Servicio: {displayService}
                              </p>
                            )}

                            {isVoided && (
                              <div style={{ marginTop: '0.65rem', padding: '0.45rem 0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#991b1b', fontSize: '0.7rem' }}>
                                <strong>⚠️ REGISTRO DE AUDITORÍA:</strong> Factura anulada por {visit.voided_by || 'Admin'} • Motivo: {visit.void_reason || 'Sin especificar'} • Fecha: {visit.voided_at ? new Date(visit.voided_at).toLocaleString('es-DO') : timing.formattedDate}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>

            {/* REQUESTED TOTALS ROW AT BOTTOM OVER SELECTED DATE RANGE */}
            <tfoot>
              <tr style={{ background: '#0f172a', color: '#ffffff', fontWeight: 900, borderTop: '2px solid #334155' }}>
                <td colSpan={7} style={{ padding: '0.75rem 0.85rem', fontSize: '0.775rem', letterSpacing: '0.5px' }}>
                  📊 TOTAL GENERAL DEL PERÍODO ({kpis.activeCount} facturas activas):
                </td>
                
                {/* TOTAL EFECTIVO */}
                <td style={{ padding: '0.75rem 0.65rem', textAlign: 'right', background: '#064e3b', color: '#a7f3d0', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                  RD$ {kpis.totalCash.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                </td>

                {/* TOTAL TARJETA */}
                <td style={{ padding: '0.75rem 0.65rem', textAlign: 'right', background: '#1e3a8a', color: '#bfdbfe', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                  RD$ {kpis.totalCard.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                </td>

                {/* TOTAL TRANSFERENCIA */}
                <td style={{ padding: '0.75rem 0.65rem', textAlign: 'right', background: '#4c1d95', color: '#e9d5ff', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                  RD$ {kpis.totalTransfer.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                </td>

                {/* GRAN TOTAL FACTURADO */}
                <td style={{ padding: '0.75rem 0.65rem', textAlign: 'right', background: '#831843', color: '#fbcfe8', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                  RD$ {kpis.totalBilled.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                </td>

                <td colSpan={2} className="no-print" style={{ padding: '0.75rem 0.65rem', textAlign: 'center', fontSize: '0.7rem', color: '#94a3b8' }}>
                  -
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        {/* PAGINATION CONTROLS BAR */}
        {!loading && filteredVisits.length > 0 && (
          <div className="no-print" style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.65rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                Mostrando {rowsPerPage === 'all' ? `1 - ${filteredVisits.length}` : `${Math.min(filteredVisits.length, (currentPage - 1) * (Number(rowsPerPage) || 25) + 1)} - ${Math.min(filteredVisits.length, currentPage * (Number(rowsPerPage) || 25))}`} de {filteredVisits.length} facturas
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.725rem', color: '#64748b' }}>Por página:</span>
                <select
                  value={rowsPerPage}
                  onChange={(e) => {
                    const val = e.target.value === 'all' ? 'all' : Number(e.target.value);
                    setRowsPerPage(val);
                    setCurrentPage(1);
                  }}
                  style={{ padding: '0.25rem 0.45rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.725rem', background: '#ffffff', fontWeight: 600 }}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={250}>250</option>
                  <option value="all">Todas</option>
                </select>
              </div>
            </div>

            {rowsPerPage !== 'all' && totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage(1)}
                  style={{ padding: '0.3rem 0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', fontSize: '0.725rem', fontWeight: 700, color: currentPage <= 1 ? '#94a3b8' : '#334155', cursor: currentPage <= 1 ? 'not-allowed' : 'pointer' }}
                >
                  «
                </button>
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  style={{ padding: '0.3rem 0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', fontSize: '0.725rem', fontWeight: 700, color: currentPage <= 1 ? '#94a3b8' : '#334155', cursor: currentPage <= 1 ? 'not-allowed' : 'pointer' }}
                >
                  ‹ Anterior
                </button>
                <span style={{ padding: '0 0.5rem', fontSize: '0.75rem', fontWeight: 800, color: '#0f172a' }}>
                  Página {currentPage} de {totalPages}
                </span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  style={{ padding: '0.3rem 0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', fontSize: '0.725rem', fontWeight: 700, color: currentPage >= totalPages ? '#94a3b8' : '#334155', cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer' }}
                >
                  Siguiente ›
                </button>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage(totalPages)}
                  style={{ padding: '0.3rem 0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', fontSize: '0.725rem', fontWeight: 700, color: currentPage >= totalPages ? '#94a3b8' : '#334155', cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer' }}
                >
                  »
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* PRINT & PDF PREVIEW MODAL */}
      {showPrintModal && (
        <div className="no-print" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: '1rem' }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: '1050px', maxHeight: '90vh', borderRadius: '18px', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', overflow: 'hidden' }}>
            
            {/* MODAL HEADER */}
            <div style={{ padding: '1rem 1.5rem', background: '#0f172a', color: '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <Printer size={20} color="#fbcfe8" />
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>Vista Previa de Impresión / Guardar en PDF</h3>
                  <span style={{ fontSize: '0.725rem', color: '#94a3b8' }}>Documento Contable Oficial ({getPeriodLabel()})</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={handlePrintDocument}
                  style={{ background: '#be185d', color: '#ffffff', border: 'none', padding: '0.5rem 1.1rem', borderRadius: '8px', fontSize: '0.775rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <Printer size={14} />
                  <span>Imprimir / PDF Ahora</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowPrintModal(false)}
                  style={{ background: 'rgba(255,255,255,0.1)', color: '#ffffff', border: 'none', borderRadius: '8px', padding: '0.5rem 0.75rem', fontSize: '0.75rem', cursor: 'pointer' }}
                >
                  ✕ Cerrar
                </button>
              </div>
            </div>

            {/* PREVIEW CONTAINER */}
            <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1, background: '#f8fafc' }}>
              <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
                
                {/* DOCUMENT HEADER */}
                <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: '1rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.4rem', fontWeight: 900, color: '#be185d' }}>
                      PLAN BEAUTY RD
                    </h2>
                    <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 700, color: '#0f172a' }}>
                      Reporte Financiero Oficial de Facturación y Ventas
                    </p>
                    <span style={{ fontSize: '0.725rem', color: '#64748b' }}>
                      Sucursal: {getSalonLabel()} • RNC / Control Interno
                    </span>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '0.725rem', color: '#334155' }}>
                    <div><strong>Período:</strong> {getPeriodLabel()}</div>
                    <div><strong>Emisión:</strong> {new Date().toLocaleString('es-DO')}</div>
                    <div><strong>Facturas:</strong> {kpis.activeCount} activas ({kpis.voidedCount} anuladas)</div>
                  </div>
                </div>

                {/* EXECUTIVE SUMMARY BOXES */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
                  <div style={{ border: '1px solid #bbf7d0', background: '#f0fdf4', padding: '0.65rem', borderRadius: '8px' }}>
                    <span style={{ fontSize: '0.65rem', color: '#166534', fontWeight: 700, textTransform: 'uppercase' }}>Ingreso Efectivo</span>
                    <div style={{ fontSize: '1.05rem', fontWeight: 900, color: '#15803d' }}>
                      RD$ {kpis.totalCash.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div style={{ border: '1px solid #bfdbfe', background: '#eff6ff', padding: '0.65rem', borderRadius: '8px' }}>
                    <span style={{ fontSize: '0.65rem', color: '#1e40af', fontWeight: 700, textTransform: 'uppercase' }}>Ingreso Tarjeta</span>
                    <div style={{ fontSize: '1.05rem', fontWeight: 900, color: '#1d4ed8' }}>
                      RD$ {kpis.totalCard.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div style={{ border: '1px solid #ddd6fe', background: '#f5f3ff', padding: '0.65rem', borderRadius: '8px' }}>
                    <span style={{ fontSize: '0.65rem', color: '#6b21a8', fontWeight: 700, textTransform: 'uppercase' }}>Transferencias</span>
                    <div style={{ fontSize: '1.05rem', fontWeight: 900, color: '#6d28d9' }}>
                      RD$ {kpis.totalTransfer.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div style={{ border: '1px solid #fbcfe8', background: '#fdf2f8', padding: '0.65rem', borderRadius: '8px' }}>
                    <span style={{ fontSize: '0.65rem', color: '#9d174d', fontWeight: 700, textTransform: 'uppercase' }}>Total Facturado</span>
                    <div style={{ fontSize: '1.15rem', fontWeight: 900, color: '#be185d' }}>
                      RD$ {kpis.totalBilled.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>

                {/* SUMMARY TABLE PREVIEW */}
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem', textAlign: 'left', marginBottom: '1.5rem' }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1', color: '#0f172a', fontWeight: 800 }}>
                      <th style={{ padding: '5px' }}>Ticket</th>
                      <th style={{ padding: '5px' }}>Fecha/Hora</th>
                      <th style={{ padding: '5px' }}>Duración</th>
                      <th style={{ padding: '5px' }}>Cliente</th>
                      <th style={{ padding: '5px' }}>Servicio</th>
                      <th style={{ padding: '5px' }}>Método</th>
                      <th style={{ padding: '5px', textAlign: 'right' }}>Efectivo</th>
                      <th style={{ padding: '5px', textAlign: 'right' }}>Tarjeta</th>
                      <th style={{ padding: '5px', textAlign: 'right' }}>Transfer</th>
                      <th style={{ padding: '5px', textAlign: 'right' }}>Total RD$</th>
                      <th style={{ padding: '5px', textAlign: 'center' }}>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVisits.map((v, i) => {
                      const timing = getVisitTiming(v);
                      const b = getPaymentBreakdown(v);
                      const isV = v.status === 'Anulado';

                      let sNames = [];
                      try {
                        if (v.items_detail) {
                          const parsed = typeof v.items_detail === 'string' ? JSON.parse(v.items_detail) : v.items_detail;
                          if (Array.isArray(parsed)) sNames = parsed.map(it => it.nombre || it.service_name || '');
                        }
                      } catch (e) {}

                      let displayService = sNames.join(' + ');
                      if (!displayService || displayService === 'Ticket en Construcción') {
                        displayService = b.isPlanBeauty ? 'Lavado y Secado (Plan Beauty)' : (v.servicios || 'Servicio General');
                      }

                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #e2e8f0', background: isV ? '#fef2f2' : 'transparent' }}>
                          <td style={{ padding: '4px 5px', fontWeight: 700 }}>{v.ticket_number || `SD-${String(v.id).slice(-4)}`}</td>
                          <td style={{ padding: '4px 5px' }}>{timing.formattedDate} {timing.formattedEndTime}</td>
                          <td style={{ padding: '4px 5px' }}>{timing.durationText}</td>
                          <td style={{ padding: '4px 5px', fontWeight: 600 }}>{v.client_name || 'Cliente'}</td>
                          <td style={{ padding: '4px 5px', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {displayService}
                          </td>
                          <td style={{ padding: '4px 5px' }}>{b.displayMethod}</td>
                          <td style={{ padding: '4px 5px', textAlign: 'right' }}>{b.efectivo > 0 ? b.efectivo.toFixed(2) : '-'}</td>
                          <td style={{ padding: '4px 5px', textAlign: 'right' }}>{b.tarjeta > 0 ? b.tarjeta.toFixed(2) : '-'}</td>
                          <td style={{ padding: '4px 5px', textAlign: 'right' }}>{b.transferencia > 0 ? b.transferencia.toFixed(2) : '-'}</td>
                          <td style={{ padding: '4px 5px', textAlign: 'right', fontWeight: 800 }}>{b.isPlanBeauty ? 'Plan Beauty' : `RD$ ${b.total.toFixed(2)}`}</td>
                          <td style={{ padding: '4px 5px', textAlign: 'center' }}>{isV ? 'ANULADA' : 'OK'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#0f172a', color: '#ffffff', fontWeight: 900 }}>
                      <td colSpan={6} style={{ padding: '6px' }}>TOTALES ({kpis.activeCount} facturas activas):</td>
                      <td style={{ padding: '6px', textAlign: 'right' }}>RD$ {kpis.totalCash.toFixed(2)}</td>
                      <td style={{ padding: '6px', textAlign: 'right' }}>RD$ {kpis.totalCard.toFixed(2)}</td>
                      <td style={{ padding: '6px', textAlign: 'right' }}>RD$ {kpis.totalTransfer.toFixed(2)}</td>
                      <td style={{ padding: '6px', textAlign: 'right', background: '#be185d' }}>RD$ {kpis.totalBilled.toFixed(2)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>

                {/* SIGNATURE / AUDIT FOOTER */}
                <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'space-around', textAlign: 'center', fontSize: '0.725rem', color: '#475569' }}>
                  <div>
                    <div style={{ width: '180px', borderTop: '1px solid #64748b', margin: '0 auto 0.25rem' }}></div>
                    <span>Elaborado por (Cajero / Supervisor)</span>
                  </div>
                  <div>
                    <div style={{ width: '180px', borderTop: '1px solid #64748b', margin: '0 auto 0.25rem' }}></div>
                    <span>Revisado / Aprobado (Gerencia)</span>
                  </div>
                </div>

              </div>
            </div>

            {/* MODAL FOOTER */}
            <div style={{ padding: '0.85rem 1.5rem', background: '#f1f5f9', borderTop: '1px solid #cbd5e1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.725rem', color: '#64748b' }}>
                💡 Tip: En la ventana de impresión, selecciona destino "Guardar como PDF" para archivar este reporte en digital.
              </span>
              <button
                type="button"
                onClick={handlePrintDocument}
                style={{ background: '#0f172a', color: '#ffffff', border: 'none', padding: '0.5rem 1.25rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <Printer size={15} />
                <span>Imprimir / Guardar en PDF</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ANULACION MODAL */}
      {showVoidModal && targetVisitToVoid && (
        <div className="no-print" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: '500px', borderRadius: '20px', padding: '1.75rem', boxShadow: '0 20px 40px rgba(0,0,0,0.2)', border: '1px solid #cbd5e1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '0.5rem', borderRadius: '12px', color: '#dc2626' }}>
                  <AlertTriangle size={24} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                    Anular Factura #{targetVisitToVoid.ticket_number || targetVisitToVoid.id}
                  </h3>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    Trazabilidad de Auditoría Inmutable (Sección 16)
                  </span>
                </div>
              </div>
              <button 
                onClick={() => setShowVoidModal(false)}
                style={{ background: '#f1f5f9', border: 'none', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.85rem', marginBottom: '1rem', fontSize: '0.8rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <span style={{ color: '#64748b' }}>Cliente:</span>
                <strong style={{ color: '#0f172a' }}>{targetVisitToVoid.client_name || 'Cliente General'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <span style={{ color: '#64748b' }}>Monto Total:</span>
                <strong style={{ color: '#be185d', fontWeight: 800 }}>RD$ {Number(targetVisitToVoid.total || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Método de Pago:</span>
                <strong style={{ color: '#0f172a' }}>{targetVisitToVoid.metodo_pago || 'Efectivo'}</strong>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
                  Motivo de anulación (Obligatorio)*
                </label>
                <select
                  value={voidReasonCategory}
                  onChange={(e) => setVoidReasonCategory(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.8rem', background: '#ffffff' }}
                >
                  <option value="Error de cobro / método de pago">Error de cobro / método de pago</option>
                  <option value="Servicio no realizado o cancelado por cliente">Servicio no realizado o cancelado por cliente</option>
                  <option value="Cobro duplicado">Cobro duplicado</option>
                  <option value="Factura de prueba">Factura de prueba</option>
                  <option value="Otro motivo justificado">Otro motivo justificado</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
                  Detalles adicionales / Justificación
                </label>
                <input
                  type="text"
                  placeholder="Ej: Se cobró en efectivo por error en lugar de tarjeta..."
                  value={voidCustomReason}
                  onChange={(e) => setVoidCustomReason(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.8rem', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
                  Nombre del Supervisor / Cajero que anula*
                </label>
                <input
                  type="text"
                  placeholder="Tu nombre o usuario..."
                  value={voidUser}
                  onChange={(e) => setVoidUser(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.8rem', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setShowVoidModal(false)}
                style={{ flex: 1, background: '#f1f5f9', border: 'none', color: '#475569', padding: '0.75rem', borderRadius: '10px', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmVoidVisit}
                disabled={isSubmittingVoid}
                style={{ flex: 1.2, background: '#dc2626', border: 'none', color: '#ffffff', padding: '0.75rem', borderRadius: '10px', fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer', opacity: isSubmittingVoid ? 0.7 : 1 }}
              >
                {isSubmittingVoid ? 'Procesando...' : 'Confirmar Anulación'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
