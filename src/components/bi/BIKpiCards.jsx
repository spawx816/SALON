import React from 'react';
import { 
  DollarSign, TrendingUp, CreditCard, Receipt, Users, UserCheck, 
  Calendar, AlertCircle, Percent, Clock, Tag, ShoppingBag, ShieldAlert,
  ArrowUpRight, ArrowDownRight
} from 'lucide-react';

const ICON_MAP = {
  trending: TrendingUp,
  dollar: DollarSign,
  credit_card: CreditCard,
  receipt: Receipt,
  users: Users,
  user_check: UserCheck,
  calendar: Calendar,
  percent: Percent,
  clock: Clock,
  tag: Tag,
  bag: ShoppingBag,
  alert: ShieldAlert
};

const COLOR_MAP = {
  emerald: { bg: '#ecfdf5', iconBg: '#d1fae5', text: '#059669', badgeBg: '#d1fae5' },
  blue: { bg: '#eff6ff', iconBg: '#dbeafe', text: '#2563eb', badgeBg: '#dbeafe' },
  purple: { bg: '#f5f3ff', iconBg: '#ede9fe', text: '#7c3aed', badgeBg: '#ede9fe' },
  amber: { bg: '#fffbeb', iconBg: '#fef3c7', text: '#d97706', badgeBg: '#fef3c7' },
  rose: { bg: '#fff1f2', iconBg: '#ffe4e6', text: '#e11d48', badgeBg: '#ffe4e6' },
  slate: { bg: '#f8fafc', iconBg: '#f1f5f9', text: '#475569', badgeBg: '#f1f5f9' }
};

export const BIKpiCards = ({ kpis = [] }) => {
  if (!kpis || kpis.length === 0) return null;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fit, minmax(220px, 1fr))`,
      gap: '1rem',
      marginBottom: '1.5rem'
    }}>
      {kpis.map((kpi, idx) => {
        const theme = COLOR_MAP[kpi.color] || COLOR_MAP.blue;
        const IconComponent = ICON_MAP[kpi.icon] || TrendingUp;

        return (
          <div
            key={idx}
            style={{
              background: '#ffffff',
              borderRadius: '1rem',
              padding: '1.25rem 1.35rem',
              border: '1px solid #e2e8f0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '1rem',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease'
            }}
          >
            {/* Rounded Icon Container */}
            <div
              style={{
                width: '46px',
                height: '46px',
                borderRadius: '0.75rem',
                background: theme.iconBg,
                color: theme.text,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <IconComponent size={22} strokeWidth={2.2} />
            </div>

            {/* Metric Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: '0.82rem',
                fontWeight: 600,
                color: '#64748b',
                marginBottom: '0.2rem',
                textTransform: 'none'
              }}>
                {kpi.label}
              </div>

              <div style={{
                fontSize: '1.45rem',
                fontWeight: 800,
                color: '#0f172a',
                letterSpacing: '-0.02em',
                lineHeight: 1.2,
                wordBreak: 'break-word'
              }}>
                {kpi.value}
              </div>

              {kpi.subtext && (
                <div style={{
                  fontSize: '0.78rem',
                  color: '#64748b',
                  marginTop: '0.25rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem'
                }}>
                  {kpi.badge && (
                    <span style={{
                      background: theme.badgeBg,
                      color: theme.text,
                      padding: '0.1rem 0.4rem',
                      borderRadius: '0.25rem',
                      fontWeight: 600,
                      fontSize: '0.72rem'
                    }}>
                      {kpi.badge}
                    </span>
                  )}
                  <span>{kpi.subtext}</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

