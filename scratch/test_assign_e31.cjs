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

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const targetType = 'E31';
    console.log('Querying dgii_ncf_sequences with FOR UPDATE...');
    const [batches] = await connection.query(
      `SELECT * FROM dgii_ncf_sequences 
       WHERE tipo_comprobante = ?
         AND estado = 'Activo'
         AND cantidad_usada < cantidad_aprobada
         AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= CURDATE())
       ORDER BY id ASC
       LIMIT 1 FOR UPDATE`,
      [targetType]
    );

    console.log('Found batches:', batches);

    if (batches.length === 0) {
      console.log('ERROR: No batches found!');
    } else {
      const seq = batches[0];
      const prefix = seq.tipo_comprobante || seq.numero_desde.slice(0, 3);
      const rawSeqStr = seq.numero_desde.slice(prefix.length);
      const startNum = parseInt(rawSeqStr, 10) || 1;
      const endNum = parseInt(seq.numero_hasta.slice(prefix.length), 10) || (startNum + seq.cantidad_aprobada - 1);
      const currentAssignedNum = startNum + seq.cantidad_usada;
      console.log({ prefix, rawSeqStr, startNum, endNum, currentAssignedNum, cantidad_usada: seq.cantidad_usada, cantidad_aprobada: seq.cantidad_aprobada });
      if (currentAssignedNum > endNum) {
        console.log('ERROR: currentAssignedNum > endNum!');
      } else {
        const encfNumber = prefix + String(currentAssignedNum).padStart(10, '0');
        console.log('Would assign NCF:', encfNumber);
        
        // Check if encfNumber already exists in visits!
        const [existingVisits] = await connection.query('SELECT id, ticket_number, ncf FROM visits WHERE ncf = ?', [encfNumber]);
        console.log('Visits with this NCF:', existingVisits);
      }
    }

    await connection.rollback();
  } catch (err) {
    console.error('Error during test:', err);
    await connection.rollback();
  } finally {
    connection.release();
    await pool.end();
  }
})();

