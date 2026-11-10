const { pool } = require('./db');

async function migrateCompatibility() {
  console.log('🔄 [MIGRATION] Iniciando parche de compatibilidad unificado PostgreSQL...');
  const client = await pool.rawPool.connect();

  try {
    await client.query('BEGIN');

    // 1. SALONS
    console.log('📦 Actualizando tabla salons...');
    await client.query(`
      ALTER TABLE salons ADD COLUMN IF NOT EXISTS nombre VARCHAR(255);
      ALTER TABLE salons ADD COLUMN IF NOT EXISTS direccion TEXT;
      ALTER TABLE salons ADD COLUMN IF NOT EXISTS telefono VARCHAR(50);
    `);
    await client.query(`
      UPDATE salons SET 
        nombre = COALESCE(nombre, name),
        direccion = COALESCE(direccion, address),
        telefono = COALESCE(telefono, phone)
      WHERE nombre IS NULL OR direccion IS NULL OR telefono IS NULL;
    `);

    // Asegurar salón por defecto id = 1
    const salon1 = await client.query('SELECT id FROM salons WHERE id = 1');
    if (salon1.rows.length === 0) {
      await client.query(`
        INSERT INTO salons (id, name, nombre, address, direccion, phone, telefono)
        VALUES (1, 'Abatte Peluquería San Vicente', 'Abatte Peluquería San Vicente', 'Av. San Vicente de Paúl', 'Av. San Vicente de Paúl', '809-555-0100', '809-555-0100')
        ON CONFLICT (id) DO UPDATE SET
          nombre = EXCLUDED.nombre,
          direccion = EXCLUDED.direccion,
          telefono = EXCLUDED.telefono;
      `);
    }

    // 2. CLIENTS
    console.log('📦 Actualizando tabla clients...');
    await client.query(`
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS nombre VARCHAR(255);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS telefono VARCHAR(50);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS cedula VARCHAR(50);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS calle VARCHAR(255);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS numero VARCHAR(50);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS sector VARCHAR(255);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS ciudad VARCHAR(255);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS frecuencia VARCHAR(50) DEFAULT 'Mensual';
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS salon_id INT DEFAULT 1;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS cardnet_customer_id VARCHAR(50);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS registration_source VARCHAR(50) DEFAULT 'Directo';
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS password VARCHAR(255);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS must_change_password SMALLINT DEFAULT 0;
    `);
    await client.query(`
      UPDATE clients SET
        nombre = COALESCE(nombre, name),
        telefono = COALESCE(telefono, phone),
        cedula = COALESCE(cedula, cedula_rnc),
        fecha_nacimiento = COALESCE(fecha_nacimiento, birthday)
      WHERE nombre IS NULL OR telefono IS NULL;
    `);

    // 3. SERVICES
    console.log('📦 Actualizando tabla services...');
    await client.query(`
      ALTER TABLE services ADD COLUMN IF NOT EXISTS nombre VARCHAR(255);
      ALTER TABLE services ADD COLUMN IF NOT EXISTS descripcion TEXT;
      ALTER TABLE services ADD COLUMN IF NOT EXISTS categoria VARCHAR(100) DEFAULT 'General';
      ALTER TABLE services ADD COLUMN IF NOT EXISTS precio NUMERIC(12,2);
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
        activo = CASE WHEN is_active IS FALSE THEN 0 ELSE 1 END,
        comision_valor = COALESCE(commission_percentage, 15.00)
      WHERE nombre IS NULL OR precio IS NULL;
    `);

    // Catálogo base de servicios si está vacío
    const svcCount = await client.query('SELECT COUNT(*) as count FROM services');
    if (parseInt(svcCount.rows[0].count) === 0) {
      console.log('📦 Inicializando catálogo base de servicios...');
      await client.query(`
        INSERT INTO services (name, nombre, category_id, categoria, price, precio, activo, genera_comision, tipo_comision, comision_valor, orden_visualizacion)
        VALUES 
          ('Lavado y Secado', 'Lavado y Secado', NULL, 'Peluquería', 600.00, 600.00, 1, 1, 'Porcentaje', 15.00, 1),
          ('Corte de Pelo Dama', 'Corte de Pelo Dama', NULL, 'Peluquería', 800.00, 800.00, 1, 1, 'Porcentaje', 20.00, 2),
          ('Tinte Completo', 'Tinte Completo', NULL, 'Coloración', 2200.00, 2200.00, 1, 1, 'Porcentaje', 20.00, 3),
          ('Tratamiento Penetratti', 'Tratamiento Penetratti', NULL, 'Tratamientos', 1500.00, 1500.00, 1, 1, 'Porcentaje', 15.00, 4),
          ('Manicura Rusa', 'Manicura Rusa', NULL, 'Uñas', 650.00, 650.00, 1, 1, 'Porcentaje', 30.00, 5),
          ('Pedicura Spa', 'Pedicura Spa', NULL, 'Uñas', 850.00, 850.00, 1, 1, 'Porcentaje', 30.00, 6);
      `);
    }

    // 4. CASH REGISTERS
    console.log('📦 Actualizando tabla cash_registers...');
    await client.query(`
      ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS salon_id INT DEFAULT 1;
      ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS opened_by_name VARCHAR(255);
      ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS closed_by_name VARCHAR(255);
      ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS monto_inicial NUMERIC(12,2) DEFAULT 0.00;
      ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS monto_final NUMERIC(12,2);
      ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS observaciones TEXT;
      ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS opened_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
    `);

    // 5. CASH REGISTER MOVEMENTS
    console.log('📦 Creando/verificando tabla cash_register_movements...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS cash_register_movements (
        id SERIAL PRIMARY KEY,
        cash_register_id VARCHAR(100) NOT NULL,
        type VARCHAR(50) NOT NULL,
        payment_method VARCHAR(100) DEFAULT 'Efectivo',
        amount NUMERIC(12,2) NOT NULL,
        concept TEXT,
        user_name VARCHAR(255),
        visit_id VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_crm_register ON cash_register_movements(cash_register_id);
    `);

    // 6. PLANS (Legacy / Membership Plans compatibility)
    console.log('📦 Creando/verificando tabla plans...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS plans (
        id VARCHAR(50) PRIMARY KEY,
        title VARCHAR(100) NOT NULL,
        price NUMERIC(12,2) NOT NULL,
        activation_fee NUMERIC(12,2) DEFAULT 0.00,
        discount NUMERIC(12,2) DEFAULT 0.00,
        color VARCHAR(30) DEFAULT 'blue',
        location VARCHAR(100) DEFAULT 'Abatte Peluquería San Vicente',
        services JSONB DEFAULT '[]'::jsonb,
        promo_services JSONB DEFAULT '[]'::jsonb,
        promo_duration_months INT DEFAULT 0,
        usage_limits JSONB DEFAULT '{"visits": 4, "services": "Ilimitados"}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      INSERT INTO plans (id, title, price, activation_fee, discount, color, location, services, promo_services, promo_duration_months, usage_limits)
      VALUES 
        ('silver', 'PLAN SILVER', 1500.00, 500.00, 0, 'blue', 'Abatte Peluquería San Vicente', '["Lavado y Secado", "Tratamiento Profundo"]'::jsonb, '["Corte de Puntas"]'::jsonb, 1, '{"visits": 4, "services": "Ilimitados"}'::jsonb),
        ('gold', 'PLAN GOLD', 2500.00, 500.00, 0, 'amber', 'Abatte Peluquería San Vicente', '["Lavado y Secado", "Manicura Simple", "Pedicura Simple"]'::jsonb, '["Tinte Completo"]'::jsonb, 1, '{"visits": 6, "services": "Ilimitados"}'::jsonb),
        ('black', 'PLAN BLACK', 4500.00, 500.00, 0, 'slate', 'Abatte Peluquería San Vicente', '["Lavado y Secado", "Manicura SPA", "Pedicura SPA", "Masaje Relajante"]'::jsonb, '["Balayage"]'::jsonb, 1, '{"visits": 8, "services": "Ilimitados"}'::jsonb)
      ON CONFLICT (id) DO NOTHING;
    `);

    // 7. CONTRACTS
    console.log('📦 Creando/verificando tabla contracts...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS contracts (
        id VARCHAR(100) PRIMARY KEY,
        client_id VARCHAR(100),
        plan_id VARCHAR(50),
        signed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        signature_data TEXT,
        status VARCHAR(50) DEFAULT 'Activo',
        card_token VARCHAR(255),
        cardnet_profile_id VARCHAR(50),
        retry_count INT DEFAULT 0,
        contract_price NUMERIC(12,2),
        effective_price NUMERIC(12,2),
        used_washes_this_cycle INT DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_contracts_client ON contracts(client_id);
    `);

    // 8. VISITS
    console.log('📦 Creando/verificando tabla visits...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS visits (
        id VARCHAR(100) PRIMARY KEY,
        client_id VARCHAR(100),
        client_name VARCHAR(255),
        servicios JSONB DEFAULT '[]'::jsonb,
        empleado_peluquera VARCHAR(255),
        empleado_manicurista VARCHAR(255),
        proxima_fecha DATE,
        recordatorio_auto SMALLINT DEFAULT 0,
        total NUMERIC(12,2) DEFAULT 0.00,
        subtotal NUMERIC(12,2) DEFAULT 0.00,
        descuento NUMERIC(12,2) DEFAULT 0.00,
        itbis NUMERIC(12,2) DEFAULT 0.00,
        status VARCHAR(50) DEFAULT 'Pendiente',
        metodo_pago VARCHAR(100),
        ticket_number VARCHAR(50),
        salon_id INT DEFAULT 1,
        cash_register_id VARCHAR(100),
        nota TEXT,
        ncf VARCHAR(50),
        ncf_type VARCHAR(20),
        void_reason TEXT,
        voided_by VARCHAR(255),
        voided_at TIMESTAMP WITH TIME ZONE,
        visited_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_visits_salon ON visits(salon_id);
      CREATE INDEX IF NOT EXISTS idx_visits_ticket ON visits(ticket_number);
      CREATE INDEX IF NOT EXISTS idx_visits_visited_at ON visits(visited_at);
    `);

    // 9. STAFF RECORDS
    console.log('📦 Creando/verificando tabla staff_records...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS staff_records (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        cedula VARCHAR(50),
        contacto VARCHAR(50),
        posicion VARCHAR(100) DEFAULT 'Estilista',
        direccion TEXT,
        localidad VARCHAR(255),
        fecha_entrada DATE,
        fecha_salida DATE,
        motivo_salida TEXT,
        status VARCHAR(50) DEFAULT 'Activo',
        profile_photo TEXT,
        hora_entrada TIME DEFAULT '08:00:00',
        hora_salida TIME DEFAULT '18:00:00',
        dias_laborables TEXT DEFAULT 'Lunes a Sábado',
        tolerancia_minutos INT DEFAULT 15,
        salon_id INT DEFAULT 1,
        email VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const staffCount = await client.query('SELECT COUNT(*) as count FROM staff_records');
    if (parseInt(staffCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO staff_records (nombre, cedula, contacto, posicion, status, salon_id)
        VALUES 
          ('Ana Recepcionista', '001-0000001-1', '809-555-0101', 'Recepción', 'Activo', 1),
          ('Carmen Estilista', '001-0000002-2', '809-555-0102', 'Estilista Master', 'Activo', 1),
          ('Lucía Manicurista', '001-0000003-3', '809-555-0103', 'Técnica de Uñas', 'Activo', 1);
      `);
    }

    // 10. TICKET SEQUENCES
    console.log('📦 Creando/verificando tabla ticket_sequences...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS ticket_sequences (
        id SERIAL PRIMARY KEY,
        salon_id INT UNIQUE NOT NULL,
        prefix VARCHAR(20) DEFAULT 'SD',
        last_sequence INT DEFAULT 0
      );
      INSERT INTO ticket_sequences (salon_id, prefix, last_sequence)
      VALUES (1, 'SD', 100)
      ON CONFLICT (salon_id) DO NOTHING;
    `);

    // 11. COMMISSION SCHEMES & EMPLOYEE COMMISSIONS LOG
    console.log('📦 Creando/verificando tablas de comisiones...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS commission_schemes (
        id SERIAL PRIMARY KEY,
        service_name VARCHAR(255),
        percentage NUMERIC(5,2) DEFAULT 15.00,
        fixed_amount NUMERIC(10,2) DEFAULT 0.00
      );

      CREATE TABLE IF NOT EXISTS employee_commissions_log (
        id SERIAL PRIMARY KEY,
        employee_id INT,
        visit_id VARCHAR(100),
        ticket_number VARCHAR(50),
        service_name VARCHAR(255),
        service_price NUMERIC(12,2),
        commission_rate NUMERIC(5,2),
        commission_amount NUMERIC(12,2),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 12. PAYMENTS
    console.log('📦 Creando/verificando tabla payments...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id VARCHAR(100) PRIMARY KEY,
        client_id VARCHAR(100),
        plan_id VARCHAR(50),
        amount NUMERIC(12,2) NOT NULL,
        method VARCHAR(50) DEFAULT 'Efectivo',
        status VARCHAR(50) DEFAULT 'Aprobado',
        gateway_ref VARCHAR(255),
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 13. SECURITY REQUESTS
    console.log('📦 Verificando tabla security_requests...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS security_requests (
        id SERIAL PRIMARY KEY,
        client_name VARCHAR(255),
        client_id VARCHAR(100),
        service_name VARCHAR(255),
        staff_name VARCHAR(255),
        auth_code VARCHAR(50),
        type VARCHAR(50) DEFAULT 'discount',
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '2 hours')
      );
    `);

    // 14. SYNC CLIENT AND SERVICE TRIGGERS (Auto-sync name <-> nombre, phone <-> telefono)
    console.log('📦 Creando triggers de sincronización bidireccional...');
    await client.query(`
      CREATE OR REPLACE FUNCTION sync_clients_fields()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.nombre IS NOT NULL AND NEW.name IS NULL THEN
          NEW.name := NEW.nombre;
        ELSIF NEW.name IS NOT NULL AND NEW.nombre IS NULL THEN
          NEW.nombre := NEW.name;
        END IF;

        IF NEW.telefono IS NOT NULL AND NEW.phone IS NULL THEN
          NEW.phone := NEW.telefono;
        ELSIF NEW.phone IS NOT NULL AND NEW.telefono IS NULL THEN
          NEW.telefono := NEW.phone;
        END IF;

        IF NEW.cedula IS NOT NULL AND NEW.cedula_rnc IS NULL THEN
          NEW.cedula_rnc := NEW.cedula;
        ELSIF NEW.cedula_rnc IS NOT NULL AND NEW.cedula IS NULL THEN
          NEW.cedula := NEW.cedula_rnc;
        END IF;

        IF NEW.fecha_nacimiento IS NOT NULL AND NEW.birthday IS NULL THEN
          NEW.birthday := NEW.fecha_nacimiento;
        ELSIF NEW.birthday IS NOT NULL AND NEW.fecha_nacimiento IS NULL THEN
          NEW.fecha_nacimiento := NEW.birthday;
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_sync_clients ON clients;
      CREATE TRIGGER trg_sync_clients
      BEFORE INSERT OR UPDATE ON clients
      FOR EACH ROW
      EXECUTE FUNCTION sync_clients_fields();
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION sync_services_fields()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.nombre IS NOT NULL AND NEW.name IS NULL THEN
          NEW.name := NEW.nombre;
        ELSIF NEW.name IS NOT NULL AND NEW.nombre IS NULL THEN
          NEW.nombre := NEW.name;
        END IF;

        IF NEW.precio IS NOT NULL AND NEW.price IS NULL THEN
          NEW.price := NEW.precio;
        ELSIF NEW.price IS NOT NULL AND NEW.precio IS NULL THEN
          NEW.precio := NEW.price;
        END IF;

        IF NEW.descripcion IS NOT NULL AND NEW.description IS NULL THEN
          NEW.description := NEW.descripcion;
        ELSIF NEW.description IS NOT NULL AND NEW.descripcion IS NULL THEN
          NEW.descripcion := NEW.description;
        END IF;

        IF NEW.activo IS NOT NULL THEN
          NEW.is_active := (NEW.activo = 1);
        ELSIF NEW.is_active IS NOT NULL THEN
          NEW.activo := CASE WHEN NEW.is_active THEN 1 ELSE 0 END;
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_sync_services ON services;
      CREATE TRIGGER trg_sync_services
      BEFORE INSERT OR UPDATE ON services
      FOR EACH ROW
      EXECUTE FUNCTION sync_services_fields();
    `);

    await client.query('COMMIT');
    console.log('✅ [MIGRATION] Migración de compatibilidad completada con ÉXITO TOTAL.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ [MIGRATION ERROR]:', err);
    throw err;
  } finally {
    client.release();
    process.exit(0);
  }
}

migrateCompatibility();
