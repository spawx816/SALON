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
  const [activeTab, setActiveTab] = useState(initialTab || 'tenants'); // 'tenants' | 'plans'

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);
  const [metrics, setMetrics] = useState({
    totalTenants: 0,
    activeTenants: 0,
    totalBranches: 0,
    totalUsers: 0,
    activePlans: 0,
    estimatedMrr: 0
  });
  const [tenants, setTenants] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionMessage, setActionMessage] = useState(null);

  // Modales
  const [isNewTenantModalOpen, setIsNewTenantModalOpen] = useState(false);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [isLicensingModalOpen, setIsLicensingModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const [selectedTenantForLicense, setSelectedTenantForLicense] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      cajas: true,
      memberships: false // Desacoplado por defecto, Add-on
    }
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [m, t, p] = await Promise.all([
        dataService.getSaasMetrics().catch(() => ({})),
        dataService.getSaasTenants().catch(() => []),
        dataService.getSaasPlans(false).catch(() => [])
      ]);

      if (m) setMetrics(m);
      if (Array.isArray(t)) setTenants(t);
      if (Array.isArray(p)) setPlans(p);
    } catch (err) {
      console.error('Error al cargar datos de SaaS:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const showNotification = (msg) => {
    setActionMessage(msg);
    setTimeout(() => setActionMessage(null), 3500);
  };

  // Toggle Add-on Module
  const handleToggleModule = async (tenantId, currentModules, moduleName) => {
    try {
      const updatedValue = !currentModules[moduleName];
      await dataService.updateTenantModules(tenantId, { [moduleName]: updatedValue });
      showNotification(`Módulo "${moduleName}" actualizado.`);
      setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, [moduleName]: updatedValue } : t));
    } catch (err) {
      alert(`Error al actualizar módulo: ${err.message}`);
    }
  };

  // Toggle Tenant Status
  const handleToggleStatus = async (tenantId, currentStatus) => {
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
    try {
      await dataService.updateTenantStatus(tenantId, newStatus);
      showNotification(`Estado del salón cambiado a "${newStatus}".`);
      setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, status: newStatus } : t));
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  };

  // Ajuste rápido de sucursales autorizadas
  const handleAdjustBranches = async (tenant, delta) => {
    const newBranches = Math.max(1, (parseInt(tenant.licensed_branches) || 1) + delta);
    try {
      await dataService.updateTenantLicensing(tenant.id, { licensed_branches: newBranches });
      showNotification(`Licencias de sucursal de "${tenant.business_name}" actualizadas a ${newBranches}.`);
      setTenants(prev => prev.map(t => t.id === tenant.id ? { 
        ...t, 
        licensed_branches: newBranches,
        max_allowed_users: (newBranches * (parseInt(t.plan_users_per_branch) || 3)) + (parseInt(t.extra_user_seats) || 0)
      } : t));
    } catch (err) {
      alert(`Error al ajustar sucursales: ${err.message}`);
    }
  };

  // Ajuste rápido de asientos extra de usuarios
  const handleAdjustSeats = async (tenant, delta) => {
    const newSeats = Math.max(0, (parseInt(tenant.extra_user_seats) || 0) + delta);
    try {
      await dataService.updateTenantLicensing(tenant.id, { extra_user_seats: newSeats });
      showNotification(`Asientos adicionales de "${tenant.business_name}" actualizados a ${newSeats}.`);
      setTenants(prev => prev.map(t => t.id === tenant.id ? { 
        ...t, 
        extra_user_seats: newSeats,
        max_allowed_users: ((parseInt(t.licensed_branches) || 1) * (parseInt(t.plan_users_per_branch) || 3)) + newSeats
      } : t));
    } catch (err) {
      alert(`Error al ajustar asientos: ${err.message}`);
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
      alert(`Error al cambiar plan: ${err.message}`);
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
      alert(`Error al cambiar disponibilidad del plan: ${err.message}`);
    }
  };

  // Crear o Editar Plan
  const handleSavePlan = async (e) => {
    e.preventDefault();
    if (!planFormData.name || !planFormData.code) {
      alert('Nombre y código único son requeridos.');
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
      alert(`Error al guardar plan: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Crear Nuevo Salón
  const handleCreateTenant = async (e) => {
    e.preventDefault();
    if (!tenantFormData.business_name || !tenantFormData.slug || !tenantFormData.email) {
      alert('Por favor complete el nombre comercial, el slug y el email.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/saas/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tenantFormData)
      });

      const data = await res.json();
      if (res.ok) {
        showNotification('¡Salón creado exitosamente con sus licencias base!');
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
      } else {
        alert(`Error al crear salón: ${data.error || 'Datos inválidos'}`);
      }
    } catch (err) {
      alert(`Error de red: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditPlanModal = (plan) => {
    setEditingPlan(plan);
    setPlanFormData({
      name: plan.name,
      code: plan.code,
      description: plan.description || '',
      price_per_branch: parseFloat(plan.price_per_branch || plan.price || 49),
      users_per_branch: parseInt(plan.users_per_branch || 3),
      extra_user_price: parseFloat(plan.extra_user_price || 15),
      billing_cycle: plan.billing_cycle || 'monthly',
      is_public: Boolean(plan.is_public),
      is_active: Boolean(plan.is_active),
      included_features: typeof plan.included_features === 'object' && plan.included_features !== null 
        ? plan.included_features 
        : {
            pos: true, inventory: true, payroll: true, attendance: true,
            dgii_ecf: true, reports: true, services_catalog: true,
            clients: true, cajas: true, memberships: false
          }
    });
    setIsPlanModalOpen(true);
  };

  const openNewPlanModal = () => {
    setEditingPlan(null);
    setPlanFormData({
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
        cajas: true,
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
            Modelo comercial de 2 niveles: <strong>Plan Base</strong> (POS, Facturación, Catálogo, Empleados y Clientes/CRM) y <strong>Plan Pro</strong> (Suscripciones Plan Beauty, Contratos, Cobros recurrentes y Marketing).
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
          <div style={{ fontSize: '2rem', fontWeight: '900', color: '#0f172a' }}>{metrics.totalTenants}</div>
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
          <div style={{ fontSize: '2rem', fontWeight: '900', color: '#059669' }}>{metrics.activeTenants}</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem' }}>Sin suspensión</div>
        </div>

        {/* Card 3: Sucursales Conectadas */}
        <div 
          onClick={() => navigate('/sucursales')}
          style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.35rem', boxShadow: '0 4px 16px rgba(0,0,0,0.03)', cursor: 'pointer' }}
          title="Ver sucursales físicas"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: '800', textTransform: 'uppercase', color: '#64748b' }}>Sedes Físicas</span>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#fffbeb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Store size={18} color="#d97706" strokeWidth={2.5} />
            </div>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: '900', color: '#0f172a' }}>{metrics.totalBranches}</div>
          <div style={{ fontSize: '0.75rem', color: '#d97706', marginTop: '0.2rem', fontWeight: '700' }}>Sedes autorizadas →</div>
        </div>

        {/* Card 4: Usuarios en Plataforma */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.35rem', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: '800', textTransform: 'uppercase', color: '#64748b' }}>Usuarios Globales</span>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#faf5ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Users size={18} color="#7c3aed" strokeWidth={2.5} />
            </div>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: '900', color: '#0f172a' }}>{metrics.totalUsers}</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem' }}>Dueños, cajeros y estilistas</div>
        </div>

        {/* Card 5: MRR Estimado */}
        <div style={{ background: 'linear-gradient(135deg, #064e3b, #047857)', borderRadius: '16px', padding: '1.35rem', color: '#ffffff', boxShadow: '0 4px 16px rgba(6,78,59,0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: '800', textTransform: 'uppercase', color: '#a7f3d0' }}>MRR Estimado</span>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <DollarSign size={18} color="#ffffff" strokeWidth={2.5} />
            </div>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: '900', color: '#ffffff' }}>${metrics.estimatedMrr || 0}</div>
          <div style={{ fontSize: '0.75rem', color: '#d1fae5', marginTop: '0.2rem' }}>Planes + Sedes + Add-ons</div>
        </div>

      </div>

      {/* Tabs Selector Bar */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem' }}>
        <button
          onClick={() => { setActiveTab('tenants'); navigate('/saas/salones'); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.75rem 1.5rem',
            borderRadius: '10px',
            border: 'none',
            fontSize: '0.95rem',
            fontWeight: '800',
            cursor: 'pointer',
            transition: 'all 0.2s',
            background: activeTab === 'tenants' ? '#0f172a' : 'transparent',
            color: activeTab === 'tenants' ? '#ffffff' : '#64748b'
          }}
        >
          <Building2 size={18} />
          Salones Inquilinos & Licenciamiento ({tenants.length})
        </button>

        <button
          onClick={() => { setActiveTab('plans'); navigate('/saas/planes'); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.75rem 1.5rem',
            borderRadius: '10px',
            border: 'none',
            fontSize: '0.95rem',
            fontWeight: '800',
            cursor: 'pointer',
            transition: 'all 0.2s',
            background: activeTab === 'plans' ? '#0f172a' : 'transparent',
            color: activeTab === 'plans' ? '#ffffff' : '#64748b'
          }}
        >
          <Package size={18} />
          Constructor de Planes SaaS & Grandfathering ({plans.length})
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
                    <span title="Clientes registrados y ecosistema de Suscripciones Plan Beauty (Plan Pro)">💎 Clientes & Suscripciones</span>
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
                  filteredTenants.map((t) => {
                    const currentBranches = parseInt(t.branch_count || 1);
                    const licensedBranches = parseInt(t.licensed_branches || 1);
                    const currentUsers = parseInt(t.user_count || 1);
                    const maxAllowedUsers = parseInt(t.max_allowed_users || 3);
                    const isBranchesAtLimit = currentBranches >= licensedBranches;
                    const isUsersAtLimit = currentUsers >= maxAllowedUsers;

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
                            {licensedBranches} × 3 usuarios = {licensedBranches * 3} base
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
                                title="Comprar 1 asiento adicional ($15/mes)"
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
                          <button
                            onClick={() => handleToggleModule(t.id, t, 'has_memberships')}
                            title={t.has_memberships ? 'Desactivar Add-on de Membresías' : 'Activar Add-on de Membresías ($29/mes)'}
                            style={{
                              background: t.has_memberships ? '#ecfdf5' : '#f8fafc',
                              border: `1.5px solid ${t.has_memberships ? '#10b981' : '#cbd5e1'}`,
                              color: t.has_memberships ? '#047857' : '#64748b',
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
                            {t.has_memberships ? <ToggleRight size={17} color="#10b981" /> : <ToggleLeft size={17} color="#94a3b8" />}
                            {t.has_memberships ? 'Activo' : 'No contratado'}
                          </button>
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
                            onClick={() => handleToggleStatus(t.id, t.status)}
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: features.cajas ? '#0f172a' : '#94a3b8' }}>
                          {features.cajas ? <Check size={14} color="#10b981" /> : <X size={14} color="#cbd5e1" />}
                          Control Cajas
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: features.services_catalog ? '#0f172a' : '#94a3b8' }}>
                          {features.services_catalog ? <Check size={14} color="#10b981" /> : <X size={14} color="#cbd5e1" />}
                          Catálogo Servicios
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
                          🎟️ Membresías (Plan Beauty)
                        </span>
                        <span style={{ fontWeight: '800', color: features.memberships ? '#db2777' : '#94a3b8' }}>
                          {features.memberships ? 'Incluido en Plan' : 'Add-on Opcional ($29/mes)'}
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
                      required
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
                    { key: 'cajas', label: 'Apertura y Cierre de Cajas' },
                    { key: 'services_catalog', label: 'Catálogo de Servicios' },
                    { key: 'clients', label: 'Directorio de Clientes / CRM' },
                    { key: 'memberships', label: 'Membresías Recurrentes (Plan Beauty)' }
                  ].map(f => (
                    <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#334155', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(planFormData.included_features?.[f.key])}
                        onChange={(e) => {
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
                    <span>🎟️ Activar Add-on Membresías (Plan Beauty RD - $29/mes)</span>
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
