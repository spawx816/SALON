const { pool } = require('./db');

async function testExactUserFlow() {
  const branchUuid = '7f546f61-6410-4002-8198-bce72379d9f9';
  console.log(`🧪 Probando flujo exacto con salon_id=${branchUuid}...`);

  // 1. GET /api/visits/pending?salon_id=...
  try {
    const [pending] = await pool.query(`
      SELECT v.*, COALESCE(s.name, 'Sucursal San Vicente de Paúl') as salon_name 
      FROM visits v 
      LEFT JOIN salons s ON v.salon_id = s.id 
      WHERE v.status = 'Pendiente'
      AND (v.salon_id = ? OR v.salon_id IS NULL) 
      ORDER BY v.visited_at ASC
    `, [branchUuid]);
    console.log(`✅ 1. GET /api/visits/pending OK: ${pending.length} registros`);
  } catch (err) {
    console.error('❌ 1. GET /api/visits/pending ERROR:', err.message);
  }

  // 2. GET /api/cash-registers/active?salon_id=...
  try {
    const [activeReg] = await pool.query(`
      SELECT cr.*, COALESCE(s.name, 'Sucursal San Vicente de Paúl') as salon_name 
      FROM cash_registers cr 
      LEFT JOIN salons s ON cr.salon_id = s.id 
      WHERE cr.salon_id = ? AND cr.status = 'Abierta' 
      ORDER BY cr.opened_at DESC LIMIT 1
    `, [branchUuid]);
    console.log(`✅ 2. GET /api/cash-registers/active OK:`, activeReg.length > 0 ? 'Caja abierta encontrada' : 'Sin caja abierta previa');
  } catch (err) {
    console.error('❌ 2. GET /api/cash-registers/active ERROR:', err.message);
  }

  // 3. GET /api/services/top?salon_id=...
  try {
    const [activeServices] = await pool.query('SELECT * FROM services WHERE activo = 1 ORDER BY orden_visualizacion ASC, nombre ASC');
    let visitsQuery = "SELECT items_detail, servicios FROM visits WHERE (status = 'Facturado' OR status = 'Completado') AND (salon_id = ? OR salon_id IS NULL OR salon_id = '0')";
    const [visits] = await pool.query(visitsQuery, [branchUuid]);
    console.log(`✅ 3. GET /api/services/top OK: ${activeServices.length} servicios, ${visits.length} visitas`);
  } catch (err) {
    console.error('❌ 3. GET /api/services/top ERROR:', err.message);
  }

  // 4. POST /api/cash-registers/open
  try {
    const regNum = `CAJA-SD-TEST-${Date.now().toString().slice(-4)}`;
    const [result] = await pool.query(
      "INSERT INTO cash_registers (register_number, employee_id, employee_name, salon_id, monto_inicial, opened_at, status) VALUES (?, ?, ?, ?, ?, NOW(), 'Abierta')",
      [regNum, 'SYS', 'Cajero', branchUuid, 1000.00]
    );
    console.log('✅ 4. INSERT into cash_registers OK, insertId:', result.insertId);

    const [newReg] = await pool.query(
      `SELECT cr.*, COALESCE(s.name, 'Sucursal San Vicente de Paúl') as salon_name 
       FROM cash_registers cr 
       LEFT JOIN salons s ON cr.salon_id = s.id 
       WHERE cr.id = ?`,
      [result.insertId]
    );
    console.log('✅ 4. SELECT new register OK:', newReg[0]?.id, newReg[0]?.register_number, newReg[0]?.salon_name);
  } catch (err) {
    console.error('❌ 4. POST /api/cash-registers/open ERROR:', err.message);
  }

  process.exit(0);
}

testExactUserFlow();
