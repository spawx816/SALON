import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { 
  FileSpreadsheet, Download, Printer, Search, RefreshCw, 
  Calendar, Landmark, Filter, CheckCircle2, AlertCircle, FileText, ChevronDown
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useNotification } from '../../context/NotificationContext';

export default function Reporte607Module() {
  const { showNotification } = useNotification();
  const [loading, setLoading] = useState(true);
  const [reportData, setReportData] = useState({
    header: {
      empresa: 'ETEREAS SRL',
      rnc: '131917038',
      periodo: new Date().toISOString().slice(0, 7).replace('-', ''),
      cantidad_registros: 0,
      fecha_impresion: new Date().toLocaleDateString('es-DO')
    },
    records: [],
    totals: {}
  });

  // Selected year and month for 607 Period (YYYYMM)
  const [selectedYear, setSelectedYear] = useState(() => String(new Date().getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState(() => String(new Date().getMonth() + 1).padStart(2, '0'));
  const [searchTerm, setSearchTerm] = useState('');

  const currentPeriod = `${selectedYear}${selectedMonth}`;

  const fetchReport = async () => {
    setLoading(true);
    try {
      const res = await dataService.getReporte607(currentPeriod);
      if (res && res.records && res.header) {
        setReportData(res);
      } else if (res && res.records) {
        setReportData({
          header: {
            empresa: 'ETEREAS SRL',
            rnc: '131917038',
            periodo: currentPeriod,
            cantidad_registros: res.records.length,
            fecha_impresion: new Date().toLocaleDateString('es-DO')
          },
          records: res.records,
          totals: res.totals || {}
        });
      } else {
        setReportData({
          header: {
            empresa: 'ETEREAS SRL',
            rnc: '131917038',
            periodo: currentPeriod,
            cantidad_registros: 0,
            fecha_impresion: new Date().toLocaleDateString('es-DO')
          },
          records: [],
          totals: {}
        });
      }
    } catch (err) {
      console.error('Error cargando Reporte 607:', err);
      showNotification('Error al cargar datos del Reporte 607', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [selectedYear, selectedMonth]);

  // Filter records by search term
  const filteredRecords = useMemo(() => {
    if (!searchTerm.trim()) return reportData.records;
    const term = searchTerm.toLowerCase();
    return reportData.records.filter(r => 
      String(r.cliente || '').toLowerCase().includes(term) ||
      String(r.numero_comprobante || '').toLowerCase().includes(term) ||
      String(r.ncf_modificado || '').toLowerCase().includes(term) ||
      String(r.rnc_cedula || '').toLowerCase().includes(term) ||
      String(r.id || '').includes(term)
    );
  }, [reportData.records, searchTerm]);

  // Export to Excel (.xlsx) matching Official DGII 607 Specification
  const handleExportExcel = () => {
    try {
      const wb = XLSX.utils.book_new();

      // =========================================================================
      // HOJA 1: FORMATO OFICIAL DGII 607 (Plantilla Oficial Herramienta de Envío)
      // =========================================================================
      const dgiiHeaders = [
        'RNC/Cédula o Pasaporte',
        'Tipo de Identificación',
        'Número Comprobante Fiscal',
        'Número Comprobante Fiscal Modificado',
        'Tipo de Ingreso',
        'Fecha de Comprobante',
        'Fecha de Retención',
        'Monto Facturado',
        'ITBIS Facturado',
        'ITBIS Retenido por Terceros',
        'ITBIS Percibido',
        'Retención Renta por Terceros',
        'ISR Percibido',
        'Impuesto Selectivo al Consumo',
        'Otros Impuestos/Tasas',
        'Monto Propina Legal',
        'Efectivo',
        'Cheque/Transferencia/Depósito',
        'Tarjeta Débito/Crédito',
        'Venta a Crédito',
        'Bonos o Certificados de Regalo',
        'Permuta',
        'Otras Formas de Ventas'
      ];

      const rncEmpresa = String(reportData?.header?.rnc || '131917038');
      const periodoFiscal = String(reportData?.header?.periodo || currentPeriod);
      const totalRegistros = filteredRecords.length;

      const dgiiRows = [
        ['RNC o Cédula', rncEmpresa],
        ['Período', periodoFiscal],
        ['Cantidad Registros', totalRegistros],
        [], // Fila de separación
        dgiiHeaders
      ];

      // Helper para convertir fecha a formato estándar DGII (AAAAMMDD)
      const toDgiiYmd = (dtStr) => {
        if (!dtStr) return '';
        const clean = String(dtStr).trim();
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(clean)) {
          const [d, m, y] = clean.split('/');
          return `${y}${m}${d}`;
        }
        if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
          return clean.slice(0, 10).replace(/-/g, '');
        }
        return clean.replace(/\D/g, '');
      };

      // Helper para obtener código de 2 dígitos de Tipo de Ingreso (ej: '01')
      const toTipoIngresoCode = (tStr) => {
        if (!tStr) return '01';
        const match = String(tStr).match(/^(\d{2})/);
        return match ? match[1] : '01';
      };

      filteredRecords.forEach((r) => {
        dgiiRows.push([
          String(r.rnc_cedula || ''),
          String(r.tipo_identificacion || '3'),
          String(r.numero_comprobante || ''),
          String(r.ncf_modificado || ''),
          toTipoIngresoCode(r.tipo_ingreso),
          toDgiiYmd(r.fecha_comprobante),
          toDgiiYmd(r.fecha_retencion),
          Number(r.monto_facturado || 0),
          Number(r.itbis_facturado || 0),
          Number(r.itbis_retenido || 0),
          Number(r.itbis_percibido || 0),
          Number(r.retencion_renta || 0),
          Number(r.isr_percibido || 0),
          Number(r.impuesto_selectivo || 0),
          Number(r.otros_impuestos || 0),
          Number(r.propina_legal || 0),
          Number(r.efectivo || 0),
          Number(r.cheque_transferencia || 0),
          Number(r.tarjeta || 0),
          Number(r.venta_credito || 0),
          Number(r.bonos_certificados || 0),
          Number(r.permuta || 0),
          Number(r.otras_formas || 0)
        ]);
      });

      const wsDgii = XLSX.utils.aoa_to_sheet(dgiiRows);
      
      // Formatear celdas numéricas de datos a 2 decimales (0.00) a partir de la fila 6 (índice R = 5)
      if (wsDgii['!ref']) {
        const range = XLSX.utils.decode_range(wsDgii['!ref']);
        for (let R = 5; R <= range.e.r; ++R) {
          for (let C = 7; C <= 22; ++C) {
            const cellAddr = XLSX.utils.encode_cell({ r: R, c: C });
            const cell = wsDgii[cellAddr];
            if (cell && typeof cell.v === 'number') {
              cell.z = '0.00';
            }
          }
        }
      }

      // Auto-anchos para Hoja Oficial DGII 607
      wsDgii['!cols'] = [
        { wch: 22 }, // RNC o Cédula
        { wch: 20 }, // Tipo Identificación
        { wch: 26 }, // NCF
        { wch: 26 }, // NCF Modificado
        { wch: 15 }, // Tipo Ingreso
        { wch: 20 }, // Fecha Comprobante (AAAAMMDD)
        { wch: 18 }, // Fecha Retención
        { wch: 16 }, // Monto Facturado
        { wch: 15 }, // ITBIS Facturado
        { wch: 25 }, // ITBIS Retenido
        { wch: 15 }, // ITBIS Percibido
        { wch: 26 }, // Retención Renta
        { wch: 15 }, // ISR Percibido
        { wch: 26 }, // Impuesto Selectivo
        { wch: 20 }, // Otros Impuestos
        { wch: 18 }, // Propina Legal
        { wch: 15 }, // Efectivo
        { wch: 28 }, // Cheque/Transf
        { wch: 22 }, // Tarjeta
        { wch: 16 }, // Venta a Crédito
        { wch: 26 }, // Bonos
        { wch: 14 }, // Permuta
        { wch: 22 }  // Otras Formas
      ];

      XLSX.utils.book_append_sheet(wb, wsDgii, '607');

      // =========================================================================
      // HOJA 2: REPORTE DETALLADO (Formato Visual con Membrete Corporativo y Clientes)
      // =========================================================================
      const detailedRows = [
        ['ABATTE PELUQUERIA / PLAN BEAUTY - ETEREAS SRL'],
        ['AVENIDA LOS PALMEROS 96, PISO 1, LOCAL 3, EDIFICIO SUPERMERCADO BRAVO, LOS FRAILES, NUEVO, SANTO DOMINGO ESTE'],
        ['REPORTE 607 - DECLARACIÓN JURADA DE VENTAS DE BIENES Y SERVICIOS (DGII)'],
        [
          `RNC: ${rncEmpresa}`, 
          '', 
          `Período: ${periodoFiscal}`, 
          '', 
          `Cantidad de Registros: ${totalRegistros}`, 
          '', 
          `Fecha de Impresión: ${reportData?.header?.fecha_impresion || new Date().toLocaleDateString('es-DO')}`
        ],
        [],
        [
          'Id',
          'Cliente',
          'RNC o Cédula',
          'Tipo Identificación',
          'Número Comprobante Fiscal',
          'NCF Modificado',
          'Tipo Ingreso',
          'Fecha Comprobante',
          'Fecha Retención',
          'Monto Facturado',
          'ITBIS Facturado',
          'Retención Renta por Terceros',
          'ITBIS Retenido por Terceros',
          'ISR Percibido',
          'Impuesto Selectivo al Consumo',
          'Otros Impuestos',
          'Monto Propina Legal',
          'Efectivo',
          'Cheque/Transf. o Depósito',
          'Tarjeta Débito o Crédito',
          'Venta a Crédito',
          'Bonos o Certificado de Regalo',
          'Permuta',
          'Otras formas de Venta'
        ]
      ];

      filteredRecords.forEach((r, idx) => {
        detailedRows.push([
          idx + 1,
          r.cliente || 'CONSUMIDOR FINAL',
          r.rnc_cedula || '',
          r.tipo_identificacion || '3',
          r.numero_comprobante || '',
          r.ncf_modificado || '',
          r.tipo_ingreso || '01 - Ingresos por Operaciones (No Financieros)',
          r.fecha_comprobante || '',
          r.fecha_retencion || '',
          Number(r.monto_facturado || 0),
          Number(r.itbis_facturado || 0),
          Number(r.retencion_renta || 0),
          Number(r.itbis_retenido || 0),
          Number(r.isr_percibido || 0),
          Number(r.impuesto_selectivo || 0),
          Number(r.otros_impuestos || 0),
          Number(r.propina_legal || 0),
          Number(r.efectivo || 0),
          Number(r.cheque_transferencia || 0),
          Number(r.tarjeta || 0),
          Number(r.venta_credito || 0),
          Number(r.bonos_certificados || 0),
          Number(r.permuta || 0),
          Number(r.otras_formas || 0)
        ]);
      });

      const t = reportData.totals || {};
      detailedRows.push([
        'TOTALES',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        Number(t.montoFacturado || 0),
        Number(t.itbisFacturado || 0),
        Number(t.retencionRenta || 0),
        Number(t.itbisRetenido || 0),
        Number(t.isrPercibido || 0),
        Number(t.impuestoSelectivo || 0),
        Number(t.otrosImpuestos || 0),
        Number(t.propinaLegal || 0),
        Number(t.efectivo || 0),
        Number(t.chequeTransferencia || 0),
        Number(t.tarjeta || 0),
        Number(t.ventaCredito || 0),
        Number(t.bonosCertificados || 0),
        Number(t.permuta || 0),
        Number(t.otrasFormas || 0)
      ]);

      const wsDetail = XLSX.utils.aoa_to_sheet(detailedRows);

      // Formatear celdas numéricas con separadores de miles y 2 decimales a partir de la fila 7 (R = 6)
      if (wsDetail['!ref']) {
        const rangeDetail = XLSX.utils.decode_range(wsDetail['!ref']);
        for (let R = 6; R <= rangeDetail.e.r; ++R) {
          for (let C = 9; C <= 23; ++C) {
            const cellAddr = XLSX.utils.encode_cell({ r: R, c: C });
            const cell = wsDetail[cellAddr];
            if (cell && typeof cell.v === 'number') {
              cell.z = '#,##0.00';
            }
          }
        }
      }

      wsDetail['!cols'] = [
        { wch: 8 },  // Id
        { wch: 28 }, // Cliente
        { wch: 18 }, // RNC
        { wch: 18 }, // Tipo ID
        { wch: 25 }, // NCF
        { wch: 20 }, // NCF Modificado
        { wch: 32 }, // Tipo Ingreso
        { wch: 18 }, // Fecha Comprobante
        { wch: 16 }, // Fecha Retención
        { wch: 16 }, // Monto Facturado
        { wch: 15 }, // ITBIS Facturado
        { wch: 25 }, // Retención Renta
        { wch: 24 }, // ITBIS Retenido
        { wch: 15 }, // ISR Percibido
        { wch: 26 }, // ISC
        { wch: 18 }, // Otros Impuestos
        { wch: 18 }, // Propina Legal
        { wch: 15 }, // Efectivo
        { wch: 24 }, // Cheque/Transf
        { wch: 22 }, // Tarjeta
        { wch: 16 }, // Venta Crédito
        { wch: 26 }, // Bonos
        { wch: 14 }, // Permuta
        { wch: 20 }  // Otras Formas
      ];

      XLSX.utils.book_append_sheet(wb, wsDetail, 'Reporte_Detallado_Visual');

      const fileName = `Formato_607_DGII_${rncEmpresa}_${periodoFiscal}.xlsx`;
      XLSX.writeFile(wb, fileName);

      showNotification('✅ Archivo Excel Formato 607 generado correctamente con la plantilla oficial DGII y detalle visual.', 'success');
    } catch (err) {
      console.error('Error exportando a Excel:', err);
      showNotification('Error al exportar a Excel', 'error');
    }
  };

  // Print / PDF
  const handlePrint = () => {
    window.print();
  };

  // TXT Download
  const handleDownloadTxt = () => {
    window.open(`/api/dgii/report-607/txt?periodo=${currentPeriod}`, '_blank');
  };

  const totals = reportData.totals || {};

  return (
    <div className="reporte-607-container" style={{ padding: '2rem', maxWidth: '1600px', margin: '0 auto' }}>
      
      {/* Printable CSS style */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .printable-report-607, .printable-report-607 * {
            visibility: visible;
          }
          .printable-report-607 {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 10px;
            font-size: 8px !important;
          }
          .no-print {
            display: none !important;
          }
          table {
            font-size: 7.5px !important;
          }
          th, td {
            padding: 2px 4px !important;
          }
        }
      `}</style>

      {/* Screen Header */}
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(22, 163, 74, 0.1)', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Landmark size={24} />
            </div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 900, color: '#09090b', margin: 0 }}>
              Reporte 607 • Ventas de Bienes y Servicios (DGII)
            </h1>
          </div>
          <p style={{ color: '#64748b', margin: 0, fontSize: '0.9rem' }}>
            Formato oficial de 24 columnas para la Declaración Jurada de Ventas y Operaciones ante la DGII. Excluye ventas sin comprobante fiscal.
          </p>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          
          <button
            onClick={handleExportExcel}
            disabled={loading || filteredRecords.length === 0}
            className="admin-btn"
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.5rem', 
              background: '#16a34a', 
              color: '#ffffff',
              border: 'none', 
              padding: '0.65rem 1.25rem', 
              borderRadius: '10px', 
              cursor: (loading || filteredRecords.length === 0) ? 'not-allowed' : 'pointer',
              fontWeight: 800
            }}
          >
            <FileSpreadsheet size={16} />
            <span>Exportar Excel</span>
          </button>

          <button
            onClick={handlePrint}
            disabled={loading || filteredRecords.length === 0}
            className="admin-btn"
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.5rem', 
              background: '#2563eb', 
              color: '#ffffff',
              border: 'none', 
              padding: '0.65rem 1.25rem', 
              borderRadius: '10px', 
              cursor: (loading || filteredRecords.length === 0) ? 'not-allowed' : 'pointer',
              fontWeight: 800
            }}
          >
            <Printer size={16} />
            <span>Imprimir / PDF</span>
          </button>

          <button
            onClick={handleDownloadTxt}
            disabled={loading || filteredRecords.length === 0}
            className="admin-btn"
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.5rem', 
              background: '#475569', 
              color: '#ffffff',
              border: 'none', 
              padding: '0.65rem 1.25rem', 
              borderRadius: '10px', 
              cursor: (loading || filteredRecords.length === 0) ? 'not-allowed' : 'pointer',
              fontWeight: 800
            }}
          >
            <FileText size={16} />
            <span>TXT 607</span>
          </button>

          <button
            onClick={fetchReport}
            disabled={loading}
            className="admin-btn"
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.5rem', 
              background: '#f1f5f9', 
              border: '1px solid #e2e8f0', 
              padding: '0.65rem 1rem', 
              borderRadius: '10px', 
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 700,
              color: '#334155'
            }}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Period Selector & Filter Bar */}
      <div className="no-print" style={{ background: '#ffffff', borderRadius: '16px', padding: '1.25rem', border: '1px solid #e2e8f0', marginBottom: '1.5rem', display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'center', justifyContent: 'space-between' }}>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Calendar size={18} style={{ color: '#64748b' }} />
            <span style={{ fontWeight: 800, fontSize: '0.85rem', color: '#09090b', textTransform: 'uppercase' }}>Período Fiscal:</span>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '10px',
                border: '1.5px solid #e2e8f0',
                fontWeight: 700,
                fontSize: '0.85rem',
                outline: 'none',
                background: '#f8fafc',
                cursor: 'pointer'
              }}
            >
              <option value="01">01 - Enero</option>
              <option value="02">02 - Febrero</option>
              <option value="03">03 - Marzo</option>
              <option value="04">04 - Abril</option>
              <option value="05">05 - Mayo</option>
              <option value="06">06 - Junio</option>
              <option value="07">07 - Julio</option>
              <option value="08">08 - Agosto</option>
              <option value="09">09 - Septiembre</option>
              <option value="10">10 - Octubre</option>
              <option value="11">11 - Noviembre</option>
              <option value="12">12 - Diciembre</option>
            </select>

            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '10px',
                border: '1.5px solid #e2e8f0',
                fontWeight: 700,
                fontSize: '0.85rem',
                outline: 'none',
                background: '#f8fafc',
                cursor: 'pointer'
              }}
            >
              <option value="2025">2025</option>
              <option value="2026">2026</option>
              <option value="2027">2027</option>
              <option value="2028">2028</option>
            </select>
          </div>

          <span style={{ 
            background: 'rgba(22, 163, 74, 0.1)', 
            color: '#16a34a', 
            padding: '0.35rem 0.75rem', 
            borderRadius: '50px', 
            fontSize: '0.8rem', 
            fontWeight: 800,
            fontFamily: 'monospace'
          }}>
            Período: {currentPeriod}
          </span>
        </div>

        <div style={{ position: 'relative', width: '300px' }}>
          <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          <input 
            type="text" 
            placeholder="Buscar por cliente, NCF o RNC..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 1rem 0.5rem 2.25rem',
              borderRadius: '10px',
              border: '1.5px solid #e2e8f0',
              outline: 'none',
              fontSize: '0.85rem'
            }}
          />
        </div>

      </div>

      {/* Official 607 Printable / Viewable Container */}
      <div className="printable-report-607" style={{ background: '#ffffff', borderRadius: '20px', border: '1px solid #e2e8f0', padding: '1.5rem', boxShadow: '0 10px 25px rgba(0,0,0,0.02)' }}>
        
        {/* Header Metadata Grid matching official PDF format */}
        <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: '1rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ background: '#09090b', color: '#ffffff', padding: '0.2rem 0.5rem', borderRadius: '4px', fontWeight: 900, fontSize: '0.85rem', letterSpacing: '1px' }}>ABATTE</span>
                <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900, color: '#09090b' }}>ETEREAS SRL</h2>
              </div>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.75rem', color: '#64748b', maxWidth: '600px' }}>
                AVENIDA LOS PALMEROS 96, PISO 1, LOCAL 3, EDIFICIO SUPERMERCADO BRAVO, LOS FRAILES, NUEVO, SANTO DOMINGO ESTE, SANTO DOMINGO
              </p>
              <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.75rem', fontWeight: 700, color: '#09090b' }}>
                RNC: {reportData?.header?.rnc || '131917038'}
              </p>
            </div>

            <div style={{ textAlign: 'right' }}>
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900, color: '#16a34a' }}>Reporte 607</h3>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                Fecha de Impresión: <strong>{reportData?.header?.fecha_impresion || new Date().toLocaleDateString('es-DO')}</strong>
              </p>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.35rem', justifyContent: 'flex-end', fontSize: '0.75rem' }}>
                <span style={{ background: '#f8fafc', padding: '2px 8px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                  Período: <strong>{reportData?.header?.periodo || currentPeriod}</strong>
                </span>
                <span style={{ background: '#f8fafc', padding: '2px 8px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                  Cantidad de Registros: <strong>{(filteredRecords || []).length.toLocaleString('es-DO')}</strong>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 24-Column Data Table */}
        {loading ? (
          <div style={{ padding: '4rem', textAlign: 'center', color: '#64748b' }}>
            <RefreshCw size={32} className="animate-spin" style={{ margin: '0 auto 1rem', color: '#16a34a' }} />
            <p style={{ margin: 0, fontWeight: 700 }}>Generando data del Reporte 607 para el período {currentPeriod}...</p>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
            <AlertCircle size={32} style={{ color: '#94a3b8', margin: '0 auto 1rem' }} />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#09090b', margin: '0 0 0.5rem 0' }}>
              No hay comprobantes fiscales en el período {currentPeriod}
            </h3>
            <p style={{ color: '#64748b', fontSize: '0.85rem' }}>
              Las facturas emitidas con NCF (B02, E32, E31, E34, etc.) aparecerán automáticamente en este reporte.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', minWidth: '1800px' }}>
              <thead>
                <tr style={{ background: '#166534', color: '#ffffff' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.2)' }}>Id</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderRight: '1px solid rgba(255,255,255,0.2)' }}>Cliente</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderRight: '1px solid rgba(255,255,255,0.2)' }}>RNC o Cedula</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.2)' }}>Tipo Identificacion</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderRight: '1px solid rgba(255,255,255,0.2)' }}>Numero Comprobante Fiscal</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderRight: '1px solid rgba(255,255,255,0.2)' }}>NCF Modificado</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderRight: '1px solid rgba(255,255,255,0.2)' }}>Tipo Ingreso</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.2)' }}>Fecha Comprobante</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.2)' }}>Fecha Retencion</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.2)' }}>Monto Facturado</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.2)' }}>Itbis Facturado</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.2)' }}>Retencion Renta por Terceros</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.2)' }}>Itbis Retenido por Terceros</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.2)' }}>ISR Percibido</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.2)' }}>Impuesto Selectivo al Consumo</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.2)' }}>Otros Impuestos</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.2)' }}>Monto Propina Legal</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.2)' }}>Efectivo</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.2)' }}>Cheque/Transf. o Deposito</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.2)' }}>Tarjeta Debito o Credito</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.2)' }}>Venta a Credito</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.2)' }}>Bonos o Certificado de Regalo</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.2)' }}>Permuta</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Otras formas de Venta</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((r, index) => {
                  const isNc = r.tipo_registro === 'NOTA_CREDITO' || (r.monto_facturado < 0);
                  const rowBg = isNc ? '#FEF2F2' : (index % 2 === 1 ? '#F8FAFC' : '#FFFFFF');

                  return (
                    <tr 
                      key={`${r.numero_comprobante}-${index}`}
                      style={{ 
                        background: rowBg, 
                        borderBottom: '1px solid #e2e8f0',
                        color: isNc ? '#991B1B' : '#0F172A'
                      }}
                    >
                      <td style={{ padding: '5px 8px', textAlign: 'center', borderRight: '1px solid #e2e8f0' }}>{r.id || index + 1}</td>
                      <td style={{ padding: '5px 8px', fontWeight: 600, borderRight: '1px solid #e2e8f0', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.cliente}>
                        {r.cliente || 'CONSUMIDOR FINAL'}
                      </td>
                      <td style={{ padding: '5px 8px', borderRight: '1px solid #e2e8f0', fontFamily: 'monospace' }}>{r.rnc_cedula || ''}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'center', borderRight: '1px solid #e2e8f0' }}>{r.tipo_identificacion || '3'}</td>
                      <td style={{ padding: '5px 8px', fontWeight: 700, borderRight: '1px solid #e2e8f0', fontFamily: 'monospace' }}>{r.numero_comprobante}</td>
                      <td style={{ padding: '5px 8px', borderRight: '1px solid #e2e8f0', fontFamily: 'monospace', color: '#64748b' }}>{r.ncf_modificado || ''}</td>
                      <td style={{ padding: '5px 8px', borderRight: '1px solid #e2e8f0', fontSize: '0.7rem' }}>{r.tipo_ingreso}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'center', borderRight: '1px solid #e2e8f0' }}>{r.fecha_comprobante}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'center', borderRight: '1px solid #e2e8f0' }}>{r.fecha_retencion || ''}</td>
                      
                      {/* Montos */}
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 700, borderRight: '1px solid #e2e8f0' }}>
                        {Number(r.monto_facturado || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', borderRight: '1px solid #e2e8f0' }}>0.00</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', borderRight: '1px solid #e2e8f0' }}>0.00</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', borderRight: '1px solid #e2e8f0' }}>0.00</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', borderRight: '1px solid #e2e8f0' }}>0.00</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', borderRight: '1px solid #e2e8f0' }}>0.00</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', borderRight: '1px solid #e2e8f0' }}>0.00</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', borderRight: '1px solid #e2e8f0' }}>0.00</td>

                      {/* Formas de Pago */}
                      <td style={{ padding: '5px 8px', textAlign: 'right', borderRight: '1px solid #e2e8f0', fontWeight: r.efectivo !== 0 ? 700 : 400 }}>
                        {Number(r.efectivo || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', borderRight: '1px solid #e2e8f0', fontWeight: r.cheque_transferencia !== 0 ? 700 : 400 }}>
                        {Number(r.cheque_transferencia || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', borderRight: '1px solid #e2e8f0', fontWeight: r.tarjeta !== 0 ? 700 : 400 }}>
                        {Number(r.tarjeta || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', borderRight: '1px solid #e2e8f0' }}>0.00</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', borderRight: '1px solid #e2e8f0', fontWeight: r.bonos_certificados !== 0 ? 700 : 400 }}>
                        {Number(r.bonos_certificados || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', borderRight: '1px solid #e2e8f0' }}>0.00</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right' }}>0.00</td>
                    </tr>
                  );
                })}
              </tbody>

              {/* Grand Totals Footer Row */}
              <tfoot>
                <tr style={{ background: '#0F172A', color: '#FFFFFF', fontWeight: 900, borderTop: '2px solid #000000' }}>
                  <td colSpan={9} style={{ padding: '8px 12px', textAlign: 'right', letterSpacing: '1px', textTransform: 'uppercase' }}>
                    TOTALES PERÍODO {currentPeriod}:
                  </td>
                  <td style={{ padding: '8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.15)', color: '#4ADE80' }}>
                    {Number(totals.montoFacturado || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.15)' }}>0.00</td>
                  <td style={{ padding: '8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.15)' }}>0.00</td>
                  <td style={{ padding: '8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.15)' }}>0.00</td>
                  <td style={{ padding: '8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.15)' }}>0.00</td>
                  <td style={{ padding: '8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.15)' }}>0.00</td>
                  <td style={{ padding: '8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.15)' }}>0.00</td>
                  <td style={{ padding: '8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.15)' }}>0.00</td>

                  {/* Formas de Pago Totales */}
                  <td style={{ padding: '8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.15)', color: '#67E8F9' }}>
                    {Number(totals.efectivo || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.15)', color: '#67E8F9' }}>
                    {Number(totals.chequeTransferencia || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.15)', color: '#67E8F9' }}>
                    {Number(totals.tarjeta || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.15)' }}>0.00</td>
                  <td style={{ padding: '8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.15)', color: '#67E8F9' }}>
                    {Number(totals.bonosCertificados || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'right', borderRight: '1px solid rgba(255,255,255,0.15)' }}>0.00</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>0.00</td>
                </tr>
              </tfoot>

            </table>
          </div>
        )}

      </div>

    </div>
  );
}
