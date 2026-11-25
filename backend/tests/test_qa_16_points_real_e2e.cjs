'use strict';

/**
 * Suite E2E Real sobre PostgreSQL 17 + Express API para validar los 16 puntos operativos y casos borde:
 * 1. Regla 'Contar' en comisiones: otorga Bono_Meta al cumplir meta y lo revierte si se anula la factura.
 * 2. Tema neutro por defecto R=9, G=9, B=11 (#09090b) y fondo blanco (#ffffff).
 * 3. Historial de facturas: preserva checkin_time real al facturar (sin sobrescribir hora de entrada).
 * 4. Descanso Extra en cambios temporales: guarda NULL/NULL y limpia ausencias del día.
 * 5. Secuencia NCF Consumo (B02) obligatoria y preseleccionada por defecto.
 * 6. Reporte 607 con montos reales, desglose por forma de pago y TXT oficial de exactamente 23 columnas.
 * 7. Modo único de ticket en recepción ('ticket_venta' vs 'ticket_turno') excluyente en plantillas.
 * 8. Etiqueta 'Reporte de incidente'.
 * 9. Auto-impresión inmediata al finalizar factura (ElectronicInvoicePrintModal autoPrint).
 * 10. Gastos imprevistos de caja -> Egresos automáticos ([Gasto Imprevisto]); Préstamos -> employee_discounts (NO Egresos).
 * 11. Acuse imprimible con firmas en ajustes de stock y transferencias (listTransfers incluye items).
 * 12. Kiosco de asistencia: máximo 1 por sucursal + bloqueo de sesión simultánea + /api/kiosk/session { bound: true, active: true }.
 * 13. Mi Suscripción: ruta /seguridad?tab=users y tarifa mensual real antes del prorrateo.
 * 14. Configuración inicia en 'print_templates'.
 * 15. Cálculo real de Regalía Pascual (Ley 16-92 = devengado real / 12, sin simulación Math.sin).
 * 16. Cambio de contraseña personal (sincronizado con Kiosco) + prioridad total de Administrador e invalidación de sesión.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const bcrypt = require('bcryptjs');

const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const testConfig = validateTestEnvironment();

process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'test';
process.env.DB_TYPE = 'postgres';
process.env.DB_HOST = testConfig.host;
process.env.DB_PORT = String(testConfig.port);
process.env.DB_USER = testConfig.user;
process.env.DB_PASS = testConfig.password;
process.env.DB_PASSWORD = testConfig.password;
process.env.DB_NAME = testConfig.database;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'qa_16_points_e2e_jwt_secret_minimum_32_characters_2026';

const pool = createIsolatedTestPool(testConfig);
const { createApp } = require('../app');

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }
  updateFromHeaders(setCookieHeader) {
    if (!setCookieHeader) return;
    const list = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const raw of list) {
      const firstPart = String(raw).split(';')[0];
      const eqIdx = firstPart.indexOf('=');
      if (eqIdx > 0) {
        const name = firstPart.slice(0, eqIdx).trim();
        const val = firstPart.slice(eqIdx + 1).trim();
        if (!val) this.cookies.delete(name);
        else this.cookies.set(name, val);
      }
    }
  }
  toHeader() {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
}

function apiRequest(baseUrl, method, urlPath, { body = null, jar = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(urlPath, baseUrl);
    const payload = body !== null ? JSON.stringify(body) : null;
    const reqHeaders = { ...headers };
    if (payload !== null) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    if (jar) {
      const cookieStr = jar.toHeader();
      if (cookieStr) reqHeaders.Cookie = cookieStr;
    }

    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method,
        headers: reqHeaders,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (jar && res.headers['set-cookie']) {
            jar.updateFromHeaders(res.headers['set-cookie']);
          }
          const rawText = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(rawText);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, text: rawText, json });
        });
      }
    );
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

(async () => {
  let server = null;
  const tenantId = crypto.randomUUID();
  const branchAId = crypto.randomUUID();
  const branchBId = crypto.randomUUID();
  const runTag = Date.now().toString(36);
  const ownerEmail = `owner.qa16.${runTag}@etereas.test`;
  const workerEmail = `worker.qa16.${runTag}@etereas.test`;
  const kiosk1Email = `kiosk1.qa16.${runTag}@etereas.test`;
  const kiosk2Email = `kiosk2.qa16.${runTag}@etereas.test`;

  console.log('=== INICIANDO SUITE E2E REAL DE LOS 16 PUNTOS (PostgreSQL 17 + API) ===');

  try {
    const app = await createApp({ pool });
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    // 0. Sembrar empresa de prueba con Plan PRO activo y 2 sucursales
    const [planRows] = await pool.query("SELECT id FROM saas_plans WHERE UPPER(code) = 'PRO' OR UPPER(slug) = 'PRO' LIMIT 1");
    let planId = planRows?.[0]?.id || null;
    if (!planId) {
      const [anyPlan] = await pool.query('SELECT id FROM saas_plans LIMIT 1');
      planId = anyPlan?.[0]?.id || null;
    }

    await pool.query(
      `INSERT INTO tenants (id, slug, business_name, legal_name, rnc, status, plan_id, max_branches, licensed_branches, max_users)
       VALUES (?, ?, 'Salón QA 16', 'Salón QA 16 SRL', '131888777', 'active', ?, 5, 2, 10)`,
      [tenantId, `salon-qa16-${runTag}`, planId]
    );
    if (planId) {
      await pool.query(
        `INSERT INTO tenant_subscriptions (tenant_id, saas_plan_id, plan_code, status, billing_cycle, current_period_start, current_period_end)
         VALUES (?, ?, 'PRO', 'active', 'monthly', NOW(), NOW() + INTERVAL '30 days')`,
        [tenantId, planId]
      ).catch(() => {});
    }

    await pool.query(
      `INSERT INTO branches (id, tenant_id, name, code, is_main, status) VALUES (?, ?, 'Sucursal Principal QA', 'MAIN', TRUE, 'active')`,
      [branchAId, tenantId]
    );
    await pool.query(
      `INSERT INTO branches (id, tenant_id, name, code, is_main, status) VALUES (?, ?, 'Sucursal Norte QA', 'NORTE', FALSE, 'active')`,
      [branchBId, tenantId]
    );
    await pool.query(
      `INSERT INTO salons (id, tenant_id, name, address, status) VALUES (?, ?, 'Sucursal Principal QA', 'Calle 1', 'Activo'), (?, ?, 'Sucursal Norte QA', 'Calle 2', 'Activo')`,
      [branchAId, tenantId, branchBId, tenantId]
    ).catch(() => {});

    const ownerPassHash = await bcrypt.hash('OwnerPass123!', 10);
    const workerPassHash = await bcrypt.hash('WorkerInit123!', 10);

    const [ownerIns] = await pool.query(
      `INSERT INTO users (tenant_id, branch_id, salon_id, name, nombre, username, email, password_hash, role, estado, is_active, all_branches_access)
       VALUES (?, ?, ?, 'Owner QA', 'Owner QA', ?, ?, ?, 'propietario', 'Activo', TRUE, TRUE) RETURNING id`,
      [tenantId, branchAId, branchAId, ownerEmail, ownerEmail, ownerPassHash]
    );
    const ownerUserId = ownerIns[0].id;

    const [workerUserIns] = await pool.query(
      `INSERT INTO users (tenant_id, branch_id, salon_id, name, nombre, username, email, password_hash, role, estado, is_active, all_branches_access)
       VALUES (?, ?, ?, 'María Estilista', 'María Estilista', ?, ?, ?, 'recepcion', 'Activo', TRUE, FALSE) RETURNING id`,
      [tenantId, branchAId, branchAId, workerEmail, workerEmail, workerPassHash]
    );
    const workerUserId = workerUserIns[0].id;

    // Crear esquema de comisión y empleada en staff_records
    const [schemeIns] = await pool.query(
      `INSERT INTO commission_schemes (tenant_id, nombre, descripcion, activo) VALUES (?, 'Esquema QA Meta', 'Prueba regla Contar', 1) RETURNING id`,
      [tenantId]
    );
    const schemeId = schemeIns[0].id;

    const [staffIns] = await pool.query(
      `INSERT INTO staff_records (tenant_id, nombre, email, password, posicion, localidad, salon_id, status, salario_base, commission_scheme_id, fecha_entrada, hora_entrada, hora_salida, dias_laborables)
       VALUES (?, 'María Estilista', ?, ?, 'Estilista', 'Sucursal Principal QA', ?, 'Activo', 24000, ?, '2026-01-01', '08:00:00', '17:00:00', 'Lunes,Martes,Miércoles,Jueves,Viernes,Sábado')
       RETURNING id`,
      [tenantId, workerEmail, workerPassHash, branchAId, schemeId]
    );
    const empId = staffIns[0].id;

    // Login Owner
    const ownerJar = new CookieJar();
    const loginOwner = await apiRequest(baseUrl, 'POST', '/api/auth/login', {
      jar: ownerJar,
      body: { email: ownerEmail, password: 'OwnerPass123!' },
    });
    assert.strictEqual(loginOwner.status, 200, `Login owner falló: ${loginOwner.text}`);
    console.log('✅ [0] Entorno aislado y sesión de Propietario listos');

    // =========================================================================
    // PUNTO 2: Color primario R=9, G=9, B=11 (#09090b) y fondo #ffffff por defecto
    // =========================================================================
    const brandRes = await apiRequest(baseUrl, 'GET', '/api/tenant/branding', { jar: ownerJar });
    assert.strictEqual(brandRes.status, 200);
    assert.strictEqual(brandRes.json.primary_color.toLowerCase(), '#09090b', 'primary_color default debe ser #09090b (R=9,G=9,B=11)');
    assert.strictEqual(brandRes.json.background_color.toLowerCase(), '#ffffff', 'background_color default debe ser #ffffff');

    const profRes = await apiRequest(baseUrl, 'GET', '/api/tenant/profile', { jar: ownerJar });
    assert.strictEqual(profRes.status, 200);
    assert.strictEqual(profRes.json.primary_color.toLowerCase(), '#09090b');
    console.log('✅ [Punto 2] Tema neutro por defecto (#09090b = RGB 9,9,11 y fondo #ffffff) verificado');

    // =========================================================================
    // PUNTO 5, 3 y 6: Comprobante Consumo obligatorio + Hora de entrada real + Reporte 607 (UI y TXT 23 cols)
    // =========================================================================
    // Abrir caja en Sucursal Principal QA
    const openReg = await apiRequest(baseUrl, 'POST', '/api/cash-registers/open', {
      jar: ownerJar,
      headers: { 'Idempotency-Key': `idem-open-${runTag}` },
      body: { salon_id: branchAId, opening_amount: 2000 },
    });
    assert.strictEqual(openReg.status, 200, `Error abriendo caja: ${openReg.text}`);
    const registerId = openReg.json.id || openReg.json.register?.id;
    assert.ok(registerId, 'Debe devolver ID de caja abierta');

    // Sin secuencia B02 configurada: intentar cobrar con B02 debe bloquearse con 409
    const blockedTicket = await apiRequest(baseUrl, 'POST', '/api/visits/ticket', {
      jar: ownerJar,
      body: { salon_id: branchAId, client_name: 'Cliente Bloqueo NCF', total: 500 },
    });
    assert.strictEqual(blockedTicket.status, 201);
    const blockedCheckout = await apiRequest(baseUrl, 'POST', `/api/visits/${blockedTicket.json.id}/checkout`, {
      jar: ownerJar,
      body: {
        salon_id: branchAId,
        cash_register_id: registerId,
        subtotal: 500,
        descuento: 0,
        itbis: 0,
        total: 500,
        metodo_pago: 'Efectivo',
        ncf_type: 'B02',
        items_detail: [{ nombre: 'Lavado', cantidad: 1, precio: 500, precioAplicado: 500 }],
      },
    });
    assert.strictEqual(blockedCheckout.status, 409, `Checkout sin secuencia B02 debía dar 409, dio ${blockedCheckout.status}`);

    // Agregar secuencia B02 activa
    const addSeq = await apiRequest(baseUrl, 'POST', '/api/dgii/sequences', {
      jar: ownerJar,
      body: {
        tipo_comprobante: 'B02',
        serie: 'B',
        nombre_comprobante: 'Factura de Consumo',
        numero_inicial: 1,
        numero_final: 50,
        fecha_vencimiento: '2027-12-31',
      },
    });
    assert.ok([200, 201].includes(addSeq.status), `Error creando secuencia B02: ${addSeq.text}`);

    // Crear ticket pendiente y simular que entró hace 25 minutos
    const realEntryIso = new Date(Date.now() - 25 * 60 * 1000).toISOString();
    await pool.query(
      `UPDATE visits SET visited_at = ?, draft_data = jsonb_set(COALESCE(draft_data, '{}'::jsonb), '{checkin_time}', to_jsonb(?::text), true) WHERE id = ? AND tenant_id = ?`,
      [realEntryIso, realEntryIso, blockedTicket.json.id, tenantId]
    );

    // Facturar con B02 y pago mixto (Efectivo 1000 + Tarjeta 590 = 1590, ITBIS 242.54)
    const okCheckout = await apiRequest(baseUrl, 'POST', `/api/visits/${blockedTicket.json.id}/checkout`, {
      jar: ownerJar,
      body: {
        salon_id: branchAId,
        cash_register_id: registerId,
        subtotal: 1347.46,
        descuento: 0,
        itbis: 242.54,
        total: 1590.0,
        metodo_pago: 'Mixto',
        applied_payments: [
          { method: 'Efectivo', amount: 1000 },
          { method: 'Tarjeta', amount: 590 },
        ],
        ncf_type: 'B02',
        items_detail: [
          { nombre: 'Hidratación Profunda', cantidad: 1, precio: 1347.46, precioAplicado: 1347.46, aplica_itbis: true, empleado_id: empId, empleado_nombre: 'María Estilista' },
        ],
      },
    });
    assert.strictEqual(okCheckout.status, 200, `Checkout B02 falló: ${okCheckout.text}`);
    assert.strictEqual(okCheckout.json.ncf, 'B0200000001');

    // Verificar preservación de checkin_time en BD (Punto 3)
    const [visitCheck] = await pool.query('SELECT visited_at, draft_data FROM visits WHERE id = ? AND tenant_id = ?', [blockedTicket.json.id, tenantId]);
    const savedCheckin = visitCheck[0].draft_data?.checkin_time;
    assert.ok(savedCheckin, 'draft_data.checkin_time debe preservarse al facturar');
    const diffMinutes = Math.round((new Date(visitCheck[0].visited_at).getTime() - new Date(savedCheckin).getTime()) / 60000);
    assert.ok(diffMinutes >= 24 && diffMinutes <= 26, `Duración real esperada ~25 min, obtenida ${diffMinutes} min`);
    console.log('✅ [Puntos 3 y 5] Secuencia B02 obligatoria y preservación exacta de hora de entrada / duración verificadas');

    // Verificar Reporte 607 JSON + TXT oficial de 23 columnas (Punto 6)
    const nowRD = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' });
    const currentYm = nowRD.slice(0, 7).replace('-', '');
    const rep607 = await apiRequest(baseUrl, 'GET', `/api/dgii/report-607?periodo=${currentYm}`, { jar: ownerJar });
    assert.strictEqual(rep607.status, 200, `Reporte 607 falló: ${rep607.text}`);
    assert.strictEqual(rep607.json.records.length, 1);
    const r607 = rep607.json.records[0];
    assert.strictEqual(r607.numero_comprobante, 'B0200000001');
    assert.strictEqual(Number(r607.monto_facturado), 1347.46);
    assert.strictEqual(Number(r607.itbis_facturado), 242.54);
    assert.strictEqual(Number(r607.efectivo), 1000);
    assert.strictEqual(Number(r607.tarjeta), 590);
    assert.strictEqual(Number(rep607.json.totals.montoFacturado), 1347.46);
    assert.strictEqual(Number(rep607.json.totals.itbisFacturado), 242.54);

    const txt607 = await apiRequest(baseUrl, 'GET', `/api/dgii/report-607/txt?periodo=${currentYm}`, { jar: ownerJar });
    assert.strictEqual(txt607.status, 200);
    const txtLines = txt607.text.trim().split(/\r?\n/);
    assert.strictEqual(txtLines.length, 2, 'TXT 607 debe tener cabecera + 1 línea de detalle');
    const cols = txtLines[1].split('|');
    assert.strictEqual(cols.length, 23, `Formato 607 DGII exige exactamente 23 columnas, obtuvo ${cols.length}: ${txtLines[1]}`);
    assert.strictEqual(cols[7], '1347.46');
    assert.strictEqual(cols[8], '242.54');
    assert.strictEqual(cols[16], '1000.00', 'Columna 17 (índice 16) debe ser Efectivo');
    assert.strictEqual(cols[18], '590.00', 'Columna 19 (índice 18) debe ser Tarjeta');
    console.log('✅ [Punto 6] Reporte 607 llena montos reales, formas de pago y exporta TXT oficial de 23 columnas exactas');

    // =========================================================================
    // PUNTO 1: Regla 'Contar' en Comisiones (otorga bono al cumplir meta y revierte al anular)
    // =========================================================================
    const createRule = await apiRequest(baseUrl, 'POST', `/api/commissions/schemes/${schemeId}/rules`, {
      jar: ownerJar,
      body: {
        rule_type: 'especial',
        operacion: 'Contar',
        service_name: 'Secado Meta',
        cantidad_meta: 2,
        bono_monto: 500,
        bono_tipo: 'Fijo',
        periodo: 'Mensual',
        repeticion: 'Una vez por período',
        repeticion_limite: 1,
      },
    });
    assert.ok([200, 201].includes(createRule.status), `Error creando regla Contar: ${createRule.text}`);

    // Factura 1 con 1x Secado Meta (1/2 -> aún sin bono)
    const vMeta1Id = `TKT-${Date.now()}-m1`;
    const coMeta1 = await apiRequest(baseUrl, 'POST', `/api/visits/${vMeta1Id}/checkout`, {
      jar: ownerJar,
      body: {
        salon_id: branchAId,
        cash_register_id: registerId,
        subtotal: 600,
        total: 600,
        metodo_pago: 'Efectivo',
        ncf_type: 'B02',
        items_detail: [{ nombre: 'Secado Meta', cantidad: 1, precio: 600, precioAplicado: 600, empleado_id: empId, empleado_nombre: 'María Estilista' }],
      },
    });
    assert.strictEqual(coMeta1.status, 200);

    let commRes = await apiRequest(baseUrl, 'GET', `/api/commissions?employee_id=${empId}`, { jar: ownerJar });
    assert.strictEqual(commRes.json.commissions.some((c) => c.tipo_comision === 'Bono_Meta'), false, 'Con 1/2 servicios aún no debe otorgar bono');

    // Factura 2 con 1x Secado Meta (2/2 -> ¡debe otorgar Bono_Meta RD$ 500!)
    const vMeta2Id = `TKT-${Date.now()}-m2`;
    const coMeta2 = await apiRequest(baseUrl, 'POST', `/api/visits/${vMeta2Id}/checkout`, {
      jar: ownerJar,
      body: {
        salon_id: branchAId,
        cash_register_id: registerId,
        subtotal: 600,
        total: 600,
        metodo_pago: 'Efectivo',
        ncf_type: 'B02',
        items_detail: [{ nombre: 'Secado Meta', cantidad: 1, precio: 600, precioAplicado: 600, empleado_id: empId, empleado_nombre: 'María Estilista' }],
      },
    });
    assert.strictEqual(coMeta2.status, 200);

    commRes = await apiRequest(baseUrl, 'GET', `/api/commissions?employee_id=${empId}`, { jar: ownerJar });
    const bonusRowsAfter2 = commRes.json.commissions.filter((c) => c.tipo_comision === 'Bono_Meta');
    assert.strictEqual(bonusRowsAfter2.length, 1, 'Al llegar a 2/2 debe crearse exactamente 1 Bono_Meta');
    assert.strictEqual(Number(bonusRowsAfter2[0].monto_comision), 500);

    // Anular Factura 2 -> baja a 1/2 -> ¡debe retirarse el Bono_Meta pendiente!
    const voidMeta2 = await apiRequest(baseUrl, 'POST', `/api/visits/${vMeta2Id}/void`, {
      jar: ownerJar,
      body: { reason: 'Prueba reversión de bono por meta' },
    });
    assert.strictEqual(voidMeta2.status, 200, `Error anulando factura: ${voidMeta2.text}`);

    commRes = await apiRequest(baseUrl, 'GET', `/api/commissions?employee_id=${empId}`, { jar: ownerJar });
    assert.strictEqual(commRes.json.commissions.filter((c) => c.tipo_comision === 'Bono_Meta').length, 0, 'Al bajar de la meta tras anulación, el bono pendiente debe retirarse');

    // Factura 3 con 2x Secado Meta (total activo = 3/2 -> vuelve a otorgar exactamente 1 bono por límite "Una vez por período")
    const vMeta3Id = `TKT-${Date.now()}-m3`;
    const coMeta3 = await apiRequest(baseUrl, 'POST', `/api/visits/${vMeta3Id}/checkout`, {
      jar: ownerJar,
      body: {
        salon_id: branchAId,
        cash_register_id: registerId,
        subtotal: 1200,
        total: 1200,
        metodo_pago: 'Efectivo',
        ncf_type: 'B02',
        items_detail: [{ nombre: 'Secado Meta', cantidad: 2, precio: 600, precioAplicado: 600, empleado_id: empId, empleado_nombre: 'María Estilista' }],
      },
    });
    assert.strictEqual(coMeta3.status, 200);
    commRes = await apiRequest(baseUrl, 'GET', `/api/commissions?employee_id=${empId}`, { jar: ownerJar });
    assert.strictEqual(commRes.json.commissions.filter((c) => c.tipo_comision === 'Bono_Meta').length, 1);
    console.log('✅ [Punto 1] Bono en regla Contar (otorgamiento al cumplir meta, límite por período y reversión al anular) verificado');

    // =========================================================================
    // PUNTO 7: Modo único de Ticket en Recepción según Plantilla (ticket_venta vs ticket_turno)
    // =========================================================================
    let tplList = await apiRequest(baseUrl, 'GET', `/api/print-templates?branch_id=${branchAId}`, { jar: ownerJar });
    assert.strictEqual(tplList.json.active_ticket_mode, 'ticket_venta', 'Modo por defecto debe ser ticket_venta (Pre-cuenta)');

    const pubTurn = await apiRequest(baseUrl, 'POST', '/api/print-templates', {
      jar: ownerJar,
      body: {
        document_type: 'ticket_turno',
        name: 'Turno Rápido QA',
        paper_width: '80mm',
        publish: true,
        is_default: true,
        config_json: { title_text: 'TURNO QA' },
      },
    });
    assert.strictEqual(pubTurn.status, 201);

    tplList = await apiRequest(baseUrl, 'GET', `/api/print-templates?branch_id=${branchAId}`, { jar: ownerJar });
    assert.strictEqual(tplList.json.active_ticket_mode, 'ticket_turno', 'Al predeterminar ticket_turno, active_ticket_mode debe cambiar a ticket_turno');

    const emitTurn = await apiRequest(baseUrl, 'POST', '/api/turn-tickets', {
      jar: ownerJar,
      headers: { 'Idempotency-Key': `turn-qa-${runTag}` },
      body: { branch_id: branchAId },
    });
    assert.ok([200, 201].includes(emitTurn.status), `Error emitiendo ticket de turno: ${emitTurn.text}`);
    assert.ok(emitTurn.json.ticket?.display_number, 'Ticket de turno debe generar número secuencial');

    // Restaurar ticket_venta como predeterminada -> debe apagar is_default de ticket_turno
    const restorePre = await apiRequest(baseUrl, 'POST', '/api/print-templates/restore-default', {
      jar: ownerJar,
      body: { document_type: 'ticket_venta' },
    });
    assert.strictEqual(restorePre.status, 200);
    tplList = await apiRequest(baseUrl, 'GET', `/api/print-templates?branch_id=${branchAId}`, { jar: ownerJar });
    assert.strictEqual(tplList.json.active_ticket_mode, 'ticket_venta', 'Al restaurar/predeterminar ticket_venta, debe volver a ticket_venta sin coexistir ambos');
    console.log('✅ [Punto 7] Exclusividad entre Ticket de Turno y Pre-cuenta según plantilla activa verificada');

    // =========================================================================
    // PUNTO 10: Gastos de caja -> Egresos ([Gasto Imprevisto]); Préstamos -> employee_discounts (NO Egresos)
    // =========================================================================
    const expMove = await apiRequest(baseUrl, 'POST', `/api/cash-registers/${registerId}/movements`, {
      jar: ownerJar,
      headers: { 'Idempotency-Key': `crm-exp-${runTag}` },
      body: {
        type: 'Gasto_Imprevisto',
        amount: 350,
        concept: 'Compra de botellones de agua',
      },
    });
    assert.strictEqual(expMove.status, 200, `Error registrando Gasto_Imprevisto: ${expMove.text}`);

    const loanMove = await apiRequest(baseUrl, 'POST', `/api/cash-registers/${registerId}/movements`, {
      jar: ownerJar,
      headers: { 'Idempotency-Key': `crm-loan-${runTag}` },
      body: {
        type: 'Prestamo_Empleado',
        amount: 800,
        employee_id: empId,
        employee_name: 'María Estilista',
        concept: '[Préstamo: María Estilista] Avance quincenal',
      },
    });
    assert.strictEqual(loanMove.status, 200, `Error registrando Prestamo_Empleado: ${loanMove.text}`);

    const currentPeriodDash = new Date().toISOString().slice(0, 7);
    const expensesList = await apiRequest(baseUrl, 'GET', `/api/expenses?period=${currentPeriodDash}`, { jar: ownerJar });
    assert.strictEqual(expensesList.status, 200, `GET /api/expenses falló: ${expensesList.text}`);
    const syncedExp = (expensesList.json.records || expensesList.json || []).find((e) => String(e.reference || '') === `CRM-${expMove.json.id}`);
    assert.ok(syncedExp, 'El gasto imprevisto de caja DEBE aparecer automáticamente en Egresos');
    assert.strictEqual(syncedExp.concept_name, '[Gasto Imprevisto] Compra de botellones de agua');
    assert.strictEqual(Number(syncedExp.amount), 350);

    const leakedLoan = (expensesList.json.records || expensesList.json || []).find((e) => String(e.reference || '') === `CRM-${loanMove.json.id}`);
    assert.strictEqual(Boolean(leakedLoan), false, 'El préstamo a empleado NUNCA debe ir a Egresos');

    const [empDiscRows] = await pool.query(
      'SELECT * FROM employee_discounts WHERE tenant_id = ? AND cash_register_movement_id = ?',
      [tenantId, loanMove.json.id]
    );
    assert.strictEqual(empDiscRows.length, 1, 'El préstamo a empleado DEBE registrarse en employee_discounts para Nómina');
    assert.strictEqual(Number(empDiscRows[0].amount), 800);
    console.log('✅ [Punto 10] Sincronización automática Gasto Imprevisto -> Egresos y exclusión de Préstamos verificada');

    // =========================================================================
    // PUNTO 11: Ajustes y Transferencias de Inventario con datos completos para Acuse Imprimible
    // =========================================================================
    const loc1 = await apiRequest(baseUrl, 'POST', '/api/inventory/locations', {
      jar: ownerJar,
      body: { name: 'Almacén Central QA', code: 'ALM-1', salon_id: branchAId, is_default: true },
    });
    const loc2 = await apiRequest(baseUrl, 'POST', '/api/inventory/locations', {
      jar: ownerJar,
      body: { name: 'Almacén Norte QA', code: 'ALM-2', salon_id: branchBId, is_default: false },
    });
    assert.ok([200, 201].includes(loc1.status) && [200, 201].includes(loc2.status), 'Almacenes creados');
    const loc1Id = loc1.json.id || loc1.json.location?.id;
    const loc2Id = loc2.json.id || loc2.json.location?.id;

    const prodCreated = await apiRequest(baseUrl, 'POST', '/api/services', {
      jar: ownerJar,
      body: {
        nombre: 'Shampoo Keratina QA',
        categoria: 'Productos',
        tipo_item: 'PRODUCTO',
        sku: `SKU-${runTag}`,
        precio: 950,
        costo_unitario: 400,
      },
    });
    assert.ok([200, 201].includes(prodCreated.status), `Error creando producto: ${prodCreated.text}`);
    const prodId = prodCreated.json.id || prodCreated.json.service?.id;

    const adjRes = await apiRequest(baseUrl, 'POST', '/api/inventory/adjustments', {
      jar: ownerJar,
      body: {
        productId: prodId,
        locationId: loc1Id,
        quantity: 12,
        adjustmentType: 'ADJUSTMENT_IN',
        reason: 'Carga inicial auditada',
      },
    });
    assert.strictEqual(adjRes.status, 200, `Error en ajuste de stock: ${adjRes.text}`);
    assert.strictEqual(Number(adjRes.json.new_stock), 12);

    const trfRes = await apiRequest(baseUrl, 'POST', '/api/inventory/transfers', {
      jar: ownerJar,
      body: {
        transfer_number: `TRF-${runTag}`,
        source_location_id: loc1Id,
        destination_location_id: loc2Id,
        notes: 'Reposición sucursal norte',
        items: [{ product_id: prodId, quantity_requested: 5 }],
      },
    });
    assert.strictEqual(trfRes.status, 201, `Error creando transferencia: ${trfRes.text}`);

    const listTrf = await apiRequest(baseUrl, 'GET', '/api/inventory/transfers', { jar: ownerJar });
    assert.strictEqual(listTrf.status, 200);
    const foundTrf = listTrf.json.find((t) => t.id === trfRes.json.id);
    assert.ok(foundTrf && Array.isArray(foundTrf.items) && foundTrf.items.length === 1, 'GET /api/inventory/transfers debe incluir items para reimprimir Acuse');
    assert.strictEqual(Number(foundTrf.items[0].quantity_requested), 5);
    assert.strictEqual(foundTrf.items[0].product_name, 'Shampoo Keratina QA');
    console.log('✅ [Punto 11] Ajustes de inventario y transferencias con ítems completos para Acuse con firmas verificados');

    // =========================================================================
    // PUNTO 4: Descanso Extra en Cambios Temporales
    // =========================================================================
    const targetRestDate = '2026-11-20';
    await pool.query(
      `INSERT INTO attendance (tenant_id, employee_id, employee_name, type, status, timestamp)
       VALUES (?, ?, 'María Estilista', 'Ausencia', 'Ausente', ?::timestamptz)`,
      [tenantId, String(empId), `${targetRestDate}T12:00:00-04:00`]
    );

    const restOverride = await apiRequest(baseUrl, 'POST', '/api/attendance/schedule-override', {
      jar: ownerJar,
      body: {
        employeeId: empId,
        date: targetRestDate,
        isDescanso: true,
        reason: 'Día libre compensatorio',
        createdBy: 'Owner QA',
      },
    });
    assert.strictEqual(restOverride.status, 200, `Error guardando Descanso Extra: ${restOverride.text}`);

    const [ovRows] = await pool.query(
      'SELECT new_hora_entrada, new_hora_salida, reason FROM schedule_overrides WHERE tenant_id = ? AND employee_id = ? AND date = ?',
      [tenantId, String(empId), targetRestDate]
    );
    assert.strictEqual(ovRows.length, 1);
    assert.strictEqual(ovRows[0].new_hora_entrada, null, 'new_hora_entrada debe ser NULL en Descanso Extra');
    assert.strictEqual(ovRows[0].new_hora_salida, null, 'new_hora_salida debe ser NULL en Descanso Extra');
    assert.ok(ovRows[0].reason.includes('[Descanso Extraordinario]'));

    const [remAbsence] = await pool.query(
      "SELECT id FROM attendance WHERE tenant_id = ? AND employee_id = ? AND type = 'Ausencia'",
      [tenantId, String(empId)]
    );
    assert.strictEqual(remAbsence.length, 0, 'Descanso Extra debe purgar la ausencia previa de ese día');
    console.log('✅ [Punto 4] Descanso Extra en cambios temporales (NULL/NULL + limpieza de ausencias) verificado');

    // =========================================================================
    // PUNTO 15: Cálculo Real de Regalía Pascual (Ley 16-92 = devengado real / 12)
    // =========================================================================
    // Sembrar un período de nómina cerrado en 2025 para probar exactitud matemática exacta
    const [ppIns] = await pool.query(
      `INSERT INTO payroll_periods (tenant_id, period_name, start_date, end_date, status, total_empleados, total_ingresos, total_neto)
       VALUES (?, 'Nómina Enero 2025', '2025-01-01', '2025-01-31', 'Pagada', 1, 30000, 28000) RETURNING id`,
      [tenantId]
    );
    await pool.query('UPDATE staff_records SET fecha_entrada = ?, fecha_salida = ? WHERE id = ? AND tenant_id = ?', [
      '2025-01-01',
      '2025-01-31',
      empId,
      tenantId,
    ]);
    await pool.query(
      `INSERT INTO payroll_items (tenant_id, payroll_id, employee_id, employee_name, salario_fijo, comisiones, feriados, total_ingresos, neto_pagar)
       VALUES (?, ?, ?, 'María Estilista', 24000, 6000, 0, 30000, 28000)`,
      [tenantId, ppIns[0].id, String(empId)]
    );

    const reg2025 = await apiRequest(baseUrl, 'GET', '/api/payroll/regalias/2025', { jar: ownerJar });
    assert.strictEqual(reg2025.status, 200, `Regalías falló: ${reg2025.text}`);
    const empReg = reg2025.json.regalias.find((r) => String(r.employee_id) === String(empId));
    assert.ok(empReg, 'Debe incluir a la empleada que laboró en 2025');
    assert.strictEqual(Number(empReg.total_acumulado_anual), 30000, 'Total devengado real debe ser exactamente 30,000 (sin datos simulados)');
    assert.strictEqual(Number(empReg.monto_regalia), 2500, 'Regalía Pascual debe ser exactamente 30,000 / 12 = 2,500.00');
    await pool.query('UPDATE staff_records SET fecha_salida = NULL WHERE id = ? AND tenant_id = ?', [empId, tenantId]);
    console.log('✅ [Punto 15] Cálculo real de Regalía Pascual (30,000 / 12 = RD$ 2,500.00 exactos) verificado');

    // =========================================================================
    // PUNTO 12: Kiosco 1 por sucursal + Bloqueo de sesión simultánea + Latido { bound: true, active: true }
    // =========================================================================
    const createKiosk1 = await apiRequest(baseUrl, 'POST', '/api/users', {
      jar: ownerJar,
      body: {
        nombre: 'Kiosco Sede Principal',
        email: kiosk1Email,
        password: 'KioskPass123!',
        role: 'kiosco_asistencia',
        branch_id: branchAId,
        salon_id: branchAId,
      },
    });
    assert.strictEqual(createKiosk1.status, 200, `Error creando Kiosco 1: ${createKiosk1.text}`);

    // Intentar crear un 2do Kiosco en la MISMA sucursal -> DEBE bloquearse con 409
    const createKiosk2SameBranch = await apiRequest(baseUrl, 'POST', '/api/users', {
      jar: ownerJar,
      body: {
        nombre: 'Kiosco Duplicado Sede Principal',
        email: kiosk2Email,
        password: 'KioskPass123!',
        role: 'kiosco_asistencia',
        branch_id: branchAId,
        salon_id: branchAId,
      },
    });
    assert.strictEqual(createKiosk2SameBranch.status, 409, `2do Kiosco en misma sucursal debía dar 409, dio ${createKiosk2SameBranch.status}`);
    assert.strictEqual(createKiosk2SameBranch.json.code, 'KIOSK_BRANCH_LIMIT_REACHED');

    // Iniciar sesión con Kiosco 1 en Dispositivo A
    const kioskJarA = new CookieJar();
    const loginKioskA = await apiRequest(baseUrl, 'POST', '/api/auth/login', {
      jar: kioskJarA,
      body: { email: kiosk1Email, password: 'KioskPass123!' },
    });
    assert.strictEqual(loginKioskA.status, 200, `Login Kiosco A falló: ${loginKioskA.text}`);

    // Verificar /api/kiosk/session devuelve bound: true Y active: true (sin auto-desconexión a los 12s)
    const kioskSessCheck = await apiRequest(baseUrl, 'GET', '/api/kiosk/session', { jar: kioskJarA });
    assert.strictEqual(kioskSessCheck.status, 200);
    assert.strictEqual(kioskSessCheck.json.bound, true);
    assert.strictEqual(kioskSessCheck.json.active, true);

    // Intentar abrir simultáneamente el mismo usuario Kiosco en Dispositivo B -> DEBE bloquearse con 409
    const kioskJarB = new CookieJar();
    const loginKioskBBlocked = await apiRequest(baseUrl, 'POST', '/api/auth/login', {
      jar: kioskJarB,
      body: { email: kiosk1Email, password: 'KioskPass123!' },
    });
    assert.strictEqual(loginKioskBBlocked.status, 409, `Login simultáneo de Kiosco debía dar 409, dio ${loginKioskBBlocked.status}`);
    assert.strictEqual(loginKioskBBlocked.json.code, 'KIOSK_SESSION_ALREADY_ACTIVE');
    console.log('✅ [Punto 12] Límite de 1 Kiosco por sucursal, bloqueo de sesión simultánea y latido activo verificados');

    // =========================================================================
    // PUNTO 16: Cambio de contraseña propio (sincronizado con Kiosco) + Prioridad total de Administrador
    // =========================================================================
    const workerJar = new CookieJar();
    const loginWorker1 = await apiRequest(baseUrl, 'POST', '/api/auth/login', {
      jar: workerJar,
      body: { email: workerEmail, password: 'WorkerInit123!' },
    });
    assert.strictEqual(loginWorker1.status, 200, `Login inicial trabajadora falló: ${loginWorker1.text}`);

    // Trabajadora personaliza su propia contraseña
    const selfChange = await apiRequest(baseUrl, 'POST', '/api/auth/change-password', {
      jar: workerJar,
      body: {
        currentPassword: 'WorkerInit123!',
        newPassword: 'ClavePersonalMaria2026!',
      },
    });
    assert.strictEqual(selfChange.status, 200, `Cambio de clave propio falló: ${selfChange.text}`);

    // Verificar que la nueva clave personalizada funciona TAMBIÉN en el Kiosco de Asistencia
    const kioskVerifySelf = await apiRequest(baseUrl, 'POST', '/api/kiosk/verify-employee', {
      jar: kioskJarA,
      body: { employee_id: empId, password: 'ClavePersonalMaria2026!' },
    });
    assert.strictEqual(kioskVerifySelf.status, 200, `Ponche en Kiosco con nueva clave personal falló: ${kioskVerifySelf.text}`);

    // Ahora la trabajadora "renuncia" y el Administrador entra a Usuarios y coloca otra contraseña (prioridad Admin)
    const adminReset = await apiRequest(baseUrl, 'PUT', `/api/users/${workerUserId}`, {
      jar: ownerJar,
      body: {
        password: 'ClaveAsignadaPorAdmin99!',
      },
    });
    assert.strictEqual(adminReset.status, 200, `Override de contraseña por Admin falló: ${adminReset.text}`);

    // La sesión previa de la trabajadora queda revocada inmediatamente
    const oldWorkerSess = await apiRequest(baseUrl, 'GET', '/api/auth/session-status', { jar: workerJar });
    assert.strictEqual(oldWorkerSess.status, 401, 'La sesión previa del empleado debe invalidarse cuando Admin cambia su clave');

    // La clave anterior de la trabajadora ya NO funciona
    const oldPassLogin = await apiRequest(baseUrl, 'POST', '/api/auth/login', {
      body: { email: workerEmail, password: 'ClavePersonalMaria2026!' },
    });
    assert.strictEqual(oldPassLogin.status, 401);

    // La nueva clave puesta por el Administrador funciona tanto en Login Web como en Kiosco
    const adminOverrideLogin = await apiRequest(baseUrl, 'POST', '/api/auth/login', {
      body: { email: workerEmail, password: 'ClaveAsignadaPorAdmin99!' },
    });
    assert.strictEqual(adminOverrideLogin.status, 200, 'Debe poder accederse con la contraseña asignada por el Administrador');

    const kioskVerifyAdminPass = await apiRequest(baseUrl, 'POST', '/api/kiosk/verify-employee', {
      jar: kioskJarA,
      body: { employee_id: empId, password: 'ClaveAsignadaPorAdmin99!' },
    });
    assert.strictEqual(kioskVerifyAdminPass.status, 200, 'El Kiosco también debe aceptar de inmediato la contraseña asignada por el Administrador');
    console.log('✅ [Punto 16] Cambio de clave propio + sincronización Kiosco + prioridad e invalidación por Admin verificados');

    // =========================================================================
    // PUNTOS 8, 9, 13 y 14: Verificación estructural de componentes UI compilados
    // =========================================================================
    const rootDir = path.resolve(__dirname, '../..');
    const appSrc = fs.readFileSync(path.join(rootDir, 'src/App.jsx'), 'utf8');
    const reportModalSrc = fs.readFileSync(path.join(rootDir, 'src/components/common/ReportIssueModal.jsx'), 'utf8');
    const settingsSrc = fs.readFileSync(path.join(rootDir, 'src/components/admin/SettingsModule.jsx'), 'utf8');
    const saasBillingSrc = fs.readFileSync(path.join(rootDir, 'src/components/saas/SaasBillingModule.jsx'), 'utf8');
    const invoiceModalSrc = fs.readFileSync(path.join(rootDir, 'src/components/common/ElectronicInvoicePrintModal.jsx'), 'utf8');
    const invReceiptSrc = fs.readFileSync(path.join(rootDir, 'src/components/inventory/InventoryReceiptPrintModal.jsx'), 'utf8');

    assert.ok(appSrc.includes('Reporte de incidente') && !appSrc.includes('Reportar problema'), 'Punto 8 en App.jsx');
    assert.ok(reportModalSrc.includes('Reporte de incidente'), 'Punto 8 en ReportIssueModal.jsx');
    assert.ok(settingsSrc.includes("useState('print_templates')"), 'Punto 14 en SettingsModule.jsx');
    assert.ok(saasBillingSrc.includes("navigate('/seguridad?tab=users')"), 'Punto 13 enlace Usuarios en SaasBillingModule.jsx');
    assert.ok(saasBillingSrc.includes('Tarifa mensual sin prorrateo'), 'Punto 13 tarifa sin prorrateo en SaasBillingModule.jsx');
    assert.ok(invoiceModalSrc.includes('autoPrint') && invoiceModalSrc.includes('window.print()'), 'Punto 9 auto-impresión en ElectronicInvoicePrintModal.jsx');
    assert.ok(invReceiptSrc.includes('Recibido Conforme por') && invReceiptSrc.includes('Autorizado / Verificado por'), 'Punto 11 firmas en InventoryReceiptPrintModal.jsx');
    console.log('✅ [Puntos 8, 9, 13 y 14] Verificación de contratos de interfaz (Incidente, Auto-Print, Suscripción y Configuración) superada');

    console.log('\n🎉 TODAS LAS PRUEBAS E2E REALES DE LOS 16 PUNTOS PASARON AL 100% SIN FALLOS 🎉');
  } finally {
    // Limpieza completa del tenant de prueba
    try {
      await pool.query('DELETE FROM employee_commissions_log WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM commission_scheme_rules WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM commission_schemes WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM employee_discounts WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM expenses WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM cash_register_movements WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM cash_registers WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM visits WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM dgii_ncf_sequences WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM turn_tickets WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM print_templates WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM inventory_transfer_items WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM inventory_transfers WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM inventory_movements WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM inventory_stock WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM inventory_locations WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM services WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM schedule_overrides WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM attendance WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM payroll_items WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM payroll_periods WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM kiosk_devices WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM user_sessions WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM staff_records WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM users WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM salons WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM branches WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM tenant_subscriptions WHERE tenant_id = ?', [tenantId]);
      await pool.query('DELETE FROM tenants WHERE id = ?', [tenantId]);
    } catch (cleanErr) {
      console.warn('[CLEANUP WARN]:', cleanErr.message);
    }
    if (server) {
      await new Promise((r) => server.close(r));
    }
    if (pool && typeof pool.end === 'function') {
      await pool.end().catch(() => {});
    }
  }
})().catch((err) => {
  console.error('\n❌ FALLO EN SUITE E2E REAL DE 16 PUNTOS:', err);
  process.exit(1);
});
