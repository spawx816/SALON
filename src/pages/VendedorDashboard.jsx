import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Plus,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  LogOut,
  CreditCard,
  CheckCircle2,
  Clock,
  Sparkles,
  MessageCircle,
  Users,
  Key,
  Mail,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import ChangePasswordModal from '../components/common/ChangePasswordModal';

function makeReadableTempPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const pick = (chars) => chars[Math.floor(Math.random() * chars.length)];
  return `Etr-${pick(digits)}${pick(upper)}${pick(lower)}${pick(digits)}-${pick(upper)}${pick(lower)}${pick(digits)}${pick(upper)}`;
}

export default function VendedorDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successBanner, setSuccessBanner] = useState(null);
  const [copiedToken, setCopiedToken] = useState('');
  const [regeneratingId, setRegeneratingId] = useState(null);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);

  // Create Tenant Form
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState(() => ({
    business_name: '',
    owner_name: '',
    owner_email: '',
    owner_phone: '',
    address: '',
    admin_password: makeReadableTempPassword(),
    branches_count: 1,
    extra_users_count: 0,
    wants_memberships_addon: false,
  }));

  const loadTenants = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/saas/vendedor/tenants', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudieron cargar tus empresas.');
      setTenants(Array.isArray(data.tenants) ? data.tenants : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTenants();
  }, [loadTenants]);

  const buildLoginAccessUrl = (ownerEmail = '') => {
    const base = `${window.location.origin}/login`;
    return ownerEmail ? `${base}?email=${encodeURIComponent(ownerEmail)}` : base;
  };

  const handleCopyText = async (textToCopy, keyId) => {
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedToken(keyId);
      setTimeout(() => setCopiedToken(''), 2200);
    } catch {
      window.prompt('Copia la información:', textToCopy);
    }
  };

  const handleOpenWhatsApp = (tenantName, phone, ownerEmail, tempPassword = null) => {
    const cleanLoginUrl = `${window.location.origin}/login`;
    const directUrl = buildLoginAccessUrl(ownerEmail);
    let digits = String(phone || '').replace(/\D/g, '');
    if (/^(809|829|849)\d{7}$/.test(digits)) {
      digits = `1${digits}`;
    }

    const message = tempPassword
      ? `¡Hola! Bienvenido a *Etereas*. Ya creamos el perfil de *${tenantName}* (pendiente de pago).\n\n*Tus datos de acceso:*\n• Página: ${cleanLoginUrl}\n• Correo: ${ownerEmail}\n• Clave temporal: ${tempPassword}\n\nIngresa aquí para iniciar sesión y completar tu pago seguro con CardNet:\n${directUrl}\n\n_(Recuerda cambiar tu clave temporal desde que entres a tu cuenta)._`
      : `¡Hola! Te compartimos el enlace de acceso a *Etereas* para iniciar sesión con tu correo (${ownerEmail}) y completar la activación de *${tenantName}*:\n\n${directUrl}`;

    const text = encodeURIComponent(message);
    const waUrl = digits ? `https://wa.me/${digits}?text=${text}` : `https://wa.me/?text=${text}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCreateTenant = async (e) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      const clampedBranches = Math.min(50, Math.max(1, Number(form.branches_count) || 1));
      const clampedExtraUsers = Math.min(500, Math.max(0, Number(form.extra_users_count) || 0));
      const trimmedPwd = String(form.admin_password || '').trim();
      if (trimmedPwd && trimmedPwd.length < 6) {
        throw new Error('La clave temporal debe tener al menos 6 caracteres.');
      }

      const res = await fetch('/api/saas/vendedor/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...form,
          admin_password: trimmedPwd || undefined,
          branches_count: clampedBranches,
          extra_users_count: clampedExtraUsers,
          addon_branches_count: form.wants_memberships_addon ? clampedBranches : 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo crear la empresa.');

      setSuccessBanner({
        businessName: data.tenant?.business_name || form.business_name,
        ownerEmail: data.tenant?.owner_email || form.owner_email,
        ownerPhone: form.owner_phone,
        orderNumber: data.order?.order_number,
        generatedPassword: data.generatedPassword || trimmedPwd || null,
        emailSent: Boolean(data.emailSent),
        emailError: data.emailError || null,
      });
      setForm({
        business_name: '',
        owner_name: '',
        owner_email: '',
        owner_phone: '',
        address: '',
        admin_password: makeReadableTempPassword(),
        branches_count: 1,
        extra_users_count: 0,
        wants_memberships_addon: false,
      });
      await loadTenants();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendReminderEmail = async (tenant) => {
    setRegeneratingId(tenant.id);
    setError('');
    try {
      const branchesForLink = Math.min(50, Math.max(1, Number(tenant.licensed_branches || 1)));
      const wantsAddonForLink = Boolean(tenant.has_memberships || tenant.latest_order_memberships_addon);
      const addonBranchesForLink = wantsAddonForLink
        ? Math.min(branchesForLink, Math.max(1, Number(tenant.latest_order_addon_branches_count || branchesForLink)))
        : 0;
      const res = await fetch(`/api/saas/vendedor/tenants/${tenant.id}/payment-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          branchesCount: branchesForLink,
          extraUsersCount: Math.max(0, Number(tenant.extra_user_seats || 0)),
          wantsMembershipsAddon: wantsAddonForLink,
          addonBranchesCount: addonBranchesForLink,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo enviar el recordatorio.');
      setSuccessBanner({
        businessName: tenant.business_name,
        ownerEmail: tenant.owner_email,
        ownerPhone: tenant.owner_phone,
        orderNumber: data.order?.order_number,
        generatedPassword: null,
        emailSent: Boolean(data.emailSent),
        emailError: data.emailError || null,
      });
      await loadTenants();
    } catch (err) {
      setError(err.message);
    } finally {
      setRegeneratingId(null);
    }
  };

  const branchesNum = Math.min(50, Math.max(1, Number(form.branches_count) || 1));
  const extraNum = Math.min(500, Math.max(0, Number(form.extra_users_count) || 0));
  const addonBlocks = form.wants_memberships_addon ? Math.ceil(branchesNum / 3) : 0;
  const estimatedUsd = branchesNum * 99 + extraNum * 30 + addonBlocks * 99;

  const activeCount = tenants.filter((t) => t.status === 'active').length;
  const pendingCount = tenants.filter((t) => t.status === 'pending').length;
  const savedCardsCount = tenants.filter((t) => Number(t.saved_cards_count || 0) > 0).length;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f8fafc',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#0f172a',
      }}
    >
      {/* Top Bar */}
      <header
        style={{
          background: '#0f172a',
          color: '#ffffff',
          padding: '14px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ display: 'inline-flex', gap: 3, transform: 'skewX(-18deg)' }} aria-hidden="true">
            <i style={{ display: 'block', width: 4, height: 18, borderRadius: 2, background: '#3b82f6' }} />
            <i style={{ display: 'block', width: 4, height: 18, borderRadius: 2, background: '#3b82f6' }} />
            <i style={{ display: 'block', width: 4, height: 18, borderRadius: 2, background: '#3b82f6' }} />
          </span>
          <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.03em' }}>
            etereas<span style={{ color: '#3b82f6' }}>.</span>
          </span>
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              background: 'rgba(59,130,246,0.2)',
              color: '#93c5fd',
              padding: '3px 10px',
              borderRadius: 999,
            }}
          >
            Portal de Vendedores
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'right', fontSize: 12.5, marginRight: 4 }}>
            <div style={{ fontWeight: 700, color: '#ffffff' }}>{user?.name || user?.nombre || 'Vendedor'}</div>
            <div style={{ color: '#94a3b8', fontSize: 11.5 }}>{user?.email}</div>
          </div>
          <button
            type="button"
            onClick={() => setIsChangePasswordOpen(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 12px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(255,255,255,0.06)',
              color: '#e2e8f0',
              fontSize: 12.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <Key size={14} />
            <span>Cambiar clave</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              await logout();
              navigate('/', { replace: true });
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(255,255,255,0.08)',
              color: '#ffffff',
              fontSize: 12.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <LogOut size={14} />
            <span>Salir</span>
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 1160, margin: '0 auto', padding: '28px 20px 56px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          {[
            { label: 'Empresas Creadas', value: tenants.length, icon: Building2, color: '#2563eb', bg: '#eff6ff' },
            { label: 'Activas (Pagadas)', value: activeCount, icon: CheckCircle2, color: '#16a34a', bg: '#f0fdf4' },
            { label: 'Pendientes de Pago', value: pendingCount, icon: Clock, color: '#d97776'.replace('#d97776', '#d97706'), bg: '#fffbeb' },
            { label: 'Con Cobro Automático', value: savedCardsCount, icon: CreditCard, color: '#7c3aed', bg: '#f5f3ff' },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div
              key={label}
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 16,
                padding: '16px 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>{label}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: '#0f172a', marginTop: 2 }}>{value}</div>
              </div>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={20} color={color} />
              </div>
            </div>
          ))}
        </div>

        {/* Success Banner with Credentials + Login Access Link */}
        {successBanner && (
          <div
            style={{
              background: '#f0fdf4',
              border: '1.5px solid #86efac',
              borderRadius: 16,
              padding: '18px 22px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#166534', fontWeight: 800, fontSize: 15 }}>
                <CheckCircle2 size={20} color="#16a34a" />
                <span>
                  Perfil listo para {successBanner.businessName}
                  {successBanner.orderNumber ? ` (Orden #${successBanner.orderNumber})` : ''}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSuccessBanner(null)}
                style={{ background: 'transparent', border: 'none', color: '#166534', fontWeight: 700, cursor: 'pointer', fontSize: 12.5 }}
              >
                Cerrar ✕
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12.5,
                fontWeight: 600,
                color: successBanner.emailSent ? '#166534' : '#92400e',
                background: successBanner.emailSent ? '#dcfce7' : '#fef3c7',
                border: `1px solid ${successBanner.emailSent ? '#86efac' : '#fde68a'}`,
                padding: '8px 12px',
                borderRadius: 9,
              }}
            >
              <Mail size={15} />
              <span>
                {successBanner.emailSent
                  ? `Correo de bienvenida enviado a ${successBanner.ownerEmail} con su usuario, clave temporal y el enlace de inicio de sesión para completar el pago.`
                  : `No se pudo enviar el correo automático${successBanner.emailError ? ` (${successBanner.emailError})` : ''}. Comparte los accesos por WhatsApp o cópialos abajo.`}
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                flexWrap: 'wrap',
                background: '#ffffff',
                border: '1px solid #bbf7d0',
                borderRadius: 10,
                padding: '10px 14px',
                fontSize: 13,
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                <span>
                  <span style={{ color: '#64748b', fontWeight: 600 }}>Página: </span>
                  <code style={{ color: '#2563eb', fontWeight: 700 }}>{`${window.location.origin}/login`}</code>
                </span>
                <span style={{ color: '#cbd5e1' }}>|</span>
                <span>
                  <span style={{ color: '#64748b', fontWeight: 600 }}>Correo: </span>
                  <strong style={{ color: '#0f172a' }}>{successBanner.ownerEmail}</strong>
                </span>
                {successBanner.generatedPassword && (
                  <>
                    <span style={{ color: '#cbd5e1' }}>|</span>
                    <span>
                      <span style={{ color: '#64748b', fontWeight: 600 }}>Clave temporal: </span>
                      <code style={{ background: '#f1f5f9', padding: '2px 8px', borderRadius: 6, fontWeight: 800, color: '#0f172a' }}>
                        {successBanner.generatedPassword}
                      </code>
                    </span>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => {
                    const summary = successBanner.generatedPassword
                      ? `Empresa: ${successBanner.businessName}\nIniciar sesión: ${buildLoginAccessUrl(successBanner.ownerEmail)}\nCorreo: ${successBanner.ownerEmail}\nClave temporal: ${successBanner.generatedPassword}`
                      : `Empresa: ${successBanner.businessName}\nIniciar sesión: ${buildLoginAccessUrl(successBanner.ownerEmail)}\nCorreo: ${successBanner.ownerEmail}`;
                    handleCopyText(summary, 'BANNER_ACCESS');
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#0f172a',
                    color: '#ffffff',
                    fontSize: 12.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {copiedToken === 'BANNER_ACCESS' ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copiedToken === 'BANNER_ACCESS' ? 'Copiado' : 'Copiar accesos'}</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleOpenWhatsApp(
                      successBanner.businessName,
                      successBanner.ownerPhone,
                      successBanner.ownerEmail,
                      successBanner.generatedPassword
                    )
                  }
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#16a34a',
                    color: '#ffffff',
                    fontSize: 12.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <MessageCircle size={14} />
                  <span>Enviar por WhatsApp</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div style={{ padding: '12px 16px', borderRadius: 12, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13.5, fontWeight: 600 }}>
            {error}
          </div>
        )}

        {/* Create Company Form */}
        <section style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 18, padding: '22px 24px', boxShadow: '0 6px 24px -12px rgba(15,23,42,0.08)' }}>
          <div style={{ marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Plus size={19} color="#2563eb" />
              <span>Registrar nueva empresa</span>
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
              Al crear el perfil, el cliente recibe automáticamente un correo de bienvenida con su usuario, su clave temporal y el enlace para iniciar sesión en Etereas y realizar el pago con CardNet.
            </p>
          </div>

          {formError && (
            <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>
              {formError}
            </div>
          )}

          <form onSubmit={handleCreateTenant} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 5 }}>Nombre de la empresa *</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Studio Belleza RD"
                  value={form.business_name}
                  onChange={(e) => setForm({ ...form, business_name: e.target.value })}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13.5, boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 5 }}>Nombre del propietario *</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Laura Gómez"
                  value={form.owner_name}
                  onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13.5, boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 5 }}>Correo del propietario *</label>
                <input
                  type="email"
                  required
                  placeholder="cliente@empresa.com"
                  value={form.owner_email}
                  onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13.5, boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <label style={{ fontSize: 12.5, fontWeight: 700, color: '#334155' }}>Clave temporal *</label>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, admin_password: makeReadableTempPassword() })}
                    style={{ background: 'transparent', border: 'none', color: '#2563eb', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', padding: 0 }}
                  >
                    ↻ Generar otra
                  </button>
                </div>
                <input
                  type="text"
                  required
                  minLength={6}
                  placeholder="Mínimo 6 caracteres"
                  value={form.admin_password}
                  onChange={(e) => setForm({ ...form, admin_password: e.target.value })}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13.5, fontWeight: 700, fontFamily: 'monospace', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 5 }}>WhatsApp / Teléfono</label>
                <input
                  type="tel"
                  placeholder="809-555-0000"
                  value={form.owner_phone}
                  onChange={(e) => setForm({ ...form, owner_phone: e.target.value })}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13.5, boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#334155', marginBottom: 5 }}>Dirección (opcional)</label>
                <input
                  type="text"
                  placeholder="Santo Domingo, RD"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13.5, boxSizing: 'border-box' }}
                />
              </div>
            </div>

            {/* Plan Config Strip */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                padding: '14px 16px',
                borderRadius: 14,
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 18 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                    Sucursales (US$99/mes c/u)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={form.branches_count}
                    onChange={(e) => setForm({ ...form, branches_count: e.target.value })}
                    style={{ width: 90, padding: '7px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontWeight: 700 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                    Usuarios extra (US$30/mes c/u)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={form.extra_users_count}
                    onChange={(e) => setForm({ ...form, extra_users_count: e.target.value })}
                    style={{ width: 90, padding: '7px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontWeight: 700 }}
                  />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#1e293b', marginTop: 14 }}>
                  <input
                    type="checkbox"
                    checked={form.wants_memberships_addon}
                    onChange={(e) => setForm({ ...form, wants_memberships_addon: e.target.checked })}
                    style={{ width: 16, height: 16, accentColor: '#2563eb' }}
                  />
                  <Sparkles size={15} color="#2563eb" />
                  <span>Agregar módulo de membresías (US$99/mes c/3 suc.)</span>
                </label>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Total mensual</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>US${estimatedUsd}/mes</div>
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    padding: '11px 20px',
                    borderRadius: 11,
                    border: 'none',
                    background: '#2563eb',
                    color: '#ffffff',
                    fontSize: 13.5,
                    fontWeight: 800,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {submitting ? 'Creando y enviando correo...' : 'Crear empresa y enviar bienvenida →'}
                </button>
              </div>
            </div>
          </form>
        </section>

        {/* My Companies List */}
        <section style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 18, overflow: 'hidden' }}>
          <div style={{ padding: '16px 22px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
              Mis Empresas Registradas ({tenants.length})
            </h3>
            <button
              type="button"
              onClick={loadTenants}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#f8fafc', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', color: '#334155' }}
            >
              <RefreshCw size={13} />
              <span>Actualizar</span>
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ background: '#f8fafc', color: '#475569', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '12px 18px' }}>Empresa / Propietario</th>
                  <th style={{ padding: '12px 14px' }}>Configuración</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>Estado</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center' }}>Cobro Automático</th>
                  <th style={{ padding: '12px 18px', textAlign: 'right' }}>Seguimiento y Accesos</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 28, textAlign: 'center', color: '#64748b' }}>
                      Cargando empresas...
                    </td>
                  </tr>
                ) : tenants.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 28, textAlign: 'center', color: '#64748b' }}>
                      Aún no has registrado ninguna empresa. Usa el formulario de arriba para crear la primera y enviar su correo de bienvenida.
                    </td>
                  </tr>
                ) : (
                  tenants.map((t) => {
                    const st = String(t.status || '').toLowerCase();
                    const isActive = st === 'active';
                    const isSuspendedOrCancelled = st === 'suspended' || st === 'cancelled';
                    const hasCard = Number(t.saved_cards_count || 0) > 0;
                    const includesMemberships = Boolean(t.has_memberships || t.latest_order_memberships_addon);
                    const loginLinkForRow = buildLoginAccessUrl(t.owner_email);
                    const statusBadge = isActive
                      ? { label: 'Activa', bg: '#dcfce7', color: '#166534' }
                      : st === 'suspended'
                        ? { label: 'Suspendida', bg: '#fee2e2', color: '#991b1b' }
                        : st === 'cancelled'
                          ? { label: 'Cancelada', bg: '#f1f5f9', color: '#475569' }
                          : { label: 'Pendiente de pago', bg: '#fef3c7', color: '#92400e' };
                    return (
                      <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '12px 18px' }}>
                          <div style={{ fontWeight: 800, color: '#0f172a' }}>{t.business_name}</div>
                          <div style={{ fontSize: 12, color: '#64748b' }}>
                            {t.owner_name} · {t.owner_email}
                          </div>
                        </td>
                        <td style={{ padding: '12px 14px', fontSize: 12.5, color: '#334155' }}>
                          <div>
                            <Building2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                            {t.licensed_branches || 1} suc. · <Users size={12} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                            {Number(t.extra_user_seats || 0)} extra
                          </div>
                          {includesMemberships && (
                            <span style={{ display: 'inline-block', marginTop: 3, fontSize: 11, fontWeight: 700, color: '#1d4ed8', background: '#dbeafe', padding: '1px 7px', borderRadius: 999 }}>
                              Membresías B2C
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '3px 10px',
                              borderRadius: 999,
                              fontSize: 12,
                              fontWeight: 700,
                              background: statusBadge.bg,
                              color: statusBadge.color,
                            }}
                          >
                            {statusBadge.label}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center', fontSize: 12 }}>
                          {hasCard ? (
                            <span style={{ color: '#15803d', fontWeight: 700 }}>✓ Tarjeta guardada</span>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>Pendiente</span>
                          )}
                        </td>
                        <td style={{ padding: '12px 18px', textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
                            {!isActive && !isSuspendedOrCancelled && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleCopyText(loginLinkForRow, t.id)}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#ffffff', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#0f172a' }}
                                >
                                  {copiedToken === t.id ? <Check size={13} color="#16a34a" /> : <Copy size={13} />}
                                  <span>{copiedToken === t.id ? 'Copiado' : 'Copiar link login'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleOpenWhatsApp(t.business_name, t.owner_phone, t.owner_email, null)}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 8, border: 'none', background: '#16a34a', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#ffffff' }}
                                >
                                  <MessageCircle size={13} />
                                  <span>WhatsApp</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={regeneratingId === t.id}
                                  onClick={() => handleSendReminderEmail(t)}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 8, border: '1px solid #bfdbfe', background: '#eff6ff', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#1d4ed8' }}
                                >
                                  <Mail size={13} />
                                  <span>{regeneratingId === t.id ? 'Enviando...' : 'Reenviar correo'}</span>
                                </button>
                              </>
                            )}
                            {isActive && (
                              <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 700 }}>
                                Activada ✓
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
      <ChangePasswordModal
        isOpen={isChangePasswordOpen}
        onClose={() => setIsChangePasswordOpen(false)}
      />
    </div>
  );
}
