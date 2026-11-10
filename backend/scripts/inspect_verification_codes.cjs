const { pool } = require('../db');

async function inspect() {
  const [rows] = await pool.query(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'verification_codes' ORDER BY ordinal_position"
  );
  console.table(rows);
  process.exit(0);
}

inspect().catch(err => { console.error(err); process.exit(1); });

