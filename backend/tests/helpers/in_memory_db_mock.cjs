/**
 * In-Memory Transactional SQL Database Mock (in_memory_db_mock.cjs)
 * Simulates a PostgreSQL connection pool with transactional ACID semantics in pure memory.
 * ZERO connection to PostgreSQL, sockets, or external drivers.
 */

'use strict';

class InMemoryDbMock {
  constructor() {
    this.isPostgres = true;
    this.isInMemory = true;
    this.tables = {
      tenants: [],
      salons: [],
      branches: [],
      users: [],
      user_sessions: [],
      clients: [],
      visits: [],
      contracts: [],
      memberships: [],
      tenant_subscriptions: [],
      security_settings: [{ max_failed_attempts: 5, lockout_minutes: 30 }],
      blocked_ips: [],
      account_lockouts: [],
      inventory_products: [],
      inventory_stock: [],
      inventory_suppliers: [],
      inventory_purchase_orders: [],
      inventory_purchase_order_items: [],
      inventory_transfers: [],
      inventory_transfer_items: [],
      plans: [],
      saas_plans: [
        {
          id: 1,
          code: 'BASE',
          slug: 'base',
          name: 'Plan Base',
          price_monthly: 2900,
          price_yearly: 29000,
          max_branches: 1,
          max_users: 3,
          is_active: true,
          included_features: {
            pos: true,
            cajas: true,
            services_catalog: true,
            inventory: true,
            payroll: true,
            attendance: true,
            dgii_ecf: true,
            reports: true,
            clients: false,
            memberships: false,
            multi_branch: false,
            inventory_advanced: false
          }
        },
        {
          id: 2,
          code: 'PRO',
          slug: 'pro',
          name: 'Plan Pro',
          price_monthly: 5900,
          price_yearly: 59000,
          max_branches: 10,
          max_users: 25,
          is_active: true,
          included_features: {
            pos: true,
            cajas: true,
            services_catalog: true,
            inventory: true,
            payroll: true,
            attendance: true,
            dgii_ecf: true,
            reports: true,
            clients: true,
            memberships: true,
            multi_branch: true,
            inventory_advanced: true
          }
        }
      ],
      tenant_subscription_events: [],
      invoices: [],
      services: [],
      ticket_sequences: [],
      roles: [],
      cash_registers: [],
      dgii_ncf_sequences: [],
      verification_codes: [],
      staff_records: [],
      contact_messages: [],
      security_audit_logs: [],
      inventory_movements: [],
      inventory_locations: []
    };
  }

  _cloneTables(tables) {
    const clone = {};
    for (const [k, v] of Object.entries(tables)) {
      clone[k] = JSON.parse(JSON.stringify(v));
    }
    return clone;
  }

  async query(sql, params = []) {
    return this._executeQuery(this.tables, sql, params);
  }

  async getConnection() {
    const parent = this;
    let inTransaction = false;
    let txSnapshot = null;
    let workingTables = this.tables;

    return {
      isPostgres: true,
      async beginTransaction() {
        inTransaction = true;
        txSnapshot = parent._cloneTables(parent.tables);
        workingTables = parent._cloneTables(parent.tables);
      },
      async commit() {
        if (inTransaction) {
          parent.tables = workingTables;
          inTransaction = false;
          txSnapshot = null;
        }
      },
      async rollback() {
        if (inTransaction) {
          workingTables = txSnapshot;
          inTransaction = false;
          txSnapshot = null;
        }
      },
      async query(sql, params = []) {
        return parent._executeQuery(workingTables, sql, params);
      },
      release() {
        // No-op for in-memory pool
      }
    };
  }

  _executeQuery(tables, sql, params = []) {
    const cleanSql = sql.replace(/\s+/g, ' ').trim();
    const upperSql = cleanSql.toUpperCase();

    // 1. SELECT current_database() as db_name, current_user as user_name
    if (upperSql.includes('SELECT CURRENT_DATABASE()')) {
      return [[{ db_name: 'in_memory_test_db', user_name: 'test_runner' }], []];
    }

    // 2. INSERT INTO
    if (upperSql.startsWith('INSERT INTO')) {
      return this._handleInsert(tables, cleanSql, params);
    }

    // 3. UPDATE
    if (upperSql.startsWith('UPDATE')) {
      return this._handleUpdate(tables, cleanSql, params);
    }

    // 4. DELETE
    if (upperSql.startsWith('DELETE FROM')) {
      return this._handleDelete(tables, cleanSql, params);
    }

    // 5. SELECT
    if (upperSql.startsWith('SELECT')) {
      return this._handleSelect(tables, cleanSql, params);
    }

    // Default empty result for unhandled DDL or helpers
    return [[], []];
  }

  _handleInsert(tables, sql, params) {
    const match = sql.match(/INSERT\s+INTO\s+([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
    if (!match) {
      return [{ affectedRows: 0, insertId: null }, []];
    }

    const tableName = match[1].toLowerCase();
    const columns = match[2].split(',').map(c => c.trim().toLowerCase());
    
    if (!tables[tableName]) {
      tables[tableName] = [];
    }

    const row = {};
    let paramIdx = 0;
    const valuePlaceholders = match[3].split(',').map(v => v.trim());

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const ph = valuePlaceholders[i] || '?';
      if (ph === '?' || ph.startsWith('?')) {
        let val = params[paramIdx++];
        if (typeof val === 'string' && (ph.includes('::jsonb') || col === 'features' || col === 'modules_config' || col === 'servicios' || col === 'items_detail')) {
          try {
            val = JSON.parse(val);
          } catch (e) {
            // Keep string if not parseable JSON
          }
        }
        row[col] = val;
      } else if (ph.toUpperCase() === 'NOW()' || ph.toUpperCase() === 'CURRENT_TIMESTAMP') {
        row[col] = new Date().toISOString();
      } else if (ph.toUpperCase() === 'TRUE') {
        row[col] = true;
      } else if (ph.toUpperCase() === 'FALSE') {
        row[col] = false;
      } else if (/^'.*'$/.test(ph)) {
        row[col] = ph.slice(1, -1);
      } else if (!isNaN(Number(ph))) {
        row[col] = Number(ph);
      } else {
        row[col] = ph;
      }
    }

    // Auto-generate id if missing
    if (!row.id && tableName !== 'ticket_sequences') {
      row.id = `mock-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    }

    // ON CONFLICT handling
    const upper = sql.toUpperCase();
    if (upper.includes('ON CONFLICT')) {
      if (tableName === 'tenant_subscriptions') {
        const existing = tables.tenant_subscriptions.find(s => s.tenant_id === row.tenant_id);
        if (existing) {
          Object.assign(existing, row);
          return [[existing], []];
        }
      } else if (tableName === 'ticket_sequences') {
        const existing = tables.ticket_sequences.find(s => s.tenant_id === row.tenant_id && String(s.salon_id) === String(row.salon_id));
        if (existing) {
          Object.assign(existing, row);
          return [[existing], []];
        }
      } else if (tableName === 'inventory_stock') {
        const existing = tables.inventory_stock.find(s => s.tenant_id === row.tenant_id && s.product_id === row.product_id && s.location_id === row.location_id);
        if (existing) {
          Object.assign(existing, row);
          return [[existing], []];
        }
      } else if (upper.includes('DO NOTHING')) {
        const existing = tables[tableName].find(r => r.id === row.id && (!row.tenant_id || r.tenant_id === row.tenant_id));
        if (existing) {
          return [[existing], []];
        }
      }
    }

    tables[tableName].push(row);
    return [{ affectedRows: 1, insertId: row.id }, [row]];
  }

  _handleUpdate(tables, sql, params) {
    const match = sql.match(/UPDATE\s+([a-zA-Z0-9_]+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i);
    if (!match) {
      return [{ affectedRows: 0 }, []];
    }

    const tableName = match[1].toLowerCase();
    const setClause = match[2];
    const whereClause = match[3];

    const table = tables[tableName] || [];
    let paramIdx = 0;

    // Parse SET assignments respecting parentheses and quotes
    const assignments = [];
    const setPairs = [];
    let currentPart = '';
    let parenDepth = 0;
    let inQuotes = false;
    for (let i = 0; i < setClause.length; i++) {
      const char = setClause[i];
      if (char === "'" && (i === 0 || setClause[i - 1] !== '\\')) {
        inQuotes = !inQuotes;
      } else if (!inQuotes && char === '(') {
        parenDepth++;
      } else if (!inQuotes && char === ')') {
        parenDepth--;
      } else if (!inQuotes && parenDepth === 0 && char === ',') {
        setPairs.push(currentPart.trim());
        currentPart = '';
        continue;
      }
      currentPart += char;
    }
    if (currentPart.trim()) {
      setPairs.push(currentPart.trim());
    }

    for (const pair of setPairs) {
      const pMatch = pair.match(/([a-zA-Z0-9_]+)\s*=\s*(.+)/);
      if (pMatch) {
        const col = pMatch[1].trim().toLowerCase();
        const expr = pMatch[2].trim();
        assignments.push({ col, expr });
      }
    }

    // Extract values for SET parameters
    const evaluatedSets = [];
    for (const assign of assignments) {
      if (assign.expr === '?' || assign.expr.startsWith('?')) {
        let val = params[paramIdx++];
        if (typeof val === 'string' && assign.expr.includes('::jsonb')) {
          try { val = JSON.parse(val); } catch (e) {}
        }
        evaluatedSets.push({ col: assign.col, val });
      } else if (assign.expr.includes('CONCAT(')) {
        // Handle CONCAT expressions with placeholder
        if (assign.expr.includes('?')) {
          const concatVal = params[paramIdx++];
          evaluatedSets.push({ col: assign.col, op: 'concat', concatVal });
        }
      } else if (assign.expr.includes('current_number + 1') || assign.expr.includes('token_version + 1') || assign.expr.includes('COALESCE(token_version')) {
        evaluatedSets.push({ col: assign.col, op: 'increment' });
      } else if (assign.expr.includes('washes_used + ?')) {
        const addVal = params[paramIdx++];
        evaluatedSets.push({ col: assign.col, op: 'add', addVal });
      } else if (assign.expr.toUpperCase() === 'NOW()' || assign.expr.toUpperCase() === 'CURRENT_TIMESTAMP') {
        evaluatedSets.push({ col: assign.col, val: new Date().toISOString() });
      } else if (assign.expr.toUpperCase() === 'NULL') {
        evaluatedSets.push({ col: assign.col, val: null });
      } else if (assign.expr.toUpperCase() === 'TRUE') {
        evaluatedSets.push({ col: assign.col, val: true });
      } else if (assign.expr.toUpperCase() === 'FALSE') {
        evaluatedSets.push({ col: assign.col, val: false });
      } else if (/^\d+$/.test(assign.expr)) {
        evaluatedSets.push({ col: assign.col, val: parseInt(assign.expr, 10) });
      } else if (/^'.*'$/.test(assign.expr)) {
        evaluatedSets.push({ col: assign.col, val: assign.expr.slice(1, -1) });
      } else if (/^COALESCE\(\?,\s*([a-zA-Z0-9_]+)\)$/i.test(assign.expr)) {
        const val = params[paramIdx++];
        evaluatedSets.push({ col: assign.col, val, coalesce: true });
      }
    }

    // Filter rows based on WHERE parameters
    let affected = 0;
    const updatedRows = [];
    for (const row of table) {
      if (this._matchesWhere(row, whereClause, params, paramIdx)) {
        for (const s of evaluatedSets) {
          if (s.coalesce) {
            if (s.val !== null && s.val !== undefined) {
              row[s.col] = s.val;
            }
          } else if (s.op === 'increment') {
            row[s.col] = (Number(row[s.col]) || 0) + 1;
          } else if (s.op === 'add') {
            row[s.col] = (Number(row[s.col]) || 0) + (Number(s.addVal) || 0);
          } else if (s.op === 'concat') {
            row[s.col] = String(row[s.col] || '') + ' | Anulado: ' + String(s.concatVal || '');
          } else {
            row[s.col] = s.val;
          }
        }
        affected++;
        updatedRows.push(row);
      }
    }

    return [{ affectedRows: affected }, updatedRows];
  }

  _handleDelete(tables, sql, params) {
    const match = sql.match(/DELETE\s+FROM\s+([a-zA-Z0-9_]+)(?:\s+WHERE\s+(.+))?$/i);
    if (!match) return [{ affectedRows: 0 }, []];

    const tableName = match[1].toLowerCase();
    const whereClause = match[2];
    const table = tables[tableName] || [];

    const remaining = [];
    let affected = 0;

    for (const row of table) {
      if (this._matchesWhere(row, whereClause, params, 0)) {
        affected++;
      } else {
        remaining.push(row);
      }
    }

    tables[tableName] = remaining;
    return [{ affectedRows: affected }, []];
  }

  _handleSelect(tables, sql, params) {
    const upper = sql.toUpperCase();

    // 1. SELECT COUNT(*)
    if (upper.includes('COUNT(*)')) {
      const match = sql.match(/FROM\s+([a-zA-Z0-9_]+)(?:\s+WHERE\s+(.+?))?(?:\s+GROUP\s+BY|\s+ORDER\s+BY|\s+LIMIT|$)/i);
      if (match) {
        const tableName = match[1].toLowerCase();
        const whereClause = match[2];
        const rows = tables[tableName] || [];
        const filtered = whereClause ? rows.filter(r => this._matchesWhere(r, whereClause, params, 0)) : rows;
        return [[{ total: filtered.length, cnt: filtered.length, count: filtered.length, active: filtered.length, suspended: 0 }], []];
      }
    }

    // 2. Standard table select
    const match = sql.match(/FROM\s+([a-zA-Z0-9_]+)(?:\s+([a-zA-Z0-9_]+))?(?:\s+LEFT\s+JOIN.+?)?(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY.+?)?(?:\s+LIMIT\s+[0-9?]+)?$/i);
    if (!match) {
      return [[], []];
    }

    const tableName = match[1].toLowerCase();
    const whereClause = match[3];
    const rows = tables[tableName] || [];

    let result = whereClause ? rows.filter(r => this._matchesWhere(r, whereClause, params, 0)) : [...rows];

    // Handle joins / enrichments for known queries
    if (tableName === 'tenants' && upper.includes('SAAS_PLANS')) {
      result = result.map(t => {
        const plan = tables.saas_plans.find(p => p.id === t.plan_id) || tables.saas_plans[0];
        return {
          ...t,
          plan_name: plan.name,
          plan_slug: plan.slug,
          plan_price: plan.price_monthly,
          plan_max_branches: plan.max_branches,
          plan_max_users: plan.max_users,
          branches_count: (tables.branches || []).filter(b => b.tenant_id === t.id).length,
          users_count: (tables.users || []).filter(u => u.tenant_id === t.id).length,
          clients_count: 0
        };
      });
    }

    if (tableName === 'users' && upper.includes('BRANCHES')) {
      result = result.map(u => {
        const branch = (tables.branches || []).find(b => b.id === u.branch_id);
        return {
          ...u,
          branch_name: branch?.name || 'Sucursal Principal'
        };
      });
    }

    // LIMIT 1 handling if specified
    if (upper.includes('LIMIT 1') && result.length > 1) {
      result = [result[0]];
    }

    return [result, []];
  }

  _matchesWhere(row, whereClause, params, startParamIdx = 0) {
    if (!whereClause) return true;

    // Clean out trailing clauses like ORDER BY, LIMIT
    const cleanClause = whereClause
      .replace(/\s+ORDER\s+BY.+/i, '')
      .replace(/\s+LIMIT\s+[0-9?]+/i, '')
      .trim();

    // Split top-level AND conditions
    const conditions = cleanClause.split(/\s+AND\s+/i);
    let pIdx = startParamIdx;

    for (const rawCond of conditions) {
      const cond = rawCond.trim();

      // Compound condition: (LOWER(u.email) = LOWER(?) OR LOWER(u.username) = LOWER(?))
      if (cond.includes('LOWER(') && cond.includes('OR')) {
        const val1 = String(params[pIdx++] || '').toLowerCase();
        const val2 = String(params[pIdx++] || '').toLowerCase();
        const emailMatch = String(row.email || '').toLowerCase() === val1;
        const userMatch = String(row.username || '').toLowerCase() === val2;
        if (!emailMatch && !userMatch) return false;
        continue;
      }

      // Compound condition: (user_id = ? OR client_id = ?)
      if (cond.includes('user_id = ?') && cond.includes('client_id = ?')) {
        const val1 = String(params[pIdx++]);
        const val2 = String(params[pIdx++]);
        const uMatch = String(row.user_id) === val1 || String(row.id) === val1;
        const cMatch = String(row.client_id) === val2 || String(row.id) === val2;
        if (!uMatch && !cMatch) return false;
        continue;
      }

      // Compound condition: (id::text = ? OR cedula = ?)
      if (cond.includes('id::text = ?') && cond.includes('cedula = ?')) {
        const val1 = String(params[pIdx++]);
        const val2 = String(params[pIdx++]);
        const idMatch = String(row.id) === val1;
        const cedMatch = String(row.cedula) === val2;
        if (!idMatch && !cedMatch) return false;
        continue;
      }

      // Standard single-parameter conditions
      if (cond.includes('?')) {
        const val = params[pIdx++];

        if (/^(?:[a-zA-Z0-9_]+\.)?id(?:::text)?\s*=/i.test(cond)) {
          if (String(row.id) !== String(val)) return false;
        } else if (/^(?:[a-zA-Z0-9_]+\.)?tenant_id\s*=/i.test(cond)) {
          if (val !== null && row.tenant_id !== val) return false;
        } else if (/^status\s*=/i.test(cond)) {
          if (row.status !== val) return false;
        } else if (/^LOWER\([^)]*email\)\s*=\s*LOWER\(\?\)/i.test(cond)) {
          if (String(row.email || '').toLowerCase() !== String(val || '').toLowerCase()) return false;
        } else if (/^sku\s*=/i.test(cond)) {
          if (row.sku !== val) return false;
        } else if (/^barcode\s*=/i.test(cond)) {
          if (row.barcode !== val) return false;
        } else if (/^product_id\s*=/i.test(cond)) {
          if (row.product_id !== val) return false;
        } else if (/^location_id\s*=/i.test(cond)) {
          if (row.location_id !== val) return false;
        } else if (/^idempotency_key\s*=/i.test(cond)) {
          if (row.idempotency_key !== val) return false;
        } else if (/^slug\s*=/i.test(cond)) {
          if (row.slug !== val) return false;
        } else if (/^salon_id(?:::text)?\s*=/i.test(cond)) {
          if (String(row.salon_id) !== String(val)) return false;
        } else if (/^type_code\s*=/i.test(cond)) {
          if (row.type_code !== val) return false;
        } else if (/^visit_id\s*=/i.test(cond)) {
          if (row.visit_id !== val) return false;
        } else if (/^client_id\s*=/i.test(cond)) {
          if (row.client_id !== val) return false;
        } else if (/^file_id\s*=/i.test(cond)) {
          if (row.file_id !== val) return false;
        } else if (/^(?:[a-zA-Z0-9_]+\.)?user_id(?:::text)?\s*=/i.test(cond)) {
          if (String(row.user_id) !== String(val)) return false;
        } else {
          const colMatch = cond.match(/^(?:[a-zA-Z0-9_]+\.)?([a-zA-Z0-9_]+)(?:::text)?\s*=/i);
          if (colMatch && row[colMatch[1]] !== undefined) {
            if (String(row[colMatch[1]]) !== String(val)) return false;
          }
        }
      } else {
        // Static conditions without parameter
        if (cond.includes("status = 'active'")) {
          if (row.status !== 'active') return false;
        } else if (cond.includes("status = 'Abierta'")) {
          if (row.status !== 'Abierta') return false;
        } else if (cond.includes("is_active = TRUE") || cond.includes("is_active = 1") || cond.includes("is_active = true")) {
          if (!row.is_active && row.is_active !== 1) return false;
        } else if (cond.includes("is_used = 0")) {
          if (row.is_used && row.is_used !== 0) return false;
        } else if (cond.includes("is_default = TRUE") || cond.includes("is_default = 1")) {
          if (!row.is_default) return false;
        }
      }
    }

    return true;
  }
}

module.exports = {
  InMemoryDbMock
};
