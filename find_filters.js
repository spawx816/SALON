const fs = require('fs');
const path = require('path');

function searchFiles(dir, pattern) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      if (f !== 'node_modules' && f !== '.git' && f !== 'dist') searchFiles(full, pattern);
    } else if (f.endsWith('.jsx') || f.endsWith('.js')) {
      const content = fs.readFileSync(full, 'utf8');
      const lines = content.split('\n');
      lines.forEach((l, idx) => {
        if (pattern.test(l)) {
          console.log(`${full}:${idx + 1}: ${l.trim().substring(0, 120)}`);
        }
      });
    }
  }
}

searchFiles('C:\\Users\\spawx\\.gemini\\antigravity-ide\\scratch\\salon\\src', /employees\.filter/i);
searchFiles('C:\\Users\\spawx\\.gemini\\antigravity-ide\\scratch\\salon\\src', /staff\.filter/i);
searchFiles('C:\\Users\\spawx\\.gemini\\antigravity-ide\\scratch\\salon\\src', /salon_id.*===/i);
