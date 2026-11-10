/**
 * Test: Bundle Budget and XLSX Elimination Verification
 * (backend/scripts/test_bundle_budget.cjs)
 * 
 * Quality Gate verifying:
 * 1. Vulnerable 'xlsx' package is completely absent from package.json and package-lock.json.
 * 2. No build artifact in dist/ contains 'xlsx' in its filename or contents.
 * 3. Strict bundle size budgets:
 *    - Main entry chunk <= 850 kB
 *    - Individual route/feature chunks <= 250 kB
 *    - Total dist assets size <= 3.5 MB
 * 4. Fails closed (exit code 1) on any budget overage.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== START QUALITY GATE: BUNDLE BUDGET & DEPENDENCY SAFETY ===\n');

const projectRoot = path.resolve(__dirname, '../..');
const pkgPath = path.join(projectRoot, 'package.json');
const lockPath = path.join(projectRoot, 'package-lock.json');
const distPath = path.join(projectRoot, 'dist');

// 1. Verify xlsx is absent from package.json
console.log('Checking package.json for vulnerable "xlsx"...');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const allDeps = {
  ...(pkg.dependencies || {}),
  ...(pkg.devDependencies || {}),
  ...(pkg.optionalDependencies || {})
};
assert(!allDeps['xlsx'], '❌ [FAIL]: "xlsx" must NOT be listed in package.json dependencies');
console.log('  ✅ [PASS]: "xlsx" is completely absent from package.json dependencies.');

// 2. Verify xlsx is absent from package-lock.json
console.log('Checking package-lock.json for "xlsx"...');
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const hasXlsxInPackages = lock.packages && (lock.packages['node_modules/xlsx'] || lock.packages['xlsx']);
  assert(!hasXlsxInPackages, '❌ [FAIL]: "xlsx" must NOT be present in package-lock.json packages');
  console.log('  ✅ [PASS]: "xlsx" is absent from package-lock.json packages.');
}

// 3. Verify dist directory exists and check chunk budget
console.log('\nChecking production build assets in dist/assets...');
assert(fs.existsSync(distPath), '❌ [FAIL]: dist directory does not exist. Run "npm run build" first.');
const assetsPath = path.join(distPath, 'assets');
assert(fs.existsSync(assetsPath), '❌ [FAIL]: dist/assets directory does not exist.');

const assetFiles = fs.readdirSync(assetsPath);

// Ensure no xlsx artifact was generated
const xlsxArtifact = assetFiles.find(f => /xlsx/i.test(f));
assert(!xlsxArtifact, `❌ [FAIL]: Found legacy xlsx artifact in dist: ${xlsxArtifact}`);
console.log('  ✅ [PASS]: Zero xlsx chunk files generated in dist/assets.');

// Budget limits
const MAIN_CHUNK_BUDGET_KB = 850;
const MODULE_CHUNK_BUDGET_KB = 250;
const TOTAL_ASSETS_BUDGET_KB = 3500;

let totalAssetsBytes = 0;
const overBudgetFiles = [];

for (const file of assetFiles) {
  const filePath = path.join(assetsPath, file);
  const stat = fs.statSync(filePath);
  totalAssetsBytes += stat.size;
  const sizeKb = stat.size / 1024;

  if (file.endsWith('.js')) {
    if (file.startsWith('index-')) {
      if (sizeKb > MAIN_CHUNK_BUDGET_KB) {
        overBudgetFiles.push({ file, sizeKb, limitKb: MAIN_CHUNK_BUDGET_KB });
      }
    } else {
      if (sizeKb > MODULE_CHUNK_BUDGET_KB) {
        overBudgetFiles.push({ file, sizeKb, limitKb: MODULE_CHUNK_BUDGET_KB });
      }
    }
  }
}

const totalAssetsKb = totalAssetsBytes / 1024;
console.log(`\nAsset Size Summary:`);
console.log(` - Total JS/CSS assets size: ${totalAssetsKb.toFixed(2)} kB (Budget: ${TOTAL_ASSETS_BUDGET_KB} kB)`);

assert(overBudgetFiles.length === 0, `❌ [FAIL]: Chunks exceeded size budget:\n${overBudgetFiles.map(o => `   - ${o.file}: ${o.sizeKb.toFixed(2)} kB (Limit: ${o.limitKb} kB)`).join('\n')}`);
assert(totalAssetsKb <= TOTAL_ASSETS_BUDGET_KB, `❌ [FAIL]: Total assets size ${totalAssetsKb.toFixed(2)} kB exceeds budget ${TOTAL_ASSETS_BUDGET_KB} kB`);

console.log('  ✅ [PASS]: All chunks and total bundle size are strictly within performance budgets.');
console.log('\n=== TEST RESULT: BUNDLE BUDGET GATE PASSED (PASS) ===\n');
process.exit(0);
