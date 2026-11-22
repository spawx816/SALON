'use strict';

/**
 * Module 7 — Clients (CRM) Acceptance Suite (PostgreSQL)
 * Covers: CRUD + mirror columns, fechaNacimiento/address fallback, validation guards,
 * duplicate cedula on create & update, invalid UUID 404, foreign branch 400,
 * delete with/without visit history (soft-archive), BASE vs PRO membership stripping/blocking,
 * RBAC (clients.view / clients.create / clients.edit), B2C self-only isolation,
 * cursor pagination & multi-tenant isolation.
 */

const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { createClientsRouter } = require('../routes/clients.routes');

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

async function runModule7ClientsAcceptance() {
  console.log('========================================================================');
  console.log('🧪 MODULE 7 — CLIENTS (CRM) ACCEPTANCE SUITE (POSTGRESQL)');
  console.log('========================================================================\n');

  const testConfig = validateTestEnvironment({ allowDisposableSchema: true });
  const pool = createIsolatedTestPool(testConfig);

  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const branchA1 = crypto.randomUUID();
  const branchA2 = crypto.randomUUID();
  const branchB1 = crypto.randomUUID();

  let currentAuth = {
    tenantId: tenantA,
    role: 'owner',
    permissions: ['clients.view', 'clients.create', 'clients.edit'],
    isClient: false,
    id: crypto.randomUUID(),
    branchId: branchA1,
    hasMemberships: false,
  };

  const entitlementsService = {
    async hasFeature(_tenantId, feature) {
      if (feature === 'memberships') return { allowed: Boolean(currentAuth.hasMemberships) };
      return { allowed: true };
    },
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenantId = currentAuth.tenantId;
    req.auth = {
      id: currentAuth.id,
      role: currentAuth.role,
      tenantId: currentAuth.tenantId,
      branchId: currentAuth.branchId,
      isClient: Boolean(currentAuth.isClient),
      permissions: currentAuth.permissions,
    };
    req.user = {
      id: currentAuth.id,
      role: currentAuth.role,
      tenant_id: currentAuth.tenantId,
      branch_id: currentAuth.branchId,
      permissions: currentAuth.permissions,
    };
    next();
  });
  app.use('/api/clients', createClientsRouter(pool, { entitlementsService }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // Seed 2 synthetic tenants & 3 branches
    await pool.query(
      `INSERT INTO tenants (id, business_name, slug, email, status)
       VALUES (?, 'Empresa M7 A', ?, ?, 'Active'),
              (?, 'Empresa M7 B', ?, ?, 'Active')`,
      [
        tenantA, `m7-a-${tenantA.slice(0, 8)}`, `m7a-${tenantA.slice(0, 8)}@test.local`,
        tenantB, `m7-b-${tenantB.slice(0, 8)}`, `m7b-${tenantB.slice(0, 8)}@test.local`,
      ]
    );
    await pool.query(
      `INSERT INTO branches (id, tenant_id, name, is_main, status)
       VALUES (?, ?, 'Sucursal A Principal', true, 'Active'),
              (?, ?, 'Sucursal A Norte', false, 'Active'),
              (?, ?, 'Sucursal B Principal', true, 'Active')`,
      [branchA1, tenantA, branchA2, tenantA, branchB1, tenantB]
    );

    // --- M7-C1: Create client with fechaNacimiento + structured address + password sanitization ---
    console.log('--- M7-C1: Create client with fechaNacimiento, address fallback, mirror columns & sanitization ---');
    const createRes = await reqJson(baseUrl, 'POST', '/api/clients', {
      nombre: '  Laura Peña  ',
      cedula: '402-1122334-5',
      telefono: '8095551101',
      email: 'laura.m7@test.local',
      fechaNacimiento: '1994-05-18',
      calle: 'Av. Winston Churchill',
      numero: '45',
      sector: 'Piantini',
      ciudad: 'Santo Domingo',
      salon_id: branchA2,
      password: 'SecretPassword123!',
    });
    assert.strictEqual(createRes.status, 200, `Expected 200, got ${createRes.status}: ${JSON.stringify(createRes.data)}`);
    assert.ok(createRes.data.id, 'Client ID returned');
    const clientA1Id = createRes.data.id;

    const getA1 = await reqJson(baseUrl, 'GET', `/api/clients/${clientA1Id}`);
    assert.strictEqual(getA1.status, 200);
    assert.strictEqual(getA1.data.nombre, 'Laura Peña');
    assert.strictEqual(getA1.data.name, 'Laura Peña');
    assert.strictEqual(getA1.data.cedula, '402-1122334-5');
    assert.strictEqual(getA1.data.cedula_rnc, '402-1122334-5');
    assert.strictEqual(getA1.data.telefono, '8095551101');
    assert.strictEqual(getA1.data.phone, '8095551101');
    assert.strictEqual(getA1.data.direccion, 'Av. Winston Churchill, #45, Piantini, Santo Domingo');
    assert.strictEqual(getA1.data.address, 'Av. Winston Churchill, #45, Piantini, Santo Domingo');
    assert.ok(String(getA1.data.fecha_nacimiento).startsWith('1994-05-18'), `Unexpected DOB: ${getA1.data.fecha_nacimiento}`);
    assert.strictEqual(String(getA1.data.salon_id), branchA2);
    assert.strictEqual(getA1.data.password, undefined, 'Password hash MUST NOT be exposed');
    assert.strictEqual(getA1.data.contract_id, undefined, 'BASE tenant MUST strip membership fields');
    console.log('  ✅ [PASS M7-C1]');

    // --- M7-C2: Validation guards (whitespace name, duplicate cedula, foreign branch, invalid UUID) ---
    console.log('--- M7-C2: Validation guards ---');
    const emptyNameRes = await reqJson(baseUrl, 'POST', '/api/clients', { nombre: '   ' });
    assert.strictEqual(emptyNameRes.status, 400);

    const dupCedulaRes = await reqJson(baseUrl, 'POST', '/api/clients', {
      nombre: 'Clon Laura',
      cedula: '40211223345', // Same digits without dashes
    });
    assert.strictEqual(dupCedulaRes.status, 400, 'Duplicate cedula without dashes must be rejected');

    const foreignBranchPost = await reqJson(baseUrl, 'POST', '/api/clients', {
      nombre: 'Cliente Sucursal Ajena',
      salon_id: branchB1,
    });
    assert.strictEqual(foreignBranchPost.status, 400, 'Foreign-tenant branch must be rejected on POST');

    const badUuidPut = await reqJson(baseUrl, 'PUT', '/api/clients/not-a-uuid', { nombre: 'X' });
    assert.strictEqual(badUuidPut.status, 404, 'Invalid UUID on PUT must return 404, not 500');

    const badUuidDel = await reqJson(baseUrl, 'DELETE', '/api/clients/not-a-uuid');
    assert.strictEqual(badUuidDel.status, 404, 'Invalid UUID on DELETE must return 404, not 500');
    console.log('  ✅ [PASS M7-C2]');

    // --- M7-C3: Edit client mirror columns & duplicate cedula guard on PUT ---
    console.log('--- M7-C3: Edit client mirror columns & duplicate cedula on PUT ---');
    const createA2 = await reqJson(baseUrl, 'POST', '/api/clients', {
      nombre: 'Carla Gómez',
      cedula: '402-9988776-1',
      telefono: '8095552202',
    });
    assert.strictEqual(createA2.status, 200);
    const clientA2Id = createA2.data.id;

    // Colliding cedula with A1 must fail 400
    const dupPutRes = await reqJson(baseUrl, 'PUT', `/api/clients/${clientA2Id}`, {
      cedula: '402-1122334-5',
    });
    assert.strictEqual(dupPutRes.status, 400, 'Duplicate cedula on PUT must return 400');

    // Foreign branch on PUT must fail 400
    const foreignBranchPut = await reqJson(baseUrl, 'PUT', `/api/clients/${clientA2Id}`, {
      salon_id: branchB1,
    });
    assert.strictEqual(foreignBranchPut.status, 400);

    // Valid update keeping own cedula and updating mirror columns
    const validPut = await reqJson(baseUrl, 'PUT', `/api/clients/${clientA2Id}`, {
      nombre: 'Carla Gómez Editada',
      cedula: '402-9988776-1',
      telefono: '8295559999',
      direccion: 'Calle El Sol #10, Santiago',
      fechaNacimiento: '1991-11-03',
      salon_id: branchA1,
    });
    assert.strictEqual(validPut.status, 200);

    const getA2 = await reqJson(baseUrl, 'GET', `/api/clients/${clientA2Id}`);
    assert.strictEqual(getA2.data.nombre, 'Carla Gómez Editada');
    assert.strictEqual(getA2.data.name, 'Carla Gómez Editada');
    assert.strictEqual(getA2.data.telefono, '8295559999');
    assert.strictEqual(getA2.data.phone, '8295559999');
    assert.strictEqual(getA2.data.direccion, 'Calle El Sol #10, Santiago');
    assert.strictEqual(getA2.data.address, 'Calle El Sol #10, Santiago');
    assert.ok(String(getA2.data.fecha_nacimiento).startsWith('1991-11-03'));
    console.log('  ✅ [PASS M7-C3]');

    // --- M7-C4: Multi-tenant isolation ---
    console.log('--- M7-C4: Multi-tenant isolation ---');
    currentAuth.tenantId = tenantB;
    currentAuth.branchId = branchB1;

    const createB1 = await reqJson(baseUrl, 'POST', '/api/clients', {
      nombre: 'Clienta Empresa B',
      cedula: '402-1122334-5', // Same cedula as Tenant A is ALLOWED in Tenant B!
    });
    assert.strictEqual(createB1.status, 200, 'Same cedula in different tenant must be allowed');

    const crossGet = await reqJson(baseUrl, 'GET', `/api/clients/${clientA1Id}`);
    assert.strictEqual(crossGet.status, 404);
    const crossPut = await reqJson(baseUrl, 'PUT', `/api/clients/${clientA1Id}`, { nombre: 'Hack' });
    assert.strictEqual(crossPut.status, 404);
    const crossDel = await reqJson(baseUrl, 'DELETE', `/api/clients/${clientA1Id}`);
    assert.strictEqual(crossDel.status, 404);
    const searchB = await reqJson(baseUrl, 'GET', '/api/clients/search?q=Laura');
    assert.strictEqual(searchB.status, 200);
    assert.strictEqual(searchB.data.data.length, 0, 'Tenant B search must not see Tenant A');
    console.log('  ✅ [PASS M7-C4]');

    // Restore Tenant A
    currentAuth.tenantId = tenantA;
    currentAuth.branchId = branchA1;

    // --- M7-C5: Delete with vs without visit history ---
    console.log('--- M7-C5: Delete with vs without visit history ---');
    // Insert a visit for clientA1Id
    const visitId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO visits (id, tenant_id, salon_id, client_id, total, subtotal, payment_method, visited_at)
       VALUES (?, ?, ?, ?, 1500, 1500, 'Efectivo', NOW())`,
      [visitId, tenantA, branchA1, clientA1Id]
    );

    const delWithHistory = await reqJson(baseUrl, 'DELETE', `/api/clients/${clientA1Id}`);
    assert.strictEqual(delWithHistory.status, 200);
    assert.strictEqual(delWithHistory.data.archived, true, 'Client with visits must be archived, not deleted');

    const [a1Row] = await pool.query('SELECT status FROM clients WHERE id = ? AND tenant_id = ?', [clientA1Id, tenantA]);
    assert.strictEqual(a1Row.length, 1, 'Archived client row must still exist');
    assert.strictEqual(a1Row[0].status, 'Inactive');

    const delWithoutHistory = await reqJson(baseUrl, 'DELETE', `/api/clients/${clientA2Id}`);
    assert.strictEqual(delWithoutHistory.status, 200);
    assert.strictEqual(delWithoutHistory.data.archived, false, 'Client without history must be hard-deleted');
    const [a2Row] = await pool.query('SELECT id FROM clients WHERE id = ? AND tenant_id = ?', [clientA2Id, tenantA]);
    assert.strictEqual(a2Row.length, 0);
    console.log('  ✅ [PASS M7-C5]');

    // --- M7-C6: Plan Principal (BASE) rejects membership payload & protects PRO contracts ---
    console.log('--- M7-C6: Plan Principal (BASE) membership guards ---');
    currentAuth.hasMemberships = false;
    const baseMembershipPost = await reqJson(baseUrl, 'POST', '/api/clients', {
      nombre: 'Cliente con Plan en BASE',
      plan_id: 'plan-1',
    });
    assert.strictEqual(baseMembershipPost.status, 403);
    assert.strictEqual(baseMembershipPost.data.code, 'FEATURE_NOT_INCLUDED');

    const baseMembershipPut = await reqJson(baseUrl, 'PUT', `/api/clients/${clientA1Id}`, {
      plan_id: 'plan-1',
    });
    assert.strictEqual(baseMembershipPut.status, 403);
    assert.strictEqual(baseMembershipPut.data.code, 'FEATURE_NOT_INCLUDED');
    console.log('  ✅ [PASS M7-C6]');

    // --- M7-C7: RBAC & B2C isolation ---
    console.log('--- M7-C7: RBAC & B2C isolation ---');
    // Viewer only
    currentAuth.role = 'custom_viewer';
    currentAuth.permissions = ['clients.view'];
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/clients')).status, 200);
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/clients', { nombre: 'No Permitido' })).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'PUT', `/api/clients/${clientA1Id}`, { nombre: 'No' })).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'DELETE', `/api/clients/${clientA1Id}`)).status, 403);

    // Creator only (can POST, cannot PUT/DELETE)
    currentAuth.role = 'custom_creator';
    currentAuth.permissions = ['clients.view', 'clients.create'];
    const creatorPost = await reqJson(baseUrl, 'POST', '/api/clients', { nombre: 'Creada por Recepción' });
    assert.strictEqual(creatorPost.status, 200);
    assert.strictEqual((await reqJson(baseUrl, 'PUT', `/api/clients/${creatorPost.data.id}`, { nombre: 'No' })).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'DELETE', `/api/clients/${creatorPost.data.id}`)).status, 403);

    // B2C client: self-only GET /:id
    currentAuth.role = 'cliente_b2c';
    currentAuth.isClient = true;
    currentAuth.id = clientA1Id;
    currentAuth.permissions = [];
    const b2cSelf = await reqJson(baseUrl, 'GET', `/api/clients/${clientA1Id}`);
    assert.strictEqual(b2cSelf.status, 200);
    assert.strictEqual(b2cSelf.data.id, clientA1Id);
    assert.strictEqual((await reqJson(baseUrl, 'GET', `/api/clients/${creatorPost.data.id}`)).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/clients')).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/clients/search?q=Laura')).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/clients', { nombre: 'X' })).status, 403);
    console.log('  ✅ [PASS M7-C7]');

    // --- M7-C8: Cursor pagination & search validation ---
    console.log('--- M7-C8: Cursor pagination & search ---');
    currentAuth.role = 'owner';
    currentAuth.isClient = false;
    currentAuth.permissions = ['clients.view', 'clients.create', 'clients.edit'];

    const shortSearch = await reqJson(baseUrl, 'GET', '/api/clients/search?q=L');
    assert.strictEqual(shortSearch.status, 400);

    const p1 = await reqJson(baseUrl, 'GET', '/api/clients?limit=1&paginated=true');
    assert.strictEqual(p1.status, 200);
    assert.strictEqual(p1.data.data.length, 1);
    assert.strictEqual(p1.data.pagination.has_more, true);
    const p2 = await reqJson(baseUrl, 'GET', `/api/clients?limit=1&paginated=true&cursor=${encodeURIComponent(p1.data.pagination.next_cursor)}`);
    assert.strictEqual(p2.status, 200);
    assert.strictEqual(p2.data.data.length, 1);
    assert.notStrictEqual(p1.data.data[0].id, p2.data.data[0].id);
    console.log('  ✅ [PASS M7-C8]');

    console.log('\n========================================================================');
    console.log('🎉 MODULE 7 — CLIENTS (CRM) ACCEPTANCE SUITE: ALL 8 CASES PASSED');
    console.log('========================================================================');
  } finally {
    server.close();
    await pool.query('DELETE FROM visits WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM contracts WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM clients WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM branches WHERE tenant_id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.end();
  }
}

if (require.main === module) {
  runModule7ClientsAcceptance().catch((err) => {
    console.error('❌ [FAIL] Module 7 Clients Acceptance:', err);
    process.exit(1);
  });
}

module.exports = { runModule7ClientsAcceptance };
