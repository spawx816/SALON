/**
 * Servicio de Términos y Condiciones y Cola de Correos de Bienvenida (Etereas)
 * Gestiona versionado inmutable, hash criptográfico SHA-256, persistencia de aceptación
 * y envío idempotente y desacoplado de correos de bienvenida sin contraseñas ni tokens.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { resolveTransporterForTenant } = require('./platform_email.service');

class TermsAndWelcomeEmailService {
  constructor({ pool, baseUrl = process.env.PUBLIC_URL || 'https://staging.etereasapp.com' }) {
    this.pool = pool;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.termsDir = path.join(__dirname, '../data/terms');
    this._cache = new Map();
  }

  /**
   * Obtiene la versión solicitada de los términos o la versión por defecto
   */
  getTerms(version = 'v2026.1') {
    const cleanVersion = String(version || 'v2026.1').trim().toLowerCase().replace(/[^a-z0-9_.]/g, '');
    const filename = cleanVersion === 'v2026.1' ? 'terms_v2026_1.txt' : `terms_${cleanVersion}.txt`;
    const filePath = path.join(this.termsDir, filename);

    if (this._cache.has(cleanVersion)) {
      return this._cache.get(cleanVersion);
    }

    if (!fs.existsSync(filePath)) {
      const err = new Error(`Versión de términos "${version}" no encontrada.`);
      err.code = 'TERMS_VERSION_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const hash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');

    const result = {
      version: cleanVersion,
      title: 'Términos y Condiciones de Suscripción y Uso de Etereas',
      content,
      hash,
      downloadUrl: `${this.baseUrl}/api/public/terms/${cleanVersion}/download`
    };

    this._cache.set(cleanVersion, result);
    return result;
  }

  /**
   * Registra la aceptación explícita de términos para un tenant y usuario
   */
  async recordAcceptance({
    tenantId,
    userId,
    termsVersion = 'v2026.1',
    recurringAuthorized = false,
    acceptanceMechanism = 'checkbox_onboarding',
    ipAddress = null,
    userAgent = null,
    recipientEmail = null,
    recipientName = null,
    companyName = null,
    accountStatus = 'pending_payment'
  }) {
    if (!tenantId || !userId) {
      throw new Error('tenantId y userId son obligatorios para registrar la aceptación de términos.');
    }

    const terms = this.getTerms(termsVersion);

    // 1. Persistir aceptación inmutable
    const [res] = await this.pool.query(
      `INSERT INTO tenant_terms_acceptances 
       (tenant_id, user_id, terms_version, document_hash, accepted_at_utc, acceptance_mechanism, ip_address, user_agent, recurring_authorized)
       VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?)
       RETURNING id, tenant_id, user_id, terms_version, document_hash, accepted_at_utc, recurring_authorized`,
      [
        tenantId,
        userId,
        terms.version,
        terms.hash,
        acceptanceMechanism,
        ipAddress ? String(ipAddress).slice(0, 50) : null,
        userAgent ? String(userAgent).slice(0, 500) : null,
        Boolean(recurringAuthorized)
      ]
    );

    const acceptance = res && res[0] ? res[0] : { tenant_id: tenantId, terms_version: terms.version, document_hash: terms.hash };

    // 2. Encolar correo de bienvenida de forma idempotente
    const idempotencyKey = `welcome_${tenantId}_${terms.version}`;
    
    // Obtener datos si faltan
    let finalEmail = recipientEmail;
    let finalName = recipientName;
    let finalCompany = companyName;
    let finalStatus = accountStatus;

    if (!finalEmail || !finalCompany) {
      try {
        const [uRows] = await this.pool.query(
          `SELECT email, nombre FROM users WHERE id = ? AND tenant_id = ? LIMIT 1`,
          [userId, tenantId]
        );
        if (uRows && uRows.length > 0) {
          finalEmail = finalEmail || uRows[0].email;
          finalName = finalName || uRows[0].nombre;
        }

        const [tRows] = await this.pool.query(
          `SELECT nombre, business_name, status FROM tenants WHERE id = ? LIMIT 1`,
          [tenantId]
        );
        if (tRows && tRows.length > 0) {
          finalCompany = finalCompany || tRows[0].business_name || tRows[0].nombre;
          finalStatus = tRows[0].status || finalStatus;
        }
      } catch (lookupErr) {
        console.warn('[TERMS SERVICE] Could not query user/tenant details for welcome email:', lookupErr.message);
      }
    }

    if (finalEmail && finalCompany) {
      await this.pool.query(
        `INSERT INTO tenant_welcome_email_queue
         (tenant_id, recipient_email, recipient_name, company_name, terms_version, account_status, status, idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NOW(), NOW())
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          tenantId,
          finalEmail,
          finalName || 'Propietario',
          finalCompany,
          terms.version,
          finalStatus,
          idempotencyKey
        ]
      );

      // Disparar procesamiento asíncrono sin bloquear
      setImmediate(() => {
        this.processWelcomeQueue().catch((err) => {
          console.error('[WELCOME EMAIL QUEUE] Error procesando cola en background:', err.message);
        });
      });
    }

    return {
      success: true,
      acceptanceId: acceptance.id,
      termsVersion: terms.version,
      documentHash: terms.hash,
      acceptedAt: acceptance.accepted_at_utc || new Date().toISOString(),
      recurringAuthorized: Boolean(recurringAuthorized)
    };
  }

  /**
   * Procesa la cola de correos de bienvenida
   */
  async processWelcomeQueue(limit = 10) {
    const [rows] = await this.pool.query(
      `SELECT * FROM tenant_welcome_email_queue
       WHERE status = 'pending' OR (status = 'failed' AND attempts < 5)
       ORDER BY id ASC
       LIMIT ?`,
      [limit]
    );

    if (!rows || rows.length === 0) return { processed: 0 };

    let processedCount = 0;

    for (const item of rows) {
      try {
        const downloadUrl = `${this.baseUrl}/api/public/terms/${item.terms_version}/download`;
        const isActive = String(item.account_status).toLowerCase() === 'active';

        const subject = `Bienvenido a Etereas - Confirmación de suscripción (${item.company_name})`;
        const statusHtml = isActive
          ? `<p style="color: #166534; background: #f0fdf4; padding: 12px 16px; border-radius: 8px; border: 1px solid #bbf7d0;">
               <strong>Estado de tu cuenta: ACTIVA</strong>. Tu pago inicial ha sido verificado. Puedes comenzar a operar en tu plataforma.
             </p>`
          : `<p style="color: #854d0e; background: #fefce8; padding: 12px 16px; border-radius: 8px; border: 1px solid #fef08a;">
               <strong>Estado de tu cuenta: PENDIENTE DE PAGO</strong>. Para completar la activación, ingresa a la plataforma y realiza el pago de tu orden mediante la pasarela segura CardNet.
             </p>`;

        const html = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b; background: #ffffff;">
            <h1 style="color: #0f172a; font-size: 24px; margin-bottom: 8px;">¡Bienvenido a Etereas!</h1>
            <p style="font-size: 15px; color: #475569;">Hola <strong>${item.recipient_name || 'Propietario'}</strong>,</p>
            <p style="font-size: 15px; color: #475569;">
              Se ha completado el registro de tu empresa <strong>${item.company_name}</strong> en Etereas.
            </p>
            ${statusHtml}
            <div style="margin: 20px 0; padding: 16px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
              <h3 style="margin-top: 0; font-size: 15px; color: #0f172a;">Términos y Condiciones Aceptados</h3>
              <p style="font-size: 14px; color: #475569; margin-bottom: 8px;">
                Versión aceptada: <strong>${item.terms_version}</strong>
              </p>
              <p style="font-size: 14px; margin: 0;">
                Puedes consultar y descargar la copia íntegra de los términos en el siguiente enlace:<br />
                <a href="${downloadUrl}" style="color: #9333ea; font-weight: 600; text-decoration: underline;" target="_blank">
                  Descargar Términos y Condiciones (${item.terms_version})
                </a>
              </p>
            </div>
            <p style="font-size: 13px; color: #64748b; line-height: 1.5;">
              Por motivos de seguridad, Etereas <strong>nunca</strong> incluye contraseñas ni datos sensibles de tarjetas en sus correos electrónicos.
            </p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
            <p style="font-size: 12px; color: #94a3b8; text-align: center;">
              Etereas SRL — Plataforma integral de gestión empresarial.
            </p>
          </div>
        `;

        // Intentar enviar con nodemailer
        await this._sendEmail({
          tenantId: item.tenant_id,
          to: item.recipient_email,
          subject,
          html,
          text: `Bienvenido a Etereas (${item.company_name}). Tu cuenta está ${isActive ? 'ACTIVA' : 'PENDIENTE DE PAGO'}. Términos aceptados: ${item.terms_version}. Descarga: ${downloadUrl}`
        });

        await this.pool.query(
          `UPDATE tenant_welcome_email_queue
           SET status = 'sent', sent_at = NOW(), attempts = attempts + 1, updated_at = NOW()
           WHERE id = ?`,
          [item.id]
        );
        processedCount++;
      } catch (err) {
        console.error(`[WELCOME EMAIL QUEUE] Error enviando a ${item.recipient_email}:`, err.message);
        await this.pool.query(
          `UPDATE tenant_welcome_email_queue
           SET status = 'failed', attempts = attempts + 1, last_error = ?, updated_at = NOW()
           WHERE id = ?`,
          [err.message.slice(0, 1000), item.id]
        );
      }
    }

    return { processed: processedCount };
  }

  async _sendEmail({ tenantId, to, subject, html, text }) {
    // Si estamos en entorno de pruebas y no hay SMTP configurado, simular éxito
    if (process.env.NODE_ENV === 'test' && !process.env.SMTP_HOST) {
      return { messageId: 'test_simulated_email' };
    }

    const { transporter, fromAddress } = await resolveTransporterForTenant(this.pool, tenantId, 'Etereas');

    if (!transporter) {
      console.warn('[WELCOME EMAIL] No hay transporte SMTP configurado. Correo simulado como enviado.');
      return { messageId: 'simulated_no_smtp' };
    }

    return await transporter.sendMail({
      from: fromAddress,
      to,
      subject,
      html,
      text
    });
  }
}

module.exports = { TermsAndWelcomeEmailService };
