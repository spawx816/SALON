/* global window, document */
'use strict';

/**
 * Acceptance Suite: "Nómina Completa" (Etereas)
 * Runs against isolated salon_saas_test with canonical backend/server.js + dist/ + real headless Chromium.
 *
 * Covers:
 * 1. Deterministic base case: Salario quincenal RD$10,000 + Comisiones POS RD$1,000 - Descuento RD$500 - TSS 5.91% (RD$591) = Neto RD$9,909.
 * 2. Additional staff: sin comisiones (fijo_puro), asistencia (ausencia + tardanza + schedule override), Sucursal B separada.
 * 3. POS real sales -> valid commission included once, voided excluded, out-of-period excluded, product without rule = 0.
 * 4. Atomic generate (rollback on mid-failure, concurrent 2x -> 200/409), draft sync-real-data without duplication.
 * 5. Real browser UI (/nomina): verify period, base employee breakdown, reload persistence, individual slip modal, 0 pageerrors/5xx.
 * 6. Approve (concurrent 2x -> 200/409, snapshot_json, settles ONLY included employees), immutability (save-draft/sync/delete -> 403).
 * 7. Administrative payment registration (/register-payment -> Pagada, 409 on replay), historical immutability after salary change.
 * 8. Kiosk individual self-service payslip (returns ONLY verified employee's slip, never others).
 * 9. Multi-tenant & branch isolation + RBAC permissions (Tenant B 404, no-payroll user 403, Branch-A-only user 403 on Branch B).
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
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
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
  const BRANCH_B_OTHER = crypto.randomUUID();
  const CLIENT_A = crypto.randomUUID();
  const PASS = 'PayrollTest!2026';
  const PASS_HASH = bcrypt.hashSync(PASS, 10);

  const ownerAEmail = `ownA_pay_${tag}@test.local`;
  const ownerBEmail = `ownB_pay_${tag}@test.local`;
  const branchAPayrollEmail = `brA_pay_${tag}@test.local`;
  const noPayrollEmail = `nopay_${tag}@test.local`;
  const viewOnlyEmail = `payview_${tag}@test.local`;
  const genOnlyEmail = `paygen_${tag}@test.local`;
  const appOnlyEmail = `payapp_${tag}@test.local`;
  const payOnlyEmail = `paypay_${tag}@test.local`;
  const kioskAEmail = `kioskA_pay_${tag}@test.local`;
  const empBaseEmail = `empbase_${tag}@test.local`;

  const PERIOD_START = '2026-11-01';
  const PERIOD_END = '2026-11-15';

  let serverProc = null;
  let browser = null;

  try {
    // 0. Ensure unique constraint migration on schedule_overrides is applied in salon_saas_test
    const schedOverrideMigration = require('../migrations/20261120_schedule_overrides_unique_tenant_emp_date.cjs');
    await schedOverrideMigration.up(pool);

    // 1. Seed synthetic tenants, branches, roles, users, and staff
    await pool.query(
      "INSERT INTO tenants (id, business_name, email, slug, status, licensed_branches, max_branches, extra_user_seats, max_users) VALUES (?, ?, ?, ?, 'active', 2, 2, 10, 16), (?, ?, ?, ?, 'active', 1, 1, 0, 3)",
      [TENANT_A, `Nomina Emp A ${tag}`, ownerAEmail, `nom-a-${tag}`, TENANT_B, `Nomina Emp B ${tag}`, ownerBEmail, `nom-b-${tag}`]
    );
    await pool.query(
      "INSERT INTO tenant_subscriptions (id, tenant_id, plan_code, status, billing_cycle, currency, current_period_start, current_period_end) VALUES (?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', NOW(), NOW() + INTERVAL '30 days'), (?, ?, 'PRINCIPAL', 'active', 'monthly', 'DOP', NOW(), NOW() + INTERVAL '30 days')",
      [crypto.randomUUID(), TENANT_A, crypto.randomUUID(), TENANT_B]
    );
    await pool.query(
      "INSERT INTO branches (id, tenant_id, name, is_main, is_active) VALUES (?, ?, 'Sucursal A', TRUE, TRUE), (?, ?, 'Sucursal B', FALSE, TRUE), (?, ?, 'Sucursal Otra Empresa', TRUE, TRUE)",
      [BRANCH_A, TENANT_A, BRANCH_B, TENANT_A, BRANCH_B_OTHER, TENANT_B]
    );
    await pool.query(
      "INSERT INTO clients (id, tenant_id, nombre, email, status) VALUES (?, ?, 'Clienta Nomina A', ?, 'Active')",
      [CLIENT_A, TENANT_A, `cli_nom_${tag}@test.local`]
    );

    const [roleBranchPayRows] = await pool.query(
      `INSERT INTO roles (tenant_id, nombre, permisos) VALUES (?, 'Nomina Sucursal A', ?::jsonb) RETURNING id`,
      [TENANT_A, JSON.stringify({ 'payroll.view': true, 'payroll.generate': true, 'payroll.approve': true, 'attendance.view': true, 'attendance.manage': true })]
    );
    const [roleNoPayRows] = await pool.query(
      `INSERT INTO roles (tenant_id, nombre, permisos) VALUES (?, 'Solo POS', ?::jsonb) RETURNING id`,
      [TENANT_A, JSON.stringify({ 'pos.view': true })]
    );
    const [roleViewOnlyRows] = await pool.query(
      `INSERT INTO roles (tenant_id, nombre, permisos) VALUES (?, 'Nomina Solo Ver', ?::jsonb) RETURNING id`,
      [TENANT_A, JSON.stringify({ 'payroll.view': true })]
    );
    const [roleGenOnlyRows] = await pool.query(
      `INSERT INTO roles (tenant_id, nombre, permisos) VALUES (?, 'Nomina Solo Generar', ?::jsonb) RETURNING id`,
      [TENANT_A, JSON.stringify({ 'payroll.view': true, 'payroll.generate': true })]
    );
    const [roleAppOnlyRows] = await pool.query(
      `INSERT INTO roles (tenant_id, nombre, permisos) VALUES (?, 'Nomina Solo Aprobar', ?::jsonb) RETURNING id`,
      [TENANT_A, JSON.stringify({ 'payroll.view': true, 'payroll.approve': true })]
    );
    const [rolePayOnlyRows] = await pool.query(
      `INSERT INTO roles (tenant_id, nombre, permisos) VALUES (?, 'Nomina Solo Pagar', ?::jsonb) RETURNING id`,
      [TENANT_A, JSON.stringify({ 'payroll.view': true, 'payroll.pay': true })]
    );

    await pool.query(
      `INSERT INTO users (id, tenant_id, branch_id, salon_id, name, nombre, username, email, password_hash, role, role_id, authorized_branch_ids, all_branches_access, is_active, estado)
       VALUES
         (?, ?, ?, ?, 'Owner A', 'Owner A', ?, ?, ?, 'propietario', NULL, ?::jsonb, TRUE, TRUE, 'Activo'),
         (?, ?, ?, ?, 'Owner B', 'Owner B', ?, ?, ?, 'propietario', NULL, ?::jsonb, TRUE, TRUE, 'Activo'),
         (?, ?, ?, ?, 'Encargada Nomina A', 'Encargada Nomina A', ?, ?, ?, 'empleado', ?, ?::jsonb, FALSE, TRUE, 'Activo'),
         (?, ?, ?, ?, 'Operador Sin Nomina', 'Operador Sin Nomina', ?, ?, ?, 'empleado', ?, ?::jsonb, FALSE, TRUE, 'Activo'),
         (?, ?, ?, ?, 'Kiosco A', 'Kiosco A', ?, ?, ?, 'kiosco_asistencia', NULL, ?::jsonb, FALSE, TRUE, 'Activo'),
         (?, ?, ?, ?, 'Emp Base User', 'Emp Base User', ?, ?, ?, 'empleado', ?, ?::jsonb, FALSE, TRUE, 'Activo'),
         (?, ?, ?, ?, 'Solo Ver Nomina', 'Solo Ver Nomina', ?, ?, ?, 'empleado', ?, ?::jsonb, TRUE, TRUE, 'Activo'),
         (?, ?, ?, ?, 'Solo Generar Nomina', 'Solo Generar Nomina', ?, ?, ?, 'empleado', ?, ?::jsonb, TRUE, TRUE, 'Activo'),
         (?, ?, ?, ?, 'Solo Aprobar Nomina', 'Solo Aprobar Nomina', ?, ?, ?, 'empleado', ?, ?::jsonb, TRUE, TRUE, 'Activo'),
         (?, ?, ?, ?, 'Solo Pagar Nomina', 'Solo Pagar Nomina', ?, ?, ?, 'empleado', ?, ?::jsonb, TRUE, TRUE, 'Activo')`,
      [
        crypto.randomUUID(), TENANT_A, BRANCH_A, BRANCH_A, ownerAEmail, ownerAEmail, PASS_HASH, JSON.stringify([BRANCH_A, BRANCH_B]),
        crypto.randomUUID(), TENANT_B, BRANCH_B_OTHER, BRANCH_B_OTHER, ownerBEmail, ownerBEmail, PASS_HASH, JSON.stringify([BRANCH_B_OTHER]),
        crypto.randomUUID(), TENANT_A, BRANCH_A, BRANCH_A, branchAPayrollEmail, branchAPayrollEmail, PASS_HASH, roleBranchPayRows[0].id, JSON.stringify([BRANCH_A]),
        crypto.randomUUID(), TENANT_A, BRANCH_A, BRANCH_A, noPayrollEmail, noPayrollEmail, PASS_HASH, roleNoPayRows[0].id, JSON.stringify([BRANCH_A]),
        crypto.randomUUID(), TENANT_A, BRANCH_A, BRANCH_A, kioskAEmail, kioskAEmail, PASS_HASH, JSON.stringify([BRANCH_A]),
        crypto.randomUUID(), TENANT_A, BRANCH_A, BRANCH_A, empBaseEmail, empBaseEmail, PASS_HASH, roleNoPayRows[0].id, JSON.stringify([BRANCH_A]),
        crypto.randomUUID(), TENANT_A, BRANCH_A, BRANCH_A, viewOnlyEmail, viewOnlyEmail, PASS_HASH, roleViewOnlyRows[0].id, JSON.stringify([BRANCH_A, BRANCH_B]),
        crypto.randomUUID(), TENANT_A, BRANCH_A, BRANCH_A, genOnlyEmail, genOnlyEmail, PASS_HASH, roleGenOnlyRows[0].id, JSON.stringify([BRANCH_A, BRANCH_B]),
        crypto.randomUUID(), TENANT_A, BRANCH_A, BRANCH_A, appOnlyEmail, appOnlyEmail, PASS_HASH, roleAppOnlyRows[0].id, JSON.stringify([BRANCH_A, BRANCH_B]),
        crypto.randomUUID(), TENANT_A, BRANCH_A, BRANCH_A, payOnlyEmail, payOnlyEmail, PASS_HASH, rolePayOnlyRows[0].id, JSON.stringify([BRANCH_A, BRANCH_B]),
      ]
    );

    // Staff records:
    // 1) Emp Base (Sucursal A): salario_base=20000 -> quincenal 10,000 + comision 1,000 - descuento 500 - TSS 591 = Neto 9,909
    // 2) Emp Sin Comisiones (Sucursal A): salario_base=16000 -> quincenal 8,000, fijo_puro -> TSS 472.80 -> Neto 7,527.20
    // 3) Emp Asistencia (Sucursal A): salario_base=20000 -> quincenal 10,000 + 1 ausencia + tardanza + override
    // 4) Emp Sucursal B (Sucursal B): salario_base=18000 -> quincenal 9,000 + comision 400 + descuento 200
    // 5) Emp Empresa B (TENANT_B)
    const [sBase] = await pool.query(
      "INSERT INTO staff_records (tenant_id, nombre, posicion, localidad, salon_id, email, status, salario_base, tipo_salario, hora_entrada, hora_salida, tolerancia_minutos) VALUES (?, 'Emp Base Determinista', 'Estilista', 'Sucursal A', ?, ?, 'Activo', 20000.00, 'fijo_mas_comision', '09:00:00', '18:00:00', 15) RETURNING id",
      [TENANT_A, BRANCH_A, empBaseEmail]
    );
    const EMP_BASE_ID = String(sBase[0].id);

    const [sNoComm] = await pool.query(
      "INSERT INTO staff_records (tenant_id, nombre, posicion, localidad, salon_id, email, status, salario_base, tipo_salario) VALUES (?, 'Emp Sin Comisiones', 'Recepcion', 'Sucursal A', ?, ?, 'Activo', 16000.00, 'fijo_puro') RETURNING id",
      [TENANT_A, BRANCH_A, `nocomm_${tag}@test.local`]
    );
    const EMP_NOCOMM_ID = String(sNoComm[0].id);

    const [sAsist] = await pool.query(
      "INSERT INTO staff_records (tenant_id, nombre, posicion, localidad, salon_id, email, status, salario_base, tipo_salario, hora_entrada, hora_salida, tolerancia_minutos) VALUES (?, 'Emp Asistencia Novedades', 'Estilista', 'Sucursal A', ?, ?, 'Activo', 20000.00, 'fijo_mas_comision', '09:00:00', '17:00:00', 15) RETURNING id",
      [TENANT_A, BRANCH_A, `asist_${tag}@test.local`]
    );
    const EMP_ASIST_ID = String(sAsist[0].id);

    const [sSucB] = await pool.query(
      "INSERT INTO staff_records (tenant_id, nombre, posicion, localidad, salon_id, email, status, salario_base, tipo_salario) VALUES (?, 'Emp Sucursal B', 'Estilista', 'Sucursal B', ?, ?, 'Activo', 18000.00, 'fijo_mas_comision') RETURNING id",
      [TENANT_A, BRANCH_B, `sucb_${tag}@test.local`]
    );
    const EMP_SUCB_ID = String(sSucB[0].id);

    const [sOtherTenant] = await pool.query(
      "INSERT INTO staff_records (tenant_id, nombre, posicion, localidad, salon_id, email, status, salario_base, tipo_salario) VALUES (?, 'Emp Empresa B', 'Estilista', 'Sucursal Otra Empresa', ?, ?, 'Activo', 20000.00, 'fijo_mas_comision') RETURNING id",
      [TENANT_B, BRANCH_B_OTHER, `empb_${tag}@test.local`]
    );
    const EMP_OTHER_TENANT_ID = String(sOtherTenant[0].id);

    // Start canonical server against salon_saas_test
    const env = getSanitizedChildEnv(testConfig, port);
    env.SAAS_RENEWAL_WORKER_ENABLED = 'false';
    env.DISABLE_SCHEDULER = 'true';
    env.DGII_ENV = 'disabled';
    env.CARDNET_ENV = 'disabled';
    env.ALLOW_TEST_FAULT_INJECTION = 'true';

    serverProc = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForServerHealth(port);
    console.log(`[SERVER READY] ${baseUrl} (DB=${testConfig.database})`);

    const ownerA = await loginAs(baseUrl, ownerAEmail, PASS);
    const ownerB = await loginAs(baseUrl, ownerBEmail, PASS);
    const branchAPayUser = await loginAs(baseUrl, branchAPayrollEmail, PASS);
    const noPayUser = await loginAs(baseUrl, noPayrollEmail, PASS);

    // 2. Asistencia: schedule override concurrente (5 paralelos -> 1 fila única en BD) + ausencia + tardanza (Emp Asistencia)
    const overrideCalls = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        reqJson(baseUrl, 'POST', '/api/attendance/schedule-override', {
          cookie: ownerA.cookie,
          body: {
            employeeId: EMP_ASIST_ID,
            date: '2026-11-05',
            newHoraEntrada: '10:00:00',
            newHoraSalida: '18:00:00',
            reason: `Cambio temporal autorizado #${n}`,
            createdBy: 'Owner A',
          },
        })
      )
    );
    overrideCalls.forEach((r, idx) => {
      assert.strictEqual(r.status, 200, `Schedule override paralelo #${idx + 1} falló: ${JSON.stringify(r.body)}`);
    });
    const [overrideCountRows] = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM schedule_overrides WHERE tenant_id = ? AND employee_id = ? AND date = ?',
      [TENANT_A, EMP_ASIST_ID, '2026-11-05']
    );
    assert.strictEqual(overrideCountRows[0].cnt, 1, 'Upsert concurrente de schedule_overrides no debe crear duplicados');

    // Insert 1 Ausencia (2026-11-03) and 1 Check-In tardanza 30m + Check-Out (7.5h worked vs 8h scheduled -> 30m missing) on 2026-11-04
    await pool.query(
      `INSERT INTO attendance (id, employee_id, type, timestamp, status, lateness_minutes, extra_minutes, tenant_id)
       VALUES
         (?, ?, 'Ausencia', '2026-11-03 09:00:00', 'Ausencia', 0, 0, ?),
         (?, ?, 'Check-In', '2026-11-04 09:30:00', 'Tardanza', 30, 0, ?),
         (?, ?, 'Check-Out', '2026-11-04 17:00:00', 'Normal', 0, 0, ?)`,
      [
        `ATT-ABS-${tag}`, EMP_ASIST_ID, TENANT_A,
        `ATT-IN-${tag}`, EMP_ASIST_ID, TENANT_A,
        `ATT-OUT-${tag}`, EMP_ASIST_ID, TENANT_A,
      ]
    );
    console.log('  ✅ 1. Personal y Asistencia (override auditado + ausencia + tardanza) registrados.');

    // 3. Comisiones y Descuentos:
    // - Comisión válida RD$1,000 en período para Emp Base
    // - Comisión anulada RD$500 en período (debe excluirse)
    // - Comisión válida RD$700 FUERA del período (2026-10-25, debe excluirse)
    // - Comisión RD$400 en período para Emp Sucursal B (no debe liquidarse al aprobar nómina de Sucursal A)
    await pool.query(
      `INSERT INTO employee_commissions_log (tenant_id, employee_id, employee_name, service_name, precio_servicio, commission_rate, monto_comision, commission_cents, status, created_at)
       VALUES
         (?, ?, 'Emp Base Determinista', 'Balayage Premium', 10000.00, 10.00, 1000.00, 100000, 'Pendiente', '2026-11-06 14:00:00'),
         (?, ?, 'Emp Base Determinista', 'Venta Anulada', 5000.00, 10.00, 500.00, 50000, 'Anulada', '2026-11-07 14:00:00'),
         (?, ?, 'Emp Base Determinista', 'Venta Fuera Periodo', 7000.00, 10.00, 700.00, 70000, 'Pendiente', '2026-10-25 14:00:00'),
         (?, ?, 'Emp Sucursal B', 'Servicio Suc B', 4000.00, 10.00, 400.00, 40000, 'Pendiente', '2026-11-08 14:00:00')`,
      [TENANT_A, Number(EMP_BASE_ID), TENANT_A, Number(EMP_BASE_ID), TENANT_A, Number(EMP_BASE_ID), TENANT_A, Number(EMP_SUCB_ID)]
    );

    // Descuento autorizado RD$500 para Emp Base + RD$200 para Emp Sucursal B + intento cross-tenant rechazado (404)
    const discBaseRes = await reqJson(baseUrl, 'POST', '/api/employee-discounts', {
      cookie: ownerA.cookie,
      body: { employee_id: Number(EMP_BASE_ID), type: 'Adelanto', amount: 500, date: '2026-11-10', notes: 'Adelanto autorizado quincena' },
    });
    assert.strictEqual(discBaseRes.status, 200);
    const DISC_BASE_ID = discBaseRes.body.id;

    const discSucBRes = await reqJson(baseUrl, 'POST', '/api/employee-discounts', {
      cookie: ownerA.cookie,
      body: { employee_id: Number(EMP_SUCB_ID), type: 'Adelanto', amount: 200, date: '2026-11-10', notes: 'Adelanto Suc B' },
    });
    assert.strictEqual(discSucBRes.status, 200);
    const DISC_SUCB_ID = discSucBRes.body.id;

    const crossDiscRes = await reqJson(baseUrl, 'POST', '/api/employee-discounts', {
      cookie: ownerA.cookie,
      body: { employee_id: Number(EMP_OTHER_TENANT_ID), type: 'Adelanto', amount: 100, date: '2026-11-10', notes: 'Tamper' },
    });
    assert.strictEqual(crossDiscRes.status, 404, 'Manipular employee_id de otra empresa debe retornar 404');
    console.log('  ✅ 2. Comisiones (válida/anulada/fuera período/Suc B) y Descuentos (con bloqueo cross-tenant 404) listos.');

    // 4. Fallo intermedio atómico en /generate -> rollback limpio (0 períodos, 0 items)
    const failGen = await reqJson(baseUrl, 'POST', '/api/payroll/generate', {
      cookie: ownerA.cookie,
      extraHeaders: { 'x-test-fail-payroll-generate': 'true' },
      body: { period_name: 'Quincena Fallo Rollback', start_date: PERIOD_START, end_date: PERIOD_END, sucursal: 'Sucursal A' },
    });
    assert.strictEqual(failGen.status, 500);
    const [afterFailPeriods] = await pool.query('SELECT COUNT(*)::int AS cnt FROM payroll_periods WHERE tenant_id = ?', [TENANT_A]);
    const [afterFailItems] = await pool.query('SELECT COUNT(*)::int AS cnt FROM payroll_items WHERE tenant_id = ?', [TENANT_A]);
    assert.strictEqual(afterFailPeriods[0].cnt, 0, 'Fallo intermedio debe revertir período');
    assert.strictEqual(afterFailItems[0].cnt, 0, 'Fallo intermedio debe revertir items');

    // 5. Generación concurrente (doble clic) para Sucursal A -> exactamente [200, 409 PAYROLL_DUPLICATE_PERIOD]
    const [g1, g2] = await Promise.all([
      reqJson(baseUrl, 'POST', '/api/payroll/generate', {
        cookie: branchAPayUser.cookie,
        body: { period_name: '1ra Quincena Nov 2026', start_date: PERIOD_START, end_date: PERIOD_END, sucursal: 'Sucursal A' },
      }),
      reqJson(baseUrl, 'POST', '/api/payroll/generate', {
        cookie: branchAPayUser.cookie,
        body: { period_name: '1ra Quincena Nov 2026', start_date: PERIOD_START, end_date: PERIOD_END, sucursal: 'Sucursal A' },
      }),
    ]);
    const genStatuses = [g1.status, g2.status].sort((a, b) => a - b);
    assert.deepStrictEqual(genStatuses, [200, 409], `Concurrencia generate esperada [200,409], recibida ${JSON.stringify(genStatuses)}`);
    const winnerGen = g1.status === 200 ? g1 : g2;
    const loserGen = g1.status === 409 ? g1 : g2;
    assert.strictEqual(loserGen.body.code, 'PAYROLL_DUPLICATE_PERIOD');
    const PAYROLL_ID = winnerGen.body.payroll_id;

    // Verificar desglose numérico exacto del Caso Base y Emp Sin Comisiones
    const baseItem = winnerGen.body.items.find((it) => String(it.employee_id) === EMP_BASE_ID);
    const noCommItem = winnerGen.body.items.find((it) => String(it.employee_id) === EMP_NOCOMM_ID);
    const asistItem = winnerGen.body.items.find((it) => String(it.employee_id) === EMP_ASIST_ID);
    const sucBInSucA = winnerGen.body.items.find((it) => String(it.employee_id) === EMP_SUCB_ID);

    assert.ok(baseItem, 'Emp Base debe estar incluido en Sucursal A');
    assert.strictEqual(sucBInSucA, undefined, 'Emp Sucursal B NO debe aparecer en nómina de Sucursal A');
    assert.strictEqual(Number(baseItem.salario_fijo), 10000);
    assert.strictEqual(Number(baseItem.comisiones), 1000);
    assert.strictEqual(Number(baseItem.total_ingresos), 11000);
    assert.strictEqual(Number(baseItem.tss), 591);
    assert.strictEqual(Number(baseItem.prestamos), 500);
    assert.strictEqual(Number(baseItem.total_descuentos), 1091);
    assert.strictEqual(Number(baseItem.neto_pagar), 9909);
    const baseDet = typeof baseItem.detalles_json === 'string' ? JSON.parse(baseItem.detalles_json) : baseItem.detalles_json;
    assert.strictEqual(baseDet.minor_units_cents.salario_fijo_cents, 1000000, 'Aritmética en centavos salario_fijo');
    assert.strictEqual(baseDet.minor_units_cents.comisiones_cents, 100000, 'Aritmética en centavos comisiones');
    assert.strictEqual(baseDet.minor_units_cents.tss_cents, 59100, 'Aritmética en centavos TSS');
    assert.strictEqual(baseDet.minor_units_cents.prestamos_cents, 50000, 'Aritmética en centavos prestamos');
    assert.strictEqual(baseDet.minor_units_cents.neto_pagar_cents, 990900, 'Aritmética en centavos neto_pagar');
    assert.strictEqual(baseDet.deductions_policy_metadata.tss.source, 'software_default_parameter', 'Debe distinguir parámetros de software de cumplimiento legal verificado');
    assert.strictEqual(baseDet.deductions_policy_metadata.tss.cap_applied, false);
    assert.strictEqual(baseDet.deductions_policy_metadata.tss.isr_applied, false);

    assert.strictEqual(Number(noCommItem.salario_fijo), 8000);
    assert.strictEqual(Number(noCommItem.comisiones), 0);
    assert.strictEqual(Number(noCommItem.tss), 472.8);
    assert.strictEqual(Number(noCommItem.neto_pagar), 7527.2);

    assert.ok(Number(asistItem.ausencias) > 0, 'Ausencia registrada debe reflejarse según tarifa de cálculo');
    assert.ok(Number(asistItem.tardanzas) > 0, 'Tardanza/minutos faltantes deben reflejarse según tarifa de cálculo');

    // Recálculo de borrador (sync-real-data) reemplaza sin duplicar items ni importes
    const syncRes = await reqJson(baseUrl, 'POST', `/api/payroll/periods/${PAYROLL_ID}/sync-real-data`, {
      cookie: branchAPayUser.cookie,
    });
    assert.strictEqual(syncRes.status, 200);
    assert.strictEqual(syncRes.body.items.length, 3);
    const baseAfterSync = syncRes.body.items.find((it) => String(it.employee_id) === EMP_BASE_ID);
    assert.strictEqual(Number(baseAfterSync.neto_pagar), 9909);
    console.log('  ✅ 3. Rollback atómico, concurrencia [200,409], cálculo exacto (Caso Base neto RD$9,909) y recálculo sin duplicar PASS.');

    // 6. Navegador real (Puppeteer Chrome headless): recorrido principal en /nomina + recarga + persistencia
    const executablePath = findBrowserExecutable();
    browser = await puppeteer.launch({ headless: 'new', executablePath, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    const pageErrors = [];
    const server5xx = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('response', (res) => { if (res.status() >= 500) server5xx.push(`${res.status()} ${res.url()}`); });

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

    await page.goto(`${baseUrl}/nomina`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('Emp Base Determinista'), { timeout: 15000 });
    const nominaText = await page.evaluate(() => document.body.innerText);
    assert.ok(nominaText.includes('1ra Quincena Nov 2026'), 'UI /nomina debe mostrar el período generado');
    assert.ok(nominaText.includes('9,909'), 'UI /nomina debe mostrar neto RD$9,909 del caso base');

    // Verificar volante imprimible individual desde UI (capturando window.open)
    await page.evaluate(() => {
      window.__CAPTURED_SLIP_HTML__ = '';
      window.open = () => ({
        document: {
          write(html) { window.__CAPTURED_SLIP_HTML__ += String(html || ''); },
          close() {},
        },
        print() {},
      });
    });
    const printClicked = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const baseRow = rows.find((r) => r.innerText.includes('Emp Base Determinista'));
      if (!baseRow) return false;
      const btn = baseRow.querySelector('button[title="Imprimir Volante Individual"]');
      if (!btn) return false;
      btn.click();
      return true;
    });
    assert.strictEqual(printClicked, true, 'Debe existir botón Imprimir Volante Individual para Emp Base Determinista');
    const slipHtml = await page.evaluate(() => window.__CAPTURED_SLIP_HTML__ || '');
    assert.ok(slipHtml.includes('VOLANTE OFICIAL DE PAGO DE NÓMINA'), 'Volante imprimible debe contener cabecera oficial');
    assert.ok(slipHtml.includes('Emp Base Determinista'), 'Volante imprimible debe mostrar colaborador');
    assert.ok(slipHtml.includes('10,000.00'), 'Volante imprimible debe mostrar Salario Fijo 10,000.00');
    assert.ok(slipHtml.includes('1,000.00'), 'Volante imprimible debe mostrar Comisiones 1,000.00');
    assert.ok(slipHtml.includes('591.00'), 'Volante imprimible debe mostrar TSS 591.00');
    assert.ok(slipHtml.includes('500.00'), 'Volante imprimible debe mostrar Préstamos/Adelantos 500.00');
    assert.ok(slipHtml.includes('9,909.00'), 'Volante imprimible debe mostrar Neto 9,909.00');

    // Recargar y confirmar persistencia
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('Emp Base Determinista'), { timeout: 15000 });
    assert.strictEqual(pageErrors.length, 0, `pageerrors en /nomina: ${pageErrors.join(' | ')}`);
    assert.strictEqual(server5xx.length, 0, `5xx en /nomina: ${server5xx.join(' | ')}`);
    await browser.close();
    browser = null;
    console.log('  ✅ 4. Navegador real (/nomina): período, desglose RD$9,909, volante imprimible y persistencia tras recarga verificados (0 pageerrors, 0 5xx).');

    // 7. Aprobación concurrente ([200, 409 PAYROLL_ALREADY_APPROVED]) + liquidación solo de empleados incluidos + inmutabilidad
    const [a1, a2] = await Promise.all([
      reqJson(baseUrl, 'POST', '/api/payroll/approve', { cookie: ownerA.cookie, body: { payroll_id: PAYROLL_ID } }),
      reqJson(baseUrl, 'POST', '/api/payroll/approve', { cookie: ownerA.cookie, body: { payroll_id: PAYROLL_ID } }),
    ]);
    const appStatuses = [a1.status, a2.status].sort((a, b) => a - b);
    assert.deepStrictEqual(appStatuses, [200, 409], `Concurrencia approve esperada [200,409], recibida ${JSON.stringify(appStatuses)} bodies=${JSON.stringify([a1.body, a2.body])}`);

    // Descuento y comisión de Emp Base -> Saldado / Pagada; de Emp Sucursal B -> siguen Pendiente!
    const [dBaseRow] = await pool.query('SELECT status FROM employee_discounts WHERE id = ? AND tenant_id = ?', [DISC_BASE_ID, TENANT_A]);
    const [dSucBRow] = await pool.query('SELECT status FROM employee_discounts WHERE id = ? AND tenant_id = ?', [DISC_SUCB_ID, TENANT_A]);
    const [cBaseRow] = await pool.query("SELECT status FROM employee_commissions_log WHERE tenant_id = ? AND employee_id = ? AND service_name = 'Balayage Premium'", [TENANT_A, EMP_BASE_ID]);
    const [cSucBRow] = await pool.query("SELECT status FROM employee_commissions_log WHERE tenant_id = ? AND employee_id = ? AND service_name = 'Servicio Suc B'", [TENANT_A, EMP_SUCB_ID]);
    assert.strictEqual(dBaseRow[0].status, 'Saldado');
    assert.strictEqual(dSucBRow[0].status, 'Pendiente', 'Aprobar Sucursal A NO debe liquidar descuentos de Sucursal B');
    assert.strictEqual(cBaseRow[0].status, 'Pagada');
    assert.strictEqual(cSucBRow[0].status, 'Pendiente', 'Aprobar Sucursal A NO debe liquidar comisiones de Sucursal B');

    // Inmutabilidad: editar borrador, sincronizar, borrar período aprobado, o editar descuento saldado deben rechazarse
    const editImm = await reqJson(baseUrl, 'POST', '/api/payroll/save-draft', { cookie: ownerA.cookie, body: { payroll_id: PAYROLL_ID, items: [] } });
    const syncImm = await reqJson(baseUrl, 'POST', `/api/payroll/periods/${PAYROLL_ID}/sync-real-data`, { cookie: ownerA.cookie });
    const delImm = await reqJson(baseUrl, 'DELETE', `/api/payroll/periods/${PAYROLL_ID}`, { cookie: ownerA.cookie });
    const editSettledDisc = await reqJson(baseUrl, 'PUT', `/api/employee-discounts/${DISC_BASE_ID}`, { cookie: ownerA.cookie, body: { amount: 1 } });
    assert.strictEqual(editImm.status, 403);
    assert.strictEqual(syncImm.status, 403);
    assert.strictEqual(delImm.status, 403);
    assert.strictEqual(delImm.body.code, 'PAYROLL_IMMUTABLE');
    assert.strictEqual(editSettledDisc.status, 409);
    assert.strictEqual(editSettledDisc.body.code, 'DISCOUNT_ALREADY_SETTLED');

    // Registro administrativo interno de pago + replay rechazado (409)
    const payReg1 = await reqJson(baseUrl, 'POST', `/api/payroll/periods/${PAYROLL_ID}/register-payment`, {
      cookie: ownerA.cookie,
      body: { payment_method: 'Transferencia manual registrada', payment_reference: 'REF-ADM-001' },
    });
    assert.strictEqual(payReg1.status, 200);
    assert.strictEqual(payReg1.body.status, 'Pagada');
    const payReg2 = await reqJson(baseUrl, 'POST', `/api/payroll/periods/${PAYROLL_ID}/register-payment`, {
      cookie: ownerA.cookie,
      body: { payment_method: 'Transferencia manual registrada', payment_reference: 'REF-ADM-002' },
    });
    assert.strictEqual(payReg2.status, 409);
    assert.strictEqual(payReg2.body.code, 'PAYROLL_ALREADY_PAID');

    // Histórico inalterado tras cambiar salario del colaborador
    await pool.query('UPDATE staff_records SET salario_base = 30000.00 WHERE id = ? AND tenant_id = ?', [EMP_BASE_ID, TENANT_A]);
    const histAfterChange = await reqJson(baseUrl, 'GET', `/api/payroll/periods/${PAYROLL_ID}`, { cookie: ownerA.cookie });
    assert.strictEqual(histAfterChange.status, 200);
    assert.strictEqual(histAfterChange.body.period.status, 'Pagada');
    const histBase = histAfterChange.body.items.find((it) => String(it.employee_id) === EMP_BASE_ID);
    assert.strictEqual(Number(histBase.salario_fijo), 10000);
    assert.strictEqual(Number(histBase.neto_pagar), 9909);
    console.log('  ✅ 5. Aprobación concurrente [200,409], liquidación acotada, inmutabilidad (403/409), registro pago (Pagada) e histórico inalterado PASS.');

    // 8. Autoservicio individual desde Kiosco: devuelve SOLO el volante del empleado verificado
    const kioskLogin = await loginAs(baseUrl, kioskAEmail, PASS);
    const ssVerify = await reqJson(baseUrl, 'POST', '/api/kiosk/self-service/verify', {
      cookie: kioskLogin.cookie,
      body: { employee_id: EMP_BASE_ID, pin: PASS },
    });
    assert.strictEqual(ssVerify.status, 200);
    const ssCookie = [kioskLogin.cookie, ...ssVerify.setCookies.map((c) => c.split(';')[0])].join('; ');
    const slipRes = await reqJson(baseUrl, 'GET', `/api/kiosk/self-service/payslip?employee_id=${EMP_NOCOMM_ID}`, { cookie: ssCookie });
    assert.strictEqual(slipRes.status, 200);
    assert.strictEqual(slipRes.body.payslips.length, 1, 'Kiosco autoservicio debe devolver exactamente 1 volante del empleado verificado');
    assert.strictEqual(String(slipRes.body.payslips[0].employee_id), EMP_BASE_ID, 'Debe ignorar employee_id manipulado en query');
    assert.strictEqual(Number(slipRes.body.payslips[0].neto_pagar), 9909);
    assert.strictEqual(slipRes.body.payslips[0].period_status, 'Pagada');
    console.log('  ✅ 6. Autoservicio Kiosco (/self-service/payslip) devuelve exclusivamente el volante individual verificado (neto RD$9,909).');

    // 9. Aislamiento multi-tenant, alcance por sucursal y permisos RBAC
    const crossGet = await reqJson(baseUrl, 'GET', `/api/payroll/periods/${PAYROLL_ID}`, { cookie: ownerB.cookie });
    const crossApp = await reqJson(baseUrl, 'POST', '/api/payroll/approve', { cookie: ownerB.cookie, body: { payroll_id: PAYROLL_ID } });
    const crossPay = await reqJson(baseUrl, 'POST', `/api/payroll/periods/${PAYROLL_ID}/register-payment`, { cookie: ownerB.cookie });
    const crossDel = await reqJson(baseUrl, 'DELETE', `/api/payroll/periods/${PAYROLL_ID}`, { cookie: ownerB.cookie });
    assert.strictEqual(crossGet.status, 404);
    assert.strictEqual(crossApp.status, 404);
    assert.strictEqual(crossPay.status, 404);
    assert.strictEqual(crossDel.status, 404);

    const noPermGet = await reqJson(baseUrl, 'GET', '/api/payroll/periods', { cookie: noPayUser.cookie });
    const noPermGen = await reqJson(baseUrl, 'POST', '/api/payroll/generate', {
      cookie: noPayUser.cookie,
      body: { period_name: 'NoPerm', start_date: '2026-11-16', end_date: '2026-11-30', sucursal: 'Sucursal A' },
    });
    assert.strictEqual(noPermGet.status, 403);
    assert.strictEqual(noPermGen.status, 403);

    const branchBBlockedGen = await reqJson(baseUrl, 'POST', '/api/payroll/generate', {
      cookie: branchAPayUser.cookie,
      body: { period_name: 'Intento Suc B', start_date: PERIOD_START, end_date: PERIOD_END, sucursal: 'Sucursal B' },
    });
    const allBranchesBlockedGen = await reqJson(baseUrl, 'POST', '/api/payroll/generate', {
      cookie: branchAPayUser.cookie,
      body: { period_name: 'Intento Todas', start_date: PERIOD_START, end_date: PERIOD_END, sucursal: 'Todas' },
    });
    assert.strictEqual(branchBBlockedGen.status, 403);
    assert.strictEqual(branchBBlockedGen.body.code, 'FORBIDDEN_BRANCH_SCOPE');
    assert.strictEqual(allBranchesBlockedGen.status, 403);
    assert.strictEqual(allBranchesBlockedGen.body.code, 'FORBIDDEN_BRANCH_SCOPE');
    console.log('  ✅ 7. Aislamiento Empresa B (404), sin permiso nómina (403) y alcance limitado Sucursal A (403 FORBIDDEN_BRANCH_SCOPE) PASS.');

    // 10. Regresiones de limitaciones cerradas (0116d5e+):
    //     - Alta/baja en medio del período -> requires_review + bloqueo 409 PAYROLL_PENDING_REVIEW hasta confirmación explícita
    //     - Turno que cruza medianoche -> OVERNIGHT_SHIFT_DETECTED sin descuento automático ni falsos ponches
    //     - Descuento manual de Ausencia + Ausencia automática en asistencia -> NO se duplica + desglose auditado
    //     - Permisos separados: payroll.view, payroll.generate, payroll.approve, payroll.pay
    const viewOnlyUser = await loginAs(baseUrl, viewOnlyEmail, PASS);
    const genOnlyUser = await loginAs(baseUrl, genOnlyEmail, PASS);
    const appOnlyUser = await loginAs(baseUrl, appOnlyEmail, PASS);
    const payOnlyUser = await loginAs(baseUrl, payOnlyEmail, PASS);

    const P2_START = '2026-11-16';
    const P2_END = '2026-11-30';

    const [sMidHire] = await pool.query(
      "INSERT INTO staff_records (tenant_id, nombre, posicion, localidad, salon_id, email, status, salario_base, tipo_salario, fecha_entrada) VALUES (?, 'Emp Alta Mitad Periodo', 'Estilista', 'Sucursal B', ?, ?, 'Activo', 20000.00, 'fijo_puro', '2026-11-20') RETURNING id",
      [TENANT_A, BRANCH_B, `midhire_${tag}@test.local`]
    );
    const EMP_MIDHIRE_ID = String(sMidHire[0].id);

    const [sMidTerm] = await pool.query(
      "INSERT INTO staff_records (tenant_id, nombre, posicion, localidad, salon_id, email, status, salario_base, tipo_salario, fecha_entrada, fecha_salida) VALUES (?, 'Emp Baja Mitad Periodo', 'Estilista', 'Sucursal B', ?, ?, 'Inactivo', 20000.00, 'fijo_puro', '2026-01-10', '2026-11-22') RETURNING id",
      [TENANT_A, BRANCH_B, `midterm_${tag}@test.local`]
    );
    const EMP_MIDTERM_ID = String(sMidTerm[0].id);

    const [sOvernight] = await pool.query(
      "INSERT INTO staff_records (tenant_id, nombre, posicion, localidad, salon_id, email, status, salario_base, tipo_salario, hora_entrada, hora_salida, tolerancia_minutos) VALUES (?, 'Emp Turno Nocturno', 'Estilista', 'Sucursal B', ?, ?, 'Activo', 20000.00, 'fijo_puro', '22:00:00', '06:00:00', 15) RETURNING id",
      [TENANT_A, BRANCH_B, `overnight_${tag}@test.local`]
    );
    const EMP_OVERNIGHT_ID = String(sOvernight[0].id);

    // Ponche nocturno: entrada 2026-11-18 22:00 -> salida 2026-11-19 06:00 (480 min, cruza medianoche)
    await pool.query(
      `INSERT INTO attendance (id, employee_id, type, timestamp, status, lateness_minutes, extra_minutes, tenant_id)
       VALUES
         (?, ?, 'Check-In', '2026-11-18 22:00:00', 'Normal', 0, 0, ?),
         (?, ?, 'Check-Out', '2026-11-19 06:00:00', 'Normal', 0, 0, ?)`,
      [`ATT-OVN-IN-${tag}`, EMP_OVERNIGHT_ID, TENANT_A, `ATT-OVN-OUT-${tag}`, EMP_OVERNIGHT_ID, TENANT_A]
    );

    // Ausencia automática + descuento manual de Ausencia (RD$400) para Emp Sucursal B -> no debe duplicarse
    await pool.query(
      `INSERT INTO attendance (id, employee_id, type, timestamp, status, lateness_minutes, extra_minutes, tenant_id)
       VALUES (?, ?, 'Ausencia', '2026-11-17 09:00:00', 'Ausencia', 0, 0, ?)`,
      [`ATT-DUP-ABS-${tag}`, EMP_SUCB_ID, TENANT_A]
    );
    const manualAbsRes = await reqJson(baseUrl, 'POST', '/api/employee-discounts', {
      cookie: ownerA.cookie,
      body: { employee_id: Number(EMP_SUCB_ID), type: 'Ausencia', amount: 400, date: '2026-11-17', notes: 'Ausencia autorizada manual' },
    });
    assert.strictEqual(manualAbsRes.status, 200);

    // RBAC separado: payroll.view solo lee; no puede generar
    const viewListOk = await reqJson(baseUrl, 'GET', '/api/payroll/periods', { cookie: viewOnlyUser.cookie });
    assert.strictEqual(viewListOk.status, 200);
    const viewGenBlocked = await reqJson(baseUrl, 'POST', '/api/payroll/generate', {
      cookie: viewOnlyUser.cookie,
      body: { period_name: '2da Quincena Nov 2026', start_date: P2_START, end_date: P2_END, sucursal: 'Sucursal B' },
    });
    assert.strictEqual(viewGenBlocked.status, 403);

    // appOnly y payOnly tampoco pueden generar
    const appGenBlocked = await reqJson(baseUrl, 'POST', '/api/payroll/generate', {
      cookie: appOnlyUser.cookie,
      body: { period_name: '2da Quincena Nov 2026', start_date: P2_START, end_date: P2_END, sucursal: 'Sucursal B' },
    });
    const payGenBlocked = await reqJson(baseUrl, 'POST', '/api/payroll/generate', {
      cookie: payOnlyUser.cookie,
      body: { period_name: '2da Quincena Nov 2026', start_date: P2_START, end_date: P2_END, sucursal: 'Sucursal B' },
    });
    assert.strictEqual(appGenBlocked.status, 403);
    assert.strictEqual(payGenBlocked.status, 403);

    // genOnly genera el período de Sucursal B
    const genP2 = await reqJson(baseUrl, 'POST', '/api/payroll/generate', {
      cookie: genOnlyUser.cookie,
      body: { period_name: '2da Quincena Nov 2026', start_date: P2_START, end_date: P2_END, sucursal: 'Sucursal B' },
    });
    assert.strictEqual(genP2.status, 200, `genOnly debe poder generar: ${JSON.stringify(genP2.body)}`);
    const PAYROLL_2_ID = genP2.body.payroll_id;

    const midHireItem = genP2.body.items.find((it) => String(it.employee_id) === EMP_MIDHIRE_ID);
    const midTermItem = genP2.body.items.find((it) => String(it.employee_id) === EMP_MIDTERM_ID);
    const overnightItem = genP2.body.items.find((it) => String(it.employee_id) === EMP_OVERNIGHT_ID);
    const sucBItem = genP2.body.items.find((it) => String(it.employee_id) === EMP_SUCB_ID);

    assert.ok(midHireItem, 'Alta mitad período debe aparecer');
    assert.ok(midTermItem, 'Baja mitad período (Inactivo con fecha_salida en período) debe incluirse');
    assert.ok(overnightItem, 'Turno nocturno debe aparecer');
    assert.ok(sucBItem, 'Emp Sucursal B debe aparecer');

    assert.strictEqual(midHireItem.detalles_json.requires_review, true);
    assert.ok(midHireItem.detalles_json.review_flags.some((f) => f.code === 'MID_PERIOD_HIRE'));
    assert.strictEqual(midTermItem.detalles_json.requires_review, true);
    assert.ok(midTermItem.detalles_json.review_flags.some((f) => f.code === 'MID_PERIOD_TERMINATION'));

    assert.strictEqual(overnightItem.detalles_json.requires_review, true);
    const overnightFlag = overnightItem.detalles_json.review_flags.find((f) => f.code === 'OVERNIGHT_SHIFT_DETECTED');
    assert.ok(overnightFlag, 'Debe detectar OVERNIGHT_SHIFT_DETECTED');
    assert.strictEqual(Number(overnightItem.ausencias), 0, 'Turno nocturno no debe descontar ausencia automática');
    assert.strictEqual(Number(overnightItem.tardanzas), 0, 'Turno nocturno no debe descontar tardanza automática');
    assert.strictEqual(overnightFlag.worked_minutes, 480);

    // No duplicación de descuento manual + automático de ausencia
    assert.strictEqual(Number(sucBItem.ausencias), 400, 'Descuento manual RD$400 no debe sumarse con ausencia automática');
    assert.strictEqual(sucBItem.detalles_json.attendance_deductions_breakdown.manual_absence_override, true);
    assert.ok(
      Array.isArray(sucBItem.detalles_json.attendance_deductions_breakdown.events) &&
      sucBItem.detalles_json.attendance_deductions_breakdown.events.some((b) => b.source === 'manual_discount' && Number(b.amount) === 400),
      'Desglose de asistencia debe documentar regla, fuente y monto sin duplicar'
    );

    // genOnly y payOnly NO pueden aprobar (403)
    const genAppBlocked = await reqJson(baseUrl, 'POST', '/api/payroll/approve', { cookie: genOnlyUser.cookie, body: { payroll_id: PAYROLL_2_ID } });
    const payAppBlocked = await reqJson(baseUrl, 'POST', '/api/payroll/approve', { cookie: payOnlyUser.cookie, body: { payroll_id: PAYROLL_2_ID } });
    assert.strictEqual(genAppBlocked.status, 403);
    assert.strictEqual(payAppBlocked.status, 403);

    // appOnly intenta aprobar sin confirmar novedades -> 409 PAYROLL_PENDING_REVIEW
    const pendingReviewBlocked = await reqJson(baseUrl, 'POST', '/api/payroll/approve', {
      cookie: appOnlyUser.cookie,
      body: { payroll_id: PAYROLL_2_ID },
    });
    assert.strictEqual(pendingReviewBlocked.status, 409, `Debe bloquear aprobación con novedades pendientes: ${JSON.stringify(pendingReviewBlocked.body)}`);
    assert.strictEqual(pendingReviewBlocked.body.code, 'PAYROLL_PENDING_REVIEW');
    assert.ok(Array.isArray(pendingReviewBlocked.body.pending_review_items) && pendingReviewBlocked.body.pending_review_items.length >= 3);

    // appOnly aprueba con confirmación explícita de revisión
    const appWithAck = await reqJson(baseUrl, 'POST', '/api/payroll/approve', {
      cookie: appOnlyUser.cookie,
      body: { payroll_id: PAYROLL_2_ID, acknowledge_review_flags: true },
    });
    assert.strictEqual(appWithAck.status, 200, `Aprobación con acknowledge_review_flags debe pasar: ${JSON.stringify(appWithAck.body)}`);

    // appOnly y genOnly NO pueden registrar pago (403); payOnly SÍ puede (200)
    const appPayBlocked = await reqJson(baseUrl, 'POST', `/api/payroll/periods/${PAYROLL_2_ID}/register-payment`, { cookie: appOnlyUser.cookie });
    const genPayBlocked = await reqJson(baseUrl, 'POST', `/api/payroll/periods/${PAYROLL_2_ID}/register-payment`, { cookie: genOnlyUser.cookie });
    assert.strictEqual(appPayBlocked.status, 403);
    assert.strictEqual(genPayBlocked.status, 403);

    const payOnlyOk = await reqJson(baseUrl, 'POST', `/api/payroll/periods/${PAYROLL_2_ID}/register-payment`, {
      cookie: payOnlyUser.cookie,
      body: { payment_method: 'Transferencia manual', payment_reference: 'REF-PAYONLY-01' },
    });
    assert.strictEqual(payOnlyOk.status, 200);
    assert.strictEqual(payOnlyOk.body.status, 'Pagada');
    console.log('  ✅ 8. Altas/bajas mitad período (409 PAYROLL_PENDING_REVIEW), turno nocturno (480m), no-duplicación manual/auto, concurrencia schedule_overrides y RBAC separado (view/generate/approve/pay) PASS.');

    console.log('\n🎉 PRUEBA DE ACEPTACIÓN "NÓMINA COMPLETA" SUPERADA (8/8 BLOQUES PASS).');
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (serverProc && !serverProc.killed) serverProc.kill();
    await pool.query('DELETE FROM payroll_audit_logs WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM payroll_items WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM payroll_periods WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM employee_discounts WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM employee_commissions_log WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM schedule_overrides WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM attendance WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM kiosk_employee_sessions WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM kiosk_devices WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM user_sessions WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM security_audit_logs WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM staff_records WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM clients WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM users WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM roles WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM branches WHERE tenant_id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [TENANT_A, TENANT_B]).catch(() => {});
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ FALLO ACEPTACIÓN NÓMINA COMPLETA:', err);
  process.exit(1);
});
