const path = require('path');
const assert = require('assert');
const dotenv = require(path.join(__dirname, 'node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '.env') });
const mysql = require(path.join(__dirname, 'node_modules/mysql2/promise'));
const { createVisitsRouter } = require('./routes/visits.routes');

async function runTestSuite() {
  console.log('========================================================================');
  console.log('=== SALONPRO: TEST DE EMISIÓN FISCAL, CONCURRENCIA Y ANULACIONES ===');
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

  // Mock dependencies for visits router
  let lastNotaCreditoEmitted = null;
  const mockDeps = {
    transmitInvoiceDirectlyToDgii: async (id) => true,
    generateAndTransmitNotaCredito: async (visit, voidReason, userWhoVoided) => {
      // Allocate real sequence or mock E34
      const [batches] = await pool.query(
        "SELECT * FROM dgii_ncf_sequences WHERE tipo_comprobante = 'E34' AND estado = 'Activo' LIMIT 1"
      );
      if (batches.length > 0) {
        const seq = batches[0];
        const nextNum = (parseInt(seq.numero_desde.slice(3), 10) || 1) + seq.cantidad_usada;
        const encfE34 = 'E34' + String(nextNum).padStart(10, '0');
        await pool.query('UPDATE dgii_ncf_sequences SET cantidad_usada = cantidad_usada + 1 WHERE id = ?', [seq.id]);
        await pool.query('UPDATE visits SET ncf_nota_credito = ?, nota_credito_motivo = ?, nota_credito_fecha = NOW() WHERE id = ?', [encfE34, voidReason, visit.id]);
        lastNotaCreditoEmitted = encfE34;
        return encfE34;
      }
      const fallbackE34 = 'E340000000099';
      await pool.query('UPDATE visits SET ncf_nota_credito = ?, nota_credito_motivo = ?, nota_credito_fecha = NOW() WHERE id = ?', [fallbackE34, voidReason, visit.id]);
      lastNotaCreditoEmitted = fallbackE34;
      return fallbackE34;
    },
    sendSurveyEmail: async () => true
  };

  const visitsModule = createVisitsRouter(pool, mockDeps);
  const assignDgii = visitsModule.assignDgiiSequenceToVisit;
  const testIdsCreated = [];

  try {
    // -------------------------------------------------------------------------
    // TEST 1: FACTURACIÓN CONSECUTIVA
    // -------------------------------------------------------------------------
    console.log('1. [Facturación Consecutiva] Emitiendo 3 facturas comerciales consecutivas...');
    const consecutiveIds = [
      `TEST-FISCAL-CONS-${Date.now()}-1`,
      `TEST-FISCAL-CONS-${Date.now()}-2`,
      `TEST-FISCAL-CONS-${Date.now()}-3`
    ];

    const consecutiveNcfs = [];
    for (const vId of consecutiveIds) {
      testIdsCreated.push(vId);
      await conn.query(`
        INSERT INTO visits (id, client_name, total, metodo_pago, status, visited_at)
        VALUES (?, 'Cliente Final', 600.00, 'Efectivo', 'Facturado', NOW())
      `, [vId]);

      const resDgii = await assignDgii(vId, 'E32', null, null, 600.00, 'Efectivo');
      assert.ok(resDgii?.ncf, 'Debe asignar e-NCF para venta comercial');
      consecutiveNcfs.push(resDgii.ncf);
      console.log(`   OK: Visita ${vId} -> e-NCF ${resDgii.ncf} (${resDgii.ncf_name})`);
    }

    // Verificar que las secuencias numéricas sean estrictamente consecutivas
    const num1 = parseInt(consecutiveNcfs[0].slice(3), 10);
    const num2 = parseInt(consecutiveNcfs[1].slice(3), 10);
    const num3 = parseInt(consecutiveNcfs[2].slice(3), 10);
    assert.strictEqual(num2, num1 + 1, 'Secuencia 2 debe ser n+1');
    assert.strictEqual(num3, num2 + 1, 'Secuencia 3 debe ser n+2');
    console.log(`   OK: Secuencias numéricas consecutivas verificadas: ${num1} -> ${num2} -> ${num3}.\n`);

    // -------------------------------------------------------------------------
    // TEST 2: CONCURRENCIA ATÓMICA
    // -------------------------------------------------------------------------
    console.log('2. [Concurrencia] Ejecutando 5 emisiones fiscales en paralelo con transacciones concurrentes...');
    const concurrentIds = Array.from({ length: 5 }, (_, i) => `TEST-FISCAL-CONC-${Date.now()}-${i + 1}`);

    for (const vId of concurrentIds) {
      testIdsCreated.push(vId);
      await conn.query(`
        INSERT INTO visits (id, client_name, total, metodo_pago, status, visited_at)
        VALUES (?, 'Cliente Concurrente', 800.00, 'Tarjeta', 'Facturado', NOW())
      `, [vId]);
    }

    // Ejecución paralela real con Promise.all
    const concurrentResults = await Promise.all(
      concurrentIds.map(vId => assignDgii(vId, 'E32', null, null, 800.00, 'Tarjeta'))
    );

    const allocatedNcfs = concurrentResults.map(r => r.ncf);
    console.log('   NCFs asignados concurrentemente:', allocatedNcfs);

    // Verificar unicidad absoluta (sin colisiones)
    const uniqueNcfs = new Set(allocatedNcfs);
    assert.strictEqual(uniqueNcfs.size, 5, 'Cada transacción concurrente debe recibir un e-NCF estrictamente único');

    // Verificar que formen un bloque contiguo
    const sortedNums = allocatedNcfs.map(n => parseInt(n.slice(3), 10)).sort((a, b) => a - b);
    for (let i = 1; i < sortedNums.length; i++) {
      assert.strictEqual(sortedNums[i], sortedNums[i - 1] + 1, 'Las secuencias concurrentes deben ser contiguas');
    }
    console.log('   OK: Concurrencia validada: 5 secuencias atómicas sin colisión ni saltos.\n');

    // -------------------------------------------------------------------------
    // TEST 3: ANULACIÓN DE OPERACIONES ANTIGUAS Y PROCEDIMIENTO FISCAL (E34)
    // -------------------------------------------------------------------------
    console.log('3. [Anulación Fiscal] Anulando factura antigua con e-NCF...');
    const oldVisitToVoid = consecutiveIds[0];
    const oldNcfToVoid = consecutiveNcfs[0];

    // Verificar estado del contador global de empresa antes de anular
    const [counterBefore] = await conn.query('SELECT cash_counter FROM company_ncf_counters WHERE id = 1');
    const cashCountBefore = counterBefore[0]?.cash_counter;

    // Ejecutar endpoint oficial de anulación
    await new Promise((resolve, reject) => {
      const mockReq = {
        method: 'POST',
        url: `/${oldVisitToVoid}/void`,
        params: { id: oldVisitToVoid },
        body: { reason: 'Devolución de servicio por cambio de horario', voided_by: 'Administrador Auditor' }
      };
      const mockRes = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(data) {
          if (this.statusCode >= 400) reject(new Error(data.error || 'Error'));
          else resolve(data);
        }
      };
      visitsModule.router.handle(mockReq, mockRes, (err) => { if (err) reject(err); });
    });

    // Verificar en BD que la factura conserve su NCF original y tenga su Nota de Crédito (E34)
    const [voidedRows] = await conn.query('SELECT status, ncf, ncf_nota_credito, nota_credito_motivo FROM visits WHERE id = ?', [oldVisitToVoid]);
    const voidedData = voidedRows[0];
    assert.strictEqual(voidedData.status, 'Anulado', 'Estado debe ser Anulado');
    assert.strictEqual(voidedData.ncf, oldNcfToVoid, 'El NCF histórico original DEBE conservarse para auditoría DGII');
    assert.ok(voidedData.ncf_nota_credito && voidedData.ncf_nota_credito.startsWith('E34'), 'Debe emitir Nota de Crédito Electrónica E34');
    console.log(`   OK: Factura anulada ${oldVisitToVoid} conserva e-NCF original ${oldNcfToVoid} y emite Nota de Crédito ${voidedData.ncf_nota_credito}`);

    // Verificar que cash_counter NO se haya decrementado
    const [counterAfter] = await conn.query('SELECT cash_counter FROM company_ncf_counters WHERE id = 1');
    const cashCountAfter = counterAfter[0]?.cash_counter;
    assert.strictEqual(cashCountAfter, cashCountBefore, 'El contador de operaciones NO debe decrementarse por anulaciones');
    console.log(`   OK: Contador de empresa preservado intacto (${cashCountBefore} == ${cashCountAfter}) sin decrementos por anulaciones.\n`);

    // -------------------------------------------------------------------------
    // TEST 4: AUSENCIA DE REUTILIZACIÓN DE SECUENCIAS
    // -------------------------------------------------------------------------
    console.log('4. [Ausencia de Reutilización] Emitiendo nueva factura post-anulación...');
    const postVoidId = `TEST-FISCAL-POSTVOID-${Date.now()}`;
    testIdsCreated.push(postVoidId);
    await conn.query(`
      INSERT INTO visits (id, client_name, total, metodo_pago, status, visited_at)
      VALUES (?, 'Cliente Nuevo Post-Anulacion', 950.00, 'Efectivo', 'Facturado', NOW())
    `, [postVoidId]);

    const postVoidResult = await assignDgii(postVoidId, 'E32', null, null, 950.00, 'Efectivo');
    const postVoidNcf = postVoidResult.ncf;
    const postVoidNum = parseInt(postVoidNcf.slice(3), 10);
    const maxPrevNum = Math.max(...sortedNums);

    assert.notStrictEqual(postVoidNcf, oldNcfToVoid, 'La secuencia anulada NUNCA debe reutilizarse');
    assert.ok(postVoidNum > maxPrevNum, `La nueva secuencia (${postVoidNum}) debe ser estrictamente mayor que todas las anteriores (${maxPrevNum})`);
    console.log(`   OK: Nueva factura asignó ${postVoidNcf} (Número ${postVoidNum} > ${maxPrevNum}). Secuencia anulada no reutilizada.\n`);

    // -------------------------------------------------------------------------
    // TEST 5: ESTADÍSTICAS REALES E INDEPENDIENTES (ENDPOINT /stats/fiscal-summary)
    // -------------------------------------------------------------------------
    console.log('5. [Estadísticas Reales] Consultando endpoint de métricas fiscales en tiempo real...');
    const statsData = await new Promise((resolve, reject) => {
      const mockReq = {
        method: 'GET',
        url: '/stats/fiscal-summary',
        query: {}
      };
      const mockRes = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(data) {
          if (this.statusCode >= 400) reject(new Error(data.error || 'Error'));
          else resolve(data);
        }
      };
      visitsModule.router.handle(mockReq, mockRes, (err) => { if (err) reject(err); });
    });

    console.log('   Métricas devueltas:', {
      total_operaciones: statsData.total_operaciones,
      operaciones_vigentes: statsData.operaciones_vigentes,
      operaciones_anuladas: statsData.operaciones_anuladas,
      vigentes_con_comprobante: statsData.vigentes_con_comprobante,
      vigentes_sin_comprobante: statsData.vigentes_sin_comprobante,
      anuladas_con_comprobante: statsData.anuladas_con_comprobante,
      anuladas_sin_comprobante: statsData.anuladas_sin_comprobante
    });

    assert.ok(statsData.total_operaciones > 0, 'Total operaciones > 0');
    assert.strictEqual(
      statsData.total_operaciones,
      statsData.operaciones_vigentes + statsData.operaciones_anuladas,
      'Total debe ser igual a vigentes + anuladas'
    );
    assert.strictEqual(
      statsData.operaciones_vigentes,
      statsData.vigentes_con_comprobante + statsData.vigentes_sin_comprobante,
      'Vigentes debe ser igual a vigentes con comprobante + vigentes sin comprobante'
    );
    assert.strictEqual(
      statsData.operaciones_anuladas,
      statsData.anuladas_con_comprobante + statsData.anuladas_sin_comprobante,
      'Anuladas debe ser igual a anuladas con comprobante + anuladas sin comprobante'
    );
    console.log('   OK: Consistencia matemática perfecta de estadísticas basada en registros reales.\n');

    // -------------------------------------------------------------------------
    // TEST 6: LIMPIEZA DE DATOS TEMPORALES
    // -------------------------------------------------------------------------
    console.log('6. [Limpieza] Purgando registros temporales de prueba...');
    for (const vId of testIdsCreated) {
      await conn.query('DELETE FROM visits WHERE id = ?', [vId]);
      await conn.query('DELETE FROM audit_logs WHERE entity_id = ?', [vId]);
    }
    console.log(`   OK: ${testIdsCreated.length} visitas de prueba purgadas. Base de datos limpia.`);

    console.log('\n========================================================================');
    console.log('=== TODAS LAS PRUEBAS (CONSECUTIVIDAD, CONCURRENCIA, NOTAS DE CRÉDITO, NO REUTILIZACIÓN Y ESTADÍSTICAS) PASARON EXITOSAMENTE ===');
    console.log('========================================================================');

  } catch (err) {
    console.error('ERROR EN PRUEBAS:', err);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

runTestSuite();

