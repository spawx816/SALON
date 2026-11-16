import React from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useDocumentMetadata } from '../hooks/useDocumentMetadata';
import { TermsDocumentContent } from '../components/common/TermsDocumentContent';

function getSafeReturnPath(candidate) {
  if (typeof candidate !== 'string') return '/';
  const trimmed = candidate.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('://')) {
    return '/';
  }
  return trimmed;
}

const Legal = ({ page }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const returnPath = getSafeReturnPath(location.state?.from || searchParams.get('returnTo'));
  const requestedVersion = searchParams.get('version') || 'v2026.1';
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
            `Términos y Condiciones de Suscripción y Uso de Etereas (${requestedVersion}).`,
          canonical: `${baseOrigin}/terminos-y-condiciones`,
          eyebrow: `ETEREAS · ${requestedVersion}`,
          h1: 'Términos y Condiciones de Suscripción y Uso de Etereas',
          subtitle: 'Documento íntegro vigente de suscripción, licenciamiento y uso de la plataforma.',
          hideDraftBanner: true,
          content: <TermsDocumentContent version={requestedVersion} />
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

  const handleBack = () => {
    navigate(returnPath);
  };

  return (
    <section className="et-subpage">
      <div className="et-container">
        <div style={{ marginBottom: '1rem' }}>
          <button
            type="button"
            onClick={handleBack}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.55rem 1rem',
              borderRadius: '10px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#0f172a',
              fontWeight: 700,
              fontSize: '0.88rem',
              cursor: 'pointer'
            }}
          >
            <ArrowLeft size={16} />
            <span>Volver</span>
          </button>
        </div>

        <div className="et-subpage-header">
          <p className="et-eyebrow">{data.eyebrow}</p>
          <h1>{data.h1}</h1>
          <p>{data.subtitle}</p>
        </div>

        <div className="et-subpage-card">
          {!data.hideDraftBanner && (
            <div className="et-draft-banner" role="note">
              <strong>Borrador para revisión del operador:</strong> Este texto refleja el alcance
              técnico y comercial vigente de la plataforma SaaS Etereas (Plan Principal y Add-on de
              Suscripciones/Membresías B2C). La razón social, RNC, domicilio legal, plazos de
              reembolso y cláusulas jurídicas definitivas están pendientes de aprobación formal antes
              de su publicación productiva.
            </div>
          )}

          <div className="et-legal-prose">{data.content}</div>

          <div style={{ marginTop: '2rem', paddingTop: '1.25rem', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-start' }}>
            <button
              type="button"
              onClick={handleBack}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.6rem 1.15rem',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#0f172a',
                fontWeight: 700,
                fontSize: '0.88rem',
                cursor: 'pointer'
              }}
            >
              <ArrowLeft size={16} />
              <span>Volver</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Legal;
