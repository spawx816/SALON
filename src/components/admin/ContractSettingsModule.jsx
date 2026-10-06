import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  FileSignature, 
  Save, 
  RotateCcw, 
  Eye, 
  Edit3, 
  Copy, 
  Check, 
  Building2, 
  DollarSign, 
  Calendar, 
  ShieldAlert, 
  Info, 
  Sparkles,
  HelpCircle
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useNotification } from '../../context/NotificationContext';
import { DEFAULT_CONTRACT_SETTINGS, CONTRACT_VARIABLES, interpolateContract, markdownToHtml } from '../../utils/contractHelper';

const ContractSettingsModule = () => {
  const { showNotification } = useNotification();
  const [settings, setSettings] = useState(DEFAULT_CONTRACT_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [viewMode, setViewMode] = useState('editor'); // 'editor' | 'preview'
  const [copiedTag, setCopiedTag] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const textareaRef = useRef(null);

  // Load contract settings from API
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await dataService.getContractSettings();
      if (res && res.title) {
        setSettings(prev => ({
          ...DEFAULT_CONTRACT_SETTINGS,
          ...res,
          content: res.content || DEFAULT_CONTRACT_SETTINGS.content
        }));
      }
    } catch (err) {
      console.error('Error loading contract settings:', err);
      showNotification('Error al cargar la configuración del contrato', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      await dataService.saveContractSettings(settings);
      showNotification('¡Contrato actualizado correctamente!', 'success');
    } catch (err) {
      showNotification(err.message || 'Error al guardar los cambios del contrato', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    const confirmed = window.confirm(
      '¿Estás seguro de que deseas restablecer el contrato a su plantilla original por defecto? Se sobrescribirán las cláusulas personalizadas.'
    );
    if (!confirmed) return;

    setResetting(true);
    try {
      await dataService.resetContractSettings();
      setSettings(DEFAULT_CONTRACT_SETTINGS);
      showNotification('Plantilla de contrato restablecida a los valores predeterminados', 'success');
    } catch (err) {
      showNotification(err.message || 'Error al restablecer el contrato', 'error');
    } finally {
      setResetting(false);
    }
  };

  const copyToClipboard = (tag) => {
    navigator.clipboard.writeText(tag);
    setCopiedTag(tag);
    setTimeout(() => setCopiedTag(null), 2000);
    showNotification(`Variable ${tag} copiada al portapapeles`, 'info');
  };

  const insertTagAtCursor = (tag) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      copyToClipboard(tag);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentText = settings.content || '';
    const newText = currentText.substring(0, start) + tag + currentText.substring(end);
    setSettings({ ...settings, content: newText });
    
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length, start + tag.length);
    }, 50);
  };

  // Mock data for preview
  const sampleClient = {
    nombre: 'Carolina Santana Méndez',
    cedula: '001-0987654-3',
    calle: 'Av. Las Palmas',
    numero: '45-B',
    sector: 'Alma Rosa I',
    ciudad: 'Santo Domingo Este',
    telefono: '809-555-0199',
    email: 'carolina.santana@ejemplo.com'
  };

  const samplePlan = {
    title: 'Plan Beauty VIP Gold',
    price: '1950.00',
    services_description: '4 Lavados y Secados Premium al mes + Masaje Capilar',
    quota: '4'
  };

  const renderedPreviewText = interpolateContract(settings.content, {
    client: sampleClient,
    plan: samplePlan,
    settings: settings,
    date: new Date()
  });

  return (
    <div className="contract-settings-module">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
            <div style={{ background: '#0ea5e9', color: '#fff', padding: '0.5rem', borderRadius: '10px' }}>
              <FileSignature size={22} />
            </div>
            <h2 className="page-title" style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>
              Plantilla y Cláusulas del Contrato Digital
            </h2>
          </div>
          <p className="page-subtitle" style={{ margin: '0.25rem 0 0 0', color: '#64748b', fontSize: '0.875rem' }}>
            Modifica los términos legales, razón social, tarifas de renovación y variables dinámicas del contrato de adhesión.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {/* Mode Switcher */}
          <div style={{ display: 'flex', background: '#e2e8f0', padding: '3px', borderRadius: '10px' }}>
            <button
              type="button"
              onClick={() => setViewMode('editor')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                border: 'none',
                background: viewMode === 'editor' ? '#fff' : 'transparent',
                color: viewMode === 'editor' ? '#0f172a' : '#64748b',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: 'pointer',
                boxShadow: viewMode === 'editor' ? '0 2px 4px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.2s'
              }}
            >
              <Edit3 size={15} /> Editor
            </button>
            <button
              type="button"
              onClick={() => setViewMode('preview')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                border: 'none',
                background: viewMode === 'preview' ? '#fff' : 'transparent',
                color: viewMode === 'preview' ? '#0f172a' : '#64748b',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: 'pointer',
                boxShadow: viewMode === 'preview' ? '0 2px 4px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.2s'
              }}
            >
              <Eye size={15} /> Vista Previa
            </button>
          </div>

          <button
            type="button"
            onClick={handleReset}
            disabled={resetting || loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.65rem 1rem',
              borderRadius: '10px',
              border: '1px solid #cbd5e1',
              background: '#fff',
              color: '#64748b',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            title="Restablecer a plantilla predeterminada"
          >
            <RotateCcw size={15} /> {resetting ? 'Restableciendo...' : 'Restaurar'}
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="btn-primary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.65rem 1.5rem',
              borderRadius: '10px',
              fontWeight: 700,
              fontSize: '0.85rem',
              boxShadow: '0 4px 12px rgba(14, 165, 233, 0.3)'
            }}
          >
            <Save size={16} /> {saving ? 'Guardando...' : 'Guardar Contrato'}
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem 0', color: '#64748b' }}>
          <p style={{ fontWeight: 600 }}>Cargando configuración del contrato...</p>
        </div>
      ) : (
        <AnimatePresence mode="wait">
          {viewMode === 'editor' ? (
            <motion.div
              key="editor"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.9fr) minmax(0, 1.1fr)', gap: '1.75rem' }}
            >
              {/* Left Column: Form & Contract Body Editor */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* General Contract Fields */}
                <div className="surface-card" style={{ padding: '1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
                    <Building2 size={18} color="#0ea5e9" />
                    <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, color: '#1e293b' }}>
                      Información Institucional y Parámetros
                    </h3>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div className="form-group" style={{ gridColumn: 'span 2' }}>
                      <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 800, color: '#64748b', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                        Título del Documento
                      </label>
                      <input
                        type="text"
                        className="input-field"
                        value={settings.title}
                        onChange={e => setSettings({ ...settings, title: e.target.value })}
                        placeholder="Ej: CONTRATO DE SUSCRIPCIÓN DE SERVICIOS DE BELLEZA"
                        style={{ fontWeight: 700 }}
                      />
                    </div>

                    <div className="form-group">
                      <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 800, color: '#64748b', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                        Razón Social (LA COMPAÑÍA)
                      </label>
                      <input
                        type="text"
                        className="input-field"
                        value={settings.company_name}
                        onChange={e => setSettings({ ...settings, company_name: e.target.value })}
                        placeholder="ETEREAS S. R. L."
                      />
                    </div>

                    <div className="form-group">
                      <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 800, color: '#64748b', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                        RNC de la Empresa
                      </label>
                      <input
                        type="text"
                        className="input-field"
                        value={settings.company_rnc}
                        onChange={e => setSettings({ ...settings, company_rnc: e.target.value })}
                        placeholder="1-31-91703-8"
                      />
                    </div>

                    <div className="form-group" style={{ gridColumn: 'span 2' }}>
                      <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 800, color: '#64748b', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                        Domicilio Social de la Empresa
                      </label>
                      <input
                        type="text"
                        className="input-field"
                        value={settings.company_address}
                        onChange={e => setSettings({ ...settings, company_address: e.target.value })}
                        placeholder="Av. San Vicente De Paul..."
                      />
                    </div>

                    <div className="form-group">
                      <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 800, color: '#64748b', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                        Cargo de Renovación Anual (RD$)
                      </label>
                      <input
                        type="text"
                        className="input-field"
                        value={settings.renewal_fee}
                        onChange={e => setSettings({ ...settings, renewal_fee: e.target.value })}
                        placeholder="800.00"
                      />
                    </div>

                    <div className="form-group">
                      <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 800, color: '#64748b', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                        Duración Inicial (Meses)
                      </label>
                      <input
                        type="text"
                        className="input-field"
                        value={settings.min_duration_months}
                        onChange={e => setSettings({ ...settings, min_duration_months: e.target.value })}
                        placeholder="12"
                      />
                    </div>
                  </div>
                </div>

                {/* Contract Body Editor */}
                <div className="surface-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <FileSignature size={18} color="#0ea5e9" />
                      <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, color: '#1e293b' }}>
                        Cuerpo y Cláusulas del Contrato
                      </h3>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600 }}>
                      Usa **negrita** y las etiquetas {'{{VARIABLE}}'}
                    </span>
                  </div>

                  <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 0.75rem 0' }}>
                    Edita el texto del contrato directamente. Los campos entre llaves dobles (como <code style={{ color: '#0284c7', background: '#f0f9ff', padding: '2px 4px', borderRadius: '4px' }}>{'{{CLIENTE_NOMBRE}}'}</code>) se sustituirán automáticamente al firmar o imprimir.
                  </p>

                  <textarea
                    ref={textareaRef}
                    className="input-field"
                    style={{
                      width: '100%',
                      minHeight: '480px',
                      fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                      fontSize: '0.85rem',
                      lineHeight: 1.7,
                      padding: '1rem',
                      borderRadius: '12px',
                      resize: 'vertical',
                      whiteSpace: 'pre-wrap'
                    }}
                    value={settings.content}
                    onChange={e => setSettings({ ...settings, content: e.target.value })}
                    placeholder="Escribe aquí las cláusulas del contrato..."
                  />
                </div>
              </div>

              {/* Right Column: Dynamic Variables Cheat Sheet & Helpers */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div className="surface-card" style={{ padding: '1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <Sparkles size={18} color="#f59e0b" />
                    <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, color: '#1e293b' }}>
                      Variables Dinámicas
                    </h3>
                  </div>
                  <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0 0 1rem 0' }}>
                    Haz clic en cualquier variable para insertarla en la posición del cursor en el editor:
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '560px', overflowY: 'auto', paddingRight: '0.25rem' }}>
                    {CONTRACT_VARIABLES.map(v => (
                      <div
                        key={v.tag}
                        onClick={() => insertTagAtCursor(v.tag)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.6rem 0.8rem',
                          background: copiedTag === v.tag ? '#ecfdf5' : '#f8fafc',
                          border: `1px solid ${copiedTag === v.tag ? '#10b981' : '#e2e8f0'}`,
                          borderRadius: '8px',
                          cursor: 'pointer',
                          transition: 'all 0.15s'
                        }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = '#0ea5e9'}
                        onMouseLeave={e => e.currentTarget.style.borderColor = copiedTag === v.tag ? '#10b981' : '#e2e8f0'}
                        title={`Clic para insertar ${v.tag}`}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.8rem', color: '#0284c7' }}>
                            {v.tag}
                          </span>
                          <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                            {v.label} (ej: <em>{v.sample}</em>)
                          </span>
                        </div>
                        <div style={{ color: copiedTag === v.tag ? '#10b981' : '#94a3b8' }}>
                          {copiedTag === v.tag ? <Check size={16} /> : <Copy size={14} />}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Information Card */}
                <div className="surface-card" style={{ padding: '1.25rem', background: '#f8fafc', border: '1px dashed #cbd5e1' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <Info size={18} color="#0284c7" />
                    <h4 style={{ fontSize: '0.85rem', fontWeight: 800, margin: 0, color: '#1e293b' }}>
                      Sincronización en Todo el Sistema
                    </h4>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: '#64748b', lineHeight: 1.6, margin: 0 }}>
                    Al guardar esta plantilla, se aplicará automáticamente en:
                  </p>
                  <ul style={{ fontSize: '0.75rem', color: '#475569', paddingLeft: '1.25rem', margin: '0.4rem 0 0 0', lineHeight: 1.6 }}>
                    <li>El flujo de firma y aceptación en el <strong>Portal de Clientes</strong>.</li>
                    <li>La generación de contratos desde la <strong>Recepción y POS</strong>.</li>
                    <li>La impresión física y descarga en <strong>PDF del Contrato Digital</strong>.</li>
                  </ul>
                </div>
              </div>
            </motion.div>
          ) : (
            /* Preview Mode */
            <motion.div
              key="preview"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="surface-card"
              style={{ padding: '2.5rem', maxWidth: '850px', margin: '0 auto', background: '#fff', boxShadow: '0 10px 30px rgba(0,0,0,0.06)' }}
            >
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '0.75rem 1.25rem', borderRadius: '10px', marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Check size={18} color="#16a34a" />
                <span style={{ fontSize: '0.8rem', color: '#15803d', fontWeight: 600 }}>
                  Modo de Vista Previa: Visualizando el contrato con datos de prueba de la clienta <strong>{sampleClient.nombre}</strong>.
                </span>
              </div>

              {/* Printable-style Preview */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '16px', padding: '2.5rem', background: '#fafafa' }}>
                <div style={{ textAlign: 'center', borderBottom: '2px solid #0f172a', paddingBottom: '1.5rem', marginBottom: '2rem' }}>
                  <h1 style={{ fontSize: '1.4rem', fontWeight: 900, color: '#0f172a', margin: '0 0 0.5rem 0', letterSpacing: '1px' }}>
                    {settings.title || 'CONTRATO DE SUSCRIPCIÓN DE SERVICIOS DE BELLEZA'}
                  </h1>
                  <p style={{ margin: 0, fontSize: '0.9rem', color: '#64748b', fontWeight: 700 }}>
                    ABATTE PELUQUERÍA - {settings.company_name}
                  </p>
                </div>

                {/* Client Meta Box */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', background: '#fff', padding: '1.25rem', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: '2rem' }}>
                  <div>
                    <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>CLIENTE</span>
                    <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0f172a' }}>{sampleClient.nombre}</div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Cédula: {sampleClient.cedula}</div>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>PLAN CONTRATADO</span>
                    <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0f172a' }}>{samplePlan.title}</div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>RD$ {samplePlan.price} / mes</div>
                  </div>
                </div>

                {/* Contract Body Rendered */}
                <div 
                  style={{ 
                    fontSize: '0.85rem', 
                    color: '#334155', 
                    lineHeight: 1.8, 
                    textAlign: 'justify', 
                    whiteSpace: 'pre-wrap',
                    background: '#fff',
                    padding: '2rem',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0'
                  }}
                  dangerouslySetInnerHTML={{ __html: markdownToHtml(renderedPreviewText) }}
                />

                {/* Signatures Preview */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3rem', marginTop: '3rem', paddingTop: '2rem', borderTop: '1px solid #e2e8f0' }}>
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ fontWeight: 800, fontSize: '0.85rem', color: '#0f172a', marginBottom: '2.5rem' }}>Por LA COMPAÑÍA</p>
                    <div style={{ width: '180px', borderTop: '1px solid #000', margin: '0 auto 0.5rem auto' }}></div>
                    <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>{settings.company_name}</p>
                    <p style={{ fontSize: '0.7rem', color: '#94a3b8', margin: 0 }}>RNC: {settings.company_rnc}</p>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ fontWeight: 800, fontSize: '0.85rem', color: '#0f172a', marginBottom: '0.5rem' }}>Por EL CLIENTE</p>
                    <div style={{ fontFamily: "'Dancing Script', cursive", fontSize: '2rem', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0ea5e9' }}>
                      {sampleClient.nombre}
                    </div>
                    <div style={{ width: '180px', borderTop: '1px solid #000', margin: '0.5rem auto 0.5rem auto' }}></div>
                    <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>{sampleClient.nombre}</p>
                    <p style={{ fontSize: '0.7rem', color: '#94a3b8', margin: 0 }}>ID: {sampleClient.cedula}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
};

export default ContractSettingsModule;
