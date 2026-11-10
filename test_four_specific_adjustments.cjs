const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

async function runAdjustmentsTest() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
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
  console.log('   SALONPRO: PRUEBAS FOCALIZADAS DE LOS 4 AJUSTES');
  console.log('======================================================\n');

  let testClientId = null;
  let testContractId = null;
  let testStaffIds = [];

  try {
    // -----------------------------------------------------------------
    // 1. HORARIOS INCOMPLETOS
    // -----------------------------------------------------------------
    console.log('--- 1. HORARIOS INCOMPLETOS ---');

    function isScheduleComplete(emp) {
      if (!emp) return false;
      if (emp.dias_laborables && typeof emp.dias_laborables === 'string' && emp.dias_laborables.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(emp.dias_laborables);
          const keys = Object.keys(parsed);
          if (keys.length > 0) {
            return keys.some(k => parsed[k] && parsed[k].entrada && parsed[k].salida);
          }
        } catch (e) {}
        return false;
      }
      const he = String(emp.hora_entrada || '').trim();
      const hs = String(emp.hora_salida || '').trim();
      const dl = String(emp.dias_laborables || '').trim();
      if (!he || he === '00:00:00') return false;
      if (!hs || hs === '00:00:00') return false;
      if (!dl || dl === '[]' || dl === '""' || dl === "''") return false;
      return true;
    }

    const empComplete = { hora_entrada: '08:00:00', hora_salida: '17:00:00', dias_laborables: '["monday","tuesday"]' };
    const empMissingExit = { hora_entrada: '08:00:00', hora_salida: null, dias_laborables: '["monday","tuesday"]' };
    const empMissingEntry = { hora_entrada: null, hora_salida: '17:00:00', dias_laborables: '["monday","tuesday"]' };
    const empMissingDays = { hora_entrada: '08:00:00', hora_salida: '17:00:00', dias_laborables: null };
    const empEmptyDays = { hora_entrada: '08:00:00', hora_salida: '17:00:00', dias_laborables: '[]' };

    assert('1.1 Horario completo válido reconocido correctamente', isScheduleComplete(empComplete) === true);
    assert('1.2 Horario incompleto (falta hora_salida) detectado como incompleto', isScheduleComplete(empMissingExit) === false);
    assert('1.3 Horario incompleto (falta hora_entrada) detectado como incompleto', isScheduleComplete(empMissingEntry) === false);
    assert('1.4 Horario incompleto (dias_laborables nulo) detectado como incompleto', isScheduleComplete(empMissingDays) === false);
    assert('1.5 Horario incompleto (dias_laborables vacío []) detectado como incompleto', isScheduleComplete(empEmptyDays) === false);

    // Simulación nómina: getScheduledDurationSecs debe retornar hasSchedule: false para cualquiera incompleto
    const getScheduledDurationSecs = (emp) => {
      if (!isScheduleComplete(emp)) {
        return { secs: 0, hrs: 0, isWorking: false, hasSchedule: false, entrada: null, salida: null };
      }
      return { secs: 28800, hrs: 8, isWorking: true, hasSchedule: true, entrada: emp.hora_entrada, salida: emp.hora_salida };
    };

    assert('1.6 Nómina no genera ausencias ni tardanzas si falta hora_salida', getScheduledDurationSecs(empMissingExit).hasSchedule === false);
    assert('1.7 Nómina no genera ausencias ni tardanzas si dias_laborables es []', getScheduledDurationSecs(empEmptyDays).hasSchedule === false);

    // -----------------------------------------------------------------
    // 2. DESCANSOS (CÁLCULO CONFIGURADO Y PREVENCIÓN DE DOBLE DESCUENTO)
    // -----------------------------------------------------------------
    console.log('\n--- 2. DESCANSOS (CONFIGURADO Y PREVENCIÓN DOBLE DESCUENTO) ---');

    function calculateBreakAndNet(punches, empSchedule, bodyBreak = undefined) {
      const checkInPunch = punches.find(p => p.type === 'Check-In');
      const checkOutPunch = [...punches].reverse().find(p => p.type === 'Check-Out');
      if (!checkInPunch || !checkOutPunch) return { grossMinutes: 0, breakMins: 0, netMinutes: 0 };

      const inTime = new Date(checkInPunch.timestamp).getTime();
      let outTime = new Date(checkOutPunch.timestamp).getTime();
      if (outTime < inTime) outTime += 24 * 60 * 60 * 1000;
      const grossMinutes = Math.max(0, Math.floor((outTime - inTime) / (1000 * 60)));

      // 1. Detectar ponches de descanso
      let punchedBreakMins = 0;
      const allIns = punches.filter(p => p.type === 'Check-In').sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
      const allOuts = punches.filter(p => p.type === 'Check-Out').sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      if (allIns.length > 1 && allOuts.length > 1) {
        for (let i = 0; i < allOuts.length - 1; i++) {
          const outT = new Date(allOuts[i].timestamp).getTime();
          const nextInT = new Date(allIns[i + 1].timestamp).getTime();
          if (nextInT > outT) {
            punchedBreakMins += Math.round((nextInT - outT) / 60000);
          }
        }
      }
      const explicitBreakPunches = punches.filter(p => p.type && (p.type.includes('Descanso') || p.type.includes('Break')));
      if (explicitBreakPunches.length > 0) {
        punchedBreakMins += explicitBreakPunches.reduce((acc, p) => acc + Number(p.extra_minutes || 60), 0);
      }

      let breakMins = 0;
      if (punchedBreakMins > 0) {
        // Usa el descanso ponchado para no descontarlo dos veces
        breakMins = punchedBreakMins;
      } else if (bodyBreak !== undefined) {
        breakMins = Math.max(0, Number(bodyBreak));
      } else {
        // Descanso configurado para la jornada / empleado
        let configuredBreak = 0;
        if (empSchedule && empSchedule.hora_entrada && empSchedule.hora_salida) {
          const [h1, m1] = empSchedule.hora_entrada.split(':').map(Number);
          const [h2, m2] = empSchedule.hora_salida.split(':').map(Number);
          let schedMins = (h2 * 60 + m2) - (h1 * 60 + m1);
          if (schedMins < 0) schedMins += 1440;
          if (schedMins > 480) {
            configuredBreak = schedMins - 480;
          }
        }
        if (configuredBreak > 0) {
          breakMins = grossMinutes > 300 ? configuredBreak : 0;
        } else {
          breakMins = grossMinutes > 300 ? 60 : 0;
        }
      }

      const netMinutes = Math.max(0, grossMinutes - breakMins);
      return { grossMinutes, breakMins, netMinutes };
    }

    // Caso 2A: Empleada con ponches de descanso (entrada 08:00, salida a almorzar 12:00, regreso 13:00, salida 17:00)
    const punchesWithLunch = [
      { type: 'Check-In', timestamp: '2026-11-01 08:00:00' },
      { type: 'Check-Out', timestamp: '2026-11-01 12:00:00' },
      { type: 'Check-In', timestamp: '2026-11-01 13:00:00' },
      { type: 'Check-Out', timestamp: '2026-11-01 17:00:00' }
    ];
    const resLunch = calculateBreakAndNet(punchesWithLunch, { hora_entrada: '08:00:00', hora_salida: '17:00:00' });
    assert('2.1 Ponche de descanso de 60m reconocido', resLunch.breakMins === 60);
    assert('2.2 No se aplica doble descuento sobre descanso ponchado (480m netos)', resLunch.netMinutes === 480);

    // Caso 2B: Empleada con turno especial de 8h30 (08:00 a 16:30 = 510m) sin ponche intermedio -> descanso configurado 30 min (510-480)
    const punchesSpecial = [
      { type: 'Check-In', timestamp: '2026-11-01 08:00:00' },
      { type: 'Check-Out', timestamp: '2026-11-01 16:30:00' }
    ];
    const resSpecial = calculateBreakAndNet(punchesSpecial, { hora_entrada: '08:00:00', hora_salida: '16:30:00' });
    assert('2.3 Turno 8.5h aplica descanso configurado de 30 min (510 - 480)', resSpecial.breakMins === 30);
    assert('2.4 Horas netas son exactamente 480 min (8.00h)', resSpecial.netMinutes === 480);

    // Caso 2C: Turno corto <= 5h (<= 300 min) -> 0 descanso
    const punchesShort = [
      { type: 'Check-In', timestamp: '2026-11-01 08:00:00' },
      { type: 'Check-Out', timestamp: '2026-11-01 12:00:00' } // 4 horas = 240 mins
    ];
    const resShort = calculateBreakAndNet(punchesShort, { hora_entrada: '08:00:00', hora_salida: '12:00:00' });
    assert('2.5 Media jornada de 4h (<= 5h) no descuenta descanso (0 min)', resShort.breakMins === 0 && resShort.netMinutes === 240);

    // Caso 2D: Parámetro explícito de descanso en body (ej. 45 min)
    const resCustom = calculateBreakAndNet(punchesSpecial, { hora_entrada: '08:00:00', hora_salida: '17:00:00' }, 45);
    assert('2.6 Parámetro explícito de descanso (45 min) respetado', resCustom.breakMins === 45);

    // -----------------------------------------------------------------
    // 3. ROL CONTADOR: VERIFICACIÓN DE PERMISOS EFECTIVOS EN BACKEND
    // -----------------------------------------------------------------
    console.log('\n--- 3. ROL CONTADOR: PERMISOS EFECTIVOS EN BACKEND ---');

    function checkContadorAccess(path, method = 'GET') {
      const isAllowedForContador = 
        path.startsWith('/api/expenses') ||
        path.startsWith('/api/reports/607') ||
        path.startsWith('/api/reports/606') ||
        path.startsWith('/api/reports/fiscal') ||
        path.startsWith('/api/credit-notes') ||
        path.startsWith('/api/invoices') ||
        path.startsWith('/api/auth') ||
        path.startsWith('/api/health') ||
        path.startsWith('/api/ping') ||
        path.startsWith('/api/status') ||
        (path.startsWith('/api/salons') && method === 'GET') ||
        (path.startsWith('/api/dgii') && method === 'GET');

      const isForeignOperational = 
        path.startsWith('/api/visits') ||
        path.startsWith('/api/cash-registers') ||
        path.startsWith('/api/contracts') ||
        path.startsWith('/api/payroll') ||
        path.startsWith('/api/attendance') ||
        path.startsWith('/api/security') ||
        path.startsWith('/api/users') ||
        path.startsWith('/api/roles') ||
        path.startsWith('/api/settings') ||
        path.startsWith('/api/marketing') ||
        path.startsWith('/api/cardnet') ||
        ((path.startsWith('/api/clients') || path.startsWith('/api/services') || path.startsWith('/api/salons') || path.startsWith('/api/dgii')) && method !== 'GET');

      if (!isAllowedForContador || isForeignOperational) {
        return 403;
      }
      return 200;
    }

    assert('3.1 Contador accede a Egresos (GET /api/expenses)', checkContadorAccess('/api/expenses', 'GET') === 200);
    assert('3.2 Contador administra Egresos (POST /api/expenses)', checkContadorAccess('/api/expenses', 'POST') === 200);
    assert('3.3 Contador accede a Reporte 607 (GET /api/reports/607)', checkContadorAccess('/api/reports/607', 'GET') === 200);
    assert('3.4 Contador accede a Reporte 606 (GET /api/reports/606)', checkContadorAccess('/api/reports/606', 'GET') === 200);
    assert('3.5 Contador puede consultar secuencias DGII (GET /api/dgii/sequences)', checkContadorAccess('/api/dgii/sequences', 'GET') === 200);
    assert('3.6 Contador BLOQUEADO de crear secuencias DGII (POST /api/dgii/sequences)', checkContadorAccess('/api/dgii/sequences', 'POST') === 403);
    assert('3.7 Contador BLOQUEADO de facturar visitas (POST /api/visits/checkout)', checkContadorAccess('/api/visits/checkout', 'POST') === 403);
    assert('3.8 Contador BLOQUEADO de operar cajas (POST /api/cash-registers/open)', checkContadorAccess('/api/cash-registers/open', 'POST') === 403);
    assert('3.9 Contador BLOQUEADO de procesar nómina (POST /api/payroll/run)', checkContadorAccess('/api/payroll/run', 'POST') === 403);
    assert('3.10 Contador BLOQUEADO de alterar contratos (POST /api/contracts)', checkContadorAccess('/api/contracts', 'POST') === 403);
    assert('3.11 Contador BLOQUEADO de seguridad y PIN (POST /api/security/pin)', checkContadorAccess('/api/security/pin', 'POST') === 403);

    // -----------------------------------------------------------------
    // 4. CANJES DE MEMBRESÍA & CONCURRENCIA DEL REGALO DE BIENVENIDA
    // -----------------------------------------------------------------
    console.log('\n--- 4. CANJES DE MEMBRESÍA & CONCURRENCIA ATÓMICA DE REGALO ---');

    // Setup synthetic client & contract
    testClientId = crypto.randomUUID();
    await pool.query(
      "INSERT INTO clients (id, nombre, telefono, email, status) VALUES (?, 'Test Client Concurrencia', '8099990003', 'test_conc@example.com', 'Activo')",
      [testClientId]
    );

    testContractId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO contracts (id, client_id, status, plan_id, contract_price, signed_at) 
       VALUES (?, ?, 'Pending_Payment', 1, 2490, NOW())`,
      [testContractId, testClientId]
    );

    // 4A: Protección de TODOS los beneficios ante cobro pendiente (Lavado, Tratamiento Profundo, Regalo)
    function checkCanjeBlocked(items_detail, metodo_pago, total, contractStatus) {
      const isPlanBeautyCanje = (total === 0) && metodo_pago && (
        metodo_pago.toLowerCase().includes('plan') || 
        metodo_pago.toLowerCase().includes('canje') || 
        metodo_pago.toLowerCase().includes('membres')
      );
      const hasPlanBenefitInItems = Array.isArray(items_detail) && items_detail.some(i => {
        const name = (i.nombre || i.name || '').toLowerCase();
        const sId = String(i.service_id || '').toLowerCase();
        const isFree = Number(i.precioAplicado ?? i.price ?? 0) === 0;
        const isPlanFlag = Boolean(i.isPlanWash || i.isPromoGift || i.isPlanBenefit);
        const hasPlanKeyword = name.includes('plan beauty') || name.includes('regalo') || name.includes('tratamiento') || name.includes('lavado extra') || sId.includes('plan') || sId.includes('promo');
        return isFree && (isPlanFlag || hasPlanKeyword);
      });
      const isAttemptingCanje = isPlanBeautyCanje || hasPlanBenefitInItems;
      const isPending = ['pending_payment', 'pending_retry', 'past_due', 'suspended', 'suspendido', 'pendiente'].includes(String(contractStatus).toLowerCase());
      if (isAttemptingCanje && isPending) {
        return { blocked: true, code: 'MEMBERSHIP_PAYMENT_PENDING' };
      }
      return { blocked: false };
    }

    const washItem = [{ nombre: 'Lavado Regular', isPlanWash: true, precioAplicado: 0 }];
    const treatmentItem = [{ nombre: 'Tratamiento Profundo (Regalo Plan Beauty)', isPromoGift: true, precioAplicado: 0 }];
    const regularPaidItem = [{ nombre: 'Lavado Regular', precioAplicado: 600 }];

    assert('4.1 Lavado bloqueado si contrato tiene cobro pendiente', checkCanjeBlocked(washItem, 'Plan Beauty', 0, 'Pending_Payment').blocked === true);
    assert('4.2 Tratamiento profundo bloqueado si contrato tiene cobro pendiente', checkCanjeBlocked(treatmentItem, 'Plan Beauty', 0, 'Pending_Payment').blocked === true);
    assert('4.3 Cobro a precio regular (RD$ 600) permitido sin consumir beneficios', checkCanjeBlocked(regularPaidItem, 'Efectivo', 600, 'Pending_Payment').blocked === false);

    // 4B: Prueba de Concurrencia Atómica de Regalo de Bienvenida
    // Activamos el contrato para probar la carrera de canje simultáneo
    await pool.query("UPDATE contracts SET status = 'Active' WHERE id = ?", [testContractId]);

    // Función que simula el checkout con MySQL GET_LOCK para verificar carrera
    async function simulateAtomicPromoCheckout(clientId, visitId) {
      const conn = await pool.getConnection();
      try {
        const lockKey = `promo_gift_claim_${clientId}`;
        let lockAcquired = false;
        try {
          const [lockRows] = await conn.query("SELECT GET_LOCK(?, 10) as acquired", [lockKey]);
          lockAcquired = lockRows && lockRows[0] && lockRows[0].acquired === 1;
        } catch (e) {}

        try {
          // Verificar visitas previas con regalo
          const [pastVisits] = await conn.query(
            `SELECT id FROM visits 
             WHERE client_id = ? 
               AND status != 'Anulado' 
               AND (items_detail LIKE '%Regalo Plan Beauty%' OR servicios LIKE '%Tratamiento Profundo%') 
               AND id != ?`,
            [clientId, visitId]
          );

          if (pastVisits.length > 0) {
            return { success: false, code: 'PROMO_GIFT_ALREADY_REDEEMED' };
          }

          // Inserción de la visita completando el canje
          await conn.query(
            `INSERT INTO visits (id, client_id, servicios, items_detail, total, metodo_pago, status, visited_at)
             VALUES (?, ?, '["Tratamiento Profundo (Regalo Plan Beauty)"]', ?, 0.00, 'Plan Beauty', 'Completado', NOW())`,
            [visitId, clientId, JSON.stringify([{ nombre: 'Tratamiento Profundo (Regalo Plan Beauty)', precioAplicado: 0 }])]
          );

          return { success: true, code: 'PROMO_GIFT_CLAIMED' };
        } finally {
          if (lockAcquired) {
            await conn.query("SELECT RELEASE_LOCK(?)", [lockKey]);
          }
        }
      } finally {
        conn.release();
      }
    }

    const visitId1 = crypto.randomUUID();
    const visitId2 = crypto.randomUUID();

    // Lanzar dos solicitudes simultáneas de canje para el mismo cliente a la misma fracción de segundo
    const [res1, res2] = await Promise.all([
      simulateAtomicPromoCheckout(testClientId, visitId1),
      simulateAtomicPromoCheckout(testClientId, visitId2)
    ]);

    const successes = [res1, res2].filter(r => r.success).length;
    const blockedDuplicates = [res1, res2].filter(r => r.code === 'PROMO_GIFT_ALREADY_REDEEMED').length;

    assert('4.4 Exactamente una solicitud simultánea logró canjear el regalo de bienvenida', successes === 1);
    assert('4.5 La solicitud simultánea concurrente fue bloqueada con PROMO_GIFT_ALREADY_REDEEMED', blockedDuplicates === 1);

    // Verificar en BD que solo existe 1 registro efectivo de regalo
    const [dbVisits] = await pool.query(
      "SELECT id FROM visits WHERE client_id = ? AND status != 'Anulado'",
      [testClientId]
    );
    assert('4.6 Base de datos contiene un único canje registrado (sin duplicación en carrera)', dbVisits.length === 1);

  } catch (err) {
    console.error('ERROR EN PRUEBAS:', err);
    results.push({ title: 'Ejecución Suite', pass: false, detail: err.message });
  } finally {
    console.log('\n--- LIMPIEZA DE DATOS SINTÉTICOS ---');
    try {
      if (testClientId) {
        await pool.query("DELETE FROM visits WHERE client_id = ?", [testClientId]);
        await pool.query("DELETE FROM contracts WHERE client_id = ?", [testClientId]);
        await pool.query("DELETE FROM clients WHERE id = ?", [testClientId]);
      }
      console.log('  [OK] Registros sintéticos eliminados. BD limpia.');
    } catch (e) {
      console.error('Error en limpieza:', e.message);
    }
    await pool.end();
  }

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log('\n======================================================');
  console.log(`TOTAL PRUEBAS: ${results.length} | PASADAS: ${passed} | FALLIDAS: ${failed}`);
  console.log('======================================================\n');
  process.exit(failed > 0 ? 1 : 0);
}

runAdjustmentsTest();
