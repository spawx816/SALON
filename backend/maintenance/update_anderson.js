const mysql = require('mysql2/promise');
async function run() {
  const pool = mysql.createPool({
    host: '82.197.82.137',
    user: 'u566429295_admin',
    password: 'Arrd1227',
    database: 'u566429295_salonpro'
  });
  await pool.query('UPDATE clients SET password = "Abatte123", must_change_password = 1 WHERE email = "noxus1412@gmail.com"');
  console.log('✅ Password updated for Anderson to: Abatte123');
  await pool.end();
}
run();
