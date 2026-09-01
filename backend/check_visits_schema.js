import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

async function showVisitsSchema() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'salon_db',
    port: process.env.DB_PORT || 3306
  });

  const [cols] = await connection.query("SHOW COLUMNS FROM visits");
  console.log('Visits columns:', cols.map(c => c.Field));

  const [clients] = await connection.query("SELECT id, nombre, email, telefono FROM clients WHERE nombre LIKE '%Elizabeth%' OR nombre LIKE '%Hidalgo%'");
  for (const client of clients) {
    console.log(`\nClient: ${client.nombre} (${client.id})`);
    const [visits] = await connection.query("SELECT * FROM visits WHERE client_id = ?", [client.id]);
    console.log(`Visits found for client_id ${client.id}:`, visits);
  }

  await connection.end();
}

showVisitsSchema().catch(console.error);
