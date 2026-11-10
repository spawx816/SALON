const http = require('http');

const BASE_URL = 'http://127.0.0.1:5005';

const endpoints = [
  // System Health
  { method: 'GET', path: '/api/health' },
  { method: 'GET', path: '/api/status' },
  { method: 'GET', path: '/api/ping' },

  // SaaS Master Routes
  { method: 'GET', path: '/api/saas/metrics' },
  { method: 'GET', path: '/api/saas/tenants' },
  { method: 'GET', path: '/api/saas/plans' },
  { method: 'GET', path: '/api/saas/plans?public_only=true' },
  { method: 'GET', path: '/api/tenant/profile' },

  // Security & Users
  { method: 'GET', path: '/api/users' },
  { method: 'GET', path: '/api/roles' },
  { method: 'GET', path: '/api/security/sessions' },
  { method: 'GET', path: '/api/security/audit-logs?limit=5' },
  { method: 'GET', path: '/api/security/login-attempts' },
  { method: 'GET', path: '/api/security/settings' },

  // Core Salon Operations
  { method: 'GET', path: '/api/salons' },
  { method: 'GET', path: '/api/clients' },
  { method: 'GET', path: '/api/cash-registers/active' },
  { method: 'GET', path: '/api/dashboard/stats' },
  { method: 'GET', path: '/api/plans' },
  { method: 'GET', path: '/api/services' },
  { method: 'GET', path: '/api/visits' },
  { method: 'GET', path: '/api/invoices' },
  { method: 'GET', path: '/api/payments' },
  { method: 'GET', path: '/api/commissions' },

  // HR & Payroll & Attendance
  { method: 'GET', path: '/api/employees' },
  { method: 'GET', path: '/api/payroll/active' },
  { method: 'GET', path: '/api/payroll/history' },
  { method: 'GET', path: '/api/attendance/logs' },
  { method: 'GET', path: '/api/holidays' },

  // DGII & Tax Reporting
  { method: 'GET', path: '/api/dgii-sequences' },
  { method: 'GET', path: '/api/credit-notes' },
  { method: 'GET', path: '/api/reports/607' },
  { method: 'GET', path: '/api/dgii/report-606/stats' },
  { method: 'GET', path: '/api/dgii/report-606/records' },

  // Marketing & Contracts & Settings
  { method: 'GET', path: '/api/marketing/promotions' },
  { method: 'GET', path: '/api/contracts' },
  { method: 'GET', path: '/api/settings' },
  { method: 'GET', path: '/api/contact-messages' }
];

async function runAudit() {
  console.log(`\n🔍 INICIANDO AUDITORÍA INTEGRAL DE RUTAS Y ENDPOINTS BACKEND (${BASE_URL})\n` + '='.repeat(70));
  
  let passed = 0;
  let failed = 0;
  const results = [];

  for (const ep of endpoints) {
    try {
      const start = Date.now();
      const res = await fetch(`${BASE_URL}${ep.path}`, {
        method: ep.method,
        headers: {
          'x-tenant-id': 'e05317cb-dde3-412c-af6a-543b31c24a59',
          'x-user-role': 'owner'
        }
      });
      const duration = Date.now() - start;
      const status = res.status;
      
      let bodyPreview = '';
      try {
        const text = await res.text();
        const json = JSON.parse(text);
        bodyPreview = Array.isArray(json) ? `Array(${json.length})` : typeof json === 'object' ? Object.keys(json).slice(0, 3).join(', ') : text.slice(0, 30);
      } catch (e) {
        bodyPreview = 'text/plain';
      }

      if (status >= 200 && status < 400) {
        passed++;
        results.push({ ep: `${ep.method} ${ep.path}`, status, duration: `${duration}ms`, ok: true, preview: bodyPreview });
        console.log(`✅ [${status}] ${ep.method} ${ep.path} (${duration}ms) -> ${bodyPreview}`);
      } else {
        failed++;
        results.push({ ep: `${ep.method} ${ep.path}`, status, duration: `${duration}ms`, ok: false, preview: bodyPreview });
        console.log(`❌ [${status}] ${ep.method} ${ep.path} (${duration}ms)`);
      }
    } catch (err) {
      failed++;
      results.push({ ep: `${ep.method} ${ep.path}`, status: 'ERR', duration: 'N/A', ok: false, preview: err.message });
      console.log(`💥 [ERROR] ${ep.method} ${ep.path} -> ${err.message}`);
    }
  }

  console.log('='.repeat(70));
  console.log(`\n📊 RESUMEN AUDITORÍA: ${passed}/${endpoints.length} pasaron exitosamente. (${failed} fallaron)\n`);
}

runAudit();
