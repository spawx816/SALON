const { pool } = require('../db');

async function applyQuarantineTriggers() {
  console.log('🛡️ Instalando función y triggers de cuarentena estricta en PostgreSQL...');
  const conn = await pool.getConnection();
  try {
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

    const tables = ['salons', 'cash_registers', 'visits', 'ticket_sequences'];
    for (const t of tables) {
      await conn.query(`DROP TRIGGER IF EXISTS trg_quarantine_${t} ON ${t};`);
      await conn.query(`
        CREATE TRIGGER trg_quarantine_${t}
        BEFORE UPDATE OR DELETE ON ${t}
        FOR EACH ROW EXECUTE FUNCTION fn_enforce_quarantine_block();
      `);
      console.log(`  ✅ Trigger trg_quarantine_${t} activado.`);
    }

    console.log('✅ Triggers de cuarentena instalados exitosamente.');
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  applyQuarantineTriggers()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { applyQuarantineTriggers };

