const fs = require('fs');

const content = fs.readFileSync('C:\\Users\\spawx\\.gemini\\antigravity-ide\\scratch\\salon\\src\\components\\visits\\VisitRecorder.jsx', 'utf8');
const lines = content.split('\n');

lines.forEach((line, index) => {
  if (line.includes('employees.map') || line.includes('emp.posicion') || line.includes('emp.rol') || (line.includes('filtered') && line.includes('employees'))) {
    console.log(`Line ${index + 1}: ${line.trim()}`);
  }
});
