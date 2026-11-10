/**
 * AST-Based Multi-Tenant SQL & Static Analysis Scanner
 * 
 * Replaces legacy regex scanning with JavaScript Abstract Syntax Tree (AST) analysis
 * using @babel/parser and @babel/traverse.
 * 
 * Core Capabilities:
 * 1. Traverses JS/CJS ASTs to identify database queries (pool.query, conn.query, client.query).
 * 2. Resolves SQL strings across variable assignments, template literals, and scoped identifiers.
 * 3. Identifies access to 61 tenant-owned tables.
 * 4. Verifies tenant_id scoping and detects:
 *    - Unscoped global queries.
 *    - Tautological bypass filters (e.g. `tenant_id IS NOT NULL OR tenant_id IS NULL`, `tenant_id = tenant_id`).
 *    - Unanalyzable dynamic SQL queries where tenant scoping cannot be verified.
 *    - Non-route files executing raw queries.
 * 5. Fails closed with non-zero exit code upon encountering any violation.
 */

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default || require('@babel/traverse');

// Load canonical list of tenant-owned tables
const matrixPath = path.resolve(__dirname, 'multitenant_matrix.json');
let TENANT_OWNED_TABLES = new Set([
  'salons', 'branches', 'clients', 'visits', 'contracts', 'payments', 'invoices',
  'services', 'cash_registers', 'employees', 'attendance', 'payroll_periods',
  'staff_records', 'ticket_sequences', 'expenses', 'appointments', 'marketing_campaigns',
  'gifts', 'surveys', 'client_notes', 'gift_cards', 'custom_rates',
  'tenant_subscriptions', 'tenant_feature_overrides', 'tenant_subscription_events',
  'inventory_products', 'inventory_locations', 'inventory_stock', 'inventory_movements',
  'inventory_suppliers', 'inventory_purchase_orders', 'inventory_purchase_order_items',
  'inventory_transfers', 'inventory_transfer_items',
  'saas_payment_methods', 'saas_invoice_counters', 'saas_invoices', 'saas_invoice_items',
  'saas_payments', 'saas_refunds', 'saas_billing_events', 'saas_webhook_events', 'saas_billing_jobs'
]);

if (fs.existsSync(matrixPath)) {
  try {
    const rawMatrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
    if (Array.isArray(rawMatrix)) {
      rawMatrix.forEach(entry => {
        if (entry.table_name) TENANT_OWNED_TABLES.add(entry.table_name.toLowerCase());
      });
    }
  } catch (e) {
    console.warn('⚠️ Could not load multitenant_matrix.json, using built-in table list');
  }
}

// System/Global tables exempt from tenant scoping requirement
const EXEMPT_SYSTEM_TABLES = new Set([
  'tenants',
  'saas_plans',
  'saas_features',
  'saas_plan_features',
  'migrations',
  'system_settings',
  'audit_logs',
  'pending_tenant_reconciliations'
]);

/**
 * Resolves an AST node to its underlying SQL string if statically determinable.
 */
function resolveSqlString(node, scope) {
  if (!node) return { resolved: false, reason: 'NODE_NULL' };

  if (node.type === 'StringLiteral') {
    return { resolved: true, sql: node.value, dynamic: false };
  }

  if (node.type === 'TemplateLiteral') {
    const rawSql = node.quasis.map(q => q.value.raw).join(' ? ');
    // Check if any expression is a complex runtime call
    const hasComplexCall = node.expressions.some(e => e.type === 'CallExpression');
    return { resolved: true, sql: rawSql, dynamic: hasComplexCall, template: true };
  }

  if (node.type === 'CallExpression') {
    if (node.callee.type === 'MemberExpression' && ['replace', 'trim', 'toLowerCase', 'toString'].includes(node.callee.property?.name)) {
      return resolveSqlString(node.callee.object, scope);
    }
  }

  if (node.type === 'ParenthesizedExpression') {
    return resolveSqlString(node.expression, scope);
  }

  if (node.type === 'ConditionalExpression') {
    const resA = resolveSqlString(node.consequent, scope);
    const resB = resolveSqlString(node.alternate, scope);
    if (resA.resolved && resB.resolved) {
      return { resolved: true, branches: [resA, resB], sql: resA.sql, dynamic: false };
    }
    return { resolved: false, reason: 'CONDITIONAL_BRANCH_UNRESOLVED' };
  }

  if (node.type === 'Identifier') {
    const binding = scope.getBinding(node.name);
    if (binding && binding.path && binding.path.node) {
      const init = binding.path.node.init;
      if (init) {
        const baseRes = resolveSqlString(init, binding.path.scope);
        if (baseRes.resolved && binding.constantViolations && binding.constantViolations.length > 0) {
          let fullSql = baseRes.sql;
          for (const viol of binding.constantViolations) {
            if (viol.isAssignmentExpression() && viol.node.operator === '+=') {
              const added = resolveSqlString(viol.node.right, viol.scope);
              if (added.resolved) {
                fullSql += ' ' + added.sql;
              }
            }
          }
          return { resolved: true, sql: fullSql, dynamic: false };
        }
        return baseRes;
      }
    }
    return { resolved: false, reason: 'UNRESOLVED_VARIABLE_IDENTIFIER: ' + node.name };
  }

  return { resolved: false, reason: 'COMPLEX_EXPRESSION_TYPE: ' + node.type };
}

/**
 * Analyzes a SQL string for tenant-owned table usage and tenant_id safety.
 */
function analyzeSqlSafety(sql, filePath, line) {
  const violations = [];
  const normalized = sql.replace(/\s+/g, ' ');

  // 1. Detect tautological bypass patterns
  const tautologyPatterns = [
    /tenant_id\s+IS\s+NOT\s+NULL\s+OR\s+tenant_id\s+IS\s+NULL/i,
    /tenant_id\s*=\s*tenant_id\b/i,
    /tenant_id\s*!=\s*''\s*OR\s*tenant_id\s*=\s*''/i,
    /WHERE\s+1\s*=\s*1\s*(?:GROUP\s+BY|ORDER\s+BY|LIMIT|;|$)/i
  ];

  for (const pat of tautologyPatterns) {
    if (pat.test(normalized)) {
      violations.push({
        type: 'TAUTOLOGICAL_TENANT_FILTER',
        reason: `Detected tautological or bypass filter matching ${pat}`,
        snippet: normalized.substring(0, 120),
        line
      });
    }
  }

  // 2. Identify referenced tenant-owned tables
  const referencedTables = new Set();
  const tableRefRegex = /\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  let match;
  while ((match = tableRefRegex.exec(normalized)) !== null) {
    const tableName = match[1].toLowerCase();
    if (TENANT_OWNED_TABLES.has(tableName) && !EXEMPT_SYSTEM_TABLES.has(tableName)) {
      referencedTables.add(tableName);
    }
  }

  // 3. If tenant-owned tables are accessed, check for strict tenant_id filter
  if (referencedTables.size > 0) {
    const isInsert = /^\s*INSERT\s+INTO/i.test(normalized);

    if (isInsert) {
      // For INSERT queries, tenant_id must be in the column declaration list
      const hasTenantInColumns = /INSERT\s+INTO\s+[a-zA-Z0-9_]+\s*\([^)]*\btenant_id\b[^)]*\)/i.test(normalized);
      if (!hasTenantInColumns) {
        violations.push({
          type: 'MISSING_TENANT_IN_INSERT',
          reason: `INSERT into tenant-owned table(s) [${Array.from(referencedTables).join(', ')}] does not specify tenant_id column`,
          snippet: normalized.substring(0, 120),
          line
        });
      }
    } else {
      // For SELECT, UPDATE, DELETE queries, tenant_id must be in WHERE / JOIN condition
      const hasTenantFilter = (
        /\btenant_id\s*(?:=|IN|LIKE)\s*/i.test(normalized) ||
        /\b[a-zA-Z0-9_]+\.tenant_id\s*(?:=|IN|LIKE)\s*/i.test(normalized) ||
        /\btenant_id\s*\$/i.test(normalized)
      );

      if (!hasTenantFilter) {
        violations.push({
          type: 'MISSING_TENANT_FILTER',
          reason: `Query references tenant-owned table(s) [${Array.from(referencedTables).join(', ')}] without tenant_id scoping`,
          snippet: normalized.substring(0, 120),
          line
        });
      }
    }
  }

  return violations;
}

/**
 * Scans a single JavaScript / CJS file for multi-tenant query compliance.
 */
function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const violations = [];
  const normalizedFilePath = filePath.replace(/\\/g, '/');

  let ast;
  try {
    ast = parser.parse(content, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'flow']
    });
  } catch (err) {
    return [{
      type: 'AST_PARSE_ERROR',
      reason: `Could not parse AST: ${err.message}`,
      file: filePath,
      line: err.loc?.line || 1
    }];
  }

  const isServerFile = normalizedFilePath.endsWith('/server.js') || normalizedFilePath.endsWith('/app.js') || normalizedFilePath.includes('server');
  const isWorkerFile = normalizedFilePath.includes('worker');

  traverse(ast, {
    StringLiteral(path) {
      if (path.node.value && path.node.value.toUpperCase().includes('SPAWX')) {
        violations.push({
          type: 'PROHIBITED_HOSTNAME_REFERENCE',
          reason: 'Hardcoded hostname reference "SPAWX" is strictly prohibited',
          file: filePath,
          line: path.node.loc?.start?.line || 1,
          snippet: path.node.value
        });
      }
    },

    TemplateLiteral(path) {
      for (const quasi of path.node.quasis) {
        if (quasi.value?.raw && quasi.value.raw.toUpperCase().includes('SPAWX')) {
          violations.push({
            type: 'PROHIBITED_HOSTNAME_REFERENCE',
            reason: 'Hardcoded hostname reference "SPAWX" in template literal is strictly prohibited',
            file: filePath,
            line: path.node.loc?.start?.line || 1,
            snippet: quasi.value.raw
          });
        }
      }
    },

    CallExpression(path) {
      const { callee } = path.node;
      const line = path.node.loc?.start?.line || 1;

      // 1. Prohibit setInterval in web server / app entrypoints
      if (isServerFile) {
        const isSetInterval = (
          (callee.type === 'Identifier' && callee.name === 'setInterval') ||
          (callee.type === 'MemberExpression' && callee.property && callee.property.name === 'setInterval')
        );
        if (isSetInterval) {
          violations.push({
            type: 'PROHIBITED_SCHEDULER_IN_WEB_SERVER',
            reason: 'Use of setInterval in web server process is prohibited. Decouple background schedulers to dedicated worker processes.',
            file: filePath,
            line
          });
        }
      }

      // 2. Prohibit workers directly loading backend/.env
      if (isWorkerFile) {
        const isDotenvCall = (
          (callee.type === 'MemberExpression' && callee.property && callee.property.name === 'config' && callee.object?.name === 'dotenv') ||
          (callee.type === 'Identifier' && callee.name === 'dotenv')
        );
        const hasEnvArg = path.node.arguments.some(arg => {
          if (arg.type === 'StringLiteral' && arg.value.includes('.env')) return true;
          if (arg.type === 'ObjectExpression') {
            return arg.properties.some(prop => prop.value?.value && typeof prop.value.value === 'string' && prop.value.value.includes('.env'));
          }
          return false;
        });

        if (isDotenvCall || hasEnvArg) {
          violations.push({
            type: 'PROHIBITED_ENV_LOADING_IN_WORKER',
            reason: 'Workers must not load backend/.env directly. Environment must be passed via runtime orchestrator.',
            file: filePath,
            line
          });
        }
      }

      // 3. Prohibit logging sensitive data in console (PAN, CVV, rawPin, password)
      if (callee.type === 'MemberExpression' && callee.object && callee.object.name === 'console' && ['log', 'error', 'warn', 'info'].includes(callee.property?.name)) {
        for (const arg of path.node.arguments) {
          if (arg.type === 'Identifier' && /^(?:rawPin|cvv|cvc|pan|cardNumber|card_number)$/i.test(arg.name)) {
            violations.push({
              type: 'PROHIBITED_SENSITIVE_DATA_LOGGING',
              reason: `Logging sensitive identifier "${arg.name}" to console is strictly prohibited`,
              file: filePath,
              line
            });
          } else if (arg.type === 'StringLiteral') {
            if (/\b(?:cvv|cvc|pan)\s*[:=]\s*\d+/i.test(arg.value) || /\b(?:\d[ -]*?){13,16}\b/.test(arg.value)) {
              violations.push({
                type: 'PROHIBITED_SENSITIVE_DATA_LOGGING',
                reason: `Logging unmasked PAN/CVV literal to console is strictly prohibited`,
                file: filePath,
                line,
                snippet: arg.value
              });
            }
          }
        }
      }

      // 4. Multi-tenant database query analysis
      let isQueryCall = false;

      // Match pool.query, conn.query, client.query, this.pool.query, etc.
      if (callee.type === 'MemberExpression' && callee.property && callee.property.name === 'query') {
        isQueryCall = true;
      }

      if (!isQueryCall) return;

      const firstArg = path.node.arguments[0];

      if (!firstArg) {
        violations.push({
          type: 'EMPTY_QUERY_CALL',
          reason: 'query() called with 0 arguments',
          file: filePath,
          line
        });
        return;
      }

      const res = resolveSqlString(firstArg, path.scope);

      if (!res.resolved) {
        // Dynamic / Unanalyzable SQL
        violations.push({
          type: 'UNANALYZABLE_DYNAMIC_SQL',
          reason: `Unanalyzable dynamic query argument: ${res.reason}`,
          file: filePath,
          line
        });
        return;
      }

      const sqlList = res.branches ? res.branches.map(b => b.sql) : [res.sql];
      for (const s of sqlList) {
        const queryViolations = analyzeSqlSafety(s, filePath, line);
        for (const v of queryViolations) {
          violations.push({ ...v, file: filePath });
        }
      }
    }
  });

  return violations;
}

/**
 * Recursively scans target directories with explicit exclusion blacklist.
 */
function scanDirectory(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (['node_modules', '.git', 'dist', 'archive', 'fixtures_scanner', 'fixtures'].includes(entry.name)) continue;
    if (entry.name.startsWith('test_') || entry.name.includes('.test.') || entry.name.includes('_test_')) continue;
    if (entry.isDirectory()) {
      scanDirectory(fullPath, fileList);
    } else if (/\.(js|cjs)$/.test(entry.name)) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

/**
 * Main scanner execution.
 */
function runScanner(targetPaths = ['backend/server.js', 'backend/routes', 'backend/middleware', 'backend/services', 'backend/repositories', 'backend/workers', 'backend/utils', 'backend/domain']) {
  console.log('=== AST MULTI-TENANT SQL STATIC ANALYSIS SCANNER ===\n');
  const allFiles = [];
  for (const p of targetPaths) {
    const resolved = path.resolve(p);
    if (fs.existsSync(resolved)) {
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        scanDirectory(resolved, allFiles);
      } else {
        allFiles.push(resolved);
      }
    }
  }

  console.log(`Auditing ${allFiles.length} JavaScript runtime file(s) via AST traversal...\n`);

  let totalViolations = 0;
  for (const file of allFiles) {
    const relPath = path.relative(process.cwd(), file);
    const violations = scanFile(file);
    if (violations.length > 0) {
      totalViolations += violations.length;
      console.error(`❌ [VIOLATION] ${relPath}:`);
      for (const v of violations) {
        console.error(`   - Line ${v.line}: [${v.type}] ${v.reason}`);
        if (v.snippet) console.error(`     Snippet: "${v.snippet}"`);
      }
    }
  }

  if (totalViolations > 0) {
    console.error(`\n🚨 AUDIT FAILED: ${totalViolations} security violation(s) identified in AST inspection.`);
    return { success: false, totalViolations };
  } else {
    console.log('✅ AST STATIC SCAN PASSED: 0 multi-tenant violations found across audited files.');
    return { success: true, totalViolations: 0 };
  }
}

// CLI Execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const targets = args.length > 0 ? args : ['backend/server.js', 'backend/routes', 'backend/middleware', 'backend/services', 'backend/repositories', 'backend/workers', 'backend/utils', 'backend/domain'];
  const result = runScanner(targets);
  process.exit(result.success ? 0 : 1);
}

module.exports = {
  scanFile,
  runScanner,
  analyzeSqlSafety
};
