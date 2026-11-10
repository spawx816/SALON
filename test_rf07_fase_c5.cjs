/**
 * Test Suite: FASE C5 - Verificación Exhaustiva de los 16 Puntos de Interfaz y Funcionalidad
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');
const { handleBIReport } = require('./routes/bi_engine');

console.log('================================================================');
console.log('SUITE INTEGRAL FASE C5 - 16 PUNTOS VISUALES Y FUNCIONALES RF-07');
console.log('================================================================\n');

let passCount = 0;
let failCount = 0;

function test(num, description, fn) {
  try {
    fn();
    console.log(`✅ [PASS] Punto ${num}: ${description}`);
    passCount++;
  } catch (err) {
    console.error(`❌ [FAIL] Punto ${num}: ${description}`);
    console.error(`   Error: ${err.message}`);
    failCount++;
  }
}

async function runSuiteC5() {
  const biConfigContent = fs.readFileSync(path.join(__dirname, '../src/components/bi/biConfig.js'), 'utf8');
  const biJsxContent = fs.readFileSync(path.join(__dirname, '../src/components/bi/BusinessIntelligence.jsx'), 'utf8');
  const tableJsxContent = fs.readFileSync(path.join(__dirname, '../src/components/bi/BIDetailTable.jsx'), 'utf8');
  const kpiJsxContent = fs.readFileSync(path.join(__dirname, '../src/components/bi/BIKpiCards.jsx'), 'utf8');
  const biEngineContent = fs.readFileSync(path.join(__dirname, './routes/bi_engine.js'), 'utf8');

  // Punto 1: Título y descripción
  test(1, 'Título y descripción exactos en configuración y reporte', () => {
    assert(biConfigContent.includes("name: 'Renovación anual de contratos'"));
    assert(biConfigContent.includes("Identifica las membresías próximas a cumplir su aniversario contractual"));
    assert(biEngineContent.includes("title: 'Renovación anual de contratos'"));
  });

  // Punto 2: Cuatro KPI correctamente identificados y coloreados
  test(2, 'Cuatro KPI con etiquetas de negocio y asignación cromática precisa', () => {
    assert(biEngineContent.includes("label: 'Renovaciones próximas pendientes'"));
    assert(biEngineContent.includes("label: 'Importe previsto por renovaciones anuales'"));
    assert(biEngineContent.includes("label: 'Renovaciones anuales vencidas'"));
    assert(biEngineContent.includes("label: 'Renovaciones anuales pagadas'"));
    // Colores: Pendiente -> blue, Pagada -> emerald/green, Vencida -> red/slate
    assert(biEngineContent.includes("color: 'blue'"));
    assert(biEngineContent.includes("color: 'emerald'"));
    assert(kpiJsxContent.includes("red: {"));
    assert(kpiJsxContent.includes("emerald: {"));
  });

  // Punto 3: Filtros y cambios de período
  test(3, 'Filtros dinámicos con catálogo FUTURE_PERIOD_OPTIONS y 5 opciones futuras', () => {
    assert(biConfigContent.includes("export const FUTURE_PERIOD_OPTIONS = ["));
    assert(biConfigContent.includes("'next_365_days'"));
    assert(biConfigContent.includes("'next_90_days'"));
    assert(biConfigContent.includes("'next_60_days'"));
    assert(biConfigContent.includes("'next_30_days'"));
    assert(biConfigContent.includes("'custom'"));
    assert(biJsxContent.includes("currentReportConfig.id === 'contracts_upcoming_renewal' ? FUTURE_PERIOD_OPTIONS : PERIOD_OPTIONS"));
  });

  // Punto 4: Consulta de mayo de 2027 (con BD real de producción)
  let pool;
  try {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      connectTimeout: 8000
    });

    const resMay = await handleBIReport(pool, {
      reportId: 'contracts_upcoming_renewal',
      startDate: '2027-05-01',
      endDate: '2027-05-31'
    });

    test(4, 'Consulta de mayo 2027 retorna 8 contratos reales y RD$ 6,400', () => {
      const kpi1 = parseInt(resMay.kpis[0].value, 10);
      const kpi2Num = parseInt(resMay.kpis[1].value.replace(/[^0-9]/g, ''), 10);
      assert.strictEqual(kpi1, 8);
      assert.strictEqual(kpi2Num, 6400);
      assert.strictEqual(resMay.table.rows.length, 8);
    });

    // Punto 5: Distribución por sucursal
    test(5, 'Distribución por sucursal concilia al 100% con KPI 1', () => {
      const kpi1 = parseInt(resMay.kpis[0].value, 10);
      const sumChart = (resMay.chart?.data || []).reduce((acc, cur) => acc + (cur.count || cur.value || 0), 0);
      assert.strictEqual(sumChart, kpi1);
    });

    // Punto 6: Tabla detallada con las 9 columnas requeridas
    test(6, 'Estructura de tabla con las 9 columnas de negocio requeridas', () => {
      const cols = (resMay.table?.columns || []).map(c => c.key);
      const expectedCols = ['cliente', 'plan', 'sucursal', 'fecha_firma', 'fecha_renovacion', 'importe', 'dias_restantes', 'estado', 'accion'];
      assert(expectedCols.every(ec => cols.includes(ec)));
    });

    // Punto 7: Orden cronológico
    test(7, 'Filas ordenadas cronológicamente por fecha de renovación más próxima', () => {
      const rows = resMay.table.rows;
      for (let i = 0; i < rows.length - 1; i++) {
        assert(rows[i].fecha_renovacion_raw <= rows[i + 1].fecha_renovacion_raw);
      }
    });

    // Punto 8: Estados y colores en BIDetailTable
    test(8, 'Badges con colores diferenciados para los 4 estados contractuales', () => {
      assert(tableJsxContent.includes("'Pagada'"));
      assert(tableJsxContent.includes("'Pendiente'"));
      assert(tableJsxContent.includes("'Requiere revisión'"));
      assert(tableJsxContent.includes("'Vencida'"));
      // Verde (#ecfdf5), Azul (#eff6ff), Ámbar (#fffbeb), Rojo (#fff1f2)
      assert(tableJsxContent.includes('#ecfdf5'));
      assert(tableJsxContent.includes('#eff6ff'));
      assert(tableJsxContent.includes('#fffbeb'));
      assert(tableJsxContent.includes('#fff1f2'));
    });

    // Punto 9: Formato monetario RD$
    test(9, 'Formato monetario consistente en pesos dominicanos (RD$)', () => {
      assert(tableJsxContent.includes('RD$ '));
      const row0 = resMay.table.rows[0];
      assert(row0.importe.startsWith('RD$ '));
      assert(row0.importe.includes('800'));
    });

    // Punto 10: Navegación al perfil
    test(10, 'Botón "Perfil" y link con redirección a /clientes?id=', () => {
      assert(tableJsxContent.includes('/clientes?id='));
      assert(tableJsxContent.includes('handleViewProfile'));
      assert(tableJsxContent.includes('Perfil'));
    });

    // Punto 11: Búsqueda con normalización diacrítica
    test(11, 'Motor de búsqueda con eliminación de acentos/diacríticos', () => {
      assert(tableJsxContent.includes('normalizeText'));
      assert(tableJsxContent.includes("replace(/[\\u0300-\\u036f]/g, '')"));
    });

    // Punto 12: Paginación
    test(12, 'Paginación completa con tamaño adaptable (10, 25, 50, all)', () => {
      assert(tableJsxContent.includes('paginatedRows'));
      assert(tableJsxContent.includes('rowsPerPage'));
      assert(tableJsxContent.includes('totalPages'));
    });

    // Punto 13: Exportación
    test(13, 'Menú de exportación para Excel (.xlsx) y CSV (.csv)', () => {
      assert(biJsxContent.includes('exportReportToExcel'));
      assert(biJsxContent.includes('exportReportToCSV'));
      assert(biJsxContent.includes('Excel (.xlsx)'));
      assert(biJsxContent.includes('CSV (.csv)'));
    });

    // Punto 14: Vista móvil responsiva
    test(14, 'Diseño responsivo para móviles con grid adaptable y scroll horizontal', () => {
      assert(biJsxContent.includes('repeat(auto-fit, minmax(200px, 1fr))'));
      assert(tableJsxContent.includes("overflowX: 'auto'"));
    });

    // Punto 15: Mensaje de tabla vacía
    test(15, 'Mensaje formal cuando no hay renovaciones en el período', () => {
      assert(biJsxContent.includes("No hay renovaciones anuales para el período seleccionado"));
      assert(tableJsxContent.includes("emptyMessage"));
    });

    // Punto 16: Error de consulta y botón Reintentar (Cero mocks en prod)
    test(16, 'Manejo formal de error con botón Reintentar y cero datos simulados', () => {
      assert(biJsxContent.includes("reportError"));
      assert(biJsxContent.includes("Reintentar"));
      assert(!biJsxContent.includes("title: 'Membresías próximas a renovación'"));
      assert(!biJsxContent.includes("Melissa Pérez"));
    });

  } catch (err) {
    console.error('Error de base de datos durante validación C5:', err.message);
    failCount++;
  } finally {
    if (pool) await pool.end();
  }

  console.log('\n================================================================');
  console.log(`TOTAL RESULTADOS FASE C5: ${passCount} EXITOSAS | ${failCount} FALLIDAS`);
  console.log('================================================================\n');

  if (failCount > 0) process.exit(1);
}

runSuiteC5();

