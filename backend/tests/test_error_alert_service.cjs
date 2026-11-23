'use strict';
const assert = require('assert');
const { createErrorAlertService, sanitizeText } = require('../services/error_alert.service');

(async () => {
  // 1. Secret & JWT redaction
  const dirty = 'Bearer secretToken123 eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456 {"password":"mySecret123","pin":"9999"}';
  const clean = sanitizeText(dirty);
  assert.ok(!clean.includes('secretToken123'), 'Bearer token must be redacted');
  assert.ok(!clean.includes('eyJhbGci'), 'JWT must be redacted');
  assert.ok(!clean.includes('mySecret123'), 'Password must be redacted');
  assert.ok(!clean.includes('9999'), 'PIN must be redacted');

  // 2. Deduplication, suppression count & hourly cap
  const sentEmails = [];
  const svc = createErrorAlertService(null, {
    allowInTest: true,
    cooldownMs: 60000,
    maxPerHour: 3,
    alertEmail: 'ops@etereasapp.com',
    smtpResolver: async () => ({ host: 'smtp.test', port: 587, user: 'noreply@etereasapp.com', pass: 'x', secure: false }),
    transporterFactory: () => ({
      sendMail: async (mail) => { sentEmails.push(mail); return { messageId: 'ok' }; }
    }),
  });

  const r1 = await svc.reportError({ source: 'frontend', type: 'window_error', path: '/visitas', message: 'Cannot read properties of undefined', userEmail: 'ana@salon.do' });
  assert.strictEqual(r1.sent, true);
  assert.strictEqual(sentEmails.length, 1);
  assert.strictEqual(sentEmails[0].to, 'ops@etereasapp.com');
  assert.ok(sentEmails[0].subject.includes('[FRONTEND]'));

  // Immediate duplicate must be deduplicated
  const r2 = await svc.reportError({ source: 'frontend', type: 'window_error', path: '/visitas', message: 'Cannot read properties of undefined' });
  assert.strictEqual(r2.sent, false);
  assert.strictEqual(r2.reason, 'COOLDOWN_DEDUPLICATED');
  assert.strictEqual(r2.suppressedCount, 1);

  // Distinct errors up to hourly cap
  const r3 = await svc.reportError({ source: 'backend', type: 'http_500', path: '/api/visits', message: 'DB timeout 1', statusCode: 500 });
  const r4 = await svc.reportError({ source: 'backend', type: 'http_500', path: '/api/payroll', message: 'DB timeout 2', statusCode: 500 });
  const r5 = await svc.reportError({ source: 'backend', type: 'http_500', path: '/api/clients', message: 'DB timeout 3', statusCode: 500 });
  assert.strictEqual(r3.sent, true);
  assert.strictEqual(r4.sent, true);
  assert.strictEqual(r5.sent, false);
  assert.strictEqual(r5.reason, 'HOURLY_CAP_REACHED');

  console.log('ALL ERROR ALERT SERVICE TESTS PASSED (4/4)');
})().catch((err) => {
  console.error('ERROR ALERT TEST FAILED:', err);
  process.exit(1);
});
