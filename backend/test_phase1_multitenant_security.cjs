const http = require('http');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Verificación obligatoria de entorno seguro antes de iniciar
const { validateTestEnvironment, createIsolatedTestPool } = require('./utils/test_env_guard.cjs');

// Fail-closed validation: Requires explicit ALLOW_INTEGRATION_TESTS=true and isolated TEST_DB_* credentials
const testDbConfig = validateTestEnvironment({ allowDisposableSchema: true });
const pool = createIsolatedTestPool(testDbConfig);

/**
 * Encuentra un puerto TCP disponible dinámicamente
 */
function getEphemeralPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Espera a que el servidor de pruebas responda en el puerto efímero
 */
function waitForServerHealth(port, maxWaitMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        if (res.statusCode === 200) {
          return resolve();
        }
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - start > maxWaitMs) {
        return reject(new Error(`Servidor de pruebas no respondió en http://127.0.0.1:${port}/api/health tras ${maxWaitMs}ms`));
      }
      setTimeout(check, 200);
    };

    check();
  });
}

/**
 * Suite Integral y Rigurosa de Seguridad, Autenticación y Multi-Tenant (Fase 1)
 */
async function runCompleteSecuritySuite() {
  console.log('\n========================================================================');
  console.log('🛡️ SUITE INTEGRAL DE SEGURIDAD, AUTENTICACIÓN Y MULTI-TENANT (FASE 1)');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;
  let testServerProcess = null;
  let testPort = null;

  function assert(title, condition, extra = '') {
    if (condition) {
      passed++;
      console.log(`  ✅ [PASS] ${title}`);
    } else {
      failed++;
      console.error(`  ❌ [FAIL] ${title} -> ${extra}`);
    }
  }

  function request(options, body = null) {
    return new Promise((resolve) => {
      const defaultHeaders = {
        'Content-Type': 'application/json'
      };
      const req = http.request({
        hostname: '127.0.0.1',
        port: testPort,
        ...options,
        headers: {
          ...defaultHeaders,
          ...(options.headers || {})
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch (_) {
            parsed = data;
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: parsed
          });
        });
      });

      req.on('error', (err) => {
        resolve({
          status: 500,
          headers: {},
          body: { error: err.message }
        });
      });

      if (body) {
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      req.end();
    });
  }

  function extractTokenFromCookie(headers) {
    const raw = headers['set-cookie'];
    if (!raw) return null;
    const cookies = Array.isArray(raw) ? raw : [raw];
    for (const c of cookies) {
      const m = c.match(/auth_token=([^;]+)/);
      if (m) return m[1];
    }
    return null;
  }

  // 1. Identificadores y credenciales de fixtures desechables
  const TENANT_A_ID = crypto.randomUUID();
  const TENANT_B_ID = crypto.randomUUID();
  const BRANCH_A_ID = crypto.randomUUID();
  const BRANCH_B_ID = crypto.randomUUID();
  const SALON_A_ID = crypto.randomUUID();
  const SALON_B_ID = crypto.randomUUID();
  const USER_A_ID = crypto.randomUUID();
  const USER_B_ID = crypto.randomUUID();
  const SUPERADMIN_ID = crypto.randomUUID();

  // Fixtures por módulo
  const CLIENT_A_ID = crypto.randomUUID();
  const CLIENT_B_ID = crypto.randomUUID();
  const SERVICE_A_ID = crypto.randomUUID();
  const SERVICE_B_ID = crypto.randomUUID();
  const CR_A_ID = crypto.randomUUID();
  const CR_B_ID = crypto.randomUUID();
  const VISIT_A_ID = 'visit_a_' + Date.now();
  const VISIT_B_ID = 'visit_b_' + Date.now();
  const ATT_A_ID = crypto.randomUUID();
  const ATT_B_ID = crypto.randomUUID();
  let actualPayrollAId = null;
  let actualPayrollBId = null;
  const INV_A_ID = crypto.randomUUID();
  const INV_B_ID = crypto.randomUUID();
  const CONTRACT_A_ID = crypto.randomUUID();
  const CONTRACT_B_ID = crypto.randomUUID();

  const userAEmail = `fixture_a_${Date.now()}_${crypto.randomBytes(3).toString('hex')}@test-fixtures.local`;
  const userBEmail = `fixture_b_${Date.now()}_${crypto.randomBytes(3).toString('hex')}@test-fixtures.local`;
  const superAdminEmail = `superadmin_${Date.now()}_${crypto.randomBytes(3).toString('hex')}@test-fixtures.local`;

  const passA = 'PassFixtureA_' + crypto.randomBytes(8).toString('hex') + '*';
  const passB = 'PassFixtureB_' + crypto.randomBytes(8).toString('hex') + '*';
  const superAdminPass = 'SuperPass_' + crypto.randomBytes(8).toString('hex') + '*';

  try {
    // 2. Levantar servidor en puerto efímero aislado
    console.log('[SPAWN] Obteniendo puerto efímero y levantando proceso de servidor...');
    testPort = await getEphemeralPort();
    console.log(`[SPAWN] Puerto efímero asignado: ${testPort}`);

    const childEnv = { ...process.env };
    delete childEnv.DB_HOST;
    delete childEnv.DB_PORT;
    delete childEnv.DB_USER;
    delete childEnv.DB_PASS;
    delete childEnv.DB_PASSWORD;
    delete childEnv.DB_NAME;
    delete childEnv.DATABASE_URL;

    childEnv.DB_HOST = testDbConfig.host;
    childEnv.DB_PORT = String(testDbConfig.port);
    childEnv.DB_USER = testDbConfig.user;
    childEnv.DB_PASS = testDbConfig.password;
    childEnv.DB_PASSWORD = testDbConfig.password;
    childEnv.DB_NAME = testDbConfig.database;
    childEnv.DB_TYPE = 'postgres';
    childEnv.TEST_DB_NAME = testDbConfig.database;
    childEnv.PORT = String(testPort);
    childEnv.NODE_ENV = 'test';
    childEnv.ALLOW_INTEGRATION_TESTS = 'true';

    testServerProcess = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    testServerProcess.on('error', (procErr) => {
      console.error('❌ Error fatal al spawnear servidor de prueba:', procErr);
    });

    await waitForServerHealth(testPort);
    console.log(`✅ Servidor de prueba listo y respondiendo en http://127.0.0.1:${testPort}/api/health`);

    // Comprobación de aislamiento: Verificar que el servidor API consulte current_database() y coincida con TEST_DB_NAME
    const dbCheckRes = await request({ path: '/api/health/db-check', method: 'GET' });
    const serverDbName = dbCheckRes.body?.database;
    const [poolDbRows] = await pool.query('SELECT current_database() as db_name');
    const poolDbName = poolDbRows[0]?.db_name;

    console.log(`[DB ISOLATION CHECK] Pool DB: "${poolDbName}" | Server DB: "${serverDbName}" | Config DB: "${testDbConfig.database}"`);

    if (!serverDbName || serverDbName !== testDbConfig.database) {
      throw new Error(`FATAL SECURITY ABORT: Servidor API hijo está conectado a "${serverDbName}", pero TEST_DB_NAME es "${testDbConfig.database}"!`);
    }
    if (poolDbName !== serverDbName) {
      throw new Error(`FATAL SECURITY ABORT: Desincronización crítica: Pool de fixtures está en "${poolDbName}" mientras API está en "${serverDbName}"!`);
    }
    console.log('✅ Verificación de aislamiento de base de datos exitosa: Servidor y Pool conectados estrictamente a la base de pruebas.\n');

    // 3. Crear fixtures desechables para todos los módulos
    console.log('[FIXTURES] Generando tenants, salones y registros de prueba en BD...');
    const hashA = await bcrypt.hash(passA, 10);
    const hashB = await bcrypt.hash(passB, 10);
    const hashSuper = await bcrypt.hash(superAdminPass, 10);

    // Tenants
    await pool.query(`
      INSERT INTO tenants (id, business_name, slug, email, status, plan_id, max_users, max_branches)
      VALUES (?, ?, ?, ?, 'active', 1, 5, 1)
    `, [TENANT_A_ID, 'Tenant Test A', `test-a-${Date.now()}`, userAEmail]);

    await pool.query(`
      INSERT INTO tenants (id, business_name, slug, email, status, plan_id, max_users, max_branches)
      VALUES (?, ?, ?, ?, 'active', 1, 5, 1)
    `, [TENANT_B_ID, 'Tenant Test B', `test-b-${Date.now()}`, userBEmail]);

    // Branches
    await pool.query(`
      INSERT INTO branches (id, tenant_id, name, is_main, status, is_active)
      VALUES (?, ?, 'Sucursal Test A', true, 'Active', true)
    `, [BRANCH_A_ID, TENANT_A_ID]);

    await pool.query(`
      INSERT INTO branches (id, tenant_id, name, is_main, status, is_active)
      VALUES (?, ?, 'Sucursal Test B', true, 'Active', true)
    `, [BRANCH_B_ID, TENANT_B_ID]);

    // Salons
    await pool.query(`
      INSERT INTO salons (id, tenant_id, name, nombre, status)
      VALUES (?, ?, 'Salón Principal A', 'Salón Principal A', 'Active')
    `, [SALON_A_ID, TENANT_A_ID]);

    await pool.query(`
      INSERT INTO salons (id, tenant_id, name, nombre, status)
      VALUES (?, ?, 'Salón Principal B', 'Salón Principal B', 'Active')
    `, [SALON_B_ID, TENANT_B_ID]);

    // Users
    await pool.query(`
      INSERT INTO users (id, tenant_id, branch_id, salon_id, name, nombre, email, password_hash, role, is_active, estado)
      VALUES (?, ?, ?, ?, 'Dueño A', 'Dueño A', ?, ?, 'owner', true, 'Activo')
    `, [USER_A_ID, TENANT_A_ID, BRANCH_A_ID, SALON_A_ID, userAEmail, hashA]);

    await pool.query(`
      INSERT INTO users (id, tenant_id, branch_id, salon_id, name, nombre, email, password_hash, role, is_active, estado)
      VALUES (?, ?, ?, ?, 'Dueño B', 'Dueño B', ?, ?, 'owner', true, 'Activo')
    `, [USER_B_ID, TENANT_B_ID, BRANCH_B_ID, SALON_B_ID, userBEmail, hashB]);

    // SuperAdmin desechable
    await pool.query(`
      INSERT INTO users (id, tenant_id, branch_id, salon_id, name, nombre, email, password_hash, role, is_active, estado)
      VALUES (?, NULL, NULL, NULL, 'SuperAdmin Test', 'SuperAdmin Test', ?, ?, 'superadmin', true, 'Activo')
    `, [SUPERADMIN_ID, superAdminEmail, hashSuper]);

    // Clients
    await pool.query(`
      INSERT INTO clients (id, tenant_id, salon_id, nombre, email, phone, status)
      VALUES (?, ?, ?, 'Cliente Test A', ?, '809-555-0101', 'Active')
    `, [CLIENT_A_ID, TENANT_A_ID, SALON_A_ID, `client_a_${Date.now()}@test.com`]);

    await pool.query(`
      INSERT INTO clients (id, tenant_id, salon_id, nombre, email, phone, status)
      VALUES (?, ?, ?, 'Cliente Test B', ?, '809-555-0102', 'Active')
    `, [CLIENT_B_ID, TENANT_B_ID, SALON_B_ID, `client_b_${Date.now()}@test.com`]);

    // Services
    await pool.query(`
      INSERT INTO services (id, tenant_id, name, nombre, price, precio, duration_minutes, is_active)
      VALUES (?, ?, 'Servicio Test A', 'Servicio Test A', 1200.00, 1200.00, 30, true)
    `, [SERVICE_A_ID, TENANT_A_ID]);

    await pool.query(`
      INSERT INTO services (id, tenant_id, name, nombre, price, precio, duration_minutes, is_active)
      VALUES (?, ?, 'Servicio Test B', 'Servicio Test B', 1500.00, 1500.00, 45, true)
    `, [SERVICE_B_ID, TENANT_B_ID]);

    // Cash Registers
    await pool.query(`
      INSERT INTO cash_registers (id, tenant_id, salon_id, branch_id, name, status)
      VALUES (?, ?, ?, ?, 'Caja Principal A', 'active')
    `, [CR_A_ID, TENANT_A_ID, SALON_A_ID, BRANCH_A_ID]);

    await pool.query(`
      INSERT INTO cash_registers (id, tenant_id, salon_id, branch_id, name, status)
      VALUES (?, ?, ?, ?, 'Caja Principal B', 'active')
    `, [CR_B_ID, TENANT_B_ID, SALON_B_ID, BRANCH_B_ID]);

    // Visits
    await pool.query(`
      INSERT INTO visits (id, tenant_id, salon_id, client_id, client_name, total, status)
      VALUES (?, ?, ?, ?, 'Cliente Test A', 1200.00, 'Completada')
    `, [VISIT_A_ID, TENANT_A_ID, SALON_A_ID, CLIENT_A_ID]);

    await pool.query(`
      INSERT INTO visits (id, tenant_id, salon_id, client_id, client_name, total, status)
      VALUES (?, ?, ?, ?, 'Cliente Test B', 1500.00, 'Completada')
    `, [VISIT_B_ID, TENANT_B_ID, SALON_B_ID, CLIENT_B_ID]);

    // Attendance
    await pool.query(`
      INSERT INTO attendance (id, tenant_id, employee_id, type, status)
      VALUES (?, ?, ?, 'Entrada', 'Normal')
    `, [ATT_A_ID, TENANT_A_ID, USER_A_ID]);

    await pool.query(`
      INSERT INTO attendance (id, tenant_id, employee_id, type, status)
      VALUES (?, ?, ?, 'Entrada', 'Normal')
    `, [ATT_B_ID, TENANT_B_ID, USER_B_ID]);

    // Payroll Periods (SERIAL PK)
    const [pA] = await pool.query(`
      INSERT INTO payroll_periods (tenant_id, period_name, start_date, end_date, status)
      VALUES (?, 'Q1 Noviembre Tenant A', '2026-11-01', '2026-11-15', 'Draft')
      RETURNING id
    `, [TENANT_A_ID]);
    actualPayrollAId = pA[0]?.id;

    const [pB] = await pool.query(`
      INSERT INTO payroll_periods (tenant_id, period_name, start_date, end_date, status)
      VALUES (?, 'Q1 Noviembre Tenant B', '2026-11-01', '2026-11-15', 'Draft')
      RETURNING id
    `, [TENANT_B_ID]);
    actualPayrollBId = pB[0]?.id;

    // Invoices
    await pool.query(`
      INSERT INTO invoices (id, tenant_id, branch_id, cashier_id, invoice_number, subtotal, total, payment_method, payment_status)
      VALUES (?, ?, ?, ?, 'INV-A-001', 1200.00, 1200.00, 'Efectivo', 'paid')
    `, [INV_A_ID, TENANT_A_ID, BRANCH_A_ID, USER_A_ID]);

    await pool.query(`
      INSERT INTO invoices (id, tenant_id, branch_id, cashier_id, invoice_number, subtotal, total, payment_method, payment_status)
      VALUES (?, ?, ?, ?, 'INV-B-001', 1500.00, 1500.00, 'Efectivo', 'paid')
    `, [INV_B_ID, TENANT_B_ID, BRANCH_B_ID, USER_B_ID]);

    // Contracts
    await pool.query(`
      INSERT INTO contracts (id, tenant_id, salon_id, client_id, status)
      VALUES (?, ?, ?, ?, 'Active')
    `, [CONTRACT_A_ID, TENANT_A_ID, SALON_A_ID, CLIENT_A_ID]);

    await pool.query(`
      INSERT INTO contracts (id, tenant_id, salon_id, client_id, status)
      VALUES (?, ?, ?, ?, 'Active')
    `, [CONTRACT_B_ID, TENANT_B_ID, SALON_B_ID, CLIENT_B_ID]);

    console.log('✅ Fixtures instanciados correctamente en todos los módulos.\n');

    // =========================================================================
    // SECCIÓN 1: SECRETOS, TOKENS JWT Y CRIPTOGRAFÍA
    // =========================================================================
    console.log('--- 1. Secretos, Tokens JWT y Algoritmos Criptográficos ---');
    const secret = process.env.JWT_SECRET;
    assert('JWT_SECRET está configurada y tiene al menos 32 caracteres', Boolean(secret && secret.length >= 32));

    // Token por query string rechazado
    const queryTokenReq = await request({ path: `/api/clients?auth_token=${jwt.sign({ id: 'test' }, secret)}` });
    assert('Token enviado mediante query string es RECHAZADO (401)', queryTokenReq.status === 401);

    // Token con firma alterada
    const forgedToken = jwt.sign({ id: 'fake', role: 'admin' }, 'wrong_secret_123456789012345678901234567890');
    const tamperedRes = await request({ path: '/api/clients', headers: { Authorization: `Bearer ${forgedToken}` } });
    assert('Token con firma alterada es RECHAZADO (401)', tamperedRes.status === 401);

    // Issuer inválido
    const wrongIssuer = jwt.sign({ id: 'fake', role: 'admin' }, secret, { issuer: 'hacker-issuer', audience: 'salonpro-app' });
    const wrongIssRes = await request({ path: '/api/clients', headers: { Authorization: `Bearer ${wrongIssuer}` } });
    assert('Token con emisor (issuer) inválido es RECHAZADO (401)', wrongIssRes.status === 401);

    // Audience inválido
    const wrongAudience = jwt.sign({ id: 'fake', role: 'admin' }, secret, { issuer: 'salonpro-saas', audience: 'hacker-audience' });
    const wrongAudRes = await request({ path: '/api/clients', headers: { Authorization: `Bearer ${wrongAudience}` } });
    assert('Token con audiencia (audience) inválida es RECHAZADO (401)', wrongAudRes.status === 401);

    // Token expirado
    const expiredToken = jwt.sign({ id: 'old-user', role: 'admin' }, secret, { expiresIn: -10, issuer: 'salonpro-saas', audience: 'salonpro-app' });
    const expiredRes = await request({ path: '/api/clients', headers: { Authorization: `Bearer ${expiredToken}` } });
    assert('Token expirado es RECHAZADO con código TOKEN_EXPIRED (401)', expiredRes.status === 401 && expiredRes.body?.code === 'TOKEN_EXPIRED');

    // =========================================================================
    // SECCIÓN 2: SUPERADMIN Y PRUEBA DE ROTACIÓN HISTÓRICA REAL
    // =========================================================================
    console.log('\n--- 2. SuperAdmin y Prueba de Rotación Histórica Real ---');
    // Prueba contra cuenta real histórica superadmin@salonsaas.com con contraseña conocida vieja
    const historicalLogin1 = await request({
      path: '/api/auth/login',
      method: 'POST'
    }, { email: 'superadmin@salonsaas.com', password: 'admin123' });
    assert('Contraseña histórica ("admin123") contra superadmin@salonsaas.com es RECHAZADA (401)', historicalLogin1.status === 401);

    const historicalLogin2 = await request({
      path: '/api/auth/login',
      method: 'POST'
    }, { email: 'superadmin@salonpro.io', password: 'admin123' });
    assert('Contraseña histórica ("admin123") contra superadmin@salonpro.io es RECHAZADA (401)', historicalLogin2.status === 401);

    // Login con contraseña rotada del SuperAdmin desechable
    const superLogin = await request({
      path: '/api/auth/login',
      method: 'POST'
    }, { email: superAdminEmail, password: superAdminPass });
    assert('SuperAdmin inicia sesión con clave rotada (200 OK)', superLogin.status === 200);
    assert('Login administrativo NO expone token en body JSON', !superLogin.body?.token);
    assert('SuperAdmin tiene rol superadmin y tenant_id = NULL', superLogin.body?.role === 'superadmin' && superLogin.body?.tenant_id === null);

    const cookieHeader = superLogin.headers['set-cookie'] || [];
    const hasHttpOnlyCookie = cookieHeader.some(c => c.includes('auth_token=') && c.toLowerCase().includes('httponly') && c.includes('Path=/') && c.toLowerCase().includes('samesite=lax'));
    assert('Login emite cookie segura HttpOnly auth_token con SameSite=Lax y Path=/', hasHttpOnlyCookie);
    const superToken = extractTokenFromCookie(superLogin.headers);
    const superSessionId = superLogin.body?.sessionId;

    // =========================================================================
    // SECCIÓN 3: AUTENTICACIÓN TENANT A Y TENANT B
    // =========================================================================
    console.log('\n--- 3. Autenticación de Salones (Tenant A vs Tenant B) ---');
    const loginA = await request({
      path: '/api/auth/login',
      method: 'POST'
    }, { email: userAEmail, password: passA });
    assert('Tenant A login exitoso', loginA.status === 200 && loginA.body?.tenant_id === TENANT_A_ID);
    assert('Tenant A login NO expone token en body JSON', !loginA.body?.token);
    const tokenA = extractTokenFromCookie(loginA.headers);
    const sessionA = loginA.body?.sessionId;

    const loginB = await request({
      path: '/api/auth/login',
      method: 'POST'
    }, { email: userBEmail, password: passB });
    assert('Tenant B login exitoso', loginB.status === 200 && loginB.body?.tenant_id === TENANT_B_ID);
    assert('Tenant B login NO expone token en body JSON', !loginB.body?.token);
    const tokenB = extractTokenFromCookie(loginB.headers);

    // =========================================================================
    // SECCIÓN 4: ANTI-IDOR, ANTI-SPOOFING Y CSRF
    // =========================================================================
    console.log('\n--- 4. Defensa Anti-IDOR, Anti-Spoofing y CSRF ---');

    // Intento de spoofing con x-tenant-id ajeno
    const spoofHeader = await request({
      path: '/api/clients',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'x-tenant-id': TENANT_B_ID
      }
    });
    assert('Usurpación vía Header x-tenant-id bloqueada con CROSS_TENANT_ACCESS_DENIED (403)', spoofHeader.status === 403 && spoofHeader.body?.code === 'CROSS_TENANT_ACCESS_DENIED');

    // Intento de spoofing vía Query param ?tenant_id=
    const spoofQuery = await request({
      path: `/api/clients?tenant_id=${TENANT_B_ID}`,
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert('Usurpación vía Query ?tenant_id bloqueada con CROSS_TENANT_ACCESS_DENIED (403)', spoofQuery.status === 403 && spoofQuery.body?.code === 'CROSS_TENANT_ACCESS_DENIED');

    // Intento de inyectar tenant_id ajeno en body POST
    const spoofBody = await request({
      path: '/api/services',
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` }
    }, { name: 'Servicio Inyectado', price: 500, tenant_id: TENANT_B_ID });
    assert('Inyección de tenant_id ajeno en payload bloqueada con CROSS_TENANT_ACCESS_DENIED (403)', spoofBody.status === 403 && spoofBody.body?.code === 'CROSS_TENANT_ACCESS_DENIED');

    // Verificación de CSRF Origin check en petición mutable
    const csrfBlocked = await request({
      path: '/api/services',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        Origin: 'https://malicious-attacker-domain.com'
      }
    }, { name: 'Servicio CSRF', price: 900 });
    assert('Operación mutable con Origin no autorizado es RECHAZADA por CSRF (403)', csrfBlocked.status === 403 && (csrfBlocked.body?.code === 'CSRF_ORIGIN_DENIED' || csrfBlocked.body?.code === 'CSRF_BLOCKED'));

    // =========================================================================
    // SECCIÓN 5: AISLAMIENTO ESTRICTO Y VERIFICACIÓN EN BD POR MÓDULOS
    // =========================================================================
    console.log('\n--- 5. Aislamiento Estricto y Verificación en BD por Módulos ---');

    // 5.1 Catálogo de Servicios
    const srvReadB = await request({
      path: `/api/services/${SERVICE_A_ID}`,
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    assert('Servicios: Tenant B NO puede leer servicio de Tenant A (404 Scoped)', srvReadB.status === 404);

    const srvUpdateB = await request({
      path: `/api/services/${SERVICE_A_ID}`,
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenB}` }
    }, { name: 'HACKED SERVICE', price: 1.00 });
    assert('Servicios: Tenant B NO puede modificar servicio de Tenant A (404 Scoped)', srvUpdateB.status === 404);

    const srvDelB = await request({
      path: `/api/services/${SERVICE_A_ID}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    assert('Servicios: Tenant B NO puede eliminar servicio de Tenant A (404 Scoped)', srvDelB.status === 404);

    const [srvDbA] = await pool.query('SELECT name, price FROM services WHERE id = ?', [SERVICE_A_ID]);
    assert('Servicios: Registro en BD de Tenant A permanece 100% intacto', srvDbA.length > 0 && srvDbA[0].name === 'Servicio Test A');

    // 5.2 Clientes CRM
    const cliReadB = await request({
      path: `/api/clients/${CLIENT_A_ID}`,
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    assert('Clientes: Tenant B NO puede leer ficha de cliente de Tenant A (404 Scoped)', cliReadB.status === 404);

    const cliUpdateB = await request({
      path: `/api/clients/${CLIENT_A_ID}`,
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenB}` }
    }, { nombre: 'HACKED CLIENT' });
    assert('Clientes: Tenant B NO puede modificar cliente de Tenant A (404 Scoped)', cliUpdateB.status === 404);

    const cliDelB = await request({
      path: `/api/clients/${CLIENT_A_ID}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    assert('Clientes: Tenant B NO puede eliminar cliente de Tenant A (404 Scoped)', cliDelB.status === 404);

    const [cliDbA] = await pool.query('SELECT nombre FROM clients WHERE id = ?', [CLIENT_A_ID]);
    assert('Clientes: Registro en BD de Tenant A permanece 100% intacto', cliDbA.length > 0 && cliDbA[0].nombre === 'Cliente Test A');

    // 5.3 Asistencia de Personal
    const attReadB = await request({
      path: `/api/attendance/today/${USER_A_ID}`,
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    assert('Asistencia: Tenant B consulta asistencia de empleado A: 0 registros (aislado)', Array.isArray(attReadB.body) && attReadB.body.length === 0);

    const attAdjustB = await request({
      path: '/api/attendance/adjust',
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` }
    }, {
      employeeId: USER_A_ID,
      date: '2026-11-08',
      checkInTime: '09:00',
      reason: 'Hacked adjust attempt',
      modifiedBy: 'Attacker'
    });
    assert('Asistencia: Tenant B NO puede ajustar asistencia de empleado de Tenant A (404 Scoped)', attAdjustB.status === 404);

    const [attDbA] = await pool.query('SELECT status FROM attendance WHERE id = ?', [ATT_A_ID]);
    assert('Asistencia: Registro en BD de Tenant A permanece 100% intacto', attDbA.length > 0 && attDbA[0].status === 'Normal');

    // 5.4 Nómina y Períodos
    const payrollReadB = await request({
      path: `/api/payroll/periods/${actualPayrollAId}`,
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    assert('Nómina: Tenant B NO puede leer período de Tenant A (404 Scoped)', payrollReadB.status === 404);

    const payrollDelB = await request({
      path: `/api/payroll/periods/${actualPayrollAId}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    assert('Nómina: Tenant B NO puede eliminar período de Tenant A (404 Scoped)', payrollDelB.status === 404);

    const [payrollDbA] = await pool.query('SELECT period_name FROM payroll_periods WHERE id = ?', [actualPayrollAId]);
    assert('Nómina: Registro en BD de Tenant A permanece 100% intacto', payrollDbA.length > 0 && payrollDbA[0].period_name === 'Q1 Noviembre Tenant A');

    // 5.5 Invoices / Facturas
    const invReadB = await request({
      path: `/api/invoices/${INV_A_ID}/download-pdf`,
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    assert('Facturas: Tenant B NO puede descargar PDF de factura de Tenant A (404 Scoped)', invReadB.status === 404);

    const invEmailB = await request({
      path: `/api/invoices/${INV_A_ID}/send-email`,
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    assert('Facturas: Tenant B NO puede enviar correo de factura de Tenant A (404 Scoped)', invEmailB.status === 404);

    const [invDbA] = await pool.query('SELECT total FROM invoices WHERE id = ?', [INV_A_ID]);
    assert('Facturas: Registro en BD de Tenant A permanece 100% intacto', invDbA.length > 0 && parseFloat(invDbA[0].total) === 1200.00);

    // 5.6 Cajas Registradoras
    const crReadB = await request({
      path: `/api/cash-registers/${CR_A_ID}/movements`,
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    assert('Cajas: Tenant B NO puede leer movimientos de caja de Tenant A (404 Scoped)', crReadB.status === 404);

    const crPostB = await request({
      path: `/api/cash-registers/${CR_A_ID}/movements`,
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` }
    }, { type: 'Ingreso', amount: 500, description: 'Hacked movement' });
    assert('Cajas: Tenant B NO puede registrar movimiento en caja de Tenant A (404 Scoped)', crPostB.status === 404);

    const [crDbA] = await pool.query('SELECT name FROM cash_registers WHERE id = ?', [CR_A_ID]);
    assert('Cajas: Registro en BD de Tenant A permanece 100% intacto', crDbA.length > 0 && crDbA[0].name === 'Caja Principal A');

    // 5.7 Visitas
    const visitAuditB = await request({
      path: `/api/visits/${VISIT_A_ID}/audit`,
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    assert('Visitas: Tenant B NO puede leer auditoría de visita de Tenant A (404 Scoped)', visitAuditB.status === 404);

    const visitDelB = await request({
      path: `/api/visits/${VISIT_A_ID}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    assert('Visitas: Tenant B NO puede eliminar visita de Tenant A (404 Scoped)', visitDelB.status === 404);

    const [visitDbA] = await pool.query('SELECT client_name FROM visits WHERE id = ?', [VISIT_A_ID]);
    assert('Visitas: Registro en BD de Tenant A permanece 100% intacto', visitDbA.length > 0 && visitDbA[0].client_name === 'Cliente Test A');

    // 5.8 Contratos
    const contractUpdateB = await request({
      path: `/api/contracts/${CONTRACT_A_ID}`,
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenB}` }
    }, { status: 'Cancelled' });
    assert('Contratos: Tenant B NO puede modificar contrato de Tenant A (404 Scoped)', contractUpdateB.status === 404);

    const contractDelB = await request({
      path: `/api/contracts/${CONTRACT_A_ID}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    assert('Contratos: Tenant B NO puede eliminar contrato de Tenant A (404 Scoped)', contractDelB.status === 404);

    const [contractDbA] = await pool.query('SELECT status FROM contracts WHERE id = ?', [CONTRACT_A_ID]);
    assert('Contratos: Registro en BD de Tenant A permanece 100% intacto', contractDbA.length > 0 && contractDbA[0].status === 'Active');

    // 5.9 Validación de Ownership en Payload
    const clientsListA = await request({
      path: '/api/clients',
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert('Ownership Payload: Tenant A recibe lista de clientes propia (200 OK)', clientsListA.status === 200 && Array.isArray(clientsListA.body));
    const allBelongToA = Array.isArray(clientsListA.body) && clientsListA.body.every(c => c.tenant_id === TENANT_A_ID);
    assert('Ownership Payload: El 100% de clientes devueltos pertenece estrictamente a Tenant A', allBelongToA);

    // =========================================================================
    // SECCIÓN 6: REVOCACIÓN INMEDIATA, BINDING DE SESIÓN Y FAIL-CLOSED
    // =========================================================================
    console.log('\n--- 6. Revocación Inmediata de Sesiones y Fail-Closed ---');

    // 6.1 session-check sin autenticación es RECHAZADO (401 con valid: false)
    const checkAnon = await request({ path: '/api/auth/session-check', method: 'POST' });
    assert('session-check sin autenticación es RECHAZADO (401)', checkAnon.status === 401 && checkAnon.body?.valid === false);

    // 6.2 Revocación remota de sesión
    await pool.query('UPDATE user_sessions SET is_active = 0 WHERE id = ?', [sessionA]);
    const revokedReq = await request({
      path: '/api/clients',
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert('Token con sesión marcada como inactiva es REVOCADO INMEDIATAMENTE (401 SESSION_REVOKED)', revokedReq.status === 401 && revokedReq.body?.code === 'SESSION_REVOKED');

    // Restaurar sesión de A
    await pool.query('UPDATE user_sessions SET is_active = 1 WHERE id = ?', [sessionA]);

    // 6.3 Desactivación de Usuario
    await pool.query('UPDATE users SET is_active = FALSE WHERE id = ?', [USER_A_ID]);
    const deactUserReq = await request({
      path: '/api/clients',
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert('Usuario desactivado es BLOQUEADO INMEDIATAMENTE (403 USER_INACTIVE)', deactUserReq.status === 403 && deactUserReq.body?.code === 'USER_INACTIVE');

    // Restaurar usuario A
    await pool.query('UPDATE users SET is_active = TRUE WHERE id = ?', [USER_A_ID]);

    // 6.4 Suspensión de Tenant
    await pool.query("UPDATE tenants SET status = 'suspended' WHERE id = ?", [TENANT_A_ID]);
    const suspTenantReq = await request({
      path: '/api/clients',
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert('Tenant suspendido es BLOQUEADO INMEDIATAMENTE (403 TENANT_SUSPENDED)', suspTenantReq.status === 403 && suspTenantReq.body?.code === 'TENANT_SUSPENDED');

    // Restaurar tenant A
    await pool.query("UPDATE tenants SET status = 'active' WHERE id = ?", [TENANT_A_ID]);

    // 6.5 Sesión perteneciente a otro usuario (Session Hijack Prevention)
    const hijackedToken = jwt.sign({
      sub: 'other-user-uuid',
      id: 'other-user-uuid',
      role: 'admin',
      tenantId: TENANT_A_ID,
      sessionId: sessionA
    }, secret, { issuer: 'salonpro-saas', audience: 'salonpro-app' });

    const hijackReq = await request({
      path: '/api/clients',
      headers: { Authorization: `Bearer ${hijackedToken}` }
    });
    assert('Token con sesión perteneciente a otro usuario es RECHAZADO (401 SESSION_USER_MISMATCH)', hijackReq.status === 401 && hijackReq.body?.code === 'SESSION_USER_MISMATCH');

    // 6.6 Token SuperAdmin revocado no puede crear tenants
    await pool.query('UPDATE user_sessions SET is_active = 0 WHERE id = ?', [superSessionId]);
    const revokedSuperCreate = await request({
      path: '/api/saas/tenants',
      method: 'POST',
      headers: { Authorization: `Bearer ${superToken}` }
    }, {
      business_name: 'Salón Ilegítimo',
      owner_name: 'Dueño',
      owner_email: 'revoked_super@test.com',
      admin_password: 'Pass2026*'
    });
    assert('Token SuperAdmin con sesión revocada es BLOQUEADO para crear tenants (401 SESSION_REVOKED)', revokedSuperCreate.status === 401 && revokedSuperCreate.body?.code === 'SESSION_REVOKED');

    // Restaurar sesión de SuperAdmin
    await pool.query('UPDATE user_sessions SET is_active = 1 WHERE id = ?', [superSessionId]);

    // =========================================================================
    // SECCIÓN 7: ONBOARDING PÚBLICO Y TRANSACCIÓN REAL CON PRUEBA DE FALLO
    // =========================================================================
    console.log('\n--- 7. Onboarding Público y Prueba de Rollback Real ---');
    const testOnboardingEmail = `new_tenant_${Date.now()}@salonpro-test.com`;

    // 7.1 Onboarding normal exitoso
    const anonOnboarding = await request({
      path: '/api/public/onboarding',
      method: 'POST'
    }, {
      business_name: 'Salón Onboarding Exitoso',
      owner_name: 'Dueño Onboarding',
      owner_email: testOnboardingEmail,
      admin_password: 'TestPassword2026*'
    });
    assert('Onboarding público asigna status pending (no active directo)', anonOnboarding.status === 201 && anonOnboarding.body?.status === 'pending');
    assert('Onboarding público NO devuelve token utilizable mientras esté pending', !anonOnboarding.body?.token);

    const createdTenantId = anonOnboarding.body?.tenant_id;
    if (createdTenantId) {
      const [tRows] = await pool.query('SELECT max_users, max_branches, status, plan_id FROM tenants WHERE id = ?', [createdTenantId]);
      const createdT = tRows[0];
      assert('Límites de onboarding público asignados estrictamente a Plan Base (max_users <= 5)', createdT?.max_users <= 5);
      assert('Plan de onboarding público forzado a Plan Base (plan_id = 1)', createdT?.plan_id === 1);

      // Limpieza del tenant temporal de onboarding
      await pool.query('DELETE FROM users WHERE tenant_id = ?', [createdTenantId]);
      await pool.query('DELETE FROM branches WHERE tenant_id = ?', [createdTenantId]);
      await pool.query('DELETE FROM salons WHERE tenant_id = ?', [createdTenantId]);
      await pool.query('DELETE FROM plans WHERE tenant_id = ?', [createdTenantId]);
      await pool.query('DELETE FROM tenants WHERE id = ?', [createdTenantId]);
    }

    // 7.2 Prueba de Fallo Intencional a mitad de transacción (vía header interno NODE_ENV=test)
    const failEmail = `fail_test_${Date.now()}@salonpro-test.com`;
    const failedOnboarding = await request({
      path: '/api/public/onboarding',
      method: 'POST',
      headers: {
        'x-test-force-rollback': 'true'
      }
    }, {
      business_name: 'Salón Para Fallar',
      owner_name: 'Dueño Fail',
      owner_email: failEmail,
      admin_password: 'TestPassword2026*'
    });
    assert('Onboarding con fallo intencional responde 500', failedOnboarding.status === 500);
    assert('Mensaje de error al cliente no expone detalles de BD', !failedOnboarding.body?.error?.includes('INTENTIONAL_TEST_FAILURE'));

    // Verificar que la conexión dedicada ejecutó ROLLBACK completo y no dejó registros huérfanos
    const [orphanTenants] = await pool.query("SELECT id FROM tenants WHERE owner_email = ?", [failEmail]);
    const [orphanUsers] = await pool.query("SELECT id FROM users WHERE email = ?", [failEmail]);
    const [orphanBranches] = await pool.query("SELECT id FROM branches WHERE name LIKE '%Salón Para Fallar%'");
    const [orphanSalons] = await pool.query("SELECT id FROM salons WHERE name LIKE '%Salón Para Fallar%'");

    assert('Rollback real: Cero tenants parciales en BD tras fallo', orphanTenants.length === 0);
    assert('Rollback real: Cero usuarios huérfanos en BD tras fallo', orphanUsers.length === 0);
    assert('Rollback real: Cero sucursales huérfanas en BD tras fallo', orphanBranches.length === 0);
    assert('Rollback real: Cero salones huérfanos en BD tras fallo', orphanSalons.length === 0);

    // =========================================================================
    // SECCIÓN 8: PROTECCIÓN DE RUTAS SUPERADMIN Y BLINDAJE PÚBLICO
    // =========================================================================
    console.log('\n--- 8. Protección de Rutas SuperAdmin y Rutas Públicas (Fail-Closed) ---');

    // POST /api/saas/tenants requiere SuperAdmin
    const unauthCreateTenant = await request({
      path: '/api/saas/tenants',
      method: 'POST'
    }, { business_name: 'Fake Salon' });
    assert('POST /api/saas/tenants sin autenticación es RECHAZADO (401)', unauthCreateTenant.status === 401);

    const normalUserCreateTenant = await request({
      path: '/api/saas/tenants',
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` }
    }, { business_name: 'Fake Salon 2' });
    assert('POST /api/saas/tenants para admin de salón regular es RECHAZADO (403 SUPERADMIN_REQUIRED)', normalUserCreateTenant.status === 403 && normalUserCreateTenant.body?.code === 'SUPERADMIN_REQUIRED');

    // /api/cron sin secreto válido rechazado
    const cronNoAuth = await request({ path: '/api/cron/process-recurrent-charges', method: 'POST' });
    assert('GET /api/cron sin secreto válido es DENEGADO (401/403 Fail-Closed)', cronNoAuth.status === 401 || cronNoAuth.status === 403);

    // /api/test deshabilitado por defecto
    const testRouteRes = await request({ path: '/api/test/force-retry', method: 'POST' });
    assert('/api/test está DESHABILITADO por defecto (403 Forbidden)', testRouteRes.status === 403);

    // /api/surveys/stats exige autenticación
    const surveyStatsAnon = await request({ path: '/api/surveys/stats' });
    assert('/api/surveys/stats exige autenticación (401 AUTH_REQUIRED)', surveyStatsAnon.status === 401);

  } catch (err) {
    console.error('\n❌ ERROR INESPERADO DURANTE LA EJECUCIÓN DE PRUEBAS:', err);
    failed++;
  } finally {
    console.log('\n[TEARDOWN] Limpiando fixtures de prueba y destruyendo servidor efímero...');
    let teardownFailed = false;

    // Destruir proceso de servidor de prueba
    if (testServerProcess) {
      try {
        testServerProcess.kill('SIGKILL');
        console.log('✅ Proceso de servidor de prueba terminado limpiamente.');
      } catch (procKillErr) {
        console.error('⚠️ Error al terminar proceso de servidor:', procKillErr.message);
      }
    }

    try {
      await pool.query('DELETE FROM user_sessions WHERE tenant_id IN (?, ?) OR user_id = ?', [TENANT_A_ID, TENANT_B_ID, SUPERADMIN_ID]);
      await pool.query('DELETE FROM attendance WHERE tenant_id IN (?, ?)', [TENANT_A_ID, TENANT_B_ID]);
      await pool.query('DELETE FROM invoices WHERE tenant_id IN (?, ?)', [TENANT_A_ID, TENANT_B_ID]);
      await pool.query('DELETE FROM visits WHERE tenant_id IN (?, ?)', [TENANT_A_ID, TENANT_B_ID]);
      await pool.query('DELETE FROM contracts WHERE tenant_id IN (?, ?)', [TENANT_A_ID, TENANT_B_ID]);
      await pool.query('DELETE FROM cash_registers WHERE tenant_id IN (?, ?)', [TENANT_A_ID, TENANT_B_ID]);
      await pool.query('DELETE FROM services WHERE tenant_id IN (?, ?)', [TENANT_A_ID, TENANT_B_ID]);
      await pool.query('DELETE FROM clients WHERE tenant_id IN (?, ?)', [TENANT_A_ID, TENANT_B_ID]);
      if (actualPayrollAId || actualPayrollBId) {
        await pool.query('DELETE FROM payroll_periods WHERE tenant_id IN (?, ?)', [TENANT_A_ID, TENANT_B_ID]);
      }
      await pool.query('DELETE FROM users WHERE tenant_id IN (?, ?) OR id = ?', [TENANT_A_ID, TENANT_B_ID, SUPERADMIN_ID]);
      await pool.query('DELETE FROM salons WHERE tenant_id IN (?, ?)', [TENANT_A_ID, TENANT_B_ID]);
      await pool.query('DELETE FROM branches WHERE tenant_id IN (?, ?)', [TENANT_A_ID, TENANT_B_ID]);
      await pool.query('DELETE FROM tenants WHERE id IN (?, ?)', [TENANT_A_ID, TENANT_B_ID]);
      console.log('✅ Teardown completado: Todos los datos desechables fueron eliminados.');
    } catch (cleanupErr) {
      console.error('❌ Error crítico durante teardown:', cleanupErr.message);
      teardownFailed = true;
    }

    if (teardownFailed) {
      failed++;
    }
  }

  console.log('\n========================================================================');
  console.log(`📊 RESUMEN FINAL: ${passed} PASADAS, ${failed} FALLIDAS`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

if (require.main === module) {
  runCompleteSecuritySuite().catch(console.error);
}

module.exports = { runCompleteSecuritySuite };
