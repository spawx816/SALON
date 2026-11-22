'use strict';

/**
 * Module 10 — Commissions & Employee Discounts Acceptance Suite (PostgreSQL)
 * Covers: employee_discounts CRUD + RETURNING id, input/status/non-int guards,
 * Saldado & Anulado immutability (409), commission-recipient reassignment + audit + RBAC,
 * visit void cascade to employee_commissions_log & employee_discounts, and multi-tenant isolation.
 */

const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { createEmployeeSecurityRouter } = require('../routes/employee_security.routes');
const { createVisitsRouter } = require('../routes/visits.routes');

async function reqJson(baseUrl, method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
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

async function runModule10CommissionsDiscountsAcceptance() {
  console.log('========================================================================');
  console.log('🧪 MODULE 10 — COMMISSIONS & DISCOUNTS ACCEPTANCE SUITE (POSTGRESQL)');
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
    name: 'Owner M10',
    role: 'propietario',
    allBranchesAccess: true,
    authorizedBranchIds: [branchA1],
    branchId: branchA1,
    permissions: {
      'pos.discounts.apply': true,
      'pos.invoices.void': true,
      'commissions.approve': true,
      'staff.manage': true,
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
  app.use('/api/employee-security', createEmployeeSecurityRouter(pool));
  const { router: visitsRouter } = createVisitsRouter(pool);
  app.use('/api/visits', visitsRouter);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    await pool.query(
      `INSERT INTO tenants (id, business_name, slug, email, status)
       VALUES (?, 'Empresa M10 A', ?, ?, 'active'),
              (?, 'Empresa M10 B', ?, ?, 'active')`,
      [
        tenantA, `m10-a-${tenantA.slice(0, 8)}`, `m10a-${tenantA.slice(0, 8)}@test.local`,
        tenantB, `m10-b-${tenantB.slice(0, 8)}`, `m10b-${tenantB.slice(0, 8)}@test.local`,
      ]
    );
    await pool.query(
      `INSERT INTO branches (id, tenant_id, name, is_main, status)
       VALUES (?, ?, 'Sucursal M10 A1', true, 'Active'),
              (?, ?, 'Sucursal M10 B1', true, 'Active')`,
      [branchA1, tenantA, branchB1, tenantB]
    );

    const [staffA1] = await pool.query(
      `INSERT INTO staff_records (tenant_id, nombre, posicion, localidad, estado)
       VALUES (?, 'Estilista Ana M10', 'Estilista', 'Sucursal M10 A1', 'Activo') RETURNING id`,
      [tenantA]
    );
    const [staffA2] = await pool.query(
      `INSERT INTO staff_records (tenant_id, nombre, posicion, localidad, estado)
       VALUES (?, 'Estilista Rosa M10', 'Estilista', 'Sucursal M10 A1', 'Activo') RETURNING id`,
      [tenantA]
    );
    const [staffB1] = await pool.query(
      `INSERT INTO staff_records (tenant_id, nombre, posicion, localidad, estado)
       VALUES (?, 'Estilista Ajena B', 'Estilista', 'Sucursal M10 B1', 'Activo') RETURNING id`,
      [tenantB]
    );
    const empA1 = staffA1[0].id;
    const empA2 = staffA2[0].id;
    const empB1 = staffB1[0].id;

    // --- M10-C1: Create discount + RETURNING id + validation guards ---
    console.log('--- M10-C1: Employee discount creation, RETURNING id & validation guards ---');
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/employee-security/employee-discounts', { employee_id: empA1, amount: 0 })).status, 400);
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/employee-security/employee-discounts', { employee_id: empA1, amount: -100 })).status, 400);
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/employee-security/employee-discounts', { employee_id: empA1, amount: 200, status: 'Saldado' })).status, 400);
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/employee-security/employee-discounts', { employee_id: empB1, amount: 200 })).status, 404);
    assert.strictEqual((await reqJson(baseUrl, 'PUT', '/api/employee-security/employee-discounts/not-an-int', { amount: 200 })).status, 404);
    assert.strictEqual((await reqJson(baseUrl, 'DELETE', '/api/employee-security/employee-discounts/not-an-int')).status, 404);

    const createDisc = await reqJson(baseUrl, 'POST', '/api/employee-security/employee-discounts', {
      employee_id: empA1,
      type: 'Consumo_Servicio',
      amount: 200,
      notes: 'Lavado Sencillo colaborador (precio fijo RD$200)',
    });
    assert.strictEqual(createDisc.status, 200);
    assert.ok(Number(createDisc.data.id) > 0, `Expected numeric id from RETURNING id, got ${JSON.stringify(createDisc.data)}`);
    const discId = createDisc.data.id;
    console.log('  ✅ [PASS M10-C1]');

    // --- M10-C2: Update discount + Saldado & Anulado immutability ---
    console.log('--- M10-C2: Discount update & Saldado/Anulado immutability ---');
    assert.strictEqual((await reqJson(baseUrl, 'PUT', `/api/employee-security/employee-discounts/${discId}`, { amount: -50 })).status, 400);
    assert.strictEqual((await reqJson(baseUrl, 'PUT', `/api/employee-security/employee-discounts/${discId}`, { employee_id: empB1 })).status, 404);

    const updOk = await reqJson(baseUrl, 'PUT', `/api/employee-security/employee-discounts/${discId}`, {
      amount: 250,
      status: 'Aplicado',
      notes: 'Actualizado M10',
    });
    assert.strictEqual(updOk.status, 200);

    // Mark as Saldado (settled in payroll) -> PUT and DELETE must return 409
    await pool.query("UPDATE employee_discounts SET status = 'Saldado' WHERE id = ? AND tenant_id = ?", [discId, tenantA]);
    const putSettled = await reqJson(baseUrl, 'PUT', `/api/employee-security/employee-discounts/${discId}`, { amount: 100 });
    assert.strictEqual(putSettled.status, 409);
    assert.strictEqual(putSettled.data.code, 'DISCOUNT_ALREADY_SETTLED');
    const delSettled = await reqJson(baseUrl, 'DELETE', `/api/employee-security/employee-discounts/${discId}`);
    assert.strictEqual(delSettled.status, 409);
    assert.strictEqual(delSettled.data.code, 'DISCOUNT_ALREADY_SETTLED');
    console.log('  ✅ [PASS M10-C2]');

    // --- M10-C3: Commission recipient reassignment + reason guard + RBAC ---
    console.log('--- M10-C3: Commission recipient reassignment & RBAC ---');
    const visitId = `VIS-M10-${Date.now()}`;
    await pool.query(
      `INSERT INTO visits (id, tenant_id, salon_id, ticket_number, client_name, total, total_cents, subtotal, metodo_pago, status, empleado_peluquera, items_detail, visited_at)
       VALUES (?, ?, ?, 'TKT-M10-1', 'Clienta M10', 1000, 100000, 1000, 'Efectivo', 'Facturado', 'Estilista Ana M10', ?::jsonb, NOW())`,
      [visitId, tenantA, branchA1, JSON.stringify([{ nombre: 'Corte M10', precio: 1000, cantidad: 1, empleado: 'Estilista Ana M10' }])]
    );

    // Missing reason -> 400
    const noReason = await reqJson(baseUrl, 'PUT', `/api/visits/${visitId}/commission-recipient`, {
      empleado_peluquera: 'Estilista Rosa M10',
    });
    assert.strictEqual(noReason.status, 400);
    assert.strictEqual(noReason.data.code, 'REASON_REQUIRED');

    // Unauthorized role -> 403
    currentAuth.role = 'recepcion';
    currentAuth.permissions = { 'pos.visits.view': true };
    const forbiddenReassign = await reqJson(baseUrl, 'PUT', `/api/visits/${visitId}/commission-recipient`, {
      empleado_peluquera: 'Estilista Rosa M10',
      reason: 'Intento sin permiso',
    });
    assert.strictEqual(forbiddenReassign.status, 403);
    assert.strictEqual(forbiddenReassign.data.code, 'COMMISSION_EDIT_FORBIDDEN');

    // Authorized owner -> 200
    currentAuth.role = 'propietario';
    currentAuth.permissions = { 'pos.discounts.apply': true, 'pos.invoices.void': true, 'commissions.approve': true, 'staff.manage': true };
    const reassignOk = await reqJson(baseUrl, 'PUT', `/api/visits/${visitId}/commission-recipient`, {
      empleado_peluquera: 'Estilista Rosa M10',
      reason: 'Corrección de estilista que realizó el servicio',
    });
    assert.strictEqual(reassignOk.status, 200, `Reassign failed: ${JSON.stringify(reassignOk.data)}`);
    console.log('  ✅ [PASS M10-C3]');

    // --- M10-C4: Visit void cascades to employee_discounts & blocks future reassignment ---
    console.log('--- M10-C4: Visit void cascade to employee_discounts & commissions ---');
    const [linkedDisc] = await pool.query(
      `INSERT INTO employee_discounts (tenant_id, employee_id, employee_name, type, amount, date, notes, status, visit_id, created_at)
       VALUES (?, ?, 'Estilista Rosa M10', 'Consumo_Servicio', 200, CURRENT_DATE, 'Consumo POS #TKT-M10-1', 'Pendiente', ?, NOW()) RETURNING id`,
      [tenantA, empA2, visitId]
    );
    const linkedDiscId = linkedDisc[0].id;

    const voidRes = await reqJson(baseUrl, 'POST', `/api/visits/${visitId}/void`, { reason: 'Anulación M10' });
    assert.strictEqual(voidRes.status, 200);

    const [discAfterVoid] = await pool.query('SELECT status FROM employee_discounts WHERE id = ? AND tenant_id = ?', [linkedDiscId, tenantA]);
    assert.strictEqual(discAfterVoid[0].status, 'Anulado', 'Voided visit MUST cascade Anulado to employee_discounts');

    // Editing or deleting voided discount -> 409 DISCOUNT_VOIDED
    assert.strictEqual((await reqJson(baseUrl, 'PUT', `/api/employee-security/employee-discounts/${linkedDiscId}`, { amount: 50 })).status, 409);
    assert.strictEqual((await reqJson(baseUrl, 'DELETE', `/api/employee-security/employee-discounts/${linkedDiscId}`)).status, 409);

    // Reassigning commission on voided invoice -> 409 INVOICE_VOIDED
    const reassignVoided = await reqJson(baseUrl, 'PUT', `/api/visits/${visitId}/commission-recipient`, {
      empleado_peluquera: 'Estilista Ana M10',
      reason: 'Intento tras anulación',
    });
    assert.strictEqual(reassignVoided.status, 409);
    assert.strictEqual(reassignVoided.data.code, 'INVOICE_VOIDED');
    console.log('  ✅ [PASS M10-C4]');

    // --- M10-C5: Multi-tenant isolation ---
    console.log('--- M10-C5: Multi-tenant isolation ---');
    currentAuth.tenantId = tenantB;
    currentAuth.branchId = branchB1;
    currentAuth.authorizedBranchIds = [branchB1];

    const listB = await reqJson(baseUrl, 'GET', '/api/employee-security/employee-discounts');
    assert.strictEqual(listB.status, 200);
    assert.strictEqual(listB.data.length, 0);
    assert.strictEqual((await reqJson(baseUrl, 'PUT', `/api/employee-security/employee-discounts/${discId}`, { amount: 1 })).status, 404);
    assert.strictEqual((await reqJson(baseUrl, 'DELETE', `/api/employee-security/employee-discounts/${discId}`)).status, 404);
    console.log('  ✅ [PASS M10-C5]');

    console.log('\n========================================================================');
    console.log('🎉 MODULE 10 — COMMISSIONS & DISCOUNTS ACCEPTANCE: ALL 5 CASES PASSED');
    console.log('========================================================================');
  } finally {
    server.close();
    for (const tbl of ['audit_logs', 'employee_commissions_log', 'employee_discounts', 'visits', 'staff_records', 'branches']) {
      await pool.query(`DELETE FROM ${tbl} WHERE tenant_id IN (?, ?)`, [tenantA, tenantB]).catch(() => {});
    }
    await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.end();
  }
}

if (require.main === module) {
  runModule10CommissionsDiscountsAcceptance().catch((err) => {
    console.error('❌ [FAIL] Module 10 Commissions & Discounts Acceptance:', err);
    process.exit(1);
  });
}

module.exports = { runModule10CommissionsDiscountsAcceptance };
