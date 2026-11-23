'use strict';

const nodemailer = require('nodemailer');
const { getGlobalSmtpConfig } = require('./platform_email.service');

const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes per identical error fingerprint
const DEFAULT_MAX_PER_HOUR = 20;

function sanitizeText(input, maxLen = 2000) {
  if (input === null || input === undefined) return '';
  let text = String(input);
  // Redact JWTs, Bearer tokens, hex/base64 long secrets, passwords in query/json
  text = text.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
  text = text.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]');
  text = text.replace(/("(?:password|pass|token|secret|pin|authorization|cookie|card_token|cvv|private_key)"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2');
  text = text.replace(/((?:password|token|secret|pin)=)[^&\s]+/gi, '$1[REDACTED]');
  if (text.length > maxLen) {
    text = `${text.slice(0, maxLen)}\n... [truncated]`;
  }
  return text;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function createErrorAlertService(pool, options = {}) {
  const cooldownMs = Number(options.cooldownMs || process.env.ERROR_ALERT_COOLDOWN_MS || DEFAULT_COOLDOWN_MS);
  const maxPerHour = Number(options.maxPerHour || process.env.ERROR_ALERT_MAX_PER_HOUR || DEFAULT_MAX_PER_HOUR);
  const transporterFactory = options.transporterFactory || ((cfg) => nodemailer.createTransport({
    host: cfg.host,
    port: Number(cfg.port || 587),
    secure: Boolean(cfg.secure),
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 12000,
  }));
  const smtpResolver = options.smtpResolver || (() => getGlobalSmtpConfig(pool));

  const fingerprintMap = new Map(); // fp -> { lastSentAt, suppressedCount }
  let hourWindowStart = Date.now();
  let sentInCurrentHour = 0;

  function buildFingerprint(payload) {
    const src = String(payload.source || 'unknown').toLowerCase();
    const type = String(payload.type || 'error').toLowerCase();
    const path = String(payload.path || payload.url || '').split('?')[0].slice(0, 120);
    const msg = sanitizeText(payload.message || '', 120);
    return `${src}|${type}|${path}|${msg}`;
  }

  async function reportError(rawPayload = {}) {
    try {
      // Never send real alert emails during automated unit/integration test runs unless explicitly overridden
      if (process.env.NODE_ENV === 'test' && !options.allowInTest) {
        return { sent: false, reason: 'TEST_ENV_SUPPRESSED' };
      }

      const now = Date.now();
      if (now - hourWindowStart >= 60 * 60 * 1000) {
        hourWindowStart = now;
        sentInCurrentHour = 0;
      }

      const fp = buildFingerprint(rawPayload);
      const entry = fingerprintMap.get(fp);
      if (entry && (now - entry.lastSentAt) < cooldownMs) {
        entry.suppressedCount += 1;
        return { sent: false, reason: 'COOLDOWN_DEDUPLICATED', suppressedCount: entry.suppressedCount };
      }

      if (sentInCurrentHour >= maxPerHour) {
        return { sent: false, reason: 'HOURLY_CAP_REACHED' };
      }

      const smtpCfg = await smtpResolver();
      const recipients = String(
        options.alertEmail ||
        process.env.ERROR_ALERT_EMAIL ||
        process.env.BACKUP_ALERT_EMAIL ||
        smtpCfg?.user ||
        ''
      ).trim();

      if (!smtpCfg || !smtpCfg.host || !smtpCfg.user || !smtpCfg.pass || !recipients) {
        return { sent: false, reason: 'SMTP_OR_RECIPIENT_NOT_CONFIGURED' };
      }

      const priorSuppressed = entry ? entry.suppressedCount : 0;
      fingerprintMap.set(fp, { lastSentAt: now, suppressedCount: 0 });
      // Bound map size to prevent unbounded memory growth
      if (fingerprintMap.size > 500) {
        const firstKey = fingerprintMap.keys().next().value;
        fingerprintMap.delete(firstKey);
      }

      const envName = String(process.env.NODE_ENV || 'development').toUpperCase();
      const source = String(rawPayload.source || 'backend').toUpperCase();
      const type = sanitizeText(rawPayload.type || 'UNHANDLED_ERROR', 80);
      const errorId = sanitizeText(rawPayload.errorId || `ERR-${now.toString(36).toUpperCase()}`, 64);
      const message = sanitizeText(rawPayload.message || 'Error sin mensaje', 600);
      const stack = sanitizeText(rawPayload.stack || '', 2500);
      const componentStack = sanitizeText(rawPayload.componentStack || '', 1200);
      const urlOrPath = sanitizeText(rawPayload.url || rawPayload.path || 'N/A', 300);
      const method = sanitizeText(rawPayload.method || '', 16);
      const statusCode = rawPayload.statusCode ? Number(rawPayload.statusCode) : null;
      const tenantId = sanitizeText(rawPayload.tenantId || 'N/A', 64);
      const userEmail = sanitizeText(rawPayload.userEmail || 'Anónimo', 120);
      const userRole = sanitizeText(rawPayload.userRole || 'N/A', 40);
      const userAgent = sanitizeText(rawPayload.userAgent || '', 220);
      const timeDO = new Date(now).toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' });
      const timeUTC = new Date(now).toISOString();

      const subject = `[ETEREAS ${envName}][${source}] ${type}: ${message.slice(0, 90)}`;
      const extraRepeatNote = priorSuppressed > 0
        ? `\nRepeticiones agrupadas desde la última alerta: +${priorSuppressed}\n`
        : '';

      const textBody = [
        `Alerta automática de error en Etereas (${envName})`,
        `==================================================`,
        `ID Error:      ${errorId}`,
        `Origen:        ${source} (${type})`,
        `Fecha (RD):    ${timeDO}`,
        `Fecha (UTC):   ${timeUTC}`,
        `Ruta / URL:    ${method ? `${method} ` : ''}${urlOrPath}${statusCode ? ` [HTTP ${statusCode}]` : ''}`,
        `Empresa ID:    ${tenantId}`,
        `Usuario:       ${userEmail} (Rol: ${userRole})`,
        userAgent ? `Navegador:     ${userAgent}` : null,
        extraRepeatNote.trim() || null,
        ``,
        `Mensaje:`,
        message,
        stack ? `\nStack Trace:\n${stack}` : null,
        componentStack ? `\nComponent Stack:\n${componentStack}` : null,
      ].filter(Boolean).join('\n');

      const htmlBody = `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:680px;margin:0 auto;color:#0f172a;">
          <div style="background:#991b1b;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0;">
            <div style="font-size:12px;opacity:.85;letter-spacing:.04em;">ETEREAS ${escapeHtml(envName)} · ALERTA DE ERROR (${escapeHtml(source)})</div>
            <h2 style="margin:6px 0 0;font-size:18px;">${escapeHtml(type)}</h2>
          </div>
          <div style="border:1px solid #e2e8f0;border-top:none;padding:20px;border-radius:0 0 10px 10px;background:#ffffff;">
            <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
              <tr><td style="padding:4px 8px;color:#64748b;width:130px;">ID Error</td><td style="padding:4px 8px;font-family:monospace;font-weight:700;">${escapeHtml(errorId)}</td></tr>
              <tr><td style="padding:4px 8px;color:#64748b;">Fecha (RD)</td><td style="padding:4px 8px;">${escapeHtml(timeDO)} <span style="color:#94a3b8;">(${escapeHtml(timeUTC)})</span></td></tr>
              <tr><td style="padding:4px 8px;color:#64748b;">Ruta / URL</td><td style="padding:4px 8px;font-family:monospace;">${escapeHtml(method ? `${method} ` : '')}${escapeHtml(urlOrPath)}${statusCode ? ` <strong>[HTTP ${statusCode}]</strong>` : ''}</td></tr>
              <tr><td style="padding:4px 8px;color:#64748b;">Usuario</td><td style="padding:4px 8px;">${escapeHtml(userEmail)} (Rol: ${escapeHtml(userRole)})</td></tr>
              <tr><td style="padding:4px 8px;color:#64748b;">Empresa ID</td><td style="padding:4px 8px;font-family:monospace;">${escapeHtml(tenantId)}</td></tr>
              ${userAgent ? `<tr><td style="padding:4px 8px;color:#64748b;">Navegador</td><td style="padding:4px 8px;font-size:12px;">${escapeHtml(userAgent)}</td></tr>` : ''}
              ${priorSuppressed > 0 ? `<tr><td style="padding:4px 8px;color:#b45309;">Repeticiones</td><td style="padding:4px 8px;color:#b45309;font-weight:700;">+${priorSuppressed} ocurrencias agrupadas</td></tr>` : ''}
            </table>
            <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-bottom:14px;">
              <div style="font-size:11px;font-weight:700;color:#991b1b;text-transform:uppercase;margin-bottom:4px;">Mensaje</div>
              <div style="font-family:monospace;font-size:13px;white-space:pre-wrap;word-break:break-word;">${escapeHtml(message)}</div>
            </div>
            ${stack ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:12px;"><div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;margin-bottom:4px;">Stack Trace</div><pre style="margin:0;font-size:11px;white-space:pre-wrap;word-break:break-word;color:#334155;">${escapeHtml(stack)}</pre></div>` : ''}
            ${componentStack ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;"><div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;margin-bottom:4px;">React Component Stack</div><pre style="margin:0;font-size:11px;white-space:pre-wrap;word-break:break-word;color:#334155;">${escapeHtml(componentStack)}</pre></div>` : ''}
          </div>
        </div>
      `;

      const transporter = transporterFactory(smtpCfg);
      await transporter.sendMail({
        from: `"${smtpCfg.fromName || 'Etereas Alertas'}" <${smtpCfg.user}>`,
        to: recipients,
        subject,
        text: textBody,
        html: htmlBody,
      });

      sentInCurrentHour += 1;
      return { sent: true, errorId, recipients, priorSuppressed };
    } catch (err) {
      // Never throw or break user request flow if alerting fails
      console.error('[ERROR_ALERT_DISPATCH_FAILED]:', err?.message || err);
      return { sent: false, reason: 'DISPATCH_FAILED', error: err?.message };
    }
  }

  return { reportError, sanitizeText };
}

module.exports = { createErrorAlertService, sanitizeText };
