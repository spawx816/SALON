/**
 * Test Suite: FASE B2 - Gráficos y Visualizaciones de Efectividad de Cobros y Recuperación (TDD)
 *
 * Verifica:
 * 1. Gráfico A: Distribución apilada de las 49 obligaciones verificadas.
 * 2. Exclusión estricta de pagos sin atribución del Gráfico A.
 * 3. Coincidencia matemática exacta de categorías y total de obligaciones.
 * 4. Gráfico B: Evolución mensual con denominadores correctos (obligaciones evaluables).
 * 5. Gráfico C: Causas de rechazo inicial con código 05 genérico sin asumir fondos.
 * 6. Gráfico C: Separación de errores técnicos de conexión frente a rechazos bancarios.
 * 7. Gráfico D: Recuperación en segundo intento.
 * 8. Gráfico D: Recuperación en tercer intento.
 * 9. Gráfico D: Recuperación en intento 8 o posterior.
 * 10. Gráfico D: Recuperación manual / caja independiente.
 * 11. Obligaciones con más de 30 días de reintentos consolidan en su obligación única.
 * 12. Filtro por sucursal aplicado consistentemente en los 4 gráficos.
 * 13. Filtro por plan aplicado consistentemente en los 4 gráficos.
 * 14. Fecha de corte histórica preservada en los gráficos.
 * 15. Estados vacíos sin NaN ni datos ficticios.
 * 16. No regresión de RF-07.
 * 17. No regresión del resto de reportes BI.
 */
const path = require('path');
process.env.NODE_PATH = path.join(__dirname, 'node_modules');
require('module').Module._initPaths();
const assert = require('assert');
const { handleBIReport } = require('./routes/bi_engine');

console.log('======================================================================');
console.log('SUITE TDD B2: GRÁFICOS Y VISUALIZACIONES FINANCIERAS REALES');
console.log('======================================================================\n');

let passed = 0;
let failed = 0;

function testAssert(condition, name, details = '') {
  if (condition) {
    console.log(`✅ [PASS] ${name}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${name} ${details ? '- ' + details : ''}`);
    failed++;
  }
}

// Mock pool constructor for synthetic and regression tests
function createMockPool(contracts, payments) {
  return {
    async query(sql, params) {
      if (sql.includes('FROM contracts ct')) {
        let filtered = [...contracts];
        if (params && params.length > 0) {
          // If salon filter
          if (sql.includes('ct.salon_id = ?')) {
            const salonVal = params[0];
            filtered = filtered.filter(c => String(c.salon_id) === String(salonVal));
          }
          // If plan filter
          if (sql.includes('ct.plan_id = ?')) {
            const planVal = params[params.length - 1];
            filtered = filtered.filter(c => String(c.plan_id) === String(planVal) || c.plan === planVal);
          }
        }
        return [filtered];
      }
      if (sql.includes('FROM payments')) {
        return [payments];
      }
      if (sql.includes('FROM visits v')) {
        return [[{ valid_invoices: 10, total_sales: 15000, avg_ticket: 1500 }]];
      }
      return [[]];
    }
  };
}

async function runTests() {
  // ----------------------------------------------------
  // TEST SET 1: Octubre 2026 - Gráficos A, B, C y D con datos reales
  // ----------------------------------------------------
  console.log('--- ESCENARIO REAL OCTUBRE 2026: 49 OBLIGACIONES ---');

  // Load real DB connection if available
  let pool;
  try {
    require('dotenv').config({ path: path.join(__dirname, '.env') });
    const mysql = require('mysql2/promise');
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME
    });
  } catch (err) {
    console.warn('Real DB pool not available, using synthetic mock');
  }

  let realReport = null;
  if (pool) {
    try {
      realReport = await handleBIReport(pool, {
        reportId: 'recurring_charges_result',
        startDate: '2026-10-01',
        endDate: '2026-10-31'
      });
    } catch (e) {
      console.warn('Real query error:', e.message);
    }
  }

  // 1. Distribución de 49 obligaciones verificadas (Gráfico A)
  testAssert(
    realReport && realReport.charts && realReport.charts.quota_results && realReport.charts.quota_results.total_obligations === 49,
    'T1: Gráfico A totaliza exactamente 49 obligaciones verificadas',
    `Obtenido: ${realReport?.charts?.quota_results?.total_obligations}`
  );

  // 2. Exclusión de pagos sin atribución de la distribución principal
  const quotaCategories = realReport?.charts?.quota_results?.categories || [];
  const hasUnattributedCategory = quotaCategories.some(c => (c.label || '').toLowerCase().includes('atribución') || (c.label || '').toLowerCase().includes('sin asignar'));
  testAssert(
    !hasUnattributedCategory,
    'T2: Gráfico A excluye estrictamente pagos sin atribución contractual'
  );

  // 3. Coincidencia matemática exacta de categorías y total de obligaciones
  const sumCategories = quotaCategories.reduce((acc, c) => acc + (c.count || 0), 0);
  testAssert(
    sumCategories === 49,
    'T3: Suma exacta de categorías de Gráfico A coincide con las 49 obligaciones',
    `Suma categorías: ${sumCategories}`
  );

  // 4. Gráfico B: Evolución mensual con denominadores correctos
  const monthlyData = realReport?.charts?.monthly_evolution || [];
  const octMonth = monthlyData.find(m => m.month === '2026-10' || m.label.toLowerCase().includes('oct'));
  testAssert(
    octMonth && octMonth.total_obligations === 49 && octMonth.paid_first === 33 && Math.abs(octMonth.percentage - 67.3) < 0.2,
    'T4: Gráfico B calcula tasa mensual sobre 49 obligaciones evaluables (33/49 = 67.3%)',
    `Oct: ${JSON.stringify(octMonth)}`
  );

  // 5. Gráfico C: Causas de rechazo inicial con código 05 genérico
  const declineCauses = realReport?.charts?.decline_causes || [];
  const generic05 = declineCauses.find(d => d.category.includes('05') || d.category.toLowerCase().includes('genérico'));
  testAssert(
    generic05 && generic05.count === 16 && generic05.total_declined === 16,
    'T5: Gráfico C reporta 16 rechazos iniciales clasificados con código 05 genérico',
    `05: ${JSON.stringify(generic05)}`
  );

  // 6. Gráfico C: Separación de errores técnicos de conexión
  const techErrorCat = declineCauses.find(d => d.category.toLowerCase().includes('técnico') || d.category.toLowerCase().includes('conexión'));
  const genericHasTech = generic05 && generic05.category.toLowerCase().includes('conexión');
  testAssert(
    !genericHasTech,
    'T6: Gráfico C no mezcla errores técnicos de pasarela con rechazos bancarios'
  );

  // 7. Gráfico D: Recuperación en segundo intento (1 en octubre)
  const retryData = realReport?.charts?.retry_effectiveness || [];
  const secondAttempt = retryData.find(r => r.label.toLowerCase().includes('segundo'));
  testAssert(
    secondAttempt && secondAttempt.count === 1,
    'T7: Gráfico D identifica exactamente 1 cuota recuperada en segundo intento',
    `Segundo intento: ${JSON.stringify(secondAttempt)}`
  );

  // 8. Gráfico D: Recuperación en tercer intento (5 en octubre)
  const thirdAttempt = retryData.find(r => r.label.toLowerCase().includes('tercer'));
  testAssert(
    thirdAttempt && thirdAttempt.count === 5,
    'T8: Gráfico D identifica exactamente 5 cuotas recuperadas en tercer intento',
    `Tercer intento: ${JSON.stringify(thirdAttempt)}`
  );

  // 9. Gráfico D: Recuperación en intento 8 o posterior (1 en octubre)
  const eightPlusAttempt = retryData.find(r => r.label.toLowerCase().includes('8'));
  testAssert(
    eightPlusAttempt && eightPlusAttempt.count === 1,
    'T9: Gráfico D identifica exactamente 1 cuota recuperada en intento 8 o posterior',
    `Intento 8+: ${JSON.stringify(eightPlusAttempt)}`
  );

  // 10. Gráfico D: Recuperación manual / caja independiente (1 en octubre)
  const manualRecovery = retryData.find(r => r.label.toLowerCase().includes('caja') || r.label.toLowerCase().includes('otra vía'));
  testAssert(
    manualRecovery && manualRecovery.count === 1,
    'T10: Gráfico D clasifica independientemente 1 cuota recuperada por caja / otra vía',
    `Recuperación caja: ${JSON.stringify(manualRecovery)}`
  );

  // ----------------------------------------------------
  // TEST SET 2: Pruebas sintéticas controladas
  // ----------------------------------------------------
  console.log('\n--- PRUEBAS SINTÉTICAS DE FILTROS, CORTE Y REGRESIÓN ---');

  // 11. Obligaciones con más de 30 días de reintentos
  const ctLong = {
    contract_id: 'CTR-LONG-9999',
    client_id: 888,
    cliente: 'Socia Con Reintentos 90 Días',
    plan: 'Plan Beauty',
    contract_price: 1950,
    salon_id: 1,
    status: 'active'
  };
  const payLongAttempts = [];
  for (let d = 1; d <= 45; d++) {
    payLongAttempts.push({
      id: `PAY-FAIL-9999-${d}`,
      client_id: 888,
      amount: 1950,
      method: 'CardNet_Auto',
      status: 'Fallido - Rechazado',
      description: 'Cobro Mensual Recurrente: Plan Beauty',
      cardnet_raw_response: JSON.stringify({ ResponseCode: '05', ResponseMessage: 'Declinada' }),
      created_at: new Date(2026, 9, d < 31 ? d : 30, 8, 0, 0),
      created_at_str: `2026-10-${String(Math.min(d, 31)).padStart(2, '0')} 08:00:00`
    });
  }
  const poolLong = createMockPool([ctLong], payLongAttempts);
  const repLong = await handleBIReport(poolLong, {
    reportId: 'recurring_charges_result',
    startDate: '2026-10-01',
    endDate: '2026-10-31'
  });
  testAssert(
    repLong.charts?.quota_results?.total_obligations === 1 &&
    repLong.charts?.quota_results?.categories?.find(c => c.label === 'Sin recuperar')?.count === 1,
    'T11: 45 reintentos fallidos durante 45 días representan exactamente 1 obligación no recuperada en Gráfico A'
  );

  // 12. Filtro por sucursal
  const ctS1 = { contract_id: 'CTR-S1-0001', client_id: 101, salon_id: 1, sucursal: 'San Vicente', plan: 'Plan Beauty', contract_price: 1950 };
  const ctS2 = { contract_id: 'CTR-S2-0002', client_id: 102, salon_id: 2, sucursal: 'Villa Mella', plan: 'Plan Beauty', contract_price: 1950 };
  const payS1 = [{ id: 'PAY-AUTO-0001', client_id: 101, amount: 1950, method: 'CardNet_Auto', status: 'Aprobado', description: 'Cobro Mensual Recurrente: Plan Beauty', created_at: new Date('2026-10-05T08:00:00Z'), created_at_str: '2026-10-05 08:00:00' }];
  const payS2 = [{ id: 'PAY-AUTO-0002', client_id: 102, amount: 1950, method: 'CardNet_Auto', status: 'Aprobado', description: 'Cobro Mensual Recurrente: Plan Beauty', created_at: new Date('2026-10-05T08:00:00Z'), created_at_str: '2026-10-05 08:00:00' }];
  const poolBranch = createMockPool([ctS1, ctS2], [...payS1, ...payS2]);
  const repBranch = await handleBIReport(poolBranch, {
    reportId: 'recurring_charges_result',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    salonId: 1
  });
  testAssert(
    repBranch.charts?.quota_results?.total_obligations === 1 && repBranch.charts?.quota_results?.categories?.[0]?.count === 1,
    'T12: Filtro por sucursal limita los 4 gráficos a las obligaciones de esa sede'
  );

  // 13. Filtro por plan
  const ctP1 = { contract_id: 'CTR-PB-0001', client_id: 201, salon_id: 1, plan_id: 1, plan: 'Plan Beauty', contract_price: 1950 };
  const ctP2 = { contract_id: 'CTR-PP-0002', client_id: 202, salon_id: 1, plan_id: 2, plan: 'Plan Premium', contract_price: 3500 };
  const payP1 = [{ id: 'PAY-AUTO-PB-0001', client_id: 201, amount: 1950, method: 'CardNet_Auto', status: 'Aprobado', description: 'Cobro Mensual Recurrente: Plan Beauty', created_at: new Date('2026-10-10T08:00:00Z'), created_at_str: '2026-10-10 08:00:00' }];
  const payP2 = [{ id: 'PAY-AUTO-PP-0002', client_id: 202, amount: 3500, method: 'CardNet_Auto', status: 'Aprobado', description: 'Cobro Mensual Recurrente: Plan Premium', created_at: new Date('2026-10-10T08:00:00Z'), created_at_str: '2026-10-10 08:00:00' }];
  const poolPlan = createMockPool([ctP1, ctP2], [...payP1, ...payP2]);
  const repPlan = await handleBIReport(poolPlan, {
    reportId: 'recurring_charges_result',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    planId: 1
  });
  testAssert(
    repPlan.charts?.quota_results?.total_obligations === 1,
    'T13: Filtro por plan aísla exclusivamente las obligaciones de ese plan en los gráficos'
  );

  // 14. Fecha de corte histórica
  const ctRev = { contract_id: 'CTR-REV-7777', client_id: 301, salon_id: 1, plan: 'Plan Beauty', contract_price: 1950 };
  const payRev = [
    { id: 'PAY-AUTO-7777', client_id: 301, amount: 1950, method: 'CardNet_Auto', status: 'Aprobado', description: 'Cobro Mensual Recurrente: Plan Beauty', created_at: new Date('2026-10-15T08:00:00Z'), created_at_str: '2026-10-15 08:00:00' },
    { id: 'REV-7777', client_id: 301, amount: -1950, method: 'CardNet_Auto', status: 'Revertido', gateway_ref: 'PAY-AUTO-7777', description: 'Reversión por contracargo', created_at: new Date('2026-11-05T10:00:00Z'), created_at_str: '2026-11-05 10:00:00' }
  ];
  const poolRev = createMockPool([ctRev], payRev);
  const repCutoff = await handleBIReport(poolRev, {
    reportId: 'recurring_charges_result',
    startDate: '2026-10-01',
    endDate: '2026-10-31'
  });
  const catPaidCutoff = repCutoff.charts?.quota_results?.categories?.find(c => c.label === 'Pagada 1er intento');
  testAssert(
    catPaidCutoff && catPaidCutoff.count === 1,
    'T14: Fecha de corte histórica preserva en Gráfico A el estado vigente al corte (Pagada 1er intento)'
  );

  // 15. Estados vacíos sin NaN
  const poolEmpty = createMockPool([], []);
  const repEmpty = await handleBIReport(poolEmpty, {
    reportId: 'recurring_charges_result',
    startDate: '2026-10-01',
    endDate: '2026-10-31'
  });
  const quotaEmpty = repEmpty.charts?.quota_results;
  const evolEmpty = repEmpty.charts?.monthly_evolution;
  const declineEmpty = repEmpty.charts?.decline_causes;
  const retryEmpty = repEmpty.charts?.retry_effectiveness;
  testAssert(
    quotaEmpty && quotaEmpty.total_obligations === 0 &&
    declineEmpty && declineEmpty.length === 0 &&
    retryEmpty && retryEmpty.length === 0,
    'T15: Estado vacío no genera NaN ni arrays ficticios'
  );

  // 16. No regresión de RF-07
  let rf07Pass = false;
  try {
    const repRF07 = await handleBIReport(pool || poolEmpty, {
      reportId: 'contracts_upcoming_renewal',
      period: 'next_365_days'
    });
    rf07Pass = repRF07 && repRF07.title === 'Renovación anual de contratos' && Array.isArray(repRF07.kpis);
  } catch (e) {
    rf07Pass = false;
  }
  testAssert(rf07Pass, 'T16: No regresión de RF-07 (Renovación anual)');

  // 17. No regresión del resto de reportes BI
  let salesPass = false;
  try {
    const repSales = await handleBIReport(pool || poolEmpty, {
      reportId: 'sales_summary',
      startDate: '2026-10-01',
      endDate: '2026-10-31'
    });
    salesPass = repSales && repSales.title === 'Resumen de ventas y cobros' && Array.isArray(repSales.kpis);
  } catch (e) {
    salesPass = false;
  }
  testAssert(salesPass, 'T17: No regresión de otros reportes BI (sales_summary)');

  if (pool) await pool.end();

  console.log('\n======================================================================');
  console.log(`RESUMEN PRUEBAS TDD B2: ${passed} PASARON, ${failed} FALLARON`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
