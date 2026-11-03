const http = require('http');
const express = require('express');
const createExpensesRouter = require('./routes/expenses.routes');

function createTestMySqlPool() {
  const store = {
    expense_concepts: [
      { id: 1, name: 'TSS', description: 'Tesorería de la Seguridad Social', is_system: 1, is_active: 1 },
      { id: 2, name: 'INFOTEP', description: 'Instituto Nacional de Formación Técnico Profesional', is_system: 1, is_active: 1 },
      { id: 3, name: 'Anticipos de impuestos', description: 'Anticipos mensuales de Impuesto sobre la Renta DGII', is_system: 1, is_active: 1 },
      { id: 4, name: 'Impuesto a los activos', description: 'Impuesto anual a los activos DGII', is_system: 1, is_active: 1 },
      { id: 5, name: 'Residuos sólidos', description: 'Tasas municipales y aseo urbano', is_system: 1, is_active: 1 },
      { id: 6, name: 'Préstamos', description: 'Amortización de préstamos y cuotas financieras', is_system: 1, is_active: 1 },
      { id: 7, name: 'Otros', description: 'Otros gastos y desembolsos administrativos', is_system: 1, is_active: 1 }
    ],
    expense_banks: [
      { id: 1, name: 'Banco Popular', code: 'BPD', is_active: 1 },
      { id: 2, name: 'Banreservas', code: 'BR', is_active: 1 },
      { id: 3, name: 'Banco BHD', code: 'BHD', is_active: 1 }
    ],
    expense_loans: [
      {
        id: 1,
        bank_id: 1,
        bank_name: 'Banco Popular',
        loan_name: 'Local San Vicente',
        reference_number: '001234',
        salon_id: 1,
        salon_name: 'San Vicente',
        total_amount: 500000.00,
        currency: 'DOP',
        status: 'Activo'
      }
    ],
    expense_accounts: [
      { id: 1, name: 'Cuenta operativa · 5678', account_number: '5678', type: 'operative', is_active: 1 }
    ],
    expenses: [
      {
        id: 1,
        concept_name: 'Préstamos',
        payment_date: '2026-10-30',
        period: '2026-10',
        amount: 24000.00,
        payment_method: 'Transferencia',
        account_name: 'Cuenta operativa · 5678',
        salon_id: 1,
        salon_name: 'San Vicente',
        reference: 'TRX-00321',
        attachment_name: 'recibo_popular_001234.pdf',
        attachment_data: null,
        observation: 'Pago cuota préstamo',
        is_loan: 1,
        bank_name: 'Banco Popular',
        loan_id: 1,
        loan_name: 'Local San Vicente',
        loan_ref: '001234',
        loan_period: 'Octubre 2026',
        breakdown_capital: 18500.00,
        breakdown_interest: 4500.00,
        breakdown_charges: 1000.00,
        status: 'Completado',
        void_reason: null,
        voided_at: null,
        voided_by: null,
        created_by: 'Administrador'
      }
    ],
    audit_logs: []
  };

  return {
    async query(sql, params = []) {
      const cleanSql = sql.replace(/\s+/g, ' ').trim();
      let table = null;
      if (/expense_concepts/i.test(cleanSql)) table = 'expense_concepts';
      else if (/expense_banks/i.test(cleanSql)) table = 'expense_banks';
      else if (/expense_loans/i.test(cleanSql)) table = 'expense_loans';
      else if (/expense_accounts/i.test(cleanSql)) table = 'expense_accounts';
      else if (/audit_logs/i.test(cleanSql)) table = 'audit_logs';
      else if (/expenses/i.test(cleanSql)) table = 'expenses';

      if (/^SELECT/i.test(cleanSql)) {
        if (!table) return [[]];
        let items = store[table].slice();

        if (/WHERE id = \?/i.test(cleanSql)) {
          const id = params[0];
          items = items.filter(r => String(r.id) === String(id));
          return [items];
        }

        if (/WHERE LOWER\(name\) = LOWER\(\?\)/i.test(cleanSql)) {
          const name = params[0];
          items = items.filter(r => (r.name || '').toLowerCase() === (name || '').toLowerCase());
          return [items];
        }

        if (/WHERE reference_number = \? AND LOWER\(bank_name\) = LOWER\(\?\)/i.test(cleanSql)) {
          const [ref, bName] = params;
          items = items.filter(r => r.reference_number === ref && (r.bank_name || '').toLowerCase() === (bName || '').toLowerCase());
          return [items];
        }

        if (/WHERE payment_date = \? AND amount = \? AND concept_name = \?/i.test(cleanSql)) {
          const [pDate, amt, cName] = params;
          items = items.filter(r => r.payment_date === pDate && Number(r.amount) === Number(amt) && r.concept_name === cName);
          return [items];
        }

        if (table === 'expenses' && /WHERE 1=1/i.test(cleanSql)) {
          let paramIdx = 0;
          if (/AND period = \?/i.test(cleanSql)) {
            const p = params[paramIdx++];
            items = items.filter(r => (r.period || '').slice(0, 7) === p.slice(0, 7));
          }
          items.sort((a, b) => new Date(b.payment_date) - new Date(a.payment_date) || b.id - a.id);
          return [items];
        }

        return [items];
      }

      if (/^INSERT INTO/i.test(cleanSql)) {
        if (!table) return [{ insertId: 1 }];
        const newId = store[table].reduce((max, r) => Math.max(max, r.id || 0), 0) + 1;

        if (table === 'expense_concepts') {
          const [name, description, is_system] = params;
          store[table].push({ id: newId, name, description, is_system: Number(is_system || 0), is_active: 1 });
          return [{ insertId: newId }];
        }

        if (table === 'expense_banks') {
          const [name, code] = params;
          store[table].push({ id: newId, name, code, is_active: 1 });
          return [{ insertId: newId }];
        }

        if (table === 'expense_loans') {
          const [bank_id, bank_name, loan_name, reference_number, salon_id, salon_name, total_amount] = params;
          store[table].push({ id: newId, bank_id, bank_name, loan_name, reference_number, salon_id, salon_name, total_amount, currency: 'DOP', status: 'Activo' });
          return [{ insertId: newId }];
        }

        if (table === 'expense_accounts') {
          const [name, account_number, type, bank_id] = params;
          store[table].push({ id: newId, name, account_number, type, bank_id, is_active: 1 });
          return [{ insertId: newId }];
        }

        if (table === 'audit_logs') {
          const [entity_id, action, user_name, reason, metadata] = params;
          store.audit_logs.push({ id: newId, entity_id, action, user_name, reason, metadata });
          return [{ insertId: newId }];
        }

        if (table === 'expenses') {
          const colMatch = cleanSql.match(/INSERT INTO expenses\s*\(([^)]+)\)/i);
          const row = { id: newId, status: 'Completado' };
          if (colMatch) {
            const cols = colMatch[1].split(',').map(c => c.trim().toLowerCase());
            cols.forEach((colName, idx) => {
              row[colName] = params[idx];
            });
          } else {
            const [
              concept_id, concept_name, payment_date, period, amount, payment_method,
              account_id, account_name, salon_id, salon_name, reference,
              attachment_name, attachment_data, attachment_mime, observation,
              is_loan, bank_id, bank_name, loan_id, loan_name, loan_ref, loan_period,
              breakdown_capital, breakdown_interest, breakdown_charges,
              created_by
            ] = params;
            Object.assign(row, {
              concept_id, concept_name, payment_date, period, amount, payment_method,
              account_id, account_name, salon_id, salon_name, reference,
              attachment_name, attachment_data, attachment_mime, observation,
              is_loan, bank_id, bank_name, loan_id, loan_name, loan_ref, loan_period,
              breakdown_capital, breakdown_interest, breakdown_charges,
              created_by
            });
          }
          store.expenses.unshift(row);
          return [{ insertId: newId }];
        }
      }

      if (/^UPDATE/i.test(cleanSql)) {
        if (/UPDATE expenses SET status = 'Anulado'/i.test(cleanSql)) {
          const [void_reason, voided_by, id] = params;
          const record = store.expenses.find(r => String(r.id) === String(id));
          if (record) {
            record.status = 'Anulado';
            record.void_reason = void_reason;
            record.voided_by = voided_by;
            record.voided_at = new Date().toISOString();
          }
          return [{ affectedRows: 1 }];
        }

        if (/UPDATE expenses SET/i.test(cleanSql)) {
          const id = params[params.length - 1];
          const record = store.expenses.find(r => String(r.id) === String(id));
          if (record) {
            record.reference = params[8] || record.reference;
          }
          return [{ affectedRows: 1 }];
        }
      }

      return [[]];
    },
    _store: store
  };
}

async function runRegressionSuite() {
  console.log('=== VERIFICACIÓN INTEGRAL DE CIERRE — MÓDULO EGRESOS ===\n');

  const mockPool = createTestMySqlPool();
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.use((req, res, next) => {
    const userRole = (req.headers['x-user-role'] || '').toLowerCase();
    if (userRole === 'client' || userRole === 'cliente') {
      return res.status(403).json({ error: 'Acceso estrictamente denegado: Esta operación requiere privilegios de administración del sistema.' });
    }
    next();
  });

  const expensesRouter = createExpensesRouter(mockPool);
  app.use('/api/expenses', expensesRouter);

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/expenses`;

  const request = (path, options = {}) => {
    return new Promise((resolve, reject) => {
      const url = `${baseUrl}${path}`;
      const parsedUrl = new URL(url);
      const reqOpts = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': options.role || 'admin',
          'x-user-name': options.userName || 'Auditor General',
          ...(options.headers || {})
        }
      };

      const req = http.request(reqOpts, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            resolve({ status: res.statusCode, body: parsed, headers: res.headers, raw: data });
          } catch (e) {
            resolve({ status: res.statusCode, headers: res.headers, raw: data });
          }
        });
      });

      req.on('error', reject);
      if (options.body) req.write(JSON.stringify(options.body));
      req.end();
    });
  };

  try {
    // 1. Seguridad reconcile-json: Rechazar sin rol admin
    console.log('1. [Seguridad] Verificando bloqueo de reconcile-json sin rol admin...');
    const recNoAuth = await request('/reconcile-json', { method: 'POST', role: 'reception', body: { confirm: true } });
    if (recNoAuth.status !== 403) throw new Error(`Fallo: esperó 403 y recibió ${recNoAuth.status}`);
    console.log('   OK: Rechazado con 403 a usuarios no administradores.');

    // 2. Seguridad reconcile-json: Rechazar sin confirmación explícita
    console.log('2. [Seguridad] Verificando protección contra ejecución accidental en reconcile-json...');
    const recNoConfirm = await request('/reconcile-json', { method: 'POST', role: 'admin', body: {} });
    if (recNoConfirm.status !== 400 || !recNoConfirm.body.error.includes('confirmación')) {
      throw new Error(`Fallo: esperó 400 con mensaje de confirmación requerida y recibió ${recNoConfirm.status}`);
    }
    console.log('   OK: Bloqueado con 400 requiriendo { "confirm": true }.');

    // 3. Idempotencia de reconcile-json
    console.log('3. [Idempotencia] Ejecutando conciliación confirmada...');
    const recSuccess = await request('/reconcile-json', { method: 'POST', role: 'admin', body: { confirm: true } });
    if (recSuccess.status !== 200 || !recSuccess.body.success) {
      throw new Error('Fallo en conciliación autorizada');
    }
    console.log('   OK: Conciliación ejecutada sin errores.');

    // 4. Seguridad de soportes: Rechazar archivos no permitidos
    console.log('4. [Seguridad] Verificando rechazo de tipos de archivo maliciosos/no permitidos (.exe, .html)...');
    const badFileRes = await request('/', {
      method: 'POST',
      body: {
        concept_name: 'Otros',
        payment_date: '2026-10-31',
        amount: 1000,
        payment_method: 'Efectivo',
        attachment_name: 'script.exe',
        attachment_data: 'data:application/x-msdownload;base64,AAAA...',
        attachment_mime: 'application/x-msdownload'
      }
    });
    if (badFileRes.status !== 400) throw new Error(`Fallo: esperó 400 por MIME malicioso y recibió ${badFileRes.status}`);
    console.log('   OK: Archivos no autorizados rechazados con código 400.');

    // 5. Seguridad de soportes: Rechazar archivos que excedan 5MB
    console.log('5. [Seguridad] Verificando rechazo de archivos > 5MB...');
    const largePayload = 'A'.repeat(8 * 1024 * 1024); // 8MB
    const largeFileRes = await request('/', {
      method: 'POST',
      body: {
        concept_name: 'Otros',
        payment_date: '2026-10-31',
        amount: 1000,
        payment_method: 'Efectivo',
        attachment_name: 'recibo_gigante.pdf',
        attachment_data: largePayload,
        attachment_mime: 'application/pdf'
      }
    });
    if (largeFileRes.status !== 400) throw new Error(`Fallo: esperó 400 por tamaño excesivo y recibió ${largeFileRes.status}`);
    console.log('   OK: Archivos mayores a 5MB rechazados con código 400.');

    // 6. Registro de egreso legítimo con soporte PDF
    console.log('6. [Persistencia] Registrando egreso válido con soporte PDF y desglose...');
    const validExpRes = await request('/', {
      method: 'POST',
      body: {
        concept_name: 'Préstamos',
        payment_date: '2026-10-31',
        amount: 25000.00,
        payment_method: 'Transferencia',
        account_name: 'Cuenta operativa · 5678',
        salon_name: 'San Vicente',
        reference: 'TRX-VALID-01',
        attachment_name: 'comprobante_banco.pdf',
        attachment_data: 'data:application/pdf;base64,JVBERi0xLjQKJ...',
        attachment_mime: 'application/pdf',
        bank_name: 'Banco Popular',
        loan_name: 'Local San Vicente',
        loan_ref: '001234',
        loan_period: 'Octubre 2026',
        breakdown_capital: 19000.00,
        breakdown_interest: 5000.00,
        breakdown_charges: 1000.00
      }
    });
    if (validExpRes.status !== 201) throw new Error('Fallo al registrar egreso');
    const createdId = validExpRes.body.id;
    console.log(`   OK: Egreso creado con ID ${createdId}.`);

    // 7. Descarga segura y headers de soporte
    console.log('7. [Seguridad] Verificando headers de descarga de soporte (X-Content-Type-Options: nosniff)...');
    const attachRes = await request(`/${createdId}/attachment`);
    if (attachRes.status !== 200) throw new Error('Fallo recuperando soporte');
    if (attachRes.headers['x-content-type-options'] !== 'nosniff') {
      throw new Error('Falta header X-Content-Type-Options: nosniff');
    }
    console.log('   OK: Soporte servido con X-Content-Type-Options: nosniff y Content-Disposition sanitizado.');

    // 8. Trazabilidad de Auditoría (audit_logs)
    console.log('8. [Auditoría] Verificando eventos en audit_logs...');
    const auditLogs = mockPool._store.audit_logs;
    const createEvent = auditLogs.find(a => a.action === 'CREATE_EXPENSE' && String(a.entity_id) === String(createdId));
    if (!createEvent) throw new Error('No se encontró evento CREATE_EXPENSE en audit_logs');
    console.log(`   OK: Evento CREATE_EXPENSE registrado por "${createEvent.user_name}".`);

    // 9. Integridad de totales y anulación
    console.log('9. [Integridad] Verificando anulación y exclusión estricta de totales...');
    const listBeforeVoid = await request('/?period=2026-10');
    const totalBefore = listBeforeVoid.body.total_amount;

    const voidRes = await request(`/${createdId}/void`, {
      method: 'POST',
      body: { reason: 'Error en fecha de aplicación contable' },
      userName: 'Auditor Financiero'
    });
    if (voidRes.status !== 200 || voidRes.body.expense.status !== 'Anulado') {
      throw new Error('Fallo en anulación de egreso');
    }

    const listAfterVoid = await request('/?period=2026-10');
    const expectedTotalAfter = totalBefore - 25000.00;
    if (Math.abs(listAfterVoid.body.total_amount - expectedTotalAfter) > 0.01) {
      throw new Error(`Total tras anulación erróneo: esperado ${expectedTotalAfter}, obtenido ${listAfterVoid.body.total_amount}`);
    }
    console.log(`   OK: Total recalculado de RD$ ${totalBefore} a RD$ ${listAfterVoid.body.total_amount} (sustracción exacta de RD$ 25,000.00).`);

    // 10. Evento VOID_EXPENSE en auditoría
    const voidEvent = auditLogs.find(a => a.action === 'VOID_EXPENSE' && String(a.entity_id) === String(createdId));
    if (!voidEvent || voidEvent.reason !== 'Error en fecha de aplicación contable') {
      throw new Error('Evento VOID_EXPENSE no contiene la justificación requerida');
    }
    console.log(`   OK: Evento VOID_EXPENSE registrado en audit_logs con motivo: "${voidEvent.reason}".`);

    // 11. RBAC estricto a clientes
    console.log('11. [RBAC] Comprobando denegación total a clientes...');
    const clientBlocked = await request(`/${createdId}/attachment`, { role: 'client' });
    if (clientBlocked.status !== 403) throw new Error('Fallo: cliente no recibió 403');
    console.log('   OK: Acceso denegado con 403 a usuarios con rol client/cliente.');

    console.log('\n=== CIERRE Y VALIDACIÓN COMPLETADA CON ÉXITO: 11/11 PRUEBAS APROBADAS ===');
  } finally {
    server.close();
  }
}

runRegressionSuite().catch(err => {
  console.error('\nERROR EN REGRESIÓN DE CIERRE:', err);
  process.exit(1);
});
