import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus, Search, Calendar, Landmark, Filter, CheckCircle2, AlertCircle, FileText,
  ChevronDown, ChevronUp, MoreVertical, Trash2, Edit3, X, Check,
  AlertTriangle, Copy, ArrowRight, ShieldCheck, Eye, Paperclip,
  ArrowDownCircle, Building2, CreditCard, RefreshCw, Download, FileSpreadsheet
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useNotification } from '../../context/NotificationContext';

export default function ExpensesModule() {
  const { showNotification } = useNotification();
  const formRef = useRef(null);

  // Estados de carga y datos
  const [loading, setLoading] = useState(true);
  const [expenses, setExpenses] = useState([]);
  const [concepts, setConcepts] = useState([]);
  const [banks, setBanks] = useState([]);
  const [loans, setLoans] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [salons, setSalons] = useState([]);
  const [migrationPending, setMigrationPending] = useState(false);

  // Período y filtros (por defecto Octubre 2026 alineado con la línea base y datos del boceto)
  const [selectedYear, setSelectedYear] = useState('2026');
  const [selectedMonth, setSelectedMonth] = useState('10');
  const [filterSalon, setFilterSalon] = useState('all');
  const [filterConcept, setFilterConcept] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Menú contextual de acciones por fila
  const [openActionMenuId, setOpenActionMenuId] = useState(null);

  // Período activo YYYY-MM
  const currentPeriod = `${selectedYear}-${selectedMonth}`;

  // Formulario preconfigurado idéntico al boceto
  const initialFormState = {
    concept_name: 'Préstamos',
    payment_date: '2026-10-30',
    amount: '24000.00',
    payment_method: 'Transferencia',
    account_name: 'Cuenta operativa · 5678',
    salon_id: 1,
    salon_name: 'San Vicente',
    reference: 'TRX-00321',
    attachment_name: null,
    attachment_data: null,
    attachment_mime: null,
    observation: '',
    // Préstamos específicos
    bank_name: 'Banco Popular',
    loan_id: 1,
    loan_name: 'Local San Vicente',
    loan_ref: '001234',
    loan_period: 'Octubre 2026',
    // Desglose contable opcional
    breakdown_capital: '',
    breakdown_interest: '',
    breakdown_charges: ''
  };

  const [formData, setFormData] = useState(initialFormState);
  const [editingId, setEditingId] = useState(null);
  const [showMoreOptions, setShowMoreOptions] = useState(false);

  // Modales
  const [showAddConceptModal, setShowAddConceptModal] = useState(false);
  const [newConceptName, setNewConceptName] = useState('');
  const [newConceptDesc, setNewConceptDesc] = useState('');

  const [showAddBankModal, setShowAddBankModal] = useState(false);
  const [newBankName, setNewBankName] = useState('');
  const [newBankCode, setNewBankCode] = useState('');

  const [showAddLoanModal, setShowAddLoanModal] = useState(false);
  const [newLoanData, setNewLoanData] = useState({
    bank_name: '',
    loan_name: '',
    reference_number: '',
    salon_name: '',
    total_amount: ''
  });

  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [newAccountData, setNewAccountData] = useState({
    name: '',
    account_number: '',
    type: 'operative'
  });

  const [showVoidModal, setShowVoidModal] = useState(false);
  const [voidingExpense, setVoidingExpense] = useState(null);
  const [voidReason, setVoidReason] = useState('');

  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailExpense, setDetailExpense] = useState(null);

  const [showAttachmentModal, setShowAttachmentModal] = useState(false);
  const [attachmentData, setAttachmentData] = useState({ name: '', data: '', mime: '' });

  // Cerrar menú de acciones al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.action-menu-container')) {
        setOpenActionMenuId(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Meses disponibles
  const months = [
    { num: '01', name: 'Enero' },
    { num: '02', name: 'Febrero' },
    { num: '03', name: 'Marzo' },
    { num: '04', name: 'Abril' },
    { num: '05', name: 'Mayo' },
    { num: '06', name: 'Junio' },
    { num: '07', name: 'Julio' },
    { num: '08', name: 'Agosto' },
    { num: '09', name: 'Septiembre' },
    { num: '10', name: 'Octubre' },
    { num: '11', name: 'Noviembre' },
    { num: '12', name: 'Diciembre' }
  ];

  const currentMonthName = months.find(m => m.num === selectedMonth)?.name || 'Octubre';
  const periodLabel = `${currentMonthName} ${selectedYear}`;

  // Cargar datos iniciales
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
        name: s.name.replace(/^Abatte Peluquería\s+/i, '')
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
  };

  useEffect(() => {
    loadInitialCatalogs();
  }, []);

  useEffect(() => {
    fetchExpenses();
  }, [currentPeriod, filterSalon, filterConcept, searchTerm]);

  // Manejar cambio en préstamo cuando cambia banco
  const filteredLoansForSelectedBank = useMemo(() => {
    if (!formData.bank_name) return loans;
    return loans.filter(l => (l.bank_name || '').toLowerCase() === formData.bank_name.toLowerCase());
  }, [loans, formData.bank_name]);

  // Manejo de carga de archivos (recibo o comprobante)
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      showNotification('El archivo excede el tamaño máximo permitido (5MB).', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (uploadEvent) => {
      setFormData(prev => ({
        ...prev,
        attachment_name: file.name,
        attachment_data: uploadEvent.target.result,
        attachment_mime: file.type || 'application/pdf'
      }));
      showNotification(`Comprobante adjunto: ${file.name}`, 'success');
    };
    reader.readAsDataURL(file);
  };

  // Guardar egreso (Crear o Editar)
  const handleSaveExpense = async (stayInForm = false) => {
    try {
      if (!formData.concept_name) {
        showNotification('Seleccione un concepto para el egreso.', 'error');
        return;
      }
      if (!formData.payment_date) {
        showNotification('Indique la fecha de pago.', 'error');
        return;
      }
      const numAmount = parseFloat(String(formData.amount).replace(/[^0-9.]/g, ''));
      if (isNaN(numAmount) || numAmount <= 0) {
        showNotification('Ingrese un importe válido mayor a RD$ 0.00.', 'error');
        return;
      }

      if (migrationPending) {
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
            `El importe total (RD$ ${numAmount.toFixed(2)}) debe coincidir con la suma del desglose: Capital RD$ ${cap.toFixed(2)} + Interés RD$ ${int.toFixed(2)} + Cargos RD$ ${chg.toFixed(2)} = RD$ ${sumBd.toFixed(2)}.`,
            'error'
          );
          return;
        }
      }

      const payload = {
        ...formData,
        amount: numAmount,
        is_loan: isLoan ? 1 : 0,
        salon_name: formData.salon_name || (salons.find(s => String(s.id) === String(formData.salon_id))?.name || 'San Vicente')
      };

      if (editingId) {
        await dataService.updateExpense(editingId, payload);
        showNotification('Egreso actualizado correctamente.', 'success');
        setEditingId(null);
      } else {
        await dataService.createExpense(payload);
        showNotification('Egreso registrado exitosamente.', 'success');
      }

      await fetchExpenses();

      if (stayInForm) {
        setFormData({
          ...initialFormState,
          amount: '',
          reference: '',
          concept_name: formData.concept_name,
          payment_date: formData.payment_date,
          payment_method: formData.payment_method,
          account_name: formData.account_name,
          salon_id: formData.salon_id,
          salon_name: formData.salon_name,
          bank_name: formData.bank_name,
          loan_period: formData.loan_period
        });
      } else {
        setFormData(initialFormState);
        setEditingId(null);
      }
    } catch (err) {
      console.error('Error guardando egreso:', err);
      showNotification(err.message || 'Error al guardar egreso', 'error');
    }
  };

  // Cargar registro para edición
  const handleEditClick = (record) => {
    if (record.status === 'Anulado') {
      showNotification('No es posible editar un egreso anulado.', 'warning');
      return;
    }
    setOpenActionMenuId(null);
    setEditingId(record.id);
    setFormData({
      concept_name: record.concept_name || 'Otros',
      payment_date: record.payment_date ? record.payment_date.slice(0, 10) : new Date().toISOString().slice(0, 10),
      amount: String(record.amount || ''),
      payment_method: record.payment_method || 'Transferencia',
      account_name: record.account_name || 'Cuenta operativa · 5678',
      salon_id: record.salon_id || 1,
      salon_name: record.salon_name || 'San Vicente',
      reference: record.reference || '',
      attachment_name: record.attachment_name || null,
      attachment_data: record.attachment_data || null,
      attachment_mime: record.attachment_mime || null,
      observation: record.observation || '',
      bank_name: record.bank_name || 'Banco Popular',
      loan_id: record.loan_id || 1,
      loan_name: record.loan_name || '',
      loan_ref: record.loan_ref || '',
      loan_period: record.loan_period || periodLabel,
      breakdown_capital: record.breakdown_capital ? String(record.breakdown_capital) : '',
      breakdown_interest: record.breakdown_interest ? String(record.breakdown_interest) : '',
      breakdown_charges: record.breakdown_charges ? String(record.breakdown_charges) : ''
    });

    if (formRef.current) {
      formRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Cancelar edición
  const handleCancel = () => {
    setEditingId(null);
    setFormData(initialFormState);
  };

  // Confirmar anulación
  const handleConfirmVoid = async () => {
    if (!voidReason.trim()) {
      showNotification('Especifique el motivo de anulación.', 'error');
      return;
    }
    try {
      await dataService.voidExpense(voidingExpense.id, voidReason.trim());
      showNotification('Egreso anulado correctamente.', 'success');
      setShowVoidModal(false);
      setVoidingExpense(null);
      setVoidReason('');
      fetchExpenses();
    } catch (err) {
      console.error('Error anulando egreso:', err);
      showNotification(err.message || 'Error al anular egreso', 'error');
    }
  };

  // Crear concepto nuevo
  const handleCreateConcept = async () => {
    if (!newConceptName.trim()) {
      showNotification('Ingrese el nombre del concepto.', 'error');
      return;
    }
    try {
      const created = await dataService.createExpenseConcept({
        name: newConceptName.trim(),
        description: newConceptDesc.trim()
      });
      setConcepts(prev => [...prev, created]);
      setFormData(prev => ({ ...prev, concept_name: created.name }));
      setShowAddConceptModal(false);
      setNewConceptName('');
      setNewConceptDesc('');
      showNotification(`Concepto "${created.name}" agregado exitosamente.`, 'success');
    } catch (err) {
      showNotification(err.message || 'Error creando concepto', 'error');
    }
  };

  // Crear banco nuevo
  const handleCreateBank = async () => {
    if (!newBankName.trim()) {
      showNotification('Ingrese el nombre del banco.', 'error');
      return;
    }
    try {
      const created = await dataService.createExpenseBank({
        name: newBankName.trim(),
        code: newBankCode.trim()
      });
      setBanks(prev => [...prev, created]);
      setFormData(prev => ({ ...prev, bank_name: created.name }));
      setShowAddBankModal(false);
      setNewBankName('');
      setNewBankCode('');
      showNotification(`Banco "${created.name}" agregado exitosamente.`, 'success');
    } catch (err) {
      showNotification(err.message || 'Error creando banco', 'error');
    }
  };

  // Crear préstamo nuevo
  const handleCreateLoan = async () => {
    if (!newLoanData.bank_name || !newLoanData.loan_name || !newLoanData.reference_number) {
      showNotification('Banco, nombre y referencia son obligatorios.', 'error');
      return;
    }
    try {
      const created = await dataService.createExpenseLoan(newLoanData);
      setLoans(prev => [...prev, created]);
      setFormData(prev => ({
        ...prev,
        bank_name: created.bank_name,
        loan_id: created.id,
        loan_name: created.loan_name,
        loan_ref: created.reference_number
      }));
      setShowAddLoanModal(false);
      setNewLoanData({ bank_name: '', loan_name: '', reference_number: '', salon_name: '', total_amount: '' });
      showNotification(`Préstamo "${created.loan_name}" registrado exitosamente.`, 'success');
    } catch (err) {
      showNotification(err.message || 'Error registrando préstamo', 'error');
    }
  };

  // Crear cuenta nueva
  const handleCreateAccount = async () => {
    if (!newAccountData.name.trim()) {
      showNotification('Ingrese el nombre de la cuenta.', 'error');
      return;
    }
    try {
      const created = await dataService.createExpenseAccount(newAccountData);
      setAccounts(prev => [...prev, created]);
      setFormData(prev => ({ ...prev, account_name: created.name }));
      setShowAddAccountModal(false);
      setNewAccountData({ name: '', account_number: '', type: 'operative' });
      showNotification(`Cuenta "${created.name}" agregada exitosamente.`, 'success');
    } catch (err) {
      showNotification(err.message || 'Error creando cuenta', 'error');
    }
  };

  // Formateador de moneda
  const formatMoney = (val) => {
    const num = Number(val || 0);
    return `RD$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Formateador de fecha compacta (ej. 30 oct)
  const formatShortDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      const parts = dateStr.slice(0, 10).split('-');
      if (parts.length === 3) {
        const d = parts[2];
        const mIdx = parseInt(parts[1], 10) - 1;
        const shortMonths = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
        return `${parseInt(d, 10)} ${shortMonths[mIdx] || ''}`;
      }
      return dateStr;
    } catch (e) {
      return dateStr;
    }
  };

  // Cálculo de totales activos excluyendo los anulados
  const activeRecords = useMemo(() => {
    return expenses.filter(r => r.status !== 'Anulado');
  }, [expenses]);

  const totalRegisteredAmount = useMemo(() => {
    return activeRecords.reduce((acc, r) => acc + Number(r.amount || 0), 0);
  }, [activeRecords]);

  const isLoanSelected = formData.concept_name.toLowerCase() === 'préstamos' || formData.concept_name.toLowerCase() === 'prestamos';

  return (
    <div style={{ padding: '1.5rem 2rem 3rem 2rem', maxWidth: '1180px', margin: '0 auto', background: '#f8fafc', minHeight: '100vh', fontFamily: 'inherit' }}>

      {/* 1. Header principal */}
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '2.1rem', fontWeight: 900, color: '#09090b', margin: '0 0 0.25rem 0', letterSpacing: '-0.025em' }}>
          Egresos
        </h1>
        <p style={{ fontSize: '0.95rem', fontWeight: 600, color: '#475569', margin: '0 0 0.2rem 0' }}>
          Registro sencillo. Información organizada.
        </p>
        <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 500 }}>
          Boceto · Datos de ejemplo
        </span>
      </div>

      {/* 2. CARD TOP: Formulario «Nuevo egreso» */}
      <div ref={formRef} style={{
        background: '#ffffff',
        borderRadius: '20px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
        padding: '1.75rem',
        marginBottom: '2rem'
      }}>
        {/* Cabecera del formulario */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.55rem', fontWeight: 900, color: '#09090b', margin: 0, letterSpacing: '-0.02em' }}>
            {editingId ? 'Editar egreso' : 'Nuevo egreso'}
          </h2>
          <div style={{
            background: '#e0f2fe',
            color: '#0369a1',
            padding: '0.35rem 0.85rem',
            borderRadius: '10px',
            fontSize: '0.82rem',
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem'
          }}>
            <span>{periodLabel}</span>
          </div>
        </div>

        {/* Fila 1: Concepto y Fecha de pago */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.35rem' }}>
              Concepto
            </label>
            <div style={{ position: 'relative' }}>
              <select
                value={formData.concept_name}
                onChange={(e) => {
                  const val = e.target.value;
                  setFormData(prev => ({
                    ...prev,
                    concept_name: val
                  }));
                }}
                style={{
                  width: '100%',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  fontSize: '0.92rem',
                  fontWeight: 600,
                  color: '#0f172a',
                  outline: 'none',
                  appearance: 'none',
                  cursor: 'pointer'
                }}
              >
                {concepts.map(c => (
                  <option key={c.id || c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
              <ChevronDown size={16} style={{ position: 'absolute', right: '0.85rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#64748b' }} />
            </div>

            <div style={{ marginTop: '0.35rem' }}>
              <button
                type="button"
                onClick={() => setShowAddConceptModal(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: '#0284c7',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.2rem'
                }}
              >
                <Plus size={13} strokeWidth={2.5} /> Agregar concepto
              </button>
            </div>
            <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.25rem', lineHeight: '1.3' }}>
              Opciones: TSS · Anticipos de impuestos · INFOTEP · Residuos sólidos · Impuesto a los activos · Préstamos · Otros
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.35rem' }}>
              Fecha de pago
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="date"
                value={formData.payment_date}
                onChange={(e) => setFormData(prev => ({ ...prev, payment_date: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  fontSize: '0.92rem',
                  fontWeight: 600,
                  color: '#0f172a',
                  outline: 'none'
                }}
              />
            </div>
          </div>
        </div>

        {/* Bloque especial dinámico para Préstamos (Fondo celeste idéntico al boceto) */}
        {isLoanSelected && (
          <div style={{
            background: '#f0f7ff',
            border: '1px solid #bae6fd',
            borderRadius: '14px',
            padding: '1.25rem',
            marginBottom: '1.25rem'
          }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0369a1', margin: '0 0 1rem 0' }}>
              Datos del préstamo
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
              {/* Banco */}
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#0369a1', marginBottom: '0.3rem' }}>
                  Banco
                </label>
                <div style={{ position: 'relative' }}>
                  <select
                    value={formData.bank_name}
                    onChange={(e) => {
                      const selectedBank = e.target.value;
                      const relatedLoans = loans.filter(l => (l.bank_name || '').toLowerCase() === selectedBank.toLowerCase());
                      setFormData(prev => ({
                        ...prev,
                        bank_name: selectedBank,
                        loan_id: relatedLoans[0]?.id || 1,
                        loan_name: relatedLoans[0]?.loan_name || '',
                        loan_ref: relatedLoans[0]?.reference_number || ''
                      }));
                    }}
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.8rem',
                      borderRadius: '8px',
                      border: '1px solid #93c5fd',
                      background: '#ffffff',
                      fontSize: '0.9rem',
                      fontWeight: 600,
                      color: '#0f172a',
                      appearance: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {banks.map(b => (
                      <option key={b.id || b.name} value={b.name}>{b.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={15} style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#0284c7' }} />
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddBankModal(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    marginTop: '0.3rem',
                    color: '#0284c7',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.2rem'
                  }}
                >
                  <Plus size={12} strokeWidth={2.5} /> Agregar banco
                </button>
              </div>

              {/* Préstamo */}
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#0369a1', marginBottom: '0.3rem' }}>
                  Préstamo
                </label>
                <div style={{ position: 'relative' }}>
                  <select
                    value={formData.loan_id ? String(formData.loan_id) : (filteredLoansForSelectedBank[0]?.id || '')}
                    onChange={(e) => {
                      const selected = loans.find(l => String(l.id) === String(e.target.value));
                      if (selected) {
                        setFormData(prev => ({
                          ...prev,
                          loan_id: selected.id,
                          loan_name: selected.loan_name,
                          loan_ref: selected.reference_number,
                          salon_name: selected.salon_name || prev.salon_name
                        }));
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.8rem',
                      borderRadius: '8px',
                      border: '1px solid #93c5fd',
                      background: '#ffffff',
                      fontSize: '0.9rem',
                      fontWeight: 600,
                      color: '#0f172a',
                      appearance: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {filteredLoansForSelectedBank.length === 0 ? (
                      <option value="">Sin préstamos registrados en este banco</option>
                    ) : (
                      filteredLoansForSelectedBank.map(l => (
                        <option key={l.id} value={l.id}>
                          {l.loan_name} · {l.reference_number}
                        </option>
                      ))
                    )}
                  </select>
                  <ChevronDown size={15} style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#0284c7' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.3rem' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setNewLoanData(prev => ({ ...prev, bank_name: formData.bank_name }));
                      setShowAddLoanModal(true);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: '#0284c7',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.2rem'
                    }}
                  >
                    <Plus size={12} strokeWidth={2.5} /> Agregar préstamo
                  </button>
                </div>
                <div style={{ fontSize: '0.72rem', color: '#0284c7', opacity: 0.9, marginTop: '0.2rem' }}>
                  Selecciona entre los préstamos registrados de este banco.
                </div>
              </div>
            </div>

            {/* Fila 2: Período y Sucursal del Préstamo */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#0369a1', marginBottom: '0.3rem' }}>
                  Período
                </label>
                <div style={{ position: 'relative' }}>
                  <select
                    value={formData.loan_period || periodLabel}
                    onChange={(e) => setFormData(prev => ({ ...prev, loan_period: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.8rem',
                      borderRadius: '8px',
                      border: '1px solid #93c5fd',
                      background: '#ffffff',
                      fontSize: '0.9rem',
                      fontWeight: 600,
                      color: '#0f172a',
                      appearance: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {months.map(m => (
                      <option key={m.num} value={`${m.name} ${selectedYear}`}>{m.name} {selectedYear}</option>
                    ))}
                  </select>
                  <ChevronDown size={15} style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#0284c7' }} />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#0369a1', marginBottom: '0.3rem' }}>
                  Sucursal
                </label>
                <div style={{ position: 'relative' }}>
                  <select
                    value={formData.salon_name || 'San Vicente'}
                    onChange={(e) => {
                      const sel = salons.find(s => s.name === e.target.value);
                      setFormData(prev => ({
                        ...prev,
                        salon_id: sel ? sel.id : 1,
                        salon_name: e.target.value
                      }));
                    }}
                    style={{
                      width: '100%',
                      padding: '0.6rem 0.8rem',
                      borderRadius: '8px',
                      border: '1px solid #93c5fd',
                      background: '#ffffff',
                      fontSize: '0.9rem',
                      fontWeight: 600,
                      color: '#0f172a',
                      appearance: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {salons.map(s => (
                      <option key={s.id} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={15} style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#0284c7' }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Importe pagado / Cuota total pagada */}
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.35rem' }}>
            {isLoanSelected ? 'Cuota total pagada' : 'Importe pagado'}
          </label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontWeight: 700, fontSize: '0.92rem' }}>
              RD$
            </span>
            <input
              type="text"
              placeholder="0.00"
              value={formData.amount}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9.]/g, '');
                setFormData(prev => ({ ...prev, amount: val }));
              }}
              style={{
                width: '100%',
                padding: '0.65rem 0.85rem 0.65rem 3rem',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                fontSize: '1rem',
                fontWeight: 700,
                color: '#09090b',
                outline: 'none'
              }}
            />
          </div>
        </div>

        {/* Fila: Forma de pago y Cuenta de salida */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.35rem' }}>
              Forma de pago
            </label>
            <div style={{ position: 'relative' }}>
              <select
                value={formData.payment_method}
                onChange={(e) => setFormData(prev => ({ ...prev, payment_method: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  fontSize: '0.92rem',
                  fontWeight: 600,
                  color: '#0f172a',
                  outline: 'none',
                  appearance: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="Transferencia">Transferencia</option>
                <option value="Efectivo">Efectivo</option>
                <option value="Cheque">Cheque</option>
                <option value="Tarjeta">Tarjeta de Crédito / Débito</option>
                <option value="Otro">Otro</option>
              </select>
              <ChevronDown size={16} style={{ position: 'absolute', right: '0.85rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#64748b' }} />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.35rem' }}>
              Cuenta de salida
            </label>
            <div style={{ position: 'relative' }}>
              <select
                value={formData.account_name}
                onChange={(e) => setFormData(prev => ({ ...prev, account_name: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  fontSize: '0.92rem',
                  fontWeight: 600,
                  color: '#0f172a',
                  outline: 'none',
                  appearance: 'none',
                  cursor: 'pointer'
                }}
              >
                {accounts.map(a => (
                  <option key={a.id || a.name} value={a.name}>{a.name}</option>
                ))}
              </select>
              <ChevronDown size={16} style={{ position: 'absolute', right: '0.85rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#64748b' }} />
            </div>
          </div>
        </div>

        {/* Fila: Referencia y Soporte documental */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.35rem' }}>
              Referencia
            </label>
            <input
              type="text"
              placeholder="TRX-00321"
              value={formData.reference}
              onChange={(e) => setFormData(prev => ({ ...prev, reference: e.target.value }))}
              style={{
                width: '100%',
                padding: '0.65rem 0.85rem',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                fontSize: '0.92rem',
                fontWeight: 600,
                color: '#0f172a',
                outline: 'none'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.35rem' }}>
              Soporte <span style={{ fontWeight: 400, color: '#64748b' }}>(opcional)</span>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  padding: '0.65rem 1rem',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#475569',
                  fontSize: '0.88rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  width: '100%',
                  transition: 'background 0.2s'
                }}
              >
                <Paperclip size={16} style={{ color: '#0284c7' }} />
                <span>{formData.attachment_name ? formData.attachment_name : 'Adjuntar recibo'}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,application/pdf"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
              </label>

              {formData.attachment_name && (
                <button
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, attachment_name: null, attachment_data: null, attachment_mime: null }))}
                  title="Eliminar comprobante"
                  style={{
                    padding: '0.65rem',
                    borderRadius: '10px',
                    border: '1px solid #fee2e2',
                    background: '#fef2f2',
                    color: '#ef4444',
                    cursor: 'pointer'
                  }}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Sección expandible «+ Más opciones Observación» */}
        <div style={{ marginBottom: '1.5rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.85rem' }}>
          <button
            type="button"
            onClick={() => setShowMoreOptions(!showMoreOptions)}
            style={{
              background: 'none',
              border: 'none',
              padding: '0.25rem 0',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              color: '#475569',
              fontSize: '0.88rem',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            <div style={{
              background: '#f1f5f9',
              borderRadius: '50%',
              width: '22px',
              height: '22px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#334155'
            }}>
              {showMoreOptions ? <ChevronUp size={14} /> : <Plus size={14} />}
            </div>
            <span>Más opciones</span>
            <span style={{ fontSize: '0.78rem', fontWeight: 500, color: '#94a3b8' }}>Observación</span>
          </button>

          {showMoreOptions && (
            <div style={{ marginTop: '1rem', background: '#f8fafc', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '0.3rem' }}>
                  Observación / Nota interna
                </label>
                <textarea
                  rows={2}
                  value={formData.observation}
                  onChange={(e) => setFormData(prev => ({ ...prev, observation: e.target.value }))}
                  placeholder="Detalles adicionales sobre este pago o concepto..."
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.9rem',
                    outline: 'none',
                    resize: 'vertical'
                  }}
                />
              </div>

              {isLoanSelected && (
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#0369a1', marginBottom: '0.5rem' }}>
                    Desglose contable de la cuota (opcional)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>Abono a capital (RD$)</label>
                      <input
                        type="text"
                        placeholder="0.00"
                        value={formData.breakdown_capital}
                        onChange={(e) => setFormData(prev => ({ ...prev, breakdown_capital: e.target.value.replace(/[^0-9.]/g, '') }))}
                        style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.88rem' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>Intereses corrientes (RD$)</label>
                      <input
                        type="text"
                        placeholder="0.00"
                        value={formData.breakdown_interest}
                        onChange={(e) => setFormData(prev => ({ ...prev, breakdown_interest: e.target.value.replace(/[^0-9.]/g, '') }))}
                        style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.88rem' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>Comisiones / Cargos (RD$)</label>
                      <input
                        type="text"
                        placeholder="0.00"
                        value={formData.breakdown_charges}
                        onChange={(e) => setFormData(prev => ({ ...prev, breakdown_charges: e.target.value.replace(/[^0-9.]/g, '') }))}
                        style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.88rem' }}
                      />
                    </div>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.4rem' }}>
                    Diferencia contablemente el abono a capital del gasto financiero por intereses y comisiones.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Resumen inferior y botones de acción */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          borderTop: '1px solid #e2e8f0',
          paddingTop: '1.25rem'
        }}>
          <div>
            <span style={{ fontSize: '0.88rem', color: '#64748b', fontWeight: 600 }}>Total del egreso</span>
            <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#09090b', letterSpacing: '-0.02em' }}>
              {formatMoney(formData.amount)}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleCancel}
              style={{
                padding: '0.65rem 1.25rem',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#475569',
                fontSize: '0.9rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Cancelar
            </button>

            <button
              type="button"
              onClick={() => handleSaveExpense(false)}
              disabled={loading || migrationPending}
              title={migrationPending ? 'Módulo pendiente de activación en base de datos' : ''}
              style={{
                padding: '0.65rem 1.5rem',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                background: migrationPending ? '#f1f5f9' : '#ffffff',
                color: migrationPending ? '#94a3b8' : '#0f172a',
                fontSize: '0.9rem',
                fontWeight: 800,
                cursor: migrationPending ? 'not-allowed' : 'pointer'
              }}
            >
              {editingId ? 'Actualizar' : 'Guardar'}
            </button>

            {!editingId && (
              <button
                type="button"
                onClick={() => handleSaveExpense(true)}
                disabled={loading || migrationPending}
                title={migrationPending ? 'Módulo pendiente de activación en base de datos' : ''}
                style={{
                  padding: '0.65rem 1.5rem',
                  borderRadius: '10px',
                  border: 'none',
                  background: migrationPending ? '#94a3b8' : '#0284c7',
                  color: '#ffffff',
                  fontSize: '0.9rem',
                  fontWeight: 800,
                  cursor: migrationPending ? 'not-allowed' : 'pointer',
                  boxShadow: migrationPending ? 'none' : '0 2px 8px rgba(2, 132, 199, 0.25)'
                }}
              >
                Guardar y agregar otro
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 3. CARD BOTTOM: Listado «Egresos registrados» */}
      <div style={{
        background: '#ffffff',
        borderRadius: '20px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
        padding: '1.75rem'
      }}>
        {/* Cabecera del listado */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 style={{ fontSize: '1.55rem', fontWeight: 900, color: '#09090b', margin: 0, letterSpacing: '-0.02em' }}>
              Egresos registrados
            </h2>
          </div>

          <button
            type="button"
            onClick={() => {
              if (formRef.current) {
                formRef.current.scrollIntoView({ behavior: 'smooth' });
              }
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.55rem 1.15rem',
              borderRadius: '10px',
              border: 'none',
              background: '#0284c7',
              color: '#ffffff',
              fontSize: '0.88rem',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(2, 132, 199, 0.25)'
            }}
          >
            <Plus size={16} strokeWidth={2.5} />
            <span>Nuevo egreso</span>
          </button>
        </div>

        {/* Barra de filtros idéntica al boceto */}
        <div style={{
          display: 'flex',
          gap: '0.75rem',
          flexWrap: 'wrap',
          marginBottom: '1.25rem'
        }}>
          {/* Selector de Mes/Año */}
          <div style={{ position: 'relative', minWidth: '180px' }}>
            <select
              value={`${selectedYear}-${selectedMonth}`}
              onChange={(e) => {
                const [y, m] = e.target.value.split('-');
                setSelectedYear(y);
                setSelectedMonth(m);
              }}
              style={{
                width: '100%',
                padding: '0.6rem 0.85rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                fontSize: '0.88rem',
                fontWeight: 700,
                color: '#1e293b',
                appearance: 'none',
                cursor: 'pointer'
              }}
            >
              {months.map(m => (
                <option key={m.num} value={`${selectedYear}-${m.num}`}>
                  {m.name} {selectedYear}
                </option>
              ))}
            </select>
            <ChevronDown size={14} style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#64748b' }} />
          </div>

          {/* Buscador predictivo expandido */}
          <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
            <Search size={16} style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              type="text"
              placeholder="Buscar concepto, banco o préstamo"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 0.85rem 0.6rem 2.4rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                fontSize: '0.88rem',
                outline: 'none'
              }}
            />
            {searchTerm && (
              <X size={14} onClick={() => setSearchTerm('')} style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', cursor: 'pointer' }} />
            )}
          </div>
        </div>

        {/* Resumen de conteo y total registrado */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: '1rem',
          paddingBottom: '0.5rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <span style={{ fontSize: '1.35rem', fontWeight: 900, color: '#09090b' }}>
              {expenses.length}
            </span>
            <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#1e293b' }}>
              {expenses.length === 1 ? 'registro' : 'registros'}
            </span>
          </div>

          <div>
            <span style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: 600 }}>Total registrado: </span>
            <span style={{ fontSize: '1.45rem', fontWeight: 900, color: '#09090b', letterSpacing: '-0.02em' }}>
              {formatMoney(totalRegisteredAmount)}
            </span>
          </div>
        </div>

        {/* Tabla responsiva */}
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 800 }}>
                <th style={{ padding: '0.85rem 0.65rem' }}>Fecha</th>
                <th style={{ padding: '0.85rem 0.65rem' }}>Concepto</th>
                <th style={{ padding: '0.85rem 0.65rem' }}>Banco / Préstamo</th>
                <th style={{ padding: '0.85rem 0.65rem', textAlign: 'right' }}>Total</th>
                <th style={{ padding: '0.85rem 0.65rem', textAlign: 'center' }}>Soporte</th>
                <th style={{ padding: '0.85rem 0.65rem', textAlign: 'center', width: '48px' }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                    <RefreshCw size={22} className="animate-spin" style={{ margin: '0 auto 0.5rem auto' }} />
                    <div>Cargando egresos...</div>
                  </td>
                </tr>
              ) : expenses.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                    <FileText size={28} style={{ margin: '0 auto 0.5rem auto', opacity: 0.5 }} />
                    <div style={{ fontWeight: 600 }}>No hay egresos registrados para este período.</div>
                  </td>
                </tr>
              ) : (
                expenses.map((r) => {
                  const isVoided = r.status === 'Anulado';
                  return (
                    <tr
                      key={r.id}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        transition: 'background 0.15s',
                        background: isVoided ? 'rgba(254, 242, 242, 0.4)' : '#ffffff'
                      }}
                    >
                      {/* Fecha */}
                      <td style={{ padding: '0.85rem 0.65rem', fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>
                        {formatShortDate(r.payment_date)}
                      </td>

                      {/* Concepto */}
                      <td style={{ padding: '0.85rem 0.65rem', fontWeight: 600, color: '#0f172a' }}>
                        {r.concept_name}
                      </td>

                      {/* Banco / Préstamo */}
                      <td style={{ padding: '0.85rem 0.65rem' }}>
                        {r.loan_name ? (
                          <div>
                            <div style={{ fontWeight: 600, color: '#0f172a' }}>
                              {r.bank_name ? `${r.bank_name.replace('Banco ', '')} · ` : ''}{r.loan_name}
                            </div>
                            {r.loan_ref && (
                              <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                                {r.loan_ref}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </td>

                      {/* Total */}
                      <td style={{ padding: '0.85rem 0.65rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{
                          fontWeight: 700,
                          fontSize: '0.92rem',
                          color: isVoided ? '#94a3b8' : '#0f172a',
                          textDecoration: isVoided ? 'line-through' : 'none'
                        }}>
                          {formatMoney(r.amount)}
                        </div>
                        {isVoided && (
                          <span style={{
                            display: 'inline-block',
                            padding: '0.1rem 0.4rem',
                            borderRadius: '4px',
                            background: '#fee2e2',
                            color: '#b91c1c',
                            fontSize: '0.68rem',
                            fontWeight: 800
                          }}>
                            Anulado
                          </span>
                        )}
                      </td>

                      {/* Soporte */}
                      <td style={{ padding: '0.85rem 0.65rem', textAlign: 'center' }}>
                        {r.attachment_name ? (
                          <button
                            type="button"
                            onClick={() => {
                              setAttachmentData({
                                name: r.attachment_name,
                                data: r.attachment_data,
                                mime: r.attachment_mime
                              });
                              setShowAttachmentModal(true);
                            }}
                            title={`Ver comprobante (${r.attachment_name})`}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#64748b',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center'
                            }}
                          >
                            <Paperclip size={18} />
                          </button>
                        ) : (
                          <span style={{ color: '#cbd5e1' }}>—</span>
                        )}
                      </td>

                      {/* Acciones (3 puntos verticales) */}
                      <td style={{ padding: '0.85rem 0.65rem', textAlign: 'center', position: 'relative' }} className="action-menu-container">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenActionMenuId(openActionMenuId === r.id ? null : r.id);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#64748b',
                            cursor: 'pointer',
                            padding: '0.2rem'
                          }}
                        >
                          <MoreVertical size={18} />
                        </button>

                        {openActionMenuId === r.id && (
                          <div style={{
                            position: 'absolute',
                            right: '0.5rem',
                            top: '2.2rem',
                            background: '#ffffff',
                            borderRadius: '10px',
                            boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
                            border: '1px solid #e2e8f0',
                            zIndex: 50,
                            minWidth: '150px',
                            padding: '0.35rem 0',
                            textAlign: 'left'
                          }}>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenActionMenuId(null);
                                setDetailExpense(r);
                                setShowDetailModal(true);
                              }}
                              style={{
                                width: '100%',
                                padding: '0.5rem 0.85rem',
                                background: 'none',
                                border: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                fontSize: '0.82rem',
                                fontWeight: 600,
                                color: '#334155',
                                cursor: 'pointer'
                              }}
                            >
                              <Eye size={14} /> Ver detalle
                            </button>

                            {!isVoided && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleEditClick(r)}
                                  style={{
                                    width: '100%',
                                    padding: '0.5rem 0.85rem',
                                    background: 'none',
                                    border: 'none',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    fontSize: '0.82rem',
                                    fontWeight: 600,
                                    color: '#0284c7',
                                    cursor: 'pointer'
                                  }}
                                >
                                  <Edit3 size={14} /> Editar
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenActionMenuId(null);
                                    setVoidingExpense(r);
                                    setVoidReason('');
                                    setShowVoidModal(true);
                                  }}
                                  style={{
                                    width: '100%',
                                    padding: '0.5rem 0.85rem',
                                    background: 'none',
                                    border: 'none',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    fontSize: '0.82rem',
                                    fontWeight: 600,
                                    color: '#dc2626',
                                    cursor: 'pointer'
                                  }}
                                >
                                  <Trash2 size={14} /> Anular
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* =====================================================================
          MODAL: AGREGAR CONCEPTO
      ===================================================================== */}
      {showAddConceptModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            padding: '1.5rem',
            width: '100%',
            maxWidth: '440px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                Nuevo concepto de egreso
              </h3>
              <button
                type="button"
                onClick={() => setShowAddConceptModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.3rem' }}>
                Nombre del concepto
              </label>
              <input
                type="text"
                placeholder="Ej: Mantenimiento de aires, Publicidad digital..."
                value={newConceptName}
                onChange={(e) => setNewConceptName(e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
              />
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.3rem' }}>
                Descripción <span style={{ fontWeight: 400, color: '#64748b' }}>(opcional)</span>
              </label>
              <input
                type="text"
                placeholder="Finalidad del desembolso..."
                value={newConceptDesc}
                onChange={(e) => setNewConceptDesc(e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setShowAddConceptModal(false)}
                style={{ padding: '0.55rem 1rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#475569', fontWeight: 600, cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateConcept}
                style={{ padding: '0.55rem 1.25rem', borderRadius: '8px', border: 'none', background: '#0284c7', color: '#ffffff', fontWeight: 700, cursor: 'pointer' }}
              >
                Agregar concepto
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: AGREGAR BANCO
      ===================================================================== */}
      {showAddBankModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            padding: '1.5rem',
            width: '100%',
            maxWidth: '440px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                Nuevo banco
              </h3>
              <button
                type="button"
                onClick={() => setShowAddBankModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.3rem' }}>
                Nombre del banco
              </label>
              <input
                type="text"
                placeholder="Ej: Banco BDI, Scotiabank..."
                value={newBankName}
                onChange={(e) => setNewBankName(e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
              />
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.3rem' }}>
                Código o abreviatura <span style={{ fontWeight: 400, color: '#64748b' }}>(opcional)</span>
              </label>
              <input
                type="text"
                placeholder="Ej: BDI"
                value={newBankCode}
                onChange={(e) => setNewBankCode(e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setShowAddBankModal(false)}
                style={{ padding: '0.55rem 1rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#475569', fontWeight: 600, cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateBank}
                style={{ padding: '0.55rem 1.25rem', borderRadius: '8px', border: 'none', background: '#0284c7', color: '#ffffff', fontWeight: 700, cursor: 'pointer' }}
              >
                Guardar banco
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: AGREGAR PRÉSTAMO
      ===================================================================== */}
      {showAddLoanModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            padding: '1.5rem',
            width: '100%',
            maxWidth: '480px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                Registrar nuevo préstamo
              </h3>
              <button
                type="button"
                onClick={() => setShowAddLoanModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ marginBottom: '0.85rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.3rem' }}>
                Banco emisor
              </label>
              <select
                value={newLoanData.bank_name || banks[0]?.name || ''}
                onChange={(e) => setNewLoanData(prev => ({ ...prev, bank_name: e.target.value }))}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
              >
                {banks.map(b => (
                  <option key={b.id || b.name} value={b.name}>{b.name}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '0.85rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.3rem' }}>
                Nombre / Finalidad del préstamo
              </label>
              <input
                type="text"
                placeholder="Ej: Local San Vicente, Remodelación, Equipamiento..."
                value={newLoanData.loan_name}
                onChange={(e) => setNewLoanData(prev => ({ ...prev, loan_name: e.target.value }))}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.85rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.3rem' }}>
                  No. Referencia bancaria
                </label>
                <input
                  type="text"
                  placeholder="Ej: 001234"
                  value={newLoanData.reference_number}
                  onChange={(e) => setNewLoanData(prev => ({ ...prev, reference_number: e.target.value }))}
                  style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.3rem' }}>
                  Sucursal asociada
                </label>
                <select
                  value={newLoanData.salon_name || salons[0]?.name || ''}
                  onChange={(e) => setNewLoanData(prev => ({ ...prev, salon_name: e.target.value }))}
                  style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                >
                  {salons.map(s => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.3rem' }}>
                Monto original total contratado <span style={{ fontWeight: 400, color: '#64748b' }}>(opcional)</span>
              </label>
              <input
                type="text"
                placeholder="RD$ 0.00"
                value={newLoanData.total_amount}
                onChange={(e) => setNewLoanData(prev => ({ ...prev, total_amount: e.target.value.replace(/[^0-9.]/g, '') }))}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setShowAddLoanModal(false)}
                style={{ padding: '0.55rem 1rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#475569', fontWeight: 600, cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateLoan}
                style={{ padding: '0.55rem 1.25rem', borderRadius: '8px', border: 'none', background: '#0284c7', color: '#ffffff', fontWeight: 700, cursor: 'pointer' }}
              >
                Guardar préstamo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: ANULAR EGRESO
      ===================================================================== */}
      {showVoidModal && voidingExpense && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            padding: '1.5rem',
            width: '100%',
            maxWidth: '460px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: '#dc2626' }}>
              <AlertTriangle size={22} />
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#991b1b' }}>
                Anulación de egreso
              </h3>
            </div>

            <p style={{ fontSize: '0.88rem', color: '#475569', margin: '0 0 1rem 0', lineHeight: '1.4' }}>
              Está a punto de anular el egreso de <strong>{formatMoney(voidingExpense.amount)}</strong> correspondiente a <strong>{voidingExpense.concept_name}</strong>.
              El importe se restará de los totales acumulados pero se conservará en el historial contable por auditoría.
            </p>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.3rem' }}>
                Motivo de anulación <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <textarea
                rows={3}
                placeholder="Indique la justificación (ej. Pago duplicado por error, reverso bancario, error de captura)..."
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.88rem', outline: 'none' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => {
                  setShowVoidModal(false);
                  setVoidingExpense(null);
                  setVoidReason('');
                }}
                style={{ padding: '0.55rem 1rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#475569', fontWeight: 600, cursor: 'pointer' }}
              >
                Regresar
              </button>
              <button
                type="button"
                onClick={handleConfirmVoid}
                style={{ padding: '0.55rem 1.25rem', borderRadius: '8px', border: 'none', background: '#dc2626', color: '#ffffff', fontWeight: 700, cursor: 'pointer' }}
              >
                Confirmar anulación
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: DETALLES DE EGRESO
      ===================================================================== */}
      {showDetailModal && detailExpense && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            padding: '1.75rem',
            width: '100%',
            maxWidth: '520px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <span style={{
                  display: 'inline-block',
                  padding: '0.2rem 0.55rem',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  background: detailExpense.status === 'Anulado' ? '#fee2e2' : '#e0f2fe',
                  color: detailExpense.status === 'Anulado' ? '#b91c1c' : '#0369a1',
                  marginBottom: '0.25rem'
                }}>
                  {detailExpense.status || 'Completado'}
                </span>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900, color: '#0f172a' }}>
                  {detailExpense.concept_name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowDetailModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
              <div>
                <span style={{ color: '#64748b', fontSize: '0.78rem' }}>Monto total</span>
                <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#09090b' }}>
                  {formatMoney(detailExpense.amount)}
                </div>
              </div>
              <div>
                <span style={{ color: '#64748b', fontSize: '0.78rem' }}>Fecha de pago</span>
                <div style={{ fontWeight: 700, color: '#0f172a' }}>
                  {detailExpense.payment_date}
                </div>
              </div>
              <div>
                <span style={{ color: '#64748b', fontSize: '0.78rem' }}>Forma de pago</span>
                <div style={{ fontWeight: 600, color: '#334155' }}>
                  {detailExpense.payment_method}
                </div>
              </div>
              <div>
                <span style={{ color: '#64748b', fontSize: '0.78rem' }}>Cuenta de salida</span>
                <div style={{ fontWeight: 600, color: '#334155' }}>
                  {detailExpense.account_name || 'Cuenta operativa'}
                </div>
              </div>
              <div>
                <span style={{ color: '#64748b', fontSize: '0.78rem' }}>Sucursal</span>
                <div style={{ fontWeight: 600, color: '#334155' }}>
                  {detailExpense.salon_name || 'San Vicente'}
                </div>
              </div>
              <div>
                <span style={{ color: '#64748b', fontSize: '0.78rem' }}>Referencia</span>
                <div style={{ fontWeight: 600, color: '#334155' }}>
                  {detailExpense.reference || '—'}
                </div>
              </div>
            </div>

            {/* Préstamo detalle */}
            {detailExpense.loan_name && (
              <div style={{ background: '#f0f7ff', border: '1px solid #bae6fd', borderRadius: '10px', padding: '0.85rem', marginBottom: '1rem', fontSize: '0.82rem' }}>
                <div style={{ fontWeight: 800, color: '#0369a1', marginBottom: '0.35rem' }}>
                  Información bancaria del préstamo
                </div>
                <div><strong>Banco:</strong> {detailExpense.bank_name || 'Banco Popular'}</div>
                <div><strong>Préstamo:</strong> {detailExpense.loan_name} (Ref: {detailExpense.loan_ref || '—'})</div>
                {detailExpense.loan_period && <div><strong>Período:</strong> {detailExpense.loan_period}</div>}

                {(detailExpense.breakdown_capital || detailExpense.breakdown_interest || detailExpense.breakdown_charges) && (
                  <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px dashed #bae6fd', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                    <div>
                      <span style={{ color: '#64748b', fontSize: '0.7rem' }}>Capital:</span>
                      <div style={{ fontWeight: 700 }}>{formatMoney(detailExpense.breakdown_capital)}</div>
                    </div>
                    <div>
                      <span style={{ color: '#64748b', fontSize: '0.7rem' }}>Intereses:</span>
                      <div style={{ fontWeight: 700 }}>{formatMoney(detailExpense.breakdown_interest)}</div>
                    </div>
                    <div>
                      <span style={{ color: '#64748b', fontSize: '0.7rem' }}>Cargos:</span>
                      <div style={{ fontWeight: 700 }}>{formatMoney(detailExpense.breakdown_charges)}</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {detailExpense.observation && (
              <div style={{ marginBottom: '1rem', background: '#f8fafc', padding: '0.75rem', borderRadius: '8px', fontSize: '0.82rem', color: '#475569' }}>
                <strong>Observación:</strong> {detailExpense.observation}
              </div>
            )}

            {detailExpense.status === 'Anulado' && (
              <div style={{ marginBottom: '1rem', background: '#fef2f2', border: '1px solid #fee2e2', padding: '0.75rem', borderRadius: '8px', fontSize: '0.82rem', color: '#991b1b' }}>
                <div><strong>Anulado por:</strong> {detailExpense.voided_by || 'Administrador'}</div>
                <div><strong>Motivo:</strong> {detailExpense.void_reason || 'Sin motivo especificado'}</div>
                {detailExpense.voided_at && <div><strong>Fecha de anulación:</strong> {detailExpense.voided_at}</div>}
              </div>
            )}

            {detailExpense.attachment_name && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0.75rem', background: '#eff6ff', borderRadius: '8px', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#1d4ed8' }}>
                  <Paperclip size={16} />
                  <span>{detailExpense.attachment_name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAttachmentData({
                      name: detailExpense.attachment_name,
                      data: detailExpense.attachment_data,
                      mime: detailExpense.attachment_mime
                    });
                    setShowAttachmentModal(true);
                  }}
                  style={{ background: '#2563eb', border: 'none', color: '#fff', padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  Ver comprobante
                </button>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowDetailModal(false)}
                style={{ padding: '0.55rem 1.25rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#475569', fontWeight: 700, cursor: 'pointer' }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: VISUALIZAR COMPROBANTE ADJUNTO
      ===================================================================== */}
      {showAttachmentModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1100,
          padding: '1.5rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            padding: '1.5rem',
            width: '100%',
            maxWidth: '640px',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Paperclip size={18} style={{ color: '#0284c7' }} />
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>
                  {attachmentData.name || 'Comprobante de egreso'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAttachmentModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ flex: 1, minHeight: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: '10px', overflow: 'hidden' }}>
              {attachmentData.data && attachmentData.data.startsWith('data:image') ? (
                <img
                  src={attachmentData.data}
                  alt={attachmentData.name}
                  style={{ maxWidth: '100%', maxHeight: '55vh', objectFit: 'contain' }}
                />
              ) : attachmentData.data && attachmentData.data.startsWith('data:application/pdf') ? (
                <iframe
                  src={attachmentData.data}
                  title={attachmentData.name}
                  style={{ width: '100%', height: '55vh', border: 'none' }}
                />
              ) : (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                  <FileText size={48} style={{ margin: '0 auto 1rem auto', color: '#0284c7' }} />
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a' }}>
                    {attachmentData.name}
                  </div>
                  <div style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
                    Comprobante digital registrado en el sistema
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem' }}>
              {attachmentData.data ? (
                <a
                  href={attachmentData.data}
                  download={attachmentData.name || 'comprobante_egreso'}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    padding: '0.55rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#0284c7',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    textDecoration: 'none'
                  }}
                >
                  <Download size={15} /> Descargar archivo
                </a>
              ) : <div />}

              <button
                type="button"
                onClick={() => setShowAttachmentModal(false)}
                style={{ padding: '0.55rem 1.25rem', borderRadius: '8px', border: 'none', background: '#0284c7', color: '#ffffff', fontWeight: 700, cursor: 'pointer' }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
