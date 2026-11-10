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

    const [sCols] = await conn.query("SHOW COLUMNS FROM staff_records LIKE 'profile_photo'");
    console.log('staff_records profile_photo type:', sCols);

    const [uCols] = await conn.query("SHOW COLUMNS FROM users LIKE 'profile_photo'");
    console.log('users profile_photo type:', uCols);

    // Let's see other employees with profile_photo
    const [others] = await conn.query("SELECT id, nombre, SUBSTRING(profile_photo, 1, 40) as photo_sample FROM staff_records WHERE profile_photo IS NOT NULL AND profile_photo != ''");
    console.log('Otros empleados con foto:', others);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (conn) await conn.end();
    process.exit(0);
  }
}

check();
