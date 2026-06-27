import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/LanguageContext';
import { 
  User, Lock, Mail, CreditCard, ShieldCheck, CalendarDays, 
  CheckCircle, CheckCircle2, Camera, Share2, MessageCircle, MapPin, Phone, Eye, EyeOff, Sparkles, X
} from 'lucide-react';
import './Landing.css';
import { formatCedula, validateName, cleanPhone, isValidCedula } from '../utils/formUtils';

const Landing = () => {
  const { login } = useAuth();
  const { t } = useTranslation();
  
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [cedula, setCedula] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Success state for registration
  const [regSuccess, setRegSuccess] = useState(false);
  
  const [regStep, setRegStep] = useState(1);
  const [salons, setSalons] = useState([]);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [telefono, setTelefono] = useState('');
  const [salonId, setSalonId] = useState('');
  const [calle, setCalle] = useState('');
  const [numero, setNumero] = useState('');
  const [sector, setSector] = useState('');
  const [ciudad, setCiudad] = useState('');
  const [fechaNacimiento, setFechaNacimiento] = useState('');
  
  // Forgot Password Flow
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotStep, setForgotStep] = useState(1); // 1: Email, 2: Code & New Pass
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState(false);

  // Account Activation Flow
  const [showActivation, setShowActivation] = useState(false);
  const [activationCode, setActivationCode] = useState('');
  const [pendingClientId, setPendingClientId] = useState(null);

  useEffect(() => {
    const loadSalons = async () => {
      try {
        const res = await fetch('/api/salons');
        if (res.ok) {
          const data = await res.json();
          setSalons(data);
        }
      } catch (err) {
        console.error("Error loading salons:", err);
      }
    };
    loadSalons();
  }, []);

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
        setError(''); // Clear error to show activation screen properly
        setShowActivation(true);
      } else {
        setError(err.message || 'Error al iniciar sesión');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          nombre, cedula, email, telefono, 
          salon_id: salonId, calle, numero, sector, ciudad,
          fechaNacimiento
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      setRegSuccess(true);
      setIsAuthModalOpen(true); // Ensure modal is open to show success
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBackToLogin = () => {
    setRegSuccess(false);
    setIsLogin(true);
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
      if (!res.ok) throw new Error(data.error);
      
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
      if (!res.ok) throw new Error(data.error);
      
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
      }, 3000);
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
      if (!res.ok) throw new Error(data.error);
      
      alert("¡Cuenta activada! Ya puedes iniciar sesión.");
      setShowActivation(false);
      setActivationCode('');
      setIsLogin(true);
      setIsAuthModalOpen(true);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="landing-page">
      {/* Header */}
      <header className="landing-header">
        <div className="container">
          <nav className="landing-nav">
            <div className="logo">
              <a href="#inicio">PLAN<span>BEAUTY</span>RD</a>
              <p>TU PLAN, TU BELLEZA</p>
            </div>
            <ul className="nav-links">
              <li><a href="#inicio">Inicio</a></li>
              <li><a href="#plan">Plan</a></li>
              <li><a href="#como-funciona">¿Cómo funciona?</a></li>
              <li><a href="#sucursales">Sucursales</a></li>
            </ul>
            <button onClick={() => { setIsLogin(true); setIsAuthModalOpen(true); }} className="login-btn-nav">
              <User size={18} />
              INICIAR SESIÓN
            </button>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="hero" id="inicio">
        <div className="container hero-grid">
          <div className="hero-content">
            <h1>TU PLAN DE <span>BELLEZA</span> SIN COMPLICACIONES</h1>
            <p>Un plan mensual para disfrutar de lavados y cuidados en nuestro salón de belleza.</p>
            <button onClick={() => { setIsLogin(false); setIsAuthModalOpen(true); }} className="landing-btn btn-primary">QUIERO MI PLAN</button>
          </div>

          <div className="login-container" id="login-section">
            {isLogin ? (
              <div className="login-card">
                <h2>INICIA SESIÓN</h2>
                <hr className="title-hr" />
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={handleLogin}>
                  <div className="landing-form-group">
                    <User className="input-icon" />
                    <input 
                      type="text" 
                      placeholder="Cédula o correo electrónico"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="landing-form-group">
                    <Lock className="input-icon" />
                    <input 
                      type={showPassword ? "text" : "password"} 
                      placeholder="Contraseña"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                    />
                    <button type="button" className="toggle-pass" onClick={() => setShowPassword(!showPassword)}>
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <button type="submit" className="landing-btn btn-primary" disabled={loading}>
                    {loading ? 'CARGANDO...' : 'INICIAR SESIÓN'}
                  </button>
                  <a href="#" className="forgot-link" onClick={(e) => { 
                    e.preventDefault(); 
                    setIsAuthModalOpen(false);
                    setShowForgotModal(true); 
                    setForgotStep(1);
                    setForgotError('');
                  }}>¿Olvidaste tu contraseña?</a>
                  <p className="landing-form-footer">¿No tienes cuenta? <span className="toggle-link" onClick={() => { setIsLogin(false); setError(''); }}>Crear cuenta</span></p>
                </form>
              </div>
            ) : (
              <div className="login-card">
                <h2>REGÍSTRATE</h2>
                <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', marginBottom: '1rem' }}>
                  <div style={{ width: '20px', height: '4px', background: regStep === 1 ? 'var(--lp-accent)' : '#eee', borderRadius: '2px' }}></div>
                  <div style={{ width: '20px', height: '4px', background: regStep === 2 ? 'var(--lp-accent)' : '#eee', borderRadius: '2px' }}></div>
                </div>
                <hr className="title-hr" />
                {error && <div className="error-msg">{error}</div>}
                <form onSubmit={(e) => {
                  e.preventDefault();
                  if (regStep === 1) {
                    if (!validateName(nombre)) return setError("El nombre no debe contener números");
                    if (!isValidCedula(cedula)) return setError("La cédula debe tener 11 dígitos");
                    setRegStep(2);
                  } else {
                    handleRegister(e);
                  }
                }}>
                  {regStep === 1 ? (
                    <>
                      <div className="landing-form-group">
                        <User className="input-icon" />
                        <input 
                          type="text" 
                          placeholder="Nombre completo"
                          value={nombre}
                          onChange={e => {
                            const val = e.target.value;
                            setNombre(val);
                            if (val && !validateName(val)) setError("El nombre no debe contener números");
                            else setError('');
                          }}
                          required
                        />
                      </div>
                      <div className="landing-form-group">
                        <CreditCard className="input-icon" />
                        <input 
                          type="text" 
                          placeholder="000-0000000-0"
                          value={cedula}
                          onChange={e => setCedula(formatCedula(e.target.value))}
                          required
                        />
                      </div>
                      <div className="landing-form-group">
                        <Phone className="input-icon" />
                        <input 
                          type="text" 
                          placeholder="Teléfono"
                          value={telefono}
                          onChange={e => setTelefono(cleanPhone(e.target.value))}
                          required
                        />
                      </div>
                      <div className="landing-form-group">
                        <Mail className="input-icon" />
                        <input 
                          type="email" 
                          placeholder="Correo electrónico"
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          required
                        />
                      </div>
                      <div className="landing-form-group">
                        <CalendarDays className="input-icon" />
                        <label style={{ position: 'absolute', top: '-1.2rem', left: '0.5rem', fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--lp-accent)' }}>FECHA DE NACIMIENTO</label>
                        <input 
                          type="date" 
                          placeholder="Fecha de Nacimiento"
                          value={fechaNacimiento}
                          onChange={e => setFechaNacimiento(e.target.value)}
                          required
                          style={{ color: fechaNacimiento ? 'var(--lp-text)' : '#999' }}
                        />
                      </div>
                      <div className="landing-form-group">
                        <MapPin className="input-icon" />
                        <select 
                          value={salonId} 
                          onChange={e => setSalonId(e.target.value)}
                          required
                          style={{ width: '100%', padding: '1rem 1rem 1rem 3rem', borderRadius: '12px', border: '1.5px solid #eee', outline: 'none', background: 'white' }}
                        >
                          <option value="">Selecciona tu sucursal</option>
                          {salons.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </div>
                      <button type="submit" className="landing-btn btn-primary">
                        SIGUIENTE
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="landing-form-group">
                        <MapPin className="input-icon" />
                        <input 
                          type="text" 
                          placeholder="Calle"
                          value={calle}
                          onChange={e => setCalle(e.target.value)}
                          required
                        />
                      </div>
                      <div className="landing-form-group">
                        <Sparkles className="input-icon" />
                        <input 
                          type="text" 
                          placeholder="Número"
                          value={numero}
                          onChange={e => setNumero(e.target.value)}
                        />
                      </div>
                      <div className="landing-form-group">
                        <MapPin className="input-icon" />
                        <input 
                          type="text" 
                          placeholder="Sector"
                          value={sector}
                          onChange={e => setSector(e.target.value)}
                          required
                        />
                      </div>
                      <div className="landing-form-group">
                        <MapPin className="input-icon" />
                        <select 
                          value={ciudad} 
                          onChange={e => setCiudad(e.target.value)} 
                          required 
                          style={{ 
                            width: '100%', 
                            padding: '1rem 3rem', 
                            borderRadius: '12px', 
                            border: '1.5px solid #eee',
                            appearance: 'auto',
                            background: 'white',
                            color: ciudad ? 'var(--text-primary)' : '#999',
                            cursor: 'pointer'
                          }}
                        >
                          <option value="">Selecciona Ciudad</option>
                          <option value="Distrito Nacional">Distrito Nacional</option>
                          <option value="Santo Domingo Este">Santo Domingo Este</option>
                          <option value="Santo Domingo Norte">Santo Domingo Norte</option>
                          <option value="Santo Domingo Oeste">Santo Domingo Oeste</option>
                          <option value="Santiago">Santiago</option>
                          <option value="Punta Cana">Punta Cana</option>
                          <option value="La Romana">La Romana</option>
                          <option value="Puerto Plata">Puerto Plata</option>
                          <option value="Higüey">Higüey</option>
                          <option value="San Pedro de Macorís">San Pedro de Macorís</option>
                          <option value="San Francisco de Macorís">San Francisco de Macorís</option>
                          <option value="La Vega">La Vega</option>
                          <option value="San Cristóbal">San Cristóbal</option>
                          <option value="Baní">Baní</option>
                          <option value="Bonao">Bonao</option>
                          <option value="Moca">Moca</option>
                          <option value="Cotuí">Cotuí</option>
                          <option value="Samaná">Samaná</option>
                          <option value="Monte Plata">Monte Plata</option>
                          <option value="Azua">Azua</option>
                          <option value="Barahona">Barahona</option>
                          <option value="San Juan">San Juan</option>
                          <option value="Mao">Mao</option>
                          <option value="Nagua">Nagua</option>
                        </select>
                      </div>
                      <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                        <button type="button" onClick={() => setRegStep(1)} className="landing-btn" style={{ background: '#eee', flex: 1 }}>ATRÁS</button>
                        <button type="submit" className="landing-btn btn-primary" style={{ flex: 2 }} disabled={loading}>
                          {loading ? 'CARGANDO...' : 'CREAR CUENTA'}
                        </button>
                      </div>
                    </>
                  )}
                  <p className="landing-form-footer">¿Ya tienes cuenta? <span className="toggle-link" onClick={() => { setIsLogin(true); setError(''); setRegStep(1); }}>Inicia sesión</span></p>
                </form>
              </div>
            )}
          </div>
        </div>

        <div className="hero-footer-badges">
          <div className="container badges-grid">
            <div className="badge-item">
              <div className="badge-icon"><ShieldCheck /></div>
              <div className="badge-text">
                <h4>ACCESO SEGURO</h4>
                <p>Validación con cédula</p>
              </div>
            </div>
            <div className="badge-item">
              <div className="badge-icon"><CalendarDays /></div>
              <div className="badge-text">
                <h4>SIN CITAS</h4>
                <p>Llega y disfruta tu servicio</p>
              </div>
            </div>
            <div className="badge-item">
              <div className="badge-icon"><CheckCircle2 /></div>
              <div className="badge-text">
                <h4>ATENCIÓN PREMIUM</h4>
                <p>Profesionales dedicados</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Steps */}
      <section className="steps-section" id="como-funciona">
        <div className="container">
          <h2 className="section-title">¿CÓMO <span>FUNCIONA</span>?</h2>
          <div className="steps-grid">
            <div className="step">
              <div className="step-num">01</div>
              <div className="step-icon-bg"><CalendarDays size={32} /></div>
              <h3>ELIGE TU PLAN</h3>
              <p>Suscríbete en minutos y comienza hoy.</p>
            </div>
            <div className="step">
              <div className="step-num">02</div>
              <div className="step-icon-bg"><MapPin size={32} /></div>
              <h3>VISITA EL SALÓN</h3>
              <p>Acude a tu sucursal seleccionada.</p>
            </div>
            <div className="step">
              <div className="step-num">03</div>
              <div className="step-icon-bg"><CheckCircle size={32} /></div>
              <h3>DISFRUTA</h3>
              <p>Vive la experiencia Abatte.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="pricing-section" id="plan">
        <div className="container">
          <h2 className="section-title">NUESTRO PLAN <span>ÚNICO</span></h2>
          <div className="pricing-box">
            <div className="pricing-info">
              <div className="pricing-header-inner">
                <User size={32} />
                <h3>PLAN <span>BEAUTY</span> RD</h3>
              </div>
              <ul className="pricing-list">
                <li><CheckCircle size={18} /> 4 lavados cada 30 días</li>
                <li><CheckCircle size={18} /> Sin importar el largo natural</li>
                <li><CheckCircle size={18} /> Uso exclusivo para ti</li>
                <li><CheckCircle size={18} /> Atención profesional</li>
                <li><CheckCircle size={18} /> Ofertas exclusivas</li>
                <li><CheckCircle size={18} /> Cancelación flexible</li>
              </ul>
            </div>
            <div className="pricing-action">
              <p>TODO LO QUE NECESITAS</p>
              <div className="price-tag">RD$1,950<span>/ MES</span></div>
              <button onClick={() => { setIsLogin(false); setIsAuthModalOpen(true); }} className="landing-btn btn-accent">QUIERO MI PLAN</button>
              <p className="price-footer"><Lock size={12} /> Pagos seguros y automáticos</p>
            </div>
          </div>
        </div>
      </section>

      {/* Branches */}
      <section className="branches-section" id="sucursales">
        <div className="container branches-flex">
          <div className="branches-info">
            <h2 className="section-title">NUESTRAS <span>SUCURSALES</span></h2>
            <div className="branch-card">
              <MapPin className="pin-icon" />
              <div>
                <h4>ABATTE PELUQUERÍA SAN VICENTE</h4>
                <p>Av. San Vicente de Paul esq. Puerto Rico, Plaza El Poder Local 1F</p>
              </div>
            </div>
            <div className="branch-card">
              <Phone className="pin-icon" />
              <div>
                <h4>CONTACTO</h4>
                <p>(809) 561-5000</p>
              </div>
            </div>
          </div>
          <div className="branches-image">
            <img src="/landing_assets/salon2.png" alt="Salón Abatte" />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="container footer-grid">
          <div className="footer-brand">
            <div className="logo">
              <a href="#">PLAN<span>BEAUTY</span>RD</a>
            </div>
            <p>Belleza, confianza y profesionalismo en cada servicio.</p>
            <div className="social">
              <Camera /> <Share2 /> <MessageCircle />
            </div>
          </div>
          <div className="footer-links-col">
            <h4>LEGAL</h4>
            <ul>
              <li><a href="#">Términos y condiciones</a></li>
              <li><a href="#">Privacidad</a></li>
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

      {/* Auth Modal Overlay */}
      {isAuthModalOpen && (
        <div className="activation-overlay" style={{ zIndex: 2000 }}>
          <div style={{ position: 'relative', width: '100%', maxWidth: '450px' }}>
            <button 
              onClick={() => setIsAuthModalOpen(false)} 
              style={{ position: 'absolute', top: '1rem', right: '-3rem', background: 'white', border: 'none', borderRadius: '50%', width: '40px', height: '40px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10 }}
            >
              <X size={24} />
            </button>
            <div className="login-card" style={{ margin: 0, width: '100%' }}>
              <h2>{isLogin ? 'INICIA SESIÓN' : 'REGÍSTRATE'}</h2>
              {!isLogin && (
                <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', marginBottom: '1rem' }}>
                  <div style={{ width: '20px', height: '4px', background: regStep === 1 ? 'var(--lp-accent)' : '#eee', borderRadius: '2px' }}></div>
                  <div style={{ width: '20px', height: '4px', background: regStep === 2 ? 'var(--lp-accent)' : '#eee', borderRadius: '2px' }}></div>
                </div>
              )}
              <hr className="title-hr" />
              {error && <div className="error-msg">{error}</div>}
              
              {!regSuccess ? (
                <form onSubmit={(e) => {
                  if (isLogin) handleLogin(e);
                  else {
                    e.preventDefault();
                    if (regStep === 1) {
                      if (!validateName(nombre)) return setError("El nombre no debe contener números");
                      if (!isValidCedula(cedula)) return setError("La cédula debe tener 11 dígitos");
                      setRegStep(2);
                    } else {
                      handleRegister(e);
                    }
                  }
                }}>
                  {isLogin ? (
                    <>
                      <div className="landing-form-group">
                        <User className="input-icon" />
                        <input type="text" placeholder="Cédula o correo electrónico" value={email} onChange={e => setEmail(e.target.value)} required />
                      </div>
                      <div className="landing-form-group">
                        <Lock className="input-icon" />
                        <input type={showPassword ? "text" : "password"} placeholder="Contraseña" value={password} onChange={e => setPassword(e.target.value)} required />
                        <button type="button" className="toggle-pass" onClick={() => setShowPassword(!showPassword)}>
                          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                      <button type="submit" className="landing-btn btn-primary" disabled={loading}>
                        {loading ? 'CARGANDO...' : 'INICIAR SESIÓN'}
                      </button>
                      <a href="#" className="forgot-link" style={{ display: 'block', textAlign: 'center', margin: '0.5rem 0', fontSize: '0.8rem' }} onClick={(e) => { 
                        e.preventDefault(); 
                        setIsAuthModalOpen(false);
                        setShowForgotModal(true); 
                        setForgotStep(1);
                        setForgotError('');
                      }}>¿Olvidaste tu contraseña?</a>
                      <p className="landing-form-footer">¿No tienes cuenta? <span className="toggle-link" onClick={() => setIsLogin(false)}>Crear cuenta</span></p>
                    </>
                  ) : (
                    <>
                      {regStep === 1 ? (
                        <>
                          <div className="landing-form-group"><User className="input-icon" /><input type="text" placeholder="Nombre completo" value={nombre} onChange={e => setNombre(e.target.value)} required /></div>
                          <div className="landing-form-group"><CreditCard className="input-icon" /><input type="text" placeholder="Cédula" value={cedula} onChange={e => setCedula(formatCedula(e.target.value))} required /></div>
                          <div className="landing-form-group"><Phone className="input-icon" /><input type="text" placeholder="Teléfono" value={telefono} onChange={e => setTelefono(cleanPhone(e.target.value))} required /></div>
                          <div className="landing-form-group"><Mail className="input-icon" /><input type="email" placeholder="Correo" value={email} onChange={e => setEmail(e.target.value)} required /></div>
                          <div className="landing-form-group">
                            <CalendarDays className="input-icon" />
                            <label style={{ position: 'absolute', top: '-1.2rem', left: '0.5rem', fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--lp-accent)' }}>FECHA DE NACIMIENTO</label>
                            <input 
                              type="date" 
                              placeholder="Fecha de Nacimiento" 
                              value={fechaNacimiento} 
                              onChange={e => setFechaNacimiento(e.target.value)} 
                              required 
                              style={{ color: fechaNacimiento ? 'var(--text-primary)' : '#999' }}
                            />
                          </div>
                          <div style={{ marginBottom: '1.5rem' }}></div>
                          <div className="landing-form-group">
                            <MapPin className="input-icon" />
                            <select value={salonId} onChange={e => setSalonId(e.target.value)} required style={{ width: '100%', padding: '1rem 3rem', borderRadius: '12px', border: '1.5px solid #eee' }}>
                              <option value="">Selecciona Sucursal</option>
                              {salons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          </div>
                          <button type="submit" className="landing-btn btn-primary">SIGUIENTE</button>
                        </>
                      ) : (
                        <>
                          <div className="landing-form-group"><MapPin className="input-icon" /><input type="text" placeholder="Calle" value={calle} onChange={e => setCalle(e.target.value)} required /></div>
                          <div className="landing-form-group"><Sparkles className="input-icon" /><input type="text" placeholder="Número" value={numero} onChange={e => setNumero(e.target.value)} /></div>
                          <div className="landing-form-group"><MapPin className="input-icon" /><input type="text" placeholder="Sector" value={sector} onChange={e => setSector(e.target.value)} required /></div>
                          <div className="landing-form-group">
                            <MapPin className="input-icon" />
                            <select 
                              value={ciudad} 
                              onChange={e => setCiudad(e.target.value)} 
                              required 
                              style={{ 
                                width: '100%', 
                                padding: '1rem 3rem', 
                                borderRadius: '12px', 
                                border: '1.5px solid #eee',
                                appearance: 'auto',
                                background: 'white',
                                color: ciudad ? 'var(--text-primary)' : '#999',
                                cursor: 'pointer'
                              }}
                            >
                              <option value="">Selecciona Ciudad</option>
                              <option value="Distrito Nacional">Distrito Nacional</option>
                              <option value="Santo Domingo Este">Santo Domingo Este</option>
                              <option value="Santo Domingo Norte">Santo Domingo Norte</option>
                              <option value="Santo Domingo Oeste">Santo Domingo Oeste</option>
                              <option value="Santiago">Santiago</option>
                              <option value="Punta Cana">Punta Cana</option>
                              <option value="La Romana">La Romana</option>
                              <option value="Puerto Plata">Puerto Plata</option>
                              <option value="Higüey">Higüey</option>
                              <option value="San Pedro de Macorís">San Pedro de Macorís</option>
                              <option value="San Francisco de Macorís">San Francisco de Macorís</option>
                              <option value="La Vega">La Vega</option>
                              <option value="San Cristóbal">San Cristóbal</option>
                              <option value="Baní">Baní</option>
                              <option value="Bonao">Bonao</option>
                              <option value="Moca">Moca</option>
                              <option value="Cotuí">Cotuí</option>
                              <option value="Samaná">Samaná</option>
                              <option value="Monte Plata">Monte Plata</option>
                              <option value="Azua">Azua</option>
                              <option value="Barahona">Barahona</option>
                              <option value="San Juan">San Juan</option>
                              <option value="Mao">Mao</option>
                              <option value="Nagua">Nagua</option>
                            </select>
                          </div>
                          <div style={{ display: 'flex', gap: '1rem' }}>
                            <button type="button" onClick={() => setRegStep(1)} className="landing-btn" style={{ background: '#eee', flex: 1 }}>ATRÁS</button>
                            <button type="submit" className="landing-btn btn-primary" style={{ flex: 2 }} disabled={loading}>{loading ? 'CARGANDO...' : 'CREAR CUENTA'}</button>
                          </div>
                        </>
                      )}
                      <p className="landing-form-footer">¿Ya tienes cuenta? <span className="toggle-link" onClick={() => setIsLogin(true)}>Inicia sesión</span></p>
                    </>
                  )}
                </form>
              ) : (
                <div className="success-overlay" style={{ textAlign: 'center', padding: '1rem' }}>
                  <div style={{ width: '70px', height: '70px', background: '#f0fdf4', color: '#22c55e', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
                    <CheckCircle2 size={40} />
                  </div>
                  <h3 style={{ fontSize: '1.5rem', fontWeight: 900, marginBottom: '1rem' }}>¡Registro Exitoso!</h3>
                  <p style={{ color: '#64748b', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '2rem' }}>
                    Te hemos enviado una <strong>contraseña temporal</strong> a tu correo electrónico. Úsala para iniciar sesión y personalizar tu perfil.
                  </p>
                  <button onClick={handleBackToLogin} className="landing-btn btn-primary" style={{ width: '100%' }}>
                    IR AL INICIO DE SESIÓN
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div className="activation-overlay" style={{ zIndex: 2100 }}>
          <div style={{ position: 'relative', width: '100%', maxWidth: '450px' }}>
            <button 
              onClick={() => setShowForgotModal(false)} 
              style={{ position: 'absolute', top: '1rem', right: '-3rem', background: 'white', border: 'none', borderRadius: '50%', width: '40px', height: '40px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10 }}
            >
              <X size={24} />
            </button>
            <div className="login-card" style={{ margin: 0, width: '100%' }}>
              <h2>{forgotStep === 1 ? 'RECUPERAR CUENTA' : 'NUEVA CONTRASEÑA'}</h2>
              <hr className="title-hr" />
              {forgotError && <div className="error-msg">{forgotError}</div>}
              {forgotSuccess && (
                <div className="success-msg" style={{ background: '#f0fdf4', color: '#166534', padding: '1rem', borderRadius: '12px', marginBottom: '1.5rem', textAlign: 'center', fontWeight: 600 }}>
                  ¡Contraseña actualizada con éxito! Redirigiendo al login...
                </div>
              )}
              
              {!forgotSuccess && (
                <form onSubmit={forgotStep === 1 ? handleForgotPassword : handleResetPassword}>
                  {forgotStep === 1 ? (
                    <>
                      <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1.5rem', textAlign: 'center' }}>
                        Ingresa tu correo o cédula para recibir un código de recuperación.
                      </p>
                      <div className="landing-form-group">
                        <Mail className="input-icon" />
                        <input 
                          type="text" 
                          placeholder="Correo o Cédula" 
                          value={forgotEmail} 
                          onChange={e => setForgotEmail(e.target.value)} 
                          required 
                        />
                      </div>
                      <button type="submit" className="landing-btn btn-primary" disabled={forgotLoading}>
                        {forgotLoading ? 'ENVIANDO...' : 'ENVIAR CÓDIGO'}
                      </button>
                    </>
                  ) : (
                    <>
                      <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1.5rem', textAlign: 'center' }}>
                        Hemos enviado un código a <strong>{forgotEmail}</strong>. Ingrésalo junto a tu nueva contraseña.
                      </p>
                      <div className="landing-form-group">
                        <ShieldCheck className="input-icon" />
                        <input 
                          type="text" 
                          placeholder="Código de 6 dígitos" 
                          value={resetCode} 
                          onChange={e => setResetCode(e.target.value)} 
                          maxLength="6"
                          required 
                        />
                      </div>
                      <div className="landing-form-group">
                        <Lock className="input-icon" />
                        <input 
                          type={showPassword ? "text" : "password"} 
                          placeholder="Nueva contraseña" 
                          value={newPassword} 
                          onChange={e => setNewPassword(e.target.value)} 
                          required 
                        />
                        <button type="button" className="toggle-pass" onClick={() => setShowPassword(!showPassword)}>
                          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                      <button type="submit" className="landing-btn btn-primary" disabled={forgotLoading}>
                        {forgotLoading ? 'ACTUALIZANDO...' : 'RESTABLECER CONTRASEÑA'}
                      </button>
                      <button 
                        type="button" 
                        onClick={() => setForgotStep(1)} 
                        style={{ width: '100%', background: 'none', border: 'none', marginTop: '1rem', color: 'var(--lp-accent)', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}
                      >
                        REINTENTAR CON OTRO CORREO
                      </button>
                    </>
                  )}
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Activation Modal Overlay */}
      {showActivation && (
        <div className="activation-overlay" style={{ zIndex: 2200 }}>
          <div className="activation-card">
            <div className="activation-icon-bg">
              <Lock size={32} />
            </div>
            <h2>ACTIVA TU CUENTA</h2>
            <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '1rem 0' }}>Hemos enviado un código a tu correo. Por favor ingrésalo para continuar.</p>
            
            <form onSubmit={handleActivate}>
              <input 
                type="text" 
                maxLength="6"
                placeholder="000000" 
                value={activationCode}
                onChange={(e) => setActivationCode(e.target.value)}
                className="activation-input"
                required
              />

              <button type="submit" className="landing-btn btn-primary" style={{ width: '100%' }}>VERIFICAR Y ACTIVAR</button>
              <button type="button" onClick={() => setShowActivation(false)} className="btn-cancel">CANCELAR</button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default Landing;
