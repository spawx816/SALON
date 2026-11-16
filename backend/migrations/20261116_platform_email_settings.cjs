const { pool: defaultPool } = require('../db');

/**
 * Migración Canónica: Tabla Global de Correo SMTP del Sistema (platform_email_settings)
 * - Clasificación: Tabla Global / Control Plane (sin tenant_id).
 * - Garantiza una única fila global mediante CHECK (id = 1) y PRIMARY KEY.
 * - Almacena el secreto SMTP cifrado con AES-256-GCM (ciphertext + iv + auth tag).
 * - Idempotente sobre cualquier esquema objetivo.
 */
async function up(targetPool = defaultPool, targetSchema = 'public') {
  const conn = await targetPool.getConnection();
  try {
    const schema = targetSchema || 'public';
    await conn.query('BEGIN');

    await conn.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".platform_email_settings (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        smtp_host VARCHAR(255) NOT NULL,
        smtp_port INTEGER NOT NULL DEFAULT 587 CHECK (smtp_port > 0 AND smtp_port <= 65535),
        smtp_user VARCHAR(255) NOT NULL,
        smtp_pass_encrypted TEXT NOT NULL,
        smtp_pass_iv VARCHAR(64) NOT NULL,
        smtp_pass_tag VARCHAR(64) NOT NULL,
        smtp_from VARCHAR(255) NOT NULL DEFAULT 'Etereas',
        smtp_secure BOOLEAN NOT NULL DEFAULT FALSE,
        updated_by_user_id VARCHAR(100),
        updated_by_email VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await conn.query('COMMIT');
    return true;
  } catch (err) {
    await conn.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  up()
    .then(() => {
      console.log('✅ Migración 20261116_platform_email_settings completada.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Error en migración 20261116_platform_email_settings:', err);
      process.exit(1);
    });
}

module.exports = { up };
