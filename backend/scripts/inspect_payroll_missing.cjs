const fs = require('fs');
const content = fs.readFileSync('./backend/routes/payroll.routes.js', 'utf8');
const lines = content.split('\n');
const queryRegex = /(?:pool|conn|db|connection)\.query\s*\(\s*([`'"])([\s\S]*?)\1/g;
let match;
while ((match = queryRegex.exec(content)) !== null) {
  const sql = match[2].trim();
  if (/^(BEGIN|COMMIT|ROLLBACK|SET\s+|CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+INDEX)/i.test(sql)) continue;
  if (!sql.toLowerCase().includes('tenant_id')) {
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
    console.log(`L${lineNum}: ${sql.replace(/\s+/g, ' ').substring(0, 100)}`);
  }
}

