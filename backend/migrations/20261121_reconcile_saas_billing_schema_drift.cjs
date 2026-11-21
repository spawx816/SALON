'use strict';

/**
 * Migración Incremental de Reconciliación de Deriva de Esquema SaaS Billing & Multi-Tenant (Bloque 1)
 * (backend/migrations/20261121_reconcile_saas_billing_schema_drift.cjs)
 *
 * Objetivo:
 * - Reconciliar de forma incremental las columnas, tipos, nulabilidad, defaults, índices B-Tree,
 *   restricciones UNIQUE y Foreign Keys faltantes en `tenant_subscriptions`, `saas_invoices`,
 *   `saas_payments`, `saas_renewal_runs`, `saas_checkout_orders`, `tenant_welcome_email_queue`,
 *   `tenant_terms_acceptances`, `users`, `contract_settings`, `ticket_sequences` y `schema_migrations`,
 *   sin editar migraciones históricas ya aplicadas.
 * - Definir backfills seguros:
 *   * NUNCA activa recurrencia (`auto_renew = FALSE` por defecto y para toda suscripción sin
 *     `recurring_consent_at` y `recurring_consent_version` explícitos).
 *   * NUNCA inventa consentimientos (`recurring_consent_at = NULL`, `recurring_consent_version = NULL`),
 *     días ancla (`billing_anchor_day = NULL`), periodicidades ni contrataciones.
 *   * Preserva `periodicity_mode = 'fixed_30_days'` en suscripciones existentes hasta aceptación expresa.
 */

const { pool: defaultPool } = require('../db');

async function up(targetPool = defaultPool, targetSchema = 'public') {
  const conn = await targetPool.getConnection();
  try {
    const schema = targetSchema || 'public';
    await conn.query(`SET search_path TO "${schema}";`);
    await conn.query('BEGIN');

    // 1. Extender schema_migrations con columna checksum SHA-256 para detección de edición de migraciones aplicadas
    await conn.query(`
      ALTER TABLE "${schema}".schema_migrations
      ADD COLUMN IF NOT EXISTS checksum VARCHAR(64);
    `);

    // 2. Reconciliación completa de tenant_subscriptions + Backfills Seguros
    await conn.query(`
      ALTER TABLE "${schema}".tenant_subscriptions
        ADD COLUMN IF NOT EXISTS periodicity_mode VARCHAR(32) DEFAULT 'fixed_30_days',
        ADD COLUMN IF NOT EXISTS billing_anchor_day SMALLINT,
        ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS recurring_consent_at TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS recurring_consent_version VARCHAR(50),
        ADD COLUMN IF NOT EXISTS extra_users_count INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS addon_branches_count INTEGER DEFAULT 0;
    `);

    // Imponer defaults seguros explícitamente (IF NOT EXISTS no corrige defaults si una migración previa dejó auto_renew DEFAULT TRUE)
    await conn.query(`
      ALTER TABLE "${schema}".tenant_subscriptions
        ALTER COLUMN periodicity_mode SET DEFAULT 'fixed_30_days',
        ALTER COLUMN auto_renew SET DEFAULT FALSE,
        ALTER COLUMN cancel_at_period_end SET DEFAULT FALSE,
        ALTER COLUMN extra_users_count SET DEFAULT 0,
        ALTER COLUMN addon_branches_count SET DEFAULT 0;
    `);

    // Backfills seguros: desactivar auto_renew en cualquier fila que no tenga consentimiento recurrente explícito registrado
    await conn.query(`
      UPDATE "${schema}".tenant_subscriptions
      SET auto_renew = FALSE
      WHERE auto_renew IS NULL
         OR recurring_consent_at IS NULL
         OR recurring_consent_version IS NULL
         OR TRIM(COALESCE(recurring_consent_version, '')) = '';
    `);

    await conn.query(`
      UPDATE "${schema}".tenant_subscriptions
      SET periodicity_mode = 'fixed_30_days'
      WHERE periodicity_mode IS NULL OR TRIM(periodicity_mode) = '';
    `);

    await conn.query(`
      UPDATE "${schema}".tenant_subscriptions
      SET extra_users_count = 0
      WHERE extra_users_count IS NULL;
    `);

    await conn.query(`
      UPDATE "${schema}".tenant_subscriptions
      SET addon_branches_count = 0
      WHERE addon_branches_count IS NULL;
    `);

    await conn.query(`
      ALTER TABLE "${schema}".tenant_subscriptions
        ALTER COLUMN periodicity_mode SET NOT NULL,
        ALTER COLUMN auto_renew SET NOT NULL,
        ALTER COLUMN extra_users_count SET NOT NULL,
        ALTER COLUMN addon_branches_count SET NOT NULL;
    `);

    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_tenant_id
      ON "${schema}".tenant_subscriptions USING btree (tenant_id);
    `);

    // 3. Reconciliación completa de saas_invoices
    await conn.query(`
      ALTER TABLE "${schema}".saas_invoices
        ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255),
        ADD COLUMN IF NOT EXISTS fx_rate_scaled BIGINT,
        ADD COLUMN IF NOT EXISTS fx_rate_formatted VARCHAR(32),
        ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
    `);

    await conn.query(`
      ALTER TABLE "${schema}".saas_invoices
        ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;
    `);

    await conn.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_saas_invoices_tenant_idemp
      ON "${schema}".saas_invoices (tenant_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    `);

    // 4. Reconciliación completa de saas_payments
    await conn.query(`
      ALTER TABLE "${schema}".saas_payments
        ADD COLUMN IF NOT EXISTS attempt_number INTEGER DEFAULT 1,
        ADD COLUMN IF NOT EXISTS is_retriable BOOLEAN,
        ADD COLUMN IF NOT EXISTS requires_reconciliation BOOLEAN DEFAULT FALSE;
    `);

    await conn.query(`
      UPDATE "${schema}".saas_payments
      SET attempt_number = 1
      WHERE attempt_number IS NULL;
    `);

    await conn.query(`
      UPDATE "${schema}".saas_payments
      SET requires_reconciliation = FALSE
      WHERE requires_reconciliation IS NULL;
    `);

    await conn.query(`
      ALTER TABLE "${schema}".saas_payments
        ALTER COLUMN attempt_number SET DEFAULT 1,
        ALTER COLUMN attempt_number SET NOT NULL,
        ALTER COLUMN requires_reconciliation SET DEFAULT FALSE,
        ALTER COLUMN requires_reconciliation SET NOT NULL;
    `);

    // 5. Reconciliación completa de saas_renewal_runs (tabla, FKs, UNIQUE e índices B-Tree con tenant_id líder)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".saas_renewal_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES "${schema}".tenants(id) ON DELETE CASCADE,
        subscription_id UUID REFERENCES "${schema}".tenant_subscriptions(id) ON DELETE SET NULL,
        period_key VARCHAR(32) NOT NULL,
        invoice_id UUID REFERENCES "${schema}".saas_invoices(id) ON DELETE SET NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        attempts_count INTEGER NOT NULL DEFAULT 0,
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
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
          JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE n.nspname = '${schema}' AND c.conname = 'saas_renewal_runs_tenant_id_fkey'
        ) THEN
          ALTER TABLE "${schema}".saas_renewal_runs
          ADD CONSTRAINT saas_renewal_runs_tenant_id_fkey
          FOREIGN KEY (tenant_id) REFERENCES "${schema}".tenants(id) ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
          JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE n.nspname = '${schema}' AND c.conname = 'saas_renewal_runs_subscription_id_fkey'
        ) THEN
          ALTER TABLE "${schema}".saas_renewal_runs
          ADD CONSTRAINT saas_renewal_runs_subscription_id_fkey
          FOREIGN KEY (subscription_id) REFERENCES "${schema}".tenant_subscriptions(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
          JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE n.nspname = '${schema}' AND c.conname = 'saas_renewal_runs_invoice_id_fkey'
        ) THEN
          ALTER TABLE "${schema}".saas_renewal_runs
          ADD CONSTRAINT saas_renewal_runs_invoice_id_fkey
          FOREIGN KEY (invoice_id) REFERENCES "${schema}".saas_invoices(id) ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
          JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE n.nspname = '${schema}' AND c.conname = 'uq_saas_renewal_runs_tenant_period'
        ) THEN
          ALTER TABLE "${schema}".saas_renewal_runs
          ADD CONSTRAINT uq_saas_renewal_runs_tenant_period UNIQUE (tenant_id, period_key);
        END IF;
      END $$;
    `);

    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_saas_renewal_runs_tenant_id
      ON "${schema}".saas_renewal_runs USING btree (tenant_id);
    `);

    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_saas_renewal_runs_due
      ON "${schema}".saas_renewal_runs USING btree (status, next_attempt_at, locked_until);
    `);

    // 6. Reconciliación completa de saas_checkout_orders (incluir formalmente en runner canónico con FK a tenants)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".saas_checkout_orders (
        id UUID PRIMARY KEY,
        order_number VARCHAR(20) NOT NULL UNIQUE,
        tenant_id UUID NOT NULL REFERENCES "${schema}".tenants(id) ON DELETE CASCADE,
        invoice_id UUID NULL,
        created_by_user_id UUID NULL,
        source VARCHAR(40) NOT NULL DEFAULT 'self_service',
        payment_link_token VARCHAR(96) NULL UNIQUE,
        plan_code VARCHAR(40) NOT NULL DEFAULT 'PRINCIPAL',
        branches_count INTEGER NOT NULL DEFAULT 1,
        extra_users_count INTEGER NOT NULL DEFAULT 0,
        memberships_addon_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        addon_branches_count INTEGER NOT NULL DEFAULT 0,
        currency VARCHAR(10) NOT NULL DEFAULT 'USD',
        subtotal_minor BIGINT NOT NULL DEFAULT 0,
        tax_minor BIGINT NOT NULL DEFAULT 0,
        total_minor BIGINT NOT NULL DEFAULT 0,
        billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly',
        status VARCHAR(32) NOT NULL DEFAULT 'pending_payment',
        gateway_provider VARCHAR(40) NOT NULL DEFAULT 'cardnet_hosted',
        cardnet_session_id VARCHAR(128) NULL,
        cardnet_session_key VARCHAR(256) NULL,
        cardnet_authorization_code VARCHAR(64) NULL,
        cardnet_reference VARCHAR(128) NULL,
        cardnet_response_code VARCHAR(16) NULL,
        cardnet_response_message VARCHAR(255) NULL,
        masked_card VARCHAR(32) NULL,
        auto_renew_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        idempotency_key VARCHAR(128) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        paid_at TIMESTAMPTZ NULL,
        activated_at TIMESTAMPTZ NULL,
        reconcile_attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await conn.query(`
      DELETE FROM "${schema}".saas_checkout_orders o
      WHERE NOT EXISTS (SELECT 1 FROM "${schema}".tenants t WHERE t.id = o.tenant_id);
    `);

    await conn.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
          JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE n.nspname = '${schema}' AND c.conname = 'saas_checkout_orders_tenant_id_fkey'
        ) THEN
          ALTER TABLE "${schema}".saas_checkout_orders
          ADD CONSTRAINT saas_checkout_orders_tenant_id_fkey
          FOREIGN KEY (tenant_id) REFERENCES "${schema}".tenants(id) ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_saas_checkout_orders_tenant_status
      ON "${schema}".saas_checkout_orders USING btree (tenant_id, status, created_at DESC);
    `);

    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_saas_checkout_orders_token
      ON "${schema}".saas_checkout_orders (payment_link_token)
      WHERE payment_link_token IS NOT NULL;
    `);

    // 7. Reconciliar FK en tenant_welcome_email_queue y defaults en tenant_terms_acceptances / users
    await conn.query(`
      DELETE FROM "${schema}".tenant_welcome_email_queue q
      WHERE NOT EXISTS (SELECT 1 FROM "${schema}".tenants t WHERE t.id = q.tenant_id);
    `);

    await conn.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint c
          JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE n.nspname = '${schema}' AND c.conname = 'tenant_welcome_email_queue_tenant_id_fkey'
        ) THEN
          ALTER TABLE "${schema}".tenant_welcome_email_queue
          ADD CONSTRAINT tenant_welcome_email_queue_tenant_id_fkey
          FOREIGN KEY (tenant_id) REFERENCES "${schema}".tenants(id) ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    await conn.query(`
      ALTER TABLE "${schema}".tenant_feature_overrides
        ADD COLUMN IF NOT EXISTS enabled_branch_ids JSONB DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    `);

    await conn.query(`
      ALTER TABLE "${schema}".tenant_terms_acceptances
        ALTER COLUMN acceptance_mechanism TYPE VARCHAR(100),
        ALTER COLUMN document_hash TYPE VARCHAR(128),
        ALTER COLUMN acceptance_mechanism SET DEFAULT 'checkbox_onboarding';
    `);

    await conn.query(`
      ALTER TABLE "${schema}".users
        ALTER COLUMN authorized_branch_ids SET DEFAULT '[]';
    `);

    // 8. Reconciliar contract_settings (deduplicar conservando MAX(id) por tenant_id y asegurar índice único)
    await conn.query(`
      DELETE FROM "${schema}".contract_settings a
      USING "${schema}".contract_settings b
      WHERE a.tenant_id = b.tenant_id
        AND a.id < b.id;
    `);

    await conn.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_settings_tenant_unique
      ON "${schema}".contract_settings USING btree (tenant_id);
    `);

    // 9. Reconciliar ticket_sequences: eliminar constraint legacy global sobre (salon_id) y asegurar UNIQUE (tenant_id, salon_id)
    await conn.query(`
      ALTER TABLE "${schema}".ticket_sequences
      DROP CONSTRAINT IF EXISTS ticket_sequences_salon_id_key;
    `);

    await conn.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_sequences_tenant_salon
      ON "${schema}".ticket_sequences USING btree (tenant_id, salon_id);
    `);

    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_kiosk_employee_sessions_tenant_id
      ON "${schema}".kiosk_employee_sessions USING btree (tenant_id);
    `);

    await conn.query('COMMIT');
    return { success: true };
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
}

async function down() {
  // No-op por seguridad de datos e integridad referencial
}

if (require.main === module) {
  up()
    .then(() => {
      console.log('✅ Migración 20261121_reconcile_saas_billing_schema_drift completada.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Error en migración 20261121_reconcile_saas_billing_schema_drift:', err);
      process.exit(1);
    });
}

module.exports = { up, down };
