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

  const [anulaciones] = await pool.query(`
    SELECT m.*, cr.register_number, cr.employee_name as caja_emp, cr.salon_id as caja_salon, v.salon_id as visit_salon, v.ticket_number
    FROM cash_register_movements m
    JOIN cash_registers cr ON m.cash_register_id = cr.id
    LEFT JOIN visits v ON m.visit_id = v.id
    WHERE m.type = 'Anulacion_Venta'
    ORDER BY m.created_at DESC
  `);

  console.log('Total Anulacion_Venta in movements:', anulaciones.length);
  console.table(anulaciones.map(a => ({
    id: a.id,
    cash_register_id: a.cash_register_id,
    register_number: a.register_number,
    caja_salon: a.caja_salon,
    visit_salon: a.visit_salon,
    visit_id: a.visit_id,
    amount: a.amount,
    concept: a.concept,
    created_at: a.created_at
  })));

  await pool.end();
})();

