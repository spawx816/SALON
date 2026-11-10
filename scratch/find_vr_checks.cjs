const fs = require('fs');
const content = fs.readFileSync('src/components/visits/VisitRecorder.jsx', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('isExhausted') || line.includes('sequenceAvailability') || line.includes('blockedSequence') || line.includes('isCreditoFiscal')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});

