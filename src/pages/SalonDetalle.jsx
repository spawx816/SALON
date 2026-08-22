import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useDocumentMetadata } from '../hooks/useDocumentMetadata';
import { MapPin, Phone, Clock, ShieldCheck, Check, Star, Car, ArrowLeft } from 'lucide-react';

const SalonDetalle = () => {
  const { slug } = useParams();
  const navigate = useNavigate();

  // Find salon details based on slug
  const salonsData = {
    'abatte-san-vicente': {
      id: 1,
      name: 'Abatte Peluquería San Vicente',
      title: 'Plan Beauty en Abatte San Vicente | Lavados mensuales',
      description: 'Utiliza tu Plan Beauty en Abatte Peluquería San Vicente. Ubicado en Av. San Vicente de Paul, Santo Domingo Este. Lavados y peinados profesionales.',
      address: 'Av. San Vicente de Paul esq. Puerto Rico, Plaza El Poder Local 1F',
      sector: 'Alma Rosa I',
      municipio: 'Santo Domingo Este',
      provincia: 'Santo Domingo',
      phone: '(809) 561-5000',
      hours: 'Lunes a Viernes: 8:00 AM - 8:00 PM | Sábados: 8:00 AM - 7:00 PM | Domingos y Feriados: 8:00 AM - 5:00 PM',
      parking: 'Estacionamiento amplio y vigilado disponible de forma gratuita dentro de Plaza El Poder.',
      mapDescription: 'Estamos ubicados estratégicamente en la Av. San Vicente de Paul, esquina con la calle Puerto Rico, dentro de la concurrida Plaza El Poder en Santo Domingo Este.',
      mapsQuery: 'Abatte Peluquería San Vicente',
      services: [
        'Lavados profesionales incluidos en el plan',
        'Secados a rolos y blower',
        'Tratamiento acondicionador estándar',
        'Personal altamente calificado'
      ],
      reviews: [
        { author: 'María Almonte', rating: 5, text: 'Excelente servicio, muy rápido y el personal de Abatte siempre es sumamente amable.' },
        { author: 'Laura Gómez', rating: 5, text: 'El plan de lavados me ahorra muchísimo dinero y la sucursal de la San Vicente es súper cómoda.' }
      ]
    },
    'abatte-sirena-villa-mella': {
      id: 4,
      name: 'Abatte Peluquería Sirena Villa Mella',
      title: 'Plan Beauty en Abatte Sirena Villa Mella | Lavados mensuales',
      description: 'Utiliza tu Plan Beauty en Abatte Peluquería Sirena Villa Mella. Ubicado en Av. Hermanas Mirabal, dentro del Multicentro La Sirena. Lavados y peinados profesionales.',
      address: 'Av. Hermanas Mirabal, Villa Mella, dentro del Multicentro La Sirena',
      sector: 'Villa Mella',
      municipio: 'Santo Domingo Norte',
      provincia: 'Santo Domingo',
      phone: '809-235-5555',
      hours: 'Lunes a Viernes: 7:00 AM - 8:00 PM | Sábados: 8:00 AM - 6:00 PM | Domingos y Feriados: 8:00 AM - 5:00 PM',
      parking: 'Estacionamiento disponible de forma gratuita dentro del Multicentro La Sirena Villa Mella.',
      mapDescription: 'Sirena - Villa Mella, Av. Hermanas Mirabal esq, 11201',
      mapsQuery: 'Sirena - Villa Mella, Av. Hermanas Mirabal esq, 11201',
      services: [
        'Lavados profesionales incluidos en el plan',
        'Secados a rolos y blower',
        'Tratamiento acondicionador estándar',
        'Personal altamente calificado'
      ],
      reviews: [
        { author: 'Ana Martínez', rating: 5, text: 'Excelente servicio en la sucursal de La Sirena Villa Mella. Todo muy limpio y el trato es inmejorable.' },
        { author: 'Carmen Rivera', rating: 5, text: 'Me encanta que ahora tengan sucursal en Villa Mella. El lavado es súper relajante y el secado dura mucho.' }
      ]
    },
    'abatte-peluqueria-sirena-villa-mella': {
      id: 4,
      name: 'Abatte Peluquería Sirena Villa Mella',
      title: 'Plan Beauty en Abatte Sirena Villa Mella | Lavados mensuales',
      description: 'Utiliza tu Plan Beauty en Abatte Peluquería Sirena Villa Mella. Ubicado en Av. Hermanas Mirabal, dentro del Multicentro La Sirena. Lavados y peinados profesionales.',
      address: 'Av. Hermanas Mirabal, Villa Mella, dentro del Multicentro La Sirena',
      sector: 'Villa Mella',
      municipio: 'Santo Domingo Norte',
      provincia: 'Santo Domingo',
      phone: '809-235-5555',
      hours: 'Lunes a Viernes: 7:00 AM - 8:00 PM | Sábados: 8:00 AM - 6:00 PM | Domingos y Feriados: 8:00 AM - 5:00 PM',
      parking: 'Estacionamiento disponible de forma gratuita dentro del Multicentro La Sirena Villa Mella.',
      mapDescription: 'Sirena - Villa Mella, Av. Hermanas Mirabal esq, 11201',
      mapsQuery: 'Sirena - Villa Mella, Av. Hermanas Mirabal esq, 11201',
      services: [
        'Lavados profesionales incluidos en el plan',
        'Secados a rolos y blower',
        'Tratamiento acondicionador estándar',
        'Personal altamente calificado'
      ],
      reviews: [
        { author: 'Ana Martínez', rating: 5, text: 'Excelente servicio en la sucursal de La Sirena Villa Mella. Todo muy limpio y el trato es inmejorable.' },
        { author: 'Carmen Rivera', rating: 5, text: 'Me encanta que ahora tengan sucursal en Villa Mella. El lavado es súper relajante y el secado dura mucho.' }
      ]
    }
  };

  const salon = salonsData[slug] || salonsData['abatte-san-vicente']; // fallback to san vicente

  useDocumentMetadata({
    title: salon.title,
    description: salon.description,
    canonicalUrl: `https://planbeautyrd.com/salones/${slug}`,
    robots: 'index, follow'
  });

  return (
    <div className="landing-page-content" style={{ padding: '6rem 0 4rem' }}>
      <div className="container">
        
        {/* Back link */}
        <Link to="/salones" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#64748b', textDecoration: 'none', marginBottom: '2rem', fontSize: '0.85rem', fontWeight: 700 }}>
          <ArrowLeft size={16} />
          <span>Volver a Salones</span>
        </Link>

        {/* Hero split layout */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '3rem', marginBottom: '4rem' }}>
          
          {/* Main Info */}
          <div>
            <span style={{ background: 'rgba(212, 175, 55, 0.1)', color: '#d4af37', padding: '0.5rem 1rem', borderRadius: '50px', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Sucursal Afiliada
            </span>
            <h1 style={{ fontSize: '2.25rem', fontWeight: 900, marginTop: '1.25rem', color: '#09090b', lineHeight: 1.2 }}>
              Utiliza tu Plan Beauty en <span style={{ color: '#d4af37' }}>{salon.name}</span>
            </h1>
            
            <p style={{ color: '#64748b', fontSize: '0.95rem', lineHeight: 1.6, margin: '1rem 0 2rem' }}>
              Disfruta de tus 4 lavados profesionales y secados mensuales en esta sucursal. Ofrecemos instalaciones de primer nivel, aire acondicionado y bebidas de cortesía para tu comodidad.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginBottom: '2rem' }}>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <MapPin style={{ color: '#d4af37', flexShrink: 0 }} size={20} />
                <div>
                  <h4 style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem' }}>Dirección</h4>
                  <p style={{ margin: '0.1rem 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                    {salon.address}, {salon.sector}, {salon.municipio}, {salon.provincia}.
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <Phone style={{ color: '#d4af37', flexShrink: 0 }} size={20} />
                <div>
                  <h4 style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem' }}>Teléfono de Contacto</h4>
                  <p style={{ margin: '0.1rem 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>{salon.phone}</p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <Clock style={{ color: '#d4af37', flexShrink: 0 }} size={20} />
                <div>
                  <h4 style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem' }}>Horario de Atención</h4>
                  <p style={{ margin: '0.1rem 0 0 0', fontSize: '0.85rem', color: '#64748b', lineHeight: 1.4 }}>{salon.hours}</p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <Car style={{ color: '#d4af37', flexShrink: 0 }} size={20} />
                <div>
                  <h4 style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem' }}>Estacionamiento</h4>
                  <p style={{ margin: '0.1rem 0 0 0', fontSize: '0.85rem', color: '#64748b', lineHeight: 1.4 }}>{salon.parking}</p>
                </div>
              </div>
            </div>

            <Link to="/registro" className="landing-btn btn-accent" style={{ textDecoration: 'none', display: 'inline-block', padding: '1rem 2rem' }}>
              SUSCRIBIRME EN ESTE SALÓN
            </Link>
          </div>

          {/* Media / Map placeholder */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div style={{ borderRadius: '24px', overflow: 'hidden', boxShadow: '0 15px 35px rgba(0,0,0,0.05)', position: 'relative', height: '280px' }}>
              <img 
                src="/abatte_salon_interior_1777874331934.png" 
                alt={salon.name} 
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>

            {/* Map Embed Simulation */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '24px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <h4 style={{ margin: 0, fontWeight: 800, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <MapPin size={18} style={{ color: '#d4af37' }} />
                <span>¿Cómo llegar?</span>
              </h4>
              <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
                {salon.mapDescription || 'Estamos ubicados estratégicamente en la Av. San Vicente de Paul, esquina con la calle Puerto Rico, dentro de la concurrida Plaza El Poder en Santo Domingo Este.'}
              </p>
              <a 
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(salon.mapsQuery || (salon.name + ' ' + salon.address))}`} 
                target="_blank" 
                rel="noopener noreferrer"
                className="landing-btn"
                style={{ display: 'inline-block', textAlign: 'center', textDecoration: 'none', background: 'white', color: '#09090b', border: '1.5px solid #cbd5e1', fontSize: '0.8rem', padding: '0.5rem' }}
              >
                Abrir en Google Maps
              </a>
            </div>
          </div>

        </div>

        {/* Services & Reviews Section */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '3rem', marginTop: '4rem', borderTop: '1px solid #e2e8f0', paddingTop: '4rem' }}>
          
          {/* Services Box */}
          <div>
            <h3 style={{ fontSize: '1.5rem', fontWeight: 900, color: '#09090b', marginBottom: '1.5rem' }}>Servicios del Plan en Sucursal</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {salon.services.map((service, index) => (
                <li key={index} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', fontSize: '0.9rem', color: '#64748b' }}>
                  <div style={{ background: '#f0fdf4', color: '#16a34a', width: '22px', height: '22px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Check size={12} strokeWidth={3} />
                  </div>
                  <span>{service}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Reviews Box */}
          <div>
            <h3 style={{ fontSize: '1.5rem', fontWeight: 900, color: '#09090b', marginBottom: '1.5rem' }}>Opiniones de Clientes</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {salon.reviews.map((review, index) => (
                <div key={index} style={{ background: '#f8fafc', padding: '1.5rem', borderRadius: '20px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <h5 style={{ margin: 0, fontWeight: 700, fontSize: '0.85rem' }}>{review.author}</h5>
                    <div style={{ display: 'flex', gap: '2px' }}>
                      {[...Array(review.rating)].map((_, i) => (
                        <Star key={i} size={12} style={{ fill: '#d4af37', color: '#d4af37' }} />
                      ))}
                    </div>
                  </div>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', lineHeight: 1.5 }}>"{review.text}"</p>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};

export default SalonDetalle;
