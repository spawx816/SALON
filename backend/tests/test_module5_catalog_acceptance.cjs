'use strict';

/**
 * Suite de Aceptación Módulo 5 (Catálogo) + Previo Módulo 4 (Separación RBAC 3 niveles & Fallback visible)
 * Ejecuta sobre PostgreSQL real (salon_saas_test) con 2 empresas y múltiples sucursales.
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
  console.log('🧪 ACEPTACIÓN MÓDULO 5 (CATÁLOGO) + PREVIO M4 (RBAC 3 NIVELES) EN PG');
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
  const commViewId = crypto.randomUUID();
  const commCfgId = crypto.randomUUID();
  const commAppId = crypto.randomUUID();
  const catViewId = crypto.randomUUID();

  const mkToken = (id, email, name, role, tenantId, branchId) => signAuthToken({
    sub: id, id, email, name, role, tenantId, branchId, isSuperAdmin: false, tokenVersion: 1,
  });

  const tokOwnerA = mkToken(ownerAId, `m5-oa-${ts}@test.local`, 'Owner M5 A', 'owner', tidA, bA1);
  const tokOwnerB = mkToken(ownerBId, `m5-ob-${ts}@test.local`, 'Owner M5 B', 'owner', tidB, bB1);
  const tokCommView = mkToken(commViewId, `m5-cv-${ts}@test.local`, 'Comm View', 'comm_view_role', tidA, bA1);
  const tokCommCfg = mkToken(commCfgId, `m5-cc-${ts}@test.local`, 'Comm Config', 'comm_cfg_role', tidA, bA1);
  const tokCommApp = mkToken(commAppId, `m5-ca-${ts}@test.local`, 'Comm Approve', 'comm_app_role', tidA, bA1);
  const tokCatView = mkToken(catViewId, `m5-sv-${ts}@test.local`, 'Catalog View', 'cat_view_role', tidA, bA1);

  try {
    const pwHash = await bcrypt.hash('Mod5Pass#2026', 6);
    await pool.query(
      `INSERT INTO tenants (id, business_name, slug, email, owner_name, owner_email, rnc, plan_id, status, licensed_branches, max_branches, max_users, modules_config)
       VALUES (?, ?, ?, ?, 'Owner M5 A', ?, '131917051', 1, 'active', 2, 2, 10, '{"pos":true,"clients":true}'::jsonb),
              (?, ?, ?, ?, 'Owner M5 B', ?, '131917052', 1, 'active', 1, 1, 5, '{"pos":true,"clients":true}'::jsonb)`,
      [
        tidA, `Empresa M5 A ${ts}`, `m5-a-${ts}`, `m5-oa-${ts}@test.local`, `m5-oa-${ts}@test.local`,
        tidB, `Empresa M5 B ${ts}`, `m5-b-${ts}`, `m5-ob-${ts}@test.local`, `m5-ob-${ts}@test.local`,
      ]
    );

    for (const [bid, tid, name, isMain] of [
      [bA1, tidA, 'Sucursal M5 A1', true],
      [bA2, tidA, 'Sucursal M5 A2', false],
      [bB1, tidB, 'Sucursal M5 B1', true],
    ]) {
      await pool.query(`INSERT INTO branches (id, tenant_id, name, address, phone, is_main, status, is_active) VALUES (?, ?, ?, 'Dir', '8090000000', ?, 'Active', true)`, [bid, tid, name, isMain]);
      await pool.query(`INSERT INTO salons (id, name, address, phone, status, tenant_id) VALUES (?, ?, 'Dir', '8090000000', 'Active', ?)`, [bid, name, tid]);
    }

    const mkRole = async (tid, nombre, perms) => {
      const [r] = await pool.query(
        `INSERT INTO roles (tenant_id, nombre, description, permisos) VALUES (?, ?, ?, ?) RETURNING id`,
        [tid, nombre, nombre, JSON.stringify(perms)]
      );
      return r[0].id;
    };

    const rCommView = await mkRole(tidA, 'comm_view_role', { 'commissions.view': true });
    const rCommCfg = await mkRole(tidA, 'comm_cfg_role', { 'commissions.view': true, 'commissions.configure': true });
    const rCommApp = await mkRole(tidA, 'comm_app_role', { 'commissions.view': true, 'commissions.approve': true });
    const rCatView = await mkRole(tidA, 'cat_view_role', { 'services.view': true });

    await pool.query(
      `INSERT INTO users (id, tenant_id, branch_id, name, nombre, email, password_hash, role, role_id, is_active, estado, token_version)
       VALUES (?, ?, ?, 'Owner M5 A', 'Owner M5 A', ?, ?, 'owner', NULL, true, 'Activo', 1),
              (?, ?, ?, 'Owner M5 B', 'Owner M5 B', ?, ?, 'owner', NULL, true, 'Activo', 1),
              (?, ?, ?, 'Comm View', 'Comm View', ?, ?, 'comm_view_role', ?, true, 'Activo', 1),
              (?, ?, ?, 'Comm Config', 'Comm Config', ?, ?, 'comm_cfg_role', ?, true, 'Activo', 1),
              (?, ?, ?, 'Comm Approve', 'Comm Approve', ?, ?, 'comm_app_role', ?, true, 'Activo', 1),
              (?, ?, ?, 'Catalog View', 'Catalog View', ?, ?, 'cat_view_role', ?, true, 'Activo', 1)`,
      [
        ownerAId, tidA, bA1, `m5-oa-${ts}@test.local`, pwHash,
        ownerBId, tidB, bB1, `m5-ob-${ts}@test.local`, pwHash,
        commViewId, tidA, bA1, `m5-cv-${ts}@test.local`, pwHash, rCommView,
        commCfgId, tidA, bA1, `m5-cc-${ts}@test.local`, pwHash, rCommCfg,
        commAppId, tidA, bA1, `m5-ca-${ts}@test.local`, pwHash, rCommApp,
        catViewId, tidA, bA1, `m5-sv-${ts}@test.local`, pwHash, rCatView,
      ]
    );

    const [empIns] = await pool.query(
      `INSERT INTO staff_records (tenant_id, nombre, posicion, localidad, salon_id, salario_base, tipo_salario, status, fecha_entrada)
       VALUES (?, 'Estilista M5', 'Estilista', 'Sucursal M5 A1', ?, 20000, 'fijo_mas_comision', 'Activo', '2026-01-01') RETURNING id`,
      [tidA, bA1]
    );
    const empId = empIns[0].id;

    const crOpen = await requestJson(baseUrl, 'POST', '/api/cash-registers/open', {
      token: tokOwnerA,
      body: { salon_id: bA1, branch_id: bA1, opening_balance: 1000, opening_amount: 1000 },
    });
    assert.ok(crOpen.status === 200 || crOpen.status === 201);
    const cashRegisterId = crOpen.body.id || crOpen.body.cash_register_id || crOpen.body.register?.id;

    // =========================================================================
    // PREVIO M4: Separación de permisos commissions.view / configure / approve
    // =========================================================================
    console.log('[M4-PREV] Probando separación de permisos commissions.view / commissions.configure / commissions.approve...');
    assert.strictEqual((await requestJson(baseUrl, 'GET', '/api/commissions', { token: tokCommView })).status, 200);
    assert.strictEqual((await requestJson(baseUrl, 'POST', '/api/commissions/categories', { token: tokCommView, body: { nombre: 'Denegada', porcentaje: 10 } })).status, 403);
    assert.strictEqual((await requestJson(baseUrl, 'POST', '/api/commissions/payout', { token: tokCommView, body: { employee_id: empId, commission_ids: [1] } })).status, 403);

    // commissions.configure CAN create category, CANNOT payout (403)
    const cfgCreateCat = await requestJson(baseUrl, 'POST', '/api/commissions/categories', {
      token: tokCommCfg,
      body: { nombre: 'Cabello M5', porcentaje: 20, tipo: 'Porcentaje', estado: 'Activa' },
    });
    assert.strictEqual(cfgCreateCat.status, 200, `commissions.configure must allow POST /categories: ${cfgCreateCat.text}`);
    assert.strictEqual((await requestJson(baseUrl, 'POST', '/api/commissions/payout', { token: tokCommCfg, body: { employee_id: empId, commission_ids: [1] } })).status, 403);

    // commissions.approve CANNOT create category (403), CAN call /payout (reaches business validation, not 403)
    assert.strictEqual((await requestJson(baseUrl, 'POST', '/api/commissions/categories', { token: tokCommApp, body: { nombre: 'NoConfig', porcentaje: 10 } })).status, 403);
    const appPayoutCheck = await requestJson(baseUrl, 'POST', '/api/commissions/payout', { token: tokCommApp, body: { employee_id: empId, commission_ids: [999999] } });
    assert.strictEqual(appPayoutCheck.status, 409, `commissions.approve should pass RBAC and reach 409 business check, got ${appPayoutCheck.status}`);
    console.log('  ✅ [PASS] M4-PREV: Permisos commissions.view / commissions.configure / commissions.approve estrictamente separados.');

    // Seed extra categories (Retail 0%, Inactiva, and Tenant B category)
    await requestJson(baseUrl, 'POST', '/api/commissions/categories', { token: tokOwnerA, body: { nombre: 'Retail M5', porcentaje: 0, tipo: 'Porcentaje', estado: 'Activa' } });
    await requestJson(baseUrl, 'POST', '/api/commissions/categories', { token: tokOwnerA, body: { nombre: 'Inactiva M5', porcentaje: 10, tipo: 'Porcentaje', estado: 'Inactiva' } });
    await requestJson(baseUrl, 'POST', '/api/commissions/categories', { token: tokOwnerB, body: { nombre: 'Cat B M5', porcentaje: 20, tipo: 'Porcentaje', estado: 'Activa' } });

    const catsA = (await requestJson(baseUrl, 'GET', '/api/commissions/categories', { token: tokOwnerA })).body;
    const catsB = (await requestJson(baseUrl, 'GET', '/api/commissions/categories', { token: tokOwnerB })).body;
    const catCabello = catsA.find((c) => c.nombre === 'Cabello M5');
    const catRetail = catsA.find((c) => c.nombre === 'Retail M5');
    const catInactiva = catsA.find((c) => c.nombre === 'Inactiva M5');
    const catB = catsB.find((c) => c.nombre === 'Cat B M5');

    // =========================================================================
    // M5-C1: Catálogo CRUD, Validaciones, Categorías Inactivas, Legacy & Archivo
    // =========================================================================
    console.log('[M5-C1] Probando CRUD de Catálogo, validaciones, legacy, archivo/reactivación y borrado con/sin historial...');

    // Invalid inputs -> 400
    assert.strictEqual((await requestJson(baseUrl, 'POST', '/api/services', { token: tokOwnerA, body: { nombre: 'Negativo', precio: -50, commission_category_id: catCabello.id } })).status, 400);
    assert.strictEqual((await requestJson(baseUrl, 'POST', '/api/services', { token: tokOwnerA, body: { nombre: 'TextoPrecio', precio: 'abc', commission_category_id: catCabello.id } })).status, 400);
    assert.strictEqual((await requestJson(baseUrl, 'POST', '/api/services', { token: tokOwnerA, body: { nombre: 'ConCatInactiva', precio: 100, commission_category_id: catInactiva.id } })).status, 400);
    assert.strictEqual((await requestJson(baseUrl, 'POST', '/api/services', { token: tokOwnerA, body: { nombre: 'ConCatAjena', precio: 100, commission_category_id: catB.id } })).status, 400);
    assert.strictEqual((await requestJson(baseUrl, 'DELETE', '/api/services/not-a-uuid', { token: tokOwnerA })).status, 404);

    // Price = 0 allowed
    const srvZeroPrice = await requestJson(baseUrl, 'POST', '/api/services', {
      token: tokOwnerA,
      body: { nombre: 'Diagnóstico Cortesía M5', precio: 0, commission_category_id: catCabello.id, item_type: 'SERVICIO', aplica_itbis: 0, tax_mode: 'exempt' },
    });
    assert.strictEqual(srvZeroPrice.status, 201, `Price 0 must be allowed: ${srvZeroPrice.text}`);

    // Create 4 fiscal items + 1 physical product with SKU
    const srvExc = await requestJson(baseUrl, 'POST', '/api/services', {
      token: tokOwnerA,
      body: { nombre: 'Alisado Exc M5', precio: 1000, commission_category_id: catCabello.id, item_type: 'SERVICIO', aplica_itbis: 1, tax_rate: 18, tax_mode: 'exclusive', comision_valor: 20 },
    });
    const srvInc = await requestJson(baseUrl, 'POST', '/api/services', {
      token: tokOwnerA,
      body: { nombre: 'Tinte Inc M5', precio: 1180, commission_category_id: catCabello.id, item_type: 'SERVICIO', aplica_itbis: 1, tax_rate: 18, tax_mode: 'inclusive', comision_valor: 20 },
    });
    const srvExempt = await requestJson(baseUrl, 'POST', '/api/services', {
      token: tokOwnerA,
      body: { nombre: 'Lavado Exento M5', precio: 500, commission_category_id: catCabello.id, item_type: 'SERVICIO', aplica_itbis: 0, tax_rate: 0, tax_mode: 'exempt', comision_valor: 20 },
    });
    const srvZeroTax = await requestJson(baseUrl, 'POST', '/api/services', {
      token: tokOwnerA,
      body: { nombre: 'Tratamiento Tasa 0 M5', precio: 300, commission_category_id: catCabello.id, item_type: 'SERVICIO', aplica_itbis: 1, tax_rate: 0, tax_mode: 'zero', comision_valor: 20 },
    });
    const prodPhys = await requestJson(baseUrl, 'POST', '/api/services', {
      token: tokOwnerA,
      body: { nombre: 'Aceite Argán M5', sku: `SKU-M5-${ts}`, precio: 750, costo: 350, commission_category_id: catRetail.id, item_type: 'PRODUCTO', track_stock: true, aplica_itbis: 1, tax_rate: 18, tax_mode: 'exclusive', comision_valor: 0 },
    });
    for (const r of [srvExc, srvInc, srvExempt, srvZeroTax, prodPhys]) {
      assert.strictEqual(r.status, 201, `Create catalog item failed: ${r.text}`);
    }

    // Duplicate SKU rejected
    const dupSku = await requestJson(baseUrl, 'POST', '/api/services', {
      token: tokOwnerA,
      body: { nombre: 'Otro Producto SKU Dup', sku: `SKU-M5-${ts}`, precio: 500, commission_category_id: catRetail.id, item_type: 'PRODUCTO' },
    });
    assert.strictEqual(dupSku.status, 400);
    assert.strictEqual(dupSku.body.code, 'UNIQUE_SKU_VIOLATION');

    // Legacy synthetic row (NULL commission_category_id / legacy 'General' category) normalized cleanly on GET
    const legacyId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO services (id, tenant_id, name, nombre, categoria, precio, price, activo, is_active, commission_category_id)
       VALUES (?, ?, 'Servicio Legacy M5', 'Servicio Legacy M5', 'General', 450, 450, 1, true, NULL)`,
      [legacyId, tidA]
    );
    const listAll = (await requestJson(baseUrl, 'GET', '/api/services', { token: tokOwnerA })).body;
    const foundLegacy = listAll.find((s) => s.id === legacyId);
    assert.ok(foundLegacy && foundLegacy.item_type === 'SERVICIO' && foundLegacy.precio === 450, 'Legacy service must hydrate cleanly');

    // Archive and reactivate srvZeroPrice, then hard-delete (no history)
    assert.strictEqual((await requestJson(baseUrl, 'PATCH', `/api/services/${srvZeroPrice.body.id}/toggle-status`, { token: tokOwnerA })).status, 200);
    const afterArch = (await requestJson(baseUrl, 'GET', `/api/services/${srvZeroPrice.body.id}`, { token: tokOwnerA })).body;
    assert.strictEqual(Number(afterArch.activo), 0);
    assert.strictEqual((await requestJson(baseUrl, 'PATCH', `/api/services/${srvZeroPrice.body.id}/toggle-status`, { token: tokOwnerA })).status, 200);
    const delUnused = await requestJson(baseUrl, 'DELETE', `/api/services/${srvZeroPrice.body.id}`, { token: tokOwnerA });
    assert.strictEqual(delUnused.status, 200);
    assert.strictEqual(delUnused.body.archived, false);
    console.log('  ✅ [PASS] M5-C1: CRUD, validaciones (precio negativo/SKU/categoría inactiva), legacy, archivo y borrado sin historial.');

    // =========================================================================
    // M5-C2 & M5-C3: Precios/ITBIS/Descuentos/Qty>1 + Inventario + Archivado + Inmutabilidad
    // =========================================================================
    console.log('[M5-C2 + M5-C3] Probando impuestos/descuentos/qty>1, stock 0, producto archivado e inmutabilidad de facturas...');

    // Product with 0 stock -> 400 INSUFFICIENT_STOCK
    const [locIns] = await pool.query(
      `INSERT INTO inventory_locations (tenant_id, salon_id, name, code, is_default, is_active) VALUES (?, ?, 'Principal M5', 'MAIN', TRUE, TRUE) RETURNING id`,
      [tidA, bA1]
    );
    const locId = locIns[0].id;
    await pool.query(
      `INSERT INTO inventory_stock (tenant_id, product_id, location_id, quantity) VALUES (?, ?, ?, 0)`,
      [tidA, prodPhys.body.id, locId]
    );
    const zeroStockRes = await requestJson(baseUrl, 'POST', `/api/visits/${crypto.randomUUID()}/checkout`, {
      token: tokOwnerA,
      body: {
        client_name: 'Clienta Stock 0', salon_id: bA1, cash_register_id: cashRegisterId, metodo_pago: 'Efectivo', monto_recibido: 1000,
        items_detail: [{ id: prodPhys.body.id, product_id: prodPhys.body.id, nombre: 'Aceite Argán M5', precio: 750, precioBase: 750, precioAplicado: 750, cantidad: 1, tipo_item: 'PRODUCTO', is_product: true, track_stock: true }],
      },
    });
    assert.strictEqual(zeroStockRes.status, 400);
    assert.strictEqual(zeroStockRes.body.code, 'INSUFFICIENT_STOCK');

    // Add 5 units to stock, verify product appears in Inventory with SAME canonical UUID
    await pool.query(`UPDATE inventory_stock SET quantity = 5 WHERE tenant_id = ? AND product_id = ? AND location_id = ?`, [tidA, prodPhys.body.id, locId]);
    const invCatalog = (await requestJson(baseUrl, 'GET', `/api/services?item_type=PRODUCTO&salon_id=${bA1}`, { token: tokOwnerA })).body;
    const prodInInv = invCatalog.find((p) => p.id === prodPhys.body.id);
    assert.ok(prodInInv && prodInInv.current_stock === 5, 'Product must share canonical ID and stock=5');

    // Archive srvZeroTax -> attempting to sell archived item MUST fail with 400 ITEM_ARCHIVED
    await requestJson(baseUrl, 'PATCH', `/api/services/${srvZeroTax.body.id}/toggle-status`, { token: tokOwnerA });
    const archivedSale = await requestJson(baseUrl, 'POST', `/api/visits/${crypto.randomUUID()}/checkout`, {
      token: tokOwnerA,
      body: {
        client_name: 'Clienta Archivado', salon_id: bA1, cash_register_id: cashRegisterId, metodo_pago: 'Efectivo', monto_recibido: 500,
        items_detail: [{ id: srvZeroTax.body.id, nombre: 'Tratamiento Tasa 0 M5', precio: 300, precioBase: 300, precioAplicado: 300, cantidad: 1 }],
      },
    });
    assert.strictEqual(archivedSale.status, 400, `Archived item sale must be rejected with 400, got ${archivedSale.status}`);
    assert.strictEqual(archivedSale.body.code, 'ITEM_ARCHIVED');
    // Reactivate srvZeroTax
    await requestJson(baseUrl, 'PATCH', `/api/services/${srvZeroTax.body.id}/toggle-status`, { token: tokOwnerA });

    // Full fiscal checkout:
    // 1) Alisado Exc M5: 1000 x 2 = 2000, 10% disc = 200 -> net 1800, ITBIS 18% exc = 324.00, total = 2124.00
    // 2) Tinte Inc M5: 1180 x 1 -> base 1000, ITBIS 18% inc = 180.00, total = 1180.00
    // 3) Lavado Exento M5: 500 x 1 -> ITBIS 0, total = 500.00
    // 4) Tratamiento Tasa 0 M5: 300 x 1 -> ITBIS 0, total = 300.00
    // 5) Aceite Argán M5 (PRODUCTO, 0% comm): 750 x 1 -> ITBIS 18% exc = 135.00, total = 885.00
    // Expected ITBIS = 324 + 180 + 135 = 639.00 (63900c), Total = 2124 + 1180 + 500 + 300 + 885 = 4989.00
    const visitId = crypto.randomUUID();
    const saleRes = await requestJson(baseUrl, 'POST', `/api/visits/${visitId}/checkout`, {
      token: tokOwnerA,
      body: {
        client_name: 'Clienta Fiscal M5', salon_id: bA1, cash_register_id: cashRegisterId, metodo_pago: 'Efectivo', monto_recibido: 5000,
        items_detail: [
          { id: srvExc.body.id, nombre: 'Alisado Exc M5', categoria: 'Cabello M5', precio: 1000, precioBase: 1000, precioAplicado: 1000, descuentoPercent: 10, cantidad: 2, empleado_id: empId, empleado_nombre: 'Estilista M5', aplica_itbis: 1, tax_rate: 18, tax_mode: 'exclusive' },
          { id: srvInc.body.id, nombre: 'Tinte Inc M5', categoria: 'Cabello M5', precio: 1180, precioBase: 1180, precioAplicado: 1180, cantidad: 1, empleado_id: empId, empleado_nombre: 'Estilista M5', aplica_itbis: 1, tax_rate: 18, tax_mode: 'inclusive' },
          { id: srvExempt.body.id, nombre: 'Lavado Exento M5', categoria: 'Cabello M5', precio: 500, precioBase: 500, precioAplicado: 500, cantidad: 1, empleado_id: empId, empleado_nombre: 'Estilista M5', aplica_itbis: 0, tax_rate: 0, tax_mode: 'exempt' },
          { id: srvZeroTax.body.id, nombre: 'Tratamiento Tasa 0 M5', categoria: 'Cabello M5', precio: 300, precioBase: 300, precioAplicado: 300, cantidad: 1, empleado_id: empId, empleado_nombre: 'Estilista M5', aplica_itbis: 1, tax_rate: 0, tax_mode: 'zero' },
          { id: prodPhys.body.id, product_id: prodPhys.body.id, nombre: 'Aceite Argán M5', categoria: 'Retail M5', precio: 750, precioBase: 750, precioAplicado: 750, cantidad: 1, tipo_item: 'PRODUCTO', is_product: true, track_stock: true, empleado_id: empId, empleado_nombre: 'Estilista M5', aplica_itbis: 1, tax_rate: 18, tax_mode: 'exclusive' },
        ],
      },
    });
    assert.strictEqual(saleRes.status, 200, `Fiscal checkout failed: ${saleRes.text}`);

    const [vRow] = await pool.query(`SELECT total, itbis, itbis_cents FROM visits WHERE id = ? AND tenant_id = ?`, [visitId, tidA]);
    assert.strictEqual(Number(vRow[0].itbis), 639, `Expected ITBIS=639, got ${vRow[0].itbis}`);
    assert.strictEqual(Number(vRow[0].itbis_cents), 63900);
    assert.strictEqual(Number(vRow[0].total), 4989, `Expected Total=4989, got ${vRow[0].total}`);

    // Product stock deducted 5 -> 4; Services did NOT require stock
    const [stAfter] = await pool.query(`SELECT quantity FROM inventory_stock WHERE tenant_id = ? AND product_id = ? AND location_id = ?`, [tidA, prodPhys.body.id, locId]);
    assert.strictEqual(Number(stAfter[0].quantity), 4);

    // Product 0% commission stays 0.00
    const [prodComm] = await pool.query(`SELECT monto_comision FROM employee_commissions_log WHERE tenant_id = ? AND visit_id = ? AND service_name = 'Aceite Argán M5'`, [tidA, visitId]);
    assert.strictEqual(Number(prodComm[0].monto_comision), 0);

    // Editing catalog price AFTER invoice MUST NOT alter historical invoice
    await requestJson(baseUrl, 'PUT', `/api/services/${srvExc.body.id}`, {
      token: tokOwnerA,
      body: { nombre: 'Alisado Exc M5', precio: 2500, commission_category_id: catCabello.id, aplica_itbis: 1, tax_rate: 18, tax_mode: 'exclusive' },
    });
    const [vAfterEdit] = await pool.query(`SELECT total, itbis FROM visits WHERE id = ? AND tenant_id = ?`, [visitId, tidA]);
    assert.strictEqual(Number(vAfterEdit[0].total), 4989, 'Historical invoice total MUST NOT change after catalog edit');

    // Deleting service WITH sales history MUST archive instead of hard-delete
    const delWithHist = await requestJson(baseUrl, 'DELETE', `/api/services/${srvExc.body.id}`, { token: tokOwnerA });
    assert.strictEqual(delWithHist.status, 200);
    assert.strictEqual(delWithHist.body.archived, true, 'Service with sales history must be archived, not hard-deleted');

    // Fallback 15% label check on legacy service without category/rule
    const vFallbackId = crypto.randomUUID();
    await pool.query(`UPDATE services SET comision_valor = NULL WHERE id = ?`, [legacyId]);
    await requestJson(baseUrl, 'POST', `/api/visits/${vFallbackId}/checkout`, {
      token: tokOwnerA,
      body: {
        client_name: 'Clienta Fallback', salon_id: bA1, cash_register_id: cashRegisterId, metodo_pago: 'Efectivo', monto_recibido: 500,
        items_detail: [{ id: legacyId, nombre: 'Servicio Legacy M5', precio: 450, precioBase: 450, precioAplicado: 450, cantidad: 1, empleado_id: empId, empleado_nombre: 'Estilista M5' }],
      },
    });
    const [fbComm] = await pool.query(`SELECT monto_comision, rule_applied_description FROM employee_commissions_log WHERE tenant_id = ? AND visit_id = ?`, [tidA, vFallbackId]);
    assert.strictEqual(Number(fbComm[0].monto_comision), 67.5);
    assert.ok(/Fallback temporal \(15%\)/i.test(fbComm[0].rule_applied_description), `Expected visible fallback label, got ${fbComm[0].rule_applied_description}`);
    console.log('  ✅ [PASS] M5-C2 + M5-C3: ITBIS/descuentos/qty>1 exactos (RD$639 ITBIS / RD$4989 total), stock 5→4, archivado 400, histórico inmutable, fallback 15% visible.');

    // =========================================================================
    // M5-C4: Bulk Import con errores por fila + RBAC Catálogo + Cross-Tenant
    // =========================================================================
    console.log('[M5-C4] Probando bulk-import con errores por fila, RBAC (services.view vs manage) y aislamiento cross-tenant...');
    const bulkRes = await requestJson(baseUrl, 'POST', '/api/services/bulk-import', {
      token: tokOwnerA,
      body: {
        items: [
          { nombre: 'Importado Válido M5', categoria: 'Cabello M5', precio: 600, sku: `IMP-OK-${ts}` },
          { nombre: '', categoria: 'Cabello M5', precio: 500 },
          { nombre: 'Importado Precio Neg', categoria: 'Cabello M5', precio: -20 },
          { nombre: 'Importado Cat Inactiva', categoria: 'Inactiva M5', precio: 500 },
          { nombre: 'Importado SKU Dup', categoria: 'Cabello M5', precio: 500, sku: `SKU-M5-${ts}` },
        ],
      },
    });
    assert.strictEqual(bulkRes.status, 200, `Bulk import failed: ${bulkRes.text}`);
    assert.strictEqual(bulkRes.body.imported, 1);
    assert.strictEqual(bulkRes.body.skipped, 4);
    assert.strictEqual(bulkRes.body.errors.length, 4);

    // RBAC Catalog: services.view -> GET 200, POST/PUT/DELETE 403
    assert.strictEqual((await requestJson(baseUrl, 'GET', '/api/services', { token: tokCatView })).status, 200);
    assert.strictEqual((await requestJson(baseUrl, 'POST', '/api/services', { token: tokCatView, body: { nombre: 'Bloqueado', precio: 100, commission_category_id: catCabello.id } })).status, 403);
    assert.strictEqual((await requestJson(baseUrl, 'DELETE', `/api/services/${srvExempt.body.id}`, { token: tokCatView })).status, 403);

    // Cross-tenant: Tenant B cannot GET/PUT/DELETE Tenant A's catalog item -> 404
    assert.strictEqual((await requestJson(baseUrl, 'GET', `/api/services/${srvExempt.body.id}`, { token: tokOwnerB })).status, 404);
    assert.strictEqual((await requestJson(baseUrl, 'PUT', `/api/services/${srvExempt.body.id}`, { token: tokOwnerB, body: { nombre: 'Hack', precio: 1, commission_category_id: catB.id } })).status, 404);
    assert.strictEqual((await requestJson(baseUrl, 'DELETE', `/api/services/${srvExempt.body.id}`, { token: tokOwnerB })).status, 404);
    console.log('  ✅ [PASS] M5-C4: Bulk-import reporta 4 errores por fila, RBAC 200/403 y aislamiento cross-tenant 404.');

    console.log('\n🎉 SUITE DE ACEPTACIÓN MÓDULO 5 + PREVIO M4 APROBADA 100%');
  } finally {
    server.close();
    await pool.query('DELETE FROM audit_logs WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM employee_commissions_log WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM commission_payouts WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM commission_scheme_rules WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM commission_schemes WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM commission_categories WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM cash_movements WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM cash_registers WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM visits WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM inventory_movements WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM inventory_stock WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM inventory_locations WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM services WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM staff_records WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM users WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM roles WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM salons WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM branches WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.end();
  }
}

runTests().catch((err) => {
  console.error('❌ MÓDULO 5 ACCEPTANCE FAILED:', err);
  process.exit(1);
});
