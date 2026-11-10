/**
 * PHASE 2H-C: MULTI-TENANT CUSTOMIZABLE BRANDING & ISOLATION TEST SUITE
 * 
 * Verifies:
 * 1. Default fallback to neutral 'SalonPro' branding when unconfigured.
 * 2. Strict tenant isolation (Tenant A red vs Tenant B blue).
 * 3. Anti-spoofing (x-tenant-id, query param, body payload).
 * 4. SuperAdmin Control Plane isolation (forbidden from ordinary tenant branding).
 * 5. Hex color format validation.
 * 6. WCAG AA contrast ratio validation.
 * 7. Anti-XSS and dangerous URL rejection.
 * 8. RBAC: Only owner/admin can modify branding.
 * 9. Immediate cache invalidation upon update.
 * 10. Public safe endpoint (/api/public/branding/:slug).
 * 11. Global Abatte elimination verification.
 */

'use strict';

const assert = require('assert');
const { createInMemoryTestApp } = require('./helpers/create_in_memory_test_app.cjs');

async function runTestSuite() {
  console.log('\n=== STARTING SUITE: PHASE 2H-C TENANT BRANDING & ISOLATION ===\n');
  let passed = 0;
  let total = 0;

  const runTest = async (name, fn) => {
    total++;
    try {
      await fn();
      console.log(`  [PASS] Test ${total}: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] Test ${total}: ${name}`);
      console.error(`         Reason: ${err.message}`);
      throw err;
    }
  };

  const testApp = await createInMemoryTestApp();

  try {
    // 1. Setup users and tenants
    const superAdmin = await testApp.createTenantWithUser({
      role: 'superadmin',
      email: 'superadmin.branding@salonpro.test',
      username: 'superadmin_branding'
    });

    const tenantAOwner = await testApp.createTenantWithUser({
      role: 'propietario',
      email: 'owner@salon-carmesi.test',
      username: 'owner_carmesi',
      plan: 'BASE'
    });

    const tenantAStaff = await testApp.createTenantWithUser({
      role: 'cajero',
      email: 'cajero@salon-carmesi.test',
      username: 'cajero_carmesi',
      tenantId: tenantAOwner.tenantId,
      branchId: tenantAOwner.branchId,
      plan: 'BASE'
    });

    const tenantBOwner = await testApp.createTenantWithUser({
      role: 'propietario',
      email: 'owner@salon-zafiro.test',
      username: 'owner_zafiro',
      plan: 'PRO'
    });

    // -------------------------------------------------------------------------
    // TEST 1: Default fallback to SalonPro
    // -------------------------------------------------------------------------
    await runTest('Tenant unconfigured receives neutral SalonPro default branding', async () => {
      const res = await testApp.request({
        method: 'GET',
        path: '/api/tenant/branding',
        headers: tenantAOwner.headers
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.business_name, 'SalonPro');
      assert.strictEqual(res.body.primary_color, '#0f172a');
      assert.strictEqual(res.body.is_default, true);
      assert.ok(!JSON.stringify(res.body).toLowerCase().includes('abatte'));
    });

    // -------------------------------------------------------------------------
    // TEST 2: Tenant A sets custom red branding
    // -------------------------------------------------------------------------
    await runTest('Tenant A saves custom red branding successfully', async () => {
      const res = await testApp.request({
        method: 'PUT',
        path: '/api/tenant/branding',
        headers: tenantAOwner.headers,
        body: {
          business_name: 'Salón Carmesí',
          primary_color: '#dc2626',
          secondary_color: '#f87171',
          accent_color: '#ef4444',
          background_color: '#ffffff',
          surface_color: '#fef2f2',
          text_color: '#1f2937',
          receipt_header: 'Salón Carmesí - Tu Belleza Única',
          receipt_footer: '¡Gracias por visitarnos en Carmesí!'
        }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.branding.business_name, 'Salón Carmesí');
      assert.strictEqual(res.body.branding.primary_color, '#dc2626');
      assert.strictEqual(res.body.branding.is_default, false);
    });

    // -------------------------------------------------------------------------
    // TEST 3: Tenant B sets custom blue branding
    // -------------------------------------------------------------------------
    await runTest('Tenant B saves custom blue branding successfully', async () => {
      const res = await testApp.request({
        method: 'PUT',
        path: '/api/tenant/branding',
        headers: tenantBOwner.headers,
        body: {
          business_name: 'Salón Zafiro Azul',
          primary_color: '#1d4ed8',
          secondary_color: '#60a5fa',
          accent_color: '#2563eb',
          background_color: '#ffffff',
          surface_color: '#eff6ff',
          text_color: '#0f172a',
          receipt_header: 'Salón Zafiro - Belleza y Estilo',
          receipt_footer: '¡Zafiro te agradece tu preferencia!'
        }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.branding.business_name, 'Salón Zafiro Azul');
      assert.strictEqual(res.body.branding.primary_color, '#1d4ed8');
    });

    // -------------------------------------------------------------------------
    // TEST 4: Strict Tenant Isolation
    // -------------------------------------------------------------------------
    await runTest('Tenant A sees strictly red branding; Tenant B sees strictly blue branding', async () => {
      const resA = await testApp.request({
        method: 'GET',
        path: '/api/tenant/branding',
        headers: tenantAOwner.headers
      });
      const resB = await testApp.request({
        method: 'GET',
        path: '/api/tenant/branding',
        headers: tenantBOwner.headers
      });

      assert.strictEqual(resA.body.business_name, 'Salón Carmesí');
      assert.strictEqual(resA.body.primary_color, '#dc2626');

      assert.strictEqual(resB.body.business_name, 'Salón Zafiro Azul');
      assert.strictEqual(resB.body.primary_color, '#1d4ed8');

      // Cross-tenant data verification
      assert.ok(!JSON.stringify(resA.body).includes('Zafiro'));
      assert.ok(!JSON.stringify(resB.body).includes('Carmesí'));
    });

    // -------------------------------------------------------------------------
    // TEST 5: Anti-Spoofing & Anti-IDOR
    // -------------------------------------------------------------------------
    await runTest('Tenant A cannot alter or read Tenant B branding using x-tenant-id or query params (CROSS_TENANT_ACCESS_DENIED)', async () => {
      // Read spoofing attempt
      const readSpoof = await testApp.request({
        method: 'GET',
        path: `/api/tenant/branding?tenant_id=${tenantBOwner.tenantId}`,
        headers: {
          ...tenantAOwner.headers,
          'x-tenant-id': tenantBOwner.tenantId
        }
      });
      assert.strictEqual(readSpoof.status, 403);
      assert.strictEqual(readSpoof.body.code, 'CROSS_TENANT_ACCESS_DENIED');

      // Write spoofing attempt
      const writeSpoof = await testApp.request({
        method: 'PUT',
        path: `/api/tenant/branding`,
        headers: {
          ...tenantAOwner.headers,
          'x-tenant-id': tenantBOwner.tenantId
        },
        body: {
          tenant_id: tenantBOwner.tenantId,
          business_name: 'Hackeado por Tenant A'
        }
      });
      assert.strictEqual(writeSpoof.status, 403);
      assert.strictEqual(writeSpoof.body.code, 'CROSS_TENANT_ACCESS_DENIED');

      // Verify Tenant B remains completely untouched
      const resB = await testApp.request({
        method: 'GET',
        path: '/api/tenant/branding',
        headers: tenantBOwner.headers
      });
      assert.strictEqual(resB.body.business_name, 'Salón Zafiro Azul');
    });

    // -------------------------------------------------------------------------
    // TEST 6: SuperAdmin Control Plane Isolation
    // -------------------------------------------------------------------------
    await runTest('SuperAdmin is strictly blocked from ordinary tenant branding endpoint', async () => {
      const res = await testApp.request({
        method: 'GET',
        path: '/api/tenant/branding',
        headers: superAdmin.headers
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.code, 'CONTROL_PLANE_ROLE_FORBIDDEN');
    });

    // -------------------------------------------------------------------------
    // TEST 7: Hex color validation
    // -------------------------------------------------------------------------
    await runTest('Invalid hex color format is rejected with 400 Bad Request', async () => {
      const res = await testApp.request({
        method: 'PUT',
        path: '/api/tenant/branding',
        headers: tenantAOwner.headers,
        body: {
          primary_color: 'rgb(255, 0, 0)'
        }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.code, 'INVALID_BRANDING_PAYLOAD');
      assert.ok(res.body.error.includes('Color inválido'));
    });

    // -------------------------------------------------------------------------
    // TEST 8: WCAG Contrast validation
    // -------------------------------------------------------------------------
    await runTest('Unreadable contrast (white on white) is rejected with 400 Bad Request', async () => {
      const res = await testApp.request({
        method: 'PUT',
        path: '/api/tenant/branding',
        headers: tenantAOwner.headers,
        body: {
          background_color: '#ffffff',
          surface_color: '#ffffff',
          text_color: '#ffffff'
        }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.code, 'INVALID_BRANDING_PAYLOAD');
      assert.ok(res.body.error.includes('Contraste insuficiente'));
    });

    // -------------------------------------------------------------------------
    // TEST 9: Anti-XSS and Dangerous URLs
    // -------------------------------------------------------------------------
    await runTest('HTML/Scripts and dangerous protocols are sanitized or rejected', async () => {
      // 9.1 Dangerous javascript: scheme
      const resDangerUrl = await testApp.request({
        method: 'PUT',
        path: '/api/tenant/branding',
        headers: tenantAOwner.headers,
        body: {
          logo_url: 'javascript:alert(1)'
        }
      });
      assert.strictEqual(resDangerUrl.status, 400);

      // 9.2 HTML tags in receipt header stripped
      const resSanitize = await testApp.request({
        method: 'PUT',
        path: '/api/tenant/branding',
        headers: tenantAOwner.headers,
        body: {
          business_name: '<b>Salón Seguro</b><script>alert("xss")</script>',
          receipt_header: '<img src=x onerror=alert(1)>Encabezado Limpio'
        }
      });
      assert.strictEqual(resSanitize.status, 200);
      assert.strictEqual(resSanitize.body.branding.business_name, 'Salón Seguro');
      assert.strictEqual(resSanitize.body.branding.receipt_header, 'Encabezado Limpio');
    });

    // -------------------------------------------------------------------------
    // TEST 10: RBAC: Low-privilege role cannot update branding
    // -------------------------------------------------------------------------
    await runTest('Cashier or receptionist cannot update branding (403 Forbidden)', async () => {
      const res = await testApp.request({
        method: 'PUT',
        path: '/api/tenant/branding',
        headers: tenantAStaff.headers,
        body: {
          business_name: 'Intento de Cambio No Autorizado'
        }
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.code, 'FORBIDDEN_ROLE');
    });

    // -------------------------------------------------------------------------
    // TEST 11: Immediate cache invalidation & reset to defaults
    // -------------------------------------------------------------------------
    await runTest('Branding reset returns neutral SalonPro and invalidates cache', async () => {
      const resReset = await testApp.request({
        method: 'POST',
        path: '/api/tenant/branding/reset',
        headers: tenantAOwner.headers
      });
      assert.strictEqual(resReset.status, 200);
      assert.strictEqual(resReset.body.branding.business_name, 'SalonPro');
      assert.strictEqual(resReset.body.branding.is_default, true);

      // Subsequent GET confirms cache was invalidated and defaults are served
      const resGet = await testApp.request({
        method: 'GET',
        path: '/api/tenant/branding',
        headers: tenantAOwner.headers
      });
      assert.strictEqual(resGet.body.business_name, 'SalonPro');
      assert.strictEqual(resGet.body.is_default, true);
    });

    // -------------------------------------------------------------------------
    // TEST 12: Public safe visual branding endpoint
    // -------------------------------------------------------------------------
    await runTest('Public safe endpoint returns only visual fields and zero PII or internal IDs', async () => {
      const resPublic = await testApp.request({
        method: 'GET',
        path: `/api/public/branding/${tenantBOwner.tenantId}`
      });
      assert.strictEqual(resPublic.status, 200);
      assert.strictEqual(resPublic.body.business_name, 'Salón Zafiro Azul');
      assert.strictEqual(resPublic.body.primary_color, '#1d4ed8');

      // Verify ZERO internal IDs or timestamps or PII
      assert.strictEqual(resPublic.body.id, undefined);
      assert.strictEqual(resPublic.body.tenant_id, undefined);
      assert.strictEqual(resPublic.body.updated_at, undefined);
      assert.strictEqual(resPublic.body.updated_by, undefined);
    });

    console.log(`\n======================================================`);
    console.log(`PHASE 2H-C BRANDING TEST SUMMARY: ${passed}/${total} PASSED`);
    console.log(`======================================================\n`);

  } finally {
    await testApp.close();
  }
}

runTestSuite().catch(err => {
  console.error('\nFATAL TEST FAILURE:', err);
  process.exit(1);
});
