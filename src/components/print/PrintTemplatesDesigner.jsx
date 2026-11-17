import React, { useEffect, useState, useCallback } from 'react';
import { Printer, Save, Upload, RotateCcw, ArrowUp, ArrowDown, Plus, Ticket } from 'lucide-react';
import DocumentPrintRenderer from './DocumentPrintRenderer';
import { useTenantBranding } from '../../context/TenantBrandingContext';

const DOC_TYPE_LABELS = {
  ticket_turno: 'Ticket de turno (Car Wash)',
  ticket_venta: 'Ticket de venta (POS)',
  factura_comercial: 'Factura comercial',
  comanda_restaurante: 'Comanda de restaurante',
};

const SAMPLE_DATA_BY_TYPE = {
  ticket_turno: {
    display_number: '025',
    service_name: 'Lavado Premium + Encerado',
    observations: 'SUV Negro · Placa G458210',
    issued_at: new Date().toISOString(),
  },
  ticket_venta: {
    ticket_number: 'V-00142',
    customer_name: 'María Pérez',
    items: [
      { name: 'Lavado y Secado', qty: 1, total: 'RD$ 600.00' },
      { name: 'Hidratación Profunda', qty: 1, total: 'RD$ 900.00' },
    ],
    subtotal: 'RD$ 1,500.00',
    tax: 'RD$ 0.00',
    total: 'RD$ 1,500.00',
    issued_at: new Date().toISOString(),
  },
  factura_comercial: {
    ticket_number: 'FAC-00089',
    ncf: 'B0100000089',
    rnc: '131917038',
    customer_name: 'Salón Ejemplo SRL',
    customer_rnc: '101999999',
    items: [
      { name: 'Servicio Profesional', qty: 1, total: 'RD$ 2,000.00' },
    ],
    subtotal: 'RD$ 2,000.00',
    tax: 'RD$ 360.00',
    total: 'RD$ 2,360.00',
    issued_at: new Date().toISOString(),
  },
};

export default function PrintTemplatesDesigner() {
  const { branding } = useTenantBranding();
  const [availability, setAvailability] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [branches, setBranches] = useState([]);
  const [selectedDocType, setSelectedDocType] = useState('ticket_turno');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState(null);

  const [name, setName] = useState('');
  const [paperWidth, setPaperWidth] = useState('80mm');
  const [numberingMode, setNumberingMode] = useState('daily_reset');
  const [timezone, setTimezone] = useState('America/Santo_Domingo');
  const [config, setConfig] = useState(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Quick Turn Ticket test/emit panel
  const [catalogItems, setCatalogItems] = useState([]);
  const [catalogFilter, setCatalogFilter] = useState('');
  const [turnService, setTurnService] = useState('');
  const [turnObs, setTurnObs] = useState('');
  const [issuedTurn, setIssuedTurn] = useState(null);
  const [recentTurns, setRecentTurns] = useState([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [availRes, tplRes, salonsRes, turnsRes, servicesRes] = await Promise.all([
        fetch('/api/print-templates/availability', { credentials: 'include' }),
        fetch('/api/print-templates', { credentials: 'include' }),
        fetch('/api/salons', { credentials: 'include' }),
        fetch('/api/turn-tickets', { credentials: 'include' }),
        fetch('/api/services', { credentials: 'include' }),
      ]);
      const availJson = await availRes.json().catch(() => ({}));
      const tplJson = await tplRes.json().catch(() => ({}));
      const salonsJson = await salonsRes.json().catch(() => []);
      const turnsJson = await turnsRes.json().catch(() => ({}));
      const servicesJson = await servicesRes.json().catch(() => []);

      setAvailability(availJson);
      setTemplates(Array.isArray(tplJson.templates) ? tplJson.templates : []);
      setBranches(Array.isArray(salonsJson) ? salonsJson : (salonsJson.salons || []));
      setRecentTurns(Array.isArray(turnsJson.tickets) ? turnsJson.tickets : []);
      const rawCatalog = Array.isArray(servicesJson) ? servicesJson : (servicesJson.services || []);
      setCatalogItems(rawCatalog.filter((it) => it && it.activo !== false && it.is_active !== false));
    } catch (err) {
      setError(err.message || 'No se pudieron cargar las plantillas de impresión.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Sync editor state when document type, branch, or loaded templates change
  useEffect(() => {
    if (!availability) return;
    const match = templates.find(
      (t) =>
        t.document_type === selectedDocType &&
        String(t.branch_id || '') === String(selectedBranchId || '')
    ) || templates.find((t) => t.document_type === selectedDocType && !t.branch_id);

    const def = availability?.defaults?.[selectedDocType] || availability?.defaults?.ticket_turno;
    if (match) {
      setEditingTemplateId(match.id);
      setName(match.name);
      setPaperWidth(match.paper_width || '80mm');
      setNumberingMode(match.numbering_mode || 'daily_reset');
      setTimezone(match.timezone || 'America/Santo_Domingo');
      setConfig(match.config_json || def?.config_json);
    } else if (def) {
      setEditingTemplateId(null);
      setName(def.name);
      setPaperWidth(def.paper_width);
      setNumberingMode(def.numbering_mode || 'daily_reset');
      setTimezone(def.timezone || 'America/Santo_Domingo');
      setConfig(JSON.parse(JSON.stringify(def.config_json)));
    }
  }, [selectedDocType, selectedBranchId, templates, availability]);

  const moveBlock = (index, direction) => {
    if (!config?.blocks) return;
    const next = [...config.blocks];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setConfig({ ...config, blocks: next });
  };

  const updateBlock = (index, patch) => {
    const next = [...(config?.blocks || [])];
    next[index] = { ...next[index], ...patch };
    setConfig({ ...config, blocks: next });
  };

  const handleSave = async ({ publish = false, setAsDefault = false } = {}) => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        document_type: selectedDocType,
        branch_id: selectedBranchId || null,
        name,
        paper_width: paperWidth,
        numbering_mode: numberingMode,
        timezone,
        config_json: config,
        publish,
        is_default: setAsDefault,
      };
      const url = editingTemplateId ? `/api/print-templates/${editingTemplateId}` : '/api/print-templates';
      const method = editingTemplateId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Error guardando plantilla.');

      if (setAsDefault && json.template?.id) {
        await fetch(`/api/print-templates/${json.template.id}/set-default`, {
          method: 'POST',
          credentials: 'include',
        });
      }

      setMessage(publish ? 'Plantilla publicada correctamente.' : 'Borrador guardado.');
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreDefault = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/print-templates/restore-default', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_type: selectedDocType,
          branch_id: selectedBranchId || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Error restaurando plantilla.');
      setMessage('Plantilla predeterminada restaurada.');
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEmitTurn = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/turn-tickets', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        },
        body: JSON.stringify({
          branch_id: selectedBranchId || 'default',
          service_name: turnService.trim() || null,
          observations: turnObs.trim() || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'No se pudo emitir el turno.');
      setIssuedTurn(json.ticket);
      setTurnService('');
      setTurnObs('');
      setMessage(`Turno #${json.ticket.display_number} emitido sin cobro ni factura.`);
      await loadData();
      setTimeout(() => window.print(), 250);
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading || !config) {
    return <div style={{ padding: '2rem', color: '#64748b' }}>Cargando diseñador de impresión...</div>;
  }

  const activeTemplateForPreview = {
    document_type: selectedDocType,
    paper_width: paperWidth,
    numbering_mode: numberingMode,
    timezone,
    config_json: config,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {error && (
        <div role="alert" style={{ padding: '0.85rem 1rem', borderRadius: '10px', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontWeight: 600 }}>
          {error}
        </div>
      )}
      {message && (
        <div role="status" style={{ padding: '0.85rem 1rem', borderRadius: '10px', background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', fontWeight: 600 }}>
          {message}
        </div>
      )}

      {/* Selector de Tipo, Sucursal y Acciones */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', flex: 1 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>Tipo de documento</label>
            <select
              value={selectedDocType}
              onChange={(e) => setSelectedDocType(e.target.value)}
              style={{ padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
            >
              <option value="ticket_turno">{DOC_TYPE_LABELS.ticket_turno}</option>
              <option value="ticket_venta">{DOC_TYPE_LABELS.ticket_venta}</option>
              <option value="factura_comercial">{DOC_TYPE_LABELS.factura_comercial}</option>
              <option value="comanda_restaurante" disabled={!availability?.comanda_restaurante?.available}>
                {DOC_TYPE_LABELS.comanda_restaurante} {!availability?.comanda_restaurante?.available ? '(Sin datos operativos)' : ''}
              </option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>Alcance / Sucursal</label>
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              style={{ padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
            >
              <option value="">Toda la empresa (Predeterminada)</option>
              {branches.map((b) => (
                <option key={b.id} value={String(b.id)}>{b.name || b.business_name}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '0.3rem' }}>Papel</label>
            <select
              value={paperWidth}
              onChange={(e) => setPaperWidth(e.target.value)}
              style={{ padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
            >
              <option value="58mm">Térmico 58mm</option>
              <option value="80mm">Térmico 80mm</option>
              {selectedDocType === 'factura_comercial' && <option value="A4">Hoja A4</option>}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <button type="button" disabled={saving} onClick={() => handleSave({ publish: false })} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.55rem 0.9rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#fff', fontWeight: 600, cursor: 'pointer' }}>
            <Save size={15} /> Guardar borrador
          </button>
          <button type="button" disabled={saving} onClick={() => handleSave({ publish: true, setAsDefault: true })} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.55rem 0.9rem', borderRadius: '8px', border: 'none', background: '#0f172a', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            <Upload size={15} /> Publicar y predeterminar
          </button>
          <button type="button" disabled={saving} onClick={handleRestoreDefault} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.55rem 0.9rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', fontWeight: 600, cursor: 'pointer' }}>
            <RotateCcw size={15} /> Restaurar
          </button>
          <button type="button" onClick={() => { setIssuedTurn(null); setTimeout(() => window.print(), 100); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.55rem 0.9rem', borderRadius: '8px', border: '1px solid #0284c7', background: '#e0f2fe', color: '#0369a1', fontWeight: 700, cursor: 'pointer' }}>
            <Printer size={15} /> Imprimir prueba
          </button>
        </div>
      </div>

      {/* Editor + Vista Previa */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1.2fr) minmax(260px, 0.8fr)', gap: '1.5rem', alignItems: 'start' }}>
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>Personalización visual</h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem' }}>Nombre de plantilla</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', padding: '0.5rem 0.7rem', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem' }}>Título principal</label>
              <input type="text" value={config.title_text || ''} onChange={(e) => setConfig({ ...config, title_text: e.target.value })} style={{ width: '100%', padding: '0.5rem 0.7rem', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem' }}>Mensaje inferior</label>
              <input type="text" value={config.footer_text || ''} onChange={(e) => setConfig({ ...config, footer_text: e.target.value })} style={{ width: '100%', padding: '0.5rem 0.7rem', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
            </div>
            {selectedDocType === 'ticket_turno' && (
              <>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem' }}>Numeración de turnos</label>
                  <select value={numberingMode} onChange={(e) => setNumberingMode(e.target.value)} style={{ width: '100%', padding: '0.5rem 0.7rem', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                    <option value="daily_reset">Reinicio diario (001 cada día)</option>
                    <option value="continuous">Numeración continua</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem' }}>Zona horaria</label>
                  <select value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ width: '100%', padding: '0.5rem 0.7rem', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                    <option value="America/Santo_Domingo">America/Santo_Domingo (AST)</option>
                    <option value="America/New_York">America/New_York</option>
                    <option value="America/Mexico_City">America/Mexico_City</option>
                    <option value="UTC">UTC</option>
                  </select>
                </div>
              </>
            )}
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.88rem', fontWeight: 600 }}>
            <input type="checkbox" checked={config.show_logo !== false} onChange={(e) => setConfig({ ...config, show_logo: e.target.checked })} />
            Mostrar logo de la empresa
          </label>

          {selectedDocType === 'ticket_venta' && (
            <div style={{ padding: '0.9rem', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#0f172a' }}>
                Productos y servicios en el Ticket de Venta
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
                <select
                  value={config.checklist_mode || 'catalog_checklist'}
                  onChange={(e) => setConfig({ ...config, checklist_mode: e.target.value })}
                  style={{ padding: '0.45rem 0.65rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                >
                  <option value="catalog_checklist">Lista pre-impresa de productos/servicios (RD$ ______)</option>
                  <option value="cart_items">Solo ítems cobrados en la venta</option>
                </select>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.83rem', fontWeight: 600 }}>
                  <input type="checkbox" checked={config.show_benefits_box !== false} onChange={(e) => setConfig({ ...config, show_benefits_box: e.target.checked })} />
                  Caja de beneficios (Membresía / Cumpleaños)
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.83rem', fontWeight: 600 }}>
                  <input type="checkbox" checked={config.show_qr_menu !== false} onChange={(e) => setConfig({ ...config, show_qr_menu: e.target.checked })} />
                  Código QR Menú de servicios
                </label>
              </div>

              {(config.checklist_mode || 'catalog_checklist') === 'catalog_checklist' && (
                <div>
                  <input
                    type="text"
                    placeholder="Buscar producto o servicio del catálogo..."
                    value={catalogFilter}
                    onChange={(e) => setCatalogFilter(e.target.value)}
                    style={{ width: '100%', padding: '0.45rem 0.7rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.83rem', marginBottom: '0.5rem' }}
                  />
                  {catalogItems.length === 0 ? (
                    <div style={{ fontSize: '0.82rem', color: '#64748b' }}>
                      No hay productos ni servicios activos en tu catálogo todavía.
                    </div>
                  ) : (
                    <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '0.35rem', padding: '0.25rem' }}>
                      {catalogItems
                        .filter((it) => !catalogFilter || String(it.nombre || it.name || '').toLowerCase().includes(catalogFilter.toLowerCase()))
                        .map((it) => {
                          const itemId = String(it.id);
                          const itemName = it.nombre || it.name;
                          const selectedList = Array.isArray(config.checklist_items) ? config.checklist_items : [];
                          const isChecked = selectedList.some((c) => String(c.id) === itemId);
                          return (
                            <label key={itemId} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', padding: '0.35rem 0.5rem', borderRadius: '6px', background: isChecked ? '#e0f2fe' : '#ffffff', border: '1px solid #e2e8f0', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  const nextList = e.target.checked
                                    ? [...selectedList, { id: itemId, name: itemName }]
                                    : selectedList.filter((c) => String(c.id) !== itemId);
                                  setConfig({ ...config, checklist_items: nextList });
                                }}
                              />
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{itemName}</span>
                            </label>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '0.5rem' }}>Orden, visibilidad, alineación y tamaño de bloques</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              {(config.blocks || []).map((b, idx) => (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.65rem', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#f8fafc', flexWrap: 'wrap' }}>
                  <input type="checkbox" checked={b.visible !== false} onChange={(e) => updateBlock(idx, { visible: e.target.checked })} />
                  <span style={{ flex: '1 1 130px', fontSize: '0.85rem', fontWeight: 600 }}>{b.label}</span>
                  <select value={b.align || 'center'} onChange={(e) => updateBlock(idx, { align: e.target.value })} style={{ padding: '0.25rem 0.4rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}>
                    <option value="left">Izquierda</option>
                    <option value="center">Centro</option>
                    <option value="right">Derecha</option>
                  </select>
                  <select value={b.size || 'md'} onChange={(e) => updateBlock(idx, { size: e.target.value })} style={{ padding: '0.25rem 0.4rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}>
                    <option value="sm">Pequeño</option>
                    <option value="md">Mediano</option>
                    <option value="lg">Grande</option>
                    <option value="xl">Extra grande</option>
                  </select>
                  <button type="button" onClick={() => moveBlock(idx, -1)} disabled={idx === 0} aria-label="Subir" style={{ padding: '0.25rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}><ArrowUp size={14} /></button>
                  <button type="button" onClick={() => moveBlock(idx, 1)} disabled={idx === config.blocks.length - 1} aria-label="Bajar" style={{ padding: '0.25rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}><ArrowDown size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Vista Previa */}
        <div style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '16px', padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.75rem', textAlign: 'center' }}>
            Previsualización ({paperWidth})
          </div>
          <DocumentPrintRenderer
            template={issuedTurn ? issuedTurn.template_snapshot : activeTemplateForPreview}
            data={issuedTurn || SAMPLE_DATA_BY_TYPE[selectedDocType] || SAMPLE_DATA_BY_TYPE.ticket_turno}
            branding={branding}
            isPreview={!issuedTurn}
            printableId="etereas-designer-print-doc"
          />
          <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.75rem', textAlign: 'center' }}>
            La impresión utiliza el diálogo estándar del navegador (`window.print()`). Para impresión silenciosa directa sin diálogo se requiere configurar el navegador en modo kiosco o un agente local de impresora térmica.
          </p>
        </div>
      </div>

      {/* Emisión Rápida de Turno Car Wash (sin cobro) e Historial para Reimpresión */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem' }}>
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.05rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Ticket size={18} /> Emitir y Reimprimir Ticket de Turno (Sin cobro ni factura)
        </h3>
        <form onSubmit={handleEmitTurn} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end', marginBottom: '1rem' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem' }}>Servicio (opcional)</label>
            <input type="text" placeholder="Ej. Lavado Completo" value={turnService} onChange={(e) => setTurnService(e.target.value)} style={{ width: '100%', padding: '0.5rem 0.7rem', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
          </div>
          <div style={{ flex: '1 1 240px' }}>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem' }}>Observaciones (opcional)</label>
            <input type="text" placeholder="Ej. Placa / Modelo / Color" value={turnObs} onChange={(e) => setTurnObs(e.target.value)} style={{ width: '100%', padding: '0.5rem 0.7rem', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
          </div>
          <button type="submit" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.55rem 1rem', borderRadius: '8px', border: 'none', background: '#059669', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            <Plus size={16} /> Emitir turno
          </button>
        </form>

        {recentTurns.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {recentTurns.slice(0, 10).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setIssuedTurn(t);
                  setTimeout(() => window.print(), 150);
                }}
                style={{ padding: '0.45rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <Printer size={13} /> #{t.display_number} {t.service_name ? `· ${t.service_name}` : ''}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
