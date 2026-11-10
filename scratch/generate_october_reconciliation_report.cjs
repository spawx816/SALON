const path = require('path');
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });
const { handleBIReport } = require('../backend/routes/bi_engine');

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_NAME,
    timezone: '-04:00'
  });

  const start = '2026-10-01';
  const end = '2026-10-31';

  // 1. BI Engine calculation
  const biReport = await handleBIReport(pool, {
    reportId: 'cash_flow',
    startDate: start,
    endDate: end,
    salonId: 'all'
  });

  // 2. Independent SQL for Cobros:
  const [visRows] = await pool.query(`
    SELECT 
      COUNT(*) as total_visitas,
      COALESCE(SUM(total), 0) as total_cobrado_visitas
    FROM visits
    WHERE visited_at >= '2026-10-01 00:00:00' AND visited_at <= '2026-10-31 23:59:59'
      AND status NOT IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada', 'Pendiente')
      AND (ncf_nota_credito IS NULL OR ncf_nota_credito = '')
  `);

  const [payRows] = await pool.query(`
    SELECT 
      COUNT(*) as total_membresias_aprobadas,
      COALESCE(SUM(amount), 0) as total_cobrado_membresias
    FROM payments
    WHERE created_at >= '2026-10-01 00:00:00' AND created_at <= '2026-10-31 23:59:59'
      AND status = 'Aprobado'
  `);

  // 3. Independent SQL for Egresos:
  const [expRows] = await pool.query(`
    SELECT id, concept_name, payment_date, amount, payment_method, salon_id, reference, observation, status, is_loan
    FROM expenses
    WHERE payment_date >= '2026-10-01' AND payment_date <= '2026-10-31'
      AND status NOT IN ('voided', 'Anulado', 'anulado', 'Cancelado', 'cancelado', 'Pendiente', 'pendiente')
  `);

  // 4. Independent SQL for 606:
  const [p606Rows] = await pool.query(`
    SELECT id, proveedor, ncf, fecha_pago, total_facturado, itbis_retenido, isr_retenido, clasificacion_gasto, estado
    FROM dgii_606_purchases
    WHERE fecha_pago IS NOT NULL AND fecha_pago != '' AND fecha_pago != '0000-00-00'
      AND fecha_pago >= '2026-10-01' AND fecha_pago <= '2026-10-31'
      AND estado NOT IN ('anulado', 'cancelado', 'pendiente', 'Pendiente')
  `);

  console.log('=== COMPARATIVA INDEPENDIENTE VS BI_ENGINE (OCTUBRE 2026) ===');
  const sqlCobrado = Number(visRows[0].total_cobrado_visitas) + Number(payRows[0].total_cobrado_membresias);
  const sqlPagado = expRows.reduce((a, b) => a + Number(b.amount), 0) + p606Rows.reduce((a, b) => a + (Number(b.total_facturado) - Number(b.itbis_retenido || 0) - Number(b.isr_retenido || 0)), 0);

  console.log('SQL Cobrado Visitas:', visRows[0].total_cobrado_visitas, `(${visRows[0].total_visitas} visitas)`);
  console.log('SQL Cobrado Membresías:', payRows[0].total_cobrado_membresias, `(${payRows[0].total_membresias_aprobadas} cargos)`);
  console.log('SQL Cobrado Total:', sqlCobrado);
  console.log('BI_Engine Total Cobrado:', biReport.total_cobrado);
  console.log('¿Coincidencia Total Cobrado?:', sqlCobrado === biReport.total_cobrado ? 'SÍ (EXACTA)' : 'NO');

  console.log('\nSQL Pagado Egresos:', expRows.map(e => `${e.concept_name}: ${e.amount}`));
  console.log('SQL Pagado 606:', p606Rows.map(p => `${p.proveedor} (${p.ncf}): ${p.total_facturado}`));
  console.log('SQL Pagado Total:', sqlPagado);
  console.log('BI_Engine Total Pagado:', biReport.total_pagado);
  console.log('¿Coincidencia Total Pagado?:', sqlPagado === biReport.total_pagado ? 'SÍ (EXACTA)' : 'NO');

  console.log('\nBI_Engine Excedente:', biReport.excedente_periodo);
  console.log('BI_Engine % Excedente:', biReport.excedente_pct + '%');
  console.log('BI_Engine Desglose:', biReport.concepts_breakdown);

  await pool.end();
}

main().catch(console.error);

