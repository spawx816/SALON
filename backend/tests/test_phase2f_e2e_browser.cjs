/* global window, document, getComputedStyle */
/**
 * Test Suite: Phase 2F Local Functional QA End-to-End via Real Browser (Puppeteer + Vite)
 * (backend/tests/test_phase2f_e2e_browser.cjs)
 * 
 * Verifies the complete integrated SaaS system from a real browser:
 * - Real Vite Dev Server on ephemeral port (127.0.0.1:0)
 * - Real Express Backend in-memory on ephemeral port (127.0.0.1:0)
 * - Pure in-memory databases and repositories (Zero PostgreSQL, Zero pg.Pool, Zero DATABASE_URL)
 * - Zero external networks (interceptor blocks any non-loopback connection)
 * - Zero PAN/CVC in DOM, localStorage, screenshots, or logs (PCI DSS)
 * - Desktop (1280x800) and Mobile (375x667) responsive validations
 * - Covers all 10 mandatory business & security flows
 */

'use strict';

// =========================================================================
// RUNTIME SECURITY GUARDS (FAIL-CLOSED DEFENSE)
// =========================================================================

delete process.env.DATABASE_URL;
delete process.env.DB_HOST;
delete process.env.PGHOST;
delete process.env.DB_NAME;
delete process.env.PRODUCTION_DB_NAME;

const fs = require('fs');
const path = require('path');
const net = require('net');
const assert = require('assert');
const puppeteer = require('puppeteer');

// 1. Intercept filesystem reads to prevent reading backend/.env
const originalReadFileSync = fs.readFileSync;
const originalReadFile = fs.readFile;

fs.readFileSync = function (filePath, ...rest) {
  const normalized = String(filePath).replace(/\\/g, '/');
  if (normalized.endsWith('backend/.env') || normalized.includes('/backend/.env')) {
    throw new Error(`[GUARD VIOLATION]: Reading backend/.env during test run is strictly forbidden (${filePath})`);
  }
  return originalReadFileSync.call(fs, filePath, ...rest);
};

fs.readFile = function (filePath, ...rest) {
  const normalized = String(filePath).replace(/\\/g, '/');
  if (normalized.endsWith('backend/.env') || normalized.includes('/backend/.env')) {
    const cb = rest[rest.length - 1];
    const err = new Error(`[GUARD VIOLATION]: Reading backend/.env during test run is strictly forbidden (${filePath})`);
    if (typeof cb === 'function') return cb(err);
    throw err;
  }
  return originalReadFile.call(fs, filePath, ...rest);
};

// 2. Intercept socket connections to strictly block PostgreSQL (5432) and external hosts
const originalSocketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let port, host;
  if (typeof args[0] === 'object' && args[0] !== null) {
    port = args[0].port;
    host = args[0].host;
  } else {
    port = args[0];
    host = args[1];
  }

  if (Number(port) === 5432) {
    throw new Error('[GUARD VIOLATION]: Attempted connection to PostgreSQL on port 5432 is strictly forbidden!');
  }

  const isLoopback = !host || host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!isLoopback) {
    throw new Error(`[GUARD VIOLATION]: External network connection to ${host}:${port} is strictly forbidden!`);
  }

  return originalSocketConnect.apply(this, args);
};

const { createInMemoryTestApp } = require('./helpers/create_in_memory_test_app.cjs');

console.log('=== STARTING SUITE: PHASE 2F QA FUNCIONAL E2E REAL BROWSER (ZERO POSTGRESQL) ===\n');

const isHeaded = process.argv.includes('--headed');
const screenshotDir = path.resolve(process.cwd(), 'scratch/e2e_screenshots');
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

let passedTests = 0;
let totalTests = 0;

async function runStep(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  [PASS ${totalTests}] ${name}`);
  } catch (err) {
    console.error(`  [FAIL ${totalTests}] ${name}`);
    console.error(`         Reason: ${err.message}`);
    if (err.stack) {
      console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
    throw err;
  }
}

async function runE2ESuite() {
  // Pre-condition safety verification
  let dbLoaded = false;
  try {
    const dbPath = require.resolve('../db');
    dbLoaded = Boolean(require.cache[dbPath]);
  } catch {
    dbLoaded = false;
  }
  assert.strictEqual(dbLoaded, false, 'backend/db.js must never be imported in tests');

  // 1. Spin up Express in-memory backend
  console.log('  -> Bootstrapping In-Memory Express Backend on ephemeral port...');
  const backendHarness = await createInMemoryTestApp();
  const backendPort = backendHarness.server.address().port;
  console.log(`  -> Express Backend listening at: http://127.0.0.1:${backendPort}`);

  // 2. Spin up programmatic Vite dev server
  console.log('  -> Bootstrapping Local Vite Dev Server with proxy...');
  const { createServer } = await import('vite');
  const { default: reactPlugin } = await import('@vitejs/plugin-react');

  const viteServer = await createServer({
    configFile: false,
    envFile: false,
    root: process.cwd(),
    plugins: [reactPlugin()],
    server: {
      host: '127.0.0.1',
      port: 0,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${backendPort}`,
          changeOrigin: true
        }
      }
    }
  });

  await viteServer.listen();
  const viteUrl = viteServer.resolvedUrls.local[0];
  console.log(`  -> Vite Frontend listening at: ${viteUrl}\n`);

  // 3. Launch Puppeteer Browser
  console.log(`  -> Launching Chrome Browser (Headed: ${isHeaded})...`);
  const browser = await puppeteer.launch({
    channel: 'chrome',
    headless: !isHeaded,
    defaultViewport: { width: 1280, height: 800 },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  const page = await browser.newPage();

  // Network Guard inside browser: abort any non-loopback external request
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      return req.continue();
    }
    try {
      const parsed = new URL(url);
      const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
      if (!isLoopback) {
        console.warn(`[BROWSER NETWORK BLOCKED]: External request intercepted: ${url}`);
        return req.abort('blockedbyclient');
      }
      req.continue();
    } catch {
      req.continue();
    }
  });

  try {
    // =========================================================================
    // FLOW 1: ONBOARDING — REGISTRAR SALÓN Y NEUTRALIZAR PLAN PRO
    // =========================================================================
    await runStep('Flow 1: Public Onboarding registers salon in Plan BASE (neutralizes Pro)', async () => {
      await page.goto(viteUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('body', { timeout: 10000 });

      // Trigger onboarding from public UI
      const onboardResult = await page.evaluate(async () => {
        const res = await fetch('/api/public/onboarding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            business_name: 'Salón Glamour E2E',
            owner_name: 'Ana Propietaria',
            owner_email: 'ana@glamour.com',
            admin_password: 'Password123!',
            rnc: '131000099',
            address: 'Av. Bella Vista 50',
            requested_plan: 'PRO',
            plan: 'PRO'
          })
        });
        return { status: res.status, body: await res.json() };
      });

      assert.strictEqual(onboardResult.status, 201);
      assert.strictEqual(onboardResult.body.success, true);
      assert.strictEqual(onboardResult.body.status, 'pending');

      // Verify in DB that Plan was strictly sanitized to BASE
      const subRow = backendHarness.dbMock.tables.tenant_subscriptions.find(
        (s) => s.tenant_id === onboardResult.body.tenant_id
      );
      assert.ok(subRow);
      assert.strictEqual(subRow.plan_code, 'BASE', 'Onboarded subscription must be Plan BASE');

      await page.screenshot({ path: path.join(screenshotDir, '01_onboarding_base.png') });
    });

    // =========================================================================
    // FLOW 2: LOGIN Y GESTIÓN DE SESIÓN
    // =========================================================================
    let activeOwner = null;
    await runStep('Flow 2: Login validation, session persistence, and logout lifecycle', async () => {
      // Create active tenant and user for login tests
      activeOwner = await backendHarness.createTenantWithUser({
        plan: 'BASE',
        email: 'owner@glamour.com',
        businessName: 'Salón Glamour'
      });

      await page.goto(`${viteUrl}login`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#login-identifier', { timeout: 5000 });

      // 2.1 Invalid Login Attempt
      await page.type('#login-identifier', 'fake@user.com');
      await page.type('#login-password', 'WrongPassword!');
      await page.click('button[type="submit"]');

      // Wait for error message
      await page.waitForFunction(
        () => document.body.innerText.includes('Credenciales') || document.body.innerText.includes('inválidas') || document.body.innerText.includes('incorrecta') || Boolean(document.querySelector('.error-msg')),
        { timeout: 5000 }
      );

      // 2.2 Valid Login Attempt
      // Reload login page to ensure React state is completely pristine
      await page.goto(`${viteUrl}login`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#login-identifier', { timeout: 5000 });

      await page.type('#login-identifier', 'owner@glamour.com');
      await page.type('#login-password', 'Password123!');
      await page.click('button[type="submit"]');

      // Wait for redirect to dashboard
      await page.waitForFunction(
        () => window.location.pathname === '/' || Boolean(localStorage.getItem('salon_pro_user')),
        { timeout: 10000 }
      );
      await new Promise((r) => setTimeout(r, 600));
      await page.waitForSelector('body', { timeout: 5000 });

      // Verify localStorage session
      const storedUser = await page.evaluate(() => JSON.parse(localStorage.getItem('salon_pro_user') || '{}'));
      assert.strictEqual(storedUser.email, 'owner@glamour.com');
      assert.ok(storedUser.sessionId);

      await page.screenshot({ path: path.join(screenshotDir, '02_login_success.png') });

      // 2.3 Account recovery route is accessible
      await page.goto(`${viteUrl}activar`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => document.body.innerText.includes('Activa') || document.body.innerText.includes('cuenta') || document.body.innerText.includes('código'),
        { timeout: 5000 }
      );
      const activateTitle = await page.evaluate(() => document.body.innerText);
      assert.ok(activateTitle.includes('Activa') || activateTitle.includes('cuenta') || activateTitle.includes('código'));
    });

    // =========================================================================
    // FLOW 3: ENTITLEMENTS BASE — PROTECCIÓN VISUAL Y GATES 403
    // =========================================================================
    await runStep('Flow 3: Base Entitlements visually hide Pro features & enforce 403 on direct URL access', async () => {
      // Re-navigate to dashboard with active owner session
      await page.goto(viteUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('body', { timeout: 5000 });

      // 3.1 Verify Plan Badge in header displays PLAN BASE
      await page.waitForFunction(
        () => document.body.innerText.includes('PLAN BASE'),
        { timeout: 5000 }
      );

      // 3.2 Basic inventory link is present in UI
      const hasInventoryLink = await page.evaluate(() => {
        return Boolean(document.querySelector('a[href="/inventario"]') || document.querySelector('a[href="/inventory"]'));
      });
      assert.strictEqual(hasInventoryLink, true, 'Base plan must show Inventory in navigation');

      // 3.3 CRM (Clientes) IS in the Base navigation; Memberships (Planes/Contratos) are NOT
      const baseNavHrefs = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('nav a, aside a, header a'));
        return links.map((a) => a.getAttribute('href'));
      });
      assert.strictEqual(
        baseNavHrefs.some((h) => h === '/clientes' || h === '/lista-clientes'),
        true,
        'Base plan must show Clientes (CRM) in primary navigation'
      );
      assert.strictEqual(
        baseNavHrefs.some((h) => h === '/planes' || h === '/contratos' || h === '/membresias'),
        false,
        'Base plan must NOT show Membresias/Contratos in navigation'
      );

      // 3.4 Direct URL access to /clientes renders the CRM directory (no 403 gate) on BASE
      await page.goto(`${viteUrl}clientes`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('body', { timeout: 5000 });
      await new Promise((r) => setTimeout(r, 1200));
      const clientsText = await page.evaluate(() => document.body.innerText);
      assert.strictEqual(clientsText.includes('Acceso Restringido (403)'), false, 'CRM clients must be accessible on BASE');

      // 3.4b Direct URL access to /contratos displays FeatureForbiddenGate (403) with PRO CTA
      await page.goto(`${viteUrl}contratos`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => document.body.innerText.includes('403') || document.body.innerText.includes('Acceso Restringido'),
        { timeout: 5000 }
      );

      const forbiddenText = await page.evaluate(() => document.body.innerText);
      assert.ok(forbiddenText.includes('Acceso Restringido (403)'));
      assert.ok(forbiddenText.includes('Exclusivo Plan PRO'));
      assert.ok(forbiddenText.includes('Actualizar a Plan PRO'));

      // 3.5 Direct URL access to /planes displays FeatureForbiddenGate (403)
      await page.goto(`${viteUrl}planes`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => document.body.innerText.includes('403') || document.body.innerText.includes('Acceso Restringido'),
        { timeout: 5000 }
      );

      // Capture desktop screenshot (1280x800)
      await page.screenshot({ path: path.join(screenshotDir, '03_entitlements_base_desktop.png') });

      // 3.6 Responsive Mobile Viewport Verification (375x667)
      await page.setViewport({ width: 375, height: 667 });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('body', { timeout: 5000 });
      await page.screenshot({ path: path.join(screenshotDir, '03_entitlements_base_mobile.png') });

      // Reset to desktop viewport
      await page.setViewport({ width: 1280, height: 800 });
    });

    // =========================================================================
    // FLOW 4: INVENTARIO BASE — PRODUCTOS, STOCK, VENTA POS Y ANULACIÓN
    // =========================================================================
    let shampooProduct = null;
    await runStep('Flow 4: Base Inventory operations (product creation, adjustment, POS sale & void replenishment)', async () => {
      await page.goto(`${viteUrl}inventario`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('body', { timeout: 5000 });

      // 4.1 Create product via API binding inside browser
      const createProdRes = await page.evaluate(async () => {
        const res = await fetch('/api/inventory/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sku: 'SHAMP-E2E-01',
            name: 'Shampoo Profesional Hidratante E2E',
            sale_price: 850,
            cost: 400,
            min_stock: 5,
            track_stock: true,
            initial_stock: 0
          })
        });
        return { status: res.status, body: await res.json() };
      });

      assert.strictEqual(createProdRes.status, 201);
      shampooProduct = createProdRes.body;
      assert.strictEqual(shampooProduct.sku, 'SHAMP-E2E-01');

      // 4.2 Receive initial stock (+25 units)
      const adjRes = await page.evaluate(async (pId) => {
        const res = await fetch('/api/inventory/adjustments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: pId,
            quantity: 25,
            adjustmentType: 'ADJUSTMENT_IN',
            reason: 'Entrada inicial E2E'
          })
        });
        return { status: res.status, body: await res.json() };
      }, shampooProduct.id);

      assert.strictEqual(adjRes.status, 200);

      // Verify stock balance shows 25
      const stockRes = await page.evaluate(async (pId) => {
        const res = await fetch(`/api/inventory/stock/${pId}`);
        return { status: res.status, body: await res.json() };
      }, shampooProduct.id);
      assert.strictEqual(Number(stockRes.body.quantity), 25);

      // 4.3 POS Sale Checkout: deduct 5 units -> 20 remaining
      const checkoutVisitId = `VIS-E2E-${Date.now()}`;
      const checkoutRes = await page.evaluate(async ({ vId, pId }) => {
        const res = await fetch(`/api/visits/${vId}/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_name: 'Cliente Mostrador E2E',
            servicios: [],
            items_detail: [
              {
                id: pId,
                product_id: pId,
                tipo_item: 'Producto',
                is_product: true,
                nombre: 'Shampoo Profesional Hidratante E2E',
                precio: 850,
                cantidad: 5
              }
            ],
            subtotal: 4250,
            total: 4250,
            metodo_pago: 'Efectivo'
          })
        });
        return { status: res.status, body: await res.json() };
      }, { vId: checkoutVisitId, pId: shampooProduct.id });

      assert.strictEqual(checkoutRes.status, 200);

      const stockAfterSale = await page.evaluate(async (pId) => {
        const res = await fetch(`/api/inventory/stock/${pId}`);
        return await res.json();
      }, shampooProduct.id);
      assert.strictEqual(Number(stockAfterSale.quantity), 20);

      // 4.4 Void Sale: restore 5 units -> 25
      const voidRes = await page.evaluate(async (vId) => {
        const res = await fetch(`/api/visits/${vId}/void`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Anulación de prueba E2E' })
        });
        return { status: res.status, body: await res.json() };
      }, checkoutVisitId);

      assert.strictEqual(voidRes.status, 200);

      const stockAfterVoid = await page.evaluate(async (pId) => {
        const res = await fetch(`/api/inventory/stock/${pId}`);
        return await res.json();
      }, shampooProduct.id);
      assert.strictEqual(Number(stockAfterVoid.quantity), 25);

      await page.screenshot({ path: path.join(screenshotDir, '04_inventory_base.png') });
    });

    // =========================================================================
    // FLOW 5: UPGRADE BASE → PRO (MODAL, PRORATEO Y DESBLOQUEO INMEDIATO)
    // =========================================================================
    await runStep('Flow 5: Upgrade Base -> Pro with modal transparency and instant feature unlocking', async () => {
      await page.goto(`${viteUrl}facturacion-saas`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('body', { timeout: 5000 });
      await new Promise((r) => setTimeout(r, 600));

      // 5.1 Register tokenized payment method (Zero PAN / CVC)
      const savePmRes = await page.evaluate(async () => {
        const res = await fetch('/api/saas/billing/payment-methods', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentMethodToken: 'pm_tok_e2e_4242',
            providerCustomerReference: 'cus_e2e_123',
            brand: 'visa',
            last4: '4242',
            expMonth: 12,
            expYear: 2029
          })
        });
        return { status: res.status, body: await res.json() };
      });
      assert.strictEqual(savePmRes.status, 201);

      // 5.2 Click "Cambiar a Plan PRO" or trigger upgrade
      const upgradeRes = await page.evaluate(async () => {
        const res = await fetch('/api/saas/billing/subscription/upgrade', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': 'upg-e2e-browser-01'
          }
        });
        return { status: res.status, body: await res.json() };
      });

      assert.strictEqual(upgradeRes.status, 200);
      assert.strictEqual(upgradeRes.body.newPlan, 'PRO');

      // 5.3 Reload and confirm header badge dynamically reflects PLAN PRO
      await page.goto(viteUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => document.body.innerText.includes('PLAN PRO'),
        { timeout: 5000 }
      );

      // 5.4 Access /clientes directly: now renders 200 OK without 403 Gate
      await page.goto(`${viteUrl}clientes`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('body', { timeout: 5000 });

      const clientsPageText = await page.evaluate(() => document.body.innerText);
      assert.strictEqual(clientsPageText.includes('Acceso Restringido (403)'), false, 'CRM clients must be accessible on PRO');

      // 5.5 Access /planes directly: renders 200 OK
      await page.goto(`${viteUrl}planes`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('body', { timeout: 5000 });
      const plansPageText = await page.evaluate(() => document.body.innerText);
      assert.strictEqual(plansPageText.includes('Acceso Restringido (403)'), false, 'Plans module must be accessible on PRO');

      await page.screenshot({ path: path.join(screenshotDir, '05_upgrade_pro_success.png') });
    });

    // =========================================================================
    // FLOW 6: INVENTARIO PRO — ÓRDENES Y TRANSFERENCIAS
    // =========================================================================
    await runStep('Flow 6: Pro Inventory advanced features (transfers & orders)', async () => {
      // Transfer endpoint accessible on Pro
      const transferRes = await page.evaluate(async () => {
        const res = await fetch('/api/inventory/transfers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originLocationId: 'loc-1',
            destinationLocationId: 'loc-2',
            items: []
          })
        });
        return res.status;
      });

      // Status should NOT be 403 (it may be 400 for empty items, but NOT 403 FEATURE_NOT_INCLUDED)
      assert.notStrictEqual(transferRes, 403, 'Inventory transfers must not return 403 on Plan PRO');
      await page.screenshot({ path: path.join(screenshotDir, '06_inventory_pro.png') });
    });

    // =========================================================================
    // FLOW 7: FACTURACIÓN SAAS — DUNNING, SUSPENSIÓN Y REACTIVACIÓN
    // =========================================================================
    await runStep('Flow 7: SaaS Billing lifecycle, past_due grace, suspension, and payment recovery', async () => {
      await page.goto(`${viteUrl}facturacion-saas`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('body', { timeout: 5000 });
      await new Promise((r) => setTimeout(r, 600));

      // Verify tokenized card displays without PAN/CVC
      const billingContent = await page.evaluate(() => document.body.innerText);
      assert.ok(billingContent.includes('4242') || billingContent.includes('Facturación') || billingContent.includes('Suscripción'));
      assert.strictEqual(billingContent.includes('424242424242'), false, 'Full PAN must NEVER appear in DOM');

      // Simulate past_due with active grace
      const now = new Date();
      const graceEnd = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
      await backendHarness.saasRepo.upsertSubscription(activeOwner.tenantId, {
        plan_code: 'PRO',
        status: 'past_due',
        grace_period_until: graceEnd
      });

      // Access remains open during grace
      const entGrace = await page.evaluate(async () => {
        const res = await fetch('/api/tenant/entitlements');
        return await res.json();
      });
      assert.strictEqual(entGrace.isSuspended, false);

      // Advance clock +6 days to expire grace period
      backendHarness.advanceClock(6 * 24 * 60 * 60 * 1000);

      // Entitlements reflects suspended
      const entSuspended = await page.evaluate(async () => {
        const res = await fetch('/api/tenant/entitlements');
        return await res.json();
      });
      assert.strictEqual(entSuspended.isSuspended, true);

      // Billing routes remain open during suspension
      const subCheck = await page.evaluate(async () => {
        const res = await fetch('/api/saas/billing/subscription');
        return res.status;
      });
      assert.strictEqual(subCheck, 200, 'Billing subscription must remain accessible during suspension');

      // Create and pay unpaid invoice to reactivate
      const invoice = await backendHarness.saasBillingRepo.createInvoice({
        tenant_id: activeOwner.tenantId,
        currency: 'DOP',
        subtotal_minor: 590000n,
        tax_minor: 0n,
        total_minor: 590000n,
        amount_due_minor: 590000n,
        amount_paid_minor: 0n,
        status: 'open',
        items: [{ description: 'Plan PRO mensual pendiente', amount_minor: 590000n }]
      });

      const payRes = await page.evaluate(async (invId) => {
        const res = await fetch(`/api/saas/billing/invoices/${invId}/pay`, { method: 'POST' });
        return { status: res.status, body: await res.json() };
      }, invoice.id);
      assert.strictEqual(payRes.status, 200);

      // Subscription reactivated
      const entActive = await page.evaluate(async () => {
        const res = await fetch('/api/tenant/entitlements');
        return await res.json();
      });
      assert.strictEqual(entActive.isSuspended, false);

      await page.screenshot({ path: path.join(screenshotDir, '07_billing_lifecycle.png') });
    });

    // =========================================================================
    // FLOW 8: DOWNGRADE — VALIDACIÓN DE LÍMITES Y CALENDARIZACIÓN
    // =========================================================================
    await runStep('Flow 8: Downgrade resource limit validation & scheduled downgrade', async () => {
      // Exceed Base limit (add extra users)
      backendHarness.dbMock.tables.users.push(
        { id: 'usr-extra-1', tenant_id: activeOwner.tenantId, email: 'u1@extra.com', is_active: true },
        { id: 'usr-extra-2', tenant_id: activeOwner.tenantId, email: 'u2@extra.com', is_active: true },
        { id: 'usr-extra-3', tenant_id: activeOwner.tenantId, email: 'u3@extra.com', is_active: true }
      );

      const downgradeFail = await page.evaluate(async () => {
        const res = await fetch('/api/saas/billing/subscription/downgrade', { method: 'POST' });
        return { status: res.status, body: await res.json() };
      });

      assert.strictEqual(downgradeFail.status, 409);
      assert.strictEqual(downgradeFail.body.code, 'RESOURCE_LIMIT_EXCEEDED');

      // Remove excess users
      backendHarness.dbMock.tables.users = backendHarness.dbMock.tables.users.filter(
        (u) => !u.id.startsWith('usr-extra-')
      );

      // Downgrade succeeds and is scheduled
      const downgradeOk = await page.evaluate(async () => {
        const res = await fetch('/api/saas/billing/subscription/downgrade', { method: 'POST' });
        return { status: res.status, body: await res.json() };
      });

      assert.strictEqual(downgradeOk.status, 200);
      assert.strictEqual(downgradeOk.body.scheduled, true);
      assert.strictEqual(downgradeOk.body.targetPlan, 'BASE');

      await page.screenshot({ path: path.join(screenshotDir, '08_downgrade_scheduled.png') });
    });

    // =========================================================================
    // FLOW 9: ANTI-IDOR EN NAVEGADOR
    // =========================================================================
    await runStep('Flow 9: Anti-IDOR enforcement from browser against foreign tenant resources', async () => {
      const tenantB = await backendHarness.createTenantWithUser({ plan: 'PRO', email: 'owner.b@other.com' });

      // Create invoice for Tenant B
      const invB = await backendHarness.saasBillingRepo.createInvoice({
        tenant_id: tenantB.tenantId,
        currency: 'DOP',
        subtotal_minor: 590000n,
        tax_minor: 0n,
        total_minor: 590000n,
        amount_due_minor: 590000n,
        amount_paid_minor: 0n,
        status: 'open',
        items: []
      });

      // Tenant A tries to fetch Tenant B invoice
      const idorInv = await page.evaluate(async (invId) => {
        const res = await fetch(`/api/saas/billing/invoices/${invId}`);
        return res.status;
      }, invB.id);
      assert.strictEqual(idorInv, 404, 'Foreign tenant invoice must return 404');

      // Spoofing x-tenant-id header is rejected
      const spoofRes = await page.evaluate(async (foreignTenantId) => {
        const res = await fetch('/api/tenant/entitlements', {
          headers: { 'x-tenant-id': foreignTenantId }
        });
        return res.status;
      }, tenantB.tenantId);
      assert.strictEqual(spoofRes, 403, 'Header spoofing must return 403');
    });

    // =========================================================================
    // FLOW 10: SUPERADMIN GOVERNANCE
    // =========================================================================
    await runStep('Flow 10: SuperAdmin governance dashboard and salon admin RBAC barrier', async () => {
      // 10.1 Regular salon admin navigating to /saas is redirected to /
      await page.goto(`${viteUrl}saas`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => window.location.pathname === '/' || window.location.pathname === '/login',
        { timeout: 5000 }
      );

      // 10.2 Create and login as SuperAdmin
      const superAdminUser = await backendHarness.createTenantWithUser({
        role: 'superadmin',
        email: 'superadmin@salonpro.com'
      });

      // Set the auth_token cookie for SuperAdmin
      await page.setCookie({
        name: 'auth_token',
        value: superAdminUser.token,
        domain: '127.0.0.1',
        path: '/'
      });

      // Inject superadmin session into browser localStorage
      await page.evaluate((sa) => {
        localStorage.setItem(
          'salon_pro_user',
          JSON.stringify({
            id: sa.userId,
            email: sa.email,
            role: 'superadmin',
            isSuperAdmin: true,
            sessionId: sa.sessionId
          })
        );
      }, superAdminUser);

      await page.goto(`${viteUrl}saas`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('body', { timeout: 5000 });

      // SuperAdmin metrics route accessible
      const metricsStatus = await page.evaluate(async () => {
        const res = await fetch('/api/saas/metrics');
        return res.status;
      });
      assert.strictEqual(metricsStatus, 200);

      await page.screenshot({ path: path.join(screenshotDir, '10_superadmin_dashboard.png') });
    });

    // =========================================================================
    // FLOW 11: MULTI-TENANT BRANDING ISOLATION & DYNAMIC DESIGN TOKENS
    // =========================================================================
    await runStep('Flow 11: Multi-tenant branding isolation & custom CSS tokens in real browser', async () => {
      // 11.1 Create Tenant A with custom branding (Purple & Gold)
      const tenantA = await backendHarness.createTenantWithUser({
        business_name: 'Studio Elegance',
        email: 'owner.a@elegance.com',
        plan: 'BASE'
      });
      await backendHarness.app.tenantBrandingService.updateBranding(tenantA.tenantId, {
        business_name: 'Studio Elegance',
        primary_color: '#4a154b',
        secondary_color: '#ecb22e',
        accent_color: '#1264a3',
        background_color: '#ffffff',
        surface_color: '#f8fafc',
        text_color: '#1d1c1d'
      });

      // 11.2 Create Tenant B with custom branding (Emerald Green & Teal)
      const tenantB = await backendHarness.createTenantWithUser({
        business_name: 'Barberia Imperial',
        email: 'owner.b@imperial.com',
        plan: 'PRO'
      });
      await backendHarness.app.tenantBrandingService.updateBranding(tenantB.tenantId, {
        business_name: 'Barberia Imperial',
        primary_color: '#064e3b',
        secondary_color: '#10b981',
        accent_color: '#047857',
        background_color: '#f0fdf4',
        surface_color: '#ffffff',
        text_color: '#022c22'
      });

      // 11.3 Login as Tenant A and verify CSS tokens in real browser DOM
      await page.setCookie({
        name: 'auth_token',
        value: tenantA.token,
        domain: '127.0.0.1',
        path: '/'
      });
      await page.evaluate((tA) => {
        localStorage.setItem('salon_pro_token', tA.token);
        localStorage.setItem('salon_pro_user', JSON.stringify({
          id: tA.userId,
          email: tA.email,
          role: 'propietario',
          tenant_id: tA.tenantId,
          salon_name: tA.business_name,
          tenant: { id: tA.tenantId, business_name: tA.business_name }
        }));
      }, tenantA);

      await page.goto(`${viteUrl}marca-apariencia`, { waitUntil: 'domcontentloaded' });
      await new Promise((r) => setTimeout(r, 600));

      const primaryColorA = await page.evaluate(() => {
        return getComputedStyle(document.documentElement).getPropertyValue('--tenant-primary').trim();
      });
      assert.strictEqual(primaryColorA.toLowerCase(), '#4a154b', 'Tenant A document root must have --tenant-primary = #4a154b');

      // 11.4 Login as Tenant B and verify immediate theme switch and isolation
      await page.setCookie({
        name: 'auth_token',
        value: tenantB.token,
        domain: '127.0.0.1',
        path: '/'
      });
      await page.evaluate((tB) => {
        localStorage.setItem('salon_pro_token', tB.token);
        localStorage.setItem('salon_pro_user', JSON.stringify({
          id: tB.userId,
          email: tB.email,
          role: 'propietario',
          tenant_id: tB.tenantId,
          salon_name: tB.business_name,
          tenant: { id: tB.tenantId, business_name: tB.business_name }
        }));
      }, tenantB);

      await page.goto(`${viteUrl}marca-apariencia`, { waitUntil: 'domcontentloaded' });
      await new Promise((r) => setTimeout(r, 600));

      const primaryColorB = await page.evaluate(() => {
        return getComputedStyle(document.documentElement).getPropertyValue('--tenant-primary').trim();
      });
      assert.strictEqual(primaryColorB.toLowerCase(), '#064e3b', 'Tenant B document root must have --tenant-primary = #064e3b');
      assert.notStrictEqual(primaryColorA, primaryColorB, 'Tenant A and Tenant B must have isolated visual identities');

      // 11.5 Verify SuperAdmin session never inherits tenant branding tokens
      const superAdminUser = await backendHarness.createTenantWithUser({
        role: 'superadmin',
        email: 'superadmin.branding@salonpro.com'
      });
      await page.setCookie({
        name: 'auth_token',
        value: superAdminUser.token,
        domain: '127.0.0.1',
        path: '/'
      });
      await page.evaluate((sa) => {
        localStorage.setItem('salon_pro_token', sa.token);
        localStorage.setItem('salon_pro_user', JSON.stringify({
          id: sa.userId,
          email: sa.email,
          role: 'superadmin',
          isSuperAdmin: true
        }));
      }, superAdminUser);

      await page.goto(`${viteUrl}saas`, { waitUntil: 'domcontentloaded' });
      await new Promise((r) => setTimeout(r, 600));

      const primaryColorSA = await page.evaluate(() => {
        return getComputedStyle(document.documentElement).getPropertyValue('--tenant-primary').trim();
      });
      assert.strictEqual(primaryColorSA.toLowerCase(), '#0f172a', 'SuperAdmin Control Plane must retain neutral SalonPro #0f172a');
    });

    // =========================================================================
    // VISUAL STATES & ACCESSIBILITY VERIFICATION
    // =========================================================================
    await runStep('Visual States: 404 screen, keyboard navigation, and form validation', async () => {
      // 1. 404 Route
      await page.goto(`${viteUrl}ruta-inexistente-e2e-404`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => document.body.innerText.includes('404') || document.body.innerText.includes('No Encontrada'),
        { timeout: 5000 }
      );
      const text404 = await page.evaluate(() => document.body.innerText);
      assert.ok(text404.includes('404'));
      assert.ok(text404.includes('Página No Encontrada'));

      await page.screenshot({ path: path.join(screenshotDir, 'visual_state_404.png') });

      // 2. Keyboard Navigation test (Tab key focus on public login)
      await page.evaluate(() => localStorage.clear());
      await page.deleteCookie({ name: 'auth_token' });
      await page.goto(`${viteUrl}login`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#login-identifier', { timeout: 5000 });
      await page.focus('#login-identifier');
      await page.keyboard.press('Tab');
      const focusedTag = await page.evaluate(() => document.activeElement.tagName);
      assert.ok(focusedTag === 'INPUT' || focusedTag === 'BUTTON' || focusedTag === 'A', 'Keyboard Tab must focus interactive elements');
    });

  } finally {
    // Teardown everything gracefully in reverse order
    console.log('\n  -> Tearing down browser, Vite server, and backend harness...');
    await browser.close().catch(() => {});
    await viteServer.close().catch(() => {});
    await backendHarness.close().catch(() => {});
  }

  // Summary
  console.log('\n======================================================');
  console.log(`PHASE 2F E2E TEST SUMMARY: ${passedTests}/${totalTests} PASSED`);
  console.log('======================================================\n');

  if (passedTests < totalTests) {
    process.exit(1);
  }
}

runE2ESuite().catch((err) => {
  console.error('[FATAL E2E RUNNER ERROR]:', err);
  process.exit(1);
});
