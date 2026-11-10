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

    console.log('--- ASISTENCIA DE ENMELYN ---');
    const [att] = await conn.query("SELECT * FROM attendance WHERE employee_id = 20 OR employee_id = '20' OR employee_name LIKE '%enmelyn%' ORDER BY id DESC LIMIT 10");
    console.log(att);

    console.log('\n--- CAJAS ABIERTAS POR ENMELYN ---');
    const [cajas] = await conn.query("SELECT * FROM cash_registers WHERE opened_by_id = '1789509958232' OR opened_by LIKE '%enmelyn%' ORDER BY id DESC LIMIT 5");
    console.log(cajas);

    console.log('\n--- SUCURSAL DE LAS CAJAS EN LAS QUE ENMELYN TRABAJA ---');
    if (cajas.length > 0) {
      console.log('Caja salon_id:', cajas.map(c => ({ id: c.id, salon_id: c.salon_id, status: c.status })));
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (conn) await conn.end();
    process.exit(0);
  }
}

check();
