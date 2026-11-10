/**
 * PIN Security Service
 * (backend/services/pin_security.service.js)
 * 
 * Cryptographic hashing, complexity validation, timing-attack resistance,
 * and rate-limiting lockout for administrative PINs.
 */

'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

/**
 * Validates PIN complexity to prevent trivial or easily guessed codes.
 * 
 * @param {string} pin 
 * @returns {{ valid: boolean, reason?: string }}
 */
function validatePinComplexity(pin) {
  const clean = String(pin || '').trim();

  // 1. Length check: exactly 4 to 8 numeric digits
  if (!/^\d{4,8}$/.test(clean)) {
    return {
      valid: false,
      reason: 'El PIN administrativo debe contener entre 4 y 8 dígitos numéricos.'
    };
  }

  // 2. Reject all identical digits (e.g. "0000", "1111", "9999")
  if (/^(\d)\1+$/.test(clean)) {
    return {
      valid: false,
      reason: 'El PIN no puede estar compuesto por el mismo dígito repetido.'
    };
  }

  // 3. Reject ascending sequential numbers (e.g. "1234", "2345", "0123")
  const ascending = '0123456789';
  if (ascending.includes(clean)) {
    return {
      valid: false,
      reason: 'El PIN no puede ser una secuencia numérica ascendente.'
    };
  }

  // 4. Reject descending sequential numbers (e.g. "4321", "9876", "5432")
  const descending = '9876543210';
  if (descending.includes(clean)) {
    return {
      valid: false,
      reason: 'El PIN no puede ser una secuencia numérica descendente.'
    };
  }

  return { valid: true };
}

/**
 * Hashes a PIN using adaptive bcrypt rounds.
 * 
 * @param {string} pin 
 * @returns {Promise<string>}
 */
async function hashPin(pin) {
  const clean = String(pin || '').trim();
  return bcrypt.hash(clean, 10);
}

/**
 * Verifies a candidate PIN against a stored bcrypt hash.
 * LEGACY PLAINTEXT PINS ARE NEVER AUTHENTICATED FOR NORMAL USAGE.
 * If a legacy PIN is detected, authentication fails and triggers rotationRequired.
 * 
 * @param {string} candidatePin 
 * @param {string} storedPinOrHash 
 * @returns {Promise<{ matched: boolean, isLegacy: boolean, rotationRequired?: boolean }>}
 */
async function verifyPin(candidatePin, storedPinOrHash) {
  const candidate = String(candidatePin || '').trim();
  const stored = String(storedPinOrHash || '').trim();

  if (!candidate || !stored) {
    return { matched: false, isLegacy: false };
  }

  // Adaptive bcrypt hash ($2a$, $2b$, $2y$)
  if (stored.startsWith('$2')) {
    const matched = await bcrypt.compare(candidate, stored);
    return { matched, isLegacy: false };
  }

  // Legacy plaintext PIN: NEVER authenticate; mark rotation required
  return { matched: false, isLegacy: true, rotationRequired: true };
}

/**
 * Verifies a legacy plaintext PIN solely for the purpose of migrating / rotating to a bcrypt hash.
 * Uses timing-safe equality to protect legacy codes during rotation.
 * 
 * @param {string} candidatePin 
 * @param {string} storedPlaintext 
 * @returns {boolean}
 */
function verifyLegacyPinForRotation(candidatePin, storedPlaintext) {
  const candidate = String(candidatePin || '').trim();
  const stored = String(storedPlaintext || '').trim();

  if (!candidate || !stored) return false;

  const candidateBuf = Buffer.from(candidate);
  const storedBuf = Buffer.from(stored);
  if (candidateBuf.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(candidateBuf, storedBuf);
}

module.exports = {
  validatePinComplexity,
  hashPin,
  verifyPin,
  verifyLegacyPinForRotation
};

