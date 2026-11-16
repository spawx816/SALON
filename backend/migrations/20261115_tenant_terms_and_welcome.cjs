const { pool: defaultPool } = require('../db');

/**
 * Migración Canónica: Tablas para Términos y Condiciones y Cola de Correos de Bienvenida
 * - tenant_terms_acceptances
 * - tenant_welcome_email_queue
 * - Idempotente sobre cualquier esquema objetivo.
 */
async function up(targetPool = defaultPool, targetSchema = 'public') {
  const conn = await targetPool.getConnection();
  try {
    const schema = targetSchema || 'public';
    await conn.query('BEGIN');

    // 1. Tabla de aceptación de términos
    await conn.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".tenant_terms_acceptances (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        user_id INT NOT NULL,
        terms_version VARCHAR(50) NOT NULL,
        document_hash VARCHAR(128) NOT NULL,
        accepted_at_utc TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        acceptance_mechanism VARCHAR(100) NOT NULL,
        ip_address VARCHAR(50),
        user_agent TEXT,
        recurring_authorized BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_tenant_terms_tenant ON "${schema}".tenant_terms_acceptances(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_tenant_terms_version ON "${schema}".tenant_terms_acceptances(terms_version);
    `);

    // 2. Tabla de cola persistente para correo de bienvenida
    await conn.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".tenant_welcome_email_queue (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        recipient_email VARCHAR(255) NOT NULL,
        recipient_name VARCHAR(255),
        company_name VARCHAR(255) NOT NULL,
        terms_version VARCHAR(50) NOT NULL,
        account_status VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        attempts INT NOT NULL DEFAULT 0,
        last_error TEXT,
        idempotency_key VARCHAR(128) UNIQUE NOT NULL,
        sent_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_welcome_email_status ON "${schema}".tenant_welcome_email_queue(status);
      CREATE INDEX IF NOT EXISTS idx_welcome_email_tenant ON "${schema}".tenant_welcome_email_queue(tenant_id);
    `);

    await conn.query('COMMIT');
    console.log('✅ Migración 20261115_tenant_terms_and_welcome completada.');
  } catch (err) {
    await conn.query('ROLLBACK');
    console.error('❌ Error en migración 20261115_tenant_terms_and_welcome:', err);
    throw err;
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  up()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { up, runMigration: up };
