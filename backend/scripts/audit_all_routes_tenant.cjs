const fs = require('fs');
const path = require('path');

const routesDir = path.resolve(__dirname, '../routes');
const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.routes.js'));

console.log('AUDITANDO RUTAS PARA VERIFICAR TENANT_ID OBLIGATORIO:');
console.log('===================================================\n');

let issuesFound = 0;

for (const file of files) {
  const fullPath = path.join(routesDir, file);
  const content = fs.readFileSync(fullPath, 'utf8');

  // Si el archivo es public o test, verificar cómo se maneja
  if (file === 'public.routes.js' || file === 'test.routes.js' || file === 'contact.routes.js') {
    continue;
  }

  // Buscar consultas SQL crudas en pool.query o conn.query
  const queryRegex = /(?:pool|conn|db)\.query\s*\(\s*[`'"]([\s\S]*?)[`'"]/g;
  let match;
  const queries = [];
  while ((match = queryRegex.exec(content)) !== null) {
    const rawSql = match[1].trim();
    // Excluir BEGIN, COMMIT, ROLLBACK, SET LOCAL
    if (/^(BEGIN|COMMIT|ROLLBACK|SET\s+)/i.test(rawSql)) continue;
    queries.push({
      sql: rawSql.replace(/\s+/g, ' ').substring(0, 100),
      hasTenant: /tenant_id/i.test(rawSql) || /req\.tenantId/i.test(match[0])
    });
  }

  const missingTenant = queries.filter(q => !q.hasTenant);
  if (missingTenant.length > 0) {
    console.log(`❌ ${file}: ${missingTenant.length} consultas sin tenant_id explícito`);
    missingTenant.slice(0, 5).forEach(m => console.log(`   - SQL: ${m.sql}...`));
    issuesFound += missingTenant.length;
  } else {
    console.log(`✅ ${file}: Todas las consultas (${queries.length}) contienen tenant_id`);
  }
}

console.log(`\nTotal consultas sospechosas sin tenant_id: ${issuesFound}`);

