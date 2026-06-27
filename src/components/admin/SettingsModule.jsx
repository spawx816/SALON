import React, { useState, useEffect } from 'react';
import { dataService } from '../../utils/dataService';
import { useNotification } from '../../context/NotificationContext';
import { Mail, Shield, Server, Check, Save, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';

const SettingsModule = () => {
  const { showNotification } = useNotification();
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [emailSettings, setEmailSettings] = useState({
    smtp_host: '',
    smtp_port: 587,
    smtp_user: '',
    smtp_pass: '',
    smtp_from: 'PLAN BEAUTY',
    smtp_secure: true
  });

  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);
      const res = await dataService.getEmailSettings();
      if (res && res.smtp_host) {
        setEmailSettings({
          ...res,
          smtp_secure: res.smtp_secure === 1
        });
      }
      setLoading(false);
    };
    fetchSettings();
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await dataService.saveEmailSettings(emailSettings);
      showNotification('Configuración de correo guardada con éxito', 'success');
    } catch (err) {
      showNotification('Error al guardar configuración', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async () => {
    if (!testEmail) {
      showNotification('Por favor, ingresa un correo para la prueba', 'info');
      return;
    }
    setTesting(true);
    try {
      await dataService.testEmailConnection({
        ...emailSettings,
        test_email: testEmail
      });
      showNotification('¡Prueba exitosa! Revisa tu bandeja de entrada.', 'success');
    } catch (err) {
      showNotification('Error de conexión: ' + err.message, 'error');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="settings-module">
      <div className="page-header" style={{ marginBottom: '2rem' }}>
        <div>
          <h2 className="page-title">Configuración del Sistema</h2>
          <p className="page-subtitle">Gestiona las conexiones y servicios externos de la plataforma.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        {/* Email Settings Card */}
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="surface-card"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '1rem' }}>
            <div style={{ background: 'var(--text-primary)', color: 'white', padding: '0.5rem', borderRadius: '10px' }}>
              <Mail size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0 }}>Servidor de Correo (SMTP)</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>Necesario para enviar códigos de seguridad y notificaciones.</p>
            </div>
          </div>

          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="form-group">
              <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Host SMTP</label>
              <div style={{ position: 'relative' }}>
                <Server style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} size={16} />
                <input 
                  type="text" 
                  className="input-field"
                  style={{ paddingLeft: '2.5rem' }}
                  placeholder="ej: smtp.gmail.com"
                  value={emailSettings.smtp_host}
                  onChange={e => setEmailSettings({...emailSettings, smtp_host: e.target.value})}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Puerto</label>
                <input 
                  type="number" 
                  className="input-field"
                  placeholder="587"
                  value={emailSettings.smtp_port}
                  onChange={e => setEmailSettings({...emailSettings, smtp_port: parseInt(e.target.value)})}
                  required
                />
              </div>
              <div className="form-group">
                <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Seguridad</label>
                <select 
                  className="input-field"
                  value={emailSettings.smtp_secure ? 'true' : 'false'}
                  onChange={e => setEmailSettings({...emailSettings, smtp_secure: e.target.value === 'true'})}
                >
                  <option value="true">SSL/TLS (Recomendado)</option>
                  <option value="false">Ninguna / STARTTLS</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Usuario / Email</label>
              <input 
                type="email" 
                className="input-field"
                placeholder="tu-correo@ejemplo.com"
                value={emailSettings.smtp_user}
                onChange={e => setEmailSettings({...emailSettings, smtp_user: e.target.value})}
                required
              />
            </div>

            <div className="form-group">
              <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Contraseña</label>
              <div style={{ position: 'relative' }}>
                <Shield style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} size={16} />
                <input 
                  type="password" 
                  className="input-field"
                  style={{ paddingLeft: '2.5rem' }}
                  placeholder="••••••••••••"
                  value={emailSettings.smtp_pass}
                  onChange={e => setEmailSettings({...emailSettings, smtp_pass: e.target.value})}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Nombre Remitente</label>
              <input 
                type="text" 
                className="input-field"
                placeholder="PLAN BEAUTY System"
                value={emailSettings.smtp_from}
                onChange={e => setEmailSettings({...emailSettings, smtp_from: e.target.value})}
              />
            </div>

            <button 
              type="submit" 
              className="btn-primary" 
              disabled={loading}
              style={{ marginTop: '1rem', width: '100%', padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            >
              {loading ? 'Guardando...' : <><Save size={18} /> Guardar Configuración</>}
            </button>
          </form>
        </motion.div>

        {/* Security Info Card */}
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="surface-card"
          style={{ background: '#f8fafc', border: '1px dashed var(--border-subtle)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <AlertTriangle size={24} color="#f59e0b" />
            <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800 }}>Nota sobre Seguridad</h4>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.85rem', color: '#475569', lineHeight: '1.6' }}>
            <p><strong>1. Uso de Gmail:</strong> Si usas Gmail, debes generar una <strong>"Contraseña de Aplicación"</strong> desde tu cuenta de Google. No uses tu contraseña personal habitual.</p>
            <p><strong>2. Puertos comunes:</strong> 
              <br />• 465: Usado para SSL (Seguro).
              <br />• 587: Usado para TLS/STARTTLS.
            </p>
            <p><strong>3. Verificación:</strong> Una vez guardes los datos, el sistema intentará enviar los códigos OTP usando estas credenciales. Si el código no llega, revisa los registros del servidor o la carpeta de Spam.</p>
          </div>

          <div style={{ marginTop: '2.5rem', padding: '1.5rem', background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
            <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
               <Check size={18} color="#10b981" /> Probar Configuración
            </h4>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>Envía un correo de prueba para validar que todo esté correcto.</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <input 
                type="email" 
                placeholder="correo@destino.com" 
                className="input-field"
                value={testEmail}
                onChange={e => setTestEmail(e.target.value)}
                style={{ fontSize: '0.85rem' }}
              />
              <button 
                onClick={handleTestConnection}
                disabled={testing || !emailSettings.smtp_host}
                className="btn-secondary"
                style={{ 
                  width: '100%', 
                  padding: '0.75rem', 
                  fontSize: '0.8rem', 
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  background: testing ? '#f1f5f9' : '#09090b',
                  color: 'white',
                  border: 'none'
                }}
              >
                {testing ? 'Probando...' : 'Enviar Correo de Prueba'}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default SettingsModule;
