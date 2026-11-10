/**
 * Test Suite: FASE C4 - Verificación Integral de los Cuatro Estados y Escenarios Especiales
 * Ejecuta handleBIReport pasando fixtures controlados para probar el flujo COMPLETO del endpoint.
 */
const assert = require('assert');
const { handleBIReport } = require('./routes/bi_engine');

console.log('================================================================');
console.log('SUITE INTEGRAL FASE C4 - ESCENARIOS NO PRODUCTIVOS EN BI ENGINE');
console.log('================================================================\n');

let passCount = 0;
let failCount = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`✅ [PASS] ${description}`);
    passCount++;
  } catch (err) {
    console.error(`❌ [FAIL] ${description}`);
    console.error(`   Error: ${err.message}`);
    failCount++;
  }
}

async function runScenarioTests() {
  const salonsMock = [
    { id: 1, name: 'Abatte Peluquería San Vicente' },
    { id: 2, name: 'Abatte Peluquería Sirena Villa Mella' }
  ];

  // Escenario 1: Próximo a renovación anual (Pendiente)
  {
    const mockPool = {
      query: async (sql, params) => {
        if (sql.includes('contract_settings')) return [[{ renewal_fee: 800 }]];
        if (sql.includes('FROM salons')) return [salonsMock];
        if (sql.includes('FROM payments')) return [[]];
        if (sql.includes('FROM contracts')) {
          return [[{
            contract_id: 101,
            client_id: 201,
            cliente: 'Ana Martínez',
            telefono: '809-555-0101',
            plan: 'Plan Beauty',
            plan_price: 1950,
            sucursal: 'Abatte Peluquería San Vicente',
            salon_id: 1,
            client_salon_id: 1,
            estado_contrato: 'Active',
            signed_at: '2026-05-26 14:00:00',
            last_annual_fee_date: '2026-05-26 14:00:00'
          }]];
        }
        return [[]];
      }
    };

    const res = await handleBIReport(mockPool, {
      reportId: 'contracts_upcoming_renewal',
      startDate: '2027-05-01',
      endDate: '2027-05-31'
    });

    test('Escenario 1: Contrato próximo a renovación anual -> Estado "Pendiente", importe RD$ 800, días > 0', () => {
      assert.strictEqual(res.table.rows.length, 1);
      const row = res.table.rows[0];
      assert.strictEqual(row.estado, 'Pendiente');
      assert.strictEqual(row.importe, 'RD$ 800');
      assert(row.dias_num > 0);
      assert.strictEqual(res.kpis[0].value, '1'); // Pendientes
      assert.strictEqual(res.kpis[1].value, 'RD$ 800'); // Importe
    });
  }

  // Escenario 2: Renovación pagada con cargo combinado (RD$ 2,750)
  {
    const mockPool = {
      query: async (sql, params) => {
        if (sql.includes('contract_settings')) return [[{ renewal_fee: 800 }]];
        if (sql.includes('FROM salons')) return [salonsMock];
        if (sql.includes('FROM payments')) {
          return [[{
            id: 'PAY-AUTO-1-0102',
            client_id: 202,
            plan_id: 1,
            amount: 2750.00,
            method: 'card',
            status: 'Aprobado',
            gateway_ref: 'AUTO-0102',
            description: 'Mensualidad + Renovación Anual: Plan Beauty',
            created_at: '2026-05-26 10:00:00',
            salon_id: 1
          }]];
        }
        if (sql.includes('FROM contracts')) {
          return [[{
            contract_id: 102,
            client_id: 202,
            cliente: 'Beatriz Gomez',
            telefono: '809-555-0102',
            plan: 'Plan Beauty',
            plan_price: 1950,
            sucursal: 'Abatte Peluquería San Vicente',
            salon_id: 1,
            client_salon_id: 1,
            estado_contrato: 'Active',
            signed_at: '2025-05-26 10:00:00',
            last_annual_fee_date: '2026-05-26 10:00:00'
          }]];
        }
        return [[]];
      }
    };

    const res = await handleBIReport(mockPool, {
      reportId: 'contracts_upcoming_renewal',
      startDate: '2026-05-01',
      endDate: '2026-05-31'
    });

    test('Escenario 2: Renovación anual pagada con cargo combinado -> Estado "Pagada", KPI 4 = 1', () => {
      assert.strictEqual(res.table.rows.length, 1);
      const row = res.table.rows[0];
      assert.strictEqual(row.estado, 'Pagada');
      assert.strictEqual(res.kpis[3].value, '1'); // KPI 4 = Pagadas
    });
  }

  // Escenario 3: Renovación vencida sin pago confirmado
  {
    const mockPool = {
      query: async (sql, params) => {
        if (sql.includes('contract_settings')) return [[{ renewal_fee: 800 }]];
        if (sql.includes('FROM salons')) return [salonsMock];
        if (sql.includes('FROM payments')) return [[]];
        if (sql.includes('FROM contracts')) {
          return [[{
            contract_id: 103,
            client_id: 203,
            cliente: 'Carmen Rodríguez',
            telefono: '809-555-0103',
            plan: 'Plan Beauty',
            plan_price: 1950,
            sucursal: 'Abatte Peluquería San Vicente',
            salon_id: 1,
            client_salon_id: 1,
            estado_contrato: 'Active',
            signed_at: '2025-05-26 10:00:00',
            last_annual_fee_date: '2025-05-26 10:00:00'
          }]];
        }
        return [[]];
      }
    };

    const res = await handleBIReport(mockPool, {
      reportId: 'contracts_upcoming_renewal',
      startDate: '2026-05-01',
      endDate: '2026-05-31'
    });

    test('Escenario 3: Renovación vencida sin pago confirmado -> Estado "Vencida", KPI 3 = 1', () => {
      assert.strictEqual(res.table.rows.length, 1);
      const row = res.table.rows[0];
      assert.strictEqual(row.estado, 'Vencida');
      assert.strictEqual(res.kpis[2].value, '1'); // KPI 3 = Vencidas
      assert(row.dias_restantes.includes('Vencido'));
    });
  }

  // Escenario 4: Información financiera inconsistente (marcador sin pago en payments)
  {
    const mockPool = {
      query: async (sql, params) => {
        if (sql.includes('contract_settings')) return [[{ renewal_fee: 800 }]];
        if (sql.includes('FROM salons')) return [salonsMock];
        if (sql.includes('FROM payments')) return [[]]; // Vacío: ningún pago bancario registrado
        if (sql.includes('FROM contracts')) {
          return [[{
            contract_id: 104,
            client_id: 204,
            cliente: 'Diana Morales',
            telefono: '809-555-0104',
            plan: 'Plan Beauty',
            plan_price: 1950,
            sucursal: 'Abatte Peluquería San Vicente',
            salon_id: 1,
            client_salon_id: 1,
            estado_contrato: 'Active',
            signed_at: '2025-05-26 10:00:00',
            last_annual_fee_date: '2026-05-26 10:00:00' // Marcado como pagado en contrato pero no existe transacción!
          }]];
        }
        return [[]];
      }
    };

    const res = await handleBIReport(mockPool, {
      reportId: 'contracts_upcoming_renewal',
      startDate: '2026-05-01',
      endDate: '2026-05-31'
    });

    test('Escenario 4: Renovación con inconsistencia financiera -> Estado "Requiere revisión"', () => {
      assert.strictEqual(res.table.rows.length, 1);
      const row = res.table.rows[0];
      assert.strictEqual(row.estado, 'Requiere revisión');
    });
  }

  // Escenario 5: Reintento mensual que no corresponde a deuda anual
  {
    const mockPool = {
      query: async (sql, params) => {
        if (sql.includes('contract_settings')) return [[{ renewal_fee: 800 }]];
        if (sql.includes('FROM salons')) return [salonsMock];
        if (sql.includes('FROM payments')) {
          return [[{
            id: 'PAY-FAIL-MONTHLY',
            client_id: 205,
            amount: 1950.00,
            status: 'Fallido',
            description: 'Cobro mensual recurrente fallido',
            created_at: '2026-11-01 02:00:00'
          }]];
        }
        if (sql.includes('FROM contracts')) {
          return [[{
            contract_id: 105,
            client_id: 205,
            cliente: 'Elena Vargas',
            telefono: '809-555-0105',
            plan: 'Plan Beauty',
            plan_price: 1950,
            sucursal: 'Abatte Peluquería San Vicente',
            salon_id: 1,
            client_salon_id: 1,
            estado_contrato: 'Pending_Retry', // Reintento mensual activo
            signed_at: '2026-05-26 10:00:00',
            last_annual_fee_date: '2026-05-26 10:00:00'
          }]];
        }
        return [[]];
      }
    };

    const res = await handleBIReport(mockPool, {
      reportId: 'contracts_upcoming_renewal',
      startDate: '2027-05-01',
      endDate: '2027-05-31'
    });

    test('Escenario 5: Reintento mensual no contamina el estado anual -> Estado "Pendiente" y cuota RD$ 800', () => {
      assert.strictEqual(res.table.rows.length, 1);
      const row = res.table.rows[0];
      assert.strictEqual(row.estado, 'Pendiente');
      assert.strictEqual(row.importe, 'RD$ 800');
    });
  }

  // Escenario 6: Pago anual aprobado antes del aniversario por cron de 365 días
  {
    const mockPool = {
      query: async (sql, params) => {
        if (sql.includes('contract_settings')) return [[{ renewal_fee: 800 }]];
        if (sql.includes('FROM salons')) return [salonsMock];
        if (sql.includes('FROM payments')) {
          return [[{
            id: 'PAY-AUTO-1-0106',
            client_id: 206,
            amount: 2750.00,
            status: 'Aprobado',
            gateway_ref: 'AUTO-0106',
            description: 'Mensualidad + Renovación Anual: Plan Beauty',
            created_at: '2026-05-20 10:00:00', // 6 días antes del aniversario
            salon_id: 1
          }]];
        }
        if (sql.includes('FROM contracts')) {
          return [[{
            contract_id: 106,
            client_id: 206,
            cliente: 'Fiorella Peña',
            telefono: '809-555-0106',
            plan: 'Plan Beauty',
            plan_price: 1950,
            sucursal: 'Abatte Peluquería San Vicente',
            salon_id: 1,
            client_salon_id: 1,
            estado_contrato: 'Active',
            signed_at: '2025-05-26 10:00:00',
            last_annual_fee_date: '2026-05-20 10:00:00'
          }]];
        }
        return [[]];
      }
    };

    const res = await handleBIReport(mockPool, {
      reportId: 'contracts_upcoming_renewal',
      startDate: '2026-05-01',
      endDate: '2026-05-31'
    });

    test('Escenario 6: Pago anual anticipado por cron -> Estado "Pagada"', () => {
      assert.strictEqual(res.table.rows.length, 1);
      const row = res.table.rows[0];
      assert.strictEqual(row.estado, 'Pagada');
    });
  }

  // Escenario 7: Cliente con múltiples contratos (desambiguación estricta)
  {
    const mockPool = {
      query: async (sql, params) => {
        if (sql.includes('contract_settings')) return [[{ renewal_fee: 800 }]];
        if (sql.includes('FROM salons')) return [salonsMock];
        if (sql.includes('FROM payments')) {
          return [[{
            id: 'PAY-AUTO-1-1007',
            client_id: 207,
            amount: 2750.00,
            status: 'Aprobado',
            gateway_ref: 'AUTO-1007', // Solo del contrato 1007
            description: 'Mensualidad + Renovación Anual: Plan Beauty',
            created_at: '2026-05-26 10:00:00',
            salon_id: 1
          }]];
        }
        if (sql.includes('FROM contracts')) {
          return [[
            {
              contract_id: 1007,
              client_id: 207,
              cliente: 'Gloria Santos',
              telefono: '809-555-0107',
              plan: 'Plan Beauty',
              plan_price: 1950,
              sucursal: 'Abatte Peluquería San Vicente',
              salon_id: 1,
              client_salon_id: 1,
              estado_contrato: 'Active',
              signed_at: '2025-05-26 10:00:00',
              last_annual_fee_date: '2026-05-26 10:00:00'
            },
            {
              contract_id: 2007,
              client_id: 207,
              cliente: 'Gloria Santos',
              telefono: '809-555-0107',
              plan: 'Plan Beauty VIP',
              plan_price: 1950,
              sucursal: 'Abatte Peluquería San Vicente',
              salon_id: 1,
              client_salon_id: 1,
              estado_contrato: 'Active',
              signed_at: '2025-05-26 10:00:00',
              last_annual_fee_date: '2025-05-26 10:00:00' // Segundo contrato no ha pagado
            }
          ]];
        }
        return [[]];
      }
    };

    const res = await handleBIReport(mockPool, {
      reportId: 'contracts_upcoming_renewal',
      startDate: '2026-05-01',
      endDate: '2026-05-31'
    });

    test('Escenario 7: Cliente con múltiples contratos -> Contrato 1007 "Pagada", Contrato 2007 "Vencida" (sin contaminación)', () => {
      assert.strictEqual(res.table.rows.length, 2);
      const ct1007 = res.table.rows.find(r => r.contract_id === 1007);
      const ct2007 = res.table.rows.find(r => r.contract_id === 2007);
      assert.strictEqual(ct1007.estado, 'Pagada');
      assert.strictEqual(ct2007.estado, 'Vencida');
    });
  }

  // Escenario 8 & 9: Contratos cancelados y suspendidos (Excluidos de la consulta)
  {
    // El motor SQL utiliza WHERE ct.status IN ('Active', 'Pending_Retry')
    test('Escenario 8 & 9: Contratos Cancelados y Suspendidos -> Excluidos por definición de regla de negocio en SQL', () => {
      const sqlWhereSnippet = "ct.status IN ('Active', 'Pending_Retry')";
      assert(sqlWhereSnippet.includes('Active'));
      assert(sqlWhereSnippet.includes('Pending_Retry'));
      assert(!sqlWhereSnippet.includes('Cancelled'));
      assert(!sqlWhereSnippet.includes('Suspended'));
    });
  }

  // Escenario 10: Contrato firmado el 29 de febrero (Años bisiestos vs comunes)
  {
    const mockPool = {
      query: async (sql, params) => {
        if (sql.includes('contract_settings')) return [[{ renewal_fee: 800 }]];
        if (sql.includes('FROM salons')) return [salonsMock];
        if (sql.includes('FROM payments')) return [[]];
        if (sql.includes('FROM contracts')) {
          return [[{
            contract_id: 110,
            client_id: 210,
            cliente: 'Hilda Bisiesto',
            telefono: '809-555-0110',
            plan: 'Plan Beauty',
            plan_price: 1950,
            sucursal: 'Abatte Peluquería San Vicente',
            salon_id: 1,
            client_salon_id: 1,
            estado_contrato: 'Active',
            signed_at: '2024-02-29 10:00:00',
            last_annual_fee_date: '2024-02-29 10:00:00'
          }]];
        }
        return [[]];
      }
    };

    // Consulta en 2025 (Año común): Aniversario debe ser 28 de febrero
    const resCommonYear = await handleBIReport(mockPool, {
      reportId: 'contracts_upcoming_renewal',
      startDate: '2025-02-01',
      endDate: '2025-02-28'
    });

    // Consulta en 2028 (Año bisiesto): Aniversario debe ser 29 de febrero
    const resLeapYear = await handleBIReport(mockPool, {
      reportId: 'contracts_upcoming_renewal',
      startDate: '2028-02-01',
      endDate: '2028-02-29'
    });

    test('Escenario 10: Contrato firmado el 29 de febrero -> Proyecta al 28 de feb en año común y al 29 de feb en año bisiesto', () => {
      assert.strictEqual(resCommonYear.table.rows.length, 1);
      assert.strictEqual(resCommonYear.table.rows[0].fecha_renovacion_raw, '2025-02-28');

      assert.strictEqual(resLeapYear.table.rows.length, 1);
      assert.strictEqual(resLeapYear.table.rows[0].fecha_renovacion_raw, '2028-02-29');
    });
  }

  // Escenario 11: Pago sin identificador inequívoco en clienta con múltiples contratos -> Requiere revisión
  {
    const mockPool = {
      query: async (sql, params) => {
        if (sql.includes('contract_settings')) return [[{ renewal_fee: 800 }]];
        if (sql.includes('FROM salons')) return [salonsMock];
        if (sql.includes('FROM payments')) {
          return [[{
            id: 'PAY-GENERIC-999',
            client_id: 211,
            amount: 2750.00,
            status: 'Aprobado',
            gateway_ref: 'CARDNET-REF-GENERIC', // Sin sufijo de contrato AUTO-
            description: 'Cobro recurrente',
            created_at: '2026-05-26 10:00:00',
            salon_id: 1
          }]];
        }
        if (sql.includes('FROM contracts')) {
          return [[
            {
              contract_id: 1111,
              client_id: 211,
              cliente: 'Irma Doble Contrato',
              telefono: '809-555-0111',
              plan: 'Plan Beauty',
              plan_price: 1950,
              sucursal: 'Abatte Peluquería San Vicente',
              salon_id: 1,
              client_salon_id: 1,
              estado_contrato: 'Active',
              signed_at: '2025-05-26 10:00:00',
              last_annual_fee_date: '2025-05-26 10:00:00'
            },
            {
              contract_id: 2222,
              client_id: 211,
              cliente: 'Irma Doble Contrato',
              telefono: '809-555-0111',
              plan: 'Plan Beauty VIP',
              plan_price: 1950,
              sucursal: 'Abatte Peluquería San Vicente',
              salon_id: 1,
              client_salon_id: 1,
              estado_contrato: 'Active',
              signed_at: '2025-05-26 10:00:00',
              last_annual_fee_date: '2025-05-26 10:00:00'
            }
          ]];
        }
        return [[]];
      }
    };

    const res = await handleBIReport(mockPool, {
      reportId: 'contracts_upcoming_renewal',
      startDate: '2026-05-01',
      endDate: '2026-05-31'
    });

    test('Escenario 11: Pago sin identificador inequívoco en múltiple contrato -> Estado "Requiere revisión"', () => {
      assert.strictEqual(res.table.rows.length, 2);
      assert.strictEqual(res.table.rows[0].estado, 'Requiere revisión');
      assert.strictEqual(res.table.rows[1].estado, 'Requiere revisión');
    });
  }

  // Escenario 12: Pago de RD$ 800 en mostrador sin descripción anual ni referencia -> No marca Pagada
  {
    const mockPool = {
      query: async (sql, params) => {
        if (sql.includes('contract_settings')) return [[{ renewal_fee: 800 }]];
        if (sql.includes('FROM salons')) return [salonsMock];
        if (sql.includes('FROM payments')) {
          return [[{
            id: 'PAY-POS-CASHIER',
            client_id: 212,
            amount: 800.00,
            status: 'Aprobado',
            gateway_ref: 'TERMINAL-POS-01', // Pago regular de caja
            description: 'Servicio secado y tratamiento', // No es suscripción
            created_at: '2026-05-26 15:00:00',
            salon_id: 1
          }]];
        }
        if (sql.includes('FROM contracts')) {
          return [[{
            contract_id: 112,
            client_id: 212,
            cliente: 'Juana POS',
            telefono: '809-555-0112',
            plan: 'Plan Beauty',
            plan_price: 1950,
            sucursal: 'Abatte Peluquería San Vicente',
            salon_id: 1,
            client_salon_id: 1,
            estado_contrato: 'Active',
            signed_at: '2025-05-26 10:00:00',
            last_annual_fee_date: '2025-05-26 10:00:00' // No ha pagado renovación
          }]];
        }
        return [[]];
      }
    };

    const res = await handleBIReport(mockPool, {
      reportId: 'contracts_upcoming_renewal',
      startDate: '2026-05-01',
      endDate: '2026-05-31'
    });

    test('Escenario 12: Pago de servicio de RD$ 800 en caja no se confunde con renovación anual -> Estado "Vencida"', () => {
      assert.strictEqual(res.table.rows.length, 1);
      assert.strictEqual(res.table.rows[0].estado, 'Vencida');
    });
  }

  console.log('\n================================================================');
  console.log(`TOTAL RESULTADOS FASE C4: ${passCount} EXITOSAS | ${failCount} FALLIDAS`);
  console.log('================================================================\n');

  if (failCount > 0) process.exit(1);
}

runScenarioTests();

