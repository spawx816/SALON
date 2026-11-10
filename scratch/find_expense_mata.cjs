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

  const [expenses] = await pool.query("SELECT * FROM cash_register_movements WHERE concept LIKE '%producto mata%' OR amount = 2200");
  console.log('Expenses:', expenses);

  if (expenses.length > 0) {
    const crId = expenses[0].cash_register_id;
    const [cr] = await pool.query("SELECT * FROM cash_registers WHERE id = ?", [crId]);
    console.log('Cash register for expense:', cr);

    const [allMoves] = await pool.query("SELECT * FROM cash_register_movements WHERE cash_register_id = ?", [crId]);
    console.log('All movements in this cr:', allMoves);
  }

  await pool.end();
})();

