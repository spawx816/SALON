import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Building2, Upload, Trash2, Save, Sparkles, CheckCircle2, 
  Store, MapPin, Phone, Mail, Globe, Receipt, Palette, FileText,
  AlertCircle, Eye, Printer, ShieldCheck, RefreshCw, RotateCcw
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useNotification } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';
import { useTenantBranding } from '../../context/TenantBrandingContext';

function parseHex(hex) {
  let cleaned = (hex || '').replace('#', '').trim();
  if (cleaned.length === 3) {
    cleaned = cleaned.split('').map(c => c + c).join('');
  }
  if (cleaned.length !== 6) return { r: 15, g: 23, b: 42 };
  const num = parseInt(cleaned, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

function getLuminance({ r, g, b }) {
  const a = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

function calculateContrast(hex1, hex2) {
  try {
    const lum1 = getLuminance(parseHex(hex1));
    const lum2 = getLuminance(parseHex(hex2));
    const brightest = Math.max(lum1, lum2);
    const darkest = Math.min(lum1, lum2);
    return ((brightest + 0.05) / (darkest + 0.05));
  } catch (_) {
    return 1;
  }
}

export default function TenantCustomizationModule() {
  const { showNotification } = useNotification();
  const { user } = useAuth();
  const { branding, updateBranding, resetBranding } = useTenantBranding();
  const fileInputRef = useRef(null);

  const isSuperAdmin = user?.role?.toLowerCase() === 'superadmin' || user?.role_name?.toLowerCase()?.includes('superadmin');
  const [tenants, setTenants] = useState([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [formData, setFormData] = useState({
    business_name: branding?.business_name || '',
    legal_name: '',
    rnc: '',
    slug: '',
    email: '',
    phone: '',
    address: '',
    website: '',
    logo_url: branding?.logo_url || '',
    logo_dark_url: branding?.logo_dark_url || '',
    favicon_url: branding?.favicon_url || '',
    primary_color: branding?.primary_color || '#0f172a',
    secondary_color: branding?.secondary_color || '#d4af37',
    accent_color: branding?.accent_color || '#3b82f6',
    background_color: branding?.background_color || '#f8fafc',
    surface_color: branding?.surface_color || '#ffffff',
    text_color: branding?.text_color || '#0f172a',
    receipt_header: branding?.receipt_header || 'SalonPro - Sistema de Gestión',
    receipt_footer: branding?.receipt_footer || '¡Gracias por preferirnos! ♡',
    currency: 'DOP'
  });

  const [previewTab, setPreviewTab] = useState('ticket'); // 'ticket' | 'sidebar'
  const [profileData, setProfileData] = useState(null);

  // Sincronizar con el branding canónico cuando esté disponible
  useEffect(() => {
    if (branding) {
      setFormData(prev => ({
        ...prev,
        business_name: branding.business_name || prev.business_name,
        logo_url: branding.logo_url || prev.logo_url,
        logo_dark_url: branding.logo_dark_url || prev.logo_dark_url,
        favicon_url: branding.favicon_url || prev.favicon_url,
        primary_color: branding.primary_color || prev.primary_color,
        secondary_color: branding.secondary_color || prev.secondary_color,
        accent_color: branding.accent_color || prev.accent_color,
        background_color: branding.background_color || prev.background_color,
        surface_color: branding.surface_color || prev.surface_color,
        text_color: branding.text_color || prev.text_color,
        receipt_header: branding.receipt_header || prev.receipt_header,
        receipt_footer: branding.receipt_footer || prev.receipt_footer
      }));
    }
  }, [branding]);

  // Métricas de accesibilidad WCAG en tiempo real
  const contrastBg = useMemo(() => calculateContrast(formData.text_color, formData.background_color), [formData.text_color, formData.background_color]);
  const contrastSurface = useMemo(() => calculateContrast(formData.text_color, formData.surface_color), [formData.text_color, formData.surface_color]);
  const minContrast = Math.min(contrastBg, contrastSurface);

  // Cargar lista de salones si es SuperAdmin
  useEffect(() => {
    if (isSuperAdmin) {
      fetch('/api/saas/tenants')
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data) && data.length > 0) {
            setTenants(data);
            setSelectedTenantId(data[0].id);
          }
        })
        .catch(err => console.warn('Error fetching tenants list:', err));
    }
  }, [isSuperAdmin]);

  // Cargar datos actuales del tenant
  const loadProfile = async (targetId = selectedTenantId) => {
    setLoading(true);
    try {
      const data = await dataService.getTenantProfile(targetId || null);
      if (data) {
        setProfileData(data);
        setFormData(prev => ({
          ...prev,
          business_name: data.business_name || prev.business_name || '',
          legal_name: data.legal_name || '',
          rnc: data.rnc || '',
          slug: data.slug || '',
          email: data.email || '',
          phone: data.phone || '',
          address: data.address || '',
          website: data.website || '',
          logo_url: data.logo_url || prev.logo_url || '',
          primary_color: data.primary_color || data.brand_color || prev.primary_color || '#0f172a',
          secondary_color: data.secondary_color || prev.secondary_color || '#d4af37',
          receipt_footer: data.receipt_footer || prev.receipt_footer || '¡Gracias por preferirnos! ♡',
          currency: data.currency || 'DOP'
        }));
        if (data.id && !selectedTenantId) {
          setSelectedTenantId(data.id);
        }
      }
    } catch (err) {
      console.warn('Información adicional de perfil no disponible localmente:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile(selectedTenantId);
  }, [selectedTenantId]);

  const handleTenantChange = (newId) => {
    setSelectedTenantId(newId);
    loadProfile(newId);
  };

  // Manejar subida de archivo de logo
  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showNotification('Por favor seleccione un archivo de imagen válido (PNG, JPG, SVG, WebP).', 'error');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showNotification('La imagen es demasiado pesada. El tamaño máximo permitido es 5 MB.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Image = event.target?.result;
      if (base64Image) {
        setFormData(prev => ({ ...prev, logo_url: base64Image }));
        showNotification('Logotipo cargado en vista previa. Presiona "Guardar Cambios" para aplicar.', 'info');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setFormData(prev => ({ ...prev, logo_url: '' }));
    if (fileInputRef.current) fileInputRef.current.value = '';
    showNotification('Logotipo eliminado de la vista previa.', 'info');
  };

  const handleResetDefaults = async () => {
    if (!window.confirm('¿Deseas restaurar la paleta de colores y textos a los valores predeterminados de SalonPro?')) {
      return;
    }
    setSaving(true);
    try {
      const reset = await resetBranding();
      if (reset) {
        setFormData(prev => ({
          ...prev,
          primary_color: reset.primary_color,
          secondary_color: reset.secondary_color,
          accent_color: reset.accent_color,
          background_color: reset.background_color,
          surface_color: reset.surface_color,
          text_color: reset.text_color,
          receipt_header: reset.receipt_header,
          receipt_footer: reset.receipt_footer
        }));
      }
      showNotification('Identidad visual restablecida a SalonPro neutral', 'info');
    } catch (err) {
      showNotification(err.message || 'Error restableciendo valores', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.business_name.trim()) {
      showNotification('El nombre comercial del salón es obligatorio.', 'error');
      return;
    }

    if (minContrast < 3.0) {
      showNotification(`Contraste de texto crítico (${minContrast.toFixed(1)}:1 < 3.0:1). Selecciona un color de texto más oscuro o fondo más claro.`, 'error');
      return;
    }

    setSaving(true);
    setSaveSuccess(false);

    try {
      // 1. Si el logo es un data:image base64 nuevo, subirlo
      let finalLogoUrl = formData.logo_url;
      if (formData.logo_url && formData.logo_url.startsWith('data:image/')) {
        try {
          const uploadRes = await dataService.uploadTenantLogo(formData.logo_url, selectedTenantId);
          if (uploadRes && uploadRes.logo_url) {
            finalLogoUrl = uploadRes.logo_url;
          }
        } catch (uploadErr) {
          console.warn('Error subiendo logo a servidor, se usará base64:', uploadErr);
        }
      }

      // 2. Guardar branding canónico en /api/tenant/branding
      if (!isSuperAdmin) {
        await updateBranding({
          business_name: formData.business_name,
          logo_url: finalLogoUrl,
          logo_dark_url: formData.logo_dark_url || null,
          favicon_url: formData.favicon_url || null,
          primary_color: formData.primary_color,
          secondary_color: formData.secondary_color,
          accent_color: formData.accent_color,
          background_color: formData.background_color,
          surface_color: formData.surface_color,
          text_color: formData.text_color,
          receipt_header: formData.receipt_header,
          receipt_footer: formData.receipt_footer
        });
      }

      // 3. Guardar perfil completo en backend
      const payload = {
        ...formData,
        logo_url: finalLogoUrl
      };

      try {
        await dataService.updateTenantProfile(payload, selectedTenantId);
      } catch (profErr) {
        console.warn('Perfil adicional no persistido:', profErr.message);
      }
      
      // 4. Actualizar almacenamiento local para sincronizar el sidebar inmediatamente
      try {
        const storedUser = JSON.parse(localStorage.getItem('salon_pro_user') || '{}');
        if (storedUser && storedUser.tenant) {
          storedUser.tenant.business_name = formData.business_name;
          storedUser.tenant.logo_url = finalLogoUrl;
          storedUser.salon_name = formData.business_name;
          localStorage.setItem('salon_pro_user', JSON.stringify(storedUser));
        }
      } catch (storageErr) {
        console.warn('Notice updating localStorage:', storageErr);
      }

      setFormData(prev => ({ ...prev, logo_url: finalLogoUrl }));
      setSaveSuccess(true);
      showNotification('¡Personalización y colores del salón actualizados exitosamente!', 'success');
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err) {
      console.error('Error al guardar personalización:', err);
      showNotification(`Error: ${err.message || 'No se pudo guardar la personalización'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', color: '#1e293b' }}>
      
      {/* Header Banner */}
      <div style={{ 
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', 
        borderRadius: '16px', 
        padding: '2rem', 
        color: '#ffffff', 
        marginBottom: '2rem',
        boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.2)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1.5rem'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
            <span style={{ 
              background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', 
              color: '#fff', 
              padding: '0.2rem 0.6rem', 
              borderRadius: '6px', 
              fontSize: '0.7rem', 
              fontWeight: '800',
              letterSpacing: '0.05em' 
            }}>
              MARCA & BRANDING
            </span>
            <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
              Identidad visual en tickets, facturas y sistema
            </span>
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '800', margin: 0, color: '#ffffff' }}>
            Personalización de tu Salón
          </h1>
          <p style={{ margin: '0.4rem 0 0', color: '#cbd5e1', fontSize: '0.9rem', maxWidth: '650px', lineHeight: '1.5' }}>
            Define el logotipo oficial, información fiscal (RNC), teléfono, dirección física y pie de página de impresión que verán tus clientes.
          </p>
        </div>

        <button
          onClick={loadProfile}
          disabled={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.2)',
            color: '#ffffff',
            padding: '0.6rem 1rem',
            borderRadius: '10px',
            fontSize: '0.85rem',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'background 0.2s'
          }}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Recargar Datos
        </button>
      </div>

      {/* Selector de Salón para SuperAdmin */}
      {isSuperAdmin && (
        <div style={{
          background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
          border: '1.5px solid #cbd5e1',
          borderRadius: '14px',
          padding: '1.25rem 1.5rem',
          marginBottom: '2rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div style={{
              width: '42px',
              height: '42px',
              borderRadius: '10px',
              background: '#0f172a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#38bdf8'
            }}>
              <Building2 size={22} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.92rem', fontWeight: '800', color: '#0f172a' }}>
                  Salón / Cliente SaaS Seleccionado
                </span>
                <span style={{
                  fontSize: '0.7rem',
                  fontWeight: '700',
                  background: '#e0f2fe',
                  color: '#0369a1',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '6px'
                }}>
                  Vista SuperAdmin
                </span>
              </div>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                Como Super Administrador puedes gestionar la identidad y tickets de cualquier salón registrado.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <select
              value={selectedTenantId || ''}
              onChange={(e) => handleTenantChange(e.target.value)}
              style={{
                padding: '0.65rem 1.25rem',
                borderRadius: '10px',
                border: '1.5px solid #94a3b8',
                background: '#ffffff',
                color: '#0f172a',
                fontSize: '0.9rem',
                fontWeight: '700',
                cursor: 'pointer',
                outline: 'none',
                minWidth: '260px'
              }}
            >
              {tenants.map(t => (
                <option key={t.id} value={t.id}>
                  {t.business_name} {t.slug ? `(@${t.slug})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Plan Activo & Capacidad de Licencias */}
      {profileData && (
        <div style={{
          background: '#ffffff',
          border: '1.5px solid #e2e8f0',
          borderRadius: '16px',
          padding: '1.25rem 1.75rem',
          marginBottom: '2rem',
          boxShadow: '0 4px 16px rgba(0,0,0,0.03)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1.25rem'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
              <span style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '800' }}>
                PLAN: {profileData.plan_name || 'Plan Principal'}
              </span>
              {profileData.has_memberships && (
                <span style={{ background: '#fdf2f8', color: '#db2777', border: '1px solid #fbcfe8', padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '800' }}>
                  💎 Clientes & Suscripciones Activos
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#475569', fontWeight: '600' }}>
              Licencias de Sucursal: <strong>{profileData.current_branches || 1} de {profileData.licensed_branches || 1} sedes utilizadas</strong>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: '700', textTransform: 'uppercase' }}>
                Asientos de Usuarios
              </div>
              <div style={{ fontSize: '1.2rem', fontWeight: '900', color: (parseInt(profileData.current_users || 1) >= parseInt(profileData.max_allowed_users || 3)) ? '#b91c1c' : '#059669' }}>
                {profileData.current_users || 1} / {profileData.max_allowed_users || 3}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                ({profileData.licensed_branches || 1} sedes × 3 + {profileData.extra_user_seats || 0} extra)
              </div>
            </div>
          </div>
        </div>
      )}

      {saveSuccess && (
        <div style={{ 
          background: '#ecfdf5', 
          border: '1px solid #10b981', 
          color: '#065f46', 
          padding: '1rem 1.25rem', 
          borderRadius: '12px', 
          marginBottom: '2rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          boxShadow: '0 4px 12px rgba(16,185,129,0.15)'
        }}>
          <CheckCircle2 size={22} color="#10b981" />
          <div>
            <div style={{ fontWeight: '700', fontSize: '0.95rem' }}>¡Personalización guardada con éxito!</div>
            <div style={{ fontSize: '0.825rem', color: '#047857' }}>El logo, nombre y datos fiscales se han sincronizado en los tickets térmicos y la interfaz.</div>
          </div>
        </div>
      )}

      {/* Main Grid: Form on Left, Live Preview on Right */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(340px, 1fr)', gap: '2rem', alignItems: 'start' }}>
        
        {/* Form Container */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
          
          {/* Card 1: Logotipo Oficial */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.75rem', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
              <div style={{ background: '#f8fafc', padding: '0.5rem', borderRadius: '10px', color: '#0f172a' }}>
                <Store size={20} />
              </div>
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: '800', margin: 0, color: '#0f172a' }}>Logotipo de tu Negocio</h3>
                <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>Aparecerá en el encabezado de los tickets térmicos de pre-cuenta y en el sistema.</p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
              {/* Logo Preview Avatar */}
              <div style={{ 
                width: '120px', 
                height: '120px', 
                borderRadius: '16px', 
                border: '2px dashed #cbd5e1', 
                background: '#f8fafc',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                position: 'relative',
                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.04)'
              }}>
                {formData.logo_url ? (
                  <img 
                    src={formData.logo_url} 
                    alt="Logo Salón" 
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '6px' }} 
                  />
                ) : (
                  <div style={{ textAlign: 'center', color: '#94a3b8', padding: '0.5rem' }}>
                    <Upload size={28} style={{ margin: '0 auto 0.25rem' }} />
                    <span style={{ fontSize: '0.7rem', display: 'block', fontWeight: '600' }}>Sin Logo</span>
                  </div>
                )}
              </div>

              {/* Upload Controls */}
              <div style={{ flex: 1, minWidth: '220px' }}>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  accept="image/png, image/jpeg, image/webp, image/svg+xml" 
                  onChange={handleLogoUpload} 
                  style={{ display: 'none' }} 
                />

                <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      background: '#0f172a',
                      color: '#ffffff',
                      border: 'none',
                      padding: '0.6rem 1.15rem',
                      borderRadius: '10px',
                      fontSize: '0.85rem',
                      fontWeight: '700',
                      cursor: 'pointer'
                    }}
                  >
                    <Upload size={16} />
                    {formData.logo_url ? 'Cambiar Logotipo' : 'Subir Logotipo'}
                  </button>

                  {formData.logo_url && (
                    <button
                      type="button"
                      onClick={handleRemoveLogo}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        background: '#fef2f2',
                        color: '#ef4444',
                        border: '1px solid #fecaca',
                        padding: '0.6rem 0.9rem',
                        borderRadius: '10px',
                        fontSize: '0.85rem',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      <Trash2 size={16} />
                      Quitar
                    </button>
                  )}
                </div>

                <div style={{ fontSize: '0.75rem', color: '#64748b', lineHeight: '1.5' }}>
                  Recomendado: Imagen en formato <strong>PNG transparente o SVG</strong>. Tamaño sugerido de 400x400 px o proporción horizontal limpia.
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Identidad Comercial y Fiscal */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.75rem', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
              <div style={{ background: '#f8fafc', padding: '0.5rem', borderRadius: '10px', color: '#0f172a' }}>
                <Building2 size={20} />
              </div>
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: '800', margin: 0, color: '#0f172a' }}>Identidad Comercial & Fiscal</h3>
                <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>Datos legales para identificación y comprobantes fiscales.</p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.15rem' }}>
              
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                  Nombre Comercial del Salón *
                </label>
                <input 
                  type="text" 
                  required
                  placeholder="Ej. Glamour Beauty Studio"
                  value={formData.business_name}
                  onChange={e => setFormData({ ...formData, business_name: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.9rem',
                    border: '1px solid #cbd5e1',
                    borderRadius: '10px',
                    fontSize: '0.9rem',
                    color: '#0f172a',
                    fontWeight: '600'
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                    Razón Social / Nombre Legal
                  </label>
                  <input 
                    type="text" 
                    placeholder="Ej. Glamour Studio SRL"
                    value={formData.legal_name}
                    onChange={e => setFormData({ ...formData, legal_name: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.9rem',
                      border: '1px solid #cbd5e1',
                      borderRadius: '10px',
                      fontSize: '0.875rem'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                    RNC / Cédula Fiscal
                  </label>
                  <input 
                    type="text" 
                    placeholder="Ej. 1-31-12345-6"
                    value={formData.rnc}
                    onChange={e => setFormData({ ...formData, rnc: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.9rem',
                      border: '1px solid #cbd5e1',
                      borderRadius: '10px',
                      fontSize: '0.875rem',
                      fontFamily: 'monospace'
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                  Identificador de Nube (Slug)
                </label>
                <input 
                  type="text" 
                  disabled
                  value={formData.slug ? `@${formData.slug}` : '@salondemo'}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.9rem',
                    border: '1px solid #e2e8f0',
                    background: '#f8fafc',
                    color: '#64748b',
                    borderRadius: '10px',
                    fontSize: '0.85rem'
                  }}
                />
                <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', marginTop: '0.25rem' }}>
                  Este identificador único fue asignado al crear el salón y asegura el aislamiento de tus datos en la base de datos SaaS.
                </span>
              </div>

            </div>
          </div>

          {/* Card 3: Contacto & Ubicación */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.75rem', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
              <div style={{ background: '#f8fafc', padding: '0.5rem', borderRadius: '10px', color: '#0f172a' }}>
                <MapPin size={20} />
              </div>
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: '800', margin: 0, color: '#0f172a' }}>Ubicación & Contacto</h3>
                <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>Aparecerán impresos en el encabezado del ticket para tus clientes.</p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.15rem' }}>
              
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                  Dirección Física del Local
                </label>
                <input 
                  type="text" 
                  placeholder="Ej. Av. Winston Churchill #109, Santo Domingo"
                  value={formData.address}
                  onChange={e => setFormData({ ...formData, address: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.9rem',
                    border: '1px solid #cbd5e1',
                    borderRadius: '10px',
                    fontSize: '0.875rem'
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                    Teléfono / WhatsApp de Recepción
                  </label>
                  <input 
                    type="text" 
                    placeholder="Ej. (809) 555-0199"
                    value={formData.phone}
                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.9rem',
                      border: '1px solid #cbd5e1',
                      borderRadius: '10px',
                      fontSize: '0.875rem'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                    Correo Electrónico Oficial
                  </label>
                  <input 
                    type="email" 
                    placeholder="contacto@glamourstudio.com"
                    value={formData.email}
                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.9rem',
                      border: '1px solid #cbd5e1',
                      borderRadius: '10px',
                      fontSize: '0.875rem'
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                  Sitio Web o Instagram
                </label>
                <input 
                  type="text" 
                  placeholder="Ej. @glamour_rd o www.glamourstudio.com"
                  value={formData.website}
                  onChange={e => setFormData({ ...formData, website: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.9rem',
                    border: '1px solid #cbd5e1',
                    borderRadius: '10px',
                    fontSize: '0.875rem'
                  }}
                />
              </div>

            </div>
          </div>

          {/* Card: Paleta de Colores & Identidad Visual (Tokens CSS) */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.75rem', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ background: '#f8fafc', padding: '0.5rem', borderRadius: '10px', color: '#0f172a' }}>
                  <Palette size={20} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.05rem', fontWeight: '800', margin: 0, color: '#0f172a' }}>Paleta de Colores & Diseño</h3>
                  <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>Design tokens personalizados para la barra de navegación, botones y tarjetas.</p>
                </div>
              </div>

              {/* WCAG Accessibility Badge */}
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.35rem 0.75rem',
                borderRadius: '8px',
                fontSize: '0.75rem',
                fontWeight: '700',
                background: minContrast >= 4.5 ? '#ecfdf5' : minContrast >= 3.0 ? '#fef3c7' : '#fef2f2',
                color: minContrast >= 4.5 ? '#065f46' : minContrast >= 3.0 ? '#92400e' : '#991b1b',
                border: `1px solid ${minContrast >= 4.5 ? '#a7f3d0' : minContrast >= 3.0 ? '#fde68a' : '#fecaca'}`
              }}>
                {minContrast >= 4.5 ? (
                  <>
                    <ShieldCheck size={14} color="#059669" />
                    <span>WCAG AA Óptimo ({minContrast.toFixed(1)}:1)</span>
                  </>
                ) : minContrast >= 3.0 ? (
                  <>
                    <AlertCircle size={14} color="#d97706" />
                    <span>WCAG Aceptable ({minContrast.toFixed(1)}:1)</span>
                  </>
                ) : (
                  <>
                    <AlertCircle size={14} color="#dc2626" />
                    <span>Contraste Crítico Ilegible ({minContrast.toFixed(1)}:1)</span>
                  </>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem' }}>
              {/* Primary Color */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                  Color Primario (--tenant-primary)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="color"
                    value={formData.primary_color}
                    onChange={e => setFormData({ ...formData, primary_color: e.target.value })}
                    style={{ width: '42px', height: '42px', border: 'none', borderRadius: '8px', cursor: 'pointer', padding: 0, background: 'none' }}
                  />
                  <input
                    type="text"
                    value={formData.primary_color}
                    onChange={e => setFormData({ ...formData, primary_color: e.target.value })}
                    style={{ flex: 1, padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.85rem', fontFamily: 'monospace' }}
                  />
                </div>
              </div>

              {/* Secondary Color */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                  Color Secundario (--tenant-secondary)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="color"
                    value={formData.secondary_color}
                    onChange={e => setFormData({ ...formData, secondary_color: e.target.value })}
                    style={{ width: '42px', height: '42px', border: 'none', borderRadius: '8px', cursor: 'pointer', padding: 0, background: 'none' }}
                  />
                  <input
                    type="text"
                    value={formData.secondary_color}
                    onChange={e => setFormData({ ...formData, secondary_color: e.target.value })}
                    style={{ flex: 1, padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.85rem', fontFamily: 'monospace' }}
                  />
                </div>
              </div>

              {/* Accent Color */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                  Color de Acento (--tenant-accent)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="color"
                    value={formData.accent_color}
                    onChange={e => setFormData({ ...formData, accent_color: e.target.value })}
                    style={{ width: '42px', height: '42px', border: 'none', borderRadius: '8px', cursor: 'pointer', padding: 0, background: 'none' }}
                  />
                  <input
                    type="text"
                    value={formData.accent_color}
                    onChange={e => setFormData({ ...formData, accent_color: e.target.value })}
                    style={{ flex: 1, padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.85rem', fontFamily: 'monospace' }}
                  />
                </div>
              </div>

              {/* Background Color */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                  Fondo General (--tenant-background)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="color"
                    value={formData.background_color}
                    onChange={e => setFormData({ ...formData, background_color: e.target.value })}
                    style={{ width: '42px', height: '42px', border: 'none', borderRadius: '8px', cursor: 'pointer', padding: 0, background: 'none' }}
                  />
                  <input
                    type="text"
                    value={formData.background_color}
                    onChange={e => setFormData({ ...formData, background_color: e.target.value })}
                    style={{ flex: 1, padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.85rem', fontFamily: 'monospace' }}
                  />
                </div>
              </div>

              {/* Surface Color */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                  Superficie / Tarjetas (--tenant-surface)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="color"
                    value={formData.surface_color}
                    onChange={e => setFormData({ ...formData, surface_color: e.target.value })}
                    style={{ width: '42px', height: '42px', border: 'none', borderRadius: '8px', cursor: 'pointer', padding: 0, background: 'none' }}
                  />
                  <input
                    type="text"
                    value={formData.surface_color}
                    onChange={e => setFormData({ ...formData, surface_color: e.target.value })}
                    style={{ flex: 1, padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.85rem', fontFamily: 'monospace' }}
                  />
                </div>
              </div>

              {/* Text Color */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                  Texto Principal (--tenant-text)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="color"
                    value={formData.text_color}
                    onChange={e => setFormData({ ...formData, text_color: e.target.value })}
                    style={{ width: '42px', height: '42px', border: 'none', borderRadius: '8px', cursor: 'pointer', padding: 0, background: 'none' }}
                  />
                  <input
                    type="text"
                    value={formData.text_color}
                    onChange={e => setFormData({ ...formData, text_color: e.target.value })}
                    style={{ flex: 1, padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.85rem', fontFamily: 'monospace' }}
                  />
                </div>
              </div>
            </div>

            <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: '#f8fafc', borderRadius: '10px', fontSize: '0.75rem', color: '#64748b' }}>
              ℹ️ Los colores semánticos del sistema (errores, alertas, botones de cobro en POS) permanecen estandarizados para garantizar la usabilidad operacional.
            </div>
          </div>

          {/* Card: Ticket Térmico & Facturación */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.75rem', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
              <div style={{ background: '#f8fafc', padding: '0.5rem', borderRadius: '10px', color: '#0f172a' }}>
                <Receipt size={20} />
              </div>
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: '800', margin: 0, color: '#0f172a' }}>Textos de Tickets Térmicos (POS)</h3>
                <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>Encabezado y pie de página impresos en las pre-cuentas de 80mm.</p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                  Sub-Encabezado de Ticket (Debajo del nombre del salón)
                </label>
                <input
                  type="text"
                  placeholder="Ej. Salón de Belleza y Estética Integral"
                  value={formData.receipt_header}
                  onChange={e => setFormData({ ...formData, receipt_header: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.9rem',
                    border: '1px solid #cbd5e1',
                    borderRadius: '10px',
                    fontSize: '0.875rem'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                  Mensaje de Agradecimiento / Pie de Ticket
                </label>
                <textarea 
                  rows={3}
                  placeholder="¡Gracias por preferirnos! ♡ Sigue nuestras ofertas en Instagram."
                  value={formData.receipt_footer}
                  onChange={e => setFormData({ ...formData, receipt_footer: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.75rem 0.9rem',
                    border: '1px solid #cbd5e1',
                    borderRadius: '10px',
                    fontSize: '0.875rem',
                    lineHeight: '1.5'
                  }}
                />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleResetDefaults}
              disabled={saving}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: '#f8fafc',
                color: '#64748b',
                border: '1px solid #cbd5e1',
                padding: '0.75rem 1.25rem',
                borderRadius: '12px',
                fontSize: '0.875rem',
                fontWeight: '700',
                cursor: saving ? 'not-allowed' : 'pointer'
              }}
            >
              <RotateCcw size={16} />
              Restaurar Valores Predeterminados
            </button>

            <button
              type="submit"
              disabled={saving}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                background: 'linear-gradient(135deg, #0f172a, #1e293b)',
                color: '#ffffff',
                border: 'none',
                padding: '0.85rem 2rem',
                borderRadius: '12px',
                fontSize: '0.95rem',
                fontWeight: '800',
                cursor: saving ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 14px rgba(15,23,42,0.25)',
                transition: 'transform 0.15s'
              }}
            >
              <Save size={18} />
              {saving ? 'Guardando Personalización...' : 'Guardar Personalización'}
            </button>
          </div>

        </form>

        {/* Live Preview Panel (Sticky) */}
        <div style={{ position: 'sticky', top: '1.5rem' }}>
          
          <div style={{ 
            background: '#ffffff', 
            border: '1px solid #e2e8f0', 
            borderRadius: '16px', 
            overflow: 'hidden', 
            boxShadow: '0 8px 24px -4px rgba(0,0,0,0.08)' 
          }}>
            
            {/* Preview Tabs */}
            <div style={{ 
              display: 'flex', 
              background: '#f8fafc', 
              borderBottom: '1px solid #e2e8f0',
              padding: '0.5rem'
            }}>
              <button
                type="button"
                onClick={() => setPreviewTab('ticket')}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem',
                  padding: '0.55rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: previewTab === 'ticket' ? '#ffffff' : 'transparent',
                  color: previewTab === 'ticket' ? '#0f172a' : '#64748b',
                  fontWeight: '700',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  boxShadow: previewTab === 'ticket' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none'
                }}
              >
                <Printer size={15} />
                Ticket Térmico (POS)
              </button>

              <button
                type="button"
                onClick={() => setPreviewTab('sidebar')}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem',
                  padding: '0.55rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: previewTab === 'sidebar' ? '#ffffff' : 'transparent',
                  color: previewTab === 'sidebar' ? '#0f172a' : '#64748b',
                  fontWeight: '700',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  boxShadow: previewTab === 'sidebar' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none'
                }}
              >
                <Eye size={15} />
                Barra de Menú
              </button>
            </div>

            {/* Ticket Preview */}
            {previewTab === 'ticket' && (
              <div style={{ padding: '1.5rem', background: '#f1f5f9', display: 'flex', justifyContent: 'center' }}>
                <div style={{ 
                  background: '#ffffff', 
                  width: '280px', 
                  padding: '1.25rem 1rem', 
                  borderRadius: '4px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  lineHeight: '1.3',
                  color: '#000000'
                }}>
                  
                  {/* Header */}
                  <div style={{ textAlign: 'center', marginBottom: '0.75rem', borderBottom: '1px dashed #000000', paddingBottom: '0.5rem' }}>
                    {formData.logo_url && (
                      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.4rem' }}>
                        <img 
                          src={formData.logo_url} 
                          alt="Logo Preview" 
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          style={{ maxWidth: '100px', maxHeight: '50px', objectFit: 'contain' }} 
                        />
                      </div>
                    )}
                    <div style={{ fontWeight: '900', fontSize: '13px', textTransform: 'uppercase' }}>
                      {formData.business_name || 'NOMBRE DE TU SALÓN'}
                    </div>
                    {formData.receipt_header && (
                      <div style={{ fontSize: '10px', color: '#334155', fontStyle: 'italic', marginTop: '1px', marginBottom: '2px' }}>
                        {formData.receipt_header}
                      </div>
                    )}
                    {formData.rnc && (
                      <div style={{ fontSize: '10px' }}>RNC: {formData.rnc}</div>
                    )}
                    {formData.address && (
                      <div style={{ fontSize: '10px', marginTop: '2px' }}>{formData.address}</div>
                    )}
                    {formData.phone && (
                      <div style={{ fontSize: '10px' }}>Tel: {formData.phone}</div>
                    )}
                  </div>

                  {/* Metadata */}
                  <div style={{ marginBottom: '0.5rem', fontSize: '10px' }}>
                    <div>TICKET No: <strong>#TK-2026-0042</strong></div>
                    <div>FECHA: 10/10/2026 11:30 AM</div>
                    <div>CLIENTE: María Rodríguez</div>
                    <div>CAJERA: Laura M.</div>
                  </div>

                  {/* Items */}
                  <div style={{ borderTop: '1px dashed #000000', borderBottom: '1px dashed #000000', padding: '0.4rem 0', margin: '0.5rem 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                      <span>Lavado y Secado</span>
                      <span>RD$ 600.00</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Tratamiento Capilar</span>
                      <span>RD$ 850.00</span>
                    </div>
                  </div>

                  {/* Total */}
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    fontWeight: '900', 
                    fontSize: '12px',
                    margin: '0.4rem 0',
                    border: '1px solid #000',
                    padding: '0.35rem 0.5rem'
                  }}>
                    <span>TOTAL RD$:</span>
                    <span>RD$ 1,450.00</span>
                  </div>

                  {/* Footer Note */}
                  <div style={{ 
                    textAlign: 'center', 
                    marginTop: '0.75rem', 
                    fontSize: '10px', 
                    fontStyle: 'italic',
                    whiteSpace: 'pre-wrap'
                  }}>
                    {formData.receipt_footer || '¡Gracias por preferirnos! ♡'}
                  </div>

                  {formData.website && (
                    <div style={{ textAlign: 'center', fontSize: '9px', marginTop: '0.35rem', fontWeight: 'bold' }}>
                      {formData.website}
                    </div>
                  )}

                </div>
              </div>
            )}

            {/* Sidebar Preview */}
            {previewTab === 'sidebar' && (
              <div style={{ padding: '1.5rem', background: '#090d16', display: 'flex', justifyContent: 'center' }}>
                <div style={{ 
                  width: '260px', 
                  background: formData.primary_color || '#121826', 
                  borderRadius: '12px', 
                  padding: '1.25rem',
                  border: '1px solid rgba(255,255,255,0.08)',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
                }}>
                  <div style={{ textAlign: 'center', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    {formData.logo_url ? (
                      <img 
                        src={formData.logo_url} 
                        alt="Logo" 
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        style={{ maxWidth: '120px', maxHeight: '50px', objectFit: 'contain', margin: '0 auto 0.5rem', display: 'block' }} 
                      />
                    ) : null}
                    <div style={{ color: '#ffffff', fontWeight: '900', fontSize: '0.95rem' }}>
                      {formData.business_name || 'MI SALÓN'}
                    </div>
                    <div style={{ color: formData.secondary_color || '#d4af37', fontSize: '0.7rem', fontWeight: '700', marginTop: '2px' }}>
                      @{formData.slug || 'glamour'}
                    </div>
                  </div>

                  <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ background: formData.accent_color || '#3b82f6', color: '#fff', padding: '0.45rem 0.75rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '700' }}>
                      📊 Mi Panel de Salón
                    </div>
                    <div style={{ color: '#cbd5e1', padding: '0.45rem 0.75rem', fontSize: '0.75rem' }}>
                      🛒 Ventas & POS
                    </div>
                    <div style={{ color: '#cbd5e1', padding: '0.45rem 0.75rem', fontSize: '0.75rem' }}>
                      👥 Equipo & Nómina
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div style={{ padding: '1rem', borderTop: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '0.75rem', color: '#64748b' }}>
              💡 <strong>Previsualización en vivo:</strong> Cualquier cambio en los campos se reflejará aquí de inmediato.
            </div>

          </div>

        </div>

      </div>

    </div>
  );
}
