/**
 * Scanner Negative Fixture 8: Unscoped queries against Phase 2B Inventory tables
 */
async function getUnscopedInventoryStock(pool, productId) {
  // Violation: queries tenant-owned table 'inventory_stock' without tenant_id filter
  const [rows] = await pool.query('SELECT product_id, location_id, on_hand FROM inventory_stock WHERE product_id = ?', [productId]);
  return rows;
}

async function updateUnscopedInventoryProduct(pool, productId, name) {
  // Violation: updates tenant-owned table 'inventory_products' without tenant_id filter
  await pool.query('UPDATE inventory_products SET name = ? WHERE id = ?', [name, productId]);
}

module.exports = { getUnscopedInventoryStock, updateUnscopedInventoryProduct };

