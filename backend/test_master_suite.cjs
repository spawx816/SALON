const http = require('http');

const allEndpoints = [
  { method: 'GET', path: '/api/staff-positions' },
  { method: 'GET', path: '/api/payments' },
  { method: 'GET', path: '/api/commissions/categories' },
  { method: 'GET', path: '/api/commissions/rules' },
  { method: 'GET', path: '/api/commissions/payouts' },
  { method: 'GET', path: '/api/marketing/settings' },
  { method: 'GET', path: '/api/marketing/stats' },
  { method: 'GET', path: '/api/users' },
  { method: 'GET', path: '/api/roles' },
  { method: 'GET', path: '/api/security/login-attempts' },
  { method: 'GET', path: '/api/security/audit-logs?limit=100' },
  { method: 'GET', path: '/api/security/settings' },
  { method: 'GET', path: '/api/security/sessions' },
  { method: 'GET', path: '/api/dashboard/summary' },
  { method: 'GET', path: '/api/dashboard/visits-by-location' },
  { method: 'GET', path: '/api/holidays' },
  { method: 'GET', path: '/api/payroll/periods' },
  { method: 'GET', path: '/api/contracts/settings/contract' },
  { method: 'GET', path: '/api/dgii-606?periodo=202610' },
  { method: 'GET', path: '/api/visits/pending?salon_id=1' },
  { method: 'GET', path: '/api/cash-registers/active?salon_id=1' },
  { method: 'GET', path: '/api/services' },
  { method: 'GET', path: '/api/clients' },
  { method: 'GET', path: '/api/salons' },
  { method: 'GET', path: '/api/employees' },
  { method: 'GET', path: '/api/tenant/profile' }
];

async function testEndpoint(ep) {
  return new Promise((resolve) => {
    http.get(`http://localhost:5005${ep.path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          path: ep.path,
          status: res.statusCode,
          preview: data.substring(0, 80)
        });
      });
    }).on('error', (err) => {
      resolve({ path: ep.path, status: 'CONN_ERR', error: err.message });
    });
  });
}

async function runTestSuite() {
  console.log('🧪 [SUITE] Iniciando validación completa de 26 endpoints del sistema...\n');
  let passed = 0;
  let failed = 0;

  for (const ep of allEndpoints) {
    const res = await testEndpoint(ep);
    if (res.status === 200) {
      console.log(`✅ [200 OK] ${res.path}`);
      passed++;
    } else {
      console.log(`❌ [${res.status}] ${res.path} -> ${res.preview || res.error}`);
      failed++;
    }
  }

  console.log(`\n📊 RESULTADOS: ${passed} exitosos, ${failed} fallidos de ${allEndpoints.length} totales.`);
  process.exit(failed > 0 ? 1 : 0);
}

runTestSuite();
