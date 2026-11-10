const { pool } = require('../db');

async function check() {
  const tables = ['clients', 'contracts', 'expenses', 'gastos', 'operating_expenses', 'tenants'];
  for (const t of tables) {
    const [cols] = await pool.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ? ORDER BY ordinal_position",
      [t]
    );
    console.log(`=== TABLE ${t} (${cols.length} cols) ===`);
    console.log(cols.map(c => `${c.column_name} (${c.data_type})`).join(', '));
  }
  process.exit(0);
}

check().catch(err => {
  console.error(err);
  process.exit(1);
});

