import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/LanguageContext';
import { LogIn, Mail, Lock, ShieldCheck } from 'lucide-react';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login } = useAuth();
  const { t, lang, changeLanguage } = useTranslation();

  const [error, setError] = useState('');
  const [showActivation, setShowActivation] = useState(false);
  const [activationCode, setActivationCode] = useState('');
  const [pendingClientId, setPendingClientId] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      if (err.status === 'Pendiente') {
        setPendingClientId(err.id);
        setShowActivation(true);
      } else {
        setError(err.message);
      }
    }
  };

  const handleActivate = async () => {
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
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'var(--bg-canvas)',
      padding: '1.5rem',
      position: 'relative'
    }}>
      {/* Language Toggle on Login */}
      <div style={{ position: 'absolute', top: '1.5rem', right: '1.5rem' }}>
        <button 
          onClick={() => changeLanguage(lang === 'es' ? 'en' : 'es')}
          style={{
            background: 'transparent',
            border: '1px solid var(--border-subtle)',
            borderRadius: '99px',
            padding: '0.5rem 1rem',
            fontSize: '0.75rem',
            fontWeight: 700,
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-primary)';
            e.currentTarget.style.borderColor = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-secondary)';
            e.currentTarget.style.borderColor = 'var(--border-subtle)';
          }}
        >
          {lang === 'es' ? '🇬🇧 EN' : '🇪🇸 ES'}
        </button>
      </div>

      <div className="surface-card" style={{
        maxWidth: '440px',
        width: '100%',
        padding: '3rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '2.5rem',
        boxShadow: '0 20px 40px rgba(0,0,0,0.08)'
      }}>
        
        <div style={{ textAlign: 'center' }}>
          <img 
            src="/logo-black.png" 
            alt="Abatte Peluqueria" 
            style={{ 
              width: '100%', 
              maxWidth: '300px', 
              height: 'auto', 
              margin: '0 auto 1.5rem', 
              display: 'block',
              borderRadius: '20px',
              boxShadow: '0 10px 25px rgba(0,0,0,0.15)'
            }} 
          />
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{t('login.subtitle')}</p>
        </div>

        {error && (
          <div style={{ padding: '1rem', background: '#fee2e2', border: '1px solid #fecaca', borderRadius: '12px', color: '#991b1b', fontSize: '0.875rem', fontWeight: 600, textAlign: 'center' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="input-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <Mail size={14} /> {t('login.email')} / Cédula
            </label>
            <div className="input-wrapper">
              <input 
                type="text" 
                placeholder="email@ejemplo.com o 402..." 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
                style={{ paddingLeft: '1rem', fontSize: '1rem' }}
                required
              />
            </div>
          </div>

          <div className="input-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <Lock size={14} /> {t('login.pass')}
            </label>
            <div className="input-wrapper">
              <input 
                type="password" 
                placeholder="••••••••" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field"
                style={{ paddingLeft: '1rem', fontSize: '1rem', letterSpacing: '0.2em' }}
                required
              />
            </div>
          </div>

          <button type="submit" className="btn-primary" style={{ padding: '1rem', marginTop: '1rem', display: 'flex', justifyContent: 'center', width: '100%' }}>
            <LogIn size={20} style={{ marginRight: '0.5rem' }} />
            {t('login.btn')}
          </button>
        </form>

        <div style={{ textAlign: 'center', fontSize: '0.65rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          {t('login.footer')}
        </div>
      </div>

      {/* Activation Modal */}
      {showActivation && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
          <div className="surface-card" style={{ width: '100%', maxWidth: '400px', textAlign: 'center', padding: '2.5rem' }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto', color: '#d97706' }}>
              <Lock size={32} />
            </div>
            <h2 style={{ fontWeight: 800, marginBottom: '0.5rem' }}>Activa tu cuenta</h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '2rem' }}>Hemos enviado un código a tu correo. Por favor ingrésalo para continuar.</p>
            
            <input 
              type="text" 
              maxLength="6"
              placeholder="000000" 
              value={activationCode}
              onChange={(e) => setActivationCode(e.target.value)}
              style={{ width: '100%', textAlign: 'center', fontSize: '2rem', fontWeight: 800, letterSpacing: '0.5rem', padding: '1rem', borderRadius: '16px', border: '2px solid var(--border-subtle)', marginBottom: '1.5rem', outline: 'none' }}
            />

            <button onClick={handleActivate} className="btn-primary" style={{ width: '100%', padding: '1rem' }}>Verificar y Activar</button>
            <button onClick={() => setShowActivation(false)} style={{ background: 'none', border: 'none', marginTop: '1rem', color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 700 }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;
