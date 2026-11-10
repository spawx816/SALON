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

  const [ncActive] = await pool.query(`
    SELECT id, visited_at, total, metodo_pago, status, ncf, ncf_nota_credito
    FROM visits
    WHERE status NOT IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada')
      AND ncf_nota_credito IS NOT NULL AND ncf_nota_credito != ''
  `);
  console.log('Visits active with ncf_nota_credito:', ncActive);

  // Check if there are any visit payments in payments table
  const [crossDupes] = await pool.query(`
    SELECT p.id, p.amount, p.created_at, v.id as visit_id, v.total
    FROM payments p
    JOIN visits v ON p.gateway_ref = v.id OR p.description LIKE CONCAT('%', v.id, '%')
  `);
  console.log('Cross dupes between payments and visits:', crossDupes);

  // Check if any visit has metodo_pago = 'Nomina'
  const [nominaVisits] = await pool.query(`
    SELECT COUNT(*) as cnt, SUM(total) as sum_total
    FROM visits
    WHERE visited_at >= '2026-10-01 00:00:00' AND visited_at <= '2026-10-31 23:59:59'
      AND status NOT IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada', 'Pendiente')
      AND metodo_pago = 'Nomina'
  `);
  console.log('Visits with metodo_pago = Nomina in oct 2026:', nominaVisits);

  await pool.end();
}

main().catch(console.error);

