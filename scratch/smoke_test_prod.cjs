const path = require('path');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function smokeTest() {
  console.log('=== SMOKE TEST: VALIDACIÓN POST-ACTIVACIÓN EN MYSQL REAL ===');
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 1
  });

  const conn = await pool.getConnection();

  try {
    // 1. Verificar Status = READY
    const [tables] = await conn.query(`
      SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('expense_concepts', 'expense_banks', 'expense_loans', 'expense_accounts', 'expenses')
    `);
    const isReady = tables.length === 5;
    console.log('1. [Estado] /status:', isReady ? 'READY (5/5 tablas)' : 'PENDING');
    if (!isReady) throw new Error('Faltan tablas');

    // 2. Registrar egreso de prueba controlado
    console.log('2. [Creación] Registrando egreso de prueba controlado...');
    const [ins] = await conn.query(`
      INSERT INTO expenses (
        concept_name, payment_date, period, amount, payment_method,
        account_name, salon_name, reference, status, created_by
      ) VALUES ('Otros', '2026-11-03', '2026-11', 100.00, 'Efectivo',
        'Cuenta operativa · 5678', 'San Vicente', 'SMOKE-TEST-01', 'Completado', 'Auditor de Activación')
    `);
    const testId = ins.insertId;
    console.log(`   OK: Egreso creado con ID temporal ${testId}.`);

    // 3. Verificar sumatoria con el egreso activo
    const [sum1] = await conn.query(`
      SELECT SUM(amount) AS total, COUNT(*) AS count
      FROM expenses
      WHERE status != 'Anulado'
    `);
    console.log('3. [Total Activo] Monto calculado:', Number(sum1[0].total), '(Esperado: 100)');
    if (Number(sum1[0].total) !== 100) throw new Error('Sumatoria errónea');

    // 4. Anular egreso con motivo
    console.log('4. [Anulación] Anulando egreso con motivo formal...');
    await conn.query(`
      UPDATE expenses
      SET status = 'Anulado', void_reason = 'Prueba controlada de activación', voided_at = NOW(), voided_by = 'Auditor'
      WHERE id = ?
    `, [testId]);

    // 5. Verificar que el total retorne a 0 tras anulación
    const [sum2] = await conn.query(`
      SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
      FROM expenses
      WHERE status != 'Anulado'
    `);
    console.log('5. [Total tras anulación] Monto activo recalculado:', Number(sum2[0].total), '(Esperado: 0)');
    if (Number(sum2[0].total) !== 0) throw new Error('El egreso anulado no se restó del total');

    // 6. Limpieza para no dejar registros ficticios en producción
    console.log('6. [Limpieza] Eliminando registro de prueba para dejar producción 100% limpia...');
    await conn.query('DELETE FROM expenses WHERE id = ?', [testId]);
    const [cleanCheck] = await conn.query('SELECT COUNT(*) AS total FROM expenses');
    console.log(`   OK: Tabla expenses limpia con exactamente ${cleanCheck[0].total} registros.`);

    console.log('\n=== SMOKE TEST EXITOSO: EL MÓDULO ESTÁ COMPLETAMENTE OPERATIVO ===');

  } catch (e) {
    console.error('ERROR en Smoke Test:', e.message);
  } finally {
    conn.release();
    await pool.end();
  }
}

smokeTest();

