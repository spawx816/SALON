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

    console.log('--- ROLES EXISTENTES ---');
    const [roles] = await conn.query("SELECT * FROM roles");
    console.table(roles);

    console.log('\n--- USUARIO ACTUAL ENMELYN ---');
    const [user] = await conn.query("SELECT * FROM users WHERE nombre LIKE '%enmelyn%' OR email LIKE '%enmelyn%'");
    console.log(user);

    console.log('\n--- STAFF RECORD ACTUAL ENMELYN ---');
    const [staff] = await conn.query("SELECT * FROM staff_records WHERE id = 20");
    console.log(staff);

    console.log('\n--- OTROS USUARIOS ENCARGADA (para comparar role_id) ---');
    const [encargadas] = await conn.query("SELECT u.id, u.nombre, u.email, u.role_id, u.salon_id, r.nombre as role_name FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.nombre LIKE '%antia%' OR u.nombre LIKE '%alba%' OR u.nombre LIKE '%loraly%'");
    console.table(encargadas);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (conn) await conn.end();
    process.exit(0);
  }
}

check();
