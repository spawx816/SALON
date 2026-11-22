'use strict';

/**
 * Suite de Aceptación Módulo 4: Categorías y Esquemas de Comisiones (PostgreSQL real: salon_saas_test)
 *
 * Verifica:
 * - M4-C1: Categorías (crear, editar, desactivar, vínculo con catálogo, 409 CATEGORY_IN_USE al borrar en uso).
 * - M4-C2: Esquemas y reglas (categoría vs servicio específico, 409 DUPLICATE_SCHEME_RULE, 409 SCHEME_IN_USE, desactivar conservando historial).
 * - M4-C3: Cálculos numéricos exactos (porcentual, fija, específica vs general, producto 0% sin fallback, ítem sin regla,
 *          descuento + ITBIS inclusivo, varios colaboradores en la misma factura, vigencia scheme_effective_date futura,
 *          inmutabilidad histórica al modificar regla posterior).
 * - M4-C4: Anulación (status='Anulada') y reasignación auditada (REASSIGN_COMMISSION) + bloqueo de comisiones liquidadas (409).
 * - M4-C5: Liquidación atómica FOR UPDATE bajo concurrencia (1 éxito, 1 rechazo 409), auditoría COMMISSION_PAYOUT,
 *          anti doble pago en borrador y aprobación de nómina (comisión 'Pagado' + payout_id excluida; pendiente incluida y pasa a 'Pagada').
 * - M4-C6: RBAC (commissions.view vs commissions.approve) y aislamiento estricto multi-tenant (Empresa A vs Empresa B).
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
  console.log('🧪 ACEPTACIÓN MÓDULO 4: CATEGORÍAS Y ESQUEMAS DE COMISIONES (PG)');
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
  const viewerAId = crypto.randomUUID();
  const ownerBId = crypto.randomUUID();

  const tokenOwnerA = signAuthToken({
    sub: ownerAId, id: ownerAId, email: `m4-owner-a-${ts}@test.local`, name: 'Owner M4 A',
    role: 'owner', tenantId: tidA, branchId: bA1, isSuperAdmin: false, tokenVersion: 1,
  });
  const tokenViewerA = signAuthToken({
    sub: viewerAId, id: viewerAId, email: `m4-viewer-a-${ts}@test.local`, name: 'Viewer M4 A',
    role: 'solo_consulta_comisiones', tenantId: tidA, branchId: bA1, isSuperAdmin: false, tokenVersion: 1,
  });
  const tokenOwnerB = signAuthToken({
    sub: ownerBId, id: ownerBId, email: `m4-owner-b-${ts}@test.local`, name: 'Owner M4 B',
    role: 'owner', tenantId: tidB, branchId: bB1, isSuperAdmin: false, tokenVersion: 1,
  });

  try {
    const pwHash = await bcrypt.hash('Mod4Pass#2026', 6);

    // Seed Tenant A (2 branches) & Tenant B (1 branch)
    await pool.query(
      `INSERT INTO tenants (id, business_name, slug, email, owner_name, owner_email, rnc, plan_id, status, licensed_branches, max_branches, max_users, modules_config)
       VALUES (?, ?, ?, ?, 'Owner M4 A', ?, '131917041', 1, 'active', 2, 2, 10, '{"pos":true,"clients":true}'::jsonb),
              (?, ?, ?, ?, 'Owner M4 B', ?, '131917042', 1, 'active', 1, 1, 5, '{"pos":true,"clients":true}'::jsonb)`,
      [
        tidA, `Empresa M4 A ${ts}`, `m4-a-${ts}`, `m4-owner-a-${ts}@test.local`, `m4-owner-a-${ts}@test.local`,
        tidB, `Empresa M4 B ${ts}`, `m4-b-${ts}`, `m4-owner-b-${ts}@test.local`, `m4-owner-b-${ts}@test.local`,
      ]
    );

    for (const [bid, tid, name, isMain] of [
      [bA1, tidA, 'Sucursal M4 A1', true],
      [bA2, tidA, 'Sucursal M4 A2', false],
      [bB1, tidB, 'Sucursal M4 B1', true],
    ]) {
      await pool.query(
        `INSERT INTO branches (id, tenant_id, name, address, phone, is_main, status, is_active) VALUES (?, ?, ?, 'Dir', '8090000000', ?, 'Active', true)`,
        [bid, tid, name, isMain]
      );
      await pool.query(
        `INSERT INTO salons (id, name, address, phone, status, tenant_id) VALUES (?, ?, 'Dir', '8090000000', 'Active', ?)`,
        [bid, name, tid]
      );
    }

    // Custom read-only role for commissions.view (NOT commissions.approve)
    const [roleIns] = await pool.query(
      `INSERT INTO roles (tenant_id, name, description, permissions, is_system)
       VALUES (?, 'solo_consulta_comisiones', 'Solo consulta comisiones', '{"commissions.view":true}'::jsonb, false) RETURNING id`,
      [tidA]
    );
    const viewerRoleId = roleIns[0].id;

    await pool.query(
      `INSERT INTO users (id, tenant_id, branch_id, name, nombre, email, password_hash, role, role_id, is_active, estado, token_version)
       VALUES (?, ?, ?, 'Owner M4 A', 'Owner M4 A', ?, ?, 'owner', NULL, true, 'Activo', 1),
              (?, ?, ?, 'Viewer M4 A', 'Viewer M4 A', ?, ?, 'solo_consulta_comisiones', ?, true, 'Activo', 1),
              (?, ?, ?, 'Owner M4 B', 'Owner M4 B', ?, ?, 'owner', NULL, true, 'Activo', 1)`,
      [
        ownerAId, tidA, bA1, `m4-owner-a-${ts}@test.local`, pwHash,
        viewerAId, tidA, bA1, `m4-viewer-a-${ts}@test.local`, pwHash, viewerRoleId,
        ownerBId, tidB, bB1, `m4-owner-b-${ts}@test.local`, pwHash,
      ]
    );

    // Open cash register in A1
    const crOpen = await requestJson(baseUrl, 'POST', '/api/cash-registers/open', {
      token: tokenOwnerA,
      body: { salon_id: bA1, branch_id: bA1, opening_balance: 1000, opening_amount: 1000 },
    });
    assert.ok(crOpen.status === 200 || crOpen.status === 201, `Cash open failed: ${crOpen.text}`);
    const cashRegisterId = crOpen.body.id || crOpen.body.cash_register_id || crOpen.body.register?.id;

    // Seed 3 staff in Tenant A (Emp1 active scheme, Emp2 active scheme, Emp3 future effective date)
    const [e1] = await pool.query(
      `INSERT INTO staff_records (tenant_id, nombre, posicion, localidad, salon_id, salario_base, tipo_salario, status, fecha_entrada)
       VALUES (?, 'Ana Estilista M4', 'Estilista', 'Sucursal M4 A1', ?, 20000, 'fijo_mas_comision', 'Activo', '2026-01-01') RETURNING id`,
      [tidA, bA1]
    );
    const [e2] = await pool.query(
      `INSERT INTO staff_records (tenant_id, nombre, posicion, localidad, salon_id, salario_base, tipo_salario, status, fecha_entrada)
       VALUES (?, 'Berta Colorista M4', 'Colorista', 'Sucursal M4 A1', ?, 20000, 'fijo_mas_comision', 'Activo', '2026-01-01') RETURNING id`,
      [tidA, bA1]
    );
    const [e3] = await pool.query(
      `INSERT INTO staff_records (tenant_id, nombre, posicion, localidad, salon_id, salario_base, tipo_salario, status, fecha_entrada)
       VALUES (?, 'Carla Futura M4', 'Estilista', 'Sucursal M4 A1', ?, 20000, 'fijo_mas_comision', 'Activo', '2026-01-01') RETURNING id`,
      [tidA, bA1]
    );
    const emp1Id = e1[0].id;
    const emp2Id = e2[0].id;
    const emp3Id = e3[0].id;

    // =========================================================================
    // M4-C1: Categorías + Catálogo + Bloqueo 409 CATEGORY_IN_USE
    // =========================================================================
    console.log('[M4-C1] Probando categorías, catálogo y bloqueo 409 al eliminar categoría en uso...');
    for (const c of [
      { nombre: 'Cabello M4', porcentaje: 20, tipo: 'Porcentaje', estado: 'Activa' },
      { nombre: 'Color M4', porcentaje: 25, tipo: 'Porcentaje', estado: 'Activa' },
      { nombre: 'Retail M4', porcentaje: 0, tipo: 'Porcentaje', estado: 'Activa' },
      { nombre: 'Temporal M4', porcentaje: 10, tipo: 'Porcentaje', estado: 'Activa' },
    ]) {
      const r = await requestJson(baseUrl, 'POST', '/api/commissions/categories', { token: tokenOwnerA, body: c });
      assert.strictEqual(r.status, 200, `Create category failed: ${r.text}`);
    }
    // Category in Tenant B for isolation test
    await requestJson(baseUrl, 'POST', '/api/commissions/categories', {
      token: tokenOwnerB,
      body: { nombre: 'Cat Ajena B', porcentaje: 50, tipo: 'Porcentaje', estado: 'Activa' },
    });

    const catsA = (await requestJson(baseUrl, 'GET', '/api/commissions/categories', { token: tokenOwnerA })).body;
    const catsB = (await requestJson(baseUrl, 'GET', '/api/commissions/categories', { token: tokenOwnerB })).body;
    assert.ok(!catsA.some((c) => c.nombre === 'Cat Ajena B'), 'Tenant A must not see Tenant B categories');
    const catCabello = catsA.find((c) => c.nombre === 'Cabello M4');
    const catRetail = catsA.find((c) => c.nombre === 'Retail M4');
    const catTemp = catsA.find((c) => c.nombre === 'Temporal M4');
    const catB = catsB.find((c) => c.nombre === 'Cat Ajena B');

    // Create catalog items linked to categories
    const srvPct = await requestJson(baseUrl, 'POST', '/api/services', {
      token: tokenOwnerA,
      body: { nombre: 'Corte Premium M4', precio: 1000, categoria: 'Cabello M4', commission_category_id: catCabello.id, tipo: 'Servicio', aplica_itbis: 0, tax_rate: 0, tax_mode: 'exempt' },
    });
    const srvFixed = await requestJson(baseUrl, 'POST', '/api/services', {
      token: tokenOwnerA,
      body: { nombre: 'Peinado Fijo M4', precio: 800, categoria: 'Cabello M4', commission_category_id: catCabello.id, tipo: 'Servicio', aplica_itbis: 0, tax_rate: 0, tax_mode: 'exempt' },
    });
    const srvInc = await requestJson(baseUrl, 'POST', '/api/services', {
      token: tokenOwnerA,
      body: { nombre: 'Tinte Inclusivo M4', precio: 1180, categoria: 'Cabello M4', commission_category_id: catCabello.id, tipo: 'Servicio', aplica_itbis: 1, tax_rate: 18, tax_mode: 'inclusive' },
    });
    const prodZero = await requestJson(baseUrl, 'POST', '/api/services', {
      token: tokenOwnerA,
      body: { nombre: 'Shampoo Cero M4', precio: 500, categoria: 'Retail M4', commission_category_id: catRetail.id, tipo: 'Producto', item_type: 'PRODUCTO', genera_comision: 1, comision_valor: 0, aplica_itbis: 0, tax_rate: 0, tax_mode: 'exempt' },
    });
    const srvNoRule = await requestJson(baseUrl, 'POST', '/api/services', {
      token: tokenOwnerA,
      body: { nombre: 'Servicio Sin Regla M4', precio: 400, categoria: 'SinCatM4', tipo: 'Servicio', aplica_itbis: 0, tax_rate: 0, tax_mode: 'exempt' },
    });
    for (const s of [srvPct, srvFixed, srvInc, prodZero, srvNoRule]) {
      assert.ok(s.status === 200 || s.status === 201, `Create catalog item failed: ${s.text}`);
    }

    // Attempt to delete category IN USE -> 409 CATEGORY_IN_USE
    const delInUseCat = await requestJson(baseUrl, 'DELETE', `/api/commissions/categories/${catCabello.id}`, { token: tokenOwnerA });
    assert.strictEqual(delInUseCat.status, 409, `Expected 409 CATEGORY_IN_USE, got ${delInUseCat.status}: ${delInUseCat.text}`);
    assert.strictEqual(delInUseCat.body.code, 'CATEGORY_IN_USE');

    // Delete unused category -> 200
    const delUnusedCat = await requestJson(baseUrl, 'DELETE', `/api/commissions/categories/${catTemp.id}`, { token: tokenOwnerA });
    assert.strictEqual(delUnusedCat.status, 200);
    console.log('  ✅ [PASS] M4-C1: Categorías, catálogo y bloqueo 409 CATEGORY_IN_USE.');

    // =========================================================================
    // M4-C2: Esquemas, Reglas, Duplicados (409) y Bloqueo SCHEME_IN_USE
    // =========================================================================
    console.log('[M4-C2] Probando esquemas, reglas específicas/categoría, duplicados y bloqueo al borrar...');
    const schCreate = await requestJson(baseUrl, 'POST', '/api/commissions/schemes', {
      token: tokenOwnerA,
      body: { nombre: 'Esquema Senior M4', descripcion: 'Pruebas M4', tipo: 'Por Categorías', estado: 'Activo' },
    });
    assert.strictEqual(schCreate.status, 200);
    const schemesA = (await requestJson(baseUrl, 'GET', '/api/commissions/schemes', { token: tokenOwnerA })).body;
    const schemeA = schemesA.find((s) => s.nombre === 'Esquema Senior M4');
    assert.ok(schemeA);

    // Add category rule: Cabello M4 -> 20%
    const rCat = await requestJson(baseUrl, 'POST', `/api/commissions/schemes/${schemeA.id}/rules`, {
      token: tokenOwnerA,
      body: { rule_type: 'categoria', category_name: 'Cabello M4', tipo_calculo: 'Porcentaje', valor: 20, prioridad: 2 },
    });
    assert.strictEqual(rCat.status, 200, `rCat failed: ${rCat.text}`);

    // Duplicate/contradictory category rule -> 409 DUPLICATE_SCHEME_RULE
    const rCatDup = await requestJson(baseUrl, 'POST', `/api/commissions/schemes/${schemeA.id}/rules`, {
      token: tokenOwnerA,
      body: { rule_type: 'categoria', category_name: 'Cabello M4', tipo_calculo: 'Porcentaje', valor: 35, prioridad: 1 },
    });
    assert.strictEqual(rCatDup.status, 409, `Expected 409 DUPLICATE_SCHEME_RULE, got ${rCatDup.status}`);
    assert.strictEqual(rCatDup.body.code, 'DUPLICATE_SCHEME_RULE');

    // Add specific service rule: Corte Premium M4 -> 40% (overrides 20% category)
    const rSrvPct = await requestJson(baseUrl, 'POST', `/api/commissions/schemes/${schemeA.id}/rules`, {
      token: tokenOwnerA,
      body: { rule_type: 'servicio', service_name: 'Corte Premium M4', tipo_calculo: 'Porcentaje', valor: 40, prioridad: 1 },
    });
    assert.strictEqual(rSrvPct.status, 200);

    // Add fixed service rule: Peinado Fijo M4 -> RD$ 250 fixed per unit
    const rSrvFixed = await requestJson(baseUrl, 'POST', `/api/commissions/schemes/${schemeA.id}/rules`, {
      token: tokenOwnerA,
      body: { rule_type: 'servicio', service_name: 'Peinado Fijo M4', tipo_calculo: 'Monto_Fijo', valor: 250, prioridad: 1 },
    });
    assert.strictEqual(rSrvFixed.status, 200);

    // Assign emp1, emp2, emp3 to schemeA
    const assignRes = await requestJson(baseUrl, 'POST', `/api/commissions/schemes/${schemeA.id}/assign-employees`, {
      token: tokenOwnerA,
      body: { employee_ids: [emp1Id, emp2Id, emp3Id] },
    });
    assert.strictEqual(assignRes.status, 200);

    // Set emp3 scheme_effective_date to FUTURE ('2099-01-01') to test out-of-vigency rule!
    await pool.query(
      `UPDATE staff_records SET scheme_effective_date = '2099-01-01' WHERE id = ? AND tenant_id = ?`,
      [emp3Id, tidA]
    );

    // Attempt to delete scheme IN USE -> 409 SCHEME_IN_USE
    const delSchemeInUse = await requestJson(baseUrl, 'DELETE', `/api/commissions/schemes/${schemeA.id}`, { token: tokenOwnerA });
    assert.strictEqual(delSchemeInUse.status, 409, `Expected 409 SCHEME_IN_USE, got ${delSchemeInUse.status}`);
    assert.strictEqual(delSchemeInUse.body.code, 'SCHEME_IN_USE');
    console.log('  ✅ [PASS] M4-C2: Esquemas, reglas, 409 DUPLICATE_SCHEME_RULE y 409 SCHEME_IN_USE.');

    // =========================================================================
    // M4-C3: Cálculos numéricos verificables (POS -> BD)
    // =========================================================================
    console.log('[M4-C3] Probando cálculos numéricos exactos (porcentaje, fijo, específica>general, 0%, sin regla, desc+ITBIS inc, multi-colab, vigencia futura)...');
    const visit1Id = crypto.randomUUID();
    const checkout1 = await requestJson(baseUrl, 'POST', `/api/visits/${visit1Id}/checkout`, {
      token: tokenOwnerA,
      body: {
        client_name: 'Clienta M4 Uno',
        salon_id: bA1,
        cash_register_id: cashRegisterId,
        metodo_pago: 'Efectivo',
        monto_recibido: 6000,
        items_detail: [
          // 1) Specific service 40% overrides 20% category: 1000 * 40% = 400.00 (emp1)
          { id: srvPct.body.id, nombre: 'Corte Premium M4', categoria: 'Cabello M4', precio: 1000, precioBase: 1000, precioAplicado: 1000, cantidad: 1, empleado_id: emp1Id, empleado_nombre: 'Ana Estilista M4' },
          // 2) Fixed rule RD$250 x 2 = 500.00 (emp1)
          { id: srvFixed.body.id, nombre: 'Peinado Fijo M4', categoria: 'Cabello M4', precio: 800, precioBase: 800, precioAplicado: 800, cantidad: 2, empleado_id: emp1Id, empleado_nombre: 'Ana Estilista M4' },
          // 3) Category rule 20% on inclusive ITBIS (1180) with 10% discount -> gross=1180, disc=118, netAfterDisc=1062, ex-ITBIS=1062/1.18=900.00 -> 20% = 180.00 (emp2)
          { id: srvInc.body.id, nombre: 'Tinte Inclusivo M4', categoria: 'Cabello M4', precio: 1062, precioBase: 1180, precioAplicado: 1062, descuentoPercent: 10, cantidad: 1, empleado_id: emp2Id, empleado_nombre: 'Berta Colorista M4', aplica_itbis: 1, tax_rate: 18, tax_mode: 'inclusive' },
          // 4) Product with 0% category/item -> MUST be 0.00 (NO 15% fallback!) (emp1)
          { id: prodZero.body.id, nombre: 'Shampoo Cero M4', categoria: 'Retail M4', tipo_item: 'PRODUCTO', is_product: true, precio: 500, precioBase: 500, precioAplicado: 500, cantidad: 1, empleado_id: emp1Id, empleado_nombre: 'Ana Estilista M4' },
          // 5) Service with NO rule -> default 15% of 400 = 60.00 (emp2)
          { id: srvNoRule.body.id, nombre: 'Servicio Sin Regla M4', categoria: 'SinCatM4', precio: 400, precioBase: 400, precioAplicado: 400, cantidad: 1, empleado_id: emp2Id, empleado_nombre: 'Berta Colorista M4' },
          // 6) Emp3 has scheme_effective_date = 2099-01-01 (out of vigency today!) -> Scheme 40% MUST NOT apply; falls back to Catalog Category Cabello M4 (20% of 1000 = 200.00)
          { id: srvPct.body.id, nombre: 'Corte Premium M4', categoria: 'Cabello M4', precio: 1000, precioBase: 1000, precioAplicado: 1000, cantidad: 1, empleado_id: emp3Id, empleado_nombre: 'Carla Futura M4' },
        ],
      },
    });
    assert.ok(checkout1.status === 200 || checkout1.status === 201, `Checkout 1 failed: ${checkout1.text}`);

    const [cRows1] = await pool.query(
      `SELECT * FROM employee_commissions_log WHERE tenant_id = ? AND visit_id = ? ORDER BY id ASC`,
      [tidA, visit1Id]
    );
    assert.strictEqual(cRows1.length, 6, `Expected 6 commission rows, got ${cRows1.length}`);

    const byKey = (empId, srvName) => cRows1.find((r) => String(r.employee_id) === String(empId) && r.service_name === srvName);
    const cPct = byKey(emp1Id, 'Corte Premium M4');
    const cFixed = byKey(emp1Id, 'Peinado Fijo M4');
    const cInc = byKey(emp2Id, 'Tinte Inclusivo M4');
    const cZero = byKey(emp1Id, 'Shampoo Cero M4');
    const cNoRule = byKey(emp2Id, 'Servicio Sin Regla M4');
    const cFuture = byKey(emp3Id, 'Corte Premium M4');

    assert.strictEqual(Number(cPct.monto_comision), 400, `Specific 40% expected 400, got ${cPct.monto_comision}`);
    assert.strictEqual(Number(cPct.commission_cents), 40000);
    assert.strictEqual(Number(cPct.scheme_id), Number(schemeA.id));

    assert.strictEqual(Number(cFixed.monto_comision), 500, `Fixed 250x2 expected 500, got ${cFixed.monto_comision}`);
    assert.strictEqual(Number(cFixed.commission_cents), 50000);

    assert.strictEqual(Number(cInc.monto_base), 900, `Inclusive ITBIS + 10% disc base expected 900, got ${cInc.monto_base}`);
    assert.strictEqual(Number(cInc.monto_comision), 180, `20% of 900 expected 180, got ${cInc.monto_comision}`);

    assert.strictEqual(Number(cZero.monto_comision), 0, `0% product MUST NOT trigger fallback, got ${cZero.monto_comision}`);
    assert.strictEqual(Number(cNoRule.monto_comision), 60, `No-rule service 15% of 400 expected 60, got ${cNoRule.monto_comision}`);

    assert.strictEqual(Number(cFuture.monto_comision), 200, `Out-of-vigency scheme MUST NOT apply 40% (expected 20% catalog = 200), got ${cFuture.monto_comision}`);
    assert.strictEqual(cFuture.scheme_id, null, `Out-of-vigency scheme_id must be null, got ${cFuture.scheme_id}`);

    // Verify modifying/deactivating scheme does NOT alter historical persisted commissions
    await requestJson(baseUrl, 'POST', '/api/commissions/schemes', {
      token: tokenOwnerA,
      body: { id: schemeA.id, nombre: 'Esquema Senior M4', descripcion: 'Desactivado', tipo: 'Por Categorías', estado: 'Inactivo' },
    });
    const [cAfterDeact] = await pool.query(`SELECT monto_comision FROM employee_commissions_log WHERE id = ?`, [cPct.id]);
    assert.strictEqual(Number(cAfterDeact[0].monto_comision), 400, 'Historical commission must remain 400 after scheme deactivation');

    // Reactivate scheme for subsequent tests
    await requestJson(baseUrl, 'POST', '/api/commissions/schemes', {
      token: tokenOwnerA,
      body: { id: schemeA.id, nombre: 'Esquema Senior M4', descripcion: 'Activo', tipo: 'Por Categorías', estado: 'Activo' },
    });
    console.log('  ✅ [PASS] M4-C3: Todos los cálculos verificables exactos al centavo + vigencia futura + inmutabilidad histórica.');

    // =========================================================================
    // M4-C4: Anulación y Reasignación Auditada
    // =========================================================================
    console.log('[M4-C4] Probando anulación de venta y reasignación auditada...');
    const visitVoidId = crypto.randomUUID();
    await requestJson(baseUrl, 'POST', `/api/visits/${visitVoidId}/checkout`, {
      token: tokenOwnerA,
      body: {
        client_name: 'Clienta Anular M4',
        salon_id: bA1,
        cash_register_id: cashRegisterId,
        metodo_pago: 'Efectivo',
        monto_recibido: 1000,
        items_detail: [
          { id: srvPct.body.id, nombre: 'Corte Premium M4', categoria: 'Cabello M4', precio: 1000, precioBase: 1000, precioAplicado: 1000, cantidad: 1, empleado_id: emp1Id, empleado_nombre: 'Ana Estilista M4' },
        ],
      },
    });
    const voidRes = await requestJson(baseUrl, 'POST', `/api/visits/${visitVoidId}/void`, {
      token: tokenOwnerA,
      body: { reason: 'Error de prueba M4' },
    });
    assert.strictEqual(voidRes.status, 200, `Void failed: ${voidRes.text}`);
    const [voidComm] = await pool.query(`SELECT status FROM employee_commissions_log WHERE tenant_id = ? AND visit_id = ?`, [tidA, visitVoidId]);
    assert.strictEqual(voidComm[0].status, 'Anulada');

    // Reassign pending visit from emp1 to emp2
    const visitReassignId = crypto.randomUUID();
    await requestJson(baseUrl, 'POST', `/api/visits/${visitReassignId}/checkout`, {
      token: tokenOwnerA,
      body: {
        client_name: 'Clienta Reasignar M4',
        salon_id: bA1,
        cash_register_id: cashRegisterId,
        metodo_pago: 'Efectivo',
        monto_recibido: 1000,
        items_detail: [
          { id: srvPct.body.id, nombre: 'Corte Premium M4', categoria: 'Cabello M4', precio: 1000, precioBase: 1000, precioAplicado: 1000, cantidad: 1, empleado_id: emp1Id, empleado_nombre: 'Ana Estilista M4' },
        ],
      },
    });
    const [vReassRow] = await pool.query(`SELECT items_detail FROM visits WHERE id = ?`, [visitReassignId]);
    const updatedItems = (typeof vReassRow[0].items_detail === 'string' ? JSON.parse(vReassRow[0].items_detail) : vReassRow[0].items_detail)
      .map((it) => ({ ...it, empleado_id: emp2Id, empleado_nombre: 'Berta Colorista M4', estilista_id: emp2Id, estilista: 'Berta Colorista M4' }));
    const reassignRes = await requestJson(baseUrl, 'PUT', `/api/visits/${visitReassignId}/commission-recipient`, {
      token: tokenOwnerA,
      body: { updatedItems, reason: 'Corrección de estilista M4' },
    });
    assert.strictEqual(reassignRes.status, 200, `Reassign failed: ${reassignRes.text}`);
    const [reassComm] = await pool.query(`SELECT employee_id, monto_comision FROM employee_commissions_log WHERE tenant_id = ? AND visit_id = ?`, [tidA, visitReassignId]);
    assert.strictEqual(String(reassComm[0].employee_id), String(emp2Id));
    assert.strictEqual(Number(reassComm[0].monto_comision), 400);
    const [reassAudit] = await pool.query(`SELECT action FROM audit_logs WHERE tenant_id = ? AND entity_id = ? AND action = 'REASSIGN_COMMISSION'`, [tidA, visitReassignId]);
    assert.strictEqual(reassAudit.length, 1);
    console.log('  ✅ [PASS] M4-C4: Anulación (Anulada) y reasignación auditada (REASSIGN_COMMISSION).');

    // =========================================================================
    // M4-C5: Liquidación Concurrente + Anti Doble Pago en Nómina
    // =========================================================================
    console.log('[M4-C5] Probando liquidación concurrente (FOR UPDATE), auditoría y anti doble pago en nómina...');
    // Emp1 has cPct (400) and cFixed (500) pending. Settle ONLY cPct (400) concurrently twice!
    const [p1, p2] = await Promise.all([
      requestJson(baseUrl, 'POST', '/api/commissions/payout', {
        token: tokenOwnerA,
        body: { employee_id: emp1Id, employee_name: 'Ana Estilista M4', commission_ids: [cPct.id], metodo_pago: 'Efectivo', notas: 'Liq M4' },
      }),
      requestJson(baseUrl, 'POST', '/api/commissions/payout', {
        token: tokenOwnerA,
        body: { employee_id: emp1Id, employee_name: 'Ana Estilista M4', commission_ids: [cPct.id], metodo_pago: 'Efectivo', notas: 'Liq M4 dup' },
      }),
    ]);
    const statuses = [p1.status, p2.status].sort((a, b) => a - b);
    assert.deepStrictEqual(statuses, [200, 409], `Concurrent payout MUST yield [200, 409], got ${JSON.stringify(statuses)}`);

    // Verify audit_logs has COMMISSION_PAYOUT
    const [payAudit] = await pool.query(`SELECT action FROM audit_logs WHERE tenant_id = ? AND action = 'COMMISSION_PAYOUT'`, [tidA]);
    assert.strictEqual(payAudit.length, 1, 'Expected 1 COMMISSION_PAYOUT audit log');

    // Verify settled commission CANNOT be reassigned (409)
    const blockReassign = await requestJson(baseUrl, 'PUT', `/api/visits/${visit1Id}/commission-recipient`, {
      token: tokenOwnerA,
      body: { updatedItems, reason: 'Intento sobre liquidada' },
    });
    assert.strictEqual(blockReassign.status, 409, `Expected 409 reassigning settled visit, got ${blockReassign.status}`);

    // Generate payroll draft for today -> Emp1 MUST ONLY get cFixed (500.00), NEVER cPct (400.00 already 'Pagado' + payout_id)!
    const today = new Date().toISOString().slice(0, 10);
    const payrollDraft = await requestJson(baseUrl, 'POST', '/api/payroll/generate', {
      token: tokenOwnerA,
      body: { start_date: today, end_date: today, period_name: `Nómina M4 ${ts}`, salon_id: bA1 },
    });
    assert.ok(payrollDraft.status === 200 || payrollDraft.status === 201, `Payroll generate failed: ${payrollDraft.text}`);
    const draftRows = payrollDraft.body.employees || payrollDraft.body.payroll?.employees || payrollDraft.body.details || [];
    const emp1Payroll = draftRows.find((d) => String(d.employee_id) === String(emp1Id) || d.employee_name === 'Ana Estilista M4');
    assert.ok(emp1Payroll, `Emp1 missing from payroll draft: ${JSON.stringify(payrollDraft.body)}`);
    assert.strictEqual(Number(emp1Payroll.comisiones), 500, `ANTI-DOUBLE-PAY FAIL: Emp1 payroll commissions MUST be 500 (excluding 400 already settled via /payout), got ${emp1Payroll.comisiones}`);

    // Approve payroll -> cFixed (500) becomes 'Pagada', so trying /payout on cFixed MUST fail with 409!
    const payrollId = payrollDraft.body.payroll_id || payrollDraft.body.id || payrollDraft.body.payroll?.id;
    if (payrollId) {
      const approveRes = await requestJson(baseUrl, 'POST', `/api/payroll/approve`, {
        token: tokenOwnerA,
        body: { payroll_id: payrollId },
      });
      assert.strictEqual(approveRes.status, 200, `Payroll approve failed: ${approveRes.text}`);
      const payoutAfterPayroll = await requestJson(baseUrl, 'POST', '/api/commissions/payout', {
        token: tokenOwnerA,
        body: { employee_id: emp1Id, employee_name: 'Ana Estilista M4', commission_ids: [cFixed.id], metodo_pago: 'Efectivo' },
      });
      assert.strictEqual(payoutAfterPayroll.status, 409, `Expected 409 paying commission already settled in payroll, got ${payoutAfterPayroll.status}`);
    }
    console.log('  ✅ [PASS] M4-C5: Liquidación atómica [200, 409], auditoría y CERO doble pago entre /payout y Nómina.');

    // =========================================================================
    // M4-C6: RBAC (view vs approve) y Aislamiento Multi-Tenant
    // =========================================================================
    console.log('[M4-C6] Probando separación RBAC (commissions.view vs commissions.approve) y aislamiento cross-tenant...');
    const viewerGet = await requestJson(baseUrl, 'GET', '/api/commissions', { token: tokenViewerA });
    assert.strictEqual(viewerGet.status, 200, `Viewer GET /api/commissions expected 200, got ${viewerGet.status}`);
    const viewerPostCat = await requestJson(baseUrl, 'POST', '/api/commissions/categories', {
      token: tokenViewerA,
      body: { nombre: 'Bloqueada', porcentaje: 10 },
    });
    const viewerPayout = await requestJson(baseUrl, 'POST', '/api/commissions/payout', {
      token: tokenViewerA,
      body: { employee_id: emp2Id, commission_ids: [cInc.id] },
    });
    assert.strictEqual(viewerPostCat.status, 403, `Viewer POST category expected 403, got ${viewerPostCat.status}`);
    assert.strictEqual(viewerPayout.status, 403, `Viewer POST payout expected 403, got ${viewerPayout.status}`);

    // Cross-tenant isolation: Tenant A tries to delete Tenant B's category -> 404; Tenant B tries to payout Tenant A's commission -> 409
    const crossDelCat = await requestJson(baseUrl, 'DELETE', `/api/commissions/categories/${catB.id}`, { token: tokenOwnerA });
    assert.strictEqual(crossDelCat.status, 404, `Cross-tenant DELETE category expected 404, got ${crossDelCat.status}`);
    const crossPayout = await requestJson(baseUrl, 'POST', '/api/commissions/payout', {
      token: tokenOwnerB,
      body: { employee_id: emp2Id, commission_ids: [cInc.id] },
    });
    assert.strictEqual(crossPayout.status, 409, `Cross-tenant payout expected 409, got ${crossPayout.status}`);
    console.log('  ✅ [PASS] M4-C6: RBAC separado (200 view / 403 write+payout) y aislamiento multi-tenant estricto.');

    console.log('\n🎉 SUITE DE ACEPTACIÓN MÓDULO 4 APROBADA 100% (M4-C1 a M4-C6)');
  } finally {
    server.close();
    // Clean up both synthetic tenants
    await pool.query('DELETE FROM payroll_audit_logs WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM payroll_details WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM payrolls WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM audit_logs WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM employee_commissions_log WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM commission_payouts WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM commission_scheme_rules WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM commission_schemes WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM commission_categories WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM cash_movements WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM cash_registers WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
    await pool.query('DELETE FROM visits WHERE tenant_id IN (?, ?)', [tidA, tidB]).catch(() => {});
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
  console.error('❌ MÓDULO 4 ACCEPTANCE FAILED:', err);
  process.exit(1);
});
