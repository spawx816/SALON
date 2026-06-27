import React, { useState } from 'react';
import { Gift, Search, CheckCircle, X, CreditCard, ArrowRight, ShieldCheck, List } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

const GiftCardValidator = ({ isOpen, onClose }) => {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [card, setCard] = useState(null);
  const [redeemAmount, setRedeemAmount] = useState('');
  const [step, setStep] = useState(1); // 1: Search, 2: Info/Redeem
  const [actionLoading, setActionLoading] = useState(false);
  const navigate = useNavigate();

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!code) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/gifts?code=${code}`);
      const data = await res.json();
      if (data && data.length > 0) {
        setCard(data[0]);
        setStep(2);
        setRedeemAmount('');
      } else {
        alert('Código de tarjeta no encontrado.');
      }
    } catch (err) {
      console.error(err);
      alert('Error al buscar la tarjeta.');
    } finally {
      setLoading(false);
    }
  };

  const handleRedeem = async () => {
    if (!card || !redeemAmount) return;
    if (Number(redeemAmount) > Number(card.balance)) {
      alert("El monto supera el saldo disponible.");
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/gifts/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: card.code, amount: redeemAmount })
      });
      const data = await res.json();
      if (res.ok) {
        alert("¡Monto canjeado exitosamente!");
        // Refresh card info
        const refreshRes = await fetch(`/api/gifts?code=${card.code}`);
        const refreshData = await refreshRes.json();
        setCard(refreshData[0]);
        setRedeemAmount('');
      } else {
        alert("Error: " + data.error);
      }
    } catch (err) {
      alert("Error al procesar el canje.");
    } finally {
      setActionLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="surface-card" 
        style={{ width: '100%', maxWidth: '500px', padding: '2.5rem', borderRadius: '32px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', position: 'relative' }}
      >
        <button onClick={onClose} style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', background: '#f1f5f9', border: 'none', width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748b' }}>
          <X size={20} />
        </button>

        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ width: '64px', height: '64px', background: '#09090b', color: 'white', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}>
            <Gift size={32} />
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 900, color: '#09090b' }}>Validar Gift Card</h2>
          <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '0.5rem' }}>Verifica y canjea certificados de regalo en recepción.</p>
        </div>

        <AnimatePresence mode="wait">
          {step === 1 ? (
            <motion.form 
              key="step1"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              onSubmit={handleSearch} 
              style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em' }}>Código de la Tarjeta</label>
                <div className="search-input-wrapper" style={{ width: '100%' }}>
                  <Search className="icon" size={20} />
                  <input 
                    placeholder="Ej. GC-XXXXXX" 
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    style={{ fontSize: '1.1rem', fontWeight: 700, padding: '1.25rem 1rem 1.25rem 3.5rem' }}
                    autoFocus
                  />
                </div>
              </div>
              <button 
                type="submit" 
                disabled={loading || !code}
                className="btn-primary" 
                style={{ width: '100%', padding: '1.25rem', borderRadius: '18px', fontSize: '1rem', background: 'linear-gradient(135deg, #09090b 0%, #27272a 100%)' }}
              >
                {loading ? 'Buscando...' : 'Verificar Estado'}
              </button>
            </motion.form>
          ) : (
            <motion.div 
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
            >
              <div style={{ background: '#f8fafc', padding: '1.5rem', borderRadius: '24px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                  <div>
                    <p style={{ fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Beneficiario</p>
                    <p style={{ fontWeight: 800, color: '#09090b' }}>{card.recipient_name}</p>
                  </div>
                  <span style={{ fontSize: '0.65rem', fontWeight: 800, background: '#ecfdf5', color: '#059669', padding: '0.4rem 0.75rem', borderRadius: '8px', border: '1px solid #d1fae5' }}>
                    {card.status === 'Active' ? 'ACTIVA' : 'SALDO PARCIAL'}
                  </span>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px dashed #e2e8f0' }}>
                   <div>
                     <p style={{ fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>Saldo Disponible</p>
                     <p style={{ fontSize: '1.75rem', fontWeight: 900, color: '#09090b' }}>RD$ {Number(card.balance).toLocaleString()}</p>
                   </div>
                   <div style={{ textAlign: 'right' }}>
                     <p style={{ fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>Total Original</p>
                     <p style={{ fontWeight: 700, color: '#64748b' }}>RD$ {Number(card.amount).toLocaleString()}</p>
                   </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#94a3b8' }}>Monto a Canjear</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '1.25rem', top: '50%', transform: 'translateY(-50%)', fontWeight: 800, color: '#64748b' }}>RD$</span>
                    <input 
                      type="number" 
                      className="input-field"
                      value={redeemAmount}
                      onChange={(e) => setRedeemAmount(e.target.value)}
                      placeholder="0.00"
                      style={{ paddingLeft: '3.5rem', fontSize: '1.25rem', fontWeight: 800 }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                  <button 
                    onClick={() => { setStep(1); setCard(null); }}
                    className="btn-secondary" 
                    style={{ flex: 1, padding: '1rem', borderRadius: '14px', fontWeight: 700 }}
                  >
                    Volver
                  </button>
                  <button 
                    onClick={handleRedeem}
                    disabled={actionLoading || !redeemAmount || Number(redeemAmount) <= 0}
                    className="btn-primary" 
                    style={{ flex: 2, padding: '1rem', borderRadius: '14px', fontWeight: 800, background: '#09090b' }}
                  >
                    {actionLoading ? 'Procesando...' : 'Confirmar Canje'}
                  </button>
                </div>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center', marginTop: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#059669', fontSize: '0.75rem', fontWeight: 700 }}>
                  <ShieldCheck size={14} />
                  <span>Tarjeta validada correctamente</span>
                </div>
                
                <button 
                  onClick={() => { navigate('/regalos'); onClose(); }}
                  style={{ background: 'none', border: 'none', color: '#d4af37', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Ver historial completo
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {step === 1 && (
          <div style={{ marginTop: '2rem', textAlign: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '1.5rem' }}>
            <button 
              onClick={() => { navigate('/regalos'); onClose(); }}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 auto', background: 'none', border: 'none', color: '#64748b', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
            >
              <List size={14} />
              <span>Ver listado de todas las tarjetas</span>
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default GiftCardValidator;
