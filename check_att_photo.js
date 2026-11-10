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

    const [cols] = await conn.query("SHOW COLUMNS FROM attendance");
    console.log('Columnas de attendance:', cols.map(c => c.Field));

    const [records] = await conn.query(
      "SELECT id, employee_id, date, time, photo, image, snapshot FROM attendance WHERE employee_id = '20' OR employee_id = 'EMP-20' LIMIT 1"
    ).catch(async () => {
      return await conn.query("SELECT * FROM attendance WHERE employee_id = '20' OR employee_id = 'EMP-20' LIMIT 1");
    });
    console.log('Registro muestra attendance:', Object.keys(records[0][0] || {}));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (conn) await conn.end();
    process.exit(0);
  }
}

check();
