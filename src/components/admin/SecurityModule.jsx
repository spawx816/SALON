import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  Shield, Users, Key, Mail, Trash2, Edit2, UserPlus, CheckCircle2, XCircle, 
  Search, Lock, Unlock, Smartphone, Globe, AlertTriangle, RefreshCw, Send,
  ShieldAlert, ShieldCheck, Activity, Eye, LogOut, Check, Sliders, Server, UserX,
  Clock, MapPin, Laptop, Monitor, AlertCircle
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { PERMISSION_MODULES, ACTION_LABELS, hasUiPermission, isReservedRoleName } from '../../utils/rbacCatalog';
import { useTranslation } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';

export default function SecurityModule() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const [searchParams] = useSearchParams();

  // Tabs: 'users' | 'roles' | 'monitoring' | 'access_control' | 'pin_settings'
  const tabFromUrl = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(tabFromUrl || 'users');

  useEffect(() => {
    const currentTabParam = searchParams.get('tab');
    if (currentTabParam) {
      setActiveTab(currentTabParam);
    }
  }, [searchParams]);

  const [loading, setLoading] = useState(false);

  // Users & Roles state
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [salons, setSalons] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [userSearch, setUserSearch] = useState('');

  // User Form Modal State
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const isCurrentUserOwner = ['propietario', 'owner'].includes(String(currentUser?.role || '').toLowerCase());
  const [userForm, setUserForm] = useState({
    nombre: '',
    email: '',
    password: '',
    role_id: '',
    salon_id: '',
    authorized_branch_ids: [],
    all_branches_access: false,
    staff_id: '',
    profile_photo: null
  });

  // Role Form Modal State
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [roleForm, setRoleForm] = useState({
    nombre: '',
    permisos: {}
  });

  // Live Monitoring State (Sessions & Audit)
  const [activeSessions, setActiveSessions] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [sessionSearch, setSessionSearch] = useState('');
  const [refreshingSessions, setRefreshingSessions] = useState(false);

  // Access Control & Brute Force State
  const [loginAttempts, setLoginAttempts] = useState([]);
  const [blockedIps, setBlockedIps] = useState([]);

  // Security Settings & Multi-Email PIN State
  const [securitySettings, setSecuritySettings] = useState({
    require_pin_for_settings: 1,
    pin_notification_emails: '',
    max_failed_attempts: 5,
    lockout_minutes: 30,
    admin_pin: ''
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [sendingPin, setSendingPin] = useState(false);
  const [pinNotice, setPinNotice] = useState(null);

  // RBAC Catalog & Role Management State
  const [catalogModules, setCatalogModules] = useState(PERMISSION_MODULES);
  const [canManageRoles, setCanManageRoles] = useState(
    ['propietario', 'owner'].includes(String(currentUser?.role || '').toLowerCase())
  );
  const [roleSaveError, setRoleSaveError] = useState('');
  const [roleDirty, setRoleDirty] = useState(false);

  // PIN Verification Modal for sensitive actions
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [isPinUnlocked, setIsPinUnlocked] = useState(false);

  useEffect(() => {
    loadAllSecurityData();
  }, []);

  const loadAllSecurityData = async () => {
    setLoading(true);
    try {
      const [u, r, sal, sess, logs, attemptsData, secSet, staffRes, catalogRes] = await Promise.all([
        dataService.getUsers(),
        dataService.getRoles(),
        dataService.getSalons(),
        dataService.getActiveSessions(),
        dataService.getSecurityAuditLogs(100),
        dataService.getLoginAttempts(),
        dataService.getSecuritySettings(),
        dataService.getEmployees(true),
        dataService.getRolesCatalog()
      ]);

      setUsers(u || []);
      setRoles(r || []);
      setSalons(sal || []);
      setStaffList(staffRes || []);
      if (catalogRes?.modules?.length) {
        setCatalogModules(catalogRes.modules);
      }
      if (catalogRes && typeof catalogRes.canManageRoles === 'boolean') {
        setCanManageRoles(catalogRes.canManageRoles);
      }
      setActiveSessions(sess || []);
      setAuditLogs(logs || []);
      setLoginAttempts(attemptsData.attempts || []);
      setBlockedIps(attemptsData.blockedIps || []);
      if (secSet) {
        setSecuritySettings(prev => ({
          ...prev,
          require_pin_for_settings: secSet.require_pin_for_settings !== undefined ? secSet.require_pin_for_settings : 1,
          pin_notification_emails: secSet.pin_notification_emails || '',
          max_failed_attempts: secSet.max_failed_attempts || 5,
          lockout_minutes: secSet.lockout_minutes || 30
        }));
      }
    } catch (err) {
      console.error('Error loading security module data:', err);
    } finally {
      setLoading(false);
    }
  };

  const refreshSessions = async () => {
    setRefreshingSessions(true);
    try {
      const [sess, logs] = await Promise.all([
        dataService.getActiveSessions(),
        dataService.getSecurityAuditLogs(100)
      ]);
      setActiveSessions(sess || []);
      setAuditLogs(logs || []);
    } catch (e) {
      console.error(e);
    } finally {
      setRefreshingSessions(false);
    }
  };

  // === USER HANDLERS ===
  const handleSaveUser = async (e) => {
    e.preventDefault();
    if (!userForm.nombre || !userForm.email) {
      alert('Nombre y Email son obligatorios');
      return;
    }
    if (!editingUser && !userForm.password) {
      alert('Debes ingresar una contraseña para el nuevo usuario');
      return;
    }

    try {
      const isKioskReserved = userForm.role_id === '__KIOSK_RESERVED__';
      if (isKioskReserved && !userForm.salon_id) {
        alert('Debes seleccionar una sucursal obligatoria para el usuario Kiosco de Asistencia.');
        return;
      }
      const primaryBranchId = userForm.salon_id ? String(userForm.salon_id) : null;
      const normalizedAuthorizedBranches = isKioskReserved
        ? (primaryBranchId ? [primaryBranchId] : [])
        : Array.from(new Set([
            ...(Array.isArray(userForm.authorized_branch_ids) ? userForm.authorized_branch_ids.map(String) : []),
            ...(primaryBranchId ? [primaryBranchId] : []),
          ].filter(Boolean)));
      const effectiveAllBranches = isKioskReserved
        ? false
        : (isCurrentUserOwner ? Boolean(userForm.all_branches_access) : undefined);

      const payload = {
        ...userForm,
        id: editingUser ? editingUser.id : undefined,
        role: isKioskReserved ? 'kiosco_asistencia' : (editingUser && String(editingUser.role || '').toLowerCase() === 'kiosco_asistencia' ? 'empleado' : undefined),
        role_id: isKioskReserved ? null : (userForm.role_id || (roles[0]?.id || null)),
        salon_id: primaryBranchId,
        branch_id: primaryBranchId,
        authorized_branch_ids: normalizedAuthorizedBranches,
        all_branches_access: effectiveAllBranches,
        staff_id: userForm.staff_id ? parseInt(userForm.staff_id, 10) : null
      };

      await dataService.saveUser(payload);
      setShowUserModal(false);
      setEditingUser(null);
      setUserForm({ nombre: '', email: '', password: '', role_id: '', salon_id: '', authorized_branch_ids: [], all_branches_access: false, staff_id: '', profile_photo: null });
      await loadAllSecurityData();
      alert(editingUser ? 'Usuario actualizado exitosamente' : 'Usuario creado exitosamente');
    } catch (err) {
      alert('Error al guardar usuario: ' + err.message);
    }
  };

  const handleDeleteUser = async (userToDelete) => {
    if (userToDelete.id === currentUser?.id) {
      alert('No puedes eliminar tu propia cuenta de usuario en sesión.');
      return;
    }
    if (!window.confirm(`¿Estás seguro de eliminar el usuario "${userToDelete.nombre}"? Sus sesiones activas serán cerradas de inmediato automáticamente.`)) {
      return;
    }

    try {
      await dataService.deleteUser(userToDelete.id);
      await loadAllSecurityData();
      alert('Usuario eliminado correctamente y sus sesiones activas fueron finalizadas.');
    } catch (err) {
      alert('Error al eliminar usuario: ' + err.message);
    }
  };

  const parseAuthorizedBranches = (raw, primaryId) => {
    let list = [];
    if (Array.isArray(raw)) {
      list = raw.map(String);
    } else if (typeof raw === 'string' && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) list = parsed.map(String);
      } catch {
        list = raw.split(',').map(s => s.trim()).filter(Boolean);
      }
    }
    if (primaryId && !list.includes(String(primaryId))) {
      list.unshift(String(primaryId));
    }
    return Array.from(new Set(list.filter(Boolean)));
  };

  const startEditUser = (u) => {
    setEditingUser(u);
    const isKioskUser = String(u.role || '').toLowerCase() === 'kiosco_asistencia';
    const primaryBranch = u.branch_id || u.salon_id || '';
    setUserForm({
      nombre: u.nombre || '',
      email: u.email || '',
      password: '', // En blanco para no sobreescribir si no se desea
      role_id: isKioskUser ? '__KIOSK_RESERVED__' : (u.role_id || ''),
      salon_id: primaryBranch ? String(primaryBranch) : '',
      authorized_branch_ids: isKioskUser
        ? (primaryBranch ? [String(primaryBranch)] : [])
        : parseAuthorizedBranches(u.authorized_branch_ids, primaryBranch),
      all_branches_access: isKioskUser ? false : Boolean(u.all_branches_access),
      staff_id: u.staff_id ? String(u.staff_id) : '',
      profile_photo: u.profile_photo || null
    });
    setShowUserModal(true);
  };

  // === ROLE HANDLERS ===
  const canDelegatePermKey = (permKey) => {
    const rawRole = String(currentUser?.role || '').toLowerCase();
    if (rawRole === 'propietario' || rawRole === 'owner') return true;
    return hasUiPermission(currentUser, permKey);
  };

  const handleSaveRole = async (e) => {
    e.preventDefault();
    setRoleSaveError('');
    const cleanName = String(roleForm.nombre || '').trim();
    if (!cleanName) {
      setRoleSaveError('El nombre del rol es requerido.');
      return;
    }
    if (isReservedRoleName(cleanName)) {
      setRoleSaveError(`El nombre "${cleanName}" está reservado para roles del sistema y no puede usarse.`);
      return;
    }

    try {
      await dataService.saveRole({
        id: editingRole ? editingRole.id : undefined,
        nombre: cleanName,
        permisos: roleForm.permisos
      });
      setShowRoleModal(false);
      setEditingRole(null);
      setRoleDirty(false);
      setRoleForm({ nombre: '', permisos: {} });
      await loadAllSecurityData();
      alert(editingRole ? 'Rol actualizado exitosamente' : 'Rol creado exitosamente');
    } catch (err) {
      setRoleSaveError(err.message || 'Error al guardar rol.');
    }
  };

  const handleDeleteRole = async (r) => {
    if (Number(r.assigned_users_count || 0) > 0) {
      alert(`No puedes eliminar el rol "${r.nombre}" porque tiene ${r.assigned_users_count} usuario(s) asignado(s). Reasigna esos usuarios primero.`);
      return;
    }
    if (!window.confirm(`¿Estás seguro de eliminar el rol "${r.nombre}"? Esta acción quedará auditada.`)) {
      return;
    }
    try {
      await dataService.deleteRole(r.id);
      await loadAllSecurityData();
      alert('Rol eliminado correctamente.');
    } catch (err) {
      alert('No se pudo eliminar el rol: ' + err.message);
    }
  };

  const togglePermission = (permObj) => {
    const permKey = typeof permObj === 'string' ? permObj : permObj.key;
    if (!canDelegatePermKey(permKey)) return;
    setRoleDirty(true);
    setRoleForm(prev => {
      const nextValue = !prev.permisos[permKey];
      const nextPerms = { ...prev.permisos, [permKey]: nextValue };
      // Si se habilita un permiso con dependencias, habilitar sus dependencias automáticamente
      if (nextValue && typeof permObj === 'object' && Array.isArray(permObj.dependsOn)) {
        for (const dep of permObj.dependsOn) {
          if (canDelegatePermKey(dep)) {
            nextPerms[dep] = true;
          }
        }
      }
      return { ...prev, permisos: nextPerms };
    });
  };

  const handleSelectAllDelegable = () => {
    setRoleDirty(true);
    const nextPerms = { ...roleForm.permisos };
    for (const mod of catalogModules) {
      for (const p of (mod.permissions || [])) {
        if (canDelegatePermKey(p.key)) {
          nextPerms[p.key] = true;
        }
      }
    }
    setRoleForm(prev => ({ ...prev, permisos: nextPerms }));
  };

  const handleClearRolePerms = () => {
    setRoleDirty(true);
    setRoleForm(prev => ({ ...prev, permisos: {} }));
  };

  const startEditRole = (r) => {
    setEditingRole(r);
    setRoleSaveError('');
    setRoleDirty(false);
    let perms = {};
    if (typeof r.permisos === 'string') {
      try { perms = JSON.parse(r.permisos); } catch { perms = {}; }
    } else if (typeof r.permisos === 'object' && r.permisos !== null) {
      perms = r.permisos;
    }
    setRoleForm({
      nombre: r.nombre || '',
      permisos: perms
    });
    setShowRoleModal(true);
  };

  // === SESSION HANDLERS ===
  const handleTerminateSession = async (sess) => {
    if (!window.confirm(`¿Cerrar forzosamente la sesión de "${sess.user_name}" (${sess.ip_address})?`)) {
      return;
    }
    try {
      await dataService.terminateSession(sess.id);
      await refreshSessions();
      alert('Sesión cerrada remotamente.');
    } catch (err) {
      alert('Error al terminar sesión: ' + err.message);
    }
  };

  // === ACCESS CONTROL HANDLERS ===
  const handleUnblockIp = async (ip) => {
    if (!window.confirm(`¿Desbloquear la dirección IP ${ip}?`)) return;
    try {
      await dataService.unblockIp(ip);
      const attemptsData = await dataService.getLoginAttempts();
      setLoginAttempts(attemptsData.attempts || []);
      setBlockedIps(attemptsData.blockedIps || []);
      alert(`IP ${ip} desbloqueada correctamente.`);
    } catch (err) {
      alert('Error al desbloquear IP: ' + err.message);
    }
  };

  // === PIN & SECURITY SETTINGS HANDLERS ===
  const handleSaveSecuritySettings = async (e) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await dataService.saveSecuritySettings(securitySettings);
      alert('Configuración de seguridad guardada exitosamente.');
      setPinNotice('Parámetros actualizados.');
    } catch (err) {
      alert('Error al guardar configuración: ' + err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleRequestPinByEmail = async () => {
    setSendingPin(true);
    setPinNotice(null);
    try {
      const res = await dataService.requestSecurityPin();
      setPinNotice(res.message || 'PIN enviado con éxito a los correos configurados.');
      alert(res.message || 'PIN de seguridad enviado exitosamente.');
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setSendingPin(false);
    }
  };

  const handleVerifyPinSubmit = async (e) => {
    e.preventDefault();
    setPinError('');
    try {
      const res = await dataService.verifySecurityPin(pinInput);
      if (res && res.authorized) {
        setIsPinUnlocked(true);
        setShowPinModal(false);
        setPinInput('');
        alert('PIN de seguridad verificado. Acceso a configuración desbloqueado.');
      } else {
        setPinError('PIN de seguridad incorrecto o expirado.');
      }
    } catch (err) {
      setPinError(err.message || 'Error al validar PIN.');
    }
  };

  const filteredUsers = users.filter(u => {
    const q = userSearch.toLowerCase();
    return (
      (u.nombre && u.nombre.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.role_name && u.role_name.toLowerCase().includes(q))
    );
  });

  const filteredSessions = activeSessions.filter(s => {
    const q = sessionSearch.toLowerCase();
    return (
      (s.user_name && s.user_name.toLowerCase().includes(q)) ||
      (s.ip_address && s.ip_address.toLowerCase().includes(q)) ||
      (s.device_info && s.device_info.toLowerCase().includes(q)) ||
      (s.role && s.role.toLowerCase().includes(q))
    );
  });

  // Matriz de Permisos Estructurada
  const permissionModules = [
    {
      group: 'Punto de Venta y Facturación',
      perms: [
        { key: 'record_visits', label: 'Facturar / Registrar Visitas' },
        { key: 'process_payments', label: 'Cobro y Cajas Registradoras' },
        { key: 'manage_discounts', label: 'Aplicar Descuentos en POS' },
        { key: 'view_invoices', label: 'Historial de Facturas' }
      ]
    },
    {
      group: 'Gestión de Clientes y Planes',
      perms: [
        { key: 'manage_clients', label: 'Crear y Modificar Clientes' },
        { key: 'manage_plans', label: 'Administrar Planes y Membresías' },
        { key: 'view_contracts', label: 'Visualizar Contratos Digitales' },
        { key: 'manage_surveys', label: 'Ver y Gestionar Encuestas' }
      ]
    },
    {
      group: 'Personal, Nómina y Asistencia',
      perms: [
        { key: 'manage_staff', label: 'Gestión de RRHH / Colaboradores' },
        { key: 'manage_payroll', label: 'Procesar y Aprobar Nómina' },
        { key: 'manage_commissions', label: 'Gestionar y Pagar Comisiones' },
        { key: 'manage_attendance', label: 'Control y Reportes de Asistencia' }
      ]
    },
    {
      group: 'Administración y Seguridad del Sistema',
      perms: [
        { key: 'view_analytics', label: 'Inteligencia de Negocios (BI)' },
        { key: 'manage_salons', label: 'Configurar Sucursales' },
        { key: 'manage_services', label: 'Catálogo de Servicios y Precios' },
        { key: 'manage_security', label: 'Administrar Seguridad, Usuarios y Roles' }
      ]
    }
  ];

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1440px', margin: '0 auto' }}>
      
      {/* Header Banner */}
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
            <Shield size={36} strokeWidth={2.5} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <h1 style={{ fontSize: '1.75rem', fontWeight: 900, margin: 0, letterSpacing: '-0.5px' }}>
                Centro de Seguridad & Control de Accesos
              </h1>
              <span style={{
                background: 'rgba(16, 185, 129, 0.2)',
                color: '#34d399',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                fontSize: '0.75rem',
                fontWeight: 700,
                padding: '0.2rem 0.6rem',
                borderRadius: '999px',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem'
              }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#34d399' }} />
                Blindaje Activo
              </span>
            </div>
            <p style={{ color: '#94a3b8', margin: '0.35rem 0 0 0', fontSize: '0.9rem' }}>
              Monitoreo en vivo de sesiones, auditoría de actividad, protección anti-fuerza bruta y políticas de acceso.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={loadAllSecurityData}
            disabled={loading}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#ffffff',
              padding: '0.75rem 1.25rem',
              borderRadius: '12px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            <span>Actualizar Datos</span>
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={{
        display: 'flex',
        gap: '0.5rem',
        borderBottom: '2px solid rgba(0, 0, 0, 0.08)',
        marginBottom: '2rem',
        overflowX: 'auto',
        paddingBottom: '0.5rem'
      }}>
        {[
          { id: 'users', label: 'Usuarios del Sistema', icon: Users, badge: users.length },
          { id: 'roles', label: 'Roles y Permisos', icon: Key, badge: roles.length },
          { id: 'monitoring', label: 'Monitoreo en Vivo (Sesiones)', icon: Activity, badge: activeSessions.length, badgeColor: '#10b981' },
          { id: 'access_control', label: 'Intentos & Bloqueos', icon: ShieldAlert, badge: blockedIps.length > 0 ? `${blockedIps.length} Bloqueadas` : null, badgeColor: '#ef4444' },
          { id: 'pin_settings', label: 'Configuración & PIN Multi-Correo', icon: Lock }
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.65rem',
                padding: '0.85rem 1.35rem',
                borderRadius: '12px',
                border: 'none',
                background: isActive ? '#0f172a' : 'transparent',
                color: isActive ? '#ffffff' : '#64748b',
                fontWeight: isActive ? 700 : 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
                transition: 'all 0.2s',
                whiteSpace: 'nowrap'
              }}
            >
              <Icon size={18} color={isActive ? '#d4af37' : 'currentColor'} />
              <span>{tab.label}</span>
              {tab.badge !== undefined && tab.badge !== null && (
                <span style={{
                  background: tab.badgeColor || (isActive ? 'rgba(212,175,55,0.3)' : 'rgba(0,0,0,0.08)'),
                  color: isActive ? (tab.badgeColor ? '#ffffff' : '#fbbf24') : '#475569',
                  fontSize: '0.75rem',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '999px',
                  fontWeight: 800
                }}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* TAB 1: USUARIOS DEL SISTEMA */}
      {activeTab === 'users' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ position: 'relative', width: '320px' }}>
              <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                type="text"
                placeholder="Buscar usuario por nombre o email..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem 0.75rem 2.75rem',
                  borderRadius: '12px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.9rem'
                }}
              />
            </div>

            <button
              onClick={() => {
                setEditingUser(null);
                const defaultBranch = salons[0]?.id ? String(salons[0].id) : '';
                setUserForm({
                  nombre: '',
                  email: '',
                  password: '',
                  role_id: roles[0]?.id || '',
                  salon_id: defaultBranch,
                  authorized_branch_ids: defaultBranch ? [defaultBranch] : [],
                  all_branches_access: false,
                  staff_id: '',
                  profile_photo: null
                });
                setShowUserModal(true);
              }}
              style={{
                background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                color: '#ffffff',
                border: 'none',
                padding: '0.75rem 1.5rem',
                borderRadius: '12px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(15, 23, 42, 0.2)'
              }}
            >
              <UserPlus size={18} color="#d4af37" />
              <span>Nuevo Usuario de Sistema</span>
            </button>
          </div>

          {/* Users Table */}
          <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  <th style={{ padding: '1rem 1.5rem' }}>Usuario</th>
                  <th style={{ padding: '1rem 1.5rem' }}>Email / Login</th>
                  <th style={{ padding: '1rem 1.5rem' }}>Rol Asignado</th>
                  <th style={{ padding: '1rem 1.5rem' }}>Sucursal</th>
                  <th style={{ padding: '1rem 1.5rem' }}>Última Actividad</th>
                  <th style={{ padding: '1rem 1.5rem', textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const empresa = salons.find(s => String(s.id) === String(u.salon_id));
                  return (
                    <tr key={u.id} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s' }}>
                      <td style={{ padding: '1rem 1.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <div style={{
                            width: '40px', height: '40px', borderRadius: '50%',
                            background: '#0f172a', color: '#fbbf24', display: 'flex',
                            alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.95rem'
                          }}>
                            {u.nombre ? u.nombre.charAt(0).toUpperCase() : 'U'}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, color: '#0f172a' }}>{u.nombre}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.72rem', color: '#64748b' }}>ID: {u.id}</span>
                              {u.staff_nombre ? (
                                <span style={{
                                  fontSize: '0.7rem',
                                  padding: '0.15rem 0.45rem',
                                  borderRadius: '6px',
                                  background: '#ecfdf5',
                                  color: '#047857',
                                  fontWeight: 600,
                                  border: '1px solid #a7f3d0'
                                }}>
                                  👤 {u.staff_nombre} ({u.staff_posicion || 'Empleado'})
                                </span>
                              ) : (
                                <span style={{
                                  fontSize: '0.7rem',
                                  padding: '0.15rem 0.45rem',
                                  borderRadius: '6px',
                                  background: '#f1f5f9',
                                  color: '#64748b',
                                  fontWeight: 500,
                                  border: '1px solid #e2e8f0'
                                }}>
                                  🖥️ Cuenta de Sistema
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '1rem 1.5rem', color: '#334155', fontWeight: 500 }}>
                        {u.email}
                      </td>
                      <td style={{ padding: '1rem 1.5rem' }}>
                        <span style={{
                          background: u.role_name === 'Administrador' ? 'rgba(212,175,55,0.15)' : 'rgba(59,130,246,0.1)',
                          color: u.role_name === 'Administrador' ? '#b45309' : '#2563eb',
                          padding: '0.25rem 0.65rem',
                          borderRadius: '8px',
                          fontWeight: 700,
                          fontSize: '0.8rem',
                          display: 'inline-block'
                        }}>
                          {u.role_name || 'Sin Rol'}
                        </span>
                      </td>
                      <td style={{ padding: '1rem 1.5rem', color: '#64748b', fontSize: '0.85rem' }}>
                        {(() => {
                          if (String(u.role || '').toLowerCase() === 'kiosco_asistencia') {
                            return empresa ? `🖥️ ${empresa.name || empresa.nombre}` : '🖥️ Sin sucursal';
                          }
                          if (u.all_branches_access) return '🌐 Todas las sucursales';
                          const extraIds = parseAuthorizedBranches(u.authorized_branch_ids, u.branch_id || u.salon_id);
                          const baseName = empresa ? (empresa.name || empresa.nombre) : 'Sin asignar';
                          return extraIds.length > 1 ? `📍 ${baseName} (+${extraIds.length - 1})` : `📍 ${baseName}`;
                        })()}
                      </td>
                      <td style={{ padding: '1rem 1.5rem', color: '#64748b', fontSize: '0.85rem' }}>
                        {u.last_login ? new Date(u.last_login).toLocaleString('es-DO') : 'Nunca'}
                      </td>
                      <td style={{ padding: '1rem 1.5rem', textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                          <button
                            onClick={() => startEditUser(u)}
                            style={{
                              padding: '0.5rem',
                              borderRadius: '8px',
                              border: '1px solid #e2e8f0',
                              background: '#ffffff',
                              color: '#3b82f6',
                              cursor: 'pointer'
                            }}
                            title="Editar usuario"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleDeleteUser(u)}
                            style={{
                              padding: '0.5rem',
                              borderRadius: '8px',
                              border: '1px solid #fee2e2',
                              background: '#fff1f2',
                              color: '#ef4444',
                              cursor: 'pointer'
                            }}
                            title="Eliminar usuario y cerrar sesiones"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                      No se encontraron usuarios del sistema con ese criterio.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: ROLES Y PERMISOS */}
      {activeTab === 'roles' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, fontWeight: 800, color: '#0f172a' }}>Perfiles y Matriz de Permisos</h3>
              <p style={{ margin: '0.25rem 0 0 0', color: '#64748b', fontSize: '0.85rem' }}>
                Configura los accesos por pantalla y funciones operativas para cada rol.
              </p>
            </div>
            {canManageRoles && (
              <button
                onClick={() => {
                  setEditingRole(null);
                  setRoleSaveError('');
                  setRoleDirty(false);
                  setRoleForm({ nombre: '', permisos: {} });
                  setShowRoleModal(true);
                }}
                style={{
                  background: '#0f172a',
                  color: '#ffffff',
                  border: 'none',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '12px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer'
                }}
              >
                <Key size={18} color="#d4af37" />
                <span>Crear Nuevo Rol</span>
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.5rem' }}>
            {roles.map(r => {
              let perms = {};
              if (typeof r.permisos === 'string') {
                try { perms = JSON.parse(r.permisos); } catch (e) { perms = {}; }
              } else if (typeof r.permisos === 'object' && r.permisos !== null) {
                perms = r.permisos;
              }
              const activeCount = Object.values(perms).filter(Boolean).length;

              return (
                <div key={r.id} style={{
                  background: '#ffffff',
                  borderRadius: '16px',
                  border: '1px solid #e2e8f0',
                  padding: '1.5rem',
                  boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between'
                }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <span style={{
                        background: 'rgba(15, 23, 42, 0.06)',
                        color: '#0f172a',
                        fontWeight: 800,
                        fontSize: '1.1rem',
                        padding: '0.35rem 0.75rem',
                        borderRadius: '8px'
                      }}>
                        {r.nombre}
                      </span>
                      <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
                        {activeCount} permisos activos
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '1.5rem' }}>
                      {Object.keys(perms).map(k => perms[k] && (
                        <span key={k} style={{
                          background: '#f1f5f9',
                          color: '#334155',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          padding: '0.2rem 0.5rem',
                          borderRadius: '6px'
                        }}>
                          {k}
                        </span>
                      ))}
                      {activeCount === 0 && (
                        <span style={{ color: '#94a3b8', fontSize: '0.8rem', fontStyle: 'italic' }}>Sin permisos específicos asignados</span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', paddingTop: '1rem', borderTop: '1px solid #f1f5f9' }}>
                    <button
                      onClick={() => startEditRole(r)}
                      disabled={!canManageRoles}
                      style={{
                        flex: 1,
                        background: canManageRoles ? '#0f172a' : '#94a3b8',
                        color: '#ffffff',
                        border: 'none',
                        padding: '0.65rem',
                        borderRadius: '8px',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.4rem',
                        cursor: canManageRoles ? 'pointer' : 'not-allowed'
                      }}
                    >
                      <Sliders size={15} color="#d4af37" />
                      <span>Configurar Permisos</span>
                    </button>
                    {canManageRoles && (
                      <button
                        type="button"
                        onClick={() => handleDeleteRole(r)}
                        title={Number(r.assigned_users_count || 0) > 0 ? `En uso por ${r.assigned_users_count} usuario(s)` : 'Eliminar rol'}
                        style={{
                          background: '#fef2f2',
                          color: '#dc2626',
                          border: '1px solid #fecaca',
                          padding: '0.65rem 0.8rem',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: MONITOREO EN TIEMPO REAL (SESIONES Y AUDITORÍA) */}
      {activeTab === 'monitoring' && (
        <div>
          {/* Active Sessions Overview */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, fontWeight: 800, color: '#0f172a' }}>
                🟢 Sesiones Activas en el Sistema ({activeSessions.length})
              </h3>
              <p style={{ margin: '0.25rem 0 0 0', color: '#64748b', fontSize: '0.85rem' }}>
                Usuarios conectados actualmente con rastreo de IP, dispositivo y opción de desconexión forzada.
              </p>
            </div>
            <button
              onClick={refreshSessions}
              disabled={refreshingSessions}
              style={{
                background: '#f1f5f9',
                border: '1px solid #cbd5e1',
                padding: '0.6rem 1rem',
                borderRadius: '10px',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              <RefreshCw size={14} className={refreshingSessions ? 'animate-spin' : ''} />
              <span>Refrescar Sesiones</span>
            </button>
          </div>

          {/* Sessions Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1.25rem', marginBottom: '2.5rem' }}>
            {activeSessions.map((sess) => (
              <div key={sess.id} style={{
                background: '#ffffff',
                borderRadius: '16px',
                border: '1px solid #e2e8f0',
                padding: '1.25rem',
                boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <div style={{
                        width: '36px', height: '36px', borderRadius: '50%',
                        background: '#0f172a', color: '#34d399', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', fontWeight: 800
                      }}>
                        {sess.user_name ? sess.user_name.charAt(0).toUpperCase() : 'U'}
                      </div>
                      <div>
                        <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.95rem' }}>{sess.user_name}</div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{sess.role}</div>
                      </div>
                    </div>

                    <span style={{
                      background: 'rgba(16, 185, 129, 0.15)',
                      color: '#059669',
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      padding: '0.2rem 0.5rem',
                      borderRadius: '999px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem'
                    }}>
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#10b981' }} />
                      En Línea
                    </span>
                  </div>

                  <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: '10px', fontSize: '0.8rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Globe size={14} color="#3b82f6" />
                      <span><b>IP:</b> {sess.ip_address}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Laptop size={14} color="#8b5cf6" />
                      <span><b>Dispositivo:</b> {sess.device_info || 'Navegador Web'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <MapPin size={14} color="#f59e0b" />
                      <span><b>Sucursal:</b> {sess.salon_name || 'Global'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Clock size={14} color="#10b981" />
                      <span><b>Última actividad:</b> {new Date(sess.last_activity).toLocaleTimeString('es-DO')}</span>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid #f1f5f9' }}>
                  <button
                    onClick={() => handleTerminateSession(sess)}
                    style={{
                      width: '100%',
                      background: '#fee2e2',
                      color: '#b91c1c',
                      border: '1px solid #fca5a5',
                      padding: '0.5rem',
                      borderRadius: '8px',
                      fontWeight: 700,
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.4rem',
                      cursor: 'pointer'
                    }}
                  >
                    <LogOut size={14} />
                    <span>Desconectar Sesión Remotamente</span>
                  </button>
                </div>
              </div>
            ))}
            {activeSessions.length === 0 && (
              <div style={{ gridColumn: '1 / -1', padding: '2rem', textAlign: 'center', background: '#f8fafc', borderRadius: '12px', color: '#64748b' }}>
                No hay sesiones activas registradas en este momento.
              </div>
            )}
          </div>

          {/* Audit Logs Table */}
          <div>
            <h3 style={{ margin: '0 0 1rem 0', fontWeight: 800, color: '#0f172a' }}>
              📜 Registro de Trazabilidad y Auditoría de Seguridad
            </h3>
            <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                    <th style={{ padding: '0.85rem 1.25rem' }}>Fecha / Hora</th>
                    <th style={{ padding: '0.85rem 1.25rem' }}>Usuario</th>
                    <th style={{ padding: '0.85rem 1.25rem' }}>Acción</th>
                    <th style={{ padding: '0.85rem 1.25rem' }}>Detalles</th>
                    <th style={{ padding: '0.85rem 1.25rem' }}>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.75rem 1.25rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                        {new Date(log.created_at).toLocaleString('es-DO')}
                      </td>
                      <td style={{ padding: '0.75rem 1.25rem', fontWeight: 700, color: '#0f172a' }}>
                        {log.user_name || 'Sistema'}
                      </td>
                      <td style={{ padding: '0.75rem 1.25rem' }}>
                        <span style={{
                          background: log.action.includes('BLOCKED') || log.action.includes('DELETE') ? '#fee2e2' : '#eff6ff',
                          color: log.action.includes('BLOCKED') || log.action.includes('DELETE') ? '#b91c1c' : '#1d4ed8',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '6px',
                          fontWeight: 700,
                          fontSize: '0.75rem'
                        }}>
                          {log.action}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1.25rem', color: '#334155' }}>
                        {log.details}
                      </td>
                      <td style={{ padding: '0.75rem 1.25rem', color: '#64748b', fontFamily: 'monospace' }}>
                        {log.ip_address}
                      </td>
                    </tr>
                  ))}
                  {auditLogs.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                        No hay eventos de auditoría registrados aún.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: INTENTOS DE ACCESO Y BLOQUEOS */}
      {activeTab === 'access_control' && (
        <div>
          {/* Blocked IPs Alert / Cards */}
          <div style={{ marginBottom: '2rem' }}>
            <h3 style={{ margin: '0 0 1rem 0', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShieldAlert size={22} color="#ef4444" />
              <span>Direcciones IP Bloqueadas por Fuerza Bruta ({blockedIps.length})</span>
            </h3>

            {blockedIps.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
                {blockedIps.map((b) => (
                  <div key={b.id} style={{
                    background: '#fff1f2',
                    border: '1px solid #fecdd3',
                    borderRadius: '14px',
                    padding: '1.25rem',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between'
                  }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{ fontWeight: 900, color: '#9f1239', fontSize: '1.1rem', fontFamily: 'monospace' }}>
                          {b.ip_address}
                        </span>
                        <span style={{ background: '#f43f5e', color: '#ffffff', fontSize: '0.7rem', fontWeight: 800, padding: '0.2rem 0.5rem', borderRadius: '999px' }}>
                          BLOQUEADA
                        </span>
                      </div>
                      <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#881337' }}>
                        <b>Motivo:</b> {b.reason}
                      </p>
                      <p style={{ margin: 0, fontSize: '0.75rem', color: '#9f1239' }}>
                        Bloqueo vigente hasta: {b.blocked_until ? new Date(b.blocked_until).toLocaleString('es-DO') : 'Indefinido'}
                      </p>
                    </div>

                    <button
                      onClick={() => handleUnblockIp(b.ip_address)}
                      style={{
                        marginTop: '1rem',
                        background: '#ffffff',
                        color: '#059669',
                        border: '1px solid #a7f3d0',
                        padding: '0.5rem',
                        borderRadius: '8px',
                        fontWeight: 700,
                        fontSize: '0.8rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.4rem',
                        cursor: 'pointer'
                      }}
                    >
                      <Unlock size={14} />
                      <span>Desbloquear IP Ahora</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', padding: '1.25rem', color: '#166534', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <CheckCircle2 size={20} color="#16a34a" />
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                  No hay direcciones IP bloqueadas actualmente. El sistema opera normalmente sin amenazas de fuerza bruta.
                </span>
              </div>
            )}
          </div>

          {/* Login Attempts Tracker */}
          <div>
            <h3 style={{ margin: '0 0 1rem 0', fontWeight: 800, color: '#0f172a' }}>
              🔍 Historial Reciente de Intentos de Inicio de Sesión
            </h3>
            <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                    <th style={{ padding: '0.85rem 1.25rem' }}>Fecha / Hora</th>
                    <th style={{ padding: '0.85rem 1.25rem' }}>Usuario / Cédula Intentado</th>
                    <th style={{ padding: '0.85rem 1.25rem' }}>Dirección IP</th>
                    <th style={{ padding: '0.85rem 1.25rem' }}>Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {loginAttempts.map((att) => (
                    <tr key={att.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.75rem 1.25rem', color: '#64748b' }}>
                        {new Date(att.attempt_time).toLocaleString('es-DO')}
                      </td>
                      <td style={{ padding: '0.75rem 1.25rem', fontWeight: 600, color: '#0f172a' }}>
                        {att.email_or_cedula}
                      </td>
                      <td style={{ padding: '0.75rem 1.25rem', fontFamily: 'monospace', color: '#475569' }}>
                        {att.ip_address}
                      </td>
                      <td style={{ padding: '0.75rem 1.25rem' }}>
                        <span style={{
                          background: att.status === 'success' ? '#dcfce7' : (att.status === 'blocked' ? '#fee2e2' : '#fef3c7'),
                          color: att.status === 'success' ? '#15803d' : (att.status === 'blocked' ? '#b91c1c' : '#b45309'),
                          padding: '0.2rem 0.6rem',
                          borderRadius: '999px',
                          fontWeight: 800,
                          fontSize: '0.75rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem'
                        }}>
                          {att.status === 'success' && '✓ Exitoso'}
                          {att.status === 'failed' && '✕ Fallido'}
                          {att.status === 'blocked' && '🛑 Bloqueado'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {loginAttempts.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                        No hay registros de intentos de acceso.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: CONFIGURACIÓN DE SEGURIDAD & PIN MULTI-CORREO */}
      {activeTab === 'pin_settings' && (
        <div style={{ maxWidth: '840px' }}>
          <div style={{ background: '#ffffff', borderRadius: '18px', border: '1px solid #e2e8f0', padding: '2rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', paddingBottom: '1.25rem', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ background: 'rgba(212,175,55,0.15)', color: '#b45309', padding: '0.75rem', borderRadius: '12px' }}>
                <Lock size={28} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontWeight: 900, color: '#0f172a', fontSize: '1.25rem' }}>
                  Políticas de Seguridad & PIN Multi-Destinatario
                </h3>
                <p style={{ margin: '0.25rem 0 0 0', color: '#64748b', fontSize: '0.85rem' }}>
                  Gestiona las reglas de bloqueo por fuerza bruta y los correos autorizados para recibir el código PIN de seguridad de doble factor.
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveSecuritySettings}>
              {/* Notification emails */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontWeight: 700, color: '#1e293b', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                  📧 Lista de Correos para Notificación de PIN de Seguridad (Separados por coma)
                </label>
                <textarea
                  rows={3}
                  value={securitySettings.pin_notification_emails}
                  onChange={(e) => setSecuritySettings({ ...securitySettings, pin_notification_emails: e.target.value })}
                  placeholder="ejemplo: admin1@planbeautyrd.com, gerencia@empresa.com, seguridad@etereas.com"
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    borderRadius: '12px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.9rem',
                    fontFamily: 'sans-serif'
                  }}
                />
                <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                  Cuando alguien solicite un PIN de acceso o autorización, el sistema enviará un código OTP dinámico a <b>todos los correos listados aquí</b>.
                </p>
              </div>

              {/* Multi-Email Test Trigger Button */}
              <div style={{ marginBottom: '2rem', background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px dashed #cbd5e1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div>
                  <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.9rem' }}>Probar Envío de PIN a los Correos</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Genera un PIN OTP de prueba de 6 dígitos y lo envía inmediatamente a la lista.</div>
                </div>
                <button
                  type="button"
                  onClick={handleRequestPinByEmail}
                  disabled={sendingPin}
                  style={{
                    background: '#0f172a',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.6rem 1.25rem',
                    borderRadius: '10px',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem'
                  }}
                >
                  <Send size={15} color="#d4af37" />
                  <span>{sendingPin ? 'Enviando PIN...' : 'Enviar PIN de Prueba'}</span>
                </button>
              </div>

              {pinNotice && (
                <div style={{ marginBottom: '1.5rem', padding: '0.85rem 1rem', borderRadius: '10px', background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d', fontSize: '0.85rem', fontWeight: 600 }}>
                  ✓ {pinNotice}
                </div>
              )}

              {/* Lockout Parameters */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '1.5rem' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: 700, color: '#1e293b', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                    Máximo de Intentos Fallidos antes de Bloqueo
                  </label>
                  <input
                    type="number"
                    min={3}
                    max={20}
                    value={securitySettings.max_failed_attempts}
                    onChange={(e) => setSecuritySettings({ ...securitySettings, max_failed_attempts: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      borderRadius: '10px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.9rem'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontWeight: 700, color: '#1e293b', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                    Duración del Bloqueo Temporal (Minutos)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={1440}
                    value={securitySettings.lockout_minutes}
                    onChange={(e) => setSecuritySettings({ ...securitySettings, lockout_minutes: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      borderRadius: '10px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.9rem'
                    }}
                  />
                </div>
              </div>

              {/* Master PIN Update */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontWeight: 700, color: '#1e293b', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                  Cambiar PIN Maestro Fijo de Administrador (Opcional)
                </label>
                <input
                  type="password"
                  placeholder="Dejar en blanco para mantener el actual"
                  value={securitySettings.admin_pin}
                  onChange={(e) => setSecuritySettings({ ...securitySettings, admin_pin: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    borderRadius: '10px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.9rem'
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '1.5rem', borderTop: '1px solid #f1f5f9' }}>
                <button
                  type="submit"
                  disabled={savingSettings}
                  style={{
                    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.85rem 2rem',
                    borderRadius: '12px',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(15,23,42,0.2)'
                  }}
                >
                  {savingSettings ? 'Guardando...' : 'Guardar Configuración de Seguridad'}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* MODAL: CREAR / EDITAR USUARIO */}
      {showUserModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff', borderRadius: '20px', maxWidth: '520px', width: '100%',
            padding: '2rem', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', border: '1px solid #e2e8f0'
          }}>
            <h3 style={{ margin: '0 0 1.25rem 0', fontWeight: 900, color: '#0f172a', fontSize: '1.3rem' }}>
              {editingUser ? 'Editar Usuario del Sistema' : 'Crear Usuario de Sistema'}
            </h3>

            <form onSubmit={handleSaveUser}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 700, color: '#334155', marginBottom: '0.35rem', fontSize: '0.85rem' }}>
                  Nombre Completo
                </label>
                <input
                  type="text"
                  required
                  value={userForm.nombre}
                  onChange={(e) => setUserForm({ ...userForm, nombre: e.target.value })}
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1' }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 700, color: '#334155', marginBottom: '0.35rem', fontSize: '0.85rem' }}>
                  Correo Electrónico (Login)
                </label>
                <input
                  type="email"
                  required
                  value={userForm.email}
                  onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1' }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 700, color: '#334155', marginBottom: '0.35rem', fontSize: '0.85rem' }}>
                  {editingUser ? 'Contraseña (Dejar en blanco para no cambiarla)' : 'Contraseña de Acceso'}
                </label>
                <input
                  type="password"
                  required={!editingUser}
                  value={userForm.password}
                  onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: 700, color: '#334155', marginBottom: '0.35rem', fontSize: '0.85rem' }}>
                    Rol Asignado
                  </label>
                  <select
                    value={userForm.role_id}
                    onChange={(e) => {
                      const nextRoleId = e.target.value;
                      const isKioskNext = nextRoleId === '__KIOSK_RESERVED__';
                      setUserForm(prev => ({
                        ...prev,
                        role_id: nextRoleId,
                        all_branches_access: isKioskNext ? false : prev.all_branches_access,
                        authorized_branch_ids: isKioskNext
                          ? (prev.salon_id ? [String(prev.salon_id)] : [])
                          : prev.authorized_branch_ids,
                      }));
                    }}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      borderRadius: '10px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#0f172a',
                      fontWeight: 600,
                      fontSize: '0.9rem',
                      cursor: 'pointer'
                    }}
                  >
                    <option value="__KIOSK_RESERVED__" style={{ color: '#047857', background: '#ecfdf5', fontWeight: 800 }}>
                      🖥️ Kiosco de Asistencia (Sin licencia)
                    </option>
                    {(roles || []).map(r => (
                      <option key={r.id} value={r.id} style={{ color: '#0f172a', background: '#ffffff' }}>
                        {r.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontWeight: 700, color: '#334155', marginBottom: '0.35rem', fontSize: '0.85rem' }}>
                    {userForm.role_id === '__KIOSK_RESERVED__' ? 'Sucursal del Kiosco (Obligatoria)' : 'Sucursal Principal'}
                  </label>
                  <select
                    required={userForm.role_id === '__KIOSK_RESERVED__' || !userForm.all_branches_access}
                    value={userForm.salon_id || ''}
                    onChange={(e) => {
                      const nextPrimary = e.target.value;
                      setUserForm(prev => {
                        const isKiosk = prev.role_id === '__KIOSK_RESERVED__';
                        const nextAuth = isKiosk
                          ? (nextPrimary ? [String(nextPrimary)] : [])
                          : Array.from(new Set([...(prev.authorized_branch_ids || []).map(String), ...(nextPrimary ? [String(nextPrimary)] : [])]));
                        return { ...prev, salon_id: nextPrimary, authorized_branch_ids: nextAuth };
                      });
                    }}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      borderRadius: '10px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#0f172a',
                      fontWeight: 600,
                      fontSize: '0.9rem',
                      cursor: 'pointer'
                    }}
                  >
                    <option value="" disabled={userForm.role_id === '__KIOSK_RESERVED__'} style={{ color: '#64748b' }}>
                      -- Seleccionar sucursal --
                    </option>
                    {(salons || [])
                      .filter(s => s && (s.name || s.nombre) && String(s.name || s.nombre).trim() !== '')
                      .map(s => (
                        <option key={s.id} value={String(s.id)} style={{ color: '#0f172a', background: '#ffffff', fontWeight: 600 }}>
                          📍 {s.name || s.nombre}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {/* Alcance Multi-Sucursal (solo roles operativos/administrativos, nunca Kiosco) */}
              {userForm.role_id !== '__KIOSK_RESERVED__' && (
                <div style={{ marginBottom: '1.25rem', background: '#f8fafc', padding: '0.95rem 1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.84rem' }}>
                      📍 Sucursales Autorizadas
                    </span>
                    {isCurrentUserOwner && (
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', fontWeight: 700, color: '#0f172a', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(userForm.all_branches_access)}
                          onChange={(e) => setUserForm(prev => ({ ...prev, all_branches_access: e.target.checked }))}
                        />
                        <span>🌐 Acceso a todas las sucursales</span>
                      </label>
                    )}
                  </div>

                  {userForm.all_branches_access ? (
                    <div style={{ fontSize: '0.78rem', color: '#0369a1', fontWeight: 600 }}>
                      Este usuario podrá operar en todas las sucursales activas de la empresa. Cambiar este alcance cerrará sus sesiones abiertas.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {(salons || [])
                        .filter(s => s && (s.name || s.nombre))
                        .map(s => {
                          const sid = String(s.id);
                          const isPrimary = String(userForm.salon_id || '') === sid;
                          const isChecked = isPrimary || (userForm.authorized_branch_ids || []).map(String).includes(sid);
                          return (
                            <label
                              key={sid}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                padding: '0.35rem 0.65rem',
                                borderRadius: '8px',
                                border: isChecked ? '1px solid #0f172a' : '1px solid #cbd5e1',
                                background: isChecked ? '#eef2ff' : '#ffffff',
                                fontSize: '0.78rem',
                                fontWeight: isPrimary ? 800 : 600,
                                color: '#0f172a',
                                cursor: isPrimary ? 'not-allowed' : 'pointer',
                                opacity: isPrimary ? 0.9 : 1,
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={isPrimary}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setUserForm(prev => {
                                    const current = (prev.authorized_branch_ids || []).map(String);
                                    const updated = checked
                                      ? Array.from(new Set([...current, sid]))
                                      : current.filter(id => id !== sid);
                                    return { ...prev, authorized_branch_ids: updated };
                                  });
                                }}
                              />
                              <span>{s.name || s.nombre}{isPrimary ? ' (Principal)' : ''}</span>
                            </label>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}

              {userForm.role_id === '__KIOSK_RESERVED__' && (
                <div style={{
                  marginTop: '-0.75rem',
                  marginBottom: '1.25rem',
                  padding: '0.75rem 1rem',
                  borderRadius: '10px',
                  background: '#ecfdf5',
                  border: '1px solid #10b981',
                  color: '#065f46',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                }}>
                  ✅ Este usuario no consume licencia. Sus permisos son fijos y exclusivos para el Kiosco de Asistencia de la sucursal asignada (sin acceso al panel administrativo ni operativo).
                </div>
              )}

              {/* Selector de vinculación opcional a Empleado / Colaborador */}
              <div style={{ marginBottom: '1.5rem', background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                  <label style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Users size={16} color="#475569" />
                    Vincular a Colaborador / Empleado
                  </label>
                  <span style={{ fontSize: '0.72rem', background: '#e2e8f0', color: '#475569', padding: '0.1rem 0.45rem', borderRadius: '6px', fontWeight: 600 }}>
                    Opcional
                  </span>
                </div>
                
                <select
                  value={userForm.staff_id || ''}
                  onChange={(e) => {
                    const selId = e.target.value;
                    const matchedStaff = staffList.find(st => String(st.id) === String(selId));
                    setUserForm(prev => ({
                      ...prev,
                      staff_id: selId,
                      nombre: (!prev.nombre.trim() && matchedStaff) ? matchedStaff.nombre : prev.nombre
                    }));
                  }}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    borderRadius: '10px',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#0f172a',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    cursor: 'pointer'
                  }}
                >
                  <option value="">-- Ninguno (Usuario independiente de sistema) --</option>
                  {staffList
                    .filter(st => st.estado !== 'inactivo')
                    .map(st => (
                      <option key={st.id} value={st.id}>
                        👤 {st.nombre} — {st.posicion || 'Colaborador'} {st.cedula ? `(Cédula: ${st.cedula})` : ''}
                      </option>
                    ))}
                </select>

                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.75rem', color: '#64748b', lineHeight: 1.4 }}>
                  🔒 <strong>Separación estricta de cuentas:</strong> Las credenciales de login y roles pertenecen exclusivamente al sistema de acceso. Vincular o editar este usuario <strong>NUNCA</strong> altera la nómina, el expediente de Recursos Humanos ni duplica registros de colaboradores.
                </p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => setShowUserModal(false)}
                  style={{
                    padding: '0.75rem 1.25rem', borderRadius: '10px', border: '1px solid #cbd5e1',
                    background: '#f8fafc', color: '#475569', fontWeight: 600, cursor: 'pointer'
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '0.75rem 1.5rem', borderRadius: '10px', border: 'none',
                    background: '#0f172a', color: '#ffffff', fontWeight: 700, cursor: 'pointer'
                  }}
                >
                  {editingUser ? 'Actualizar Usuario' : 'Crear Usuario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CONFIGURAR ROL Y MATRIZ DE PERMISOS */}
      {showRoleModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff', borderRadius: '20px', maxWidth: '780px', width: '100%',
            padding: '2rem', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '0.75rem', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontWeight: 900, color: '#0f172a', fontSize: '1.3rem' }}>
                {editingRole ? `Configurar Permisos: ${editingRole.nombre}` : 'Crear Nuevo Rol'}
              </h3>
              {roleDirty && (
                <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '0.25rem 0.65rem', borderRadius: '999px', background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}>
                  Cambios sin guardar
                </span>
              )}
            </div>

            {roleSaveError && (
              <div role="alert" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: '10px', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '0.85rem', fontWeight: 600 }}>
                {roleSaveError}
              </div>
            )}

            <form onSubmit={handleSaveRole}>
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontWeight: 700, color: '#334155', marginBottom: '0.35rem', fontSize: '0.85rem' }}>
                  Nombre del Rol
                </label>
                <input
                  type="text"
                  required
                  value={roleForm.nombre}
                  onChange={(e) => {
                    setRoleDirty(true);
                    setRoleSaveError('');
                    setRoleForm({ ...roleForm, nombre: e.target.value });
                  }}
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                />
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <h4 style={{ margin: 0, color: '#0f172a', fontWeight: 800 }}>
                    Matriz Canónica de Permisos por Módulo y Acción
                  </h4>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={handleSelectAllDelegable}
                      style={{ padding: '0.35rem 0.7rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#0f172a', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
                    >
                      Seleccionar todos (delegables)
                    </button>
                    <button
                      type="button"
                      onClick={handleClearRolePerms}
                      style={{ padding: '0.35rem 0.7rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#64748b', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Limpiar
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {catalogModules.map((mod, idx) => (
                    <div key={mod.module || idx} style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.9rem', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {mod.label}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.65rem' }}>
                        {(mod.permissions || []).map(p => {
                          const isChecked = Boolean(roleForm.permisos[p.key] || (p.legacyKey && roleForm.permisos[p.legacyKey]));
                          const delegable = canDelegatePermKey(p.key);
                          return (
                            <label
                              key={p.key}
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '0.5rem',
                                fontSize: '0.82rem',
                                color: isChecked ? '#0f172a' : '#64748b',
                                fontWeight: isChecked ? 700 : 500,
                                cursor: delegable ? 'pointer' : 'not-allowed',
                                opacity: delegable ? 1 : 0.55,
                                background: isChecked ? '#ffffff' : 'transparent',
                                padding: '0.55rem 0.75rem',
                                borderRadius: '8px',
                                border: isChecked ? '1px solid #cbd5e1' : '1px solid transparent'
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={!delegable}
                                onChange={() => togglePermission(p)}
                                style={{ accentColor: '#0f172a', width: '16px', height: '16px', marginTop: '2px' }}
                              />
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <span>{p.label}</span>
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: '0.68rem', padding: '1px 5px', borderRadius: '4px', background: '#e2e8f0', color: '#334155', fontWeight: 700 }}>
                                    {ACTION_LABELS[p.action] || p.action}
                                  </span>
                                  {p.requiresAddon && (
                                    <span style={{ fontSize: '0.68rem', padding: '1px 5px', borderRadius: '4px', background: '#fef3c7', color: '#92400e', fontWeight: 700 }}>
                                      Add-on: {p.requiresAddon}
                                    </span>
                                  )}
                                  {p.dependsOn?.length > 0 && (
                                    <span style={{ fontSize: '0.68rem', color: '#64748b' }}>
                                      Requiere consulta
                                    </span>
                                  )}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '1rem', borderTop: '1px solid #f1f5f9' }}>
                <button
                  type="button"
                  onClick={() => {
                    if (roleDirty && !window.confirm('Tienes cambios sin guardar. ¿Seguro que deseas cerrar?')) return;
                    setShowRoleModal(false);
                    setRoleDirty(false);
                  }}
                  style={{
                    padding: '0.75rem 1.25rem', borderRadius: '10px', border: '1px solid #cbd5e1',
                    background: '#f8fafc', color: '#475569', fontWeight: 600, cursor: 'pointer'
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '0.75rem 1.5rem', borderRadius: '10px', border: 'none',
                    background: '#0f172a', color: '#ffffff', fontWeight: 700, cursor: 'pointer'
                  }}
                >
                  Guardar Rol y Permisos
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
