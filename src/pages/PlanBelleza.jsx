import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDocumentMetadata } from '../hooks/useDocumentMetadata';
import { CheckCircle2, ShieldCheck, Sparkles, HelpCircle, ChevronDown, ChevronUp, Award, Gift, Coins, CreditCard, Clock, Globe, Star, Key, Cake, Scissors, Smartphone, Lock } from 'lucide-react';

const PlanBelleza = () => {
  useDocumentMetadata({
    title: 'Plan de lavados por RD$1,950 al mes | Plan Beauty RD',
    description: 'Conoce nuestro plan único de belleza mensual. Incluye 4 lavados profesionales, secado y atención premium en salones afiliados de República Dominicana.',
    canonicalUrl: 'https://planbeautyrd.com/plan-de-belleza',
    robots: 'index, follow'
  });

  const [expandedIndex, setExpandedIndex] = useState(null);

  const toggleExpand = (index) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  const faqs = [
    {
      question: '¿Qué es Plan Beauty RD?',
      answer: 'Plan Beauty es una membresía de suscripción mensual que te permite disfrutar de lavados y peinados profesionales en salones afiliados de República Dominicana por una tarifa plana fija.'
    },
    {
      question: '¿Qué incluye Plan Beauty?',
      answer: 'Plan Beauty incluye hasta 4 lavados profesionales con secado a blower (o rolos/plancha de tu elección) durante cada ciclo de 30 días.'
    },
    {
      question: '¿Los lavados se acumulan si no los utilizo?',
      answer: 'No. Cada membresía tiene un ciclo de 30 días, contado a partir de la fecha en que se activa o renueva tu plan. Los lavados deben utilizarse dentro de ese período y no son acumulables para el siguiente ciclo.'
    },
    {
      question: '¿El plan cubre cualquier largo o tipo de cabello?',
      answer: 'Sí. Nuestra tarifa plana de RD$1,950 al mes cubre cualquier largo de cabello natural de la cliente suscrita. No se realizarán cargos adicionales por cabello largo en los lavados y secados estándar.'
    },
    {
      question: '¿Necesito hacer cita para utilizar mi plan?',
      answer: 'No. Solo debes visitar la sucursal donde te afiliaste, dentro del horario de atención, y serás atendida por orden de llegada.'
    },
    {
      question: '¿Puedo utilizar mi membresía en cualquier sucursal?',
      answer: 'No. Tu membresía es válida únicamente en la sucursal donde realizaste tu afiliación.'
    },
    {
      question: '¿Cómo se realiza el pago?',
      answer: 'El pago de la membresía (RD$1,950 al mes) se procesa automáticamente cada 30 días mediante la tarjeta de crédito o débito registrada al momento de tu suscripción (bajo el sistema seguro y cifrado de CardNet).'
    },
    {
      question: '¿La membresía tiene contrato?',
      answer: 'Sí. Antes de completar tu suscripción deberás aceptar un contrato digital con los términos y condiciones del servicio. La membresía tiene una duración mínima de doce (12) meses, conforme a las condiciones establecidas en el contrato.'
    },
    {
      question: '¿Puedo cancelar mi membresía?',
      answer: 'Sí. Puedes solicitar la cancelación de tu membresía conforme a las condiciones de tu contrato de servicio, debiendo asistir de forma presencial a la sucursal y solicitarlo en recepción antes de tu próxima fecha de facturación.'
    },
    {
      question: '¿Qué pasa si mi pago es rechazado?',
      answer: 'Te notificaremos para que puedas actualizar tu método de pago y mantener activa tu membresía de lavados.'
    },
    {
      question: '¿Hay cargos adicionales?',
      answer: 'La membresía cubre únicamente los servicios de lavado y secado estándar. Cualquier servicio adicional (tintes, tratamientos profundos, cortes, etc.) se cobrará de forma independiente según la tarifa vigente del salón.'
    },
    {
      question: '¿Qué debo presentar para utilizar mi membresía?',
      answer: 'Solo debes identificarte con tu cédula o documento registrado para que nuestro personal valide tu membresía activa en el sistema.'
    },
    {
      question: '¿Puedo transferir mi membresía a otra persona?',
      answer: 'No. La membresía es de uso personal e intransferible.'
    },
    {
      question: '¿Cuándo inicia mi nuevo ciclo de lavados?',
      answer: 'Tu nuevo ciclo inicia automáticamente cada 30 días, contados desde la fecha de activación o renovación de tu membresía. En ese momento se habilitan nuevamente tus lavados disponibles.'
    },
    {
      question: '¿Cómo puedo contactar a Plan Beauty si tengo alguna duda?',
      answer: 'Puedes comunicarte con nosotros a través de nuestros canales de atención o visitar la sucursal donde te afiliaste para recibir asistencia directa.'
    }
  ];

  return (
    <div className="landing-page-content" style={{ padding: '6rem 0 4rem' }}>
      <div className="container">
        {/* Hero inside page */}
        <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
          <span style={{ background: 'rgba(212, 175, 55, 0.1)', color: '#d4af37', padding: '0.5rem 1rem', borderRadius: '50px', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Membresía Exclusiva</span>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 900, marginTop: '1rem', color: '#09090b' }}>
            CUIDA TU CABELLO TODO EL MES POR <span style={{ color: '#d4af37' }}>RD$1,950</span>
          </h1>
          <p style={{ maxWidth: '600px', margin: '1rem auto 0', color: '#64748b', fontSize: '1rem', lineHeight: 1.6 }}>
            Plan Beauty es una suscripción mensual que te permite disfrutar de 4 lavados profesionales y peinados en salones afiliados de República Dominicana.
          </p>
        </div>

        {/* Plan card section */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2.5rem', alignItems: 'center', marginBottom: '5rem' }}>
          <div style={{ background: 'white', padding: '2.5rem', borderRadius: '24px', boxShadow: '0 20px 40px rgba(0,0,0,0.03)', border: '1px solid #f1f5f9' }}>
            <h2 style={{ fontSize: '1.75rem', fontWeight: 900, color: '#09090b', marginBottom: '1.5rem' }}>¿Qué incluye el plan?</h2>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <CheckCircle2 style={{ color: '#d4af37', flexShrink: 0 }} size={22} />
                <div>
                  <h4 style={{ margin: 0, fontWeight: 700, fontSize: '0.95rem' }}>4 Lavados al mes</h4>
                  <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>Cuatro servicios de lavado profesional distribuidos en tu periodo de 30 días.</p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <CheckCircle2 style={{ color: '#d4af37', flexShrink: 0 }} size={22} />
                <div>
                  <h4 style={{ margin: 0, fontWeight: 700, fontSize: '0.95rem' }}>Secado Profesional Incluido</h4>
                  <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>Incluye rolos y blower sin cargos adicionales según tu preferencia.</p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <CheckCircle2 style={{ color: '#d4af37', flexShrink: 0 }} size={22} />
                <div>
                  <h4 style={{ margin: 0, fontWeight: 700, fontSize: '0.95rem' }}>Sin Importar el Largo</h4>
                  <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>Tarifa plana aplicable para cualquier largo de cabello natural.</p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <CheckCircle2 style={{ color: '#d4af37', flexShrink: 0 }} size={22} />
                <div>
                  <h4 style={{ margin: 0, fontWeight: 700, fontSize: '0.95rem' }}>Red de Salones Afiliados</h4>
                  <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>Puedes cambiar o visitar cualquiera de nuestras sucursales activas en tu ciudad.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Pricing Action Box */}
          <div style={{ background: '#09090b', color: 'white', padding: '3rem 2.5rem', borderRadius: '24px', position: 'relative', overflow: 'hidden', boxShadow: '0 25px 50px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%' }}>
            <div style={{ position: 'absolute', top: '-50px', right: '-50px', width: '150px', height: '150px', borderRadius: '50%', background: 'rgba(212, 175, 55, 0.15)', filter: 'blur(30px)' }}></div>
            <span style={{ color: '#d4af37', fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem', display: 'block' }}>Suscripción Mensual</span>
            <h3 style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0 0 1rem 0' }}>Plan Único Completo</h3>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', margin: '1rem 0' }}>
              <span style={{ fontSize: '2.5rem', fontWeight: 900, color: '#d4af37' }}>RD$1,950</span>
              <span style={{ fontSize: '0.85rem', color: '#a1a1aa' }}>/ AL MES</span>
            </div>
            
            <p style={{ color: '#a1a1aa', fontSize: '0.85rem', lineHeight: 1.6, marginBottom: '2rem' }}>
              El pago se procesa de forma automática y segura de manera mensual. Cancela o pausa tu suscripción cuando lo desees de manera presencial.
            </p>

            <Link to="/registro" className="landing-btn btn-accent" style={{ textDecoration: 'none', textAlign: 'center', width: '100%', display: 'block', padding: '1rem' }}>
              QUIERO MI PLAN
            </Link>

            <div style={{ display: 'flex', itemsAlign: 'center', gap: '0.5rem', marginTop: '1.5rem', justifyContent: 'center', color: '#71717a', fontSize: '0.75rem' }}>
              <ShieldCheck size={14} style={{ color: '#d4af37' }} />
              <span>Transacciones seguras mediante CardNet</span>
            </div>
          </div>
        </div>

        {/* Beneficios y Características Section */}
        <div style={{ marginTop: '5rem', marginBottom: '5rem' }}>
          
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <span style={{ background: 'rgba(212, 175, 55, 0.1)', color: '#d4af37', padding: '0.5rem 1rem', borderRadius: '50px', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ventajas y Garantías</span>
            <h2 style={{ fontSize: '2rem', fontWeight: 900, marginTop: '1rem', color: '#09090b' }}>
              BENEFICIOS EXCLUSIVOS DE TU MEMBRESÍA
            </h2>
            <p style={{ maxWidth: '600px', margin: '0.75rem auto 0', color: '#64748b', fontSize: '0.95rem', lineHeight: 1.6 }}>
              Disfruta de la comodidad de un servicio diseñado a tu medida con la máxima seguridad y ventajas inigualables en el mercado.
            </p>
          </div>

          {/* Card: Welcome Offer (Full Width Highlighted) */}
          <div style={{ 
            background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)', 
            padding: '3rem', 
            borderRadius: '24px', 
            border: '2px solid #fde047',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(234, 179, 8, 0.15)',
            marginBottom: '3rem'
          }}>
            {/* Background elements */}
            <div style={{ position: 'absolute', top: '-60px', right: '-60px', width: '200px', height: '200px', borderRadius: '50%', background: 'rgba(234, 179, 8, 0.2)', filter: 'blur(40px)' }}></div>
            <div style={{ position: 'absolute', bottom: '-80px', left: '-80px', width: '250px', height: '250px', borderRadius: '50%', background: 'rgba(234, 179, 8, 0.15)', filter: 'blur(50px)' }}></div>

            <div style={{ position: 'relative', zIndex: 1 }}>
              
              {/* Badge */}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: '#eab308', color: '#09090b', padding: '0.4rem 1rem', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1.25rem', boxShadow: '0 4px 12px rgba(234, 179, 8, 0.3)' }}>
                <span>🎁 Beneficio de Bienvenida Exclusivo</span>
              </div>

              {/* Title & Subtitle */}
              <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.75rem', fontWeight: 900, color: '#854d0e', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <span>¡Oferta de Bienvenida de Plan Beauty!</span>
                <span style={{ fontSize: '1.5rem' }}>🎉</span>
              </h3>
              <p style={{ margin: '0 0 2rem 0', fontSize: '0.95rem', color: '#713f12', fontWeight: 700, lineHeight: 1.6, maxWidth: '800px' }}>
                Durante los primeros 3 meses de tu membresía podrás elegir, en cada ciclo de 30 días, uno de los siguientes beneficios de valor agregado sin costo adicional:
              </p>

              {/* Options split */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', alignItems: 'stretch' }}>
                
                {/* Option 1 */}
                <div style={{ background: 'white', padding: '2rem', borderRadius: '20px', border: '1px solid rgba(234, 179, 8, 0.3)', display: 'flex', gap: '1.25rem', boxShadow: '0 10px 20px rgba(0,0,0,0.02)' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: '#fef9c3', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Sparkles size={24} color="#ca8a04" />
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.7rem', fontWeight: 800, color: '#ca8a04', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Regalo Opción A</span>
                    <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1.05rem', fontWeight: 800, color: '#09090b' }}>1 Lavado Adicional Gratis</h4>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b', lineHeight: 1.5 }}>
                      Suma un lavado profesional adicional a tu plan mensual para disfrutar de <strong>hasta 5 lavados</strong> en total durante el ciclo.
                    </p>
                  </div>
                </div>

                {/* Option 2 */}
                <div style={{ background: 'white', padding: '2rem', borderRadius: '20px', border: '1px solid rgba(234, 179, 8, 0.3)', display: 'flex', gap: '1.25rem', boxShadow: '0 10px 20px rgba(0,0,0,0.02)' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: '#fef9c3', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Award size={24} color="#ca8a04" />
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.7rem', fontWeight: 800, color: '#ca8a04', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Regalo Opción B</span>
                    <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1.05rem', fontWeight: 800, color: '#09090b' }}>1 Tratamiento Profundo Gratis</h4>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b', lineHeight: 1.5 }}>
                      Elige un tratamiento capilar profundo gratis para hidratar y revitalizar tu cabello con productos profesionales de alta gama.
                    </p>
                  </div>
                </div>

              </div>

            </div>
          </div>

          {/* Bento/Features Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
            
            {/* 0. Pioneros en Innovación (Bento card - Dark style) */}
            <div style={{ 
              background: '#09090b', 
              color: 'white', 
              padding: '1.75rem', 
              borderRadius: '20px', 
              border: '1px solid rgba(212, 175, 55, 0.3)',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: '0 10px 30px rgba(9,9,9,0.05)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center'
            }}>
              <div style={{ position: 'absolute', top: '-25px', right: '-25px', width: '80px', height: '80px', borderRadius: '50%', background: 'rgba(212, 175, 55, 0.1)', filter: 'blur(15px)' }}></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '1.25rem' }}>🥇</span>
                <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#d4af37' }}>Pioneros en Innovación</h4>
              </div>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#a1a1aa', lineHeight: 1.6 }}>
                Plan Beauty es la primera membresía para salones de belleza en República Dominicana con pago automático mediante CardNet y en funcionamiento, ofreciendo una experiencia moderna, segura y completamente digital.
              </p>
            </div>

            {/* 1. Ahorro */}
            <div className="surface-card" style={{ padding: '1.75rem', borderRadius: '20px', border: '1px solid #e2e8f0', background: 'white' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(212, 175, 55, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
                <Coins size={20} color="#d4af37" />
              </div>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', fontWeight: 800, color: '#09090b' }}>Ahorro Inteligente</h4>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', lineHeight: 1.6 }}>
                Obtén hasta 5 lavados por solo RD$1,950 al mes. Disfruta de un plan diseñado para ayudarte a ahorrar mientras mantienes tu cabello impecable.
              </p>
            </div>

            {/* 2. Pago automático */}
            <div className="surface-card" style={{ padding: '1.75rem', borderRadius: '20px', border: '1px solid #e2e8f0', background: 'white' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(212, 175, 55, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
                <CreditCard size={20} color="#d4af37" />
              </div>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', fontWeight: 800, color: '#09090b' }}>Pago Automático</h4>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', lineHeight: 1.6 }}>
                Tu membresía se renueva automáticamente cada 30 días mediante la tarjeta registrada al momento de tu suscripción, sin complicaciones.
              </p>
            </div>

            {/* 3. Sin Cita */}
            <div className="surface-card" style={{ padding: '1.75rem', borderRadius: '20px', border: '1px solid #e2e8f0', background: 'white' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(212, 175, 55, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
                <Clock size={20} color="#d4af37" />
              </div>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', fontWeight: 800, color: '#09090b' }}>Sin Necesidad de Cita</h4>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', lineHeight: 1.6 }}>
                Visita la sucursal donde te afiliaste dentro de sus horarios de atención regulares y recibe tu servicio por orden estricto de llegada.
              </p>
            </div>

            {/* 4. Acceso Web */}
            <div className="surface-card" style={{ padding: '1.75rem', borderRadius: '20px', border: '1px solid #e2e8f0', background: 'white' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(212, 175, 55, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
                <Globe size={20} color="#d4af37" />
              </div>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', fontWeight: 800, color: '#09090b' }}>Acceso Exclusivo Web</h4>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', lineHeight: 1.6 }}>
                Consulta el estado de tu membresía, los lavados disponibles, tu historial de visitas y la fecha de tu próxima renovación desde cualquier lugar.
              </p>
            </div>

            {/* 5. Certificados de regalo */}
            <div className="surface-card" style={{ padding: '1.75rem', borderRadius: '20px', border: '1px solid #e2e8f0', background: 'white' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(212, 175, 55, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
                <Gift size={20} color="#d4af37" />
              </div>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', fontWeight: 800, color: '#09090b' }}>Certificados de Regalo</h4>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', lineHeight: 1.6 }}>
                Adquiere certificados de regalo directamente desde la plataforma para sorprender a familiares y amigos con una experiencia de belleza.
              </p>
            </div>

            {/* 6. Satisfacción */}
            <div className="surface-card" style={{ padding: '1.75rem', borderRadius: '20px', border: '1px solid #e2e8f0', background: 'white' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(212, 175, 55, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
                <Star size={20} color="#d4af37" />
              </div>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', fontWeight: 800, color: '#09090b' }}>Encuestas de Satisfacción</h4>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', lineHeight: 1.6 }}>
                Después de cada visita podrás evaluar el servicio recibido en el salón, ayudándonos a mejorar continuamente tu experiencia de belleza.
              </p>
            </div>

            {/* 7. Validación segura */}
            <div className="surface-card" style={{ padding: '1.75rem', borderRadius: '20px', border: '1px solid #e2e8f0', background: 'white' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(212, 175, 55, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
                <Key size={20} color="#d4af37" />
              </div>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', fontWeight: 800, color: '#09090b' }}>Control Seguro</h4>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', lineHeight: 1.6 }}>
                Cada lavado se valida mediante un código de seguridad único por poncheo, garantizando que únicamente tú puedas utilizar los beneficios.
              </p>
            </div>

            {/* 8. Cumpleaños */}
            <div className="surface-card" style={{ padding: '1.75rem', borderRadius: '20px', border: '1px solid #e2e8f0', background: 'white' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(212, 175, 55, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
                <Cake size={20} color="#d4af37" />
              </div>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', fontWeight: 800, color: '#09090b' }}>Especial por Cumpleaños</h4>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', lineHeight: 1.6 }}>
                Durante el mes de tu cumpleaños disfrutarás de un beneficio y atención exclusivos como parte consentida de nuestra membresía.
              </p>
            </div>

            {/* 9. Descuentos en otros servicios */}
            <div className="surface-card" style={{ padding: '1.75rem', borderRadius: '20px', border: '1px solid #e2e8f0', background: 'white' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(212, 175, 55, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
                <Scissors size={20} color="#d4af37" />
              </div>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', fontWeight: 800, color: '#09090b' }}>Descuentos en Salón</h4>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', lineHeight: 1.6 }}>
                Como miembro de Plan Beauty tendrás acceso a descuentos especiales en los demás procesos y servicios ofrecidos por Abatte Peluquería.
              </p>
            </div>

            {/* 10. CardNet */}
            <div className="surface-card" style={{ padding: '1.75rem', borderRadius: '20px', border: '1px solid #e2e8f0', background: 'white' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(212, 175, 55, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
                <Lock size={20} color="#d4af37" />
              </div>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', fontWeight: 800, color: '#09090b' }}>Seguridad CardNet</h4>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', lineHeight: 1.6 }}>
                Todos los pagos son procesados a través de CardNet, garantizando la máxima protección de tu información bancaria y seguridad transaccional.
              </p>
            </div>

            {/* 11. Calidad Abatte */}
            <div className="surface-card" style={{ padding: '1.75rem', borderRadius: '20px', border: '1px solid #e2e8f0', background: 'white' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(212, 175, 55, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
                <CheckCircle2 size={20} color="#d4af37" />
              </div>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', fontWeight: 800, color: '#09090b' }}>Calidad y Confianza</h4>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', lineHeight: 1.6 }}>
                Disfruta de la experiencia, atención y calidad excepcional en lavados y secados que distinguen a Abatte Peluquería.
              </p>
            </div>

            {/* 12. Afiliación digital */}
            <div className="surface-card" style={{ padding: '1.75rem', borderRadius: '20px', border: '1px solid #e2e8f0', background: 'white' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(212, 175, 55, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
                <Smartphone size={20} color="#d4af37" />
              </div>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', fontWeight: 800, color: '#09090b' }}>Afiliación 100% Digital</h4>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', lineHeight: 1.6 }}>
                Suscríbete en pocos minutos, de forma rápida, sencilla y segura, desde tu computadora o teléfono móvil estés donde estés.
              </p>
            </div>

          </div>

        </div>

        {/* Preguntas Frecuentes Accordion Section */}
        <div style={{ background: '#f8fafc', padding: '3rem', borderRadius: '24px', border: '1px solid #e2e8f0', marginTop: '4rem' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#09090b', marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <HelpCircle style={{ color: '#d4af37' }} size={22} />
            <span>Preguntas Frecuentes sobre la Membresía</span>
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '800px', margin: '0 auto' }}>
            {faqs.map((faq, index) => {
              const isExpanded = expandedIndex === index;
              return (
                <div 
                  key={index} 
                  style={{ background: 'white', borderRadius: '16px', border: '1.5px solid #e2e8f0', overflow: 'hidden', transition: 'border-color 0.2s' }}
                >
                  <button 
                    onClick={() => toggleExpand(index)}
                    style={{ width: '100%', padding: '1.25rem 1.5rem', background: 'none', border: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <span style={{ fontWeight: 800, fontSize: '0.9rem', color: '#09090b', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isExpanded ? '#d4af37' : '#94a3b8' }}></span>
                      <span>{faq.question}</span>
                    </span>
                    {isExpanded ? <ChevronUp size={16} style={{ color: '#d4af37' }} /> : <ChevronDown size={16} style={{ color: '#64748b' }} />}
                  </button>

                  {isExpanded && (
                    <div style={{ padding: '0 1.5rem 1.25rem 1.5rem', fontSize: '0.8rem', color: '#64748b', lineHeight: 1.6, borderTop: '1px solid #f1f5f9', paddingTop: '1rem', background: '#fafafa' }}>
                      {faq.answer}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlanBelleza;
