/**
 * Quality Gate: OpenAPI 3.1.0 Contract Verification (REM-P3-02)
 * (backend/tests/test_openapi_spec.cjs)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

async function runOpenApiSpecTests() {
  console.log('========================================================================');
  console.log('🛡️ SUITE: ESPECIFICACIÓN OPENAPI 3.1.0 SINCRONIZADA (REM-P3-02)');
  console.log('========================================================================\n');

  const openApiPath = path.resolve(__dirname, '../docs/openapi.json');
  assert.ok(fs.existsSync(openApiPath), 'El archivo backend/docs/openapi.json debe existir');

  const raw = fs.readFileSync(openApiPath, 'utf8');
  let spec;
  try {
    spec = JSON.parse(raw);
  } catch (err) {
    throw new Error('SINTAXIS JSON INVÁLIDA en backend/docs/openapi.json: ' + err.message);
  }

  // 1. Structure validation
  assert.strictEqual(spec.openapi, '3.1.0', 'Debe especificar OpenAPI 3.1.0');
  assert.ok(spec.info && spec.info.title, 'Debe contener bloque info con title');
  assert.ok(spec.info.version, 'Debe contener versión de API');
  assert.ok(Array.isArray(spec.servers) && spec.servers.length > 0, 'Debe contener servidores válidos');
  assert.ok(spec.components && spec.components.securitySchemes, 'Debe definir securitySchemes');
  assert.ok(spec.paths && typeof spec.paths === 'object', 'Debe contener paths válidos');
  console.log('  ✅ [PASS 1] Estructura sintáctica OpenAPI 3.1.0 verificada');

  // 2. Critical routes coverage
  const expectedPaths = [
    '/api/auth/login',
    '/api/auth/revoke-tokens',
    '/api/clients/search',
    '/api/cash-registers/{id}/close',
    '/api/inventory/physical-sessions',
    '/api/inventory/physical-sessions/{id}/post',
    '/api/tenant/retention/policies',
    '/api/tenant/retention/dry-run',
    '/api/tenant/retention/execute'
  ];

  for (const ep of expectedPaths) {
    assert.ok(spec.paths[ep], `Ruta crítica ausente en OpenAPI: ${ep}`);
  }
  console.log(`  ✅ [PASS 2] Las ${expectedPaths.length} rutas críticas de Fase 2A-3B están documentadas`);

  // 3. Security schemes verification
  const sec = spec.components.securitySchemes;
  assert.ok(sec.BearerAuth, 'Debe documentar BearerAuth');
  assert.ok(sec.CookieAuth, 'Debe documentar CookieAuth');
  assert.ok(sec.CsrfProtection, 'Debe documentar CsrfProtection');
  console.log('  ✅ [PASS 3] Esquemas de seguridad (Bearer, Cookie, CSRF) validados');

  // 4. Negative test: zero raw secrets or passwords in file
  const forbiddenPatterns = [
    'password123',
    'admin123',
    'secret_key',
    'SuperSecret',
    'staging_operator'
  ];

  for (const pattern of forbiddenPatterns) {
    assert.strictEqual(
      raw.includes(pattern),
      false,
      `PATRÓN SENSIBLE DETECTADO EN DOCUMENTACIÓN OPENAPI: "${pattern}"`
    );
  }
  console.log('  ✅ [PASS 4] Cero secretos, credenciales ni contraseñas expuestas en la especificación');

  console.log('\n========================================================================');
  console.log('🎉 TODAS LAS PRUEBAS DE OPENAPI 3.1.0 PASARON (PASS)');
  console.log('========================================================================\n');
}

if (require.main === module) {
  runOpenApiSpecTests().catch(err => {
    console.error('\n❌ [FAIL] Error en pruebas de OpenAPI:', err);
    process.exit(1);
  });
}

module.exports = { runOpenApiSpecTests };
