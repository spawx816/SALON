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

    console.log('--- USUARIOS COINCIDENTES CON ENMELYN / TEMPORAL ---');
    const [users] = await conn.query(
      "SELECT id, nombre, email, role_id, salon_id, is_active, status, cedula, telefono FROM users WHERE nombre LIKE '%enmelyn%' OR email LIKE '%enmelyn%' OR nombre LIKE '%emelyn%' OR nombre LIKE '%temporal%' OR email LIKE '%temporal%'"
    );
    console.log(users);

    console.log('\n--- TODOS LOS ROLES EN users ---');
    const [roles] = await conn.query("SELECT * FROM roles");
    console.log(roles);

    console.log('\n--- ÚLTIMOS 10 USUARIOS CREADOS ---');
    const [recent] = await conn.query("SELECT id, nombre, email, role_id, salon_id, is_active, status, created_at FROM users ORDER BY id DESC LIMIT 10");
    console.log(recent);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (conn) await conn.end();
    process.exit(0);
  }
}

check();
