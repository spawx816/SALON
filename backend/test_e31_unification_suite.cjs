const path = require('path');
const mysql = require(path.join(__dirname, 'node_modules', 'mysql2', 'promise'));
const fs = require('fs');

const envPath = path.join(__dirname, '.env');
const env = fs.readFileSync(envPath, 'utf8').split('\n').reduce((acc, line) => {
  const [k, ...v] = line.trim().split('=');
  if (k && v.length) acc[k] = v.join('=');
  return acc;
}, {});

const { evaluateBatchFiscalStatus, diagnoseSequenceFailure } = require('./routes/dgii.routes');
const { createVisitsRouter } = require('./routes/visits.routes');

async function runTestSuite() {
  const pool = mysql.createPool({
    host: env.DB_HOST,
    user: env.DB_USER,
    password: env.DB_PASSWORD || env.DB_PASS,
    database: env.DB_NAME,
    timezone: '-04:00'
  });

  const visitsRouterObj = createVisitsRouter(pool, {});
  const assignDgiiSequenceToVisit = visitsRouterObj.assignDgiiSequenceToVisit;

  console.log('\n======================================================');
  console.log('   TEST SUITE: E31 FISCAL UNIFICATION & DIAGNOSTIC');
  console.log('======================================================\n');

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

  try {
    // -------------------------------------------------------------
    // PRUEBA 1: UNIFIED BATCH EVALUATION (evaluateBatchFiscalStatus)
    // -------------------------------------------------------------
    console.log('--- PRUEBA 1: Unificación de Evaluación de Lotes ---');

    // Case 1A: Lote activo normal con saldo
    const normalBatch = {
      tipo_comprobante: 'E31',
      numero_desde: 'E310000000001',
      numero_hasta: 'E310000000010',
      secuencia_actual: 2,
      cantidad_aprobada: 10,
      cantidad_usada: 2,
      fecha_vencimiento: '2027-12-31',
      estado: 'Activo'
    };
    const evalNormal = evaluateBatchFiscalStatus(normalBatch);
    assert('Lote con saldo reporta Activo', evalNormal.estadoCalculado === 'Activo');
    assert('Lote con saldo calcula 8 disponibles reales', evalNormal.realDisponibles === 8, `disponibles=${evalNormal.realDisponibles}`);
    assert('Lote con saldo reporta 80% disponible', evalNormal.porcentajeDisponible === 80);

    // Case 1B: Rango asimétrico (numero_desde: 23, numero_hasta: 24, aprobada: 10)
    const asymmetricBatch = {
      tipo_comprobante: 'E31',
      numero_desde: 'E310000000023',
      numero_hasta: 'E310000000024',
      secuencia_actual: 23,
      cantidad_aprobada: 10,
      cantidad_usada: 0,
      fecha_vencimiento: '2027-12-31',
      estado: 'Activo'
    };
    const evalAsym = evaluateBatchFiscalStatus(asymmetricBatch);
    assert('Rango asimétrico acota capacidad a 2 y no a 10', evalAsym.cantidadAprobada === 2, `capacidad=${evalAsym.cantidadAprobada}`);
    assert('Rango asimétrico calcula disponibles según rango real (2)', evalAsym.realDisponibles === 2, `disponibles=${evalAsym.realDisponibles}`);

    // Case 1C: Lote inactivo
    const inactiveBatch = { ...normalBatch, estado: 'Inactivo' };
    const evalInactive = evaluateBatchFiscalStatus(inactiveBatch);
    assert('Lote inactivo calcula 0 disponibles', evalInactive.realDisponibles === 0);
    assert('Lote inactivo reporta motivo descriptivo', evalInactive.motivoInactividad !== null);

    // Case 1D: Lote vencido
    const expiredBatch = { ...normalBatch, fecha_vencimiento: '2020-01-01' };
    const evalExpired = evaluateBatchFiscalStatus(expiredBatch);
    assert('Lote con fecha pasada calcula Vencido', evalExpired.estadoCalculado === 'Vencido');
    assert('Lote vencido calcula 0 disponibles', evalExpired.realDisponibles === 0);

    // Case 1E: Lote con rango agotado (usados >= aprobados)
    const exhaustedBatch = { ...normalBatch, cantidad_usada: 10 };
    const evalExhausted = evaluateBatchFiscalStatus(exhaustedBatch);
    assert('Lote completado reporta Agotado', evalExhausted.estadoCalculado === 'Agotado');
    assert('Lote completado calcula 0 disponibles', evalExhausted.realDisponibles === 0);

    // Case 1F: Detección de autorización DGII / OFV
    const noAuthBatch = { ...normalBatch, no_solicitud: null, no_autorizacion: null };
    const authBatch = { ...normalBatch, no_solicitud: '6010004045', no_autorizacion: '6005529050' };
    assert('Lote sin solicitud/autorización reporta isAuthorized=false', evaluateBatchFiscalStatus(noAuthBatch).isAuthorized === false);
    assert('Lote con solicitud/autorización reporta isAuthorized=true', evaluateBatchFiscalStatus(authBatch).isAuthorized === true);

    // -------------------------------------------------------------
    // PRUEBA 2: DIAGNÓSTICO EXACTO DE CAUSAS DE RECHAZO
    // -------------------------------------------------------------
    console.log('\n--- PRUEBA 2: Clasificación de Causas de Rechazo ---');

    const diagInexistente = diagnoseSequenceFailure([], 'E31');
    assert('Diagnóstico LOTE_INEXISTENTE', diagInexistente.code === 'LOTE_INEXISTENTE');

    const diagInactivo = diagnoseSequenceFailure([{ estado: 'Inactivo' }], 'E31');
    assert('Diagnóstico LOTE_INACTIVO', diagInactivo.code === 'LOTE_INACTIVO');

    const diagVencido = diagnoseSequenceFailure([{ estado: 'Activo', fecha_vencimiento: '2020-01-01' }], 'E31');
    assert('Diagnóstico LOTE_VENCIDO', diagVencido.code === 'LOTE_VENCIDO');

    const diagAgotado = diagnoseSequenceFailure([{ estado: 'Activo', fecha_vencimiento: '2028-01-01', cantidad_aprobada: 5, cantidad_usada: 5 }], 'E31');
    assert('Diagnóstico LOTE_AGOTADO', diagAgotado.code === 'LOTE_AGOTADO');

    // -------------------------------------------------------------
    // PRUEBA 3: ASIGNACIÓN ATÓMICA Y ROTACIÓN MULTI-LOTE
    // -------------------------------------------------------------
    console.log('\n--- PRUEBA 3: Asignación Atómica y Rotación Entre Lotes ---');

    const testType = 'TEST_E31';
    // Limpieza preventiva de datos sintéticos
    await pool.query("DELETE FROM dgii_ncf_sequences WHERE tipo_comprobante = ?", [testType]);
    await pool.query("DELETE FROM visits WHERE id LIKE 'SYNTH_VIS_%'");

    // Insertar Lote 1 con 1 secuencia restante
    const [resB1] = await pool.query(
      `INSERT INTO dgii_ncf_sequences (tipo_comprobante, nombre_comprobante, numero_desde, numero_hasta, secuencia_actual, cantidad_aprobada, cantidad_usada, fecha_vencimiento, estado)
       VALUES (?, 'Test Batch 1', 'TEST_E3100000001', 'TEST_E3100000002', 1, 2, 1, '2028-12-31', 'Activo')`,
      [testType]
    );
    const batch1Id = resB1.insertId;

    // Insertar Lote 2 con 5 secuencias
    const [resB2] = await pool.query(
      `INSERT INTO dgii_ncf_sequences (tipo_comprobante, nombre_comprobante, numero_desde, numero_hasta, secuencia_actual, cantidad_aprobada, cantidad_usada, fecha_vencimiento, estado)
       VALUES (?, 'Test Batch 2', 'TEST_E3100000010', 'TEST_E3100000014', 10, 5, 0, '2028-12-31', 'Activo')`,
      [testType]
    );
    const batch2Id = resB2.insertId;

    // Insertar Visita Sintética 1
    const synthVisitId1 = 'SYNTH_VIS_001';
    await pool.query(
      "INSERT INTO visits (id, ticket_number, client_id, client_name, total, metodo_pago, status, visited_at) VALUES (?, 'TKT-TEST-1', 'INVITADO', 'Empresa Test SRL', 500.00, 'Efectivo', 'Pendiente', NOW())",
      [synthVisitId1]
    );

    // Asignación 1: Debe consumir el último número del Lote 1
    const alloc1 = await assignDgiiSequenceToVisit(synthVisitId1, testType, '131917038', 'Empresa Test SRL', 500, 'Efectivo');
    assert('Asignación 1 exitosa', Boolean(alloc1.ncf));
    assert('Asignación 1 usa Lote 1', alloc1.secuencia_id === batch1Id, `id=${alloc1.secuencia_id}`);

    // Verificar que Lote 1 pasó a Agotado
    const [b1Check] = await pool.query("SELECT estado, cantidad_usada FROM dgii_ncf_sequences WHERE id = ?", [batch1Id]);
    assert('Lote 1 pasó a Agotado automáticamente tras agotarse', b1Check[0].estado === 'Agotado');

    // Insertar Visita Sintética 2
    const synthVisitId2 = 'SYNTH_VIS_002';
    await pool.query(
      "INSERT INTO visits (id, ticket_number, client_id, client_name, total, metodo_pago, status, visited_at) VALUES (?, 'TKT-TEST-2', 'INVITADO', 'Empresa Test SRL', 600.00, 'Efectivo', 'Pendiente', NOW())",
      [synthVisitId2]
    );

    // Asignación 2: Debe rotar automáticamente a Lote 2 SIN dar falso agotamiento
    const alloc2 = await assignDgiiSequenceToVisit(synthVisitId2, testType, '131917038', 'Empresa Test SRL', 600, 'Efectivo');
    assert('Asignación 2 exitosa tras rotación', Boolean(alloc2.ncf));
    assert('Asignación 2 usa Lote 2 sin falso agotamiento', alloc2.secuencia_id === batch2Id, `id=${alloc2.secuencia_id}`);

    // -------------------------------------------------------------
    // PRUEBA 4: AGOTAMIENTO VERDADERO Y AUDITORÍA
    // -------------------------------------------------------------
    console.log('\n--- PRUEBA 4: Agotamiento Verdadero y Registro de Auditoría ---');

    // Agotar manualmente Lote 2
    await pool.query("UPDATE dgii_ncf_sequences SET cantidad_usada = 5, estado = 'Agotado' WHERE id = ?", [batch2Id]);

    const synthVisitId3 = 'SYNTH_VIS_003';
    await pool.query(
      "INSERT INTO visits (id, ticket_number, client_id, client_name, total, metodo_pago, status, visited_at) VALUES (?, 'TKT-TEST-3', 'INVITADO', 'Empresa Test SRL', 700.00, 'Efectivo', 'Pendiente', NOW())",
      [synthVisitId3]
    );

    let auditBefore = 0;
    const [auditCountBefore] = await pool.query("SELECT COUNT(*) as c FROM audit_logs WHERE action = 'FISCAL_SEQUENCE_BLOCKED'");
    auditBefore = auditCountBefore[0].c;

    const alloc3 = await assignDgiiSequenceToVisit(synthVisitId3, testType, '131917038', 'Empresa Test SRL', 700, 'Efectivo');
    assert('Asignación 3 rechazada por agotamiento verdadero', alloc3.ncf === null);
    assert('Asignación 3 retorna código LOTE_AGOTADO', alloc3.code === 'LOTE_AGOTADO', `code=${alloc3.code}`);

    const [auditCountAfter] = await pool.query("SELECT COUNT(*) as c FROM audit_logs WHERE action = 'FISCAL_SEQUENCE_BLOCKED'");
    assert('Se registró incidencia FISCAL_SEQUENCE_BLOCKED en audit_logs', auditCountAfter[0].c > auditBefore);

    // -------------------------------------------------------------
    // PRUEBA 5: CHECKOUT INTEGRAL Y RESGUARDO DE VISITA PENDIENTE
    // -------------------------------------------------------------
    console.log('\n--- PRUEBA 5: Checkout Integral y Seguridad de Estado Pendiente ---');

    // Intentar checkout con tipo agotado y verificar que la visita no queda atrapada en Procesando
    const reqMock = {
      params: { id: synthVisitId3 },
      body: {
        id: synthVisitId3,
        total: 700,
        metodo_pago: 'Efectivo',
        ncf_type: testType,
        rnc_cliente: '131917038',
        rzn_soc_cliente: 'Empresa Test SRL'
      }
    };

    let statusCode = null;
    let jsonResult = null;
    const resMock = {
      status: (code) => {
        statusCode = code;
        return {
          json: (data) => { jsonResult = data; }
        };
      }
    };

    await visitsRouterObj.handleCheckoutVisit(reqMock, resMock);

    assert('Checkout con secuencias agotadas responde HTTP 409', statusCode === 409, `status=${statusCode}`);
    assert('Respuesta 409 incluye código LOTE_AGOTADO', jsonResult?.code === 'LOTE_AGOTADO', `code=${jsonResult?.code}`);
    assert('Respuesta 409 permite guardar o imprimir precuenta', jsonResult?.can_print_precuenta === true);

    const [visitFinalCheck] = await pool.query("SELECT status FROM visits WHERE id = ?", [synthVisitId3]);
    assert('Visita no queda atrapada en Procesando; se revierte a Pendiente', visitFinalCheck[0]?.status === 'Pendiente', `status=${visitFinalCheck[0]?.status}`);

    // Limpieza de datos sintéticos
    await pool.query("DELETE FROM dgii_ncf_sequences WHERE tipo_comprobante = ?", [testType]);
    await pool.query("DELETE FROM visits WHERE id LIKE 'SYNTH_VIS_%'");
    await pool.query("DELETE FROM audit_logs WHERE reason LIKE '%TEST_E31%'");

  } catch (err) {
    console.error('ERROR EN TEST SUITE:', err);
    failed++;
  } finally {
    await pool.end();
  }

  console.log('\n======================================================');
  console.log(`   RESULTADOS: ${passed} APROBADAS | ${failed} FALLIDAS`);
  console.log('======================================================\n');

  if (failed > 0) process.exit(1);
}

runTestSuite();

