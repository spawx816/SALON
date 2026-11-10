const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'backend', 'routes', 'dgii.routes.js');
let raw = fs.readFileSync(filePath, 'utf8');
const isCrlf = raw.includes('\r\n');
let content = raw.replace(/\r\n/g, '\n');

// 1. Extract the functions evaluateBatchFiscalStatus and diagnoseSequenceFailure
const evalFnStart = '/**\n * Unifies evaluation of DGII sequence batch availability and status across Administration,';
const evalFnEnd = '// GET /api/dgii/sequences/availability - Real-time e-NCF sequence availability and threshold alerts';

const startIdx = content.indexOf(evalFnStart);
const endIdx = content.indexOf(evalFnEnd);

if (startIdx === -1 || endIdx === -1) {
  console.error('Could not find functions in content!');
  process.exit(1);
}

const functionsCode = content.slice(startIdx, endIdx);

// Remove them from inside createDgiiRouter
content = content.slice(0, startIdx) + content.slice(endIdx);

// Place them before function createDgiiRouter
const targetPlace = 'function createDgiiRouter(pool, helpers = {}) {';
content = content.replace(targetPlace, functionsCode + '\n' + targetPlace);

if (isCrlf) {
  content = content.replace(/\n/g, '\r\n');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully moved evaluateBatchFiscalStatus and diagnoseSequenceFailure to module level.');

