const assert = require('assert');
const path = require('path');
const mysql = require(path.join(__dirname, 'node_modules/mysql2/promise'));
require(path.join(__dirname, 'node_modules/dotenv')).config({ path: path.join(__dirname, '.env') });
const { handleBIReport } = require('./routes/bi_engine');

async function testCashFlow() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'salon_pro'
  });

  try {
    const result = await handleBIReport(pool, {
      reportId: 'cash_flow',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      sample: '1'
    });

    assert.ok(result, 'El resultado no puede ser null');
    assert.strictEqual(result.title, 'Flujo de efectivo');
    assert.ok(Array.isArray(result.kpis), 'kpis debe ser un array');
    assert.strictEqual(result.kpis.length, 4, 'Deben existir 4 KPIs');
    assert.ok(Array.isArray(result.concepts_breakdown), 'concepts_breakdown debe ser un array');
    assert.strictEqual(result.concepts_breakdown.length, 7, 'Debe incluir los 7 conceptos');

    // Validar datos de muestra
    assert.strictEqual(result.total_cobrado, 1000000);
    assert.strictEqual(result.total_pagado, 750000);
    assert.strictEqual(result.excedente_periodo, 250000);
    assert.strictEqual(result.excedente_pct, 25);
    assert.strictEqual(result.retencion_desc, 'Por cada RD$100 cobrados, te quedan RD$25.');

    console.log('✅ Test Backend cash_flow APROBADO');
  } finally {
    await pool.end();
  }
}

testCashFlow().catch(err => {
  console.error('❌ Test cash_flow falló:', err);
  process.exit(1);
});

