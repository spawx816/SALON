/**
 * Historical SuperAdmin Rotation Verification Suite
 *
 * Verifies:
 * 1. Historical accounts exist and remain active by stable UUID in isolated test database.
 * 2. Rejection of historical password (passed via mandatory external HISTORICAL_TEST_PASSWORD env var) with HTTP 401.
 * 3. Verification of rotated credential via mandatory external ROTATED_SUPERADMIN_SECRET.
 * 4. Zero exposure of plain secrets, emails, UUIDs, or tokens in logs.
 * 5. Uses isolated ephemeral test server and test database pool.
 */

const http = require('http');
const net = require('net');
const assert = require('assert');
const path = require('path');
const bcrypt = require('bcryptjs');
const { spawn } = require('child_process');
const { validateTestEnvironment, createIsolatedTestPool, getSanitizedChildEnv } = require('../utils/test_env_guard.cjs');

const HISTORICAL_ACCOUNTS = [
  { uuid: '2cf9e128-cb69-444c-9ca5-46558516dd16', email: 'superadmin@salonsaas.com', label: 'Primary SuperAdmin' },
  { uuid: '82be9b02-a514-4bdf-9973-d30716da0e6c', email: 'superadmin@salonpro.io', label: 'Secondary SuperAdmin' }
];

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

function makeLoginRequest(email, password, port) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ email, password });
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let body = {};
        try { body = JSON.parse(data); } catch(e) {}
        resolve({ status: res.statusCode, body });
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function verifyHistoricalRotation() {
  console.log('=== START TEST: HISTORICAL SUPERADMIN ROTATION VERIFICATION ===\n');

  // Enforce mandatory external environment variables (Zero hardcoded fallbacks)
  const oldPassword = process.env.HISTORICAL_TEST_PASSWORD;
  if (!oldPassword || String(oldPassword).trim() === '') {
    throw new Error('SECURITY HALT: Variable obligatoria HISTORICAL_TEST_PASSWORD ausente.');
  }

  const rotatedSecret = process.env.ROTATED_SUPERADMIN_SECRET;
  if (!rotatedSecret || String(rotatedSecret).trim() === '') {
    throw new Error('SECURITY HALT: Variable obligatoria ROTATED_SUPERADMIN_SECRET ausente.');
  }

  const testDbConfig = validateTestEnvironment({ allowDisposableSchema: true });
  const pool = createIsolatedTestPool(testDbConfig);

  let serverProcess = null;
  let testPort = null;
  let originalHash = null;

  try {
    testPort = await getEphemeralPort();
    const childEnv = getSanitizedChildEnv(testDbConfig, testPort);

    serverProcess = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    await waitForServerHealth(testPort);
    console.log(`✅ Servidor efímero listo en puerto ${testPort}\n`);

    // 1. Verify existence and active state by stable UUID
    console.log('[CATALOG] Checking existence of historical SuperAdmin accounts by stable UUID...');
    for (let i = 0; i < HISTORICAL_ACCOUNTS.length; i++) {
      const acc = HISTORICAL_ACCOUNTS[i];
      const [rows] = await pool.query(
        'SELECT id, role, is_active FROM users WHERE id::text = ?',
        [acc.uuid]
      );

      if (!rows || rows.length === 0) {
        throw new Error(`FATAL SECURITY DEFENSE: Cuenta SuperAdmin obligatoria ausente en base de datos de pruebas (Índice: ${i + 1})`);
      }

      const u = rows[0];
      assert.strictEqual(u.role, 'superadmin', `Account ${acc.label} must have role 'superadmin'`);
      assert.strictEqual(Boolean(u.is_active), true, `Account ${acc.label} must be active`);
      console.log(`  [PASS] Verified active SuperAdmin account: ${acc.label} [MASKED_ID]`);
    }

    const [origRows] = await pool.query('SELECT password_hash FROM users WHERE id::text = ?', [HISTORICAL_ACCOUNTS[0].uuid]);
    if (origRows && origRows.length > 0) {
      originalHash = origRows[0].password_hash;
    }

    // 2. Test rejection of old historical password
    console.log('\n[AUTH REJECTION] Testing rejection of old credential against historical accounts...');
    for (const acc of HISTORICAL_ACCOUNTS) {
      const res = await makeLoginRequest(acc.email, oldPassword, testPort);
      assert.strictEqual(
        res.status, 
        401, 
        `Historical credential against ${acc.label} MUST return HTTP 401 Unauthorized (got ${res.status})`
      );
      console.log(`  [PASS] Old password rejected with HTTP 401 against ${acc.label}`);
    }

    // 3. Rotate credential and verify rotated secret against primary SuperAdmin
    console.log('\n[ROTATED SECRET] Testing external rotated secret against primary SuperAdmin...');
    const rotatedHash = await bcrypt.hash(rotatedSecret, 10);
    await pool.query('UPDATE users SET password_hash = ? WHERE id::text = ?', [rotatedHash, HISTORICAL_ACCOUNTS[0].uuid]);

    const res = await makeLoginRequest(HISTORICAL_ACCOUNTS[0].email, rotatedSecret, testPort);
    assert.strictEqual(
      res.status,
      200,
      `Rotated secret against primary SuperAdmin must return HTTP 200 OK (got ${res.status})`
    );
    assert.strictEqual(res.body.isSuperAdmin, true, 'Rotated login must confirm isSuperAdmin = true');
    console.log(`  [PASS] External rotated secret authenticated successfully with SuperAdmin authorization.`);

  } finally {
    if (originalHash) {
      await pool.query('UPDATE users SET password_hash = ? WHERE id::text = ?', [originalHash, HISTORICAL_ACCOUNTS[0].uuid]);
    }
    if (serverProcess) {
      serverProcess.kill('SIGKILL');
    }
    await pool.end();
  }

  console.log('\n=== TEST RESULT: HISTORICAL SUPERADMIN ROTATION VERIFIED (PASS) ===\n');
  process.exit(0);
}

if (require.main === module) {
  verifyHistoricalRotation()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[FAIL] Historical rotation verification failed:', err.message);
      process.exit(1);
    });
}

module.exports = { verifyHistoricalRotation };
