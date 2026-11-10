const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

async function generateMatrix() {
  const [cols] = await pool.query(`
    SELECT table_name, column_name, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id'
    ORDER BY table_name;
  `);

  const [fks] = await pool.query(`
    SELECT tc.table_name, tc.constraint_name, ccu.table_name as ref_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND kcu.column_name = 'tenant_id'
      AND ccu.table_name = 'tenants';
  `);

  const [indexes] = await pool.query(`
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexdef LIKE '%tenant_id%';
  `);

  const [allTables] = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);

  const fkMap = new Map();
  fks.forEach(f => fkMap.set(f.table_name, f.constraint_name));

  const idxMap = new Map();
  indexes.forEach(i => idxMap.set(i.tablename, i.indexname));

  const colMap = new Map();
  cols.forEach(c => colMap.set(c.table_name, c));

  console.log('| Tabla | tenant_id | Tipo | Nullable | B-Tree Index | Restricción FK | Estado / Nota |');
  console.log('|---|---|---|---|---|---|---|');

  const matrix = [];
  for (const t of allTables) {
    const tName = t.table_name;
    const col = colMap.get(tName);
    const hasIdx = idxMap.has(tName);
    const fk = fkMap.get(tName);

    if (['tenants', 'saas_plans', 'schema_migrations', 'pending_tenant_reconciliations', 'login_attempts', 'blocked_ips', 'account_lockouts', 'contact_messages', 'billing_codes'].includes(tName)) {
      matrix.push({
        table: tName,
        tenant_id: 'N/A',
        type: 'N/A',
        nullable: 'N/A',
        index: 'N/A',
        fk: 'N/A',
        note: 'Tabla Global / Plataforma (Exenta de tenant_id)'
      });
      console.log(`| \`${tName}\` | N/A | N/A | N/A | N/A | N/A | Tabla Global / Plataforma |`);
    } else {
      const isNull = col ? col.is_nullable : 'NO_COL';
      const type = col ? col.data_type : 'MISSING';
      const idxName = hasIdx ? idxMap.get(tName) : 'MISSING';
      const fkName = fk || 'MISSING';
      const status = (col && hasIdx && fk) ? '✅ 100% Blindado' : '⚠️ Pendiente';

      matrix.push({
        table: tName,
        tenant_id: col ? 'SÍ' : 'NO',
        type,
        nullable: isNull,
        index: idxName,
        fk: fkName,
        note: status
      });
      console.log(`| \`${tName}\` | SÍ | \`${type}\` | ${isNull} | \`${idxName}\` | \`${fkName}\` | ${status} |`);
    }
  }

  const outPath = path.join(__dirname, 'multitenant_matrix.json');
  fs.writeFileSync(outPath, JSON.stringify(matrix, null, 2));
  console.log(`\nMatriz exportada a: ${outPath}`);
  process.exit(0);
}

generateMatrix().catch(err => {
  console.error(err);
  process.exit(1);
});

