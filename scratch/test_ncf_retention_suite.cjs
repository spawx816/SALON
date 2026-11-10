const assert = require('assert');
const path = require('path');
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });
const { handleBIReport } = require('../backend/routes/bi_engine');

async function run() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_NAME,
    timezone: '-04:00'
  });

  const testPeriod = '2029-02';
  const start = '2029-02-01';
  const end = '2029-02-28';

  async function clean() {
    await pool.query("DELETE FROM dgii_606_purchases WHERE periodo = '202902'");
    await pool.query("DELETE FROM expenses WHERE period = '2029-02'");
    await pool.query("DELETE FROM visits WHERE id LIKE 'TEST_NCF_%'");
  }

  try {
    await clean();

    // 1. Inserción de e-NCF de 13 caracteres en 606
    const eNcf13 = 'E310000000099';
    await pool.query(`
      INSERT INTO dgii_606_purchases (
        periodo, rnc_cedula, tipo_id, tipo_bienes_servicios, proveedor, ncf,
        fecha_factura, fecha_pago, tipo_compra, clasificacion_gasto,
        monto_servicios, monto_bienes, total_facturado, itbis_facturado, itbis_retenido, estado
      ) VALUES (
        '202902', '101000005', 1, '02', 'Proveedor Químicos Tech', '${eNcf13}',
        '2029-02-05', '2029-02-05', 'Bienes', '02 - Gastos por suministros',
        0.00, 10000.00, 11800.00, 1800.00, 1800.00, 'Completa'
      )
    `);

    // 2. Inserción de egreso correspondiente en expenses con e-NCF de 13 caracteres en observación
    // Observar que el total facturado en 606 es 11800, pero itbis_retenido es 1800, por lo que el desembolso neto es 10000
    await pool.query(`
      INSERT INTO expenses (
        concept_name, payment_date, period, amount, payment_method, salon_id, reference, observation, status, is_loan
      ) VALUES (
        'Mercancías e insumos', '2029-02-05', '2029-02', 10000.00, 'Transferencia', 1, 'TRX-9988',
        'Pago de factura electrónica ${eNcf13} a Proveedor Químicos Tech', 'Completado', 0
      )
    `);

    // 3. Inserción de compra en 606 con retención que NO está en expenses (para verificar cálculo de desembolso neto)
    await pool.query(`
      INSERT INTO dgii_606_purchases (
        periodo, rnc_cedula, tipo_id, tipo_bienes_servicios, proveedor, ncf,
        fecha_factura, fecha_pago, tipo_compra, clasificacion_gasto,
        monto_servicios, monto_bienes, total_facturado, itbis_facturado, itbis_retenido, isr_retenido, estado
      ) VALUES (
        '202902', '101000006', 1, '01', 'Abogado Asesor SRL', 'B0100009988',
        '2029-02-10', '2029-02-10', 'Servicios', '02 - Gastos por trabajos',
        10000.00, 0.00, 11800.00, 1800.00, 1800.00, 1000.00, 'Completa'
      )
    `);
    // Desembolso neto esperado para Abogado Asesor = 11,800 - 1,800 (ITBIS ret) - 1,000 (ISR ret) = 9,000

    // 4. Inserción de dos operaciones legítimas separadas con mismo proveedor, monto y fecha pero distinto NCF
    await pool.query(`
      INSERT INTO dgii_606_purchases (
        periodo, rnc_cedula, tipo_id, tipo_bienes_servicios, proveedor, ncf,
        fecha_factura, fecha_pago, tipo_compra, clasificacion_gasto,
        monto_servicios, monto_bienes, total_facturado, estado
      ) VALUES (
        '202902', '101000007', 1, '02', 'Distribuidora Gemelas SRL', 'B0100001111',
        '2029-02-15', '2029-02-15', 'Bienes', '02 - Gastos suministros',
        0.00, 3000.00, 3000.00, 'Completa'
      ),
      (
        '202902', '101000007', 1, '02', 'Distribuidora Gemelas SRL', 'B0100002222',
        '2029-02-15', '2029-02-15', 'Bienes', '02 - Gastos suministros',
        0.00, 3000.00, 3000.00, 'Completa'
      )
    `);

    const report = await handleBIReport(pool, {
      reportId: 'cash_flow',
      startDate: start,
      endDate: end,
      salonId: 'all'
    });

    console.log('--- REPORTE RESULTADO ---');
    console.log('Total pagado:', report.total_pagado);
    console.log('Reconciled count:', report.reconciliation_meta.reconciled_606_count);
    console.log('Reconciled amount:', report.reconciliation_meta.reconciled_606_amount);
    console.log('Desglose:', report.concepts_breakdown);

    // Verificaciones:
    // 1. e-NCF 13 caracteres fue correctamente reconocido en la observación y deduplicado:
    // reconciled_606_count debe ser 1 (reconciled_606_amount = 10,000)
    assert.strictEqual(report.reconciliation_meta.reconciled_606_count, 1, 'e-NCF 13 chars debe ser deduplicado exactamente 1 vez');
    assert.strictEqual(report.reconciliation_meta.reconciled_606_amount, 10000, 'Monto desembolsado deduplicado debe ser 10000');

    // 2. Total pagado esperado:
    // - Expense e-NCF: 10,000 (Mercancías)
    // - 606 Abogado: 9,000 (11,800 - 1,800 ret itbis - 1,000 ret isr) (Mercancías/Otros)
    // - 606 Gemelas 1: 3,000
    // - 606 Gemelas 2: 3,000 (NO deduplicada falsamente)
    // Total Pagado esperado = 10,000 + 9,000 + 3,000 + 3,000 = 25,000
    assert.strictEqual(report.total_pagado, 25000, `Total pagado esperado 25000, recibido ${report.total_pagado}`);

    // 3. Conciliación estricta
    const sum = report.concepts_breakdown.reduce((acc, c) => acc + c.amount, 0);
    assert.strictEqual(sum, 25000, 'Suma del desglose debe ser 25000');

    console.log('\n✅ TODAS LAS PRUEBAS AVANZADAS DE NCF, RETENCIÓN Y NO-FALSA DEDUPLICACIÓN HAN SIDO SUPERADAS');
  } finally {
    await clean();
    await pool.end();
  }
}

run().catch(err => {
  console.error('❌ Error en suite:', err);
  process.exit(1);
});

