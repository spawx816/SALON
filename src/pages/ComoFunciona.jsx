import React from 'react';
import { Link } from 'react-router-dom';
import { useDocumentMetadata } from '../hooks/useDocumentMetadata';
import { UserPlus, CreditCard, MapPin, Smile, ArrowRight } from 'lucide-react';

const ComoFunciona = () => {
  useDocumentMetadata({
    title: '¿Cómo funciona Plan Beauty? Suscripción, citas y beneficios',
    description: 'Descubre el funcionamiento de Plan Beauty. Elige tu plan, suscríbete online, asiste a tu salón sin necesidad de cita previa y disfruta de tu lavado profesional.',
    canonicalUrl: 'https://planbeautyrd.com/como-funciona',
    robots: 'index, follow'
  });

  return (
    <div className="landing-page-content" style={{ padding: '6rem 0 4rem' }}>
      <div className="container">
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '5rem' }}>
          <span style={{ background: 'rgba(212, 175, 55, 0.1)', color: '#d4af37', padding: '0.5rem 1rem', borderRadius: '50px', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Proceso Simple</span>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 900, marginTop: '1rem', color: '#09090b' }}>
            TU CABELLO PERFECTO EN <span style={{ color: '#d4af37' }}>4 SIMPLES PASOS</span>
          </h1>
          <p style={{ maxWidth: '600px', margin: '1rem auto 0', color: '#64748b', fontSize: '1.05rem', lineHeight: 1.6 }}>
            Olvídate de pagar por cada servicio de peluquería por separado. Descubre cómo Plan Beauty simplifica tu rutina de cuidado del cabello.
          </p>
        </div>

        {/* Steps Workflow */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '2rem', marginBottom: '5rem' }}>
          
          {/* Step 1 */}
          <div style={{ background: 'white', padding: '2rem', borderRadius: '20px', boxShadow: '0 10px 30px rgba(0,0,0,0.02)', border: '1px solid #f1f5f9', position: 'relative' }}>
            <div style={{ position: 'absolute', top: '1rem', right: '1.5rem', fontSize: '2.5rem', fontWeight: 900, color: '#f1f5f9', zIndex: 1 }}>01</div>
            <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: 'rgba(212, 175, 55, 0.1)', color: '#d4af37', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem', position: 'relative', zIndex: 2 }}>
              <UserPlus size={26} />
            </div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#09090b', marginBottom: '0.75rem', position: 'relative', zIndex: 2 }}>Crea tu Cuenta</h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b', lineHeight: 1.5, margin: 0, position: 'relative', zIndex: 2 }}>
              Regístrate en línea completando tu información básica, cédula, teléfono y fecha de nacimiento.
            </p>
          </div>

          {/* Step 2 */}
          <div style={{ background: 'white', padding: '2rem', borderRadius: '20px', boxShadow: '0 10px 30px rgba(0,0,0,0.02)', border: '1px solid #f1f5f9', position: 'relative' }}>
            <div style={{ position: 'absolute', top: '1rem', right: '1.5rem', fontSize: '2.5rem', fontWeight: 900, color: '#f1f5f9', zIndex: 1 }}>02</div>
            <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: 'rgba(212, 175, 55, 0.1)', color: '#d4af37', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem', position: 'relative', zIndex: 2 }}>
              <MapPin size={26} />
            </div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#09090b', marginBottom: '0.75rem', position: 'relative', zIndex: 2 }}>Elige tu Sucursal</h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b', lineHeight: 1.5, margin: 0, position: 'relative', zIndex: 2 }}>
              Elige el salón de belleza afiliado más cercano a ti para asociarlo a tu cuenta de membresía.
            </p>
          </div>

          {/* Step 3 */}
          <div style={{ background: 'white', padding: '2rem', borderRadius: '20px', boxShadow: '0 10px 30px rgba(0,0,0,0.02)', border: '1px solid #f1f5f9', position: 'relative' }}>
            <div style={{ position: 'absolute', top: '1rem', right: '1.5rem', fontSize: '2.5rem', fontWeight: 900, color: '#f1f5f9', zIndex: 1 }}>03</div>
            <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: 'rgba(212, 175, 55, 0.1)', color: '#d4af37', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem', position: 'relative', zIndex: 2 }}>
              <CreditCard size={26} />
            </div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#09090b', marginBottom: '0.75rem', position: 'relative', zIndex: 2 }}>Activa la Suscripción</h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b', lineHeight: 1.5, margin: 0, position: 'relative', zIndex: 2 }}>
              Realiza el pago de tu primer mes mediante nuestro portal cifrado con la garantía de CardNet.
            </p>
          </div>

          {/* Step 4 */}
          <div style={{ background: 'white', padding: '2rem', borderRadius: '20px', boxShadow: '0 10px 30px rgba(0,0,0,0.02)', border: '1px solid #f1f5f9', position: 'relative' }}>
            <div style={{ position: 'absolute', top: '1rem', right: '1.5rem', fontSize: '2.5rem', fontWeight: 900, color: '#f1f5f9', zIndex: 1 }}>04</div>
            <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: 'rgba(212, 175, 55, 0.1)', color: '#d4af37', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem', position: 'relative', zIndex: 2 }}>
              <Smile size={26} />
            </div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#09090b', marginBottom: '0.75rem', position: 'relative', zIndex: 2 }}>Visita y Disfruta</h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b', lineHeight: 1.5, margin: 0, position: 'relative', zIndex: 2 }}>
              Ve al salón cuando quieras sin necesidad de agendar cita. Identifícate en la entrada y disfruta.
            </p>
          </div>

        </div>

        {/* Informative Block: No appointments, just check in */}
        <div style={{ background: '#f8fafc', padding: '3.5rem', borderRadius: '24px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', mdDirection: 'row', gap: '2rem', alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: '1.75rem', fontWeight: 900, color: '#09090b', marginBottom: '1rem' }}>Olvídate de agendar con antelación</h2>
            <p style={{ color: '#64748b', fontSize: '0.95rem', lineHeight: 1.6, margin: 0 }}>
              Sabemos que tu tiempo es valioso y que los imprevistos suceden. Con Plan Beauty, no tienes que lidiar con agendas llenas ni programaciones rígidas. Simplemente asiste a tu peluquería asociada dentro de su horario de atención regular. Al llegar, se validará tu servicio en segundos con tu cédula en recepción, y pasarás de forma directa según orden de llegada.
            </p>
            <div style={{ display: 'flex', gap: '1.5rem', marginTop: '2rem' }}>
              <Link to="/registro" className="landing-btn btn-primary" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>Empezar Ahora</span>
                <ArrowRight size={16} />
              </Link>
              <Link to="/salones" className="landing-btn" style={{ background: 'transparent', border: '1.5px solid #cbd5e1', textDecoration: 'none', color: '#09090b' }}>
                Ver Salones Disponibles
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ComoFunciona;
