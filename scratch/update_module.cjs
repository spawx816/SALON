const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/components/admin/ExpensesModule.jsx');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Añadir estado migrationPending
const stateSearch = "const [salons, setSalons] = useState([]);";
const stateReplace = `const [salons, setSalons] = useState([]);\n  const [migrationPending, setMigrationPending] = useState(false);`;

code = code.replace(stateSearch, stateReplace);

// 2. Actualizar loadInitialCatalogs y fetchExpenses
const catalogsOld = `  // Cargar datos iniciales
  const loadInitialCatalogs = async () => {
    try {
      const [cList, bList, lList, aList, sList] = await Promise.all([
        dataService.getExpenseConcepts(),
        dataService.getExpenseBanks(),
        dataService.getExpenseLoans(),
        dataService.getExpenseAccounts(),
        dataService.getSalons().catch(() => [])
      ]);

      setConcepts(cList || []);
      setBanks(bList || []);
      setLoans(lList || []);
      setAccounts(aList || []);

      const safeSalons = (sList || []).map(s => ({
        id: s.id,
        name: s.name.replace(/^Abatte Peluquería\\s+/i, '')
      }));
      setSalons(safeSalons.length > 0 ? safeSalons : [
        { id: 1, name: 'San Vicente' },
        { id: 4, name: 'Sirena Villa Mella' }
      ]);
    } catch (err) {
      console.error('Error cargando catálogos de egresos:', err);
    }
  };

  // Cargar lista de egresos según filtros
  const fetchExpenses = async () => {
    setLoading(true);
    try {
      const params = {
        period: currentPeriod,
        search: searchTerm
      };
      if (filterSalon !== 'all') params.salon_name = filterSalon;
      if (filterConcept !== 'all') params.concept = filterConcept;

      const res = await dataService.getExpenses(params);
      setExpenses(res.records || []);
    } catch (err) {
      console.error('Error cargando egresos:', err);
      showNotification('Error al cargar egresos', 'error');
    } finally {
      setLoading(false);
    }
  };`;

const catalogsNew = `  // Cargar datos iniciales
  const loadInitialCatalogs = async () => {
    try {
      const [statusRes, cList, bList, lList, aList, sList] = await Promise.all([
        dataService.getExpensesStatus().catch(() => ({ ready: false, code: 'ERROR' })),
        dataService.getExpenseConcepts().catch(() => []),
        dataService.getExpenseBanks().catch(() => []),
        dataService.getExpenseLoans().catch(() => []),
        dataService.getExpenseAccounts().catch(() => []),
        dataService.getSalons().catch(() => [])
      ]);

      if (statusRes && (statusRes.code === 'MIGRATION_PENDING' || statusRes.ready === false)) {
        setMigrationPending(true);
      } else {
        setMigrationPending(false);
      }

      setConcepts(cList || []);
      setBanks(bList || []);
      setLoans(lList || []);
      setAccounts(aList || []);

      const safeSalons = (sList || []).map(s => ({
        id: s.id,
        name: s.name.replace(/^Abatte Peluquería\\s+/i, '')
      }));
      setSalons(safeSalons.length > 0 ? safeSalons : [
        { id: 1, name: 'San Vicente' },
        { id: 4, name: 'Sirena Villa Mella' }
      ]);
    } catch (err) {
      console.error('Error cargando catálogos de egresos:', err);
    }
  };

  // Cargar lista de egresos según filtros
  const fetchExpenses = async () => {
    setLoading(true);
    try {
      const params = {
        period: currentPeriod,
        search: searchTerm
      };
      if (filterSalon !== 'all') params.salon_name = filterSalon;
      if (filterConcept !== 'all') params.concept = filterConcept;

      const res = await dataService.getExpenses(params);
      if (res.migrationPending) {
        setMigrationPending(true);
        setExpenses([]);
        return;
      }
      setExpenses(res.records || []);
    } catch (err) {
      console.error('Error cargando egresos:', err);
      if (err.message && (err.message.includes('MIGRATION_PENDING') || err.message.includes('activación') || err.message.includes("doesn't exist"))) {
        setMigrationPending(true);
      } else {
        showNotification('Error al cargar egresos', 'error');
      }
    } finally {
      setLoading(false);
    }
  };`;

code = code.replace(catalogsOld, catalogsNew);

// 3. Validación de préstamo en handleSaveExpense
const saveCheckOld = `      const isLoan = formData.concept_name.toLowerCase() === 'préstamos' || formData.concept_name.toLowerCase() === 'prestamos';

      const payload = {`;

const saveCheckNew = `      if (migrationPending) {
        showNotification('Módulo pendiente de activación. Ejecute la migración SQL en MySQL antes de guardar.', 'warning');
        return;
      }

      const isLoan = formData.concept_name.toLowerCase() === 'préstamos' || formData.concept_name.toLowerCase() === 'prestamos';

      if (isLoan) {
        const cap = parseFloat(formData.breakdown_capital) || 0;
        const int = parseFloat(formData.breakdown_interest) || 0;
        const chg = parseFloat(formData.breakdown_charges) || 0;
        const sumBd = Math.round((cap + int + chg) * 100) / 100;
        if (sumBd > 0 && Math.abs(sumBd - numAmount) > 0.05) {
          showNotification(
            \`El importe total (RD$ \${numAmount.toFixed(2)}) debe coincidir con la suma del desglose: Capital RD$ \${cap.toFixed(2)} + Interés RD$ \${int.toFixed(2)} + Cargos RD$ \${chg.toFixed(2)} = RD$ \${sumBd.toFixed(2)}.\`,
            'error'
          );
          return;
        }
      }

      const payload = {`;

code = code.replace(saveCheckOld, saveCheckNew);

// 4. Inserción de Banner de Activación en el JSX
const bannerOld = `{/* 1. Header principal */}
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '2.1rem', fontWeight: 900, color: '#09090b', margin: '0 0 0.25rem 0', letterSpacing: '-0.025em' }}>
          Egresos
        </h1>
        <p style={{ fontSize: '0.95rem', fontWeight: 600, color: '#475569', margin: '0 0 0.2rem 0' }}>
          Registro sencillo. Información organizada.
        </p>
        <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 500 }}>
          Boceto · Datos de ejemplo
        </span>
      </div>`;

const bannerNew = `{/* 1. Header principal */}
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '2.1rem', fontWeight: 900, color: '#09090b', margin: '0 0 0.25rem 0', letterSpacing: '-0.025em' }}>
          Egresos
        </h1>
        <p style={{ fontSize: '0.95rem', fontWeight: 600, color: '#475569', margin: '0 0 0.2rem 0' }}>
          Registro sencillo. Información organizada.
        </p>
        <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 500 }}>
          Boceto · Datos de ejemplo
        </span>
      </div>

      {/* Banner informativo de Activación en Base de Datos */}
      {migrationPending && (
        <div style={{
          background: '#fffbeb',
          border: '1px solid #fde68a',
          borderRadius: '12px',
          padding: '1.25rem 1.5rem',
          marginBottom: '1.75rem',
          boxShadow: '0 1px 4px rgba(217, 119, 6, 0.08)'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem' }}>
            <AlertTriangle size={24} color="#d97706" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.25rem' }}>
                <h4 style={{ margin: 0, color: '#92400e', fontWeight: 800, fontSize: '1.05rem', letterSpacing: '-0.01em' }}>
                  Módulo de Egresos: Activación requerida en Base de Datos MySQL
                </h4>
                <span style={{ background: '#fef3c7', color: '#b45309', border: '1px solid #fcd34d', fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: '12px', textTransform: 'uppercase' }}>
                  Pendiente
                </span>
              </div>
              <p style={{ margin: '0 0 0.65rem 0', color: '#b45309', fontSize: '0.9rem', lineHeight: 1.5 }}>
                Las tablas necesarias para registrar y consultar egresos no existen actualmente en la base de datos MySQL de producción. Por seguridad financiera, el registro está pausado hasta que se ejecute la migración oficial.
              </p>
              <div style={{ background: '#fef3c7', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #fcd34d', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <code style={{ fontSize: '0.85rem', color: '#78350f', fontFamily: 'Consolas, monospace', fontWeight: 600 }}>
                  mysql -u salon_admin -p u566429295_salon_v2 &lt; backend/migrations/20261103_create_expenses_tables.sql
                </code>
                <span style={{ fontSize: '0.78rem', color: '#92400e', fontWeight: 600 }}>
                  Archivo: 20261103_create_expenses_tables.sql
                </span>
              </div>
            </div>
          </div>
        </div>
      )}`;

code = code.replace(bannerOld, bannerNew);

fs.writeFileSync(filePath, code, 'utf8');
console.log('SUCCESS: ExpensesModule.jsx updated');

