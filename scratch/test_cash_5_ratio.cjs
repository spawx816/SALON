const path = require('path');
const assert = require('assert');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
const { createVisitsRouter } = require('../backend/routes/visits.routes');

async function runTest() {
  console.log('=== TEST: VERIFICACIÓN DE REGLA 4 SIN COMPROBANTE Y 1 CON COMPROBANTE EN EFECTIVO ===\n');

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
  });

  const conn = await pool.getConnection();

  try {
    // 1. Guardar estado original del contador
    const [origCounters] = await conn.query('SELECT cash_counter, cash_ratio FROM company_ncf_counters WHERE id = 1');
    const initialCounter = origCounters[0]?.cash_counter || 0;
    const initialRatio = origCounters[0]?.cash_ratio || 5;
    console.log(`Estado Inicial BD: cash_counter = ${initialCounter}, cash_ratio = ${initialRatio}`);

    // Inicializar router
    const visitsModule = createVisitsRouter(pool);
    const assignDgii = visitsModule.assignDgiiSequenceToVisit;
    assert.strictEqual(typeof assignDgii, 'function', 'assignDgiiSequenceToVisit debe ser una función');

    // 2. Simular 5 facturas en efectivo secuenciales (ciclo completo de 5)
    const testVisitIds = [
      `TEST-CASH5-${Date.now()}-1`,
      `TEST-CASH5-${Date.now()}-2`,
      `TEST-CASH5-${Date.now()}-3`,
      `TEST-CASH5-${Date.now()}-4`,
      `TEST-CASH5-${Date.now()}-5`
    ];

    // Ajustamos temporalmente el contador a 0 y ratio a 5 para probar el ciclo exacto de 5
    await conn.query('UPDATE company_ncf_counters SET cash_counter = 0, cash_ratio = 5 WHERE id = 1');

    console.log('--- Probando secuencia de 5 facturas consecutivas en efectivo ---');
    const results = [];

    for (let i = 0; i < 5; i++) {
      const vId = testVisitIds[i];
      await conn.query(`
        INSERT INTO visits (id, client_name, total, metodo_pago, status, visited_at)
        VALUES (?, 'Cliente Prueba Efectivo', 600.00, 'Efectivo', 'Facturado', NOW())
      `, [vId]);

      // Ejecutar asignación DGII
      await assignDgii(vId, 'E32', null, null, 600.00, 'Efectivo');

      const [vRows] = await conn.query('SELECT ncf, ncf_type, ncf_name FROM visits WHERE id = ?', [vId]);
      const vData = vRows[0];
      const hasNcf = Boolean(vData.ncf && vData.ncf !== 'NONE');
      results.push({
        operacion: i + 1,
        id: vId,
        ncf: vData.ncf,
        ncf_type: vData.ncf_type,
        ncf_name: vData.ncf_name,
        tiene_comprobante: hasNcf
      });
      console.log(`Operación ${i + 1}: NCF=${vData.ncf || 'NULL'} | Tipo=${vData.ncf_type} | ${hasNcf ? 'CON COMPROBANTE (E32)' : 'SIN COMPROBANTE'}`);
    }

    // 3. Validar la distribución esperada: 4 SIN comprobante y 1 CON comprobante
    const conComprobanteCount = results.filter(r => r.tiene_comprobante).length;
    const sinComprobanteCount = results.filter(r => !r.tiene_comprobante).length;

    console.log(`\nResultados del ciclo de 5 operaciones en efectivo:`);
    console.log(`- Sin comprobante: ${sinComprobanteCount} (Esperado: 4)`);
    console.log(`- Con comprobante: ${conComprobanteCount} (Esperado: 1)`);

    assert.strictEqual(sinComprobanteCount, 4, 'Debe haber exactamente 4 facturas SIN comprobante');
    assert.strictEqual(conComprobanteCount, 1, 'Debe haber exactamente 1 factura CON comprobante');

    // 4. Validar orden de operaciones en el ciclo: Op 1 a 4 sin comprobante, Op 5 con comprobante
    assert.strictEqual(results[0].tiene_comprobante, false, 'Op 1 debe ser SIN comprobante');
    assert.strictEqual(results[1].tiene_comprobante, false, 'Op 2 debe ser SIN comprobante');
    assert.strictEqual(results[2].tiene_comprobante, false, 'Op 3 debe ser SIN comprobante');
    assert.strictEqual(results[3].tiene_comprobante, false, 'Op 4 debe ser SIN comprobante');
    assert.strictEqual(results[4].tiene_comprobante, true, 'Op 5 debe ser CON comprobante (E32)');
    assert.ok(results[4].ncf && results[4].ncf.startsWith('E32'), 'Op 5 debe tener un e-NCF E32');
    console.log('✅ Validación de ciclo 4 sin comprobante y 1 con comprobante APROBADA.');

    // 5. Validar que Crédito Fiscal (E31) con RNC SIEMPRE emite comprobante en efectivo sin importar el contador
    const rncTestId = `TEST-CASH5-${Date.now()}-RNC`;
    await conn.query(`
      INSERT INTO visits (id, client_name, total, metodo_pago, status, visited_at, rnc_cliente)
      VALUES (?, 'Empresa Fiscal SRL', 1500.00, 'Efectivo', 'Facturado', NOW(), '131917038')
    `, [rncTestId]);
    await assignDgii(rncTestId, 'E31', '131917038', 'Empresa Fiscal SRL', 1500.00, 'Efectivo');
    const [rncRows] = await conn.query('SELECT ncf, ncf_type FROM visits WHERE id = ?', [rncTestId]);
    assert.ok(rncRows[0].ncf && rncRows[0].ncf.startsWith('E31'), 'Factura con RNC fiscal debe emitir e-NCF E31 siempre');
    console.log('✅ Validación de excepción fiscal con RNC/Crédito Fiscal APROBADA (emite comprobante fiscal independientemente del método).');

    // 6. Probar también el endpoint oficial handleCheckoutVisit
    console.log('\n--- Probando a través del endpoint oficial POST /checkout ---');
    const checkoutTestId = `TEST-CHECKOUT-CASH-${Date.now()}`;
    await conn.query(`
      INSERT INTO visits (id, ticket_number, client_id, client_name, total, metodo_pago, status, visited_at)
      VALUES (?, 'TK-TEST-1', 'INVITADO', 'Cliente Efectivo Checkout', 800.00, 'Efectivo', 'Pendiente', NOW())
    `, [checkoutTestId]);

    // Establecemos contador en 4 para que la siguiente operación en efectivo sea la #5 (con comprobante)
    await conn.query('UPDATE company_ncf_counters SET cash_counter = 4, cash_ratio = 5 WHERE id = 1');

    const mockReq = {
      method: 'POST',
      url: '/checkout',
      params: { id: checkoutTestId },
      body: {
        ticketId: checkoutTestId,
        id: checkoutTestId,
        total: 800.00,
        metodo_pago: 'Efectivo',
        monto_recibido: 1000.00,
        devuelta: 200.00,
        items_detail: [{ name: 'Corte', price: 800 }],
        applied_payments: [{ method: 'Efectivo', amount: 800.00 }]
      }
    };

    const checkoutResult = await new Promise((resolve, reject) => {
      const mockRes = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        json(d) {
          if (this.statusCode >= 400) reject(new Error(d.error || 'Error'));
          else resolve(d);
        }
      };
      visitsModule.handleCheckoutVisit(mockReq, mockRes);
    });

    assert.ok(checkoutResult.ncf && checkoutResult.ncf.startsWith('E32'), 'La operación #5 en checkout debe emitir E32');
    console.log(`✅ Checkout de operación #5 exitoso con NCF: ${checkoutResult.ncf}`);

    // Limpieza estricta de datos de prueba
    console.log('\n--- Limpieza de datos de prueba ---');
    for (const vId of [...testVisitIds, rncTestId, checkoutTestId]) {
      await conn.query('DELETE FROM visits WHERE id = ?', [vId]);
      await conn.query('DELETE FROM audit_logs WHERE entity_id = ?', [vId]);
      await conn.query('DELETE FROM cash_register_movements WHERE visit_id = ?', [vId]);
    }
    // Restaurar contador en BD
    await conn.query('UPDATE company_ncf_counters SET cash_counter = ?, cash_ratio = 5 WHERE id = 1', [initialCounter]);
    console.log(`Estado restaurado en BD: cash_counter = ${initialCounter}, cash_ratio = 5`);
    console.log('✅ Base de datos restaurada y 100% limpia sin registros temporales.');

    console.log('\n=== TODAS LAS PRUEBAS DE LA REGLA 4:1 PASARON EXITOSAMENTE ===');

  } catch (err) {
    console.error('ERROR EN PRUEBAS:', err);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

runTest();

