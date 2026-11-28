import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ShieldCheck, AlertTriangle, ArrowLeft, Lock, Building2, Users, Sparkles, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import SaasCheckoutPanel, { formatOrderMoney } from '../components/saas/SaasCheckoutPanel';
import '../components/saas/SaasBillingModule.css';

export default function SaasPaymentLinkPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [order, setOrder] = useState(null);
  const [tenantInfo, setTenantInfo] = useState(null);
  const [gateway, setGateway] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadPaymentLink = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/saas/billing/payment-links/${encodeURIComponent(token)}`, {
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo cargar el enlace de pago.');
      }
      setOrder(data.order || null);
      setTenantInfo(data.tenant || null);
      setGateway(data.gateway || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadPaymentLink();
  }, [loadPaymentLink]);

  const fxSnapshot = order?.metadata?.fx_snapshot || null;
  const usdTotal = fxSnapshot?.usd?.total_minor ? formatOrderMoney(fxSnapshot.usd.total_minor, 'USD') : null;
  const primaryTotal = order
    ? formatOrderMoney(
        fxSnapshot?.usd?.total_minor ?? order.total_minor,
        fxSnapshot?.usd ? 'USD' : (order.currency || 'DOP')
      )
    : null;
  const dopTotal = order && String(order.currency || '').toUpperCase() === 'DOP'
    ? formatOrderMoney(order.total_minor, 'DOP')
    : null;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #f8fafc 0%, #eff6ff 100%)',
        padding: '32px 16px 56px',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div style={{ maxWidth: 660, margin: '0 auto' }}>
        {/* Top Brand & Back Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 24,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              aria-hidden="true"
              style={{
                display: 'inline-flex',
                gap: 3,
                transform: 'skewX(-18deg)',
              }}
            >
              <i style={{ display: 'block', width: 4, height: 18, borderRadius: 2, background: '#2563eb' }} />
              <i style={{ display: 'block', width: 4, height: 18, borderRadius: 2, background: '#2563eb' }} />
              <i style={{ display: 'block', width: 4, height: 18, borderRadius: 2, background: '#2563eb' }} />
            </span>
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em', color: '#0f172a' }}>
              etereas<span style={{ color: '#2563eb' }}>.</span>
            </span>
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                color: '#1d4ed8',
                background: '#dbeafe',
                padding: '3px 9px',
                borderRadius: 999,
                letterSpacing: '0.02em',
              }}
            >
              Pago seguro
            </span>
          </div>

          {(() => {
            const rawRole = String(user?.role || '').trim().toLowerCase();
            const backTarget = !user
              ? '/login'
              : rawRole === 'vendedor'
                ? '/vendedor'
                : (rawRole === 'superadmin' || user?.isSuperAdmin)
                  ? '/saas'
                  : '/mi-suscripcion';
            const backLabel = !user
              ? 'Iniciar sesión'
              : rawRole === 'vendedor'
                ? 'Portal de Ventas'
                : (rawRole === 'superadmin' || user?.isSuperAdmin)
                  ? 'Control Plane'
                  : 'Mi Suscripción';
            return (
              <button
                type="button"
                className="sb-btn"
                onClick={() => navigate(backTarget)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  borderRadius: 10,
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  color: '#334155',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <ArrowLeft size={14} />
                <span>{backLabel}</span>
              </button>
            );
          })()}
        </div>

        {/* Main Checkout Container */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 20,
            boxShadow: '0 20px 45px -20px rgba(15, 23, 42, 0.14)',
            overflow: 'hidden',
          }}
        >
          {/* Card Header */}
          <div
            style={{
              padding: '22px 26px',
              borderBottom: '1px solid #f1f5f9',
              background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  background: 'rgba(37, 99, 235, 0.25)',
                  border: '1px solid rgba(96, 165, 250, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <ShieldCheck size={22} color="#60a5fa" />
              </div>
              <div>
                <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0, letterSpacing: '-0.02em', color: '#ffffff' }}>
                  {tenantInfo?.businessName ? `Suscripción · ${tenantInfo.businessName}` : 'Pago de suscripción Etereas'}
                </h1>
                <p style={{ margin: '3px 0 0', fontSize: 13, color: '#cbd5e1' }}>
                  Revisa los detalles de tu orden y completa el pago protegido con CardNet.
                </p>
              </div>
            </div>

            {order && primaryTotal && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3b8' }}>
                  Total a pagar
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#ffffff', letterSpacing: '-0.02em' }}>
                  {primaryTotal}
                </div>
                {usdTotal && dopTotal && (
                  <div style={{ fontSize: 12, color: '#93c5fd', fontWeight: 600 }}>
                    Cargo procesado: {dopTotal}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Card Body */}
          <div style={{ padding: '24px 26px' }}>
            {loading ? (
              <div style={{ padding: '28px 0', textAlign: 'center', color: '#64748b', fontSize: 14, fontWeight: 500 }}>
                Cargando detalles de la orden de pago...
              </div>
            ) : error ? (
              <div className="sb-alert sb-alert-danger" style={{ margin: 0 }}>
                <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            ) : order ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {order.status === 'approved' && (
                  <div
                    style={{
                      padding: '18px 20px',
                      borderRadius: 14,
                      background: '#f0fdf4',
                      border: '1px solid #86efac',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#166534', fontWeight: 800, fontSize: 16 }}>
                      <CheckCircle2 size={22} color="#16a34a" />
                      <span>¡Pago aprobado y cuenta activada!</span>
                    </div>
                    <p style={{ margin: 0, fontSize: 13.5, color: '#14532d', lineHeight: 1.5 }}>
                      Tu empresa <strong>{tenantInfo?.businessName || 'en Etereas'}</strong> ya está activa y tu tarjeta quedó registrada de forma segura en CardNet para el cobro automático mensual.
                    </p>
                    <div>
                      <button
                        type="button"
                        className="sb-btn sb-btn-primary"
                        onClick={() => navigate(user ? '/' : '/login')}
                      >
                        {user ? 'Ir a mi panel →' : 'Iniciar sesión en Etereas →'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Summary Pills */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                    gap: 10,
                    padding: 14,
                    borderRadius: 14,
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <Building2 size={16} color="#2563eb" />
                    <div>
                      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Sucursales</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                        {Number(order.branches_count || 1)} {Number(order.branches_count || 1) === 1 ? 'sucursal' : 'sucursales'}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <Users size={16} color="#2563eb" />
                    <div>
                      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Usuarios extra</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                        {Number(order.extra_users_count || 0)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <Sparkles size={16} color={order.memberships_addon_enabled ? '#2563eb' : '#94a3b8'} />
                    <div>
                      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Membresías B2C</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                        {order.memberships_addon_enabled ? 'Incluido' : 'No incluido'}
                      </div>
                    </div>
                  </div>
                </div>

                {order.status !== 'approved' && (
                  <div
                    style={{
                      padding: '11px 14px',
                      borderRadius: 12,
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      color: '#1e3a8a',
                      fontSize: 12.5,
                      lineHeight: 1.45,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Lock size={15} color="#2563eb" style={{ flexShrink: 0 }} />
                    <span>
                      Al completar el pago, tu cuenta se activará automáticamente y tu tarjeta quedará registrada de forma segura en CardNet para el <strong>cobro automático cada 30 días, por adelantado</strong>.
                    </span>
                  </div>
                )}

                {/* CardNet Checkout Panel */}
                <SaasCheckoutPanel
                  orders={[order]}
                  gatewayStatus={gateway}
                  onOrderUpdated={loadPaymentLink}
                  initiateEndpointBuilder={() => `/api/saas/billing/payment-links/${encodeURIComponent(token)}/initiate-cardnet`}
                  chargeEndpointBuilder={() => `/api/saas/billing/payment-links/${encodeURIComponent(token)}/charge-token`}
                  verifyEndpointBuilder={() => `/api/saas/billing/payment-links/${encodeURIComponent(token)}/verify`}
                  redirectOnActivated={false}
                />
              </div>
            ) : null}
          </div>

          {/* Trust Footer */}
          <div
            style={{
              padding: '14px 26px',
              background: '#f8fafc',
              borderTop: '1px solid #f1f5f9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
              fontSize: 12,
              color: '#64748b',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle2 size={14} color="#16a34a" />
              <span>Transacción cifrada 3D Secure vía CardNet</span>
            </span>
            <span>Etereas no almacena datos de tu tarjeta</span>
          </div>
        </div>
      </div>
    </div>
  );
}
