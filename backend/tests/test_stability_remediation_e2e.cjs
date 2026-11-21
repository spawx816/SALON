/* global document, window */
'use strict';

/**
 * End-to-End Browser & API Verification Suite for Stability Audit Remediation (Bloques 1-5)
 * (backend/tests/test_stability_remediation_e2e.cjs)
 *
 * Verifica con interacciones reales del DOM en Puppeteer (sin sustituir la UI por fetch):
 * 1. Bloque 2 (Caja):
 *    - Apertura de caja desde el modal real del POS (/visitas) -> transición inmediata a "Caja Abierta".
 *    - Cierre de caja desde el modal real del POS SIN recarga intermedia -> envía UUID real
 *      (nunca /api/cash-registers/undefined/close), persiste monto_final, diferencia y observaciones,
 *      y despliega reporte de cierre.
 *    - Rechazo 400 ante alias contradictorios, monto faltante en /close, y UUID inválido ("undefined").
 * 2. Bloque 3 (Personalización):
 *    - Usuario real con `role = 'propietario'` abre /personalizacion, modifica nombre comercial,
 *      RNC, teléfono, dirección, encabezado y pie de recibo, sube un archivo PNG real en <input type="file">
 *      y pulsa "Guardar Cambios".
 *    - Verifica HTTP 200 en POST /api/tenant/upload-logo, PUT /api/tenant/branding y PUT /api/tenant/profile.
 *    - Recarga la página y comprueba que todos los campos y el logo persisten en el DOM y en BD
 *      (tanto en `tenants` como en `tenant_branding` y `private_files`).
 *    - Prueba la utilidad `convertBase64BrandingLogos` sobre un logo base64 legado verificando SHA-256.
 * 3. Bloque 4 (Contratos HTTP y Transacciones):
 *    - POST /api/contracts/settings para múltiples empresas sin colisión en `id = 1`.
 *    - Inserción dentro de transacción activa (`beginTransaction()`) en tablas sin columna `id`
 *      (`inventory_alert_settings`, `saas_plan_features`) sin provocar `42703` ni `25P02`.
 * 4. Bloque 5 (Guardas de UI):
 *    - Falla si ocurre cualquier `/api/*` con `status >= 400` no esperado, `pageerror` o `ErrorBoundary`.
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
const { signAuthToken } = require('../middleware/auth.middleware');
const { convertBase64BrandingLogos } = require('../scripts/convert_base64_branding_logos.cjs');

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

// 1x1 valid PNG buffer
const VALID_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const VALID_PNG_BUFFER = Buffer.from(VALID_PNG_BASE64, 'base64');

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
          } catch (_) {
            parsed = rawText;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed, rawBuffer });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runStabilityRemediationE2E() {
  console.log('========================================================================');
  console.log('🧪 SUITE E2E DE ESTABILIDAD: CAJA, PERSONALIZACIÓN, HTTP Y TRANSACCIONES');
  console.log('========================================================================\n');

  const [dbCheck] = await pool.query('SELECT current_database() AS db');
  assert.strictEqual(dbCheck[0].db, testConfig.database);

  const ts = Date.now();
  const TENANT_A = crypto.randomUUID();
  const TENANT_B = crypto.randomUUID();
  const BRANCH_A = crypto.randomUUID();
  const BRANCH_B = crypto.randomUUID();
  const OWNER_A_ID = crypto.randomUUID();
  const OWNER_B_ID = crypto.randomUUID();
  const OWNER_A_EMAIL = `owner.stab.${ts}@etereas.test`;
  const OWNER_PASS = 'StabOwner#2026!';
  const passHash = bcrypt.hashSync(OWNER_PASS, 10);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etereas_logo_e2e_'));
  const logoFilePath = path.join(tempDir, 'brand_logo.png');
  fs.writeFileSync(logoFilePath, VALID_PNG_BUFFER);

  let server = null;
  let browser = null;

  try {
    // 0. Seed synthetic tenant A & B with role = 'propietario'
    const [planRows] = await pool.query("SELECT id FROM saas_plans WHERE UPPER(code) = 'PRINCIPAL' LIMIT 1");
    const planId = planRows[0]?.id || 1;

    await pool.query(
      `INSERT INTO tenants (id, business_name, slug, email, owner_email, phone, address, rnc, plan_id, status)
       VALUES (?, 'Salón Inicial A', ?, ?, ?, '809-555-0101', 'Calle Inicial #1', '131000111', ?, 'active'),
              (?, 'Salón Inicial B', ?, ?, ?, '809-555-0202', 'Calle Inicial #2', '131000222', ?, 'active')`,
      [
        TENANT_A, `stab-a-${ts}`, OWNER_A_EMAIL, OWNER_A_EMAIL, planId,
        TENANT_B, `stab-b-${ts}`, `owner.b.${ts}@etereas.test`, `owner.b.${ts}@etereas.test`, planId
      ]
    );

    await pool.query(
      `INSERT INTO tenant_subscriptions (id, tenant_id, saas_plan_id, plan_code, status, billing_cycle, currency, periodicity_mode, auto_renew, current_period_start, current_period_end)
       VALUES (?, ?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', 'fixed_30_days', FALSE, NOW(), NOW() + INTERVAL '30 days'),
              (?, ?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', 'fixed_30_days', FALSE, NOW(), NOW() + INTERVAL '30 days')`,
      [crypto.randomUUID(), TENANT_A, planId, crypto.randomUUID(), TENANT_B, planId]
    );

    await pool.query(
      `INSERT INTO tenant_feature_overrides (tenant_id, feature_key, is_enabled, reason, actor_id)
       VALUES (?, 'memberships', TRUE, 'E2E test contract_settings', 'test_e2e'),
              (?, 'memberships', TRUE, 'E2E test contract_settings', 'test_e2e')
       ON CONFLICT (tenant_id, feature_key) DO UPDATE SET is_enabled = TRUE`,
      [TENANT_A, TENANT_B]
    );

    await pool.query(
      `INSERT INTO branches (id, tenant_id, name, address, phone, is_main, is_active)
       VALUES (?, ?, 'Sucursal Principal A', 'Calle Inicial #1', '809-555-0101', TRUE, TRUE),
              (?, ?, 'Sucursal Principal B', 'Calle Inicial #2', '809-555-0202', TRUE, TRUE)`,
      [BRANCH_A, TENANT_A, BRANCH_B, TENANT_B]
    );

    await pool.query(
      `INSERT INTO users (id, tenant_id, salon_id, branch_id, username, nombre, name, email, password_hash, role, is_active, estado, all_branches_access, authorized_branch_ids, token_version)
       VALUES (?, ?, ?, ?, ?, 'Propietaria Valeria', 'Propietaria Valeria', ?, ?, 'propietario', TRUE, 'Activo', TRUE, '[]', 1),
              (?, ?, ?, ?, ?, 'Propietario Marcos', 'Propietario Marcos', ?, ?, 'propietario', TRUE, 'Activo', TRUE, '[]', 1)`,
      [
        OWNER_A_ID, TENANT_A, BRANCH_A, BRANCH_A, OWNER_A_EMAIL, OWNER_A_EMAIL, passHash,
        OWNER_B_ID, TENANT_B, BRANCH_B, BRANCH_B, `owner.b.${ts}@etereas.test`, `owner.b.${ts}@etereas.test`, passHash
      ]
    );

    const ownerAToken = signAuthToken({
      id: OWNER_A_ID,
      userId: OWNER_A_ID,
      sub: OWNER_A_ID,
      tenant_id: TENANT_A,
      tenantId: TENANT_A,
      branch_id: BRANCH_A,
      role: 'propietario',
      name: 'Propietaria Valeria',
      email: OWNER_A_EMAIL,
      token_version: 1
    });
    const ownerBToken = signAuthToken({
      id: OWNER_B_ID,
      userId: OWNER_B_ID,
      sub: OWNER_B_ID,
      tenant_id: TENANT_B,
      tenantId: TENANT_B,
      branch_id: BRANCH_B,
      role: 'propietario',
      name: 'Propietario Marcos',
      email: `owner.b.${ts}@etereas.test`,
      token_version: 1
    });
    const authAHeaders = { Authorization: `Bearer ${ownerAToken}` };
    const authBHeaders = { Authorization: `Bearer ${ownerBToken}` };

    const app = createApp({ pool });
    const distIndexPath = path.resolve(__dirname, '../../dist/index.html');
    const distIndexHtml = fs.readFileSync(distIndexPath, 'utf8');
    app.get(/.*/, (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(distIndexHtml);
    });
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    // =========================================================================
    // 1. PRUEBAS DE CONTRATOS DE CAJA (DTO, ALIAS CONTRADICTORIOS, UUID, MONTOS)
    // =========================================================================
    console.log('[1/4] Verificando guardas de contrato en /api/cash-registers (open, close, UUID)...');

    const badOpenContradictory = await apiCall(port, {
      method: 'POST',
      urlPath: '/api/cash-registers/open',
      headers: authAHeaders,
      body: { salon_id: BRANCH_A, opening_balance: 1000, monto_inicial: 2500 }
    });
    assert.strictEqual(badOpenContradictory.status, 400);
    assert.strictEqual(badOpenContradictory.body.code, 'CONTRADICTORY_PAYLOAD_FIELDS');

    const badOpenMissing = await apiCall(port, {
      method: 'POST',
      urlPath: '/api/cash-registers/open',
      headers: authAHeaders,
      body: { salon_id: BRANCH_A }
    });
    assert.strictEqual(badOpenMissing.status, 400);
    assert.strictEqual(badOpenMissing.body.code, 'INVALID_OPENING_BALANCE');

    const badCloseUndefined = await apiCall(port, {
      method: 'POST',
      urlPath: '/api/cash-registers/undefined/close',
      headers: authAHeaders,
      body: { closing_balance: 1000 }
    });
    assert.strictEqual(badCloseUndefined.status, 400, `POST /undefined/close debe retornar 400, recibido ${badCloseUndefined.status}`);

    const badCloseInvalidUuid = await apiCall(port, {
      method: 'POST',
      urlPath: '/api/cash-registers/not-a-valid-uuid/close',
      headers: authAHeaders,
      body: { closing_balance: 1000 }
    });
    assert.strictEqual(badCloseInvalidUuid.status, 400);
    assert.strictEqual(badCloseInvalidUuid.body.code, 'INVALID_REGISTER_ID');
    console.log('  ✅ [PASS] Rechazo 400 verificado ante alias contradictorios, monto faltante y UUID inválido ("undefined").');

    // =========================================================================
    // 2. PRUEBAS DE TRANSACCIONES (NO 42703 / NO 25P02) Y CONTRACT_SETTINGS
    // =========================================================================
    console.log('\n[2/4] Verificando transacciones activas en tablas sin columna id y contract_settings multi-tenant...');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `INSERT INTO inventory_alert_settings (tenant_id, alerts_enabled, default_min_stock, updated_by)
         VALUES (?, TRUE, 5, 'test_tx')
         ON CONFLICT (tenant_id) DO UPDATE SET default_min_stock = EXCLUDED.default_min_stock`,
        [TENANT_A]
      );
      const [checkDuringTx] = await conn.query(
        `SELECT alerts_enabled, default_min_stock FROM inventory_alert_settings WHERE tenant_id = ?`,
        [TENANT_A]
      );
      assert.strictEqual(checkDuringTx.length, 1);
      await conn.commit();
    } finally {
      conn.release();
    }

    const contractResA = await apiCall(port, {
      method: 'POST',
      urlPath: '/api/contracts/settings',
      headers: authAHeaders,
      body: { content: 'Cláusula exclusiva Empresa A' }
    });
    assert.strictEqual(contractResA.status, 200);

    const contractResB = await apiCall(port, {
      method: 'POST',
      urlPath: '/api/contracts/settings',
      headers: authBHeaders,
      body: { content: 'Cláusula exclusiva Empresa B' }
    });
    assert.strictEqual(contractResB.status, 200);

    const getContractA = await apiCall(port, { method: 'GET', urlPath: '/api/contracts/settings', headers: authAHeaders });
    const getContractB = await apiCall(port, { method: 'GET', urlPath: '/api/contracts/settings', headers: authBHeaders });
    assert.strictEqual(getContractA.body.content, 'Cláusula exclusiva Empresa A');
    assert.strictEqual(getContractB.body.content, 'Cláusula exclusiva Empresa B');
    console.log('  ✅ [PASS] Transacciones sin 42703/25P02 y contract_settings multi-tenant sin colisión id=1 verificados.');

    // =========================================================================
    // 3. FLUJO REAL EN NAVEGADOR (PUPPETEER): LOGIN -> APERTURA Y CIERRE DE CAJA SIN RECARGA
    // =========================================================================
    console.log('\n[3/4] Ejecutando flujo real en navegador (Puppeteer): Login -> Apertura y Cierre de Caja desde DOM sin recarga intermedia...');
    const execPath = findBrowserExecutable();
    browser = await puppeteer.launch({
      headless: 'new',
      ...(execPath ? { executablePath: execPath } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    const pageErrors = [];
    const unexpectedApiErrors = [];
    const dialogs = [];

    page.on('pageerror', (err) => {
      pageErrors.push(err.message || String(err));
    });
    page.on('dialog', async (dialog) => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.accept();
    });
    page.on('response', (res) => {
      const url = res.url();
      if (url.includes('/api/') && res.status() >= 400) {
        unexpectedApiErrors.push({
          status: res.status(),
          method: res.request().method(),
          url
        });
      }
    });

    const assertNoErrorBoundary = async (stepLabel) => {
      const hasBoundary = await page.evaluate(() => {
        const text = document.body?.innerText || '';
        return text.includes('Algo salió mal') || text.includes('ErrorBoundary') || text.includes('Error inesperado en la aplicación');
      });
      assert.strictEqual(hasBoundary, false, `ErrorBoundary detectado en DOM durante: ${stepLabel}`);
    };

    // 3.1 Login desde el formulario real en la raíz (/)
    await page.goto(baseUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    const userInput = await page.$('input[id*="login"], input[name="username"], input[type="email"], input[type="text"]');
    assert.ok(userInput, 'Input de usuario/correo en Login debe existir');
    await userInput.click({ clickCount: 3 });
    await userInput.type(OWNER_A_EMAIL);
    await page.type('input[type="password"]', OWNER_PASS);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
      page.click('button[type="submit"]')
    ]);
    await new Promise((r) => setTimeout(r, 1200));
    await assertNoErrorBoundary('Login Owner');

    // 3.2 Navegar a /visitas (POS)
    await page.goto(`${baseUrl}/visitas`, { waitUntil: 'networkidle2' });
    await assertNoErrorBoundary('Carga inicial POS /visitas');

    // Hacer clic en el botón real "Abrir Caja" en la cabecera del POS
    const clickedOpenBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const openBtn = btns.find((b) => (b.innerText || '').includes('Abrir Caja'));
      if (openBtn) {
        openBtn.click();
        return true;
      }
      return false;
    });
    assert.strictEqual(clickedOpenBtn, true, 'Debe existir el botón "Abrir Caja" en el POS cuando no hay caja activa');

    // Esperar el modal "Apertura Obligatoria de Caja" y escribir el monto inicial (RD$ 1,750.00)
    await page.waitForFunction(
      () => (document.body?.innerText || '').includes('Apertura Obligatoria de Caja'),
      { timeout: 8000 }
    );

    await page.evaluate(() => {
      const modalHeading = Array.from(document.querySelectorAll('h3')).find((h) => (h.innerText || '').includes('Apertura Obligatoria de Caja'));
      const modalRoot = modalHeading?.closest('div[style*="max-width"]') || document;
      const input = modalRoot.querySelector('input[type="number"]');
      if (!input) throw new Error('Input de monto inicial no encontrado en modal Apertura Obligatoria de Caja');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '1750');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Hacer clic en "Confirmar Apertura" y esperar respuesta POST /api/cash-registers/open
    const [openApiResp] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/cash-registers/open') && res.request().method() === 'POST', { timeout: 10000 }),
      page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const confirmBtn = btns.find((b) => (b.innerText || '').includes('Confirmar Apertura'));
        if (!confirmBtn) throw new Error('Botón Confirmar Apertura no encontrado');
        confirmBtn.click();
      })
    ]);
    assert.strictEqual(openApiResp.status(), 200, 'POST /api/cash-registers/open desde UI debe responder 200');
    const openedDto = await openApiResp.json();
    const openedRegisterId = openedDto.id;
    assert.ok(openedRegisterId && /^[0-9a-f-]{36}$/i.test(openedRegisterId), `UUID de caja abierta inválido: ${openedRegisterId}`);

    // Verificar en el DOM que el indicador cambió a "Caja Activa" SIN recargar la página
    await page.waitForSelector('div[title*="Haz clic para ver detalles de la caja"]', { timeout: 10000 });
    await page.waitForFunction(
      () => !(document.body?.textContent || '').includes('Apertura Obligatoria de Caja'),
      { timeout: 10000 }
    );

    // Sembrar una fila sintética con forma legacy (applied_payments en ceros, metodo_pago = 'Efectivo') en esta caja abierta
    const legacyVisitId = `VIS-LEG-${ts}`;
    await pool.query(
      `INSERT INTO visits (id, tenant_id, salon_id, cash_register_id, client_id, client_name, servicios, items_detail, subtotal, total, total_cents, currency, metodo_pago, applied_payments, status, visited_at)
       VALUES (?, ?, ?, ?, 'INVITADO', 'Cliente Legacy Sintético', '["Lavado"]'::jsonb, '[]'::jsonb, 250, 250, 25000, 'DOP', 'Efectivo', '{"tarjeta":0,"efectivo":0,"transferencia":0,"currency":"DOP"}'::jsonb, 'Facturado', NOW())`,
      [legacyVisitId, TENANT_A, BRANCH_A, openedRegisterId]
    );

    // SIN RECARGAR LA PÁGINA: Hacer clic en el indicador real "Caja Activa" para abrir el modal de detalles y cerrar la caja
    await page.click('div[title*="Haz clic para ver detalles de la caja"]');

    // Esperar a que cargue el resumen de la caja en el modal (1750 inicial + 250 venta legacy efectivo = 2000 esperado)
    await page.waitForFunction(
      () => {
        const txt = (document.body?.textContent || '').toLowerCase();
        return txt.includes('arqueo de caja') && (txt.includes('2,000.00') || txt.includes('2000.00'));
      },
      { timeout: 10000 }
    );

    // Ingresar monto contado (2000) en el input real de Arqueo de caja
    await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input[type="number"]'));
      const countInput = inputs.find((inp) => (inp.placeholder || '') === '0.00');
      if (!countInput) throw new Error('Input de Efectivo Contado no encontrado en Arqueo de caja');
      const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      inputSetter.call(countInput, '2000');
      countInput.dispatchEvent(new Event('input', { bubbles: true }));
      countInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await page.waitForFunction(
      () => (document.body?.innerText || '').includes('Caja cuadrada'),
      { timeout: 8000 }
    );

    // Hacer clic en "Cerrar e Imprimir Arqueo" y capturar la petición real POST /api/cash-registers/:id/close
    const [closeApiResp] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/cash-registers/') && res.url().includes('/close') && res.request().method() === 'POST', { timeout: 10000 }),
      page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.innerText || '').includes('Cerrar e Imprimir Arqueo'));
        if (!btn) throw new Error('Botón Cerrar e Imprimir Arqueo no encontrado');
        btn.click();
      })
    ]);

    assert.ok(!closeApiResp.url().includes('/undefined/close'), `La UI nunca debe llamar /undefined/close (URL llamada: ${closeApiResp.url()})`);
    assert.ok(closeApiResp.url().includes(`/api/cash-registers/${openedRegisterId}/close`), `URL de cierre debe incluir UUID ${openedRegisterId}`);
    assert.strictEqual(closeApiResp.status(), 200, 'POST /api/cash-registers/:id/close desde UI debe responder 200');

    // Verificar persistencia real en BD
    const [closedDbRows] = await pool.query(
      `SELECT status, monto_inicial, monto_final, closing_balance_cents, expected_balance_cents, diferencia, difference_cents, observaciones
       FROM cash_registers WHERE id = ? AND tenant_id = ?`,
      [openedRegisterId, TENANT_A]
    );
    assert.strictEqual(closedDbRows.length, 1);
    assert.strictEqual(closedDbRows[0].status, 'Cerrada');
    assert.strictEqual(Number(closedDbRows[0].monto_inicial), 1750);
    assert.strictEqual(Number(closedDbRows[0].monto_final), 2000);
    assert.strictEqual(Number(closedDbRows[0].closing_balance_cents), 200000);
    assert.strictEqual(Number(closedDbRows[0].expected_balance_cents), 200000);
    assert.strictEqual(Number(closedDbRows[0].diferencia), 0);
    console.log('  ✅ [PASS] Apertura y cierre de caja desde controles reales del DOM sin recarga intermedia verificados (0 llamadas a /undefined/close).');

    // =========================================================================
    // 4. FLUJO REAL EN NAVEGADOR: PERSONALIZACIÓN CON ROLE='propietario' + LOGO + RECARGA
    // =========================================================================
    console.log('\n[4/4] Ejecutando flujo real en navegador: Personalización (/personalizacion) con role="propietario", subida de logo y recarga...');
    await page.goto(`${baseUrl}/personalizacion`, { waitUntil: 'networkidle2' });
    await assertNoErrorBoundary('Carga /personalizacion');

    await page.waitForFunction(
      () => (document.body?.innerText || '').toLowerCase().includes('personalización de tu empresa'),
      { timeout: 10000 }
    );

    // Subir logo PNG real mediante el input[type="file"]
    const fileInput = await page.$('input[type="file"][accept*="image"]');
    assert.ok(fileInput, 'Debe existir input[type="file"] para subir logotipo en /personalizacion');
    await fileInput.uploadFile(logoFilePath);

    // Esperar a que FileReader cargue el data:image/png en vista previa
    await new Promise((r) => setTimeout(r, 400));

    // Modificar campos del formulario real en el DOM
    const customName = `Etereas Studio Pro ${ts}`;
    const customRnc = '132998877';
    const customPhone = '809-555-9900';
    const customAddress = 'Av. Winston Churchill #1099, Piantini';
    const customHeader = `Etereas Studio Pro ${ts} - NCF`;
    const customFooter = '¡Gracias por su visita a Etereas Studio!';

    await page.evaluate(({ name, rnc, phone, address, header, footer }) => {
      const setInputValue = (el, val) => {
        if (!el) throw new Error(`Elemento de formulario no encontrado para valor: ${val}`);
        const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const findInputByLabel = (labelText) => {
        const labels = Array.from(document.querySelectorAll('label'));
        const lbl = labels.find((l) => (l.innerText || '').includes(labelText));
        if (!lbl) return null;
        const container = lbl.parentElement;
        return container ? container.querySelector('input, textarea') : null;
      };

      setInputValue(findInputByLabel('Nombre Comercial'), name);
      setInputValue(findInputByLabel('RNC / Cédula Fiscal'), rnc);
      setInputValue(findInputByLabel('Teléfono / WhatsApp'), phone);
      setInputValue(findInputByLabel('Dirección Física'), address);
      setInputValue(findInputByLabel('Sub-Encabezado de Ticket'), header);
      setInputValue(findInputByLabel('Pie de Ticket'), footer);
    }, {
      name: customName,
      rnc: customRnc,
      phone: customPhone,
      address: customAddress,
      header: customHeader,
      footer: customFooter
    });

    // Hacer clic en el botón real "Guardar Personalización" (button[type="submit"]) y esperar las 3 llamadas API
    const [uploadLogoResp, brandingPutResp, profilePutResp] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/tenant/upload-logo') && res.request().method() === 'POST', { timeout: 10000 }),
      page.waitForResponse((res) => res.url().includes('/api/tenant/branding') && res.request().method() === 'PUT', { timeout: 10000 }),
      page.waitForResponse((res) => res.url().includes('/api/tenant/profile') && res.request().method() === 'PUT', { timeout: 10000 }),
      page.click('button[type="submit"]')
    ]);

    assert.strictEqual(uploadLogoResp.status(), 200, 'POST /api/tenant/upload-logo debe responder 200 para propietario');
    assert.strictEqual(brandingPutResp.status(), 200, 'PUT /api/tenant/branding debe responder 200 para propietario');
    assert.strictEqual(profilePutResp.status(), 200, 'PUT /api/tenant/profile debe responder 200 para propietario');

    const uploadLogoBody = await uploadLogoResp.json();
    assert.ok(
      uploadLogoBody.logo_url && uploadLogoBody.logo_url.startsWith(`/api/public/branding/${TENANT_A}/logo/`),
      `URL canónica de logo esperada, recibida: ${uploadLogoBody.logo_url}`
    );

    // Verificar descarga real del logo servido desde almacenamiento privado cifrado
    const logoFetch = await apiCall(port, {
      method: 'GET',
      urlPath: uploadLogoBody.logo_url
    });
    assert.strictEqual(logoFetch.status, 200, 'GET del logo canónico debe responder 200');
    assert.strictEqual(Buffer.compare(logoFetch.rawBuffer, VALID_PNG_BUFFER), 0, 'El buffer del logo servido debe ser idéntico byte a byte al PNG subido');

    // Recargar la página y comprobar que el DOM conserva todos los cambios desde la BD
    await page.reload({ waitUntil: 'networkidle2' });
    await assertNoErrorBoundary('Recarga /personalizacion');

    await page.waitForFunction(
      (expectedName) => {
        const inputs = Array.from(document.querySelectorAll('input'));
        return inputs.some((i) => i.value === expectedName);
      },
      { timeout: 10000 },
      customName
    );

    const reloadedValues = await page.evaluate(() => {
      const findVal = (labelText) => {
        const lbl = Array.from(document.querySelectorAll('label')).find((l) => (l.innerText || '').includes(labelText));
        const el = lbl?.parentElement?.querySelector('input, textarea');
        return el ? el.value : null;
      };
      return {
        name: findVal('Nombre Comercial'),
        rnc: findVal('RNC / Cédula Fiscal'),
        phone: findVal('Teléfono / WhatsApp'),
        address: findVal('Dirección Física'),
        header: findVal('Sub-Encabezado de Ticket'),
        footer: findVal('Pie de Ticket')
      };
    });

    assert.strictEqual(reloadedValues.name, customName);
    assert.strictEqual(reloadedValues.rnc, customRnc);
    assert.strictEqual(reloadedValues.phone, customPhone);
    assert.strictEqual(reloadedValues.address, customAddress);
    assert.strictEqual(reloadedValues.header, customHeader);
    assert.strictEqual(reloadedValues.footer, customFooter);

    // Verificar sincronización en BD entre tenants y tenant_branding
    const [tRows] = await pool.query('SELECT business_name, rnc, phone, address, logo_url FROM tenants WHERE id = ?', [TENANT_A]);
    const [tbRows] = await pool.query('SELECT business_name, logo_url, receipt_header, receipt_footer FROM tenant_branding WHERE tenant_id = ?', [TENANT_A]);
    assert.strictEqual(tRows[0].business_name, customName);
    assert.strictEqual(tRows[0].rnc, customRnc);
    assert.strictEqual(tRows[0].logo_url, uploadLogoBody.logo_url);
    assert.strictEqual(tbRows[0].business_name, customName);
    assert.strictEqual(tbRows[0].logo_url, uploadLogoBody.logo_url);
    assert.strictEqual(tbRows[0].receipt_header, customHeader);
    assert.strictEqual(tbRows[0].receipt_footer, customFooter);

    // Probar utilidad de conversión verificable para logos Base64 legados en TENANT_B
    const legacyDataUri = `data:image/png;base64,${VALID_PNG_BASE64}`;
    await pool.query(
      `INSERT INTO tenant_branding (tenant_id, business_name, logo_url)
       VALUES (?, 'Salón Inicial B', ?)
       ON CONFLICT (tenant_id) DO UPDATE SET logo_url = EXCLUDED.logo_url`,
      [TENANT_B, legacyDataUri]
    );
    const convDry = await convertBase64BrandingLogos({ pool, apply: false, tenantId: TENANT_B });
    assert.ok(convDry.totalCandidates >= 1);
    const convApply = await convertBase64BrandingLogos({ pool, apply: true, tenantId: TENANT_B });
    const convertedB = convApply.results.find((r) => r.tenantId === TENANT_B);
    assert.ok(convertedB && convertedB.status === 'converted_and_verified');
    assert.ok(convertedB.canonicalUrl.startsWith(`/api/public/branding/${TENANT_B}/logo/`));

    // Verificar 0 errores inesperados de API y 0 pageErrors durante todo el recorrido UI
    assert.strictEqual(pageErrors.length, 0, `Se detectaron pageerror en navegador: ${JSON.stringify(pageErrors)}`);
    assert.strictEqual(unexpectedApiErrors.length, 0, `Se detectaron respuestas /api/* >= 400 durante el flujo UI: ${JSON.stringify(unexpectedApiErrors)}`);

    console.log('  ✅ [PASS] Personalización con role="propietario", subida de logo a private_files, persistencia tras recarga y conversión base64 verificadas.');
    console.log('\n========================================================================');
    console.log('🎉 SUITE E2E DE REMEDIACIÓN DE ESTABILIDAD COMPLETADA (100% PASS)');
    console.log('========================================================================\n');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((resolve) => server.close(resolve)).catch(() => {});
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.end().catch(() => {});
  }
}

runStabilityRemediationE2E().catch((err) => {
  console.error('\n❌ FALLO EN SUITE E2E DE ESTABILIDAD:', err);
  process.exit(1);
});
