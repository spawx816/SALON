'use strict';

/**
 * Servicio Canónico de Agregación de Pagos y Caja de Jornada
 *
 * Única fuente de verdad en unidades menores (centavos DOP) para:
 * - Persistencia de applied_payments en POST /api/visits/:id/checkout
 * - Listado de cajas (GET /api/cash-registers)
 * - Caja activa (GET /api/cash-registers/active)
 * - Desglose y movimientos en tiempo real (GET /api/cash-registers/:id/movements)
 * - Arqueo y cierre de caja (POST /api/cash-registers/:id/close)
 * - Reporte imprimible de cierre (GET /api/cash-registers/:id/close-report)
 */

function toCents(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function fromCents(cents) {
  return Math.round(Number(cents) || 0) / 100;
}

function classifyMethodBucket(methodRaw) {
  const m = String(methodRaw || '').trim().toLowerCase();
  if (!m) return 'efectivo';
  if (m.includes('por cobrar') || m.includes('fiado') || ((m.includes('credito') || m.includes('crédito')) && !m.includes('tarjeta'))) return 'otros';
  if (m.includes('gift') || m.includes('certificado') || m.includes('regalo')) return 'gift_card';
  if (m.includes('efectivo') || m.includes('cash')) return 'efectivo';
  if (m.includes('tarjeta') || m.includes('card') || m.includes('verifone') || m.includes('pos') || m.includes('debito') || m.includes('débito') || m.includes('credito') || m.includes('crédito')) return 'tarjeta';
  if (m.includes('transf') || m.includes('banco') || m.includes('depósito') || m.includes('deposito')) return 'transferencia';
  if (m.includes('nomina') || m.includes('nómina') || m.includes('empleado') || m.includes('consumo')) return 'consumo_empleado';
  if (m.includes('plan') || m.includes('membres')) return 'plan_beauty';
  return 'otros';
}

function emptyBuckets() {
  return {
    efectivo_cents: 0,
    tarjeta_cents: 0,
    transferencia_cents: 0,
    gift_card_cents: 0,
    otros_cents: 0,
    consumo_empleado_cents: 0,
    plan_beauty_cents: 0,
    plan_beauty_count: 0,
  };
}

function addBucketCents(buckets, methodName, cents) {
  const bucket = classifyMethodBucket(methodName);
  if (bucket === 'plan_beauty') {
    buckets.plan_beauty_cents += cents;
    buckets.plan_beauty_count += 1;
    return;
  }
  buckets[`${bucket}_cents`] += cents;
}

function parseMixedMethodString(metodoPago) {
  const str = String(metodoPago || '');
  if (!str.toLowerCase().includes('mixto')) return [];
  const innerMatch = str.match(/\(([^)]+)\)/);
  const content = innerMatch ? innerMatch[1] : str;
  const parts = content.split('+').map((p) => p.trim()).filter(Boolean);
  const parsed = [];
  for (const part of parts) {
    const m = part.match(/^([^:]+):\s*(?:RD\$|US\$|\$)?\s*([\d,]+(?:\.\d+)?)/i);
    if (m) {
      const method = m[1].trim();
      const amount = Number(String(m[2]).replace(/,/g, ''));
      if (Number.isFinite(amount) && amount >= 0) {
        parsed.push({ method, cents: toCents(amount) });
      }
    }
  }
  return parsed;
}

/**
 * Construye el payload canónico JSON para almacenar en visits.applied_payments al finalizar una factura.
 */
function buildCanonicalAppliedPayments({
  applied_payments,
  pago_efectivo,
  pago_tarjeta,
  pago_transferencia,
  metodo_pago,
  total_cents,
  total,
}) {
  const expectedTotalCents = Number.isFinite(Number(total_cents)) ? Math.round(Number(total_cents)) : toCents(total);
  const buckets = emptyBuckets();
  const breakdown = [];

  let parsedRaw = applied_payments;
  if (typeof parsedRaw === 'string') {
    try { parsedRaw = JSON.parse(parsedRaw); } catch (_) { parsedRaw = null; }
  }

  if (Array.isArray(parsedRaw) && parsedRaw.length > 0) {
    for (const item of parsedRaw) {
      if (!item) continue;
      const method = item.method || item.metodo || item.payment_method || 'Efectivo';
      const cents = Number.isFinite(Number(item.amount_cents))
        ? Math.round(Number(item.amount_cents))
        : toCents(item.amount ?? item.monto ?? 0);
      if (cents > 0 || classifyMethodBucket(method) === 'plan_beauty') {
        addBucketCents(buckets, method, cents);
        breakdown.push({ method, bucket: classifyMethodBucket(method), amount_cents: cents, amount: fromCents(cents) });
      }
    }
  } else if (parsedRaw && typeof parsedRaw === 'object' && !Array.isArray(parsedRaw)) {
    const pairs = [
      ['efectivo', parsedRaw.efectivo_cents ?? toCents(parsedRaw.efectivo || 0)],
      ['tarjeta', parsedRaw.tarjeta_cents ?? toCents(parsedRaw.tarjeta || 0)],
      ['transferencia', parsedRaw.transferencia_cents ?? toCents(parsedRaw.transferencia || 0)],
      ['gift_card', parsedRaw.gift_card_cents ?? toCents(parsedRaw.gift_card || parsedRaw.giftCard || 0)],
      ['consumo_empleado', parsedRaw.consumo_empleado_cents ?? toCents(parsedRaw.consumo_empleado || parsedRaw.consumo || 0)],
      ['plan_beauty', parsedRaw.plan_beauty_cents ?? toCents(parsedRaw.plan_beauty || 0)],
      ['otros', parsedRaw.otros_cents ?? toCents(parsedRaw.otros || 0)],
    ];
    for (const [b, c] of pairs) {
      const cents = Math.round(Number(c) || 0);
      if (cents > 0) {
        buckets[`${b}_cents`] += cents;
        breakdown.push({ method: b, bucket: b, amount_cents: cents, amount: fromCents(cents) });
      }
    }
  }

  // Fallback a campos explícitos pago_efectivo / pago_tarjeta / pago_transferencia
  const currentSum =
    buckets.efectivo_cents + buckets.tarjeta_cents + buckets.transferencia_cents +
    buckets.gift_card_cents + buckets.otros_cents + buckets.consumo_empleado_cents + buckets.plan_beauty_cents;

  if (currentSum === 0) {
    const pe = toCents(pago_efectivo || 0);
    const pt = toCents(pago_tarjeta || 0);
    const ptr = toCents(pago_transferencia || 0);
    if (pe + pt + ptr > 0) {
      if (pe > 0) { buckets.efectivo_cents += pe; breakdown.push({ method: 'Efectivo', bucket: 'efectivo', amount_cents: pe, amount: fromCents(pe) }); }
      if (pt > 0) { buckets.tarjeta_cents += pt; breakdown.push({ method: 'Tarjeta', bucket: 'tarjeta', amount_cents: pt, amount: fromCents(pt) }); }
      if (ptr > 0) { buckets.transferencia_cents += ptr; breakdown.push({ method: 'Transferencia', bucket: 'transferencia', amount_cents: ptr, amount: fromCents(ptr) }); }
    }
  }

  // Fallback final por metodo_pago (incluyendo Mixto(...) o método simple) cuando los montos previos son 0
  const afterExplicitSum =
    buckets.efectivo_cents + buckets.tarjeta_cents + buckets.transferencia_cents +
    buckets.gift_card_cents + buckets.otros_cents + buckets.consumo_empleado_cents + buckets.plan_beauty_cents;

  if (afterExplicitSum === 0) {
    const mixedParts = parseMixedMethodString(metodo_pago);
    if (mixedParts.length > 0) {
      for (const p of mixedParts) {
        addBucketCents(buckets, p.method, p.cents);
        breakdown.push({ method: p.method, bucket: classifyMethodBucket(p.method), amount_cents: p.cents, amount: fromCents(p.cents) });
      }
    } else if (expectedTotalCents > 0 || classifyMethodBucket(metodo_pago) === 'plan_beauty') {
      const m = metodo_pago || 'Efectivo';
      addBucketCents(buckets, m, expectedTotalCents);
      breakdown.push({ method: m, bucket: classifyMethodBucket(m), amount_cents: expectedTotalCents, amount: fromCents(expectedTotalCents) });
    }
  }

  return {
    efectivo: fromCents(buckets.efectivo_cents),
    tarjeta: fromCents(buckets.tarjeta_cents),
    transferencia: fromCents(buckets.transferencia_cents),
    gift_card: fromCents(buckets.gift_card_cents),
    otros: fromCents(buckets.otros_cents),
    consumo_empleado: fromCents(buckets.consumo_empleado_cents),
    plan_beauty: fromCents(buckets.plan_beauty_cents),
    efectivo_cents: buckets.efectivo_cents,
    tarjeta_cents: buckets.tarjeta_cents,
    transferencia_cents: buckets.transferencia_cents,
    gift_card_cents: buckets.gift_card_cents,
    otros_cents: buckets.otros_cents,
    consumo_empleado_cents: buckets.consumo_empleado_cents,
    plan_beauty_cents: buckets.plan_beauty_cents,
    plan_beauty_count: buckets.plan_beauty_count,
    breakdown,
    currency: 'DOP',
  };
}

/**
 * Extrae el desglose canónico en centavos de una fila de visits (compatible con filas legacy y actuales).
 */
function extractVisitPaymentsCents(visit) {
  const totalCents =
    visit.total_cents !== undefined && visit.total_cents !== null && Number.isFinite(Number(visit.total_cents))
      ? Math.round(Number(visit.total_cents))
      : toCents(visit.total || 0);

  return buildCanonicalAppliedPayments({
    applied_payments: visit.applied_payments,
    metodo_pago: visit.metodo_pago,
    total_cents: totalCents,
    total: visit.total,
  });
}

/**
 * Calcula el resumen canónico de una caja de jornada a partir de sus visitas y movimientos ya consultados.
 */
function aggregateRegisterSummary(register, visits = [], movements = []) {
  const openingBalanceCents =
    register.opening_balance_cents !== undefined && register.opening_balance_cents !== null && Number.isFinite(Number(register.opening_balance_cents))
      ? Math.round(Number(register.opening_balance_cents))
      : toCents(register.monto_inicial ?? register.opening_balance ?? register.opening_amount ?? 0);

  const totals = emptyBuckets();
  let countFacturadas = 0;
  const listaAnulaciones = [];

  for (const v of visits || []) {
    const st = String(v.status || '').toLowerCase();
    if (st === 'anulado' || st === 'voided' || st === 'cancelado') {
      listaAnulaciones.push({
        id: v.id,
        ticket_number: v.ticket_number,
        client_name: v.client_name,
        total: Number(v.total || 0),
        metodo_pago: v.metodo_pago,
        void_reason: v.void_reason || v.nota || '',
        voided_at: v.voided_at || v.visited_at,
      });
      continue;
    }
    if (st !== 'facturado') continue;

    countFacturadas += 1;
    const p = extractVisitPaymentsCents(v);
    totals.efectivo_cents += p.efectivo_cents;
    totals.tarjeta_cents += p.tarjeta_cents;
    totals.transferencia_cents += p.transferencia_cents;
    totals.gift_card_cents += p.gift_card_cents;
    totals.otros_cents += p.otros_cents;
    totals.consumo_empleado_cents += p.consumo_empleado_cents;
    totals.plan_beauty_cents += p.plan_beauty_cents;
    totals.plan_beauty_count += p.plan_beauty_count;
  }

  let entradasCents = 0;
  let gastosCents = 0;
  let prestamosCents = 0;
  let retirosCents = 0;
  let devolucionesEfectivoCents = 0;
  const listaEntradas = [];
  const listaGastos = [];
  const listaPrestamos = [];
  const listaRetiros = [];

  for (const m of movements || []) {
    const rawType = String(m.type || '').trim().toLowerCase();
    // Evitar doble conteo / doble reversión: ventas y anulaciones ya vienen reflejadas en visits (status='Facturado')
    if (rawType === 'anulacion_venta' || rawType === 'ingreso_venta') continue;

    const pm = String(m.payment_method || 'Efectivo').toLowerCase();
    const isCashMovement = !pm || pm.includes('efectivo') || pm.includes('cash');
    const amtCents =
      m.amount_cents !== undefined && m.amount_cents !== null && Number.isFinite(Number(m.amount_cents))
        ? Math.round(Number(m.amount_cents))
        : toCents(m.amount || 0);

    if (!isCashMovement) continue;

    if (rawType === 'ingreso' || rawType === 'in' || rawType === 'entrada' || rawType === 'entrada_adicional') {
      entradasCents += amtCents;
      listaEntradas.push(m);
    } else if (rawType.includes('retiro') || rawType.includes('sangria')) {
      retirosCents += amtCents;
      listaRetiros.push(m);
    } else if (rawType.includes('devolucion') || rawType.includes('refund')) {
      devolucionesEfectivoCents += amtCents;
      listaGastos.push(m);
    } else if (rawType.includes('prestamo')) {
      prestamosCents += amtCents;
      gastosCents += amtCents;
      listaPrestamos.push(m);
    } else {
      gastosCents += amtCents;
      listaGastos.push(m);
    }
  }

  const totalDineroRecibidoCents =
    totals.efectivo_cents +
    totals.tarjeta_cents +
    totals.transferencia_cents +
    totals.gift_card_cents +
    totals.otros_cents;

  const totalSinIngresoCents = totals.consumo_empleado_cents + totals.plan_beauty_cents;
  const totalFacturadoCents = totalDineroRecibidoCents + totalSinIngresoCents;

  // Regla canónica: la caja esperada incluye EXCLUSIVAMENTE efectivo
  // fondo inicial + ventas en efectivo + entradas de efectivo - devoluciones en efectivo - gastos en efectivo - retiros en efectivo
  const expectedCashCents =
    openingBalanceCents +
    totals.efectivo_cents +
    entradasCents -
    devolucionesEfectivoCents -
    gastosCents -
    retirosCents;

  // Preservar instantánea histórica de cierre si la caja está cerrada y tiene snapshot guardado
  const isClosed = String(register.status || '').toLowerCase() === 'cerrada';
  const storedExpectedCents =
    isClosed && register.expected_balance_cents !== undefined && register.expected_balance_cents !== null
      ? Math.round(Number(register.expected_balance_cents))
      : expectedCashCents;

  const totalSalidasManualesCents = gastosCents + retirosCents + devolucionesEfectivoCents;

  return {
    // Unidades menores (centavos)
    opening_balance_cents: openingBalanceCents,
    efectivo_cents: totals.efectivo_cents,
    tarjeta_cents: totals.tarjeta_cents,
    transferencia_cents: totals.transferencia_cents,
    gift_card_cents: totals.gift_card_cents,
    otros_cents: totals.otros_cents,
    consumo_empleado_cents: totals.consumo_empleado_cents,
    plan_beauty_cents: totals.plan_beauty_cents,
    total_dinero_recibido_cents: totalDineroRecibidoCents,
    total_sin_ingreso_cents: totalSinIngresoCents,
    total_ventas_cents: totalFacturadoCents,
    entradas_cents: entradasCents,
    gastos_cents: gastosCents,
    prestamos_cents: prestamosCents,
    retiros_cents: retirosCents,
    devoluciones_efectivo_cents: devolucionesEfectivoCents,
    salidas_manuales_cents: totalSalidasManualesCents,
    expected_cash_cents: storedExpectedCents,

    // Campos snake_case (listado, /active, /close)
    opening_balance: fromCents(openingBalanceCents),
    monto_inicial: fromCents(openingBalanceCents),
    ventas_efectivo: fromCents(totals.efectivo_cents),
    ventas_tarjeta: fromCents(totals.tarjeta_cents),
    ventas_transferencia: fromCents(totals.transferencia_cents),
    ventas_gift_card: fromCents(totals.gift_card_cents),
    ventas_otros: fromCents(totals.otros_cents),
    ventas_consumo_empleado: fromCents(totals.consumo_empleado_cents),
    ventas_plan_beauty: fromCents(totals.plan_beauty_cents),
    efectivo_total: fromCents(totals.efectivo_cents),
    tarjeta_total: fromCents(totals.tarjeta_cents),
    transferencia_total: fromCents(totals.transferencia_cents),
    gift_card_total: fromCents(totals.gift_card_cents),
    otros_total: fromCents(totals.otros_cents),
    consumo_empleado_total: fromCents(totals.consumo_empleado_cents),
    plan_beauty_count: totals.plan_beauty_count,
    total_dinero_recibido: fromCents(totalDineroRecibidoCents),
    total_sin_ingreso: fromCents(totalSinIngresoCents),
    total_ventas: fromCents(totalFacturadoCents),
    count_invoices: countFacturadas,
    ingresos_manuales: fromCents(entradasCents),
    entradas_total: fromCents(entradasCents),
    salidas_manuales: fromCents(totalSalidasManualesCents),
    gastos_total: fromCents(gastosCents),
    prestamos_total: fromCents(prestamosCents),
    retiros_total: fromCents(retirosCents),
    devoluciones_efectivo_total: fromCents(devolucionesEfectivoCents),
    expected_cash: fromCents(storedExpectedCents),
    monto_esperado: fromCents(storedExpectedCents),

    // Campos camelCase (VisitRecorder Caja de Jornada + CashRegisterClosePrintModal)
    montoInicial: fromCents(openingBalanceCents),
    efectivoTotal: fromCents(totals.efectivo_cents),
    tarjetaTotal: fromCents(totals.tarjeta_cents),
    transferenciaTotal: fromCents(totals.transferencia_cents),
    giftCardTotal: fromCents(totals.gift_card_cents),
    otrosTotal: fromCents(totals.otros_cents),
    consumoTotal: fromCents(totals.consumo_empleado_cents),
    planBeautyTotal: fromCents(totals.plan_beauty_cents),
    planBeautyCount: totals.plan_beauty_count,
    totalDineroRecibido: fromCents(totalDineroRecibidoCents),
    totalSinIngreso: fromCents(totalSinIngresoCents),
    totalFacturado: fromCents(totalFacturadoCents),
    countVentas: countFacturadas,
    entradasTotal: fromCents(entradasCents),
    gastosTotal: fromCents(gastosCents),
    prestamosTotal: fromCents(prestamosCents),
    retirosTotal: fromCents(retirosCents),
    devolucionesEfectivoTotal: fromCents(devolucionesEfectivoCents),
    montoEstimadoEnCaja: fromCents(storedExpectedCents),
    totalIn: fromCents(entradasCents),
    totalOut: fromCents(totalSalidasManualesCents),
    net: fromCents(entradasCents - totalSalidasManualesCents),

    // Listas para reporte imprimible
    listaEntradas,
    listaGastos,
    listaPrestamos,
    listaRetiros,
    listaAnulaciones,
  };
}

/**
 * Carga y agrega desde PostgreSQL las visitas y movimientos de una caja específica (estrictamente por tenant_id y cash_register_id).
 */
async function computeCanonicalRegisterSummary(pool, tenantId, register) {
  const regId = String(register.id);
  const [visits] = await pool.query(
    `SELECT id, ticket_number, client_name, total, total_cents, metodo_pago, applied_payments, status, visited_at, ncf, void_reason, voided_at
     FROM visits
     WHERE tenant_id = ? AND cash_register_id::text = ?
     ORDER BY visited_at DESC`,
    [tenantId, regId]
  );
  const [movements] = await pool.query(
    `SELECT id, type, payment_method, amount, amount_cents, concept, user_name, created_at, employee_name
     FROM cash_register_movements
     WHERE cash_register_id::text = ? AND tenant_id = ?
     ORDER BY created_at DESC`,
    [regId, tenantId]
  );
  const summary = aggregateRegisterSummary(register, visits || [], movements || []);
  return { summary, visits: visits || [], movements: movements || [] };
}

module.exports = {
  toCents,
  fromCents,
  classifyMethodBucket,
  buildCanonicalAppliedPayments,
  extractVisitPaymentsCents,
  aggregateRegisterSummary,
  computeCanonicalRegisterSummary,
};
