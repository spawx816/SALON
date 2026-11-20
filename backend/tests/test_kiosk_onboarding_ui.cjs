/* global window, document */
'use strict';

/**
 * Regresión E2E en navegador real (Puppeteer + dist/ canónico + salon_saas_test):
 * - Empresa sin roles personalizados (0 roles) y 0 colaboradores en sucursal.
 * - Nuevo Usuario en /seguridad inicia con "-- Seleccionar rol --" (value === ''), NO preselecciona Kiosco.
 * - Selección explícita de Kiosco de Asistencia + sucursal -> persiste role='kiosco_asistencia', role_id=NULL, sin consumir licencia.
 * - Login real de la cuenta Kiosco -> redirige a /asistencia -> muestra estado vacío claro (no pantalla en blanco).
 */

const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const bcrypt = require('bcryptjs');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');
const { validateTestEnvironment, createIsolatedTestPool, getSanitizedChildEnv } = require('../utils/test_env_guard.cjs');
const { EntitlementsRepository } = require('../repositories/entitlements.repository');

function findBrowserExecutable() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

function getEphemeralPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function waitForServerHealth(port, maxWaitMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1000, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - start > maxWaitMs) return reject(new Error(`Server failed to start on port ${port}`));
      setTimeout(check, 200);
    };
    check();
  });
}

async function main() {
  const testConfig = validateTestEnvironment();
  const pool = createIsolatedTestPool(testConfig);
  const entRepo = new EntitlementsRepository(pool);
  const port = await getEphemeralPort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const tag = crypto.randomBytes(4).toString('hex');
  const tenantId = crypto.randomUUID();
  const branchId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const ownerEmail = `owner_kui_${tag}@test.local`;
  const ownerPass = 'OwnerPass!2026';
  const kioskEmail = `kiosco_ui_${tag}@test.local`;
  const kioskPass = 'KioskUi!2026';
  const ownerHash = bcrypt.hashSync(ownerPass, 10);

  let serverProc = null;
  let browser = null;

  try {
    // 1. Seed empresa sin roles personalizados y sin colaboradores, con cupo 1/1 lleno (solo Owner)
    await pool.query(
      "INSERT INTO tenants (id, business_name, email, slug, status, max_users, max_branches) VALUES (?, ?, ?, ?, 'active', 1, 1)",
      [tenantId, `Kiosk Empty UI ${tag}`, `kui-${tag}@test.local`, `kui-${tag}`]
    );
    await pool.query(
      'INSERT INTO branches (id, tenant_id, name, is_main, is_active) VALUES (?, ?, ?, TRUE, TRUE)',
      [branchId, tenantId, 'Sucursal Unica']
    );
    await pool.query(
      "INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, billing_cycle, currency, current_period_start, current_period_end) VALUES (?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', NOW(), NOW() + INTERVAL '30 days')",
      [crypto.randomUUID(), tenantId]
    );
    await pool.query(
      "INSERT INTO users (id, tenant_id, branch_id, name, nombre, email, password_hash, role, all_branches_access, is_active, estado) VALUES (?, ?, ?, 'Owner KUI', 'Owner KUI', ?, ?, 'propietario', TRUE, TRUE, 'Activo')",
      [ownerId, tenantId, branchId, ownerEmail, ownerHash]
    );

    const env = getSanitizedChildEnv(testConfig, port);
    env.SAAS_RENEWAL_WORKER_ENABLED = 'false';
    env.DISABLE_SCHEDULER = 'true';
    env.DGII_ENV = 'disabled';
    env.CARDNET_ENV = 'disabled';

    serverProc = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForServerHealth(port);

    const executablePath = findBrowserExecutable();
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    // 2. Owner inicia sesión en /login y abre Seguridad -> Nuevo Usuario
    const ownerCtx = await browser.createBrowserContext();
    const page = await ownerCtx.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('dialog', async (d) => { await d.accept(); });

    await page.goto(baseUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('input[type="password"]', { timeout: 15000 });
    const ownerUserInput = await page.$('input[id*="login"], input[name="username"], input[type="email"], input[type="text"]');
    assert.ok(ownerUserInput, 'Debe existir el campo de usuario/correo en login');
    await ownerUserInput.click({ clickCount: 3 });
    await ownerUserInput.type(ownerEmail);
    await page.type('input[type="password"]', ownerPass);
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForFunction(() => !document.querySelector('input[type="password"]'), { timeout: 15000 }),
    ]);

    await page.goto(`${baseUrl}/seguridad`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('button')).some((b) => b.textContent && b.textContent.includes('Nuevo Usuario')),
      { timeout: 15000 }
    );
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent && b.textContent.includes('Nuevo Usuario'));
      if (btn) btn.click();
    });

    await page.waitForSelector('form select', { timeout: 10000 });

    // Verificar que con 0 roles personalizados NO se preselecciona Kiosco automáticamente
    const initialRoleVal = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('form select'));
      const roleSelect = selects.find((s) => Array.from(s.options).some((o) => o.value === '__KIOSK_RESERVED__'));
      return roleSelect ? { value: roleSelect.value, selectedText: roleSelect.options[roleSelect.selectedIndex]?.textContent?.trim() } : null;
    });
    assert.ok(initialRoleVal, 'Debe existir el selector de rol en el formulario de Nuevo Usuario');
    assert.strictEqual(initialRoleVal.value, '', `No debe preseleccionar Kiosco automáticamente (recibido value="${initialRoleVal.value}")`);
    assert.ok(initialRoleVal.selectedText.includes('Seleccionar rol'), `Debe mostrar placeholder "-- Seleccionar rol --" (recibido "${initialRoleVal.selectedText}")`);
    console.log('  ✅ UI 1. Empresa sin roles personalizados: selector inicia en "-- Seleccionar rol --" sin preseleccionar Kiosco.');

    // Llenar formulario y seleccionar explícitamente Kiosco de Asistencia
    await page.evaluate((kEmail, kPass) => {
      const form = document.querySelector('form');
      const inputs = Array.from(form.querySelectorAll('input'));
      const setNative = (el, val) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const textInput = inputs.find((i) => i.type === 'text');
      const emailInput = inputs.find((i) => i.type === 'email');
      const passInput = inputs.find((i) => i.type === 'password');
      setNative(textInput, 'Kiosco Recepcion UI');
      setNative(emailInput, kEmail);
      setNative(passInput, kPass);
    }, kioskEmail, kioskPass);

    await page.evaluate((bId) => {
      const selects = Array.from(document.querySelectorAll('form select'));
      const roleSelect = selects.find((s) => Array.from(s.options).some((o) => o.value === '__KIOSK_RESERVED__'));
      const branchSelect = selects.find((s) => Array.from(s.options).some((o) => o.value === bId));
      const setSelect = (el, val) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(el, val);
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setSelect(roleSelect, '__KIOSK_RESERVED__');
      setSelect(branchSelect, bId);
    }, branchId);

    await page.evaluate(() => {
      const btn = document.querySelector('form button[type="submit"]');
      if (btn) {
        btn.scrollIntoView({ block: 'center' });
        btn.click();
      }
    });
    await page.waitForFunction(
      (kEmail) => document.body.innerText.includes(kEmail),
      { timeout: 15000 },
      kioskEmail
    );

    // Verificar persistencia exacta en BD y que NO consume licencia (cupo sigue en 1/1)
    const [kRows] = await pool.query(
      'SELECT id, role, role_id, branch_id, all_branches_access FROM users WHERE tenant_id = ? AND LOWER(email) = LOWER(?)',
      [tenantId, kioskEmail]
    );
    assert.strictEqual(kRows.length, 1, 'Usuario kiosco debe existir en BD');
    assert.strictEqual(kRows[0].role, 'kiosco_asistencia');
    assert.strictEqual(kRows[0].role_id, null);
    assert.strictEqual(String(kRows[0].branch_id), branchId);
    assert.strictEqual(Boolean(kRows[0].all_branches_access), false);

    const billableCount = await entRepo.countResourceUsage(tenantId, 'users');
    assert.strictEqual(billableCount, 1, 'Cuenta kiosco creada desde UI NO debe consumir licencia');
    console.log('  ✅ UI 2. Creación explícita de Kiosco persiste role="kiosco_asistencia", role_id=NULL y mantiene consumo en 1/1.');

    await ownerCtx.close();

    // 3. Login real en navegador nuevo con la cuenta Kiosco -> redirige a /asistencia -> estado vacío claro
    const kioskCtx = await browser.createBrowserContext();
    const kPage = await kioskCtx.newPage();
    kPage.on('pageerror', (err) => pageErrors.push(err.message));

    await kPage.goto(baseUrl, { waitUntil: 'networkidle2' });
    await kPage.waitForSelector('input[type="password"]', { timeout: 15000 });
    const kioskUserInput = await kPage.$('input[id*="login"], input[name="username"], input[type="email"], input[type="text"]');
    assert.ok(kioskUserInput, 'Debe existir el campo de usuario/correo en login para kiosco');
    await kioskUserInput.click({ clickCount: 3 });
    await kioskUserInput.type(kioskEmail);
    await kPage.type('input[type="password"]', kioskPass);
    await Promise.all([
      kPage.click('button[type="submit"]'),
      kPage.waitForFunction(() => window.location.pathname === '/asistencia', { timeout: 15000 }),
    ]);

    await kPage.waitForSelector('[data-testid="kiosk-empty-employees"]', { timeout: 15000 });
    const emptyStateText = await kPage.$eval('[data-testid="kiosk-empty-employees"]', (el) => el.innerText);
    assert.ok(emptyStateText.includes('No hay colaboradores disponibles en esta sucursal'), `Estado vacío inesperado: ${emptyStateText}`);
    assert.ok(emptyStateText.includes('Actualizar lista'), 'Debe incluir botón Actualizar lista');
    assert.strictEqual(pageErrors.length, 0, `Errores JS en navegador: ${pageErrors.join(' | ')}`);
    console.log('  ✅ UI 3. Login real de cuenta Kiosco redirige a /asistencia y muestra estado vacío claro (sin pantalla en blanco, 0 pageerrors).');

    await kioskCtx.close();
    console.log('\n🎉 REGRESIÓN UI KIOSCO COMPLETADA EXITOSAMENTE.');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (serverProc && !serverProc.killed) serverProc.kill();
    await pool.query('DELETE FROM kiosk_devices WHERE tenant_id = ?', [tenantId]).catch(() => {});
    await pool.query('DELETE FROM user_sessions WHERE tenant_id = ?', [tenantId]).catch(() => {});
    await pool.query('DELETE FROM security_audit_logs WHERE tenant_id = ?', [tenantId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE tenant_id = ?', [tenantId]).catch(() => {});
    await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id = ?', [tenantId]).catch(() => {});
    await pool.query('DELETE FROM branches WHERE tenant_id = ?', [tenantId]).catch(() => {});
    await pool.query('DELETE FROM tenants WHERE id = ?', [tenantId]).catch(() => {});
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ FALLO REGRESIÓN UI KIOSCO:', err);
  process.exit(1);
});
