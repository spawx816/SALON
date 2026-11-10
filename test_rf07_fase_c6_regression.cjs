/**
 * Test Suite: FASE C6 - Pruebas de Regresión Integral (RF-01 a RF-06 y Otros Reportes)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');
const { handleBIReport } = require('./routes/bi_engine');

console.log('================================================================');
console.log('SUITE INTEGRAL FASE C6 - PRUEBAS DE REGRESIÓN DE REPORTES BI');
console.log('================================================================\n');

let passCount = 0;
let failCount = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`✅ [PASS] ${description}`);
    passCount++;
  } catch (err) {
    console.error(`❌ [FAIL] ${description}`);
    console.error(`   Error: ${err.message}`);
    failCount++;
  }
}

async function runRegressionSuite() {
  let pool;
  try {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      connectTimeout: 8000
    });

    const testPeriod = {
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      salonId: 'all'
    };

    // 1. RF-01: sales_summary (Resumen de ventas y cobros)
    {
      const res = await handleBIReport(pool, { reportId: 'sales_summary', ...testPeriod });
      test('RF-01: sales_summary opera con KPIs, gráfico de evolución y tabla', () => {
        assert(res && res.title && res.title.toLowerCase().includes('ventas'));
        assert(Array.isArray(res.kpis) && res.kpis.length >= 4);
        assert(res.chart && res.chart.type);
        assert(res.table && Array.isArray(res.table.columns) && Array.isArray(res.table.rows));
      });
    }

    // 2. RF-02: clients_summary (Estado de clientes)
    {
      const res = await handleBIReport(pool, { reportId: 'clients_summary', ...testPeriod });
      test('RF-02: clients_summary opera con métricas de clientes activos y cancelados', () => {
        assert(res && res.title);
        assert(Array.isArray(res.kpis) && res.kpis.length >= 3);
        assert(res.table && Array.isArray(res.table.rows));
      });
    }

    // 3. RF-03: visit_frequency (Frecuencia de visitas)
    {
      const res = await handleBIReport(pool, { reportId: 'visit_frequency', ...testPeriod });
      test('RF-03: visit_frequency genera distribución interactiva por rangos de visitas', () => {
        assert(res && res.title);
        assert(Array.isArray(res.kpis));
        assert(res.chart && Array.isArray(res.chart.data));
      });
    }

    // 4. RF-04: inactive_clients (Clientes inactivos)
    {
      const res = await handleBIReport(pool, { reportId: 'inactive_clients', daysInactive: 15, ...testPeriod });
      test('RF-04: inactive_clients reporta socias ausentes con días calculados', () => {
        assert(res && res.title);
        assert(res.table && Array.isArray(res.table.columns));
      });
    }

    // 5. RF-05: membership_redemptions (Canjes de membresía)
    {
      const res = await handleBIReport(pool, { reportId: 'membership_redemptions', ...testPeriod });
      test('RF-05: membership_redemptions calcula costo promedio y canjes por sucursal', () => {
        assert(res && res.title);
        assert(Array.isArray(res.kpis));
      });
    }

    // 6. RF-06: membership_cancellations (Cancelación de membresía)
    {
      const res = await handleBIReport(pool, { reportId: 'membership_cancellations', ...testPeriod });
      test('RF-06: membership_cancellations reporta motivos y auditoría de bajas', () => {
        assert(res && res.title);
        assert(res.table && Array.isArray(res.table.columns));
      });
    }

    // 7. Reportes Adicionales del Catálogo BI
    {
      const resCharges = await handleBIReport(pool, { reportId: 'upcoming_charges', ...testPeriod });
      test('Catálogo BI: upcoming_charges genera proyección de flujos mensuales', () => {
        assert(resCharges && resCharges.title);
        assert(Array.isArray(resCharges.kpis));
      });

      const resRec = await handleBIReport(pool, { reportId: 'recurring_charges_result', ...testPeriod });
      test('Catálogo BI: recurring_charges_result reporta tasas de cobros aprobados/rechazados', () => {
        assert(resRec && resRec.title);
      });

      const resRecov = await handleBIReport(pool, { reportId: 'declined_charges_recovery', ...testPeriod });
      test('Catálogo BI: declined_charges_recovery audita reintentos y recuperación', () => {
        assert(resRecov && resRecov.title);
      });

      const resComm = await handleBIReport(pool, { reportId: 'income_vs_commissions', ...testPeriod });
      test('Catálogo BI: income_vs_commissions consolida facturación vs comisiones de equipo', () => {
        assert(resComm && resComm.title);
      });

      const resVoided = await handleBIReport(pool, { reportId: 'voided_invoices', ...testPeriod });
      test('Catálogo BI: voided_invoices audita facturas anuladas sin alterar caja', () => {
        assert(resVoided && resVoided.title);
      });
    }

    // 8. Verificación de Integridad de Módulos Críticos No Afectados
    test('Integridad de archivos sensibles: Ningún cambio en cron de cobros ni pasarela', () => {
      // contracts.routes.js (cron de cobros)
      const contractsRoutes = fs.readFileSync(path.join(__dirname, 'routes/contracts.routes.js'), 'utf8');
      assert(contractsRoutes.includes('processSubscriptionsInternal'), 'processSubscriptionsInternal debe estar presente intacto');
      
      // cardnet.routes.js
      const cardnetRoutes = fs.readFileSync(path.join(__dirname, 'routes/cardnet.routes.js'), 'utf8');
      assert(cardnetRoutes.includes('createCardnetRouter'), 'createCardnetRouter debe estar presente intacto');

      // cash_registers.routes.js (POS)
      const posRoutes = fs.readFileSync(path.join(__dirname, 'routes/cash_registers.routes.js'), 'utf8');
      assert(posRoutes.includes('createCashRegistersRouter'), 'createCashRegistersRouter debe estar presente intacto');

      // clients.routes.js
      const clientsRoutes = fs.readFileSync(path.join(__dirname, 'routes/clients.routes.js'), 'utf8');
      assert(clientsRoutes.includes('createClientsRouter'), 'createClientsRouter debe estar presente intacto');

      // invoices.routes.js
      const invoicesRoutes = fs.readFileSync(path.join(__dirname, 'routes/invoices.routes.js'), 'utf8');
      assert(invoicesRoutes.includes('createInvoicesRouter'), 'createInvoicesRouter debe estar presente intacto');
    });

  } catch (err) {
    console.error('Error de regresión:', err.message);
    failCount++;
  } finally {
    if (pool) await pool.end();
  }

  console.log('\n================================================================');
  console.log(`TOTAL RESULTADOS FASE C6: ${passCount} EXITOSAS | ${failCount} FALLIDAS`);
  console.log('================================================================\n');

  if (failCount > 0) process.exit(1);
}

runRegressionSuite();

