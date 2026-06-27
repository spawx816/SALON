const mysql = require('mysql2/promise');

async function testConn() {
  try {
    const conn = await mysql.createConnection({
      host: '82.197.82.137',
      user: 'u566429295_admin',
      password: 'Arrd1227',
      database: 'u566429295_salonpro',
      connectTimeout: 5000
    });
    console.log('Connection successful!');
    await conn.end();
  } catch (e) {
    console.error('Connection failed:', e.message);
  }
}

testConn();
