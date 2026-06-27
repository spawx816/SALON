
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

async function migrate() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  try {
    console.log('Checking visits table structure...');
    const [columns] = await pool.query('SHOW COLUMNS FROM visits');
    const hasLavaPelo = columns.some(c => c.Field === 'empleado_lava_pelo');

    if (!hasLavaPelo) {
      console.log('Adding empleado_lava_pelo column to visits table...');
      await pool.query('ALTER TABLE visits ADD COLUMN empleado_lava_pelo VARCHAR(100) AFTER empleado_peluquera');
      console.log('Migration successful!');
    } else {
      console.log('Column empleado_lava_pelo already exists.');
    }

  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    await pool.end();
  }
}

migrate();
