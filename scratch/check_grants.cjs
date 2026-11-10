const path = require('path');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function checkGrants() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 1
  });
  try {
    const [grants] = await pool.query('SHOW GRANTS');
    console.log('Grants:', grants);
    const [dbs] = await pool.query('SHOW DATABASES');
    console.log('Databases available:', dbs.map(d => Object.values(d)[0]));
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
}
checkGrants();

