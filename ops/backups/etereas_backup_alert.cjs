#!/usr/bin/env node
'use strict';
/**
 * Dispatches backup alerts using Etereas existing transactional SMTP configuration
 * (backend/services/platform_email.service.js). Never prints SMTP passwords.
 * Usage: node etereas_backup_alert.cjs <LEVEL> <SUBJECT> <BODY>
 */
const nodemailer = require('nodemailer');
const { pool } = require('./db');
const { getGlobalSmtpConfig } = require('./services/platform_email.service');

(async () => {
  const [level = 'WARN', subject = 'Alerta Backup Etereas', body = ''] = process.argv.slice(2);
  const cfg = await getGlobalSmtpConfig(pool);
  const toEmail = process.env.BACKUP_ALERT_EMAIL || cfg?.fromEmail || cfg?.user;
  if (!cfg || !cfg.host || !cfg.user || !cfg.pass || !toEmail) {
    console.error(`[${new Date().toISOString()}] SMTP_NOT_CONFIGURED_FOR_BACKUP_ALERT: ${subject}`);
    process.exit(1);
  }
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: Number(cfg.port || 587),
    secure: Number(cfg.port) === 465,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  await transporter.sendMail({
    from: `"Etereas Backups" <${cfg.fromEmail || cfg.user}>`,
    to: toEmail,
    subject: `[ETEREAS BACKUP ${level}] ${subject}`,
    text: `${body}\n\nTimestamp UTC: ${new Date().toISOString()}\n`,
  });
  console.log(`[${new Date().toISOString()}] ALERT_EMAIL_SENT to=${toEmail} subject=${subject}`);
  process.exit(0);
})().catch((err) => {
  console.error(`[${new Date().toISOString()}] ALERT_EMAIL_ERROR: ${err.message}`);
  process.exit(1);
});
