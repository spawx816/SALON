const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: '82.197.82.137',
    user: 'u566429295_admin',
    password: 'Arrd1227',
    database: 'u566429295_salonpro'
  });

  try {
    // Delete the duplicate that is stuck in Pendiente
    await pool.query('DELETE FROM clients WHERE email = "neveb29175@iapapi.com" AND status = "Pendiente"');
    console.log('Cleaned up duplicate client.');
    
    // Also set any Activo client with that email to be the only one
    await pool.query('UPDATE clients SET status = "Activo" WHERE email = "neveb29175@iapapi.com"');
    console.log('Ensured client is active.');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
})();
