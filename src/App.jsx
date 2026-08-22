import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LayoutDashboard, Users, Calendar, LogOut, Menu, X, CreditCard,
  FileSignature, PieChart, Bell, Settings, User, TrendingUp, Mail, Gift, Search, MapPin,
  Sparkles, Star, UserPlus, Clock, Phone
} from 'lucide-react';

import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useTranslation } from './context/LanguageContext';
import { NotificationProvider, useNotification } from './context/NotificationContext';

// Pages & Components
import Login from './pages/Login';
import Dashboard from './components/admin/Dashboard';
import ClientDashboard from './components/clients/ClientDashboard';
import ClientRegistration from './components/clients/ClientRegistration';
import VisitRecorder from './components/visits/VisitRecorder';
import SatisfactionSurvey from './components/surveys/SatisfactionSurvey';
import GiftCertificates from './components/surveys/GiftCertificates';
import ClientServices from './components/clients/ClientServices';
import ActivateAccount from './pages/ActivateAccount';
import CardNetTest from './pages/CardNetTest';
import DigitalContract from './components/contracts/DigitalContract';
import ServiceManagement from './components/services/ServiceManagement';
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
      <p>&copy; 2026 PlanBeautyRD. Todos los derechos reservados.</p>
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
  const location = useLocation();
  const navigate = useNavigate();

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

  const isAdmin = user?.role?.toLowerCase() === 'admin' || user?.role?.toLowerCase() === 'administrador';
  const isClient = user?.role?.toLowerCase() === 'client' || user?.role?.toLowerCase() === 'cliente';

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
              {(isAdmin || (user?.permissions && user.permissions.manage_clients)) && (
                <SidebarLink to="/lista-clientes" icon={Users} label={t('menu.clients')} active={location.pathname === '/lista-clientes'} onClick={closeMobileMenu} />
              )}
              {(isAdmin || (user?.permissions && (user.permissions.process_billing || user.permissions.register_visits))) && (
                <SidebarLink to="/visitas" icon={Calendar} label="Facturar" active={location.pathname === '/visitas' && !location.search.includes('caja')} onClick={closeMobileMenu} />
              )}
              {(isAdmin || (user?.permissions && (user.permissions.process_billing || user.permissions.register_visits))) && (
                <SidebarLink to="/visitas?action=caja" icon={CreditCard} label="Caja de Jornada" active={location.search.includes('action=caja')} onClick={closeMobileMenu} />
              )}
              {(isAdmin || (user?.permissions && user.permissions.manage_clients)) && (
                <SidebarLink to="/registro-cliente" icon={UserPlus} label="Registrar Cliente" active={location.pathname === '/registro-cliente'} onClick={closeMobileMenu} />
              )}
              {(isAdmin || (user?.permissions && (user.permissions.process_billing || user.permissions.register_visits))) && (
                <SidebarLink to="/servicios" icon={Sparkles} label="Gestión de Servicios" active={location.pathname === '/servicios'} onClick={closeMobileMenu} />
              )}
              
              <div style={{ margin: '1.5rem 0.75rem 0.5rem', height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
              <button 
                onClick={() => { setIsGiftCardModalOpen(true); closeMobileMenu(); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.875rem 1rem', margin: '0.25rem 0.75rem',
                  borderRadius: '12px', color: '#d4af37', background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.2)',
                  fontSize: '0.875rem', fontWeight: 800, cursor: 'pointer', transition: 'all 0.2s', width: 'calc(100% - 1.5rem)',
                  textAlign: 'left'
                }}
                className="hover-lift"
              >
                <Gift size={18} />
                <span>Validar Gift Card</span>
              </button>
              <div style={{ margin: '0.5rem 0.75rem 1.5rem', height: '1px', background: 'rgba(255,255,255,0.1)' }}></div>

              <p className="nav-group-title">{t('menu.business')}</p>
              {(isAdmin || (user?.permissions && user.permissions.manage_surveys)) && (
                <SidebarLink to="/encuesta" icon={Settings} label={t('menu.surveys')} active={location.pathname === '/encuesta'} onClick={closeMobileMenu} />
              )}
              {(isAdmin || (user?.permissions && user?.permissions.view_contracts)) && (
                <SidebarLink to="/contratos" icon={FileSignature} label={t('menu.contracts')} active={location.pathname === '/contratos'} onClick={closeMobileMenu} />
              )}
            </>
          )}

          {(isAdmin || 
            user?.permissions?.manage_attendance || 
            user?.permissions?.manage_staff || 
            user?.permissions?.manage_plans || 
            user?.permissions?.process_payments || 
            user?.permissions?.view_analytics || 
            user?.role_name?.toLowerCase()?.includes('recep')) && (
            <>
              <p className="nav-group-title">{t('menu.admin')}</p>
              
              {(isAdmin || user?.permissions?.manage_staff) && (
                <SidebarLink to="/equipo" icon={Users} label="Equipo" active={location.pathname === '/equipo'} onClick={closeMobileMenu} />
              )}
              
              {(isAdmin || user?.permissions?.manage_attendance || user?.role_name?.toLowerCase()?.includes('recep')) && (
                <SidebarLink to="/admin/asistencia" icon={Clock} label="Control Asistencia" active={location.pathname === '/admin/asistencia'} onClick={closeMobileMenu} />
              )}
              
              {isAdmin && (
                <SidebarLink to="/sucursales" icon={MapPin} label="Sucursales" active={location.pathname === '/sucursales'} onClick={closeMobileMenu} />
              )}
              
              {(isAdmin || user?.permissions?.manage_plans) && (
                <SidebarLink to="/planes" icon={PieChart} label={t('menu.plans')} active={location.pathname === '/planes'} onClick={closeMobileMenu} />
              )}
              
              {(isAdmin || user?.permissions?.process_payments) && (
                <SidebarLink to="/pagos" icon={CreditCard} label={t('menu.payments')} active={location.pathname === '/pagos'} onClick={closeMobileMenu} />
              )}
              
              {isAdmin && (
                <SidebarLink to="/marketing" icon={Mail} label={t('menu.marketing')} active={location.pathname === '/marketing'} onClick={closeMobileMenu} />
              )}
              
              {(isAdmin || user?.permissions?.view_analytics) && (
                <SidebarLink to="/analitica" icon={TrendingUp} label={t('menu.analytics')} active={location.pathname === '/analitica'} onClick={closeMobileMenu} />
              )}
              
              {isAdmin && (
                <SidebarLink to="/configuracion" icon={Settings} label="Configuración" active={location.pathname === '/configuracion'} onClick={closeMobileMenu} />
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
        <header className="top-header">
          <div className="breadcrumb">
            <Link to="/" className="workspace" style={{ transition: 'color 0.2s' }}>{t('workspace')}</Link>
            <span className="separator">/</span>
            <Link to={location.pathname} className="current" style={{ transition: 'color 0.2s', cursor: 'pointer', textDecoration: 'none' }}>
               {location.pathname === '/' ? t('menu.dashboard') : location.pathname.substring(1).replace(/-/g, ' ')}
            </Link>
          </div>

          <div className="header-actions">
            <button 
              onClick={() => changeLanguage(lang === 'es' ? 'en' : 'es')}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                borderRadius: '99px',
                padding: '0.25rem 0.75rem',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                textTransform: 'uppercase'
              }}
            >
              {lang === 'es' ? '🇬🇧 EN' : '🇪🇸 ES'}
            </button>
            <div className="search-bar">
              <Search size={16} />
              <input type="text" placeholder={t('search.placeholder')} />
            </div>
            <button 
              onClick={() => setIsGiftCardModalOpen(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', borderRadius: '10px',
                background: '#09090b', color: 'white', border: 'none', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer'
              }}
            >
              <Gift size={14} />
              <span>Validar Gift Card</span>
            </button>
            <NotificationBell />
          </div>
        </header>

        <div className="content-area hide-scrollbar" style={{ background: 'var(--bg-canvas)' }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.15 }}
              className="content-wrapper"
              style={{ minHeight: '100%' }}
            >
              <Routes location={location}>
                <Route path="/" element={isClient ? <ClientDashboard /> : <Dashboard />} />
                <Route path="/registro-cliente" element={isClient ? <Navigate to="/" /> : <ClientRegistration />} />
                <Route path="/lista-clientes" element={isClient ? <Navigate to="/" /> : <ClientProfile />} />
                <Route path="/visitas" element={isClient ? <Navigate to="/" /> : <VisitRecorder />} />
                <Route path="/servicios" element={isClient ? <Navigate to="/" /> : <ServiceManagement />} />
                <Route path="/encuesta" element={(isAdmin || (user?.permissions && user.permissions.manage_surveys)) ? <AdminSurveys /> : <SatisfactionSurvey />} />
                <Route path="/regalos" element={isAdmin ? <AdminGiftCards /> : <GiftCertificates />} />
                <Route path="/regalar" element={<GiftCertificates />} />
                <Route path="/mis-servicios" element={<ClientServices />} />
                <Route path="/activar" element={<ActivateAccount />} />
                <Route path="/equipo" element={isAdmin ? <StaffModule /> : <Navigate to="/" />} />
                <Route path="/sucursales" element={isAdmin ? <SalonsModule /> : <Navigate to="/" />} />
                <Route path="/planes" element={isAdmin ? <PlansModule /> : <Navigate to="/" />} />
                <Route path="/pagos" element={isAdmin ? <Payments /> : <Navigate to="/" />} />
                <Route path="/marketing" element={isAdmin ? <MarketingModule /> : <Navigate to="/" />} />
                <Route path="/analitica" element={isAdmin ? <ServiceAnalytics /> : <Navigate to="/" />} />
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
  <NotificationProvider>
    <AuthProvider>
      <LanguageProvider>
        <Router>
          <AppContent />
        </Router>
      </LanguageProvider>
    </AuthProvider>
  </NotificationProvider>
);

export default App;
