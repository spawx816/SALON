const fs = require('fs');
const path = require('path');

const routesDir = path.resolve(__dirname, '../routes');
const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.routes.js'));

let totalMissing = 0;

// Tables that are intrinsically global / platform-level (do not have a tenant_id column)
const globalTables = [
  'tenants',
  'saas_plans',
  'login_attempts',
  'blocked_ips',
  'account_lockouts',
  'schema_migrations',
  'pending_tenant_reconciliations',
  'billing_codes'
];

console.log('EXACT SCAN FOR QUERIES MISSING TENANT_ID:');
console.log('========================================\n');

for (const file of files) {
  if (['public.routes.js', 'test.routes.js', 'contact.routes.js', 'saas.routes.js'].includes(file)) {
    console.log(`ℹ️ ${file}: Exento (módulo público/gateway/SuperAdmin global)`);
    continue;
  }

  const fullPath = path.join(routesDir, file);
  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split('\n');

  const queryRegex = /(?:pool|conn|db|connection)\.query\s*\(\s*([`'"])([\s\S]*?)\1/g;
  let match;
  const missing = [];

  while ((match = queryRegex.exec(content)) !== null) {
    const sql = match[2].trim();
    if (/^(BEGIN|COMMIT|ROLLBACK|SET\s+|CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+INDEX)/i.test(sql)) continue;
    
    // Check if the query is strictly against a global table
    const lowerSql = sql.toLowerCase();
    const isOnlyGlobal = globalTables.some(gt => lowerSql.includes(gt)) && 
      !['visits', 'invoices', 'clients', 'attendance', 'payroll', 'cash_', 'contracts', 'payments', 'services', 'staff_records', 'schedule_overrides', 'security_requests'].some(tt => lowerSql.includes(tt));

    // Pixel tracking exemption
    const isPixelTracking = lowerSql.includes('update email_logs set opened = 1');

    if (!lowerSql.includes('tenant_id') && !isOnlyGlobal && !isPixelTracking) {
      const pos = match.index;
      let lineNum = 1;
      let charCount = 0;
      for (let i = 0; i < lines.length; i++) {
        charCount += lines[i].length + 1;
        if (charCount > pos) {
          lineNum = i + 1;
          break;
        }
      }
      missing.push({ line: lineNum, sql: sql.replace(/\s+/g, ' ').substring(0, 120) });
    }
  }

  if (missing.length > 0) {
    console.log(`❌ ${file} (${missing.length} missing):`);
    missing.forEach(m => console.log(`   L${m.line}: ${m.sql}`));
    totalMissing += missing.length;
  } else {
    console.log(`✅ ${file}: 100% scoped`);
  }
}

console.log(`\n========================================`);
console.log(`TOTAL REAL QUERIES MISSING TENANT_ID: ${totalMissing}`);
console.log(`========================================`);

if (require.main === module) {
  process.exit(totalMissing > 0 ? 1 : 0);
}
