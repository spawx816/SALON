/**
 * Migration: 20261108_phase1_quarantine_triggers
 *
 * Formally creates the quarantine control table, enforcement function, and triggers
 * in the active database schema to prevent tampering with quarantined records.
 */
const { pool } = require('../db');

async function up(targetPool = pool, targetSchema = null) {
  console.log('🛡️ [MIGRATION 20261108] Aplicando estructura de cuarentena estricta...');
  const conn = await targetPool.getConnection();
  try {
    await conn.beginTransaction();

    const schema = targetSchema || 'public';
    if (targetSchema) {
      await conn.query(`SET search_path TO ${targetSchema}, public;`);
    }

    // 1. Crear tabla de control de reconciliaciones si no existe
    await conn.query(`
      CREATE TABLE IF NOT EXISTS pending_tenant_reconciliations (
        id SERIAL PRIMARY KEY,
        table_name VARCHAR(100) NOT NULL,
        record_id VARCHAR(255) NOT NULL,
        reason TEXT NOT NULL,
        quarantined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        status VARCHAR(50) DEFAULT 'quarantined',
        resolved_at TIMESTAMP WITH TIME ZONE,
        resolved_tenant_id UUID,
        metadata JSONB,
        CONSTRAINT uq_quarantine_record UNIQUE (table_name, record_id)
      );
      CREATE INDEX IF NOT EXISTS idx_quarantine_lookup ON pending_tenant_reconciliations (table_name, record_id, status);
    `);

    // 2. Crear función de bloqueo
    await conn.query(`
      CREATE OR REPLACE FUNCTION fn_enforce_quarantine_block()
      RETURNS TRIGGER AS $$
      DECLARE
        v_is_quarantined BOOLEAN := FALSE;
        v_authorized TEXT := 'false';
      BEGIN
        BEGIN
          v_authorized := current_setting('salon.authorized_quarantine_resolution', true);
        EXCEPTION WHEN OTHERS THEN
          v_authorized := 'false';
        END;

        IF v_authorized = 'true' THEN
          IF TG_OP = 'DELETE' THEN
            RETURN OLD;
          ELSE
            RETURN NEW;
          END IF;
        END IF;

        SELECT EXISTS (
          SELECT 1 FROM pending_tenant_reconciliations 
          WHERE table_name = TG_TABLE_NAME 
            AND record_id = OLD.id::text 
            AND status = 'quarantined'
        ) INTO v_is_quarantined;

        IF v_is_quarantined THEN
          RAISE EXCEPTION 'QUARANTINE_VIOLATION: Record % in table % is quarantined in pending_tenant_reconciliations and cannot be updated, deleted, or reassigned without authorized resolution.', OLD.id, TG_TABLE_NAME;
        END IF;

        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        ELSE
          RETURN NEW;
        END IF;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // 3. Crear triggers en tablas auditadas
    const tables = ['salons', 'cash_registers', 'visits', 'ticket_sequences'];
    for (const t of tables) {
      await conn.query(`DROP TRIGGER IF EXISTS trg_quarantine_${t} ON ${t};`);
      await conn.query(`
        CREATE TRIGGER trg_quarantine_${t}
        BEFORE UPDATE OR DELETE ON ${t}
        FOR EACH ROW EXECUTE FUNCTION fn_enforce_quarantine_block();
      `);
    }

    // 4. Verificación de instalación de triggers
    const [triggerRows] = await conn.query(`
      SELECT trigger_name, event_object_table 
      FROM information_schema.triggers 
      WHERE trigger_name LIKE 'trg_quarantine_%'
        AND trigger_schema = ?;
    `, [schema]);

    if (triggerRows.length < 4) {
      throw new Error(`Se esperaban al menos 4 triggers de cuarentena, pero se encontraron ${triggerRows.length}`);
    }

    await conn.commit();
    console.log(`✅ [MIGRATION 20261108] Cuarentena instalada y verificada (${triggerRows.length} triggers activos).`);
  } catch (err) {
    await conn.rollback();
    console.error('❌ [MIGRATION 20261108 ERROR]: Fallo al aplicar cuarentena:', err.message);
    throw err;
  } finally {
    conn.release();
  }
}

async function down(targetPool = pool) {
  const conn = await targetPool.getConnection();
  try {
    await conn.beginTransaction();
    const tables = ['salons', 'cash_registers', 'visits', 'ticket_sequences'];
    for (const t of tables) {
      await conn.query(`DROP TRIGGER IF EXISTS trg_quarantine_${t} ON ${t};`);
    }
    await conn.query('DROP FUNCTION IF EXISTS fn_enforce_quarantine_block();');
    await conn.commit();
    console.log('✅ [MIGRATION 20261108 ROLLBACK] Triggers de cuarentena removidos.');
  } catch (err) {
    await conn.rollback();
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

module.exports = { up, down };

