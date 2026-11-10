/**
 * Quality Gate: Cryptographically Signed Cursor Pagination & Search Isolation (REM-P2-01, REM-P2-05 & Addendum 7)
 * (backend/tests/test_pagination_cursors.cjs)
 */

'use strict';

const assert = require('assert');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { encodeCursor, decodeCursor, computeFilterHash } = require('../utils/cursor_pagination');
const { createClientsRouter } = require('../routes/clients.routes');
const express = require('express');
const http = require('http');

async function runPaginationCursorTests() {
  console.log('========================================================================');
  console.log('🛡️ SUITE: CURSORES CRIPTOGRÁFICOS Y BÚSQUEDA AISLADA (REM-P2-01/05)');
  console.log('========================================================================\n');

  const testConfig = validateTestEnvironment({ allowDisposableSchema: true });
  const pool = createIsolatedTestPool(testConfig);
  const conn = await pool.getConnection();

  try {
    const tenantA = 'aaaaaaaa-1111-2222-3333-444444444444';
    const tenantB = 'bbbbbbbb-1111-2222-3333-444444444444';

    await conn.query(`
      INSERT INTO tenants (id, business_name, slug, email)
      VALUES ($1, 'Tenant A Pagin', 'tenant-a-pagin', 'pagin-a@test.local'), ($2, 'Tenant B Pagin', 'tenant-b-pagin', 'pagin-b@test.local')
      ON CONFLICT (id) DO NOTHING;
    `, [tenantA, tenantB]);

    // Seed 10 clients for Tenant A with deterministic created_at
    for (let i = 1; i <= 10; i++) {
      const clientId = `10000000-0000-0000-0000-${String(i).padStart(12, '0')}`;
      const dt = new Date(Date.now() - (100 - i) * 1000);
      await conn.query(`
        INSERT INTO clients (id, tenant_id, nombre, name, telefono, cedula, created_at)
        VALUES ($1, $2, $3, $3, $4, $5, $6)
        ON CONFLICT (id) DO NOTHING;
      `, [clientId, tenantA, `Cliente${i} Paginación`, `809555${String(i).padStart(4, '0')}`, `402-${String(i).padStart(7, '0')}-1`, dt]);
    }

    // Seed 2 clients for Tenant B
    for (let i = 1; i <= 2; i++) {
      const clientId = `20000000-0000-0000-0000-${String(i).padStart(12, '0')}`;
      await conn.query(`
        INSERT INTO clients (id, tenant_id, nombre, name, telefono, cedula)
        VALUES ($1, $2, $3, $3, $4, $5)
        ON CONFLICT (id) DO NOTHING;
      `, [clientId, tenantB, `ClienteB${i} Aislado`, `809777${String(i).padStart(4, '0')}`, `402-${String(i + 50).padStart(7, '0')}-2`]);
    }

    // --- TEST 1: Codificación y decodificación válida de cursor ---
    console.log('--- TEST 1: Codificación y decodificación legítima con firma HMAC ---');
    const validCursor = encodeCursor({
      tenant_id: tenantA,
      last_created_at: new Date('2026-11-10T12:00:00Z'),
      last_id: '10000000-0000-0000-0000-000000000005',
      filters_hash: computeFilterHash({ q: 'test' })
    });

    const decoded = decodeCursor(validCursor, tenantA, computeFilterHash({ q: 'test' }));
    assert.strictEqual(decoded.tenant_id, tenantA);
    assert.strictEqual(decoded.last_id, '10000000-0000-0000-0000-000000000005');
    console.log('  ✅ [PASS 1] Cursor válido verificado con firma auténtica');

    // --- TEST 2: Rechazo criptográfico de cursor alterado o manipulado ---
    console.log('\n--- TEST 2: Detección y rechazo de cursor alterado (INVALID_CURSOR) ---');
    const rawCursor = Buffer.from(validCursor, 'base64url').toString('utf8');
    const tamperedRaw = rawCursor.replace('"last_id":"10000000-0000-0000-0000-000000000005"', '"last_id":"00000000-0000-0000-0000-000000000000"');
    const tamperedCursor = Buffer.from(tamperedRaw, 'utf8').toString('base64url');

    let tamperedCaught = false;
    try {
      decodeCursor(tamperedCursor, tenantA);
    } catch (err) {
      tamperedCaught = true;
      assert.strictEqual(err.code, 'INVALID_CURSOR');
    }
    assert.ok(tamperedCaught, 'Debió rechazar cursor manipulado');
    console.log('  ✅ [PASS 2] Manipulación de cursor detectada y bloqueada con 400 INVALID_CURSOR');

    // --- TEST 3: Rechazo de cursor reutilizado para otro tenant (CROSS_TENANT_CURSOR) ---
    console.log('\n--- TEST 3: Bloqueo de cursor utilizado para otro tenant ---');
    let crossTenantCaught = false;
    try {
      decodeCursor(validCursor, tenantB);
    } catch (err) {
      crossTenantCaught = true;
      assert.strictEqual(err.code, 'CROSS_TENANT_CURSOR');
    }
    assert.ok(crossTenantCaught, 'Cursor de Tenant A no debe ser aceptado para Tenant B');
    console.log('  ✅ [PASS 3] Intento de IDOR / cross-tenant bloqueado estrictamente con 400');

    // Setup HTTP test server
    const app = express();
    app.use(express.json());
    let currentAuthTenant = tenantA;
    app.use((req, res, next) => {
      req.tenantId = currentAuthTenant;
      next();
    });
    app.use('/api/clients', createClientsRouter(pool));

    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    // --- TEST 4: Búsqueda con término menor a 2 caracteres rechazada ---
    console.log('\n--- TEST 4: Validación de término mínimo de búsqueda (mínimo 2 caracteres) ---');
    const resShort = await fetch(`http://127.0.0.1:${port}/api/clients/search?q=a`);
    assert.strictEqual(resShort.status, 400);
    console.log('  ✅ [PASS 4] Búsqueda con 1 solo caracter rechazada con 400');

    // --- TEST 5: Paginación cursor-based real sobre endpoint de clientes ---
    console.log('\n--- TEST 5: Paginación cursor-based secuencial sin duplicados ni saltos ---');
    // Fetch Page 1: limit 4
    const resP1 = await fetch(`http://127.0.0.1:${port}/api/clients?limit=4&paginated=true`);
    assert.strictEqual(resP1.status, 200);
    const bodyP1 = await resP1.json();
    assert.strictEqual(bodyP1.data.length, 4);
    assert.strictEqual(bodyP1.pagination.has_more, true);
    assert.ok(bodyP1.pagination.next_cursor);

    const firstPageIds = bodyP1.data.map(c => c.id);

    // Fetch Page 2 using next_cursor
    const resP2 = await fetch(`http://127.0.0.1:${port}/api/clients?limit=4&paginated=true&cursor=${encodeURIComponent(bodyP1.pagination.next_cursor)}`);
    assert.strictEqual(resP2.status, 200);
    const bodyP2 = await resP2.json();
    assert.strictEqual(bodyP2.data.length, 4);

    const secondPageIds = bodyP2.data.map(c => c.id);

    // Verify ZERO overlap between Page 1 and Page 2
    for (const id of secondPageIds) {
      assert.ok(!firstPageIds.includes(id), `Registro duplicado detectado entre páginas: ${id}`);
    }
    console.log('  ✅ [PASS 5] Páginas consecutivas extraídas limpiamente sin duplicados');

    // --- TEST 6: Aislamiento estricto en búsqueda (Tenant A nunca ve clientes de Tenant B) ---
    console.log('\n--- TEST 6: Búsqueda aislada por tenant (cero fugas de otros salones) ---');
    currentAuthTenant = tenantA;
    const resSearchA = await fetch(`http://127.0.0.1:${port}/api/clients/search?q=Cliente`);
    const searchA = await resSearchA.json();
    // Must contain Tenant A clients, but ZERO Tenant B clients
    const namesA = searchA.data.map(c => c.nombre);
    assert.ok(namesA.includes('Cliente1'));
    assert.ok(!namesA.some(n => n.includes('ClienteB')), 'Fuga de clientes de Tenant B detectada');

    currentAuthTenant = tenantB;
    const resSearchB = await fetch(`http://127.0.0.1:${port}/api/clients/search?q=Cliente`);
    const searchB = await resSearchB.json();
    const namesB = searchB.data.map(c => c.nombre);
    assert.ok(namesB.includes('ClienteB1'));
    assert.ok(!namesB.some(n => n.startsWith('Cliente1')), 'Fuga de clientes de Tenant A en Tenant B');
    console.log('  ✅ [PASS 6] Aislamiento multi-tenant verificado: 0 fugas cruzadas');

    server.close();
    console.log('\n========================================================================');
    console.log('🎉 TODAS LAS PRUEBAS DE PAGINACIÓN Y BÚSQUEDA AISLADA PASARON (PASS)');
    console.log('========================================================================\n');
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  runPaginationCursorTests().catch(err => {
    console.error('\n❌ [FAIL] Error en pruebas de paginación y búsqueda:', err);
    process.exit(1);
  });
}

module.exports = { runPaginationCursorTests };

