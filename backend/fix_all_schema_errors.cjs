const { pool } = require('./db');

async function fixAllSchemaErrors() {
  console.log('🚀 [FIX ALL SCHEMA] Ejecutando corrección integral de tipos y columnas...');
  const client = await pool.rawPool.connect();

  try {
    await client.query('BEGIN');

    // ==========================================
    // 1. SALONS Y SUCURSALES (VARCHAR ID)
    // ==========================================
    console.log('1️⃣ Adaptando tabla salons y sincronizando con branches...');
    await client.query(`
      ALTER TABLE salons ALTER COLUMN id TYPE VARCHAR(100) USING id::text;
      ALTER TABLE salons ADD COLUMN IF NOT EXISTS nombre VARCHAR(255);
      ALTER TABLE salons ADD COLUMN IF NOT EXISTS direccion TEXT;
      ALTER TABLE salons ADD COLUMN IF NOT EXISTS telefono VARCHAR(50);
      ALTER TABLE salons ADD COLUMN IF NOT EXISTS maps_url TEXT;
      ALTER TABLE salons ADD COLUMN IF NOT EXISTS tenant_id UUID;
    `);

    // Sincronizar todas las branches de la tabla branches hacia salons
    await client.query(`
      INSERT INTO salons (id, name, nombre, address, direccion, phone, telefono, maps_url, tenant_id)
      SELECT 
        id::text, 
        name, 
        name, 
        address, 
        address, 
        phone, 
        phone, 
        maps_url, 
        tenant_id 
      FROM branches
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        nombre = EXCLUDED.nombre,
        address = EXCLUDED.address,
        direccion = EXCLUDED.direccion,
        phone = EXCLUDED.phone,
        telefono = EXCLUDED.telefono;
    `);

    // Asegurar también salón por defecto id = '1'
    await client.query(`
      INSERT INTO salons (id, name, nombre, address, direccion, phone, telefono)
      VALUES ('1', 'Sede Central Piantini', 'Sede Central Piantini', 'Av. Abraham Lincoln #102', 'Av. Abraham Lincoln #102', '809-555-0199', '809-555-0199')
      ON CONFLICT (id) DO NOTHING;
    `);

    // ==========================================
    // 2. CASH REGISTERS
    // ==========================================
    console.log('2️⃣ Actualizando columnas y tipos en cash_registers...');
    await client.query(`
      ALTER TABLE cash_registers ALTER COLUMN salon_id TYPE VARCHAR(100) USING salon_id::text;
      ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS register_number VARCHAR(100);
      ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS employee_id VARCHAR(100);
      ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS employee_name VARCHAR(255);
      ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS monto_inicial NUMERIC(12,2) DEFAULT 0.00;
      ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS monto_final NUMERIC(12,2);
      ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS diferencia NUMERIC(12,2) DEFAULT 0.00;
      ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS observaciones TEXT;
      ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS opened_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
    `);

    // ==========================================
    // 3. VISITS
    // ==========================================
    console.log('3️⃣ Actualizando columnas y tipos en visits...');
    await client.query(`
      ALTER TABLE visits ALTER COLUMN salon_id TYPE VARCHAR(100) USING salon_id::text;
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS items_detail JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS monto_recibido NUMERIC(12,2) DEFAULT 0.00;
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS devuelta NUMERIC(12,2) DEFAULT 0.00;
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2) DEFAULT 0.00;
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS descuento NUMERIC(12,2) DEFAULT 0.00;
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS itbis NUMERIC(12,2) DEFAULT 0.00;
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS qr_code_url TEXT;
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS xml_signature TEXT;
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS secuencia_id INT;
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS codigo_seguridad VARCHAR(100);
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS rnc VARCHAR(50);
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS rnc_cliente VARCHAR(50);
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS rzn_soc_cliente VARCHAR(255);
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS employee_consumption NUMERIC(12,2) DEFAULT 0.00;
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS gift_card_redemption NUMERIC(12,2) DEFAULT 0.00;
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS applied_payments JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS void_reason TEXT;
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS voided_by VARCHAR(255);
      ALTER TABLE visits ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP WITH TIME ZONE;
    `);

    // ==========================================
    // 4. TICKET SEQUENCES
    // ==========================================
    console.log('4️⃣ Actualizando tabla ticket_sequences...');
    await client.query(`
      ALTER TABLE ticket_sequences ALTER COLUMN salon_id TYPE VARCHAR(100) USING salon_id::text;
    `);
    // Insertar secuencias para cada salón existente
    await client.query(`
      INSERT INTO ticket_sequences (salon_id, prefix, last_sequence)
      SELECT id, 'SD', 100 FROM salons
      ON CONFLICT (salon_id) DO NOTHING;
    `);

    // ==========================================
    // 5. SERVICES
    // ==========================================
    console.log('5️⃣ Verificando columnas de services...');
    await client.query(`
      ALTER TABLE services ADD COLUMN IF NOT EXISTS nombre VARCHAR(255);
      ALTER TABLE services ADD COLUMN IF NOT EXISTS descripcion TEXT;
      ALTER TABLE services ADD COLUMN IF NOT EXISTS categoria VARCHAR(100) DEFAULT 'General';
      ALTER TABLE services ADD COLUMN IF NOT EXISTS precio NUMERIC(12,2) DEFAULT 0.00;
      ALTER TABLE services ADD COLUMN IF NOT EXISTS activo SMALLINT DEFAULT 1;
      ALTER TABLE services ADD COLUMN IF NOT EXISTS genera_comision SMALLINT DEFAULT 1;
      ALTER TABLE services ADD COLUMN IF NOT EXISTS tipo_comision VARCHAR(50) DEFAULT 'Porcentaje';
      ALTER TABLE services ADD COLUMN IF NOT EXISTS comision_valor NUMERIC(10,2) DEFAULT 15.00;
      ALTER TABLE services ADD COLUMN IF NOT EXISTS aplica_itbis SMALLINT DEFAULT 0;
      ALTER TABLE services ADD COLUMN IF NOT EXISTS orden_visualizacion INT DEFAULT 0;
    `);
    await client.query(`
      UPDATE services SET
        nombre = COALESCE(nombre, name),
        descripcion = COALESCE(descripcion, description),
        precio = COALESCE(precio, price),
        activo = CASE WHEN is_active IS FALSE THEN 0 ELSE 1 END
      WHERE nombre IS NULL OR precio IS NULL;
    `);

    // ==========================================
    // 6. CLIENTS, EMPLOYEES, CONTRACTS, PAYMENTS
    // ==========================================
    console.log('6️⃣ Actualizando salon_id a VARCHAR en clients, staff_records, contracts, payments...');
    await client.query(`
      ALTER TABLE clients ALTER COLUMN salon_id TYPE VARCHAR(100) USING salon_id::text;
      ALTER TABLE staff_records ALTER COLUMN salon_id TYPE VARCHAR(100) USING salon_id::text;
      ALTER TABLE contracts ALTER COLUMN salon_id TYPE VARCHAR(100) USING salon_id::text;
      ALTER TABLE payments ALTER COLUMN salon_id TYPE VARCHAR(100) USING salon_id::text;
    `);

    // ==========================================
    // 7. TABLAS OPERATIVAS ADICIONALES
    // ==========================================
    console.log('7️⃣ Creando tablas operativas de soporte (comisiones, dgii, gift cards)...');
    
    // Reglas de comisiones
    await client.query(`
      CREATE TABLE IF NOT EXISTS commission_scheme_rules (
        id SERIAL PRIMARY KEY,
        scheme_id INT NOT NULL,
        rule_type VARCHAR(50) DEFAULT 'general',
        service_name VARCHAR(255),
        category_name VARCHAR(100),
        porcentaje_comision NUMERIC(5,2) DEFAULT 0.00,
        monto_ajuste NUMERIC(10,2) DEFAULT 0.00,
        operacion VARCHAR(50) DEFAULT 'Restar',
        valor NUMERIC(10,2) DEFAULT 0.00,
        prioridad INT DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_csr_scheme ON commission_scheme_rules(scheme_id);
    `);

    // DGII secuencias y contadores
    await client.query(`
      CREATE TABLE IF NOT EXISTS dgii_ncf_sequences (
        id SERIAL PRIMARY KEY,
        tipo_comprobante VARCHAR(20) NOT NULL,
        nombre_comprobante VARCHAR(100),
        serie VARCHAR(10) DEFAULT 'E',
        secuencia_desde BIGINT DEFAULT 1,
        secuencia_hasta BIGINT DEFAULT 100000,
        secuencia_actual BIGINT DEFAULT 1,
        cantidad_aprobada BIGINT DEFAULT 100000,
        cantidad_usada BIGINT DEFAULT 0,
        fecha_vencimiento DATE,
        estado VARCHAR(20) DEFAULT 'Activo',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS company_ncf_counters (
        id SERIAL PRIMARY KEY,
        tipo_comprobante VARCHAR(20) UNIQUE NOT NULL,
        ultimo_numero BIGINT DEFAULT 0,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Gift Cards y Consumos
    await client.query(`
      CREATE TABLE IF NOT EXISTS gift_cards (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        initial_balance NUMERIC(12,2) NOT NULL,
        current_balance NUMERIC(12,2) NOT NULL,
        client_name VARCHAR(255),
        status VARCHAR(20) DEFAULT 'Activa',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP WITH TIME ZONE
      );

      CREATE TABLE IF NOT EXISTS gift_card_logs (
        id SERIAL PRIMARY KEY,
        gift_card_id INT,
        visit_id VARCHAR(100),
        amount_used NUMERIC(12,2),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS employee_consumptions (
        id SERIAL PRIMARY KEY,
        employee_id INT,
        visit_id VARCHAR(100),
        amount NUMERIC(12,2),
        service_name VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS employee_discounts (
        id SERIAL PRIMARY KEY,
        employee_id INT,
        visit_id VARCHAR(100),
        discount_amount NUMERIC(12,2),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        action VARCHAR(100),
        details TEXT,
        user_name VARCHAR(255),
        ip_address VARCHAR(50),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query('COMMIT');
    console.log('✅ [FIX ALL SCHEMA] ¡Todas las tablas, tipos y columnas corregidos exitosamente en PostgreSQL!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ [FIX ALL SCHEMA ERROR]:', err);
    throw err;
  } finally {
    client.release();
    process.exit(0);
  }
}

fixAllSchemaErrors();
