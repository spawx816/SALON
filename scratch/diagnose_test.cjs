const path = require('path');
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });

async function diagnose() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'salon_pro'
  });

  const start = '2029-01-01';
  const end = '2029-01-31';
  const salonId = '1';
  const expenseSalonFilter = salonId !== 'all' ? 'AND (e.salon_id = ? OR e.salon_id IS NULL)' : '';
  const expenseParams = salonId !== 'all' ? [start, end, salonId] : [start, end];

  const [expensesRows] = await pool.query(`
    SELECT e.id, e.concept_name, e.amount, e.payment_date, e.reference, e.observation
    FROM expenses e
    WHERE e.payment_date >= ? AND e.payment_date <= ?
      AND e.status NOT IN ('voided', 'Anulado', 'anulado', 'Cancelado', 'cancelado', 'Pendiente', 'pendiente')
      ${expenseSalonFilter}
  `, expenseParams);
  console.log('expensesRows:', expensesRows);

  const [purchasesRows] = await pool.query(`
    SELECT id, ncf, fecha_pago, total_facturado, estado
    FROM dgii_606_purchases
    WHERE fecha_pago IS NOT NULL 
      AND fecha_pago != '' 
      AND fecha_pago != '0000-00-00'
      AND fecha_pago >= ? AND fecha_pago <= ?
      AND estado NOT IN ('anulado', 'cancelado', 'pendiente', 'Pendiente')
  `, [start, end]);
  console.log('purchasesRows:', purchasesRows);

  await pool.end();
}
diagnose();

