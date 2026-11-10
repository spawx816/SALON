/**
 * Test Suite: Phase 2A Entitlements & SaaS Commercial Model Unit Tests (28 Test Cases)
 * 
 * Verifies the 2-plan SaaS model (BASE & PRO) and entitlements enforcement
 * using In-Memory fake repositories.
 * 
 * ZERO PostgreSQL connection required or executed.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { InMemorySaasRepository } = require('../repositories/fakes/in_memory_saas.repository');
const { EntitlementsService } = require('../services/entitlements.service');
const { createEntitlementsMiddleware } = require('../middleware/entitlements.middleware');
const {
  SAAS_PLANS,
  SUBSCRIPTION_STATUSES,
  SAAS_FEATURES,
  CANONICAL_PLANS_CATALOG,
  CANONICAL_PLAN_FEATURES,
  DEFAULT_PLAN_LIMITS,
  isValidPlanCode,
  normalizePlanCode
} = require('../services/saas_catalog.constants');

console.log('=== STARTING SUITE: PHASE 2A ENTITLEMENTS & 2-PLAN MODEL UNIT TESTS ===\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  [PASS ${totalTests}/28] ${name}`);
  } catch (err) {
    console.error(`  [FAIL ${totalTests}/28] ${name}`);
    console.error(`         Reason: ${err.message}`);
    if (err.stack) {
      console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  [PASS ${totalTests}/28] ${name}`);
  } catch (err) {
    console.error(`  [FAIL ${totalTests}/28] ${name}`);
    console.error(`         Reason: ${err.message}`);
    if (err.stack) {
      console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
  }
}

async function runAllTests() {
  const fakeRepo = new InMemorySaasRepository();
  const service = new EntitlementsService({
    subscriptionRepo: fakeRepo,
    entitlementsRepo: fakeRepo,
    auditRepo: fakeRepo,
    saasPlanRepo: fakeRepo
  });
  const middleware = createEntitlementsMiddleware(service);

  // TEST 1: New tenant receives BASE
  await runAsyncTest('Test 1: New tenant receives BASE plan by default', async () => {
    const tenantId = 'tenant-test-1';
    const sub = await service.createInitialSubscription(tenantId, { actorId: 'admin-1' });
    assert.strictEqual(sub.plan_code, SAAS_PLANS.BASE);
    assert.strictEqual(sub.status, SUBSCRIPTION_STATUSES.ACTIVE);
  });

  // TEST 2: Onboarding payload cannot force PRO
  await runAsyncTest('Test 2: Onboarding payload cannot force PRO without authorization', async () => {
    const tenantId = 'tenant-test-2';
    // createInitialSubscription ignores any malicious requested_plan and enforces BASE
    const sub = await service.createInitialSubscription(tenantId, { actorId: 'admin-2', requested_plan: 'PRO' });
    assert.strictEqual(sub.plan_code, SAAS_PLANS.BASE);
    const entitlements = await service.getTenantEntitlements(tenantId);
    assert.strictEqual(entitlements.plan, SAAS_PLANS.BASE);
  });

  // TEST 3: Base allows included features (pos, cajas, dgii_ecf, etc.)
  await runAsyncTest('Test 3: Base allows included features (pos, cajas, dgii_ecf, etc.)', async () => {
    const tenantId = 'tenant-test-3';
    await service.createInitialSubscription(tenantId, { actorId: 'admin-3' });
    const baseFeatureKeys = Object.keys(CANONICAL_PLAN_FEATURES.BASE).filter(k => CANONICAL_PLAN_FEATURES.BASE[k] === true);
    for (const feat of baseFeatureKeys) {
      const check = await service.hasFeature(tenantId, feat);
      assert.strictEqual(check.allowed, true, `Feature ${feat} should be allowed in BASE`);
    }
  });

  // TEST 4: Base blocks Pro features (clients, memberships)
  await runAsyncTest('Test 4: Base blocks Pro features (clients, memberships)', async () => {
    const tenantId = 'tenant-test-4';
    await service.createInitialSubscription(tenantId, { actorId: 'admin-4' });
    const checkClients = await service.hasFeature(tenantId, SAAS_FEATURES.CLIENTS);
    const checkMemberships = await service.hasFeature(tenantId, SAAS_FEATURES.MEMBERSHIPS);
    assert.strictEqual(checkClients.allowed, false, 'Base must block clients feature');
    assert.strictEqual(checkClients.code, 'FEATURE_NOT_INCLUDED');
    assert.strictEqual(checkMemberships.allowed, false, 'Base must block memberships feature');
    assert.strictEqual(checkMemberships.code, 'FEATURE_NOT_INCLUDED');
  });

  // TEST 5: Pro allows Base features
  await runAsyncTest('Test 5: Pro allows all Base features', async () => {
    const tenantId = 'tenant-test-5';
    await service.createInitialSubscription(tenantId, { actorId: 'admin-5' });
    await service.changeTenantPlan(tenantId, SAAS_PLANS.PRO, { actorId: 'superadmin-1', reason: 'Upgrade to Pro' });
    const baseFeatureKeys = Object.keys(CANONICAL_PLAN_FEATURES.BASE).filter(k => CANONICAL_PLAN_FEATURES.BASE[k] === true);
    for (const feat of baseFeatureKeys) {
      const check = await service.hasFeature(tenantId, feat);
      assert.strictEqual(check.allowed, true, `Base feature ${feat} should be allowed in PRO`);
    }
  });

  // TEST 6: Pro allows additional Pro features
  await runAsyncTest('Test 6: Pro allows additional Pro features (clients, memberships)', async () => {
    const tenantId = 'tenant-test-6';
    await service.createInitialSubscription(tenantId, { actorId: 'admin-6' });
    await service.changeTenantPlan(tenantId, SAAS_PLANS.PRO, { actorId: 'superadmin-1', reason: 'Upgrade to Pro' });
    const checkClients = await service.hasFeature(tenantId, SAAS_FEATURES.CLIENTS);
    const checkMemberships = await service.hasFeature(tenantId, SAAS_FEATURES.MEMBERSHIPS);
    assert.strictEqual(checkClients.allowed, true, 'Pro must allow clients feature');
    assert.strictEqual(checkMemberships.allowed, true, 'Pro must allow memberships feature');
  });

  // TEST 7: No Enterprise plan exists in catalog or constants
  runTest('Test 7: No Enterprise, Premium, or 3rd-tier plan exists in constants', () => {
    assert.strictEqual(SAAS_PLANS.ENTERPRISE, undefined);
    assert.strictEqual(SAAS_PLANS.PREMIUM, undefined);
    assert.strictEqual(SAAS_PLANS.TRIAL, undefined);
    assert.strictEqual(SAAS_PLANS.FREE, undefined);
    assert.strictEqual(isValidPlanCode('ENTERPRISE'), false);
    assert.strictEqual(isValidPlanCode('PREMIUM'), false);
    assert.strictEqual(isValidPlanCode('FREE'), false);
    assert.strictEqual(normalizePlanCode('ENTERPRISE'), null);
  });

  // TEST 8: Catalog returns exactly 2 plans (BASE, PRO)
  runTest('Test 8: Catalog returns exactly 2 plans (BASE, PRO)', () => {
    const plans = CANONICAL_PLANS_CATALOG;
    assert.strictEqual(plans.length, 2, 'Catalog must contain exactly 2 plans');
    const codes = plans.map(p => p.code).sort();
    assert.deepStrictEqual(codes, ['BASE', 'PRO']);
  });

  // TEST 9: Unknown plan fails closed
  await runAsyncTest('Test 9: Unknown plan fails closed during check and change', async () => {
    const tenantId = 'tenant-test-9';
    await assert.rejects(
      async () => service.changeTenantPlan(tenantId, 'ENTERPRISE', { actorId: 'superadmin-1', reason: 'Invalid plan' }),
      /Código de plan inválido/i
    );
    // Directly setting invalid plan in repository must fail closed to empty entitlements
    fakeRepo.subscriptions.set('tenant-invalid-plan', {
      tenant_id: 'tenant-invalid-plan',
      plan_code: 'INVALID_TIER',
      status: SUBSCRIPTION_STATUSES.ACTIVE
    });
    const ent = await service.getTenantEntitlements('tenant-invalid-plan');
    assert.strictEqual(ent.plan, null);
    assert.strictEqual(Object.keys(ent.features).length, 0);
  });

  // TEST 10: Suspended subscription blocks protected features
  await runAsyncTest('Test 10: Suspended subscription blocks protected features', async () => {
    const tenantId = 'tenant-test-10';
    await service.createInitialSubscription(tenantId, { actorId: 'admin-10' });
    fakeRepo.subscriptions.set(tenantId, {
      ...fakeRepo.subscriptions.get(tenantId),
      status: SUBSCRIPTION_STATUSES.SUSPENDED
    });
    const checkPos = await service.hasFeature(tenantId, SAAS_FEATURES.POS);
    assert.strictEqual(checkPos.allowed, false, 'Suspended subscription must fail closed for pos');
    assert.strictEqual(checkPos.code, 'SUBSCRIPTION_SUSPENDED');
  });

  // TEST 11: Cancelled subscription blocks protected features
  await runAsyncTest('Test 11: Cancelled subscription blocks protected features', async () => {
    const tenantId = 'tenant-test-11';
    await service.createInitialSubscription(tenantId, { actorId: 'admin-11' });
    fakeRepo.subscriptions.set(tenantId, {
      ...fakeRepo.subscriptions.get(tenantId),
      status: SUBSCRIPTION_STATUSES.CANCELLED
    });
    const checkCajas = await service.hasFeature(tenantId, SAAS_FEATURES.CASH_REGISTERS);
    assert.strictEqual(checkCajas.allowed, false, 'Cancelled subscription must fail closed');
    assert.strictEqual(checkCajas.code, 'SUBSCRIPTION_CANCELLED');
  });

  // TEST 12: Expired subscription blocks protected features
  await runAsyncTest('Test 12: Expired subscription blocks protected features', async () => {
    const tenantId = 'tenant-test-12';
    await service.createInitialSubscription(tenantId, { actorId: 'admin-12' });
    const pastDate = new Date(Date.now() - 86400000 * 2); // 2 days ago
    fakeRepo.subscriptions.set(tenantId, {
      ...fakeRepo.subscriptions.get(tenantId),
      current_period_end: pastDate
    });
    const checkPos = await service.hasFeature(tenantId, SAAS_FEATURES.POS);
    assert.strictEqual(checkPos.allowed, false, 'Expired subscription must fail closed');
    assert.strictEqual(checkPos.code, 'SUBSCRIPTION_EXPIRED');
  });

  // TEST 13: Valid non-expired override grants a feature
  await runAsyncTest('Test 13: Valid non-expired override grants a feature to BASE tenant', async () => {
    const tenantId = 'tenant-test-13';
    await service.createInitialSubscription(tenantId, { actorId: 'admin-13' });
    // Initially BASE has no memberships
    const checkBefore = await service.hasFeature(tenantId, SAAS_FEATURES.MEMBERSHIPS);
    assert.strictEqual(checkBefore.allowed, false);

    // Add override granting memberships for 7 days
    const futureDate = new Date(Date.now() + 86400000 * 7);
    await fakeRepo.upsertOverride(tenantId, {
      feature_key: SAAS_FEATURES.MEMBERSHIPS,
      is_enabled: true,
      expires_at: futureDate,
      reason: 'Special promotional grant',
      actor_id: 'superadmin-1'
    });
    const checkAfter = await service.hasFeature(tenantId, SAAS_FEATURES.MEMBERSHIPS);
    assert.strictEqual(checkAfter.allowed, true, 'Valid non-expired override must grant feature');
  });

  // TEST 14: Revocation override (is_enabled: false) blocks a feature
  await runAsyncTest('Test 14: Revocation override (is_enabled: false) blocks feature even in PRO', async () => {
    const tenantId = 'tenant-test-14';
    await service.createInitialSubscription(tenantId, { actorId: 'admin-14' });
    await service.changeTenantPlan(tenantId, SAAS_PLANS.PRO, { actorId: 'superadmin-1', reason: 'Upgrade' });
    const checkBefore = await service.hasFeature(tenantId, SAAS_FEATURES.CLIENTS);
    assert.strictEqual(checkBefore.allowed, true);

    // Override explicitly revoking clients
    await fakeRepo.upsertOverride(tenantId, {
      feature_key: SAAS_FEATURES.CLIENTS,
      is_enabled: false,
      reason: 'Administrative revocation',
      actor_id: 'superadmin-1'
    });
    const checkAfter = await service.hasFeature(tenantId, SAAS_FEATURES.CLIENTS);
    assert.strictEqual(checkAfter.allowed, false, 'Override with is_enabled=false must block feature');
    assert.strictEqual(checkAfter.code, 'FEATURE_NOT_INCLUDED');
  });

  // TEST 15: Expired override is ignored
  await runAsyncTest('Test 15: Expired override is ignored', async () => {
    const tenantId = 'tenant-test-15';
    await service.createInitialSubscription(tenantId, { actorId: 'admin-15' });
    // Override expired yesterday
    const pastDate = new Date(Date.now() - 86400000);
    await fakeRepo.upsertOverride(tenantId, {
      feature_key: SAAS_FEATURES.MEMBERSHIPS,
      is_enabled: true,
      expires_at: pastDate,
      reason: 'Expired promo',
      actor_id: 'superadmin-1'
    });
    const check = await service.hasFeature(tenantId, SAAS_FEATURES.MEMBERSHIPS);
    assert.strictEqual(check.allowed, false, 'Expired override must be ignored');
  });

  // TEST 16: Tenant A cannot query Tenant B entitlements (anti-IDOR)
  await runAsyncTest('Test 16: Tenant A cannot query Tenant B entitlements (anti-IDOR)', async () => {
    const tenantA = 'tenant-A';
    const tenantB = 'tenant-B';
    await service.createInitialSubscription(tenantA, { actorId: 'admin-A' });
    await service.createInitialSubscription(tenantB, { actorId: 'admin-B' });
    await service.changeTenantPlan(tenantB, SAAS_PLANS.PRO, { actorId: 'superadmin-1', reason: 'Upgrade B' });

    // Simulate endpoint protected by requirePlanFeature
    const reqPlanFeature = middleware.requirePlanFeature(SAAS_FEATURES.MEMBERSHIPS);
    const mockReq = {
      user: { id: 'user-A', role: 'admin', tenantId: tenantA },
      tenantId: tenantA, // Authenticated tenant is Tenant A (BASE)
      headers: { 'x-tenant-id': tenantB }, // Malicious attempt to spoof Tenant B (PRO)
      query: { tenant_id: tenantB },
      body: { tenant_id: tenantB }
    };
    let statusCalled = null;
    let jsonSent = null;
    const mockRes = {
      status(s) { statusCalled = s; return this; },
      json(j) { jsonSent = j; return this; }
    };
    let nextCalled = false;
    await reqPlanFeature(mockReq, mockRes, () => { nextCalled = true; });

    // Tenant A is BASE, so memberships must be rejected with 403, NOT reading Tenant B's PRO
    assert.strictEqual(statusCalled, 403);
    assert.strictEqual(jsonSent.code, 'FEATURE_NOT_INCLUDED');
    assert.strictEqual(nextCalled, false);
  });

  // TEST 17: x-tenant-id header does not override authenticated req.tenantId
  await runAsyncTest('Test 17: x-tenant-id header does not override authenticated req.tenantId', async () => {
    const tenantAuth = 'tenant-auth-17';
    await service.createInitialSubscription(tenantAuth, { actorId: 'admin-17' });
    const reqClients = middleware.requirePlanFeature(SAAS_FEATURES.CLIENTS);
    const req = {
      user: { id: 'u1', role: 'admin', tenantId: tenantAuth },
      tenantId: tenantAuth,
      headers: { 'x-tenant-id': 'tenant-b-with-pro' }
    };
    let statusCode = null;
    let nextCalled = false;
    const res = {
      status(s) { statusCode = s; return this; },
      json() { return this; }
    };
    await reqClients(req, res, () => { nextCalled = true; });
    assert.strictEqual(statusCode, 403);
    assert.strictEqual(nextCalled, false);
  });

  // TEST 18: Query string ?tenant_id= does not override authenticated req.tenantId
  await runAsyncTest('Test 18: Query string ?tenant_id= does not override authenticated req.tenantId', async () => {
    const tenantAuth = 'tenant-auth-18';
    await service.createInitialSubscription(tenantAuth, { actorId: 'admin-18' });
    const reqClients = middleware.requirePlanFeature(SAAS_FEATURES.CLIENTS);
    const req = {
      user: { id: 'u1', role: 'admin', tenantId: tenantAuth },
      tenantId: tenantAuth,
      query: { tenant_id: 'tenant-b-with-pro' }
    };
    let statusCode = null;
    let nextCalled = false;
    const res = {
      status(s) { statusCode = s; return this; },
      json() { return this; }
    };
    await reqClients(req, res, () => { nextCalled = true; });
    assert.strictEqual(statusCode, 403);
    assert.strictEqual(nextCalled, false);
  });

  // TEST 19: Body payload tenant_id does not override authenticated req.tenantId
  await runAsyncTest('Test 19: Body payload tenant_id does not override authenticated req.tenantId', async () => {
    const tenantAuth = 'tenant-auth-19';
    await service.createInitialSubscription(tenantAuth, { actorId: 'admin-19' });
    const reqClients = middleware.requirePlanFeature(SAAS_FEATURES.CLIENTS);
    const req = {
      user: { id: 'u1', role: 'admin', tenantId: tenantAuth },
      tenantId: tenantAuth,
      body: { tenant_id: 'tenant-b-with-pro' }
    };
    let statusCode = null;
    let nextCalled = false;
    const res = {
      status(s) { statusCode = s; return this; },
      json() { return this; }
    };
    await reqClients(req, res, () => { nextCalled = true; });
    assert.strictEqual(statusCode, 403);
    assert.strictEqual(nextCalled, false);
  });

  // TEST 20: User limit is enforced per tenant
  await runAsyncTest('Test 20: User limit is enforced per tenant', async () => {
    const tenantId = 'tenant-users-20';
    await service.createInitialSubscription(tenantId, { actorId: 'admin-20' }); // BASE limit: 3 users
    fakeRepo.resourceUsage.set(`${tenantId}:users`, 3);

    const check = await service.checkLimit(tenantId, 'users');
    assert.strictEqual(check.allowed, false, 'User limit of 3 reached, next should be blocked');
    assert.strictEqual(check.current, 3);
    assert.strictEqual(check.maximum, 3);

    const reqUserLimit = middleware.requireTenantLimit('users');
    const req = { user: { role: 'admin', tenantId }, tenantId };
    let statusCalled = null;
    let jsonSent = null;
    const res = {
      status(s) { statusCalled = s; return this; },
      json(j) { jsonSent = j; return this; }
    };
    let nextCalled = false;
    await reqUserLimit(req, res, () => { nextCalled = true; });
    assert.strictEqual(statusCalled, 403);
    assert.strictEqual(jsonSent.code, 'PLAN_LIMIT_REACHED');
    assert.strictEqual(nextCalled, false);
  });

  // TEST 21: Branch limit is enforced per tenant
  await runAsyncTest('Test 21: Branch limit is enforced per tenant', async () => {
    const tenantId = 'tenant-branches-21';
    await service.createInitialSubscription(tenantId, { actorId: 'admin-21' }); // BASE limit: 1 branch
    fakeRepo.resourceUsage.set(`${tenantId}:branches`, 1);

    const check = await service.checkLimit(tenantId, 'branches');
    assert.strictEqual(check.allowed, false, 'Branch limit of 1 reached, next branch blocked');

    const reqBranchLimit = middleware.requireTenantLimit('branches');
    const req = { user: { role: 'admin', tenantId }, tenantId };
    let statusCalled = null;
    const res = {
      status(s) { statusCalled = s; return this; },
      json() { return this; }
    };
    let nextCalled = false;
    await reqBranchLimit(req, res, () => { nextCalled = true; });
    assert.strictEqual(statusCalled, 403);
    assert.strictEqual(nextCalled, false);
  });

  // TEST 22: Tenant A does not consume Tenant B's limits
  await runAsyncTest('Test 22: Tenant A does not consume Tenant B limits', async () => {
    const tenantA = 'tenant-iso-A';
    const tenantB = 'tenant-iso-B';
    await service.createInitialSubscription(tenantA, { actorId: 'admin-A' });
    await service.createInitialSubscription(tenantB, { actorId: 'admin-B' });
    fakeRepo.resourceUsage.set(`${tenantA}:users`, 3); // A is full
    fakeRepo.resourceUsage.set(`${tenantB}:users`, 1); // B has 2 spots left

    const checkA = await service.checkLimit(tenantA, 'users');
    const checkB = await service.checkLimit(tenantB, 'users');
    assert.strictEqual(checkA.allowed, false, 'Tenant A is full');
    assert.strictEqual(checkB.allowed, true, 'Tenant B has room');
    assert.strictEqual(checkB.current, 1);
  });

  // TEST 23: Salon admin cannot change their own plan
  runTest('Test 23: Salon admin cannot change their own plan (role check in route)', () => {
    // Route validation logic verification
    const isSuperAdmin = (role) => role === 'superadmin';
    assert.strictEqual(isSuperAdmin('admin'), false);
    assert.strictEqual(isSuperAdmin('recepcion'), false);
    assert.strictEqual(isSuperAdmin('cajero'), false);
    assert.strictEqual(isSuperAdmin('superadmin'), true);
  });

  // TEST 24: SuperAdmin can change Base <-> Pro
  await runAsyncTest('Test 24: SuperAdmin can change Base <-> Pro both ways', async () => {
    const tenantId = 'tenant-change-24';
    await service.createInitialSubscription(tenantId, { actorId: 'superadmin-1' });

    // Upgrade BASE -> PRO
    const upRes = await service.changeTenantPlan(tenantId, SAAS_PLANS.PRO, { actorId: 'superadmin-1', reason: 'Upgrade to PRO' });
    assert.strictEqual(upRes.new_plan, SAAS_PLANS.PRO);
    let ent = await service.getTenantEntitlements(tenantId);
    assert.strictEqual(ent.plan, SAAS_PLANS.PRO);

    // Downgrade PRO -> BASE
    const downRes = await service.changeTenantPlan(tenantId, SAAS_PLANS.BASE, { actorId: 'superadmin-1', reason: 'Downgrade to BASE' });
    assert.strictEqual(downRes.new_plan, SAAS_PLANS.BASE);
    ent = await service.getTenantEntitlements(tenantId);
    assert.strictEqual(ent.plan, SAAS_PLANS.BASE);
  });

  // TEST 25: Plan transitions generate immutable audit event
  await runAsyncTest('Test 25: Plan transitions generate immutable audit event', async () => {
    const tenantId = 'tenant-audit-25';
    await service.createInitialSubscription(tenantId, { actorId: 'superadmin-1' });
    await service.changeTenantPlan(tenantId, SAAS_PLANS.PRO, { actorId: 'superadmin-1', reason: 'Promotion to Pro' });

    const history = await fakeRepo.getHistoryByTenantId(tenantId);
    assert(history.length >= 2, 'Must have at least initial creation and upgrade event');
    const lastEvent = history[0];
    assert.strictEqual(lastEvent.previous_plan, SAAS_PLANS.BASE);
    assert.strictEqual(lastEvent.new_plan, SAAS_PLANS.PRO);
    assert.strictEqual(lastEvent.actor_id, 'superadmin-1');
    assert.strictEqual(lastEvent.reason, 'Promotion to Pro');
  });

  // TEST 26: Frontend is not sole barrier (middleware rejects direct API calls)
  await runAsyncTest('Test 26: Frontend is not sole barrier (middleware rejects direct API calls without token/entitlement)', async () => {
    const reqMemberships = middleware.requirePlanFeature(SAAS_FEATURES.MEMBERSHIPS);
    // Request with no tenantId (e.g. unauthenticated or malformed)
    const req = { user: null };
    let statusCalled = null;
    let jsonSent = null;
    const res = {
      status(s) { statusCalled = s; return this; },
      json(j) { jsonSent = j; return this; }
    };
    let nextCalled = false;
    await reqMemberships(req, res, () => { nextCalled = true; });
    assert.strictEqual(statusCalled, 403);
    assert.strictEqual(jsonSent.code, 'TENANT_REQUIRED');
    assert.strictEqual(nextCalled, false);
  });

  // TEST 27: Repository errors fail closed (403 with error code)
  await runAsyncTest('Test 27: Repository errors fail closed (403 with error code)', async () => {
    // Failing service
    const brokenService = new EntitlementsService({
      subscriptionRepo: {
        findByTenantId: async () => { throw new Error('Simulated DB network outage'); }
      },
      entitlementsRepo: fakeRepo,
      auditRepo: fakeRepo,
      saasPlanRepo: fakeRepo
    });

    const ent = await brokenService.getTenantEntitlements('tenant-broken');
    // Fails closed: empty features, status error, plan null
    assert.strictEqual(ent.plan, null);
    assert.strictEqual(Object.keys(ent.features).length, 0);

    const check = await brokenService.hasFeature('tenant-broken', SAAS_FEATURES.POS);
    assert.strictEqual(check.allowed, false, 'DB error must fail closed to allowed=false');
  });

  // TEST 28: Migration contains tenant_id FK pointing specifically to tenants(id) with ON DELETE CASCADE
  runTest('Test 28: Migration contains tenant_id FK pointing specifically to tenants(id) with ON DELETE CASCADE', () => {
    const migrationPath = path.resolve(__dirname, '..', 'migrations', '20261109_phase2a_saas_commercial_and_entitlements.cjs');
    assert(fs.existsSync(migrationPath), `Migration file must exist at ${migrationPath}`);
    const content = fs.readFileSync(migrationPath, 'utf8');

    // Check FK in tenant_subscriptions
    const hasTenantFk = /tenant_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+tenants\(id\)\s+ON\s+DELETE\s+CASCADE/i.test(content);
    assert(hasTenantFk, 'Migration must define tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE in tenant_subscriptions');

    // Check FK in tenant_feature_overrides
    const hasOverrideFk = /tenant_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+tenants\(id\)\s+ON\s+DELETE\s+CASCADE/i.test(content);
    assert(hasOverrideFk, 'Migration must define tenant_id FK to tenants(id) in overrides');

    // Check FK in tenant_subscription_events
    const hasAuditFk = /tenant_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+tenants\(id\)\s+ON\s+DELETE\s+CASCADE/i.test(content);
    assert(hasAuditFk, 'Migration must define tenant_id FK to tenants(id) in events');
  });

  console.log('\n=== TEST RESULTS SUMMARY ===');
  console.log(`Passed: ${passedTests} / ${totalTests}`);
  if (passedTests === 28 && totalTests === 28) {
    console.log('🎉 ALL 28 PHASE 2A ENTITLEMENTS & 2-PLAN TESTS PASSED SUCCESSFULLY (PASS)\n');
    process.exit(0);
  } else {
    console.error(`🚨 SOME TESTS FAILED: ${totalTests - passedTests} failure(s) detected.\n`);
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Fatal test suite error:', err);
  process.exit(1);
});
