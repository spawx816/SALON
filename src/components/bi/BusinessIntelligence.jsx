import React, { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp, Users, CreditCard, UserCheck, Filter, Download,
  Printer, ChevronDown, Calendar, MapPin, AlertCircle, Info, Sparkles, Check, RefreshCw,
  Wallet, Percent, BarChart3, Home, Building2, Share2, Shield
} from 'lucide-react';
import {
  BI_CATEGORIES,
  BI_REPORTS_BY_CATEGORY,
  PERIOD_OPTIONS,
  FUTURE_PERIOD_OPTIONS,
  CANCELLATION_REASONS,
  getDateRangeForPeriod
} from './biConfig';
import { BIKpiCards } from './BIKpiCards';
import { BIChart } from './BIChart';
import { BIDetailTable } from './BIDetailTable';
import { exportReportToExcel, exportReportToCSV, triggerPrintReport } from './biExport';
import { dataService } from '../../utils/dataService';
import { useSearchParams } from 'react-router-dom';
import ServiceAnalytics from '../admin/ServiceAnalytics';

export const BusinessIntelligence = ({ standalone = true }) => {
  const [searchParams] = useSearchParams();
  const urlCategory = searchParams ? searchParams.get('category') : null;
  const urlReport = searchParams ? searchParams.get('report') : null;
  const urlPeriod = searchParams ? searchParams.get('period') : null;
  const urlStart = searchParams ? searchParams.get('start') : null;
  const urlEnd = searchParams ? searchParams.get('end') : null;
  const urlSalon = searchParams ? searchParams.get('salon') : null;

  const initialCategory = urlCategory || 'sales';
  const initialReportId = urlReport || 'sales_summary';
  const initialPeriod = urlPeriod || (initialReportId === 'contracts_upcoming_renewal' ? 'next_365_days' : 'this_month');
  const initialDates = getDateRangeForPeriod(initialPeriod) || {
    startDate: new Date(new Date().setDate(1)).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  };

  // 1. Navigation & State
  const [activeCategory, setActiveCategory] = useState(initialCategory);
  const [selectedReportId, setSelectedReportId] = useState(initialReportId);
  const [viewMode, setViewMode] = useState('executive');
  const [salons, setSalons] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [reportError, setReportError] = useState(null);

  // 2. Filter states
  const [period, setPeriod] = useState(initialPeriod);
  const [startDate, setStartDate] = useState(urlStart || initialDates.startDate);
  const [endDate, setEndDate] = useState(urlEnd || initialDates.endDate);
  const [selectedSalon, setSelectedSalon] = useState(urlSalon || 'all');
  const [selectedPlan, setSelectedPlan] = useState('all');

  // Dynamic contextual filters
  const [selectedMembership, setSelectedMembership] = useState('all');
  const [daysInactive, setDaysInactive] = useState(15);
  const [cancellationReason, setCancellationReason] = useState('Todos los motivos');
  const [selectedEmployee, setSelectedEmployee] = useState('all');

  // Chart interactivity states
  const [interactiveSelectedGroup, setInteractiveSelectedGroup] = useState('0_visits');
  const [timeGrain, setTimeGrain] = useState('daily');
  const [showExportMenu, setShowExportMenu] = useState(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('open_export') === '1';
    }
    return false;
  });
  const [tableFilteredRows, setTableFilteredRows] = useState(null);
  const urlSample = searchParams ? (searchParams.get('sample') === '1' || searchParams.get('demo') === '1') : false;
  const [useSampleData, setUseSampleData] = useState(urlSample);

  // Maqueta exacta con 100 cuotas demostrativas homologadas con el diseño institucional
  const SAMPLE_RECURRING_DATA = useMemo(() => ({
    title: 'Efectividad de cobros y recuperación',
    subtitle: 'Cuotas con primer intento en el período · Corte: 30 oct 2026',
    baseText: 'Base: 100 cuotas únicas · RD$195,000',
    kpis: [
      {
        label: 'Éxito al primer intento',
        value: '70%',
        subtext: '70 de 100 cuotas',
        icon: 'credit_card',
        color: 'green'
      },
      {
        label: 'Recuperación tras rechazo',
        value: '60%',
        subtext: '18 de 30 cuotas · RD$35,100',
        icon: 'refresh',
        color: 'blue'
      },
      {
        label: 'Pendiente de recuperar',
        value: 'RD$ 23,400',
        subtext: '12 cuotas',
        icon: 'file_alert',
        color: 'rose'
      },
      {
        label: 'Tiempo medio de recuperación',
        value: '2.4 días',
        subtext: 'Sobre 18 cuotas recuperadas',
        icon: 'clock',
        color: 'purple'
      }
    ],
    chart: {
      type: 'recovery_cohort_charts',
      quota_results: {
        total_obligations: 100,
        categories: [
          { label: 'Primer intento', count: 70, percentage: 70, color: '#10b981' },
          { label: 'Tras reintentos', count: 15, percentage: 15, color: '#3b82f6' },
          { label: 'Pago por otra vía', count: 3, percentage: 3, color: '#a855f7' },
          { label: 'Sin recuperar', count: 12, percentage: 12, color: '#f87171' }
        ]
      },
      monthly_evolution: [
        { month: '2026-07', label: 'Jul', total_obligations: 100, paid_first: 80, percentage: 80 },
        { month: '2026-08', label: 'Ago', total_obligations: 100, paid_first: 77, percentage: 77 },
        { month: '2026-09', label: 'Sep', total_obligations: 100, paid_first: 74, percentage: 74 },
        { month: '2026-10', label: 'Oct*', total_obligations: 100, paid_first: 70, percentage: 70 }
      ],
      decline_causes: [
        { category: 'Fondos insuficientes', count: 18, percentage: 60, amount: 35100, color: '#f87171' },
        { category: 'Tarjeta vencida', count: 6, percentage: 20, amount: 11700, color: '#f87171' },
        { category: 'Otros rechazos', count: 6, percentage: 20, amount: 11700, color: '#f87171' }
      ],
      retry_effectiveness: [
        { label: 'Segundo intento', count: 10, percentage: 66.7, amount: 19500, color: '#0284c7' },
        { label: 'Tercer intento o posterior', count: 5, percentage: 33.3, amount: 9750, color: '#0284c7' }
      ],
      recovered_auto_amt: 29250,
      recovered_manual_amt: 5850,
      total_recovered: 18
    }
  }), []);

  const isRecurringReport = selectedReportId === 'recurring_charges_result' || selectedReportId === 'declined_charges_recovery';

  // Datos efectivos combinando datos reales de BD o dataset de muestra según selección
  const effectiveReportData = useMemo(() => {
    if (useSampleData && isRecurringReport) {
      return {
        ...(reportData || {}),
        ...SAMPLE_RECURRING_DATA,
        chart: {
          ...(reportData?.chart || {}),
          ...SAMPLE_RECURRING_DATA.chart
        }
      };
    }
    return reportData;
  }, [useSampleData, isRecurringReport, reportData, SAMPLE_RECURRING_DATA]);

  // Reports available in active category (evita duplicados en el selector si es un alias ejecutivo)
  const availableReports = useMemo(() => {
    const list = BI_REPORTS_BY_CATEGORY[activeCategory] || [];
    return list.filter(r => !r.isCatalogAlias || r.id === selectedReportId);
  }, [activeCategory, selectedReportId]);

  // Current active report config
  const currentReportConfig = useMemo(() => {
    const all = BI_REPORTS_BY_CATEGORY[activeCategory] || [];
    return all.find(r => r.id === selectedReportId) || availableReports[0] || {};
  }, [activeCategory, selectedReportId, availableReports]);

  // Handle report change with synchronized period and date range updates
  const handleReportChange = (newReportId) => {
    setSelectedReportId(newReportId);
    setInteractiveSelectedGroup('0_visits');
    setTableFilteredRows(null);

    if (newReportId === 'contracts_upcoming_renewal') {
      const nextP = 'next_365_days';
      setPeriod(nextP);
      const range = getDateRangeForPeriod(nextP);
      if (range) {
        setStartDate(range.startDate);
        setEndDate(range.endDate);
      }
    } else if (['next_30_days', 'next_60_days', 'next_90_days', 'next_365_days'].includes(period)) {
      const nextP = 'this_month';
      setPeriod(nextP);
      const range = getDateRangeForPeriod(nextP);
      if (range) {
        setStartDate(range.startDate);
        setEndDate(range.endDate);
      }
    }
  };

  // Handle period change with synchronized date range updates
  const handlePeriodChange = (newPeriod) => {
    setPeriod(newPeriod);
    if (newPeriod !== 'custom') {
      const range = getDateRangeForPeriod(newPeriod);
      if (range) {
        setStartDate(range.startDate);
        setEndDate(range.endDate);
      }
    }
  };

  // On category change, auto-select first report of that category
  const handleCategoryChange = (categoryId) => {
    setActiveCategory(categoryId);
    const firstReport = BI_REPORTS_BY_CATEGORY[categoryId]?.[0];
    if (firstReport) {
      handleReportChange(firstReport.id);
    }
  };

  // Load initial salons, employees, and plans
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const [salonsList, staffList, plansList] = await Promise.all([
          dataService.getSalons ? dataService.getSalons() : [],
          dataService.getStaff ? dataService.getStaff() : [],
          dataService.getPlans ? dataService.getPlans() : []
        ]);
        setSalons(salonsList || []);
        setEmployees(staffList || []);
        setPlans(plansList || []);
      } catch (err) {
        console.warn('Error loading metadata for BI:', err);
      }
    };
    fetchMetadata();
  }, []);

  // Synchronize date ranges when period changes
  useEffect(() => {
    if (period !== 'custom') {
      const range = getDateRangeForPeriod(period);
      if (range && (range.startDate !== startDate || range.endDate !== endDate)) {
        setStartDate(range.startDate);
        setEndDate(range.endDate);
      }
    }
  }, [period]);

  // Load Report Data
  const loadReport = async () => {
    setLoading(true);
    setReportError(null);
    try {
      const params = {
        category: activeCategory,
        reportId: selectedReportId,
        period,
        startDate,
        endDate,
        salonId: selectedSalon,
        planId: selectedPlan,
        membership: selectedPlan !== 'all' ? selectedPlan : selectedMembership,
        daysInactive,
        reason: cancellationReason,
        employeeId: selectedEmployee,
        timeGrain,
        sample: useSampleData ? '1' : '0'
      };

      let res = null;
      let callError = null;
      try {
        if (dataService && typeof dataService.getBIReport === 'function') {
          res = await dataService.getBIReport(params);
        }
      } catch (callErr) {
        callError = callErr;
        console.warn('dataService.getBIReport caught error:', callErr);
      }

      if (res && Array.isArray(res.kpis)) {
        setReportData(res);
        setReportError(null);
      } else if (['contracts_upcoming_renewal', 'recurring_charges_result', 'declined_charges_recovery', 'cash_flow'].includes(selectedReportId) && !useSampleData) {
        // En producción: cero datos simulados.
        // Si no se reciben KPIs válidos desde el backend, reflejar error formal y no fallback a mock.
        setReportError(callError?.message || 'No se pudo obtener la información desde el servidor.');
        setReportData(null);
      } else {
        // Fallback generator adhering strictly to developer specs and mockups
        generateMockReport(params);
      }
    } catch (err) {
      console.error('Error fetching BI report:', err);
      if (['contracts_upcoming_renewal', 'recurring_charges_result', 'declined_charges_recovery', 'cash_flow'].includes(selectedReportId) && !useSampleData) {
        setReportError(err?.message || 'Error de conexión al cargar el reporte desde el servidor.');
        setReportData(null);
      } else {
        generateMockReport({ category: activeCategory, reportId: selectedReportId });
      }
    } finally {
      setLoading(false);
    }
  };

  // Generate realistic data based on mockups & docs if API endpoint is loading or in development
  const generateMockReport = (params) => {
    // 0. Flujo de efectivo (Productividad y rentabilidad - Mockup Corporativo)
    if (selectedReportId === 'cash_flow') {
      setReportData({
        title: 'Flujo de efectivo',
        categoryName: 'Productividad y rentabilidad',
        periodText: `${startDate} al ${endDate}`,
        is_sample: true,
        total_cobrado: 1000000,
        total_pagado: 750000,
        excedente_periodo: 250000,
        excedente_pct: 25.0,
        retencion_desc: 'Por cada RD$100 cobrados, te quedan RD$25.',
        delta_vs_anterior: '+3 puntos porcentuales',
        delta_subtext: 'vs. período anterior',
        kpis: [
          { label: 'Total cobrado', value: 'RD$ 1,000,000', icon: 'credit_card', color: 'blue' },
          { label: 'Total pagado', value: 'RD$ 750,000', icon: 'wallet', color: 'purple' },
          { label: 'Excedente del período', value: 'RD$ 250,000', icon: 'trending', color: 'indigo' },
          { label: 'Excedente sobre lo cobrado', value: '25%', icon: 'percent', color: 'emerald' }
        ],
        concepts_breakdown: [
          { concept: 'Nómina', amount: 300000, percentage: 40.0, bar_pct: 40.0 },
          { concept: 'Mercancías e insumos', amount: 150000, percentage: 20.0, bar_pct: 20.0 },
          { concept: 'Alquileres', amount: 100000, percentage: 13.3, bar_pct: 13.3 },
          { concept: 'Préstamos', amount: 80000, percentage: 10.7, bar_pct: 10.7 },
          { concept: 'TSS', amount: 60000, percentage: 8.0, bar_pct: 8.0 },
          { concept: 'Energía eléctrica', amount: 40000, percentage: 5.3, bar_pct: 5.3 },
          { concept: 'Otros pagos', amount: 20000, percentage: 2.7, bar_pct: 2.7 }
        ],
        badges: [
          { text: 'Sin duplicar pagos', icon: 'ShieldCheck' },
          { text: 'Nómina pagada del período', icon: 'Check' }
        ],
        sources_text: 'Fuentes: Cobros · Egresos · 606 pagado · Plantilla de nómina',
        footnote: 'El excedente corresponde a cobros menos pagos del período. No equivale a utilidad contable ni al saldo bancario.'
      });
      return;
    }

    // 1. Resumen de ventas y cobros (Mockup 1)
    if (selectedReportId === 'sales_summary') {
      setReportData({
        title: 'Resumen de ventas y cobros',
        periodText: `${startDate} al ${endDate}`,
        kpis: [
          { label: 'Facturación', value: 'RD$ 450,000', subtext: 'Ventas del período', icon: 'trending', color: 'emerald' },
          { label: 'Total cobrado', value: 'RD$ 425,000', subtext: 'Pagos recibidos en el período', icon: 'dollar', color: 'blue' },
          { label: 'Cantidad de facturas', value: '300', subtext: 'Facturas válidas', icon: 'receipt', color: 'purple' },
          { label: 'Ticket promedio', value: 'RD$ 1,500', subtext: 'Por factura', icon: 'tag', color: 'amber' }
        ],
        chart: {
          type: 'sales_evolution',
          data: timeGrain === 'weekly' ? [
            { label: 'Sem 40', total: 162390 },
            { label: 'Sem 41', total: 258340 },
            { label: 'Sem 42', total: 379052 },
            { label: 'Sem 43', total: 381960 },
            { label: 'Sem 44', total: 303510 }
          ] : timeGrain === 'monthly' ? [
            { label: 'Ago 2026', total: 1100000 },
            { label: 'Sep 2026', total: 1250000 },
            { label: 'Oct 2026', total: 1485000 }
          ] : timeGrain === 'yearly' ? [
            { label: '2024', total: 9800000 },
            { label: '2025', total: 12400000 },
            { label: '2026', total: 14800000 }
          ] : [
            { label: '1 oct', total: 25000 },
            { label: '2 oct', total: 34000 },
            { label: '3 oct', total: 41000 },
            { label: '4 oct', total: 38000 },
            { label: '5 oct', total: 48000 },
            { label: '6 oct', total: 47000 },
            { label: '7 oct', total: 54000 },
            { label: '8 oct', total: 63000 },
            { label: '9 oct', total: 58000 },
            { label: '10 oct', total: 46000 },
            { label: '11 oct', total: 51000 },
            { label: '12 oct', total: 60000 }
          ]
        },
        table: {
          title: 'Detalle de ventas',
          badgeText: '24 registros',
          columns: [
            { key: 'fecha', label: 'Fecha' },
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'facturas', label: 'Facturas', align: 'center' },
            { key: 'facturacion', label: 'Facturación', isCurrency: true },
            { key: 'cobrado', label: 'Total cobrado', isCurrency: true }
          ],
          rows: [
            { fecha: '12 oct 2026', sucursal: 'San Vicente', facturas: 28, facturacion: 42000, cobrado: 40000 },
            { fecha: '12 oct 2026', sucursal: 'Villa Mella', facturas: 22, facturacion: 33000, cobrado: 33000 },
            { fecha: '11 oct 2026', sucursal: 'San Vicente', facturas: 30, facturacion: 45000, cobrado: 42000 },
            { fecha: '11 oct 2026', sucursal: 'Villa Mella', facturas: 19, facturacion: 28500, cobrado: 28500 },
            { fecha: '10 oct 2026', sucursal: 'San Vicente', facturas: 25, facturacion: 37500, cobrado: 35000 },
            { fecha: '10 oct 2026', sucursal: 'Villa Mella', facturas: 18, facturacion: 27000, cobrado: 26000 }
          ],
          footerNote: 'Facturación y cobros corresponden a conceptos distintos. Excluye facturas anuladas.'
        }
      });
      return;
    }

    // 2. Frecuencia de visitas (Mockup 2)
    if (selectedReportId === 'visit_frequency') {
      const frequencyBins = [
        { key: '0_visits', label: '0 visitas', count: 12, percentage: 20 },
        { key: '1_visits', label: '1 visita', count: 18, percentage: 30 },
        { key: '2_visits', label: '2 visitas', count: 14, percentage: 23.3 },
        { key: '3_visits', label: '3 visitas', count: 9, percentage: 15 },
        { key: '4_visits', label: '4 visitas', count: 5, percentage: 8.3 },
        { key: '5_plus_visits', label: '5 o más', count: 2, percentage: 3.3 }
      ];

      // Dynamic rows based on selected bar
      const clientRowsByBin = {
        '0_visits': [
          { cliente: 'Laura Pérez', membresia: 'Plan Beauty', visitas: 0, ultimo_lavado: '25 sept 2026', sucursal: 'San Vicente', telefono: '8095551234' },
          { cliente: 'María Gómez', membresia: 'Plan Beauty', visitas: 0, ultimo_lavado: '18 sept 2026', sucursal: 'Villa Mella', telefono: '8095552345' },
          { cliente: 'Ana Martínez', membresia: 'Plan Beauty', visitas: 0, ultimo_lavado: 'Sin registro', sucursal: 'San Vicente', telefono: '8095553456' },
          { cliente: 'Carmen Rosario', membresia: 'Plan Beauty', visitas: 0, ultimo_lavado: '20 sept 2026', sucursal: 'San Vicente', telefono: '8095554567' },
          { cliente: 'Yomaira Batista', membresia: 'Plan Beauty', visitas: 0, ultimo_lavado: '12 sept 2026', sucursal: 'Villa Mella', telefono: '8095555678' }
        ],
        '1_visits': [
          { cliente: 'Patricia Reyes', membresia: 'Plan Beauty', visitas: 1, ultimo_lavado: '5 oct 2026', sucursal: 'San Vicente', telefono: '8095556789' },
          { cliente: 'Altagracia Soto', membresia: 'Plan Beauty', visitas: 1, ultimo_lavado: '8 oct 2026', sucursal: 'Villa Mella', telefono: '8095557890' },
          { cliente: 'Griselda Méndez', membresia: 'Plan Beauty', visitas: 1, ultimo_lavado: '10 oct 2026', sucursal: 'San Vicente', telefono: '8095558901' }
        ]
      };

      const selectedBin = frequencyBins.find(b => b.key === interactiveSelectedGroup || b.label === interactiveSelectedGroup) || frequencyBins[0];
      const activeRows = clientRowsByBin[selectedBin.key] || [
        { cliente: 'Socia Registrada', membresia: 'Plan Beauty', visitas: selectedBin.label, ultimo_lavado: '3 oct 2026', sucursal: 'San Vicente', telefono: '8095559999' }
      ];

      setReportData({
        title: 'Frecuencia de visitas',
        periodText: `Clientes con membresía · ${startDate} al ${endDate}`,
        alertInfo: 'Solo cuenta Lavado sencillo. Una visita cuenta una sola vez, aunque incluya varios servicios. Sin duplicados por servicios o facturas de la misma visita.',
        kpis: [
          { label: 'Clientes con membresía', value: '60', subtext: 'Socias activas en período', icon: 'users', color: 'blue' },
          { label: 'Con visitas', value: '48', subtext: '80% del total', icon: 'user_check', color: 'emerald' },
          { label: 'Sin visitas', value: '12', subtext: '20% del total', icon: 'alert', color: 'rose' }
        ],
        chart: {
          type: 'frequency_interactive',
          data: frequencyBins
        },
        table: {
          title: `Clientes con ${selectedBin.label}`,
          badgeText: `${selectedBin.count} clientes`,
          columns: [
            { key: 'cliente', label: 'Cliente' },
            { key: 'membresia', label: 'Membresía' },
            { key: 'visitas', label: 'Visitas', align: 'center' },
            { key: 'ultimo_lavado', label: 'Último lavado sencillo' },
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'contacto', label: 'Contacto', align: 'center' }
          ],
          rows: activeRows,
          footerNote: 'Base: clientes con membresía activa durante el período seleccionado.'
        }
      });
      return;
    }

    // 3. Consumo promedio por cliente (Ventas y cobros #12)
    if (selectedReportId === 'avg_spend_per_client') {
      setReportData({
        title: 'Consumo promedio por cliente',
        periodText: `${startDate} al ${endDate}`,
        kpis: [
          { label: 'Facturación Válida', value: 'RD$ 520,000', subtext: 'Excluye facturas anuladas', icon: 'trending', color: 'emerald' },
          { label: 'Clientes Únicos Atendidos', value: '260', subtext: 'Base analizada del período', icon: 'users', color: 'blue' },
          { label: 'Consumo Promedio', value: 'RD$ 2,000', subtext: 'Por cliente atendido', icon: 'tag', color: 'purple' },
          { label: 'Ticket por Factura', value: 'RD$ 1,485', subtext: 'Frecuencia: 1.34 facturas/cliente', icon: 'receipt', color: 'amber' }
        ],
        chart: {
          type: 'bar',
          title: 'Consumo Promedio por Sucursal (RD$)',
          data: [
            { label: 'San Vicente', value: 2150, displayValue: 'RD$ 2,150' },
            { label: 'Villa Mella', value: 1820, displayValue: 'RD$ 1,820' },
            { label: 'General Empresa', value: 2000, displayValue: 'RD$ 2,000' }
          ]
        },
        table: {
          title: 'Desglose por cliente y sucursal',
          columns: [
            { key: 'cliente', label: 'Cliente' },
            { key: 'sucursal', label: 'Sucursal' },
            { key: 'facturas_validas', label: 'Facturas', align: 'center' },
            { key: 'consumo_total', label: 'Consumo Total', isCurrency: true },
            { key: 'promedio_individual', label: 'Promedio por Visita', isCurrency: true }
          ],
          rows: [
            { cliente: 'Rosario Valdez', sucursal: 'San Vicente', facturas_validas: 3, consumo_total: 8500, promedio_individual: 2833 },
            { cliente: 'Jessica Paulino', sucursal: 'San Vicente', facturas_validas: 2, consumo_total: 5400, promedio_individual: 2700 },
            { cliente: 'Daniela Méndez', sucursal: 'Villa Mella', facturas_validas: 4, consumo_total: 7200, promedio_individual: 1800 },
            { cliente: 'Carla Batista', sucursal: 'San Vicente', facturas_validas: 1, consumo_total: 3900, promedio_individual: 3900 }
          ],
          footerNote: 'Una persona con varias visitas cuenta como un solo cliente. No confundir con ticket promedio por factura.'
        }
      });
      return;
    }

    // 4. Cobros por método de pago (#5)
    if (selectedReportId === 'payment_methods') {
      setReportData({
        title: 'Cobros por método de pago',
        periodText: `${startDate} al ${endDate}`,
        kpis: [
          { label: 'Total Cobrado', value: 'RD$ 485,000', subtext: 'Todos los canales', icon: 'dollar', color: 'emerald' },
          { label: 'Cobros en Efectivo', value: 'RD$ 225,000', subtext: '46.4% de participación', icon: 'dollar', color: 'blue' },
          { label: 'Tarjeta de Crédito', value: 'RD$ 195,000', subtext: 'CardNet & POS físico (40.2%)', icon: 'credit_card', color: 'purple' },
          { label: 'Transferencias', value: 'RD$ 65,000', subtext: 'Banreservas / BHD (13.4%)', icon: 'receipt', color: 'amber' }
        ],
        chart: {
          type: 'donut',
          data: [
            { label: 'Efectivo en Caja', count: 182, amount: 225000, percentage: 46.4, color: '#10b981' },
            { label: 'Tarjeta POS / CardNet', count: 135, amount: 195000, percentage: 40.2, color: '#2563eb' },
            { label: 'Transferencia Bancaria', count: 38, amount: 65000, percentage: 13.4, color: '#8b5cf6' }
          ]
        },
        table: {
          title: 'Detalle de transacciones por método',
          columns: [
            { key: 'fecha', label: 'Fecha' },
            { key: 'metodo', label: 'Método' },
            { key: 'cliente', label: 'Cliente' },
            { key: 'referencia', label: 'Referencia / Ticket' },
            { key: 'monto', label: 'Monto Cobrado', isCurrency: true }
          ],
          rows: [
            { fecha: '12 oct 2026', metodo: 'Efectivo', cliente: 'Beatriz Gómez', referencia: 'T-1024', monto: 1800 },
            { fecha: '12 oct 2026', metodo: 'Tarjeta', cliente: 'Camila Peña', referencia: 'AUTH-94812', monto: 3500 },
            { fecha: '11 oct 2026', metodo: 'Transferencia', cliente: 'Elena Castillo', referencia: 'TRF-58392', monto: 4500 }
          ]
        }
      });
      return;
    }

    // 5. Clientes inactivos (#3 Clientes)
    if (selectedReportId === 'inactive_clients') {
      setReportData({
        title: 'Clientes inactivos',
        periodText: `Ausencia superior a ${daysInactive} días`,
        kpis: [
          { label: 'Total Clientes Inactivos', value: '38', subtext: `Sin visita > ${daysInactive} días`, icon: 'users', color: 'rose' },
          { label: 'Con Membresía Activa', value: '14', subtext: 'En riesgo de cancelación', icon: 'alert', color: 'amber' },
          { label: 'Clientes Regulares', value: '24', subtext: 'Sin suscripción', icon: 'clock', color: 'slate' }
        ],
        chart: { type: 'table_only' },
        table: {
          title: `Clientes sin visitar hace más de ${daysInactive} días`,
          badgeText: '38 clientes identificados',
          columns: [
            { key: 'cliente', label: 'Cliente' },
            { key: 'telefono', label: 'Teléfono' },
            { key: 'tipo', label: 'Tipo' },
            { key: 'ultima_visita', label: 'Última Visita' },
            { key: 'dias_ausente', label: 'Días de Ausencia', align: 'center' },
            { key: 'contacto', label: 'Acción WhatsApp', align: 'center' }
          ],
          rows: [
            { cliente: 'Yomaira Batista', telefono: '8095551122', tipo: 'Plan Beauty', ultima_visita: '12 sept 2026', dias_ausente: 30 },
            { cliente: 'Francisca Santana', telefono: '8095553344', tipo: 'Plan Beauty', ultima_visita: '05 sept 2026', dias_ausente: 37 },
            { cliente: 'Dilenia Corporán', telefono: '8095557788', tipo: 'Regular', ultima_visita: '28 ago 2026', dias_ausente: 45 }
          ],
          footerNote: 'Al pulsar "Contactar" se abre el canal de WhatsApp sin enviar mensajes de forma no autorizada.'
        }
      });
      return;
    }

    // 7. Generic report renderer for any of the 30 approved catalog reports
    setReportData({
      title: currentReportConfig.name || 'Reporte de Inteligencia',
      periodText: `${startDate} al ${endDate}`,
      alertInfo: currentReportConfig.alertInfo || null,
      kpis: [
        { label: 'Registros Procesados', value: '124', subtext: 'Base analizada del período', icon: 'receipt', color: 'blue' },
        { label: 'Total Facturado / Generado', value: 'RD$ 340,000', subtext: 'Monto consolidado', icon: 'dollar', color: 'emerald' },
        { label: 'Promedio Operativo', value: 'RD$ 2,741', subtext: 'Por unidad de análisis', icon: 'trending', color: 'purple' }
      ],
      chart: {
        type: 'bar',
        title: 'Desglose Comparativo',
        data: [
          { label: 'San Vicente', value: 195000, displayValue: 'RD$ 195,000' },
          { label: 'Villa Mella', value: 145000, displayValue: 'RD$ 145,000' }
        ]
      },
      table: {
        title: 'Registros detallados del reporte',
        columns: [
          { key: 'fecha', label: 'Fecha' },
          { key: 'concepto', label: 'Concepto / Ítem' },
          { key: 'sucursal', label: 'Sucursal' },
          { key: 'monto', label: 'Monto', isCurrency: true }
        ],
        rows: [
          { fecha: '12 oct 2026', concepto: 'Servicio General', sucursal: 'San Vicente', monto: 2500 },
          { fecha: '11 oct 2026', concepto: 'Tratamiento Capilar', sucursal: 'Villa Mella', monto: 3800 },
          { fecha: '10 oct 2026', concepto: 'Lavado y Secado', sucursal: 'San Vicente', monto: 600 }
        ],
        footerNote: currentReportConfig.note || 'Datos calculados según las directrices aprobadas de negocio.'
      }
    });
  };

  // Run loadReport reactively when primary filters change
  useEffect(() => {
    loadReport();
  }, [
    activeCategory,
    selectedReportId,
    selectedSalon,
    daysInactive,
    cancellationReason,
    selectedEmployee,
    selectedMembership,
    timeGrain,
    startDate,
    endDate,
    useSampleData
  ]);

  const handleApplyFilters = (e) => {
    if (e) e.preventDefault();
    loadReport();
  };

  // Active frequency bin for dynamic group filtering (RF-03)
  const activeFrequencyBin = useMemo(() => {
    if (selectedReportId !== 'visit_frequency') return null;
    const chartData = reportData?.chart?.data || [];
    return chartData.find(b => b.key === interactiveSelectedGroup || b.label === interactiveSelectedGroup)
      || (reportData?.clientBins && reportData.clientBins[interactiveSelectedGroup])
      || chartData[0]
      || null;
  }, [selectedReportId, reportData, interactiveSelectedGroup]);

  // Dynamic table data: updates immediately when clicking frequency bars (RF-03)
  const displayedTable = useMemo(() => {
    if (selectedReportId === 'visit_frequency' && activeFrequencyBin) {
      const rows = activeFrequencyBin.clients || [];
      return {
        title: `Clientes con ${activeFrequencyBin.label} (Haz clic en las barras para cambiar grupo)`,
        badgeText: `${rows.length} ${rows.length === 1 ? 'cliente' : 'clientes'}`,
        columns: reportData?.table?.columns || [],
        rows: rows,
        footerNote: reportData?.table?.footerNote
      };
    }
    return reportData?.table;
  }, [selectedReportId, activeFrequencyBin, reportData?.table]);

  if (viewMode === 'classic') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-canvas, #f8fafc)', padding: '1.5rem 2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 style={{ margin: 0, fontWeight: 800 }}>Analítica Operativa & Históricos (Vista Clásica)</h2>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>Ventas diarias, cobros por cliente, facturas, cobros en efectivo y comisiones de colaboradores</p>
          </div>
          <button
            type="button"
            onClick={() => setViewMode('executive')}
            style={{
              padding: '0.5rem 1rem',
              background: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '0.5rem',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(37, 99, 235, 0.25)'
            }}
          >
            ← Volver a Nuevo BI (30 Reportes)
          </button>
        </div>
        <ServiceAnalytics />
      </div>
    );
  }

  return (
    <div
      className="printable-bi-container"
      style={{
        minHeight: standalone ? '100vh' : 'auto',
        background: standalone ? '#f8fafc' : 'transparent',
        padding: standalone ? '1.75rem 2rem 3rem' : '0.5rem 0',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#0f172a'
      }}
    >
      {/* Print Styles for Direct Printing & Save as PDF */}
      <style>{`
        @media print {
          nav, aside, header, .sidebar, .no-print,
          button, input, select, form, .no-print * {
            display: none !important;
          }
          body, html, #root {
            background: #ffffff !important;
            color: #0f172a !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .printable-bi-container {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            padding: 8mm 10mm !important;
            margin: 0 !important;
            background: #ffffff !important;
          }
          .bi-print-header {
            display: block !important;
            margin-bottom: 1.25rem !important;
            border-bottom: 2px solid #0f172a !important;
            padding-bottom: 0.65rem !important;
          }
          .bi-print-header h1 {
            margin: 0 0 0.25rem 0 !important;
            font-size: 1.3rem !important;
            font-weight: 800 !important;
            color: #0f172a !important;
          }
          .bi-print-header p {
            margin: 0 !important;
            font-size: 0.82rem !important;
            color: #475569 !important;
          }
          table {
            width: 100% !important;
            font-size: 8pt !important;
            border-collapse: collapse !important;
            page-break-inside: auto !important;
          }
          tr {
            page-break-inside: avoid !important;
            page-break-after: auto !important;
          }
          th, td {
            padding: 4px 6px !important;
            border: 1px solid #cbd5e1 !important;
          }
        }
        @media screen {
          .bi-print-header {
            display: none !important;
          }
        }
      `}</style>

      {/* Institutional Header Visible Only on Print/PDF */}
      <div className="bi-print-header">
        <h1>SISTEMA SALON PRO &amp; PLAN BEAUTY RD</h1>
        <p>
          <strong>Reporte:</strong> {reportData?.title || currentReportConfig.name} &nbsp;|&nbsp;
          <strong>Período evaluado:</strong> {reportData?.periodText || `${startDate} al ${endDate}`} &nbsp;|&nbsp;
          <strong>Fecha y hora de generación:</strong> {new Date().toLocaleString('es-DO')}
        </p>
      </div>

      {/* 1. Header Area */}
      {standalone && (
      <div className="no-print" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: '1rem',
        marginBottom: '1.5rem'
      }}>
        <div>
          <h1 style={{
            margin: 0,
            fontSize: '1.75rem',
            fontWeight: 800,
            color: '#0f172a',
            letterSpacing: '-0.025em'
          }}>
            Inteligencia de negocios
          </h1>
          <p style={{
            margin: '0.25rem 0 0',
            fontSize: '0.95rem',
            color: '#64748b'
          }}>
            Toda la información de tu empresa para tomar decisiones
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{
            display: 'inline-flex',
            background: '#e2e8f0',
            borderRadius: '0.5rem',
            padding: '3px',
            border: '1px solid #cbd5e1'
          }}>
            <button
              type="button"
              onClick={() => setViewMode('executive')}
              style={{
                padding: '0.35rem 0.85rem',
                fontSize: '0.8rem',
                fontWeight: viewMode === 'executive' ? 700 : 500,
                borderRadius: '0.375rem',
                border: 'none',
                cursor: 'pointer',
                background: viewMode === 'executive' ? '#2563eb' : 'transparent',
                color: viewMode === 'executive' ? '#ffffff' : '#475569',
                transition: 'all 0.15s ease'
              }}
            >
              Nuevo BI (30 Reportes)
            </button>
            <button
              type="button"
              onClick={() => setViewMode('classic')}
              style={{
                padding: '0.35rem 0.85rem',
                fontSize: '0.8rem',
                fontWeight: viewMode === 'classic' ? 700 : 500,
                borderRadius: '0.375rem',
                border: 'none',
                cursor: 'pointer',
                background: viewMode === 'classic' ? '#0f172a' : 'transparent',
                color: viewMode === 'classic' ? '#ffffff' : '#475569',
                transition: 'all 0.15s ease'
              }}
            >
              Vista Clásica (Históricos)
            </button>
          </div>
        {/* Status Badge & Toggle Datos de Ejemplo */}
        <button
          type="button"
          onClick={() => setUseSampleData(!useSampleData)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.45rem',
            background: useSampleData ? '#0284c7' : '#e0f2fe',
            color: useSampleData ? '#ffffff' : '#0284c7',
            border: useSampleData ? '1px solid #0284c7' : '1px solid #bae6fd',
            padding: '0.4rem 0.95rem',
            borderRadius: '0.5rem',
            fontSize: '0.82rem',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
            transition: 'all 0.15s ease'
          }}
          title={useSampleData ? 'Haga clic para ver datos reales de la BD' : 'Haga clic para ver datos de ejemplo de la maqueta'}
        >
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: useSampleData ? '#ffffff' : '#0284c7'
          }} />
          <span>{useSampleData ? 'Datos de ejemplo (Activo)' : 'Datos de ejemplo'}</span>
        </button>
        </div>
      </div>
      )}

      {/* 2. Top Category Tabs (4 tabs) */}
      <div className="no-print" style={{
        display: 'flex',
        borderBottom: '2px solid #e2e8f0',
        marginBottom: '1.5rem',
        overflowX: 'auto',
        gap: '0.5rem'
      }}>
        {BI_CATEGORIES.map(cat => {
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => handleCategoryChange(cat.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.85rem 1.25rem',
                border: 'none',
                background: isActive ? '#eff6ff' : 'transparent',
                color: isActive ? '#2563eb' : '#64748b',
                fontWeight: isActive ? 700 : 500,
                fontSize: '0.95rem',
                cursor: 'pointer',
                borderRadius: '0.5rem 0.5rem 0 0',
                borderBottom: isActive ? '3px solid #2563eb' : '3px solid transparent',
                marginBottom: '-2px',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap'
              }}
            >
              <span>{cat.name}</span>
              <span style={{
                background: isActive ? '#2563eb' : '#e2e8f0',
                color: isActive ? '#ffffff' : '#475569',
                fontSize: '0.72rem',
                fontWeight: 700,
                padding: '0.1rem 0.45rem',
                borderRadius: '9999px'
              }}>
                {cat.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* RENDERIZADO CONDICIONAL: VISTA ESPECIALIZADA FLUJO DE EFECTIVO O VISTA ESTÁNDAR BI */}
      {selectedReportId === 'cash_flow' ? (
        <div data-testid="cash-flow-executive-view" style={{ animation: 'fadeIn 0.2s ease-in-out' }}>
          {/* Header Superior con Breadcrumbs y Badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
            marginBottom: '1rem'
          }}>
            <div>
              <span style={{
                display: 'inline-block',
                padding: '0.25rem 0.75rem',
                background: '#ede9fe',
                color: '#7c3aed',
                fontSize: '0.72rem',
                fontWeight: 800,
                borderRadius: '9999px',
                letterSpacing: '0.05em',
                marginBottom: '0.4rem',
                textTransform: 'uppercase'
              }}>
                INTELIGENCIA DE NEGOCIOS
              </span>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                fontSize: '0.85rem',
                color: '#64748b'
              }}>
                <Home size={14} color="#64748b" />
                <span style={{ color: '#cbd5e1' }}>&gt;</span>
                <span style={{ fontWeight: 600, color: '#334155' }}>Productividad y rentabilidad</span>
                {availableReports.length > 1 && (
                  <>
                    <span style={{ color: '#cbd5e1' }}>&gt;</span>
                    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                      <select
                        value={selectedReportId}
                        onChange={(e) => handleReportChange(e.target.value)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#2563eb',
                          fontSize: '0.85rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          outline: 'none',
                          paddingRight: '1rem',
                          appearance: 'none'
                        }}
                        title="Cambiar reporte dentro de Productividad y rentabilidad"
                      >
                        {availableReports.map(rep => (
                          <option key={rep.id} value={rep.id}>{rep.name}</option>
                        ))}
                      </select>
                      <ChevronDown size={12} color="#2563eb" style={{ pointerEvents: 'none', marginLeft: '-0.85rem' }} />
                    </div>
                  </>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setUseSampleData(!useSampleData)}
              style={{
                background: 'transparent',
                border: 'none',
                color: (reportData?.is_sample || useSampleData) ? '#2563eb' : '#94a3b8',
                fontSize: '0.85rem',
                fontWeight: (reportData?.is_sample || useSampleData) ? 700 : 500,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.25rem 0.5rem',
                borderRadius: '0.375rem'
              }}
              title="Haga clic para alternar entre datos de ejemplo y datos reales de la base de datos"
            >
              <span style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: (reportData?.is_sample || useSampleData) ? '#2563eb' : '#cbd5e1'
              }} />
              <span>{useSampleData ? 'Datos de ejemplo (Activo)' : 'Datos de ejemplo'}</span>
            </button>
          </div>

          {/* Error Banner si la llamada al backend falló */}
          {reportError && (
            <div style={{
              background: '#fff1f2',
              border: '1px solid #fecdd3',
              borderRadius: '0.75rem',
              padding: '0.85rem 1.25rem',
              marginBottom: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.75rem',
              color: '#9f1239',
              fontSize: '0.88rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <AlertCircle size={20} color="#e11d48" style={{ flexShrink: 0 }} />
                <span>{reportError}</span>
              </div>
              <button
                type="button"
                onClick={loadReport}
                style={{
                  padding: '0.35rem 0.75rem',
                  background: '#e11d48',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '0.375rem',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Reintentar
              </button>
            </div>
          )}

          {/* Título Principal */}
          <h1 style={{
            fontSize: '2.4rem',
            fontWeight: 800,
            color: '#0f172a',
            margin: '0 0 1.5rem 0',
            letterSpacing: '-0.025em'
          }}>
            Flujo de efectivo
          </h1>

          {/* Barra de Filtros Homologada a la Maqueta */}
          <div style={{
            background: '#ffffff',
            borderRadius: '1.25rem',
            padding: '1.25rem 1.5rem',
            border: '1px solid #f1f5f9',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            gap: '1rem'
          }}>
            <div style={{ flex: '1 1 140px', minWidth: '140px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#64748b', marginBottom: '0.35rem' }}>
                Desde
              </label>
              <div style={{ position: 'relative' }}>
                <Calendar size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#94a3b8' }} />
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setPeriod('custom');
                  }}
                  style={{
                    width: '100%',
                    padding: '0.55rem 0.75rem 0.55rem 2.25rem',
                    fontSize: '0.88rem',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '0.6rem',
                    color: '#1e293b',
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            <div style={{ flex: '1 1 140px', minWidth: '140px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#64748b', marginBottom: '0.35rem' }}>
                Hasta
              </label>
              <div style={{ position: 'relative' }}>
                <Calendar size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#94a3b8' }} />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setPeriod('custom');
                  }}
                  style={{
                    width: '100%',
                    padding: '0.55rem 0.75rem 0.55rem 2.25rem',
                    fontSize: '0.88rem',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '0.6rem',
                    color: '#1e293b',
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            <div style={{ flex: '2 1 200px', minWidth: '200px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#64748b', marginBottom: '0.35rem' }}>
                Sucursal
              </label>
              <div style={{ position: 'relative' }}>
                <Building2 size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#94a3b8' }} />
                <select
                  value={selectedSalon}
                  onChange={(e) => setSelectedSalon(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.55rem 2rem 0.55rem 2.25rem',
                    fontSize: '0.88rem',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '0.6rem',
                    color: '#1e293b',
                    outline: 'none',
                    appearance: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value="all">Todas las sucursales</option>
                  {salons.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <ChevronDown size={14} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#64748b' }} />
              </div>
            </div>

            <button
              type="button"
              onClick={handleApplyFilters}
              disabled={loading}
              style={{
                padding: '0.65rem 1.75rem',
                background: loading ? '#93c5fd' : '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '0.6rem',
                fontWeight: 700,
                fontSize: '0.88rem',
                cursor: loading ? 'wait' : 'pointer',
                boxShadow: '0 2px 4px rgba(37,99,235,0.2)',
                transition: 'all 0.15s ease'
              }}
            >
              {loading ? 'Aplicando...' : 'Aplicar'}
            </button>

            <button
              type="button"
              onClick={() => {
                exportReportToExcel({
                  title: 'Flujo de efectivo',
                  periodText: `${startDate} al ${endDate}`,
                  kpis: reportData?.kpis || [],
                  columns: [
                    { key: 'concept', label: 'Concepto' },
                    { key: 'amount', label: 'Monto (RD$)', isCurrency: true },
                    { key: 'percentage', label: '% del total pagado' }
                  ],
                  rows: (reportData?.concepts_breakdown || []).map(c => ({
                    concept: c.concept,
                    amount: c.amount,
                    percentage: `${c.percentage}%`
                  })),
                  activeFilters: { salon: selectedSalon, period }
                });
              }}
              style={{
                padding: '0.65rem 0.95rem',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '0.6rem',
                color: '#475569',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
              }}
              title="Exportar reporte"
            >
              <Share2 size={16} />
            </button>
          </div>

          {/* Banner de Advertencia de Integridad y Cobertura */}
          {reportData?.warning && (
            <div
              data-testid="cash-flow-partial-warning"
              style={{
                background: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: '1rem',
                padding: '0.9rem 1.25rem',
                marginBottom: '1.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.75rem',
                color: '#92400e'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <AlertCircle size={20} color="#d97706" style={{ flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>
                    {reportData.warning}
                  </div>
                  {reportData?.reconciliation_meta?.coverage_status?.pending_items?.length > 0 && (
                    <div style={{ fontSize: '0.78rem', color: '#b45309', marginTop: '0.15rem' }}>
                      Movimientos pendientes: {reportData.reconciliation_meta.coverage_status.pending_items.join(' · ')}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                {reportData?.reconciliation_meta?.pending_payroll_amount > 0 && (
                  <span style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    background: '#fef3c7',
                    color: '#92400e',
                    padding: '0.3rem 0.65rem',
                    borderRadius: '0.5rem',
                    border: '1px solid #fcd34d'
                  }}>
                    Nómina calculada: RD$ {Number(reportData.reconciliation_meta.pending_payroll_amount).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                )}
                {reportData?.reconciliation_meta?.pending_606_count > 0 && (
                  <span style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    background: '#fef3c7',
                    color: '#92400e',
                    padding: '0.3rem 0.65rem',
                    borderRadius: '0.5rem',
                    border: '1px solid #fcd34d'
                  }}>
                    {reportData.reconciliation_meta.pending_606_count} compra 606 pendiente
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 4 KPI Cards (Grid 2x2) */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem'
          }}>
            {/* KPI 1: Total cobrado */}
            <div style={{
              background: '#ffffff',
              borderRadius: '1.25rem',
              padding: '1.5rem',
              border: '1px solid #f1f5f9',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              display: 'flex',
              alignItems: 'center',
              gap: '1.25rem'
            }}>
              <div style={{
                width: '54px',
                height: '54px',
                borderRadius: '0.85rem',
                background: '#eff6ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#2563eb',
                flexShrink: 0
              }}>
                <CreditCard size={28} />
              </div>
              <div>
                <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: '#64748b', marginBottom: '0.25rem' }}>
                  Total cobrado
                </span>
                <span style={{ fontSize: '1.9rem', fontWeight: 800, color: '#1e3a8a', letterSpacing: '-0.02em' }}>
                  RD$ {(reportData?.total_cobrado !== undefined
                    ? (reportData.total_cobrado % 1 !== 0
                        ? reportData.total_cobrado.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : reportData.total_cobrado.toLocaleString('es-DO'))
                    : (useSampleData ? '1,000,000' : '0'))}
                </span>
              </div>
            </div>

            {/* KPI 2: Total pagado */}
            <div style={{
              background: '#ffffff',
              borderRadius: '1.25rem',
              padding: '1.5rem',
              border: '1px solid #f1f5f9',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              display: 'flex',
              alignItems: 'center',
              gap: '1.25rem'
            }}>
              <div style={{
                width: '54px',
                height: '54px',
                borderRadius: '0.85rem',
                background: '#faf5ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#9333ea',
                flexShrink: 0
              }}>
                <Wallet size={28} />
              </div>
              <div>
                <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: '#64748b', marginBottom: '0.25rem' }}>
                  Total pagado
                </span>
                <span style={{ fontSize: '1.9rem', fontWeight: 800, color: '#3b0764', letterSpacing: '-0.02em' }}>
                  RD$ {(reportData?.total_pagado !== undefined
                    ? (reportData.total_pagado % 1 !== 0
                        ? reportData.total_pagado.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : reportData.total_pagado.toLocaleString('es-DO'))
                    : (useSampleData ? '750,000' : '0'))}
                </span>
              </div>
            </div>

            {/* KPI 3: Excedente del período */}
            <div style={{
              background: '#ffffff',
              borderRadius: '1.25rem',
              padding: '1.5rem',
              border: '1px solid #f1f5f9',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              display: 'flex',
              alignItems: 'center',
              gap: '1.25rem'
            }}>
              <div style={{
                width: '54px',
                height: '54px',
                borderRadius: '0.85rem',
                background: '#f5f3ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#7c3aed',
                flexShrink: 0
              }}>
                <BarChart3 size={28} />
              </div>
              <div>
                <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: '#64748b', marginBottom: '0.25rem' }}>
                  Excedente del período
                </span>
                <span style={{ fontSize: '1.9rem', fontWeight: 800, color: '#1e1b4b', letterSpacing: '-0.02em' }}>
                  RD$ {(reportData?.excedente_periodo !== undefined
                    ? (reportData.excedente_periodo % 1 !== 0
                        ? reportData.excedente_periodo.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : reportData.excedente_periodo.toLocaleString('es-DO'))
                    : (useSampleData ? '250,000' : '0'))}
                </span>
              </div>
            </div>

            {/* KPI 4: Excedente sobre lo cobrado */}
            <div style={{
              background: '#ffffff',
              borderRadius: '1.25rem',
              padding: '1.5rem',
              border: '1px solid #f1f5f9',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '1.25rem'
            }}>
              <div style={{
                width: '54px',
                height: '54px',
                borderRadius: '0.85rem',
                background: '#ecfdf5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#059669',
                flexShrink: 0
              }}>
                <Percent size={28} />
              </div>
              <div style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: '#64748b', marginBottom: '0.25rem' }}>
                  Excedente sobre lo cobrado
                </span>
                <div style={{ fontSize: '2.2rem', fontWeight: 800, color: '#059669', lineHeight: 1.1, marginBottom: '0.35rem' }}>
                  {reportData?.excedente_pct !== undefined ? reportData.excedente_pct : (useSampleData ? 25 : 0)}%
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 500, marginBottom: '0.5rem' }}>
                  {reportData?.retencion_desc || (useSampleData ? 'Por cada RD$100 cobrados, te quedan RD$25.' : ((reportData?.total_cobrado || 0) > 0 ? `Por cada RD$100 cobrados, te quedan RD$${Math.round(((reportData?.excedente_periodo || 0) / (reportData?.total_cobrado || 1)) * 100)}.` : 'Sin cobros registrados en el período.'))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                  {reportData?.delta_vs_anterior && (
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.2rem',
                      padding: '0.15rem 0.55rem',
                      borderRadius: '0.35rem',
                      background: reportData.delta_direction === 'up' ? '#dcfce7' : (reportData.delta_direction === 'down' ? '#fee2e2' : '#f1f5f9'),
                      color: reportData.delta_direction === 'up' ? '#15803d' : (reportData.delta_direction === 'down' ? '#b91c1c' : '#475569'),
                      fontSize: '0.74rem',
                      fontWeight: 700
                    }}>
                      {reportData.delta_vs_anterior}
                    </span>
                  )}
                  <span style={{ fontSize: '0.74rem', color: '#94a3b8', fontWeight: 500 }}>
                    {reportData?.delta_subtext || 'vs. período anterior'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Tarjeta Principal: Salidas de dinero por concepto */}
          <div style={{
            background: '#ffffff',
            borderRadius: '1.25rem',
            padding: '2rem',
            border: '1px solid #f1f5f9',
            boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
            marginBottom: '1.5rem'
          }}>
            {/* Cabecera de la sección */}
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '1rem',
              paddingBottom: '1.5rem',
              borderBottom: '1px solid #f1f5f9',
              marginBottom: '1.5rem'
            }}>
              <div>
                <h2 style={{
                  fontSize: '1.4rem',
                  fontWeight: 800,
                  color: '#0f172a',
                  margin: '0 0 0.25rem 0'
                }}>
                  Salidas de dinero por concepto
                </h2>
                <span style={{ fontSize: '0.88rem', color: '#64748b', fontWeight: 400 }}>
                  De mayor a menor · Conceptos consolidados
                </span>
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '2.5rem',
                fontSize: '0.78rem',
                fontWeight: 600,
                color: '#94a3b8'
              }}>
                <span style={{ width: '120px', textAlign: 'right' }}>Monto</span>
                <span style={{ width: '120px', textAlign: 'right' }}>% del total pagado</span>
              </div>
            </div>

            {/* Lista de Filas con Barras Horizontales */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {(() => {
                const breakdownItems = reportData?.concepts_breakdown || (useSampleData ? [
                  { concept: 'Nómina', amount: 300000, percentage: 40.0, bar_pct: 40.0 },
                  { concept: 'Mercancías e insumos', amount: 150000, percentage: 20.0, bar_pct: 20.0 },
                  { concept: 'Alquileres', amount: 100000, percentage: 13.3, bar_pct: 13.3 },
                  { concept: 'Préstamos', amount: 80000, percentage: 10.7, bar_pct: 10.7 },
                  { concept: 'TSS', amount: 60000, percentage: 8.0, bar_pct: 8.0 },
                  { concept: 'Energía eléctrica', amount: 40000, percentage: 5.3, bar_pct: 5.3 },
                  { concept: 'Otros pagos', amount: 20000, percentage: 2.7, bar_pct: 2.7 }
                ] : []);

                if (breakdownItems.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: '#94a3b8', fontSize: '0.9rem' }}>
                      No se registraron desembolsos ni egresos para los filtros seleccionados en este período.
                    </div>
                  );
                }

                return breakdownItems.map((item, idx) => {
                  const isLoan = item.concept.toLowerCase().includes('préstamo') || item.concept.toLowerCase().includes('prestamo');
                  const hasLoanBreakdown = isLoan && reportData?.loans_detail && (
                    Number(reportData.loans_detail.total_capital || 0) > 0 ||
                    Number(reportData.loans_detail.total_interest || 0) > 0
                  );

                  return (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '1.25rem'
                      }}
                    >
                      {/* Nombre del Concepto */}
                      <div style={{
                        width: '180px',
                        fontSize: '0.92rem',
                        fontWeight: 600,
                        color: '#1e293b',
                        flexShrink: 0
                      }}>
                        <div>{item.concept}</div>
                        {hasLoanBreakdown && (
                          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.2rem', fontWeight: 500 }}>
                            Cap: RD$ {Number(reportData.loans_detail.total_capital || 0).toLocaleString('es-DO')} · Int: RD$ {Number(reportData.loans_detail.total_interest || 0).toLocaleString('es-DO')}
                            {Number(reportData.loans_detail.total_charges || 0) > 0 ? ` · Cargos: RD$ ${Number(reportData.loans_detail.total_charges).toLocaleString('es-DO')}` : ''}
                          </div>
                        )}
                      </div>

                      {/* Barra de Progreso Azul Proporcional */}
                      <div style={{
                        flex: 1,
                        height: '18px',
                        borderRadius: '0.4rem',
                        background: '#f1f5f9',
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center'
                      }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${Math.min(Math.max(item.bar_pct || item.percentage || 0, (item.amount > 0 ? 1 : 0)), 100)}%`,
                            background: '#3b82f6',
                            borderRadius: '0.4rem',
                            transition: 'width 0.4s ease'
                          }}
                        />
                      </div>

                      {/* Monto y Porcentaje */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '2.5rem',
                        fontSize: '0.92rem',
                        flexShrink: 0
                      }}>
                        <span style={{
                          width: '120px',
                          textAlign: 'right',
                          fontWeight: 700,
                          color: '#0f172a'
                        }}>
                          RD$ {(item.amount || 0).toLocaleString('es-DO')}
                        </span>
                        <span style={{
                          width: '120px',
                          textAlign: 'right',
                          fontWeight: 500,
                          color: '#64748b'
                        }}>
                          {(item.percentage || 0).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            {/* Footer de la tarjeta con fuentes y etiquetas */}
            <div style={{
              marginTop: '2.25rem',
              paddingTop: '1.5rem',
              borderTop: '1px solid #f1f5f9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '1rem'
            }}>
              <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 500 }}>
                {reportData?.sources_text || 'Fuentes: Cobros · DGII 606 pagado · Contabilidad/Egresos'}
              </span>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.35rem 0.85rem',
                  borderRadius: '9999px',
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  color: '#1d4ed8',
                  fontSize: '0.78rem',
                  fontWeight: 600
                }}>
                  <Shield size={14} color="#2563eb" />
                  <span>Sin duplicar pagos</span>
                </span>

                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.35rem 0.85rem',
                  borderRadius: '9999px',
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  color: '#15803d',
                  fontSize: '0.78rem',
                  fontWeight: 600
                }}>
                  <Check size={14} color="#16a34a" />
                  <span>{reportData?.reconciliation_meta?.nomina_source || 'Nómina pagada del período'}</span>
                </span>

                {reportData?.reconciliation_meta?.reconciled_606_count > 0 && (
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    padding: '0.35rem 0.85rem',
                    borderRadius: '9999px',
                    background: '#faf5ff',
                    border: '1px solid #e9d5ff',
                    color: '#7e22ce',
                    fontSize: '0.78rem',
                    fontWeight: 600
                  }}>
                    <span>{reportData.reconciliation_meta.reconciled_606_count} compras 606 conciliadas en Egresos</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Panel de Conciliación Financiera y Auditoría de Fuentes */}
          {reportData?.reconciliation_meta && (
            <div
              data-testid="cash-flow-reconciliation-panel"
              style={{
                background: '#ffffff',
                borderRadius: '1.25rem',
                padding: '1.75rem',
                border: '1px solid #f1f5f9',
                boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                marginBottom: '1.5rem'
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.5rem',
                paddingBottom: '1rem',
                borderBottom: '1px solid #f8fafc',
                marginBottom: '1.25rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Shield size={20} color="#2563eb" />
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                    Conciliación Financiera y Auditoría de Fuentes
                  </h3>
                </div>
                <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 500 }}>
                  Principio de prudencia financiera: Cobros netos vs. Desembolsos verificados
                </span>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '1rem'
              }}>
                {/* 1. Movimientos Efectivos Conciliados */}
                <div style={{
                  background: '#f8fafc',
                  borderRadius: '0.85rem',
                  padding: '1.15rem',
                  border: '1px solid #e2e8f0'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.65rem' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f172a' }}>
                      1. Movimientos Efectivos Conciliados
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#334155', lineHeight: 1.6 }}>
                    <div>• <strong>Cobros netos en caja/banco:</strong> RD$ {Number(reportData.total_cobrado || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    <div>• <strong>Total pagado registrado:</strong> RD$ {Number(reportData.total_pagado || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    {reportData.reconciliation_meta.cash_register_expenses_amount > 0 && (
                      <div style={{ fontSize: '0.74rem', color: '#475569', marginLeft: '0.65rem' }}>
                        ↳ Incluye {reportData.reconciliation_meta.cash_register_expenses_count} gastos de caja POS por RD$ {Number(reportData.reconciliation_meta.cash_register_expenses_amount).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </div>
                    )}
                    <div>• <strong>Excedente registrado:</strong> RD$ {Number(reportData.excedente_periodo || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({reportData.excedente_pct}%)</div>
                    {reportData.reconciliation_meta.excluded_colab_nomina_amount > 0 && (
                      <div style={{ marginTop: '0.5rem', padding: '0.4rem 0.6rem', background: '#f1f5f9', borderRadius: '0.4rem', color: '#475569', fontSize: '0.74rem' }}>
                        * Excluidos <strong>RD$ {Number(reportData.reconciliation_meta.excluded_colab_nomina_amount).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong> ({reportData.reconciliation_meta.excluded_colab_nomina_count} consumos) de colaboradoras por deducirse vía nómina.
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. Movimientos Pendientes de Conciliación */}
                <div style={{
                  background: '#fffbeb',
                  borderRadius: '0.85rem',
                  padding: '1.15rem',
                  border: '1px solid #fde68a'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.65rem' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b' }} />
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#92400e' }}>
                      2. Pendientes de Conciliación
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#78350f', lineHeight: 1.6 }}>
                    {reportData.reconciliation_meta.pending_606_count > 0 && (
                      <div>• <strong>DGII 606 sin desembolso comprobado:</strong> {reportData.reconciliation_meta.pending_606_count} compra (RD$ {Number(reportData.reconciliation_meta.pending_606_amount || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })})</div>
                    )}
                    {reportData.reconciliation_meta.pending_payroll_amount > 0 && (
                      <div style={{ marginTop: '0.35rem' }}>
                        • <strong>Nómina calculada en plantilla:</strong> {reportData.reconciliation_meta.pending_payroll_periods_count || 2} períodos calculados (RD$ {Number(reportData.reconciliation_meta.pending_payroll_amount).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) pendientes de soporte de desembolso bancario.
                      </div>
                    )}
                    {reportData.reconciliation_meta.pending_606_items?.map((it, idx) => (
                      <div key={idx} style={{ marginTop: '0.35rem', padding: '0.4rem 0.6rem', background: '#fef3c7', borderRadius: '0.4rem', fontSize: '0.73rem', color: '#92400e' }}>
                        <div><strong>{it.proveedor}</strong> (NCF {it.ncf}): RD$ {Number(it.monto_efectivo || it.total_facturado).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</div>
                        <div style={{ fontSize: '0.7rem', color: '#b45309' }}>Motivo: {it.motivo}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. Flujo Completo vs. Registrado */}
                <div style={{
                  background: '#f8fafc',
                  borderRadius: '0.85rem',
                  padding: '1.15rem',
                  border: '1px solid #e2e8f0'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.65rem' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#6366f1' }} />
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#3730a3' }}>
                      3. Excedente Registrado vs. Completo
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#334155', lineHeight: 1.6 }}>
                    <div>• <strong>Excedente registrado en sistema:</strong> RD$ {Number(reportData.excedente_periodo || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({reportData.excedente_pct}%)</div>
                    {reportData.reconciliation_meta.flujo_completo_conciliado !== undefined && (
                      <div style={{ marginTop: '0.35rem' }}>
                        • <strong>Flujo completo proyectado:</strong> RD$ {Number(reportData.reconciliation_meta.flujo_completo_conciliado || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({reportData.reconciliation_meta.flujo_completo_pct}%)
                        <div style={{ fontSize: '0.72rem', color: '#64748b' }}>(al deducir la nómina calculada de plantilla)</div>
                      </div>
                    )}
                    <div style={{ marginTop: '0.35rem', padding: '0.4rem 0.6rem', background: '#f1f5f9', borderRadius: '0.4rem', fontSize: '0.72rem', color: '#64748b' }}>
                      Alquileres, TSS y Electricidad ejecutados fuera del sistema o pendientes de migración contable.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Nota al Pie Explicativa Metodológica */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.78rem',
            color: '#64748b',
            padding: '0.25rem 0.5rem',
            marginBottom: '1rem'
          }}>
            <Info size={15} color="#94a3b8" style={{ flexShrink: 0 }} />
            <span>
              {reportData?.footnote || 'El excedente corresponde a cobros menos pagos del período. No equivale a utilidad contable ni al saldo bancario.'}
            </span>
          </div>
        </div>
      ) : (
        /* VISTAS ESTÁNDAR PARA LOS DEMÁS REPORTES */
        <>
          {/* 3. Filter Bar (Single White Card) */}
          <form
            className="no-print"
            onSubmit={handleApplyFilters}
            style={{
              background: '#ffffff',
              borderRadius: '1rem',
              padding: '1.25rem 1.5rem',
              border: '1px solid #e2e8f0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              marginBottom: '1.5rem'
            }}
          >
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
              alignItems: 'end'
            }}>
          {/* Selector 1: Reporte */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>
              Reporte
            </label>
            <div style={{ position: 'relative' }}>
              <select
                value={selectedReportId}
                onChange={(e) => handleReportChange(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.55rem 2rem 0.55rem 0.85rem',
                  fontSize: '0.88rem',
                  fontWeight: 600,
                  color: '#0f172a',
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: '0.5rem',
                  outline: 'none',
                  appearance: 'none',
                  cursor: 'pointer'
                }}
              >
                {availableReports.map(rep => (
                  <option key={rep.id} value={rep.id}>
                    {rep.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#64748b' }} />
            </div>
          </div>

          {/* Selector 2: Período */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>
              Período
            </label>
            <div style={{ position: 'relative' }}>
              <select
                value={period}
                onChange={(e) => handlePeriodChange(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.55rem 2rem 0.55rem 0.85rem',
                  fontSize: '0.88rem',
                  color: '#0f172a',
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: '0.5rem',
                  outline: 'none',
                  appearance: 'none',
                  cursor: 'pointer'
                }}
              >
                {(currentReportConfig.id === 'contracts_upcoming_renewal' ? FUTURE_PERIOD_OPTIONS : PERIOD_OPTIONS).map(opt => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
              <ChevronDown size={15} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#64748b' }} />
            </div>
          </div>

          {/* Custom Date Pickers when period === 'custom' */}
          {period === 'custom' && (
            <>
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>
                  Desde
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.85rem',
                    fontSize: '0.88rem',
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '0.5rem'
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>
                  Hasta
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.85rem',
                    fontSize: '0.88rem',
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '0.5rem'
                  }}
                />
              </div>
            </>
          )}

          {/* Selector 3: Sucursal */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>
              Sucursal
            </label>
            <div style={{ position: 'relative' }}>
              <select
                value={selectedSalon}
                onChange={(e) => setSelectedSalon(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.55rem 2rem 0.55rem 0.85rem',
                  fontSize: '0.88rem',
                  color: '#0f172a',
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: '0.5rem',
                  outline: 'none',
                  appearance: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="all">Todas las sucursales</option>
                {salons.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <ChevronDown size={15} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#64748b' }} />
            </div>
          </div>

          {/* Contextual Dynamic Filter: Plan */}
          {(currentReportConfig.hasPlanFilter || currentReportConfig.id === 'contracts_upcoming_renewal') && (
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>
                Plan
              </label>
              <div style={{ position: 'relative' }}>
                <select
                  value={selectedPlan}
                  onChange={(e) => setSelectedPlan(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.55rem 2rem 0.55rem 0.85rem',
                    fontSize: '0.88rem',
                    color: '#0f172a',
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '0.5rem',
                    outline: 'none',
                    appearance: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value="all">Todos los planes</option>
                  {plans.map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                  {plans.length === 0 && (
                    <option value="Plan Beauty">Plan Beauty</option>
                  )}
                </select>
                <ChevronDown size={15} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#64748b' }} />
              </div>
            </div>
          )}

          {/* Contextual Dynamic Filter 1: Membresía */}
          {currentReportConfig.hasMembershipFilter && (
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>
                Membresía
              </label>
              <div style={{ position: 'relative' }}>
                <select
                  value={selectedMembership}
                  onChange={(e) => setSelectedMembership(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.55rem 2rem 0.55rem 0.85rem',
                    fontSize: '0.88rem',
                    color: '#0f172a',
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '0.5rem',
                    outline: 'none',
                    appearance: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value="all">Todas las membresías</option>
                  <option value="Plan Beauty">Plan Beauty (Lavados)</option>
                  <option value="VIP">Plan VIP Full</option>
                </select>
                <ChevronDown size={15} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#64748b' }} />
              </div>
            </div>
          )}

          {/* Contextual Dynamic Filter 2: Días Inactivos */}
          {currentReportConfig.hasDaysFilter && (
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>
                Días de ausencia
              </label>
              <div style={{ position: 'relative' }}>
                <select
                  value={daysInactive}
                  onChange={(e) => setDaysInactive(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '0.55rem 2rem 0.55rem 0.85rem',
                    fontSize: '0.88rem',
                    color: '#0f172a',
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '0.5rem',
                    outline: 'none',
                    appearance: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value={15}>Más de 15 días</option>
                  <option value={30}>Más de 30 días</option>
                  <option value={60}>Más de 60 días</option>
                  <option value={90}>Más de 90 días</option>
                </select>
                <ChevronDown size={15} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#64748b' }} />
              </div>
            </div>
          )}

          {/* Contextual Dynamic Filter 3: Motivo Cancelación */}
          {currentReportConfig.hasReasonFilter && (
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>
                Motivo de cancelación
              </label>
              <div style={{ position: 'relative' }}>
                <select
                  value={cancellationReason}
                  onChange={(e) => setCancellationReason(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.55rem 2rem 0.55rem 0.85rem',
                    fontSize: '0.88rem',
                    color: '#0f172a',
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '0.5rem',
                    outline: 'none',
                    appearance: 'none',
                    cursor: 'pointer'
                  }}
                >
                  {CANCELLATION_REASONS.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <ChevronDown size={15} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#64748b' }} />
              </div>
            </div>
          )}

          {/* Contextual Dynamic Filter 4: Empleado */}
          {currentReportConfig.hasEmployeeFilter && (
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginBottom: '0.4rem' }}>
                Colaborador / Empleado
              </label>
              <div style={{ position: 'relative' }}>
                <select
                  value={selectedEmployee}
                  onChange={(e) => setSelectedEmployee(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.55rem 2rem 0.55rem 0.85rem',
                    fontSize: '0.88rem',
                    color: '#0f172a',
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '0.5rem',
                    outline: 'none',
                    appearance: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value="all">Todo el equipo</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name || emp.nombre}</option>
                  ))}
                </select>
                <ChevronDown size={15} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#64748b' }} />
              </div>
            </div>
          )}

          {/* Primary Action: Aplicar */}
          <div>
            <button
              type="button"
              onClick={handleApplyFilters}
              disabled={loading}
              style={{
                width: '100%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '0.62rem 1.25rem',
                background: loading ? '#93c5fd' : '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '0.5rem',
                fontWeight: 700,
                fontSize: '0.9rem',
                cursor: loading ? 'wait' : 'pointer',
                boxShadow: '0 2px 4px rgba(37, 99, 235, 0.25)',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = '#1d4ed8'; }}
              onMouseLeave={(e) => { if (!loading) e.currentTarget.style.background = '#2563eb'; }}
            >
              {loading ? (
                <>
                  <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} />
                  <span>Consultando...</span>
                </>
              ) : (
                <>
                  <Filter size={15} />
                  <span>Aplicar</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Top Loading Progress Bar (Linear style) */}
      {loading && (
        <div style={{
          height: '3px',
          width: '100%',
          background: '#eff6ff',
          borderRadius: '9999px',
          overflow: 'hidden',
          marginBottom: '1.25rem'
        }}>
          <div style={{
            height: '100%',
            width: '50%',
            background: 'linear-gradient(90deg, #60a5fa, #2563eb)',
            borderRadius: '9999px',
            animation: 'pulse 1s ease-in-out infinite'
          }} />
        </div>
      )}

      {/* Error Banner with Retry */}
      {reportError && (
        <div style={{
          background: '#fff1f2',
          border: '1px solid #fecdd3',
          borderRadius: '0.75rem',
          padding: '1rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '1.5rem',
          color: '#9f1239',
          fontSize: '0.88rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <AlertCircle size={20} color="#e11d48" style={{ flexShrink: 0 }} />
            <span>{reportError}</span>
          </div>
          <button
            type="button"
            onClick={loadReport}
            style={{
              padding: '0.4rem 0.85rem',
              background: '#e11d48',
              color: '#ffffff',
              border: 'none',
              borderRadius: '0.375rem',
              fontWeight: 600,
              fontSize: '0.8rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            Reintentar
          </button>
        </div>
      )}

      {/* 4. Report Header & Actions (Title, Date, Export, Print) */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem',
        marginBottom: '1.25rem'
      }}>
        <div>
          <h2 style={{
            margin: 0,
            fontSize: '1.4rem',
            fontWeight: 800,
            color: '#0f172a'
          }}>
            {effectiveReportData?.title || reportData?.title || currentReportConfig.name}
          </h2>
          {isRecurringReport ? (
            <div style={{ margin: '0.2rem 0 0', lineHeight: 1.45 }}>
              <div style={{ fontSize: '0.88rem', color: '#64748b', fontWeight: 500 }}>
                {effectiveReportData?.subtitle || `Cuotas con primer intento en el período · Corte: ${(() => {
                  try {
                    const d = new Date(endDate + 'T12:00:00');
                    return !isNaN(d.getTime())
                      ? d.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' })
                      : endDate;
                  } catch (_) {
                    return endDate;
                  }
                })()}`}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 500 }}>
                {effectiveReportData?.baseText || `Base: ${reportData?.summary?.total_obligations || (reportData?.table?.rows?.length || 49)} cuotas únicas · RD$ ${((reportData?.summary?.total_obligations || (reportData?.table?.rows?.length || 49)) * 1950).toLocaleString('es-DO')}`}
              </div>
            </div>
          ) : (
            <p style={{
              margin: '0.2rem 0 0',
              fontSize: '0.85rem',
              color: '#64748b'
            }}>
              {reportData?.periodText || `${startDate} al ${endDate}`}
            </p>
          )}
        </div>

        {/* Export & Print Buttons */}
        <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          {/* Export Dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setShowExportMenu(!showExportMenu)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                padding: '0.45rem 0.95rem',
                borderRadius: '0.5rem',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#334155',
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
              onMouseLeave={(e) => e.currentTarget.style.background = '#ffffff'}
            >
              <Download size={15} color="#475569" />
              <span>Exportar</span>
              <ChevronDown size={14} color="#64748b" />
            </button>

            {showExportMenu && (
              <div style={{
                position: 'absolute',
                right: 0,
                top: '110%',
                background: '#ffffff',
                borderRadius: '0.5rem',
                border: '1px solid #e2e8f0',
                boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
                padding: '0.35rem 0',
                zIndex: 50,
                minWidth: '150px'
              }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowExportMenu(false);
                    exportReportToExcel({
                      title: reportData?.title || currentReportConfig.name,
                      periodText: reportData?.periodText || `${startDate} al ${endDate}`,
                      kpis: reportData?.kpis || [],
                      columns: displayedTable?.columns || reportData?.table?.columns || [],
                      rows: tableFilteredRows || displayedTable?.rows || reportData?.table?.rows || [],
                      unmatchedTable: reportData?.unmatched_table,
                      activeFilters: {
                        salon: selectedSalon,
                        plan: selectedPlan,
                        period
                      }
                    });
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.5rem 1rem',
                    fontSize: '0.82rem',
                    fontWeight: 500,
                    color: '#1e293b',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f1f5f9'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                >
                  Excel (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowExportMenu(false);
                    exportReportToCSV({
                      title: reportData?.title || currentReportConfig.name,
                      periodText: reportData?.periodText || `${startDate} al ${endDate}`,
                      columns: displayedTable?.columns || reportData?.table?.columns || [],
                      rows: tableFilteredRows || displayedTable?.rows || reportData?.table?.rows || [],
                      unmatchedTable: reportData?.unmatched_table,
                      activeFilters: {
                        salon: selectedSalon,
                        plan: selectedPlan,
                        period
                      }
                    });
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.5rem 1rem',
                    fontSize: '0.82rem',
                    fontWeight: 500,
                    color: '#1e293b',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f1f5f9'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                >
                  CSV (.csv)
                </button>
              </div>
            )}
          </div>

          {/* Print Button */}
          <button
            type="button"
            onClick={triggerPrintReport}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              padding: '0.45rem 0.85rem',
              borderRadius: '0.5rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: '#334155',
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
            onMouseLeave={(e) => e.currentTarget.style.background = '#ffffff'}
            title="Imprimir informe actual"
          >
            <Printer size={16} color="#475569" />
            <span className="hidden sm:inline">Imprimir</span>
          </button>
        </div>
      </div>

      {/* 5. Alert Info Banner (if applicable, e.g. Mockup 2 - excluido en cohortes para diseño limpio) */}
      {!isRecurringReport && (reportData?.alertInfo || currentReportConfig.alertInfo) && (
        <div style={{
          background: '#eff6ff',
          border: '1px solid #bfdbfe',
          borderRadius: '0.75rem',
          padding: '0.85rem 1.15rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          marginBottom: '1.5rem',
          color: '#1e40af',
          fontSize: '0.85rem',
          lineHeight: 1.45
        }}>
          <Info size={18} color="#2563eb" style={{ flexShrink: 0 }} />
          <span>{reportData?.alertInfo || currentReportConfig.alertInfo}</span>
        </div>
      )}

      {/* 6. KPI Metric Cards */}
      <BIKpiCards kpis={effectiveReportData?.kpis || reportData?.kpis || []} />

      {/* 7. Interactive Chart (2x2 Grid para cohortes de recuperación o individual) */}
      <BIChart
        chartConfig={effectiveReportData?.chart || reportData?.chart || { type: currentReportConfig.chartType }}
        data={effectiveReportData?.chart?.data || reportData?.chart?.data || []}
        selectedGroup={interactiveSelectedGroup}
        onSelectGroup={(key, bin) => {
          setInteractiveSelectedGroup(key);
        }}
        timeGrain={timeGrain}
        onTimeGrainChange={(grain) => setTimeGrain(grain)}
      />

      {/* 7.2 Resumen Discreto de Conciliación Independiente (Fase B1.2) */}
      {isRecurringReport && reportData?.reconciliation && (
        <div
          data-testid="reconciliation-summary"
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '0.85rem',
            padding: '0.85rem 1.25rem',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.85rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: '260px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '0.5rem',
              background: '#f1f5f9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#475569',
              flexShrink: 0
            }}>
              <Info size={18} />
            </div>
            <div>
              <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#1e293b' }}>
                Pagos cobrados sin atribución contractual
              </div>
              <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                Transacciones aprobadas en pasarela sin referencia de contrato ni cuota. Se concilian de forma independiente sin alterar la deuda pendiente.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Cobrado sin asignar
              </div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                RD$ {(reportData.reconciliation.unmatched_approved_amount || 0).toLocaleString('es-DO')}
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Cantidad
              </div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                {reportData.reconciliation.total_unmatched_approved_payments || 0} {reportData.reconciliation.total_unmatched_approved_payments === 1 ? 'pago' : 'pagos'}
              </div>
            </div>

            <span style={{
              background: '#fef3c7',
              color: '#92400e',
              border: '1px solid #fde68a',
              padding: '0.3rem 0.75rem',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: 700,
              whiteSpace: 'nowrap'
            }}>
              Pendiente de conciliación
            </span>
          </div>
        </div>
      )}

      {/* 7.5 Summary / Totals Table (e.g. Totalized by Branch) */}
      {reportData?.summaryTable && (
        <div style={{ marginBottom: '1.5rem' }}>
          <BIDetailTable
            title={reportData.summaryTable.title || 'Resumen consolidado por sucursal'}
            badgeText={reportData.summaryTable.badgeText}
            columns={reportData.summaryTable.columns || []}
            rows={reportData.summaryTable.rows || []}
            footerNote={reportData.summaryTable.footerNote}
            pageSize={10}
          />
        </div>
      )}

      {/* 8. Detail Data Table */}
      <BIDetailTable
        title={displayedTable?.title || 'Detalle de registros'}
        badgeText={displayedTable?.badgeText}
        columns={displayedTable?.columns || []}
        rows={displayedTable?.rows || []}
        footerNote={displayedTable?.footerNote}
        onFilteredRowsChange={(filtered) => setTableFilteredRows(filtered)}
        emptyMessage={
          currentReportConfig.id === 'contracts_upcoming_renewal'
            ? 'No hay renovaciones anuales para el período seleccionado'
            : (selectedReportId === 'recurring_charges_result' || selectedReportId === 'declined_charges_recovery')
              ? 'No se encontraron obligaciones de cobros recurrentes para el período y filtros seleccionados.'
              : 'No hay registros disponibles para los filtros aplicados.'
        }
        pageSize={10}
      />

      {/* 8.5 Tabla independiente de pagos pendientes de conciliación contractual (Fase B3.4) */}
      {(selectedReportId === 'recurring_charges_result' || selectedReportId === 'declined_charges_recovery') && reportData?.unmatched_table && (
        <div style={{ marginTop: '2rem' }} data-testid="unmatched-payments-section">
          <BIDetailTable
            title={reportData.unmatched_table.title || 'Pagos pendientes de conciliación contractual'}
            subtitle={reportData.unmatched_table.subtitle}
            badgeText={reportData.unmatched_table.badgeText}
            columns={reportData.unmatched_table.columns || []}
            rows={reportData.unmatched_table.rows || []}
            footerNote={reportData.unmatched_table.footerNote}
            emptyMessage="No hay pagos pendientes de conciliación contractual en el período."
            pageSize={10}
          />
        </div>
      )}
        </>
      )}
    </div>
  );
};

export default BusinessIntelligence;

