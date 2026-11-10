import { sanitizeCellValue } from '../../utils/secureCsvExport';

/**
 * Sanitizes a cell value to prevent CSV / Excel formula injection (CSV Injection).
 * If the value starts with =, +, -, @, \t, or \r and is not a valid number,
 * it prepends a single quote (') so that spreadsheet processors treat it strictly as literal text.
 */
export const sanitizeForExport = (val) => sanitizeCellValue(val);

/**
 * Generates an XLSX Workbook data structure (Deprecated - redirects to secure CSV).
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
  return generateCsvContent({
    title,
    periodText,
    columns,
    rows,
    unmatchedTable,
    activeFilters
  });
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
 * Triggers Excel-compatible CSV file download in the browser with anti-injection protections.
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
  return exportReportToCSV({
    title,
    periodText,
    columns,
    rows,
    unmatchedTable,
    activeFilters
  });
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
