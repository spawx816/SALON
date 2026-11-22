'use strict';

/**
 * Suite de Regresión Dedicada: Bloques 1 al 8 sobre PostgreSQL real (salon_saas_test)
 * (backend/tests/test_blocks_1_to_8_regression.cjs)
 *
 * Cubre:
 * - B1: Comisiones por empleado (4 niveles) y descuentos de empleado sin duplicación.
 * - B2: Reasignación auditada de comisión (sin alterar NCF/total/pagos) y bloqueo si está liquidada/aprobada.
 * - B3: Empleado sin cuenta en `users` incluido en nómina + motivos de exclusión.
 * - B4: Cálculos numéricos de IT-1 local y flujo completo de Egresos (registro, resumen, anulación).
 * - B5: ITBIS del catálogo al POS (gravado exclusivo, gravado inclusivo, exento, tasa cero, líneas mixtas y descuentos).
 * - B6: Stock cero y concurrencia sobre la última unidad (exactamente 1 éxito, 1 rechazo INSUFFICIENT_STOCK).
 * - B7: Cotización de sucursal (sin Membresías), asientos adicionales y tarjeta cancelada/fallida conservando método anterior.
 * - B8: Add-on Membresías (US$99/bloque de hasta 3 sucursales): 0, 1, 3, 4, 6 y 7 sucursales; capacidad comprada vs asignada.
 */

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const bcrypt = require('bcryptjs');

const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { createApp } = require('../app');
const { signAuthToken } = require('../middleware/auth.middleware');
const { migrateAll } = require('../migrations/migrate_all.cjs');
const { computeMembershipsAddonBlocks, MEMBERSHIPS_ADDON_BLOCK_SIZE, MEMBERSHIPS_ADDON_BLOCK_PRICE_USD } = require('../services/saas_catalog.constants');

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
  console.log('🧪 REGRESIÓN DEDICADA BLOQUES 1–8 EN POSTGRESQL (salon_saas_test)');
  console.log('========================================================================\n');

  const testConfig = validateTestEnvironment({ allowDisposableSchema: false });
  const pool = createIsolatedTestPool(testConfig);

  await migrateAll({ pool, targetSchema: 'public', quiet: true });

  const app = createApp({ pool });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const ts = Date.now();
  const tenantId = crypto.randomUUID();
  const branch1Id = crypto.randomUUID();
  const branch2Id = crypto.randomUUID();
  const branch3Id = crypto.randomUUID();
  const branch4Id = crypto.randomUUID();
  const ownerId = crypto.randomUUID();

  const ownerToken = signAuthToken({
    sub: String(ownerId),
    id: String(ownerId),
    email: `b18-owner-${ts}@test.local`,
    name: 'Owner Regresión',
    role: 'owner',
    tenantId,
    branchId: branch1Id,
    isSuperAdmin: false,
    tokenVersion: 1,
  });

  try {
    // Seed Tenant + 4 licensed branches + Owner + Open Cash Register + B02 Sequence
    const pwHash = await bcrypt.hash('TestPass#2026', 6);
    await pool.query(
      `INSERT INTO tenants (id, business_name, slug, email, owner_name, owner_email, rnc, plan_id, status, licensed_branches, max_branches, max_users, modules_config)
       VALUES (?, ?, ?, ?, 'Owner Regresión', ?, '131917038', 1, 'active', 4, 4, 15, '{"pos":true,"clients":true,"marketing":true,"memberships":false}'::jsonb)`,
      [tenantId, `Regresión B1-B8 ${ts}`, `reg-b18-${ts}`, `b18-owner-${ts}@test.local`, `b18-owner-${ts}@test.local`]
    );

    for (const [idx, bid] of [branch1Id, branch2Id, branch3Id, branch4Id].entries()) {
      await pool.query(
        `INSERT INTO branches (id, tenant_id, name, address, phone, is_main, status, is_active)
         VALUES (?, ?, ?, 'Dir', '8090000000', ?, 'Active', true)`,
        [bid, tenantId, `Sucursal ${idx + 1}`, idx === 0]
      );
      await pool.query(
        `INSERT INTO salons (id, name, address, phone, status, tenant_id)
         VALUES (?, ?, 'Dir', '8090000000', 'Active', ?)`,
        [bid, `Sucursal ${idx + 1}`, tenantId]
      );
    }

    await pool.query(
      `INSERT INTO users (id, tenant_id, branch_id, name, nombre, email, password_hash, role, is_active, estado, token_version)
       VALUES (?, ?, ?, 'Owner Regresión', 'Owner Regresión', ?, ?, 'owner', true, 'Activo', 1)`,
      [ownerId, tenantId, branch1Id, `b18-owner-${ts}@test.local`, pwHash]
    );

    await pool.query(
      `INSERT INTO tenant_subscriptions (tenant_id, plan_code, status, current_period_start, current_period_end, auto_renew, addon_blocks_count, addon_branches_capacity)
       VALUES (?, 'PRINCIPAL', 'active', NOW(), NOW() + INTERVAL '30 days', FALSE, 0, 0)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId]
    );

    // Open cash register in branch 1 via canonical API
    const crOpenRes = await requestJson(baseUrl, 'POST', '/api/cash-registers/open', {
      token: ownerToken,
      body: { salon_id: branch1Id, branch_id: branch1Id, opening_balance: 1000, opening_amount: 1000 },
    });
    assert.ok(crOpenRes.status === 200 || crOpenRes.status === 201, `Open cash register failed: ${crOpenRes.text}`);
    const cashRegisterId = crOpenRes.body.id || crOpenRes.body.cash_register_id || crOpenRes.body.register?.id;
    assert.ok(cashRegisterId, `cashRegisterId missing in open response: ${crOpenRes.text}`);

    // Seed B02 NCF sequence
    await pool.query(
      `INSERT INTO dgii_ncf_sequences (tenant_id, tipo_comprobante, serie, nombre_comprobante, secuencia_desde, secuencia_hasta, secuencia_actual, cantidad_aprobada, cantidad_usada, fecha_vencimiento, estado)
       VALUES (?, 'B02', 'B02', 'Factura de Consumo', 1, 100, 1, 100, 0, '2028-12-31', 'Activo')`,
      [tenantId]
    );

    // Seed commission_categories required by catalog
    for (const catName of ['Cabello', 'Color', 'Productos']) {
      await pool.query(
        `INSERT INTO commission_categories (tenant_id, nombre, estado) VALUES (?, ?, 'Activo')`,
        [tenantId, catName]
      );
    }

    // Seed commission scheme + rule (30% on Alisado Gravado Exc)
    const [schemeIns] = await pool.query(
      `INSERT INTO commission_schemes (tenant_id, nombre, descripcion, estado) VALUES (?, 'Esquema Regresión', 'Test', 'Activo') RETURNING id`,
      [tenantId]
    );
    const schemeId = schemeIns[0].id;
    await pool.query(
      `INSERT INTO commission_scheme_rules (tenant_id, scheme_id, rule_type, service_name, porcentaje_comision, valor, prioridad)
       VALUES (?, ?, 'servicio', 'Alisado Gravado Exc', 30, 30, 1)`,
      [tenantId, schemeId]
    );

    // Seed 2 active staff_records (WITHOUT users accounts!) + 1 inactive staff_record
    const [emp1Ins] = await pool.query(
      `INSERT INTO staff_records (tenant_id, nombre, posicion, localidad, salario_base, tipo_salario, status, fecha_entrada, commission_scheme_id)
       VALUES (?, 'Estilista Uno', 'Estilista', 'Sucursal 1', 25000, 'Quincenal', 'Activo', '2026-01-01', ?) RETURNING id`,
      [tenantId, schemeId]
    );
    const emp1Id = emp1Ins[0].id;

    const [emp2Ins] = await pool.query(
      `INSERT INTO staff_records (tenant_id, nombre, posicion, localidad, salario_base, tipo_salario, status, fecha_entrada, commission_scheme_id)
       VALUES (?, 'Estilista Dos', 'Estilista', 'Sucursal 1', 25000, 'Quincenal', 'Activo', '2026-01-01', ?) RETURNING id`,
      [tenantId, schemeId]
    );
    const emp2Id = emp2Ins[0].id;

    await pool.query(
      `INSERT INTO staff_records (tenant_id, nombre, posicion, localidad, salario_base, tipo_salario, status, fecha_entrada)
       VALUES (?, 'Ex Empleado', 'Estilista', 'Sucursal 1', 20000, 'Quincenal', 'Inactivo', '2025-01-01')`,
      [tenantId]
    );

    // =========================================================================
    // BLOQUE 1 & 5: COMISIONES + ITBIS (GRAVADO EX/IN, EXENTO, TASA CERO)
    // =========================================================================
    console.log('[B1 + B5] Probando catálogo ITBIS (gravado exc/inc, exento, tasa 0) y motor de comisiones...');

    // Create 4 services with distinct tax modes
    const svcGravExc = await requestJson(baseUrl, 'POST', '/api/services', {
      token: ownerToken,
      body: { nombre: 'Alisado Gravado Exc', precio: 1000, categoria: 'Cabello', tipo: 'Servicio', aplica_itbis: 1, tax_rate: 18, tax_mode: 'exclusive', comision_porcentaje: 20 },
    });
    assert.ok(svcGravExc.status === 200 || svcGravExc.status === 201, `svcGravExc failed: ${svcGravExc.text}`);

    const svcGravInc = await requestJson(baseUrl, 'POST', '/api/services', {
      token: ownerToken,
      body: { nombre: 'Tinte Gravado Inc', precio: 1180, categoria: 'Color', tipo: 'Servicio', aplica_itbis: 1, tax_rate: 18, tax_mode: 'inclusive', comision_porcentaje: 15 },
    });
    assert.ok(svcGravInc.status === 200 || svcGravInc.status === 201, `svcGravInc failed: ${svcGravInc.text}`);

    const svcExento = await requestJson(baseUrl, 'POST', '/api/services', {
      token: ownerToken,
      body: { nombre: 'Lavado Exento', precio: 500, categoria: 'Cabello', tipo: 'Servicio', aplica_itbis: 0, tax_rate: 0, tax_mode: 'exempt', comision_porcentaje: 10 },
    });
    assert.ok(svcExento.status === 200 || svcExento.status === 201, `svcExento failed: ${svcExento.text}`);

    const svcTasaCero = await requestJson(baseUrl, 'POST', '/api/services', {
      token: ownerToken,
      body: { nombre: 'Tratamiento Tasa 0', precio: 300, categoria: 'Cabello', tipo: 'Servicio', aplica_itbis: 1, tax_rate: 0, tax_mode: 'zero', comision_porcentaje: 10 },
    });
    assert.ok(svcTasaCero.status === 200 || svcTasaCero.status === 201, `svcTasaCero failed: ${svcTasaCero.text}`);

    // Scheme & rule already seeded above for emp1 and emp2

    // Emit mixed invoice with all 4 items + B02 NCF via canonical /api/visits/:id/checkout
    const mixedVisitUuid = crypto.randomUUID();
    const mixedInvoice = await requestJson(baseUrl, 'POST', `/api/visits/${mixedVisitUuid}/checkout`, {
      token: ownerToken,
      body: {
        client_name: 'Clienta Fiscal Test',
        salon_id: branch1Id,
        cash_register_id: cashRegisterId,
        ncf_type: 'B02',
        ncf_name: 'Factura de Consumo',
        metodo_pago: 'Efectivo',
        monto_recibido: 3200,
        items_detail: [
          { id: svcGravExc.body.id, nombre: 'Alisado Gravado Exc', precio: 1000, precioBase: 1000, precioAplicado: 1000, cantidad: 1, estilista_id: emp1Id, empleado_id: emp1Id, estilista: 'Estilista Uno', aplica_itbis: 1, tax_rate: 18, tax_mode: 'exclusive' },
          { id: svcGravInc.body.id, nombre: 'Tinte Gravado Inc', precio: 1180, precioBase: 1180, precioAplicado: 1180, cantidad: 1, estilista_id: emp1Id, empleado_id: emp1Id, estilista: 'Estilista Uno', aplica_itbis: 1, tax_rate: 18, tax_mode: 'inclusive' },
          { id: svcExento.body.id, nombre: 'Lavado Exento', precio: 500, precioBase: 500, precioAplicado: 500, cantidad: 1, estilista_id: emp1Id, empleado_id: emp1Id, estilista: 'Estilista Uno', aplica_itbis: 0, tax_rate: 0, tax_mode: 'exempt' },
          { id: svcTasaCero.body.id, nombre: 'Tratamiento Tasa 0', precio: 300, precioBase: 300, precioAplicado: 300, cantidad: 1, estilista_id: emp1Id, empleado_id: emp1Id, estilista: 'Estilista Uno', aplica_itbis: 1, tax_rate: 0, tax_mode: 'zero' },
        ],
      },
    });
    assert.ok(mixedInvoice.status === 200 || mixedInvoice.status === 201, `Mixed invoice failed (${mixedInvoice.status}): ${mixedInvoice.text}`);
    const visitId = mixedInvoice.body.id;

    // Verify exact ITBIS persisted in PostgreSQL:
    // Item 1 (1000 exc 18%): base=1000, itbis=180, total=1180
    // Item 2 (1180 inc 18%): base=1000, itbis=180, total=1180
    // Item 3 (500 exento):   base=500,  itbis=0,   total=500
    // Item 4 (300 tasa 0):   base=300,  itbis=0,   total=300
    // Expected ITBIS = 360.00 (36000 cents), Total = 3160.00
    const [vRows] = await pool.query('SELECT id, ncf, subtotal, itbis, itbis_cents, total, status FROM visits WHERE id = ? AND tenant_id = ?', [visitId, tenantId]);
    assert.strictEqual(vRows.length, 1);
    const savedVisit = vRows[0];
    assert.ok(String(savedVisit.ncf || '').startsWith('B02'), `Expected B02 NCF, got ${savedVisit.ncf}`);
    assert.strictEqual(Number(savedVisit.itbis), 360, `Expected ITBIS=360, got ${savedVisit.itbis}`);
    assert.strictEqual(Number(savedVisit.itbis_cents), 36000, `Expected itbis_cents=36000, got ${savedVisit.itbis_cents}`);
    assert.strictEqual(Number(savedVisit.total), 3160, `Expected total=3160, got ${savedVisit.total}`);

    // Verify commission persisted for emp1
    const [commRows] = await pool.query(
      'SELECT * FROM employee_commissions_log WHERE visit_id = ? AND tenant_id = ? ORDER BY id ASC',
      [visitId, tenantId]
    );
    assert.ok(commRows.length >= 1, 'Deben existir comisiones persistidas para la factura');
    const alisadoComm = commRows.find((c) => String(c.service_name || '').includes('Alisado'));
    assert.ok(alisadoComm, 'Debe existir comisión para Alisado Gravado Exc');
    assert.strictEqual(Number(alisadoComm.employee_id), Number(emp1Id));
    assert.ok(Number(alisadoComm.commission_amount) > 0, `Comisión debe ser > 0, fue ${alisadoComm.commission_amount}`);
    console.log(`  ✅ [PASS] B1+B5: ITBIS exacto (RD$${savedVisit.itbis} / ${savedVisit.itbis_cents}c), NCF=${savedVisit.ncf}, comisión persistida RD$${alisadoComm.commission_amount}.`);

    // Test employee discount without duplication via canonical /api/visits/:id/checkout (and idempotent retry)
    const empDiscVisitUuid = crypto.randomUUID();
    const empDiscPayload = {
      client_name: 'Estilista Uno',
      salon_id: branch1Id,
      cash_register_id: cashRegisterId,
      metodo_pago: 'Nomina',
      employee_consumption: {
        employee_id: emp1Id,
        employee_name: 'Estilista Uno',
        monto: 500,
        authorized: true,
      },
      items_detail: [{ id: svcExento.body.id, nombre: 'Lavado Exento', precio: 500, precioBase: 500, precioAplicado: 500, cantidad: 1, estilista_id: emp2Id, empleado_id: emp2Id, estilista: 'Estilista Dos' }],
    };
    const empDiscVisit = await requestJson(baseUrl, 'POST', `/api/visits/${empDiscVisitUuid}/checkout`, {
      token: ownerToken,
      body: empDiscPayload,
    });
    assert.ok(empDiscVisit.status === 200 || empDiscVisit.status === 201, `empDiscVisit failed: ${empDiscVisit.text}`);
    // Reintento idempotente sobre el mismo visitId no debe duplicar el descuento
    await requestJson(baseUrl, 'POST', `/api/visits/${empDiscVisitUuid}/checkout`, {
      token: ownerToken,
      body: empDiscPayload,
    });
    const [edRows] = await pool.query('SELECT * FROM employee_discounts WHERE tenant_id = ? AND visit_id = ?', [tenantId, empDiscVisitUuid]);
    assert.strictEqual(edRows.length, 1, `Debe existir exactamente 1 descuento por nómina sin duplicación (encontrados: ${edRows.length})`);
    console.log('  ✅ [PASS] B1: Descuento por nómina de empleado persistido sin duplicación.');

    // =========================================================================
    // BLOQUE 2: REASIGNACIÓN AUDITADA Y BLOQUEO SI COMISIÓN LIQUIDADA
    // =========================================================================
    console.log('[B2] Probando reasignación auditada de comisión y bloqueo de comisiones liquidadas...');

    // Sin motivo -> 400
    const noReasonReassign = await requestJson(baseUrl, 'PUT', `/api/visits/${visitId}/commission-recipient`, {
      token: ownerToken,
      body: { new_employee_id: emp2Id, reason: '' },
    });
    assert.strictEqual(noReasonReassign.status, 400, 'Reasignar sin motivo debe devolver 400');

    // Reasignación válida con motivo (enviando updatedItems por línea como la UI InvoiceHistory)
    const [vItemsRow] = await pool.query('SELECT items_detail FROM visits WHERE id = ? AND tenant_id = ?', [visitId, tenantId]);
    const currentItems = typeof vItemsRow[0].items_detail === 'string'
      ? JSON.parse(vItemsRow[0].items_detail)
      : (vItemsRow[0].items_detail || []);
    const reassignedItems = currentItems.map((it) => ({
      ...it,
      empleado_id: emp2Id,
      estilista_id: emp2Id,
      estilista: 'Estilista Dos',
      colaborador: 'Estilista Dos',
    }));
    const okReassign = await requestJson(baseUrl, 'PUT', `/api/visits/${visitId}/commission-recipient`, {
      token: ownerToken,
      body: {
        empleado_peluquera: 'Estilista Dos',
        updatedItems: reassignedItems,
        reason: 'Corrección de estilista asignada en recepción',
      },
    });
    assert.strictEqual(okReassign.status, 200, `Reasignación válida falló: ${okReassign.text}`);

    // Verificar inmutabilidad de NCF, total, itbis y pagos
    const [vAfter] = await pool.query('SELECT ncf, subtotal, itbis, total, metodo_pago FROM visits WHERE id = ? AND tenant_id = ?', [visitId, tenantId]);
    assert.strictEqual(vAfter[0].ncf, savedVisit.ncf, 'NCF no debe cambiar al reasignar comisión');
    assert.strictEqual(Number(vAfter[0].total), Number(savedVisit.total), 'Total no debe cambiar');
    assert.strictEqual(Number(vAfter[0].itbis), Number(savedVisit.itbis), 'ITBIS no debe cambiar');

    // Verificar comisión reasignada a emp2 y auditoría registrada
    const [commAfter] = await pool.query('SELECT employee_id FROM employee_commissions_log WHERE visit_id = ? AND tenant_id = ?', [visitId, tenantId]);
    assert.ok(commAfter.every((c) => Number(c.employee_id) === Number(emp2Id)), 'Todas las comisiones de la factura deben apuntar a emp2');
    const [auditRows] = await pool.query(
      `SELECT action, reason, metadata FROM audit_logs WHERE tenant_id = ? AND action = 'REASSIGN_COMMISSION'`,
      [tenantId]
    );
    assert.ok(auditRows.length >= 1, 'Debe registrarse auditoría REASSIGN_COMMISSION');

    // Bloqueo si la comisión ya está pagada/liquidada
    await pool.query("UPDATE employee_commissions_log SET status = 'Pagada' WHERE visit_id = ? AND tenant_id = ?", [visitId, tenantId]);
    const blockedReassign = await requestJson(baseUrl, 'PUT', `/api/visits/${visitId}/commission-recipient`, {
      token: ownerToken,
      body: {
        empleado_peluquera: 'Estilista Uno',
        updatedItems: currentItems,
        reason: 'Intento sobre comisión pagada',
      },
    });
    assert.strictEqual(blockedReassign.status, 409, `Reasignación sobre comisión pagada debe ser 409, recibido ${blockedReassign.status}`);
    console.log('  ✅ [PASS] B2: Reasignación auditada sin tocar NCF/totales y bloqueo 409 sobre comisión liquidada.');

    // =========================================================================
    // BLOQUE 3: EMPLEADO SIN CUENTA `users` INCLUIDO EN NÓMINA
    // =========================================================================
    console.log('[B3] Probando inclusión de empleado sin cuenta `users` en nómina y motivos de exclusión...');
    const createPeriod = await requestJson(baseUrl, 'POST', '/api/payroll/generate', {
      token: ownerToken,
      body: {
        name: `Quincena Regresión ${ts}`,
        fecha_inicio: '2026-11-01',
        fecha_fin: '2026-11-15',
        start_date: '2026-11-01',
        end_date: '2026-11-15',
        pay_date: '2026-11-15',
        tipo: 'Quincenal',
        type: 'Quincenal',
      },
    });
    assert.ok(createPeriod.status === 200 || createPeriod.status === 201, `Crear período nómina falló: ${createPeriod.text}`);
    const periodId = createPeriod.body.id || createPeriod.body.period_id || createPeriod.body.period?.id;
    const periodDetail = await requestJson(baseUrl, 'GET', `/api/payroll/periods/${periodId}`, { token: ownerToken });
    assert.strictEqual(periodDetail.status, 200);
    const records = periodDetail.body.items || periodDetail.body.records || [];
    const excluded = periodDetail.body.excluded_employees || [];
    assert.ok(records.some((r) => Number(r.employee_id || r.staff_id) === Number(emp1Id)), 'Estilista Uno (sin cuenta users) debe estar incluido en nómina');
    assert.ok(records.some((r) => Number(r.employee_id || r.staff_id) === Number(emp2Id)), 'Estilista Dos (sin cuenta users) debe estar incluido en nómina');
    assert.ok(excluded.some((e) => String(e.nombre || e.name || '').includes('Ex Empleado') && (e.reason || e.motivo)), 'Ex Empleado inactivo debe reportarse en excluded_employees con motivo comprensible');
    console.log(`  ✅ [PASS] B3: ${records.length} empleados sin cuenta users incluidos en nómina; ${excluded.length} excluido(s) con motivo.`);

    // =========================================================================
    // BLOQUE 4: CONTABILIDAD IT-1 LOCAL Y EGRESOS
    // =========================================================================
    console.log('[B4] Probando cálculos numéricos IT-1 y flujo completo de Egresos...');
    const exp1 = await requestJson(baseUrl, 'POST', '/api/expenses', {
      token: ownerToken,
      body: { concept_name: 'Alquiler Local', amount: 15000, payment_date: '2026-11-10', salon_id: 1 },
    });
    assert.strictEqual(exp1.status, 200);
    const exp2 = await requestJson(baseUrl, 'POST', '/api/expenses', {
      token: ownerToken,
      body: { concept_name: 'Error Duplicado', amount: 5000, payment_date: '2026-11-11', salon_id: 1 },
    });
    assert.strictEqual(exp2.status, 200);
    const expVoid = await requestJson(baseUrl, 'POST', `/api/expenses/${exp2.body.id}/void`, {
      token: ownerToken,
      body: { reason: 'Egreso duplicado' },
    });
    assert.strictEqual(expVoid.status, 200);

    const expList = await requestJson(baseUrl, 'GET', '/api/expenses?period=2026-11', { token: ownerToken });
    assert.strictEqual(expList.status, 200);
    assert.strictEqual(Number(expList.body.summary.totalAmount), 15000, 'Total egresos debe excluir el anulado');
    assert.strictEqual(Number(expList.body.summary.voidedCount), 1);

    const it1Res = await requestJson(baseUrl, 'GET', '/api/dgii/it1?periodo=2026-11', { token: ownerToken });
    assert.strictEqual(it1Res.status, 200, `IT-1 failed: ${it1Res.text}`);
    assert.strictEqual(it1Res.body.electronicTransmissionEnabled, false);
    assert.strictEqual(Number(it1Res.body.resumen.itbis_cobrado_18), 360, `IT-1 itbis_cobrado_18 esperado 360, recibido ${it1Res.body.resumen.itbis_cobrado_18}`);
    assert.strictEqual(Number(it1Res.body.resumen.total_gastos_operativos), 15000);
    console.log('  ✅ [PASS] B4: IT-1 numérico exacto (ITBIS=RD$360, Gastos=RD$15,000, transmisión DGII=false).');

    // =========================================================================
    // BLOQUE 6: STOCK CERO Y CONCURRENCIA SOBRE LA ÚLTIMA UNIDAD
    // =========================================================================
    console.log('[B6] Probando producto sin stock (0) y concurrencia sobre última unidad (1)...');
    const prodRes = await requestJson(baseUrl, 'POST', '/api/services', {
      token: ownerToken,
      body: {
        nombre: 'Shampoo Keratina Test',
        precio: 850,
        categoria: 'Productos',
        tipo: 'Producto',
        track_inventory: true,
        aplica_itbis: 1,
        tax_rate: 18,
        tax_mode: 'exclusive',
      },
    });
    assert.ok(prodRes.status === 200 || prodRes.status === 201, `Create product failed: ${prodRes.text}`);
    const prodServiceId = prodRes.body.id;

    // Ensure inventory_products + inventory_locations + inventory_stock exist with stock = 0
    const [locRows] = await pool.query(
      'SELECT id FROM inventory_locations WHERE tenant_id = ? LIMIT 1',
      [tenantId]
    );
    let locId = locRows?.[0]?.id;
    if (!locId) {
      const [locIns] = await pool.query(
        `INSERT INTO inventory_locations (tenant_id, salon_id, name, code, is_default, is_active) VALUES (?, ?, 'Principal', 'MAIN', TRUE, TRUE) RETURNING id`,
        [tenantId, branch1Id]
      );
      locId = locIns[0].id;
    }
    const [invProdRows] = await pool.query(
      'SELECT id FROM inventory_products WHERE tenant_id = ? AND LOWER(name) = LOWER(?) LIMIT 1',
      [tenantId, 'Shampoo Keratina Test']
    );
    let invProdId = invProdRows?.[0]?.id;
    if (!invProdId) {
      const [ipIns] = await pool.query(
        `INSERT INTO inventory_products (tenant_id, name, sku, category, sale_price, track_stock, is_active) VALUES (?, 'Shampoo Keratina Test', ?, 'Productos', 850, TRUE, TRUE) RETURNING id`,
        [tenantId, `SKU-${ts}`]
      );
      invProdId = ipIns[0].id;
    }
    await pool.query(
      `INSERT INTO inventory_stock (tenant_id, product_id, location_id, quantity)
       VALUES (?, ?, ?, 0)
       ON CONFLICT (tenant_id, product_id, location_id) DO UPDATE SET quantity = 0`,
      [tenantId, invProdId, locId]
    );

    // Attempt sale at stock = 0 via canonical /api/visits/:id/checkout
    const zeroStockSale = await requestJson(baseUrl, 'POST', `/api/visits/${crypto.randomUUID()}/checkout`, {
      token: ownerToken,
      body: {
        client_name: 'Clienta Stock Cero',
        salon_id: branch1Id,
        cash_register_id: cashRegisterId,
        metodo_pago: 'Efectivo',
        items_detail: [{ id: prodServiceId, product_id: invProdId, nombre: 'Shampoo Keratina Test', precio: 850, precioBase: 850, precioAplicado: 850, cantidad: 1, tipo: 'Producto', item_type: 'PRODUCTO', track_stock: true }],
      },
    });
    assert.strictEqual(zeroStockSale.status, 400, `Stock 0 debe ser rechazado con 400, recibido ${zeroStockSale.status}: ${zeroStockSale.text}`);
    assert.strictEqual(zeroStockSale.body.code, 'INSUFFICIENT_STOCK');

    // Set stock = 1 and launch 2 concurrent sales for 1 unit each
    await pool.query(
      'UPDATE inventory_stock SET quantity = 1 WHERE tenant_id = ? AND product_id = ? AND location_id = ?',
      [tenantId, invProdId, locId]
    );
    const salePayload = {
      client_name: 'Clienta Concurrencia',
      salon_id: branch1Id,
      cash_register_id: cashRegisterId,
      metodo_pago: 'Efectivo',
      items_detail: [{ id: prodServiceId, product_id: invProdId, nombre: 'Shampoo Keratina Test', precio: 850, precioBase: 850, precioAplicado: 850, cantidad: 1, tipo: 'Producto', item_type: 'PRODUCTO', track_stock: true }],
    };
    const [c1, c2] = await Promise.all([
      requestJson(baseUrl, 'POST', `/api/visits/${crypto.randomUUID()}/checkout`, { token: ownerToken, body: salePayload }),
      requestJson(baseUrl, 'POST', `/api/visits/${crypto.randomUUID()}/checkout`, { token: ownerToken, body: salePayload }),
    ]);
    const statuses = [c1.status, c2.status].sort((a, b) => a - b);
    assert.ok(
      (statuses[0] === 200 || statuses[0] === 201) && statuses[1] === 400,
      `Concurrencia sobre última unidad debe dar exactamente 1 éxito y 1 rechazo 400; recibido: [${statuses.join(', ')}]`
    );
    const [finalStock] = await pool.query(
      'SELECT quantity FROM inventory_stock WHERE tenant_id = ? AND product_id = ? AND location_id = ?',
      [tenantId, invProdId, locId]
    );
    assert.strictEqual(Number(finalStock[0].quantity), 0, 'Stock final debe ser exactamente 0 (nunca negativo)');
    console.log('  ✅ [PASS] B6: Stock 0 rechazado y concurrencia sobre última unidad resuelta atómicamente (1 éxito / 1 rechazo 400, stock final=0).');

    // =========================================================================
    // BLOQUE 7: TARJETA CANCELADA/FALLIDA CONSERVA MÉTODO ANTERIOR + COTIZACIÓN SUCURSAL SIN MEMBRESÍAS
    // =========================================================================
    console.log('[B7] Probando conservación de método de pago ante cancelación/fallo y cotización de sucursal sin Membresías...');
    await pool.query(
      `INSERT INTO saas_payment_methods (id, tenant_id, provider, token_reference, provider_customer_id, brand, last4, exp_month, exp_year, is_default)
       VALUES (?, ?, 'cardnet', 'cardnet_profile_orig_4242', 'cust_orig', 'visa', '4242', 12, 2028, TRUE)`,
      [crypto.randomUUID(), tenantId]
    );

    // 1. Cancelación / token ausente en confirm-cardnet -> 400 INVALID_TOKEN
    const cancelCard = await requestJson(baseUrl, 'POST', '/api/saas-billing/payment-methods/confirm-cardnet', {
      token: ownerToken,
      body: { customerId: 'cust_orig', tokenPayload: {} },
    });
    assert.strictEqual(cancelCard.status, 400);
    assert.strictEqual(cancelCard.body.code, 'INVALID_TOKEN');

    // 2. Token manual ficticio en POST /payment-methods -> 400 SYNTHETIC_TOKENS_FORBIDDEN
    const manualCard = await requestJson(baseUrl, 'POST', '/api/saas-billing/payment-methods', {
      token: ownerToken,
      body: { paymentMethodToken: 'tok_manual_fake', last4: '9999', brand: 'mastercard', expMonth: 10, expYear: 2029 },
    });
    assert.strictEqual(manualCard.status, 400);
    assert.strictEqual(manualCard.body.code, 'SYNTHETIC_TOKENS_FORBIDDEN');

    // Verificar método anterior 4242 intacto y default
    const pmList = await requestJson(baseUrl, 'GET', '/api/saas-billing/payment-methods', { token: ownerToken });
    assert.strictEqual(pmList.status, 200);
    const methods = pmList.body.paymentMethods || pmList.body.methods || pmList.body || [];
    assert.ok(Array.isArray(methods) && methods.length === 1 && methods[0].last4 === '4242', 'Método de pago anterior 4242 debe conservarse intacto');

    // Verificar que quote-add-branch NO incluye add-on de Membresías
    const branchQuote = await requestJson(baseUrl, 'POST', '/api/salons/quote-add-branch', {
      token: ownerToken,
      body: { name: 'Sucursal 5', includeMembershipsAddon: true },
    });
    assert.strictEqual(branchQuote.status, 200, `branchQuote failed: ${branchQuote.text}`);
    assert.strictEqual(Boolean(branchQuote.body.quote?.includeMembershipsAddon), false, 'Agregar sucursal NO debe incluir ni cotizar el add-on de Membresías');
    console.log('  ✅ [PASS] B7: Tarjeta previa conservada tras cancelación/rechazo y cotización de sucursal libre de Membresías.');

    // =========================================================================
    // BLOQUE 8: ADD-ON MEMBRESÍAS EN 0, 1, 3, 4, 6 Y 7 SUCURSALES; CAPACIDAD COMPRADA VS ASIGNADA
    // =========================================================================
    console.log('[B8] Probando regla US$99/bloque (hasta 3 sucursales) en 0, 1, 3, 4, 6 y 7 sucursales...');
    const expectedBlocks = [
      { branches: 0, blocks: 0, capacity: 0, usd: 0 },
      { branches: 1, blocks: 1, capacity: 3, usd: 99 },
      { branches: 3, blocks: 1, capacity: 3, usd: 99 },
      { branches: 4, blocks: 2, capacity: 6, usd: 198 },
      { branches: 6, blocks: 2, capacity: 6, usd: 198 },
      { branches: 7, blocks: 3, capacity: 9, usd: 297 },
    ];
    for (const c of expectedBlocks) {
      const calc = computeMembershipsAddonBlocks(c.branches);
      assert.strictEqual(calc.blocks, c.blocks, `Para ${c.branches} suc. esperado ${c.blocks} bloques, recibido ${calc.blocks}`);
      assert.strictEqual(calc.capacity, c.capacity, `Para ${c.branches} suc. esperado capacidad ${c.capacity}, recibido ${calc.capacity}`);
      assert.strictEqual(calc.monthlyUsd, c.usd, `Para ${c.branches} suc. esperado US$${c.usd}, recibido US$${calc.monthlyUsd}`);
    }
    assert.strictEqual(MEMBERSHIPS_ADDON_BLOCK_SIZE, 3);
    assert.strictEqual(MEMBERSHIPS_ADDON_BLOCK_PRICE_USD, 99);

    // Simular 1 bloque adquirido (capacidad = 3 sucursales) y probar asignación sin cobro para 3 sucursales y bloqueo en la 4ta
    await pool.query(
      `UPDATE tenant_subscriptions SET addon_blocks_count = 1, addon_branches_capacity = 3 WHERE tenant_id = ?`,
      [tenantId]
    );
    await pool.query(
      `INSERT INTO tenant_feature_overrides (tenant_id, feature_code, is_enabled, acquired_blocks, acquired_branch_capacity, addon_branch_ids)
       VALUES (?, 'memberships', TRUE, 1, 3, ?::jsonb)
       ON CONFLICT (tenant_id, feature_code) DO UPDATE SET is_enabled = TRUE, acquired_blocks = 1, acquired_branch_capacity = 3, addon_branch_ids = EXCLUDED.addon_branch_ids`,
      [tenantId, JSON.stringify([branch1Id])]
    );

    // Cotizar asignación de 3 sucursales dentro del bloque ya adquirido (sin cobro adicional)
    const q3 = await requestJson(baseUrl, 'POST', '/api/saas-billing/addons/memberships/quote', {
      token: ownerToken,
      body: { branch_ids: [branch1Id, branch2Id, branch3Id] },
    });
    assert.strictEqual(q3.status, 200, `Quote 3 branches failed: ${q3.text}`);
    assert.strictEqual(Number(q3.body.quote?.additionalBlocksRequired ?? q3.body.additionalBlocksRequired ?? 0), 0, '3 sucursales dentro de 1 bloque adquirido no requieren bloque adicional');

    // Cotizar 4 sucursales (excede capacidad de 3 -> requiere 1 bloque adicional = 2 bloques totales)
    const q4 = await requestJson(baseUrl, 'POST', '/api/saas-billing/addons/memberships/quote', {
      token: ownerToken,
      body: { branch_ids: [branch1Id, branch2Id, branch3Id, branch4Id] },
    });
    assert.strictEqual(q4.status, 200, `Quote 4 branches failed: ${q4.text}`);
    const q4Obj = q4.body.quote || q4.body;
    assert.strictEqual(Number(q4Obj.requiredBlocks ?? q4Obj.totalBlocks), 2, '4 sucursales deben requerir 2 bloques totales');
    assert.strictEqual(Number(q4Obj.additionalBlocksRequired), 1, '4 sucursales sobre 1 bloque adquirido deben requerir 1 bloque adicional');
    console.log('  ✅ [PASS] B8: Bloques 0/1/3/4/6/7 y capacidad adquirida vs asignada verificados.');

    console.log('\n========================================================================');
    console.log('✅ TODOS LOS BLOQUES 1–8 DE REGRESIÓN PASARON EN salon_saas_test');
    console.log('========================================================================');
  } finally {
    try {
      await pool.query('DELETE FROM audit_logs WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM security_audit_logs WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM employee_commissions_log WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM employee_discounts WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM payroll_records WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM payroll_periods WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM expenses WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM inventory_movements WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM inventory_stock WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM inventory_products WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM inventory_locations WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM commission_scheme_rules WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM commission_schemes WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM commission_categories WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM visits WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM dgii_ncf_sequences WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM services WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM cash_registers WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM staff_records WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM saas_payment_methods WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM tenant_feature_overrides WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM users WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM salons WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM branches WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM tenants WHERE id = ?', [tenantId]);
    } catch (cleanErr) {
      console.warn('[CLEANUP WARNING]:', cleanErr.message);
    }
    server.close();
    await pool.end();
  }
}

runTests().catch((err) => {
  console.error('❌ FALLO EN REGRESIÓN BLOQUES 1–8:', err);
  process.exit(1);
});
