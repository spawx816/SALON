const path = require('path');
const assert = require('assert');
const dotenv = require(path.join(__dirname, 'node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '.env') });
const mysql = require(path.join(__dirname, 'node_modules/mysql2/promise'));
const { createVisitsRouter } = require('./routes/visits.routes');

async function runTest() {
  console.log('=== TEST: VERIFICACIÓN DEL CONTADOR DE FACTURAS EN EFECTIVO (3 SIN COMPROBANTE Y 1 CON COMPROBANTE) ===\n');

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
    // 1. Guardar estado original del contador y secuencias
    const [origCounters] = await conn.query('SELECT cash_counter, cash_ratio FROM company_ncf_counters WHERE id = 1');
    const initialCounter = origCounters[0]?.cash_counter || 0;
    const [origSeqs] = await conn.query('SELECT id, secuencia_actual, estado FROM dgii_ncf_sequences');
    console.log(`Estado Inicial BD: cash_counter = ${initialCounter}, cash_ratio anterior = ${origCounters[0]?.cash_ratio}`);

    const visitsModule = createVisitsRouter(pool);
    const assignDgii = visitsModule.assignDgiiSequenceToVisit;
    assert.strictEqual(typeof assignDgii, 'function', 'assignDgiiSequenceToVisit debe ser una función exportada');

    // 2. Simular 4 facturas en efectivo secuenciales (3 sin comprobante + 1 con comprobante)
    const testVisitIds = [
      `TEST-CASH-${Date.now()}-1`,
      `TEST-CASH-${Date.now()}-2`,
      `TEST-CASH-${Date.now()}-3`,
      `TEST-CASH-${Date.now()}-4`
    ];

    await conn.query('UPDATE company_ncf_counters SET cash_counter = 0, cash_ratio = 4 WHERE id = 1');

    console.log('\n--- Probando ciclo de 4 facturas en efectivo (3 sin comprobante y 1 con comprobante) ---');
    const results = [];

    for (let i = 0; i < 4; i++) {
      const vId = testVisitIds[i];
      await conn.query(`
        INSERT INTO visits (id, client_name, total, metodo_pago, status, visited_at)
        VALUES (?, 'Cliente Prueba Efectivo', 500.00, 'Efectivo', 'Facturado', NOW())
      `, [vId]);

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

    // 3. Validar la distribución esperada: 3 SIN comprobante y 1 CON comprobante
    const conComprobanteCount = results.filter(r => r.tiene_comprobante).length;
    const sinComprobanteCount = results.filter(r => !r.tiene_comprobante).length;

    console.log(`\nResultado del ciclo de 4 facturas:`);
    console.log(`- Sin comprobante: ${sinComprobanteCount} (Esperado: 3)`);
    console.log(`- Con comprobante: ${conComprobanteCount} (Esperado: 1)`);

    assert.strictEqual(sinComprobanteCount, 3, 'Debe haber exactamente 3 facturas SIN comprobante');
    assert.strictEqual(conComprobanteCount, 1, 'Debe haber exactamente 1 factura CON comprobante');

    assert.strictEqual(results[0].tiene_comprobante, false, 'Op 1 debe ser sin comprobante');
    assert.strictEqual(results[1].tiene_comprobante, false, 'Op 2 debe ser sin comprobante');
    assert.strictEqual(results[2].tiene_comprobante, false, 'Op 3 debe ser sin comprobante');
    assert.strictEqual(results[3].tiene_comprobante, true, 'Op 4 debe ser con comprobante');
    console.log('✅ Validación de ciclo 3 sin comprobante y 1 con comprobante APROBADA.');

    // 4. Limpieza estricta de todos los registros de prueba y restauración de secuencias y contador
    for (const vId of testVisitIds) {
      await conn.query('DELETE FROM visits WHERE id = ?', [vId]);
      await conn.query('DELETE FROM audit_logs WHERE entity_id = ?', [vId]).catch(() => {});
    }
    for (const seq of origSeqs) {
      await conn.query('UPDATE dgii_ncf_sequences SET secuencia_actual = ?, estado = ? WHERE id = ?', [seq.secuencia_actual, seq.estado, seq.id]);
    }
    // Dejar configurado cash_ratio = 4 (3 sin comprobante y 1 con comprobante) y restaurar cash_counter
    await conn.query('UPDATE company_ncf_counters SET cash_counter = ?, cash_ratio = 4 WHERE id = 1', [initialCounter]);

    const [finalCheck] = await conn.query('SELECT cash_counter, cash_ratio FROM company_ncf_counters WHERE id = 1');
    console.log(`Estado final en BD: cash_counter = ${finalCheck[0].cash_counter}, cash_ratio = ${finalCheck[0].cash_ratio}`);
    assert.strictEqual(Number(finalCheck[0].cash_ratio), 4, 'cash_ratio debe quedar en 4 (3 sin comprobante y 1 con comprobante)');

    console.log('\n=== PRUEBA FINALIZADA EXITOSAMENTE ===');
  } catch (err) {
    console.error('ERROR EN PRUEBAS:', err);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

runTest();
