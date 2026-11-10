const path = require('path');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function testTemporaryTables() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 1
  });
  const conn = await pool.getConnection();
  try {
    console.log('Testing TEMPORARY table on MySQL 2.24.86.39...');
    await conn.query(`
      CREATE TEMPORARY TABLE test_expense_concepts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        description VARCHAR(255) DEFAULT NULL,
        is_system TINYINT(1) DEFAULT 0,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_concept_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await conn.query(`
      INSERT INTO test_expense_concepts (name, description, is_system) VALUES
      ('TSS', 'Tesorería de la Seguridad Social', 1),
      ('INFOTEP', 'Instituto Nacional', 1)
    `);
    const [rows] = await conn.query('SELECT * FROM test_expense_concepts');
    console.log('Successfully created and queried temporary table! Rows:', rows.length);
  } catch (err) {
    console.error('Error with temporary table:', err.message);
  } finally {
    conn.release();
    await pool.end();
  }
}
testTemporaryTables();

