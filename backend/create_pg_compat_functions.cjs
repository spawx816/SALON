const { pool } = require('./db');

async function createPgFunctions() {
  console.log('🔄 [DB COMPAT] Creando funciones MySQL nativas en PostgreSQL...');
  const client = await pool.rawPool.connect();

  try {
    await client.query('BEGIN');

    // 1. MONTH, YEAR, DAY
    await client.query(`
      CREATE OR REPLACE FUNCTION MONTH(d timestamp with time zone) RETURNS integer AS $$ 
        SELECT EXTRACT(MONTH FROM d)::integer; 
      $$ LANGUAGE sql IMMUTABLE;

      CREATE OR REPLACE FUNCTION MONTH(d timestamp without time zone) RETURNS integer AS $$ 
        SELECT EXTRACT(MONTH FROM d)::integer; 
      $$ LANGUAGE sql IMMUTABLE;

      CREATE OR REPLACE FUNCTION MONTH(d date) RETURNS integer AS $$ 
        SELECT EXTRACT(MONTH FROM d)::integer; 
      $$ LANGUAGE sql IMMUTABLE;

      CREATE OR REPLACE FUNCTION YEAR(d timestamp with time zone) RETURNS integer AS $$ 
        SELECT EXTRACT(YEAR FROM d)::integer; 
      $$ LANGUAGE sql IMMUTABLE;

      CREATE OR REPLACE FUNCTION YEAR(d timestamp without time zone) RETURNS integer AS $$ 
        SELECT EXTRACT(YEAR FROM d)::integer; 
      $$ LANGUAGE sql IMMUTABLE;

      CREATE OR REPLACE FUNCTION YEAR(d date) RETURNS integer AS $$ 
        SELECT EXTRACT(YEAR FROM d)::integer; 
      $$ LANGUAGE sql IMMUTABLE;

      CREATE OR REPLACE FUNCTION DAY(d date) RETURNS integer AS $$ 
        SELECT EXTRACT(DAY FROM d)::integer; 
      $$ LANGUAGE sql IMMUTABLE;

      CREATE OR REPLACE FUNCTION DAY(d timestamp with time zone) RETURNS integer AS $$ 
        SELECT EXTRACT(DAY FROM d)::integer; 
      $$ LANGUAGE sql IMMUTABLE;

      CREATE OR REPLACE FUNCTION DAY(d timestamp without time zone) RETURNS integer AS $$ 
        SELECT EXTRACT(DAY FROM d)::integer; 
      $$ LANGUAGE sql IMMUTABLE;
    `);

    // 2. SUBSTRING_INDEX
    await client.query(`
      CREATE OR REPLACE FUNCTION SUBSTRING_INDEX(str text, delim text, count int) 
      RETURNS text AS $$
      DECLARE
        parts text[];
        res text := '';
      BEGIN
        IF str IS NULL OR delim IS NULL THEN
          RETURN NULL;
        END IF;
        IF count = 0 THEN
          RETURN '';
        END IF;
        
        parts := string_to_array(str, delim);
        
        IF count > 0 THEN
          IF count >= array_length(parts, 1) THEN
            RETURN str;
          END IF;
          RETURN array_to_string(parts[1:count], delim);
        ELSE
          -- Negative count: from right
          DECLARE
            len int := array_length(parts, 1);
            start_idx int := len + count + 1;
          BEGIN
            IF start_idx < 1 THEN
              RETURN str;
            END IF;
            RETURN array_to_string(parts[start_idx:len], delim);
          END;
        END IF;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);

    // 3. CONVERT_TZ
    await client.query(`
      CREATE OR REPLACE FUNCTION CONVERT_TZ(dt timestamp with time zone, from_tz text, to_tz text)
      RETURNS timestamp with time zone AS $$
      BEGIN
        RETURN dt AT TIME ZONE 'America/Santo_Domingo';
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;

      CREATE OR REPLACE FUNCTION CONVERT_TZ(dt timestamp without time zone, from_tz text, to_tz text)
      RETURNS timestamp without time zone AS $$
      BEGIN
        RETURN dt;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);

    // 4. IFNULL
    await client.query(`
      CREATE OR REPLACE FUNCTION IFNULL(val anyelement, fallback anyelement)
      RETURNS anyelement AS $$
      BEGIN
        RETURN COALESCE(val, fallback);
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);

    await client.query('COMMIT');
    console.log('✅ [DB COMPAT] Funciones MySQL nativas (MONTH, YEAR, DAY, SUBSTRING_INDEX, CONVERT_TZ, IFNULL) creadas en PostgreSQL con éxito.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ [DB COMPAT ERROR]:', err);
    throw err;
  } finally {
    client.release();
    process.exit(0);
  }
}

createPgFunctions();
