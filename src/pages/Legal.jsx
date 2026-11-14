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
                Etereas opera como una plataforma SaaS multi-tenant en la que cada empresa o salón
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
                  <strong>Datos operativos del tenant:</strong> catálogo de servicios e inventario,
                  registro de ventas y comprobantes fiscales, control de asistencia y nómina, y
                  directorio CRM de clientes (disponible en Plan Base y Plan Pro).
                </li>
                <li>
                  <strong>Módulos exclusivos de Plan Pro:</strong> cuando el tenant contrata el Plan
                  Pro, también puede administrar suscripciones o membresías B2C de sus clientas
                  finales, contratos digitales asociados al salón correspondiente y campañas de
                  marketing.
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
            'Borrador de Política de Cancelación y Reembolsos aplicable a suscripciones SaaS Base y Pro de Etereas.',
          canonical: `${baseOrigin}/cancelacion-y-reembolsos`,
          eyebrow: 'DOCUMENTO LEGAL SAAS · BORRADOR',
          h1: 'Política de Cancelación y Reembolsos',
          subtitle: 'Condiciones preliminares de suscripción y cancelación para planes SaaS Etereas.',
          content: (
            <>
              <h3>1. Planes SaaS disponibles</h3>
              <p>
                Etereas ofrece únicamente dos planes comerciales de suscripción mensual por sucursal:
              </p>
              <ul>
                <li>
                  <strong>Plan Base (US$49/mes por sucursal):</strong> incluye POS, cajas,
                  inventario operativo, Clientes/CRM, asistencia, nómina y reportes DGII (606, 607,
                  IT-1), con 3 usuarios incluidos por sucursal y US$15/mes por usuario adicional.
                </li>
                <li>
                  <strong>Plan Pro (US$99/mes por sucursal):</strong> incluye todo el Plan Base más
                  Membresías B2C, contratos digitales, automatizaciones de Marketing e Inventario
                  Avanzado Multisucursal, con 3 usuarios incluidos por sucursal y US$15/mes por
                  usuario adicional.
                </li>
              </ul>

              <h3>2. Cambio de plan y conservación de datos</h3>
              <p>
                En caso de cambio de Plan Pro a Plan Base, los registros de clientes, ventas,
                visitas e historial operativo se conservan intactos; los módulos exclusivos de Plan
                Pro (membresías B2C, contratos y marketing) quedan restringidos sin eliminar datos
                históricos existentes.
              </p>

              <h3>3. Cancelación y reembolsos</h3>
              <p>
                Los plazos exactos de preaviso, ventanas de reembolso, retenciones aplicables y
                condiciones de facturación por pasarela de pagos (CardNet en proceso de
                certificación) están pendientes de definición y aprobación formal por parte del
                operador antes de su entrada en vigor comercial.
              </p>

              <h3>4. Membresías B2C de cada salón</h3>
              <p>
                Las políticas de cancelación o reembolso de membresías B2C que un salón en Plan Pro
                ofrezca a sus clientas finales son definidas y administradas de forma independiente
                por cada salón contratante.
              </p>
            </>
          )
        };

      case 'terms':
      default:
        return {
          title: 'Términos y Condiciones | ETEREAS',
          description:
            'Borrador de Términos y Condiciones de uso del software SaaS empresarial Etereas (Plan Base y Plan Pro).',
          canonical: `${baseOrigin}/terminos-y-condiciones`,
          eyebrow: 'DOCUMENTO LEGAL SAAS · BORRADOR',
          h1: 'Términos y Condiciones del Servicio',
          subtitle: 'Condiciones generales de acceso y uso de la plataforma SaaS Etereas.',
          content: (
            <>
              <h3>1. Objeto del servicio</h3>
              <p>
                Etereas es una plataforma de software como servicio (SaaS) multi-tenant orientada a la
                gestión operativa de empresas y salones de belleza, integrando punto de venta,
                control de asistencia, nómina, contabilidad operativa y CRM de clientes.
              </p>

              <h3>2. Estructura de planes comerciales</h3>
              <ul>
                <li>
                  <strong>Plan Base (US$49/mes por sucursal):</strong> incluye POS, cajas
                  registradoras, inventario operativo, <strong>Clientes/CRM</strong>, control de
                  asistencia, comisiones, nómina y reportes fiscales NCF/DGII (606, 607, IT-1).
                </li>
                <li>
                  <strong>Plan Pro (US$99/mes por sucursal):</strong> incluye todo el Plan Base más{' '}
                  <strong>Membresías y suscripciones B2C</strong>, contratos digitales,{' '}
                  <strong>Marketing</strong> e Inventario Avanzado Multisucursal.
                </li>
                <li>
                  <strong>Límites por sucursal:</strong> ambos planes incluyen 3 usuarios por
                  sucursal contratada y permiten agregar usuarios adicionales por US$15/mes cada
                  uno.
                </li>
              </ul>

              <h3>3. Separación de membresías B2C por salón</h3>
              <p>
                La funcionalidad de membresías y suscripciones B2C está disponible exclusivamente en
                el <strong>Plan Pro</strong>. Cada salón contratante en Plan Pro es responsable de
                los precios, ciclos, beneficios y condiciones comerciales que establezca frente a sus
                clientas finales mediante sus propios contratos digitales.
              </p>

              <h3>4. Estado de integraciones fiscales y de pago</h3>
              <p>
                La plataforma genera comprobantes fiscales NCF y reportes 606, 607 e IT-1. La
                emisión de comprobantes electrónicos e-CF ante la DGII y el procesamiento en línea
                con pasarela CardNet se encuentran en proceso de certificación y se habilitarán
                conforme a las pruebas y homologaciones vigentes.
              </p>

              <h3>5. Identificación legal pendiente</h3>
              <p>
                La razón social, RNC, domicilio legal y jurisdicción definitiva del operador de
                Etereas se incorporarán una vez completada la revisión legal correspondiente. Para
                solicitudes comerciales o aclaraciones utiliza nuestra{' '}
                <Link to="/contacto">página de contacto</Link>.
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
            técnico y comercial vigente de la plataforma SaaS Etereas (planes Base y Pro). La razón
            social, RNC, domicilio legal, plazos de reembolso y cláusulas jurídicas definitivas están
            pendientes de aprobación formal antes de su publicación productiva.
          </div>

          <div className="et-legal-prose">{data.content}</div>
        </div>
      </div>
    </section>
  );
};

export default Legal;
