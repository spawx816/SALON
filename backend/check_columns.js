require('dotenv').config();
const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  const [s] = await conn.query(
    "SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='staff_records' AND COLUMN_NAME='dias_laborables'",
    [process.env.DB_NAME]
  );
  const [u] = await conn.query(
    "SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='users' AND COLUMN_NAME='dias_laborables'",
    [process.env.DB_NAME]
  );

  console.log('staff_records.dias_laborables:', s[0] ? s[0].COLUMN_TYPE : 'NO EXISTE');
  console.log('users.dias_laborables:', u[0] ? u[0].COLUMN_TYPE : 'NO EXISTE');

  // Also fix users if it's VARCHAR
  if (u[0] && u[0].COLUMN_TYPE.includes('varchar')) {
    await conn.query('ALTER TABLE users MODIFY COLUMN dias_laborables TEXT');
    console.log('users.dias_laborables también cambiada a TEXT');
  }

  await conn.end();
})();
