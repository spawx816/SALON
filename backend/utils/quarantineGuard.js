/**
 * Quarantine Guard Utility
 * 
 * Protects against operations, fiscal emission, or updates on records
 * that are currently quarantined in `pending_tenant_reconciliations`.
 */

async function isRecordQuarantined(pool, tableName, recordId) {
  if (!recordId) return false;
  try {
    const [rows] = await pool.query(
      "SELECT id, reason FROM pending_tenant_reconciliations WHERE table_name = ? AND record_id = ? AND status = 'quarantined' LIMIT 1",
      [tableName, String(recordId)]
    );
    return rows.length > 0 ? rows[0] : false;
  } catch (err) {
    console.error(`[QUARANTINE GUARD ERROR] Failed to check ${tableName}/${recordId}:`, err.message);
    return false;
  }
}

function quarantineMiddleware(tableName, getRecordIdFn) {
  return async (req, res, next) => {
    const pool = req.app.get('pool') || require('../db').pool;
    const recordId = getRecordIdFn(req);
    if (!recordId) return next();

    const quarantined = await isRecordQuarantined(pool, tableName, recordId);
    if (quarantined) {
      return res.status(423).json({
        error: 'QUARANTINE_LOCKED',
        message: `El recurso '${tableName}' (ID: ${recordId}) se encuentra en cuarentena de aislamiento multi-tenant y tiene bloqueadas las operaciones fiscales o modificaciones. Motivo: ${quarantined.reason}`
      });
    }
    next();
  };
}

module.exports = {
  isRecordQuarantined,
  quarantineMiddleware
};

