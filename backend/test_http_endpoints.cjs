const http = require('http');

const endpoints = [
  '/api/salons',
  '/api/services',
  '/api/clients',
  '/api/employees',
  '/api/plans',
  '/api/dashboard/summary',
  '/api/security/requests',
  '/api/tenant/profile',
  '/api/settings/email'
];

async function testEndpoint(path) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:5005${path}`, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ path, status: res.statusCode, data: data.substring(0, 100) });
      });
    });
    req.on('error', (err) => {
      resolve({ path, status: 'ERROR', error: err.message });
    });
  });
}

async function runAll() {
  console.log('🌐 Testing all HTTP endpoints...');
  for (const ep of endpoints) {
    const res = await testEndpoint(ep);
    const mark = (res.status === 200 || res.status === 304) ? '✅' : '❌';
    console.log(`${mark} ${ep} -> Status: ${res.status} | Data preview: ${res.data || res.error}`);
  }
  process.exit(0);
}

runAll();
