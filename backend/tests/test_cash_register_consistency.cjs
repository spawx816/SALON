/* global document */
'use strict';

/**
 * Acceptance & Regression Suite: Consistencia Canónica de Caja de Jornada vs Facturas Activas
 * Ejecuta contra salon_saas_test con backend/server.js + dist/ + Chrome headless real.
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
  let data = null;
  try { data = await res.json(); } catch (_) { data = null; }
  return { status: res.status, headers: res.headers, body: data };
}

async function loginAs(baseUrl, email, password) {
  const res = await reqJson(baseUrl, 'POST', '/api/auth/login', { body: { email, password } });
  assert.strictEqual(res.status, 200, `Login falló para ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  assert.ok(cookie, `Sin cookie de sesión para ${email}`);
  return { cookie, user: res.body?.user };
}

async function main() {
  const testConfig = validateTestEnvironment();
  const pool = createIsolatedTestPool(testConfig);
  const port = await getEphemeralPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let serverProc = null;
  let browser = null;

  const tag = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const TENANT_A = crypto.randomUUID();
  const TENANT_B = crypto.randomUUID();
  const BRANCH_A = crypto.randomUUID();
  const BRANCH_B = crypto.randomUUID();
  const BRANCH_OTHER = crypto.randomUUID();
  const PASS = 'CajaPass2026!';
  const PASS_HASH = bcrypt.hashSync(PASS, 10);
  const ownerAEmail = `owner_caja_a_${tag}@test.local`;
  const opAEmail = `op_caja_a_${tag}@test.local`;
  const ownerBEmail = `owner_caja_b_${tag}@test.local`;

  try {
    await pool.query(
      "INSERT INTO tenants (id, business_name, email, slug, status, licensed_branches, max_branches, extra_user_seats, max_users) VALUES (?, ?, ?, ?, 'active', 2, 2, 4, 10), (?, ?, ?, ?, 'active', 1, 1, 0, 3)",
      [TENANT_A, `Empresa Caja A ${tag}`, ownerAEmail, `caja-a-${tag}`, TENANT_B, `Empresa Caja B ${tag}`, ownerBEmail, `caja-b-${tag}`]
    );

    await pool.query(
      "INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, billing_cycle, currency, current_period_start, current_period_end) VALUES (?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', NOW(), NOW() + INTERVAL '30 days'), (?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', NOW(), NOW() + INTERVAL '30 days')",
      [crypto.randomUUID(), TENANT_A, crypto.randomUUID(), TENANT_B]
    );

    await pool.query(
      `INSERT INTO branches (id, tenant_id, name, is_main, is_active)
       VALUES (?, ?, 'Sucursal A', TRUE, TRUE), (?, ?, 'Sucursal B', FALSE, TRUE), (?, ?, 'Sucursal Otra', TRUE, TRUE)`,
      [BRANCH_A, TENANT_A, BRANCH_B, TENANT_A, BRANCH_OTHER, TENANT_B]
    );

    const [roleOpARows] = await pool.query(
      `INSERT INTO roles (tenant_id, nombre, permisos) VALUES (?, 'Cajero Sucursal A', ?::jsonb) RETURNING id`,
      [TENANT_A, JSON.stringify({
        'pos.visits.view': true, 'pos.visits.create': true,
        'pos.cash_registers.view': true, 'pos.cash_registers.manage': true,
        'pos.invoices.view': true, 'pos.invoices.void': true,
      })]
    );

    await pool.query(
      `INSERT INTO users (id, tenant_id, branch_id, salon_id, name, nombre, username, email, password_hash, role, role_id, authorized_branch_ids, all_branches_access, is_active, estado)
       VALUES
         (?, ?, ?, ?, 'Owner Caja A', 'Owner Caja A', ?, ?, ?, 'propietario', NULL, ?::jsonb, TRUE, TRUE, 'Activo'),
         (?, ?, ?, ?, 'Cajero A', 'Cajero A', ?, ?, ?, 'empleado', ?, ?::jsonb, FALSE, TRUE, 'Activo'),
         (?, ?, ?, ?, 'Owner Caja B', 'Owner Caja B', ?, ?, ?, 'propietario', NULL, ?::jsonb, TRUE, TRUE, 'Activo')`,
      [
        crypto.randomUUID(), TENANT_A, BRANCH_A, BRANCH_A, ownerAEmail, ownerAEmail, PASS_HASH, JSON.stringify([BRANCH_A, BRANCH_B]),
        crypto.randomUUID(), TENANT_A, BRANCH_A, BRANCH_A, opAEmail, opAEmail, PASS_HASH, roleOpARows[0].id, JSON.stringify([BRANCH_A]),
        crypto.randomUUID(), TENANT_B, BRANCH_OTHER, BRANCH_OTHER, ownerBEmail, ownerBEmail, PASS_HASH, JSON.stringify([BRANCH_OTHER]),
      ]
    );

    const env = getSanitizedChildEnv(testConfig, port);
    env.SAAS_RENEWAL_WORKER_ENABLED = 'false';
    env.DISABLE_SCHEDULER = 'true';
    env.DGII_ENV = 'disabled';
    env.DGII_MODE = 'disabled';
    env.CARDNET_ENV = 'disabled';

    serverProc = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForServerHealth(port);
    console.log(`[SERVER READY] ${baseUrl} (DB=${testConfig.database})`);

    const ownerA = await loginAs(baseUrl, ownerAEmail, PASS);
    const opA = await loginAs(baseUrl, opAEmail, PASS);
    const ownerB = await loginAs(baseUrl, ownerBEmail, PASS);

    // 1. Abrir Caja 1 en Sucursal A con RD$1,000 de fondo inicial
    const open1 = await reqJson(baseUrl, 'POST', '/api/cash-registers/open', {
      cookie: opA.cookie,
      body: { salon_id: BRANCH_A, opening_balance: 1000, notes: 'Caja 1 A' },
    });
    assert.strictEqual(open1.status, 200);
    const REG1_ID = open1.body.id;

    // 2. Venta Tarjeta RD$12,123 (payload real del POS con array applied_payments)
    const vCardId = `VIS-CARD-${tag}`;
    const vCard = await reqJson(baseUrl, 'POST', `/api/visits/${vCardId}/checkout`, {
      cookie: opA.cookie,
      body: {
        client_id: 'INVITADO',
        client_name: 'Clienta Tarjeta 12123',
        salon_id: BRANCH_A,
        cash_register_id: REG1_ID,
        servicios: ['Balayage'],
        items_detail: [{ nombre: 'Balayage', precio: 12123, precioAplicado: 12123, cantidad: 1 }],
        subtotal: 12123,
        descuento: 0,
        total: 12123,
        metodo_pago: 'Tarjeta',
        applied_payments: [{ method: 'Tarjeta', amount: 12123 }],
        ncf_type: 'NONE',
      },
    });
    assert.strictEqual(vCard.status, 200, `Checkout tarjeta falló: ${JSON.stringify(vCard.body)}`);

    // Verificar consistencia inmediata en TODOS los endpoints: Tarjeta = 12123, Total Recibido = 12123, Esperado Efectivo = 1000
    const [active1, movs1, list1, invs1, rep1] = await Promise.all([
      reqJson(baseUrl, 'GET', `/api/cash-registers/active?salon_id=${BRANCH_A}`, { cookie: opA.cookie }),
      reqJson(baseUrl, 'GET', `/api/cash-registers/${REG1_ID}/movements`, { cookie: opA.cookie }),
      reqJson(baseUrl, 'GET', `/api/cash-registers?salon_id=${BRANCH_A}`, { cookie: ownerA.cookie }),
      reqJson(baseUrl, 'GET', `/api/cash-registers/${REG1_ID}/invoices`, { cookie: opA.cookie }),
      reqJson(baseUrl, 'GET', `/api/cash-registers/${REG1_ID}/close-report`, { cookie: opA.cookie }),
    ]);

    assert.strictEqual(active1.body.tarjeta_total, 12123);
    assert.strictEqual(active1.body.total_dinero_recibido, 12123);
    assert.strictEqual(active1.body.expected_cash, 1000, 'Tarjeta NO debe incrementar efectivo esperado');

    assert.strictEqual(movs1.body.summary.tarjetaTotal, 12123);
    assert.strictEqual(movs1.body.summary.totalDineroRecibido, 12123);
    assert.strictEqual(movs1.body.summary.montoEstimadoEnCaja, 1000);

    const row1 = (list1.body || []).find((r) => String(r.id) === String(REG1_ID));
    assert.strictEqual(row1.tarjeta_total, 12123);
    assert.strictEqual(row1.total_ventas, 12123);
    assert.strictEqual(row1.monto_esperado, 1000);

    assert.strictEqual(invs1.body.length, 1);
    assert.strictEqual(Number(invs1.body[0].total), 12123);

    assert.strictEqual(rep1.body.report.stats.tarjetaTotal, 12123);
    assert.strictEqual(rep1.body.report.montoEsperado, 1000);
    console.log('  ✅ 1. Venta Tarjeta RD$12,123: 100% consistente entre /active, /movements, /list, /invoices y /close-report (efectivo esperado = RD$1,000) PASS.');

    // 3. Compatibilidad con fila legacy (applied_payments en ceros pero metodo_pago='Tarjeta', total_cents=100000 -> RD$1,000)
    const vLegacyId = `VIS-LEG-${tag}`;
    await pool.query(
      `INSERT INTO visits (id, tenant_id, salon_id, cash_register_id, client_id, client_name, servicios, items_detail, subtotal, total, total_cents, currency, metodo_pago, applied_payments, status, visited_at)
       VALUES (?, ?, ?, ?, 'INVITADO', 'Legacy Tarjeta', '["Corte"]'::jsonb, '[]'::jsonb, 1000, 1000, 100000, 'DOP', 'Tarjeta', '{"tarjeta":0,"efectivo":0,"transferencia":0,"currency":"DOP"}'::jsonb, 'Facturado', NOW())`,
      [vLegacyId, TENANT_A, BRANCH_A, REG1_ID]
    );
    const movsLegacy = await reqJson(baseUrl, 'GET', `/api/cash-registers/${REG1_ID}/movements`, { cookie: opA.cookie });
    assert.strictEqual(movsLegacy.body.summary.tarjetaTotal, 13123, 'Fila legacy con applied_payments en 0 debe atribuirse a Tarjeta por metodo_pago');
    assert.strictEqual(movsLegacy.body.summary.montoEstimadoEnCaja, 1000);
    // Eliminar la fila sintética legacy antes de continuar con los cálculos exactos
    await pool.query('DELETE FROM visits WHERE id = ? AND tenant_id = ?', [vLegacyId, TENANT_A]);

    // 4. Venta Efectivo (RD$1,500) + Pago Mixto (RD$500 efectivo + RD$700 tarjeta + RD$300 transferencia) + Transferencia (RD$800) + Gift Card (RD$400)
    const vCashId = `VIS-CASH-${tag}`;
    await reqJson(baseUrl, 'POST', `/api/visits/${vCashId}/checkout`, {
      cookie: opA.cookie,
      body: {
        client_id: 'INVITADO', client_name: 'Clienta Efectivo', salon_id: BRANCH_A, cash_register_id: REG1_ID,
        servicios: ['Secado'], items_detail: [{ nombre: 'Secado', precio: 1500, precioAplicado: 1500, cantidad: 1 }],
        subtotal: 1500, descuento: 0, total: 1500, metodo_pago: 'Efectivo',
        applied_payments: [{ method: 'Efectivo', amount: 1500 }], ncf_type: 'NONE',
      },
    });

    const vMixId = `VIS-MIX-${tag}`;
    await reqJson(baseUrl, 'POST', `/api/visits/${vMixId}/checkout`, {
      cookie: opA.cookie,
      body: {
        client_id: 'INVITADO', client_name: 'Clienta Mixto', salon_id: BRANCH_A, cash_register_id: REG1_ID,
        servicios: ['Color'], items_detail: [{ nombre: 'Color', precio: 1500, precioAplicado: 1500, cantidad: 1 }],
        subtotal: 1500, descuento: 0, total: 1500,
        metodo_pago: 'Mixto (Efectivo: RD$ 500.00 + Tarjeta: RD$ 700.00 + Transferencia: RD$ 300.00)',
        applied_payments: [
          { method: 'Efectivo', amount: 500 },
          { method: 'Tarjeta', amount: 700 },
          { method: 'Transferencia', amount: 300 },
        ],
        ncf_type: 'NONE',
      },
    });

    const vTransfId = `VIS-TRF-${tag}`;
    await reqJson(baseUrl, 'POST', `/api/visits/${vTransfId}/checkout`, {
      cookie: opA.cookie,
      body: {
        client_id: 'INVITADO', client_name: 'Clienta Transf', salon_id: BRANCH_A, cash_register_id: REG1_ID,
        servicios: ['Manicure'], items_detail: [{ nombre: 'Manicure', precio: 800, precioAplicado: 800, cantidad: 1 }],
        subtotal: 800, descuento: 0, total: 800, metodo_pago: 'Transferencia',
        applied_payments: [{ method: 'Transferencia', amount: 800 }], ncf_type: 'NONE',
      },
    });

    const vGcId = `VIS-GC-${tag}`;
    await reqJson(baseUrl, 'POST', `/api/visits/${vGcId}/checkout`, {
      cookie: opA.cookie,
      body: {
        client_id: 'INVITADO', client_name: 'Clienta Gift', salon_id: BRANCH_A, cash_register_id: REG1_ID,
        servicios: ['Pedicure'], items_detail: [{ nombre: 'Pedicure', precio: 400, precioAplicado: 400, cantidad: 1 }],
        subtotal: 400, descuento: 0, total: 400, metodo_pago: 'Gift Card',
        applied_payments: [{ method: 'Gift Card', amount: 400 }], ncf_type: 'NONE',
      },
    });

    // Esperados:
    // Efectivo: 1500 + 500 = 2000
    // Tarjeta: 12123 + 700 = 12823
    // Transferencia: 300 + 800 = 1100
    // Gift Card: 400
    // Total Dinero Recibido: 2000 + 12823 + 1100 + 400 = 16323
    // Efectivo esperado en caja: 1000 (inicial) + 2000 (efectivo) = 3000
    const movsAll = await reqJson(baseUrl, 'GET', `/api/cash-registers/${REG1_ID}/movements`, { cookie: opA.cookie });
    const sAll = movsAll.body.summary;
    assert.strictEqual(sAll.efectivoTotal, 2000, `Efectivo esperado 2000, got ${sAll.efectivoTotal}`);
    assert.strictEqual(sAll.tarjetaTotal, 12823, `Tarjeta esperada 12823, got ${sAll.tarjetaTotal}`);
    assert.strictEqual(sAll.transferenciaTotal, 1100, `Transferencia esperada 1100, got ${sAll.transferenciaTotal}`);
    assert.strictEqual(sAll.giftCardTotal, 400, `Gift Card esperada 400, got ${sAll.giftCardTotal}`);
    assert.strictEqual(sAll.totalDineroRecibido, 16323);
    assert.strictEqual(sAll.montoEstimadoEnCaja, 3000, 'Solo efectivo suma a caja esperada (1000 + 2000 = 3000)');
    console.log('  ✅ 2. Efectivo + Mixto + Transferencia + Gift Card + compatibilidad legacy: distribución exacta en centavos PASS.');

    // 5. Anular venta mixta y venta tarjeta -> verificar reversión exacta sin doble reversión
    const voidMix = await reqJson(baseUrl, 'POST', `/api/visits/${vMixId}/void`, { cookie: ownerA.cookie, body: { reason: 'Anulación mixto' } });
    assert.strictEqual(voidMix.status, 200);
    const voidCard = await reqJson(baseUrl, 'POST', `/api/visits/${vCardId}/void`, { cookie: ownerA.cookie, body: { reason: 'Anulación tarjeta' } });
    assert.strictEqual(voidCard.status, 200);

    // Restan: Efectivo 1500, Tarjeta 0, Transferencia 800, Gift Card 400 -> Total recibido 2700, Efectivo esperado = 1000 + 1500 = 2500
    const movsAfterVoid = await reqJson(baseUrl, 'GET', `/api/cash-registers/${REG1_ID}/movements`, { cookie: opA.cookie });
    assert.strictEqual(movsAfterVoid.body.summary.efectivoTotal, 1500);
    assert.strictEqual(movsAfterVoid.body.summary.tarjetaTotal, 0);
    assert.strictEqual(movsAfterVoid.body.summary.transferenciaTotal, 800);
    assert.strictEqual(movsAfterVoid.body.summary.giftCardTotal, 400);
    assert.strictEqual(movsAfterVoid.body.summary.montoEstimadoEnCaja, 2500, 'Sin doble reversión tras anular mixto y tarjeta');
    console.log('  ✅ 3. Anulación de venta mixta y tarjeta sin doble reversión (efectivo esperado = RD$2,500) PASS.');

    // 6. Cerrar Caja 1 (cuadre exacto RD$2,500) -> Abrir Caja 2 en la MISMA sucursal -> aislar ventas por cash_register_id
    const close1 = await reqJson(baseUrl, 'POST', `/api/cash-registers/${REG1_ID}/close`, {
      cookie: opA.cookie,
      body: { closing_balance: 2500, notes: 'Cierre cuadrado Caja 1' },
    });
    assert.strictEqual(close1.status, 200, `Cierre Caja 1 falló: ${JSON.stringify(close1.body)}`);
    assert.strictEqual(close1.body.expected_balance, 2500);
    assert.strictEqual(close1.body.difference, 0);

    const open2 = await reqJson(baseUrl, 'POST', '/api/cash-registers/open', {
      cookie: opA.cookie,
      body: { salon_id: BRANCH_A, opening_balance: 500, notes: 'Caja 2 A' },
    });
    assert.strictEqual(open2.status, 200);
    const REG2_ID = open2.body.id;

    const vReg2Id = `VIS-R2-${tag}`;
    await reqJson(baseUrl, 'POST', `/api/visits/${vReg2Id}/checkout`, {
      cookie: opA.cookie,
      body: {
        client_id: 'INVITADO', client_name: 'Clienta Caja 2', salon_id: BRANCH_A, cash_register_id: REG2_ID,
        servicios: ['Lavado'], items_detail: [{ nombre: 'Lavado', precio: 600, precioAplicado: 600, cantidad: 1 }],
        subtotal: 600, descuento: 0, total: 600, metodo_pago: 'Tarjeta',
        applied_payments: [{ method: 'Tarjeta', amount: 600 }], ncf_type: 'NONE',
      },
    });

    const [rep1After, rep2After] = await Promise.all([
      reqJson(baseUrl, 'GET', `/api/cash-registers/${REG1_ID}/close-report`, { cookie: ownerA.cookie }),
      reqJson(baseUrl, 'GET', `/api/cash-registers/${REG2_ID}/close-report`, { cookie: ownerA.cookie }),
    ]);
    assert.strictEqual(rep1After.body.report.montoEsperado, 2500, 'Instantánea histórica Caja 1 preservada');
    assert.strictEqual(rep2After.body.report.stats.tarjetaTotal, 600, 'Caja 2 solo refleja sus propias facturas');
    assert.strictEqual(rep2After.body.report.stats.efectivoTotal, 0, 'Caja 2 no hereda ventas de Caja 1');
    assert.strictEqual(rep2After.body.report.montoEsperado, 500);

    // Aislamiento otra sucursal (403) y otro tenant (404)
    const openB = await reqJson(baseUrl, 'POST', '/api/cash-registers/open', {
      cookie: ownerA.cookie,
      body: { salon_id: BRANCH_B, opening_balance: 200, notes: 'Caja Sucursal B' },
    });
    assert.strictEqual(openB.status, 200);
    const branchDenied = await reqJson(baseUrl, 'GET', `/api/cash-registers/${openB.body.id}/movements`, { cookie: opA.cookie });
    assert.strictEqual(branchDenied.status, 403);
    const crossTenant = await reqJson(baseUrl, 'GET', `/api/cash-registers/${REG2_ID}/movements`, { cookie: ownerB.cookie });
    assert.strictEqual(crossTenant.status, 404);
    console.log('  ✅ 4. Dos cajas en misma sucursal aisladas, snapshot histórico preservado, aislamiento sucursal (403) y tenant (404) PASS.');

    // 7. Verificación en navegador real (Chrome headless): /cajas muestra totales coincidentes y sin texto "Cardnet"
    const executablePath = findBrowserExecutable();
    browser = await puppeteer.launch({ headless: 'new', executablePath, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(baseUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('input[type="password"]', { timeout: 15000 });
    const uIn = await page.$('input[id*="login"], input[name="username"], input[type="email"], input[type="text"]');
    await uIn.click({ clickCount: 3 });
    await uIn.type(ownerAEmail);
    await page.type('input[type="password"]', PASS);
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForFunction(() => !document.querySelector('input[type="password"]'), { timeout: 15000 }),
    ]);

    await page.goto(`${baseUrl}/cajas`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('2,500.00') && document.body.innerText.includes('600.00'), { timeout: 15000 });
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('2,500.00') && document.body.innerText.includes('600.00'), { timeout: 15000 });
    const cajasText = await page.evaluate(() => document.body.innerText);
    assert.ok(!cajasText.includes('Cardnet'), 'No debe etiquetar pagos manuales de tarjeta como Cardnet');
    assert.strictEqual(pageErrors.length, 0, `pageerrors en /cajas: ${pageErrors.join(' | ')}`);
    await browser.close();
    browser = null;
    console.log('  ✅ 5. Verificación UI en /cajas tras recarga en navegador real (totales exactos, sin etiqueta Cardnet, 0 pageerrors) PASS.');

    console.log('\n🎉 SUITE DE CONSISTENCIA DE CAJA DE JORNADA SUPERADA (5/5 BLOQUES PASS).');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (serverProc && !serverProc.killed) serverProc.kill();
    await pool.query('DELETE FROM cash_register_movements WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM cash_registers WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM visits WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM user_sessions WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM security_audit_logs WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM users WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM roles WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM branches WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ FALLO CONSISTENCIA DE CAJA:', err);
  process.exit(1);
});
