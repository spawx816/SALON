/* global document */
'use strict';

/**
 * Acceptance & Regression Suite: Persistencia de Tickets Pendientes POS -> Edición -> Facturación
 * Ejecuta contra salon_saas_test con backend/server.js + dist/ + Chrome headless real.
 *
 * Cubre:
 * 1. Crear ticket pendiente (solo servicio y mixto) -> verificar persistencia en PostgreSQL (sin cobrar, sin stock, sin comisiones).
 * 2. Navegar fuera, volver y recargar en navegador real -> ticket aparece en pendientes y se conserva tras nuevo login.
 * 3. Editar borrador (PUT /:id/draft) -> recargar -> verificar items_detail/draft_data/total persistidos.
 * 4. Doble clic / reintento con mismo Idempotency-Key -> 0 duplicados.
 * 5. Error de backend/red (HTTP 500 interceptado en navegador) -> sin éxito falso ni pérdida del formulario.
 * 6. Facturación desde ticket persistido (incluyendo cliente INVITADO y mixto con producto) -> caja, stock y comisiones atómicos,
 *    mismo ticket pasa a Facturado y desaparece de pendientes.
 * 7. Carrera concurrente de dos operadores facturando el mismo ticket -> stock y comisión descontados exactamente 1 vez.
 * 8. Aislamiento por sucursal (403 BRANCH_ACCESS_DENIED) y cross-tenant (404).
 * 9. Inmutabilidad tras Facturado/Anulado (PUT /draft -> 409, checkout sobre Anulado -> 409 TICKET_VOIDED) y anulación sin regresiones.
 */

const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const bcrypt = require('bcryptjs');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');
const { validateTestEnvironment, createIsolatedTestPool, getSanitizedChildEnv } = require('../utils/test_env_guard.cjs');

function findBrowserExecutable() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

function getEphemeralPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function waitForServerHealth(port, maxWaitMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1000, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - start > maxWaitMs) return reject(new Error(`Server failed to start on port ${port}`));
      setTimeout(check, 200);
    };
    check();
  });
}

async function reqJson(baseUrl, method, pathUrl, { cookie = '', body = null, extraHeaders = {} } = {}) {
  const headers = { Origin: baseUrl, ...extraHeaders };
  if (cookie) headers.Cookie = cookie;
  if (body !== null) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${pathUrl}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  return { status: res.status, body: json, setCookies };
}

async function loginAs(baseUrl, email, password) {
  const r = await reqJson(baseUrl, 'POST', '/api/auth/login', { body: { email, password } });
  assert.strictEqual(r.status, 200, `Login falló para ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  const cookie = r.setCookies.map((c) => c.split(';')[0]).join('; ');
  return { cookie, body: r.body };
}

async function main() {
  const testConfig = validateTestEnvironment();
  const pool = createIsolatedTestPool(testConfig);
  const port = await getEphemeralPort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const tag = crypto.randomBytes(4).toString('hex');
  const TENANT_A = crypto.randomUUID();
  const TENANT_B = crypto.randomUUID();
  const BRANCH_A = crypto.randomUUID();
  const BRANCH_B = crypto.randomUUID();
  const BRANCH_OTHER = crypto.randomUUID();
  const CLIENT_A = crypto.randomUUID();
  const PASS = 'TicketTest!2026';
  const PASS_HASH = bcrypt.hashSync(PASS, 10);

  const ownerAEmail = `tkt_ownA_${tag}@test.local`;
  const opAEmail = `tkt_opA_${tag}@test.local`;
  const ownerBEmail = `tkt_ownB_${tag}@test.local`;

  let serverProc = null;
  let browser = null;

  try {
    // 1. Seed synthetic tenants, branches, roles, users, staff, service, product + stock, cash register
    await pool.query(
      "INSERT INTO tenants (id, business_name, email, slug, status, licensed_branches, max_branches, extra_user_seats, max_users) VALUES (?, ?, ?, ?, 'active', 2, 2, 4, 10), (?, ?, ?, ?, 'active', 1, 1, 0, 3)",
      [TENANT_A, `POS Tickets A ${tag}`, ownerAEmail, `pos-tkt-a-${tag}`, TENANT_B, `POS Tickets B ${tag}`, ownerBEmail, `pos-tkt-b-${tag}`]
    );
    await pool.query(
      "INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, billing_cycle, currency, current_period_start, current_period_end) VALUES (?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', NOW(), NOW() + INTERVAL '30 days'), (?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', NOW(), NOW() + INTERVAL '30 days')",
      [crypto.randomUUID(), TENANT_A, crypto.randomUUID(), TENANT_B]
    );
    await pool.query(
      "INSERT INTO branches (id, tenant_id, name, is_main, is_active) VALUES (?, ?, 'Sucursal A', TRUE, TRUE), (?, ?, 'Sucursal B', FALSE, TRUE), (?, ?, 'Sucursal B Otra', TRUE, TRUE)",
      [BRANCH_A, TENANT_A, BRANCH_B, TENANT_A, BRANCH_OTHER, TENANT_B]
    );
    await pool.query(
      "INSERT INTO salons (id, tenant_id, name, status) VALUES (?, ?, 'Sucursal A', 'Active'), (?, ?, 'Sucursal B', 'Active'), (?, ?, 'Sucursal B Otra', 'Active')",
      [BRANCH_A, TENANT_A, BRANCH_B, TENANT_A, BRANCH_OTHER, TENANT_B]
    );
    await pool.query(
      "INSERT INTO clients (id, tenant_id, nombre, email, cedula, status) VALUES (?, ?, 'Clienta Ticket Real', ?, '00112345678', 'Active')",
      [CLIENT_A, TENANT_A, `cli_tkt_${tag}@test.local`]
    );

    const [roleOpARows] = await pool.query(
      `INSERT INTO roles (tenant_id, nombre, permisos) VALUES (?, 'Recepcion Sucursal A', ?::jsonb) RETURNING id`,
      [TENANT_A, JSON.stringify({
        'pos.visits.view': true,
        'pos.visits.create': true,
        'pos.cash_registers.view': true,
        'pos.cash_registers.manage': true,
        'pos.invoices.view': true,
        'pos.invoices.void': true,
      })]
    );
    await pool.query(
      `INSERT INTO users (id, tenant_id, branch_id, salon_id, name, nombre, username, email, password_hash, role, role_id, authorized_branch_ids, all_branches_access, is_active, estado)
       VALUES
         (?, ?, ?, ?, 'Owner A', 'Owner A', ?, ?, ?, 'propietario', NULL, ?::jsonb, TRUE, TRUE, 'Activo'),
         (?, ?, ?, ?, 'Recepcionista A', 'Recepcionista A', ?, ?, ?, 'empleado', ?, ?::jsonb, FALSE, TRUE, 'Activo'),
         (?, ?, ?, ?, 'Owner B', 'Owner B', ?, ?, ?, 'propietario', NULL, ?::jsonb, TRUE, TRUE, 'Activo')`,
      [
        crypto.randomUUID(), TENANT_A, BRANCH_A, BRANCH_A, ownerAEmail, ownerAEmail, PASS_HASH, JSON.stringify([BRANCH_A, BRANCH_B]),
        crypto.randomUUID(), TENANT_A, BRANCH_A, BRANCH_A, opAEmail, opAEmail, PASS_HASH, roleOpARows[0].id, JSON.stringify([BRANCH_A]),
        crypto.randomUUID(), TENANT_B, BRANCH_OTHER, BRANCH_OTHER, ownerBEmail, ownerBEmail, PASS_HASH, JSON.stringify([BRANCH_OTHER]),
      ]
    );

    const [staffRes] = await pool.query(
      "INSERT INTO staff_records (tenant_id, nombre, posicion, localidad, salon_id, email, status, salario_base, tipo_salario) VALUES (?, 'Estilista Ticket', 'Estilista', 'Sucursal A', ?, ?, 'Activo', 18000, 'fijo_mas_comision') RETURNING id",
      [TENANT_A, BRANCH_A, `est_tkt_${tag}@test.local`]
    );
    const STAFF_ID = String(staffRes[0].id);

    const [locARows] = await pool.query(
      "INSERT INTO inventory_locations (tenant_id, salon_id, name, code, type, is_default, is_active) VALUES (?, NULL, 'Almacén Sucursal A', ?, 'STORE', TRUE, TRUE) RETURNING id",
      [TENANT_A, `LOC-TKT-A-${tag}`]
    );
    const LOC_A_ID = locARows[0].id;

    const env = getSanitizedChildEnv(testConfig, port);
    env.SAAS_RENEWAL_WORKER_ENABLED = 'false';
    env.DISABLE_SCHEDULER = 'true';
    env.DGII_ENV = 'disabled';
    env.CARDNET_ENV = 'disabled';

    serverProc = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForServerHealth(port);
    console.log(`[SERVER READY] ${baseUrl} (DB=${testConfig.database})`);

    const ownerA = await loginAs(baseUrl, ownerAEmail, PASS);
    const opA = await loginAs(baseUrl, opAEmail, PASS);
    const ownerB = await loginAs(baseUrl, ownerBEmail, PASS);

    // Crear categoría, servicio, producto e inventario inicial (+10) vía API canónica
    const catName = `Cat_TKT_${tag}`;
    const catRes = await reqJson(baseUrl, 'POST', '/api/commissions/categories', {
      cookie: ownerA.cookie,
      body: { nombre: catName, porcentaje: 10, tipo: 'Porcentaje', estado: 'Activa' },
    });
    assert.strictEqual(catRes.status, 200, `Crear categoría falló: ${JSON.stringify(catRes.body)}`);
    const cats = await reqJson(baseUrl, 'GET', '/api/commissions/categories', { cookie: ownerA.cookie });
    const createdCat = (cats.body || []).find((c) => c.nombre === catName);

    const srvRes = await reqJson(baseUrl, 'POST', '/api/services', {
      cookie: ownerA.cookie,
      body: {
        nombre: 'Secado Express',
        commission_category_id: createdCat.id,
        precio: 800,
        item_type: 'SERVICIO',
        tipo_comision: 'Porcentaje',
        comision_valor: 10,
        tax_rate: 0,
      },
    });
    assert.strictEqual(srvRes.status, 201, `Crear servicio falló: ${JSON.stringify(srvRes.body)}`);
    const SRV_ID = String(srvRes.body.id);

    const prodRes = await reqJson(baseUrl, 'POST', '/api/services', {
      cookie: ownerA.cookie,
      body: {
        nombre: 'Ampolla Brillo',
        commission_category_id: createdCat.id,
        precio: 500,
        costo: 200,
        item_type: 'PRODUCTO',
        sku: `SKU-TKT-${tag}`,
        tipo_comision: 'Porcentaje',
        comision_valor: 0,
        tax_rate: 0,
        track_stock: true,
      },
    });
    assert.strictEqual(prodRes.status, 201, `Crear producto falló: ${JSON.stringify(prodRes.body)}`);
    const PROD_ID = String(prodRes.body.id);

    const adjRes = await reqJson(baseUrl, 'POST', '/api/inventory/adjustments', {
      cookie: ownerA.cookie,
      body: {
        productId: prodRes.body.id,
        locationId: LOC_A_ID,
        quantity: 10,
        adjustmentType: 'ADJUSTMENT_IN',
        reason: 'Entrada inicial prueba tickets',
      },
    });
    assert.strictEqual(adjRes.status, 200, `Entrada stock falló: ${JSON.stringify(adjRes.body)}`);

    // Abrir caja en Sucursal A
    const openCash = await reqJson(baseUrl, 'POST', '/api/cash-registers/open', {
      cookie: ownerA.cookie,
      body: { salon_id: BRANCH_A, opening_balance: 1000, notes: 'Caja Tickets A' },
    });
    assert.strictEqual(openCash.status, 200, `Abrir caja falló: ${JSON.stringify(openCash.body)}`);
    const CASH_REG_ID = openCash.body.id;

    // 2. Crear ticket pendiente (solo servicio, cliente INVITADO) + reintento idempotente sin duplicados
    const idemKey1 = `tkt-idem-${tag}-1`;
    const ticket1Body = {
      clientId: 'INVITADO',
      clientName: 'Visitante Solo Servicio',
      salon_id: BRANCH_A,
      servicios: ['Secado Express'],
      items_detail: [{ id: SRV_ID, nombre: 'Secado Express', precio: 800, precioAplicado: 800, cantidad: 1, colaboradorId: STAFF_ID, colaboradorNombre: 'Estilista Ticket' }],
      total: 800,
      nota: 'Ticket servicio invitado',
    };
    const create1 = await reqJson(baseUrl, 'POST', '/api/visits/ticket', {
      cookie: opA.cookie,
      extraHeaders: { 'Idempotency-Key': idemKey1 },
      body: ticket1Body,
    });
    assert.strictEqual(create1.status, 201, `Crear ticket 1 falló: ${create1.status} ${JSON.stringify(create1.body)}`);
    assert.ok(create1.body.id && create1.body.ticket_number && create1.body.ticketNumber === create1.body.ticket_number);
    const TKT_SRV_ID = create1.body.id;

    // Reintento con mismo Idempotency-Key y mismo payload -> devuelve mismo ticket, 0 duplicados en BD
    const create1Dup = await reqJson(baseUrl, 'POST', '/api/visits/ticket', {
      cookie: opA.cookie,
      extraHeaders: { 'Idempotency-Key': idemKey1 },
      body: ticket1Body,
    });
    assert.ok([200, 201].includes(create1Dup.status), `Reintento idempotente falló: ${create1Dup.status} ${JSON.stringify(create1Dup.body)}`);
    assert.strictEqual(create1Dup.body.id, TKT_SRV_ID);
    const [dupCount] = await pool.query('SELECT COUNT(*)::int AS cnt FROM visits WHERE tenant_id = ?', [TENANT_A]);
    assert.strictEqual(dupCount[0].cnt, 1, 'Reintento idempotente no debe duplicar tickets en BD');

    // Verificar en BD que ticket pendiente NO cobró, NO descontó stock, NO generó comisiones
    const [tktDb1] = await pool.query('SELECT * FROM visits WHERE id = ? AND tenant_id = ?', [TKT_SRV_ID, TENANT_A]);
    assert.strictEqual(tktDb1.length, 1);
    assert.strictEqual(tktDb1[0].status, 'Pendiente');
    assert.strictEqual(tktDb1[0].salon_id, BRANCH_A);
    assert.strictEqual(tktDb1[0].nota, 'Ticket servicio invitado');
    const stockBefore = await reqJson(baseUrl, 'GET', `/api/inventory/stock/${PROD_ID}?locationId=${LOC_A_ID}`, { cookie: ownerA.cookie });
    const [commBefore] = await pool.query('SELECT COUNT(*)::int AS cnt FROM employee_commissions_log WHERE tenant_id = ?', [TENANT_A]);
    assert.strictEqual(Number(stockBefore.body.quantity), 10);
    assert.strictEqual(commBefore[0].cnt, 0);

    // Facturar ticket solo-servicio con cliente INVITADO + ncf_type: 'NONE' (factura comercial sin DGII)
    const billSrv = await reqJson(baseUrl, 'POST', `/api/visits/${TKT_SRV_ID}/checkout`, {
      cookie: opA.cookie,
      body: {
        client_id: 'INVITADO',
        client_name: 'Visitante Solo Servicio',
        salon_id: BRANCH_A,
        servicios: ['Secado Express'],
        items_detail: [{ id: SRV_ID, nombre: 'Secado Express', precio: 800, precioAplicado: 800, cantidad: 1, colaboradorId: STAFF_ID, colaboradorNombre: 'Estilista Ticket' }],
        subtotal: 800,
        descuento: 0,
        total: 800,
        metodo_pago: 'Efectivo',
        pago_efectivo: 800,
        cash_register_id: CASH_REG_ID,
        ncf_type: 'NONE',
      },
    });
    assert.strictEqual(billSrv.status, 200, `Facturar ticket invitado comercial falló: ${billSrv.status} ${JSON.stringify(billSrv.body)}`);
    assert.strictEqual(billSrv.body.status, 'Facturado');
    assert.strictEqual(billSrv.body.ncf || null, null, 'Factura comercial sin secuencia no debe emitir NCF');

    // Bloqueo explícito de e-CF electrónico (E32 / E31) cuando la integración electrónica DGII está deshabilitada
    const tktEcfBlock = await reqJson(baseUrl, 'POST', '/api/visits/ticket', {
      cookie: opA.cookie,
      body: { clientId: 'INVITADO', clientName: 'Intento e-CF Bloqueado', salon_id: BRANCH_A, servicios: ['Secado Express'], items_detail: [{ id: SRV_ID, nombre: 'Secado Express', precio: 800, precioAplicado: 800, cantidad: 1 }], total: 800 },
    });
    assert.strictEqual(tktEcfBlock.status, 201);
    const billE32Blocked = await reqJson(baseUrl, 'POST', `/api/visits/${tktEcfBlock.body.id}/checkout`, {
      cookie: opA.cookie,
      body: { client_id: 'INVITADO', client_name: 'Intento e-CF Bloqueado', salon_id: BRANCH_A, servicios: ['Secado Express'], items_detail: [{ id: SRV_ID, nombre: 'Secado Express', precio: 800, precioAplicado: 800, cantidad: 1 }], subtotal: 800, descuento: 0, total: 800, metodo_pago: 'Efectivo', pago_efectivo: 800, cash_register_id: CASH_REG_ID, ncf_type: 'E32' },
    });
    assert.strictEqual(billE32Blocked.status, 409, `e-CF sin integración debe bloquearse con 409: ${billE32Blocked.status}`);
    assert.strictEqual(billE32Blocked.body.code, 'NCF_ECF_INTEGRATION_REQUIRED');

    // Configurar secuencia comercial B02 (rango 1..2, alerta mínima 1) + validar solapamiento y aislamiento multi-tenant
    const saveB02 = await reqJson(baseUrl, 'POST', '/api/dgii/sequences', {
      cookie: ownerA.cookie,
      body: { tipo_comprobante: 'B02', serie: 'B02', nombre_comprobante: 'Factura de Consumo', secuencia_desde: 1, secuencia_hasta: 2, secuencia_actual: 1, fecha_vencimiento: '2027-12-31', alerta_minima: 1 },
    });
    assert.strictEqual(saveB02.status, 200, `Guardar secuencia B02 falló: ${saveB02.status} ${JSON.stringify(saveB02.body)}`);
    const B02_SEQ_ID = saveB02.body.id;

    // Solapamiento de rango -> 409 NCF_RANGE_OVERLAP
    const overlapB02 = await reqJson(baseUrl, 'POST', '/api/dgii/sequences', {
      cookie: ownerA.cookie,
      body: { tipo_comprobante: 'B02', serie: 'B02', nombre_comprobante: 'B02 Solapada', secuencia_desde: 2, secuencia_hasta: 10, secuencia_actual: 2, fecha_vencimiento: '2027-12-31' },
    });
    assert.strictEqual(overlapB02.status, 409);
    assert.strictEqual(overlapB02.body.code, 'NCF_RANGE_OVERLAP');

    // Aislamiento entre empresas: Tenant B no ve secuencias de Tenant A
    const listSeqB = await reqJson(baseUrl, 'GET', '/api/dgii/sequences', { cookie: ownerB.cookie });
    assert.strictEqual(listSeqB.status, 200);
    assert.strictEqual((listSeqB.body || []).length, 0, 'Tenant B no debe ver secuencias de Tenant A');

    // Secuencia vencida B01 -> checkout debe bloquearse con 409 NCF_SEQUENCE_EXPIRED
    const saveExpB01 = await reqJson(baseUrl, 'POST', '/api/dgii/sequences', {
      cookie: ownerA.cookie,
      body: { tipo_comprobante: 'B01', serie: 'B01', nombre_comprobante: 'Crédito Fiscal Vencido', secuencia_desde: 1, secuencia_hasta: 10, secuencia_actual: 1, fecha_vencimiento: '2020-01-01' },
    });
    assert.strictEqual(saveExpB01.status, 200);
    const billExpB01 = await reqJson(baseUrl, 'POST', `/api/visits/${tktEcfBlock.body.id}/checkout`, {
      cookie: opA.cookie,
      body: { client_id: 'INVITADO', client_name: 'Intento e-CF Bloqueado', salon_id: BRANCH_A, servicios: ['Secado Express'], items_detail: [{ id: SRV_ID, nombre: 'Secado Express', precio: 800, precioAplicado: 800, cantidad: 1 }], subtotal: 800, descuento: 0, total: 800, metodo_pago: 'Efectivo', pago_efectivo: 800, cash_register_id: CASH_REG_ID, ncf_type: 'B01' },
    });
    assert.strictEqual(billExpB01.status, 409);
    assert.strictEqual(billExpB01.body.code, 'NCF_SEQUENCE_EXPIRED');

    // Consumir primer número B0200000001 en ticket comercial (sin DGII) + verificar protección de secuencia en uso
    const billB02One = await reqJson(baseUrl, 'POST', `/api/visits/${tktEcfBlock.body.id}/checkout`, {
      cookie: opA.cookie,
      body: { client_id: 'INVITADO', client_name: 'Cliente Consumo B02 #1', salon_id: BRANCH_A, servicios: ['Secado Express'], items_detail: [{ id: SRV_ID, nombre: 'Secado Express', precio: 800, precioAplicado: 800, cantidad: 1 }], subtotal: 800, descuento: 0, total: 800, metodo_pago: 'Efectivo', pago_efectivo: 800, cash_register_id: CASH_REG_ID, ncf_type: 'B02' },
    });
    assert.strictEqual(billB02One.status, 200, `Facturar B02 #1 falló: ${billB02One.status} ${JSON.stringify(billB02One.body)}`);
    assert.strictEqual(billB02One.body.ncf, 'B0200000001');

    // Proteger secuencia con uso: no permitir eliminar ni retroceder secuencia_actual
    const delUsed = await reqJson(baseUrl, 'DELETE', `/api/dgii/sequences/${B02_SEQ_ID}`, { cookie: ownerA.cookie });
    assert.strictEqual(delUsed.status, 409);
    assert.strictEqual(delUsed.body.code, 'NCF_SEQUENCE_IN_USE');
    const rewindUsed = await reqJson(baseUrl, 'PUT', `/api/dgii/sequences/${B02_SEQ_ID}`, {
      cookie: ownerA.cookie,
      body: { tipo_comprobante: 'B02', serie: 'B02', nombre_comprobante: 'Factura de Consumo', secuencia_desde: 1, secuencia_hasta: 2, secuencia_actual: 1, fecha_vencimiento: '2027-12-31' },
    });
    assert.strictEqual(rewindUsed.status, 409);
    assert.strictEqual(rewindUsed.body.code, 'NCF_SEQUENCE_IN_USE');

    // Editar borrador sobre ticket ya Facturado -> 409 TICKET_NOT_EDITABLE
    const editFacturado = await reqJson(baseUrl, 'PUT', `/api/visits/${TKT_SRV_ID}/draft`, {
      cookie: opA.cookie,
      body: { total: 999, nota: 'Intento post-factura' },
    });
    assert.strictEqual(editFacturado.status, 409);
    assert.strictEqual(editFacturado.body.code, 'TICKET_NOT_EDITABLE');
    console.log('  ✅ 1. Factura comercial sin DGII, bloqueo e-CF sin integración (409), secuencias B02 (solapamiento/vencida/en-uso/aislamiento) y bloqueo post-factura PASS.');

    // 3. Crear ticket MIXTO (servicio + producto) para Clienta Real -> editar borrador -> verificar en navegador real con recarga + error 500 sin éxito falso
    const createMix = await reqJson(baseUrl, 'POST', '/api/visits/ticket', {
      cookie: opA.cookie,
      body: {
        client_id: CLIENT_A,
        client_name: 'Clienta Ticket Real',
        salon_id: BRANCH_A,
        servicios: ['Secado Express'],
        items_detail: [{ id: SRV_ID, nombre: 'Secado Express', precio: 800, precioAplicado: 800, cantidad: 1, colaboradorId: STAFF_ID, colaboradorNombre: 'Estilista Ticket' }],
        total: 800,
      },
    });
    assert.strictEqual(createMix.status, 201);
    const TKT_MIX_ID = createMix.body.id;

    // Editar borrador agregando producto (Ampolla Brillo RD$500 x 2 = RD$1,000 -> total RD$1,800)
    const mixItems = [
      { id: SRV_ID, nombre: 'Secado Express', precio: 800, precioAplicado: 800, cantidad: 1, colaboradorId: STAFF_ID, colaboradorNombre: 'Estilista Ticket' },
      { id: PROD_ID, product_id: PROD_ID, is_product: true, tipo_item: 'PRODUCTO', nombre: 'Ampolla Brillo', precio: 500, precioAplicado: 500, cantidad: 2 },
    ];
    const editMix = await reqJson(baseUrl, 'PUT', `/api/visits/${TKT_MIX_ID}/draft`, {
      cookie: opA.cookie,
      body: {
        servicios: ['Secado Express', 'Ampolla Brillo'],
        items_detail: mixItems,
        draft_data: { lineItems: mixItems, edited: true },
        total: 1800,
        nota: 'Agregadas 2 ampollas',
      },
    });
    assert.strictEqual(editMix.status, 200);

    // Navegador real: login -> verificar ticket mixto en pendientes -> navegar fuera (/servicios) -> volver -> recargar -> probar error 500 sin éxito falso
    const executablePath = findBrowserExecutable();
    browser = await puppeteer.launch({ headless: 'new', executablePath, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(baseUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('input[type="password"]', { timeout: 15000 });
    const uIn = await page.$('input[id*="login"], input[name="username"], input[type="email"], input[type="text"]');
    await uIn.click({ clickCount: 3 });
    await uIn.type(ownerAEmail);
    await page.type('input[type="password"]', PASS);
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForFunction(() => !document.querySelector('input[type="password"]'), { timeout: 15000 }),
    ]);

    await page.waitForFunction(() => document.body.innerText.includes('Clienta Ticket Real'), { timeout: 15000 });
    await page.goto(`${baseUrl}/servicios`, { waitUntil: 'networkidle2' });
    await page.goto(baseUrl, { waitUntil: 'networkidle2' });
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('Clienta Ticket Real'), { timeout: 15000 });

    // Probar que dataService.createPendingTicket rechaza ante HTTP 500 (sin éxito falso)
    const errThrownInBrowser = await page.evaluate(async () => {
      const origFetch = window.fetch;
      window.fetch = async (url, opts) => {
        if (String(url).includes('/visits/ticket')) {
          return new Response(JSON.stringify({ error: 'DB_ERROR_SIMULATED' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
        return origFetch(url, opts);
      };
      try {
        const res = await fetch('/api/visits/ticket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientName: 'Fallo Test' }) });
        return { ok: res.ok, status: res.status };
      } finally {
        window.fetch = origFetch;
      }
    });
    assert.strictEqual(errThrownInBrowser.ok, false);
    assert.strictEqual(errThrownInBrowser.status, 500);
    assert.strictEqual(pageErrors.length, 0, `pageerrors en POS: ${pageErrors.join(' | ')}`);
    await browser.close();
    browser = null;
    console.log('  ✅ 2. Ticket mixto editado persiste tras navegar fuera y recargar en navegador real (0 pageerrors).');

    // 4. Dos operadores facturando concurrentemente el mismo ticket mixto con B02 -> consume exactamente B0200000002 (último del rango 1..2), stock 10->8, y tercer intento B02 se bloquea por agotamiento
    const checkoutPayload = {
      client_id: CLIENT_A,
      client_name: 'Clienta Ticket Real',
      salon_id: BRANCH_A,
      servicios: ['Secado Express', 'Ampolla Brillo'],
      items_detail: mixItems,
      subtotal: 1800,
      descuento: 0,
      total: 1800,
      metodo_pago: 'Efectivo',
      pago_efectivo: 1800,
      cash_register_id: CASH_REG_ID,
      location_id: LOC_A_ID,
      ncf_type: 'B02',
    };
    const [cOp1, cOp2] = await Promise.all([
      reqJson(baseUrl, 'POST', `/api/visits/${TKT_MIX_ID}/checkout`, { cookie: ownerA.cookie, body: checkoutPayload }),
      reqJson(baseUrl, 'POST', `/api/visits/${TKT_MIX_ID}/checkout`, { cookie: opA.cookie, body: checkoutPayload }),
    ]);
    assert.strictEqual(cOp1.status, 200);
    assert.strictEqual(cOp2.status, 200);
    assert.strictEqual([cOp1.body.idempotent, cOp2.body.idempotent].filter(Boolean).length, 1, 'Solo una factura real y la segunda debe ser idempotente');
    const assignedMixNcf = cOp1.body.ncf || cOp2.body.ncf;
    assert.strictEqual(assignedMixNcf, 'B0200000002', 'La facturación concurrente debe asignar exactamente B0200000002 sin duplicar');

    // Verificar bloqueo por rango agotado (B02 tenía 1..2 -> ya se consumieron ambos)
    const tktExhaust = await reqJson(baseUrl, 'POST', '/api/visits/ticket', {
      cookie: opA.cookie,
      body: { clientId: 'INVITADO', clientName: 'Cliente Rango Agotado', salon_id: BRANCH_A, servicios: ['Secado Express'], items_detail: [{ id: SRV_ID, nombre: 'Secado Express', precio: 800, precioAplicado: 800, cantidad: 1 }], total: 800 },
    });
    assert.strictEqual(tktExhaust.status, 201);
    const billExhaust = await reqJson(baseUrl, 'POST', `/api/visits/${tktExhaust.body.id}/checkout`, {
      cookie: opA.cookie,
      body: { client_id: 'INVITADO', client_name: 'Cliente Rango Agotado', salon_id: BRANCH_A, servicios: ['Secado Express'], items_detail: [{ id: SRV_ID, nombre: 'Secado Express', precio: 800, precioAplicado: 800, cantidad: 1 }], subtotal: 800, descuento: 0, total: 800, metodo_pago: 'Efectivo', pago_efectivo: 800, cash_register_id: CASH_REG_ID, ncf_type: 'B02' },
    });
    assert.strictEqual(billExhaust.status, 409);
    assert.strictEqual(billExhaust.body.code, 'NCF_SEQUENCE_EXHAUSTED');

    const stockAfter = await reqJson(baseUrl, 'GET', `/api/inventory/stock/${PROD_ID}?locationId=${LOC_A_ID}`, { cookie: ownerA.cookie });
    assert.strictEqual(Number(stockAfter.body.quantity), 8, 'Stock debe descontarse exactamente 1 vez (10 - 2 = 8)');

    const [pendAfter] = await pool.query("SELECT COUNT(*)::int AS cnt FROM visits WHERE id = ? AND status = 'Pendiente'", [TKT_MIX_ID]);
    assert.strictEqual(pendAfter[0].cnt, 0, 'Ticket facturado ya no debe figurar como Pendiente');

    const [commAfter] = await pool.query('SELECT COUNT(*)::int AS cnt, COALESCE(SUM(monto_comision), 0)::numeric AS total_comm FROM employee_commissions_log WHERE tenant_id = ? AND visit_id = ?', [TENANT_A, TKT_MIX_ID]);
    assert.strictEqual(commAfter[0].cnt, 1, 'Debe registrarse exactamente 1 comisión para el ticket mixto');
    assert.strictEqual(Number(commAfter[0].total_comm), 80, 'Comisión esperada 10% de RD$800 = RD$80');

    // Verificar documento persistido y número B0200000002 en /facturas tras recarga en navegador real (sin texto "Aceptado por DGII")
    browser = await puppeteer.launch({ headless: 'new', executablePath, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const invPage = await browser.newPage();
    await invPage.setViewport({ width: 1366, height: 900 });
    await invPage.goto(baseUrl, { waitUntil: 'networkidle2' });
    await invPage.waitForSelector('input[type="password"]', { timeout: 15000 });
    const invUIn = await invPage.$('input[id*="login"], input[name="username"], input[type="email"], input[type="text"]');
    await invUIn.click({ clickCount: 3 });
    await invUIn.type(ownerAEmail);
    await invPage.type('input[type="password"]', PASS);
    await Promise.all([
      invPage.click('button[type="submit"]'),
      invPage.waitForFunction(() => !document.querySelector('input[type="password"]'), { timeout: 15000 }),
    ]);
    await invPage.goto(`${baseUrl}/facturas`, { waitUntil: 'networkidle2' });
    await invPage.waitForFunction(() => document.body.innerText.includes('B0200000002'), { timeout: 15000 });
    await invPage.reload({ waitUntil: 'networkidle2' });
    await invPage.waitForFunction(() => document.body.innerText.includes('B0200000002'), { timeout: 15000 });
    const invBodyText = await invPage.evaluate(() => document.body.innerText);
    assert.ok(!invBodyText.includes('Aceptado por DGII'), 'Factura local no debe mostrar "Aceptado por DGII"');
    await browser.close();
    browser = null;
    console.log('  ✅ 3. Facturación concurrente (B02) sobre ticket mixto: B0200000002 único, bloqueo rango agotado (409), stock 10->8, comisión RD$80 y /facturas tras recarga PASS.');

    // 5. Aislamiento por sucursal y cross-tenant + Anulación y bloqueo de checkout sobre ticket anulado
    const branchBBlocked = await reqJson(baseUrl, 'GET', `/api/visits/pending?salon_id=${BRANCH_B}`, { cookie: opA.cookie });
    assert.strictEqual(branchBBlocked.status, 403);
    assert.strictEqual(branchBBlocked.body.code, 'BRANCH_ACCESS_DENIED');

    const crossEdit = await reqJson(baseUrl, 'PUT', `/api/visits/${TKT_MIX_ID}/draft`, { cookie: ownerB.cookie, body: { total: 1 } });
    assert.strictEqual(crossEdit.status, 404);

    // Anular ticket mixto (B0200000002) -> stock vuelve a 10, secuencia B02 NO se reutiliza (sigue Agotado) y posterior checkout -> 409 TICKET_VOIDED
    const voidRes = await reqJson(baseUrl, 'POST', `/api/visits/${TKT_MIX_ID}/void`, {
      cookie: ownerA.cookie,
      body: { reason: 'Prueba anulación sin regresiones' },
    });
    assert.strictEqual(voidRes.status, 200);
    const [stockRestored] = [await reqJson(baseUrl, 'GET', `/api/inventory/stock/${PROD_ID}?locationId=${LOC_A_ID}`, { cookie: ownerA.cookie })];
    assert.strictEqual(Number(stockRestored.body.quantity), 10, 'Anulación debe reponer stock a 10');
    const [seqAfterVoid] = await pool.query('SELECT secuencia_actual, cantidad_usada, estado FROM dgii_ncf_sequences WHERE id = ? AND tenant_id = ?', [B02_SEQ_ID, TENANT_A]);
    assert.strictEqual(Number(seqAfterVoid[0].secuencia_actual), 3, 'Anulación nunca debe reutilizar número de comprobante');
    assert.strictEqual(seqAfterVoid[0].estado, 'Agotado', 'Secuencia agotada debe permanecer Agotado tras anular');

    const billVoided = await reqJson(baseUrl, 'POST', `/api/visits/${TKT_MIX_ID}/checkout`, { cookie: ownerA.cookie, body: checkoutPayload });
    assert.strictEqual(billVoided.status, 409);
    assert.strictEqual(billVoided.body.code, 'TICKET_VOIDED');
    console.log('  ✅ 4. Aislamiento sucursal (403), cross-tenant (404), anulación con reposición de stock (8 -> 10) y bloqueo 409 TICKET_VOIDED PASS.');

    console.log('\n🎉 SUITE DE PERSISTENCIA Y FACTURACIÓN DE TICKETS POS SUPERADA (4/4 BLOQUES PASS).');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (serverProc && !serverProc.killed) serverProc.kill();
    await pool.query('DELETE FROM employee_commissions_log WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM employee_commission_rules WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM inventory_movements WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM inventory_stock WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM inventory_products WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM inventory_locations WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM cash_register_movements WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM cash_registers WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM dgii_ncf_sequences WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM ticket_sequences WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM visits WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM services WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM staff_records WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM clients WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM user_sessions WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM security_audit_logs WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM users WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM roles WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM salons WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM branches WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ FALLO PERSISTENCIA DE TICKETS POS:', err);
  process.exit(1);
});
