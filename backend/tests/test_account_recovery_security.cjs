/**
 * Security Test Suite: Account Recovery & Activation Hardening
 *
 * Verifies:
 * 1. Anti-enumeration: Forgot password returns identical generic response for existing vs non-existent accounts.
 * 2. Plaintext code elimination: Code is NEVER stored in plaintext in the DB (code is NULL, code_hash only).
 * 3. Cross-tenant code isolation: A code issued for Tenant A is strictly rejected when attempted against Tenant B.
 * 4. ClientId substitution defense: A code issued for Client A cannot be used to activate or reset Client B.
 * 5. Code single-use: A code once redeemed cannot be reused.
 * 6. Strict expiration: Expired codes are rejected.
 * 7. Brute-force invalidation: 5 consecutive failed code attempts immediately invalidates the code.
 * 8. Server isolation: Spawns its own ephemeral server connected exclusively to TEST_DB_*.
 */

const http = require('http');
const net = require('net');
const crypto = require('crypto');
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const { validateTestEnvironment, createIsolatedTestPool, getSanitizedChildEnv } = require('../utils/test_env_guard.cjs');

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

function waitForServerHealth(port, maxWaitMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1000, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - start > maxWaitMs) return reject(new Error(`Server failed to start on port ${port}`));
      setTimeout(check, 200);
    };
    check();
  });
}

function makeRequest({ path: reqPath, method = 'POST', headers = {} }, body = {}, port) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(data); } catch (e) { }
        resolve({ status: res.statusCode, body: parsed });
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function runRecoverySecuritySuite() {
  console.log('=== START TEST: ACCOUNT RECOVERY & ACTIVATION SECURITY SUITE ===\n');

  const testDbConfig = validateTestEnvironment({ allowDisposableSchema: true });
  const pool = createIsolatedTestPool(testDbConfig);

  let serverProcess = null;
  let testPort = null;
  let passed = 0;

  const TENANT_A = crypto.randomUUID();
  const TENANT_B = crypto.randomUUID();
  const TENANT_SUSP = crypto.randomUUID();
  const CLIENT_A_ID = crypto.randomUUID();
  const CLIENT_B_ID = crypto.randomUUID();
  const SHARED_CLIENT_A_ID = crypto.randomUUID();
  const SHARED_CLIENT_B_ID = crypto.randomUUID();
  let SUSP_OWNER_ID = null;

  try {
    // 0. Levantar servidor efímero aislado con variables sanitizadas
    testPort = await getEphemeralPort();
    console.log(`[SPAWN] Servidor efímero asignado a puerto: ${testPort}`);
    const childEnv = getSanitizedChildEnv(testDbConfig, testPort);

    serverProcess = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    serverProcess.on('error', (err) => {
      console.error('❌ Error en servidor efímero:', err.message);
    });

    await waitForServerHealth(testPort);
    console.log(`✅ Servidor efímero listo en http://127.0.0.1:${testPort}/api/health\n`);

    // Comprobar aislamiento de base de datos
    const dbCheckRes = await makeRequest({ path: '/api/health/db-check', method: 'GET' }, {}, testPort);
    assert.strictEqual(dbCheckRes.body.database, testDbConfig.database, 'Server must connect strictly to test database');
    console.log(`[DB VERIFIED] Servidor conectado a base de prueba segura: "${dbCheckRes.body.database}"\n`);

    // 0. Setup test tenants and clients en base de pruebas
    console.log('[SETUP] Creating test tenants and clients...');
    const TENANT_A_SLUG = `rec-a-${Date.now()}`;
    const TENANT_B_SLUG = `rec-b-${Date.now()}`;
    await pool.query('INSERT INTO tenants (id, business_name, slug, email) VALUES (?, ?, ?, ?)', [TENANT_A, 'Tenant Rec A', TENANT_A_SLUG, 'tenant.a@test-fixtures.local']);
    await pool.query('INSERT INTO tenants (id, business_name, slug, email) VALUES (?, ?, ?, ?)', [TENANT_B, 'Tenant Rec B', TENANT_B_SLUG, 'tenant.b@test-fixtures.local']);

    await pool.query(
      "INSERT INTO clients (id, tenant_id, nombre, email, status) VALUES (?, ?, 'Client Rec A', 'client.a@test-fixtures.local', 'Active')",
      [CLIENT_A_ID, TENANT_A]
    );
    await pool.query(
      "INSERT INTO clients (id, tenant_id, nombre, email, status) VALUES (?, ?, 'Client Rec B', 'client.b@test-fixtures.local', 'Active')",
      [CLIENT_B_ID, TENANT_B]
    );

    // 1. Anti-Enumeration Test & Plaintext Code Prohibition Verification
    console.log('[TEST 1] Anti-Enumeration & Plaintext Prohibition: Requesting forgot-password...');
    const resExist = await makeRequest({ path: '/api/auth/forgot-password' }, {
      email: 'client.a@test-fixtures.local',
      tenant_id: TENANT_A
    }, testPort);
    const resNonExist = await makeRequest({ path: '/api/auth/forgot-password' }, {
      email: 'totally_non_existent@test-fixtures.local',
      tenant_id: TENANT_A
    }, testPort);

    assert.strictEqual(resExist.status, 200, 'Existing user must return 200');
    assert.strictEqual(resNonExist.status, 200, 'Non-existent user must also return 200 (anti-enumeration)');
    assert.strictEqual(resExist.body.message, resNonExist.body.message, 'Message must be identical to prevent enumeration');
    assert.strictEqual(resExist.body.code, undefined, 'Plaintext code must NEVER appear in API response');
    console.log('  [PASS] Anti-enumeration verified: identical responses returned without code exposure.\n');
    passed++;

    // Inspect database: Verify that code column is NULL and ONLY code_hash is stored
    const [codeRows] = await pool.query(
      "SELECT id, code, code_hash FROM verification_codes WHERE tenant_id = ? AND (user_id = ? OR client_id = ?) AND is_used = 0 ORDER BY id DESC LIMIT 1",
      [TENANT_A, CLIENT_A_ID, CLIENT_A_ID]
    );
    assert(codeRows.length > 0, 'Code record must be created in verification_codes');
    assert.strictEqual(codeRows[0].code, null, 'Plaintext code column MUST be strictly NULL in database');
    assert.notStrictEqual(codeRows[0].code_hash, null, 'Cryptographic code_hash MUST be present in database');
    assert.strictEqual(codeRows[0].code_hash.length, 64, 'code_hash must be a valid 64-char hex SHA-256 string');
    console.log('  [PASS] Database inspection passed: Plaintext code is NULL, code_hash is SHA-256.\n');
    passed++;

    // Provision a known test code with hash-only for subsequent authentication tests
    const validTestCode = '839214';
    const validTestHash = crypto.createHash('sha256').update(validTestCode).digest('hex');
    await pool.query(
      "INSERT INTO verification_codes (tenant_id, user_id, client_id, identity, purpose, channel, code, code_hash, attempts, max_attempts, expires_at, is_used) VALUES (?, ?, ?, 'client.a@test-fixtures.local', 'password_reset', 'email', NULL, ?, 0, 5, NOW() + INTERVAL '15 MINUTE', 0)",
      [TENANT_A, CLIENT_A_ID, CLIENT_A_ID, validTestHash]
    );

    // 2. Cross-Tenant Code Usage Test
    console.log('[TEST 2] Cross-Tenant Code Defense: Attempting to verify Tenant A code under Tenant B...');
    const crossTenantVerify = await makeRequest({ path: '/api/auth/verify-code' }, {
      code: validTestCode,
      clientId: CLIENT_A_ID,
      tenant_id: TENANT_B // Intentionally mismatched tenant
    }, testPort);
    assert.strictEqual(crossTenantVerify.status, 400, 'Cross-tenant verification must be rejected with 400');
    console.log('  [PASS] Cross-tenant code usage rejected.\n');
    passed++;

    // 3. ClientId Substitution Test
    console.log('[TEST 3] ClientId Substitution Defense: Attempting to reset Client B with Client A code...');
    const spoofReset = await makeRequest({ path: '/api/auth/reset-password' }, {
      code: validTestCode,
      newPassword: 'newValidPassword123*',
      clientId: CLIENT_B_ID, // Mismatched client ID
      tenant_id: TENANT_A
    }, testPort);
    assert.strictEqual(spoofReset.status, 400, 'ClientId spoofing/substitution must be rejected with 400');
    console.log('  [PASS] ClientId substitution attack blocked.\n');
    passed++;

    // 4. Valid Password Reset & Code Single-Use Test
    console.log('[TEST 4] Valid Password Reset & Single-Use Enforcement...');
    const validReset = await makeRequest({ path: '/api/auth/reset-password' }, {
      code: validTestCode,
      newPassword: 'newValidPassword123*',
      clientId: CLIENT_A_ID,
      tenant_id: TENANT_A
    }, testPort);
    assert.strictEqual(validReset.status, 200, 'Legitimate password reset must return 200');

    // Attempt to reuse the same code
    const reuseReset = await makeRequest({ path: '/api/auth/reset-password' }, {
      code: validTestCode,
      newPassword: 'anotherPassword456*',
      clientId: CLIENT_A_ID,
      tenant_id: TENANT_A
    }, testPort);
    assert.strictEqual(reuseReset.status, 400, 'Reusing a redeemed code must return 400');
    console.log('  [PASS] Valid reset succeeded and code reuse was strictly blocked.\n');
    passed++;

    // 5. Code Expiration Test
    console.log('[TEST 5] Expiration Enforcement: Attempting to use expired code...');
    const expiredCode = '987654';
    const expiredHash = crypto.createHash('sha256').update(expiredCode).digest('hex');
    await pool.query(
      "INSERT INTO verification_codes (tenant_id, user_id, client_id, identity, purpose, channel, code, code_hash, attempts, max_attempts, expires_at, is_used) VALUES (?, ?, ?, 'test@test-fixtures.local', 'password_reset', 'email', NULL, ?, 0, 5, NOW() - INTERVAL '10 MINUTE', 0)",
      [TENANT_A, CLIENT_A_ID, CLIENT_A_ID, expiredHash]
    );

    const expiredRes = await makeRequest({ path: '/api/auth/reset-password' }, {
      code: expiredCode,
      newPassword: 'password789*',
      clientId: CLIENT_A_ID,
      tenant_id: TENANT_A
    }, testPort);
    assert.strictEqual(expiredRes.status, 400, 'Expired code must return 400');
    console.log('  [PASS] Expired code rejected.\n');
    passed++;

    // 6. Brute Force Lockout Test (5 Failed Attempts)
    console.log('[TEST 6] Brute-Force Lockout Defense: Triggering 5 consecutive failed attempts...');
    const bruteCode = '112233';
    const bruteHash = crypto.createHash('sha256').update(bruteCode).digest('hex');
    const [insRes] = await pool.query(
      "INSERT INTO verification_codes (tenant_id, user_id, client_id, identity, purpose, channel, code, code_hash, attempts, max_attempts, expires_at, is_used) VALUES (?, ?, ?, 'test@test-fixtures.local', 'password_reset', 'email', NULL, ?, 0, 5, NOW() + INTERVAL '15 MINUTE', 0) RETURNING id",
      [TENANT_A, CLIENT_A_ID, CLIENT_A_ID, bruteHash]
    );
    const bruteRecordId = insRes[0].id;

    for (let i = 1; i <= 5; i++) {
      const failRes = await makeRequest({ path: '/api/auth/verify-code' }, {
        code: '999999', // Incorrect guess
        clientId: CLIENT_A_ID,
        tenant_id: TENANT_A
      }, testPort);
      assert(failRes.status === 400 || failRes.status === 429, `Failed attempt ${i} must return 400 or 429 (got ${failRes.status})`);
    }

    // Verify record in database is marked is_used = 1 due to max attempts reached
    const [checkLocked] = await pool.query(
      'SELECT is_used, attempts FROM verification_codes WHERE id = ?',
      [bruteRecordId]
    );
    assert.strictEqual(checkLocked[0].is_used, 1, 'Code must be marked is_used = 1 after 5 failed attempts');
    assert(checkLocked[0].attempts >= 5, 'Attempts must reflect 5 failed tries');

    // Attempt with correct code now -> must be rejected because it was invalidated
    const postLockoutRes = await makeRequest({ path: '/api/auth/verify-code' }, {
      code: bruteCode,
      clientId: CLIENT_A_ID,
      tenant_id: TENANT_A
    }, testPort);
    assert(postLockoutRes.status === 400 || postLockoutRes.status === 429, 'Even correct code must now be rejected because it was invalidated by brute force');
    console.log('  [PASS] Brute-force lockout confirmed: code invalidated after 5 failed attempts.\n');
    passed++;

    // 7. B2C Multi-Tenant Ambiguity & Token Binding (Same email in 2 active companies)
    console.log('[TEST 7] B2C Multi-Tenant: Same email in 2 active tenants must NOT arbitrarily pick one & token must stay bound...');
    const sharedEmail = `shared.b2c.${Date.now()}@test-fixtures.local`;
    await pool.query(
      "INSERT INTO clients (id, tenant_id, nombre, email, password, status) VALUES (?, ?, 'Shared B2C A', ?, 'orig-hash-a', 'Active')",
      [SHARED_CLIENT_A_ID, TENANT_A, sharedEmail]
    );
    await pool.query(
      "INSERT INTO clients (id, tenant_id, nombre, email, password, status) VALUES (?, ?, 'Shared B2C B', ?, 'orig-hash-b', 'Active')",
      [SHARED_CLIENT_B_ID, TENANT_B, sharedEmail]
    );

    // 7a. Public request without tenant_id -> generic response (anti-enumeration), ZERO tokens issued
    const ambiguousRes = await makeRequest({ path: '/api/auth/forgot-password' }, {
      email: sharedEmail
    }, testPort);
    assert.strictEqual(ambiguousRes.status, 200, 'Ambiguous multi-tenant request must return 200 generic response');
    assert.strictEqual(ambiguousRes.body.message, resNonExist.body.message, 'Ambiguous response must match non-existent response (anti-enumeration)');

    const [ambTokens] = await pool.query(
      'SELECT id, tenant_id, client_id FROM verification_codes WHERE identity = ?',
      [sharedEmail]
    );
    assert.strictEqual(ambTokens.length, 0, 'Ambiguous public B2C request MUST NOT arbitrarily create a token for either tenant');

    // 7b. Scoped request using tenant_slug (as sent by recovery UI) -> issues token bound strictly to (TENANT_A, SHARED_CLIENT_A_ID)
    const scopedRes = await makeRequest({ path: '/api/auth/forgot-password' }, {
      email: sharedEmail,
      tenant_slug: TENANT_A_SLUG
    }, testPort);
    assert.strictEqual(scopedRes.status, 200);
    const [scopedTokens] = await pool.query(
      "SELECT id, tenant_id, user_id, client_id FROM verification_codes WHERE identity = ? AND purpose = 'password_reset_link' AND is_used = 0",
      [sharedEmail]
    );
    assert.strictEqual(scopedTokens.length, 1, 'Scoped request via tenant_slug must create exactly 1 token');
    assert.strictEqual(String(scopedTokens[0].tenant_id), TENANT_A, 'Token must be bound to TENANT_A');
    assert.strictEqual(String(scopedTokens[0].client_id), SHARED_CLIENT_A_ID, 'Token must be bound to SHARED_CLIENT_A_ID');

    // Provision an active canonical B2C session in user_sessions to verify revocation upon password reset
    const activeB2CSessionId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO user_sessions (id, user_id, user_name, role, salon_id, ip_address, user_agent, is_active, created_at, last_activity, tenant_id)
       VALUES (?, ?, 'Shared B2C A', 'client', '1', '127.0.0.1', 'test-agent', 1, NOW(), NOW(), ?)`,
      [activeB2CSessionId, SHARED_CLIENT_A_ID, TENANT_A]
    );

    // 7c. Token link tampering defense: altering clientId or tenant_id must NOT change Client B password
    const rawLinkToken = crypto.randomBytes(32).toString('hex');
    const linkTokenHash = crypto.createHash('sha256').update(rawLinkToken).digest('hex');
    await pool.query(
      "INSERT INTO verification_codes (tenant_id, user_id, client_id, identity, purpose, channel, code, code_hash, attempts, max_attempts, expires_at, is_used) VALUES (?, ?, ?, ?, 'password_reset_link', 'email', NULL, ?, 0, 5, NOW() + INTERVAL '15 MINUTE', 0)",
      [TENANT_A, SHARED_CLIENT_A_ID, SHARED_CLIENT_A_ID, sharedEmail, linkTokenHash]
    );

    const tamperClientRes = await makeRequest({ path: '/api/auth/reset-password' }, {
      token: rawLinkToken,
      clientId: SHARED_CLIENT_B_ID,
      tenant_id: TENANT_B,
      newPassword: 'hijackPassword123*'
    }, testPort);
    assert.strictEqual(tamperClientRes.status, 400, 'Tampering clientId/tenant_id with a valid link token must be rejected with 400');

    // Verify neither client password changed on tamper
    const [checkAfterTamper] = await pool.query(
      'SELECT id, password FROM clients WHERE id IN (?, ?)',
      [SHARED_CLIENT_A_ID, SHARED_CLIENT_B_ID]
    );
    const passA1 = checkAfterTamper.find(r => r.id === SHARED_CLIENT_A_ID)?.password;
    const passB1 = checkAfterTamper.find(r => r.id === SHARED_CLIENT_B_ID)?.password;
    assert.strictEqual(passA1, 'orig-hash-a', 'Client A password must remain unchanged after tampered attempt');
    assert.strictEqual(passB1, 'orig-hash-b', 'Client B password must remain unchanged after tampered attempt');

    // 7d. Legitimate link token consumption updates ONLY Client A in Tenant A, revokes active B2C sessions, and leaves Client B intact
    const legitLinkRes = await makeRequest({ path: '/api/auth/reset-password' }, {
      token: rawLinkToken,
      newPassword: 'legitNewPasswordA123*'
    }, testPort);
    assert.strictEqual(legitLinkRes.status, 200, 'Legitimate link token reset must succeed');

    const [checkAfterLegit] = await pool.query(
      'SELECT id, password FROM clients WHERE id IN (?, ?)',
      [SHARED_CLIENT_A_ID, SHARED_CLIENT_B_ID]
    );
    const passA2 = checkAfterLegit.find(r => r.id === SHARED_CLIENT_A_ID)?.password;
    const passB2 = checkAfterLegit.find(r => r.id === SHARED_CLIENT_B_ID)?.password;
    assert.notStrictEqual(passA2, 'orig-hash-a', 'Client A password must be updated');
    assert.strictEqual(passB2, 'orig-hash-b', 'Client B password MUST remain untouched');

    const [sessAfterReset] = await pool.query(
      'SELECT is_active FROM user_sessions WHERE id = ? AND tenant_id = ?',
      [activeB2CSessionId, TENANT_A]
    );
    assert.strictEqual(Number(sessAfterReset[0]?.is_active), 0, 'Active B2C session in user_sessions MUST be revoked (is_active = 0) after password reset');
    console.log('  [PASS] Multi-tenant B2C ambiguity, tenant_slug resolution, token binding, and canonical B2C session revocation verified.\n');
    passed++;

    // 8. Suspended Tenant Owner Recovery: active-tenant filter on clients MUST NOT block Owner recovery
    console.log('[TEST 8] Suspended Tenant Owner Recovery: Owner of suspended tenant must be able to recover access...');
    const suspOwnerEmail = `owner.suspended.${Date.now()}@test-fixtures.local`;
    await pool.query(
      "INSERT INTO tenants (id, business_name, slug, email, status) VALUES (?, 'Tenant Suspended', ?, ?, 'suspended')",
      [TENANT_SUSP, `rec-susp-${Date.now()}`, suspOwnerEmail]
    );
    const [ownerIns] = await pool.query(
      "INSERT INTO users (tenant_id, username, email, name, nombre, role, password_hash) VALUES (?, ?, ?, 'Owner Suspended', 'Owner Suspended', 'owner', 'old-owner-hash') RETURNING id",
      [TENANT_SUSP, suspOwnerEmail, suspOwnerEmail]
    );
    SUSP_OWNER_ID = ownerIns[0].id;

    const suspForgotRes = await makeRequest({ path: '/api/auth/forgot-password' }, {
      email: suspOwnerEmail
    }, testPort);
    assert.strictEqual(suspForgotRes.status, 200);

    const [ownerTokens] = await pool.query(
      "SELECT id, tenant_id, user_id FROM verification_codes WHERE identity = ? AND purpose = 'password_reset_link' AND is_used = 0",
      [suspOwnerEmail]
    );
    assert.strictEqual(ownerTokens.length, 1, 'Owner of suspended tenant MUST receive a recovery token');
    assert.strictEqual(String(ownerTokens[0].tenant_id), TENANT_SUSP, 'Owner token must be bound to suspended tenant');
    assert.strictEqual(String(ownerTokens[0].user_id), `USER-${SUSP_OWNER_ID}`, 'Owner token must be bound to USER-<id>');

    const ownerRawToken = crypto.randomBytes(32).toString('hex');
    const ownerTokenHash = crypto.createHash('sha256').update(ownerRawToken).digest('hex');
    await pool.query(
      "INSERT INTO verification_codes (tenant_id, user_id, client_id, identity, purpose, channel, code, code_hash, attempts, max_attempts, expires_at, is_used) VALUES (?, ?, ?, ?, 'password_reset_link', 'email', NULL, ?, 0, 5, NOW() + INTERVAL '15 MINUTE', 0)",
      [TENANT_SUSP, `USER-${SUSP_OWNER_ID}`, `USER-${SUSP_OWNER_ID}`, suspOwnerEmail, ownerTokenHash]
    );
    const ownerResetRes = await makeRequest({ path: '/api/auth/reset-password' }, {
      token: ownerRawToken,
      newPassword: 'OwnerRecoveredPass2026!'
    }, testPort);
    assert.strictEqual(ownerResetRes.status, 200, 'Owner of suspended tenant must be able to reset password');

    const [ownerAfter] = await pool.query('SELECT password_hash FROM users WHERE id = ? AND tenant_id = ?', [SUSP_OWNER_ID, TENANT_SUSP]);
    assert.notStrictEqual(ownerAfter[0].password_hash, 'old-owner-hash', 'Suspended Owner password_hash must be updated');
    console.log('  [PASS] Owner of suspended tenant recovered access cleanly.\n');
    passed++;

  } finally {
    console.log('[TEARDOWN] Cleaning up recovery test fixtures and terminating ephemeral server...');
    if (serverProcess) {
      serverProcess.kill('SIGKILL');
    }
    try {
      await pool.query('DELETE FROM user_sessions WHERE tenant_id IN (?, ?, ?)', [TENANT_A, TENANT_B, TENANT_SUSP]);
      await pool.query('DELETE FROM verification_codes WHERE tenant_id IN (?, ?, ?)', [TENANT_A, TENANT_B, TENANT_SUSP]);
      await pool.query('DELETE FROM clients WHERE tenant_id IN (?, ?, ?)', [TENANT_A, TENANT_B, TENANT_SUSP]);
      await pool.query('DELETE FROM users WHERE tenant_id IN (?, ?, ?)', [TENANT_A, TENANT_B, TENANT_SUSP]);
      await pool.query('DELETE FROM tenants WHERE id IN (?, ?, ?)', [TENANT_A, TENANT_B, TENANT_SUSP]);
    } catch (_) {}
    await pool.end();
    console.log('  [PASS] Recovery test fixtures and ephemeral server destroyed cleanly.\n');
  }

  console.log(`=== TEST RESULT: ALL ${passed} RECOVERY SECURITY CHECKS PASSED (PASS) ===\n`);
  process.exit(0);
}

if (require.main === module) {
  runRecoverySecuritySuite()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[FATAL RECOVERY TEST ERROR]:', err);
      process.exit(1);
    });
}

module.exports = { runRecoverySecuritySuite };
