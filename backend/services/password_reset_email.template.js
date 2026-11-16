'use strict';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveAuthorizedPublicOrigin() {
  const candidates = [
    process.env.PUBLIC_APP_URL,
    process.env.PUBLIC_URL,
    'https://etereasapp.com',
  ];
  for (const raw of candidates) {
    if (!raw || typeof raw !== 'string') continue;
    try {
      const parsed = new URL(raw.trim());
      if (parsed.protocol === 'https:') {
        return parsed.origin;
      }
    } catch {
      // Ignore malformed URL
    }
  }
  return 'https://etereasapp.com';
}

function resolveAuthorizedAssetOrigin() {
  const raw = process.env.PUBLIC_ASSET_ORIGIN || 'https://etereasapp.com';
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol === 'https:') {
      return parsed.origin;
    }
  } catch {
    // Fallback below
  }
  return 'https://etereasapp.com';
}

function buildPasswordResetEmail({
  logoUrl = `${resolveAuthorizedAssetOrigin()}/icon-192x192.png`,
  resetUrl,
  ttlMinutes = 15,
  supportEmail = process.env.SUPPORT_EMAIL || 'soporte@etereasapp.com',
}) {
  const safeLogoUrl = escapeHtml(logoUrl);
  const safeResetUrl = escapeHtml(resetUrl);
  const safeSupport = escapeHtml(supportEmail);
  const mins = Number(ttlMinutes) || 15;

  const subject = 'Restablece tu contraseña — Etereas';

  const text = [
    'Restablece tu contraseña',
    '',
    'Recibimos una solicitud para restablecer la contraseña de tu cuenta de Etereas.',
    '',
    `Restablecer contraseña: ${resetUrl}`,
    '',
    `Este enlace es válido por ${mins} minutos.`,
    '',
    'Si no solicitaste este cambio, puedes ignorar este correo. Tu contraseña permanecerá igual.',
    'No compartas este enlace. Etereas nunca te pedirá tu contraseña por correo.',
    '',
    `Etereas · Soporte: ${supportEmail}`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Restablece tu contraseña</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;width:100%;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
          <tr>
            <td align="center" style="padding:32px 32px 16px 32px;">
              <img src="${safeLogoUrl}" alt="Etereas" width="56" height="56" style="display:block;border:0;outline:none;text-decoration:none;border-radius:12px;" />
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 32px 8px 32px;">
              <h1 style="margin:0;font-size:24px;line-height:32px;font-weight:700;color:#0f172a;">
                Restablece tu contraseña
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 32px 24px 32px;font-size:15px;line-height:24px;color:#334155;text-align:center;">
              Recibimos una solicitud para restablecer la contraseña de tu cuenta de Etereas.
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 32px 20px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="#2563eb" style="border-radius:8px;background-color:#2563eb;">
                    <a href="${safeResetUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;background-color:#2563eb;">
                      Restablecer contraseña
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 32px 20px 32px;font-size:13px;line-height:20px;color:#475569;">
              Este enlace es válido por <strong>${mins} minutos</strong>.
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 16px 32px;font-size:14px;line-height:22px;color:#475569;">
              Si no solicitaste este cambio, puedes ignorar este correo. Tu contraseña permanecerá igual.
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 20px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
                <tr>
                  <td style="padding:12px 16px;font-size:13px;line-height:20px;color:#334155;">
                    No compartas este enlace. Etereas nunca te pedirá tu contraseña por correo.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 28px 32px;font-size:12px;line-height:18px;color:#64748b;word-break:break-all;">
              Si el botón no funciona, copia y pega este enlace en tu navegador:<br />
              <a href="${safeResetUrl}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;">${safeResetUrl}</a>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px;background-color:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;line-height:18px;color:#64748b;text-align:center;">
              Etereas · Soporte: <a href="mailto:${safeSupport}" style="color:#475569;text-decoration:underline;">${safeSupport}</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}

function buildPasswordChangedEmail({
  logoUrl = `${resolveAuthorizedAssetOrigin()}/icon-192x192.png`,
  changedAtRd,
  supportEmail = process.env.SUPPORT_EMAIL || 'soporte@etereasapp.com',
}) {
  const safeLogoUrl = escapeHtml(logoUrl);
  const safeWhen = escapeHtml(changedAtRd);
  const safeSupport = escapeHtml(supportEmail);

  const subject = 'Tu contraseña de Etereas fue actualizada';
  const text = [
    'Tu contraseña de Etereas fue actualizada',
    '',
    `Confirmamos que la contraseña de tu cuenta de Etereas fue cambiada el ${changedAtRd} (hora de Santo Domingo) y se cerraron las sesiones anteriores.`,
    '',
    `Si no reconoces este cambio, contacta de inmediato a soporte: ${supportEmail}.`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Contraseña actualizada</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;width:100%;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
          <tr>
            <td align="center" style="padding:28px 32px 12px 32px;">
              <img src="${safeLogoUrl}" alt="Etereas" width="48" height="48" style="display:block;border:0;border-radius:10px;" />
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 32px;">
              <h1 style="margin:0;font-size:21px;line-height:28px;font-weight:700;color:#0f172a;">
                Contraseña actualizada
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 32px 24px 32px;font-size:15px;line-height:24px;color:#334155;">
              Confirmamos que la contraseña de tu cuenta de Etereas fue actualizada el <strong>${safeWhen}</strong> (hora de Santo Domingo) y se cerraron las sesiones anteriores por seguridad.
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px 32px;font-size:13px;line-height:20px;color:#64748b;">
              Si no reconoces esta actividad, comunícate de inmediato con soporte.
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background-color:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;line-height:18px;color:#64748b;text-align:center;">
              Etereas · Soporte: <a href="mailto:${safeSupport}" style="color:#475569;text-decoration:underline;">${safeSupport}</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}

module.exports = {
  escapeHtml,
  resolveAuthorizedPublicOrigin,
  resolveAuthorizedAssetOrigin,
  buildPasswordResetEmail,
  buildPasswordChangedEmail,
};
