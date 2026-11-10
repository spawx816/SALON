const http = require('http');

async function get(path) {
  return new Promise((resolve) => {
    http.get(`http://127.0.0.1:5005${path}`, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data: d.substring(0, 100) }));
    }).on('error', e => resolve({ status: 'ERROR', error: e.message }));
  });
}

async function verifyScreenshotsCalls() {
  const branchUuid = '7f546f61-6410-4002-8198-bce72379d9f9';
  console.log('🎯 VERIFICANDO LAS 4 LLAMADAS DEL SCREENSHOT DEL USUARIO:');

  const p1 = await get(`/api/visits/pending?salon_id=${branchUuid}`);
  console.log(`1. /api/visits/pending -> Status: ${p1.status}`);

  const p2 = await get(`/api/cash-registers/active?salon_id=${branchUuid}`);
  console.log(`2. /api/cash-registers/active -> Status: ${p2.status}`);

  const p3 = await get(`/api/services/top?salon_id=${branchUuid}&limit=20`);
  console.log(`3. /api/services/top -> Status: ${p3.status}`);

  process.exit(0);
}

verifyScreenshotsCalls();
