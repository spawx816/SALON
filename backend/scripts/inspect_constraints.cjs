const { pool } = require('../db');

async function main() {
  const [fks] = await pool.query(`
    SELECT
      tc.table_name, 
      kcu.column_name, 
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      tc.constraint_name
    FROM 
      information_schema.table_constraints AS tc 
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    ORDER BY tc.table_name;
  `);
  console.log('Total Foreign Keys in public schema:', fks.length);
  const tenantFks = fks.filter(f => f.column_name === 'tenant_id');
  console.log('FKs referencing tenants on tenant_id (' + tenantFks.length + '):');
  tenantFks.forEach(f => console.log('  ', f.table_name, '->', f.foreign_table_name, '(' + f.constraint_name + ')'));

  // Also check which tables with tenant_id DO NOT have an FK on tenant_id
  const [cols] = await pool.query(`
    SELECT table_name, is_nullable
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND column_name = 'tenant_id'
    ORDER BY table_name
  `);
  const fkTableSet = new Set(tenantFks.map(f => f.table_name));
  const missingFk = cols.filter(c => !fkTableSet.has(c.table_name));
  console.log('\nTables with tenant_id but NO FK on tenant_id (' + missingFk.length + '):');
  missingFk.forEach(c => console.log('  ', c.table_name, '(nullable:', c.is_nullable, ')'));

  // Also check indices on tenant_id
  const [indexes] = await pool.query(`
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexdef LIKE '%tenant_id%'
    ORDER BY tablename
  `);
  console.log('\nTotal indexes on tenant_id:', indexes.length);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

