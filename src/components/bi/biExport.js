import * as XLSX from 'xlsx';

/**
 * Utility to export report data to Excel (.xlsx) and CSV
 */
export const exportReportToExcel = ({ title, periodText, kpis = [], columns = [], rows = [] }) => {
  try {
    const workbook = XLSX.utils.book_new();

    // 1. Prepare Header and Metadata sheet
    const sheetData = [];
    sheetData.push([`SISTEMA SALON PRO & PLAN BEAUTY RD`]);
    sheetData.push([`REPORTE DE INTELIGENCIA DE NEGOCIOS: ${title.toUpperCase()}`]);
    sheetData.push([`Período: ${periodText}`]);
    sheetData.push([`Fecha de Generación: ${new Date().toLocaleString('es-DO')}`]);
    sheetData.push([]);

    // 2. Add KPIs summary if available
    if (kpis && kpis.length > 0) {
      sheetData.push([`INDICADORES PRINCIPALES (KPIS)`]);
      const kpiHeaders = kpis.map(k => k.label);
      const kpiValues = kpis.map(k => k.value);
      sheetData.push(kpiHeaders);
      sheetData.push(kpiValues);
      sheetData.push([]);
    }

    // 3. Add Table Data
    if (columns && columns.length > 0 && rows && rows.length > 0) {
      sheetData.push([`DETALLE DE REGISTROS`]);
      const tableHeaders = columns.map(c => c.label);
      sheetData.push(tableHeaders);

      rows.forEach(row => {
        const rowData = columns.map(col => {
          const val = row[col.key];
          return val !== undefined && val !== null ? val : '';
        });
        sheetData.push(rowData);
      });
    }

    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Reporte');

    const fileName = `${title.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  } catch (err) {
    console.error('Error exporting to Excel:', err);
    alert('Ocurrió un error al generar el archivo Excel: ' + err.message);
  }
};

export const exportReportToCSV = ({ title, columns = [], rows = [] }) => {
  try {
    if (!columns || !rows || rows.length === 0) {
      alert('No hay datos disponibles para exportar en este período.');
      return;
    }

    const headers = columns.map(c => `"${c.label}"`).join(',');
    const csvRows = rows.map(row => {
      return columns.map(col => {
        let val = row[col.key];
        if (val === undefined || val === null) val = '';
        val = String(val).replace(/"/g, '""');
        return `"${val}"`;
      }).join(',');
    });

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers, ...csvRows].join('\n');
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

export const triggerPrintReport = () => {
  window.print();
};

