/**
 * Scanner Negative Fixture 3: Unanalyzable Dynamic SQL Query
 */
async function executeOpaqueQuery(pool, userInput) {
  // Violation: Function call inside query argument cannot be determined statically via AST
  const dynamicSql = calculateDynamicQueryString(userInput);
  const [rows] = await pool.query(dynamicSql);
  return rows;
}

function calculateDynamicQueryString(input) {
  return 'SELECT * FROM staff_records WHERE code = ' + input;
}

module.exports = { executeOpaqueQuery };

