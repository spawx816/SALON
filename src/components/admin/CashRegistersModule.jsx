import React, { useState, useEffect } from 'react';
import { 
  Lock, Unlock, DollarSign, Calendar, RefreshCw, Search, Eye, Filter,
  FileSpreadsheet, ArrowUpRight, ArrowDownRight, CreditCard, Banknote, Landmark,
  Gift, Receipt, AlertTriangle, CheckCircle2, ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight, X, Clock, MapPin, User, FileText
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { motion, AnimatePresence } from 'framer-motion';

const CashRegistersModule = () => {
  const [registers, setRegisters] = useState([]);
  const [salons, setSalons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSalon, setSelectedSalon] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState(new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Modal States
  const [selectedRegister, setSelectedRegister] = useState(null);
  const [registerMovements, setRegisterMovements] = useState([]);
  const [registerInvoices, setRegisterInvoices] = useState([]);
  const [modalTab, setModalTab] = useState('resumen'); // 'resumen' | 'facturas' | 'movimientos'
  const [loadingModalData, setLoadingModalData] = useState(false);

  useEffect(() => {
    loadSalonsAndRegisters();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedSalon, selectedStatus, startDate, endDate, itemsPerPage]);

  const loadSalonsAndRegisters = async () => {
    setLoading(true);
    try {
      const [sList, rList] = await Promise.all([
        dataService.getSalons().catch(() => []),
        dataService.getCashRegisters({
          salon_id: selectedSalon,
          status: selectedStatus,
          start_date: startDate,
          end_date: endDate
        })
      ]);
      setSalons(sList || []);
      setRegisters(rList || []);
    } catch (err) {
      console.error('Error cargando cajas:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFilter = (e) => {
    if (e) e.preventDefault();
    loadSalonsAndRegisters();
  };

  const handleOpenDetails = async (register, initialTab = 'resumen') => {
    setSelectedRegister(register);
    setModalTab(initialTab);
    setLoadingModalData(true);
    try {
      const [movsRes, invsRes] = await Promise.all([
        dataService.getCashRegisterMovements(register.id).catch(() => ({ movements: [] })),
        dataService.getCashRegisterInvoices(register.id).catch(() => [])
      ]);
      setRegisterMovements(movsRes?.movements || (Array.isArray(movsRes) ? movsRes : []));
      setRegisterInvoices(invsRes || []);
    } catch (err) {
      console.error('Error cargando detalles de caja:', err);
    } finally {
      setLoadingModalData(false);
    }
  };

  // Filtered registers by search term
  const filteredRegisters = registers.filter(r => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      (r.register_number || '').toLowerCase().includes(term) ||
      (r.employee_name || '').toLowerCase().includes(term) ||
      (r.salon_name || '').toLowerCase().includes(term) ||
      (r.status || '').toLowerCase().includes(term)
    );
  });

  // Pagination Calculations
  const totalPages = Math.max(1, Math.ceil(filteredRegisters.length / itemsPerPage));
  const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (validCurrentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, filteredRegisters.length);
  const paginatedRegisters = filteredRegisters.slice(startIndex, endIndex);

  // KPI Summary calculations
  const totalOpen = registers.filter(r => r.status === 'Abierta').length;
  const totalClosed = registers.filter(r => r.status === 'Cerrada').length;
  const grandTotalSales = registers.reduce((sum, r) => sum + (Number(r.total_ventas) || 0), 0);
  const grandTotalCash = registers.reduce((sum, r) => sum + (Number(r.efectivo_total) || 0), 0);
  const grandTotalExpenses = registers.reduce((sum, r) => sum + (Number(r.gastos_total) || 0), 0);

  const handleExportCSV = () => {
    if (filteredRegisters.length === 0) return alert('No hay registros de cajas para exportar.');
    const headers = [
      'ID', 'Número de Caja', 'Sucursal', 'Cajero Responsable', 'Estatus',
      'Fecha Apertura', 'Fecha Cierre', 'Monto Inicial (RD$)', 'Total Ventas (RD$)',
      'Efectivo (RD$)', 'Tarjeta (RD$)', 'Transferencia (RD$)', 'Gastos / Retiros (RD$)',
      'Monto Esperado (RD$)', 'Monto Declarado (RD$)', 'Diferencia (RD$)', 'Observaciones'
    ];
    const rows = filteredRegisters.map(r => [
      r.id,
      r.register_number || `CAJA-${r.id}`,
      r.salon_name || 'Central',
      r.employee_name || 'Cajero',
      r.status,
      r.opened_at ? new Date(r.opened_at).toLocaleString('es-DO') : '',
      r.closed_at ? new Date(r.closed_at).toLocaleString('es-DO') : 'En curso',
      Number(r.monto_inicial || 0).toFixed(2),
      Number(r.total_ventas || 0).toFixed(2),
      Number(r.efectivo_total || 0).toFixed(2),
      Number(r.tarjeta_total || 0).toFixed(2),
      Number(r.transferencia_total || 0).toFixed(2),
      Number((r.gastos_total || 0) + (r.retiros_total || 0)).toFixed(2),
      Number(r.monto_esperado || 0).toFixed(2),
      Number(r.monto_final || 0).toFixed(2),
      Number(r.diferencia || 0).toFixed(2),
      (r.observaciones || '').replace(/"/g, '""')
    ]);

    const csvContent = [headers, ...rows].map(e => e.map(val => `"${val}"`).join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `reporte_cajas_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ padding: '0 0.5rem 2rem' }}>
      
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'linear-gradient(135deg, #09090b 0%, #27272a 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff' }}>
              <Lock size={20} color="#f43f5e" />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.45rem', fontWeight: 900, color: '#0f172a' }}>
                Monitoreo y Control de Cajas
              </h1>
              <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                Auditoría en tiempo real de apertura, cierre, arqueos y recaudación de todas las sucursales
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <button
            type="button"
            onClick={handleExportCSV}
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.6rem 1.1rem', borderRadius: '12px', background: '#f8fafc', border: '1px solid #cbd5e1', fontSize: '0.825rem', fontWeight: 800, color: '#0f172a', cursor: 'pointer' }}
          >
            <FileSpreadsheet size={16} color="#059669" />
            <span>Exportar Cajas</span>
          </button>

          <button
            type="button"
            onClick={loadSalonsAndRegisters}
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.6rem 1.1rem', borderRadius: '12px', background: '#09090b', border: 'none', fontSize: '0.825rem', fontWeight: 800, color: '#ffffff', cursor: 'pointer' }}
          >
            <RefreshCw size={15} />
            <span>Actualizar</span>
          </button>
        </div>
      </div>

      {/* KPI METRICS ROW */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Cajas Abiertas Hoy</span>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
          </div>
          <h2 style={{ margin: 0, fontSize: '1.85rem', fontWeight: 900, color: '#16a34a' }}>{totalOpen}</h2>
          <span style={{ fontSize: '0.725rem', color: '#64748b', fontWeight: 600 }}>{totalClosed} cerradas en el periodo</span>
        </div>

        <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Total Ventas en Cajas</span>
            <Receipt size={16} color="#be185d" />
          </div>
          <h2 style={{ margin: 0, fontSize: '1.85rem', fontWeight: 900, color: '#0f172a' }}>
            RD$ {grandTotalSales.toLocaleString('es-DO', { maximumFractionDigits: 0 })}
          </h2>
          <span style={{ fontSize: '0.725rem', color: '#be185d', fontWeight: 700 }}>Facturación acumulada</span>
        </div>

        <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Efectivo Recaudado</span>
            <Banknote size={16} color="#059669" />
          </div>
          <h2 style={{ margin: 0, fontSize: '1.85rem', fontWeight: 900, color: '#059669' }}>
            RD$ {grandTotalCash.toLocaleString('es-DO', { maximumFractionDigits: 0 })}
          </h2>
          <span style={{ fontSize: '0.725rem', color: '#64748b', fontWeight: 600 }}>Total ingresado en efectivo</span>
        </div>

        <div style={{ background: '#ffffff', padding: '1.25rem', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Gastos y Retiros</span>
            <ArrowDownRight size={16} color="#dc2626" />
          </div>
          <h2 style={{ margin: 0, fontSize: '1.85rem', fontWeight: 900, color: '#dc2626' }}>
            RD$ {grandTotalExpenses.toLocaleString('es-DO', { maximumFractionDigits: 0 })}
          </h2>
          <span style={{ fontSize: '0.725rem', color: '#64748b', fontWeight: 600 }}>Salidas y sangrías de caja</span>
        </div>
      </div>

      {/* FILTER CONTROLS BAR */}
      <div style={{ background: '#ffffff', padding: '1rem 1.25rem', borderRadius: '16px', border: '1px solid #e2e8f0', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        
        {/* Search */}
        <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
          <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          <input
            type="text"
            placeholder="Buscar por # caja, cajero, sucursal..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '0.55rem 0.75rem 0.55rem 2.25rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.825rem', outline: 'none' }}
          />
        </div>

        {/* Status Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>Estatus:</span>
          <select
            value={selectedStatus}
            onChange={(e) => { setSelectedStatus(e.target.value); }}
            style={{ padding: '0.55rem 0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.825rem', fontWeight: 700, outline: 'none', background: '#ffffff' }}
          >
            <option value="all">Todos los estatus</option>
            <option value="Abierta">🟢 Abierta</option>
            <option value="Cerrada">🔒 Cerrada</option>
          </select>
        </div>

        {/* Salon Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <MapPin size={16} color="#64748b" />
          <select
            value={selectedSalon}
            onChange={(e) => setSelectedSalon(e.target.value)}
            style={{ padding: '0.55rem 0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.825rem', fontWeight: 700, outline: 'none', background: '#ffffff' }}
          >
            <option value="all">Todas las Sucursales</option>
            {salons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        {/* Date Range */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Calendar size={16} color="#64748b" />
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{ padding: '0.45rem 0.55rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.8rem', fontWeight: 700 }}
          />
          <span style={{ color: '#94a3b8' }}>-</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{ padding: '0.45rem 0.55rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.8rem', fontWeight: 700 }}
          />
        </div>

        <button
          type="button"
          onClick={handleFilter}
          style={{ padding: '0.55rem 1.25rem', borderRadius: '10px', background: '#be185d', color: '#ffffff', border: 'none', fontSize: '0.825rem', fontWeight: 800, cursor: 'pointer' }}
        >
          Filtrar
        </button>
      </div>

      {/* REGISTERS TABLE WITH VISIBLE SUMMARY IN ROWS */}
      <div style={{ background: '#ffffff', borderRadius: '20px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
        <div className="table-responsive">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'left', fontSize: '0.725rem', textTransform: 'uppercase' }}>
                <th style={{ padding: '0.85rem 0.65rem', fontWeight: 800 }}>Caja / Sucursal</th>
                <th style={{ padding: '0.85rem 0.65rem', fontWeight: 800 }}>Cajero(a)</th>
                <th style={{ padding: '0.85rem 0.65rem', fontWeight: 800, textAlign: 'center' }}>Estatus</th>
                <th style={{ padding: '0.85rem 0.65rem', fontWeight: 800 }}>Horario Apertura/Cierre</th>
                <th style={{ padding: '0.85rem 0.65rem', fontWeight: 800, textAlign: 'right' }}>Fondo Inicial</th>
                <th style={{ padding: '0.85rem 0.65rem', fontWeight: 800, textAlign: 'right' }}>Total Ventas</th>
                <th style={{ padding: '0.85rem 0.65rem', fontWeight: 800, textAlign: 'right' }}>Efectivo</th>
                <th style={{ padding: '0.85rem 0.65rem', fontWeight: 800, textAlign: 'right' }}>Tarjeta/Transf.</th>
                <th style={{ padding: '0.85rem 0.65rem', fontWeight: 800, textAlign: 'right' }}>Gastos/Retiros</th>
                <th style={{ padding: '0.85rem 0.65rem', fontWeight: 800, textAlign: 'right' }}>Esperado / Cierre</th>
                <th style={{ padding: '0.85rem 0.65rem', fontWeight: 800, textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="11" style={{ padding: '4rem 1rem', textAlign: 'center', color: '#64748b' }}>
                    <RefreshCw size={24} className="spin" style={{ margin: '0 auto 0.5rem' }} />
                    <p style={{ margin: 0, fontWeight: 700 }}>Cargando cajas y resúmenes financieros...</p>
                  </td>
                </tr>
              ) : filteredRegisters.length === 0 ? (
                <tr>
                  <td colSpan="11" style={{ padding: '4rem 1rem', textAlign: 'center', color: '#64748b' }}>
                    <p style={{ margin: 0, fontWeight: 800, fontSize: '1rem', color: '#0f172a' }}>No se encontraron cajas registradas</p>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}>Intenta ajustar los filtros de fecha o sucursal.</p>
                  </td>
                </tr>
              ) : (
                paginatedRegisters.map((reg) => {
                  const isOpen = reg.status === 'Abierta';
                  const openDateStr = new Date(reg.opened_at || Date.now()).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' });
                  const closeDateStr = reg.closed_at ? new Date(reg.closed_at).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' }) : 'En curso';
                  const cardAndTransf = (Number(reg.tarjeta_total || 0) + Number(reg.transferencia_total || 0));
                  const totalOutflows = (Number(reg.gastos_total || 0) + Number(reg.retiros_total || 0));
                  const diff = Number(reg.diferencia || 0);

                  return (
                    <tr key={reg.id} style={{ borderBottom: '1px solid #f1f5f9', background: isOpen ? '#f0fdf4' : '#ffffff' }}>
                      
                      {/* Register Number & Salon */}
                      <td style={{ padding: '0.85rem 0.65rem' }}>
                        <strong style={{ color: '#0f172a', display: 'block', fontSize: '0.85rem', fontWeight: 800 }}>
                          {reg.register_number || `CAJA-${reg.id}`}
                        </strong>
                        <span style={{ fontSize: '0.725rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '3px' }}>
                          <MapPin size={11} /> {reg.salon_name || 'Central'}
                        </span>
                      </td>

                      {/* Cashier */}
                      <td style={{ padding: '0.85rem 0.65rem', fontWeight: 700, color: '#334155' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <User size={13} color="#94a3b8" />
                          <span>{reg.employee_name || 'Cajero Principal'}</span>
                        </div>
                      </td>

                      {/* Status */}
                      <td style={{ padding: '0.85rem 0.65rem', textAlign: 'center' }}>
                        <span style={{
                          padding: '3px 10px', borderRadius: '99px', fontSize: '0.7rem', fontWeight: 900, textTransform: 'uppercase',
                          background: isOpen ? '#dcfce7' : '#f1f5f9',
                          color: isOpen ? '#15803d' : '#475569',
                          border: isOpen ? '1px solid #bbf7d0' : '1px solid #cbd5e1'
                        }}>
                          {isOpen ? '🟢 ABIERTA' : '🔒 CERRADA'}
                        </span>
                      </td>

                      {/* Open / Close Time */}
                      <td style={{ padding: '0.85rem 0.65rem', fontSize: '0.75rem', color: '#64748b' }}>
                        <div>Apertura: <strong>{openDateStr}</strong></div>
                        <div>Cierre: <strong style={{ color: isOpen ? '#16a34a' : '#334155' }}>{closeDateStr}</strong></div>
                      </td>

                      {/* Initial Amount */}
                      <td style={{ padding: '0.85rem 0.65rem', textAlign: 'right', fontWeight: 700, color: '#475569' }}>
                        RD$ {Number(reg.monto_inicial || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </td>

                      {/* Total Sales */}
                      <td style={{ padding: '0.85rem 0.65rem', textAlign: 'right', fontWeight: 900, color: '#0f172a' }}>
                        RD$ {Number(reg.total_ventas || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                        <span style={{ display: 'block', fontSize: '0.675rem', color: '#be185d', fontWeight: 700 }}>
                          ({reg.count_invoices || 0} facturas)
                        </span>
                      </td>

                      {/* Cash Total */}
                      <td style={{ padding: '0.85rem 0.65rem', textAlign: 'right', fontWeight: 800, color: '#16a34a' }}>
                        RD$ {Number(reg.efectivo_total || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </td>

                      {/* Card / Transfer */}
                      <td style={{ padding: '0.85rem 0.65rem', textAlign: 'right', fontWeight: 700, color: '#2563eb' }}>
                        RD$ {cardAndTransf.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </td>

                      {/* Expenses / Withdrawals */}
                      <td style={{ padding: '0.85rem 0.65rem', textAlign: 'right', fontWeight: 700, color: totalOutflows > 0 ? '#dc2626' : '#94a3b8' }}>
                        RD$ {totalOutflows.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </td>

                      {/* Expected / Closing Amount */}
                      <td style={{ padding: '0.85rem 0.65rem', textAlign: 'right' }}>
                        <div style={{ fontWeight: 900, color: '#0f172a' }}>
                          RD$ {Number(reg.monto_esperado || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                        </div>
                        {!isOpen && (
                          <div style={{ fontSize: '0.7rem', color: Math.abs(diff) < 0.01 ? '#16a34a' : diff > 0 ? '#2563eb' : '#dc2626', fontWeight: 800 }}>
                            {Math.abs(diff) < 0.01 ? '✔ Cuadrada' : diff > 0 ? `+ RD$ ${diff.toFixed(2)} (Sobrante)` : `RD$ ${diff.toFixed(2)} (Faltante)`}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '0.85rem 0.65rem', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                          <button
                            type="button"
                            onClick={() => handleOpenDetails(reg, 'resumen')}
                            style={{ background: '#f8fafc', border: '1px solid #cbd5e1', padding: '0.35rem 0.6rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '3px' }}
                            title="Ver resumen y arqueo detallado"
                          >
                            <Eye size={13} />
                            <span>Arqueo</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenDetails(reg, 'facturas')}
                            style={{ background: '#fdf2f8', border: '1px solid #fbcfe8', padding: '0.35rem 0.6rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 800, color: '#be185d', display: 'flex', alignItems: 'center', gap: '3px' }}
                            title="Ver facturas emitidas en esta caja"
                          >
                            <Receipt size={13} />
                            <span>Facturas</span>
                          </button>
                        </div>
                      </td>

                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* PAGINATION CONTROLS */}
        {!loading && filteredRegisters.length > 0 && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '1rem 1.5rem',
            background: '#f8fafc',
            borderTop: '1px solid #e2e8f0',
            flexWrap: 'wrap',
            gap: '1rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: '#64748b', fontWeight: 600 }}>
                <span>Mostrar:</span>
                <select
                  value={itemsPerPage}
                  onChange={(e) => setItemsPerPage(Number(e.target.value))}
                  style={{
                    padding: '0.35rem 0.6rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    color: '#0f172a',
                    cursor: 'pointer'
                  }}
                >
                  <option value={10}>10 por página</option>
                  <option value={20}>20 por página</option>
                  <option value={50}>50 por página</option>
                </select>
              </div>

              <div style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600 }}>
                Mostrando <strong style={{ color: '#0f172a' }}>{filteredRegisters.length > 0 ? startIndex + 1 : 0}</strong> - <strong style={{ color: '#0f172a' }}>{endIndex}</strong> de <strong style={{ color: '#0f172a' }}>{filteredRegisters.length}</strong> cajas registradas
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <button
                type="button"
                onClick={() => setCurrentPage(1)}
                disabled={validCurrentPage === 1}
                title="Primera página"
                style={{
                  padding: '0.45rem 0.6rem',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  background: '#ffffff',
                  color: validCurrentPage === 1 ? '#cbd5e1' : '#334155',
                  cursor: validCurrentPage === 1 ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <ChevronsLeft size={16} />
              </button>

              <button
                type="button"
                onClick={() => setCurrentPage(Math.max(1, validCurrentPage - 1))}
                disabled={validCurrentPage === 1}
                title="Página anterior"
                style={{
                  padding: '0.45rem 0.6rem',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  background: '#ffffff',
                  color: validCurrentPage === 1 ? '#cbd5e1' : '#334155',
                  cursor: validCurrentPage === 1 ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <ChevronLeft size={16} />
              </button>

              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(page => {
                  if (page === 1 || page === totalPages) return true;
                  if (Math.abs(page - validCurrentPage) <= 1) return true;
                  return false;
                })
                .map((page, idx, arr) => {
                  const prevPage = arr[idx - 1];
                  const showEllipsis = prevPage && page - prevPage > 1;

                  return (
                    <React.Fragment key={page}>
                      {showEllipsis && (
                        <span style={{ padding: '0 0.35rem', color: '#94a3b8', fontSize: '0.85rem' }}>...</span>
                      )}
                      <button
                        type="button"
                        onClick={() => setCurrentPage(page)}
                        style={{
                          minWidth: '34px',
                          height: '34px',
                          borderRadius: '8px',
                          border: validCurrentPage === page ? 'none' : '1px solid #e2e8f0',
                          background: validCurrentPage === page ? '#0f172a' : '#ffffff',
                          color: validCurrentPage === page ? '#ffffff' : '#334155',
                          fontWeight: 800,
                          fontSize: '0.82rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        {page}
                      </button>
                    </React.Fragment>
                  );
                })}

              <button
                type="button"
                onClick={() => setCurrentPage(Math.min(totalPages, validCurrentPage + 1))}
                disabled={validCurrentPage >= totalPages}
                title="Página siguiente"
                style={{
                  padding: '0.45rem 0.6rem',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  background: '#ffffff',
                  color: validCurrentPage >= totalPages ? '#cbd5e1' : '#334155',
                  cursor: validCurrentPage >= totalPages ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <ChevronRight size={16} />
              </button>

              <button
                type="button"
                onClick={() => setCurrentPage(totalPages)}
                disabled={validCurrentPage >= totalPages}
                title="Última página"
                style={{
                  padding: '0.45rem 0.6rem',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  background: '#ffffff',
                  color: validCurrentPage >= totalPages ? '#cbd5e1' : '#334155',
                  cursor: validCurrentPage >= totalPages ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <ChevronsRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ================= MODAL: DETALLES DE CAJA / ARQUEO / FACTURAS ================= */}
      {selectedRegister && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1050, padding: '1rem' }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: '850px', maxHeight: '88vh', borderRadius: '20px', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
            
            {/* Modal Header */}
            <div style={{ padding: '1.25rem 1.5rem', background: '#0f172a', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 900 }}>
                    {selectedRegister.register_number || `CAJA-${selectedRegister.id}`}
                  </h3>
                  <span style={{
                    padding: '2px 8px', borderRadius: '99px', fontSize: '0.7rem', fontWeight: 800,
                    background: selectedRegister.status === 'Abierta' ? '#dcfce7' : '#f1f5f9',
                    color: selectedRegister.status === 'Abierta' ? '#15803d' : '#0f172a'
                  }}>
                    {selectedRegister.status}
                  </span>
                </div>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.775rem', color: '#94a3b8' }}>
                  {selectedRegister.salon_name} • Cajero: {selectedRegister.employee_name || 'Principal'}
                </p>
              </div>

              <button onClick={() => setSelectedRegister(null)} style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer' }}>
                <X size={22} />
              </button>
            </div>

            {/* Modal Navigation Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
              {[
                { id: 'resumen', label: 'Resumen Financiero', icon: DollarSign },
                { id: 'facturas', label: `Facturas (${registerInvoices.length})`, icon: Receipt },
                { id: 'movimientos', label: `Movimientos (${registerMovements.length})`, icon: Clock }
              ].map(tab => {
                const Icon = tab.icon;
                const isActive = modalTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setModalTab(tab.id)}
                    style={{
                      flex: 1, padding: '0.85rem 1rem', border: 'none',
                      borderBottom: isActive ? '3px solid #be185d' : '3px solid transparent',
                      background: isActive ? '#ffffff' : 'transparent',
                      color: isActive ? '#be185d' : '#64748b',
                      fontWeight: isActive ? 800 : 600,
                      fontSize: '0.85rem', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem'
                    }}
                  >
                    <Icon size={16} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Modal Content Body */}
            <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
              {loadingModalData ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
                  <RefreshCw size={24} className="spin" style={{ margin: '0 auto 0.5rem' }} />
                  <p>Cargando detalles de la caja...</p>
                </div>
              ) : modalTab === 'resumen' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  
                  {/* Grid 2 cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: '14px', padding: '1rem', background: '#f0fdf4' }}>
                      <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', fontWeight: 800, color: '#166534', textTransform: 'uppercase' }}>
                        💵 Ingresos Registrados
                      </h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.825rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Fondo Inicial:</span>
                          <strong>RD$ {Number(selectedRegister.monto_inicial || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Efectivo en Ventas:</span>
                          <strong>RD$ {Number(selectedRegister.efectivo_total || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Tarjetas:</span>
                          <strong>RD$ {Number(selectedRegister.tarjeta_total || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Transferencias:</span>
                          <strong>RD$ {Number(selectedRegister.transferencia_total || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong>
                        </div>
                      </div>
                    </div>

                    <div style={{ border: '1px solid #e2e8f0', borderRadius: '14px', padding: '1rem', background: '#fef2f2' }}>
                      <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', fontWeight: 800, color: '#991b1b', textTransform: 'uppercase' }}>
                        💸 Egresos y Salidas
                      </h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.825rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Gastos de Turno:</span>
                          <strong style={{ color: '#dc2626' }}>- RD$ {Number(selectedRegister.gastos_total || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Retiros de Efectivo:</span>
                          <strong style={{ color: '#dc2626' }}>- RD$ {Number(selectedRegister.retiros_total || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Entradas Adicionales:</span>
                          <strong style={{ color: '#16a34a' }}>+ RD$ {Number(selectedRegister.entradas_total || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Expected Balance Card */}
                  <div style={{ background: '#faf5ff', border: '1px solid #f3e8ff', borderRadius: '16px', padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#7e22ce', textTransform: 'uppercase' }}>Monto Total Esperado en Caja</span>
                      <h3 style={{ margin: '0.2rem 0 0', fontSize: '1.6rem', fontWeight: 900, color: '#581c87' }}>
                        RD$ {Number(selectedRegister.monto_esperado || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </h3>
                    </div>
                    {selectedRegister.status === 'Cerrada' && (
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b' }}>Monto Declarado al Cierre</span>
                        <p style={{ margin: '0.2rem 0 0', fontSize: '1.3rem', fontWeight: 900, color: '#0f172a' }}>
                          RD$ {Number(selectedRegister.monto_final || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    )}
                  </div>

                  {selectedRegister.observaciones && (
                    <div style={{ background: '#f8fafc', padding: '0.85rem 1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                      <strong style={{ fontSize: '0.75rem', color: '#475569', display: 'block', marginBottom: '0.2rem' }}>Observaciones del Cajero:</strong>
                      <p style={{ margin: 0, fontSize: '0.825rem', color: '#1e293b' }}>{selectedRegister.observaciones}</p>
                    </div>
                  )}

                </div>
              ) : modalTab === 'facturas' ? (
                <div>
                  {registerInvoices.length === 0 ? (
                    <p style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>No hay facturas registradas en esta caja.</p>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#475569', fontSize: '0.725rem', textTransform: 'uppercase' }}>
                          <th style={{ padding: '0.65rem 0.5rem' }}>Ticket</th>
                          <th style={{ padding: '0.65rem 0.5rem' }}>Hora</th>
                          <th style={{ padding: '0.65rem 0.5rem' }}>Cliente</th>
                          <th style={{ padding: '0.65rem 0.5rem' }}>Método</th>
                          <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>Total</th>
                          <th style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>Estatus</th>
                        </tr>
                      </thead>
                      <tbody>
                        {registerInvoices.map((inv) => (
                          <tr key={inv.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '0.65rem 0.5rem', fontWeight: 800 }}>{inv.ticket_number || `SD-${inv.id}`}</td>
                            <td style={{ padding: '0.65rem 0.5rem', color: '#64748b' }}>{new Date(inv.visited_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                            <td style={{ padding: '0.65rem 0.5rem', fontWeight: 700 }}>{inv.client_name || 'Cliente'}</td>
                            <td style={{ padding: '0.65rem 0.5rem' }}>{inv.metodo_pago}</td>
                            <td style={{ padding: '0.65rem 0.5rem', textAlign: 'right', fontWeight: 800 }}>RD$ {Number(inv.total).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</td>
                            <td style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>
                              <span style={{ padding: '2px 7px', borderRadius: '99px', fontSize: '0.7rem', fontWeight: 800, background: inv.status === 'Anulado' ? '#fee2e2' : '#dcfce7', color: inv.status === 'Anulado' ? '#dc2626' : '#15803d' }}>
                                {inv.status || 'Facturado'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ) : (
                <div>
                  {registerMovements.length === 0 ? (
                    <p style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>No hay movimientos manuales registrados en esta caja.</p>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#475569', fontSize: '0.725rem', textTransform: 'uppercase' }}>
                          <th style={{ padding: '0.65rem 0.5rem' }}>Hora</th>
                          <th style={{ padding: '0.65rem 0.5rem' }}>Tipo</th>
                          <th style={{ padding: '0.65rem 0.5rem' }}>Concepto</th>
                          <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>Monto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {registerMovements.map((m, idx) => (
                          <tr key={m.id || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '0.65rem 0.5rem', color: '#64748b' }}>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                            <td style={{ padding: '0.65rem 0.5rem', fontWeight: 700 }}>{m.type}</td>
                            <td style={{ padding: '0.65rem 0.5rem' }}>{m.concept || 'Movimiento'}</td>
                            <td style={{ padding: '0.65rem 0.5rem', textAlign: 'right', fontWeight: 800 }}>RD$ {Number(m.amount).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{ padding: '0.85rem 1.5rem', background: '#f8fafc', borderTop: '1px solid #e2e8f0', textAlign: 'right' }}>
              <button
                type="button"
                onClick={() => setSelectedRegister(null)}
                style={{ background: '#0f172a', color: 'white', border: 'none', padding: '0.5rem 1.25rem', borderRadius: '10px', fontSize: '0.85rem', fontWeight: 800, cursor: 'pointer' }}
              >
                Cerrar
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

export default CashRegistersModule;
