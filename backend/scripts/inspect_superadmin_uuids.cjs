const { pool } = require('../db');

async function check() {
  const [rows] = await pool.query(
    "SELECT id, email, username, role, is_active FROM users WHERE email IN ('superadmin@salonsaas.com', 'superadmin@salonpro.io')"
  );
  console.table(rows);
  process.exit(0);
}

check().catch(err => { console.error(err); process.exit(1); });

