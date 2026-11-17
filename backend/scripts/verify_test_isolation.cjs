'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Scanner de aislamiento de runners de pruebas:
 * Verifica que ningún archivo en backend/tests/*.cjs importe directamente ../db o ./db
 * (evadiendo test_env_guard.cjs y cayendo en backend/.env operativo).
 */
const ALLOWED_EXCEPTIONS = new Map([
  // Ejemplo: ['archivo.cjs', 'Justificación explícita']
]);

function scanTestRunners() {
  const testsDir = path.resolve(__dirname, '../tests');
  const files = fs.readdirSync(testsDir).filter((f) => f.endsWith('.cjs') || f.endsWith('.js'));
  const violations = [];

  for (const file of files) {
    const fullPath = path.join(testsDir, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const importsOperationalDb = /require\(\s*['"`]\.\.?\/db(?:\.js)?['"`]\s*\)/.test(content);
    if (importsOperationalDb && !ALLOWED_EXCEPTIONS.has(file)) {
      violations.push(file);
    }
  }

  if (violations.length > 0) {
    console.error('❌ [TEST ISOLATION GUARD FAILED] Los siguientes runners importan backend/db directamente:');
    violations.forEach((v) => console.error(`   - backend/tests/${v}`));
    process.exit(1);
  }

  console.log(`✅ [TEST ISOLATION GUARD PASS] ${files.length} archivos en backend/tests verificados sin importación directa a backend/db.`);
}

scanTestRunners();
