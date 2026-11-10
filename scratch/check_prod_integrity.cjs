const path = require('path');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function checkProductionIntegrity() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 1
  });
  try {
    const [tables] = await pool.query("SHOW TABLES LIKE 'expense%'");
    console.log('Tables matching expense% in production:', tables.length);
    for (const row of tables) {
      const tableName = Object.values(row)[0];
      const [countRes] = await pool.query(`SELECT COUNT(*) as c FROM ${tableName}`);
      console.log(`- ${tableName}: ${countRes[0].c} records`);
    }
    const [testTables] = await pool.query("SHOW TABLES LIKE '_test%'");
    console.log('Tables matching _test% in production:', testTables.length);
  } finally {
    await pool.end();
  }
}
checkProductionIntegrity();

