const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../db');

/**
 * Migración de Reconciliación Histórica y Cuarentena (Fase 1)
 * 
 * Reglas de Seguridad y Negocio:
 * 1. Separa estrictamente la reconciliación histórica de la migración estructural DDL.
 * 2. Bloquea formalmente las 7 filas ambiguas en `pending_tenant_reconciliations` con estado 'quarantined'.
 * 3. NO asigna, NO elimina y NO activa automáticamente ninguno de estos 7 registros.
 * 4. Las secuencias fiscales y tickets asociados permanecen para conciliación manual DGII.
 * 5. Idempotente con clave única (table_name, record_id).
 */
async function runHistoricalReconciliation(targetPool = pool, targetSchema = null) {
  console.log('========================================================================');
  console.log('🔒 INICIANDO RECONCILIACIÓN HISTÓRICA Y CUARENTENA (FASE 1)');
  console.log('========================================================================\n');

  const conn = await targetPool.getConnection();

  try {
    await conn.beginTransaction();
    console.log('[TX] Conexión dedicada adquirida.');

    if (targetSchema) {
      await conn.query(`SET search_path TO ${targetSchema}, public;`);
    }

    // 1. Asegurar tabla pending_tenant_reconciliations
    await conn.query(`
      CREATE TABLE IF NOT EXISTS pending_tenant_reconciliations (
        id SERIAL PRIMARY KEY,
        table_name VARCHAR(100) NOT NULL,
        record_id VARCHAR(100) NOT NULL,
        reason VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'quarantined',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        resolved_at TIMESTAMP WITH TIME ZONE NULL,
        resolved_tenant_id UUID NULL
      );
    `);
    await conn.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_rec_table_record 
      ON pending_tenant_reconciliations (table_name, record_id);
    `);

    // 2. Definición estricta de las 7 filas en cuarentena
    const quarantinedRows = [
      {
        table: 'salons',
        id: '1',
        reason: 'Salón 1 (Glamour Sede Central Lincoln) legacy con mapeo cruzado'
      },
      {
        table: 'salons',
        id: '7f546f61-6410-4002-8198-bce72379d9f9',
        reason: 'Salón UUID vinculado a branch Piantini'
      },
      {
        table: 'cash_registers',
        id: 'd39c296c-9a2d-43ac-9204-c56ee1a0c33e',
        reason: 'Caja con salon_id UUID de branch Piantini'
      },
      {
        table: 'visits',
        id: '1791819025880',
        reason: 'Visita histórica SCP-0001 con salon_id UUID'
      },
      {
        table: 'ticket_sequences',
        id: '1',
        reason: 'Secuencia fiscal salon_id 1 requiere conciliación manual DGII'
      },
      {
        table: 'ticket_sequences',
        id: '3',
        reason: 'Secuencia fiscal salon_id UUID requiere conciliación manual DGII'
      },
      {
        table: 'ticket_sequences',
        id: '4',
        reason: 'Secuencia fiscal salon_id 7 sin branch requiere conciliación manual DGII'
      }
    ];

    console.log(`[1/2] Bloqueando ${quarantinedRows.length} registros ambiguos en cuarentena...`);

    for (const item of quarantinedRows) {
      try {
        await conn.query(`
          INSERT INTO pending_tenant_reconciliations (table_name, record_id, reason, status)
          VALUES (?, ?, ?, 'quarantined')
          ON CONFLICT (table_name, record_id) DO UPDATE
          SET status = 'quarantined',
              reason = EXCLUDED.reason,
              resolved_at = NULL,
              resolved_tenant_id = NULL;
        `, [item.table, item.id, item.reason]);
      } catch (insertErr) {
        console.error(`Error inserting into pending_tenant_reconciliations for ${item.table}:${item.id}:`, insertErr.message);
        throw insertErr;
      }
    }

    // 3. Registrar versión en schema_migrations
    await conn.query(`
      INSERT INTO schema_migrations (version, actor, status)
      VALUES ('20261108_phase1_historical_reconciliation', 'system_migration_runner', 'APPLIED')
      ON CONFLICT (version) DO UPDATE 
      SET applied_at = NOW(), status = 'RE_VERIFIED';
    `);

    await conn.commit();

    // 4. Verificación de conteo de filas en cuarentena
    const [countRows] = await conn.query(`
      SELECT COUNT(*) as count 
      FROM pending_tenant_reconciliations 
      WHERE status = 'quarantined'
    `);
    const totalQuarantined = parseInt(countRows[0].count, 10);
    console.log(`\n✅ RECONCILIACIÓN COMPLETADA: ${totalQuarantined} registros en cuarentena auditada.`);
    console.log('ℹ️ Ninguna fila ambigua fue asignada, borrada ni habilitada automáticamente.');

    return { success: true, quarantinedCount: totalQuarantined };
  } catch (err) {
    await conn.rollback();
    console.error('❌ ERROR EN RECONCILIACIÓN HISTÓRICA:', err.message);
    throw err;
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  runHistoricalReconciliation()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { runHistoricalReconciliation };
