const { pool } = require('../db');

async function listAllTables() {
  const [rows] = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  console.log('Tables in public schema:');
  console.log(rows.map(r => r.table_name).join(', '));
  process.exit(0);
}

listAllTables().catch(console.error);

