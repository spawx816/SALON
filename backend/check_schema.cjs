const { pool } = require('./db');

async function checkSchema() {
  try {
    const [tables] = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    for (const t of tables) {
      const [cols] = await pool.query(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ? ORDER BY ordinal_position",
        [t.table_name]
      );
      console.log(`\n=== Table: ${t.table_name} ===`);
      console.log(cols.map(c => `${c.column_name}: ${c.data_type}`).join('\n'));
    }
  } catch (err) {
    console.error('Schema check error:', err);
  } finally {
    process.exit(0);
  }
}

checkSchema();
