import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Lock, CheckCircle2, ShieldCheck, ArrowRight, Loader2 } from 'lucide-react';
import { dataService } from '../utils/dataService';
import { useNotification } from '../context/NotificationContext';

const ActivateAccount = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showNotification } = useNotification();
  
  const clientId = searchParams.get('client');
  const code = searchParams.get('code');
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleActivate = async (e) => {
    e.preventDefault();
    
    if (password.length < 6) {
      showNotification('La contraseña debe tener al menos 6 caracteres', 'error');
      return;
    }
    
    if (password !== confirmPassword) {
      showNotification('Las contraseñas no coinciden', 'error');
      return;
    }

    setLoading(true);
    try {
      await dataService.activateAccount({
        clientId,
        code,
        password
      });
      setSuccess(true);
      showNotification('¡Cuenta activada con éxito!', 'success');
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      showNotification(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: '2rem' }}>
        <div style={{ maxWidth: '450px', width: '100%', textAlign: 'center', padding: '3rem', background: '#fff', borderRadius: '32px', boxShadow: '0 20px 50px rgba(0,0,0,0.05)' }}>
          <div style={{ width: '80px', height: '80px', background: '#f0fdf4', color: '#22c55e', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 2rem' }}>
            <CheckCircle2 size={48} />
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 900, marginBottom: '1rem' }}>¡Todo listo!</h1>
          <p style={{ color: '#64748b', lineHeight: 1.6, marginBottom: '2rem' }}>Tu cuenta ha sido activada correctamente. Ahora puedes iniciar sesión con tu correo y la contraseña que acabas de crear.</p>
          <button onClick={() => navigate('/login')} className="btn-primary" style={{ width: '100%' }}>Ir al Inicio de Sesión</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: '2rem' }}>
      <div style={{ maxWidth: '450px', width: '100%', background: '#fff', borderRadius: '32px', boxShadow: '0 20px 50px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
        <div style={{ padding: '3rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
            <div style={{ width: '64px', height: '64px', background: '#09090b', color: '#fff', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
              <ShieldCheck size={32} />
            </div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 900, marginBottom: '0.5rem' }}>Activa tu cuenta</h1>
            <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Define una contraseña segura para proteger tu perfil en Abatte.</p>
          </div>

          <form onSubmit={handleActivate}>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', color: '#64748b', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>Nueva Contraseña</label>
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}><Lock size={18} /></div>
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  style={{ width: '100%', padding: '1rem 1rem 1rem 3rem', borderRadius: '14px', border: '1px solid #e2e8f0', outline: 'none', transition: 'border 0.2s' }}
                  required
                />
              </div>
            </div>

            <div style={{ marginBottom: '2rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', color: '#64748b', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>Confirmar Contraseña</label>
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}><Lock size={18} /></div>
                <input 
                  type="password" 
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repite tu contraseña"
                  style={{ width: '100%', padding: '1rem 1rem 1rem 3rem', borderRadius: '14px', border: '1px solid #e2e8f0', outline: 'none', transition: 'border 0.2s' }}
                  required
                />
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
              {loading ? <Loader2 className="animate-spin" /> : <>Activar mi Perfil <ArrowRight size={18} /></>}
            </button>
          </form>
        </div>
        
        <div style={{ padding: '1.5rem', background: '#f8fafc', textAlign: 'center', borderTop: '1px solid #f1f5f9' }}>
           <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>¿Necesitas ayuda? <a href="#" style={{ color: '#09090b', fontWeight: 700, textDecoration: 'none' }}>Contacta soporte</a></p>
        </div>
      </div>
    </div>
  );
};

export default ActivateAccount;
