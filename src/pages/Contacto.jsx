import React, { useState } from 'react';
import { useDocumentMetadata } from '../hooks/useDocumentMetadata';
import { Mail, Phone, MapPin, MessageSquare, Send, CheckCircle } from 'lucide-react';

const Contacto = () => {
  useDocumentMetadata({
    title: 'Contacto | Plan Beauty RD',
    description: 'Ponte en contacto con el soporte de Plan Beauty RD. Formulario de mensajes, enlaces directos a WhatsApp, teléfono y dirección física de oficinas en Santo Domingo.',
    canonicalUrl: 'https://planbeautyrd.com/contacto',
    robots: 'index, follow'
  });

  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setLoading(true);
    // Simulate API request
    setTimeout(() => {
      setLoading(false);
      setSubmitted(true);
      setNombre('');
      setEmail('');
      setMensaje('');
    }, 1000);
  };

  return (
    <div className="landing-page-content" style={{ padding: '6rem 0 4rem' }}>
      <div className="container">
        
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
          <span style={{ background: 'rgba(212, 175, 55, 0.1)', color: '#d4af37', padding: '0.5rem 1rem', borderRadius: '50px', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contacto</span>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 900, marginTop: '1rem', color: '#09090b' }}>
            ESTAMOS AQUÍ PARA <span style={{ color: '#d4af37' }}>AYUDARTE</span>
          </h1>
          <p style={{ maxWidth: '600px', margin: '1rem auto 0', color: '#64748b', fontSize: '1rem', lineHeight: 1.6 }}>
            ¿Tienes alguna consulta específica, sugerencia o necesitas soporte con tu suscripción? Escríbenos y te responderemos en la mayor brevedad.
          </p>
        </div>

        {/* Form and info grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '4rem', alignItems: 'start' }}>
          
          {/* Info cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            
            <div style={{ display: 'flex', gap: '1.25rem', background: '#f8fafc', padding: '2rem', borderRadius: '24px', border: '1px solid #e2e8f0' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(212,175,55,0.08)', color: '#d4af37', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Phone size={22} />
              </div>
              <div>
                <h4 style={{ margin: 0, fontWeight: 800, fontSize: '1rem', color: '#09090b' }}>Teléfono Soporte</h4>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>(809) 561-5000</p>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginTop: '0.25rem' }}>Lunes a Viernes: 9:00 AM - 6:00 PM</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1.25rem', background: '#f8fafc', padding: '2rem', borderRadius: '24px', border: '1px solid #e2e8f0' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(212,175,55,0.08)', color: '#d4af37', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Mail size={22} />
              </div>
              <div>
                <h4 style={{ margin: 0, fontWeight: 800, fontSize: '1rem', color: '#09090b' }}>Correo Electrónico</h4>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>hola@planbeautyrd.com</p>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginTop: '0.25rem' }}>Escríbenos a cualquier hora</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1.25rem', background: '#f8fafc', padding: '2rem', borderRadius: '24px', border: '1px solid #e2e8f0' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(212,175,55,0.08)', color: '#d4af37', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <MapPin size={22} />
              </div>
              <div>
                <h4 style={{ margin: 0, fontWeight: 800, fontSize: '1rem', color: '#09090b' }}>Oficina Principal</h4>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#64748b', lineHeight: 1.4 }}>
                  Av. San Vicente de Paul esq. Puerto Rico, Plaza El Poder Local 1F, Santo Domingo Este, RD.
                </p>
              </div>
            </div>

          </div>

          {/* Form Card */}
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '28px', padding: '2.5rem', boxShadow: '0 15px 35px rgba(0,0,0,0.02)' }}>
            <h3 style={{ margin: '0 0 1.5rem 0', fontWeight: 900, fontSize: '1.3rem', color: '#09090b' }}>Envíanos un Mensaje</h3>
            
            {submitted ? (
              <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: '#f0fdf4', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
                  <CheckCircle size={32} />
                </div>
                <h4 style={{ fontWeight: 800, fontSize: '1.1rem', marginBottom: '0.5rem' }}>¡Mensaje Enviado!</h4>
                <p style={{ fontSize: '0.85rem', color: '#64748b', lineHeight: 1.5, margin: 0 }}>
                  Agradecemos tu mensaje. Nuestro equipo de soporte se pondrá en contacto contigo en un plazo de 24 horas hábiles.
                </p>
                <button 
                  onClick={() => setSubmitted(false)} 
                  className="landing-btn"
                  style={{ background: '#f1f5f9', color: '#09090b', marginTop: '1.5rem', border: 'none', padding: '0.75rem 1.5rem' }}
                >
                  Enviar otro mensaje
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label htmlFor="nombre" style={{ fontSize: '0.75rem', fontWeight: 800, color: '#09090b', textTransform: 'uppercase' }}>Nombre Completo</label>
                  <input 
                    type="text" 
                    id="nombre"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    required
                    placeholder="Tu nombre completo"
                    style={{ width: '100%', padding: '0.85rem 1rem', borderRadius: '12px', border: '1.5px solid #e2e8f0', outline: 'none', fontSize: '0.9rem' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label htmlFor="email" style={{ fontSize: '0.75rem', fontWeight: 800, color: '#09090b', textTransform: 'uppercase' }}>Correo Electrónico</label>
                  <input 
                    type="email" 
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="ejemplo@correo.com"
                    style={{ width: '100%', padding: '0.85rem 1rem', borderRadius: '12px', border: '1.5px solid #e2e8f0', outline: 'none', fontSize: '0.9rem' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label htmlFor="mensaje" style={{ fontSize: '0.75rem', fontWeight: 800, color: '#09090b', textTransform: 'uppercase' }}>Mensaje o Consulta</label>
                  <textarea 
                    id="mensaje"
                    value={mensaje}
                    onChange={(e) => setMensaje(e.target.value)}
                    required
                    rows="4"
                    placeholder="Describe en qué podemos ayudarte..."
                    style={{ width: '100%', padding: '0.85rem 1rem', borderRadius: '12px', border: '1.5px solid #e2e8f0', outline: 'none', fontSize: '0.9rem', resize: 'vertical' }}
                  />
                </div>

                <button 
                  type="submit" 
                  disabled={loading}
                  className="landing-btn btn-primary"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', width: '100%', padding: '0.875rem' }}
                >
                  <Send size={16} />
                  <span>{loading ? 'ENVIANDO...' : 'ENVIAR MENSAJE'}</span>
                </button>
              </form>
            )}

          </div>

        </div>

      </div>
    </div>
  );
};

export default Contacto;
