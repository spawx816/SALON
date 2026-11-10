const assert = require('assert');
const path = require('path');
const mysql = require(path.join(__dirname, 'node_modules/mysql2/promise'));
require(path.join(__dirname, 'node_modules/dotenv')).config({ path: path.join(__dirname, '.env') });
const { handleBIReport } = require('./routes/bi_engine');

async function testRealQuery() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'salon_pro'
  });

  try {
    // 1. Con fechas reales
    const resReal = await handleBIReport(pool, {
      reportId: 'cash_flow',
      startDate: '2026-11-01',
      endDate: '2026-11-04'
    });
    assert.strictEqual(resReal.title, 'Flujo de efectivo');
    assert.strictEqual(resReal.kpis.length, 4);
    assert.strictEqual(resReal.concepts_breakdown.length, 7);

    // 2. Con sucursal específica
    const resSalon = await handleBIReport(pool, {
      reportId: 'cash_flow',
      salonId: '1',
      startDate: '2026-11-01',
      endDate: '2026-11-04'
    });
    assert.strictEqual(resSalon.title, 'Flujo de efectivo');
    assert.strictEqual(resSalon.kpis.length, 4);

    console.log('✅ Queries reales (con y sin sucursal) ejecutadas exitosamente sin errores.');
  } finally {
    await pool.end();
  }
}

testRealQuery().catch(err => {
  console.error('❌ Error en queries reales:', err);
  process.exit(1);
});

