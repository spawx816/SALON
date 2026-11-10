// Negative Fixture 7: Unscoped query inside server handler
async function handleServerNotification(invoiceId) {
  const { pool } = require('../../db');
  // VIOLATION: Accessing tenant-owned table 'invoices' without tenant_id scoping
  const [invoices] = await pool.query('SELECT total, client_id FROM invoices WHERE id = ?', [invoiceId]);
  return invoices;
}

module.exports = { handleServerNotification };

