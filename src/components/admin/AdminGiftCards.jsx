import React, { useState, useEffect } from 'react';
import { Gift, Search, CheckCircle, Clock, XCircle, CreditCard, Filter, Download } from 'lucide-react';

const AdminGiftCards = () => {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCard, setSelectedCard] = useState(null);
  const [redeemAmount, setRedeemAmount] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const fetchCards = async () => {
    try {
      const res = await fetch('/api/admin/gifts');
      const data = await res.json();
      setCards(data);
    } catch (err) {
      console.error('Error fetching cards:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCards();
  }, []);

  const handleRedeem = async () => {
    if (!selectedCard || !redeemAmount) return;
    if (Number(redeemAmount) > Number(selectedCard.balance)) {
      alert("El monto supera el saldo disponible.");
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/gifts/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: selectedCard.code, amount: redeemAmount })
      });
      const data = await res.json();
      if (res.ok) {
        alert("¡Tarjeta canjeada exitosamente!");
        setSelectedCard(null);
        setRedeemAmount('');
        fetchCards();
      } else {
        alert("Error: " + data.error);
      }
    } catch (err) {
      alert("Error al procesar el canje.");
    } finally {
      setActionLoading(false);
    }
  };

  const filteredCards = cards.filter(c => 
    c.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.recipient_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.purchaser_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusBadge = (status) => {
    switch(status) {
      case 'Active': return <span className="badge badge-active" style={{ background: '#ecfdf5', color: '#059669' }}>Activa</span>;
      case 'Partially_Redeemed': return <span className="badge badge-active" style={{ background: '#fffbeb', color: '#d97706' }}>Saldo Parcial</span>;
      case 'Redeemed': return <span className="badge badge-inactive" style={{ background: '#f8fafc', color: '#64748b' }}>Agotada</span>;
      default: return <span className="badge">{status}</span>;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div className="dashboard-header">
        <div>
          <h2 className="dashboard-title">Gestión de Gift Cards</h2>
          <p className="dashboard-subtitle">Monitorea y canjea los certificados de regalo generados.</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <div className="search-bar" style={{ width: '300px' }}>
            <Search size={18} />
            <input 
              type="text" 
              placeholder="Buscar por código o nombre..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button className="btn-secondary" style={{ borderRadius: '12px' }}>
            <Download size={18} />
            <span>Exportar</span>
          </button>
        </div>
      </div>

      <div className="admin-split-layout" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '2rem' }}>
        <div className="surface-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-container hide-scrollbar" style={{ maxHeight: '600px', overflowY: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: '1.5rem' }}>Código</th>
                  <th>Beneficiario</th>
                  <th>Comprado por</th>
                  <th>Saldo</th>
                  <th>Estado</th>
                  <th style={{ paddingRight: '1.5rem' }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="6" style={{ textAlign: 'center', padding: '3rem' }}>Cargando registros...</td></tr>
                ) : filteredCards.length === 0 ? (
                  <tr><td colSpan="6" style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>No se han encontrado tarjetas de regalo generadas.</td></tr>
                ) : filteredCards.map(card => (
                  <tr key={card.id}>
                    <td style={{ paddingLeft: '1.5rem' }}><strong style={{ fontFamily: 'monospace', color: '#d4af37', fontSize: '1rem' }}>{card.code}</strong></td>
                    <td>{card.recipient_name}</td>
                    <td>{card.purchaser_name || 'Anónimo'}</td>
                    <td><strong>RD$ {Number(card.balance).toLocaleString()}</strong> <br/> <small style={{ color: '#94a3b8' }}>de RD$ {Number(card.amount).toLocaleString()}</small></td>
                    <td>{getStatusBadge(card.status)}</td>
                    <td style={{ paddingRight: '1.5rem' }}>
                      {(card.status === 'Active' || card.status === 'Partially_Redeemed') && (
                        <button 
                          onClick={() => setSelectedCard(card)}
                          className="btn-primary" 
                          style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem', borderRadius: '8px', background: '#09090b' }}
                        >
                          Canjear
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          {selectedCard ? (
            <div className="surface-card" style={{ border: '2px solid #09090b', position: 'sticky', top: '2rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 900, marginBottom: '1.5rem' }}>Procesar Canje</h3>
              
              <div style={{ background: '#f8fafc', padding: '1.5rem', borderRadius: '16px', marginBottom: '1.5rem', border: '1px solid #e2e8f0' }}>
                <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>TARJETA SELECCIONADA</p>
                <p style={{ fontSize: '1.5rem', fontWeight: 900, color: '#d4af37', margin: 0, letterSpacing: '0.1em' }}>{selectedCard.code}</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                  <span>Saldo Disponible:</span>
                  <strong style={{ color: '#059669' }}>RD$ {Number(selectedCard.balance).toLocaleString()}</strong>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700 }}>Monto a descontar (RD$)</label>
                  <input 
                    type="number"
                    className="input-field"
                    value={redeemAmount}
                    onChange={(e) => setRedeemAmount(e.target.value)}
                    placeholder="Ej. 500"
                    autoFocus
                  />
                </div>
                <button 
                  onClick={handleRedeem}
                  disabled={actionLoading}
                  className="btn-primary" 
                  style={{ width: '100%', padding: '1rem', borderRadius: '14px', background: 'linear-gradient(135deg, #09090b 0%, #27272a 100%)', marginTop: '1rem' }}
                >
                  {actionLoading ? 'Procesando...' : 'Confirmar Canje'}
                </button>
                <button 
                  onClick={() => setSelectedCard(null)}
                  style={{ width: '100%', background: 'none', border: 'none', color: '#64748b', fontWeight: 700, cursor: 'pointer' }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="surface-card" style={{ textAlign: 'center', padding: '3rem', border: '2px dashed #e2e8f0', background: 'none' }}>
              <div style={{ background: '#f8fafc', width: '60px', height: '60px', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
                <CreditCard size={24} color="#94a3b8" />
              </div>
              <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Selecciona una tarjeta de la lista para procesar un canje o abono.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminGiftCards;
