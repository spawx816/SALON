import React, { useState, useEffect } from 'react';
import { Star, MessageSquare, TrendingUp, Users, Target, ThumbsUp, ThumbsDown, Meh, Calendar, MapPin, Search, Filter, X } from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { motion, AnimatePresence } from 'framer-motion';

const StatCard = ({ title, value, icon: Icon, color, subtitle }) => (
  <div className="surface-card" style={{ padding: '2rem', display: 'flex', alignItems: 'center', gap: '1.5rem', background: 'white', borderRadius: '32px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
    <div style={{ width: '64px', height: '64px', background: `${color}15`, color: color, borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon size={32} />
    </div>
    <div style={{ flex: 1 }}>
      <p style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 800, margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</p>
      <h3 style={{ fontSize: '2.5rem', fontWeight: 900, margin: '0.25rem 0', color: '#0f172a' }}>{value}</h3>
      {subtitle && <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, fontWeight: 600 }}>{subtitle}</p>}
    </div>
  </div>
);

const SurveyStatsCard = ({ sent, answered }) => {
  const completion = sent > 0 ? ((answered / sent) * 100) : 0;
  
  // Circular Ring parameters (Highly compact size)
  const radius = 22;
  const stroke = 4;
  const normalizedRadius = radius - stroke;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (completion / 100) * circumference;

  return (
    <div className="surface-card" style={{ padding: '1.25rem 1rem', display: 'flex', flexDirection: 'column', background: 'white', borderRadius: '32px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', justifyContent: 'center' }}>
      <p style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 800, margin: '0 0 0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Encuestas
      </p>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'space-between' }}>
        {/* Left Side: Sent & Answered */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <div>
            <p style={{ fontSize: '0.6rem', color: '#94a3b8', fontWeight: 800, margin: 0, textTransform: 'uppercase' }}>Enviadas</p>
            <h3 style={{ fontSize: '1.6rem', fontWeight: 900, margin: '0.1rem 0 0', color: '#0f172a', letterSpacing: '-0.02em' }}>{sent}</h3>
          </div>
          <div style={{ width: '1px', height: '30px', background: '#e2e8f0' }}></div>
          <div>
            <p style={{ fontSize: '0.6rem', color: '#94a3b8', fontWeight: 800, margin: 0, textTransform: 'uppercase' }}>Respondidas</p>
            <h3 style={{ fontSize: '1.6rem', fontWeight: 900, margin: '0.1rem 0 0', color: '#0f172a', letterSpacing: '-0.02em' }}>{answered}</h3>
          </div>
        </div>
        
        {/* Separator Vertical */}
        <div style={{ width: '1px', height: '36px', background: '#e2e8f0' }}></div>
        
        {/* Right Side: Circular Ring and text */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <div style={{ position: 'relative', width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg height="44" width="44" style={{ transform: 'rotate(-90deg)' }}>
              <circle
                stroke="#f1f5f9"
                fill="transparent"
                strokeWidth={stroke}
                r={normalizedRadius}
                cx="22"
                cy="22"
              />
              <circle
                stroke="#10b981"
                fill="transparent"
                strokeWidth={stroke}
                strokeDasharray={circumference + ' ' + circumference}
                style={{ strokeDashoffset, transition: 'stroke-dashoffset 0.5s ease' }}
                r={normalizedRadius}
                cx="22"
                cy="22"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div>
            <p style={{ fontSize: '0.55rem', color: '#94a3b8', fontWeight: 800, margin: 0, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
              % Completación
            </p>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 900, margin: '0.1rem 0 0', color: '#0f172a', letterSpacing: '-0.02em' }}>
              {completion.toFixed(2)}%
            </h3>
          </div>
        </div>
      </div>
    </div>
  );
};

const SurveyResponseCard = ({ r }) => {
  const [showRatings, setShowRatings] = useState(false);
  
  const RatingPill = ({ label, score }) => {
    if (score == null || score === 0 || score === 'N/A') return null;
    const isGood = score >= 9;
    const isWarning = score >= 7 && score < 9;
    const color = isGood ? '#10b981' : (isWarning ? '#f59e0b' : '#ef4444');
    return (
      <div style={{ padding: '0.75rem 1.25rem', background: '#fff', borderRadius: '12px', border: '1px solid #f1f5f9', display: 'flex', gap: '1rem', alignItems: 'center', justifyContent: 'space-between', flex: '1 1 120px' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b' }}>{label}</span>
        <span style={{ fontSize: '0.85rem', fontWeight: 900, color: color }}>{score}/10</span>
      </div>
    );
  };

  return (
    <div style={{ padding: '1.5rem', background: '#ffffff', borderRadius: '24px', border: '1px solid #f1f5f9', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 900, color: '#0f172a' }}>{r.client_name || 'Cliente'}</span>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <Calendar size={12} /> {new Date(r.created_at).toLocaleDateString()}
            </span>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#7c3aed', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <MapPin size={12} /> {r.salon_name || 'San Vicente'}
            </span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
           <p style={{ margin: 0, fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>NPS Personal</p>
           <span style={{ 
             fontSize: '1.1rem', fontWeight: 900, 
             color: r.personalNps > 70 ? '#10b981' : r.personalNps > 30 ? '#f59e0b' : '#ef4444'
           }}>
             {r.personalNps}%
           </span>
        </div>
      </div>
      <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '14px', border: '1px solid #f1f5f9' }}>
        <p style={{ margin: 0, fontWeight: 600, color: '#334155', fontStyle: 'italic' }}>{r.q6 ? `"${r.q6}"` : 'Sin comentarios.'}</p>
        {r.q9 && <p style={{ margin: '0.5rem 0 0 0', fontWeight: 600, color: '#334155', fontStyle: 'italic' }}>{`"${r.q9}"`}</p>}
      </div>
      <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.7rem', fontWeight: 700, color: '#64748b', flexWrap: 'wrap' }}>
          {r.staff_peluquera && r.staff_peluquera !== 'N/A' && <span>Peluquera: <strong style={{ color: '#0f172a' }}>{r.staff_peluquera}</strong></span>}
          {r.staff_lava_pelo && r.staff_lava_pelo !== 'N/A' && <span>Lava Pelo: <strong style={{ color: '#0f172a' }}>{r.staff_lava_pelo}</strong></span>}
          {r.staff_manicurista && r.staff_manicurista !== 'N/A' && <span>Manicurista: <strong style={{ color: '#0f172a' }}>{r.staff_manicurista}</strong></span>}
        </div>
        <button 
          onClick={() => setShowRatings(!showRatings)}
          style={{ background: 'none', border: 'none', color: '#7c3aed', fontWeight: 800, fontSize: '0.75rem', cursor: 'pointer', outline: 'none' }}
        >
          {showRatings ? 'Ocultar Calificaciones' : 'Ver Calificaciones'}
        </button>
      </div>
      {showRatings && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }} 
          animate={{ opacity: 1, y: 0 }}
          style={{ marginTop: '1.5rem', padding: '1rem', background: '#f8fafc', borderRadius: '16px', border: '1px solid #f1f5f9', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}
        >
          <RatingPill label="Exp. General" score={r.q1} />
          <RatingPill label="Recomendación" score={r.q7} />
          <RatingPill label="Tiempo Espera" score={r.q8} />
          <RatingPill label="Resultado Final" score={r.q2} />
          <RatingPill label="Peluquera" score={r.q3} />
          <RatingPill label="Lava Pelo" score={r.q4} />
          <RatingPill label="Manicurista" score={r.q5} />
        </motion.div>
      )}
    </div>
  );
};
const AdminSurveys = () => {
  const [stats, setStats] = useState({ nps: 0, npsPerQuestion: {}, averages: {}, total: 0, raw: [], sent_count: 0, answered_count: 0 });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    salonId: 'all',
    staffName: '',
    clientId: ''
  });
  const [salons, setSalons] = useState([]);
  const [employees, setEmployees] = useState([]);

  useEffect(() => {
    fetchInitialData();
  }, []);

  useEffect(() => {
    fetchStats();
  }, [filters]);

  const fetchInitialData = async () => {
    try {
      const [s, e] = await Promise.all([
        dataService.getSalons(),
        dataService.getEmployees()
      ]);
      setSalons(s || []);
      setEmployees(e || []);
    } catch (err) {
      console.error("Error loading filters:", err);
    }
  };

  const fetchStats = async () => {
    setLoading(true);
    try {
      const s = await dataService.getSurveyStats(filters);
      setStats({
        nps: s?.nps ?? 0,
        npsPerQuestion: s?.npsPerQuestion || {},
        averages: s?.averages || {},
        total: s?.total || 0,
        sent_count: s?.sent_count ?? 0,
        answered_count: s?.answered_count ?? 0,
        raw: s?.raw || []
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (e) => {
    setFilters({ ...filters, [e.target.name]: e.target.value });
  };

  const resetFilters = () => {
    setFilters({
      startDate: '',
      endDate: '',
      salonId: 'all',
      staffName: '',
      clientId: ''
    });
  };

  const getScore = (obj, id) => obj?.[id] ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h2 className="page-title">Business Intelligence: Satisfacción</h2>
          <p className="page-subtitle">Analítica granular por pregunta, empleado y fecha</p>
        </div>
        <div style={{ padding: '0.5rem 1rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '0.8rem', fontWeight: 700, color: '#64748b' }}>
           Actualizado: {new Date().toLocaleTimeString()}
        </div>
      </div>

      {/* Advanced Filter Bar */}
      <div className="surface-card" style={{ padding: '2rem', background: 'white', borderRadius: '32px', border: '1px solid #f1f5f9', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1.5rem', alignItems: 'flex-end' }}>
        <div>
          <label style={{ fontSize: '0.7rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: '0.5rem' }}>Rango Desde</label>
          <div style={{ position: 'relative' }}>
            <Calendar size={16} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input type="date" name="startDate" value={filters.startDate} onChange={handleFilterChange} className="input-field" style={{ padding: '0.75rem 1rem 0.75rem 2.5rem' }} />
          </div>
        </div>
        <div>
          <label style={{ fontSize: '0.7rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: '0.5rem' }}>Rango Hasta</label>
          <div style={{ position: 'relative' }}>
            <Calendar size={16} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input type="date" name="endDate" value={filters.endDate} onChange={handleFilterChange} className="input-field" style={{ padding: '0.75rem 1rem 0.75rem 2.5rem' }} />
          </div>
        </div>
        <div>
          <label style={{ fontSize: '0.7rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: '0.5rem' }}>Localidad / Sede</label>
          <div style={{ position: 'relative' }}>
            <MapPin size={16} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <select name="salonId" value={filters.salonId} onChange={handleFilterChange} className="input-field" style={{ padding: '0.75rem 1rem 0.75rem 2.5rem' }}>
              <option value="all">Todas las Sedes</option>
              {salons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label style={{ fontSize: '0.7rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: '0.5rem' }}>Empleado / Staff</label>
          <div style={{ position: 'relative' }}>
            <Users size={16} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <select 
              name="staffName" 
              value={filters.staffName} 
              onChange={handleFilterChange} 
              className="input-field" 
              style={{ padding: '0.75rem 1rem 0.75rem 2.5rem' }}
            >
              <option value="">Todos los Empleados</option>
              {employees.map((e, idx) => (
                <option key={idx} value={e.nombre || e.name}>{e.nombre || e.name}</option>
              ))}
            </select>
          </div>
        </div>
        <button onClick={resetFilters} style={{ padding: '0.75rem', borderRadius: '12px', border: '1px solid #f1f5f9', background: '#f8fafc', fontWeight: 800, color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
          <X size={16} /> Limpiar
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '5rem', textAlign: 'center' }}>
          <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}>
            <Filter size={48} color="#cbd5e1" style={{ margin: '0 auto 1.5rem' }} />
          </motion.div>
          <p style={{ fontWeight: 800, color: '#94a3b8' }}>Procesando datos...</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
            <StatCard title="NPS GLOBAL" value={`${stats.nps}%`} icon={Target} color="#7c3aed" subtitle={`De ${stats.total} encuestas`} />
            <StatCard title="PROM. SATISFACCIÓN" value={`${getScore(stats.averages, 'q1')}/10.0`} icon={Star} color="#f59e0b" subtitle="Experiencia General" />
            <StatCard title="ÍNDICE RECOMENDACIÓN" value={`${getScore(stats.npsPerQuestion, 'q7')}%`} icon={ThumbsUp} color="#10b981" subtitle="NPS Detallado" />
            <SurveyStatsCard sent={stats.sent_count} answered={stats.answered_count} />
          </div>

          <div className="surface-card" style={{ padding: '2.5rem', background: 'white', borderRadius: '40px', overflow: 'hidden' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 900, marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <TrendingUp size={24} color="#7c3aed" /> Desglose Individual por Pregunta
            </h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '2px solid #f1f5f9' }}>
                    <th style={{ padding: '1rem', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase' }}>Dimensión</th>
                    <th style={{ padding: '1rem', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase' }}>Promedio</th>
                    <th style={{ padding: '1rem', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase' }}>NPS</th>
                    <th style={{ padding: '1rem', color: '#64748b', fontSize: '0.75rem', textTransform: 'uppercase' }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { id: 'q1', label: '1. Experiencia General' },
                    { id: 'q7', label: '2. Recomendación' },
                    { id: 'q8', label: '3. Tiempo de Espera' },
                    { id: 'q2', label: '4. Resultado' },
                    { id: 'q3', label: '5. Peluquera' },
                    { id: 'q4', label: '6. Lava Pelo' },
                    { id: 'q5', label: '7. Manicurista' }
                  ].map((q) => {
                    const npsVal = getScore(stats.npsPerQuestion, q.id);
                    const avgVal = getScore(stats.averages, q.id);
                    const hasAnswers = avgVal !== 0 && avgVal !== '0' && avgVal !== '0.0';
                    return (
                      <tr key={q.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '1.25rem 1rem', fontWeight: 800 }}>{q.label}</td>
                        <td style={{ padding: '1.25rem 1rem' }}>
                          {hasAnswers ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontWeight: 900 }}>{avgVal}</span>
                              <div style={{ width: '60px', height: '6px', background: '#f1f5f9', borderRadius: '3px', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${(avgVal/10)*100}%`, background: '#f59e0b' }} />
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: '#94a3b8', fontWeight: 700 }}>---</span>
                          )}
                        </td>
                        <td style={{ padding: '1.25rem 1rem' }}>
                          {hasAnswers ? (
                            <span style={{ 
                              padding: '0.4rem 0.8rem', borderRadius: '8px', fontWeight: 900,
                              background: npsVal > 70 ? '#ecfdf5' : npsVal > 30 ? '#fffbeb' : '#fef2f2',
                              color: npsVal > 70 ? '#059669' : npsVal > 30 ? '#d97706' : '#ef4444'
                            }}>
                              {npsVal}%
                            </span>
                          ) : (
                            <span style={{ color: '#94a3b8', fontWeight: 700 }}>---</span>
                          )}
                        </td>
                        <td style={{ padding: '1.25rem 1rem', fontSize: '0.8rem', fontWeight: 600 }}>
                          {hasAnswers ? (
                            npsVal > 70 ? '💎 Excelente' : npsVal > 30 ? '✅ Bueno' : '⚠️ Crítico'
                          ) : (
                            <span style={{ color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                              ⚪ Sin respuestas
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="surface-card" style={{ padding: '2.5rem', background: 'white', borderRadius: '40px' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 900, marginBottom: '2rem' }}>Explorador de Respuestas</h3>
            <div style={{ display: 'grid', gap: '1rem' }}>
              {stats.raw.map((r, i) => (
                <SurveyResponseCard key={i} r={r} />
              ))}
              {stats.raw.length === 0 && <p style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem' }}>No hay respuestas con estos filtros.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AdminSurveys;
