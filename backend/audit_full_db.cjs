const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function auditDatabase() {
  console.log('🔍 [AUDIT] Iniciando auditoría exhaustiva de tablas y rutas...\n');

  // 1. Obtener todas las tablas existentes en PostgreSQL
  const [existingTablesRows] = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name ASC
  `);
  const existingTables = new Set(existingTablesRows.map(r => r.table_name));
  console.log(`📊 Total de tablas en PostgreSQL actualmente: ${existingTables.size}`);
  console.log('Tablas:', Array.from(existingTables).join(', '));
  console.log('\n----------------------------------------\n');

  // 2. Escanear todo backend/routes y extraer todas las tablas mencionadas en queries
  const routesDir = path.join(__dirname, 'routes');
  const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));
  
  const referencedTables = new Set();
  const tableRegexes = [
    /\bFROM\s+([a-zA-Z0-9_]+)/gi,
    /\bJOIN\s+([a-zA-Z0-9_]+)/gi,
    /\bINTO\s+([a-zA-Z0-9_]+)/gi,
    /\bUPDATE\s+([a-zA-Z0-9_]+)/gi,
    /\bTABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/gi
  ];

  // Ignorar palabras reservadas de SQL que puedan coincidir
  const sqlKeywords = new Set([
    'select', 'where', 'set', 'order', 'group', 'limit', 'values', 'inner', 
    'left', 'right', 'outer', 'cross', 'table', 'if', 'exists', 'dual', 'generate_series'
  ]);

  for (const file of files) {
    const content = fs.readFileSync(path.join(routesDir, file), 'utf8');
    for (const regex of tableRegexes) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        const tbl = match[1].toLowerCase();
        if (!sqlKeywords.has(tbl) && isNaN(Number(tbl))) {
          referencedTables.add(tbl);
        }
      }
    }
  }

  // También revisar server.js
  const serverContent = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  for (const regex of tableRegexes) {
    let match;
    while ((match = regex.exec(serverContent)) !== null) {
      const tbl = match[1].toLowerCase();
      if (!sqlKeywords.has(tbl) && isNaN(Number(tbl))) {
        referencedTables.add(tbl);
      }
    }
  }

  console.log(`📋 Total de tablas referenciadas en código backend: ${referencedTables.size}`);
  
  // 3. Comparar tablas referenciadas vs existentes
  const missingTables = [];
  for (const tbl of Array.from(referencedTables).sort()) {
    if (!existingTables.has(tbl)) {
      missingTables.push(tbl);
    }
  }

  if (missingTables.length === 0) {
    console.log('✅ TODAS las tablas referenciadas existen en PostgreSQL!');
  } else {
    console.log(`⚠️ TABLAS FALTANTES EN POSTGRESQL (${missingTables.length}):`);
    missingTables.forEach(t => console.log(`   ❌ ${t}`));
  }

  console.log('\n----------------------------------------\n');

  // 4. Probar queries SELECT de prueba en cada tabla referenciada
  console.log('🧪 Probando SELECT de prueba en cada tabla...');
  for (const tbl of Array.from(existingTables).sort()) {
    try {
      await pool.query(`SELECT 1 FROM "${tbl}" LIMIT 1`);
      console.log(`   ✅ ${tbl}: OK`);
    } catch (e) {
      console.log(`   ❌ ${tbl}: ERROR -> ${e.message}`);
    }
  }

  process.exit(0);
}

auditDatabase().catch(err => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
