import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { User, ChevronDown, Sparkles, ArrowRight, RefreshCw, Calendar, Heart } from 'lucide-react';
import { getCurrentMotivationalPhrase, advanceToNextPhrase } from '../../utils/motivationalPhrases';
import { useAuth } from '../../context/AuthContext';

const RadiantHeartIcon = () => (
  <div style={{ position: 'relative', width: '88px', height: '88px', margin: '0 auto 1.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <svg width="76" height="76" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ overflow: 'visible' }}>
      {/* Top Left Ray */}
      <line x1="16" y1="12" x2="11" y2="7" stroke="#ec4899" strokeWidth="2.5" strokeLinecap="round" opacity="0.85" />
      {/* Top Center-Left Ray */}
      <line x1="24" y1="8" x2="22" y2="2" stroke="#f43f5e" strokeWidth="2.5" strokeLinecap="round" opacity="0.85" />
      {/* Top Center Ray */}
      <line x1="30" y1="7" x2="30" y2="1" stroke="#ec4899" strokeWidth="2.5" strokeLinecap="round" opacity="0.9" />
      {/* Top Center-Right Ray */}
      <line x1="36" y1="8" x2="38" y2="2" stroke="#f43f5e" strokeWidth="2.5" strokeLinecap="round" opacity="0.85" />
      {/* Top Right Ray */}
      <line x1="44" y1="12" x2="49" y2="7" stroke="#ec4899" strokeWidth="2.5" strokeLinecap="round" opacity="0.85" />
      
      {/* Central Outline Heart */}
      <path
        d="M30 46.5C30 46.5 14 36.8 14 24.5C14 18.5 18.5 14 24 14C27.2 14 29.5 15.5 30 16.5C30.5 15.5 32.8 14 36 14C41.5 14 46 18.5 46 24.5C46 36.8 30 46.5 30 46.5Z"
        fill="none"
        stroke="url(#heartGradientDashboard)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id="heartGradientDashboard" x1="14" y1="14" x2="46" y2="46.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ec4899" />
          <stop offset="1" stopColor="#f43f5e" />
        </linearGradient>
      </defs>
    </svg>
  </div>
);

const ReceptionDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [phrase, setPhrase] = useState(getCurrentMotivationalPhrase());

  // Actualizar frase al cargar y chequear rotación cada 30 segundos
  useEffect(() => {
    setPhrase(getCurrentMotivationalPhrase());
    const interval = setInterval(() => {
      setPhrase(getCurrentMotivationalPhrase());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleNext = () => {
    const next = advanceToNextPhrase();
    setPhrase(next);
  };

  return (
    <div
      style={{
        minHeight: 'calc(100vh - 4rem)',
        background: '#ffffff',
        backgroundImage: 'radial-gradient(circle at 50% 40%, rgba(244, 114, 182, 0.06) 0%, rgba(255, 255, 255, 1) 75%)',
        borderRadius: '24px',
        border: '1px solid rgba(244, 114, 182, 0.15)',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.02)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '2.5rem 3rem',
        boxSizing: 'border-box',
        overflow: 'hidden'
      }}
    >
      {/* HEADER SUPERIOR */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#be185d', background: '#fdf2f8', border: '1px solid #fbcfe8', padding: '0.35rem 0.85rem', borderRadius: '50px', letterSpacing: '0.05em' }}>
            TURNO EN CURSO
          </span>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#94a3b8' }}>
            Rotación cada 30 min
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* Botón cambiar frase manual */}
          <button
            onClick={handleNext}
            title="Siguiente frase motivacional"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              background: 'rgba(241, 245, 249, 0.9)',
              border: '1px solid #e2e8f0',
              padding: '0.5rem 1rem',
              borderRadius: '50px',
              fontSize: '0.8rem',
              fontWeight: 700,
              color: '#475569',
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: '0 2px 5px rgba(0,0,0,0.02)'
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = '#e2e8f0'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(241, 245, 249, 0.9)'; }}
          >
            <RefreshCw size={14} />
            <span>Siguiente Frase ({phrase.orderPosition}/{phrase.totalPhrases})</span>
          </button>

          {/* Perfil de Recepción */}
          <div 
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.65rem',
              padding: '0.45rem 1rem',
              borderRadius: '50px',
              background: 'rgba(255, 255, 255, 0.95)',
              border: '1px solid rgba(244, 114, 182, 0.25)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
            }}
          >
            <div 
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: 'rgba(244, 63, 94, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#e11d48'
              }}
            >
              <User size={18} strokeWidth={2.2} />
            </div>
            <span style={{ fontSize: '0.925rem', fontWeight: 700, color: '#334155' }}>
              {user?.nombre || user?.name || 'Recepción'}
            </span>
          </div>
        </div>
      </div>

      {/* CONTENIDO CENTRAL: FRASE MOTIVACIONAL */}
      <AnimatePresence mode="wait">
        <motion.div
          key={phrase.id}
          initial={{ opacity: 0, y: 15, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -15, scale: 0.98 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          style={{
            maxWidth: '920px',
            margin: '0 auto',
            textAlign: 'center',
            padding: '2.5rem 1rem'
          }}
        >
          {/* Ícono Corazón Radiante */}
          <RadiantHeartIcon />

          {/* Título Principal con Gradiente Violeta a Fucsia */}
          <h1
            style={{
              margin: '0 0 1.25rem 0',
              fontSize: 'clamp(3.2rem, 7vw, 5.2rem)',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 35%, #c026d3 70%, #ec4899 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontFamily: '"Outfit", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
            }}
          >
            {phrase.title}
          </h1>

          {/* Pequeña barra separadora rosa */}
          <div
            style={{
              width: '44px',
              height: '4px',
              background: '#f472b6',
              borderRadius: '10px',
              margin: '0 auto 1.5rem auto'
            }}
          />

          {/* Subtítulo / Mensaje */}
          <p
            style={{
              margin: '0 auto',
              fontSize: 'clamp(1.2rem, 2.5vw, 1.65rem)',
              color: '#334155',
              fontWeight: 400,
              lineHeight: 1.5,
              maxWidth: '700px',
              letterSpacing: '-0.01em'
            }}
          >
            {phrase.subtitle}
          </p>

          {/* Botón de acceso directo a Facturación / POS */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            style={{ marginTop: '3.25rem' }}
          >
            <button
              onClick={() => navigate('/visitas')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.95rem 2.4rem',
                borderRadius: '50px',
                background: 'linear-gradient(135deg, #09090b 0%, #27272a 100%)',
                color: '#ffffff',
                border: 'none',
                fontSize: '1rem',
                fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '0 10px 25px rgba(0, 0, 0, 0.15)',
                transition: 'all 0.2s ease'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 14px 30px rgba(0, 0, 0, 0.2)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 10px 25px rgba(0, 0, 0, 0.15)';
              }}
            >
              <span>Ir a Facturación</span>
              <ArrowRight size={19} />
            </button>
          </motion.div>
        </motion.div>
      </AnimatePresence>

      {/* FOOTER INFERIOR */}
      <div 
        style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          gap: '0.65rem',
          width: '100%',
          paddingTop: '1rem',
          color: '#94a3b8',
          fontSize: '0.85rem',
          fontWeight: 500
        }}
      >
        <span>{user?.nombre || user?.name || 'Recepción'}</span>
        <span style={{ color: '#f43f5e', fontSize: '1rem' }}>•</span>
        <span>{user?.salon_name || 'Plan Beauty'}</span>
      </div>
    </div>
  );
};

export default ReceptionDashboard;
