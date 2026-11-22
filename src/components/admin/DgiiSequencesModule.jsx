import React, { useState, useEffect } from 'react';
import { 
  Receipt, Plus, ShieldCheck, AlertCircle, CheckCircle2, Clock, 
  Layers, BarChart3, Edit, Trash2, X, Save, RefreshCw, Landmark, 
  HelpCircle, ChevronRight, FileSpreadsheet, ArrowUpRight
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useNotification } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';
import { hasUiPermission } from '../../utils/rbacCatalog';
import { motion, AnimatePresence } from 'framer-motion';

export default function DgiiSequencesModule() {
  const { showNotification } = useNotification();
  const { user } = useAuth();
  const canManageSequences = hasUiPermission(user, 'accounting.sequences.manage');
  const [sequences, setSequences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingSeq, setEditingSeq] = useState(null);

  const [formData, setFormData] = useState({
    tipo_comprobante: 'B02',
    serie: 'B02',
    nombre_comprobante: 'Factura de Consumo',
    no_solicitud: '',
    no_autorizacion: '',
    secuencia_desde: 1,
    secuencia_hasta: 100,
    secuencia_actual: 1,
    fecha_vencimiento: '2027-12-31',
    alerta_minima: 10
  });

  const COMPROBANTE_TYPES = [
    { code: 'B02', name: 'Factura de Consumo', desc: 'Consumidor final (comprobante comercial / NCF tradicional)' },
    { code: 'B01', name: 'Factura de Crédito Fiscal', desc: 'Empresas y contribuyentes con RNC (NCF tradicional)' },
    { code: 'B14', name: 'Comprobante Regímenes Especiales', desc: 'Zonas francas y regímenes especiales' },
    { code: 'B15', name: 'Comprobante Gubernamental', desc: 'Instituciones del Estado' },
    { code: 'B04', name: 'Nota de Crédito', desc: 'Anulaciones, devoluciones o ajustes comerciales' }
  ];

  const fetchSequences = async () => {
    setLoading(true);
    try {
      const data = await dataService.getDgiiSequences();
      setSequences(Array.isArray(data) ? data : []);
    } catch {
      showNotification('Error cargando secuencias de comprobantes', 'error');
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
      tipo_comprobante: 'B02',
      serie: 'B02',
      nombre_comprobante: 'Factura de Consumo',
      no_solicitud: '',
      no_autorizacion: '',
      secuencia_desde: 1,
      secuencia_hasta: 100,
      secuencia_actual: 1,
      fecha_vencimiento: '2027-12-31',
      alerta_minima: 10
    });
    setShowModal(true);
  };

  const handleOpenEdit = (seq) => {
    setEditingSeq(seq);
    setFormData({
      tipo_comprobante: seq.tipo_comprobante,
      serie: seq.serie || seq.tipo_comprobante,
      nombre_comprobante: seq.nombre_comprobante,
      no_solicitud: seq.no_solicitud || '',
      no_autorizacion: seq.no_autorizacion || '',
      secuencia_desde: Number(seq.secuencia_desde || 1),
      secuencia_hasta: Number(seq.secuencia_hasta || 100),
      secuencia_actual: Number(seq.secuencia_actual || 1),
      cantidad_usada: Number(seq.cantidad_usada || 0),
      fecha_vencimiento: seq.fecha_vencimiento ? String(seq.fecha_vencimiento).split('T')[0] : '',
      alerta_minima: Number(seq.alerta_minima || 10),
      estado: seq.estado || 'Activo'
    });
    setShowModal(true);
  };

  const handleTypeChange = (typeCode) => {
    const found = COMPROBANTE_TYPES.find(t => t.code === typeCode);
    setFormData(prev => ({
      ...prev,
      tipo_comprobante: typeCode,
      serie: typeCode,
      nombre_comprobante: found ? found.name : prev.nombre_comprobante
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...formData,
        secuencia_desde: Number(formData.secuencia_desde),
        secuencia_hasta: Number(formData.secuencia_hasta),
        secuencia_actual: Number(formData.secuencia_actual),
        alerta_minima: Number(formData.alerta_minima) || 10,
      };
      const res = editingSeq
        ? await dataService.updateDgiiSequence(editingSeq.id, payload)
        : await dataService.createDgiiSequence(payload);
      if (res.success) {
        showNotification(editingSeq ? 'Secuencia actualizada correctamente' : 'Secuencia registrada y activada con éxito', 'success');
        setShowModal(false);
        fetchSequences();
      } else {
        showNotification(res.error || 'Error al guardar secuencia', 'error');
      }
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
      } else {
        showNotification(res.error || 'No se pudo eliminar la secuencia', 'error');
      }
    } catch {
      showNotification('Error al eliminar', 'error');
    }
  };

  // Metrics
  const totalDisponibles = sequences.reduce((acc, s) => acc + (s.cantidad_disponible || 0), 0);
  const totalUsados = sequences.reduce((acc, s) => acc + (s.cantidad_usada || 0), 0);
  const activeBatchesCount = sequences.filter(s => s.estado_calculado === 'Activo').length;
  const lowOrAlertCount = sequences.filter(s => s.is_alerta_minima || s.is_agotado || s.is_vencido).length;

  return (
    <div className="dgii-sequences-module" style={{ padding: '0 0.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
            <span style={{
              background: '#0f172a',
              color: '#fff',
              padding: '0.35rem 0.65rem',
              borderRadius: '8px',
              fontSize: '0.75rem',
              fontWeight: 800,
              letterSpacing: '0.05em'
            }}>
              FACTURACIÓN Y COMPROBANTES
            </span>
            <span style={{
              background: '#f8fafc',
              color: '#475569',
              border: '1px solid #cbd5e1',
              padding: '0.25rem 0.6rem',
              borderRadius: '999px',
              fontSize: '0.75rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem'
            }}>
              <ShieldCheck size={14} /> Numeración local autorizada por la empresa
            </span>
          </div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
            Gestión de Secuencias de Comprobantes
          </h2>
          <p style={{ fontSize: '0.9rem', color: '#64748b', margin: '0.25rem 0 0 0' }}>
            Configura los rangos de comprobantes comerciales y NCF tradicionales de tu empresa para asignación correlativa en caja.
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

          {canManageSequences && (
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
              <Plus size={18} /> Registrar Nueva Secuencia
            </button>
          )}
        </div>
      </div>

      {/* Aviso legal / alcance comercial */}
      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '14px', padding: '0.9rem 1.15rem', marginBottom: '1.5rem', color: '#92400e', fontSize: '0.825rem', lineHeight: 1.5 }}>
        <div>
          <strong>Responsabilidad de la empresa:</strong> La empresa es responsable de introducir secuencias válidas y autorizadas. Etereas gestiona la numeración correlativa local y <strong>no obtiene autorización de la DGII</strong> al guardarlas.
        </div>
        <div style={{ marginTop: '0.35rem', color: '#78350f' }}>
          <strong>Integración de facturación electrónica DGII (e-CF):</strong> contratación y habilitación por separado. Las facturas locales no sustituyen la emisión ni la aceptación electrónica ante la DGII.
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
            Listos para asignación en caja
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
            Tipos de comprobantes vigentes
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.25rem', border: '1px solid #f1f5f9', boxShadow: '0 2px 10px rgba(0,0,0,0.03)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Comprobantes Asignados</span>
            <div style={{ background: '#faf5ff', color: '#9333ea', padding: '0.4rem', borderRadius: '10px' }}>
              <BarChart3 size={18} />
            </div>
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 800, color: '#0f172a' }}>{totalUsados.toLocaleString()}</div>
          <div style={{ fontSize: '0.75rem', color: '#9333ea', fontWeight: 600, marginTop: '0.25rem' }}>
            Números asignados en facturas locales
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.25rem', border: '1px solid #f1f5f9', boxShadow: '0 2px 10px rgba(0,0,0,0.03)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Alertas de Secuencia</span>
            <div style={{ background: lowOrAlertCount > 0 ? '#fef2f2' : '#f8fafc', color: lowOrAlertCount > 0 ? '#dc2626' : '#64748b', padding: '0.4rem', borderRadius: '10px' }}>
              <Landmark size={18} />
            </div>
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 800, color: lowOrAlertCount > 0 ? '#dc2626' : '#0f172a' }}>{lowOrAlertCount}</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, marginTop: '0.25rem' }}>
            Por agotarse, agotadas o vencidas
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #f1f5f9', boxShadow: '0 4px 20px rgba(0,0,0,0.02)', overflow: 'hidden' }}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
              Secuencias de Comprobantes Configuradas
            </h3>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0.2rem 0 0 0' }}>
              Control correlativo y alertas de disponibilidad en tiempo real para caja
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
                            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                              {seq.is_electronic ? 'Electrónico (requiere integración e-CF)' : 'Comprobante comercial / NCF'}
                            </div>
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
                        {!seq.is_authorized && (
                          <span style={{ display: 'inline-block', fontSize: '0.65rem', padding: '1px 6px', borderRadius: '4px', background: '#fef3c7', color: '#92400e', fontWeight: 700, marginTop: '3px' }}>
                            Sin Registro OFV
                          </span>
                        )}
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
                        {seq.motivo_inactividad && (
                          <div style={{ fontSize: '0.7rem', color: '#dc2626', marginTop: '0.25rem', maxWidth: '160px', lineHeight: '1.2' }}>
                            {seq.motivo_inactividad}
                          </div>
                        )}
                      </td>

                      <td style={{ padding: '1.25rem 1.5rem', textAlign: 'right' }}>
                        {canManageSequences ? (
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
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Solo consulta</span>
                        )}
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
                    {editingSeq ? 'Editar Secuencia de Comprobante' : 'Registrar Secuencia de Comprobante'}
                  </h3>
                  <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0.2rem 0 0 0' }}>
                    La empresa es responsable de registrar únicamente rangos válidos y autorizados.
                  </p>
                </div>
                <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSubmit} style={{ padding: '1.5rem' }}>
                {editingSeq && Number(editingSeq.cantidad_usada || 0) > 0 && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '0.65rem 0.85rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#92400e' }}>
                    Esta secuencia ya tiene <strong>{editingSeq.cantidad_usada}</strong> comprobante(s) emitido(s). El tipo y el inicio de rango están protegidos para evitar duplicados.
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem', textTransform: 'uppercase' }}>
                      Tipo de Comprobante
                    </label>
                    <select
                      value={formData.tipo_comprobante}
                      disabled={Boolean(editingSeq && Number(editingSeq.cantidad_usada || 0) > 0)}
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
                      Prefijo / Serie
                    </label>
                    <input
                      type="text"
                      required
                      disabled={Boolean(editingSeq && Number(editingSeq.cantidad_usada || 0) > 0)}
                      placeholder="Ej. B02"
                      value={formData.serie}
                      onChange={(e) => setFormData({ ...formData, serie: e.target.value.toUpperCase() })}
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontFamily: 'monospace', fontWeight: 700 }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem', textTransform: 'uppercase' }}>
                      Rango Inicio (Desde)
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      disabled={Boolean(editingSeq && Number(editingSeq.cantidad_usada || 0) > 0)}
                      value={formData.secuencia_desde}
                      onChange={(e) => setFormData({ ...formData, secuencia_desde: e.target.value })}
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontFamily: 'monospace', fontWeight: 700 }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem', textTransform: 'uppercase' }}>
                      Rango Fin (Hasta)
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={formData.secuencia_hasta}
                      onChange={(e) => setFormData({ ...formData, secuencia_hasta: e.target.value })}
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontFamily: 'monospace', fontWeight: 700 }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem', textTransform: 'uppercase' }}>
                      Próximo Número
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={formData.secuencia_actual}
                      onChange={(e) => setFormData({ ...formData, secuencia_actual: e.target.value })}
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontFamily: 'monospace', fontWeight: 700 }}
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

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem', textTransform: 'uppercase' }}>
                      No. Autorización (Opcional)
                    </label>
                    <input
                      type="text"
                      placeholder="Referencia interna / DGII"
                      value={formData.no_autorizacion}
                      onChange={(e) => setFormData({ ...formData, no_autorizacion: e.target.value })}
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem', textTransform: 'uppercase' }}>
                      Alerta Mínima (Restantes)
                    </label>
                    <input
                      type="number"
                      min="1"
                      placeholder="Ej. 10"
                      value={formData.alerta_minima}
                      onChange={(e) => setFormData({ ...formData, alerta_minima: parseInt(e.target.value, 10) || 10 })}
                      style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 700 }}
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
