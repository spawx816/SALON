const { pool } = require('./db');

async function testAllRoutesQueries() {
  console.log('🧪 Probando queries de todos los módulos...');

  // 1. Clients
  try {
    const [[clients], [contracts], [plans]] = await Promise.all([
      pool.query(`
        SELECT id, nombre, telefono, email, cedula, frecuencia, salon_id, status, registration_source, created_at, calle, numero, sector, ciudad, fecha_nacimiento
        FROM clients 
        ORDER BY nombre ASC
      `),
      pool.query(`
        SELECT id, client_id, plan_id, status, retry_count 
        FROM contracts 
        ORDER BY id ASC
      `),
      pool.query(`SELECT id, title FROM plans`)
    ]);
    console.log(`✅ Clients query OK (${clients.length} clients, ${contracts.length} contracts, ${plans.length} plans)`);
  } catch (err) {
    console.error('❌ Clients query error:', err.message);
  }

  // 2. Services
  try {
    const [services] = await pool.query('SELECT * FROM services ORDER BY orden_visualizacion ASC, nombre ASC');
    console.log(`✅ Services query OK (${services.length} services)`);
  } catch (err) {
    console.error('❌ Services query error:', err.message);
  }

  // 3. Salons
  try {
    const [salons] = await pool.query('SELECT id, name, nombre, address, direccion, phone, telefono FROM salons ORDER BY id ASC');
    console.log(`✅ Salons query OK (${salons.length} salons)`);
  } catch (err) {
    console.error('❌ Salons query error:', err.message);
  }

  // 4. Employees / Staff
  try {
    const [staff] = await pool.query(`
      SELECT 
        id, 
        nombre, 
        posicion as rol, 
        status,
        profile_photo,
        hora_entrada,
        hora_salida,
        dias_laborables,
        tolerancia_minutos,
        salon_id,
        email
      FROM staff_records 
      WHERE status = 'Activo' OR status = 'Active'
      ORDER BY nombre ASC
    `);
    console.log(`✅ Staff query OK (${staff.length} staff records)`);
  } catch (err) {
    console.error('❌ Staff query error:', err.message);
  }

  // 5. Visits Pending
  try {
    const [visits] = await pool.query(`
      SELECT v.*, COALESCE(s.name, 'Sucursal San Vicente de Paúl') as salon_name 
      FROM visits v 
      LEFT JOIN salons s ON v.salon_id = s.id 
      WHERE v.status = 'Pendiente'
      AND (v.salon_id = 1 OR v.salon_id IS NULL) 
      ORDER BY v.visited_at ASC
    `);
    console.log(`✅ Pending visits query OK (${visits.length} pending visits)`);
  } catch (err) {
    console.error('❌ Visits query error:', err.message);
  }

  // 6. Cash Registers Open
  try {
    const [registers] = await pool.query(`
      SELECT cr.*, COALESCE(s.name, 'Sucursal San Vicente de Paúl') as salon_name 
      FROM cash_registers cr 
      LEFT JOIN salons s ON cr.salon_id = s.id 
      WHERE cr.salon_id = 1 AND cr.status = 'Abierta' 
      ORDER BY cr.opened_at DESC LIMIT 1
    `);
    console.log(`✅ Cash registers query OK (${registers.length} open registers)`);
  } catch (err) {
    console.error('❌ Cash registers query error:', err.message);
  }

  // 7. Security Requests
  try {
    const [securityReqs] = await pool.query(`
      SELECT 
        id,
        COALESCE(client_name, 'Cliente General') as client_name,
        client_id,
        service_name,
        COALESCE(staff_name, 'Staff Recepción') as staff_name,
        auth_code as active_code,
        type,
        status,
        created_at,
        expires_at
      FROM security_requests
      WHERE status = 'pending' 
        AND (expires_at IS NULL OR expires_at >= NOW())
        AND created_at >= (NOW() - INTERVAL '2 hours')
      ORDER BY created_at DESC
    `);
    console.log(`✅ Security requests query OK (${securityReqs.length} pending requests)`);
  } catch (err) {
    console.error('❌ Security requests query error:', err.message);
  }

  process.exit(0);
}

testAllRoutesQueries();
