import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, ChevronDown, Sparkles, X, ArrowRight, RefreshCw, Heart } from 'lucide-react';
import { getCurrentMotivationalPhrase, advanceToNextPhrase } from '../../utils/motivationalPhrases';

const RadiantHeartIcon = () => (
  <div style={{ position: 'relative', width: '80px', height: '80px', margin: '0 auto 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    {/* Radiating sparkle rays */}
    <svg width="70" height="70" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ overflow: 'visible' }}>
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
        stroke="url(#heartGradient)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id="heartGradient" x1="14" y1="14" x2="46" y2="46.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ec4899" />
          <stop offset="1" stopColor="#f43f5e" />
        </linearGradient>
      </defs>
    </svg>
  </div>
);

const ReceptionMotivationalModal = ({ 
  isOpen, 
  onClose, 
  userName = 'Recepción', 
  salonName = 'Sistema de Gestión',
  autoCloseSec = 0
}) => {
  const [phrase, setPhrase] = useState(getCurrentMotivationalPhrase());
  const [showNextPrompt, setShowNextPrompt] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPhrase(getCurrentMotivationalPhrase());
    }
  }, [isOpen]);

  // Rotación en vivo cada 30 minutos mientras esté abierto
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      setPhrase(getCurrentMotivationalPhrase());
    }, 60000); // Chequea cada minuto si expiraron los 30 min
    return () => clearInterval(interval);
  }, [isOpen]);

  // Auto-cierre opcional si se desea
  useEffect(() => {
    if (!isOpen || autoCloseSec <= 0) return;
    const timer = setTimeout(() => {
      if (onClose) onClose();
    }, autoCloseSec * 1000);
    return () => clearTimeout(timer);
  }, [isOpen, autoCloseSec, onClose]);

  const handleNext = (e) => {
    if (e) e.stopPropagation();
    const next = advanceToNextPhrase();
    setPhrase(next);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.35 }}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: '#ffffff',
          backgroundImage: 'radial-gradient(circle at 50% 45%, rgba(244, 114, 182, 0.05) 0%, rgba(255, 255, 255, 1) 70%)',
          zIndex: 9999,
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
          <div>
            {/* Pequeño badge de sucursal / modo */}
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.05em' }}>
              TURNO EN CURSO
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {/* Botón cambiar frase manual (opcional) */}
            <button
              onClick={handleNext}
              title="Siguiente frase motivacional"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                background: 'rgba(241, 245, 249, 0.8)',
                border: '1px solid #e2e8f0',
                padding: '0.45rem 0.85rem',
                borderRadius: '50px',
                fontSize: '0.75rem',
                fontWeight: 700,
                color: '#64748b',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              <RefreshCw size={13} />
              <span>Rotar ({phrase.orderPosition}/{phrase.totalPhrases})</span>
            </button>

            {/* Perfil de Recepción exacto al diseño */}
            <div 
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.65rem',
                padding: '0.45rem 0.95rem',
                borderRadius: '50px',
                background: 'rgba(255, 255, 255, 0.9)',
                border: '1px solid rgba(244, 114, 182, 0.2)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
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
              <span style={{ fontSize: '0.925rem', fontWeight: 600, color: '#334155' }}>
                {userName || 'Recepción'}
              </span>
              <ChevronDown size={16} color="#64748b" />
            </div>

            {/* Botón Salir / Continuar */}
            {onClose && (
              <button
                onClick={onClose}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#64748b',
                  cursor: 'pointer'
                }}
                title="Cerrar y continuar"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>

        {/* CONTENIDO CENTRAL */}
        <motion.div
          key={phrase.id}
          initial={{ opacity: 0, y: 15, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -15, scale: 0.98 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          style={{
            maxWidth: '900px',
            margin: '0 auto',
            textAlign: 'center',
            padding: '2rem 1rem'
          }}
        >
          {/* Ícono Corazón Radiante */}
          <RadiantHeartIcon />

          {/* Título Principal con Gradiente Violeta a Fucsia */}
          <h1
            style={{
              margin: '0 0 1.25rem 0',
              fontSize: 'clamp(3.2rem, 7vw, 5.5rem)',
              fontWeight: 700,
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
              width: '42px',
              height: '3.5px',
              background: '#f472b6',
              borderRadius: '10px',
              margin: '0 auto 1.5rem auto'
            }}
          />

          {/* Subtítulo / Mensaje de actitud */}
          <p
            style={{
              margin: '0 auto',
              fontSize: 'clamp(1.2rem, 2.5vw, 1.65rem)',
              color: '#334155',
              fontWeight: 400,
              lineHeight: 1.5,
              maxWidth: '680px',
              letterSpacing: '-0.01em'
            }}
          >
            {phrase.subtitle}
          </p>

          {/* Botón de acción para continuar al POS */}
          {onClose && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              style={{ marginTop: '3rem' }}
            >
              <button
                onClick={onClose}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.65rem',
                  padding: '0.85rem 2.2rem',
                  borderRadius: '50px',
                  background: 'linear-gradient(135deg, #09090b 0%, #27272a 100%)',
                  color: '#ffffff',
                  border: 'none',
                  fontSize: '0.95rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '0 8px 20px rgba(0, 0, 0, 0.12)',
                  transition: 'transform 0.2s, box-shadow 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
              >
                <span>Continuar a Facturación</span>
                <ArrowRight size={18} />
              </button>
            </motion.div>
          )}
        </motion.div>

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
          <span>{userName || 'Recepción'}</span>
          <span style={{ color: '#f43f5e', fontSize: '1rem' }}>•</span>
          <span>{salonName || 'Sistema de Gestión'}</span>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default ReceptionMotivationalModal;
