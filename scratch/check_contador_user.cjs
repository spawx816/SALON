const path = require('path');
const mysql = require(path.join(__dirname, '..', 'backend', 'node_modules', 'mysql2', 'promise'));
const fs = require('fs');

const envPath = path.join(__dirname, '..', 'backend', '.env');
const env = fs.readFileSync(envPath, 'utf8').split('\n').reduce((acc, line) => {
  const [k, ...v] = line.trim().split('=');
  if (k && v.length) acc[k] = v.join('=');
  return acc;
}, {});

(async () => {
  const pool = mysql.createPool({
    host: env.DB_HOST,
    user: env.DB_USER,
    password: env.DB_PASSWORD || env.DB_PASS,
    database: env.DB_NAME,
    timezone: '-04:00'
  });

  const [roles] = await pool.query('SELECT * FROM roles');
  console.log('Roles:');
  console.table(roles);

  const [cols] = await pool.query('DESCRIBE users');
  console.log('User columns:', cols.map(c => c.Field));

  const [users] = await pool.query(
    "SELECT * FROM users WHERE role_id = 4 OR role LIKE '%conta%' OR email LIKE '%conta%'"
  );
  console.log('Contador Users:');
  console.table(users);

  await pool.end();
})();
