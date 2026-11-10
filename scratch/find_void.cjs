const fs = require('fs');
const content = fs.readFileSync('backend/routes/visits.routes.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('Anulacion_Venta') || line.includes('/:id/void') || line.includes('/void')) {
    console.log((idx + 1) + ': ' + line.trim());
  }
});

