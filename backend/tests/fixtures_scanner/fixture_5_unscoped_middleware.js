// Negative Fixture 5: Unscoped query inside middleware
module.exports = async function sampleMiddleware(req, res, next) {
  const { pool } = require('../../db');
  // VIOLATION: Accessing tenant-owned table 'clients' without tenant_id scoping
  const [rows] = await pool.query('SELECT * FROM clients WHERE email = ?', [req.body.email]);
  req.client = rows[0];
  next();
};

