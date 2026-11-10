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

  const [methods] = await pool.query(`
    SELECT metodo_pago, COUNT(*) as cnt, SUM(total) as sum_total
    FROM visits
    WHERE visited_at >= '2026-10-01 00:00:00' AND visited_at <= '2026-10-31 23:59:59'
      AND status NOT IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada', 'Pendiente')
    GROUP BY metodo_pago
    ORDER BY sum_total DESC
  `);
  console.log('Metodos de pago en octubre 2026 (vigentes):');
  methods.forEach(m => console.log(`${m.metodo_pago}: cnt=${m.cnt}, total=${m.sum_total}`));

  await pool.end();
}

main().catch(console.error);

