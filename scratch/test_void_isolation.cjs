const path = require('path');
const mysql = require(path.join(__dirname, '..', 'backend', 'node_modules', 'mysql2', 'promise'));
const fs = require('fs');

const envPath = path.join(__dirname, '..', 'backend', '.env');
const env = fs.readFileSync(envPath, 'utf8').split('\n').reduce((acc, line) => {
  const [k, ...v] = line.trim().split('=');
  if (k && v.length) acc[k] = v.join('=');
  return acc;
}, {});

const { createVisitsRouter } = require('../backend/routes/visits.routes');

async function runTests() {
  const pool = mysql.createPool({
    host: env.DB_HOST,
    user: env.DB_USER,
    password: env.DB_PASSWORD || env.DB_PASS,
    database: env.DB_NAME,
    timezone: '-04:00'
  });

  console.log('\n=============================================================');
  console.log('   TEST: CASH REGISTER VOID ISOLATION & INTEGRITY');
  console.log('=============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(title, condition, extra = '') {
    if (condition) {
      passed++;
      console.log(`  [PASS] ${title} ${extra ? `(${extra})` : ''}`);
    } else {
      failed++;
      console.error(`  [FAIL] ${title} ${extra ? `(${extra})` : ''}`);
    }
  }

  const { router: visitsRouter } = createVisitsRouter(pool, {});

  // Simulate express router endpoints
  // Helper to call router handlers
  async function callVoid(visitId, reason, user) {
    const layer = visitsRouter.stack.find(s => s.route && s.route.path === '/:id/void' && s.route.methods.post);
    if (!layer) throw new Error('Void route not found');
    const handler = layer.route.stack[0].handle;

    return new Promise((resolve) => {
      const req = {
        params: { id: visitId },
        body: { reason, voided_by: user }
      };
      const res = {
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          this.data = data;
          resolve({ status: this.statusCode || 200, data });
        }
      };
      handler(req, res).catch(err => {
        resolve({ status: 500, error: err.message });
      });
    });
  }

  try {
    // -------------------------------------------------------------
    // PRUEBA 1: VERIFICAR ESTADO Y BALANCE ACTUAL DE CAJA 220
    // -------------------------------------------------------------
    console.log('--- PRUEBA 1: Verificación de Caja 220 de Yafreisi ---');
    const [caja220] = await pool.query('SELECT * FROM cash_registers WHERE id = 220');
    assert('Caja 220 existe', caja220.length > 0);
    assert('Caja 220 monto_esperado es 7300.00', Number(caja220[0].monto_esperado) === 7300, `monto: ${caja220[0].monto_esperado}`);
    assert('Caja 220 monto_final es 7300.00', Number(caja220[0].monto_final) === 7300, `monto: ${caja220[0].monto_final}`);
    assert('Caja 220 diferencia es 0.00', Number(caja220[0].diferencia) === 0, `diff: ${caja220[0].diferencia}`);

    const [rogueMoves] = await pool.query("SELECT * FROM cash_register_movements WHERE cash_register_id = 220 AND visit_id = '1793749809812'");
    assert('No existe el movimiento fantasma 3275 en Caja 220', rogueMoves.length === 0);

    // -------------------------------------------------------------
    // PRUEBA 2: ANULAR VISITA NO FACTURADA (PRECUENTA/BORRADOR) NO TOCA NINGUNA CAJA
    // -------------------------------------------------------------
    console.log('\n--- PRUEBA 2: Anulación de Visita No Facturada (Precuenta) ---');
    const testUnbilledId = `TEST-UNBILLED-${Date.now()}`;
    await pool.query(
      `INSERT INTO visits (id, ticket_number, client_id, client_name, total, metodo_pago, status, salon_id, visited_at)
       VALUES (?, 'TK-UNBILLED-1', 'INVITADO', 'Cliente Borrador', 15000.00, 'Efectivo', 'Pendiente', 6, NOW())`,
      [testUnbilledId]
    );

    // Conteo de movimientos antes de anular
    const [movesBefore] = await pool.query('SELECT COUNT(*) as count FROM cash_register_movements');

    const voidRes = await callVoid(testUnbilledId, 'Cliente no se presentó', 'Admin Test');
    assert('Anulación de visita pendiente exitosa', voidRes.status === 200, `status: ${voidRes.status}`);

    const [movesAfter] = await pool.query('SELECT COUNT(*) as count FROM cash_register_movements');
    assert('NO se crearon movimientos en ninguna caja para la visita pendiente', movesBefore[0].count === movesAfter[0].count, `diff: ${movesAfter[0].count - movesBefore[0].count}`);

    const [visitCheck] = await pool.query('SELECT status, void_reason FROM visits WHERE id = ?', [testUnbilledId]);
    assert('Visita quedó marcada como Anulado', visitCheck[0].status === 'Anulado');

    // -------------------------------------------------------------
    // PRUEBA 3: AISLAMIENTO ENTRE SUCURSALES (NO CROSS-SALON LEAK)
    // -------------------------------------------------------------
    console.log('\n--- PRUEBA 3: Prevención Estricta de Cross-Salon en Anulaciones ---');
    // Creamos una caja de prueba sintética en Salón 1
    const [openCaja1] = await pool.query(
      `INSERT INTO cash_registers (register_number, employee_name, salon_id, monto_inicial, status, opened_at)
       VALUES (?, 'Cajera Salon 1', 1, 1000.00, 'Abierta', NOW())`,
      [`TEST-CR-S1-${Date.now()}`]
    );
    const testCaja1Id = openCaja1.insertId;

    // Creamos una visita en Salón 6 (donde NO hay caja abierta)
    const testCrossSalonVisitId = `TEST-CROSS-${Date.now()}`;
    await pool.query(
      `INSERT INTO visits (id, ticket_number, client_id, client_name, total, metodo_pago, status, salon_id, visited_at)
       VALUES (?, 'TK-CROSS-1', 'INVITADO', 'Cliente Salon 6', 8000.00, 'Efectivo', 'Facturado', 6, NOW())`,
      [testCrossSalonVisitId]
    );

    const voidCrossRes = await callVoid(testCrossSalonVisitId, 'Anulación prueba cross salon', 'Admin Test');
    assert('Anulación ejecutada', voidCrossRes.status === 200);

    // Verificar que la caja abierta de Salón 1 NO recibió el movimiento de Salón 6
    const [movesInCaja1] = await pool.query(
      'SELECT * FROM cash_register_movements WHERE cash_register_id = ? AND visit_id = ?',
      [testCaja1Id, testCrossSalonVisitId]
    );
    assert('La caja de Salón 1 NO fue afectada por la visita de Salón 6 (Cero cross-salon leak)', movesInCaja1.length === 0);

    // -------------------------------------------------------------
    // LIMPIEZA DE DATOS SINTÉTICOS DE PRUEBA
    // -------------------------------------------------------------
    console.log('\n--- LIMPIEZA DE DATOS SINTÉTICOS ---');
    await pool.query('DELETE FROM visits WHERE id IN (?, ?)', [testUnbilledId, testCrossSalonVisitId]);
    await pool.query('DELETE FROM audit_logs WHERE entity_id IN (?, ?)', [testUnbilledId, testCrossSalonVisitId]);
    await pool.query('DELETE FROM cash_registers WHERE id = ?', [testCaja1Id]);
    console.log('  [CLEANUP] Datos de prueba aislados eliminados.');

  } catch (err) {
    console.error('Fatal Test Error:', err);
    failed++;
  } finally {
    await pool.end();
  }

  console.log('\n=============================================================');
  console.log(`   TOTAL: ${passed} PASSED | ${failed} FAILED`);
  console.log('=============================================================\n');

  if (failed > 0) process.exit(1);
}

runTests();
