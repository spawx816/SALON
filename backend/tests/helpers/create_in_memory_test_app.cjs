/**
 * In-Memory HTTP Test App Harness (create_in_memory_test_app.cjs)
 * Spins up an Express application over an ephemeral TCP port using pure in-memory mocks and fakes.
 * GUARANTEES ZERO POSTGRESQL IMPORT OR CONNECTIONS.
 */

'use strict';

const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Ensure JWT_SECRET is configured for test tokens
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET = 'super-secret-test-jwt-token-at-least-32-chars-long';
}
if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') {
  process.env.NODE_ENV = 'test';
}
process.env.ENABLE_TEST_ENDPOINTS = 'true';

const { InMemoryDbMock } = require('./in_memory_db_mock.cjs');
const { InMemoryInventoryRepository } = require('../../repositories/fakes/in_memory_inventory.repository');
const { InMemorySaasRepository } = require('../../repositories/fakes/in_memory_saas.repository');
const { InMemorySaasBillingRepository } = require('../../repositories/fakes/in_memory_saas_billing.repository');
const { FakePaymentGatewayAdapter } = require('../../services/fakes/fake_payment_gateway.adapter');
const { FakeBillingJobSchedulerAdapter } = require('../../services/fakes/fake_billing_job_scheduler.adapter');
const { ZeroTaxPolicy } = require('../../services/tax_policy');
const { createApp } = require('../../app');
const { signAuthToken } = require('../../middleware/auth.middleware');
const { InventoryService } = require('../../services/inventory.service');
const { InventoryPurchaseService } = require('../../services/inventory_purchase.service');
const { InventoryTransferService } = require('../../services/inventory_transfer.service');
const { EntitlementsService } = require('../../services/entitlements.service');
const { SubscriptionLifecycleService } = require('../../services/subscription_lifecycle.service');
const { SaasBillingService } = require('../../services/saas_billing.service');

async function createInMemoryTestApp(options = {}) {
  // Pre-condition security check: backend/db.js must NOT be loaded
  try {
    const dbPath = require.resolve('../../db');
    if (require.cache[dbPath]) {
      throw new Error('FATAL TEST SAFETY ERROR: backend/db.js has been imported into Node require cache!');
    }
  } catch (e) {
    if (e.message.includes('FATAL TEST SAFETY ERROR')) throw e;
  }

  let mockCurrentTime = Date.now();
  const clock = () => new Date(mockCurrentTime);

  const dbMock = new InMemoryDbMock();
  const inventoryRepo = new InMemoryInventoryRepository();
  const saasRepo = new InMemorySaasRepository();
  const saasBillingRepo = new InMemorySaasBillingRepository();
  const paymentGateway = new FakePaymentGatewayAdapter({ clock });
  const billingScheduler = new FakeBillingJobSchedulerAdapter({ clock });
  const taxPolicy = new ZeroTaxPolicy();

  // Bi-directional bridge between dbMock and saasRepo for subscriptions
  const originalFindSub = saasRepo.findByTenantId.bind(saasRepo);
  saasRepo.findByTenantId = async (tenantId) => {
    let sub = await originalFindSub(tenantId);
    if (!sub) {
      const dbSub = dbMock.tables.tenant_subscriptions.find(s => s.tenant_id === String(tenantId));
      if (dbSub) {
        sub = await saasRepo.upsertSubscription(tenantId, {
          plan_code: dbSub.plan_code,
          status: dbSub.status,
          current_period_start: dbSub.current_period_start,
          current_period_end: dbSub.current_period_end,
          grace_period_until: dbSub.grace_period_until,
          cancel_at_period_end: dbSub.cancel_at_period_end
        });
      }
    }
    return sub;
  };

  const originalUpsertSub = saasRepo.upsertSubscription.bind(saasRepo);
  saasRepo.upsertSubscription = async (tenantId, data) => {
    const result = await originalUpsertSub(tenantId, data);
    // Also sync to dbMock
    const existingIdx = dbMock.tables.tenant_subscriptions.findIndex(s => s.tenant_id === String(tenantId));
    if (existingIdx >= 0) {
      Object.assign(dbMock.tables.tenant_subscriptions[existingIdx], result);
    } else {
      dbMock.tables.tenant_subscriptions.push({ ...result });
    }
    return result;
  };

  // Bridge resource usage check in saasRepo to count from dbMock
  saasRepo.countResourceUsage = async (tenantId, resourceKey) => {
    if (resourceKey === 'users') {
      return (dbMock.tables.users || []).filter(u => u.tenant_id === String(tenantId)).length;
    }
    if (resourceKey === 'branches') {
      return (dbMock.tables.branches || []).filter(b => b.tenant_id === String(tenantId)).length;
    }
    return 0;
  };

  // Wire domain services
  const entitlementsService = new EntitlementsService({
    saasPlanRepo: saasRepo,
    subscriptionRepo: saasRepo,
    entitlementsRepo: saasRepo,
    auditRepo: saasRepo,
    clock
  });

  const inventoryService = new InventoryService({
    inventoryRepo,
    purchaseRepo: inventoryRepo,
    transferRepo: inventoryRepo
  });

  const inventoryPurchaseService = new InventoryPurchaseService({
    purchaseRepo: inventoryRepo,
    inventoryRepo
  });

  const inventoryTransferService = new InventoryTransferService({
    transferRepo: inventoryRepo,
    inventoryRepo
  });

  const lifecycleService = new SubscriptionLifecycleService({
    subscriptionRepo: saasRepo,
    entitlementsRepo: saasRepo,
    billingRepo: saasBillingRepo,
    auditRepo: saasRepo,
    clock
  });

  const billingService = new SaasBillingService({
    billingRepo: saasBillingRepo,
    subscriptionRepo: saasRepo,
    gatewayPort: paymentGateway,
    lifecycleService,
    taxPolicy,
    clock
  });

  // Create Express App using dependency injection signature
  const app = createApp({
    repositories: {
      pool: dbMock,
      saasPlanRepo: saasRepo,
      subscriptionRepo: saasRepo,
      entitlementsRepo: saasRepo,
      auditRepo: saasRepo,
      inventoryRepo,
      inventoryPurchaseRepo: inventoryRepo,
      inventoryTransferRepo: inventoryRepo,
      saasBillingRepo
    },
    paymentGateway,
    billingScheduler,
    clock,
    idGenerator: () => crypto.randomUUID(),
    taxPolicy,
    services: {
      entitlementsService,
      inventoryService,
      inventoryPurchaseService,
      inventoryTransferService,
      saasLifecycleService: lifecycleService,
      saasBillingService: billingService
    }
  });

  // Start HTTP server on ephemeral port (0)
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  /**
   * Helper: create a tenant, user, session, and subscription with signed JWT
   */
  async function createTenantWithUser({
    plan = 'BASE',
    email = 'admin@example.com',
    role = 'owner',
    status = 'active',
    businessName = 'Salón de Prueba',
    password = 'Password123!'
  } = {}) {
    const isSuperAdmin = role === 'superadmin';
    const tenantId = isSuperAdmin ? null : crypto.randomUUID();
    const userId = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const sessionId = `ses_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const branchId = isSuperAdmin ? null : crypto.randomUUID();

    if (!isSuperAdmin) {
      // 1. Tenant
      dbMock.tables.tenants.push({
        id: tenantId,
        business_name: businessName,
        slug: businessName.toLowerCase().replace(/\s+/g, '-'),
        plan_id: plan === 'PRO' ? 2 : 1,
        status,
        max_users: plan === 'PRO' ? 25 : 3,
        max_branches: plan === 'PRO' ? 10 : 1,
        created_at: new Date().toISOString()
      });

      // 2. Branch
      dbMock.tables.branches.push({
        id: branchId,
        tenant_id: tenantId,
        name: 'Sucursal Principal',
        is_main: true,
        status: 'Active'
      });

      // 3. Subscription
      await saasRepo.upsertSubscription(tenantId, {
        plan_code: plan,
        status,
        current_period_start: new Date(mockCurrentTime),
        current_period_end: new Date(mockCurrentTime + 30 * 24 * 60 * 60 * 1000)
      });
    }

    // 4. User
    const passwordHash = await bcrypt.hash(password, 10);
    dbMock.tables.users.push({
      id: userId,
      tenant_id: tenantId,
      branch_id: branchId,
      email,
      nombre: isSuperAdmin ? 'Super Administrador' : 'Admin Salón',
      name: isSuperAdmin ? 'Super Administrador' : 'Admin Salón',
      role,
      is_active: true,
      estado: 'Activo',
      password_hash: passwordHash
    });

    // 5. Session
    dbMock.tables.user_sessions.push({
      id: sessionId,
      user_id: userId,
      role,
      tenant_id: tenantId,
      is_active: 1
    });

    // 6. Token
    const token = signAuthToken({
      sub: userId,
      id: userId,
      email,
      name: isSuperAdmin ? 'Super Administrador' : 'Admin Salón',
      role,
      tenantId,
      branchId,
      sessionId,
      isSuperAdmin
    });

    return {
      tenantId,
      userId,
      sessionId,
      branchId,
      token,
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };
  }

  /**
   * Native HTTP client helper
   */
  async function request({ method = 'GET', path: reqPath, headers = {}, body = null }) {
    return new Promise((resolve, reject) => {
      let serializedBody = null;
      const reqHeaders = { ...headers };

      if (body !== null && body !== undefined) {
        if (Buffer.isBuffer(body) || typeof body === 'string') {
          serializedBody = body;
        } else {
          serializedBody = JSON.stringify(body);
          if (!reqHeaders['Content-Type'] && !reqHeaders['content-type']) {
            reqHeaders['Content-Type'] = 'application/json';
          }
        }
        if (!reqHeaders['Content-Length'] && !reqHeaders['content-length']) {
          reqHeaders['Content-Length'] = Buffer.byteLength(serializedBody);
        }
      }

      const req = http.request({
        hostname: '127.0.0.1',
        port,
        method,
        path: reqPath,
        headers: reqHeaders
      }, (res) => {
        let rawData = '';
        res.on('data', chunk => { rawData += chunk; });
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(rawData);
          } catch (e) {
            parsed = rawData;
          }
          resolve({
            status: res.statusCode,
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsed,
            text: rawData
          });
        });
      });

      req.on('error', reject);
      if (serializedBody) {
        req.write(serializedBody);
      }
      req.end();
    });
  }

  function advanceClock(ms) {
    mockCurrentTime += Number(ms);
  }

  async function close() {
    await new Promise(resolve => server.close(resolve));
  }

  return {
    app,
    server,
    port,
    dbMock,
    saasRepo,
    inventoryRepo,
    saasBillingRepo,
    paymentGateway,
    billingScheduler,
    entitlementsService,
    inventoryService,
    lifecycleService,
    billingService,
    createTenantWithUser,
    request,
    advanceClock,
    close
  };
}

module.exports = {
  createInMemoryTestApp
};

