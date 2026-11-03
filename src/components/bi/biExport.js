import * as XLSX from 'xlsx';

/**
 * Sanitizes a cell value to prevent CSV / Excel formula injection (CSV Injection).
 * If the value starts with =, +, -, @, \t, or \r and is not a valid number,
 * it prepends a single quote (') so that spreadsheet processors treat it strictly as literal text.
 */
export const sanitizeForExport = (val) => {
  if (val === undefined || val === null) return '';
  if (typeof val === 'number') return val;
  if (typeof val === 'boolean') return val;

  const str = String(val);
  if (/^[=+\-@\t\r]/.test(str)) {
    if (!isNaN(Number(str)) && str.trim() !== '') {
      return Number(str);
    }
    return `'${str}`;
  }
  return str;
};

/**
 * Generates an XLSX Workbook data structure containing:
 * - Sheet 1: Main report with institutional header, metadata, KPIs, 18 columns and appended unmatched payments.
 * - Sheet 2: Dedicated "Conciliación" sheet if unmatched payments exist.
 */
export const buildExcelWorkbook = ({
  title = 'Reporte',
  periodText = '',
  kpis = [],
  columns = [],
  rows = [],
  unmatchedTable = null,
  activeFilters = null
}) => {
  const workbook = XLSX.utils.book_new();

  // --- SHEET 1: OBLIGACIONES / REPORTE PRINCIPAL ---
  const sheetData = [];
  sheetData.push([`SISTEMA SALON PRO & PLAN BEAUTY RD`]);
  sheetData.push([`REPORTE DE INTELIGENCIA DE NEGOCIOS: ${String(title).toUpperCase()}`]);
  sheetData.push([`Período evaluado: ${periodText}`]);
  sheetData.push([`Fecha y hora de generación: ${new Date().toLocaleString('es-DO')}`]);

  const hasActiveFilter = activeFilters && Object.values(activeFilters).some(v => v && v !== 'all');
  if (activeFilters) {
    const filterParts = [];
    if (activeFilters.salon && activeFilters.salon !== 'all') filterParts.push(`Sucursal: ${activeFilters.salon}`);
    if (activeFilters.plan && activeFilters.plan !== 'all') filterParts.push(`Plan: ${activeFilters.plan}`);
    if (activeFilters.status && activeFilters.status !== 'all') filterParts.push(`Estado: ${activeFilters.status}`);
    if (filterParts.length > 0) {
      sheetData.push([`Filtros aplicados: ${filterParts.join(' | ')}`]);
    }
  }
  sheetData.push([]);

  // KPIs Summary Block (Global metrics of the evaluated period)
  if (kpis && kpis.length > 0) {
    sheetData.push([`INDICADORES PRINCIPALES (KPIS) — TOTALES GLOBALES DEL PERÍODO`]);
    sheetData.push(kpis.map(k => k.label));
    sheetData.push(kpis.map(k => k.value));
    sheetData.push([]);
  }

  // Main Data Table (18 columns for recurring charges report)
  if (columns && columns.length > 0 && rows && rows.length > 0) {
    const filterSuffix = hasActiveFilter ? ' - VISTA FILTRADA' : '';
    sheetData.push([`DETALLE DE REGISTROS (${rows.length} ${rows.length === 1 ? 'registro' : 'registros'}${filterSuffix})`]);
    sheetData.push(columns.map(c => c.label));

    rows.forEach(row => {
      const rowData = columns.map(col => {
        if (col.key === 'accion') return 'Perfil';
        const val = row[col.key];
        if (val === undefined || val === null) return '';
        if (col.isCurrency && typeof val === 'number') return val;
        return sanitizeForExport(val);
      });
      sheetData.push(rowData);
    });
    sheetData.push([]);
  }

  // Appended Unmatched Payments Section (in primary sheet for unified reading)
  if (unmatchedTable && Array.isArray(unmatchedTable.rows) && unmatchedTable.rows.length > 0) {
    sheetData.push([`PAGOS PENDIENTES DE CONCILIACIÓN CONTRACTUAL`]);
    sheetData.push([
      `Transacciones aprobadas en pasarela sin referencia de contrato ni cuota identificable (${unmatchedTable.rows.length} ${unmatchedTable.rows.length === 1 ? 'pago' : 'pagos'}). No computan como recuperación de obligaciones.`
    ]);
    sheetData.push(unmatchedTable.columns.map(c => c.label));

    unmatchedTable.rows.forEach(r => {
      const rData = unmatchedTable.columns.map(col => {
        const val = r[col.key];
        if (val === undefined || val === null) return '';
        if (col.isCurrency && typeof val === 'number') return val;
        return sanitizeForExport(val);
      });
      sheetData.push(rData);
    });

    if (unmatchedTable.footerNote) {
      sheetData.push([]);
      sheetData.push([unmatchedTable.footerNote]);
    }
    sheetData.push([]);
  }

  const primarySheet = XLSX.utils.aoa_to_sheet(sheetData);
  XLSX.utils.book_append_sheet(workbook, primarySheet, 'Obligaciones');

  // --- SHEET 2: CONCILIACIÓN INDEPENDIENTE (Dedicated Audit Sheet) ---
  if (unmatchedTable && Array.isArray(unmatchedTable.rows) && unmatchedTable.rows.length > 0) {
    const unData = [];
    unData.push([`SISTEMA SALON PRO & PLAN BEAUTY RD`]);
    unData.push([`PAGOS PENDIENTES DE CONCILIACIÓN CONTRACTUAL`]);
    unData.push([`Período: ${periodText}`]);
    unData.push([`Total: ${unmatchedTable.rows.length} ${unmatchedTable.rows.length === 1 ? 'pago' : 'pagos'}`]);
    unData.push([`Auditoría: Transacciones aprobadas sin evidencia suficiente de cuota o contrato.`]);
    unData.push([]);

    unData.push(unmatchedTable.columns.map(c => c.label));
    unmatchedTable.rows.forEach(r => {
      const rData = unmatchedTable.columns.map(col => {
        const val = r[col.key];
        if (val === undefined || val === null) return '';
        if (col.isCurrency && typeof val === 'number') return val;
        return sanitizeForExport(val);
      });
      unData.push(rData);
    });

    if (unmatchedTable.footerNote) {
      unData.push([]);
      unData.push([unmatchedTable.footerNote]);
    }

    const unWorksheet = XLSX.utils.aoa_to_sheet(unData);
    XLSX.utils.book_append_sheet(workbook, unWorksheet, 'Conciliación');
  }

  return workbook;
};

/**
 * Generates CSV content formatted as UTF-8 with RFC-4180 escaping and formula injection protection.
 * Includes main table columns and appended unmatched payments section if present.
 */
export const generateCsvContent = ({
  title = 'Reporte',
  periodText = '',
  columns = [],
  rows = [],
  unmatchedTable = null,
  activeFilters = null
}) => {
  if (!columns || columns.length === 0 || !rows || rows.length === 0) {
    return '';
  }

  const lines = [];

  // Metadata headers
  lines.push(`"SISTEMA SALON PRO & PLAN BEAUTY RD"`);
  lines.push(`"REPORTE: ${String(title).toUpperCase()}"`);
  if (periodText) lines.push(`"Período evaluado: ${periodText}"`);
  lines.push(`"Fecha de Generación: ${new Date().toLocaleString('es-DO')}"`);

  const hasActiveFilter = activeFilters && Object.values(activeFilters).some(v => v && v !== 'all');
  if (activeFilters) {
    const filterParts = [];
    if (activeFilters.salon && activeFilters.salon !== 'all') filterParts.push(`Sucursal: ${activeFilters.salon}`);
    if (activeFilters.plan && activeFilters.plan !== 'all') filterParts.push(`Plan: ${activeFilters.plan}`);
    if (activeFilters.status && activeFilters.status !== 'all') filterParts.push(`Estado: ${activeFilters.status}`);
    if (filterParts.length > 0) {
      lines.push(`"Filtros aplicados: ${filterParts.join(' | ')}"`);
    }
  }
  lines.push('');

  // Main table headers & rows
  const filterSuffix = hasActiveFilter ? ' - VISTA FILTRADA' : '';
  lines.push(`"DETALLE DE OBLIGACIONES CONTRACTUALES (${rows.length} REGISTROS${filterSuffix})"`);
  lines.push(columns.map(c => `"${String(c.label).replace(/"/g, '""')}"`).join(','));

  rows.forEach(row => {
    const line = columns.map(col => {
      if (col.key === 'accion') return '"Perfil"';
      let val = row[col.key];
      val = sanitizeForExport(val);
      val = String(val).replace(/"/g, '""');
      return `"${val}"`;
    }).join(',');
    lines.push(line);
  });

  // Appended Unmatched Payments Section (B3.4 / B4)
  if (unmatchedTable && Array.isArray(unmatchedTable.rows) && unmatchedTable.rows.length > 0) {
    lines.push('');
    lines.push(`"PAGOS PENDIENTES DE CONCILIACIÓN CONTRACTUAL (${unmatchedTable.rows.length} REGISTROS)"`);
    lines.push(`"Transacciones aprobadas en pasarela sin referencia de contrato ni cuota identificable. Requieren revisión manual en CardNet / CRM."`);
    lines.push(unmatchedTable.columns.map(c => `"${String(c.label).replace(/"/g, '""')}"`).join(','));

    unmatchedTable.rows.forEach(r => {
      const line = unmatchedTable.columns.map(col => {
        let val = r[col.key];
        val = sanitizeForExport(val);
        val = String(val).replace(/"/g, '""');
        return `"${val}"`;
      }).join(',');
      lines.push(line);
    });

    if (unmatchedTable.footerNote) {
      lines.push('');
      lines.push(`"${String(unmatchedTable.footerNote).replace(/"/g, '""')}"`);
    }
  }

  return lines.join('\n');
};

/**
 * Triggers Excel (.xlsx) file download in the browser.
 */
export const exportReportToExcel = ({
  title,
  periodText,
  kpis = [],
  columns = [],
  rows = [],
  unmatchedTable = null,
  activeFilters = null
}) => {
  try {
    if (!columns || !rows || rows.length === 0) {
      alert('No hay datos disponibles para exportar en este período.');
      return;
    }

    const workbook = buildExcelWorkbook({
      title,
      periodText,
      kpis,
      columns,
      rows,
      unmatchedTable,
      activeFilters
    });

    const fileName = `${title.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  } catch (err) {
    console.error('Error exporting to Excel:', err);
    alert('Ocurrió un error al generar el archivo Excel: ' + err.message);
  }
};

/**
 * Triggers CSV (.csv) file download in the browser with UTF-8 BOM encoding.
 */
export const exportReportToCSV = ({
  title,
  periodText,
  columns = [],
  rows = [],
  unmatchedTable = null,
  activeFilters = null
}) => {
  try {
    if (!columns || !rows || rows.length === 0) {
      alert('No hay datos disponibles para exportar en este período.');
      return;
    }

    const csvBody = generateCsvContent({
      title,
      periodText,
      columns,
      rows,
      unmatchedTable,
      activeFilters
    });

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + csvBody;
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${title.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    console.error('Error exporting to CSV:', err);
    alert('Ocurrió un error al generar el archivo CSV.');
  }
};

/**
 * Triggers native browser print dialog (capable of "Guardar como PDF").
 */
export const triggerPrintReport = () => {
  window.print();
};
