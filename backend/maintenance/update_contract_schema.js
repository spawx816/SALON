const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: '82.197.82.137',
    user: 'u566429295_admin',
    password: 'Arrd1227',
    database: 'u566429295_salonpro'
  });

  try {
    await pool.query('ALTER TABLE clients ADD COLUMN nacionalidad VARCHAR(100) DEFAULT "Dominicana" AFTER nombre');
    await pool.query('ALTER TABLE clients ADD COLUMN estado_civil VARCHAR(50) DEFAULT "Soltera" AFTER nacionalidad');
    await pool.query('ALTER TABLE plans ADD COLUMN activation_fee DECIMAL(10,2) DEFAULT 0.00 AFTER price');
    console.log('Database updated successfully.');
  } catch (err) {
    if (err.code === 'ER_DUP_COLUMN') {
      console.log('Columns already exist.');
    } else {
      console.error('Error updating database:', err.message);
    }
  } finally {
    await pool.end();
    process.exit(0);
  }
})();
