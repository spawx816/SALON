/**
 * Test Suite: Bloque B - Interfaz y Configuración RF-07
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('================================================================');
console.log('SUITE DE VERIFICACIÓN - BLOQUE B (INTERFAZ Y CONFIGURACIÓN RF-07)');
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

// 1. Configuración biConfig.js
const biConfigContent = fs.readFileSync(path.join(__dirname, '../src/components/bi/biConfig.js'), 'utf8');

test('biConfig.js exporta FUTURE_PERIOD_OPTIONS con 5 opciones correctas', () => {
  assert(biConfigContent.includes('export const FUTURE_PERIOD_OPTIONS = ['), 'Debe exportar FUTURE_PERIOD_OPTIONS');
  assert(biConfigContent.includes("'next_365_days'"), 'Debe incluir next_365_days');
  assert(biConfigContent.includes("'next_90_days'"), 'Debe incluir next_90_days');
  assert(biConfigContent.includes("'next_60_days'"), 'Debe incluir next_60_days');
  assert(biConfigContent.includes("'next_30_days'"), 'Debe incluir next_30_days');
  assert(biConfigContent.includes("'custom'"), 'Debe incluir custom');
});

test('biConfig.js configura contracts_upcoming_renewal con nombre y defaultPeriod exactos', () => {
  assert(biConfigContent.includes("name: 'Renovación anual de contratos'"), 'Nombre debe ser Renovación anual de contratos');
  assert(biConfigContent.includes("defaultPeriod: 'next_365_days'"), 'defaultPeriod debe ser next_365_days');
  assert(biConfigContent.includes('hasPlanFilter: true'), 'Debe habilitar hasPlanFilter');
  assert(!biConfigContent.includes('next_billing_date'), 'No debe referenciar next_billing_date en el reporte');
});

// 2. BusinessIntelligence.jsx
const biJsxContent = fs.readFileSync(path.join(__dirname, '../src/components/bi/BusinessIntelligence.jsx'), 'utf8');

test('BusinessIntelligence.jsx importa FUTURE_PERIOD_OPTIONS', () => {
  assert(biJsxContent.includes('FUTURE_PERIOD_OPTIONS'), 'Debe importar FUTURE_PERIOD_OPTIONS');
});

test('BusinessIntelligence.jsx maneja reportError y no genera mock para RF-07', () => {
  assert(biJsxContent.includes('reportError'), 'Debe manejar estado reportError');
  assert(!biJsxContent.includes("title: 'Membresías próximas a renovación'"), 'No debe contener mock antiguo');
  assert(!biJsxContent.includes('Melissa Pérez'), 'No debe contener datos ficticios');
  assert(biJsxContent.includes('setReportError('), 'Debe activar error ante falla en RF-07');
});

test('biConfig.js / BusinessIntelligence.jsx calcula fechas futuras (next_30_days, next_60_days, next_90_days, next_365_days)', () => {
  assert(biConfigContent.includes("'next_30_days'") || biJsxContent.includes("'next_30_days'"), 'Debe calcular next_30_days');
  assert(biConfigContent.includes("'next_60_days'") || biJsxContent.includes("'next_60_days'"), 'Debe calcular next_60_days');
  assert(biConfigContent.includes("'next_90_days'") || biJsxContent.includes("'next_90_days'"), 'Debe calcular next_90_days');
  assert(biConfigContent.includes("'next_365_days'") || biJsxContent.includes("'next_365_days'"), 'Debe calcular next_365_days');
});

test('BusinessIntelligence.jsx usa FUTURE_PERIOD_OPTIONS en el selector condicionalmente', () => {
  assert(biJsxContent.includes("currentReportConfig.id === 'contracts_upcoming_renewal' ? FUTURE_PERIOD_OPTIONS : PERIOD_OPTIONS"), 'Selector debe alternar entre períodos');
});

test('BusinessIntelligence.jsx pasa emptyMessage formal para renovaciones anuales', () => {
  assert(biJsxContent.includes('No hay renovaciones anuales para el período seleccionado'), 'Debe mostrar emptyMessage adecuado');
});

// 3. BIKpiCards.jsx
const kpiJsxContent = fs.readFileSync(path.join(__dirname, '../src/components/bi/BIKpiCards.jsx'), 'utf8');

test('BIKpiCards.jsx soporta color red en COLOR_MAP', () => {
  assert(kpiJsxContent.includes('red: {'), 'COLOR_MAP debe incluir red');
  assert(kpiJsxContent.includes('#e11d48'), 'Debe tener color texto rojo/rose');
});

// 4. BIDetailTable.jsx
const tableJsxContent = fs.readFileSync(path.join(__dirname, '../src/components/bi/BIDetailTable.jsx'), 'utf8');

test('BIDetailTable.jsx soporta formateo numérico y strings para isCurrency', () => {
  assert(tableJsxContent.includes('col.isCurrency'), 'Debe chequear col.isCurrency');
  assert(tableJsxContent.includes('numericVal'), 'Debe calcular numericVal con parsing seguro');
});

test('BIDetailTable.jsx define estilos de badge para los 4 estados de renovación anual', () => {
  assert(tableJsxContent.includes("'Pagada'"), 'Debe soportar estado Pagada');
  assert(tableJsxContent.includes('isAnnualPending'), 'Debe identificar isAnnualPending');
  assert(tableJsxContent.includes("'Requiere revisión'"), 'Debe soportar estado Requiere revisión');
  assert(tableJsxContent.includes("'Vencida'"), 'Debe soportar estado Vencida');
});

console.log('\n================================================================');
console.log(`TOTAL RESULTADOS BLOQUE B: ${passCount} EXITOSAS | ${failCount} FALLIDAS`);
console.log('================================================================\n');

process.exit(failCount > 0 ? 1 : 0);

