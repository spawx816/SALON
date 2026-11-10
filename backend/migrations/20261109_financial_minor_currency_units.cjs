/**
 * Migration: Minor Currency Units (cents) & Idempotency Storage
 * (backend/migrations/20261109_financial_minor_currency_units.cjs)
 * 
 * PREPARED BUT NOT EXECUTED (Database infrastructure in pause).
 * Idempotently adds integer BIGINT columns for exact financial calculations (DOP/USD).
 */

'use strict';

async function up(pool) {
  // 1. Idempotency Keys Storage Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      id BIGSERIAL PRIMARY KEY,
      tenant_id VARCHAR(100) NOT NULL,
      idempotency_key VARCHAR(255) NOT NULL,
      payload_hash VARCHAR(64) NOT NULL,
      status_code INT NOT NULL,
      response_body JSONB NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '24 hours',
      CONSTRAINT uq_tenant_idempotency_key UNIQUE (tenant_id, idempotency_key)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_idempotency_tenant_key 
    ON idempotency_keys (tenant_id, idempotency_key)
  `);

  // 2. Visits / Invoices Minor Units
  await pool.query(`
    ALTER TABLE visits 
    ADD COLUMN IF NOT EXISTS subtotal_cents BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tax_cents BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount_cents BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tip_cents BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_cents BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'DOP'
  `);

  // 3. Cash Registers & Movements Minor Units
  await pool.query(`
    ALTER TABLE cash_registers
    ADD COLUMN IF NOT EXISTS opening_balance_cents BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS closing_balance_cents BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS expected_balance_cents BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS difference_cents BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'DOP'
  `);

  await pool.query(`
    ALTER TABLE cash_register_movements
    ADD COLUMN IF NOT EXISTS amount_cents BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'DOP'
  `);

  // 4. Employee Commissions Minor Units
  await pool.query(`
    ALTER TABLE employee_commissions_log
    ADD COLUMN IF NOT EXISTS commission_cents BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'DOP'
  `);

  // 5. Inventory Products & Ledger Minor Units
  await pool.query(`
    ALTER TABLE inventory_products
    ADD COLUMN IF NOT EXISTS cost_cents BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS price_cents BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'DOP'
  `);

  console.log('[MIGRATION 20261109] Minor currency units and idempotency table created successfully.');
}

async function down(pool) {
  await pool.query('DROP TABLE IF EXISTS idempotency_keys');
}

module.exports = { up, down };

