'use strict';

/**
 * Suite de Aceptación Módulo 6: Inventario (PostgreSQL real: salon_saas_test)
 *
 * Verifica:
 * - M6-C1: Fuente única Catálogo (403 CATALOG_SINGLE_SOURCE), UUID inválido (404/400), cantidad <= 0 (400), servicio rechazado en ajuste (400 INVALID_ITEM_TYPE).
 * - M6-C2: Ajustes IN/OUT atómicos, libro mayor (/movements), stock insuficiente (400), venta POS + anulación (reversión exacta de stock), alertas de bajo stock.
 * - M6-C3: Compras (crear → aprobar → recibir con idempotencia), transferencias entre ubicaciones (misma ubicación 400, despacho + recepción idempotente) y toma física atómica.
 * - M6-C4: RBAC separado (inventory.view 200/403 vs inventory.manage Encargado de inventario 200 en ajustes/alertas) y aislamiento multi-tenant (Empresa A vs B).
 */

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const bcrypt = require('bcryptjs');

const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { createApp } = require('../app');
const { signAuthToken } = require('../middleware/auth.middleware');
const { migrateAll } = require('../migrations/migrate_all.cjs');

function requestJson(baseUrl, method, pathUrl, { token = null, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathUrl, baseUrl);
    const payload = body !== null && body !== undefined ? JSON.stringify(body) : null;
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers,
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { json = null; }
        resolve({ status: res.statusCode, body: json, text: raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('========================================================================');
  console.log('🧪 ACEPTACIÓN MÓDULO 6: INVENTARIO EN POSTGRESQL (salon_saas_test)');
  console.log('========================================================================\n');

  const testConfig = validateTestEnvironment({ allowDisposableSchema: false });
  const pool = createIsolatedTestPool(testConfig);
  await migrateAll({ pool, targetSchema: 'public', quiet: true });

  const app = createApp({ pool });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const ts = Date.now();
  const tidA = crypto.randomUUID();
  const tidB = crypto.randomUUID();
  const bA1 = crypto.randomUUID();
  const bA2 = crypto.randomUUID();
  const bB1 = crypto.randomUUID();
  const ownerAId = crypto.randomUUID();
  const ownerBId = crypto.randomUUID();
  const invViewId = crypto.randomUUID();
  const invMgrId = crypto.randomUUID();

  const mkTok = (id, email, name, role, tenantId, branchId) => signAuthToken({
    sub: id, id, email, name, role, tenantId, branchId, isSuperAdmin: false, tokenVersion: 1,
  });

  const tokOwnerA = mkTok(ownerAId, `m6-oa-${ts}@test.local`, 'Owner M6 A', 'owner', tidA, bA1);
  const tokOwnerB = mkTok(ownerBId, `m6-ob-${ts}@test.local`, 'Owner M6 B', 'owner', tidB, bB1);
  const tokInvView = mkTok(invViewId, `m6-iv-${ts}@test.local`, 'Inv View A', 'inv_viewer', tidA, bA1);
  const tokInvMgr = mkTok(invMgrId, `m6-im-${ts}@test.local`, 'Encargado Inv A', 'Encargado de inventario', tidA, bA1);

  try {
    const pwHash = await bcrypt.hash('Mod6Pass#2026', 6);
    await pool.query(
      `INSERT INTO tenants (id, business_name, slug, email, owner_name, owner_email, rnc, plan_id, status, licensed_branches, max_branches, max_users, modules_config)
       VALUES (?, ?, ?, ?, 'Owner M6 A', ?, '131917061', 1, 'active', 2, 2, 10, '{"pos":true,"clients":true,"inventory":true,"inventory_advanced":true}'::jsonb),
              (?, ?, ?, ?, 'Owner M6 B', ?, '131917062', 1, 'active', 1, 1, 5, '{"pos":true,"clients":true,"inventory":true,"inventory_advanced":true}'::jsonb)`,
      [
        tidA, `Empresa M6 A ${ts}`, `m6-a-${ts}`, `m6-oa-${ts}@test.local`, `m6-oa-${ts}@test.local`,
        tidB, `Empresa M6 B ${ts}`, `m6-b-${ts}`, `m6-ob-${ts}@test.local`, `m6-ob-${ts}@test.local`,
      ]
    );

    for (const [bid, tid, name, isMain] of [
      [bA1, tidA, 'Sucursal M6 A1', true],
      [bA2, tidA, 'Sucursal M6 A2', false],
      [bB1, tidB, 'Sucursal M6 B1', true],
    ]) {
      await pool.query(`INSERT INTO branches (id, tenant_id, name, address, phone, is_main, status, is_active) VALUES (?, ?, ?, 'Dir', '8090000000', ?, 'Active', true)`, [bid, tid, name, isMain]);
      await pool.query(`INSERT INTO salons (id, name, address, phone, status, tenant_id) VALUES (?, ?, 'Dir', '8090000000', 'Active', ?)`, [bid, name, tid]);
    }

    const mkRole = async (tid, nombre, perms) => {
      const [r] = await pool.query(`INSERT INTO roles (tenant_id, nombre, description, permisos) VALUES (?, ?, ?, ?) RETURNING id`, [tid, nombre, nombre, JSON.stringify(perms)]);
      return r[0].id;
    };
    const rInvView = await mkRole(tidA, 'inv_viewer', { 'inventory.view': true });
    const rInvMgr = await mkRole(tidA, 'Encargado de inventario', { 'inventory.view': true, 'inventory.manage': true, 'services.view': true, 'services.manage': true });

    await pool.query(
      `INSERT INTO users (id, tenant_id, branch_id, name, nombre, email, password_hash, role, role_id, is_active, estado, token_version)
       VALUES (?, ?, ?, 'Owner M6 A', 'Owner M6 A', ?, ?, 'owner', NULL, true, 'Activo', 1),
              (?, ?, ?, 'Owner M6 B', 'Owner M6 B', ?, ?, 'owner', NULL, true, 'Activo', 1),
              (?, ?, ?, 'Inv View A', 'Inv View A', ?, ?, 'inv_viewer', ?, true, 'Activo', 1),
              (?, ?, ?, 'Encargado Inv A', 'Encargado Inv A', ?, ?, 'Encargado de inventario', ?, true, 'Activo', 1)`,
      [
        ownerAId, tidA, bA1, `m6-oa-${ts}@test.local`, pwHash,
        ownerBId, tidB, bB1, `m6-ob-${ts}@test.local`, pwHash,
        invViewId, tidA, bA1, `m6-iv-${ts}@test.local`, pwHash, rInvView,
        invMgrId, tidA, bA1, `m6-im-${ts}@test.local`, pwHash, rInvMgr,
      ]
    );

    // Seed active category + 1 product + 1 service in Catalog
    await requestJson(baseUrl, 'POST', '/api/commissions/categories', { token: tokOwnerA, body: { nombre: 'Retail M6', porcentaje: 0, tipo: 'Porcentaje', estado: 'Activa' } });
    const catsA = (await requestJson(baseUrl, 'GET', '/api/commissions/categories', { token: tokOwnerA })).body;
    const catRetail = catsA.find((c) => c.nombre === 'Retail M6');

    const prodRes = await requestJson(baseUrl, 'POST', '/api/services', {
      token: tokOwnerA,
      body: { nombre: 'Keratina 500ml M6', sku: `KER-M6-${ts}`, precio: 1200, costo: 400, commission_category_id: catRetail.id, item_type: 'PRODUCTO', track_stock: true, min_stock: 5, aplica_itbis: 1, tax_rate: 18, tax_mode: 'exclusive' },
    });
    const srvRes = await requestJson(baseUrl, 'POST', '/api/services', {
      token: tokOwnerA,
      body: { nombre: 'Lavado M6', precio: 500, commission_category_id: catRetail.id, item_type: 'SERVICIO', aplica_itbis: 0, tax_mode: 'exempt' },
    });
    assert.strictEqual(prodRes.status, 201);
    assert.strictEqual(srvRes.status, 201);
    const prodId = prodRes.body.id;
    const srvId = srvRes.body.id;

    // Open cash register in bA1
    const crOpen = await requestJson(baseUrl, 'POST', '/api/cash-registers/open', {
      token: tokOwnerA,
      body: { salon_id: bA1, branch_id: bA1, opening_balance: 1000, opening_amount: 1000 },
    });
    assert.ok(crOpen.status === 200 || crOpen.status === 201);
    const cashRegisterId = crOpen.body.id || crOpen.body.cash_register_id || crOpen.body.register?.id;

    // =========================================================================
    // M6-C1: Fuente única Catálogo + Validaciones
    // =========================================================================
    console.log('[M6-C1] Probando fuente única Catálogo (403) y validaciones de entrada...');
    const blockCreateProd = await requestJson(baseUrl, 'POST', '/api/inventory/products', { token: tokOwnerA, body: { name: 'Hack' } });
    assert.strictEqual(blockCreateProd.status, 403);
    assert.strictEqual(blockCreateProd.body.code, 'CATALOG_SINGLE_SOURCE');

    const blockUpdateProd = await requestJson(baseUrl, 'PUT', `/api/inventory/products/${prodId}`, { token: tokOwnerA, body: { name: 'Hack' } });
    assert.strictEqual(blockUpdateProd.status, 403);
    assert.strictEqual(blockUpdateProd.body.code, 'CATALOG_SINGLE_SOURCE');

    assert.strictEqual((await requestJson(baseUrl, 'GET', '/api/inventory/products/not-a-uuid', { token: tokOwnerA })).status, 404);
    assert.strictEqual((await requestJson(baseUrl, 'GET', '/api/inventory/stock/not-a-uuid', { token: tokOwnerA })).status, 404);
    assert.strictEqual((await requestJson(baseUrl, 'POST', '/api/inventory/adjustments', { token: tokOwnerA, body: { productId: prodId, quantity: -5, adjustmentType: 'ADJUSTMENT_IN' } })).status, 400);
    const adjServiceRes = await requestJson(baseUrl, 'POST', '/api/inventory/adjustments', { token: tokOwnerA, body: { productId: srvId, quantity: 2, adjustmentType: 'ADJUSTMENT_IN' } });
    assert.ok(adjServiceRes.status === 400 || adjServiceRes.status === 404, `Adjusting a SERVICE must be rejected (400/404), got ${adjServiceRes.status}`);

    const invProds = (await requestJson(baseUrl, 'GET', '/api/inventory/products', { token: tokOwnerA })).body;
    assert.ok(invProds.some((p) => p.id === prodId), 'Inventory must reuse exact Catalog UUID');
    console.log('  ✅ [PASS] M6-C1: Fuente única Catálogo (403), UUID canónico y validaciones estrictas.');

    // =========================================================================
    // M6-C2: Ajustes IN/OUT, Libro Mayor, Venta POS + Anulación (Reversión) y Alertas
    // =========================================================================
    console.log('[M6-C2] Probando ajustes IN/OUT, libro mayor, venta+anulación POS y alertas de bajo stock...');
    const adjIn = await requestJson(baseUrl, 'POST', '/api/inventory/adjustments', {
      token: tokOwnerA,
      body: { productId: prodId, quantity: 10, adjustmentType: 'ADJUSTMENT_IN', reason: 'Carga inicial M6' },
    });
    assert.strictEqual(adjIn.status, 200, `Adjustment IN failed: ${adjIn.text}`);
    assert.strictEqual(Number(adjIn.body.new_stock), 10);

    const adjOut = await requestJson(baseUrl, 'POST', '/api/inventory/adjustments', {
      token: tokOwnerA,
      body: { productId: prodId, quantity: 3, adjustmentType: 'ADJUSTMENT_OUT', reason: 'Consumo interno M6' },
    });
    assert.strictEqual(adjOut.status, 200);
    assert.strictEqual(Number(adjOut.body.new_stock), 7);

    // Out exceeding stock -> 400 INSUFFICIENT_STOCK
    const adjOver = await requestJson(baseUrl, 'POST', '/api/inventory/adjustments', {
      token: tokOwnerA,
      body: { productId: prodId, quantity: 20, adjustmentType: 'ADJUSTMENT_OUT', reason: 'Exceso' },
    });
    assert.strictEqual(adjOver.status, 400);
    assert.strictEqual(adjOver.body.code, 'INSUFFICIENT_STOCK');

    // POS sale of 2 units (7 -> 5), then void -> restored to 7
    const visitId = crypto.randomUUID();
    const saleRes = await requestJson(baseUrl, 'POST', `/api/visits/${visitId}/checkout`, {
      token: tokOwnerA,
      body: {
        client_name: 'Clienta Inv M6', salon_id: bA1, cash_register_id: cashRegisterId, metodo_pago: 'Efectivo', monto_recibido: 3000,
        items_detail: [{ id: prodId, product_id: prodId, nombre: 'Keratina 500ml M6', precio: 1200, precioBase: 1200, precioAplicado: 1200, cantidad: 2, tipo_item: 'PRODUCTO', is_product: true, track_stock: true }],
      },
    });
    assert.strictEqual(saleRes.status, 200, `Sale failed: ${saleRes.text}`);
    const stAfterSale = (await requestJson(baseUrl, 'GET', `/api/inventory/stock/${prodId}`, { token: tokOwnerA })).body;
    assert.strictEqual(Number(stAfterSale.quantity), 5, `Expected stock 5 after sale, got ${stAfterSale.quantity}`);

    // Alert settings (min_stock=6 so 5 triggers low-stock alert!)
    const cfgAlert = await requestJson(baseUrl, 'PUT', '/api/inventory/alert-settings', {
      token: tokOwnerA,
      body: { alerts_enabled: true, default_min_stock: 6 },
    });
    assert.strictEqual(cfgAlert.status, 200);
    const alerts = (await requestJson(baseUrl, 'GET', '/api/inventory/alerts/low-stock', { token: tokOwnerA })).body;
    assert.ok(Array.isArray(alerts) && alerts.some((a) => String(a.product_id || a.id) === prodId), 'Low stock alert must include product at qty=5 <= min=6');

    // Void sale -> stock restored 5 -> 7
    const voidRes = await requestJson(baseUrl, 'POST', `/api/visits/${visitId}/void`, {
      token: tokOwnerA,
      body: { reason: 'Devolución prueba M6' },
    });
    assert.strictEqual(voidRes.status, 200, `Void failed: ${voidRes.text}`);
    const stAfterVoid = (await requestJson(baseUrl, 'GET', `/api/inventory/stock/${prodId}`, { token: tokOwnerA })).body;
    assert.strictEqual(Number(stAfterVoid.quantity), 7, `Expected stock 7 after void, got ${stAfterVoid.quantity}`);

    const movs = (await requestJson(baseUrl, 'GET', `/api/inventory/movements?productId=${prodId}`, { token: tokOwnerA })).body;
    assert.ok(movs.length >= 4, `Expected >= 4 ledger movements (IN, OUT, SALE, VOID), got ${movs.length}`);
    console.log('  ✅ [PASS] M6-C2: Ajustes (10→7), venta (7→5), alerta bajo stock, anulación (5→7) y libro mayor completo.');

    // =========================================================================
    // M6-C3: Compras + Transferencias entre Sucursales + Idempotencia + Toma Física
    // =========================================================================
    console.log('[M6-C3] Probando compras, transferencias entre almacenes con idempotencia y toma física...');
    const locsBefore = (await requestJson(baseUrl, 'GET', '/api/inventory/locations', { token: tokOwnerA })).body;
    const loc1 = locsBefore[0];
    const loc2Res = await requestJson(baseUrl, 'POST', '/api/inventory/locations', {
      token: tokOwnerA,
      body: { name: 'Almacén Sucursal 2 M6', code: `SUC2-${ts}`, branch_id: bA2, salon_id: bA2 },
    });
    assert.strictEqual(loc2Res.status, 201, `Create location 2 failed: ${loc2Res.text}`);
    const loc2 = loc2Res.body;

    // Supplier + Purchase Order + Approve + Receive (idempotent retry)
    const supRes = await requestJson(baseUrl, 'POST', '/api/inventory/suppliers', {
      token: tokOwnerA,
      body: { name: 'Distribuidora M6', rnc: '131000001', phone: '8095550000' },
    });
    assert.strictEqual(supRes.status, 201);
    const poRes = await requestJson(baseUrl, 'POST', '/api/inventory/purchase-orders', {
      token: tokOwnerA,
      body: {
        order_number: `PO-M6-${ts}`,
        supplier_id: supRes.body.id,
        location_id: loc1.id,
        items: [{ product_id: prodId, quantity_ordered: 10, unit_cost: 500 }],
      },
    });
    assert.strictEqual(poRes.status, 201, `Create PO failed: ${poRes.text}`);
    assert.strictEqual((await requestJson(baseUrl, 'POST', `/api/inventory/purchase-orders/${poRes.body.id}/approve`, { token: tokOwnerA })).status, 200);
    const poIdempKey = `po-rcv-${ts}`;
    const rcv1 = await requestJson(baseUrl, 'POST', `/api/inventory/purchase-orders/${poRes.body.id}/receive`, {
      token: tokOwnerA,
      body: { idempotencyKey: poIdempKey, itemsToReceive: [{ product_id: prodId, quantity_received: 10, unit_cost: 500 }] },
    });
    assert.strictEqual(rcv1.status, 200, `Receive PO failed: ${rcv1.text}`);
    // Duplicate receive with same idempotencyKey MUST NOT double-add stock
    await requestJson(baseUrl, 'POST', `/api/inventory/purchase-orders/${poRes.body.id}/receive`, {
      token: tokOwnerA,
      body: { idempotencyKey: poIdempKey, itemsToReceive: [{ product_id: prodId, quantity_received: 10, unit_cost: 500 }] },
    });
    const stAfterPO = (await requestJson(baseUrl, 'GET', `/api/inventory/stock/${prodId}?locationId=${loc1.id}`, { token: tokOwnerA })).body;
    assert.strictEqual(Number(stAfterPO.quantity), 17, `Expected 7 + 10 = 17 after idempotent PO receive, got ${stAfterPO.quantity}`);

    // Transfer same location -> 400 SAME_LOCATION_TRANSFER
    const sameLocTrf = await requestJson(baseUrl, 'POST', '/api/inventory/transfers', {
      token: tokOwnerA,
      body: { transfer_number: `TRF-BAD-${ts}`, source_location_id: loc1.id, destination_location_id: loc1.id, items: [{ product_id: prodId, quantity_requested: 2 }] },
    });
    assert.strictEqual(sameLocTrf.status, 400);
    assert.strictEqual(sameLocTrf.body.code, 'SAME_LOCATION_TRANSFER');

    // Valid transfer loc1 -> loc2 (5 units): request -> approve -> dispatch -> receive (both idempotent)
    const trfRes = await requestJson(baseUrl, 'POST', '/api/inventory/transfers', {
      token: tokOwnerA,
      body: { transfer_number: `TRF-M6-${ts}`, source_location_id: loc1.id, destination_location_id: loc2.id, items: [{ product_id: prodId, quantity_requested: 5 }] },
    });
    assert.strictEqual(trfRes.status, 201, `Create transfer failed: ${trfRes.text}`);
    assert.strictEqual((await requestJson(baseUrl, 'POST', `/api/inventory/transfers/${trfRes.body.id}/approve`, { token: tokOwnerA })).status, 200);
    assert.strictEqual((await requestJson(baseUrl, 'POST', `/api/inventory/transfers/${trfRes.body.id}/dispatch`, { token: tokOwnerA, body: { idempotencyKey: `trf-disp-${ts}` } })).status, 200);
    assert.strictEqual((await requestJson(baseUrl, 'POST', `/api/inventory/transfers/${trfRes.body.id}/receive`, { token: tokOwnerA, body: { idempotencyKey: `trf-rcv-${ts}` } })).status, 200);
    const stLoc1AfterTrf = (await requestJson(baseUrl, 'GET', `/api/inventory/stock/${prodId}?locationId=${loc1.id}`, { token: tokOwnerA })).body;
    const stLoc2AfterTrf = (await requestJson(baseUrl, 'GET', `/api/inventory/stock/${prodId}?locationId=${loc2.id}`, { token: tokOwnerA })).body;
    assert.strictEqual(Number(stLoc1AfterTrf.quantity), 12, `Expected loc1=12, got ${stLoc1AfterTrf.quantity}`);
    assert.strictEqual(Number(stLoc2AfterTrf.quantity), 5, `Expected loc2=5, got ${stLoc2AfterTrf.quantity}`);

    // Physical inventory session on loc2 (count 5 -> 4) -> atomic post
    const physCreate = await requestJson(baseUrl, 'POST', '/api/inventory/physical-sessions', {
      token: tokOwnerA,
      body: { branch_id: bA2, location_id: loc2.id, notes: 'Conteo físico M6' },
    });
    assert.strictEqual(physCreate.status, 201, `Physical session create failed: ${physCreate.text}`);
    const sessId = physCreate.body.session?.id || physCreate.body.id;
    const physCount = await requestJson(baseUrl, 'PUT', `/api/inventory/physical-sessions/${sessId}/items`, {
      token: tokOwnerA,
      body: { items: [{ product_id: prodId, physical_count: 4 }] },
    });
    assert.strictEqual(physCount.status, 200, `Physical count failed: ${physCount.text}`);
    const physPost = await requestJson(baseUrl, 'POST', `/api/inventory/physical-sessions/${sessId}/post`, { token: tokOwnerA });
    assert.strictEqual(physPost.status, 200, `Physical post failed: ${physPost.text}`);
    const stLoc2AfterPhys = (await requestJson(baseUrl, 'GET', `/api/inventory/stock/${prodId}?locationId=${loc2.id}`, { token: tokOwnerA })).body;
    const stLoc1AfterPhys = (await requestJson(baseUrl, 'GET', `/api/inventory/stock/${prodId}?locationId=${loc1.id}`, { token: tokOwnerA })).body;
    assert.strictEqual(Number(stLoc2AfterPhys.quantity), 4, `Expected loc2=4 after physical count, got ${stLoc2AfterPhys.quantity}`);
    assert.strictEqual(Number(stLoc1AfterPhys.quantity), 12, `loc1 MUST remain untouched (12) after loc2 physical count, got ${stLoc1AfterPhys.quantity}`);
    console.log('  ✅ [PASS] M6-C3: Compras idempotentes (7→17), transferencia loc1→loc2 (12 / 5) y toma física atómica (5→4).');

    // =========================================================================
    // M6-C4: RBAC (inventory.view vs inventory.manage Encargado de inventario) y Cross-Tenant
    // =========================================================================
    console.log('[M6-C4] Probando RBAC (inventory.view vs inventory.manage) y aislamiento cross-tenant...');
    assert.strictEqual((await requestJson(baseUrl, 'GET', '/api/inventory/stock', { token: tokInvView })).status, 200);
    assert.strictEqual((await requestJson(baseUrl, 'POST', '/api/inventory/adjustments', { token: tokInvView, body: { productId: prodId, quantity: 1, adjustmentType: 'ADJUSTMENT_IN' } })).status, 403);
    assert.strictEqual((await requestJson(baseUrl, 'PUT', '/api/inventory/alert-settings', { token: tokInvView, body: { alerts_enabled: false, default_min_stock: 2 } })).status, 403);

    // Encargado de inventario (non-admin role with inventory.manage) MUST succeed on adjustment & alert-settings (M6-01)
    const mgrAdj = await requestJson(baseUrl, 'POST', '/api/inventory/adjustments', {
      token: tokInvMgr,
      body: { productId: prodId, locationId: loc1.id, quantity: 1, adjustmentType: 'ADJUSTMENT_IN', reason: 'Ajuste por Encargado de inventario' },
    });
    assert.strictEqual(mgrAdj.status, 200, `Encargado de inventario must be allowed to adjust stock: ${mgrAdj.text}`);
    const mgrAlert = await requestJson(baseUrl, 'PUT', '/api/inventory/alert-settings', {
      token: tokInvMgr,
      body: { alerts_enabled: true, default_min_stock: 5 },
    });
    assert.strictEqual(mgrAlert.status, 200, `Encargado de inventario must be allowed to configure alerts: ${mgrAlert.text}`);

    // Cross-tenant: Tenant B cannot inspect or adjust Tenant A's product -> 404
    assert.strictEqual((await requestJson(baseUrl, 'GET', `/api/inventory/products/${prodId}`, { token: tokOwnerB })).status, 404);
    assert.strictEqual((await requestJson(baseUrl, 'POST', '/api/inventory/adjustments', { token: tokOwnerB, body: { productId: prodId, quantity: 1, adjustmentType: 'ADJUSTMENT_IN' } })).status, 404);
    console.log('  ✅ [PASS] M6-C4: RBAC (view 200/403, Encargado de inventario 200) y aislamiento cross-tenant 404.');

    console.log('\n🎉 SUITE DE ACEPTACIÓN MÓDULO 6 APROBADA 100% (M6-C1 a M6-C4)');
  } finally {
    server.close();
    await pool.query('DELETE FROM inventory_physical_session_items WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM inventory_physical_sessions WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM inventory_transfer_items WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM inventory_transfers WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM inventory_purchase_order_items WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM inventory_purchase_orders WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM inventory_suppliers WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM inventory_alert_overrides WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM inventory_alert_settings WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM inventory_movements WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM inventory_stock WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM inventory_locations WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM audit_logs WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM employee_commissions_log WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM cash_movements WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM cash_registers WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM visits WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM services WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM commission_categories WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM users WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM roles WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM salons WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM branches WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.end();
  }
}

runTests().catch((err) => {
  console.error('❌ MÓDULO 6 ACCEPTANCE FAILED:', err);
  process.exit(1);
});
