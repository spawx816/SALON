const path = require('path');
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });

async function cleanAll() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'salon_pro'
  });

  await pool.query("DELETE FROM dgii_606_purchases WHERE periodo = '202901' OR ncf LIKE 'B019999%'");
  await pool.query("DELETE FROM expenses WHERE period = '2029-01' OR reference LIKE 'B019999%' OR reference LIKE 'SYNTH_CF_%' OR observation LIKE '%SYNTH_CF_%'");
  await pool.query("DELETE FROM visits WHERE id LIKE 'SYNTH_CF_%'");
  await pool.query("DELETE FROM payments WHERE id LIKE 'SYNTH_CF_%' OR description LIKE '%SYNTH_CF_%'");

  const [exp] = await pool.query("SELECT id, reference, payment_date, amount FROM expenses");
  console.log('Remaining expenses in DB:', exp);

  const [pur] = await pool.query("SELECT id, ncf, fecha_pago, total_facturado FROM dgii_606_purchases");
  console.log('Remaining 606 purchases in DB:', pur);

  await pool.end();
}
cleanAll();

