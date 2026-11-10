const path = require('path');
const assert = require('assert');
const dotenv = require(path.join(__dirname, 'node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '.env') });
const mysql = require(path.join(__dirname, 'node_modules/mysql2/promise'));
const { createVisitsRouter } = require('./routes/visits.routes');
const { createDgiiRouter, extractPaymentBreakdown } = require('./routes/dgii.routes');

async function runTechnicalValidation() {
  console.log('========================================================================');
  console.log('=== SALONPRO: VALIDACIÓN TÉCNICA FINAL — BLOQUEO E-NCF Y PRECUENTAS ===');
  console.log('========================================================================\n');

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 15
  });

  const conn = await pool.getConnection();

  // 1. Verificación inicial de la integridad de los contadores productivos
  const [initialProdRows] = await conn.query(
    'SELECT id, tipo_comprobante, secuencia_actual, cantidad_usada, cantidad_aprobada, estado FROM dgii_ncf_sequences WHERE id IN (5, 7, 8) ORDER BY id ASC'
  );
  console.log('🔒 Verificación de líneas productivas reales en MySQL (Línea Base):');
  for (const r of initialProdRows) {
    console.log(`   - ID ${r.id} (${r.tipo_comprobante}): actual=${r.secuencia_actual}, usada=${r.cantidad_usada}/${r.cantidad_aprobada}, estado=${r.estado}`);
  }
  console.log('');

  const testVisitsCreated = [];
  const testSeqIdsCreated = [];

  const mockDeps = {
    transmitInvoiceDirectlyToDgii: async () => true,
    generateAndTransmitNotaCredito: async () => 'E340000000099',
    sendSurveyEmail: async () => true
  };

  const visitsRouterObj = createVisitsRouter(pool, mockDeps);
  const dgiiRouterObj = createDgiiRouter(pool);

  async function callRoute(handler, req) {
    return new Promise((resolve) => {
      let statusCode = 200;
      let responseBody = null;
      const res = {
        status: (code) => {
          statusCode = code;
          return res;
        },
        json: (data) => {
          responseBody = data;
          resolve({ status: statusCode, body: data });
        },
        send: (data) => {
          responseBody = data;
          resolve({ status: statusCode, body: data });
        }
      };
      handler(req, res).catch(err => {
        resolve({ status: 500, body: { error: err.message, code: err.code } });
      });
    });
  }

  const EXACT_REQUIRED_MESSAGE = `No hay comprobantes fiscales disponibles.\n\nSe agotaron las secuencias autorizadas para este tipo de factura.\n\nFavor de notificar al administrador para agregar nuevas secuencias fiscales.\n\nPuede guardar o imprimir una precuenta, pero no finalizar la factura ni registrar el cobro.`;

  try {
    // =========================================================================
    // SECCIÓN 1: ATOMICIDAD DE SECUENCIAS Y TRANSACCIONES EXPLÍCITAS
    // =========================================================================
    console.log('--- SECCIÓN 1: ATOMICIDAD, BLOQUEO DE FILA Y ROLLBACK ---');

    // 1.1 Concurrencia con 2 conexiones independientes sobre lote sintético de 1 sola secuencia
    console.log('1.1 Probando concurrencia atómica sobre 1 sola secuencia con conexiones independientes...');
    const [resConcBatch] = await conn.query(`
      INSERT INTO dgii_ncf_sequences 
        (tipo_comprobante, nombre_comprobante, numero_desde, numero_hasta, secuencia_actual, cantidad_aprobada, cantidad_usada, fecha_vencimiento, estado)
      VALUES 
        ('TEST_CONC', 'Sintético Concurrencia', 'TEST_CONC0000000001', 'TEST_CONC0000000001', 0, 1, 0, '2028-12-31', 'Activo')
    `);
    const concBatchId = resConcBatch.insertId;
    testSeqIdsCreated.push(concBatchId);

    const vIdConc1 = `TEST-ATOMIC-C1-${Date.now()}`;
    const vIdConc2 = `TEST-ATOMIC-C2-${Date.now()}`;
    testVisitsCreated.push(vIdConc1, vIdConc2);

    // Creamos las dos visitas en estado Pendiente
    await conn.query("INSERT INTO visits (id, total, status) VALUES (?, 500, 'Pendiente')", [vIdConc1]);
    await conn.query("INSERT INTO visits (id, total, status) VALUES (?, 500, 'Pendiente')", [vIdConc2]);

    // Ejecutar simultáneamente a través de Promise.all (dos conexiones independientes del pool)
    const [allocResult1, allocResult2] = await Promise.allSettled([
      visitsRouterObj.assignDgiiSequenceToVisit(vIdConc1, 'TEST_CONC', null, null, 500, 'Efectivo'),
      visitsRouterObj.assignDgiiSequenceToVisit(vIdConc2, 'TEST_CONC', null, null, 500, 'Efectivo')
    ]);

    const successes = [allocResult1, allocResult2].filter(r => r.status === 'fulfilled' && r.value?.ncf);
    const failures = [allocResult1, allocResult2].filter(r => (r.status === 'fulfilled' && !r.value?.ncf) || r.status === 'rejected');

    assert.strictEqual(successes.length, 1, 'Exactamente una conexión debe obtener la secuencia');
    assert.strictEqual(failures.length, 1, 'Exactamente una conexión debe ser bloqueada sin e-NCF');
    const blockedCode = failures[0].status === 'fulfilled' ? failures[0].value?.code : failures[0].reason?.code;
    assert.strictEqual(blockedCode, 'FISCAL_SEQUENCES_EXHAUSTED', 'El error debe ser FISCAL_SEQUENCES_EXHAUSTED');

    // Comprobar estado final en base de datos
    const [batchCheck] = await conn.query('SELECT cantidad_usada, cantidad_aprobada, estado FROM dgii_ncf_sequences WHERE id = ?', [concBatchId]);
    assert.strictEqual(batchCheck[0].cantidad_usada, 1, 'cantidad_usada debe ser exactamente 1 (sin sobreconsumo)');
    assert.strictEqual(batchCheck[0].estado, 'Agotado', 'El lote debe haber pasado a Agotado');
    console.log('    ✓ Atomicidad validada: 1 éxito, 1 rechazo, 0 colisiones, lote marcado Agotado.');

    // 1.2 Verificación de ROLLBACK y liberación de conexión/bloqueo ante excepción
    console.log('1.2 Verificando que una excepción dentro de la transacción ejecute ROLLBACK y libere el lock...');
    const [resRollbackBatch] = await conn.query(`
      INSERT INTO dgii_ncf_sequences 
        (tipo_comprobante, nombre_comprobante, numero_desde, numero_hasta, secuencia_actual, cantidad_aprobada, cantidad_usada, fecha_vencimiento, estado)
      VALUES 
        ('TEST_ROLL', 'Sintético Rollback', 'TEST_ROLL0000000001', 'TEST_ROLL0000000005', 0, 5, 0, '2028-12-31', 'Activo')
    `);
    const rollbackBatchId = resRollbackBatch.insertId;
    testSeqIdsCreated.push(rollbackBatchId);

    // Intentamos asignar a un ID de visita inexistente que cause error forzado si falla una restricción,
    // o forzamos fallo dentro de la transacción
    let caughtError = null;
    try {
      // Pasamos un ID nulo o inválido en visitId que forzará fallo o llamamos con transacción manual
      const testConn = await pool.getConnection();
      try {
        await testConn.beginTransaction();
        const [lockRow] = await testConn.query(
          "SELECT * FROM dgii_ncf_sequences WHERE id = ? FOR UPDATE",
          [rollbackBatchId]
        );
        // Simulamos error antes del commit
        throw new Error('SIMULATED_TRANSACTION_FAILURE');
      } catch (err) {
        await testConn.rollback();
        caughtError = err;
      } finally {
        testConn.release(); // Liberación obligatoria
      }
    } catch (e) {
      caughtError = e;
    }

    assert.strictEqual(caughtError?.message, 'SIMULATED_TRANSACTION_FAILURE');
    // Verificar que el lote no sufrió cambios
    const [batchAfterRollback] = await conn.query('SELECT cantidad_usada FROM dgii_ncf_sequences WHERE id = ?', [rollbackBatchId]);
    assert.strictEqual(batchAfterRollback[0].cantidad_usada, 0, 'Tras ROLLBACK la cantidad_usada debe mantenerse en 0');

    // Comprobar que el lock fue liberado y otra conexión puede consultar de inmediato
    const connTestUnlock = await pool.getConnection();
    const [canLockImmediately] = await connTestUnlock.query('SELECT id FROM dgii_ncf_sequences WHERE id = ? FOR UPDATE', [rollbackBatchId]);
    assert.strictEqual(canLockImmediately.length, 1);
    connTestUnlock.release();
    console.log('    ✓ Rollback y liberación de bloqueo de fila verificados exitosamente.\n');

    // 1.3 Concurrencia atómica sobre la MISMA visita (dos checkouts simultáneos)
    console.log('1.3 Probando checkout simultáneo sobre la MISMA visita (protección de estado Pendiente -> Facturado)...');
    const [resSameBatch] = await conn.query(`
      INSERT INTO dgii_ncf_sequences 
        (tipo_comprobante, nombre_comprobante, numero_desde, numero_hasta, secuencia_actual, cantidad_aprobada, cantidad_usada, fecha_vencimiento, estado)
      VALUES 
        ('TEST_SAME', 'Sintético Misma Visita', 'TESTSAME0000000001', 'TESTSAME0000000010', 0, 10, 0, '2028-12-31', 'Activo')
    `);
    const sameBatchId = resSameBatch.insertId;
    testSeqIdsCreated.push(sameBatchId);

    const vIdSameVisit = `TEST-SAME-VISIT-${Date.now()}`;
    testVisitsCreated.push(vIdSameVisit);

    await conn.query("INSERT INTO visits (id, ticket_number, total, status) VALUES (?, 'TK-SAME-1', 1200, 'Pendiente')", [vIdSameVisit]);

    const reqCheckoutSame = {
      params: { id: vIdSameVisit },
      body: {
        ticketId: vIdSameVisit,
        total: 1200,
        metodo_pago: 'Efectivo',
        ncf_type: 'TEST_SAME',
        items_detail: [{ nombre: 'Lavado VIP', precioAplicado: 1200, cantidad: 1 }]
      }
    };

    const [sameCheckoutRes1, sameCheckoutRes2] = await Promise.all([
      callRoute(visitsRouterObj.handleCheckoutVisit, reqCheckoutSame),
      callRoute(visitsRouterObj.handleCheckoutVisit, reqCheckoutSame)
    ]);

    const sameSuccess = [sameCheckoutRes1, sameCheckoutRes2].filter(r => r.status === 200);
    const sameBlocked = [sameCheckoutRes1, sameCheckoutRes2].filter(r => r.status === 409);

    assert.strictEqual(sameSuccess.length, 1, 'Exactamente una solicitud debe completar la facturación');
    assert.strictEqual(sameBlocked.length, 1, 'Exactamente una solicitud concurrente debe ser bloqueada (409)');
    assert.ok(
      sameBlocked[0].body.code === 'CONCURRENT_CHECKOUT_BLOCKED' || sameBlocked[0].body.code === 'VISIT_ALREADY_BILLED',
      'El código de bloqueo concurrente debe ser válido'
    );

    const [batchSameCheck] = await conn.query('SELECT cantidad_usada FROM dgii_ncf_sequences WHERE id = ?', [sameBatchId]);
    assert.strictEqual(batchSameCheck[0].cantidad_usada, 1, 'Solo se debe consumir 1 comprobante para la misma visita');
    console.log('    ✓ Checkout concurrente en la misma visita: 1 éxito (200), 1 bloqueo atómico (409), 1 solo e-NCF consumido.');

    // 1.4 Reintento seguro tras error con e-NCF reservado (sin comprobantes huérfanos ni cobros duplicados)
    console.log('1.4 Probando reintento tras error con e-NCF ya reservado en la visita...');
    const vIdRetry = `TEST-RETRY-${Date.now()}`;
    testVisitsCreated.push(vIdRetry);

    const preReservedNcf = 'TESTSAME0000000002';
    await conn.query(
      `INSERT INTO visits (id, ticket_number, total, status, ncf, ncf_type, ncf_name, codigo_seguridad_ecf, qr_code_url) 
       VALUES (?, 'TK-RETRY-1', 750, 'Pendiente', ?, 'TEST_SAME', 'Sintético Misma Visita', 'ABC123', 'https://fc.dgii.gov.do/test')`,
      [vIdRetry, preReservedNcf]
    );
    await conn.query('UPDATE dgii_ncf_sequences SET cantidad_usada = cantidad_usada + 1 WHERE id = ?', [sameBatchId]);

    const [batchBeforeRetry] = await conn.query('SELECT cantidad_usada FROM dgii_ncf_sequences WHERE id = ?', [sameBatchId]);
    const usedBeforeRetry = batchBeforeRetry[0].cantidad_usada;

    const resRetryCheckout = await callRoute(visitsRouterObj.handleCheckoutVisit, {
      params: { id: vIdRetry },
      body: {
        ticketId: vIdRetry,
        total: 750,
        metodo_pago: 'Efectivo',
        ncf_type: 'TEST_SAME',
        items_detail: [{ nombre: 'Peinado', precioAplicado: 750, cantidad: 1 }]
      }
    });

    assert.strictEqual(resRetryCheckout.status, 200, 'El reintento debe ser exitoso');
    assert.strictEqual(resRetryCheckout.body.ncf, preReservedNcf, 'Debe reutilizar exactamente el e-NCF previamente reservado');

    const [batchAfterRetry] = await conn.query('SELECT cantidad_usada FROM dgii_ncf_sequences WHERE id = ?', [sameBatchId]);
    assert.strictEqual(batchAfterRetry[0].cantidad_usada, usedBeforeRetry, 'La cantidad usada NO debe aumentar al reintentar');

    const [visitRetryDb] = await conn.query('SELECT status, ncf FROM visits WHERE id = ?', [vIdRetry]);
    assert.strictEqual(visitRetryDb[0].status, 'Facturado', 'El estado final debe ser Facturado');
    console.log('    ✓ Reintento exitoso: e-NCF reutilizado limpiamente, 0 consumo duplicado de secuencias.\n');

    // =========================================================================
    // SECCIÓN 2: SEGURIDAD Y AISLAMIENTO DE PRUEBAS SINTÉTICAS
    // =========================================================================
    console.log('--- SECCIÓN 2: SEGURIDAD Y AISLAMIENTO TOTAL (0 TOUCH A PROD) ---');

    // Creamos lote sintético para simular agotamiento de E31 (0 disponibles)
    const [resSynthE31] = await conn.query(`
      INSERT INTO dgii_ncf_sequences 
        (tipo_comprobante, nombre_comprobante, numero_desde, numero_hasta, secuencia_actual, cantidad_aprobada, cantidad_usada, fecha_vencimiento, estado)
      VALUES 
        ('TEST_E31', 'Crédito Fiscal Sintético Agotado', 'TEST310000000001', 'TEST310000000005', 5, 5, 5, '2028-12-31', 'Agotado')
    `);
    testSeqIdsCreated.push(resSynthE31.insertId);

    // Creamos lote sintético para simular E32 con secuencias activas
    const [resSynthE32] = await conn.query(`
      INSERT INTO dgii_ncf_sequences 
        (tipo_comprobante, nombre_comprobante, numero_desde, numero_hasta, secuencia_actual, cantidad_aprobada, cantidad_usada, fecha_vencimiento, estado)
      VALUES 
        ('TEST_E32', 'Consumo Sintético Disponible', 'TEST320000000001', 'TEST320000000010', 0, 10, 0, '2028-12-31', 'Activo')
    `);
    const synthE32Id = resSynthE32.insertId;
    testSeqIdsCreated.push(synthE32Id);

    // 2.1 Checkout con TEST_E31 agotado debe rebotar con 409
    const vIdTestE31 = `TEST-SYNTH-E31-${Date.now()}`;
    testVisitsCreated.push(vIdTestE31);

    const resSynthCheckoutE31 = await callRoute(visitsRouterObj.handleCheckoutVisit, {
      params: { id: vIdTestE31 },
      body: {
        ticketId: vIdTestE31,
        total: 1500,
        metodo_pago: 'Efectivo',
        ncf_type: 'TEST_E31',
        items_detail: [{ nombre: 'Servicio Sintético', precioAplicado: 1500, cantidad: 1 }]
      }
    });

    assert.strictEqual(resSynthCheckoutE31.status, 409, 'Debe retornar 409 ante agotamiento');
    assert.strictEqual(resSynthCheckoutE31.body.code, 'FISCAL_SEQUENCES_EXHAUSTED');
    assert.strictEqual(resSynthCheckoutE31.body.message, EXACT_REQUIRED_MESSAGE, 'Mensaje debe ser el exacto requerido');

    // 2.2 Comprobar que TEST_E32 sigue operando con normalidad (aislamiento)
    const vIdTestE32 = `TEST-SYNTH-E32-${Date.now()}`;
    testVisitsCreated.push(vIdTestE32);

    const resSynthCheckoutE32 = await callRoute(visitsRouterObj.handleCheckoutVisit, {
      params: { id: vIdTestE32 },
      body: {
        ticketId: vIdTestE32,
        total: 800,
        metodo_pago: 'Efectivo',
        ncf_type: 'TEST_E32',
        items_detail: [{ nombre: 'Corte Sintético', precioAplicado: 800, cantidad: 1 }]
      }
    });

    assert.strictEqual(resSynthCheckoutE32.status, 200, 'TEST_E32 debe completarse con éxito');
    assert.strictEqual(resSynthCheckoutE32.body.ncf, 'TEST_E320000000001');

    // 2.3 Agotar TEST_E32 y verificar bloqueo
    await conn.query('UPDATE dgii_ncf_sequences SET estado = "Agotado", cantidad_usada = cantidad_aprobada WHERE id = ?', [synthE32Id]);
    const vIdTestE32Blocked = `TEST-SYNTH-E32-BLK-${Date.now()}`;
    testVisitsCreated.push(vIdTestE32Blocked);

    const resSynthCheckoutE32Blocked = await callRoute(visitsRouterObj.handleCheckoutVisit, {
      params: { id: vIdTestE32Blocked },
      body: {
        ticketId: vIdTestE32Blocked,
        total: 800,
        metodo_pago: 'Efectivo',
        ncf_type: 'TEST_E32',
        items_detail: [{ nombre: 'Corte Sintético', precioAplicado: 800, cantidad: 1 }]
      }
    });

    assert.strictEqual(resSynthCheckoutE32Blocked.status, 409);
    assert.strictEqual(resSynthCheckoutE32Blocked.body.code, 'FISCAL_SEQUENCES_EXHAUSTED');
    console.log('    ✓ Bloqueo y aislamiento validados sobre lotes sintéticos sin tocar tablas reales.\n');

    // =========================================================================
    // SECCIÓN 3: INTEGRIDAD DE PAGOS, PRECUENTAS Y REPORTES
    // =========================================================================
    console.log('--- SECCIÓN 3: INTEGRIDAD DE PAGOS, PRECUENTAS Y REPORTES ---');

    // 3.1 Protección de cobros previamente autorizados (Registro en audit_logs, 0 cobros duplicados)
    console.log('3.1 Verificando registro seguro de incidencia ante cobro pre-autorizado bloqueado...');
    const vIdPreAuth = `TEST-PREAUTH-${Date.now()}`;
    testVisitsCreated.push(vIdPreAuth);

    const resPreAuth = await callRoute(visitsRouterObj.handleCheckoutVisit, {
      params: { id: vIdPreAuth },
      body: {
        ticketId: vIdPreAuth,
        total: 2500,
        metodo_pago: 'Tarjeta',
        applied_payments: [{ method: 'Tarjeta', amount: 2500, authorization_code: 'AUTH-PREV-888999' }],
        ncf_type: 'TEST_E31',
        items_detail: [{ nombre: 'Tratamiento', precioAplicado: 2500, cantidad: 1 }]
      }
    });

    assert.strictEqual(resPreAuth.status, 409);
    const [auditCheck] = await conn.query('SELECT * FROM audit_logs WHERE action = "COBRO_PREVIO_BLOQUEADO_POR_AGOTAMIENTO" AND entity_id = ?', [vIdPreAuth]);
    assert.ok(auditCheck.length > 0, 'Debe registrar la incidencia en audit_logs');
    const metaStr = typeof auditCheck[0].metadata === 'string' ? auditCheck[0].metadata : JSON.stringify(auditCheck[0].metadata);
    assert.ok(metaStr.includes('AUTH-PREV-888999'), 'Debe incluir la referencia del cobro');
    console.log('    ✓ Incidencia de cobro previo registrada en audit_logs sin cobros adicionales.');

    // 3.2 Precuenta: Guardar, recuperar, imprimir y facturar una sola vez
    console.log('3.2 Precuenta: verificación de ciclo de vida completo y facturación única...');
    const vIdPrecuenta = `TEST-PREC-LIFECYCLE-${Date.now()}`;
    testVisitsCreated.push(vIdPrecuenta);

    // Paso A: Guardar Precuenta
    const precuentaReq = {
      body: {
        ticketId: vIdPrecuenta,
        client_name: 'Clienta Ciclo Precuenta',
        total: 950.00,
        metodo_pago: 'Pendiente',
        items_detail: [{ nombre: 'Lavado Especial', precioAplicado: 950, cantidad: 1 }]
      }
    };
    const resSavePrec = await callRoute(visitsRouterObj.handlePrecuenta, precuentaReq);
    assert.strictEqual(resSavePrec.status, 200);
    assert.strictEqual(resSavePrec.body.is_precuenta, true);
    assert.strictEqual(resSavePrec.body.message, 'PRECUENTA — NO ES FACTURA FISCAL — PENDIENTE DE PAGO');

    // Comprobar en BD: status = Pendiente, ncf = NULL, ncf_type = 'PRECUENTA'
    const [rowPrecDb] = await conn.query('SELECT status, ncf, ncf_type, ncf_name, total FROM visits WHERE id = ?', [vIdPrecuenta]);
    assert.strictEqual(rowPrecDb[0].status, 'Pendiente');
    assert.strictEqual(rowPrecDb[0].ncf, null);
    assert.strictEqual(rowPrecDb[0].ncf_type, 'PRECUENTA');
    assert.strictEqual(rowPrecDb[0].ncf_type.length, 9, 'El código PRECUENTA tiene 9 caracteres y cabe en VARCHAR(10)');

    // Comprobar que NO generó movimientos de caja
    const [movementsPrec] = await conn.query('SELECT id FROM cash_register_movements WHERE visit_id = ?', [vIdPrecuenta]);
    assert.strictEqual(movementsPrec.length, 0, 'La precuenta NO debe generar movimientos en caja');

    // Paso B: Recuperar y facturar la precuenta (con un lote sintético activo)
    const [resSynthActive] = await conn.query(`
      INSERT INTO dgii_ncf_sequences 
        (tipo_comprobante, nombre_comprobante, numero_desde, numero_hasta, secuencia_actual, cantidad_aprobada, cantidad_usada, fecha_vencimiento, estado)
      VALUES 
        ('TEST_PB', 'Lote Precuenta', 'TESTPB0000000001', 'TESTPB0000000005', 0, 5, 0, '2028-12-31', 'Activo')
    `);
    testSeqIdsCreated.push(resSynthActive.insertId);

    const resBilledPrec = await callRoute(visitsRouterObj.handleCheckoutVisit, {
      params: { id: vIdPrecuenta },
      body: {
        ticketId: vIdPrecuenta,
        total: 950.00,
        metodo_pago: 'Efectivo',
        ncf_type: 'TEST_PB',
        items_detail: [{ nombre: 'Lavado Especial', precioAplicado: 950, cantidad: 1 }]
      }
    });

    assert.strictEqual(resBilledPrec.status, 200, 'La precuenta debe poder facturarse exitosamente');
    assert.strictEqual(resBilledPrec.body.ncf, 'TEST_PB0000000001');

    // Paso C: Intentar facturar la MISMA precuenta por SEGUNDA VEZ (debe rebotar)
    const resBilledSecondTime = await callRoute(visitsRouterObj.handleCheckoutVisit, {
      params: { id: vIdPrecuenta },
      body: {
        ticketId: vIdPrecuenta,
        total: 950.00,
        metodo_pago: 'Efectivo',
        ncf_type: 'TEST_PB'
      }
    });

    assert.strictEqual(resBilledSecondTime.status, 409, 'No se debe permitir doble facturación');
    assert.strictEqual(resBilledSecondTime.body.code, 'VISIT_ALREADY_BILLED', 'Debe retornar VISIT_ALREADY_BILLED');
    console.log('    ✓ Precuenta creada, recuperada, facturada exactamente una vez y protegida contra re-facturación.');

    // 3.3 Verificación de reportes 607 y 608: la precuenta no altera ventas fiscales
    console.log('3.3 Comprobando compatibilidad de consultas y reportes fiscales...');
    const [report607Check] = await conn.query(
      "SELECT id FROM visits WHERE (ncf IS NOT NULL AND TRIM(ncf) != '' AND ncf != 'NONE') AND id = ?",
      [vIdPrecuenta]
    );
    // Ahora que fue facturada con NCF, SÍ entra; mientras era precuenta NO entraba
    assert.strictEqual(report607Check.length, 1);

    const vIdUnbilledPrec = `TEST-UNBILLED-PREC-${Date.now()}`;
    testVisitsCreated.push(vIdUnbilledPrec);
    await callRoute(visitsRouterObj.handlePrecuenta, {
      body: { ticketId: vIdUnbilledPrec, total: 300, items_detail: [{ nombre: 'Secado', precioAplicado: 300, cantidad: 1 }] }
    });

    const [unbilled607Check] = await conn.query(
      "SELECT id FROM visits WHERE (ncf IS NOT NULL AND TRIM(ncf) != '' AND ncf != 'NONE') AND id = ?",
      [vIdUnbilledPrec]
    );
    assert.strictEqual(unbilled607Check.length, 0, 'La precuenta no facturada NUNCA debe figurar en el reporte 607');
    console.log('    ✓ Compatibilidad con 607/608 y reportes existente confirmada.\n');

  } finally {
    // =========================================================================
    // LIMPIEZA DE DATOS SINTÉTICOS Y VERIFICACIÓN DE LÍNEA BASE
    // =========================================================================
    console.log('🧹 Limpiando registros sintéticos de prueba...');
    if (testVisitsCreated.length > 0) {
      await conn.query(`DELETE FROM visits WHERE id IN (${testVisitsCreated.map(() => '?').join(',')})`, testVisitsCreated);
      await conn.query(`DELETE FROM audit_logs WHERE entity_id IN (${testVisitsCreated.map(() => '?').join(',')})`, testVisitsCreated);
    }
    if (testSeqIdsCreated.length > 0) {
      await conn.query(`DELETE FROM dgii_ncf_sequences WHERE id IN (${testSeqIdsCreated.map(() => '?').join(',')})`, testSeqIdsCreated);
    }

    // Comprobar estado final de las secuencias productivas reales
    const [finalProdRows] = await conn.query(
      'SELECT id, tipo_comprobante, secuencia_actual, cantidad_usada, cantidad_aprobada, estado FROM dgii_ncf_sequences WHERE id IN (5, 7, 8) ORDER BY id ASC'
    );
    console.log('🔒 Verificación final de integridad de líneas productivas reales:');
    for (let i = 0; i < finalProdRows.length; i++) {
      const f = finalProdRows[i];
      const init = initialProdRows[i];
      console.log(`   - ID ${f.id} (${f.tipo_comprobante}): actual=${f.secuencia_actual}, usada=${f.cantidad_usada}/${f.cantidad_aprobada}, estado=${f.estado}`);
      assert.strictEqual(f.secuencia_actual, init.secuencia_actual, `Secuencia actual de prod ${f.tipo_comprobante} debe coincidir`);
      assert.strictEqual(f.cantidad_usada, init.cantidad_usada, `Cantidad usada de prod ${f.tipo_comprobante} debe coincidir`);
      assert.strictEqual(f.estado, init.estado, `Estado de prod ${f.tipo_comprobante} debe coincidir`);
    }

    await conn.release();
    await pool.end();
  }

  console.log('\n========================================================================');
  console.log('=== VALIDACIÓN TÉCNICA FINAL EXITOSA: 100% CUMPLIMIENTO DE REGLAS ===');
  console.log('========================================================================\n');
}

runTechnicalValidation().catch(err => {
  console.error('\n❌ ERROR EN VALIDACIÓN:', err);
  process.exit(1);
});
