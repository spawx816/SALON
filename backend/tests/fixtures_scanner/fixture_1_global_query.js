/**
 * Scanner Negative Fixture 1: Global Query without tenant_id scoping
 */
async function getUnscopedClients(pool, status) {
  // Violation: queries tenant-owned table 'clients' with WHERE status = ? but no tenant_id filter
  const [rows] = await pool.query('SELECT id, nombre, telefono FROM clients WHERE status = ?', [status]);
  return rows;
}

module.exports = { getUnscopedClients };

