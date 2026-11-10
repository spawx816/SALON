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

    const [att] = await conn.query("SELECT * FROM attendance WHERE employee_id = '20' OR employee_id = 'EMP-20' ORDER BY id DESC LIMIT 10");
    console.log('Asistencia:', att);

    const [cajas] = await conn.query("SELECT id, salon_id, opened_by, status, opening_date FROM cash_registers ORDER BY id DESC LIMIT 10");
    console.log('Cajas registradoras:', cajas);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (conn) await conn.end();
    process.exit(0);
  }
}

check();
