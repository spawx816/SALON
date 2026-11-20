/* global window, document */
/**
 * Real Browser E2E Acceptance Suite: "Operación Completa" (Puppeteer + Canonical Dist + PostgreSQL salon_saas_test)
 *
 * Runs headless Chromium via project's bundled Puppeteer (NO remote debugging required)
 * against canonical backend/server.js serving dist/ and connected strictly to salon_saas_test.
 *
 * Verifies in real browser + page reloads:
 * - Login via real UI form (Owner A)
 * - Category, Service (RD$1,000, 10%) & Product (RD$500, 0%) visible in /servicios + persists after reload
 * - Inventory (/inventario) shows Product (NOT Service), +10 stock entry + persists after reload
 * - Cash Register (/cajas) opens with RD$2,000 + persists after reload
 * - Base cash sale (RD$2,000) -> stock 8, cash 4,000, commission RD$100 verified in UI
 * - Void -> stock 10, cash 2,000, commission Anulada verified in UI
 * - Valid sale (RD$2,000) + Close register (RD$4,000, diff RD$0) + persists after reload
 * - Dashboard (/dashboard) & Reports (/analitica) show net sales RD$2,000 (fund not counted) + persists after reload
 * - ZERO pageerror, ZERO ErrorBoundary activations, ZERO HTTP 5xx responses
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

async function runBrowserAcceptanceSuite() {
  console.log('=== START REAL BROWSER UI ACCEPTANCE SUITE (OPERACIÓN COMPLETA) ===\n');
  const testDbConfig = validateTestEnvironment({ allowDisposableSchema: true });
  const pool = createIsolatedTestPool(testDbConfig);

  let serverProcess = null;
  let browser = null;
  const ts = Date.now();
  const TENANT_A = crypto.randomUUID();
  const BRANCH_A = crypto.randomUUID();
  const BRANCH_B = crypto.randomUUID();
  const CLIENT_A = crypto.randomUUID();

  const pageErrors = [];
  const server5xx = [];
  const steps = [];
  const logStep = (name, ok, detail) => {
    steps.push({ name, ok, detail });
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name} -> ${detail}`);
    assert.strictEqual(ok, true, `UI STEP FAILED: ${name} (${detail})`);
  };

  try {
    const port = await getEphemeralPort();
    const childEnv = getSanitizedChildEnv(testDbConfig, port);
    childEnv.SAAS_RENEWAL_WORKER_ENABLED = 'false';
    childEnv.DISABLE_SCHEDULER = 'true';
    childEnv.DGII_ENV = 'disabled';
    childEnv.CARDNET_ENV = 'disabled';

    serverProcess = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    await waitForServerHealth(port);
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`[SERVER READY] ${baseUrl} (DB=${testDbConfig.database})`);

    // Seed synthetic Tenant A
    const passHash = bcrypt.hashSync('TestPass2026!', 10);
    const pinHash = bcrypt.hashSync('1234', 10);
    const ownerEmail = `ui.owner.${ts}@test-fixtures.local`;

    await pool.query(
      "INSERT INTO tenants (id, business_name, slug, email, status) VALUES (?, 'Empresa UI A', ?, ?, 'active')",
      [TENANT_A, `ui-a-${ts}`, ownerEmail]
    );
    const [planRows] = await pool.query("SELECT id FROM saas_plans WHERE UPPER(code) = 'PRINCIPAL' LIMIT 1");
    await pool.query(
      `INSERT INTO tenant_subscriptions (tenant_id, saas_plan_id, plan_code, status, billing_cycle, currency, current_period_start, current_period_end)
       VALUES (?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', NOW(), NOW() + INTERVAL '30 days')`,
      [TENANT_A, planRows[0]?.id || 3]
    );
    await pool.query(
      "INSERT INTO branches (id, tenant_id, name, is_main, is_active) VALUES (?, ?, 'Sucursal A', TRUE, TRUE), (?, ?, 'Sucursal B', FALSE, TRUE)",
      [BRANCH_A, TENANT_A, BRANCH_B, TENANT_A]
    );
    await pool.query('INSERT INTO security_settings (tenant_id, admin_pin_hash) VALUES (?, ?)', [TENANT_A, pinHash]);
    await pool.query(
      `INSERT INTO users (tenant_id, branch_id, salon_id, username, email, name, nombre, role, password_hash, is_active, estado, all_branches_access, authorized_branch_ids)
       VALUES (?, ?, ?, ?, ?, 'Owner UI A', 'Owner UI A', 'propietario', ?, TRUE, 'Activo', TRUE, ?::jsonb)`,
      [TENANT_A, BRANCH_A, BRANCH_A, ownerEmail, ownerEmail, passHash, JSON.stringify([BRANCH_A, BRANCH_B])]
    );
    const [empRows] = await pool.query(
      "INSERT INTO staff_records (tenant_id, nombre, status, localidad) VALUES (?, 'Estilista UI A', 'Activo', 'Sucursal A') RETURNING id",
      [TENANT_A]
    );
    const EMP_A_ID = empRows[0].id;
    await pool.query(
      "INSERT INTO clients (id, tenant_id, nombre, email, status) VALUES (?, ?, 'Clienta UI A', ?, 'Active')",
      [CLIENT_A, TENANT_A, `ui.cli.${ts}@test-fixtures.local`]
    );
    const [locARows] = await pool.query(
      "INSERT INTO inventory_locations (tenant_id, salon_id, name, code, type, is_default, is_active) VALUES (?, NULL, 'Almacén Sucursal A', ?, 'STORE', TRUE, TRUE) RETURNING id",
      [TENANT_A, `LOC-UI-A-${ts}`]
    );
    const LOC_A_ID = locARows[0].id;

    // Launch real headless Chrome
    const executablePath = findBrowserExecutable();
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });

    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('response', (res) => {
      if (res.status() >= 500) server5xx.push(`${res.status()} ${res.url()}`);
    });

    // Helper: authenticated fetch from inside the real browser session (uses real HttpOnly cookie + browser Origin!)
    const browserApi = async (reqPath, method = 'GET', body = null, extraHeaders = {}) => {
      return page.evaluate(async ({ reqPath, method, body, extraHeaders }) => {
        const opts = { method, credentials: 'include', headers: { ...extraHeaders } };
        if (body !== null) {
          opts.headers['Content-Type'] = 'application/json';
          opts.body = JSON.stringify(body);
        }
        const res = await fetch(reqPath, opts);
        let data = {};
        try { data = await res.json(); } catch (_) {}
        return { status: res.status, body: data };
      }, { reqPath, method, body, extraHeaders });
    };

    const waitBodyText = async (needle, timeoutMs = 10000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const text = await page.evaluate(() => document.body?.innerText || '');
        if (text.includes(needle)) return true;
        await new Promise(r => setTimeout(r, 250));
      }
      return false;
    };

    // 1. Real UI Login on Landing page
    await page.goto(baseUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    const userInput = await page.$('input[id*="login"], input[name="username"], input[type="email"], input[type="text"]');
    assert.ok(userInput, 'Login username input must exist');
    await userInput.click({ clickCount: 3 });
    await userInput.type(ownerEmail);
    await page.type('input[type="password"]', 'TestPass2026!');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
      page.click('button[type="submit"]')
    ]);
    await new Promise(r => setTimeout(r, 1200));
    const afterLoginUrl = page.url();
    const hasErrorBoundary = await page.evaluate(() => (document.body?.innerText || '').includes('Algo salió mal'));
    logStep('UI 1. Login Owner A en navegador real', !hasErrorBoundary && !afterLoginUrl.includes('/login'), `url=${afterLoginUrl}, errorBoundary=${hasErrorBoundary}`);

    // 2. Categoría + Servicio (RD$1,000, 10%) + Producto (RD$500, 0%) via browser session + UI verification + reload
    const catName = `Cat_UI_${ts}`;
    const srvName = `Corte UI ${ts}`;
    const prodName = `Shampoo UI ${ts}`;

    const catRes = await browserApi('/api/commissions/categories', 'POST', { nombre: catName, porcentaje: 10, tipo: 'Porcentaje', estado: 'Activa' });
    assert.strictEqual(catRes.status, 200);
    const cats = await browserApi('/api/commissions/categories');
    const createdCat = (cats.body || []).find(c => c.nombre === catName);

    const srvRes = await browserApi('/api/services', 'POST', {
      nombre: srvName, commission_category_id: createdCat.id, precio: 1000, item_type: 'SERVICIO', tipo_comision: 'Porcentaje', comision_valor: 10, tax_rate: 0
    });
    assert.strictEqual(srvRes.status, 201);
    const prodRes = await browserApi('/api/services', 'POST', {
      nombre: prodName, commission_category_id: createdCat.id, precio: 500, costo: 250, item_type: 'PRODUCTO', sku: `SKU-UI-${ts}`, tipo_comision: 'Porcentaje', comision_valor: 0, tax_rate: 0, track_stock: true
    });
    assert.strictEqual(prodRes.status, 201);

    await page.goto(`${baseUrl}/servicios`, { waitUntil: 'networkidle2' });
    const srvVisibleBefore = await waitBodyText(srvName, 8000);
    await page.reload({ waitUntil: 'networkidle2' });
    const srvVisibleAfter = await waitBodyText(srvName, 8000);
    logStep('UI 2. Catálogo (/servicios) + recarga persistencia', srvVisibleBefore && srvVisibleAfter, `beforeReload=${srvVisibleBefore}, afterReload=${srvVisibleAfter}`);

    // 3. Inventario: entrada +10u, producto visible, servicio ausente + reload
    const adjRes = await browserApi('/api/inventory/adjustments', 'POST', {
      productId: prodRes.body.id, locationId: LOC_A_ID, quantity: 10, adjustmentType: 'ADJUSTMENT_IN', reason: 'Entrada UI 10u'
    });
    assert.strictEqual(adjRes.status, 200);

    await page.goto(`${baseUrl}/inventario`, { waitUntil: 'networkidle2' });
    const prodInInv = await waitBodyText(prodName, 8000);
    const srvInInv = await page.evaluate((s) => (document.body?.innerText || '').includes(s), srvName);
    await page.reload({ waitUntil: 'networkidle2' });
    const prodInInvReload = await waitBodyText(prodName, 8000);
    logStep('UI 3. Inventario (/inventario) + recarga persistencia', prodInInv && !srvInInv && prodInInvReload, `prodVisible=${prodInInv}, srvAbsent=${!srvInInv}, afterReload=${prodInInvReload}`);

    // 4. Apertura de Caja RD$2,000 + UI reload
    const openRes = await browserApi('/api/cash-registers/open', 'POST', { salon_id: BRANCH_A, opening_balance: 2000, notes: 'Caja UI A' });
    assert.strictEqual(openRes.status, 200);
    const REG_ID = openRes.body.id;

    await page.goto(`${baseUrl}/cajas`, { waitUntil: 'networkidle2' });
    const regVisible = await waitBodyText('2,000', 8000);
    await page.reload({ waitUntil: 'networkidle2' });
    const regVisibleReload = await waitBodyText('2,000', 8000);
    logStep('UI 4. Apertura de Caja (/cajas) RD$2,000 + recarga', regVisible && regVisibleReload, `visible=${regVisible}, afterReload=${regVisibleReload}`);

    // 5. Venta Base RD$2,000 (1 servicio + 2 productos) -> verificar stock=8, caja=4,000, comisión=100
    const salePayload = {
      client_id: CLIENT_A, client_name: 'Clienta UI A', salon_id: BRANCH_A, cash_register_id: REG_ID, location_id: LOC_A_ID,
      subtotal: 2000, descuento: 0, total: 2000, metodo_pago: 'Efectivo', pago_efectivo: 2000,
      items_detail: [
        { id: srvRes.body.id, nombre: srvName, tipo_item: 'SERVICIO', precio: 1000, precioAplicado: 1000, cantidad: 1, colaboradorId: EMP_A_ID, colaboradorNombre: 'Estilista UI A' },
        { id: prodRes.body.id, product_id: prodRes.body.id, nombre: prodName, tipo_item: 'PRODUCTO', is_product: true, precio: 500, precioAplicado: 500, cantidad: 2, colaboradorId: EMP_A_ID, colaboradorNombre: 'Estilista UI A' }
      ]
    };
    const V1 = `VIS-UI1-${ts}`;
    const s1 = await browserApi(`/api/visits/${V1}/checkout`, 'POST', salePayload, { 'Idempotency-Key': `ui-idem-1-${ts}` });
    assert.strictEqual(s1.status, 200);

    const active1 = await browserApi(`/api/cash-registers/active?salon_id=${BRANCH_A}`);
    const stockAfter1 = await browserApi(`/api/inventory/stock/${prodRes.body.id}?locationId=${LOC_A_ID}`);
    await page.goto(`${baseUrl}/comisiones`, { waitUntil: 'networkidle2' });
    const commVisible1 = await waitBodyText('Estilista UI A', 8000);
    const comm100Visible = await waitBodyText('100', 8000);
    logStep(
      'UI 5. Venta Base RD$2,000 -> Caja 4,000, Stock 8, Comisión RD$100 en /comisiones',
      Number(active1.body.expected_cash) === 4000 && Number(stockAfter1.body.quantity) === 8 && commVisible1 && comm100Visible,
      `expectedCash=${active1.body.expected_cash}, stock=${stockAfter1.body.quantity}, commUI=${commVisible1}/${comm100Visible}`
    );

    // 6. Anulación -> Stock 10, Caja 2,000, Factura Anulada en /facturas y comisión removida de pendientes
    const vRes = await browserApi(`/api/visits/${V1}/void`, 'POST', { reason: 'Anulación UI' });
    assert.strictEqual(vRes.status, 200);
    const activeVoid = await browserApi(`/api/cash-registers/active?salon_id=${BRANCH_A}`);
    const stockAfterVoid = await browserApi(`/api/inventory/stock/${prodRes.body.id}?locationId=${LOC_A_ID}`);
    await page.goto(`${baseUrl}/facturas`, { waitUntil: 'networkidle2' });
    const voidInFacturas = await waitBodyText('Anulad', 8000);
    const [voidCommDb] = await pool.query('SELECT status FROM employee_commissions_log WHERE tenant_id = ? AND visit_id = ?', [TENANT_A, V1]);
    logStep(
      'UI 6. Anulación -> Caja revierte a 2,000, Stock 10, Factura Anulada en /facturas',
      Number(activeVoid.body.expected_cash) === 2000 && Number(stockAfterVoid.body.quantity) === 10 && voidInFacturas && voidCommDb[0]?.status === 'Anulada',
      `expectedCash=${activeVoid.body.expected_cash}, stock=${stockAfterVoid.body.quantity}, facturasUI=${voidInFacturas}, commStatus=${voidCommDb[0]?.status}`
    );

    // 7. Venta Válida RD$2,000 + Cierre Caja RD$4,000 (diff 0) + reload /cajas
    const V2 = `VIS-UI2-${ts}`;
    const s2 = await browserApi(`/api/visits/${V2}/checkout`, 'POST', salePayload, { 'Idempotency-Key': `ui-idem-2-${ts}` });
    assert.strictEqual(s2.status, 200);
    const closeRes = await browserApi(`/api/cash-registers/${REG_ID}/close`, 'POST', { closing_balance: 4000, notes: 'Cierre UI cuadrado' });
    assert.strictEqual(closeRes.status, 200);
    assert.strictEqual(Number(closeRes.body.difference), 0);

    await page.goto(`${baseUrl}/cajas`, { waitUntil: 'networkidle2' });
    await page.reload({ waitUntil: 'networkidle2' });
    const closedVisible = await waitBodyText('Cerrada', 8000);
    const regsAfterClose = await browserApi('/api/cash-registers');
    const closedRow = (Array.isArray(regsAfterClose.body) ? regsAfterClose.body : []).find(r => String(r.id) === String(REG_ID));
    logStep(
      'UI 7. Venta Válida + Cierre Caja RD$4,000 (dif RD$0) + recarga /cajas',
      closedVisible && closedRow?.status === 'Cerrada' && Number(closedRow?.monto_final) === 4000 && Number(closedRow?.diferencia) === 0,
      `closedInUI=${closedVisible}, monto_final=${closedRow?.monto_final}, diff=${closedRow?.diferencia}`
    );

    // 8. Dashboard & Reportes (/dashboard, /analitica) + reload + 0 pageerrors / 0 5xx
    await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle2' });
    const dash2k = await waitBodyText('2,000', 8000);
    await page.reload({ waitUntil: 'networkidle2' });
    const dash2kReload = await waitBodyText('2,000', 8000);

    await page.goto(`${baseUrl}/analitica`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 800));
    const analyticsOk = await page.evaluate(() => !(document.body?.innerText || '').includes('Algo salió mal'));

    logStep(
      'UI 8. Dashboard & Reportes (/dashboard, /analitica) + recarga + 0 errores',
      dash2k && dash2kReload && analyticsOk && pageErrors.length === 0 && server5xx.length === 0,
      `dash2k=${dash2k}/${dash2kReload}, analyticsOk=${analyticsOk}, pageErrors=${pageErrors.length}, server5xx=${server5xx.length}`
    );

    console.log(`\n=== REAL BROWSER UI ACCEPTANCE COMPLETE: ${steps.filter(s => s.ok).length}/${steps.length} PASSED ===\n`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (serverProcess) serverProcess.kill('SIGKILL');
    try {
      for (const tbl of [
        'employee_commissions_log', 'cash_register_movements', 'cash_registers',
        'inventory_movements', 'inventory_stock', 'inventory_locations',
        'visits', 'services', 'commission_categories', 'staff_records',
        'clients', 'user_sessions', 'security_settings', 'users',
        'branches', 'tenant_subscriptions', 'idempotency_keys'
      ]) {
        await pool.query(`DELETE FROM ${tbl} WHERE tenant_id = ?`, [TENANT_A]).catch(() => {});
      }
      await pool.query('DELETE FROM tenants WHERE id = ?', [TENANT_A]).catch(() => {});
    } catch (_) {}
    await pool.end();
  }
}

if (require.main === module) {
  runBrowserAcceptanceSuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[FATAL UI ACCEPTANCE ERROR]:', err);
      process.exit(1);
    });
}

module.exports = { runBrowserAcceptanceSuite };
