const fs = require('fs');
const content = fs.readFileSync('backend/routes/dgii.routes.js', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('createDgiiRouter') || line.includes('function evaluateBatchFiscalStatus') || line.includes('function diagnoseSequenceFailure')) {
    console.log((idx + 1) + ': ' + line.trim());
  }
});

