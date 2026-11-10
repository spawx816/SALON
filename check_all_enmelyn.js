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

    const [all] = await conn.query("SELECT * FROM staff_records WHERE nombre LIKE '%enmelyn%' OR email LIKE '%enmelyn%'");
    console.log('All staff records matching enmelyn:', all);

    const [allUsers] = await conn.query("SELECT * FROM users WHERE nombre LIKE '%enmelyn%' OR email LIKE '%enmelyn%'");
    console.log('All users matching enmelyn:', allUsers);

    const [tempStaff] = await conn.query("SELECT * FROM staff_records WHERE nombre LIKE '%temporal%' OR email LIKE '%temporal%' OR id = 45");
    console.log('Staff 45 / temporal:', tempStaff);

    const [tempUser] = await conn.query("SELECT * FROM users WHERE id = '1791380713353'");
    console.log('User 1791380713353:', tempUser);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (conn) await conn.end();
    process.exit(0);
  }
}

check();
