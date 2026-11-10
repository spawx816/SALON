/**
 * Test Suite: Motor de Efectividad de Cobros Recurrentes y Recuperación (Fase B0.5)
 *
 * Escenarios Sintéticos TDD sin conexión a CardNet ni modificaciones a BD productiva.
 * Incluye los 11 casos de prueba obligatorios especificados en la autorización B0.5:
 *   1. Segundo pago aprobado después de 10 días
 *   2. Nueva obligación legítima dentro de 20 días
 *   3. Pago adelantado
 *   4. Venta POS ajena a membresía de cliente con contrato único
 *   5. Mensualidad manual legítima sin referencia contractual explícita
 *   6. Pago parcial de RD$1,000 sobre cuota RD$1,950
 *   7. Varios abonos que completan una cuota
 *   8. Reverso posterior de un pago aprobado
 *   9. Reversión sin referencia inequívoca
 *  10. Regresión de RF-07
 *  11. Conciliación de eventos, obligaciones, pagos y saldos
 */
const { handleBIReport } = require('./routes/bi_engine');

function createMockPool(fixtureData) {
  const { contracts = [], payments = [], salons = [], contractSettings = [{ id: 1, renewal_fee: '800.00' }] } = fixtureData;

  return {
    async query(sql, params = []) {
      const sqlLower = sql.toLowerCase();

      if (sqlLower.includes('from contract_settings')) {
        return [contractSettings];
      }

      if (sqlLower.includes('from salons')) {
        return [salons.length > 0 ? salons : [
          { id: 1, name: 'San Vicente' },
          { id: 2, name: 'Villa Mella' }
        ]];
      }

      if (sqlLower.includes('from contracts ct') || sqlLower.includes('from contracts c')) {
        return [[...contracts]];
      }

      if (sqlLower.includes('from payments')) {
        const enriched = payments.map(p => ({
          ...p,
          created_at_str: p.created_at_str || (p.created_at ? (typeof p.created_at === 'string' ? p.created_at : p.created_at.toISOString().replace('T', ' ').slice(0, 19)) : '')
        }));
        return [enriched];
      }

      if (sqlLower.includes('from visits')) {
        return [[{ total_ops: 0, total_monto: 0, avg_monto: 0 }]];
      }

      return [[]];
    }
  };
}

async function runRecoveryTests() {
  console.log('======================================================================');
  console.log('SUITE TDD: MOTOR DE COHORTES Y EFECTIVIDAD DE COBROS RECURRENTES (B0.5)');
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

  // ---------------------------------------------------------------------------------
  // ESCENARIOS BASE (1-4): Ciclo de Vida y Reintentos
  // ---------------------------------------------------------------------------------
  console.log('--- ESCENARIO BASE 1: Primer pago exitoso al primer intento ---');
  {
    const mock = createMockPool({
      contracts: [{
        contract_id: '1780000000001',
        client_id: 'C001',
        cliente: 'Ana Lopez',
        plan: 'Plan Beauty',
        plan_id: 'P01',
        contract_price: 1950.00,
        signed_at: '2026-09-01 10:00:00',
        next_billing_date: '2026-11-01 10:00:00'
      }],
      payments: [
        { id: 'PAY-INIT-1780000000001', client_id: 'C001', amount: 1950, method: 'CardNet_Recurring_Setup', status: 'Aprobado', created_at: '2026-09-01 10:00:05' },
        { id: 'PAY-AUTO-1785000000000-0001', client_id: 'C001', amount: 1950, method: 'CardNet_Auto', status: 'Aprobado', created_at: '2026-10-01 10:00:00' }
      ]
    });

    const res = await handleBIReport(mock, {
      reportId: 'recurring_charges_result',
      startDate: '2026-10-01',
      endDate: '2026-10-31'
    });

    assert(res && res.kpis && res.kpis.length === 4, 'Base 1: Genera 4 KPIs');
    assert(res.kpis[0].value === '100.0%', 'Base 1: Tasa 1er intento es 100%');
    assert(res.table.rows.length === 1, 'Base 1: Detalle contiene 1 obligación');
    assert(res.table.rows[0].estado_corte === 'Pagada 1er intento', 'Base 1: Estado al corte es Pagada 1er intento');
  }

  console.log('\n--- ESCENARIO BASE 2: Recuperación al 2do intento ---');
  {
    const mock = createMockPool({
      contracts: [{ contract_id: '1780000000002', client_id: 'C002', contract_price: 1950, signed_at: '2026-09-01' }],
      payments: [
        { id: 'PAY-FAIL-1785000000001-0002', client_id: 'C002', amount: 1950, method: 'CardNet_Auto', status: 'Fallido - Intento 1', created_at: '2026-10-01 10:00:00' },
        { id: 'PAY-AUTO-1785000000002-0002', client_id: 'C002', amount: 1950, method: 'CardNet_Auto', status: 'Aprobado', created_at: '2026-10-02 10:00:00' }
      ]
    });

    const res = await handleBIReport(mock, {
      reportId: 'recurring_charges_result',
      startDate: '2026-10-01',
      endDate: '2026-10-31'
    });

    assert(res.table.rows.length === 1, 'Base 2: 1 obligación única');
    assert(res.table.rows[0].estado_corte === 'Recuperada reintentos', 'Base 2: Estado es Recuperada reintentos');
    assert(res.table.rows[0].reintentos === 2, 'Base 2: Total de reintentos es 2');
    assert(res.kpis[1].value === '100.0%', 'Base 2: Tasa de recuperación es 100%');
  }

  console.log('\n--- ESCENARIO BASE 3: Recuperación al 7mo intento ---');
  {
    const payments = [];
    for (let i = 1; i <= 6; i++) {
      payments.push({
        id: `PAY-FAIL-178500000000${i}-0003`,
        client_id: 'C003',
        amount: 1950,
        method: 'CardNet_Auto',
        status: `Fallido - Intento ${i}`,
        created_at: `2026-10-0${i} 10:00:00`
      });
    }
    payments.push({
      id: 'PAY-AUTO-1785000000007-0003',
      client_id: 'C003',
      amount: 1950,
      method: 'CardNet_Auto',
      status: 'Aprobado',
      created_at: '2026-10-07 10:00:00'
    });

    const mock = createMockPool({
      contracts: [{ contract_id: '1780000000003', client_id: 'C003', contract_price: 1950, signed_at: '2026-09-01' }],
      payments
    });

    const res = await handleBIReport(mock, {
      reportId: 'recurring_charges_result',
      startDate: '2026-10-01',
      endDate: '2026-10-31'
    });

    assert(res.table.rows.length === 1, 'Base 3: Representa exactamente 1 obligación no 7 cuotas');
    assert(res.table.rows[0].reintentos === 7, 'Base 3: Registra 7 intentos');
    assert(res.table.rows[0].estado_corte === 'Recuperada reintentos', 'Base 3: Recuperada en reintentos');
  }

  console.log('\n--- ESCENARIO BASE 4: 90 intentos de una sola cuota (Suspensión) ---');
  {
    const payments = [];
    for (let i = 1; i <= 90; i++) {
      payments.push({
        id: `PAY-FAIL-${i}-0004`,
        client_id: 'C004',
        amount: 1950,
        method: 'CardNet_Auto',
        status: `Fallido - Intento ${i}`,
        created_at: '2026-10-05 10:00:00'
      });
    }

    const mock = createMockPool({
      contracts: [{ contract_id: '1780000000004', client_id: 'C004', contract_price: 1950, signed_at: '2026-09-01' }],
      payments
    });

    const res = await handleBIReport(mock, {
      reportId: 'recurring_charges_result',
      startDate: '2026-10-01',
      endDate: '2026-10-31'
    });

    assert(res.table.rows.length === 1, 'Base 4: 90 transacciones mapean a 1 sola obligación');
    assert(res.table.rows[0].estado_corte === 'Sin recuperar', 'Base 4: Estado al corte es Sin recuperar');
    assert(res.kpis[2].value.includes('1,950'), 'Base 4: Saldo pendiente es RD$ 1,950');
  }

  // ---------------------------------------------------------------------------------
  // PASO 0 (B1) — AJUSTES DE REGLA DE 25 DÍAS, ADELANTOS Y REVERSOS
  // ---------------------------------------------------------------------------------
  console.log('\n--- PASO 0-1: Pago después de 25 días sin evidencia de nuevo ciclo ---');
  {
    const mock = createMockPool({
      contracts: [{ contract_id: '1780000000021', client_id: 'C021', contract_price: 1950, signed_at: '2026-09-01' }],
      payments: [
        { id: 'PAY-AUTO-1-0021', client_id: 'C021', amount: 1950, method: 'CardNet_Auto', status: 'Aprobado', created_at: '2026-10-01 10:00:00' },
        // Segundo pago aprobado 27 días después SIN evidencia estructurada de nuevo ciclo
        { id: 'PAY-MAN-2-0021', client_id: 'C021', amount: 1950, method: 'Efectivo/POS', status: 'Aprobado', description: 'Pago general en caja', created_at: '2026-10-28 11:00:00' }
      ]
    });

    const res = await handleBIReport(mock, { reportId: 'recurring_charges_result', startDate: '2026-10-01', endDate: '2026-10-31' });

    assert(res.table.rows.length === 1, 'Paso0-1: No crea 2da obligación artificial tras 27 días sin evidencia de ciclo');
    assert(res.unmatched_payments.length === 1, 'Paso0-1: Pago posterior conservado en conciliación');
    assert(res.unmatched_payments[0].reason.includes('sin evidencia estructurada de nuevo ciclo'), 'Paso0-1: Motivo indica falta de evidencia estructurada de ciclo');
  }

  console.log('\n--- PASO 0-2: Nueva cuota legítima con evidencia contractual ---');
  {
    const mock = createMockPool({
      contracts: [{ contract_id: '1780000000022', client_id: 'C022', contract_price: 1950, signed_at: '2026-09-01' }],
      payments: [
        { id: 'PAY-AUTO-1-0022', client_id: 'C022', amount: 1950, method: 'CardNet_Auto', status: 'Aprobado', created_at: '2026-10-01 10:00:00' },
        // Segundo pago con evidencia inequívoca de Ciclo 2 para el contrato #0022
        { id: 'PAY-MAN-2-0022', client_id: 'C022', amount: 1950, method: 'Efectivo/POS', status: 'Aprobado', description: 'Cuota Ciclo 2 Contrato #...-0022', created_at: '2026-10-28 11:00:00' }
      ]
    });

    const res = await handleBIReport(mock, { reportId: 'recurring_charges_result', startDate: '2026-10-01', endDate: '2026-10-31' });

    assert(res.table.rows.length === 2, 'Paso0-2: Reconoce legítimamente las 2 obligaciones contractuales');
    assert(res.table.rows.every(r => r.is_settled), 'Paso0-2: Ambas cuotas quedan liquidadas');
    assert(res.unmatched_payments.length === 0, 'Paso0-2: Cero pagos huérfanos');
  }

  console.log('\n--- PASO 0-3: Adelanto con ciclo identificado ---');
  {
    const mock = createMockPool({
      contracts: [{ contract_id: '1780000000023', client_id: 'C023', contract_price: 1950, signed_at: '2026-09-01' }],
      payments: [
        { id: 'PAY-AUTO-1-0023', client_id: 'C023', amount: 1950, method: 'CardNet_Auto', status: 'Aprobado', created_at: '2026-10-01 10:00:00' },
        // Adelanto con ciclo/período identificado (noviembre)
        { id: 'PAY-ADV-0023', client_id: 'C023', amount: 1950, method: 'Efectivo/POS', status: 'Aprobado', description: 'Adelanto mensualidad noviembre', created_at: '2026-10-05 12:00:00' }
      ]
    });

    const res = await handleBIReport(mock, { reportId: 'recurring_charges_result', startDate: '2026-10-01', endDate: '2026-10-31' });

    assert(res.table.rows.length === 2, 'Paso0-3: Registra ciclo corriente y ciclo adelantado identificado');
    assert(res.table.rows.some(r => r.cycle_number === 2), 'Paso0-3: Abre ciclo 2 adelantado');
    assert(res.unmatched_payments.length === 0, 'Paso0-3: Cero pagos no atribuidos');
  }

  console.log('\n--- PASO 0-4: Adelanto sin identificación suficiente ---');
  {
    const mock = createMockPool({
      contracts: [{ contract_id: '1780000000024', client_id: 'C024', contract_price: 1950, signed_at: '2026-09-01' }],
      payments: [
        { id: 'PAY-AUTO-1-0024', client_id: 'C024', amount: 1950, method: 'CardNet_Auto', status: 'Aprobado', created_at: '2026-10-01 10:00:00' },
        // Adelanto genérico sin identificar contrato ni ciclo
        { id: 'PAY-ADV-LOOSE-0024', client_id: 'C024', amount: 1950, method: 'Efectivo/POS', status: 'Aprobado', description: 'Adelanto', created_at: '2026-10-05 12:00:00' }
      ]
    });

    const res = await handleBIReport(mock, { reportId: 'recurring_charges_result', startDate: '2026-10-01', endDate: '2026-10-31' });

    assert(res.table.rows.length === 1, 'Paso0-4: No inventa ciclo con texto adelanto genérico');
    assert(res.unmatched_payments.length === 1, 'Paso0-4: Adelanto no identificado se conserva en conciliación');
    assert(res.unmatched_payments[0].reason.includes('sin identificación suficiente'), 'Paso0-4: Motivo documenta falta de identificación');
  }

  console.log('\n--- PASO 0-5: Contrato con reintentos durante 30, 60 y 90 días ---');
  {
    const mock = createMockPool({
      contracts: [{ contract_id: '1780000000025', client_id: 'C025', contract_price: 1950, signed_at: '2026-09-01' }],
      payments: [
        { id: 'PAY-FAIL-1-0025', client_id: 'C025', amount: 1950, method: 'CardNet_Auto', status: 'Fallido - Intento 1', created_at: '2026-10-01 10:00:00' },
        { id: 'PAY-FAIL-30-0025', client_id: 'C025', amount: 1950, method: 'CardNet_Auto', status: 'Fallido - Intento 30', created_at: '2026-10-30 10:00:00' },
        { id: 'PAY-FAIL-60-0025', client_id: 'C025', amount: 1950, method: 'CardNet_Auto', status: 'Fallido - Intento 60', created_at: '2026-11-30 10:00:00' },
        { id: 'PAY-FAIL-90-0025', client_id: 'C025', amount: 1950, method: 'CardNet_Auto', status: 'Fallido - Intento 90', created_at: '2026-12-30 10:00:00' }
      ]
    });

    const res = await handleBIReport(mock, { reportId: 'recurring_charges_result', startDate: '2026-10-01', endDate: '2026-10-31' });

    assert(res.table.rows.length === 1, 'Paso0-5: Reintentos durante 90 días representan 1 sola obligación');
    assert(res.table.rows[0].estado_corte === 'Sin recuperar', 'Paso0-5: Estado al corte de octubre es Sin recuperar');
    assert(res.table.rows[0].saldo_pendiente === 1950, 'Paso0-5: Saldo pendiente es RD$ 1,950');
  }

  console.log('\n--- PASO 0-6: Coherencia de fecha de corte frente a reversos posteriores ---');
  {
    const mock = createMockPool({
      contracts: [{ contract_id: '1780000000026', client_id: 'C026', contract_price: 1950, signed_at: '2026-09-01' }],
      payments: [
        // Pago aprobado el 25 de octubre (dentro del período evaluado)
        { id: 'PAY-OCT-0026', client_id: 'C026', amount: 1950, method: 'CardNet_Auto', status: 'Aprobado', gateway_ref: 'GW-NOV-REV', created_at: '2026-10-25 10:00:00' },
        // Reversión posterior ocurrida el 5 de noviembre (fuera del corte de octubre)
        { id: 'REV-NOV-0026', client_id: 'C026', amount: 1950, method: 'CardNet_Auto', status: 'Revertido', gateway_ref: 'GW-NOV-REV', description: 'Reverso PAY-OCT-0026', created_at: '2026-11-05 10:00:00' }
      ]
    });

    const res = await handleBIReport(mock, { reportId: 'recurring_charges_result', startDate: '2026-10-01', endDate: '2026-10-31' });

    assert(res.table.rows.length === 1, 'Paso0-6: 1 obligación');
    assert(res.table.rows[0].estado_corte === 'Pagada 1er intento', 'Paso0-6: Al corte de octubre el pago estaba vigente (Pagada 1er intento)');
    assert(res.table.rows[0].saldo_pendiente === 0, 'Paso0-6: Saldo pendiente al corte de octubre es 0');
    assert(res.table.rows[0].saldo_pendiente_actual === 1950, 'Paso0-6: Saldo actual refleja la deuda insoluta tras el reverso');
    assert(res.table.rows[0].estado_actual === 'Sin recuperar', 'Paso0-6: Estado actual refleja Sin recuperar debido al reverso posterior');
    assert(res.table.rows[0].has_posterior_reversal === true, 'Paso0-6: Bandera de reverso posterior activa');
  }

  // ---------------------------------------------------------------------------------
  // 11 ESCENARIOS OBLIGATORIOS AUTORIZADOS B0.5
  // ---------------------------------------------------------------------------------
  console.log('\n--- B0.5 - ESCENARIO 1: Segundo pago aprobado después de 10 días ---');
  {
    const mock = createMockPool({
      contracts: [{ contract_id: '1780000000010', client_id: 'C010', contract_price: 1950, signed_at: '2026-09-01' }],
      payments: [
        { id: 'PAY-AUTO-1785000000001-0010', client_id: 'C010', amount: 1950, method: 'CardNet_Auto', status: 'Aprobado', created_at: '2026-10-01 10:00:00' },
        // Segundo cobro aprobado 10 días después sin evidencia de nuevo ciclo (< 25 días, sin "Ciclo 2" ni "Adelanto")
        { id: 'PAY-AUTO-1785000000011-0010', client_id: 'C010', amount: 1950, method: 'CardNet_Auto', status: 'Aprobado', created_at: '2026-10-11 10:00:00' }
      ]
    });

    const res = await handleBIReport(mock, { reportId: 'recurring_charges_result', startDate: '2026-10-01', endDate: '2026-10-31' });

    assert(res.table.rows.length === 1, 'B0.5-1: No crea 2da obligación artificial sin evidencia de ciclo');
    assert(res.unmatched_payments.length === 1, 'B0.5-1: Segundo pago enviado a conciliación');
    assert(res.reconciliation.total_unmatched_approved_payments === 1, 'B0.5-1: 1 cobro aprobado en conciliación');
    assert(res.reconciliation.unmatched_approved_amount === 1950, 'B0.5-1: Monto sin atribuir es RD$ 1,950');
  }

  console.log('\n--- B0.5 - ESCENARIO 2: Nueva obligación legítima dentro de 20 días ---');
  {
    const mock = createMockPool({
      contracts: [{ contract_id: '1780000000020', client_id: 'C020', contract_price: 1950, signed_at: '2026-09-01' }],
      payments: [
        { id: 'PAY-MANUAL-1-0020', client_id: 'C020', amount: 1950, method: 'Efectivo/POS', status: 'Aprobado', description: 'Cuota mensualidad Ciclo 1', created_at: '2026-10-01 10:00:00' },
        // Segundo pago aprobado 14 días después con evidencia explícita de Ciclo 2
        { id: 'PAY-MANUAL-2-0020', client_id: 'C020', amount: 1950, method: 'Efectivo/POS', status: 'Aprobado', description: 'Pago cuota mensualidad Ciclo 2', created_at: '2026-10-15 10:00:00' }
      ]
    });

    const res = await handleBIReport(mock, { reportId: 'recurring_charges_result', startDate: '2026-10-01', endDate: '2026-10-31' });

    assert(res.table.rows.length === 2, 'B0.5-2: Reconoce 2 obligaciones legítimas dentro de 20 días');
    assert(res.table.rows.every(r => r.is_settled), 'B0.5-2: Ambas cuotas quedan liquidadas');
    assert(res.unmatched_payments.length === 0, 'B0.5-2: Cero pagos huérfanos');
  }

  console.log('\n--- B0.5 - ESCENARIO 3: Pago adelantado ---');
  {
    const mock = createMockPool({
      contracts: [{ contract_id: '1780000000030', client_id: 'C030', contract_price: 1950, signed_at: '2026-09-01' }],
      payments: [
        { id: 'PAY-AUTO-1785000000001-0030', client_id: 'C030', amount: 1950, method: 'CardNet_Auto', status: 'Aprobado', created_at: '2026-10-01 10:00:00' },
        // Pago adelantado explícito
        { id: 'PAY-MANUAL-ADV-0030', client_id: 'C030', amount: 1950, method: 'Efectivo/POS', status: 'Aprobado', description: 'Adelanto mensualidad noviembre', created_at: '2026-10-05 12:00:00' }
      ]
    });

    const res = await handleBIReport(mock, { reportId: 'recurring_charges_result', startDate: '2026-10-01', endDate: '2026-10-31' });

    assert(res.table.rows.length === 2, 'B0.5-3: Registra cuota regular y cuota adelantada');
    assert(res.table.rows.some(r => r.cycle_number === 2), 'B0.5-3: Adelanto abre ciclo 2');
    assert(res.unmatched_payments.length === 0, 'B0.5-3: Cero pagos no atribuidos');
  }

  console.log('\n--- B0.5 - ESCENARIO 4: Venta POS ajena a membresía de cliente con contrato único ---');
  {
    const mock = createMockPool({
      contracts: [{ contract_id: '1780000000040', client_id: 'C040', contract_price: 1950, signed_at: '2026-09-01' }],
      payments: [
        // Compra de producto ajena a la membresía
        { id: 'PAY-RETAIL-0040', client_id: 'C040', amount: 450, method: 'Efectivo/POS', status: 'Aprobado', description: 'Venta POS: Shampoo hidratante argan', created_at: '2026-10-05 15:00:00' }
      ]
    });

    const res = await handleBIReport(mock, { reportId: 'recurring_charges_result', startDate: '2026-10-01', endDate: '2026-10-31' });

    assert(res.table.rows.length === 0, 'B0.5-4: No crea obligación contractual');
    assert(res.unmatched_payments.length === 1, 'B0.5-4: Enviada a conciliación como no membresía');
    assert(res.unmatched_payments[0].reason.includes('ajena a membresía'), 'B0.5-4: Motivo indica concepto ajeno a membresía');
  }

  console.log('\n--- B0.5 - ESCENARIO 5: Mensualidad manual legítima sin referencia contractual explícita ---');
  {
    const mock = createMockPool({
      contracts: [{ contract_id: '1780000000050', client_id: 'C050', contract_price: 1950, signed_at: '2026-09-01' }],
      payments: [
        // Pago manual en salón con importe exacto y descripción de mensualidad pero sin ID de contrato
        { id: 'PAY-POS-MANUAL-0050', client_id: 'C050', amount: 1950, method: 'Efectivo/POS', status: 'Aprobado', description: 'Pago Mensualidad Plan Beauty socia', created_at: '2026-10-05 12:00:00' }
      ]
    });

    const res = await handleBIReport(mock, { reportId: 'recurring_charges_result', startDate: '2026-10-01', endDate: '2026-10-31' });

    assert(res.table.rows.length === 1, 'B0.5-5: Asocia legítimamente a la cuota mensual');
    assert(res.table.rows[0].is_settled === true, 'B0.5-5: Obligación queda liquidada');
    assert(res.unmatched_payments.length === 0, 'B0.5-5: No queda en conciliación');
  }

  console.log('\n--- B0.5 - ESCENARIO 6: Pago parcial de RD$1,000 sobre cuota RD$1,950 ---');
  {
    const mock = createMockPool({
      contracts: [{ contract_id: '1780000000060', client_id: 'C060', contract_price: 1950, signed_at: '2026-09-01' }],
      payments: [
        { id: 'PAY-FAIL-1785000000001-0060', client_id: 'C060', amount: 1950, method: 'CardNet_Auto', status: 'Fallido - Intento 1', created_at: '2026-10-01 10:00:00' },
        { id: 'PAY-PARTIAL-0060', client_id: 'C060', amount: 1000, method: 'Efectivo/POS', status: 'Aprobado', description: 'Abono parcial mensualidad', created_at: '2026-10-05 14:00:00' }
      ]
    });

    const res = await handleBIReport(mock, { reportId: 'recurring_charges_result', startDate: '2026-10-01', endDate: '2026-10-31' });

    assert(res.table.rows.length === 1, 'B0.5-6: 1 obligación');
    assert(res.table.rows[0].cuota === 1950, 'B0.5-6: Cuota contractual es RD$ 1,950');
    assert(res.table.rows[0].amount_paid === 1000, 'B0.5-6: Importe pagado registrado es RD$ 1,000');
    assert(res.table.rows[0].saldo_pendiente === 950, 'B0.5-6: Saldo pendiente neto es RD$ 950');
    assert(res.table.rows[0].estado_corte === 'Pendiente parcial', 'B0.5-6: Estado al corte es Pendiente parcial');
    assert(res.kpis[2].value.includes('950'), 'B0.5-6: KPI saldo pendiente suma exactamente RD$ 950 (no el total)');
    assert(res.summary.pending_confirmed_amount === 950, 'B0.5-6: Saldo insoluto confirmado es RD$ 950');
  }

  console.log('\n--- B0.5 - ESCENARIO 7: Varios abonos que completan una cuota ---');
  {
    const mock = createMockPool({
      contracts: [{ contract_id: '1780000000070', client_id: 'C070', contract_price: 1950, signed_at: '2026-09-01' }],
      payments: [
        { id: 'PAY-FAIL-1785000000001-0070', client_id: 'C070', amount: 1950, method: 'CardNet_Auto', status: 'Fallido - Intento 1', created_at: '2026-10-01 10:00:00' },
        { id: 'PAY-ABONO-1-0070', client_id: 'C070', amount: 1000, method: 'Efectivo/POS', status: 'Aprobado', description: 'Abono 1 cuota', created_at: '2026-10-05 10:00:00' },
        { id: 'PAY-ABONO-2-0070', client_id: 'C070', amount: 950, method: 'Efectivo/POS', status: 'Aprobado', description: 'Abono 2 liquidación final', created_at: '2026-10-10 12:00:00' }
      ]
    });

    const res = await handleBIReport(mock, { reportId: 'recurring_charges_result', startDate: '2026-10-01', endDate: '2026-10-31' });

    assert(res.table.rows.length === 1, 'B0.5-7: 1 obligación única');
    assert(res.table.rows[0].amount_paid === 1950, 'B0.5-7: Suma total de abonos es RD$ 1,950');
    assert(res.table.rows[0].saldo_pendiente === 0, 'B0.5-7: Saldo pendiente es 0');
    assert(res.table.rows[0].is_settled === true, 'B0.5-7: Obligación liquidada');
    assert(res.table.rows[0].estado_corte === 'Recuperada otra vía', 'B0.5-7: Estado es Recuperada otra vía');
    assert(res.kpis[2].value.includes('0'), 'B0.5-7: Saldo pendiente en KPI es RD$ 0');
  }

  console.log('\n--- B0.5 - ESCENARIO 8: Reverso posterior de un pago aprobado ---');
  {
    const mock = createMockPool({
      contracts: [{ contract_id: '1780000000080', client_id: 'C080', contract_price: 1950, signed_at: '2026-09-01' }],
      payments: [
        { id: 'PAY-FAIL-1785000000001-0080', client_id: 'C080', amount: 1950, method: 'CardNet_Auto', status: 'Fallido - Intento 1', created_at: '2026-10-01 10:00:00' },
        // Cobro aprobado
        { id: 'PAY-AUTO-1785000000002-0080', client_id: 'C080', amount: 1950, method: 'CardNet_Auto', status: 'Aprobado', gateway_ref: 'GW-REV-0080', created_at: '2026-10-03 10:00:00' },
        // Reverso posterior con referencia inequívoca
        { id: 'PAY-REV-0080', client_id: 'C080', amount: 1950, method: 'CardNet_Auto', status: 'Revertido', gateway_ref: 'GW-REV-0080', description: 'Reverso de pago PAY-AUTO-1785000000002-0080', created_at: '2026-10-05 11:00:00' }
      ]
    });

    const res = await handleBIReport(mock, { reportId: 'recurring_charges_result', startDate: '2026-10-01', endDate: '2026-10-31' });

    assert(res.table.rows.length === 1, 'B0.5-8: 1 obligación');
    assert(res.table.rows[0].estado_corte === 'Sin recuperar', 'B0.5-8: El pago revertido NO liquida la obligación');
    assert(res.table.rows[0].amount_paid === 0, 'B0.5-8: Monto cobrado neto es 0');
    assert(res.table.rows[0].saldo_pendiente === 1950, 'B0.5-8: Saldo pendiente permanece en RD$ 1,950');
    assert(res.summary.total_approved_payments === 0, 'B0.5-8: El pago revertido no se cuenta como aprobado');
  }

  console.log('\n--- B0.5 - ESCENARIO 9: Reversión sin referencia inequívoca ---');
  {
    const mock = createMockPool({
      contracts: [{ contract_id: '1780000000090', client_id: 'C090', contract_price: 1950, signed_at: '2026-09-01' }],
      payments: [
        { id: 'PAY-FAIL-1785000000001-0090', client_id: 'C090', amount: 1950, method: 'CardNet_Auto', status: 'Fallido - Intento 1', created_at: '2026-10-01 10:00:00' },
        // Reversión huérfana sin referencia a pago aprobado existente
        { id: 'PAY-REV-ORPHAN-0090', client_id: 'C090', amount: 1950, method: 'CardNet_Auto', status: 'Revertido', gateway_ref: 'GW-UNKNOWN-999', description: 'Reverso huérfano sin trazabilidad', created_at: '2026-10-05 12:00:00' }
      ]
    });

    const res = await handleBIReport(mock, { reportId: 'recurring_charges_result', startDate: '2026-10-01', endDate: '2026-10-31' });

    assert(res.table.rows.length === 1, 'B0.5-9: 1 obligación');
    assert(res.table.rows[0].estado_corte === 'Requiere revisión', 'B0.5-9: Reversión sin trazabilidad pasa a Requiere revisión');
    assert(res.summary.review_amount === 1950, 'B0.5-9: Monto pasa a saldo en revisión');
  }

  console.log('\n--- B0.5 - ESCENARIO 10: Regresión de RF-07 (Renovaciones anuales) ---');
  {
    const mock = createMockPool({
      contracts: [{
        contract_id: '1780000000999',
        client_id: 'C999',
        cliente: 'Maria Gomez',
        plan: 'Plan Beauty',
        plan_id: 'P01',
        contract_price: 1950,
        signed_at: '2026-05-15 10:00:00',
        next_billing_date: '2027-05-15 10:00:00',
        estado_contrato: 'Active'
      }],
      payments: []
    });

    const resRF07 = await handleBIReport(mock, { reportId: 'contracts_upcoming_renewal', startDate: '2027-05-01', endDate: '2027-05-31' });
    assert(resRF07 && resRF07.kpis && resRF07.kpis.length === 4, 'B0.5-10: RF-07 genera sus 4 KPIs intactos');
    assert(resRF07.title.toLowerCase().includes('renovación anual'), 'B0.5-10: Título RF-07 preservado');
  }

  console.log('\n--- B0.5 - ESCENARIO 11: Conciliación de eventos, obligaciones, pagos y saldos ---');
  {
    const contracts = [];
    const payments = [];

    // 33 pagadas 1er intento
    for (let i = 1; i <= 33; i++) {
      const cid = `C1_${i.toString().padStart(3, '0')}`;
      const ctid = `1780000001${i.toString().padStart(3, '0')}`;
      contracts.push({ contract_id: ctid, client_id: cid, contract_price: 1950, signed_at: '2026-09-01' });
      payments.push({ id: `PAY-AUTO-1785000000000-${ctid.slice(-4)}`, client_id: cid, amount: 1950, method: 'CardNet_Auto', status: 'Aprobado', created_at: '2026-10-05 17:00:00' });
    }

    // 10 recuperadas por CardNet (con 1 intento fallido previo)
    for (let i = 1; i <= 10; i++) {
      const cid = `C2_${i.toString().padStart(3, '0')}`;
      const ctid = `1780000002${i.toString().padStart(3, '0')}`;
      contracts.push({ contract_id: ctid, client_id: cid, contract_price: 1950, signed_at: '2026-09-01' });
      payments.push({ id: `PAY-FAIL-1785000000001-${ctid.slice(-4)}`, client_id: cid, amount: 1950, method: 'CardNet_Auto', status: 'Fallido - Intento 1', created_at: '2026-10-05 17:00:00' });
      payments.push({ id: `PAY-AUTO-1785000000002-${ctid.slice(-4)}`, client_id: cid, amount: 1950, method: 'CardNet_Auto', status: 'Aprobado', created_at: '2026-10-07 17:00:00' });
    }

    // 1 recuperada por otra vía
    {
      const ctid = '1780000003001';
      contracts.push({ contract_id: ctid, client_id: 'C3_001', contract_price: 1950, signed_at: '2026-09-01' });
      payments.push({ id: `PAY-FAIL-1785000000001-${ctid.slice(-4)}`, client_id: 'C3_001', amount: 1950, method: 'CardNet_Auto', status: 'Fallido - Intento 1', created_at: '2026-10-05 17:00:00' });
      payments.push({ id: `PAY-MANUAL-1785000000002`, client_id: 'C3_001', amount: 1950, method: 'Efectivo/POS', status: 'Aprobado', created_at: '2026-10-08 12:00:00' });
    }

    // 5 sin recuperar
    for (let i = 1; i <= 5; i++) {
      const cid = `C4_${i.toString().padStart(3, '0')}`;
      const ctid = `1780000004${i.toString().padStart(3, '0')}`;
      contracts.push({ contract_id: ctid, client_id: cid, contract_price: 1950, signed_at: '2026-09-01' });
      payments.push({ id: `PAY-FAIL-1785000000001-${ctid.slice(-4)}`, client_id: cid, amount: 1950, method: 'CardNet_Auto', status: 'Fallido - Intento 1', created_at: '2026-10-05 17:00:00' });
    }

    // 2 pagos manuales aprobados de clienta multi-contrato sin referencia
    {
      const ctidA = '1780000005001';
      const ctidB = '1780000005002';
      contracts.push({ contract_id: ctidA, client_id: 'C5_MULTI', contract_price: 1950, signed_at: '2026-09-01' });
      contracts.push({ contract_id: ctidB, client_id: 'C5_MULTI', contract_price: 1950, signed_at: '2026-09-15' });
      payments.push({ id: 'PAY-MAN-1791381136144', client_id: 'C5_MULTI', amount: 1950, method: 'Tarjeta_Guardada', status: 'Aprobado', created_at: '2026-10-07 13:52:16' });
      payments.push({ id: 'PAY-MANUAL-1791667800383', client_id: 'C5_MULTI', amount: 1950, method: 'Efectivo/POS', status: 'Aprobado', created_at: '2026-10-10 21:30:00' });
    }

    const mock = createMockPool({ contracts, payments });
    const res = await handleBIReport(mock, { reportId: 'recurring_charges_result', startDate: '2026-10-01', endDate: '2026-10-31' });

    assert(res.reconciliation.total_payments_records === 62, 'B0.5-11: 62 transacciones físicas en payments');
    assert(res.reconciliation.total_reconstructed_obligations === 49, 'B0.5-11: 49 obligaciones reconstruidas');
    assert(res.reconciliation.total_settled_obligations === 44, 'B0.5-11: 44 obligaciones liquidadas');
    assert(res.reconciliation.total_pending_obligations === 5, 'B0.5-11: 5 obligaciones pendientes');
    assert(res.reconciliation.pending_confirmed_debt === 9750, 'B0.5-11: Saldo insoluto confirmado es RD$ 9,750');
    assert(res.reconciliation.total_unmatched_approved_payments === 2, 'B0.5-11: 2 pagos aprobados sin atribución');
    assert(res.reconciliation.unmatched_approved_amount === 3900, 'B0.5-11: RD$ 3,900 cobrados sin atribución');
    assert(res.kpis[0].value === '67.3%', 'B0.5-11: Éxito 1er intento es 67.3%');
    assert(res.kpis[1].value === '68.8%', 'B0.5-11: Recuperación es 68.8%');
    assert(res.kpis[2].value.includes('9,750'), 'B0.5-11: KPI Importe pendiente es RD$ 9,750');
  }

  console.log('\n======================================================================');
  console.log(`RESUMEN DE PRUEBAS TDD: ${passed} PASARON, ${failed} FALLARON`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runRecoveryTests();
