import React from 'react';
import { Link } from 'react-router-dom';
import { useDocumentMetadata } from '../hooks/useDocumentMetadata';

const Legal = ({ page }) => {
  const isStagingHost =
    typeof window !== 'undefined' && window.location.hostname.startsWith('staging.');
  const baseOrigin =
    typeof window !== 'undefined' && window.location.hostname.includes('www.etereasapp.com')
      ? 'https://www.etereasapp.com'
      : 'https://etereasapp.com';

  const getPageData = () => {
    switch (page) {
      case 'privacy':
        return {
          title: 'Política de Privacidad | ETEREAS',
          description:
            'Borrador de Política de Privacidad para la plataforma SaaS multi-tenant Etereas.',
          canonical: `${baseOrigin}/politica-de-privacidad`,
          eyebrow: 'DOCUMENTO LEGAL SAAS · BORRADOR',
          h1: 'Política de Privacidad',
          subtitle: 'Tratamiento de datos en la plataforma SaaS multi-tenant Etereas.',
          content: (
            <>
              <h3>1. Alcance y separación multi-tenant</h3>
              <p>
                Etereas opera como una plataforma SaaS multi-tenant en la que cada empresa o empresa
                contratante mantiene su espacio de trabajo y su base de datos aislada por
                identificador de tenant. La presente política aplica a los datos de cuenta y
                operación gestionados dentro de la plataforma Etereas.
              </p>

              <h3>2. Datos tratados en la plataforma</h3>
              <ul>
                <li>
                  <strong>Datos de cuenta SaaS (B2B):</strong> nombre del propietario o responsable,
                  correo electrónico corporativo, teléfono de contacto, nombre comercial y RNC
                  opcional suministrado durante el registro o solicitud de acceso.
                </li>
                <li>
                  <strong>Datos operativos del tenant:</strong> catálogo de servicios e inventario
                  avanzado, registro de ventas y comprobantes fiscales, control de asistencia y
                  nómina, marketing y directorio CRM de clientes (incluidos en el Plan Principal).
                </li>
                <li>
                  <strong>Módulo adicional de Suscripciones y Membresías B2C:</strong> cuando el
                  tenant contrata este add-on independiente, también puede administrar suscripciones
                  o membresías B2C de sus clientes finales y contratos digitales asociados.
                </li>
              </ul>

              <h3>3. Seguridad y credenciales</h3>
              <p>
                El acceso se protege mediante sesiones autenticadas y contraseñas cifradas. El
                almacenamiento de tarjetas o procesamiento de pagos mediante pasarelas externas
                (como CardNet, actualmente en proceso de certificación) y los flujos de facturación
                electrónica e-CF ante la DGII quedan sujetos a su habilitación y certificación
                correspondiente.
              </p>

              <h3>4. Contacto y solicitudes</h3>
              <p>
                Para consultas sobre acceso, rectificación o eliminación de datos de tu espacio de
                trabajo, utiliza el canal oficial en la{' '}
                <Link to="/contacto">página de contacto</Link>.
              </p>
            </>
          )
        };

      case 'refunds':
        return {
          title: 'Política de Cancelación y Reembolsos | ETEREAS',
          description:
            'Borrador de Política de Cancelación y Reembolsos aplicable a la suscripción SaaS de Etereas.',
          canonical: `${baseOrigin}/cancelacion-y-reembolsos`,
          eyebrow: 'DOCUMENTO LEGAL SAAS · BORRADOR',
          h1: 'Política de Cancelación y Reembolsos',
          subtitle: 'Condiciones preliminares de suscripción y cancelación para Etereas SaaS.',
          content: (
            <>
              <h3>1. Estructura comercial vigente</h3>
              <p>
                Etereas ofrece un único Plan Principal mensual por sucursal y un módulo adicional
                independiente de Suscripciones y Membresías B2C:
              </p>
              <ul>
                <li>
                  <strong>Plan Principal:</strong> incluye POS, cajas, inventario avanzado
                  multisucursal, Clientes/CRM, asistencia, nómina, comisiones, marketing y reportes
                  DGII (606, 607, IT-1), con tarifa según configuración comercial vigente.
                </li>
                <li>
                  <strong>Add-on Suscripciones y Membresías B2C:</strong> módulo opcional e
                  independiente para planes de clientes, contratos digitales y cobros recurrentes B2C.
                </li>
              </ul>

              <h3>2. Cambio de plan y conservación de datos</h3>
              <p>
                Si una empresa desactiva el add-on de Suscripciones/Membresías B2C, los registros de
                clientes, ventas, visitas e historial operativo se conservan intactos; únicamente el
                módulo de membresías B2C y sus contratos y cobros recurrentes quedan restringidos sin
                eliminar datos históricos existentes.
              </p>

              <h3>3. Cancelación y reembolsos</h3>
              <p>
                Los plazos exactos de preaviso, ventanas de reembolso, retenciones aplicables y
                condiciones de facturación por pasarela de pagos (CardNet en proceso de
                certificación) están pendientes de definición y aprobación formal por parte del
                operador antes de su entrada en vigor comercial.
              </p>

              <h3>4. Membresías B2C de cada empresa</h3>
              <p>
                Las políticas de cancelación o reembolso de membresías B2C que una empresa con el
                add-on contratado ofrezca a sus clientas finales son definidas y administradas de
                forma independiente por cada empresa contratante.
              </p>
            </>
          )
        };

      case 'terms':
      default:
        return {
          title: 'Términos y Condiciones | ETEREAS',
          description:
            'Términos y Condiciones de Suscripción y Uso de Etereas (Versión v2026.1).',
          canonical: `${baseOrigin}/terminos-y-condiciones`,
          eyebrow: 'DOCUMENTO LEGAL SAAS · VERSIÓN v2026.1',
          h1: 'Términos y Condiciones del Servicio',
          subtitle: 'Condiciones de suscripción, licenciamiento, soporte y uso de la plataforma SaaS Etereas.',
          content: (
            <>
              <div style={{
                background: '#fef3c7',
                border: '1px solid #f59e0b',
                borderRadius: '12px',
                padding: '1rem 1.25rem',
                marginBottom: '1.75rem',
                fontSize: '0.86rem',
                color: '#92400e',
                lineHeight: 1.5
              }}>
                <strong>⚠️ DECISIÓN PENDIENTE DEL OPERADOR (INCOMPATIBILIDAD MONEDA / PERIODICIDAD):</strong>
                <p style={{ margin: '0.4rem 0 0.6rem 0' }}>
                  El documento suministrado por el operador especifica <em>cobros en dólares estadounidenses (USD)</em> y <em>ciclos de treinta (30) días naturales</em> (con eventuales 13 cargos anuales). La implementación actual de Etereas opera con <em>cobros en pesos dominicanos (DOP) convertidos mediante tasa cambiaria oficial fijada por SuperAdmin</em> y <em>periodicidad mensual de calendario</em>.
                </p>
                <p style={{ margin: 0 }}>
                  La publicación de la nueva versión comercial y su entrada en vigor legal obligatoria se mantienen <strong>pendientes de la resolución definitiva del operador</strong> sobre qué condiciones regirán.
                </p>
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '1rem',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '0.85rem 1.15rem',
                marginBottom: '1.75rem'
              }}>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Versión inmutable del documento:</div>
                  <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.92rem' }}>
                    v2026.1 · SHA-256: <code style={{ fontSize: '0.78rem', background: '#e2e8f0', padding: '2px 6px', borderRadius: '4px' }}>d5bc5be993...0fdcadf1</code>
                  </div>
                </div>
                <a
                  href="/api/public/terms/v2026.1/download"
                  download="terminos_etereas_v2026.1.txt"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    background: '#9333ea',
                    color: '#ffffff',
                    padding: '0.55rem 1rem',
                    borderRadius: '8px',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    textDecoration: 'none'
                  }}
                >
                  Descargar copia íntegra (.txt)
                </a>
              </div>

              <h3>Presentación y aceptación</h3>
              <p>
                Estos términos y condiciones regulan la contratación, el acceso y el uso de la plataforma de gestión empresarial ETEREAS, así como las condiciones de suscripción, licenciamiento, pagos recurrentes, soporte y tratamiento de información.
              </p>
              <p>
                El servicio es ofrecido por ETEREAS SRL, RNC 131917038, Registro Mercantil 156785PSD, con domicilio en Av. Los Palmeros esquina Camino Segundo, Local 1F, Plaza Galerías del Mar, Arismar, Santo Domingo Este, República Dominicana, denominada en estos términos y condiciones LA PROVEEDORA.
              </p>
              <p>
                Se denomina EL CLIENTE a la persona física o jurídica que contrata la suscripción y cuyos datos se registran durante el proceso de contratación. Cuando la suscripción se contrate en nombre de una empresa u otra entidad, la persona que complete el proceso deberá contar con facultades suficientes para representarla y aceptar estas condiciones en su nombre.
              </p>
              <p>
                Antes de confirmar la contratación, EL CLIENTE podrá consultar estos términos y las condiciones económicas de su suscripción. Su aceptación deberá realizarse expresamente mediante el mecanismo habilitado por LA PROVEEDORA. La autorización del titular de la tarjeta para realizar cargos recurrentes se recogerá de forma diferenciada.
              </p>
              <p>
                La aceptación quedará vinculada a la versión vigente en ese momento y se conservará evidencia de su fecha, hora y mecanismo de confirmación. EL CLIENTE recibirá una copia o un enlace que permita consultar y descargar la versión aceptada.
              </p>

              <h3>1. Objeto y documentos integrantes</h3>
              <p>
                Estos términos regulan la licencia de uso y el acceso por suscripción a ETEREAS, los servicios incluidos, las obligaciones de LA PROVEEDORA y EL CLIENTE, los pagos, la cancelación, el soporte, la confidencialidad y el tratamiento de información. Forman parte de las condiciones del servicio estos términos, la orden o confirmación de suscripción aceptada por EL CLIENTE y las cotizaciones de servicios adicionales expresamente aceptadas.
              </p>

              <h3>2. Licencia y alcance</h3>
              <p>
                LA PROVEEDORA concede una licencia temporal, no exclusiva y no transferible sin autorización escrita, para utilizar ETEREAS en las actividades internas de EL CLIENTE. El servicio se presta mediante acceso remoto a la plataforma. No implica venta del software, entrega del código fuente ni cesión de propiedad intelectual.
              </p>
              <p>
                Se incluyen los módulos estándar disponibles de facturación y punto de venta, recursos humanos, asistencia, comisiones, descuentos, nómina, regalías, históricos de nómina, contabilidad e inteligencia de negocios. El módulo de membresías no está incluido en la tarifa base y requiere contratación separada.
              </p>

              <h3>3. Sucursales y usuarios</h3>
              <p>
                Cada sucursal requiere una licencia de US$99 por cada período de treinta días naturales, más impuestos, e incorpora tres accesos al cupo total de la empresa. Los accesos incluidos se administrarán conjuntamente dentro de la misma empresa contratante. El administrador podrá autorizar a cada usuario a operar en una, varias o todas las localidades adquiridas. Una misma persona consumirá un solo acceso del cupo total.
              </p>

              <h3>4. Propiedad intelectual y uso permitido</h3>
              <p>
                LA PROVEEDORA declara disponer de los derechos o autorizaciones necesarios para conceder la licencia. Conserva los derechos sobre ETEREAS, marca, diseño, documentación, código y mejoras. EL CLIENTE conserva los derechos sobre la información incorporada.
              </p>

              <h3>5. Precios e impuestos</h3>
              <p>
                Los precios base son: a) US$99 por sucursal por cada período de treinta días naturales, con tres accesos; b) Cada usuario adicional a los incluidos tendrá un costo de US$30 por cada período de treinta días naturales, más impuestos legalmente aplicables. Los períodos de treinta días no equivalen a meses calendario.
              </p>

              <h3>6. Medio de pago, autorización y renovación automática</h3>
              <p>
                La suscripción se pagará por anticipado mediante cargo automático a la tarjeta registrada y autorizada, por períodos consecutivos de treinta días naturales. Los números completos de tarjeta y códigos de seguridad nunca se almacenan en ETEREAS y se gestionan exclusivamente mediante la pasarela segura oficial de CardNet.
              </p>

              <h3>Consultas sobre la versión completa</h3>
              <p>
                Para consultar el texto íntegro e inalterado de las 27 cláusulas que componen esta versión, descarga el archivo oficial mediante el botón superior o a través del endpoint de descarga segura.
              </p>
            </>
          )
        };
    }
  };

  const data = getPageData();

  useDocumentMetadata({
    title: data.title,
    description: data.description,
    canonicalUrl: data.canonical,
    robots: isStagingHost ? 'noindex, nofollow' : 'index, follow'
  });

  return (
    <section className="et-subpage">
      <div className="et-container">
        <div className="et-subpage-header">
          <p className="et-eyebrow">{data.eyebrow}</p>
          <h1>{data.h1}</h1>
          <p>{data.subtitle}</p>
        </div>

        <div className="et-subpage-card">
          <div className="et-draft-banner" role="note">
            <strong>Borrador para revisión del operador:</strong> Este texto refleja el alcance
            técnico y comercial vigente de la plataforma SaaS Etereas (Plan Principal y Add-on de
            Suscripciones/Membresías B2C). La razón social, RNC, domicilio legal, plazos de
            reembolso y cláusulas jurídicas definitivas están pendientes de aprobación formal antes
            de su publicación productiva.
          </div>

          <div className="et-legal-prose">{data.content}</div>
        </div>
      </div>
    </section>
  );
};

export default Legal;
