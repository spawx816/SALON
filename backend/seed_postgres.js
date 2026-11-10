const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const REQUIRED_DB_VARS = ['DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME', 'DB_TYPE'];
const missing = REQUIRED_DB_VARS.filter(v => !process.env[v] || String(process.env[v]).trim() === '');
if (missing.length > 0) {
  console.error(`❌ [ERROR FATAL]: Variables de base de datos ausentes: [${missing.join(', ')}]`);
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

async function seedInitialData() {
  console.log('🌱 Iniciando Seed idempotente y seguro en PostgreSQL...');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Planes del SaaS (Plan Base y Plan Pro)
    await client.query(`
      INSERT INTO saas_plans (name, code, price, price_per_branch, users_per_branch, extra_user_price, billing_cycle, max_branches, max_employees, is_public, is_active, description, included_features)
      VALUES 
        ('Plan Base', 'base', 49.00, 49.00, 3, 15.00, 'monthly', 1, 3, TRUE, TRUE, 'Plan operativo de salón: Facturación, POS (Consumidor Final), Catálogo de Productos y Servicios, Cajas Registradoras y Creación de Usuarios. No permite registrar clientes ni suscripciones.', '{"pos": true, "cajas": true, "services_catalog": true, "inventory": true, "payroll": true, "attendance": true, "dgii_ecf": true, "reports": true, "clients": false, "memberships": false}'::jsonb),
        ('Plan Pro', 'pro', 99.00, 99.00, 3, 15.00, 'monthly', 1, 3, TRUE, TRUE, 'Plan completo con Clientes y Suscripciones (Plan Beauty): Incluye todo el Plan Base + Registro de Clientes, Directorio CRM, Membresías Recurrentes, Contratos Digitales, Pagos Automáticos y Gift Cards.', '{"pos": true, "cajas": true, "services_catalog": true, "inventory": true, "payroll": true, "attendance": true, "dgii_ecf": true, "reports": true, "clients": true, "memberships": true}'::jsonb)
      ON CONFLICT (code) DO NOTHING;
    `);
    console.log('✅ Planes SaaS inicializados (idempotente).');

    // 2. SuperAdmin del SaaS:
    // Por directriz estricta de seguridad, el seed NUNCA crea ni restablece cuentas SuperAdmin
    // con contraseñas predefinidas. Se gestionan exclusivamente mediante bootstrap externo.
    console.log('ℹ️ [SEGURIDAD] Cuentas SuperAdmin protegidas contra sobreescritura.');

    // 3. Crear Salón Demo (Tenant) si no existe (idempotente)
    const tenantRes = await client.query(`SELECT id FROM tenants WHERE slug = 'glamour' LIMIT 1`);
    let tenantId;
    if (tenantRes.rows.length === 0) {
      const secureRandomPassword = crypto.randomBytes(24).toString('base64url');
      const demoPassHash = await bcrypt.hash(secureRandomPassword, 10);
      const newTenant = await client.query(`
        INSERT INTO tenants (business_name, legal_name, rnc, slug, status, email, phone, currency, has_memberships, has_dgii_ecf)
        VALUES ('Glamour Beauty Studio', 'Glamour Studio SRL', '131234567', 'glamour', 'active', 'contacto@glamour.com', '809-555-0199', 'DOP', FALSE, FALSE)
        RETURNING id;
      `);
      tenantId = newTenant.rows[0].id;
      console.log('✅ Tenant Demo creado: Glamour Beauty Studio');

      // Crear Sucursal Principal
      const branchRes = await client.query(`
        INSERT INTO branches (tenant_id, name, address, city, phone, is_main, status)
        VALUES ($1, 'Sede Central Piantini', 'Av. Abraham Lincoln #102', 'Santo Domingo', '809-555-0199', TRUE, 'Active')
        RETURNING id;
      `, [tenantId]);
      const branchId = branchRes.rows[0].id;

      // Crear Usuario Inicial de Demostración con hash criptográfico
      await client.query(`
        INSERT INTO users (tenant_id, branch_id, name, email, password_hash, role, is_active)
        VALUES ($1, $2, 'Laura Martínez (Dueña)', 'laura@glamour.com', $3, 'owner', TRUE)
      `, [tenantId, branchId, demoPassHash]);
      console.log('✅ Usuario inicial de salón demo registrado de forma segura.');

      // Crear Categorías y Servicios base para el salón demo
      const catRes = await client.query(`
        INSERT INTO service_categories (tenant_id, name, icon)
        VALUES ($1, 'Peluquería y Peinados', 'scissors')
        RETURNING id;
      `, [tenantId]);
      const catId = catRes.rows[0].id;

      await client.query(`
        INSERT INTO services (tenant_id, category_id, name, description, price, duration_minutes, commission_percentage)
        VALUES 
          ($1, $2, 'Lavado y Secado Regular', 'Lavado con shampoo premium y secado a blower', 600.00, 45, 15.00),
          ($1, $2, 'Corte de Puntas / Estilo', 'Corte personalizado con acabado profesional', 800.00, 30, 20.00),
          ($1, $2, 'Tratamiento de Hidratación Profunda', 'Mascarilla intensiva de argán y keratina', 1200.00, 60, 25.00);
      `, [tenantId, catId]);
      console.log('✅ Catálogo de servicios iniciales creado.');
    } else {
      console.log('ℹ️ Tenant Demo existente preservado sin alteraciones.');
    }

    await client.query('COMMIT');
    console.log('🚀 SEED COMPLETADO SATISFACTORIAMENTE (0 credenciales expuestas)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error en seed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seedInitialData();
