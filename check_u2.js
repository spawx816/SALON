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

    const [users] = await conn.query(
      "SELECT id, nombre, email, role_id, salon_id, tipo, role, created_at FROM users WHERE nombre LIKE '%enmelyn%' OR email LIKE '%enmelyn%' OR nombre LIKE '%emelyn%' OR nombre LIKE '%temporal%' OR email LIKE '%temporal%'"
    );
    console.log('USUARIOS ENCONTRADOS:', JSON.stringify(users, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (conn) await conn.end();
    process.exit(0);
  }
}

check();
