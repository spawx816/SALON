const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: '82.197.82.137',
    user: 'u566429295_admin',
    password: 'Arrd1227',
    database: 'u566429295_salonpro'
  });

  try {
    await pool.query('ALTER TABLE clients ADD COLUMN status VARCHAR(20) DEFAULT "Pendiente"');
    console.log('Database updated: status column added to clients.');
  } catch (err) {
    console.error('Error updating database:', err.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
})();
