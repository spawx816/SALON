const fs = require('fs');
const content = fs.readFileSync('backend/routes/cash_registers.routes.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('Anulacion_Venta')) {
    console.log((idx + 1) + ': ' + line.trim());
  }
});

