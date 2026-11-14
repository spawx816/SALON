import React, { useState } from 'react';
import { useDocumentMetadata } from '../hooks/useDocumentMetadata';
import { Mail, MessageSquare, Send, CheckCircle, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { dataService } from '../utils/dataService';

const Contacto = () => {
  const isStagingHost =
    typeof window !== 'undefined' && window.location.hostname.startsWith('staging.');
  const baseOrigin =
    typeof window !== 'undefined' && window.location.hostname.includes('www.etereasapp.com')
      ? 'https://www.etereasapp.com'
      : 'https://etereasapp.com';

  useDocumentMetadata({
    title: 'Contacto y Demostración | ETEREAS',
    description:
      'Solicita una demostración o ponte en contacto con el equipo de Etereas para implementar Plan Base o Plan Pro en tu empresa.',
    canonicalUrl: `${baseOrigin}/contacto`,
    robots: isStagingHost ? 'noindex, nofollow' : 'index, follow'
  });

  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (!nombre.trim() || !email.trim() || !mensaje.trim()) {
      setErrorMsg('Por favor completa todos los campos requeridos (nombre, correo y mensaje).');
      return;
    }

    setLoading(true);
    try {
      await dataService.sendContactMessage({
        nombre: nombre.trim(),
        email: email.trim(),
        telefono: telefono.trim(),
        mensaje: mensaje.trim()
      });

      setSubmitted(true);
      setNombre('');
      setEmail('');
      setTelefono('');
      setMensaje('');
    } catch (err) {
      setErrorMsg(
        err.message ||
          'No pudimos procesar tu mensaje en este momento. Por favor intenta nuevamente.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="et-subpage">
      <div className="et-container">
        <div className="et-subpage-header">
          <p className="et-eyebrow">CONTACTO Y DEMOSTRACIÓN</p>
          <h1>
            Hablemos de tu <span className="et-accent-text">operación.</span>
          </h1>
          <p>
            ¿Quieres una demostración de Etereas o asesoría para elegir entre Plan Base (US$49/mes)
            y Plan Pro (US$99/mes)? Envíanos tu consulta.
          </p>
        </div>

        <div className="et-contact-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="et-contact-info-card">
              <div className="et-contact-icon">
                <MessageSquare size={20} />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#152742' }}>
                  Demostración guiada
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: '13.5px', color: '#6c7c91', lineHeight: 1.5 }}>
                  Te mostramos el flujo completo de facturación, asistencia facial, nómina y CRM de
                  clientes (incluido en Base y Pro), así como membresías B2C y marketing en Pro.
                </p>
              </div>
            </div>

            <div className="et-contact-info-card">
              <div className="et-contact-icon">
                <ShieldCheck size={20} />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#152742' }}>
                  Alcance técnico claro
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: '13.5px', color: '#6c7c91', lineHeight: 1.5 }}>
                  Comprobantes fiscales NCF y reportes DGII (606, 607, IT-1) operativos; e-CF y
                  pasarela CardNet en proceso de certificación.
                </p>
              </div>
            </div>

            <div className="et-contact-info-card">
              <div className="et-contact-icon">
                <Mail size={20} />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#152742' }}>
                  Atención directa
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: '13.5px', color: '#6c7c91', lineHeight: 1.5 }}>
                  Completa el formulario y nuestro equipo registrará tu solicitud para dar
                  seguimiento a tu empresa.
                </p>
              </div>
            </div>
          </div>

          <div className="et-subpage-card" style={{ margin: 0, maxWidth: 'none' }}>
            <h2 style={{ margin: '0 0 18px', fontSize: '20px', fontWeight: 700, color: '#152742' }}>
              Solicitar demostración o soporte
            </h2>

            {errorMsg && (
              <div className="et-alert-error" role="alert" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>{errorMsg}</span>
              </div>
            )}

            {submitted ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    background: '#ecfdf5',
                    color: '#047857',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 14
                  }}
                >
                  <CheckCircle size={28} />
                </div>
                <h3 style={{ margin: '0 0 6px', fontSize: '18px', color: '#152742' }}>
                  ¡Mensaje enviado con éxito!
                </h3>
                <p style={{ margin: '0 0 18px', fontSize: '13.5px', color: '#6c7c91' }}>
                  Hemos recibido tu solicitud. Te contactaremos a la brevedad posible.
                </p>
                <button
                  type="button"
                  className="et-btn-primary"
                  onClick={() => setSubmitted(false)}
                >
                  Enviar otro mensaje
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate>
                <div className="et-field">
                  <label htmlFor="contact-nombre">Nombre completo *</label>
                  <input
                    id="contact-nombre"
                    type="text"
                    className="et-input"
                    placeholder="Ej. Laura Méndez"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    required
                  />
                </div>

                <div className="et-field-row-2">
                  <div className="et-field">
                    <label htmlFor="contact-email">Correo electrónico *</label>
                    <input
                      id="contact-email"
                      type="email"
                      className="et-input"
                      placeholder="laura@empresa.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="et-field">
                    <label htmlFor="contact-telefono">Teléfono / WhatsApp</label>
                    <input
                      id="contact-telefono"
                      type="tel"
                      className="et-input"
                      placeholder="809-555-0100"
                      value={telefono}
                      onChange={(e) => setTelefono(e.target.value)}
                    />
                  </div>
                </div>

                <div className="et-field">
                  <label htmlFor="contact-mensaje">Mensaje o consulta *</label>
                  <textarea
                    id="contact-mensaje"
                    rows={4}
                    className="et-input"
                    style={{ height: 'auto', padding: '12px 14px', resize: 'vertical' }}
                    placeholder="Cuéntanos sobre tu empresa, cantidad de sucursales o dudas..."
                    value={mensaje}
                    onChange={(e) => setMensaje(e.target.value)}
                    required
                  />
                </div>

                <button
                  type="submit"
                  className="et-btn-primary et-cta-full"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} />
                      <span>Enviando...</span>
                    </>
                  ) : (
                    <>
                      <Send size={16} />
                      <span>Enviar solicitud →</span>
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Contacto;
