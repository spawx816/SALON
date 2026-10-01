const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function migrate() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  const columns = [
    { name: 'ncf', def: 'VARCHAR(30) NULL' },
    { name: 'ncf_type', def: 'VARCHAR(10) NULL' },
    { name: 'ncf_name', def: 'VARCHAR(150) NULL' },
    { name: 'rnc_cliente', def: 'VARCHAR(20) NULL' },
    { name: 'rzn_soc_cliente', def: 'VARCHAR(255) NULL' },
    { name: 'codigo_seguridad_ecf', def: 'VARCHAR(10) NULL' },
    { name: 'qr_code_url', def: 'TEXT NULL' }
  ];

  const [existingCols] = await conn.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [process.env.DB_NAME, 'visits']
  );
  const existingNames = new Set(existingCols.map(c => c.COLUMN_NAME));

  for (const c of columns) {
    if (!existingNames.has(c.name)) {
      console.log(`Adding column: ${c.name}`);
      await conn.query(`ALTER TABLE visits ADD COLUMN ${c.name} ${c.def}`);
    }
  }

  const [resCols] = await conn.query('DESCRIBE visits');
  console.log('✅ Visits columns updated:', resCols.map(c => c.Field));
  await conn.end();
}

migrate().catch(console.error);
