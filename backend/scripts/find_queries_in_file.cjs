const fs = require('fs');
const path = require('path');

const targetFile = process.argv[2] || 'backend/routes/cash_registers.routes.js';
const content = fs.readFileSync(path.resolve(targetFile), 'utf8');

const queryRegex = /(?:pool|conn|db|connection)\.query\s*\(\s*([`'"])([\s\S]*?)\1/g;
let match;
let found = 0;
while ((match = queryRegex.exec(content)) !== null) {
  const sql = match[2].trim();
  if (/^(BEGIN|COMMIT|ROLLBACK|SET\s+)/i.test(sql)) continue;
  if (!sql.toLowerCase().includes('tenant_id')) {
    found++;
    console.log(`\n--- QUERY WITHOUT TENANT_ID #${found} ---`);
    console.log(sql);
  }
}

if (found === 0) {
  console.log(`✅ All queries in ${targetFile} include tenant_id!`);
}

