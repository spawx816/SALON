const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function fix() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  await pool.query("UPDATE dgii_ncf_sequences SET numero_hasta = 'E310000100000', cantidad_aprobada = 100000 WHERE tipo_comprobante = 'E31'");
  await pool.query("UPDATE dgii_ncf_sequences SET numero_hasta = 'E320000100000', cantidad_aprobada = 100000 WHERE tipo_comprobante = 'E32'");
  await pool.query("UPDATE dgii_ncf_sequences SET numero_hasta = 'E340000100000', cantidad_aprobada = 100000 WHERE tipo_comprobante = 'E34'");

  const [rows] = await pool.query('SELECT id, tipo_comprobante, numero_desde, numero_hasta, cantidad_aprobada, cantidad_usada FROM dgii_ncf_sequences');
  console.log('UPDATED SEQUENCES IN DB:', rows);
  process.exit(0);
}

fix().catch(err => {
  console.error(err);
  process.exit(1);
});
