import React, { useState, useEffect } from 'react';
import { Clock, User, Calendar, MapPin, Smartphone, Image as ImageIcon, Search, Check, RefreshCw, Printer } from 'lucide-react';
import { dataService } from '../../utils/dataService';

const format12h = (timeStr) => {
  if (!timeStr) return '';
  const parts = timeStr.split(':');
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1] ? parts[1].padStart(2, '0') : '00';
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${hours}:${minutes} ${ampm}`;
};

const formatTimeShort = (timeStr) => {
  if (!timeStr) return '';
  const parts = timeStr.split(':');
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1] ? parseInt(parts[1], 10) : 0;
  const ampm = hours >= 12 ? 'p' : 'a';
  hours = hours % 12;
  hours = hours ? hours : 12;
  
  if (minutes === 0) {
    return `${hours}${ampm}`;
  }
  return `${hours}:${String(minutes).padStart(2, '0')}${ampm}`;
};

const AttendanceLogs = () => {
  const [logs, setLogs] = useState([]);
  const [todayLogs, setTodayLogs] = useState([]);
  const [todayLoading, setTodayLoading] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [filters, setFilters] = useState({
    startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('sv-SE'), // últimos 7 días
    endDate: new Date().toLocaleDateString('sv-SE'),
    employeeId: '',
    salonId: '',
    status: '',
    type: ''
  });
  const [salons, setSalons] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [activeTab, setActiveTab] = useState('history'); // 'history', 'today', 'overrides'
  const [positionFilter, setPositionFilter] = useState('');

  // Schedule overrides states
  const [overridesList, setOverridesList] = useState([]);
  const [isOverrideModalOpen, setIsOverrideModalOpen] = useState(false);
  const [overrideMode, setOverrideMode] = useState('individual'); // 'individual' o 'swap'
  const [newOverrideForm, setNewOverrideForm] = useState({
    employeeId: '',
    employeeId2: '',
    date: new Date().toLocaleDateString('sv-SE'),
    newHoraEntrada: '09:00',
    newHoraSalida: '18:00',
    reason: ''
  });

  // Pending logs state variables
  const [pendingLogs, setPendingLogs] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [selectedPendingRecord, setSelectedPendingRecord] = useState(null);
  const [notifyingRecordId, setNotifyingRecordId] = useState(null);
  const [adjustForm, setAdjustForm] = useState({
    checkInTime: '',
    checkOutTime: '',
    reason: ''
  });

  // Payroll / Summary state variables
  const [payrollPage, setPayrollPage] = useState(1);
  const [payrollSearch, setPayrollSearch] = useState('');
  const [payrollFilter, setPayrollFilter] = useState('all'); // 'all', 'tardy', 'overtime', 'absent'

  // History Pagination & Timezone helpers
  const [historyPage, setHistoryPage] = useState(1);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const formatDRDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      // If it contains a time portion (T or :), parse it fully using America/Santo_Domingo timezone
      if (dateStr.includes('T') || dateStr.includes(':')) {
        const date = new Date(dateStr);
        return date.toLocaleDateString('es-DO', {
          timeZone: 'America/Santo_Domingo',
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        });
      }
      // Parse YYYY-MM-DD as UTC noon to avoid any timezone boundary issues for date-only strings
      const parts = dateStr.split('-');
      if (parts.length !== 3) return dateStr;
      const utcDate = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 16, 0, 0)); // 4pm UTC = noon DR (UTC-4)
      return utcDate.toLocaleDateString('es-DO', {
        timeZone: 'America/Santo_Domingo',
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    } catch (e) {
      return dateStr;
    }
  };


  const formatDRTime = (dateStr) => {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      return date.toLocaleTimeString('es-DO', {
        timeZone: 'America/Santo_Domingo',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    } catch (e) {
      return dateStr;
    }
  };

  const loadLogs = async () => {
    setLoading(true);
    try {
      const data = await dataService.getAttendanceLogs(filters);
      setLogs(data || []);
    } catch (err) {
      console.error("Error loading attendance history:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadTodayLogs = async () => {
    setTodayLoading(true);
    try {
      const data = await dataService.getAttendanceToday();
      setTodayLogs(data || []);
    } catch (err) {
      console.error("Error loading today attendance logs:", err);
    } finally {
      setTodayLoading(false);
    }
  };


  useEffect(() => {
    const loadEmployees = async () => {
      try {
        const staff = await dataService.getEmployees();
        const users = await dataService.getUsers();
        
        const systemStaff = (users || []).filter(u => {
          const role = (u.role_name || '').toLowerCase();
          return !role.includes('admin') && !role.includes('client') && u.status !== 'Inactivo';
        });

        const combined = [...(staff || [])];
        systemStaff.forEach(sysUser => {
          if (!combined.some(c => c.nombre.toLowerCase().trim() === sysUser.nombre.toLowerCase().trim())) {
            combined.push(sysUser);
          }
        });

        setEmployees(combined);

        // Fetch overrides list on mount
        try {
          const overridesData = await dataService.getScheduleOverrides();
          setOverridesList(overridesData || []);
        } catch (ovErr) {
          console.error("Error loading overrides on mount:", ovErr);
        }

        // Fetch salons list
        const salonsRes = await fetch('/api/salons');
        if (salonsRes.ok) {
          const salonsData = await salonsRes.json();
          setSalons(salonsData || []);
        }
      } catch (err) {
        console.error("Error loading employees/salons:", err);
      }
    };
    loadEmployees();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const empId = params.get('employeeId');
    if (empId) {
      setFilters(prev => ({ ...prev, employeeId: empId }));
    }
  }, []);

  const loadOverrides = async () => {
    setLoading(true);
    try {
      const data = await dataService.getScheduleOverrides();
      setOverridesList(data || []);
    } catch (err) {
      console.error("Error loading schedule overrides:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadPendingLogs = async () => {
    setPendingLoading(true);
    try {
      const data = await dataService.getAttendancePending(filters);
      setPendingLogs(data || []);
    } catch (err) {
      console.error("Error loading pending logs:", err);
    } finally {
      setPendingLoading(false);
    }
  };

  const handleOpenAdjustModal = (record) => {
    setSelectedPendingRecord(record);
    setAdjustForm({
      checkInTime: record.checkIn ? record.checkIn.time.substring(0, 5) : (record.scheduledIn ? record.scheduledIn.substring(0, 5) : '09:00'),
      checkOutTime: record.checkOut ? record.checkOut.time.substring(0, 5) : (record.scheduledOut ? record.scheduledOut.substring(0, 5) : '18:00'),
      reason: ''
    });
    setIsAdjustModalOpen(true);
  };

  const handleSaveAdjustment = async (e) => {
    e.preventDefault();
    if (!adjustForm.reason.trim()) {
      alert("Por favor introduce el motivo del ajuste para la auditoría.");
      return;
    }

    const currentUser = JSON.parse(localStorage.getItem('user'));
    const creatorName = currentUser ? currentUser.nombre : 'Recepcionista';

    setLoading(true);
    try {
      const payload = {
        employeeId: selectedPendingRecord.employeeId,
        date: selectedPendingRecord.date,
        checkInTime: selectedPendingRecord.incidentType === 'missing_all' || selectedPendingRecord.incidentType === 'missing_checkin' ? adjustForm.checkInTime : null,
        checkOutTime: selectedPendingRecord.incidentType === 'missing_all' || selectedPendingRecord.incidentType === 'missing_checkout' ? adjustForm.checkOutTime : null,
        reason: adjustForm.reason,
        modifiedBy: creatorName
      };

      const res = await dataService.adjustAttendance(payload);
      if (res && res.success) {
        setIsAdjustModalOpen(false);
        await loadPendingLogs();
        await loadLogs();
        await loadTodayLogs();
      } else {
        alert("Fallo al guardar ajuste: " + (res?.error || 'Error desconocido'));
      }
    } catch (err) {
      console.error("Error saving adjustment:", err);
      alert("Error al procesar el ajuste.");
    } finally {
      setLoading(false);
    }
  };

  const handleNotifyPending = async (record) => {
    const key = `${record.employeeId}:${record.date}`;
    setNotifyingRecordId(key);
    try {
      const res = await dataService.notifyPendingAttendance({
        employeeId: record.employeeId,
        date: record.date,
        incidentType: record.incidentType
      });
      if (res && res.success) {
        alert(res.message);
      } else {
        alert("Fallo al enviar notificación: " + (res?.error || 'Error desconocido'));
      }
    } catch (err) {
      console.error("Error sending pending notification:", err);
      alert("Error al enviar la notificación.");
    } finally {
      setNotifyingRecordId(null);
    }
  };

  useEffect(() => {
    if (activeTab === 'today' || activeTab === 'overrides') {
      loadOverrides();
    }
    if (activeTab === 'today') {
      loadTodayLogs();
    }
    if (activeTab === 'pending') {
      loadPendingLogs();
    }
  }, [activeTab]);

  const handleSaveOverride = async (e) => {
    e.preventDefault();
    
    const currentUser = JSON.parse(localStorage.getItem('user'));
    const creatorName = currentUser ? currentUser.nombre : 'Recepcionista';

    setLoading(true);
    try {
      let res;
      if (overrideMode === 'swap') {
        if (!newOverrideForm.employeeId || !newOverrideForm.employeeId2 || !newOverrideForm.date || !newOverrideForm.reason) {
          alert("Por favor selecciona ambos empleados, la fecha y el motivo para el intercambio.");
          setLoading(false);
          return;
        }
        if (newOverrideForm.employeeId === newOverrideForm.employeeId2) {
          alert("Debes seleccionar dos empleados diferentes.");
          setLoading(false);
          return;
        }

        const payload = {
          employeeId1: newOverrideForm.employeeId,
          employeeId2: newOverrideForm.employeeId2,
          date: newOverrideForm.date,
          reason: newOverrideForm.reason,
          createdBy: creatorName
        };
        res = await dataService.saveScheduleSwap(payload);
      } else {
        if (!newOverrideForm.employeeId || !newOverrideForm.date || !newOverrideForm.newHoraEntrada || !newOverrideForm.newHoraSalida || !newOverrideForm.reason) {
          alert("Por favor completa todos los campos del cambio temporal.");
          setLoading(false);
          return;
        }
        const payload = {
          employeeId: newOverrideForm.employeeId,
          date: newOverrideForm.date,
          newHoraEntrada: newOverrideForm.newHoraEntrada + ':00',
          newHoraSalida: newOverrideForm.newHoraSalida + ':00',
          reason: newOverrideForm.reason,
          createdBy: creatorName
        };
        res = await dataService.saveScheduleOverride(payload);
      }

      if (res && res.success) {
        setIsOverrideModalOpen(false);
        setNewOverrideForm({
          employeeId: '',
          employeeId2: '',
          date: new Date().toLocaleDateString('sv-SE'),
          newHoraEntrada: '09:00',
          newHoraSalida: '18:00',
          reason: ''
        });
        await loadOverrides();
        // Recargar los logs históricos para actualizar la visualización
        await loadLogs();
        await loadTodayLogs();
      } else {
        alert("Fallo al guardar cambio temporal: " + (res?.error || 'Error desconocido'));
      }
    } catch (err) {
      console.error("Error saving override:", err);
      alert("Error al procesar la solicitud.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteOverride = async (id) => {
    if (!window.confirm("¿Estás seguro de que deseas anular este cambio de horario temporal?")) {
      return;
    }

    setLoading(true);
    try {
      const res = await dataService.deleteScheduleOverride(id);
      if (res && res.success) {
        await loadOverrides();
        await loadLogs();
        await loadTodayLogs();
      } else {
        alert("Fallo al anular cambio temporal: " + (res?.error || 'Error desconocido'));
      }
    } catch (err) {
      console.error("Error deleting override:", err);
      alert("Error al procesar la solicitud.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setHistoryPage(1);
    loadLogs();
    if (activeTab === 'pending') {
      loadPendingLogs();
    }
    if (activeTab === 'today') {
      loadTodayLogs();
    }
  }, [filters]);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
  };

  const handleRefresh = async () => {
    if (activeTab === 'history') {
      await loadLogs();
    } else if (activeTab === 'today') {
      await loadTodayLogs();
    } else if (activeTab === 'pending') {
      await loadPendingLogs();
    } else if (activeTab === 'overrides') {
      await loadOverrides();
    } else if (activeTab === 'payroll') {
      await loadLogs();
    }
  };


  const handlePrintPayroll = () => {
    // 1. Gather all payroll metrics dynamically per employee in range
    const computedPayroll = employees.map(emp => {
      const empLogs = logs.filter(log => String(log.employee_id) === String(emp.id));
      
      // Días Laborados
      const presentDates = new Set(
        empLogs
          .filter(log => log.type !== 'Ausencia')
          .map(log => new Date(log.timestamp).toISOString().split('T')[0])
      );
      const daysWorked = presentDates.size;

      // Tardanza Total (minutos)
      const totalLateness = empLogs
        .filter(log => log.type === 'Check-In' && log.status === 'Tardanza')
        .reduce((sum, log) => sum + (log.lateness_minutes || 0), 0);

      // Horas Extra Totales (minutos)
      const totalOvertime = empLogs
        .filter(log => log.type === 'Check-Out')
        .reduce((sum, log) => sum + (log.extra_minutes || 0), 0);

      // Ausencias (solo contar fechas donde el empleado no haya laborado)
      const absentDates = new Set(
        empLogs
          .filter(log => log.type === 'Ausencia')
          .map(log => new Date(log.timestamp).toISOString().split('T')[0])
      );
      const absencesCount = [...absentDates].filter(d => !presentDates.has(d)).length;


      // Tasa Puntualidad
      const totalCheckins = empLogs.filter(log => log.type === 'Check-In').length;
      const tardyCheckins = empLogs.filter(log => log.type === 'Check-In' && log.status === 'Tardanza').length;
      const punctualCheckins = totalCheckins - tardyCheckins;
      const punctualityRate = totalCheckins > 0 
        ? Math.round((punctualCheckins / totalCheckins) * 100) 
        : 100;

      return {
        ...emp,
        daysWorked,
        totalLateness,
        totalOvertime,
        absencesCount,
        punctualityRate
      };
    });

    // 2. Filter list based on search term, filters, and parent search filters
    const filteredPayroll = computedPayroll.filter(p => {
      // Parent employee filter integration
      if (filters.employeeId && String(p.id) !== String(filters.employeeId)) return false;
      // Local name text search
      if (payrollSearch && !p.nombre.toLowerCase().includes(payrollSearch.toLowerCase())) return false;
      // Local status filters
      if (payrollFilter === 'tardy' && p.totalLateness === 0) return false;
      if (payrollFilter === 'overtime' && p.totalOvertime === 0) return false;
      if (payrollFilter === 'absent' && p.absencesCount === 0) return false;
      
      // Localidad filter integration
      if (filters.salonId && String(p.salon_id) !== String(filters.salonId)) return false;
      
      return true;
    });

    const activeSalon = salons.find(s => String(s.id) === String(filters.salonId));
    const salonName = activeSalon ? activeSalon.name.replace('Abatte Peluquería ', '') : 'Todas las sucursales';
    
    const startStr = filters.startDate ? new Date(filters.startDate + 'T00:00:00').toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A';
    const endStr = filters.endDate ? new Date(filters.endDate + 'T00:00:00').toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A';
    const generationDate = new Date().toLocaleString('es-DO', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });

    const formatMins = (mins) => {
      if (!mins) return '0 min';
      const hrs = Math.floor(mins / 60);
      const remaining = mins % 60;
      if (hrs > 0) {
        return `${hrs}h ${remaining}m`;
      }
      return `${mins} min`;
    };

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert("Por favor, permite las ventanas emergentes para generar el PDF del reporte.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(`
      <html>
        <head>
          <title>Reporte de Nómina - Asistencia</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
            
            body {
              font-family: 'Plus Jakarta Sans', sans-serif;
              color: #0f172a;
              background: #ffffff;
              padding: 40px;
              margin: 0;
              line-height: 1.5;
            }
            
            .header-container {
              display: flex;
              justify-content: space-between;
              align-items: center;
              border-bottom: 3px solid #0f172a;
              padding-bottom: 16px;
              margin-bottom: 24px;
            }
            
            .logo-brand {
              font-size: 22px;
              font-weight: 900;
              letter-spacing: 0.05em;
              color: #0f172a;
            }
            
            .logo-sub {
              font-size: 22px;
              font-weight: 300;
              letter-spacing: 0.05em;
              color: #475569;
              margin-left: 4px;
            }
            
            .report-meta {
              text-align: right;
            }
            
            .report-tag {
              display: inline-block;
              background: #f1f5f9;
              color: #475569;
              font-size: 9px;
              font-weight: 800;
              padding: 3px 8px;
              border-radius: 4px;
              letter-spacing: 0.05em;
              margin-bottom: 4px;
            }
            
            .report-date {
              display: block;
              font-size: 11px;
              color: #64748b;
              font-weight: 500;
            }
            
            .main-title {
              font-size: 18px;
              font-weight: 800;
              color: #0f172a;
              margin: 0 0 4px 0;
              letter-spacing: -0.02em;
              text-transform: uppercase;
            }
            
            .subtitle {
              font-size: 12px;
              color: #64748b;
              margin: 0 0 24px 0;
              font-weight: 550;
            }

            .meta-grid {
              display: grid;
              grid-template-columns: repeat(4, 1fr);
              gap: 16px;
              margin-bottom: 30px;
              background: #f8fafc;
              padding: 16px 20px;
              border-radius: 12px;
              border: 1px solid #e2e8f0;
            }
            
            .meta-item {
              display: flex;
              flex-direction: column;
            }
            
            .meta-label {
              font-size: 9px;
              font-weight: 800;
              color: #64748b;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              margin-bottom: 4px;
            }
            
            .meta-value {
              font-size: 13px;
              font-weight: 700;
              color: #0f172a;
            }
            
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 35px;
            }
            
            tr {
              page-break-inside: avoid;
            }
            
            thead tr {
              background: #f8fafc;
            }
            
            th {
              padding: 12px 14px;
              font-size: 10px;
              font-weight: 800;
              color: #475569;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              text-align: left;
              border-top: 1px solid #cbd5e1;
              border-bottom: 2px solid #cbd5e1;
            }
            
            td {
              padding: 12px 14px;
              font-size: 12px;
              border-bottom: 1px solid #e2e8f0;
              color: #334155;
              white-space: nowrap;
            }
            
            td.emp-cell {
              white-space: normal;
            }
            
            tr:nth-child(even) {
              background: #fafafb;
            }
            
            .emp-name {
              font-weight: 800;
              color: #09090b;
            }
            
            .emp-id {
              font-size: 10px;
              color: #94a3b8;
              font-weight: 500;
              margin-top: 2px;
            }
            
            .badge-tardy {
              background: #fff7ed;
              color: #c2410c;
              border: 1px solid #ffedd5;
              padding: 4px 8px;
              border-radius: 6px;
              font-weight: 700;
              font-size: 11px;
              display: inline-block;
            }
            
            .badge-overtime {
              background: #f0fdf4;
              color: #166534;
              border: 1px solid #dcfce7;
              padding: 4px 8px;
              border-radius: 6px;
              font-weight: 700;
              font-size: 11px;
              display: inline-block;
            }
            
            .badge-absences {
              background: #fef2f2;
              color: #991b1b;
              border: 1px solid #fee2e2;
              padding: 4px 8px;
              border-radius: 6px;
              font-weight: 700;
              font-size: 11px;
              display: inline-block;
            }

            .text-muted {
              color: #94a3b8;
              font-weight: 500;
            }

            .rate-pill {
              padding: 4px 10px;
              border-radius: 99px;
              font-weight: 800;
              font-size: 11px;
              text-align: center;
              display: inline-block;
            }

            .rate-excellent {
              background: #dcfce7;
              color: #15803d;
              border: 1px solid #bbf7d0;
            }
            
            .rate-warning {
              background: #fef3c7;
              color: #b45309;
              border: 1px solid #fde68a;
            }
            
            .rate-danger {
              background: #fee2e2;
              color: #b91c1c;
              border: 1px solid #fca5a5;
            }

            .signature-section {
              margin-top: 50px;
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 40px;
              page-break-inside: avoid;
            }
            
            .signature-box {
              text-align: center;
            }
            
            .signature-line {
              border-top: 1.5px solid #cbd5e1;
              width: 200px;
              margin: 35px auto 6px auto;
            }
            
            .signature-title {
              font-size: 11px;
              color: #64748b;
              font-weight: 700;
            }
            
            .footer {
              margin-top: 50px;
              font-size: 10px;
              color: #94a3b8;
              text-align: center;
              border-top: 1px solid #f1f5f9;
              padding-top: 15px;
            }
          </style>
        </head>
        <body>
          <div class="header-container">
            <div class="logo-area">
              <span class="logo-brand">ABATTE</span><span class="logo-sub">PELUQUERÍA</span>
            </div>
            <div class="report-meta">
              <span class="report-tag">DOCUMENTO ADMINISTRATIVO</span>
              <span class="report-date">Generado: ${generationDate}</span>
            </div>
          </div>

          <h1 class="main-title">Resumen de Nómina y Asistencia</h1>
          <p class="subtitle">Reporte detallado de horas extras, tardanzas, ausencias y puntualidad acumulada</p>
          
          <div class="meta-grid">
            <div class="meta-item">
              <span class="meta-label">Sucursal / Localidad</span>
              <span class="meta-value">${salonName}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Período de Reporte</span>
              <span class="meta-value">${startStr} - ${endStr}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Fecha Impresión</span>
              <span class="meta-value">${generationDate.split(',')[0]}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Total Empleados</span>
              <span class="meta-value">${filteredPayroll.length}</span>
            </div>
          </div>
          
          <table>
            <thead>
              <tr>
                <th style="width: 30%;">Empleado</th>
                <th style="text-align: center;">Días Laborados</th>
                <th style="text-align: center;">Tardanza Total</th>
                <th style="text-align: center;">Horas Extra</th>
                <th style="text-align: center;">Ausencias</th>
                <th style="text-align: center;">Puntualidad</th>
              </tr>
            </thead>
            <tbody>
              ${filteredPayroll.map(p => {
                const rateClass = p.punctualityRate >= 90 ? 'rate-excellent' : (p.punctualityRate >= 75 ? 'rate-warning' : 'rate-danger');
                const latenessText = p.totalLateness > 0 
                  ? `<span class="badge-tardy">${formatMins(p.totalLateness)}</span>` 
                  : '<span class="text-muted">0 min</span>';
                const overtimeText = p.totalOvertime > 0 
                  ? `<span class="badge-overtime">${formatMins(p.totalOvertime)}</span>` 
                  : '<span class="text-muted">0 min</span>';
                const absencesContent = p.absencesCount > 0 
                  ? `<span class="badge-absences">${p.absencesCount}</span>` 
                  : '<span class="text-muted">0</span>';

                return `
                  <tr>
                    <td class="emp-cell">
                      <div class="emp-name">${p.nombre}</div>
                      <div class="emp-id">ID: ${p.id}</div>
                    </td>
                    <td style="text-align: center; font-weight: 700;">${p.daysWorked} días</td>
                    <td style="text-align: center;">${latenessText}</td>
                    <td style="text-align: center;">${overtimeText}</td>
                    <td style="text-align: center;">${absencesContent}</td>
                    <td style="text-align: center;">
                      <span class="rate-pill ${rateClass}">${p.punctualityRate}%</span>
                    </td>
                  </tr>
                `;
              }).join('')}
              ${filteredPayroll.length === 0 ? `
                <tr>
                  <td colspan="6" style="text-align: center; padding: 30px; color: #94a3b8; font-weight: 600;">
                    No se encontraron empleados que coincidan con los filtros.
                  </td>
                </tr>
              ` : ''}
            </tbody>
          </table>
          
          <div class="signature-section">
            <div class="signature-box">
              <div class="signature-line"></div>
              <span class="signature-title">Preparado Por (Gestión Humana)</span>
            </div>
            <div class="signature-box">
              <div class="signature-line"></div>
              <span class="signature-title">Autorizado Por (Administración)</span>
            </div>
          </div>
          
          <div class="footer">
            Este reporte es confidencial y para uso exclusivo administrativo de Abatte Peluquería.
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(() => {
      printWindow.print();
    }, 1000);
  };

  const getTodayStatus = (emp) => {
    const normalizeDayName = (str) => {
      if (!str) return '';
      return str.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
    };

    // Determine the current weekday name in America/Santo_Domingo timezone
    const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santo_Domingo', weekday: 'long' });
    const enToEsDay = {
      'Sunday': 'Domingo',
      'Monday': 'Lunes',
      'Tuesday': 'Martes',
      'Wednesday': 'Miércoles',
      'Thursday': 'Jueves',
      'Friday': 'Viernes',
      'Saturday': 'Sábado'
    };
    const todayName = enToEsDay[dayFormatter.format(new Date())] || 'Lunes';

    // Format today's date in YYYY-MM-DD format using America/Santo_Domingo timezone
    const todayDRStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' });

    // Check if there is an active override today for this employee
    const activeOverride = overridesList.find(o => {
      if (String(o.employee_id) !== String(emp.id) || o.status !== 'Activo') return false;
      if (!o.date) return false;
      try {
        const d = new Date(o.date);
        const overrideDateStr = d.toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' });
        return overrideDateStr === todayDRStr;
      } catch (e) {
        return false;
      }
    });

    let isWorkingDay = false;
    let empDailyHoraEntrada = emp.hora_entrada;
    let empDailyHoraSalida = emp.hora_salida;

    if (activeOverride) {
      isWorkingDay = true;
      empDailyHoraEntrada = activeOverride.new_hora_entrada;
      empDailyHoraSalida = activeOverride.new_hora_salida;
    } else {
      if (emp.dias_laborables && emp.dias_laborables.trim().startsWith('{')) {
        try {
          const parsedSchedule = JSON.parse(emp.dias_laborables);
          const normalizedToday = normalizeDayName(todayName);
          const matchingKey = Object.keys(parsedSchedule).find(k => normalizeDayName(k) === normalizedToday);
          const daySched = matchingKey ? parsedSchedule[matchingKey] : null;
          if (daySched && daySched.entrada && daySched.salida) {
            isWorkingDay = true;
            empDailyHoraEntrada = daySched.entrada;
            empDailyHoraSalida = daySched.salida;
          }
        } catch (e) {
          console.error("Error parsing daily schedule JSON in getTodayStatus:", e);
        }
      } else {
        const workingDays = (emp.dias_laborables || '').split(',');
        const normalizedToday = normalizeDayName(todayName);
        isWorkingDay = emp.dias_laborables && workingDays.some(d => normalizeDayName(d) === normalizedToday);
      }
    }

    // 1. Check today's logs
    const todayPunches = todayLogs.filter(log => String(log.employee_id) === String(emp.id));

    const checkIn = todayPunches.find(log => log.type === 'Check-In');
    const checkOut = todayPunches.find(log => log.type === 'Check-Out');

    if (checkIn) {
      let checkInExtraMinutes = 0;
      if (empDailyHoraEntrada) {
        try {
          const [entH, entM] = empDailyHoraEntrada.split(':').map(Number);
          const checkInDate = new Date(checkIn.timestamp);
          const checkInDRStr = checkInDate.toLocaleString('en-US', { timeZone: 'America/Santo_Domingo' });
          const checkInDR = new Date(checkInDRStr);
          
          const scheduledEntryDR = new Date(checkInDRStr);
          scheduledEntryDR.setHours(entH, entM, 0, 0);

          const diffMs = scheduledEntryDR - checkInDR;
          const earlyMinutes = diffMs / (1000 * 60);
          const grace = emp.tolerancia_minutos !== null && emp.tolerancia_minutos !== undefined ? emp.tolerancia_minutos : 15;

          if (earlyMinutes > grace) {
            checkInExtraMinutes = Math.floor(earlyMinutes);
          }
        } catch (err) {
          console.error("Error calculating checkInExtraMinutes:", err);
        }
      }

      return {
        status: checkIn.status === 'Tardanza' ? 'Tardanza' : 'Presente',
        latenessMinutes: checkIn.lateness_minutes || 0,
        extraMinutes: checkOut ? (checkOut.extra_minutes || 0) : 0,
        time: new Date(checkIn.timestamp).toLocaleTimeString('es-DO', { timeZone: 'America/Santo_Domingo', hour: '2-digit', minute: '2-digit' }),
        outTime: checkOut ? new Date(checkOut.timestamp).toLocaleTimeString('es-DO', { timeZone: 'America/Santo_Domingo', hour: '2-digit', minute: '2-digit' }) : null,
        color: checkIn.status === 'Tardanza' ? '#d97706' : '#16a34a',
        bg: checkIn.status === 'Tardanza' ? '#fef3c7' : '#dcfce7',
        border: checkIn.status === 'Tardanza' ? '#fde68a' : '#bbf7d0',
        expectedEntrada: empDailyHoraEntrada,
        expectedSalida: empDailyHoraSalida,
        checkInExtraMinutes
      };
    }

    if (!isWorkingDay) {
      return {
        status: 'No Laborable',
        time: null,
        color: '#64748b',
        bg: '#f1f5f9',
        border: '#e2e8f0',
        expectedEntrada: null,
        expectedSalida: null
      };
    }

    // 3. Check if shift start time + tolerance has passed
    if (empDailyHoraEntrada) {
      const [h, m, s] = empDailyHoraEntrada.split(':').map(Number);
      const nowDRStr = new Date().toLocaleString('en-US', { timeZone: 'America/Santo_Domingo' });
      const limitTime = new Date(nowDRStr);
      limitTime.setHours(h, m, s || 0, 0);
      const grace = emp.tolerancia_minutos !== null && emp.tolerancia_minutos !== undefined ? emp.tolerancia_minutos : 15;
      limitTime.setMinutes(limitTime.getMinutes() + grace);

      if (new Date(nowDRStr) > limitTime) {
        return {
          status: 'Ausente',
          time: null,
          color: '#dc2626',
          bg: '#fee2e2',
          border: '#fca5a5',
          expectedEntrada: empDailyHoraEntrada,
          expectedSalida: empDailyHoraSalida
        };
      }
    }

    return {
      status: 'Pendiente',
      time: null,
      color: '#2563eb',
      bg: '#dbeafe',
      border: '#bfdbfe',
      expectedEntrada: empDailyHoraEntrada,
      expectedSalida: empDailyHoraSalida
    };
  };

  const getScheduleForDay = (emp, dayName) => {
    let isWorking = false;
    let entrada = emp.hora_entrada;
    let salida = emp.hora_salida;

    if (emp.dias_laborables && emp.dias_laborables.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(emp.dias_laborables);
        const daySched = parsed[dayName];
        if (daySched && daySched.entrada && daySched.salida) {
          isWorking = true;
          entrada = daySched.entrada;
          salida = daySched.salida;
        }
      } catch (e) {
        console.error("Error parsing schedule in weekly view:", e);
      }
    } else if (emp.dias_laborables) {
      const workingDays = (emp.dias_laborables || '').split(',');
      isWorking = workingDays.includes(dayName);
    } else {
      isWorking = !!emp.hora_entrada;
    }

    return isWorking ? { entrada, salida } : null;
  };

  const getShiftBadgeStyles = (sched) => {
    if (!sched) {
      return {
        bg: '#f8fafc',
        color: '#94a3b8',
        border: '1px dashed #cbd5e1',
        label: 'Libre',
        fontWeight: 500
      };
    }
    
    const label = `${formatTimeShort(sched.entrada)} - ${formatTimeShort(sched.salida)}`;
    
    // Categorize shifts dynamically
    const isLate = sched.salida.startsWith('21:') || sched.salida.startsWith('20:') || sched.salida.startsWith('22:') || (sched.salida.includes && sched.salida.includes('PM') && (sched.salida.startsWith('9:') || sched.salida.startsWith('8:') || sched.salida.startsWith('10:')));
    const isHalfDay = sched.entrada.startsWith('08:') && (sched.salida.startsWith('12:') || sched.salida.startsWith('13:'));
    
    if (isLate) {
      return {
        bg: '#f3e8ff',
        color: '#6b21a8',
        border: '1px solid #e9d5ff',
        label,
        fontWeight: 750
      };
    }
    
    if (isHalfDay) {
      return {
        bg: '#fff7ed',
        color: '#c2410c',
        border: '1px solid #ffedd5',
        label,
        fontWeight: 750
      };
    }
    
    return {
      bg: '#f0fdf4',
      color: '#15803d',
      border: '1px solid #bbf7d0',
      label,
      fontWeight: 750
    };
  };

  const getCountBadgeStyles = (count) => {
    if (count === 0) {
      return {
        bg: '#fef2f2',
        color: '#b91c1c',
        border: '1px solid #fecaca',
        label: '0 personas'
      };
    }
    if (count <= 2) {
      return {
        bg: '#fffbeb',
        color: '#d97706',
        border: '1px solid #fde68a',
        label: `${count} ${count === 1 ? 'persona' : 'personas'}`
      };
    }
    return {
      bg: '#ecfdf5',
      color: '#047857',
      border: '1px solid #a7f3d0',
      label: `${count} personas`
    };
  };

  const filteredEmployees = filters.salonId
    ? employees.filter(emp => String(emp.salon_id) === String(filters.salonId))
    : employees;

  // Get all unique positions for the dropdown filter
  const uniquePositions = [...new Set(employees.map(emp => emp.rol || emp.posicion || emp.role_name || 'Personal').filter(Boolean))];

  const weeklyFilteredEmployees = employees.filter(emp => {
    const matchesSalon = !filters.salonId || String(emp.salon_id) === String(filters.salonId);
    const pos = emp.rol || emp.posicion || emp.role_name || 'Personal';
    const matchesPosition = !positionFilter || pos.toLowerCase().trim() === positionFilter.toLowerCase().trim();
    return matchesSalon && matchesPosition;
  });

  const todayStatuses = filteredEmployees.map(emp => ({ emp, result: getTodayStatus(emp) }));
  const totalCount = todayStatuses.length;
  const presentCount = todayStatuses.filter(s => s.result.status === 'Presente' || s.result.status === 'Tardanza').length;
  const absentCount = todayStatuses.filter(s => s.result.status === 'Ausente').length;
  const offCount = todayStatuses.filter(s => s.result.status === 'No Laborable').length;
  const pendingCount = todayStatuses.filter(s => s.result.status === 'Pendiente').length;

  const itemsPerPage = 15;
  const indexOfLastLog = historyPage * itemsPerPage;
  const indexOfFirstLog = indexOfLastLog - itemsPerPage;
  const currentLogs = logs.slice(indexOfFirstLog, indexOfLastLog);
  const totalPages = Math.ceil(logs.length / itemsPerPage);

  const isAnyLoading = loading || todayLoading || pendingLoading;

  return (
    <div style={{ padding: isMobile ? '1rem' : '2rem', fontFamily: '"Plus Jakarta Sans", sans-serif', color: '#09090b' }}>
      
      {/* Header */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: isMobile ? 'flex-start' : 'center', 
        flexDirection: isMobile ? 'column' : 'row',
        gap: '1rem',
        marginBottom: isMobile ? '1.25rem' : '2rem' 
      }}>
        <div>
          <h2 style={{ fontSize: isMobile ? '1.35rem' : '1.5rem', fontWeight: 900, margin: 0 }}>Control de Asistencia</h2>
          <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0.25rem 0 0 0' }}>Historial y registros biométricos de poncheo del personal</p>
        </div>
        
        <button
          onClick={handleRefresh}
          disabled={isAnyLoading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.6rem 1.2rem',
            background: 'white',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            fontSize: '0.85rem',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 2px 5px rgba(0,0,0,0.02)',
            width: isMobile ? '100%' : 'auto',
            justifyContent: 'center'
          }}
        >
          <RefreshCw size={16} className={isAnyLoading ? 'animate-spin' : ''} style={{ animation: isAnyLoading ? 'spin 1s linear infinite' : 'none' }} />
          Actualizar
        </button>
      </div>

      {/* Tab Navigation */}
      <div 
        className="hide-scrollbar" 
        style={{ 
          display: 'flex', 
          gap: '0.5rem', 
          borderBottom: '1px solid #e2e8f0', 
          marginBottom: '1.5rem', 
          paddingBottom: '0.5rem',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none'
        }}
      >
        <button
          onClick={() => setActiveTab('history')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'history' ? '3px solid #10b981' : '3px solid transparent',
            color: activeTab === 'history' ? '#09090b' : '#64748b',
            fontWeight: 800,
            fontSize: '0.9rem',
            padding: '0.5rem 1rem',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            flexShrink: 0
          }}
        >
          Historial de Ponches
        </button>
        <button
          onClick={() => setActiveTab('today')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'today' ? '3px solid #10b981' : '3px solid transparent',
            color: activeTab === 'today' ? '#09090b' : '#64748b',
            fontWeight: 800,
            fontSize: '0.9rem',
            padding: '0.5rem 1rem',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            flexShrink: 0
          }}
        >
          Estatus de Hoy
        </button>
        <button
          onClick={() => setActiveTab('pending')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'pending' ? '3px solid #ef4444' : '3px solid transparent',
            color: activeTab === 'pending' ? '#ef4444' : '#64748b',
            fontWeight: 800,
            fontSize: '0.9rem',
            padding: '0.5rem 1rem',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            flexShrink: 0
          }}
        >
          ⚠️ Pendientes
        </button>
        <button
          onClick={() => setActiveTab('weekly')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'weekly' ? '3px solid #10b981' : '3px solid transparent',
            color: activeTab === 'weekly' ? '#09090b' : '#64748b',
            fontWeight: 800,
            fontSize: '0.9rem',
            padding: '0.5rem 1rem',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            flexShrink: 0
          }}
        >
          📅 Horario Semanal
        </button>
        <button
          onClick={() => setActiveTab('overrides')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'overrides' ? '3px solid #10b981' : '3px solid transparent',
            color: activeTab === 'overrides' ? '#09090b' : '#64748b',
            fontWeight: 800,
            fontSize: '0.9rem',
            padding: '0.5rem 1rem',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            flexShrink: 0
          }}
        >
          Cambios de Horario (Excepciones)
        </button>
        <button
          onClick={() => setActiveTab('payroll')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'payroll' ? '3px solid #10b981' : '3px solid transparent',
            color: activeTab === 'payroll' ? '#09090b' : '#64748b',
            fontWeight: 800,
            fontSize: '0.9rem',
            padding: '0.5rem 1rem',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            flexShrink: 0
          }}
        >
          📊 Resumen de Nómina / Totales
        </button>
      </div>

      {activeTab === 'today' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {/* Localidad Filter Bar */}
          <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', background: '#f8fafc', padding: '1rem 1.5rem', borderRadius: '16px', border: '1px solid #e2e8f0', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Localidad:</span>
              <select
                name="salonId"
                value={filters.salonId}
                onChange={handleFilterChange}
                style={{ padding: '0.5rem 1rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem', background: 'white', cursor: 'pointer', fontWeight: 700, color: '#09090b', minWidth: '220px' }}
              >
                <option value="">Todas las localidades</option>
                {salons.map(sal => (
                  <option key={sal.id} value={sal.id}>{sal.name.replace('Abatte Peluquería ', '')}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Summary counters */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '1.25rem', borderRadius: '16px', textAlign: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 800 }}>Total Activos</span>
              <h3 style={{ fontSize: '2rem', fontWeight: 900, margin: '0.25rem 0 0 0', color: '#09090b' }}>{totalCount}</h3>
            </div>
            <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '1.25rem', borderRadius: '16px', textAlign: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: '#047857', textTransform: 'uppercase', fontWeight: 800 }}>Presentes</span>
              <h3 style={{ fontSize: '2rem', fontWeight: 900, margin: '0.25rem 0 0 0', color: '#065f46' }}>{presentCount}</h3>
            </div>
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '1.25rem', borderRadius: '16px', textAlign: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: '#b91c1c', textTransform: 'uppercase', fontWeight: 800 }}>Ausentes</span>
              <h3 style={{ fontSize: '2rem', fontWeight: 900, margin: '0.25rem 0 0 0', color: '#991b1b' }}>{absentCount}</h3>
            </div>
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', padding: '1.25rem', borderRadius: '16px', textAlign: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: '#1d4ed8', textTransform: 'uppercase', fontWeight: 800 }}>Pendientes</span>
              <h3 style={{ fontSize: '2rem', fontWeight: 900, margin: '0.25rem 0 0 0', color: '#1e40af' }}>{pendingCount}</h3>
            </div>
            <div style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '1.25rem', borderRadius: '16px', textAlign: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: '#475569', textTransform: 'uppercase', fontWeight: 800 }}>Día Libre</span>
              <h3 style={{ fontSize: '2rem', fontWeight: 900, margin: '0.25rem 0 0 0', color: '#334155' }}>{offCount}</h3>
            </div>
          </div>

          {/* Grid of employees status */}
          {todayLoading ? (
            <div style={{ padding: '5rem 3rem', textAlign: 'center', color: '#64748b', background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 10px rgba(0,0,0,0.01)' }}>
              <RefreshCw size={28} className="animate-spin" style={{ margin: '0 auto 1.25rem', animation: 'spin 1s linear infinite', color: '#10b981' }} />
              <span style={{ fontWeight: 650, fontSize: '0.95rem' }}>Cargando estatus de asistencia de hoy...</span>
            </div>
          ) : todayStatuses.length === 0 ? (
            <div style={{ padding: '5rem 3rem', textAlign: 'center', color: '#64748b', background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 10px rgba(0,0,0,0.01)' }}>
              <span style={{ fontWeight: 650, fontSize: '0.95rem' }}>No hay empleados registrados en esta localidad.</span>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1.25rem' }}>
              {todayStatuses.map(({ emp, result }) => (
                <div 
                  key={emp.id} 
                  style={{ 
                    background: 'white', 
                    border: '1px solid #e2e8f0', 
                    borderRadius: '16px', 
                    padding: '1.25rem', 
                    boxShadow: '0 4px 10px rgba(0,0,0,0.01)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                    position: 'relative'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '50%', overflow: 'hidden', background: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {emp.profile_photo ? (
                        <img src={emp.profile_photo} alt={emp.nombre} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ fontSize: '1.2rem', fontWeight: 800, color: '#64748b' }}>{emp.nombre.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#09090b' }}>{emp.nombre}</h4>
                      <p style={{ margin: '0.1rem 0 0 0', fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>{emp.rol || emp.posicion || emp.role_name || 'Personal'}</p>
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 800, display: 'block' }}>Horario Laboral</span>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}>
                        {result.expectedEntrada && result.expectedSalida
                          ? `${format12h(result.expectedEntrada)} - ${format12h(result.expectedSalida)}`
                          : 'No Laborable'}
                      </span>
                    </div>
                    <span style={{
                      padding: '0.35rem 0.75rem',
                      borderRadius: '99px',
                      fontSize: '0.75rem',
                      fontWeight: 800,
                      color: result.color,
                      background: result.bg,
                      border: `1px solid ${result.border}`
                    }}>
                      {result.status === 'Tardanza' && result.latenessMinutes > 0
                        ? `Tardanza (+${result.latenessMinutes} min)`
                        : result.status}
                    </span>
                  </div>

                  {result.time && (
                    <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '0.5rem 0.75rem', fontSize: '0.75rem', color: '#475569', fontWeight: 650, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>
                        Entrada: <strong style={{ color: '#09090b' }}>{result.time}</strong>
                        {(!result.outTime && result.checkInExtraMinutes > 0) && (
                          <span style={{ color: '#16a34a', fontWeight: 800, marginLeft: '6px' }} title="Tiempo Extra por Entrada Anticipada">
                            (+{result.checkInExtraMinutes}m Extra)
                          </span>
                        )}
                      </span>
                      {result.outTime && (
                        <span>
                          Salida: <strong style={{ color: '#09090b' }}>{result.outTime}</strong>
                          {result.extraMinutes > 0 && <span style={{ color: '#16a34a', fontWeight: 800, marginLeft: '4px' }} title="Horas Extras">(+{result.extraMinutes}m Extra)</span>}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'pending' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Filters Box */}
          <div style={{ background: 'white', border: '1px solid #e2e8f0', padding: '1.5rem', borderRadius: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem', marginBottom: '1rem', boxShadow: '0 4px 10px rgba(0,0,0,0.01)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Fecha Inicio</label>
              <input
                type="date"
                name="startDate"
                value={filters.startDate}
                onChange={handleFilterChange}
                style={{ padding: '0.6rem 1rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Fecha Fin</label>
              <input
                type="date"
                name="endDate"
                value={filters.endDate}
                onChange={handleFilterChange}
                style={{ padding: '0.6rem 1rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Empleado</label>
              <select
                name="employeeId"
                value={filters.employeeId}
                onChange={handleFilterChange}
                style={{ padding: '0.6rem 1rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem', background: 'white', cursor: 'pointer' }}
              >
                <option value="">Todos los empleados</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.nombre}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Localidad</label>
              <select
                name="salonId"
                value={filters.salonId}
                onChange={handleFilterChange}
                style={{ padding: '0.6rem 1rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem', background: 'white', cursor: 'pointer' }}
              >
                <option value="">Todas las localidades</option>
                {salons.map(sal => (
                  <option key={sal.id} value={sal.id}>{sal.name.replace('Abatte Peluquería ', '')}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Pending Logs List */}
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 4px 10px rgba(0,0,0,0.01)' }}>
            {pendingLoading ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 1rem', animation: 'spin 1s linear infinite' }} />
                <span>Cargando registros pendientes...</span>
              </div>
            ) : pendingLogs.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                <Check size={32} style={{ color: '#16a34a', margin: '0 auto 1rem' }} />
                <h4 style={{ margin: 0, fontWeight: 800, color: '#09090b' }}>¡Todo al día!</h4>
                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.85rem' }}>No hay registros de ponches pendientes para el periodo seleccionado.</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '1rem', fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Empleado</th>
                      <th style={{ padding: '1rem', fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Fecha</th>
                      <th style={{ padding: '1rem', fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Horario Teórico</th>
                      <th style={{ padding: '1rem', fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Incidencia</th>
                      <th style={{ padding: '1rem', fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Ponches Actuales</th>
                      <th style={{ padding: '1rem', fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', textAlign: 'center' }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingLogs.map((record) => {
                      const recordKey = `${record.employeeId}:${record.date}`;
                      
                      let badgeBg = '#fef2f2';
                      let badgeColor = '#dc2626';
                      let badgeLabel = 'Falta Entrada y Salida';
                      
                      if (record.incidentType === 'missing_checkin') {
                        badgeBg = '#fff7ed';
                        badgeColor = '#c2410c';
                        badgeLabel = 'Falta Entrada';
                      } else if (record.incidentType === 'missing_checkout') {
                        badgeBg = '#fff7ed';
                        badgeColor = '#c2410c';
                        badgeLabel = 'Falta Salida';
                      }

                      return (
                        <tr key={recordKey} style={{ borderBottom: '1px solid #e2e8f0' }} className="hover-row">
                          <td style={{ padding: '1rem' }}>
                            <span style={{ fontWeight: 800, color: '#09090b', display: 'block' }}>{record.employeeName}</span>
                            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>ID: {record.employeeId}</span>
                          </td>
                          <td style={{ padding: '1rem', fontWeight: 700, fontSize: '0.85rem' }}>
                            {formatDRDate(record.date)}
                          </td>
                          <td style={{ padding: '1rem', fontSize: '0.85rem', color: '#475569' }}>
                            {record.scheduledIn ? `${format12h(record.scheduledIn)} - ${format12h(record.scheduledOut)}` : 'No configurado'}
                          </td>
                          <td style={{ padding: '1rem' }}>
                            <span style={{ background: badgeBg, color: badgeColor, padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 800 }}>
                              {badgeLabel}
                            </span>
                          </td>
                          <td style={{ padding: '1rem', fontSize: '0.8rem', color: '#475569' }}>
                            <div>Entrada: <strong>{record.checkIn ? format12h(record.checkIn.time) : '--'}</strong></div>
                            <div>Salida: <strong>{record.checkOut ? format12h(record.checkOut.time) : '--'}</strong></div>
                          </td>
                          <td style={{ padding: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'center', alignItems: 'center' }}>
                            <button
                              onClick={() => handleOpenAdjustModal(record)}
                              style={{
                                background: '#10b981',
                                color: 'white',
                                border: 'none',
                                padding: '0.4rem 0.8rem',
                                borderRadius: '8px',
                                fontSize: '0.8rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.25rem'
                              }}
                            >
                              Regularizar
                            </button>
                            <button
                              onClick={() => handleNotifyPending(record)}
                              disabled={notifyingRecordId === recordKey}
                              style={{
                                background: '#ffffff',
                                color: '#ef4444',
                                border: '1px solid #fee2e2',
                                padding: '0.4rem 0.8rem',
                                borderRadius: '8px',
                                fontSize: '0.8rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.25rem'
                              }}
                            >
                              {notifyingRecordId === recordKey ? (
                                <RefreshCw size={12} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
                              ) : (
                                'Aviso'
                              )}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'weekly' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Filters Bar & Print Button */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '1rem 1.5rem', borderRadius: '16px', border: '1px solid #e2e8f0', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Localidad:</span>
                <select
                  name="salonId"
                  value={filters.salonId}
                  onChange={handleFilterChange}
                  style={{ padding: '0.5rem 1rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem', background: 'white', cursor: 'pointer', fontWeight: 700, color: '#09090b', minWidth: '200px' }}
                >
                  <option value="">Todas las localidades</option>
                  {salons.map(sal => (
                    <option key={sal.id} value={sal.id}>{sal.name.replace('Abatte Peluquería ', '')}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Posición / Rol:</span>
                <select
                  value={positionFilter}
                  onChange={(e) => setPositionFilter(e.target.value)}
                  style={{ padding: '0.5rem 1rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem', background: 'white', cursor: 'pointer', fontWeight: 700, color: '#09090b', minWidth: '200px' }}
                >
                  <option value="">Todas las posiciones</option>
                  {uniquePositions.map(pos => (
                    <option key={pos} value={pos}>{pos}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Print Button */}
            <button
              onClick={() => window.print()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: '#09090b',
                color: 'white',
                border: 'none',
                padding: '0.6rem 1.25rem',
                borderRadius: '10px',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
                transition: 'all 0.15s ease'
              }}
              className="no-print"
            >
              <Printer size={16} />
              Imprimir Horario
            </button>
          </div>

          {/* Turn colors Legend Row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap', padding: '0 0.5rem', fontSize: '0.78rem', color: '#475569', fontWeight: 650 }} className="no-print">
            <span style={{ fontWeight: 850, textTransform: 'uppercase', fontSize: '0.7rem', color: '#64748b' }}>Leyenda de Turnos:</span>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '4px', background: '#f0fdf4', border: '1px solid #bbf7d0' }}></span>
              <span>Día Completo (8h)</span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '4px', background: '#fff7ed', border: '1px solid #ffedd5' }}></span>
              <span>Medio Día (4h - 6h)</span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '4px', background: '#f3e8ff', border: '1px solid #e9d5ff' }}></span>
              <span>Tarde / Noche</span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '4px', background: '#f8fafc', border: '1px dashed #cbd5e1' }}></span>
              <span>Día Libre</span>
            </div>
          </div>

          {/* Weekly Schedule Grid Table & Print Area Wrapper */}
          <div id="weekly-schedule-print-area" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Title visible only in print */}
            <div className="print-only" style={{ display: 'none', marginBottom: '1.5rem', borderBottom: '2px solid #cbd5e1', paddingBottom: '0.75rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 900, color: '#09090b' }}>Plan Beauty RD</h2>
              <h3 style={{ margin: '0.25rem 0 0 0', fontSize: '1.1rem', fontWeight: 700, color: '#475569' }}>Horario de Trabajo Semanal</h3>
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#64748b', fontWeight: 650 }}>
                {filters.salonId ? `Sucursal: ${salons.find(s => String(s.id) === String(filters.salonId))?.name || ''}` : 'Todas las sucursales'}
                {positionFilter ? ` | Posición: ${positionFilter}` : ''}
              </p>
            </div>

            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '20px', overflow: 'hidden', boxShadow: '0 4px 15px rgba(0,0,0,0.02)' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: 'linear-gradient(to right, #f8fafc, #f1f5f9)', borderBottom: '2px solid #cbd5e1', color: '#475569', fontWeight: 800 }}>
                    <th style={{ padding: '1rem 1.25rem', width: '170px', letterSpacing: '0.05em', textTransform: 'uppercase', fontSize: '0.72rem' }}>Empleado</th>
                    {['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map(day => (
                      <th key={day} style={{ padding: '1rem 0.5rem', textAlign: 'center', letterSpacing: '0.05em', textTransform: 'uppercase', fontSize: '0.72rem' }}>{day}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weeklyFilteredEmployees.map(emp => {
                    return (
                      <tr key={emp.id} style={{ borderBottom: '1px solid #f1f5f9', transition: 'all 0.15s ease' }} className="hover-row">
                        {/* Employee Name & Position Column */}
                        <td style={{ padding: '0.75rem 1.25rem', fontWeight: 700 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <div className="no-print" style={{ 
                              width: '30px', 
                              height: '30px', 
                              borderRadius: '50%', 
                              overflow: 'hidden',
                              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
                              color: 'white', 
                              display: 'flex', 
                              alignItems: 'center', 
                              justify: 'center', 
                              fontWeight: 800, 
                              fontSize: '0.8rem', 
                              flexShrink: 0,
                              boxShadow: '0 2px 4px rgba(16, 185, 129, 0.2)',
                              border: '1px solid #e2e8f0'
                            }}>
                              {emp.profile_photo ? (
                                <img src={emp.profile_photo} alt={emp.nombre} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : (
                                emp.nombre.charAt(0).toUpperCase()
                              )}
                            </div>
                            <div>
                              <div style={{ color: '#09090b', whiteSpace: 'nowrap', fontSize: '0.85rem', fontWeight: 800 }}>{emp.nombre.split(' ')[0]} {emp.nombre.split(' ')[1] || ''}</div>
                              <div className="no-print" style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>{emp.rol || emp.posicion || emp.role_name || 'Personal'}</div>
                            </div>
                          </div>
                        </td>

                        {/* Week Days Columns */}
                        {['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map(day => {
                          const sched = getScheduleForDay(emp, day);
                          const styles = getShiftBadgeStyles(sched);
                          return (
                            <td key={day} style={{ padding: '0.75rem 0.4rem', textAlign: 'center' }}>
                              <div className="weekly-badge" style={{
                                display: 'inline-block',
                                padding: '0.3rem 0.55rem',
                                borderRadius: '8px',
                                background: styles.bg,
                                color: styles.color,
                                fontWeight: styles.fontWeight,
                                fontSize: '0.72rem',
                                border: styles.border,
                                whiteSpace: 'nowrap',
                                boxShadow: sched ? '0 1px 3px rgba(0,0,0,0.01)' : 'none',
                                transition: 'all 0.15s ease'
                              }}>
                                {styles.label}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}

                  {/* Empty state */}
                  {weeklyFilteredEmployees.length === 0 && (
                    <tr>
                      <td colSpan="8" style={{ textAlign: 'center', padding: '4rem 0', color: '#94a3b8', fontWeight: 600 }}>
                        No se encontraron empleados para los filtros seleccionados.
                      </td>
                    </tr>
                  )}
                </tbody>

                {/* Summary Row for count of active staff per day */}
                {weeklyFilteredEmployees.length > 0 && (
                  <tfoot>
                    <tr style={{ background: '#f8fafc', borderTop: '2px solid #cbd5e1', fontWeight: 800, color: '#09090b' }}>
                      <td style={{ padding: '1rem 1.25rem', color: '#475569' }}>
                        <div style={{ fontWeight: 800, fontSize: '0.85rem', color: '#09090b' }}>Total Activos</div>
                        <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 500 }}>
                          {positionFilter ? `Posición: ${positionFilter}` : 'Todo el personal'}
                        </div>
                      </td>
                      {['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map(day => {
                        const count = weeklyFilteredEmployees.filter(emp => getScheduleForDay(emp, day) !== null).length;
                        const styles = getCountBadgeStyles(count);
                        return (
                          <td key={day} style={{ padding: '1rem 0.4rem', textAlign: 'center' }}>
                            <div className="weekly-count-badge" style={{
                              display: 'inline-block',
                              padding: '0.35rem 0.75rem',
                              borderRadius: '99px',
                              background: styles.bg,
                              color: styles.color,
                              fontWeight: 900,
                              fontSize: '0.78rem',
                              border: styles.border,
                              boxShadow: '0 1px 3px rgba(0,0,0,0.01)'
                            }}>
                              {styles.label}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      </div>
    )}

      {activeTab === 'history' && (
        <>
          {/* Filters Box */}
          <div style={{ background: 'white', border: '1px solid #e2e8f0', padding: '1.5rem', borderRadius: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem', marginBottom: '2.5rem', boxShadow: '0 4px 10px rgba(0,0,0,0.01)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Fecha Inicio</label>
              <input
                type="date"
                name="startDate"
                value={filters.startDate}
                onChange={handleFilterChange}
                style={{ padding: '0.6rem 1rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Fecha Fin</label>
              <input
                type="date"
                name="endDate"
                value={filters.endDate}
                onChange={handleFilterChange}
                style={{ padding: '0.6rem 1rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Empleado</label>
              <select
                name="employeeId"
                value={filters.employeeId}
                onChange={handleFilterChange}
                style={{ padding: '0.6rem 1rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem', background: 'white', cursor: 'pointer' }}
              >
                <option value="">Todos los empleados</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.nombre}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Localidad</label>
              <select
                name="salonId"
                value={filters.salonId}
                onChange={handleFilterChange}
                style={{ padding: '0.6rem 1rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem', background: 'white', cursor: 'pointer' }}
              >
                <option value="">Todas las localidades</option>
                {salons.map(sal => (
                  <option key={sal.id} value={sal.id}>{sal.name.replace('Abatte Peluquería ', '')}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Tipo de Registro</label>
              <select
                name="type"
                value={filters.type}
                onChange={handleFilterChange}
                style={{ padding: '0.6rem 1rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem', background: 'white', cursor: 'pointer' }}
              >
                <option value="">Todos</option>
                <option value="Check-In">Entrada</option>
                <option value="Check-Out">Salida</option>
                <option value="Ausencia">Ausencia</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Estatus</label>
              <select
                name="status"
                value={filters.status}
                onChange={handleFilterChange}
                style={{ padding: '0.6rem 1rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem', background: 'white', cursor: 'pointer' }}
              >
                <option value="">Todos</option>
                <option value="Normal">Normal</option>
                <option value="Tardanza">Tardanza</option>
                <option value="Ausente">Ausente</option>
                <option value="Salida Temprana">Salida Temprana</option>
              </select>
            </div>
          </div>

          {/* Logs Table / Cards Grid */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: '4rem 0' }}>
              <RefreshCw size={32} style={{ animation: 'spin 1.5s linear infinite', color: '#10b981', margin: '0 auto 1rem' }} />
              <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Cargando registros de asistencia...</p>
            </div>
          ) : logs.length === 0 ? (
            <div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '20px', padding: '6rem 2rem', textAlign: 'center' }}>
              <Clock size={40} color="#94a3b8" style={{ margin: '0 auto 1.5rem' }} />
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: '#475569' }}>No se encontraron ponches</h3>
              <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0.25rem 0 0 0' }}>Prueba modificando los filtros de fecha o seleccionando otro empleado.</p>
            </div>
          ) : (
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '20px', overflow: 'hidden', boxShadow: '0 4px 15px rgba(0,0,0,0.02)' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 800 }}>
                      <th style={{ padding: '1.25rem 1.5rem' }}>Empleado</th>
                      <th style={{ padding: '1.25rem 1.5rem' }}>Localidad</th>
                      <th style={{ padding: '1.25rem 1.5rem' }}>Fecha y Hora</th>
                      <th style={{ padding: '1.25rem 1.5rem' }}>Horario Asignado</th>
                      <th style={{ padding: '1.25rem 1.5rem' }}>Tipo</th>
                      <th style={{ padding: '1.25rem 1.5rem' }}>Estatus</th>
                      <th style={{ padding: '1.25rem 1.5rem' }}>Foto de Validación</th>
                      <th style={{ padding: '1.25rem 1.5rem' }}>Ubicación (GPS)</th>
                      <th style={{ padding: '1.25rem 1.5rem' }}>Dispositivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentLogs.map(log => {
                      return (
                        <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s ease' }} className="hover-row">
                          {/* Employee Info */}
                          <td style={{ padding: '1rem 1.5rem', fontWeight: 700 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#f1f5f9', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.8rem' }}>
                                {log.employeeName?.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div style={{ color: '#09090b' }}>{log.employeeName}</div>
                                <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 500 }}>ID: {log.employee_id}</div>
                              </div>
                            </div>
                          </td>

                          {/* Localidad */}
                          <td style={{ padding: '1rem 1.5rem', fontWeight: 650, color: '#475569' }}>
                            {log.salonName?.replace('Abatte Peluquería ', '') || 'Oficina / General'}
                          </td>
      
                          {/* Time */}
                          <td style={{ padding: '1rem 1.5rem' }}>
                            <div style={{ fontWeight: 700, color: '#09090b' }}>{formatDRTime(log.timestamp)}</div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>{formatDRDate(log.timestamp)}</div>
                          </td>
      
                          {/* Horario Asignado */}
                          <td style={{ padding: '1rem 1.5rem', color: '#09090b', fontWeight: 650 }}>
                            {log.hora_entrada && log.hora_salida ? (
                              <div>
                                <div>{format12h(log.hora_entrada)} - {format12h(log.hora_salida)}</div>
                                <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 500 }}>Tolerancia: {log.tolerancia_minutos}m</div>
                              </div>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>Sin horario</span>
                            )}
                          </td>
      
                          {/* Type Pill */}
                          <td style={{ padding: '1rem 1.5rem' }}>
                            <span style={{
                              padding: '0.35rem 0.75rem',
                              borderRadius: '99px',
                              fontSize: '0.75rem',
                              fontWeight: 800,
                              background: log.type === 'Check-In' ? '#f0fdf4' : (log.type === 'Ausencia' ? '#fef2f2' : '#fff7ed'),
                              color: log.type === 'Check-In' ? '#15803d' : (log.type === 'Ausencia' ? '#991b1b' : '#c2410c'),
                              border: log.type === 'Check-In' ? '1px solid #bbf7d0' : (log.type === 'Ausencia' ? '1px solid #fecaca' : '1px solid #ffedd5')
                            }}>
                              {log.type === 'Check-In' ? 'Entrada' : (log.type === 'Ausencia' ? 'Ausencia' : 'Salida')}
                            </span>
                          </td>
      
                          {/* Estatus Pill */}
                          <td style={{ padding: '1rem 1.5rem' }}>
                            {(() => {
                              let checkInExtraMinutes = 0;
                              if (log.type === 'Check-In' && log.hora_entrada) {
                                try {
                                  const [entH, entM] = log.hora_entrada.split(':').map(Number);
                                  const checkInDate = new Date(log.timestamp);
                                  const checkInDRStr = checkInDate.toLocaleString('en-US', { timeZone: 'America/Santo_Domingo' });
                                  const checkInDR = new Date(checkInDRStr);
                                  
                                  const scheduledEntryDR = new Date(checkInDRStr);
                                  scheduledEntryDR.setHours(entH, entM, 0, 0);

                                  const diffMs = scheduledEntryDR - checkInDR;
                                  const earlyMinutes = diffMs / (1000 * 60);
                                  const grace = log.tolerancia_minutos !== null && log.tolerancia_minutos !== undefined ? log.tolerancia_minutos : 15;

                                  if (earlyMinutes > grace) {
                                    checkInExtraMinutes = Math.floor(earlyMinutes);
                                  }
                                } catch (err) {
                                  console.error("Error calculating check-in extra minutes:", err);
                                }
                              }

                              const isTardy = log.status === 'Tardanza' || log.status === 'Ausente';
                              const isEarlyCheckout = log.status === 'Salida Temprana';

                              return (
                                <span style={{
                                  padding: '0.35rem 0.75rem',
                                  borderRadius: '99px',
                                  fontSize: '0.75rem',
                                  fontWeight: 800,
                                  background: isTardy ? '#fef2f2' : isEarlyCheckout ? '#fffbeb' : '#f0fdf4',
                                  color: isTardy ? '#b91c1c' : isEarlyCheckout ? '#b45309' : '#15803d',
                                  border: isTardy ? '1px solid #fee2e2' : isEarlyCheckout ? '1px solid #fef3c7' : '1px solid #bbf7d0'
                                }}>
                                  {log.status === 'Tardanza' && log.lateness_minutes > 0
                                    ? `Tardanza (+${log.lateness_minutes} min)`
                                    : (log.type === 'Check-In' && checkInExtraMinutes > 0
                                      ? `${log.status || 'Normal'} (+${checkInExtraMinutes}m Extra)`
                                      : (log.type === 'Check-Out' && log.extra_minutes > 0
                                        ? `${log.status || 'Normal'} (+${log.extra_minutes}m Extra)`
                                        : (log.status || 'Normal')))}
                                </span>
                              );
                            })()}
                          </td>
      
                          {/* Validation Photo preview */}
                          <td style={{ padding: '1rem 1.5rem' }}>
                            {log.photo ? (
                              <div 
                                onClick={() => setSelectedPhoto(log.photo)}
                                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: '#09090b', fontWeight: 650 }}
                              >
                                <div style={{ width: '42px', height: '42px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e2e8f0', background: '#f8fafc', flexShrink: 0 }}>
                                  <img src={log.photo} alt="Validación" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                </div>
                                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Ver foto</span>
                              </div>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>Sin foto</span>
                            )}
                          </td>
      
                          {/* GPS Geolocation */}
                          <td style={{ padding: '1rem 1.5rem' }}>
                            {log.geolocation ? (
                              <a 
                                href={`https://www.google.com/maps/search/?api=1&query=${log.geolocation}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: '#2563eb', textDecoration: 'none', fontWeight: 700 }}
                              >
                                <MapPin size={15} />
                                <span>Mapa</span>
                              </a>
                            ) : (
                              <span style={{ color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                                <MapPin size={14} />
                                Sin GPS
                              </span>
                            )}
                          </td>
      
                          {/* Device Agent */}
                          <td style={{ padding: '1rem 1.5rem', color: '#64748b', fontSize: '0.75rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <Smartphone size={14} />
                              <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={log.device_info || ''}>
                                {log.device_info || 'N/A'}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination controls */}
              {totalPages > 1 && (
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '1rem 1.5rem',
                  borderTop: '1px solid #f1f5f9',
                  background: '#f8fafc',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  color: '#475569'
                }}>
                  <div>
                    Mostrando <span style={{ color: '#09090b' }}>{indexOfFirstLog + 1}</span> - <span style={{ color: '#09090b' }}>{Math.min(indexOfLastLog, logs.length)}</span> de <span style={{ color: '#09090b' }}>{logs.length}</span> registros
                  </div>
                  
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button
                      onClick={() => setHistoryPage(prev => Math.max(prev - 1, 1))}
                      disabled={historyPage === 1}
                      style={{
                        padding: '0.4rem 0.8rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: 'white',
                        color: historyPage === 1 ? '#cbd5e1' : '#475569',
                        cursor: historyPage === 1 ? 'not-allowed' : 'pointer',
                        fontWeight: 750,
                        fontSize: '0.75rem',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      Anterior
                    </button>
                    
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => {
                      if (totalPages > 5 && Math.abs(pageNum - historyPage) > 1 && pageNum !== 1 && pageNum !== totalPages) {
                        if (pageNum === 2 || pageNum === totalPages - 1) {
                          return <span key={pageNum} style={{ padding: '0.4rem 0.2rem', color: '#94a3b8' }}>...</span>;
                        }
                        return null;
                      }
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setHistoryPage(pageNum)}
                          style={{
                            minWidth: '28px',
                            height: '28px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '6px',
                            border: pageNum === historyPage ? '1px solid #10b981' : '1px solid #cbd5e1',
                            background: pageNum === historyPage ? '#10b981' : 'white',
                            color: pageNum === historyPage ? 'white' : '#475569',
                            cursor: 'pointer',
                            fontWeight: 800,
                            fontSize: '0.75rem',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                    
                    <button
                      onClick={() => setHistoryPage(prev => Math.min(prev + 1, totalPages))}
                      disabled={historyPage === totalPages}
                      style={{
                        padding: '0.4rem 0.8rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: 'white',
                        color: historyPage === totalPages ? '#cbd5e1' : '#475569',
                        cursor: historyPage === totalPages ? 'not-allowed' : 'pointer',
                        fontWeight: 750,
                        fontSize: '0.75rem',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {activeTab === 'overrides' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Overrides Header Actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <span style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 650 }}>
              Bitácora de autorizaciones de cambios temporales de horario
            </span>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Localidad:</span>
                <select
                  name="salonId"
                  value={filters.salonId}
                  onChange={handleFilterChange}
                  style={{ padding: '0.5rem 1rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem', background: 'white', cursor: 'pointer', fontWeight: 700, color: '#09090b', minWidth: '180px' }}
                >
                  <option value="">Todas las localidades</option>
                  {salons.map(sal => (
                    <option key={sal.id} value={sal.id}>{sal.name.replace('Abatte Peluquería ', '')}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => setIsOverrideModalOpen(true)}
                style={{
                  background: '#10b981',
                  color: 'white',
                  border: 'none',
                  padding: '0.6rem 1.25rem',
                  borderRadius: '10px',
                  fontSize: '0.85rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(16,185,129,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontFamily: '"Plus Jakarta Sans", sans-serif'
                }}
              >
                <Clock size={16} />
                Autorizar Cambio Temporal
              </button>
            </div>
          </div>

          {/* Overrides Audit Table */}
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 4px 10px rgba(0,0,0,0.01)' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '1rem 1.5rem', color: '#64748b', fontWeight: 800 }}>Empleado</th>
                    <th style={{ padding: '1rem 1.5rem', color: '#64748b', fontWeight: 800 }}>Fecha Afectada</th>
                    <th style={{ padding: '1rem 1.5rem', color: '#64748b', fontWeight: 800 }}>Horario Original</th>
                    <th style={{ padding: '1rem 1.5rem', color: '#64748b', fontWeight: 800 }}>Nuevo Horario Temporal</th>
                    <th style={{ padding: '1rem 1.5rem', color: '#64748b', fontWeight: 800 }}>Motivo</th>
                    <th style={{ padding: '1rem 1.5rem', color: '#64748b', fontWeight: 800 }}>Autorizado Por</th>
                    <th style={{ padding: '1rem 1.5rem', color: '#64748b', fontWeight: 800 }}>Fecha Registro</th>
                    <th style={{ padding: '1rem 1.5rem', color: '#64748b', fontWeight: 800, textAlign: 'center' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const filteredOverrides = filters.salonId
                      ? overridesList.filter(o => {
                          const emp = employees.find(e => String(e.id) === String(o.employee_id));
                          return emp && String(emp.salon_id) === String(filters.salonId);
                        })
                      : overridesList;

                    return (
                      <>
                        {filteredOverrides.map((o) => (
                          <tr key={o.id} className="hover-row" style={{ borderBottom: '1px solid #f1f5f9', opacity: o.status === 'Anulado' ? 0.6 : 1 }}>
                            <td style={{ padding: '1rem 1.5rem', fontWeight: 800, color: '#09090b' }}>
                              {o.employeeName}
                              <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 500 }}>ID: {o.employee_id}</div>
                            </td>
                            <td style={{ padding: '1rem 1.5rem', fontWeight: 700, color: '#475569' }}>
                              {new Date(o.date).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}
                            </td>
                            <td style={{ padding: '1rem 1.5rem', color: '#64748b', fontWeight: 600 }}>
                              {o.original_hora_entrada && o.original_hora_salida ? (
                                `${format12h(o.original_hora_entrada)} - ${format12h(o.original_hora_salida)}`
                              ) : (
                                <span style={{ color: '#94a3b8' }}>Sin horario base</span>
                              )}
                            </td>
                            <td style={{ padding: '1rem 1.5rem', color: o.status === 'Anulado' ? '#94a3b8' : '#10b981', fontWeight: 800, textDecoration: o.status === 'Anulado' ? 'line-through' : 'none' }}>
                              {format12h(o.new_hora_entrada)} - {format12h(o.new_hora_salida)}
                            </td>
                            <td style={{ padding: '1rem 1.5rem', color: '#09090b', fontWeight: 650 }}>
                              {o.reason}
                            </td>
                            <td style={{ padding: '1rem 1.5rem', color: '#475569', fontWeight: 800 }}>
                              👤 {o.created_by}
                            </td>
                            <td style={{ padding: '1rem 1.5rem', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 550 }}>
                              {new Date(o.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td style={{ padding: '1rem 1.5rem', textAlign: 'center' }}>
                              {o.status === 'Anulado' ? (
                                <span style={{
                                  background: '#f1f5f9',
                                  color: '#64748b',
                                  padding: '0.3rem 0.6rem',
                                  borderRadius: '6px',
                                  fontSize: '0.75rem',
                                  fontWeight: 800,
                                  border: '1px solid #cbd5e1',
                                  display: 'inline-block'
                                }}>
                                  Anulado
                                </span>
                              ) : (
                                (() => {
                                  const todayDRStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' });
                                  const d = new Date(o.date);
                                  const overrideDateStr = d.toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' });
                                  
                                  if (overrideDateStr < todayDRStr) {
                                    return (
                                      <span style={{
                                        background: '#e6f4ea',
                                        color: '#137333',
                                        padding: '0.3rem 0.6rem',
                                        borderRadius: '6px',
                                        fontSize: '0.75rem',
                                        fontWeight: 800,
                                        border: '1px solid #ceead6',
                                        display: 'inline-block'
                                      }}>
                                        Cumplido
                                      </span>
                                    );
                                  }
                                  
                                  return (
                                    <button
                                      onClick={() => handleDeleteOverride(o.id)}
                                      style={{
                                        background: '#ef4444',
                                        color: 'white',
                                        border: 'none',
                                        padding: '0.4rem 0.8rem',
                                        borderRadius: '8px',
                                        fontSize: '0.75rem',
                                        fontWeight: 800,
                                        cursor: 'pointer',
                                        boxShadow: '0 2px 4px rgba(239,68,68,0.2)',
                                        fontFamily: '"Plus Jakarta Sans", sans-serif',
                                        transition: 'all 0.15s ease'
                                      }}
                                      onMouseEnter={(e) => e.target.style.background = '#dc2626'}
                                      onMouseLeave={(e) => e.target.style.background = '#ef4444'}
                                    >
                                      Anular
                                    </button>
                                  );
                                })()
                              )}
                            </td>
                          </tr>
                        ))}
                        {filteredOverrides.length === 0 && (
                          <tr>
                            <td colSpan="8" style={{ textAlign: 'center', padding: '3rem 0', color: '#94a3b8', fontWeight: 600 }}>
                              No se han registrado cambios de horario temporales para esta sucursal.
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'payroll' && (() => {
        // 1. Gather all payroll metrics dynamically per employee in range
        const computedPayroll = employees.map(emp => {
          const empLogs = logs.filter(log => String(log.employee_id) === String(emp.id));
          
          // Días Laborados
          const presentDates = new Set(
            empLogs
              .filter(log => log.type !== 'Ausencia')
              .map(log => new Date(log.timestamp).toISOString().split('T')[0])
          );
          const daysWorked = presentDates.size;

          // Tardanza Total (minutos)
          const totalLateness = empLogs
            .filter(log => log.type === 'Check-In' && log.status === 'Tardanza')
            .reduce((sum, log) => sum + (log.lateness_minutes || 0), 0);

          // Horas Extra Totales (minutos)
          const totalOvertime = empLogs
            .filter(log => log.type === 'Check-Out')
            .reduce((sum, log) => sum + (log.extra_minutes || 0), 0);

          // Ausencias (solo contar fechas donde el empleado no haya laborado)
          const absentDates = new Set(
            empLogs
              .filter(log => log.type === 'Ausencia')
              .map(log => new Date(log.timestamp).toISOString().split('T')[0])
          );
          const absencesCount = [...absentDates].filter(d => !presentDates.has(d)).length;


          // Tasa Puntualidad
          const totalCheckins = empLogs.filter(log => log.type === 'Check-In').length;
          const tardyCheckins = empLogs.filter(log => log.type === 'Check-In' && log.status === 'Tardanza').length;
          const punctualCheckins = totalCheckins - tardyCheckins;
          const punctualityRate = totalCheckins > 0 
            ? Math.round((punctualCheckins / totalCheckins) * 100) 
            : 100;

          return {
            ...emp,
            daysWorked,
            totalLateness,
            totalOvertime,
            absencesCount,
            punctualityRate
          };
        });

        // 2. Filter list based on search term, filters, and parent search filters
        const filteredPayroll = computedPayroll.filter(p => {
          // Parent employee filter integration
          if (filters.employeeId && String(p.id) !== String(filters.employeeId)) return false;
          // Local name text search
          if (payrollSearch && !p.nombre.toLowerCase().includes(payrollSearch.toLowerCase())) return false;
          // Local status filters
          if (payrollFilter === 'tardy' && p.totalLateness === 0) return false;
          if (payrollFilter === 'overtime' && p.totalOvertime === 0) return false;
          if (payrollFilter === 'absent' && p.absencesCount === 0) return false;
          
          // Localidad filter integration
          if (filters.salonId && String(p.salon_id) !== String(filters.salonId)) return false;
          
          return true;
        });

        // 3. Paginate
        const itemsPerPage = 8;
        const totalPages = Math.ceil(filteredPayroll.length / itemsPerPage) || 1;
        const currentPagePayroll = Math.min(payrollPage, totalPages);
        const paginatedPayroll = filteredPayroll.slice(
          (currentPagePayroll - 1) * itemsPerPage,
          currentPagePayroll * itemsPerPage
        );

        // Helper to format minutes
        const formatMins = (mins) => {
          if (!mins) return '0m';
          const hrs = Math.floor(mins / 60);
          const remaining = mins % 60;
          if (hrs > 0) {
            return `${hrs}h ${remaining}m`;
          }
          return `${mins}m`;
        };

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            
            {/* Payroll Sub-Header Filter Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap', background: '#f8fafc', padding: '1rem', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', gap: '1rem', flex: 1, flexWrap: 'wrap' }}>
                
                {/* Search Bar */}
                <div style={{ position: 'relative', minWidth: '220px', flex: 1 }}>
                  <Search size={15} color="#94a3b8" style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)' }} />
                  <input
                    type="text"
                    placeholder="Buscar empleado por nombre..."
                    value={payrollSearch}
                    onChange={(e) => { setPayrollSearch(e.target.value); setPayrollPage(1); }}
                    style={{ padding: '0.6rem 1rem 0.6rem 2.4rem', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.85rem', outline: 'none', background: 'white', width: '100%' }}
                  />
                </div>

                {/* Localidad Filter */}
                <div style={{ minWidth: '180px' }}>
                  <select
                    name="salonId"
                    value={filters.salonId}
                    onChange={(e) => { handleFilterChange(e); setPayrollPage(1); }}
                    style={{ padding: '0.6rem 1rem', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.85rem', outline: 'none', background: 'white', width: '100%', cursor: 'pointer', fontWeight: 650, color: '#334155' }}
                  >
                    <option value="">Todas las localidades</option>
                    {salons.map(sal => (
                      <option key={sal.id} value={sal.id}>{sal.name.replace('Abatte Peluquería ', '')}</option>
                    ))}
                  </select>
                </div>

                {/* Filter Selector */}
                <div style={{ minWidth: '180px' }}>
                  <select
                    value={payrollFilter}
                    onChange={(e) => { setPayrollFilter(e.target.value); setPayrollPage(1); }}
                    style={{ padding: '0.6rem 1rem', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.85rem', outline: 'none', background: 'white', width: '100%', cursor: 'pointer', fontWeight: 650, color: '#334155' }}
                  >
                    <option value="all">Ver Todos los Empleados</option>
                    <option value="tardy">⚠️ Solo con Tardanzas</option>
                    <option value="overtime">🚀 Solo con Horas Extras</option>
                    <option value="absent">🛑 Solo con Ausencias</option>
                  </select>
                </div>

              </div>

              {/* PDF Print Button */}
              <button
                onClick={handlePrintPayroll}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.6rem 1.25rem',
                  borderRadius: '10px',
                  fontSize: '0.85rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  background: 'white',
                  border: '1px solid #cbd5e1',
                  fontFamily: '"Plus Jakarta Sans", sans-serif'
                }}
              >
                📥 Imprimir / Guardar PDF
              </button>
            </div>

            {/* Summary Table */}
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 4px 10px rgba(0,0,0,0.01)' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '1rem 1.5rem', color: '#64748b', fontWeight: 800 }}>Empleado</th>
                      <th style={{ padding: '1rem 1.5rem', color: '#64748b', fontWeight: 800, textAlign: 'center' }}>Días Laborados</th>
                      <th style={{ padding: '1rem 1.5rem', color: '#64748b', fontWeight: 800, textAlign: 'center' }}>Tardanza Total</th>
                      <th style={{ padding: '1rem 1.5rem', color: '#64748b', fontWeight: 800, textAlign: 'center' }}>Horas Extra Totales</th>
                      <th style={{ padding: '1rem 1.5rem', color: '#64748b', fontWeight: 800, textAlign: 'center' }}>Ausencias / Faltas</th>
                      <th style={{ padding: '1rem 1.5rem', color: '#64748b', fontWeight: 800, textAlign: 'center' }}>Tasa Puntualidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedPayroll.map(p => (
                      <tr key={p.id} className="hover-row" style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '1rem 1.5rem', fontWeight: 800, color: '#09090b' }}>
                          {p.nombre}
                          <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 500 }}>ID: {p.id}</div>
                        </td>
                        <td style={{ padding: '1rem 1.5rem', textAlign: 'center', fontWeight: 700, color: '#475569' }}>
                          {p.daysWorked} días
                        </td>
                        <td style={{ padding: '1rem 1.5rem', textAlign: 'center', fontWeight: 700, color: p.totalLateness > 0 ? '#b91c1c' : '#64748b' }}>
                          {p.totalLateness > 0 ? `⚠️ ${formatMins(p.totalLateness)}` : '0 min'}
                        </td>
                        <td style={{ padding: '1rem 1.5rem', textAlign: 'center', fontWeight: 800, color: p.totalOvertime > 0 ? '#16a34a' : '#64748b' }}>
                          {p.totalOvertime > 0 ? `🚀 ${formatMins(p.totalOvertime)}` : '0 min'}
                        </td>
                        <td style={{ padding: '1rem 1.5rem', textAlign: 'center', fontWeight: 700, color: p.absencesCount > 0 ? '#b91c1c' : '#64748b' }}>
                          <span style={p.absencesCount > 0 ? { background: '#fef2f2', color: '#ef4444', padding: '0.25rem 0.5rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 800 } : {}}>
                            {p.absencesCount}
                          </span>
                        </td>
                        <td style={{ padding: '1rem 1.5rem', textAlign: 'center' }}>
                          <span style={{
                            padding: '0.25rem 0.6rem',
                            borderRadius: '99px',
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            background: p.punctualityRate >= 90 ? '#dcfce7' : (p.punctualityRate >= 75 ? '#fef3c7' : '#fee2e2'),
                            color: p.punctualityRate >= 90 ? '#15803d' : (p.punctualityRate >= 75 ? '#b45309' : '#b91c1c')
                          }}>
                            {p.punctualityRate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                    {filteredPayroll.length === 0 && (
                      <tr>
                        <td colSpan="6" style={{ textAlign: 'center', padding: '3rem 0', color: '#94a3b8', fontWeight: 600 }}>
                          No se encontraron empleados que coincidan con los filtros.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination Controls */}
            {filteredPayroll.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginTop: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => setPayrollPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPagePayroll === 1}
                    style={{
                      padding: '0.5rem 0.85rem',
                      background: 'white',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      color: '#64748b',
                      opacity: currentPagePayroll === 1 ? 0.5 : 1
                    }}
                  >
                    Anterior
                  </button>
                  <button
                    style={{
                      padding: '0.5rem 1rem',
                      background: '#09090b',
                      border: 'none',
                      color: 'white',
                      borderRadius: '8px',
                      fontSize: '0.8rem',
                      fontWeight: 800
                    }}
                  >
                    {currentPagePayroll} / {totalPages}
                  </button>
                  <button
                    onClick={() => setPayrollPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPagePayroll === totalPages}
                    style={{
                      padding: '0.5rem 0.85rem',
                      background: 'white',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      color: '#64748b',
                      opacity: currentPagePayroll === totalPages ? 0.5 : 1
                    }}
                  >
                    Siguiente
                  </button>
                </div>
                <div style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 650 }}>
                  Mostrando {(currentPagePayroll - 1) * itemsPerPage + 1} - {Math.min(currentPagePayroll * itemsPerPage, filteredPayroll.length)} de {filteredPayroll.length} empleados
                </div>
              </div>
            )}

          </div>
        );
      })()}

      {/* Modal - Authorize Temporary Schedule Override */}
      {isOverrideModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(9, 9, 11, 0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: 'white', borderRadius: '24px', width: '90%', maxWidth: '480px', border: '1px solid #e2e8f0', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
            
            {/* Modal Header */}
            <div style={{ padding: '1.25rem 1.75rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900, color: '#09090b', letterSpacing: '-0.3px' }}>Autorizar Cambio Temporal</h3>
              <button
                onClick={() => setIsOverrideModalOpen(false)}
                style={{ border: 'none', background: 'transparent', fontSize: '1.2rem', cursor: 'pointer', color: '#94a3b8', fontWeight: 700 }}
              >
                ✕
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSaveOverride} style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              
              {/* Mode Toggle (Pills) */}
              <div style={{ display: 'flex', background: '#f4f4f5', padding: '3px', borderRadius: '12px', border: '1px solid #e4e4e7', marginBottom: '0.25rem' }}>
                <button
                  type="button"
                  onClick={() => setOverrideMode('individual')}
                  style={{
                    flex: 1, padding: '0.5rem', borderRadius: '9px', border: 'none',
                    background: overrideMode === 'individual' ? 'white' : 'transparent',
                    color: overrideMode === 'individual' ? '#09090b' : '#71717a',
                    fontWeight: overrideMode === 'individual' ? 800 : 600,
                    fontSize: '0.78rem', cursor: 'pointer', transition: 'all 0.15s ease',
                    boxShadow: overrideMode === 'individual' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                  }}
                >
                  Cambio Individual
                </button>
                <button
                  type="button"
                  onClick={() => setOverrideMode('swap')}
                  style={{
                    flex: 1, padding: '0.5rem', borderRadius: '9px', border: 'none',
                    background: overrideMode === 'swap' ? 'white' : 'transparent',
                    color: overrideMode === 'swap' ? '#09090b' : '#71717a',
                    fontWeight: overrideMode === 'swap' ? 800 : 600,
                    fontSize: '0.78rem', cursor: 'pointer', transition: 'all 0.15s ease',
                    boxShadow: overrideMode === 'swap' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                  }}
                >
                  🔁 Intercambiar Turno (Swap)
                </button>
              </div>

              {overrideMode === 'individual' ? (
                // Individual Form Mode
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.72rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Empleado</label>
                    <select
                      required
                      value={newOverrideForm.employeeId}
                      onChange={(e) => setNewOverrideForm(prev => ({ ...prev, employeeId: e.target.value }))}
                      style={{ padding: '0.65rem 1rem', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.88rem', outline: 'none', background: 'white', cursor: 'pointer' }}
                    >
                      <option value="">Selecciona al empleado...</option>
                      {employees.map(emp => (
                        <option key={emp.id} value={emp.id}>{emp.nombre}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.72rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Fecha de Aplicación</label>
                    <input
                      type="date"
                      required
                      value={newOverrideForm.date}
                      onChange={(e) => setNewOverrideForm(prev => ({ ...prev, date: e.target.value }))}
                      style={{ padding: '0.65rem 1rem', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.88rem', outline: 'none' }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      <label style={{ fontSize: '0.72rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Nueva Entrada</label>
                      <input
                        type="time"
                        required
                        value={newOverrideForm.newHoraEntrada}
                        onChange={(e) => setNewOverrideForm(prev => ({ ...prev, newHoraEntrada: e.target.value }))}
                        style={{ padding: '0.65rem 1rem', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.88rem', outline: 'none' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      <label style={{ fontSize: '0.72rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Nueva Salida</label>
                      <input
                        type="time"
                        required
                        value={newOverrideForm.newHoraSalida}
                        onChange={(e) => setNewOverrideForm(prev => ({ ...prev, newHoraSalida: e.target.value }))}
                        style={{ padding: '0.65rem 1rem', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.88rem', outline: 'none' }}
                      />
                    </div>
                  </div>
                </>
              ) : (
                // Swap Form Mode
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.72rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Empleado A</label>
                    <select
                      required
                      value={newOverrideForm.employeeId}
                      onChange={(e) => setNewOverrideForm(prev => ({ ...prev, employeeId: e.target.value }))}
                      style={{ padding: '0.65rem 1rem', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.88rem', outline: 'none', background: 'white', cursor: 'pointer' }}
                    >
                      <option value="">Selecciona empleado A...</option>
                      {employees.map(emp => (
                        <option key={emp.id} value={emp.id}>{emp.nombre}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.72rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Empleado B (Intercambia con A)</label>
                    <select
                      required
                      value={newOverrideForm.employeeId2}
                      onChange={(e) => setNewOverrideForm(prev => ({ ...prev, employeeId2: e.target.value }))}
                      style={{ padding: '0.65rem 1rem', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.88rem', outline: 'none', background: 'white', cursor: 'pointer' }}
                    >
                      <option value="">Selecciona empleado B...</option>
                      {employees.filter(emp => emp.id !== newOverrideForm.employeeId).map(emp => (
                        <option key={emp.id} value={emp.id}>{emp.nombre}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.72rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Fecha del Intercambio</label>
                    <input
                      type="date"
                      required
                      value={newOverrideForm.date}
                      onChange={(e) => setNewOverrideForm(prev => ({ ...prev, date: e.target.value }))}
                      style={{ padding: '0.65rem 1rem', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.88rem', outline: 'none' }}
                    />
                  </div>
                </>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <label style={{ fontSize: '0.72rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Motivo / Justificación</label>
                <input
                  type="text"
                  required
                  placeholder={overrideMode === 'swap' ? "Ej: Cambio de turno voluntario por viaje" : "Ej: Cita de salud o permiso especial"}
                  value={newOverrideForm.reason}
                  onChange={(e) => setNewOverrideForm(prev => ({ ...prev, reason: e.target.value }))}
                  style={{ padding: '0.65rem 1rem', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.88rem', outline: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => setIsOverrideModalOpen(false)}
                  style={{ flex: 1, height: '48px', border: '1px solid #cbd5e1', background: 'white', color: '#64748b', borderRadius: '50px', fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer', fontFamily: '"Plus Jakarta Sans", sans-serif' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  style={{ flex: 2, height: '48px', border: 'none', background: '#10b981', color: 'white', borderRadius: '50px', fontWeight: 800, fontSize: '0.9rem', cursor: 'pointer', boxShadow: '0 4px 10px rgba(16,185,129,0.2)', fontFamily: '"Plus Jakarta Sans", sans-serif' }}
                >
                  {loading ? 'Guardando...' : (overrideMode === 'swap' ? 'Confirmar Intercambio' : 'Confirmar Autorización')}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* Full Photo Modal overlay */}
      {selectedPhoto && (
        <div 
          onClick={() => setSelectedPhoto(null)}
          style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(9, 9, 11, 0.75)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, cursor: 'zoom-out' }}
        >
          <div style={{ position: 'relative', maxWidth: '400px', width: '90%', background: 'white', borderRadius: '24px', overflow: 'hidden', border: '1px solid #e2e8f0', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>Foto de Validación Biométrica</span>
              <button 
                onClick={() => setSelectedPhoto(null)}
                style={{ border: 'none', background: 'transparent', fontSize: '1.1rem', fontWeight: 800, cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: '1.5rem', background: '#f8fafc', textAlign: 'center' }}>
              <img src={selectedPhoto} alt="Validación completa" style={{ width: '100%', height: '300px', objectFit: 'contain', borderRadius: '12px', background: 'white', border: '1px solid #e2e8f0' }} />
            </div>
          </div>
        </div>
      )}

      {/* Adjust Pending Modal */}
      {isAdjustModalOpen && selectedPendingRecord && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999,
          padding: '1rem',
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            background: 'white',
            borderRadius: '20px',
            padding: '2rem',
            width: '100%',
            maxWidth: '500px',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
            position: 'relative'
          }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 900, margin: '0 0 0.5rem 0', color: '#09090b' }}>Regularizar Ponches Omitidos</h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 1.5rem 0' }}>
              Ajuste manual para <strong>{selectedPendingRecord.employeeName}</strong> el <strong>{formatDRDate(selectedPendingRecord.date)}</strong>
            </p>

            <form onSubmit={handleSaveAdjustment} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              
              {/* Check-In input */}
              {(selectedPendingRecord.incidentType === 'missing_all' || selectedPendingRecord.incidentType === 'missing_checkin') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Hora de Entrada (Check-In)</label>
                  <input
                    type="time"
                    value={adjustForm.checkInTime}
                    onChange={(e) => setAdjustForm(prev => ({ ...prev, checkInTime: e.target.value }))}
                    required
                    style={{ padding: '0.6rem 1rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.9rem' }}
                  />
                </div>
              )}

              {/* Check-Out input */}
              {(selectedPendingRecord.incidentType === 'missing_all' || selectedPendingRecord.incidentType === 'missing_checkout') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Hora de Salida (Check-Out)</label>
                  <input
                    type="time"
                    value={adjustForm.checkOutTime}
                    onChange={(e) => setAdjustForm(prev => ({ ...prev, checkOutTime: e.target.value }))}
                    required
                    style={{ padding: '0.6rem 1rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.9rem' }}
                  />
                </div>
              )}

              {/* Reason description */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>Motivo de la Regularización (Auditoría)</label>
                <textarea
                  placeholder="Ej. Olvidó ponchar salida al retirarse"
                  value={adjustForm.reason}
                  onChange={(e) => setAdjustForm(prev => ({ ...prev, reason: e.target.value }))}
                  required
                  rows={3}
                  style={{ padding: '0.6rem 1rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.85rem', fontFamily: 'inherit', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setIsAdjustModalOpen(false)}
                  disabled={loading}
                  style={{
                    background: '#f1f5f9',
                    color: '#475569',
                    border: 'none',
                    padding: '0.6rem 1.2rem',
                    borderRadius: '10px',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    background: '#10b981',
                    color: 'white',
                    border: 'none',
                    padding: '0.6rem 1.2rem',
                    borderRadius: '10px',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {loading ? 'Guardando...' : 'Aplicar Ajuste'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSS styling for hover rows and keyframes */}
      <style>{`
        .hover-row:hover {
          background: #f8fafc;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @media print {
          @page {
            size: landscape;
            margin: 8mm;
          }
          /* Reset heights and overflow to allow natural multi-page flow/pagination */
          html, body, #root, #root * {
            height: auto !important;
            overflow: visible !important;
          }
          body * {
            visibility: hidden;
          }
          #weekly-schedule-print-area, #weekly-schedule-print-area * {
            visibility: visible;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          #weekly-schedule-print-area {
            position: relative !important;
            width: 100% !important;
            max-width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .print-only {
            display: block !important;
          }
          .no-print {
            display: none !important;
          }
          /* Flat table look for clean print */
          #weekly-schedule-print-area table {
            width: 100% !important;
            table-layout: fixed !important;
            border-collapse: collapse !important;
            border: 2px solid #334155 !important;
            box-shadow: none !important;
            border-radius: 0 !important;
          }
          #weekly-schedule-print-area th, 
          #weekly-schedule-print-area td {
            border: 1px solid #cbd5e1 !important;
            padding: 0.3rem 0.15rem !important;
            font-size: 0.68rem !important;
            text-align: center !important;
            vertical-align: middle !important;
            border-radius: 0 !important;
          }
          #weekly-schedule-print-area th:first-child, 
          #weekly-schedule-print-area td:first-child {
            text-align: left !important;
            padding-left: 0.5rem !important;
            width: 16% !important; /* Fixed width for employee name */
          }
          #weekly-schedule-print-area th {
            background-color: #f1f5f9 !important;
            color: #0f172a !important;
            font-weight: 800 !important;
            width: 12% !important; /* Equal widths for all 7 days */
          }
          .weekly-badge {
            background: transparent !important;
            border: none !important;
            color: #000000 !important;
            font-weight: 700 !important;
            padding: 0 !important;
            box-shadow: none !important;
            display: block !important;
            text-align: center !important;
          }
          .weekly-count-badge {
            background: transparent !important;
            border: none !important;
            color: #000000 !important;
            font-weight: 850 !important;
            padding: 0 !important;
            box-shadow: none !important;
            display: block !important;
            text-align: center !important;
          }
        }
      `}</style>
    </div>
  );
};

export default AttendanceLogs;
