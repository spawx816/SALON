import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getCurrentMotivationalPhrase } from '../../utils/motivationalPhrases';

const RadiantHeartIcon = () => (
  <div style={{ position: 'relative', width: '96px', height: '96px', margin: '0 auto 2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <svg width="84" height="84" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ overflow: 'visible' }}>
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
        stroke="url(#heartGradientFullCanvas)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id="heartGradientFullCanvas" x1="14" y1="14" x2="46" y2="46.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ec4899" />
          <stop offset="1" stopColor="#f43f5e" />
        </linearGradient>
      </defs>
    </svg>
  </div>
);

const ReceptionDashboard = () => {
  const [phrase, setPhrase] = useState(getCurrentMotivationalPhrase());

  // Actualizar frase y rotar cada 30 minutos sin repetir
  useEffect(() => {
    setPhrase(getCurrentMotivationalPhrase());
    const interval = setInterval(() => {
      setPhrase(getCurrentMotivationalPhrase());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        background: '#ffffff',
        backgroundImage: 'radial-gradient(circle at 50% 45%, rgba(244, 114, 182, 0.08) 0%, rgba(255, 255, 255, 1) 75%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '3rem 2rem',
        boxSizing: 'border-box',
        overflow: 'hidden'
      }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={phrase.id}
          initial={{ opacity: 0, y: 15, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -15, scale: 0.98 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          style={{
            maxWidth: '960px',
            width: '100%',
            margin: '0 auto',
            textAlign: 'center'
          }}
        >
          {/* Ícono Corazón Radiante */}
          <RadiantHeartIcon />

          {/* Título Principal con Gradiente Violeta a Fucsia */}
          <h1
            style={{
              margin: '0 0 1.5rem 0',
              fontSize: 'clamp(3.5rem, 8vw, 6rem)',
              fontWeight: 800,
              letterSpacing: '-0.025em',
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
              width: '48px',
              height: '4px',
              background: '#f472b6',
              borderRadius: '10px',
              margin: '0 auto 1.75rem auto'
            }}
          />

          {/* Subtítulo / Mensaje de actitud */}
          <p
            style={{
              margin: '0 auto',
              fontSize: 'clamp(1.25rem, 2.8vw, 1.85rem)',
              color: '#334155',
              fontWeight: 400,
              lineHeight: 1.5,
              maxWidth: '750px',
              letterSpacing: '-0.01em'
            }}
          >
            {phrase.subtitle}
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default ReceptionDashboard;
