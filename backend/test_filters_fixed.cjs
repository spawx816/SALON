const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

async function testAudienceFilters() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  const [nullCheck] = await conn.query('SELECT COUNT(*) as null_count FROM contracts WHERE client_id IS NULL');
  console.log('Contratos con client_id NULL:', nullCheck[0].null_count);

  const getMarketingAudienceWhereClause = (filter) => {
    switch (filter) {
      case 'no_plan':
        return " AND c.id NOT IN (SELECT DISTINCT client_id FROM contracts WHERE client_id IS NOT NULL AND status IN ('Active', 'Activo'))";
      case 'active_plan':
        return " AND c.id IN (SELECT DISTINCT client_id FROM contracts WHERE client_id IS NOT NULL AND status IN ('Active', 'Activo'))";
      case 'pending_payment':
        return " AND c.id IN (SELECT DISTINCT client_id FROM contracts WHERE client_id IS NOT NULL AND (status IN ('Past Due', 'Overdue', 'Pending_Retry') OR auto_billing_enabled = 0))";
      case 'tenure_3m':
        return " AND c.id IN (SELECT client_id FROM contracts WHERE client_id IS NOT NULL AND status IN ('Active', 'Activo') AND signed_at <= DATE_SUB(CURRENT_DATE(), INTERVAL 3 MONTH))";
      case 'tenure_6m':
        return " AND c.id IN (SELECT client_id FROM contracts WHERE client_id IS NOT NULL AND status IN ('Active', 'Activo') AND signed_at <= DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH))";
      case 'tenure_9m':
        return " AND c.id IN (SELECT client_id FROM contracts WHERE client_id IS NOT NULL AND status IN ('Active', 'Activo') AND signed_at <= DATE_SUB(CURRENT_DATE(), INTERVAL 9 MONTH))";
      case 'tenure_12m':
        return " AND c.id IN (SELECT client_id FROM contracts WHERE client_id IS NOT NULL AND status IN ('Active', 'Activo') AND signed_at <= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH))";
      case 'tenure_18m':
        return " AND c.id IN (SELECT client_id FROM contracts WHERE client_id IS NOT NULL AND status IN ('Active', 'Activo') AND signed_at <= DATE_SUB(CURRENT_DATE(), INTERVAL 18 MONTH))";
      case 'all':
      default:
        return "";
    }
  };

  const filters = ['all', 'no_plan', 'active_plan', 'pending_payment', 'tenure_3m', 'tenure_6m', 'tenure_9m', 'tenure_12m', 'tenure_18m'];

  for (const f of filters) {
    const where = getMarketingAudienceWhereClause(f);
    const [rows] = await conn.query(`
      SELECT c.id, c.nombre, c.email 
      FROM clients c 
      WHERE c.email IS NOT NULL AND c.email != '' ${where}
    `);
    console.log(`Filtro [${f}]: ${rows.length} clientes encontrados.`);
  }

  await conn.end();
}

testAudienceFilters();
