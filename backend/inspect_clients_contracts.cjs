const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

async function inspectClients() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  const [cols] = await conn.query('DESCRIBE clients');
  console.log('Columnas de clients:', cols.map(c => `${c.Field} (${c.Type})`));

  const [clientsSample] = await conn.query('SELECT id, nombre, email, status, created_at FROM clients LIMIT 20');
  console.table(clientsSample);

  // Let's test the cross between clients and contracts
  const [activeContracts] = await conn.query(`SELECT DISTINCT client_id, status FROM contracts WHERE status IN ('Active', 'Activo')`);
  console.log(`Contratos activos: ${activeContracts.length}`);
  console.log('Primeros 10 client_id en contratos activos:', activeContracts.slice(0, 10));

  // Check how many clients with email match contracts
  const [matching] = await conn.query(`
    SELECT c.id, c.nombre, c.email, ct.status as contract_status
    FROM clients c
    INNER JOIN contracts ct ON c.id = ct.client_id
    WHERE c.email IS NOT NULL AND c.email != ''
  `);
  console.log(`\nClientes con email QUE TIENEN contrato: ${matching.length}`);
  console.table(matching.slice(0, 10));

  const [withoutContract] = await conn.query(`
    SELECT c.id, c.nombre, c.email
    FROM clients c
    LEFT JOIN contracts ct ON c.id = ct.client_id AND ct.status IN ('Active', 'Activo')
    WHERE c.email IS NOT NULL AND c.email != '' AND ct.id IS NULL
  `);
  console.log(`\nClientes con email QUE NO TIENEN contrato activo: ${withoutContract.length}`);
  console.table(withoutContract.slice(0, 10));

  await conn.end();
}

inspectClients();
