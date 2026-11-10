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

    const [positions] = await conn.query("SELECT * FROM staff_positions");
    console.log('Posiciones / Cargos (staff_positions):', positions);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (conn) await conn.end();
    process.exit(0);
  }
}

check();
