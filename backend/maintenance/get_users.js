const mysql = require('mysql2/promise');

async function test() {
  const connection = await mysql.createConnection({
    host: '82.197.82.137',
    user: 'u566429295_admin',
    password: 'Arrd1227',
    database: 'u566429295_salonpro'
  });

  const [rows] = await connection.execute('SELECT * FROM users');
  console.log('Users:', JSON.stringify(rows, null, 2));
  await connection.end();
}

test();
