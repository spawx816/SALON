const mysql = require('mysql2/promise');
const path = require('path');
const https = require('https');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function verify() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  const [visits] = await pool.query(`
    SELECT id, ticket_number, client_name, total, ncf, ncf_type, codigo_seguridad_ecf, qr_code_url, status, visited_at 
    FROM visits 
    WHERE ncf IS NOT NULL 
    ORDER BY ncf ASC
  `);

  console.log(`Total Comprobantes registrados en base de datos: ${visits.length}`);
  console.log('------------------------------------------------------------');

  const summary = visits.map(v => ({
    ticket: v.ticket_number || v.id,
    cliente: v.client_name,
    ncf: v.ncf,
    tipo: v.ncf_type,
    monto: `RD$ ${Number(v.total).toFixed(2)}`,
    estado: v.status,
    codigo_seguridad: v.codigo_seguridad_ecf,
    qr_url: v.qr_code_url
  }));

  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

verify().catch(console.error);
