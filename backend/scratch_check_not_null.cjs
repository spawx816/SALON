const { pool } = require('./db');

async function checkNotNull() {
  const [cols] = await pool.query(`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND is_nullable = 'NO' 
      AND column_name IN ('tenant_id', 'branch_id', 'name')
    ORDER BY table_name;
  `);
  console.log('NOT NULL columns:', cols);
  process.exit(0);
}

checkNotNull();
