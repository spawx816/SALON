/**
 * Quarantine Fail-Closed Middleware
 * 
 * Intercepts requests accessing tenant-owned operational entities (salons, cash registers,
 * visits, ticket sequences) and blocks any access to records marked as 'quarantined' in
 * pending_tenant_reconciliations.
 * 
 * FAIL-CLOSED GUARANTEE: If the database check fails or errors out, execution is immediately
 * halted with HTTP 503 (Service Unavailable). It NEVER allows execution to continue.
 */
function createQuarantineGuard(pool, tableName, idExtractor) {
  return async (req, res, next) => {
    let recordId = null;

    try {
      if (typeof idExtractor === 'function') {
        recordId = idExtractor(req);
      } else if (typeof idExtractor === 'string') {
        recordId = req.params[idExtractor] || req.body[idExtractor] || req.query[idExtractor];
      } else {
        recordId = req.params.id || req.body.id;
      }

      // If no specific record ID is targeted by this route/method, pass to next handler
      if (!recordId) {
        return next();
      }

      const cleanRecordId = String(recordId).trim();

      // Check quarantine table
      const [rows] = await pool.query(
        "SELECT id, reason FROM pending_tenant_reconciliations WHERE table_name = ? AND record_id = ? AND status = 'quarantined' LIMIT 1",
        [tableName, cleanRecordId]
      );

      if (rows && rows.length > 0) {
        console.warn(`[QUARANTINE GUARD BLOCKED] Attempt to access quarantined record ${tableName}/${cleanRecordId}`);
        return res.status(423).json({
          error: 'RESOURCE_LOCKED_IN_QUARANTINE',
          code: 'QUARANTINE_VIOLATION',
          message: `El registro en '${tableName}' con ID '${cleanRecordId}' se encuentra en cuarentena de reconciliación y está bloqueado para operaciones de lectura, cobro, facturación o modificación.`,
          reason: rows[0].reason
        });
      }

      // Record is not in quarantine; continue
      return next();
    } catch (checkErr) {
      console.error(`[QUARANTINE GUARD FAIL-CLOSED]: Error verifying quarantine state for ${tableName}/${recordId}:`, checkErr.message);
      // STRICT FAIL-CLOSED: Return 503 and NEVER proceed
      return res.status(503).json({
        error: 'QUARANTINE_VERIFICATION_UNAVAILABLE',
        code: 'FAIL_CLOSED_ERROR',
        message: 'No fue posible verificar de forma segura el estado de cuarentena del recurso. Operación bloqueada preventivamente.'
      });
    }
  };
}

module.exports = {
  createQuarantineGuard
};

