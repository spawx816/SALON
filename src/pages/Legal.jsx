import React from 'react';
import { useDocumentMetadata } from '../hooks/useDocumentMetadata';

const Legal = ({ page }) => {
  const getPageData = () => {
    switch (page) {
      case 'privacy':
        return {
          title: 'Política de Privacidad | Plan Beauty RD',
          description: 'Consulta cómo protegemos y administramos tus datos personales y de facturación en la plataforma de Plan Beauty RD.',
          canonical: 'https://planbeautyrd.com/politica-de-privacidad',
          h1: 'POLÍTICA DE PRIVACIDAD',
          content: (
            <>
              <p>Última actualización: 11 de julio de 2026</p>
              
              <h3>1. Información que Recopilamos</h3>
              <p>
                Recopilamos información personal necesaria para la prestación del servicio y la facturación. Esto incluye:
              </p>
              <ul>
                <li>Nombre completo</li>
                <li>Cédula de Identidad y Electoral</li>
                <li>Dirección de correo electrónico</li>
                <li>Número de teléfono</li>
                <li>Dirección física (calle, número, sector, ciudad) en República Dominicana</li>
                <li>Fecha de nacimiento</li>
              </ul>

              <h3>2. Uso de la Información</h3>
              <p>
                La información provista se utiliza exclusivamente para:
              </p>
              <ul>
                <li>Procesar tu registro de membresía y habilitarte en el sistema.</li>
                <li>Validar tu identidad en los salones afiliados.</li>
                <li>Procesar cobros recurrentes de forma segura a través de nuestro proveedor de procesamiento financiero homologado (CardNet).</li>
                <li>Enviar notificaciones operativas (facturas, recordatorios de consumo, reintentos de cobro).</li>
              </ul>

              <h3>3. Seguridad de Datos</h3>
              <p>
                Implementamos medidas de seguridad técnicas y administrativas para proteger tus datos. No almacenamos los números de tu tarjeta de crédito o débito directamente en nuestros servidores; estos son gestionados mediante tokens cifrados suministrados de forma segura por CardNet bajo estrictos estándares de cumplimiento PCI-DSS.
              </p>

              <h3>4. Derechos de la Usuaria</h3>
              <p>
                Puedes ejercer tus derechos de acceso, rectificación, cancelación u oposición sobre tus datos personales escribiendo a nuestro correo de soporte: <strong>hola@planbeautyrd.com</strong>.
              </p>
            </>
          )
        };
      case 'refunds':
        return {
          title: 'Política de Cancelación y Reembolsos | Plan Beauty RD',
          description: 'Información sobre cómo cancelar tu suscripción mensual de lavados y nuestra política de devoluciones y cargos recurrentes.',
          canonical: 'https://planbeautyrd.com/cancelacion-y-reembolsos',
          h1: 'POLÍTICA DE CANCELACIÓN Y REEMBOLSOS',
          content: (
            <>
              <p>Última actualización: 11 de julio de 2026</p>
              
              <h3>1. Renovación Automática</h3>
              <p>
                La suscripción a Plan Beauty tiene carácter mensual recurrente. El cobro de la membresía (RD$1,950 al mes) se procesará de manera automática cada 30 días calendario contados desde el día de tu pago inicial, utilizando el método de pago registrado en tu perfil.
              </p>

              <h3>2. Política de Cancelación</h3>
              <p>
                Puedes solicitar la cancelación de tu membresía en cualquier momento. Para cancelar tu membresía, debes asistir de forma presencial a cualquiera de nuestras sucursales y solicitar la cancelación directamente en recepción antes de tu próxima fecha de facturación.
              </p>
              <p>
                Una vez cancelado el plan:
              </p>
              <ul>
                <li>No se procesarán cargos futuros en tu tarjeta de crédito/débito.</li>
                <li>Podrás seguir utilizando los lavados restantes de tu ciclo de facturación vigente hasta que este finalice de forma natural.</li>
              </ul>

              <h3>3. Política de Reembolsos</h3>
              <p>
                Dado que los servicios del plan se habilitan de forma inmediata en el sistema para ser consumidos en los salones afiliados, no realizamos reembolsos de mensualidades ya cobradas, salvo en los siguientes escenarios comprobados:
              </p>
              <ul>
                <li>Cargos duplicados causados por fallos técnicos de nuestra plataforma de pago.</li>
                <li>Cobros automáticos procesados posterior a la confirmación de cancelación exitosa por parte de la cliente.</li>
              </ul>
              <p>
                Los reembolsos aprobados se procesarán directamente al mismo medio de pago utilizado para la suscripción, según los plazos establecidos por el banco emisor de tu tarjeta en República Dominicana.
              </p>
            </>
          )
        };
      case 'terms':
      default:
        return {
          title: 'Términos y Condiciones | Plan Beauty RD',
          description: 'Condiciones de uso de la plataforma de Plan Beauty y reglas de la suscripción mensual de lavados de cabello en República Dominicana.',
          canonical: 'https://planbeautyrd.com/terminos-y-condiciones',
          h1: 'TÉRMINOS Y CONDICIONES DEL SERVICIO',
          content: (
            <>
              <p>Última actualización: 11 de julio de 2026</p>
              
              <h3>1. Aceptación de los Términos</h3>
              <p>
                Al registrarte y suscribirte a Plan Beauty, aceptas de forma expresa cumplir con los presentes Términos y Condiciones, así como con nuestras políticas de privacidad y reembolsos asociadas.
              </p>

              <h3>2. Descripción del Servicio</h3>
              <p>
                Plan Beauty ofrece una membresía que otorga a la usuaria titular un límite máximo de 4 servicios de lavado y secado capilar profesional al mes por un costo fijo mensual de RD$1,950.
              </p>
              <p>
                Los servicios son provistos en las instalaciones de los salones independientes asociados a nuestra red en República Dominicana.
              </p>

              <h3>3. Reglas de Uso de la Membresía</h3>
              <ul>
                <li><strong>No Acumulación:</strong> Los 4 lavados mensuales expiran de forma definitiva al finalizar tu ciclo de facturación de 30 días. Los lavados no utilizados no se acumulan para meses posteriores.</li>
                <li><strong>Uso Personal e Intransferible:</strong> La suscripción es exclusiva de la persona registrada. Se requerirá la validación física en la recepción del salón mediante la presentación de la cédula original de la usuaria suscrita.</li>
                <li><strong>Sin Cita Previa:</strong> El servicio se brinda por orden de llegada física al establecimiento dentro de sus horarios laborales regulares. Plan Beauty no se hace responsable por tiempos de espera o saturación en horas pico del salón.</li>
                <li><strong>Largo del Cabello:</strong> La tarifa plana de RD$1,950 incluye el lavado y secado básico de cabello natural sin importar su largo.</li>
              </ul>

              <h3>4. Modificación de Condiciones</h3>
              <p>
                Plan Beauty se reserva el derecho de ajustar la tarifa mensual, las condiciones del servicio o el listado de salones de belleza afiliados. Cualquier cambio significativo en el costo será notificado vía correo electrónico con al menos 15 días de anticipación.
              </p>
            </>
          )
        };
    }
  };

  const data = getPageData();

  return (
    <div className="landing-page-content" style={{ padding: '6rem 0 4rem' }}>
      <div className="container" style={{ maxWidth: '800px', lineHeight: 1.7, color: '#475569' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 900, color: '#09090b', marginBottom: '2rem', textAlign: 'center' }}>
          {data.h1}
        </h1>
        <div className="legal-rich-text" style={{ background: 'white', border: '1px solid #e2e8f0', padding: '2.5rem', borderRadius: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.01)' }}>
          {data.content}
        </div>
      </div>
    </div>
  );
};

export default Legal;
