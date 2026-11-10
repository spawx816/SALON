/**
 * Scanner Negative Fixture 9: Unscoped queries against Phase 2D SaaS Billing tables
 */
async function getUnscopedSaasInvoices(pool, status) {
  // Violation: queries tenant-owned table 'saas_invoices' without tenant_id filter
  const [rows] = await pool.query('SELECT id, invoice_number, total_minor FROM saas_invoices WHERE status = ?', [status]);
  return rows;
}

async function updateUnscopedSaasRefund(pool, refundId, status) {
  // Violation: updates tenant-owned table 'saas_refunds' without tenant_id filter
  await pool.query('UPDATE saas_refunds SET status = ? WHERE id = ?', [status, refundId]);
}

module.exports = { getUnscopedSaasInvoices, updateUnscopedSaasRefund };

