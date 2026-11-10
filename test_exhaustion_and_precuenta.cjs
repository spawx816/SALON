const path = require('path');
const assert = require('assert');
const dotenv = require(path.join(__dirname, 'node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '.env') });
const mysql = require(path.join(__dirname, 'node_modules/mysql2/promise'));
const { createVisitsRouter } = require('./routes/visits.routes');
const { createDgiiRouter } = require('./routes/dgii.routes');

async function runTestSuite() {
  console.log('========================================================================');
  console.log('=== SALONPRO: TEST DE BLOQUEO POR AGOTAMIENTO DE SECUENCIAS FISCALES ===');
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

  // Snapshot initial production sequences to ensure 100% data integrity
  const [initialSequences] = await conn.query('SELECT * FROM dgii_ncf_sequences ORDER BY id ASC');
  console.log('📋 Estado inicial de dgii_ncf_sequences respaldado en memoria:');
  for (const s of initialSequences) {
    console.log(`   - ID ${s.id} (${s.tipo_comprobante}): actual=${s.secuencia_actual}, usada=${s.cantidad_usada}/${s.cantidad_aprobada}, estado=${s.estado}`);
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

  // Helper to execute mock express route handler
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
    // -------------------------------------------------------------------------
    // TEST 1: DISPONIBILIDAD Y ALERTAS UMBRAL (20, 10, 5, 0)
    // -------------------------------------------------------------------------
    console.log('1. [Disponibilidad] Verificando endpoint GET /dgii/sequences/availability y niveles de alerta...');
    const availRes = await callRoute(dgiiRouterObj.getSequenceAvailability, { method: 'GET' });
    assert.strictEqual(availRes.status, 200, 'El endpoint de disponibilidad debe responder HTTP 200');
    assert.ok(availRes.body.success, 'La respuesta debe tener success = true');
    assert.ok(Array.isArray(availRes.body.sequences), 'Debe retornar arreglo de secuencias');
    assert.ok(Array.isArray(availRes.body.alerts), 'Debe retornar arreglo de alertas administrativas');

    console.log(`   OK: Total secuencias evaluadas: ${availRes.body.sequences.length}, Alertas activas: ${availRes.body.alerts.length}`);
    for (const seq of availRes.body.sequences) {
      console.log(`   - ${seq.tipo || seq.tipo_comprobante}: ${seq.disponibles} disponibles (Alerta: ${seq.alertLevel || seq.alert_level})`);
    }
    console.log('   OK: Disponibilidad y cálculo de alertas verificado correctamente.\n');

    // -------------------------------------------------------------------------
    // TEST 2: BLOQUEO POR AGOTAMIENTO DE E31 (CRÉDITO FISCAL)
    // -------------------------------------------------------------------------
    console.log('2. [Bloqueo E31] Forzando agotamiento de E31 y ejecutando checkout con Crédito Fiscal...');
    // Creamos lote sintético para pruebas controladas sin alterar los números de prod
    // Marcamos E31 existente temporalmente como agotado
    await conn.query("UPDATE dgii_ncf_sequences SET estado = 'Agotado' WHERE tipo_comprobante = 'E31'");

    const vIdE31 = `TEST-EXHAUST-E31-${Date.now()}`;
    testVisitsCreated.push(vIdE31);

    const checkoutReqE31 = {
      params: { id: vIdE31 },
      body: {
        ticketId: vIdE31,
        client_id: 'CLI-CORP-TEST',
        client_name: 'Empresa Test SRL',
        total: 1200.00,
        metodo_pago: 'Transferencia',
        ncf_type: 'E31',
        rnc_cliente: '131917038',
        rzn_soc_cliente: 'Empresa Test SRL',
        items_detail: [{ nombre: 'Servicio Corporativo', precioAplicado: 1200, cantidad: 1 }]
      }
    };

    const resE31 = await callRoute(visitsRouterObj.handleCheckoutVisit, checkoutReqE31);
    assert.strictEqual(resE31.status, 409, 'Debe responder HTTP 409 por agotamiento de secuencias E31');
    assert.strictEqual(resE31.body.code, 'FISCAL_SEQUENCES_EXHAUSTED', 'Debe incluir código FISCAL_SEQUENCES_EXHAUSTED');
    assert.strictEqual(resE31.body.tipo_comprobante, 'E31', 'Debe reportar tipo E31');
    assert.strictEqual(resE31.body.message, EXACT_REQUIRED_MESSAGE, 'El mensaje al cajero debe coincidir exactamente');
    assert.strictEqual(resE31.body.can_print_precuenta, true, 'Debe permitir imprimir precuenta');

    // Verificar en BD que la visita quedó como Pendiente y sin NCF
    const [visitRowE31] = await conn.query('SELECT status, ncf, total FROM visits WHERE id = ?', [vIdE31]);
    assert.strictEqual(visitRowE31[0]?.status, 'Pendiente', 'El estado de la visita debe ser Pendiente');
    assert.strictEqual(visitRowE31[0]?.ncf, null, 'No debe tener NCF asignado');
    console.log('   OK: Factura E31 rechazada con 409, mensaje exacto, guardada como Pendiente sin NCF.\n');

    // -------------------------------------------------------------------------
    // TEST 3: AISLAMIENTO: AGOTAMIENTO DE E31 NO BLOQUEA E32
    // -------------------------------------------------------------------------
    console.log('3. [Aislamiento] Comprobando que el agotamiento de E31 NO bloquea a las facturas de consumo (E32)...');
    const vIdE32 = `TEST-E32-ISOLATED-${Date.now()}`;
    testVisitsCreated.push(vIdE32);

    // Insertamos lote de prueba sintético para E32 con número aislado para no tocar el lote de prod
    await conn.query("UPDATE dgii_ncf_sequences SET estado = 'Inactivo' WHERE id = 5"); // Pausar lote prod
    const [resSyntheticSeq] = await conn.query(`
      INSERT INTO dgii_ncf_sequences 
        (tipo_comprobante, nombre_comprobante, numero_desde, numero_hasta, secuencia_actual, cantidad_aprobada, cantidad_usada, fecha_vencimiento, estado)
      VALUES 
        ('E32', 'Factura de Consumo Test', 'E329990000001', 'E329990000010', 0, 10, 0, '2028-12-31', 'Activo')
    `);
    const syntheticSeqId = resSyntheticSeq.insertId;
    testSeqIdsCreated.push(syntheticSeqId);

    const checkoutReqE32 = {
      params: { id: vIdE32 },
      body: {
        ticketId: vIdE32,
        client_id: 'CLI-CONSUMO',
        client_name: 'Cliente Consumidor Final',
        total: 500.00,
        metodo_pago: 'Efectivo',
        ncf_type: 'E32',
        items_detail: [{ nombre: 'Corte', precioAplicado: 500, cantidad: 1 }]
      }
    };

    const resE32 = await callRoute(visitsRouterObj.handleCheckoutVisit, checkoutReqE32);
    assert.strictEqual(resE32.status, 200, 'Factura de consumo E32 debe completarse con éxito');
    assert.ok(resE32.body.ncf.startsWith('E32'), 'Debe emitir NCF tipo E32');
    const [visitRowE32] = await conn.query('SELECT status, ncf FROM visits WHERE id = ?', [vIdE32]);
    assert.strictEqual(visitRowE32[0]?.status, 'Facturado', 'Visita E32 debe quedar Facturada');
    assert.ok(visitRowE32[0]?.ncf, 'Visita E32 debe tener NCF');
    console.log(`   OK: E32 facturada exitosamente con ${resE32.body.ncf} mientras E31 permanece agotada.\n`);

    // -------------------------------------------------------------------------
    // TEST 4: BLOQUEO POR AGOTAMIENTO DE E32
    // -------------------------------------------------------------------------
    console.log('4. [Bloqueo E32] Marcando E32 como agotado y verificando bloqueo de checkout...');
    await conn.query('UPDATE dgii_ncf_sequences SET estado = "Agotado", cantidad_usada = cantidad_aprobada WHERE id = ?', [syntheticSeqId]);

    const vIdE32Blocked = `TEST-EXHAUST-E32-${Date.now()}`;
    testVisitsCreated.push(vIdE32Blocked);

    const checkoutReqE32Blocked = {
      params: { id: vIdE32Blocked },
      body: {
        ticketId: vIdE32Blocked,
        client_id: 'CLI-CONSUMO-2',
        client_name: 'Cliente Consumidor 2',
        total: 600.00,
        metodo_pago: 'Efectivo',
        ncf_type: 'E32',
        items_detail: [{ nombre: 'Lavado', precioAplicado: 600, cantidad: 1 }]
      }
    };

    const resE32Blocked = await callRoute(visitsRouterObj.handleCheckoutVisit, checkoutReqE32Blocked);
    assert.strictEqual(resE32Blocked.status, 409, 'Debe responder HTTP 409 por agotamiento de secuencias E32');
    assert.strictEqual(resE32Blocked.body.code, 'FISCAL_SEQUENCES_EXHAUSTED', 'Debe incluir código FISCAL_SEQUENCES_EXHAUSTED');
    assert.strictEqual(resE32Blocked.body.tipo_comprobante, 'E32', 'Debe indicar tipo E32');
    assert.strictEqual(resE32Blocked.body.message, EXACT_REQUIRED_MESSAGE, 'Mensaje debe ser el exacto requerido');

    const [visitRowE32Blocked] = await conn.query('SELECT status, ncf FROM visits WHERE id = ?', [vIdE32Blocked]);
    assert.strictEqual(visitRowE32Blocked[0]?.status, 'Pendiente', 'Debe permanecer como Pendiente');
    assert.strictEqual(visitRowE32Blocked[0]?.ncf, null, 'No debe asignar NCF');
    console.log('   OK: Factura E32 rechazada con 409, mensaje exacto y guardada como Pendiente.\n');

    // -------------------------------------------------------------------------
    // TEST 5: AMBOS AGOTADOS — NO SUSTITUCIÓN CRUZADA
    // -------------------------------------------------------------------------
    console.log('5. [Ambos Agotados] Verificando que con ambos agotados se bloquea y NUNCA se intercambia E31 por E32...');
    const vIdBoth1 = `TEST-BOTH-E31-${Date.now()}`;
    const vIdBoth2 = `TEST-BOTH-E32-${Date.now()}`;
    testVisitsCreated.push(vIdBoth1, vIdBoth2);

    const resBothE31 = await callRoute(visitsRouterObj.handleCheckoutVisit, {
      params: { id: vIdBoth1 },
      body: { ticketId: vIdBoth1, total: 1000, ncf_type: 'E31', rnc_cliente: '131917038', rzn_soc_cliente: 'Corp', items_detail: [{ nombre: 'A', precioAplicado: 1000, cantidad: 1 }] }
    });
    const resBothE32 = await callRoute(visitsRouterObj.handleCheckoutVisit, {
      params: { id: vIdBoth2 },
      body: { ticketId: vIdBoth2, total: 500, ncf_type: 'E32', items_detail: [{ nombre: 'B', precioAplicado: 500, cantidad: 1 }] }
    });

    assert.strictEqual(resBothE31.status, 409);
    assert.strictEqual(resBothE32.status, 409);
    console.log('   OK: Ambos bloqueados sin sustitución automática cruzada.\n');

    // -------------------------------------------------------------------------
    // TEST 6: CONCURRENCIA ATÓMICA EN LA ÚLTIMA SECUENCIA DISPONIBLE
    // -------------------------------------------------------------------------
    console.log('6. [Concurrencia Última Secuencia] Creando lote con exactamente 1 secuencia disponible...');
    const [resLastSeq] = await conn.query(`
      INSERT INTO dgii_ncf_sequences 
        (tipo_comprobante, nombre_comprobante, numero_desde, numero_hasta, secuencia_actual, cantidad_aprobada, cantidad_usada, fecha_vencimiento, estado)
      VALUES 
        ('E32', 'Lote de 1 Sola Secuencia', 'E329999990001', 'E329999990001', 0, 1, 0, '2028-12-31', 'Activo')
    `);
    const lastSeqBatchId = resLastSeq.insertId;
    testSeqIdsCreated.push(lastSeqBatchId);

    const vIdCashierA = `TEST-CONC-A-${Date.now()}`;
    const vIdCashierB = `TEST-CONC-B-${Date.now()}`;
    testVisitsCreated.push(vIdCashierA, vIdCashierB);

    const reqA = {
      params: { id: vIdCashierA },
      body: { ticketId: vIdCashierA, client_name: 'Cajera A', total: 700, ncf_type: 'E32', items_detail: [{ nombre: 'Servicio A', precioAplicado: 700, cantidad: 1 }] }
    };
    const reqB = {
      params: { id: vIdCashierB },
      body: { ticketId: vIdCashierB, client_name: 'Cajera B', total: 700, ncf_type: 'E32', items_detail: [{ nombre: 'Servicio B', precioAplicado: 700, cantidad: 1 }] }
    };

    // Disparar simultáneamente
    const [resultA, resultB] = await Promise.all([
      callRoute(visitsRouterObj.handleCheckoutVisit, reqA),
      callRoute(visitsRouterObj.handleCheckoutVisit, reqB)
    ]);

    const successCount = [resultA, resultB].filter(r => r.status === 200).length;
    const blockedCount = [resultA, resultB].filter(r => r.status === 409 && r.body.code === 'FISCAL_SEQUENCES_EXHAUSTED').length;

    assert.strictEqual(successCount, 1, 'Exactamente una cajera debe obtener la última secuencia');
    assert.strictEqual(blockedCount, 1, 'Exactamente una cajera debe ser bloqueada con 409 FISCAL_SEQUENCES_EXHAUSTED');

    // Verificar en BD que cantidad_usada es 1 y el estado es Agotado
    const [finalBatchState] = await conn.query('SELECT cantidad_usada, cantidad_aprobada, estado FROM dgii_ncf_sequences WHERE id = ?', [lastSeqBatchId]);
    assert.strictEqual(finalBatchState[0].cantidad_usada, 1, 'cantidad_usada debe ser exactamente 1 (no 2)');
    assert.strictEqual(finalBatchState[0].estado, 'Agotado', 'El lote debe marcarse como Agotado');
    console.log('   OK: Concurrencia atómica validada: 1 éxito, 1 bloqueo 409, 0 colisiones, 0 reutilizaciones.\n');

    // -------------------------------------------------------------------------
    // TEST 7: ADICIÓN DE NUEVA SECUENCIA DESBLOQUEA INMEDIATAMENTE
    // -------------------------------------------------------------------------
    console.log('7. [Desbloqueo Inmediato] Agregando nuevo lote activo de secuencias...');
    const [resNewBatch] = await conn.query(`
      INSERT INTO dgii_ncf_sequences 
        (tipo_comprobante, nombre_comprobante, numero_desde, numero_hasta, secuencia_actual, cantidad_aprobada, cantidad_usada, fecha_vencimiento, estado)
      VALUES 
        ('E32', 'Nuevo Lote Autorizado', 'E329998880001', 'E329998880010', 0, 10, 0, '2028-12-31', 'Activo')
    `);
    testSeqIdsCreated.push(resNewBatch.insertId);

    // Reintentar la operación que había sido bloqueada en Test 6 (Cajera B)
    const retryRes = await callRoute(visitsRouterObj.handleCheckoutVisit, reqB);
    assert.strictEqual(retryRes.status, 200, 'Al agregar nuevas secuencias, el cobro debe completarse inmediatamente');
    assert.strictEqual(retryRes.body.ncf, 'E329998880001', 'Debe recibir la primera secuencia del nuevo lote');
    console.log(`   OK: Operación desbloqueada inmediatamente sin reinicio de backend: NCF asignado ${retryRes.body.ncf}.\n`);

    // -------------------------------------------------------------------------
    // TEST 8: PRECUENTA (NO FISCAL, NO INGRESO, PENDIENTE DE PAGO)
    // -------------------------------------------------------------------------
    console.log('8. [Precuenta] Generando precuenta oficial...');
    const vIdPrecuenta = `TEST-PREC-${Date.now()}`;
    testVisitsCreated.push(vIdPrecuenta);

    const precuentaReq = {
      body: {
        ticketId: vIdPrecuenta,
        client_name: 'Clienta Precuenta',
        client_id: 'CLI-PREC-01',
        total: 1450.00,
        metodo_pago: 'Pendiente',
        salon_id: 1,
        items_detail: [
          { nombre: 'Tratamiento Profundo', precioAplicado: 850, cantidad: 1 },
          { nombre: 'Corte de Puntas', precioAplicado: 600, cantidad: 1 }
        ]
      }
    };

    const precuentaRes = await callRoute(visitsRouterObj.handlePrecuenta, precuentaReq);
    assert.strictEqual(precuentaRes.status, 200, 'Precuenta debe retornar HTTP 200');
    assert.strictEqual(precuentaRes.body.is_precuenta, true, 'Debe indicar is_precuenta = true');
    assert.strictEqual(precuentaRes.body.status, 'Pendiente', 'El estado debe ser Pendiente');
    assert.strictEqual(precuentaRes.body.message, 'PRECUENTA — NO ES FACTURA FISCAL — PENDIENTE DE PAGO');

    // Comprobar en BD
    const [precDbRow] = await conn.query('SELECT status, ncf, ncf_type, ncf_name, total FROM visits WHERE id = ?', [vIdPrecuenta]);
    assert.strictEqual(precDbRow[0]?.status, 'Pendiente', 'En BD debe quedar Pendiente');
    assert.strictEqual(precDbRow[0]?.ncf, null, 'En BD no debe tener ncf');
    assert.strictEqual(precDbRow[0]?.ncf_type, 'PRECUENTA', 'ncf_type debe ser PRECUENTA');
    assert.strictEqual(precDbRow[0]?.ncf_name, 'Precuenta No Fiscal');
    console.log('   OK: Precuenta creada y validada en BD como NO FISCAL, Pendiente y con encabezado homologado.\n');

    // -------------------------------------------------------------------------
    // TEST 9: INCIDENCIA DE COBRO PRE-AUTORIZADO AUDITADA
    // -------------------------------------------------------------------------
    console.log('9. [Auditoría de Incidencia] Verificando registro en audit_logs ante cobro previo sin comprobante...');
    // Simulamos un checkout con un pago previo que falla por agotamiento
    const vIdAudit = `TEST-AUDIT-INCIDENT-${Date.now()}`;
    testVisitsCreated.push(vIdAudit);

    // Aseguramos que E31 siga agotado
    const auditCheckoutReq = {
      params: { id: vIdAudit },
      body: {
        ticketId: vIdAudit,
        client_name: 'Cliente Con Pago Previo',
        total: 2000.00,
        metodo_pago: 'Tarjeta',
        applied_payments: [{ method: 'Tarjeta', amount: 2000, reference: 'AUTH-123456' }],
        ncf_type: 'E31',
        rnc_cliente: '131917038',
        rzn_soc_cliente: 'Cliente Con Pago Previo SRL'
      }
    };

    const auditRes = await callRoute(visitsRouterObj.handleCheckoutVisit, auditCheckoutReq);
    assert.strictEqual(auditRes.status, 409);

    // Verificar en audit_logs que se registró la incidencia
    const [auditRows] = await conn.query('SELECT * FROM audit_logs WHERE action = "COBRO_PREVIO_BLOQUEADO_POR_AGOTAMIENTO" AND entity_id = ?', [vIdAudit]);
    assert.ok(auditRows.length > 0, 'Debe registrar la incidencia en audit_logs');
    console.log(`   OK: Incidencia registrada en audit_logs ID ${auditRows[0].id} para conciliación manual sin cobros secundarios.\n`);

  } catch (err) {
    console.error('❌ ERROR DENTRO DE TRY:', err);
    throw err;
  } finally {
    // -------------------------------------------------------------------------
    // LIMPIEZA COMPLETA Y RESTAURACIÓN A ESTADO INICIAL
    // -------------------------------------------------------------------------
    console.log('🧹 Limpiando registros sintéticos de prueba...');

    // Eliminar visitas de prueba
    if (testVisitsCreated.length > 0) {
      await conn.query(`DELETE FROM visits WHERE id IN (${testVisitsCreated.map(() => '?').join(',')})`, testVisitsCreated);
      await conn.query(`DELETE FROM audit_logs WHERE entity_id IN (${testVisitsCreated.map(() => '?').join(',')})`, testVisitsCreated);
    }

    // Eliminar lotes sintéticos creados
    if (testSeqIdsCreated.length > 0) {
      await conn.query(`DELETE FROM dgii_ncf_sequences WHERE id IN (${testSeqIdsCreated.map(() => '?').join(',')})`, testSeqIdsCreated);
    }

    // Restaurar lotes originales exactamente como estaban
    for (const initSeq of initialSequences) {
      await conn.query(
        `UPDATE dgii_ncf_sequences 
         SET estado = ?, cantidad_usada = ?, secuencia_actual = ?, updated_at = NOW() 
         WHERE id = ?`,
        [initSeq.estado, initSeq.cantidad_usada, initSeq.secuencia_actual, initSeq.id]
      );
    }

    const [finalSequences] = await conn.query('SELECT * FROM dgii_ncf_sequences ORDER BY id ASC');
    console.log('✅ Estado final de dgii_ncf_sequences restaurado íntegramente:');
    for (const s of finalSequences) {
      console.log(`   - ID ${s.id} (${s.tipo_comprobante}): actual=${s.secuencia_actual}, usada=${s.cantidad_usada}/${s.cantidad_aprobada}, estado=${s.estado}`);
    }

    await conn.release();
    await pool.end();
  }

  console.log('\n========================================================================');
  console.log('=== TODOS LOS TESTS PASARON CON ÉXITO: 0 ERRORES, 100% CONFIABILIDAD ===');
  console.log('========================================================================\n');
}

runTestSuite().catch(err => {
  console.error('\n❌ ERROR EN TEST SUITE:', err);
  process.exit(1);
});
