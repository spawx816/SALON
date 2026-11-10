const http = require('http');

const endpoints = [
  '/api/staff-positions',
  '/api/payments',
  '/api/commissions/categories',
  '/api/marketing/settings',
  '/api/marketing/stats',
  '/api/users',
  '/api/roles',
  '/api/security/login-attempts',
  '/api/security/audit-logs?limit=100',
  '/api/security/settings',
  '/api/security/sessions',
  '/api/dashboard/summary',
  '/api/dashboard/visits-by-location'
];

async function checkEndpoint(path) {
  return new Promise((resolve) => {
    http.get(`http://localhost:5005${path}`, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({ path, status: res.statusCode, body });
      });
    }).on('error', (err) => {
      resolve({ path, status: 'ERROR', error: err.message });
    });
  });
}

async function run() {
  console.log('--- TESTING 13 FAILING ROUTES ---');
  for (const ep of endpoints) {
    const res = await checkEndpoint(ep);
    console.log(`[${res.status}] ${ep} -> ${res.body ? res.body.substring(0, 150) : res.error}`);
  }
}

run();
