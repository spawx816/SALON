/* global document, window */
'use strict';

/**
 * End-to-End Verification Suite:
 * 1. Personalización efectiva en el sidebar real (.floating-sidebar computed styles, variables CSS,
 *    contraste WCAG dinámico, marca de plataforma ETEREAS vs bloque de empresa, persistencia tras recarga
 *    y nuevo login, aislamiento sin contaminación entre empresas).
 * 2. Una sesión activa por usuario (user_sessions atómico, serialización de logins concurrentes,
 *    pestañas del mismo navegador compartiendo cookie, login fallido no revoca, reemplazo 401 SESSION_REPLACED
 *    con limpieza local y mensaje exacto en DOM, refresh/logout/reset-password respetando revocación,
 *    aislamiento de otros usuarios/empresas, y reemplazo de dispositivo/sesiones breves en cuenta Kiosco).
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');
const puppeteer = require('puppeteer');

const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const testConfig = validateTestEnvironment();

process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'test';
process.env.DB_TYPE = 'postgres';
process.env.DB_HOST = testConfig.host;
process.env.DB_PORT = String(testConfig.port);
process.env.DB_USER = testConfig.user;
process.env.DB_PASS = testConfig.password;
process.env.DB_PASSWORD = testConfig.password;
process.env.DB_NAME = testConfig.database;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'stability_e2e_jwt_secret_at_least_32_chars_2026';

const pool = createIsolatedTestPool(testConfig);
const { createApp } = require('../app');
const { createKioskEmployeeSession } = require('../services/kiosk_device.service');

const EXPECTED_REPLACED_MSG = 'Tu sesión se cerró porque se inició sesión con esta cuenta en otro dispositivo.';

// 1x1 valid PNG buffer
const VALID_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const VALID_PNG_BUFFER = Buffer.from(VALID_PNG_BASE64, 'base64');

function findBrowserExecutable() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

function extractCookiesMap(setCookieHeaders = []) {
  const map = {};
  for (const raw of setCookieHeaders) {
    const firstPart = String(raw || '').split(';')[0];
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx > 0) {
      const k = firstPart.slice(0, eqIdx).trim();
      const v = firstPart.slice(eqIdx + 1).trim();
      map[k] = v;
    }
  }
  return map;
}

function formatCookieHeader(cookieMap) {
  return Object.entries(cookieMap)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function apiCall(port, { method = 'GET', urlPath, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const payload = body !== null ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: {
          Origin: `http://127.0.0.1:${port}`,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const rawBuffer = Buffer.concat(chunks);
          const rawText = rawBuffer.toString('utf8');
          let parsed = null;
          try {
            parsed = rawText ? JSON.parse(rawText) : null;
          } catch {
            parsed = rawText;
          }
          const cookies = extractCookiesMap(res.headers['set-cookie'] || []);
          resolve({ status: res.statusCode, headers: res.headers, cookies, body: parsed, rawBuffer });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runSuite() {
  console.log('========================================================================');
  console.log('🧪 SUITE E2E: PERSONALIZACIÓN EFECTIVA DEL SIDEBAR & SESIÓN ÚNICA ACTIVA');
  console.log('========================================================================\n');

  const [dbCheck] = await pool.query('SELECT current_database() AS db');
  assert.strictEqual(dbCheck[0].db, testConfig.database);

  const ts = Date.now();
  const TENANT_A = crypto.randomUUID();
  const TENANT_B = crypto.randomUUID();
  const BRANCH_A = crypto.randomUUID();
  const BRANCH_B = crypto.randomUUID();
  const OWNER_A_ID = crypto.randomUUID();
  const STAFF_A_ID = crypto.randomUUID();
  const KIOSK_A1_ID = crypto.randomUUID();
  const KIOSK_A2_ID = crypto.randomUUID();
  const OWNER_B_ID = crypto.randomUUID();

  const OWNER_A_EMAIL = `owner.a.sess.${ts}@etereas.test`;
  const STAFF_A_EMAIL = `staff.a.sess.${ts}@etereas.test`;
  const KIOSK_A1_EMAIL = `kiosk1.a.sess.${ts}@etereas.test`;
  const KIOSK_A2_EMAIL = `kiosk2.a.sess.${ts}@etereas.test`;
  const OWNER_B_EMAIL = `owner.b.sess.${ts}@etereas.test`;
  const PASS = 'SessBrand#2026!';
  const passHash = bcrypt.hashSync(PASS, 10);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etereas_brand_sess_'));
  const logoFilePath = path.join(tempDir, 'atelier_logo.png');
  fs.writeFileSync(logoFilePath, VALID_PNG_BUFFER);

  let server = null;
  let browser = null;

  try {
    const [planRows] = await pool.query("SELECT id FROM saas_plans WHERE UPPER(code) = 'PRINCIPAL' LIMIT 1");
    const planId = planRows[0]?.id || 1;

    await pool.query(
      `INSERT INTO tenants (id, business_name, slug, email, owner_email, phone, address, rnc, plan_id, status, max_users, max_branches, licensed_branches)
       VALUES (?, 'Empresa Alpha Inicial', ?, ?, ?, '809-555-1100', 'Av. Abraham Lincoln #100', '131111222', ?, 'active', 3, 1, 1),
              (?, 'Empresa Beta Aislada', ?, ?, ?, '809-555-2200', 'Av. Sarasota #200', '132222333', ?, 'active', 3, 1, 1)`,
      [
        TENANT_A, `alpha-${ts}`, OWNER_A_EMAIL, OWNER_A_EMAIL, planId,
        TENANT_B, `beta-${ts}`, OWNER_B_EMAIL, OWNER_B_EMAIL, planId
      ]
    );

    await pool.query(
      `INSERT INTO tenant_subscriptions (id, tenant_id, saas_plan_id, plan_code, status, billing_cycle, currency, periodicity_mode, auto_renew, current_period_start, current_period_end)
       VALUES (?, ?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', 'fixed_30_days', FALSE, NOW(), NOW() + INTERVAL '30 days'),
              (?, ?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', 'fixed_30_days', FALSE, NOW(), NOW() + INTERVAL '30 days')`,
      [crypto.randomUUID(), TENANT_A, planId, crypto.randomUUID(), TENANT_B, planId]
    );

    await pool.query(
      `INSERT INTO branches (id, tenant_id, name, address, phone, is_main, status, is_active)
       VALUES (?, ?, 'Sucursal Alpha', 'Av. Lincoln', '809-555-1100', TRUE, 'Active', TRUE),
              (?, ?, 'Sucursal Beta', 'Av. Sarasota', '809-555-2200', TRUE, 'Active', TRUE)`,
      [BRANCH_A, TENANT_A, BRANCH_B, TENANT_B]
    );

    await pool.query(
      `INSERT INTO salons (id, tenant_id, name, address, phone, status)
       VALUES (?, ?, 'Sucursal Alpha', 'Av. Lincoln', '809-555-1100', 'Active'),
              (?, ?, 'Sucursal Beta', 'Av. Sarasota', '809-555-2200', 'Active')`,
      [BRANCH_A, TENANT_A, BRANCH_B, TENANT_B]
    );

    // Seed Owner A (propietario), Staff A (admin), 2 Kiosk accounts (exempt from 3-user seat limit), and Owner B
    await pool.query(
      `INSERT INTO users (id, tenant_id, branch_id, salon_id, name, nombre, username, email, password_hash, role, estado, is_active, token_version, all_branches_access)
       VALUES (?, ?, ?, ?, 'Propietario Alpha', 'Propietario Alpha', ?, ?, ?, 'propietario', 'Activo', TRUE, 1, TRUE),
              (?, ?, ?, ?, 'Admin Alpha', 'Admin Alpha', ?, ?, ?, 'admin', 'Activo', TRUE, 1, TRUE),
              (?, ?, ?, ?, 'Kiosco Recepción 1', 'Kiosco Recepción 1', ?, ?, ?, 'kiosco_asistencia', 'Activo', TRUE, 1, FALSE),
              (?, ?, ?, ?, 'Kiosco Recepción 2', 'Kiosco Recepción 2', ?, ?, ?, 'kiosco_asistencia', 'Activo', TRUE, 1, FALSE),
              (?, ?, ?, ?, 'Propietario Beta', 'Propietario Beta', ?, ?, ?, 'propietario', 'Activo', TRUE, 1, TRUE)`,
      [
        OWNER_A_ID, TENANT_A, BRANCH_A, BRANCH_A, OWNER_A_EMAIL, OWNER_A_EMAIL, passHash,
        STAFF_A_ID, TENANT_A, BRANCH_A, BRANCH_A, STAFF_A_EMAIL, STAFF_A_EMAIL, passHash,
        KIOSK_A1_ID, TENANT_A, BRANCH_A, BRANCH_A, KIOSK_A1_EMAIL, KIOSK_A1_EMAIL, passHash,
        KIOSK_A2_ID, TENANT_A, BRANCH_A, BRANCH_A, KIOSK_A2_EMAIL, KIOSK_A2_EMAIL, passHash,
        OWNER_B_ID, TENANT_B, BRANCH_B, BRANCH_B, OWNER_B_EMAIL, OWNER_B_EMAIL, passHash
      ]
    );

    // Start real Express server with built dist/
    const app = createApp({ pool });
    const distPath = path.join(__dirname, '..', '..', 'dist');
    const distIndexHtml = fs.readFileSync(path.join(distPath, 'index.html'), 'utf8');
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(distIndexHtml);
    });

    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    // =========================================================================
    // 1. PRUEBAS DE SESIÓN ÚNICA (CONCURRENCIA, AISLAMIENTO, REFRESH, LOGOUT, KIOSCO)
    // =========================================================================
    console.log('[1/3] Verificando serialización de logins concurrentes, reemplazo atómico, refresh, logout y kiosco...');

    // 1.1 Logins concurrentes para el mismo usuario -> debe quedar exactamente 1 sesión activa
    const concurrentLogins = await Promise.all([
      apiCall(port, { method: 'POST', urlPath: '/api/auth/login', body: { email: OWNER_A_EMAIL, password: PASS } }),
      apiCall(port, { method: 'POST', urlPath: '/api/auth/login', body: { email: OWNER_A_EMAIL, password: PASS } }),
      apiCall(port, { method: 'POST', urlPath: '/api/auth/login', body: { email: OWNER_A_EMAIL, password: PASS } })
    ]);
    for (const r of concurrentLogins) {
      assert.strictEqual(r.status, 200, `Login concurrente falló: ${JSON.stringify(r.body)}`);
    }

    const [activeOwnerASessions] = await pool.query(
      'SELECT id, is_active, device_info FROM user_sessions WHERE user_id = ? AND is_active = 1',
      [OWNER_A_ID]
    );
    assert.strictEqual(
      activeOwnerASessions.length,
      1,
      `Logins concurrentes deben dejar exactamente 1 sesión activa, encontradas: ${activeOwnerASessions.length}`
    );

    // 1.2 Otro usuario de la misma empresa (STAFF_A) y otro usuario de otra empresa (OWNER_B) inician sesión
    const staffALogin = await apiCall(port, {
      method: 'POST',
      urlPath: '/api/auth/login',
      body: { email: STAFF_A_EMAIL, password: PASS }
    });
    const ownerBLogin = await apiCall(port, {
      method: 'POST',
      urlPath: '/api/auth/login',
      body: { email: OWNER_B_EMAIL, password: PASS }
    });
    assert.strictEqual(staffALogin.status, 200);
    assert.strictEqual(ownerBLogin.status, 200);

    // 1.3 Login secuencial A1 -> Login fallido -> A1 sigue válido -> Login A2 reemplaza A1 -> A1 recibe 401 SESSION_REPLACED
    const loginA1 = await apiCall(port, {
      method: 'POST',
      urlPath: '/api/auth/login',
      body: { email: OWNER_A_EMAIL, password: PASS }
    });
    assert.strictEqual(loginA1.status, 200);
    const cookieA1 = formatCookieHeader(loginA1.cookies);

    // Intento de login fallido NO debe revocar la sesión válida A1
    const failedLogin = await apiCall(port, {
      method: 'POST',
      urlPath: '/api/auth/login',
      body: { email: OWNER_A_EMAIL, password: 'WrongPassword123!' }
    });
    assert.strictEqual(failedLogin.status, 401);

    const checkAfterFailed = await apiCall(port, {
      method: 'GET',
      urlPath: '/api/auth/session-status',
      headers: { Cookie: cookieA1 }
    });
    assert.strictEqual(checkAfterFailed.status, 200);
    assert.strictEqual(checkAfterFailed.body.valid, true, 'Un intento de login fallido NO debe expulsar la sesión activa');

    // Refresh en sesión activa A1 -> mantiene el mismo sessionId sin crear sesiones paralelas
    const refreshA1 = await apiCall(port, {
      method: 'POST',
      urlPath: '/api/auth/refresh',
      headers: { Cookie: cookieA1 }
    });
    assert.strictEqual(refreshA1.status, 200);
    assert.strictEqual(refreshA1.body.sessionId, loginA1.body.sessionId, 'El refresh debe conservar el mismo sessionId');
    const [activeAfterRefresh] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM user_sessions WHERE user_id = ? AND is_active = 1',
      [OWNER_A_ID]
    );
    assert.strictEqual(Number(activeAfterRefresh[0].cnt), 1, 'El refresh nunca debe crear sesiones paralelas');

    // Nuevo login A2 con la misma cuenta reemplaza A1
    const loginA2 = await apiCall(port, {
      method: 'POST',
      urlPath: '/api/auth/login',
      body: { email: OWNER_A_EMAIL, password: PASS }
    });
    assert.strictEqual(loginA2.status, 200);
    const cookieA2 = formatCookieHeader(loginA2.cookies);
    assert.notStrictEqual(loginA2.body.sessionId, loginA1.body.sessionId);

    // A2 funciona en rutas protegidas
    const checkA2 = await apiCall(port, {
      method: 'GET',
      urlPath: '/api/tenant/profile',
      headers: { Cookie: cookieA2 }
    });
    assert.strictEqual(checkA2.status, 200);

    // La siguiente petición protegida de A1 recibe 401 SESSION_REPLACED con el mensaje exacto
    const nextReqA1 = await apiCall(port, {
      method: 'GET',
      urlPath: '/api/tenant/profile',
      headers: { Cookie: cookieA1 }
    });
    assert.strictEqual(nextReqA1.status, 401);
    assert.strictEqual(nextReqA1.body.code, 'SESSION_REPLACED');
    assert.strictEqual(nextReqA1.body.reason, 'session_replaced');
    assert.strictEqual(nextReqA1.body.error, EXPECTED_REPLACED_MSG);

    // Refresh con token de sesión reemplazada A1 NO debe reactivar la sesión
    const refreshReplacedA1 = await apiCall(port, {
      method: 'POST',
      urlPath: '/api/auth/refresh',
      headers: { Cookie: cookieA1 }
    });
    assert.strictEqual(refreshReplacedA1.status, 401);
    assert.strictEqual(refreshReplacedA1.body.code, 'SESSION_REPLACED');

    // Verificar que STAFF_A (misma empresa) y OWNER_B (otra empresa) NO resultaron afectados
    const checkStaffA = await apiCall(port, {
      method: 'GET',
      urlPath: '/api/auth/session-status',
      headers: { Cookie: formatCookieHeader(staffALogin.cookies) }
    });
    const checkOwnerB = await apiCall(port, {
      method: 'GET',
      urlPath: '/api/auth/session-status',
      headers: { Cookie: formatCookieHeader(ownerBLogin.cookies) }
    });
    assert.strictEqual(checkStaffA.status, 200);
    assert.strictEqual(checkOwnerB.status, 200);

    // Logout voluntario de A2 revoca la sesión y bloquea peticiones posteriores y refresh
    const logoutA2 = await apiCall(port, {
      method: 'POST',
      urlPath: '/api/auth/logout',
      headers: { Cookie: cookieA2 }
    });
    assert.strictEqual(logoutA2.status, 200);

    const afterLogoutA2 = await apiCall(port, {
      method: 'GET',
      urlPath: '/api/tenant/profile',
      headers: { Cookie: cookieA2 }
    });
    assert.strictEqual(afterLogoutA2.status, 401);

    const refreshAfterLogoutA2 = await apiCall(port, {
      method: 'POST',
      urlPath: '/api/auth/refresh',
      headers: { Cookie: cookieA2 }
    });
    assert.strictEqual(refreshAfterLogoutA2.status, 401);

    // 1.4 Cuenta Kiosco de Asistencia: segundo login invalida el dispositivo anterior y sus sesiones breves subordinadas
    const kiosk1Dev1 = await apiCall(port, {
      method: 'POST',
      urlPath: '/api/auth/login',
      body: { email: KIOSK_A1_EMAIL, password: PASS }
    });
    assert.strictEqual(kiosk1Dev1.status, 200);
    assert.strictEqual(kiosk1Dev1.body.kioskOnly, true);
    assert.ok(kiosk1Dev1.cookies.auth_token, 'Kiosk login debe emitir auth_token');
    assert.ok(kiosk1Dev1.cookies.kiosk_device_token, 'Kiosk login debe emitir kiosk_device_token');
    const cookieK1Dev1 = formatCookieHeader(kiosk1Dev1.cookies);

    const kSessDev1Before = await apiCall(port, {
      method: 'GET',
      urlPath: '/api/kiosk/session',
      headers: { Cookie: cookieK1Dev1 }
    });
    assert.strictEqual(kSessDev1Before.status, 200);
    assert.strictEqual(kSessDev1Before.body.bound, true);
    const device1Id = kSessDev1Before.body.device.id;

    // Crear una sesión breve individual de empleado subordinada al dispositivo 1 (sin afectar logins operativos)
    const briefEmpSession = await createKioskEmployeeSession(pool, {
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      deviceId: device1Id,
      employeeSource: 'users',
      employeeId: STAFF_A_ID,
      purpose: 'self_service'
    });
    assert.ok(briefEmpSession.rawToken);

    // La sesión operativa de STAFF_A sigue activa e independiente de su sesión breve en el kiosco
    const checkStaffAfterKioskSubSession = await apiCall(port, {
      method: 'GET',
      urlPath: '/api/auth/session-status',
      headers: { Cookie: formatCookieHeader(staffALogin.cookies) }
    });
    assert.strictEqual(checkStaffAfterKioskSubSession.status, 200);

    // La segunda cuenta kiosco (KIOSK_A2) inicia sesión en su propio dispositivo
    const kiosk2Login = await apiCall(port, {
      method: 'POST',
      urlPath: '/api/auth/login',
      body: { email: KIOSK_A2_EMAIL, password: PASS }
    });
    assert.strictEqual(kiosk2Login.status, 200);
    const cookieK2 = formatCookieHeader(kiosk2Login.cookies);

    // Ahora la MISMA cuenta KIOSK_A1 inicia sesión en un segundo dispositivo (Dispositivo 2)
    const kiosk1Dev2 = await apiCall(port, {
      method: 'POST',
      urlPath: '/api/auth/login',
      body: { email: KIOSK_A1_EMAIL, password: PASS }
    });
    assert.strictEqual(kiosk1Dev2.status, 200);
    const cookieK1Dev2 = formatCookieHeader(kiosk1Dev2.cookies);

    // Dispositivo 2 de KIOSK_A1 funciona
    const kSessDev2 = await apiCall(port, {
      method: 'GET',
      urlPath: '/api/kiosk/session',
      headers: { Cookie: cookieK1Dev2 }
    });
    assert.strictEqual(kSessDev2.status, 200);
    assert.strictEqual(kSessDev2.body.bound, true);
    assert.notStrictEqual(kSessDev2.body.device.id, device1Id);

    // Dispositivo 1 de KIOSK_A1 quedó invalidado con razón SESSION_REPLACED
    const kEmployeesDev1 = await apiCall(port, {
      method: 'GET',
      urlPath: '/api/kiosk/employees',
      headers: { Cookie: cookieK1Dev1 }
    });
    assert.strictEqual(kEmployeesDev1.status, 401);
    assert.strictEqual(kEmployeesDev1.body.code, 'SESSION_REPLACED');
    assert.strictEqual(kEmployeesDev1.body.error, EXPECTED_REPLACED_MSG);

    // La sesión breve de empleado subordinada al Dispositivo 1 también fue revocada automáticamente
    const [briefRows] = await pool.query(
      'SELECT is_active FROM kiosk_employee_sessions WHERE id = ? AND tenant_id = ?',
      [briefEmpSession.sessionId, TENANT_A]
    );
    assert.strictEqual(Boolean(briefRows[0]?.is_active), false, 'La sesión breve del dispositivo kiosco reemplazado debe quedar inactiva');

    // La otra cuenta kiosco (KIOSK_A2) sigue funcionando sin afectación
    const kSessK2 = await apiCall(port, {
      method: 'GET',
      urlPath: '/api/kiosk/session',
      headers: { Cookie: cookieK2 }
    });
    assert.strictEqual(kSessK2.status, 200);
    assert.strictEqual(kSessK2.body.bound, true);

    console.log('  ✅ [PASS] Serialización concurrente, reemplazo 401 SESSION_REPLACED, refresh, logout y revocación de dispositivo kiosco verificados.');

    // =========================================================================
    // 2. NAVEGADOR REAL (PUPPETEER): DOS NAVEGADORES, PESTAÑAS COMPARTIDAS Y EXPULSIÓN CON MENSAJE EXACTO
    // =========================================================================
    console.log('\n[2/3] Ejecutando prueba en navegadores reales (Browser A con 2 pestañas vs Browser B con la misma cuenta)...');
    const executablePath = findBrowserExecutable();
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const contextA = await browser.createBrowserContext();
    const contextB = await browser.createBrowserContext();

    const pageA1 = await contextA.newPage();
    await pageA1.setViewport({ width: 1440, height: 900 });

    // 2.1 Browser A (Pestaña 1) inicia sesión con OWNER_A
    await pageA1.goto(baseUrl, { waitUntil: 'networkidle2' });
    await pageA1.waitForSelector('#et-login-email, input[type="password"]', { timeout: 10000 });
    await pageA1.type('#et-login-email', OWNER_A_EMAIL);
    await pageA1.type('#et-login-password', PASS);
    await Promise.all([
      pageA1.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
      pageA1.click('button.et-login-submit, button[type="submit"]')
    ]);

    await pageA1.waitForSelector('.floating-sidebar', { timeout: 10000 });

    // 2.2 Abrir Pestaña 2 en el MISMO Browser A (comparten cookie auth_token y localStorage)
    const pageA2 = await contextA.newPage();
    await pageA2.setViewport({ width: 1440, height: 900 });
    await pageA2.goto(`${baseUrl}/personalizacion`, { waitUntil: 'networkidle2' });
    await pageA2.waitForSelector('.floating-sidebar', { timeout: 10000 });

    // Verificar que ambas pestañas A1 y A2 siguen autenticadas y no se expulsaron entre sí
    const [a1HasSidebar, a2HasSidebar] = await Promise.all([
      pageA1.evaluate(() => Boolean(document.querySelector('.floating-sidebar'))),
      pageA2.evaluate(() => Boolean(document.querySelector('.floating-sidebar')))
    ]);
    assert.strictEqual(a1HasSidebar, true, 'Pestaña A1 debe seguir activa cuando se abre Pestaña A2 en el mismo navegador');
    assert.strictEqual(a2HasSidebar, true, 'Pestaña A2 debe compartir la sesión de Pestaña A1');

    // 2.3 Browser B inicia sesión con la MISMA cuenta OWNER_A
    const pageB = await contextB.newPage();
    await pageB.setViewport({ width: 1440, height: 900 });
    await pageB.goto(baseUrl, { waitUntil: 'networkidle2' });
    await pageB.waitForSelector('#et-login-email', { timeout: 10000 });
    await pageB.type('#et-login-email', OWNER_A_EMAIL);
    await pageB.type('#et-login-password', PASS);
    await Promise.all([
      pageB.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
      pageB.click('button.et-login-submit, button[type="submit"]')
    ]);
    await pageB.waitForSelector('.floating-sidebar', { timeout: 10000 });

    // 2.4 En Browser A (pageA2), realizar una acción/consulta protegida -> debe recibir 401 SESSION_REPLACED, limpiar localStorage y mostrar el mensaje exacto en el DOM
    await pageA2.evaluate(() => {
      // Disparar recarga de datos en /personalizacion que invoca GET /api/tenant/profile
      const reloadBtn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Recargar Datos'));
      if (reloadBtn) reloadBtn.click();
    });

    await pageA2.waitForFunction(
      (expectedMsg) => (document.body?.textContent || '').includes(expectedMsg),
      { timeout: 12000 },
      EXPECTED_REPLACED_MSG
    );

    const localAfterExpel = await pageA2.evaluate(() => ({
      user: window.localStorage.getItem('salon_pro_user'),
      notice: window.sessionStorage.getItem('etereas_session_notice'),
      hasSidebar: Boolean(document.querySelector('.floating-sidebar'))
    }));
    assert.strictEqual(localAfterExpel.user, null, 'Browser A debe limpiar salon_pro_user de localStorage al detectar sesión reemplazada');
    assert.strictEqual(localAfterExpel.notice, EXPECTED_REPLACED_MSG);
    assert.strictEqual(localAfterExpel.hasSidebar, false, 'Browser A debe cerrar el área privada al ser reemplazado por Browser B');

    await contextA.close();
    console.log('  ✅ [PASS] Pestañas del mismo navegador comparten sesión; login en Browser B expulsa a Browser A limpiando storage y mostrando el mensaje exacto.');

    // =========================================================================
    // 3. NAVEGADOR REAL (PUPPETEER): PERSONALIZACIÓN EFECTIVA DEL SIDEBAR REAL + AISLAMIENTO ENTRE EMPRESAS
    // =========================================================================
    console.log('\n[3/3] Verificando en Browser B: cambio de color en DOM -> guardado -> estilo computado del sidebar real -> recarga -> aislamiento frente a otra empresa...');

    await pageB.goto(`${baseUrl}/personalizacion`, { waitUntil: 'networkidle2' });
    await pageB.waitForFunction(
      () => (document.body?.textContent || '').toLowerCase().includes('personalización de tu empresa'),
      { timeout: 10000 }
    );

    // Verificar estilo computado inicial del sidebar real (#0f172a -> rgb(15, 23, 42))
    const initialSidebarStyle = await pageB.evaluate(() => {
      const sb = document.querySelector('.floating-sidebar');
      const wordmark = document.querySelector('.sidebar-etereas-wordmark');
      return {
        bg: sb ? window.getComputedStyle(sb).backgroundColor : null,
        wordmarkText: wordmark ? wordmark.textContent.trim() : null
      };
    });
    assert.strictEqual(initialSidebarStyle.bg, 'rgb(15, 23, 42)', `Fondo inicial esperado rgb(15, 23, 42), recibido: ${initialSidebarStyle.bg}`);
    assert.strictEqual(initialSidebarStyle.wordmarkText, 'ETEREAS', 'La marca de plataforma ETEREAS debe mantenerse en el encabezado del sidebar');

    // Subir logo PNG real mediante input[type="file"]
    const fileInput = await pageB.$('input[type="file"][accept*="image"]');
    assert.ok(fileInput, 'Debe existir input[type="file"] en /personalizacion');
    await fileInput.uploadFile(logoFilePath);
    await new Promise((r) => setTimeout(r, 350));

    // Cambiar colores y nombre comercial mediante los controles reales del DOM
    // Usamos el mismo azul (#114fdf -> rgb(17, 79, 223)) y secundario (#826f30 -> rgb(130, 111, 48)) de la empresa afectada en staging, más acento (#0d9488 -> rgb(13, 148, 136))
    const chosenPrimary = '#114fdf';
    const chosenSecondary = '#826f30';
    const chosenAccent = '#0d9488';
    const chosenName = `Etereas Atelier ${ts}`;

    await pageB.evaluate(({ name, primary, secondary, accent }) => {
      const setVal = (el, val) => {
        if (!el) throw new Error(`Input no encontrado para valor ${val}`);
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const findContainerByLabel = (labelText) => {
        const lbl = Array.from(document.querySelectorAll('label')).find((l) => (l.textContent || '').includes(labelText));
        return lbl ? lbl.parentElement : null;
      };

      const nameInput = findContainerByLabel('Nombre Comercial')?.querySelector('input[type="text"]');
      setVal(nameInput, name);

      const primaryTextInput = findContainerByLabel('--tenant-primary')?.querySelector('input[type="text"]');
      setVal(primaryTextInput, primary);

      const secondaryTextInput = findContainerByLabel('--tenant-secondary')?.querySelector('input[type="text"]');
      setVal(secondaryTextInput, secondary);

      const accentTextInput = findContainerByLabel('--tenant-accent')?.querySelector('input[type="text"]');
      setVal(accentTextInput, accent);
    }, {
      name: chosenName,
      primary: chosenPrimary,
      secondary: chosenSecondary,
      accent: chosenAccent
    });

    // Verificar que el badge WCAG calcula el contraste real dinámicamente (Menú 6.5:1 para #ffffff sobre #114fdf, Mín. 4.8:1 sobre #0d9488)
    const wcagBadgeText = await pageB.evaluate(() => {
      const badge = Array.from(document.querySelectorAll('span')).find((s) => (s.textContent || '').includes('Menú '));
      return badge ? badge.textContent : '';
    });
    assert.ok(
      wcagBadgeText.includes('Menú 6.5:1') && wcagBadgeText.includes('Mín. 4.8:1'),
      `El badge WCAG debe reflejar el contraste real dinámico (Mín. 4.8:1 · Menú 6.5:1), recibido: ${wcagBadgeText}`
    );

    // Guardar cambios pulsando button[type="submit"] y esperar persistencia
    await Promise.all([
      pageB.waitForResponse((res) => res.url().includes('/api/tenant/upload-logo') && res.status() === 200, { timeout: 10000 }),
      pageB.waitForResponse((res) => res.url().includes('/api/tenant/branding') && res.request().method() === 'PUT' && res.status() === 200, { timeout: 10000 }),
      pageB.waitForResponse((res) => res.url().includes('/api/tenant/profile') && res.request().method() === 'PUT' && res.status() === 200, { timeout: 10000 }),
      pageB.click('button[type="submit"]')
    ]);

    // Esperar a que el estilo computado del sidebar REAL (.floating-sidebar) se actualice a rgb(17, 79, 223) (#114fdf)
    await pageB.waitForFunction(
      () => {
        const sb = document.querySelector('.floating-sidebar');
        return sb && window.getComputedStyle(sb).backgroundColor === 'rgb(17, 79, 223)';
      },
      { timeout: 8000 }
    );

    const liveSidebarComputed = await pageB.evaluate(() => {
      const sb = document.querySelector('.floating-sidebar');
      const wordmark = document.querySelector('.sidebar-etereas-wordmark');
      const tenantNameEl = document.querySelector('.sidebar-tenant-card .tenant-name');
      const tenantRoleEl = document.querySelector('.sidebar-tenant-card .tenant-role');
      const tenantLogoEl = document.querySelector('.sidebar-tenant-card .tenant-avatar-img');
      const activeNavLink = document.querySelector('.floating-sidebar .nav-link.active');
      const rootStyle = document.documentElement.style;
      return {
        cssVarPrimary: rootStyle.getPropertyValue('--tenant-primary').trim(),
        cssVarSecondary: rootStyle.getPropertyValue('--tenant-secondary').trim(),
        cssVarAccent: rootStyle.getPropertyValue('--tenant-accent').trim(),
        sidebarBg: window.getComputedStyle(sb).backgroundColor,
        wordmarkText: wordmark ? wordmark.textContent.trim() : null,
        tenantName: tenantNameEl ? tenantNameEl.textContent.trim() : null,
        tenantRoleColor: tenantRoleEl ? window.getComputedStyle(tenantRoleEl).color : null,
        tenantLogoSrc: tenantLogoEl ? tenantLogoEl.getAttribute('src') : null,
        activeNavBg: activeNavLink ? window.getComputedStyle(activeNavLink).backgroundColor : null
      };
    });

    assert.strictEqual(liveSidebarComputed.cssVarPrimary, '#114fdf');
    assert.strictEqual(liveSidebarComputed.cssVarSecondary, '#826f30');
    assert.strictEqual(liveSidebarComputed.cssVarAccent, '#0d9488');
    assert.strictEqual(liveSidebarComputed.sidebarBg, 'rgb(17, 79, 223)', 'El sidebar real debe aplicar el color primario elegido (nunca quedarse negro)');
    assert.strictEqual(liveSidebarComputed.wordmarkText, 'ETEREAS', 'ETEREAS debe mantenerse como marca de plataforma');
    assert.strictEqual(liveSidebarComputed.tenantName, chosenName, 'El bloque de identidad debe mostrar el nuevo nombre de la empresa');
    assert.strictEqual(liveSidebarComputed.tenantRoleColor, 'rgb(130, 111, 48)', 'El rol/subtítulo del bloque de empresa debe reflejar --tenant-secondary');
    assert.ok(liveSidebarComputed.tenantLogoSrc && liveSidebarComputed.tenantLogoSrc.startsWith(`/api/public/branding/${TENANT_A}/logo/`), `Logo en sidebar real inválido: ${liveSidebarComputed.tenantLogoSrc}`);
    assert.strictEqual(liveSidebarComputed.activeNavBg, 'rgb(13, 148, 136)', 'El ítem activo del menú debe reflejar --tenant-accent');

    // Recargar la página y comprobar que el sidebar real conserva los estilos computados, logo y nombre
    await pageB.reload({ waitUntil: 'networkidle2' });
    await pageB.waitForSelector('.floating-sidebar', { timeout: 10000 });
    await pageB.waitForFunction(
      () => {
        const sb = document.querySelector('.floating-sidebar');
        return sb && window.getComputedStyle(sb).backgroundColor === 'rgb(17, 79, 223)';
      },
      { timeout: 8000 }
    );

    const afterReloadSidebar = await pageB.evaluate(() => {
      const sb = document.querySelector('.floating-sidebar');
      const tenantNameEl = document.querySelector('.sidebar-tenant-card .tenant-name');
      const tenantLogoEl = document.querySelector('.sidebar-tenant-card .tenant-avatar-img');
      return {
        sidebarBg: window.getComputedStyle(sb).backgroundColor,
        tenantName: tenantNameEl ? tenantNameEl.textContent.trim() : null,
        tenantLogoSrc: tenantLogoEl ? tenantLogoEl.getAttribute('src') : null
      };
    });
    assert.strictEqual(afterReloadSidebar.sidebarBg, 'rgb(17, 79, 223)');
    assert.strictEqual(afterReloadSidebar.tenantName, chosenName);
    assert.strictEqual(afterReloadSidebar.tenantLogoSrc, liveSidebarComputed.tenantLogoSrc);

    // Cerrar sesión e iniciar sesión con OWNER_B (Empresa Beta) en el MISMO navegador -> verificar 0 contaminación de colores o logo
    await pageB.evaluate(() => {
      const logoutBtn = document.querySelector('.logout-btn');
      if (logoutBtn) logoutBtn.click();
    });
    await pageB.waitForSelector('#et-login-email', { timeout: 10000 });

    await pageB.type('#et-login-email', OWNER_B_EMAIL);
    await pageB.type('#et-login-password', PASS);
    await Promise.all([
      pageB.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
      pageB.click('button.et-login-submit, button[type="submit"]')
    ]);
    await pageB.waitForSelector('.floating-sidebar', { timeout: 10000 });

    const ownerBSidebar = await pageB.evaluate(() => {
      const sb = document.querySelector('.floating-sidebar');
      const tenantNameEl = document.querySelector('.sidebar-tenant-card .tenant-name');
      const tenantLogoEl = document.querySelector('.sidebar-tenant-card .tenant-avatar-img');
      return {
        sidebarBg: window.getComputedStyle(sb).backgroundColor,
        tenantName: tenantNameEl ? tenantNameEl.textContent.trim() : null,
        hasLogo: Boolean(tenantLogoEl)
      };
    });
    assert.strictEqual(ownerBSidebar.sidebarBg, 'rgb(15, 23, 42)', 'Empresa Beta NO debe heredar el color #114fdf de Empresa Alpha');
    assert.strictEqual(ownerBSidebar.tenantName, 'Empresa Beta Aislada', 'Empresa Beta debe mostrar su propio nombre comercial');
    assert.strictEqual(ownerBSidebar.hasLogo, false, 'Empresa Beta NO debe heredar el logo de Empresa Alpha');

    await contextB.close();
    console.log('  ✅ [PASS] Estilos computados del sidebar real, contraste dinámico, persistencia tras recarga y aislamiento entre empresas verificados.');

    console.log('\n========================================================================');
    console.log('🎉 SUITE E2E PERSONALIZACIÓN EFECTIVA + SESIÓN ÚNICA COMPLETADA (100% PASS)');
    console.log('========================================================================\n');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((resolve) => server.close(resolve)).catch(() => {});
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    await pool.query('DELETE FROM kiosk_employee_sessions WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM kiosk_devices WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM user_sessions WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.end().catch(() => {});
  }
}

runSuite().catch((err) => {
  console.error('\n❌ FALLO EN SUITE E2E PERSONALIZACIÓN Y SESIÓN ÚNICA:', err);
  process.exit(1);
});
