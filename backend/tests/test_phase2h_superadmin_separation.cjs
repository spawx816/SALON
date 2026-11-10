/**
 * Test: Phase 2H-C SuperAdmin Control Plane vs Tenant Plane Separation Suite
 * 
 * Verifies strict boundary separation:
 * 1. SuperAdmin has access to Control Plane routes (/api/saas/*) -> 200 OK
 * 2. SuperAdmin is strictly forbidden from Tenant Plane operational routes -> 403 CONTROL_PLANE_ROLE_FORBIDDEN
 * 3. Anti-Spoofing: SuperAdmin passing x-tenant-id is still rejected with 403 CONTROL_PLANE_ROLE_FORBIDDEN
 * 4. Tenant roles (owner, admin, etc.) can access tenant routes but are blocked from Control Plane routes
 */

const assert = require('assert');
const { createInMemoryTestApp } = require('./helpers/create_in_memory_test_app.cjs');

console.log('=== STARTING SUITE: PHASE 2H-C SUPERADMIN CONTROL PLANE SEPARATION ===\n');

function pass(name) {
  console.log(`  [PASS] ${name}`);
}

async function runSuite() {
  const testApp = await createInMemoryTestApp();

  try {
    // Setup users
    const superAdmin = await testApp.createTenantWithUser({
      role: 'superadmin',
      email: 'superadmin.global@salonpro.test',
      username: 'superadmin_global'
    });

    const tenantOwner = await testApp.createTenantWithUser({
      role: 'propietario',
      email: 'owner@salon-central.test',
      username: 'owner_central',
      plan: 'PRO'
    });

    const tenantAdmin = await testApp.createTenantWithUser({
      role: 'admin',
      email: 'admin@salon-central.test',
      username: 'admin_central',
      tenantId: tenantOwner.tenantId,
      branchId: tenantOwner.branchId,
      plan: 'PRO'
    });

    console.log('--- SECCIÓN 1: CONTROL PLANE - ACCESO PERMITIDO A SUPERADMIN ---');

    // 1.1 Métricas globales
    const resMetrics = await testApp.request({
      method: 'GET',
      path: '/api/saas/metrics',
      headers: superAdmin.headers
    });
    assert.strictEqual(resMetrics.status, 200, 'SuperAdmin debe acceder a métricas globales');
    pass('Flow 1.1: SuperAdmin accede exitosamente a métricas globales de la plataforma (200 OK)');

    // 1.2 Directorio de salones (tenants)
    const resTenants = await testApp.request({
      method: 'GET',
      path: '/api/saas/tenants',
      headers: superAdmin.headers
    });
    assert.strictEqual(resTenants.status, 200, 'SuperAdmin debe listar salones de la plataforma');
    pass('Flow 1.2: SuperAdmin accede exitosamente al directorio global de salones (200 OK)');

    // 1.3 Suscripciones SaaS de la plataforma
    const resSubs = await testApp.request({
      method: 'GET',
      path: '/api/saas/subscriptions',
      headers: superAdmin.headers
    });
    assert.strictEqual(resSubs.status, 200, 'SuperAdmin debe acceder a suscripciones de la plataforma');
    pass('Flow 1.3: SuperAdmin accede exitosamente a las suscripciones SaaS de la plataforma (200 OK)');

    // 1.4 Facturas de suscripción SaaS de SalonPro a salones
    const resInvoices = await testApp.request({
      method: 'GET',
      path: '/api/saas/invoices',
      headers: superAdmin.headers
    });
    assert.strictEqual(resInvoices.status, 200, 'SuperAdmin debe consultar facturas de la plataforma');
    pass('Flow 1.4: SuperAdmin accede exitosamente a las facturas SaaS de la plataforma (200 OK)');


    console.log('\n--- SECCIÓN 2: TENANT PLANE - SUPERADMIN BLOQUEADO EN RUTAS OPERATIVAS ---');

    // 2.1 POS y Visitas del salón
    const resVisits = await testApp.request({
      method: 'GET',
      path: '/api/visits',
      headers: superAdmin.headers
    });
    assert.strictEqual(resVisits.status, 403, 'SuperAdmin debe ser bloqueado en POS / visitas');
    assert.strictEqual(resVisits.body.code, 'CONTROL_PLANE_ROLE_FORBIDDEN');
    pass('Flow 2.1: SuperAdmin bloqueado de POS y visitas del salón (403 CONTROL_PLANE_ROLE_FORBIDDEN)');

    // 2.2 Facturación histórica del salón
    const resSalonInvoices = await testApp.request({
      method: 'GET',
      path: '/api/invoices',
      headers: superAdmin.headers
    });
    assert.strictEqual(resSalonInvoices.status, 403, 'SuperAdmin debe ser bloqueado en facturas del salón');
    assert.strictEqual(resSalonInvoices.body.code, 'CONTROL_PLANE_ROLE_FORBIDDEN');
    pass('Flow 2.2: SuperAdmin bloqueado de facturación interna del salón (403 CONTROL_PLANE_ROLE_FORBIDDEN)');

    // 2.3 Caja registradora y arqueos del salón
    const resCash = await testApp.request({
      method: 'GET',
      path: '/api/cash-registers',
      headers: superAdmin.headers
    });
    assert.strictEqual(resCash.status, 403, 'SuperAdmin debe ser bloqueado en cajas registradoras');
    assert.strictEqual(resCash.body.code, 'CONTROL_PLANE_ROLE_FORBIDDEN');
    pass('Flow 2.3: SuperAdmin bloqueado de cajas y arqueos del salón (403 CONTROL_PLANE_ROLE_FORBIDDEN)');

    // 2.4 Directorio CRM de clientas del salón
    const resClients = await testApp.request({
      method: 'GET',
      path: '/api/clients',
      headers: superAdmin.headers
    });
    assert.strictEqual(resClients.status, 403, 'SuperAdmin debe ser bloqueado en directorio de clientas');
    assert.strictEqual(resClients.body.code, 'CONTROL_PLANE_ROLE_FORBIDDEN');
    pass('Flow 2.4: SuperAdmin bloqueado de datos y fichas de clientas (403 CONTROL_PLANE_ROLE_FORBIDDEN)');

    // 2.5 Inventario y productos del salón
    const resInventory = await testApp.request({
      method: 'GET',
      path: '/api/inventory/products',
      headers: superAdmin.headers
    });
    assert.strictEqual(resInventory.status, 403, 'SuperAdmin debe ser bloqueado en catálogo de inventario');
    assert.strictEqual(resInventory.body.code, 'CONTROL_PLANE_ROLE_FORBIDDEN');
    pass('Flow 2.5: SuperAdmin bloqueado de inventario de productos del salón (403 CONTROL_PLANE_ROLE_FORBIDDEN)');

    // 2.6 Ajustes de inventario del salón
    const resAdjustment = await testApp.request({
      method: 'POST',
      path: '/api/inventory/adjustments',
      headers: superAdmin.headers,
      body: { productId: 'prod_1', quantity: 5, adjustmentType: 'ADJUSTMENT_IN' }
    });
    assert.strictEqual(resAdjustment.status, 403, 'SuperAdmin debe ser bloqueado en ajustes de inventario');
    assert.strictEqual(resAdjustment.body.code, 'CONTROL_PLANE_ROLE_FORBIDDEN');
    pass('Flow 2.6: SuperAdmin bloqueado de ejecutar ajustes de stock del salón (403 CONTROL_PLANE_ROLE_FORBIDDEN)');

    // 2.7 Sucursales y empleados del salón
    const resSalons = await testApp.request({
      method: 'GET',
      path: '/api/salons',
      headers: superAdmin.headers
    });
    assert.strictEqual(resSalons.status, 403, 'SuperAdmin debe ser bloqueado en configuración de sucursales del salón');
    assert.strictEqual(resSalons.body.code, 'CONTROL_PLANE_ROLE_FORBIDDEN');
    pass('Flow 2.7: SuperAdmin bloqueado de sucursales y personal del salón (403 CONTROL_PLANE_ROLE_FORBIDDEN)');

    // 2.8 Nómina y salarios del salón
    const resPayroll = await testApp.request({
      method: 'GET',
      path: '/api/payroll',
      headers: superAdmin.headers
    });
    assert.strictEqual(resPayroll.status, 403, 'SuperAdmin debe ser bloqueado en nómina del salón');
    assert.strictEqual(resPayroll.body.code, 'CONTROL_PLANE_ROLE_FORBIDDEN');
    pass('Flow 2.8: SuperAdmin bloqueado de nómina y salarios del personal (403 CONTROL_PLANE_ROLE_FORBIDDEN)');

    // 2.9 Registros de asistencia y biometría del salón
    const resAttendance = await testApp.request({
      method: 'GET',
      path: '/api/attendance',
      headers: superAdmin.headers
    });
    assert.strictEqual(resAttendance.status, 403, 'SuperAdmin debe ser bloqueado en asistencia del personal');
    assert.strictEqual(resAttendance.body.code, 'CONTROL_PLANE_ROLE_FORBIDDEN');
    pass('Flow 2.9: SuperAdmin bloqueado de registros de asistencia del personal (403 CONTROL_PLANE_ROLE_FORBIDDEN)');

    // 2.10 Comisiones por servicio del salón
    const resCommissions = await testApp.request({
      method: 'GET',
      path: '/api/commissions',
      headers: superAdmin.headers
    });
    assert.strictEqual(resCommissions.status, 403, 'SuperAdmin debe ser bloqueado en comisiones del salón');
    assert.strictEqual(resCommissions.body.code, 'CONTROL_PLANE_ROLE_FORBIDDEN');
    pass('Flow 2.10: SuperAdmin bloqueado de comisiones de empleadas del salón (403 CONTROL_PLANE_ROLE_FORBIDDEN)');

    // 2.11 Gastos y egresos operativos del salón
    const resExpenses = await testApp.request({
      method: 'GET',
      path: '/api/expenses',
      headers: superAdmin.headers
    });
    assert.strictEqual(resExpenses.status, 403, 'SuperAdmin debe ser bloqueado en egresos del salón');
    assert.strictEqual(resExpenses.body.code, 'CONTROL_PLANE_ROLE_FORBIDDEN');
    pass('Flow 2.11: SuperAdmin bloqueado de egresos operativos del salón (403 CONTROL_PLANE_ROLE_FORBIDDEN)');

    // 2.12 Reportes privados del salón
    const resReports = await testApp.request({
      method: 'GET',
      path: '/api/reports',
      headers: superAdmin.headers
    });
    assert.strictEqual(resReports.status, 403, 'SuperAdmin debe ser bloqueado en reportes del salón');
    assert.strictEqual(resReports.body.code, 'CONTROL_PLANE_ROLE_FORBIDDEN');
    pass('Flow 2.12: SuperAdmin bloqueado de reportes privados del salón (403 CONTROL_PLANE_ROLE_FORBIDDEN)');

    // 2.13 DGII fiscal y comprobantes del salón
    const resDgii = await testApp.request({
      method: 'GET',
      path: '/api/dgii',
      headers: superAdmin.headers
    });
    assert.strictEqual(resDgii.status, 403, 'SuperAdmin debe ser bloqueado en DGII del salón');
    assert.strictEqual(resDgii.body.code, 'CONTROL_PLANE_ROLE_FORBIDDEN');
    pass('Flow 2.13: SuperAdmin bloqueado de operaciones fiscales DGII del salón (403 CONTROL_PLANE_ROLE_FORBIDDEN)');

    // 2.14 Contratos y firmas digitales del salón
    const resContracts = await testApp.request({
      method: 'GET',
      path: '/api/contracts',
      headers: superAdmin.headers
    });
    assert.strictEqual(resContracts.status, 403, 'SuperAdmin debe ser bloqueado en contratos del salón');
    assert.strictEqual(resContracts.body.code, 'CONTROL_PLANE_ROLE_FORBIDDEN');
    pass('Flow 2.14: SuperAdmin bloqueado de contratos y firmas del salón (403 CONTROL_PLANE_ROLE_FORBIDDEN)');

    // 2.15 Membresías B2C del salón
    const resPlans = await testApp.request({
      method: 'GET',
      path: '/api/plans',
      headers: superAdmin.headers
    });
    assert.strictEqual(resPlans.status, 403, 'SuperAdmin debe ser bloqueado en membresías B2C del salón');
    assert.strictEqual(resPlans.body.code, 'CONTROL_PLANE_ROLE_FORBIDDEN');
    pass('Flow 2.15: SuperAdmin bloqueado de catálogo de membresías B2C del salón (403 CONTROL_PLANE_ROLE_FORBIDDEN)');

    // 2.16 Archivos privados tenant-owned
    const resFiles = await testApp.request({
      method: 'GET',
      path: '/api/tenant/files/logo.png',
      headers: superAdmin.headers
    });
    assert.strictEqual(resFiles.status, 403, 'SuperAdmin debe ser bloqueado en descarga de archivos del salón');
    assert.strictEqual(resFiles.body.code, 'CONTROL_PLANE_ROLE_FORBIDDEN');
    pass('Flow 2.16: SuperAdmin bloqueado de descarga de archivos privados del salón (403 CONTROL_PLANE_ROLE_FORBIDDEN)');

    // 2.17 Verificación de PIN ordinaria del salón
    const resPinVerify = await testApp.request({
      method: 'POST',
      path: '/api/security/verify-pin',
      headers: superAdmin.headers,
      body: { pin: '8492' }
    });
    assert.strictEqual(resPinVerify.status, 403, 'SuperAdmin no puede verificar PIN de operaciones del salón');
    assert.strictEqual(resPinVerify.body.code, 'CONTROL_PLANE_ROLE_FORBIDDEN');
    pass('Flow 2.17: SuperAdmin bloqueado de verificar PIN del salón (403 CONTROL_PLANE_ROLE_FORBIDDEN)');

    // 2.18 Establecimiento ordinario de PIN del salón
    const resPinSet = await testApp.request({
      method: 'POST',
      path: '/api/security/set-pin',
      headers: superAdmin.headers,
      body: { pin: '8492' }
    });
    assert.strictEqual(resPinSet.status, 403, 'SuperAdmin no puede configurar PIN ordinario del salón');
    assert.strictEqual(resPinSet.body.code, 'CONTROL_PLANE_ROLE_FORBIDDEN');
    pass('Flow 2.18: SuperAdmin bloqueado de configurar PIN ordinario del salón (403 CONTROL_PLANE_ROLE_FORBIDDEN)');


    console.log('\n--- SECCIÓN 3: ANTI-SPOOFING Y ANTI-IDOR PARA SUPERADMIN ---');

    // 3.1 SuperAdmin enviando x-tenant-id hacia POS / visitas
    const resSpoofVisits = await testApp.request({
      method: 'GET',
      path: '/api/visits',
      headers: {
        ...superAdmin.headers,
        'x-tenant-id': tenantOwner.tenantId
      }
    });
    assert.strictEqual(resSpoofVisits.status, 403, 'x-tenant-id manipulado no debe dar acceso a visitas');
    assert.strictEqual(resSpoofVisits.body.code, 'CONTROL_PLANE_ROLE_FORBIDDEN');
    pass('Flow 3.1: SuperAdmin enviando x-tenant-id a POS es estrictamente rechazado (403 CONTROL_PLANE_ROLE_FORBIDDEN)');

    // 3.2 SuperAdmin enviando x-tenant-id hacia CRM Clientes
    const resSpoofClients = await testApp.request({
      method: 'GET',
      path: '/api/clients',
      headers: {
        ...superAdmin.headers,
        'x-tenant-id': tenantOwner.tenantId
      }
    });
    assert.strictEqual(resSpoofClients.status, 403, 'x-tenant-id manipulado no debe dar acceso a clientes');
    assert.strictEqual(resSpoofClients.body.code, 'CONTROL_PLANE_ROLE_FORBIDDEN');
    pass('Flow 3.2: SuperAdmin enviando x-tenant-id a CRM es estrictamente rechazado (403 CONTROL_PLANE_ROLE_FORBIDDEN)');

    // 3.3 SuperAdmin enviando ?tenant_id= en query string hacia inventario
    const resSpoofQuery = await testApp.request({
      method: 'GET',
      path: `/api/inventory/products?tenant_id=${tenantOwner.tenantId}`,
      headers: superAdmin.headers
    });
    assert.strictEqual(resSpoofQuery.status, 403, 'tenant_id en query no debe dar acceso a inventario');
    assert.strictEqual(resSpoofQuery.body.code, 'CONTROL_PLANE_ROLE_FORBIDDEN');
    pass('Flow 3.3: SuperAdmin enviando tenant_id en query param es rechazado (403 CONTROL_PLANE_ROLE_FORBIDDEN)');


    console.log('\n--- SECCIÓN 4: NO-REGRESIÓN PARA ROLES DEL SALÓN (TENANT PLANE) ---');

    // 4.1 Propietario consulta sus productos de inventario
    const resOwnerInv = await testApp.request({
      method: 'GET',
      path: '/api/inventory/products',
      headers: tenantOwner.headers
    });
    assert.strictEqual(resOwnerInv.status, 200, 'Propietario debe acceder a sus productos');
    pass('Flow 4.1: Propietario accede normalmente a sus productos de inventario (200 OK)');

    // 4.2 Propietario consulta sus visitas / POS
    const resOwnerVisits = await testApp.request({
      method: 'GET',
      path: '/api/visits',
      headers: tenantOwner.headers
    });
    assert.strictEqual(resOwnerVisits.status, 200, 'Propietario debe acceder a visitas de su salón');
    pass('Flow 4.2: Propietario accede normalmente a visitas / POS de su salón (200 OK)');

    // 4.3 Propietario intentando acceder a métricas de Control Plane es bloqueado
    const resOwnerMetrics = await testApp.request({
      method: 'GET',
      path: '/api/saas/metrics',
      headers: tenantOwner.headers
    });
    assert.strictEqual(resOwnerMetrics.status, 403, 'Propietario no puede acceder a Control Plane');
    pass('Flow 4.3: Propietario es bloqueado de consultar métricas globales SaaS (403 CONTROL_PLANE_ROLE_REQUIRED)');

    // 4.4 Admin de salón intentando acceder al directorio de salones es bloqueado
    const resAdminTenants = await testApp.request({
      method: 'GET',
      path: '/api/saas/tenants',
      headers: tenantAdmin.headers
    });
    assert.strictEqual(resAdminTenants.status, 403, 'Admin de salón no puede acceder a Control Plane');
    pass('Flow 4.4: Admin de salón es bloqueado de consultar el directorio global de salones (403 CONTROL_PLANE_ROLE_REQUIRED)');

    console.log('\n======================================================');
    console.log('PHASE 2H-C SUPERADMIN SEPARATION SUMMARY: ALL TESTS PASSED');
    console.log('======================================================\n');

  } finally {
    await testApp.close();
  }
}

runSuite().catch(err => {
  console.error('\n🚨 SUITE FAILED WITH EXCEPTION:', err);
  process.exit(1);
});

