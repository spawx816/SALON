const assert = require('assert');
const fs = require('fs');
const content = fs.readFileSync('src/components/bi/biConfig.js', 'utf8');

assert.ok(content.includes("'Productividad y rentabilidad'"), 'Debe contener la categoría Productividad y rentabilidad');
assert.ok(content.includes("id: 'cash_flow'"), 'Debe contener el reporte cash_flow');
assert.ok(content.includes("name: 'Flujo de efectivo'"), 'Debe tener el nombre Flujo de efectivo');
console.log('✅ Configuración BI validada correctamente');

