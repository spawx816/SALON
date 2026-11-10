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

    console.log('--- 1. BUSCAR EN staff_records (Enmelyn / temporal) ---');
    const [staff] = await conn.query(
      "SELECT id, nombre, cedula, contacto, posicion, email, salon_id, status FROM staff_records WHERE nombre LIKE '%enmelyn%' OR email LIKE '%enmelyn%' OR nombre LIKE '%temporal%' OR email LIKE '%temporal%'"
    );
    console.log('Staff records encontrados:', JSON.stringify(staff, null, 2));

    console.log('\n--- 2. TODOS LOS STAFF RECORDS ---');
    const [allStaff] = await conn.query(
      "SELECT id, nombre, posicion, email, salon_id, status FROM staff_records ORDER BY id DESC LIMIT 20"
    );
    console.log('Últimos staff records:', JSON.stringify(allStaff, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (conn) await conn.end();
    process.exit(0);
  }
}

check();
