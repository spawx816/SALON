'use strict';

const PERIODICITY_MODES = Object.freeze({
  CALENDAR_MONTH: 'calendar_month',
  FIXED_30_DAYS: 'fixed_30_days',
});

/**
 * Adds one calendar month preserving the original anniversary day (1..31).
 * If the target month has fewer days (e.g. Jan 31 -> Feb), clamps to the last day
 * of that month (Feb 28/29), while keeping `anchorDay` intact so subsequent months
 * (e.g. Mar) recover the original anniversary day (Mar 31).
 */
function addCalendarMonthPreservingAnchor(dateInput, anchorDay = null) {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) {
    throw new Error('Fecha inválida para cálculo de mes calendario.');
  }

  const effectiveAnchor = Math.max(1, Math.min(31, Number(anchorDay) || d.getUTCDate()));
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0..11

  const nextMonthIndex = month + 1;
  const targetYear = year + Math.floor(nextMonthIndex / 12);
  const targetMonth = nextMonthIndex % 12;

  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const resolvedDay = Math.min(effectiveAnchor, lastDayOfTargetMonth);

  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    resolvedDay,
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds()
  ));
}

/**
 * Computes the next billing period end from `periodStart` according to `periodicityMode`.
 * Existing subscriptions on `fixed_30_days` are preserved unless explicitly migrated.
 */
function computeNextPeriodEnd({ periodStart, periodicityMode = PERIODICITY_MODES.CALENDAR_MONTH, anchorDay = null }) {
  const start = new Date(periodStart);
  if (Number.isNaN(start.getTime())) {
    throw new Error('periodStart inválido.');
  }
  if (periodicityMode === PERIODICITY_MODES.FIXED_30_DAYS) {
    return new Date(start.getTime() + 30 * 86400000);
  }
  return addCalendarMonthPreservingAnchor(start, anchorDay || start.getUTCDate());
}

/**
 * Formats a UTC date as YYYY-MM-DD for deterministic period_key idempotency.
 */
function toPeriodKey(dateInput) {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) throw new Error('Fecha inválida para period_key.');
  return d.toISOString().slice(0, 10);
}

module.exports = {
  PERIODICITY_MODES,
  addCalendarMonthPreservingAnchor,
  computeNextPeriodEnd,
  toPeriodKey,
};
