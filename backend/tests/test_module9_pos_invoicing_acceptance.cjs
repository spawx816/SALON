'use strict';

/**
 * Module 9 — POS, Tickets & Conventional Invoicing Acceptance Suite (PostgreSQL)
 * Covers: pending ticket -> draft -> precuenta (0 NCF, 0 stock, 0 cash) ->
 * conventional B02 checkout (DGII_MODE=disabled, service=0 stock, product=-qty, net cash with change, idempotent double-click) ->
 * post-invoice immutability (409 on precuenta/draft/delete/cancel) ->
 * atomic concurrent void (1x stock reversal, commissions Anulada, cash reversal, 409 on 2nd void & delete) ->
 * checkout without NCF (SIN_COMPROBANTE) -> branch & multi-tenant isolation.
 */

const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { createVisitsRouter } = require('../routes/visits.routes');
const { createCashRegistersRouter } = require('../routes/cash_registers.routes');
const { InventoryService } = require('../services/inventory.service');
const { InventoryRepository } = require('../repositories/inventory.repository');

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

async function runModule9PosInvoicingAcceptance() {
  console.log('========================================================================');
  console.log('🧪 MODULE 9 — POS, TICKETS & CONVENTIONAL INVOICING ACCEPTANCE (PG)');
  console.log('========================================================================\n');

  const testConfig = validateTestEnvironment({ allowDisposableSchema: true });
  const pool = createIsolatedTestPool(testConfig);
  const inventoryRepo = new InventoryRepository(pool);
  const inventoryService = new InventoryService(inventoryRepo);

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
    name: 'Owner M9',
    role: 'propietario',
    allBranchesAccess: true,
    authorizedBranchIds: [branchA1, branchA2],
    branchId: branchA1,
    permissions: {
      'pos.visits.view': true,
      'pos.visits.create': true,
      'pos.invoices.void': true,
      'pos.cash_registers.view': true,
      'pos.cash_registers.manage': true,
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
  const { router: visitsRouter } = createVisitsRouter(pool, { inventoryService });
  app.use('/api/visits', visitsRouter);
  app.use('/api/cash-registers', createCashRegistersRouter(pool));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // Seed 2 tenants, 3 branches, 1 open cash register, 1 B02 sequence, 1 service, 1 physical product with stock 10
    await pool.query(
      `INSERT INTO tenants (id, business_name, slug, email, status)
       VALUES (?, 'Empresa M9 A', ?, ?, 'active'),
              (?, 'Empresa M9 B', ?, ?, 'active')`,
      [
        tenantA, `m9-a-${tenantA.slice(0, 8)}`, `m9a-${tenantA.slice(0, 8)}@test.local`,
        tenantB, `m9-b-${tenantB.slice(0, 8)}`, `m9b-${tenantB.slice(0, 8)}@test.local`,
      ]
    );
    await pool.query(
      `INSERT INTO branches (id, tenant_id, name, is_main, status)
       VALUES (?, ?, 'Sucursal M9 A1', true, 'Active'),
              (?, ?, 'Sucursal M9 A2', false, 'Active'),
              (?, ?, 'Sucursal M9 B1', true, 'Active')`,
      [branchA1, tenantA, branchA2, tenantA, branchB1, tenantB]
    );

    const openReg = await reqJson(baseUrl, 'POST', '/api/cash-registers/open', { branch_id: branchA1, opening_balance: 1000 });
    assert.strictEqual(openReg.status, 200);
    const regA1Id = openReg.data.id;

    // Seed B02 NCF sequence
    await pool.query(
      `INSERT INTO dgii_ncf_sequences (tenant_id, tipo_comprobante, nombre_comprobante, serie, secuencia_desde, secuencia_actual, secuencia_hasta, fecha_vencimiento, estado)
       VALUES (?, 'B02', 'Factura de Consumo', 'B', 1, 1, 100, '2028-12-31', 'Activo')`,
      [tenantA]
    );

    // Seed 1 Service (RD$ 600, exento) and 1 Product (RD$ 300, exento, stock = 10)
    const serviceId = crypto.randomUUID();
    const productId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO services (id, tenant_id, name, nombre, price, precio, item_type, tax_mode, tax_rate, activo)
       VALUES (?, ?, 'Lavado M9', 'Lavado M9', 600, 600, 'SERVICIO', 'EXENTO', 0, 1),
              (?, ?, 'Shampoo M9', 'Shampoo M9', 300, 300, 'PRODUCTO', 'EXENTO', 0, 1)`,
      [serviceId, tenantA, productId, tenantA]
    );

    const locA1 = await inventoryService.getDefaultLocation(tenantA, branchA1);
    await pool.query(
      `INSERT INTO inventory_stock (tenant_id, product_id, location_id, quantity)
       VALUES (?, ?, ?, 10)
       ON CONFLICT (tenant_id, product_id, location_id) DO UPDATE SET quantity = 10`,
      [tenantA, productId, locA1.id]
    );

    // --- M9-C1: Pending ticket -> draft -> Precuenta (0 NCF, 0 stock, 0 cash) ---
    console.log('--- M9-C1: Pending ticket -> draft -> precuenta (0 NCF, 0 stock, 0 cash) ---');
    const tktRes = await reqJson(baseUrl, 'POST', '/api/visits/ticket', {
      client_name: 'Clienta M9',
      salon_id: branchA1,
      servicios: ['Lavado M9'],
      total: 600,
    });
    assert.strictEqual(tktRes.status, 201, `Ticket create failed: ${JSON.stringify(tktRes.data)}`);
    const visitId = tktRes.data.id;

    const draftRes = await reqJson(baseUrl, 'PUT', `/api/visits/${visitId}/draft`, {
      items_detail: [
        { service_id: serviceId, nombre: 'Lavado M9', tipo_item: 'SERVICIO', precio: 600, cantidad: 1 },
        { product_id: productId, nombre: 'Shampoo M9', tipo_item: 'PRODUCTO', is_product: true, precio: 300, cantidad: 2 },
      ],
      total: 1200,
    });
    assert.strictEqual(draftRes.status, 200);

    const precRes = await reqJson(baseUrl, 'POST', '/api/visits/precuenta', {
      id: visitId,
      servicios: ['Lavado M9', 'Shampoo M9'],
      total: 1200,
    });
    assert.strictEqual(precRes.status, 200);

    // Verify 0 NCF consumed, 0 stock deducted, 0 cash added
    const [seqBefore] = await pool.query("SELECT secuencia_actual FROM dgii_ncf_sequences WHERE tenant_id = ? AND tipo_comprobante = 'B02'", [tenantA]);
    assert.strictEqual(Number(seqBefore[0].secuencia_actual), 1, 'Precuenta MUST NOT consume NCF');
    const [stockBefore] = await pool.query('SELECT quantity FROM inventory_stock WHERE tenant_id = ? AND product_id = ? AND location_id = ?', [tenantA, productId, locA1.id]);
    assert.strictEqual(Number(stockBefore[0].quantity), 10, 'Precuenta MUST NOT deduct stock');
    const regBefore = await reqJson(baseUrl, 'GET', `/api/cash-registers/active?salon_id=${branchA1}`);
    assert.strictEqual(Number(regBefore.data.expected_cash), 1000, 'Precuenta MUST NOT add to cash register');
    console.log('  ✅ [PASS M9-C1]');

    // --- M9-C2: Conventional B02 Checkout (DGII_MODE=disabled) + net cash + idempotent double-click ---
    console.log('--- M9-C2: Conventional B02 checkout + stock + net cash + idempotent double-click ---');
    const checkoutPayload = {
      salon_id: branchA1,
      cash_register_id: regA1Id,
      client_name: 'Clienta M9',
      ncf_type: 'B02',
      metodo_pago: 'Efectivo',
      applied_payments: [{ method: 'Efectivo', amount: 1500 }], // Tendered 1500 on 1200 -> net 1200, change 300
      items_detail: [
        { service_id: serviceId, nombre: 'Lavado M9', tipo_item: 'SERVICIO', precio: 600, cantidad: 1, tax_mode: 'EXENTO', tax_rate: 0 },
        { product_id: productId, nombre: 'Shampoo M9', tipo_item: 'PRODUCTO', is_product: true, precio: 300, cantidad: 2, tax_mode: 'EXENTO', tax_rate: 0 },
      ],
      total: 1200,
      subtotal: 1200,
    };

    const chk1 = await reqJson(baseUrl, 'POST', `/api/visits/${visitId}/checkout`, checkoutPayload);
    assert.strictEqual(chk1.status, 200, `Checkout failed: ${JSON.stringify(chk1.data)}`);
    assert.strictEqual(chk1.data.ncf, 'B0200000001', `Expected B0200000001, got ${chk1.data.ncf}`);

    // Idempotent second checkout click must NOT consume B0200000002 or deduct stock again
    const chk2 = await reqJson(baseUrl, 'POST', `/api/visits/${visitId}/checkout`, checkoutPayload);
    assert.strictEqual(chk2.status, 200);

    const [seqAfter] = await pool.query("SELECT secuencia_actual FROM dgii_ncf_sequences WHERE tenant_id = ? AND tipo_comprobante = 'B02'", [tenantA]);
    assert.strictEqual(Number(seqAfter[0].secuencia_actual), 2, 'NCF sequence must advance strictly once (1 -> 2)');

    const [stockAfter] = await pool.query('SELECT quantity FROM inventory_stock WHERE tenant_id = ? AND product_id = ? AND location_id = ?', [tenantA, productId, locA1.id]);
    assert.strictEqual(Number(stockAfter[0].quantity), 8, `Expected stock 8 (10 - 2), got ${stockAfter[0].quantity}`);

    const [svcMovs] = await pool.query('SELECT id FROM inventory_movements WHERE tenant_id = ? AND product_id = ?', [tenantA, serviceId]);
    assert.strictEqual(svcMovs.length, 0, 'Service MUST NOT create inventory movements');

    const regAfter = await reqJson(baseUrl, 'GET', `/api/cash-registers/active?salon_id=${branchA1}`);
    assert.strictEqual(Number(regAfter.data.expected_cash), 2200, `Expected net cash 2200 (1000 + 1200), got ${regAfter.data.expected_cash}`);
    console.log('  ✅ [PASS M9-C2]');

    // --- M9-C3: Post-invoice immutability & UUID guards ---
    console.log('--- M9-C3: Post-invoice immutability & UUID guards ---');
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/visits/precuenta', { id: visitId, total: 1 })).status, 409);
    assert.strictEqual((await reqJson(baseUrl, 'PUT', `/api/visits/${visitId}/draft`, { total: 1 })).status, 409);
    assert.strictEqual((await reqJson(baseUrl, 'POST', `/api/visits/${visitId}/cancel`, { reason: 'Try' })).status, 409);
    const delInvoiced = await reqJson(baseUrl, 'DELETE', `/api/visits/${visitId}`);
    assert.strictEqual(delInvoiced.status, 409);
    assert.strictEqual(delInvoiced.data.code, 'INVOICE_CANNOT_BE_DELETED');

    assert.strictEqual((await reqJson(baseUrl, 'PUT', '/api/visits/bad-uuid/draft', { total: 1 })).status, 404);
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/visits/bad-uuid/void', { reason: 'x' })).status, 404);
    assert.strictEqual((await reqJson(baseUrl, 'DELETE', '/api/visits/bad-uuid')).status, 404);
    console.log('  ✅ [PASS M9-C3]');

    // --- M9-C4: Atomic concurrent void (1x stock reversal, cash excluded, still non-deletable) ---
    console.log('--- M9-C4: Atomic concurrent void & exact 1x stock reversal ---');
    const [void1, void2] = await Promise.all([
      reqJson(baseUrl, 'POST', `/api/visits/${visitId}/void`, { reason: 'Error de facturación M9' }),
      reqJson(baseUrl, 'POST', `/api/visits/${visitId}/void`, { reason: 'Error de facturación M9' }),
    ]);
    const voidStatuses = [void1.status, void2.status].sort();
    assert.deepStrictEqual(voidStatuses, [200, 409], `Expected [200, 409], got ${JSON.stringify(voidStatuses)}`);

    const [stockRestored] = await pool.query('SELECT quantity FROM inventory_stock WHERE tenant_id = ? AND product_id = ? AND location_id = ?', [tenantA, productId, locA1.id]);
    assert.strictEqual(Number(stockRestored[0].quantity), 10, `Stock must be restored ONCE to 10, got ${stockRestored[0].quantity}`);

    const regAfterVoid = await reqJson(baseUrl, 'GET', `/api/cash-registers/active?salon_id=${branchA1}`);
    assert.strictEqual(Number(regAfterVoid.data.expected_cash), 1000, 'Voided visit must be excluded from expected_cash');

    // Voided invoice STILL cannot be hard-deleted
    assert.strictEqual((await reqJson(baseUrl, 'DELETE', `/api/visits/${visitId}`)).status, 409);
    console.log('  ✅ [PASS M9-C4]');

    // --- M9-C5: Pending ticket void rejected (409 NOT_INVOICED), pending delete allowed, SIN_COMPROBANTE checkout ---
    console.log('--- M9-C5: Pending ticket guards & SIN_COMPROBANTE checkout ---');
    const pend1 = await reqJson(baseUrl, 'POST', '/api/visits/ticket', { client_name: 'Pendiente 1', salon_id: branchA1, servicios: ['Lavado M9'], total: 600 });
    assert.strictEqual(pend1.status, 201);
    const voidPend = await reqJson(baseUrl, 'POST', `/api/visits/${pend1.data.id}/void`, { reason: 'No facturado' });
    assert.strictEqual(voidPend.status, 409);
    assert.strictEqual(voidPend.data.code, 'NOT_INVOICED');
    assert.strictEqual((await reqJson(baseUrl, 'DELETE', `/api/visits/${pend1.data.id}`)).status, 200);

    // E31 electronic e-CF must be blocked with 409 NCF_ECF_INTEGRATION_REQUIRED when DGII_MODE=disabled
    const pend2 = await reqJson(baseUrl, 'POST', '/api/visits/ticket', { client_name: 'Sin NCF', salon_id: branchA1, servicios: ['Lavado M9'], total: 600 });
    const chkE31 = await reqJson(baseUrl, 'POST', `/api/visits/${pend2.data.id}/checkout`, {
      salon_id: branchA1,
      cash_register_id: regA1Id,
      client_name: 'Sin NCF',
      ncf_type: 'E31',
      metodo_pago: 'Efectivo',
      applied_payments: [{ method: 'Efectivo', amount: 600 }],
      items_detail: [{ service_id: serviceId, nombre: 'Lavado M9', tipo_item: 'SERVICIO', precio: 600, cantidad: 1, tax_mode: 'EXENTO', tax_rate: 0 }],
      total: 600,
      subtotal: 600,
    });
    assert.strictEqual(chkE31.status, 409);
    assert.strictEqual(chkE31.data.code, 'NCF_ECF_INTEGRATION_REQUIRED');

    // NONE checkout without consuming B02
    const chkNoNcf = await reqJson(baseUrl, 'POST', `/api/visits/${pend2.data.id}/checkout`, {
      salon_id: branchA1,
      cash_register_id: regA1Id,
      client_name: 'Sin NCF',
      ncf_type: 'NONE',
      metodo_pago: 'Efectivo',
      applied_payments: [{ method: 'Efectivo', amount: 600 }],
      items_detail: [{ service_id: serviceId, nombre: 'Lavado M9', tipo_item: 'SERVICIO', precio: 600, cantidad: 1, tax_mode: 'EXENTO', tax_rate: 0 }],
      total: 600,
      subtotal: 600,
    });
    assert.strictEqual(chkNoNcf.status, 200);
    const [seqStill2] = await pool.query("SELECT secuencia_actual FROM dgii_ncf_sequences WHERE tenant_id = ? AND tipo_comprobante = 'B02'", [tenantA]);
    assert.strictEqual(Number(seqStill2[0].secuencia_actual), 2, 'NONE checkout must not consume B02');
    console.log('  ✅ [PASS M9-C5]');

    // --- M9-C6: Branch scope & multi-tenant isolation ---
    console.log('--- M9-C6: Branch scope & multi-tenant isolation ---');
    const tktA2 = await reqJson(baseUrl, 'POST', '/api/visits/ticket', { client_name: 'Clienta A2', salon_id: branchA2, servicios: ['Lavado M9'], total: 600 });
    assert.strictEqual(tktA2.status, 201);

    // Restrict operator to branchA1
    currentAuth.role = 'cajero';
    currentAuth.allBranchesAccess = false;
    currentAuth.authorizedBranchIds = [branchA1];
    currentAuth.branchId = branchA1;

    assert.strictEqual((await reqJson(baseUrl, 'PUT', `/api/visits/${tktA2.data.id}/draft`, { total: 500 })).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/visits/precuenta', { id: tktA2.data.id, total: 500 })).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'POST', `/api/visits/${tktA2.data.id}/cancel`, { reason: 'x' })).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'DELETE', `/api/visits/${tktA2.data.id}`)).status, 403);

    // Tenant B isolation
    currentAuth.tenantId = tenantB;
    currentAuth.role = 'propietario';
    currentAuth.allBranchesAccess = true;
    currentAuth.authorizedBranchIds = [branchB1];
    currentAuth.branchId = branchB1;

    assert.strictEqual((await reqJson(baseUrl, 'PUT', `/api/visits/${tktA2.data.id}/draft`, { total: 1 })).status, 404);
    assert.strictEqual((await reqJson(baseUrl, 'POST', `/api/visits/${visitId}/void`, { reason: 'Hack' })).status, 404);
    assert.strictEqual((await reqJson(baseUrl, 'DELETE', `/api/visits/${tktA2.data.id}`)).status, 404);
    console.log('  ✅ [PASS M9-C6]');

    console.log('\n========================================================================');
    console.log('🎉 MODULE 9 — POS, TICKETS & CONVENTIONAL INVOICING: ALL 6 CASES PASSED');
    console.log('========================================================================');
  } finally {
    server.close();
    for (const tbl of [
      'audit_logs', 'inventory_movements', 'inventory_stock', 'inventory_locations',
      'employee_commissions_log', 'employee_discounts', 'cash_register_movements',
      'visits', 'cash_registers', 'dgii_ncf_sequences', 'ticket_sequences', 'services', 'branches'
    ]) {
      await pool.query(`DELETE FROM ${tbl} WHERE tenant_id IN (?, ?)`, [tenantA, tenantB]).catch(() => {});
    }
    await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.end();
  }
}

if (require.main === module) {
  runModule9PosInvoicingAcceptance().catch((err) => {
    console.error('❌ [FAIL] Module 9 POS Invoicing Acceptance:', err);
    process.exit(1);
  });
}

module.exports = { runModule9PosInvoicingAcceptance };
