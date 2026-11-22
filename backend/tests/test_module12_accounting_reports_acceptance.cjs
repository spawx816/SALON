'use strict';

/**
 * Module 12 — Accounting & Fiscal Reports (Expenses, 606, 607, IT-1, NCF) Acceptance Suite (PG)
 */

const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { createExpensesRouter } = require('../routes/expenses.routes');
const { createDgii606Router } = require('../routes/dgii_606.routes');
const { createDgiiRouter } = require('../routes/dgii.routes');

async function reqJson(baseUrl, method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function runModule12AccountingAcceptance() {
  console.log('========================================================================');
  console.log('🧪 MODULE 12 — ACCOUNTING & REPORTS (EGRESOS/606/607/IT-1/NCF) SUITE');
  console.log('========================================================================\n');

  const testConfig = validateTestEnvironment({ allowDisposableSchema: true });
  const pool = createIsolatedTestPool(testConfig);

  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const branchA1 = crypto.randomUUID();
  const branchB1 = crypto.randomUUID();
  const ownerAId = crypto.randomUUID();

  let currentAuth = {
    tenantId: tenantA,
    id: ownerAId,
    userId: ownerAId,
    name: 'Owner M12',
    role: 'propietario',
    allBranchesAccess: true,
    authorizedBranchIds: [branchA1],
    branchId: branchA1,
    permissions: {
      'accounting.view': true,
      'accounting.expenses.manage': true,
      'accounting.expenses.pay': true,
      'accounting.expenses.void': true,
      'accounting.purchases_606.manage': true,
      'accounting.export': true,
    },
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenantId = currentAuth.tenantId;
    req.auth = { ...currentAuth };
    req.user = {
      id: currentAuth.id,
      name: currentAuth.name,
      role: currentAuth.role,
      tenant_id: currentAuth.tenantId,
      branch_id: currentAuth.branchId,
      permissions: currentAuth.permissions,
    };
    next();
  });
  app.use('/api/expenses', createExpensesRouter(pool));
  app.use('/api/dgii/report-606', createDgii606Router(pool));
  app.use('/api/dgii', createDgiiRouter(pool));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    await pool.query(
      `INSERT INTO tenants (id, business_name, rnc, slug, email, status)
       VALUES (?, 'Empresa M12 A', '131000123', ?, ?, 'active'),
              (?, 'Empresa M12 B', '131000456', ?, ?, 'active')`,
      [
        tenantA, `m12-a-${tenantA.slice(0, 8)}`, `m12a-${tenantA.slice(0, 8)}@test.local`,
        tenantB, `m12-b-${tenantB.slice(0, 8)}`, `m12b-${tenantB.slice(0, 8)}@test.local`,
      ]
    );
    await pool.query(
      `INSERT INTO branches (id, tenant_id, name, is_main, status)
       VALUES (?, ?, 'Sucursal M12 A1', true, 'Active'),
              (?, ?, 'Sucursal M12 B1', true, 'Active')`,
      [branchA1, tenantA, branchB1, tenantB]
    );

    // --- M12-C1: Expenses CRUD + void immutability ---
    console.log('--- M12-C1: Expenses CRUD, void immutability & summary exclusion ---');
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/expenses', { concept: 'Bad', amount: 0 })).status, 400);
    const expRes = await reqJson(baseUrl, 'POST', '/api/expenses', {
      concept: 'Energía Eléctrica M12',
      category: 'Servicios',
      amount: 4500,
      date: '2026-11-10',
      status: 'Registrado',
    });
    assert.strictEqual(expRes.status, 200);
    const expId = expRes.data.id;
    assert.ok(expId);

    // Cannot bypass void via PUT status='Anulado'
    const putVoidBypass = await reqJson(baseUrl, 'PUT', `/api/expenses/${expId}`, { status: 'Anulado' });
    assert.strictEqual(putVoidBypass.status, 400);
    assert.strictEqual(putVoidBypass.data.code, 'USE_VOID_ENDPOINT');

    // Legitimate void -> 200; 2nd void -> 409 ALREADY_VOIDED; PUT after void -> 409 EXPENSE_VOIDED
    assert.strictEqual((await reqJson(baseUrl, 'POST', `/api/expenses/${expId}/void`, { reason: 'Duplicado M12' })).status, 200);
    const void2 = await reqJson(baseUrl, 'POST', `/api/expenses/${expId}/void`, { reason: 'Otro' });
    assert.strictEqual(void2.status, 409);
    assert.strictEqual(void2.data.code, 'ALREADY_VOIDED');
    const putVoided = await reqJson(baseUrl, 'PUT', `/api/expenses/${expId}`, { amount: 100 });
    assert.strictEqual(putVoided.status, 409);
    assert.strictEqual(putVoided.data.code, 'EXPENSE_VOIDED');

    const expList = await reqJson(baseUrl, 'GET', '/api/expenses?period=2026-11');
    assert.strictEqual(expList.status, 200);
    assert.strictEqual(expList.data.summary.totalAmount, 0, 'Voided expense must be excluded from totalAmount');
    assert.strictEqual(expList.data.summary.voidedCount, 1);
    console.log('  ✅ [PASS M12-C1]');

    // --- M12-C2: DGII 606 Purchases + TXT export + guards ---
    console.log('--- M12-C2: DGII 606 CRUD, guards & official TXT export ---');
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/dgii/report-606', { rnc_cedula: '101010101' })).status, 400);
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/dgii/report-606', { rnc_cedula: '101010101', ncf: 'B0100000001', monto_bienes: -10 })).status, 400);
    assert.strictEqual((await reqJson(baseUrl, 'PUT', '/api/dgii/report-606/not-an-int', { monto_bienes: 100 })).status, 404);
    assert.strictEqual((await reqJson(baseUrl, 'DELETE', '/api/dgii/report-606/not-an-int')).status, 404);

    const p606 = await reqJson(baseUrl, 'POST', '/api/dgii/report-606', {
      periodo: '202611',
      rnc_cedula: '101-01010-1',
      proveedor: 'Suplidora Belleza RD',
      ncf: 'B0100000055',
      fecha_factura: '2026-11-12',
      monto_bienes: 10000,
      total_facturado: 10000,
      itbis_facturado: 1800,
    });
    assert.strictEqual(p606.status, 200);
    const p606Id = p606.data.id;
    assert.ok(Number(p606Id) > 0);

    const get606 = await reqJson(baseUrl, 'GET', '/api/dgii/report-606?periodo=202611');
    assert.strictEqual(get606.status, 200);
    assert.strictEqual(get606.data.records.length, 1);
    assert.strictEqual(Number(get606.data.totals.itbis_facturado), 1800);

    const txt606 = await reqJson(baseUrl, 'GET', '/api/dgii/report-606/txt?periodo=202611');
    assert.strictEqual(txt606.status, 200);
    assert.ok(String(txt606.data).startsWith('606|131000123|202611|1'), `Unexpected 606 TXT header: ${String(txt606.data).slice(0, 60)}`);
    console.log('  ✅ [PASS M12-C2]');

    // --- M12-C3: DGII 607 & IT-1 aggregation (DGII_MODE=disabled) ---
    console.log('--- M12-C3: DGII 607 & IT-1 aggregation ---');
    await pool.query(
      `INSERT INTO visits (id, tenant_id, salon_id, ticket_number, client_name, ncf, ncf_type, total, total_cents, subtotal, itbis, metodo_pago, status, visited_at)
       VALUES (?, ?, ?, 'TKT-M12-1', 'Clienta Fiscal', 'B0200000011', 'B02', 1180, 118000, 1000, 180, 'Efectivo', 'Facturado', '2026-11-12 15:00:00')`,
      [`VIS-M12-${Date.now()}`, tenantA, branchA1]
    );
    const rep607 = await reqJson(baseUrl, 'GET', '/api/dgii/report-607?periodo=202611');
    assert.strictEqual(rep607.status, 200);
    const repIt1 = await reqJson(baseUrl, 'GET', '/api/dgii/it1?periodo=202611');
    assert.strictEqual(repIt1.status, 200);
    console.log('  ✅ [PASS M12-C3]');

    // --- M12-C4: Granular accounting RBAC ---
    console.log('--- M12-C4: Granular accounting RBAC ---');
    currentAuth.role = 'contador_lectura';
    currentAuth.permissions = { 'accounting.view': true };
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/expenses?period=2026-11')).status, 200);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/dgii/report-606?periodo=202611')).status, 200);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/dgii/report-606/txt?periodo=202611')).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/expenses', { concept: 'No', amount: 100 })).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/dgii/report-606', { rnc_cedula: '101', ncf: 'B01' })).status, 403);

    // Manager without pay/void cannot mark Pagado or void
    currentAuth.permissions = { 'accounting.view': true, 'accounting.expenses.manage': true };
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/expenses', { concept: 'Pagado sin permiso', amount: 100, status: 'Pagado' })).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'POST', `/api/expenses/${expId}/void`, { reason: 'No' })).status, 403);
    console.log('  ✅ [PASS M12-C4]');

    // --- M12-C5: Multi-tenant isolation ---
    console.log('--- M12-C5: Multi-tenant isolation ---');
    currentAuth.tenantId = tenantB;
    currentAuth.role = 'propietario';
    currentAuth.branchId = branchB1;
    currentAuth.authorizedBranchIds = [branchB1];
    currentAuth.permissions = {
      'accounting.view': true,
      'accounting.expenses.manage': true,
      'accounting.expenses.pay': true,
      'accounting.expenses.void': true,
      'accounting.purchases_606.manage': true,
      'accounting.export': true,
    };

    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/expenses?period=2026-11')).data.records.length, 0);
    assert.strictEqual((await reqJson(baseUrl, 'PUT', `/api/expenses/${expId}`, { amount: 1 })).status, 404);
    assert.strictEqual((await reqJson(baseUrl, 'DELETE', `/api/expenses/${expId}`)).status, 404);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/dgii/report-606?periodo=202611')).data.records.length, 0);
    assert.strictEqual((await reqJson(baseUrl, 'PUT', `/api/dgii/report-606/${p606Id}`, { monto_bienes: 1 })).status, 404);
    assert.strictEqual((await reqJson(baseUrl, 'DELETE', `/api/dgii/report-606/${p606Id}`)).status, 404);
    console.log('  ✅ [PASS M12-C5]');

    console.log('\n========================================================================');
    console.log('🎉 MODULE 12 — ACCOUNTING & REPORTS ACCEPTANCE SUITE: ALL 5 CASES PASSED');
    console.log('========================================================================');
  } finally {
    server.close();
    for (const tbl of ['dgii_606_purchases', 'expenses', 'visits', 'branches']) {
      await pool.query(`DELETE FROM ${tbl} WHERE tenant_id IN (?, ?)`, [tenantA, tenantB]).catch(() => {});
    }
    await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.end();
  }
}

if (require.main === module) {
  runModule12AccountingAcceptance().catch((err) => {
    console.error('❌ [FAIL] Module 12 Accounting Acceptance:', err);
    process.exit(1);
  });
}

module.exports = { runModule12AccountingAcceptance };
