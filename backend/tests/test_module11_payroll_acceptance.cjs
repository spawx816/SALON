'use strict';

/**
 * Module 11 — Payroll (Nómina) Acceptance Suite (PostgreSQL)
 * Covers: generate period (salary + commissions + discounts), save-draft status-escalation block (400 INVALID_DRAFT_STATUS),
 * non-int ID guards (404), 3-level RBAC (payroll.generate / payroll.approve / payroll.pay),
 * atomic concurrent /approve (snapshot, is_immutable, settles discounts Saldado & commissions Pagada),
 * post-approval immutability (403 PAYROLL_IMMUTABLE), atomic concurrent /register-payment,
 * and multi-tenant isolation.
 */

const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { createPayrollRouter } = require('../routes/payroll.routes');

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

async function runModule11PayrollAcceptance() {
  console.log('========================================================================');
  console.log('🧪 MODULE 11 — PAYROLL (NÓMINA) ACCEPTANCE SUITE (POSTGRESQL)');
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
    name: 'Owner M11',
    role: 'propietario',
    allBranchesAccess: true,
    authorizedBranchIds: [branchA1],
    branchId: branchA1,
    permissions: {
      'payroll.view': true,
      'payroll.generate': true,
      'payroll.approve': true,
      'payroll.pay': true,
    },
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenantId = currentAuth.tenantId;
    req.verifiedTenantId = currentAuth.tenantId;
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
  app.use('/api/payroll', createPayrollRouter(pool));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    await pool.query(
      `INSERT INTO tenants (id, business_name, slug, email, status)
       VALUES (?, 'Empresa M11 A', ?, ?, 'active'),
              (?, 'Empresa M11 B', ?, ?, 'active')`,
      [
        tenantA, `m11-a-${tenantA.slice(0, 8)}`, `m11a-${tenantA.slice(0, 8)}@test.local`,
        tenantB, `m11-b-${tenantB.slice(0, 8)}`, `m11b-${tenantB.slice(0, 8)}@test.local`,
      ]
    );
    await pool.query(
      `INSERT INTO branches (id, tenant_id, name, is_main, status)
       VALUES (?, ?, 'Sucursal M11 A1', true, 'Active'),
              (?, ?, 'Sucursal M11 B1', true, 'Active')`,
      [branchA1, tenantA, branchB1, tenantB]
    );

    // Seed active employee hired before period start with fixed salary RD$ 20,000/mo (10,000/quincena)
    const [stRows] = await pool.query(
      `INSERT INTO staff_records (tenant_id, nombre, posicion, localidad, salario_base, fecha_entrada, status)
       VALUES (?, 'Estilista M11', 'Estilista', 'Sucursal M11 A1', 20000, '2025-01-01', 'Activo') RETURNING id`,
      [tenantA]
    );
    const empId = stRows[0].id;

    // Seed 1 pending commission (RD$ 500) and 1 pending discount (RD$ 200) inside 2026-11-01..2026-11-15
    const [commRow] = await pool.query(
      `INSERT INTO employee_commissions_log (tenant_id, employee_id, employee_name, service_name, monto_comision, commission_amount, status, created_at)
       VALUES (?, ?, 'Estilista M11', 'Corte M11', 500, 500, 'Pendiente', '2026-11-05 12:00:00') RETURNING id`,
      [tenantA, String(empId)]
    );
    const [discRow] = await pool.query(
      `INSERT INTO employee_discounts (tenant_id, employee_id, employee_name, type, amount, date, notes, status, created_at)
       VALUES (?, ?, 'Estilista M11', 'Consumo_Servicio', 200, '2026-11-06', 'Lavado M11', 'Pendiente', NOW()) RETURNING id`,
      [tenantA, empId]
    );

    // --- M11-C1: Generate payroll period ---
    console.log('--- M11-C1: Generate payroll period (salary + commission + discount) ---');
    const genRes = await reqJson(baseUrl, 'POST', '/api/payroll/generate', {
      period_name: '1ra Quincena Nov 2026 M11',
      start_date: '2026-11-01',
      end_date: '2026-11-15',
      sucursal: 'Sucursal M11 A1',
    });
    assert.strictEqual(genRes.status, 200, `Generate failed: ${JSON.stringify(genRes.data)}`);
    const payrollId = genRes.data.payroll_id || genRes.data.id;
    assert.ok(Number(payrollId) > 0, 'Payroll period id returned');

    const getPeriod = await reqJson(baseUrl, 'GET', `/api/payroll/periods/${payrollId}`);
    assert.strictEqual(getPeriod.status, 200);
    assert.ok(Array.isArray(getPeriod.data.items) && getPeriod.data.items.length >= 1, 'At least 1 payroll item generated');
    const item = getPeriod.data.items[0];
    assert.strictEqual(Number(item.comisiones), 500, `Expected 500 commission, got ${item.comisiones}`);
    console.log('  ✅ [PASS M11-C1]');

    // --- M11-C2: save-draft status escalation block & non-int ID guards ---
    console.log('--- M11-C2: save-draft status escalation block & non-int ID guards ---');
    const escApprove = await reqJson(baseUrl, 'POST', '/api/payroll/save-draft', {
      payroll_id: payrollId,
      items: [item],
      status: 'Aprobada',
    });
    assert.strictEqual(escApprove.status, 400);
    assert.strictEqual(escApprove.data.code, 'INVALID_DRAFT_STATUS');

    const escPaid = await reqJson(baseUrl, 'POST', '/api/payroll/save-draft', {
      payroll_id: payrollId,
      items: [item],
      status: 'Pagada',
    });
    assert.strictEqual(escPaid.status, 400);
    assert.strictEqual(escPaid.data.code, 'INVALID_DRAFT_STATUS');

    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/payroll/periods/not-an-int')).status, 404);
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/payroll/approve', { payroll_id: 'not-an-int' })).status, 404);
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/payroll/periods/not-an-int/register-payment', {})).status, 404);
    assert.strictEqual((await reqJson(baseUrl, 'DELETE', '/api/payroll/periods/not-an-int')).status, 404);

    // Valid draft edit
    const draftOk = await reqJson(baseUrl, 'POST', '/api/payroll/save-draft', {
      payroll_id: payrollId,
      items: [{ ...item, otros_ingresos: 300 }],
      status: 'En preparación',
      reason: 'Bono puntualidad M11',
    });
    assert.strictEqual(draftOk.status, 200);
    console.log('  ✅ [PASS M11-C2]');

    // --- M11-C3: 3-level RBAC separation & pay-before-approve block ---
    console.log('--- M11-C3: 3-level RBAC separation & pay-before-approve block ---');
    // Generator only cannot approve or pay
    currentAuth.role = 'asistente';
    currentAuth.permissions = { 'payroll.view': true, 'payroll.generate': true };
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/payroll/approve', { payroll_id: payrollId })).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'POST', `/api/payroll/periods/${payrollId}/register-payment`, {})).status, 403);

    // Approver only cannot pay or delete
    currentAuth.permissions = { 'payroll.view': true, 'payroll.approve': true };
    assert.strictEqual((await reqJson(baseUrl, 'POST', `/api/payroll/periods/${payrollId}/register-payment`, {})).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'DELETE', `/api/payroll/periods/${payrollId}`)).status, 403);

    // Restore owner -> pay BEFORE approve must return 409 PAYROLL_NOT_APPROVED
    currentAuth.role = 'propietario';
    currentAuth.permissions = { 'payroll.view': true, 'payroll.generate': true, 'payroll.approve': true, 'payroll.pay': true };
    const payBeforeApprove = await reqJson(baseUrl, 'POST', `/api/payroll/periods/${payrollId}/register-payment`, {});
    assert.strictEqual(payBeforeApprove.status, 409);
    assert.strictEqual(payBeforeApprove.data.code, 'PAYROLL_NOT_APPROVED');
    console.log('  ✅ [PASS M11-C3]');

    // --- M11-C4: Atomic concurrent /approve + settlement + immutability ---
    console.log('--- M11-C4: Atomic concurrent /approve, settlement & immutability ---');
    const [app1, app2] = await Promise.all([
      reqJson(baseUrl, 'POST', '/api/payroll/approve', { payroll_id: payrollId }),
      reqJson(baseUrl, 'POST', '/api/payroll/approve', { payroll_id: payrollId }),
    ]);
    const appStatuses = [app1.status, app2.status].sort();
    assert.deepStrictEqual(appStatuses, [200, 409], `Expected [200, 409], got ${JSON.stringify(appStatuses)}`);

    const [commAfter] = await pool.query('SELECT status FROM employee_commissions_log WHERE id = ? AND tenant_id = ?', [commRow[0].id, tenantA]);
    assert.strictEqual(commAfter[0].status, 'Pagada', 'Commission must be marked Pagada on payroll approval');
    const [discAfter] = await pool.query('SELECT status FROM employee_discounts WHERE id = ? AND tenant_id = ?', [discRow[0].id, tenantA]);
    assert.strictEqual(discAfter[0].status, 'Saldado', 'Discount must be marked Saldado on payroll approval');

    // Post-approval immutability
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/payroll/save-draft', { payroll_id: payrollId, items: [item] })).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'DELETE', `/api/payroll/periods/${payrollId}`)).status, 403);
    console.log('  ✅ [PASS M11-C4]');

    // --- M11-C5: Atomic concurrent /register-payment ---
    console.log('--- M11-C5: Atomic concurrent /register-payment ---');
    const [pay1, pay2] = await Promise.all([
      reqJson(baseUrl, 'POST', `/api/payroll/periods/${payrollId}/register-payment`, { payment_method: 'Transferencia', payment_reference: 'REF-M11-01' }),
      reqJson(baseUrl, 'POST', `/api/payroll/periods/${payrollId}/register-payment`, { payment_method: 'Transferencia', payment_reference: 'REF-M11-01' }),
    ]);
    const payStatuses = [pay1.status, pay2.status].sort();
    assert.deepStrictEqual(payStatuses, [200, 409], `Expected [200, 409], got ${JSON.stringify(payStatuses)}`);
    console.log('  ✅ [PASS M11-C5]');

    // --- M11-C6: Multi-tenant isolation ---
    console.log('--- M11-C6: Multi-tenant isolation ---');
    currentAuth.tenantId = tenantB;
    currentAuth.branchId = branchB1;
    currentAuth.authorizedBranchIds = [branchB1];

    const listB = await reqJson(baseUrl, 'GET', '/api/payroll/periods');
    assert.strictEqual(listB.status, 200);
    assert.strictEqual(listB.data.length, 0);
    assert.strictEqual((await reqJson(baseUrl, 'GET', `/api/payroll/periods/${payrollId}`)).status, 404);
    assert.strictEqual((await reqJson(baseUrl, 'DELETE', `/api/payroll/periods/${payrollId}`)).status, 404);
    console.log('  ✅ [PASS M11-C6]');

    console.log('\n========================================================================');
    console.log('🎉 MODULE 11 — PAYROLL (NÓMINA) ACCEPTANCE SUITE: ALL 6 CASES PASSED');
    console.log('========================================================================');
  } finally {
    server.close();
    for (const tbl of [
      'payroll_audit_logs', 'payroll_items', 'payroll_periods',
      'employee_commissions_log', 'employee_discounts', 'staff_records', 'branches'
    ]) {
      await pool.query(`DELETE FROM ${tbl} WHERE tenant_id IN (?, ?)`, [tenantA, tenantB]).catch(() => {});
    }
    await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.end();
  }
}

if (require.main === module) {
  runModule11PayrollAcceptance().catch((err) => {
    console.error('❌ [FAIL] Module 11 Payroll Acceptance:', err);
    process.exit(1);
  });
}

module.exports = { runModule11PayrollAcceptance };
