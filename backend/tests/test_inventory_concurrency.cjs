/**
 * Test Suite: Inventory Concurrency, Atomicity & Void Reversibility (REM-P1-18)
 *
 * Validates:
 * 1. Concurrent sales with sufficient stock deduct accurately.
 * 2. Concurrent sales competing for insufficient stock: exactly 1 wins, 1 rejected cleanly (never negative stock).
 * 3. Idempotent deduplication on repeated sale deduction requests.
 * 4. Idempotent void reversal prevents double stock replenishment.
 * 5. Strict multi-tenant isolation across inventory locations and products.
 */

'use strict';

const crypto = require('crypto');
const assert = require('assert');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { InventoryRepository } = require('../repositories/inventory.repository');
const { InventoryService } = require('../services/inventory.service');

async function runInventoryConcurrencySuite() {
  console.log('========================================================================');
  console.log('🛡️ SUITE: INVENTARIO CONCURRENTE Y REVERSIÓN SEGURA (REM-P1-18)');
  console.log('========================================================================\n');

  const testConfig = validateTestEnvironment({ allowDisposableSchema: true });
  const pool = createIsolatedTestPool(testConfig);
  const conn = await pool.getConnection();

  const repo = new InventoryRepository(pool);
  const service = new InventoryService(repo);

  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();

  const productA1 = crypto.randomUUID();
  const productA2 = crypto.randomUUID();
  const locationA = crypto.randomUUID();

  const productB1 = crypto.randomUUID();
  const locationB = crypto.randomUUID();

  try {
    // 0. Setup tenants, locations and products
    await conn.query(`INSERT INTO tenants (id, business_name, slug, email) VALUES ($1, 'Tenant A Inv', 'tenant-a-inv', 'inv-a@test.com') ON CONFLICT DO NOTHING`, [tenantA]);
    await conn.query(`INSERT INTO tenants (id, business_name, slug, email) VALUES ($1, 'Tenant B Inv', 'tenant-b-inv', 'inv-b@test.com') ON CONFLICT DO NOTHING`, [tenantB]);

    await conn.query(`
      INSERT INTO inventory_locations (id, tenant_id, name, is_default)
      VALUES ($1, $2, 'Almacén Principal A', true)
    `, [locationA, tenantA]);

    await conn.query(`
      INSERT INTO inventory_locations (id, tenant_id, name, is_default)
      VALUES ($1, $2, 'Almacén Principal B', true)
    `, [locationB, tenantB]);

    await conn.query(`
      INSERT INTO inventory_products (id, tenant_id, name, sku, track_stock, min_stock, sale_price)
      VALUES ($1, $2, 'Shampoo Hidratante 500ml', 'SKU-SHP-01', true, 2, 850.00)
    `, [productA1, tenantA]);

    await conn.query(`
      INSERT INTO inventory_products (id, tenant_id, name, sku, track_stock, min_stock, sale_price)
      VALUES ($1, $2, 'Tratamiento Argán 250ml', 'SKU-ARG-02', true, 2, 1200.00)
    `, [productA2, tenantA]);

    await conn.query(`
      INSERT INTO inventory_products (id, tenant_id, name, sku, track_stock, min_stock, sale_price)
      VALUES ($1, $2, 'Tinte Profesional 60g', 'SKU-TNT-B1', true, 2, 450.00)
    `, [productB1, tenantB]);

    // Initial stock setup: productA1 = 10 units, productA2 = 5 units
    await service.receiveInitialStock(tenantA, {
      productId: productA1,
      locationId: locationA,
      quantity: 10,
      unitCost: 400.00
    });

    await service.receiveInitialStock(tenantA, {
      productId: productA2,
      locationId: locationA,
      quantity: 5,
      unitCost: 600.00
    });

    // --- TEST 1: Dos ventas concurrentes con stock suficiente ---
    console.log('--- TEST 1: Concurrencia real con stock suficiente (10 disponibles, 2 x 5) ---');
    const [res1, res2] = await Promise.all([
      service.recordSaleDeduction(tenantA, {
        productId: productA1,
        locationId: locationA,
        quantity: 5,
        visitId: 'VIS-CONC-001'
      }),
      service.recordSaleDeduction(tenantA, {
        productId: productA1,
        locationId: locationA,
        quantity: 5,
        visitId: 'VIS-CONC-002'
      })
    ]);

    assert.ok(res1.success, 'Venta 1 debe completarse con éxito');
    assert.ok(res2.success, 'Venta 2 debe completarse con éxito');

    const stockA1 = await service.getStock(tenantA, productA1, locationA);
    assert.strictEqual(Number(stockA1.quantity), 0, 'El stock final debe ser exactamente 0');
    console.log(`  ✅ [PASS 1] Ventas concurrentes procesadas atómicamente. Stock final: ${stockA1.quantity}`);

    // --- TEST 2: Dos ventas concurrentes compitiendo por stock insuficiente ---
    console.log('\n--- TEST 2: Concurrencia con stock insuficiente (5 disponibles, 2 solicitudes de 5) ---');
    const results = await Promise.allSettled([
      service.recordSaleDeduction(tenantA, {
        productId: productA2,
        locationId: locationA,
        quantity: 5,
        visitId: 'VIS-RACE-001'
      }),
      service.recordSaleDeduction(tenantA, {
        productId: productA2,
        locationId: locationA,
        quantity: 5,
        visitId: 'VIS-RACE-002'
      })
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    assert.strictEqual(fulfilled.length, 1, 'Exactamente 1 venta debe ser autorizada');
    assert.strictEqual(rejected.length, 1, 'Exactamente 1 venta debe ser rechazada');
    assert.strictEqual(rejected[0].reason.code, 'INSUFFICIENT_STOCK', 'Error debe ser INSUFFICIENT_STOCK');

    const stockA2 = await service.getStock(tenantA, productA2, locationA);
    assert.strictEqual(Number(stockA2.quantity), 0, 'El stock nunca debe ser negativo');
    console.log(`  ✅ [PASS 2] Condición de carrera evitada: 1 autorizada, 1 rechazada con INSUFFICIENT_STOCK`);

    // --- TEST 3: Idempotencia en deducción de venta repetida ---
    console.log('\n--- TEST 3: Idempotencia estricta en deducción repetida ---');
    const initialStockBeforeIdem = Number((await service.getStock(tenantA, productA1, locationA)).quantity);
    
    // Add 10 stock back for idempotency testing
    await service.receiveInitialStock(tenantA, {
      productId: productA1,
      locationId: locationA,
      quantity: 10,
      unitCost: 400.00
    });

    const firstSale = await service.recordSaleDeduction(tenantA, {
      productId: productA1,
      locationId: locationA,
      quantity: 3,
      visitId: 'VIS-IDEM-999'
    });
    assert.ok(firstSale.success);

    // Call again with same visitId and productId
    const secondSale = await service.recordSaleDeduction(tenantA, {
      productId: productA1,
      locationId: locationA,
      quantity: 3,
      visitId: 'VIS-IDEM-999'
    });
    assert.ok(secondSale.idempotent, 'Segunda solicitud debe ser marcada como idempotente');

    const stockAfterIdem = await service.getStock(tenantA, productA1, locationA);
    assert.strictEqual(Number(stockAfterIdem.quantity), 7, 'El stock solo debe descontarse una sola vez (10 - 3 = 7)');
    console.log(`  ✅ [PASS 3] Idempotencia verificada: reintento no decrementó stock por segunda vez`);

    // --- TEST 4: Reversión atómica única (Void Sale) ---
    console.log('\n--- TEST 4: Reversión de venta POS (Void) con idempotencia ---');
    const voidResult1 = await service.recordSaleVoid(tenantA, {
      productId: productA1,
      locationId: locationA,
      quantity: 3,
      visitId: 'VIS-IDEM-999',
      reason: 'Cliente canceló el ticket'
    });
    assert.ok(voidResult1.success, 'Reversión debe completarse');

    const stockAfterVoid = await service.getStock(tenantA, productA1, locationA);
    assert.strictEqual(Number(stockAfterVoid.quantity), 10, 'Stock debe restituirse (7 + 3 = 10)');

    // Repeat void with same idempotency
    const voidResult2 = await service.recordSaleVoid(tenantA, {
      productId: productA1,
      locationId: locationA,
      quantity: 3,
      visitId: 'VIS-IDEM-999'
    });
    assert.ok(voidResult2.idempotent, 'Segunda anulación debe retornar respuesta idempotente');

    const finalStockVoid = await service.getStock(tenantA, productA1, locationA);
    assert.strictEqual(Number(finalStockVoid.quantity), 10, 'Stock no debe incrementarse doblemente');
    console.log(`  ✅ [PASS 4] Reversión de venta atómica e idempotente verificada`);

    // --- TEST 5: Aislamiento estricto multi-tenant ---
    console.log('\n--- TEST 5: Aislamiento multi-tenant en inventario ---');
    let crossTenantError = false;
    try {
      // Tenant B attempts to deduct Tenant A's product
      await service.recordSaleDeduction(tenantB, {
        productId: productA1,
        locationId: locationA,
        quantity: 1,
        visitId: 'VIS-ATTACK-001'
      });
    } catch (err) {
      if (err.code === 'NOT_FOUND' || err.message.includes('no encontrado')) {
        crossTenantError = true;
      }
    }
    assert.ok(crossTenantError, 'Tenant B no debe poder acceder ni modificar productos de Tenant A');
    console.log(`  ✅ [PASS 5] Aislamiento multi-tenant validado: producto inaccesible para otro tenant`);

    console.log('\n========================================================================');
    console.log('🎉 TODAS LAS PRUEBAS DE INVENTARIO CONCURRENTE PASARON (PASS)');
    console.log('========================================================================\n');
  } finally {
    // Teardown
    try {
      await conn.query(`DELETE FROM inventory_movements WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]);
      await conn.query(`DELETE FROM inventory_stock WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]);
      await conn.query(`DELETE FROM inventory_products WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]);
      await conn.query(`DELETE FROM inventory_locations WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]);
      await conn.query(`DELETE FROM tenants WHERE id IN ($1, $2)`, [tenantA, tenantB]);
    } catch (_) {}
    conn.release();
    await pool.end();
  }
}

if (require.main === module) {
  runInventoryConcurrencySuite().catch(err => {
    console.error('\n❌ ERROR EN SUITE DE INVENTARIO CONCURRENTE:', err);
    process.exit(1);
  });
}

module.exports = { runInventoryConcurrencySuite };
