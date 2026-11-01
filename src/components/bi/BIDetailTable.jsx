import React, { useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight, MessageCircle, ExternalLink, X, User } from 'lucide-react';

const normalizeText = (text) => {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
};

export const BIDetailTable = ({
  title = 'Detalle de registros',
  badgeText = null,
  columns = [],
  rows = [],
  footerNote = null,
  emptyMessage = 'No hay registros disponibles para los filtros aplicados.',
  pageSize = 10
}) => {
  const navigate = useNavigate();
  const location = useLocation();

  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [rowsPerPage, setRowsPerPage] = useState(pageSize);

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

  // Filter rows based on search term with diacritic / accent normalization
  const filteredRows = useMemo(() => {
    if (!searchTerm.trim()) return rows;
    const term = normalizeText(searchTerm);
    return rows.filter(row => {
      return Object.values(row).some(val => {
        if (val === null || val === undefined) return false;
        if (typeof val === 'object') return false;
        return normalizeText(val).includes(term);
      });
    });
  }, [rows, searchTerm]);

  // Pagination calculation
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
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

        {/* Search & Page Size Select */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
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
                width: '210px',
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

      {/* Table Container */}
      <div style={{ overflowX: 'auto', border: '1px solid #f1f5f9', borderRadius: '0.5rem' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              {columns.map((col, idx) => (
                <th
                  key={idx}
                  style={{
                    padding: '0.75rem 1rem',
                    fontWeight: 600,
                    color: '#475569',
                    textAlign: col.align || 'left',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.length === 0 ? (
              <tr>
                <td 
                  colSpan={columns.length} 
                  style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b' }}
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paginatedRows.map((row, rIdx) => (
                <tr 
                  key={rIdx}
                  style={{ 
                    borderBottom: '1px solid #f1f5f9',
                    transition: 'background 0.1s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={(e) => e.currentTarget.style.background = '#ffffff'}
                >
                  {columns.map((col, cIdx) => {
                    const val = row[col.key];

                    // Client profile direct link
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
                              gap: '0.35rem',
                              textDecoration: 'none'
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

                    // Contact / Actions column
                    if (col.key === 'contacto' || col.key === 'acciones') {
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
                            {(row.telefono || row.phone) && (
                              <button
                                type="button"
                                onClick={() => handleWhatsAppClick(row.telefono || row.phone, row.cliente || row.client_name)}
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
                                onMouseEnter={(e) => e.currentTarget.style.background = '#d1fae5'}
                                onMouseLeave={(e) => e.currentTarget.style.background = '#ecfdf5'}
                              >
                                <MessageCircle size={14} color="#059669" />
                                <span>Contactar</span>
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    }

                    // Format amounts
                    if (col.isCurrency) {
                      return (
                        <td key={cIdx} style={{ padding: '0.75rem 1rem', textAlign: col.align || 'right', fontWeight: 700, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
                          RD$ {Number(val || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      );
                    }

                    // Status badge
                    if (col.isBadge) {
                      const isPositive = ['Facturado', 'Aprobado', 'Activo', 'Regresó'].includes(val);
                      const isNegative = ['Cancelado', 'Anulado', 'Rechazado', 'No regresó'].includes(val);
                      return (
                        <td key={cIdx} style={{ padding: '0.75rem 1rem', textAlign: col.align || 'center' }}>
                          <span style={{
                            padding: '0.2rem 0.55rem',
                            borderRadius: '9999px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            background: isPositive ? '#ecfdf5' : isNegative ? '#fff1f2' : '#f1f5f9',
                            color: isPositive ? '#059669' : isNegative ? '#e11d48' : '#475569'
                          }}>
                            {val || 'N/D'}
                          </span>
                        </td>
                      );
                    }

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
              ))
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

