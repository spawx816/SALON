const path = require('path');
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });

async function testMatch() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'salon_pro'
  });

  const sharedNcf = 'B0199990002';
  await pool.query(`
    INSERT INTO expenses (
      concept_name, payment_date, period, amount, payment_method, salon_id, reference, observation, status, is_loan
    ) VALUES (
      'Mercancías e insumos', '2029-01-14', '2029-01', 7000.00, 'Transferencia', 1, '${sharedNcf}',
      'Pago de factura con NCF ${sharedNcf} a Suplidor Químicos', 'Completado', 0
    )
  `);

  const [rows] = await pool.query(`
    SELECT e.id, e.reference, e.observation, e.payment_date 
    FROM expenses e
    WHERE e.payment_date >= '2029-01-01' AND e.payment_date <= '2029-01-31'
  `);
  console.log('Row from DB:', rows);
  if (rows[0]) {
    const ref = (rows[0].reference || '').trim();
    console.log('ref:', JSON.stringify(ref));
    console.log('sharedNcf:', JSON.stringify(sharedNcf));
    console.log('Equal?:', ref.toUpperCase() === sharedNcf.toUpperCase());
  }

  await pool.query(`DELETE FROM expenses WHERE reference = '${sharedNcf}'`);
  await pool.end();
}
testMatch();

