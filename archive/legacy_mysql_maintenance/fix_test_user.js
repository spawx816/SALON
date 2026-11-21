const mysql = require('mysql2/promise');

async function fixUser() {
  const pool = mysql.createPool({
    host: '82.197.82.137',
    user: 'u566429295_admin',
    password: 'Arrd1227',
    database: 'u566429295_salonpro'
  });

  try {
    console.log('Updating Anderson Ramirez...');
    await pool.query("UPDATE clients SET status = 'Activo', password = 'Arrd1227' WHERE id = '1777645718693'");
    console.log('Update successful!');
  } catch (e) {
    console.error('Update failed:', e);
  } finally {
    await pool.end();
  }
}

fixUser();
