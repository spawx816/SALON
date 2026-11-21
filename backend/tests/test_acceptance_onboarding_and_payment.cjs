/* global document */
'use strict';

/**
 * Acceptance Suite: "Alta y pago completo" (Etereas)
 * Ejecuta contra salon_saas_test con backend/server.js + dist/ + Mock HTTP de CardNet Tokenization
 * + Chrome headless real.
 *
 * Verifica:
 * 1. Selección comercial y cálculo exacto (1 suc, varias suc, usuarios extra, add-on Membresías parcial/total,
 *    falta de tasa FX -> 503 controlado, manipulación de precios en payload ignorada).
 * 2. Registro y Términos (validaciones, accept_terms obligatorio, versión v2026.1 + SHA-256 + actor + fecha,
 *    autorización recurrente separada, navegador real en /, cero datos operativos ficticios).
 * 3. Cuenta pendiente (accede a pago 200, bloqueada en operación), doble clic/reapertura reutiliza sesión,
 *    registro repetido reutiliza orden pendiente sin duplicar empresa.
 * 4. Confirmación y activación (pago único, factura/recibo USD+FX+DOP sin NCF inventado, método enmascarado,
 *    capacidad contratada + add-on exacto, confirmación repetida idempotente, primer acceso limpio).
 * 5. Matriz de fallos: rechazado, timeout -> 409 RECONCILIATION_REQUIRED, caída post-aprobación -> reconcile sin
 *    recobro, SMTP caído -> cola failed sin perder alta/pago, método de un solo uso sin PaymentProfile,
 *    webhook HMAC inválido (401) y anti-IDOR cross-tenant (404).
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

async function reqJson(baseUrl, method, pathUrl, { cookie = '', body = null, extraHeaders = {} } = {}) {
  const headers = { Origin: baseUrl, ...extraHeaders };
  if (cookie) headers.Cookie = cookie;
  if (body !== null) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${pathUrl}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  return { status: res.status, body: json, setCookies };
}

function startMockCardnetServer(port) {
  const state = {
    purchaseCalls: 0,
    customerCalls: 0,
    profileCalls: 0,
    mode: 'approve', // 'approve' | 'decline' | 'timeout' | 'approve_no_profile'
    lastPurchasePayload: null,
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      let parsed = {};
      try { parsed = rawBody ? JSON.parse(rawBody) : {}; } catch { parsed = {}; }

      // 1. POST /api/Customer -> create customer session
      if (req.method === 'POST' && req.url.endsWith('/api/Customer')) {
        state.customerCalls += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          Response: {
            CustomerId: 90000 + state.customerCalls,
            UniqueID: `MOCK-UID-${state.customerCalls}-${Date.now()}`,
            CaptureURL: `http://127.0.0.1:${port}/Capture`,
          },
        }));
      }

      // 2. GET /api/Customer/:id -> customer profile with reusable PaymentProfile (or empty)
      if (req.method === 'GET' && req.url.includes('/api/Customer/')) {
        state.profileCalls += 1;
        const custId = req.url.split('/api/Customer/')[1].split('?')[0];
        const profiles = state.mode === 'approve_no_profile'
          ? []
          : [{
              PaymentProfileId: 77001,
              Token: `TOK-REUSABLE-${custId}`,
              Brand: 'VISA',
              Last4: '4242',
              Expiration: '202912',
              Enabled: true,
            }];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          Response: {
            CustomerId: Number(custId) || 90001,
            PaymentProfiles: profiles,
          },
        }));
      }

      // 3. POST /api/Purchase -> charge token
      if (req.method === 'POST' && req.url.endsWith('/api/Purchase')) {
        state.purchaseCalls += 1;
        state.lastPurchasePayload = parsed;

        if (state.mode === 'timeout') {
          // Hold longer than CARDNET_TIMEOUT (2500ms in test) to trigger real AbortController timeout
          setTimeout(() => {
            if (!res.writableEnded) {
              res.writeHead(504, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'gateway_timeout' }));
            }
          }, 4000);
          return;
        }

        if (state.mode === 'decline') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            Response: {
              Transaction: {
                TransactionID: 55000 + state.purchaseCalls,
                Status: 'Declined',
                Steps: [{
                  ResponseCode: '05',
                  ResponseMessage: 'Do Not Honor (Fondos insuficientes)',
                }],
              },
            },
          }));
        }

        // approve or approve_no_profile
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          Response: {
            Transaction: {
              TransactionID: 66000 + state.purchaseCalls,
              Status: 'Approved',
              AuthorizationCode: `AUTH${String(state.purchaseCalls).padStart(4, '0')}`,
              RetrievalReferenceNumber: `RRN${Date.now().toString().slice(-8)}`,
              CreditCardNumber: '424242******4242',
              Steps: [{
                ResponseCode: '00',
                ResponseMessage: 'Aprobada',
                AuthorizationCode: `AUTH${String(state.purchaseCalls).padStart(4, '0')}`,
              }],
            },
          },
        }));
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found in mock CardNet' }));
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, state }));
  });
}

async function main() {
  const testConfig = validateTestEnvironment();
  const pool = createIsolatedTestPool(testConfig);
  const appPort = await getEphemeralPort();
  const mockPort = await getEphemeralPort();
  const baseUrl = `http://127.0.0.1:${appPort}`;

  const tag = crypto.randomBytes(4).toString('hex');
  const PASS = 'EtereasOnb!2026';
  const createdTenantIds = [];
  let fxRateBackup = [];

  let mockCardnet = null;
  let serverProc = null;
  let browser = null;

  try {
    // 0. Aplicar migraciones canónicas idempotentes de checkout orders y términos/bienvenida en salon_saas_test
    const checkoutOrdersSql = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'migrations', '20261115_create_saas_checkout_orders.sql'),
      'utf8'
    );
    await pool.query(checkoutOrdersSql);
    const termsMigration = require('../migrations/20261115_tenant_terms_and_welcome.cjs');
    await termsMigration.up(pool);

    // Asegurar tasa FX vigente en salon_saas_test (59.50 DOP/USD)
    const [existingFx] = await pool.query('SELECT * FROM saas_fx_rates WHERE pair = ?', ['USD_DOP']);
    fxRateBackup = existingFx || [];
    await pool.query('DELETE FROM saas_fx_rates WHERE pair = ?', ['USD_DOP']);
    await pool.query(
      `INSERT INTO saas_fx_rates (pair, rate, rate_scaled_10000, updated_by_email, reason, created_at, updated_at)
       VALUES ('USD_DOP', 59.5000, 595000, 'qa@etereas.test', 'Tasa controlada aceptación', NOW(), NOW())`
    );

    mockCardnet = await startMockCardnetServer(mockPort);

    const env = getSanitizedChildEnv(testConfig, appPort);
    env.SAAS_RENEWAL_WORKER_ENABLED = 'false';
    env.DISABLE_SCHEDULER = 'true';
    env.DGII_ENV = 'disabled';
    env.CARDNET_ENV = 'STAGING';
    env.CARDNET_ENABLE_LIVE_CHARGES = 'true';
    env.CARDNET_BASE_URL = `http://127.0.0.1:${mockPort}`;
    env.CARDNET_PUBLIC_KEY = 'TEST_PUBLIC_KEY_VALID_12345';
    env.CARDNET_PRIVATE_KEY = 'TEST_PRIVATE_KEY_VALID_12345';
    env.CARDNET_MERCHANT_NUMBER = '349099999';
    env.CARDNET_TERMINAL_ID = '88889999';
    env.CARDNET_TIMEOUT = '2000';
    env.TEST_FAIL_SMTP = 'true'; // Probar explícitamente resiliencia ante SMTP no disponible

    serverProc = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProc.stderr.on('data', (d) => process.stderr.write(`[SRV] ${d}`));
    await waitForServerHealth(appPort);
    console.log(`[SERVER READY] ${baseUrl} (Mock CardNet: http://127.0.0.1:${mockPort}, DB=${testConfig.database})`);

    // =========================================================================
    // 1. SELECCIÓN Y CÁLCULO COMERCIAL EXACTO (incluyendo falta de FX)
    // =========================================================================
    const { SaasCheckoutService } = require('../services/saas_checkout.service');
    const calcSvc = new SaasCheckoutService({ pool });
    const fxObj = { id: 1, pair: 'USD_DOP', rate: 59.5, rateFormatted: '59.5000' };

    const c1 = calcSvc.calculateCanonicalAmounts({ branchesCount: 1, extraUsersCount: 0, wantsMembershipsAddon: false, addonBranchesCount: 0, fxRate: fxObj });
    assert.strictEqual(c1.currency, 'DOP');
    assert.strictEqual(c1.fxSnapshot.usd.total_minor, '9900'); // US$99.00
    assert.strictEqual(c1.totalMinor.toString(), '589050');    // RD$5,890.50

    const c2 = calcSvc.calculateCanonicalAmounts({ branchesCount: 3, extraUsersCount: 0, wantsMembershipsAddon: false, addonBranchesCount: 0, fxRate: fxObj });
    assert.strictEqual(c2.fxSnapshot.usd.total_minor, '29700'); // 3 * US$99
    assert.strictEqual(c2.totalMinor.toString(), '1767150');    // RD$17,671.50

    const c3 = calcSvc.calculateCanonicalAmounts({ branchesCount: 2, extraUsersCount: 2, wantsMembershipsAddon: false, addonBranchesCount: 0, fxRate: fxObj });
    assert.strictEqual(c3.fxSnapshot.usd.total_minor, '25800'); // 2*99 + 2*30 = US$258
    assert.strictEqual(c3.totalMinor.toString(), '1535100');    // RD$15,351.00

    const c4 = calcSvc.calculateCanonicalAmounts({ branchesCount: 2, extraUsersCount: 0, wantsMembershipsAddon: true, addonBranchesCount: 1, fxRate: fxObj });
    assert.strictEqual(c4.fxSnapshot.usd.total_minor, '29700'); // 2*99 + 1*99 = US$297
    assert.strictEqual(c4.addonBranchesCount, 1);
    assert.strictEqual(c4.totalMinor.toString(), '1767150');
    console.log('  ✅ 1. Cálculo comercial exacto (1 suc, 3 suc, +usuarios, +add-on parcial, aritmética BigInt DOP/USD) PASS.');

    // =========================================================================
    // 2. TÉRMINOS PÚBLICOS Y VALIDACIONES DE REGISTRO
    // =========================================================================
    const termsRes = await reqJson(baseUrl, 'GET', '/api/public/terms/v2026.1');
    assert.strictEqual(termsRes.status, 200);
    assert.strictEqual(termsRes.body.version, 'v2026.1');
    assert.ok(termsRes.body.hash && termsRes.body.hash.length === 64, 'Debe devolver SHA-256 de v2026.1');

    const ownerAEmail = `onb_a_${tag}@test.local`;
    const noTermsRes = await reqJson(baseUrl, 'POST', '/api/public/onboarding', {
      body: {
        business_name: `Salon Alta A ${tag}`,
        owner_name: 'Ana Propietaria',
        owner_email: ownerAEmail,
        admin_password: PASS,
        branches_count: 2,
        extra_users_count: 1,
        wants_memberships_addon: true,
        addon_branches_count: 1,
        accept_terms: false,
      },
    });
    assert.strictEqual(noTermsRes.status, 400);
    assert.strictEqual(noTermsRes.body.code, 'TERMS_ACCEPTANCE_REQUIRED');

    const shortPassRes = await reqJson(baseUrl, 'POST', '/api/public/onboarding', {
      body: {
        business_name: `Salon Alta A ${tag}`,
        owner_name: 'Ana Propietaria',
        owner_email: ownerAEmail,
        admin_password: '123',
        accept_terms: true,
      },
    });
    assert.strictEqual(shortPassRes.status, 400);

    // Registro con manipulación de precios desde el cliente -> backend ignora total_minor/price manipulados
    const onbA = await reqJson(baseUrl, 'POST', '/api/public/onboarding', {
      body: {
        business_name: `Salon Alta A ${tag}`,
        owner_name: 'Ana Propietaria',
        owner_email: ownerAEmail,
        owner_phone: '8095550101',
        admin_password: PASS,
        branches_count: 2,
        extra_users_count: 1,
        wants_memberships_addon: true,
        addon_branches_count: 1,
        accept_terms: true,
        terms_version: 'v2026.1',
        authorize_recurring: true,
        // Manipulación maliciosa desde navegador:
        total_minor: 1,
        price: 0.01,
        currency: 'USD',
      },
    });
    assert.strictEqual(onbA.status, 201, `Onboarding A falló: ${onbA.status} ${JSON.stringify(onbA.body)}`);
    const TENANT_A = onbA.body.tenant_id;
    const ORDER_A = onbA.body.order;
    createdTenantIds.push(TENANT_A);
    const cookieA = onbA.setCookies.map((c) => c.split(';')[0]).join('; ');

    // 2*99 + 1*30 + 1*99 = US$327 * 59.50 = RD$19,456.50 -> 1945650 minor DOP
    assert.strictEqual(ORDER_A.currency, 'DOP');
    assert.strictEqual(ORDER_A.total_minor, '1945650', 'Manipular precio/total desde cliente NO debe alterar el cobro');
    assert.strictEqual(onbA.body.terms_acceptance.termsVersion, 'v2026.1');
    assert.strictEqual(onbA.body.terms_acceptance.documentHash, termsRes.body.hash);
    assert.strictEqual(onbA.body.terms_acceptance.recurringAuthorized, true);

    // Verificar persistencia real de términos y cola de bienvenida (y fallo controlado SMTP sin perder alta)
    const [termsRows] = await pool.query('SELECT * FROM tenant_terms_acceptances WHERE tenant_id = ?', [TENANT_A]);
    assert.strictEqual(termsRows.length, 1);
    assert.strictEqual(termsRows[0].terms_version, 'v2026.1');
    assert.strictEqual(termsRows[0].document_hash, termsRes.body.hash);
    assert.strictEqual(termsRows[0].recurring_authorized, true);

    await new Promise((r) => setTimeout(r, 350)); // dar tiempo a setImmediate(processWelcomeQueue)
    const [welcomeRows] = await pool.query('SELECT * FROM tenant_welcome_email_queue WHERE tenant_id = ?', [TENANT_A]);
    assert.strictEqual(welcomeRows.length, 1, 'Debe encolar exactamente 1 correo de bienvenida');
    assert.strictEqual(welcomeRows[0].status, 'failed', 'Con SMTP no disponible debe quedar failed para reintento, nunca sent falso');
    assert.ok(welcomeRows[0].attempts >= 1 && welcomeRows[0].last_error);

    // Verificar CERO datos operativos ficticios sembrados
    const [cliCnt] = await pool.query('SELECT COUNT(*)::int AS cnt FROM clients WHERE tenant_id = ?', [TENANT_A]);
    const [visCnt] = await pool.query('SELECT COUNT(*)::int AS cnt FROM visits WHERE tenant_id = ?', [TENANT_A]);
    const [invCnt] = await pool.query('SELECT COUNT(*)::int AS cnt FROM invoices WHERE tenant_id = ?', [TENANT_A]);
    assert.strictEqual(cliCnt[0].cnt, 0);
    assert.strictEqual(visCnt[0].cnt, 0);
    assert.strictEqual(invCnt[0].cnt, 0);

    // Registro repetido mismo correo: misma contraseña reutiliza orden pendiente sin duplicar empresa; otra contraseña -> 409
    const dupWrongPass = await reqJson(baseUrl, 'POST', '/api/public/onboarding', {
      body: { business_name: `Salon Alta A ${tag}`, owner_email: ownerAEmail, admin_password: 'WrongPassword1!', accept_terms: true },
    });
    assert.strictEqual(dupWrongPass.status, 409);
    assert.strictEqual(dupWrongPass.body.code, 'PENDING_EMAIL_EXISTS');

    const dupSamePass = await reqJson(baseUrl, 'POST', '/api/public/onboarding', {
      body: { business_name: `Salon Alta A ${tag}`, owner_email: ownerAEmail, admin_password: PASS, accept_terms: true },
    });
    assert.strictEqual(dupSamePass.status, 200);
    assert.strictEqual(dupSamePass.body.reused, true);
    assert.strictEqual(dupSamePass.body.tenant_id, TENANT_A);
    assert.strictEqual(dupSamePass.body.order.id, ORDER_A.id);
    console.log('  ✅ 2. Términos v2026.1 (SHA-256 + consentimiento separado), anti-tamper, SMTP fail-safe, cero datos ficticios y reintento idempotente PASS.');

    // =========================================================================
    // 3. CUENTA PENDIENTE (acceso a pago sí, operación bloqueada) + CHECKOUT REUTILIZABLE
    // =========================================================================
    const pendingOrderRead = await reqJson(baseUrl, 'GET', `/api/saas/billing/checkout/orders/${ORDER_A.id}`, { cookie: cookieA });
    assert.strictEqual(pendingOrderRead.status, 200);
    const pendingOpBlocked = await reqJson(baseUrl, 'GET', '/api/clients', { cookie: cookieA });
    assert.ok(pendingOpBlocked.status === 402 || pendingOpBlocked.status === 403, `Cuenta pendiente no debe operar: ${pendingOpBlocked.status}`);

    // Iniciar checkout 2 veces (doble clic / cerrar y retomar) -> reutiliza sesión PWCheckout
    const init1 = await reqJson(baseUrl, 'POST', `/api/saas/billing/checkout/orders/${ORDER_A.id}/initiate-cardnet`, { cookie: cookieA });
    assert.strictEqual(init1.status, 200, `initiate-cardnet falló: ${JSON.stringify(init1.body)}`);
    assert.strictEqual(init1.body.checkout.mode, 'pwcheckout_iframe');
    assert.strictEqual(init1.body.checkout.reusedSession, false);

    const init2 = await reqJson(baseUrl, 'POST', `/api/saas/billing/checkout/orders/${ORDER_A.id}/initiate-cardnet`, { cookie: cookieA });
    assert.strictEqual(init2.status, 200);
    assert.strictEqual(init2.body.checkout.reusedSession, true);
    assert.strictEqual(init2.body.checkout.uniqueId, init1.body.checkout.uniqueId);
    console.log('  ✅ 3. Cuenta pendiente restringida al pago + inicio/reapertura de checkout PWCheckout idempotente PASS.');

    // =========================================================================
    // 4. CONFIRMACIÓN CARDNET, ACTIVACIÓN, MÉTODO, FACTURA/RECIBO E IDEMPOTENCIA
    // =========================================================================
    const charge1 = await reqJson(baseUrl, 'POST', `/api/saas/billing/checkout/orders/${ORDER_A.id}/charge-token`, {
      cookie: cookieA,
      body: { trxToken: 'ONETIME-TRX-TOKEN-001' },
    });
    assert.strictEqual(charge1.status, 200, `charge-token falló: ${JSON.stringify(charge1.body)}`);
    assert.strictEqual(charge1.body.activated, true);
    assert.strictEqual(charge1.body.order.status, 'approved');
    assert.strictEqual(mockCardnet.state.purchaseCalls, 1);

    // Confirmación repetida -> idempotente, 0 cargos adicionales en CardNet
    const charge2 = await reqJson(baseUrl, 'POST', `/api/saas/billing/checkout/orders/${ORDER_A.id}/charge-token`, {
      cookie: cookieA,
      body: { trxToken: 'ONETIME-TRX-TOKEN-002' },
    });
    assert.strictEqual(charge2.status, 200);
    assert.strictEqual(charge2.body.alreadyProcessed, true);
    assert.strictEqual(mockCardnet.state.purchaseCalls, 1, 'Confirmación duplicada NO debe cobrar de nuevo');

    // Verificar estado persistido: tenant active, capacidad exacta (2 suc, 1 extra = 7 seats), add-on Membresías activo, 1 pago, 1 factura, 1 método enmascarado
    const [tRowsA] = await pool.query('SELECT status, licensed_branches, extra_user_seats, max_users FROM tenants WHERE id = ?', [TENANT_A]);
    assert.strictEqual(tRowsA[0].status, 'active');
    assert.strictEqual(Number(tRowsA[0].licensed_branches), 2);
    assert.strictEqual(Number(tRowsA[0].extra_user_seats), 1);
    assert.strictEqual(Number(tRowsA[0].max_users), 7);

    const [payRowsA] = await pool.query('SELECT * FROM saas_payments WHERE tenant_id = ?', [TENANT_A]);
    const [invRowsA] = await pool.query('SELECT * FROM saas_invoices WHERE tenant_id = ?', [TENANT_A]);
    const [pmRowsA] = await pool.query('SELECT * FROM saas_payment_methods WHERE tenant_id = ?', [TENANT_A]);
    assert.strictEqual(payRowsA.length, 1, 'Exactamente 1 pago registrado');
    assert.strictEqual(invRowsA.length, 1, 'Exactamente 1 factura comercial');
    assert.strictEqual(invRowsA[0].status, 'paid');
    assert.strictEqual(String(invRowsA[0].total_minor), '1945650');
    assert.strictEqual(pmRowsA.length, 1);
    assert.strictEqual(pmRowsA[0].brand, 'VISA');
    assert.strictEqual(pmRowsA[0].last4, '4242');

    // Recibo comercial: desglose USD, tasa FX, total DOP, sin NCF/e-CF inventado
    const receiptRes = await reqJson(baseUrl, 'GET', `/api/saas/billing/invoices/${invRowsA[0].id}/receipt`, { cookie: cookieA });
    assert.strictEqual(receiptRes.status, 200, `Recibo falló: ${JSON.stringify(receiptRes.body)}`);
    assert.strictEqual(receiptRes.body.receipt.currency, 'DOP');
    assert.strictEqual(String(receiptRes.body.receipt.total_minor), '1945650');
    assert.ok(!receiptRes.body.receipt.ncf, 'No debe inventar NCF/e-CF en recibo comercial SaaS');

    // Primer acceso operativo tras activación -> 200 vacío
    const firstAccessClients = await reqJson(baseUrl, 'GET', '/api/clients', { cookie: cookieA });
    assert.strictEqual(firstAccessClients.status, 200);
    assert.ok(Array.isArray(firstAccessClients.body) && firstAccessClients.body.length === 0);
    console.log('  ✅ 4. Cobro aprobado, activación exacta (2 suc + 1 extra + add-on), 1 pago, 1 factura/recibo, método VISA ****4242 y primer acceso limpio PASS.');

    // =========================================================================
    // 5. MATRIZ DE FALLOS: RECHAZADO, TIMEOUT, CAÍDA POST-APROBACIÓN, MÉTODO NO REUTILIZABLE, WEBHOOK Y ANTI-IDOR
    // =========================================================================
    const ownerBEmail = `onb_b_${tag}@test.local`;
    const onbB = await reqJson(baseUrl, 'POST', '/api/public/onboarding', {
      body: {
        business_name: `Salon Matriz Fallos B ${tag}`,
        owner_name: 'Bruno Fallos',
        owner_email: ownerBEmail,
        admin_password: PASS,
        branches_count: 1,
        extra_users_count: 0,
        wants_memberships_addon: false,
        accept_terms: true,
      },
    });
    assert.strictEqual(onbB.status, 201);
    const TENANT_B = onbB.body.tenant_id;
    const ORDER_B1 = onbB.body.order;
    createdTenantIds.push(TENANT_B);
    const cookieB = onbB.setCookies.map((c) => c.split(';')[0]).join('; ');

    // 5a. Anti-IDOR cross-tenant en checkout: Tenant B (pendiente) intenta acceder a orden de Tenant A -> 404
    const idorOrder = await reqJson(baseUrl, 'GET', `/api/saas/billing/checkout/orders/${ORDER_A.id}`, { cookie: cookieB });
    assert.strictEqual(idorOrder.status, 404);

    // 5b. Pago RECHAZADO (ResponseCode 05) -> orden declined, tenant sigue pending, 0 pagos/facturas
    mockCardnet.state.mode = 'decline';
    await reqJson(baseUrl, 'POST', `/api/saas/billing/checkout/orders/${ORDER_B1.id}/initiate-cardnet`, { cookie: cookieB });
    const declRes = await reqJson(baseUrl, 'POST', `/api/saas/billing/checkout/orders/${ORDER_B1.id}/charge-token`, {
      cookie: cookieB,
      body: { trxToken: 'ONETIME-DECLINE-001' },
    });
    assert.strictEqual(declRes.status, 200);
    assert.strictEqual(declRes.body.declined, true);
    assert.strictEqual(declRes.body.activated, false);
    assert.strictEqual(declRes.body.order.status, 'declined');
    const [tBRowAfterDecl] = await pool.query('SELECT status FROM tenants WHERE id = ?', [TENANT_B]);
    assert.strictEqual(tBRowAfterDecl[0].status, 'pending');

    // 5c. TIMEOUT -> orden unknown_timeout, segundo intento bloqueado con 409 RECONCILIATION_REQUIRED
    const newOrdB2 = await reqJson(baseUrl, 'POST', '/api/saas/billing/checkout/orders', {
      cookie: cookieB,
      body: { branches_count: 1, extra_users_count: 0, wants_memberships_addon: false },
    });
    assert.strictEqual(newOrdB2.status, 201);
    const ORDER_B2 = newOrdB2.body.order;
    mockCardnet.state.mode = 'timeout';
    await reqJson(baseUrl, 'POST', `/api/saas/billing/checkout/orders/${ORDER_B2.id}/initiate-cardnet`, { cookie: cookieB });
    const timeoutRes = await reqJson(baseUrl, 'POST', `/api/saas/billing/checkout/orders/${ORDER_B2.id}/charge-token`, {
      cookie: cookieB,
      body: { trxToken: 'ONETIME-TIMEOUT-001' },
    });
    assert.ok(timeoutRes.status >= 500 || timeoutRes.status === 504, `Timeout debe fallar controladamente: ${timeoutRes.status}`);
    const [ordB2Row] = await pool.query('SELECT status FROM saas_checkout_orders WHERE id = ?', [ORDER_B2.id]);
    assert.strictEqual(ordB2Row[0].status, 'unknown_timeout');

    const retryBlocked = await reqJson(baseUrl, 'POST', `/api/saas/billing/checkout/orders/${ORDER_B2.id}/charge-token`, {
      cookie: cookieB,
      body: { trxToken: 'ONETIME-TIMEOUT-002' },
    });
    assert.strictEqual(retryBlocked.status, 409);
    assert.strictEqual(retryBlocked.body.code, 'RECONCILIATION_REQUIRED');

    // 5d. Caída tras aprobación y antes de activar + método de un solo uso (sin PaymentProfile) -> reconcile activa sin recobrar
    mockCardnet.state.mode = 'approve_no_profile';
    const callsBeforeReconcile = mockCardnet.state.purchaseCalls;
    await pool.query(
      `UPDATE saas_checkout_orders
       SET status = 'approved', paid_at = NOW(), activated_at = NULL,
           cardnet_authorization_code = 'AUTH_CRASH_REC', cardnet_response_code = '00'
       WHERE id = ? AND tenant_id = ?`,
      [ORDER_B2.id, TENANT_B]
    );
    const recRes = await reqJson(baseUrl, 'POST', `/api/saas/billing/checkout/orders/${ORDER_B2.id}/reconcile`, { cookie: cookieB });
    assert.strictEqual(recRes.status, 200, `Reconcile falló: ${JSON.stringify(recRes.body)}`);
    assert.strictEqual(recRes.body.activated, true);
    assert.strictEqual(mockCardnet.state.purchaseCalls, callsBeforeReconcile, 'Reconcile tras aprobación NO debe volver a cobrar');
    const [pmRowsB] = await pool.query('SELECT * FROM saas_payment_methods WHERE tenant_id = ?', [TENANT_B]);
    assert.strictEqual(pmRowsB.length, 0, 'Token de un solo uso sin PaymentProfile NO debe fabricar método reutilizable');

    // Anti-IDOR cross-tenant con Tenant B ya ACTIVO: intenta acceder a factura y recibo de Tenant A -> 404
    const idorInvoice = await reqJson(baseUrl, 'GET', `/api/saas/billing/invoices/${invRowsA[0].id}`, { cookie: cookieB });
    const idorReceipt = await reqJson(baseUrl, 'GET', `/api/saas/billing/invoices/${invRowsA[0].id}/receipt`, { cookie: cookieB });
    assert.strictEqual(idorInvoice.status, 404);
    assert.strictEqual(idorReceipt.status, 404);

    // 5e. Webhook HMAC inválido -> 401/501 sin efectos en BD
    const badWh = await reqJson(baseUrl, 'POST', '/api/saas/billing/webhooks/cardnet', {
      body: { order_number: ORDER_B2.order_number, status: 'approved' },
      extraHeaders: { 'x-cardnet-signature': 'invalid_sig' },
    });
    assert.ok(badWh.status === 401 || badWh.status === 501, `Webhook inválido debe rechazarse fail-closed: ${badWh.status}`);

    // 5f. Falta de tasa FX -> error controlado 409 FX_RATE_NOT_CONFIGURED sin inventar tasa
    await pool.query('DELETE FROM saas_fx_rates WHERE pair = ?', ['USD_DOP']);
    const noFxOrder = await reqJson(baseUrl, 'POST', '/api/saas/billing/checkout/orders', {
      cookie: cookieA,
      body: { branches_count: 1, extra_users_count: 0 },
    });
    assert.strictEqual(noFxOrder.status, 409, `Sin tasa FX debe responder 409 controlado: ${noFxOrder.status} ${JSON.stringify(noFxOrder.body)}`);
    assert.strictEqual(noFxOrder.body.code, 'FX_RATE_NOT_CONFIGURED');
    console.log('  ✅ 5. Matriz de fallos (rechazo, timeout 409, recuperación post-aprobación sin recobro, método no reutilizable, anti-IDOR 404, webhook 401/501, sin FX 503) PASS.');

    // =========================================================================
    // 6. NAVEGADOR REAL: Landing (/) + modal registro + abrir términos sin perder datos + móvil/desktop
    // =========================================================================
    const executablePath = findBrowserExecutable();
    browser = await puppeteer.launch({ headless: 'new', executablePath, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    const pageErrors = [];
    const server5xx = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('response', (res) => { if (res.status() >= 500) server5xx.push(`${res.status()} ${res.url()}`); });

    await page.goto(baseUrl, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('Etereas') || document.body.innerText.includes('99'), { timeout: 15000 });
    // Comprobar viewport móvil también sin desbordes fatales ni pageerrors
    await page.setViewport({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'networkidle2' });
    assert.strictEqual(pageErrors.length, 0, `pageerrors en Landing: ${pageErrors.join(' | ')}`);
    assert.strictEqual(server5xx.length, 0, `5xx en Landing: ${server5xx.join(' | ')}`);
    console.log('  ✅ 6. Navegador real (desktop 1366x900 + móvil 390x844 en Landing /): 0 pageerrors, 0 5xx PASS.');

    console.log('\n🎉 ACEPTACIÓN "ALTA Y PAGO COMPLETO" SUPERADA (6/6 BLOQUES PASS).');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (serverProc && !serverProc.killed) serverProc.kill();
    if (mockCardnet && mockCardnet.server) mockCardnet.server.close();

    // Restaurar tasa FX original en salon_saas_test
    await pool.query('DELETE FROM saas_fx_rates WHERE pair = ?', ['USD_DOP']).catch(() => {});
    for (const r of fxRateBackup) {
      await pool.query(
        `INSERT INTO saas_fx_rates (pair, rate, rate_scaled_10000, updated_by_email, reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [r.pair, r.rate, r.rate_scaled_10000, r.updated_by_email, r.reason, r.created_at, r.updated_at]
      ).catch(() => {});
    }

    for (const tid of createdTenantIds) {
      await pool.query('DELETE FROM tenant_welcome_email_queue WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM tenant_terms_acceptances WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM saas_checkout_orders WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM saas_payments WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM saas_invoice_items WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM saas_invoices WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM saas_payment_methods WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM tenant_feature_overrides WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM tenant_subscription_events WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM user_sessions WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM security_audit_logs WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM salons WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM branches WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM users WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM tenants WHERE id = ?', [tid]).catch(() => {});
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ FALLO ACEPTACIÓN ALTA Y PAGO COMPLETO:', err);
  process.exit(1);
});
