import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Search, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  MessageCircle, ExternalLink, X, User, ArrowUpDown, Filter, Clock, AlertCircle, CheckCircle2, XCircle
} from 'lucide-react';

const normalizeText = (text) => {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
};

export const BIDetailTable = ({
  title = 'Detalle de registros',
  subtitle = null,
  badgeText = null,
  columns = [],
  rows = [],
  footerNote = null,
  emptyMessage = 'No hay registros disponibles para los filtros aplicados.',
  pageSize = 10,
  onFilteredRowsChange = null
}) => {
  const navigate = useNavigate();
  const location = useLocation();

  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState(() => {
    if (typeof window !== 'undefined') {
      const param = new URLSearchParams(window.location.search).get('filter_status');
      if (param) return param;
    }
    return 'all';
  });
  const [rowsPerPage, setRowsPerPage] = useState(pageSize);
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc'); // 'asc' | 'desc'
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [subPages, setSubPages] = useState({}); // rowKey -> subpage for attempts

  // Helper to navigate to client profile
  const handleViewProfile = (clientId, clientName) => {
    if (!clientId) return;
    navigate(`/clientes?id=${encodeURIComponent(clientId)}`, {
      state: {
        from: location.pathname + location.search,
        clientName: clientName || ''
      }
    });
  };

  // Auto-expand first row with multiple attempts if requested via URL param (for inspection / tests)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('expand_first') === '1' && rows.length > 0) {
      const target = rows.find(r => Array.isArray(r.attempts) && r.attempts.length > 1) || rows.find(r => Array.isArray(r.attempts) && r.attempts.length > 0);
      if (target) {
        const key = target.obligation_id || target.contract_id || target.transaccion_id || 0;
        setExpandedRows(new Set([key]));
        setTimeout(() => {
          const el = document.querySelector('[data-testid="expanded-attempts-row"]');
          if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
        }, 400);
      }
    }
    if (params.get('scroll_to') === 'unmatched') {
      setTimeout(() => {
        const el = document.querySelector('[data-testid="unmatched-payments-section"]');
        if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
      }, 400);
    }
  }, [rows]);

  // Determine if any row has attempts history (B3.2)
  const anyRowHasAttempts = useMemo(() => {
    return rows.some(r => Array.isArray(r.attempts) && r.attempts.length > 0);
  }, [rows]);

  // Extract unique statuses present in rows for the status dropdown filter
  const availableStatuses = useMemo(() => {
    const set = new Set();
    rows.forEach(r => {
      if (r.estado_corte) set.add(r.estado_corte);
      else if (r.estado_actual) set.add(r.estado_actual);
      else if (r.estado) set.add(r.estado);
      else if (r.estado_conciliacion) set.add(r.estado_conciliacion);
    });
    return Array.from(set).filter(Boolean);
  }, [rows]);

  // Toggle row expansion for attempt history
  const toggleRowExpansion = (rowId) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  };

  // Handle column sort
  const handleSort = (key) => {
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc');
      else {
        setSortKey(null);
        setSortDir('asc');
      }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setCurrentPage(1);
  };

  // 1. Filter rows based on search term & status filter
  const filteredRows = useMemo(() => {
    let result = rows;

    // Search filter with diacritic / accent normalization
    if (searchTerm.trim()) {
      const term = normalizeText(searchTerm);
      result = result.filter(row => {
        return Object.values(row).some(val => {
          if (val === null || val === undefined) return false;
          if (typeof val === 'object') return false;
          return normalizeText(val).includes(term);
        });
      });
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter(row => {
        return row.estado_corte === statusFilter ||
               row.estado_actual === statusFilter ||
               row.estado === statusFilter ||
               row.estado_conciliacion === statusFilter;
      });
    }

    // Sorting
    if (sortKey) {
      const colDef = columns.find(c => c.key === sortKey);
      const isCur = colDef?.isCurrency;

      result = [...result].sort((a, b) => {
        const valA = a[sortKey];
        const valB = b[sortKey];

        if (valA === valB) return 0;
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;

        let cmp = 0;
        if (isCur || typeof valA === 'number') {
          const numA = typeof valA === 'number' ? valA : (parseFloat(String(valA).replace(/[^0-9.-]+/g, '')) || 0);
          const numB = typeof valB === 'number' ? valB : (parseFloat(String(valB).replace(/[^0-9.-]+/g, '')) || 0);
          cmp = numA - numB;
        } else {
          cmp = String(valA).localeCompare(String(valB), 'es-DO', { sensitivity: 'base', numeric: true });
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return result;
  }, [rows, searchTerm, statusFilter, sortKey, sortDir, columns]);

  // Notify parent of current filtered rows for dynamic exports
  useEffect(() => {
    if (typeof onFilteredRowsChange === 'function') {
      onFilteredRowsChange(filteredRows);
    }
  }, [filteredRows, onFilteredRowsChange]);

  // 2. Pagination calculation
  const totalItems = filteredRows.length;
  const isAll = rowsPerPage === 'all';
  const effectivePageSize = isAll ? Math.max(totalItems, 1) : Number(rowsPerPage);
  const totalPages = Math.ceil(totalItems / effectivePageSize) || 1;
  const safePage = Math.min(currentPage, totalPages);

  const paginatedRows = useMemo(() => {
    if (isAll) return filteredRows;
    const start = (safePage - 1) * effectivePageSize;
    return filteredRows.slice(start, start + effectivePageSize);
  }, [filteredRows, safePage, effectivePageSize, isAll]);

  // Helper to open WhatsApp
  const handleWhatsAppClick = (phone, clientName) => {
    if (!phone) {
      alert('Este cliente no tiene un teléfono registrado.');
      return;
    }
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const targetPhone = cleanPhone.startsWith('1') ? cleanPhone : (cleanPhone.length === 10 ? `1${cleanPhone}` : `1809${cleanPhone}`);
    const message = encodeURIComponent(`Hola ${clientName || 'estimada socia'}, le saludamos de Abatte Peluquería & Plan Beauty RD.`);
    window.open(`https://wa.me/${targetPhone}?text=${message}`, '_blank');
  };

  // Helper for semantically coloring status badges
  const getBadgeStyle = (val) => {
    const s = String(val || '').trim();

    // Positive / Pagadas
    if (s.includes('Pagada') || s === 'Aprobado' || s === 'Activo' || s === 'Regresó') {
      return { bg: '#ecfdf5', textCol: '#059669', borderCol: '#a7f3d0' };
    }
    // Blue / Recuperada CardNet
    if (s.includes('Recuperada reintentos') || s === 'Pendiente') {
      return { bg: '#eff6ff', textCol: '#1d4ed8', borderCol: '#bfdbfe' };
    }
    // Purple / Recuperada caja / otra vía
    if (s.includes('Recuperada otra vía') || s.includes('otra vía')) {
      return { bg: '#f5f3ff', textCol: '#7c3aed', borderCol: '#ddd6fe' };
    }
    // Amber / Conciliación / Revisión / Auditoría
    if (s.includes('revisión') || s.includes('Revision') || s.includes('conciliación') || s.includes('auditoría') || s.includes('auditoria') || s.includes('Reintento Pendiente')) {
      return { bg: '#fffbeb', textCol: '#b45309', borderCol: '#fde68a' };
    }
    // Orange / Pendiente parcial
    if (s.includes('parcial') || s.includes('Parcial')) {
      return { bg: '#fff7ed', textCol: '#ea580c', borderCol: '#fed7aa' };
    }
    // Negative / Sin recuperar / Rechazado
    if (s.includes('Sin recuperar') || s === 'Cancelado' || s === 'Anulado' || s === 'Rechazado' || s === 'No regresó' || s === 'Vencida') {
      return { bg: '#fff1f2', textCol: '#e11d48', borderCol: '#fecdd3' };
    }

    return { bg: '#f1f5f9', textCol: '#475569', borderCol: '#e2e8f0' };
  };

  return (
    <div style={{
      background: '#ffffff',
      borderRadius: '1rem',
      padding: '1.5rem',
      border: '1px solid #e2e8f0',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      marginBottom: '1.5rem'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem',
        marginBottom: '1.25rem'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>
              {title}
            </h3>
            {badgeText && (
              <span style={{
                background: '#f1f5f9',
                color: '#475569',
                padding: '0.2rem 0.6rem',
                borderRadius: '9999px',
                fontSize: '0.78rem',
                fontWeight: 600,
                border: '1px solid #e2e8f0'
              }}>
                {badgeText}
              </span>
            )}
          </div>
          {subtitle && (
            <div style={{ fontSize: '0.8rem', color: '#64748b', maxWidth: '650px', lineHeight: 1.4 }}>
              {subtitle}
            </div>
          )}
        </div>

        {/* Filters, Search & Page Size Select */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          {/* Status Filter Dropdown (if multiple statuses exist) */}
          {availableStatuses.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Filter size={14} color="#64748b" />
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setCurrentPage(1);
                }}
                style={{
                  padding: '0.4rem 0.65rem',
                  fontSize: '0.8rem',
                  borderRadius: '0.5rem',
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  color: '#1e293b',
                  fontWeight: 600,
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                <option value="all">Todos los estados</option>
                {availableStatuses.map((st, sIdx) => (
                  <option key={sIdx} value={st}>{st}</option>
                ))}
              </select>
            </div>
          )}

          {/* Search Box */}
          <div style={{ position: 'relative' }}>
            <Search
              size={14}
              style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}
            />
            <input
              type="text"
              placeholder="Buscar en tabla..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              style={{
                padding: '0.45rem 1.8rem 0.45rem 2rem',
                fontSize: '0.82rem',
                border: '1px solid #cbd5e1',
                borderRadius: '0.5rem',
                outline: 'none',
                width: '190px',
                background: '#f8fafc',
                color: '#1e293b'
              }}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => { setSearchTerm(''); setCurrentPage(1); }}
                style={{
                  position: 'absolute',
                  right: '6px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#94a3b8',
                  padding: '2px',
                  display: 'flex',
                  alignItems: 'center'
                }}
                title="Limpiar búsqueda"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Rows per page select */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: '#64748b' }}>
            <span style={{ fontWeight: 600 }}>Filas:</span>
            <select
              value={rowsPerPage}
              onChange={(e) => {
                setRowsPerPage(e.target.value === 'all' ? 'all' : Number(e.target.value));
                setCurrentPage(1);
              }}
              style={{
                padding: '0.35rem 0.55rem',
                borderRadius: '0.5rem',
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                fontSize: '0.8rem',
                fontWeight: 700,
                color: '#0f172a',
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value="all">Todas</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table Container with Native Responsive Scroll */}
      <div style={{
        overflowX: 'auto',
        border: '1px solid #f1f5f9',
        borderRadius: '0.5rem',
        WebkitOverflowScrolling: 'touch'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              {anyRowHasAttempts && (
                <th style={{ width: '38px', padding: '0.75rem 0.5rem', textAlign: 'center' }} title="Expandir intentos">
                  <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>#</span>
                </th>
              )}
              {columns.map((col, idx) => {
                const isCurrentSort = sortKey === col.key;
                return (
                  <th
                    key={idx}
                    onClick={() => handleSort(col.key)}
                    style={{
                      padding: '0.75rem 1rem',
                      fontWeight: 700,
                      color: isCurrentSort ? '#0f172a' : '#475569',
                      textAlign: col.align || 'left',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                      userSelect: 'none',
                      transition: 'color 0.15s ease'
                    }}
                    title={`Ordenar por ${col.label}`}
                  >
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      justifyContent: col.align === 'center' ? 'center' : (col.align === 'right' ? 'flex-end' : 'flex-start')
                    }}>
                      <span>{col.label}</span>
                      {isCurrentSort ? (
                        sortDir === 'asc' ? <ChevronUp size={13} color="#2563eb" /> : <ChevronDown size={13} color="#2563eb" />
                      ) : (
                        <ArrowUpDown size={11} color="#cbd5e1" />
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (anyRowHasAttempts ? 1 : 0)}
                  style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b' }}
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paginatedRows.map((row, rIdx) => {
                const rowKey = row.obligation_id || row.contract_id || row.transaccion_id || rIdx;
                const hasAttempts = Array.isArray(row.attempts) && row.attempts.length > 0;
                const isExpanded = expandedRows.has(rowKey);

                // Subtable attempts pagination
                const subPageSize = 10;
                const currentSubPage = subPages[rowKey] || 1;
                const totalSubItems = hasAttempts ? row.attempts.length : 0;
                const totalSubPages = Math.ceil(totalSubItems / subPageSize) || 1;
                const paginatedAttempts = hasAttempts
                  ? row.attempts.slice((currentSubPage - 1) * subPageSize, currentSubPage * subPageSize)
                  : [];

                return (
                  <React.Fragment key={rowKey}>
                    <tr
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        background: isExpanded ? '#f8fafc' : '#ffffff',
                        transition: 'background 0.1s ease'
                      }}
                      onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = '#fafafa'; }}
                      onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = '#ffffff'; }}
                    >
                      {/* Expand Toggle Button */}
                      {anyRowHasAttempts && (
                        <td style={{ padding: '0.75rem 0.5rem', textAlign: 'center' }}>
                          {hasAttempts ? (
                            <button
                              type="button"
                              data-testid="expand-row-btn"
                              data-attempts={row.attempts.length}
                              onClick={() => toggleRowExpansion(rowKey)}
                              title={isExpanded ? 'Ocultar historial de intentos' : `Ver ${row.attempts.length} intentos`}
                              style={{
                                background: isExpanded ? '#2563eb' : '#f1f5f9',
                                color: isExpanded ? '#ffffff' : '#64748b',
                                border: '1px solid #e2e8f0',
                                borderRadius: '0.375rem',
                                width: '26px',
                                height: '26px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                          ) : (
                            <span style={{ color: '#cbd5e1' }}>—</span>
                          )}
                        </td>
                      )}

                      {columns.map((col, cIdx) => {
                        const val = row[col.key];

                        // Client direct link
                        if ((col.key === 'cliente' || col.key === 'client_name') && row.client_id) {
                          return (
                            <td key={cIdx} style={{ padding: '0.75rem 1rem', textAlign: col.align || 'left' }}>
                              <button
                                type="button"
                                onClick={() => handleViewProfile(row.client_id, val)}
                                title={`Abrir perfil de ${val}`}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  padding: 0,
                                  margin: 0,
                                  font: 'inherit',
                                  fontWeight: 700,
                                  color: '#1d4ed8',
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.35rem'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
                                onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
                              >
                                <span>{val}</span>
                                <ExternalLink size={12} color="#93c5fd" />
                              </button>
                            </td>
                          );
                        }

                        // Perfil action button
                        if (col.key === 'accion' || col.key === 'acciones' || col.key === 'contacto') {
                          return (
                            <td key={cIdx} style={{ padding: '0.75rem 1rem', textAlign: col.align || 'left' }}>
                              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: col.align === 'center' ? 'center' : 'flex-start', gap: '0.45rem', flexWrap: 'wrap' }}>
                                {row.client_id && (
                                  <button
                                    type="button"
                                    onClick={() => handleViewProfile(row.client_id, row.cliente || row.client_name)}
                                    title={`Abrir perfil de ${row.cliente || row.client_name || 'la clienta'}`}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '0.35rem',
                                      background: '#eff6ff',
                                      color: '#1d4ed8',
                                      border: '1px solid #bfdbfe',
                                      borderRadius: '0.375rem',
                                      padding: '0.3rem 0.6rem',
                                      fontSize: '0.78rem',
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      transition: 'all 0.15s ease'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#dbeafe'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = '#eff6ff'}
                                  >
                                    <User size={13} color="#1d4ed8" />
                                    <span>Perfil</span>
                                  </button>
                                )}
                                {(row.telefono || row.phone) && col.key !== 'accion' && (
                                  <button
                                    type="button"
                                    onClick={() => handleWhatsAppClick(row.telefono || row.phone, row.cliente || row.client_name)}
                                    title={`Abrir WhatsApp con ${row.cliente || row.client_name || 'la clienta'}`}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '0.4rem',
                                      background: '#ecfdf5',
                                      color: '#059669',
                                      border: '1px solid #a7f3d0',
                                      borderRadius: '0.375rem',
                                      padding: '0.3rem 0.65rem',
                                      fontSize: '0.78rem',
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      transition: 'all 0.15s ease'
                                    }}
                                  >
                                    <MessageCircle size={14} color="#059669" />
                                    <span>Contactar</span>
                                  </button>
                                )}
                              </div>
                            </td>
                          );
                        }

                        // Currency formatted columns
                        if (col.isCurrency) {
                          const numericVal = typeof val === 'number' ? val : (parseFloat(String(val || '').replace(/[^0-9.-]+/g, '')) || 0);
                          return (
                            <td key={cIdx} style={{ padding: '0.75rem 1rem', textAlign: col.align || 'right', fontWeight: 700, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
                              RD$ {numericVal.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          );
                        }

                        // State & Badge columns (estado_corte, estado_actual, estado, isBadge)
                        if (col.isBadge || col.key === 'estado_corte' || col.key === 'estado_actual' || col.key === 'estado' || col.key === 'estado_conciliacion') {
                          const badge = getBadgeStyle(val);
                          return (
                            <td key={cIdx} style={{ padding: '0.75rem 1rem', textAlign: col.align || 'center' }}>
                              <span style={{
                                display: 'inline-block',
                                padding: '0.2rem 0.6rem',
                                borderRadius: '9999px',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                background: badge.bg,
                                color: badge.textCol,
                                border: `1px solid ${badge.borderCol}`,
                                whiteSpace: 'nowrap'
                              }}>
                                {val || 'N/D'}
                              </span>
                            </td>
                          );
                        }

                        // Normal data cell
                        return (
                          <td
                            key={cIdx}
                            style={{
                              padding: '0.75rem 1rem',
                              textAlign: col.align || 'left',
                              color: '#334155'
                            }}
                          >
                            {val !== undefined && val !== null && val !== '' ? val : (col.fallback || '—')}
                          </td>
                        );
                      })}
                    </tr>

                    {/* EXPANDED ROW: ATTEMPTS HISTORY (B3.2) */}
                    {hasAttempts && isExpanded && (
                      <tr style={{ background: '#f8fafc' }} data-testid="expanded-attempts-row">
                        <td
                          colSpan={columns.length + (anyRowHasAttempts ? 1 : 0)}
                          style={{ padding: '1rem 1.25rem', borderBottom: '2px solid #e2e8f0' }}
                        >
                          <div style={{
                            background: '#ffffff',
                            borderRadius: '0.75rem',
                            border: '1px solid #e2e8f0',
                            padding: '1rem 1.25rem',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
                          }}>
                            {/* Subtable Header */}
                            <div style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: '0.75rem',
                              marginBottom: '0.85rem',
                              paddingBottom: '0.65rem',
                              borderBottom: '1px solid #f1f5f9'
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Clock size={16} color="#2563eb" />
                                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0f172a' }}>
                                  Historial de intentos de cobro ({totalSubItems} {totalSubItems === 1 ? 'intento registrado' : 'intentos registrados'})
                                </span>
                                <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                                  — Contrato #{row.contract_id || row.contrato} ({row.cliente})
                                </span>
                              </div>

                              {/* Subtable Pagination (for cases with up to 90 attempts) */}
                              {totalSubPages > 1 && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: '#64748b' }}>
                                  <span>Página <strong>{currentSubPage}</strong> de <strong>{totalSubPages}</strong></span>
                                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                                    <button
                                      type="button"
                                      disabled={currentSubPage <= 1}
                                      onClick={() => setSubPages(p => ({ ...p, [rowKey]: Math.max((p[rowKey] || 1) - 1, 1) }))}
                                      style={{
                                        padding: '0.2rem 0.5rem',
                                        borderRadius: '0.25rem',
                                        border: '1px solid #cbd5e1',
                                        background: '#ffffff',
                                        cursor: currentSubPage <= 1 ? 'not-allowed' : 'pointer',
                                        opacity: currentSubPage <= 1 ? 0.4 : 1
                                      }}
                                    >
                                      Anterior
                                    </button>
                                    <button
                                      type="button"
                                      disabled={currentSubPage >= totalSubPages}
                                      onClick={() => setSubPages(p => ({ ...p, [rowKey]: Math.min((p[rowKey] || 1) + 1, totalSubPages) }))}
                                      style={{
                                        padding: '0.2rem 0.5rem',
                                        borderRadius: '0.25rem',
                                        border: '1px solid #cbd5e1',
                                        background: '#ffffff',
                                        cursor: currentSubPage >= totalSubPages ? 'not-allowed' : 'pointer',
                                        opacity: currentSubPage >= totalSubPages ? 0.4 : 1
                                      }}
                                    >
                                      Siguiente
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Subtable Canvas */}
                            <div style={{ overflowX: 'auto' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                                <thead>
                                  <tr style={{ background: '#f8fafc', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>
                                    <th style={{ padding: '0.5rem 0.75rem', width: '50px' }}>#</th>
                                    <th style={{ padding: '0.5rem 0.75rem' }}>Fecha y hora</th>
                                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>Resultado</th>
                                    <th style={{ padding: '0.5rem 0.75rem' }}>Método</th>
                                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>Código CardNet</th>
                                    <th style={{ padding: '0.5rem 0.75rem' }}>Descripción segura</th>
                                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>Importe</th>
                                    <th style={{ padding: '0.5rem 0.75rem' }}>Referencia segura</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {paginatedAttempts.map((att, aIdx) => {
                                    const isAppr = att.resultado === 'Aprobado';
                                    const isConn = String(att.resultado || '').includes('Error_Conexion');
                                    const resBg = isAppr ? '#ecfdf5' : (isConn ? '#f1f5f9' : '#fef2f2');
                                    const resColor = isAppr ? '#059669' : (isConn ? '#475569' : '#dc2626');
                                    const resBorder = isAppr ? '#a7f3d0' : (isConn ? '#cbd5e1' : '#fecaca');

                                    return (
                                      <tr key={aIdx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                        <td style={{ padding: '0.5rem 0.75rem', fontWeight: 700, color: '#64748b' }}>
                                          #{att.intento_num}
                                        </td>
                                        <td style={{ padding: '0.5rem 0.75rem', color: '#1e293b', whiteSpace: 'nowrap' }}>
                                          {att.fecha_hora}
                                        </td>
                                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                                          <span style={{
                                            padding: '0.15rem 0.55rem',
                                            borderRadius: '9999px',
                                            fontSize: '0.72rem',
                                            fontWeight: 700,
                                            background: resBg,
                                            color: resColor,
                                            border: `1px solid ${resBorder}`
                                          }}>
                                            {att.resultado}
                                          </span>
                                        </td>
                                        <td style={{ padding: '0.5rem 0.75rem', color: '#475569' }}>
                                          {att.metodo}
                                        </td>
                                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                                          <span style={{
                                            fontFamily: 'monospace',
                                            fontWeight: 700,
                                            fontSize: '0.75rem',
                                            background: '#f8fafc',
                                            padding: '0.15rem 0.45rem',
                                            borderRadius: '4px',
                                            border: '1px solid #e2e8f0',
                                            color: isAppr ? '#059669' : '#b45309'
                                          }}>
                                            {att.codigo_respuesta || 'N/D'}
                                          </span>
                                        </td>
                                        <td style={{ padding: '0.5rem 0.75rem', color: '#334155' }}>
                                          {att.descripcion_segura}
                                        </td>
                                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>
                                          RD$ {(parseFloat(att.importe_intentado) || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                        <td style={{ padding: '0.5rem 0.75rem', color: '#64748b', fontFamily: 'monospace', fontSize: '0.74rem' }}>
                                          {att.referencia_enmascarada || '—'}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer: Pagination & Note */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem',
        marginTop: '1.25rem',
        fontSize: '0.82rem',
        color: '#64748b'
      }}>
        <div>
          Mostrando <strong>{totalItems > 0 ? (safePage - 1) * effectivePageSize + 1 : 0}</strong> - <strong>{Math.min(safePage * effectivePageSize, totalItems)}</strong> de <strong>{totalItems}</strong> registros
          {rows.length !== totalItems && (
            <span style={{ color: '#94a3b8', marginLeft: '0.4rem' }}>
              (filtrados de {rows.length})
            </span>
          )}
        </div>

        {/* Pagination Buttons */}
        {!isAll && totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '0.375rem',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: safePage <= 1 ? 'not-allowed' : 'pointer',
                opacity: safePage <= 1 ? 0.4 : 1
              }}
            >
              <ChevronLeft size={16} />
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 2)
              .map((p, idx, arr) => {
                const prev = arr[idx - 1];
                const active = p === safePage;
                return (
                  <React.Fragment key={p}>
                    {prev && p - prev > 1 && <span style={{ padding: '0 0.2rem' }}>...</span>}
                    <button
                      type="button"
                      onClick={() => setCurrentPage(p)}
                      style={{
                        minWidth: '32px',
                        height: '32px',
                        padding: '0 0.5rem',
                        borderRadius: '0.375rem',
                        border: active ? 'none' : '1px solid #cbd5e1',
                        background: active ? '#2563eb' : '#ffffff',
                        color: active ? '#ffffff' : '#334155',
                        fontWeight: active ? 700 : 500,
                        cursor: 'pointer'
                      }}
                    >
                      {p}
                    </button>
                  </React.Fragment>
                );
              })}

            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '0.375rem',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: safePage >= totalPages ? 'not-allowed' : 'pointer',
                opacity: safePage >= totalPages ? 0.4 : 1
              }}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Footnote if required by specification */}
      {footerNote && (
        <div style={{
          marginTop: '1rem',
          paddingTop: '0.75rem',
          borderTop: '1px solid #f1f5f9',
          fontSize: '0.78rem',
          color: '#64748b',
          fontStyle: 'italic'
        }}>
          {footerNote}
        </div>
      )}
    </div>
  );
};

export default BIDetailTable;
