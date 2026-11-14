import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatCsvRow, downloadCsvFile } from '../../utils/secureCsvExport';
import {
  FileText, Settings, CheckCircle2, AlertCircle, Info, Plus,
  ChevronDown, Download, Printer, FileSpreadsheet, Tag, X, Check
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useNotification } from '../../context/NotificationContext';

const MONTHS_ES = [
  { value: '01', label: 'Enero' },
  { value: '02', label: 'Febrero' },
  { value: '03', label: 'Marzo' },
  { value: '04', label: 'Abril' },
  { value: '05', label: 'Mayo' },
  { value: '06', label: 'Junio' },
  { value: '07', label: 'Julio' },
  { value: '08', label: 'Agosto' },
  { value: '09', label: 'Septiembre' },
  { value: '10', label: 'Octubre' },
  { value: '11', label: 'Noviembre' },
  { value: '12', label: 'Diciembre' }
];

const formatPeriodoLabel = (periodoStr) => {
  if (!periodoStr || periodoStr.length !== 6) return periodoStr || '';
  const yr = periodoStr.slice(0, 4);
  const mo = periodoStr.slice(4, 6);
  const mObj = MONTHS_ES.find(m => m.value === mo);
  return `${mObj ? mObj.label : mo} ${yr}`;
};

const fmtCurrency = (val, showDecimals = true) => {
  const num = Number(val || 0);
  if (!showDecimals && num % 1 === 0) {
    return `RD$ ${num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }
  return `RD$ ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function ReporteIT1Module() {
  const navigate = useNavigate();
  const { showNotification } = useNotification();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [salons, setSalons] = useState([]);
  const [selectedSalon, setSelectedSalon] = useState('all');
  const [selectedYear, setSelectedYear] = useState(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('periodo');
      if (p && /^\d{6}$/.test(p)) return p.slice(0, 4);
    }
    return String(new Date().getFullYear());
  });
  const [selectedMonth, setSelectedMonth] = useState(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('periodo');
      if (p && /^\d{6}$/.test(p)) return p.slice(4, 6);
    }
    return String(new Date().getMonth() + 1).padStart(2, '0');
  });
  const [activeTab, setActiveTab] = useState('resumen'); // 'resumen' | 'anexo_a' | 'it1'
  const [unavailableError, setUnavailableError] = useState(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showComplementModal, setShowComplementModal] = useState(false);

  // IT-1 Data State
  const [it1Data, setIt1Data] = useState({
    periodo: `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}`,
    settings: {
      regimen: 'exento',
      regimen_activo: 'exento',
      empresa_nombre: 'ETEREAS SRL',
      rnc: '131917038',
      tasa_itbis: 18
    },
    source606: {
      loaded: true,
      cantidad_registros: 0,
      monto_servicios: 0,
      monto_bienes: 0,
      total_facturado: 0,
      itbis_facturado: 0,
      itbis_retenido: 0,
      itbis_costo: 0,
      itbis_adelantar: 0,
      por_categoria: []
    },
    source607: {
      loaded: true,
      cantidad_registros: 0,
      monto_total: 0,
      itbis_facturado: 0,
      por_ncf: {},
      por_tipo_venta: {}
    },
    calculation: {
      regimen: 'exento',
      ventas_totales: 0,
      ventas_exentas: 0,
      ventas_gravadas: 0,
      itbis_generado_ventas: 0,
      itbis_pagado_compras: 0,
      itbis_al_costo_gasto: 0,
      itbis_deducible: 0,
      itbis_acreditable: 0,
      itbis_retenido_compras: 0,
      saldo_favor_anterior: 0,
      retenciones_y_ajustes: 0,
      resultado_a_pagar: 0,
      saldo_a_favor: 0,
      tipo_resultado: 'exento'
    },
    declaration: {
      estado: 'Borrador',
      datos_complementarios_revisados: 0,
      saldo_favor_anterior: 0,
      retenciones_tarjetas: 0,
      retenciones_terceros: 0,
      pagos_computables_importaciones: 0,
      otros_ajustes: 0,
      notas: ''
    },
    savedPeriods: []
  });

  // Complementary Form State
  const [compForm, setCompForm] = useState({
    saldo_favor_anterior: 0,
    retenciones_tarjetas: 0,
    retenciones_terceros: 0,
    pagos_computables_importaciones: 0,
    otros_ajustes: 0,
    notas: ''
  });

  // Config Modal State
  const [configRegimen, setConfigRegimen] = useState('exento');

  useEffect(() => {
    dataService.getSalons().then(list => {
      if (Array.isArray(list)) setSalons(list);
    }).catch(() => {});
    fetchIT1Data(`${selectedYear}${selectedMonth}`, selectedSalon);
  }, []);

  const fetchIT1Data = async (periodoOverride, salonOverride, regimenOverride) => {
    const targetPeriodo = periodoOverride || `${selectedYear}${selectedMonth}`;
    const targetSalon = salonOverride !== undefined ? salonOverride : selectedSalon;
    setLoading(true);
    setUnavailableError(null);
    try {
      const res = await dataService.getReporteIT1({
        periodo: targetPeriodo,
        salonId: targetSalon,
        ...(regimenOverride ? { regimen: regimenOverride } : {})
      });
      if (res && res.unavailable) {
        setUnavailableError(res.error || 'Declaración IT-1 pendiente de integración.');
        return;
      }
      if (res && res.success) {
        setIt1Data(res);
        const activeReg = res.settings?.regimen_activo || res.settings?.regimen || 'exento';
        setConfigRegimen(activeReg);
        setCompForm({
          saldo_favor_anterior: Number(res.declaration?.saldo_favor_anterior || 0),
          retenciones_tarjetas: Number(res.declaration?.retenciones_tarjetas || 0),
          retenciones_terceros: Number(res.declaration?.retenciones_terceros || 0),
          pagos_computables_importaciones: Number(res.declaration?.pagos_computables_importaciones || 0),
          otros_ajustes: Number(res.declaration?.otros_ajustes || 0),
          notas: res.declaration?.notas || ''
        });
      }
    } catch (err) {
      console.error('Error cargando IT-1:', err);
      setUnavailableError(err.message || 'Declaración IT-1 pendiente de integración fiscal.');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = () => {
    fetchIT1Data(`${selectedYear}${selectedMonth}`, selectedSalon);
  };

  const handleSaveSettings = async (newRegimen) => {
    try {
      setSaving(true);
      const res = await dataService.saveIT1Settings({ regimen: newRegimen, tasa_itbis: 18 });
      showNotification(res.message || 'Configuración de régimen ITBIS actualizada', 'success');
      setShowConfigModal(false);
      await fetchIT1Data(`${selectedYear}${selectedMonth}`, selectedSalon, newRegimen);
    } catch (err) {
      showNotification(err.message || 'Error al guardar configuración', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDeclaration = async (targetEstado, markComplementReviewed = false) => {
    try {
      setSaving(true);
      const isRegimenExento = (it1Data.settings?.regimen_activo || 'exento') === 'exento';
      const calc = it1Data.calculation || {};

      // Recalculate with current compForm values
      const saldoAnt = Number(compForm.saldo_favor_anterior || 0);
      const retTarj = Number(compForm.retenciones_tarjetas || 0);
      const retTerc = Number(compForm.retenciones_terceros || 0);
      const pagImp = Number(compForm.pagos_computables_importaciones || 0);
      const otrosAj = Number(compForm.otros_ajustes || 0);
      const totalComp = retTarj + retTerc + pagImp + otrosAj;

      let snapResultado = 0;
      let snapTipo = 'exento';
      if (isRegimenExento) {
        const retCompras = Number(calc.itbis_retenido_compras || 0);
        snapResultado = Math.max(0, retCompras - totalComp - saldoAnt);
        snapTipo = snapResultado > 0 ? 'a_pagar' : 'exento';
      } else {
        const diff = Number(calc.itbis_generado_ventas || 0) - Number(calc.itbis_deducible || 0) - saldoAnt - totalComp;
        snapResultado = Math.abs(diff);
        snapTipo = diff >= 0 ? 'a_pagar' : 'a_favor';
      }

      const payload = {
        periodo: it1Data.periodo,
        salon_id: selectedSalon,
        regimen: it1Data.settings?.regimen_activo || 'exento',
        estado: targetEstado,
        datos_complementarios_revisados:
          markComplementReviewed || targetEstado === 'Revisado' || it1Data.declaration?.datos_complementarios_revisados
            ? 1
            : 0,
        saldo_favor_anterior: saldoAnt,
        retenciones_tarjetas: retTarj,
        retenciones_terceros: retTerc,
        pagos_computables_importaciones: pagImp,
        otros_ajustes: otrosAj,
        notas: compForm.notas,
        snapshot_ventas_totales: Number(calc.ventas_totales || 0),
        snapshot_itbis_generado: Number(calc.itbis_generado_ventas || 0),
        snapshot_itbis_compras: Number(calc.itbis_pagado_compras || 0),
        snapshot_resultado: snapResultado,
        snapshot_tipo_resultado: snapTipo
      };

      const res = await dataService.saveIT1Declaration(payload);
      showNotification(res.message || 'Declaración guardada correctamente', 'success');
      setShowComplementModal(false);
      await fetchIT1Data(it1Data.periodo, selectedSalon);
    } catch (err) {
      showNotification(err.message || 'Error al guardar declaración IT-1', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleLoadSavedPeriod = (savedRow) => {
    const p = String(savedRow.periodo || '');
    if (p.length === 6) {
      const yr = p.slice(0, 4);
      const mo = p.slice(4, 6);
      setSelectedYear(yr);
      setSelectedMonth(mo);
      fetchIT1Data(p, savedRow.salon_id || selectedSalon);
    }
  };

  // Export Official DGII IT-1 & Anexo A (.csv / Excel)
  const handleExportExcel = () => {
    try {
      const calc = it1Data.calculation || {};
      const s606 = it1Data.source606 || {};
      const s607 = it1Data.source607 || {};
      const isExento = (it1Data.settings?.regimen_activo || 'exento') === 'exento';
      const periodoLabel = formatPeriodoLabel(it1Data.periodo);

      // Section 1: Formulario IT-1 (Oficina Virtual DGII)
      const it1Rows = [
        ['DIRECCIÓN GENERAL DE IMPUESTOS INTERNOS (DGII)'],
        ['FORMULARIO IT-1: DECLARACIÓN JURADA Y/O PAGO DEL IMPUESTO SOBRE LAS TRANSFERENCIAS DE BIENES INDUSTRIALIZADOS Y SERVICIOS (ITBIS)'],
        [''],
        ['I. DATOS GENERALES'],
        ['RNC / Cédula', it1Data.settings?.rnc || '131917038', 'Período (AAAAMM)', it1Data.periodo],
        ['Razón Social', it1Data.settings?.empresa_nombre || 'ETEREAS SRL', 'Régimen Declarado', isExento ? 'Operaciones: Servicios Exentos' : 'Operaciones Gravadas con ITBIS'],
        ['Estado Preparación', it1Data.declaration?.estado || 'Borrador', 'Fecha Generación', new Date().toLocaleDateString('es-DO')],
        [''],
        ['II. INGRESOS POR OPERACIONES (VIENEN DEL REPORTE 607 Y ANEXO A)'],
        ['Casilla', 'Concepto Oficial DGII IT-1', 'Origen', 'Monto (RD$)'],
        ['1', 'TOTAL DE OPERACIONES DEL PERÍODO (Viene de la casilla 11 del Anexo A)', '607 / Anexo A', Number(calc.ventas_totales || 0)],
        ['2-9', 'OPERACIONES NO GRAVADAS / SERVICIOS EXENTOS', '607', isExento ? Number(calc.ventas_exentas || 0) : 0],
        ['10', 'TOTAL OPERACIONES NO GRAVADAS', 'Cálculo IT-1', isExento ? Number(calc.ventas_exentas || 0) : 0],
        ['11', 'TOTAL OPERACIONES GRAVADAS (Casilla 1 - Casilla 10)', 'Cálculo IT-1', isExento ? 0 : Number(calc.ventas_gravadas || 0)],
        ['12', 'OPERACIONES GRAVADAS AL 18%', '607', isExento ? 0 : Number(calc.ventas_gravadas || 0)],
        [''],
        ['III. LIQUIDACIÓN DEL IMPUESTO'],
        ['16', 'ITBIS COBRADO EN OPERACIONES GRAVADAS (18% de Casilla 12)', '607', Number(calc.itbis_generado_ventas || 0)],
        ['21', 'TOTAL ITBIS COBRADO', 'Cálculo IT-1', Number(calc.itbis_generado_ventas || 0)],
        ['22', 'ITBIS PAGADO EN COMPRAS LOCALES (Viene del 606 / Anexo A)', '606', Number(calc.itbis_deducible || 0)],
        ['33', 'TOTAL ITBIS DEDUCIBLE', '606 / Anexo A', Number(calc.itbis_deducible || 0)],
        ['34', 'IMPUESTO A PAGAR (Si el valor de las casillas 21 - 33 es Positivo)', 'Cálculo IT-1', Math.max(0, Number(calc.itbis_generado_ventas || 0) - Number(calc.itbis_deducible || 0))],
        ['35', 'SALDO A FAVOR (Si el valor de las casillas 21 - 33 es Negativo)', 'Cálculo IT-1', Math.max(0, Number(calc.itbis_deducible || 0) - Number(calc.itbis_generado_ventas || 0))],
        ['36', 'SALDO A FAVOR ANTERIOR', 'Período anterior', Number(calc.saldo_favor_anterior || 0)],
        ['37', 'PAGOS COMPUTABLES POR RETENCIONES (Norma No. 08-04 / Tarjetas)', 'Complementos', Number(it1Data.declaration?.retenciones_tarjetas || 0) + Number(it1Data.declaration?.retenciones_terceros || 0)],
        ['38', 'OTROS PAGOS COMPUTABLES A CUENTA / IMPORTACIONES / AJUSTES', 'Complementos', Number(it1Data.declaration?.pagos_computables_importaciones || 0) + Number(it1Data.declaration?.otros_ajustes || 0)],
        ['39', 'DIFERENCIA A PAGAR (Si el valor de las casillas 34-36-37-38 es Positivo)', 'Liquidación Final', Number(calc.resultado_a_pagar || 0)],
        ['40', 'NUEVO SALDO A FAVOR', 'Liquidación Final', Number(calc.saldo_a_favor || 0)],
        [''],
        ['IV. TRATAMIENTO DEL ITBIS EN COMPRAS PARA SERVICIOS EXENTOS (606)'],
        ['-', 'ITBIS Pagado en Compras y Gastos del Período (606)', '606', Number(calc.itbis_pagado_compras || 0)],
        ['-', 'ITBIS Llevado al Costo o Gasto (Operaciones Exentas)', '606 / Anexo A', Number(calc.itbis_al_costo_gasto || 0)],
        ['-', 'ITBIS Retenido a Terceros en Compras (606)', '606', Number(calc.itbis_retenido_compras || 0)]
      ];

      // Section 2: Anexo A (Detalle 606 y 607)
      const ncfMap = s607.por_ncf || {};
      const tvMap = s607.por_tipo_venta || {};
      const anexoRows = [
        [''],
        ['========================================================================='],
        ['ANEXO A - DECLARACIÓN JURADA DE ITBIS (DATOS DEL 606 Y 607)'],
        [`Período: ${periodoLabel} (${it1Data.periodo}) | RNC: ${it1Data.settings?.rnc || '131917038'} | ${it1Data.settings?.empresa_nombre || 'ETEREAS SRL'}`],
        [''],
        ['I. OPERACIONES REPORTADAS EN EL 607 / LIBRO DE VENTAS Y FACTURACIÓN ELECTRÓNICA (E-CF) POR TIPO DE NCF'],
        ['Casilla', 'Tipo de Comprobante Fiscal', 'Cantidad', 'Monto Total (RD$)'],
        ['1', ncfMap.credito_fiscal?.nombre || 'Comprobantes Válidos para Crédito Fiscal (01 y 31)', ncfMap.credito_fiscal?.cantidad || 0, Number(ncfMap.credito_fiscal?.monto || 0)],
        ['2', ncfMap.consumo?.nombre || 'Comprobantes de Consumo (02 y 32)', ncfMap.consumo?.cantidad || 0, Number(ncfMap.consumo?.monto || 0)],
        ['3', ncfMap.notas_debito?.nombre || 'Comprobantes Notas de Débito (03 y 33)', ncfMap.notas_debito?.cantidad || 0, Number(ncfMap.notas_debito?.monto || 0)],
        ['4', ncfMap.notas_credito?.nombre || 'Comprobantes Notas de Crédito (04 y 34) [Restado]', ncfMap.notas_credito?.cantidad || 0, -Math.abs(Number(ncfMap.notas_credito?.monto || 0))],
        ['7', ncfMap.regimenes_especiales?.nombre || 'Comprobantes Regímenes Especiales (14 y 44)', ncfMap.regimenes_especiales?.cantidad || 0, Number(ncfMap.regimenes_especiales?.monto || 0)],
        ['8', ncfMap.gubernamentales?.nombre || 'Comprobantes Gubernamentales (15 y 45)', ncfMap.gubernamentales?.cantidad || 0, Number(ncfMap.gubernamentales?.monto || 0)],
        ['9', ncfMap.otras_operaciones?.nombre || 'Otras Operaciones', ncfMap.otras_operaciones?.cantidad || 0, Number(ncfMap.otras_operaciones?.monto || 0)],
        ['11', 'TOTAL OPERACIONES DEL PERÍODO (Pasa a la Casilla 1 del IT-1)', s607.cantidad_registros || 0, Number(s607.monto_total || 0)],
        [''],
        ['II. OPERACIONES REPORTADAS EN EL 607 POR TIPO DE VENTA (MODALIDAD DE COBRO)'],
        ['Casilla', 'Modalidad de Venta / Cobro', '', 'Monto (RD$)'],
        ['12', 'Efectivo', '', Number(tvMap.efectivo || 0)],
        ['13', 'Cheque / Transferencia', '', Number(tvMap.cheque_transferencia || 0)],
        ['14', 'Tarjeta Débito / Crédito', '', Number(tvMap.tarjeta || 0)],
        ['15', 'A Crédito', '', Number(tvMap.venta_credito || 0)],
        ['16', 'Bonos o Certificados de Regalo', '', Number(tvMap.bonos_certificados || 0)],
        ['17', 'Permutas', '', Number(tvMap.permuta || 0)],
        ['18', 'Otras Formas de Venta', '', Number(tvMap.otras_formas || 0)],
        ['19', 'TOTAL OPERACIONES POR TIPO DE VENTA', '', Number(s607.monto_total || 0)],
        [''],
        ['V. ITBIS PAGADO EN COMPRAS Y SERVICIOS REPORTADOS EN EL 606'],
        ['Concepto', 'Facturas 606', 'Monto Facturado (RD$)', 'ITBIS Facturado (RD$)'],
        ['Compras de Bienes Locales (606)', s606.cantidad_registros || 0, Number(s606.monto_bienes || 0), ''],
        ['Compras de Servicios Locales (606)', '', Number(s606.monto_servicios || 0), ''],
        ['TOTAL COMPRAS Y GASTOS 606', s606.cantidad_registros || 0, Number(s606.total_facturado || 0), Number(s606.itbis_facturado || 0)],
        ['ITBIS Llevado al Costo / Gasto', '', '', isExento ? Number(calc.itbis_al_costo_gasto || 0) : Number(s606.itbis_costo || 0)],
        ['ITBIS Deducible / Acreditable en IT-1', '', '', Number(calc.itbis_deducible || 0)]
      ];

      const allRows = [...it1Rows, ...anexoRows];
      const csvContent = allRows.map(row => formatCsvRow(row)).join('\r\n');
      downloadCsvFile(`DGII_IT1_AnexoA_${it1Data.settings?.rnc || '131917038'}_${it1Data.periodo}.csv`, csvContent);

      setShowExportMenu(false);
      showNotification('Archivo Oficial IT-1 y Anexo A descargado correctamente (.csv / Excel)', 'success');
    } catch (err) {
      console.error('Error exportando IT-1:', err);
      showNotification('Error al exportar reporte IT-1', 'error');
    }
  };

  const handleExportCSV = () => {
    try {
      const calc = it1Data.calculation || {};
      const isExento = (it1Data.settings?.regimen_activo || 'exento') === 'exento';
      const lines = [
        'Casilla,Concepto,Origen,Monto_DOP',
        `1,"Total de Operaciones del Periodo",607,${Number(calc.ventas_totales || 0).toFixed(2)}`,
        `10,"Total Operaciones Exentas / No Gravadas",607,${(isExento ? Number(calc.ventas_exentas || 0) : 0).toFixed(2)}`,
        `11,"Total Operaciones Gravadas",607,${(isExento ? 0 : Number(calc.ventas_gravadas || 0)).toFixed(2)}`,
        `16,"ITBIS Generado en Ventas",607,${Number(calc.itbis_generado_ventas || 0).toFixed(2)}`,
        `22,"ITBIS Pagado en Compras (606)",606,${Number(calc.itbis_pagado_compras || 0).toFixed(2)}`,
        `Costo,"ITBIS Llevado al Costo o Gasto",606,${Number(calc.itbis_al_costo_gasto || 0).toFixed(2)}`,
        `33,"Total ITBIS Deducible",606 / Anexo A,${Number(calc.itbis_deducible || 0).toFixed(2)}`,
        `36,"Saldo a Favor Anterior",Periodo Anterior,${Number(calc.saldo_favor_anterior || 0).toFixed(2)}`,
        `37_38,"Retenciones y Otros Ajustes Aplicables",Complementos,${Number(calc.retenciones_y_ajustes || 0).toFixed(2)}`,
        `39,"Resultado a Pagar",IT-1,${Number(calc.resultado_a_pagar || 0).toFixed(2)}`,
        `40,"Nuevo Saldo a Favor",IT-1,${Number(calc.saldo_a_favor || 0).toFixed(2)}`
      ];
      const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DGII_IT1_${it1Data.settings?.rnc || '131917038'}_${it1Data.periodo}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setShowExportMenu(false);
      showNotification('Archivo CSV IT-1 exportado correctamente', 'success');
    } catch (err) {
      showNotification('Error al exportar CSV', 'error');
    }
  };

  const isExento = (it1Data.settings?.regimen_activo || 'exento') === 'exento';
  const calc = it1Data.calculation || {};
  const decl = it1Data.declaration || {};
  const s606 = it1Data.source606 || {};
  const s607 = it1Data.source607 || {};
  const periodoTitle = formatPeriodoLabel(it1Data.periodo);
  const isReviewed = decl.estado === 'Revisado';
  const isComplementReviewed = Boolean(decl.datos_complementarios_revisados) || isReviewed;

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f1f5f9',
      padding: '28px 24px 60px',
      fontFamily: "'Plus Jakarta Sans', 'Inter', -apple-system, sans-serif",
      color: '#0f172a'
    }}>
      <div style={{ maxWidth: '940px', margin: '0 auto' }}>
        {/* HEADER PRINCIPAL + BOTÓN DE CONFIGURACIÓN FISCAL */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '16px',
          marginBottom: '22px'
        }}>
          <div>
            <h1 style={{
              fontSize: '30px',
              fontWeight: 800,
              color: '#0f172a',
              margin: '0 0 4px 0',
              letterSpacing: '-0.02em'
            }}>
              ITBIS (IT-1)
            </h1>
            <p style={{
              fontSize: '16px',
              color: '#334155',
              margin: 0,
              fontWeight: 500
            }}>
              {isExento
                ? 'Preparación mensual de la declaración'
                : 'Preparación mensual desde compras y ventas.'}
            </p>
          </div>

          {/* Botón de Configuración Exenta / Gravada */}
          <button
            onClick={() => {
              setConfigRegimen(isExento ? 'exento' : 'gravado');
              setShowConfigModal(true);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 16px',
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: '10px',
              color: '#0f172a',
              fontSize: '13.5px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.05)',
              transition: 'all 0.15s ease'
            }}
          >
            <Settings size={16} color="#0d9488" />
            <span>
              Configuración: <strong>{isExento ? 'Empresa Exenta' : 'Genera ITBIS en Ventas'}</strong>
            </span>
          </button>
        </div>

        {/* TARJETA DE FILTROS: PREPARAR DECLARACIÓN */}
        <div style={{
          background: '#ffffff',
          borderRadius: '14px',
          border: '1px solid #e2e8f0',
          padding: '22px 24px',
          marginBottom: '20px',
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.03)'
        }}>
          {!isExento && (
            <h2 style={{
              fontSize: '21px',
              fontWeight: 800,
              color: '#0f172a',
              margin: '0 0 16px 0'
            }}>
              Preparar declaración
            </h2>
          )}

          {unavailableError && (
            <div style={{
              marginBottom: '16px',
              padding: '14px 16px',
              borderRadius: '10px',
              background: '#fffbeb',
              border: '1px solid #f59e0b',
              color: '#92400e',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              fontSize: '14px',
              fontWeight: 600
            }}>
              <AlertTriangle size={18} />
              <span>Integración pendiente: {unavailableError}</span>
            </div>
          )}

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: '14px',
            alignItems: 'end'
          }}>
            {/* Selector Empresa */}
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                Empresa
              </label>
              <select
                value={selectedSalon}
                onChange={(e) => setSelectedSalon(e.target.value)}
                style={{
                  width: '100%',
                  height: '42px',
                  padding: '0 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  fontSize: '14.5px',
                  color: '#0f172a',
                  fontWeight: 500,
                  outline: 'none'
                }}
              >
                <option value="all">{it1Data.settings?.empresa_nombre || 'ETEREAS SRL'}</option>
                {salons.map(s => (
                  <option key={s.id} value={String(s.id)}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Selector Mes */}
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                Mes
              </label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                style={{
                  width: '100%',
                  height: '42px',
                  padding: '0 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  fontSize: '14.5px',
                  color: '#0f172a',
                  fontWeight: 500,
                  outline: 'none'
                }}
              >
                {MONTHS_ES.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            {/* Selector Año */}
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                Año
              </label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                style={{
                  width: '100%',
                  height: '42px',
                  padding: '0 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  fontSize: '14.5px',
                  color: '#0f172a',
                  fontWeight: 500,
                  outline: 'none'
                }}
              >
                {['2024', '2025', '2026', '2027'].map(yr => (
                  <option key={yr} value={yr}>{yr}</option>
                ))}
              </select>
            </div>

            {/* Botón Generar */}
            <button
              onClick={handleGenerate}
              disabled={loading}
              style={{
                height: '42px',
                background: '#0891b2',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '15px',
                fontWeight: 700,
                cursor: loading ? 'wait' : 'pointer',
                transition: 'background 0.15s ease'
              }}
            >
              {loading ? 'Cargando...' : 'Generar'}
            </button>
          </div>

          {/* Subtítulo o Badge de Régimen */}
          <div style={{ marginTop: '14px' }}>
            {isExento ? (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                borderRadius: '999px',
                background: '#d1fae5',
                color: '#065f46',
                fontSize: '13.5px',
                fontWeight: 600
              }}>
                <Tag size={14} strokeWidth={2.3} />
                Operaciones: servicios exentos
              </span>
            ) : (
              <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>
                {selectedSalon === 'all' ? 'Consolidado de la empresa.' : 'Declaración filtrada por sucursal.'}
              </span>
            )}
          </div>
        </div>

        {/* TARJETA CENTRAL DEL PERÍODO */}
        <div style={{
          background: '#ffffff',
          borderRadius: '14px',
          border: '1px solid #e2e8f0',
          padding: '24px',
          marginBottom: '20px',
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.03)'
        }}>
          {/* Cabecera del Período + Estado */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '18px'
          }}>
            <h2 style={{
              fontSize: '24px',
              fontWeight: 800,
              color: '#0f172a',
              margin: 0
            }}>
              {periodoTitle}
            </h2>

            <span style={{
              padding: '5px 16px',
              borderRadius: '999px',
              fontSize: '13.5px',
              fontWeight: 700,
              background: isReviewed ? '#dcfce7' : '#fef3c7',
              color: isReviewed ? '#15803d' : '#b45309'
            }}>
              {decl.estado || 'Borrador'}
            </span>
          </div>

          {/* Cajas de estado de orígenes: 606 y 607 */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '14px',
            marginBottom: '18px'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '13px 16px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <FileText size={18} color="#2563eb" />
                <span style={{ fontSize: '14.5px', fontWeight: 700, color: '#0f172a' }}>
                  606 <span style={{ color: '#475569', fontWeight: 500 }}>· {isExento ? 'Cargado' : 'Datos cargados'} ({s606.cantidad_registros || 0})</span>
                </span>
              </div>
              <button
                onClick={() => navigate(`/contabilidad/reporte-606?periodo=${it1Data.periodo}`)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#0284c7',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 0
                }}
              >
                Ver origen
              </button>
            </div>

            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '13px 16px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <FileText size={18} color="#2563eb" />
                <span style={{ fontSize: '14.5px', fontWeight: 700, color: '#0f172a' }}>
                  607 <span style={{ color: '#475569', fontWeight: 500 }}>· {isExento ? 'Cargado' : 'Datos cargados'} ({s607.cantidad_registros || 0})</span>
                </span>
              </div>
              <button
                onClick={() => navigate(`/contabilidad/reporte-607?periodo=${it1Data.periodo}`)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#0284c7',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 0
                }}
              >
                Ver origen
              </button>
            </div>
          </div>

          {/* 3 KPI CARDS SEGÚN RÉGIMEN */}
          {isExento ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '14px',
              marginBottom: '22px'
            }}>
              <div style={{
                padding: '18px 20px',
                borderRadius: '10px',
                border: '1px solid #e2e8f0',
                background: '#ffffff'
              }}>
                <div style={{ fontSize: '13.5px', color: '#334155', fontWeight: 500, marginBottom: '6px' }}>
                  Ventas exentas
                </div>
                <div style={{ fontSize: '26px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
                  {fmtCurrency(calc.ventas_exentas, false)}
                </div>
              </div>

              <div style={{
                padding: '18px 20px',
                borderRadius: '10px',
                border: '1px solid #e2e8f0',
                background: '#ffffff'
              }}>
                <div style={{ fontSize: '13.5px', color: '#334155', fontWeight: 500, marginBottom: '6px' }}>
                  ITBIS pagado en compras
                </div>
                <div style={{ fontSize: '26px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
                  {fmtCurrency(calc.itbis_pagado_compras, false)}
                </div>
              </div>

              <div style={{
                padding: '18px 20px',
                borderRadius: '10px',
                border: '1px solid #e2e8f0',
                background: '#ffffff'
              }}>
                <div style={{ fontSize: '13.5px', color: '#334155', fontWeight: 500, marginBottom: '6px' }}>
                  ITBIS al costo o gasto
                </div>
                <div style={{ fontSize: '26px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
                  {fmtCurrency(calc.itbis_al_costo_gasto, false)}
                </div>
              </div>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '14px',
              marginBottom: '22px'
            }}>
              <div style={{
                padding: '18px 20px',
                borderRadius: '10px',
                border: '1px solid #e2e8f0',
                background: '#ffffff'
              }}>
                <div style={{ fontSize: '13.5px', color: '#334155', fontWeight: 500, marginBottom: '6px' }}>
                  ITBIS generado
                </div>
                <div style={{ fontSize: '26px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
                  {fmtCurrency(calc.itbis_generado_ventas, true)}
                </div>
              </div>

              <div style={{
                padding: '18px 20px',
                borderRadius: '10px',
                border: '1px solid #e2e8f0',
                background: '#ffffff'
              }}>
                <div style={{ fontSize: '13.5px', color: '#334155', fontWeight: 500, marginBottom: '6px' }}>
                  ITBIS deducible
                </div>
                <div style={{ fontSize: '26px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
                  {fmtCurrency(calc.itbis_deducible, true)}
                </div>
              </div>

              <div style={{
                padding: '18px 20px',
                borderRadius: '10px',
                border: '1px solid #e2e8f0',
                background: '#ffffff'
              }}>
                <div style={{ fontSize: '13.5px', color: '#334155', fontWeight: 500, marginBottom: '6px' }}>
                  {calc.tipo_resultado === 'a_favor' ? 'Saldo a favor' : 'Resultado a pagar'}
                </div>
                <div style={{ fontSize: '26px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
                  {fmtCurrency(calc.tipo_resultado === 'a_favor' ? calc.saldo_a_favor : calc.resultado_a_pagar, true)}
                </div>
              </div>
            </div>
          )}

          {/* SUB-PESTAÑAS: RESUMEN | ANEXO A | FORMULARIO IT-1 */}
          <div style={{
            display: 'flex',
            gap: '28px',
            borderBottom: '1px solid #e2e8f0',
            marginBottom: '20px'
          }}>
            {[
              { id: 'resumen', label: 'Resumen' },
              { id: 'anexo_a', label: 'Anexo A' },
              { id: 'it1', label: 'Formulario IT-1' }
            ].map(t => {
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderBottom: isActive ? '3px solid #0891b2' : '3px solid transparent',
                    padding: '8px 4px 12px',
                    fontSize: '15px',
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? '#0f172a' : '#475569',
                    cursor: 'pointer'
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* CONTENIDO DE PESTAÑA: RESUMEN */}
          {activeTab === 'resumen' && (
            <>
              {isExento ? (
                /* MODO EXENTO (Imagen 2) */
                <div>
                  <div style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    overflow: 'hidden',
                    marginBottom: '16px'
                  }}>
                    <div style={{
                      background: '#f8fafc',
                      padding: '14px 18px',
                      borderBottom: '1px solid #e2e8f0',
                      fontSize: '16.5px',
                      fontWeight: 800,
                      color: '#0f172a'
                    }}>
                      Tratamiento del período
                    </div>

                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '14px 18px',
                      borderBottom: '1px solid #f1f5f9',
                      fontSize: '14.5px',
                      color: '#1e293b'
                    }}>
                      <span>ITBIS generado en ventas</span>
                      <span style={{ fontWeight: 600 }}>RD$ 0.00</span>
                    </div>

                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '14px 18px',
                      fontSize: '14.5px',
                      color: '#1e293b'
                    }}>
                      <span>ITBIS acreditable de estas compras</span>
                      <span style={{ fontWeight: 600 }}>RD$ 0.00</span>
                    </div>
                  </div>

                  {/* Alerta informativa azul homologada */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    padding: '14px 18px',
                    background: '#eff6ff',
                    border: '1px solid #dbeafe',
                    borderRadius: '10px',
                    marginBottom: '16px',
                    color: '#1e3a8a',
                    fontSize: '14px',
                    lineHeight: 1.5
                  }}>
                    <div style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      background: '#2563eb',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      marginTop: '1px',
                      fontWeight: 700,
                      fontSize: '13px'
                    }}>
                      i
                    </div>
                    <div>
                      El ITBIS de compras destinadas a servicios exentos se lleva al costo o gasto.
                      <br />
                      No genera saldo a favor por estas compras.
                    </div>
                  </div>

                  {/* + Retenciones y otros ajustes */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '12px',
                    padding: '14px 18px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    marginBottom: '22px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        background: '#e0f2fe',
                        color: '#0369a1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <Plus size={16} strokeWidth={2.5} />
                      </div>
                      <span style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                        Retenciones y otros ajustes
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {isComplementReviewed ? (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '5px 12px',
                          borderRadius: '999px',
                          background: '#dcfce7',
                          color: '#15803d',
                          fontSize: '12.5px',
                          fontWeight: 600
                        }}>
                          <CheckCircle2 size={14} />
                          Confirmado
                        </span>
                      ) : (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '5px 12px',
                          borderRadius: '999px',
                          background: '#fef3c7',
                          color: '#b45309',
                          fontSize: '12.5px',
                          fontWeight: 600
                        }}>
                          <AlertCircle size={14} />
                          Pendiente de revisión
                        </span>
                      )}

                      <button
                        onClick={() => setShowComplementModal(true)}
                        style={{
                          padding: '7px 18px',
                          background: '#ffffff',
                          border: '1px solid #94a3b8',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: 600,
                          color: '#0f172a',
                          cursor: 'pointer'
                        }}
                      >
                        Revisar
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* MODO GRAVADO (Imagen 1) */
                <div>
                  <div style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    overflow: 'hidden',
                    marginBottom: '18px'
                  }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                          <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '13.5px', fontWeight: 700, color: '#0f172a' }}>
                            Concepto
                          </th>
                          <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '13.5px', fontWeight: 700, color: '#0f172a' }}>
                            Origen
                          </th>
                          <th style={{ textAlign: 'right', padding: '12px 18px', fontSize: '13.5px', fontWeight: 700, color: '#0f172a' }}>
                            Monto
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '13px 18px', fontSize: '14.5px', color: '#1e293b' }}>
                            ITBIS generado en ventas
                          </td>
                          <td style={{ padding: '13px 18px', fontSize: '14px', color: '#334155' }}>
                            607
                          </td>
                          <td style={{ padding: '13px 18px', fontSize: '14.5px', color: '#0f172a', textAlign: 'right', fontWeight: 500 }}>
                            {fmtCurrency(calc.itbis_generado_ventas, true)}
                          </td>
                        </tr>

                        <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '13px 18px', fontSize: '14.5px', color: '#1e293b' }}>
                            ITBIS deducible en compras y servicios
                          </td>
                          <td style={{ padding: '13px 18px', fontSize: '14px', color: '#334155' }}>
                            606 / Anexo A
                          </td>
                          <td style={{ padding: '13px 18px', fontSize: '14.5px', color: '#0f172a', textAlign: 'right', fontWeight: 500 }}>
                            {fmtCurrency(calc.itbis_deducible, true)}
                          </td>
                        </tr>

                        <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '13px 18px', fontSize: '14.5px', color: '#1e293b' }}>
                            Saldo a favor anterior
                          </td>
                          <td style={{ padding: '13px 18px', fontSize: '14px', color: '#334155' }}>
                            Período anterior
                          </td>
                          <td style={{ padding: '13px 18px', fontSize: '14.5px', color: '#0f172a', textAlign: 'right', fontWeight: 500 }}>
                            {fmtCurrency(calc.saldo_favor_anterior, true)}
                          </td>
                        </tr>

                        <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                          <td style={{ padding: '13px 18px', fontSize: '14.5px', color: '#1e293b' }}>
                            Retenciones y otros ajustes aplicables
                          </td>
                          <td style={{ padding: '13px 18px', fontSize: '14px', color: '#334155' }}>
                            Complementos
                          </td>
                          <td style={{ padding: '13px 18px', fontSize: '14.5px', color: '#0f172a', textAlign: 'right', fontWeight: 500 }}>
                            {fmtCurrency(calc.retenciones_y_ajustes, true)}
                          </td>
                        </tr>

                        <tr style={{ background: '#eff6ff' }}>
                          <td colSpan={2} style={{ padding: '16px 18px', fontSize: '17px', fontWeight: 800, color: '#0f172a' }}>
                            {calc.tipo_resultado === 'a_favor' ? 'Saldo a favor del período' : 'Resultado a pagar'}
                          </td>
                          <td style={{ padding: '16px 18px', fontSize: '22px', fontWeight: 800, color: '#0f172a', textAlign: 'right' }}>
                            {fmtCurrency(calc.tipo_resultado === 'a_favor' ? calc.saldo_a_favor : calc.resultado_a_pagar, true)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Caja + Datos complementarios */}
                  <div style={{
                    padding: '16px 18px',
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    marginBottom: '22px'
                  }}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '12px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                          width: '30px',
                          height: '30px',
                          borderRadius: '50%',
                          background: '#e0f2fe',
                          color: '#0369a1',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          <Plus size={17} strokeWidth={2.5} />
                        </div>
                        <div>
                          <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                            Datos complementarios
                          </div>
                          <div style={{ fontSize: '13px', color: '#64748b' }}>
                            Saldo anterior, importaciones, retenciones y ajustes
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => setShowComplementModal(true)}
                        style={{
                          padding: '8px 20px',
                          background: '#ffffff',
                          border: '1px solid #94a3b8',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: 600,
                          color: '#0f172a',
                          cursor: 'pointer'
                        }}
                      >
                        Revisar
                      </button>
                    </div>

                    {!isComplementReviewed && (
                      <div style={{
                        marginTop: '14px',
                        padding: '11px 14px',
                        background: '#fffbeb',
                        border: '1px solid #fde68a',
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        fontSize: '13.5px',
                        color: '#92400e'
                      }}>
                        <AlertCircle size={16} color="#d97706" />
                        <span>
                          <strong>Pendiente de revisión:</strong> confirmar datos complementarios.
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* CONTENIDO DE PESTAÑA: ANEXO A */}
          {activeTab === 'anexo_a' && (
            <div style={{ marginBottom: '22px' }}>
              {/* Casilla I: 607 por Tipo de Comprobante */}
              <div style={{
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                overflow: 'hidden',
                marginBottom: '18px'
              }}>
                <div style={{
                  background: '#f8fafc',
                  padding: '12px 18px',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '14.5px',
                  fontWeight: 800,
                  color: '#0f172a'
                }}>
                  I. Operaciones reportadas en el 607 por Tipo de Comprobante Fiscal (e-CF / NCF)
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ textAlign: 'left', padding: '10px 18px', fontSize: '12.5px', color: '#475569' }}>Tipo de Comprobante</th>
                      <th style={{ textAlign: 'center', padding: '10px 18px', fontSize: '12.5px', color: '#475569' }}>Cantidad</th>
                      <th style={{ textAlign: 'right', padding: '10px 18px', fontSize: '12.5px', color: '#475569' }}>Monto Facturado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(s607.por_ncf || {}).map(([key, item]) => (
                      <tr key={key} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '11px 18px', fontSize: '13.5px', color: '#1e293b' }}>{item.nombre}</td>
                        <td style={{ padding: '11px 18px', fontSize: '13.5px', color: '#334155', textAlign: 'center', fontWeight: 600 }}>{item.cantidad}</td>
                        <td style={{
                          padding: '11px 18px',
                          fontSize: '13.5px',
                          color: key === 'notas_credito' && item.monto > 0 ? '#dc2626' : '#0f172a',
                          textAlign: 'right',
                          fontWeight: 600
                        }}>
                          {key === 'notas_credito' && item.monto > 0 ? `- ${fmtCurrency(item.monto)}` : fmtCurrency(item.monto)}
                        </td>
                      </tr>
                    ))}
                    <tr style={{ background: '#eff6ff' }}>
                      <td style={{ padding: '12px 18px', fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
                        Casilla 11 · Total Operaciones del Período (Pasa a Casilla 1 del IT-1)
                      </td>
                      <td style={{ padding: '12px 18px', fontSize: '14px', fontWeight: 800, color: '#0f172a', textAlign: 'center' }}>
                        {s607.cantidad_registros || 0}
                      </td>
                      <td style={{ padding: '12px 18px', fontSize: '15px', fontWeight: 800, color: '#0f172a', textAlign: 'right' }}>
                        {fmtCurrency(s607.monto_total)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Casilla II: 607 por Modalidad de Cobro */}
              <div style={{
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                overflow: 'hidden',
                marginBottom: '18px'
              }}>
                <div style={{
                  background: '#f8fafc',
                  padding: '12px 18px',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '14.5px',
                  fontWeight: 800,
                  color: '#0f172a'
                }}>
                  II. Operaciones reportadas en el 607 por Tipo de Venta / Modalidad de Cobro
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {[
                      { casilla: '12', label: 'Efectivo', val: s607.por_tipo_venta?.efectivo || 0 },
                      { casilla: '13', label: 'Cheque / Transferencia / Depósito', val: s607.por_tipo_venta?.cheque_transferencia || 0 },
                      { casilla: '14', label: 'Tarjeta Débito / Crédito', val: s607.por_tipo_venta?.tarjeta || 0 },
                      { casilla: '15', label: 'A Crédito', val: s607.por_tipo_venta?.venta_credito || 0 },
                      { casilla: '16', label: 'Bonos o Certificados de Regalo', val: s607.por_tipo_venta?.bonos_certificados || 0 },
                      { casilla: '18', label: 'Otras Formas de Venta', val: s607.por_tipo_venta?.otras_formas || 0 }
                    ].map(row => (
                      <tr key={row.casilla} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 18px', fontSize: '13.5px', color: '#475569', width: '90px' }}>Casilla {row.casilla}</td>
                        <td style={{ padding: '10px 18px', fontSize: '13.5px', color: '#1e293b' }}>{row.label}</td>
                        <td style={{ padding: '10px 18px', fontSize: '13.5px', color: '#0f172a', textAlign: 'right', fontWeight: 600 }}>
                          {fmtCurrency(row.val)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Casilla V: Compras y Gastos 606 */}
              <div style={{
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                overflow: 'hidden'
              }}>
                <div style={{
                  background: '#f8fafc',
                  padding: '12px 18px',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '14.5px',
                  fontWeight: 800,
                  color: '#0f172a'
                }}>
                  V. Compras y Servicios Locales Reportados en el 606 ({s606.cantidad_registros || 0} facturas)
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '11px 18px', fontSize: '13.5px', color: '#1e293b' }}>Monto en Compras de Bienes (606)</td>
                      <td style={{ padding: '11px 18px', fontSize: '13.5px', color: '#0f172a', textAlign: 'right', fontWeight: 600 }}>
                        {fmtCurrency(s606.monto_bienes)}
                      </td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '11px 18px', fontSize: '13.5px', color: '#1e293b' }}>Monto en Compras de Servicios (606)</td>
                      <td style={{ padding: '11px 18px', fontSize: '13.5px', color: '#0f172a', textAlign: 'right', fontWeight: 600 }}>
                        {fmtCurrency(s606.monto_servicios)}
                      </td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '11px 18px', fontSize: '13.5px', color: '#1e293b' }}>Total Facturado en Compras (606)</td>
                      <td style={{ padding: '11px 18px', fontSize: '13.5px', color: '#0f172a', textAlign: 'right', fontWeight: 700 }}>
                        {fmtCurrency(s606.total_facturado)}
                      </td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '11px 18px', fontSize: '13.5px', color: '#1e293b' }}>ITBIS Facturado en Compras (606)</td>
                      <td style={{ padding: '11px 18px', fontSize: '13.5px', color: '#0f172a', textAlign: 'right', fontWeight: 700 }}>
                        {fmtCurrency(s606.itbis_facturado)}
                      </td>
                    </tr>
                    <tr style={{ background: '#f8fafc' }}>
                      <td style={{ padding: '12px 18px', fontSize: '13.5px', fontWeight: 700, color: '#0f172a' }}>
                        {isExento
                          ? 'ITBIS Llevado al Costo o Gasto (Operaciones Exentas)'
                          : 'ITBIS Deducible / Acreditable (Pasa a Casilla 22 del IT-1)'}
                      </td>
                      <td style={{ padding: '12px 18px', fontSize: '14.5px', fontWeight: 800, color: '#0891b2', textAlign: 'right' }}>
                        {fmtCurrency(isExento ? calc.itbis_al_costo_gasto : calc.itbis_deducible)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* CONTENIDO DE PESTAÑA: FORMULARIO IT-1 */}
          {activeTab === 'it1' && (
            <div style={{
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              overflow: 'hidden',
              marginBottom: '22px'
            }}>
              <div style={{
                background: '#f8fafc',
                padding: '13px 18px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                  Formulario Oficial DGII IT-1 ({isExento ? 'Régimen Exento' : 'Régimen Gravado'})
                </span>
                <span style={{ fontSize: '12.5px', color: '#475569', fontWeight: 600 }}>
                  RNC: {it1Data.settings?.rnc || '131917038'} · Período: {it1Data.periodo}
                </span>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: '12.5px', color: '#475569', width: '90px' }}>Casilla</th>
                    <th style={{ textAlign: 'left', padding: '10px 16px', fontSize: '12.5px', color: '#475569' }}>Concepto del Formulario IT-1</th>
                    <th style={{ textAlign: 'right', padding: '10px 16px', fontSize: '12.5px', color: '#475569', width: '180px' }}>Monto (RD$)</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { c: '1', label: 'TOTAL DE OPERACIONES DEL PERÍODO (Viene de Casilla 11 del Anexo A)', val: calc.ventas_totales, bold: true },
                    { c: '9', label: 'Operaciones No Gravadas por Servicios Exentos (Destino Local)', val: isExento ? calc.ventas_exentas : 0 },
                    { c: '10', label: 'TOTAL OPERACIONES NO GRAVADAS / EXENTAS', val: isExento ? calc.ventas_exentas : 0, bold: true },
                    { c: '11', label: 'TOTAL OPERACIONES GRAVADAS (Casilla 1 - Casilla 10)', val: isExento ? 0 : calc.ventas_gravadas, bold: true },
                    { c: '16', label: 'ITBIS COBRADO (18% sobre Operaciones Gravadas)', val: calc.itbis_generado_ventas },
                    { c: '22', label: 'ITBIS Pagado en Compras Locales Deducible (606)', val: calc.itbis_deducible },
                    { c: '33', label: 'TOTAL ITBIS DEDUCIBLE', val: calc.itbis_deducible, bold: true },
                    { c: '36', label: 'Saldo a Favor Anterior', val: calc.saldo_favor_anterior },
                    { c: '37-38', label: 'Pagos Computables por Retenciones / Importaciones / Ajustes', val: calc.retenciones_y_ajustes },
                    { c: '39', label: 'DIFERENCIA A PAGAR', val: calc.resultado_a_pagar, highlight: true },
                    { c: '40', label: 'NUEVO SALDO A FAVOR', val: calc.saldo_a_favor, highlight: calc.saldo_a_favor > 0 }
                  ].map((r) => (
                    <tr
                      key={r.c}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        background: r.highlight ? '#eff6ff' : 'transparent'
                      }}
                    >
                      <td style={{ padding: '11px 16px', fontSize: '13px', fontWeight: 700, color: '#0369a1' }}>
                        Casilla {r.c}
                      </td>
                      <td style={{ padding: '11px 16px', fontSize: '13.5px', fontWeight: r.bold || r.highlight ? 700 : 500, color: '#0f172a' }}>
                        {r.label}
                      </td>
                      <td style={{ padding: '11px 16px', fontSize: '14px', fontWeight: r.bold || r.highlight ? 800 : 600, color: '#0f172a', textAlign: 'right' }}>
                        {fmtCurrency(r.val, true)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* BARRA INFERIOR DE ACCIONES: GUARDAR BORRADOR | MARCAR COMO REVISADO | EXPORTAR */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
            paddingTop: '4px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <button
                onClick={() => handleSaveDeclaration('Borrador')}
                disabled={saving}
                style={{
                  padding: '11px 22px',
                  background: '#ffffff',
                  border: '1px solid #0284c7',
                  borderRadius: '8px',
                  color: '#0f172a',
                  fontSize: '14.5px',
                  fontWeight: 700,
                  cursor: saving ? 'wait' : 'pointer'
                }}
              >
                Guardar borrador
              </button>

              <button
                onClick={() => handleSaveDeclaration('Revisado', true)}
                disabled={saving}
                style={{
                  padding: '11px 24px',
                  background: '#0891b2',
                  border: '1px solid #0891b2',
                  borderRadius: '8px',
                  color: '#ffffff',
                  fontSize: '14.5px',
                  fontWeight: 700,
                  cursor: saving ? 'wait' : 'pointer'
                }}
              >
                Marcar como revisado
              </button>
            </div>

            {/* Menú desplegable Exportar */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowExportMenu(prev => !prev)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '11px 20px',
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  color: '#0f172a',
                  fontSize: '14.5px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <span>Exportar</span>
                <ChevronDown size={16} />
              </button>

              {showExportMenu && (
                <div style={{
                  position: 'absolute',
                  right: 0,
                  bottom: 'calc(100% + 8px)',
                  width: '280px',
                  background: '#ffffff',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  boxShadow: '0 10px 25px rgba(15, 23, 42, 0.14)',
                  zIndex: 50,
                  overflow: 'hidden'
                }}>
                  <button
                    onClick={handleExportExcel}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid #f1f5f9',
                      textAlign: 'left',
                      fontSize: '13.5px',
                      fontWeight: 600,
                      color: '#0f172a',
                      cursor: 'pointer'
                    }}
                  >
                    <FileSpreadsheet size={16} color="#16a34a" />
                    <span>Excel Oficial DGII (.xlsx) — IT-1 y Anexo A</span>
                  </button>

                  <button
                    onClick={handleExportCSV}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid #f1f5f9',
                      textAlign: 'left',
                      fontSize: '13.5px',
                      fontWeight: 600,
                      color: '#0f172a',
                      cursor: 'pointer'
                    }}
                  >
                    <Download size={16} color="#0284c7" />
                    <span>Exportar CSV Oficina Virtual (.csv)</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowExportMenu(false);
                      window.print();
                    }}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      background: 'transparent',
                      border: 'none',
                      textAlign: 'left',
                      fontSize: '13.5px',
                      fontWeight: 600,
                      color: '#0f172a',
                      cursor: 'pointer'
                    }}
                  >
                    <Printer size={16} color="#475569" />
                    <span>Imprimir / Guardar PDF</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div style={{
            marginTop: '12px',
            fontSize: '12.5px',
            color: '#64748b'
          }}>
            Preparación interna. Presentación en la Oficina Virtual de la DGII.
          </div>
        </div>

        {/* TARJETA INFERIOR: PERÍODOS GUARDADOS */}
        <div style={{
          background: '#ffffff',
          borderRadius: '14px',
          border: '1px solid #e2e8f0',
          padding: '24px',
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.03)'
        }}>
          <h2 style={{
            fontSize: '21px',
            fontWeight: 800,
            color: '#0f172a',
            margin: '0 0 16px 0'
          }}>
            Períodos guardados
          </h2>

          <div style={{
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            overflow: 'hidden'
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '13.5px', fontWeight: 700, color: '#0f172a' }}>
                    Período
                  </th>
                  {!isExento && (
                    <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '13.5px', fontWeight: 700, color: '#0f172a' }}>
                      Resultado
                    </th>
                  )}
                  <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '13.5px', fontWeight: 700, color: '#0f172a' }}>
                    Estado
                  </th>
                  <th style={{ textAlign: 'left', padding: '12px 18px', fontSize: '13.5px', fontWeight: 700, color: '#0f172a' }}>
                    Acción
                  </th>
                </tr>
              </thead>
              <tbody>
                {(it1Data.savedPeriods && it1Data.savedPeriods.length > 0) ? (
                  it1Data.savedPeriods.map((sp) => {
                    const isRev = sp.estado === 'Revisado';
                    const resMonto = Number(sp.snapshot_resultado || 0);
                    const resLabel = sp.snapshot_tipo_resultado === 'a_favor'
                      ? `${fmtCurrency(resMonto, true)} a favor`
                      : `${fmtCurrency(resMonto, true)} a pagar`;

                    return (
                      <tr key={sp.id || sp.periodo} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '14px 18px', fontSize: '14.5px', color: '#0f172a', fontWeight: 500 }}>
                          {formatPeriodoLabel(sp.periodo)}
                        </td>
                        {!isExento && (
                          <td style={{ padding: '14px 18px', fontSize: '14.5px', color: '#1e293b' }}>
                            {resLabel}
                          </td>
                        )}
                        <td style={{ padding: '14px 18px' }}>
                          <span style={{
                            padding: '4px 14px',
                            borderRadius: '999px',
                            fontSize: '12.5px',
                            fontWeight: 700,
                            background: isRev ? '#dcfce7' : '#fef3c7',
                            color: isRev ? '#15803d' : '#b45309'
                          }}>
                            {sp.estado || 'Borrador'}
                          </span>
                        </td>
                        <td style={{ padding: '14px 18px' }}>
                          <button
                            onClick={() => handleLoadSavedPeriod(sp)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#0284c7',
                              fontSize: '14px',
                              fontWeight: 600,
                              textDecoration: 'underline',
                              cursor: 'pointer',
                              padding: 0
                            }}
                          >
                            Ver
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={isExento ? 3 : 4} style={{ padding: '20px 18px', fontSize: '14px', color: '#64748b', textAlign: 'center' }}>
                      Aún no hay períodos guardados. Haz clic en <strong>Guardar borrador</strong> o <strong>Marcar como revisado</strong> para registrar el período actual.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* MODAL DE CONFIGURACIÓN FISCAL: EMPRESA EXENTA VS EMPRESA GRAVADA */}
      {showConfigModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.55)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '16px'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            maxWidth: '520px',
            width: '100%',
            padding: '24px',
            boxShadow: '0 20px 40px rgba(15, 23, 42, 0.2)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '19px', fontWeight: 800, color: '#0f172a' }}>
                Configuración de Régimen Fiscal ITBIS (IT-1)
              </h3>
              <button
                onClick={() => setShowConfigModal(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b' }}
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '14px', color: '#475569', marginTop: 0, marginBottom: '18px', lineHeight: 1.5 }}>
              Selecciona el tratamiento fiscal de ITBIS que aplica a la empresa para adaptar automáticamente el formulario IT-1:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '22px' }}>
              {/* Opción 1: Exenta */}
              <div
                onClick={() => setConfigRegimen('exento')}
                style={{
                  padding: '16px',
                  borderRadius: '12px',
                  border: configRegimen === 'exento' ? '2px solid #0891b2' : '1px solid #cbd5e1',
                  background: configRegimen === 'exento' ? '#f0fdfa' : '#ffffff',
                  cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                    Operaciones: Servicios Exentos (Rubro Salón / Belleza)
                  </span>
                  {configRegimen === 'exento' && <Check size={18} color="#0891b2" strokeWidth={3} />}
                </div>
                <p style={{ margin: 0, fontSize: '13px', color: '#475569', lineHeight: 1.45 }}>
                  Las ventas del 607 se declaran como exentas de ITBIS y el ITBIS pagado en compras (606) se lleva directamente al costo o gasto.
                </p>
              </div>

              {/* Opción 2: Gravada */}
              <div
                onClick={() => setConfigRegimen('gravado')}
                style={{
                  padding: '16px',
                  borderRadius: '12px',
                  border: configRegimen === 'gravado' ? '2px solid #0891b2' : '1px solid #cbd5e1',
                  background: configRegimen === 'gravado' ? '#f0fdfa' : '#ffffff',
                  cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                    Empresa Gravada (Genera ITBIS en las Ventas)
                  </span>
                  {configRegimen === 'gravado' && <Check size={18} color="#0891b2" strokeWidth={3} />}
                </div>
                <p style={{ margin: 0, fontSize: '13px', color: '#475569', lineHeight: 1.45 }}>
                  Calcula el ITBIS generado en ventas (607) menos el ITBIS deducible en compras y servicios (606) para determinar el resultado a pagar o saldo a favor.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={() => setShowConfigModal(false)}
                style={{
                  padding: '10px 18px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Cancelar
              </button>
              <button
                onClick={() => handleSaveSettings(configRegimen)}
                disabled={saving}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#0891b2',
                  color: '#ffffff',
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: saving ? 'wait' : 'pointer'
                }}
              >
                {saving ? 'Guardando...' : 'Aplicar formulario'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE REVISIÓN: RETENCIONES, SALDO ANTERIOR Y DATOS COMPLEMENTARIOS */}
      {showComplementModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.55)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '16px'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            maxWidth: '520px',
            width: '100%',
            padding: '24px',
            boxShadow: '0 20px 40px rgba(15, 23, 42, 0.2)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '19px', fontWeight: 800, color: '#0f172a' }}>
                {isExento ? 'Retenciones y otros ajustes' : 'Datos complementarios del período'}
              </h3>
              <button
                onClick={() => setShowComplementModal(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
              {!isExento && (
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '5px' }}>
                    Saldo a favor del período anterior (Casilla 36) — RD$
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={compForm.saldo_favor_anterior}
                    onChange={(e) => setCompForm({ ...compForm, saldo_favor_anterior: e.target.value })}
                    style={{
                      width: '100%',
                      height: '40px',
                      padding: '0 12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '14px'
                    }}
                  />
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '5px' }}>
                  Retenciones por compañías de adquirencia / tarjetas (Norma 08-04) — RD$
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={compForm.retenciones_tarjetas}
                  onChange={(e) => setCompForm({ ...compForm, retenciones_tarjetas: e.target.value })}
                  style={{
                    width: '100%',
                    height: '40px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '5px' }}>
                  Otras retenciones o pagos computables a cuenta — RD$
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={compForm.retenciones_terceros}
                  onChange={(e) => setCompForm({ ...compForm, retenciones_terceros: e.target.value })}
                  style={{
                    width: '100%',
                    height: '40px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '5px' }}>
                  Otros ajustes aplicables del período — RD$
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={compForm.otros_ajustes}
                  onChange={(e) => setCompForm({ ...compForm, otros_ajustes: e.target.value })}
                  style={{
                    width: '100%',
                    height: '40px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '5px' }}>
                  Notas u observaciones contables
                </label>
                <textarea
                  rows={2}
                  value={compForm.notas}
                  onChange={(e) => setCompForm({ ...compForm, notas: e.target.value })}
                  placeholder="Opcional: observaciones para la presentación en la Oficina Virtual DGII..."
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13.5px',
                    resize: 'vertical'
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={() => setShowComplementModal(false)}
                style={{
                  padding: '10px 18px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Cancelar
              </button>
              <button
                onClick={() => handleSaveDeclaration(decl.estado || 'Borrador', true)}
                disabled={saving}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#0891b2',
                  color: '#ffffff',
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: saving ? 'wait' : 'pointer'
                }}
              >
                Confirmar y guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

