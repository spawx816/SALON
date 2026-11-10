/**
 * Migración Estructural Idempotente: Fase 2A — Modelo Comercial SaaS de Dos Planes (BASE y PRO)
 * y Motor de Autorización por Funcionalidades (Entitlements).
 * 
 * NOTA DE SEGURIDAD:
 * Este archivo define la estructura DDL para cuando se ejecute contra PostgreSQL en entorno aislado.
 * NO debe ejecutarse de forma automática sobre bases operativas.
 */

async function up(conn) {
  console.log('[MIGRATION 20261109_phase2a] Iniciando migración de entitlements...');

  // 1. Asegurar tabla global de características SaaS (saas_features)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS saas_features (
      key VARCHAR(100) PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      description TEXT,
      category VARCHAR(50) NOT NULL DEFAULT 'core',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  // 2. Asegurar catálogo de características canónicas
  const features = [
    ['pos', 'Punto de Venta (POS)', 'Facturación ágil y emisión de pre-cuentas térmicas 60mm/80mm', 'core'],
    ['cash_registers', 'Cajas Registradoras', 'Aperturas, arqueos y cierres de turno de caja', 'core'],
    ['services_catalog', 'Catálogo de Servicios y Productos', 'Definición de precios, categorías y comisiones', 'core'],
    ['commissions', 'Comisiones de Personal', 'Liquidación automática por servicios realizados', 'core'],
    ['payroll', 'Nómina', 'Cálculo de nómina quincenal para colaboradores', 'core'],
    ['attendance', 'Control de Asistencia', 'Quiosco de registro de entrada y salida', 'core'],
    ['expenses', 'Control de Egresos', 'Registro de gastos operativos del salón', 'core'],
    ['dgii_ecf', 'Facturación Fiscal DGII', 'Comprobantes e-CF, secuencias NCF, 606, 607 e IT-1', 'compliance'],
    ['reports', 'Reportes Operativos', 'Reportes de ventas, comisiones y cierre de jornada', 'core'],
    ['security', 'Seguridad y PIN Administrativo', 'Bloqueo de descuentos y autorizaciones de precio', 'security'],
    ['clients', 'Directorio CRM de Clientes', 'Fichas de clientes, historial de visitas y preferencias', 'pro'],
    ['memberships', 'Membresías B2C (Plan Beauty)', 'Gestión de suscripciones mensuales, contratos y validación en POS', 'pro'],
    ['marketing', 'Marketing y Fidelización', 'Encuestas de satisfacción, avisos y Gift Cards', 'pro']
  ];

  for (const [key, name, desc, cat] of features) {
    await conn.query(`
      INSERT INTO saas_features (key, name, description, category)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (key) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        category = EXCLUDED.category;
    `, [key, name, desc, cat]);
  }

  // 3. Asegurar catálogo canónico de dos planes (BASE y PRO)
  await conn.query(`
    INSERT INTO saas_plans (name, code, price, price_per_branch, billing_cycle, users_per_branch, extra_user_price, max_branches, max_employees, is_public, is_active, description)
    VALUES 
      ('Plan Base', 'BASE', 49.00, 49.00, 'monthly', 3, 15.00, 1, 3, TRUE, TRUE, 'POS, facturación DGII, cajas, comisiones y nómina.'),
      ('Plan Pro', 'PRO', 99.00, 99.00, 'monthly', 3, 15.00, 1, 3, TRUE, TRUE, 'Todo lo de Base + CRM de clientes, membresías recurrentes, contratos y marketing.')
    ON CONFLICT (code) DO UPDATE SET
      name = EXCLUDED.name,
      price = EXCLUDED.price,
      price_per_branch = EXCLUDED.price_per_branch,
      users_per_branch = EXCLUDED.users_per_branch,
      extra_user_price = EXCLUDED.extra_user_price,
      description = EXCLUDED.description,
      is_active = TRUE;
  `);

  // Depurar cualquier plan obsoleto que no sea BASE ni PRO
  await conn.query(`
    DELETE FROM saas_plans WHERE code NOT IN ('BASE', 'PRO', 'base', 'pro');
  `);

  // 4. Asegurar tabla de asignación plan-característica (saas_plan_features)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS saas_plan_features (
      plan_code VARCHAR(50) NOT NULL,
      feature_key VARCHAR(100) NOT NULL REFERENCES saas_features(key) ON DELETE CASCADE,
      is_included BOOLEAN NOT NULL DEFAULT TRUE,
      PRIMARY KEY (plan_code, feature_key)
    );
  `);

  const planMappings = [
    // Plan BASE
    ['BASE', 'pos', true],
    ['BASE', 'cash_registers', true],
    ['BASE', 'services_catalog', true],
    ['BASE', 'commissions', true],
    ['BASE', 'payroll', true],
    ['BASE', 'attendance', true],
    ['BASE', 'expenses', true],
    ['BASE', 'dgii_ecf', true],
    ['BASE', 'reports', true],
    ['BASE', 'security', true],
    ['BASE', 'clients', false],
    ['BASE', 'memberships', false],
    ['BASE', 'marketing', false],
    // Plan PRO
    ['PRO', 'pos', true],
    ['PRO', 'cash_registers', true],
    ['PRO', 'services_catalog', true],
    ['PRO', 'commissions', true],
    ['PRO', 'payroll', true],
    ['PRO', 'attendance', true],
    ['PRO', 'expenses', true],
    ['PRO', 'dgii_ecf', true],
    ['PRO', 'reports', true],
    ['PRO', 'security', true],
    ['PRO', 'clients', true],
    ['PRO', 'memberships', true],
    ['PRO', 'marketing', true]
  ];

  for (const [planCode, featureKey, isIncluded] of planMappings) {
    await conn.query(`
      INSERT INTO saas_plan_features (plan_code, feature_key, is_included)
      VALUES ($1, $2, $3)
      ON CONFLICT (plan_code, feature_key) DO UPDATE SET
        is_included = EXCLUDED.is_included;
    `, [planCode, featureKey, isIncluded]);
  }

  // 5. Tabla de Suscripciones Activas por Tenant (tenant_subscriptions)
  // Cumplimiento estricto: tenant_id UUID NOT NULL, FK hacia tenants(id) con ON DELETE CASCADE, índice B-Tree
  await conn.query(`
    CREATE TABLE IF NOT EXISTS tenant_subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      plan_code VARCHAR(50) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      current_period_start TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      current_period_end TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT uq_tenant_subscription UNIQUE (tenant_id)
    );
    ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS plan_code VARCHAR(50);
    ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_tenant_subscription'
      ) THEN
        ALTER TABLE tenant_subscriptions ADD CONSTRAINT uq_tenant_subscription UNIQUE (tenant_id);
      END IF;
    END $$;
  `);

  await conn.query(`
    CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_tenant_id 
    ON tenant_subscriptions (tenant_id);
  `);

  // 6. Tabla de Sobrescrituras Auditables por Tenant (tenant_feature_overrides)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS tenant_feature_overrides (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      feature_key VARCHAR(100) NOT NULL REFERENCES saas_features(key) ON DELETE CASCADE,
      is_enabled BOOLEAN NOT NULL,
      reason TEXT NOT NULL,
      actor_id VARCHAR(100) NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT uq_tenant_feature_override UNIQUE (tenant_id, feature_key)
    );
  `);

  await conn.query(`
    CREATE INDEX IF NOT EXISTS idx_tenant_feature_overrides_tenant_id 
    ON tenant_feature_overrides (tenant_id, feature_key);
  `);

  // 7. Tabla de Historial Inmutable de Cambios de Plan (tenant_subscription_events)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS tenant_subscription_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      previous_plan VARCHAR(50),
      new_plan VARCHAR(50) NOT NULL,
      previous_status VARCHAR(30),
      new_status VARCHAR(30) NOT NULL,
      reason TEXT NOT NULL,
      actor_id VARCHAR(100) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  await conn.query(`
    CREATE INDEX IF NOT EXISTS idx_tenant_subscription_events_tenant_id 
    ON tenant_subscription_events (tenant_id, created_at DESC);
  `);

  console.log('[MIGRATION 20261109_phase2a] ✅ Tablas e índices creados con éxito.');
}

async function down(conn) {
  console.log('[MIGRATION 20261109_phase2a] Reversión...');
  await conn.query(`DROP TABLE IF EXISTS tenant_subscription_events CASCADE;`);
  await conn.query(`DROP TABLE IF EXISTS tenant_feature_overrides CASCADE;`);
  await conn.query(`DROP TABLE IF EXISTS tenant_subscriptions CASCADE;`);
  await conn.query(`DROP TABLE IF EXISTS saas_plan_features CASCADE;`);
  await conn.query(`DROP TABLE IF EXISTS saas_features CASCADE;`);
}

module.exports = { up, down };

