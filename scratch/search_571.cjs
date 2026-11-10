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

  const [tables] = await pool.query('SHOW TABLES');
  const tableKey = Object.keys(tables[0])[0];
  console.log('Tables found:', tables.length);

  for (const t of tables) {
    const tableName = t[tableKey];
    try {
      const [cols] = await pool.query('DESCRIBE `' + tableName + '`');
      const textCols = cols.filter(c => c.Type.includes('char') || c.Type.includes('text')).map(c => c.Field);
      if (textCols.length === 0) continue;
      
      const whereClause = textCols.map(c => '`' + c + "` LIKE '%E320000000571%'").join(' OR ');
      const [matches] = await pool.query('SELECT * FROM `' + tableName + '` WHERE ' + whereClause + ' LIMIT 5');
      if (matches.length > 0) {
        console.log('MATCH E320000000571 in ' + tableName + ':', matches);
      }
    } catch (e) {
      // ignore
    }
  }

  for (const t of tables) {
    const tableName = t[tableKey];
    try {
      const [cols] = await pool.query('DESCRIBE `' + tableName + '`');
      const textCols = cols.filter(c => c.Type.includes('char') || c.Type.includes('text')).map(c => c.Field);
      if (textCols.length === 0) continue;
      
      const whereClause = textCols.map(c => '`' + c + "` LIKE '%S/DqDu%'").join(' OR ');
      const [matches] = await pool.query('SELECT * FROM `' + tableName + '` WHERE ' + whereClause + ' LIMIT 5');
      if (matches.length > 0) {
        console.log('MATCH S/DqDu in ' + tableName + ':', matches);
      }
    } catch (e) {
      // ignore
    }
  }

  // Also check dgii_ncf_sequences table for E32
  const [seqs] = await pool.query("SELECT * FROM dgii_ncf_sequences WHERE tipo_comprobante = 'E32'");
  console.log('E32 Sequences:', seqs);

  await pool.end();
})();
