import React, { useState, useEffect } from 'react';
import { 
  ShoppingBag, Phone, MapPin, CheckCircle2, Star, 
  Gift, Heart, MessageSquare, ExternalLink, ChevronRight,
  Sparkles, Scissors, CreditCard, X, Camera, User,
  Zap, Lock, Check, Calendar, ClipboardList, Bell,
  Menu, Settings, LogOut, ArrowRight, TrendingUp,
  Eye, EyeOff
} from 'lucide-react';
import { useTranslation } from '../../context/LanguageContext';
import { dataService } from '../../utils/dataService';
import { loadCardNetScript } from '../../utils/cardnetScriptLoader';
import { useAuth } from '../../context/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

const ClientDashboard = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  
  const [contract, setContract] = useState(null);
  const [salon, setSalon] = useState(null);
  const [visits, setVisits] = useState([]);
  const [usageStats, setUsageStats] = useState([]);
  const [availablePlans, setAvailablePlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fullClient, setFullClient] = useState(null);
  const [payments, setPayments] = useState([]);
  const [gifts, setGifts] = useState([]);
  const [cardInfo, setCardInfo] = useState(null);
  const [activeOtp, setActiveOtp] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);
  const [clientIp, setClientIp] = useState('Cargando...');

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Modal states
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(user?.mustChangePassword || false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [tempCurrentPassword, setTempCurrentPassword] = useState('');
  const [showTempPw, setShowTempPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [checkoutStep, setCheckoutStep] = useState(1);
  const [signature, setSignature] = useState('');
  const [documentPhoto, setDocumentPhoto] = useState(null);
  const [documentPreview, setDocumentPreview] = useState(null);
  const [selfiePhoto, setSelfiePhoto] = useState(null);
  const [selfiePreview, setSelfiePreview] = useState(null);
  const [cardData, setCardData] = useState({ number: '', expiry: '', cvv: '' });
  const [isContractAccepted, setIsContractAccepted] = useState(false);

  const handleFileChange = (e, type) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      if (type === 'document') {
        setDocumentPhoto(reader.result);
        setDocumentPreview(reader.result);
      } else {
        setSelfiePhoto(reader.result);
        setSelfiePreview(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (user?.id) fetchData();
  }, [user?.id]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const id = user.id;
      const [cContracts, pastVisits, allPlans, clients, clientPayments, clientGifts, cardInfoRes] = await Promise.all([
        dataService.getContractByClient(id),
        dataService.getVisitsByClient(id),
        dataService.getPlans(),
        dataService.getClients(),
        dataService.getPaymentsByClient(id),
        dataService.getGiftsByClient(id),
        dataService.getPaymentProfileByClient(id)
      ]);

      // Fetch real public IP for traceability
      try {
        const ipRes = await fetch('https://api.ipify.org?format=json');
        if (ipRes.ok) {
          const ipData = await ipRes.json();
          console.log("[DEBUG] Public IP fetched:", ipData.ip);
          setClientIp(ipData.ip);
        } else {
          console.warn("[DEBUG] IP fetch failed, using fallback detection.");
        }
      } catch (e) { 
        console.warn("IP fetch error:", e); 
      }

      const cContract = Array.isArray(cContracts) && cContracts.length > 0 ? cContracts[0] : null;
      const clientInfo = clients.find(c => c.id === id);
      
      if (cContract) {
        const matchedPlan = allPlans.find(p => p.id === cContract.plan_id || String(p.id) === String(cContract.plan_id));
        cContract.plan_name = matchedPlan ? matchedPlan.title : 'Plan Desconocido';
        // Guardar límites del plan original para referencia
        cContract.master_usage_limits = matchedPlan ? matchedPlan.usage_limits : null;
      }

      setFullClient(clientInfo);
      setContract(cContract);
      setVisits(pastVisits);
      setAvailablePlans(allPlans || []);
      setPayments(clientPayments || []);
      setGifts(clientGifts || []);
      setCardInfo(cardInfoRes);
      
      const otpRes = await dataService.getActiveOTP(id);
      setActiveOtp(otpRes?.code || null);

      if (cContract && cContract.salon_id) {
        const salons = await dataService.getSalons();
        setSalon(salons.find(s => s.id === cContract.salon_id));
      }

      const hasActiveContract = cContract && (cContract.status === 'Active' || cContract.status === 'Pending_Retry');
      if (hasActiveContract) {
        processUsage(cContract, pastVisits);
      } else {
        setUsageStats([]);
      }
    } catch (err) {
      console.error("Dashboard Load Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestOTP = async () => {
    try {
      const res = await dataService.generateOTP(user.id);
      if (res && res.code) {
        setActiveOtp(res.code);
      }
    } catch (err) {
      console.error("Error generating OTP:", err);
    }
  };

  const processUsage = (cContract, pastVisits) => {
    console.log("[DEBUG] Contrato:", cContract);
    const usageMap = {};
    const parseDate = (d) => {
      if (!d) return 0;
      if (d instanceof Date) return d.getTime();
      // Si la fecha no termina en Z, se la ponemos para forzar UTC
      const dateStr = String(d).endsWith('Z') ? String(d) : String(d).replace(' ', 'T') + 'Z';
      const time = new Date(dateStr).getTime();
      return isNaN(time) ? new Date(d).getTime() : time;
    };

    const lastBillingTime = parseDate(cContract.last_billed_date);
    // Margen de 10 segundos
    const threshold = lastBillingTime + 10000;
    
    const cycleVisits = pastVisits.filter(v => {
      const vTime = parseDate(v.visited_at);
      return vTime >= threshold;
    });
    
    cycleVisits.forEach(v => {
      // Los servicios vienen como JSON string o array en la visita
      let srvs = [];
      try {
        srvs = typeof v.servicios === 'string' ? JSON.parse(v.servicios) : (v.servicios || []);
      } catch(e) { srvs = []; }
      
      srvs.forEach(s => { usageMap[s] = (usageMap[s] || 0) + 1; });
    });

    const peel = (data) => {
      let current = data;
      let limit = 0;
      while (typeof current === 'string' && limit < 5) {
        try {
          const p = JSON.parse(current);
          if (p === current) break;
          current = p;
          limit++;
        } catch { break; }
      }
      return current;
    };

    const servicesList = peel(cContract.contract_services) || [];
    const limits = peel(cContract.master_usage_limits) || {};
    
    const stats = (Array.isArray(servicesList) ? servicesList : []).map(serviceName => {
      let quota = parseInt(limits.services, 10) || 4;
      if (!limits.services) {
        const match = String(serviceName).match(/^(\d+)\s/);
        if (match) quota = parseInt(match[1], 10);
      }
      const used = usageMap[serviceName] || 0;
      const remaining = Math.max(0, quota - used);
      return {
        name: serviceName,
        used,
        total: quota,
        remaining,
        isPromo: false
      };
    });

    // Añadir servicios promocionales si existen y el contrato está en periodo de promo
    const now = new Date();
    const signedDate = new Date(cContract.signed_at);
    const promoMonths = parseInt(cContract.contract_promo_duration, 10) || 0;
    const promoEndDate = new Date(signedDate);
    promoEndDate.setMonth(promoEndDate.getMonth() + promoMonths);
    
    const isPromoActive = promoMonths > 0 && now <= promoEndDate;
    
    if (isPromoActive) {
      const promoServices = peel(cContract.contract_promo_services) || [];
      (Array.isArray(promoServices) ? promoServices : []).forEach(pName => {
        const pUsed = usageMap[pName] || 0;
        const pTotal = 1;
        stats.push({
          name: pName,
          used: pUsed,
          total: pTotal,
          remaining: Math.max(0, pTotal - pUsed),
          isPromo: true
        });
      });
    }

    setUsageStats(stats);
  };

  const handleFinalPayment = async () => {
    if (!user || !user.id) {
      alert("Tu sesión ha expirado. Por favor, inicia sesión de nuevo.");
      return;
    }
    
    const currentPlan = selectedPlan || availablePlans.find(p => parseFloat(p.price) === 1950) || availablePlans[0] || { id: 'plan_monthly_1', name: 'PLAN BEAUTY', price: 1950 };
    if (!selectedPlan) {
      setSelectedPlan(currentPlan);
    }

    setLoading(true);
    try {
      // 1. First, create/get CardNet Customer
      const sessionRes = await fetch('/api/cardnet/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, clientId: user.id })
      });
      const sessionData = await sessionRes.json();
      
      if (!sessionRes.ok) throw new Error(sessionData.error || 'Error al iniciar sesión de pago');

      // 2. Open CardNet Hosted Payment Iframe
      console.log('[CARDNET] Sesión completa:', sessionData);
      const uniqueId = sessionData.UniqueID || sessionData.uniqueId;

      if (uniqueId) {
        const captureUrl = sessionData.captureUrl || sessionData.CaptureURL || "https://labservicios.cardnet.com.do/servicios/tokens/v1/Capture";
        const publicKey = sessionData.publicKey || sessionData.PublicKey || "J_eHXPYlDo9wlFpFXjgalm_I56ONV7HQ";

        // Cargar dinámicamente el SDK de CardNet
        await loadCardNetScript(publicKey, captureUrl);

        if (typeof window.PWCheckout === 'undefined') {
          throw new Error("SDK CardNet no se pudo inicializar.");
        }

        window.PWCheckout.SetProperties({
          "name": "Abatte Peluquería",
          "email": user.email || "correo@default.com",
          "button_label": `Suscribir RD$ ${currentPlan?.price || '0'}`,
          "description": `Suscripción a ${currentPlan?.title || 'Plan'}`,
          "currency": "DOP",
          "amount": "0", 
          "lang": "ESP",
          "form_id": "checkout_form_fake_dashboard",
          "checkout_card": "1",
          "session_id": uniqueId,
          "autoSubmit": "false"
        });

        // PARCHE ANTI-CRASH PARA CARDNET EN DASHBOARD
        const patchCardnet = setInterval(() => {
            if (window.PWCheckout && window.PWCheckout.Iframe && window.PWCheckout.Iframe.Close) {
                const originalClose = window.PWCheckout.Iframe.Close;
                window.PWCheckout.Iframe.Close = function () {
                    console.log("[CardNet Dashboard] Intentando cerrar iframe...");
                    if (!document.getElementById(window.PWCheckout.Iframe.frameId)) {
                        console.warn("[CardNet Dashboard] Iframe ya no existe. Ignorando para evitar crash.");
                        return;
                    }
                    try {
                        originalClose.apply(this, arguments);
                    } catch (err) {
                        console.error("[CardNet Dashboard] Error interno silenciado.");
                    }
                };
                clearInterval(patchCardnet);
            }
        }, 100);

        window.PWCheckout.Bind("tokenCreated", async (token) => {
           console.log("[CARDNET] Token recibido en Dashboard:", token);
           setLoading(true); 
           clearInterval(patchCardnet);
           
           try {
             let finalToken = token?.TokenId;
             if (!finalToken) {
                const hiddenInput = document.getElementById('PWToken');
                if (hiddenInput && hiddenInput.value) {
                    finalToken = hiddenInput.value;
                } else {
                    throw new Error("No se pudo obtener el TokenId de CardNet.");
                }
             }

             // Forzar cierre silencioso para evitar colisiones con React
             setTimeout(() => {
                try { if (window.PWCheckout?.Iframe) window.PWCheckout.Iframe.Close(); } catch(e) {}
             }, 500);

             // Usar el servicio centralizado para que lleve los headers de seguridad (Token)
             const payload = {
                 clientId: user.id,
                 planId: currentPlan.id,
                 signature_hash: signature || ('signed_digitally_dashboard_' + Date.now()),
                 pwToken: finalToken,
                 documentPhoto,
                 selfiePhoto,
                 ip_address: clientIp,
                 deviceAgent: navigator.userAgent
             };

             const res = await fetch('/api/contracts', {
               method: 'POST',
               headers: { 
                 'Content-Type': 'application/json',
                 'Authorization': `Bearer ${localStorage.getItem('token')}` // Seguridad crítica
               },
               body: JSON.stringify(payload)
             });

             const finalRes = await res.json();
             
             if (!res.ok) throw new Error(finalRes.error || "Error al guardar el contrato en el servidor");
             
             setIsCheckoutOpen(false);
             alert("¡Felicidades! Tu plan ha sido activado con éxito.");
             fetchData();
           } catch (e) {
             console.error("[CARDNET] Error guardando contrato:", e);
             alert("ERROR FATAL: Hubo un problema al procesar tu plan: " + e.message);
           } finally {
             setLoading(false);
           }
        });
        
        // Mantenemos el modal abierto (NO hacer setIsCheckoutOpen(false)) 
        // para evitar desmontar el form "checkout_form_fake_dashboard" del DOM.
        // El iframe de CardNet tiene un z-index altísimo y cubrirá la pantalla.
        setLoading(false);
        
        let cleanCaptureUrl = captureUrl;
        if (!cleanCaptureUrl.endsWith('/')) cleanCaptureUrl += '/';
        window.PWCheckout.OpenIframeCustom(`${cleanCaptureUrl}?key=${publicKey}&session_id=${uniqueId}`, uniqueId);

        return; 
      }

      // Fallback: If no capture URL, try the original contracts flow (not recommended for CardNet)
      const finalRes = await fetch('/api/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: user.id,
          planId: selectedPlan.id,
          signature_hash: signature || 'signed_digitally_v1',
          pwToken: 'TOKEN_PENDING',
          documentPhoto,
          selfiePhoto,
          ip_address: clientIp,
          deviceAgent: navigator.userAgent
        })
      });

      const finalData = await finalRes.json();
      if (!finalRes.ok) throw new Error(finalData.error || 'Error al procesar el pago final');

      alert("¡Felicidades! Tu plan ha sido activado con éxito.");
      setIsCheckoutOpen(false);
      fetchData(); // Refresh everything
    } catch (err) {
      console.error("Payment Error:", err);
      alert("Error en el pago: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChange = async () => {
    if (newPassword.length < 8) return alert("La nueva contraseña debe tener al menos 8 caracteres.");
    if (newPassword !== confirmNewPassword) return alert("Las contraseñas no coinciden.");
    try {
      const res = await fetch('/api/clients/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: user.id, currentPassword: tempCurrentPassword, newPassword })
      });
      if (res.ok) {
        alert("Contraseña actualizada con éxito.");
        setIsPasswordModalOpen(false);
        
        // Actualizar el estado local y el almacenamiento para que el modal no vuelva a aparecer
        const updatedUser = { ...user, mustChangePassword: false };
        localStorage.setItem('salon_pro_user', JSON.stringify(updatedUser));
        
        // Si el AuthContext tiene una función para actualizar el usuario, la usamos.
        // Si no, forzamos una recarga suave de la data o simplemente confiamos en el cierre del modal
        // ya que el estado local del componente 'user' de AuthContext suele ser inmutable 
        // hasta el próximo montaje, pero al cerrar el modal localmente ya bloqueamos la vista.
        
        // Hack para forzar que el sistema sepa que ya no debe mostrarlo si navegas y vuelves
        user.mustChangePassword = false; 
      } else {
        const errData = await res.json();
        alert("Error: " + (errData.error || "No se pudo cambiar la contraseña."));
      }
    } catch (e) { 
      alert("Error de conexión al intentar cambiar la contraseña."); 
    }
  };

  if (loading || !user) return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ textAlign: 'center' }}>
        <Sparkles className="animate-spin" size={48} color="#09090b" style={{ margin: '0 auto 1.5rem' }} />
        <p style={{ fontSize: '1.1rem', fontWeight: 700, color: '#64748b' }}>Sincronizando con Abatte Peluquería...</p>
      </div>
    </div>
  );

  const isCancelled = fullClient?.status === 'Cancelled' || fullClient?.status === 'Inactivo';

  const containerVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { staggerChildren: 0.1 } }
  };

  const cardVariants = {
    hidden: { opacity: 0, scale: 0.95 },
    visible: { opacity: 1, scale: 1 }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f8f9fa', padding: isMobile ? '1rem' : '2rem' }}>
      
      {/* Cancellation Overlay */}
      <AnimatePresence>
        {isCancelled && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ 
              position: 'fixed', inset: 0, background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(10px)', 
              zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' 
            }}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              style={{ maxWidth: '500px', width: '100%', textAlign: 'center' }}
            >
              <div style={{ width: '80px', height: '80px', background: '#fee2e2', color: '#ef4444', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 2rem' }}>
                <X size={40} />
              </div>
              <h1 style={{ fontSize: '2.5rem', fontWeight: 900, color: '#09090b', marginBottom: '1rem', letterSpacing: '-0.02em' }}>Plan Cancelado</h1>
              <p style={{ color: '#64748b', fontSize: '1.25rem', lineHeight: 1.6, marginBottom: '2.5rem' }}>
                Tu contrato ha sido cancelado. Ya no tienes acceso a los beneficios de membresía ni a la generación de códigos para servicios.
              </p>
              <div style={{ background: '#f8fafc', padding: '1.5rem', borderRadius: '20px', border: '1px solid #e2e8f0', marginBottom: '2.5rem' }}>
                <p style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase', marginBottom: '0.5rem' }}>¿Necesitas ayuda?</p>
                <p style={{ fontWeight: 700, color: '#09090b' }}>Por favor, visita el salón para reactivar tu cuenta o contratar un nuevo plan.</p>
              </div>
              <button 
                onClick={logout}
                className="btn-primary" 
                style={{ width: '100%', padding: '1.25rem', borderRadius: '20px', fontSize: '1.1rem', background: '#ef4444' }}
              >
                Cerrar Sesión
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <main style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <header style={{ 
          display: 'flex', 
          flexDirection: isMobile ? 'column' : 'row',
          justifyContent: 'space-between', 
          alignItems: isMobile ? 'flex-start' : 'center', 
          gap: isMobile ? '1.5rem' : '0',
          marginBottom: '2.5rem' 
        }}>
          <div>
            <h1 style={{ fontSize: '2.25rem', fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>Hola, {user.nombre} <span style={{ fontSize: '1.5rem' }}>✨</span></h1>
            <p style={{ color: '#64748b', margin: '0.5rem 0 0', fontWeight: 500 }}>{contract ? 'Tu membresía está activa y lista.' : 'Completa tu suscripción para comenzar.'}</p>
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button style={{ width: '48px', height: '48px', borderRadius: '16px', background: 'white', border: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
              <Bell size={20} />
            </button>
            <div style={{ width: '48px', height: '48px', borderRadius: '16px', background: 'linear-gradient(135deg, #d4af37, #b8860b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 900, boxShadow: '0 4px 12px rgba(212,175,55,0.3)' }}>
              {user.nombre.charAt(0)}
            </div>
          </div>
        </header>

        {/* Navigation Tabs */}
        <div style={{ 
          display: 'flex', 
          gap: '0.5rem', 
          marginBottom: '2.5rem', 
          background: 'white', 
          padding: '0.4rem', 
          borderRadius: '24px', 
          width: isMobile ? '100%' : 'fit-content',
          boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
          overflowX: isMobile ? 'auto' : 'visible',
          scrollbarWidth: 'none'
        }}>
          {[
            { id: 'overview', label: 'Resumen', icon: TrendingUp },
            { id: 'profile', label: 'Mi Perfil', icon: User },
            { id: 'gifts', label: 'Mis Regalos', icon: Gift },
            { id: 'visits', label: 'Historial', icon: Calendar }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                padding: isMobile ? '0.6rem 1rem' : '0.75rem 1.5rem',
                borderRadius: '18px',
                border: 'none',
                background: activeTab === tab.id ? '#09090b' : 'transparent',
                color: activeTab === tab.id ? 'white' : '#64748b',
                fontWeight: 700,
                fontSize: isMobile ? '0.8rem' : '0.9rem',
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                whiteSpace: 'nowrap'
              }}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div 
              key="overview"
              variants={containerVariants} 
              initial="hidden" 
              animate="visible" 
              exit={{ opacity: 0, y: -20 }}
              style={{ 
                display: 'grid', 
                gridTemplateColumns: isMobile ? '1fr' : '1.8fr 1fr', 
                gap: isMobile ? '1.5rem' : '2.5rem' 
              }}
            >
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
            {/* Active OTP Alert (Real-time fallback) */}
            {activeOtp && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }} 
                animate={{ height: 'auto', opacity: 1 }}
                style={{ marginBottom: '1rem', overflow: 'hidden' }}
              >
                <div style={{ 
                  background: 'linear-gradient(135deg, #09090b 0%, #27272a 100%)', 
                  color: 'white', 
                  padding: '2rem', 
                  borderRadius: '32px', 
                  display: 'flex', 
                  flexDirection: isMobile ? 'column' : 'row',
                  alignItems: 'center', 
                  justifyContent: 'space-between',
                  gap: '1.5rem',
                  boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
                  border: '1px solid rgba(212,175,55,0.3)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                    <div style={{ width: '48px', height: '48px', background: 'rgba(255,255,255,0.1)', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Lock size={24} color="#facc15" />
                    </div>
                    <div style={{ textAlign: isMobile ? 'center' : 'left' }}>
                      <h3 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0 }}>Código de Verificación</h3>
                      <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)', margin: '0.25rem 0 0' }}>Muestra este código al personal para autorizar tu visita.</p>
                    </div>
                  </div>
                  <div style={{ 
                    background: 'white', 
                    color: '#09090b', 
                    padding: '0.75rem 2rem', 
                    borderRadius: '16px', 
                    fontSize: '2rem', 
                    fontWeight: 900, 
                    letterSpacing: '8px',
                    fontFamily: 'monospace',
                    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)'
                  }}>
                    {activeOtp}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Membership Card (Visual Impact) */}
            <motion.div variants={cardVariants} style={{ 
              background: '#09090b', borderRadius: '40px', padding: '3.5rem', color: 'white', position: 'relative', overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)'
            }}>
              <div style={{ position: 'absolute', top: '-100px', right: '-100px', width: '300px', height: '300px', background: 'rgba(212, 175, 55, 0.15)', borderRadius: '50%', filter: 'blur(80px)' }} />
              
              <div style={{ position: 'relative', zIndex: 2 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '5rem' }}>
                  <div>
                    <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.3em', fontWeight: 800, margin: '0 0 0.75rem' }}>Estatus de Miembro</p>
                    <h2 style={{ fontSize: '2rem', fontWeight: 900, margin: 0, letterSpacing: '-0.03em' }}>{contract?.plan_name || 'Sin Plan Activo'}</h2>
                  </div>
                  <div style={{ padding: '1rem', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(10px)' }}>
                    <Sparkles size={24} color="#d4af37" />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                  <div>
                    <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', margin: '0 0 0.5rem', fontWeight: 600 }}>Próxima Renovación</p>
                    <p style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>{contract ? new Date(contract.next_billing_date).toLocaleDateString('es-ES', { month: 'long', day: 'numeric', year: 'numeric' }) : 'N/A'}</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', margin: '0 0 0.5rem', fontWeight: 600 }}>Servicios Disponibles</p>
                    <p style={{ fontSize: '2.5rem', fontWeight: 900, margin: 0, color: '#d4af37', lineHeight: 1 }}>{usageStats.reduce((acc, s) => acc + s.remaining, 0)}</p>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Services Progress */}
            <motion.div variants={cardVariants} style={{ background: 'white', borderRadius: '40px', padding: '3rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem' }}>
                <h3 style={{ fontSize: '1.5rem', fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>Mi Consumo</h3>
                <button style={{ color: '#d4af37', background: 'none', border: 'none', fontSize: '0.9rem', fontWeight: 800, cursor: 'pointer' }}>Ver detalles <ChevronRight size={18} style={{ verticalAlign: 'middle', marginLeft: '4px' }} /></button>
              </div>

              {usageStats.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '2.5rem' }}>
                    {/* Base Services */}
                    {usageStats.filter(s => !s.isPromo).map((stat, idx) => (
                      <div key={`base-${idx}`} style={{ textAlign: 'center', padding: '1.5rem', background: '#f8fafc', borderRadius: '28px', border: '1px solid #f1f5f9' }}>
                        <div style={{ position: 'relative', width: '64px', height: '64px', margin: '0 auto 1.25rem' }}>
                          <svg style={{ transform: 'rotate(-90deg)', width: '64px', height: '64px' }}>
                            <circle cx="32" cy="32" r="28" fill="none" stroke="#e2e8f0" strokeWidth="6" />
                            <circle 
                              cx="32" cy="32" r="28" fill="none" stroke="#d4af37" strokeWidth="6"
                              strokeDasharray={`${(2 * Math.PI * 28)}`}
                              strokeDashoffset={`${(2 * Math.PI * 28) * (1 - (stat.used / (stat.total || 1)))}`}
                              strokeLinecap="round"
                              style={{ transition: 'stroke-dashoffset 1s ease-in-out' }}
                            />
                          </svg>
                          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', fontWeight: 900 }}>
                            {Math.max(0, stat.total - stat.used)}
                          </div>
                        </div>
                        <p style={{ fontSize: '0.85rem', fontWeight: 800, margin: 0, color: '#1e293b' }}>{stat.name}</p>
                        <p style={{ fontSize: '0.7rem', color: '#94a3b8', margin: '0.3rem 0 0', fontWeight: 600 }}>Restantes</p>
                      </div>
                    ))}

                    {/* Promo Services */}
                    {usageStats.filter(s => s.isPromo).map((stat, idx) => (
                      <div key={`promo-${idx}`} style={{ gridColumn: '1 / -1', marginTop: '1rem', padding: '1.5rem', background: '#f0fdf4', borderRadius: '28px', border: '1px solid #dcfce7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <p style={{ fontSize: '0.65rem', fontWeight: 900, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem' }}>🎁 SERVICIO DE REGALO</p>
                          <p style={{ fontSize: '1rem', fontWeight: 800, margin: 0, color: '#064e3b' }}>{stat.name}</p>
                          <p style={{ fontSize: '0.8rem', color: '#166534', margin: '0.25rem 0 0', fontWeight: 600 }}>{stat.used >= stat.total ? 'Ya utilizado' : 'Disponible'}</p>
                        </div>
                        <div style={{ padding: '0.75rem 1.25rem', background: stat.used >= stat.total ? '#d1fae5' : '#16a34a', color: 'white', borderRadius: '14px', fontWeight: 900, fontSize: '0.9rem' }}>
                          {stat.used}/{stat.total}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '3rem 0' }}>
                    <div style={{ width: '80px', height: '80px', background: '#fffbeb', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', color: '#d97706' }}>
                      <CreditCard size={40} />
                    </div>
                    <h4 style={{ margin: 0, fontWeight: 900, fontSize: '1.25rem' }}>Membresía por Activar</h4>
                    <p style={{ color: '#64748b', fontSize: '0.9rem', maxWidth: '350px', margin: '1rem auto 2rem', lineHeight: 1.6 }}>Realiza tu pago inicial para desbloquear todos tus beneficios exclusivos en Abatte.</p>
                    <button 
                      onClick={() => {
                        const plan = availablePlans.find(p => parseFloat(p.price) === 1950) || availablePlans[0] || { id: 'plan_monthly_1', name: 'PLAN BEAUTY', price: 1950 };
                        setSelectedPlan(plan);
                        setIsCheckoutOpen(true);
                      }}
                      style={{ background: '#09090b', color: 'white', padding: '1.2rem 3.5rem', borderRadius: '20px', border: 'none', fontWeight: 800, cursor: 'pointer', boxShadow: '0 10px 20px rgba(0,0,0,0.1)' }}
                    >
                      Pagar y Activar Ahora
                    </button>
                  </div>
                )}
            </motion.div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
            {/* Salon / Branch Card */}
            <motion.div variants={cardVariants} style={{ background: 'white', borderRadius: '40px', padding: '2.5rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.05)' }}>
              <div style={{ position: 'relative', height: '200px', borderRadius: '28px', overflow: 'hidden', marginBottom: '1.75rem', boxShadow: '0 10px 20px rgba(0,0,0,0.1)' }}>
                <img src="/abatte_salon_interior_1777874331934.png" style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Salon" />
                <div style={{ position: 'absolute', bottom: '1.25rem', left: '1.25rem', padding: '0.6rem 1.2rem', background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(10px)', borderRadius: '14px', fontSize: '0.8rem', fontWeight: 900, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                  San Vicente
                </div>
              </div>
              <h4 style={{ fontSize: '1.25rem', fontWeight: 900, margin: '0 0 0.75rem' }}>Abatte Peluquería</h4>
              <a 
                href="https://www.google.com/maps/search/?api=1&query=Abatte+Peluqueria+Av.+San+Vicente+de+Paul+Plaza+El+Poder" 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <p style={{ fontSize: '0.9rem', color: '#64748b', display: 'flex', alignItems: 'flex-start', gap: '0.6rem', lineHeight: 1.5, fontWeight: 500 }}>
                  <MapPin size={18} color="#d4af37" style={{ marginTop: '0.2rem' }} /> Av. San Vicente de Paul, Plaza El Poder
                </p>
              </a>
              <a href="tel:8095615000" style={{ textDecoration: 'none', width: '100%', display: 'block', marginTop: '2rem' }}>
                <button style={{ width: '100%', padding: '1.1rem', borderRadius: '20px', border: '2px solid #f1f5f9', background: 'white', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', transition: '0.3s' }}>
                  <Phone size={20} /> Contactar Sucursal
                </button>
              </a>
            </motion.div>

            {/* Quick Actions */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? '1rem' : '1.5rem' }}>
              <motion.div variants={cardVariants} whileHover={{ y: -8 }} onClick={() => navigate('/regalar')} style={{ background: 'white', borderRadius: '32px', padding: '2rem', textAlign: 'center', cursor: 'pointer', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.05)' }}>
                <div style={{ width: '56px', height: '56px', background: '#f0fdf4', color: '#16a34a', borderRadius: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
                  <Gift size={28} />
                </div>
                <p style={{ fontSize: '1rem', fontWeight: 800, margin: 0 }}>Regalar</p>
              </motion.div>
              <motion.div variants={cardVariants} whileHover={{ y: -8 }} onClick={() => navigate('/encuesta')} style={{ background: 'white', borderRadius: '32px', padding: '2rem', textAlign: 'center', cursor: 'pointer', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.05)' }}>
                <div style={{ width: '56px', height: '56px', background: '#eff6ff', color: '#2563eb', borderRadius: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
                  <Star size={28} />
                </div>
                <p style={{ fontSize: '1rem', fontWeight: 800, margin: 0 }}>Evaluar</p>
              </motion.div>
            </div>

            {/* Refer a Friend */}
            <motion.div variants={cardVariants} style={{ 
              background: 'linear-gradient(135deg, #d4af37, #b8860b)', borderRadius: '40px', padding: '2.5rem', color: 'white', display: 'flex', alignItems: 'center', gap: '2rem',
              boxShadow: '0 15px 30px rgba(212,175,55,0.2)'
            }}>
              <div style={{ flex: 1 }}>
                <h4 style={{ margin: 0, fontWeight: 900, fontSize: '1.25rem', letterSpacing: '-0.02em' }}>Recomienda Abatte</h4>
                <p style={{ margin: '0.6rem 0 0', fontSize: '0.85rem', opacity: 0.9, lineHeight: 1.4, fontWeight: 500 }}>Gana un servicio gratis invitando a tus amigos.</p>
              </div>
              <button style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(255,255,255,0.25)', border: 'none', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <ArrowRight size={24} />
              </button>
            </motion.div>
          </div>
        </motion.div>
      )}

          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <motion.div 
              key="profile"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 2fr', gap: isMobile ? '1.5rem' : '2.5rem' }}
            >
              <div className="surface-card" style={{ padding: '2.5rem', background: 'white', borderRadius: '40px', textAlign: 'center' }}>
                <div style={{ width: '120px', height: '120px', borderRadius: '50%', background: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 2rem', fontSize: '3rem', fontWeight: 900, color: '#09090b' }}>
                  {user.nombre.charAt(0)}
                </div>
                <h3 style={{ fontSize: '1.5rem', fontWeight: 900, marginBottom: '0.5rem' }}>{user.nombre}</h3>
                <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '2rem' }}>Cliente Miembro</p>
                
                <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div>
                    <p style={{ fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>Correo Electrónico</p>
                    <p style={{ fontWeight: 700, margin: 0 }}>{user.email}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>Teléfono</p>
                    <p style={{ fontWeight: 700, margin: 0 }}>{fullClient?.telefono || 'N/A'}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>Cédula / ID</p>
                    <p style={{ fontWeight: 700, margin: 0 }}>{user.cedula}</p>
                  </div>
                  <div style={{ marginTop: '1rem', paddingTop: '1.5rem', borderTop: '1px solid #f1f5f9' }}>
                    <p style={{ fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>Membresía Activa</p>
                    <p style={{ fontWeight: 800, margin: 0, color: '#d4af37', fontSize: '1.1rem' }}>{contract?.plan_name || 'Sin Plan'}</p>
                    
                    {contract?.contract_promo_duration > 0 && (
                      <div style={{ marginTop: '1.25rem', padding: '1rem', background: '#f0fdf4', borderRadius: '16px', border: '1px solid #dcfce7' }}>
                        <p style={{ fontSize: '0.65rem', fontWeight: 900, color: '#16a34a', textTransform: 'uppercase', marginBottom: '0.4rem' }}>🎁 BENEFICIOS EXTRA</p>
                        <p style={{ fontSize: '0.85rem', fontWeight: 700, color: '#064e3b', margin: 0 }}>
                          {usageStats.filter(s => s.isPromo).map(s => s.name).join(', ') || 'Cargando beneficios...'}
                        </p>
                        <p style={{ fontSize: '0.7rem', color: '#166534', marginTop: '0.25rem', fontWeight: 600 }}>Duración: {contract.contract_promo_duration} meses</p>
                      </div>
                    )}
                  </div>
                </div>

                <button 
                  onClick={() => setIsPasswordModalOpen(true)}
                  style={{ width: '100%', marginTop: '3rem', padding: '1rem', borderRadius: '16px', border: '2px solid #f1f5f9', background: 'white', fontWeight: 800, cursor: 'pointer', color: '#ef4444' }}
                >
                  Cambiar Contraseña
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
                 <div className="surface-card" style={{ padding: '2.5rem', background: 'white', borderRadius: '40px' }}>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 900, marginBottom: '1.5rem' }}>Método de Pago</h3>
                    {cardInfo ? (
                      <div style={{ background: '#f8fafc', padding: '1.5rem', borderRadius: '24px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                        <div style={{ width: '60px', height: '40px', background: '#09090b', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                          <CreditCard size={24} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontWeight: 800, margin: 0, fontSize: '1rem' }}>
                            {cardInfo.Brand || 'Tarjeta'} •••• {cardInfo.Last4}
                          </p>
                          <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0.25rem 0 0' }}>Expira: {cardInfo.ExpiryDate}</p>
                        </div>
                        <span style={{ fontSize: '0.7rem', fontWeight: 800, background: '#d1fae5', color: '#059669', padding: '0.4rem 0.8rem', borderRadius: '8px' }}>ACTIVA</span>
                      </div>
                    ) : (
                      <div style={{ background: '#fffbeb', padding: '1.5rem', borderRadius: '24px', border: '1px solid #fef3c7', textAlign: 'center' }}>
                        <p style={{ color: '#d97706', fontWeight: 600, fontSize: '0.9rem', margin: 0 }}>No tienes tarjetas registradas para cobros automáticos.</p>
                      </div>
                    )}
                    <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: '1.5rem', lineHeight: 1.5 }}>
                      Tu tarjeta se utiliza únicamente para el cobro recurrente de tu membresía. Para cambiarla, por favor solicita una actualización en el salón.
                    </p>
                 </div>

                 <div className="surface-card" style={{ padding: '2.5rem', background: 'white', borderRadius: '40px' }}>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 900, marginBottom: '1.5rem' }}>Configuración de Cuenta</h3>
                    <p style={{ color: '#64748b', lineHeight: 1.6 }}>Para actualizar tus datos personales o de contacto, por favor comunícate con el personal de soporte en cualquiera de nuestras sucursales o a través de WhatsApp.</p>
                 </div>
              </div>
            </motion.div>
          )}

          {/* Gifts Tab */}
          {activeTab === 'gifts' && (
            <motion.div 
              key="gifts"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <div className="surface-card" style={{ padding: isMobile ? '1.5rem' : '3rem', background: 'white', borderRadius: '40px' }}>
                <div style={{ 
                  display: 'flex', 
                  flexDirection: isMobile ? 'column' : 'row',
                  justifyContent: 'space-between', 
                  alignItems: isMobile ? 'flex-start' : 'center', 
                  gap: isMobile ? '1rem' : '0',
                  marginBottom: isMobile ? '2rem' : '3rem' 
                }}>
                  <div>
                    <h3 style={{ fontSize: isMobile ? '1.5rem' : '1.75rem', fontWeight: 900, margin: 0 }}>Mis Gift Cards</h3>
                    <p style={{ color: '#64748b', marginTop: '0.5rem' }}>Tarjetas de regalo que has comprado para tus seres queridos.</p>
                  </div>
                  <button onClick={() => navigate('/regalar')} className="btn-primary" style={{ padding: '1rem 2rem', borderRadius: '16px', width: isMobile ? '100%' : 'auto' }}>Regalar Nueva</button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '2rem' }}>
                  {gifts.length > 0 ? gifts.map(gift => (
                    <div key={gift.id} style={{ 
                      background: 'linear-gradient(135deg, #09090b, #27272a)', 
                      padding: '2rem', 
                      borderRadius: '24px', 
                      color: 'white',
                      position: 'relative',
                      overflow: 'hidden'
                    }}>
                       <div style={{ position: 'absolute', top: '-20px', right: '-20px', width: '100px', height: '100px', background: 'rgba(212, 175, 55, 0.1)', borderRadius: '50%', filter: 'blur(30px)' }} />
                       
                       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
                         <Gift size={24} color="#d4af37" />
                         <span style={{ 
                           fontSize: '0.65rem', 
                           fontWeight: 800, 
                           padding: '0.4rem 0.8rem', 
                           borderRadius: '8px', 
                           background: gift.status === 'Active' ? '#10b981' : '#64748b',
                           textTransform: 'uppercase'
                         }}>
                           {gift.status === 'Active' ? 'Activa' : gift.status === 'Partially_Redeemed' ? 'Con Saldo' : 'Agotada'}
                         </span>
                       </div>

                       <p style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 0.25rem' }}>CÓDIGO</p>
                       <h4 style={{ fontSize: '1.5rem', fontWeight: 900, margin: '0 0 1.5rem', fontFamily: 'monospace', letterSpacing: '2px' }}>{gift.code}</h4>

                       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                         <div>
                           <p style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', margin: '0 0 0.25rem' }}>PARA</p>
                           <p style={{ fontWeight: 700, margin: 0 }}>{gift.recipient_name}</p>
                         </div>
                         <div style={{ textAlign: 'right' }}>
                           <p style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', margin: '0 0 0.25rem' }}>SALDO</p>
                           <p style={{ fontSize: '1.25rem', fontWeight: 900, color: '#d4af37', margin: 0 }}>RD$ {Number(gift.balance).toLocaleString()}</p>
                         </div>
                       </div>
                    </div>
                  )) : (
                    <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '4rem 0' }}>
                      <p style={{ color: '#64748b' }}>No has comprado tarjetas de regalo todavía.</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* Visits History Tab */}
          {activeTab === 'visits' && (
            <motion.div 
              key="visits"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
               <div className="surface-card" style={{ padding: '3rem', background: 'white', borderRadius: '40px' }}>
                <h3 style={{ fontSize: '1.75rem', fontWeight: 900, marginBottom: '2.5rem' }}>Historial de Visitas</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {visits.length > 0 ? visits.map((v, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 2rem', background: '#f8fafc', borderRadius: '24px', border: '1px solid #f1f5f9' }}>
                      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                        <div style={{ width: '48px', height: '48px', borderRadius: '16px', background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#09090b', border: '1px solid #e2e8f0' }}>
                          <Scissors size={20} />
                        </div>
                        <div>
                          <p style={{ fontWeight: 800, fontSize: '1rem', margin: 0 }}>{Array.isArray(v.servicios) ? v.servicios.join(', ') : String(v.servicios)}</p>
                          <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>{new Date(v.visited_at).toLocaleDateString('es-ES', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#10b981', background: '#ecfdf5', padding: '0.5rem 1rem', borderRadius: '10px' }}>COMPLETADA</span>
                      </div>
                    </div>
                  )) : (
                    <p style={{ textAlign: 'center', color: '#64748b', padding: '4rem 0' }}>Aún no tienes visitas registradas.</p>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Security Check Modal (Must Change Password) */}
      <AnimatePresence>
        {isPasswordModalOpen && (
          <div style={{ 
            position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', 
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(12px)', 
            zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '2rem'
          }}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }} 
              animate={{ scale: 1, opacity: 1, y: 0 }} 
              style={{ 
                width: '100%', 
                maxWidth: '440px', 
                background: 'white', 
                padding: isMobile ? '2rem' : '3.5rem', 
                borderRadius: isMobile ? '32px' : '40px', 
                textAlign: 'center',
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)'
              }}
            >
              <div style={{ 
                width: '72px', height: '72px', background: '#09090b', color: '#d4af37', 
                borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', 
                margin: '0 auto 2rem', boxShadow: '0 10px 20px rgba(0,0,0,0.1)'
              }}>
                <Lock size={32} />
              </div>
              
              <h2 style={{ fontSize: '1.75rem', fontWeight: 900, marginBottom: '0.75rem', letterSpacing: '-0.02em' }}>Seguridad</h2>
              <p style={{ color: '#64748b', marginBottom: '2.5rem', fontSize: '0.95rem', lineHeight: 1.5, fontWeight: 500 }}>
                Por tu seguridad, actualiza la clave temporal por una nueva privada (mínimo 8 caracteres).
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2.5rem' }}>
                <div style={{ position: 'relative' }}>
                  <input 
                    type={showTempPw ? "text" : "password"} placeholder="Clave Temporal" 
                    value={tempCurrentPassword} onChange={(e) => setTempCurrentPassword(e.target.value)} 
                    style={{ width: '100%', padding: '1.1rem 1.5rem', paddingRight: '3rem', borderRadius: '18px', border: '2px solid #f1f5f9', background: '#f8fafc', fontSize: '0.95rem', fontWeight: 600 }} 
                  />
                  <button type="button" onClick={() => setShowTempPw(!showTempPw)} style={{ position: 'absolute', right: '1rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {showTempPw ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
                <div style={{ position: 'relative' }}>
                  <input 
                    type={showNewPw ? "text" : "password"} placeholder="Nueva Clave Privada" 
                    value={newPassword} onChange={(e) => setNewPassword(e.target.value)} 
                    style={{ width: '100%', padding: '1.1rem 1.5rem', paddingRight: '3rem', borderRadius: '18px', border: '2px solid #f1f5f9', background: '#f8fafc', fontSize: '0.95rem', fontWeight: 600 }} 
                  />
                  <button type="button" onClick={() => setShowNewPw(!showNewPw)} style={{ position: 'absolute', right: '1rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {showNewPw ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
                <div style={{ position: 'relative' }}>
                  <input 
                    type={showConfirmPw ? "text" : "password"} placeholder="Confirmar Nueva Clave" 
                    value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} 
                    style={{ width: '100%', padding: '1.1rem 1.5rem', paddingRight: '3rem', borderRadius: '18px', border: '2px solid #f1f5f9', background: '#f8fafc', fontSize: '0.95rem', fontWeight: 600 }} 
                  />
                  <button type="button" onClick={() => setShowConfirmPw(!showConfirmPw)} style={{ position: 'absolute', right: '1rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {showConfirmPw ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <button 
                  onClick={handlePasswordChange} 
                  className="btn-primary" 
                  style={{ 
                    width: '100%', background: '#09090b', padding: '1.2rem', borderRadius: '20px', 
                    fontSize: '1rem', fontWeight: 800, boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' 
                  }}
                >
                  Actualizar y Acceder
                </button>
                
                <button 
                  onClick={() => { logout(); window.location.href = '/'; }}
                  style={{ 
                    width: '100%', background: 'transparent', color: '#ef4444', padding: '0.8rem', borderRadius: '20px', 
                    fontSize: '0.95rem', fontWeight: 700, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#fef2f2'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <LogOut size={18} /> Cerrar Sesión
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Enhanced Checkout Modal Flow */}
      <AnimatePresence>
        {isCheckoutOpen && (
          <div style={{ 
            position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', 
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)', 
            zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem'
          }}>
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 30 }} 
              animate={{ scale: 1, opacity: 1, y: 0 }} 
              exit={{ scale: 0.95, opacity: 0, y: 30 }}
              style={{ 
                width: '95%', maxWidth: '900px', background: 'white', 
                borderRadius: isMobile ? '28px' : '40px', overflow: 'hidden',
                boxShadow: '0 30px 60px -12px rgba(0,0,0,0.3)',
                position: 'relative',
                maxHeight: '92vh',
                overflowY: 'auto'
              }}
            >
              {/* Close Button */}
              <button 
                onClick={() => { setIsCheckoutOpen(false); setCheckoutStep(1); }} 
                style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', background: '#f1f5f9', border: 'none', width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 10 }}
              >
                <X size={18} />
              </button>

              {/* Progress Stepper */}
              <div style={{ padding: '2.5rem 3rem 0', display: 'flex', gap: '8px' }}>
                {[1, 2, 3].map(step => (
                  <div key={step} style={{ 
                    height: '4px', flex: 1, borderRadius: '2px',
                    background: checkoutStep >= step ? '#d4af37' : '#f1f5f9',
                    transition: '0.4s'
                  }} />
                ))}
              </div>

              <div style={{ padding: isMobile ? '1.5rem' : '2rem 3rem 3.5rem' }}>
                <AnimatePresence mode="wait">
                  {checkoutStep === 1 && (
                    <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', background: '#ffffff', borderRadius: '32px', overflow: 'hidden', minHeight: isMobile ? 'auto' : '400px', border: '1px solid #f1f5f9' }}>
                  {/* Left Side: Benefits */}
                  <div style={{ flex: 1, padding: isMobile ? '1.5rem' : '3rem', borderRight: isMobile ? 'none' : '1px solid #f8fafc', borderBottom: isMobile ? '1px solid #f8fafc' : 'none' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2.5rem' }}>
                            <User size={32} color="#1e293b" />
                            <h2 style={{ fontSize: '1.75rem', fontWeight: 900, margin: 0, textTransform: 'uppercase', letterSpacing: '1px' }}>
                              PLAN <span style={{ color: '#ec4899' }}>BEAUTY</span> RD
                            </h2>
                          </div>
                          
                          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '1.25rem' }}>
                            {[
                              '4 lavados cada 30 días',
                              'Sin importar el largo natural',
                              'Uso exclusivo para ti',
                              'Atención profesional',
                              'Ofertas exclusivas',
                              'Cancelación flexible'
                            ].map((text, i) => (
                              <li key={i} style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '1rem', color: '#475569', fontWeight: 600 }}>
                                <div style={{ color: '#94a3b8' }}><CheckCircle2 size={20} /></div> {text}
                              </li>
                            ))}
                          </ul>
                        </div>

                  {/* Right Side: Pricing & Action */}
                  <div style={{ flex: 1, padding: isMobile ? '2rem' : '3rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#fafafa' }}>
                          <p style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '1.5rem' }}>TODO LO QUE NECESITAS</p>
                          
                          <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
                            <h3 style={{ fontSize: '3.5rem', fontWeight: 900, margin: 0, color: '#1e293b', lineHeight: 1 }}>RD$1,950<span style={{ fontSize: '1.5rem', color: '#cbd5e1' }}>/</span></h3>
                            <p style={{ fontSize: '1.1rem', fontWeight: 800, color: '#94a3b8', margin: '0.5rem 0 0', textTransform: 'uppercase' }}>MES</p>
                          </div>

                          <button 
                            onClick={() => {
                              const plan = availablePlans.find(p => parseFloat(p.price) === 1950) || availablePlans[0] || { id: 'plan_monthly_1', name: 'PLAN BEAUTY', price: 1950 };
                              setSelectedPlan(plan);
                              setCheckoutStep(2);
                            }}
                            style={{ 
                              width: '100%', background: '#f472b6', color: 'white', padding: '1.2rem', 
                              borderRadius: '12px', fontWeight: 900, border: 'none', fontSize: '1.1rem',
                              cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '1px',
                              boxShadow: '0 10px 20px rgba(244, 114, 182, 0.3)', marginBottom: '1rem'
                            }}
                          >
                            QUIERO MI PLAN
                          </button>
                          
                          <p style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
                            <Lock size={14} /> Pagos seguros y automáticos
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {checkoutStep === 2 && (
                    <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                      <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
                        <h2 style={{ fontSize: '1.75rem', fontWeight: 900, marginBottom: '0.5rem' }}>Verificación de Identidad</h2>
                        <p style={{ color: '#64748b' }}>Por seguridad, necesitamos validar tu identidad antes de firmar.</p>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? '1rem' : '2rem', marginBottom: '2rem' }}>
                        {/* Document Photo */}
                        <div style={{ 
                          padding: '2rem', border: '2px dashed #e2e8f0', borderRadius: '32px', textAlign: 'center',
                          background: documentPhoto ? '#f0fdf4' : '#f8fafc', borderColor: documentPhoto ? '#10b981' : '#e2e8f0'
                        }}>
                          <div style={{ width: '64px', height: '64px', background: 'white', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', boxShadow: '0 10px 15px rgba(0,0,0,0.05)' }}>
                            <CreditCard size={32} color={documentPhoto ? '#10b981' : '#64748b'} />
                          </div>
                          <h4 style={{ margin: '0 0 0.5rem', fontWeight: 800 }}>Foto de Cédula</h4>
                          <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '1.5rem' }}>Asegúrate que los datos sean legibles.</p>
                          
                          {documentPreview ? (
                            <img src={documentPreview} style={{ width: '100%', height: '140px', objectFit: 'cover', borderRadius: '16px', marginBottom: '1rem' }} alt="Preview" />
                          ) : null}

                          <label style={{ 
                            display: 'block', padding: '0.8rem', background: '#09090b', color: 'white', 
                            borderRadius: '14px', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' 
                          }}>
                            {documentPhoto ? 'Cambiar Foto' : 'Tomar Foto'}
                            <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => handleFileChange(e, 'document')} />
                          </label>
                        </div>

                        {/* Selfie Photo */}
                        <div style={{ 
                          padding: '2rem', border: '2px dashed #e2e8f0', borderRadius: '32px', textAlign: 'center',
                          background: selfiePhoto ? '#f0fdf4' : '#f8fafc', borderColor: selfiePhoto ? '#10b981' : '#e2e8f0'
                        }}>
                          <div style={{ width: '64px', height: '64px', background: 'white', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', boxShadow: '0 10px 15px rgba(0,0,0,0.05)' }}>
                            <User size={32} color={selfiePhoto ? '#10b981' : '#64748b'} />
                          </div>
                          <h4 style={{ margin: '0 0 0.5rem', fontWeight: 800 }}>Selfie de Validación</h4>
                          <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '1.5rem' }}>Tu rostro debe estar bien iluminado.</p>
                          
                          {selfiePreview ? (
                            <img src={selfiePreview} style={{ width: '100%', height: '140px', objectFit: 'cover', borderRadius: '16px', marginBottom: '1rem' }} alt="Preview" />
                          ) : null}

                          <label style={{ 
                            display: 'block', padding: '0.8rem', background: '#09090b', color: 'white', 
                            borderRadius: '14px', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' 
                          }}>
                            {selfiePhoto ? 'Cambiar Foto' : 'Tomar Selfie'}
                            <input type="file" accept="image/*" capture="user" hidden onChange={(e) => handleFileChange(e, 'selfie')} />
                          </label>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '1rem' }}>
                        <button onClick={() => setCheckoutStep(1)} style={{ flex: 1, padding: '1.2rem', borderRadius: '20px', border: '2px solid #f1f5f9', background: 'white', fontWeight: 800, cursor: 'pointer' }}>Volver</button>
                        <button 
                          disabled={!documentPhoto || !selfiePhoto}
                          onClick={() => setCheckoutStep(3)} 
                          style={{ 
                            flex: 1, padding: '1.2rem', borderRadius: '20px', border: 'none', 
                            background: (!documentPhoto || !selfiePhoto) ? '#e2e8f0' : '#09090b', 
                            color: 'white', fontWeight: 800, cursor: 'pointer' 
                          }}
                        >
                          Continuar al Contrato
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {checkoutStep === 3 && (
                    <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                      <h2 style={{ fontSize: '1.75rem', fontWeight: 900, marginBottom: '0.5rem' }}>Contrato de Adhesión</h2>
                      <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '1.5rem' }}>Por favor, lee y acepta el contrato íntegro de servicios.</p>
                      
                      <div style={{ 
                        maxHeight: isMobile ? '300px' : '400px', overflowY: 'auto', background: '#f8fafc', padding: isMobile ? '1.5rem' : '2.5rem', borderRadius: '24px', fontSize: '0.85rem', 
                        lineHeight: 1.8, color: '#334155', border: '1px solid #f1f5f9', marginBottom: '2rem', textAlign: 'justify', whiteSpace: 'pre-wrap'
                      }}>
                        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                          <h4 style={{ margin: 0, color: '#000', fontWeight: 900 }}>CONTRATO DE SUSCRIPCIÓN DE SERVICIOS DE BELLEZA</h4>
                        </div>
                        
                        <p>Entre los subscritos, La empresa: <strong>ETEREAS S. R. L.</strong>, debidamente constituida de conformidad con las leyes de la Republica Dominicana, con Registro Nacional del Contribuyente No. 1-31-91703-8, con su domicilio social en la Av. San Vicente De Paul esquina Calle Puerto Rico, Alma Rosa I, Plaza El Poder, Local 1F, Santo Domingo Este, Municipio De La De Provincia Santo Domingo, quien en lo que sigue del presente contrato se denominara, <strong>LA COMPAÑIA</strong>, y de la otra parte la Sra. <strong>{fullClient?.nombre || '________________'}</strong>, Dominicana, mayor de edad, portadora de la cedula de identidad y electoral No. <strong>{fullClient?.cedula || '_______________'}</strong>, domiciliada y residente en la Calle <strong>{fullClient?.calle || '________________'} No. {fullClient?.numero || '___'}, Sector {fullClient?.sector || '________________'}</strong>, de <strong>{fullClient?.ciudad || fullClient?.localidad || '________________'}</strong> quien en lo que sigue del presente contrato se denominara <strong>EL CLIENTE</strong>.</p>

                        <p><strong>1.0	-	Objeto del Contrato.</strong> Este Contrato contiene los términos y condiciones del Servicio de Belleza, consistente en Lavado y Secado de Pelo que será prestado por LA COMPAÑÍA AL CLIENTE.</p>

                        <p><strong>1.1-	LA COMPANIA:</strong> ETEREAS S. R. L., la cual forma parte de la cadena: ABATTE PELUQUERIA, proveerá los servicios de lavado y secado de pelo a través de las localidades abierta al público como son:<br/>a)	Inicialmente en la Sucursal Av. San Vicente de Paul.</p>

                        <p><strong>1.2-	Requisito para Contratar este Servicio:</strong> Es condición indispensable para poder adquirir y mantener el Servicio de Belleza bajo Suscripción, que El CLIENTE haya adquirido y suscrito contrato de lavado y secado de pelo, con LA COMPAÑIA.</p>

                        <p><strong>1.3-	EL CLIENTE acepta y elije el plan: {selectedPlan?.title || contract?.plan_name || 'Plan Beauty'}</strong> como su Servicio de Belleza.</p>

                        <p><strong>1.4-	El presente Contrato formará parte integral del plan de servicios que previamente haya elegido EL CLIENTE con LA COMPAÑÍA, según se describe a continuación:</strong></p>

                        <p><strong>2-	Descripción del Servicio.</strong> LA COMPAÑIA conviene en proveer a EL CLIENTE el " Servicio de Belleza", que consiste en brindar el servicio de lavado y secado de pelo para todo el mes, mediante el cual el cliente podrá utilizar el servicio en una de nuestras localidades identificadas, abiertas al público y acorde con plan de su preferencia.</p>

                        <p><strong>3-	Características del Servicio.</strong> El "Servicio de Belleza" consiste proveer personas capacitadas y productos de clase mundial para el lavado y secado de pelo del CLIENTE, pero, no provee uso de producto de línea especializadas. El uso de marcas especializadas por elección es responsabilidad exclusiva del CLIENTE.</p>

                        <p><strong>3.1-	Disponibilidad del servicio.</strong> La disponibilidad del servicio de Lavado y Secado de pelo es de hasta un 99.9% al año, conforme a su disponibilidad operativa, pone a disposición de EL CLIENTE cuatro (04) servicios de lavados sencillos y secado cada Treinta (30) días calendario, con excepción de aquellas indisponibilidades producidas por fenómenos atmosféricos, accidentes, cualquier caso fortuito, o fuerza mayor.</p>

                        <p><strong>3.2- El servicio.</strong> Es intransferible, ni acumulable, es decir; no se permite uso del servicio por parte de tercero, de igual forma, no se permite combinar múltiples servicios para compensarlo con cantidades de servicio no utilizado correspondiente a la presente suscripción.</p>

                        <p><strong>3.3-	Los costos derivados del uso de materiales o servicios no incluido en el plan elegido o contratado quedarán a cargo y a costo de EL CLIENTE.</strong></p>

                        <p><strong>3.4-	La falta de pago produce por defecto la suspensión del servicio y su reactivación se producirá solo si EL CLIENTE ha realizado el pago total de todas las cuotas vencidas incluyendo la que corresponde al mes por adelantado. Ante el incumplimiento de pago LA COMPAÑÍA se reserva el derecho de cancelar el presente contrato bajo la más amplia reserva de acciones para garantizar el cumplimiento del presente contrato.</strong></p>

                        <p><strong>3.5-	El servicio deberá ser utilizado por EL CLIENTE bajo condiciones normales de uso conforme a la naturaleza del plan contratado; en consecuencia, LA COMPAÑÍA podrá establecer límites razonables en la frecuencia de utilización del servicio, incluyendo un máximo de un (1) servicio por día, así como suspender o restringir su acceso cuando el uso exceda dichas condiciones.</strong></p>

                        <p><strong>Obligaciones del CLIENTE: EL CLIENTE deberá:</strong><br/>
                        EL CLIENTE estará obligado al pago del servicio elegido en el presente contrato, condición indispensable para tener la disponibilidad del servicio en nuestros centros de atención al cliente.<br/>
                        EL CLIENTE tendrá derecho, a hacer sin costo alguno en el plazo de un (1) mes, una cantidad máxima de {usageStats[0]?.quota || '4'} solicitudes de servicios en nuestros centros de atención al cliente según el plan contratado inicialmente. A partir de ahí, EL CLIENTE deberá pagar el valor adicional que LA COMPAÑIA haya informado al momento de la solicitud efectuada por EL CLIENTE.<br/>
                        EL CLIENTE podrá solicitar en cualquier momento el cambio a un plan superior. Dicho cambio será efectivo de inmediato, debiendo EL CLIENTE pagar la diferencia correspondiente al nuevo plan seleccionado al momento de la solicitud</p>

                        <p><strong>4-	Precio del Servicio:</strong> EL CLIENTE acuerda pagar a LA COMPAÑÍA por el servicio prestado, una renta mensual de <strong>{selectedPlan?.price || contract?.contract_price || '1950.00'} PESOS DOMINICANOS CON 00/100 (RD$ {selectedPlan?.price || contract?.contract_price || '1950.00'})</strong>. Todos los cargos de renta por los servicios contratados mediante el presente contrato serán facturados mensualmente por adelantado. Asimismo, EL CLIENTE acepta y autoriza un cargo de activación por renovación de contrato de <strong>RD$ 800.00 anual</strong>, el cual se cobrará automáticamente en cada aniversario de la firma.</p>

                        <p><strong>4.1-	Forma de Pago:</strong> EL CLIENTE es responsable de la inscripción de una tarjeta de crédito al momento de la contratación del servicio para realizar el debito del servicio de forma recurrente y automática.</p>

                        <p><strong>4.2-	EL CLIENTE autoriza de manera expresa a LA COMPAÑÍA a realizar el cobro automático y recurrente de los montos correspondientes al plan contratado, incluyendo cargos de activación y renovaciones, mediante la tarjeta registrada al momento de la suscripción. EL CLIENTE será responsable de mantener un método de pago válido y con fondos disponibles; en caso de que un cobro no pueda ser procesado, LA COMPAÑÍA podrá realizar reintentos automáticos y/o suspender el servicio hasta tanto se regularice el pago, sin perjuicio de las acciones necesarias para el cobro de los montos adeudados.</strong></p>

                        <p><strong>4.3-	Queda expresamente convenido entre las Partes que los precios y rentas estipulados en el presente Contrato podrán ser ajustados conforme el impacto que presente el índice de precio al consumidor.</strong></p>

                        <p><strong>4.4-	Cancelación del servicio:</strong> Las partes acuerdan que EL CLIENTE reconoce que el plan contratado incluye tarifas preferenciales y beneficios promocionales otorgados por LA COMPAÑÍA; en caso de cancelación anticipada, LA COMPAÑÍA podrá recalcular los servicios efectivamente utilizados a su precio regular vigente al momento de la prestación, conforme a las tarifas publicadas por LA COMPAÑÍA, debiendo EL CLIENTE pagar la diferencia entre dicho valor y el monto pagado hasta la fecha, sin que esto constituya una penalidad sino la pérdida de los beneficios otorgados bajo el plan.<br/>
                        Las partes acuerdan que, para la aplicación de las penalidades precedentemente enunciadas, el punto de partida del plazo de duración del contrato correrá a partir de la fecha de firma del contrato</p>

                        <p><strong>4.5-	Los pagos realizados por EL CLIENTE bajo el presente plan son anticipados y corresponden a la activación, reserva y disponibilidad del servicio, por lo que, una vez procesados, no son reembolsables bajo ninguna circunstancia; en consecuencia, la cancelación del servicio por parte de EL CLIENTE no dará lugar a devoluciones totales ni parciales de los montos ya pagados.</strong></p>

                        <p><strong>4.6-	EL CLIENTE autoriza la captura de datos biométricos para garantizar su identidad y prevenir fraude electrónico; al mismo tiempo, aprueba y reconoce como bueno y valido la firma digital o electrónica en el uso del presente contrato.</strong></p>

                        <p><strong>4.7-	EL CLIENTE es responsable de la degradación que puedan sufrir los tintes o aplicaciones que tenga durante el proceso de lavado o secado, y además, por medio del presente contrato descarga de responsabilidad a LA COMPAÑÍA por cualquiera de los casos anteriormente señalados.</strong></p>

                        <p><strong>Obligaciones de LA COMPAÑÍA:</strong><br/>
                        a) LA COMPAÑIA entregará al CLIENTE el nombre del usuario y la contraseña de acceso a la web: www.Planbeautyrd.com para que el CLIENTE pueda realizar consultas sobre el estado del servicio EL CLIENTE de acuerdo al plan contratado de Servicio De Belleza bajo Suscripción señalado en el contrato.<br/>
                        b) LA COMPAÑIA entregará al CLIENTE acceso a visualizar en un portal un resumen de todos los servicios incluido dentro de su plan y la cantidad de servicios consumido dentro de su plan a la fecha.<br/>
                        c) Mantener en estricta confidencialidad la información de usuario y contraseña de acceso al portal web, por lo cual es responsabilidad exclusiva del CLIENTE el uso y manejo de tal información. Para tales efectos EL CLIENTE luego de que LA COMPAÑÍA le haya suministrado el nombre de usuario y su respectiva clave de seguridad, deberá realizar el cambio de la clave para su personalización y garantía.</p>

                        <p><strong>5-	 Duración y Terminación.</strong> El presente contrato tendrá una duración inicial de doce (12) meses contados a partir de su firma. Vencido dicho período, el contrato se renovará automáticamente por períodos iguales, salvo que EL CLIENTE notifique por escrito su intención de no renovar con al menos treinta (30) días de antelación a la fecha de vencimiento. En caso de no recibir dicha notificación, se entenderá que EL CLIENTE acepta la renovación, autorizando la continuidad del servicio y el cobro automático correspondiente bajo las condiciones vigentes al momento de la renovación.</p>

                        <p><strong>5.1-	LA COMPAÑÍA aplicará un cargo de activación de RD$ 800.00 al momento de cada renovación anual del contrato, el cual será debitado automáticamente por el medio de pago autorizado por EL CLIENTE, conforme a las condiciones comerciales vigentes.</strong></p>

                        <p><strong>5.2-	LA COMPAÑÍA se reserva el derecho de renovar o no el presente contrato con previa notificación de 30 días a EL CLIENTE.</strong></p>

                        <p><strong>5.3-	Al momento de EL CLIENTE solicitar la cancelación del servicio LA COMPAÑÍA le estará notificando al cliente por escrito o por cualquier medio escrito o electrónico, en un plazo de Cinco (5) días, el valor que le será debitado de su tarjeta como ultimo pago.</strong></p>

                        <p><strong>6-	Las partes acuerdan que para todo lo no previsto en el presente contrato se remiten al derecho del consumidor y posteriormente al Derecho común. Hecho y firmados en dos originales uno para cada una de las partes. En Santo Domingo Este, Municipio de la Provincia de Santo Domingo a los {new Date().getDate()} días del mes de {new Date().toLocaleDateString('es-ES', { month: 'long' })} del año {new Date().getFullYear()}</strong></p>

                        <div style={{ marginTop: '3rem', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? '2rem' : '3rem' }}>
                          <div>
                            <p><strong>Por LA COMPAÑÍA</strong></p>
                            <p>Nombre: ETEREAS S. R. L.</p>
                            <p>Posición: Representante Legal</p>
                            <p>Cedula: 1-31-91703-8</p>
                            <p style={{ marginTop: '2rem', borderTop: '1px solid #000', paddingTop: '0.5rem' }}>Firma</p>
                          </div>
                          <div>
                            <p><strong>Por EL CLIENTE</strong></p>
                            <p>Nombre: {fullClient?.nombre || '________________'}</p>
                            <p>Posición: Cliente Suscrito</p>
                            <p>Cedula: {fullClient?.cedula || '_______________'}</p>
                            <p style={{ marginTop: '2rem', borderTop: '1px solid #000', paddingTop: '0.5rem' }}>Firma Digital (Checkbox)</p>
                          </div>
                        </div>
                      </div>

                      <div style={{ 
                        padding: '1.5rem', 
                        border: isContractAccepted ? '2px solid #d4af37' : '2px dashed #cbd5e1', 
                        background: isContractAccepted ? '#fffdf5' : '#f8fafc', 
                        borderRadius: '24px', textAlign: 'center', marginBottom: '2.5rem',
                        transition: 'all 0.3s ease'
                      }}>
                         <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', cursor: 'pointer' }}>
                            <input 
                              type="checkbox" 
                              checked={isContractAccepted}
                              onChange={(e) => setIsContractAccepted(e.target.checked)}
                              style={{ width: '24px', height: '24px', accentColor: '#d4af37' }} 
                            />
                            <span style={{ fontSize: '1rem', fontWeight: 800, color: isContractAccepted ? '#1e293b' : '#64748b' }}>He leído y acepto el contrato íntegro</span>
                         </label>
                         <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: isContractAccepted ? '#92400e' : '#94a3b8', fontWeight: 600 }}>Al marcar esta casilla, reconoces tu firma digital y aceptación de los términos.</p>
                      </div>

                      <div dangerouslySetInnerHTML={{
                         __html: `
                           <form id="checkout_form_fake_dashboard" style="display: none;">
                              <input type="hidden" id="PWToken" name="PWToken" />
                           </form>
                         `
                      }} />

                      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '1rem' }}>
                        <button onClick={() => setCheckoutStep(2)} style={{ flex: 1, padding: '1.2rem', borderRadius: '20px', border: '2px solid #f1f5f9', background: 'white', fontWeight: 800, cursor: 'pointer', fontSize: '1rem' }}>Volver</button>
                        <button 
                          onClick={handleFinalPayment} 
                          className="btn-primary" 
                          disabled={!isContractAccepted || loading}
                          style={{ 
                            flex: 2, 
                            background: isContractAccepted ? '#09090b' : '#e2e8f0', 
                            color: isContractAccepted ? 'white' : '#94a3b8',
                            padding: '1.2rem', borderRadius: '20px', fontWeight: 800, fontSize: '1rem',
                            cursor: isContractAccepted ? 'pointer' : 'not-allowed',
                            border: 'none',
                            display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem'
                          }}
                        >
                          {loading ? 'CONECTANDO...' : 'Pagar Seguro en CardNet'}
                        </button>
                      </div>
                    </motion.div>
                  )}

                </AnimatePresence>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ClientDashboard;
