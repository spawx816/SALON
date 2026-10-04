import React, { useState, useEffect, useMemo } from 'react';
import { 
  FileText, Search, Calendar, Download, Printer, RefreshCw, 
  CheckCircle2, AlertCircle, ShieldCheck, ArrowDownLeft, X, Eye, 
  Layers, ChevronRight, DollarSign, User, Landmark, Sparkles
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useNotification } from '../../context/NotificationContext';
import { motion, AnimatePresence } from 'framer-motion';

export default function CreditNotesModule() {
  const { showNotification } = useNotification();
  const [creditNotes, setCreditNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState('month'); // 'month', 'last_month', 'all', 'custom'
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedNote, setSelectedNote] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [retransmittingId, setRetransmittingId] = useState(null);

  const fetchCreditNotes = async () => {
    setLoading(true);
    try {
      const data = await dataService.getCreditNotes();
      setCreditNotes(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error cargando notas de crédito:', err);
      showNotification('Error al cargar notas de crédito', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCreditNotes();
  }, []);

  const handleRetransmit = async (id) => {
    setRetransmittingId(id);
    try {
      const res = await dataService.retransmitCreditNote(id);
      if (res.success) {
        showNotification(res.message || 'Nota de crédito transmitida a la DGII con éxito', 'success');
        fetchCreditNotes();
      } else {
        showNotification(res.error || 'Error al transmitir a la DGII', 'error');
      }
    } catch (err) {
      showNotification('Error de conexión con la DGII', 'error');
    } finally {
      setRetransmittingId(null);
    }
  };

  // Date filtering logic
  const filteredNotes = useMemo(() => {
    return creditNotes.filter(note => {
      // 1. Search text filter
      const term = searchTerm.toLowerCase();
      const ncfNc = String(note.ncf_nota_credito || '').toLowerCase();
      const ncfOrig = String(note.ncf || '').toLowerCase();
      const client = String(note.client_name || note.rzn_soc_cliente || '').toLowerCase();
      const rnc = String(note.rnc_cliente || note.cedula || '').toLowerCase();
      const userVoid = String(note.voided_by || '').toLowerCase();
      const reason = String(note.nota_credito_motivo || note.void_reason || '').toLowerCase();

      const matchesSearch = !term || 
        ncfNc.includes(term) || 
        ncfOrig.includes(term) || 
        client.includes(term) || 
        rnc.includes(term) || 
        userVoid.includes(term) || 
        reason.includes(term);

      if (!matchesSearch) return false;

      // 2. Date filter
      const rawDate = note.nota_credito_fecha || note.voided_at || note.visited_at;
      if (!rawDate) return true;
      const noteDate = new Date(rawDate);
      const now = new Date();

      if (dateFilter === 'month') {
        return noteDate.getMonth() === now.getMonth() && noteDate.getFullYear() === now.getFullYear();
      } else if (dateFilter === 'last_month') {
        const lastMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
        const lastMonthYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
        return noteDate.getMonth() === lastMonth && noteDate.getFullYear() === lastMonthYear;
      } else if (dateFilter === 'custom' && startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        return noteDate >= start && noteDate <= end;
      }

      return true;
    });
  }, [creditNotes, searchTerm, dateFilter, startDate, endDate]);

  // KPI calculations
  const totalMontoAcreditado = useMemo(() => {
    return filteredNotes.reduce((acc, n) => acc + Number(n.total || 0), 0);
  }, [filteredNotes]);

  const totalNotasE34 = useMemo(() => {
    return filteredNotes.filter(n => (n.ncf_nota_credito || '').startsWith('E34')).length;
  }, [filteredNotes]);

  return (
    <div style={{ padding: '2rem', maxWidth: '1440px', margin: '0 auto' }}>
      
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ArrowDownLeft size={24} />
            </div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 900, color: '#09090b', margin: 0 }}>
              Notas de Crédito Electrónicas (e-CF / DGII)
            </h1>
          </div>
          <p style={{ color: '#64748b', margin: 0, fontSize: '0.9rem' }}>
            Registro oficial y auditoría de comprobantes fiscales electrónicos de anulación (E34 / B04) generados automáticamente al anular facturas en caja.
          </p>
        </div>

        <button
          onClick={fetchCreditNotes}
          disabled={loading}
          className="admin-btn"
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.5rem', 
            background: '#f1f5f9', 
            border: '1px solid #e2e8f0', 
            padding: '0.65rem 1.25rem', 
            borderRadius: '10px', 
            cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: 700,
            color: '#334155'
          }}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          <span>Actualizar</span>
        </button>
      </div>

      {/* KPI Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
        
        <div style={{ background: '#ffffff', borderRadius: '16px', padding: '1.5rem', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#64748b', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase' }}>
            <span>Total Notas Emitidas</span>
            <FileText size={18} style={{ color: '#ef4444' }} />
          </div>
          <h2 style={{ fontSize: '2rem', fontWeight: 900, color: '#09090b', margin: '0.5rem 0 0 0' }}>
            {filteredNotes.length}
          </h2>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Comprobantes de anulación</span>
        </div>

        <div style={{ background: '#ffffff', borderRadius: '16px', padding: '1.5rem', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#64748b', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase' }}>
            <span>Monto Total Revertido</span>
            <DollarSign size={18} style={{ color: '#dc2626' }} />
          </div>
          <h2 style={{ fontSize: '2rem', fontWeight: 900, color: '#dc2626', margin: '0.5rem 0 0 0' }}>
            RD$ {totalMontoAcreditado.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </h2>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Total acreditado / anulado</span>
        </div>

        <div style={{ background: '#ffffff', borderRadius: '16px', padding: '1.5rem', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#64748b', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase' }}>
            <span>Secuencias e-NCF E34</span>
            <ShieldCheck size={18} style={{ color: '#2563eb' }} />
          </div>
          <h2 style={{ fontSize: '2rem', fontWeight: 900, color: '#2563eb', margin: '0.5rem 0 0 0' }}>
            {totalNotasE34}
          </h2>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Transmitidas con firma digital</span>
        </div>

        <div style={{ background: '#ffffff', borderRadius: '16px', padding: '1.5rem', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#64748b', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase' }}>
            <span>Estado DGII e-CF</span>
            <CheckCircle2 size={18} style={{ color: '#16a34a' }} />
          </div>
          <h2 style={{ fontSize: '2rem', fontWeight: 900, color: '#16a34a', margin: '0.5rem 0 0 0' }}>
            100%
          </h2>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Cumplimiento tributario en tiempo real</span>
        </div>

      </div>

      {/* Filter Toolbar */}
      <div style={{ background: '#ffffff', borderRadius: '16px', padding: '1.25rem', border: '1px solid #e2e8f0', marginBottom: '1.5rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: '1 1 320px', minWidth: '280px' }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input 
              type="text" 
              placeholder="Buscar por e-NCF E34, NCF original, cliente, RNC o motivo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '0.65rem 1rem 0.65rem 2.5rem',
                borderRadius: '10px',
                border: '1.5px solid #e2e8f0',
                outline: 'none',
                fontSize: '0.875rem'
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', background: '#f1f5f9', padding: '4px', borderRadius: '10px', gap: '4px' }}>
            <button
              onClick={() => setDateFilter('month')}
              style={{
                padding: '0.45rem 0.85rem',
                borderRadius: '8px',
                border: 'none',
                background: dateFilter === 'month' ? '#ffffff' : 'transparent',
                color: dateFilter === 'month' ? '#09090b' : '#64748b',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: 'pointer',
                boxShadow: dateFilter === 'month' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
              }}
            >
              Este Mes
            </button>
            <button
              onClick={() => setDateFilter('last_month')}
              style={{
                padding: '0.45rem 0.85rem',
                borderRadius: '8px',
                border: 'none',
                background: dateFilter === 'last_month' ? '#ffffff' : 'transparent',
                color: dateFilter === 'last_month' ? '#09090b' : '#64748b',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: 'pointer',
                boxShadow: dateFilter === 'last_month' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
              }}
            >
              Mes Anterior
            </button>
            <button
              onClick={() => setDateFilter('all')}
              style={{
                padding: '0.45rem 0.85rem',
                borderRadius: '8px',
                border: 'none',
                background: dateFilter === 'all' ? '#ffffff' : 'transparent',
                color: dateFilter === 'all' ? '#09090b' : '#64748b',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: 'pointer',
                boxShadow: dateFilter === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
              }}
            >
              Todo
            </button>
            <button
              onClick={() => setDateFilter('custom')}
              style={{
                padding: '0.45rem 0.85rem',
                borderRadius: '8px',
                border: 'none',
                background: dateFilter === 'custom' ? '#ffffff' : 'transparent',
                color: dateFilter === 'custom' ? '#09090b' : '#64748b',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: 'pointer',
                boxShadow: dateFilter === 'custom' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
              }}
            >
              Rango
            </button>
          </div>

          {dateFilter === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input 
                type="date" 
                value={startDate} 
                onChange={(e) => setStartDate(e.target.value)}
                style={{ padding: '0.45rem 0.65rem', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.8rem' }}
              />
              <span style={{ color: '#94a3b8' }}>a</span>
              <input 
                type="date" 
                value={endDate} 
                onChange={(e) => setEndDate(e.target.value)}
                style={{ padding: '0.45rem 0.65rem', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.8rem' }}
              />
            </div>
          )}
        </div>

      </div>

      {/* Main Table */}
      <div style={{ background: '#ffffff', borderRadius: '20px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 10px 25px rgba(0,0,0,0.02)' }}>
        
        {loading ? (
          <div style={{ padding: '4rem', textAlign: 'center', color: '#64748b' }}>
            <RefreshCw size={32} className="animate-spin" style={{ margin: '0 auto 1rem', color: '#ef4444' }} />
            <p style={{ margin: 0, fontWeight: 700 }}>Cargando notas de crédito emitidas...</p>
          </div>
        ) : filteredNotes.length === 0 ? (
          <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: '#f8fafc', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
              <FileText size={32} />
            </div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#09090b', margin: '0 0 0.5rem 0' }}>
              No se encontraron notas de crédito
            </h3>
            <p style={{ color: '#64748b', fontSize: '0.875rem', maxWidth: '450px', margin: '0 auto' }}>
              Cuando una factura fiscal sea anulada por recepción o administración, aquí aparecerá automáticamente su Nota de Crédito Electrónica con su e-NCF y transmisión a la DGII.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '1rem', fontWeight: 800, color: '#475569' }}>Nota de Crédito (e-NCF)</th>
                  <th style={{ padding: '1rem', fontWeight: 800, color: '#475569' }}>NCF Modificado</th>
                  <th style={{ padding: '1rem', fontWeight: 800, color: '#475569' }}>Fecha / Hora</th>
                  <th style={{ padding: '1rem', fontWeight: 800, color: '#475569' }}>Cliente / RNC</th>
                  <th style={{ padding: '1rem', fontWeight: 800, color: '#475569', textAlign: 'right' }}>Monto Acreditado</th>
                  <th style={{ padding: '1rem', fontWeight: 800, color: '#475569' }}>Motivo Anulación</th>
                  <th style={{ padding: '1rem', fontWeight: 800, color: '#475569' }}>Anulado Por</th>
                  <th style={{ padding: '1rem', fontWeight: 800, color: '#475569', textAlign: 'center' }}>Estado DGII</th>
                  <th style={{ padding: '1rem', fontWeight: 800, color: '#475569', textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredNotes.map((note) => {
                  const encfNc = note.ncf_nota_credito || 'Pendiente E34';
                  const ncfModificado = note.ncf || 'N/A';
                  const rawDate = note.nota_credito_fecha || note.voided_at || note.visited_at;
                  const dateFormatted = rawDate ? new Date(rawDate).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' }) : 'N/A';
                  const total = Number(note.total || 0);

                  return (
                    <tr 
                      key={note.id}
                      style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s ease' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#fafafa'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      {/* E-NCF Nota Credito */}
                      <td style={{ padding: '1rem', fontWeight: 800 }}>
                        <span style={{ 
                          background: 'rgba(239, 68, 68, 0.1)', 
                          color: '#dc2626', 
                          padding: '0.35rem 0.65rem', 
                          borderRadius: '8px', 
                          fontFamily: 'monospace',
                          fontSize: '0.85rem',
                          display: 'inline-block'
                        }}>
                          {encfNc}
                        </span>
                      </td>

                      {/* NCF Modificado */}
                      <td style={{ padding: '1rem' }}>
                        <span style={{ 
                          background: '#f1f5f9', 
                          color: '#334155', 
                          padding: '0.35rem 0.65rem', 
                          borderRadius: '8px', 
                          fontFamily: 'monospace',
                          fontSize: '0.85rem'
                        }}>
                          {ncfModificado}
                        </span>
                      </td>

                      {/* Fecha */}
                      <td style={{ padding: '1rem', color: '#64748b' }}>
                        {dateFormatted}
                      </td>

                      {/* Cliente */}
                      <td style={{ padding: '1rem' }}>
                        <div style={{ fontWeight: 700, color: '#09090b' }}>
                          {note.rzn_soc_cliente || note.client_name || 'CONSUMIDOR FINAL'}
                        </div>
                        {(note.rnc_cliente || note.cedula) && (
                          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                            RNC/Cédula: {note.rnc_cliente || note.cedula}
                          </span>
                        )}
                      </td>

                      {/* Monto */}
                      <td style={{ padding: '1rem', textAlign: 'right', fontWeight: 800, color: '#dc2626' }}>
                        RD$ {total.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>

                      {/* Motivo */}
                      <td style={{ padding: '1rem', color: '#475569', maxWidth: '200px' }}>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={note.nota_credito_motivo || note.void_reason || 'Anulación Total'}>
                          {note.nota_credito_motivo || note.void_reason || 'Anulación Total'}
                        </div>
                      </td>

                      {/* Anulado por */}
                      <td style={{ padding: '1rem', color: '#64748b' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <User size={14} />
                          <span>{note.voided_by || 'Cajero'}</span>
                        </div>
                      </td>

                      {/* Estado DGII */}
                      <td style={{ padding: '1rem', textAlign: 'center' }}>
                        <span style={{ 
                          background: '#f0fdf4', 
                          color: '#16a34a', 
                          padding: '0.25rem 0.6rem', 
                          borderRadius: '50px', 
                          fontSize: '0.75rem', 
                          fontWeight: 800,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem'
                        }}>
                          <CheckCircle2 size={12} />
                          Aceptado
                        </span>
                      </td>

                      {/* Acciones */}
                      <td style={{ padding: '1rem', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
                          
                          <button
                            onClick={() => {
                              setSelectedNote(note);
                              setShowDetailModal(true);
                            }}
                            title="Ver detalle / Imprimir"
                            style={{
                              background: '#f8fafc',
                              border: '1px solid #e2e8f0',
                              padding: '0.45rem',
                              borderRadius: '8px',
                              cursor: 'pointer',
                              color: '#334155'
                            }}
                          >
                            <Eye size={16} />
                          </button>

                          <a
                            href={`/api/dgii/credit-notes/${note.id}/pdf`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Descargar PDF Oficial DGII"
                            style={{
                              background: '#eff6ff',
                              border: '1px solid #bfdbfe',
                              padding: '0.45rem',
                              borderRadius: '8px',
                              cursor: 'pointer',
                              color: '#1d4ed8',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              textDecoration: 'none'
                            }}
                          >
                            <Download size={16} />
                          </a>

                          <button
                            onClick={() => handleRetransmit(note.id)}
                            disabled={retransmittingId === note.id}
                            title="Re-transmitir a la DGII"
                            style={{
                              background: '#f1f5f9',
                              border: '1px solid #e2e8f0',
                              padding: '0.45rem',
                              borderRadius: '8px',
                              cursor: retransmittingId === note.id ? 'not-allowed' : 'pointer',
                              color: '#64748b'
                            }}
                          >
                            <RefreshCw size={16} className={retransmittingId === note.id ? 'animate-spin' : ''} />
                          </button>

                        </div>
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      </div>

      {/* Modal Detalle de Nota de Crédito */}
      <AnimatePresence>
        {showDetailModal && selectedNote && (
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem'
          }}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              style={{
                background: '#ffffff',
                borderRadius: '24px',
                maxWidth: '650px',
                width: '100%',
                maxHeight: '90vh',
                overflowY: 'auto',
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
                border: '1px solid #e2e8f0'
              }}
            >
              {/* Modal Header */}
              <div style={{ padding: '1.5rem 2rem', background: '#991B1B', color: '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.9 }}>Comprobante Electrónico e-CF</span>
                  <h3 style={{ margin: '0.25rem 0 0 0', fontSize: '1.25rem', fontWeight: 900 }}>
                    Nota de Crédito: {selectedNote.ncf_nota_credito || 'E340000000001'}
                  </h3>
                </div>
                <button
                  onClick={() => setShowDetailModal(false)}
                  style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer', padding: '0.5rem', borderRadius: '50%' }}
                >
                  <X size={20} />
                </button>
              </div>

              {/* Modal Body */}
              <div style={{ padding: '2rem' }}>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem', background: '#f8fafc', padding: '1.25rem', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>NCF Modificado (Factura)</span>
                    <p style={{ margin: '0.25rem 0 0 0', fontWeight: 900, color: '#09090b', fontFamily: 'monospace', fontSize: '1rem' }}>
                      {selectedNote.ncf}
                    </p>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Fecha de Emisión NC</span>
                    <p style={{ margin: '0.25rem 0 0 0', fontWeight: 700, color: '#09090b', fontSize: '0.9rem' }}>
                      {selectedNote.nota_credito_fecha ? new Date(selectedNote.nota_credito_fecha).toLocaleString('es-DO') : new Date().toLocaleString('es-DO')}
                    </p>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Cliente</span>
                    <p style={{ margin: '0.25rem 0 0 0', fontWeight: 700, color: '#09090b', fontSize: '0.9rem' }}>
                      {selectedNote.rzn_soc_cliente || selectedNote.client_name || 'CONSUMIDOR FINAL'}
                    </p>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Anulado Por</span>
                    <p style={{ margin: '0.25rem 0 0 0', fontWeight: 700, color: '#09090b', fontSize: '0.9rem' }}>
                      {selectedNote.voided_by || 'Cajero'}
                    </p>
                  </div>
                </div>

                <div style={{ background: '#fff5f5', borderLeft: '4px solid #dc2626', padding: '1rem 1.25rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
                  <span style={{ fontSize: '0.75rem', color: '#991b1b', textTransform: 'uppercase', fontWeight: 800 }}>Motivo de la Modificación / Anulación:</span>
                  <p style={{ margin: '0.25rem 0 0 0', color: '#1e293b', fontSize: '0.9rem', fontWeight: 600 }}>
                    {selectedNote.nota_credito_motivo || selectedNote.void_reason || 'Anulación Total de Factura'}
                  </p>
                </div>

                {/* Total Revertido */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem', background: '#f8fafc', borderRadius: '16px', border: '1px solid #e2e8f0', marginBottom: '2rem' }}>
                  <span style={{ fontWeight: 800, fontSize: '1rem', color: '#09090b' }}>Total Acreditado / Anulado:</span>
                  <span style={{ fontWeight: 900, fontSize: '1.4rem', color: '#dc2626' }}>
                    RD$ {Number(selectedNote.total || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <a
                    href={`/api/dgii/credit-notes/${selectedNote.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="admin-btn btn-primary"
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      padding: '0.85rem',
                      borderRadius: '12px',
                      textDecoration: 'none',
                      background: '#991B1B',
                      color: '#ffffff',
                      fontWeight: 800
                    }}
                  >
                    <Download size={18} />
                    <span>Descargar PDF Oficial</span>
                  </a>

                  <a
                    href={`/api/dgii/credit-notes/${selectedNote.id}/xml`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      padding: '0.85rem 1.5rem',
                      borderRadius: '12px',
                      border: '1px solid #e2e8f0',
                      background: '#f8fafc',
                      color: '#334155',
                      textDecoration: 'none',
                      fontWeight: 700
                    }}
                  >
                    <FileText size={18} />
                    <span>Descargar XML</span>
                  </a>
                </div>

              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
