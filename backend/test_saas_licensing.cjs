const http = require('http');

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:5005${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch(e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    }).on('error', reject);
  });
}

async function testEndpoints() {
  console.log('🧪 Probando endpoints SaaS...');
  
  const metrics = await get('/api/saas/metrics');
  console.log('📊 Metrics:', metrics.status, metrics.data);

  const allPlans = await get('/api/saas/plans');
  console.log('📋 All Plans Count:', allPlans.status, allPlans.data?.length);

  const publicPlans = await get('/api/saas/plans?public_only=true');
  console.log('🌐 Public Plans Count:', publicPlans.status, publicPlans.data?.length);
  if (publicPlans.data && publicPlans.data.length > 0) {
    console.log('   Primer plan público:', publicPlans.data[0].name, '- Price/branch:', publicPlans.data[0].price_per_branch, '- Users/branch:', publicPlans.data[0].users_per_branch);
  }

  const tenants = await get('/api/saas/tenants');
  console.log('🏢 Tenants Count:', tenants.status, tenants.data?.length);
  if (tenants.data && tenants.data.length > 0) {
    const t = tenants.data[0];
    console.log('   Tenant 0:', t.business_name, '- Plan:', t.plan_name, '- Lic Branches:', t.licensed_branches, '- Max Users:', t.max_allowed_users, '- Has Memberships:', t.has_memberships);
  }

  const profile = await get('/api/tenant/profile');
  console.log('👤 Tenant Profile:', profile.status, profile.data?.business_name, '- Plan:', profile.data?.plan_name, '- Max Users:', profile.data?.max_allowed_users);
}

testEndpoints().catch(console.error);
