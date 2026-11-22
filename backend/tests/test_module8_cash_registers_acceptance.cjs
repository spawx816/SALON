'use strict';

/**
 * Module 8 — Cash Registers (Cajas) Acceptance Suite (PostgreSQL)
 * Covers: opening/closing DTOs, foreign-branch rejection, concurrent double-open lock,
 * multi-branch independence, manual movements (Ingreso/Gasto/Retiro) + cash/card/voided visit math,
 * concurrent double-close atomicity, post-close movement rejection (409 REGISTER_CLOSED),
 * discrepancy PIN thresholds, branch scope isolation (including /history & /movements), and multi-tenant isolation.
 */

const assert = require('assert');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const http = require('http');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { createCashRegistersRouter } = require('../routes/cash_registers.routes');

async function reqJson(baseUrl, method, path, body, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

async function runModule8CashRegistersAcceptance() {
  console.log('========================================================================');
  console.log('🧪 MODULE 8 — CASH REGISTERS (CAJAS) ACCEPTANCE SUITE (POSTGRESQL)');
  console.log('========================================================================\n');

  const testConfig = validateTestEnvironment({ allowDisposableSchema: true });
  const pool = createIsolatedTestPool(testConfig);

  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const branchA1 = crypto.randomUUID();
  const branchA2 = crypto.randomUUID();
  const branchB1 = crypto.randomUUID();
  const ownerAId = crypto.randomUUID();

  let currentAuth = {
    tenantId: tenantA,
    id: ownerAId,
    userId: ownerAId,
    name: 'Owner M8',
    role: 'propietario',
    allBranchesAccess: true,
    authorizedBranchIds: [branchA1, branchA2],
    branchId: branchA1,
    permissions: { 'pos.cash_registers.view': true, 'pos.cash_registers.manage': true },
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
  app.use('/api/cash-registers', createCashRegistersRouter(pool));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    await pool.query(
      `INSERT INTO tenants (id, business_name, slug, email, status)
       VALUES (?, 'Empresa M8 A', ?, ?, 'active'),
              (?, 'Empresa M8 B', ?, ?, 'active')`,
      [
        tenantA, `m8-a-${tenantA.slice(0, 8)}`, `m8a-${tenantA.slice(0, 8)}@test.local`,
        tenantB, `m8-b-${tenantB.slice(0, 8)}`, `m8b-${tenantB.slice(0, 8)}@test.local`,
      ]
    );
    await pool.query(
      `INSERT INTO branches (id, tenant_id, name, is_main, status)
       VALUES (?, ?, 'Sucursal M8 A1', true, 'Active'),
              (?, ?, 'Sucursal M8 A2', false, 'Active'),
              (?, ?, 'Sucursal M8 B1', true, 'Active')`,
      [branchA1, tenantA, branchA2, tenantA, branchB1, tenantB]
    );
    const passHash = bcrypt.hashSync('M8Pass2026!', 10);
    await pool.query(
      `INSERT INTO users (id, tenant_id, branch_id, name, email, password_hash, password, role, is_active)
       VALUES (?, ?, ?, 'Owner M8', ?, ?, ?, 'propietario', true)`,
      [ownerAId, tenantA, branchA1, `owner.m8.${tenantA.slice(0, 8)}@test.local`, passHash, passHash]
    );
    const pinHash = bcrypt.hashSync('739150', 10);
    await pool.query(
      `INSERT INTO security_settings (tenant_id, admin_pin_hash) VALUES (?, ?)`,
      [tenantA, pinHash]
    );

    // --- M8-C1: Validation guards & foreign branch rejection on /open ---
    console.log('--- M8-C1: Opening validation & foreign branch rejection ---');
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/cash-registers/open', { branch_id: branchA1, opening_balance: -50 })).status, 400);
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/cash-registers/open', { branch_id: branchA1, opening_balance: 100, monto_inicial: 200 })).status, 400);
    const foreignOpen = await reqJson(baseUrl, 'POST', '/api/cash-registers/open', { branch_id: branchB1, opening_balance: 1000 });
    assert.strictEqual(foreignOpen.status, 400);
    assert.strictEqual(foreignOpen.data.code, 'INVALID_BRANCH');
    console.log('  ✅ [PASS M8-C1]');

    // --- M8-C2: Concurrent double-open lock & multi-branch independence ---
    console.log('--- M8-C2: Concurrent double-open lock & multi-branch independence ---');
    const [open1, open2] = await Promise.all([
      reqJson(baseUrl, 'POST', '/api/cash-registers/open', { branch_id: branchA1, opening_balance: 2000, notes: 'Turno Mañana' }),
      reqJson(baseUrl, 'POST', '/api/cash-registers/open', { branch_id: branchA1, opening_balance: 2000, notes: 'Turno Mañana' }),
    ]);
    const statuses = [open1.status, open2.status].sort();
    assert.deepStrictEqual(statuses, [200, 400], `Expected [200, 400], got ${JSON.stringify(statuses)}`);
    const winnerOpen = open1.status === 200 ? open1 : open2;
    const loserOpen = open1.status === 400 ? open1 : open2;
    assert.strictEqual(loserOpen.data.code, 'REGISTER_ALREADY_OPEN');
    const regA1Id = winnerOpen.data.id;
    assert.strictEqual(Number(winnerOpen.data.opening_balance), 2000);

    // Branch A2 can open independently
    const openA2 = await reqJson(baseUrl, 'POST', '/api/cash-registers/open', { branch_id: branchA2, opening_balance: 1500 });
    assert.strictEqual(openA2.status, 200);
    const regA2Id = openA2.data.id;
    assert.notStrictEqual(regA1Id, regA2Id);
    console.log('  ✅ [PASS M8-C2]');

    // --- M8-C3: Manual movements + cash/card/voided visit canonical math ---
    console.log('--- M8-C3: Movements, sales & voided exclusion canonical math ---');
    // Invalid type & amount guards
    assert.strictEqual((await reqJson(baseUrl, 'POST', `/api/cash-registers/${regA1Id}/movements`, { type: 'HACK', amount: 100 })).status, 400);
    assert.strictEqual((await reqJson(baseUrl, 'POST', `/api/cash-registers/${regA1Id}/movements`, { type: 'Gasto', amount: 0 })).status, 400);
    assert.strictEqual((await reqJson(baseUrl, 'POST', `/api/cash-registers/${regA1Id}/movements`, { type: 'Gasto', amount: -20 })).status, 400);

    assert.strictEqual((await reqJson(baseUrl, 'POST', `/api/cash-registers/${regA1Id}/movements`, { type: 'Ingreso', amount: 500, concept: 'Sencillo adicional' })).status, 200);
    assert.strictEqual((await reqJson(baseUrl, 'POST', `/api/cash-registers/${regA1Id}/movements`, { type: 'Gasto', amount: 250, concept: 'Agua y café' })).status, 200);
    assert.strictEqual((await reqJson(baseUrl, 'POST', `/api/cash-registers/${regA1Id}/movements`, { type: 'Retiro', amount: 100, concept: 'Sangría parcial' })).status, 200);

    // Seed 3 visits on regA1Id: cash 1200 (Facturado), card 800 (Facturado), cash 400 (Anulado -> excluded)
    await pool.query(
      `INSERT INTO visits (id, tenant_id, salon_id, cash_register_id, ticket_number, total, total_cents, subtotal, metodo_pago, status, visited_at)
       VALUES (?, ?, ?, ?, 'TKT-M8-1', 1200, 120000, 1200, 'Efectivo', 'Facturado', NOW()),
              (?, ?, ?, ?, 'TKT-M8-2', 800, 80000, 800, 'Tarjeta', 'Facturado', NOW()),
              (?, ?, ?, ?, 'TKT-M8-3', 400, 40000, 400, 'Efectivo', 'Anulado', NOW())`,
      [
        crypto.randomUUID(), tenantA, branchA1, regA1Id,
        crypto.randomUUID(), tenantA, branchA1, regA1Id,
        crypto.randomUUID(), tenantA, branchA1, regA1Id,
      ]
    );

    const activeA1 = await reqJson(baseUrl, 'GET', `/api/cash-registers/active?salon_id=${branchA1}`);
    assert.strictEqual(activeA1.status, 200);
    // Expected cash: 2000 + 1200 + 500 - 250 - 100 = 3350
    assert.strictEqual(Number(activeA1.data.expected_cash), 3350, `Expected 3350, got ${activeA1.data.expected_cash}`);
    assert.strictEqual(Number(activeA1.data.tarjeta_total), 800);
    assert.strictEqual(Number(activeA1.data.count_invoices), 2);
    console.log('  ✅ [PASS M8-C3]');

    // --- M8-C4: Atomic concurrent double-close & post-close movement rejection ---
    console.log('--- M8-C4: Atomic double-close & post-close movement rejection ---');
    const [close1, close2] = await Promise.all([
      reqJson(baseUrl, 'POST', `/api/cash-registers/${regA1Id}/close`, { closing_balance: 3350, notes: 'Cuadre exacto' }),
      reqJson(baseUrl, 'POST', `/api/cash-registers/${regA1Id}/close`, { closing_balance: 3350, notes: 'Cuadre exacto' }),
    ]);
    const closeStatuses = [close1.status, close2.status].sort();
    assert.deepStrictEqual(closeStatuses, [200, 409], `Expected [200, 409], got ${JSON.stringify(closeStatuses)}`);
    const winClose = close1.status === 200 ? close1 : close2;
    assert.strictEqual(winClose.data.difference, 0);
    assert.strictEqual(winClose.data.expected_cash, 3350);

    // Post-close movement MUST be rejected with 409 REGISTER_CLOSED
    const movClosed = await reqJson(baseUrl, 'POST', `/api/cash-registers/${regA1Id}/movements`, { type: 'Gasto', amount: 50, concept: 'Tardío' });
    assert.strictEqual(movClosed.status, 409);
    assert.strictEqual(movClosed.data.code, 'REGISTER_CLOSED');

    const closeRep = await reqJson(baseUrl, 'GET', `/api/cash-registers/${regA1Id}/close-report`);
    assert.strictEqual(closeRep.status, 200);
    assert.strictEqual(Number(closeRep.data.report.montoEsperado), 3350);
    assert.strictEqual(closeRep.data.visits.length, 2);
    console.log('  ✅ [PASS M8-C4]');

    // --- M8-C5: Discrepancy threshold & supervisor PIN on regA2Id ---
    console.log('--- M8-C5: Discrepancy controls & supervisor PIN ---');
    // Expected on A2 = 1500; close at 1200 (-300 >= 100 threshold)
    const noPin = await reqJson(baseUrl, 'POST', `/api/cash-registers/${regA2Id}/close`, {
      closing_balance: 1200,
      discrepancy_reason: 'Faltante por cambio mal entregado',
      double_confirmed: true,
    });
    assert.strictEqual(noPin.status, 403);
    assert.strictEqual(noPin.data.code, 'SUPERVISOR_PIN_REQUIRED');

    const badPin = await reqJson(baseUrl, 'POST', `/api/cash-registers/${regA2Id}/close`, {
      closing_balance: 1200,
      discrepancy_reason: 'Faltante por cambio mal entregado',
      double_confirmed: true,
      supervisor_pin: '000000',
    });
    assert.strictEqual(badPin.status, 401);

    const goodPin = await reqJson(baseUrl, 'POST', `/api/cash-registers/${regA2Id}/close`, {
      closing_balance: 1200,
      discrepancy_reason: 'Faltante por cambio mal entregado',
      double_confirmed: true,
      supervisor_pin: '739150',
    });
    assert.strictEqual(goodPin.status, 200);
    assert.strictEqual(goodPin.data.supervisor_authorized, true);
    assert.strictEqual(goodPin.data.difference, -300);
    console.log('  ✅ [PASS M8-C5]');

    // --- M8-C6: Branch scope isolation (including /history & /movements) & cross-tenant 404 ---
    console.log('--- M8-C6: Branch scope & cross-tenant isolation ---');
    // Restrict operator to branchA1 only
    currentAuth.role = 'cajero';
    currentAuth.allBranchesAccess = false;
    currentAuth.authorizedBranchIds = [branchA1];
    currentAuth.branchId = branchA1;

    const histScoped = await reqJson(baseUrl, 'GET', '/api/cash-registers/history');
    assert.strictEqual(histScoped.status, 200);
    assert.ok(histScoped.data.every((r) => String(r.branch_id) === branchA1), 'History must only include authorized branchA1');
    assert.strictEqual((await reqJson(baseUrl, 'GET', `/api/cash-registers/history?salon_id=${branchA2}`)).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'GET', `/api/cash-registers/${regA2Id}/close-report`)).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'POST', `/api/cash-registers/${regA2Id}/movements`, { type: 'Gasto', amount: 10 })).status, 403);

    // Cross-tenant isolation (Tenant B)
    currentAuth.tenantId = tenantB;
    currentAuth.role = 'propietario';
    currentAuth.allBranchesAccess = true;
    currentAuth.authorizedBranchIds = [branchB1];
    currentAuth.branchId = branchB1;

    assert.strictEqual((await reqJson(baseUrl, 'GET', `/api/cash-registers/${regA1Id}/close-report`)).status, 404);
    assert.strictEqual((await reqJson(baseUrl, 'POST', `/api/cash-registers/${regA1Id}/movements`, { type: 'Gasto', amount: 10 })).status, 404);
    const listB = await reqJson(baseUrl, 'GET', '/api/cash-registers');
    assert.strictEqual(listB.status, 200);
    assert.strictEqual(listB.data.length, 0);
    console.log('  ✅ [PASS M8-C6]');

    console.log('\n========================================================================');
    console.log('🎉 MODULE 8 — CASH REGISTERS (CAJAS) ACCEPTANCE SUITE: ALL 6 CASES PASSED');
    console.log('========================================================================');
  } finally {
    server.close();
    await pool.query('DELETE FROM visits WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM cash_register_movements WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM cash_registers WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM security_settings WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM users WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM branches WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.end();
  }
}

if (require.main === module) {
  runModule8CashRegistersAcceptance().catch((err) => {
    console.error('❌ [FAIL] Module 8 Cash Registers Acceptance:', err);
    process.exit(1);
  });
}

module.exports = { runModule8CashRegistersAcceptance };
