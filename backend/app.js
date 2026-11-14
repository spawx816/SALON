/**
 * Application Composition Root (backend/app.js)
 * Encapsulates Express setup, middleware pipeline, dependency wiring, and route mounting.
 * ZERO connection to PostgreSQL: DB pool must be injected via createApp({ pool, ... }).
 */

const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const fs = require('fs');

// BigInt JSON serialization support across Express
BigInt.prototype.toJSON = function () {
  return this.toString();
};

let QRCode = null;
try {
  QRCode = require('qrcode');
} catch (e) {
  // qrcode optional in test environment
}

// Modular Routers & Services
const { dgiiReceptionRouter } = require('./dgii_reception_router');
const { createDgiiService } = require('./services/dgii.service');
const { createDashboardRouter } = require('./routes/dashboard.routes');
const { createSecurityRouter } = require('./routes/security.routes');
const { createPayrollRouter } = require('./routes/payroll.routes');
const { createHolidaysRouter } = require('./routes/holidays.routes');
const { createContactRouter } = require('./routes/contact.routes');
const { createServicesRouter } = require('./routes/services.routes');
const { createCommissionsRouter } = require('./routes/commissions.routes');
const { createMarketingRouter } = require('./routes/marketing.routes');
const { createAttendanceRouter } = require('./routes/attendance.routes');
const { createDgiiRouter } = require('./routes/dgii.routes');
const { createDgii606Router } = require('./routes/dgii_606.routes');
const createExpensesRouter = require('./routes/expenses.routes');
const { createEmployeeSecurityRouter } = require('./routes/employee_security.routes');
const { createGiftsSurveysRouter, sendSurveyEmail: sendSurveyEmailHelper } = require('./routes/gifts_surveys.routes');
const { createCardnetRouter } = require('./routes/cardnet.routes');
const { createPaymentsRouter } = require('./routes/payments.routes');
const { createCashRegistersRouter } = require('./routes/cash_registers.routes');
const { createSalonsRouter } = require('./routes/salons.routes');
const { createClientsRouter } = require('./routes/clients.routes');
const { createVisitsRouter } = require('./routes/visits.routes');
const { createContractsRouter } = require('./routes/contracts.routes');
const { createPlansRouter } = require('./routes/plans.routes');
const { createEmployeesRouter } = require('./routes/employees.routes');
const { createReportsRouter } = require('./routes/reports.routes');
const { createAppointmentsRouter } = require('./routes/appointments.routes');
const { createSettingsRouter } = require('./routes/settings.routes');
const { createAuthRouter } = require('./routes/auth.routes');
const { createInvoicesRouter } = require('./routes/invoices.routes');
const { createTestRouter } = require('./routes/test.routes');
const { createSaasRouter } = require('./routes/saas.routes');
const { createTenantRouter } = require('./routes/tenant.routes');
const { createPublicRouter } = require('./routes/public.routes');
const { createFilesRouter } = require('./routes/files.routes');
const { createPrivateFilesRoutes } = require('./routes/private_files.routes');
const { createTenantPortabilityRoutes } = require('./routes/tenant_portability.routes');
const { createInventoryRouter } = require('./routes/inventory.routes');
const { InventoryRepository } = require('./repositories/inventory.repository');
const { InventoryPurchaseRepository } = require('./repositories/inventory_purchase.repository');
const { InventoryTransferRepository } = require('./repositories/inventory_transfer.repository');
const { InventoryService } = require('./services/inventory.service');
const { InventoryPurchaseService } = require('./services/inventory_purchase.service');
const { InventoryTransferService } = require('./services/inventory_transfer.service');
const { InventoryPhysicalSessionService } = require('./services/inventory_physical_session.service');
const { SaasPlanRepository } = require('./repositories/saas_plan.repository');
const { TenantSubscriptionRepository } = require('./repositories/tenant_subscription.repository');
const { EntitlementsRepository } = require('./repositories/entitlements.repository');
const { SubscriptionAuditRepository } = require('./repositories/subscription_audit.repository');
const { EntitlementsService } = require('./services/entitlements.service');
const { createEntitlementsMiddleware } = require('./middleware/entitlements.middleware');
const { createSaasBillingRouter } = require('./routes/saas_billing.routes');
const { InMemorySaasBillingRepository } = require('./repositories/fakes/in_memory_saas_billing.repository');
const { FakePaymentGatewayAdapter } = require('./services/fakes/fake_payment_gateway.adapter');
const { SubscriptionLifecycleService } = require('./services/subscription_lifecycle.service');
const { SaasBillingService } = require('./services/saas_billing.service');
const { ZeroTaxPolicy } = require('./services/tax_policy');
const { createAuthMiddleware } = require('./middleware/auth.middleware');
const { TenantBrandingRepository, InMemoryTenantBrandingRepository } = require('./repositories/tenant_branding.repository');
const { TenantBrandingService } = require('./services/tenant_branding.service');
const { logger } = require('./utils/logger');

/**
 * Creates and configures the Express application with all middlewares, routes, and services.
 * @param {Object} [dependencies] - Injected dependencies
 * @param {Object} [dependencies.pool] - Database pool (real or in-memory mock)
 * @param {Object} [dependencies.repositories] - Repositories map
 * @param {Object} [dependencies.services] - Services map
 * @param {Object} [dependencies.paymentGateway] - Payment gateway port adapter
 * @param {Object} [dependencies.billingScheduler] - Billing job scheduler port adapter
 * @param {Object} [dependencies.taxPolicy] - Tax policy implementation
 * @param {Function} [dependencies.clock] - Clock supplier function
 * @param {Function} [dependencies.idGenerator] - ID generator function
 * @returns {express.Application} Configured Express app
 */
function createApp(dependencies = {}) {
  let pool = dependencies.pool || dependencies.repositories?.pool || dependencies.repositories?.dbMock;
  if (!pool) {
    const { InMemoryDbMock } = require('./tests/helpers/in_memory_db_mock.cjs');
    pool = new InMemoryDbMock();
  }

  const clock = dependencies.clock || (() => new Date());
  const idGenerator = dependencies.idGenerator || (() => crypto.randomUUID());

  const app = express();
  app.set('trust proxy', 1);

  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://planbeautyrd.com', 'https://www.planbeautyrd.com'];

  // CORS
  app.use(cors({
    origin: (origin, callback) => {
      const isProductionOrStaging = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
      if (!origin || allowedOrigins.includes(origin) || !isProductionOrStaging) {
        callback(null, true);
      } else {
        callback(new Error('Acceso no permitido por política CORS'));
      }
    },
    credentials: true
  }));

  app.use(cookieParser());
  app.use(logger.middleware());

  // Test endpoints guard (FAIL CLOSED)
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/test')) {
      if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging' || process.env.ENABLE_TEST_ENDPOINTS !== 'true') {
        return res.status(403).json({ error: 'Endpoints de prueba deshabilitados por política de seguridad.' });
      }
    }
    next();
  });

  // RBAC Anti-Tampering Security Shield
  const ADMIN_PROTECTED_ROUTES = [
    '/api/payroll',
    '/api/security',
    '/api/users',
    '/api/roles',
    '/api/rrhh',
    '/api/dgii-sequences',
    '/api/credit-notes',
    '/api/reports/607',
    '/api/email-settings'
  ];

  app.use((req, res, next) => {
    const isProtected = ADMIN_PROTECTED_ROUTES.some(route => req.path.startsWith(route));
    if (isProtected) {
      const userRole = req.headers['x-user-role'];
      if (userRole && (userRole.toLowerCase() === 'client' || userRole.toLowerCase() === 'cliente')) {
        const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || req.ip || '127.0.0.1';
        console.warn(`[SECURITY ALERT] Intento no autorizado bloqueado desde IP ${clientIp} con rol cliente intentando acceder a ${req.method} ${req.path}`);
        return res.status(403).json({ error: 'Acceso estrictamente denegado: Esta operación requiere privilegios de administración del sistema.' });
      }
    }
    next();
  });

  // Raw body handler for DGII e-CF reception endpoints
  app.use(['/fe', '/api/fe'], (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return next();
    }
    let chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const rawBuffer = Buffer.concat(chunks);
      req.rawBody = rawBuffer.toString('utf8');
      if (!req.body || (typeof req.body === 'object' && Object.keys(req.body).length === 0)) {
        req.body = req.rawBody;
      }
      next();
    });
  });

  app.use(express.json({
    limit: '50mb',
    verify: (req, res, buf) => {
      req.rawBody = buf.toString('utf8');
    }
  }));
  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      console.warn(`[BAD JSON BODY] Ignorado de ${req.ip} en ${req.method} ${req.url}: ${err.message}`);
      return res.status(400).json({ error: 'Cuerpo de solicitud JSON malformado o inválido.' });
    }
    next(err);
  });
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));
  // REMOVED (TENANT-001): app.use('/uploads', express.static(...)) - Public static access abolished
  app.use(express.static(path.join(__dirname, 'public')));

  // Cron endpoints guard (FAIL CLOSED with Anti-Replay HMAC verification)
  const { createJobHmacAuthMiddleware } = require('./middleware/job_hmac_auth.middleware.cjs');
  const jobHmacAuth = createJobHmacAuthMiddleware(pool);

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/cron') || req.path === '/api/marketing/send-daily-birthdays') {
      return jobHmacAuth(req, res, next);
    }
    next();
  });

  // Health & Status check endpoints
  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  app.get('/api/health/db-check', async (req, res) => {
    if (process.env.NODE_ENV !== 'test' || process.env.ENABLE_TEST_ENDPOINTS !== 'true') {
      return res.status(404).json({ error: 'Not Found' });
    }
    try {
      const [rows] = await pool.query('SELECT current_database() as db_name, current_user as user_name');
      const currentDb = rows[0]?.db_name || null;
      const currentUser = rows[0]?.user_name || null;
      res.status(200).json({
        status: 'ok',
        database: currentDb,
        user: currentUser,
        test_db_name: process.env.TEST_DB_NAME || null,
        test_db_user: process.env.TEST_DB_USER || null,
        is_test_env: true
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/ping', (req, res) => {
    res.status(200).send('pong');
  });

  app.get('/api/status', (req, res) => {
    res.json({
      status: 'online',
      version: '1.2.0',
      environment: process.env.CARDNET_ENV || 'DEVELOPMENT',
      database: 'connected',
      timezone: '-04:00',
      currentTime: new Date().toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' })
    });
  });

  // DGII Reception Router
  if (dgiiReceptionRouter) {
    app.use('/fe', dgiiReceptionRouter);
    app.use('/api/fe', dgiiReceptionRouter);
  }

  // Canonical Redirects (production only)
  app.use((req, res, next) => {
    const host = req.get('host');
    if (!host) return next();

    const isProduction = host.includes('planbeautyrd.com');
    const isWww = host.startsWith('www.');
    const forwardedProto = req.headers['x-forwarded-proto'];

    if (isProduction) {
      if (isWww) {
        const cleanHost = host.replace(/^www\./, '');
        return res.redirect(301, `https://${cleanHost}${req.originalUrl}`);
      }
      if (forwardedProto === 'http') {
        return res.redirect(301, `https://${host}${req.originalUrl}`);
      }
    }
    next();
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(express.static(path.join(__dirname, '..', 'dist')));

  // CardNet Configuration
  const CARDNET_CONFIG = dependencies.cardnetConfig || {
    MERCHANT_NUMBER: process.env.CARDNET_MERCHANT_NUMBER,
    TERMINAL_ID: process.env.CARDNET_TERMINAL_ID,
    BASE_URL: process.env.CARDNET_BASE_URL,
    PUBLIC_KEY: process.env.CARDNET_PUBLIC_KEY,
    PRIVATE_KEY: process.env.CARDNET_PRIVATE_KEY,
    ENV: process.env.CARDNET_ENV,
    TIMEOUT: parseInt(process.env.CARDNET_TIMEOUT) || 30000
  };

  const getCardNetAuthHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Basic ${CARDNET_CONFIG.PRIVATE_KEY}`
  });

  // Initialize DGII Service with DB pool
  const dgiiService = dependencies.services?.dgiiService || createDgiiService(pool);

  // Security Headers
  app.use((req, res, next) => {
    // HSTS is strictly centralized at Edge reverse proxy (Caddy) to prevent conflicting policies
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), interest-cohort=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://servicios.cardnet.com.do https://labservicios.cardnet.com.do; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: *; frame-src 'self' https://servicios.cardnet.com.do https://labservicios.cardnet.com.do; connect-src 'self' https://servicios.cardnet.com.do https://labservicios.cardnet.com.do;");
    next();
  });

  // CSRF / Origin Validation for Mutating Requests (REM-P1-02)
  app.use((req, res, next) => {
    const mutatingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
    if (!mutatingMethods.includes(req.method)) return next();

    // Whitelist internal/cron/webhook endpoints
    if (
      req.path.startsWith('/api/cron') ||
      req.path === '/api/marketing/send-daily-birthdays' ||
      req.path.startsWith('/api/test') ||
      req.path.startsWith('/api/saas/billing/webhooks')
    ) {
      return next();
    }

    const originHeader = req.headers['origin'];
    let originToCheck = originHeader;
    if (!originToCheck && req.headers['referer']) {
      try {
        const parsed = new URL(req.headers['referer']);
        originToCheck = parsed.origin;
      } catch {
        return res.status(403).json({ error: 'Referer inválido en protección CSRF.', code: 'CSRF_REFERER_INVALID' });
      }
    }

    const hasCookieAuth = Boolean((req.cookies && req.cookies.auth_token) || (req.headers.cookie && req.headers.cookie.includes('auth_token=')));
    const hasBearerAuth = Boolean(req.headers['authorization'] && req.headers['authorization'].toLowerCase().startsWith('bearer '));

    // Si la solicitud depende de cookies (o si trae origin/referer explícito), se exige verificación estricta de origen
    if (hasCookieAuth && !hasBearerAuth && !originToCheck) {
      return res.status(403).json({
        error: 'Petición rechazada: Se requiere cabecera Origin o Referer válida para solicitudes mutantes basadas en cookies.',
        code: 'CSRF_ORIGIN_REQUIRED'
      });
    }

    if (originToCheck) {
      const isLoopback = originToCheck.startsWith('http://127.0.0.1:') || originToCheck.startsWith('http://localhost:');
      const isDev = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'staging';
      const isAllowed = (isDev && isLoopback) || allowedOrigins.some(ao => originToCheck.toLowerCase() === ao.toLowerCase());
      if (!isAllowed) {
        return res.status(403).json({ error: 'Origen no autorizado por política de protección CSRF.', code: 'CSRF_ORIGIN_DENIED' });
      }
    }
    next();
  });

  // Email helpers
  const sendPaymentReceiptEmail = dependencies.sendPaymentReceiptEmail || (async () => {});
  const sendPaymentFailedEmail = dependencies.sendPaymentFailedEmail || (async () => {});
  const sendSurveyEmail = dependencies.sendSurveyEmail || ((p, clientId, name, email, tenantId) => sendSurveyEmailHelper(p || pool, clientId, name, email, tenantId));

  // Authentication & Multi-Tenant Isolation Shield
  const {
    authenticate,
    rejectControlPlaneRoleOnTenantRoutes,
    requireControlPlaneRole,
    rejectClientRoleOnStaffRoutes
  } = createAuthMiddleware(pool);

  const isPublicApiRoute = (req) => {
    if (req.method === 'OPTIONS') return true;

    const pathUrl = (req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '') || '/';
    const method = req.method.toUpperCase();

    // 1. Health & status checks
    if (pathUrl === '/api/health' || pathUrl === '/api/health/db-check' || pathUrl === '/api/ping' || pathUrl === '/api/status') return true;

    // 2. Authentication & Account Recovery routes
    if (
      pathUrl === '/api/login' || pathUrl === '/api/auth/login' ||
      pathUrl === '/api/client-login' || pathUrl === '/api/auth/client-login' ||
      pathUrl === '/api/forgot-password' || pathUrl === '/api/auth/forgot-password' ||
      pathUrl === '/api/verify-code' || pathUrl === '/api/auth/verify-code' ||
      pathUrl === '/api/reset-password' || pathUrl === '/api/auth/reset-password' ||
      pathUrl === '/api/activate' || pathUrl === '/api/auth/activate' ||
      pathUrl === '/api/users/verify'
    ) return true;

    // 3. Public DGII electronic invoicing reception
    if (pathUrl.startsWith('/fe') || pathUrl.startsWith('/api/fe')) return true;

    // 4. Public SaaS plans listing
    if (method === 'GET' && pathUrl === '/api/saas/plans') return true;

    // 5. Public Onboarding tenant registration & safe visual branding
    if (method === 'POST' && pathUrl === '/api/public/onboarding') return true;
    if (method === 'GET' && pathUrl.startsWith('/api/public/branding')) return true;

    // 6. Public SaaS billing webhooks (HMAC authenticated)
    if (pathUrl.startsWith('/api/saas/billing/webhooks')) return true;

    // 7. Public Contact messages (REM-P1-04: Only POST /api/contact is public)
    if (method === 'POST' && pathUrl === '/api/contact') return true;

    // 8. Public Client Survey Submission
    if (method === 'POST' && pathUrl === '/api/surveys') return true;
    if (method === 'GET' && /^\/api\/surveys\/pending\/[^/]+$/i.test(pathUrl)) return true;

    // 9. Cron / background tasks
    if (pathUrl.startsWith('/api/cron') || pathUrl === '/api/marketing/send-daily-birthdays') return true;

    // 10. Test routes en desarrollo
    if (pathUrl.startsWith('/api/test')) return true;

    // 11. Public Demo mode status
    if (pathUrl.startsWith('/api/demo')) return true;

    return false;
  };

  app.use('/api', (req, res, next) => {
    if (isPublicApiRoute(req)) {
      return next();
    }
    return authenticate(req, res, next);
  });

  // Repositories & Services Setup (Phase 2A, 2B, 2D)
  const repos = dependencies.repositories || {};
  const srvs = dependencies.services || {};

  const saasPlanRepo = repos.saasPlanRepo || new SaasPlanRepository(pool);
  const subscriptionRepo = repos.subscriptionRepo || new TenantSubscriptionRepository(pool);
  const entitlementsRepo = repos.entitlementsRepo || new EntitlementsRepository(pool);
  const auditRepo = repos.auditRepo || new SubscriptionAuditRepository(pool);

  const entitlementsService = srvs.entitlementsService || new EntitlementsService({
    saasPlanRepo,
    subscriptionRepo,
    entitlementsRepo,
    auditRepo,
    clock: dependencies.clock
  });

  const { requirePlanFeature, requireTenantLimit } = createEntitlementsMiddleware(entitlementsService);

  const inventoryRepo = repos.inventoryRepo || new InventoryRepository(pool);
  const inventoryPurchaseRepo = repos.inventoryPurchaseRepo || new InventoryPurchaseRepository(pool);
  const inventoryTransferRepo = repos.inventoryTransferRepo || new InventoryTransferRepository(pool);

  const inventoryService = srvs.inventoryService || new InventoryService({
    inventoryRepo,
    purchaseRepo: inventoryPurchaseRepo,
    transferRepo: inventoryTransferRepo
  });

  const inventoryPurchaseService = srvs.inventoryPurchaseService || new InventoryPurchaseService({
    purchaseRepo: inventoryPurchaseRepo,
    inventoryRepo
  });

  const inventoryTransferService = srvs.inventoryTransferService || new InventoryTransferService({
    transferRepo: inventoryTransferRepo,
    inventoryRepo
  });

  const saasBillingRepo = repos.saasBillingRepo || new InMemorySaasBillingRepository();
  const paymentGateway = dependencies.paymentGateway || new FakePaymentGatewayAdapter();

  const saasLifecycleService = srvs.saasLifecycleService || new SubscriptionLifecycleService({
    subscriptionRepo,
    entitlementsRepo,
    billingRepo: saasBillingRepo,
    auditRepo,
    clock: dependencies.clock
  });

  const saasBillingService = srvs.saasBillingService || new SaasBillingService({
    billingRepo: saasBillingRepo,
    subscriptionRepo,
    gatewayPort: paymentGateway,
    lifecycleService: saasLifecycleService,
    taxPolicy: dependencies.taxPolicy || new ZeroTaxPolicy(),
    clock: dependencies.clock
  });

  const isInMemoryDb = !pool || pool.isInMemory || pool.constructor?.name === 'InMemoryDbMock' || process.env.NODE_ENV === 'demo';
  const tenantBrandingRepo = repos.tenantBrandingRepo || (
    isInMemoryDb
      ? new InMemoryTenantBrandingRepository()
      : new TenantBrandingRepository(pool)
  );

  const tenantBrandingService = srvs.tenantBrandingService || new TenantBrandingService({
    repository: tenantBrandingRepo
  });

  // Mount Modular Routers
  app.use('/api/saas/billing', createSaasBillingRouter({
    billingService: saasBillingService,
    lifecycleService: saasLifecycleService,
    billingRepo: saasBillingRepo,
    pool
  }));

  app.use('/api/security', rejectClientRoleOnStaffRoutes, createSecurityRouter(pool));
  app.use('/api/salons', rejectControlPlaneRoleOnTenantRoutes, createSalonsRouter(pool, { entitlementsService }));
  app.use('/api/clients', rejectControlPlaneRoleOnTenantRoutes, requirePlanFeature('clients'), createClientsRouter(pool, { CARDNET_CONFIG, getCardNetAuthHeaders, entitlementsService }));
  app.use('/api/inventory', rejectControlPlaneRoleOnTenantRoutes, rejectClientRoleOnStaffRoutes, createInventoryRouter({
    inventoryService,
    purchaseService: inventoryPurchaseService,
    transferService: inventoryTransferService,
    physicalSessionService: new InventoryPhysicalSessionService(pool),
    requirePlanFeature
  }));
  app.use('/api/cash-registers', rejectControlPlaneRoleOnTenantRoutes, rejectClientRoleOnStaffRoutes, createCashRegistersRouter(pool));
  app.use('/api/dashboard', rejectControlPlaneRoleOnTenantRoutes, createDashboardRouter(pool));
  app.use('/api/payments', rejectControlPlaneRoleOnTenantRoutes, requirePlanFeature('memberships'), createPaymentsRouter(pool, { sendPaymentReceiptEmail }));
  app.use('/api/plans', rejectControlPlaneRoleOnTenantRoutes, requirePlanFeature('memberships'), createPlansRouter(pool));
  app.use('/api/reports', rejectControlPlaneRoleOnTenantRoutes, createReportsRouter(pool));
  app.use('/api/appointments', rejectControlPlaneRoleOnTenantRoutes, createAppointmentsRouter(pool));
  app.use('/api/settings', rejectControlPlaneRoleOnTenantRoutes, rejectClientRoleOnStaffRoutes, createSettingsRouter(pool));
  // Marketing es exclusivo de PRO. Se exentan únicamente el job HMAC programado (sin sesión de tenant)
  // y el pixel público de apertura de correo, que no operan con sesión autenticada de salón.
  const requireMarketingFeature = requirePlanFeature('marketing');
  const marketingPlanGuard = (req, res, next) => {
    if (req.path === '/send-daily-birthdays' || req.path.startsWith('/track-open/')) return next();
    return requireMarketingFeature(req, res, next);
  };
  app.use('/api/marketing', rejectControlPlaneRoleOnTenantRoutes, rejectClientRoleOnStaffRoutes, marketingPlanGuard, createMarketingRouter(pool));
  app.use('/api/holidays', rejectControlPlaneRoleOnTenantRoutes, createHolidaysRouter(pool));
  app.use('/api/payroll', rejectControlPlaneRoleOnTenantRoutes, rejectClientRoleOnStaffRoutes, createPayrollRouter(pool));
  app.use('/api/services', rejectControlPlaneRoleOnTenantRoutes, createServicesRouter(pool));
  app.use('/api/employee-security', rejectControlPlaneRoleOnTenantRoutes, rejectClientRoleOnStaffRoutes, createEmployeeSecurityRouter(pool));
  const giftsSurveysRouter = createGiftsSurveysRouter(pool);
  app.use(['/api/gifts', '/api/admin/gifts', '/api/surveys'], rejectControlPlaneRoleOnTenantRoutes);
  app.use('/api', giftsSurveysRouter);
  app.use('/api/employees', rejectControlPlaneRoleOnTenantRoutes, rejectClientRoleOnStaffRoutes, createEmployeesRouter(pool));

  const { router: visitsRouter, processVisitCommissions, processBatchVisitCommissions } = createVisitsRouter(pool, {
    transmitInvoiceDirectlyToDgii: dgiiService.transmitInvoiceDirectlyToDgii,
    generateAndTransmitNotaCredito: dgiiService.generateAndTransmitNotaCredito,
    sendSurveyEmail,
    inventoryService
  });
  app.use('/api/visits', rejectControlPlaneRoleOnTenantRoutes, visitsRouter);

  app.use('/api/commissions', rejectControlPlaneRoleOnTenantRoutes, rejectClientRoleOnStaffRoutes, createCommissionsRouter(pool, processVisitCommissions, processBatchVisitCommissions));

  const contractsRouterInstance = createContractsRouter(pool, {
    CARDNET_CONFIG,
    getCardNetAuthHeaders,
    sendPaymentReceiptEmail,
    sendPaymentFailedEmail
  });
  app.use('/api/contracts', rejectControlPlaneRoleOnTenantRoutes, requirePlanFeature('memberships'), contractsRouterInstance);

  app.use('/api/cardnet', rejectControlPlaneRoleOnTenantRoutes, createCardnetRouter(pool, {
    CARDNET_CONFIG,
    getCardNetAuthHeaders,
    sendPaymentReceiptEmail,
    dgiiService
  }));

  const dgiiRouterInstance = createDgiiRouter(pool, {
    allocateNextDgiiSequence: dgiiService.allocateNextDgiiSequence,
    buildAndSignNotaCreditoXml: dgiiService.buildAndSignNotaCreditoXml,
    generateAndTransmitNotaCredito: dgiiService.generateAndTransmitNotaCredito
  });
  app.use('/api/dgii', rejectControlPlaneRoleOnTenantRoutes, rejectClientRoleOnStaffRoutes, dgiiRouterInstance);

  const dgii606Router = createDgii606Router(pool);
  app.use('/api/dgii/report-606', rejectControlPlaneRoleOnTenantRoutes, rejectClientRoleOnStaffRoutes, dgii606Router);
  app.use('/api/dgii-606', rejectControlPlaneRoleOnTenantRoutes, rejectClientRoleOnStaffRoutes, dgii606Router);

  const expensesRouter = createExpensesRouter(pool);
  app.use('/api/expenses', rejectControlPlaneRoleOnTenantRoutes, rejectClientRoleOnStaffRoutes, expensesRouter);

  const { router: invoicesRouter } = createInvoicesRouter(pool);
  app.use('/api/invoices', rejectControlPlaneRoleOnTenantRoutes, invoicesRouter);

  const { router: authRouter } = createAuthRouter(pool, { sendSurveyEmail, entitlementsService });
  app.use('/api', authRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/public', createPublicRouter(pool, { tenantBrandingService }));
  app.get('/api/demo/status', (req, res) => {
    const isDemo = process.env.NODE_ENV === 'demo';
    res.json({
      isDemo,
      banner: isDemo ? 'DEMO LOCAL — DATOS NO PERSISTENTES' : null,
      environment: process.env.NODE_ENV || 'production'
    });
  });
  app.use('/api/saas', createSaasRouter(pool, { entitlementsService }));
  app.use('/api/tenant', rejectControlPlaneRoleOnTenantRoutes, rejectClientRoleOnStaffRoutes, createTenantRouter(pool, { entitlementsService, tenantBrandingService }));
  app.use('/api/tenant/files', rejectControlPlaneRoleOnTenantRoutes, rejectClientRoleOnStaffRoutes, createFilesRouter(pool));
  app.use('/api/tenant', rejectControlPlaneRoleOnTenantRoutes, createPrivateFilesRoutes({ pool, authMiddleware: authenticate }));
  app.use('/api/tenant', rejectControlPlaneRoleOnTenantRoutes, createTenantPortabilityRoutes({ pool, authMiddleware: authenticate }));

  const contactRouter = createContactRouter(pool);
  app.use('/api/contact', contactRouter);
  app.use('/api/contact-messages', authenticate, requireControlPlaneRole, async (req, res) => {
    try {
      const [rows] = await pool.query('SELECT * FROM contact_messages ORDER BY id DESC LIMIT 100');
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  const attendanceRouter = createAttendanceRouter(pool);
  app.use('/api/attendance', rejectControlPlaneRoleOnTenantRoutes, rejectClientRoleOnStaffRoutes, attendanceRouter);

  app.use('/api/test', createTestRouter(pool, { CARDNET_CONFIG, getCardNetAuthHeaders }));

  // Global Error Handler & 500 Sanitization Shield (REM-P1-13)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const errorId = crypto.randomUUID ? crypto.randomUUID() : `err_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const tenantId = req.tenantId || req.auth?.tenantId || null;
    const userId = req.auth?.id || req.auth?.userId || null;

    console.error(`[INTERNAL ERROR ${errorId}] Path: ${req.method} ${req.originalUrl || req.url} | Tenant: ${tenantId} | User: ${userId}`, err);

    if (res.headersSent) {
      return;
    }

    const statusCode = (typeof err.status === 'number' && err.status >= 400 && err.status < 600)
      ? err.status
      : (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600)
        ? err.statusCode
        : 500;

    const isClientError = statusCode < 500;
    const sanitizedMessage = isClientError
      ? (err.message || 'Solicitud inválida.')
      : 'Ocurrió un error interno en el servidor.';

    return res.status(statusCode).json({
      success: false,
      error: sanitizedMessage,
      error_id: errorId,
      code: err.code || (isClientError ? 'CLIENT_ERROR' : 'INTERNAL_SERVER_ERROR')
    });
  });

  // Expose wired services on app for tests / reflection if needed
  app.locals = {
    ...app.locals,
    pool,
    entitlementsService,
    inventoryService,
    saasBillingService,
    saasLifecycleService,
    saasBillingRepo,
    paymentGateway,
    subscriptionRepo,
    entitlementsRepo
  };

  return app;
}

module.exports = {
  createApp
};
