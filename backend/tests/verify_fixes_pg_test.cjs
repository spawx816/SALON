/**
 * Integration verification against real PostgreSQL (salon_saas_test).
 * Verifies Bugs 1-3 and Workstreams 4-5 end-to-end with real SQL & HTTP.
 */
const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const { pool } = require('../db');
const { createApp } = require('../app');
const { signAuthToken } = require('../middleware/auth.middleware');
const { InventoryRepository } = require('../repositories/inventory.repository');
const { InventoryService } = require('../services/inventory.service');

async function req(server, { method = 'GET', path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const payload = body !== null ? JSON.stringify(body) : null;
    const opts = {
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers
      }
    };
    const r = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed = data;
        try {
          parsed = JSON.parse(data);
        } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: data });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function main() {
  const app = createApp(pool);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const tag = crypto.randomBytes(4).toString('hex');
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const branchA = crypto.randomUUID();
  const branchB = crypto.randomUUID();
  const superAdminId = crypto.randomUUID();
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();

  try {
    // Seed 2 isolated tenants + branches + users + subscriptions
    await pool.query(
      `INSERT INTO tenants (id, name, slug, status) VALUES (?, ?, ?, 'active'), (?, ?, ?, 'active')`,
      [tenantA, `Test Salon A ${tag}`, `test-a-${tag}`, tenantB, `Test Salon B ${tag}`, `test-b-${tag}`]
    );
    await pool.query(
      `INSERT INTO branches (id, tenant_id, name, is_main) VALUES (?, ?, 'Sucursal A', TRUE), (?, ?, 'Sucursal B', TRUE)`,
      [branchA, tenantA, branchB, tenantB]
    );
    await pool.query(
      `INSERT INTO users (id, tenant_id, name, email, password, role, is_active, token_version)
       VALUES (?, ?, 'Admin A', ?, 'hash', 'admin', TRUE, 1),
              (?, ?, 'Admin B', ?, 'hash', 'admin', TRUE, 1),
              (?, NULL, 'SuperAdmin Test', ?, 'hash', 'superadmin', TRUE, 1)`,
      [
        userAId, tenantA, `admina_${tag}@test.local`,
        userBId, tenantB, `adminb_${tag}@test.local`,
        superAdminId, `super_${tag}@test.local`
      ]
    );
    await pool.query(
      `INSERT INTO tenant_subscriptions (tenant_id, plan_code, status, billing_cycle, max_branches, max_employees, max_users)
       VALUES (?, 'PRINCIPAL', 'active', 'monthly', 5, 50, 20), (?, 'PRINCIPAL', 'active', 'monthly', 5, 50, 20)`,
      [tenantA, tenantB]
    );

    const tokenA = signAuthToken({ id: userAId, sub: userAId, tenant_id: tenantA, role: 'admin', token_version: 1 });
    const tokenB = signAuthToken({ id: userBId, sub: userBId, tenant_id: tenantB, role: 'admin', token_version: 1 });
    const tokenSuper = signAuthToken({ id: superAdminId, sub: superAdminId, role: 'superadmin', isSuperAdmin: true, token_version: 1 });
    const hdrA = { Authorization: `Bearer ${tokenA}` };
    const hdrB = { Authorization: `Bearer ${tokenB}` };
    const hdrSuper = { Authorization: `Bearer ${tokenSuper}` };

    // 1. Bug 1: Client create/edit/query + cross-tenant isolation
    const createClientRes = await req(server, {
      method: 'POST',
      path: '/api/clients',
      headers: hdrA,
      body: { nombre: `Client ${tag}`, telefono: `809555${tag.slice(0, 4)}`, salon_id: branchA }
    });
    assert.strictEqual(createClientRes.status, 200, `POST /api/clients failed: ${createClientRes.raw}`);
    const clientId = createClientRes.body.id;
    assert.ok(clientId, 'Client id returned');

    const editClientRes = await req(server, {
      method: 'PUT',
      path: `/api/clients/${clientId}`,
      headers: hdrA,
      body: { nombre: `Client Edited ${tag}`, telefono: `809555${tag.slice(0, 4)}`, salon_id: branchA }
    });
    assert.strictEqual(editClientRes.status, 200, `PUT /api/clients failed: ${editClientRes.raw}`);

    const crossClientRes = await req(server, {
      method: 'GET',
      path: `/api/clients/${clientId}`,
      headers: hdrB
    });
    assert.ok([403, 404].includes(crossClientRes.status), `Cross-tenant client read should fail, got ${crossClientRes.status}`);
    console.log('[PASS] Bug 1: POST/PUT/GET /api/clients + cross-tenant isolation');

    // 2. Bug 2: SaaS Plan update persistence + memberships add-on lock
    const plansBefore = await req(server, { method: 'GET', path: '/api/saas/plans', headers: hdrSuper });
    assert.strictEqual(plansBefore.status, 200);
    const principalPlan = plansBefore.body.find((p) => p.code === 'PRINCIPAL');
    assert.ok(principalPlan, 'PRINCIPAL plan exists');
    const origDesc = principalPlan.description;

    const putPlanRes = await req(server, {
      method: 'PUT',
      path: `/api/saas/plans/${principalPlan.id}`,
      headers: hdrSuper,
      body: {
        name: principalPlan.name,
        description: `Updated ${tag}`,
        included_features: { ...(principalPlan.included_features || {}), memberships: true, clients: true, inventory: true }
      }
    });
    assert.strictEqual(putPlanRes.status, 200, `PUT /api/saas/plans failed: ${putPlanRes.raw}`);
    assert.strictEqual(putPlanRes.body.included_features.memberships, false, 'PRINCIPAL must keep memberships=false');

    // Restore original description
    await req(server, {
      method: 'PUT',
      path: `/api/saas/plans/${principalPlan.id}`,
      headers: hdrSuper,
      body: { description: origDesc }
    });
    console.log('[PASS] Bug 2: PUT /api/saas/plans persists & locks memberships add-on');

    // 3. Bug 3: /api/services/top, /api/dgii/sequences/availability, Gift Cards JSON, /api/* 404 JSON
    const topRes = await req(server, { method: 'GET', path: '/api/services/top', headers: hdrA });
    assert.strictEqual(topRes.status, 200, `GET /api/services/top failed: ${topRes.raw}`);
    assert.ok(Array.isArray(topRes.body));

    const dgiiRes = await req(server, { method: 'GET', path: '/api/dgii/sequences/availability', headers: hdrA });
    assert.strictEqual(dgiiRes.status, 200, `GET /api/dgii/sequences/availability failed: ${dgiiRes.raw}`);
    assert.strictEqual(typeof dgiiRes.body.dgiiEnabled, 'boolean');

    const giftsRes = await req(server, { method: 'GET', path: '/api/admin/gifts', headers: hdrA });
    assert.strictEqual(giftsRes.status, 200, `GET /api/admin/gifts failed: ${giftsRes.raw}`);
    assert.ok(Array.isArray(giftsRes.body));

    const missingApiRes = await req(server, { method: 'GET', path: '/api/route-does-not-exist', headers: hdrA });
    assert.strictEqual(missingApiRes.status, 404);
    assert.ok(missingApiRes.headers['content-type'].includes('application/json'), '404 /api must return JSON');
    console.log('[PASS] Bug 3: /services/top, /dgii/sequences/availability, /admin/gifts, /api/* 404 JSON');

    // 4. Workstream 4: Catalog categories from commission_categories
    const [activeCatRows] = await pool.query(
      `INSERT INTO commission_categories (tenant_id, nombre, porcentaje, tipo, estado)
       VALUES (?, ?, 15, 'Porcentaje', 'activo') RETURNING id, nombre`,
      [tenantA, `CatActiva_${tag}`]
    );
    const [inactiveCatRows] = await pool.query(
      `INSERT INTO commission_categories (tenant_id, nombre, porcentaje, tipo, estado)
       VALUES (?, ?, 10, 'Porcentaje', 'inactivo') RETURNING id, nombre`,
      [tenantA, `CatInactiva_${tag}`]
    );
    const activeCatId = activeCatRows[0].id;
    const inactiveCatId = inactiveCatRows[0].id;

    // Reject inactive category on create
    const badCatRes = await req(server, {
      method: 'POST',
      path: '/api/services',
      headers: hdrA,
      body: { nombre: `ProdBad_${tag}`, precio: 100, item_type: 'PRODUCTO', commission_category_id: inactiveCatId }
    });
    assert.strictEqual(badCatRes.status, 400, 'Inactive category must be rejected on create');

    // Accept active category on create
    const goodProdRes = await req(server, {
      method: 'POST',
      path: '/api/services',
      headers: hdrA,
      body: {
        nombre: `Shampoo_${tag}`,
        precio: 500,
        costo: 200,
        item_type: 'PRODUCTO',
        sku: `SKU-${tag}`,
        unit_of_measure: 'Unidad',
        track_stock: true,
        commission_category_id: activeCatId
      }
    });
    assert.strictEqual(goodProdRes.status, 201, `Create product failed: ${goodProdRes.raw}`);
    assert.strictEqual(goodProdRes.body.categoria, `CatActiva_${tag}`);
    const prodId = goodProdRes.body.id;

    // Deactivate category and verify historical edit still works if keeping same ID
    await pool.query(`UPDATE commission_categories SET estado = 'inactivo' WHERE id = ? AND tenant_id = ?`, [activeCatId, tenantA]);
    const histEditRes = await req(server, {
      method: 'PUT',
      path: `/api/services/${prodId}`,
      headers: hdrA,
      body: { nombre: `Shampoo_${tag}`, precio: 550, item_type: 'PRODUCTO', commission_category_id: activeCatId }
    });
    assert.strictEqual(histEditRes.status, 200, `Historical inactive category edit failed: ${histEditRes.raw}`);
    console.log('[PASS] Workstream 4: Catalog categories bound to active commission_categories');

    // 5. Workstream 5: Editable inventory alerts, inheritance, 0 threshold, episode deduplication
    const genSetRes = await req(server, {
      method: 'PUT',
      path: '/api/inventory/alert-settings',
      headers: hdrA,
      body: { alerts_enabled: true, default_min_stock: 3 }
    });
    assert.strictEqual(genSetRes.status, 200, `PUT alert-settings failed: ${genSetRes.raw}`);

    const invRepo = new InventoryRepository(pool);
    const invSvc = new InventoryService(invRepo);
    const defLoc = await invSvc.getDefaultLocation(tenantA);

    // Stock in 5 (> 3 -> no alert)
    await invSvc.makeAdjustment(tenantA, {
      productId: prodId,
      locationId: defLoc.id,
      quantity: 5,
      adjustmentType: 'ADJUSTMENT_IN',
      reason: 'Init',
      userRole: 'admin'
    });
    let alertsRes = await req(server, { method: 'GET', path: '/api/inventory/alerts/low-stock', headers: hdrA });
    assert.strictEqual(alertsRes.status, 200);
    assert.strictEqual(alertsRes.body.length, 0, 'Stock 5 > 3 should not alert');

    // Adjust out 2 -> stock 3 (<= 3 -> newlyTriggered: true)
    const adj1 = await invSvc.makeAdjustment(tenantA, {
      productId: prodId,
      locationId: defLoc.id,
      quantity: 2,
      adjustmentType: 'ADJUSTMENT_OUT',
      reason: 'Drop to threshold',
      userRole: 'admin'
    });
    assert.strictEqual(adj1.alert_evaluation.newlyTriggered, true, 'First crossing must trigger alert');

    // Adjust out 1 -> stock 2 (still <= 3 -> same episode, newlyTriggered: false)
    const adj2 = await invSvc.makeAdjustment(tenantA, {
      productId: prodId,
      locationId: defLoc.id,
      quantity: 1,
      adjustmentType: 'ADJUSTMENT_OUT',
      reason: 'Still low',
      userRole: 'admin'
    });
    assert.strictEqual(adj2.alert_evaluation.newlyTriggered, false, 'Same low-stock episode must not duplicate');

    // Adjust in 5 -> stock 7 (> 3 -> resolved: true)
    const adj3 = await invSvc.makeAdjustment(tenantA, {
      productId: prodId,
      locationId: defLoc.id,
      quantity: 5,
      adjustmentType: 'ADJUSTMENT_IN',
      reason: 'Restock',
      userRole: 'admin'
    });
    assert.strictEqual(adj3.alert_evaluation.resolved, true, 'Recovery above threshold must resolve episode');

    // Set override min_stock = 0 on product & test 0 threshold
    const ovRes = await req(server, {
      method: 'PUT',
      path: '/api/inventory/alert-overrides',
      headers: hdrA,
      body: { product_id: prodId, min_stock: 0 }
    });
    assert.strictEqual(ovRes.status, 200, `Override 0 failed: ${ovRes.raw}`);

    const adj4 = await invSvc.makeAdjustment(tenantA, {
      productId: prodId,
      locationId: defLoc.id,
      quantity: 7,
      adjustmentType: 'ADJUSTMENT_OUT',
      reason: 'Drop to 0',
      userRole: 'admin'
    });
    assert.strictEqual(adj4.alert_evaluation.min_stock, 0);
    assert.strictEqual(adj4.alert_evaluation.newlyTriggered, true, 'Threshold 0 must trigger when stock reaches 0');

    console.log('[PASS] Workstream 5: Editable inventory alerts, 0 threshold & episode deduplication');
    console.log('ALL POSTGRESQL INTEGRATION CHECKS PASSED!');
  } finally {
    // Cleanup test tenants (cascade deletes tenant-owned rows) and superadmin user
    await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [tenantA, tenantB]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ?', [superAdminId]).catch(() => {});
    server.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('INTEGRATION TEST FAILED:', err);
  process.exit(1);
});
