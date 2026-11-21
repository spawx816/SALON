/* global document */
'use strict';

/**
 * UI Regression Test: AnalyticsContainer (ServiceAnalytics + BusinessIntelligence sin ciclo)
 * Verifica contra salon_saas_test + backend/server.js + dist/ + Chrome headless real:
 * 1. Carga directa de /analitica (tab BI Ejecutivo por defecto).
 * 2. Carga directa de /bi (redirección a /analitica?tab=bi_executive).
 * 3. Cambios repetidos entre vistas: BI Ejecutivo -> Vista Clásica / Ventas Diarias -> BI Ejecutivo -> Facturas -> BI Ejecutivo.
 * 4. Recarga de página conservando estado/tab sin errores de consola ni 5xx.
 * 5. Permiso view_analytics respetado (usuario sin permiso redirigido fuera de /analitica).
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
  const port = await getEphemeralPort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const tag = crypto.randomBytes(4).toString('hex');
  const TENANT_ID = crypto.randomUUID();
  const BRANCH_ID = crypto.randomUUID();
  const OWNER_EMAIL = `ana_own_${tag}@test.local`;
  const NO_ANA_EMAIL = `ana_noperm_${tag}@test.local`;
  const PASS = 'AnalyticsTest!2026';
  const PASS_HASH = bcrypt.hashSync(PASS, 10);

  let serverProc = null;
  let browser = null;

  try {
    await pool.query(
      "INSERT INTO tenants (id, business_name, email, slug, status, licensed_branches, max_branches, extra_user_seats, max_users) VALUES (?, ?, ?, ?, 'active', 1, 1, 2, 5)",
      [TENANT_ID, `Analitica Test ${tag}`, OWNER_EMAIL, `ana-${tag}`]
    );
    await pool.query(
      "INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, billing_cycle, currency, current_period_start, current_period_end) VALUES (?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', NOW(), NOW() + INTERVAL '30 days')",
      [crypto.randomUUID(), TENANT_ID]
    );
    await pool.query(
      "INSERT INTO branches (id, tenant_id, name, is_main, is_active) VALUES (?, ?, 'Sucursal Principal', TRUE, TRUE)",
      [BRANCH_ID, TENANT_ID]
    );
    const [roleNoAna] = await pool.query(
      `INSERT INTO roles (tenant_id, nombre, permisos) VALUES (?, 'Sin Analitica', ?::jsonb) RETURNING id`,
      [TENANT_ID, JSON.stringify({ 'pos.view': true })]
    );
    await pool.query(
      `INSERT INTO users (id, tenant_id, branch_id, salon_id, name, nombre, username, email, password_hash, role, role_id, authorized_branch_ids, all_branches_access, is_active, estado)
       VALUES
         (?, ?, ?, ?, 'Owner Analitica', 'Owner Analitica', ?, ?, ?, 'propietario', NULL, ?::jsonb, TRUE, TRUE, 'Activo'),
         (?, ?, ?, ?, 'Operador Sin Analitica', 'Operador Sin Analitica', ?, ?, ?, 'empleado', ?, ?::jsonb, FALSE, TRUE, 'Activo')`,
      [
        crypto.randomUUID(), TENANT_ID, BRANCH_ID, BRANCH_ID, OWNER_EMAIL, OWNER_EMAIL, PASS_HASH, JSON.stringify([BRANCH_ID]),
        crypto.randomUUID(), TENANT_ID, BRANCH_ID, BRANCH_ID, NO_ANA_EMAIL, NO_ANA_EMAIL, PASS_HASH, roleNoAna[0].id, JSON.stringify([BRANCH_ID]),
      ]
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
    browser = await puppeteer.launch({ headless: 'new', executablePath, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    const pageErrors = [];
    const server5xx = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('response', (res) => { if (res.status() >= 500) server5xx.push(`${res.status()} ${res.url()}`); });

    // 1. Login como propietario
    await page.goto(baseUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('input[type="password"]', { timeout: 15000 });
    const uIn = await page.$('input[id*="login"], input[name="username"], input[type="email"], input[type="text"]');
    await uIn.click({ clickCount: 3 });
    await uIn.type(OWNER_EMAIL);
    await page.type('input[type="password"]', PASS);
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForFunction(() => !document.querySelector('input[type="password"]'), { timeout: 15000 }),
    ]);

    // 2. Carga directa de /bi -> redirige a /analitica?tab=bi_executive y renderiza BusinessIntelligence
    await page.goto(`${baseUrl}/bi`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(
      () => document.body.innerText.includes('Inteligencia de Negocios') && document.body.innerText.includes('Ventas'),
      { timeout: 15000 }
    );
    assert.ok(page.url().includes('/analitica'), `Se esperaba redirección de /bi a /analitica, url=${page.url()}`);

    // 3. Cambios repetidos entre vistas: /analitica?tab=sales (ServiceAnalytics) <-> select bi_executive (BusinessIntelligence) <-> invoices
    for (let round = 1; round <= 2; round++) {
      await page.goto(`${baseUrl}/analitica?tab=sales`, { waitUntil: 'networkidle2' });
      await page.waitForFunction(
        () => window.location.search.includes('tab=sales') && document.body.innerText.includes('Ventas Diarias'),
        { timeout: 15000 }
      );

      // Cambiar a invoices desde el selector <select>
      const switchedToInvoices = await page.evaluate(() => {
        const selects = Array.from(document.querySelectorAll('select'));
        const tabSel = selects.find((s) => Array.from(s.options).some((o) => o.value === 'invoices'));
        if (!tabSel) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(tabSel, 'invoices');
        tabSel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      });
      assert.strictEqual(switchedToInvoices, true, `Ronda ${round}: debe permitir cambiar a Facturas desde el selector`);
      await page.waitForFunction(() => window.location.search.includes('tab=invoices'), { timeout: 15000 });

      // Volver a BI Ejecutivo desde el selector <select>
      const switchedToBi = await page.evaluate(() => {
        const selects = Array.from(document.querySelectorAll('select'));
        const tabSel = selects.find((s) => Array.from(s.options).some((o) => o.value === 'bi_executive'));
        if (!tabSel) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(tabSel, 'bi_executive');
        tabSel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      });
      assert.strictEqual(switchedToBi, true, `Ronda ${round}: debe permitir volver a BI Ejecutivo desde el selector`);
      await page.waitForFunction(
        () => window.location.search.includes('tab=bi_executive') && document.body.innerText.includes('Inteligencia de Negocios'),
        { timeout: 15000 }
      );
    }

    // 4. Recarga directa en /analitica?tab=sales y /analitica?tab=bi_executive
    await page.goto(`${baseUrl}/analitica?tab=sales`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('Ventas Diarias'), { timeout: 15000 });
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('Ventas Diarias') && window.location.search.includes('tab=sales'), { timeout: 15000 });

    await page.goto(`${baseUrl}/analitica?tab=bi_executive`, { waitUntil: 'networkidle2' });
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(
      () => window.location.search.includes('tab=bi_executive') && document.body.innerText.includes('Inteligencia de Negocios'),
      { timeout: 15000 }
    );

    assert.strictEqual(pageErrors.length, 0, `pageerrors en analítica: ${pageErrors.join(' | ')}`);
    assert.strictEqual(server5xx.length, 0, `5xx en analítica: ${server5xx.join(' | ')}`);

    // 5. Verificar permiso view_analytics en contexto aislado sin sesión previa
    const ctx2 = await browser.createBrowserContext();
    const page2 = await ctx2.newPage();
    await page2.goto(baseUrl, { waitUntil: 'networkidle2' });
    await page2.waitForSelector('input[type="password"]', { timeout: 15000 });
    const uIn2 = await page2.$('input[id*="login"], input[name="username"], input[type="email"], input[type="text"]');
    await uIn2.click({ clickCount: 3 });
    await uIn2.type(NO_ANA_EMAIL);
    await page2.type('input[type="password"]', PASS);
    await Promise.all([
      page2.click('button[type="submit"]'),
      page2.waitForFunction(() => !document.querySelector('input[type="password"]'), { timeout: 15000 }),
    ]);
    await page2.goto(`${baseUrl}/analitica`, { waitUntil: 'networkidle2' });
    assert.ok(!page2.url().includes('/analitica'), `Usuario sin view_analytics debe ser redirigido fuera de /analitica, url=${page2.url()}`);

    console.log('✅ PRUEBA UI ANALÍTICA (carga directa /bi y /analitica, cambios repetidos BI <-> Clásica, recarga y permisos) PASS (0 pageerrors, 0 5xx).');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (serverProc && !serverProc.killed) serverProc.kill();
    await pool.query('DELETE FROM user_sessions WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM security_audit_logs WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM users WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM roles WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM branches WHERE tenant_id = ?', [TENANT_ID]).catch(() => {});
    await pool.query('DELETE FROM tenants WHERE id = ?', [TENANT_ID]).catch(() => {});
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ FALLO PRUEBA UI ANALÍTICA:', err);
  process.exit(1);
});
