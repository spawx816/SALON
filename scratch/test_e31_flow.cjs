const path = require('path');
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
const crypto = require('crypto');

async function testSimulate() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  console.log('Testing assignDgiiSequenceToVisit query for E31...');
  const [batches] = await c.query(
    `SELECT * FROM dgii_ncf_sequences 
     WHERE tipo_comprobante = 'E31'
       AND estado = 'Activo'
       AND cantidad_usada < cantidad_aprobada
       AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= CURDATE())
     ORDER BY id ASC
     LIMIT 1 FOR UPDATE`
  );
  console.log('Batches found:', batches);

  await c.end();
}

testSimulate().catch(console.error);

