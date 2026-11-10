/**
 * Test Suite: Phase 2H-B — Exact Money (Minor Units) & Financial Idempotency
 * (backend/tests/test_phase2h_money.cjs)
 * 
 * Verifies mathematical precision, currency boundaries, and idempotent execution
 * using in-memory repositories (ZERO PostgreSQL, ZERO external network).
 */

'use strict';

const assert = require('assert');
const { Money } = require('../domain/money.value_object.cjs');
const { createInMemoryTestApp } = require('./helpers/create_in_memory_test_app.cjs');
const { defaultRepository } = require('../middleware/idempotency.middleware.cjs');

async function runPhase2hMoneySuite() {
  console.log('\n=== STARTING SUITE: PHASE 2H-B EXACT MONEY & IDEMPOTENCY ===\n');

  let passedTests = 0;
  function pass(msg) {
    passedTests++;
    console.log(`  [PASS ${passedTests}] ${msg}`);
  }

  // =========================================================================
  // SECCIÓN 1: CASOS NUMÉRICOS OBLIGATORIOS (CANONICAL MONEY VALUE OBJECT)
  // =========================================================================
  console.log('--- SECCIÓN 1: EXACTITUD MATEMÁTICA Y REGLAS MONETARIAS ---');

  // 1.1: 0.1 + 0.2 = 0.30 (IEEE-754 binary floating point produces 0.30000000000000004)
  const m1 = Money.fromDecimal('0.10', 'DOP');
  const m2 = Money.fromDecimal('0.20', 'DOP');
  const mSum = m1.add(m2);
  assert.strictEqual(mSum.amountCents, 30, '0.10 + 0.20 debe ser exactamente 30 centavos');
  assert.strictEqual(mSum.toDecimal(), '0.30', 'Representación decimal debe ser exactamente 0.30');
  pass('Flow 1.1: Exactitud de suma binaria 0.10 + 0.20 = 0.30 (30 centavos)');

  // 1.2: 10.00 - 9.99 = 0.01 (IEEE-754 produces 0.010000000000000675)
  const m10 = Money.fromDecimal('10.00', 'DOP');
  const m999 = Money.fromDecimal('9.99', 'DOP');
  const mDiff = m10.subtract(m999);
  assert.strictEqual(mDiff.amountCents, 1, '10.00 - 9.99 debe ser exactamente 1 centavo');
  assert.strictEqual(mDiff.toDecimal(), '0.01', 'Representación decimal debe ser exactamente 0.01');
  pass('Flow 1.2: Exactitud de resta binaria 10.00 - 9.99 = 0.01 (1 centavo)');

  // 1.3: 100 operaciones de 0.01 = 1.00 exacto
  let cumulative = Money.zero('DOP');
  const oneCent = Money.fromDecimal('0.01', 'DOP');
  for (let i = 0; i < 100; i++) {
    cumulative = cumulative.add(oneCent);
  }
  assert.strictEqual(cumulative.amountCents, 100, '100 sumas de 1 centavo deben ser exactamente 100 centavos');
  assert.strictEqual(cumulative.toDecimal(), '1.00', 'Decimal debe ser 1.00');
  pass('Flow 1.3: Acumulación de 100 transacciones de 0.01 resulta en 1.00 exacto');

  // 1.4: Descuento porcentual con redondeo bancario definido
  // Venta de RD$ 375.50 con 15% de descuento: 37550 * 0.15 = 5632.5 -> 5633 centavos (RD$ 56.33)
  const salePrice = Money.fromDecimal('375.50', 'DOP');
  const discount15 = salePrice.percentage(15);
  assert.strictEqual(discount15.amountCents, 5633, '15% de 375.50 debe redondear a 5633 centavos');
  const discountedTotal = salePrice.subtract(discount15);
  assert.strictEqual(discountedTotal.amountCents, 31917, 'Total con descuento debe ser 31917 centavos');
  assert.strictEqual(discountedTotal.toDecimal(), '319.17');
  pass('Flow 1.4: Descuento porcentual (15%) con redondeo bancario centralizado');

  // 1.5: Cálculo de Impuesto ITBIS (18%) con redondeo
  // Subtotal RD$ 1,299.90 * 18% = 129990 * 0.18 = 23398.2 -> 23398 centavos (RD$ 233.98)
  const subtotal = Money.fromDecimal('1299.90', 'DOP');
  const tax18 = subtotal.percentage(18);
  assert.strictEqual(tax18.amountCents, 23398, 'ITBIS 18% de 1299.90 debe ser 23398 centavos');
  const grandTotal = subtotal.add(tax18);
  assert.strictEqual(grandTotal.toDecimal(), '1533.88');
  pass('Flow 1.5: Impuesto ITBIS (18%) exacto sin desfase de centavos');

  // 1.6: Comisión fraccionaria repartida entre 3 estilistas (allocate)
  // Monto a repartir: RD$ 100.00 en partes iguales (1:1:1) -> 33.34, 33.33, 33.33 (Suma = 100.00)
  const commissionPot = Money.fromDecimal('100.00', 'DOP');
  const allocated = commissionPot.allocate([1, 1, 1]);
  assert.strictEqual(allocated.length, 3);
  const totalAllocated = allocated[0].add(allocated[1]).add(allocated[2]);
  assert.strictEqual(totalAllocated.amountCents, 10000, 'La suma de comisiones debe ser exactamente 10000 centavos');
  assert.strictEqual(allocated[0].amountCents, 3334, 'El centavo residual se asigna al primer beneficiario');
  assert.strictEqual(allocated[1].amountCents, 3333);
  assert.strictEqual(allocated[2].amountCents, 3333);
  pass('Flow 1.6: Reparto proporcional (allocate) sin fuga ni creación de centavos');

  // 1.7: Prorrateo que nunca genera saldo negativo
  const baseBalance = Money.fromDecimal('50.00', 'DOP');
  assert.throws(
    () => baseBalance.subtract(Money.fromDecimal('60.00', 'DOP')).assertNonNegative('Saldo prorrateado'),
    /no puede ser negativo/i,
    'Debe rechazar saldo monetario negativo'
  );
  pass('Flow 1.7: Protección contra saldos negativos en prorrateos');

  // 1.8: Rechazo de valores con más de 2 decimales (ej. "45.125")
  assert.throws(
    () => Money.fromDecimal('45.125', 'DOP'),
    /contiene más de 2 cifras decimales/i,
    'Debe rechazar más de 2 decimales'
  );
  pass('Flow 1.8: Rechazo estricto de precisión mayor a 2 cifras decimales');

  // 1.9: Rechazo de combinación entre monedas distintas (DOP y USD)
  const dopMoney = Money.fromDecimal('100.00', 'DOP');
  const usdMoney = Money.fromDecimal('100.00', 'USD');
  assert.throws(
    () => dopMoney.add(usdMoney),
    /Discrepancia de monedas/i,
    'Debe prohibir sumar DOP con USD'
  );
  pass('Flow 1.9: Aislamiento estricto de divisas (prohibido mezclar DOP y USD)');

  // =========================================================================
  // SECCIÓN 2: IDEMPOTENCIA Y PROTECCIÓN DE ANULACIONES EN HTTP IN-MEMORY
  // =========================================================================
  console.log('\n--- SECCIÓN 2: IDEMPOTENCIA FINANCIERA Y ANULACIONES ---');

  const testApp = await createInMemoryTestApp();

  try {
    const tenantA = await testApp.createTenantWithUser({ plan: 'PRO', email: 'owner_a@salon.com' });
    const tenantB = await testApp.createTenantWithUser({ plan: 'BASE', email: 'owner_b@salon.com' });

    // 2.1: Crear producto en inventario para probar stock
    const createProdRes = await testApp.request({
      method: 'POST',
      path: '/api/inventory/products',
      headers: tenantA.headers,
      body: {
        name: 'Tratamiento Capilar Keratina',
        sku: 'KER-001',
        cost: 300,
        price: 800,
        stock_control: true,
        initial_stock: 10
      }
    });
    assert.strictEqual(createProdRes.status, 201);
    const productId = createProdRes.body.id || createProdRes.body.product?.id;
    pass('Flow 2.1: Producto de inventario inicializado con 10 unidades');

    // 2.2: Crear y cobrar visita con 2 unidades de producto
    const visitRes = await testApp.request({
      method: 'POST',
      path: '/api/visits',
      headers: tenantA.headers,
      body: {
        client_name: 'Laura Morales',
        items_detail: JSON.stringify([
          { product_id: productId, tipo_item: 'Producto', nombre: 'Tratamiento Capilar Keratina', cantidad: 2, precio: 800 }
        ]),
        total: 1600,
        metodo_pago: 'Efectivo',
        status: 'Facturado'
      }
    });
    assert.ok([200, 201].includes(visitRes.status), 'Creación de visita debe retornar 200 o 201');
    const visitId = visitRes.body.id || visitRes.body.visit?.id;

    // Verificar que el inventario se descontó a 8
    const stockAfterSale = await testApp.inventoryService.getStock(tenantA.tenantId, productId);
    assert.strictEqual(stockAfterSale.quantity, 8, 'El stock debe ser 8 tras vender 2 unidades');
    pass('Flow 2.2: Venta descontó exactamente 2 unidades del stock disponible (10 -> 8)');

    // 2.3: Idempotencia en Cobro / Petición HTTP con Idempotency-Key
    const idempotencyKey1 = 'checkout_unique_req_001';
    const firstReq = await testApp.request({
      method: 'POST',
      path: `/api/visits/${visitId}/void`,
      headers: {
        ...tenantA.headers,
        'Idempotency-Key': idempotencyKey1
      },
      body: { reason: 'Cliente canceló por tiempo', voided_by: 'Administrador' }
    });
    assert.strictEqual(firstReq.status, 200, 'Primera llamada de anulación debe ser 200 OK');
    assert.strictEqual(firstReq.headers['x-idempotency-key'], idempotencyKey1);
    pass('Flow 2.3: Primera anulación procesada con éxito y registrada en almacén de idempotencia');

    // 2.4: Reintento de red con la misma Idempotency-Key y mismo payload -> Retorna respuesta idéntica (Replay)
    const replayReq = await testApp.request({
      method: 'POST',
      path: `/api/visits/${visitId}/void`,
      headers: {
        ...tenantA.headers,
        'Idempotency-Key': idempotencyKey1
      },
      body: { reason: 'Cliente canceló por tiempo', voided_by: 'Administrador' }
    });
    assert.strictEqual(replayReq.status, 200, 'Reintento con misma clave debe responder 200');
    assert.strictEqual(replayReq.headers['x-idempotency-replay'], 'true', 'Debe marcar cabecera X-Idempotency-Replay');
    pass('Flow 2.4: Reintento con misma clave de idempotencia retorna respuesta cacheada sin reprocesar');

    // 2.5: Verificar que la reposición de inventario ocurrió EXACTAMENTE UNA VEZ (8 + 2 = 10, no 12)
    const stockAfterVoid = await testApp.inventoryService.getStock(tenantA.tenantId, productId);
    assert.strictEqual(stockAfterVoid.quantity, 10, 'El stock debe ser 10 (repuesto exactamente una vez)');
    pass('Flow 2.5: Inventario repuesto exactamente una vez tras llamada repetida');

    // 2.6: Intento de anular nuevamente SIN clave de idempotencia -> Rechazado con 409 ALREADY_VOIDED
    const doubleVoidReq = await testApp.request({
      method: 'POST',
      path: `/api/visits/${visitId}/void`,
      headers: tenantA.headers,
      body: { reason: 'Segundo intento arbitrario' }
    });
    assert.strictEqual(doubleVoidReq.status, 409, 'Segunda anulación sin idempotencia debe ser 409');
    assert.strictEqual(doubleVoidReq.body.code, 'ALREADY_VOIDED');
    pass('Flow 2.6: Factura ya anulada responde 409 ALREADY_VOIDED y bloquea repetición');

    // 2.7: Conflicto de Idempotencia: Misma clave con diferente payload -> 409 IDEMPOTENCY_CONFLICT
    const conflictReq = await testApp.request({
      method: 'POST',
      path: `/api/visits/${visitId}/void`,
      headers: {
        ...tenantA.headers,
        'Idempotency-Key': idempotencyKey1 // Clave ya usada en Flow 2.3
      },
      body: { reason: 'PAYLOAD COMPLETAMENTE DIFERENTE', voided_by: 'Otro Usuario' }
    });
    assert.strictEqual(conflictReq.status, 409, 'Misma clave con payload modificado debe responder 409 Conflict');
    assert.strictEqual(conflictReq.body.code, 'IDEMPOTENCY_CONFLICT');
    pass('Flow 2.7: Reutilización de clave de idempotencia con payload diferente genera 409 Conflict');

    // 2.8: Aislamiento Multi-Tenant: Tenant B usando la MISMA clave de idempotencia no tiene colisión con Tenant A
    const tenantBReq = await testApp.request({
      method: 'POST',
      path: '/api/cash-registers/open',
      headers: {
        ...tenantB.headers,
        'Idempotency-Key': idempotencyKey1 // Misma clave que usó Tenant A
      },
      body: { salon_id: 1, opening_balance: 500, opened_by: 'Cajero B' }
    });
    assert.ok([200, 201].includes(tenantBReq.status), 'Tenant B no debe tener colisión con clave de Tenant A');
    assert.strictEqual(tenantBReq.headers['x-idempotency-replay'], undefined, 'No debe ser un replay de Tenant A');
    pass('Flow 2.8: Aislamiento total de claves de idempotencia entre tenants distintos');

    console.log('\n======================================================');
    console.log(`PHASE 2H-B MONEY & IDEMPOTENCY SUMMARY: ${passedTests}/${passedTests} PASSED`);
    console.log('======================================================\n');
  } finally {
    await testApp.close();
  }
}

runPhase2hMoneySuite().catch(err => {
  console.error('\n❌ PHASE 2H-B MONEY TEST FAILED:');
  console.error(err);
  process.exit(1);
});
