/**
 * Test Suite: Phase 3C — Clientes/CRM incluido en Plan BASE (y conservado en PRO)
 * (backend/tests/test_phase3c_clients_base.cjs)
 *
 * Matriz verificada:
 *   BASE: clients=INCLUIDO | memberships/contratos/marketing=BLOQUEADOS
 *   PRO : clients, memberships, contratos y marketing=INCLUIDOS
 *
 * Zero PostgreSQL: harness en memoria sobre HTTP real (puerto efímero).
 */

'use strict';

delete process.env.DATABASE_URL;
delete process.env.DB_HOST;
delete process.env.PGHOST;
delete process.env.DB_NAME;
delete process.env.PRODUCTION_DB_NAME;

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createInMemoryTestApp } = require('./helpers/create_in_memory_test_app.cjs');
const { signAuthToken } = require('../middleware/auth.middleware');
const {
  CANONICAL_PLAN_FEATURES,
  CANONICAL_PLANS_CATALOG,
  SAAS_FEATURES,
  SAAS_PLANS
} = require('../services/saas_catalog.constants');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('=== STARTING SUITE: PHASE 3C CLIENTES/CRM EN PLAN BASE (ZERO POSTGRESQL) ===\n');

let passed = 0;
let total = 0;
async function test(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  [PASS ${total}] ${name}`);
  } catch (err) {
    console.error(`  [FAIL ${total}] ${name}`);
    console.error(`         Reason: ${err.message}`);
    if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  }
}

const MEMBERSHIP_FIELDS = ['contract_id', 'plan_id', 'plan_name', 'contract_status', 'wash_Quota', 'washes_used',
  'current_period_start', 'current_period_end', 'next_billing_date', 'auto_billing_enabled', 'signed_at', 'precio_mensual'];

async function main() {
  const h = await createInMemoryTestApp();

  /** Agrega un usuario de personal (no owner) al MISMO tenant ya creado por el harness. */
  function addStaffToTenant(tenant, { email, role = 'receptionist' }) {
    const userId = `usr_staff_${crypto.randomUUID().slice(0, 8)}`;
    const sessionId = `ses_staff_${crypto.randomUUID().slice(0, 8)}`;
    h.dbMock.tables.users.push({
      id: userId, tenant_id: tenant.tenantId, branch_id: tenant.branchId, email,
      nombre: 'Recepción', name: 'Recepción', role, is_active: true, estado: 'Activo', password_hash: 'x'
    });
    h.dbMock.tables.user_sessions.push({ id: sessionId, user_id: userId, role, tenant_id: tenant.tenantId, is_active: 1 });
    const token = signAuthToken({
      sub: userId, id: userId, email, name: 'Recepción', role,
      tenantId: tenant.tenantId, branchId: tenant.branchId, sessionId, isSuperAdmin: false
    });
    return { userId, headers: { Authorization: `Bearer ${token}` } };
  }

  try {
    const baseA = await h.createTenantWithUser({ plan: 'BASE', email: 'owner.base.a@test.invalid', businessName: 'Base Alfa' });
    const baseB = await h.createTenantWithUser({ plan: 'BASE', email: 'owner.base.b@test.invalid', businessName: 'Base Beta' });
    const proC = await h.createTenantWithUser({ plan: 'PRO', email: 'owner.pro.c@test.invalid', businessName: 'Pro Gamma' });

    // ------------------------------------------------------------------ catálogo canónico
    await test('Catálogo canónico: BASE incluye clients; memberships y marketing siguen excluidos', () => {
      assert.strictEqual(CANONICAL_PLAN_FEATURES[SAAS_PLANS.BASE][SAAS_FEATURES.CLIENTS], true);
      assert.strictEqual(CANONICAL_PLAN_FEATURES[SAAS_PLANS.BASE][SAAS_FEATURES.MEMBERSHIPS], false);
      assert.strictEqual(CANONICAL_PLAN_FEATURES[SAAS_PLANS.BASE][SAAS_FEATURES.MARKETING], false);
      assert.strictEqual(CANONICAL_PLAN_FEATURES[SAAS_PLANS.BASE][SAAS_FEATURES.INVENTORY_ADVANCED], false);
      assert.strictEqual(CANONICAL_PLAN_FEATURES[SAAS_PLANS.BASE].contracts, undefined, 'No debe existir feature contracts en BASE');
      assert.strictEqual(CANONICAL_PLAN_FEATURES[SAAS_PLANS.PRO][SAAS_FEATURES.CLIENTS], true);
      assert.strictEqual(CANONICAL_PLAN_FEATURES[SAAS_PLANS.PRO][SAAS_FEATURES.MEMBERSHIPS], true);
      assert.strictEqual(CANONICAL_PLAN_FEATURES[SAAS_PLANS.PRO][SAAS_FEATURES.MARKETING], true);
    });

    await test('Tenant BASE existente recibe clients vía catálogo (sin overrides por tenant)', async () => {
      const res = await h.request({ path: '/api/tenant/entitlements', headers: baseA.headers });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.features.clients, true);
      assert.strictEqual(res.body.features.memberships, false);
      assert.strictEqual(res.body.features.marketing, false);
      assert.deepStrictEqual(res.body.overrides || {}, {}, 'No deben existir overrides manuales');
    });

    // ------------------------------------------------------------------ 1,2,3 accesos
    await test('1. Owner BASE puede acceder a Clientes', async () => {
      const res = await h.request({ path: '/api/clients', headers: baseA.headers });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.ok(Array.isArray(res.body));
    });

    await test('2. Personal BASE (rol no owner) puede acceder a Clientes', async () => {
      const staff = addStaffToTenant(baseA, { email: 'recepcion.base.a@test.invalid' });
      const res = await h.request({ path: '/api/clients', headers: staff.headers });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    });

    await test('3. Tenant PRO conserva acceso a Clientes', async () => {
      const res = await h.request({ path: '/api/clients', headers: proC.headers });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    });

    // ------------------------------------------------------------------ 4 CRUD BASE
    let clientA1 = null;
    await test('4a. BASE crea cliente propio', async () => {
      const res = await h.request({
        method: 'POST', path: '/api/clients', headers: baseA.headers,
        body: { nombre: 'Clienta Sintética Uno', cedula: '001-0000001-1', telefono: '8095550001', email: 'uno@test.invalid' }
      });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.tenant_id, baseA.tenantId);
      clientA1 = res.body.id;
      const stored = h.dbMock.tables.clients.find(c => c.id === clientA1);
      assert.ok(stored && stored.tenant_id === baseA.tenantId, 'cliente debe quedar en el tenant autenticado');
    });

    await test('4b. BASE consulta cliente propio por ID, sin campos de membresía', async () => {
      const res = await h.request({ path: `/api/clients/${clientA1}`, headers: baseA.headers });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(res.body.id, clientA1);
      for (const f of MEMBERSHIP_FIELDS) assert.strictEqual(res.body[f], undefined, `campo de membresía filtrado: ${f}`);
      assert.strictEqual(res.body.password, undefined, 'hash de contraseña nunca se expone');
    });

    await test('4c. BASE edita cliente propio', async () => {
      const res = await h.request({
        method: 'PUT', path: `/api/clients/${clientA1}`, headers: baseA.headers,
        body: { nombre: 'Clienta Sintética Uno Editada', telefono: '8095550002' }
      });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const stored = h.dbMock.tables.clients.find(c => c.id === clientA1);
      assert.strictEqual(stored.nombre, 'Clienta Sintética Uno Editada');
    });

    await test('4d. BASE lista, busca y pagina clientes propios', async () => {
      const list = await h.request({ path: '/api/clients?paginated=true&limit=10', headers: baseA.headers });
      assert.strictEqual(list.status, 200, JSON.stringify(list.body));
      assert.ok(list.body.data.some(c => c.id === clientA1));
      for (const row of list.body.data) {
        for (const f of MEMBERSHIP_FIELDS) assert.strictEqual(row[f], undefined, `lista sin ${f}`);
      }
      const search = await h.request({ path: '/api/clients/search?q=Sint', headers: baseA.headers });
      assert.strictEqual(search.status, 200, JSON.stringify(search.body));
    });

    // ------------------------------------------------------------------ 5,6,7 bloqueos BASE
    await test('5. BASE recibe 403 FEATURE_NOT_INCLUDED en Membresías (/api/plans)', async () => {
      const res = await h.request({ path: '/api/plans', headers: baseA.headers });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.code, 'FEATURE_NOT_INCLUDED');
      assert.strictEqual(res.body.feature, 'memberships');
    });

    await test('6. BASE recibe 403 FEATURE_NOT_INCLUDED en Contratos de membresía (/api/contracts)', async () => {
      const res = await h.request({ path: '/api/contracts', headers: baseA.headers });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.code, 'FEATURE_NOT_INCLUDED');
      assert.strictEqual(res.body.feature, 'memberships');
    });

    await test('7. BASE recibe 403 FEATURE_NOT_INCLUDED en Marketing PRO (/api/marketing/*)', async () => {
      for (const p of ['/api/marketing/settings', '/api/marketing/stats', '/api/marketing/recipient-count']) {
        const res = await h.request({ path: p, headers: baseA.headers });
        assert.strictEqual(res.status, 403, p);
        assert.strictEqual(res.body.code, 'FEATURE_NOT_INCLUDED', p);
        assert.strictEqual(res.body.feature, 'marketing', p);
      }
      const post = await h.request({ method: 'POST', path: '/api/marketing/send-mass', headers: baseA.headers, body: {} });
      assert.strictEqual(post.status, 403);
      assert.strictEqual(post.body.feature, 'marketing');
    });

    await test('7b. BASE no puede suscribir clientes a membresías vía POST/PUT /api/clients (plan_id)', async () => {
      const before = h.dbMock.tables.clients.length;
      const post = await h.request({
        method: 'POST', path: '/api/clients', headers: baseA.headers,
        body: { nombre: 'Intento Suscripción', plan_id: 'plan-x' }
      });
      assert.strictEqual(post.status, 403);
      assert.strictEqual(post.body.code, 'FEATURE_NOT_INCLUDED');
      assert.strictEqual(post.body.feature, 'memberships');
      assert.strictEqual(h.dbMock.tables.clients.length, before, 'no debe crearse el cliente');

      const put = await h.request({
        method: 'PUT', path: `/api/clients/${clientA1}`, headers: baseA.headers,
        body: { plan_id: 'plan-x', contract_status: 'Active' }
      });
      assert.strictEqual(put.status, 403);
      assert.strictEqual(put.body.feature, 'memberships');
      assert.strictEqual(h.dbMock.tables.contracts.filter(c => c.tenant_id === baseA.tenantId).length, 0);
    });

    // ------------------------------------------------------------------ 8 aislamiento
    let clientB1 = null;
    await test('8a. Tenant B crea su propio cliente', async () => {
      const res = await h.request({
        method: 'POST', path: '/api/clients', headers: baseB.headers,
        body: { nombre: 'Clienta Beta Privada', cedula: '001-0000002-2' }
      });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      clientB1 = res.body.id;
    });

    await test('8b. Tenant A recibe 404 al consultar o modificar cliente de Tenant B', async () => {
      const get = await h.request({ path: `/api/clients/${clientB1}`, headers: baseA.headers });
      assert.strictEqual(get.status, 404);
      const put = await h.request({
        method: 'PUT', path: `/api/clients/${clientB1}`, headers: baseA.headers, body: { nombre: 'HACKEADO' }
      });
      assert.strictEqual(put.status, 404);
      const del = await h.request({ method: 'DELETE', path: `/api/clients/${clientB1}`, headers: baseA.headers });
      assert.strictEqual(del.status, 404);
      const stored = h.dbMock.tables.clients.find(c => c.id === clientB1);
      assert.strictEqual(stored.nombre, 'Clienta Beta Privada');
      assert.strictEqual(stored.tenant_id, baseB.tenantId);
    });

    await test('8c. x-tenant-id, ?tenant_id y payload tenant_id falsificados son rechazados sin leer ni escribir datos ajenos', async () => {
      const isRejected = (r) => r.status === 404 || (r.status === 403 && r.body.code === 'CROSS_TENANT_ACCESS_DENIED');
      const spoofHeader = await h.request({
        path: `/api/clients/${clientB1}`, headers: { ...baseA.headers, 'x-tenant-id': baseB.tenantId }
      });
      assert.ok(isRejected(spoofHeader), `header: ${spoofHeader.status}`);
      assert.ok(!JSON.stringify(spoofHeader.body).includes('Clienta Beta Privada'));

      const spoofQuery = await h.request({ path: `/api/clients?tenant_id=${baseB.tenantId}`, headers: baseA.headers });
      assert.ok(isRejected(spoofQuery) || (spoofQuery.status === 200 && !spoofQuery.body.some(c => c.id === clientB1)), `query: ${spoofQuery.status}`);

      const before = h.dbMock.tables.clients.filter(c => c.tenant_id === baseB.tenantId).length;
      const spoofBody = await h.request({
        method: 'POST', path: '/api/clients', headers: baseA.headers,
        body: { nombre: 'Intento Spoof', tenant_id: baseB.tenantId }
      });
      assert.ok(isRejected(spoofBody) || (spoofBody.status === 200 && spoofBody.body.tenant_id === baseA.tenantId), `body: ${spoofBody.status}`);
      assert.strictEqual(h.dbMock.tables.clients.filter(c => c.tenant_id === baseB.tenantId).length, before, 'nada se escribe en Tenant B');
    });

    await test('8d. Búsqueda de Tenant A nunca devuelve clientes de Tenant B', async () => {
      const res = await h.request({ path: '/api/clients/search?q=Beta', headers: baseA.headers });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const items = res.body.data || res.body;
      assert.ok(!items.some(c => c.id === clientB1));
    });

    // ------------------------------------------------------------------ 3b PRO conserva membresías
    let proClientId = null;
    await test('3b. PRO crea cliente con membresía (contrato) y la ve en la respuesta', async () => {
      const post = await h.request({
        method: 'POST', path: '/api/clients', headers: proC.headers,
        body: { nombre: 'Clienta Pro Miembro', cedula: '001-0000003-3', plan_id: 'plan-pro-1', plan_name: 'Plan Beauty' }
      });
      assert.strictEqual(post.status, 200, JSON.stringify(post.body));
      proClientId = post.body.id;
      const contracts = h.dbMock.tables.contracts.filter(c => c.tenant_id === proC.tenantId && c.client_id === proClientId);
      assert.strictEqual(contracts.length, 1, 'PRO sí crea contrato de membresía');
      const get = await h.request({ path: `/api/clients/${proClientId}`, headers: proC.headers });
      assert.strictEqual(get.status, 200, JSON.stringify(get.body));
      assert.strictEqual(get.body.password, undefined, 'hash de contraseña nunca se expone');
      // Nota: el mock SQL no resuelve LEFT JOIN contracts; la presencia del contrato se verifica en la tabla.
      const contractsApi = await h.request({ path: '/api/contracts', headers: proC.headers });
      assert.notStrictEqual(contractsApi.status, 403, 'PRO accede a contratos');
    });

    // ------------------------------------------------------------------ 9,10 downgrade
    await test('9/10. Downgrade PRO→BASE conserva clientes, acceso a Clientes y contratos; bloquea membresías', async () => {
      const clientsBefore = h.dbMock.tables.clients.filter(c => c.tenant_id === proC.tenantId).length;
      const contractsBefore = h.dbMock.tables.contracts.filter(c => c.tenant_id === proC.tenantId).map(c => ({ ...c }));
      assert.ok(clientsBefore >= 1 && contractsBefore.length >= 1);

      await h.entitlementsService.changeTenantPlan(proC.tenantId, SAAS_PLANS.BASE, { actorId: 'superadmin-test', reason: 'Downgrade PRO→BASE' });

      const ent = await h.request({ path: '/api/tenant/entitlements', headers: proC.headers });
      assert.strictEqual(ent.status, 200);
      assert.strictEqual(ent.body.currentPlan, 'BASE');
      assert.strictEqual(ent.body.features.clients, true, 'Clientes sigue accesible tras downgrade');
      assert.strictEqual(ent.body.features.memberships, false);
      assert.strictEqual(ent.body.features.marketing, false);

      const list = await h.request({ path: '/api/clients', headers: proC.headers });
      assert.strictEqual(list.status, 200);
      const row = list.body.find(c => c.id === proClientId);
      assert.ok(row, 'cliente conservado y visible tras downgrade');
      for (const f of MEMBERSHIP_FIELDS) assert.strictEqual(row[f], undefined, `post-downgrade oculta ${f}`);

      for (const p of ['/api/plans', '/api/contracts']) {
        const res = await h.request({ path: p, headers: proC.headers });
        assert.strictEqual(res.status, 403, p);
        assert.strictEqual(res.body.feature, 'memberships', p);
      }
      const mk = await h.request({ path: '/api/marketing/settings', headers: proC.headers });
      assert.strictEqual(mk.status, 403);

      // Datos PRO conservados byte a byte (no se borran ni modifican)
      const clientsAfter = h.dbMock.tables.clients.filter(c => c.tenant_id === proC.tenantId).length;
      const contractsAfter = h.dbMock.tables.contracts.filter(c => c.tenant_id === proC.tenantId);
      assert.strictEqual(clientsAfter, clientsBefore);
      assert.deepStrictEqual(contractsAfter, contractsBefore, 'contratos intactos tras downgrade');
    });

    await test('10b. BASE post-downgrade NO puede borrar clientes con contratos conservados (409) ni mutar contratos', async () => {
      const del = await h.request({ method: 'DELETE', path: `/api/clients/${proClientId}`, headers: proC.headers });
      assert.strictEqual(del.status, 409);
      assert.strictEqual(del.body.code, 'CLIENT_HAS_MEMBERSHIP_DATA');
      assert.ok(h.dbMock.tables.clients.some(c => c.id === proClientId));
      assert.strictEqual(h.dbMock.tables.contracts.filter(c => c.client_id === proClientId).length, 1);
      const put = await h.request({
        method: 'PUT', path: `/api/clients/${proClientId}`, headers: proC.headers, body: { contract_status: 'Cancelled' }
      });
      assert.strictEqual(put.status, 403);
    });

    await test('10c. BASE post-downgrade puede seguir editando datos básicos del cliente', async () => {
      const put = await h.request({
        method: 'PUT', path: `/api/clients/${proClientId}`, headers: proC.headers, body: { telefono: '8095559999' }
      });
      assert.strictEqual(put.status, 200, JSON.stringify(put.body));
    });

    await test('10d. Re-upgrade a PRO restaura membresías con los datos conservados', async () => {
      await h.entitlementsService.changeTenantPlan(proC.tenantId, SAAS_PLANS.PRO, { actorId: 'superadmin-test', reason: 'Re-upgrade' });
      const get = await h.request({ path: `/api/clients/${proClientId}`, headers: proC.headers });
      assert.strictEqual(get.status, 200);
      assert.strictEqual(h.dbMock.tables.contracts.filter(c => c.client_id === proClientId).length, 1, 'contrato conservado');
      const contracts = await h.request({ path: '/api/contracts', headers: proC.headers });
      assert.notStrictEqual(contracts.status, 403);
    });

    // ------------------------------------------------------------------ 11,12 UI (código fuente)
    await test('11. Menú BASE: Clientes visible por hasClients (no por hasProPlan); Membresías/Contratos solo PRO', () => {
      const app = read('src/App.jsx');
      assert.ok(/hasClients\s*&&\s*!isAccountant[\s\S]{0,200}to="\/clientes"/.test(app), 'link Clientes gobernado por hasClients');
      assert.ok(/const hasClients = Boolean\(/.test(app));
      // El dropdown Suscripciones (membresías/contratos) sigue gobernado por hasProPlan
      assert.ok(/\{hasProPlan && !isAccountant && \(isAdmin \|\| \(user\?\.permissions && \(/.test(app));
      // Rutas de clientes ya no dependen de hasProPlan
      for (const route of ['/clientes', '/lista-clientes', '/registro-cliente']) {
        const line = app.split('\n').find(l => l.includes(`<Route path="${route}"`));
        assert.ok(line && line.includes('!hasClients') && !line.includes('!hasProPlan'), `ruta ${route} usa hasClients`);
      }
      // Rutas de membresías siguen protegidas
      for (const route of ['/planes', '/membresias', '/contratos']) {
        const line = app.split('\n').find(l => l.includes(`<Route path="${route}"`));
        assert.ok(line && line.includes('!hasProPlan') && line.includes('FeatureForbiddenGate'), `ruta ${route} sigue bloqueada en BASE`);
      }
      const gate = read('src/components/common/FeatureForbiddenGate.jsx');
      assert.ok(gate.includes('Actualizar a Plan {requiredPlan}') || gate.includes('Actualizar a Plan PRO'));
      assert.ok(!/Directorio CRM de clientas/.test(gate), 'Gate no presenta Clientes como beneficio PRO');
      const profile = read('src/components/clients/ClientProfile.jsx');
      assert.ok(profile.includes("hasFeature('memberships')") && profile.includes('showMemberships'));
      const ctx = read('src/context/EntitlementsContext.jsx');
      assert.ok(/clients:\s*true/.test(ctx), 'EntitlementsContext default BASE incluye clients');
    });

    await test('12. Comparador/descripciones: Clientes incluido en BASE y PRO; no exclusivo PRO', () => {
      const base = CANONICAL_PLANS_CATALOG.find(p => p.code === SAAS_PLANS.BASE);
      const pro = CANONICAL_PLANS_CATALOG.find(p => p.code === SAAS_PLANS.PRO);
      assert.strictEqual(base.features.clients, true);
      assert.strictEqual(pro.features.clients, true);
      assert.ok(/CRM de Clientes/i.test(base.description), 'descripción BASE menciona Clientes/CRM');
      assert.ok(!/CRM de Clientas/i.test(pro.description), 'descripción PRO ya no vende CRM como exclusivo');
      const landing = read('src/pages/Landing.jsx');
      assert.ok(!landing.includes('No incluye registro ni directorio CRM de clientes'), 'Landing BASE ya no excluye CRM');
      assert.ok(/Directorio CRM de Clientes:<\/strong>/.test(landing), 'Landing BASE lista CRM como incluido');
      assert.ok(!landing.includes('Membresías y Clientes (Exclusivo Plan Pro)'));
      const billing = read('src/components/saas/SaasBillingModule.jsx');
      assert.ok(/Plan Base incluye[^']*Clientes\/CRM/.test(billing));
      const upgrade = read('src/components/saas/SaasUpgradeModal.jsx');
      assert.ok(!/Desbloquea CRM de clientes/.test(upgrade));
    });

    await test('Migración idempotente: solo catálogo global, sin tocar datos de tenants', () => {
      const mig = read('backend/migrations/20261111_phase3c_clients_in_base_plan.cjs');
      assert.ok(/'BASE', 'clients', true/.test(mig));
      assert.ok(/'BASE', 'memberships', false/.test(mig));
      assert.ok(/'BASE', 'marketing', false/.test(mig));
      assert.ok(!/(INSERT INTO|UPDATE|DELETE FROM)\s+(tenant_feature_overrides|tenant_subscriptions|tenants|clients|contracts)\b/i.test(mig), 'no toca datos de tenant');
      assert.ok(/ON CONFLICT \(plan_code, feature_key\) DO UPDATE/.test(mig), 'idempotente');
      const all = read('backend/migrations/migrate_all.cjs');
      assert.ok(all.includes('20261111_phase3c_clients_in_base_plan'));
      const contract = read('backend/scripts/canonical_schema_contract.cjs');
      assert.ok(contract.includes('20261111_phase3c_clients_in_base_plan'));
    });
  } finally {
    await h.close();
  }

  console.log(`\nPHASE 3C CLIENTS-IN-BASE TEST SUMMARY: ${passed}/${total} PASSED`);
  if (passed !== total) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});

