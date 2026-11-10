const { pool } = require('./db');

async function check() {
  try {
    console.log('--- COMPROBANDO EN salon_saas_db (POSTGRES) ---');
    const [users] = await pool.query("SELECT * FROM users WHERE nombre ILIKE '%enmelyn%' OR email ILIKE '%enmelyn%'");
    console.log('Users in postgres:', users);

    const [staff] = await pool.query("SELECT * FROM staff_records WHERE nombre ILIKE '%enmelyn%' OR email ILIKE '%enmelyn%'");
    console.log('Staff in postgres:', staff);

  } catch (e) {
    console.log('Error postgres:', e.message);
  } finally {
    process.exit(0);
  }
}

check();
