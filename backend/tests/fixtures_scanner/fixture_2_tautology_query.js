/**
 * Scanner Negative Fixture 2: Tautological Filter Query
 */
async function getVisitsWithBypass(pool) {
  // Violation: Tautology where tenant_id filter evaluates to TRUE for all tenants
  const query = 'SELECT id, total FROM visits WHERE (tenant_id IS NOT NULL OR tenant_id IS NULL) AND status = ?';
  const [rows] = await pool.query(query, ['Facturado']);
  return rows;
}

module.exports = { getVisitsWithBypass };

