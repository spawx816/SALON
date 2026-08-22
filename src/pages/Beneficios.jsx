import React from 'react';
import { Link } from 'react-router-dom';
import { useDocumentMetadata } from '../hooks/useDocumentMetadata';
import { Percent, Award, Heart, Gift, Coffee, ShieldAlert } from 'lucide-react';

const Beneficios = () => {
  useDocumentMetadata({
    title: 'Beneficios de tu membresía de belleza | Plan Beauty RD',
    description: 'Conoce los beneficios de afiliarte a Plan Beauty. Disfruta de un ahorro constante, atención profesional en salones certificados, bebidas de cortesía y ofertas exclusivas.',
    canonicalUrl: 'https://planbeautyrd.com/beneficios',
    robots: 'index, follow'
  });

  return (
    <div className="landing-page-content" style={{ padding: '6rem 0 4rem' }}>
      <div className="container">
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '5rem' }}>
          <span style={{ background: 'rgba(212, 175, 55, 0.1)', color: '#d4af37', padding: '0.5rem 1rem', borderRadius: '50px', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ventajas de Miembro</span>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 900, marginTop: '1rem', color: '#09090b' }}>
            MÁS QUE UN SIMPLE <span style={{ color: '#d4af37' }}>PLAN DE LAVADOS</span>
          </h1>
          <p style={{ maxWidth: '600px', margin: '1rem auto 0', color: '#64748b', fontSize: '1.05rem', lineHeight: 1.6 }}>
            Formar parte de Plan Beauty te da acceso a una experiencia de cuidado integral y beneficios diseñados especialmente para potenciar tu belleza y bienestar.
          </p>
        </div>

        {/* Benefits Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2.5rem', marginBottom: '5rem' }}>
          
          {/* Benefit 1 */}
          <div style={{ background: 'white', padding: '2.5rem 2rem', borderRadius: '24px', boxShadow: '0 15px 35px rgba(0,0,0,0.02)', border: '1px solid #f1f5f9' }}>
            <div style={{ width: '50px', height: '50px', borderRadius: '14px', background: 'rgba(212,175,55,0.08)', color: '#d4af37', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem' }}>
              <Percent size={22} />
            </div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#09090b', marginBottom: '0.75rem' }}>Ahorro del 40%+</h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b', lineHeight: 1.5, margin: 0 }}>
              Pagar de forma individual cada lavado y secado en salones premium puede costar más de RD$3,200 al mes. Con la membresía unificada, gastas solo RD$1,950.
            </p>
          </div>

          {/* Benefit 2 */}
          <div style={{ background: 'white', padding: '2.5rem 2rem', borderRadius: '24px', boxShadow: '0 15px 35px rgba(0,0,0,0.02)', border: '1px solid #f1f5f9' }}>
            <div style={{ width: '50px', height: '50px', borderRadius: '14px', background: 'rgba(212,175,55,0.08)', color: '#d4af37', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem' }}>
              <Award size={22} />
            </div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#09090b', marginBottom: '0.75rem' }}>Salones Certificados</h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b', lineHeight: 1.5, margin: 0 }}>
              Trabajamos únicamente con salones reconocidos por su alto estándar de calidad, como Abatte Peluquería, garantizando profesionales de primer nivel.
            </p>
          </div>

          {/* Benefit 3 */}
          <div style={{ background: 'white', padding: '2.5rem 2rem', borderRadius: '24px', boxShadow: '0 15px 35px rgba(0,0,0,0.02)', border: '1px solid #f1f5f9' }}>
            <div style={{ width: '50px', height: '50px', borderRadius: '14px', background: 'rgba(212,175,55,0.08)', color: '#d4af37', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem' }}>
              <Coffee size={22} />
            </div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#09090b', marginBottom: '0.75rem' }}>Bebida de Cortesía</h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b', lineHeight: 1.5, margin: 0 }}>
              Disfruta de una experiencia relajante con una bebida de cortesía (café, té, agua o copa de vino) en cada una de tus visitas al salón.
            </p>
          </div>

          {/* Benefit 4 */}
          <div style={{ background: 'white', padding: '2.5rem 2rem', borderRadius: '24px', boxShadow: '0 15px 35px rgba(0,0,0,0.02)', border: '1px solid #f1f5f9' }}>
            <div style={{ width: '50px', height: '50px', borderRadius: '14px', background: 'rgba(212,175,55,0.08)', color: '#d4af37', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem' }}>
              <Gift size={22} />
            </div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#09090b', marginBottom: '0.75rem' }}>Promociones Exclusivas</h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b', lineHeight: 1.5, margin: 0 }}>
              Recibe ofertas especiales en tratamientos de hidratación profunda, cortes, tintes u otros servicios de salón no incluidos directamente en el plan.
            </p>
          </div>

        </div>

        {/* Callout box */}
        <div style={{ background: '#f8fafc', padding: '3.5rem', borderRadius: '24px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 900, color: '#09090b', marginBottom: '1rem' }}>Comienza a consentir tu cabello hoy</h2>
          <p style={{ color: '#64748b', fontSize: '0.95rem', lineHeight: 1.6, maxWidth: '600px', margin: '0 auto 2rem' }}>
            Únete a la comunidad de mujeres en República Dominicana que ya cuidan de su cabello de forma inteligente y profesional sin pagar de más.
          </p>
          <Link to="/registro" className="landing-btn btn-accent" style={{ textDecoration: 'none', display: 'inline-block' }}>
            QUIERO SUSCRIBIRME AHORA
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Beneficios;
