import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useDocumentMetadata } from '../hooks/useDocumentMetadata';
import { MapPin, Phone, Clock, ArrowRight, Search } from 'lucide-react';

const Salones = () => {
  useDocumentMetadata({
    title: 'Salones afiliados a Plan Beauty en República Dominicana',
    description: 'Encuentra las sucursales y salones de belleza asociados a Plan Beauty. Consulta direcciones, teléfonos, horarios de atención y disponibilidad.',
    canonicalUrl: 'https://planbeautyrd.com/salones',
    robots: 'index, follow'
  });

  const [salons, setSalons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Fallback default list if api fails or is empty
  const defaultSalons = [
    {
      id: 1,
      name: 'Abatte Peluquería San Vicente',
      slug: 'abatte-san-vicente',
      address: 'Av. San Vicente de Paul esq. Puerto Rico, Plaza El Poder Local 1F, Santo Domingo Este',
      phone: '(809) 561-5000',
      hours: 'Lunes a Viernes: 8:00 AM - 8:00 PM | Sábados: 8:00 AM - 7:00 PM | Domingos y Feriados: 8:00 AM - 5:00 PM',
      city: 'Santo Domingo Este'
    },
    {
      id: 4,
      name: 'Abatte Peluquería Sirena Villa Mella',
      slug: 'abatte-sirena-villa-mella',
      address: 'Av. Hermanas Mirabal, Villa Mella, dentro del Multicentro La Sirena, Santo Domingo Norte',
      phone: '809-235-5555',
      hours: 'Lunes a Viernes: 7:00 AM - 8:00 PM | Sábados: 8:00 AM - 6:00 PM | Domingos y Feriados: 8:00 AM - 5:00 PM',
      city: 'Santo Domingo Norte'
    }
  ];

  useEffect(() => {
    const fetchSalons = async () => {
      try {
        const res = await fetch('/api/salons');
        if (res.ok) {
          const data = await res.json();
          if (data && data.length > 0) {
            const formatted = data.map(s => {
              let salonHours = s.hours;
              if (!salonHours) {
                if (String(s.id) === '4' || s.name.toLowerCase().includes('villa mella')) {
                  salonHours = 'Lunes a Viernes: 7:00 AM - 8:00 PM | Sábados: 8:00 AM - 6:00 PM | Domingos y Feriados: 8:00 AM - 5:00 PM';
                } else {
                  salonHours = 'Lunes a Viernes: 8:00 AM - 8:00 PM | Sábados: 8:00 AM - 7:00 PM | Domingos y Feriados: 8:00 AM - 5:00 PM';
                }
              }
              return {
                ...s,
                slug: s.slug || s.name.toLowerCase().replace(/peluquería\s+/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
                hours: salonHours
              };
            });
            setSalons(formatted);
          } else {
            setSalons(defaultSalons);
          }
        } else {
          setSalons(defaultSalons);
        }
      } catch (err) {
        console.error("Error fetching salons:", err);
        setSalons(defaultSalons);
      } finally {
        setLoading(false);
      }
    };

    fetchSalons();
  }, []);

  const filteredSalons = salons.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.address.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="landing-page-content" style={{ padding: '6rem 0 4rem' }}>
      <div className="container">
        
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
          <span style={{ background: 'rgba(212, 175, 55, 0.1)', color: '#d4af37', padding: '0.5rem 1rem', borderRadius: '50px', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Nuestra Red</span>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 900, marginTop: '1rem', color: '#09090b' }}>
            NUESTROS <span style={{ color: '#d4af37' }}>SALONES AFILIADOS</span>
          </h1>
          <p style={{ maxWidth: '600px', margin: '1rem auto 0', color: '#64748b', fontSize: '1rem', lineHeight: 1.6 }}>
            Elige tu salón favorito para disfrutar de tu membresía. Puedes acudir a cualquiera de nuestras sucursales afiliadas en República Dominicana.
          </p>
        </div>

        {/* Search bar */}
        <div style={{ maxWidth: '500px', margin: '0 auto 3rem', position: 'relative' }}>
          <Search style={{ position: 'absolute', left: '1.25rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} size={20} />
          <input 
            type="text" 
            placeholder="Buscar por nombre o sector..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '1rem 1rem 1rem 3.25rem', borderRadius: '16px', border: '1.5px solid #e2e8f0', outline: 'none', fontSize: '0.95rem', transition: 'border-color 0.2s', boxShadow: '0 4px 10px rgba(0,0,0,0.01)' }}
          />
        </div>

        {/* Salons list grid */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>Cargando sucursales...</div>
        ) : filteredSalons.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2.5rem' }}>
            {filteredSalons.map(s => (
              <div key={s.id} style={{ background: 'white', borderRadius: '24px', border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 25px rgba(0,0,0,0.02)' }}>
                {/* Simulated cover image */}
                <div style={{ height: '180px', background: 'linear-gradient(135deg, #1e293b, #09090b)', padding: '1.5rem', display: 'flex', alignItems: 'flex-end', position: 'relative' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'url(/abatte_salon_interior_1777874331934.png) center/cover no-repeat', opacity: 0.4 }}></div>
                  <div style={{ position: 'relative', zIndex: 10 }}>
                    <span style={{ background: '#d4af37', color: 'white', padding: '0.25rem 0.75rem', borderRadius: '50px', fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase' }}>Sucursal Activa</span>
                    <h3 style={{ margin: '0.5rem 0 0 0', color: 'white', fontWeight: 900, fontSize: '1.3rem' }}>{s.name}</h3>
                  </div>
                </div>

                <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', flex: 1, gap: '1.25rem' }}>
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <MapPin style={{ color: '#d4af37', flexShrink: 0 }} size={18} />
                    <span style={{ fontSize: '0.85rem', color: '#64748b', lineHeight: 1.4 }}>{s.address}</span>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <Phone style={{ color: '#d4af37', flexShrink: 0 }} size={18} />
                    <span style={{ fontSize: '0.85rem', color: '#64748b' }}>{s.phone}</span>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <Clock style={{ color: '#d4af37', flexShrink: 0 }} size={18} />
                    <span style={{ fontSize: '0.85rem', color: '#64748b', lineHeight: 1.4 }}>{s.hours}</span>
                  </div>

                  <div style={{ marginTop: 'auto', paddingTop: '1.5rem', borderTop: '1px solid #f1f5f9', display: 'flex', gap: '1rem' }}>
                    <Link to={`/salones/${s.slug}`} className="landing-btn" style={{ flex: 1, textAlign: 'center', textDecoration: 'none', background: '#f1f5f9', color: '#09090b', padding: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                      <span>Ver Ficha</span>
                      <ArrowRight size={14} />
                    </Link>
                    <Link to="/registro" className="landing-btn btn-accent" style={{ flex: 1, textAlign: 'center', textDecoration: 'none', padding: '0.75rem' }}>
                      Suscribirme
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
            No se encontraron salones que coincidan con tu búsqueda.
          </div>
        )}

      </div>
    </div>
  );
};

export default Salones;
