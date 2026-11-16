'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_must_be_at_least_32_characters_long_for_security';
process.env.PUBLIC_APP_URL = 'https://etereasapp.com';
process.env.PUBLIC_ASSET_ORIGIN = 'https://etereasapp.com';
process.env.PASSWORD_RESET_TTL_MINUTES = '15';

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { createAuthRouter } = require('../routes/auth.routes');
const { buildPasswordResetEmail, buildPasswordChangedEmail } = require('../services/password_reset_email.template');
const { InMemoryDbMock } = require('./helpers/in_memory_db_mock.cjs');

async function callJson(server, method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : {} });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('🔐 Iniciando pruebas de Recuperación de Contraseña (Enlace Seguro & Plantilla)...\n');

  // 1. Validar plantilla HTML, texto plano, escape XSS y ausencia de tracking/scripts
  const sampleMail = buildPasswordResetEmail({
    logoUrl: 'https://etereasapp.com/icon-192x192.png',
    resetUrl: 'https://etereasapp.com/restablecer-contrasena?token=abc123&x=<script>alert(1)</script>',
    ttlMinutes: 15,
    supportEmail: 'soporte@etereasapp.com',
  });
  assert(sampleMail.html.includes('Restablece tu contraseña'));
  assert(sampleMail.html.includes('Recibimos una solicitud para restablecer la contraseña de tu cuenta de Etereas.'));
  assert(sampleMail.html.includes('#2563eb'));
  assert(sampleMail.html.includes('https://etereasapp.com/icon-192x192.png'));
  assert(!sampleMail.html.includes('staging.etereasapp.com'));
  assert(!sampleMail.html.includes('<script>'));
  assert(!sampleMail.html.includes('<form'));
  assert(sampleMail.html.includes('&lt;script&gt;'));
  assert(sampleMail.text.includes('Restablece tu contraseña'));
  assert(sampleMail.text.includes('15 minutos'));

  const changedMail = buildPasswordChangedEmail({ changedAtRd: '16/11/2026 11:50 a. m.' });
  assert(!changedMail.html.includes('NewSecret123!'));
  console.log('  ✅ 1. Plantilla HTML/texto plano, escape XSS, logo público y sin scripts/tracking verificados.');

  // 2. Configurar mock DB atómico para verification_codes y users
  const pool = new InMemoryDbMock();
  pool.tables.tenants = [{ id: 't-1', status: 'active', business_name: 'Salon Demo' }];
  pool.tables.users = [
    { id: 'u-1', tenant_id: 't-1', email: 'owner@salon.com', username: 'owner@salon.com', nombre: 'Ana', role: 'owner', status: 'active', token_version: 1, password_hash: 'old' },
  ];
  pool.tables.verification_codes = [];

  const origQuery = pool.query.bind(pool);
  pool.query = async (sql, params = []) => {
    const norm = String(sql).replace(/\s+/g, ' ').trim();
    // Atomic UPDATE ... RETURNING for password_reset_link
    if (/^UPDATE verification_codes SET is_used = 1, used_at = NOW\(\) WHERE code_hash = \? AND purpose = 'password_reset_link' AND is_used = 0 AND expires_at > NOW\(\) RETURNING/i.test(norm)) {
      const hash = params[0];
      const now = Date.now();
      const row = pool.tables.verification_codes.find(
        (r) => r.code_hash === hash && r.purpose === 'password_reset_link' && r.is_used === 0 && new Date(r.expires_at).getTime() > now
      );
      if (!row) return [[]];
      row.is_used = 1;
      row.used_at = new Date().toISOString();
      return [[{ ...row }]];
    }
    if (/SELECT id FROM verification_codes WHERE code_hash = \? AND purpose = 'password_reset_link' AND is_used = 0 AND expires_at > NOW\(\)/i.test(norm)) {
      const hash = params[0];
      const now = Date.now();
      const row = pool.tables.verification_codes.find(
        (r) => r.code_hash === hash && r.purpose === 'password_reset_link' && r.is_used === 0 && new Date(r.expires_at).getTime() > now
      );
      return [row ? [{ id: row.id }] : []];
    }
    if (/UPDATE verification_codes SET is_used = 1 WHERE/i.test(norm)) {
      const targetId = params[params.length - 1];
      pool.tables.verification_codes
        .filter((r) => (r.user_id === targetId || r.client_id === targetId) && r.is_used === 0)
        .forEach((r) => { r.is_used = 1; });
      return [{ affectedRows: 1 }];
    }
    if (/^INSERT INTO verification_codes/i.test(norm)) {
      const [tenant_id, user_id, client_id, identity, purpose, channel, code_hash, expires_at] = params;
      pool.tables.verification_codes.push({
        id: pool.tables.verification_codes.length + 1,
        tenant_id,
        user_id,
        client_id,
        identity,
        purpose,
        channel,
        code: null,
        code_hash,
        attempts: 0,
        max_attempts: 5,
        expires_at,
        is_used: 0,
      });
      return [{ insertId: pool.tables.verification_codes.length }];
    }
    if (/^UPDATE users SET password_hash = \?, password = NULL, token_version = COALESCE\(token_version, 1\) \+ 1/i.test(norm)) {
      const [hash, uid] = params;
      const u = pool.tables.users.find((x) => String(x.id) === String(uid));
      if (u) {
        u.password_hash = hash;
        u.password = null;
        u.token_version = (u.token_version || 1) + 1;
      }
      return [{ affectedRows: u ? 1 : 0 }];
    }
    return origQuery(sql, params);
  };

  const app = express();
  app.use(express.json());
  app.use('/api', createAuthRouter(pool));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    // 2. Anti-enumeración y Host spoofing ignorado
    const reqExist = await callJson(server, 'POST', '/api/auth/forgot-password', { emailOrCedula: 'owner@salon.com' }, { Host: 'evil-attacker.com' });
    const reqNonExist = await callJson(server, 'POST', '/api/auth/forgot-password', { emailOrCedula: 'nope@salon.com' });
    assert.strictEqual(reqExist.status, 200);
    assert.strictEqual(reqNonExist.status, 200);
    assert.strictEqual(reqExist.body.message, reqNonExist.body.message);
    assert.strictEqual(pool.tables.verification_codes.length, 1);
    assert.strictEqual(pool.tables.verification_codes[0].code, null);
    assert.strictEqual(pool.tables.verification_codes[0].code_hash.length, 64);

    // 3. Nueva solicitud invalida token anterior
    await callJson(server, 'POST', '/api/auth/forgot-password', { emailOrCedula: 'owner@salon.com' });
    assert.strictEqual(pool.tables.verification_codes[0].is_used, 1, 'Token anterior debe invalidarse');
    assert.strictEqual(pool.tables.verification_codes[1].is_used, 0);
    console.log('  ✅ 2. Anti-enumeración, hash-only e invalidación de tokens previos verificados.');

    // 4. Provisionar token conocido para probar GET sin consumo, expiración, concurrencia y revocación de sesión
    const validRawToken = crypto.randomBytes(32).toString('hex');
    const validHash = crypto.createHash('sha256').update(validRawToken).digest('hex');
    pool.tables.verification_codes.push({
      id: 99,
      tenant_id: 't-1',
      user_id: 'USER-u-1',
      client_id: 'USER-u-1',
      identity: 'owner@salon.com',
      purpose: 'password_reset_link',
      channel: 'email',
      code: null,
      code_hash: validHash,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      is_used: 0,
    });

    // GET validate dos veces NO consume el token y devuelve Referrer-Policy: no-referrer
    const val1 = await callJson(server, 'GET', `/api/auth/reset-password/validate?token=${validRawToken}`);
    const val2 = await callJson(server, 'GET', `/api/auth/reset-password/validate?token=${validRawToken}`);
    assert.strictEqual(val1.status, 200);
    assert.strictEqual(val1.headers['referrer-policy'], 'no-referrer');
    assert.strictEqual(val2.status, 200);
    assert.strictEqual(pool.tables.verification_codes.find((r) => r.id === 99).is_used, 0);
    console.log('  ✅ 3. GET validate no consume el token y envía Referrer-Policy: no-referrer.');

    // Token vencido rechazado
    const expiredRawToken = crypto.randomBytes(32).toString('hex');
    pool.tables.verification_codes.push({
      id: 100,
      tenant_id: 't-1',
      user_id: 'USER-u-1',
      client_id: 'USER-u-1',
      identity: 'owner@salon.com',
      purpose: 'password_reset_link',
      channel: 'email',
      code: null,
      code_hash: crypto.createHash('sha256').update(expiredRawToken).digest('hex'),
      expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
      is_used: 0,
    });
    const expVal = await callJson(server, 'GET', `/api/auth/reset-password/validate?token=${expiredRawToken}`);
    assert.strictEqual(expVal.status, 400);

    // Consumo atómico concurrente: 2 peticiones simultáneas -> exactamente 1 éxito y 1 fallo
    const [r1, r2] = await Promise.all([
      callJson(server, 'POST', '/api/auth/reset-password', { token: validRawToken, newPassword: 'NewSecurePassword99*' }),
      callJson(server, 'POST', '/api/auth/reset-password', { token: validRawToken, newPassword: 'NewSecurePassword99*' }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    assert.deepStrictEqual(statuses, [200, 400], 'Solo una petición concurrente puede consumir el token');
    assert.strictEqual(pool.tables.users[0].token_version, 2, 'token_version debe incrementarse para revocar sesiones');
    console.log('  ✅ 4. Consumo atómico concurrente, expiración y revocación de sesión (token_version) verificados.');
  } finally {
    server.close();
  }

  console.log('\n🎉 TODAS LAS PRUEBAS DE RECUPERACIÓN POR ENLACE SEGURO PASARON.');
}

runTests().catch((err) => {
  console.error('❌ Test fallido:', err);
  process.exit(1);
});
