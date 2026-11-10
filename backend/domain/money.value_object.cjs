/**
 * Canonical Money Value Object (Minor Currency Units)
 * (backend/domain/money.value_object.cjs)
 * 
 * Guarantees mathematical exactness by storing all monetary values as integer cents.
 * Strictly prevents floating-point inaccuracies, currency mismatches, and negative anomalies.
 */

'use strict';

const SUPPORTED_CURRENCIES = Object.freeze(['DOP', 'USD']);

class Money {
  /**
   * Internal constructor expecting integer minor units (cents).
   * 
   * @param {number|bigint} amountCents Integer cents
   * @param {string} currency ISO-4217 Currency Code ('DOP' or 'USD')
   */
  constructor(amountCents, currency = 'DOP') {
    const curr = String(currency || 'DOP').toUpperCase().trim();
    if (!SUPPORTED_CURRENCIES.includes(curr)) {
      const err = new Error(`Moneda no soportada: ${currency}. Las monedas admitidas son: ${SUPPORTED_CURRENCIES.join(', ')}.`);
      err.code = 'UNSUPPORTED_CURRENCY';
      throw err;
    }

    if (typeof amountCents === 'bigint') {
      amountCents = Number(amountCents);
    }

    if (typeof amountCents !== 'number' || isNaN(amountCents) || !isFinite(amountCents)) {
      const err = new Error(`Monto inválido para centavos: ${amountCents}. Debe ser un número finito.`);
      err.code = 'INVALID_MONETARY_VALUE';
      throw err;
    }

    if (!Number.isInteger(amountCents)) {
      const err = new Error(`El valor interno de dinero debe ser un número entero de centavos. Recibido: ${amountCents}.`);
      err.code = 'FLOAT_VALUE_NOT_ALLOWED';
      throw err;
    }

    this._amountCents = amountCents;
    this._currency = curr;
    Object.freeze(this);
  }

  get amountCents() {
    return this._amountCents;
  }

  get currency() {
    return this._currency;
  }

  /**
   * Instantiates Money from integer cents.
   */
  static fromCents(cents, currency = 'DOP') {
    return new Money(cents, currency);
  }

  /**
   * Instantiates Money from a decimal string or decimal number (e.g. "150.25", 150.25).
   * Strictly validates that precision does not exceed 2 decimal places.
   */
  static fromDecimal(decimalVal, currency = 'DOP') {
    if (decimalVal === null || decimalVal === undefined || decimalVal === '') {
      return new Money(0, currency);
    }

    if (typeof decimalVal === 'string') {
      const clean = decimalVal.trim().replace(/,/g, '');
      if (!/^-?\d+(?:\.\d+)?$/.test(clean)) {
        const err = new Error(`Formato decimal inválido: "${decimalVal}".`);
        err.code = 'INVALID_DECIMAL_FORMAT';
        throw err;
      }
      const parts = clean.split('.');
      if (parts.length === 2 && parts[1].length > 2) {
        const err = new Error(`Precisión decimal no permitida: "${decimalVal}" contiene más de 2 cifras decimales.`);
        err.code = 'EXCESS_DECIMAL_PRECISION';
        throw err;
      }
      const num = parseFloat(clean);
      const cents = Math.round(num * 100);
      return new Money(cents, currency);
    }

    if (typeof decimalVal === 'number') {
      if (isNaN(decimalVal) || !isFinite(decimalVal)) {
        const err = new Error(`Valor decimal inválido: ${decimalVal}.`);
        err.code = 'INVALID_DECIMAL_FORMAT';
        throw err;
      }
      // Check if more than 2 decimal places are present
      const str = decimalVal.toString();
      const parts = str.split('.');
      if (parts.length === 2 && parts[1].length > 2) {
        // Floating point representation check:
        // Round to 4 decimals to avoid IEEE-754 noise, then check if 3rd digit is significant
        const normalized = Math.round(decimalVal * 10000) / 10000;
        const normStr = normalized.toString();
        const normParts = normStr.split('.');
        if (normParts.length === 2 && normParts[1].length > 2) {
          const err = new Error(`Precisión decimal no permitida: ${decimalVal} contiene más de 2 cifras decimales.`);
          err.code = 'EXCESS_DECIMAL_PRECISION';
          throw err;
        }
      }
      const cents = Math.round(decimalVal * 100);
      return new Money(cents, currency);
    }

    const err = new Error(`Tipo de dato no admitido para crear Money: ${typeof decimalVal}.`);
    err.code = 'INVALID_MONETARY_TYPE';
    throw err;
  }

  static zero(currency = 'DOP') {
    return new Money(0, currency);
  }

  _assertSameCurrency(other) {
    if (!(other instanceof Money)) {
      const err = new Error('Operación monetaria requiere otra instancia de Money.');
      err.code = 'INVALID_OPERAND';
      throw err;
    }
    if (this._currency !== other._currency) {
      const err = new Error(`Discrepancia de monedas: No es posible operar ${this._currency} con ${other._currency}.`);
      err.code = 'CURRENCY_MISMATCH';
      throw err;
    }
  }

  add(other) {
    this._assertSameCurrency(other);
    return new Money(this._amountCents + other._amountCents, this._currency);
  }

  subtract(other) {
    this._assertSameCurrency(other);
    return new Money(this._amountCents - other._amountCents, this._currency);
  }

  /**
   * Multiplies money by a factor with explicit rounding.
   */
  multiply(factor, rounding = 'half_up') {
    if (typeof factor !== 'number' || isNaN(factor) || !isFinite(factor)) {
      const err = new Error(`Factor de multiplicación inválido: ${factor}.`);
      err.code = 'INVALID_FACTOR';
      throw err;
    }
    const raw = this._amountCents * factor;
    const rounded = rounding === 'half_even' ? this._roundHalfEven(raw) : Math.round(raw);
    return new Money(rounded, this._currency);
  }

  /**
   * Divides money by a divisor with explicit rounding.
   */
  divide(divisor, rounding = 'half_up') {
    if (typeof divisor !== 'number' || isNaN(divisor) || !isFinite(divisor) || divisor === 0) {
      const err = new Error(`Divisor inválido o división por cero: ${divisor}.`);
      err.code = 'DIVISION_BY_ZERO';
      throw err;
    }
    const raw = this._amountCents / divisor;
    const rounded = rounding === 'half_even' ? this._roundHalfEven(raw) : Math.round(raw);
    return new Money(rounded, this._currency);
  }

  /**
   * Calculates a percentage using basis points (1% = 100 bps; 18% = 1800 bps)
   * or a decimal percent (18).
   */
  percentage(percentOrBps, isBasisPoints = false, rounding = 'half_up') {
    const bps = isBasisPoints ? percentOrBps : Math.round(percentOrBps * 100);
    const raw = (this._amountCents * bps) / 10000;
    const rounded = rounding === 'half_even' ? this._roundHalfEven(raw) : Math.round(raw);
    return new Money(rounded, this._currency);
  }

  /**
   * Apportions money across a list of ratios without losing or creating a single cent.
   * Remainder cents are distributed to the components with largest fractional remainders.
   */
  allocate(ratios) {
    if (!Array.isArray(ratios) || ratios.length === 0) {
      throw new Error('allocate requiere un array no vacío de ratios.');
    }
    const totalRatio = ratios.reduce((acc, r) => acc + r, 0);
    if (totalRatio <= 0) {
      throw new Error('La suma de ratios debe ser estrictamente positiva.');
    }

    let remainder = this._amountCents;
    const results = [];
    const fractionalParts = [];

    for (let i = 0; i < ratios.length; i++) {
      const raw = (this._amountCents * ratios[i]) / totalRatio;
      const floorVal = Math.floor(raw);
      results.push(floorVal);
      fractionalParts.push({ index: i, frac: raw - floorVal });
      remainder -= floorVal;
    }

    // Distribute remainder 1 cent at a time to highest fractional components
    fractionalParts.sort((a, b) => b.frac - a.frac);
    for (let i = 0; i < remainder; i++) {
      results[fractionalParts[i].index]++;
    }

    return results.map(c => new Money(c, this._currency));
  }

  _roundHalfEven(num) {
    const floor = Math.floor(num);
    const diff = num - floor;
    if (diff === 0.5) {
      return (floor % 2 === 0) ? floor : floor + 1;
    }
    return Math.round(num);
  }

  assertNonNegative(context = 'Monto monetario') {
    if (this._amountCents < 0) {
      const err = new Error(`${context} no puede ser negativo: ${this.toDecimal()} ${this._currency}.`);
      err.code = 'NEGATIVE_AMOUNT_NOT_ALLOWED';
      throw err;
    }
    return this;
  }

  equals(other) {
    if (!(other instanceof Money)) return false;
    return this._amountCents === other._amountCents && this._currency === other._currency;
  }

  greaterThan(other) {
    this._assertSameCurrency(other);
    return this._amountCents > other._amountCents;
  }

  lessThan(other) {
    this._assertSameCurrency(other);
    return this._amountCents < other._amountCents;
  }

  isZero() {
    return this._amountCents === 0;
  }

  isPositive() {
    return this._amountCents > 0;
  }

  isNegative() {
    return this._amountCents < 0;
  }

  /**
   * Returns exact decimal string with 2 decimal places (e.g. "1250.50").
   */
  toDecimal() {
    return (this._amountCents / 100).toFixed(2);
  }

  /**
   * Returns numeric float for JSON responses where existing contracts expect a number.
   */
  toNumber() {
    return this._amountCents / 100;
  }

  /**
   * Formats into human readable currency string with prefix and thousands separator.
   */
  toFormatted() {
    const sign = this._amountCents < 0 ? '-' : '';
    const absCents = Math.abs(this._amountCents);
    const integerPart = Math.floor(absCents / 100).toLocaleString('en-US');
    const decimalPart = String(absCents % 100).padStart(2, '0');
    const prefix = this._currency === 'DOP' ? 'RD$ ' : '$ ';
    return `${sign}${prefix}${integerPart}.${decimalPart}`;
  }

  toJSON() {
    return {
      cents: this._amountCents,
      currency: this._currency,
      decimal: this.toDecimal(),
      formatted: this.toFormatted()
    };
  }

  toString() {
    return `${this.toDecimal()} ${this._currency}`;
  }
}

module.exports = {
  Money,
  SUPPORTED_CURRENCIES
};

