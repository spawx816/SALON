const { Pool } = require('pg');
const mysql = require('mysql2/promise');
const path = require('path');
if (process.env.NODE_ENV !== 'test') {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
}

// Valida variables obligatorias de base de datos de forma estricta (Fail-Fast)
const REQUIRED_DB_VARS = ['DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME', 'DB_TYPE'];
const missingDbVars = REQUIRED_DB_VARS.filter(v => !process.env[v] || String(process.env[v]).trim() === '');
if (missingDbVars.length > 0) {
  const fatalMsg = `FATAL SECURITY DEFENSE: Variables de base de datos obligatorias ausentes: [${missingDbVars.join(', ')}]. Servidor/script no puede iniciar.`;
  console.error(`\n❌ [SECURITY HALT] ${fatalMsg}\n`);
  throw new Error(fatalMsg);
}

let pool;

if (process.env.DB_TYPE === 'postgres') {
  const timeoutRole = process.env.DB_TIMEOUT_ROLE || process.env.DB_ROLE || 'runtime';
  let defaultStatementTimeout = 10000; // 10s for runtime
  let defaultLockTimeout = 5000;       // 5s for runtime

  if (timeoutRole === 'migrator') {
    defaultStatementTimeout = parseInt(process.env.DB_MIGRATOR_STATEMENT_TIMEOUT_MS || '300000', 10);
    defaultLockTimeout = parseInt(process.env.DB_MIGRATOR_LOCK_TIMEOUT_MS || '60000', 10);
  } else if (timeoutRole === 'backup' || timeoutRole === 'restore') {
    defaultStatementTimeout = parseInt(process.env.DB_BACKUP_STATEMENT_TIMEOUT_MS || '600000', 10);
    defaultLockTimeout = parseInt(process.env.DB_BACKUP_LOCK_TIMEOUT_MS || '120000', 10);
  } else {
    defaultStatementTimeout = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '10000', 10);
    defaultLockTimeout = parseInt(process.env.DB_LOCK_TIMEOUT_MS || '5000', 10);
  }

  const pgPool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: defaultStatementTimeout,
    query_timeout: defaultStatementTimeout
  });

  pgPool.on('connect', (client) => {
    client.query(`SET statement_timeout = ${defaultStatementTimeout}; SET lock_timeout = ${defaultLockTimeout};`).catch(() => {});
  });

  function normalizeSql(sql) {
    if (!sql || typeof sql !== 'string') return sql;
    let s = sql;

    // 1. Convert CURRENT_DATE() to CURRENT_DATE
    s = s.replace(/\bCURRENT_DATE\s*\(\)/gi, 'CURRENT_DATE');

    // 2. Convert DATE_SUB(expr, INTERVAL n unit) to (expr - INTERVAL 'n unit')
    s = s.replace(/DATE_SUB\s*\(([^,]+),\s*INTERVAL\s+(\d+)\s+([A-Za-z]+)\)/gi, '($1 - INTERVAL \'$2 $3\')');

    // 3. Convert DATE_ADD(expr, INTERVAL n unit) to (expr + INTERVAL 'n unit')
    s = s.replace(/DATE_ADD\s*\(([^,]+),\s*INTERVAL\s+(\d+)\s+([A-Za-z]+)\)/gi, '($1 + INTERVAL \'$2 $3\')');

    // 3b. Convert MySQL DATE_FORMAT to PostgreSQL TO_CHAR
    s = s.replace(/DATE_FORMAT\s*\(\s*([^,]+?)\s*,\s*'%Y-%m-%d %H:%i:%s'\s*\)/gi, "TO_CHAR($1, 'YYYY-MM-DD HH24:MI:SS')");
    s = s.replace(/DATE_FORMAT\s*\(\s*([^,]+?)\s*,\s*'%Y-%m-%d'\s*\)/gi, "TO_CHAR($1, 'YYYY-MM-DD')");
    s = s.replace(/DATE_FORMAT\s*\(\s*([^,]+?)\s*,\s*'%H:%i:%s'\s*\)/gi, "TO_CHAR($1, 'HH24:MI:SS')");
    s = s.replace(/DATE_FORMAT\s*\(\s*([^,]+?)\s*,\s*'%m-%d'\s*\)/gi, "TO_CHAR($1, 'MM-DD')");

    // 4. Convert CAST(expr AS UNSIGNED) to CAST(expr AS BIGINT)
    s = s.replace(/AS\s+UNSIGNED/gi, 'AS BIGINT');

    // 5. Convert double-quoted string literals to single quotes
    s = s.replace(/IN\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/gi, "IN ('$1', '$2')");
    s = s.replace(/IN\s*\(\s*"([^"]+)"\s*\)/gi, "IN ('$1')");
    s = s.replace(/=\s*"([^"]+)"/g, "='$1'");
    s = s.replace(/!=\s*"([^"]*)"/g, (match, p1) => `!='${p1}'`);

    // 6. Handle type casts between UUID and VARCHAR in joins (client_id, cash_register_id, user_id)
    s = s.replace(/(\b[a-zA-Z_0-9]+\.client_id\s*=\s*)(cl|clients|c)\.id\b/gi, '$1$2.id::text');
    s = s.replace(/\b(cl|clients|c)\.id\s*=\s*(\b[a-zA-Z_0-9]+\.client_id\b)/gi, '$1.id::text = $2');
    s = s.replace(/(\b[a-zA-Z_0-9]+\.cash_register_id\s*=\s*)(cr|cash_registers)\.id\b/gi, '$1$2.id::text');
    s = s.replace(/\b(cr|cash_registers)\.id\s*=\s*(\b[a-zA-Z_0-9]+\.cash_register_id\b)/gi, '$1.id::text = $2');
    s = s.replace(/(\b[a-zA-Z_0-9]+\.user_id\s*=\s*)(u|users)\.id\b/gi, '$1$2.id::text');
    s = s.replace(/\b(u|users)\.id\s*=\s*(\b[a-zA-Z_0-9]+\.user_id\b)/gi, '$1.id::text = $2');
    s = s.replace(/(\b[a-zA-Z_0-9]+\.branch_id(?:::text)?\s*=\s*)(b|branches)\.id\b(?!\s*::\s*text)/gi, '$1$2.id::text');
    s = s.replace(/\b(b|branches)\.id\b(?!\s*::\s*text)(\s*=\s*[a-zA-Z_0-9]+\.branch_id)/gi, '$1.id::text$2');
    s = s.replace(/\bu\.branch_id\b(?!\s*::\s*text)/gi, 'u.branch_id::text');
    s = s.replace(/::text::text/g, '::text');
    s = s.replace(/\bsalon_id\s*=\s*0\b/gi, "salon_id = '0'");
    s = s.replace(/\bsalon_id\s*=\s*1\b/gi, "salon_id = '1'");
    s = s.replace(/\bcash_register_id\s*=\s*0\b/gi, "cash_register_id = '0'");

    // 7. Handle COALESCE with integer fallback for salon_id or other varchar columns
    s = s.replace(/COALESCE\s*\(\s*([a-zA-Z0-9_.]*salon_id)\s*,\s*([a-zA-Z0-9_.]*salon_id)\s*,\s*([0-9]+)\s*\)/gi, "COALESCE($1, $2, '$3')");
    s = s.replace(/COALESCE\s*\(\s*([a-zA-Z0-9_.]*salon_id)\s*,\s*([0-9]+)\s*\)/gi, "COALESCE($1, '$2')");
    s = s.replace(/COALESCE\s*\(\s*([a-zA-Z0-9_.]*client_id)\s*,\s*([0-9]+)\s*\)/gi, "COALESCE($1, '$2')");
    s = s.replace(/COALESCE\s*\(\s*([a-zA-Z0-9_.]*cash_register_id)\s*,\s*([0-9]+)\s*\)/gi, "COALESCE($1, '$2')");

    // 8. Handle JSON/JSONB column text casting in COALESCE/LIKE
    s = s.replace(/COALESCE\s*\(\s*([a-zA-Z_0-9]*\.?servicios)\s*,\s*['"]*['"]*\s*\)/gi, "COALESCE($1::text, '')");

    // 8. Handle ON DUPLICATE KEY UPDATE for PostgreSQL
    if (/ON DUPLICATE KEY UPDATE/i.test(s)) {
      if (s.includes('ticket_sequences')) {
        s = s.replace(/ON DUPLICATE KEY UPDATE prefix = VALUES\(prefix\)/gi, 'ON CONFLICT (salon_id) DO UPDATE SET prefix = EXCLUDED.prefix');
        s = s.replace(/ON DUPLICATE KEY UPDATE prefix = prefix/gi, 'ON CONFLICT (salon_id) DO NOTHING');
      } else if (s.includes('employee_commission_rules')) {
        s = s.replace(/ON DUPLICATE KEY UPDATE[\s\S]*$/i, 'ON CONFLICT (employee_id, service_name) DO UPDATE SET tipo_comision = EXCLUDED.tipo_comision, comision_valor = EXCLUDED.comision_valor');
      } else if (s.includes('contract_settings')) {
        s = s.replace(/ON DUPLICATE KEY UPDATE[\s\S]*$/i, (match) => {
          let setClause = match.replace(/ON DUPLICATE KEY UPDATE/i, '').trim();
          setClause = setClause.replace(/([a-zA-Z0-9_]+)\s*=\s*VALUES\(([a-zA-Z0-9_]+)\)/gi, '$1 = EXCLUDED.$2');
          return `ON CONFLICT (id) DO UPDATE SET ${setClause}`;
        });
      } else if (s.includes('holidays')) {
        s = s.replace(/ON DUPLICATE KEY UPDATE[\s\S]*$/i, (match) => {
          let setClause = match.replace(/ON DUPLICATE KEY UPDATE/i, '').trim();
          setClause = setClause.replace(/([a-zA-Z0-9_]+)\s*=\s*VALUES\(([a-zA-Z0-9_]+)\)/gi, '$1 = EXCLUDED.$2');
          return `ON CONFLICT (date) DO UPDATE SET ${setClause}`;
        });
      } else {
        // Fallback genérico a DO NOTHING si no se especifica
        s = s.replace(/ON DUPLICATE KEY UPDATE[\s\S]*$/i, 'ON CONFLICT DO NOTHING');
      }
    }

    // 8. Convert ? placeholders to $1, $2, ...
    let index = 1;
    s = s.replace(/\?/g, () => `$${index++}`);

    return s.trim().replace(/;\s*$/g, '');
  }

  // Adapter that conforms to [rows, fields] return signature of mysql2/promise
  pool = {
    isPostgres: true,
    rawPool: pgPool,
    async query(sql, params = []) {
      const pgSql = normalizeSql(sql);
      const isInsert = /^\s*INSERT\s+INTO\s+/i.test(pgSql);
      const shouldAppendReturning = isInsert && !/RETURNING/i.test(pgSql);

      try {
        let result;
        try {
          result = await pgPool.query(shouldAppendReturning ? `${pgSql} RETURNING id` : pgSql, params);
        } catch (queryErr) {
          if (shouldAppendReturning && (queryErr.message.includes('column "id" does not exist') || queryErr.message.includes('syntax error'))) {
            result = await pgPool.query(pgSql, params);
          } else {
            throw queryErr;
          }
        }
        const rows = result.rows || [];
        rows.affectedRows = result.rowCount;
        rows.rowCount = result.rowCount;
        if (isInsert && rows.length > 0 && rows[0].id !== undefined) {
          rows.insertId = rows[0].id;
        }
        return [rows, result.fields];
      } catch (err) {
        console.error('❌ [PostgreSQL Query Error]:', err.message, '\nQuery:', pgSql);
        throw err;
      }
    },
    async execute(sql, params = []) {
      return this.query(sql, params);
    },
    async getConnection() {
      const client = await pgPool.connect();
      return {
        async query(sql, params = []) {
          const pgSql = normalizeSql(sql);
          const isInsert = /^\s*INSERT\s+INTO\s+/i.test(pgSql);
          const isNoIdTable = /^\s*INSERT\s+INTO\s+(?:schema_migrations|company_ncf_counters|email_settings|contract_settings|security_settings)\b/i.test(pgSql);
          const shouldAppendReturning = isInsert && !isNoIdTable && !/RETURNING/i.test(pgSql);

          let result;
          try {
            result = await client.query(shouldAppendReturning ? `${pgSql} RETURNING id` : pgSql, params);
          } catch (queryErr) {
            if (shouldAppendReturning && (queryErr.message.includes('column "id" does not exist') || queryErr.message.includes('syntax error'))) {
              result = await client.query(pgSql, params);
            } else {
              throw queryErr;
            }
          }
          const rows = result.rows || [];
          rows.affectedRows = result.rowCount;
          if (isInsert && rows.length > 0 && rows[0].id !== undefined) {
            rows.insertId = rows[0].id;
          }
          return [rows, result.fields];
        },
        async beginTransaction() {
          await client.query('BEGIN');
        },
        async commit() {
          await client.query('COMMIT');
        },
        async rollback() {
          await client.query('ROLLBACK');
        },
        release() {
          client.release();
        }
      };
    },
    on(event, handler) {
      if (event === 'error') {
        pgPool.on('error', handler);
      }
    },
    end() {
      return pgPool.end();
    }
  };

  console.log(`🔌 [DB] Usando PostgreSQL Adapter (${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME})`);
} else {
  pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '-04:00'
  });
  console.log(`🔌 [DB] Usando MySQL Pool (${process.env.DB_HOST}/${process.env.DB_NAME})`);
}

function createRolePool(options = {}) {
  const role = options.role || 'runtime';
  let statementTimeout = 10000;
  let lockTimeout = 5000;
  if (role === 'migrator') {
    statementTimeout = parseInt(process.env.DB_MIGRATOR_STATEMENT_TIMEOUT_MS || '300000', 10);
    lockTimeout = parseInt(process.env.DB_MIGRATOR_LOCK_TIMEOUT_MS || '60000', 10);
  } else if (role === 'backup' || role === 'restore') {
    statementTimeout = parseInt(process.env.DB_BACKUP_STATEMENT_TIMEOUT_MS || '600000', 10);
    lockTimeout = parseInt(process.env.DB_BACKUP_LOCK_TIMEOUT_MS || '120000', 10);
  } else {
    statementTimeout = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '10000', 10);
    lockTimeout = parseInt(process.env.DB_LOCK_TIMEOUT_MS || '5000', 10);
  }
  const customPgPool = new Pool({
    host: options.host || process.env.DB_HOST,
    port: parseInt(options.port || process.env.DB_PORT || '5432', 10),
    user: options.user || process.env.DB_USER,
    password: options.password || process.env.DB_PASS,
    database: options.database || process.env.DB_NAME,
    max: options.max || 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: statementTimeout,
    query_timeout: statementTimeout
  });
  customPgPool.on('connect', (client) => {
    client.query(`SET statement_timeout = ${statementTimeout}; SET lock_timeout = ${lockTimeout};`).catch(() => {});
  });
  return customPgPool;
}

module.exports = { pool, createRolePool };
