'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_must_be_at_least_32_characters_long_for_security';

const assert = require('assert');
const http = require('http');
const express = require('express');
const { createAuthMiddleware, signAuthToken } = require('../middleware/auth.middleware');
const { createPrintTemplatesRouter } = require('../routes/print_templates.routes');
const {
  sanitizeTemplateConfig,
  resolveOperationalDate,
  issueTurnTicket,
} = require('../services/print_templates.service');
const { InMemoryDbMock } = require('./helpers/in_memory_db_mock.cjs');

function createPrintMockPool() {
  const pool = new InMemoryDbMock();
  pool.tables.tenants = [
    { id: 't-a', status: 'active', business_name: 'Car Wash A' },
    { id: 't-b', status: 'active', business_name: 'Car Wash B' },
  ];
  pool.tables.users = [
    { id: 'u-owner-a', tenant_id: 't-a', role: 'owner', status: 'active', token_version: 1, email: 'owner@a.com', all_branches_access: true },
    { id: 'u-cashier-a', tenant_id: 't-a', role: 'cajero', status: 'active', token_version: 1, email: 'cajero@a.com', all_branches_access: false, authorized_branch_ids: ['b-1'] },
    { id: 'u-owner-b', tenant_id: 't-b', role: 'owner', status: 'active', token_version: 1, email: 'owner@b.com', all_branches_access: true },
  ];
  pool.tables.clients = [
    { id: 'u-b2c-a', tenant_id: 't-a', status: 'Active', token_version: 1, email: 'cli@a.com', nombre: 'Cli A' },
  ];
  pool.tables.roles = [];
  pool.tables.print_templates = [];
  pool.tables.turn_ticket_counters = [];
  pool.tables.turn_tickets = [];

  const origQuery = pool.query.bind(pool);
  pool.query = async (sql, params = []) => {
    const norm = String(sql).replace(/\s+/g, ' ').trim();

    if (/FROM information_schema\.tables/i.test(norm)) {
      return [[]];
    }

    if (/SELECT \* FROM print_templates WHERE tenant_id = \? AND document_type = \? AND status = 'published'/i.test(norm)) {
      const [tid, docType, branchId] = params;
      const matches = pool.tables.print_templates.filter(
        (t) => t.tenant_id === tid && t.document_type === docType && t.status === 'published' && (!t.branch_id || t.branch_id === branchId)
      );
      matches.sort((a, b) => (a.branch_id === branchId ? -1 : 1) - (b.branch_id === branchId ? -1 : 1));
      return [matches.slice(0, 1)];
    }

    if (/SELECT \* FROM print_templates WHERE tenant_id = \?/i.test(norm)) {
      const tid = params[0];
      return [pool.tables.print_templates.filter((t) => t.tenant_id === tid)];
    }

    if (/SELECT \* FROM print_templates WHERE id = \? AND tenant_id = \?/i.test(norm)) {
      const [id, tid] = params;
      const found = pool.tables.print_templates.find((t) => t.id === id && t.tenant_id === tid);
      return [found ? [found] : []];
    }

    if (/UPDATE print_templates SET is_default = FALSE/i.test(norm)) {
      const [tid, docType, branchId] = params;
      pool.tables.print_templates
        .filter((t) => t.tenant_id === tid && t.document_type === docType && (t.branch_id || null) === (branchId || null))
        .forEach((t) => { t.is_default = false; });
      return [{ affectedRows: 1 }];
    }

    if (/INSERT INTO print_templates/i.test(norm)) {
      const [id, tenant_id, branch_id, document_type, name, paper_width, numbering_mode, timezone, status, is_default, config_json, published_config_json, published_version, updated_by_user_id] = params;
      const row = {
        id,
        tenant_id,
        branch_id,
        document_type,
        name,
        paper_width,
        numbering_mode,
        timezone,
        status,
        is_default: Boolean(is_default),
        version: 1,
        config_json: typeof config_json === 'string' ? JSON.parse(config_json) : config_json,
        published_config_json: published_config_json ? (typeof published_config_json === 'string' ? JSON.parse(published_config_json) : published_config_json) : null,
        published_version,
        updated_by_user_id,
        updated_at: new Date().toISOString(),
      };
      pool.tables.print_templates.push(row);
      return [[row]];
    }

    if (/UPDATE print_templates SET name = \?/i.test(norm)) {
      const [name, branch_id, paper_width, numbering_mode, timezone, status, version, config_json, pub_cfg, pub_ver, actorId, id, tid] = params;
      const row = pool.tables.print_templates.find((t) => t.id === id && t.tenant_id === tid);
      if (!row) return [[]];
      row.name = name;
      row.branch_id = branch_id;
      row.paper_width = paper_width;
      row.numbering_mode = numbering_mode;
      row.timezone = timezone;
      row.status = status;
      row.version = version;
      row.config_json = typeof config_json === 'string' ? JSON.parse(config_json) : config_json;
      if (pub_cfg) row.published_config_json = typeof pub_cfg === 'string' ? JSON.parse(pub_cfg) : pub_cfg;
      if (pub_ver) row.published_version = pub_ver;
      row.updated_by_user_id = actorId;
      row.updated_at = new Date().toISOString();
      return [[row]];
    }

    if (/INSERT INTO turn_ticket_counters/i.test(norm)) {
      const [tid, branchId, opDate] = params;
      let c = pool.tables.turn_ticket_counters.find(
        (x) => x.tenant_id === tid && x.branch_id === branchId && x.operational_date === opDate
      );
      if (!c) {
        c = { tenant_id: tid, branch_id: branchId, operational_date: opDate, last_number: 0 };
        pool.tables.turn_ticket_counters.push(c);
      }
      c.last_number += 1;
      return [[{ last_number: c.last_number }]];
    }

    if (/SELECT \* FROM turn_tickets WHERE tenant_id = \? AND idempotency_key = \?/i.test(norm)) {
      const [tid, key] = params;
      const found = pool.tables.turn_tickets.find((t) => t.tenant_id === tid && t.idempotency_key === key);
      return [found ? [found] : []];
    }

    if (/INSERT INTO turn_tickets/i.test(norm)) {
      const [id, tenant_id, branch_id, operational_date, turn_number, display_number, numbering_mode, timezone, service_name, observations, customer_label, template_id, template_version, template_snapshot, idempotency_key, issued_by_user_id] = params;
      const row = {
        id,
        tenant_id,
        branch_id,
        operational_date,
        turn_number,
        display_number,
        numbering_mode,
        timezone,
        service_name,
        observations,
        customer_label,
        template_id,
        template_version,
        template_snapshot: typeof template_snapshot === 'string' ? JSON.parse(template_snapshot) : template_snapshot,
        idempotency_key,
        issued_by_user_id,
        issued_at: new Date().toISOString(),
      };
      pool.tables.turn_tickets.push(row);
      return [[row]];
    }

    if (/SELECT \* FROM turn_tickets WHERE id = \? AND tenant_id = \?/i.test(norm)) {
      const [id, tid] = params;
      const found = pool.tables.turn_tickets.find((t) => t.id === id && t.tenant_id === tid);
      return [found ? [found] : []];
    }

    if (/SELECT \* FROM turn_tickets WHERE tenant_id = \?/i.test(norm)) {
      const tid = params[0];
      return [pool.tables.turn_tickets.filter((t) => t.tenant_id === tid)];
    }

    return origQuery(sql, params);
  };

  return pool;
}

function callApi(server, method, path, token, body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...extraHeaders,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('🖨️ Iniciando pruebas de Diseñador de Impresión y Ticket de Turno (Car Wash)...\n');

  // 1. Sanitización estricta (sin HTML/JS ni URLs externas arbitrarias)
  const sanitized = sanitizeTemplateConfig({
    title_text: '<script>alert(1)</script>TU TURNO',
    footer_text: 'Gracias onerror=alert(1)',
    logo_url: 'https://evil.com/tracker.png',
    blocks: [{ id: 'turn_number', visible: true, align: 'center', size: 'xl' }],
  }, 'ticket_turno');
  assert(!sanitized.title_text.includes('<script>'));
  assert(!sanitized.footer_text.includes('onerror='));
  assert.strictEqual(sanitized.logo_url, '');
  console.log('  ✅ 1. Sanitización de XSS/JS y bloqueo de URLs externas verificada.');

  // 2. Zona horaria operativa (ej. medianoche UTC sigue siendo día anterior en Santo Domingo AST -04:00)
  const utcMidnight = new Date('2026-11-16T02:00:00.000Z');
  assert.strictEqual(resolveOperationalDate('UTC', utcMidnight), '2026-11-16');
  assert.strictEqual(resolveOperationalDate('America/Santo_Domingo', utcMidnight), '2026-11-15');
  console.log('  ✅ 2. Fecha operativa por zona horaria verificada.');

  const pool = createPrintMockPool();
  const { authenticate } = createAuthMiddleware(pool);
  const app = express();
  app.use(express.json());
  app.use('/api', authenticate, createPrintTemplatesRouter(pool));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const tokOwnerA = signAuthToken({ sub: 'u-owner-a', id: 'u-owner-a', role: 'owner', tenantId: 't-a', tokenVersion: 1 });
    const tokCashierA = signAuthToken({ sub: 'u-cashier-a', id: 'u-cashier-a', role: 'cajero', tenantId: 't-a', tokenVersion: 1 });
    const tokB2CA = signAuthToken({ sub: 'u-b2c-a', id: 'u-b2c-a', role: 'client', tenantId: 't-a', tokenVersion: 1, isClient: true });
    const tokOwnerB = signAuthToken({ sub: 'u-owner-b', id: 'u-owner-b', role: 'owner', tenantId: 't-b', tokenVersion: 1 });

    // 3. Comanda de restaurante no disponible sin datos operativos
    const avail = await callApi(server, 'GET', '/api/print-templates/availability', tokOwnerA);
    assert.strictEqual(avail.status, 200);
    assert.strictEqual(avail.body.comanda_restaurante.available, false);
    const badComanda = await callApi(server, 'POST', '/api/print-templates', tokOwnerA, { document_type: 'comanda_restaurante' });
    assert.strictEqual(badComanda.status, 400);
    console.log('  ✅ 3. Comanda de restaurante bloqueada sin datos operativos.');

    // 4. Permisos: Cajero y B2C no pueden editar plantillas; Cajero sí puede emitir turno en su sucursal
    const cashierEdit = await callApi(server, 'POST', '/api/print-templates', tokCashierA, { document_type: 'ticket_turno', name: 'Test' });
    assert.strictEqual(cashierEdit.status, 403);
    const b2cTurn = await callApi(server, 'POST', '/api/turn-tickets', tokB2CA, { branch_id: 'b-1' });
    if (b2cTurn.status !== 403) console.error('DEBUG b2cTurn:', b2cTurn);
    assert.strictEqual(b2cTurn.status, 403);

    // Owner A crea y publica plantilla 58mm personalizada
    const createdTpl = await callApi(server, 'POST', '/api/print-templates', tokOwnerA, {
      document_type: 'ticket_turno',
      branch_id: 'b-1',
      name: 'Car Wash 58mm',
      paper_width: '58mm',
      numbering_mode: 'daily_reset',
      publish: true,
      is_default: true,
      config_json: { title_text: 'TURNO CAR WASH', footer_text: 'Vuelve pronto' },
    });
    assert.strictEqual(createdTpl.status, 201);
    const tplId = createdTpl.body.template.id;

    // 5. Emisión concurrente de 5 turnos sin duplicados
    const concurrent = await Promise.all(
      [1, 2, 3, 4, 5].map((i) =>
        callApi(server, 'POST', '/api/turn-tickets', tokCashierA, {
          branch_id: 'b-1',
          service_name: `Lavado ${i}`,
        }, { 'Idempotency-Key': `k-${i}` })
      )
    );
    const numbers = concurrent.map((r) => r.body.ticket.turn_number).sort((a, b) => a - b);
    assert.deepStrictEqual(numbers, [1, 2, 3, 4, 5]);
    assert.strictEqual(concurrent[0].body.ticket.template_version, 1);
    assert.strictEqual(concurrent[0].body.ticket.template_snapshot.paper_width, '58mm');

    // Reintento con misma Idempotency-Key devuelve mismo turno sin incrementar
    const replay = await callApi(server, 'POST', '/api/turn-tickets', tokCashierA, {
      branch_id: 'b-1',
      service_name: 'Lavado 1',
    }, { 'Idempotency-Key': 'k-1' });
    assert.strictEqual(replay.status, 200);
    assert.strictEqual(replay.body.idempotentReplay, true);
    assert.strictEqual(replay.body.ticket.id, concurrent[0].body.ticket.id);

    // Actualizar plantilla a versión 2 y verificar que reimprimir turno #1 conserva versión 1 y texto original
    await callApi(server, 'PUT', `/api/print-templates/${tplId}`, tokOwnerA, {
      paper_width: '80mm',
      publish: true,
      config_json: { title_text: 'NUEVO TITULO V2' },
    });
    const reprint = await callApi(server, 'GET', `/api/turn-tickets/${concurrent[0].body.ticket.id}`, tokCashierA);
    assert.strictEqual(reprint.status, 200);
    assert.strictEqual(reprint.body.ticket.template_version, 1);
    assert.strictEqual(reprint.body.ticket.template_snapshot.config_json.title_text, 'TURNO CAR WASH');

    // Aislamiento entre empresas: Owner B no puede leer turno de Empresa A
    const crossTenant = await callApi(server, 'GET', `/api/turn-tickets/${concurrent[0].body.ticket.id}`, tokOwnerB);
    assert.strictEqual(crossTenant.status, 404);

    // Aislamiento por sucursal: Cajero de b-1 no puede emitir en b-2
    const crossBranch = await callApi(server, 'POST', '/api/turn-tickets', tokCashierA, { branch_id: 'b-2' });
    assert.strictEqual(crossBranch.status, 403);

    // Reinicio diario: cambio de día reinicia contador a 001
    const nextDay = await issueTurnTicket(pool, {
      tenantId: 't-a',
      branchId: 'b-1',
      now: new Date('2026-11-17T15:00:00.000Z'),
    });
    assert.strictEqual(nextDay.ticket.turn_number, 1);
    console.log('  ✅ 4. Concurrencia, idempotencia, reimpresión histórica, reinicio diario y aislamiento multi-tenant/sucursal verificados.');
  } finally {
    server.close();
  }

  console.log('\n🎉 TODAS LAS PRUEBAS DEL DISEÑADOR DE IMPRESIÓN Y TICKET DE TURNO PASARON.');
}

runTests().catch((err) => {
  console.error('❌ Test fallido:', err);
  process.exit(1);
});
