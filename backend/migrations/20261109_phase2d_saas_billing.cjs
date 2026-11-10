/**
 * Migración DDL Idempotente: Fase 2D — Facturación SaaS y Ciclo de Suscripción Base/Pro
 * 
 * ⚠️ ESTA MIGRACIÓN ESTÁ PREPARADA PERO NO DEBE SER EJECUTADA EN PRODUCCIÓN
 * HASTA LA APROBACIÓN DE INFRAESTRUCTURA Y PRUEBAS AISLADAS EN BASE FÍSICA SEPARADA.
 * 
 * Cumplimiento estricto:
 * 1. Moneda y dinero en unidades menores: amount_minor BIGINT, currency CHAR(3).
 * 2. Cero almacenamiento de PAN / CVC (token opaco y metadatos no sensibles).
 * 3. Cada tabla tenant-owned incluye `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`.
 * 4. Índices B-Tree con `tenant_id` en primera posición.
 */

async function up(conn) {
  // 1. Extender tabla existente tenant_subscriptions (de Fase 2A) con campos de ciclo y gracia
  await conn.query(`
    ALTER TABLE tenant_subscriptions
      ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'DOP',
      ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly',
      ADD COLUMN IF NOT EXISTS grace_period_until TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS scheduled_downgrade_plan VARCHAR(50),
      ADD COLUMN IF NOT EXISTS price_book_version VARCHAR(50) DEFAULT 'v1_2026';
  `);

  // 2. Métodos de pago tokenizados (saas_payment_methods)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS saas_payment_methods (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      gateway_type VARCHAR(50) NOT NULL DEFAULT 'fake_gateway',
      token_reference VARCHAR(255) NOT NULL,
      provider_customer_id VARCHAR(255),
      last4 CHAR(4),
      brand VARCHAR(30),
      exp_month INT,
      exp_year INT,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
  await conn.query(`
    CREATE INDEX IF NOT EXISTS idx_saas_payment_methods_tenant_id 
    ON saas_payment_methods (tenant_id);
  `);

  // 3. Contadores atómicos de facturas por tenant y año (saas_invoice_counters)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS saas_invoice_counters (
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      year INT NOT NULL,
      last_number BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (tenant_id, year)
    );
  `);
  await conn.query(`
    CREATE INDEX IF NOT EXISTS idx_saas_invoice_counters_tenant_id 
    ON saas_invoice_counters (tenant_id);
  `);

  // 4. Facturas SaaS B2B (saas_invoices)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS saas_invoices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      invoice_number VARCHAR(50) NOT NULL,
      subscription_id UUID REFERENCES tenant_subscriptions(id) ON DELETE SET NULL,
      plan_code VARCHAR(50) NOT NULL,
      billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly',
      price_book_version VARCHAR(50) NOT NULL DEFAULT 'v1_2026',
      period_start TIMESTAMP WITH TIME ZONE,
      period_end TIMESTAMP WITH TIME ZONE,
      subtotal_minor BIGINT NOT NULL DEFAULT 0,
      tax_minor BIGINT NOT NULL DEFAULT 0,
      total_minor BIGINT NOT NULL DEFAULT 0,
      amount_paid_minor BIGINT NOT NULL DEFAULT 0,
      amount_due_minor BIGINT NOT NULL DEFAULT 0,
      amount_refunded_minor BIGINT NOT NULL DEFAULT 0,
      currency CHAR(3) NOT NULL DEFAULT 'DOP',
      status VARCHAR(30) NOT NULL DEFAULT 'open',
      due_date TIMESTAMP WITH TIME ZONE,
      paid_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT uq_saas_invoices_tenant_number UNIQUE (tenant_id, invoice_number)
    );
  `);
  await conn.query(`
    CREATE INDEX IF NOT EXISTS idx_saas_invoices_tenant_id 
    ON saas_invoices (tenant_id);
  `);

  // 5. Líneas de factura SaaS (saas_invoice_items)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS saas_invoice_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      invoice_id UUID NOT NULL REFERENCES saas_invoices(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      item_type VARCHAR(50) NOT NULL DEFAULT 'PLAN_FEE',
      amount_minor BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
  await conn.query(`
    CREATE INDEX IF NOT EXISTS idx_saas_invoice_items_tenant_id 
    ON saas_invoice_items (tenant_id);
  `);

  // 6. Registro de pagos de facturas SaaS (saas_payments)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS saas_payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      invoice_id UUID NOT NULL REFERENCES saas_invoices(id) ON DELETE CASCADE,
      amount_minor BIGINT NOT NULL,
      refunded_amount_minor BIGINT NOT NULL DEFAULT 0,
      currency CHAR(3) NOT NULL DEFAULT 'DOP',
      gateway_reference VARCHAR(255),
      status VARCHAR(30) NOT NULL DEFAULT 'success',
      failure_code VARCHAR(100),
      failure_message TEXT,
      idempotency_key VARCHAR(255) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT uq_saas_payments_tenant_idemp UNIQUE (tenant_id, idempotency_key)
    );
  `);
  await conn.query(`
    CREATE INDEX IF NOT EXISTS idx_saas_payments_tenant_id 
    ON saas_payments (tenant_id);
  `);

  // 7. Reembolsos de facturas SaaS (saas_refunds)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS saas_refunds (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      payment_id UUID NOT NULL REFERENCES saas_payments(id) ON DELETE CASCADE,
      invoice_id UUID NOT NULL REFERENCES saas_invoices(id) ON DELETE CASCADE,
      amount_minor BIGINT NOT NULL,
      currency CHAR(3) NOT NULL DEFAULT 'DOP',
      status VARCHAR(30) NOT NULL DEFAULT 'success',
      reason TEXT,
      gateway_reference VARCHAR(255),
      idempotency_key VARCHAR(255) NOT NULL,
      actor VARCHAR(100) NOT NULL DEFAULT 'system',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT uq_saas_refunds_tenant_idemp UNIQUE (tenant_id, idempotency_key)
    );
  `);
  await conn.query(`
    CREATE INDEX IF NOT EXISTS idx_saas_refunds_tenant_id 
    ON saas_refunds (tenant_id);
  `);

  // 8. Eventos de auditoría de facturación (saas_billing_events)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS saas_billing_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      event_type VARCHAR(100) NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      idempotency_key VARCHAR(255) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT uq_saas_billing_events_tenant_idemp UNIQUE (tenant_id, idempotency_key)
    );
  `);
  await conn.query(`
    CREATE INDEX IF NOT EXISTS idx_saas_billing_events_tenant_id 
    ON saas_billing_events (tenant_id);
  `);

  // 9. Eventos de webhooks sanitizados (saas_webhook_events)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS saas_webhook_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider VARCHAR(50) NOT NULL,
      event_id VARCHAR(255) NOT NULL,
      tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
      event_type VARCHAR(100) NOT NULL,
      payload_sanitized JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(30) NOT NULL DEFAULT 'received',
      idempotency_key VARCHAR(255) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT uq_saas_webhook_events_prov_id UNIQUE (provider, event_id)
    );
  `);
  await conn.query(`
    CREATE INDEX IF NOT EXISTS idx_saas_webhook_events_tenant_id 
    ON saas_webhook_events (tenant_id);
  `);

  // 10. Tareas programadas de dunning y facturación (saas_billing_jobs)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS saas_billing_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      job_type VARCHAR(100) NOT NULL,
      run_at TIMESTAMP WITH TIME ZONE NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      locked_at TIMESTAMP WITH TIME ZONE,
      idempotency_key VARCHAR(255) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT uq_saas_billing_jobs_tenant_idemp UNIQUE (tenant_id, idempotency_key)
    );
  `);
  await conn.query(`
    CREATE INDEX IF NOT EXISTS idx_saas_billing_jobs_tenant_id 
    ON saas_billing_jobs (tenant_id);
  `);
}

async function down(conn) {
  await conn.query(`DROP TABLE IF EXISTS saas_billing_jobs CASCADE;`);
  await conn.query(`DROP TABLE IF EXISTS saas_webhook_events CASCADE;`);
  await conn.query(`DROP TABLE IF EXISTS saas_billing_events CASCADE;`);
  await conn.query(`DROP TABLE IF EXISTS saas_refunds CASCADE;`);
  await conn.query(`DROP TABLE IF EXISTS saas_payments CASCADE;`);
  await conn.query(`DROP TABLE IF EXISTS saas_invoice_items CASCADE;`);
  await conn.query(`DROP TABLE IF EXISTS saas_invoices CASCADE;`);
  await conn.query(`DROP TABLE IF EXISTS saas_invoice_counters CASCADE;`);
  await conn.query(`DROP TABLE IF EXISTS saas_payment_methods CASCADE;`);
}

module.exports = {
  up,
  down
};

