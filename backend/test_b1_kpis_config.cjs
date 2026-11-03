/**
 * Test Suite: FASE B1 — Configuración del Reporte, 4 KPIs y Conciliación Independiente
 *
 * Verifica:
 *   1. Configuración de ambos identificadores en biConfig.js (recurring_charges_result, declined_charges_recovery)
 *   2. Valores, denominadores y colores de los cuatro KPI
 *   3. Formateo de importes y porcentajes
 *   4. Separación estricta de deuda pendiente e importes cobrados sin atribución
 *   5. Inicialización y cambio de filtros
 *   6. Estados vacíos sin NaN ni datos simulados
 *   7. Manejo de errores formales
 *   8. Compatibilidad con componentes compartidos de BI
 */
const { handleBIReport } = require('./routes/bi_engine');

function createMockPool(fixtureData = {}) {
  const { contracts = [], payments = [], salons = [], contractSettings = [{ id: 1, renewal_fee: '800.00' }] } = fixtureData;

  return {
    async query(sql, params = []) {
      const sqlLower = sql.toLowerCase();

      if (sqlLower.includes('from contract_settings')) return [contractSettings];
      if (sqlLower.includes('from salons')) return [salons.length > 0 ? salons : [{ id: 1, name: 'San Vicente' }, { id: 2, name: 'Villa Mella' }]];
      if (sqlLower.includes('from contracts ct') || sqlLower.includes('from contracts c')) {
        let filtered = [...contracts];
        if (params && params.length > 0 && sqlLower.includes('salon_id')) {
          const salonParam = params.find(p => p !== undefined && (p === '1' || p === '2' || p === 1 || p === 2));
          if (salonParam) {
            filtered = filtered.filter(c => String(c.salon_id) === String(salonParam));
          }
        }
        return [filtered];
      }
      if (sqlLower.includes('from payments')) {
        const enriched = payments.map(p => ({
          ...p,
          created_at_str: p.created_at_str || (p.created_at ? (typeof p.created_at === 'string' ? p.created_at : p.created_at.toISOString().replace('T', ' ').slice(0, 19)) : '')
        }));
        return [enriched];
      }
      if (sqlLower.includes('from visits')) return [[{ total_ops: 0, total_monto: 0, avg_monto: 0 }]];
      return [[]];
    }
  };
}

async function runB1Tests() {
  console.log('======================================================================');
  console.log('SUITE TDD B1: CONFIGURACIÓN, CUATRO KPIS Y CONCILIACIÓN INDEPENDIENTE');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, name, details = '') {
    if (condition) {
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${name} ${details ? '- ' + details : ''}`);
      failed++;
    }
  }

  // 1. CONFIGURACIÓN DE IDENTIFICADORES Y COMPATIBILIDAD
  console.log('--- TEST 1: Configuración de identificadores en biConfig.js ---');
  {
    const fs = require('fs');
    const biConfigContent = fs.readFileSync('./src/components/bi/biConfig.js', 'utf8');

    assert(biConfigContent.includes("id: 'recurring_charges_result'"), 'T1: Identificador recurring_charges_result presente');
    assert(biConfigContent.includes("id: 'declined_charges_recovery'"), 'T1: Identificador declined_charges_recovery presente');
    assert(biConfigContent.includes("name: 'Efectividad de cobros y recuperación'"), 'T1: Nombre homologado Efectividad de cobros y recuperación');
    assert(biConfigContent.includes("hasPlanFilter: true"), 'T1: Filtro de plan habilitado en configuración');
  }

  // 2. UNIFICACIÓN DE TITULO EN BACKEND PARA AMBOS IDS
  console.log('\n--- TEST 2: Unificación de título para ambos identificadores ---');
  {
    const mock = createMockPool();
    const resRecurring = await handleBIReport(mock, { reportId: 'recurring_charges_result', startDate: '2026-10-01', endDate: '2026-10-31' });
    const resDeclined = await handleBIReport(mock, { reportId: 'declined_charges_recovery', startDate: '2026-10-01', endDate: '2026-10-31' });

    assert(resRecurring.title === 'Efectividad de cobros y recuperación', 'T2: recurring_charges_result retorna título unificado');
    assert(resDeclined.title === 'Efectividad de cobros y recuperación', 'T2: declined_charges_recovery retorna título unificado');
    assert(resRecurring.periodText.includes('Corte de evaluación: 2026-10-31'), 'T2: periodText indica fecha de corte de evaluación');
  }

  // 3. ESTRUCTURA, DENOMINADORES Y COLORES DE LOS 4 KPIS
  console.log('\n--- TEST 3: Cuatro tarjetas KPI con denominadores y colores normados ---');
  {
    // Dataset controlado: 10 obligaciones
    // 6 pagadas al 1er intento (60.0%)
    // 4 rechazadas inicialmente: 2 recuperadas por auto (blue), 1 por caja (manual), 1 sin recuperar
    // Confirmed declines = 4. Recovered = 3 (75.0%)
    // Saldo pendiente: 1 cuota x 1950 = RD$ 1,950
    // Unmatched: 1 pago aprobado de 1,950
    const contracts = [];
    const payments = [];

    // 6 1er intento
    for (let i = 1; i <= 6; i++) {
      const cid = `C_FIRST_${i}`;
      const ctid = `178000000010${i}`;
      contracts.push({ contract_id: ctid, client_id: cid, contract_price: 1950, signed_at: '2026-09-01' });
      payments.push({ id: `PAY-AUTO-1-${ctid.slice(-4)}`, client_id: cid, amount: 1950, method: 'CardNet_Auto', status: 'Aprobado', created_at: '2026-10-01 10:00:00' });
    }

    // 2 recuperadas auto
    for (let i = 1; i <= 2; i++) {
      const cid = `C_RECAUTO_${i}`;
      const ctid = `178000000020${i}`;
      contracts.push({ contract_id: ctid, client_id: cid, contract_price: 1950, signed_at: '2026-09-01' });
      payments.push({ id: `PAY-FAIL-1-${ctid.slice(-4)}`, client_id: cid, amount: 1950, method: 'CardNet_Auto', status: 'Fallido - Intento 1', created_at: '2026-10-01 10:00:00' });
      payments.push({ id: `PAY-AUTO-2-${ctid.slice(-4)}`, client_id: cid, amount: 1950, method: 'CardNet_Auto', status: 'Aprobado', created_at: '2026-10-03 10:00:00' });
    }

    // 1 recuperada manual
    {
      const cid = 'C_RECMAN_1';
      const ctid = '1780000000301';
      contracts.push({ contract_id: ctid, client_id: cid, contract_price: 1950, signed_at: '2026-09-01' });
      payments.push({ id: `PAY-FAIL-1-${ctid.slice(-4)}`, client_id: cid, amount: 1950, method: 'CardNet_Auto', status: 'Fallido - Intento 1', created_at: '2026-10-01 10:00:00' });
      payments.push({ id: `PAY-MAN-2-${ctid.slice(-4)}`, client_id: cid, amount: 1950, method: 'Efectivo/POS', status: 'Aprobado', created_at: '2026-10-05 12:00:00' });
    }

    // 1 sin recuperar
    {
      const cid = 'C_UNREC_1';
      const ctid = '1780000000401';
      contracts.push({ contract_id: ctid, client_id: cid, contract_price: 1950, signed_at: '2026-09-01' });
      payments.push({ id: `PAY-FAIL-1-${ctid.slice(-4)}`, client_id: cid, amount: 1950, method: 'CardNet_Auto', status: 'Fallido - Intento 1', created_at: '2026-10-01 10:00:00' });
    }

    // 1 pago sin atribuir (clienta con 2 contratos)
    {
      const cid = 'C_MULTI_1';
      contracts.push({ contract_id: '1780000000501', client_id: cid, contract_price: 1950, signed_at: '2026-09-01' });
      contracts.push({ contract_id: '1780000000502', client_id: cid, contract_price: 1950, signed_at: '2026-09-15' });
      payments.push({ id: 'PAY-UNMATCHED-1', client_id: cid, amount: 1950, method: 'Tarjeta_Guardada', status: 'Aprobado', created_at: '2026-10-10 14:00:00' });
    }

    const mock = createMockPool({ contracts, payments });
    const res = await handleBIReport(mock, { reportId: 'recurring_charges_result', startDate: '2026-10-01', endDate: '2026-10-31' });

    // KPI 1
    assert(res.kpis[0].label === 'Éxito al 1er intento', 'T3: KPI 1 label es Éxito al 1er intento');
    assert(res.kpis[0].value === '60.0%', 'T3: KPI 1 value es 60.0%');
    assert(res.kpis[0].subtext.includes('6 de 10 obligaciones evaluables'), 'T3: KPI 1 subtexto muestra numerador y denominador');
    assert(res.kpis[0].color === 'emerald', 'T3: KPI 1 color es emerald');

    // KPI 2
    assert(res.kpis[1].label === 'Recuperación tras rechazo', 'T3: KPI 2 label es Recuperación tras rechazo');
    assert(res.kpis[1].value === '75.0%', 'T3: KPI 2 value es 75.0% (3 de 4)');
    assert(res.kpis[1].subtext.includes('3 de 4 rechazadas'), 'T3: KPI 2 subtexto muestra 3 de 4');
    assert(res.kpis[1].subtext.includes('2 auto, 1 caja'), 'T3: KPI 2 diferencia recuperación auto vs caja');
    assert(res.kpis[1].color === 'blue', 'T3: KPI 2 color es blue');

    // KPI 3
    assert(res.kpis[2].label === 'Importe pendiente de recuperar', 'T3: KPI 3 label es Importe pendiente de recuperar');
    assert(res.kpis[2].value === 'RD$ 1,950', 'T3: KPI 3 suma exactamente RD$ 1,950 (excluye pagos sin atribuir)');
    assert(res.kpis[2].subtext.includes('1 obligación con saldo pendiente'), 'T3: KPI 3 indica cantidad de obligaciones con saldo pendiente');
    assert(res.kpis[2].color === 'red', 'T3: KPI 3 color es red cuando existe saldo pendiente');

    // KPI 4
    assert(res.kpis[3].label === 'Tiempo medio de recuperación', 'T3: KPI 4 label es Tiempo medio de recuperación');
    assert(res.kpis[3].value.includes('días') || res.kpis[3].value.includes('horas'), 'T3: KPI 4 formatea tiempo medio real');
    assert(res.kpis[3].subtext.includes('3 obligaciones recuperadas calculadas'), 'T3: KPI 4 indica cantidad de recuperadas');
    assert(res.kpis[3].color === 'amber', 'T3: KPI 4 color es amber');
  }

  // 4. SEPARACIÓN ESTRICTA DE DEUDA Y PAGOS SIN ATRIBUCIÓN
  console.log('\n--- TEST 4: Conciliación independiente y separación estricta ---');
  {
    const mock = createMockPool({
      contracts: [
        { contract_id: '1780000000601', client_id: 'C_MULTI_B', contract_price: 1950, signed_at: '2026-09-01' },
        { contract_id: '1780000000602', client_id: 'C_MULTI_B', contract_price: 1950, signed_at: '2026-09-15' }
      ],
      payments: [
        { id: 'PAY-UNM-1', client_id: 'C_MULTI_B', amount: 1950, method: 'Tarjeta_Guardada', status: 'Aprobado', created_at: '2026-10-07 13:52:16' },
        { id: 'PAY-UNM-2', client_id: 'C_MULTI_B', amount: 1950, method: 'Efectivo/POS', status: 'Aprobado', created_at: '2026-10-10 21:30:00' }
      ]
    });

    const res = await handleBIReport(mock, { reportId: 'recurring_charges_result', startDate: '2026-10-01', endDate: '2026-10-31' });

    assert(res.reconciliation.total_unmatched_approved_payments === 2, 'T4: Exactamente 2 pagos aprobados sin atribuir');
    assert(res.reconciliation.unmatched_approved_amount === 3900, 'T4: Monto cobrado sin atribuir es RD$ 3,900');
    assert(res.reconciliation.pending_confirmed_debt === 0, 'T4: Deuda contractual confirmada permanece en 0 (no se contamina)');
    assert(res.kpis[2].value === 'RD$ 0', 'T4: KPI Importe pendiente es RD$ 0');
  }

  // 5. ESTADO VACÍO SIN NAN NI DATOS SIMULADOS
  console.log('\n--- TEST 5: Estado vacío sin NaN ni datos simulados ---');
  {
    const mock = createMockPool({ contracts: [], payments: [] });
    const res = await handleBIReport(mock, { reportId: 'recurring_charges_result', startDate: '2026-10-01', endDate: '2026-10-31' });

    assert(res.kpis[0].value === '0.0%', 'T5: Tasa 1er intento es 0.0% (sin NaN)');
    assert(res.kpis[1].value === '0.0%', 'T5: Tasa recuperación es 0.0% (sin NaN)');
    assert(res.kpis[2].value === 'RD$ 0', 'T5: Saldo pendiente es RD$ 0');
    assert(res.kpis[3].value === '0 días', 'T5: Tiempo medio es 0 días');
    assert(res.table.rows.length === 0, 'T5: Cero filas en la tabla sin generadores ficticios');
  }

  // 6. FILTRO DE SUCURSAL Y PLAN
  console.log('\n--- TEST 6: Filtrado por sucursal y plan ---');
  {
    const mock = createMockPool({
      contracts: [
        { contract_id: '1780000000701', client_id: 'C_S1', salon_id: 1, plan_id: 'P01', plan: 'Plan Beauty', contract_price: 1950, signed_at: '2026-09-01' },
        { contract_id: '1780000000702', client_id: 'C_S2', salon_id: 2, plan_id: 'P02', plan: 'Plan VIP', contract_price: 3500, signed_at: '2026-09-01' }
      ],
      payments: [
        { id: 'PAY-AUTO-1-0701', client_id: 'C_S1', amount: 1950, method: 'CardNet_Auto', status: 'Aprobado', created_at: '2026-10-01 10:00:00' },
        { id: 'PAY-AUTO-1-0702', client_id: 'C_S2', amount: 3500, method: 'CardNet_Auto', status: 'Aprobado', created_at: '2026-10-01 10:00:00' }
      ]
    });

    const resS1 = await handleBIReport(mock, { reportId: 'recurring_charges_result', startDate: '2026-10-01', endDate: '2026-10-31', salonId: '1' });
    assert(resS1.table.rows.length === 1, 'T6: Filtro sucursal 1 retorna 1 contrato');
    assert(resS1.table.rows[0].contract_id === '1780000000701', 'T6: Corresponde al contrato de la sucursal 1');
  }

  console.log('\n======================================================================');
  console.log(`RESUMEN DE PRUEBAS TDD B1: ${passed} PASARON, ${failed} FALLARON`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runB1Tests();
}

module.exports = { runB1Tests };
