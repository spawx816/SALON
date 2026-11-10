const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../db');

/**
 * Rollback Controlado: Migración Correctiva Fase 1
 * Usa conexión dedicada y preserva conciliaciones legítimas posteriores.
 */
async function rollbackCorrectiveMigration() {
  console.log('===============================================================');
  console.log('⏪ INICIANDO ROLLBACK CONTROLADO - MIGRACIÓN CORRECTIVA FASE 1');
  console.log('===============================================================\n');

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Eliminar únicamente las 7 entradas registradas por esta versión de migración
    const ambiguousKeys = [
      ['salons', '1'],
      ['salons', '7f546f61-6410-4002-8198-bce72379d9f9'],
      ['cash_registers', 'd39c296c-9a2d-43ac-9204-c56ee1a0c33e'],
      ['visits', '1791819025880'],
      ['ticket_sequences', '3'],
      ['ticket_sequences', '4'],
      ['ticket_sequences', '1']
    ];

    for (const [table, id] of ambiguousKeys) {
      await conn.query(`
        DELETE FROM pending_tenant_reconciliations 
        WHERE table_name = ? AND record_id = ? AND status = 'unresolved'
      `, [table, id]);
    }

    // Actualizar estado en schema_migrations
    await conn.query(`
      UPDATE schema_migrations 
      SET status = 'rolled_back', applied_at = NOW() 
      WHERE version = '20261108_phase1_corrective'
    `);

    await conn.commit();
    console.log('✅ Rollback completado exitosamente sin afectar registros posteriores.');
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error en rollback:', err.message);
    throw err;
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  rollbackCorrectiveMigration().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { rollbackCorrectiveMigration };
