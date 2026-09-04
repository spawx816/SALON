import React, { useState, useEffect } from 'react';
import { Send, Award, Cake, Bell, Users, RefreshCw, CheckCircle } from 'lucide-react';
import { dataService } from '../../utils/dataService';

const DEFAULT_SETTINGS = {
  birthday_automation_enabled: 1,
  birthday_discount: 15,
  birthday_flyer_url: '',
  birthday_email_subject: '¡Feliz Cumpleaños! 🎉',
  birthday_email_template: '¡Hola {{nombre}}! Esperamos que tengas un día maravilloso. Como regalo de cumpleaños, disfruta de un {{descuento}}% de descuento en cualquiera de nuestros servicios durante esta semana. ¡Te esperamos!',
  mass_email_template: '¡Hola {{nombre}}!\n\nTenemos una oferta exclusiva para ti...\n\n¡Te esperamos pronto!'
};

const Toggle = ({ checked, onChange }) => (
  <div
    onClick={() => onChange(!checked)}
    style={{
      width: '48px', height: '26px', borderRadius: '99px',
      background: checked ? '#d946ef' : '#d1d5db',
      position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
      flexShrink: 0
    }}
  >
    <div style={{
      position: 'absolute', top: '3px',
      left: checked ? '25px' : '3px',
      width: '20px', height: '20px', borderRadius: '50%',
      background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      transition: 'left 0.2s'
    }} />
  </div>
);

const MarketingModule = () => {
  const [settings, setSettings]           = useState(DEFAULT_SETTINGS);
  const [subject, setSubject]             = useState('¡Nueva promoción exclusiva en PLAN BEAUTY! ✨');
  const [campaignType, setCampaignType]   = useState('text'); // 'text' | 'image'
  const [campaignFlyerUrl, setCampaignFlyerUrl] = useState('');
  const [audienceFilter, setAudienceFilter]     = useState('all');
  const [activeTab, setActiveTab]         = useState('campaign'); // 'campaign' | 'birthday'
  const [clientCount, setClientCount]     = useState(null);
  const [stats, setStats]                 = useState(null);
  const [isLoading, setIsLoading]         = useState(true);
  const [isSaving, setIsSaving]           = useState(false);
  const [isSending, setIsSending]         = useState(false);
  const [isBirthdaySending, setIsBirthdaySending] = useState(false);
  const [isFlyerUploading, setIsFlyerUploading]       = useState(false);
  const [isCampaignFlyerUploading, setIsCampaignFlyerUploading] = useState(false);
  const [saveSuccess, setSaveSuccess]     = useState(false);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const [sett, countRes, mStats] = await Promise.all([
          dataService.getMarketingSettings(),
          dataService.getMarketingRecipientCount(audienceFilter),
          dataService.getMarketingStats(),
        ]);
        if (sett) setSettings(prev => ({ ...DEFAULT_SETTINGS, ...sett }));
        if (countRes && typeof countRes.count === 'number') setClientCount(countRes.count);
        if (mStats) setStats(mStats);
      } catch (e) {
        console.error('Error cargando datos de marketing:', e);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  // Update recipient count when audience filter changes
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const res = await dataService.getMarketingRecipientCount(audienceFilter);
        if (res && typeof res.count === 'number') {
          setClientCount(res.count);
        }
      } catch (err) {
        console.error('Error fetching recipient count:', err);
      }
    };
    if (!isLoading) {
      fetchCount();
    }
  }, [audienceFilter]);

  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      await dataService.saveMarketingSettings(settings);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      alert('Error al guardar: ' + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleBirthdayFlyerUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert('La imagen excede el límite de 5MB.'); return; }
    setIsFlyerUploading(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const res = await dataService.uploadMarketingFlyer(ev.target.result, file.name);
        if (res.success && res.flyerUrl) {
          setSettings(prev => ({ ...prev, birthday_flyer_url: res.flyerUrl }));
          alert('¡Flyer subido!');
        } else {
          alert('Error: ' + (res.error || 'Desconocido'));
        }
      } catch (err) {
        alert('Error: ' + err.message);
      } finally {
        setIsFlyerUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCampaignFlyerUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert('La imagen excede el límite de 5MB.'); return; }
    setIsCampaignFlyerUploading(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const res = await dataService.uploadCampaignFlyer(ev.target.result, file.name);
        if (res.success && res.flyerUrl) {
          setCampaignFlyerUrl(res.flyerUrl);
        } else {
          alert('Error: ' + (res.error || 'Desconocido'));
        }
      } catch (err) {
        alert('Error: ' + err.message);
      } finally {
        setIsCampaignFlyerUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSendMassive = async () => {
    if (campaignType === 'text' && (!subject || !settings.mass_email_template)) {
      return alert('Complete el asunto y el mensaje.');
    }
    if (campaignType === 'image' && !campaignFlyerUrl) {
      return alert('Suba el arte de campaña primero.');
    }
    if (!window.confirm(`¿Enviar este correo a los ${clientCount ?? 'todos los'} clientes del segmento seleccionado?`)) return;
    setIsSending(true);
    try {
      const res = await dataService.sendMassEmail(
        subject, settings.mass_email_template, campaignType, campaignFlyerUrl, audienceFilter
      );
      alert(`¡Campaña lanzada! Enviado a ${res.sent} clientes.`);
      const mStats = await dataService.getMarketingStats();
      if (mStats) setStats(mStats);
    } catch (e) {
      alert('Error al enviar: ' + e.message);
    } finally {
      setIsSending(false);
    }
  };

  const handleSendBirthdays = async () => {
    if (!window.confirm('¿Enviar felicitaciones a los cumpleañeros de hoy?')) return;
    setIsBirthdaySending(true);
    try {
      const res = await dataService.sendBirthdayEmails(
        settings.birthday_discount, settings.birthday_flyer_url
      );
      alert(`Proceso completado. Se enviaron ${res.sent} felicitaciones.`);
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      setIsBirthdaySending(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px', gap: '1rem' }}>
        <RefreshCw size={24} style={{ animation: 'spin 1s linear infinite' }} />
        <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Cargando módulo de marketing...</span>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>

      {/* Page Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Laboratorio de Marketing</h2>
          <p className="page-subtitle">Automatice el crecimiento y la lealtad de sus clientes</p>
        </div>
        <div style={{ padding: '0.75rem', background: 'var(--bg-canvas)', borderRadius: '16px', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>
          <Award size={24} />
        </div>
      </div>

      <div className="grid-layout-3">

        {/* ── LEFT COLUMN ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Birthday Automation Card */}
          <div className="surface-card" style={{ position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ position: 'absolute', top: 0, right: 0, padding: '1.5rem', opacity: 0.04, pointerEvents: 'none' }}>
              <Cake size={100} />
            </div>

            <h3 style={{ fontSize: '1.0rem', fontWeight: 800, fontFamily: "'Plus Jakarta Sans', sans-serif", display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Cake size={18} color="var(--text-primary)" />
              Automatización de Cumpleaños
            </h3>

            {/* Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', background: 'var(--bg-canvas)', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
              <div>
                <p style={{ fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.2rem' }}>Envío Automático Diario</p>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Mandar saludos a cumpleañeros de forma autónoma</p>
              </div>
              <Toggle
                checked={!!settings.birthday_automation_enabled}
                onChange={(val) => setSettings(prev => ({ ...prev, birthday_automation_enabled: val ? 1 : 0 }))}
              />
            </div>

            {/* Status banner */}
            {settings.birthday_automation_enabled ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 0.875rem', background: '#ecfdf5', borderRadius: '10px', border: '1px solid #a7f3d0' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />
                <span style={{ fontSize: '0.8rem', color: '#059669', fontWeight: 700 }}>Automatización Activa (Saludos diarios a las 8:00 AM)</span>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 0.875rem', background: '#fef2f2', borderRadius: '10px', border: '1px solid #fecaca' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
                <span style={{ fontSize: '0.8rem', color: '#dc2626', fontWeight: 700 }}>Automatización Pausada</span>
              </div>
            )}

            {/* Discount */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-secondary)' }}>Descuento por Cumpleaños (%)</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="number"
                  className="input-field"
                  value={settings.birthday_discount}
                  onChange={(e) => setSettings({ ...settings, birthday_discount: e.target.value })}
                />
                <div style={{ background: '#09090b', padding: '0 1.25rem', borderRadius: '12px', display: 'flex', alignItems: 'center', fontWeight: 800, color: 'white', fontSize: '0.9rem' }}>%</div>
              </div>
            </div>

            {/* Birthday Flyer */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-secondary)' }}>Flyer de Cumpleaños (Opcional)</label>
              {settings.birthday_flyer_url ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.875rem', background: 'var(--bg-canvas)', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
                  <img src={settings.birthday_flyer_url} alt="Flyer Cumpleaños" style={{ width: '32px', height: '32px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }} />
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Flyer Cumpleaños</span>
                  <button
                    onClick={() => setSettings({ ...settings, birthday_flyer_url: '' })}
                    style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: '50%', width: '22px', height: '22px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                    title="Eliminar"
                  >×</button>
                </div>
              ) : (
                <>
                  <input type="file" accept="image/*" onChange={handleBirthdayFlyerUpload} disabled={isFlyerUploading} style={{ display: 'none' }} id="birthday-flyer-input" />
                  <label htmlFor="birthday-flyer-input" className="btn-secondary" style={{ textAlign: 'center', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '0.8rem', borderRadius: '12px', border: '1px dashed var(--border-subtle)', fontWeight: 700, padding: '0.75rem' }}>
                    {isFlyerUploading ? 'Subiendo...' : '📂 Cargar Flyer (Imagen)'}
                  </label>
                </>
              )}
            </div>

            {/* Save & Launch */}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={handleSaveSettings}
                disabled={isSaving}
                className="btn-secondary"
                style={{ flex: 1, padding: '0.875rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontWeight: 800 }}
              >
                {saveSuccess ? <><CheckCircle size={15} color="#10b981" /> Guardado</> : (isSaving ? 'Guardando...' : 'Guardar')}
              </button>
              <button
                onClick={handleSendBirthdays}
                disabled={isBirthdaySending}
                className="btn-primary"
                style={{ flex: 2, padding: '0.875rem', background: '#d946ef', borderColor: '#d946ef', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontWeight: 800 }}
              >
                <Cake size={15} />
                {isBirthdaySending ? 'Enviando...' : 'Lanzar Cumpleaños'}
              </button>
            </div>
          </div>

          {/* Canales de Envío */}
          <div className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h3 style={{ fontSize: '1.0rem', fontWeight: 800, fontFamily: "'Plus Jakarta Sans', sans-serif", display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Bell size={18} color="var(--text-primary)" />
              Canales de Envío
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.875rem', background: 'var(--bg-canvas)', borderRadius: '12px', border: '1px solid var(--border-subtle)', alignItems: 'center' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Emails enviados este mes</span>
                <span style={{ fontWeight: 800, fontSize: '1rem' }}>{stats?.totalSent ?? '—'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.875rem', background: 'var(--bg-canvas)', borderRadius: '12px', border: '1px solid var(--border-subtle)', alignItems: 'center' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Tasa de apertura</span>
                <span style={{ fontWeight: 800, fontSize: '1rem', color: (stats?.openRate ?? 0) >= 20 ? '#10b981' : 'var(--text-primary)' }}>
                  {stats ? `${stats.openRate}%` : '—'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN (span 2) ── */}
        <div style={{ gridColumn: 'span 2' }}>
          <div className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', marginBottom: '2rem' }}>
              {[
                { key: 'campaign', label: 'Campaña Masiva' },
                { key: 'birthday', label: 'Plantilla de Cumpleaños' },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    padding: '0.875rem 1.5rem',
                    background: 'none',
                    border: 'none',
                    borderBottom: activeTab === tab.key ? '2px solid var(--text-primary)' : '2px solid transparent',
                    fontWeight: activeTab === tab.key ? 800 : 600,
                    fontSize: '0.9rem',
                    color: activeTab === tab.key ? 'var(--text-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    marginBottom: '-1px',
                    transition: 'all 0.15s',
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ── TAB: Campaña Masiva ── */}
            {activeTab === 'campaign' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ fontSize: '1.5rem', fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, marginBottom: '0.25rem' }}>Campaña Masiva de Email</h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Configure envíos masivos por texto o subiendo una pieza de diseño</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', background: '#ecfdf5', color: '#059669', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', border: '1px solid #a7f3d0', whiteSpace: 'nowrap' }}>
                    <Users size={14} /> {clientCount ?? '...'} Destinatarios
                  </div>
                </div>

                {/* Campaign Type Toggle */}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => setCampaignType('text')}
                    style={{
                      flex: 1, padding: '0.75rem 1rem',
                      borderRadius: '12px', border: '1px solid var(--border-subtle)',
                      cursor: 'pointer', fontWeight: 700, fontSize: '0.875rem',
                      background: campaignType === 'text' ? 'white' : 'transparent',
                      color: campaignType === 'text' ? '#09090b' : 'var(--text-secondary)',
                      boxShadow: campaignType === 'text' ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                      transition: 'all 0.15s'
                    }}
                  >
                    🍕 Solo Texto
                  </button>
                  <button
                    onClick={() => setCampaignType('image')}
                    style={{
                      flex: 1, padding: '0.75rem 1rem',
                      borderRadius: '12px', border: 'none',
                      cursor: 'pointer', fontWeight: 700, fontSize: '0.875rem',
                      background: campaignType === 'image' ? '#09090b' : 'transparent',
                      color: campaignType === 'image' ? 'white' : 'var(--text-secondary)',
                      border: campaignType === 'image' ? 'none' : '1px solid var(--border-subtle)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                      transition: 'all 0.15s'
                    }}
                  >
                    🎨 Diseño / Arte (Imagen)
                  </button>
                </div>

                {/* Audience Segmentation Selector */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-secondary)' }}>
                      Segmento de Destinatarios
                    </label>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#2563eb' }}>
                      {clientCount !== null ? `${clientCount} clientes calificados` : 'Calculando...'}
                    </span>
                  </div>
                  <select
                    className="input-field"
                    value={audienceFilter}
                    onChange={(e) => setAudienceFilter(e.target.value)}
                    style={{ fontWeight: 600, fontSize: '0.875rem' }}
                  >
                    <option value="all">👥 Todos los Clientes</option>
                    <option value="no_plan">✂️ Clientes sin Planes (Genéricos / Servicios Sueltos)</option>
                    <option value="active_plan">✨ Clientes con Plan de Membresía Activo</option>
                    <option value="pending_payment">⚠️ Clientes con Pago Pendiente / En Mora</option>
                    <option value="tenure_3m">⏳ Clientes Activos con 3 Meses de Antigüedad</option>
                    <option value="tenure_6m">⏳ Clientes Activos con 6 Meses de Antigüedad</option>
                    <option value="tenure_9m">⏳ Clientes Activos con 9 Meses de Antigüedad</option>
                    <option value="tenure_12m">🏆 Clientes Activos con 1 Año de Antigüedad (12 meses)</option>
                    <option value="tenure_18m">💎 Clientes Activos con 18 Meses o Más de Antigüedad</option>
                  </select>
                </div>

                {/* Subject */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <label style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-secondary)' }}>Asunto del Correo</label>
                  <input
                    className="input-field"
                    placeholder="Ej. ¡Nueva promoción de temporada exclusiva!"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </div>

                {/* Text body OR image upload */}
                {campaignType === 'text' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-secondary)' }}>
                      <span>Cuerpo del Mensaje</span>
                      <span style={{ textTransform: 'none', fontWeight: 600 }}>Use {'{{nombre}}'} para personalizar</span>
                    </label>
                    <textarea
                      rows="5"
                      className="input-field"
                      value={settings.mass_email_template}
                      onChange={(e) => setSettings({ ...settings, mass_email_template: e.target.value })}
                      style={{ fontFamily: 'monospace', fontSize: '0.875rem', lineHeight: 1.6, padding: '1.25rem', resize: 'none' }}
                    />
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <label style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-secondary)' }}>Cargar Arte de Campaña (Imagen)</label>
                    {campaignFlyerUrl ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.875rem', background: 'var(--bg-canvas)', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
                        <img src={campaignFlyerUrl} alt="Arte Campaña" style={{ width: '32px', height: '32px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }} />
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Arte Campaña</span>
                        <button
                          onClick={() => setCampaignFlyerUrl('')}
                          style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: '50%', width: '22px', height: '22px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                          title="Eliminar"
                        >×</button>
                      </div>
                    ) : (
                      <>
                        <input type="file" accept="image/*" onChange={handleCampaignFlyerUpload} disabled={isCampaignFlyerUploading} style={{ display: 'none' }} id="campaign-flyer-input" />
                        <label htmlFor="campaign-flyer-input" className="btn-secondary" style={{ textAlign: 'center', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '0.8rem', borderRadius: '12px', border: '1px dashed var(--border-subtle)', fontWeight: 700, padding: '0.875rem' }}>
                          {isCampaignFlyerUploading ? 'Subiendo...' : '📂 Cargar Arte de Campaña'}
                        </label>
                      </>
                    )}
                  </div>
                )}

                {/* Email Preview */}
                <div style={{ padding: '1.5rem', background: '#f8fafc', borderRadius: '16px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {/* From/To row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.875rem' }}>
                    <div style={{ width: '40px', height: '40px', background: '#0f172a', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: '1rem', flexShrink: 0 }}>S</div>
                    <div>
                      <p style={{ fontWeight: 800, color: '#0f172a', marginBottom: '0.15rem', fontSize: '0.9rem' }}>
                        PLAN BEAUTY <span style={{ color: '#64748b', fontWeight: 500, fontSize: '0.85rem' }}>{'<promo@planbeauty.do>'}</span>
                      </p>
                      <p style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Para: Maria Garcia</p>
                    </div>
                  </div>

                  {/* Preview content */}
                  <div style={{ color: '#334155' }}>
                    {campaignType === 'image' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <p style={{ fontWeight: 800, fontSize: '1.1rem', color: '#0f172a' }}>¡Hola Maria!</p>
                        {campaignFlyerUrl ? (
                          <img src={campaignFlyerUrl} alt="Preview Arte" style={{ width: '100%', borderRadius: '8px', objectFit: 'cover', maxHeight: '200px' }} />
                        ) : (
                          <div style={{ width: '100%', height: '80px', background: '#e2e8f0', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontStyle: 'italic' }}>Preview Arte</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p style={{ whiteSpace: 'pre-line', fontSize: '0.9rem', lineHeight: 1.7 }}>
                        {(settings.mass_email_template || '').replace('{{nombre}}', 'Maria')}
                      </p>
                    )}
                  </div>

                  {/* Footer */}
                  <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '0.875rem', fontSize: '0.65rem', color: '#94a3b8', textAlign: 'center', lineHeight: 1.5 }}>
                    © 2026 PLAN BEAUTY. Av. San Vicente de Paúl, Santo Domingo Este.<br />
                    Si no desea recibir estos correos, <span style={{ textDecoration: 'underline', cursor: 'pointer', color: '#64748b' }}>cancele su suscripción aquí</span>.
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button
                    onClick={handleSendMassive}
                    disabled={isSending}
                    className="btn-primary"
                    style={{ flex: 1, padding: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '1rem', fontWeight: 800, opacity: isSending ? 0.7 : 1 }}
                  >
                    {isSending
                      ? <><RefreshCw size={18} style={{ animation: 'spin 1s linear infinite' }} /> Enviando...</>
                      : <><Send size={18} /> Lanzar Campaña Masiva</>
                    }
                  </button>
                  <button
                    className="btn-secondary"
                    style={{ padding: '0 2rem', fontWeight: 800 }}
                    onClick={() => alert('Borrador guardado (próximamente).')}
                  >
                    Guardar Borrador
                  </button>
                </div>
              </div>
            )}

            {/* ── TAB: Plantilla de Cumpleaños ── */}
            {activeTab === 'birthday' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div>
                  <h3 style={{ fontSize: '1.5rem', fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, marginBottom: '0.25rem' }}>Plantilla de Email de Cumpleaños</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Este correo se envía automáticamente a los clientes que cumplen años hoy</p>
                </div>

                {/* Subject */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <label style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-secondary)' }}>Asunto</label>
                  <input
                    className="input-field"
                    value={settings.birthday_email_subject}
                    onChange={(e) => setSettings({ ...settings, birthday_email_subject: e.target.value })}
                    placeholder="¡Feliz Cumpleaños! 🎉"
                  />
                </div>

                {/* Body */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-secondary)' }}>
                    <span>Mensaje</span>
                    <span style={{ textTransform: 'none', fontWeight: 600 }}>Use {'{{nombre}}'} y {'{{descuento}}'} para personalizar</span>
                  </label>
                  <textarea
                    rows="5"
                    className="input-field"
                    value={settings.birthday_email_template}
                    onChange={(e) => setSettings({ ...settings, birthday_email_template: e.target.value })}
                    style={{ fontFamily: 'monospace', fontSize: '0.875rem', lineHeight: 1.6, padding: '1.25rem', resize: 'none' }}
                  />
                </div>

                {/* Preview */}
                <div style={{ padding: '1.5rem', background: '#f8fafc', borderRadius: '16px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.875rem' }}>
                    <div style={{ width: '40px', height: '40px', background: '#d946ef', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: '1rem', flexShrink: 0 }}>🎂</div>
                    <div>
                      <p style={{ fontWeight: 800, color: '#0f172a', marginBottom: '0.15rem', fontSize: '0.9rem' }}>
                        PLAN BEAUTY <span style={{ color: '#64748b', fontWeight: 500, fontSize: '0.85rem' }}>{'<cumpleanos@planbeauty.do>'}</span>
                      </p>
                      <p style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Para: Maria Garcia</p>
                    </div>
                  </div>
                  <p style={{ whiteSpace: 'pre-line', fontSize: '0.9rem', lineHeight: 1.7, color: '#334155' }}>
                    {(settings.birthday_email_template || '')
                      .replace(/\{\{nombre\}\}/g, 'Maria')
                      .replace(/\{\{descuento\}\}/g, settings.birthday_discount || '15')}
                  </p>
                  <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '0.875rem', fontSize: '0.65rem', color: '#94a3b8', textAlign: 'center', lineHeight: 1.5 }}>
                    © 2026 PLAN BEAUTY. Av. San Vicente de Paúl, Santo Domingo Este.
                  </div>
                </div>

                {/* Save */}
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button
                    onClick={handleSaveSettings}
                    disabled={isSaving}
                    className="btn-primary"
                    style={{ flex: 1, padding: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '1rem', fontWeight: 800 }}
                  >
                    {saveSuccess
                      ? <><CheckCircle size={18} /> Guardado con éxito</>
                      : (isSaving ? 'Guardando...' : 'Guardar Plantilla')}
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
};

export default MarketingModule;
