import React, { useState, useEffect } from 'react';
import { 
  UserPlus, Shield, CheckCircle2, XCircle, 
  Settings, Users, Key, Mail, UserCheck, Trash2, Edit2,
  Search, Building, TrendingUp, Scissors, Download, 
  List, Grid, LayoutTemplate, MapPin, Briefcase, Activity, 
  ChevronLeft, ChevronRight, Eye, Phone, User, Wallet, DollarSign
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useTranslation } from '../../context/LanguageContext';
import { useNavigate } from 'react-router-dom';

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

const RoleManagement = () => {
  const navigate = useNavigate();
  const [staff, setStaff] = useState([]);
  const [salons, setSalons] = useState([]);
  const [schemes, setSchemes] = useState([]);
  
  const [newStaff, setNewStaff] = useState({ 
    nombre: '', cedula: '', contacto: '', posicion: '', email: '',
    direccion: '', localidad: '', salon_id: '', commission_scheme_id: '', fecha_entrada: new Date().toISOString().split('T')[0],
    profile_photo: null, hora_entrada: '', hora_salida: '', dias_laborables: '', tolerancia_minutos: 15,
    tipo_salario: 'fijo_mas_comision', salario_base: 20000
  });
  const [editingStaff, setEditingStaff] = useState(null);
  const [staffSaving, setStaffSaving] = useState(false);
  const [selectedStaffDetail, setSelectedStaffDetail] = useState(null);

  const [scheduleMode, setScheduleMode] = useState('general'); // 'general' o 'daily'
  const [dailySchedules, setDailySchedules] = useState({
    Lunes: { active: false, entrada: '08:00', salida: '18:00' },
    Martes: { active: false, entrada: '08:00', salida: '18:00' },
    Miércoles: { active: false, entrada: '08:00', salida: '18:00' },
    Jueves: { active: false, entrada: '08:00', salida: '18:00' },
    Viernes: { active: false, entrada: '08:00', salida: '18:00' },
    Sábado: { active: false, entrada: '08:00', salida: '18:00' },
    Domingo: { active: false, entrada: '08:00', salida: '18:00' }
  });

  // RRHH UI States
  const [showStaffForm, setShowStaffForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState('lista'); // 'lista', 'agrupado', 'tabla'
  const itemsPerPage = 10;

  const loadData = async () => {
    try {
      const s = await dataService.getStaffRecords();
      const sal = await dataService.getSalons();
      const sch = await dataService.getCommissionSchemes();
      setStaff(s || []);
      setSalons(sal || []);
      setSchemes(sch || []);
    } catch (err) {
      console.error("Error loading management data:", err);
    }
  };

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterLocation, filterRole, filterStatus]);

  const handleSaveStaff = async (e) => {
    e.preventDefault();
    setStaffSaving(true);
    try {
      let processedStaff = { ...newStaff };
      if (scheduleMode === 'daily') {
        const scheduleJSON = {};
        let firstActiveDayEntrada = '';
        let firstActiveDaySalida = '';
        Object.keys(dailySchedules).forEach(day => {
          if (dailySchedules[day].active) {
            scheduleJSON[day] = {
              entrada: dailySchedules[day].entrada,
              salida: dailySchedules[day].salida
            };
            if (!firstActiveDayEntrada) {
              firstActiveDayEntrada = dailySchedules[day].entrada;
              firstActiveDaySalida = dailySchedules[day].salida;
            }
          }
        });
        processedStaff.dias_laborables = JSON.stringify(scheduleJSON);
        processedStaff.hora_entrada = firstActiveDayEntrada || '08:00';
        processedStaff.hora_salida = firstActiveDaySalida || '18:00';
      } else {
        const activeDays = Object.keys(dailySchedules).filter(day => dailySchedules[day].active);
        const sortedDays = daysOfWeek.filter(d => activeDays.includes(d));
        processedStaff.dias_laborables = sortedDays.join(',');
      }

      let res;
      if (editingStaff) {
        res = await dataService.updateStaffRecord(editingStaff.id, processedStaff);
      } else {
        res = await dataService.saveStaffRecord(processedStaff);
      }

      if (res && (res.success || res.id)) {
        await loadData();
        setShowStaffForm(false);
        setEditingStaff(null);
        setNewStaff({ 
          nombre: '', cedula: '', contacto: '', posicion: '', email: '',
          direccion: '', localidad: '', salon_id: '', commission_scheme_id: '', fecha_entrada: new Date().toISOString().split('T')[0],
          profile_photo: null, hora_entrada: '', hora_salida: '', dias_laborables: '', tolerancia_minutos: 15,
          tipo_salario: 'fijo_mas_comision', salario_base: 20000
        });
        setDailySchedules({
          Lunes: { active: false, entrada: '08:00', salida: '18:00' },
          Martes: { active: false, entrada: '08:00', salida: '18:00' },
          Miércoles: { active: false, entrada: '08:00', salida: '18:00' },
          Jueves: { active: false, entrada: '08:00', salida: '18:00' },
          Viernes: { active: false, entrada: '08:00', salida: '18:00' },
          Sábado: { active: false, entrada: '08:00', salida: '18:00' },
          Domingo: { active: false, entrada: '08:00', salida: '18:00' }
        });
        setScheduleMode('general');
        alert(editingStaff ? 'Personal actualizado correctamente' : 'Personal registrado correctamente');
      } else {
        alert('Error al guardar: ' + (res?.error || 'No se pudo guardar la información del colaborador.'));
      }
    } catch (err) {
      console.error('Error saving staff:', err);
      alert('Error de conexión o servidor al guardar los cambios.');
    } finally {
      setStaffSaving(false);
    }
  };

  const startEditStaff = (member) => {
    setEditingStaff(member);
    
    let dailyObj = {
      Lunes: { active: false, entrada: '08:00', salida: '18:00' },
      Martes: { active: false, entrada: '08:00', salida: '18:00' },
      Miércoles: { active: false, entrada: '08:00', salida: '18:00' },
      Jueves: { active: false, entrada: '08:00', salida: '18:00' },
      Viernes: { active: false, entrada: '08:00', salida: '18:00' },
      Sábado: { active: false, entrada: '08:00', salida: '18:00' },
      Domingo: { active: false, entrada: '08:00', salida: '18:00' }
    };
    let isDaily = false;

    if (member.dias_laborables && member.dias_laborables.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(member.dias_laborables);
        isDaily = true;
        Object.keys(parsed).forEach(day => {
          if (parsed[day]) {
            dailyObj[day] = {
              active: true,
              entrada: parsed[day].entrada || '08:00',
              salida: parsed[day].salida || '18:00'
            };
          }
        });
      } catch (e) {}
    } else {
      const activeDays = member.dias_laborables ? member.dias_laborables.split(',') : [];
      activeDays.forEach(day => {
        if (dailyObj[day]) {
          dailyObj[day].active = true;
          dailyObj[day].entrada = member.hora_entrada || '08:00';
          dailyObj[day].salida = member.hora_salida || '18:00';
        }
      });
    }

    setDailySchedules(dailyObj);
    setScheduleMode(isDaily ? 'daily' : 'general');

    setNewStaff({
      nombre: member.nombre,
      cedula: member.cedula,
      contacto: member.contacto,
      posicion: member.posicion,
      email: member.email || '',
      direccion: member.direccion,
      localidad: member.localidad,
      salon_id: member.salon_id || '',
      commission_scheme_id: member.commission_scheme_id || '',
      fecha_entrada: member.fecha_entrada ? new Date(member.fecha_entrada).toISOString().split('T')[0] : '',
      fecha_salida: member.fecha_salida ? new Date(member.fecha_salida).toISOString().split('T')[0] : '',
      status: member.status,
      profile_photo: member.profile_photo || null,
      hora_entrada: member.hora_entrada || '',
      hora_salida: member.hora_salida || '',
      dias_laborables: member.dias_laborables || '',
      tolerancia_minutos: member.tolerancia_minutos !== undefined && member.tolerancia_minutos !== null ? member.tolerancia_minutos : 15,
      tipo_salario: member.tipo_salario || 'fijo_mas_comision',
      salario_base: member.salario_base !== undefined && member.salario_base !== null ? member.salario_base : (member.tipo_salario === 'comision_pura' ? 0 : 20000)
    });
  };

  const daysOfWeek = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

  const filteredStaff = staff.filter(member => {
    if (searchTerm && !member.nombre.toLowerCase().includes(searchTerm.toLowerCase()) && !(member.cedula || '').includes(searchTerm)) return false;
    if (filterLocation && String(member.salon_id) !== String(filterLocation)) return false;
    if (filterRole && member.posicion !== filterRole) return false;
    if (filterStatus && member.status !== filterStatus) return false;
    return true;
  });

  const handleExportStaff = () => {
    if (!staff || staff.length === 0) {
      alert("No hay personal para exportar.");
      return;
    }

    const headers = [
      "ID de Empleado",
      "Nombre Completo",
      "Cédula / Identificación",
      "Cargo / Posición",
      "Contacto / Teléfono",
      "Dirección Residencial",
      "Localidad / Sucursal",
      "Fecha de Ingreso",
      "Fecha de Salida",
      "Estado Laboral"
    ];

    const rows = staff.map(member => {
      const entryDate = member.fecha_entrada ? new Date(member.fecha_entrada) : null;
      const formattedEntry = entryDate 
        ? `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}-${String(entryDate.getDate()).padStart(2, '0')}`
        : 'N/A';

      const exitDate = member.fecha_salida ? new Date(member.fecha_salida) : null;
      const formattedExit = exitDate
        ? `${exitDate.getFullYear()}-${String(exitDate.getMonth() + 1).padStart(2, '0')}-${String(exitDate.getDate()).padStart(2, '0')}`
        : 'N/A';

      const sucursalName = salons.find(s => String(s.id) === String(member.salon_id))?.name || member.localidad || 'Global / Sin asignar';

      return [
        member.id,
        member.nombre,
        member.cedula,
        member.posicion || 'Sin cargo',
        member.contacto || 'N/A',
        member.direccion || 'N/A',
        sucursalName,
        formattedEntry,
        formattedExit,
        member.status || 'Activo'
      ];
    });

    const csvContent = [headers, ...rows].map(e => e.map(val => {
      const cleaned = String(val ?? '').replace(/"/g, '""');
      return `"${cleaned}"`;
    }).join(";")).join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `reporte_empleados_rrhh_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderScheduleConfig = (target, setTarget) => {
    return (
      <div style={{ marginTop: '1.25rem', borderTop: '1px solid #f1f5f9', paddingTop: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <label style={{ fontSize: '0.8rem', fontWeight: 800, color: '#64748b', margin: 0 }}>
            Configuración de Horario Laboral
          </label>
          
          {/* Mode Selector */}
          <div style={{ display: 'flex', background: '#f1f5f9', padding: '0.2rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <button
              type="button"
              onClick={() => setScheduleMode('general')}
              style={{
                padding: '0.3rem 0.6rem',
                borderRadius: '6px',
                fontSize: '0.7rem',
                fontWeight: 750,
                cursor: 'pointer',
                border: 'none',
                background: scheduleMode === 'general' ? 'white' : 'transparent',
                color: scheduleMode === 'general' ? '#09090b' : '#64748b',
                boxShadow: scheduleMode === 'general' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              Fijo Semanal
            </button>
            <button
              type="button"
              onClick={() => setScheduleMode('daily')}
              style={{
                padding: '0.3rem 0.6rem',
                borderRadius: '6px',
                fontSize: '0.7rem',
                fontWeight: 750,
                cursor: 'pointer',
                border: 'none',
                background: scheduleMode === 'daily' ? 'white' : 'transparent',
                color: scheduleMode === 'daily' ? '#09090b' : '#64748b',
                boxShadow: scheduleMode === 'daily' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              Variable por Día
            </button>
          </div>
        </div>

        {/* Tolerancia - General to both modes */}
        <div style={{ marginBottom: '1rem', width: '150px' }}>
          <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>
            Tolerancia (min)
          </label>
          <input 
            type="number" 
            className="input-field" 
            min="0"
            max="120"
            value={target.tolerancia_minutos !== undefined ? target.tolerancia_minutos : 15} 
            onChange={e => setTarget(prev => ({ ...prev, tolerancia_minutos: parseInt(e.target.value) || 0 }))}
            style={{ height: '38px', borderRadius: '8px', fontSize: '0.8rem', padding: '0 0.5rem', width: '100%' }}
          />
        </div>

        {scheduleMode === 'general' ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>Hora Entrada</label>
                <input 
                  type="time" 
                  className="input-field" 
                  value={target.hora_entrada || ''} 
                  onChange={e => setTarget(prev => ({ ...prev, hora_entrada: e.target.value }))}
                  style={{ height: '38px', borderRadius: '8px', fontSize: '0.8rem', padding: '0 0.5rem', width: '100%' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: '0.25rem' }}>Hora Salida</label>
                <input 
                  type="time" 
                  className="input-field" 
                  value={target.hora_salida || ''} 
                  onChange={e => setTarget(prev => ({ ...prev, hora_salida: e.target.value }))}
                  style={{ height: '38px', borderRadius: '8px', fontSize: '0.8rem', padding: '0 0.5rem', width: '100%' }}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: '0.5rem' }}>Días Laborables</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {daysOfWeek.map(day => {
                  const active = dailySchedules[day]?.active;
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => {
                        setDailySchedules(prev => ({
                          ...prev,
                          [day]: { ...prev[day], active: !prev[day].active }
                        }));
                      }}
                      style={{
                        padding: '0.35rem 0.65rem',
                        borderRadius: '8px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        border: '1px solid',
                        borderColor: active ? '#10b981' : '#e2e8f0',
                        background: active ? '#f0fdf4' : 'white',
                        color: active ? '#15803d' : '#64748b',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 650, marginBottom: '0.25rem', display: 'block' }}>
              Define el horario específico para cada día de trabajo:
            </span>
            {daysOfWeek.map(day => {
              const dayConfig = dailySchedules[day] || { active: false, entrada: '08:00', salida: '18:00' };
              return (
                <div key={day} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '0.5rem 0.75rem', background: dayConfig.active ? 'white' : 'transparent', border: dayConfig.active ? '1px solid #e2e8f0' : '1px solid transparent', borderRadius: '8px', transition: 'all 0.15s ease' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, cursor: 'pointer', flex: 1 }}>
                    <input
                      type="checkbox"
                      checked={dayConfig.active}
                      onChange={(e) => {
                        setDailySchedules(prev => ({
                          ...prev,
                          [day]: { ...prev[day], active: e.target.checked }
                        }));
                      }}
                      style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#10b981' }}
                    />
                    <span style={{ fontSize: '0.8rem', fontWeight: 800, color: dayConfig.active ? '#09090b' : '#94a3b8' }}>
                      {day}
                    </span>
                  </label>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: dayConfig.active ? 1 : 0.5 }}>
                    <input
                      type="time"
                      disabled={!dayConfig.active}
                      value={dayConfig.entrada}
                      onChange={(e) => {
                        setDailySchedules(prev => ({
                          ...prev,
                          [day]: { ...prev[day], entrada: e.target.value }
                        }));
                      }}
                      style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none', background: dayConfig.active ? 'white' : '#f1f5f9' }}
                    />
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600 }}>a</span>
                    <input
                      type="time"
                      disabled={!dayConfig.active}
                      value={dayConfig.salida}
                      onChange={(e) => {
                        setDailySchedules(prev => ({
                          ...prev,
                          [day]: { ...prev[day], salida: e.target.value }
                        }));
                      }}
                      style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', border: '1px solid #cbd5e1', borderRadius: '6px', outline: 'none', background: dayConfig.active ? 'white' : '#f1f5f9' }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header Banner Homologado RRHH */}
      <div style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        borderRadius: '20px',
        padding: '2rem',
        color: '#ffffff',
        marginBottom: '2rem',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1.5rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div style={{
            background: 'linear-gradient(135deg, #d4af37 0%, #f59e0b 100%)',
            padding: '1rem',
            borderRadius: '16px',
            color: '#000000',
            boxShadow: '0 8px 16px rgba(212, 175, 55, 0.3)'
          }}>
            <Users size={34} strokeWidth={2.3} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <h1 style={{ fontSize: '1.75rem', fontWeight: 900, margin: 0, letterSpacing: '-0.5px' }}>
                Gestión de RRHH & Colaboradores
              </h1>
              <span style={{
                background: 'rgba(59, 130, 246, 0.2)',
                color: '#60a5fa',
                border: '1px solid rgba(59, 130, 246, 0.4)',
                fontSize: '0.75rem',
                fontWeight: 700,
                padding: '0.2rem 0.6rem',
                borderRadius: '999px',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem'
              }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#60a5fa' }} />
                Expedientes de Personal
              </span>
            </div>
            <p style={{ color: '#94a3b8', margin: '0.35rem 0 0 0', fontSize: '0.9rem' }}>
              Directorio de colaboradores, turnos, esquemas de comisión, asignación de sucursales y expedientes laborales.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => {
              setEditingStaff(null);
              setNewStaff({
                nombre: '', cedula: '', contacto: '', posicion: '', email: '',
                direccion: '', localidad: '', salon_id: '', commission_scheme_id: '', fecha_entrada: new Date().toISOString().split('T')[0],
                profile_photo: null, hora_entrada: '08:00', hora_salida: '18:00', dias_laborables: 'Lunes,Martes,Miércoles,Jueves,Viernes,Sábado', tolerancia_minutos: 15
              });
              setShowStaffForm(true);
            }}
            className="btn-primary"
            style={{
              background: '#d4af37',
              color: '#000000',
              fontWeight: 850,
              padding: '0.75rem 1.4rem',
              borderRadius: '12px',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              boxShadow: '0 4px 14px rgba(212, 175, 55, 0.35)'
            }}
          >
            <UserPlus size={18} />
            <span>Nuevo Colaborador</span>
          </button>

          <button
            onClick={() => navigate('/seguridad')}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#ffffff',
              padding: '0.75rem 1.25rem',
              borderRadius: '12px',
              fontWeight: 700,
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            title="Ir a Seguridad para administrar contraseñas, roles y permisos de acceso"
          >
            <Shield size={16} color="#d4af37" />
            <span>Usuarios & Seguridad</span>
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          {/* RRHH Form Modal */}
          {showStaffForm && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
              <div className="surface-card" style={{ width: '100%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto', position: 'relative' }}>
                <button onClick={() => { setShowStaffForm(false); setEditingStaff(null); }} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                  <XCircle size={24} />
                </button>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <UserPlus size={20} /> {editingStaff ? 'Editar Ficha' : 'Nueva Ficha RRHH'}
                </h3>
                <form onSubmit={handleSaveStaff} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div className="input-group">
                    <label>Nombre del Empleado</label>
                    <input 
                      type="text" className="input-field" required 
                      value={newStaff.nombre} onChange={e => setNewStaff({...newStaff, nombre: e.target.value})}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div className="input-group">
                      <label>Cédula</label>
                      <input 
                        type="text" className="input-field" required 
                        value={newStaff.cedula} onChange={e => setNewStaff({...newStaff, cedula: e.target.value})}
                      />
                    </div>
                    <div className="input-group">
                      <label>Contacto</label>
                      <input 
                        type="text" className="input-field" required 
                        value={newStaff.contacto} onChange={e => setNewStaff({...newStaff, contacto: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="input-group">
                    <label>Email de Notificaciones</label>
                    <input 
                      type="email" className="input-field"
                      placeholder="ejemplo@abatte.com"
                      value={newStaff.email || ''} onChange={e => setNewStaff({...newStaff, email: e.target.value})}
                    />
                  </div>
                  <div className="input-group">
                    <label>Posición / Cargo</label>
                    <select 
                      className="input-field" 
                      required 
                      value={newStaff.posicion} 
                      onChange={e => setNewStaff({...newStaff, posicion: e.target.value})}
                    >
                      <option value="">Selecciona un cargo...</option>
                      <option value="Peluquera">Peluquera</option>
                      <option value="Lava pelo">Lava pelo</option>
                      <option value="Manicurista">Manicurista</option>
                      <option value="Encargada">Encargada</option>
                    </select>
                  </div>
                  <div className="input-group">
                    <label>Dirección Residencia</label>
                    <input 
                      type="text" className="input-field" 
                      value={newStaff.direccion} onChange={e => setNewStaff({...newStaff, direccion: e.target.value})}
                    />
                  </div>
                  <div className="input-group">
                    <label>Localidad</label>
                    <select 
                      className="input-field" 
                      value={newStaff.salon_id} 
                      onChange={e => setNewStaff({...newStaff, salon_id: e.target.value, localidad: salons.find(s => String(s.id) === String(e.target.value))?.name || ''})}
                      required
                    >
                      <option value="">Selecciona una localidad...</option>
                      {salons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>

                  <div className="input-group">
                    <label>Esquema de Comisión (Asignación Automática)</label>
                    <select 
                      className="input-field" 
                      value={newStaff.commission_scheme_id || ''} 
                      onChange={e => setNewStaff({...newStaff, commission_scheme_id: e.target.value})}
                    >
                      <option value="">Sin Esquema Específico (Usar por defecto)</option>
                      {schemes.map(sch => (
                        <option key={sch.id} value={sch.id}>{sch.nombre} ({sch.tipo})</option>
                      ))}
                    </select>
                  </div>

                  {/* CONFIGURACIÓN SALARIAL (NÓMINA) */}
                  <div style={{ padding: '1.25rem', background: '#f8faff', borderRadius: '14px', border: '1.5px solid #dbeafe', margin: '1.25rem 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.85rem' }}>
                      <Wallet size={18} color="#0066ff" />
                      <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: '#1e40af', margin: 0 }}>
                        CONFIGURACIÓN SALARIAL (NÓMINA)
                      </h4>
                    </div>

                    <div className="input-group" style={{ marginBottom: '1rem' }}>
                      <label style={{ fontWeight: 700, color: '#1e293b' }}>Tipo de Salario</label>
                      <select 
                        className="input-field" 
                        value={newStaff.tipo_salario || 'fijo_mas_comision'} 
                        onChange={e => {
                          const val = e.target.value;
                          setNewStaff(prev => ({
                            ...prev, 
                            tipo_salario: val,
                            salario_base: val === 'comision_pura' ? 0 : (prev.salario_base || 20000)
                          }));
                        }}
                        required
                      >
                        <option value="fijo_mas_comision">Salario fijo más comisiones</option>
                        <option value="comision_pura">Salario únicamente por comisiones</option>
                        <option value="fijo_puro">Salario fijo únicamente</option>
                      </select>
                    </div>

                    {newStaff.tipo_salario !== 'comision_pura' ? (
                      <div className="input-group">
                        <label style={{ fontWeight: 700, color: '#1e293b' }}>
                          Monto del Salario Base Mensual (RD$)
                        </label>
                        <div style={{ position: 'relative' }}>
                          <span style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', fontWeight: 800, color: '#64748b', fontSize: '0.85rem' }}>
                            RD$
                          </span>
                          <input 
                            type="number" 
                            step="0.01" 
                            min="0"
                            className="input-field" 
                            style={{ paddingLeft: '3.2rem', fontWeight: 700, color: '#0f172a' }}
                            placeholder="0.00"
                            value={newStaff.salario_base !== undefined ? newStaff.salario_base : ''} 
                            onChange={e => setNewStaff({...newStaff, salario_base: e.target.value})}
                            required={newStaff.tipo_salario !== 'comision_pura'}
                          />
                        </div>
                      </div>
                    ) : (
                      <div style={{ background: '#eff6ff', borderRadius: '10px', padding: '0.75rem 1rem', border: '1px solid #bfdbfe', fontSize: '0.8rem', color: '#1e40af' }}>
                        💎 <strong>Solo Comisiones:</strong> Este colaborador devengará el 100% de sus ingresos en base a las comisiones por servicios generadas en el POS (Salario base RD$ 0.00 en la nómina).
                      </div>
                    )}
                  </div>

                  <div className="input-group">
                    <label>Fecha de Entrada</label>
                    <input 
                      type="date" className="input-field" required
                      value={newStaff.fecha_entrada} onChange={e => setNewStaff({...newStaff, fecha_entrada: e.target.value})}
                    />
                  </div>

                  {editingStaff && (
                    <div style={{ padding: '1rem', background: '#fff7ed', borderRadius: '12px', border: '1px solid #ffedd5', marginTop: '1rem' }}>
                      <h4 style={{ fontSize: '0.8rem', fontWeight: 800, color: '#9a3412', marginBottom: '1rem' }}>GESTIÓN DE SALIDA</h4>
                      <div className="input-group">
                        <label>Fecha de Salida (Opcional)</label>
                        <input 
                          type="date" className="input-field"
                          value={newStaff.fecha_salida || ''} onChange={e => setNewStaff({...newStaff, fecha_salida: e.target.value})}
                        />
                      </div>
                      <div className="input-group" style={{ marginTop: '1rem' }}>
                        <label>Estado Laboral</label>
                        <select 
                          className="input-field"
                          value={newStaff.status} onChange={e => setNewStaff({...newStaff, status: e.target.value})}
                        >
                          <option value="Activo">Activo</option>
                          <option value="Inactivo">Baja / Renuncia</option>
                          <option value="Licencia">En Licencia</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Foto de perfil para asistencia */}
                  <div className="input-group" style={{ marginTop: '1rem', borderTop: '1px solid #f1f5f9', paddingTop: '1.25rem' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 800, color: '#64748b', marginBottom: '0.75rem', display: 'block' }}>Foto de Perfil (Asistencia / Poncheo)</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                      <div style={{ width: '60px', height: '60px', borderRadius: '12px', border: '1px dashed #cbd5e1', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', flexShrink: 0 }}>
                        {newStaff.profile_photo ? (
                          <img src={newStaff.profile_photo} alt="Foto de perfil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <User size={24} color="#94a3b8" />
                        )}
                      </div>
                      <div>
                        <input 
                          type="file" 
                          accept="image/*" 
                          id="staff-photo-upload" 
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const file = e.target.files[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              setNewStaff(prev => ({ ...prev, profile_photo: reader.result }));
                            };
                            reader.readAsDataURL(file);
                          }}
                        />
                        <label htmlFor="staff-photo-upload" className="btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem', borderRadius: '8px', cursor: 'pointer', display: 'inline-block', fontWeight: 700, border: '1px solid #e2e8f0' }}>
                          {newStaff.profile_photo ? 'Cambiar Foto' : 'Subir Foto'}
                        </label>
                        <p style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: '0.25rem', margin: 0 }}>PNG, JPG o JPEG de máx. 5MB</p>
                      </div>
                    </div>
                  </div>

                  {renderScheduleConfig(newStaff, setNewStaff)}

                  <button type="submit" disabled={staffSaving} className="btn-primary" style={{ marginTop: '1.5rem', opacity: staffSaving ? 0.7 : 1, cursor: staffSaving ? 'not-allowed' : 'pointer' }}>
                    {staffSaving ? '⏳ Guardando cambios...' : (editingStaff ? 'Guardar Cambios' : 'Registrar en RRHH')}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Header Controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <button 
              onClick={() => {
                setShowStaffForm(true);
                setEditingStaff(null);
                setScheduleMode('general');
                setDailySchedules({
                  Lunes: { active: false, entrada: '08:00', salida: '18:00' },
                  Martes: { active: false, entrada: '08:00', salida: '18:00' },
                  Miércoles: { active: false, entrada: '08:00', salida: '18:00' },
                  Jueves: { active: false, entrada: '08:00', salida: '18:00' },
                  Viernes: { active: false, entrada: '08:00', salida: '18:00' },
                  Sábado: { active: false, entrada: '08:00', salida: '18:00' },
                  Domingo: { active: false, entrada: '08:00', salida: '18:00' }
                });
                setNewStaff({ nombre: '', cedula: '', contacto: '', posicion: '', email: '', direccion: '', localidad: '', salon_id: '', fecha_entrada: new Date().toISOString().split('T')[0], profile_photo: null, hora_entrada: '', hora_salida: '', dias_laborables: '', tolerancia_minutos: 15 });
              }}
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.875rem 1.5rem', borderRadius: '12px' }}
            >
              <UserPlus size={18} /> Nuevo Empleado
            </button>

            <div style={{ display: 'flex', gap: '1rem', flex: 1, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', width: '200px' }}>
                <MapPin size={16} color="#64748b" style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)' }} />
                <select className="input-field" style={{ paddingLeft: '2.5rem', background: 'white', borderRadius: '8px' }} value={filterLocation} onChange={e => setFilterLocation(e.target.value)}>
                  <option value="">Todas las localidades</option>
                  {salons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div style={{ position: 'relative', width: '200px' }}>
                <Briefcase size={16} color="#64748b" style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)' }} />
                <select className="input-field" style={{ paddingLeft: '2.5rem', background: 'white', borderRadius: '8px' }} value={filterRole} onChange={e => setFilterRole(e.target.value)}>
                  <option value="">Todos los cargos</option>
                  <option value="Peluquera">Peluquera</option>
                  <option value="Lava pelo">Lava pelo</option>
                  <option value="Manicurista">Manicurista</option>
                  <option value="Encargada">Encargada</option>
                </select>
              </div>
              <div style={{ position: 'relative', width: '200px' }}>
                <Activity size={16} color="#64748b" style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)' }} />
                <select className="input-field" style={{ paddingLeft: '2.5rem', background: 'white', borderRadius: '8px' }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                  <option value="">Todos los estados</option>
                  <option value="Activo">Activo</option>
                  <option value="Baja/Renuncia">Baja / Renuncia</option>
                  <option value="Licencia">En Licencia</option>
                </select>
              </div>
              <div style={{ position: 'relative', width: '250px' }}>
                <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)' }} />
                <input 
                  type="text" 
                  placeholder="Buscar empleado..." 
                  className="input-field" 
                  style={{ paddingLeft: '2.5rem', background: 'white', borderRadius: '8px' }}
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Stats Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div className="surface-card" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem', borderRadius: '16px' }}>
               <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                 <Users size={28} color="#09090b" />
               </div>
               <div>
                 <p style={{ fontSize: '1.75rem', fontWeight: 900, color: '#09090b', lineHeight: 1 }}>{staff.length}</p>
                 <p style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, marginTop: '0.25rem' }}>Total Empleados</p>
                 <p style={{ fontSize: '0.7rem', color: '#94a3b8' }}>en todas las sucursales</p>
               </div>
            </div>
            
            <div className="surface-card" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem', borderRadius: '16px' }}>
               <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                 <Building size={28} color="#09090b" />
               </div>
               <div>
                 <p style={{ fontSize: '1.75rem', fontWeight: 900, color: '#09090b', lineHeight: 1 }}>{salons.length}</p>
                 <p style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, marginTop: '0.25rem' }}>Sucursales</p>
                 <p style={{ fontSize: '0.7rem', color: '#94a3b8' }}>activas</p>
               </div>
            </div>

            <div className="surface-card" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem', borderRadius: '16px' }}>
               <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                 <TrendingUp size={28} color="#22c55e" />
               </div>
               <div>
                 <p style={{ fontSize: '1.75rem', fontWeight: 900, color: '#09090b', lineHeight: 1 }}>{staff.filter(s => s.status === 'Activo').length}</p>
                 <p style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, marginTop: '0.25rem' }}>Empleados Activos</p>
                 <p style={{ fontSize: '0.7rem', color: '#94a3b8' }}>hoy</p>
               </div>
            </div>

            <div className="surface-card" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem', borderRadius: '16px' }}>
               <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: '#f5f3ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                 <Scissors size={28} color="#8b5cf6" />
               </div>
               <div>
                 <p style={{ fontSize: '1.75rem', fontWeight: 900, color: '#09090b', lineHeight: 1 }}>{staff.filter(s => s.posicion?.toLowerCase() === 'peluquera' || s.posicion?.toLowerCase() === 'peluquero').length}</p>
                 <p style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, marginTop: '0.25rem' }}>Peluqueros</p>
                 <p style={{ fontSize: '0.7rem', color: '#94a3b8' }}>en el equipo</p>
               </div>
            </div>

            <div className="surface-card" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem', borderRadius: '16px' }}>
               <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: '#fffbeb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                 <Shield size={28} color="#f59e0b" />
               </div>
               <div>
                 <p style={{ fontSize: '1.75rem', fontWeight: 900, color: '#09090b', lineHeight: 1 }}>{staff.filter(s => s.posicion?.toLowerCase().includes('recep') || s.posicion?.toLowerCase().includes('encargad') || s.posicion?.toLowerCase().includes('admin')).length}</p>
                 <p style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, marginTop: '0.25rem' }}>Encargadas y</p>
                 <p style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Recepción</p>
               </div>
            </div>
          </div>

          {/* List Controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#64748b' }}>Vista:</span>
              <div style={{ display: 'flex', background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                <button 
                  onClick={() => setViewMode('lista')}
                  style={{ padding: '0.5rem 1rem', background: viewMode === 'lista' ? '#09090b' : 'white', color: viewMode === 'lista' ? 'white' : '#64748b', border: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', transition: 'all 0.2s' }}
                >
                  <List size={16} /> Lista
                </button>
                <button 
                  onClick={() => setViewMode('agrupado')}
                  style={{ padding: '0.5rem 1rem', background: viewMode === 'agrupado' ? '#09090b' : 'white', color: viewMode === 'agrupado' ? 'white' : '#64748b', border: 'none', borderLeft: viewMode === 'agrupado' ? 'none' : '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', transition: 'all 0.2s' }}
                >
                  <LayoutTemplate size={16} /> Agrupado
                </button>
                <button 
                  onClick={() => setViewMode('tabla')}
                  style={{ padding: '0.5rem 1rem', background: viewMode === 'tabla' ? '#09090b' : 'white', color: viewMode === 'tabla' ? 'white' : '#64748b', border: 'none', borderLeft: viewMode === 'tabla' ? 'none' : '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', transition: 'all 0.2s' }}
                >
                  <Grid size={16} /> Tabla
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#64748b' }}>Ordenar por:</span>
              <select style={{ padding: '0.5rem', border: 'none', background: 'transparent', fontWeight: 700, color: '#09090b', cursor: 'pointer', outline: 'none' }}>
                <option>Más recientes</option>
                <option>Nombre A-Z</option>
              </select>
              <button onClick={handleExportStaff} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', background: 'white', borderRadius: '8px', border: '1px solid #e2e8f0', cursor: 'pointer' }}>
                <Download size={16} /> Exportar
              </button>
            </div>
          </div>

          {/* List Content */}
          <div className="surface-card" style={{ padding: '0', borderRadius: '16px', overflow: 'hidden' }}>
            {filteredStaff.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map(member => (
              <div key={member.id} style={{ display: 'flex', alignItems: 'center', padding: '1.5rem', borderBottom: '1px solid #f1f5f9', background: 'white', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flex: '2 1 300px' }}>
                  <div style={{ position: 'relative' }}>
                    <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#09090b', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 800, overflow: 'hidden' }}>
                      {member.profile_photo ? (
                        <img src={member.profile_photo} alt={member.nombre} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        member.nombre.charAt(0).toUpperCase()
                      )}
                    </div>
                    {member.status === 'Activo' && (
                      <div style={{ position: 'absolute', bottom: 2, right: 2, width: '12px', height: '12px', background: '#22c55e', borderRadius: '50%', border: '2px solid white' }}></div>
                    )}
                  </div>
                  <div>
                    <p style={{ fontWeight: 800, fontSize: '1.1rem', color: '#09090b' }}>{member.nombre}</p>
                    <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '0.2rem', fontWeight: 600 }}>{member.posicion}</p>
                    <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <MapPin size={12} /> {salons.find(s => String(s.id) === String(member.salon_id))?.name || member.localidad || 'Todas las localidades'}
                    </p>
                  </div>
                </div>
                
                <div style={{ flex: '1.5 1 200px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ padding: '0.25rem 0.75rem', background: member.status === 'Activo' ? '#dcfce7' : (member.status === 'Licencia' ? '#fef3c7' : '#fee2e2'), color: member.status === 'Activo' ? '#16a34a' : (member.status === 'Licencia' ? '#d97706' : '#ef4444'), borderRadius: '100px', fontSize: '0.75rem', fontWeight: 800 }}>
                      {member.status === 'Inactivo' ? 'Baja / Renuncia' : member.status}
                    </span>
                    {member.commission_scheme_id && (
                      <span style={{ fontSize: '0.7rem', color: '#7c3aed', fontWeight: 800, background: '#f5f3ff', padding: '0.2rem 0.5rem', borderRadius: '8px', border: '1px solid #ddd6fe' }}>
                        💼 {schemes.find(sch => String(sch.id) === String(member.commission_scheme_id))?.nombre || 'Esquema'}
                      </span>
                    )}
                    <span style={{ fontSize: '0.7rem', color: '#047857', fontWeight: 800, background: '#ecfdf5', padding: '0.2rem 0.5rem', borderRadius: '8px', border: '1px solid #a7f3d0', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      💰 {member.tipo_salario === 'comision_pura' ? 'Solo Comisiones' : (member.tipo_salario === 'fijo_puro' ? `Fijo RD$ ${Number(member.salario_base || 0).toLocaleString()}` : `Fijo RD$ ${Number(member.salario_base || 0).toLocaleString()} + Comisiones`)}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.5rem' }}>Entrada: {member.fecha_entrada ? new Date(member.fecha_entrada).toLocaleDateString() : 'N/A'}</p>
                  <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.2rem' }}>ID: {member.cedula}</p>
                </div>

                <div style={{ flex: '1.5 1 200px' }}>
                  <p style={{ fontSize: '0.875rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                     <Phone size={14} /> {member.contacto || 'N/A'}
                  </p>
                  <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                     <Mail size={14} /> {member.email || `${member.nombre.split(' ')[0].toLowerCase()}@abatte.com`}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flex: '0.5 1 100px' }}>
                  <button onClick={() => { setShowStaffForm(true); startEditStaff(member); }} className="btn-secondary" style={{ padding: '0.6rem', borderRadius: '50%', background: 'transparent', border: '1px solid #e2e8f0' }}>
                    <Edit2 size={16} color="#64748b" />
                  </button>
                  <button 
                    onClick={() => setSelectedStaffDetail(member)}
                    className="btn-secondary" 
                    style={{ padding: '0.6rem', borderRadius: '50%', background: 'transparent', border: '1px solid #e2e8f0' }}
                    title="Ver Información"
                  >
                    <Eye size={16} color="#64748b" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
             <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1} className="btn-secondary" style={{ padding: '0.5rem 0.75rem', background: 'white', borderRadius: '8px', border: '1px solid #e2e8f0', opacity: currentPage === 1 ? 0.5 : 1 }}><ChevronLeft size={16} /></button>
                <button className="btn-primary" style={{ padding: '0.5rem 1rem', background: '#09090b', color: 'white', border: 'none', borderRadius: '8px' }}>{currentPage}</button>
                <button onClick={() => setCurrentPage(Math.min(Math.ceil(filteredStaff.length / itemsPerPage) || 1, currentPage + 1))} disabled={currentPage >= Math.ceil(filteredStaff.length / itemsPerPage)} className="btn-secondary" style={{ padding: '0.5rem 0.75rem', background: 'white', borderRadius: '8px', border: '1px solid #e2e8f0', opacity: currentPage >= Math.ceil(filteredStaff.length / itemsPerPage) ? 0.5 : 1 }}><ChevronRight size={16} /></button>
             </div>
             <div style={{ fontSize: '0.875rem', color: '#64748b', fontWeight: 600 }}>
               Mostrando {filteredStaff.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0} - {Math.min(currentPage * itemsPerPage, filteredStaff.length)} de {filteredStaff.length}
             </div>
          </div>
          
        </div>

      {/* Modal - View Staff Profile details */}
      {selectedStaffDetail && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(9, 9, 11, 0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: 'white', borderRadius: '24px', width: '90%', maxWidth: '520px', border: '1px solid #e2e8f0', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
            
            {/* Modal Header */}
            <div style={{ padding: '1.25rem 1.75rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900, color: '#09090b', letterSpacing: '-0.3px' }}>Ficha de Información del Empleado</h3>
              <button
                onClick={() => setSelectedStaffDetail(null)}
                style={{ border: 'none', background: 'transparent', fontSize: '1.2rem', cursor: 'pointer', color: '#94a3b8', fontWeight: 700 }}
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', maxHeight: '80vh', overflowY: 'auto' }} className="hide-scrollbar">
              
              {/* Header profile info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '1.5rem' }}>
                <div style={{ width: '70px', height: '70px', borderRadius: '50%', background: '#09090b', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', fontWeight: 800, flexShrink: 0, overflow: 'hidden' }}>
                  {selectedStaffDetail.profile_photo ? (
                    <img src={selectedStaffDetail.profile_photo} alt={selectedStaffDetail.nombre} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    selectedStaffDetail.nombre.charAt(0).toUpperCase()
                  )}
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 900, color: '#09090b' }}>{selectedStaffDetail.nombre}</h4>
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.9rem', color: '#64748b', fontWeight: 700 }}>{selectedStaffDetail.posicion}</p>
                  <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span style={{ padding: '0.25rem 0.75rem', background: selectedStaffDetail.status === 'Activo' ? '#dcfce7' : (selectedStaffDetail.status === 'Licencia' ? '#fef3c7' : '#fee2e2'), color: selectedStaffDetail.status === 'Activo' ? '#16a34a' : (selectedStaffDetail.status === 'Licencia' ? '#d97706' : '#ef4444'), borderRadius: '100px', fontSize: '0.72rem', fontWeight: 800 }}>
                      {selectedStaffDetail.status === 'Inactivo' ? 'Baja / Renuncia' : selectedStaffDetail.status}
                    </span>
                  </div>
                </div>
              </div>

              {/* Informative Grid sections */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                
                {/* 1. Datos Generales */}
                <div>
                  <h5 style={{ margin: '0 0 0.75rem', fontSize: '0.75rem', fontWeight: 850, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Datos Generales</h5>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', background: '#f8fafc', padding: '1rem', borderRadius: '12px' }}>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 700 }}>CÉDULA / ID</span>
                      <strong style={{ fontSize: '0.85rem', color: '#09090b' }}>{selectedStaffDetail.cedula || 'N/A'}</strong>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 700 }}>FECHA INGRESO</span>
                      <strong style={{ fontSize: '0.85rem', color: '#09090b' }}>
                        {selectedStaffDetail.fecha_entrada ? new Date(selectedStaffDetail.fecha_entrada).toLocaleDateString() : 'N/A'}
                      </strong>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 700 }}>SUCURSAL</span>
                      <strong style={{ fontSize: '0.85rem', color: '#09090b' }}>
                        {salons.find(s => String(s.id) === String(selectedStaffDetail.salon_id))?.name || selectedStaffDetail.localidad || 'Todas las localidades'}
                      </strong>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 700 }}>ESQUEMA COMISIÓN</span>
                      <strong style={{ fontSize: '0.85rem', color: '#7c3aed' }}>
                        {schemes.find(sch => String(sch.id) === String(selectedStaffDetail.commission_scheme_id))?.nombre || 'Por defecto / Sin asignar'}
                      </strong>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 700 }}>DIRECCIÓN</span>
                      <strong style={{ fontSize: '0.85rem', color: '#09090b', wordBreak: 'break-word' }}>{selectedStaffDetail.direccion || 'N/A'}</strong>
                    </div>
                  </div>
                </div>

                {/* 2. Contacto */}
                <div>
                  <h5 style={{ margin: '0 0 0.75rem', fontSize: '0.75rem', fontWeight: 850, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Contacto</h5>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: '#f8fafc', padding: '1rem', borderRadius: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ background: 'white', padding: '0.4rem', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex' }}><Phone size={14} color="#64748b" /></span>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.65rem', color: '#64748b', fontWeight: 700 }}>CELULAR / TELÉFONO</span>
                        <strong style={{ fontSize: '0.85rem', color: '#09090b' }}>{selectedStaffDetail.contacto || 'N/A'}</strong>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ background: 'white', padding: '0.4rem', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex' }}><Mail size={14} color="#64748b" /></span>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.65rem', color: '#64748b', fontWeight: 700 }}>CORREO ELECTRÓNICO</span>
                        <strong style={{ fontSize: '0.85rem', color: '#09090b' }}>{selectedStaffDetail.email || `${selectedStaffDetail.nombre.split(' ')[0].toLowerCase()}@abatte.com`}</strong>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Horarios y Jornada */}
                <div>
                  <h5 style={{ margin: '0 0 0.75rem', fontSize: '0.75rem', fontWeight: 850, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Horario y Jornada</h5>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', background: '#f8fafc', padding: '1rem', borderRadius: '12px' }}>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 700 }}>HORARIO JORNADA</span>
                      <strong style={{ fontSize: '0.85rem', color: '#09090b' }}>
                        {selectedStaffDetail.hora_entrada && selectedStaffDetail.hora_salida ? (
                          `${format12h(selectedStaffDetail.hora_entrada)} - ${format12h(selectedStaffDetail.hora_salida)}`
                        ) : (
                          'Sin horario asignado'
                        )}
                      </strong>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 700 }}>MIN. TOLERANCIA</span>
                      <strong style={{ fontSize: '0.85rem', color: '#10b981' }}>
                        {selectedStaffDetail.tolerancia_minutos !== null ? `${selectedStaffDetail.tolerancia_minutos} min` : '15 min'}
                      </strong>
                    </div>
                    <div style={{ gridColumn: 'span 2' }}>
                      <span style={{ display: 'block', fontSize: '0.7rem', color: '#64748b', fontWeight: 700 }}>DÍAS LABORABLES Y HORARIOS</span>
                      <div style={{ marginTop: '0.4rem' }}>
                        {(() => {
                          const val = selectedStaffDetail.dias_laborables || '';
                          if (val.trim().startsWith('{')) {
                            try {
                              const parsed = JSON.parse(val);
                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', background: 'white', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                  {Object.keys(parsed).map(day => (
                                    <div key={day} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                                      <span style={{ fontWeight: 750, color: '#475569' }}>{day}</span>
                                      <span style={{ fontWeight: 800, color: '#10b981' }}>{parsed[day].entrada.slice(0, 5)} - {parsed[day].salida.slice(0, 5)}</span>
                                    </div>
                                  ))}
                                </div>
                              );
                            } catch (e) {
                              return <strong style={{ fontSize: '0.85rem', color: '#dc2626' }}>Error al procesar horario por día</strong>;
                            }
                          }
                          return (
                            <strong style={{ fontSize: '0.85rem', color: '#09090b' }}>
                              {val ? val.split(',').join(', ') : 'Ninguno asignado'}
                            </strong>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4. Configuración Salarial (Nómina) */}
                <div>
                  <h5 style={{ margin: '0 0 0.75rem', fontSize: '0.75rem', fontWeight: 850, color: '#047857', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    💰 Configuración Salarial (Nómina)
                  </h5>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', background: '#ecfdf5', padding: '1rem', borderRadius: '12px', border: '1px solid #a7f3d0' }}>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.7rem', color: '#065f46', fontWeight: 700 }}>MODALIDAD DE PAGO</span>
                      <strong style={{ fontSize: '0.85rem', color: '#047857' }}>
                        {selectedStaffDetail.tipo_salario === 'comision_pura'
                          ? 'Salario únicamente por comisiones'
                          : (selectedStaffDetail.tipo_salario === 'fijo_puro'
                            ? 'Salario fijo únicamente'
                            : 'Salario fijo más comisiones')}
                      </strong>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.7rem', color: '#065f46', fontWeight: 700 }}>SALARIO MENSUAL</span>
                      <strong style={{ fontSize: '0.95rem', color: '#047857', fontWeight: 900 }}>
                        {selectedStaffDetail.tipo_salario === 'comision_pura'
                          ? 'RD$ 0.00 (100% Comisiones)'
                          : `RD$ ${Number(selectedStaffDetail.salario_base || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}`}
                      </strong>
                    </div>
                    {selectedStaffDetail.tipo_salario !== 'comision_pura' && (
                      <div style={{ gridColumn: 'span 2', fontSize: '0.75rem', color: '#047857', background: 'rgba(255,255,255,0.6)', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid #d1fae5' }}>
                        💡 <strong>Cálculo en Nómina Quincenal:</strong> RD$ {(Number(selectedStaffDetail.salario_base || 0) / 2).toLocaleString('es-DO', { minimumFractionDigits: 2 })} base por quincena {selectedStaffDetail.tipo_salario === 'fijo_mas_comision' ? '+ comisiones acumuladas.' : '(sin comisión variable).'}
                      </div>
                    )}
                  </div>
                </div>

              </div>

              {/* Action Close */}
              <div style={{ marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setSelectedStaffDetail(null)}
                  style={{ width: '100%', height: '48px', border: 'none', background: '#09090b', color: 'white', borderRadius: '50px', fontWeight: 800, fontSize: '0.9rem', cursor: 'pointer', fontFamily: '"Plus Jakarta Sans", sans-serif' }}
                >
                  Cerrar Ficha
                </button>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoleManagement;

