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

    await conn.query("UPDATE schedule_overrides SET reason = 'Día laborable trasladado del 2026-10-19 - Excepcion' WHERE id = 35");
    const [row35] = await conn.query("SELECT * FROM schedule_overrides WHERE id = 35");
    console.log('--- UPDATED ROW 35 ---', row35);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (conn) await conn.end();
    process.exit(0);
  }
}

check();
