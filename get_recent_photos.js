const mysql = require('mysql2/promise');

async function check() {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: '2.24.86.39',
      user: 'salon_admin',
      password: 'SalonPro_2024_Success!',
      database: 'u566429295_salon_v2',
      connectTimeout: 8000
    });

    const [recent] = await conn.query(
      "SELECT id, employee_id, timestamp, type, LENGTH(photo) as photo_len, SUBSTRING(photo, 1, 30) as format FROM attendance WHERE employee_id = '20' AND photo IS NOT NULL AND photo != '' ORDER BY timestamp DESC LIMIT 5"
    );
    console.log('Últimos 5 ponches de Enmelyn:', recent);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (conn) await conn.end();
    process.exit(0);
  }
}

check();
