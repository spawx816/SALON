const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../db');

/**
 * Migración Correctiva Transaccional e Idempotente - Fase 1
 * 
 * Reglas de Seguridad:
 * 1. Usa conexión dedicada (pool.getConnection()) para transaccionalidad real en PostgreSQL.
 * 2. NO convierte columnas a NOT NULL mientras existan ambigüedades.
 * 3. Desasocia cuentas SuperAdmin de cualquier tenant_id fijo (ámbito global = NULL).
 * 4. Preserva registros ambiguos sin asignación forzada.
 * 5. Registra la versión en schema_migrations e impone restricción UNIQUE en (table_name, record_id).
 */
async function runCorrectiveMigration() {
  console.log('===============================================================');
  console.log('🛡️ INICIANDO MIGRACIÓN CORRECTIVA TRANSACCIONAL - FASE 1');
  console.log('===============================================================\n');

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    console.log('[TX] Conexión dedicada adquirida y transacción iniciada.');

    // 0. Tabla de control de migraciones
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(100) PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        actor VARCHAR(100) NOT NULL,
        status VARCHAR(50) NOT NULL
      )
    `);

    // 1. Asegurar que las cuentas SuperAdmin tengan tenant_id = NULL y branch_id = NULL
    console.log('[1/5] Normalizando cuentas SuperAdmin a alcance global...');
    await conn.query(`
      UPDATE users 
      SET tenant_id = NULL, branch_id = NULL 
      WHERE LOWER(role) = 'superadmin'
    `);

    // 2. Desasociar sesiones de SuperAdmin de cualquier tenant fijo
    console.log('[2/5] Normalizando sesiones de SuperAdmin...');
    await conn.query(`
      UPDATE user_sessions 
      SET tenant_id = NULL 
      WHERE LOWER(role) = 'superadmin'
    `);

    // 3. Crear tabla de auditoría para registrar registros clasificados como ambiguos
    console.log('[3/5] Creando tabla de registro de ambigüedades pendientes con restricción única...');
    await conn.query(`
      CREATE TABLE IF NOT EXISTS pending_tenant_reconciliations (
        id SERIAL PRIMARY KEY,
        table_name VARCHAR(100) NOT NULL,
        record_id VARCHAR(100) NOT NULL,
        reason VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'unresolved',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        resolved_at TIMESTAMP WITH TIME ZONE NULL,
        resolved_tenant_id UUID NULL
      )
    `);
    await conn.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_rec_table_record 
      ON pending_tenant_reconciliations (table_name, record_id)
    `);

    // 4. Registrar ambigüedades detectadas formalmente (idempotente)
    console.log('[4/5] Registrando ambigüedades detectadas en tabla de auditoría...');
    const ambiguousItems = [
      { table: 'salons', id: '1', reason: 'Salón 1 (Glamour Sede Central) legacy con mapeo cruzado' },
      { table: 'salons', id: '7f546f61-6410-4002-8198-bce72379d9f9', reason: 'Salón UUID vinculado a branch' },
      { table: 'cash_registers', id: 'd39c296c-9a2d-43ac-9204-c56ee1a0c33e', reason: 'Caja con salon_id UUID de branch' },
      { table: 'visits', id: '1791819025880', reason: 'Visita histórica con salon_id UUID' },
      { table: 'ticket_sequences', id: '3', reason: 'Secuencia salon_id 7f546f61-6410-4002-8198-bce72379d9f9' },
      { table: 'ticket_sequences', id: '4', reason: 'Secuencia salon_id 7 sin branch asignada' },
      { table: 'ticket_sequences', id: '1', reason: 'Secuencia salon_id 1' }
    ];

    for (const item of ambiguousItems) {
      try {
        await conn.query(`
          INSERT INTO pending_tenant_reconciliations (table_name, record_id, reason)
          VALUES (?, ?, ?)
          ON CONFLICT (table_name, record_id) DO NOTHING
        `, [item.table, item.id, item.reason]);
      } catch (insErr) {
        console.error(`Error inserting ambiguity ${item.table}:${item.id}:`, insErr);
        throw insErr;
      }
    }

    // 5. Registrar ejecución en schema_migrations
    console.log('[5/5] Registrando versión de migración en schema_migrations...');
    try {
      await conn.query(`
        INSERT INTO schema_migrations (version, actor, status)
        VALUES ('20261108_phase1_corrective', 'system_security', 'applied')
        ON CONFLICT (version) DO UPDATE SET applied_at = NOW(), status = 'applied'
      `);
    } catch (migErr) {
      console.error('Error inserting schema_migrations:', migErr);
      throw migErr;
    }

    await conn.commit();
    console.log('\n✅ [TX] Transacción confirmada exitosamente mediante conexión dedicada.');
    console.log('✅ Migración correctiva completada sin forzar asignaciones dudosas.\n');
    return { success: true };
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error en migración correctiva, rollback ejecutado:', err.message);
    throw err;
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  runCorrectiveMigration().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { runCorrectiveMigration };
