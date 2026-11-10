const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

async function extractIndependentDDL() {
  console.log('📦 Extrayendo DDL independiente de todas las tablas...');
  const conn = await pool.getConnection();
  try {
    const [tables] = await conn.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    let ddl = `-- INDEPENDENT SCHEMA DDL DEFINITION\n-- Generated for sandbox restoration testing\n\n`;

    // 1. Column definitions per table
    for (const t of tables) {
      const tName = t.table_name;
      const [cols] = await conn.query(`
        SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ?
        ORDER BY ordinal_position;
      `, [tName]);

      const colDefs = cols.map(c => {
        let type = c.data_type;
        const isIntFamily = ['integer', 'bigint', 'smallint'].includes(c.data_type);
        const isSerial = isIntFamily && c.column_default && c.column_default.includes('nextval');

        if (isSerial) {
          type = (c.data_type === 'bigint') ? 'BIGSERIAL' : 'SERIAL';
        } else if (type === 'character varying') {
          type = c.character_maximum_length ? `VARCHAR(${c.character_maximum_length})` : 'VARCHAR(255)';
        } else if (type === 'numeric') {
          type = 'NUMERIC(12, 2)';
        } else if (type === 'timestamp without time zone') {
          type = 'TIMESTAMP';
        } else if (type === 'timestamp with time zone') {
          type = 'TIMESTAMP WITH TIME ZONE';
        }
        let def = `  "${c.column_name}" ${type}`;
        if (!isSerial && c.column_default && !c.column_default.includes('nextval')) {
          def += ` DEFAULT ${c.column_default}`;
        }
        if (c.is_nullable === 'NO' && !isSerial) {
          def += ` NOT NULL`;
        }
        return def;
      });

      ddl += `CREATE TABLE IF NOT EXISTS {{SCHEMA}}."${tName}" (\n${colDefs.join(',\n')}\n);\n\n`;
    }

    // 2. Primary Keys & Unique Constraints
    const [pkUnique] = await conn.query(`
      SELECT tc.table_name, tc.constraint_name, tc.constraint_type, string_agg('"' || kcu.column_name || '"', ', ') as cols
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public' AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
      GROUP BY tc.table_name, tc.constraint_name, tc.constraint_type
      ORDER BY tc.table_name;
    `);

    for (const c of pkUnique) {
      ddl += `ALTER TABLE {{SCHEMA}}."${c.table_name}" ADD CONSTRAINT "${c.constraint_name}" ${c.constraint_type} (${c.cols});\n`;
    }
    ddl += '\n';

    // 3. Foreign Keys
    const [fks] = await conn.query(`
      SELECT 
        tc.table_name, 
        tc.constraint_name, 
        kcu.column_name, 
        ccu.table_name AS ref_table, 
        ccu.column_name AS ref_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.table_schema = 'public' AND tc.constraint_type = 'FOREIGN KEY'
      ORDER BY tc.table_name;
    `);

    for (const f of fks) {
      ddl += `ALTER TABLE {{SCHEMA}}."${f.table_name}" ADD CONSTRAINT "${f.constraint_name}" FOREIGN KEY ("${f.column_name}") REFERENCES {{SCHEMA}}."${f.ref_table}"("${f.ref_column}") ON DELETE CASCADE;\n`;
    }
    ddl += '\n';

    // 4. Standalone Indexes (excluding indexes created automatically by PK/UNIQUE constraints)
    const [indexes] = await conn.query(`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' 
        AND indexname NOT IN (
          SELECT constraint_name 
          FROM information_schema.table_constraints 
          WHERE table_schema = 'public'
        )
      ORDER BY tablename, indexname;
    `);

    for (const idx of indexes) {
      let def = idx.indexdef.replace(' ON public.', ' ON {{SCHEMA}}.');
      ddl += `${def};\n`;
    }

    const outPath = path.join(__dirname, '../backups/independent_schema.sql');
    fs.writeFileSync(outPath, ddl, 'utf8');
    console.log(`✅ DDL independiente generado exitosamente en: ${outPath} (${ddl.length} bytes)`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error extrayendo DDL:', err.message);
    process.exit(1);
  } finally {
    conn.release();
  }
}

extractIndependentDDL();
