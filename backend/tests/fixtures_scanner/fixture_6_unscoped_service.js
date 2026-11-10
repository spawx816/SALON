// Negative Fixture 6: Unscoped query inside service
module.exports = {
  async fetchVisitHistory(visitId) {
    const { pool } = require('../../db');
    // VIOLATION: Accessing tenant-owned table 'visits' without tenant_id scoping
    const [visits] = await pool.query('SELECT * FROM visits WHERE id = ?', [visitId]);
    return visits[0];
  }
};

