const fs = require('fs');
const content = fs.readFileSync('backend/services/dgii.service.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('dgii_ncf_sequences') || line.includes('assignDgiiSequence') || line.includes('E34') || line.includes('E31')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});

