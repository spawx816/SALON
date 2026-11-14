import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Receipt,
  Users,
  Clock,
  FileSpreadsheet,
  BarChart3,
  LineChart,
  Eye,
  EyeOff,
  Check,
  X,
  Plus,
  Minus,
  Menu,
  ChevronRight,
  Lock
} from 'lucide-react';
import { validateName, cleanPhone } from '../utils/formUtils';
import { useDocumentMetadata } from '../hooks/useDocumentMetadata';
import './LandingEtereas.css';

const CANONICAL_FALLBACK_PLANS = [
  {
    id: 1,
    code: 'base',
    name: 'Plan Base',
    price_monthly: 49,
    extra_user_price: 15,
    users_included: 3,
    branches_included: 1,
    description:
      'Todo lo esencial para operar tu negocio: POS, cajas, inventario operativo, Clientes/CRM, asistencia, nómina y reportes DGII.'
  },
  {
    id: 2,
    code: 'pro',
    name: 'Plan Pro',
    price_monthly: 99,
    extra_user_price: 15,
    users_included: 3,
    branches_included: 1,
    description:
      'Todo el Plan Base más Suscripciones y Membresías B2C, contratos digitales, automatizaciones de Marketing e Inventario Avanzado.'
  }
];

const MODULES_LIST = [
  {
    kicker: '01 · VENTAS Y FACTURACIÓN',
    title: 'Vende y factura desde un mismo lugar.',
    desc: 'Gestiona ventas, cobros, cierres de caja, comprobantes fiscales NCF y reportes DGII (606, 607 e IT-1; e-CF en certificación).',
    flow: 'Ventas → Comisiones y reportes',
    Icon: Receipt
  },
  {
    kicker: '02 · RECURSOS HUMANOS Y CLIENTES',
    title: 'Organiza tu equipo y tu CRM.',
    desc: 'Centraliza la información de tus empleados, horarios, novedades y el directorio CRM de clientes incluido en Base y Pro.',
    flow: 'Equipo y CRM → Información centralizada',
    Icon: Users
  },
  {
    kicker: '03 · CONTROL DE ASISTENCIA',
    title: 'Del ponche facial al cálculo.',
    desc: 'Registra ponches con foto facial y calcula horas extra, tardanzas y ausencias según los horarios y reglas configuradas.',
    flow: 'Asistencia → Planilla de pago',
    Icon: Clock
  },
  {
    kicker: '04 · NÓMINA AUTOMÁTICA',
    title: 'Cada cálculo llega a tu nómina.',
    desc: 'Integra asistencia, comisiones y descuentos para alimentar automáticamente la planilla de pago. Gestiona regalías e históricos.',
    flow: 'Comisiones + Asistencia → Nómina',
    Icon: FileSpreadsheet
  },
  {
    kicker: '05 · CONTABILIDAD',
    title: 'Tus finanzas, mejor organizadas.',
    desc: 'Organiza la información contable y los gastos operativos de tu empresa para dar seguimiento claro a tus finanzas.',
    flow: 'Operación → Control contable',
    Icon: BarChart3
  },
  {
    kicker: '06 · INTELIGENCIA DE NEGOCIOS',
    title: 'Información para tomar decisiones.',
    desc: 'Consulta reportes estratégicos de ventas, clientes y costos. En Plan Pro incorpora analítica de membresías y multisucursal.',
    flow: 'Datos → Decisiones estratégicas',
    Icon: LineChart
  }
];

const CHART_DATA = {
  week: {
    total: 'RD$ 248,500',
    yLabels: ['60 mil', '30 mil', '0'],
    bars: [
      { label: 'Lun', pct: 46, value: 'RD$ 27,600' },
      { label: 'Mar', pct: 62, value: 'RD$ 37,200' },
      { label: 'Mié', pct: 48, value: 'RD$ 28,800' },
      { label: 'Jue', pct: 70, value: 'RD$ 42,000' },
      { label: 'Vie', pct: 56, value: 'RD$ 33,600' },
      { label: 'Sáb', pct: 88, value: 'RD$ 52,800', peak: true },
      { label: 'Dom', pct: 44, value: 'RD$ 26,500' }
    ]
  },
  month: {
    total: 'RD$ 1,042,800',
    yLabels: ['250 mil', '125 mil', '0'],
    bars: [
      { label: 'S1', pct: 64, value: 'RD$ 160,000' },
      { label: 'S2', pct: 72, value: 'RD$ 180,000' },
      { label: 'S3', pct: 58, value: 'RD$ 145,000' },
      { label: 'S4', pct: 86, value: 'RD$ 215,000', peak: true },
      { label: 'S5', pct: 68, value: 'RD$ 170,000' },
      { label: 'S6', pct: 40, value: 'RD$ 100,000' },
      { label: 'S7', pct: 29, value: 'RD$ 72,800' }
    ]
  }
};

const EtereasLogoMark = ({ className = 'et-brand-symbol' }) => (
  <svg className={className} viewBox="0 0 40 40" aria-hidden="true">
    <path fill="#2563eb" d="M8 5h26l-6 8H8a4 4 0 0 1 0-8Z" />
    <path fill="#5a55ed" d="M8 16h22l-6 8H8a4 4 0 0 1 0-8Z" />
    <path fill="#8b62f2" d="M8 27h26l-6 8H8a4 4 0 0 1 0-8Z" />
  </svg>
);

const Landing = ({ initialIsLogin = true, initialAuthModal = false }) => {
  const { login } = useAuth();

  const isStagingHost =
    typeof window !== 'undefined' && window.location.hostname.startsWith('staging.');
  const canonicalOrigin =
    typeof window !== 'undefined' && window.location.hostname.includes('www.etereasapp.com')
      ? 'https://www.etereasapp.com/'
      : 'https://etereasapp.com/';

  useDocumentMetadata({
    title: 'ETEREAS — Toda tu empresa. Una sola plataforma.',
    description:
      'Plataforma SaaS Multi-Tenant de gestión empresarial: facturación POS, asistencia facial, nómina automática, CRM de clientes y membresías.',
    canonicalUrl: canonicalOrigin,
    robots: isStagingHost ? 'noindex, nofollow' : 'index, follow'
  });

  // Navigation & UI state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [extraModulesOpen, setExtraModulesOpen] = useState(false);
  const [chartPeriod, setChartPeriod] = useState('week');
  const [activeBarIdx, setActiveBarIdx] = useState(null);

  // Plans & configurator state (strictly BASE & PRO from canonical catalog)
  const [saasPlans, setSaasPlans] = useState(CANONICAL_FALLBACK_PLANS);
  const [selectedPlanCode, setSelectedPlanCode] = useState('base');
  const [branchesCount, setBranchesCount] = useState(1);
  const [extraUsersCount, setExtraUsersCount] = useState(0);
  const [planDetailsOpen, setPlanDetailsOpen] = useState(false);

  // Hero login form state (real AuthContext login)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  // Onboarding modal state (3-step registration -> POST /api/public/onboarding)
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(
    Boolean(initialAuthModal && !initialIsLogin)
  );
  const [regStep, setRegStep] = useState(1);
  const [businessName, setBusinessName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [rnc, setRnc] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [showOwnerPassword, setShowOwnerPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState('');
  const [regSuccess, setRegSuccess] = useState(false);

  // Forgot / Reset password modal state
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotStep, setForgotStep] = useState(1);
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState(false);

  // Activation modal state
  const [showActivation, setShowActivation] = useState(false);
  const [pendingClientId, setPendingClientId] = useState(null);
  const [activationCode, setActivationCode] = useState('');
  const [activationError, setActivationError] = useState('');

  const loginInputRef = useRef(null);
  const activeModalRef = useRef(null);
  const lastTriggerRef = useRef(null);

  // Focus login input when navigating directly to /login
  useEffect(() => {
    if (initialAuthModal && initialIsLogin) {
      setTimeout(() => {
        loginInputRef.current?.focus();
      }, 60);
    } else if (initialAuthModal && !initialIsLogin) {
      setIsRegisterModalOpen(true);
    }
  }, [initialAuthModal, initialIsLogin]);

  // Scroll to hash target when arriving from secondary public pages (e.g. /#integracion, /#planes)
  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    if (hash && hash.length > 1) {
      const target = document.getElementById(hash.slice(1));
      if (target) {
        setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      }
    }
  }, []);

  // Load canonical plans from backend
  useEffect(() => {
    let mounted = true;
    const loadPlans = async () => {
      try {
        const res = await fetch('/api/saas/plans?public_only=true');
        if (!res.ok) return;
        const data = await res.json();
        const rows = Array.isArray(data) ? data : Array.isArray(data?.plans) ? data.plans : [];
        if (mounted && rows.length > 0) {
          const normalized = rows
            .filter((p) => ['base', 'pro'].includes(String(p.code || '').toLowerCase()))
            .map((p) => ({
              ...p,
              code: String(p.code).toLowerCase(),
              price_monthly: Number(p.price_monthly || (String(p.code).toLowerCase() === 'pro' ? 99 : 49)),
              extra_user_price: Number(p.extra_user_price || 15),
              users_included: Number(p.users_included || 3),
              branches_included: Number(p.branches_included || 1)
            }));
          if (normalized.length > 0) {
            setSaasPlans(normalized);
          }
        }
      } catch {
        // Keep canonical fallback
      }
    };
    loadPlans();
    return () => {
      mounted = false;
    };
  }, []);

  const closeAllModals = useCallback(() => {
    setIsRegisterModalOpen(false);
    setShowForgotModal(false);
    setShowActivation(false);
    setRegError('');
    setForgotError('');
    setActivationError('');
    if (lastTriggerRef.current && typeof lastTriggerRef.current.focus === 'function') {
      setTimeout(() => lastTriggerRef.current?.focus(), 20);
    }
  }, []);

  // Keyboard Trap & Escape for active modal
  useEffect(() => {
    const isAnyOpen = isRegisterModalOpen || showForgotModal || showActivation;
    const container = activeModalRef.current;
    if (!isAnyOpen || !container) return undefined;

    const focusableSel =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])';
    const firstInput = container.querySelector('input:not([disabled]), button:not([disabled])');
    firstInput?.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAllModals();
        return;
      }
      if (e.key === 'Tab') {
        const items = container.querySelectorAll(focusableSel);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isRegisterModalOpen, showForgotModal, showActivation, closeAllModals]);

  const openOnboardingModal = (planCode = selectedPlanCode, triggerEl = null) => {
    if (triggerEl) {
      lastTriggerRef.current = triggerEl;
    } else if (document.activeElement instanceof HTMLElement) {
      lastTriggerRef.current = document.activeElement;
    }
    setSelectedPlanCode(planCode === 'pro' ? 'pro' : 'base');
    setRegStep(1);
    setRegError('');
    setRegSuccess(false);
    setIsRegisterModalOpen(true);
    setMobileMenuOpen(false);
  };

  const focusLoginCard = () => {
    setMobileMenuOpen(false);
    const el = document.getElementById('acceso');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => loginInputRef.current?.focus(), 250);
  };

  // Real login submission
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setLoginError('');
    if (!email.trim() || !password) {
      setLoginError('Ingresa tu usuario o correo y tu contraseña.');
      return;
    }
    setLoginLoading(true);
    try {
      const result = await login(email.trim(), password);
      if (!result.success) {
        if (result.requiresActivation) {
          setPendingClientId(result.clientId);
          setShowActivation(true);
        } else {
          setLoginError(result.error || 'Credenciales incorrectas.');
        }
      }
    } catch {
      setLoginError('Error de conexión con el servidor.');
    } finally {
      setLoginLoading(false);
    }
  };

  // Real 3-step onboarding submission
  const handleRegisterStep = async (e) => {
    e.preventDefault();
    setRegError('');

    if (regStep === 1) {
      if (!validateName(ownerName)) {
        setRegError('Ingresa tu nombre y apellido reales.');
        return;
      }
      if (!regEmail.trim() || !regEmail.includes('@')) {
        setRegError('Ingresa un correo electrónico válido.');
        return;
      }
      const digits = cleanPhone(telefono);
      if (digits.length < 10) {
        setRegError('Ingresa un teléfono válido de al menos 10 dígitos.');
        return;
      }
      setRegStep(2);
      return;
    }

    if (regStep === 2) {
      if (!businessName.trim() || businessName.trim().length < 3) {
        setRegError('Ingresa el nombre comercial de tu empresa o salón.');
        return;
      }
      if (!ownerPassword || ownerPassword.length < 6) {
        setRegError('Define una contraseña de acceso de al menos 6 caracteres.');
        return;
      }
      setRegStep(3);
      return;
    }

    if (!acceptTerms) {
      setRegError('Debes aceptar los términos y condiciones del servicio para continuar.');
      return;
    }

    setRegLoading(true);
    try {
      const res = await fetch('/api/public/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_name: businessName.trim(),
          owner_name: ownerName.trim(),
          owner_email: regEmail.trim(),
          owner_phone: telefono.trim(),
          admin_password: ownerPassword,
          rnc: rnc.trim() || null,
          address: 'Principal',
          requested_plan: selectedPlanCode
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo completar el registro.');
      setRegSuccess(true);
    } catch (err) {
      setRegError(err.message || 'Error al registrar el espacio de trabajo.');
    } finally {
      setRegLoading(false);
    }
  };

  // Forgot & Reset Password
  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setForgotError('');
    setForgotLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrCedula: forgotEmail.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo enviar el código.');
      setForgotStep(2);
    } catch (err) {
      setForgotError(err.message);
    } finally {
      setForgotLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setForgotError('');
    setForgotLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailOrCedula: forgotEmail.trim(),
          code: resetCode.trim(),
          newPassword
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Código inválido o expirado.');
      setForgotSuccess(true);
      setTimeout(() => {
        setShowForgotModal(false);
        setForgotSuccess(false);
        setForgotStep(1);
        setForgotEmail('');
        setResetCode('');
        setNewPassword('');
        focusLoginCard();
      }, 2000);
    } catch (err) {
      setForgotError(err.message);
    } finally {
      setForgotLoading(false);
    }
  };

  // Account activation
  const handleActivate = async (e) => {
    e.preventDefault();
    setActivationError('');
    try {
      const res = await fetch('/api/auth/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: pendingClientId, code: activationCode.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Código de activación incorrecto.');
      setShowActivation(false);
      setActivationCode('');
      focusLoginCard();
    } catch (err) {
      setActivationError(err.message);
    }
  };

  // Active plan metadata derived strictly from canonical catalog
  const activePlan =
    saasPlans.find((p) => p.code === selectedPlanCode) ||
    CANONICAL_FALLBACK_PLANS.find((p) => p.code === selectedPlanCode) ||
    CANONICAL_FALLBACK_PLANS[0];

  const unitPrice = Number(activePlan.price_monthly || (selectedPlanCode === 'pro' ? 99 : 49));
  const extraUserPrice = Number(activePlan.extra_user_price || 15);
  const usersPerBranch = Number(activePlan.users_included || 3);
  const monthlySubtotal = branchesCount * unitPrice + extraUsersCount * extraUserPrice;

  const planFeaturesList =
    selectedPlanCode === 'pro'
      ? [
          { label: 'POS, ventas y cierres de caja', included: true },
          { label: 'Directorio y fichas de Clientes (CRM)', included: true },
          { label: 'Suscripciones y Membresías B2C + Contratos', included: true },
          { label: 'Automatizaciones de Marketing y Gift Cards', included: true },
          { label: 'Inventario Avanzado Multisucursal', included: true },
          { label: 'Control de asistencia, comisiones y nómina', included: true },
          { label: 'Comprobantes NCF y reportes DGII (606, 607, IT-1)', included: true },
          { label: `${usersPerBranch} usuarios incluidos por sucursal`, included: true }
        ]
      : [
          { label: 'POS, ventas y cierres de caja', included: true },
          { label: 'Directorio y fichas de Clientes (CRM)', included: true },
          { label: 'Inventario operativo de sucursal', included: true },
          { label: 'Control de asistencia, comisiones y nómina', included: true },
          { label: 'Comprobantes NCF y reportes DGII (606, 607, IT-1)', included: true },
          { label: `${usersPerBranch} usuarios incluidos por sucursal`, included: true },
          { label: 'Membresías B2C y Contratos (solo Plan Pro)', included: false },
          { label: 'Marketing e Inventario Avanzado (solo Plan Pro)', included: false }
        ];

  const activeChart = CHART_DATA[chartPeriod];

  return (
    <div id="top" className="etereas-landing">
      {/* Header */}
      <header className="et-header">
        <div className="et-container et-header-inner">
          <a href="#top" className="et-brand" aria-label="Etereas Inicio">
            <EtereasLogoMark />
            <span>etereas.</span>
          </a>

          <nav className="et-nav" aria-label="Navegación principal">
            <a href="#integracion" className="et-nav-link">
              La plataforma
            </a>
            <a href="#planes" className="et-nav-link">
              Plan y precio
            </a>
            <button type="button" className="et-nav-link" onClick={focusLoginCard}>
              Iniciar sesión
            </button>
            <button
              type="button"
              className="et-btn-primary"
              onClick={(e) => openOnboardingModal(selectedPlanCode, e.currentTarget)}
            >
              Contratar →
            </button>
          </nav>

          <div className="et-mobile-controls">
            <button type="button" className="et-mobile-login-pill" onClick={focusLoginCard}>
              Iniciar sesión
            </button>
            <button
              type="button"
              className="et-mobile-menu-btn"
              aria-label={mobileMenuOpen ? 'Cerrar menú' : 'Abrir menú'}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((v) => !v)}
            >
              {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        <div className={`et-mobile-drawer ${mobileMenuOpen ? 'open' : ''}`}>
          <a href="#integracion" onClick={() => setMobileMenuOpen(false)}>
            La plataforma
          </a>
          <a href="#planes" onClick={() => setMobileMenuOpen(false)}>
            Plan y precio
          </a>
          <button type="button" className="et-drawer-link" onClick={focusLoginCard}>
            Iniciar sesión
          </button>
          <Link to="/contacto" onClick={() => setMobileMenuOpen(false)}>
            Solicitar demostración
          </Link>
          <button
            type="button"
            className="et-btn-primary"
            onClick={(e) => openOnboardingModal(selectedPlanCode, e.currentTarget)}
          >
            Contratar →
          </button>
        </div>
      </header>

      <main>
        {/* 1. Hero + Connected Login Card */}
        <section className="et-hero">
          <div className="et-container et-hero-grid">
            <div>
              <p className="et-eyebrow">SOFTWARE DE GESTIÓN EMPRESARIAL</p>
              <h1 className="et-hero-title">
                Toda tu empresa.
                <br />
                <span className="et-accent-text">
                  Una sola
                  <br />
                  plataforma.
                </span>
              </h1>
              <p className="et-hero-lead">
                Facturación, asistencia facial, CRM de clientes y nómina conectadas. Menos trabajo
                manual. Más control de tu negocio.
              </p>

              <div className="et-hero-ctas">
                <button
                  type="button"
                  className="et-btn-primary"
                  onClick={(e) => openOnboardingModal(selectedPlanCode, e.currentTarget)}
                >
                  Contratar ETEREAS →
                </button>
                <a href="#integracion" className="et-btn-ghost">
                  Conocer la plataforma ↓
                </a>
              </div>

              <div className="et-hero-offer">
                <span className="et-offer-badge">BASE Y PRO</span>
                <span>
                  Desde <strong className="et-offer-price">US$49/mes</strong> (Base) ·{' '}
                  <strong className="et-offer-price">US$99/mes</strong> (Pro) por sucursal
                </span>
                <span className="et-hero-offer-sub">
                  3 usuarios incluidos por sucursal · Clientes CRM en ambos planes
                </span>
              </div>
            </div>

            <div id="acceso" className="et-login-card" aria-labelledby="login-card-title">
              <div className="et-login-brand">
                <EtereasLogoMark className="et-brand-symbol" />
                <span>MI ETEREAS</span>
              </div>
              <h2 id="login-card-title">Tu empresa te espera.</h2>
              <p className="et-login-subtitle">Entra a tu espacio de trabajo.</p>

              {loginError && (
                <div className="et-alert-error" role="alert">
                  {loginError}
                </div>
              )}

              <form onSubmit={handleLoginSubmit} noValidate>
                <div className="et-field">
                  <label htmlFor="et-login-email">Usuario o correo</label>
                  <input
                    ref={loginInputRef}
                    id="et-login-email"
                    type="text"
                    className="et-input"
                    placeholder="Usuario o correo asignado"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="username"
                    required
                  />
                </div>

                <div className="et-field">
                  <label htmlFor="et-login-password">Contraseña</label>
                  <div className="et-input-wrap">
                    <input
                      id="et-login-password"
                      type={showPassword ? 'text' : 'password'}
                      className="et-input has-toggle"
                      placeholder="Tu contraseña"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      className="et-pass-toggle"
                      aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  className="et-btn-primary et-login-submit"
                  disabled={loginLoading}
                >
                  {loginLoading ? 'Ingresando...' : 'Iniciar sesión →'}
                </button>
              </form>

              <div className="et-login-meta">
                <button
                  type="button"
                  className="et-inline-link"
                  onClick={() => {
                    lastTriggerRef.current = document.activeElement;
                    setShowForgotModal(true);
                  }}
                >
                  ¿Olvidaste tu contraseña?
                </button>
                <span>
                  ¿Aún no tienes espacio?{' '}
                  <button
                    type="button"
                    className="et-inline-link"
                    onClick={(e) => openOnboardingModal(selectedPlanCode, e.currentTarget)}
                  >
                    Registrar empresa →
                  </button>
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* 2. People Band */}
        <section className="et-people-section" aria-label="Tecnología que conecta personas">
          <div className="et-container">
            <div className="et-people-card">
              <div className="et-people-media">
                <img
                  src="/landing_assets/equipo-etereas.png"
                  alt="Equipo de trabajo colaborando frente a una computadora con la plataforma Etereas"
                  width="1536"
                  height="1024"
                  loading="lazy"
                  decoding="async"
                />
                <span className="et-media-caption">Imagen ilustrativa</span>
              </div>
              <div className="et-people-copy">
                <p className="et-eyebrow">TECNOLOGÍA QUE CONECTA PERSONAS</p>
                <h2>
                  Tu equipo conectado.
                  <br />
                  Tu negocio en movimiento.
                </h2>
                <p>
                  Una misma plataforma para quienes venden, gestionan el equipo y toman decisiones.
                </p>
                <a href="#integracion" className="et-text-link">
                  Conoce todo lo que integra →
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* 3. Modules Grid */}
        <section id="integracion" className="et-section">
          <div className="et-container">
            <p className="et-eyebrow">EL VALOR ESTÁ EN LA CONEXIÓN</p>
            <div className="et-section-header-split">
              <h2 className="et-section-h2">
                De tu operación
                <br />a tus resultados.
              </h2>
              <p className="et-section-sub">
                La información pasa de un módulo a otro. Tu equipo trabaja en un mismo lugar.
              </p>
            </div>

            <div className="et-modules-grid">
              {MODULES_LIST.map(({ kicker, title, desc, flow, Icon }) => (
                <article key={kicker} className="et-module-item">
                  <div className="et-module-icon" aria-hidden="true">
                    <Icon size={18} />
                  </div>
                  <p className="et-module-kicker">{kicker}</p>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                  <span className="et-module-flow">{flow}</span>
                </article>
              ))}
            </div>

            <div className="et-accordion-bar">
              <button
                type="button"
                className="et-accordion-btn"
                aria-expanded={extraModulesOpen}
                onClick={() => setExtraModulesOpen((v) => !v)}
              >
                <span>
                  También incluido: clientes CRM (Base y Pro), membresías B2C (Pro) y gestión por
                  sucursal
                </span>
                {extraModulesOpen ? <Minus size={16} /> : <Plus size={16} />}
              </button>
              {extraModulesOpen && (
                <div className="et-accordion-panel">
                  <span className="et-pill-item">Perfiles y CRM de clientes (Base y Pro)</span>
                  <span className="et-pill-item">Membresías B2C y renovaciones (Plan Pro)</span>
                  <span className="et-pill-item">Gestión por sucursal</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 4. Sales Insight */}
        <section className="et-section" aria-labelledby="insight-heading">
          <div className="et-container et-insight-grid">
            <div className="et-insight-copy">
              <p className="et-eyebrow">TUS RESULTADOS, A LA VISTA</p>
              <h2 id="insight-heading" className="et-section-h2">
                Tu negocio,
                <br />
                en perspectiva.
              </h2>
              <p className="et-body">
                Consulta tus ventas y compara períodos. La información de tu operación, lista para
                tomar decisiones.
              </p>
              <a href="#planes" className="et-text-link">
                Todo conectado en tu plan →
              </a>
            </div>

            <div className="et-chart-card">
              <div className="et-chart-top">
                <div>
                  <div className="et-chart-label">Resumen de ventas</div>
                  <div className="et-chart-value">{activeChart.total}</div>
                </div>
                <div className="et-period-toggle" role="group" aria-label="Período del gráfico">
                  <button
                    type="button"
                    className={`et-period-btn ${chartPeriod === 'week' ? 'active' : ''}`}
                    aria-pressed={chartPeriod === 'week'}
                    onClick={() => {
                      setChartPeriod('week');
                      setActiveBarIdx(null);
                    }}
                  >
                    Semana
                  </button>
                  <button
                    type="button"
                    className={`et-period-btn ${chartPeriod === 'month' ? 'active' : ''}`}
                    aria-pressed={chartPeriod === 'month'}
                    onClick={() => {
                      setChartPeriod('month');
                      setActiveBarIdx(null);
                    }}
                  >
                    Mes
                  </button>
                </div>
              </div>

              <div className="et-bars-wrap">
                <div className="et-y-axis" aria-hidden="true">
                  {activeChart.yLabels.map((lbl) => (
                    <span key={lbl}>{lbl}</span>
                  ))}
                </div>
                <div className="et-bars-grid">
                  {activeChart.bars.map((bar, idx) => (
                    <div key={bar.label} className="et-bar-col">
                      <button
                        type="button"
                        className={`et-bar ${bar.peak || activeBarIdx === idx ? 'peak' : ''}`}
                        style={{ height: `${bar.pct}%` }}
                        aria-label={`${bar.label}: ${bar.value}`}
                        onMouseEnter={() => setActiveBarIdx(idx)}
                        onMouseLeave={() => setActiveBarIdx(null)}
                        onFocus={() => setActiveBarIdx(idx)}
                      />
                      <span className="et-bar-day">{bar.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="et-chart-footer">
                <span>
                  <span className="et-legend-dot" />
                  {activeBarIdx !== null
                    ? `${activeChart.bars[activeBarIdx].label}: ${activeChart.bars[activeBarIdx].value}`
                    : 'Ventas registradas'}
                </span>
                <span>Datos ilustrativos · Explora el gráfico</span>
              </div>
            </div>
          </div>
        </section>

        {/* 5. Pricing & Plan Configurator (BASE & PRO Canonical) */}
        <section id="planes" className="et-pricing-section" aria-labelledby="pricing-heading">
          <div className="et-container">
            <div className="et-pricing-head">
              <p className="et-eyebrow">ELIGE TU ALCANCE. CONECTA TU EMPRESA.</p>
              <h2 id="pricing-heading" className="et-section-h2">
                Dos planes claros.
                <br />
                Toda tu operación.
              </h2>
              <p className="et-sub">
                Elige Plan Base o Plan Pro, tus sucursales y usuarios. Tu mensualidad, clara desde el
                inicio.
              </p>
            </div>

            <div className="et-pricing-card">
              <div className="et-pricing-left">
                <div className="et-plan-tabs" role="tablist" aria-label="Seleccionar plan">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selectedPlanCode === 'base'}
                    className={`et-plan-tab ${selectedPlanCode === 'base' ? 'active' : ''}`}
                    onClick={() => setSelectedPlanCode('base')}
                  >
                    Plan Base · US$49
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selectedPlanCode === 'pro'}
                    className={`et-plan-tab ${selectedPlanCode === 'pro' ? 'active' : ''}`}
                    onClick={() => setSelectedPlanCode('pro')}
                  >
                    Plan Pro · US$99
                  </button>
                </div>

                <p className="et-eyebrow" style={{ marginBottom: '6px' }}>
                  {selectedPlanCode === 'pro' ? 'PLAN ETEREAS PRO' : 'PLAN ETEREAS BASE'}
                </p>
                <h3 className="et-plan-name">
                  {selectedPlanCode === 'pro' ? 'ETEREAS PRO' : 'ETEREAS BASE'}
                </h3>

                <div className="et-price-row">
                  <span className="et-price-big">US${unitPrice}</span>
                  <span className="et-price-unit">/ mes por sucursal</span>
                </div>

                <p className="et-plan-desc">{activePlan.description}</p>

                <ul className="et-check-list">
                  {planFeaturesList.map((item) => (
                    <li key={item.label} className={item.included ? '' : 'excluded'}>
                      {item.included ? (
                        <Check size={15} color="#2563eb" style={{ flexShrink: 0, marginTop: 2 }} />
                      ) : (
                        <Lock size={14} color="#94a3b8" style={{ flexShrink: 0, marginTop: 2 }} />
                      )}
                      <span>{item.label}</span>
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  className="et-details-btn"
                  aria-expanded={planDetailsOpen}
                  onClick={() => setPlanDetailsOpen((v) => !v)}
                >
                  <ChevronRight
                    size={14}
                    style={{
                      transform: planDetailsOpen ? 'rotate(90deg)' : 'none',
                      transition: 'transform 0.15s ease'
                    }}
                  />
                  Ver qué incluye el plan
                </button>

                {planDetailsOpen && (
                  <div className="et-details-box">
                    {selectedPlanCode === 'pro'
                      ? 'Incluye todo el Plan Base (POS, cajas, CRM de clientes, inventario operativo, asistencia facial, nómina, comisiones, contabilidad y reportes DGII 606/607/IT-1) más Suscripciones y Membresías B2C, contratos digitales, automatizaciones de Marketing e Inventario Avanzado.'
                      : 'Incluye POS, cajas registradoras, directorio CRM de clientes, inventario operativo de sucursal, asistencia facial, nómina, comisiones, contabilidad básica y reportes DGII (606/607/IT-1). Membresías B2C, contratos y Marketing requieren Plan Pro.'}
                  </div>
                )}

                <p className="et-legal-note">
                  Precios mensuales por sucursal en USD según catálogo vigente. Facturación
                  electrónica e-CF y pasarela CardNet en proceso de certificación; equipo biométrico
                  e impuestos locales según alcance de contratación.
                </p>
              </div>

              <div className="et-pricing-right">
                <div>
                  <p className="et-eyebrow" style={{ marginBottom: '6px' }}>
                    A TU MEDIDA
                  </p>
                  <h3 className="et-plan-name" style={{ fontSize: '21px', marginBottom: '22px' }}>
                    Configura tu plan
                  </h3>

                  <div className="et-stepper-group">
                    <span className="et-stepper-label">Sucursales</span>
                    <div className="et-stepper">
                      <button
                        type="button"
                        className="et-stepper-btn"
                        aria-label="Disminuir sucursales"
                        disabled={branchesCount <= 1}
                        onClick={() => setBranchesCount((b) => Math.max(1, b - 1))}
                      >
                        −
                      </button>
                      <span className="et-stepper-val">{branchesCount}</span>
                      <button
                        type="button"
                        className="et-stepper-btn"
                        aria-label="Aumentar sucursales"
                        onClick={() => setBranchesCount((b) => b + 1)}
                      >
                        +
                      </button>
                    </div>
                    <div className="et-stepper-hint">
                      {branchesCount * usersPerBranch} usuarios incluidos ({usersPerBranch} por
                      sucursal)
                    </div>
                  </div>

                  <div className="et-stepper-group">
                    <span className="et-stepper-label">Usuarios adicionales en total</span>
                    <div className="et-stepper">
                      <button
                        type="button"
                        className="et-stepper-btn"
                        aria-label="Disminuir usuarios adicionales"
                        disabled={extraUsersCount <= 0}
                        onClick={() => setExtraUsersCount((u) => Math.max(0, u - 1))}
                      >
                        −
                      </button>
                      <span className="et-stepper-val">{extraUsersCount}</span>
                      <button
                        type="button"
                        className="et-stepper-btn"
                        aria-label="Aumentar usuarios adicionales"
                        onClick={() => setExtraUsersCount((u) => u + 1)}
                      >
                        +
                      </button>
                    </div>
                    <div className="et-stepper-hint">
                      US${extraUserPrice}/mes por cada usuario adicional
                    </div>
                  </div>
                </div>

                <div>
                  <div className="et-subtotal-row">
                    <span className="et-subtotal-label">
                      Subtotal mensual ({selectedPlanCode === 'pro' ? 'Pro' : 'Base'})
                    </span>
                    <span className="et-subtotal-val">US${monthlySubtotal}</span>
                  </div>

                  <button
                    type="button"
                    className="et-btn-primary et-cta-full"
                    onClick={(e) => openOnboardingModal(selectedPlanCode, e.currentTarget)}
                  >
                    Contratar {selectedPlanCode === 'pro' ? 'Plan Pro' : 'Plan Base'} →
                  </button>
                  <p className="et-cta-sub">Revisa tu selección antes de continuar.</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Pre-footer & Footer */}
      <div className="et-prefooter">
        ¿Quieres conocerlo antes?
        <Link to="/contacto">Solicitar demostración</Link>
      </div>

      <footer className="et-footer">
        <div className="et-container et-footer-inner">
          <a href="#top" className="et-brand" style={{ fontSize: '18px' }}>
            <EtereasLogoMark className="et-brand-symbol" />
            <span>etereas.</span>
          </a>

          <span>Software de gestión empresarial</span>

          <div className="et-footer-links">
            <Link to="/contacto">Contacto</Link>
            <Link to="/terminos-y-condiciones">Términos</Link>
            <Link to="/politica-de-privacidad">Privacidad</Link>
          </div>
        </div>
      </footer>

      {/* Onboarding / Registration Modal (POST /api/public/onboarding) */}
      {isRegisterModalOpen && (
        <div
          className="et-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reg-modal-title"
          onClick={(e) => e.target === e.currentTarget && closeAllModals()}
        >
          <div className="et-modal-card" ref={activeModalRef}>
            <button
              type="button"
              className="et-modal-close"
              aria-label="Cerrar ventana"
              onClick={closeAllModals}
            >
              <X size={18} />
            </button>

            {regSuccess ? (
              <div>
                <div className="et-alert-success" role="status">
                  ¡Tu espacio de trabajo <strong>{businessName}</strong> ha sido registrado!
                </div>
                <h2 id="reg-modal-title">Registro completado</h2>
                <p className="et-login-subtitle" style={{ marginBottom: 18 }}>
                  Ya puedes iniciar sesión con <strong>{regEmail}</strong> y la contraseña que
                  definiste.
                </p>
                <button
                  type="button"
                  className="et-btn-primary et-cta-full"
                  onClick={() => {
                    setEmail(regEmail);
                    setPassword(ownerPassword);
                    closeAllModals();
                    focusLoginCard();
                  }}
                >
                  Ir a iniciar sesión →
                </button>
              </div>
            ) : (
              <form onSubmit={handleRegisterStep} noValidate>
                <p className="et-eyebrow" style={{ marginBottom: 6 }}>
                  ALTA DE EMPRESA · PASO {regStep} DE 3
                </p>
                <h2 id="reg-modal-title">Crear espacio en Etereas</h2>
                <div className="et-stepper-bars" aria-hidden="true">
                  <div className={`et-stepper-bar ${regStep >= 1 ? 'active' : ''}`} />
                  <div className={`et-stepper-bar ${regStep >= 2 ? 'active' : ''}`} />
                  <div className={`et-stepper-bar ${regStep >= 3 ? 'active' : ''}`} />
                </div>

                {regError && (
                  <div className="et-alert-error" role="alert">
                    {regError}
                  </div>
                )}

                {regStep === 1 && (
                  <>
                    <div className="et-field">
                      <label htmlFor="reg-owner-name">Nombre y apellido del propietario</label>
                      <input
                        id="reg-owner-name"
                        type="text"
                        className="et-input"
                        value={ownerName}
                        onChange={(e) => setOwnerName(e.target.value)}
                        placeholder="Ej. Laura Méndez"
                        required
                      />
                    </div>
                    <div className="et-field">
                      <label htmlFor="reg-owner-email">Correo electrónico</label>
                      <input
                        id="reg-owner-email"
                        type="email"
                        className="et-input"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="laura@empresa.com"
                        required
                      />
                    </div>
                    <div className="et-field">
                      <label htmlFor="reg-owner-phone">Teléfono</label>
                      <input
                        id="reg-owner-phone"
                        type="tel"
                        className="et-input"
                        value={telefono}
                        onChange={(e) => setTelefono(e.target.value)}
                        placeholder="809-555-0100"
                        required
                      />
                    </div>
                  </>
                )}

                {regStep === 2 && (
                  <>
                    <div className="et-field">
                      <label htmlFor="reg-business-name">Nombre comercial de tu empresa</label>
                      <input
                        id="reg-business-name"
                        type="text"
                        className="et-input"
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                        placeholder="Ej. Estudio Central"
                        required
                      />
                    </div>
                    <div className="et-field-row-2">
                      <div className="et-field">
                        <label htmlFor="reg-plan">Plan inicial</label>
                        <select
                          id="reg-plan"
                          className="et-input"
                          value={selectedPlanCode}
                          onChange={(e) => setSelectedPlanCode(e.target.value)}
                        >
                          <option value="base">Plan Base (US$49/mes)</option>
                          <option value="pro">Plan Pro (US$99/mes)</option>
                        </select>
                      </div>
                      <div className="et-field">
                        <label htmlFor="reg-rnc">RNC / Cédula (opcional)</label>
                        <input
                          id="reg-rnc"
                          type="text"
                          className="et-input"
                          value={rnc}
                          onChange={(e) => setRnc(e.target.value)}
                          placeholder="Opcional"
                        />
                      </div>
                    </div>
                    <div className="et-field">
                      <label htmlFor="reg-password">Contraseña de acceso</label>
                      <div className="et-input-wrap">
                        <input
                          id="reg-password"
                          type={showOwnerPassword ? 'text' : 'password'}
                          className="et-input has-toggle"
                          value={ownerPassword}
                          onChange={(e) => setOwnerPassword(e.target.value)}
                          placeholder="Mínimo 6 caracteres"
                          required
                        />
                        <button
                          type="button"
                          className="et-pass-toggle"
                          aria-label={showOwnerPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                          onClick={() => setShowOwnerPassword((v) => !v)}
                        >
                          {showOwnerPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {regStep === 3 && (
                  <>
                    <div className="et-summary-box">
                      <div>
                        <strong>Empresa:</strong> {businessName}
                      </div>
                      <div>
                        <strong>Propietario:</strong> {ownerName} ({regEmail})
                      </div>
                      <div>
                        <strong>Plan seleccionado:</strong>{' '}
                        {selectedPlanCode === 'pro'
                          ? 'Plan Pro (US$99/mes por sucursal)'
                          : 'Plan Base (US$49/mes por sucursal)'}
                      </div>
                      <div>
                        <strong>Configuración estimada:</strong> {branchesCount} sucursal(es),{' '}
                        {extraUsersCount} usuario(s) extra — Subtotal US${monthlySubtotal}/mes
                      </div>
                    </div>
                    <label className="et-checkbox-row">
                      <input
                        type="checkbox"
                        checked={acceptTerms}
                        onChange={(e) => setAcceptTerms(e.target.checked)}
                      />
                      <span>
                        Acepto los{' '}
                        <Link to="/terminos-y-condiciones" onClick={closeAllModals}>
                          Términos y Condiciones
                        </Link>{' '}
                        y la{' '}
                        <Link to="/politica-de-privacidad" onClick={closeAllModals}>
                          Política de Privacidad
                        </Link>
                        .
                      </span>
                    </label>
                  </>
                )}

                <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                  {regStep > 1 && (
                    <button
                      type="button"
                      className="et-mobile-login-pill"
                      style={{ flex: 1, height: 44 }}
                      onClick={() => setRegStep((s) => Math.max(1, s - 1))}
                    >
                      Atrás
                    </button>
                  )}
                  <button
                    type="submit"
                    className="et-btn-primary"
                    style={{ flex: 2, height: 44 }}
                    disabled={regLoading}
                  >
                    {regStep < 3
                      ? 'Continuar →'
                      : regLoading
                      ? 'Creando espacio...'
                      : 'Confirmar registro →'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div
          className="et-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="forgot-modal-title"
          onClick={(e) => e.target === e.currentTarget && closeAllModals()}
        >
          <div className="et-modal-card" ref={activeModalRef}>
            <button
              type="button"
              className="et-modal-close"
              aria-label="Cerrar recuperación"
              onClick={closeAllModals}
            >
              <X size={18} />
            </button>
            <h2 id="forgot-modal-title">Recuperar contraseña</h2>
            <p className="et-login-subtitle">
              {forgotStep === 1
                ? 'Ingresa tu correo o cédula para recibir un código de recuperación.'
                : 'Ingresa el código recibido y define tu nueva contraseña.'}
            </p>

            {forgotError && (
              <div className="et-alert-error" role="alert">
                {forgotError}
              </div>
            )}
            {forgotSuccess && (
              <div className="et-alert-success" role="status">
                Contraseña actualizada correctamente. Ya puedes iniciar sesión.
              </div>
            )}

            {forgotStep === 1 ? (
              <form onSubmit={handleForgotPassword}>
                <div className="et-field">
                  <label htmlFor="forgot-email">Correo o cédula</label>
                  <input
                    id="forgot-email"
                    type="text"
                    className="et-input"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="et-btn-primary et-cta-full"
                  disabled={forgotLoading}
                >
                  {forgotLoading ? 'Enviando...' : 'Enviar código →'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleResetPassword}>
                <div className="et-field">
                  <label htmlFor="reset-code">Código de verificación</label>
                  <input
                    id="reset-code"
                    type="text"
                    className="et-input"
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value)}
                    required
                  />
                </div>
                <div className="et-field">
                  <label htmlFor="reset-new-pass">Nueva contraseña</label>
                  <input
                    id="reset-new-pass"
                    type="password"
                    className="et-input"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="et-btn-primary et-cta-full"
                  disabled={forgotLoading}
                >
                  {forgotLoading ? 'Guardando...' : 'Actualizar contraseña →'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Activation Modal */}
      {showActivation && (
        <div
          className="et-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="activation-modal-title"
          onClick={(e) => e.target === e.currentTarget && closeAllModals()}
        >
          <div className="et-modal-card" ref={activeModalRef}>
            <button
              type="button"
              className="et-modal-close"
              aria-label="Cerrar activación"
              onClick={closeAllModals}
            >
              <X size={18} />
            </button>
            <h2 id="activation-modal-title">Activar cuenta</h2>
            <p className="et-login-subtitle">
              Ingresa el código de activación enviado a tu correo.
            </p>
            {activationError && (
              <div className="et-alert-error" role="alert">
                {activationError}
              </div>
            )}
            <form onSubmit={handleActivate}>
              <div className="et-field">
                <label htmlFor="activation-code">Código de activación</label>
                <input
                  id="activation-code"
                  type="text"
                  className="et-input"
                  value={activationCode}
                  onChange={(e) => setActivationCode(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="et-btn-primary et-cta-full">
                Activar cuenta →
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Landing;
