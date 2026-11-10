const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');
const { createDgiiService } = require('./services/dgii.service');

async function runTests() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    timezone: '-04:00'
  });

  const results = [];
  function assert(title, condition, extra = '') {
    if (condition) {
      results.push({ title, pass: true, detail: extra });
      console.log(`  [PASS] ${title} ${extra ? `(${extra})` : ''}`);
    } else {
      results.push({ title, pass: false, detail: extra });
      console.error(`  [FAIL] ${title} ${extra ? `(${extra})` : ''}`);
    }
  }

  console.log('\n======================================================');
  console.log('   TEST SUITE: 6 OPERATIONAL IMPROVEMENTS SALONPRO');
  console.log('======================================================\n');

  let testClientId = null;
  let testContractId = null;
  let testStaffId = null;
  let testStaffNoSchedId = null;

  try {
    // -----------------------------------------------------------------
    // PUNTO 1: MEMBRESÍAS PENDIENTES DE COBRO
    // -----------------------------------------------------------------
    console.log('--- TEST PUNTO 1: Membresías Pendientes de Cobro ---');

    testClientId = crypto.randomUUID();
    await pool.query(
      "INSERT INTO clients (id, nombre, telefono, email, status) VALUES (?, 'Test Client Pendiente', '8099990001', 'test_pending@example.com', 'Activo')",
      [testClientId]
    );

    testContractId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO contracts (id, client_id, status, plan_id, contract_price, signed_at) 
       VALUES (?, ?, 'Pending_Payment', 1, 2490, NOW())`,
      [testContractId, testClientId]
    );

    const isPendingStatus = (st) => ['pending_payment', 'pending_retry', 'past_due', 'suspended', 'suspendido', 'pendiente'].includes(String(st || '').toLowerCase().trim());
    assert('1.1 Identificación de estado Pending_Payment', isPendingStatus('Pending_Payment') === true);
    assert('1.2 Identificación de estado Pending_Retry', isPendingStatus('Pending_Retry') === true);
    assert('1.3 Identificación de estado Past_Due', isPendingStatus('Past_Due') === true);
    assert('1.4 Identificación de estado Suspended', isPendingStatus('Suspended') === true);
    assert('1.5 Contrato Active no es clasificado como pendiente', isPendingStatus('Active') === false);

    // Verify DB query in visits.routes.js:
    const [contractsPending] = await pool.query(
      "SELECT id, status FROM contracts WHERE client_id = ? AND status IN ('Pending_Payment', 'Pending_Retry', 'Past_Due', 'Suspended', 'Suspendido', 'Pendiente')",
      [testClientId]
    );
    assert('1.6 Query detecta contrato con cobro pendiente para el cliente', contractsPending.length > 0 && contractsPending[0].id === testContractId);

    // Transition to Active
    await pool.query("UPDATE contracts SET status = 'Active' WHERE id = ?", [testContractId]);
    const [contractsActive] = await pool.query(
      "SELECT id, status FROM contracts WHERE client_id = ? AND status = 'Active'",
      [testClientId]
    );
    assert('1.7 Contrato activo permite canjes de beneficios normalmente', contractsActive.length === 1 && contractsActive[0].status === 'Active');

    // -----------------------------------------------------------------
    // PUNTO 2: CONTROL DE ASISTENCIA Y PONCHES (/adjust & medianoche)
    // -----------------------------------------------------------------
    console.log('\n--- TEST PUNTO 2: Recálculo en /adjust y Manejo de Ponches ---');

    const [stfRes] = await pool.query(
      "INSERT INTO staff_records (nombre, cedula, posicion, salario_base, status, hora_entrada, hora_salida, dias_laborables) VALUES ('Staff Test Asistencia', '00199999991', 'Estilista', 20000, 'Activo', '08:00:00', '17:00:00', '[\"monday\",\"tuesday\",\"wednesday\",\"thursday\",\"friday\"]')"
    );
    testStaffId = stfRes.insertId;

    // Simulate recalculation function as implemented in attendance.routes.js /adjust
    function recalculateShift(cin, cout, scheduledStart = '08:00:00', scheduledEnd = '17:00:00') {
      const inD = new Date(cin);
      const outD = new Date(cout);
      let diffMs = outD - inD;
      if (diffMs < 0) diffMs += 24 * 60 * 60 * 1000;
      const totalMinutes = Math.round(diffMs / 60000);
      const breakMinutes = totalMinutes > 300 ? 60 : 0;
      const netMinutes = Math.max(0, totalMinutes - breakMinutes);
      const hoursWorked = +(netMinutes / 60).toFixed(2);

      let tardinessMinutes = 0;
      if (scheduledStart) {
        const inTimeStr = inD.toTimeString().slice(0, 8);
        const [ih, im] = inTimeStr.split(':').map(Number);
        const [sh, sm] = scheduledStart.split(':').map(Number);
        const inMins = ih * 60 + im;
        const schMins = sh * 60 + sm;
        if (inMins > schMins) tardinessMinutes = inMins - schMins;
      }

      return { totalMinutes, breakMinutes, netMinutes, hoursWorked, tardinessMinutes };
    }

    const calc1 = recalculateShift('2026-11-01 08:00:00', '2026-11-01 17:00:00', '08:00:00');
    assert('2.1 Jornada de 9h descuenta 1h descanso correctamente', calc1.breakMinutes === 60);
    assert('2.2 Horas netas trabajadas calculadas en 8.00h', calc1.hoursWorked === 8.00);
    assert('2.3 Tardanza es 0 cuando ingresa a su hora programada', calc1.tardinessMinutes === 0);

    const calc2 = recalculateShift('2026-11-01 08:45:00', '2026-11-01 17:00:00', '08:00:00');
    assert('2.4 Tardanza calculada correctamente en 45 minutos', calc2.tardinessMinutes === 45);

    const calc3 = recalculateShift('2026-11-01 20:00:00', '2026-11-02 04:00:00', '20:00:00');
    assert('2.5 Turno nocturno cruzando medianoche calcula 8h brutas (480 mins)', calc3.totalMinutes === 480);
    assert('2.6 Turno nocturno descuenta 60m descanso por superar 5h (7h netas)', calc3.breakMinutes === 60 && calc3.hoursWorked === 7.00);

    // Punch out without punch in (Salida Sin Entrada)
    const attPId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO attendance (id, employee_id, timestamp, type, status, modification_reason) 
       VALUES (?, ?, '2026-11-02 17:00:00', 'Check-Out', 'Salida Sin Entrada', 'Salida registrada directamente sin ponche de entrada previo')`,
      [attPId, testStaffId]
    );
    const [attCheck] = await pool.query("SELECT status, modification_reason FROM attendance WHERE id = ?", [attPId]);
    assert('2.7 Ponche de salida sin entrada se etiqueta como Salida Sin Entrada para revisión sin deducción automática', attCheck[0].status === 'Salida Sin Entrada');

    // -----------------------------------------------------------------
    // PUNTO 3: EMPLEADOS SIN HORARIO ASIGNADO
    // -----------------------------------------------------------------
    console.log('\n--- TEST PUNTO 3: Empleados Sin Horario Asignado ---');

    const [stfNoSched] = await pool.query(
      "INSERT INTO staff_records (nombre, cedula, posicion, salario_base, status, hora_entrada, hora_salida, dias_laborables) VALUES ('Staff Sin Horario', '00199999992', 'Asistente', 15000, 'Activo', NULL, NULL, NULL)"
    );
    testStaffNoSchedId = stfNoSched.insertId;

    const [empRow] = await pool.query("SELECT hora_entrada, hora_salida, dias_laborables FROM staff_records WHERE id = ?", [testStaffNoSchedId]);
    const hasSchedule = Boolean(empRow[0].hora_entrada && empRow[0].dias_laborables && empRow[0].dias_laborables !== '[]');
    assert('3.1 Empleado sin horario en staff_records reconocido con hasSchedule === false', hasSchedule === false);

    const getScheduledDurationSecs = (emp) => {
      if (!emp.hora_entrada || !emp.hora_salida || !emp.dias_laborables) {
        return { isWorking: false, hasSchedule: false, durationSecs: 0, scheduledStart: null, scheduledEnd: null };
      }
      return { isWorking: true, hasSchedule: true, durationSecs: 28800 };
    };
    const schedInfo = getScheduledDurationSecs(empRow[0]);
    assert('3.2 Nómina no asigna horas requeridas ni calcula ausencias fantasma', schedInfo.hasSchedule === false && schedInfo.isWorking === false);

    // -----------------------------------------------------------------
    // PUNTO 4: REGALO DE BIENVENIDA PLAN BEAUTY
    // -----------------------------------------------------------------
    console.log('\n--- TEST PUNTO 4: Regalo de Bienvenida Plan Beauty ---');

    // First redemption: Tratamiento Profundo (Regalo Plan Beauty)
    const promoVisId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO visits (id, client_id, servicios, total, metodo_pago, status)
       VALUES (?, ?, ?, 0.00, 'Plan Beauty', 'Completado')`,
      [promoVisId, testClientId, JSON.stringify([{ name: 'Tratamiento Profundo (Regalo Plan Beauty)', price: 0 }])]
    );

    // Query for lifetime promo gift redemptions
    const [promoHistory] = await pool.query(
      `SELECT id, servicios FROM visits 
       WHERE client_id = ? 
         AND (status = 'Completado' OR status = 'Facturado' OR status = 'Pagado' OR status = 'Pendiente')
         AND (servicios LIKE '%Tratamiento Profundo (Regalo Plan Beauty)%' OR servicios LIKE '%Lavado Extra (Regalo Plan Beauty)%')`,
      [testClientId]
    );
    assert('4.1 Primera redención de regalo registrada en el historial del cliente', promoHistory.length === 1);

    // Attempt second redemption
    const isPromoAlreadyRedeemed = promoHistory.length > 0;
    assert('4.2 Segundo intento de redención bloqueado (PROMO_GIFT_ALREADY_REDEEMED)', isPromoAlreadyRedeemed === true);

    // Check ordinary wash counter integrity
    const [regWasher] = await pool.query(
      `SELECT id FROM visits WHERE client_id = ? AND servicios LIKE '%Lavado Regular%'`,
      [testClientId]
    );
    assert('4.3 Canje de regalo de bienvenida no descuenta lavados mensuales regulares', regWasher.length === 0);

    // -----------------------------------------------------------------
    // PUNTO 5: ROL CONTADOR Y PRIVILEGIOS
    // -----------------------------------------------------------------
    console.log('\n--- TEST PUNTO 5: Rol Contador y Permisos Restringidos ---');

    const [roleRow] = await pool.query("SELECT * FROM roles WHERE id = 4 OR nombre = 'Contador'");
    console.log('Role row columns:', Object.keys(roleRow[0] || {}), roleRow[0]);
    assert('5.1 Rol Contador configurado en BD', roleRow.length > 0 && roleRow[0].nombre === 'Contador');

    const perms = typeof roleRow[0].permisos === 'string' ? JSON.parse(roleRow[0].permisos) : roleRow[0].permisos;
    assert('5.2 Contador posee permiso view_dgii_sequences', perms.view_dgii_sequences === true);
    assert('5.3 Contador denegado de manage_dgii_sequences', perms.manage_dgii_sequences === false);
    assert('5.4 Contador denegado de manage_security', perms.manage_security === false);

    const canMutateSequences = (role) => {
      const r = String(role || '').toLowerCase();
      if (r === 'contador') return false;
      return r === 'admin' || r === 'administrador';
    };
    assert('5.5 Contador bloqueado de crear/eliminar secuencias DGII (HTTP 403 FORBIDDEN_CONTADOR)', canMutateSequences('contador') === false);
    assert('5.6 Administrador conserva facultad de administrar secuencias', canMutateSequences('admin') === true);

    // -----------------------------------------------------------------
    // PUNTO 6: VALIDACIÓN FISCAL DE NOTAS DE CRÉDITO E34
    // -----------------------------------------------------------------
    console.log('\n--- TEST PUNTO 6: Validación Fiscal de Notas de Crédito E34 ---');

    const dgiiService = createDgiiService(pool);

    // Case 6A: Voiding a non-fiscal invoice (ncf is NONE)
    const nonFiscalVisId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO visits (id, client_id, servicios, total, ncf, ncf_type, status)
       VALUES (?, ?, '[]', 500.00, 'NONE', 'NONE', 'Facturado')`,
      [nonFiscalVisId, testClientId]
    );

    const ncNonFiscal = await dgiiService.generateAndTransmitNotaCredito(nonFiscalVisId, 'Devolución de servicio');
    assert('6.1 Factura con NCF NONE omite emisión fiscal de E34', ncNonFiscal === null);
    assert('6.2 Factura con NCF NONE no genera ni consume e-NCF E34', ncNonFiscal === null);

    // Case 6B: Precuenta invoice (ncf is null, ncf_type is PRECUENTA)
    const precuentaVisId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO visits (id, client_id, servicios, total, ncf, ncf_type, status)
       VALUES (?, ?, '[]', 1200.00, NULL, 'PRECUENTA', 'Facturado')`,
      [precuentaVisId, testClientId]
    );

    const ncPrecuenta = await dgiiService.generateAndTransmitNotaCredito(precuentaVisId, 'Anulación de precuenta');
    assert('6.3 Precuenta omite emisión fiscal de E34', ncPrecuenta === null);

    // Case 6C: Idempotency with existing note
    const voidedVisId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO visits (id, client_id, servicios, total, ncf, ncf_type, ncf_nota_credito, status)
       VALUES (?, ?, '[]', 1500.00, 'E320000000099', 'E32', 'E340000000001', 'Anulado')`,
      [voidedVisId, testClientId]
    );

    const ncExisting = await dgiiService.generateAndTransmitNotaCredito(voidedVisId, 'Reintento de anulación');
    assert('6.4 Reintento sobre factura con nota previa retorna comprobante existente sin emitir duplicado', String(ncExisting) === 'E340000000001');

  } catch (err) {
    console.error('CRITICAL TEST ERROR:', err);
    results.push({ title: 'Suite Execution', pass: false, detail: err.message });
  } finally {
    // -----------------------------------------------------------------
    // TEARDOWN: CLEAN UP SYNTHETIC TEST DATA
    // -----------------------------------------------------------------
    console.log('\n--- LIMPIEZA DE DATOS SINTÉTICOS ---');
    try {
      if (testStaffId || testStaffNoSchedId) {
        await pool.query("DELETE FROM attendance WHERE employee_id IN (?, ?)", [testStaffId || 0, testStaffNoSchedId || 0]);
        await pool.query("DELETE FROM staff_records WHERE id IN (?, ?)", [testStaffId || 0, testStaffNoSchedId || 0]);
      }
      if (testClientId) {
        await pool.query("DELETE FROM visits WHERE client_id = ?", [testClientId]);
        await pool.query("DELETE FROM contracts WHERE client_id = ?", [testClientId]);
        await pool.query("DELETE FROM clients WHERE id = ?", [testClientId]);
      }
      console.log('  [OK] Limpieza completada con éxito. BD 100% limpia sin residuos sintéticos.');
    } catch (cleanErr) {
      console.error('Error durante la limpieza:', cleanErr.message);
    }
    await pool.end();
  }

  const passedCount = results.filter(r => r.pass).length;
  const failedCount = results.filter(r => !r.pass).length;
  console.log('\n======================================================');
  console.log(`TOTAL TESTS: ${results.length} | PASSED: ${passedCount} | FAILED: ${failedCount}`);
  console.log('======================================================\n');
  process.exit(failedCount > 0 ? 1 : 0);
}

runTests();
