const fs = require('fs');
const path = require('path');

const landingPath = path.join(__dirname, '../../src/pages/Landing.jsx');
let content = fs.readFileSync(landingPath, 'utf8');

// The replacement dynamic pricing section
const dynamicPricingCode = `          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem', maxWidth: '1150px', margin: '0 auto' }}>
            {(publicPlans.length > 0 ? publicPlans : [
              {
                id: 4,
                name: 'Plan Base Salon Pro',
                code: 'salon-pro-base',
                price_per_branch: 49.00,
                users_per_branch: 3,
                extra_user_price: 15.00,
                description: 'Plan todo incluido para salones: POS táctil, Inventario, Nómina, Kiosco de Asistencia, DGII e-CF y Reportes consolidados.',
                included_features: { pos: true, inventory: true, payroll: true, attendance: true, dgii_ecf: true, reports: true, services_catalog: true, clients: true, cajas: true, memberships: false }
              }
            ]).map((p, idx) => {
              const isFeatured = idx === 0 || p.code === 'salon-pro-base';
              const priceUsd = parseFloat(p.price_per_branch || p.price || 49);
              const priceDop = Math.round(priceUsd * 60);
              const extraUserPrice = parseFloat(p.extra_user_price || 15);
              const usersCount = parseInt(p.users_per_branch || 3);
              const feats = typeof p.included_features === 'object' && p.included_features !== null ? p.included_features : {};

              return (
                <div 
                  key={p.id}
                  style={{
                    background: '#ffffff',
                    borderRadius: '24px',
                    border: isFeatured ? '2px solid #f06c8a' : '1.5px solid #e2e8f0',
                    padding: '2.5rem 2rem',
                    boxShadow: isFeatured ? '0 20px 40px rgba(240, 108, 138, 0.15)' : '0 4px 20px rgba(0,0,0,0.03)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    position: 'relative'
                  }}
                >
                  {isFeatured && (
                    <div style={{ position: 'absolute', top: '-14px', right: '2rem', background: 'linear-gradient(135deg, #f06c8a, #d95a76)', color: 'white', padding: '0.3rem 0.85rem', borderRadius: '99px', fontSize: '0.72rem', fontWeight: 900, letterSpacing: '0.05em' }}>
                      RECOMENDADO ⭐
                    </div>
                  )}

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                      <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: isFeatured ? '#fdf2f8' : '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isFeatured ? '#be185d' : '#334155' }}>
                        <Sparkles size={24} />
                      </div>
                      <div>
                        <h3 style={{ fontSize: '1.35rem', fontWeight: 900, margin: 0, color: '#0f172a' }}>{p.name}</h3>
                        <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>Licencia por sucursal física</p>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', margin: '1.25rem 0 0.25rem 0' }}>
                      <span style={{ fontSize: '2.5rem', fontWeight: 900, color: '#0f172a' }}>\${priceUsd}</span>
                      <span style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: 600 }}>USD / mes por sucursal</span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '1.25rem' }}>
                      Aprox. RD$ {priceDop.toLocaleString()} / mes
                    </div>

                    <p style={{ fontSize: '0.85rem', color: '#475569', lineHeight: 1.5, marginBottom: '1.25rem' }}>
                      {p.description || 'Gestión integral en la nube con punto de venta, inventario, reportes y control de personal.'}
                    </p>

                    {/* Capacidad y asientos */}
                    <div style={{ background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '1.5rem', fontSize: '0.82rem' }}>
                      <div style={{ fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Users size={16} color="#2563eb" /> <strong>{usersCount} Usuarios</strong> base incluidos por sede
                      </div>
                      <div style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                        Asientos adicionales: +\${extraUserPrice} USD / mes por usuario
                      </div>
                    </div>

                    <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 2rem 0', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <li style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', fontSize: '0.86rem', color: feats.pos ? '#1e293b' : '#94a3b8' }}>
                        {feats.pos ? <CheckCircle size={17} color="#10b981" /> : <X size={17} color="#cbd5e1" />}
                        Punto de venta táctil POS ilimitado
                      </li>
                      <li style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', fontSize: '0.86rem', color: feats.cajas ? '#1e293b' : '#94a3b8' }}>
                        {feats.cajas ? <CheckCircle size={17} color="#10b981" /> : <X size={17} color="#cbd5e1" />}
                        Arqueos de caja y pre-cuentas térmicas (60mm/80mm)
                      </li>
                      <li style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', fontSize: '0.86rem', color: feats.inventory ? '#1e293b' : '#94a3b8' }}>
                        {feats.inventory ? <CheckCircle size={17} color="#10b981" /> : <X size={17} color="#cbd5e1" />}
                        Control de inventario y stock de productos
                      </li>
                      <li style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', fontSize: '0.86rem', color: feats.payroll ? '#1e293b' : '#94a3b8' }}>
                        {feats.payroll ? <CheckCircle size={17} color="#10b981" /> : <X size={17} color="#cbd5e1" />}
                        Liquidación automática de nómina y comisiones
                      </li>
                      <li style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', fontSize: '0.86rem', color: feats.attendance ? '#1e293b' : '#94a3b8' }}>
                        {feats.attendance ? <CheckCircle size={17} color="#10b981" /> : <X size={17} color="#cbd5e1" />}
                        Kiosco fotográfico de asistencia y ponches
                      </li>
                      <li style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', fontSize: '0.86rem', color: feats.dgii_ecf ? '#1e293b' : '#94a3b8' }}>
                        {feats.dgii_ecf ? <CheckCircle size={17} color="#10b981" /> : <X size={17} color="#cbd5e1" />}
                        Facturación electrónica fiscal DGII (e-CF)
                      </li>
                      <li style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', fontSize: '0.86rem', color: feats.reports ? '#1e293b' : '#94a3b8' }}>
                        {feats.reports ? <CheckCircle size={17} color="#10b981" /> : <X size={17} color="#cbd5e1" />}
                        Reportes financieros y analítica ejecutiva
                      </li>
                      <li style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', fontSize: '0.86rem', color: feats.services_catalog ? '#1e293b' : '#94a3b8' }}>
                        {feats.services_catalog ? <CheckCircle size={17} color="#10b981" /> : <X size={17} color="#cbd5e1" />}
                        Catálogo de servicios y tarifas
                      </li>
                      
                      {/* Membresías Flag Callout */}
                      <li style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', fontSize: '0.86rem', color: feats.memberships ? '#db2777' : '#64748b', fontWeight: feats.memberships ? 800 : 500 }}>
                        {feats.memberships ? <CheckCircle size={17} color="#db2777" /> : <Sparkles size={17} color="#d97706" />}
                        {feats.memberships 
                          ? 'Feature Plan Beauty RD (Membresías incluidas)' 
                          : 'Add-on Membresías Plan Beauty (Disponible por +$29/mes)'}
                      </li>
                    </ul>
                  </div>

                  <div>
                    <button 
                      onClick={() => {
                        setSalonFormData(prev => ({ ...prev, planInterest: \`\${p.name} (\${priceUsd} USD/mes)\` }));
                        setSalonSuccess(false);
                        setShowSalonModal(true);
                      }}
                      style={{ 
                        width: '100%', 
                        background: isFeatured ? 'linear-gradient(135deg, #f06c8a, #d95a76)' : '#0f172a', 
                        color: 'white', 
                        border: 'none', 
                        padding: '0.95rem', 
                        borderRadius: '12px', 
                        fontWeight: 800, 
                        fontSize: '0.92rem', 
                        cursor: 'pointer',
                        boxShadow: isFeatured ? '0 8px 20px rgba(240, 108, 138, 0.35)' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.5rem'
                      }}
                    >
                      {isFeatured ? <Sparkles size={18} /> : null}
                      Elegir {p.name}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Banner Add-on Independiente Membresías */}
          <div style={{ maxWidth: '1150px', margin: '3rem auto 0 auto', background: 'linear-gradient(135deg, #fdf2f8 0%, #fff1f2 100%)', border: '1.5px solid #fbcfe8', borderRadius: '20px', padding: '1.75rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
              <div style={{ width: '50px', height: '50px', borderRadius: '14px', background: '#f43f5e', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Crown size={28} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900, color: '#9f1239' }}>
                  Add-on Exclusivo: Módulo de Membresías Recurrentes Plan Beauty RD
                </h3>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.88rem', color: '#be123c', maxWidth: '750px', lineHeight: 1.5 }}>
                  Vende suscripciones mensuales de lavados y secados a tus clientas con cobros automáticos con tarjeta (vía CardNet). Un módulo desacoplado que puedes sumar a cualquier plan por solo <strong>+$29 USD / mes</strong>.
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                setSalonFormData(prev => ({ ...prev, planInterest: 'Add-on Membresías Plan Beauty ($29/mes)' }));
                setSalonSuccess(false);
                setShowSalonModal(true);
              }}
              style={{
                background: '#e11d48',
                color: '#ffffff',
                border: 'none',
                borderRadius: '12px',
                padding: '0.85rem 1.6rem',
                fontWeight: 800,
                fontSize: '0.9rem',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(225, 29, 72, 0.35)'
              }}
            >
              Consultar Add-on
            </button>
          </div>`;

// Find where <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' starts
const startMarker = '<div style={{ display: \'grid\', gridTemplateColumns: \'repeat(auto-fit, minmax(300px, 1fr))\'';
const endMarker = '          </div>\r\n        </div>\r\n      </section>';
const endMarkerLF = '          </div>\n        </div>\n      </section>';

const startIndex = content.indexOf(startMarker);
let endIndex = content.indexOf(endMarker, startIndex);
let endLength = '          </div>'.length;

if (endIndex === -1) {
  endIndex = content.indexOf(endMarkerLF, startIndex);
}

if (startIndex === -1 || endIndex === -1) {
  console.error('Could not find markers in Landing.jsx! startIndex:', startIndex, 'endIndex:', endIndex);
  process.exit(1);
}

const before = content.substring(0, startIndex);
const after = content.substring(endIndex + endLength);

content = before + dynamicPricingCode + after;

// Also update the select options in the modal
const oldSelect = `<option value="Salon Pro ($59/mes)">Salon Pro ($59/mes) - Con Plan Beauty ⭐</option>
                        <option value="Starter POS ($29/mes)">Starter POS ($29/mes)</option>
                        <option value="Enterprise Franchise ($99/mes)">Enterprise Franchise ($99/mes)</option>`;

const newSelect = `{(publicPlans.length > 0 ? publicPlans : [
                          { id: 4, name: 'Plan Base Salon Pro', price_per_branch: 49 }
                        ]).map(p => (
                          <option key={p.id} value={p.name + ' (' + p.price_per_branch + ' USD/mes)'}>
                            {p.name} (\${p.price_per_branch}/mes por sucursal) ⭐
                          </option>
                        ))}
                        <option value="Add-on Membresías Plan Beauty ($29/mes)">Add-on Membresías Plan Beauty ($29/mes)</option>`;

content = content.replace(oldSelect, newSelect);
// Also in case CRLF vs LF
content = content.replace(oldSelect.replace(/\r?\n/g, '\n'), newSelect);

fs.writeFileSync(landingPath, content, 'utf8');
console.log('✅ Landing.jsx updated successfully with dynamic pricing and modal select!');
