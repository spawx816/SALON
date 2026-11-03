const express = require('express');
const fs = require('fs');
const path = require('path');

/**
 * Módulo de Egresos Contables (SalonPro)
 * Gestión de salidas financieras y tributarias de la empresa
 * (TSS, INFOTEP, préstamos bancarios, anticipos, residuos sólidos, etc.)
 *
 * Persistencia directa sobre MySQL como fuente única de verdad.
 * Se eliminó el fallback automático a JSON en producción.
 * Conserva backend/data/expenses_store.json para conciliación y provee
 * endpoint administrativo POST /reconcile-json para migrar registros históricos.
 *
 * @param {import('mysql2/promise').Pool} pool
 */
function createExpensesRouter(pool) {
  const router = express.Router();
  const DATA_DIR = path.join(__dirname, '../data');
  const STORE_FILE = path.join(DATA_DIR, 'expenses_store.json');

  // Helper para verificar conexión de base de datos
  const ensurePool = (res) => {
    if (!pool) {
      res.status(500).json({
        error: 'El servicio de base de datos MySQL no se encuentra inicializado.'
      });
      return false;
    }
    return true;
  };

  // Helper para extraer usuario de cabecera
  const getUserName = (req) => {
    return req.headers['x-user-name'] || req.headers['x-user-email'] || 'Administrador';
  };

  // Helper para registrar en audit_logs de forma no intrusiva
  const logAudit = async (action, entityId, userName, reason, metadata = {}) => {
    if (!pool) return;
    try {
      await pool.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, user_name, reason, metadata)
         VALUES ('expense', ?, ?, ?, ?, ?)`,
        [String(entityId), action, userName, reason || null, JSON.stringify(metadata)]
      );
    } catch (e) {
      // Si la tabla audit_logs no está disponible o difiere en estructura, no bloquear la transacción principal
      console.warn('[EXPENSES AUDIT NOTICE]:', e.message);
    }
  };

  // Helper centralizado para capturar ausencia de tablas sin exponer errores SQL internos
  const handleSqlError = (err, res, defaultMessage) => {
    if (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146 || (err.message && err.message.toLowerCase().includes("doesn't exist"))) {
      return res.status(503).json({
        error: 'El módulo de Egresos requiere activación en base de datos. Se requiere ejecutar la migración 20261103_create_expenses_tables.sql en MySQL.',
        code: 'MIGRATION_PENDING',
        details: err.message
      });
    }
    console.error(`[EXPENSES] ${defaultMessage}:`, err.message);
    return res.status(500).json({ error: err.message || defaultMessage });
  };

  // =========================================================================
  // 0. ESTADO DE ACTIVACIÓN DEL MÓDULO (MySQL)
  // =========================================================================
  router.get('/status', async (req, res) => {
    if (!ensurePool(res)) return;
    try {
      const [rows] = await pool.query(`
        SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('expense_concepts', 'expense_banks', 'expense_loans', 'expense_accounts', 'expenses')
      `);
      const existingTables = rows.map(r => Object.values(r)[0]);
      const requiredTables = ['expense_concepts', 'expense_banks', 'expense_loans', 'expense_accounts', 'expenses'];
      const missingTables = requiredTables.filter(t => !existingTables.includes(t));
      const ready = missingTables.length === 0;

      return res.status(ready ? 200 : 503).json({
        ready,
        code: ready ? 'READY' : 'MIGRATION_PENDING',
        error: ready ? null : 'Módulo pendiente de activación en base de datos. Ejecute la migración 20261103_create_expenses_tables.sql.',
        existingTables,
        missingTables,
        migrationFile: 'backend/migrations/20261103_create_expenses_tables.sql'
      });
    } catch (err) {
      return handleSqlError(err, res, 'Error consultando estado de migración');
    }
  });

  // =========================================================================
  // 1. CONCEPTOS DE EGRESO (MySQL)
  // =========================================================================
  router.get('/concepts', async (req, res) => {
    if (!ensurePool(res)) return;
    try {
      const [rows] = await pool.query(
        'SELECT id, name, description, is_system, is_active FROM expense_concepts WHERE is_active = 1 ORDER BY is_system DESC, name ASC'
      );
      return res.json(rows);
    } catch (err) {
      return handleSqlError(err, res, 'Error en GET /concepts');
    }
  });

  router.post('/concepts', async (req, res) => {
    if (!ensurePool(res)) return;
    try {
      const { name, description } = req.body;
      const cleanName = (name || '').trim();
      if (!cleanName) {
        return res.status(400).json({ error: 'El nombre del concepto es obligatorio.' });
      }

      const [existing] = await pool.query(
        'SELECT id FROM expense_concepts WHERE LOWER(name) = LOWER(?)',
        [cleanName]
      );
      if (existing.length > 0) {
        return res.status(400).json({ error: 'El concepto ya se encuentra registrado.' });
      }

      const [result] = await pool.query(
        'INSERT INTO expense_concepts (name, description, is_system, is_active) VALUES (?, ?, 0, 1)',
        [cleanName, description ? description.trim() : null]
      );

      const userName = getUserName(req);
      await logAudit('CREATE_CONCEPT', result.insertId, userName, `Creación de concepto: ${cleanName}`);

      return res.status(201).json({
        id: result.insertId,
        name: cleanName,
        description: description || null,
        is_system: 0,
        is_active: 1
      });
    } catch (err) {
      return handleSqlError(err, res, 'Error en POST /concepts');
    }
  });

  // =========================================================================
  // 2. ENTIDADES BANCARIAS (MySQL)
  // =========================================================================
  router.get('/banks', async (req, res) => {
    if (!ensurePool(res)) return;
    try {
      const [rows] = await pool.query(
        'SELECT id, name, code, is_active FROM expense_banks WHERE is_active = 1 ORDER BY name ASC'
      );
      return res.json(rows);
    } catch (err) {
      return handleSqlError(err, res, 'Error en GET /banks');
    }
  });

  router.post('/banks', async (req, res) => {
    if (!ensurePool(res)) return;
    try {
      const { name, code } = req.body;
      const cleanName = (name || '').trim();
      if (!cleanName) {
        return res.status(400).json({ error: 'El nombre del banco es obligatorio.' });
      }

      const [existing] = await pool.query(
        'SELECT id FROM expense_banks WHERE LOWER(name) = LOWER(?)',
        [cleanName]
      );
      if (existing.length > 0) {
        return res.status(400).json({ error: 'Este banco ya se encuentra registrado.' });
      }

      const [result] = await pool.query(
        'INSERT INTO expense_banks (name, code, is_active) VALUES (?, ?, 1)',
        [cleanName, code ? code.trim() : null]
      );

      return res.status(201).json({
        id: result.insertId,
        name: cleanName,
        code: code || null,
        is_active: 1
      });
    } catch (err) {
      return handleSqlError(err, res, 'Error en POST /banks');
    }
  });

  // =========================================================================
  // 3. PRÉSTAMOS BANCARIOS (MySQL)
  // =========================================================================
  router.get('/loans', async (req, res) => {
    if (!ensurePool(res)) return;
    try {
      const { bank_name } = req.query;
      let sql = 'SELECT * FROM expense_loans WHERE 1=1';
      const params = [];

      if (bank_name) {
        sql += ' AND LOWER(bank_name) = LOWER(?)';
        params.push(bank_name.trim());
      }
      sql += ' ORDER BY loan_name ASC, id DESC';

      const [rows] = await pool.query(sql, params);
      return res.json(rows);
    } catch (err) {
      return handleSqlError(err, res, 'Error en GET /loans');
    }
  });

  router.post('/loans', async (req, res) => {
    if (!ensurePool(res)) return;
    try {
      const { bank_id, bank_name, loan_name, reference_number, salon_id, salon_name, total_amount } = req.body;
      if (!bank_name || !loan_name || !reference_number) {
        return res.status(400).json({ error: 'Banco, nombre del préstamo y número de referencia son obligatorios.' });
      }

      const cleanBank = bank_name.trim();
      const cleanLoan = loan_name.trim();
      const cleanRef = reference_number.trim();
      const numTotal = total_amount ? parseFloat(total_amount) : null;

      const [result] = await pool.query(
        `INSERT INTO expense_loans (
          bank_id, bank_name, loan_name, reference_number,
          salon_id, salon_name, total_amount, currency, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'DOP', 'Activo')`,
        [
          bank_id || null,
          cleanBank,
          cleanLoan,
          cleanRef,
          salon_id || null,
          salon_name ? salon_name.trim() : null,
          numTotal
        ]
      );

      const userName = getUserName(req);
      await logAudit('CREATE_LOAN', result.insertId, userName, `Préstamo registrado: ${cleanBank} - ${cleanLoan}`);

      return res.status(201).json({
        id: result.insertId,
        bank_id,
        bank_name: cleanBank,
        loan_name: cleanLoan,
        reference_number: cleanRef,
        salon_id,
        salon_name,
        total_amount: numTotal,
        currency: 'DOP',
        status: 'Activo'
      });
    } catch (err) {
      return handleSqlError(err, res, 'Error en POST /loans');
    }
  });

  // =========================================================================
  // 4. CUENTAS DE SALIDA / FONDOS (MySQL)
  // =========================================================================
  router.get('/accounts', async (req, res) => {
    if (!ensurePool(res)) return;
    try {
      const [rows] = await pool.query(
        'SELECT id, name, account_number, type, is_active FROM expense_accounts WHERE is_active = 1 ORDER BY name ASC'
      );
      return res.json(rows);
    } catch (err) {
      return handleSqlError(err, res, 'Error en GET /accounts');
    }
  });

  router.post('/accounts', async (req, res) => {
    if (!ensurePool(res)) return;
    try {
      const { name, account_number, type, bank_id } = req.body;
      const cleanName = (name || '').trim();
      if (!cleanName) {
        return res.status(400).json({ error: 'El nombre de la cuenta es obligatorio.' });
      }

      const [result] = await pool.query(
        'INSERT INTO expense_accounts (name, account_number, type, bank_id, is_active) VALUES (?, ?, ?, ?, 1)',
        [cleanName, account_number ? account_number.trim() : null, type || 'operative', bank_id || null]
      );

      return res.status(201).json({
        id: result.insertId,
        name: cleanName,
        account_number: account_number || null,
        type: type || 'operative',
        is_active: 1
      });
    } catch (err) {
      return handleSqlError(err, res, 'Error en POST /accounts');
    }
  });

  // =========================================================================
  // 5. LISTADO DE EGRESOS (MySQL)
  // =========================================================================
  router.get('/', async (req, res) => {
    if (!ensurePool(res)) return;
    try {
      const { period, salon_id, salon_name, concept, search } = req.query;
      let sql = 'SELECT * FROM expenses WHERE 1=1';
      const params = [];

      // Filtro por período (YYYY-MM)
      if (period && period !== 'all') {
        sql += ' AND period = ?';
        params.push(period.slice(0, 7));
      }

      // Filtro por sucursal
      if (salon_id && salon_id !== 'all' && salon_id !== 'todas') {
        sql += ' AND salon_id = ?';
        params.push(salon_id);
      } else if (salon_name && salon_name !== 'all' && salon_name !== 'todas') {
        sql += ' AND LOWER(salon_name) = LOWER(?)';
        params.push(salon_name.trim());
      }

      // Filtro por concepto
      if (concept && concept !== 'all' && concept !== 'todos') {
        sql += ' AND LOWER(concept_name) = LOWER(?)';
        params.push(concept.trim());
      }

      // Búsqueda predictiva (concepto, referencia, banco, préstamo, observación)
      if (search && search.trim()) {
        const queryTerm = `%${search.trim().toLowerCase()}%`;
        sql += ` AND (
          LOWER(concept_name) LIKE ? OR
          LOWER(reference) LIKE ? OR
          LOWER(bank_name) LIKE ? OR
          LOWER(loan_name) LIKE ? OR
          LOWER(loan_ref) LIKE ? OR
          LOWER(observation) LIKE ?
        )`;
        params.push(queryTerm, queryTerm, queryTerm, queryTerm, queryTerm, queryTerm);
      }

      sql += ' ORDER BY payment_date DESC, id DESC';

      const [rows] = await pool.query(sql, params);

      // Total registrado acumulado excluyendo los registros con estado 'Anulado'
      const totalAmount = rows.reduce((acc, row) => {
        if (row.status !== 'Anulado') {
          return acc + Number(row.amount || 0);
        }
        return acc;
      }, 0);

      return res.json({
        records: rows,
        count: rows.length,
        total_amount: totalAmount,
        period: period || 'all'
      });
    } catch (err) {
      return handleSqlError(err, res, 'Error en GET /');
    }
  });

  // =========================================================================
  // 6. REGISTRO DE NUEVO EGRESO (MySQL)
  // =========================================================================
  router.post('/', async (req, res) => {
    if (!ensurePool(res)) return;
    try {
      const {
        concept_id,
        concept_name,
        payment_date,
        amount,
        payment_method,
        account_id,
        account_name,
        salon_id,
        salon_name,
        reference,
        attachment_name,
        attachment_data,
        attachment_mime,
        observation,
        is_loan,
        bank_id,
        bank_name,
        loan_id,
        loan_name,
        loan_ref,
        loan_period,
        breakdown_capital,
        breakdown_interest,
        breakdown_charges
      } = req.body;

      // Validaciones obligatorias
      if (!concept_name || !payment_date || !payment_method) {
        return res.status(400).json({ error: 'Concepto, fecha de pago y forma de pago son obligatorios.' });
      }

      const numAmount = parseFloat(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ error: 'El importe pagado debe ser mayor a RD$ 0.00.' });
      }

      const isLoanFlag = (concept_name.toLowerCase() === 'préstamos' || concept_name.toLowerCase() === 'prestamos' || Boolean(is_loan)) ? 1 : 0;

      // Validación de desglose para préstamos
      if (isLoanFlag) {
        const cap = parseFloat(breakdown_capital) || 0;
        const int = parseFloat(breakdown_interest) || 0;
        const chg = parseFloat(breakdown_charges) || 0;
        const sumBd = Math.round((cap + int + chg) * 100) / 100;
        if (sumBd > 0 && Math.abs(sumBd - numAmount) > 0.05) {
          return res.status(400).json({
            error: `El importe pagado (RD$ ${numAmount.toFixed(2)}) debe coincidir con la suma del desglose: Capital RD$ ${cap.toFixed(2)} + Interés RD$ ${int.toFixed(2)} + Cargos RD$ ${chg.toFixed(2)} = RD$ ${sumBd.toFixed(2)}.`
          });
        }
      }

      // Validación de soporte documental (tamaño y tipo de archivo)
      if (attachment_data) {
        if (typeof attachment_data === 'string' && attachment_data.length > 7.5 * 1024 * 1024) {
          return res.status(400).json({ error: 'El comprobante adjunto supera el límite máximo permitido de 5MB.' });
        }
        const allowedMimes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (attachment_mime && !allowedMimes.includes(attachment_mime.toLowerCase())) {
          return res.status(400).json({ error: 'Formato de comprobante no admitido. Solo se permiten PDF, JPEG, PNG y WEBP.' });
        }
      }

      const period = payment_date.slice(0, 7);
      const createdBy = getUserName(req);

      const [result] = await pool.query(
        `INSERT INTO expenses (
          concept_id, concept_name, payment_date, period, amount, payment_method,
          account_id, account_name, salon_id, salon_name, reference,
          attachment_name, attachment_data, attachment_mime, observation,
          is_loan, bank_id, bank_name, loan_id, loan_name, loan_ref, loan_period,
          breakdown_capital, breakdown_interest, breakdown_charges,
          status, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Completado', ?)`,
        [
          concept_id || null,
          concept_name.trim(),
          payment_date,
          period,
          numAmount,
          payment_method,
          account_id || null,
          account_name || 'Cuenta operativa · 5678',
          salon_id || null,
          salon_name ? salon_name.trim() : null,
          reference ? reference.trim() : null,
          attachment_name || null,
          attachment_data || null,
          attachment_mime || null,
          observation ? observation.trim() : null,
          isLoanFlag,
          isLoanFlag ? (bank_id || null) : null,
          isLoanFlag ? (bank_name || null) : null,
          isLoanFlag ? (loan_id || null) : null,
          isLoanFlag ? (loan_name || null) : null,
          isLoanFlag ? (loan_ref || null) : null,
          isLoanFlag ? (loan_period || null) : null,
          breakdown_capital ? parseFloat(breakdown_capital) : null,
          breakdown_interest ? parseFloat(breakdown_interest) : null,
          breakdown_charges ? parseFloat(breakdown_charges) : null,
          createdBy
        ]
      );

      const newExpenseId = result.insertId;
      await logAudit('CREATE_EXPENSE', newExpenseId, createdBy, `Registro de egreso ${concept_name}: RD$ ${numAmount}`, {
        concept_name,
        amount: numAmount,
        payment_date,
        reference
      });

      const [createdRows] = await pool.query('SELECT * FROM expenses WHERE id = ?', [newExpenseId]);
      return res.status(201).json(createdRows[0] || { id: newExpenseId });
    } catch (err) {
      return handleSqlError(err, res, 'Error en POST /');
    }
  });

  // =========================================================================
  // 7. OBTENER DETALLE DE EGRESO (MySQL)
  // =========================================================================
  router.get('/:id', async (req, res) => {
    if (!ensurePool(res)) return;
    try {
      const { id } = req.params;
      const [rows] = await pool.query('SELECT * FROM expenses WHERE id = ?', [id]);
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Egreso no encontrado.' });
      }
      return res.json(rows[0]);
    } catch (err) {
      return handleSqlError(err, res, 'Error en GET /:id');
    }
  });

  // =========================================================================
  // 8. ACTUALIZAR EGRESO (MySQL)
  // =========================================================================
  router.put('/:id', async (req, res) => {
    if (!ensurePool(res)) return;
    try {
      const { id } = req.params;
      const [existing] = await pool.query('SELECT * FROM expenses WHERE id = ?', [id]);
      if (existing.length === 0) {
        return res.status(404).json({ error: 'Egreso no encontrado.' });
      }
      if (existing[0].status === 'Anulado') {
        return res.status(400).json({ error: 'No es posible modificar un egreso que ha sido anulado.' });
      }

      const {
        concept_name,
        payment_date,
        amount,
        payment_method,
        account_name,
        salon_id,
        salon_name,
        reference,
        attachment_name,
        attachment_data,
        attachment_mime,
        observation,
        is_loan,
        bank_name,
        loan_id,
        loan_name,
        loan_ref,
        loan_period,
        breakdown_capital,
        breakdown_interest,
        breakdown_charges
      } = req.body;

      const numAmount = amount ? parseFloat(amount) : undefined;
      const period = payment_date ? payment_date.slice(0, 7) : undefined;
      const isLoanFlag = concept_name ? (concept_name.toLowerCase() === 'préstamos' || concept_name.toLowerCase() === 'prestamos' || Boolean(is_loan) ? 1 : 0) : undefined;

      // Validación de desglose para préstamos en edición
      if (isLoanFlag && numAmount !== undefined) {
        const cap = parseFloat(breakdown_capital !== undefined ? breakdown_capital : existing[0].breakdown_capital) || 0;
        const int = parseFloat(breakdown_interest !== undefined ? breakdown_interest : existing[0].breakdown_interest) || 0;
        const chg = parseFloat(breakdown_charges !== undefined ? breakdown_charges : existing[0].breakdown_charges) || 0;
        const sumBd = Math.round((cap + int + chg) * 100) / 100;
        if (sumBd > 0 && Math.abs(sumBd - numAmount) > 0.05) {
          return res.status(400).json({
            error: `El importe pagado (RD$ ${numAmount.toFixed(2)}) debe coincidir con la suma del desglose: Capital RD$ ${cap.toFixed(2)} + Interés RD$ ${int.toFixed(2)} + Cargos RD$ ${chg.toFixed(2)} = RD$ ${sumBd.toFixed(2)}.`
          });
        }
      }

      // Validación de soporte documental al editar
      if (attachment_data) {
        if (typeof attachment_data === 'string' && attachment_data.length > 7.5 * 1024 * 1024) {
          return res.status(400).json({ error: 'El comprobante adjunto supera el límite máximo permitido de 5MB.' });
        }
        const allowedMimes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (attachment_mime && !allowedMimes.includes(attachment_mime.toLowerCase())) {
          return res.status(400).json({ error: 'Formato de comprobante no admitido. Solo se permiten PDF, JPEG, PNG y WEBP.' });
        }
      }

      await pool.query(
        `UPDATE expenses SET
          concept_name = COALESCE(?, concept_name),
          payment_date = COALESCE(?, payment_date),
          period = COALESCE(?, period),
          amount = COALESCE(?, amount),
          payment_method = COALESCE(?, payment_method),
          account_name = COALESCE(?, account_name),
          salon_id = COALESCE(?, salon_id),
          salon_name = COALESCE(?, salon_name),
          reference = COALESCE(?, reference),
          attachment_name = COALESCE(?, attachment_name),
          attachment_data = COALESCE(?, attachment_data),
          attachment_mime = COALESCE(?, attachment_mime),
          observation = COALESCE(?, observation),
          is_loan = COALESCE(?, is_loan),
          bank_name = COALESCE(?, bank_name),
          loan_id = COALESCE(?, loan_id),
          loan_name = COALESCE(?, loan_name),
          loan_ref = COALESCE(?, loan_ref),
          loan_period = COALESCE(?, loan_period),
          breakdown_capital = COALESCE(?, breakdown_capital),
          breakdown_interest = COALESCE(?, breakdown_interest),
          breakdown_charges = COALESCE(?, breakdown_charges),
          updated_at = NOW()
        WHERE id = ?`,
        [
          concept_name,
          payment_date,
          period,
          numAmount,
          payment_method,
          account_name,
          salon_id,
          salon_name,
          reference,
          attachment_name,
          attachment_data,
          attachment_mime,
          observation,
          isLoanFlag,
          bank_name,
          loan_id,
          loan_name,
          loan_ref,
          loan_period,
          breakdown_capital !== undefined ? parseFloat(breakdown_capital) : null,
          breakdown_interest !== undefined ? parseFloat(breakdown_interest) : null,
          breakdown_charges !== undefined ? parseFloat(breakdown_charges) : null,
          id
        ]
      );

      const userName = getUserName(req);
      await logAudit('UPDATE_EXPENSE', id, userName, 'Modificación de datos de egreso', req.body);

      const [updatedRows] = await pool.query('SELECT * FROM expenses WHERE id = ?', [id]);
      return res.json(updatedRows[0]);
    } catch (err) {
      return handleSqlError(err, res, 'Error en PUT /:id');
    }
  });

  // =========================================================================
  // 9. ANULAR EGRESO CON TRAZABILIDAD (MySQL)
  // =========================================================================
  const voidHandler = async (req, res) => {
    if (!ensurePool(res)) return;
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const cleanReason = (reason || '').trim();

      if (!cleanReason) {
        return res.status(400).json({ error: 'Debe especificar el motivo obligatorio de anulación.' });
      }

      const [existing] = await pool.query('SELECT * FROM expenses WHERE id = ?', [id]);
      if (existing.length === 0) {
        return res.status(404).json({ error: 'Egreso no encontrado.' });
      }
      if (existing[0].status === 'Anulado') {
        return res.status(400).json({ error: 'Este egreso ya se encuentra anulado previamente.' });
      }

      const voidedBy = getUserName(req);

      await pool.query(
        `UPDATE expenses SET
          status = 'Anulado',
          void_reason = ?,
          voided_at = NOW(),
          voided_by = ?
        WHERE id = ?`,
        [cleanReason, voidedBy, id]
      );

      await logAudit('VOID_EXPENSE', id, voidedBy, cleanReason, {
        previous_amount: existing[0].amount,
        concept: existing[0].concept_name
      });

      const [updatedRows] = await pool.query('SELECT * FROM expenses WHERE id = ?', [id]);
      return res.json({
        message: 'Egreso anulado correctamente.',
        expense: updatedRows[0]
      });
    } catch (err) {
      return handleSqlError(err, res, 'Error en anulación de egreso');
    }
  };

  router.post('/:id/void', voidHandler);
  router.put('/:id/anular', voidHandler);

  // =========================================================================
  // 10. DESCARGAR / VER SOPORTE ADJUNTO (MySQL)
  // =========================================================================
  router.get('/:id/attachment', async (req, res) => {
    if (!ensurePool(res)) return;
    try {
      const userRole = (req.headers['x-user-role'] || '').toLowerCase();
      if (userRole === 'client' || userRole === 'cliente') {
        return res.status(403).json({ error: 'Acceso estrictamente restringido a personal administrativo.' });
      }

      const { id } = req.params;
      const [rows] = await pool.query(
        'SELECT id, attachment_name, attachment_data, attachment_mime FROM expenses WHERE id = ?',
        [id]
      );

      if (rows.length === 0 || !rows[0].attachment_name) {
        return res.status(404).json({ error: 'El egreso no posee soporte adjunto.' });
      }

      const record = rows[0];
      const safeFilename = String(record.attachment_name || 'comprobante')
        .replace(/[\r\n"\\\/]/g, '_')
        .trim()
        .slice(0, 100);

      res.setHeader('X-Content-Type-Options', 'nosniff');

      if (record.attachment_data && record.attachment_data.startsWith('data:')) {
        const matches = record.attachment_data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const mimeType = matches[1];
          const buffer = Buffer.from(matches[2], 'base64');
          res.setHeader('Content-Type', mimeType);
          res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
          return res.send(buffer);
        }
      }

      return res.json({
        id: record.id,
        attachment_name: safeFilename,
        attachment_data: record.attachment_data,
        mime: record.attachment_mime || 'application/pdf'
      });
    } catch (err) {
      return handleSqlError(err, res, 'Error en descarga de soporte');
    }
  });

  // =========================================================================
  // 11. CONCILIACIÓN / MIGRACIÓN DESDE JSON A MYSQL
  // =========================================================================
  router.post('/reconcile-json', async (req, res) => {
    if (!ensurePool(res)) return;
    try {
      // 1. Acceso administrativo obligatorio
      const userRole = (req.headers['x-user-role'] || '').toLowerCase();
      if (userRole !== 'admin' && userRole !== 'administrador') {
        return res.status(403).json({ error: 'Acceso estrictamente denegado: Esta operación de conciliación requiere rol administrador.' });
      }

      // 2. Protección contra ejecuciones accidentales
      const { confirm } = req.body || {};
      if (confirm !== true && confirm !== 'CONFIRM_RECONCILE') {
        return res.status(400).json({
          error: 'Protección contra ejecución accidental: Se requiere confirmación explícita. Envíe { "confirm": true } en el cuerpo de la solicitud.'
        });
      }

      if (!fs.existsSync(STORE_FILE)) {
        return res.status(404).json({ error: 'No se encontró archivo JSON previo para conciliar.' });
      }

      const raw = fs.readFileSync(STORE_FILE, 'utf8');
      const store = JSON.parse(raw);

      let importedConcepts = 0;
      let importedBanks = 0;
      let importedLoans = 0;
      let importedAccounts = 0;
      let importedExpenses = 0;

      // 1. Conciliar conceptos
      if (Array.isArray(store.concepts)) {
        for (const c of store.concepts) {
          const [exists] = await pool.query('SELECT id FROM expense_concepts WHERE LOWER(name) = LOWER(?)', [c.name]);
          if (exists.length === 0) {
            await pool.query(
              'INSERT INTO expense_concepts (name, description, is_system, is_active) VALUES (?, ?, ?, 1)',
              [c.name, c.description || null, c.is_system ? 1 : 0]
            );
            importedConcepts++;
          }
        }
      }

      // 2. Conciliar bancos
      if (Array.isArray(store.banks)) {
        for (const b of store.banks) {
          const [exists] = await pool.query('SELECT id FROM expense_banks WHERE LOWER(name) = LOWER(?)', [b.name]);
          if (exists.length === 0) {
            await pool.query(
              'INSERT INTO expense_banks (name, code, is_active) VALUES (?, ?, 1)',
              [b.name, b.code || null]
            );
            importedBanks++;
          }
        }
      }

      // 3. Conciliar préstamos
      if (Array.isArray(store.loans)) {
        for (const l of store.loans) {
          const [exists] = await pool.query(
            'SELECT id FROM expense_loans WHERE reference_number = ? AND LOWER(bank_name) = LOWER(?)',
            [l.reference_number, l.bank_name]
          );
          if (exists.length === 0) {
            await pool.query(
              `INSERT INTO expense_loans (
                bank_id, bank_name, loan_name, reference_number, salon_id, salon_name, total_amount, currency, status
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 'DOP', 'Activo')`,
              [l.bank_id || null, l.bank_name, l.loan_name, l.reference_number, l.salon_id || null, l.salon_name || null, l.total_amount || null]
            );
            importedLoans++;
          }
        }
      }

      // 4. Conciliar cuentas
      if (Array.isArray(store.accounts)) {
        for (const a of store.accounts) {
          const [exists] = await pool.query('SELECT id FROM expense_accounts WHERE LOWER(name) = LOWER(?)', [a.name]);
          if (exists.length === 0) {
            await pool.query(
              'INSERT INTO expense_accounts (name, account_number, type, is_active) VALUES (?, ?, ?, 1)',
              [a.name, a.account_number || null, a.type || 'operative']
            );
            importedAccounts++;
          }
        }
      }

      // 5. Conciliar egresos
      if (Array.isArray(store.expenses)) {
        for (const e of store.expenses) {
          const [exists] = await pool.query(
            'SELECT id FROM expenses WHERE payment_date = ? AND amount = ? AND concept_name = ?',
            [e.payment_date, e.amount, e.concept_name]
          );
          if (exists.length === 0) {
            await pool.query(
              `INSERT INTO expenses (
                concept_id, concept_name, payment_date, period, amount, payment_method,
                account_id, account_name, salon_id, salon_name, reference,
                attachment_name, attachment_data, attachment_mime, observation,
                is_loan, bank_id, bank_name, loan_id, loan_name, loan_ref, loan_period,
                breakdown_capital, breakdown_interest, breakdown_charges,
                status, void_reason, voided_at, voided_by, created_by
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                e.concept_id || null,
                e.concept_name,
                e.payment_date,
                e.period || (e.payment_date ? e.payment_date.slice(0, 7) : ''),
                e.amount,
                e.payment_method || 'Transferencia',
                e.account_id || null,
                e.account_name || 'Cuenta operativa · 5678',
                e.salon_id || null,
                e.salon_name || null,
                e.reference || null,
                e.attachment_name || null,
                e.attachment_data || null,
                e.attachment_mime || null,
                e.observation || null,
                e.is_loan || 0,
                e.bank_id || null,
                e.bank_name || null,
                e.loan_id || null,
                e.loan_name || null,
                e.loan_ref || null,
                e.loan_period || null,
                e.breakdown_capital || null,
                e.breakdown_interest || null,
                e.breakdown_charges || null,
                e.status || 'Completado',
                e.void_reason || null,
                e.voided_at || null,
                e.voided_by || null,
                e.created_by || 'Administrador'
              ]
            );
            importedExpenses++;
          }
        }
      }

      const userName = getUserName(req);
      await logAudit('RECONCILE_JSON', 'ALL', userName, 'Conciliación de datos históricos JSON hacia MySQL', {
        importedConcepts,
        importedBanks,
        importedLoans,
        importedAccounts,
        importedExpenses
      });

      return res.json({
        success: true,
        message: 'Conciliación completada exitosamente hacia MySQL.',
        reconciled: {
          concepts: importedConcepts,
          banks: importedBanks,
          loans: importedLoans,
          accounts: importedAccounts,
          expenses: importedExpenses
        }
      });
    } catch (err) {
      return handleSqlError(err, res, 'Error en conciliación JSON -> MySQL');
    }
  });

  return router;
}

module.exports = createExpensesRouter;
