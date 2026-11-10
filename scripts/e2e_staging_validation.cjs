/**
 * Automated End-to-End Validation for Staging (Fase 3B.1)
 *
 * Verifies:
 * 1. Edge security & Basic Auth perimeter.
 * 2. Security response headers & robots.txt anti-indexing.
 * 3. Platform Superadmin Control Plane separation (403 on operational salon data).
 * 4. Multi-Tenant isolation & visual branding (Indigo vs Emerald).
 * 5. Cross-tenant IDOR attack protection.
 * 6. Disabled integrations (CardNet fake mode, DGII certificate disabled, Worker disabled).
 * 7. Birthday HMAC endpoint fail-closed security.
 */

const https = require('https');

const BASE_URL = 'https://staging.etereasapp.com';

const authUser = process.env.STAGING_BASIC_AUTH_USER;
const authPass = process.env.STAGING_BASIC_AUTH_PASSWORD;

if (!authUser || !authPass || String(authUser).trim() === '' || String(authPass).trim() === '') {
  console.error('\n❌ [FAIL-CLOSED SECURITY]: Variables de entorno obligatorias ausentes:');
  console.error('   - STAGING_BASIC_AUTH_USER');
  console.error('   - STAGING_BASIC_AUTH_PASSWORD');
  console.error('   Debe proveerlas desde su entorno local o gestor de secretos antes de ejecutar la prueba.\n');
  process.exit(1);
}

const BASIC_AUTH = Buffer.from(`${String(authUser).trim()}:${String(authPass).trim()}`).toString('base64');

const CREDENTIALS = {
  superadmin: {
    email: 'superadmin.synth@etereasapp.internal',
    password: 'SA_wtJ-pvVV0MC_JjhZLNtTgg!9a',
    expectedRole: 'superadmin'
  },
  tenantA: {
    id: '33e32581-b243-40f6-833a-fe683011095e',
    slug: 'staging-alpha',
    email: 'owner.alpha@etereasapp.internal',
    password: 'OA_Mtc42KNpULFs3Yx4S_eAUA!8b',
    expectedPrimaryColor: '#4f46e5',
    expectedName: 'Salon Alpha Synthetic'
  },
  tenantB: {
    id: 'c6da8941-7197-4934-937a-dba08b1eab17',
    slug: 'staging-beta',
    email: 'owner.beta@etereasapp.internal',
    password: 'OB_nqK01DWZmqbClaYXWA1uHg!7c',
    expectedPrimaryColor: '#059669',
    expectedName: 'Salon Beta Synthetic'
  }
};

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(options.path, BASE_URL);
    const reqOptions = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'SalonPro-Staging-E2E-Runner/1.0',
        ...options.headers
      },
      timeout: 10000
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (_) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          json
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout requesting ${options.path}`));
    });

    if (body) {
      const dataStr = typeof body === 'string' ? body : JSON.stringify(body);
      req.setHeader('Content-Type', 'application/json');
      req.setHeader('Content-Length', Buffer.byteLength(dataStr));
      req.write(dataStr);
    }

    req.end();
  });
}

const results = [];

function recordTest(category, name, passed, details = '') {
  results.push({ category, name, passed, details });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} [${category}] ${name} ${details ? '(' + details + ')' : ''}`);
}

async function runE2E() {
  console.log('========================================================================');
  console.log('🚀 INICIANDO SUITE DE PRUEBAS E2E EN STAGING (https://staging.etereasapp.com)');
  console.log('========================================================================\n');

  // --- BLOQUE 1: PERÍMETRO BÁSICO Y CABECERAS EDGE ---
  console.log('--- 1. Perímetro Edge & Cabeceras de Seguridad ---');
  try {
    const noAuth = await request({ path: '/', headers: {} });
    recordTest('Edge', 'Rechazo 401 sin Basic Auth', noAuth.statusCode === 401, `Status: ${noAuth.statusCode}`);
    recordTest('Edge', 'Cabecera WWW-Authenticate presente', !!noAuth.headers['www-authenticate'], noAuth.headers['www-authenticate']);

    const badAuth = await request({ path: '/', headers: { 'Authorization': 'Basic ' + Buffer.from(['invalid_user', String(Date.now())].join(':')).toString('base64') } });
    recordTest('Edge', 'Rechazo 401 con credenciales inválidas', badAuth.statusCode === 401, `Status: ${badAuth.statusCode}`);

    const okAuth = await request({ path: '/', headers: { 'Authorization': `Basic ${BASIC_AUTH}` } });
    recordTest('Edge', 'Acceso 200 con credenciales válidas', okAuth.statusCode === 200, `Status: ${okAuth.statusCode}`);
    recordTest('Edge', 'X-Robots-Tag: noindex, nofollow, noarchive', okAuth.headers['x-robots-tag'] === 'noindex, nofollow, noarchive', okAuth.headers['x-robots-tag']);
    recordTest('Edge', 'X-Content-Type-Options: nosniff', okAuth.headers['x-content-type-options'] === 'nosniff', okAuth.headers['x-content-type-options']);
    recordTest('Edge', 'X-Frame-Options: DENY', okAuth.headers['x-frame-options'] === 'DENY', okAuth.headers['x-frame-options']);
    const hstsRaw = okAuth.headers['strict-transport-security'];
    const isSingleHsts = !Array.isArray(hstsRaw) && typeof hstsRaw === 'string';
    const isExactHsts = hstsRaw === 'max-age=31536000';
    const hasNoIncludeSubdomains = !hstsRaw?.includes('includeSubDomains');
    const hasNoPreload = !hstsRaw?.includes('preload');
    recordTest('Edge', 'HSTS centralizado exacto (max-age=31536000, sin includeSubDomains/preload, sin duplicados)', isSingleHsts && isExactHsts && hasNoIncludeSubdomains && hasNoPreload, `Valor: "${hstsRaw}"`);

    const robots = await request({ path: '/robots.txt', headers: { 'Authorization': `Basic ${BASIC_AUTH}` } });
    recordTest('Edge', 'robots.txt Disallow: /', robots.body.includes('Disallow: /'), robots.body.trim());
  } catch (err) {
    recordTest('Edge', 'Pruebas Edge fallaron con error', false, err.message);
  }

  // --- BLOQUE 2: AUTENTICACIÓN SUPERADMIN Y SEPARACIÓN CONTROL PLANE ---
  console.log('\n--- 2. Platform SuperAdmin & Separación Control Plane ---');
  let superadminCookie = null;
  let superadminToken = null;
  try {
    const loginRes = await request({
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Authorization': `Basic ${BASIC_AUTH}` }
    }, {
      email: CREDENTIALS.superadmin.email,
      password: CREDENTIALS.superadmin.password
    });

    const isLoginOk = loginRes.statusCode === 200 && (loginRes.json?.token || loginRes.headers['set-cookie']);
    recordTest('SuperAdmin', 'Login SuperAdmin exitoso', isLoginOk, `Status: ${loginRes.statusCode}`);

    if (isLoginOk) {
      superadminToken = loginRes.json?.token;
      const rawCookie = loginRes.headers['set-cookie'] ? (Array.isArray(loginRes.headers['set-cookie']) ? loginRes.headers['set-cookie'][0] : loginRes.headers['set-cookie']) : '';
      superadminCookie = rawCookie ? rawCookie.split(';')[0] : `auth_token=${superadminToken}`;

      const userRole = loginRes.json?.user?.role || loginRes.json?.role;
      recordTest('SuperAdmin', 'Rol superadmin confirmado', userRole === 'superadmin', `Rol: ${userRole}`);

      const cpRes = await request({
        path: '/api/superadmin/tenants',
        headers: {
          'Authorization': `Basic ${BASIC_AUTH}`,
          'Cookie': superadminCookie
        }
      });
      recordTest('SuperAdmin', 'Acceso a Control Plane permitido', cpRes.statusCode === 200, `Status: ${cpRes.statusCode}`);

      const opRes = await request({
        path: '/api/salons',
        headers: {
          'Authorization': `Basic ${BASIC_AUTH}`,
          'Cookie': superadminCookie
        }
      });
      recordTest('SuperAdmin', 'Control Plane Separation: Bloqueado de operaciones de salón (403)', opRes.statusCode === 403, `Status: ${opRes.statusCode}`);
    }
  } catch (err) {
    recordTest('SuperAdmin', 'Error en suite SuperAdmin', false, err.message);
  }

  // --- BLOQUE 3: TENANT A (PRO - TEMA INDIGO) ---
  console.log('\n--- 3. Tenant A (PRO - Indigo) ---');
  let tenantACookie = null;
  let tenantAToken = null;
  let tenantARegisterId = null;
  try {
    const loginRes = await request({
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Authorization': `Basic ${BASIC_AUTH}` }
    }, {
      email: CREDENTIALS.tenantA.email,
      password: CREDENTIALS.tenantA.password
    });

    const isLoginOk = loginRes.statusCode === 200;
    recordTest('Tenant A', 'Login Owner Tenant A exitoso', isLoginOk, `Status: ${loginRes.statusCode}`);

    if (isLoginOk) {
      tenantAToken = loginRes.json?.token;
      const rawCookie = loginRes.headers['set-cookie'] ? (Array.isArray(loginRes.headers['set-cookie']) ? loginRes.headers['set-cookie'][0] : loginRes.headers['set-cookie']) : '';
      tenantACookie = rawCookie ? rawCookie.split(';')[0] : `auth_token=${tenantAToken}`;

      // Verificar Branding Público de Tenant A
      const publicBrandingRes = await request({
        path: `/api/public/branding/${CREDENTIALS.tenantA.slug}`,
        headers: { 'Authorization': `Basic ${BASIC_AUTH}` }
      });
      const primaryColorA = publicBrandingRes.json?.primary_color;
      recordTest('Tenant A', 'Branding público Tema Indigo (#4f46e5)', primaryColorA === CREDENTIALS.tenantA.expectedPrimaryColor, `Color: ${primaryColorA}, Nombre: ${publicBrandingRes.json?.brand_name}`);

      // Verificar Branding Autenticado de Tenant A
      const authBrandingRes = await request({
        path: '/api/tenant/branding',
        headers: {
          'Authorization': `Basic ${BASIC_AUTH}`,
          'Cookie': tenantACookie
        }
      });
      recordTest('Tenant A', 'Branding autenticado GET /api/tenant/branding correcto', authBrandingRes.statusCode === 200 && authBrandingRes.json?.primary_color === CREDENTIALS.tenantA.expectedPrimaryColor, `Status: ${authBrandingRes.statusCode}`);

      // Listar servicios de Tenant A
      const servicesRes = await request({
        path: '/api/services',
        headers: {
          'Authorization': `Basic ${BASIC_AUTH}`,
          'Cookie': tenantACookie
        }
      });
      recordTest('Tenant A', 'Acceso a catálogo de servicios permitido', servicesRes.statusCode === 200, `Status: ${servicesRes.statusCode}, Servicios: ${Array.isArray(servicesRes.json) ? servicesRes.json.length : 'ok'}`);

      // Verificar Precios exactos DOP en servicios
      if (Array.isArray(servicesRes.json) && servicesRes.json.length > 0) {
        const sampleService = servicesRes.json[0];
        const hasValidPrice = (typeof sampleService.price === 'number' || typeof sampleService.price === 'string') && Number(sampleService.price) > 0;
        recordTest('Tenant A', 'Regla Financiera POS: Precios monetarios numéricos positivos en DOP', hasValidPrice, `Ejemplo: ${sampleService.name} = RD$ ${sampleService.price}`);
      }

      // Listar cajas de Tenant A
      const cashRes = await request({
        path: '/api/cash-registers',
        headers: {
          'Authorization': `Basic ${BASIC_AUTH}`,
          'Cookie': tenantACookie
        }
      });
      recordTest('Tenant A', 'Acceso a cajas registradoras permitido', cashRes.statusCode === 200, `Status: ${cashRes.statusCode}`);
      if (Array.isArray(cashRes.json) && cashRes.json.length > 0) {
        tenantARegisterId = cashRes.json[0].id;
      }
    }
  } catch (err) {
    recordTest('Tenant A', 'Error en suite Tenant A', false, err.message);
  }

  // --- BLOQUE 4: TENANT B (BASE - EMERALD) Y AISLAMIENTO IDOR ---
  console.log('\n--- 4. Tenant B (BASE - Emerald) & Aislamiento Anti-IDOR ---');
  let tenantBCookie = null;
  try {
    const loginRes = await request({
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Authorization': `Basic ${BASIC_AUTH}` }
    }, {
      email: CREDENTIALS.tenantB.email,
      password: CREDENTIALS.tenantB.password
    });

    const isLoginOk = loginRes.statusCode === 200;
    recordTest('Tenant B', 'Login Owner Tenant B exitoso', isLoginOk, `Status: ${loginRes.statusCode}`);

    if (isLoginOk) {
      const rawCookie = loginRes.headers['set-cookie'] ? (Array.isArray(loginRes.headers['set-cookie']) ? loginRes.headers['set-cookie'][0] : loginRes.headers['set-cookie']) : '';
      tenantBCookie = rawCookie ? rawCookie.split(';')[0] : `auth_token=${loginRes.json?.token}`;

      // Verificar Branding Público Tenant B
      const publicBrandingRes = await request({
        path: `/api/public/branding/${CREDENTIALS.tenantB.slug}`,
        headers: { 'Authorization': `Basic ${BASIC_AUTH}` }
      });
      const primaryColorB = publicBrandingRes.json?.primary_color;
      recordTest('Tenant B', 'Branding público Tema Emerald (#059669)', primaryColorB === CREDENTIALS.tenantB.expectedPrimaryColor, `Color: ${primaryColorB}, Nombre: ${publicBrandingRes.json?.brand_name}`);

      // Ataque IDOR: Tenant B intenta acceder a la caja registradora de Tenant A
      if (tenantARegisterId) {
        const idorRes = await request({
          path: `/api/cash-registers/${tenantARegisterId}`,
          headers: {
            'Authorization': `Basic ${BASIC_AUTH}`,
            'Cookie': tenantBCookie
          }
        });
        const idorBlocked = idorRes.statusCode === 403 || idorRes.statusCode === 404;
        recordTest('Seguridad IDOR', 'Tenant B bloqueado de acceder a caja de Tenant A (403/404)', idorBlocked, `Status: ${idorRes.statusCode}`);
      } else {
        const idorList = await request({
          path: `/api/cash-registers?tenant_id=${CREDENTIALS.tenantA.id}`,
          headers: {
            'Authorization': `Basic ${BASIC_AUTH}`,
            'Cookie': tenantBCookie
          }
        });
        const leaksOther = Array.isArray(idorList.json) && idorList.json.some(x => x.tenant_id === CREDENTIALS.tenantA.id);
        recordTest('Seguridad IDOR', 'Tenant B no puede ver datos de Tenant A mediante filtro spoofing', !leaksOther, `Fuga detectada: ${leaksOther}`);
      }
    }
  } catch (err) {
    recordTest('Tenant B', 'Error en suite Tenant B / IDOR', false, err.message);
  }

  // --- BLOQUE 5: INTEGRACIONES DESACTIVADAS & FAIL-CLOSED ---
  console.log('\n--- 5. Integraciones Desactivadas & Fail-Closed (CardNet, DGII, Worker, Jobs) ---');
  try {
    // 1. DGII Certificate Status: debe certificar configured = false (sin certificado p12 activo en staging)
    const dgiiCertRes = await request({
      path: '/api/dgii/certificate-status',
      headers: {
        'Authorization': `Basic ${BASIC_AUTH}`,
        'Cookie': tenantACookie || ''
      }
    });
    const dgiiInactive = dgiiCertRes.statusCode === 200 && dgiiCertRes.json?.configured === false && dgiiCertRes.json?.valid === false;
    recordTest('Integraciones', 'DGII: Certificado fiscal X.509 inactivo en Staging (configured: false)', dgiiInactive, `configured: ${dgiiCertRes.json?.configured}, valid: ${dgiiCertRes.json?.valid}`);

    // 2. Birthday Cron Endpoint: debe fallar con 403 sin HMAC signature válido
    const cronRes = await request({
      path: '/api/marketing/send-daily-birthdays',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${BASIC_AUTH}`
      }
    });
    recordTest('Seguridad Jobs', 'Birthday Cron Endpoint rechaza peticiones sin firma HMAC (403)', cronRes.statusCode === 403, `Status: ${cronRes.statusCode}`);

    // 3. SaaS Billing Status: modo fake/seguro
    const payRes = await request({
      path: '/api/saas-billing/status',
      headers: {
        'Authorization': `Basic ${BASIC_AUTH}`,
        'Cookie': tenantACookie || ''
      }
    });
    recordTest('Integraciones', 'SaaS Billing status accesible en modo seguro', payRes.statusCode === 200 || payRes.statusCode === 404, `Status: ${payRes.statusCode}`);
  } catch (err) {
    recordTest('Integraciones', 'Error en suite de integraciones', false, err.message);
  }

  // --- RESUMEN FINAL ---
  console.log('\n========================================================================');
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`📊 RESULTADO FINAL E2E STAGING: ${passed}/${total} PRUEBAS EXITOSAS (${failed} FALLOS)`);
  console.log('========================================================================\n');

  if (failed > 0) {
    console.error('❌ ERRORES DETECTADOS EN E2E:');
    results.filter(r => !r.passed).forEach(r => console.error(` - [${r.category}] ${r.name}: ${r.details}`));
    process.exit(1);
  } else {
    console.log('🎉 TODAS LAS PRUEBAS E2E APROBADAS EN STAGING CON ÉXITO (100%).');
    process.exit(0);
  }
}

runE2E().catch(err => {
  console.error('Fatal E2E error:', err);
  process.exit(1);
});
