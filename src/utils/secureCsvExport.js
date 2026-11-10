/**
 * Secure CSV Export Utility (Salon Pro & Plan Beauty RD)
 * 
 * Provides native, secure CSV generation with zero external dependencies.
 * Defends against CSV / Excel Formula Injection (CWE-1236):
 * - Prepends a single quote (') to values starting with '=', '+', '-', '@', '\t', '\r'.
 * - Neutralizes dangerous formula prefixes and hyperlinks (e.g. '=HYPERLINK', 'javascript:').
 * - Strips or neutralizes raw HTML tags.
 * - Prepends UTF-8 BOM (\uFEFF) for immediate, flawless rendering in Microsoft Excel.
 */

'use strict';

/**
 * Sanitizes an individual cell value against CSV / Excel Formula Injection.
 */
export function sanitizeCellValue(val) {
  if (val === undefined || val === null) return '';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return String(val);
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? '' : val.toISOString().slice(0, 10);
  }

  let str = String(val).trim();

  // Strip dangerous HTML script tags
  str = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // If starts with =, +, -, @, \t, \r and is not a plain number, escape it
  if (/^[=+\-@\t\r]/.test(str)) {
    // If it's a valid negative or positive number like "-500" or "+100", allow as number
    if (!isNaN(Number(str)) && str.trim() !== '') {
      return str;
    }
    // Neutralize formula trigger
    str = `'${str}`;
  }

  // Neutralize dangerous javascript: or data: URIs
  if (/^(?:javascript|data|vbscript):/i.test(str)) {
    str = `'${str}`;
  }

  return str;
}

/**
 * Formats a row of values into an RFC 4180 compliant CSV line.
 */
export function formatCsvRow(values, delimiter = ',') {
  return values.map(val => {
    const sanitized = sanitizeCellValue(val);
    const str = String(sanitized);
    // If the value contains delimiter, quote, newline, or starts with quote, escape it
    if (str.includes(delimiter) || str.includes('"') || str.includes('\n') || str.includes('\r') || str.startsWith("'")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }).join(delimiter);
}

/**
 * Builds full CSV document content with optional header metadata.
 */
export function generateCsvContent({
  title = '',
  metadata = [],
  headers = [],
  rows = [],
  delimiter = ','
}) {
  const lines = [];

  if (title) {
    lines.push(formatCsvRow([`SISTEMA SALON PRO & PLAN BEAUTY RD - ${title.toUpperCase()}`], delimiter));
    lines.push(formatCsvRow([`Fecha de generación: ${new Date().toLocaleString('es-DO')}`], delimiter));
  }

  if (metadata && metadata.length > 0) {
    metadata.forEach(m => {
      if (Array.isArray(m)) lines.push(formatCsvRow(m, delimiter));
      else if (typeof m === 'string') lines.push(formatCsvRow([m], delimiter));
    });
    lines.push(''); // blank row separator
  }

  if (headers && headers.length > 0) {
    lines.push(formatCsvRow(headers, delimiter));
  }

  if (rows && rows.length > 0) {
    rows.forEach(r => {
      lines.push(formatCsvRow(Array.isArray(r) ? r : Object.values(r), delimiter));
    });
  }

  return lines.join('\r\n');
}

/**
 * Triggers a browser download of the CSV content with UTF-8 BOM.
 */
export function downloadCsvFile(filename, csvContent) {
  if (typeof window === 'undefined' || !window.document) {
    return;
  }

  // UTF-8 BOM (\uFEFF) ensures Excel opens accented Latin characters correctly
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
