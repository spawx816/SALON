const crypto = require('crypto');
const { resolveTransporterForTenant } = require('./platform_email.service');

const SAFE_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const SAFE_LOWER = 'abcdefghjkmnpqrstuvwxyz';
const SAFE_DIGITS = '23456789';
const SAFE_ALL = SAFE_UPPER + SAFE_LOWER + SAFE_DIGITS;

function pickRandomChar(alphabet) {
  return alphabet[crypto.randomInt(0, alphabet.length)];
}

/**
 * Genera una contraseña temporal segura y fácil de leer (sin caracteres ambiguos 0/O/1/I/l).
 * Formato: Etr-XXXX-XXXX
 */
function generateSecureTempPassword() {
  const block1 = [
    pickRandomChar(SAFE_DIGITS),
    pickRandomChar(SAFE_UPPER),
    pickRandomChar(SAFE_LOWER),
    pickRandomChar(SAFE_DIGITS),
  ].join('');
  const block2 = [
    pickRandomChar(SAFE_UPPER),
    pickRandomChar(SAFE_LOWER),
    pickRandomChar(SAFE_DIGITS),
    pickRandomChar(SAFE_ALL),
  ].join('');
  return `Etr-${block1}-${block2}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolvePublicAppOrigin(req) {
  const configured =
    process.env.PUBLIC_APP_URL ||
    process.env.APP_BASE_URL ||
    process.env.FRONTEND_URL ||
    '';
  if (configured && /^https?:\/\//i.test(configured.trim())) {
    return configured.trim().replace(/\/+$/, '');
  }

  const rawProto = String(req?.headers?.['x-forwarded-proto'] || req?.protocol || 'https')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const proto = rawProto === 'http' ? 'http' : 'https';
  const rawHost = String(req?.headers?.['x-forwarded-host'] || req?.get?.('host') || '')
    .split(',')[0]
    .trim();

  if (
    rawHost &&
    /^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(rawHost) &&
    !/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(rawHost)
  ) {
    return `${proto}://${rawHost}`;
  }

  if (process.env.NODE_ENV !== 'production' && rawHost && /^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(rawHost)) {
    return `${proto}://${rawHost}`;
  }

  return 'https://etereasapp.com';
}

function formatDopFromMinor(minorValue) {
  const num = Number(minorValue || 0) / 100;
  if (!Number.isFinite(num) || num <= 0) return null;
  return `RD$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Envía el correo de bienvenida (o recordatorio de pago) al cliente con el enlace de acceso
 * a la plataforma (/login), su correo, su clave temporal y las instrucciones para iniciar sesión
 * y completar el pago dentro de la aplicación.
 */
async function sendTenantWelcomeAndPaymentEmail(pool, params = {}) {
  const {
    businessName = 'Tu Empresa',
    ownerName = 'Propietario',
    ownerEmail = '',
    temporaryPassword = null,
    paymentUrl = null,
    loginUrl = 'https://etereasapp.com/login',
    orderNumber = null,
    branchesCount = 1,
    extraUsersCount = 0,
    wantsMembershipsAddon = false,
    monthlyUsd = null,
    totalMinor = null,
    currency = 'DOP',
    isLinkResendOnly = false,
  } = params;

  const targetEmail = String(ownerEmail || '').trim();
  if (!targetEmail || !targetEmail.includes('@')) {
    return { sent: false, error: 'Correo del propietario inválido.' };
  }

  if (process.env.NODE_ENV === 'test' && !process.env.SMTP_HOST) {
    return { sent: true, simulated: true, messageId: 'test_welcome_payment_email' };
  }

  try {
    const { transporter, fromAddress } = await resolveTransporterForTenant(pool, null, 'Etereas');
    if (!transporter || !fromAddress) {
      return {
        sent: false,
        error: 'El servidor SMTP global del sistema aún no está configurado en SuperAdmin → Correo del Sistema.',
      };
    }

    const branches = Math.max(1, Number(branchesCount) || 1);
    const extraUsers = Math.max(0, Number(extraUsersCount) || 0);
    const baseUsers = branches * 3;
    const totalUsers = baseUsers + extraUsers;
    const addonBlocks = wantsMembershipsAddon ? Math.max(1, Math.ceil(branches / 3)) : 0;
    const computedUsd =
      monthlyUsd !== null && Number.isFinite(Number(monthlyUsd))
        ? Number(monthlyUsd)
        : branches * 99 + extraUsers * 30 + addonBlocks * 99;
    const dopFormatted =
      String(currency || '').toUpperCase() === 'DOP' ? formatDopFromMinor(totalMinor) : null;

    const cleanBaseLoginUrl = String(loginUrl || 'https://etereasapp.com/login').split('?')[0];
    const directLoginWithEmailUrl = `${cleanBaseLoginUrl}?email=${encodeURIComponent(targetEmail)}`;

    const safeBusiness = escapeHtml(businessName);
    const safeOwner = escapeHtml(ownerName || 'Propietario');
    const safeEmail = escapeHtml(targetEmail);
    const safeTempPass = temporaryPassword ? escapeHtml(temporaryPassword) : null;
    const safeCleanLoginUrl = escapeHtml(cleanBaseLoginUrl);
    const safeDirectLoginUrl = escapeHtml(directLoginWithEmailUrl);
    const safeOrderNo = orderNumber ? escapeHtml(orderNumber) : null;
    const isPendingPayment = Boolean(paymentUrl || orderNumber || isLinkResendOnly);

    const subject = isLinkResendOnly
      ? `Recordatorio de activación — ${businessName} | Etereas`
      : `¡Bienvenido a Etereas! Tus accesos para activar ${businessName}`;

    const statusBannerHtml = isPendingPayment
      ? `
        <div style="margin: 18px 0; padding: 14px 16px; border-radius: 12px; background: #fffbeb; border: 1px solid #fde68a; color: #92400e; font-size: 13.5px; line-height: 1.5;">
          <strong>Estado de tu cuenta: Pendiente de pago.</strong><br />
          Inicia sesión con tus credenciales abajo para completar el pago seguro en CardNet y activar tu plataforma de inmediato.
        </div>
      `
      : `
        <div style="margin: 18px 0; padding: 14px 16px; border-radius: 12px; background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; font-size: 13.5px; line-height: 1.5;">
          <strong>✓ Estado de tu cuenta: Activa.</strong> Ya puedes iniciar sesión con tus credenciales y comenzar a operar.
        </div>
      `;

    const credentialsHtml = safeTempPass
      ? `
        <div style="margin: 20px 0; padding: 20px; border-radius: 14px; background: #f8fafc; border: 1.5px solid #cbd5e1;">
          <h3 style="margin: 0 0 12px; font-size: 15.5px; color: #0f172a;">Tus Datos para Iniciar Sesión</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #334155;">
            <tr>
              <td style="padding: 7px 0; color: #64748b; width: 42%;">Página de acceso:</td>
              <td style="padding: 7px 0; font-weight: 700;">
                <a href="${safeDirectLoginUrl}" style="color: #2563eb; text-decoration: none;">${safeCleanLoginUrl}</a>
              </td>
            </tr>
            <tr>
              <td style="padding: 7px 0; color: #64748b;">Correo electrónico:</td>
              <td style="padding: 7px 0; font-weight: 800; color: #0f172a;">${safeEmail}</td>
            </tr>
            <tr>
              <td style="padding: 7px 0; color: #64748b;">Clave temporal:</td>
              <td style="padding: 7px 0;">
                <code style="display: inline-block; padding: 5px 12px; border-radius: 8px; background: #ffffff; border: 1.5px solid #94a3b8; font-size: 15px; font-weight: 800; color: #0f172a; letter-spacing: 0.04em;">${safeTempPass}</code>
              </td>
            </tr>
          </table>
          <div style="margin-top: 14px; padding: 10px 12px; border-radius: 8px; background: #eff6ff; border: 1px solid #bfdbfe; font-size: 12.5px; color: #1e3a8a; line-height: 1.45;">
            🔐 <strong>Importante:</strong> Esta es una clave temporal para tu primer ingreso. Recuerda cambiarla por tu propia contraseña tan pronto entres al sistema (menú <strong>Cambiar contraseña</strong>).
          </div>
        </div>
      `
      : `
        <div style="margin: 20px 0; padding: 16px 20px; border-radius: 12px; background: #f8fafc; border: 1px solid #e2e8f0; font-size: 14px; color: #334155;">
          <strong>Tu correo de acceso:</strong> ${safeEmail}<br />
          <span style="font-size: 12.5px; color: #64748b;">Ingresa con la contraseña que recibiste en tu correo de bienvenida (o usa "¿Olvidaste tu contraseña?" en la pantalla de acceso).</span>
        </div>
      `;

    const actionCtaHtml = `
      <div style="margin: 24px 0; padding: 24px 20px; border-radius: 14px; background: #eff6ff; border: 1px solid #bfdbfe; text-align: center;">
        ${isPendingPayment ? `
          <div style="font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #1d4ed8; margin-bottom: 6px;">
            Paso final para activar tu suscripción
          </div>
          <div style="font-size: 24px; font-weight: 800; color: #0f172a; margin-bottom: 4px;">
            US$${computedUsd.toFixed(2)} <span style="font-size: 14px; font-weight: 600; color: #475569;">/ mes</span>
          </div>
          ${dopFormatted ? `<div style="font-size: 13px; color: #475569; margin-bottom: 16px;">Equivalente en pasarela local: <strong>${escapeHtml(dopFormatted)}</strong>${safeOrderNo ? ` · Orden #${safeOrderNo}` : ''}</div>` : `<div style="margin-bottom: 16px;"></div>`}
        ` : ''}
        <a href="${safeDirectLoginUrl}" target="_blank" rel="noopener noreferrer"
           style="display: inline-block; padding: 14px 28px; border-radius: 10px; background: #2563eb; color: #ffffff; font-size: 15px; font-weight: 800; text-decoration: none;">
          ${isPendingPayment ? 'Iniciar Sesión y Realizar Pago &rarr;' : 'Iniciar Sesión en Etereas &rarr;'}
        </a>
        <p style="margin: 14px 0 0; font-size: 12.5px; color: #334155; line-height: 1.5;">
          ${isPendingPayment
            ? 'Al iniciar sesión en la plataforma podrás completar el pago seguro con tu tarjeta en CardNet; tu cuenta quedará activa automáticamente y suscrita al cobro mensual.'
            : 'Haz clic en el botón para entrar a tu espacio de trabajo en Etereas.'}
        </p>
        <p style="margin: 10px 0 0; font-size: 12px; color: #64748b; word-break: break-all;">
          Enlace de la página: <a href="${safeDirectLoginUrl}" style="color: #2563eb; font-weight: 600;">${safeCleanLoginUrl}</a>
        </p>
      </div>
    `;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; color: #0f172a;">
        <div style="background: #0f172a; padding: 20px 26px;">
          <span style="font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.03em;">etereas<span style="color: #3b82f6;">.</span></span>
        </div>
        <div style="padding: 26px;">
          <h1 style="margin: 0 0 10px; font-size: 21px; font-weight: 800; color: #0f172a;">
            ¡Bienvenido a Etereas, ${safeOwner}!
          </h1>
          <p style="margin: 0; font-size: 14.5px; color: #475569; line-height: 1.6;">
            ${isLinkResendOnly
              ? `Te recordamos que tu empresa <strong>${safeBusiness}</strong> está lista en <strong>Etereas</strong> para completar su pago de activación.`
              : `Hemos creado el perfil de tu empresa <strong>${safeBusiness}</strong> en <strong>Etereas</strong>. Aquí tienes tus accesos para ingresar a la plataforma y completar tu activación.`}
          </p>

          ${statusBannerHtml}
          ${credentialsHtml}
          ${actionCtaHtml}

          <div style="margin: 20px 0 0; padding: 16px 20px; border-radius: 12px; background: #ffffff; border: 1px solid #e2e8f0;">
            <h3 style="margin: 0 0 10px; font-size: 14.5px; color: #0f172a;">Resumen de tu Plan</h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 13.5px; color: #334155;">
              <tr>
                <td style="padding: 5px 0; color: #64748b;">Empresa:</td>
                <td style="padding: 5px 0; font-weight: 700; text-align: right;">${safeBusiness}</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #64748b;">Plan comercial:</td>
                <td style="padding: 5px 0; font-weight: 700; text-align: right;">Plan Principal (US$99/sucursal)</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #64748b;">Sucursales licenciadas:</td>
                <td style="padding: 5px 0; font-weight: 700; text-align: right;">${branches} (${baseUsers} usuarios incluidos)</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #64748b;">Usuarios adicionales:</td>
                <td style="padding: 5px 0; font-weight: 700; text-align: right;">${extraUsers} (${totalUsers} usuarios totales)</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #64748b;">Módulo Membresías B2C:</td>
                <td style="padding: 5px 0; font-weight: 700; text-align: right;">${wantsMembershipsAddon ? `Incluido (${addonBlocks} bloque${addonBlocks === 1 ? '' : 's'})` : 'No incluido'}</td>
              </tr>
              <tr style="border-top: 1px solid #e2e8f0;">
                <td style="padding: 9px 0 2px; font-weight: 800; color: #0f172a;">Mensualidad total:</td>
                <td style="padding: 9px 0 2px; font-weight: 800; color: #0f172a; text-align: right;">US$${computedUsd.toFixed(2)}/mes</td>
              </tr>
            </table>
          </div>

          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0 16px;" />
          <p style="margin: 0; font-size: 12px; color: #94a3b8; text-align: center; line-height: 1.5;">
            Etereas — Plataforma integral de gestión empresarial.<br />
            Si necesitas asistencia, responde a este correo o escríbenos por soporte.
          </p>
        </div>
      </div>
    `;

    const textLines = [
      `¡Bienvenido a Etereas, ${ownerName || 'Propietario'}!`,
      '',
      isPendingPayment
        ? `Tu empresa ${businessName} fue registrada y se encuentra PENDIENTE DE PAGO.`
        : `Tu empresa ${businessName} fue registrada y se encuentra ACTIVA.`,
      '',
      `PÁGINA PARA INICIAR SESIÓN: ${directLoginWithEmailUrl}`,
      `CORREO ELECTRÓNICO: ${targetEmail}`,
      temporaryPassword ? `CLAVE TEMPORAL: ${temporaryPassword} (recuerda cambiarla desde que entres)` : null,
      '',
      isPendingPayment
        ? 'Ingresa con tu correo y tu clave temporal para realizar el pago seguro con CardNet dentro de la aplicación y activar tu cuenta automáticamente.'
        : null,
      `Resumen del plan: ${branches} sucursal(es), ${extraUsers} usuario(s) extra, Membresías B2C: ${wantsMembershipsAddon ? 'Sí' : 'No'} — Total: US$${computedUsd.toFixed(2)}/mes${dopFormatted ? ` (${dopFormatted})` : ''}.`,
    ].filter((l) => l !== null);

    const info = await transporter.sendMail({
      from: fromAddress,
      to: targetEmail,
      subject,
      text: textLines.join('\n'),
      html,
    });

    return {
      sent: true,
      messageId: info?.messageId || null,
    };
  } catch (err) {
    console.error('[SAAS ONBOARDING EMAIL ERROR]:', err.message);
    return {
      sent: false,
      error: err.message || 'No se pudo enviar el correo de bienvenida.',
    };
  }
}

module.exports = {
  generateSecureTempPassword,
  resolvePublicAppOrigin,
  sendTenantWelcomeAndPaymentEmail,
};
