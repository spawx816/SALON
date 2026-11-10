const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { pool } = require('../db');

const ALLOWED_QUARANTINE_TABLES = Object.freeze(['salons', 'cash_registers', 'visits', 'ticket_sequences']);

/**
 * Procedimiento Auditable de Resolución de Registros en Cuarentena
 * 
 * Uso:
 * node resolve_quarantine_record.cjs --table <table_name> --id <record_id> --tenant <tenant_uuid> --reason "<justification>" --actor "<user>"
 */
async function resolveQuarantineRecord({ tableName, recordId, targetTenantId, reason, actor = 'SuperAdmin_Auditor' }) {
  if (!tableName || !recordId || !targetTenantId || !reason) {
    throw new Error('Parámetros requeridos: tableName, recordId, targetTenantId, reason');
  }

  // 0. Validación de lista blanca cerrada y formato de parámetros (Fail-Closed)
  if (!ALLOWED_QUARANTINE_TABLES.includes(tableName)) {
    throw new Error(`Tabla no permitida para resolución de cuarentena: '${tableName}'. Tablas autorizadas: [${ALLOWED_QUARANTINE_TABLES.join(', ')}]`);
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(String(recordId))) {
    throw new Error(`Formato de recordId inválido: '${recordId}'. Solo se permiten caracteres alfanuméricos.`);
  }

  const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID_V4_REGEX.test(String(targetTenantId))) {
    throw new Error(`targetTenantId debe ser un UUID v4 válido. Recibido: '${targetTenantId}'`);
  }

  if (typeof reason !== 'string' || reason.trim().length < 10) {
    throw new Error('El motivo de resolución (--reason) debe ser una justificación descriptiva de al menos 10 caracteres.');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Validar que el tenant de destino exista
    const [tRows] = await conn.query('SELECT id, business_name FROM tenants WHERE id = ?', [targetTenantId]);
    if (tRows.length === 0) {
      throw new Error(`El tenant de destino '${targetTenantId}' no existe en la base de datos.`);
    }
    const tenantName = tRows[0].business_name;

    // 2. Validar que el registro esté actualmente en cuarentena
    const [qRows] = await conn.query(
      "SELECT * FROM pending_tenant_reconciliations WHERE table_name = ? AND record_id = ? AND status = 'quarantined' FOR UPDATE",
      [tableName, String(recordId)]
    );
    if (qRows.length === 0) {
      throw new Error(`El registro ${tableName}/${recordId} no está en estado 'quarantined'.`);
    }

    // 3. Activar pase de seguridad de sesión en PostgreSQL para autorizar la modificación
    await conn.query("SET LOCAL salon.authorized_quarantine_resolution = 'true'");

    // 4. Actualizar el tenant_id en la tabla destino
    const [updateResult] = await conn.query(
      `UPDATE ${tableName} SET tenant_id = ? WHERE id::text = ?`,
      [targetTenantId, String(recordId)]
    );
    if (updateResult.affectedRows === 0) {
      throw new Error(`No se pudo actualizar el registro en la tabla ${tableName} con ID ${recordId}`);
    }

    // 5. Actualizar la tabla de control de reconciliaciones
    await conn.query(`
      UPDATE pending_tenant_reconciliations 
      SET status = 'resolved',
          resolved_at = NOW(),
          resolved_tenant_id = ?
      WHERE table_name = ? AND record_id = ?
    `, [targetTenantId, tableName, String(recordId)]);

    // 6. Registrar en audit_logs de forma inmutable
    await conn.query(`
      INSERT INTO audit_logs (table_name, record_id, action, changed_by, notes, tenant_id, created_at)
      VALUES (?, ?, 'QUARANTINE_RESOLVED', ?, ?, ?, NOW())
    `, [
      tableName,
      String(recordId),
      actor,
      `Resolución de cuarentena asignada formalmente a inquilino ${tenantName} (${targetTenantId}). Justificación: ${reason}`,
      targetTenantId
    ]);

    await conn.commit();

    console.log(`✅ Registro ${tableName}/${recordId} resuelto y asignado formalmente al inquilino '${tenantName}' (${targetTenantId}).`);
    return {
      success: true,
      tableName,
      recordId,
      resolvedTenantId: targetTenantId,
      tenantName,
      status: 'resolved'
    };
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error resolviendo registro en cuarentena:', err.message);
    throw err;
  } finally {
    conn.release();
  }
}

// CLI Execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : null;
  };

  const tableName = getArg('--table');
  const recordId = getArg('--id');
  const targetTenantId = getArg('--tenant');
  const reason = getArg('--reason');
  const actor = getArg('--actor') || 'SuperAdmin_Auditor';

  if (!tableName || !recordId || !targetTenantId || !reason) {
    console.log('Uso: node resolve_quarantine_record.cjs --table <table_name> --id <record_id> --tenant <tenant_uuid> --reason "<justification>" [--actor "<name>"]');
    process.exit(1);
  }

  resolveQuarantineRecord({ tableName, recordId, targetTenantId, reason, actor })
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { resolveQuarantineRecord };

