'use strict';

/**
 * Migración Idempotente: Renovación Mensual Consolidada SaaS Etereas
 *
 * - Conserva suscripciones existentes con `periodicity_mode = 'fixed_30_days'` sin alterarlas
 *   hasta aceptación explícita; nuevas contrataciones usan `'calendar_month'` + `billing_anchor_day`.
 * - Agrega idempotencia por empresa y período en `saas_invoices` y tabla persistente `saas_renewal_runs`
 *   para worker único con bloqueo optimista/atómico y conciliación previa a reintentos.
 */

async function up(conn) {
  await conn.query(`
    ALTER TABLE tenant_subscriptions
      ADD COLUMN IF NOT EXISTS periodicity_mode VARCHAR(32) NOT NULL DEFAULT 'fixed_30_days',
      ADD COLUMN IF NOT EXISTS billing_anchor_day SMALLINT,
      ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS recurring_consent_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS recurring_consent_version VARCHAR(50),
      ADD COLUMN IF NOT EXISTS extra_users_count INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS addon_branches_count INT NOT NULL DEFAULT 0;
  `);

  await conn.query(`
    ALTER TABLE saas_invoices
      ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255),
      ADD COLUMN IF NOT EXISTS fx_rate_scaled BIGINT,
      ADD COLUMN IF NOT EXISTS fx_rate_formatted VARCHAR(32),
      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
  `);

  await conn.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_saas_invoices_tenant_idemp
    ON saas_invoices (tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
  `);

  await conn.query(`
    ALTER TABLE saas_payments
      ADD COLUMN IF NOT EXISTS attempt_number INT NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS is_retriable BOOLEAN,
      ADD COLUMN IF NOT EXISTS requires_reconciliation BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS saas_renewal_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      subscription_id UUID REFERENCES tenant_subscriptions(id) ON DELETE SET NULL,
      period_key VARCHAR(32) NOT NULL,
      invoice_id UUID REFERENCES saas_invoices(id) ON DELETE SET NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      attempts_count INT NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMP WITH TIME ZONE,
      locked_until TIMESTAMP WITH TIME ZONE,
      locked_by VARCHAR(100),
      last_response_code VARCHAR(32),
      last_error TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT uq_saas_renewal_runs_tenant_period UNIQUE (tenant_id, period_key)
    );
  `);

  await conn.query(`
    CREATE INDEX IF NOT EXISTS idx_saas_renewal_runs_due
    ON saas_renewal_runs (status, next_attempt_at, locked_until);
  `);
}

async function down(conn) {
  await conn.query(`DROP TABLE IF EXISTS saas_renewal_runs CASCADE;`);
  await conn.query(`DROP INDEX IF EXISTS uq_saas_invoices_tenant_idemp;`);
}

module.exports = { up, down };
