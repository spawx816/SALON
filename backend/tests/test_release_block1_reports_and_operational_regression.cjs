/* global document, window */
'use strict';

/**
 * BLOQUE 1 — REPORTES Y REGRESIÓN OPERATIVA
 *
 * 1. Valida los 11 reportes del selector de "Ventas y cobros" en /analitica?tab=bi_executive:
 *    - sales_summary (Resumen de ventas y cobros)
 *    - sales_by_product (Ventas por producto o servicio)
 *    - sales_by_client (Ventas por cliente (Mayor consumo))
 *    - payment_methods (Cobros por método de pago)
 *    - accounts_receivable (Cuentas por cobrar)
 *    - cancelled_tickets (Tickets cancelados)
 *    - voided_invoices (Facturas anuladas)
 *    - applied_discounts (Descuentos aplicados)
 *    - cash_membership_payments (Pagos en efectivo)
 *    - sales_itbis (ITBIS en ventas)
 *    - joint_purchases (Comportamiento de compra conjunta)
 *    con datos deterministas (ventas mixtas, anulaciones, tickets cancelados, descuentos, cuentas por cobrar,
 *    ITBIS, compra conjunta y 2 sucursales + 2 empresas), comparando Pantalla (DOM) == API == Base de Datos.
 *
 * 2. Ejecuta y verifica el recorrido operativo:
 *    catálogo -> stock -> apertura de caja -> ticket -> precuenta (0 NCF) -> recarga ->
 *    facturación convencional (B02 asignado 1 sola vez, 0 conexión DGII) -> comisión ->
 *    anulación -> cierre de caja y coherencia de totales entre caja y reportes.
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
const {
  validateTestEnvironment,
  createIsolatedTestPool,
  getSanitizedChildEnv,
} = require('../utils/test_env_guard.cjs');

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
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - start > maxWaitMs) return reject(new Error(`Server failed to start on port ${port}`));
      setTimeout(check, 200);
    };
    check();
  });
}

async function main() {
  const testConfig = validateTestEnvironment();
  const pool = createIsolatedTestPool(testConfig);
  const appPort = await getEphemeralPort();
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const tag = crypto.randomBytes(4).toString('hex');
  const PASS = 'Block1Reports!2026';
  const passHash = await bcrypt.hash(PASS, 10);

  const TENANT_A = crypto.randomUUID();
  const TENANT_B = crypto.randomUUID();
  const BRANCH_A1 = crypto.randomUUID();
  const BRANCH_A2 = crypto.randomUUID();
  const BRANCH_B1 = crypto.randomUUID();
  const USER_A = crypto.randomUUID();
  const USER_B = crypto.randomUUID();
  const EMAIL_A = `owner_a_${tag}@test.local`;
  const EMAIL_B = `owner_b_${tag}@test.local`;

  let serverProc = null;
  let browser = null;

  try {
    // 1. Crear Empresas A (2 sucursales) y B (1 sucursal) para verificar aislamiento multi-tenant y filtro por sucursal
    await pool.query(
      `INSERT INTO tenants (id, business_name, slug, email, owner_name, owner_email, status, licensed_branches, max_branches, extra_user_seats, max_users)
       VALUES
         (?, ?, ?, ?, 'Owner A', ?, 'active', 2, 2, 0, 6),
         (?, ?, ?, ?, 'Owner B', ?, 'active', 1, 1, 0, 3)`,
      [
        TENANT_A, `Empresa Reportes A ${tag}`, `rep-a-${tag}`, EMAIL_A, EMAIL_A,
        TENANT_B, `Empresa Reportes B ${tag}`, `rep-b-${tag}`, EMAIL_B, EMAIL_B,
      ]
    );

    await pool.query(
      `INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, billing_cycle, currency, current_period_start, current_period_end)
       VALUES
         (?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', NOW(), NOW() + INTERVAL '30 days'),
         (?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', NOW(), NOW() + INTERVAL '30 days')`,
      [crypto.randomUUID(), TENANT_A, crypto.randomUUID(), TENANT_B]
    );

    await pool.query(
      `INSERT INTO branches (id, tenant_id, name, is_main, is_active)
       VALUES
         (?, ?, 'Sucursal Central', TRUE, TRUE),
         (?, ?, 'Sucursal Norte', FALSE, TRUE),
         (?, ?, 'Sucursal Externa B', TRUE, TRUE)`,
      [BRANCH_A1, TENANT_A, BRANCH_A2, TENANT_A, BRANCH_B1, TENANT_B]
    );

    await pool.query(
      `INSERT INTO salons (id, tenant_id, name, status)
       VALUES
         (?, ?, 'Sucursal Central', 'Active'),
         (?, ?, 'Sucursal Norte', 'Active'),
         (?, ?, 'Sucursal Externa B', 'Active')`,
      [BRANCH_A1, TENANT_A, BRANCH_A2, TENANT_A, BRANCH_B1, TENANT_B]
    );

    await pool.query(
      `INSERT INTO users (id, tenant_id, branch_id, salon_id, name, nombre, username, email, password_hash, role, all_branches_access, authorized_branch_ids, is_active, estado)
       VALUES
         (?, ?, ?, ?, 'Propietaria A', 'Propietaria A', ?, ?, ?, 'propietario', TRUE, ?::jsonb, TRUE, 'Activo'),
         (?, ?, ?, ?, 'Propietaria B', 'Propietaria B', ?, ?, ?, 'propietario', TRUE, ?::jsonb, TRUE, 'Activo')`,
      [
        USER_A, TENANT_A, BRANCH_A1, BRANCH_A1, EMAIL_A, EMAIL_A, passHash, JSON.stringify([BRANCH_A1, BRANCH_A2]),
        USER_B, TENANT_B, BRANCH_B1, BRANCH_B1, EMAIL_B, EMAIL_B, passHash, JSON.stringify([BRANCH_B1]),
      ]
    );

    // 2. Clientes, Colaboradora, Catálogo (Servicio + Producto con stock), Secuencia NCF B02
    const [c1Rows] = await pool.query(
      `INSERT INTO clients (tenant_id, salon_id, nombre, cedula, telefono, status)
       VALUES (?, ?, 'Valeria Clientes', '00112345678', '8095550101', 'Active')
       RETURNING id`,
      [TENANT_A, BRANCH_A1]
    );
    const CLIENT_A1 = c1Rows[0].id;

    const [c2Rows] = await pool.query(
      `INSERT INTO clients (tenant_id, salon_id, nombre, cedula, telefono, status)
       VALUES (?, ?, 'Camila Norte', '00187654321', '8095550202', 'Active')
       RETURNING id`,
      [TENANT_A, BRANCH_A2]
    );
    const CLIENT_A2 = c2Rows[0].id;

    const [staffRows] = await pool.query(
      `INSERT INTO staff_records (tenant_id, nombre, cedula, posicion, localidad, status)
       VALUES (?, 'Elena Estilista', '00199887766', 'Estilista', 'Sucursal Central', 'Activo')
       RETURNING id`,
      [TENANT_A]
    );
    const STAFF_A1 = staffRows[0].id;

    const [srvRows] = await pool.query(
      `INSERT INTO services (tenant_id, nombre, name, categoria, precio, price, item_type, tipo_comision, comision_valor, activo)
       VALUES (?, 'Corte & Brushing', 'Corte & Brushing', 'Peluquería', 1500, 1500, 'SERVICIO', 'Porcentaje', 20, 1)
       RETURNING id`,
      [TENANT_A]
    );
    const SERVICE_A1 = srvRows[0].id;

    const [prodRows] = await pool.query(
      `INSERT INTO services (tenant_id, nombre, name, categoria, precio, price, item_type, track_stock, min_stock, tipo_comision, comision_valor, activo, is_active)
       VALUES (?, 'Mascarilla Argán', 'Mascarilla Argán', 'Productos', 1000, 1000, 'PRODUCTO', TRUE, 2, 'Porcentaje', 10, 1, TRUE)
       RETURNING id`,
      [TENANT_A]
    );
    const PRODUCT_A1 = prodRows[0].id;

    // 2.b Configurar almacén por sucursal y cargar stock inicial (20 unidades en Central y 10 en Norte)
    const { InventoryRepository } = require('../repositories/inventory.repository');
    const { InventoryService } = require('../services/inventory.service');
    const invService = new InventoryService(new InventoryRepository(pool));
    const locCentral = await invService.getDefaultLocation(TENANT_A, BRANCH_A1);
    const locNorte = await invService.getDefaultLocation(TENANT_A, BRANCH_A2);
    const LOC_A1 = locCentral.id;
    const LOC_A2 = locNorte.id;
    await invService.receiveInitialStock(TENANT_A, {
      productId: PRODUCT_A1,
      locationId: LOC_A1,
      quantity: 20,
      unitCost: 400,
    });
    await invService.receiveInitialStock(TENANT_A, {
      productId: PRODUCT_A1,
      locationId: LOC_A2,
      quantity: 10,
      unitCost: 400,
    });

    // Secuencia NCF convencional B02 (1 a 50)
    await pool.query(
      `INSERT INTO dgii_ncf_sequences (tenant_id, tipo_comprobante, nombre_comprobante, serie, secuencia_desde, secuencia_hasta, secuencia_actual, cantidad_usada, fecha_vencimiento, estado)
       VALUES (?, 'B02', 'Factura de Consumo', 'B02', 1, 50, 1, 0, '2027-12-31', 'Activo')`,
      [TENANT_A]
    );

    // 3. Iniciar servidor con DGII deshabilitado
    const env = getSanitizedChildEnv(testConfig, appPort);
    env.SAAS_RENEWAL_WORKER_ENABLED = 'false';
    env.DISABLE_SCHEDULER = 'true';
    env.DGII_ENV = 'disabled';
    env.DGII_MODE = 'disabled';

    serverProc = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForServerHealth(appPort);

    const executablePath = findBrowserExecutable();
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    const pageErrors = [];
    const unexpectedApiErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('response', (res) => {
      if (res.url().includes('/api/') && res.status() >= 500) {
        unexpectedApiErrors.push(`${res.status()} ${res.url()}`);
      }
    });

    // Login Owner A
    await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle2' });
    const loginRes = await page.evaluate(async (email, password) => {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const d = await r.json();
      const u = d?.user || d;
      if (r.ok && u?.id) localStorage.setItem('salon_pro_user', JSON.stringify(u));
      return { status: r.status };
    }, EMAIL_A, PASS);
    assert.strictEqual(loginRes.status, 200);

    const apiCall = async (method, urlPath, body = null) => {
      return page.evaluate(async (m, u, b) => {
        const res = await fetch(u, {
          method: m,
          credentials: 'include',
          headers: b ? { 'Content-Type': 'application/json' } : {},
          body: b ? JSON.stringify(b) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        return { status: res.status, data };
      }, method, urlPath, body);
    };

    // =========================================================================
    // PARTE A: RECORRIDO OPERATIVO COMPLETO (Caja -> Ticket -> Precuenta -> Factura B02 -> Comisión -> Anulación -> Cierre)
    // =========================================================================
    // A.1 Abrir caja en Sucursal Central (fondo inicial RD$ 2,000) y en Sucursal Norte (fondo inicial RD$ 1,000)
    const openRegA1 = await apiCall('POST', '/api/cash-registers/open', {
      salon_id: BRANCH_A1,
      opening_balance: 2000,
      notes: 'Apertura Central Bloque 1',
    });
    assert.ok([200, 201].includes(openRegA1.status), `Apertura caja Central falló: ${JSON.stringify(openRegA1.data)}`);
    const REG_A1_ID = openRegA1.data.id;

    const openRegA2 = await apiCall('POST', '/api/cash-registers/open', {
      salon_id: BRANCH_A2,
      opening_balance: 1000,
      notes: 'Apertura Norte Bloque 1',
    });
    assert.ok([200, 201].includes(openRegA2.status), `Apertura caja Norte falló: ${JSON.stringify(openRegA2.data)}`);
    const REG_A2_ID = openRegA2.data.id;

    // A.2 Crear Ticket #1 (Venta Mixta + Compra Conjunta + ITBIS en Producto + NCF B02 en Sucursal Central)
    //     Corte & Brushing (RD$ 1,500 exento) + Mascarilla Argán (RD$ 1,000 con ITBIS incluido RD$ 152.54) = RD$ 2,500
    //     Pagado Mixto: Efectivo RD$ 1,000 + Tarjeta RD$ 1,500
    const t1Create = await apiCall('POST', '/api/visits/ticket', {
      salon_id: BRANCH_A1,
      client_id: CLIENT_A1,
      client_name: 'Valeria Clientes',
      servicios: ['Corte & Brushing', 'Mascarilla Argán'],
      items_detail: [
        {
          id: SERVICE_A1,
          nombre: 'Corte & Brushing',
          tipo_item: 'SERVICIO',
          precio: 1500,
          precioAplicado: 1500,
          cantidad: 1,
          colaboradorId: STAFF_A1,
          colaboradorNombre: 'Elena Estilista',
        },
        {
          id: PRODUCT_A1,
          nombre: 'Mascarilla Argán',
          tipo_item: 'PRODUCTO',
          precio: 1000,
          precioAplicado: 1000,
          cantidad: 1,
          itbis: 150,
          colaboradorId: STAFF_A1,
          colaboradorNombre: 'Elena Estilista',
        },
      ],
      total: 2500,
    });
    assert.strictEqual(t1Create.status, 201);
    const VISIT_1_ID = t1Create.data.id;

    // Guardar Precuenta sobre Ticket #1 -> Verificar que NO consume secuencia NCF B02
    const precuentaRes = await apiCall('POST', '/api/visits/precuenta', {
      id: VISIT_1_ID,
      total: 2500,
    });
    assert.strictEqual(precuentaRes.status, 200);
    const [seqBeforeCheckout] = await pool.query(
      "SELECT secuencia_actual, cantidad_usada FROM dgii_ncf_sequences WHERE tenant_id = ? AND tipo_comprobante = 'B02'",
      [TENANT_A]
    );
    assert.strictEqual(Number(seqBeforeCheckout[0].secuencia_actual), 1, 'Precuenta NUNCA debe consumir NCF');
    assert.strictEqual(Number(seqBeforeCheckout[0].cantidad_usada), 0);

    // Finalizar Factura Ticket #1 con NCF B02 y Pago Mixto (Efectivo 1000 + Tarjeta 1500)
    const checkout1 = await apiCall('POST', `/api/visits/${VISIT_1_ID}/checkout`, {
      salon_id: BRANCH_A1,
      cash_register_id: REG_A1_ID,
      client_id: CLIENT_A1,
      client_name: 'Valeria Clientes',
      servicios: ['Corte & Brushing', 'Mascarilla Argán'],
      items_detail: [
        {
          id: SERVICE_A1,
          nombre: 'Corte & Brushing',
          tipo_item: 'SERVICIO',
          precio: 1500,
          precioAplicado: 1500,
          cantidad: 1,
          colaboradorId: STAFF_A1,
          colaboradorNombre: 'Elena Estilista',
        },
        {
          id: PRODUCT_A1,
          nombre: 'Mascarilla Argán',
          tipo_item: 'PRODUCTO',
          precio: 1000,
          precioAplicado: 1000,
          cantidad: 1,
          itbis: 150,
          colaboradorId: STAFF_A1,
          colaboradorNombre: 'Elena Estilista',
        },
      ],
      subtotal: 2500,
      descuento: 0,
      total: 2500,
      metodo_pago: 'Mixto (Efectivo: RD$ 1000 + Tarjeta: RD$ 1500)',
      pago_efectivo: 1000,
      pago_tarjeta: 1500,
      pago_transferencia: 0,
      ncf_type: 'B02',
    });
    assert.strictEqual(checkout1.status, 200, `Checkout 1 falló: ${JSON.stringify(checkout1.data)}`);
    assert.strictEqual(checkout1.data.ncf, 'B0200000001', 'Debe asignar B0200000001 una sola vez');

    // Reintento idempotente de checkout sobre Ticket #1 -> conserva B0200000001 sin avanzar secuencia
    const checkout1Retry = await apiCall('POST', `/api/visits/${VISIT_1_ID}/checkout`, {
      salon_id: BRANCH_A1,
      cash_register_id: REG_A1_ID,
      total: 2500,
      ncf_type: 'B02',
    });
    assert.strictEqual(checkout1Retry.status, 200);
    assert.strictEqual(checkout1Retry.data.ncf, 'B0200000001');
    const [seqAfterCheckout1] = await pool.query(
      "SELECT secuencia_actual, cantidad_usada FROM dgii_ncf_sequences WHERE tenant_id = ? AND tipo_comprobante = 'B02'",
      [TENANT_A]
    );
    assert.strictEqual(Number(seqAfterCheckout1[0].secuencia_actual), 2);
    assert.strictEqual(Number(seqAfterCheckout1[0].cantidad_usada), 1);

    // Verificar comisión generada para Elena Estilista (20% de 1500 = 300 + 10% de 1000 = 100 -> RD$ 400)
    const [commRows1] = await pool.query(
      'SELECT SUM(monto_comision)::numeric as total_comision FROM employee_commissions_log WHERE tenant_id = ? AND visit_id = ?',
      [TENANT_A, VISIT_1_ID]
    );
    assert.strictEqual(Number(commRows1[0].total_comision), 400, 'Comisión calculada debe ser RD$ 400');

    // A.3 Crear Ticket #2 en Sucursal Central (Venta en Efectivo con Descuento: Subtotal 1,500 - Descuento 300 = Total 1,200 en Efectivo)
    const t2Create = await apiCall('POST', '/api/visits/ticket', {
      salon_id: BRANCH_A1,
      client_id: CLIENT_A1,
      client_name: 'Valeria Clientes',
      servicios: ['Corte & Brushing'],
      items_detail: [
        { id: SERVICE_A1, nombre: 'Corte & Brushing', tipo_item: 'SERVICIO', precio: 1500, precioAplicado: 1200, cantidad: 1 },
      ],
      total: 1200,
    });
    const VISIT_2_ID = t2Create.data.id;
    const checkout2 = await apiCall('POST', `/api/visits/${VISIT_2_ID}/checkout`, {
      salon_id: BRANCH_A1,
      cash_register_id: REG_A1_ID,
      client_id: CLIENT_A1,
      client_name: 'Valeria Clientes',
      servicios: ['Corte & Brushing'],
      items_detail: [
        { id: SERVICE_A1, nombre: 'Corte & Brushing', tipo_item: 'SERVICIO', precio: 1500, precioAplicado: 1200, cantidad: 1 },
      ],
      subtotal: 1500,
      descuento: 300,
      total: 1200,
      metodo_pago: 'Efectivo',
      pago_efectivo: 1200,
    });
    assert.strictEqual(checkout2.status, 200);

    // A.4 Crear Ticket #3 en Sucursal Norte (Venta a Crédito / Cuenta por Cobrar: RD$ 1,000 pendiente de cobro)
    const t3Create = await apiCall('POST', '/api/visits/ticket', {
      salon_id: BRANCH_A2,
      client_id: CLIENT_A2,
      client_name: 'Camila Norte',
      servicios: ['Mascarilla Argán'],
      items_detail: [
        { id: PRODUCT_A1, nombre: 'Mascarilla Argán', tipo_item: 'PRODUCTO', precio: 1000, precioAplicado: 1000, cantidad: 1 },
      ],
      total: 1000,
    });
    const VISIT_3_ID = t3Create.data.id;
    const checkout3 = await apiCall('POST', `/api/visits/${VISIT_3_ID}/checkout`, {
      salon_id: BRANCH_A2,
      cash_register_id: REG_A2_ID,
      client_id: CLIENT_A2,
      client_name: 'Camila Norte',
      servicios: ['Mascarilla Argán'],
      items_detail: [
        { id: PRODUCT_A1, nombre: 'Mascarilla Argán', tipo_item: 'PRODUCTO', precio: 1000, precioAplicado: 1000, cantidad: 1 },
      ],
      subtotal: 1000,
      descuento: 0,
      total: 1000,
      metodo_pago: 'Crédito (Cuenta por cobrar)',
    });
    assert.strictEqual(checkout3.status, 200);

    // A.5 Crear Ticket #4 en Sucursal Norte y CANCELARLO antes de facturar (Tickets cancelados: RD$ 1,500)
    const t4Create = await apiCall('POST', '/api/visits/ticket', {
      salon_id: BRANCH_A2,
      client_id: CLIENT_A2,
      client_name: 'Camila Norte',
      servicios: ['Corte & Brushing'],
      items_detail: [
        { id: SERVICE_A1, nombre: 'Corte & Brushing', tipo_item: 'SERVICIO', precio: 1500, precioAplicado: 1500, cantidad: 1 },
      ],
      total: 1500,
    });
    const VISIT_4_ID = t4Create.data.id;
    const cancelT4 = await apiCall('POST', `/api/visits/${VISIT_4_ID}/cancel`, {
      reason: 'Cliente se retiró por emergencia',
    });
    assert.strictEqual(cancelT4.status, 200);
    assert.strictEqual(cancelT4.data.status, 'Cancelado');

    // A.6 Crear Ticket #5 en Sucursal Central, facturarlo con B02 (B0200000002) por RD$ 1,000 en Transferencia, y luego ANULAR la factura
    const t5Create = await apiCall('POST', '/api/visits/ticket', {
      salon_id: BRANCH_A1,
      client_id: CLIENT_A1,
      client_name: 'Valeria Clientes',
      servicios: ['Mascarilla Argán'],
      items_detail: [
        { id: PRODUCT_A1, nombre: 'Mascarilla Argán', tipo_item: 'PRODUCTO', precio: 1000, precioAplicado: 1000, cantidad: 1 },
      ],
      total: 1000,
    });
    const VISIT_5_ID = t5Create.data.id;
    const checkout5 = await apiCall('POST', `/api/visits/${VISIT_5_ID}/checkout`, {
      salon_id: BRANCH_A1,
      cash_register_id: REG_A1_ID,
      client_id: CLIENT_A1,
      client_name: 'Valeria Clientes',
      servicios: ['Mascarilla Argán'],
      items_detail: [
        { id: PRODUCT_A1, nombre: 'Mascarilla Argán', tipo_item: 'PRODUCTO', precio: 1000, precioAplicado: 1000, cantidad: 1 },
      ],
      subtotal: 1000,
      descuento: 0,
      total: 1000,
      metodo_pago: 'Transferencia',
      pago_transferencia: 1000,
      ncf_type: 'B02',
    });
    assert.strictEqual(checkout5.status, 200);
    assert.strictEqual(checkout5.data.ncf, 'B0200000002');

    const voidT5 = await apiCall('POST', `/api/visits/${VISIT_5_ID}/void`, {
      reason: 'Error en digitación de factura',
    });
    assert.strictEqual(voidT5.status, 200);

    // Verificar stock en Central (20 - 1 VISIT_1 - 1 VISIT_5 + 1 anulación VISIT_5 = 19) y Norte (10 - 1 VISIT_3 = 9)
    const currentStockCentral = await invService.getStock(TENANT_A, PRODUCT_A1, LOC_A1);
    const currentStockNorte = await invService.getStock(TENANT_A, PRODUCT_A1, LOC_A2);
    assert.strictEqual(Number(currentStockCentral.quantity), 19, 'Stock Central debe reflejar venta válida y reversión de factura anulada (19)');
    assert.strictEqual(Number(currentStockNorte.quantity), 9, 'Stock Norte debe reflejar venta válida (9)');

    // Sembrar también una venta en Empresa B (RD$ 9,999) para asegurar que NUNCA contamina los reportes de Empresa A
    await pool.query(
      `INSERT INTO visits (id, tenant_id, ticket_number, client_name, salon_id, servicios, items_detail, total, total_cents, metodo_pago, status, visited_at)
       VALUES (?, ?, 'SD-99999', 'Cliente Empresa B', ?, '["Servicio B"]'::jsonb, '[{"nombre":"Servicio B","precio":9999,"cantidad":1}]'::jsonb, 9999, 999900, 'Efectivo', 'Facturado', NOW())`,
      [`VIS-B-${tag}`, TENANT_B, BRANCH_B1]
    );

    console.log('  ✅ [1/3] Recorrido operativo (cajas, ticket, precuenta 0 NCF, B02 único, comisión RD$400, ticket cancelado y factura anulada) PASS.');

    // =========================================================================
    // PARTE B: VALIDAR LOS 11 REPORTES DEL SELECTOR "VENTAS Y COBROS" (PANTALLA == API == BD)
    // =========================================================================
    // Resumen matemático determinista esperado en Empresa A:
    // - Facturas válidas ('Facturado'):
    //   1) VISIT_1 (Sucursal Central): Total = 2,500 | Cobrado = 2,500 (Efectivo 1,000 + Tarjeta 1,500) | ITBIS = 150 | Compra conjunta: Corte & Brushing + Mascarilla Argán
    //   2) VISIT_2 (Sucursal Central): Subtotal = 1,500 | Descuento = 300 | Total = 1,200 | Cobrado = 1,200 (Efectivo 1,200)
    //   3) VISIT_3 (Sucursal Norte):   Total = 1,000 | Cobrado = 0 (Crédito / Cuenta por cobrar = 1,000)
    // - Totales Globales Empresa A:
    //   * Facturación válida = 2,500 + 1,200 + 1,000 = RD$ 4,700 (3 facturas)
    //   * Total cobrado = 2,500 + 1,200 + 0 = RD$ 3,700
    //   * Efectivo cobrado = 1,000 + 1,200 = RD$ 2,200 (2 cobros)
    //   * Tarjeta cobrada = RD$ 1,500 (1 cobro)
    //   * Cuentas por cobrar = RD$ 1,000 (1 documento: Camila Norte)
    //   * Tickets cancelados = 1 (VISIT_4 en Sucursal Norte por RD$ 1,500, motivo "Cliente se retiró por emergencia")
    //   * Facturas anuladas = 1 (VISIT_5 en Sucursal Central con NCF B0200000002 por RD$ 1,000, motivo "Error en digitación de factura")
    //   * Descuentos aplicados = RD$ 300 (1 factura: VISIT_2, base 1,500 -> final 1,200)
    //   * ITBIS facturado neto = RD$ 150 (Base gravada 850, Exento 3,700)
    //   * Compra conjunta = 1 visita ("Corte & Brushing + Mascarilla Argán", 33.33% de 3 facturas, RD$ 2,500)

    await page.goto(`${baseUrl}/analitica?tab=bi_executive`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.toLowerCase().includes('inteligencia de negocios'), { timeout: 15000 });

    const expectedReportsMatrix = [
      {
        id: 'sales_summary',
        title: 'Resumen de ventas y cobros',
        expectedTextOnScreen: ['RD$ 4,700', 'RD$ 3,700', 'Sucursal Central', 'Sucursal Norte'],
        verifyApi: (api) => {
          assert.strictEqual(api.title, 'Resumen de ventas y cobros');
          assert.strictEqual(api.kpis[0].value, 'RD$ 4,700');
          assert.strictEqual(api.kpis[1].value, 'RD$ 3,700');
          assert.strictEqual(api.kpis[2].value, '3');
        },
      },
      {
        id: 'sales_by_product',
        title: 'Ventas por producto o servicio',
        expectedTextOnScreen: ['Corte & Brushing', 'Mascarilla Argán', 'RD$ 2,700', 'RD$ 2,000'],
        verifyApi: (api) => {
          assert.strictEqual(api.title, 'Ventas por producto o servicio');
          const corte = api.table.rows.find((r) => r.producto_servicio === 'Corte & Brushing');
          const masc = api.table.rows.find((r) => r.producto_servicio === 'Mascarilla Argán');
          assert.strictEqual(corte.cantidad, 2);
          assert.strictEqual(corte.facturacion, 2700);
          assert.strictEqual(masc.cantidad, 2);
          assert.strictEqual(masc.facturacion, 2000);
        },
      },
      {
        id: 'sales_by_client',
        title: 'Ventas por cliente (Mayor consumo)',
        expectedTextOnScreen: ['Valeria Clientes', 'Camila Norte', 'RD$ 3,700', 'RD$ 1,000'],
        verifyApi: (api) => {
          assert.strictEqual(api.title, 'Ventas por cliente (Mayor consumo)');
          assert.strictEqual(api.table.rows[0].cliente, 'Valeria Clientes');
          assert.strictEqual(api.table.rows[0].consumo_total, 3700);
          assert.strictEqual(api.table.rows[1].cliente, 'Camila Norte');
          assert.strictEqual(api.table.rows[1].consumo_total, 1000);
        },
      },
      {
        id: 'payment_methods',
        title: 'Cobros por método de pago',
        expectedTextOnScreen: ['RD$ 3,700', 'RD$ 2,200', 'RD$ 1,500', 'Efectivo', 'Tarjeta'],
        verifyApi: (api) => {
          assert.strictEqual(api.title, 'Cobros por método de pago');
          assert.strictEqual(api.kpis[0].value, 'RD$ 3,700');
          assert.strictEqual(api.kpis[1].value, 'RD$ 2,200');
          assert.strictEqual(api.kpis[2].value, 'RD$ 1,500');
          assert.strictEqual(api.table.rows.length, 3);
        },
      },
      {
        id: 'accounts_receivable',
        title: 'Cuentas por cobrar',
        expectedTextOnScreen: ['Camila Norte', 'RD$ 1,000', 'Sucursal Norte', 'Pendiente'],
        verifyApi: (api) => {
          assert.strictEqual(api.title, 'Cuentas por cobrar');
          assert.strictEqual(api.kpis[0].value, 'RD$ 1,000');
          assert.strictEqual(api.table.rows.length, 1);
          assert.strictEqual(api.table.rows[0].cliente, 'Camila Norte');
          assert.strictEqual(api.table.rows[0].saldo_pendiente, 1000);
        },
      },
      {
        id: 'cancelled_tickets',
        title: 'Tickets cancelados',
        expectedTextOnScreen: ['Cliente se retiró por emergencia', 'Camila Norte', 'RD$ 1,500'],
        verifyApi: (api) => {
          assert.strictEqual(api.title, 'Tickets cancelados');
          assert.strictEqual(api.kpis[0].value, '1');
          assert.strictEqual(api.kpis[1].value, 'RD$ 1,500');
          assert.strictEqual(api.table.rows[0].motivo, 'Cliente se retiró por emergencia');
        },
      },
      {
        id: 'voided_invoices',
        title: 'Facturas anuladas',
        expectedTextOnScreen: ['B0200000002', 'Error en digitación de factura', 'RD$ 1,000'],
        verifyApi: (api) => {
          assert.strictEqual(api.title, 'Facturas anuladas');
          assert.strictEqual(api.kpis[0].value, '1');
          assert.strictEqual(api.kpis[1].value, 'RD$ 1,000');
          assert.strictEqual(api.table.rows[0].ncf, 'B0200000002');
        },
      },
      {
        id: 'applied_discounts',
        title: 'Descuentos aplicados',
        expectedTextOnScreen: ['RD$ 300', 'Valeria Clientes', 'RD$ 1,500', 'RD$ 1,200'],
        verifyApi: (api) => {
          assert.strictEqual(api.title, 'Descuentos aplicados');
          assert.strictEqual(api.kpis[0].value, 'RD$ 300');
          assert.strictEqual(api.table.rows.length, 1);
          assert.strictEqual(api.table.rows[0].precio_base, 1500);
          assert.strictEqual(api.table.rows[0].descuento, 300);
          assert.strictEqual(api.table.rows[0].precio_final, 1200);
        },
      },
      {
        id: 'cash_membership_payments',
        title: 'Pagos en efectivo',
        expectedTextOnScreen: ['RD$ 2,200', 'Valeria Clientes', 'RD$ 1,000', 'RD$ 1,200'],
        verifyApi: (api) => {
          assert.strictEqual(api.title, 'Pagos en efectivo');
          assert.strictEqual(api.kpis[0].value, 'RD$ 2,200');
          assert.strictEqual(api.table.rows.length, 2);
        },
      },
      {
        id: 'sales_itbis',
        title: 'ITBIS en ventas',
        expectedTextOnScreen: ['RD$ 150', 'RD$ 850', 'B0200000001'],
        verifyApi: (api) => {
          assert.strictEqual(api.title, 'ITBIS en ventas');
          assert.strictEqual(api.kpis[1].value, 'RD$ 850');
          assert.strictEqual(api.kpis[3].value, 'RD$ 150');
        },
      },
      {
        id: 'joint_purchases',
        title: 'Comportamiento de compra conjunta',
        expectedTextOnScreen: ['Corte & Brushing + Mascarilla Argán', '33.33%', 'RD$ 2,500'],
        verifyApi: (api) => {
          assert.strictEqual(api.title, 'Comportamiento de compra conjunta');
          assert.strictEqual(api.kpis[0].value, '1');
          assert.strictEqual(api.table.rows.length, 1);
          assert.strictEqual(api.table.rows[0].combinacion, 'Corte & Brushing + Mascarilla Argán');
        },
      },
    ];

    for (const rep of expectedReportsMatrix) {
      // Seleccionar reporte en el <select> real de la interfaz
      const selected = await page.evaluate((repId) => {
        const selects = Array.from(document.querySelectorAll('select'));
        const repSelect = selects.find((s) => Array.from(s.options).some((o) => o.value === 'sales_summary'));
        if (!repSelect) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(repSelect, repId);
        repSelect.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, rep.id);
      assert.strictEqual(selected, true, `Debe existir opción ${rep.id} en el selector de reportes`);

      await page.waitForFunction(
        (expectedTitle) => document.body.innerText.includes(expectedTitle),
        { timeout: 10000 },
        rep.title
      );

      // Verificar en API
      const apiRes = await apiCall('GET', `/api/reports/bi?category=sales&reportId=${rep.id}&salonId=all`);
      assert.strictEqual(apiRes.status, 200, `API /api/reports/bi?reportId=${rep.id} devolvió ${apiRes.status}`);
      rep.verifyApi(apiRes.data);

      // Verificar en Pantalla (DOM) y ausencia de contaminación de Empresa B (9,999)
      const screenText = await page.evaluate(() => document.body.innerText);
      for (const expectedFragment of rep.expectedTextOnScreen) {
        assert.strictEqual(
          screenText.includes(expectedFragment),
          true,
          `Reporte "${rep.id}" en pantalla no contiene "${expectedFragment}"`
        );
      }
      assert.strictEqual(screenText.includes('Cliente Empresa B'), false, 'Cero contaminación cross-tenant de Empresa B');
      assert.strictEqual(screenText.includes('9,999'), false, 'Cero montos de Empresa B');
    }

    console.log('  ✅ [2/3] Los 11 reportes del selector de ventas/cobros validados (Pantalla == API == BD, 2 sucursales, 0 contaminación cross-tenant) PASS.');

    // =========================================================================
    // PARTE C: CIERRE DE CAJA Y COHERENCIA EXACTA ENTRE CAJA Y REPORTES
    // =========================================================================
    // Caja Central (REG_A1_ID):
    // - Fondo inicial: RD$ 2,000
    // - Efectivo neto de ventas válidas: RD$ 1,000 (VISIT_1) + RD$ 1,200 (VISIT_2) = RD$ 2,200 (coincide con reporte Pagos en efectivo!)
    // - Tarjeta neta de ventas válidas: RD$ 1,500 (VISIT_1) (coincide con reporte Cobros por método de pago!)
    // - Transferencia neta de ventas válidas: RD$ 0 (VISIT_5 por RD$ 1,000 fue anulada!)
    // - Efectivo esperado en caja Central: 2,000 + 2,200 = RD$ 4,200
    const movsA1 = await apiCall('GET', `/api/cash-registers/${REG_A1_ID}/movements`);
    assert.strictEqual(movsA1.status, 200);
    assert.strictEqual(Number(movsA1.data.summary.ventas_efectivo), 2200, 'Efectivo en caja debe coincidir con reporte Pagos en efectivo (2,200)');
    assert.strictEqual(Number(movsA1.data.summary.ventas_tarjeta), 1500, 'Tarjeta en caja debe coincidir con reporte Métodos de pago (1,500)');
    assert.strictEqual(Number(movsA1.data.summary.ventas_transferencia), 0, 'Transferencia de factura anulada no debe inflar caja');
    assert.strictEqual(Number(movsA1.data.summary.expected_cash), 4200, 'Efectivo esperado en caja Central debe ser 4,200');

    const closeA1 = await apiCall('POST', `/api/cash-registers/${REG_A1_ID}/close`, {
      closing_balance: 4200,
      notes: 'Cierre exacto Bloque 1',
    });
    assert.strictEqual(closeA1.status, 200);
    assert.strictEqual(Number(closeA1.data.difference), 0);

    assert.strictEqual(pageErrors.length, 0, `pageerrors detectados: ${pageErrors.join(' | ')}`);
    assert.strictEqual(unexpectedApiErrors.length, 0, `Errores 5xx detectados: ${unexpectedApiErrors.join(' | ')}`);
    console.log('  ✅ [3/3] Coherencia total Caja Central (Efectivo 2,200, Tarjeta 1,500, Esperado 4,200, Diferencia 0) vs Reportes BI PASS.');
    console.log('\n🎉 BLOQUE 1 — REPORTES Y REGRESIÓN OPERATIVA SUPERADO (11/11 REPORTES + RECORRIDO OPERATIVO PASS).');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (serverProc && !serverProc.killed) serverProc.kill();

    for (const tid of [TENANT_A, TENANT_B]) {
      await pool.query('DELETE FROM invoice_audit_logs WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM employee_commissions_log WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM cash_register_movements WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM visits WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM cash_registers WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM ticket_sequences WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM inventory_movements WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM inventory_stocks WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM inventory_locations WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM dgii_ncf_sequences WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM services WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM staff_records WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM clients WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM user_sessions WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM security_audit_logs WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM salons WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM branches WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM users WHERE tenant_id = ?', [tid]).catch(() => {});
      await pool.query('DELETE FROM tenants WHERE id = ?', [tid]).catch(() => {});
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ FALLO EN BLOQUE 1 (REPORTES Y REGRESIÓN OPERATIVA):', err);
  process.exit(1);
});
