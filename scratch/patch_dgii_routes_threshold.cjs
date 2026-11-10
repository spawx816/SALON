const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '..', 'backend', 'routes', 'dgii.routes.js');
let content = fs.readFileSync(targetPath, 'utf8');

// 1. Update alertaMinima fallback
const oldAlerta1 = 'const alertaMinima = Number(seq.alerta_minima || 5);';
const newAlerta1 = 'const alertaMinima = Number(seq.alerta_minima !== undefined && seq.alerta_minima !== null ? seq.alerta_minima : 2);';
if (!content.includes(oldAlerta1)) {
  console.error('Target 1 not found!');
  process.exit(1);
}
content = content.replace(oldAlerta1, newAlerta1);

// 2. Update threshold logic in getSequenceAvailability
const oldThresholdRegex = /} else if \(disp <= 5\) {[\s\S]*?} else if \(disp <= 20\) {[\s\S]*?alertMsg = `ℹ️ Aviso: Quedan \${disp} secuencias autorizadas de \${tipo}\.`;[\s\S]*?}/;
const newThreshold = `} else if (disp <= 2) {
        level = 'critical_2';
        alertMsg = \`🚨 Alerta: Quedan solo \${disp} comprobante(s) restante(s) de \${tipo}. Bloqueo inminente al llegar a cero.\`;
      }`;

if (!oldThresholdRegex.test(content)) {
  console.error('Target 2 not found!');
  process.exit(1);
}
content = content.replace(oldThresholdRegex, newThreshold);

// 3. Update parseInt(alerta_minima) || 5
const oldAlerta3 = 'parseInt(alerta_minima) || 5';
const newAlerta3 = 'parseInt(alerta_minima) || 2';
if (!content.includes(oldAlerta3)) {
  console.error('Target 3 not found!');
  process.exit(1);
}
content = content.replace(oldAlerta3, newAlerta3);

fs.writeFileSync(targetPath, content, 'utf8');
console.log('✅ Successfully updated backend/routes/dgii.routes.js');

