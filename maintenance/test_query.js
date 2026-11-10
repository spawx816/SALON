const mysql = require('mysql2/promise');

async function testQuery() {
  try {
    const connection = await mysql.createConnection({
      host: '82.197.82.137',
      user: 'u566429295_admin',
      password: 'Arrd1227',
      database: 'u566429295_salonpro',
    });

    const [rows] = await connection.query(`
      SELECT 
          p.id AS plan_id,
          p.title AS plan_name,
          p.services AS plan_services,
          COUNT(DISTINCT v.client_id) AS unique_clients_used,
          COUNT(v.id) AS total_visits
      FROM visits v
      JOIN contracts c ON v.client_id = c.client_id
      JOIN plans p ON c.plan_id = p.id
      GROUP BY p.id, p.title, p.services
    `);

    console.log(JSON.stringify(rows, null, 2));
    await connection.end();
  } catch(e) {
    console.error(e);
  }
}

testQuery();
