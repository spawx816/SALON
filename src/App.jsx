import React, { useState, useEffect, Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LayoutDashboard, Users, Calendar, LogOut, Menu, X, CreditCard,
  FileSignature, PieChart, Bell, Settings, User, TrendingUp, Mail, Gift, Search, MapPin,
  Sparkles, Star, UserPlus, Clock, Phone, Percent, Receipt, Wallet, BadgePercent,
  Landmark, ChevronDown, ChevronRight, FileSpreadsheet, ArrowDownLeft, Shield, DollarSign, History,
  Crown, ShoppingCart, UserCheck, Key, BarChart2, BarChart3, Banknote, ArrowDownCircle,
  Building2, Package, Palette
} from 'lucide-react';

import { AuthProvider, useAuth } from './context/AuthContext';
import { EntitlementsProvider, useEntitlements } from './context/EntitlementsContext';
import { TenantBrandingProvider, useTenantBranding } from './context/TenantBrandingContext';
import { LanguageProvider, useTranslation } from './context/LanguageContext';
import { NotificationProvider, useNotification } from './context/NotificationContext';
import ErrorBoundary from './components/common/ErrorBoundary';
import FeatureForbiddenGate from './components/common/FeatureForbiddenGate';
import NotFoundPage from './components/common/NotFoundPage';

// Core Eager Pages & Components (High-frequency entry routes)
import Login from './pages/Login';
import Dashboard from './components/admin/Dashboard';
import VisitRecorder from './components/visits/VisitRecorder';
import SuperAdminDashboard from './components/admin/SuperAdminDashboard';
import ReceptionMotivationalModal from './components/common/ReceptionMotivationalModal';
import ReceptionDashboard from './components/reception/ReceptionDashboard';
import GiftCardValidator from './components/admin/GiftCardValidator';

// Code-Split Lazy Modules (Reduced initial bundle size)
const ClientDashboard = lazy(() => import('./components/clients/ClientDashboard'));
const ClientRegistration = lazy(() => import('./components/clients/ClientRegistration'));
const InvoiceHistory = lazy(() => import('./components/admin/InvoiceHistory'));
const CashRegistersModule = lazy(() => import('./components/admin/CashRegistersModule'));
const EmployeeDiscountsModule = lazy(() => import('./components/admin/EmployeeDiscountsModule'));
const SatisfactionSurvey = lazy(() => import('./components/surveys/SatisfactionSurvey'));
const GiftCertificates = lazy(() => import('./components/surveys/GiftCertificates'));
const ClientServices = lazy(() => import('./components/clients/ClientServices'));
const ActivateAccount = lazy(() => import('./pages/ActivateAccount'));
const CardNetTest = lazy(() => import('./pages/CardNetTest'));
const DigitalContract = lazy(() => import('./components/contracts/DigitalContract'));
const ServiceManagement = lazy(() => import('./components/services/ServiceManagement'));
const InventoryModule = lazy(() => import('./components/inventory/InventoryModule'));
const SaasBillingModule = lazy(() => import('./components/saas/SaasBillingModule'));
const CommissionManagement = lazy(() => import('./components/commissions/CommissionManagement'));
const Payments = lazy(() => import('./components/admin/Payments'));
const PlansModule = lazy(() => import('./components/admin/PlansModule'));
const ClientProfile = lazy(() => import('./components/clients/ClientProfile'));
const MarketingModule = lazy(() => import('./components/admin/MarketingModule'));
const ServiceAnalytics = lazy(() => import('./components/admin/ServiceAnalytics'));
const BusinessIntelligence = lazy(() => import('./components/bi/BusinessIntelligence'));
const StaffModule = lazy(() => import('./components/admin/StaffModule'));
const SalonsModule = lazy(() => import('./components/admin/SalonsModule'));
const SettingsModule = lazy(() => import('./components/admin/SettingsModule'));
const AdminGiftCards = lazy(() => import('./components/admin/AdminGiftCards'));
const AdminSurveys = lazy(() => import('./components/surveys/AdminSurveys'));
const AttendanceKiosk = lazy(() => import('./pages/AttendanceKiosk'));
const AttendanceLogs = lazy(() => import('./components/admin/AttendanceLogs'));
const DgiiSequencesModule = lazy(() => import('./components/admin/DgiiSequencesModule'));
const CreditNotesModule = lazy(() => import('./components/admin/CreditNotesModule'));
const Reporte607Module = lazy(() => import('./components/admin/Reporte607Module'));
const Reporte606Module = lazy(() => import('./components/admin/Reporte606Module'));
const ReporteIT1Module = lazy(() => import('./components/admin/ReporteIT1Module'));
const ExpensesModule = lazy(() => import('./components/admin/ExpensesModule'));
const PayrollModule = lazy(() => import('./components/payroll/PayrollModule'));
const SecurityModule = lazy(() => import('./components/admin/SecurityModule'));
const TenantCustomizationModule = lazy(() => import('./components/admin/TenantCustomizationModule'));

import './index.css';
import Landing from './pages/Landing';
import { PublicHeader, PublicFooter } from './components/common/PublicLayout';
const PlanBelleza = lazy(() => import('./pages/PlanBelleza'));
const ComoFunciona = lazy(() => import('./pages/ComoFunciona'));
const Beneficios = lazy(() => import('./pages/Beneficios'));
const Salones = lazy(() => import('./pages/Salones'));
const SalonDetalle = lazy(() => import('./pages/SalonDetalle'));
const PreguntasFrecuentes = lazy(() => import('./pages/PreguntasFrecuentes'));
const Contacto = lazy(() => import('./pages/Contacto'));
const Legal = lazy(() => import('./pages/Legal'));

const WorkspaceSkeleton = () => (
  <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div className="skeleton-shimmer" style={{ width: '240px', height: '32px', borderRadius: '10px' }} />
      <div className="skeleton-shimmer" style={{ width: '140px', height: '36px', borderRadius: '10px' }} />
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
      {[1, 2, 3, 4].map((n) => (
        <div key={n} className="skeleton-shimmer" style={{ height: '132px', borderRadius: '16px' }} />
      ))}
    </div>
    <div className="skeleton-shimmer" style={{ height: '360px', borderRadius: '16px' }} />
  </div>
);

const SidebarLink = ({ to, icon: Icon, label, active, onClick }) => (
  <Link to={to} onClick={onClick} className={`nav-link ${active ? 'active' : ''}`}>
    <Icon size={18} strokeWidth={active ? 2.5 : 2} />
    <span>{label}</span>
  </Link>
);

const AppContent = () => {
  const { user, logout } = useAuth();
  const { branding } = useTenantBranding();
  const { lang, changeLanguage, t } = useTranslation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isGiftCardModalOpen, setIsGiftCardModalOpen] = useState(false);
  const [isMotivationalModalOpen, setIsMotivationalModalOpen] = useState(false);
  const [isSalesOpen, setIsSalesOpen] = useState(false);
  const [isSubscriptionsOpen, setIsSubscriptionsOpen] = useState(false);
  const [isTeamOpen, setIsTeamOpen] = useState(false);
  const [isAdministrationOpen, setIsAdministrationOpen] = useState(false);
  const [isAccountingOpen, setIsAccountingOpen] = useState(false);
  const [isBiOpen, setIsBiOpen] = useState(false);
  const [isPayrollOpen, setIsPayrollOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const isSalesActive = location.pathname.startsWith('/visitas') || location.pathname.startsWith('/cajas') || location.pathname.startsWith('/facturas') || location.pathname.startsWith('/servicios') || location.pathname.startsWith('/marketing');
  const isClientsActive = location.pathname.startsWith('/lista-clientes') || location.pathname.startsWith('/registro-cliente') || location.pathname.startsWith('/clientes');
  const isSubscriptionsActive = location.pathname.startsWith('/contratos') || location.pathname.startsWith('/pagos') || location.pathname.startsWith('/encuesta') || location.pathname.startsWith('/planes') || location.pathname.startsWith('/regalos');
  const isTeamActive = location.pathname.startsWith('/equipo') || location.pathname.startsWith('/admin/asistencia');
  const isAdministrationActive = location.pathname.startsWith('/seguridad') || location.pathname.startsWith('/configuracion') || location.pathname.startsWith('/sucursales') || location.pathname.startsWith('/personalizacion');
  const isAccountingActive = location.pathname.startsWith('/secuencias-dgii') || location.pathname.startsWith('/contabilidad') || location.pathname.startsWith('/notas-credito') || location.pathname.startsWith('/reporte-607') || location.pathname.startsWith('/reporte-606') || location.pathname.startsWith('/itbis-it1') || location.pathname.startsWith('/egresos');
  const isBiActive = location.pathname.startsWith('/analitica');
  const isPayrollActive = location.pathname.startsWith('/nomina') || location.pathname.startsWith('/comisiones') || location.pathname.startsWith('/descuentos-empleados');

  const isSuperAdmin = user?.role?.toLowerCase() === 'superadmin' || user?.role_name?.toLowerCase()?.includes('superadmin');
  const isOwner = !isSuperAdmin && (user?.role?.toLowerCase() === 'owner' || user?.role?.toLowerCase() === 'propietario');
  const isAdmin = !isSuperAdmin && (isOwner || user?.role?.toLowerCase() === 'admin' || user?.role?.toLowerCase() === 'administrador');
  const isClient = user?.role?.toLowerCase() === 'client' || user?.role?.toLowerCase() === 'cliente';
  const isAccountant = user?.role?.toLowerCase() === 'contador' || user?.role_name?.toLowerCase() === 'contador';

  // Dynamic Entitlements State from SaaS Engine
  const { isPro, isSuspended, hasFeature } = useEntitlements();

  // Control de Planes SaaS (2 niveles: Plan Base vs Plan Pro)
  // Plan Base: POS, Facturación, Catálogo, Cajas, Usuarios y Directorio CRM de Clientes (SIN suscripciones/membresías).
  // Plan Pro: Todo Base + ecosistema de Suscripciones (Plan Beauty), Contratos y Marketing.
  // `hasProPlan` representa EXCLUSIVAMENTE las capacidades PRO (membresías); Clientes se evalúa aparte con `hasClients`.
  const hasProPlan = Boolean(
    !isSuperAdmin && (
      isPro ||
      (!user?.tenant && !user?.tenant_id) ||
      (
        user?.tenant?.plan_code !== 'base' &&
        (
          user?.tenant?.plan_code === 'pro' ||
          user?.tenant?.has_memberships === true ||
          user?.tenant?.included_features?.memberships === true
        )
      )
    )
  );

  // Clientes/CRM está incluido en BASE y PRO (matriz canónica `clients`). Se bloquea solo si la suscripción está suspendida.
  const hasClients = Boolean(
    !isSuperAdmin && !isSuspended && (
      hasFeature('clients') ||
      hasProPlan ||
      user?.tenant?.included_features?.clients === true ||
      user?.tenant?.has_clients === true
    )
  );
  const isReceptionProfile = Boolean(
    !isAdmin &&
    !isClient &&
    !isAccountant &&
    (
      user?.role?.toLowerCase()?.includes('recep') ||
      user?.role_name?.toLowerCase()?.includes('recep') ||
      user?.role?.toLowerCase() === 'cajero' ||
      user?.role_name?.toLowerCase() === 'cajero' ||
      user?.role?.toLowerCase() === 'staff' ||
      (user?.permissions && (user.permissions.process_payments || user.permissions.record_visits) && !user?.permissions?.view_analytics)
    )
  );

  const isDashboard = location.pathname === '/' && Boolean(user) && !isClient;

  const publicIndexablePaths = [
    '/', '/plan-de-belleza', '/como-funciona', '/beneficios', 
    '/salones', '/preguntas-frecuentes', '/contacto', 
    '/terminos-y-condiciones', '/politica-de-privacidad', 
    '/cancelacion-y-reembolsos', '/regalar'
  ];
  
  const isPublicRoute = publicIndexablePaths.some(p => location.pathname === p || (p === '/salones' && location.pathname.startsWith('/salones/'))) ||
    location.pathname === '/login' || location.pathname === '/registro' || location.pathname === '/encuesta' || location.pathname === '/activar' || location.pathname === '/asistencia';

  const handleLogout = () => {
    logout();
    setIsMobileMenuOpen(false);
    window.location.href = '/';
  };

  const toggleMobileMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);
  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  // Auto-scroll to top and manage SEO robots on route change
  useEffect(() => {
    window.scrollTo(0, 0);
    
    const robotsMeta = document.getElementById('robots-meta');
    if (robotsMeta) {
      const isIndexable = publicIndexablePaths.some(p => location.pathname === p || (p === '/salones' && location.pathname.startsWith('/salones/')));
      robotsMeta.setAttribute('content', isIndexable ? 'index, follow' : 'noindex, nofollow');
    }
  }, [location.pathname, user]);

  // Inactividad de 30 minutos (1,800,000 ms) en el Dashboard para mostrar frases motivacionales
  useEffect(() => {
    if (!isDashboard) {
      setIsMotivationalModalOpen(false);
      return;
    }

    const INACTIVITY_LIMIT_MS = 30 * 60 * 1000; // 30 minutos
    let inactivityTimer;

    const resetTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        setIsMotivationalModalOpen(true);
      }, INACTIVITY_LIMIT_MS);
    };

    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    const handleActivity = () => {
      resetTimer();
    };

    activityEvents.forEach(evt => window.addEventListener(evt, handleActivity, { passive: true }));
    resetTimer();

    return () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      activityEvents.forEach(evt => window.removeEventListener(evt, handleActivity));
    };
  }, [isDashboard]);  // Expandir automáticamente el submenú de Ventas si estamos en una ruta de ventas
  useEffect(() => {
    if (isSalesActive) {
      setIsSalesOpen(true);
    }
  }, [isSalesActive]);

  // Expandir automáticamente el submenú de Suscripciones si estamos en una ruta de suscripciones
  useEffect(() => {
    if (isSubscriptionsActive) {
      setIsSubscriptionsOpen(true);
    }
  }, [isSubscriptionsActive]);

  // Expandir automáticamente el submenú de Equipo si estamos en una ruta de equipo
  useEffect(() => {
    if (isTeamActive) {
      setIsTeamOpen(true);
    }
  }, [isTeamActive]);

  // Expandir automáticamente el submenú de Administración si estamos en una ruta de administración
  useEffect(() => {
    if (isAdministrationActive) {
      setIsAdministrationOpen(true);
    }
  }, [isAdministrationActive]);

  // Expandir automáticamente el submenú de Contabilidad si estamos en una ruta contable o si el usuario es Contador
  useEffect(() => {
    if (isAccountingActive || isAccountant) {
      setIsAccountingOpen(true);
    }
  }, [isAccountingActive, isAccountant]);

  // Expandir automáticamente el submenú de Inteligencia de Negocios si estamos en una ruta de analítica
  useEffect(() => {
    if (isBiActive) {
      setIsBiOpen(true);
    }
  }, [isBiActive]);

  // Expandir automáticamente el submenú de Nómina si estamos en una ruta de nómina
  useEffect(() => {
    if (isPayrollActive) {
      setIsPayrollOpen(true);
    }
  }, [isPayrollActive]);

  if (!user) {
    if (location.pathname === '/asistencia') {
      return (
        <Routes>
          <Route path="/asistencia" element={<AttendanceKiosk />} />
        </Routes>
      );
    }
    
    if (location.pathname === '/login') {
      return <Landing initialIsLogin={true} initialAuthModal={true} />;
    }
    if (location.pathname === '/registro') {
      return <Landing initialIsLogin={false} initialAuthModal={true} />;
    }

    const isMarketingRoute = [
      '/plan-de-belleza', '/como-funciona', '/beneficios', 
      '/salones', '/preguntas-frecuentes', '/contacto', 
      '/terminos-y-condiciones', '/politica-de-privacidad', 
      '/cancelacion-y-reembolsos'
    ].some(p => location.pathname === p || location.pathname.startsWith('/salones/'));

    if (isMarketingRoute) {
      return (
        <div className="etereas-landing et-public-shell">
          <PublicHeader />
          <main className="et-public-main">
            <Suspense fallback={<WorkspaceSkeleton />}>
              <Routes>
                <Route path="/plan-de-belleza" element={<PlanBelleza />} />
                <Route path="/como-funciona" element={<ComoFunciona />} />
                <Route path="/beneficios" element={<Beneficios />} />
                <Route path="/salones" element={<Salones />} />
                <Route path="/salones/:slug" element={<SalonDetalle />} />
                <Route path="/preguntas-frecuentes" element={<PreguntasFrecuentes />} />
                <Route path="/contacto" element={<Contacto />} />
                <Route path="/terminos-y-condiciones" element={<Legal page="terms" />} />
                <Route path="/politica-de-privacidad" element={<Legal page="privacy" />} />
                <Route path="/cancelacion-y-reembolsos" element={<Legal page="refunds" />} />
              </Routes>
            </Suspense>
          </main>
          <PublicFooter />
        </div>
      );
    }

    // Default to Landing for "/" and any other route when logged out
    return <Landing initialIsLogin={true} initialAuthModal={false} />;
  }

  if (location.pathname === '/asistencia') {
    return (
      <Suspense fallback={<WorkspaceSkeleton />}>
        <Routes>
          <Route path="/asistencia" element={<AttendanceKiosk />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <div className={`canvas-layout ${isMobileMenuOpen ? 'mobile-menu-open' : ''}`}>
      
      {/* Mobile Toggle Button */}
      <button className="mobile-toggle" onClick={toggleMobileMenu}>
        {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Overlay for mobile */}
      {isMobileMenuOpen && <div className="mobile-overlay" onClick={closeMobileMenu} />}

      {/* Floating Sidebar */}
      <aside className={`floating-sidebar ${isMobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '1.25rem', marginBottom: '1rem' }}>
          <Link to={isSuperAdmin ? "/saas" : "/"} onClick={closeMobileMenu} className="brand" style={{ padding: '0.5rem 0', justifyContent: 'center', width: '100%', display: 'flex', textDecoration: 'none' }}>
            {isSuperAdmin ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ fontSize: '1.35rem', fontWeight: 900, letterSpacing: '-0.02em', color: '#ffffff' }}>Salon<span style={{ color: '#60a5fa' }}>Pro</span></span>
                <span style={{ fontSize: '0.62rem', background: 'rgba(59,130,246,0.25)', color: '#93c5fd', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 800, letterSpacing: '0.05em' }}>CONTROL PLANE</span>
              </div>
            ) : branding?.logo_url ? (
              <img 
                src={branding.logo_url} 
                alt={branding.business_name || 'SalonPro'} 
                style={{ width: '100%', maxWidth: '220px', maxHeight: '55px', height: 'auto', objectFit: 'contain', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))', cursor: 'pointer' }} 
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.25rem', fontWeight: 900, letterSpacing: '-0.02em', color: '#ffffff' }}>
                  {branding?.business_name || 'SalonPro'}
                </span>
              </div>
            )}
          </Link>
        </div>

        <div className="sidebar-user">
          <div className="user-avatar">{(user?.nombre || user?.name || 'U').charAt(0)}</div>
          <div className="user-info">
            <p className="user-name">{user?.nombre || user?.name || 'Usuario'}</p>
            <p className="user-role">{user?.role_name || user?.role || 'Visitante'}</p>
            {!isClient && (
              <span style={{
                display: 'inline-block',
                marginTop: '0.25rem',
                padding: '0.1rem 0.45rem',
                borderRadius: '4px',
                fontSize: '0.65rem',
                fontWeight: 800,
                letterSpacing: '0.03em',
                background: isSuperAdmin ? 'rgba(59,130,246,0.2)' : (hasProPlan ? 'rgba(212,175,55,0.2)' : 'rgba(148,163,184,0.2)'),
                color: isSuperAdmin ? '#60a5fa' : (hasProPlan ? '#fbbf24' : '#cbd5e1'),
                border: `1px solid ${isSuperAdmin ? 'rgba(59,130,246,0.4)' : (hasProPlan ? 'rgba(212,175,55,0.4)' : 'rgba(148,163,184,0.3)')}`
              }}>
                {isSuperAdmin ? 'CONTROL PLANE SAAS' : (hasProPlan ? 'PLAN PRO' : 'PLAN BASE')}
              </span>
            )}
          </div>
        </div>

        <nav className="sidebar-nav hide-scrollbar">
          {isSuperAdmin ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <div style={{ marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <p className="nav-group-title" style={{ color: '#60a5fa', letterSpacing: '0.05em' }}>CONTROL PLANE SAAS</p>
                <SidebarLink
                  to="/saas"
                  icon={Building2}
                  label="Salones & Licencias"
                  active={location.pathname === '/saas' || location.pathname === '/saas/salones'}
                  onClick={closeMobileMenu}
                />
                <SidebarLink
                  to="/saas/planes"
                  icon={Package}
                  label="Planes (Base / Pro)"
                  active={location.pathname === '/saas/planes'}
                  onClick={closeMobileMenu}
                />
                <SidebarLink
                  to="/saas/facturacion"
                  icon={DollarSign}
                  label="Facturación SaaS"
                  active={location.pathname === '/saas/facturacion'}
                  onClick={closeMobileMenu}
                />
              </div>
            </div>
          ) : isClient ? (
            <>
              <p className="nav-group-title">Mi Pantalla</p>
              <SidebarLink to="/" icon={LayoutDashboard} label="Mi Panel" active={location.pathname === '/'} onClick={closeMobileMenu} />
              <SidebarLink to="/mis-servicios" icon={Sparkles} label="Mis Servicios" active={location.pathname === '/mis-servicios'} onClick={closeMobileMenu} />
              <SidebarLink to="/regalar" icon={Gift} label="Regalar" active={location.pathname === '/regalar'} onClick={closeMobileMenu} />
              <div style={{ position: 'relative' }}>
              <SidebarLink to="/encuesta" icon={Star} label="Encuesta" active={location.pathname === '/encuesta'} onClick={closeMobileMenu} />
              </div>
            </>
          ) : (
            <>
              {!isAccountant && (
                <>
                  <p className="nav-group-title">{t('menu.principal')}</p>
                  <SidebarLink to="/" icon={LayoutDashboard} label={t('menu.dashboard')} active={location.pathname === '/'} onClick={closeMobileMenu} />
                  <SidebarLink to="/inventario" icon={Package} label="Inventario" active={location.pathname === '/inventario' || location.pathname === '/inventory'} onClick={closeMobileMenu} />
                </>
              )}
              
              {/* Menú Desplegable Ventas */}
              {!isAccountant && (isAdmin || (user?.permissions && (user.permissions.process_payments || user.permissions.record_visits || user.permissions.manage_salons || user.permissions.manage_services))) && (
                <div style={{ margin: '0.2rem 0' }}>
                  <button
                    type="button"
                    onClick={() => setIsSalesOpen(!isSalesOpen)}
                    className={`nav-dropdown-header ${isSalesActive ? 'active' : ''}`}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <ShoppingCart size={18} strokeWidth={isSalesActive ? 2.5 : 2} style={{ color: isSalesActive ? '#10b981' : 'inherit' }} />
                      <span>Ventas</span>
                    </div>
                    {isSalesOpen ? <ChevronDown size={15} style={{ opacity: 0.7 }} /> : <ChevronRight size={15} style={{ opacity: 0.7 }} />}
                  </button>

                  {/* Submenú de Ventas */}
                  {isSalesOpen && (
                    <div style={{ 
                      marginLeft: '1.25rem', 
                      paddingLeft: '0.65rem', 
                      borderLeft: '2px solid rgba(16,185,129,0.4)',
                      marginTop: '0.35rem',
                      marginBottom: '0.35rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem'
                    }}>
                      {(isAdmin || (user?.permissions && (user.permissions.process_payments || user.permissions.record_visits))) && (
                        <SidebarLink 
                          to="/visitas" 
                          icon={Calendar} 
                          label="Cobro y Ventas (POS)" 
                          active={location.pathname === '/visitas'} 
                          onClick={closeMobileMenu} 
                        />
                      )}
                      {(isAdmin || (user?.permissions && (user.permissions.process_payments || user.permissions.manage_salons))) && (
                        <SidebarLink 
                          to="/cajas" 
                          icon={Wallet} 
                          label="Cajas Registradoras" 
                          active={location.pathname === '/cajas'} 
                          onClick={closeMobileMenu} 
                        />
                      )}
                      {isAdmin && (
                        <SidebarLink 
                          to="/facturas" 
                          icon={Receipt} 
                          label="Historial de Facturas" 
                          active={location.pathname === '/facturas'} 
                          onClick={closeMobileMenu} 
                        />
                      )}
                      {(isAdmin || (user?.permissions && user.permissions.manage_services)) && (
                        <SidebarLink 
                          to="/servicios" 
                          icon={Sparkles} 
                          label="Catálogo" 
                          active={location.pathname === '/servicios'} 
                          onClick={closeMobileMenu} 
                        />
                      )}
                      {(isAdmin || user?.permissions?.manage_marketing) && (
                        <SidebarLink 
                          to="/marketing" 
                          icon={Mail} 
                          label="Marketing" 
                          active={location.pathname === '/marketing'} 
                          onClick={closeMobileMenu} 
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Clientes / CRM: incluido en Plan Base y Plan Pro (feature canónico `clients`) */}
              {hasClients && !isAccountant && (isAdmin || user?.permissions?.manage_clients) && (
                <div style={{ margin: '0.2rem 0' }}>
                  <SidebarLink
                    to="/clientes"
                    icon={Users}
                    label="Clientes"
                    active={isClientsActive && location.pathname !== '/registro-cliente'}
                    onClick={closeMobileMenu}
                  />
                  <SidebarLink
                    to="/registro-cliente"
                    icon={UserPlus}
                    label="Registrar Clientes"
                    active={location.pathname === '/registro-cliente'}
                    onClick={closeMobileMenu}
                  />
                </div>
              )}

              {/* Menú Desplegable Suscripciones (Exclusivo para Plan Pro) */}
              {hasProPlan && !isAccountant && (isAdmin || (user?.permissions && (
                user.permissions.view_contracts || 
                user.permissions.process_payments || 
                user.permissions.manage_surveys ||
                user.permissions.manage_plans ||
                user.permissions.manage_salons
              ))) && (
                <div style={{ margin: '0.2rem 0' }}>
                  <button
                    type="button"
                    onClick={() => setIsSubscriptionsOpen(!isSubscriptionsOpen)}
                    className={`nav-dropdown-header ${isSubscriptionsActive ? 'active' : ''}`}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <Crown size={18} strokeWidth={isSubscriptionsActive ? 2.5 : 2} style={{ color: '#d4af37' }} />
                      <span>Suscripciones</span>
                    </div>
                    {isSubscriptionsOpen ? <ChevronDown size={15} style={{ opacity: 0.7 }} /> : <ChevronRight size={15} style={{ opacity: 0.7 }} />}
                  </button>

                  {/* Submenú de Suscripciones */}
                  {isSubscriptionsOpen && (
                    <div style={{ 
                      marginLeft: '1.25rem', 
                      paddingLeft: '0.65rem', 
                      borderLeft: '2px solid rgba(212,175,55,0.4)',
                      marginTop: '0.35rem',
                      marginBottom: '0.35rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem'
                    }}>
                      {(isAdmin || user?.permissions?.view_contracts) && (
                        <SidebarLink 
                          to="/contratos" 
                          icon={FileSignature} 
                          label="Contratos" 
                          active={location.pathname === '/contratos'} 
                          onClick={closeMobileMenu} 
                        />
                      )}
                      {(isAdmin || user?.permissions?.process_payments) && (
                        <SidebarLink 
                          to="/pagos" 
                          icon={CreditCard} 
                          label="Pagos" 
                          active={location.pathname === '/pagos'} 
                          onClick={closeMobileMenu} 
                        />
                      )}
                      {(isAdmin || user?.permissions?.manage_surveys) && (
                        <SidebarLink 
                          to="/encuesta" 
                          icon={Star} 
                          label="Encuestas" 
                          active={location.pathname === '/encuesta'} 
                          onClick={closeMobileMenu} 
                        />
                      )}
                      {(isAdmin || user?.permissions?.manage_plans) && (
                        <SidebarLink 
                          to="/planes" 
                          icon={PieChart} 
                          label="Planes de Membresía" 
                          active={location.pathname === '/planes'} 
                          onClick={closeMobileMenu} 
                        />
                      )}
                      {(isAdmin || user?.permissions?.manage_salons) && (
                        <SidebarLink 
                          to="/sucursales" 
                          icon={MapPin} 
                          label="Sucursales" 
                          active={location.pathname === '/sucursales'} 
                          onClick={closeMobileMenu} 
                        />
                      )}
                      <SidebarLink 
                        to="/regalos" 
                        icon={Gift} 
                        label="Gift Cards" 
                        active={location.pathname === '/regalos'} 
                        onClick={closeMobileMenu} 
                      />
                      <button 
                        type="button"
                        onClick={() => { setIsGiftCardModalOpen(true); closeMobileMenu(); }}
                        className="nav-link"
                        style={{
                          width: '100%',
                          background: 'none',
                          border: 'none',
                          color: '#d4af37',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          textAlign: 'left',
                          padding: '0.5rem 0.75rem'
                        }}
                      >
                        <Gift size={18} />
                        <span>Validar Gift Card</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Menú Desplegable Equipo */}
              {!isAccountant && (isAdmin || (user?.permissions && (user.permissions.manage_staff || user.permissions.manage_attendance || user?.role_name?.toLowerCase()?.includes('recep')))) && (
                <div style={{ margin: '0.2rem 0' }}>
                  <button
                    type="button"
                    onClick={() => setIsTeamOpen(!isTeamOpen)}
                    className={`nav-dropdown-header ${isTeamActive ? 'active' : ''}`}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <Users size={18} strokeWidth={isTeamActive ? 2.5 : 2} style={{ color: isTeamActive ? '#38bdf8' : 'inherit' }} />
                      <span>Equipo</span>
                    </div>
                    {isTeamOpen ? <ChevronDown size={15} style={{ opacity: 0.7 }} /> : <ChevronRight size={15} style={{ opacity: 0.7 }} />}
                  </button>

                  {/* Submenú de Equipo */}
                  {isTeamOpen && (
                    <div style={{ 
                      marginLeft: '1.25rem', 
                      paddingLeft: '0.65rem', 
                      borderLeft: '2px solid rgba(56,189,248,0.4)',
                      marginTop: '0.35rem',
                      marginBottom: '0.35rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem'
                    }}>
                      {(isAdmin || user?.permissions?.manage_staff) && (
                        <SidebarLink 
                          to="/equipo" 
                          icon={Users} 
                          label="Personal" 
                          active={location.pathname === '/equipo'} 
                          onClick={closeMobileMenu} 
                        />
                      )}
                      {(isAdmin || user?.permissions?.manage_attendance || user?.role_name?.toLowerCase()?.includes('recep')) && (
                        <SidebarLink 
                          to="/admin/asistencia" 
                          icon={Clock} 
                          label="Control de Asistencia" 
                          active={location.pathname === '/admin/asistencia'} 
                          onClick={closeMobileMenu} 
                        />
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {!isAccountant && (isAdmin || 
            user?.permissions?.manage_staff || 
            user?.permissions?.view_analytics || 
            user?.permissions?.manage_salons || 
            user?.permissions?.manage_marketing || 
            user?.permissions?.manage_security ||
            user?.permissions?.manage_commissions ||
            user?.role_name?.toLowerCase()?.includes('recep')) && (
            <>
              <p className="nav-group-title">{t('menu.admin')}</p>
              
              {/* Menú Desplegable Administración */}
              {(isAdmin || user?.permissions?.manage_security) && (
                <div style={{ margin: '0.2rem 0' }}>
                  <button
                    type="button"
                    onClick={() => setIsAdministrationOpen(!isAdministrationOpen)}
                    className={`nav-dropdown-header ${isAdministrationActive ? 'active' : ''}`}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <Shield size={18} strokeWidth={isAdministrationActive ? 2.5 : 2} style={{ color: isAdministrationActive ? '#a855f7' : 'inherit' }} />
                      <span>Administración</span>
                    </div>
                    {isAdministrationOpen ? <ChevronDown size={15} style={{ opacity: 0.7 }} /> : <ChevronRight size={15} style={{ opacity: 0.7 }} />}
                  </button>

                  {/* Submenú de Administración */}
                  {isAdministrationOpen && (
                    <div style={{ 
                      marginLeft: '1.25rem', 
                      paddingLeft: '0.65rem', 
                      borderLeft: '2px solid rgba(168,85,247,0.4)',
                      marginTop: '0.35rem',
                      marginBottom: '0.35rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem'
                    }}>
                      {(isAdmin || user?.permissions?.manage_security) && (
                        <SidebarLink 
                          to="/seguridad?tab=users" 
                          icon={UserCheck} 
                          label="Usuarios" 
                          active={location.pathname === '/seguridad' && (!location.search || location.search.includes('tab=users'))} 
                          onClick={closeMobileMenu} 
                        />
                      )}
                      {(isAdmin || user?.permissions?.manage_security) && (
                        <SidebarLink 
                          to="/seguridad?tab=roles" 
                          icon={Key} 
                          label="Roles y Permisos" 
                          active={location.pathname === '/seguridad' && location.search.includes('tab=roles')} 
                          onClick={closeMobileMenu} 
                        />
                      )}
                      {(isAdmin || user?.permissions?.manage_security) && (
                        <SidebarLink 
                          to="/seguridad?tab=pin_settings" 
                          icon={Shield} 
                          label="Seguridad & PIN" 
                          active={location.pathname === '/seguridad' && (location.search.includes('tab=pin_settings') || location.search.includes('tab=security') || location.search.includes('tab=monitoring') || location.search.includes('tab=access_control'))} 
                          onClick={closeMobileMenu} 
                        />
                      )}
                      {isAdmin && (
                        <SidebarLink 
                          to="/sucursales" 
                          icon={MapPin} 
                          label="Sucursales" 
                          active={location.pathname === '/sucursales'} 
                          onClick={closeMobileMenu} 
                        />
                      )}
                      {isAdmin && (
                        <SidebarLink 
                          to="/personalizacion" 
                          icon={Palette} 
                          label="Personalización & Plan" 
                          active={location.pathname === '/personalizacion'} 
                          onClick={closeMobileMenu} 
                        />
                      )}
                      {isOwner && (
                        <SidebarLink 
                          to="/facturacion-saas" 
                          icon={CreditCard} 
                          label="Mi suscripción" 
                          active={location.pathname === '/facturacion-saas' || location.pathname === '/billing'} 
                          onClick={closeMobileMenu} 
                        />
                      )}
                      {isAdmin && (
                        <SidebarLink 
                          to="/configuracion" 
                          icon={Settings} 
                          label="Configuración" 
                          active={location.pathname === '/configuracion'} 
                          onClick={closeMobileMenu} 
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Menú Desplegable Nómina */}
              {(isAdmin || user?.permissions?.manage_staff || user?.permissions?.manage_commissions) && (
                <div style={{ margin: '0.2rem 0' }}>
                  <button
                    type="button"
                    onClick={() => setIsPayrollOpen(!isPayrollOpen)}
                    className={`nav-dropdown-header ${isPayrollActive ? 'active' : ''}`}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <Wallet size={18} strokeWidth={isPayrollActive ? 2.5 : 2} />
                      <span>Nómina</span>
                    </div>
                    {isPayrollOpen ? <ChevronDown size={15} style={{ opacity: 0.7 }} /> : <ChevronRight size={15} style={{ opacity: 0.7 }} />}
                  </button>

                  {/* Submenú de Nómina */}
                  {isPayrollOpen && (
                    <div style={{ 
                      marginLeft: '1.25rem', 
                      paddingLeft: '0.65rem', 
                      borderLeft: '2px solid rgba(255,255,255,0.15)',
                      marginTop: '0.35rem',
                      marginBottom: '0.35rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem'
                    }}>
                      <SidebarLink 
                        to="/nomina" 
                        icon={DollarSign} 
                        label="Procesar Nómina" 
                        active={location.pathname === '/nomina' && (!location.search || location.search.includes('tab=payroll'))} 
                        onClick={closeMobileMenu} 
                      />
                      <SidebarLink 
                        to="/nomina/historial" 
                        icon={History} 
                        label="Historial de Nóminas" 
                        active={location.pathname === '/nomina/historial' || (location.pathname === '/nomina' && (location.search.includes('tab=historial') || location.search.includes('tab=historical')))} 
                        onClick={closeMobileMenu} 
                      />
                      <SidebarLink 
                        to="/nomina/regalias" 
                        icon={Sparkles} 
                        label="Regalías del Año" 
                        active={location.pathname === '/nomina/regalias' || (location.pathname === '/nomina' && location.search.includes('tab=regalias'))} 
                        onClick={closeMobileMenu} 
                      />
                      {(isAdmin || (user?.permissions && (user.permissions.manage_commissions || user.permissions.manage_staff))) && (
                        <SidebarLink 
                          to="/comisiones" 
                          icon={Percent} 
                          label="Comisiones" 
                          active={location.pathname === '/comisiones'} 
                          onClick={closeMobileMenu} 
                        />
                      )}
                      {(isAdmin || (user?.permissions && (user.permissions.manage_staff || user.permissions.manage_commissions))) && (
                        <SidebarLink 
                          to="/descuentos-empleados" 
                          icon={BadgePercent} 
                          label="Descuentos Empleados" 
                          active={location.pathname === '/descuentos-empleados'} 
                          onClick={closeMobileMenu} 
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              
              {/* Menú Desplegable Inteligencia de Negocios (BI) */}
              {(isAdmin || user?.permissions?.view_analytics) && (
                <div style={{ margin: '0.2rem 0' }}>
                  <button
                    type="button"
                    onClick={() => setIsBiOpen(!isBiOpen)}
                    className={`nav-dropdown-header ${isBiActive ? 'active' : ''}`}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <TrendingUp size={18} strokeWidth={isBiActive ? 2.5 : 2} />
                      <span>Inteligencia de Negocios</span>
                    </div>
                    {isBiOpen ? <ChevronDown size={15} style={{ opacity: 0.7 }} /> : <ChevronRight size={15} style={{ opacity: 0.7 }} />}
                  </button>

                  {/* Submenú de Inteligencia de Negocios - Solo Tablero BI Ejecutivo */}
                  {isBiOpen && (
                    <div style={{ 
                      marginLeft: '1.25rem', 
                      paddingLeft: '0.65rem', 
                      borderLeft: '2px solid rgba(255,255,255,0.15)',
                      marginTop: '0.35rem',
                      marginBottom: '0.35rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem'
                    }}>
                      <SidebarLink 
                        to="/analitica?tab=bi_executive" 
                        icon={Sparkles} 
                        label="Tablero BI Ejecutivo" 
                        active={location.pathname === '/analitica' && (location.search.includes('tab=bi_executive') || !location.search)} 
                        onClick={closeMobileMenu} 
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Módulo Contable para Administrador y Contador (Independiente del bloque de administración operativa) */}
          {(isAdmin || isAccountant) && (
            <>
              {isAccountant && <p className="nav-group-title">Módulo Contable</p>}
              {/* Menú Desplegable Contabilidad */}
              <div style={{ margin: '0.2rem 0' }}>
                <button
                  type="button"
                  onClick={() => setIsAccountingOpen(!isAccountingOpen)}
                  className={`nav-dropdown-header ${isAccountingActive ? 'active' : ''}`}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <Landmark size={18} strokeWidth={isAccountingActive ? 2.5 : 2} />
                    <span>Contabilidad</span>
                  </div>
                  {isAccountingOpen ? <ChevronDown size={15} style={{ opacity: 0.7 }} /> : <ChevronRight size={15} style={{ opacity: 0.7 }} />}
                </button>

                {/* Submenú de Contabilidad */}
                {isAccountingOpen && (
                  <div style={{ 
                    marginLeft: '1.25rem', 
                    paddingLeft: '0.65rem', 
                    borderLeft: '2px solid rgba(255,255,255,0.15)',
                    marginTop: '0.35rem',
                    marginBottom: '0.35rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem'
                  }}>
                    <SidebarLink 
                      to="/secuencias-dgii" 
                      icon={Receipt} 
                      label="Secuencias DGII e-CF" 
                      active={location.pathname === '/secuencias-dgii'} 
                      onClick={closeMobileMenu} 
                    />
                    <SidebarLink 
                      to="/contabilidad/notas-credito" 
                      icon={ArrowDownLeft} 
                      label="Notas de Crédito" 
                      active={location.pathname === '/contabilidad/notas-credito' || location.pathname === '/notas-credito'} 
                      onClick={closeMobileMenu} 
                    />
                    <SidebarLink 
                      to="/contabilidad/reporte-607" 
                      icon={FileSpreadsheet} 
                      label="Reporte 607 DGII" 
                      active={location.pathname === '/contabilidad/reporte-607' || location.pathname === '/reporte-607'} 
                      onClick={closeMobileMenu} 
                    />
                    <SidebarLink 
                      to="/contabilidad/reporte-606" 
                      icon={FileSpreadsheet} 
                      label="Reporte 606 DGII" 
                      active={location.pathname === '/contabilidad/reporte-606' || location.pathname === '/reporte-606'} 
                      onClick={closeMobileMenu} 
                    />
                    <SidebarLink 
                      to="/contabilidad/itbis-it1" 
                      icon={Landmark} 
                      label="ITBIS (IT-1)" 
                      active={location.pathname === '/contabilidad/itbis-it1' || location.pathname === '/itbis-it1'} 
                      onClick={closeMobileMenu} 
                    />
                    <SidebarLink 
                      to="/contabilidad/egresos" 
                      icon={ArrowDownCircle} 
                      label="Egresos" 
                      active={location.pathname === '/contabilidad/egresos' || location.pathname === '/egresos'} 
                      onClick={closeMobileMenu} 
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <button onClick={handleLogout} className="logout-btn">
            <LogOut size={18} />
            <span>{t('btn.logout')}</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-surface">

        <div 
          className="content-area hide-scrollbar" 
          style={{ 
            background: '#ffffff', 
            padding: (location.pathname === '/visitas' || (location.pathname === '/' && isReceptionProfile)) 
              ? '0' 
              : (location.pathname === '/' ? '1.25rem 2rem 2rem 2rem' : '2rem') 
          }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.15 }}
              className="content-wrapper"
              style={{ 
                minHeight: '100%',
                maxWidth: (location.pathname === '/visitas' || (location.pathname === '/' && isReceptionProfile)) ? '100%' : undefined,
                margin: (location.pathname === '/visitas' || (location.pathname === '/' && isReceptionProfile)) ? '0' : '0 auto'
              }}
            >
              <Suspense fallback={<WorkspaceSkeleton />}>
                <Routes location={location}>
                  <Route path="/" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isClient ? <ClientDashboard /> : (isAccountant ? <Navigate to="/egresos" replace /> : (isReceptionProfile ? <ReceptionDashboard /> : <Dashboard />)))} />
                  <Route path="/saas" element={isSuperAdmin ? <SuperAdminDashboard initialTab="tenants" /> : <Navigate to="/" replace />} />
                  <Route path="/saas/salones" element={isSuperAdmin ? <SuperAdminDashboard initialTab="tenants" /> : <Navigate to="/" replace />} />
                  <Route path="/saas/planes" element={isSuperAdmin ? <SuperAdminDashboard initialTab="plans" /> : <Navigate to="/" replace />} />
                  <Route path="/saas/facturacion" element={isSuperAdmin ? <SuperAdminDashboard initialTab="invoices" /> : <Navigate to="/" replace />} />
                  <Route path="/facturacion" element={<Navigate to={isSuperAdmin ? "/saas" : "/visitas"} replace />} />
                  <Route path="/personalizacion" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isAdmin ? <TenantCustomizationModule /> : <Navigate to="/" replace />)} />
                  <Route path="/registro-cliente" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isClient ? <Navigate to="/" replace /> : (!hasClients ? <FeatureForbiddenGate featureName="El registro de Clientas" /> : <ClientRegistration />))} />
                  <Route path="/lista-clientes" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isClient ? <Navigate to="/" replace /> : (!hasClients ? <FeatureForbiddenGate featureName="El directorio CRM de Clientas" /> : <ClientProfile />))} />
                  <Route path="/clientes" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isClient ? <Navigate to="/" replace /> : (!hasClients ? <FeatureForbiddenGate featureName="El directorio CRM de Clientas" /> : <ClientProfile />))} />
                  <Route path="/visitas" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isAccountant ? <Navigate to="/egresos" replace /> : (isClient ? <Navigate to="/" /> : <VisitRecorder />))} />
                  <Route path="/cajas" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isAccountant ? <Navigate to="/egresos" replace /> : ((isAdmin || (user?.permissions && user.permissions.process_payments)) ? <CashRegistersModule /> : <Navigate to="/" />))} />
                  <Route path="/facturas" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isAccountant ? <Navigate to="/egresos" replace /> : (isAdmin ? <InvoiceHistory /> : <Navigate to="/" />))} />
                  <Route path="/descuentos-empleados" element={isSuperAdmin ? <Navigate to="/saas" replace /> : ((isAdmin || (user?.permissions && (user.permissions.manage_staff || user.permissions.manage_commissions))) ? <EmployeeDiscountsModule /> : <Navigate to="/" />)} />
                  <Route path="/servicios" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isClient ? <Navigate to="/" /> : <ServiceManagement />)} />
                  <Route path="/inventario" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isClient ? <Navigate to="/" /> : <InventoryModule />)} />
                  <Route path="/inventory" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isClient ? <Navigate to="/" /> : <InventoryModule />)} />
                  <Route path="/billing" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isOwner ? <SaasBillingModule /> : <Navigate to="/" replace />)} />
                  <Route path="/facturacion-saas" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isOwner ? <SaasBillingModule /> : <Navigate to="/" replace />)} />
                  <Route path="/comisiones" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isClient ? <Navigate to="/" /> : <CommissionManagement />)} />
                  <Route path="/encuesta" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (!hasProPlan ? <FeatureForbiddenGate featureName="El sistema de Encuestas de Satisfacción" /> : ((isAdmin || (user?.permissions && user.permissions.manage_surveys)) ? <AdminSurveys /> : <SatisfactionSurvey />))} />
                  <Route path="/regalos" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (!hasProPlan ? <FeatureForbiddenGate featureName="El módulo de Gift Cards y Certificados" /> : (isAdmin ? <AdminGiftCards /> : <GiftCertificates />))} />
                  <Route path="/regalar" element={isSuperAdmin ? <Navigate to="/saas" replace /> : <GiftCertificates />} />
                  <Route path="/mis-servicios" element={isSuperAdmin ? <Navigate to="/saas" replace /> : <ClientServices />} />
                  <Route path="/activar" element={<ActivateAccount />} />
                  <Route path="/equipo" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isAccountant ? <Navigate to="/egresos" replace /> : (isAdmin ? <StaffModule /> : <Navigate to="/" />))} />
                  <Route path="/nomina" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isAccountant ? <Navigate to="/egresos" replace /> : (isAdmin ? <PayrollModule /> : <Navigate to="/" />))} />
                  <Route path="/nomina/historial" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isAdmin ? <PayrollModule initialTab="historical" /> : <Navigate to="/" />)} />
                  <Route path="/nomina/regalias" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isAdmin ? <PayrollModule initialTab="regalias" /> : <Navigate to="/" />)} />
                  <Route path="/seguridad" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isAccountant ? <Navigate to="/egresos" replace /> : (isAdmin ? <SecurityModule /> : <Navigate to="/" />))} />
                  <Route path="/sucursales" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isAdmin ? <SalonsModule /> : <Navigate to="/" />)} />
                  <Route path="/membresias" element={isSuperAdmin ? <Navigate to="/saas" replace /> : ((!hasProPlan && !isAdmin) ? <Navigate to="/" replace /> : (!hasProPlan ? <FeatureForbiddenGate featureName="El catálogo de Membresías Plan Beauty" /> : <PlansModule />))} />
                  <Route path="/planes" element={isSuperAdmin ? <Navigate to="/saas" replace /> : ((!hasProPlan && !isAdmin) ? <Navigate to="/" replace /> : (!hasProPlan ? <FeatureForbiddenGate featureName="El catálogo de Membresías Plan Beauty" /> : <PlansModule />))} />
                  <Route path="/pagos" element={isSuperAdmin ? <Navigate to="/saas" replace /> : ((!hasProPlan && !isAdmin) ? <Navigate to="/" replace /> : (!hasProPlan ? <FeatureForbiddenGate featureName="El módulo de Pagos Recurrentes de Membresías" /> : <Payments />))} />
                  <Route path="/marketing" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isAdmin ? <MarketingModule /> : <Navigate to="/" />)} />
                  <Route path="/analitica" element={isSuperAdmin ? <Navigate to="/saas" replace /> : ((isAdmin || user?.permissions?.view_analytics) ? <ServiceAnalytics /> : <Navigate to="/" />)} />
                  <Route path="/bi" element={isSuperAdmin ? <Navigate to="/saas" replace /> : ((isAdmin || user?.permissions?.view_analytics) ? <Navigate to="/analitica?tab=bi_executive" replace /> : <Navigate to="/" />)} />
                  <Route path="/inteligencia-negocios" element={isSuperAdmin ? <Navigate to="/saas" replace /> : ((isAdmin || user?.permissions?.view_analytics) ? <Navigate to="/analitica?tab=bi_executive" replace /> : <Navigate to="/" />)} />
                  <Route path="/contabilidad" element={isSuperAdmin ? <Navigate to="/saas" replace /> : ((isAdmin || isAccountant) ? <Navigate to="/egresos" replace /> : <Navigate to="/" />)} />
                  <Route path="/secuencias-dgii" element={isSuperAdmin ? <Navigate to="/saas" replace /> : ((isAdmin || isAccountant) ? <DgiiSequencesModule /> : <Navigate to="/" />)} />
                  <Route path="/contabilidad/notas-credito" element={isSuperAdmin ? <Navigate to="/saas" replace /> : ((isAdmin || isAccountant) ? <CreditNotesModule /> : <Navigate to="/" />)} />
                  <Route path="/notas-credito" element={isSuperAdmin ? <Navigate to="/saas" replace /> : ((isAdmin || isAccountant) ? <CreditNotesModule /> : <Navigate to="/" />)} />
                  <Route path="/contabilidad/reporte-607" element={isSuperAdmin ? <Navigate to="/saas" replace /> : ((isAdmin || isAccountant) ? <Reporte607Module /> : <Navigate to="/" />)} />
                  <Route path="/reporte-607" element={isSuperAdmin ? <Navigate to="/saas" replace /> : ((isAdmin || isAccountant) ? <Reporte607Module /> : <Navigate to="/" />)} />
                  <Route path="/contabilidad/reporte-606" element={isSuperAdmin ? <Navigate to="/saas" replace /> : ((isAdmin || isAccountant) ? <Reporte606Module /> : <Navigate to="/" />)} />
                  <Route path="/reporte-606" element={isSuperAdmin ? <Navigate to="/saas" replace /> : ((isAdmin || isAccountant) ? <Reporte606Module /> : <Navigate to="/" />)} />
                  <Route path="/contabilidad/itbis-it1" element={isSuperAdmin ? <Navigate to="/saas" replace /> : ((isAdmin || isAccountant) ? <ReporteIT1Module /> : <Navigate to="/" />)} />
                  <Route path="/itbis-it1" element={isSuperAdmin ? <Navigate to="/saas" replace /> : ((isAdmin || isAccountant) ? <ReporteIT1Module /> : <Navigate to="/" />)} />
                  <Route path="/contabilidad/egresos" element={isSuperAdmin ? <Navigate to="/saas" replace /> : ((isAdmin || isAccountant) ? <ExpensesModule /> : <Navigate to="/" />)} />
                  <Route path="/egresos" element={isSuperAdmin ? <Navigate to="/saas" replace /> : ((isAdmin || isAccountant) ? <ExpensesModule /> : <Navigate to="/" />)} />
                  <Route path="/configuracion" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isAdmin ? <SettingsModule /> : <Navigate to="/" />)} />
                  <Route path="/contratos" element={isSuperAdmin ? <Navigate to="/saas" replace /> : (isClient ? <Navigate to="/" replace /> : (!hasProPlan ? <FeatureForbiddenGate featureName="El registro de Contratos Digitales" /> : <DigitalContract />))} />
                  <Route path="/admin/asistencia" element={isSuperAdmin ? <Navigate to="/saas" replace /> : ((isAdmin || user?.permissions?.manage_attendance || user?.role?.toLowerCase() === 'recepcion' || user?.role?.toLowerCase() === 'recepcionista' || user?.role_name?.toLowerCase()?.includes('recep')) ? <AttendanceLogs /> : <Navigate to="/" />)} />
                  <Route path="/test-cardnet" element={<CardNetTest />} />
                  {/* Public marketing pages inside logged-in dashboard wrapper */}
                  <Route path="/plan-de-belleza" element={<PlanBelleza />} />
                  <Route path="/como-funciona" element={<ComoFunciona />} />
                  <Route path="/beneficios" element={<Beneficios />} />
                  <Route path="/salones" element={<Salones />} />
                  <Route path="/salones/:slug" element={<SalonDetalle />} />
                  <Route path="/preguntas-frecuentes" element={<PreguntasFrecuentes />} />
                  <Route path="/contacto" element={<Contacto />} />
                  <Route path="/terminos-y-condiciones" element={<Legal page="terms" />} />
                  <Route path="/politica-de-privacidad" element={<Legal page="privacy" />} />
                  <Route path="/cancelacion-y-reembolsos" element={<Legal page="refunds" />} />
                  {/* 404 Catch-All Route */}
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <GiftCardValidator 
        isOpen={isGiftCardModalOpen} 
        onClose={() => setIsGiftCardModalOpen(false)} 
      />

      <ReceptionMotivationalModal
        isOpen={isMotivationalModalOpen}
        onClose={() => setIsMotivationalModalOpen(false)}
        userName={user?.nombre || user?.name || 'Recepción'}
        salonName={user?.salon_name || 'Plan Beauty'}
      />
    </div>
  );
};


const NotificationBell = () => {
  const { persistentNotifications, removePersistent, markAllRead } = useNotification();
  const [isOpen, setIsOpen] = useState(false);
  const unreadCount = persistentNotifications.filter(n => !n.read).length;

  return (
    <div style={{ position: 'relative' }}>
      <button className="icon-btn" onClick={() => { setIsOpen(!isOpen); if (!isOpen) markAllRead(); }}>
        <Bell size={18} />
        {unreadCount > 0 && (
          <span style={{ position: 'absolute', top: '-2px', right: '-2px', background: '#ef4444', color: 'white', fontSize: '9px', fontWeight: 900, width: '16px', height: '16px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid white' }}>
            {unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 998 }} onClick={() => setIsOpen(false)} />
            <motion.div 
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              style={{ position: 'absolute', top: '100%', right: 0, marginTop: '1rem', width: '320px', background: 'white', borderRadius: '16px', boxShadow: '0 20px 40px rgba(0,0,0,0.15)', border: '1px solid var(--border-subtle)', zIndex: 999, overflow: 'hidden' }}
            >
              <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-canvas)' }}>
                <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 800 }}>Notificaciones</h4>
                <button onClick={() => markAllRead()} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', fontSize: '0.65rem', fontWeight: 700, cursor: 'pointer' }}>Leído</button>
              </div>
              <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
                {persistentNotifications.length > 0 ? persistentNotifications.map(n => (
                  <div key={n.id} style={{ padding: '1rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: '0.75rem', background: n.read ? 'white' : '#f8fafc' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '10px', background: n.type === 'success' ? '#f0fdf4' : n.type === 'error' ? '#fff1f2' : '#f0f9ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                       <Bell size={14} color={n.type === 'success' ? '#10b981' : n.type === 'error' ? '#ef4444' : '#0ea5e9'} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: '0 0 0.2rem 0', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>{n.message}</p>
                      <p style={{ margin: 0, fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{new Date(n.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                  </div>
                )) : (
                  <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    <p style={{ fontSize: '0.8rem' }}>No hay alertas</p>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

const DemoBanner = () => {
  const [isDemo, setIsDemo] = useState(() => {
    return typeof window !== 'undefined' && (
      Boolean(import.meta.env.VITE_DEMO_MODE) ||
      Boolean(window.__SALON_PRO_DEMO__)
    );
  });

  useEffect(() => {
    if (isDemo) return;
    let isMounted = true;
    fetch('/api/demo/status')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (isMounted && data?.isDemo) {
          setIsDemo(true);
        }
      })
      .catch(() => {});
    return () => { isMounted = false; };
  }, [isDemo]);

  if (!isDemo) return null;

  return (
    <aside
      role="banner"
      aria-label="Aviso de Modo Demostración"
      style={{
        backgroundColor: '#dc2626',
        color: '#ffffff',
        textAlign: 'center',
        padding: '0.45rem 1rem',
        fontSize: '0.8rem',
        fontWeight: 800,
        letterSpacing: '0.04em',
        position: 'sticky',
        top: 0,
        zIndex: 9999999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        borderBottom: '1px solid rgba(255,255,255,0.2)'
      }}
    >
      <span aria-hidden="true" style={{ fontSize: '1rem' }}>⚠️</span>
      <span>DEMO LOCAL — DATOS NO PERSISTENTES</span>
      <span style={{
        fontSize: '0.65rem',
        background: 'rgba(0,0,0,0.25)',
        padding: '2px 8px',
        borderRadius: '999px',
        border: '1px solid rgba(255,255,255,0.3)'
      }}>
        MEMORIA VOLÁTIL (ZERO POSTGRESQL)
      </span>
    </aside>
  );
};

const App = () => (
  <ErrorBoundary>
    <NotificationProvider>
      <AuthProvider>
        <LanguageProvider>
          <Router>
            <EntitlementsProvider>
              <TenantBrandingProvider>
                <DemoBanner />
                <AppContent />
              </TenantBrandingProvider>
            </EntitlementsProvider>
          </Router>
        </LanguageProvider>
      </AuthProvider>
    </NotificationProvider>
  </ErrorBoundary>
);

export default App;
