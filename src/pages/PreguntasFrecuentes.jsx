import React, { useState } from 'react';
import { useDocumentMetadata } from '../hooks/useDocumentMetadata';
import { ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';

const PreguntasFrecuentes = () => {
  useDocumentMetadata({
    title: 'Preguntas Frecuentes | Plan Beauty RD',
    description: 'Encuentra respuestas a tus dudas sobre el plan de belleza, cobro de suscripción mensual, políticas de acumulación de lavados, cancelación y cambio de salón.',
    canonicalUrl: 'https://planbeautyrd.com/preguntas-frecuentes',
    robots: 'index, follow'
  });

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

  const [expandedIndex, setExpandedIndex] = useState(null);

  const toggleExpand = (index) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  return (
    <div className="landing-page-content" style={{ padding: '6rem 0 4rem' }}>
      <div className="container" style={{ maxWidth: '800px' }}>
        
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
          <span style={{ background: 'rgba(212, 175, 55, 0.1)', color: '#d4af37', padding: '0.5rem 1rem', borderRadius: '50px', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Centro de Ayuda</span>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 900, marginTop: '1rem', color: '#09090b' }}>
            PREGUNTAS <span style={{ color: '#d4af37' }}>FRECUENTES</span>
          </h1>
          <p style={{ margin: '1rem auto 0', color: '#64748b', fontSize: '1rem', lineHeight: 1.6 }}>
            ¿Tienes alguna duda sobre el funcionamiento de tu membresía Plan Beauty? Aquí encontrarás respuestas inmediatas a las consultas más habituales.
          </p>
        </div>

        {/* Accordions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {faqs.map((faq, index) => {
            const isExpanded = expandedIndex === index;
            return (
              <div 
                key={index} 
                style={{ background: 'white', borderRadius: '16px', border: '1.5px solid #e2e8f0', overflow: 'hidden', transition: 'border-color 0.2s' }}
              >
                <button 
                  onClick={() => toggleExpand(index)}
                  style={{ width: '100%', padding: '1.5rem', background: 'none', border: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', textAlign: 'left' }}
                >
                  <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#09090b', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <HelpCircle size={18} style={{ color: isExpanded ? '#d4af37' : '#94a3b8' }} />
                    <span>{faq.question}</span>
                  </span>
                  {isExpanded ? <ChevronUp size={18} style={{ color: '#d4af37' }} /> : <ChevronDown size={18} style={{ color: '#64748b' }} />}
                </button>

                {isExpanded && (
                  <div style={{ padding: '0 1.5rem 1.5rem 1.5rem', fontSize: '0.85rem', color: '#64748b', lineHeight: 1.6, borderTop: '1px solid #f1f5f9', paddingTop: '1rem', background: '#fafafa' }}>
                    {faq.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
};

export default PreguntasFrecuentes;
