import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { Users, TrendingUp, DollarSign, CalendarCheck, MoreHorizontal, ArrowUpRight, ShieldCheck, Award, User, X } from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useTranslation } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';

const data = [
  { name: 'Mon', visits: 0 },
  { name: 'Tue', visits: 0 },
  { name: 'Wed', visits: 0 },
  { name: 'Thu', visits: 0 },
  { name: 'Fri', visits: 0 },
  { name: 'Sat', visits: 0 },
  { name: 'Sun', visits: 0 },
];

const MetricCard = ({ title, value, trend, icon: Icon, color = '#09090b', bg = '#f8fafc' }) => (
  <div className="surface-card" style={{ border: '1px solid var(--border-subtle)', boxShadow: '0 4px 12px rgba(0,0,0,0.03)', position: 'relative', overflow: 'hidden' }}>
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '4px', background: color }}></div>
    <div className="metric-header" style={{ marginBottom: '1.25rem' }}>
      <div className="metric-icon" style={{ background: bg, border: 'none', width: '40px', height: '40px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={20} strokeWidth={2.5} color={color} />
      </div>
      {trend && (
        <div className="metric-trend" style={{ fontWeight: 800, background: bg, color: color, padding: '0.2rem 0.6rem', borderRadius: '20px', fontSize: '0.65rem' }}>
          {trend}
        </div>
      )}
    </div>
    <div>
      <p className="metric-title" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', fontWeight: 800 }}>{title}</p>
      <h3 className="metric-value" style={{ fontSize: '2rem', marginTop: '0.25rem', letterSpacing: '-0.02em', fontWeight: 900 }}>{value}</h3>
    </div>
  </div>
);

const Dashboard = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();

  // Permisos: Si no tiene view_analytics, redirigir o mostrar acceso denegado
  const hasAccess = currentUser?.role === 'admin' || 
                    currentUser?.role_name === 'Administrador' || 
                    (currentUser?.permissions && currentUser?.permissions.view_analytics);

  const [stats, setStats] = useState({ todayVisits: 0, activeClients: 0, monthlyRevenue: 0, dailySales: 0 });
  const [recentVisits, setRecentVisits] = useState([]);
  const [allVisits, setAllVisits] = useState([]);
  const [planUsages, setPlanUsages] = useState([]);
  const [trafficData, setTrafficData] = useState([]);
  const [securityRequests, setSecurityRequests] = useState([]);
  const [isVisitsModalOpen, setIsVisitsModalOpen] = useState(false);
  const [loadingVisits, setLoadingVisits] = useState(false);

  const handleViewAllVisits = async () => {
    setIsVisitsModalOpen(true);
    setLoadingVisits(true);
    try {
      const visits = await dataService.getVisits();
      setAllVisits(visits);
    } catch (e) {
      console.error("Error al obtener visitas", e);
    } finally {
      setLoadingVisits(false);
    }
  };

  useEffect(() => {
    if (!hasAccess) {
      // Si no tiene acceso, lo mandamos a la gestión de visitas por defecto
      navigate('/visitas');
      return;
    }

    const load = async () => {
      const summary = await dataService.getDashboardSummary();
      const usages = await dataService.getPlanUsages();
      if (summary) {
        setStats({
          visits: summary.metrics.todayVisits,
          clients: summary.metrics.activeClients,
          revenue: summary.metrics.monthlyRevenue,
          dailySales: summary.metrics.dailySales
        });
        setRecentVisits(summary.recentVisits);
        setAllVisits(summary.recentVisits);
        if (summary.weeklyTraffic && summary.weeklyTraffic.length > 0) {
          const chartData = summary.weeklyTraffic.map(day => ({
            name: new Date(day.date).toLocaleDateString(undefined, { weekday: 'short' }),
            visits: day.count,
            revenue: day.count
          }));
          setTrafficData(chartData);
        }
      }
      setPlanUsages(usages);
    };

    const fetchSecurity = async () => {
      const security = await dataService.getSecurityRequests();
      setSecurityRequests(security);
    };

    load();
    fetchSecurity();
    
    // Auto-refresh security requests every 10 seconds
    const interval = setInterval(fetchSecurity, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleExport = async () => {
    try {
      // 1. Obtener todas las visitas históricas del servidor
      const visits = await dataService.getVisits();
      if (!visits || visits.length === 0) {
        alert("No hay visitas para exportar.");
        return;
      }

      // 2. Obtener todas las sucursales para mapear sus nombres
      const salonsMap = new Map();
      try {
        const salonsList = await dataService.getSalons();
        if (salonsList && Array.isArray(salonsList)) {
          salonsList.forEach(s => salonsMap.set(s.id?.toString(), s.name));
        }
      } catch (err) {
        console.error("Error cargando sucursales para exportación:", err);
      }

      // 3. Cabeceras claras, profesionales e inteligibles
      const headers = [
        "ID de Visita",
        "Nombre del Cliente",
        "Fecha de la Visita",
        "Servicios Prestados",
        "Estilista / Peluquera",
        "Manicurista",
        "Monto Facturado (RD$)",
        "Sucursal / Localidad",
        "Próxima Cita Planificada",
        "Recordatorio Enviado"
      ];

      // 4. Mapear filas con formatos limpios y medibles
      const rows = visits.map(v => {
        const visitedDate = v.visited_at ? new Date(v.visited_at) : null;
        const formattedDate = visitedDate 
          ? `${visitedDate.getFullYear()}-${String(visitedDate.getMonth() + 1).padStart(2, '0')}-${String(visitedDate.getDate()).padStart(2, '0')} ${String(visitedDate.getHours()).padStart(2, '0')}:${String(visitedDate.getMinutes()).padStart(2, '0')}`
          : 'N/A';

        const nextDate = v.proxima_fecha ? new Date(v.proxima_fecha) : null;
        const formattedNextDate = nextDate
          ? `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`
          : 'Sin programar';

        // Valores numéricos limpios para que Excel pueda sumarlos
        const totalFormatted = v.total ? Number(v.total).toFixed(2) : '0.00';
        const recordatorioText = v.recordatorio_auto === 1 || v.recordatorio_auto === true ? "Sí" : "No";
        const sucursalName = salonsMap.get(v.salon_id?.toString()) || v.salon_name || "Sede Central";

        return [
          v.id,
          v.client_name || v.clientName || "Cliente Desconocido",
          formattedDate,
          Array.isArray(v.servicios) ? v.servicios.join(' + ') : (v.servicios || 'Ninguno'),
          v.empleado_peluquera || 'No asignada',
          v.empleado_manicurista || 'No asignada',
          totalFormatted,
          sucursalName,
          formattedNextDate,
          recordatorioText
        ];
      });

      // 5. Generar CSV con punto y coma (;) como delimitador estándar para Excel en español
      const csvContent = [headers, ...rows].map(e => e.map(val => {
        const cleaned = String(val ?? '').replace(/"/g, '""');
        return `"${cleaned}"`;
      }).join(";")).join("\n");

      // 6. Añadir el BOM de UTF-8 (\uFEFF) para evitar que se rompan las tildes/eñes en Excel
      const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `reporte_visitas_completo_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Error al exportar reporte:", err);
      alert("Hubo un error al generar el reporte de exportación.");
    }
  };

  return (
    <div>
      <div className="dashboard-header" style={{ alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
             <h2 className="dashboard-title">{t('dash.title')}</h2>
             <span className="badge badge-active" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>Abatte San Vicente</span>
          </div>
          <p className="dashboard-subtitle">Bienvenido al panel central de PlanBeautyRD.</p>
        </div>
        <div className="dashboard-actions">
          <button className="btn-secondary" style={{ borderRadius: '12px' }} onClick={handleExport}>{t('dash.btn.export')}</button>
          <button className="btn-primary" style={{ borderRadius: '12px', background: 'linear-gradient(135deg, #09090b 0%, #27272a 100%)' }} onClick={() => navigate('/visitas')}>{t('dash.btn.new')}</button>
        </div>
      </div>

      <div className="metrics-grid">
        <MetricCard title="Visitas de Hoy" value={stats.visits || 0} trend="Real-time" icon={CalendarCheck} color="#3b82f6" bg="#eff6ff" />
        <MetricCard title="Membresías Activas" value={stats.clients || 0} trend="Live" icon={Users} color="#10b981" bg="#ecfdf5" />
        <MetricCard title="Ventas Diarias" value={`RD$ ${stats.dailySales ? Number(stats.dailySales).toLocaleString(undefined, {maximumFractionDigits:0}) : '0'}`} trend="Hoy" icon={TrendingUp} color="#8b5cf6" bg="#f5f3ff" />
        <MetricCard title="Ingresos Estimados" value={`RD$ ${stats.revenue ? Number(stats.revenue).toLocaleString() : '0'}`} trend="Monthly" icon={DollarSign} color="#09090b" bg="#f1f5f9" />
      </div>

      <div className="dashboard-split">
        {/* Main Chart */}
        <div className="surface-card" style={{ display: 'flex', flexDirection: 'column', height: '400px' }}>
          <div className="chart-header">
            <div>
              <h3 className="chart-title">{t('dash.chart.title')}</h3>
              <p className="chart-subtitle">{t('dash.chart.subtitle')}</p>
            </div>
            <button className="icon-btn" style={{ border: 'none' }}><MoreHorizontal size={20} /></button>
          </div>
          <div style={{ flex: 1, width: '100%', height: '300px', minHeight: '300px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trafficData.length > 0 ? trafficData : data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#71717a', fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#71717a', fontSize: 12}} />
                <Tooltip 
                  labelStyle={{ fontWeight: 800, color: '#09090b' }}
                  contentStyle={{ borderRadius: '12px', border: '1px solid #e4e4e7', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  cursor={{stroke: '#e4e4e7', strokeWidth: 2, strokeDasharray: '4 4'}}
                  formatter={(value) => [`${value} Visitas`, 'Tráfico']}
                />
                <Area type="monotone" dataKey="visits" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorRevenue)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Traffic */}
        <div className="surface-card" style={{ overflowY: 'auto', height: '400px' }}>
          <div className="chart-header" style={{ marginBottom: '1rem' }}>
            <h3 className="chart-title">{t('dash.recent.title')}</h3>
            <button onClick={handleViewAllVisits} style={{ border: 'none', background: 'none', cursor: 'pointer', fontWeight: '600', color: '#71717a' }}>{t('dash.recent.all')}</button>
          </div>
          <div className="visits-list">
            {recentVisits.length > 0 ? recentVisits.map((visit, idx) => (
              <div key={idx} className="visit-item" style={{ padding: '0.75rem 0', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div className="visit-avatar" style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#f1f5f9', color: '#09090b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', fontWeight: 800, border: '1px solid #e2e8f0' }}>
                  {(visit.client_name || visit.clientName)?.charAt(0) || <User size={18} />}
                </div>
                <div className="visit-details" style={{ flex: 1 }}>
                  <p className="visit-name" style={{ fontSize: '0.875rem', fontWeight: 800, color: '#09090b', marginBottom: '0.1rem' }}>{visit.client_name || visit.clientName || 'Cliente'}</p>
                  <p className="visit-service" style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 500 }}>
                    {Array.isArray(visit.servicios) ? visit.servicios.join(', ') : (typeof visit.servicios === 'string' ? visit.servicios : t('dash.service.fallback'))}
                  </p>
                </div>
                <div className="visit-meta" style={{ textAlign: 'right' }}>
                  <p className="visit-date" style={{ fontWeight: 800, fontSize: '0.8rem', color: '#09090b' }}>{new Date(visit.visited_at).toLocaleTimeString(undefined, {hour: '2-digit', minute:'2-digit'})}</p>
                  <p className="visit-status" style={{ fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>{visit.salon_name || 'Central'}</p>
                </div>
              </div>
            )) : (
              <div style={{ textAlign: 'center', padding: '2rem 0', color: '#71717a', fontSize: '0.875rem' }}>{t('dash.recent.empty')}</div>
            )}
          </div>
        </div>
      </div>

      {/* Security Requests Section */}
      {(securityRequests.length > 0 || (currentUser?.role === 'admin' || currentUser?.role_name === 'Administrador')) && (
        <div className="surface-card" style={{ marginTop: '2rem', border: '1px solid #e2e8f0', background: 'white' }}>
          <div className="chart-header" style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
               <div style={{ background: '#09090b', color: 'white', padding: '0.5rem', borderRadius: '12px' }}>
                 <Users size={18} />
               </div>
               <div>
                 <h3 className="chart-title">Monitor de Seguridad</h3>
                 <p className="chart-subtitle">Códigos activos para autorizar servicios en recepción.</p>
               </div>
            </div>
            <button 
              onClick={async () => {
                const security = await dataService.getSecurityRequests();
                setSecurityRequests(security);
              }}
              style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '0.5rem 1rem', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 700, color: '#09090b', cursor: 'pointer' }}
            >
              🔄 Sincronizar
            </button>
          </div>
          
          {securityRequests.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
              {securityRequests.map((req, idx) => (
                <div key={idx} style={{ background: '#fafafa', padding: '1.5rem', borderRadius: '24px', border: '1px solid #f1f5f9', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1.25rem' }}>
                     <div>
                       <p style={{ fontSize: '1rem', fontWeight: 900, margin: 0, color: '#09090b' }}>{req.client_name}</p>
                       <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0.25rem 0 0', fontWeight: 500 }}>Solicitado: {new Date(req.created_at).toLocaleTimeString()}</p>
                     </div>
                     <span style={{ fontSize: '0.65rem', fontWeight: 800, background: '#fefce8', color: '#a16207', padding: '0.4rem 0.75rem', borderRadius: '8px', border: '1px solid #fef08a' }}>PENDIENTE</span>
                  </div>
                  <div style={{ background: 'white', padding: '1rem', borderRadius: '16px', border: '1px solid #f1f5f9', marginBottom: '1.25rem' }}>
                     <p style={{ fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', marginBottom: '0.4rem', textTransform: 'uppercase' }}>Servicio Solicitado</p>
                     <p style={{ fontSize: '0.85rem', fontWeight: 700, margin: 0, color: '#1e293b' }}>{req.service_name}</p>
                  </div>
                  <div style={{ textAlign: 'center', padding: '1.25rem', background: '#09090b', borderRadius: '18px', boxShadow: '0 10px 20px rgba(0,0,0,0.1)' }}>
                     <p style={{ fontSize: '0.65rem', fontWeight: 800, color: 'rgba(255,255,255,0.4)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Código para Recepción</p>
                     <p style={{ fontSize: '2rem', fontWeight: 900, color: '#d4af37', letterSpacing: '6px', margin: 0, fontFamily: 'monospace' }}>
                       {req.active_code}
                     </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '4rem 2rem', background: '#f8fafc', borderRadius: '24px', border: '1px dashed #cbd5e1' }}>
               <div style={{ width: '64px', height: '64px', background: '#f1f5f9', borderRadius: '50%', margin: '0 auto 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
                 <ShieldCheck size={32} />
               </div>
               <h4 style={{ color: '#334155', fontWeight: 800, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Sistema Seguro</h4>
               <p style={{ color: '#64748b', fontWeight: 500, fontSize: '0.9rem' }}>No hay solicitudes de seguridad activas en este momento.</p>
            </div>
          )}
        </div>
      )}

      {/* Plan Usage Section */}
      <div className="surface-card" style={{ marginTop: '2rem' }}>
        <div className="chart-header" style={{ marginBottom: '1.5rem' }}>
          <div>
            <h3 className="chart-title">Uso de Servicios por Plan</h3>
            <p className="chart-subtitle">Estadísticas de clientes atendidos bajo contratos de suscripción este mes.</p>
          </div>
        </div>
        
        <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {planUsages.length > 0 ? planUsages.map((usage, idx) => (
            <div key={idx} style={{ 
              padding: '1.5rem', 
              border: '1px solid #e2e8f0', 
              borderRadius: '20px',
              backgroundColor: 'white',
              boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)'
            }}>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
                <div style={{ width: '40px', height: '40px', background: '#f8fafc', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#09090b', border: '1px solid #f1f5f9' }}>
                  <Award size={20} />
                </div>
                <div>
                  <h4 style={{ fontWeight: '800', margin: 0, color: '#09090b', fontSize: '1rem' }}>
                    {usage.plan_name}
                  </h4>
                </div>
              </div>
              <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '1.25rem', minHeight: '30px', fontWeight: 500 }}>
                Incluye: {usage.plan_services?.join(', ') || 'N/A'}
              </p>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #f1f5f9' }}>
                  <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#94a3b8', fontWeight: '800', letterSpacing: '0.05em' }}>
                    Clientes
                  </p>
                  <p style={{ fontSize: '1.5rem', fontWeight: '800', color: '#0f172a', marginTop: '0.2rem' }}>
                    {usage.unique_clients_used}
                  </p>
                </div>
                <div style={{ background: '#f0fdf4', padding: '1rem', borderRadius: '12px', border: '1px solid #dcfce7' }}>
                  <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#166534', fontWeight: '800', letterSpacing: '0.05em' }}>
                    Servicios (Visitas)
                  </p>
                  <p style={{ fontSize: '1.5rem', fontWeight: '800', color: '#14532d', marginTop: '0.2rem' }}>
                    {usage.total_visits}
                  </p>
                </div>
              </div>
            </div>
          )) : (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#71717a', gridColumn: '1 / -1' }}>
              No hay clientes que hayan utilizado sus planes este mes.
            </div>
          )}
        </div>
      </div>

             {/* Modal de Visitas */}
      {isVisitsModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(9, 9, 11, 0.6)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', animation: 'fadeIn 0.2s ease-out' }}>
          <div style={{ background: '#fff', borderRadius: '24px', width: '100%', maxWidth: '650px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', overflow: 'hidden' }}>
            
            <div style={{ padding: '1.75rem 2rem', borderBottom: '1px solid rgba(226, 232, 240, 0.8)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(to right, #fafafa, #ffffff)' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '800', color: '#09090b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CalendarCheck size={20} color="#8b5cf6" /> Historial de Visitas
                </h3>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>Registro detallado de todas las visitas recientes</p>
              </div>
              <button 
                onClick={() => setIsVisitsModalOpen(false)} 
                style={{ border: 'none', background: '#f1f5f9', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748b', transition: 'all 0.2s' }}
                onMouseOver={(e) => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.color = '#0f172a'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#64748b'; }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '1rem 2rem', overflowY: 'auto', flex: 1, background: '#fafafa' }}>
              {loadingVisits ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8b5cf6', padding: '3rem' }}>
                  <div className="spinner" style={{ width: '40px', height: '40px', border: '3px solid rgba(139, 92, 246, 0.2)', borderTopColor: '#8b5cf6', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: '1rem' }}></div>
                  <p style={{ fontWeight: 600 }}>Cargando visitas...</p>
                </div>
              ) : allVisits.length > 0 ? (
                <div className="visits-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {allVisits.map((visit, idx) => (
                    <div key={idx} className="visit-item" style={{ background: '#fff', padding: '1.25rem', borderRadius: '16px', border: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '1rem', transition: 'all 0.2s', cursor: 'default', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}
                      onMouseOver={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0,0,0,0.05)'; }}
                      onMouseOut={(e) => { e.currentTarget.style.borderColor = '#f1f5f9'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.02)'; }}
                    >
                      <div className="visit-avatar" style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)', color: '#09090b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', fontWeight: 800, border: '1px solid #e2e8f0' }}>
                        {(visit.client_name || visit.clientName)?.charAt(0).toUpperCase() || <User size={24} color="#94a3b8" />}
                      </div>
                      
                      <div className="visit-details" style={{ flex: 1 }}>
                        <p className="visit-name" style={{ fontSize: '0.95rem', fontWeight: 800, color: '#09090b', margin: '0 0 0.25rem 0' }}>{visit.client_name || visit.clientName || 'Cliente No Registrado'}</p>
                        <p className="visit-service" style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 500, margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#8b5cf6' }}></span>
                          {Array.isArray(visit.servicios) ? visit.servicios.join(', ') : (typeof visit.servicios === 'string' ? visit.servicios : 'Servicio General')}
                        </p>
                      </div>

                      <div className="visit-time" style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
                        <span style={{ display: 'inline-block', padding: '0.25rem 0.6rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 700, color: '#334155' }}>
                          {new Date(visit.visited_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: '#8b5cf6', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {visit.salon_name || 'SUCURSAL'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center', color: '#64748b', padding: '4rem 2rem', background: '#fff', borderRadius: '16px', border: '1px dashed #cbd5e1' }}>
                  <CalendarCheck size={48} color="#cbd5e1" style={{ marginBottom: '1rem' }} />
                  <h4 style={{ margin: '0 0 0.5rem 0', color: '#0f172a', fontSize: '1.1rem' }}>No hay visitas</h4>
                  <p style={{ margin: 0, fontSize: '0.9rem' }}>Aún no se han registrado visitas en el sistema.</p>
                </div>
              )}
            </div>
          </div>
          <style>{`
            @keyframes fadeIn {
              from { opacity: 0; backdrop-filter: blur(0px); }
              to { opacity: 1; backdrop-filter: blur(4px); }
            }
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
