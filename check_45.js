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

    console.log('--- VERIFICANDO SI ID 45 TIENE MOVIMIENTOS ---');
    const [att] = await conn.query("SELECT * FROM attendance WHERE employee_id = '45'");
    console.log('Attendance:', att.length);

    const [visits] = await conn.query("SELECT id FROM visits WHERE CAST(servicios AS CHAR) LIKE '%temporal%'");
    console.log('Visits:', visits.length);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (conn) await conn.end();
    process.exit(0);
  }
}

check();
