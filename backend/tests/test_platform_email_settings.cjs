'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_must_be_at_least_32_characters_long_for_security';

const assert = require('assert');
const http = require('http');
const express = require('express');
const {
  encryptSmtpSecret,
  decryptSmtpSecret,
  isPlaceholderPassword,
  getGlobalEmailMetadata,
  upsertGlobalEmailSettings,
  getGlobalSmtpConfig,
  resolveTransporterForTenant,
} = require('../services/platform_email.service');
const { createSaasRouter } = require('../routes/saas.routes');
const { signAuthToken } = require('../middleware/auth.middleware');

function createPlatformEmailMockPool() {
  const state = {
    platform_email_settings: [],
    email_settings: [],
    security_audit_logs: [],
  };

  const pool = {
    state,
    async getConnection() {
      return {
        query: pool.query.bind(pool),
        release() {},
      };
    },
    async query(sql, params = []) {
      const norm = String(sql).replace(/\s+/g, ' ').trim();

      if (/FROM users/i.test(norm)) {
        const idParam = String(params[0] || '');
        if (idParam === 'sa-1') {
          return [[{ id: 'sa-1', role: 'superadmin', tenant_id: null, status: 'active', token_version: 1 }]];
        }
        return [[{ id: 'u-owner', role: 'owner', tenant_id: 'tenant-1', status: 'active', token_version: 1 }]];
      }

      if (/^SELECT smtp_host, smtp_port, smtp_user, smtp_from, smtp_secure/i.test(norm)) {
        const row = state.platform_email_settings.find((r) => r.id === 1);
        if (!row) return [[]];
        return [[{
          smtp_host: row.smtp_host,
          smtp_port: row.smtp_port,
          smtp_user: row.smtp_user,
          smtp_from: row.smtp_from,
          smtp_secure: row.smtp_secure,
          has_password: Boolean(row.smtp_pass_encrypted),
          updated_at: row.updated_at,
          updated_by_email: row.updated_by_email,
        }]];
      }

      if (/^SELECT smtp_pass_encrypted, smtp_pass_iv, smtp_pass_tag FROM platform_email_settings/i.test(norm)) {
        const row = state.platform_email_settings.find((r) => r.id === 1);
        return [row ? [row] : []];
      }

      if (/^SELECT smtp_host, smtp_port, smtp_user, smtp_pass_encrypted, smtp_pass_iv, smtp_pass_tag, smtp_from, smtp_secure FROM platform_email_settings/i.test(norm)) {
        const row = state.platform_email_settings.find((r) => r.id === 1);
        return [row ? [row] : []];
      }

      if (/^INSERT INTO platform_email_settings/i.test(norm)) {
        const [host, port, user, enc, iv, tag, from, secure, actorId, actorEmail] = params;
        const idx = state.platform_email_settings.findIndex((r) => r.id === 1);
        const record = {
          id: 1,
          smtp_host: host,
          smtp_port: port,
          smtp_user: user,
          smtp_pass_encrypted: enc,
          smtp_pass_iv: iv,
          smtp_pass_tag: tag,
          smtp_from: from,
          smtp_secure: secure,
          updated_by_user_id: actorId,
          updated_by_email: actorEmail,
          created_at: idx >= 0 ? state.platform_email_settings[idx].created_at : new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (idx >= 0) state.platform_email_settings[idx] = record;
        else state.platform_email_settings.push(record);
        return [{ affectedRows: 1 }];
      }

      if (/^INSERT INTO security_audit_logs/i.test(norm)) {
        state.security_audit_logs.push({ user_id: params[0], details: params[1], ip: params[2] });
        return [{ affectedRows: 1 }];
      }

      if (/^SELECT smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure FROM email_settings/i.test(norm)) {
        const tenantId = params[0];
        const row = state.email_settings.find((r) => r.tenant_id === tenantId);
        return [row ? [row] : []];
      }

      return [[]];
    },
  };
  return pool;
}

function requestJson(server, method, path, body, token) {
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
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
          } catch {
            resolve({ status: res.statusCode, body: data });
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
  console.log('📧 Iniciando pruebas de SMTP Global (platform_email_settings)...\n');

  // 1. Cifrado AES-256-GCM y detección de placeholders
  const bundle = encryptSmtpSecret('super-secret-smtp-pass');
  assert.notStrictEqual(bundle.encrypted, 'super-secret-smtp-pass');
  assert.strictEqual(decryptSmtpSecret(bundle.encrypted, bundle.iv, bundle.tag), 'super-secret-smtp-pass');
  assert.strictEqual(isPlaceholderPassword('********'), true);
  assert.strictEqual(isPlaceholderPassword('••••••••'), true);
  assert.strictEqual(isPlaceholderPassword(''), true);
  assert.strictEqual(isPlaceholderPassword('real-pass-123'), false);
  console.log('  ✅ 1. Cifrado AES-256-GCM y rechazo de placeholders verificado.');

  // 2. Persistencia, upsert único sin duplicar y preservación de contraseña
  const pool = createPlatformEmailMockPool();
  await upsertGlobalEmailSettings(
    pool,
    {
      smtp_host: 'smtp.hostinger.com',
      smtp_port: 465,
      smtp_user: 'no-reply@etereasapp.com',
      smtp_pass: 'my-real-smtp-secret',
      smtp_from: 'Etereas',
      smtp_secure: true,
    },
    { userId: 'sa-1', email: 'superadmin@etereasapp.com' }
  );
  assert.strictEqual(pool.state.platform_email_settings.length, 1);

  // Actualizar otro campo sin contraseña -> debe conservar la existente
  const updatedMeta = await upsertGlobalEmailSettings(
    pool,
    {
      smtp_host: 'smtp.hostinger.com',
      smtp_port: 587,
      smtp_user: 'no-reply@etereasapp.com',
      smtp_pass: '',
      smtp_from: 'Etereas Soporte',
      smtp_secure: false,
    },
    { userId: 'sa-1', email: 'superadmin@etereasapp.com' }
  );
  assert.strictEqual(pool.state.platform_email_settings.length, 1, 'No debe duplicar fila global');
  assert.strictEqual(updatedMeta.smtp_port, 587);
  assert.strictEqual(updatedMeta.smtp_from, 'Etereas Soporte');
  assert.strictEqual(updatedMeta.has_password, true);
  assert.strictEqual(updatedMeta.smtp_pass, '', 'Nunca debe devolver contraseña');
  assert.strictEqual(updatedMeta.smtp_pass_encrypted, undefined, 'Nunca debe devolver secreto cifrado');

  const decryptedCfg = await getGlobalSmtpConfig(pool);
  assert.strictEqual(decryptedCfg.pass, 'my-real-smtp-secret', 'Contraseña existente debe preservarse al editar otros campos');
  assert.strictEqual(pool.state.security_audit_logs.length, 2, 'Cambios auditados');
  assert(!pool.state.security_audit_logs[0].details.includes('my-real-smtp-secret'), 'Auditoría no debe contener secreto');
  console.log('  ✅ 2. Upsert único, preservación de contraseña y auditoría sin secretos verificados.');

  // 3. Prioridad tenant vs fallback global
  const fallbackRes = await resolveTransporterForTenant(pool, 'tenant-sin-smtp', 'Etereas');
  assert.strictEqual(fallbackRes.source, 'platform');
  pool.state.email_settings.push({
    tenant_id: 'tenant-con-smtp',
    smtp_host: 'smtp.salon.com',
    smtp_port: 587,
    smtp_user: 'hola@salon.com',
    smtp_pass: 'salon-pass',
    smtp_from: 'Salon VIP',
    smtp_secure: 0,
  });
  const tenantRes = await resolveTransporterForTenant(pool, 'tenant-con-smtp', 'Etereas');
  assert.strictEqual(tenantRes.source, 'tenant');
  console.log('  ✅ 3. Prioridad SMTP propio del salón vs fallback global verificada.');

  // 4. Control de acceso HTTP: Tenant/Owner bloqueados (403), SuperAdmin permitido (200)
  const app = express();
  app.use(express.json());
  app.use('/api/saas', createSaasRouter(pool));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const ownerToken = signAuthToken({ sub: 'u-owner', id: 'u-owner', tenantId: 'tenant-1', role: 'owner', email: 'owner@salon.com', tokenVersion: 1 });
    const superToken = signAuthToken({ sub: 'sa-1', id: 'sa-1', tenantId: null, role: 'superadmin', email: 'superadmin@etereasapp.com', tokenVersion: 1 });

    const unauthGet = await requestJson(server, 'GET', '/api/saas/email-settings');
    assert.strictEqual(unauthGet.status, 401);

    const ownerGet = await requestJson(server, 'GET', '/api/saas/email-settings', null, ownerToken);
    assert.strictEqual(ownerGet.status, 403);

    const ownerPut = await requestJson(server, 'PUT', '/api/saas/email-settings', { smtp_host: 'evil.com', smtp_user: 'x' }, ownerToken);
    assert.strictEqual(ownerPut.status, 403);

    const saGet = await requestJson(server, 'GET', '/api/saas/email-settings', null, superToken);
    assert.strictEqual(saGet.status, 200);
    assert.strictEqual(saGet.body.smtp_host, 'smtp.hostinger.com');
    assert.strictEqual(saGet.body.has_password, true);
    assert.strictEqual(saGet.body.smtp_pass, '');

    console.log('  ✅ 4. Aislamiento HTTP y permisos exclusivos de SuperAdmin verificados.');
  } finally {
    server.close();
  }

  console.log('\n🎉 TODAS LAS PRUEBAS DE SMTP GLOBAL PASARON EXITOSAMENTE.');
}

runTests().catch((err) => {
  console.error('❌ Test fallido:', err);
  process.exit(1);
});
