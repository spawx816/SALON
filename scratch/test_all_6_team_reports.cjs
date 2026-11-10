const path = require('path');
const assert = require('assert');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
const { handleBIReport } = require('../backend/routes/bi_engine');

async function run() {
  console.log('=== VALIDACIÓN COMPLETA DE LOS 6 REPORTES DE PRODUCTIVIDAD Y RENTABILIDAD ===\n');

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5
  });

  const reports = [
    'cash_flow',
    'employee_productivity',
    'income_vs_commissions',
    'income_vs_payroll',
    'overtime_vs_results',
    'attendance_trends'
  ];

  for (const repId of reports) {
    console.log(`--- Probando reporte: ${repId} (Octubre 2026) ---`);
    const res = await handleBIReport(pool, {
      category: 'team',
      reportId: repId,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      salonId: 'all'
    });

    assert.ok(res && res.title, `El reporte ${repId} debe devolver un objeto con título`);
    assert.ok(Array.isArray(res.kpis) && res.kpis.length === 4, `El reporte ${repId} debe tener 4 KPIs`);
    assert.ok(!res.title.includes('Reporte Operativo de'), `El reporte ${repId} NO debe caer en el fallback genérico`);

    console.log(`  Título: ${res.title}`);
    console.log(`  KPIs: ${res.kpis.map(k => `${k.label}: ${k.value}`).join(' | ')}`);

    if (repId === 'employee_productivity') {
      assert.strictEqual(res.title, 'Productividad');
      assert.ok(Array.isArray(res.ranking_rows) && res.ranking_rows.length > 0, 'Debe incluir ranking_rows con datos reales');
      assert.ok(res.team_totals, 'Debe incluir team_totals (Total del equipo)');
      assert.ok(Array.isArray(res.available_services) && res.available_services.length > 0, 'Debe incluir lista de servicios disponibles');

      // Verificar orden descendente por total_realizados
      for (let i = 1; i < res.ranking_rows.length; i++) {
        assert.ok(
          res.ranking_rows[i - 1].total_realizados >= res.ranking_rows[i].total_realizados,
          'El ranking debe estar ordenado de mayor a menor por total_realizados'
        );
      }

      // Verificar cuadre matemático de Total del equipo
      const sumFact = res.ranking_rows.reduce((s, r) => s + r.servicios_facturados, 0);
      const sumMemb = res.ranking_rows.reduce((s, r) => s + r.lavados_membresia, 0);
      const sumTot = res.ranking_rows.reduce((s, r) => s + r.total_realizados, 0);
      const sumMonto = res.ranking_rows.reduce((s, r) => s + r.monto_generado, 0);

      assert.strictEqual(sumFact, res.team_totals.servicios_facturados);
      assert.strictEqual(sumMemb, res.team_totals.lavados_membresia);
      assert.strictEqual(sumTot, res.team_totals.total_realizados);
      assert.strictEqual(sumFact + sumMemb, sumTot);
      assert.strictEqual(sumMonto, res.team_totals.monto_generado);

      console.log(`  Top 5 Ranking del equipo:`);
      res.ranking_rows.slice(0, 5).forEach(r => {
        console.log(`    #${r.rank} ${r.empleado}: Fact=${r.servicios_facturados}, Memb=${r.lavados_membresia}, Total=${r.total_realizados}, Part=${r.participacion_pct}%, Svc/Día=${r.servicios_por_dia}, Monto=RD$${r.monto_generado.toLocaleString('es-DO')}, Var=${r.variacion_pct}%`);
      });
      console.log(`  Total del equipo: Fact=${res.team_totals.servicios_facturados}, Memb=${res.team_totals.lavados_membresia}, Total=${res.team_totals.total_realizados}, Part=100%, Svc/Día=${res.team_totals.servicios_por_dia}, Monto=RD$${res.team_totals.monto_generado.toLocaleString('es-DO')}, Var=${res.team_totals.variacion_pct}%`);
    }
    console.log(`  [PASS] ${repId} verificado con datos reales.\n`);
  }

  // Probar filtro por Servicio ("Lavado sencillo") en Productividad
  const resLavado = await handleBIReport(pool, {
    category: 'team',
    reportId: 'employee_productivity',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    salonId: 'all',
    serviceFilter: 'Lavado sencillo'
  });
  assert.ok(resLavado.team_totals.servicios_facturados > 0, 'Filtro Lavado sencillo debe tener servicios facturados');
  assert.ok(resLavado.team_totals.lavados_membresia > 0, 'Filtro Lavado sencillo debe incluir lavados de membresía');
  console.log(`  [PASS] Filtro por servicio "Lavado sencillo" verificado: ${resLavado.team_totals.servicios_facturados} facturados + ${resLavado.team_totals.lavados_membresia} membresía = ${resLavado.team_totals.total_realizados} realizados (RD$ ${resLavado.team_totals.monto_generado.toLocaleString('es-DO')})`);

  await pool.end();
  console.log('\n=== LOS 6 REPORTES DE PRODUCTIVIDAD Y RENTABILIDAD PASARON EXITOSAMENTE ===');
}

run().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
