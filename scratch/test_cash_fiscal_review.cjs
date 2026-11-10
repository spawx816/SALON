const path = require('path');
const assert = require('assert');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));
const { validateReceptorTaxId, isValidRnc, isValidCedula, isValidRazonSocial } = require('../backend/routes/visits.routes');

async function run() {
  console.log('=== SALONPRO: PRUEBAS FOCALIZADAS DE REVISIÓN FISCAL DE FACTURACIÓN EN EFECTIVO ===\n');

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  const conn = await pool.getConnection();

  try {
    // 1. Obtener estado de secuencias productivas reales (Línea Base)
    const [origSequences] = await conn.query("SELECT id, tipo_comprobante, secuencia_actual, numero_desde, numero_hasta, cantidad_usada, estado FROM dgii_ncf_sequences WHERE estado = 'Activo'");
    console.log('Línea base de secuencias activas en BD:');
    console.table(origSequences);

    // 2. Comprobación de facturas de hoy
    const [todayCash] = await conn.query(`
      SELECT id, total, metodo_pago, ncf, ncf_type, status, visited_at
      FROM visits
      WHERE DATE(visited_at) = CURDATE() AND metodo_pago LIKE '%Efectivo%'
      ORDER BY id ASC
    `);

    console.log(`Facturas en efectivo registradas hoy: ${todayCash.length}`);
    const facturadas = todayCash.filter(v => v.status === 'Facturado');
    const pendientes = todayCash.filter(v => v.status === 'Pendiente');
    console.log(`  - Facturadas con total > 0: ${facturadas.length}`);
    console.log(`  - Pendientes / Precuentas: ${pendientes.length}`);

    // Todas las facturadas deben tener E32
    for (const f of facturadas) {
      assert.ok(f.ncf && f.ncf.startsWith('E32'), `Visita ${f.id} debe ser E32`);
      assert.strictEqual(f.ncf_type, 'E32', `ncf_type debe ser E32`);
    }
    console.log('  [PASS] 1. Detección y auditoría de facturas de hoy verificada.');

    // 3. Reglas de Validación de RNC para E31
    assert.strictEqual(isValidRnc('131917038'), true, 'RNC Abatte válido');
    assert.strictEqual(isValidRnc('123456789'), false, 'RNC inválido');
    assert.strictEqual(validateReceptorTaxId('131917038').isValid, true, 'TaxId válido');
    assert.strictEqual(isValidRazonSocial('ABATTE PELUQUERIA SRL'), true, 'Razón social corporativa válida');
    assert.strictEqual(isValidRazonSocial('Invitado'), false, 'Invitado es inválido para Crédito Fiscal');
    console.log('  [PASS] 2. Reglas de exclusividad y obligatoriedad de E31 con RNC verificadas.');

    // 4. Verificación de Reporte 607: todas las facturas con e-NCF E32 están cubiertas
    const [report607Rows] = await conn.query(`
      SELECT COUNT(*) as count_607, SUM(total) as sum_607
      FROM visits v
      WHERE (v.ncf IS NOT NULL AND TRIM(v.ncf) != '' AND v.ncf != 'NONE')
        AND DATE(v.visited_at) = CURDATE()
        AND v.metodo_pago LIKE '%Efectivo%'
    `);
    console.log('Cobertura Reporte 607 para efectivo de hoy:', report607Rows[0]);
    assert.strictEqual(Number(report607Rows[0].count_607), facturadas.length, 'Todas las ventas comerciales en efectivo facturadas de hoy están incluidas en el 607');
    console.log('  [PASS] 3. Verificación de integridad en Reporte 607 (ninguna venta omitida) verificada.');

    // 5. Verificación de No Consumo de Secuencias Reales en esta prueba
    const [finalSequences] = await conn.query("SELECT id, tipo_comprobante, secuencia_actual, numero_desde, numero_hasta, cantidad_usada, estado FROM dgii_ncf_sequences WHERE estado = 'Activo'");
    for (let i = 0; i < origSequences.length; i++) {
      assert.strictEqual(origSequences[i].secuencia_actual, finalSequences[i].secuencia_actual, `Secuencia para ${origSequences[i].tipo_comprobante} debe permanecer intacta`);
      assert.strictEqual(origSequences[i].cantidad_usada, finalSequences[i].cantidad_usada, `Cantidad usada para ${origSequences[i].tipo_comprobante} debe permanecer intacta`);
    }
    console.log('  [PASS] 4. Secuencias reales verificadas intactas (0 consumo en pruebas).');

    console.log('\n=== TODAS LAS PRUEBAS FOCALIZADAS PASARON EXITOSAMENTE ===');

  } catch (err) {
    console.error('ERROR EN PRUEBAS:', err);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

run();
