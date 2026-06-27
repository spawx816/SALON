import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { dataService } from '../../utils/dataService';
import { UserCheck, Search, MessageSquare, Save, Star } from 'lucide-react';

const NPSScale = ({ value, onChange }) => {
  const getColor = (num) => {
    if (num <= 6) return '#ef4444'; // Red
    if (num <= 8) return '#f59e0b'; // Yellow/Orange
    return '#10b981'; // Green
  };

  return (
    <div style={{ 
      display: 'flex', 
      flexWrap: 'wrap', 
      gap: '8px', 
      justifyContent: 'center',
      padding: '0.5rem 0'
    }}>
      {[...Array(11).keys()].map((num) => (
        <button
          key={num}
          type="button"
          onClick={() => onChange(num)}
          style={{
            height: 'min(42px, 10vw)',
            width: 'min(42px, 10vw)',
            minWidth: '32px',
            minHeight: '32px',
            borderRadius: '50%',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontSize: 'min(1rem, 3.5vw)',
            fontWeight: 800,
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            backgroundColor: value === num ? getColor(num) : '#f1f5f9',
            color: value === num ? '#ffffff' : '#64748b',
            boxShadow: value === num ? `0 4px 12px ${getColor(num)}44` : 'none',
            transform: value === num ? 'scale(1.15)' : 'scale(1)'
          }}
        >
          {num}
        </button>
      ))}
    </div>
  );
};

const SatisfactionSurvey = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const { user } = useAuth();
  
  const [client, setClient] = useState(null);
  const [lastVisit, setLastVisit] = useState(null);
  const [searchCedula, setSearchCedula] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [hasPending, setHasPending] = useState(true);

  const [responses, setResponses] = useState({
    q1: null,
    q2: null,
    q3: null,
    q4: null,
    q5: null,
    q6: '',
    q7: null, // Recommendation
    q8: null  // Wait Time
  });

  useEffect(() => {
    const autoIdentify = async () => {
      const params = new URLSearchParams(location.search);
      const cedulaFromUrl = params.get('cedula');
      const cedulaToUse = cedulaFromUrl || (user?.role?.toLowerCase() === 'client' || user?.role?.toLowerCase() === 'cliente' ? user.cedula : null);

      if (cedulaToUse) {
        setIsLoading(true);
        const cleanCedula = String(cedulaToUse).replace(/\D/g, '');
        setSearchCedula(cleanCedula);
        try {
          let found = await dataService.findClientByCedula(cleanCedula);
          if (!found && cedulaToUse.includes('-')) {
            found = await dataService.findClientByCedula(cedulaToUse);
          }

            if (found) {
              setClient(found);
              // Check if has pending survey
              const pending = await dataService.checkPendingSurvey(found.id);
              setHasPending(pending);
              
              const visits = await dataService.getVisitsByClient(found.id);
              if (visits.length > 0) {
                setLastVisit(visits[visits.length - 1]);
              }
            }
        } catch (e) {
          console.error("Auto-identification failed:", e);
        } finally {
          setIsLoading(false);
        }
      }
    };
    autoIdentify();
  }, [location, user]);

  const handleSearch = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    const found = await dataService.findClientByCedula(searchCedula);
    if (found) {
      setClient(found);
      const visits = await dataService.getVisitsByClient(found.id);
      if (visits.length > 0) {
        setLastVisit(visits[visits.length - 1]);
      }
    } else {
      alert('Cliente no encontrado');
    }
    setIsLoading(false);
  };

  const peluqueraName = lastVisit?.empleado_peluquera || lastVisit?.empleadoPeluquera || 'N/A';
  const lavaPeloName = lastVisit?.empleado_lava_pelo || lastVisit?.empleadoLavaPelo || 'N/A';
  const manicuristaName = lastVisit?.empleado_manicurista || lastVisit?.empleadoManicurista || 'N/A';

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const requiredQuestions = [
      responses.q1, 
      responses.q7,
      responses.q8,
      responses.q2
    ];
    
    // Add conditional staff ratings to validation
    if (peluqueraName !== 'N/A') requiredQuestions.push(responses.q3);
    if (lavaPeloName !== 'N/A') requiredQuestions.push(responses.q4);
    if (manicuristaName !== 'N/A') requiredQuestions.push(responses.q5);

    if (requiredQuestions.some(v => v === null)) {
      alert("Por favor, califica todos los puntos antes de enviar.");
      return;
    }

    setIsLoading(true);
    try {
      await dataService.submitSurvey(client?.id, {
        ...responses,
        clientName: client?.nombre,
        salonName: client?.salon_name || 'San Vicente'
      });
      setIsSubmitted(true);
      setClient(null);
      setLastVisit(null);
    } catch (e) {
      alert('Error al guardar la encuesta');
    } finally {
      setIsLoading(false);
    }
  };

  if (isSubmitted) {
    return (
      <div style={{ maxWidth: '800px', margin: '2rem auto' }}>
        <div className="surface-card" style={{ padding: '4rem 2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ width: '80px', height: '80px', background: '#f0fdf4', color: '#10b981', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
            <UserCheck size={40} />
          </div>
          <h2 style={{ fontSize: '2.5rem', fontWeight: 900, color: '#09090b', letterSpacing: '-0.02em' }}>¡Gracias por tu opinión!</h2>
          <p style={{ color: '#64748b', fontSize: '1.1rem', maxWidth: '450px', lineHeight: 1.6 }}>
            Valoramos mucho tu tiempo. Tus respuestas nos ayudan a brindarte un servicio de excelencia en cada visita.
          </p>
          <button 
            onClick={() => window.location.href = 'https://planbeautyrd.com'}
            className="btn-primary"
            style={{ marginTop: '1.5rem', padding: '1.25rem 2.5rem', borderRadius: '18px', fontSize: '1.1rem' }}
          >
            Volver al Inicio
          </button>
        </div>
      </div>
    );
  }

  if (!hasPending && client) {
    return (
      <div style={{ maxWidth: '800px', margin: '2rem auto' }}>
        <div className="surface-card" style={{ padding: '4rem 2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ width: '80px', height: '80px', background: '#fffbeb', color: '#f59e0b', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
            <Star size={40} />
          </div>
          <h2 style={{ fontSize: '2.5rem', fontWeight: 900, color: '#09090b', letterSpacing: '-0.02em' }}>¡Encuesta Completada!</h2>
          <p style={{ color: '#64748b', fontSize: '1.1rem', maxWidth: '450px', lineHeight: 1.6 }}>
            Ya has completado la encuesta para tu última visita. ¡Gracias por ayudarnos a mejorar!
          </p>
          <button 
            onClick={() => window.location.href = 'https://planbeautyrd.com'}
            className="btn-primary"
            style={{ marginTop: '1.5rem', padding: '1.25rem 2.5rem', borderRadius: '18px', fontSize: '1.1rem' }}
          >
            Volver al Inicio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', paddingBottom: '4rem' }}>
      {!client ? (
        <div className="surface-card" style={{ padding: '4rem 2rem', textAlign: 'center' }}>
          <div style={{ width: '70px', height: '70px', background: '#f8fafc', borderRadius: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 2rem' }}>
            <Search size={32} color="#94a3b8" />
          </div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 900, marginBottom: '0.75rem' }}>Identifica tu visita</h2>
          <p style={{ color: '#64748b', marginBottom: '2.5rem' }}>Ingresa tu cédula para cargar tu última visita.</p>
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: '1rem', maxWidth: '450px', margin: '0 auto' }}>
            <input 
              className="input-field" 
              placeholder="000-0000000-0" 
              value={searchCedula}
              onChange={(e) => setSearchCedula(e.target.value)}
              required
              style={{ fontSize: '1.1rem', textAlign: 'center', letterSpacing: '1px' }}
            />
            <button type="submit" className="btn-primary" style={{ padding: '0 2rem', borderRadius: '16px' }} disabled={isLoading}>
              {isLoading ? '...' : 'Buscar'}
            </button>
          </form>
        </div>
      ) : (
        <div className="surface-card" style={{ padding: 'min(3.5rem, 10vw) min(2.5rem, 6vw)' }}>
          <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
            <h2 style={{ fontSize: '2.5rem', fontWeight: 900, color: '#09090b', marginBottom: '0.5rem', letterSpacing: '-0.02em' }}>Encuesta de Satisfacción</h2>
            <p style={{ color: '#64748b', fontSize: '1.1rem' }}>Tu opinión es lo más importante para nosotros</p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: '24px', padding: '1.75rem', marginBottom: '3.5rem' }}>
            <div style={{ width: '56px', height: '56px', background: '#09090b', color: 'white', borderRadius: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <UserCheck size={24} />
            </div>
            <div>
              <p style={{ fontWeight: 800, fontSize: '1.25rem', color: '#09090b', margin: 0 }}>Hola, {client.nombre}</p>
              <p style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 600, margin: '0.25rem 0 0' }}>Cuestionario para tu visita del {lastVisit ? new Date(lastVisit.visited_at).toLocaleDateString() : 'hoy'}</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
            
            <div style={{ background: '#ffffff', padding: '2rem', borderRadius: '24px', border: '1px solid #f1f5f9', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
              <label style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1e293b', marginBottom: '1.5rem', display: 'block', lineHeight: 1.5 }}>1. ¿Cómo calificarías tu experiencia en general en el salón?</label>
              <NPSScale value={responses.q1} onChange={(v) => setResponses({ ...responses, q1: v })} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.75rem' }}>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700 }}>Mala</span>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700 }}>Excelente</span>
              </div>
            </div>

            <div style={{ background: '#ffffff', padding: '2rem', borderRadius: '24px', border: '1px solid #f1f5f9', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
              <label style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1e293b', marginBottom: '1.5rem', display: 'block', lineHeight: 1.5 }}>2. ¿Qué tan probable es que nos recomiendes con tus amigas o familiares?</label>
              <NPSScale value={responses.q7} onChange={(v) => setResponses({ ...responses, q7: v })} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.75rem' }}>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700 }}>Poco probable</span>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700 }}>Muy probable</span>
              </div>
            </div>

            <div style={{ background: '#ffffff', padding: '2rem', borderRadius: '24px', border: '1px solid #f1f5f9', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
              <label style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1e293b', marginBottom: '1.5rem', display: 'block', lineHeight: 1.5 }}>3. ¿Cómo calificarías tu tiempo de espera en el salón?</label>
              <NPSScale value={responses.q8} onChange={(v) => setResponses({ ...responses, q8: v })} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.75rem' }}>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700 }}>Inaceptable</span>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700 }}>Excelente</span>
              </div>
            </div>

            <div style={{ background: '#ffffff', padding: '2rem', borderRadius: '24px', border: '1px solid #f1f5f9', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
              <label style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1e293b', marginBottom: '1.5rem', display: 'block', lineHeight: 1.5 }}>4. ¿Qué tan satisfecha estás con el resultado de tu servicio?</label>
              <NPSScale value={responses.q2} onChange={(v) => setResponses({ ...responses, q2: v })} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.75rem' }}>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700 }}>Insatisfecha</span>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700 }}>Muy Satisfecha</span>
              </div>
            </div>

            {peluqueraName !== 'N/A' && (
              <div style={{ background: '#ffffff', padding: '2rem', borderRadius: '24px', border: '1px solid #f1f5f9', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                <label style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1e293b', marginBottom: '1.5rem', display: 'block', lineHeight: 1.5 }}>5. ¿Cómo calificarías el servicio de <strong style={{ color: '#09090b' }}>{peluqueraName}</strong> (Peluquera)?</label>
                <NPSScale value={responses.q3} onChange={(v) => setResponses({ ...responses, q3: v })} />
              </div>
            )}

            {lavaPeloName !== 'N/A' && (
              <div style={{ background: '#ffffff', padding: '2rem', borderRadius: '24px', border: '1px solid #f1f5f9', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                <label style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1e293b', marginBottom: '1.5rem', display: 'block', lineHeight: 1.5 }}>6. ¿Cómo calificarías el servicio de <strong style={{ color: '#09090b' }}>{lavaPeloName}</strong> (Lava Pelo)?</label>
                <NPSScale value={responses.q4} onChange={(v) => setResponses({ ...responses, q4: v })} />
              </div>
            )}

            {manicuristaName !== 'N/A' && (
              <div style={{ background: '#ffffff', padding: '2rem', borderRadius: '24px', border: '1px solid #f1f5f9', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                <label style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1e293b', marginBottom: '1.5rem', display: 'block', lineHeight: 1.5 }}>7. ¿Cómo calificarías el servicio de <strong style={{ color: '#09090b' }}>{manicuristaName}</strong> (Manicurista)?</label>
                <NPSScale value={responses.q5} onChange={(v) => setResponses({ ...responses, q5: v })} />
              </div>
            )}

            <div style={{ background: '#ffffff', padding: '2rem', borderRadius: '24px', border: '1px solid #f1f5f9', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.1rem', fontWeight: 800, color: '#1e293b', marginBottom: '1.5rem' }}>
                <MessageSquare size={20} />
                8. ¿Qué podemos mejorar?
              </label>
              <textarea 
                rows="4" 
                value={responses.q6}
                onChange={(e) => setResponses({ ...responses, q6: e.target.value })}
                className="input-field"
                placeholder="Tus sugerencias nos ayudan a crecer..."
                style={{ resize: 'none', padding: '1.5rem', borderRadius: '18px', border: '1px solid #e2e8f0', fontSize: '1rem' }}
              />
            </div>

            <button type="submit" className="btn-primary" style={{ padding: '1.5rem', display: 'flex', justifyContent: 'center', fontSize: '1.25rem', gap: '0.75rem', borderRadius: '20px', marginTop: '1rem' }} disabled={isLoading}>
              {isLoading ? 'Guardando...' : <><Save size={24} /> Enviar Encuesta</>}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default SatisfactionSurvey;
