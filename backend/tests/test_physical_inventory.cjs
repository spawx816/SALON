/**
 * Quality Gate: Physical Inventory Sessions & Concurrent Sales Accounting (REM-P2-03 & Addendum 3)
 * (backend/tests/test_physical_inventory.cjs)
 */

'use strict';

const assert = require('assert');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { InventoryPhysicalSessionService } = require('../services/inventory_physical_session.service');

async function runPhysicalInventoryTests() {
  console.log('========================================================================');
  console.log('🛡️ SUITE: TOMA FÍSICA DE INVENTARIO Y CONCURRENCIA (REM-P2-03)');
  console.log('========================================================================\n');

  const testConfig = validateTestEnvironment({ allowDisposableSchema: true });
  const pool = createIsolatedTestPool(testConfig);
  const conn = await pool.getConnection();

  const service = new InventoryPhysicalSessionService(pool);

  try {
    const tenantA = '11111111-0000-0000-0000-000000000001';
    const tenantB = '22222222-0000-0000-0000-000000000002';
    const prodId1 = '33333333-0000-0000-0000-000000000001';
    const prodId2 = '44444444-0000-0000-0000-000000000002';

    // Seed tenants and test products
    await conn.query(`
      INSERT INTO tenants (id, name, slug)
      VALUES ($1, 'Tenant A Inv', 'tenant-a-inv'), ($2, 'Tenant B Inv', 'tenant-b-inv')
      ON CONFLICT (id) DO NOTHING;
    `, [tenantA, tenantB]);

    await conn.query(`
      INSERT INTO inventory_products (id, tenant_id, nombre, codigo, costo_unitario_cents, is_active)
      VALUES
        ($1, $2, 'Shampoo Keratina 500ml', 'SH-001', 50000, true),
        ($3, $2, 'Acondicionador Argan 500ml', 'AC-001', 60000, true)
      ON CONFLICT (id) DO NOTHING;
    `, [prodId1, tenantA, prodId2]);

    // Initial stock: 10 units for prod1, 20 units for prod2
    await conn.query(`
      INSERT INTO inventory_stock (tenant_id, product_id, quantity)
      VALUES ($1, $2, 10.0000), ($1, $3, 20.0000)
      ON CONFLICT (tenant_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity;
    `, [tenantA, prodId1, prodId2]);

    // --- TEST 1: Creación de sesión e inicialización de snapshots ---
    console.log('--- TEST 1: Creación de sesión y captura inicial de snapshot ---');
    const sess1 = await service.createSession({
      tenantId: tenantA,
      locationId: 'almacen_principal',
      notes: 'Toma física quincenal noviembre'
    });

    assert.ok(sess1.id);
    assert.strictEqual(sess1.status, 'DRAFT');
    assert.strictEqual(sess1.items_count, 2);

    const detail1 = await service.getSession({ tenantId: tenantA, sessionId: sess1.id });
    const itemProd1 = detail1.items.find(i => i.product_id === prodId1);
    assert.strictEqual(Number(itemProd1.system_stock_snapshot), 10);
    assert.strictEqual(Number(itemProd1.unit_cost_snapshot_cents), 50000);
    console.log('  ✅ [PASS 1] Sesión creada con snapshot de 10 unidades para producto 1');

    // --- TEST 2: Bloqueo de sesiones activas duplicadas sobre misma ubicación ---
    console.log('\n--- TEST 2: Bloqueo de sesión duplicada sobre misma ubicación (409) ---');
    let duplicateCaught = false;
    try {
      await service.createSession({
        tenantId: tenantA,
        locationId: 'almacen_principal'
      });
    } catch (err) {
      duplicateCaught = true;
      assert.strictEqual(err.status, 409);
      assert.strictEqual(err.code, 'ACTIVE_SESSION_EXISTS');
    }
    assert.ok(duplicateCaught, 'Debió rechazar creación de segunda sesión activa');
    console.log('  ✅ [PASS 2] Creación concurrente de segunda sesión bloqueada con 409 Conflict');

    // --- TEST 3: Venta concurrente en POS durante el conteo físico ---
    console.log('\n--- TEST 3: Simulación de venta concurrente en POS durante conteo ---');
    // While in counting, POS sells 3 units of prodId1 (moves_since = -3.0000)
    await conn.query(`
      UPDATE inventory_stock SET quantity = quantity - 3.0000 WHERE tenant_id = $1 AND product_id = $2;
    `, [tenantA, prodId1]);
    await conn.query(`
      INSERT INTO inventory_movements (tenant_id, product_id, type, quantity, previous_quantity, new_quantity, unit_cost_cents, notes, created_at)
      VALUES ($1, $2, 'VENTA_POS', -3.0000, 10.0000, 7.0000, 50000, 'Venta ticket #9901', CURRENT_TIMESTAMP);
    `, [tenantA, prodId1]);
    console.log('  📊 Venta en vuelo procesada: stock en DB pasó de 10 a 7 (-3 unidades)');

    // --- TEST 4: Registro de conteo físico (El conteo arrojó 6 unidades reales) ---
    console.log('\n--- TEST 4: Registro de conteo físico real (6 unidades contadas) ---');
    await service.recordCounts({
      tenantId: tenantA,
      sessionId: sess1.id,
      items: [
        { product_id: prodId1, physical_count: 6.0000, notes: 'Falta 1 frasco de la merma' },
        { product_id: prodId2, physical_count: 20.0000 }
      ]
    });

    const detail2 = await service.getSession({ tenantId: tenantA, sessionId: sess1.id });
    assert.strictEqual(detail2.session.status, 'REVIEW');
    console.log('  ✅ [PASS 4] Conteo registrado y sesión transicionó a REVIEW');

    // --- TEST 5: Publicación y fórmula matemática de ventas concurrentes ---
    console.log('\n--- TEST 5: Publicación con fórmula: variance = physical - (snapshot + moves) ---');
    // Formula expected:
    // snapshotStock = 10
    // movesSince = -3
    // expectedAtPost = 10 + (-3) = 7
    // physicalCount = 6
    // variance = 6 - 7 = -1 unidad (debe descontar 1 unidad adicional de merma real)
    const postRes = await service.postSession({
      tenantId: tenantA,
      sessionId: sess1.id
    });

    assert.strictEqual(postRes.status, 'POSTED');
    assert.strictEqual(postRes.adjustments_applied, 1); // Only prod1 had a variance
    assert.strictEqual(postRes.total_variance_cost_cents, -50000); // 1 unit @ 500.00 = -50,000 cents

    // Verify final stock in DB is exactly 6 units (the verified physical count)
    const [finalStock] = await conn.query('SELECT quantity FROM inventory_stock WHERE tenant_id = $1 AND product_id = $2', [tenantA, prodId1]);
    assert.strictEqual(Number(finalStock[0].quantity), 6);

    // Verify detail item values
    const detail3 = await service.getSession({ tenantId: tenantA, sessionId: sess1.id });
    const itemFinal = detail3.items.find(i => i.product_id === prodId1);
    assert.strictEqual(Number(itemFinal.movements_since_snapshot), -3);
    assert.strictEqual(Number(itemFinal.expected_stock_at_post), 7);
    assert.strictEqual(Number(itemFinal.variance_quantity), -1);
    console.log('  ✅ [PASS 5] Variación calculada con precisión: esperado 7, físico 6, ajuste -1');

    // --- TEST 6: Idempotencia: no se puede publicar dos veces ---
    console.log('\n--- TEST 6: Idempotencia: intento de publicar nuevamente rechazado (409) ---');
    let repostCaught = false;
    try {
      await service.postSession({ tenantId: tenantA, sessionId: sess1.id });
    } catch (err) {
      repostCaught = true;
      assert.strictEqual(err.status, 409);
      assert.strictEqual(err.code, 'ALREADY_POSTED');
    }
    assert.ok(repostCaught, 'Debió rechazar re-publicación');
    console.log('  ✅ [PASS 6] Re-publicación bloqueada con ALREADY_POSTED');

    // --- TEST 7: Aislamiento multi-tenant (Tenant B no puede acceder a sesión de Tenant A) ---
    console.log('\n--- TEST 7: Aislamiento multi-tenant (Tenant B recibe 404 estricto) ---');
    let crossTenantCaught = false;
    try {
      await service.getSession({ tenantId: tenantB, sessionId: sess1.id });
    } catch (err) {
      crossTenantCaught = true;
      assert.strictEqual(err.status, 404);
    }
    assert.ok(crossTenantCaught, 'Tenant B no debe ver sesión de Tenant A');
    console.log('  ✅ [PASS 7] Acceso cross-tenant rechazado con 404 estricto');

    console.log('\n========================================================================');
    console.log('🎉 TODAS LAS PRUEBAS DE TOMA FÍSICA DE INVENTARIO PASARON (PASS)');
    console.log('========================================================================\n');
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  runPhysicalInventoryTests().catch(err => {
    console.error('\n❌ [FAIL] Error en pruebas de toma física:', err);
    process.exit(1);
  });
}

module.exports = { runPhysicalInventoryTests };

