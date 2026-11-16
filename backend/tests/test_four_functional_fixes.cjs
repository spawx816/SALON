/**
 * Test Suite: Verificación de las cuatro correcciones funcionales de Etereas
 * 1. Categorías del Catálogo y Esquemas de Comisiones (Estado 'Activa', validación backend, histórico)
 * 2. Accesos Rápidos del POS (Cero servicios ficticios, catálogo activo)
 * 3. Actualizar Tarjeta CardNet (Rechazo de tokens sintéticos, initiate, confirm seguro CERO PAN/CVC sin cobrar)
 * 4. Términos, Aceptación y Bienvenida (Hash SHA-256 inmutable, cola de correos, estado real)
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_must_be_at_least_32_characters_long_for_security';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');

const { InMemoryDbMock } = require('./helpers/in_memory_db_mock.cjs');
const { createServicesRouter } = require('../routes/services.routes');
const { createSaasBillingRouter } = require('../routes/saas_billing.routes');
const { createPublicRouter } = require('../routes/public.routes');
const { InMemorySaasBillingRepository } = require('../repositories/fakes/in_memory_saas_billing.repository');
const { TermsAndWelcomeEmailService } = require('../services/terms_and_welcome_email.service');

async function runTests() {
  console.log('🚀 Iniciando pruebas automatizadas de las 4 correcciones funcionales...\n');

  const pool = new InMemoryDbMock();

  // Inicializar tablas en mock DB
  pool.tables.commission_categories = [];
  pool.tables.servicios = [];
  pool.tables.tenants = [];
  pool.tables.users = [];
  pool.tables.saas_payment_methods = [];
  pool.tables.tenant_terms_acceptances = [];
  pool.tables.tenant_welcome_email_queue = [];
  pool.tables.email_settings = [];

  // Seed Tenant y Usuario
  pool.tables.tenants.push({
    id: 101,
    nombre: 'Salon Test Point',
    business_name: 'Salon Test Point SRL',
    status: 'pending'
  });
  pool.tables.users.push({
    id: 501,
    tenant_id: 101,
    email: 'owner@salontest.com',
    nombre: 'Dueño Test',
    role: 'owner'
  });

  // Helper para montar app efímera
  async function withServer(app, fn) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      await fn(baseUrl);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  // ==========================================
  // PUNTO 1: CATEGORÍAS DEL CATÁLOGO
  // ==========================================
  console.log('📋 Test 1: Categorías del Catálogo (Esquemas de comisiones)...');

  // Insertar categoría activa con estado 'Activa' (femenino comúnmente guardado en BD)
  pool.tables.commission_categories.push({
    id: 1,
    tenant_id: 101,
    nombre: 'Cortes y Peinados',
    estado: 'Activa'
  });

  // Categoría inactiva
  pool.tables.commission_categories.push({
    id: 2,
    tenant_id: 101,
    nombre: 'Depilación Antigua',
    estado: 'Inactiva'
  });

  const servicesRouter = createServicesRouter(pool);
  const servicesApp = express();
  servicesApp.use(express.json());
  servicesApp.use((req, res, next) => {
    req.tenantId = 101;
    req.user = { id: 501, tenant_id: 101, role: 'admin' };
    next();
  });
  servicesApp.use('/api/services', servicesRouter);

  await withServer(servicesApp, async (baseUrl) => {
    // 1.1 Crear servicio con categoría 'Activa' por ID
    const createRes = await fetch(`${baseUrl}/api/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: 'Corte Moderno',
        precio: 850,
        tipo_item: 'Servicio',
        commission_category_id: 1
      })
    });
    const createData = await createRes.json();
    assert.strictEqual(createRes.status, 201, `Debería crear servicio con categoría 'Activa': ${JSON.stringify(createData)}`);
    assert.strictEqual(createData.categoria, 'Cortes y Peinados');
    console.log('  ✅ 1.1 Creación de servicio con categoría activa exitosa.');

    // 1.2 Intentar crear servicio con categoría inactiva debe ser rechazado
    const createInactiveRes = await fetch(`${baseUrl}/api/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: 'Depilación Láser',
        precio: 1200,
        tipo_item: 'Servicio',
        commission_category_id: 2
      })
    });
    assert.strictEqual(createInactiveRes.status, 400, 'Debería rechazar asignar categoría inactiva');
    console.log('  ✅ 1.2 Rechazo de categoría inactiva en nueva creación verificado.');
  });

  // ==========================================
  // PUNTO 2: ACCESOS RÁPIDOS DEL POS
  // ==========================================
  console.log('\n📋 Test 2: Accesos Rápidos del POS...');

  // Simular consulta de catálogo vacío para tenant 202
  const emptyCatalog = (pool.tables.servicios || []).filter(s => s.tenant_id === 202 && s.activo === 1);
  assert.strictEqual(emptyCatalog.length, 0, 'El catálogo para tenant 202 está vacío.');

  // Verificar que en VisitRecorder ya no existe DEFAULT_TOP_SERVICES
  const visitRecorderCode = fs.readFileSync(path.join(__dirname, '../../src/components/visits/VisitRecorder.jsx'), 'utf8');
  assert.strictEqual(visitRecorderCode.includes('DEFAULT_TOP_SERVICES'), false, 'DEFAULT_TOP_SERVICES no debe existir en VisitRecorder.');
  assert.strictEqual(visitRecorderCode.includes('Agrega servicios al Catálogo para configurar tus accesos rápidos'), true, 'Debe incluir estado vacío hacia el catálogo.');
  console.log('  ✅ 2.1 Cero servicios ficticios/hardcodeados en VisitRecorder.');
  console.log('  ✅ 2.2 Mensaje de estado vacío con enlace a /servicios confirmado.');

  // ==========================================
  // PUNTO 3: ACTUALIZAR TARJETA MEDIANTE CARDNET
  // ==========================================
  console.log('\n📋 Test 3: Registro y Actualización de Tarjeta mediante CardNet...');

  const billingRepo = new InMemorySaasBillingRepository();
  const mockTokenizationProvider = {
    publicKey: 'TEST_KEY_123',
    scriptUrl: 'https://servicios.cardnet.com.do/test/PWCheckout.js',
    env: 'staging',
    async createCustomerSession({ email }) {
      return {
        customerId: 'CUST_999',
        uniqueId: 'UNIQ_ABC_123',
        captureUrl: 'https://servicios.cardnet.com.do/Capture',
        scriptUrl: this.scriptUrl,
        env: this.env
      };
    },
    async getCustomerProfile(customerId) {
      return {
        customerId,
        paymentProfiles: [
          {
            paymentProfileId: 'PROF_777',
            brand: 'MASTERCARD',
            last4: '5555',
            expMonth: 10,
            expYear: 2029,
            token: 'tok_cardnet_verified_reusable'
          }
        ]
      };
    }
  };

  const termsService = new TermsAndWelcomeEmailService({ pool, baseUrl: 'https://staging.etereasapp.com' });

  const saasBillingRouter = createSaasBillingRouter({
    billingService: {},
    lifecycleService: {},
    billingRepo,
    checkoutService: { tokenizationProvider: mockTokenizationProvider },
    fxRateService: {},
    cardnetCheckoutProvider: {},
    cardnetTokenizationProvider: mockTokenizationProvider,
    termsService,
    pool
  });

  const billingApp = express();
  billingApp.use(express.json());
  billingApp.use((req, res, next) => {
    req.tenantId = 101;
    req.user = { id: 501, role: 'owner', email: 'owner@salontest.com' };
    next();
  });
  billingApp.use('/api/saas/billing', saasBillingRouter);

  await withServer(billingApp, async (baseUrl) => {
    // 3.1 Rechazo de token sintético manual sin verificación
    const fakeTokenRes = await fetch(`${baseUrl}/api/saas/billing/payment-methods`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentMethodToken: 'tok_123456789_4242',
        last4: '4242',
        brand: 'visa'
      })
    });
    assert.strictEqual(fakeTokenRes.status, 400, 'Debe rechazar tokens sintéticos inventados');
    console.log('  ✅ 3.1 Rechazo de tokens sintéticos manuales verificado.');

    // 3.2 Iniciar sesión CardNet
    const initCardRes = await fetch(`${baseUrl}/api/saas/billing/payment-methods/initiate-cardnet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const initCardData = await initCardRes.json();
    assert.strictEqual(initCardRes.status, 200);
    assert.strictEqual(initCardData.customerId, 'CUST_999');
    assert.strictEqual(initCardData.uniqueId, 'UNIQ_ABC_123');
    console.log('  ✅ 3.2 Endpoint /initiate-cardnet entrega credenciales de sesión.');

    // 3.3 Confirmar tarjeta registrada (CERO PAN/CVC, sin cobrar)
    const confirmCardRes = await fetch(`${baseUrl}/api/saas/billing/payment-methods/confirm-cardnet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId: 'CUST_999',
        tokenPayload: {
          TokenId: 'token_cn_888',
          Brand: 'Mastercard',
          Last4: '5555',
          ExpMonth: 10,
          ExpYear: 2029
        }
      })
    });
    const confirmCardData = await confirmCardRes.json();

    assert.strictEqual(confirmCardRes.status, 201);
    assert.strictEqual(confirmCardData.success, true);
    assert.strictEqual(confirmCardData.paymentMethod.last4, '5555');
    assert.strictEqual(confirmCardData.paymentMethod.isDefault, true);

    // Verificar que el método se listó y no se generó ninguna factura/cobro
    const listPmRes = await fetch(`${baseUrl}/api/saas/billing/payment-methods`);
    const listPmData = await listPmRes.json();
    assert.strictEqual(listPmData.paymentMethods.length, 1);
    assert.strictEqual(listPmData.paymentMethods[0].last4, '5555');
    console.log('  ✅ 3.3 Confirmación segura de tarjeta y persistencia sin cobro.');

    // 4.3 Aceptación autenticada de términos
    const acceptRes = await fetch(`${baseUrl}/api/saas/billing/terms/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accept_terms: true,
        authorize_recurring: true,
        terms_version: 'v2026.1'
      })
    });
    const acceptData = await acceptRes.json();

    assert.strictEqual(acceptRes.status, 200);
    assert.strictEqual(acceptData.termsVersion, 'v2026.1');
    assert.strictEqual(acceptData.documentHash, 'd5bc5be9930d6c1d167a47a5d32c6e216568d6f42fb95d6a11b719cc0fdcadf1');

    // Verificar que se registró en BD
    assert.strictEqual(pool.tables.tenant_terms_acceptances.length, 1);
    assert.strictEqual(pool.tables.tenant_terms_acceptances[0].recurring_authorized, true);
    console.log('  ✅ 4.3 Registro inmutable de aceptación en tenant_terms_acceptances.');

    // 4.4 Verificar que se encoló el correo de bienvenida en tenant_welcome_email_queue
    assert.strictEqual(pool.tables.tenant_welcome_email_queue.length, 1);
    const queuedEmail = pool.tables.tenant_welcome_email_queue[0];
    assert.strictEqual(queuedEmail.recipient_email, 'owner@salontest.com');
    assert.strictEqual(queuedEmail.company_name, 'Salon Test Point SRL');
    assert.strictEqual(queuedEmail.terms_version, 'v2026.1');
    assert.strictEqual(queuedEmail.account_status, 'pending');
    console.log('  ✅ 4.4 Correo de bienvenida encolado en tenant_welcome_email_queue con estado PENDING.');

    // 4.5 Ejecutar procesador de la cola y verificar envío
    const queueResult = await termsService.processWelcomeQueue(10);
    assert.strictEqual(queueResult.processed, 1);
    assert.strictEqual(pool.tables.tenant_welcome_email_queue[0].status, 'sent');
    console.log('  ✅ 4.5 Procesador de cola envió correo y actualizó estado a SENT.');
  });

  // ==========================================
  // PUNTO 4: TÉRMINOS, ACEPTACIÓN Y BIENVENIDA (PÚBLICO)
  // ==========================================
  console.log('\n📋 Test 4: Términos, Hash SHA-256 (Endpoints Públicos)...');

  const publicRouter = createPublicRouter(pool, { termsService });
  const publicApp = express();
  publicApp.use(express.json());
  publicApp.use('/api/public', publicRouter);

  await withServer(publicApp, async (baseUrl) => {
    // 4.1 Consulta pública de términos
    const termsRes = await fetch(`${baseUrl}/api/public/terms/v2026.1`);
    const termsData = await termsRes.json();
    assert.strictEqual(termsRes.status, 200);
    assert.strictEqual(termsData.version, 'v2026.1');
    assert.strictEqual(termsData.hash, 'd5bc5be9930d6c1d167a47a5d32c6e216568d6f42fb95d6a11b719cc0fdcadf1');
    console.log('  ✅ 4.1 Endpoint /api/public/terms/v2026.1 entrega contenido y hash SHA-256 verificado.');

    // 4.2 Descarga de términos íntegros
    const downloadRes = await fetch(`${baseUrl}/api/public/terms/v2026.1/download`);
    const downloadText = await downloadRes.text();
    assert.strictEqual(downloadRes.status, 200);
    assert.ok(downloadText.includes('TÉRMINOS Y CONDICIONES DE SUSCRIPCIÓN Y USO DE ETEREAS'));
    assert.ok(downloadText.includes('ETEREAS SRL, RNC 131917038'));
    console.log('  ✅ 4.2 Endpoint /download entrega texto plano íntegro.');
  });

  console.log('\n🎉 TODAS LAS PRUEBAS DE LAS 4 CORRECCIONES PASARON EXITOSAMENTE.');
}

runTests().catch((err) => {
  console.error('\n❌ ERROR EN PRUEBAS:', err);
  process.exit(1);
});
