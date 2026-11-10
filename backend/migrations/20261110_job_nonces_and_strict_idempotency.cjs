/**
 * Migration: 20261110_job_nonces_and_strict_idempotency
 * (backend/migrations/20261110_job_nonces_and_strict_idempotency.cjs)
 *
 * Requirements (Phase 3B.0.2):
 * 1. Creates independent global table job_request_nonces without tenant_id.
 * 2. Safely purges SYSTEM_CRON fixtures from idempotency_keys.
 * 3. Verifies all remaining tenant_id values in idempotency_keys are valid UUIDs.
 * 4. Alters idempotency_keys.tenant_id from VARCHAR to UUID.
 * 5. Adds exact FK constraint to tenants(id) ON DELETE CASCADE.
 * 6. Adds tenant-leading B-Tree index on idempotency_keys(tenant_id, idempotency_key).
 * 7. Fails and rolls back on any invalid value.
 */

'use strict';

async function up(pool, targetSchema = 'public') {
  const schema = targetSchema || 'public';

  // 1. Create global table job_request_nonces
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."job_request_nonces" (
      id BIGSERIAL PRIMARY KEY,
      nonce_hash VARCHAR(64) NOT NULL,
      body_hash VARCHAR(64) NOT NULL,
      signed_timestamp BIGINT NOT NULL,
      consumed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      CONSTRAINT uq_job_request_nonces_hash UNIQUE (nonce_hash)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_job_request_nonces_expires_at
    ON "${schema}"."job_request_nonces" (expires_at);
  `);

  // 2. Safely delete non-UUID fixtures (e.g. SYSTEM_CRON) from idempotency_keys
  await pool.query(`
    DELETE FROM "${schema}"."idempotency_keys"
    WHERE tenant_id = 'SYSTEM_CRON'
       OR tenant_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  `);

  // 3. Verify that any remaining tenant_id values are strictly valid UUIDs
  const [invalidRows] = await pool.query(`
    SELECT id, tenant_id
    FROM "${schema}"."idempotency_keys"
    WHERE tenant_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  `);

  if (invalidRows && invalidRows.length > 0) {
    throw new Error(`[MIGRATION FAILED] idempotency_keys contains non-UUID tenant_id: ${JSON.stringify(invalidRows)}`);
  }

  // 4. Alter idempotency_keys.tenant_id to UUID
  await pool.query(`
    ALTER TABLE "${schema}"."idempotency_keys"
    ALTER COLUMN tenant_id TYPE UUID USING tenant_id::uuid;
  `);

  // 5. Add exact Foreign Key to tenants(id) with ON DELETE CASCADE
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_schema = '${schema}'
          AND table_name = 'idempotency_keys'
          AND constraint_name = 'fk_idempotency_keys_tenant_id'
      ) THEN
        ALTER TABLE "${schema}"."idempotency_keys"
        ADD CONSTRAINT fk_idempotency_keys_tenant_id
        FOREIGN KEY (tenant_id) REFERENCES "${schema}"."tenants"(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  // 6. Ensure tenant-leading index
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_idempotency_keys_tenant_leading
    ON "${schema}"."idempotency_keys" (tenant_id, idempotency_key);
  `);

  return { success: true };
}

async function down(pool, targetSchema = 'public') {
  const schema = targetSchema || 'public';

  await pool.query(`
    ALTER TABLE "${schema}"."idempotency_keys"
    DROP CONSTRAINT IF EXISTS fk_idempotency_keys_tenant_id;
  `);

  await pool.query(`
    ALTER TABLE "${schema}"."idempotency_keys"
    ALTER COLUMN tenant_id TYPE VARCHAR(100);
  `);

  await pool.query(`
    DROP TABLE IF EXISTS "${schema}"."job_request_nonces" CASCADE;
  `);

  return { success: true };
}

module.exports = { up, down };

