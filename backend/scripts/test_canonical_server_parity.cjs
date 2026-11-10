/**
 * Test: Canonical Server Parity & Runtime Unification
 *
 * Verifies that:
 * 1. PM2 configuration (ecosystem.config.cjs) points directly to ./backend/server.js
 * 2. package.json scripts point to backend/server.js
 * 3. Root server.js is a strictly minimal launcher delegating to backend/server.js
 * 4. Legacy routes/ and bi_engine.js are completely archived outside the runtime path
 * 5. backend/server.js and root server.js resolve the identical Express app and models
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { pathToFileURL } = require('url');

async function run() {
  console.log('=== START TEST: CANONICAL SERVER PARITY & RUNTIME UNIFICATION ===');

  const rootDir = path.resolve(__dirname, '..', '..');
  const backendDir = path.resolve(__dirname, '..');

  // 1. Check ecosystem.config.cjs
  const ecosystemPath = path.join(rootDir, 'ecosystem.config.cjs');
  assert(fs.existsSync(ecosystemPath), 'ecosystem.config.cjs must exist in root');
  const ecosystem = require(ecosystemPath);
  assert(Array.isArray(ecosystem.apps) && ecosystem.apps.length > 0, 'ecosystem must define apps array');
  const backendApp = ecosystem.apps.find(a => a.name === 'salonpro-backend');
  assert(backendApp, 'ecosystem must configure salonpro-backend');
  assert.strictEqual(
    path.resolve(rootDir, backendApp.script),
    path.resolve(backendDir, 'server.js'),
    'PM2 script path must resolve strictly to backend/server.js'
  );
  console.log('  [PASS] PM2 ecosystem.config.cjs targets backend/server.js');

  // 2. Check package.json scripts
  const pkgPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert(pkg.scripts.start.includes('backend/server.js'), 'package.json start script must run backend/server.js');
  assert(pkg.scripts.server.includes('backend/server.js'), 'package.json server script must run backend/server.js');
  assert(pkg.scripts['test:phase1'].includes('backend/test_phase1_multitenant_security.cjs'), 'test:phase1 must point to backend test suite');
  console.log('  [PASS] package.json scripts point strictly to backend/server.js');

  // 3. Check root server.js content
  const rootServerPath = path.join(rootDir, 'server.js');
  const rootServerContent = fs.readFileSync(rootServerPath, 'utf8');
  assert(rootServerContent.includes("require('./backend/server.js')"), 'root server.js must require ./backend/server.js');
  assert(!rootServerContent.includes("require('./routes/"), 'root server.js must NEVER require legacy ./routes/');
  assert(rootServerContent.length < 1000, 'root server.js must be a minimal launcher (< 1000 bytes)');
  console.log(`  [PASS] root server.js is a minimal canonical proxy (${rootServerContent.length} bytes)`);

  // 4. Verify legacy paths are absent from runtime
  const rootRoutesPath = path.join(rootDir, 'routes');
  assert(!fs.existsSync(rootRoutesPath), 'Legacy root routes/ directory must NOT exist in runtime');

  const backendBiEnginePath = path.join(backendDir, 'routes', 'bi_engine.js');
  assert(!fs.existsSync(backendBiEnginePath), 'backend/routes/bi_engine.js must be archived outside runtime routes');

  const archiveRoutes = path.join(rootDir, 'archive', 'legacy_routes_pre_phase1');
  assert(fs.existsSync(archiveRoutes), 'Legacy routes must be safely preserved in archive/legacy_routes_pre_phase1');
  console.log('  [PASS] Legacy routes and bi_engine safely archived outside runtime tree');

  // 5. Parity between server imports
  const rootLauncherModule = await import(pathToFileURL(rootServerPath).href);
  const canonicalBackend = require(path.join(backendDir, 'server.js'));
  assert.strictEqual(
    rootLauncherModule.app || rootLauncherModule.default.app,
    canonicalBackend.app,
    'root server.js and backend/server.js must expose the identical Express app'
  );
  console.log('  [PASS] Root launcher and canonical backend share the identical Express application instance');

  console.log('=== TEST RESULT: CANONICAL SERVER PARITY VERIFIED (PASS) ===\n');
}

run().catch(err => {
  console.error('[FAIL] Parity test failed:', err);
  process.exit(1);
});
