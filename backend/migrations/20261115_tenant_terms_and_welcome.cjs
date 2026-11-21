/**
 * Migración Canónica: Tablas para Términos y Condiciones y Cola de Correos de Bienvenida
 * - tenant_terms_acceptances
 * - tenant_welcome_email_queue
 * - Idempotente sobre cualquier esquema objetivo.
 */
async function up(targetPool = null, targetSchema = 'public') {
  const effectivePool = targetPool || require('../db').pool;
  const conn = await effectivePool.getConnection();
  try {
    const schema = targetSchema || 'public';
    await conn.query('BEGIN');

    // 1. Tabla de aceptación de términos (UUID consistente con tenants.id y users.id)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".tenant_terms_acceptances (
        id SERIAL PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES "${schema}".tenants(id) ON DELETE CASCADE,
        user_id UUID NOT NULL,
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
        tenant_id UUID NOT NULL REFERENCES "${schema}".tenants(id) ON DELETE CASCADE,
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

    // 3. Reparar columnas legacy INT -> UUID si las tablas existían de una versión previa sin datos UUID
    await conn.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = '${schema}' AND table_name = 'tenant_terms_acceptances'
            AND column_name = 'tenant_id' AND data_type = 'integer'
        ) THEN
          ALTER TABLE "${schema}".tenant_terms_acceptances
            ALTER COLUMN tenant_id TYPE UUID USING NULL::uuid,
            ALTER COLUMN user_id TYPE UUID USING NULL::uuid;
        END IF;
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = '${schema}' AND table_name = 'tenant_welcome_email_queue'
            AND column_name = 'tenant_id' AND data_type = 'integer'
        ) THEN
          ALTER TABLE "${schema}".tenant_welcome_email_queue
            ALTER COLUMN tenant_id TYPE UUID USING NULL::uuid;
        END IF;
      END $$;
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
