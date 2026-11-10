/**
 * Scanner Negative Fixture 4: Standalone worker outside routes executing raw un-scoped queries
 */
async function standaloneWorkerSync(conn) {
  // Violation: accesses tenant-owned contracts table without tenant context
  const [rows] = await conn.query("SELECT id, plan_id, client_id FROM contracts WHERE status = 'Active'");
  return rows;
}

module.exports = { standaloneWorkerSync };

