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

    console.log('--- 1. SESIONES ACTIVAS (user_sessions) ---');
    const [sessions] = await conn.query("SELECT * FROM user_sessions WHERE is_active = 1 ORDER BY last_activity DESC");
    console.log(sessions);

    console.log('\n--- 2. ÚLTIMOS LOGIN ATTEMPTS ---');
    const [attempts] = await conn.query("SELECT * FROM login_attempts ORDER BY id DESC LIMIT 15");
    console.log(attempts);

    console.log('\n--- 3. VISITAS REGISTRADAS HOY ---');
    const [visits] = await conn.query("SELECT id, client_name, salon_id, created_at, created_by FROM visits WHERE created_at >= '2026-10-10 00:00:00' ORDER BY id DESC LIMIT 5");
    console.log(visits);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (conn) await conn.end();
    process.exit(0);
  }
}

check();
