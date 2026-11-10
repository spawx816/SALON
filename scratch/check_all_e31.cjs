const path = require('path');
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function checkE31NCFs() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  const [rows] = await c.query("SELECT id, ticket_number, client_name, ncf, ncf_type, visited_at, status FROM visits WHERE ncf LIKE 'E31%' ORDER BY ncf ASC");
  console.log(`Found ${rows.length} visits with E31:`);
  console.dir(rows, { depth: null });

  // Also check if visits.ncf has a UNIQUE INDEX!
  const [indexes] = await c.query("SHOW INDEX FROM visits WHERE Column_name = 'ncf'");
  console.log('\nIndexes on visits.ncf:');
  console.dir(indexes, { depth: null });

  await c.end();
}

checkE31NCFs().catch(console.error);

