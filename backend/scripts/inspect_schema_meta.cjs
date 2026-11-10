const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const db = require('../db.js');
const pool = db.pool || db;

async function inspectSchema() {
  const [tables] = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  console.log('Total base tables in public:', tables.length);
  const names = tables.map(t => t.table_name);
  console.log(names.join(', '));

  // Check which tables have tenant_id column
  const [tenantCols] = await pool.query(`
    SELECT table_name, column_name, is_nullable, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND column_name = 'tenant_id'
    ORDER BY table_name
  `);
  console.log('\nTables WITH tenant_id (' + tenantCols.length + '):');
  console.table(tenantCols);

  // Check FKs on tenant_id
  const [fks] = await pool.query(`
    SELECT
      tc.table_name, 
      kcu.column_name, 
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.delete_rule
    FROM information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints AS rc
      ON rc.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' 
      AND tc.table_schema = 'public'
      AND kcu.column_name = 'tenant_id'
    ORDER BY tc.table_name
  `);
  console.log('\nFKs on tenant_id (' + fks.length + '):');
  console.table(fks);

  process.exit(0);
}

inspectSchema().catch(err => {
  console.error(err);
  process.exit(1);
});

