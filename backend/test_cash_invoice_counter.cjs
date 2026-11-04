const path = require('path');
const assert = require('assert');
const dotenv = require(path.join(__dirname, 'node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '.env') });
const mysql = require(path.join(__dirname, 'node_modules/mysql2/promise'));
const { createVisitsRouter } = require('./routes/visits.routes');

async function runTest() {
  console.log('=== TEST: VERIFICACIÓN DEL CONTADOR Y CLASIFICACIÓN DE FACTURAS EN EFECTIVO (4:1) ===\n');

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
    assert.strictEqual(typeof assignDgii, 'function', 'assignDgiiSequenceToVisit debe ser una función exportada');

    // 2. Simular 5 facturas en efectivo secuenciales (ejecución controlada de prueba)
    const testVisitIds = [
      `TEST-CASH-${Date.now()}-1`,
      `TEST-CASH-${Date.now()}-2`,
      `TEST-CASH-${Date.now()}-3`,
      `TEST-CASH-${Date.now()}-4`,
      `TEST-CASH-${Date.now()}-5`
    ];

    // Ajustamos temporalmente el contador a 0 y ratio a 5 para probar el ciclo exacto de 5 operaciones
    await conn.query('UPDATE company_ncf_counters SET cash_counter = 0, cash_ratio = 5 WHERE id = 1');

    console.log('\n--- Probando secuencia de 5 facturas en efectivo pura ---');
    const results = [];

    for (let i = 0; i < 5; i++) {
      const vId = testVisitIds[i];
      // Insertar visita temporal
      await conn.query(`
        INSERT INTO visits (id, client_name, total, metodo_pago, status, visited_at)
        VALUES (?, 'Cliente Prueba Efectivo', 500.00, 'Efectivo', 'Facturado', NOW())
      `, [vId]);

      // Ejecutar asignación DGII
      await assignDgii(vId, 'E32', null, null, 500.00, 'Efectivo');
      
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
      console.log(`Operación ${i + 1}: NCF=${vData.ncf || 'NULL'} | Tipo=${vData.ncf_type} | ${hasNcf ? 'CON COMPROBANTE' : 'SIN COMPROBANTE'}`);
    }

    // 3. Validar la distribución esperada: 4 SIN comprobante y 1 CON comprobante
    const conComprobanteCount = results.filter(r => r.tiene_comprobante).length;
    const sinComprobanteCount = results.filter(r => !r.tiene_comprobante).length;

    console.log(`\nResultado del ciclo de 5 facturas:`);
    console.log(`- Sin comprobante: ${sinComprobanteCount} (Esperado: 4)`);
    console.log(`- Con comprobante: ${conComprobanteCount} (Esperado: 1)`);

    assert.strictEqual(sinComprobanteCount, 4, 'Debe haber exactamente 4 facturas SIN comprobante');
    assert.strictEqual(conComprobanteCount, 1, 'Debe haber exactamente 1 factura CON comprobante');

    // 4. Validar que la 5ta operación (múltiplo de ratio) sea la que obtuvo el comprobante
    assert.strictEqual(results[0].tiene_comprobante, false, 'Op 1 debe ser sin comprobante');
    assert.strictEqual(results[1].tiene_comprobante, false, 'Op 2 debe ser sin comprobante');
    assert.strictEqual(results[2].tiene_comprobante, false, 'Op 3 debe ser sin comprobante');
    assert.strictEqual(results[3].tiene_comprobante, false, 'Op 4 debe ser sin comprobante');
    assert.strictEqual(results[4].tiene_comprobante, true, 'Op 5 debe ser con comprobante');
    console.log('✅ Validación de ciclo 4 sin comprobante y 1 con comprobante APROBADA.');

    // 5. Validar que una factura con RNC fiscal (Crédito Fiscal) SIEMPRE emita comprobante aunque sea en efectivo
    const rncTestId = `TEST-CASH-${Date.now()}-RNC`;
    await conn.query(`
      INSERT INTO visits (id, client_name, total, metodo_pago, status, visited_at, rnc_cliente)
      VALUES (?, 'Empresa Fiscal SRL', 1200.00, 'Efectivo', 'Facturado', NOW(), '131917038')
    `, [rncTestId]);
    await assignDgii(rncTestId, 'E31', '131917038', 'Empresa Fiscal SRL', 1200.00, 'Efectivo');
    const [rncRows] = await conn.query('SELECT ncf, ncf_type FROM visits WHERE id = ?', [rncTestId]);
    assert.ok(rncRows[0].ncf && rncRows[0].ncf.startsWith('E31'), 'Factura con RNC fiscal debe emitir e-NCF E31 siempre');
    console.log('✅ Validación de excepción fiscal con RNC/Crédito Fiscal APROBADA (emite comprobante fiscal independientemente del método).');

    // 6. Limpieza estricta de todos los registros de prueba y restauración del contador
    console.log('\n--- Limpieza de datos de prueba ---');
    for (const vId of [...testVisitIds, rncTestId]) {
      await conn.query('DELETE FROM visits WHERE id = ?', [vId]);
      await conn.query('DELETE FROM audit_logs WHERE entity_id = ?', [vId]);
    }
    // Restaurar el contador original exacto de la base de datos
    await conn.query('UPDATE company_ncf_counters SET cash_counter = ?, cash_ratio = 5 WHERE id = 1', [initialCounter]);
    console.log(`Estado restaurado en BD: cash_counter = ${initialCounter}, cash_ratio = 5`);
    console.log('✅ Base de datos restaurada y 100% limpia sin registros temporales.');

    console.log('\n=== TODAS LAS PRUEBAS DE FACTURAS EN EFECTIVO PASARON EXITOSAMENTE ===');

  } catch (err) {
    console.error('ERROR EN PRUEBAS:', err);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

runTest();
