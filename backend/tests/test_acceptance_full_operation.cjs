/**
 * Acceptance Test Suite: "Operación Completa" (Etereas)
 *
 * Covers end-to-end against isolated PostgreSQL (salon_saas_test):
 * 1. Setup: 2 synthetic tenants, 2 branches in Tenant A, Owner, Branch-A-only Operator, Employee, Category.
 * 2. Catalog & Inventory: Service (RD$1,000, 10% comm), Product (RD$500, 0% comm), stock +10 in Branch A, Branch B isolated.
 * 3. Cash Register Open: RD$2,000 in Branch A, operator from session, duplicate open blocked, Branch B blocked.
 * 4. Base Cash Sale + Idempotency: 1 Service + 2 Products = RD$2,000 (200000 cents), stock 10->8, comm RD$100/RD$0, cash 2000->4000.
 * 5. Void / Anulación: Unauthorized blocked (403), Owner void restores stock 8->10, voids comm, reverts cash 4000->2000, 2nd void 409.
 * 6. Valid Sale + Close (diff RD$0) + Closed Register Block + Separate Variance Close (reason + double_confirm + PIN).
 * 7. Reports & Isolation: Dashboard/BI net sales RD$2,000 (fund not counted), Branch B & Tenant B untouched, ID tampering blocked.
 * 8. Edge Cases: Insufficient stock, 2 concurrent sales on last unit, service-only no stock move, archived product, no open register,
 *    discount unauthorized vs PIN-authorized, intermediate persistence failure rollback.
 */

const http = require('http');
const net = require('net');
const crypto = require('crypto');
const assert = require('assert');
const path = require('path');
const bcrypt = require('bcryptjs');
const { spawn } = require('child_process');
const { validateTestEnvironment, createIsolatedTestPool, getSanitizedChildEnv } = require('../utils/test_env_guard.cjs');

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

function apiRequest(port, { method = 'GET', path: reqPath, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const payload = body !== null && body !== undefined ? JSON.stringify(body) : null;
    const reqHeaders = { ...headers };
    if (payload !== null) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method,
      headers: reqHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = data ? JSON.parse(data) : {}; } catch (_) { parsed = { raw: data }; }
        const setCookie = res.headers['set-cookie'] || [];
        resolve({ status: res.statusCode, body: parsed, setCookie });
      });
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function extractAuthCookie(setCookieArr = []) {
  for (const c of setCookieArr) {
    const m = String(c).match(/auth_token=([^;]+)/);
    if (m) return `auth_token=${m[1]}`;
  }
  return '';
}

async function runAcceptanceSuite() {
  console.log('=== START ACCEPTANCE TEST: OPERACIÓN COMPLETA (ETEREAS) ===\n');
  const testDbConfig = validateTestEnvironment({ allowDisposableSchema: true });
  const pool = createIsolatedTestPool(testDbConfig);

  let serverProcess = null;
  let port = null;
  const ts = Date.now();
  const TENANT_A = crypto.randomUUID();
  const TENANT_B = crypto.randomUUID();
  const BRANCH_A = crypto.randomUUID();
  const BRANCH_B = crypto.randomUUID();
  const BRANCH_B2 = crypto.randomUUID();
  const CLIENT_A = crypto.randomUUID();
  const CLIENT_B = crypto.randomUUID();
  const SALON_A_ID = `sal-a-${ts}`;
  const SALON_B_ID = `sal-b-${ts}`;

  const results = [];
  const recordStep = (step, expected, observed, passed) => {
    results.push({ step, expected, observed, status: passed ? 'PASS' : 'FAIL' });
    console.log(`  [${passed ? 'PASS' : 'FAIL'}] ${step} -> ${observed}`);
    assert.strictEqual(passed, true, `FAILED ${step}: expected ${expected}, got ${observed}`);
  };

  try {
    port = await getEphemeralPort();
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

    const dbCheck = await apiRequest(port, { method: 'GET', path: '/api/health/db-check' });
    assert.strictEqual(dbCheck.body.database, testDbConfig.database, 'Must run strictly against isolated test DB');
    console.log(`[ENV VERIFIED] Server on :${port}, DB=${dbCheck.body.database}, Worker=false, CardNet/DGII=disabled\n`);

    // =========================================================================
    // 1. PREPARAR EL CASO
    // =========================================================================
    const passHash = bcrypt.hashSync('TestPass2026!', 10);
    const pinHash = bcrypt.hashSync('1234', 10);

    await pool.query(
      "INSERT INTO tenants (id, business_name, slug, email, status) VALUES (?, 'Empresa Sintética A', ?, ?, 'active')",
      [TENANT_A, `emp-a-${ts}`, `owner.a.${ts}@test-fixtures.local`]
    );
    await pool.query(
      "INSERT INTO tenants (id, business_name, slug, email, status) VALUES (?, 'Empresa Sintética B', ?, ?, 'active')",
      [TENANT_B, `emp-b-${ts}`, `owner.b.${ts}@test-fixtures.local`]
    );

    // Active subscriptions (canonical PRINCIPAL plan) so Entitlements allows POS, Inventory, Cash, Commissions
    const [planRows] = await pool.query("SELECT id FROM saas_plans WHERE UPPER(code) = 'PRINCIPAL' LIMIT 1");
    const principalPlanId = planRows[0]?.id || 3;
    await pool.query(
      `INSERT INTO tenant_subscriptions (tenant_id, saas_plan_id, plan_code, status, billing_cycle, currency, current_period_start, current_period_end)
       VALUES (?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', NOW(), NOW() + INTERVAL '30 days'),
              (?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', NOW(), NOW() + INTERVAL '30 days')`,
      [TENANT_A, principalPlanId, TENANT_B, principalPlanId]
    );

    await pool.query(
      "INSERT INTO branches (id, tenant_id, name, is_main, is_active) VALUES (?, ?, 'Sucursal A', TRUE, TRUE), (?, ?, 'Sucursal B', FALSE, TRUE), (?, ?, 'Sucursal B2', TRUE, TRUE)",
      [BRANCH_A, TENANT_A, BRANCH_B, TENANT_A, BRANCH_B2, TENANT_B]
    );
    await pool.query(
      "INSERT INTO salons (id, tenant_id, name) VALUES (?, ?, 'Sucursal A'), (?, ?, 'Sucursal B')",
      [SALON_A_ID, TENANT_A, SALON_B_ID, TENANT_A]
    );

    await pool.query(
      "INSERT INTO security_settings (tenant_id, admin_pin_hash) VALUES (?, ?)",
      [TENANT_A, pinHash]
    );

    const ownerAEmail = `owner.a.${ts}@test-fixtures.local`;
    const opAEmail = `operador.a.${ts}@test-fixtures.local`;
    const ownerBEmail = `owner.b.${ts}@test-fixtures.local`;

    await pool.query(
      `INSERT INTO users (tenant_id, branch_id, salon_id, username, email, name, nombre, role, password_hash, is_active, estado, all_branches_access, authorized_branch_ids)
       VALUES (?, ?, ?, ?, ?, 'Owner A', 'Owner A', 'propietario', ?, TRUE, 'Activo', TRUE, ?::jsonb)`,
      [TENANT_A, BRANCH_A, BRANCH_A, ownerAEmail, ownerAEmail, passHash, JSON.stringify([BRANCH_A, BRANCH_B])]
    );
    const [opRoleRows] = await pool.query(
      `INSERT INTO roles (tenant_id, nombre, permisos)
       VALUES (?, 'Operador de Caja', ?::jsonb)
       RETURNING id`,
      [TENANT_A, JSON.stringify({
        'pos.sales.create': true,
        'pos.sales.view': true,
        'pos.visits.create': true,
        'pos.visits.view': true,
        'pos.cash_registers.manage': true,
        'pos.cash_registers.view': true,
        'clients.view': true,
        'catalog.view': true
      })]
    );
    const OP_ROLE_ID = opRoleRows[0].id;

    await pool.query(
      `INSERT INTO users (tenant_id, branch_id, salon_id, username, email, name, nombre, role, role_id, password_hash, is_active, estado, all_branches_access, authorized_branch_ids)
       VALUES (?, ?, ?, ?, ?, 'Operador Sucursal A', 'Operador Sucursal A', 'recepcionista', ?, ?, TRUE, 'Activo', FALSE, ?::jsonb)`,
      [TENANT_A, BRANCH_A, BRANCH_A, opAEmail, opAEmail, OP_ROLE_ID, passHash, JSON.stringify([BRANCH_A])]
    );
    await pool.query(
      `INSERT INTO users (tenant_id, branch_id, salon_id, username, email, name, nombre, role, password_hash, is_active, estado, all_branches_access, authorized_branch_ids)
       VALUES (?, ?, ?, ?, ?, 'Owner B', 'Owner B', 'propietario', ?, TRUE, 'Activo', TRUE, ?::jsonb)`,
      [TENANT_B, BRANCH_B2, BRANCH_B2, ownerBEmail, ownerBEmail, passHash, JSON.stringify([BRANCH_B2])]
    );

    const [empARows] = await pool.query(
      "INSERT INTO staff_records (tenant_id, nombre, status, localidad) VALUES (?, 'Estilista A', 'Activo', 'Sucursal A') RETURNING id",
      [TENANT_A]
    );
    const EMP_A_ID = empARows[0].id;
    const [empBRows] = await pool.query(
      "INSERT INTO staff_records (tenant_id, nombre, status, localidad) VALUES (?, 'Estilista B', 'Activo', 'Sucursal B2') RETURNING id",
      [TENANT_B]
    );
    const EMP_B_ID = empBRows[0].id;

    await pool.query(
      "INSERT INTO clients (id, tenant_id, nombre, email, status) VALUES (?, ?, 'Clienta A', ?, 'Active'), (?, ?, 'Clienta B', ?, 'Active')",
      [CLIENT_A, TENANT_A, `cli.a.${ts}@test-fixtures.local`, CLIENT_B, TENANT_B, `cli.b.${ts}@test-fixtures.local`]
    );

    // Login Owner A, Operator A, Owner B
    const originHeader = `http://127.0.0.1:${port}`;
    const loginOwnerA = await apiRequest(port, { method: 'POST', path: '/api/auth/login', body: { username: ownerAEmail, password: 'TestPass2026!' } });
    assert.strictEqual(loginOwnerA.status, 200, 'Owner A login must succeed');
    const ownerACookie = extractAuthCookie(loginOwnerA.setCookie);
    const ownerAHeaders = { Cookie: ownerACookie, Origin: originHeader };

    const loginOpA = await apiRequest(port, { method: 'POST', path: '/api/auth/login', body: { username: opAEmail, password: 'TestPass2026!' } });
    assert.strictEqual(loginOpA.status, 200, 'Operator A login must succeed');
    const opACookie = extractAuthCookie(loginOpA.setCookie);
    const opAHeaders = { Cookie: opACookie, Origin: originHeader };

    const loginOwnerB = await apiRequest(port, { method: 'POST', path: '/api/auth/login', body: { username: ownerBEmail, password: 'TestPass2026!' } });
    assert.strictEqual(loginOwnerB.status, 200, 'Owner B login must succeed');
    const ownerBHeaders = { Cookie: extractAuthCookie(loginOwnerB.setCookie), Origin: originHeader };

    // Create Commission Category via API
    const catName = `Cat_Op_${ts}`;
    const catCreate = await apiRequest(port, {
      method: 'POST',
      path: '/api/commissions/categories',
      headers: ownerAHeaders,
      body: { nombre: catName, porcentaje: 10, tipo: 'Porcentaje', estado: 'Activa' }
    });
    assert.strictEqual(catCreate.status, 200);
    const catsList = await apiRequest(port, { method: 'GET', path: '/api/commissions/categories', headers: ownerAHeaders });
    const createdCat = (catsList.body || []).find(c => c.nombre === catName);
    recordStep('1. Preparación y Categoría', 'Categoría visible en /api/commissions/categories', `id=${createdCat?.id}, nombre=${createdCat?.nombre}`, Boolean(createdCat));

    // =========================================================================
    // 2. CATÁLOGO E INVENTARIO
    // =========================================================================
    const srvRes = await apiRequest(port, {
      method: 'POST',
      path: '/api/services',
      headers: ownerAHeaders,
      body: {
        nombre: `Corte Premium ${ts}`,
        commission_category_id: createdCat.id,
        precio: 1000,
        item_type: 'SERVICIO',
        tipo_comision: 'Porcentaje',
        comision_valor: 10,
        tax_rate: 0
      }
    });
    assert.strictEqual(srvRes.status, 201, `Service creation failed: ${JSON.stringify(srvRes.body)}`);
    const SERVICE_A = srvRes.body;

    const prodRes = await apiRequest(port, {
      method: 'POST',
      path: '/api/services',
      headers: ownerAHeaders,
      body: {
        nombre: `Shampoo Keratina ${ts}`,
        commission_category_id: createdCat.id,
        precio: 500,
        costo: 250,
        item_type: 'PRODUCTO',
        sku: `SKU-OP-${ts}`,
        tipo_comision: 'Porcentaje',
        comision_valor: 0,
        tax_rate: 0,
        track_stock: true
      }
    });
    assert.strictEqual(prodRes.status, 201, `Product creation failed: ${JSON.stringify(prodRes.body)}`);
    const PRODUCT_A = prodRes.body;

    // Product in Tenant B for cross-tenant tampering test
    const catBRes = await apiRequest(port, { method: 'POST', path: '/api/commissions/categories', headers: ownerBHeaders, body: { nombre: `Cat_B_${ts}`, porcentaje: 10 } });
    assert.strictEqual(catBRes.status, 200);
    const catsB = await apiRequest(port, { method: 'GET', path: '/api/commissions/categories', headers: ownerBHeaders });
    const prodBRes = await apiRequest(port, {
      method: 'POST',
      path: '/api/services',
      headers: ownerBHeaders,
      body: { nombre: `Producto B ${ts}`, commission_category_id: catsB.body[0].id, precio: 500, item_type: 'PRODUCTO', sku: `SKU-B-${ts}`, tax_rate: 0 }
    });
    const PRODUCT_B = prodBRes.body;

    // Verify Inventory products list contains PRODUCT_A (same ID) and NOT SERVICE_A
    const invProds = await apiRequest(port, { method: 'GET', path: '/api/inventory/products', headers: ownerAHeaders });
    const invList = Array.isArray(invProds.body) ? invProds.body : (invProds.body.products || []);
    const hasProd = invList.some(p => String(p.id) === String(PRODUCT_A.id));
    const hasSrv = invList.some(p => String(p.id) === String(SERVICE_A.id));
    recordStep('2a. Catálogo -> Inventario unificado', 'Producto en inventario con mismo ID, Servicio ausente', `hasProd=${hasProd}, hasSrv=${hasSrv}`, hasProd && !hasSrv);

    // Create separate inventory locations for Branch A and Branch B (mapped to BRANCH_A / BRANCH_B via salon_id NULL or explicit)
    const [locARows] = await pool.query(
      "INSERT INTO inventory_locations (tenant_id, salon_id, name, code, type, is_default, is_active) VALUES (?, NULL, 'Almacén Sucursal A', ?, 'STORE', TRUE, TRUE) RETURNING id",
      [TENANT_A, `LOC-A-${ts}`]
    );
    const LOC_A_ID = locARows[0].id;
    const [locBRows] = await pool.query(
      "INSERT INTO inventory_locations (tenant_id, salon_id, name, code, type, is_default, is_active) VALUES (?, NULL, 'Almacén Sucursal B', ?, 'STORE', FALSE, TRUE) RETURNING id",
      [TENANT_A, `LOC-B-${ts}`]
    );
    const LOC_B_ID = locBRows[0].id;

    // Entry of 10 units in Branch A
    const entryRes = await apiRequest(port, {
      method: 'POST',
      path: '/api/inventory/adjustments',
      headers: ownerAHeaders,
      body: {
        productId: PRODUCT_A.id,
        locationId: LOC_A_ID,
        quantity: 10,
        adjustmentType: 'ADJUSTMENT_IN',
        reason: 'Carga inicial aceptación'
      }
    });
    assert.strictEqual(entryRes.status, 200, `Stock entry failed: ${JSON.stringify(entryRes.body)}`);

    const stockA0 = await apiRequest(port, { method: 'GET', path: `/api/inventory/stock/${PRODUCT_A.id}?locationId=${LOC_A_ID}`, headers: ownerAHeaders });
    const stockB0 = await apiRequest(port, { method: 'GET', path: `/api/inventory/stock/${PRODUCT_A.id}?locationId=${LOC_B_ID}`, headers: ownerAHeaders });
    const movs0 = await apiRequest(port, { method: 'GET', path: `/api/inventory/movements?productId=${PRODUCT_A.id}`, headers: ownerAHeaders });
    const movsArr0 = Array.isArray(movs0.body) ? movs0.body : (movs0.body.movements || []);
    recordStep(
      '2b. Entrada de stock 10u Sucursal A + Kardex',
      'Balance A=10, B=0, kardex con motivo y actor',
      `stockA=${stockA0.body.quantity}, stockB=${stockB0.body.quantity}, kardex=${movsArr0.length}, reason=${movsArr0[0]?.reason}`,
      Number(stockA0.body.quantity) === 10 && Number(stockB0.body.quantity) === 0 && movsArr0.length === 1 && movsArr0[0].reason === 'Carga inicial aceptación'
    );

    // =========================================================================
    // 3. APERTURA DE CAJA
    // =========================================================================
    const openRes = await apiRequest(port, {
      method: 'POST',
      path: '/api/cash-registers/open',
      headers: opAHeaders,
      body: { salon_id: BRANCH_A, opening_balance: 2000, opened_by: 'SpoofedHacker', notes: 'Apertura turno A' }
    });
    assert.strictEqual(openRes.status, 200, `Open register failed: ${JSON.stringify(openRes.body)}`);
    const REGISTER_A_ID = openRes.body.id;
    assert.strictEqual(openRes.body.opened_by_name, 'Operador Sucursal A', 'Operator must come from session, not body');

    // Duplicate open retry must be blocked without duplicating
    const dupOpenRes = await apiRequest(port, {
      method: 'POST',
      path: '/api/cash-registers/open',
      headers: opAHeaders,
      body: { salon_id: BRANCH_A, opening_balance: 2000 }
    });
    assert.strictEqual(dupOpenRes.status, 400, 'Duplicate open must return 400');

    // Operator A cannot open or read Branch B register
    const opBranchBOpen = await apiRequest(port, {
      method: 'POST',
      path: '/api/cash-registers/open',
      headers: opAHeaders,
      body: { salon_id: BRANCH_B, opening_balance: 1000 }
    });
    const opBranchBActive = await apiRequest(port, {
      method: 'GET',
      path: `/api/cash-registers/active?salon_id=${BRANCH_B}`,
      headers: opAHeaders
    });
    const activeA0 = await apiRequest(port, {
      method: 'GET',
      path: `/api/cash-registers/active?salon_id=${BRANCH_A}`,
      headers: opAHeaders
    });
    recordStep(
      '3. Apertura de Caja RD$2,000 + Aislamiento Sucursal B',
      'Abierta RD$2,000, operador de sesión, duplicado 400, Sucursal B 403',
      `status=${activeA0.body.status}, opening=${activeA0.body.opening_balance}, expected=${activeA0.body.expected_cash}, dup=${dupOpenRes.status}, branchB=${opBranchBOpen.status}/${opBranchBActive.status}`,
      activeA0.body.status === 'Abierta' && Number(activeA0.body.opening_balance) === 2000 && Number(activeA0.body.expected_cash) === 2000 && dupOpenRes.status === 400 && opBranchBOpen.status === 403 && opBranchBActive.status === 403
    );

    // =========================================================================
    // 4. VENTA BASE + IDEMPOTENCIA
    // =========================================================================
    const VISIT_1_ID = `VIS-BASE-${ts}`;
    const sale1IdemKey = `idem-sale1-${ts}`;
    const salePayload = {
      client_id: CLIENT_A,
      client_name: 'Clienta A',
      salon_id: BRANCH_A,
      cash_register_id: REGISTER_A_ID,
      location_id: LOC_A_ID,
      subtotal: 2000,
      descuento: 0,
      total: 2000,
      metodo_pago: 'Efectivo',
      pago_efectivo: 2000,
      items_detail: [
        {
          id: SERVICE_A.id,
          nombre: SERVICE_A.nombre,
          tipo_item: 'SERVICIO',
          precio: 1000,
          precioAplicado: 1000,
          cantidad: 1,
          colaboradorId: EMP_A_ID,
          colaboradorNombre: 'Estilista A'
        },
        {
          id: PRODUCT_A.id,
          product_id: PRODUCT_A.id,
          nombre: PRODUCT_A.nombre,
          tipo_item: 'PRODUCTO',
          is_product: true,
          precio: 500,
          precioAplicado: 500,
          cantidad: 2,
          colaboradorId: EMP_A_ID,
          colaboradorNombre: 'Estilista A'
        }
      ]
    };

    const sale1 = await apiRequest(port, {
      method: 'POST',
      path: `/api/visits/${VISIT_1_ID}/checkout`,
      headers: { ...opAHeaders, 'Idempotency-Key': sale1IdemKey },
      body: salePayload
    });
    assert.strictEqual(sale1.status, 200, `Base sale failed: ${JSON.stringify(sale1.body)}`);
    assert.strictEqual(sale1.body.total_cents, 200000);

    // Repeat with same Idempotency-Key AND repeat without Idempotency-Key (double-click)
    const sale1Replay1 = await apiRequest(port, {
      method: 'POST',
      path: `/api/visits/${VISIT_1_ID}/checkout`,
      headers: { ...opAHeaders, 'Idempotency-Key': sale1IdemKey },
      body: salePayload
    });
    const sale1Replay2 = await apiRequest(port, {
      method: 'POST',
      path: `/api/visits/${VISIT_1_ID}/checkout`,
      headers: opAHeaders,
      body: salePayload
    });
    assert.strictEqual(sale1Replay1.status, 200);
    assert.strictEqual(sale1Replay2.status, 200);

    const stockA1 = await apiRequest(port, { method: 'GET', path: `/api/inventory/stock/${PRODUCT_A.id}?locationId=${LOC_A_ID}`, headers: ownerAHeaders });
    const activeA1 = await apiRequest(port, { method: 'GET', path: `/api/cash-registers/active?salon_id=${BRANCH_A}`, headers: opAHeaders });
    const [commRows1] = await pool.query('SELECT service_name, monto_comision, commission_cents, status FROM employee_commissions_log WHERE tenant_id = ? AND visit_id = ?', [TENANT_A, VISIT_1_ID]);
    const [visitCount1] = await pool.query('SELECT COUNT(*)::int AS cnt, total_cents FROM visits WHERE tenant_id = ? AND id = ? GROUP BY total_cents', [TENANT_A, VISIT_1_ID]);
    const [saleMovs1] = await pool.query("SELECT quantity FROM inventory_movements WHERE tenant_id = ? AND reference_id = ? AND movement_type = 'SALE'", [TENANT_A, VISIT_1_ID]);

    recordStep(
      '4. Venta Base RD$2,000 + Idempotencia',
      '1 venta (200000c), stock=8, salida=-2, comm=100 (prod=0), caja=4000',
      `visits=${visitCount1[0]?.cnt}, totalCents=${visitCount1[0]?.total_cents}, stock=${stockA1.body.quantity}, saleMovs=${saleMovs1.length}(${saleMovs1[0]?.quantity}), comms=${commRows1.length}(RD$${commRows1[0]?.monto_comision}/${commRows1[0]?.commission_cents}c), cash=${activeA1.body.expected_cash}`,
      Number(visitCount1[0]?.cnt) === 1 &&
      Number(visitCount1[0]?.total_cents) === 200000 &&
      Number(stockA1.body.quantity) === 8 &&
      saleMovs1.length === 1 && Number(saleMovs1[0].quantity) === -2 &&
      commRows1.length === 1 && Number(commRows1[0].monto_comision) === 100 && Number(commRows1[0].commission_cents) === 10000 &&
      Number(activeA1.body.expected_cash) === 4000
    );

    // =========================================================================
    // 5. ANULACIÓN
    // =========================================================================
    const unauthVoid = await apiRequest(port, {
      method: 'POST',
      path: `/api/visits/${VISIT_1_ID}/void`,
      headers: opAHeaders,
      body: { reason: 'Intento sin permiso' }
    });
    assert.strictEqual(unauthVoid.status, 403, 'Unauthorized operator must NOT void without PIN');

    const ownerVoid = await apiRequest(port, {
      method: 'POST',
      path: `/api/visits/${VISIT_1_ID}/void`,
      headers: ownerAHeaders,
      body: { reason: 'Error de facturación cliente' }
    });
    assert.strictEqual(ownerVoid.status, 200, `Owner void failed: ${JSON.stringify(ownerVoid.body)}`);

    // Second void rejected with 409 without extra movements
    const secondVoid = await apiRequest(port, {
      method: 'POST',
      path: `/api/visits/${VISIT_1_ID}/void`,
      headers: ownerAHeaders,
      body: { reason: 'Doble anulación' }
    });
    assert.strictEqual(secondVoid.status, 409, 'Second void must return 409 ALREADY_VOIDED');

    const stockA2 = await apiRequest(port, { method: 'GET', path: `/api/inventory/stock/${PRODUCT_A.id}?locationId=${LOC_A_ID}`, headers: ownerAHeaders });
    const activeA2 = await apiRequest(port, { method: 'GET', path: `/api/cash-registers/active?salon_id=${BRANCH_A}`, headers: opAHeaders });
    const [visitVoidRow] = await pool.query('SELECT status, void_reason, voided_by FROM visits WHERE tenant_id = ? AND id = ?', [TENANT_A, VISIT_1_ID]);
    const [commVoidRow] = await pool.query('SELECT status, monto_comision FROM employee_commissions_log WHERE tenant_id = ? AND visit_id = ?', [TENANT_A, VISIT_1_ID]);
    const [voidCashMov] = await pool.query("SELECT type, amount, amount_cents FROM cash_register_movements WHERE tenant_id = ? AND visit_id = ? AND type = 'anulacion_venta'", [TENANT_A, VISIT_1_ID]);

    recordStep(
      '5. Anulación + Reversión Integral',
      'No-auth 403, Owner 200, 2da 409, stock=10, comm=Anulada, caja=2000',
      `unauth=${unauthVoid.status}, voidStatus=${visitVoidRow[0]?.status}, voidBy=${visitVoidRow[0]?.voided_by}, stock=${stockA2.body.quantity}, comm=${commVoidRow[0]?.status}, cash=${activeA2.body.expected_cash}, auditMov=${voidCashMov.length}`,
      unauthVoid.status === 403 &&
      visitVoidRow[0]?.status === 'Anulado' &&
      Boolean(visitVoidRow[0]?.void_reason) &&
      Boolean(visitVoidRow[0]?.voided_by) &&
      Number(stockA2.body.quantity) === 10 &&
      commVoidRow[0]?.status === 'Anulada' &&
      Number(activeA2.body.expected_cash) === 2000 &&
      voidCashMov.length === 1 &&
      secondVoid.status === 409
    );

    // =========================================================================
    // 6. VENTA VÁLIDA + CIERRE RD$4,000 (DIF RD$0) + ARQUEO CON DIFERENCIA
    // =========================================================================
    const VISIT_2_ID = `VIS-VALID-${ts}`;
    const sale2 = await apiRequest(port, {
      method: 'POST',
      path: `/api/visits/${VISIT_2_ID}/checkout`,
      headers: { ...opAHeaders, 'Idempotency-Key': `idem-sale2-${ts}` },
      body: salePayload
    });
    assert.strictEqual(sale2.status, 200, `Valid sale 2 failed: ${JSON.stringify(sale2.body)}`);

    const closeRes = await apiRequest(port, {
      method: 'POST',
      path: `/api/cash-registers/${REGISTER_A_ID}/close`,
      headers: opAHeaders,
      body: { closing_balance: 4000, closed_by: 'SpoofedCloser', notes: 'Cierre cuadrado' }
    });
    assert.strictEqual(closeRes.status, 200, `Close register failed: ${JSON.stringify(closeRes.body)}`);
    assert.strictEqual(Number(closeRes.body.difference), 0);
    assert.strictEqual(Number(closeRes.body.difference_amount_cents), 0);
    assert.strictEqual(closeRes.body.closed_by, 'Operador Sucursal A');

    // Retry close -> 409 ALREADY_CLOSED
    const dupCloseRes = await apiRequest(port, {
      method: 'POST',
      path: `/api/cash-registers/${REGISTER_A_ID}/close`,
      headers: opAHeaders,
      body: { closing_balance: 4000 }
    });
    assert.strictEqual(dupCloseRes.status, 409, 'Duplicate close must return 409');

    // Block new sale on closed register -> 409 CASH_REGISTER_CLOSED
    const saleOnClosed = await apiRequest(port, {
      method: 'POST',
      path: `/api/visits/VIS-CLOSED-${ts}/checkout`,
      headers: opAHeaders,
      body: { ...salePayload, cash_register_id: REGISTER_A_ID }
    });
    assert.strictEqual(saleOnClosed.status, 409, 'Sale on closed register must be rejected with 409');

    // Separate register variance test (opening 1000, closing 800 -> diff -200)
    const openVarRes = await apiRequest(port, {
      method: 'POST',
      path: '/api/cash-registers/open',
      headers: opAHeaders,
      body: { salon_id: BRANCH_A, opening_balance: 1000, notes: 'Caja arqueo diferencia' }
    });
    assert.strictEqual(openVarRes.status, 200);
    const REG_VAR_ID = openVarRes.body.id;

    const varNoReason = await apiRequest(port, { method: 'POST', path: `/api/cash-registers/${REG_VAR_ID}/close`, headers: opAHeaders, body: { closing_balance: 800 } });
    const varNoDouble = await apiRequest(port, { method: 'POST', path: `/api/cash-registers/${REG_VAR_ID}/close`, headers: opAHeaders, body: { closing_balance: 800, discrepancy_reason: 'Faltante billete 200' } });
    const varNoPin = await apiRequest(port, { method: 'POST', path: `/api/cash-registers/${REG_VAR_ID}/close`, headers: opAHeaders, body: { closing_balance: 800, discrepancy_reason: 'Faltante billete 200', double_confirmed: true } });
    const varOk = await apiRequest(port, { method: 'POST', path: `/api/cash-registers/${REG_VAR_ID}/close`, headers: opAHeaders, body: { closing_balance: 800, discrepancy_reason: 'Faltante billete 200', double_confirmed: true, supervisor_pin: '1234' } });

    recordStep(
      '6. Venta Válida + Cierre RD$0 + Arqueo Diferencia',
      'Cierre dif=0, reintento=409, venta en cerrada=409, arqueo exige motivo+doble+PIN',
      `diff=${closeRes.body.difference}, dupClose=${dupCloseRes.status}, closedSale=${saleOnClosed.status}, varFlow=${varNoReason.status}/${varNoDouble.status}/${varNoPin.status}/${varOk.status}(sup=${varOk.body.supervisor_authorized})`,
      Number(closeRes.body.difference) === 0 && dupCloseRes.status === 409 && saleOnClosed.status === 409 &&
      varNoReason.status === 400 && varNoDouble.status === 400 && varNoPin.status === 403 && varOk.status === 200 && varOk.body.supervisor_authorized === true
    );

    // =========================================================================
    // 7. REPORTES Y AISLAMIENTO
    // =========================================================================
    const dashA = await apiRequest(port, { method: 'GET', path: '/api/dashboard/summary', headers: ownerAHeaders });
    const todayStr = new Date().toISOString().slice(0, 10);
    const biA = await apiRequest(port, { method: 'GET', path: `/api/reports/bi?reportId=sales_summary&startDate=${todayStr}&endDate=${todayStr}`, headers: ownerAHeaders });
    const dashB = await apiRequest(port, { method: 'GET', path: '/api/dashboard/summary', headers: ownerBHeaders });
    const stockAFinal = await apiRequest(port, { method: 'GET', path: `/api/inventory/stock/${PRODUCT_A.id}?locationId=${LOC_A_ID}`, headers: ownerAHeaders });
    const stockBFinal = await apiRequest(port, { method: 'GET', path: `/api/inventory/stock/${PRODUCT_A.id}?locationId=${LOC_B_ID}`, headers: ownerAHeaders });
    const [pendingCommsA] = await pool.query("SELECT COALESCE(SUM(monto_comision), 0) AS total FROM employee_commissions_log WHERE tenant_id = ? AND status = 'Pendiente'", [TENANT_A]);

    // ID tampering tests (reopen register A first so register check passes to test ID tampering)
    const openEdgeRes = await apiRequest(port, { method: 'POST', path: '/api/cash-registers/open', headers: opAHeaders, body: { salon_id: BRANCH_A, opening_balance: 500 } });
    const REG_EDGE_ID = openEdgeRes.body.id;

    const tamperClient = await apiRequest(port, { method: 'POST', path: `/api/visits/VIS-TAMP-CLI-${ts}/checkout`, headers: opAHeaders, body: { ...salePayload, client_id: CLIENT_B, cash_register_id: REG_EDGE_ID } });
    const tamperEmp = await apiRequest(port, { method: 'POST', path: `/api/visits/VIS-TAMP-EMP-${ts}/checkout`, headers: opAHeaders, body: { ...salePayload, cash_register_id: REG_EDGE_ID, items_detail: [{ ...salePayload.items_detail[0], colaboradorId: EMP_B_ID }] } });
    const tamperProd = await apiRequest(port, { method: 'POST', path: `/api/visits/VIS-TAMP-PRD-${ts}/checkout`, headers: opAHeaders, body: { ...salePayload, cash_register_id: REG_EDGE_ID, items_detail: [{ ...salePayload.items_detail[1], id: PRODUCT_B.id, product_id: PRODUCT_B.id }] } });
    const tamperBranch = await apiRequest(port, { method: 'POST', path: `/api/visits/VIS-TAMP-BR-${ts}/checkout`, headers: opAHeaders, body: { ...salePayload, salon_id: BRANCH_B, cash_register_id: REG_EDGE_ID } });

    recordStep(
      '7. Reportes + Aislamiento + Manipulación IDs',
      'Ventas netas=2000 (fondo no sumado), comm=100, stock A=8/B=0, Emp B=0, tampers bloqueados',
      `dashRev=${dashA.body.revenueToday}, biRows=${biA.body.table?.rows?.length}, commPend=${pendingCommsA[0].total}, stockA=${stockAFinal.body.quantity}, stockB=${stockBFinal.body.quantity}, empBRev=${dashB.body.revenueToday}, tampers=${tamperClient.status}/${tamperEmp.status}/${tamperProd.status}/${tamperBranch.status}`,
      Number(dashA.body.revenueToday) === 2000 &&
      Number(pendingCommsA[0].total) === 100 &&
      Number(stockAFinal.body.quantity) === 8 &&
      Number(stockBFinal.body.quantity) === 0 &&
      Number(dashB.body.revenueToday) === 0 &&
      tamperClient.status === 404 && tamperEmp.status === 404 && tamperProd.status === 404 && tamperBranch.status === 403
    );

    // =========================================================================
    // 8. CASOS DE BORDE
    // =========================================================================
    // 8a. Stock insuficiente
    const insuffRes = await apiRequest(port, {
      method: 'POST',
      path: `/api/visits/VIS-INSUFF-${ts}/checkout`,
      headers: opAHeaders,
      body: { ...salePayload, cash_register_id: REG_EDGE_ID, items_detail: [{ ...salePayload.items_detail[1], cantidad: 50 }] }
    });
    assert.strictEqual(insuffRes.status, 400);
    assert.strictEqual(insuffRes.body.code, 'INSUFFICIENT_STOCK');

    // 8b. Dos ventas concurrentes sobre la última unidad (producto dedicado con stock = 1)
    const lastUnitProdRes = await apiRequest(port, {
      method: 'POST',
      path: '/api/services',
      headers: ownerAHeaders,
      body: { nombre: `Última Unidad ${ts}`, commission_category_id: createdCat.id, precio: 300, item_type: 'PRODUCTO', sku: `SKU-LAST-${ts}`, tax_rate: 0 }
    });
    const LAST_PROD = lastUnitProdRes.body;
    await apiRequest(port, {
      method: 'POST',
      path: '/api/inventory/adjustments',
      headers: ownerAHeaders,
      body: { productId: LAST_PROD.id, locationId: LOC_A_ID, quantity: 1, adjustmentType: 'ADJUSTMENT_IN', reason: 'Última unidad test' }
    });
    const lastUnitPayload = {
      client_id: CLIENT_A, client_name: 'Clienta A', salon_id: BRANCH_A, cash_register_id: REG_EDGE_ID, location_id: LOC_A_ID,
      subtotal: 300, descuento: 0, total: 300, metodo_pago: 'Efectivo',
      items_detail: [{ id: LAST_PROD.id, product_id: LAST_PROD.id, nombre: LAST_PROD.nombre, tipo_item: 'PRODUCTO', is_product: true, precio: 300, cantidad: 1 }]
    };
    const [conc1, conc2] = await Promise.all([
      apiRequest(port, { method: 'POST', path: `/api/visits/VIS-CONC1-${ts}/checkout`, headers: opAHeaders, body: lastUnitPayload }),
      apiRequest(port, { method: 'POST', path: `/api/visits/VIS-CONC2-${ts}/checkout`, headers: opAHeaders, body: lastUnitPayload })
    ]);
    const concStatuses = [conc1.status, conc2.status].sort((a, b) => a - b);
    const lastStockAfter = await apiRequest(port, { method: 'GET', path: `/api/inventory/stock/${LAST_PROD.id}?locationId=${LOC_A_ID}`, headers: ownerAHeaders });

    // 8c. Servicio sin movimiento de stock
    const srvOnlyId = `VIS-SRVONLY-${ts}`;
    const srvOnlyRes = await apiRequest(port, {
      method: 'POST',
      path: `/api/visits/${srvOnlyId}/checkout`,
      headers: opAHeaders,
      body: { ...salePayload, cash_register_id: REG_EDGE_ID, subtotal: 1000, total: 1000, items_detail: [salePayload.items_detail[0]] }
    });
    const [srvOnlyMovs] = await pool.query('SELECT COUNT(*)::int AS cnt FROM inventory_movements WHERE tenant_id = ? AND reference_id = ?', [TENANT_A, srvOnlyId]);

    // 8d. Producto archivado
    const archProdRes = await apiRequest(port, {
      method: 'POST',
      path: '/api/services',
      headers: ownerAHeaders,
      body: { nombre: `Archivado ${ts}`, commission_category_id: createdCat.id, precio: 200, item_type: 'PRODUCTO', sku: `SKU-ARCH-${ts}`, tax_rate: 0 }
    });
    const ARCH_PROD = archProdRes.body;
    await apiRequest(port, { method: 'PATCH', path: `/api/services/${ARCH_PROD.id}/toggle-status`, headers: ownerAHeaders });
    const archSaleRes = await apiRequest(port, {
      method: 'POST',
      path: `/api/visits/VIS-ARCH-${ts}/checkout`,
      headers: opAHeaders,
      body: { ...salePayload, cash_register_id: REG_EDGE_ID, items_detail: [{ id: ARCH_PROD.id, product_id: ARCH_PROD.id, nombre: ARCH_PROD.nombre, tipo_item: 'PRODUCTO', is_product: true, precio: 200, cantidad: 1 }] }
    });

    // 8e. Venta sin caja abierta (Sucursal B no tiene caja abierta)
    const noRegSale = await apiRequest(port, {
      method: 'POST',
      path: `/api/visits/VIS-NOREG-${ts}/checkout`,
      headers: ownerAHeaders,
      body: { ...salePayload, salon_id: BRANCH_B, cash_register_id: null, require_open_register: true }
    });

    // 8f. Descuento no autorizado vs autorizado con PIN
    const discUnauth = await apiRequest(port, {
      method: 'POST',
      path: `/api/visits/VIS-DISC1-${ts}/checkout`,
      headers: opAHeaders,
      body: { ...salePayload, cash_register_id: REG_EDGE_ID, subtotal: 1000, descuento: 100, total: 900, items_detail: [salePayload.items_detail[0]] }
    });
    const discAuth = await apiRequest(port, {
      method: 'POST',
      path: `/api/visits/VIS-DISC2-${ts}/checkout`,
      headers: opAHeaders,
      body: { ...salePayload, cash_register_id: REG_EDGE_ID, subtotal: 1000, descuento: 100, total: 900, admin_pin: '1234', items_detail: [salePayload.items_detail[0]] }
    });

    // 8g. Fallo intermedio de persistencia -> rollback sin registros parciales
    const stockBeforeFail = (await apiRequest(port, { method: 'GET', path: `/api/inventory/stock/${PRODUCT_A.id}?locationId=${LOC_A_ID}`, headers: ownerAHeaders })).body.quantity;
    const failId = `VIS-FAIL-ROLLBACK-${ts}`;
    const failRes = await apiRequest(port, {
      method: 'POST',
      path: `/api/visits/${failId}/checkout`,
      headers: { ...opAHeaders, 'x-test-fail-after-stock': 'true' },
      body: { ...salePayload, cash_register_id: REG_EDGE_ID }
    });
    const stockAfterFail = (await apiRequest(port, { method: 'GET', path: `/api/inventory/stock/${PRODUCT_A.id}?locationId=${LOC_A_ID}`, headers: ownerAHeaders })).body.quantity;
    const [failVisitRows] = await pool.query('SELECT COUNT(*)::int AS cnt FROM visits WHERE tenant_id = ? AND id = ?', [TENANT_A, failId]);

    recordStep(
      '8. Casos de Borde Completos',
      'Insuff=400, conc=[200,400]+stock=0, srvOnly=0 movs, arch=400, noReg=400, disc=403/200, rollback=500+stock intacto',
      `insuff=${insuffRes.status}, conc=${JSON.stringify(concStatuses)}(stock=${lastStockAfter.body.quantity}), srvMovs=${srvOnlyMovs[0].cnt}, arch=${archSaleRes.status}(${archSaleRes.body.code}), noReg=${noRegSale.status}, disc=${discUnauth.status}/${discAuth.status}, rollback=${failRes.status}(stock ${stockBeforeFail}->${stockAfterFail}, visits=${failVisitRows[0].cnt})`,
      insuffRes.status === 400 &&
      concStatuses[0] === 200 && concStatuses[1] === 400 && Number(lastStockAfter.body.quantity) === 0 &&
      srvOnlyRes.status === 200 && Number(srvOnlyMovs[0].cnt) === 0 &&
      archSaleRes.status === 400 && archSaleRes.body.code === 'PRODUCT_ARCHIVED' &&
      noRegSale.status === 400 && noRegSale.body.code === 'CASH_REGISTER_REQUIRED' &&
      discUnauth.status === 403 && discAuth.status === 200 &&
      failRes.status === 500 && Number(stockAfterFail) === Number(stockBeforeFail) && Number(failVisitRows[0].cnt) === 0
    );

    console.log(`\n=== ACCEPTANCE SUITE COMPLETE: ${results.filter(r => r.status === 'PASS').length}/${results.length} CHECKS PASSED ===\n`);
  } finally {
    if (serverProcess) serverProcess.kill('SIGKILL');
    try {
      const tids = [TENANT_A, TENANT_B];
      for (const tbl of [
        'employee_commissions_log', 'cash_register_movements', 'cash_registers',
        'inventory_movements', 'inventory_stock', 'inventory_locations',
        'visits', 'services', 'commission_categories', 'staff_records',
        'clients', 'user_sessions', 'security_settings', 'users', 'roles',
        'salons', 'branches', 'tenant_subscriptions', 'idempotency_keys'
      ]) {
        await pool.query(`DELETE FROM ${tbl} WHERE tenant_id IN (?, ?)`, tids).catch(() => {});
      }
      await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', tids).catch(() => {});
    } catch (_) {}
    await pool.end();
  }
}

if (require.main === module) {
  runAcceptanceSuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[FATAL ACCEPTANCE ERROR]:', err);
      process.exit(1);
    });
}

module.exports = { runAcceptanceSuite };
