import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import {
  User,
  Lock,
  Mail,
  CreditCard,
  ShieldCheck,
  CalendarDays,
  CheckCircle,
  CheckCircle2,
  MapPin,
  Phone,
  Eye,
  EyeOff,
  Sparkles,
  X,
  Clock,
  Scissors,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Building2,
  Receipt,
  Users,
  Crown,
  Wallet
} from 'lucide-react';
import './Landing.css';
import { validateName, cleanPhone } from '../utils/formUtils';
import { useDocumentMetadata } from '../hooks/useDocumentMetadata';
import { PublicHeader, PublicFooter } from '../components/common/PublicLayout';

const SAAS_FAQS = [
  {
    question: '¿Cuál es la diferencia exacta entre el Plan Base y el Plan Pro?',
    answer: 'El Plan Base ($49 USD/mes por sucursal) incluye el sistema POS de recepción, facturación fiscal DGII (606, 607, IT-1), catálogo de productos y servicios, cajas registradoras, control de personal, comisiones, nómina y creación de usuarios, pero NO incluye el directorio de clientes ni las suscripciones mensuales. El Plan Pro ($99 USD/mes por sucursal) incluye todo el Plan Base más el Registro/CRM de Clientes y el ecosistema completo de Suscripciones y Membresías (Plan Beauty, contratos digitales, cupos de lavados de 30 días, descuentos de cumpleaños, encuestas y Gift Cards).'
  },
  {
    question: '¿Puedo comenzar con el Plan Base y luego subir mi salón al Plan Pro?',
    answer: 'Sí. Tu salón puede iniciar operando su facturación diaria, inventario y comisiones en el Plan Base y activar el Plan Pro en cualquier momento desde el módulo de Personalización y Plan sin perder su historial contable ni sus configuraciones.'
  },
  {
    question: '¿Cuántos usuarios y sucursales incluye cada licencia?',
    answer: 'Cada sucursal licenciada incluye 3 usuarios operativos (por ejemplo: Administrador, Recepcionista/Cajera y Contador). Puedes agregar sucursales adicionales o asientos de usuario extra ($15 USD/mes por asiento adicional) según crezca tu equipo.'
  },
  {
    question: '¿El sistema es compatible con impresoras térmicas de recepción y reportes de la DGII?',
    answer: 'Sí. El POS cuenta con formato homologado para impresoras térmicas de 80mm (área útil de 60mm con código QR de verificación), manejo de secuencias de comprobantes fiscales (NCF / e-CF), Notas de Crédito y generación automática de los reportes 606, 607 e IT-1.'
  },
  {
    question: '¿Cómo se protegen los descuentos manuales y cambios de precio en la caja?',
    answer: 'El sistema cuenta con autorización mediante PIN de Administrador. Ningún cajero o recepcionista puede alterar manualmente un porcentaje de descuento ni rebajar un precio base sin ingresar el PIN o código dinámico autorizado.'
  },
  {
    question: '¿Puedo personalizar el sistema con el logo y nombre de mi salón?',
    answer: 'Sí. Cada salón registrado en la plataforma cuenta con aislamiento Multi-Tenant propio, pudiendo configurar su nombre comercial, RNC, logo, pie de factura y catálogo de servicios independiente.'
  }
];

const Landing = ({ initialIsLogin = true, initialAuthModal = false }) => {
  const { login } = useAuth();

  useDocumentMetadata({
    title: 'Salon Pro & Plan Beauty SaaS | Software POS, Facturación y Membresías para Salones',
    description: 'Plataforma SaaS Multi-Tenant para salones de belleza y centros estéticos: POS de recepción, facturación fiscal DGII (606, 607, IT-1), nómina, comisiones y membresías recurrentes.',
    canonicalUrl: 'https://planbeautyrd.com/',
    robots: 'index, follow'
  });

  // Datos estructurados Schema.org para SEO Técnico
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Salon Pro & Plan Beauty SaaS',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web, Windows, macOS, iOS, Android',
    offers: [
      {
        '@type': 'Offer',
        name: 'Plan Base',
        price: '49.00',
        priceCurrency: 'USD',
        description: 'POS de recepción, facturación fiscal DGII (606, 607, IT-1), cajas, comisiones y nómina para salones de belleza.'
      },
      {
        '@type': 'Offer',
        name: 'Plan Pro',
        price: '99.00',
        priceCurrency: 'USD',
        description: 'Todo el Plan Base más directorio CRM de clientes, motor de membresías recurrentes tipo Plan Beauty y contratos digitales.'
      }
    ],
    creator: {
      '@type': 'Organization',
      name: 'SalonPro SaaS',
      url: 'https://planbeautyrd.com'
    }
  };

  const [isLogin, setIsLogin] = useState(initialIsLogin);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Estado para Registro Progresivo de Salón (Tenant SaaS en 3 pasos)
  const [ownerName, setOwnerName] = useState('');
  const [telefono, setTelefono] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [rnc, setRnc] = useState('');
  const [selectedPlanCode, setSelectedPlanCode] = useState('pro'); // 'base' | 'pro'
  const [licensedBranches, setLicensedBranches] = useState(1);
  const [ownerPassword, setOwnerPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [saasPlans, setSaasPlans] = useState([]);

  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Control de pasos del registro
  const [regSuccess, setRegSuccess] = useState(false);
  const [regStep, setRegStep] = useState(1);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(initialAuthModal);

  // Recuperación de contraseña
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotStep, setForgotStep] = useState(1);
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState(false);

  // Activación de cuenta
  const [showActivation, setShowActivation] = useState(false);
  const [activationCode, setActivationCode] = useState('');
  const [pendingClientId, setPendingClientId] = useState(null);

  // FAQ Accordion
  const [openFaqIndex, setOpenFaqIndex] = useState(0);

  // Referencias para Accesibilidad de Modales (Focus Trap + Retorno de foco)
  const authModalRef = useRef(null);
  const forgotModalRef = useRef(null);
  const activationModalRef = useRef(null);
  const lastTriggerRef = useRef(null);

  useEffect(() => {
    setIsLogin(initialIsLogin);
    setIsAuthModalOpen(initialAuthModal);
  }, [initialIsLogin, initialAuthModal]);

  useEffect(() => {
    let isMounted = true;
    const loadPlans = async () => {
      try {
        const res = await fetch('/api/saas/plans?public_only=true');
        if (res.ok) {
          const data = await res.json();
          if (isMounted && Array.isArray(data) && data.length > 0) {
            setSaasPlans(data);
          }
        }
      } catch {
        // Fallback silencioso a los dos planes oficiales Base ($49) y Pro ($99)
      }
    };
    loadPlans();
    return () => {
      isMounted = false;
    };
  }, []);

  const openAuthModal = useCallback((loginMode, triggerElement = null, preselectedPlan = null) => {
    if (triggerElement) {
      lastTriggerRef.current = triggerElement;
    } else if (document.activeElement instanceof HTMLElement) {
      lastTriggerRef.current = document.activeElement;
    }
    if (preselectedPlan) {
      setSelectedPlanCode(preselectedPlan);
    }
    setError('');
    setRegSuccess(false);
    setIsLogin(loginMode);
    setIsAuthModalOpen(true);
  }, []);

  const closeAllModals = useCallback(() => {
    setIsAuthModalOpen(false);
    setShowForgotModal(false);
    setShowActivation(false);
    setError('');
    setForgotError('');
    if (lastTriggerRef.current && typeof lastTriggerRef.current.focus === 'function') {
      setTimeout(() => {
        lastTriggerRef.current?.focus();
      }, 20);
    }
  }, []);

  // Gestión de teclado (Escape y Focus Trap) en el modal activo
  useEffect(() => {
    const activeContainer = isAuthModalOpen
      ? authModalRef.current
      : showForgotModal
      ? forgotModalRef.current
      : showActivation
      ? activationModalRef.current
      : null;

    if (!activeContainer) return undefined;

    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = activeContainer.querySelectorAll(focusableSelector);
    const firstInput = activeContainer.querySelector('input:not([disabled]), select:not([disabled])');
    if (firstInput) {
      firstInput.focus();
    } else if (focusables.length > 0) {
      focusables[0].focus();
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAllModals();
        return;
      }

      if (e.key === 'Tab') {
        const currentFocusables = activeContainer.querySelectorAll(focusableSelector);
        if (currentFocusables.length === 0) return;
        const first = currentFocusables[0];
        const last = currentFocusables[currentFocusables.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAuthModalOpen, showForgotModal, showActivation, isLogin, regStep, forgotStep, closeAllModals]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const success = await login(email, password);
      if (success) {
        window.location.href = '/';
      }
    } catch (err) {
      if (err.status === 'Pendiente') {
        setPendingClientId(err.id);
        setError('');
        setIsAuthModalOpen(false);
        setShowActivation(true);
      } else {
        setError(err.message || 'Credenciales inválidas o usuario inactivo.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterStepValidation = (e) => {
    e.preventDefault();
    setError('');

    if (regStep === 1) {
      if (!ownerName.trim() || !validateName(ownerName.trim())) {
        setError('Ingresa el nombre del propietario o administrador usando solo letras.');
        return;
      }
      if (cleanPhone(telefono).length < 10) {
        setError('Ingresa un teléfono de contacto válido de 10 dígitos.');
        return;
      }
      if (!email.trim() || !email.includes('@')) {
        setError('Ingresa un correo electrónico corporativo o personal válido.');
        return;
      }
      setRegStep(2);
      return;
    }

    if (regStep === 2) {
      if (!businessName.trim() || businessName.trim().length < 3) {
        setError('Ingresa el nombre comercial de tu salón de belleza.');
        return;
      }
      if (!ownerPassword || ownerPassword.length < 6) {
        setError('Define una contraseña de acceso de al menos 6 caracteres.');
        return;
      }
      setRegStep(3);
      return;
    }

    if (regStep === 3) {
      if (!acceptTerms) {
        setError('Debes aceptar los términos y condiciones del servicio para registrar tu salón.');
        return;
      }
      handleRegisterSalonSubmit();
    }
  };

  const handleRegisterSalonSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      const matchedPlan = saasPlans.find((p) => p.code === selectedPlanCode);
      const planId = matchedPlan ? matchedPlan.id : selectedPlanCode === 'pro' ? 2 : 1;
      const slugBase = businessName
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      const uniqueSlug = `${slugBase || 'salon'}-${Math.floor(100 + Math.random() * 900)}`;

      const res = await fetch('/api/public/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_name: businessName.trim(),
          owner_name: ownerName.trim(),
          owner_email: email.trim(),
          owner_phone: telefono,
          admin_password: ownerPassword,
          rnc: rnc.trim() || null,
          address: 'Principal',
          requested_plan: selectedPlanCode
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo registrar el salón.');

      setRegSuccess(true);
      setIsAuthModalOpen(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBackToLogin = () => {
    setRegSuccess(false);
    setIsLogin(true);
    setPassword(ownerPassword);
    setError('');
    setRegStep(1);
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setForgotError('');
    setForgotLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrCedula: forgotEmail })
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
          emailOrCedula: forgotEmail,
          code: resetCode,
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
        setIsLogin(true);
        setIsAuthModalOpen(true);
      }, 2500);
    } catch (err) {
      setForgotError(err.message);
    } finally {
      setForgotLoading(false);
    }
  };

  const handleActivate = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/auth/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: pendingClientId, code: activationCode })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Código de activación incorrecto.');

      setShowActivation(false);
      setActivationCode('');
      setIsLogin(true);
      setIsAuthModalOpen(true);
    } catch (err) {
      setError(err.message);
    }
  };

  const unitPrice = selectedPlanCode === 'pro' ? 99 : 49;
  const totalEstimatedMonthly = unitPrice * (Number(licensedBranches) || 1);

  return (
    <div className="landing-page">
      {/* 0. SEO ESTRUCTURADO (JSON-LD) */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      {/* 1. HEADER COMPACTO */}
      <PublicHeader onOpenAuth={openAuthModal} />

      <main>
        {/* 2. HERO ORIENTADO A CONVERSIÓN SAAS */}
        <section className="hero" id="inicio">
          <div className="container">
            <div className="hero-grid">
              <div className="hero-content">
                <div className="hero-eyebrow">
                  <span className="live-pulse" aria-hidden="true" />
                  <Sparkles size={15} aria-hidden="true" />
                  <span>Plataforma SaaS para Salones en República Dominicana</span>
                </div>

                <h1>
                  El software integral para administrar y escalar <span>tu salón de belleza</span>
                </h1>

                <p className="hero-lead">
                  Controla tu recepción con POS térmico de 80mm/60mm, facturación fiscal DGII (e-CF), cajas registradoras, comisiones de personal y nómina en el <strong>Plan Base</strong>, o impulsa ingresos recurrentes con membresías mensuales y CRM de clientas en el <strong>Plan Pro</strong>.
                </p>

                <div className="hero-offer-pills" aria-label="Resumen de planes SaaS">
                  <div className="offer-pill">
                    <Receipt size={18} aria-hidden="true" />
                    <span><strong>Plan Base $49/mes:</strong> POS, Facturación DGII y Cajas</span>
                  </div>
                  <div className="offer-pill">
                    <Crown size={18} aria-hidden="true" />
                    <span><strong>Plan Pro $99/mes:</strong> + Clientes y Suscripciones</span>
                  </div>
                </div>

                <div className="hero-cta-group">
                  <button
                    type="button"
                    onClick={(e) => openAuthModal(false, e.currentTarget, 'pro')}
                    className="landing-btn btn-accent"
                  >
                    Registrar mi salón
                  </button>
                  <button
                    type="button"
                    onClick={(e) => openAuthModal(true, e.currentTarget)}
                    className="landing-btn btn-secondary-outline"
                  >
                    <User size={18} aria-hidden="true" />
                    <span>Iniciar sesión</span>
                  </button>
                </div>

                <p className="hero-brand-note">
                  <ShieldCheck size={16} aria-hidden="true" />
                  <span>Probado y homologado en operación real en salones y peluquerías profesionales.</span>
                </p>
              </div>

              <div className="hero-visual">
                <div className="hero-visual-card">
                  <div className="hero-photo-frame">
                    <img
                      src="/landing_assets/hero_v2_opt.jpg"
                      alt="Operación diaria en salón de belleza con software POS y membresías"
                      width="800"
                      height="1000"
                      fetchPriority="high"
                    />
                  </div>

                  {/* Mockup flotante de POS & Ingresos en Vivo */}
                  <div className="hero-pos-preview-card" aria-label="Demostración visual de interfaz POS">
                    <div className="preview-card-header">
                      <div className="preview-card-status">
                        <span className="status-dot green" aria-hidden="true" />
                        <span className="status-text">POS Recepción &bull; Turno en Vivo</span>
                      </div>
                      <span className="preview-badge-fiscal">e-CF DGII</span>
                    </div>

                    <div className="preview-kpi-row">
                      <div className="preview-kpi-item">
                        <span className="kpi-label">Ventas del Día</span>
                        <strong className="kpi-value">RD$ 48,250.00</strong>
                      </div>
                      <div className="preview-kpi-item align-right">
                        <span className="kpi-label">Plan Beauty Activo</span>
                        <strong className="kpi-value text-accent">34 Socias</strong>
                      </div>
                    </div>

                    <div className="preview-ticket-snippet">
                      <div className="snippet-line">
                        <span>Ticket #0142 &bull; Pre-cuenta 60mm</span>
                        <span className="tag-ok">Validado</span>
                      </div>
                      <div className="snippet-details">
                        <span>Lavado y Secado (Plan Beauty)</span>
                        <strong>RD$ 0.00</strong>
                      </div>
                      <div className="snippet-details">
                        <span>Tratamiento Profundo + Botox</span>
                        <strong>RD$ 2,400.00</strong>
                      </div>
                    </div>

                    <div className="preview-card-footer">
                      <div className="footer-plan-tag">
                        <strong>Desde $49 USD/mes</strong>
                        <span>Por sucursal &bull; Sin permanencia</span>
                      </div>
                      <span className="preview-verified-badge">
                        <ShieldCheck size={14} aria-hidden="true" />
                        <span>Homologación Verificada</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Indicadores de confianza del software */}
            <div className="hero-footer-badges">
              <div className="badges-grid">
                <div className="badge-item">
                  <div className="badge-icon" aria-hidden="true"><Receipt size={20} /></div>
                  <div className="badge-text">
                    <h2>POS y Facturación Fiscal</h2>
                    <p>Tickets térmicos 60mm/80mm, secuencias e-CF y reportes 606, 607 e IT-1.</p>
                  </div>
                </div>
                <div className="badge-item">
                  <div className="badge-icon" aria-hidden="true"><Users size={20} /></div>
                  <div className="badge-text">
                    <h2>Comisiones y Nómina</h2>
                    <p>Cálculo automático por estilista, manicurista, lavapelo y quiosco de asistencia.</p>
                  </div>
                </div>
                <div className="badge-item">
                  <div className="badge-icon" aria-hidden="true"><Crown size={20} /></div>
                  <div className="badge-text">
                    <h2>Motor de Suscripciones</h2>
                    <p>En Plan Pro: membresías de 4 lavados/30 días, contratos digitales y Gift Cards.</p>
                  </div>
                </div>
                <div className="badge-item">
                  <div className="badge-icon" aria-hidden="true"><ShieldCheck size={20} /></div>
                  <div className="badge-text">
                    <h2>Seguridad con PIN</h2>
                    <p>Autorización obligatoria de administrador para descuentos o rebajas en caja.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. MÓDULOS Y BENEFICIOS CONCRETOS + ORIGEN ABATTE */}
        <section className="section-block bg-white" id="modulos">
          <div className="container">
            <div className="section-header">
              <span className="section-tag">Módulos de la Plataforma</span>
              <h2 className="section-title">
                Todo lo que tu salón necesita en <span>una sola plataforma</span>
              </h2>
              <p className="section-subtitle">
                Diseñado específicamente para el flujo real de recepción, estilistas, caja y contabilidad de salones de belleza.
              </p>
            </div>

            <div className="benefits-grid">
              <article className="benefit-card">
                <div className="benefit-icon" aria-hidden="true">
                  <Receipt size={24} />
                </div>
                <h3>POS de Recepción y Cajas</h3>
                <p>
                  Facturación ágil de servicios y productos, apertura y cuadre de cajas por turno, impresión automática de pre-cuentas térmicas y control de métodos de pago.
                </p>
                <div className="benefit-tags">
                  <span>80mm / 60mm térmico</span>
                  <span>Cuadre de caja</span>
                  <span>PIN de seguridad</span>
                </div>
              </article>

              <article className="benefit-card">
                <div className="benefit-icon" aria-hidden="true">
                  <Wallet size={24} />
                </div>
                <h3>Nómina, Comisiones y Contabilidad</h3>
                <p>
                  Liquidación automática de comisiones por servicio realizado, descuentos a empleados, registro de egresos y exportación directa de reportes fiscales 606, 607 e ITBIS (IT-1).
                </p>
                <div className="benefit-tags">
                  <span>Comisiones automáticas</span>
                  <span>Reportes 606/607</span>
                  <span>ITBIS IT-1</span>
                </div>
              </article>

              <article className="benefit-card">
                <div className="benefit-icon" aria-hidden="true">
                  <Crown size={24} />
                </div>
                <h3>Membresías y Clientes (Exclusivo Plan Pro)</h3>
                <p>
                  Habilita el registro de clientes y crea tu propio programa de suscripción mensual con control de cupos de lavados por ciclo de 30 días, contratos firmados y descuentos de cumpleaños.
                </p>
                <div className="benefit-tags">
                  <span>Ciclos de 30 días</span>
                  <span>Contratos firmados</span>
                  <span>4 lavados/mes</span>
                </div>
              </article>
            </div>

            <div className="brand-alliance-banner">
              <div className="brand-alliance-text">
                <h3>Arquitectura Multi-Tenant diseñada para la identidad de tu salón</h3>
                <p>
                  Cada salón opera con su propia marca, logo, colores, usuarios, comisiones, catálogo POS e inventario totalmente aislado.
                </p>
              </div>
              <a href="#planes" className="landing-btn btn-primary">
                Comparar Plan Base y Pro
              </a>
            </div>
          </div>
        </section>

        {/* 4. CÓMO FUNCIONA LA IMPLEMENTACIÓN SAAS */}
        <section className="section-block bg-alt" id="como-funciona">
          <div className="container">
            <div className="section-header">
              <span className="section-tag">Puesta en marcha</span>
              <h2 className="section-title">
                ¿Cómo funciona <span>para tu salón</span>?
              </h2>
              <p className="section-subtitle">
                Configura tu salón en minutos y elige el nivel de licenciamiento que se ajuste a tu modelo operativo.
              </p>
            </div>

            <div className="steps-grid">
              <div className="step">
                <span className="step-num">PASO 01</span>
                <div className="step-icon-bg" aria-hidden="true">
                  <Building2 size={28} />
                </div>
                <h3>Elige tu nivel de operación</h3>
                <p>
                  Selecciona el <strong>Plan Base</strong> si buscas facturación POS y control interno, o el <strong>Plan Pro</strong> para incluir registro de clientes y suscripciones mensuales.
                </p>
              </div>

              <div className="step">
                <span className="step-num">PASO 02</span>
                <div className="step-icon-bg" aria-hidden="true">
                  <Scissors size={28} />
                </div>
                <h3>Configura catálogo y comisiones</h3>
                <p>
                  Personaliza el logo de tu salón, registra tus servicios, productos, estilistas, porcentajes de comisión y usuarios de recepción.
                </p>
              </div>

              <div className="step">
                <span className="step-num">PASO 03</span>
                <div className="step-icon-bg" aria-hidden="true">
                  <CheckCircle size={28} />
                </div>
                <h3>Factura y controla en tiempo real</h3>
                <p>
                  Emite tickets térmicos en recepción, audita tus cierres de caja diarios y supervisa la rentabilidad de cada sucursal en tiempo real.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 5 & 6. QUÉ INCLUYE CADA PLAN + PRECIOS Y CONDICIONES (2 PLANES: BASE Y PRO) */}
        <section className="section-block bg-white" id="planes">
          <div className="container">
            <div className="section-header">
              <span className="section-tag">Licenciamiento Transparente</span>
              <h2 className="section-title">
                Dos planes diseñados para <span>cada etapa de tu salón</span>
              </h2>
              <p className="section-subtitle">
                Sin planes confusos: elige operación pura de punto de venta en el <strong>Plan Base</strong> o desbloquea clientes y membresías recurrentes en el <strong>Plan Pro</strong>.
              </p>
            </div>

            <div className="saas-plans-grid">
              {/* PLAN BASE */}
              <article className="saas-plan-card">
                <div>
                  <span className="plan-ribbon base">Operación Esencial POS</span>
                  <div className="pricing-header-inner" style={{ marginBottom: '0.5rem' }}>
                    <Building2 size={28} aria-hidden="true" />
                    <h3>PLAN <span>BASE</span></h3>
                  </div>
                  <p style={{ color: 'var(--lp-muted)', fontSize: '0.9rem', margin: '0 0 1.25rem 0' }}>
                    Ideal para salones que requieren facturación rápida a clientes de paso, control de inventario, cajas y nómina sin club de membresías.
                  </p>

                  <div className="price-tag" style={{ justifyContent: 'flex-start', margin: '0 0 0.25rem 0' }}>
                    $49 <span>USD / mes por sucursal</span>
                  </div>
                  <p className="price-subcopy" style={{ textAlign: 'left', marginBottom: '1.25rem' }}>
                    Incluye 3 usuarios por sucursal (+$15 USD/mes por usuario extra).
                  </p>

                  <ul className="pricing-list">
                    <li>
                      <CheckCircle size={18} aria-hidden="true" />
                      <span><strong>Punto de Venta (POS)</strong> y tickets térmicos de 80mm/60mm.</span>
                    </li>
                    <li>
                      <CheckCircle size={18} aria-hidden="true" />
                      <span><strong>Catálogo completo</strong> de servicios y productos.</span>
                    </li>
                    <li>
                      <CheckCircle size={18} aria-hidden="true" />
                      <span><strong>Cajas registradoras</strong>, aperturas y cierres de turno.</span>
                    </li>
                    <li>
                      <CheckCircle size={18} aria-hidden="true" />
                      <span><strong>Creación de usuarios</strong>, roles y PIN de seguridad.</span>
                    </li>
                    <li>
                      <CheckCircle size={18} aria-hidden="true" />
                      <span><strong>Comisiones, Nómina</strong> y control de asistencia.</span>
                    </li>
                    <li>
                      <CheckCircle size={18} aria-hidden="true" />
                      <span><strong>Contabilidad DGII:</strong> secuencias e-CF, 606, 607 e IT-1.</span>
                    </li>
                    <li className="plan-item-excluded">
                      <X size={18} aria-hidden="true" className="icon-excluded" />
                      <span>No incluye registro ni directorio CRM de clientes.</span>
                    </li>
                    <li className="plan-item-excluded">
                      <X size={18} aria-hidden="true" className="icon-excluded" />
                      <span>No incluye módulo de Suscripciones (Plan Beauty).</span>
                    </li>
                  </ul>
                </div>

                <button
                  type="button"
                  onClick={(e) => openAuthModal(false, e.currentTarget, 'base')}
                  className="landing-btn btn-primary"
                  style={{ width: '100%' }}
                >
                  Comenzar con Plan Base
                </button>
              </article>

              {/* PLAN PRO */}
              <article className="saas-plan-card pro-featured">
                <div>
                  <span className="plan-ribbon pro">✦ Más Completo &bull; Clientes + Suscripciones</span>
                  <div className="pricing-header-inner" style={{ marginBottom: '0.5rem' }}>
                    <Crown size={28} aria-hidden="true" style={{ color: 'var(--lp-accent)' }} />
                    <h3>PLAN <span>PRO</span></h3>
                  </div>
                  <p style={{ color: 'var(--lp-muted)', fontSize: '0.9rem', margin: '0 0 1.25rem 0' }}>
                    Para salones que desean fidelizar a su cartera de clientas y generar ingresos recurrentes con membresías mensuales tipo Plan Beauty.
                  </p>

                  <div className="price-tag" style={{ justifyContent: 'flex-start', margin: '0 0 0.25rem 0' }}>
                    $99 <span>USD / mes por sucursal</span>
                  </div>
                  <p className="price-subcopy" style={{ textAlign: 'left', marginBottom: '1.25rem' }}>
                    Incluye 3 usuarios por sucursal (+$15 USD/mes por usuario extra).
                  </p>

                  <ul className="pricing-list">
                    <li>
                      <CheckCircle size={18} aria-hidden="true" />
                      <span><strong>Todo lo incluido en el Plan Base</strong> (POS, Cajas, DGII, Nómina).</span>
                    </li>
                    <li>
                      <CheckCircle size={18} aria-hidden="true" />
                      <span><strong>Registro y Directorio CRM de Clientes</strong> con historial de visitas.</span>
                    </li>
                    <li>
                      <CheckCircle size={18} aria-hidden="true" />
                      <span><strong>Módulo completo de Suscripciones (Plan Beauty):</strong> creación de planes y control de ciclos de 30 días.</span>
                    </li>
                    <li>
                      <CheckCircle size={18} aria-hidden="true" />
                      <span><strong>Validación automática en POS</strong> de lavados disponibles (RD$ 0 cuando tiene cupo activo).</span>
                    </li>
                    <li>
                      <CheckCircle size={18} aria-hidden="true" />
                      <span><strong>Contratos digitales</strong> con firma en pantalla y cobros recurrentes.</span>
                    </li>
                    <li>
                      <CheckCircle size={18} aria-hidden="true" />
                      <span><strong>Descuento automático de cumpleaños (15%)</strong>, encuestas de satisfacción y Gift Cards.</span>
                    </li>
                  </ul>
                </div>

                <button
                  type="button"
                  onClick={(e) => openAuthModal(false, e.currentTarget, 'pro')}
                  className="landing-btn btn-accent"
                  style={{ width: '100%' }}
                >
                  Comenzar con Plan Pro
                </button>
              </article>
            </div>

            <div className="pricing-conditions-note" style={{ maxWidth: '1080px', margin: '0 auto' }}>
              <strong>Condiciones de licenciamiento SaaS:</strong> La facturación de la licencia es mensual por cada sucursal activa registrada. En el <strong>Plan Base</strong>, los módulos de registro de clientes y suscripciones permanecen ocultos para mantener una interfaz limpia enfocada en caja rápida. Puedes cambiar entre Plan Base y Plan Pro en cualquier momento desde tu panel administrativo. Consulta nuestros{' '}
              <Link to="/terminos-y-condiciones" style={{ color: 'var(--lp-accent)', fontWeight: 700 }}>
                Términos del Servicio
              </Link>{' '}
              y{' '}
              <Link to="/cancelacion-y-reembolsos" style={{ color: 'var(--lp-accent)', fontWeight: 700 }}>
                Política de Cancelación
              </Link>.
            </div>
          </div>
        </section>

        {/* 7. RED DE SALONES CONECTADOS EN OPERACIÓN REAL */}
        <section className="section-block bg-alt" id="sucursales">
          <div className="container">
            <div className="branches-flex">
              <div className="branches-info">
                <span className="section-tag">Red de Salones Conectados</span>
                <h2 className="section-title" style={{ textAlign: 'left', marginBottom: '1.25rem' }}>
                  Impulsando en vivo salones y <span>centros de belleza líderes</span>
                </h2>
                <p style={{ color: 'var(--lp-muted)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
                  Nuestra plataforma gestiona en tiempo real la facturación POS, las comisiones de estilistas y las membresías mensuales de salones en República Dominicana:
                </p>

                <article className="branch-card">
                  <MapPin className="pin-icon" size={22} aria-hidden="true" />
                  <div>
                    <h3>Sucursal Zona Oriental (Plan Pro Activo)</h3>
                    <p>Av. San Vicente de Paul esq. Puerto Rico, Plaza El Poder Local 1F, Santo Domingo Este.</p>
                    <p className="branch-hours">Operando POS Térmico, Cajas, Comisiones y Membresías Plan Beauty</p>
                  </div>
                </article>

                <article className="branch-card">
                  <MapPin className="pin-icon" size={22} aria-hidden="true" />
                  <div>
                    <h3>Sucursal Santo Domingo Norte (Plan Pro Activo)</h3>
                    <p>Av. Hermanas Mirabal, dentro de Multicentro comercial, Santo Domingo Norte.</p>
                    <p className="branch-hours">Operando Multi-Sucursal en tiempo real con inventario sincronizado</p>
                  </div>
                </article>

                <article className="branch-card">
                  <Phone className="pin-icon" size={22} aria-hidden="true" />
                  <div>
                    <h3>Ventas y Demostraciones SaaS</h3>
                    <p>Teléfono: (809) 561-5000 &bull; Correo: contacto@salonpro.com</p>
                  </div>
                </article>
              </div>

              <div className="branches-image">
                <img
                  src="/landing_assets/salon2_opt.jpg"
                  alt="Estaciones de trabajo de salón de belleza operando con la plataforma SaaS"
                  width="800"
                  height="800"
                  loading="lazy"
                />
              </div>
            </div>
          </div>
        </section>

        {/* 8. GARANTÍAS TÉCNICAS Y OPERATIVAS VERIFICABLES */}
        <section className="section-block bg-white" aria-labelledby="trust-heading">
          <div className="container">
            <div className="section-header">
              <span className="section-tag">Arquitectura Empresarial</span>
              <h2 id="trust-heading" className="section-title">
                Seguridad y control empresarial <span>multi-tenant</span>
              </h2>
              <p className="section-subtitle">
                Construido con las reglas operativas reales que protegen la caja y la contabilidad del dueño de salón.
              </p>
            </div>

            <div className="trust-grid">
              <div className="trust-card">
                <div className="benefit-icon" aria-hidden="true">
                  <Building2 size={22} />
                </div>
                <h3>Aislamiento por Salón (Tenant)</h3>
                <p>
                  Cada salón cuenta con sus propias sucursales, personal, cierres de caja, clientes y secuencias fiscales completamente independientes.
                </p>
              </div>

              <div className="trust-card">
                <div className="benefit-icon" aria-hidden="true">
                  <ShieldCheck size={22} />
                </div>
                <h3>Control de Caja con PIN</h3>
                <p>
                  Bloqueo automático ante intentos de modificar precios base o aplicar descuentos manuales sin autorización del administrador.
                </p>
              </div>

              <div className="trust-card">
                <div className="benefit-icon" aria-hidden="true">
                  <Receipt size={22} />
                </div>
                <h3>Impresión Térmica Homologada</h3>
                <p>
                  Formato de pre-cuenta y factura calibrado a 60mm sobre impresoras de 80mm para evitar recortes en el cabezal térmico, con QR integrado.
                </p>
              </div>

              <div className="trust-card">
                <div className="benefit-icon" aria-hidden="true">
                  <Phone size={22} />
                </div>
                <h3>Soporte Especializado en RD</h3>
                <p>
                  Adaptado a las normativas fiscales de la DGII en República Dominicana (606, 607, IT-1 y e-CF) con acompañamiento directo.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 9. PREGUNTAS FRECUENTES DEL SAAS */}
        <section className="section-block bg-alt" id="faq">
          <div className="container">
            <div className="section-header">
              <span className="section-tag">Resuelve tus dudas</span>
              <h2 className="section-title">
                Preguntas <span>frecuentes</span> sobre la plataforma
              </h2>
              <p className="section-subtitle">
                Respuestas claras sobre el licenciamiento de Plan Base, Plan Pro, usuarios y módulos incluidos.
              </p>
            </div>

            <div className="faq-list">
              {SAAS_FAQS.map((item, idx) => {
                const isOpen = openFaqIndex === idx;
                const answerId = `landing-faq-answer-${idx}`;
                return (
                  <div key={idx} className="faq-item">
                    <button
                      type="button"
                      className="faq-trigger"
                      aria-expanded={isOpen}
                      aria-controls={answerId}
                      onClick={() => setOpenFaqIndex(isOpen ? -1 : idx)}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                        <HelpCircle size={18} aria-hidden="true" style={{ color: 'var(--lp-accent)', flexShrink: 0 }} />
                        <span>{item.question}</span>
                      </span>
                      {isOpen ? (
                        <ChevronUp size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
                      ) : (
                        <ChevronDown size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
                      )}
                    </button>
                    {isOpen && (
                      <div id={answerId} className="faq-answer">
                        {item.answer}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* 10. CTA FINAL */}
        <section className="final-cta-section">
          <div className="container">
            <div className="final-cta-box">
              <h2>¿Listo para modernizar la gestión de <span>tu salón</span>?</h2>
              <p>
                Crea la cuenta de tu salón en minutos eligiendo el Plan Base ($49/mes) o el Plan Pro con Suscripciones y Clientes ($99/mes).
              </p>
              <div className="final-cta-buttons">
                <button
                  type="button"
                  onClick={(e) => openAuthModal(false, e.currentTarget, 'pro')}
                  className="landing-btn btn-accent"
                >
                  Registrar mi salón
                </button>
                <button
                  type="button"
                  onClick={(e) => openAuthModal(true, e.currentTarget)}
                  className="landing-btn btn-secondary-outline"
                >
                  Iniciar sesión
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* 11. FOOTER */}
      <PublicFooter />

      {/* ========================================================================
          MODAL UNIFICADO ACCESIBLE DE AUTENTICACIÓN (LOGIN & REGISTRO DE SALÓN EN 3 PASOS)
          No se duplica en el DOM: solo se monta cuando el usuario lo abre.
          ======================================================================== */}
      {isAuthModalOpen && (
        <div
          className="activation-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeAllModals();
          }}
        >
          <div
            ref={authModalRef}
            className="modal-dialog-wrapper"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-modal-title"
          >
            <div className="login-card">
              <div className="modal-header-row">
                <div>
                  <h2 id="auth-modal-title">
                    {regSuccess
                      ? '¡SALÓN REGISTRADO!'
                      : isLogin
                      ? 'INICIA SESIÓN'
                      : 'REGISTRA TU SALÓN'}
                  </h2>
                  <hr className="title-hr" />
                </div>
                <button
                  type="button"
                  onClick={closeAllModals}
                  className="modal-close-btn"
                  aria-label="Cerrar ventana"
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>

              {!isLogin && !regSuccess && (
                <div className="stepper-header" aria-label={`Progreso de registro: Paso ${regStep} de 3`}>
                  <div className="stepper-meta">
                    <span>Paso {regStep} de 3</span>
                    <span>
                      {regStep === 1 && 'Datos del propietario'}
                      {regStep === 2 && 'Salón y Plan SaaS'}
                      {regStep === 3 && 'Resumen y activación'}
                    </span>
                  </div>
                  <div className="stepper-bars">
                    <div className={`stepper-bar ${regStep === 1 ? 'active' : 'completed'}`} />
                    <div className={`stepper-bar ${regStep === 2 ? 'active' : regStep > 2 ? 'completed' : ''}`} />
                    <div className={`stepper-bar ${regStep === 3 ? 'active' : ''}`} />
                  </div>
                </div>
              )}

              <div aria-live="polite" aria-atomic="true">
                {error && (
                  <div className="error-msg" role="alert">
                    {error}
                  </div>
                )}
              </div>

              {regSuccess ? (
                <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
                  <div
                    style={{
                      width: '64px',
                      height: '64px',
                      background: '#f0fdf4',
                      color: '#166534',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto 1rem'
                    }}
                    aria-hidden="true"
                  >
                    <CheckCircle2 size={36} />
                  </div>
                  <p style={{ color: 'var(--lp-muted)', fontSize: '0.92rem', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                    Tu salón <strong>{businessName}</strong> ha sido creado con el <strong>{selectedPlanCode === 'pro' ? 'Plan Pro ($99/mes)' : 'Plan Base ($49/mes)'}</strong>. Ya puedes ingresar con tu correo <strong>{email}</strong> y tu contraseña.
                  </p>
                  <button
                    type="button"
                    onClick={handleBackToLogin}
                    className="landing-btn btn-primary"
                    style={{ width: '100%' }}
                  >
                    Ir a iniciar sesión
                  </button>
                </div>
              ) : isLogin ? (
                <form onSubmit={handleLogin} noValidate>
                  <div className="landing-form-group">
                    <label htmlFor="login-identifier" className="field-label">
                      Correo electrónico o usuario <span className="req">*</span>
                    </label>
                    <div className="input-with-icon">
                      <User className="input-icon" size={18} aria-hidden="true" />
                      <input
                        id="login-identifier"
                        type="text"
                        autoComplete="username"
                        placeholder="admin@tusalon.com o cédula"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="landing-form-group">
                    <label htmlFor="login-password" className="field-label">
                      Contraseña <span className="req">*</span>
                    </label>
                    <div className="input-with-icon">
                      <Lock className="input-icon" size={18} aria-hidden="true" />
                      <input
                        id="login-password"
                        className="has-toggle"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        placeholder="Ingresa tu contraseña"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        className="toggle-pass"
                        aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="landing-btn btn-primary"
                    style={{ width: '100%', marginTop: '0.5rem' }}
                    disabled={loading}
                  >
                    {loading ? 'INGRESANDO...' : 'INICIAR SESIÓN'}
                  </button>

                  <button
                    type="button"
                    className="forgot-link"
                    onClick={() => {
                      setIsAuthModalOpen(false);
                      setShowForgotModal(true);
                      setForgotStep(1);
                      setForgotError('');
                    }}
                  >
                    ¿Olvidaste tu contraseña?
                  </button>

                  <p className="landing-form-footer">
                    ¿Aún no has registrado tu salón?{' '}
                    <button
                      type="button"
                      className="toggle-link"
                      onClick={() => {
                        setIsLogin(false);
                        setError('');
                        setRegStep(1);
                      }}
                    >
                      Registrar mi salón
                    </button>
                  </p>
                </form>
              ) : (
                <form onSubmit={handleRegisterStepValidation} noValidate>
                  {regStep === 1 && (
                    <>
                      <div className="landing-form-group">
                        <label htmlFor="reg-owner-name" className="field-label">
                          Nombre del propietario o administrador <span className="req">*</span>
                        </label>
                        <div className="input-with-icon">
                          <User className="input-icon" size={18} aria-hidden="true" />
                          <input
                            id="reg-owner-name"
                            type="text"
                            autoComplete="name"
                            placeholder="Ej. Laura Martínez"
                            value={ownerName}
                            onChange={(e) => {
                              const val = e.target.value;
                              setOwnerName(val);
                              if (val && !validateName(val)) {
                                setError('El nombre solo debe contener letras y espacios.');
                              } else {
                                setError('');
                              }
                            }}
                            required
                          />
                        </div>
                      </div>

                      <div className="landing-form-group">
                        <label htmlFor="reg-telefono" className="field-label">
                          Teléfono móvil / WhatsApp <span className="req">*</span>
                        </label>
                        <div className="input-with-icon">
                          <Phone className="input-icon" size={18} aria-hidden="true" />
                          <input
                            id="reg-telefono"
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel"
                            placeholder="8090000000"
                            value={telefono}
                            onChange={(e) => setTelefono(cleanPhone(e.target.value))}
                            required
                          />
                        </div>
                      </div>

                      <div className="landing-form-group">
                        <label htmlFor="reg-email" className="field-label">
                          Correo electrónico del administrador <span className="req">*</span>
                        </label>
                        <div className="input-with-icon">
                          <Mail className="input-icon" size={18} aria-hidden="true" />
                          <input
                            id="reg-email"
                            type="email"
                            autoComplete="email"
                            placeholder="admin@tusalon.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                          />
                        </div>
                      </div>

                      <button type="submit" className="landing-btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>
                        Continuar al paso 2
                      </button>
                    </>
                  )}

                  {regStep === 2 && (
                    <>
                      <div className="landing-form-group">
                        <label htmlFor="reg-business-name" className="field-label">
                          Nombre comercial del salón <span className="req">*</span>
                        </label>
                        <div className="input-with-icon">
                          <Building2 className="input-icon" size={18} aria-hidden="true" />
                          <input
                            id="reg-business-name"
                            type="text"
                            autoComplete="organization"
                            placeholder="Ej. Glamour Beauty Studio"
                            value={businessName}
                            onChange={(e) => setBusinessName(e.target.value)}
                            required
                          />
                        </div>
                      </div>

                      <div className="field-row-2col">
                        <div className="landing-form-group">
                          <label htmlFor="reg-plan" className="field-label">
                            Plan SaaS <span className="req">*</span>
                          </label>
                          <div className="input-with-icon">
                            <Crown className="input-icon" size={18} aria-hidden="true" />
                            <select
                              id="reg-plan"
                              value={selectedPlanCode}
                              onChange={(e) => setSelectedPlanCode(e.target.value)}
                              required
                            >
                              <option value="base">Plan Base ($49/sede)</option>
                              <option value="pro">Plan Pro ($99/sede)</option>
                            </select>
                          </div>
                        </div>

                        <div className="landing-form-group">
                          <label htmlFor="reg-branches" className="field-label">
                            Sucursales <span className="req">*</span>
                          </label>
                          <div className="input-with-icon">
                            <MapPin className="input-icon" size={18} aria-hidden="true" />
                            <select
                              id="reg-branches"
                              value={licensedBranches}
                              onChange={(e) => setLicensedBranches(Number(e.target.value))}
                              required
                            >
                              {[1, 2, 3, 4, 5].map((n) => (
                                <option key={n} value={n}>
                                  {n} {n === 1 ? 'Sucursal' : 'Sucursales'}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>

                      <div className="landing-form-group">
                        <label htmlFor="reg-rnc" className="field-label">
                          RNC del salón (Opcional)
                        </label>
                        <div className="input-with-icon">
                          <CreditCard className="input-icon" size={18} aria-hidden="true" />
                          <input
                            id="reg-rnc"
                            type="text"
                            inputMode="numeric"
                            placeholder="Ej. 131-00000-1"
                            value={rnc}
                            onChange={(e) => setRnc(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="landing-form-group">
                        <label htmlFor="reg-owner-password" className="field-label">
                          Crea tu contraseña de administrador <span className="req">*</span>
                        </label>
                        <div className="input-with-icon">
                          <Lock className="input-icon" size={18} aria-hidden="true" />
                          <input
                            id="reg-owner-password"
                            className="has-toggle"
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="new-password"
                            placeholder="Mínimo 6 caracteres"
                            value={ownerPassword}
                            onChange={(e) => setOwnerPassword(e.target.value)}
                            required
                          />
                          <button
                            type="button"
                            className="toggle-pass"
                            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                            onClick={() => setShowPassword(!showPassword)}
                          >
                            {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                          </button>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setError('');
                            setRegStep(1);
                          }}
                          className="landing-btn btn-secondary-outline"
                          style={{ flex: 1 }}
                        >
                          Atrás
                        </button>
                        <button type="submit" className="landing-btn btn-primary" style={{ flex: 2 }}>
                          Revisar resumen
                        </button>
                      </div>
                    </>
                  )}

                  {regStep === 3 && (
                    <>
                      <div className="plan-summary-box">
                        <h3>Resumen de Licencia SaaS para tu Salón</h3>
                        <ul className="plan-summary-list">
                          <li><strong>Salón:</strong> {businessName} {rnc ? `(RNC: ${rnc})` : ''}</li>
                          <li><strong>Administrador:</strong> {ownerName} ({email})</li>
                          <li>
                            <strong>Plan seleccionado:</strong>{' '}
                            {selectedPlanCode === 'pro'
                              ? 'Plan Pro ($99 USD/mes por sede — Incluye Clientes + Suscripciones)'
                              : 'Plan Base ($49 USD/mes por sede — POS, Cajas, Usuarios y DGII)'}
                          </li>
                          <li>
                            <strong>Sucursales y Usuarios:</strong> {licensedBranches} {licensedBranches === 1 ? 'sucursal' : 'sucursales'} ({licensedBranches * 3} usuarios incluidos)
                          </li>
                          <li><strong>Total mensual estimado:</strong> ${totalEstimatedMonthly}.00 USD / mes</li>
                        </ul>
                      </div>

                      <p style={{ fontSize: '0.82rem', color: 'var(--lp-muted)', margin: '0 0 0.75rem 0', lineHeight: 1.5 }}>
                        Al confirmar, crearemos el entorno aislado de tu salón y tu usuario propietario sin realizar ningún cobro automático en este paso.
                      </p>

                      <div className="checkbox-consent-group">
                        <input
                          id="reg-accept-terms"
                          type="checkbox"
                          checked={acceptTerms}
                          onChange={(e) => setAcceptTerms(e.target.checked)}
                          required
                        />
                        <label htmlFor="reg-accept-terms">
                          He leído y acepto los{' '}
                          <Link to="/terminos-y-condiciones" target="_blank" rel="noopener noreferrer">
                            Términos y Condiciones
                          </Link>{' '}
                          y la{' '}
                          <Link to="/cancelacion-y-reembolsos" target="_blank" rel="noopener noreferrer">
                            Política de Cancelación
                          </Link>.
                        </label>
                      </div>

                      <div style={{ display: 'flex', gap: '0.75rem' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setError('');
                            setRegStep(2);
                          }}
                          className="landing-btn btn-secondary-outline"
                          style={{ flex: 1 }}
                          disabled={loading}
                        >
                          Atrás
                        </button>
                        <button
                          type="submit"
                          className="landing-btn btn-accent"
                          style={{ flex: 2 }}
                          disabled={loading}
                        >
                          {loading ? 'CREANDO SALÓN...' : 'CREAR MI SALÓN AHORA'}
                        </button>
                      </div>
                    </>
                  )}

                  <p className="landing-form-footer">
                    ¿Tu salón ya tiene cuenta?{' '}
                    <button
                      type="button"
                      className="toggle-link"
                      onClick={() => {
                        setIsLogin(true);
                        setError('');
                      }}
                    >
                      Inicia sesión
                    </button>
                  </p>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL ACCESIBLE DE RECUPERACIÓN DE CONTRASEÑA */}
      {showForgotModal && (
        <div
          className="activation-overlay"
          style={{ zIndex: 2100 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeAllModals();
          }}
        >
          <div
            ref={forgotModalRef}
            className="modal-dialog-wrapper"
            role="dialog"
            aria-modal="true"
            aria-labelledby="forgot-modal-title"
          >
            <div className="login-card">
              <div className="modal-header-row">
                <div>
                  <h2 id="forgot-modal-title">
                    {forgotStep === 1 ? 'RECUPERAR CUENTA' : 'NUEVA CONTRASEÑA'}
                  </h2>
                  <hr className="title-hr" />
                </div>
                <button
                  type="button"
                  onClick={closeAllModals}
                  className="modal-close-btn"
                  aria-label="Cerrar recuperación de contraseña"
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>

              <div aria-live="polite" aria-atomic="true">
                {forgotError && (
                  <div className="error-msg" role="alert">
                    {forgotError}
                  </div>
                )}
                {forgotSuccess && (
                  <div className="success-msg" role="status">
                    ¡Contraseña actualizada con éxito! Redirigiendo al inicio de sesión...
                  </div>
                )}
              </div>

              {!forgotSuccess && (
                <form onSubmit={forgotStep === 1 ? handleForgotPassword : handleResetPassword}>
                  {forgotStep === 1 ? (
                    <>
                      <p style={{ fontSize: '0.88rem', color: 'var(--lp-muted)', marginBottom: '1.15rem' }}>
                        Ingresa tu correo electrónico registrado para recibir un código de verificación de 6 dígitos.
                      </p>
                      <div className="landing-form-group">
                        <label htmlFor="forgot-identifier" className="field-label">
                          Correo electrónico <span className="req">*</span>
                        </label>
                        <div className="input-with-icon">
                          <Mail className="input-icon" size={18} aria-hidden="true" />
                          <input
                            id="forgot-identifier"
                            type="text"
                            placeholder="admin@tusalon.com"
                            value={forgotEmail}
                            onChange={(e) => setForgotEmail(e.target.value)}
                            required
                          />
                        </div>
                      </div>
                      <button
                        type="submit"
                        className="landing-btn btn-primary"
                        style={{ width: '100%' }}
                        disabled={forgotLoading}
                      >
                        {forgotLoading ? 'ENVIANDO...' : 'ENVIAR CÓDIGO'}
                      </button>
                    </>
                  ) : (
                    <>
                      <p style={{ fontSize: '0.88rem', color: 'var(--lp-muted)', marginBottom: '1.15rem' }}>
                        Hemos enviado un código a <strong>{forgotEmail}</strong>. Ingrésalo junto a tu nueva contraseña.
                      </p>
                      <div className="landing-form-group">
                        <label htmlFor="forgot-code" className="field-label">
                          Código de 6 dígitos <span className="req">*</span>
                        </label>
                        <div className="input-with-icon">
                          <ShieldCheck className="input-icon" size={18} aria-hidden="true" />
                          <input
                            id="forgot-code"
                            type="text"
                            inputMode="numeric"
                            placeholder="000000"
                            value={resetCode}
                            onChange={(e) => setResetCode(e.target.value)}
                            maxLength="6"
                            required
                          />
                        </div>
                      </div>
                      <div className="landing-form-group">
                        <label htmlFor="forgot-new-password" className="field-label">
                          Nueva contraseña <span className="req">*</span>
                        </label>
                        <div className="input-with-icon">
                          <Lock className="input-icon" size={18} aria-hidden="true" />
                          <input
                            id="forgot-new-password"
                            className="has-toggle"
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="new-password"
                            placeholder="Crea tu nueva contraseña"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            required
                          />
                          <button
                            type="button"
                            className="toggle-pass"
                            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                            onClick={() => setShowPassword(!showPassword)}
                          >
                            {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                          </button>
                        </div>
                      </div>
                      <button
                        type="submit"
                        className="landing-btn btn-primary"
                        style={{ width: '100%' }}
                        disabled={forgotLoading}
                      >
                        {forgotLoading ? 'ACTUALIZANDO...' : 'RESTABLECER CONTRASEÑA'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setForgotStep(1)}
                        className="forgot-link"
                      >
                        Reintentar con otro correo
                      </button>
                    </>
                  )}
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL ACCESIBLE DE ACTIVACIÓN DE CUENTA */}
      {showActivation && (
        <div
          className="activation-overlay"
          style={{ zIndex: 2200 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeAllModals();
          }}
        >
          <div
            ref={activationModalRef}
            className="modal-dialog-wrapper"
            role="dialog"
            aria-modal="true"
            aria-labelledby="activation-modal-title"
          >
            <div className="activation-card" style={{ textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={closeAllModals}
                  className="modal-close-btn"
                  aria-label="Cerrar ventana de activación"
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>
              <div className="activation-icon-bg" aria-hidden="true">
                <Lock size={30} />
              </div>
              <h2 id="activation-modal-title" style={{ textAlign: 'center' }}>ACTIVA TU CUENTA</h2>
              <p style={{ fontSize: '0.9rem', color: 'var(--lp-muted)', margin: '0.75rem 0 1rem' }}>
                Ingresa el código de 6 dígitos enviado a tu correo electrónico para activar tu perfil.
              </p>

              <div aria-live="polite" aria-atomic="true">
                {error && (
                  <div className="error-msg" role="alert">
                    {error}
                  </div>
                )}
              </div>

              <form onSubmit={handleActivate}>
                <label htmlFor="activation-code-input" className="field-label" style={{ textAlign: 'center' }}>
                  Código de activación
                </label>
                <input
                  id="activation-code-input"
                  type="text"
                  inputMode="numeric"
                  maxLength="6"
                  placeholder="000000"
                  value={activationCode}
                  onChange={(e) => setActivationCode(e.target.value)}
                  className="activation-input"
                  required
                />

                <button type="submit" className="landing-btn btn-primary" style={{ width: '100%' }}>
                  VERIFICAR Y ACTIVAR
                </button>
                <button
                  type="button"
                  onClick={closeAllModals}
                  className="forgot-link"
                >
                  Cancelar
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Landing;
