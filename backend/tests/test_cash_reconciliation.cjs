/**
 * Quality Gate: Cash Register Reconciliation & Discrepancy Auditing (REM-P2-02 & Addendum 2)
 * (backend/tests/test_cash_reconciliation.cjs)
 */

'use strict';

const assert = require('assert');
const bcrypt = require('bcryptjs');
const { validateTestEnvironment, createIsolatedTestPool } = require('../utils/test_env_guard.cjs');
const { createCashRegistersRouter } = require('../routes/cash_registers.routes');
const express = require('express');
const http = require('http');

async function runCashReconciliationTests() {
  console.log('========================================================================');
  console.log('🛡️ SUITE: CONTROL DE ARQUEO Y DIFERENCIAS DE CAJA (REM-P2-02)');
  console.log('========================================================================\n');

  const testConfig = validateTestEnvironment({ allowDisposableSchema: true });
  const pool = createIsolatedTestPool(testConfig);
  const conn = await pool.getConnection();

  try {
    const tenantId = '00000000-0000-0000-0000-000000000001';
    const adminUserId = '00000000-0000-0000-0000-000000000099';
    const cashierUserId = '00000000-0000-0000-0000-000000000088';

    // Ensure tenant and supervisor user exist
    await conn.query(`
      INSERT INTO tenants (id, name, slug)
      VALUES ($1, 'Salon Arqueo Test', 'salon-arqueo-test')
      ON CONFLICT (id) DO NOTHING;
    `, [tenantId]);

    const pinHash = bcrypt.hashSync('849201', 10);
    await conn.query(`
      INSERT INTO security_settings (tenant_id, admin_pin_hash)
      VALUES ($1, $2)
      ON CONFLICT (tenant_id) DO UPDATE SET admin_pin_hash = EXCLUDED.admin_pin_hash;
    `, [tenantId, pinHash]);

    await conn.query(`
      INSERT INTO users (id, tenant_id, name, email, password, role)
      VALUES ($1, $2, 'Supervisor Marta', 'marta@example.com', 'dummy_hash', 'admin')
      ON CONFLICT (id) DO NOTHING;
    `, [adminUserId, tenantId]);

    // Setup lightweight express app
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.tenantId = tenantId;
      req.auth = { userId: cashierUserId, name: 'Cajera Luisa', role: 'cajero' };
      next();
    });
    app.use('/api/cash-registers', createCashRegistersRouter(pool));

    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const postClose = async (regId, payload) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/cash-registers/${regId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Correlation-Id': '11111111-2222-3333-4444-555555555555' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      return { status: res.status, data };
    };

    // Helper: create open cash register with expected balance = RD$ 1,000.00 (100,000 cents)
    const createRegister = async () => {
      const [res] = await conn.query(`
        INSERT INTO cash_registers (tenant_id, name, opening_amount, status, opened_at, created_at)
        VALUES ($1, 'Caja Arqueo', 1000.00, 'Abierta', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id;
      `, [tenantId]);
      return res[0].id;
    };

    // --- TEST 1: Cierre exacto sin diferencia ---
    console.log('--- TEST 1: Cierre exacto sin diferencia (cero centavos) ---');
    const reg1 = await createRegister();
    const close1 = await postClose(reg1, { closing_balance: 1000.00 });
    assert.strictEqual(close1.status, 200);
    assert.strictEqual(close1.data.difference, 0);
    assert.strictEqual(close1.data.difference_amount_cents, 0);
    console.log('  ✅ [PASS 1] Cierre exacto procesado directamente con 200 OK');

    // --- TEST 2: Discrepancia sin motivo rechazado con 400 ---
    console.log('\n--- TEST 2: Discrepancia sin motivo requerido rechazada con 400 ---');
    const reg2 = await createRegister();
    const close2 = await postClose(reg2, { closing_balance: 950.00 }); // Dif: -50.00
    assert.strictEqual(close2.status, 400);
    assert.strictEqual(close2.data.code, 'DISCREPANCY_REASON_REQUIRED');
    console.log('  ✅ [PASS 2] Solicitud rechazada por falta de motivo de discrepancia');

    // --- TEST 3: Discrepancia sin doble confirmación rechazada con 400 ---
    console.log('\n--- TEST 3: Discrepancia sin confirmación doble explícita rechazada ---');
    const reg3 = await createRegister();
    const close3 = await postClose(reg3, { closing_balance: 950.00, discrepancy_reason: 'Falta cambio en monedas' });
    assert.strictEqual(close3.status, 400);
    assert.strictEqual(close3.data.code, 'DOUBLE_CONFIRMATION_REQUIRED');
    console.log('  ✅ [PASS 3] Solicitud rechazada por falta de doble confirmación');

    // --- TEST 4: Discrepancia menor al umbral aprobada con motivo y doble confirmación ---
    console.log('\n--- TEST 4: Discrepancia menor al umbral (< RD$ 100) aprobada sin PIN ---');
    const reg4 = await createRegister();
    const close4 = await postClose(reg4, {
      closing_balance: 960.00, // Dif: -40.00 (4,000 centavos < 10,000 umbral)
      discrepancy_reason: 'Monedas de 5 pesos faltantes en caja chica',
      double_confirmed: true
    });
    assert.strictEqual(close4.status, 200);
    assert.strictEqual(close4.data.difference_amount_cents, -4000);
    assert.strictEqual(close4.data.authorization_event_type, 'OPERATOR_DOUBLE_CONFIRMED_UNDER_THRESHOLD');
    console.log('  ✅ [PASS 4] Discrepancia menor autorizada con motivo y doble confirmación');

    // --- TEST 5: Discrepancia mayor al umbral sin PIN rechazada con 403 ---
    console.log('\n--- TEST 5: Discrepancia mayor al umbral (>= RD$ 100) sin PIN rechazada con 403 ---');
    const reg5 = await createRegister();
    const close5 = await postClose(reg5, {
      closing_balance: 800.00, // Dif: -200.00 (20,000 centavos >= 10,000)
      discrepancy_reason: 'Error en vuelto de billete de dos mil',
      double_confirmed: true
    });
    assert.strictEqual(close5.status, 403);
    assert.strictEqual(close5.data.code, 'SUPERVISOR_PIN_REQUIRED');
    console.log('  ✅ [PASS 5] Discrepancia mayor bloqueada por ausencia de PIN de supervisor');

    // --- TEST 6: Discrepancia mayor con PIN erróneo rechazada con 401 ---
    console.log('\n--- TEST 6: Discrepancia mayor con PIN de supervisor erróneo rechazada con 401 ---');
    const close6 = await postClose(reg5, {
      closing_balance: 800.00,
      discrepancy_reason: 'Error en vuelto de billete de dos mil',
      double_confirmed: true,
      supervisor_pin: '999999' // Erróneo
    });
    assert.strictEqual(close6.status, 401);
    assert.strictEqual(close6.data.code, 'INVALID_ADMIN_PIN');
    console.log('  ✅ [PASS 6] PIN inválido rechazado con 401');

    // --- TEST 7: Discrepancia mayor con PIN válido y auditoría completa ---
    console.log('\n--- TEST 7: Discrepancia mayor con PIN válido y persistencia auditada ---');
    const close7 = await postClose(reg5, {
      closing_balance: 800.00,
      discrepancy_reason: 'Error en vuelto de billete de dos mil verificado por supervisor',
      double_confirmed: true,
      supervisor_pin: '849201' // Correcto
    });
    assert.strictEqual(close7.status, 200);
    assert.strictEqual(close7.data.supervisor_authorized, true);
    assert.strictEqual(close7.data.authorization_event_type, 'SUPERVISOR_PIN_THRESHOLD_EXCEEDED');

    // Verify DB persisted record
    const [dbReg] = await conn.query('SELECT * FROM cash_registers WHERE id = $1', [reg5]);
    assert.strictEqual(dbReg[0].difference_amount_cents, -20000);
    assert.strictEqual(dbReg[0].supervisor_user_id, adminUserId);
    assert.ok(dbReg[0].supervisor_authorized_at !== null);
    assert.strictEqual(dbReg[0].correlation_id, '11111111-2222-3333-4444-555555555555');
    console.log('  ✅ [PASS 7] Cierre aprobado con auditoría de supervisor y correlación persistida');

    server.close();
    console.log('\n========================================================================');
    console.log('🎉 TODAS LAS PRUEBAS DE ARQUEO Y DIFERENCIAS DE CAJA PASARON (PASS)');
    console.log('========================================================================\n');
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  runCashReconciliationTests().catch(err => {
    console.error('\n❌ [FAIL] Error en pruebas de arqueo:', err);
    process.exit(1);
  });
}

module.exports = { runCashReconciliationTests };

