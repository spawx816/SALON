const path = require('path');
const mysql = require(path.join(__dirname, '..', 'backend', 'node_modules', 'mysql2', 'promise'));
const fs = require('fs');

const envPath = path.join(__dirname, '..', 'backend', '.env');
const env = fs.readFileSync(envPath, 'utf8').split('\n').reduce((acc, line) => {
  const [k, ...v] = line.trim().split('=');
  if (k && v.length) acc[k] = v.join('=');
  return acc;
}, {});

(async () => {
  const pool = mysql.createPool({
    host: env.DB_HOST,
    user: env.DB_USER,
    password: env.DB_PASSWORD || env.DB_PASS,
    database: env.DB_NAME,
    timezone: '-04:00'
  });

  console.log('--- MOVEMENTS IN CAJA 220 (YAFREISI) ---');
  const [moves] = await pool.query('SELECT * FROM cash_register_movements WHERE cash_register_id = 220');
  console.log('Movements in 220:', moves);

  console.log('--- VISITS IN SALON 4 TODAY (2026-11-03) ---');
  const [visitsSalon4] = await pool.query("SELECT id, ticket_number, client_id, client_name, total, metodo_pago, status, ncf, ncf_type, visited_at, cash_register_id, salon_id FROM visits WHERE salon_id = 4 OR cash_register_id = 220 ORDER BY id DESC LIMIT 20");
  console.log(visitsSalon4);

  console.log('--- RECENT VISITS TODAY ACROSS ALL SALONS (STATUS != Anulado) ---');
  const [allRecent] = await pool.query("SELECT id, ticket_number, client_id, client_name, total, metodo_pago, status, ncf, ncf_type, visited_at, cash_register_id, salon_id FROM visits WHERE visited_at >= '2026-11-03 00:00:00' ORDER BY id DESC LIMIT 20");
  console.log(allRecent);

  await pool.end();
})();

