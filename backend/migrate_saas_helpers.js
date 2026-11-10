const { pool } = require('./db');

async function migrateHelpers() {
  try {
    console.log('🔄 Creando tablas accesorias en PostgreSQL...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id VARCHAR(100) PRIMARY KEY,
        user_id VARCHAR(100) NOT NULL,
        user_name VARCHAR(150),
        role VARCHAR(50),
        salon_id VARCHAR(100) NULL,
        ip_address VARCHAR(50),
        user_agent TEXT,
        device_info VARCHAR(100),
        is_active INT DEFAULT 1,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Crear vista o tabla salons para retrocompatibilidad inmediata con /api/salons
    await pool.query(`
      CREATE TABLE IF NOT EXISTS salons (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        address TEXT,
        phone VARCHAR(50),
        maps_url TEXT,
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE
      );
    `);

    // Sincronizar un salón con la sucursal de Glamour
    const [existing] = await pool.query('SELECT id FROM salons LIMIT 1');
    if (existing.length === 0) {
      const [tRows] = await pool.query("SELECT id FROM tenants WHERE slug = 'glamour'");
      const tenantId = tRows[0]?.id || null;
      await pool.query(
        "INSERT INTO salons (id, name, address, phone, tenant_id) VALUES (1, 'Glamour Beauty Studio - Sede Central', 'Av. Abraham Lincoln #102', '809-555-0199', ?)",
        [tenantId]
      );
      console.log('✅ Salón de compatibilidad insertado.');
    }

    console.log('✅ Tablas auxiliares listas en PostgreSQL.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error en migrateHelpers:', err.message);
    process.exit(1);
  }
}

migrateHelpers();
