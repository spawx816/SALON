import React, { useState, useEffect } from 'react';
import { 
  UserPlus, Shield, CheckCircle2, XCircle, 
  Settings, Users, Key, Mail, UserCheck, Trash2, Edit2,
  Search, Building, TrendingUp, Scissors, Download, 
  List, Grid, LayoutTemplate, MapPin, Briefcase, Activity, 
  ChevronLeft, ChevronRight, Eye, Phone, User
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useTranslation } from '../../context/LanguageContext';

const RoleManagement = () => {
  const [activeTab, setActiveTab] = useState('users');
  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [staff, setStaff] = useState([]);
  const [salons, setSalons] = useState([]);
  
  // States for New User
  const [newUser, setNewUser] = useState({ nombre: '', email: '', password: '', role_id: '', salon_id: '' });
  const [editingUser, setEditingUser] = useState(null);
  
  // States for RRHH
  const [newStaff, setNewStaff] = useState({ 
    nombre: '', cedula: '', contacto: '', posicion: '', 
    direccion: '', localidad: '', salon_id: '', fecha_entrada: new Date().toISOString().split('T')[0] 
  });
  const [editingStaff, setEditingStaff] = useState(null);

  // States for Role Editing
  const [editingRole, setEditingRole] = useState(null);
  const [roleForm, setRoleForm] = useState({ nombre: '', permisos: {} });

  // New RRHH UI States
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
      const r = await dataService.getRoles();
      const u = await dataService.getUsers();
      const s = await dataService.getStaffRecords();
      const sal = await dataService.getSalons();
      setRoles(r || []);
      setUsers(u || []);
      setStaff(s || []);
      setSalons(sal || []);
      if (r && r.length > 0 && !newUser.role_id) setNewUser(prev => ({ ...prev, role_id: r[0].id }));
    } catch (err) {
      console.error("Error loading management data:", err);
    }
  };

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterLocation, filterRole, filterStatus]);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    await dataService.saveUser(editingUser ? { ...newUser, id: editingUser.id } : newUser);
    setNewUser({ nombre: '', email: '', password: '', role_id: roles[0]?.id || '' });
    setEditingUser(null);
    loadData();
    alert(editingUser ? 'Usuario actualizado correctamente' : 'Usuario creado correctamente');
  };

  const handleSaveStaff = async (e) => {
    e.preventDefault();
    if (editingStaff) {
      await dataService.updateStaffRecord(editingStaff.id, newStaff);
    } else {
      await dataService.saveStaffRecord(newStaff);
    }
    setNewStaff({ 
      nombre: '', cedula: '', contacto: '', posicion: '', 
      direccion: '', localidad: '', salon_id: '', fecha_entrada: new Date().toISOString().split('T')[0] 
    });
    setEditingStaff(null);
    loadData();
    alert('Personal registrado/actualizado correctamente');
  };

  const startEditStaff = (member) => {
    setEditingStaff(member);
    setNewStaff({
      nombre: member.nombre,
      cedula: member.cedula,
      contacto: member.contacto,
      posicion: member.posicion,
      direccion: member.direccion,
      localidad: member.localidad,
      salon_id: member.salon_id || '',
      fecha_entrada: member.fecha_entrada ? new Date(member.fecha_entrada).toISOString().split('T')[0] : '',
      fecha_salida: member.fecha_salida ? new Date(member.fecha_salida).toISOString().split('T')[0] : '',
      status: member.status
    });
  };

  const handleDeleteUser = async (id) => {
    if (window.confirm('¿Estás seguro de eliminar este usuario?')) {
      await dataService.deleteUser(id);
      loadData();
    }
  };

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

      const sucursalName = salons.find(s => s.id === member.salon_id)?.name || member.localidad || 'Global / Sin asignar';

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

  const startEditUser = (user) => {
    setEditingUser(user);
    setNewUser({ 
      nombre: user.nombre, 
      email: user.email, 
      password: '', // Password stays empty for edit unless user wants to change it
      role_id: user.role_id,
      salon_id: user.salon_id || ''
    });
  };

  const handleSaveRole = async (e) => {
    e.preventDefault();
    await dataService.saveRole(editingRole ? { ...roleForm, id: editingRole.id } : roleForm);
    setEditingRole(null);
    setRoleForm({ nombre: '', permisos: {} });
    loadData();
    alert('Rol actualizado');
  };

  const togglePermission = (perm) => {
    setRoleForm(prev => ({
      ...prev,
      permisos: {
        ...prev.permisos,
        [perm]: !prev.permisos[perm]
      }
    }));
  };

  const PERMISSION_LABELS = {
    view_analytics: 'Ver Analítica y Reportes',
    view_contracts: 'Ver Contratos y Suscripciones',
    manage_staff: 'Gestionar Personal y Roles',
    manage_plans: 'Crear y Editar Planes',
    manage_clients: 'Gestionar Base de Datos de Clientes',
    record_visits: 'Registrar Visitas y Servicios',
    process_payments: 'Procesar Cobros y Facturación',
    manage_surveys: 'Gestionar Encuestas'
  };

  const filteredStaff = staff.filter(member => {
    if (searchTerm && !member.nombre.toLowerCase().includes(searchTerm.toLowerCase()) && !(member.cedula || '').includes(searchTerm)) return false;
    if (filterLocation && String(member.salon_id) !== String(filterLocation)) return false;
    if (filterRole && member.posicion !== filterRole) return false;
    if (filterStatus && member.status !== filterStatus) return false;
    return true;
  });

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div className="page-header" style={{ marginBottom: '2rem' }}>
        <div>
          <h2 className="page-title">Personal y Seguridad</h2>
          <p className="page-subtitle">Gestiona quién tiene acceso al sistema y qué acciones pueden realizar.</p>
        </div>
      </div>

      {/* Premium Segmented Switcher Navigation Tabs */}
      <div style={{
        display: 'inline-flex',
        background: '#f1f5f9',
        padding: '6px',
        borderRadius: '16px',
        marginBottom: '2.5rem',
        border: '1px solid #e2e8f0',
        boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)'
      }}>
        <button 
          onClick={() => setActiveTab('users')}
          style={{ 
            padding: '10px 24px',
            background: activeTab === 'users' ? '#ffffff' : 'transparent',
            border: 'none',
            borderRadius: '12px',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: 800,
            color: activeTab === 'users' ? '#09090b' : '#64748b',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: activeTab === 'users' ? '0 4px 12px rgba(0,0,0,0.05)' : 'none',
            transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
        >
          <Users size={16} style={{ color: activeTab === 'users' ? '#10b981' : '#64748b' }} />
          Usuarios del Sistema
        </button>
        <button 
          onClick={() => setActiveTab('rrhh')}
          style={{ 
            padding: '10px 24px',
            background: activeTab === 'rrhh' ? '#ffffff' : 'transparent',
            border: 'none',
            borderRadius: '12px',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: 800,
            color: activeTab === 'rrhh' ? '#09090b' : '#64748b',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: activeTab === 'rrhh' ? '0 4px 12px rgba(0,0,0,0.05)' : 'none',
            transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
        >
          <Scissors size={16} style={{ color: activeTab === 'rrhh' ? '#3b82f6' : '#64748b' }} />
          RRHH (Personal)
        </button>
        <button 
          onClick={() => setActiveTab('roles')}
          style={{ 
            padding: '10px 24px',
            background: activeTab === 'roles' ? '#ffffff' : 'transparent',
            border: 'none',
            borderRadius: '12px',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: 800,
            color: activeTab === 'roles' ? '#09090b' : '#64748b',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: activeTab === 'roles' ? '0 4px 12px rgba(0,0,0,0.05)' : 'none',
            transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
        >
          <Shield size={16} style={{ color: activeTab === 'roles' ? '#f59e0b' : '#64748b' }} />
          Roles y Permisos
        </button>
      </div>

      {activeTab === 'users' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '2rem' }}>
          {/* New User Form */}
          <div className="surface-card" style={{ padding: '2.5rem', border: '1px solid #e2e8f0', borderRadius: '20px', boxShadow: '0 10px 30px -10px rgba(0,0,0,0.04)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 900, marginBottom: '1.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#09090b' }}>
              <UserPlus size={22} style={{ color: '#10b981' }} /> 
              {editingUser ? 'Editar Acceso' : 'Nuevo Acceso'}
            </h3>
            
            <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="input-group">
                <label style={{ fontSize: '0.8rem', fontWeight: 800, color: '#64748b', marginBottom: '0.5rem', display: 'block' }}>Nombre Completo</label>
                <div style={{ position: 'relative' }}>
                  <User size={16} color="#94a3b8" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)' }} />
                  <input 
                    type="text" 
                    className="input-field" 
                    required 
                    placeholder="Ej. Juan Pérez"
                    value={newUser.nombre} 
                    onChange={e => setNewUser({...newUser, nombre: e.target.value})}
                    style={{ padding: '0 1rem 0 2.5rem', height: '46px', borderRadius: '10px', fontSize: '0.9rem' }}
                  />
                </div>
              </div>
              
              <div className="input-group">
                <label style={{ fontSize: '0.8rem', fontWeight: 800, color: '#64748b', marginBottom: '0.5rem', display: 'block' }}>Email de Acceso</label>
                <div style={{ position: 'relative' }}>
                  <Mail size={16} color="#94a3b8" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)' }} />
                  <input 
                    type="email" 
                    className="input-field" 
                    required 
                    placeholder="correo@salonpro.com"
                    value={newUser.email} 
                    onChange={e => setNewUser({...newUser, email: e.target.value})}
                    style={{ padding: '0 1rem 0 2.5rem', height: '46px', borderRadius: '10px', fontSize: '0.9rem' }}
                  />
                </div>
              </div>
              
              <div className="input-group">
                <label style={{ fontSize: '0.8rem', fontWeight: 800, color: '#64748b', marginBottom: '0.5rem', display: 'block' }}>
                  {editingUser ? 'Nueva Contraseña (dejar vacío para no cambiar)' : 'Contraseña Temporal'}
                </label>
                <div style={{ position: 'relative' }}>
                  <Key size={16} color="#94a3b8" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)' }} />
                  <input 
                    type="password" 
                    className="input-field" 
                    required={!editingUser}
                    placeholder={editingUser ? "••••••••" : "Min. 6 caracteres"}
                    value={newUser.password} 
                    onChange={e => setNewUser({...newUser, password: e.target.value})}
                    style={{ padding: '0 1rem 0 2.5rem', height: '46px', borderRadius: '10px', fontSize: '0.9rem' }}
                  />
                </div>
              </div>
              
              <div className="input-group">
                <label style={{ fontSize: '0.8rem', fontWeight: 800, color: '#64748b', marginBottom: '0.5rem', display: 'block' }}>Asignar Rol</label>
                <div style={{ position: 'relative' }}>
                  <Shield size={16} color="#94a3b8" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', zIndex: 1 }} />
                  <select 
                    className="input-field" 
                    required
                    value={newUser.role_id} 
                    onChange={e => setNewUser({...newUser, role_id: e.target.value})}
                    style={{ padding: '0 2rem 0 3rem', textIndent: '14px', height: '46px', borderRadius: '10px', fontSize: '0.9rem', cursor: 'pointer', background: 'white' }}
                  >
                    {roles.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                  </select>
                </div>
              </div>
              
              <div className="input-group">
                <label style={{ fontSize: '0.8rem', fontWeight: 800, color: '#64748b', marginBottom: '0.5rem', display: 'block' }}>Asignar Localidad (Sucursal)</label>
                <div style={{ position: 'relative' }}>
                  <Building size={16} color="#94a3b8" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', zIndex: 1 }} />
                  <select 
                    className="input-field"
                    value={newUser.salon_id} 
                    onChange={e => setNewUser({...newUser, salon_id: e.target.value})}
                    style={{ padding: '0 2rem 0 3rem', textIndent: '14px', height: '46px', borderRadius: '10px', fontSize: '0.9rem', cursor: 'pointer', background: 'white' }}
                  >
                    <option value="">🌎 Acceso Global (Todas)</option>
                    {salons.map(s => <option key={s.id} value={s.id}>📍 {s.name}</option>)}
                  </select>
                </div>
                <p style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.5rem', fontWeight: 550, lineHeight: '1.4' }}>
                  * Los usuarios con acceso global podrán visualizar reportes y administrar contratos de todas las sucursales del salón.
                </p>
              </div>
              
              <button 
                type="submit" 
                className="btn-primary" 
                style={{ 
                  marginTop: '0.75rem', 
                  height: '46px', 
                  borderRadius: '10px', 
                  fontSize: '0.9rem', 
                  fontWeight: 800,
                  boxShadow: '0 4px 12px rgba(9, 9, 11, 0.12)'
                }}
              >
                {editingUser ? 'Actualizar Usuario' : 'Crear Usuario'}
              </button>
              
              {editingUser && (
                <button 
                  type="button" 
                  onClick={() => { setEditingUser(null); setNewUser({ nombre: '', email: '', password: '', role_id: roles[0]?.id || '' }); }} 
                  className="btn-secondary" 
                  style={{ height: '46px', borderRadius: '10px', fontSize: '0.9rem', fontWeight: 800 }}
                >
                  Cancelar Edición
                </button>
              )}
            </form>
          </div>

          {/* Users List */}
          <div className="surface-card" style={{ padding: '2.5rem', border: '1px solid #e2e8f0', borderRadius: '20px', boxShadow: '0 10px 30px -10px rgba(0,0,0,0.04)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 900, marginBottom: '1.75rem', color: '#09090b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Usuarios Activos</span>
              <span style={{ fontSize: '0.8rem', background: '#f1f5f9', color: '#475569', padding: '3px 10px', borderRadius: '99px', fontWeight: 800 }}>
                {users.length} Registrados
              </span>
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {users.map(u => (
                <div 
                  key={u.id} 
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between', 
                    padding: '1.25rem 1.5rem', 
                    background: '#ffffff', 
                    border: '1px solid #e2e8f0', 
                    borderRadius: '16px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.01)',
                    transition: 'all 0.25s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#94a3b8';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.03)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#e2e8f0';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.01)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                    <div style={{ 
                      width: '46px', 
                      height: '46px', 
                      borderRadius: '50%', 
                      background: '#09090b', 
                      color: 'white', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      fontWeight: 800,
                      fontSize: '1.1rem',
                      boxShadow: '0 4px 10px rgba(9, 9, 11, 0.15)'
                    }}>
                      {u.nombre.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p style={{ fontWeight: 800, fontSize: '1.05rem', color: '#09090b', margin: 0 }}>{u.nombre}</p>
                      <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '4px 0 0 0', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <span>{u.email}</span>
                        <span>•</span>
                        <strong style={{ color: '#09090b', fontWeight: 800 }}>{u.role_name}</strong>
                        {u.salon_id ? (
                          <span style={{ 
                            background: 'rgba(71, 85, 105, 0.05)', 
                            padding: '2px 8px', 
                            borderRadius: '99px', 
                            color: '#475569',
                            fontWeight: 700,
                            border: '1px solid rgba(71, 85, 105, 0.1)',
                            fontSize: '0.75rem'
                          }}>
                            📍 {salons.find(s => s.id === u.salon_id)?.name || 'Sucursal'}
                          </span>
                        ) : (
                          <span style={{ 
                            background: 'rgba(59, 130, 246, 0.08)', 
                            padding: '2px 8px', 
                            borderRadius: '99px', 
                            color: '#2563eb',
                            fontWeight: 800,
                            border: '1px solid rgba(59, 130, 246, 0.15)',
                            fontSize: '0.75rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#2563eb' }}></span>
                            Global
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button 
                      onClick={() => startEditUser(u)} 
                      style={{ 
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        background: 'transparent',
                        border: '1px solid #e2e8f0',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = '#94a3b8'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = '#e2e8f0'; }}
                      title="Editar"
                    >
                      <Edit2 size={15} color="#475569" />
                    </button>
                    <button 
                      onClick={() => handleDeleteUser(u.id)} 
                      style={{ 
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        background: 'transparent',
                        border: '1px solid #fee2e2',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.borderColor = '#fca5a5'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = '#fee2e2'; }}
                      title="Eliminar"
                    >
                      <Trash2 size={15} color="#dc2626" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'rrhh' && (
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
                <form onSubmit={(e) => { handleSaveStaff(e); setShowStaffForm(false); }} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
                      onChange={e => setNewStaff({...newStaff, salon_id: e.target.value, localidad: salons.find(s => s.id === e.target.value)?.name || ''})}
                      required
                    >
                      <option value="">Selecciona una localidad...</option>
                      {salons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
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

                  <button type="submit" className="btn-primary" style={{ marginTop: '1rem' }}>
                    {editingStaff ? 'Guardar Cambios' : 'Registrar en RRHH'}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Header Controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <button 
              onClick={() => { setShowStaffForm(true); setEditingStaff(null); setNewStaff({ nombre: '', cedula: '', contacto: '', posicion: '', direccion: '', localidad: '', salon_id: '', fecha_entrada: new Date().toISOString().split('T')[0] }); }}
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
                 <p style={{ fontSize: '1.75rem', fontWeight: 900, color: '#09090b', lineHeight: 1 }}>{users.filter(u => u.role_name?.toLowerCase().includes('admin') || u.role_name?.toLowerCase().includes('recep')).length}</p>
                 <p style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, marginTop: '0.25rem' }}>ADMIN y</p>
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
                    <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#09090b', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 800 }}>
                      {member.nombre.charAt(0)}
                    </div>
                    {member.status === 'Activo' && (
                      <div style={{ position: 'absolute', bottom: 2, right: 2, width: '12px', height: '12px', background: '#22c55e', borderRadius: '50%', border: '2px solid white' }}></div>
                    )}
                  </div>
                  <div>
                    <p style={{ fontWeight: 800, fontSize: '1.1rem', color: '#09090b' }}>{member.nombre}</p>
                    <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '0.2rem', fontWeight: 600 }}>{member.posicion}</p>
                    <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <MapPin size={12} /> {salons.find(s => s.id === member.salon_id)?.name || member.localidad || 'Todas las localidades'}
                    </p>
                  </div>
                </div>
                
                <div style={{ flex: '1.5 1 200px' }}>
                  <span style={{ padding: '0.25rem 0.75rem', background: member.status === 'Activo' ? '#dcfce7' : (member.status === 'Licencia' ? '#fef3c7' : '#fee2e2'), color: member.status === 'Activo' ? '#16a34a' : (member.status === 'Licencia' ? '#d97706' : '#ef4444'), borderRadius: '100px', fontSize: '0.75rem', fontWeight: 800 }}>
                    {member.status === 'Inactivo' ? 'Baja / Renuncia' : member.status}
                  </span>
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
                  <button className="btn-secondary" style={{ padding: '0.6rem', borderRadius: '50%', background: 'transparent', border: '1px solid #e2e8f0' }}>
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
      )}

      {activeTab === 'roles' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '2rem' }}>
           {/* Roles Sidebar */}
           <div className="surface-card">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '1.5rem' }}>Lista de Roles</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {roles.map(r => (
                  <button 
                    key={r.id} 
                    onClick={() => {
                        setEditingRole(r);
                        let perms = {};
                        try {
                          perms = typeof r.permisos === 'string' ? JSON.parse(r.permisos) : (r.permisos || {});
                        } catch (e) {
                          console.error("Error parsing permissions", e);
                        }
                        setRoleForm({ nombre: r.nombre, permisos: perms });
                    }}
                    style={{ 
                      padding: '1rem', textAlign: 'left', borderRadius: '12px', border: '1px solid var(--border-subtle)', cursor: 'pointer',
                      background: editingRole?.id === r.id ? 'var(--text-primary)' : 'var(--bg-canvas)',
                      color: editingRole?.id === r.id ? 'white' : 'var(--text-primary)',
                      fontWeight: 600, transition: 'all 0.2s'
                    }}
                  >
                    {r.nombre}
                  </button>
                ))}
                <button 
                   onClick={() => { setEditingRole(null); setRoleForm({ nombre: '', permisos: {} }); }}
                   className="btn-secondary" style={{ marginTop: '1rem' }}
                >
                  + Crear Nuevo Rol
                </button>
              </div>
           </div>

           {/* Permission Editor */}
           <div className="surface-card">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '1.5rem' }}>
                {editingRole ? `Editando: ${editingRole.nombre}` : 'Nuevo Rol de Usuario'}
              </h3>
              <form onSubmit={handleSaveRole}>
                <div className="input-group" style={{ marginBottom: '2rem' }}>
                  <label>Nombre del Rol</label>
                  <input 
                    type="text" className="input-field" placeholder="Ej. Encargada de Piso" required 
                    value={roleForm.nombre} onChange={e => setRoleForm({...roleForm, nombre: e.target.value})}
                  />
                </div>

                <label style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '1rem', display: 'block' }}>Permisos del Rol</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
                   {Object.keys(PERMISSION_LABELS).map(key => (
                     <div 
                      key={key} 
                      onClick={() => togglePermission(key)}
                      style={{ 
                        padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-subtle)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '1rem',
                        background: (roleForm.permisos && roleForm.permisos[key]) ? '#f0fdf4' : 'var(--bg-canvas)',
                        borderColor: (roleForm.permisos && roleForm.permisos[key]) ? '#22c55e' : 'var(--border-subtle)'
                      }}
                     >
                       {(roleForm.permisos && roleForm.permisos[key]) ? <CheckCircle2 size={20} color="#22c55e" /> : <XCircle size={20} color="#d1d5db" />}
                       <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{PERMISSION_LABELS[key]}</span>
                     </div>
                   ))}
                </div>

                <button type="submit" className="btn-primary" style={{ width: '100%', padding: '1.25rem' }}>
                  Guardar Configuración de Rol
                </button>
              </form>
           </div>
        </div>
      )}
    </div>
  );
};

export default RoleManagement;

