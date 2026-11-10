const path = require('path');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function inspect() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  console.log('--- 1. COMPANY NCF COUNTERS ---');
  const [counters] = await pool.query('SELECT * FROM company_ncf_counters');
  console.log(counters);

  console.log('--- 2. TODAY VISITS (CURDATE) ---');
  const [curdateRow] = await pool.query('SELECT CURDATE() as curdate, NOW() as now');
  console.log('DB Time:', curdateRow[0]);

  const [todayVisits] = await pool.query(
    'SELECT id, client_id, total, metodo_pago, ncf, ncf_type, visited_at, status FROM visits WHERE DATE(visited_at) = CURDATE() ORDER BY id ASC'
  );
  console.log('Count today:', todayVisits.length);
  console.table(todayVisits);

  console.log('--- 3. TODAY CASH VISITS ---');
  const [cashVisits] = await pool.query(
    "SELECT id, client_id, total, metodo_pago, ncf, ncf_type, visited_at, status FROM visits WHERE DATE(visited_at) = CURDATE() AND metodo_pago LIKE '%Efectivo%' ORDER BY id ASC"
  );
  console.log('Cash visits count:', cashVisits.length);
  console.table(cashVisits);

  console.log('--- 4. TODAY NCF TYPES SUMMARY ---');
  const [summary] = await pool.query(
    "SELECT ncf_type, metodo_pago, COUNT(*) as qty, SUM(total) as sum_total FROM visits WHERE DATE(visited_at) = CURDATE() GROUP BY ncf_type, metodo_pago"
  );
  console.table(summary);

  console.log('--- 5. LAST 20 VISITS OVERALL (IF NONE TODAY) ---');
  if (todayVisits.length === 0) {
    const [recent] = await pool.query(
      "SELECT id, client_id, total, metodo_pago, ncf, ncf_type, visited_at, status FROM visits ORDER BY id DESC LIMIT 20"
    );
    console.table(recent);
  }

  await pool.end();
}
inspect().catch(console.error);
