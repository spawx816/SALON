/**
 * Migración Canónica: Hardening Multi-Tenant del Kiosco de Asistencia
 * - kiosk_devices: vinculación opaca de dispositivos por empresa y sucursal, revocable y con expiración.
 * - kiosk_employee_sessions: sesiones breves vinculadas a empleado + dispositivo + propósito ('punch' | 'self_service').
 * - security_settings: modo biométrico explícito ('pin_photo' | 'pin_face_verify') y umbral facial configurable.
 * - attendance: kiosk_device_id e idempotency_key único por tenant para evitar ponches duplicados.
 */
async function up(targetPool = null, targetSchema = 'public') {
  const effectivePool = targetPool || require('../db').pool;
  const conn = await effectivePool.getConnection();
  try {
    const schema = targetSchema || 'public';
    await conn.query('BEGIN');

    await conn.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".kiosk_devices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES "${schema}".tenants(id) ON DELETE CASCADE,
        branch_id VARCHAR(100) NOT NULL,
        device_name VARCHAR(120) NOT NULL,
        token_hash VARCHAR(128) NOT NULL UNIQUE,
        status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
        bound_by_user_id VARCHAR(100) NULL,
        bound_by_name VARCHAR(120) NULL,
        bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ NULL,
        revoked_by_user_id VARCHAR(100) NULL,
        revoked_reason VARCHAR(255) NULL
      );
    `);

    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_kiosk_devices_tenant_status
      ON "${schema}".kiosk_devices USING btree (tenant_id, status);
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".kiosk_employee_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID NOT NULL REFERENCES "${schema}".kiosk_devices(id) ON DELETE CASCADE,
        tenant_id UUID NOT NULL REFERENCES "${schema}".tenants(id) ON DELETE CASCADE,
        branch_id VARCHAR(100) NOT NULL,
        employee_id VARCHAR(100) NOT NULL,
        purpose VARCHAR(30) NOT NULL CHECK (purpose IN ('punch', 'self_service')),
        token_hash VARCHAR(128) NOT NULL UNIQUE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        expires_at TIMESTAMPTZ NOT NULL,
        last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        consumed_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await conn.query(`
      CREATE INDEX IF NOT EXISTS idx_kiosk_emp_sessions_lookup
      ON "${schema}".kiosk_employee_sessions USING btree (device_id, employee_id, purpose, is_active);
    `);

    await conn.query(`
      ALTER TABLE "${schema}".security_settings
      ADD COLUMN IF NOT EXISTS kiosk_biometric_mode VARCHAR(32) NOT NULL DEFAULT 'pin_photo';
    `);

    await conn.query(`
      ALTER TABLE "${schema}".security_settings
      ADD COLUMN IF NOT EXISTS kiosk_face_match_threshold NUMERIC(4,2) NOT NULL DEFAULT 0.75;
    `);

    await conn.query(`
      ALTER TABLE "${schema}".attendance
      ADD COLUMN IF NOT EXISTS kiosk_device_id UUID NULL;
    `);

    await conn.query(`
      ALTER TABLE "${schema}".attendance
      ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(120) NULL;
    `);

    await conn.query(`
      ALTER TABLE "${schema}".staff_records
      ADD COLUMN IF NOT EXISTS profile_photo_file_id VARCHAR(120) NULL;
    `);

    await conn.query(`
      ALTER TABLE "${schema}".users
      ADD COLUMN IF NOT EXISTS profile_photo_file_id VARCHAR(120) NULL;
    `);

    await conn.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_tenant_idempotency
      ON "${schema}".attendance (tenant_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    `);

    await conn.query('COMMIT');
    console.log(`[MIGRATION] 20261117_kiosk_devices_hardening aplicada en esquema "${schema}".`);
  } catch (err) {
    try { await conn.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  up().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { up };
