const path = require('path');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function testCreateDb() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    waitForConnections: true,
    connectionLimit: 1
  });
  try {
    await pool.query('CREATE DATABASE IF NOT EXISTS u566429295_salon_test');
    console.log('CREATE DATABASE ALLOWED!');
    await pool.query('DROP DATABASE IF EXISTS u566429295_salon_test');
  } catch (e) {
    console.log('CREATE DATABASE NOT ALLOWED:', e.message);
  } finally {
    await pool.end();
  }
}
testCreateDb();

