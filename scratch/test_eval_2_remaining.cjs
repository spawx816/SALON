const assert = require('assert');
const { evaluateBatchFiscalStatus } = require('../backend/routes/dgii.routes');

console.log('--- TESTING EVALUATE BATCH FISCAL STATUS FOR ALERTA MINIMA = 2 ---');

// Batch with 10 approved, 8 used => 2 remaining => should trigger isAlertaMinima = true
const batch2Remaining = {
  tipo_comprobante: 'E31',
  numero_desde: 'E310000000001',
  numero_hasta: 'E310000000010',
  cantidad_aprobada: 10,
  cantidad_usada: 8,
  alerta_minima: 2,
  estado: 'Activo'
};
const eval2 = evaluateBatchFiscalStatus(batch2Remaining);
console.log('Remaining: 2 -> realDisponibles =', eval2.realDisponibles, 'isAlertaMinima =', eval2.isAlertaMinima);
assert.strictEqual(eval2.realDisponibles, 2);
assert.strictEqual(eval2.isAlertaMinima, true, 'Debe activar alerta cuando quedan 2');

// Batch with 10 approved, 7 used => 3 remaining => should NOT trigger isAlertaMinima (false)
const batch3Remaining = {
  tipo_comprobante: 'E31',
  numero_desde: 'E310000000001',
  numero_hasta: 'E310000000010',
  cantidad_aprobada: 10,
  cantidad_usada: 7,
  alerta_minima: 2,
  estado: 'Activo'
};
const eval3 = evaluateBatchFiscalStatus(batch3Remaining);
console.log('Remaining: 3 -> realDisponibles =', eval3.realDisponibles, 'isAlertaMinima =', eval3.isAlertaMinima);
assert.strictEqual(eval3.realDisponibles, 3);
assert.strictEqual(eval3.isAlertaMinima, false, 'NO debe activar alerta cuando quedan 3');

// Batch with 10 approved, 9 used => 1 remaining => should trigger isAlertaMinima = true
const batch1Remaining = {
  tipo_comprobante: 'E31',
  numero_desde: 'E310000000001',
  numero_hasta: 'E310000000010',
  cantidad_aprobada: 10,
  cantidad_usada: 9,
  alerta_minima: 2,
  estado: 'Activo'
};
const eval1 = evaluateBatchFiscalStatus(batch1Remaining);
console.log('Remaining: 1 -> realDisponibles =', eval1.realDisponibles, 'isAlertaMinima =', eval1.isAlertaMinima);
assert.strictEqual(eval1.realDisponibles, 1);
assert.strictEqual(eval1.isAlertaMinima, true, 'Debe activar alerta cuando queda 1');

console.log('✅ ALL TESTS PASSED: La alerta solo se activa cuando quedan 2 o menos comprobantes!');

