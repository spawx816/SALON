const path = require('path');
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || process.env.DB_PASS,
    database: process.env.DB_NAME,
    timezone: '-04:00'
  });

  console.log('=== OCTUBRE 2026: VISITS ===');
  const [octVisits] = await pool.query(`
    SELECT id, visited_at, total, metodo_pago, status, ncf, ncf_nota_credito, nota_credito_fecha, cash_register_id
    FROM visits
    WHERE visited_at >= '2026-10-01 00:00:00' AND visited_at <= '2026-10-31 23:59:59'
    ORDER BY visited_at ASC
  `);
  console.log(`Total visits en oct 2026: ${octVisits.length}`);
  const visitsByStatus = {};
  let totalMontoVisits = 0;
  let totalMontoVigente = 0;
  octVisits.forEach(v => {
    visitsByStatus[v.status] = (visitsByStatus[v.status] || 0) + 1;
    totalMontoVisits += Number(v.total || 0);
    if (!['Anulado', 'Anulada', 'Cancelado', 'Cancelada', 'Pendiente'].includes(v.status) && (!v.ncf_nota_credito)) {
      totalMontoVigente += Number(v.total || 0);
    }
  });
  console.log('Visitas por status:', visitsByStatus);
  console.log('Total monto visits:', totalMontoVisits);
  console.log('Total monto vigente sin NC:', totalMontoVigente);

  // Check if there are visits with nota de credito
  const ncVisits = octVisits.filter(v => v.ncf_nota_credito);
  console.log(`Visitas con nota de crédito en oct 2026: ${ncVisits.length}`);
  if (ncVisits.length > 0) {
    console.log(ncVisits);
  }

  console.log('\n=== OCTUBRE 2026: PAYMENTS ===');
  const [octPayments] = await pool.query(`
    SELECT id, client_id, plan_id, amount, method, status, created_at, gateway_ref, description
    FROM payments
    WHERE created_at >= '2026-10-01 00:00:00' AND created_at <= '2026-10-31 23:59:59'
    ORDER BY created_at ASC
  `);
  console.log(`Total payments en oct 2026: ${octPayments.length}`);
  const payByStatus = {};
  let totalPayAprobado = 0;
  octPayments.forEach(p => {
    payByStatus[p.status] = (payByStatus[p.status] || 0) + 1;
    if (p.status === 'Aprobado') totalPayAprobado += Number(p.amount || 0);
  });
  console.log('Payments por status:', payByStatus);
  console.log('Total payments Aprobado:', totalPayAprobado);
  console.log('Suma Vigentes Visits + Payments Aprobados =', totalMontoVigente + totalPayAprobado);

  console.log('\n=== OCTUBRE 2026: EXPENSES ===');
  const [octExpenses] = await pool.query(`
    SELECT id, concept_name, payment_date, period, amount, payment_method, salon_id, reference, observation, is_loan, breakdown_capital, breakdown_interest, breakdown_charges, status
    FROM expenses
    WHERE payment_date >= '2026-10-01' AND payment_date <= '2026-10-31'
  `);
  console.log(`Total expenses en oct 2026: ${octExpenses.length}`);
  console.log(octExpenses);

  console.log('\n=== OCTUBRE 2026: DGII_606_PURCHASES ===');
  const [oct606] = await pool.query(`
    SELECT id, periodo, proveedor, ncf, fecha_factura, fecha_pago, total_facturado, monto_servicios, monto_bienes, itbis_facturado, itbis_retenido, isr_retenido, forma_pago, clasificacion_gasto, estado, notas
    FROM dgii_606_purchases
    WHERE (fecha_pago >= '2026-10-01' AND fecha_pago <= '2026-10-31') OR periodo = '202610'
  `);
  console.log(`Total 606 en oct 2026: ${oct606.length}`);
  console.log(oct606);

  console.log('\n=== OCTUBRE 2026: CASH_REGISTER_MOVEMENTS ===');
  const [octMovements] = await pool.query(`
    SELECT *
    FROM cash_register_movements
    WHERE created_at >= '2026-10-01 00:00:00' AND created_at <= '2026-10-31 23:59:59'
    LIMIT 10
  `);
  console.log(`Sample movements oct 2026 count: ${octMovements.length}`);
  if (octMovements.length > 0) {
    console.log(octMovements[0]);
  }

  console.log('\n=== OCTUBRE 2026: PAYROLL_PERIODS & ITEMS ===');
  const [octPayroll] = await pool.query(`
    SELECT pp.id, pp.name, pp.start_date, pp.end_date, pp.status, pp.total_neto, pp.total_general
    FROM payroll_periods pp
    WHERE (pp.end_date >= '2026-10-01' AND pp.start_date <= '2026-10-31')
  `);
  console.log(`Payroll periods oct 2026: ${octPayroll.length}`);
  console.log(octPayroll);

  await pool.end();
}

main().catch(console.error);
