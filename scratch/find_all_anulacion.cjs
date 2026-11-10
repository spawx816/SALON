const fs = require('fs');
const path = require('path');

function searchDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory() && file !== 'node_modules') {
      searchDir(fullPath);
    } else if (file.endsWith('.js') || file.endsWith('.cjs')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('Anulacion_Venta')) {
        console.log('Found Anulacion_Venta in:', fullPath);
      }
    }
  }
}

searchDir(path.join(__dirname, '..', 'backend'));

