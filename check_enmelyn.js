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

    const [uCols] = await conn.query("SHOW COLUMNS FROM users");
    console.log('Columnas de users:', uCols.map(c => c.Field));

    const [eCols] = await conn.query("SHOW COLUMNS FROM employees");
    console.log('Columnas de employees:', eCols.map(c => c.Field));

    console.log('\n--- 1. BUSCAR EN USERS ---');
    const [users] = await conn.query(
      "SELECT * FROM users WHERE nombre LIKE '%enmelyn%' OR email LIKE '%enmelyn%' OR nombre LIKE '%emelyn%' OR nombre LIKE '%temporal%'"
    );
    console.log('Usuarios coincidentes:', JSON.stringify(users, null, 2));

    console.log('\n--- 2. ÚLTIMOS 10 USUARIOS ---');
    const [allUsers] = await conn.query("SELECT * FROM users ORDER BY id DESC LIMIT 10");
    console.log('Últimos 10 usuarios:', JSON.stringify(allUsers, null, 2));

    console.log('\n--- 3. BUSCAR EN EMPLOYEES ---');
    const [employees] = await conn.query(
      "SELECT * FROM employees WHERE nombre LIKE '%enmelyn%' OR nombre LIKE '%emelyn%' OR nombre LIKE '%temporal%' OR email LIKE '%enmelyn%' OR email LIKE '%temporal%'"
    );
    console.log('Empleados coincidentes:', JSON.stringify(employees, null, 2));

    console.log('\n--- 4. ÚLTIMOS 10 EMPLEADOS ---');
    const [allEmps] = await conn.query("SELECT * FROM employees ORDER BY id DESC LIMIT 10");
    console.log('Últimos 10 empleados:', JSON.stringify(allEmps, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (conn) await conn.end();
    process.exit(0);
  }
}

check();
