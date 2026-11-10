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

    console.log('\n--- REGISTROS EN email_logs PARA angelica O RECIENTES ---');
    const [logs] = await conn.query(
      "SELECT * FROM email_logs WHERE recipient_email LIKE '%angelica%' OR recipient_email LIKE '%pereyra%' ORDER BY id DESC LIMIT 10"
    );
    console.log('Logs para angelica:', JSON.stringify(logs, null, 2));

    const [recentLogs] = await conn.query(
      "SELECT * FROM email_logs ORDER BY id DESC LIMIT 15"
    );
    console.log('Últimos 15 email_logs globales:', JSON.stringify(recentLogs, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (conn) await conn.end();
    process.exit(0);
  }
}

check();
