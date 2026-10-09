import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { 
  FileSpreadsheet, Download, Printer, Search, RefreshCw, 
  Calendar, Landmark, Filter, CheckCircle2, AlertCircle, FileText, 
  ChevronDown, ChevronUp, Plus, MoreVertical, Trash2, Edit3, X, Check,
  AlertTriangle, Copy, ArrowRight, ShieldCheck, HelpCircle, Eye
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useNotification } from '../../context/NotificationContext';

export default function Reporte606Module() {
  const { showNotification } = useNotification();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('facturas'); // 'facturas' | 'archivos'
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [openActionMenuId, setOpenActionMenuId] = useState(null);
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [validationResults, setValidationResults] = useState(null);
  const [isValidating, setIsValidating] = useState(false);
  const [supplierSuggestion, setSupplierSuggestion] = useState(null);

  // Month & Year state
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(() => String(now.getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState(() => String(now.getMonth() + 1).padStart(2, '0'));
  const [searchTerm, setSearchTerm] = useState('');

  const currentPeriod = `${selectedYear}${selectedMonth}`;

  // Form State
  const initialFormState = {
    rnc_cedula: '',
    tipo_id: 1,
    proveedor: '',
    ncf: '',
    ncf_modificado: '',
    fecha_factura: new Date().toISOString().slice(0, 10),
    fecha_pago: new Date().toISOString().slice(0, 10),
    clasificacion_gasto: '02 - Gastos por trabajos, suministros y servicios',
    tipo_bienes_servicios: '02',
    tipo_compra: 'Bienes', // 'Bienes' | 'Servicios' | 'Ambos'
    monto_sin_impuestos: '',
    itbis_facturado: '',
    forma_pago: '02', // 02 = Transferencia / Depósito
    // Más opciones
    itbis_retenido: '',
    tipo_retencion_isr: '',
    isr_retenido: '',
    isc: '',
    otros_impuestos: '',
    propina_legal: '',
    itbis_proporcionalidad: '',
    itbis_costo: '',
    itbis_adelantar: '',
    notas: ''
  };

  const [formData, setFormData] = useState(initialFormState);
  const [reportData, setReportData] = useState({
    header: {
      empresa: 'ETEREAS SRL',
      rnc: '131917038',
      periodo: currentPeriod,
      cantidad_registros: 0,
      facturas_por_revisar: 0,
      fecha_impresion: new Date().toLocaleDateString('es-DO')
    },
    records: [],
    totals: {}
  });

  const formRef = useRef(null);

  // Fetch Report Data
  const fetchReport = async () => {
    setLoading(true);
    try {
      const res = await dataService.getReporte606(currentPeriod, { search: searchTerm });
      if (res && res.success) {
        setReportData(res);
      } else {
        setReportData({
          header: {
            empresa: 'ETEREAS SRL',
            rnc: '131917038',
            periodo: currentPeriod,
            cantidad_registros: 0,
            facturas_por_revisar: 0,
            fecha_impresion: new Date().toLocaleDateString('es-DO')
          },
          records: [],
          totals: {}
        });
      }
    } catch (err) {
      console.error('Error fetching Reporte 606:', err);
      showNotification('Error al cargar datos del Reporte 606', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [selectedYear, selectedMonth, searchTerm]);

  // Autocompletar proveedor al escribir o salir del campo RNC
  const handleRncBlur = async () => {
    const clean = formData.rnc_cedula.replace(/\D/g, '');
    if (clean.length >= 9 && !formData.proveedor) {
      try {
        const res = await dataService.searchReporte606Supplier(clean);
        if (res && res.found && res.supplier) {
          setSupplierSuggestion(res.supplier);
          setFormData(prev => ({
            ...prev,
            proveedor: res.supplier.proveedor || prev.proveedor,
            clasificacion_gasto: res.supplier.clasificacion_gasto || prev.clasificacion_gasto,
            forma_pago: res.supplier.forma_pago || prev.forma_pago,
            tipo_compra: res.supplier.tipo_compra || prev.tipo_compra
          }));
          showNotification(`Proveedor frecuente detectado: ${res.supplier.proveedor}`, 'info');
        }
      } catch (e) {
        // Silencioso
      }
    }
  };

  // Manejar cambio en Monto sin impuestos para auto-calcular ITBIS (18%)
  const handleMontoSinImpuestosChange = (val) => {
    const rawNum = parseFloat(val) || 0;
    const itbisCalculated = (rawNum * 0.18).toFixed(2);
    setFormData(prev => ({
      ...prev,
      monto_sin_impuestos: val,
      itbis_facturado: itbisCalculated > 0 ? itbisCalculated : ''
    }));
  };

  // Cálculo de total del comprobante en tiempo real
  const totalComprobante = useMemo(() => {
    const monto = parseFloat(formData.monto_sin_impuestos) || 0;
    const itbis = parseFloat(formData.itbis_facturado) || 0;
    const isc = parseFloat(formData.isc) || 0;
    const otros = parseFloat(formData.otros_impuestos) || 0;
    const propina = parseFloat(formData.propina_legal) || 0;
    return (monto + itbis + isc + otros + propina).toFixed(2);
  }, [formData.monto_sin_impuestos, formData.itbis_facturado, formData.isc, formData.otros_impuestos, formData.propina_legal]);

  // Guardar Factura
  const handleSave = async (stayInForm = false) => {
    if (!formData.rnc_cedula || !formData.proveedor) {
      showNotification('Por favor ingrese el RNC/Cédula y el nombre del Proveedor.', 'warning');
      return;
    }
    if (!formData.monto_sin_impuestos || parseFloat(formData.monto_sin_impuestos) <= 0) {
      showNotification('Por favor ingrese el monto facturado sin impuestos.', 'warning');
      return;
    }

    try {
      const payload = {
        periodo: currentPeriod,
        rnc_cedula: formData.rnc_cedula,
        proveedor: formData.proveedor,
        ncf: formData.ncf || 'PENDIENTE',
        ncf_modificado: formData.ncf_modificado,
        fecha_factura: formData.fecha_factura,
        fecha_pago: formData.fecha_pago,
        clasificacion_gasto: formData.clasificacion_gasto,
        tipo_bienes_servicios: formData.clasificacion_gasto.slice(0, 2),
        tipo_compra: formData.tipo_compra,
        monto_sin_impuestos: parseFloat(formData.monto_sin_impuestos) || 0,
        itbis_facturado: parseFloat(formData.itbis_facturado) || 0,
        itbis_retenido: parseFloat(formData.itbis_retenido) || 0,
        tipo_retencion_isr: formData.tipo_retencion_isr,
        isr_retenido: parseFloat(formData.isr_retenido) || 0,
        isc: parseFloat(formData.isc) || 0,
        otros_impuestos: parseFloat(formData.otros_impuestos) || 0,
        propina_legal: parseFloat(formData.propina_legal) || 0,
        forma_pago: formData.forma_pago,
        itbis_proporcionalidad: parseFloat(formData.itbis_proporcionalidad) || 0,
        itbis_costo: parseFloat(formData.itbis_costo) || 0,
        itbis_adelantar: parseFloat(formData.itbis_adelantar) || 0,
        notas: formData.notas
      };

      if (editingId) {
        await dataService.updateReporte606Record(editingId, payload);
        showNotification('Factura de compra actualizada exitosamente', 'success');
        setEditingId(null);
      } else {
        await dataService.createReporte606Record(payload);
        showNotification('Factura de compra registrada exitosamente en 606', 'success');
      }

      await fetchReport();

      if (stayInForm) {
        setFormData({
          ...initialFormState,
          fecha_factura: formData.fecha_factura,
          fecha_pago: formData.fecha_pago,
          forma_pago: formData.forma_pago,
          clasificacion_gasto: formData.clasificacion_gasto
        });
      } else {
        setFormData(initialFormState);
      }
    } catch (err) {
      console.error('Error saving 606:', err);
      showNotification(err.message || 'Error al guardar factura', 'error');
    }
  };

  // Editar factura
  const handleEdit = (record) => {
    setEditingId(record.id);
    setFormData({
      rnc_cedula: record.rnc_cedula || '',
      tipo_id: record.tipo_id || 1,
      proveedor: record.proveedor || '',
      ncf: record.ncf || '',
      ncf_modificado: record.ncf_modificado || '',
      fecha_factura: record.fecha_factura ? record.fecha_factura.slice(0, 10) : new Date().toISOString().slice(0, 10),
      fecha_pago: record.fecha_pago ? record.fecha_pago.slice(0, 10) : new Date().toISOString().slice(0, 10),
      clasificacion_gasto: record.clasificacion_gasto || '02 - Gastos por trabajos, suministros y servicios',
      tipo_bienes_servicios: record.tipo_bienes_servicios || '02',
      tipo_compra: record.tipo_compra || 'Bienes',
      monto_sin_impuestos: String(record.total_facturado || ''),
      itbis_facturado: String(record.itbis_facturado || ''),
      forma_pago: record.forma_pago || '02',
      itbis_retenido: record.itbis_retenido ? String(record.itbis_retenido) : '',
      tipo_retencion_isr: record.tipo_retencion_isr || '',
      isr_retenido: record.isr_retenido ? String(record.isr_retenido) : '',
      isc: record.isc ? String(record.isc) : '',
      otros_impuestos: record.otros_impuestos ? String(record.otros_impuestos) : '',
      propina_legal: record.propina_legal ? String(record.propina_legal) : '',
      itbis_proporcionalidad: record.itbis_proporcionalidad ? String(record.itbis_proporcionalidad) : '',
      itbis_costo: record.itbis_costo ? String(record.itbis_costo) : '',
      itbis_adelantar: record.itbis_adelantar ? String(record.itbis_adelantar) : '',
      notas: record.notas || ''
    });
    setOpenActionMenuId(null);
    if (formRef.current) {
      formRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Eliminar factura
  const handleDelete = async (id) => {
    if (!window.confirm('¿Está seguro de eliminar esta factura del Reporte 606?')) return;
    try {
      await dataService.deleteReporte606Record(id);
      showNotification('Factura eliminada correctamente', 'success');
      setOpenActionMenuId(null);
      fetchReport();
    } catch (err) {
      showNotification('Error al eliminar factura', 'error');
    }
  };

  // Validación por lote de período completo
  const handleValidatePeriod = async () => {
    setIsValidating(true);
    try {
      const res = await dataService.validateReporte606Period(currentPeriod);
      setValidationResults(res);
      setShowValidationModal(true);
      await fetchReport();
      if (res.conErrores === 0) {
        showNotification('¡Excelente! Todas las facturas cumplen con las normativas de la DGII.', 'success');
      } else {
        showNotification(`Se encontraron ${res.conErrores} factura(s) con advertencias para revisión.`, 'warning');
      }
    } catch (err) {
      showNotification('Error al ejecutar validación de período', 'error');
    } finally {
      setIsValidating(false);
    }
  };

  // Exportar Excel Oficial DGII 606 (2 Hojas: Formato Oficial + Resumen Ejecutivo)
  const handleExportExcel = () => {
    try {
      const wb = XLSX.utils.book_new();

      // =========================================================================
      // HOJA 1: FORMATO OFICIAL DGII 606 (23 Columnas Normadas)
      // =========================================================================
      const dgiiHeaders = [
        'RNC o Cédula',
        'Tipo Identificación',
        'Tipo Bienes y Servicios Comprados',
        'NCF',
        'NCF Modificado',
        'Fecha Comprobante',
        'Fecha Pago',
        'Monto Facturado en Servicios',
        'Monto Facturado en Bienes',
        'Total Monto Facturado',
        'ITBIS Facturado',
        'ITBIS Retenido',
        'ITBIS Sujeto a Proporcionalidad',
        'ITBIS Llevado al Costo',
        'ITBIS por Adelantar',
        'ITBIS Percibido en Compras',
        'Tipo Retención Renta',
        'Monto Retención Renta',
        'ISR Percibido en Compras',
        'Impuesto Selectivo al Consumo',
        'Otros Impuestos/Tasas',
        'Monto Propina Legal',
        'Forma de Pago'
      ];

      const dgiiRows = reportData.records.map(r => {
        const cleanRnc = String(r.rnc_cedula || '').replace(/\D/g, '');
        const fComp = String(r.fecha_factura || '').replace(/-/g, '').slice(0, 8);
        const fPago = r.fecha_pago ? String(r.fecha_pago).replace(/-/g, '').slice(0, 8) : '';

        return [
          cleanRnc,
          r.tipo_id || 1,
          r.tipo_bienes_servicios || '02',
          r.ncf || '',
          r.ncf_modificado || '',
          fComp,
          fPago,
          Number(r.monto_servicios || 0),
          Number(r.monto_bienes || 0),
          Number(r.total_facturado || 0),
          Number(r.itbis_facturado || 0),
          Number(r.itbis_retenido || 0),
          Number(r.itbis_proporcionalidad || 0),
          Number(r.itbis_costo || 0),
          Number(r.itbis_adelantar || 0),
          Number(r.itbis_percibido || 0),
          r.tipo_retencion_isr || '',
          Number(r.isr_retenido || 0),
          Number(r.isr_percibido || 0),
          Number(r.isc || 0),
          Number(r.otros_impuestos || 0),
          Number(r.propina_legal || 0),
          r.forma_pago || '02'
        ];
      });

      const wsDgii = XLSX.utils.aoa_to_sheet([dgiiHeaders, ...dgiiRows]);
      XLSX.utils.book_append_sheet(wb, wsDgii, 'Formato 606 DGII');

      // =========================================================================
      // HOJA 2: RESUMEN EJECUTIVO DE COMPRAS Y PROVEEDORES
      // =========================================================================
      const summaryHeaders = ['ID', 'Fecha', 'Proveedor', 'RNC/Cédula', 'NCF', 'Clasificación', 'Subtotal', 'ITBIS', 'Total', 'Estado'];
      const summaryRows = reportData.records.map(r => [
        r.id,
        r.fecha_factura,
        r.proveedor,
        r.rnc_cedula,
        r.ncf,
        r.clasificacion_gasto,
        Number(r.total_facturado || 0),
        Number(r.itbis_facturado || 0),
        Number(r.total_facturado || 0) + Number(r.itbis_facturado || 0),
        r.estado
      ]);

      const wsSummary = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryRows]);
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen de Compras');

      const fileName = `DGII_Reporte_606_${currentPeriod}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, fileName);
      showNotification('Excel de Reporte 606 exportado exitosamente', 'success');
    } catch (err) {
      console.error('Error exportando Excel 606:', err);
      showNotification('Error al exportar Excel', 'error');
    }
  };

  // Descargar TXT Oficial
  const handleDownloadTxt = () => {
    const url = dataService.getReporte606TxtUrl(currentPeriod);
    window.open(url, '_blank');
  };

  // Meses en español
  const monthNamesLong = [
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

  const currentMonthObj = monthNamesLong.find(m => m.num === selectedMonth) || monthNamesLong[9];

  return (
    <div style={{ padding: '1.5rem 2rem 3rem 2rem', maxWidth: '1200px', margin: '0 auto', background: '#f8fafc', minHeight: '100vh' }}>
      
      {/* 1. Header principal */}
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.85rem', fontWeight: 900, color: '#09090b', margin: '0 0 0.25rem 0', letterSpacing: '-0.02em' }}>
          Reporte 606
        </h1>
        <p style={{ fontSize: '0.95rem', fontWeight: 600, color: '#475569', margin: '0 0 0.2rem 0' }}>
          Registro sencillo. Información organizada.
        </p>
        <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 500 }}>
          Normas Generales 07-2018 y 05-2019 · DGII República Dominicana
        </span>
      </div>

      {/* 2. CARD TOP: Nueva factura */}
      <div ref={formRef} style={{
        background: '#ffffff',
        borderRadius: '20px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 4px 16px rgba(0,0,0,0.03)',
        padding: '1.75rem',
        marginBottom: '2rem'
      }}>
        {/* Top bar of form */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 900, color: '#09090b', margin: 0 }}>
            {editingId ? 'Editar factura' : 'Nueva factura'}
          </h2>
          <div style={{
            background: '#eff6ff',
            color: '#1d4ed8',
            padding: '0.35rem 0.85rem',
            borderRadius: '10px',
            fontSize: '0.8rem',
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem'
          }}>
            <Calendar size={14} />
            <span>{currentMonthObj.name} {selectedYear}</span>
          </div>
        </div>

        {/* Inputs Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
          
          {/* RNC / Cédula */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#334155', marginBottom: '0.4rem' }}>
              RNC / Cédula
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                value={formData.rnc_cedula}
                onChange={(e) => setFormData({ ...formData, rnc_cedula: e.target.value })}
                onBlur={handleRncBlur}
                placeholder="131000001"
                style={{
                  width: '100%',
                  padding: '0.65rem 2.2rem 0.65rem 0.85rem',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  color: '#09090b',
                  outline: 'none'
                }}
              />
              <Search size={16} color="#94a3b8" style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)' }} />
            </div>
          </div>

          {/* Proveedor */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#334155', marginBottom: '0.4rem' }}>
              Proveedor
            </label>
            <input
              type="text"
              value={formData.proveedor}
              onChange={(e) => setFormData({ ...formData, proveedor: e.target.value })}
              placeholder="Distribuidora Ejemplo"
              style={{
                width: '100%',
                padding: '0.65rem 0.85rem',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                fontSize: '0.9rem',
                fontWeight: 600,
                color: '#09090b',
                outline: 'none'
              }}
            />
          </div>

          {/* NCF */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#334155', marginBottom: '0.4rem' }}>
              NCF
            </label>
            <input
              type="text"
              value={formData.ncf}
              onChange={(e) => setFormData({ ...formData, ncf: e.target.value.toUpperCase().replace(/\s/g, '') })}
              placeholder="B0100000123"
              style={{
                width: '100%',
                padding: '0.65rem 0.85rem',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                fontSize: '0.9rem',
                fontWeight: 600,
                color: '#09090b',
                outline: 'none',
                textTransform: 'uppercase'
              }}
            />
          </div>

          {/* Fecha de factura */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#334155', marginBottom: '0.4rem' }}>
              Fecha de factura
            </label>
            <input
              type="date"
              value={formData.fecha_factura}
              onChange={(e) => setFormData({ ...formData, fecha_factura: e.target.value })}
              style={{
                width: '100%',
                padding: '0.65rem 0.85rem',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                fontSize: '0.9rem',
                fontWeight: 600,
                color: '#09090b',
                outline: 'none'
              }}
            />
          </div>

          {/* Clasificación del gasto */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#334155', marginBottom: '0.4rem' }}>
              Clasificación del gasto
            </label>
            <select
              value={formData.clasificacion_gasto}
              onChange={(e) => setFormData({ ...formData, clasificacion_gasto: e.target.value })}
              style={{
                width: '100%',
                padding: '0.65rem 0.85rem',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#09090b',
                outline: 'none',
                background: '#ffffff'
              }}
            >
              <option value="01 - Gastos de Personal">01 - Gastos de Personal</option>
              <option value="02 - Gastos por trabajos, suministros y servicios">02 - Gastos por trabajos, suministros y servicios</option>
              <option value="03 - Arrendamientos">03 - Arrendamientos</option>
              <option value="04 - Gastos de Activos Fijo">04 - Gastos de Activos Fijo</option>
              <option value="05 - Gastos de Representación">05 - Gastos de Representación</option>
              <option value="06 - Otras Deducciones Admitidas">06 - Otras Deducciones Admitidas</option>
              <option value="07 - Gastos Financieros">07 - Gastos Financieros</option>
              <option value="08 - Gastos Extraordinarios">08 - Gastos Extraordinarios</option>
              <option value="09 - Compras y Gastos que formarán parte del Costo de Venta">09 - Compras y Gastos (Costo de Venta)</option>
              <option value="10 - Adquisiciones de Activos">10 - Adquisiciones de Activos</option>
              <option value="11 - Gastos de Seguros">11 - Gastos de Seguros</option>
            </select>
          </div>

          {/* Tipo de compra */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#334155', marginBottom: '0.4rem' }}>
              Tipo de compra
            </label>
            <select
              value={formData.tipo_compra}
              onChange={(e) => setFormData({ ...formData, tipo_compra: e.target.value })}
              style={{
                width: '100%',
                padding: '0.65rem 0.85rem',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#09090b',
                outline: 'none',
                background: '#ffffff'
              }}
            >
              <option value="Bienes">Bienes</option>
              <option value="Servicios">Servicios</option>
              <option value="Ambos">Ambos (Bienes y Servicios)</option>
            </select>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', marginTop: '0.2rem' }}>
              Bienes, servicios o ambos
            </span>
          </div>

          {/* Monto sin impuestos */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#334155', marginBottom: '0.4rem' }}>
              Monto sin impuestos (RD$)
            </label>
            <input
              type="number"
              step="0.01"
              value={formData.monto_sin_impuestos}
              onChange={(e) => handleMontoSinImpuestosChange(e.target.value)}
              placeholder="5000.00"
              style={{
                width: '100%',
                padding: '0.65rem 0.85rem',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                fontSize: '0.9rem',
                fontWeight: 700,
                color: '#09090b',
                outline: 'none'
              }}
            />
          </div>

          {/* ITBIS facturado */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#334155', marginBottom: '0.4rem' }}>
              ITBIS facturado (RD$)
            </label>
            <input
              type="number"
              step="0.01"
              value={formData.itbis_facturado}
              onChange={(e) => setFormData({ ...formData, itbis_facturado: e.target.value })}
              placeholder="900.00"
              style={{
                width: '100%',
                padding: '0.65rem 0.85rem',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                fontSize: '0.9rem',
                fontWeight: 700,
                color: '#09090b',
                outline: 'none'
              }}
            />
          </div>

          {/* Forma de pago */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#334155', marginBottom: '0.4rem' }}>
              Forma de pago
            </label>
            <select
              value={formData.forma_pago}
              onChange={(e) => setFormData({ ...formData, forma_pago: e.target.value })}
              style={{
                width: '100%',
                padding: '0.65rem 0.85rem',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#09090b',
                outline: 'none',
                background: '#ffffff'
              }}
            >
              <option value="01">01 - Efectivo</option>
              <option value="02">02 - Cheque / Transferencia / Depósito</option>
              <option value="03">03 - Tarjeta Débito / Crédito</option>
              <option value="04">04 - Compra a Crédito</option>
              <option value="05">05 - Permuta</option>
              <option value="06">06 - Nota de Crédito</option>
              <option value="07">07 - Mixto</option>
            </select>
          </div>

          {/* Fecha de pago */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#334155', marginBottom: '0.4rem' }}>
              Fecha de pago
            </label>
            <input
              type="date"
              value={formData.fecha_pago}
              onChange={(e) => setFormData({ ...formData, fecha_pago: e.target.value })}
              style={{
                width: '100%',
                padding: '0.65rem 0.85rem',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                fontSize: '0.9rem',
                fontWeight: 600,
                color: '#09090b',
                outline: 'none'
              }}
            />
          </div>

        </div>

        {/* Accordion: Más opciones */}
        <div style={{ marginTop: '1.25rem', borderTop: '1px dashed #e2e8f0', paddingTop: '1rem' }}>
          <button
            type="button"
            onClick={() => setShowMoreOptions(!showMoreOptions)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.85rem',
              fontWeight: 800,
              color: '#0284c7',
              padding: 0
            }}
          >
            <div style={{
              width: '20px',
              height: '20px',
              borderRadius: '50%',
              background: '#e0f2fe',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#0284c7'
            }}>
              {showMoreOptions ? <ChevronUp size={14} /> : <Plus size={14} />}
            </div>
            <span>Más opciones</span>
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#94a3b8' }}>
              Retenciones, otros impuestos y comprobantes relacionados
            </span>
          </button>

          {showMoreOptions && (
            <div style={{
              marginTop: '1rem',
              padding: '1.25rem',
              background: '#f8fafc',
              borderRadius: '14px',
              border: '1px solid #e2e8f0',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '1rem'
            }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>
                  ITBIS Retenido (RD$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.itbis_retenido}
                  onChange={(e) => setFormData({ ...formData, itbis_retenido: e.target.value })}
                  placeholder="0.00"
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>
                  Tipo Retención ISR
                </label>
                <select
                  value={formData.tipo_retencion_isr}
                  onChange={(e) => setFormData({ ...formData, tipo_retencion_isr: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.85rem', background: '#fff' }}
                >
                  <option value="">Ninguna</option>
                  <option value="01">01 - Alquileres (10%)</option>
                  <option value="02">02 - Honorarios por Servicios (10%)</option>
                  <option value="03">03 - Otras Rentas (2%)</option>
                  <option value="04">04 - Rentas Presuntas (1.5%)</option>
                  <option value="05">05 - Intereses Pagados a Personas Jurídicas</option>
                  <option value="06">06 - Intereses Pagados a Personas Físicas</option>
                  <option value="07">07 - Retención por Proveedores del Estado</option>
                  <option value="08">08 - Juegos Telefónicos</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>
                  ISR Retenido (RD$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.isr_retenido}
                  onChange={(e) => setFormData({ ...formData, isr_retenido: e.target.value })}
                  placeholder="0.00"
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>
                  NCF Modificado (Notas de Crédito)
                </label>
                <input
                  type="text"
                  value={formData.ncf_modificado}
                  onChange={(e) => setFormData({ ...formData, ncf_modificado: e.target.value.toUpperCase() })}
                  placeholder="B0100000001"
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.85rem', textTransform: 'uppercase' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>
                  Impuesto Selectivo al Consumo (ISC)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.isc}
                  onChange={(e) => setFormData({ ...formData, isc: e.target.value })}
                  placeholder="0.00"
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>
                  Monto Propina Legal (10%)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.propina_legal}
                  onChange={(e) => setFormData({ ...formData, propina_legal: e.target.value })}
                  placeholder="0.00"
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                />
              </div>

            </div>
          )}
        </div>

        {/* Total del comprobante Highlight Bar */}
        <div style={{
          marginTop: '1.5rem',
          padding: '1rem 1.5rem',
          background: '#f0f9ff',
          borderRadius: '12px',
          border: '1px solid #bae6fd',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0369a1' }}>
            Total del comprobante
          </span>
          <span style={{ fontSize: '1.45rem', fontWeight: 900, color: '#0c4a6e', letterSpacing: '-0.02em' }}>
            RD$ {parseFloat(totalComprobante || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </span>
        </div>

        {/* Form Action Buttons */}
        <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.75rem' }}>
          <button
            type="button"
            onClick={() => {
              setFormData(initialFormState);
              setEditingId(null);
            }}
            style={{
              background: 'none',
              border: 'none',
              padding: '0.65rem 1.25rem',
              fontSize: '0.85rem',
              fontWeight: 700,
              color: '#64748b',
              cursor: 'pointer'
            }}
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={() => handleSave(false)}
            style={{
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              padding: '0.65rem 1.5rem',
              borderRadius: '10px',
              fontSize: '0.85rem',
              fontWeight: 800,
              color: '#0f172a',
              cursor: 'pointer'
            }}
          >
            {editingId ? 'Actualizar' : 'Guardar'}
          </button>

          {!editingId && (
            <button
              type="button"
              onClick={() => handleSave(true)}
              style={{
                background: '#0d9488',
                border: 'none',
                padding: '0.65rem 1.5rem',
                borderRadius: '10px',
                fontSize: '0.85rem',
                fontWeight: 800,
                color: '#ffffff',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(13,148,136,0.3)'
              }}
            >
              Guardar y agregar otra
            </button>
          )}
        </div>

      </div>

      {/* 3. CARD BOTTOM: Facturas registradas */}
      <div style={{
        background: '#ffffff',
        borderRadius: '20px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 4px 16px rgba(0,0,0,0.03)',
        padding: '1.75rem'
      }}>
        
        {/* Header & Tabs */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 900, color: '#09090b', margin: 0 }}>
            Facturas registradas
          </h2>

          <button
            type="button"
            onClick={() => {
              if (formRef.current) formRef.current.scrollIntoView({ behavior: 'smooth' });
            }}
            style={{
              background: '#0d9488',
              border: 'none',
              padding: '0.55rem 1.25rem',
              borderRadius: '10px',
              fontSize: '0.82rem',
              fontWeight: 800,
              color: '#ffffff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}
          >
            <Plus size={15} /> Agregar factura
          </button>
        </div>

        {/* Navigation Tabs */}
        <div style={{ display: 'flex', gap: '1.5rem', borderBottom: '1px solid #f1f5f9', marginBottom: '1.25rem' }}>
          <button
            type="button"
            onClick={() => setActiveTab('facturas')}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'facturas' ? '2.5px solid #0d9488' : '2.5px solid transparent',
              padding: '0.5rem 0.25rem',
              fontSize: '0.85rem',
              fontWeight: 800,
              color: activeTab === 'facturas' ? '#0d9488' : '#64748b',
              cursor: 'pointer'
            }}
          >
            Facturas
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('archivos')}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'archivos' ? '2.5px solid #0d9488' : '2.5px solid transparent',
              padding: '0.5rem 0.25rem',
              fontSize: '0.85rem',
              fontWeight: 800,
              color: activeTab === 'archivos' ? '#0d9488' : '#64748b',
              cursor: 'pointer'
            }}
          >
            Archivos generados
          </button>
        </div>

        {activeTab === 'facturas' ? (
          <>
            {/* Filters Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 240px) 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
              
              {/* Period Dropdown */}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '0.6rem 0.75rem',
                    borderRadius: '10px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    color: '#0f172a',
                    background: '#fff'
                  }}
                >
                  {monthNamesLong.map(m => (
                    <option key={m.num} value={m.num}>{m.name} {selectedYear}</option>
                  ))}
                </select>

                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  style={{
                    padding: '0.6rem 0.75rem',
                    borderRadius: '10px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    color: '#0f172a',
                    background: '#fff'
                  }}
                >
                  <option value="2025">2025</option>
                  <option value="2026">2026</option>
                  <option value="2027">2027</option>
                </select>
              </div>

              {/* Search Bar */}
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar proveedor o NCF"
                  style={{
                    width: '100%',
                    padding: '0.6rem 1rem 0.6rem 2.4rem',
                    borderRadius: '10px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.85rem',
                    color: '#0f172a'
                  }}
                />
                <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
              </div>
            </div>

            {/* Metrics Subhead */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', fontSize: '0.9rem' }}>
              <span style={{ fontWeight: 800, color: '#09090b' }}>
                <span style={{ fontSize: '1.1rem' }}>{reportData.records.length}</span> facturas
              </span>
              <span style={{ fontWeight: 800, color: '#09090b' }}>
                Total registrado: <span style={{ fontSize: '1.1rem', color: '#0f172a' }}>RD$ {Number(reportData.totals.total_facturado || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              </span>
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto', border: '1px solid #f1f5f9', borderRadius: '14px', marginBottom: '1.5rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 800 }}>
                    <th style={{ padding: '0.85rem 1rem' }}>Fecha</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Proveedor</th>
                    <th style={{ padding: '0.85rem 1rem' }}>NCF</th>
                    <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Total</th>
                    <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Estado</th>
                    <th style={{ padding: '0.85rem 1rem', textAlign: 'center', width: '60px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {reportData.records.length > 0 ? (
                    reportData.records.map((r) => {
                      const isComplete = r.estado === 'Completa';
                      const fDate = r.fecha_factura ? new Date(r.fecha_factura + 'T12:00:00') : new Date();
                      const dateDisplay = `${String(fDate.getDate()).padStart(2, '0')} ${fDate.toLocaleDateString('es-DO', { month: 'short' })}`;

                      return (
                        <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.2s' }}>
                          <td style={{ padding: '0.85rem 1rem', color: '#64748b', fontWeight: 600 }}>
                            {dateDisplay}
                          </td>
                          <td style={{ padding: '0.85rem 1rem', fontWeight: 800, color: '#0f172a' }}>
                            {r.proveedor}
                            <span style={{ display: 'block', fontSize: '0.72rem', color: '#94a3b8', fontWeight: 500 }}>
                              RNC: {r.rnc_cedula}
                            </span>
                          </td>
                          <td style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#334155' }}>
                            {r.ncf || 'Pendiente'}
                          </td>
                          <td style={{ padding: '0.85rem 1rem', textAlign: 'right', fontWeight: 800, color: '#09090b' }}>
                            RD$ {Number(r.total_facturado || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </td>
                          <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                            <span 
                              title={r.errores_validacion && r.errores_validacion.length > 0 ? r.errores_validacion.join(' · ') : 'Cumple normativa'}
                              style={{
                                display: 'inline-block',
                                padding: '0.25rem 0.75rem',
                                borderRadius: '20px',
                                fontSize: '0.75rem',
                                fontWeight: 800,
                                background: isComplete ? '#dcfce7' : '#fef3c7',
                                color: isComplete ? '#166534' : '#b45309',
                                cursor: 'help'
                              }}
                            >
                              {isComplete ? 'Completa' : 'Revisar'}
                            </span>
                          </td>
                          <td style={{ padding: '0.85rem 1rem', textAlign: 'center', position: 'relative' }}>
                            <button
                              type="button"
                              onClick={() => setOpenActionMenuId(openActionMenuId === r.id ? null : r.id)}
                              style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '0.25rem' }}
                            >
                              <MoreVertical size={16} />
                            </button>

                            {openActionMenuId === r.id && (
                              <div style={{
                                position: 'absolute',
                                right: '10px',
                                top: '80%',
                                background: '#ffffff',
                                border: '1px solid #e2e8f0',
                                borderRadius: '10px',
                                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                                zIndex: 50,
                                minWidth: '140px',
                                padding: '0.35rem',
                                textAlign: 'left'
                              }}>
                                <button
                                  type="button"
                                  onClick={() => handleEdit(r)}
                                  style={{
                                    width: '100%',
                                    background: 'none',
                                    border: 'none',
                                    padding: '0.5rem 0.75rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    fontSize: '0.8rem',
                                    fontWeight: 700,
                                    color: '#0f172a',
                                    cursor: 'pointer'
                                  }}
                                >
                                  <Edit3 size={14} /> Editar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(r.id)}
                                  style={{
                                    width: '100%',
                                    background: 'none',
                                    border: 'none',
                                    padding: '0.5rem 0.75rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    fontSize: '0.8rem',
                                    fontWeight: 700,
                                    color: '#dc2626',
                                    cursor: 'pointer'
                                  }}
                                >
                                  <Trash2 size={14} /> Eliminar
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} style={{ padding: '2.5rem', textAlign: 'center', color: '#94a3b8' }}>
                        No hay facturas registradas para este período ({currentMonthObj.name} {selectedYear}).
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer Status Bar & Action Buttons */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                {reportData.header?.facturas_por_revisar > 0 ? (
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#b45309', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
                    {reportData.header.facturas_por_revisar} factura(s) por revisar
                  </span>
                ) : (
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#16a34a', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <CheckCircle2 size={15} /> Todas las facturas están completas
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <button
                  type="button"
                  onClick={handleExportExcel}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    padding: '0.55rem 1rem',
                    borderRadius: '10px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    color: '#334155',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem'
                  }}
                >
                  <FileSpreadsheet size={15} color="#16a34a" /> Excel 606
                </button>

                <button
                  type="button"
                  onClick={handleValidatePeriod}
                  disabled={isValidating || reportData.records.length === 0}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    padding: '0.55rem 1.25rem',
                    borderRadius: '10px',
                    fontSize: '0.82rem',
                    fontWeight: 800,
                    color: '#0f172a',
                    cursor: isValidating ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem'
                  }}
                >
                  <ShieldCheck size={15} color="#0284c7" /> {isValidating ? 'Validando...' : 'Validar'}
                </button>

                <button
                  type="button"
                  onClick={handleDownloadTxt}
                  disabled={reportData.records.length === 0}
                  style={{
                    background: reportData.records.length > 0 ? '#0f172a' : '#e2e8f0',
                    border: 'none',
                    padding: '0.55rem 1.25rem',
                    borderRadius: '10px',
                    fontSize: '0.82rem',
                    fontWeight: 800,
                    color: reportData.records.length > 0 ? '#ffffff' : '#94a3b8',
                    cursor: reportData.records.length > 0 ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem'
                  }}
                >
                  <Download size={14} /> Generar TXT 606
                </button>
              </div>
            </div>

            <div style={{ marginTop: '0.75rem', textAlign: 'right' }}>
              <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                Estado de revisión interna. El envío a la DGII se realiza por separado.
              </span>
            </div>
          </>
        ) : (
          <div style={{ padding: '2rem', textAlign: 'center', background: '#f8fafc', borderRadius: '14px', border: '1px dashed #cbd5e1' }}>
            <FileText size={36} color="#94a3b8" style={{ margin: '0 auto 0.75rem' }} />
            <h4 style={{ margin: '0 0 0.25rem', fontSize: '1rem', fontWeight: 800, color: '#334155' }}>
              Archivos TXT de Envío Generados
            </h4>
            <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 1rem' }}>
              Historial de exportaciones del Formato 606 listos para cargar en la Oficina Virtual de la DGII.
            </p>
            <button
              type="button"
              onClick={handleDownloadTxt}
              style={{
                background: '#0d9488',
                border: 'none',
                padding: '0.55rem 1.25rem',
                borderRadius: '10px',
                fontSize: '0.82rem',
                fontWeight: 800,
                color: '#ffffff',
                cursor: 'pointer'
              }}
            >
              Descargar Archivo TXT Actual ({currentPeriod})
            </button>
          </div>
        )}

      </div>

      {/* MODAL DE VALIDACIÓN Y DIAGNÓSTICOS DGII */}
      {showValidationModal && validationResults && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '20px',
            width: '100%',
            maxWidth: '620px',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '1.25rem 1.75rem',
              borderBottom: '1px solid #f1f5f9',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f8fafc'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <ShieldCheck size={22} color="#0d9488" />
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#09090b' }}>
                  Diagnóstico de Cumplimiento 606
                </h3>
              </div>
              <button
                onClick={() => setShowValidationModal(false)}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '1.5rem 1.75rem', overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ background: '#f0fdf4', padding: '1rem', borderRadius: '12px', border: '1px solid #bbf7d0' }}>
                  <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 800, color: '#166534', textTransform: 'uppercase' }}>Facturas Completas</p>
                  <p style={{ margin: '0.25rem 0 0', fontSize: '1.6rem', fontWeight: 900, color: '#15803d' }}>
                    {validationResults.completas}
                  </p>
                </div>
                <div style={{ background: validationResults.conErrores > 0 ? '#fef2f2' : '#f8fafc', padding: '1rem', borderRadius: '12px', border: validationResults.conErrores > 0 ? '1px solid #fecaca' : '1px solid #e2e8f0' }}>
                  <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 800, color: validationResults.conErrores > 0 ? '#991b1b' : '#64748b', textTransform: 'uppercase' }}>Para Revisión</p>
                  <p style={{ margin: '0.25rem 0 0', fontSize: '1.6rem', fontWeight: 900, color: validationResults.conErrores > 0 ? '#b91c1c' : '#0f172a' }}>
                    {validationResults.conErrores}
                  </p>
                </div>
              </div>

              {validationResults.diagnostics && validationResults.diagnostics.length > 0 ? (
                <div>
                  <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', fontWeight: 800, color: '#09090b' }}>
                    Detalle de advertencias detectadas:
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {validationResults.diagnostics.map((diag, idx) => (
                      <div key={idx} style={{ background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '10px', padding: '0.85rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                          <span style={{ fontWeight: 800, fontSize: '0.85rem', color: '#92400e' }}>{diag.proveedor}</span>
                          <span style={{ fontWeight: 700, fontSize: '0.75rem', color: '#b45309' }}>NCF: {diag.ncf || 'No especificado'}</span>
                        </div>
                        <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.8rem', color: '#78350f' }}>
                          {diag.errores.map((err, eIdx) => (
                            <li key={eIdx}>{err}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#166534' }}>
                  <CheckCircle2 size={44} style={{ margin: '0 auto 0.75rem' }} />
                  <p style={{ fontWeight: 800, fontSize: '1rem', margin: 0 }}>¡Todas las facturas están listas para generar el archivo TXT 606!</p>
                </div>
              )}
            </div>

            <div style={{ padding: '1rem 1.75rem', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', background: '#f8fafc' }}>
              <button
                onClick={() => setShowValidationModal(false)}
                style={{
                  background: '#0f172a',
                  color: '#ffffff',
                  border: 'none',
                  padding: '0.55rem 1.5rem',
                  borderRadius: '10px',
                  fontSize: '0.85rem',
                  fontWeight: 800,
                  cursor: 'pointer'
                }}
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
