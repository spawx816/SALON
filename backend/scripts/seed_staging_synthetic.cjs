/**
 * Synthetic Staging Fixture Seeder (Fase 3B.1)
 * 
 * Generates 100% synthetic QA fixtures for Staging:
 * - 1 SuperAdmin (Platform Control Plane)
 * - Tenant A (Plan PRO, Indigo Theme, Multi-branch capable)
 * - Tenant B (Plan BASE, Emerald Theme, Single branch)
 * - 1 Owner for each Tenant
 * - Distinct visual branding & receipt settings
 * - Minimal operational entities (Branch, Salon, Services, Cash Register, Synthetic Client)
 * 
 * Rules:
 * - High-entropy random passwords (bcrypt-hashed)
 * - NO real PII (names, cédulas, emails, phones are strictly fictional)
 * - ZERO restoration of legacy historical backups
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

async function seedStaging() {
  const connectionString = process.env.DATABASE_URL || {
    host: process.env.DB_HOST || 'salonpro_db',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'salon_saas_staging_user',
    password: process.env.DB_PASS,
    database: process.env.DB_NAME || 'salon_saas_staging'
  };

  const pool = new Pool(typeof connectionString === 'string' ? { connectionString } : connectionString);
  const client = await pool.connect();

  console.log('🌱 [STAGING SEED] Conectado a base de datos:', process.env.DB_NAME || 'salon_saas_staging');

  try {
    await client.query('BEGIN');

    // 1. Generate High-Entropy Cryptographic Passwords
    const superAdminPassword = 'SA_' + crypto.randomBytes(16).toString('base64url') + '!9a';
    const ownerAPassword = 'OA_' + crypto.randomBytes(16).toString('base64url') + '!8b';
    const ownerBPassword = 'OB_' + crypto.randomBytes(16).toString('base64url') + '!7c';
    const pinA = '849201';
    const pinB = '715934';

    const saltRounds = 10;
    const superAdminHash = await bcrypt.hash(superAdminPassword, saltRounds);
    const ownerAHash = await bcrypt.hash(ownerAPassword, saltRounds);
    const ownerBHash = await bcrypt.hash(ownerBPassword, saltRounds);
    const pinAHash = await bcrypt.hash(pinA, saltRounds);
    const pinBHash = await bcrypt.hash(pinB, saltRounds);

    // 2. Insert SuperAdmin (Global Control Plane, tenant_id IS NULL)
    const superAdminId = crypto.randomUUID();
    const superAdminEmail = 'superadmin.synth@etereasapp.internal';
    await client.query(`
      INSERT INTO users (id, tenant_id, name, nombre, email, password_hash, role, is_active, token_version)
      VALUES ($1, NULL, $2, $2, $3, $4, 'superadmin', true, 1)
      ON CONFLICT DO NOTHING
    `, [superAdminId, 'SuperAdmin Sintetico', superAdminEmail, superAdminHash]);

    // 3. Create Tenant A (PRO)
    const branchAId = crypto.randomUUID();
    const salonAId = 'salon-alpha-staging';
    const ownerAId = crypto.randomUUID();
    const ownerAEmail = 'owner.alpha@etereasapp.internal';

    const resTenantA = await client.query(`
      INSERT INTO tenants (
        id, business_name, legal_name, rnc, slug, status, email, phone,
        country, currency, primary_color, secondary_color, plan_id, max_users, max_branches
      ) VALUES (
        $1, 'Salon Staging Alpha', 'Staging Alpha SAS', '131000001', 'staging-alpha', 'active',
        $2, '8095550101', 'DO', 'DOP', '#4f46e5', '#818cf8', 2, 25, 10
      ) ON CONFLICT (slug) DO UPDATE SET
        business_name = EXCLUDED.business_name,
        updated_at = NOW()
      RETURNING id
    `, [crypto.randomUUID(), ownerAEmail]);
    const tenantAId = resTenantA.rows[0].id;

    // Branding Tenant A
    await client.query(`
      INSERT INTO tenant_branding (
        tenant_id, business_name, primary_color, secondary_color, accent_color,
        background_color, surface_color, text_color, receipt_header, receipt_footer
      ) VALUES (
        $1, 'Salon Staging Alpha', '#4f46e5', '#818cf8', '#6366f1',
        '#f8fafc', '#ffffff', '#0f172a', '*** SALON STAGING ALPHA ***', '¡Gracias por preferirnos! ♡'
      ) ON CONFLICT (tenant_id) DO UPDATE SET
        business_name = EXCLUDED.business_name,
        primary_color = EXCLUDED.primary_color,
        secondary_color = EXCLUDED.secondary_color
    `, [tenantAId]);

    // Subscription Tenant A (PRO)
    await client.query(`
      INSERT INTO tenant_subscriptions (
        tenant_id, saas_plan_id, status, plan_code, currency, billing_cycle,
        current_period_start, current_period_end
      ) VALUES (
        $1, 2, 'active', 'PRO', 'DOP', 'monthly',
        NOW(), NOW() + INTERVAL '30 days'
      ) ON CONFLICT (tenant_id) DO NOTHING
    `, [tenantAId]);

    // Branch & Salon Tenant A
    await client.query(`
      INSERT INTO branches (id, tenant_id, name, address, phone, is_active)
      VALUES ($1, $2, 'Sucursal Alpha Principal', 'Calle Ficticia 101, Santo Domingo', '8095550101', true)
      ON CONFLICT DO NOTHING
    `, [branchAId, tenantAId]);

    await client.query(`
      INSERT INTO salons (id, tenant_id, name, nombre, address, direccion, phone, telefono, status)
      VALUES ($1, $2, 'Salon Alpha', 'Salon Alpha', 'Calle Ficticia 101, Santo Domingo', 'Calle Ficticia 101, Santo Domingo', '8095550101', '8095550101', 'Active')
      ON CONFLICT DO NOTHING
    `, [salonAId, tenantAId]);

    // Owner User Tenant A
    await client.query(`
      INSERT INTO users (
        id, tenant_id, branch_id, name, nombre, email, password_hash, role,
        admin_pin, is_active, token_version
      ) VALUES (
        $1, $2, $3, 'Propietaria Alpha', 'Propietaria Alpha', $4, $5, 'owner',
        $6, true, 1
      ) ON CONFLICT (tenant_id, email) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        admin_pin = EXCLUDED.admin_pin,
        is_active = true
    `, [ownerAId, tenantAId, branchAId, ownerAEmail, ownerAHash, pinAHash]);

    // Cash Register A
    const cashRegAId = crypto.randomUUID();
    await client.query(`
      INSERT INTO cash_registers (id, tenant_id, branch_id, name, status, salon_id)
      VALUES ($1, $2, $3, 'Caja Principal Alpha', 'active', $4)
      ON CONFLICT DO NOTHING
    `, [cashRegAId, tenantAId, branchAId, salonAId]);

    // Services Tenant A
    await client.query(`
      INSERT INTO services (id, tenant_id, name, nombre, price, precio, duration_minutes, is_active)
      VALUES 
        ($1, $2, 'Lavado y Secado Pro', 'Lavado y Secado Pro', 650.00, 650.00, 45, true),
        ($3, $2, 'Corte Estilo Alpha', 'Corte Estilo Alpha', 800.00, 800.00, 30, true),
        ($4, $2, 'Tratamiento Hidratante', 'Tratamiento Hidratante', 1200.00, 1200.00, 60, true)
      ON CONFLICT DO NOTHING
    `, [crypto.randomUUID(), tenantAId, crypto.randomUUID(), crypto.randomUUID()]);

    // Client Tenant A
    const clientAId = crypto.randomUUID();
    await client.query(`
      INSERT INTO clients (id, tenant_id, branch_id, name, nombre, email, phone, telefono, cedula, status)
      VALUES ($1, $2, $3, 'Clienta Sintetica Alpha', 'Clienta Sintetica Alpha', 'clienta.alpha@etereasapp.internal', '8095550111', '8095550111', '00100000001', 'active')
      ON CONFLICT DO NOTHING
    `, [clientAId, tenantAId, branchAId]);


    // 4. Create Tenant B (BASE)
    const branchBId = crypto.randomUUID();
    const salonBId = 'salon-beta-staging';
    const ownerBId = crypto.randomUUID();
    const ownerBEmail = 'owner.beta@etereasapp.internal';

    const resTenantB = await client.query(`
      INSERT INTO tenants (
        id, business_name, legal_name, rnc, slug, status, email, phone,
        country, currency, primary_color, secondary_color, plan_id, max_users, max_branches
      ) VALUES (
        $1, 'Salon Staging Beta', 'Staging Beta SRL', '131000002', 'staging-beta', 'active',
        $2, '8095550202', 'DO', 'DOP', '#059669', '#34d399', 1, 5, 1
      ) ON CONFLICT (slug) DO UPDATE SET
        business_name = EXCLUDED.business_name,
        updated_at = NOW()
      RETURNING id
    `, [crypto.randomUUID(), ownerBEmail]);
    const tenantBId = resTenantB.rows[0].id;

    // Branding Tenant B
    await client.query(`
      INSERT INTO tenant_branding (
        tenant_id, business_name, primary_color, secondary_color, accent_color,
        background_color, surface_color, text_color, receipt_header, receipt_footer
      ) VALUES (
        $1, 'Salon Staging Beta', '#059669', '#34d399', '#10b981',
        '#f8fafc', '#ffffff', '#0f172a', '*** SALON STAGING BETA ***', '¡Gracias por visitarnos! ♡'
      ) ON CONFLICT (tenant_id) DO UPDATE SET
        business_name = EXCLUDED.business_name,
        primary_color = EXCLUDED.primary_color,
        secondary_color = EXCLUDED.secondary_color
    `, [tenantBId]);

    // Subscription Tenant B (BASE)
    await client.query(`
      INSERT INTO tenant_subscriptions (
        tenant_id, saas_plan_id, status, plan_code, currency, billing_cycle,
        current_period_start, current_period_end
      ) VALUES (
        $1, 1, 'active', 'BASE', 'DOP', 'monthly',
        NOW(), NOW() + INTERVAL '30 days'
      ) ON CONFLICT (tenant_id) DO NOTHING
    `, [tenantBId]);

    // Branch & Salon Tenant B
    await client.query(`
      INSERT INTO branches (id, tenant_id, name, address, phone, is_active)
      VALUES ($1, $2, 'Sucursal Beta Centro', 'Avenida Ficticia 202, Santiago', '8095550202', true)
      ON CONFLICT DO NOTHING
    `, [branchBId, tenantBId]);

    await client.query(`
      INSERT INTO salons (id, tenant_id, name, nombre, address, direccion, phone, telefono, status)
      VALUES ($1, $2, 'Salon Beta', 'Salon Beta', 'Avenida Ficticia 202, Santiago', 'Avenida Ficticia 202, Santiago', '8095550202', '8095550202', 'Active')
      ON CONFLICT DO NOTHING
    `, [salonBId, tenantBId]);

    // Owner User Tenant B
    await client.query(`
      INSERT INTO users (
        id, tenant_id, branch_id, name, nombre, email, password_hash, role,
        admin_pin, is_active, token_version
      ) VALUES (
        $1, $2, $3, 'Propietaria Beta', 'Propietaria Beta', $4, $5, 'owner',
        $6, true, 1
      ) ON CONFLICT (tenant_id, email) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        admin_pin = EXCLUDED.admin_pin,
        is_active = true
    `, [ownerBId, tenantBId, branchBId, ownerBEmail, ownerBHash, pinBHash]);

    // Cash Register B
    const cashRegBId = crypto.randomUUID();
    await client.query(`
      INSERT INTO cash_registers (id, tenant_id, branch_id, name, status, salon_id)
      VALUES ($1, $2, $3, 'Caja Principal Beta', 'active', $4)
      ON CONFLICT DO NOTHING
    `, [cashRegBId, tenantBId, branchBId, salonBId]);

    // Services Tenant B
    await client.query(`
      INSERT INTO services (id, tenant_id, name, nombre, price, precio, duration_minutes, is_active)
      VALUES 
        ($1, $2, 'Lavado Basico Beta', 'Lavado Basico Beta', 400.00, 400.00, 30, true),
        ($3, $2, 'Peinado Rapido Beta', 'Peinado Rapido Beta', 500.00, 500.00, 25, true)
      ON CONFLICT DO NOTHING
    `, [crypto.randomUUID(), tenantBId, crypto.randomUUID()]);

    // Client Tenant B
    const clientBId = crypto.randomUUID();
    await client.query(`
      INSERT INTO clients (id, tenant_id, branch_id, name, nombre, email, phone, telefono, cedula, status)
      VALUES ($1, $2, $3, 'Clienta Sintetica Beta', 'Clienta Sintetica Beta', 'clienta.beta@etereasapp.internal', '8095550222', '8095550222', '00100000002', 'active')
      ON CONFLICT DO NOTHING
    `, [clientBId, tenantBId, branchBId]);

    await client.query('COMMIT');
    console.log('✅ [STAGING SEED] Fixtures sintéticos insertados exitosamente.');

    // 5. Store Credentials File outside Git
    const credsPath = process.env.CREDENTIALS_OUTPUT_PATH || '/tmp/staging_credentials.txt';
    const credsContent = [
      '========================================================================',
      '🔐 CREDENCIALES SINTÉTICAS DE ACCESO PARA STAGING (FASE 3B.1)',
      'Fecha: ' + new Date().toISOString(),
      'Ambiente: Staging (https://staging.etereasapp.com)',
      '========================================================================',
      '',
      '--- 1. PLATFORM SUPERADMIN (CONTROL PLANE ONLY) ---',
      'Email: ' + superAdminEmail,
      'Password: ' + superAdminPassword,
      'Rol: superadmin',
      'Alcance: Exclusivo Control Plane SaaS (Bloqueado de datos de salones)',
      '',
      '--- 2. TENANT A (PLAN PRO - TEMA INDIGO) ---',
      'Tenant ID: ' + tenantAId,
      'Slug: staging-alpha',
      'Email: ' + ownerAEmail,
      'Password: ' + ownerAPassword,
      'PIN Supervisor: ' + pinA,
      'Rol: owner',
      '',
      '--- 3. TENANT B (PLAN BASE - TEMA EMERALD) ---',
      'Tenant ID: ' + tenantBId,
      'Slug: staging-beta',
      'Email: ' + ownerBEmail,
      'Password: ' + ownerBPassword,
      'PIN Supervisor: ' + pinB,
      'Rol: owner',
      '',
      '========================================================================',
      '⚠️ Archivo protegido con permisos 0600. No commitear en Git.'
    ].join('\n');

    try {
      fs.writeFileSync(credsPath, credsContent, { mode: 0o600 });
      console.log('🔒 [STAGING SEED] Credenciales guardadas en archivo protegido:', credsPath);
    } catch (fsErr) {
      console.log('⚠️ [STAGING SEED] No se pudo escribir directamente en', credsPath, ':', fsErr.message);
    }

    return {
      success: true,
      superAdminEmail,
      ownerAEmail,
      ownerBEmail,
      tenantAId,
      tenantBId
    };

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ [STAGING SEED ERROR]:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  seedStaging()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { seedStaging };
