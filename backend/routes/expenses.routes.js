const express = require('express');
const { requirePermission, getBranchScope } = require('../middleware/rbac.middleware');

/**
 * Operational Expenses Router (Scoped strictly by tenant_id + granular accounting permissions)
 */
function createExpensesRouter(pool) {
  const router = express.Router();

  const requireExpenseWritePermission = (req, res, next) => {
    const isPaymentAction =
      req.body?.is_loan === 1 ||
      req.body?.is_loan === true ||
      String(req.body?.is_loan || '') === '1' ||
      String(req.body?.status || '').trim().toLowerCase() === 'pagado';
    if (isPaymentAction) {
      return requirePermission('accounting.expenses.pay')(req, res, next);
    }
    return requirePermission('accounting.expenses.manage')(req, res, next);
  };

  const DEFAULT_CONCEPTS = [
    { id: 'c1', name: 'Nómina / Salarios', category: 'Personal' },
    { id: 'c2', name: 'Alquiler de Local', category: 'Fijo' },
    { id: 'c3', name: 'Energía Eléctrica', category: 'Servicios' },
    { id: 'c4', name: 'Productos de Salón / Insumos', category: 'Operativo' },
    { id: 'c5', name: 'Mantenimiento y Limpieza', category: 'Operativo' },
    { id: 'c6', name: 'Cuota de Préstamo Bancario', category: 'Financiero' },
  ];

  const DEFAULT_ACCOUNTS = [
    { id: 'a1', name: 'Caja Chica / Efectivo', type: 'Efectivo' },
    { id: 'a2', name: 'Cuenta Operativa Principal', type: 'Banco' },
    { id: 'a3', name: 'Tarjeta Corporativa', type: 'Tarjeta' },
  ];

  const DEFAULT_BANKS = [
    { id: 'b1', name: 'Banco Popular Dominicano' },
    { id: 'b2', name: 'Banreservas' },
    { id: 'b3', name: 'Banco BHD' },
  ];

  const getTenantExpenseCatalog = async (tenantId) => {
    const [rows] = await pool.query('SELECT modules_config FROM tenants WHERE id = ? LIMIT 1', [tenantId]);
    let cfg = {};
    try {
      cfg = typeof rows?.[0]?.modules_config === 'string'
        ? JSON.parse(rows[0].modules_config || '{}')
        : (rows?.[0]?.modules_config || {});
    } catch {
      cfg = {};
    }
    const expCat = cfg.expenses_catalog || {};
    return {
      cfg,
      concepts: Array.isArray(expCat.concepts) ? expCat.concepts : [],
      banks: Array.isArray(expCat.banks) ? expCat.banks : [],
      loans: Array.isArray(expCat.loans) ? expCat.loans : [],
      accounts: Array.isArray(expCat.accounts) ? expCat.accounts : [],
    };
  };

  const saveTenantExpenseCatalog = async (tenantId, cfg, nextCatalog) => {
    const updatedCfg = {
      ...(cfg || {}),
      expenses_catalog: {
        concepts: nextCatalog.concepts || [],
        banks: nextCatalog.banks || [],
        loans: nextCatalog.loans || [],
        accounts: nextCatalog.accounts || [],
      },
    };
    await pool.query('UPDATE tenants SET modules_config = ?::jsonb WHERE id = ?', [JSON.stringify(updatedCfg), tenantId]);
  };

  const normalizeExpenseRecord = (row) => {
    const payDate = row.payment_date || row.date || row.expense_date;
    const cleanDate = payDate
      ? (typeof payDate === 'string' ? payDate.slice(0, 10) : new Date(payDate).toISOString().slice(0, 10))
      : new Date().toISOString().slice(0, 10);
    return {
      ...row,
      id: row.id,
      concept: row.concept_name || row.concept || row.description || 'Gasto Operativo',
      concept_name: row.concept_name || row.concept || row.description || 'Gasto Operativo',
      description: row.description || row.observation || row.concept_name || row.concept || '',
      observation: row.observation || row.description || '',
      category: row.category || 'Operativo',
      amount: Number(row.amount || 0),
      date: cleanDate,
      payment_date: cleanDate,
      expense_date: cleanDate,
      payment_method: row.payment_method || 'Efectivo',
      account_name: row.account_name || row.payment_method || 'Caja Chica / Efectivo',
      salon_id: row.salon_id || 1,
      salon_name: row.salon_name || 'Principal',
      reference: row.reference || row.ncf || '',
      bank_name: row.bank_name || null,
      loan_id: row.loan_id || null,
      loan_name: row.loan_name || null,
      loan_ref: row.loan_ref || null,
      loan_period: row.loan_period || null,
      breakdown_capital: Number(row.breakdown_capital || 0),
      breakdown_interest: Number(row.breakdown_interest || 0),
      breakdown_charges: Number(row.breakdown_charges || 0),
      is_loan: row.is_loan === 1 || row.is_loan === true ? 1 : 0,
      status: row.status || 'Registrado',
      void_reason: row.void_reason || null,
    };
  };

  // GET /api/expenses/status
  router.get('/status', requirePermission('accounting.view'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      await pool.query('SELECT 1 FROM expenses WHERE tenant_id = ? LIMIT 1', [tenantId]);
      res.json({ ready: true });
    } catch (err) {
      res.status(503).json({ ready: false, code: 'MIGRATION_PENDING', error: err.message });
    }
  });

  // GET /api/expenses/concepts
  router.get('/concepts', requirePermission('accounting.view'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const store = await getTenantExpenseCatalog(tenantId);
      const [rows] = await pool.query(
        "SELECT DISTINCT COALESCE(concept_name, concept) as name, COALESCE(category, 'Operativo') as category FROM expenses WHERE tenant_id = ? AND COALESCE(concept_name, concept) IS NOT NULL ORDER BY name ASC",
        [tenantId]
      );
      const map = new Map();
      for (const c of DEFAULT_CONCEPTS) map.set(c.name.toLowerCase(), c);
      for (const c of store.concepts) if (c?.name) map.set(String(c.name).toLowerCase(), c);
      for (const r of (rows || [])) {
        if (r?.name && !map.has(String(r.name).toLowerCase())) {
          map.set(String(r.name).toLowerCase(), { id: `db_${map.size + 1}`, name: r.name, category: r.category || 'Operativo' });
        }
      }
      res.json(Array.from(map.values()));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/concepts', requirePermission('accounting.expenses.manage'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { name, category = 'Operativo' } = req.body || {};
      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'El nombre del concepto es requerido.' });
      }
      const cleanName = String(name).trim();
      const store = await getTenantExpenseCatalog(tenantId);
      const nextConcepts = [...store.concepts.filter((c) => String(c.name || '').toLowerCase() !== cleanName.toLowerCase())];
      const created = { id: `conc_${Date.now()}`, name: cleanName, category };
      nextConcepts.push(created);
      await saveTenantExpenseCatalog(tenantId, store.cfg, {
        ...store,
        concepts: nextConcepts,
      });
      res.json({ success: true, ...created });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET/POST /api/expenses/banks, /loans, /accounts
  router.get('/banks', requirePermission('accounting.view'), async (req, res) => {
    try {
      const store = await getTenantExpenseCatalog(req.tenantId);
      const map = new Map();
      for (const b of DEFAULT_BANKS) map.set(b.name.toLowerCase(), b);
      for (const b of store.banks) if (b?.name) map.set(String(b.name).toLowerCase(), b);
      res.json(Array.from(map.values()));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/banks', requirePermission('accounting.expenses.manage'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { name } = req.body || {};
      if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre del banco es requerido.' });
      const cleanName = String(name).trim();
      const store = await getTenantExpenseCatalog(tenantId);
      const created = { id: `bank_${Date.now()}`, name: cleanName };
      const nextBanks = [...store.banks.filter((b) => String(b.name || '').toLowerCase() !== cleanName.toLowerCase()), created];
      await saveTenantExpenseCatalog(tenantId, store.cfg, { ...store, banks: nextBanks });
      res.json({ success: true, ...created });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/loans', requirePermission('accounting.view'), async (req, res) => {
    try {
      const store = await getTenantExpenseCatalog(req.tenantId);
      const bankName = req.query.bank_name ? String(req.query.bank_name).trim().toLowerCase() : null;
      const loans = bankName
        ? store.loans.filter((l) => String(l.bank_name || '').trim().toLowerCase() === bankName)
        : store.loans;
      res.json(loans);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/loans', requirePermission('accounting.expenses.manage'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const body = req.body || {};
      const loanName = String(body.loan_name || body.name || '').trim();
      if (!loanName) return res.status(400).json({ error: 'El nombre o referencia del préstamo es requerido.' });
      const store = await getTenantExpenseCatalog(tenantId);
      const created = {
        id: `loan_${Date.now()}`,
        loan_name: loanName,
        name: loanName,
        bank_name: body.bank_name || '',
        loan_ref: body.loan_ref || body.reference || '',
        total_amount: Number(body.total_amount || 0),
      };
      const nextLoans = [...store.loans, created];
      await saveTenantExpenseCatalog(tenantId, store.cfg, { ...store, loans: nextLoans });
      res.json({ success: true, ...created });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/accounts', requirePermission('accounting.view'), async (req, res) => {
    try {
      const store = await getTenantExpenseCatalog(req.tenantId);
      const map = new Map();
      for (const a of DEFAULT_ACCOUNTS) map.set(a.name.toLowerCase(), a);
      for (const a of store.accounts) if (a?.name) map.set(String(a.name).toLowerCase(), a);
      res.json(Array.from(map.values()));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/accounts', requirePermission('accounting.expenses.manage'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { name, type = 'Banco', bank_name = '' } = req.body || {};
      if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre de la cuenta es requerido.' });
      const cleanName = String(name).trim();
      const store = await getTenantExpenseCatalog(tenantId);
      const created = { id: `acc_${Date.now()}`, name: cleanName, type, bank_name };
      const nextAccounts = [...store.accounts.filter((a) => String(a.name || '').toLowerCase() !== cleanName.toLowerCase()), created];
      await saveTenantExpenseCatalog(tenantId, store.cfg, { ...store, accounts: nextAccounts });
      res.json({ success: true, ...created });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/reconcile-json', requirePermission('accounting.expenses.manage'), async (_req, res) => {
    res.json({ success: true, imported: 0, message: 'Registros sincronizados con PostgreSQL.' });
  });

  // GET /api/expenses
  router.get('/', requirePermission('accounting.view'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const scope = getBranchScope(req);
      const { salon_id, salon, period, start_date, end_date, category, concept, status } = req.query;
      let query = 'SELECT * FROM expenses WHERE tenant_id = ?';
      const params = [tenantId];

      const branchFilter = salon_id || salon;
      if (!scope.allBranches && scope.branchIds.length > 0) {
        if (branchFilter && branchFilter !== 'all' && branchFilter !== 'Todas' && !scope.branchIds.includes(String(branchFilter))) {
          return res.status(403).json({ error: 'Acceso denegado: sucursal fuera de tu alcance autorizado.', code: 'FORBIDDEN_BRANCH_SCOPE' });
        }
        const placeholders = scope.branchIds.map(() => '?').join(', ');
        query += ` AND (salon_id::text IN (${placeholders}) OR branch_id::text IN (${placeholders}))`;
        params.push(...scope.branchIds, ...scope.branchIds);
      }
      if (branchFilter && branchFilter !== 'all' && branchFilter !== 'Todas') {
        query += " AND (salon_id::text = ? OR branch_id::text = ? OR LOWER(COALESCE(salon_name, '')) LIKE LOWER(?))";
        params.push(String(branchFilter), String(branchFilter), `%${branchFilter}%`);
      }

      if (period && /^\d{4}-\d{2}$/.test(String(period).trim())) {
        const [y, m] = String(period).trim().split('-').map(Number);
        const pStart = `${y}-${String(m).padStart(2, '0')}-01`;
        const pEnd = `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
        query += ' AND COALESCE(payment_date, date, expense_date) BETWEEN ? AND ?';
        params.push(pStart, pEnd);
      } else if (start_date && end_date) {
        query += ' AND COALESCE(payment_date, date, expense_date) BETWEEN ? AND ?';
        params.push(start_date, end_date);
      }

      if (category && category !== 'all' && category !== 'Todas') {
        query += ' AND category = ?';
        params.push(category);
      }
      if (concept && concept !== 'all' && concept !== 'Todos') {
        query += " AND (LOWER(COALESCE(concept_name, concept, '')) = LOWER(?) OR LOWER(COALESCE(concept_name, concept, '')) LIKE LOWER(?))";
        params.push(String(concept).trim(), `%${String(concept).trim()}%`);
      }
      if (status && status !== 'all' && status !== 'Todos') {
        query += " AND COALESCE(status, 'Registrado') = ?";
        params.push(status);
      }

      query += ' ORDER BY COALESCE(payment_date, date, expense_date) DESC, created_at DESC';
      const [rows] = await pool.query(query, params);
      const records = (rows || []).map(normalizeExpenseRecord);

      let totalAmount = 0;
      let totalLoans = 0;
      let totalCapital = 0;
      let totalInterest = 0;
      let totalCharges = 0;
      let activeCount = 0;
      let voidedCount = 0;
      const byConcept = {};
      const bySalon = {};

      for (const r of records) {
        if (r.status === 'Anulado') {
          voidedCount += 1;
          continue;
        }
        activeCount += 1;
        const amt = Number(r.amount || 0);
        totalAmount += amt;
        if (r.is_loan) {
          totalLoans += amt;
          totalCapital += Number(r.breakdown_capital || 0);
          totalInterest += Number(r.breakdown_interest || 0);
          totalCharges += Number(r.breakdown_charges || 0);
        }
        byConcept[r.concept_name] = (byConcept[r.concept_name] || 0) + amt;
        bySalon[r.salon_name] = (bySalon[r.salon_name] || 0) + amt;
      }

      res.json({
        records,
        expenses: records,
        total: Number(totalAmount.toFixed(2)),
        summary: {
          totalAmount: Number(totalAmount.toFixed(2)),
          total_amount: Number(totalAmount.toFixed(2)),
          totalLoans: Number(totalLoans.toFixed(2)),
          totalCapital: Number(totalCapital.toFixed(2)),
          totalInterest: Number(totalInterest.toFixed(2)),
          totalCharges: Number(totalCharges.toFixed(2)),
          count: activeCount,
          activeCount,
          voidedCount,
          byConcept,
          bySalon,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/expenses
  router.post('/', requireExpenseWritePermission, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const {
        concept,
        concept_name,
        description,
        observation,
        category = 'Operativo',
        amount,
        date,
        payment_date,
        payment_method = 'Efectivo',
        account_name,
        salon_id = 1,
        salon_name,
        reference = '',
        rnc_proveedor = '',
        ncf = '',
        bank_name = null,
        loan_id = null,
        loan_name = null,
        loan_ref = null,
        loan_period = null,
        breakdown_capital = 0,
        breakdown_interest = 0,
        breakdown_charges = 0,
        is_loan = 0,
        status = 'Registrado',
        created_by = 'Administrador'
      } = req.body || {};

      if (!amount || Number(amount) <= 0) {
        return res.status(400).json({ error: 'El monto del gasto debe ser mayor a 0.' });
      }

      const rawDate = payment_date || date;
      const cleanDate = rawDate ? String(rawDate).split('T')[0] : new Date().toISOString().slice(0, 10);
      const finalConcept = String(concept_name || concept || description || 'Gasto Operativo').trim();
      const finalDesc = String(description || observation || finalConcept || '').trim();
      const finalAccount = String(account_name || payment_method || 'Caja Chica / Efectivo').trim();
      const finalSalonName = String(salon_name || 'Principal').trim();
      const finalRef = String(reference || ncf || '').trim();
      const safeSalonId = Number.isInteger(Number(salon_id)) && Number(salon_id) > 0 ? Number(salon_id) : 1;

      const [result] = await pool.query(
        `INSERT INTO expenses (
           tenant_id, concept, concept_name, description, observation, category, amount,
           date, expense_date, payment_date, payment_method, account_name,
           salon_id, salon_name, reference, rnc_proveedor, ncf,
           bank_name, loan_id, loan_name, loan_ref, loan_period,
           breakdown_capital, breakdown_interest, breakdown_charges, is_loan, status,
           created_by, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         RETURNING *`,
        [
          tenantId,
          finalConcept,
          finalConcept,
          finalDesc,
          observation || finalDesc,
          category,
          Number(amount),
          cleanDate,
          cleanDate,
          cleanDate,
          payment_method,
          finalAccount,
          safeSalonId,
          finalSalonName,
          finalRef,
          rnc_proveedor,
          ncf || finalRef,
          bank_name,
          loan_id && Number.isInteger(Number(loan_id)) ? Number(loan_id) : null,
          loan_name,
          loan_ref,
          loan_period,
          Number(breakdown_capital || 0),
          Number(breakdown_interest || 0),
          Number(breakdown_charges || 0),
          is_loan ? 1 : 0,
          status || 'Registrado',
          created_by
        ]
      );

      const createdRow = result?.[0] || { id: result.insertId || result[0]?.id };
      res.json({
        id: createdRow.id,
        success: true,
        record: normalizeExpenseRecord(createdRow),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/expenses/:id
  router.get('/:id', requirePermission('accounting.view'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const [rows] = await pool.query('SELECT * FROM expenses WHERE id::text = ? AND tenant_id = ?', [String(req.params.id), tenantId]);
      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'Egreso no encontrado' });
      }
      res.json(normalizeExpenseRecord(rows[0]));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/expenses/:id/void
  router.post('/:id/void', requirePermission('accounting.expenses.void'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const reason = String(req.body?.reason || req.body?.void_reason || 'Anulado por usuario autorizado').trim();
      const [result] = await pool.query(
        "UPDATE expenses SET status = 'Anulado', void_reason = ? WHERE id::text = ? AND tenant_id = ?",
        [reason, String(req.params.id), tenantId]
      );
      const affected = result.affectedRows ?? result.rowCount ?? 0;
      if (affected === 0) {
        return res.status(404).json({ error: 'Egreso no encontrado' });
      }
      res.json({ success: true, voided: true, status: 'Anulado', void_reason: reason });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/expenses/:id
  router.put('/:id', requireExpenseWritePermission, async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const {
        concept,
        concept_name,
        description,
        observation,
        category,
        amount,
        date,
        payment_date,
        payment_method,
        account_name,
        salon_id,
        salon_name,
        reference,
        rnc_proveedor,
        ncf,
        bank_name,
        loan_name,
        loan_ref,
        loan_period,
        breakdown_capital,
        breakdown_interest,
        breakdown_charges,
        is_loan,
        status
      } = req.body || {};
      const rawDate = payment_date || date;
      const cleanDate = rawDate ? String(rawDate).split('T')[0] : null;
      const finalConcept = concept_name || concept || null;
      const finalDesc = description !== undefined ? description : (observation !== undefined ? observation : null);

      await pool.query(
        `UPDATE expenses SET
           concept = COALESCE(?, concept),
           concept_name = COALESCE(?, concept_name, concept),
           description = COALESCE(?, description),
           observation = COALESCE(?, observation, description),
           category = COALESCE(?, category),
           amount = COALESCE(?, amount),
           date = COALESCE(?, date),
           expense_date = COALESCE(?, expense_date),
           payment_date = COALESCE(?, payment_date, date),
           payment_method = COALESCE(?, payment_method),
           account_name = COALESCE(?, account_name),
           salon_id = COALESCE(?, salon_id),
           salon_name = COALESCE(?, salon_name),
           reference = COALESCE(?, reference),
           rnc_proveedor = COALESCE(?, rnc_proveedor),
           ncf = COALESCE(?, ncf),
           bank_name = COALESCE(?, bank_name),
           loan_name = COALESCE(?, loan_name),
           loan_ref = COALESCE(?, loan_ref),
           loan_period = COALESCE(?, loan_period),
           breakdown_capital = COALESCE(?, breakdown_capital),
           breakdown_interest = COALESCE(?, breakdown_interest),
           breakdown_charges = COALESCE(?, breakdown_charges),
           is_loan = COALESCE(?, is_loan),
           status = COALESCE(?, status)
         WHERE id::text = ? AND tenant_id = ?`,
        [
          finalConcept,
          finalConcept,
          finalDesc,
          observation !== undefined ? observation : finalDesc,
          category || null,
          amount !== undefined ? Number(amount) : null,
          cleanDate,
          cleanDate,
          cleanDate,
          payment_method || null,
          account_name || null,
          salon_id && Number.isInteger(Number(salon_id)) ? Number(salon_id) : null,
          salon_name || null,
          reference !== undefined ? reference : null,
          rnc_proveedor !== undefined ? rnc_proveedor : null,
          ncf !== undefined ? ncf : null,
          bank_name !== undefined ? bank_name : null,
          loan_name !== undefined ? loan_name : null,
          loan_ref !== undefined ? loan_ref : null,
          loan_period !== undefined ? loan_period : null,
          breakdown_capital !== undefined ? Number(breakdown_capital) : null,
          breakdown_interest !== undefined ? Number(breakdown_interest) : null,
          breakdown_charges !== undefined ? Number(breakdown_charges) : null,
          is_loan !== undefined ? (is_loan ? 1 : 0) : null,
          status || null,
          String(id),
          tenantId
        ]
      );

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/expenses/:id
  router.delete('/:id', requirePermission('accounting.expenses.void'), async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      await pool.query('DELETE FROM expenses WHERE id::text = ? AND tenant_id = ?', [String(id), tenantId]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = createExpensesRouter;
module.exports.createExpensesRouter = createExpensesRouter;
