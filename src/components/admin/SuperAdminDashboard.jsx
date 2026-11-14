import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Users, Layers, ShieldCheck, Plus, CheckCircle2,
  XCircle, ToggleLeft, ToggleRight, Search, RefreshCw, Sparkles,
  Store, AlertCircle, FileText, Database, ArrowUpRight, DollarSign,
  Package, Crown, Check, X, Edit3, Settings, ShieldAlert, ChevronRight
} from 'lucide-react';
import { dataService } from '../../utils/dataService';

export default function SuperAdminDashboard({ initialTab = 'tenants' }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(initialTab || 'tenants'); // 'tenants' | 'plans' | 'invoices' | 'branches' | 'contacts'

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);
  const [metrics, setMetrics] = useState({
    total_tenants: 0,
    active_tenants: 0,
    suspended_tenants: 0,
    total_branches: 0,
    total_users: 0,
    mrr: 0,
    mrr_by_currency: {}
  });
  const [tenants, setTenants] = useState([]);
  const [plans, setPlans] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [branches, setBranches] = useState([]);
  const [contactMessages, setContactMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [actionMessage, setActionMessage] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  // Filtros y paginación
  const [tenantPage, setTenantPage] = useState(1);
  const [subStatusFilter, setSubStatusFilter] = useState('all');
  const [invStatusFilter, setInvStatusFilter] = useState('all');
  const [billingSearch, setBillingSearch] = useState('');
  const [subPage, setSubPage] = useState(1);
  const [invPage, setInvPage] = useState(1);
  const [branchPage, setBranchPage] = useState(1);
  const [contactSearch, setContactSearch] = useState('');
  const [contactPage, setContactPage] = useState(1);
  const [addonRequests, setAddonRequests] = useState([]);
  const PAGE_SIZE = 10;

  // Modales
  const [isNewTenantModalOpen, setIsNewTenantModalOpen] = useState(false);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [isLicensingModalOpen, setIsLicensingModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const [selectedTenantForLicense, setSelectedTenantForLicense] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null); // { title, description, requireReason, reason, onConfirm }
  const [graceModal, setGraceModal] = useState(null); // { tenantId, businessName, additionalDays, reason }

  // Formulario nuevo salón
  const [tenantFormData, setTenantFormData] = useState({
    business_name: '',
    legal_name: '',
    rnc: '',
    slug: '',
    email: '',
    phone: '',
    currency: 'DOP',
    plan_id: '',
    licensed_branches: 1,
    extra_user_seats: 0,
    has_memberships: false,
    has_dgii_ecf: false,
    owner_name: '',
    owner_password: ''
  });

  // Formulario constructor de planes
  const [planFormData, setPlanFormData] = useState({
    name: '',
    code: '',
    description: '',
    price_per_branch: 49.00,
    users_per_branch: 3,
    extra_user_price: 15.00,
    billing_cycle: 'monthly',
    is_public: true,
    is_active: true,
    included_features: {
      pos: true,
      inventory: true,
      payroll: true,
      attendance: true,
      dgii_ecf: true,
      reports: true,
      services_catalog: true,
      clients: true,
      cash_registers: true,
      memberships: false // Desacoplado por defecto, Add-on
    }
  });

  const fetchData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [mRes, tRes, pRes, sRes, iRes, bRes, cRes, arRes] = await Promise.allSettled([
        dataService.getSaasMetrics(),
        dataService.getSaasTenants(),
        dataService.getSaasPlans(false),
        dataService.getSaasPlatformSubscriptions(),
        dataService.getSaasPlatformInvoices(),
        dataService.getSaasBranches(),
        dataService.getContactMessages(),
        dataService.getSaasAddonRequests()
      ]);

      const failures = [];
      if (mRes.status === 'fulfilled' && mRes.value) setMetrics(mRes.value);
      else if (mRes.status === 'rejected') failures.push(`Métricas: ${mRes.reason?.message}`);

      if (tRes.status === 'fulfilled' && Array.isArray(tRes.value)) setTenants(tRes.value);
      else if (tRes.status === 'rejected') failures.push(`Salones: ${tRes.reason?.message}`);

      if (pRes.status === 'fulfilled' && Array.isArray(pRes.value)) setPlans(pRes.value);
      else if (pRes.status === 'rejected') failures.push(`Planes: ${pRes.reason?.message}`);

      if (sRes.status === 'fulfilled') setSubscriptions(Array.isArray(sRes.value?.subscriptions) ? sRes.value.subscriptions : []);
      else if (sRes.status === 'rejected') failures.push(`Suscripciones: ${sRes.reason?.message}`);

      if (iRes.status === 'fulfilled') setInvoices(Array.isArray(iRes.value?.invoices) ? iRes.value.invoices : []);
      else if (iRes.status === 'rejected') failures.push(`Facturas: ${iRes.reason?.message}`);

      if (bRes.status === 'fulfilled') setBranches(Array.isArray(bRes.value?.branches) ? bRes.value.branches : []);
      else if (bRes.status === 'rejected') failures.push(`Sedes: ${bRes.reason?.message}`);

      if (cRes.status === 'fulfilled') setContactMessages(Array.isArray(cRes.value) ? cRes.value : (cRes.value?.messages || []));
      else if (cRes.status === 'rejected') failures.push(`Contactos: ${cRes.reason?.message}`);

      if (arRes.status === 'fulfilled') setAddonRequests(Array.isArray(arRes.value?.requests) ? arRes.value.requests : []);
      else if (arRes.status === 'rejected') failures.push(`Solicitudes Add-on: ${arRes.reason?.message}`);

      if (failures.length > 0) {
        setLoadError(failures.join(' | '));
      }
    } catch (err) {
      setLoadError(err.message || 'Error al cargar datos de SaaS');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const showNotification = (msg) => {
    setErrorMessage(null);
    setActionMessage(msg);
    setTimeout(() => setActionMessage(null), 4000);
  };

  const showError = (msg) => {
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(null), 6000);
  };

  // Toggle Add-on / Module
  const handleToggleModule = (tenantId, currentTenant, moduleName) => {
    const updatedValue = !currentTenant[moduleName];
    if (moduleName === 'has_memberships') {
      const tenantBranches = Array.isArray(currentTenant.tenant_branches) ? currentTenant.tenant_branches : [];
      const activeBranches = tenantBranches.filter(b => b.is_active !== false);
      const defaultSelectedIds = activeBranches.length > 0
        ? activeBranches.map(b => b.id)
        : tenantBranches.map(b => b.id);

      setConfirmModal({
        title: updatedValue ? 'Activar Add-on Suscripciones/Membresías' : 'Desactivar Add-on Suscripciones/Membresías',
        description: updatedValue
          ? `Se habilitará el add-on B2C (US$99/mes por sucursal habilitada) para "${currentTenant.business_name}".`
          : `Se desactivará el add-on B2C para "${currentTenant.business_name}". Los datos e historial se conservarán intactos.`,
        requireReason: true,
        reason: updatedValue ? 'Activación comercial desde Control Plane' : 'Desactivación desde Control Plane',
        branchOptions: updatedValue ? tenantBranches : null,
        selectedBranchIds: updatedValue ? defaultSelectedIds : [],
        onConfirm: async (reason, selectedBranchIds) => {
          const payload = {
            enabled: updatedValue,
            reason: reason || 'Cambio desde Control Plane',
            source: 'commercial_addon',
          };
          if (updatedValue && Array.isArray(tenantBranches) && tenantBranches.length > 0) {
            payload.branchIds = selectedBranchIds;
          }
          const res = await dataService.setTenantAddon(tenantId, 'memberships', payload);
          const addon = res?.addon || {};
          setTenants(prev => prev.map(row => (
            row.id === tenantId
              ? {
                  ...row,
                  has_memberships: Boolean(addon.active ?? updatedValue),
                  memberships_source: addon.source || (updatedValue ? 'commercial_addon' : 'none'),
                  memberships_reason: addon.reason || null,
                  memberships_expires_at: addon.expiresAt || null,
                  memberships_branch_ids: Array.isArray(addon.branchIds) ? addon.branchIds : [],
                  memberships_branches: Array.isArray(addon.branches) ? addon.branches : [],
                  memberships_enabled_branch_count: Number(addon.enabledBranchCount || 0),
                  memberships_is_legacy_transition: Boolean(addon.isLegacyTransition)
                }
              : row
          )));
          showNotification(`Add-on de Membresías ${addon.active ? 'activado' : 'desactivado'}.`);
          await fetchData();
        }
      });
      return;
    }

    (async () => {
      try {
        await dataService.updateTenantModules(tenantId, {
          modules_config: { dgii_ecf: updatedValue }
        });
        showNotification(`Módulo "${moduleName}" actualizado.`);
        setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, [moduleName]: updatedValue } : t));
      } catch (err) {
        showError(`Error al actualizar módulo: ${err.message}`);
      }
    })();
  };

  // Toggle Tenant Status with Confirmation Modal
  const handleToggleStatus = (tenantId, currentStatus, businessName) => {
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
    setConfirmModal({
      title: newStatus === 'suspended' ? `Suspender a "${businessName || 'Salón'}"` : `Reactivar a "${businessName || 'Salón'}"`,
      description: newStatus === 'suspended'
        ? 'La suscripción pasará a estado suspendido y bloqueará el acceso operativo del salón.'
        : 'La suscripción volverá a estado activo.',
      requireReason: true,
      reason: newStatus === 'suspended' ? 'Suspensión administrativa desde Control Plane' : 'Reactivación administrativa desde Control Plane',
      onConfirm: async (reason) => {
        await dataService.updateTenantStatus(tenantId, newStatus, reason);
        showNotification(`Estado del salón cambiado a "${newStatus}".`);
        fetchData();
      }
    });
  };

  // Ajuste rápido de sucursales autorizadas
  const handleAdjustBranches = async (tenant, delta) => {
    const newBranches = Math.max(1, (parseInt(tenant.licensed_branches, 10) || 1) + delta);
    try {
      const res = await dataService.updateTenantLicensing(tenant.id, { licensed_branches: newBranches });
      showNotification(`Licencias de sucursal de "${tenant.business_name}" actualizadas a ${newBranches}.`);
      setTenants(prev => prev.map(t => t.id === tenant.id ? {
        ...t,
        licensed_branches: res.licensed_branches ?? newBranches,
        max_branches: res.max_branches ?? newBranches,
        max_users: res.max_users ?? ((newBranches * (parseInt(t.plan_users_per_branch, 10) || 3)) + (parseInt(t.extra_user_seats, 10) || 0))
      } : t));
    } catch (err) {
      showError(`Error al ajustar sucursales: ${err.message}`);
    }
  };

  // Ajuste rápido de asientos extra de usuarios
  const handleAdjustSeats = async (tenant, delta) => {
    const newSeats = Math.max(0, (parseInt(tenant.extra_user_seats, 10) || 0) + delta);
    try {
      const res = await dataService.updateTenantLicensing(tenant.id, { extra_user_seats: newSeats });
      showNotification(`Asientos adicionales de "${tenant.business_name}" actualizados a ${newSeats}.`);
      setTenants(prev => prev.map(t => t.id === tenant.id ? {
        ...t,
        extra_user_seats: res.extra_user_seats ?? newSeats,
        max_users: res.max_users ?? (((parseInt(t.licensed_branches, 10) || 1) * (parseInt(t.plan_users_per_branch, 10) || 3)) + newSeats)
      } : t));
    } catch (err) {
      showError(`Error al ajustar asientos: ${err.message}`);
    }
  };

  // Cambiar Plan de un Inquilino
  const handleChangeTenantPlan = async (tenantId, newPlanId) => {
    try {
      await dataService.updateTenantLicensing(tenantId, { plan_id: parseInt(newPlanId) });
      const targetPlan = plans.find(p => p.id === parseInt(newPlanId));
      const isPro = targetPlan?.code === 'pro' || Boolean(targetPlan?.included_features?.memberships);
      showNotification(`Plan cambiado a "${targetPlan?.name || 'Nuevo Plan'}".`);
      setTenants(prev => prev.map(t => {
        if (t.id === tenantId) {
          const uPerBranch = parseInt(targetPlan?.users_per_branch) || 3;
          return {
            ...t,
            plan_id: targetPlan?.id,
            plan_name: targetPlan?.name,
            plan_code: targetPlan?.code,
            plan_users_per_branch: uPerBranch,
            plan_price_per_branch: targetPlan?.price_per_branch,
            plan_is_public: targetPlan?.is_public,
            has_memberships: isPro,
            max_allowed_users: ((parseInt(t.licensed_branches) || 1) * uPerBranch) + (parseInt(t.extra_user_seats) || 0)
          };
        }
        return t;
      }));
    } catch (err) {
      showError(`Error al cambiar plan: ${err.message}`);
    }
  };

  // Toggle Grandfathering / Disponibilidad Pública de un Plan
  const handleTogglePlanPublic = async (plan) => {
    const newPublicState = !plan.is_public;
    try {
      await dataService.updateSaasPlan(plan.id, { is_public: newPublicState });
      showNotification(
        newPublicState
          ? `Plan "${plan.name}" ahora está PÚBLICO para nuevos clientes.`
          : `Plan "${plan.name}" RETIRADO (Grandfathered). Los salones que ya lo contrataron lo conservan intacto.`
      );
      setPlans(prev => prev.map(p => p.id === plan.id ? { ...p, is_public: newPublicState } : p));
    } catch (err) {
      showError(`Error al cambiar disponibilidad del plan: ${err.message}`);
    }
  };

  // Crear o Editar Plan
  const handleSavePlan = async (e) => {
    e.preventDefault();
    if (!planFormData.name || !planFormData.code) {
      showError('Nombre y código único son requeridos.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingPlan) {
        await dataService.updateSaasPlan(editingPlan.id, planFormData);
        showNotification(`Plan "${planFormData.name}" actualizado con éxito.`);
      } else {
        await dataService.createSaasPlan(planFormData);
        showNotification(`Nuevo Plan "${planFormData.name}" creado con éxito.`);
      }
      setIsPlanModalOpen(false);
      setEditingPlan(null);
      fetchData();
    } catch (err) {
      showError(`Error al guardar plan: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Crear Nuevo Salón (Contrato canónico alineado con backend)
  const handleCreateTenant = async (e) => {
    e.preventDefault();
    if (!tenantFormData.business_name || !tenantFormData.email || !tenantFormData.owner_password) {
      showError('Por favor complete el nombre comercial, el correo electrónico y la contraseña.');
      return;
    }

    setIsSubmitting(true);
    try {
      await dataService.createSaasTenant({
        business_name: tenantFormData.business_name,
        slug: tenantFormData.slug || undefined,
        owner_name: tenantFormData.owner_name || 'Propietario',
        owner_email: tenantFormData.email,
        owner_phone: tenantFormData.phone || '',
        admin_password: tenantFormData.owner_password,
        rnc: tenantFormData.rnc || '',
        licensed_branches: parseInt(tenantFormData.licensed_branches, 10) || 1,
        extra_user_seats: parseInt(tenantFormData.extra_user_seats, 10) || 0,
        status: 'active'
      });
      showNotification('¡Salón creado exitosamente con Plan Principal!');
      setIsNewTenantModalOpen(false);
      setTenantFormData({
        business_name: '',
        legal_name: '',
        rnc: '',
        slug: '',
        email: '',
        phone: '',
        currency: 'DOP',
        plan_id: '',
        licensed_branches: 1,
        extra_user_seats: 0,
        has_memberships: false,
        has_dgii_ecf: false,
        owner_name: '',
        owner_password: ''
      });
      fetchData();
    } catch (err) {
      showError(`Error al crear salón: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitGraceExtension = async (e) => {
    e.preventDefault();
    if (!graceModal) return;
    setIsSubmitting(true);
    try {
      await dataService.extendSaasGracePeriod({
        tenantId: graceModal.tenantId,
        additionalDays: parseInt(graceModal.additionalDays, 10) || 5,
        reason: graceModal.reason
      });
      showNotification(`Período de gracia extendido para "${graceModal.businessName}".`);
      setGraceModal(null);
      fetchData();
    } catch (err) {
      showError(`Error al extender gracia: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditPlanModal = (plan) => {
    const rawFeatures = typeof plan.included_features === 'object' && plan.included_features !== null
      ? plan.included_features
      : {};
    const normalizedFeatures = {
      pos: true,
      inventory: true,
      payroll: true,
      attendance: true,
      dgii_ecf: true,
      reports: true,
      services_catalog: true,
      ...rawFeatures,
      cash_registers: Boolean(rawFeatures.cash_registers ?? rawFeatures.cajas ?? true),
      clients: Boolean(rawFeatures.clients ?? true),
      memberships: false
    };
    delete normalizedFeatures.cajas;

    setEditingPlan(plan);
    setPlanFormData({
      name: plan.name,
      code: plan.code,
      description: plan.description || '',
      price_per_branch: plan.price_per_branch ?? plan.price_monthly ?? plan.price ?? '',
      users_per_branch: parseInt(plan.users_per_branch, 10) || 3,
      extra_user_price: plan.extra_user_price ?? '',
      billing_cycle: plan.billing_cycle || 'monthly',
      is_public: Boolean(plan.is_public),
      is_active: Boolean(plan.is_active),
      included_features: normalizedFeatures
    });
    setIsPlanModalOpen(true);
  };

  const openNewPlanModal = () => {
    setEditingPlan(null);
    setPlanFormData({
      name: '',
      code: '',
      description: '',
      price_per_branch: 99.00,
      users_per_branch: 3,
      extra_user_price: 30.00,
      billing_cycle: 'monthly',
      is_public: true,
      is_active: true,
      included_features: {
        pos: true,
        inventory: true,
        payroll: true,
        attendance: true,
        dgii_ecf: true,
        reports: true,
        services_catalog: true,
        clients: true,
        cash_registers: true,
        memberships: false // Membresías desacoplado por defecto
      }
    });
    setIsPlanModalOpen(true);
  };

  const filteredTenants = tenants.filter(t =>
    t.business_name?.toLowerCase().includes(search.toLowerCase()) ||
    t.slug?.toLowerCase().includes(search.toLowerCase()) ||
    t.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1440px', margin: '0 auto', color: '#1e293b' }}>

      {/* Executive Hero Header */}
      <div style={{
        background: 'linear-gradient(135deg, #090d16 0%, #1e293b 100%)',
        borderRadius: '20px',
        padding: '2rem 2.25rem',
        color: '#ffffff',
        marginBottom: '2rem',
        boxShadow: '0 10px 30px -5px rgba(15, 23, 42, 0.35)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1.5rem',
        border: '1px solid rgba(255,255,255,0.08)'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
            <span style={{
              background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
              color: '#ffffff',
              padding: '0.25rem 0.65rem',
              borderRadius: '6px',
              fontSize: '0.72rem',
              fontWeight: '800',
              letterSpacing: '0.05em'
            }}>
              SUPERADMIN PLATAFORMA SAAS
            </span>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: 'rgba(16,185,129,0.15)',
              border: '1px solid rgba(16,185,129,0.3)',
              color: '#34d399',
              fontSize: '0.78rem',
              fontWeight: '700',
              padding: '0.2rem 0.6rem',
              borderRadius: '6px'
            }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 8px #10b981' }}></span>
              PostgreSQL 16 Activo
            </span>
          </div>
          <h1 style={{ fontSize: '1.85rem', fontWeight: '900', margin: '0.2rem 0 0', color: '#ffffff', letterSpacing: '-0.02em' }}>
            Control Central SaaS, Planes & Licencias
          </h1>
          <p style={{ margin: '0.4rem 0 0', color: '#cbd5e1', fontSize: '0.9rem', maxWidth: '750px', lineHeight: '1.5' }}>
            Modelo comercial único: <strong>Plan Principal</strong> (POS, Facturación, Inventario Avanzado, Empleados, Nómina, Marketing y Clientes/CRM) + <strong>Add-on opcional de Suscripciones/Membresías B2C</strong> (Contratos digitales y Cobros recurrentes).
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={fetchData}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#ffffff',
              borderRadius: '10px',
              padding: '0.65rem 1.15rem',
              fontSize: '0.85rem',
              fontWeight: '700',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refrescar
          </button>

          <button
            onClick={openNewPlanModal}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
              border: 'none',
              color: '#ffffff',
              borderRadius: '10px',
              padding: '0.65rem 1.25rem',
              fontWeight: '800',
              fontSize: '0.875rem',
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(59,130,246,0.35)'
            }}
          >
            <Plus size={18} strokeWidth={2.5} />
            Crear Plan SaaS
          </button>

          <button
            onClick={() => setIsNewTenantModalOpen(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: 'linear-gradient(135deg, #10b981, #059669)',
              border: 'none',
              color: '#ffffff',
              borderRadius: '10px',
              padding: '0.65rem 1.35rem',
              fontWeight: '800',
              fontSize: '0.875rem',
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(16,185,129,0.35)'
            }}
          >
            <Plus size={18} strokeWidth={2.5} />
            Dar de Alta Salón
          </button>
        </div>
      </div>

      {actionMessage && (
        <div style={{
          background: '#ecfdf5',
          border: '1px solid #10b981',
          color: '#065f46',
          padding: '0.9rem 1.25rem',
          borderRadius: '12px',
          marginBottom: '2rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          fontWeight: '600',
          fontSize: '0.9rem',
          boxShadow: '0 2px 10px rgba(16,185,129,0.1)'
        }}>
          <CheckCircle2 size={20} color="#10b981" />
          {actionMessage}
        </div>
      )}

      {errorMessage && (
        <div style={{
          background: '#fef2f2',
          border: '1px solid #fecaca',
          color: '#b91c1c',
          padding: '0.9rem 1.25rem',
          borderRadius: '12px',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.6rem',
          fontWeight: '600',
          fontSize: '0.9rem'
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertCircle size={18} color="#dc2626" />
            {errorMessage}
          </span>
          <button onClick={() => setErrorMessage(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', fontWeight: '800' }}>✕</button>
        </div>
      )}

      {loadError && (
        <div style={{
          background: '#fffbeb',
          border: '1px solid #fde68a',
          color: '#92400e',
          padding: '0.9rem 1.25rem',
          borderRadius: '12px',
          marginBottom: '1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          fontSize: '0.85rem',
          fontWeight: '600'
        }}>
          <span>Advertencia al cargar módulos del panel: {loadError}</span>
          <button
            onClick={fetchData}
            style={{ background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '8px', padding: '0.4rem 0.85rem', cursor: 'pointer', fontWeight: '700' }}
          >
            Reintentar
          </button>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>

        {/* Card 1: Salones Registrados */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.35rem', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: '800', textTransform: 'uppercase', color: '#64748b' }}>Salones Registrados</span>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Building2 size={18} color="#2563eb" strokeWidth={2.5} />
            </div>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: '900', color: '#0f172a' }}>{metrics.total_tenants ?? 0}</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem' }}>Base Multi-tenant</div>
        </div>

        {/* Card 2: Salones Activos */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.35rem', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: '800', textTransform: 'uppercase', color: '#64748b' }}>Salones Activos</span>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckCircle2 size={18} color="#059669" strokeWidth={2.5} />
            </div>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: '900', color: '#059669' }}>{metrics.active_tenants ?? 0}</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem' }}>Sin suspensión ({metrics.suspended_tenants ?? 0} suspendidos)</div>
        </div>

        {/* Card 3: Sucursales Conectadas (Control Plane) */}
        <div
          onClick={() => setActiveTab('branches')}
          style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.35rem', boxShadow: '0 4px 16px rgba(0,0,0,0.03)', cursor: 'pointer' }}
          title="Ver directorio global de sedes físicas"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: '800', textTransform: 'uppercase', color: '#64748b' }}>Sedes Físicas</span>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#fffbeb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Store size={18} color="#d97706" strokeWidth={2.5} />
            </div>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: '900', color: '#0f172a' }}>{metrics.total_branches ?? 0}</div>
          <div style={{ fontSize: '0.75rem', color: '#d97706', marginTop: '0.2rem', fontWeight: '700' }}>Ver sedes globales →</div>
        </div>

        {/* Card 4: Usuarios en Plataforma */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.35rem', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: '800', textTransform: 'uppercase', color: '#64748b' }}>Usuarios Globales</span>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#faf5ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Users size={18} color="#7c3aed" strokeWidth={2.5} />
            </div>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: '900', color: '#0f172a' }}>{metrics.total_users ?? 0}</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem' }}>Dueños, cajeros y estilistas</div>
        </div>

        {/* Card 5: MRR Recurrente por Moneda */}
        <div style={{ background: 'linear-gradient(135deg, #064e3b, #047857)', borderRadius: '16px', padding: '1.35rem', color: '#ffffff', boxShadow: '0 4px 16px rgba(6,78,59,0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: '800', textTransform: 'uppercase', color: '#a7f3d0' }}>MRR Recurrente</span>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <DollarSign size={18} color="#ffffff" strokeWidth={2.5} />
            </div>
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: '900', color: '#ffffff', lineHeight: 1.2 }}>
            {Object.keys(metrics.mrr_by_currency || {}).length > 0
              ? Object.entries(metrics.mrr_by_currency).map(([curr, val]) => (
                <div key={curr}>{curr === 'USD' ? 'US$' : `${curr} `}{Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              ))
              : `US$${Number(metrics.mrr || 0).toFixed(2)}`}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#d1fae5', marginTop: '0.25rem' }}>Plan + Sedes + Asientos + Add-ons</div>
        </div>

      </div>

      {/* Tabs Selector Bar */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
        <button
          onClick={() => { setActiveTab('tenants'); navigate('/saas/salones'); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.7rem 1.25rem',
            borderRadius: '10px',
            border: 'none',
            fontSize: '0.9rem',
            fontWeight: '800',
            cursor: 'pointer',
            background: activeTab === 'tenants' ? '#0f172a' : 'transparent',
            color: activeTab === 'tenants' ? '#ffffff' : '#64748b'
          }}
        >
          <Building2 size={17} />
          Salones ({tenants.length})
        </button>

        <button
          onClick={() => { setActiveTab('plans'); navigate('/saas/planes'); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.7rem 1.25rem',
            borderRadius: '10px',
            border: 'none',
            fontSize: '0.9rem',
            fontWeight: '800',
            cursor: 'pointer',
            background: activeTab === 'plans' ? '#0f172a' : 'transparent',
            color: activeTab === 'plans' ? '#ffffff' : '#64748b'
          }}
        >
          <Package size={17} />
          Plan Comercial ({plans.length})
        </button>

        <button
          onClick={() => { setActiveTab('invoices'); navigate('/saas/facturacion'); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.7rem 1.25rem',
            borderRadius: '10px',
            border: 'none',
            fontSize: '0.9rem',
            fontWeight: '800',
            cursor: 'pointer',
            background: activeTab === 'invoices' ? '#0f172a' : 'transparent',
            color: activeTab === 'invoices' ? '#ffffff' : '#64748b'
          }}
        >
          <FileText size={17} />
          Facturación SaaS ({subscriptions.length})
        </button>

        <button
          onClick={() => setActiveTab('branches')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.7rem 1.25rem',
            borderRadius: '10px',
            border: 'none',
            fontSize: '0.9rem',
            fontWeight: '800',
            cursor: 'pointer',
            background: activeTab === 'branches' ? '#0f172a' : 'transparent',
            color: activeTab === 'branches' ? '#ffffff' : '#64748b'
          }}
        >
          <Store size={17} />
          Sedes Físicas ({branches.length})
        </button>

        <button
          onClick={() => setActiveTab('contacts')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.7rem 1.25rem',
            borderRadius: '10px',
            border: 'none',
            fontSize: '0.9rem',
            fontWeight: '800',
            cursor: 'pointer',
            background: activeTab === 'contacts' ? '#0f172a' : 'transparent',
            color: activeTab === 'contacts' ? '#ffffff' : '#64748b'
          }}
        >
          <ShieldAlert size={17} />
          Mensajes Contacto ({contactMessages.length})
        </button>
        <button
          onClick={() => setActiveTab('addon-requests')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.6rem 1.25rem',
            borderRadius: '10px',
            border: 'none',
            fontSize: '0.9rem',
            fontWeight: '800',
            cursor: 'pointer',
            background: activeTab === 'addon-requests' ? '#0f172a' : 'transparent',
            color: activeTab === 'addon-requests' ? '#ffffff' : '#64748b'
          }}
        >
          <CreditCard size={17} />
          Solicitudes Add-on ({addonRequests.filter(r => !r.is_fulfilled).length})
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: SALONES INQUILINOS Y GESTIÓN DE LICENCIAS */}
      {/* ========================================================================= */}
      {activeTab === 'tenants' && (
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
          <div style={{ padding: '1.5rem 1.75rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: '800', margin: 0, color: '#0f172a' }}>
                Directorio de Salones Inquilinos & Control de Licencias
              </h2>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                Controla la asignación de planes, licencias por sucursal física, asientos de usuarios y activación de add-ons.
              </p>
            </div>

            <div style={{ position: 'relative', width: '320px' }}>
              <Search size={17} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                type="text"
                placeholder="Buscar por nombre, slug o correo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: '100%',
                  background: '#f8fafc',
                  border: '1.5px solid #cbd5e1',
                  borderRadius: '10px',
                  padding: '0.6rem 0.85rem 0.6rem 2.4rem',
                  color: '#0f172a',
                  fontSize: '0.875rem',
                  fontWeight: '500',
                  outline: 'none'
                }}
              />
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #e2e8f0', color: '#475569', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '1rem 1.25rem', fontWeight: '800' }}>Salón / Inquilino</th>
                  <th style={{ padding: '1rem 1rem', fontWeight: '800' }}>Plan Contratado</th>
                  <th style={{ padding: '1rem 1rem', fontWeight: '800' }}>Sedes Licenciadas</th>
                  <th style={{ padding: '1rem 1rem', fontWeight: '800' }}>Asientos de Usuarios</th>
                  <th style={{ padding: '1rem 1rem', textAlign: 'center', fontWeight: '800' }}>
                    <span title="Add-on de Suscripciones y Membresías B2C">💎 Add-on Membresías B2C</span>
                  </th>
                  <th style={{ padding: '1rem 1rem', textAlign: 'center', fontWeight: '800' }}>
                    <span title="Facturación electrónica DGII República Dominicana">🧾 DGII e-CF</span>
                  </th>
                  <th style={{ padding: '1rem 1rem', textAlign: 'center', fontWeight: '800' }}>Estado</th>
                  <th style={{ padding: '1rem 1.25rem', textAlign: 'right', fontWeight: '800' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredTenants.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ textAlign: 'center', padding: '3.5rem 1rem', color: '#64748b' }}>
                      {loading ? 'Cargando salones desde PostgreSQL...' : 'No se encontraron salones registrados.'}
                    </td>
                  </tr>
                ) : (
                  filteredTenants.slice((tenantPage - 1) * PAGE_SIZE, tenantPage * PAGE_SIZE).map((t) => {
                    const currentBranches = parseInt(t.branches_count ?? t.branch_count ?? 1, 10);
                    const licensedBranches = parseInt(t.licensed_branches ?? t.max_branches ?? 1, 10);
                    const currentUsers = parseInt(t.users_count ?? t.user_count ?? 1, 10);
                    const usersPerBranch = parseInt(t.plan_users_per_branch || 3, 10);
                    const maxAllowedUsers = parseInt(t.max_users ?? t.max_allowed_users ?? ((licensedBranches * usersPerBranch) + (parseInt(t.extra_user_seats, 10) || 0)), 10);
                    const isBranchesAtLimit = currentBranches >= licensedBranches;
                    const isUsersAtLimit = currentUsers >= maxAllowedUsers;
                    const extraUserRate = t.plan_extra_user_price ? `US$${Number(t.plan_extra_user_price).toFixed(2)}/mes` : 'según tarifa vigente';

                    return (
                      <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>

                        {/* Salón */}
                        <td style={{ padding: '1.15rem 1.25rem' }}>
                          <div style={{ fontWeight: '800', color: '#0f172a', fontSize: '0.95rem' }}>
                            {t.business_name}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                            <span style={{ background: '#eff6ff', color: '#0284c7', padding: '0.15rem 0.45rem', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '700' }}>
                              @{t.slug}
                            </span>
                            <span style={{ color: '#64748b', fontSize: '0.75rem' }}>
                              {t.email}
                            </span>
                          </div>
                        </td>

                        {/* Plan Contratado con Selector */}
                        <td style={{ padding: '1.15rem 1rem' }}>
                          <select
                            value={t.plan_id || ''}
                            onChange={(e) => handleChangeTenantPlan(t.id, e.target.value)}
                            style={{
                              background: '#f8fafc',
                              border: '1.5px solid #cbd5e1',
                              borderRadius: '8px',
                              padding: '0.35rem 0.65rem',
                              fontSize: '0.825rem',
                              fontWeight: '700',
                              color: '#0f172a',
                              cursor: 'pointer',
                              outline: 'none',
                              maxWidth: '180px'
                            }}
                          >
                            {plans.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name} (${p.price_per_branch}/sede) {!p.is_public ? '[Heredado]' : ''}
                              </option>
                            ))}
                          </select>
                          <div style={{ marginTop: '0.3rem', display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                            {!t.plan_is_public && (
                              <span style={{ background: '#fef3c7', color: '#b45309', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.68rem', fontWeight: '800' }}>
                                Plan Grandfathered
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Sedes Licenciadas */}
                        <td style={{ padding: '1.15rem 1rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{
                              background: isBranchesAtLimit ? '#fef3c7' : '#ecfdf5',
                              border: `1px solid ${isBranchesAtLimit ? '#fde68a' : '#a7f3d0'}`,
                              color: isBranchesAtLimit ? '#b45309' : '#047857',
                              padding: '0.2rem 0.6rem',
                              borderRadius: '8px',
                              fontSize: '0.8rem',
                              fontWeight: '800'
                            }}>
                              {currentBranches} / {licensedBranches} {licensedBranches === 1 ? 'sede' : 'sedes'}
                            </span>
                            <div style={{ display: 'flex', gap: '0.2rem' }}>
                              <button
                                onClick={() => handleAdjustBranches(t, -1)}
                                disabled={licensedBranches <= 1}
                                title="Reducir 1 licencia de sede"
                                style={{ width: '24px', height: '24px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: licensedBranches <= 1 ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}
                              >
                                -
                              </button>
                              <button
                                onClick={() => handleAdjustBranches(t, 1)}
                                title="Agregar 1 licencia adicional de sede"
                                style={{ width: '24px', height: '24px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}
                              >
                                +
                              </button>
                            </div>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.25rem' }}>
                            {licensedBranches} × {usersPerBranch} usuarios = {licensedBranches * usersPerBranch} base
                          </div>
                        </td>

                        {/* Asientos de Usuarios */}
                        <td style={{ padding: '1.15rem 1rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{
                              background: isUsersAtLimit ? '#fef2f2' : '#f0fdf4',
                              border: `1px solid ${isUsersAtLimit ? '#fecaca' : '#bbf7d0'}`,
                              color: isUsersAtLimit ? '#b91c1c' : '#15803d',
                              padding: '0.2rem 0.6rem',
                              borderRadius: '8px',
                              fontSize: '0.8rem',
                              fontWeight: '800'
                            }}>
                              {currentUsers} / {maxAllowedUsers} usuarios
                            </span>
                            <div style={{ display: 'flex', gap: '0.2rem' }}>
                              <button
                                onClick={() => handleAdjustSeats(t, -1)}
                                disabled={(parseInt(t.extra_user_seats) || 0) <= 0}
                                title="Quitar 1 asiento adicional"
                                style={{ width: '24px', height: '24px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: (parseInt(t.extra_user_seats) || 0) <= 0 ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}
                              >
                                -
                              </button>
                              <button
                                onClick={() => handleAdjustSeats(t, 1)}
                                title={`Agregar 1 asiento adicional (${extraUserRate})`}
                                style={{ width: '24px', height: '24px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}
                              >
                                +
                              </button>
                            </div>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.25rem' }}>
                            {t.extra_user_seats > 0 ? `+${t.extra_user_seats} asientos extra contratados` : 'Solo asientos base'}
                          </div>
                        </td>

                        {/* Switch Membresías (Add-on) */}
                        <td style={{ padding: '1.15rem 1rem', textAlign: 'center' }}>
                          {(() => {
                            const isLegacy = Boolean(t.has_memberships && t.memberships_source === 'legacy_pro_transition');
                            const branchCount = Number(t.memberships_enabled_branch_count || 0);
                            const label = !t.has_memberships
                              ? 'No contratado'
                              : isLegacy
                                ? 'Transición PRO'
                                : branchCount > 0
                                  ? `Activo (${branchCount} ${branchCount === 1 ? 'sede' : 'sedes'})`
                                  : 'Activo';
                            const tooltip = !t.has_memberships
                              ? 'Activar Add-on de Membresías B2C'
                              : isLegacy
                                ? `${t.memberships_reason || 'Permiso heredado de transición'} · Clic para desactivar`
                                : `${(t.memberships_branches || []).map(b => b.name).join(', ') || 'Add-on activo'} · Clic para desactivar`;

                            return (
                              <button
                                onClick={() => handleToggleModule(t.id, t, 'has_memberships')}
                                title={tooltip}
                                style={{
                                  background: !t.has_memberships ? '#f8fafc' : isLegacy ? '#fffbeb' : '#ecfdf5',
                                  border: `1.5px solid ${!t.has_memberships ? '#cbd5e1' : isLegacy ? '#f59e0b' : '#10b981'}`,
                                  color: !t.has_memberships ? '#64748b' : isLegacy ? '#b45309' : '#047857',
                                  padding: '0.35rem 0.75rem',
                                  borderRadius: '20px',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.4rem',
                                  fontSize: '0.78rem',
                                  fontWeight: '700'
                                }}
                              >
                                {t.has_memberships
                                  ? <ToggleRight size={17} color={isLegacy ? '#f59e0b' : '#10b981'} />
                                  : <ToggleLeft size={17} color="#94a3b8" />}
                                {label}
                              </button>
                            );
                          })()}
                        </td>

                        {/* Switch DGII e-CF */}
                        <td style={{ padding: '1.15rem 1rem', textAlign: 'center' }}>
                          <button
                            onClick={() => handleToggleModule(t.id, t, 'has_dgii_ecf')}
                            title={t.has_dgii_ecf ? 'Desactivar DGII e-CF' : 'Activar DGII e-CF'}
                            style={{
                              background: t.has_dgii_ecf ? '#eff6ff' : '#f8fafc',
                              border: `1.5px solid ${t.has_dgii_ecf ? '#3b82f6' : '#cbd5e1'}`,
                              color: t.has_dgii_ecf ? '#1d4ed8' : '#64748b',
                              padding: '0.35rem 0.75rem',
                              borderRadius: '20px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.4rem',
                              fontSize: '0.78rem',
                              fontWeight: '700'
                            }}
                          >
                            {t.has_dgii_ecf ? <ToggleRight size={17} color="#3b82f6" /> : <ToggleLeft size={17} color="#94a3b8" />}
                            {t.has_dgii_ecf ? 'Activo' : 'Inactivo'}
                          </button>
                        </td>

                        {/* Estado */}
                        <td style={{ padding: '1.15rem 1rem', textAlign: 'center' }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                            padding: '0.25rem 0.7rem',
                            borderRadius: '20px',
                            fontSize: '0.75rem',
                            fontWeight: '800',
                            background: t.status === 'active' ? '#ecfdf5' : '#fff1f2',
                            border: `1px solid ${t.status === 'active' ? '#a7f3d0' : '#fecdd3'}`,
                            color: t.status === 'active' ? '#047857' : '#be123c'
                          }}>
                            {t.status === 'active' ? 'Activo' : 'Suspendido'}
                          </span>
                        </td>

                        {/* Acciones */}
                        <td style={{ padding: '1.15rem 1.25rem', textAlign: 'right' }}>
                          <button
                            onClick={() => handleToggleStatus(t.id, t.status, t.business_name)}
                            style={{
                              background: t.status === 'active' ? '#fff1f2' : '#ecfdf5',
                              border: `1px solid ${t.status === 'active' ? '#fecdd3' : '#a7f3d0'}`,
                              color: t.status === 'active' ? '#e11d48' : '#059669',
                              borderRadius: '8px',
                              padding: '0.35rem 0.75rem',
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                              fontWeight: '700'
                            }}
                          >
                            {t.status === 'active' ? 'Suspender' : 'Reactivar'}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {filteredTenants.length > PAGE_SIZE && (
            <div style={{ padding: '0.9rem 1.5rem', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', color: '#475569' }}>
              <span>Mostrando página {tenantPage} de {Math.ceil(filteredTenants.length / PAGE_SIZE)} ({filteredTenants.length} salones)</span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button disabled={tenantPage <= 1} onClick={() => setTenantPage(p => Math.max(1, p - 1))} style={{ padding: '0.35rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', cursor: tenantPage <= 1 ? 'not-allowed' : 'pointer' }}>Anterior</button>
                <button disabled={tenantPage >= Math.ceil(filteredTenants.length / PAGE_SIZE)} onClick={() => setTenantPage(p => p + 1)} style={{ padding: '0.35rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', cursor: tenantPage >= Math.ceil(filteredTenants.length / PAGE_SIZE) ? 'not-allowed' : 'pointer' }}>Siguiente</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: CONSTRUCTOR DE PLANES SAAS & GRANDFATHERING */}
      {/* ========================================================================= */}
      {activeTab === 'plans' && (
        <div>
          {/* Explanation Banner */}
          <div style={{
            background: 'linear-gradient(135deg, #f8fafc, #eff6ff)',
            border: '1.5px solid #bfdbfe',
            borderRadius: '16px',
            padding: '1.25rem 1.75rem',
            marginBottom: '2rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Crown size={22} color="#1d4ed8" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: '800', color: '#1e3a8a' }}>
                  Política de Grandfathering & Add-ons Modular
                </h3>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: '#3b82f6', maxWidth: '850px' }}>
                  Cuando retiras un plan marcándolo como <strong>No Público</strong>, ningún nuevo cliente podrá contratarlo, pero todos los salones existentes que lo adquirieron conservan su plan y tarifas para siempre. Las <strong>Membresías</strong> se venden como un Add-on aparte del plan base.
                </p>
              </div>
            </div>
            <button
              onClick={openNewPlanModal}
              style={{
                background: '#1d4ed8',
                color: '#ffffff',
                border: 'none',
                borderRadius: '10px',
                padding: '0.65rem 1.25rem',
                fontSize: '0.85rem',
                fontWeight: '800',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                boxShadow: '0 4px 12px rgba(29, 78, 216, 0.25)'
              }}
            >
              <Plus size={16} strokeWidth={2.5} />
              Crear Nuevo Plan
            </button>
          </div>

          {/* Cards Grid de Planes */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
            {plans.map((p) => {
              const features = typeof p.included_features === 'object' && p.included_features !== null
                ? p.included_features
                : {};

              return (
                <div
                  key={p.id}
                  style={{
                    background: '#ffffff',
                    border: p.is_public ? '2px solid #3b82f6' : '1.5px solid #cbd5e1',
                    borderRadius: '18px',
                    padding: '1.75rem',
                    boxShadow: p.is_public ? '0 8px 25px rgba(59,130,246,0.12)' : '0 4px 16px rgba(0,0,0,0.03)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    position: 'relative'
                  }}
                >
                  <div>
                    {/* Header Card */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '900', color: '#0f172a' }}>
                          {p.name}
                        </h3>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>
                          Código: <code>{p.code}</code>
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: '900', color: '#0f172a' }}>
                          ${parseFloat(p.price_per_branch || p.price || 49).toFixed(2)}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: '600' }}>
                          / mes por sucursal
                        </div>
                      </div>
                    </div>

                    <p style={{ fontSize: '0.825rem', color: '#64748b', lineHeight: '1.5', minHeight: '38px', marginBottom: '1rem' }}>
                      {p.description || 'Plan modular con licencias asignables por sucursal física.'}
                    </p>

                    {/* Status Badges */}
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
                      <span style={{
                        background: p.is_public ? '#ecfdf5' : '#fef3c7',
                        border: `1px solid ${p.is_public ? '#a7f3d0' : '#fde68a'}`,
                        color: p.is_public ? '#047857' : '#b45309',
                        padding: '0.2rem 0.6rem',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        fontWeight: '800'
                      }}>
                        {p.is_public ? '🟢 Público (Nuevas Ventas)' : '🟠 Grandfathered (Retirado)'}
                      </span>

                      <span style={{
                        background: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        color: '#1d4ed8',
                        padding: '0.2rem 0.6rem',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        fontWeight: '800'
                      }}>
                        {p.active_subscribers_count || 0} {(parseInt(p.active_subscribers_count) === 1) ? 'salón' : 'salones'}
                      </span>

                      <span style={{
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        color: '#475569',
                        padding: '0.2rem 0.6rem',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        fontWeight: '700'
                      }}>
                        {p.users_per_branch || 3} usuarios base / sede
                      </span>
                    </div>

                    {/* Feature Flags Checklist */}
                    <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '1rem', marginBottom: '1.5rem' }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: '800', textTransform: 'uppercase', color: '#94a3b8', marginBottom: '0.65rem' }}>
                        Módulos Incluidos en este Plan
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', fontSize: '0.78rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: features.pos ? '#0f172a' : '#94a3b8' }}>
                          {features.pos ? <Check size={14} color="#10b981" /> : <X size={14} color="#cbd5e1" />}
                          POS & Ventas
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: features.inventory ? '#0f172a' : '#94a3b8' }}>
                          {features.inventory ? <Check size={14} color="#10b981" /> : <X size={14} color="#cbd5e1" />}
                          Control Inventario
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: features.payroll ? '#0f172a' : '#94a3b8' }}>
                          {features.payroll ? <Check size={14} color="#10b981" /> : <X size={14} color="#cbd5e1" />}
                          Nómina & Comisiones
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: features.attendance ? '#0f172a' : '#94a3b8' }}>
                          {features.attendance ? <Check size={14} color="#10b981" /> : <X size={14} color="#cbd5e1" />}
                          Kiosco Asistencia
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: features.dgii_ecf ? '#0f172a' : '#94a3b8' }}>
                          {features.dgii_ecf ? <Check size={14} color="#10b981" /> : <X size={14} color="#cbd5e1" />}
                          DGII e-CF
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: features.reports ? '#0f172a' : '#94a3b8' }}>
                          {features.reports ? <Check size={14} color="#10b981" /> : <X size={14} color="#cbd5e1" />}
                          Reportes Analítica
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: (features.cash_registers ?? features.cajas) ? '#0f172a' : '#94a3b8' }}>
                          {(features.cash_registers ?? features.cajas) ? <Check size={14} color="#10b981" /> : <X size={14} color="#cbd5e1" />}
                          Control de Cajas
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: features.services_catalog ? '#0f172a' : '#94a3b8' }}>
                          {features.services_catalog ? <Check size={14} color="#10b981" /> : <X size={14} color="#cbd5e1" />}
                          Catálogo Servicios
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: features.clients ? '#0f172a' : '#94a3b8' }}>
                          {features.clients ? <Check size={14} color="#10b981" /> : <X size={14} color="#cbd5e1" />}
                          Clientes / CRM
                        </div>
                      </div>

                      {/* Membresías Add-on Callout */}
                      <div style={{
                        marginTop: '0.75rem',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '8px',
                        background: features.memberships ? '#fdf2f8' : '#f8fafc',
                        border: `1px solid ${features.memberships ? '#fbcfe8' : '#e2e8f0'}`,
                        fontSize: '0.75rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}>
                        <span style={{ fontWeight: '700', color: features.memberships ? '#db2777' : '#64748b' }}>
                          🎟️ Suscripciones y Membresías
                        </span>
                        <span style={{ fontWeight: '800', color: features.memberships ? '#db2777' : '#94a3b8' }}>
                          {features.memberships ? 'Incluido en Plan' : 'Add-on US$99/mes por sucursal + implementación'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions Footer */}
                  <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '1rem', display: 'flex', gap: '0.6rem' }}>
                    <button
                      onClick={() => handleTogglePlanPublic(p)}
                      style={{
                        flex: 1,
                        background: p.is_public ? '#fffbeb' : '#eff6ff',
                        border: `1px solid ${p.is_public ? '#fde68a' : '#bfdbfe'}`,
                        color: p.is_public ? '#b45309' : '#1d4ed8',
                        padding: '0.55rem',
                        borderRadius: '8px',
                        fontSize: '0.78rem',
                        fontWeight: '800',
                        cursor: 'pointer'
                      }}
                    >
                      {p.is_public ? 'Retirar (Grandfather)' : 'Publicar para Venta'}
                    </button>

                    <button
                      onClick={() => openEditPlanModal(p)}
                      style={{
                        background: '#f8fafc',
                        border: '1px solid #cbd5e1',
                        color: '#0f172a',
                        padding: '0.55rem 0.85rem',
                        borderRadius: '8px',
                        fontSize: '0.78rem',
                        fontWeight: '700',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem'
                      }}
                    >
                      <Edit3 size={14} />
                      Editar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: FACTURACIÓN SAAS & SUSCRIPCIONES DE PLATAFORMA (/saas/facturacion) */}
      {/* ========================================================================= */}
      {activeTab === 'invoices' && (() => {
        const q = billingSearch.trim().toLowerCase();
        const filteredSubs = subscriptions.filter((s) => {
          const matchesStatus = subStatusFilter === 'all' || String(s.status).toLowerCase() === subStatusFilter;
          const matchesSearch = !q || (s.business_name || s.salon_name || '').toLowerCase().includes(q) || (s.plan_code || '').toLowerCase().includes(q);
          return matchesStatus && matchesSearch;
        });
        const filteredInvs = invoices.filter((inv) => {
          const matchesStatus = invStatusFilter === 'all' || String(inv.status).toLowerCase() === invStatusFilter;
          const matchesSearch = !q || (inv.business_name || '').toLowerCase().includes(q) || (inv.invoice_number || String(inv.id) || '').toLowerCase().includes(q);
          return matchesStatus && matchesSearch;
        });
        const pagedSubs = filteredSubs.slice((subPage - 1) * PAGE_SIZE, subPage * PAGE_SIZE);
        const pagedInvs = filteredInvs.slice((invPage - 1) * PAGE_SIZE, invPage * PAGE_SIZE);

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '14px', padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <div style={{ fontWeight: '800', color: '#1e3a8a', fontSize: '0.95rem' }}>Facturación B2B de Plataforma (Etereas → Salones)</div>
                <div style={{ fontSize: '0.82rem', color: '#1e40af', marginTop: '0.15rem' }}>
                  Separado de la facturación comercial interna de los salones. Las pasarelas reales permanecen desactivadas en este entorno.
                </div>
              </div>
              <input
                type="text"
                placeholder="Buscar por salón, plan o factura..."
                value={billingSearch}
                onChange={(e) => { setBillingSearch(e.target.value); setSubPage(1); setInvPage(1); }}
                style={{ padding: '0.55rem 0.9rem', borderRadius: '10px', border: '1px solid #93c5fd', background: '#fff', minWidth: '250px', fontSize: '0.85rem' }}
              />
            </div>

            {/* Suscripciones SaaS */}
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', overflow: 'hidden' }}>
              <div style={{ padding: '1.15rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '800', color: '#0f172a' }}>Suscripciones SaaS ({filteredSubs.length})</h2>
                <select
                  value={subStatusFilter}
                  onChange={(e) => { setSubStatusFilter(e.target.value); setSubPage(1); }}
                  style={{ padding: '0.4rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.85rem', fontWeight: '600' }}
                >
                  <option value="all">Todos los estados</option>
                  <option value="active">Activas</option>
                  <option value="past_due">Pago vencido (past_due)</option>
                  <option value="suspended">Suspendidas</option>
                  <option value="cancelled">Canceladas</option>
                  <option value="pending">Pendientes</option>
                </select>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                      <th style={{ padding: '0.85rem 1.25rem' }}>Salón</th>
                      <th style={{ padding: '0.85rem 1rem' }}>Plan / Ciclo</th>
                      <th style={{ padding: '0.85rem 1rem' }}>Estado Comercial</th>
                      <th style={{ padding: '0.85rem 1rem' }}>Fin de Período</th>
                      <th style={{ padding: '0.85rem 1rem' }}>Gracia Hasta</th>
                      <th style={{ padding: '0.85rem 1.25rem', textAlign: 'right' }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedSubs.length === 0 ? (
                      <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>No hay suscripciones SaaS para los filtros seleccionados.</td></tr>
                    ) : pagedSubs.map((s) => (
                      <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.85rem 1.25rem', fontWeight: '700', color: '#0f172a' }}>{s.business_name || s.salon_name || s.tenant_id}</td>
                        <td style={{ padding: '0.85rem 1rem' }}>{s.plan_code} · {s.billing_cycle || 'monthly'} ({s.currency || 'USD'})</td>
                        <td style={{ padding: '0.85rem 1rem' }}>
                          <span style={{ padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: '700', background: s.status === 'active' ? '#ecfdf5' : '#fef3c7', color: s.status === 'active' ? '#047857' : '#b45309' }}>
                            {s.status}
                          </span>
                        </td>
                        <td style={{ padding: '0.85rem 1rem', color: '#475569' }}>{s.current_period_end ? new Date(s.current_period_end).toLocaleDateString() : '—'}</td>
                        <td style={{ padding: '0.85rem 1rem', color: '#475569' }}>{s.grace_period_until ? new Date(s.grace_period_until).toLocaleDateString() : '—'}</td>
                        <td style={{ padding: '0.85rem 1.25rem', textAlign: 'right' }}>
                          <button
                            onClick={() => setGraceModal({ tenantId: s.tenant_id, businessName: s.business_name || s.salon_name || s.tenant_id, additionalDays: 5, reason: '' })}
                            style={{ padding: '0.35rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontWeight: '700', fontSize: '0.78rem' }}
                          >
                            Extender gracia
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredSubs.length > PAGE_SIZE && (
                <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem' }}>
                  <span>Página {subPage} de {Math.ceil(filteredSubs.length / PAGE_SIZE)}</span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button disabled={subPage <= 1} onClick={() => setSubPage(p => p - 1)} style={{ padding: '0.3rem 0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff' }}>Anterior</button>
                    <button disabled={subPage >= Math.ceil(filteredSubs.length / PAGE_SIZE)} onClick={() => setSubPage(p => p + 1)} style={{ padding: '0.3rem 0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff' }}>Siguiente</button>
                  </div>
                </div>
              )}
            </div>

            {/* Facturas SaaS */}
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', overflow: 'hidden' }}>
              <div style={{ padding: '1.15rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '800', color: '#0f172a' }}>Facturas SaaS de Plataforma ({filteredInvs.length})</h2>
                <select
                  value={invStatusFilter}
                  onChange={(e) => { setInvStatusFilter(e.target.value); setInvPage(1); }}
                  style={{ padding: '0.4rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.85rem', fontWeight: '600' }}
                >
                  <option value="all">Todos los estados</option>
                  <option value="paid">Pagadas</option>
                  <option value="open">Pendientes (open)</option>
                  <option value="past_due">Vencidas</option>
                  <option value="void">Anuladas</option>
                </select>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                      <th style={{ padding: '0.85rem 1.25rem' }}>Factura #</th>
                      <th style={{ padding: '0.85rem 1rem' }}>Salón</th>
                      <th style={{ padding: '0.85rem 1rem' }}>Monto</th>
                      <th style={{ padding: '0.85rem 1rem' }}>Estado</th>
                      <th style={{ padding: '0.85rem 1rem' }}>Emisión</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedInvs.length === 0 ? (
                      <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>Aún no existen facturas SaaS emitidas para los filtros seleccionados.</td></tr>
                    ) : pagedInvs.map((inv) => (
                      <tr key={inv.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.85rem 1.25rem', fontWeight: '700' }}>{inv.invoice_number || inv.id}</td>
                        <td style={{ padding: '0.85rem 1rem' }}>{inv.business_name || inv.tenant_id}</td>
                        <td style={{ padding: '0.85rem 1rem', fontWeight: '700' }}>{inv.currency || 'USD'} {Number(inv.total_amount ?? inv.amount ?? 0).toFixed(2)}</td>
                        <td style={{ padding: '0.85rem 1rem' }}>{inv.status}</td>
                        <td style={{ padding: '0.85rem 1rem', color: '#475569' }}>{inv.created_at ? new Date(inv.created_at).toLocaleDateString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredInvs.length > PAGE_SIZE && (
                <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem' }}>
                  <span>Página {invPage} de {Math.ceil(filteredInvs.length / PAGE_SIZE)}</span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button disabled={invPage <= 1} onClick={() => setInvPage(p => p - 1)} style={{ padding: '0.3rem 0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff' }}>Anterior</button>
                    <button disabled={invPage >= Math.ceil(filteredInvs.length / PAGE_SIZE)} onClick={() => setInvPage(p => p + 1)} style={{ padding: '0.3rem 0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff' }}>Siguiente</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* TAB 4: SEDES FÍSICAS GLOBALES (CONTROL PLANE) */}
      {/* ========================================================================= */}
      {activeTab === 'branches' && (() => {
        const pagedBranches = branches.slice((branchPage - 1) * PAGE_SIZE, branchPage * PAGE_SIZE);
        return (
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', overflow: 'hidden' }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0' }}>
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '800', color: '#0f172a' }}>Directorio Global de Sedes Físicas ({branches.length})</h2>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>Vista administrativa de Control Plane para verificar sedes por inquilino sin acceso operativo interno.</p>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '0.85rem 1.25rem' }}>Salón Inquilino</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Sede</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Dirección</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Tipo</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedBranches.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>No hay sedes físicas registradas.</td></tr>
                  ) : pagedBranches.map((b) => (
                    <tr key={b.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.85rem 1.25rem', fontWeight: '700', color: '#0f172a' }}>{b.tenant_name}</td>
                      <td style={{ padding: '0.85rem 1rem' }}>{b.name}</td>
                      <td style={{ padding: '0.85rem 1rem', color: '#475569' }}>{b.address || '—'}</td>
                      <td style={{ padding: '0.85rem 1rem' }}>{b.is_main ? 'Principal' : 'Sucursal'}</td>
                      <td style={{ padding: '0.85rem 1rem' }}>{b.is_active ? 'Activa' : 'Inactiva'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {branches.length > PAGE_SIZE && (
              <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem' }}>
                <span>Página {branchPage} de {Math.ceil(branches.length / PAGE_SIZE)}</span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button disabled={branchPage <= 1} onClick={() => setBranchPage(p => p - 1)} style={{ padding: '0.3rem 0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff' }}>Anterior</button>
                  <button disabled={branchPage >= Math.ceil(branches.length / PAGE_SIZE)} onClick={() => setBranchPage(p => p + 1)} style={{ padding: '0.3rem 0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff' }}>Siguiente</button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* TAB 5: BANDEJA DE MENSAJES DE CONTACTO */}
      {/* ========================================================================= */}
      {activeTab === 'contacts' && (() => {
        const cq = contactSearch.trim().toLowerCase();
        const filteredContacts = contactMessages.filter((m) => !cq || (m.name || '').toLowerCase().includes(cq) || (m.email || '').toLowerCase().includes(cq) || (m.message || '').toLowerCase().includes(cq));
        const pagedContacts = filteredContacts.slice((contactPage - 1) * PAGE_SIZE, contactPage * PAGE_SIZE);
        return (
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', overflow: 'hidden' }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '800', color: '#0f172a' }}>Bandeja de Mensajes de Contacto ({filteredContacts.length})</h2>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>Consultas comerciales enviadas desde el landing de Etereas.</p>
              </div>
              <input
                type="text"
                placeholder="Buscar por nombre, correo o mensaje..."
                value={contactSearch}
                onChange={(e) => { setContactSearch(e.target.value); setContactPage(1); }}
                style={{ padding: '0.55rem 0.9rem', borderRadius: '10px', border: '1px solid #cbd5e1', minWidth: '250px', fontSize: '0.85rem' }}
              />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '0.85rem 1.25rem' }}>Remitente</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Correo / Teléfono</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Mensaje</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedContacts.length === 0 ? (
                    <tr><td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>No hay mensajes de contacto registrados.</td></tr>
                  ) : pagedContacts.map((m) => (
                    <tr key={m.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.85rem 1.25rem', fontWeight: '700', color: '#0f172a' }}>{m.name || 'Sin nombre'}</td>
                      <td style={{ padding: '0.85rem 1rem', color: '#475569' }}>{m.email || '—'} {m.phone ? `· ${m.phone}` : ''}</td>
                      <td style={{ padding: '0.85rem 1rem', color: '#334155', maxWidth: '420px' }}>{m.message}</td>
                      <td style={{ padding: '0.85rem 1rem', color: '#64748b' }}>{m.created_at ? new Date(m.created_at).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredContacts.length > PAGE_SIZE && (
              <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem' }}>
                <span>Página {contactPage} de {Math.ceil(filteredContacts.length / PAGE_SIZE)}</span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button disabled={contactPage <= 1} onClick={() => setContactPage(p => p - 1)} style={{ padding: '0.3rem 0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff' }}>Anterior</button>
                  <button disabled={contactPage >= Math.ceil(filteredContacts.length / PAGE_SIZE)} onClick={() => setContactPage(p => p + 1)} style={{ padding: '0.3rem 0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff' }}>Siguiente</button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* TAB 6: SOLICITUDES DE ADD-ON MEMBRESÍAS B2C */}
      {/* ========================================================================= */}
      {activeTab === 'addon-requests' && (
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', overflow: 'hidden' }}>
          <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0' }}>
            <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '800', color: '#0f172a' }}>
              Solicitudes de Add-on Membresías B2C ({addonRequests.length})
            </h2>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
              Solicitudes enviadas por propietarios desde Mi suscripción. La activación aplica únicamente a las sucursales seleccionadas.
            </p>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '0.85rem 1.25rem' }}>Salón</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Sucursales solicitadas</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Mensualidad</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Nota</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Estado</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Fecha</th>
                  <th style={{ padding: '0.85rem 1.25rem', textAlign: 'right' }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {addonRequests.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                      No hay solicitudes de add-on registradas.
                    </td>
                  </tr>
                ) : addonRequests.map((reqItem) => {
                  const reqBranchIds = (reqItem.requested_branches || []).map(b => b.id);
                  return (
                    <tr key={reqItem.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.85rem 1.25rem' }}>
                        <div style={{ fontWeight: '700', color: '#0f172a' }}>{reqItem.business_name}</div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{reqItem.tenant_email}</div>
                      </td>
                      <td style={{ padding: '0.85rem 1rem', color: '#334155' }}>
                        {reqItem.requested_branches?.length > 0
                          ? reqItem.requested_branches.map(b => b.name).join(', ')
                          : 'Sin detalle de sucursales'}
                      </td>
                      <td style={{ padding: '0.85rem 1rem', fontWeight: '700', color: '#0f172a' }}>
                        US${Number(reqItem.monthly_usd || 0).toFixed(2)}/mes
                      </td>
                      <td style={{ padding: '0.85rem 1rem', color: '#475569', maxWidth: '280px' }}>{reqItem.note || '—'}</td>
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <span style={{
                          padding: '0.2rem 0.6rem',
                          borderRadius: '999px',
                          fontSize: '0.75rem',
                          fontWeight: '700',
                          background: reqItem.is_fulfilled ? '#ecfdf5' : '#fef3c7',
                          color: reqItem.is_fulfilled ? '#047857' : '#92400e'
                        }}>
                          {reqItem.is_fulfilled ? 'Activado' : 'Pendiente'}
                        </span>
                      </td>
                      <td style={{ padding: '0.85rem 1rem', color: '#64748b', fontSize: '0.8rem' }}>
                        {reqItem.created_at ? new Date(reqItem.created_at).toLocaleString() : '—'}
                      </td>
                      <td style={{ padding: '0.85rem 1.25rem', textAlign: 'right' }}>
                        {!reqItem.is_fulfilled && (
                          <button
                            onClick={() => {
                              const tenantRow = tenants.find(t => t.id === reqItem.tenant_id);
                              const branchOptions = tenantRow?.tenant_branches || reqItem.requested_branches || [];
                              setConfirmModal({
                                title: `Activar Add-on para "${reqItem.business_name}"`,
                                description: 'Se activará el add-on Suscripciones/Membresías B2C para las sucursales solicitadas.',
                                requireReason: true,
                                reason: `Activación según solicitud (${reqItem.requested_branches?.map(b => b.name).join(', ') || '1+ sucursales'})`,
                                branchOptions,
                                selectedBranchIds: reqBranchIds.length > 0 ? reqBranchIds : branchOptions.map(b => b.id),
                                onConfirm: async (reason, selectedBranchIds) => {
                                  await dataService.setTenantAddon(reqItem.tenant_id, 'memberships', {
                                    enabled: true,
                                    branchIds: selectedBranchIds,
                                    reason: reason || 'Activación desde bandeja de solicitudes',
                                    source: 'commercial_addon'
                                  });
                                  showNotification('Add-on de Membresías activado para las sucursales seleccionadas.');
                                  await fetchData();
                                }
                              });
                            }}
                            style={{
                              padding: '0.45rem 0.85rem',
                              borderRadius: '8px',
                              border: 'none',
                              background: '#059669',
                              color: '#fff',
                              fontWeight: '700',
                              fontSize: '0.78rem',
                              cursor: 'pointer'
                            }}
                          >
                            Activar add-on
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMACIÓN PARA ACCIONES CRÍTICAS */}
      {confirmModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div style={{ background: '#fff', borderRadius: '16px', maxWidth: '440px', width: '100%', padding: '1.5rem', boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.15rem', fontWeight: '800', color: '#0f172a' }}>{confirmModal.title}</h3>
            <p style={{ margin: '0 0 1rem', fontSize: '0.88rem', color: '#475569', lineHeight: 1.5 }}>{confirmModal.description}</p>
            {confirmModal.requireReason && (
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>Motivo de auditoría</label>
                <input
                  type="text"
                  value={confirmModal.reason || ''}
                  onChange={(e) => setConfirmModal(prev => ({ ...prev, reason: e.target.value }))}
                  style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.88rem' }}
                />
              </div>
            )}
            {Array.isArray(confirmModal.branchOptions) && confirmModal.branchOptions.length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                  Sucursales habilitadas (US$99/mes por sucursal)
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '140px', overflowY: 'auto', padding: '0.5rem', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#f8fafc' }}>
                  {confirmModal.branchOptions.map(b => {
                    const checked = (confirmModal.selectedBranchIds || []).includes(b.id);
                    return (
                      <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.84rem', color: '#0f172a', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const isChecked = e.target.checked;
                            setConfirmModal(prev => {
                              const current = Array.isArray(prev.selectedBranchIds) ? prev.selectedBranchIds : [];
                              const next = isChecked
                                ? [...new Set([...current, b.id])]
                                : current.filter(id => id !== b.id);
                              return { ...prev, selectedBranchIds: next };
                            });
                          }}
                        />
                        <span>{b.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
              <button onClick={() => setConfirmModal(null)} style={{ padding: '0.55rem 1rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: '700' }}>Cancelar</button>
              <button
                onClick={async () => {
                  const fn = confirmModal.onConfirm;
                  const r = confirmModal.reason;
                  const selectedIds = confirmModal.selectedBranchIds;
                  setConfirmModal(null);
                  try { await fn(r, selectedIds); } catch (err) { showError(err.message); }
                }}
                style={{ padding: '0.55rem 1rem', borderRadius: '8px', border: 'none', background: '#0f172a', color: '#fff', cursor: 'pointer', fontWeight: '700' }}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EXTENDER PERÍODO DE GRACIA */}
      {graceModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <form onSubmit={handleSubmitGraceExtension} style={{ background: '#fff', borderRadius: '16px', maxWidth: '440px', width: '100%', padding: '1.5rem', boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.15rem', fontWeight: '800', color: '#0f172a' }}>Extender Gracia — {graceModal.businessName}</h3>
            <div style={{ marginBottom: '0.85rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.3rem' }}>Días adicionales (1 - 90)</label>
              <input
                type="number"
                min={1}
                max={90}
                required
                value={graceModal.additionalDays}
                onChange={(e) => setGraceModal(prev => ({ ...prev, additionalDays: e.target.value }))}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.3rem' }}>Motivo obligatorio</label>
              <input
                type="text"
                required
                minLength={3}
                placeholder="Ej: Acuerdo de pago confirmado"
                value={graceModal.reason}
                onChange={(e) => setGraceModal(prev => ({ ...prev, reason: e.target.value }))}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
              <button type="button" onClick={() => setGraceModal(null)} style={{ padding: '0.55rem 1rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: '700' }}>Cancelar</button>
              <button type="submit" disabled={isSubmitting} style={{ padding: '0.55rem 1rem', borderRadius: '8px', border: 'none', background: '#059669', color: '#fff', cursor: 'pointer', fontWeight: '700' }}>
                {isSubmitting ? 'Guardando...' : 'Extender Gracia'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CONSTRUCTOR DE PLAN SAAS (CREAR / EDITAR) */}
      {/* ========================================================================= */}
      {isPlanModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '20px',
            width: '100%',
            maxWidth: '650px',
            padding: '2rem',
            maxHeight: '90vh',
            overflowY: 'auto',
            boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
              <div>
                <h3 style={{ fontSize: '1.3rem', fontWeight: '900', margin: 0, color: '#0f172a' }}>
                  {editingPlan ? 'Editar Plan SaaS' : 'Nuevo Plan SaaS'}
                </h3>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.825rem', color: '#64748b' }}>
                  Define el precio por sucursal, asientos base y activa/desactiva módulos específicos.
                </p>
              </div>
              <button
                onClick={() => setIsPlanModalOpen(false)}
                style={{ background: '#f1f5f9', border: 'none', color: '#64748b', cursor: 'pointer', width: '32px', height: '32px', borderRadius: '50%', fontWeight: 'bold' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSavePlan} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                    Nombre Comercial del Plan *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. Plan Crecimiento Pro"
                    value={planFormData.name}
                    onChange={(e) => {
                      const n = e.target.value;
                      const code = n.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
                      setPlanFormData({ ...planFormData, name: n, code: editingPlan ? planFormData.code : code });
                    }}
                    style={{ width: '100%', background: '#f8fafc', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0.6rem 0.85rem', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                    Código / Slug Único *
                  </label>
                  <input
                    type="text"
                    required
                    disabled={Boolean(editingPlan)}
                    placeholder="plan-crecimiento-pro"
                    value={planFormData.code}
                    onChange={(e) => setPlanFormData({ ...planFormData, code: e.target.value.toLowerCase() })}
                    style={{ width: '100%', background: editingPlan ? '#f1f5f9' : '#f8fafc', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0.6rem 0.85rem', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                  Descripción para Clientes
                </label>
                <input
                  type="text"
                  placeholder="Resumen de qué incluye el plan..."
                  value={planFormData.description}
                  onChange={(e) => setPlanFormData({ ...planFormData, description: e.target.value })}
                  style={{ width: '100%', background: '#f8fafc', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0.6rem 0.85rem', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              {/* Precios y Cuotas por Sucursal */}
              <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '1.1rem' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: '800', color: '#0f172a', marginBottom: '0.75rem' }}>
                  Tarifas y Capacidad por Sucursal Física
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: '#64748b', marginBottom: '0.3rem' }}>
                      Precio / Sucursal ($USD)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={planFormData.price_per_branch}
                      onChange={(e) => setPlanFormData({ ...planFormData, price_per_branch: e.target.value })}
                      style={{ width: '100%', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.5rem 0.75rem', fontSize: '0.875rem', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: '#64748b', marginBottom: '0.3rem' }}>
                      Usuarios Base por Sede
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={planFormData.users_per_branch}
                      onChange={(e) => setPlanFormData({ ...planFormData, users_per_branch: parseInt(e.target.value) || 3 })}
                      style={{ width: '100%', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.5rem 0.75rem', fontSize: '0.875rem', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: '#64748b', marginBottom: '0.3rem' }}>
                      Precio Asiento Extra ($USD)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Pendiente de cotización"
                      value={planFormData.extra_user_price}
                      onChange={(e) => setPlanFormData({ ...planFormData, extra_user_price: e.target.value })}
                      style={{ width: '100%', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.5rem 0.75rem', fontSize: '0.875rem', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
              </div>

              {/* Feature Flags Selector */}
              <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '1.1rem' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: '800', color: '#0f172a', marginBottom: '0.65rem' }}>
                  Módulos y Feature Flags Habilitados
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                  {[
                    { key: 'pos', label: 'Punto de Venta (POS) & Tickets' },
                    { key: 'inventory', label: 'Control de Inventario y Stock' },
                    { key: 'payroll', label: 'Nómina & Comisiones' },
                    { key: 'attendance', label: 'Kiosco Asistencia & Ponches' },
                    { key: 'dgii_ecf', label: 'Facturación DGII e-CF' },
                    { key: 'reports', label: 'Reportes y Analítica' },
                    { key: 'cash_registers', label: 'Control de Cajas (Apertura y Cierre)' },
                    { key: 'services_catalog', label: 'Catálogo de Servicios' },
                    { key: 'clients', label: 'Directorio de Clientes / CRM' },
                    { key: 'memberships', label: 'Suscripciones y Membresías (Add-on independiente US$99/mes/sucursal)', lockedOff: true }
                  ].map(f => (
                    <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: f.lockedOff ? '#94a3b8' : '#334155', cursor: f.lockedOff ? 'not-allowed' : 'pointer' }}>
                      <input
                        type="checkbox"
                        disabled={Boolean(f.lockedOff)}
                        checked={f.lockedOff ? false : Boolean(planFormData.included_features?.[f.key])}
                        onChange={(e) => {
                          if (f.lockedOff) return;
                          setPlanFormData({
                            ...planFormData,
                            included_features: {
                              ...planFormData.included_features,
                              [f.key]: e.target.checked
                            }
                          });
                        }}
                        style={{ accentColor: '#2563eb', width: '16px', height: '16px' }}
                      />
                      <span>{f.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Grandfathering Toggle */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', background: '#eff6ff', padding: '0.85rem', borderRadius: '10px', border: '1px solid #bfdbfe' }}>
                <input
                  type="checkbox"
                  checked={planFormData.is_public}
                  onChange={(e) => setPlanFormData({ ...planFormData, is_public: e.target.checked })}
                  style={{ accentColor: '#1d4ed8', width: '18px', height: '18px' }}
                />
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: '800', color: '#1e3a8a' }}>
                    Plan Público para Nuevos Clientes
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#3b82f6' }}>
                    Si se desactiva, el plan queda <strong>Retirado (Grandfathered)</strong>. Solo los salones que ya lo tenían contratado podrán seguir utilizándolo.
                  </div>
                </div>
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setIsPlanModalOpen(false)}
                  style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#64748b', padding: '0.65rem 1.25rem', borderRadius: '10px', fontWeight: '700', cursor: 'pointer' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', border: 'none', color: '#ffffff', padding: '0.65rem 1.5rem', borderRadius: '10px', fontWeight: '800', cursor: 'pointer' }}
                >
                  {isSubmitting ? 'Guardando...' : (editingPlan ? 'Actualizar Plan' : 'Crear Plan')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ALTA DE NUEVO SALÓN */}
      {/* ========================================================================= */}
      {isNewTenantModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999,
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '20px',
            width: '100%',
            maxWidth: '580px',
            padding: '2rem',
            maxHeight: '90vh',
            overflowY: 'auto',
            boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: '800', margin: 0, color: '#0f172a' }}>
                  Dar de Alta Nuevo Salón Inquilino
                </h3>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                  Registra un salón y asígnale su plan base comercial y licencias de sucursal.
                </p>
              </div>
              <button
                onClick={() => setIsNewTenantModalOpen(false)}
                style={{ background: '#f1f5f9', border: 'none', color: '#64748b', cursor: 'pointer', width: '32px', height: '32px', borderRadius: '50%', fontWeight: 'bold' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTenant} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                  Nombre Comercial del Salón *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Spa & Beauty Palace"
                  value={tenantFormData.business_name}
                  onChange={(e) => {
                    const name = e.target.value;
                    const autoSlug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
                    setTenantFormData({ ...tenantFormData, business_name: name, slug: autoSlug });
                  }}
                  style={{ width: '100%', background: '#f8fafc', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0.65rem 0.85rem', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                    Slug / Subdominio *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="spa-beauty-palace"
                    value={tenantFormData.slug}
                    onChange={(e) => setTenantFormData({ ...tenantFormData, slug: e.target.value.toLowerCase() })}
                    style={{ width: '100%', background: '#f8fafc', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0.65rem 0.85rem', fontSize: '0.9rem', color: '#0284c7', fontWeight: '700', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                    Plan SaaS Inicial *
                  </label>
                  <select
                    value={tenantFormData.plan_id}
                    onChange={(e) => setTenantFormData({ ...tenantFormData, plan_id: e.target.value })}
                    style={{ width: '100%', background: '#f8fafc', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0.65rem 0.85rem', fontSize: '0.85rem', fontWeight: '700', outline: 'none', boxSizing: 'border-box' }}
                  >
                    <option value="">-- Seleccionar Plan --</option>
                    {plans.filter(p => p.is_public).map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} (${p.price_per_branch}/sede)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                    Correo Contacto *
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="contacto@spabeauty.com"
                    value={tenantFormData.email}
                    onChange={(e) => setTenantFormData({ ...tenantFormData, email: e.target.value })}
                    style={{ width: '100%', background: '#f8fafc', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0.65rem 0.85rem', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                    Teléfono
                  </label>
                  <input
                    type="text"
                    placeholder="(809) 555-0199"
                    value={tenantFormData.phone}
                    onChange={(e) => setTenantFormData({ ...tenantFormData, phone: e.target.value })}
                    style={{ width: '100%', background: '#f8fafc', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0.65rem 0.85rem', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              {/* Cuenta del Dueño */}
              <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.825rem', fontWeight: '800', color: '#0f172a', marginBottom: '0.6rem' }}>
                  👤 Administrador / Dueño Inicial
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <input
                      type="text"
                      placeholder="Nombre del Dueño"
                      value={tenantFormData.owner_name}
                      onChange={(e) => setTenantFormData({ ...tenantFormData, owner_name: e.target.value })}
                      style={{ width: '100%', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.5rem 0.75rem', fontSize: '0.85rem', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <input
                      type="password"
                      placeholder="Contraseña Inicial"
                      value={tenantFormData.owner_password}
                      onChange={(e) => setTenantFormData({ ...tenantFormData, owner_password: e.target.value })}
                      style={{ width: '100%', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.5rem 0.75rem', fontSize: '0.85rem', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
              </div>

              {/* Add-ons */}
              <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.825rem', fontWeight: '800', color: '#0f172a', marginBottom: '0.6rem' }}>
                  Módulos Add-on Iniciales
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', fontSize: '0.825rem', color: '#334155' }}>
                    <input
                      type="checkbox"
                      checked={tenantFormData.has_memberships}
                      onChange={(e) => setTenantFormData({ ...tenantFormData, has_memberships: e.target.checked })}
                      style={{ accentColor: '#10b981', width: '16px', height: '16px' }}
                    />
                    <span>🎟️ Activar Add-on Suscripciones/Membresías B2C</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', fontSize: '0.825rem', color: '#334155' }}>
                    <input
                      type="checkbox"
                      checked={tenantFormData.has_dgii_ecf}
                      onChange={(e) => setTenantFormData({ ...tenantFormData, has_dgii_ecf: e.target.checked })}
                      style={{ accentColor: '#10b981', width: '16px', height: '16px' }}
                    />
                    <span>🧾 Activar Facturación Electrónica DGII (e-CF)</span>
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setIsNewTenantModalOpen(false)}
                  style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#64748b', padding: '0.65rem 1.25rem', borderRadius: '10px', fontWeight: '600', cursor: 'pointer' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{ background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', color: '#ffffff', padding: '0.65rem 1.5rem', borderRadius: '10px', fontWeight: '700', cursor: 'pointer' }}
                >
                  {isSubmitting ? 'Creando...' : 'Dar de Alta Salón'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
