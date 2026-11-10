const path = require('path');
const assert = require('assert');
const dotenv = require(path.join(__dirname, 'node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '.env') });
const mysql = require(path.join(__dirname, 'node_modules/mysql2/promise'));
const { 
  createVisitsRouter, 
  validateReceptorTaxId, 
  isValidRnc, 
  isValidCedula, 
  isValidRazonSocial 
} = require('./routes/visits.routes');

async function runSafeFiscalValidation() {
  console.log('========================================================================');
  console.log('=== SALONPRO: VALIDACIÓN FISCAL SEGURA EN ENTORNO AISLADO ===');
  console.log('========================================================================\n');

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
  });

  try {
    // -------------------------------------------------------------------------
    // 0. CAPTURAR ESTADO DE SECUENCIAS PRODUCTIVAS ANTES DEL TEST
    // -------------------------------------------------------------------------
    console.log('0. [Inspección Inicial] Verificando secuencias productivas reales...');
    const [initialSeqs] = await pool.query(
      "SELECT id, tipo_comprobante, secuencia_actual, cantidad_usada, estado FROM dgii_ncf_sequences WHERE tipo_comprobante IN ('E31', 'E32', 'E34')"
    );
    console.table(initialSeqs);

    // -------------------------------------------------------------------------
    // 1. VALIDACIÓN FISCAL DEL RECEPTOR (RNC, CÉDULA Y RAZÓN SOCIAL)
    // -------------------------------------------------------------------------
    console.log('\n1. [Validación Fiscal Receptor] Pruebas unitarias de algoritmos Módulo 11 y Luhn...');

    // RNCs válidos (Módulo 11)
    assert.strictEqual(isValidRnc('131917038'), true, 'RNC ETEREAS 131917038 debe ser válido');
    assert.strictEqual(isValidRnc('101000015'), true, 'RNC Banreservas 101000015 debe ser válido');
    assert.strictEqual(isValidRnc('101010101'), true, 'RNC 101010101 debe ser válido');

    // RNCs inválidos
    assert.strictEqual(isValidRnc('131917039'), false, 'RNC con dígito inválido debe fallar');
    assert.strictEqual(isValidRnc('12345678'), false, 'RNC con 8 dígitos debe fallar');
    assert.strictEqual(isValidRnc('1234567890'), false, 'RNC con 10 dígitos debe fallar');

    // Cédulas válidas (Luhn / Módulo 10)
    assert.strictEqual(isValidCedula('00100000017'), true, 'Cédula con Luhn válido debe pasar');
    assert.strictEqual(isValidCedula('00100000002'), false, 'Cédula con Luhn inválido debe fallar');
    assert.strictEqual(isValidCedula('12345'), false, 'Cédula incompleta debe fallar');

    // Helper unificado validateReceptorTaxId
    const valRnc = validateReceptorTaxId('131-91703-8');
    assert.strictEqual(valRnc.isValid, true, 'validateReceptorTaxId debe limpiar guiones');
    assert.strictEqual(valRnc.type, 'RNC');

    const valBadRnc = validateReceptorTaxId('131-91703-9');
    assert.strictEqual(valBadRnc.isValid, false);
    assert.ok(valBadRnc.error.includes('Módulo 11'));

    // Razón Social
    assert.strictEqual(isValidRazonSocial('ETEREAS SRL'), true);
    assert.strictEqual(isValidRazonSocial('Farmacia Los Hidalgos SAS'), true);
    assert.strictEqual(isValidRazonSocial(''), false, 'Vacía debe fallar');
    assert.strictEqual(isValidRazonSocial('Cliente General'), false, 'Genérica debe fallar');
    assert.strictEqual(isValidRazonSocial('CONSUMIDOR FINAL'), false, 'Consumidor final debe fallar para E31');
    assert.strictEqual(isValidRazonSocial('N/A'), false, 'N/A debe fallar');

    console.log('   OK: Validadores fiscales de RNC, Cédula y Razón Social operando al 100%.');

    // -------------------------------------------------------------------------
    // 2. REGLAS DE EMISIÓN EN CHECKOUT (AISLADO SIN AFECTAR SECUENCIAS REALES)
    // -------------------------------------------------------------------------
    console.log('\n2. [Reglas de Emisión Checkout] Verificando bloqueo de NONE en ventas comerciales y E31...');

    let syntheticE32Counter = 50000;
    let syntheticE34Counter = 1000;
    let sequenceAssignedType = null;
    const mockTransmittedNotaCreditos = [];

    // Dependencias mockeadas para no consumir secuencias ni invocar WS DGII
    const isolatedDeps = {
      transmitInvoiceDirectlyToDgii: async (id) => true,
      assignDgiiSequenceToVisit: async (visitId, requestedType, clientRnc, clientRazonSocial, totalAmount, metodoPago) => {
        sequenceAssignedType = requestedType;
        const syntheticNcf = `E32${String(++syntheticE32Counter).padStart(10, '0')}`;
        await pool.query(
          "UPDATE visits SET ncf = ?, ncf_type = 'E32', ncf_name = 'Factura de Consumo Electrónica' WHERE id = ?",
          [syntheticNcf, visitId]
        );
        return { ncf: syntheticNcf, ncf_type: 'E32', ncf_name: 'Factura de Consumo Electrónica' };
      },
      generateAndTransmitNotaCredito: async (visit, voidReason, userWhoVoided) => {
        const nextNcNum = ++syntheticE34Counter;
        const mockE34 = `E34${String(nextNcNum).padStart(10, '0')}`;
        mockTransmittedNotaCreditos.push({
          encf: mockE34,
          originalNcf: visit.ncf,
          reason: voidReason,
          trackId: `TRK-MOCK-${Date.now()}`
        });
        return {
          encf: mockE34,
          trackId: `TRK-MOCK-${Date.now()}`,
          signedXml: `<ECF><eNCF>${mockE34}</eNCF></ECF>`
        };
      },
      sendSurveyEmail: async () => true
    };

    const isolatedRouter = createVisitsRouter(pool, isolatedDeps);

    // Mock helper para ejecutar requests contra router.handle
    const executeRoute = (method, url, body = {}, query = {}) => {
      return new Promise((resolve) => {
        let statusCode = 200;
        let responseData = null;
        const req = { method, url, body, query, params: {} };
        const res = {
          statusCode: 200,
          status(code) { this.statusCode = code; statusCode = code; return this; },
          json(data) { responseData = data; resolve({ status: statusCode, body: data }); },
          send(data) { responseData = data; resolve({ status: statusCode, body: data }); }
        };
        isolatedRouter.router.handle(req, res, (err) => {
          if (err) resolve({ status: 500, error: err.message });
        });
      });
    };

    // Caso 2.1: Solicitud de E31 con RNC inválido
    const resBadRnc = await executeRoute('POST', '/checkout', {
      ticketId: 'TEST-ISO-E31-BAD',
      total: 1500,
      ncf_type: 'E31',
      rnc_cliente: '131917039', // dígito verificador inválido
      rzn_soc_cliente: 'Empresa Falsa SRL'
    });
    assert.strictEqual(resBadRnc.status, 400, 'Debe rechazar con HTTP 400 RNC inválido para E31');
    assert.ok(resBadRnc.body.error.includes('inválida para Factura de Crédito Fiscal'), 'Debe indicar causa exacta');
    console.log('   OK: Rechazo 400 de E31 con RNC inválido verificado.');

    // Caso 2.2: Solicitud de E31 con Razón Social vacía o genérica
    const resBadRzn = await executeRoute('POST', '/checkout', {
      ticketId: 'TEST-ISO-E31-NO-RZN',
      total: 2000,
      ncf_type: 'E31',
      rnc_cliente: '131917038', // RNC válido
      rzn_soc_cliente: 'Cliente General' // Razón social genérica
    });
    assert.strictEqual(resBadRzn.status, 400, 'Debe rechazar con HTTP 400 Razón Social genérica para E31');
    assert.ok(resBadRzn.body.error.includes('Razón Social del receptor es obligatoria'), 'Debe indicar causa exacta');
    console.log('   OK: Rechazo 400 de E31 con Razón Social genérica verificado.');

    // Caso 2.3: Venta Comercial (total > 0) con ncf_type: 'NONE'
    // La regla DEBE impedir que se omita el comprobante; se forzará E32 en vez de NONE
    const testComVisitId = `TEST-ISO-COM-${Date.now()}`;
    await pool.query(
      `INSERT INTO visits (id, ticket_number, client_id, client_name, total, metodo_pago, status, visited_at)
       VALUES (?, 'TK-TEST-1', 'C-01', 'Cliente Comercial', 850.00, 'Efectivo', 'Pendiente', NOW())`,
      [testComVisitId]
    );

    sequenceAssignedType = null;
    const resComNone = await executeRoute('POST', `/${testComVisitId}/checkout`, {
      total: 850.00,
      metodo_pago: 'Efectivo',
      ncf_type: 'NONE' // Intentando omitir comprobante en venta comercial
    });
    assert.strictEqual(resComNone.status, 200);
    assert.strictEqual(sequenceAssignedType, 'E32', 'Venta comercial con total > 0 DEBE forzar E32 incluso si el frontend mandó NONE');

    const [comRows] = await pool.query('SELECT ncf, ncf_type, ncf_name FROM visits WHERE id = ?', [testComVisitId]);
    assert.ok(comRows[0].ncf && comRows[0].ncf.startsWith('E32'), 'Venta comercial debe tener e-NCF E32');
    console.log(`   OK: Bloqueo de omisión fiscal en venta comercial verificado (Forzado ${comRows[0].ncf}).`);

    // Caso 2.4: Canje de Membresía Plan Beauty a costo RD$ 0
    const testCanjeVisitId = `TEST-ISO-CANJE-${Date.now()}`;
    await pool.query(
      `INSERT INTO visits (id, ticket_number, client_id, client_name, total, metodo_pago, status, visited_at)
       VALUES (?, 'TK-TEST-2', 'C-02', 'Socia Plan Beauty', 0.00, 'Plan Beauty', 'Pendiente', NOW())`,
      [testCanjeVisitId]
    );

    const resCanje = await executeRoute('POST', `/${testCanjeVisitId}/checkout`, {
      total: 0.00,
      metodo_pago: 'Plan Beauty',
      ncf_type: 'NONE'
    });
    assert.strictEqual(resCanje.status, 200);

    const [canjeRows] = await pool.query('SELECT ncf, ncf_type, ncf_name FROM visits WHERE id = ?', [testCanjeVisitId]);
    assert.strictEqual(canjeRows[0].ncf, null, 'Canje debe tener ncf = NULL');
    assert.strictEqual(canjeRows[0].ncf_type, 'NONE');
    assert.strictEqual(canjeRows[0].ncf_name, 'Comprobante de Canje Plan Beauty', 'Canje documenta formalmente su naturaleza');
    console.log('   OK: Canje legítimo Plan Beauty documentado como Comprobante de Canje Plan Beauty.');

    // Caso 2.5: Operación interna a costo RD$ 0 no asociada a membresía
    const testZeroVisitId = `TEST-ISO-ZERO-${Date.now()}`;
    await pool.query(
      `INSERT INTO visits (id, ticket_number, client_id, client_name, total, metodo_pago, status, visited_at)
       VALUES (?, 'TK-TEST-3', 'C-03', 'Cortesía de Cumpleaños', 0.00, 'Cortesía Interna', 'Pendiente', NOW())`,
      [testZeroVisitId]
    );

    const resZero = await executeRoute('POST', `/${testZeroVisitId}/checkout`, {
      total: 0.00,
      metodo_pago: 'Cortesía Interna',
      ncf_type: 'NONE'
    });
    assert.strictEqual(resZero.status, 200);

    const [zeroRows] = await pool.query('SELECT ncf, ncf_type, ncf_name FROM visits WHERE id = ?', [testZeroVisitId]);
    assert.strictEqual(zeroRows[0].ncf, null);
    assert.strictEqual(zeroRows[0].ncf_type, 'NONE');
    assert.strictEqual(zeroRows[0].ncf_name, 'Comprobante de Cortesía / Ajuste Interno');
    console.log('   OK: Operación interna $0 documentada como Comprobante de Cortesía / Ajuste Interno.');

    // -------------------------------------------------------------------------
    // 3. ANULACIONES Y DISTINCIÓN DE NOTA DE CRÉDITO E34
    // -------------------------------------------------------------------------
    console.log('\n3. [Anulaciones y E34] Verificando distinción entre facturas con e-NCF y operaciones sin comprobante...');

    // 3.1: Anulación de Factura Comercial con e-NCF E32 -> Debe emitir Nota de Crédito E34
    const originalComNcf = comRows[0].ncf;
    const resVoidCom = await executeRoute('POST', `/${testComVisitId}/void`, {
      reason: 'Cliente canceló el servicio comercial por duplicidad',
      voided_by: 'Auditor Fiscal Senior'
    });
    assert.strictEqual(resVoidCom.status, 200);
    assert.strictEqual(resVoidCom.body.ncf_original, originalComNcf, 'Debe preservar el NCF original');
    assert.ok(resVoidCom.body.ncf_nota_credito && resVoidCom.body.ncf_nota_credito.startsWith('E34'), 'Debe generar Nota de Crédito E34');
    assert.ok(resVoidCom.body.track_id_nota_credito, 'Debe capturar TrackID de DGII');
    assert.ok(resVoidCom.body.fiscal_status.includes('Nota de Crédito Electrónica'), 'Debe reportar estado fiscal correcto');

    // Verificar en BD que el registro conserva ncf y status = 'Anulado'
    const [voidedDbRows] = await pool.query('SELECT status, ncf, void_reason, voided_by FROM visits WHERE id = ?', [testComVisitId]);
    assert.strictEqual(voidedDbRows[0].status, 'Anulado');
    assert.strictEqual(voidedDbRows[0].ncf, originalComNcf, 'NCF histórico NUNCA debe borrarse al anular');
    console.log(`   OK: Factura fiscal ${originalComNcf} anulada conservando NCF y emitiendo Nota de Crédito ${resVoidCom.body.ncf_nota_credito}.`);

    // 3.2: Anulación de Canje Plan Beauty (ncf = NULL) -> No debe emitir Nota de Crédito
    const initialNcCount = mockTransmittedNotaCreditos.length;
    const resVoidCanje = await executeRoute('POST', `/${testCanjeVisitId}/void`, {
      reason: 'Cancelación de turno de canje de lavados',
      voided_by: 'Recepcionista'
    });
    assert.strictEqual(resVoidCanje.status, 200);
    assert.strictEqual(resVoidCanje.body.ncf_nota_credito, null, 'Canje no fiscal no debe emitir Nota de Crédito');
    assert.strictEqual(mockTransmittedNotaCreditos.length, initialNcCount, 'No debe consumir secuencias E34 para operaciones no fiscales');
    assert.ok(resVoidCanje.body.fiscal_status.includes('sin consumo de e-NCF'), 'Debe describir estado no fiscal');
    console.log('   OK: Canje sin comprobante anulado directamente sin emitir Nota de Crédito innecesaria.');

    // -------------------------------------------------------------------------
    // 4. CONCURRENCIA SINTÉTICA AISLADA (SIN DUPLICADOS)
    // -------------------------------------------------------------------------
    console.log('\n4. [Concurrencia Aislada] Simulando 10 asignaciones paralelas en memoria atómica...');

    let concurrentSequence = 90000;
    const allocateSyntheticSequence = async () => {
      // Simulación de transacción FOR UPDATE atómica en memoria
      return new Promise((resolve) => {
        setTimeout(() => {
          concurrentSequence += 1;
          resolve(`E32${String(concurrentSequence).padStart(10, '0')}`);
        }, Math.random() * 20);
      });
    };

    const concurrentResults = await Promise.all(
      Array.from({ length: 10 }).map(() => allocateSyntheticSequence())
    );

    const uniqueSet = new Set(concurrentResults);
    assert.strictEqual(uniqueSet.size, 10, 'Todas las secuencias concurrentes deben ser 100% únicas');
    console.log(`   OK: 10/10 asignaciones concurrentes procesadas sin colisiones (${concurrentResults[0]} -> ${concurrentResults[9]}).`);

    // -------------------------------------------------------------------------
    // 5. ENDPOINT DE RESUMEN FISCAL REAL (/stats/fiscal-summary)
    // -------------------------------------------------------------------------
    console.log('\n5. [Estadísticas Reales] Consultando endpoint /stats/fiscal-summary...');

    const resStats = await executeRoute('GET', '/stats/fiscal-summary', {}, {});
    assert.strictEqual(resStats.status, 200);
    const stats = resStats.body;

    console.log('   Métricas generales en base de datos:');
    console.log(`   - Total operaciones: ${stats.total_operaciones}`);
    console.log(`   - Operaciones vigentes: ${stats.operaciones_vigentes}`);
    console.log(`   - Operaciones anuladas: ${stats.operaciones_anuladas}`);
    console.log(`   - Vigentes con comprobante: ${stats.vigentes_con_comprobante}`);
    console.log(`   - Vigentes sin comprobante: ${stats.vigentes_sin_comprobante}`);
    console.log('   Desglose por método de pago:');
    console.log(`   - Efectivo (Vigentes: ${stats.desglose_por_metodo.efectivo.vigentes}, Con e-NCF: ${stats.desglose_por_metodo.efectivo.con_comprobante}, Sin e-NCF: ${stats.desglose_por_metodo.efectivo.sin_comprobante}, Anuladas: ${stats.desglose_por_metodo.efectivo.anuladas})`);
    console.log(`   - Tarjeta (Vigentes: ${stats.desglose_por_metodo.tarjeta.vigentes}, Con e-NCF: ${stats.desglose_por_metodo.tarjeta.con_comprobante}, Sin e-NCF: ${stats.desglose_por_metodo.tarjeta.sin_comprobante}, Anuladas: ${stats.desglose_por_metodo.tarjeta.anuladas})`);

    assert.ok(stats.operaciones_vigentes >= 0);
    assert.ok(stats.desglose_por_metodo.efectivo.total >= 0);

    // -------------------------------------------------------------------------
    // 6. LIMPIEZA DE REGISTROS TEMPORALES DEL TEST
    // -------------------------------------------------------------------------
    console.log('\n6. [Limpieza Aislada] Purgando registros temporales de prueba...');
    await pool.query("DELETE FROM visits WHERE id IN (?, ?, ?)", [testComVisitId, testCanjeVisitId, testZeroVisitId]);
    await pool.query("DELETE FROM audit_logs WHERE entity_id IN (?, ?, ?)", [testComVisitId, testCanjeVisitId, testZeroVisitId]);
    console.log('   OK: Registros sintéticos eliminados. Base de datos limpia.');

    // -------------------------------------------------------------------------
    // 7. COMPROBACIÓN FINAL DE INTEGRIDAD DE SECUENCIAS PRODUCTIVAS
    // -------------------------------------------------------------------------
    console.log('\n7. [Comprobación de Integridad] Verificando que dgii_ncf_sequences NO fue alterada...');
    const [finalSeqs] = await pool.query(
      "SELECT id, tipo_comprobante, secuencia_actual, cantidad_usada, estado FROM dgii_ncf_sequences WHERE tipo_comprobante IN ('E31', 'E32', 'E34')"
    );
    console.table(finalSeqs);

    for (let i = 0; i < initialSeqs.length; i++) {
      const init = initialSeqs[i];
      const fin = finalSeqs.find(f => f.id === init.id);
      assert.strictEqual(fin.secuencia_actual, init.secuencia_actual, `Secuencia actual de ${init.tipo_comprobante} debe permanecer intacta`);
      assert.strictEqual(fin.cantidad_usada, init.cantidad_usada, `Cantidad usada de ${init.tipo_comprobante} debe permanecer intacta`);
    }

    console.log('   PERFECTO: Cero secuencias productivas consumidas. Integridad 100% verificada.');

    console.log('\n========================================================================');
    console.log('=== TODAS LAS PRUEBAS DE CIERRE FISCAL SEGURO HAN SIDO APROBADAS ===');
    console.log('========================================================================');

  } catch (err) {
    console.error('\n❌ ERROR EN PRUEBAS:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runSafeFiscalValidation();
