/**
 * TEST SUITE: Flujo de Efectivo - Validación Financiera Integral (TDD)
 * 
 * Valida los 10 criterios financieros obligatorios:
 * 1. Compra pagada registrada únicamente en 606.
 * 2. Pago registrado únicamente en Egresos.
 * 3. Misma operación en ambas fuentes (Deduplicación estricta sin doble cómputo).
 * 4. Compra 606 pendiente de pago (Exclusión de compras a crédito sin fecha de pago).
 * 5. Pagos con retenciones fiscales y notas de crédito en 606 y Visitas.
 * 6. Nómina ya incluida en Egresos (No duplicar nómina).
 * 7. Movimientos anulados / cancelados (Exclusión estricta de anulaciones).
 * 8. Préstamos con desglose de capital, intereses y cargos.
 * 9. Filtro estricto de fechas y aislamiento por sucursales.
 * 10. Conciliación matemática estricta: Total pagado === Suma de todas las categorías del gráfico.
 * 11. Período vacío sin movimientos: Retorna 0.00 sin NaN ni datos de ejemplo no solicitados.
 */
const assert = require('assert');
const path = require('path');
const mysql = require(path.join(__dirname, 'node_modules/mysql2/promise'));
require(path.join(__dirname, 'node_modules/dotenv')).config({ path: path.join(__dirname, '.env') });
const { handleBIReport } = require('./routes/bi_engine');

async function runFinancialSuite() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'salon_pro'
  });

  console.log('\n======================================================');
  console.log('   TEST SUITE: FLUJO DE EFECTIVO - VALIDACIÓN FINANCIERA');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function testPass(desc) {
    console.log(`  [PASS] ${desc}`);
    passed++;
  }

  function testFail(desc, err) {
    console.error(`  [FAIL] ${desc}:`, err.message || err);
    failed++;
  }

  const TEST_PREFIX = 'SYNTH_CF_';
  const testStartDate = '2029-01-01';
  const testEndDate = '2029-01-31';

  async function cleanTestData() {
    await pool.query("DELETE FROM dgii_606_purchases WHERE periodo IN ('202901', '202903') OR ncf LIKE 'B019999%' OR ncf = 'E310000000099' OR ncf = 'B0100009988' OR ncf IN ('B0100001111', 'B0100002222')");
    await pool.query("DELETE FROM expenses WHERE period IN ('2029-01', '2029-03') OR reference LIKE 'B019999%' OR reference LIKE 'SYNTH_CF_%' OR reference = 'TRX-9988' OR observation LIKE '%SYNTH_CF_%' OR observation LIKE '%E310000000099%'");
    await pool.query("DELETE FROM visits WHERE id LIKE 'SYNTH_CF_%'");
    await pool.query("DELETE FROM payments WHERE id LIKE 'SYNTH_CF_%' OR description LIKE '%SYNTH_CF_%'");
    await pool.query("DELETE FROM cash_register_movements WHERE id IN (999901, 999902) OR concept LIKE '%SYNTH_CF_%'");
  }

  try {
    // 0. Limpieza preventiva
    await cleanTestData();

    // -----------------------------------------------------------------
    // ESCENARIO 1: Cobros reales de visitas y membresías
    // -----------------------------------------------------------------
    console.log('--- 1. ENTRADAS: Cobros Reales (Visitas Facturadas + Membresías Aprobadas) ---');
    await pool.query(`
      INSERT INTO visits (id, client_id, client_name, salon_id, visited_at, status, total, metodo_pago)
      VALUES 
        ('${TEST_PREFIX}V1', 'CLI-01', 'Client 1', 1, '2029-01-10 10:00:00', 'Facturado', 5000.00, 'Efectivo'),
        ('${TEST_PREFIX}V2', 'CLI-02', 'Client 2', 1, '2029-01-15 14:00:00', 'Facturado', 3000.00, 'Tarjeta'),
        ('${TEST_PREFIX}V_VOID', 'CLI-03', 'Client 3', 1, '2029-01-20 12:00:00', 'Anulado', 4000.00, 'Efectivo'),
        ('${TEST_PREFIX}V_NC', 'CLI-04', 'Client 4', 1, '2029-01-22 15:00:00', 'Facturado', 2500.00, 'Efectivo')
    `);
    // Simular que V_NC tiene una nota de crédito aplicada (reembolso)
    await pool.query(`UPDATE visits SET ncf_nota_credito = 'B0400000001' WHERE id = '${TEST_PREFIX}V_NC'`);

    await pool.query(`
      INSERT INTO payments (id, client_id, plan_id, amount, method, status, description, created_at, salon_id)
      VALUES 
        ('${TEST_PREFIX}PAY1', 'CLI-01', 1, 2000.00, 'CardNet', 'Aprobado', '${TEST_PREFIX} Cuota Aprobada', '2029-01-05 09:00:00', 1),
        ('${TEST_PREFIX}PAY2', 'CLI-02', 1, 2000.00, 'CardNet', 'Rechazado', '${TEST_PREFIX} Cuota Fallida', '2029-01-06 09:00:00', 1),
        ('${TEST_PREFIX}PAY_SALON2', 'CLI-05', 1, 4500.00, 'CardNet', 'Aprobado', '${TEST_PREFIX} Cuota Sucursal 2', '2029-01-08 11:00:00', 2)
    `);

    // -----------------------------------------------------------------
    // ESCENARIO 2: Compra pagada registrada ÚNICAMENTE en 606
    // -----------------------------------------------------------------
    console.log('--- 2. SALIDAS: Compra Pagada únicamente en 606 ---');
    await pool.query(`
      INSERT INTO dgii_606_purchases (
        periodo, rnc_cedula, tipo_id, tipo_bienes_servicios, proveedor, ncf,
        fecha_factura, fecha_pago, tipo_compra, clasificacion_gasto,
        monto_servicios, monto_bienes, total_facturado, estado
      ) VALUES (
        '202901', '101000001', 1, '02', 'Proveedor Insumos Directo', 'B0199990001',
        '2029-01-05', '2029-01-08', 'Bienes', '02 - Gastos por trabajos, suministros y servicios',
        0.00, 1500.00, 1500.00, 'Completa'
      )
    `);

    // -----------------------------------------------------------------
    // ESCENARIO 3: Pago registrado ÚNICAMENTE en Egresos
    // -----------------------------------------------------------------
    console.log('--- 3. SALIDAS: Pago registrado únicamente en Egresos ---');
    await pool.query(`
      INSERT INTO expenses (
        concept_name, payment_date, period, amount, payment_method, salon_id, reference, status, is_loan
      ) VALUES (
        'Alquileres', '2029-01-10', '2029-01', 12000.00, 'Transferencia', 1, '${TEST_PREFIX}EXP_ALQ', 'Completado', 0
      )
    `);

    // -----------------------------------------------------------------
    // ESCENARIO 4: Misma operación en AMBAS fuentes (Deduplicación estricta)
    // -----------------------------------------------------------------
    console.log('--- 4. DEDUPLICACIÓN: Misma compra en 606 y egreso pagado en Contabilidad ---');
    const sharedNcf = 'B0199990002';
    await pool.query(`
      INSERT INTO dgii_606_purchases (
        periodo, rnc_cedula, tipo_id, tipo_bienes_servicios, proveedor, ncf,
        fecha_factura, fecha_pago, tipo_compra, clasificacion_gasto,
        monto_servicios, monto_bienes, total_facturado, estado
      ) VALUES (
        '202901', '101000002', 1, '02', 'Suplidor Químicos SRL', '${sharedNcf}',
        '2029-01-12', '2029-01-14', 'Bienes', '02 - Gastos por trabajos, suministros y servicios',
        0.00, 7000.00, 7000.00, 'Completa'
      )
    `);
    await pool.query(`
      INSERT INTO expenses (
        concept_name, payment_date, period, amount, payment_method, salon_id, reference, observation, status, is_loan
      ) VALUES (
        'Mercancías e insumos', '2029-01-14', '2029-01', 7000.00, 'Transferencia', 1, '${sharedNcf}',
        'Pago de factura con NCF ${sharedNcf} a Suplidor Químicos', 'Completado', 0
      )
    `);

    // -----------------------------------------------------------------
    // ESCENARIO 5: Compra en 606 PENDIENTE de pago (Crédito no pagado)
    // -----------------------------------------------------------------
    console.log('--- 5. EXCLUSIÓN: Compra 606 pendiente de pago (sin desembolso) ---');
    await pool.query(`
      INSERT INTO dgii_606_purchases (
        periodo, rnc_cedula, tipo_id, tipo_bienes_servicios, proveedor, ncf,
        fecha_factura, fecha_pago, tipo_compra, clasificacion_gasto,
        monto_servicios, monto_bienes, total_facturado, estado
      ) VALUES (
        '202901', '101000003', 1, '02', 'Proveedor Por Pagar', 'B0199990003',
        '2029-01-20', NULL, 'Bienes', '02 - Gastos por trabajos, suministros y servicios',
        0.00, 50000.00, 50000.00, 'Pendiente'
      )
    `);

    // -----------------------------------------------------------------
    // ESCENARIO 6: Préstamo con desglose de capital, interés y cargos
    // -----------------------------------------------------------------
    console.log('--- 6. PRÉSTAMOS: Desglose financiero de capital e intereses ---');
    await pool.query(`
      INSERT INTO expenses (
        concept_name, payment_date, period, amount, payment_method, salon_id, reference, status, is_loan,
        breakdown_capital, breakdown_interest, breakdown_charges
      ) VALUES (
        'Préstamos', '2029-01-18', '2029-01', 10000.00, 'Transferencia', 1, '${TEST_PREFIX}EXP_LOAN', 'Completado', 1,
        7000.00, 2500.00, 500.00
      )
    `);

    // -----------------------------------------------------------------
    // ESCENARIO 7: Nómina en Egresos vs Nómina en tabla (No duplicar)
    // -----------------------------------------------------------------
    console.log('--- 7. NÓMINA: Pago de nómina registrado en Egresos ---');
    await pool.query(`
      INSERT INTO expenses (
        concept_name, payment_date, period, amount, payment_method, salon_id, reference, status, is_loan
      ) VALUES (
        'Nómina', '2029-01-25', '2029-01', 25000.00, 'Transferencia', 1, '${TEST_PREFIX}EXP_NOMINA', 'Completado', 0
      )
    `);

    // -----------------------------------------------------------------
    // ESCENARIO 8: Egreso Anulado / Cancelado
    // -----------------------------------------------------------------
    console.log('--- 8. EXCLUSIÓN: Egreso Anulado ---');
    await pool.query(`
      INSERT INTO expenses (
        concept_name, payment_date, period, amount, payment_method, salon_id, reference, status, is_loan, voided_at
      ) VALUES (
        'Energía eléctrica', '2029-01-26', '2029-01', 15000.00, 'Efectivo', 1, '${TEST_PREFIX}EXP_VOID', 'Anulado', 0, '2029-01-27 10:00:00'
      )
    `);

    // -----------------------------------------------------------------
    // ESCENARIO 9: Egreso en Sucursal 2 (para probar aislamiento de sucursal)
    // -----------------------------------------------------------------
    console.log('--- 9. SUCURSAL: Aislamiento por sucursal ---');
    await pool.query(`
      INSERT INTO expenses (
        concept_name, payment_date, period, amount, payment_method, salon_id, reference, status, is_loan
      ) VALUES (
        'TSS', '2029-01-28', '2029-01', 8000.00, 'Transferencia', 2, '${TEST_PREFIX}EXP_TSS_S2', 'Completado', 0
      )
    `);

    // EJECUTAR CONSULTA DEL REPORTE PARA SUCURSAL 1
    const reportS1 = await handleBIReport(pool, {
      reportId: 'cash_flow',
      startDate: testStartDate,
      endDate: testEndDate,
      salonId: '1'
    });

    console.log('\n--- VERIFICACIÓN DE RESULTADOS FINANCIEROS (Sucursal 1) ---');

    // 1. Cobros en S1: 5,000 (V1) + 3,000 (V2) + 2,000 (Payment) = 10,000.
    // (V_VOID = 4,000 excluida, V_NC = 2,500 excluida por nota de crédito, Cuota fallida = 2,000 excluida, Cuota S2 = 4,500 excluida)
    try {
      assert.strictEqual(reportS1.total_cobrado, 10000, `Total cobrado esperado 10000, recibido ${reportS1.total_cobrado}`);
      testPass('Total cobrado refleja dinero efectivamente percibido excluyendo notas de crédito y anulaciones (RD$ 10,000)');
    } catch (e) { testFail('Total cobrado S1', e); }

    // 2. Pagos en S1:
    // - 606 Solo: 1,500
    // - Alquileres S1: 12,000
    // - Mercancías compartida (606 Dup / Exp S1): 7,000 (UNA SOLA VEZ)
    // - Préstamo S1: 10,000
    // - Nómina S1: 25,000
    // Total Pagado S1 = 55,500 (TSS de S2 por 8,000 excluido)
    const expectedTotalPagadoS1 = 55500;
    try {
      assert.strictEqual(reportS1.total_pagado, expectedTotalPagadoS1, `Total pagado esperado ${expectedTotalPagadoS1}, recibido ${reportS1.total_pagado}`);
      testPass(`Total pagado deduplicado exactamente igual a la suma real de S1 (RD$ ${expectedTotalPagadoS1.toLocaleString('es-DO')})`);
    } catch (e) { testFail('Total pagado S1', e); }

    // 3. Excedente de S1: 10,000 - 55,500 = -45,500
    const expectedExcedenteS1 = 10000 - expectedTotalPagadoS1;
    try {
      assert.strictEqual(reportS1.excedente_periodo, expectedExcedenteS1, `Excedente esperado ${expectedExcedenteS1}, recibido ${reportS1.excedente_periodo}`);
      testPass(`Excedente del período coherente en S1 (RD$ ${expectedExcedenteS1.toLocaleString('es-DO')})`);
    } catch (e) { testFail('Excedente S1', e); }

    // 4. Conciliación matemática estricta: Total pagado === Suma(conceptos_breakdown)
    try {
      const sumBreakdown = (reportS1.concepts_breakdown || []).reduce((acc, c) => acc + Number(c.amount || 0), 0);
      assert.strictEqual(sumBreakdown, reportS1.total_pagado, `Suma del desglose (${sumBreakdown}) debe ser idéntica al Total pagado (${reportS1.total_pagado})`);
      testPass(`Conciliación matemática perfecta: Total pagado == Suma de conceptos (${sumBreakdown})`);
    } catch (e) { testFail('Conciliación desglose vs total pagado', e); }

    // 5. Desglose de Préstamos (Capital vs Intereses)
    try {
      assert.ok(reportS1.loans_detail, 'Debe incluir loans_detail en el reporte');
      assert.strictEqual(reportS1.loans_detail.total_capital, 7000, 'Capital de préstamo identificado');
      assert.strictEqual(reportS1.loans_detail.total_interest, 2500, 'Interés de préstamo identificado');
      assert.strictEqual(reportS1.loans_detail.total_charges, 500, 'Cargos de préstamo identificados');
      testPass('Desglose de préstamos separa capital, intereses y cargos con rigor');
    } catch (e) { testFail('Desglose de préstamos', e); }

    // 6. Verificación de fuentes declaradas y deduplicación
    try {
      assert.ok(reportS1.sources_status, 'sources_status debe estar presente');
      assert.strictEqual(reportS1.sources_status.expenses_available, true, 'Fuente Egresos activa');
      assert.strictEqual(reportS1.sources_status.dgii_606_available, true, 'Fuente 606 activa');
      assert.strictEqual(reportS1.reconciliation_meta.reconciled_606_count, 1, '1 factura de 606 conciliada y deduplicada');
      testPass('Auditoría de fuentes y metadatos de conciliación conformes');
    } catch (e) { testFail('Estado de fuentes', e); }

    // 7. Verificación de Aislamiento de Sucursales (Todas las sucursales vs S1)
    console.log('\n--- 10. MULTI-SUCURSAL: Verificación de "all" vs S1 ---');
    const reportAll = await handleBIReport(pool, {
      reportId: 'cash_flow',
      startDate: testStartDate,
      endDate: testEndDate,
      salonId: 'all'
    });
    // All debe incluir el pago de S2 (4,500) -> 10,000 + 4,500 = 14,500 cobrado
    // y el egreso de S2 (8,000 TSS) -> 55,500 + 8,000 = 63,500 pagado
    try {
      assert.strictEqual(reportAll.total_cobrado, 14500, `Cobrado esperado en all 14500, recibido ${reportAll.total_cobrado}`);
      assert.strictEqual(reportAll.total_pagado, 63500, `Pagado esperado en all 63500, recibido ${reportAll.total_pagado}`);
      testPass('Filtro de sucursales aisla correctamente operaciones específicas vs globales');
    } catch (e) { testFail('Filtro multi-sucursal', e); }

    // 8. Período vacío sin movimientos: Retorna 0.00 sin NaN ni datos de ejemplo no solicitados
    console.log('\n--- 11. PERÍODO VACÍO: Fechas futuras sin datos ---');
    const reportEmpty = await handleBIReport(pool, {
      reportId: 'cash_flow',
      startDate: '2035-01-01',
      endDate: '2035-01-31'
    });
    try {
      assert.strictEqual(reportEmpty.total_cobrado, 0, 'Total cobrado debe ser 0');
      assert.strictEqual(reportEmpty.total_pagado, 0, 'Total pagado debe ser 0');
      assert.strictEqual(reportEmpty.excedente_periodo, 0, 'Excedente debe ser 0');
      assert.strictEqual(reportEmpty.excedente_pct, 0, 'Excedente % debe ser 0');
      assert.strictEqual(reportEmpty.is_sample, false, 'is_sample debe ser false cuando no se solicitó');
      testPass('Rango sin movimientos reporta 0.00 real sin inventar cifras ni error NaN');
    } catch (e) { testFail('Período vacío', e); }

    // 9. Modo demostración explícito (sample=1)
    console.log('\n--- 12. MODO DEMOSTRACIÓN: Solicitud expresa de maqueta ---');
    const demoResult = await handleBIReport(pool, {
      reportId: 'cash_flow',
      startDate: testStartDate,
      endDate: testEndDate,
      sample: '1'
    });
    try {
      assert.strictEqual(demoResult.is_sample, true, 'is_sample debe ser true');
      assert.strictEqual(demoResult.total_cobrado, 1000000, 'Demo debe mostrar RD$ 1,000,000');
      assert.strictEqual(demoResult.total_pagado, 750000, 'Demo debe mostrar RD$ 750,000');
      assert.strictEqual(demoResult.excedente_periodo, 250000, 'Demo debe mostrar RD$ 250,000');
      assert.strictEqual(demoResult.excedente_pct, 25, 'Demo debe mostrar 25%');
      testPass('Modo datos de ejemplo opera de forma aislada sin contaminar cálculos reales');
    } catch (e) { testFail('Modo datos de ejemplo', e); }

    // 10. Validación Avanzada: e-NCF 13 caracteres, deducción de retenciones y no-falsa deduplicación
    console.log('\n--- 13. NORMALIZACIÓN NCF (13 chars) Y RETENCIONES ---');
    const testAdvStart = '2029-03-01';
    const testAdvEnd = '2029-03-31';
    const eNcf13 = 'E310000000099';

    // Compra 606 con e-NCF 13 caracteres
    await pool.query(`
      INSERT INTO dgii_606_purchases (
        periodo, rnc_cedula, tipo_id, tipo_bienes_servicios, proveedor, ncf,
        fecha_factura, fecha_pago, tipo_compra, clasificacion_gasto,
        monto_servicios, monto_bienes, total_facturado, itbis_facturado, itbis_retenido, estado
      ) VALUES (
        '202903', '101000005', 1, '02', 'Proveedor Químicos Tech', '${eNcf13}',
        '2029-03-05', '2029-03-05', 'Bienes', '02 - Gastos por suministros',
        0.00, 10000.00, 11800.00, 1800.00, 1800.00, 'Completa'
      )
    `);
    // Egreso con e-NCF de 13 caracteres en observación
    await pool.query(`
      INSERT INTO expenses (
        concept_name, payment_date, period, amount, payment_method, salon_id, reference, observation, status, is_loan
      ) VALUES (
        'Mercancías e insumos', '2029-03-05', '2029-03', 10000.00, 'Transferencia', 1, 'TRX-9988',
        'Pago de factura electrónica ${eNcf13} a Proveedor Químicos Tech', 'Completado', 0
      )
    `);
    // Compra con retención ITBIS + ISR (desembolso neto = total - retenciones)
    await pool.query(`
      INSERT INTO dgii_606_purchases (
        periodo, rnc_cedula, tipo_id, tipo_bienes_servicios, proveedor, ncf,
        fecha_factura, fecha_pago, tipo_compra, clasificacion_gasto,
        monto_servicios, monto_bienes, total_facturado, itbis_facturado, itbis_retenido, isr_retenido, estado
      ) VALUES (
        '202903', '101000006', 1, '01', 'Abogado Asesor SRL', 'B0100009988',
        '2029-03-10', '2029-03-10', 'Servicios', '02 - Gastos por trabajos',
        10000.00, 0.00, 11800.00, 1800.00, 1800.00, 1000.00, 'Completa'
      )
    `);
    // Dos operaciones legítimas con mismo proveedor, fecha y monto pero distinto NCF
    await pool.query(`
      INSERT INTO dgii_606_purchases (
        periodo, rnc_cedula, tipo_id, tipo_bienes_servicios, proveedor, ncf,
        fecha_factura, fecha_pago, tipo_compra, clasificacion_gasto,
        monto_servicios, monto_bienes, total_facturado, estado
      ) VALUES (
        '202903', '101000007', 1, '02', 'Distribuidora Gemelas SRL', 'B0100001111',
        '2029-03-15', '2029-03-15', 'Bienes', '02 - Gastos suministros',
        0.00, 3000.00, 3000.00, 'Completa'
      ),
      (
        '202903', '101000007', 1, '02', 'Distribuidora Gemelas SRL', 'B0100002222',
        '2029-03-15', '2029-03-15', 'Bienes', '02 - Gastos suministros',
        0.00, 3000.00, 3000.00, 'Completa'
      )
    `);

    const reportAdv = await handleBIReport(pool, {
      reportId: 'cash_flow',
      startDate: testAdvStart,
      endDate: testAdvEnd,
      salonId: 'all'
    });

    try {
      assert.strictEqual(reportAdv.reconciliation_meta.reconciled_606_count, 1, 'e-NCF 13 caracteres deduplicado exactamente 1 vez');
      assert.strictEqual(reportAdv.reconciliation_meta.reconciled_606_amount, 10000, 'Monto neto desembolsado deduplicado = 10,000');
      assert.strictEqual(reportAdv.total_pagado, 25000, 'Total pagado neto = 10,000 + 9,000 + 3,000 + 3,000 = 25,000');
      testPass('Normalización e-NCF 13 chars, deducción de retenciones y preservación de operaciones legítimas idénticas verificadas');
    } catch (e) { testFail('Validación avanzada NCF y retenciones', e); }

    // -----------------------------------------------------------------
    // ESCENARIOS FOCALIZADOS DE CIERRE: PUNTOS 1, 2, 3 Y 4
    // -----------------------------------------------------------------
    console.log('\n--- 14. PUNTO 1: EXCLUSIÓN DE CONSUMOS COLABORADOR (NOMINA) DE COBROS EN CAJA ---');
    await pool.query(`
      INSERT INTO visits (id, client_id, client_name, salon_id, visited_at, status, total, metodo_pago)
      VALUES 
        ('${TEST_PREFIX}V_NOMINA1', 'EMP-01', 'Colaboradora Ana', 1, '2029-01-11 11:00:00', 'Facturado', 2500.00, 'Nomina'),
        ('${TEST_PREFIX}V_NOMINA2', 'EMP-02', 'Colaboradora Luisa', 1, '2029-01-12 16:00:00', 'Facturado', 1200.00, 'Nómina')
    `);
    const reportColab = await handleBIReport(pool, {
      reportId: 'cash_flow',
      startDate: testStartDate,
      endDate: testEndDate,
      salonId: '1'
    });
    try {
      // Debe mantenerse en 10,000 (no sumar los 3,700 de consumos a nómina)
      assert.strictEqual(reportColab.total_cobrado, 10000, 'Consumos de colaboradora a nómina no deben contarse como cobros en caja');
      assert.strictEqual(reportColab.reconciliation_meta.excluded_colab_nomina_amount, 3700, 'Monto excluido de nómina debe ser 3,700');
      assert.strictEqual(reportColab.reconciliation_meta.excluded_colab_nomina_count, 2, '2 consumos a nómina excluidos');
      testPass('Punto 1: Consumos de colaborador (Nomina) excluidos de cobros en caja y contabilizados en metadatos');
    } catch (e) { testFail('Punto 1 Colaborador Nómina', e); }

    console.log('\n--- 15. PUNTO 2 Y 3: 606 DEMO PENDIENTE DE CONCILIACIÓN Y ALERTA DE FLUJO PARCIAL ---');
    await pool.query(`
      INSERT INTO dgii_606_purchases (
        periodo, rnc_cedula, tipo_id, tipo_bienes_servicios, proveedor, ncf,
        fecha_factura, fecha_pago, tipo_compra, clasificacion_gasto,
        monto_servicios, monto_bienes, total_facturado, estado
      ) VALUES (
        '202901', '131000001', 1, '02', 'Distribuidora Ejemplo', 'B0100000123',
        '2029-01-07', '2029-01-07', 'Bienes', '02 - Gastos suministros',
        0.00, 5000.00, 5000.00, 'Completa'
      )
    `);
    const reportDemo606 = await handleBIReport(pool, {
      reportId: 'cash_flow',
      startDate: testStartDate,
      endDate: testEndDate,
      salonId: '1'
    });
    try {
      assert.strictEqual(reportDemo606.reconciliation_meta.pending_606_count, 1, '1 registro demo 606 marcado pendiente de conciliación');
      assert.strictEqual(reportDemo606.reconciliation_meta.pending_606_amount, 5000, '5,000 demo 606 no debe inflar total_pagado');
      assert.strictEqual(reportDemo606.warning, 'Flujo parcial: existen pagos pendientes de registro', 'Debe emitir advertencia de flujo parcial');
      assert.strictEqual(reportDemo606.badges.some(b => b.text === 'Flujo parcial: existen pagos pendientes de registro'), true, 'Badge de flujo parcial presente');
      testPass('Punto 2 y 3: Compra demo 606 aislada en pendiente de conciliación y advertencia visible');
    } catch (e) { testFail('Punto 2 y 3 Demo 606 y Alerta', e); }

    console.log('\n--- 16. INTEGRACIÓN DE GASTOS DE CAJA POS Y DEDUPLICACIÓN SINTÉTICA ---');
    // Insertar un gasto de caja POS en Salon 1 (Caja 144) que NO esté en egresos
    await pool.query(`
      INSERT INTO cash_register_movements (
        id, cash_register_id, type, amount, concept, created_at
      ) VALUES (
        999901, 144, 'Gasto_Imprevisto', 1200.00, 'SYNTH_CF_ Compra de bombillo e insumos', '2029-01-15 12:00:00'
      )
    `);
    // Insertar un gasto de caja POS en Salon 1 (Caja 144) que SÍ esté registrado en expenses (para probar deduplicación)
    await pool.query(`
      INSERT INTO cash_register_movements (
        id, cash_register_id, type, amount, concept, created_at
      ) VALUES (
        999902, 144, 'Gasto_Imprevisto', 3500.00, 'SYNTH_CF_ Pago arreglo secador CRM-999902', '2029-01-16 12:00:00'
      )
    `);
    await pool.query(`
      INSERT INTO expenses (
        concept_name, payment_date, period, amount, payment_method, salon_id, reference, observation, status, is_loan
      ) VALUES (
        'Otros pagos', '2029-01-16', '2029-01', 3500.00, 'Efectivo', 1, 'CRM-999902',
        'Reembolso caja movimiento CRM-999902', 'Completado', 0
      )
    `);

    const reportCrmTest = await handleBIReport(pool, {
      reportId: 'cash_flow',
      startDate: testStartDate,
      endDate: testEndDate,
      salonId: '1'
    });
    try {
      // 55,500 inicial + 3,500 (egreso deduplicado) + 1,200 (caja no duplicada) = 60,200
      assert.strictEqual(reportCrmTest.total_pagado, 60200, 'Total pagado debe incluir gasto de caja único y deduplicar el duplicado');
      assert.strictEqual(reportCrmTest.reconciliation_meta.cash_register_expenses_count, 1, '1 gasto de caja no duplicado computado');
      assert.strictEqual(reportCrmTest.reconciliation_meta.cash_register_deduplicated_count, 1, '1 gasto de caja duplicado en egresos omitido');
      testPass('Gastos de caja POS integrados con deduplicación rigurosa contra Egresos');
    } catch (e) { testFail('Integración y deduplicación gastos de caja', e); }

    console.log('\n--- 17. CONCILIACIÓN FINAL DEFINITIVA DE OCTUBRE 2026 ---');
    const reportOct2026 = await handleBIReport(pool, {
      reportId: 'cash_flow',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      salonId: 'all'
    });
    try {
      assert.strictEqual(reportOct2026.total_cobrado, 1647712.5, 'Total cobrado real Octubre 2026 = 1,647,712.50');
      // 147,123 (Egresos) + 40,510 (38 gastos caja POS) = 187,633.00
      assert.strictEqual(reportOct2026.total_pagado, 187633, 'Total pagado conciliado Octubre 2026 = 187,633.00');
      assert.strictEqual(reportOct2026.excedente_periodo, 1460079.5, 'Excedente registrado Octubre 2026 = 1,460,079.50');
      assert.strictEqual(reportOct2026.excedente_pct, 88.6, 'Excedente % real Octubre 2026 = 88.6%');
      
      // Suma estricta de categorías === Total pagado
      const sumOctBreakdown = (reportOct2026.concepts_breakdown || []).reduce((acc, c) => acc + Number(c.amount || 0), 0);
      assert.strictEqual(sumOctBreakdown, 187633, 'Suma de los 7 conceptos debe ser exactamente 187,633.00');
      
      // Nómina y cobertura
      assert.strictEqual(reportOct2026.reconciliation_meta.pending_payroll_amount, 827113.86, 'Nómina calculada en plantilla = 827,113.86');
      assert.strictEqual(reportOct2026.reconciliation_meta.flujo_completo_conciliado, 632965.64, 'Flujo completo conciliado = 632,965.64');
      assert.strictEqual(reportOct2026.reconciliation_meta.flujo_completo_pct, 38.4, 'Flujo completo % = 38.4%');
      assert.strictEqual(reportOct2026.warning, 'Flujo parcial: existen pagos pendientes de registro', 'Alerta de flujo parcial');
      
      // Caja POS y 606
      assert.strictEqual(reportOct2026.reconciliation_meta.cash_register_expenses_count, 38, '38 gastos de caja POS incorporados');
      assert.strictEqual(reportOct2026.reconciliation_meta.cash_register_expenses_amount, 40510, 'RD$ 40,510 de caja POS incorporados');
      assert.strictEqual(reportOct2026.reconciliation_meta.pending_606_count, 1, '1 compra 606 demostrativa aislada en pendiente');
      assert.strictEqual(reportOct2026.reconciliation_meta.excluded_colab_nomina_count, 31, '31 consumos de colaboradores excluidos');
      assert.strictEqual(reportOct2026.reconciliation_meta.excluded_colab_nomina_amount, 9630, 'RD$ 9,630 consumos colaboradores excluidos de caja');
      testPass('Conciliación final Octubre 2026: Cobrado (1,647,712.50), Pagado (187,633.00), Excedente (1,460,079.50 / 88.6%), Flujo completo (632,965.64 / 38.4%)');
    } catch (e) { testFail('Conciliación final Octubre 2026', e); }

    console.log('\n--- 18. AISLAMIENTO POR SUCURSAL EN OCTUBRE 2026 (SUCURSAL 1) ---');
    const reportOctS1 = await handleBIReport(pool, {
      reportId: 'cash_flow',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      salonId: '1'
    });
    try {
      // S1 Egresos (147,123) + S1 Caja (6,920: Loraly 6,800 + agua 120) = 154,043.00
      assert.strictEqual(reportOctS1.total_pagado, 154043, 'Total pagado S1 Octubre 2026 = 154,043.00');
      const sumS1 = (reportOctS1.concepts_breakdown || []).reduce((acc, c) => acc + Number(c.amount || 0), 0);
      assert.strictEqual(sumS1, 154043, 'Suma de conceptos S1 === Total pagado S1');
      testPass('Filtro de sucursal S1 en Octubre 2026 aisla con precisión Egresos y Caja');
    } catch (e) { testFail('Aislamiento S1 Octubre 2026', e); }

  } catch (err) {
    console.error('Error general en suite financiera:', err);
    failed++;
  } finally {
    console.log('\n--- Limpieza final de datos sintéticos ---');
    await cleanTestData();
    await pool.end();
  }

  console.log('\n======================================================');
  console.log(`   RESULTADOS FINALES: ${passed} APROBADAS | ${failed} FALLIDAS`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runFinancialSuite().catch(err => {
  console.error('Fallo no controlado en suite:', err);
  process.exit(1);
});
