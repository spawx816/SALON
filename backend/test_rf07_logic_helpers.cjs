/**
 * Unit Test for Annual Renewal Calculation Helpers and State Machine
 */
const assert = require('assert');

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

function getNextAnniversary(signedDateStr, cycleYears) {
  if (!signedDateStr) return null;
  const raw = typeof signedDateStr === 'string' ? signedDateStr : signedDateStr.toISOString();
  const parts = raw.split('T')[0].split('-');
  if (parts.length < 3) return null;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);

  const targetYear = y + cycleYears;
  let targetDay = d;

  if (m === 2 && d === 29) {
    targetDay = isLeapYear(targetYear) ? 29 : 28;
  }

  const pad = (n) => String(n).padStart(2, '0');
  return `${targetYear}-${pad(m)}-${pad(targetDay)}`;
}

function evaluateCycleState(contract, cycleIndex, anniversaryDateStr, todayStr, clientPayments, renewalFee = 800) {
  if (!contract.signed_at || !anniversaryDateStr) {
    return { estado: 'Requiere revisión', razon: 'Fecha de firma inválida o ausente' };
  }

  const planPrice = parseFloat(contract.plan_price || 1950);
  const expectedCombined = planPrice + renewalFee;

  // Window for payment: from cycle start (or 15 days before anniversary for 365-day cron) to anniversary + 60 days
  const annivDate = new Date(`${anniversaryDateStr}T00:00:00Z`);
  const minPayDate = new Date(annivDate.getTime() - (20 * 24 * 60 * 60 * 1000)); // 20 days buffer before anniversary (allows 365 cron on leap/early)
  const maxPayDate = new Date(annivDate.getTime() + (60 * 24 * 60 * 60 * 1000)); // up to 60 days after

  const contractSuffix = contract.contract_id ? String(contract.contract_id).slice(-4) : '';

  // Check matching payments
  const matchingPayments = (clientPayments || []).filter(p => {
    if (p.status !== 'Aprobado') return false;
    const pDate = new Date(p.created_at);
    if (isNaN(pDate.getTime())) return false;
    if (pDate < minPayDate || pDate > maxPayDate) return false;

    // Disambiguate if payment references a different contract ID
    if (p.gateway_ref && p.gateway_ref.includes('AUTO-') && contract.contract_id) {
      const refSuffix = p.gateway_ref.replace(/.*AUTO-/, '');
      const refNum = parseInt(refSuffix, 10);
      const ctNum = parseInt(String(contract.contract_id).replace(/[^0-9]/g, ''), 10);
      if (!isNaN(refNum) && !isNaN(ctNum) && refNum !== ctNum) {
        return false; // Belongs to a different contract of the same client!
      }
    }
    if (p.id && p.id.includes('PAY-AUTO-') && contract.contract_id) {
      const idParts = p.id.split('-');
      const idSuffix = idParts[idParts.length - 1];
      const idNum = parseInt(idSuffix, 10);
      const ctNum = parseInt(String(contract.contract_id).replace(/[^0-9]/g, ''), 10);
      if (!isNaN(idNum) && !isNaN(ctNum) && idNum !== ctNum) {
        return false; // Belongs to a different contract of the same client!
      }
    }

    const amt = parseFloat(p.amount);
    const desc = (p.description || '').toLowerCase();
    const hasRenovDesc = desc.includes('renovación anual') || desc.includes('renovacion anual') || desc.includes('cuota anual');
    const hasCombinedAmt = Math.abs(amt - expectedCombined) < 1.0;
    const hasFeeAmt = Math.abs(amt - renewalFee) < 1.0;

    return hasRenovDesc || hasCombinedAmt || hasFeeAmt;
  });

  const hasPaymentEvidence = matchingPayments.length > 0;

  // Check last_annual_fee_date
  let hasLastAnnualEvidence = false;
  if (contract.last_annual_fee_date) {
    const lastAnnual = new Date(contract.last_annual_fee_date);
    if (!isNaN(lastAnnual.getTime()) && lastAnnual >= minPayDate) {
      hasLastAnnualEvidence = true;
    }
  }

  // Determine state
  if (hasPaymentEvidence && hasLastAnnualEvidence) {
    return { estado: 'Pagada', payment: matchingPayments[0] };
  }

  if (hasLastAnnualEvidence && !hasPaymentEvidence) {
    // Marked in contract but no payment found in payments table
    return { estado: 'Requiere revisión', razon: 'Marcador en contrato sin comprobante de pago en payments' };
  }

  if (hasPaymentEvidence && !hasLastAnnualEvidence) {
    // Payment approved in payments table but contract marker wasn't updated
    return { estado: 'Pagada', payment: matchingPayments[0], note: 'Confirmado por transacción bancaria aprobada' };
  }

  // Neither evidence exists: check if overdue or pending
  if (anniversaryDateStr < todayStr) {
    return { estado: 'Vencida' };
  } else {
    return { estado: 'Pendiente' };
  }
}

// -------------------------------------------------------------------------
// UNIT TESTS
// -------------------------------------------------------------------------
console.log('--- TEST: Evaluador de Estados de Renovación Anual ---');

const todayStr = '2026-11-02';

// 1. Contrato futuro (Mayo 2027) sin pago -> Pendiente
const resPending = evaluateCycleState(
  { contract_id: 'CT-1001', signed_at: '2026-05-26', plan_price: 1950, last_annual_fee_date: '2026-05-26' },
  1,
  '2027-05-26',
  todayStr,
  []
);
assert.strictEqual(resPending.estado, 'Pendiente', 'Futuro sin pago debe ser Pendiente');
console.log('✅ Caso 1: Futuro sin pago -> Pendiente');

// 2. Contrato pasado sin pago -> Vencida
const resOverdue = evaluateCycleState(
  { contract_id: 'CT-1002', signed_at: '2025-05-26', plan_price: 1950, last_annual_fee_date: '2025-05-26' },
  1,
  '2026-05-26',
  todayStr,
  []
);
assert.strictEqual(resOverdue.estado, 'Vencida', 'Pasado sin pago debe ser Vencida');
console.log('✅ Caso 2: Pasado sin pago -> Vencida');

// 3. Contrato con pago combinado RD$ 2,750 y last_annual_fee_date actualizado -> Pagada
const resPaidCombined = evaluateCycleState(
  { contract_id: 'CT-1003', signed_at: '2025-05-26', plan_price: 1950, last_annual_fee_date: '2026-05-26' },
  1,
  '2026-05-26',
  todayStr,
  [{
    id: 'PAY-AUTO-1-1003',
    status: 'Aprobado',
    amount: '2750.00',
    description: 'Mensualidad + Renovación Anual: Plan Beauty',
    created_at: '2026-05-26T10:00:00Z',
    gateway_ref: 'AUTO-1003'
  }]
);
assert.strictEqual(resPaidCombined.estado, 'Pagada', 'Pago combinado aprobado debe ser Pagada');
console.log('✅ Caso 3: Pago combinado RD$ 2,750 -> Pagada');

// 4. Pago ejecutado 1 día antes por cron de 365 días en año bisiesto -> Pagada
const resEarlyCron = evaluateCycleState(
  { contract_id: 'CT-1004', signed_at: '2024-02-29', plan_price: 1950, last_annual_fee_date: '2025-02-27' },
  1,
  '2025-02-28',
  todayStr,
  [{
    id: 'PAY-AUTO-2-1004',
    status: 'Aprobado',
    amount: '2750.00',
    description: 'Mensualidad + Renovación Anual: Plan Beauty',
    created_at: '2025-02-27T10:00:00Z', // 1 día antes del aniversario
    gateway_ref: 'AUTO-1004'
  }]
);
assert.strictEqual(resEarlyCron.estado, 'Pagada', 'Pago 1 día antes por cron 365 debe reconocerse como Pagada');
console.log('✅ Caso 4: Pago 1 día antes por cron -> Pagada');

// 5. Rechazo de CardNet (status != 'Aprobado') -> Vencida (si ya pasó fecha)
const resDeclined = evaluateCycleState(
  { contract_id: 'CT-1005', signed_at: '2025-05-26', plan_price: 1950, last_annual_fee_date: '2025-05-26' },
  1,
  '2026-05-26',
  todayStr,
  [{
    id: 'PAY-FAIL-1005',
    status: 'Fallido - Intento 1',
    amount: '2750.00',
    description: 'Intento Recurrente Fallido (Declinado)',
    created_at: '2026-05-26T10:00:00Z'
  }]
);
assert.strictEqual(resDeclined.estado, 'Vencida', 'Pago rechazado no debe marcar Pagada, sino Vencida si ya pasó fecha');
console.log('✅ Caso 5: Pago declinado -> Vencida');

// 6. Pago asociado a OTRO contrato del mismo cliente -> No debe aplicarse a este contrato
const resOtherContract = evaluateCycleState(
  { contract_id: 'CT-1006', signed_at: '2025-05-26', plan_price: 1950, last_annual_fee_date: '2025-05-26' },
  1,
  '2026-05-26',
  todayStr,
  [{
    id: 'PAY-AUTO-99-9999',
    status: 'Aprobado',
    amount: '2750.00',
    description: 'Mensualidad + Renovación Anual: Plan Beauty',
    created_at: '2026-05-26T10:00:00Z',
    gateway_ref: 'AUTO-9999' // Pertenece al contrato 9999, no a 1006!
  }]
);
assert.strictEqual(resOtherContract.estado, 'Vencida', 'Pago de otro contrato no debe atribuirse a este');
console.log('✅ Caso 6: Pago de otro contrato del mismo cliente -> Vencida (aislado correctamente)');

// 7. Inconsistencia: contrato dice renovado pero NO hay pago en BD -> Requiere revisión
const resReview = evaluateCycleState(
  { contract_id: 'CT-1007', signed_at: '2025-05-26', plan_price: 1950, last_annual_fee_date: '2026-05-26' },
  1,
  '2026-05-26',
  todayStr,
  [] // No hay pago en payments!
);
assert.strictEqual(resReview.estado, 'Requiere revisión', 'Fecha actualizada sin comprobante de pago -> Requiere revisión');
console.log('✅ Caso 7: Inconsistencia contractual sin pago -> Requiere revisión');

console.log('\nTODOS LOS CASOS UNITARIOS DE ESTADO PASARON CON ÉXITO.');
