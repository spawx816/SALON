import React, { useState, useEffect } from 'react';
import { Zap, CheckCircle2, Clock, ChevronRight } from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useAuth } from '../../context/AuthContext';

const ClientServices = () => {
  const { user } = useAuth();
  const [contract, setContract] = useState(null);
  const [usageStats, setUsageStats] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const c = await dataService.getClientContract(user.id);
        setContract(c);
        if (c) {
          // Simplified usage parsing logic similar to dashboard
          const services = JSON.parse(c.contract_services || '[]');
          const stats = services.map(s => ({ name: s, quota: 4, used: 0 })); // Mocked for now
          setUsageStats(stats);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [user.id]);

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}>Cargando tus servicios...</div>;

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
      <div style={{ marginBottom: '2.5rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 900, marginBottom: '0.5rem' }}>Mis Servicios</h1>
        <p style={{ color: 'var(--text-secondary)' }}>Gestiona y visualiza el estado de tus beneficios activos.</p>
      </div>

      {!contract ? (
        <div className="surface-card" style={{ textAlign: 'center', padding: '3rem' }}>
          <Zap size={48} color="#a1a1aa" style={{ marginBottom: '1.5rem' }} />
          <h3>No tienes servicios activos</h3>
          <p>Adquiere un plan para ver tus beneficios aquí.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1.5rem' }}>
          {usageStats.map((stat, i) => (
            <div key={i} className="surface-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: '#09090b', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                  <Zap size={24} />
                </div>
                <div>
                  <h3 style={{ fontWeight: 800, margin: 0 }}>{stat.name}</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0.2rem 0 0' }}>Plan {contract.plan_name}</p>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: '1.25rem', fontWeight: 900, margin: 0 }}>{stat.used} / {stat.quota}</p>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 700, textTransform: 'uppercase' }}>Consumidos</p>
              </div>
            </div>
          ))}

          <div className="surface-card" style={{ padding: '1.5rem', background: '#f8fafc', border: '1px dashed var(--border-subtle)' }}>
             <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--text-secondary)' }}>
                <Clock size={18} />
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Tus servicios se reiniciarán el próximo {new Date(contract.next_billing_date).toLocaleDateString()}</span>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientServices;
