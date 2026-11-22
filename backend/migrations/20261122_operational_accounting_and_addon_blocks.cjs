'use strict';

/**
 * Migración Incremental: Contabilidad Operativa (Egresos, ITBIS) y Bloques de Capacidad del Add-on Membresías
 * (backend/migrations/20261122_operational_accounting_and_addon_blocks.cjs)
 *
 * Objetivo:
 * - Agregar de forma incremental y segura las columnas requeridas en `expenses` para el contrato completo
 *   del módulo de Egresos (`concept_name`, `payment_date`, `account_name`, `salon_name`, `reference`,
 *   adjuntos, préstamos, desglose capital/interés/cargos, estado y anulación).
 * - Agregar `itbis_cents` en `visits` y `tax_rate` / `tax_mode` en `services` para trazabilidad fiscal
 *   del catálogo al POS sin alterar facturas históricas.
 * - Agregar columnas de capacidad por bloques de hasta 3 sucursales (`addon_blocks_count`,
 *   `addon_branches_capacity`, `acquired_blocks`, `acquired_branch_capacity`, `addon_branch_ids`) en
 *   `tenant_subscriptions`, `tenant_feature_overrides` y `saas_checkout_orders`, con backfills seguros
 *   que no modifican precios aceptados, autorizaciones ni facturas históricas.
 */

const { pool: defaultPool } = require('../db');

async function up(targetPool = defaultPool, targetSchema = 'public') {
  const conn = await targetPool.getConnection();
  try {
    const schema = targetSchema || 'public';
    await conn.query(`SET search_path TO "${schema}";`);
    await conn.query('BEGIN');

    // 1. Extender tabla expenses con el contrato completo de ExpensesModule
    await conn.query(`
      ALTER TABLE "${schema}".expenses
        ADD COLUMN IF NOT EXISTS concept_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS payment_date DATE,
        ADD COLUMN IF NOT EXISTS account_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS salon_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS reference VARCHAR(255),
        ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS attachment_data TEXT,
        ADD COLUMN IF NOT EXISTS attachment_mime VARCHAR(120),
        ADD COLUMN IF NOT EXISTS observation TEXT,
        ADD COLUMN IF NOT EXISTS bank_name VARCHAR(150),
        ADD COLUMN IF NOT EXISTS loan_id VARCHAR(100),
        ADD COLUMN IF NOT EXISTS loan_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS loan_ref VARCHAR(150),
        ADD COLUMN IF NOT EXISTS loan_period VARCHAR(100),
        ADD COLUMN IF NOT EXISTS breakdown_capital NUMERIC(12, 2) DEFAULT 0.00,
        ADD COLUMN IF NOT EXISTS breakdown_interest NUMERIC(12, 2) DEFAULT 0.00,
        ADD COLUMN IF NOT EXISTS breakdown_charges NUMERIC(12, 2) DEFAULT 0.00,
        ADD COLUMN IF NOT EXISTS is_loan SMALLINT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Activo',
        ADD COLUMN IF NOT EXISTS void_reason TEXT,
        ADD COLUMN IF NOT EXISTS voided_by VARCHAR(150),
        ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
    `);

    await conn.query(`
      UPDATE "${schema}".expenses
      SET concept_name = COALESCE(concept_name, concept, 'Otros'),
          payment_date = COALESCE(payment_date, date, expense_date, CURRENT_DATE),
          breakdown_capital = COALESCE(breakdown_capital, 0.00),
          breakdown_interest = COALESCE(breakdown_interest, 0.00),
          breakdown_charges = COALESCE(breakdown_charges, 0.00),
          is_loan = COALESCE(is_loan, 0),
          status = COALESCE(status, 'Activo'),
          updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
      WHERE concept_name IS NULL
         OR payment_date IS NULL
         OR breakdown_capital IS NULL
         OR breakdown_interest IS NULL
         OR breakdown_charges IS NULL
         OR is_loan IS NULL
         OR status IS NULL;
    `);

    await conn.query(`
      ALTER TABLE "${schema}".expenses
        ALTER COLUMN breakdown_capital SET DEFAULT 0.00,
        ALTER COLUMN breakdown_capital SET NOT NULL,
        ALTER COLUMN breakdown_interest SET DEFAULT 0.00,
        ALTER COLUMN breakdown_interest SET NOT NULL,
        ALTER COLUMN breakdown_charges SET DEFAULT 0.00,
        ALTER COLUMN breakdown_charges SET NOT NULL,
        ALTER COLUMN is_loan SET DEFAULT 0,
        ALTER COLUMN is_loan SET NOT NULL,
        ALTER COLUMN status SET DEFAULT 'Activo',
        ALTER COLUMN status SET NOT NULL,
        ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;
    `);

    // 2. Extender visits con itbis_cents para precisión en unidades menores (sin alterar facturas históricas)
    await conn.query(`
      ALTER TABLE "${schema}".visits
        ADD COLUMN IF NOT EXISTS itbis_cents BIGINT DEFAULT 0;
    `);

    await conn.query(`
      UPDATE "${schema}".visits
      SET itbis_cents = COALESCE(ROUND(COALESCE(itbis, 0) * 100)::bigint, 0)
      WHERE itbis_cents IS NULL;
    `);

    await conn.query(`
      ALTER TABLE "${schema}".visits
        ALTER COLUMN itbis_cents SET DEFAULT 0,
        ALTER COLUMN itbis_cents SET NOT NULL;
    `);

    // 3. Extender services con tax_rate y tax_mode para clasificación fiscal canónica Catálogo -> POS
    await conn.query(`
      ALTER TABLE "${schema}".services
        ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5, 4) DEFAULT 0.1800,
        ADD COLUMN IF NOT EXISTS tax_mode VARCHAR(20) DEFAULT 'exclusive';
    `);

    await conn.query(`
      UPDATE "${schema}".services
      SET tax_rate = CASE WHEN COALESCE(aplica_itbis, 0) = 1 THEN 0.1800 ELSE 0.0000 END
      WHERE tax_rate IS NULL;
    `);

    await conn.query(`
      UPDATE "${schema}".services
      SET tax_mode = 'exclusive'
      WHERE tax_mode IS NULL OR TRIM(tax_mode) = '';
    `);

    await conn.query(`
      ALTER TABLE "${schema}".services
        ALTER COLUMN tax_rate SET DEFAULT 0.1800,
        ALTER COLUMN tax_rate SET NOT NULL,
        ALTER COLUMN tax_mode SET DEFAULT 'exclusive',
        ALTER COLUMN tax_mode SET NOT NULL;
    `);

    // 4. Extender tenant_subscriptions, tenant_feature_overrides y saas_checkout_orders con bloques de hasta 3 sucursales
    await conn.query(`
      ALTER TABLE "${schema}".tenant_subscriptions
        ADD COLUMN IF NOT EXISTS addon_blocks_count INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS addon_branches_capacity INTEGER DEFAULT 0;
    `);

    await conn.query(`
      UPDATE "${schema}".tenant_subscriptions
      SET addon_blocks_count = CASE
            WHEN COALESCE(addon_blocks_count, 0) > 0 THEN addon_blocks_count
            WHEN COALESCE(addon_branches_count, 0) > 0 THEN CEIL(addon_branches_count::numeric / 3.0)::int
            ELSE 0
          END
      WHERE addon_blocks_count IS NULL OR (addon_blocks_count = 0 AND COALESCE(addon_branches_count, 0) > 0);
    `);

    await conn.query(`
      UPDATE "${schema}".tenant_subscriptions
      SET addon_branches_capacity = COALESCE(addon_blocks_count, 0) * 3
      WHERE addon_branches_capacity IS NULL OR addon_branches_capacity < (COALESCE(addon_blocks_count, 0) * 3);
    `);

    await conn.query(`
      ALTER TABLE "${schema}".tenant_subscriptions
        ALTER COLUMN addon_blocks_count SET DEFAULT 0,
        ALTER COLUMN addon_blocks_count SET NOT NULL,
        ALTER COLUMN addon_branches_capacity SET DEFAULT 0,
        ALTER COLUMN addon_branches_capacity SET NOT NULL;
    `);

    await conn.query(`
      ALTER TABLE "${schema}".tenant_feature_overrides
        ADD COLUMN IF NOT EXISTS acquired_blocks INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS acquired_branch_capacity INTEGER DEFAULT 0;
    `);

    await conn.query(`
      UPDATE "${schema}".tenant_feature_overrides
      SET acquired_blocks = CASE
            WHEN COALESCE(acquired_blocks, 0) > 0 THEN acquired_blocks
            WHEN feature_key = 'memberships' AND COALESCE(is_enabled, FALSE) = TRUE THEN
              GREATEST(
                1,
                CEIL(
                  GREATEST(
                    1,
                    CASE
                      WHEN enabled_branch_ids IS NOT NULL AND jsonb_typeof(enabled_branch_ids) = 'array'
                        THEN jsonb_array_length(enabled_branch_ids)
                      ELSE 1
                    END
                  )::numeric / 3.0
                )::int
              )
            ELSE 0
          END
      WHERE acquired_blocks IS NULL OR (acquired_blocks = 0 AND feature_key = 'memberships' AND COALESCE(is_enabled, FALSE) = TRUE);
    `);

    await conn.query(`
      UPDATE "${schema}".tenant_feature_overrides
      SET acquired_branch_capacity = COALESCE(acquired_blocks, 0) * 3
      WHERE acquired_branch_capacity IS NULL OR acquired_branch_capacity < (COALESCE(acquired_blocks, 0) * 3);
    `);

    await conn.query(`
      ALTER TABLE "${schema}".tenant_feature_overrides
        ALTER COLUMN acquired_blocks SET DEFAULT 0,
        ALTER COLUMN acquired_blocks SET NOT NULL,
        ALTER COLUMN acquired_branch_capacity SET DEFAULT 0,
        ALTER COLUMN acquired_branch_capacity SET NOT NULL;
    `);

    await conn.query(`
      ALTER TABLE "${schema}".saas_checkout_orders
        ADD COLUMN IF NOT EXISTS addon_blocks_count INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS addon_branch_ids JSONB DEFAULT '[]'::jsonb;
    `);

    await conn.query(`
      UPDATE "${schema}".saas_checkout_orders
      SET addon_blocks_count = CASE
            WHEN COALESCE(addon_blocks_count, 0) > 0 THEN addon_blocks_count
            WHEN COALESCE(memberships_addon_enabled, FALSE) = TRUE THEN
              GREATEST(1, CEIL(GREATEST(1, COALESCE(addon_branches_count, 1))::numeric / 3.0)::int)
            ELSE 0
          END,
          addon_branch_ids = COALESCE(addon_branch_ids, '[]'::jsonb)
      WHERE addon_blocks_count IS NULL OR addon_branch_ids IS NULL;
    `);

    await conn.query(`
      ALTER TABLE "${schema}".saas_checkout_orders
        ALTER COLUMN addon_blocks_count SET DEFAULT 0,
        ALTER COLUMN addon_blocks_count SET NOT NULL,
        ALTER COLUMN addon_branch_ids SET DEFAULT '[]'::jsonb,
        ALTER COLUMN addon_branch_ids SET NOT NULL;
    `);

    await conn.query('COMMIT');
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { up };
