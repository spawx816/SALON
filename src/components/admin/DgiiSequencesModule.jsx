import React, { useState, useEffect } from 'react';
import { 
  Receipt, Plus, ShieldCheck, AlertCircle, CheckCircle2, Clock, 
  Layers, BarChart3, Edit, Trash2, X, Save, RefreshCw, Landmark, 
  HelpCircle, ChevronRight, FileSpreadsheet, ArrowUpRight
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useNotification } from '../../context/NotificationContext';
import { motion, AnimatePresence } from 'framer-motion';

export default function DgiiSequencesModule() {
  const { showNotification } = useNotification();
  const [sequences, setSequences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingSeq, setEditingSeq] = useState(null);

  const [formData, setFormData] = useState({
    tipo_comprobante: 'E31',
    nombre_comprobante: 'Factura de Crédito Fiscal Electrónico',
    no_solicitud: '',
    no_autorizacion: '',
    numero_desde: '',
    numero_hasta: '',
    cantidad_aprobada: 10,
    fecha_vencimiento: '2027-12-31',
    alerta_minima: 5
  });

  const COMPROBANTE_TYPES = [
    { code: 'E31', name: 'Factura de Crédito Fiscal Electrónico', desc: 'Para empresas y compras con valor fiscal (B2B)' },
    { code: 'E32', name: 'Factura de Consumo Electrónica', desc: 'Para clientas y consumidor final en salón' },
    { code: 'E33', name: 'Nota de Débito Electrónica', desc: 'Para cargos adicionales sobre e-CF' },
    { code: 'E34', name: 'Nota de Crédito Electrónica', desc: 'Para anulaciones, devoluciones o correcciones' },
    { code: 'E41', name: 'Compras Electrónicas', desc: 'Compras a personas físicas no registradas' },
    { code: 'E43', name: 'Gastos Menores Electrónicos', desc: 'Caja chica y gastos operativos menores' },
    { code: 'E44', name: 'Regímenes Especiales Electrónicos', desc: 'Zonas francas y exenciones fiscales' },
    { code: 'E45', name: 'Gubernamental Electrónico', desc: 'Facturación a instituciones del Estado' }
  ];

  const fetchSequences = async () => {
    setLoading(true);
    try {
      const data = await dataService.getDgiiSequences();
      setSequences(data);
    } catch (e) {
      showNotification('Error cargando secuencias de la DGII', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSequences();
  }, []);

  const handleOpenCreate = () => {
    setEditingSeq(null);
    setFormData({
      tipo_comprobante: 'E31',
      nombre_comprobante: 'Factura de Crédito Fiscal Electrónico',
      no_solicitud: '',
      no_autorizacion: '',
      numero_desde: 'E310000000001',
      numero_hasta: 'E310000000010',
      cantidad_aprobada: 10,
      fecha_vencimiento: '2027-12-31',
      alerta_minima: 5
    });
    setShowModal(true);
  };

  const handleOpenEdit = (seq) => {
    setEditingSeq(seq);
    setFormData({
      tipo_comprobante: seq.tipo_comprobante,
      nombre_comprobante: seq.nombre_comprobante,
      no_solicitud: seq.no_solicitud || '',
      no_autorizacion: seq.no_autorizacion || '',
      numero_desde: seq.numero_desde,
      numero_hasta: seq.numero_hasta,
      cantidad_aprobada: seq.cantidad_aprobada,
      cantidad_usada: seq.cantidad_usada,
      fecha_vencimiento: seq.fecha_vencimiento ? seq.fecha_vencimiento.split('T')[0] : '',
      alerta_minima: seq.alerta_minima || 5,
      estado: seq.estado
    });
    setShowModal(true);
  };

  const handleTypeChange = (typeCode) => {
    const found = COMPROBANTE_TYPES.find(t => t.code === typeCode);
    const prefix = typeCode;
    const pad = '0000000001';
    setFormData(prev => ({
      ...prev,
      tipo_comprobante: typeCode,
      nombre_comprobante: found ? found.name : prev.nombre_comprobante,
      numero_desde: `${prefix}${pad}`,
      numero_hasta: `${prefix}${String(Number(pad) + (parseInt(prev.cantidad_aprobada) || 10) - 1).padStart(10, '0')}`
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingSeq) {
        const res = await dataService.updateDgiiSequence(editingSeq.id, formData);
        if (res.success) {
          showNotification('Secuencia actualizada correctamente', 'success');
        } else {
          showNotification(res.error || 'Error al actualizar', 'error');
        }
      } else {
        const res = await dataService.createDgiiSequence(formData);
        if (res.success) {
          showNotification('Secuencia registrada y activada con éxito', 'success');
        } else {
          showNotification(res.error || 'Error al registrar', 'error');
        }
      }
      setShowModal(false);
      fetchSequences();
    } catch (err) {
      showNotification('Error al guardar secuencia: ' + err.message, 'error');
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`¿Estás seguro de eliminar el lote de secuencias "${name}"?`)) return;
    try {
      const res = await dataService.deleteDgiiSequence(id);
      if (res.success) {
        showNotification('Lote eliminado', 'info');
        fetchSequences();
      }
    } catch (e) {
      showNotification('Error al eliminar', 'error');
    }
  };

  // Metrics
  const totalDisponibles = sequences.reduce((acc, s) => acc + (s.cantidad_disponible || 0), 0);
  const totalAprobados = sequences.reduce((acc, s) => acc + (s.cantidad_aprobada || 0), 0);
  const totalUsados = sequences.reduce((acc, s) => acc + (s.cantidad_usada || 0), 0);
  const activeBatchesCount = sequences.filter(s => s.estado_calculado === 'Activo').length;

  return (
    <div className="dgii-sequences-module" style={{ padding: '0 0.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
            <span style={{ 
              background: '#0ea5e9', 
              color: '#fff', 
              padding: '0.35rem 0.65rem', 
              borderRadius: '8px', 
              fontSize: '0.75rem', 
              fontWeight: 800,
              letterSpacing: '0.05em'
            }}>
              DGII e-CF PRO
            </span>
            <span style={{ 
              background: '#ecfdf5', 
              color: '#059669', 
              border: '1px solid #a7f3d0',
              padding: '0.25rem 0.6rem', 
              borderRadius: '999px', 
              fontSize: '0.75rem', 
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem'
            }}>
              <ShieldCheck size={14} /> Emisor Certificado
            </span>
          </div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
            Secuencias de Comprobantes Fiscales Electrónicos
          </h2>
          <p style={{ fontSize: '0.9rem', color: '#64748b', margin: '0.25rem 0 0 0' }}>
            Administra los rangos de e-NCF autorizados por la Dirección General de Impuestos Internos (DGII).
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button 
            onClick={fetchSequences}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.65rem 1rem',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              background: '#fff',
              color: '#475569',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refrescar
          </button>
          
          <button
            onClick={handleOpenCreate}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.65rem 1.25rem',
              borderRadius: '10px',
              border: 'none',
              background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)',
              color: '#fff',
              fontWeight: 700,
              fontSize: '0.875rem',
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(14, 165, 233, 0.35)',
              transition: 'all 0.2s'
            }}
          >
            <Plus size={18} /> Registrar Nueva Secuencia OFV
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.25rem', border: '1px solid #f1f5f9', boxShadow: '0 2px 10px rgba(0,0,0,0.03)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Disponibles en Total</span>
            <div style={{ background: '#f0fdf4', color: '#16a34a', padding: '0.4rem', borderRadius: '10px' }}>
              <Receipt size={18} />
            </div>
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 800, color: '#0f172a' }}>{totalDisponibles.toLocaleString()}</div>
          <div style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 600, marginTop: '0.25rem' }}>
            Listos para emisión en caja
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.25rem', border: '1px solid #f1f5f9', boxShadow: '0 2px 10px rgba(0,0,0,0.03)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Lotes Activos</span>
            <div style={{ background: '#eff6ff', color: '#2563eb', padding: '0.4rem', borderRadius: '10px' }}>
              <Layers size={18} />
            </div>
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 800, color: '#0f172a' }}>{activeBatchesCount}</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, marginTop: '0.25rem' }}>
            Tipos de comprobantes configurados
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.25rem', border: '1px solid #f1f5f9', boxShadow: '0 2px 10px rgba(0,0,0,0.03)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Comprobantes Emitidos</span>
            <div style={{ background: '#faf5ff', color: '#9333ea', padding: '0.4rem', borderRadius: '10px' }}>
              <BarChart3 size={18} />
            </div>
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 800, color: '#0f172a' }}>{totalUsados.toLocaleString()}</div>
          <div style={{ fontSize: '0.75rem', color: '#9333ea', fontWeight: 600, marginTop: '0.25rem' }}>
            Facturados y timbrados ante DGII
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.25rem', border: '1px solid #f1f5f9', boxShadow: '0 2px 10px rgba(0,0,0,0.03)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Estatus RNC 131917038</span>
            <div style={{ background: '#ecfdf5', color: '#059669', padding: '0.4rem', borderRadius: '10px' }}>
              <Landmark size={18} />
            </div>
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#059669', marginTop: '0.25rem' }}>PRODUCCIÓN</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, marginTop: '0.25rem' }}>
            Plan Beauty RD / Abatte Peluquería
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #f1f5f9', boxShadow: '0 4px 20px rgba(0,0,0,0.02)', overflow: 'hidden' }}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
              Lotes de e-NCF Autorizados
            </h3>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0.2rem 0 0 0' }}>
              Control correlativo y disponibilidad en tiempo real para las cajas
            </p>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
            <RefreshCw size={28} className="animate-spin" style={{ margin: '0 auto 0.75rem auto' }} />
            <p>Cargando secuencias fiscales...</p>
          </div>
        ) : sequences.length === 0 ? (
          <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
            <Receipt size={48} style={{ color: '#cbd5e1', margin: '0 auto 1rem auto' }} />
            <h4 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#334155' }}>No hay secuencias registradas</h4>
            <p style={{ color: '#64748b', fontSize: '0.875rem', maxWidth: '400px', margin: '0.5rem auto 1.5rem auto' }}>
              Registra los números autorizados por la DGII desde tu consulta de solicitudes en la OFV.
            </p>
            <button
              onClick={handleOpenCreate}
              style={{
                background: '#0ea5e9',
                color: '#fff',
                padding: '0.65rem 1.25rem',
                borderRadius: '8px',
                border: 'none',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Registrar Primera Secuencia
            </button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '1rem 1.5rem' }}>Tipo & Comprobante</th>
                  <th style={{ padding: '1rem 1.5rem' }}>No. Solicitud / Autorización</th>
                  <th style={{ padding: '1rem 1.5rem' }}>Rango Autorizado</th>
                  <th style={{ padding: '1rem 1.5rem' }}>Disponibilidad</th>
                  <th style={{ padding: '1rem 1.5rem' }}>Vencimiento</th>
                  <th style={{ padding: '1rem 1.5rem' }}>Estado</th>
                  <th style={{ padding: '1rem 1.5rem', textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {sequences.map(seq => {
                  const isLow = seq.is_alerta_minima;
                  const isExpired = seq.is_vencido;
                  const pct = seq.porcentaje_disponible;

                  return (
                    <tr key={seq.id} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s' }}>
                      <td style={{ padding: '1.25rem 1.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <span style={{ 
                            background: seq.tipo_comprobante === 'E31' ? '#eff6ff' : seq.tipo_comprobante === 'E32' ? '#f0fdf4' : '#faf5ff',
                            color: seq.tipo_comprobante === 'E31' ? '#2563eb' : seq.tipo_comprobante === 'E32' ? '#16a34a' : '#9333ea',
                            padding: '0.35rem 0.6rem',
                            borderRadius: '8px',
                            fontWeight: 800,
                            fontSize: '0.8rem',
                            border: `1px solid ${seq.tipo_comprobante === 'E31' ? '#bfdbfe' : seq.tipo_comprobante === 'E32' ? '#bbf7d0' : '#e9d5ff'}`
                          }}>
                            {seq.tipo_comprobante}
                          </span>
                          <div>
                            <div style={{ fontWeight: 700, color: '#0f172a' }}>{seq.nombre_comprobante}</div>
                            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Uso: Facturación Electrónica</div>
                          </div>
                        </div>
                      </td>

                      <td style={{ padding: '1.25rem 1.5rem' }}>
                        <div style={{ color: '#334155', fontWeight: 600 }}>
                          Sol: <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{seq.no_solicitud || 'N/D'}</span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          Aut: <span style={{ fontFamily: 'monospace' }}>{seq.no_autorizacion || 'N/D'}</span>
                        </div>
                      </td>

                      <td style={{ padding: '1.25rem 1.5rem' }}>
                        <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}>
                          {seq.numero_desde} ➔ {seq.numero_hasta}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          Total: <b>{seq.cantidad_aprobada}</b> comprobantes
                        </div>
                      </td>

                      <td style={{ padding: '1.25rem 1.5rem', minWidth: '180px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                          <span style={{ fontWeight: 800, color: isLow ? '#dc2626' : '#0f172a' }}>
                            {seq.cantidad_disponible} / {seq.cantidad_aprobada}
                          </span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: isLow ? '#dc2626' : '#16a34a' }}>
                            {pct}% disp.
                          </span>
                        </div>
                        <div style={{ width: '100%', height: '6px', background: '#e2e8f0', borderRadius: '999px', overflow: 'hidden' }}>
                          <div style={{ 
                            width: `${pct}%`, 
                            height: '100%', 
                            background: isLow ? '#ef4444' : pct > 50 ? '#10b981' : '#f59e0b',
                            transition: 'width 0.5s ease-out'
                          }} />
                        </div>
                        {isLow && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#dc2626', fontSize: '0.7rem', fontWeight: 700, marginTop: '0.25rem' }}>
                            <AlertCircle size={12} /> Alerta: Pocos comprobantes restantes
                          </div>
                        )}
                      </td>

                      <td style={{ padding: '1.25rem 1.5rem' }}>
                        <div style={{ fontWeight: 600, color: isExpired ? '#dc2626' : '#334155' }}>
                          {seq.fecha_vencimiento ? new Date(seq.fecha_vencimiento).toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Sin límite'}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: isExpired ? '#dc2626' : '#64748b' }}>
                          {isExpired ? 'Vencido en DGII' : 'Vigente'}
                        </div>
                      </td>

                      <td style={{ padding: '1.25rem 1.5rem' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          padding: '0.25rem 0.65rem',
                          borderRadius: '999px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          background: seq.estado_calculado === 'Activo' ? '#ecfdf5' : '#fef2f2',
                          color: seq.estado_calculado === 'Activo' ? '#059669' : '#dc2626',
                          border: `1px solid ${seq.estado_calculado === 'Activo' ? '#a7f3d0' : '#fecaca'}`
                        }}>
                          {seq.estado_calculado === 'Activo' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                          {seq.estado_calculado}
                        </span>
                      </td>

                      <td style={{ padding: '1.25rem 1.5rem', textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                          <button
                            onClick={() => handleOpenEdit(seq)}
                            style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.4rem', cursor: 'pointer', color: '#475569' }}
                            title="Editar Secuencia"
                          >
                            <Edit size={15} />
                          </button>
                          <button
                            onClick={() => handleDelete(seq.id, seq.nombre_comprobante)}
                            style={{ background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: '8px', padding: '0.4rem', cursor: 'pointer', color: '#dc2626' }}
                            title="Eliminar Secuencia"
                          >
                            <Trash2 size={15} />
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

      {/* Modal Creación / Edición */}
      <AnimatePresence>
        {showModal && (
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.6)',
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
                background: '#fff',
                borderRadius: '20px',
                width: '100%',
                maxWidth: '560px',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                overflow: 'hidden'
              }}
            >
              <div style={{ padding: '1.5rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                    {editingSeq ? 'Editar Lote de e-NCF' : 'Registrar Lote de e-NCF Aprobado'}
                  </h3>
                  <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0.2rem 0 0 0' }}>
                    Ingresa los datos exactos del reporte de la Oficina Virtual DGII
                  </p>
                </div>
                <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSubmit} style={{ padding: '1.5rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                  <div style={{ gridColumn: 'span 2' }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem', textTransform: 'uppercase' }}>
                      Tipo de Comprobante
                    </label>
                    <select
                      value={formData.tipo_comprobante}
                      onChange={(e) => handleTypeChange(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        borderRadius: '10px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.9rem',
                        fontWeight: 600,
                        background: '#f8fafc'
                      }}
                    >
                      {COMPROBANTE_TYPES.map(t => (
                        <option key={t.code} value={t.code}>
                          {t.code} - {t.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem', textTransform: 'uppercase' }}>
                      No. Solicitud OFV
                    </label>
                    <input
                      type="text"
                      placeholder="Ej. 6010004045"
                      value={formData.no_solicitud}
                      onChange={(e) => setFormData({ ...formData, no_solicitud: e.target.value })}
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem', textTransform: 'uppercase' }}>
                      No. Autorización DGII
                    </label>
                    <input
                      type="text"
                      placeholder="Ej. 6005529050"
                      value={formData.no_autorizacion}
                      onChange={(e) => setFormData({ ...formData, no_autorizacion: e.target.value })}
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem', textTransform: 'uppercase' }}>
                      Número Desde
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ej. E310000000001"
                      value={formData.numero_desde}
                      onChange={(e) => setFormData({ ...formData, numero_desde: e.target.value.toUpperCase() })}
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontFamily: 'monospace', fontWeight: 700 }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem', textTransform: 'uppercase' }}>
                      Número Hasta
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ej. E310000000010"
                      value={formData.numero_hasta}
                      onChange={(e) => setFormData({ ...formData, numero_hasta: e.target.value.toUpperCase() })}
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontFamily: 'monospace', fontWeight: 700 }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem', textTransform: 'uppercase' }}>
                      Cantidad Aprobada
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={formData.cantidad_aprobada}
                      onChange={(e) => setFormData({ ...formData, cantidad_aprobada: e.target.value })}
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem', textTransform: 'uppercase' }}>
                      Fecha de Vencimiento
                    </label>
                    <input
                      type="date"
                      value={formData.fecha_vencimiento}
                      onChange={(e) => setFormData({ ...formData, fecha_vencimiento: e.target.value })}
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #f1f5f9' }}>
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    style={{ padding: '0.65rem 1.25rem', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    style={{ padding: '0.65rem 1.5rem', borderRadius: '10px', border: 'none', background: '#0ea5e9', color: '#fff', fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(14, 165, 233, 0.3)' }}
                  >
                    {editingSeq ? 'Guardar Cambios' : 'Registrar y Activar'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
