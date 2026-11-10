/**
 * Migration: 20261110_phase3b_storage_and_portability
 * (backend/migrations/20261110_phase3b_storage_and_portability.cjs)
 *
 * Requirements (Phase 3B.2B):
 * 1. Creates private_files table with tenant-owned foreign key and AES-256-GCM metadata.
 * 2. Creates tenant_exports table with tenant isolation and 24h token tracking.
 * 3. Adds photo_file_id reference to attendance.
 * 4. Adds signature_file_id, document_photo_file_id, selfie_photo_file_id references to contracts.
 * 5. Adds profile_photo_file_id to users and staff_records.
 * 6. 100% idempotent and compatible with isolated test schemas.
 */

'use strict';

async function up(pool, targetSchema = 'public') {
  const schema = targetSchema || 'public';

  // 1. Create table private_files
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."private_files" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES "${schema}"."tenants"(id) ON DELETE CASCADE,
      category VARCHAR(50) NOT NULL,
      mime_type VARCHAR(100) NOT NULL,
      byte_size BIGINT NOT NULL,
      sha256_hash VARCHAR(64) NOT NULL,
      storage_path VARCHAR(255) NOT NULL,
      encryption_iv VARCHAR(32) NOT NULL,
      encryption_tag VARCHAR(32) NOT NULL,
      retention_until TIMESTAMP WITH TIME ZONE NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP WITH TIME ZONE NULL
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_private_files_tenant_id 
    ON "${schema}"."private_files" (tenant_id, category);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_private_files_retention 
    ON "${schema}"."private_files" (retention_until) 
    WHERE deleted_at IS NULL;
  `);

  // 2. Create table tenant_exports
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."tenant_exports" (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES "${schema}"."tenants"(id) ON DELETE CASCADE,
      requested_by_user_id UUID NOT NULL REFERENCES "${schema}"."users"(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'completed',
      reason TEXT NOT NULL,
      file_id UUID NOT NULL REFERENCES "${schema}"."private_files"(id) ON DELETE CASCADE,
      download_token_hash VARCHAR(64) NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      idempotency_key VARCHAR(100) NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_tenant_exports_tenant_id 
    ON "${schema}"."tenant_exports" (tenant_id, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_tenant_exports_token 
    ON "${schema}"."tenant_exports" (download_token_hash);
  `);

  // 3. Alter attendance: add photo_file_id
  await pool.query(`
    ALTER TABLE "${schema}"."attendance" 
    ADD COLUMN IF NOT EXISTS photo_file_id UUID NULL 
    REFERENCES "${schema}"."private_files"(id) ON DELETE SET NULL;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_attendance_photo_file_id 
    ON "${schema}"."attendance" (tenant_id, photo_file_id);
  `);

  // 4. Alter contracts: add signature_file_id, document_photo_file_id, selfie_photo_file_id
  await pool.query(`
    ALTER TABLE "${schema}"."contracts" 
    ADD COLUMN IF NOT EXISTS signature_file_id UUID NULL 
    REFERENCES "${schema}"."private_files"(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS document_photo_file_id UUID NULL 
    REFERENCES "${schema}"."private_files"(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS selfie_photo_file_id UUID NULL 
    REFERENCES "${schema}"."private_files"(id) ON DELETE SET NULL;
  `);

  // 5. Alter users: add profile_photo_file_id
  await pool.query(`
    ALTER TABLE "${schema}"."users" 
    ADD COLUMN IF NOT EXISTS profile_photo_file_id UUID NULL 
    REFERENCES "${schema}"."private_files"(id) ON DELETE SET NULL;
  `);

  // 6. Alter staff_records: add profile_photo_file_id
  await pool.query(`
    ALTER TABLE "${schema}"."staff_records" 
    ADD COLUMN IF NOT EXISTS profile_photo_file_id UUID NULL 
    REFERENCES "${schema}"."private_files"(id) ON DELETE SET NULL;
  `);
}

module.exports = { up };
