const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  const columns = [
    { name: 'operacion', type: 'VARCHAR(20) DEFAULT NULL' },
    { name: 'monto_ajuste', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'porcentaje_comision', type: 'DECIMAL(5,2) DEFAULT 0.00' },
    { name: 'cantidad_meta', type: 'INT DEFAULT 0' },
    { name: 'bono_monto', type: 'DECIMAL(10,2) DEFAULT 0.00' },
    { name: 'bono_tipo', type: 'VARCHAR(20) DEFAULT \'Fijo\'' },
    { name: 'periodo', type: 'VARCHAR(30) DEFAULT \'Mensual\'' },
    { name: 'repeticion', type: 'VARCHAR(50) DEFAULT \'Una vez por período\'' },
    { name: 'repeticion_limite', type: 'INT DEFAULT 1' },
    { name: 'detalles_json', type: 'LONGTEXT' }
  ];

  for (const col of columns) {
    const [existing] = await conn.query(
      'SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?',
      [process.env.DB_NAME, 'commission_scheme_rules', col.name]
    );

    if (existing.length === 0) {
      await conn.query(`ALTER TABLE commission_scheme_rules ADD COLUMN ${col.name} ${col.type}`);
      console.log('Successfully added column:', col.name);
    } else {
      console.log('Column already exists:', col.name);
    }
  }

  const [cols] = await conn.query('DESCRIBE commission_scheme_rules');
  console.log('Commission scheme rules columns:', cols.map(c => c.Field));
  await conn.end();
})().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
