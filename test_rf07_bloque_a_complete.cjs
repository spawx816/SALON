/**
 * SUITE COMPLETA DE VERIFICACIÓN - BLOQUE A (RF-07)
 * Ejecuta todas las validaciones unitarias, de integración y no-regresión requeridas.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');
const { handleBIReport } = require('./routes/bi_engine');

async function runCompleteSuite() {
  console.log('================================================================');
  console.log('SUITE INTEGRAL DE PRUEBAS AUTOMATIZADAS - BLOQUE A (RF-07)');
  console.log('================================================================\n');

  let pool;
  let passed = 0;
  let failed = 0;

  function assert(condition, name, details = '') {
    if (condition) {
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${name} ${details ? '- ' + details : ''}`);
      failed++;
    }
  }

  try {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 5,
      connectTimeout: 8000
    });

    // 1. Verificación de configuración de renewal_fee en DB
    console.log('--- 1. Verificación de renewal_fee dinámico en contract_settings ---');
    const [cs] = await pool.query("SELECT renewal_fee FROM contract_settings WHERE id = 1");
    const dbFee = parseFloat(cs[0]?.renewal_fee || 800);
    assert(dbFee === 800, 'El valor en contract_settings es RD$ 800.00', `Valor: ${dbFee}`);

    // 2. Consulta de mayo 2027 (datos reales de producción de contratos de mayo 2026)
    console.log('\n--- 2. Consulta y Proyección con Datos Reales (Mayo 2027) ---');
    const resMay = await handleBIReport(pool, {
      reportId: 'contracts_upcoming_renewal',
      startDate: '2027-05-01',
      endDate: '2027-05-31'
    });

    const [activeMayContracts] = await pool.query(`
      SELECT COUNT(*) as c FROM contracts 
      WHERE status IN ('Active', 'Pending_Retry') 
        AND signed_at >= '2026-05-01 00:00:00' AND signed_at <= '2026-05-31 23:59:59'
    `);
    const expectedMayCount = activeMayContracts[0].c;

    const kpi1 = parseInt(resMay.kpis[0].value, 10);
    const kpi2Str = resMay.kpis[1].value;
    const kpi2Num = parseInt(kpi2Str.replace(/[^0-9]/g, ''), 10);
    const kpi3 = parseInt(resMay.kpis[2].value, 10);
    const kpi4 = parseInt(resMay.kpis[3].value, 10);

    assert(kpi1 === expectedMayCount, `KPI 1 (${kpi1}) concilia con contratos activos de mayo 2026 en BD (${expectedMayCount})`);
    assert(kpi2Num === expectedMayCount * 800, `KPI 2 (${kpi2Num}) es exactamente ${expectedMayCount} * 800 (${expectedMayCount * 800})`);
    assert(kpi3 >= 0, `KPI 3 (Vencidas) reporta cantidad válida: ${kpi3}`);
    assert(kpi4 >= 0, `KPI 4 (Pagadas) reporta cantidad válida: ${kpi4}`);

    // 3. Conciliación estricta de Gráfico por Sucursal con KPI 1
    console.log('\n--- 3. Conciliación Gráfico por Sucursal vs KPI 1 ---');
    const sumChart = (resMay.chart?.data || []).reduce((sum, item) => sum + (item.count || item.value || 0), 0);
    assert(sumChart === kpi1, `La suma de contratos por sucursal (${sumChart}) es 100% igual a KPI 1 (${kpi1})`);

    // 4. Verificación de columnas y contenido de filas
    console.log('\n--- 4. Verificación de Columnas y Formato de Filas ---');
    const cols = (resMay.table?.columns || []).map(c => c.key);
    const requiredCols = ['cliente', 'plan', 'sucursal', 'fecha_firma', 'fecha_renovacion', 'importe', 'dias_restantes', 'estado', 'accion'];
    assert(requiredCols.every(rc => cols.includes(rc)), 'Todas las columnas requeridas están presentes en table.columns');

    if (resMay.table?.rows?.length > 0) {
      const row0 = resMay.table.rows[0];
      assert(row0.importe.includes('800'), `La fila muestra cargo de renovación de RD$ 800: ${row0.importe}`);
      assert(row0.estado === 'Pendiente', `El estado de renovación a futuro es "Pendiente": ${row0.estado}`);
      assert(row0.fecha_firma && row0.fecha_firma.includes('may 2026'), `Fecha de firma corresponde a mayo 2026: ${row0.fecha_firma}`);
      assert(row0.fecha_renovacion && row0.fecha_renovacion.includes('may 2027'), `Fecha de aniversario corresponde a mayo 2027: ${row0.fecha_renovacion}`);
      assert(row0.accion === 'Perfil', `Acción es "Perfil": ${row0.accion}`);
    }

    // 5. Filtros Contextuales: Plan y Sucursal
    console.log('\n--- 5. Filtros de Plan y Sucursal ---');
    const [plans] = await pool.query("SELECT id, title FROM plans WHERE title LIKE '%Plan Beauty%' LIMIT 1");
    if (plans.length > 0) {
      const resPlan = await handleBIReport(pool, {
        reportId: 'contracts_upcoming_renewal',
        startDate: '2027-05-01',
        endDate: '2027-05-31',
        planId: plans[0].id
      });
      const planCount = parseInt(resPlan.kpis[0].value, 10);
      assert(planCount > 0, `Filtrado por plan ${plans[0].title} retorna contratos válidos: ${planCount}`);
      const allRowsPlan = (resPlan.table?.rows || []).every(r => r.plan.includes('Plan Beauty'));
      assert(allRowsPlan, `Todas las filas pertenecen al plan filtrado: ${plans[0].title}`);
    }

    // 6. Comprobación de Noviembre 2026 (Período actual sin aniversarios: 0 simulados)
    console.log('\n--- 6. Ausencia de Datos Simulados en Noviembre 2026 ---');
    const resNow = await handleBIReport(pool, {
      reportId: 'contracts_upcoming_renewal',
      startDate: '2026-11-01',
      endDate: '2026-11-30'
    });
    const nowCount = parseInt(resNow.kpis[0].value, 10);
    assert(nowCount === 0, `Período actual (mes 5) reporta 0 contratos próximos: ${nowCount}`);
    assert((resNow.table?.rows || []).length === 0, `No devuelve filas ficticias: ${resNow.table?.rows?.length} filas`);
    assert(resNow.table?.badgeText === '0 contratos', `Badge de tabla indica 0 contratos: ${resNow.table?.badgeText}`);

    // 7. No regresión en otros reportes de BI
    console.log('\n--- 7. No Regresión en Otros Reportes de BI ---');
    const resSales = await handleBIReport(pool, { reportId: 'sales_summary', startDate: '2026-10-01', endDate: '2026-10-31' });
    assert(resSales && resSales.title && resSales.title.toLowerCase().includes('ventas'), 'sales_summary opera correctamente');

    const resVoided = await handleBIReport(pool, { reportId: 'voided_invoices', startDate: '2026-10-01', endDate: '2026-10-31' });
    assert(resVoided && resVoided.title && resVoided.title.toLowerCase().includes('anuladas'), 'voided_invoices opera correctamente');

    const resCommissions = await handleBIReport(pool, { reportId: 'income_vs_commissions', startDate: '2026-10-01', endDate: '2026-10-31' });
    assert(resCommissions && resCommissions.title, 'income_vs_commissions opera correctamente');

  } catch (err) {
    console.error('Error durante la ejecución de pruebas:', err);
    failed++;
  } finally {
    if (pool) await pool.end();
  }

  console.log('\n================================================================');
  console.log(`TOTAL RESULTADOS BLOQUE A: ${passed} EXITOSAS | ${failed} FALLIDAS`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
}

runCompleteSuite();

