/**
 * Test: AST Scanner Negative Verification Suite
 * 
 * Verifies that the AST scanner accurately catches all 7 required negative scenarios:
 * 1. Global query without tenant scoping in routes -> MISSING_TENANT_FILTER
 * 2. Tautological bypass filter -> TAUTOLOGICAL_TENANT_FILTER
 * 3. Unanalyzable dynamic SQL -> UNANALYZABLE_DYNAMIC_SQL
 * 4. Standalone worker file running raw un-scoped query -> MISSING_TENANT_FILTER
 * 5. Middleware file running raw un-scoped query -> MISSING_TENANT_FILTER
 * 6. Service file running raw un-scoped query -> MISSING_TENANT_FILTER
 * 7. Server file running raw un-scoped query -> MISSING_TENANT_FILTER
 */
const path = require('path');
const assert = require('assert');
const { scanFile } = require('./ast_multitenant_scanner.cjs');

console.log('=== START NEGATIVE TEST: AST SCANNER VERIFICATION SUITE ===\n');

const fixturesDir = path.resolve(__dirname, '..', 'tests', 'fixtures_scanner');

// Case 1: Global query without tenant
console.log('Testing Fixture 1: Global Query without tenant_id in route...');
const fix1 = scanFile(path.join(fixturesDir, 'fixture_1_global_query.js'));
assert(fix1.length > 0, 'Fixture 1 must yield violations');
assert(fix1.some(v => v.type === 'MISSING_TENANT_FILTER'), 'Fixture 1 must flag MISSING_TENANT_FILTER');
console.log('  [PASS] Fixture 1 correctly caught: MISSING_TENANT_FILTER\n');

// Case 2: Tautological filter query
console.log('Testing Fixture 2: Tautological Bypass Filter...');
const fix2 = scanFile(path.join(fixturesDir, 'fixture_2_tautology_query.js'));
assert(fix2.length > 0, 'Fixture 2 must yield violations');
assert(fix2.some(v => v.type === 'TAUTOLOGICAL_TENANT_FILTER'), 'Fixture 2 must flag TAUTOLOGICAL_TENANT_FILTER');
console.log('  [PASS] Fixture 2 correctly caught: TAUTOLOGICAL_TENANT_FILTER\n');

// Case 3: Unanalyzable dynamic SQL
console.log('Testing Fixture 3: Unanalyzable Dynamic SQL...');
const fix3 = scanFile(path.join(fixturesDir, 'fixture_3_dynamic_sql.js'));
assert(fix3.length > 0, 'Fixture 3 must yield violations');
assert(fix3.some(v => v.type === 'UNANALYZABLE_DYNAMIC_SQL'), 'Fixture 3 must flag UNANALYZABLE_DYNAMIC_SQL');
console.log('  [PASS] Fixture 3 correctly caught: UNANALYZABLE_DYNAMIC_SQL\n');

// Case 4: Non-route worker executing raw un-scoped query
console.log('Testing Fixture 4: Non-route worker executing raw un-scoped query...');
const fix4 = scanFile(path.join(fixturesDir, 'fixture_4_non_route_worker.cjs'));
assert(fix4.length > 0, 'Fixture 4 must yield violations');
assert(fix4.some(v => v.type === 'MISSING_TENANT_FILTER'), 'Fixture 4 must flag MISSING_TENANT_FILTER');
console.log('  [PASS] Fixture 4 correctly caught: MISSING_TENANT_FILTER\n');

// Case 5: Unscoped query inside middleware
console.log('Testing Fixture 5: Unscoped query inside middleware...');
const fix5 = scanFile(path.join(fixturesDir, 'fixture_5_unscoped_middleware.js'));
assert(fix5.length > 0, 'Fixture 5 must yield violations');
assert(fix5.some(v => v.type === 'MISSING_TENANT_FILTER'), 'Fixture 5 must flag MISSING_TENANT_FILTER in middleware');
console.log('  [PASS] Fixture 5 correctly caught: MISSING_TENANT_FILTER in middleware\n');

// Case 6: Unscoped query inside service
console.log('Testing Fixture 6: Unscoped query inside service...');
const fix6 = scanFile(path.join(fixturesDir, 'fixture_6_unscoped_service.js'));
assert(fix6.length > 0, 'Fixture 6 must yield violations');
assert(fix6.some(v => v.type === 'MISSING_TENANT_FILTER'), 'Fixture 6 must flag MISSING_TENANT_FILTER in service');
console.log('  [PASS] Fixture 6 correctly caught: MISSING_TENANT_FILTER in service\n');

// Case 7: Unscoped query inside server handler
console.log('Testing Fixture 7: Unscoped query inside server handler...');
const fix7 = scanFile(path.join(fixturesDir, 'fixture_7_unscoped_server.js'));
assert(fix7.length > 0, 'Fixture 7 must yield violations');
assert(fix7.some(v => v.type === 'MISSING_TENANT_FILTER'), 'Fixture 7 must flag MISSING_TENANT_FILTER in server');
console.log('  [PASS] Fixture 7 correctly caught: MISSING_TENANT_FILTER in server\n');

// Case 8: Unscoped queries against Phase 2B Inventory tables
console.log('Testing Fixture 8: Unscoped query inside Phase 2B Inventory tables...');
const fix8 = scanFile(path.join(fixturesDir, 'fixture_8_unscoped_inventory.js'));
assert(fix8.length >= 2, 'Fixture 8 must yield at least 2 violations (SELECT on inventory_stock and UPDATE on inventory_products)');
assert(fix8.every(v => v.type === 'MISSING_TENANT_FILTER'), 'Fixture 8 must flag MISSING_TENANT_FILTER for all unscoped inventory operations');
console.log('  [PASS] Fixture 8 correctly caught: MISSING_TENANT_FILTER on inventory_stock and inventory_products\n');

// Case 9: Unscoped queries against Phase 2D SaaS Billing tables
console.log('Testing Fixture 9: Unscoped query inside Phase 2D SaaS Billing tables...');
const fix9 = scanFile(path.join(fixturesDir, 'fixture_9_unscoped_billing.js'));
assert(fix9.length >= 2, 'Fixture 9 must yield at least 2 violations (SELECT on saas_invoices and UPDATE on saas_refunds)');
assert(fix9.every(v => v.type === 'MISSING_TENANT_FILTER'), 'Fixture 9 must flag MISSING_TENANT_FILTER for all unscoped billing operations');
console.log('  [PASS] Fixture 9 correctly caught: MISSING_TENANT_FILTER on saas_invoices and saas_refunds\n');

// Case 10: Scheduler (setInterval) inside server entrypoint
console.log('Testing Fixture 10: setInterval scheduler inside server entrypoint...');
const fix10 = scanFile(path.join(fixturesDir, 'fixture_10_setinterval_in_server.js'));
assert(fix10.length > 0, 'Fixture 10 must yield violations');
assert(fix10.some(v => v.type === 'PROHIBITED_SCHEDULER_IN_WEB_SERVER'), 'Fixture 10 must flag PROHIBITED_SCHEDULER_IN_WEB_SERVER');
console.log('  [PASS] Fixture 10 correctly caught: PROHIBITED_SCHEDULER_IN_WEB_SERVER\n');

// Case 11: Hostname conditioning on 'SPAWX'
console.log('Testing Fixture 11: Hostname check on SPAWX...');
const fix11 = scanFile(path.join(fixturesDir, 'fixture_11_spawx_hostname_reference.js'));
assert(fix11.length > 0, 'Fixture 11 must yield violations');
assert(fix11.some(v => v.type === 'PROHIBITED_HOSTNAME_REFERENCE'), 'Fixture 11 must flag PROHIBITED_HOSTNAME_REFERENCE');
console.log('  [PASS] Fixture 11 correctly caught: PROHIBITED_HOSTNAME_REFERENCE\n');

// Case 12: Worker loading backend/.env
console.log('Testing Fixture 12: Worker loading backend/.env...');
const fix12 = scanFile(path.join(fixturesDir, 'fixture_12_worker_dotenv_loading.cjs'));
assert(fix12.length > 0, 'Fixture 12 must yield violations');
assert(fix12.some(v => v.type === 'PROHIBITED_ENV_LOADING_IN_WORKER'), 'Fixture 12 must flag PROHIBITED_ENV_LOADING_IN_WORKER');
console.log('  [PASS] Fixture 12 correctly caught: PROHIBITED_ENV_LOADING_IN_WORKER\n');

// Case 13: Sensitive cardholder / PIN logging in console
console.log('Testing Fixture 13: Sensitive cardholder / PIN logging in console...');
const fix13 = scanFile(path.join(fixturesDir, 'fixture_13_sensitive_logging.js'));
assert(fix13.length >= 2, 'Fixture 13 must yield at least 2 violations');
assert(fix13.every(v => v.type === 'PROHIBITED_SENSITIVE_DATA_LOGGING'), 'Fixture 13 must flag PROHIBITED_SENSITIVE_DATA_LOGGING');
console.log('  [PASS] Fixture 13 correctly caught: PROHIBITED_SENSITIVE_DATA_LOGGING\n');

console.log('=== TEST RESULT: ALL 13 SCANNER NEGATIVE CHECKS PASSED (PASS) ===\n');
process.exit(0);
