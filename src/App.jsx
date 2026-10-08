import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LayoutDashboard, Users, Calendar, LogOut, Menu, X, CreditCard,
  FileSignature, PieChart, Bell, Settings, User, TrendingUp, Mail, Gift, Search, MapPin,
  Sparkles, Star, UserPlus, Clock, Phone, Percent, Receipt, Wallet, BadgePercent,
  Landmark, ChevronDown, ChevronRight, FileSpreadsheet, ArrowDownLeft, Shield, DollarSign, History,
  Crown, ShoppingCart, UserCheck, Key
} from 'lucide-react';

import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useTranslation } from './context/LanguageContext';
import { NotificationProvider, useNotification } from './context/NotificationContext';
import ErrorBoundary from './components/common/ErrorBoundary';

// Pages & Components
import Login from './pages/Login';
import Dashboard from './components/admin/Dashboard';
import ClientDashboard from './components/clients/ClientDashboard';
import ClientRegistration from './components/clients/ClientRegistration';
import VisitRecorder from './components/visits/VisitRecorder';
import InvoiceHistory from './components/admin/InvoiceHistory';
import CashRegistersModule from './components/admin/CashRegistersModule';
import EmployeeDiscountsModule from './components/admin/EmployeeDiscountsModule';
import SatisfactionSurvey from './components/surveys/SatisfactionSurvey';
import GiftCertificates from './components/surveys/GiftCertificates';
import ClientServices from './components/clients/ClientServices';
import ActivateAccount from './pages/ActivateAccount';
import CardNetTest from './pages/CardNetTest';
import DigitalContract from './components/contracts/DigitalContract';
import ServiceManagement from './components/services/ServiceManagement';
import CommissionManagement from './components/commissions/CommissionManagement';
import Payments from './components/admin/Payments';
import PlansModule from './components/admin/PlansModule';
import ClientProfile from './components/clients/ClientProfile';
import MarketingModule from './components/admin/MarketingModule';
import ServiceAnalytics from './components/admin/ServiceAnalytics';
import StaffModule from './components/admin/StaffModule';
import SalonsModule from './components/admin/SalonsModule';
import SettingsModule from './components/admin/SettingsModule';
import AdminGiftCards from './components/admin/AdminGiftCards';
import AdminSurveys from './components/surveys/AdminSurveys';
import GiftCardValidator from './components/admin/GiftCardValidator';
import AttendanceKiosk from './pages/AttendanceKiosk';
import AttendanceLogs from './components/admin/AttendanceLogs';
import DgiiSequencesModule from './components/admin/DgiiSequencesModule';
import CreditNotesModule from './components/admin/CreditNotesModule';
import Reporte607Module from './components/admin/Reporte607Module';
import PayrollModule from './components/payroll/PayrollModule';
import SecurityModule from './components/admin/SecurityModule';
import ReceptionMotivationalModal from './components/common/ReceptionMotivationalModal';
import ReceptionDashboard from './components/reception/ReceptionDashboard';

import './index.css';
import Landing from './pages/Landing';
import PlanBelleza from './pages/PlanBelleza';
import ComoFunciona from './pages/ComoFunciona';
import Beneficios from './pages/Beneficios';
import Salones from './pages/Salones';
import SalonDetalle from './pages/SalonDetalle';
import PreguntasFrecuentes from './pages/PreguntasFrecuentes';
import Contacto from './pages/Contacto';
import Legal from './pages/Legal';

// Public header and footer layouts for marketing pages (when not logged in)
const PublicHeader = () => (
  <header className="landing-header">
    <div className="container">
      <nav className="landing-nav">
        <div className="logo">
          <Link to="/">PLAN<span>BEAUTY</span>RD</Link>
          <p>TU PLAN, TU BELLEZA</p>
        </div>
        <ul className="nav-links">
          <li><Link to="/">Inicio</Link></li>
          <li><Link to="/plan-de-belleza">Plan</Link></li>
          <li><Link to="/como-funciona">¿Cómo funciona?</Link></li>
          <li><Link to="/salones">Sucursales</Link></li>
        </ul>
        <Link to="/login" className="login-btn-nav" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <User size={18} />
          <span>INICIAR SESIÓN</span>
        </Link>
      </nav>
    </div>
  </header>
);

const PublicFooter = () => (
  <footer className="landing-footer" style={{ marginTop: 'auto' }}>
    <div className="container footer-grid">
      <div className="footer-brand">
        <div className="logo">
          <Link to="/">PLAN<span>BEAUTY</span>RD</Link>
        </div>
        <p>Belleza, confianza y profesionalismo en cada servicio.</p>
      </div>
      <div className="footer-links-col">
        <h4>LEGAL</h4>
        <ul>
          <li><Link to="/terminos-y-condiciones">Términos y condiciones</Link></li>
          <li><Link to="/politica-de-privacidad">Privacidad</Link></li>
          <li><Link to="/cancelacion-y-reembolsos">Cancelaciones y Reembolsos</Link></li>
          <li><Link to="/preguntas-frecuentes">Preguntas Frecuentes</Link></li>
          <li><Link to="/contacto">Contacto</Link></li>
        </ul>
      </div>
      <div className="footer-contact">
        <h4>CONTACTO</h4>
        <p><MapPin size={14} /> Santo Domingo Este, RD</p>
        <p><Phone size={14} /> (809) 561-5000</p>
      </div>
    </div>
    <div className="footer-bottom">
      <p style={{ margin: 0 }}>&copy; 2026 PlanBeautyRD. Todos los derechos reservados.</p>
      <p style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: '#94a3b8' }}>
        Plataforma desarrollada por{' '}
        <a 
          href="https://www.instagram.com/_spawx_/" 
          target="_blank" 
          rel="noopener noreferrer" 
          style={{ color: '#d4af37', textDecoration: 'none', fontWeight: 700 }}
        >
          Anderson Ramirez
        </a>
      </p>
    </div>
  </footer>
);

const SidebarLink = ({ to, icon: Icon, label, active, onClick }) => (
  <Link to={to} onClick={onClick} className={`nav-link ${active ? 'active' : ''}`}>
    <Icon size={18} strokeWidth={active ? 2.5 : 2} />
    <span>{label}</span>
  </Link>
);

const AppContent = () => {
  const { user, logout } = useAuth();
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
  const isSubscriptionsActive = location.pathname.startsWith('/lista-clientes') || location.pathname.startsWith('/registro-cliente') || location.pathname.startsWith('/contratos') || location.pathname.startsWith('/pagos') || location.pathname.startsWith('/encuesta') || location.pathname.startsWith('/planes') || location.pathname.startsWith('/sucursales') || location.pathname.startsWith('/regalos');
  const isTeamActive = location.pathname.startsWith('/equipo') || location.pathname.startsWith('/admin/asistencia');
  const isAdministrationActive = location.pathname.startsWith('/seguridad') || location.pathname.startsWith('/configuracion');
  const isAccountingActive = location.pathname.startsWith('/secuencias-dgii') || location.pathname.startsWith('/contabilidad') || location.pathname.startsWith('/notas-credito') || location.pathname.startsWith('/reporte-607');
  const isBiActive = location.pathname.startsWith('/analitica');
  const isPayrollActive = location.pathname.startsWith('/nomina') || location.pathname.startsWith('/comisiones') || location.pathname.startsWith('/descuentos-empleados');

  const isAdmin = user?.role?.toLowerCase() === 'admin' || user?.role?.toLowerCase() === 'administrador';
  const isClient = user?.role?.toLowerCase() === 'client' || user?.role?.toLowerCase() === 'cliente';
  const isReceptionProfile = Boolean(
    !isAdmin &&
    !isClient &&
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

  // Expandir automáticamente el submenú de Contabilidad si estamos en una ruta contable
  useEffect(() => {
    if (isAccountingActive) {
      setIsAccountingOpen(true);
    }
  }, [isAccountingActive]);

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
        <div className="landing-page" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
          <PublicHeader />
          <main style={{ flex: 1 }}>
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
      <Routes>
        <Route path="/asistencia" element={<AttendanceKiosk />} />
      </Routes>
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
        <div className="sidebar-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '1.5rem', marginBottom: '1rem' }}>
          <Link to="/" onClick={closeMobileMenu} className="brand" style={{ padding: '0.5rem 0', justifyContent: 'center', width: '100%', display: 'flex', textDecoration: 'none' }}>
            <img 
              src="/logo-black.png" 
              alt="PLAN BEAUTY Logo" 
              style={{ width: '100%', maxWidth: '240px', height: 'auto', objectFit: 'contain', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))', cursor: 'pointer' }} 
            />
          </Link>
        </div>

        <div className="sidebar-user">
          <div className="user-avatar">{(user?.nombre || user?.name || 'U').charAt(0)}</div>
          <div className="user-info">
            <p className="user-name">{user?.nombre || user?.name || 'Usuario'}</p>
            <p className="user-role">{user?.role_name || user?.role || 'Visitante'}</p>
          </div>
        </div>

        <nav className="sidebar-nav hide-scrollbar">
          {isClient ? (
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
              <p className="nav-group-title">{t('menu.principal')}</p>
              <SidebarLink to="/" icon={LayoutDashboard} label={t('menu.dashboard')} active={location.pathname === '/'} onClick={closeMobileMenu} />
              
              {/* Menú Desplegable Ventas */}
              {(isAdmin || (user?.permissions && (user.permissions.process_payments || user.permissions.record_visits || user.permissions.manage_salons || user.permissions.manage_services))) && (
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
                          label="Facturación" 
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

              {/* Menú Desplegable Suscripciones */}
              {(isAdmin || (user?.permissions && (
                user.permissions.manage_clients || 
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
                      {(isAdmin || user?.permissions?.manage_clients) && (
                        <SidebarLink 
                          to="/lista-clientes" 
                          icon={Users} 
                          label="Clientes" 
                          active={location.pathname === '/lista-clientes'} 
                          onClick={closeMobileMenu} 
                        />
                      )}
                      {(isAdmin || user?.permissions?.manage_clients) && (
                        <SidebarLink 
                          to="/registro-cliente" 
                          icon={UserPlus} 
                          label="Registrar Clientes" 
                          active={location.pathname === '/registro-cliente'} 
                          onClick={closeMobileMenu} 
                        />
                      )}
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
              {(isAdmin || (user?.permissions && (user.permissions.manage_staff || user.permissions.manage_attendance || user?.role_name?.toLowerCase()?.includes('recep')))) && (
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

          {(isAdmin || 
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

                  {/* Submenú de Inteligencia de Negocios */}
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
                        to="/analitica?tab=sales" 
                        icon={TrendingUp} 
                        label="Ventas Diarias" 
                        active={location.pathname === '/analitica' && (!location.search || location.search.includes('tab=sales'))} 
                        onClick={closeMobileMenu} 
                      />
                      <SidebarLink 
                        to="/analitica?tab=invoices" 
                        icon={Receipt} 
                        label="Facturas & Ventas" 
                        active={location.pathname === '/analitica' && location.search.includes('tab=invoices')} 
                        onClick={closeMobileMenu} 
                      />
                      <SidebarLink 
                        to="/analitica?tab=client_payments" 
                        icon={CreditCard} 
                        label="Cobros por Cliente" 
                        active={location.pathname === '/analitica' && location.search.includes('tab=client_payments')} 
                        onClick={closeMobileMenu} 
                      />
                      <SidebarLink 
                        to="/analitica?tab=cash" 
                        icon={Wallet} 
                        label="Pagos en Efectivo" 
                        active={location.pathname === '/analitica' && location.search.includes('tab=cash')} 
                        onClick={closeMobileMenu} 
                      />
                      <SidebarLink 
                        to="/analitica?tab=commissions" 
                        icon={Percent} 
                        label="Comisiones Colaboradores" 
                        active={location.pathname === '/analitica' && location.search.includes('tab=commissions')} 
                        onClick={closeMobileMenu} 
                      />
                      <SidebarLink 
                        to="/analitica?tab=clients" 
                        icon={Users} 
                        label="Estado de Clientes" 
                        active={location.pathname === '/analitica' && location.search.includes('tab=clients')} 
                        onClick={closeMobileMenu} 
                      />
                    </div>
                  )}
                </div>
              )}
              
              {isAdmin && (
                <>
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
                      </div>
                    )}
                  </div>
                </>
              )}
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
              <Routes location={location}>
                <Route path="/" element={isClient ? <ClientDashboard /> : (isReceptionProfile ? <ReceptionDashboard /> : <Dashboard />)} />
                <Route path="/registro-cliente" element={isClient ? <Navigate to="/" /> : <ClientRegistration />} />
                <Route path="/lista-clientes" element={isClient ? <Navigate to="/" /> : <ClientProfile />} />
                <Route path="/clientes" element={isClient ? <Navigate to="/" /> : <ClientProfile />} />
                <Route path="/visitas" element={isClient ? <Navigate to="/" /> : <VisitRecorder />} />
                <Route path="/cajas" element={(isAdmin || (user?.permissions && user.permissions.process_payments)) ? <CashRegistersModule /> : <Navigate to="/" />} />
                <Route path="/facturas" element={isAdmin ? <InvoiceHistory /> : <Navigate to="/" />} />
                <Route path="/descuentos-empleados" element={(isAdmin || (user?.permissions && (user.permissions.manage_staff || user.permissions.manage_commissions))) ? <EmployeeDiscountsModule /> : <Navigate to="/" />} />
                <Route path="/servicios" element={isClient ? <Navigate to="/" /> : <ServiceManagement />} />
                <Route path="/comisiones" element={isClient ? <Navigate to="/" /> : <CommissionManagement />} />
                <Route path="/encuesta" element={(isAdmin || (user?.permissions && user.permissions.manage_surveys)) ? <AdminSurveys /> : <SatisfactionSurvey />} />
                <Route path="/regalos" element={isAdmin ? <AdminGiftCards /> : <GiftCertificates />} />
                <Route path="/regalar" element={<GiftCertificates />} />
                <Route path="/mis-servicios" element={<ClientServices />} />
                <Route path="/activar" element={<ActivateAccount />} />
                <Route path="/equipo" element={isAdmin ? <StaffModule /> : <Navigate to="/" />} />
                <Route path="/nomina" element={isAdmin ? <PayrollModule /> : <Navigate to="/" />} />
                <Route path="/nomina/historial" element={isAdmin ? <PayrollModule initialTab="historical" /> : <Navigate to="/" />} />
                <Route path="/nomina/regalias" element={isAdmin ? <PayrollModule initialTab="regalias" /> : <Navigate to="/" />} />
                <Route path="/seguridad" element={isAdmin ? <SecurityModule /> : <Navigate to="/" />} />
                <Route path="/sucursales" element={isAdmin ? <SalonsModule /> : <Navigate to="/" />} />
                <Route path="/planes" element={isAdmin ? <PlansModule /> : <Navigate to="/" />} />
                <Route path="/pagos" element={isAdmin ? <Payments /> : <Navigate to="/" />} />
                <Route path="/marketing" element={isAdmin ? <MarketingModule /> : <Navigate to="/" />} />
                <Route path="/analitica" element={isAdmin ? <ServiceAnalytics /> : <Navigate to="/" />} />
                <Route path="/contabilidad" element={isAdmin ? <Navigate to="/contabilidad/reporte-607" replace /> : <Navigate to="/" />} />
                <Route path="/secuencias-dgii" element={isAdmin ? <DgiiSequencesModule /> : <Navigate to="/" />} />
                <Route path="/contabilidad/notas-credito" element={isAdmin ? <CreditNotesModule /> : <Navigate to="/" />} />
                <Route path="/notas-credito" element={isAdmin ? <CreditNotesModule /> : <Navigate to="/" />} />
                <Route path="/contabilidad/reporte-607" element={isAdmin ? <Reporte607Module /> : <Navigate to="/" />} />
                <Route path="/reporte-607" element={isAdmin ? <Reporte607Module /> : <Navigate to="/" />} />
                <Route path="/configuracion" element={isAdmin ? <SettingsModule /> : <Navigate to="/" />} />
                <Route path="/contratos" element={isClient ? <Navigate to="/" /> : <DigitalContract />} />
                <Route path="/admin/asistencia" element={(isAdmin || user?.permissions?.manage_attendance || user?.role?.toLowerCase() === 'recepcion' || user?.role?.toLowerCase() === 'recepcionista' || user?.role_name?.toLowerCase()?.includes('recep')) ? <AttendanceLogs /> : <Navigate to="/" />} />
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
              </Routes>
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

const App = () => (
  <ErrorBoundary>
    <NotificationProvider>
      <AuthProvider>
        <LanguageProvider>
          <Router>
            <AppContent />
          </Router>
        </LanguageProvider>
      </AuthProvider>
    </NotificationProvider>
  </ErrorBoundary>
);

export default App;
