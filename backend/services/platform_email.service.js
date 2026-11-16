const crypto = require('crypto');
const nodemailer = require('nodemailer');

const AAD_CONTEXT = Buffer.from('platform_email_settings:smtp_pass', 'utf8');

function deriveMasterKey() {
  const rawKey = process.env.SMTP_ENCRYPTION_KEY || process.env.STORAGE_ENCRYPTION_KEY;
  if (rawKey && typeof rawKey === 'string' && rawKey.trim().length > 0) {
    const trimmed = rawKey.trim();
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      return Buffer.from(trimmed, 'hex');
    }
    if (trimmed.length === 32) {
      return Buffer.from(trimmed, 'utf8');
    }
    return crypto.createHash('sha256').update(trimmed).digest();
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL SECURITY DEFENSE: STORAGE_ENCRYPTION_KEY/SMTP_ENCRYPTION_KEY missing in production.');
  }
  return crypto.createHash('sha256').update('salonpro-dev-storage-secret-key-32b').digest();
}

function encryptSmtpSecret(plaintext) {
  const key = deriveMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD_CONTEXT);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

function decryptSmtpSecret(encryptedHex, ivHex, tagHex) {
  const key = deriveMasterKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAAD(AAD_CONTEXT);
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function isPlaceholderPassword(val) {
  if (typeof val !== 'string') return true;
  const trimmed = val.trim();
  if (!trimmed) return true;
  return /^[*•·]+$/.test(trimmed);
}

async function getGlobalEmailMetadata(pool) {
  const [rows] = await pool.query(
    `SELECT smtp_host, smtp_port, smtp_user, smtp_from, smtp_secure,
            (smtp_pass_encrypted IS NOT NULL AND smtp_pass_encrypted <> '') AS has_password,
            updated_at, updated_by_email
     FROM platform_email_settings
     WHERE id = 1
     LIMIT 1`
  );
  if (!rows || rows.length === 0) {
    return {
      smtp_host: '',
      smtp_port: 587,
      smtp_user: '',
      smtp_pass: '',
      smtp_from: 'Etereas',
      smtp_secure: false,
      has_password: false,
      updated_at: null,
      updated_by_email: null,
    };
  }
  const row = rows[0];
  return {
    smtp_host: row.smtp_host || '',
    smtp_port: Number(row.smtp_port) || 587,
    smtp_user: row.smtp_user || '',
    smtp_pass: '',
    smtp_from: row.smtp_from || 'Etereas',
    smtp_secure: Boolean(row.smtp_secure),
    has_password: Boolean(row.has_password),
    updated_at: row.updated_at || null,
    updated_by_email: row.updated_by_email || null,
  };
}

async function upsertGlobalEmailSettings(pool, payload, actor = {}) {
  const cleanHost = String(payload?.smtp_host || '').trim();
  const cleanUser = String(payload?.smtp_user || '').trim();
  const cleanFrom = String(payload?.smtp_from || 'Etereas').trim() || 'Etereas';
  const parsedPort = parseInt(payload?.smtp_port, 10) || 587;
  const secureFlag = Boolean(payload?.smtp_secure);

  if (!cleanHost || !cleanUser) {
    const err = new Error('Servidor SMTP y usuario/correo son obligatorios.');
    err.statusCode = 400;
    throw err;
  }
  if (parsedPort < 1 || parsedPort > 65535) {
    const err = new Error('Puerto SMTP inválido (debe estar entre 1 y 65535).');
    err.statusCode = 400;
    throw err;
  }

  const [existingRows] = await pool.query(
    'SELECT smtp_pass_encrypted, smtp_pass_iv, smtp_pass_tag FROM platform_email_settings WHERE id = 1 LIMIT 1'
  );
  const existing = existingRows?.[0] || null;

  let secretBundle;
  if (!isPlaceholderPassword(payload?.smtp_pass)) {
    secretBundle = encryptSmtpSecret(payload.smtp_pass.trim());
  } else if (existing && existing.smtp_pass_encrypted && existing.smtp_pass_iv && existing.smtp_pass_tag) {
    secretBundle = {
      encrypted: existing.smtp_pass_encrypted,
      iv: existing.smtp_pass_iv,
      tag: existing.smtp_pass_tag,
    };
  } else {
    const err = new Error('La contraseña SMTP es obligatoria.');
    err.statusCode = 400;
    throw err;
  }

  const actorId = actor.userId ? String(actor.userId) : null;
  const actorEmail = actor.email ? String(actor.email) : null;

  await pool.query(
    `INSERT INTO platform_email_settings (
       id, smtp_host, smtp_port, smtp_user,
       smtp_pass_encrypted, smtp_pass_iv, smtp_pass_tag,
       smtp_from, smtp_secure, updated_by_user_id, updated_by_email,
       created_at, updated_at
     ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       smtp_host = EXCLUDED.smtp_host,
       smtp_port = EXCLUDED.smtp_port,
       smtp_user = EXCLUDED.smtp_user,
       smtp_pass_encrypted = EXCLUDED.smtp_pass_encrypted,
       smtp_pass_iv = EXCLUDED.smtp_pass_iv,
       smtp_pass_tag = EXCLUDED.smtp_pass_tag,
       smtp_from = EXCLUDED.smtp_from,
       smtp_secure = EXCLUDED.smtp_secure,
       updated_by_user_id = EXCLUDED.updated_by_user_id,
       updated_by_email = EXCLUDED.updated_by_email,
       updated_at = NOW()`,
    [
      cleanHost,
      parsedPort,
      cleanUser,
      secretBundle.encrypted,
      secretBundle.iv,
      secretBundle.tag,
      cleanFrom,
      secureFlag,
      actorId,
      actorEmail,
    ]
  );

  // Audit change without logging any secret
  try {
    await pool.query(
      `INSERT INTO security_audit_logs (tenant_id, user_id, action, details, ip_address, created_at)
       VALUES (NULL, ?, 'PLATFORM_SMTP_UPDATED', ?, ?, NOW())`,
      [
        actorId,
        JSON.stringify({
          smtp_host: cleanHost,
          smtp_port: parsedPort,
          smtp_user: cleanUser,
          smtp_from: cleanFrom,
          smtp_secure: secureFlag,
          password_changed: !isPlaceholderPassword(payload?.smtp_pass),
        }),
        actor.ip || null,
      ]
    );
  } catch {
    // Non-blocking audit log
  }

  return getGlobalEmailMetadata(pool);
}

async function getGlobalSmtpConfig(pool) {
  const [rows] = await pool.query(
    `SELECT smtp_host, smtp_port, smtp_user, smtp_pass_encrypted, smtp_pass_iv, smtp_pass_tag, smtp_from, smtp_secure
     FROM platform_email_settings
     WHERE id = 1
     LIMIT 1`
  );
  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  if (!row.smtp_host || !row.smtp_user || !row.smtp_pass_encrypted) return null;
  const pass = decryptSmtpSecret(row.smtp_pass_encrypted, row.smtp_pass_iv, row.smtp_pass_tag);
  return {
    host: row.smtp_host,
    port: Number(row.smtp_port) || 587,
    user: row.smtp_user,
    pass,
    fromName: row.smtp_from || 'Etereas',
    secure: Number(row.smtp_port) === 465 || Boolean(row.smtp_secure),
  };
}

async function resolveTransporterForTenant(pool, tenantId, defaultFromName = 'Etereas') {
  // 1. Tenant-owned SMTP has priority when configured
  if (tenantId) {
    const [tenantRows] = await pool.query(
      'SELECT smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure FROM email_settings WHERE tenant_id = ? LIMIT 1',
      [tenantId]
    );
    if (tenantRows && tenantRows.length > 0 && tenantRows[0].smtp_host && tenantRows[0].smtp_user && tenantRows[0].smtp_pass) {
      const s = tenantRows[0];
      const port = parseInt(s.smtp_port, 10) || 587;
      return {
        source: 'tenant',
        fromAddress: `"${s.smtp_from || defaultFromName}" <${s.smtp_user}>`,
        transporter: nodemailer.createTransport({
          host: s.smtp_host,
          port,
          secure: port === 465 || s.smtp_secure === 1 || s.smtp_secure === true,
          auth: { user: s.smtp_user, pass: s.smtp_pass },
          tls: { rejectUnauthorized: false },
        }),
      };
    }
  }

  // 2. Global platform SMTP from platform_email_settings
  const globalCfg = await getGlobalSmtpConfig(pool);
  if (globalCfg) {
    return {
      source: 'platform',
      fromAddress: `"${globalCfg.fromName || defaultFromName}" <${globalCfg.user}>`,
      transporter: nodemailer.createTransport({
        host: globalCfg.host,
        port: globalCfg.port,
        secure: globalCfg.secure,
        auth: { user: globalCfg.user, pass: globalCfg.pass },
        tls: { rejectUnauthorized: false },
      }),
    };
  }

  // 3. Environment variable fallback
  if (process.env.SMTP_HOST) {
    const port = parseInt(process.env.SMTP_PORT, 10) || 587;
    return {
      source: 'env',
      fromAddress: process.env.SMTP_FROM || `"${defaultFromName}" <notificaciones@etereas.com>`,
      transporter: nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: process.env.SMTP_SECURE === 'true' || port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        tls: { rejectUnauthorized: false },
      }),
    };
  }

  return { source: null, fromAddress: null, transporter: null };
}

module.exports = {
  encryptSmtpSecret,
  decryptSmtpSecret,
  isPlaceholderPassword,
  getGlobalEmailMetadata,
  upsertGlobalEmailSettings,
  getGlobalSmtpConfig,
  resolveTransporterForTenant,
};
