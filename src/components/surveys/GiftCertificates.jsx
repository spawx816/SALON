import React, { useState } from 'react';
import { Gift, Mail, Share2, Download, CheckCircle, Smartphone, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { dataService } from '../../utils/dataService';
import { loadCardNetScript } from '../../utils/cardnetScriptLoader';

const GiftCertificates = () => {
  const { user } = useAuth();
  const [preview, setPreview] = useState({ m: '1500', to: 'Maria' });
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [generatedCode, setGeneratedCode] = useState("");
  const [giftHistory, setGiftHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [activeTab, setActiveTab] = useState('editor'); // 'editor', 'history', 'redeem'
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemResult, setRedeemResult] = useState(null);

  const handleSendWhatsApp = (code) => {
    const targetCode = code || generatedCode;
    const text = `¡Hola! Te he enviado un regalo de Abatte Peluquería por valor de RD$ ${preview.m}. Tu código de canje es: ${targetCode}. Úsalo en nuestra sucursal San Vicente De Paul. ✨`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleSendEmail = async (code) => {
    const targetCode = code || generatedCode;
    if (!recipientEmail) return alert("Por favor ingresa un correo.");
    setEmailSending(true);
    try {
      const res = await fetch('/api/gifts/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientEmail, giftDetails: preview, giftCode: targetCode })
      });
      if (res.ok) alert("¡Correo enviado exitosamente!");
      else throw new Error("No se pudo enviar el correo.");
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setEmailSending(false);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch(`/api/gifts?clientId=${user?.id}`);
      if (res.ok) {
        const data = await res.json();
        setGiftHistory(data);
      }
    } catch (err) {
      console.error("Error fetching gift history:", err);
    }
  };

  React.useEffect(() => {
    if (user?.id) fetchHistory();
  }, [user?.id]);

  const handlePayment = async () => {
    if (!agreed) return;
    setLoading(true);
    try {
      if (user?.id) {
        try {
          const chargeRes = await fetch('/api/gifts/purchase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: user.id, amount: preview.m, details: preview })
          });
          const chargeData = await chargeRes.json();

          if (chargeRes.ok && chargeData.success) {
            setGeneratedCode(chargeData.giftCode || "GIFT-" + Math.floor(1000 + Math.random() * 9000));
            setShowSuccessModal(true);
            fetchHistory();
            setLoading(false);
            return;
          }

          if (chargeData.error !== 'NoSavedCard') {
            throw new Error(chargeData.message || chargeData.error || "La tarjeta guardada fue declinada.");
          }
        } catch (backendErr) {
          if (backendErr.message.includes("declinada")) {
             throw backendErr;
          }
          console.warn("Intento de cobro silencioso falló, recurriendo a Iframe:", backendErr.message);
        }
      }

      // 1. Crear cliente o sesión en CardNet (Fallback para agregar tarjeta nueva)
      const customer = await dataService.cardnetCreateCustomer(user?.email || "regalo@default.com", user?.id);
      const uniqueId = customer.uniqueId || customer.UniqueID;
      const captureUrl = customer.captureUrl || customer.CaptureURL || "https://labservicios.cardnet.com.do/servicios/tokens/v1/Capture";

      if (!uniqueId) throw new Error("No se pudo obtener la sesión de CardNet.");

      const public_key = customer.publicKey || customer.PublicKey || "J_eHXPYlDo9wlFpFXjgalm_I56ONV7HQ";

      // Cargar dinámicamente el SDK de CardNet del entorno correspondiente
      await loadCardNetScript(public_key, captureUrl);

      if (typeof window.PWCheckout === 'undefined') {
        throw new Error("SDK CardNet no se pudo inicializar.");
      }

      // 2. Configurar el Iframe de CardNet (sin logo externo roto)
      window.PWCheckout.SetProperties({
        "name": "Abatte Peluquería",
        "email": user?.email || "correo@default.com",
        "button_label": `Pagar Regalo RD$ ${preview.m}`,
        "description": "Compra de Tarjeta de Regalo",
        "currency": "DOP",
        "amount": "0", // Tokenization always uses 0 initially
        "lang": "ESP",
        "form_id": "gift_card_form",
        "checkout_card": "1",
        "session_id": uniqueId,
        "autoSubmit": "false",
        "empty": "false"
      });

      // PARCHE ANTI-CRASH PARA CARDNET EN CERTIFICADOS DE REGALO
      const patchCardnet = setInterval(() => {
          if (window.PWCheckout && window.PWCheckout.Iframe && window.PWCheckout.Iframe.Close) {
              clearInterval(patchCardnet);
              const originalClose = window.PWCheckout.Iframe.Close;
              window.PWCheckout.Iframe.Close = function () {
                  console.log("[CardNet Regalo] Intentando cerrar iframe...");
                  if (!document.getElementById(window.PWCheckout.Iframe.frameId)) {
                      console.warn("[CardNet Regalo] El Iframe ya no existe, ignorando cierre para evitar crash.");
                      return;
                  }
                  try {
                      originalClose.apply(this, arguments);
                      console.log("[CardNet Regalo] Cierre ejecutado.");
                  } catch (err) {
                      console.error("[CardNet Regalo] Error interno silenciado:", err);
                  }
              };
          }
      }, 100);

      // 3. Callback al completar tokenización
      window.PWCheckout.Bind("tokenCreated", async (token) => {
         console.log("[CARDNET] Token recibido para Regalo:", token);
         clearInterval(patchCardnet);
         setLoading(true);
         try {
           const purchaseRes = await fetch('/api/gifts/purchase', {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ 
               clientId: user?.id || 'GUEST', 
               amount: preview.m, 
               details: preview, 
               pwToken: token?.TokenId || token 
             })
           });
           const purchaseData = await purchaseRes.json();
           
           if (purchaseRes.ok && purchaseData.success) {
             setGeneratedCode(purchaseData.giftCode);
             setShowSuccessModal(true);
             fetchHistory();
             
             // Cierre limpio
             setTimeout(() => {
               try { if (window.PWCheckout?.Iframe) window.PWCheckout.Iframe.Close(); } catch(e) {}
             }, 500);
           } else {
             throw new Error(purchaseData.error || "Error al procesar el pago con la nueva tarjeta.");
           }
         } catch (e) {
           console.error("Error al procesar regalo:", e);
           alert("Hubo un problema al procesar el pago: " + e.message);
         } finally {
           setLoading(false);
         }
      });

      // 4. Abrir Iframe de CardNet
      let finalCaptureUrl = captureUrl;
      if (!finalCaptureUrl.endsWith('/')) finalCaptureUrl += '/';
      
      window.PWCheckout.OpenIframeCustom(`${finalCaptureUrl}?key=${public_key}&session_id=${uniqueId}`, uniqueId);

    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRedeem = async () => {
    if (!redeemCode) return alert("Ingresa el código");
    setLoading(true);
    setRedeemResult(null);
    try {
      const res = await fetch('/api/gifts/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ giftCode: redeemCode })
      });
      const data = await res.json();
      if (res.ok) {
        setRedeemResult({ success: true, amount: data.amount });
        setRedeemCode('');
        fetchHistory();
      } else {
        setRedeemResult({ success: false, message: data.error });
      }
    } catch (err) {
      alert("Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div className="page-header" style={{ flexWrap: 'wrap', gap: '1rem' }}>
        <h2 className="page-title">Certificados de Regalo</h2>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button 
            onClick={() => setActiveTab(activeTab === 'history' ? 'editor' : 'history')}
            className="btn-secondary" 
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '0.6rem 1.2rem', borderRadius: '12px', fontWeight: 700, cursor: 'pointer' }}
          >
            <Gift size={18} />
            <span>{activeTab === 'history' ? 'Volver al Editor' : 'Ver Mis Regalos'}</span>
          </button>
          
          {(user?.role?.toLowerCase() === 'admin' || user?.role?.toLowerCase() === 'administrador' || user?.role?.toLowerCase() === 'recepcion' || user?.role?.toLowerCase() === 'recepcionista' || user?.role?.toLowerCase() === 'employee' || user?.role?.toLowerCase() === 'cajero') && (
            <button 
              onClick={() => setActiveTab(activeTab === 'redeem' ? 'editor' : 'redeem')}
              className="btn-secondary" 
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: activeTab === 'redeem' ? '#0f172a' : '#f8fafc', color: activeTab === 'redeem' ? 'white' : '#0f172a', border: '1px solid #e2e8f0', padding: '0.6rem 1.2rem', borderRadius: '12px', fontWeight: 700, cursor: 'pointer' }}
            >
              <ShieldCheck size={18} />
              <span>Canjear Regalo</span>
            </button>
          )}

          {activeTab === 'editor' && (
            <button 
              onClick={() => handleSendWhatsApp()}
              className="btn-primary" 
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#25D366', color: 'white', padding: '0.6rem 1.2rem', borderRadius: '12px', fontWeight: 700, cursor: 'pointer', border: 'none' }}
            >
              <Smartphone size={18} />
              <span>Enviar por WhatsApp</span>
            </button>
          )}
        </div>
      </div>

      {activeTab === 'history' ? (
        <div className="surface-card" style={{ padding: '2rem' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '1.5rem' }}>Historial de Regalos</h3>
          {giftHistory.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {giftHistory.map((gift, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem', background: '#f8fafc', borderRadius: '16px', border: '1px solid #e2e8f0', flexWrap: 'wrap', gap: '1rem' }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 800, color: '#0f172a' }}>Regalo para: {gift.recipient_name}</p>
                    <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>{new Date(gift.created_at).toLocaleDateString()} - Código: <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#d4af37' }}>{gift.gift_code}</span></p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ margin: 0, fontWeight: 900, fontSize: '1.1rem' }}>RD$ {gift.amount}</p>
                    <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: gift.status === 'Redeemed' ? '#ef4444' : '#10b981', fontWeight: 700 }}>
                      {gift.status === 'Redeemed' ? 'CANJEADO' : 'DISPONIBLE'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
              <Gift size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
              <p>Aún no has regalado certificados.</p>
            </div>
          )}
        </div>
      ) : activeTab === 'redeem' ? (
        <div style={{ maxWidth: '600px', margin: '0 auto', width: '100%' }}>
          <div className="surface-card" style={{ padding: '3rem', textAlign: 'center' }}>
            <div style={{ width: '80px', height: '80px', background: '#f8fafc', color: '#0f172a', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 2rem' }}>
              <ShieldCheck size={40} />
            </div>
            <h3 style={{ fontSize: '1.5rem', fontWeight: 900, marginBottom: '0.5rem' }}>Canjear Regalo</h3>
            <p style={{ color: '#64748b', marginBottom: '2.5rem' }}>Pide el código al cliente e ingrésalo aquí para validarlo.</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <input 
                value={redeemCode}
                onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
                placeholder="CÓDIGO (EJ: GIFT-1234)"
                style={{ textAlign: 'center', fontSize: '1.5rem', fontWeight: 900, letterSpacing: '0.1em', padding: '1.5rem', borderRadius: '20px', border: '2px solid #e2e8f0', background: '#f8fafc' }}
              />
              
              <button 
                onClick={handleRedeem}
                disabled={loading || !redeemCode}
                className="btn-primary"
                style={{ padding: '1.25rem', fontSize: '1.1rem', borderRadius: '20px' }}
              >
                {loading ? 'Validando...' : 'Validar y Canjear'}
              </button>
            </div>

            {redeemResult && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                style={{ 
                  marginTop: '2rem', padding: '1.5rem', borderRadius: '20px',
                  background: redeemResult.success ? '#ecfdf5' : '#fef2f2',
                  border: `1px solid ${redeemResult.success ? '#10b981' : '#ef4444'}`
                }}
              >
                {redeemResult.success ? (
                  <>
                    <p style={{ color: '#059669', fontWeight: 800, margin: '0 0 0.5rem' }}>¡CÓDIGO VÁLIDO!</p>
                    <p style={{ fontSize: '1.5rem', fontWeight: 900, color: '#065f46', margin: 0 }}>Canjeado: RD$ {redeemResult.amount}</p>
                  </>
                ) : (
                  <p style={{ color: '#b91c1c', fontWeight: 800, margin: 0 }}>{redeemResult.message}</p>
                )}
              </motion.div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        {/* Editor */}
        <div className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 800, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Personalizar Certificado</h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Monto (RD$)</label>
              <input 
                type="number"
                className="input-field" 
                value={preview.m}
                onChange={(e) => setPreview({...preview, m: e.target.value})}
                placeholder="Ej. 1500"
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Para (Nombre del Destinatario)</label>
              <input 
                className="input-field"
                placeholder="Nombre del destinatario" 
                value={preview.to}
                onChange={(e) => setPreview({...preview, to: e.target.value})} 
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>De (Tu Nombre)</label>
              <input 
                className="input-field"
                placeholder="Tu nombre" 
                onChange={(e) => setPreview({...preview, from: e.target.value})} 
              />
            </div>
          </div>

          <div style={{ background: '#f8fafc', padding: '1.5rem', borderRadius: '16px', border: '1px solid #e2e8f0', fontSize: '0.8rem', color: '#475569', lineHeight: 1.6 }}>
            <h4 style={{ margin: '0 0 1rem', color: '#0f172a', fontWeight: 800 }}>Términos y Condiciones de la Tarjeta de Regalo</h4>
            <div style={{ maxHeight: '150px', overflowY: 'auto', paddingRight: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', textAlign: 'justify' }}>
              <p>Al realizar la compra de este regalo, EL CLIENTE acepta que el monto adquirido no es reembolsable bajo ninguna circunstancia una vez procesado el pago.</p>
              <p>El regalo consiste en un saldo digital que podrá ser utilizado exclusivamente en la sucursal seleccionada al momento de la compra.</p>
              <p>El certificado es al portador, por lo que cualquier persona que presente el código correspondiente podrá hacer uso del saldo disponible.</p>
              <p>La entrega del código, ya sea de forma física o digital, es responsabilidad exclusiva del comprador. LA COMPAÑÍA no se hace responsable por el uso indebido, pérdida o compartición del mismo.</p>
              <p>El saldo del regalo será consumido conforme a los servicios utilizados en el salón y no podrá ser canjeado por dinero en efectivo.</p>
            </div>
            
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginTop: '1.5rem', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                style={{ marginTop: '0.2rem', width: '18px', height: '18px', accentColor: '#09090b' }} 
              />
              <span style={{ fontWeight: 700, color: '#0f172a' }}>He leído y acepto los términos y condiciones de la tarjeta de regalo.</span>
            </label>
          </div>

          <div style={{ display: 'flex', paddingTop: '1rem' }}>
            <button 
              disabled={!agreed || loading}
              onClick={handlePayment}
              className="btn-primary" 
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', padding: '1.2rem', opacity: (!agreed || loading) ? 0.5 : 1, cursor: (!agreed || loading) ? 'not-allowed' : 'pointer' }}
            >
              <ShieldCheck size={20} />
              {loading ? 'Procesando...' : `Pagar Seguro en CardNet (RD$ ${preview.m || '0'})`}
            </button>
          </div>
          <p style={{ textAlign: 'center', fontSize: '0.75rem', color: '#64748b', margin: 0 }}>El pago es procesado de forma segura por CardNet Dominicana.</p>
        </div>

        {/* Live Preview */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 800, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Vista Previa</h3>
          <div 
            style={{ 
              position: 'relative',
              overflow: 'hidden',
              aspectRatio: '1/1.23',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: '24px',
              background: `url('/gift_card_art.jpg')`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
              border: '1px solid #e2e8f0'
            }}
          >
            {/* Gift Code Overlay */}
            <div style={{ 
              position: 'absolute', 
              top: '18px', 
              right: '24px', 
              fontSize: '0.7rem', 
              fontWeight: 900, 
              color: '#d4af37',
              background: 'rgba(255,255,255,0.8)',
              padding: '4px 10px',
              borderRadius: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontFamily: 'monospace',
              boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
              zIndex: 10
            }}>
              ID: {generatedCode || 'GIFT-XXXXXX'}
            </div>

            {/* Dynamic Text Overlay */}
            {/* Amount (RD$) */}
            <div style={{ 
              position: 'absolute', 
              bottom: '15.2%', 
              left: '58%', 
              fontSize: '1.25rem', 
              fontWeight: 800, 
              color: '#d97d8b',
              fontFamily: "'Plus Jakarta Sans', sans-serif"
            }}>
              {preview.m || '0'}
            </div>

            {/* DE: */}
            <div style={{ 
              position: 'absolute', 
              bottom: '8.5%', 
              left: '23%', 
              width: '24%',
              fontSize: '1rem', 
              fontWeight: 600, 
              color: '#164e25',
              textAlign: 'center',
              fontStyle: 'italic',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontFamily: "'Dancing Script', cursive"
            }}>
              {preview.from || ''}
            </div>

            {/* PARA: */}
            <div style={{ 
              position: 'absolute', 
              bottom: '8.5%', 
              left: '62%', 
              width: '24%',
              fontSize: '1rem', 
              fontWeight: 600, 
              color: '#164e25',
              textAlign: 'center',
              fontStyle: 'italic',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontFamily: "'Dancing Script', cursive"
            }}>
              {preview.to || ''}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#10b981', fontSize: '0.875rem', padding: '1rem', background: '#ecfdf5', borderRadius: '12px', fontWeight: 600 }}>
            <CheckCircle size={16} />
            <span>Este diseño es optimizado para impresión y visualización digital.</span>
          </div>
        </div>
      </div>
    )}

    <form id="gift_card_form" style={{ display: 'none' }}>
        <input name="PWToken" type="hidden" id="PWToken" />
    </form>

    {/* Success Modal */}
    {showSuccessModal && (
      <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div style={{ width: '100%', maxWidth: '440px', background: 'white', padding: '3rem', borderRadius: '40px', textAlign: 'center', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
          <div style={{ width: '80px', height: '80px', background: '#ecfdf5', color: '#10b981', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 2rem' }}>
            <CheckCircle size={40} />
          </div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 900, marginBottom: '1rem' }}>¡Regalo Enviado!</h2>
          <p style={{ color: '#64748b', marginBottom: '2rem', lineHeight: 1.6 }}>El pago se ha procesado correctamente. Aquí tienes el código de tu tarjeta de regalo:</p>
          <div style={{ background: '#f8fafc', padding: '1.5rem', borderRadius: '20px', border: '2px dashed #d4af37', marginBottom: '2rem' }}>
            <span style={{ fontSize: '1.5rem', fontWeight: 900, color: '#d4af37', letterSpacing: '0.1em' }}>{generatedCode}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '2.5rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input 
                type="email" 
                placeholder="Correo del destinatario"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                style={{ flex: 1, padding: '1rem', borderRadius: '14px', border: '1px solid #e2e8f0', fontSize: '0.9rem' }}
              />
              <button 
                onClick={() => handleSendEmail()}
                disabled={emailSending}
                style={{ background: '#09090b', color: 'white', padding: '0 1.5rem', borderRadius: '14px', border: 'none', fontWeight: 700, cursor: 'pointer' }}
              >
                {emailSending ? '...' : <Mail size={18} />}
              </button>
            </div>
            <button 
              onClick={() => handleSendWhatsApp()}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: '#25D366', color: 'white', padding: '1rem', borderRadius: '14px', border: 'none', fontWeight: 700, cursor: 'pointer' }}
            >
              <Share2 size={18} /> Compartir por WhatsApp
            </button>
          </div>

          <button 
            onClick={() => setShowSuccessModal(false)}
            style={{ width: '100%', background: '#f1f5f9', color: '#64748b', padding: '1rem', borderRadius: '20px', border: 'none', fontWeight: 800, cursor: 'pointer' }}
          >
            Cerrar
          </button>
        </div>
      </div>
    )}
    </div>
  );
};

export default GiftCertificates;
