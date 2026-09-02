import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { dataService } from '../../utils/dataService';
import { getCardNetErrorMessage } from '../../utils/cardnetErrors';
import { loadCardNetScript } from '../../utils/cardnetScriptLoader';
import { FileSignature, Camera, ShieldCheck, Smartphone, Info, Search, UserCheck, CreditCard, Calendar, TrendingUp, Scissors, Trash2, Edit2, Plus, ArrowLeft, RefreshCw, AlertTriangle, User, Award, Mail, Phone, Settings, Users, DollarSign, MapPin, Banknote } from 'lucide-react';
import { useTranslation } from '../../context/LanguageContext';
import { motion } from 'framer-motion';
import { useNotification } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';
import { Lock, CheckCircle, ShieldOff } from 'lucide-react';

const ClientProfile = () => {
  const { t } = useTranslation();
  const { showNotification } = useNotification();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [client, setClient] = useState(null);
  const [allClients, setAllClients] = useState([]);
  const [visits, setVisits] = useState([]);
  const [payments, setPayments] = useState([]);
  const { user } = useAuth();
  
  // OTP States
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otpValue, setOtpValue] = useState('');
  const [activeOtpCode, setActiveOtpCode] = useState(null);
  const [deductingService, setDeductingService] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [listFilter, setListFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all, active, inactive
  const [giftCards, setGiftCards] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [selectedStaff, setSelectedStaff] = useState({
    peluquera: '',
    lavaPelo: '',
    manicurista: ''
  });

  // Survey States
  const [showSurveyModal, setShowSurveyModal] = useState(false);
  const [pendingSurvey, setPendingSurvey] = useState(null);
  const [surveyForm, setSurveyForm] = useState({
    q1: 10, q2: 10, q3: 10, q4: 10, q5: 10, q6: ''
  });
  const [isSubmittingSurvey, setIsSubmittingSurvey] = useState(false);
  const [actionModal, setActionModal] = useState({ open: false, type: null, code: '', loading: false });

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const clientsData = await dataService.getClients().catch(() => []);

        if (!Array.isArray(clientsData)) {
          setAllClients([]);
          return;
        }

        const mapped = clientsData.map(c => ({
          ...c,
          planName: c.planName || 'Sin Plan'
        }));

        setAllClients(mapped);
      } catch (err) {
        console.error("Error fetching clients in Profile:", err);
        setAllClients([]);
      }
    };
    const fetchEmployees = async () => {
      try {
        const data = await dataService.getEmployees();
        setEmployees(data || []);
      } catch (err) {
        console.error("Error fetching employees:", err);
      }
    };
    fetchAll();
    fetchEmployees();
  }, [client]); // Keep client as dependency if you want to refresh list after selection updates

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!searchTerm) {
      setClient(null);
      return;
    }
    const found = await dataService.findClientByCedula(searchTerm);
    if (found) {
      await selectClient(found);
    } else {
      alert('Cliente no encontrado');
      setClient(null);
    }
  };

  const [contracts, setContracts] = useState([]);
  const [activePlans, setActivePlans] = useState([]);
  const [pendingCharge, setPendingCharge] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [cardInfo, setCardInfo] = useState(null);
  const [allCards, setAllCards] = useState([]);
  const [editingCard, setEditingCard] = useState(null);
  const [editCardForm, setEditCardForm] = useState({ expiration: '', enable: true });
  
  // Get the primary active contract for display
  const contract = contracts.find(c => c.status === 'Active' || c.status === 'Pending_Retry') || contracts[0];

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ nombre: '', email: '', telefono: '', cedula: '' });
  
  // Card Update states
  const [isUpdatingCard, setIsUpdatingCard] = useState(false);
  const [cardnetLog, setCardnetLog] = useState('');
  const [isProcessingCard, setIsProcessingCard] = useState(false);
  const [useSimulatedModal, setUseSimulatedModal] = useState(false);

  const selectClient = async (found) => {
    setCardInfo(null); // Reset state before new fetch
    setClient(found);
    setEditForm({
      nombre: found.nombre,
      email: found.email,
      telefono: found.telefono,
      cedula: found.cedula,
      calle: found.calle || '',
      numero: found.numero || '',
      sector: found.sector || '',
      ciudad: found.ciudad || '',
      fecha_nacimiento: found.fecha_nacimiento ? found.fecha_nacimiento.split('T')[0] : ''
    });
    setVisits(await dataService.getVisitsByClient(found.id));
    setPayments(await dataService.getPaymentsByClient(found.id));
    setGiftCards(await dataService.getGiftsByClient(found.id));
    
    const info = await dataService.getPaymentProfileByClient(found.id);
    console.log('Card Info fetched:', info);
    setCardInfo(info);

    const cards = await dataService.getPaymentProfilesByClient(found.id);
    console.log('All Cards fetched from vault:', cards);
    setAllCards(Array.isArray(cards) ? cards : []);
    
    const contractsFound = await dataService.getContractByClient(found.id);
    const allPlans = await dataService.getPlans();

    if (Array.isArray(contractsFound)) {
      setContracts(contractsFound);
      const planesActivos = allPlans.filter(p => contractsFound.some(c => c.plan_id === p.id && (c.status === 'Active' || c.status === 'Pending_Retry')));
      setActivePlans(planesActivos);
    } else {
      setContracts([]);
      setActivePlans([]);
    }
    // Check for pending survey
    try {
      const pending = await dataService.getPendingSurvey(found.id);
      setPendingSurvey(pending);
    } catch (e) {
      console.warn("No pending survey found or error:", e.message);
    }

    // Clear search to show the current selected one
    setSearchTerm(found.cedula);

    if (found.status === 'Cancelled' || contractsFound?.some(c => c.status === 'Cancelled')) {
      showNotification('ATENCIÓN: Este cliente tiene su contrato CANCELADO voluntariamente.', 'error');
    } else if (found.status === 'Inactive' || (contractsFound && contractsFound.some(c => c.status === 'Pending_Retry'))) {
      showNotification('AVISO: Cliente con cobro pendiente en reintento automático diario.', 'warning');
    }
  };

  const handleManualPayment = async (targetContract, targetPlan) => {
    if (!targetContract || !targetPlan) return;
    
    if (window.confirm(`¿Estás seguro de registrar un pago manual de RD$ ${targetPlan.price} en Efectivo/POS para reactivar el plan ${targetPlan.title} de ${client.nombre}?`)) {
      try {
        await dataService.renewManualContract(client?.id, targetPlan?.price);
        showNotification('Pago registrado exitosamente. Plan reactivado.');
        // Reload data
        await selectClient(client);
      } catch (e) {
        showNotification('Error: ' + e.message, 'error');
      }
    }
  };

  const handleSaveEdit = async () => {
    try {
      await dataService.updateClient(client.id, editForm);
      setClient({ ...client, ...editForm });
      setIsEditing(false);
      showNotification('Perfil actualizado con éxito');
    } catch (e) {
      showNotification('Error al actualizar: ' + e.message, 'error');
    }
  };

  const openCardNetUpdater = async () => {
    setCardnetLog('');
    setUseSimulatedModal(false);
    setIsUpdatingCard(true);
    setIsProcessingCard(true);

    try {
      console.log("[CARDNET] Iniciando sesión para actualización...");
      const customer = await dataService.cardnetCreateCustomer(client?.email, client?.id);

      if (!customer.CustomerId || !customer.UniqueID) {
        throw new Error("No se pudo obtener sesión de CardNet.");
      }

      const public_key = customer.publicKey || customer.PublicKey || "J_eHXPYlDo9wlFpFXjgalm_I56ONV7HQ";
      const capture_url = customer.captureUrl || customer.CaptureURL || "https://labservicios.cardnet.com.do/servicios/tokens/v1/Capture";

      // Cargar dinámicamente la librería de CardNet con las credenciales de esta sesión
      await loadCardNetScript(public_key, capture_url);

      if (typeof window.PWCheckout === 'undefined') {
        throw new Error("SDK CardNet no se pudo inicializar.");
      }

      // PARCHE ANTI-CRASH PARA CARDNET EN PERFIL
      const patchCardnet = setInterval(() => {
          if (window.PWCheckout && window.PWCheckout.Iframe && window.PWCheckout.Iframe.Close) {
              clearInterval(patchCardnet);
              const originalClose = window.PWCheckout.Iframe.Close;
              window.PWCheckout.Iframe.Close = function () {
                  console.log("[CardNet Perfil] Intentando cerrar iframe...");
                  if (!document.getElementById(window.PWCheckout.Iframe.frameId)) {
                      console.warn("[CardNet Perfil] El Iframe ya no existe, ignorando cierre para evitar crash.");
                      return;
                  }
                  try {
                      originalClose.apply(this, arguments);
                      console.log("[CardNet Perfil] Cierre ejecutado.");
                  } catch (err) {
                      console.error("[CardNet Perfil] Error interno silenciado:", err);
                  }
              };
          }
      }, 100);

      window.PWCheckout.Bind("tokenCreated", async (token) => {
        if (token && token.TokenId) {
          clearInterval(patchCardnet);
          try {
            showNotification("Validando nueva tarjeta...");
            const res = await dataService.updatePaymentMethod(client.id, token.TokenId);
            if (res.success) {
              showNotification("¡Tarjeta actualizada con éxito!", "success");
              setIsUpdatingCard(false);
              await selectClient(client); // Refresh card info
              
              // Cierre limpio
              setTimeout(() => {
                try { if (window.PWCheckout?.Iframe) window.PWCheckout.Iframe.Close(); } catch(e) {}
              }, 500);
            } else {
              throw new Error(res.error || "Error al vincular.");
            }
          } catch (e) {
            setCardnetLog(e.message);
          }
        }
      });

      // Configurar propiedades correctas para el Iframe (sin imagen rota de Imgur)
      window.PWCheckout.SetProperties({
        "name": "Abatte Peluquería",
        "email": client.email || "correo@default.com",
        "button_label": "Guardar Tarjeta",
        "description": "Actualización de Método de Pago",
        "currency": "DOP",
        "amount": "0", 
        "lang": "ESP",
        "form_id": "checkout_form_fake_profile",
        "checkout_card": "1",
        "session_id": customer.UniqueID,
        "autoSubmit": "false"
      });

      let cleanCaptureUrl = capture_url;
      if (!cleanCaptureUrl.endsWith('/')) cleanCaptureUrl += '/';
      const finalUrl = `${cleanCaptureUrl}?key=${public_key}&session_id=${customer.UniqueID}`;
      
      window.PWCheckout.OpenIframeCustom(finalUrl, customer.UniqueID);
      setIsProcessingCard(false);

    } catch (e) {
      console.warn("[CARDNET] Error en sesión real. Activando simulación local:", e.message);
      showNotification("Servidor de CardNet fuera de línea. Activando modo de simulación local de contingencia.", "warning");
      setUseSimulatedModal(true);
      setIsProcessingCard(false);
    }
  };

  const handleUpdateCard = async (card) => {
    try {
      showNotification('Actualizando configuración de tarjeta...');
      const res = await dataService.cardnetUpdateProfile(
        client.cardnet_customer_id, 
        card.PaymentProfileId, 
        editCardForm.expiration, 
        editCardForm.enable
      );
      
      if (res.error || (res.ErrorCode && res.ErrorCode !== "0")) {
        const friendlyMsg = getCardNetErrorMessage(res.details || res);
        showNotification(friendlyMsg, 'error');
        setCardnetLog(friendlyMsg);
        return;
      }
      
      // CardNet success can be ResponseCode "00", Status "Success", or returning the object with CustomerId/PaymentProfileId
      const isSuccess = res.ResponseCode === "00" || 
                        res.Status === "Success" || 
                        res.PaymentProfileId || 
                        res.CustomerId ||
                        res.Enabled !== undefined;

      if (isSuccess) {
        showNotification('Tarjeta actualizada correctamente', 'success');
        setEditingCard(null);
        await selectClient(client);
      } else {
        throw new Error(res.Message || res.error || 'Error al actualizar tarjeta');
      }
    } catch (e) {
      showNotification(e.message, 'error');
    }
  };

  const handleDeleteCard = async (card) => {
    if (!window.confirm(`¿Estás seguro de eliminar la tarjeta terminada en ${card.Last4}? Esta acción no se puede deshacer.`)) return;

    try {
      showNotification('Eliminando tarjeta...');
      const res = await dataService.cardnetDeleteProfile(client.cardnet_customer_id, card.PaymentProfileId);
      
      if (res.error || (res.ErrorCode && res.ErrorCode !== "0")) {
        const friendlyMsg = getCardNetErrorMessage(res.details || res);
        showNotification("Error al eliminar: " + friendlyMsg, "error");
        return;
      }

      const isSuccess = res.ResponseCode === "00" || 
                        res.Status === "Success" || 
                        res.PaymentProfileId || 
                        res.CustomerId;

      if (isSuccess) {
        showNotification('Tarjeta eliminada con éxito', 'success');
        
        // If this was the card used in the contract, unlink it locally too
        if (contract && contract.payment_profile_id === card.PaymentProfileId) {
          await dataService.unlinkCard(client.id);
        }
        
        await selectClient(client);
      } else {
        throw new Error(res.Message || 'Error al eliminar tarjeta');
      }
    } catch (e) {
      showNotification(e.message, 'error');
    }
  };

  const handleChargeCard = async (specificCard = null) => {
    // Evitar que el evento de clic de React sea tratado como un objeto de tarjeta válido
    const isValidCardObj = specificCard && (typeof specificCard === 'object') && ('PaymentProfileId' in specificCard);
    const cardToUse = isValidCardObj ? specificCard : cardInfo;
    
    if (!cardToUse || !cardToUse.PaymentProfileId) {
      showNotification('No hay una tarjeta seleccionada o configurada para realizar el cobro.', 'error');
      return;
    }

    const planForContract = activePlans.find(p => p.id === contract?.plan_id);
    const amount = planForContract ? planForContract.price : "0.00";

    setPendingCharge({
      card: cardToUse,
      amount: amount
    });
    setShowPaymentModal(true);
  };

  const handleSurveySubmit = async () => {
    setIsSubmittingSurvey(true);
    try {
      await dataService.submitSurvey(client.id, surveyForm);
      showNotification('¡Gracias por tu feedback! Tu opinión nos ayuda a mejorar.', 'success');
      setShowSurveyModal(false);
      setPendingSurvey(null);
    } catch (e) {
      showNotification('Error al enviar la encuesta: ' + e.message, 'error');
    } finally {
      setIsSubmittingSurvey(false);
    }
  };

  const confirmAndStartOTP = async () => {
    if (!pendingCharge) return;
    const { amount } = pendingCharge;
    
    setShowPaymentModal(false);
    setDeductingService(`Cobro de RD$ ${parseFloat(amount).toLocaleString('en-US')}`);
    setShowOtpModal(true);
    setOtpValue('');
    setActiveOtpCode(null);

    showNotification("Generando código de seguridad para el cobro...", "info");
    const res = await dataService.generateOTP(client.id, client.email);
    if (res.error) {
      showNotification("Error al enviar código: " + res.error, "error");
    } else {
      showNotification("Código enviado al correo del cliente.", "success");
    }
  };

  const executeCharge = async (cardToUse, amount) => {
    try {
      showNotification('Procesando cobro en CardNet...');
      const res = await dataService.cardnetChargeProfile(
        client.cardnet_customer_id,
        cardToUse.PaymentProfileId,
        amount,
        `Cobro Verificado PLAN BEAUTY - ${client.nombre}`,
        client.id
      );

      if (res.error) throw new Error(res.error);

      const isSuccess = res.ResponseCode === "00" || res.Status === "Approved" || res.AuthorizationCode;

      if (isSuccess) {
        showNotification(`¡Cobro de RD$ ${amount} aprobado con éxito!`, 'success');
        await selectClient(client); // Refresh history
      } else {
        throw new Error(res.Message || 'El cobro fue declinado por el banco.');
      }
    } catch (e) {
      showNotification(e.message, 'error');
    }
  };

  const totalVisits = visits.reduce((acc, v) => acc + (parseFloat(v.total) || 0), 0);
  const totalPayments = payments.filter(p => p.status === 'Aprobado').reduce((acc, p) => acc + (parseFloat(p.amount) || 0), 0);
  const totalSpent = totalVisits + totalPayments;

  // Process visits to show smart usage (e.g. "Lavados (Uso 1/4)")
  const processDisplayVisits = () => {
    const sorted = [...visits].sort((a, b) => new Date(a.visited_at) - new Date(b.visited_at));
    const usageMap = {};
    return sorted.map(v => {
      let rawServices = v.servicios || [];
      if (typeof rawServices === 'string') {
        try {
           rawServices = JSON.parse(rawServices);
        } catch(e) {
           rawServices = rawServices.split(',').map(s => s.trim());
        }
      }
      if (!Array.isArray(rawServices)) rawServices = [];

      const formattedServices = rawServices.map(service => {
        const lower = (service || '').toLowerCase();
        let quota = 1;
        let baseName = service;
        
        if (lower.includes('ilimitad')) {
          quota = Infinity;
          baseName = service.replace(/ilimitad[oa]s?/i, '').trim();
        } else {
          const match = service.match(/^(\d+)\s+(.+)$/);
          if (match) {
            quota = parseInt(match[1], 10);
            baseName = match[2];
          }
        }

        if (!usageMap[service]) usageMap[service] = 0;
        usageMap[service]++;
        const currentUsage = usageMap[service];

        if (quota === 1 && !service.match(/^\d+/)) {
          return service;
        } else if (quota === Infinity) {
           return `${baseName} (Uso ${currentUsage}/∞)`;
        } else {
           return `${baseName} (Uso ${currentUsage}/${quota})`;
        }
      });
      return { ...v, displayServices: formattedServices.join(', ') || t('profile.history.fallback') };
    }).reverse();
  };

  const displayVisits = processDisplayVisits();

  // --- Advanced Behavioral Analytics Logic ---
  const calculateAnalytics = () => {
    if (!client) return null;
    
    const registrationDate = client.created_at ? new Date(client.created_at) : new Date();
    const today = new Date();
    const tToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const daysSinceReg = Math.max(1, Math.floor((tToday - new Date(registrationDate.getFullYear(), registrationDate.getMonth(), registrationDate.getDate())) / (1000 * 60 * 60 * 24)));
    
    // 1. BASE: Sorted visit dates (from oldest to newest for interval calculation)
    const sortedVisits = [...visits].sort((a, b) => new Date(a.visited_at) - new Date(b.visited_at));
    const totalVisitsCount = sortedVisits.length;
    
    if (totalVisitsCount < 2) {
      let daysSinceLastVisit = daysSinceReg;
      if (totalVisitsCount === 1) {
        const lastV = new Date(sortedVisits[0].visited_at);
        const tLastV = new Date(lastV.getFullYear(), lastV.getMonth(), lastV.getDate());
        daysSinceLastVisit = Math.floor((tToday - tLastV) / (1000 * 60 * 60 * 24));
      }

      return {
        memberSince: client.created_at ? registrationDate.toLocaleDateString() : 'N/A',
        daysAsMember: daysSinceReg,
        avgVisitsPerMonth: (totalVisitsCount / Math.max(1, daysSinceReg / 30.44)).toFixed(1),
        avgInterval: 0,
        frequencyType: 'N/A',
        trend: 'Estable',
        daysSinceLastVisit,
        riskLevel: 'Datos Insuficientes',
        riskColor: '#10b981', // Green by default
        predictedVisit: 'Datos insuficientes'
      };
    }

    // 2. FRECUENCIA: Interval calculation
    const intervals = [];
    for (let i = 1; i < sortedVisits.length; i++) {
      const diff = Math.floor((new Date(sortedVisits[i].visited_at) - new Date(sortedVisits[i-1].visited_at)) / (1000 * 60 * 60 * 24));
      intervals.push(diff);
    }
    
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    
    let frequencyType = 'Ocasional';
    if (avgInterval <= 7) frequencyType = 'Semanal';
    else if (avgInterval <= 15) frequencyType = 'Quincenal';

    // 3. TENDENCIA: Recent vs Old intervals
    const mid = Math.floor(intervals.length / 2);
    const oldIntervals = intervals.slice(0, mid);
    const recentIntervals = intervals.slice(mid);
    
    const oldAvg = oldIntervals.length > 0 ? oldIntervals.reduce((a,b)=>a+b,0)/oldIntervals.length : avgInterval;
    const recentAvg = recentIntervals.reduce((a,b)=>a+b,0)/recentIntervals.length;
    
    let trend = 'Estable';
    if (recentAvg < oldAvg - 1) trend = 'Aumentando (↑)';
    else if (recentAvg > oldAvg + 1) trend = 'Disminuyendo (↓)';

    // 4. DÍAS SIN VENIR
    const lastVisitDate = new Date(sortedVisits[totalVisitsCount - 1].visited_at);
    const tLastVisit = new Date(lastVisitDate.getFullYear(), lastVisitDate.getMonth(), lastVisitDate.getDate());
    const daysSinceLastVisit = Math.floor((tToday - tLastVisit) / (1000 * 60 * 60 * 24));

    // 5. ALERTAS
    let riskLevel = 'Normal';
    let riskColor = '#10b981'; // Green
    if (daysSinceLastVisit >= (avgInterval * 2)) {
      riskLevel = 'Riesgo Crítico';
      riskColor = '#ef4444'; // Red
    } else if (daysSinceLastVisit >= (avgInterval * 1.5)) {
      riskLevel = 'Alerta de Inactividad';
      riskColor = '#f59e0b'; // Amber
    }

    const predictedVisit = new Date(lastVisitDate.getTime() + (avgInterval * 24 * 60 * 60 * 1000));

    return {
      memberSince: client.created_at ? registrationDate.toLocaleDateString() : 'N/A',
      daysAsMember: daysSinceReg,
      avgVisitsPerMonth: (totalVisitsCount / Math.max(1, daysSinceReg / 30.44)).toFixed(1),
      avgInterval: Math.round(avgInterval),
      frequencyType,
      trend,
      daysSinceLastVisit,
      riskLevel,
      riskColor,
      predictedVisit: predictedVisit.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
    };
  };

  const analytics = calculateAnalytics();

  const startDiscountFlow = async (serviceName) => {
    setDeductingService(serviceName);
    setShowOtpModal(true);
    setOtpValue('');
    setActiveOtpCode(null);
    
    showNotification("Generando código de seguridad...", "info");
    const res = await dataService.generateOTP(client.id, client.email);
    if (res.error) {
      showNotification("Error al enviar código: " + res.error, "error");
    } else {
      showNotification("Código enviado al correo del cliente.", "success");
    }
  };

  const fetchActiveOTP = async () => {
    const roleLower = user?.role?.toLowerCase();
    if (roleLower !== 'admin' && roleLower !== 'administrador') return;
    const res = await dataService.getActiveOTP(client.id);
    if (res && res.code) {
      setActiveOtpCode(res.code);
    } else {
      showNotification("No hay código activo actualmente.", "info");
    }
  };

  const handleRequestAdminCode = () => {
    showNotification("Solicitud de código enviada a la administración. Por favor, pídale el código de 6 dígitos al gerente.", "info");
    // This could send a real-time notification in a future update
    try {
      dataService.logCodeRequest(client.id, deductingService, user.nombre);
    } catch (e) { console.error(e); }
  };

  const handleVerifyOTP = async () => {
    if (!otpValue || otpValue.length < 6) return;
    setIsVerifying(true);
    try {
      if (pendingCharge) {
        // Verification for financial charge
        await dataService.verifyOTP(client.id, otpValue);
        await executeCharge(pendingCharge.card, pendingCharge.amount);
        setPendingCharge(null);
      } else {
        // Verification for service discount
        const visitData = {
          clientName: client.nombre,
          servicios: [deductingService],
          salon_id: client.salon_id,
          empleadoPeluquera: selectedStaff.peluquera,
          empleadoLavaPelo: selectedStaff.lavaPelo,
          empleadoManicurista: selectedStaff.manicurista
        };
        await dataService.verifyOTPAndDiscount(client.id, otpValue, visitData);
        showNotification("Servicio facturado con éxito.", "success");
        setSelectedStaff({ peluquera: '', lavaPelo: '', manicurista: '' }); // Reset staff
      }
      
      setShowOtpModal(false);
      // Refresh data
      await selectClient(client);
    } catch (e) {
      showNotification(e.message, "error");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleRequestCancelCode = async () => {
    if (!contract) return;
    try {
      setActionModal({ ...actionModal, loading: true });
      await dataService.requestContractCode(contract.id, 'cancellation');
      setActionModal({ open: true, type: 'cancellation', code: '', loading: false });
    } catch (err) {
      showNotification(err.message, 'error');
      setActionModal({ ...actionModal, loading: false });
    }
  };

  const handleConfirmCancel = async () => {
    if (!actionModal.code || actionModal.code.length < 6) return showNotification('Por favor ingrese el código de 6 dígitos.', 'error');
    try {
      setActionModal({ ...actionModal, loading: true });
      await dataService.confirmContractAction(contract.id, actionModal.code, 'cancellation');
      showNotification('Plan cancelado exitosamente.', 'success');
      setActionModal({ open: false, type: null, code: '', loading: false });
      await selectClient(client);
    } catch (err) {
      showNotification(err.message, 'error');
      setActionModal({ ...actionModal, loading: false });
    }
  };

  const filteredList = allClients.filter(c => {
    const matchesSearch = (c.nombre || '').toLowerCase().includes(listFilter.toLowerCase()) || 
                          (c.telefono || '').includes(listFilter) || 
                          (c.cedula || '').includes(listFilter);
    if (statusFilter === 'active') return matchesSearch && c.planName !== 'Sin Plan';
    if (statusFilter === 'inactive') return matchesSearch && c.planName === 'Sin Plan';
    return matchesSearch;
  });

  const sourceStats = allClients.reduce((acc, c) => {
    const src = c.registration_source || 'Self';
    acc[src] = (acc[src] || 0) + 1;
    return acc;
  }, {});

  const renderSourceStat = (label, count, color) => {
    const percentage = allClients.length > 0 ? Math.round((count / allClients.length) * 100) : 0;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', padding: '0 0.75rem', borderLeft: '1px solid #e2e8f0' }}>
        <p style={{ fontSize: '0.6rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>{label}</p>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
          <p style={{ fontSize: '1rem', fontWeight: 800, color: '#09090b' }}>{count}</p>
          <span style={{ fontSize: '0.7rem', fontWeight: 600, color }}>{percentage}%</span>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="page-header" style={{ marginBottom: '2rem' }}>
        <div>
          <h2 className="page-title">{t('profile.title')}</h2>
          <p className="page-subtitle">{t('profile.subtitle')} </p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <div className="surface-card" style={{ padding: '0.75rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem', background: 'white', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)', borderRadius: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ background: '#f8fafc', color: '#0f172a', padding: '0.6rem', borderRadius: '12px', border: '1px solid #f1f5f9' }}>
                  <Users size={22} />
                </div>
                <div>
                  <p style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase', marginBottom: '0.1rem', letterSpacing: '0.05em' }}>Total Clientes</p>
                  <p style={{ fontSize: '1.5rem', fontWeight: 900, color: '#0f172a', lineHeight: 1 }}>{allClients.length}</p>
                </div>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', background: '#f8fafc', padding: '0.5rem', borderRadius: '12px', border: '1px solid #f1f5f9' }}>
                {renderSourceStat('Web (Self)', sourceStats.Self || 0, '#10b981')}
                {renderSourceStat('Admin', sourceStats.Admin || 0, '#3b82f6')}
                {renderSourceStat('Recepción', sourceStats.Reception || 0, '#f59e0b')}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="action-bar" style={{ background: 'white', padding: '1rem', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '1rem', width: '100%' }}>
          <div className="search-input-wrapper" style={{ margin: 0, position: 'relative' }}>
            <Search className="icon" size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
            <input
              placeholder={t('profile.search')}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                if (!e.target.value) setClient(null);
              }}
              style={{ width: '100%', padding: '0.85rem 1rem 0.85rem 3rem', fontSize: '1rem', borderRadius: '12px', border: '1px solid #cbd5e1', background: '#f8fafc', transition: 'all 0.2s ease' }}
              required
            />
          </div>
          <button type="submit" className="btn-primary" style={{ padding: '0 3rem', borderRadius: '12px', fontSize: '0.9rem', fontWeight: 800 }}>{t('profile.btn.lookup')}</button>
          {client && (
            <button type="button" className="btn-secondary" style={{ borderRadius: '12px' }} onClick={() => { setClient(null); setSearchTerm(''); }}>Limpiar</button>
          )}
        </form>
      </div>

      {client ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 2fr', gap: '2rem', alignItems: 'start' }}>
          {/* Main Info Card */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
             <div className="surface-card" style={{ textAlign: 'center', position: 'relative' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '6px', background: 'var(--text-primary)' }}></div>
                
                <button 
                  onClick={() => setIsEditing(!isEditing)}
                  style={{ position: 'absolute', top: '15px', right: '15px', background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-secondary)', zIndex: 10 }}
                  title="Editar Perfil"
                >
                  <Settings size={16} />
                </button>

                <div style={{ width: '80px', height: '80px', background: '#f1f5f9', borderRadius: '50%', margin: '1rem auto', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#09090b', border: '1px solid #e2e8f0', fontSize: '2rem', fontWeight: 800 }}>
                  {client.nombre ? client.nombre.substring(0, 2).toUpperCase() : <User size={36} />}
                </div>

                {isEditing ? (
                  <div style={{ padding: '0 1rem 1rem' }}>
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textAlign: 'left', marginBottom: '0.25rem' }}>NOMBRE</label>
                      <input 
                        value={editForm.nombre} 
                        onChange={e => setEditForm({...editForm, nombre: e.target.value})}
                        className="input-field" 
                        style={{ fontSize: '0.9rem', padding: '0.5rem' }}
                      />
                    </div>
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textAlign: 'left', marginBottom: '0.25rem' }}>CÉDULA</label>
                      <input 
                        value={editForm.cedula} 
                        onChange={e => setEditForm({...editForm, cedula: e.target.value})}
                        className="input-field" 
                        style={{ fontSize: '0.9rem', padding: '0.5rem' }}
                      />
                    </div>
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textAlign: 'left', marginBottom: '0.25rem' }}>FECHA DE NACIMIENTO</label>
                      <input 
                        type="date"
                        value={editForm.fecha_nacimiento} 
                        onChange={e => setEditForm({...editForm, fecha_nacimiento: e.target.value})}
                        className="input-field" 
                        style={{ fontSize: '0.9rem', padding: '0.5rem' }}
                      />
                    </div>
                    <div className="grid-2">
                      <div style={{ textAlign: 'left' }}>
                        <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>TELÉFONO</label>
                        <input 
                          value={editForm.telefono} 
                          onChange={e => setEditForm({...editForm, telefono: e.target.value})}
                          className="input-field" 
                          style={{ fontSize: '0.8rem', padding: '0.5rem' }}
                        />
                      </div>
                      <div style={{ textAlign: 'left' }}>
                        <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>EMAIL</label>
                        <input 
                          value={editForm.email} 
                          onChange={e => setEditForm({...editForm, email: e.target.value})}
                          className="input-field" 
                          style={{ fontSize: '0.8rem', padding: '0.5rem' }}
                        />
                      </div>
                    </div>
                    <div style={{ marginTop: '1rem', textAlign: 'left' }}>
                      <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>DIRECCIÓN (CALLE Y No.)</label>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <input 
                          value={editForm.calle} 
                          onChange={e => setEditForm({...editForm, calle: e.target.value})}
                          className="input-field" 
                          style={{ fontSize: '0.8rem', padding: '0.5rem', flex: 3 }}
                          placeholder="Calle"
                        />
                        <input 
                          value={editForm.numero} 
                          onChange={e => setEditForm({...editForm, numero: e.target.value})}
                          className="input-field" 
                          style={{ fontSize: '0.8rem', padding: '0.5rem', flex: 1 }}
                          placeholder="No."
                        />
                      </div>
                    </div>
                    <div className="grid-2" style={{ marginTop: '1rem' }}>
                      <div style={{ textAlign: 'left' }}>
                        <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>SECTOR</label>
                        <input 
                          value={editForm.sector} 
                          onChange={e => setEditForm({...editForm, sector: e.target.value})}
                          className="input-field" 
                          style={{ fontSize: '0.8rem', padding: '0.5rem' }}
                        />
                      </div>
                      <div style={{ textAlign: 'left' }}>
                        <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>CIUDAD</label>
                        <input 
                          value={editForm.ciudad} 
                          onChange={e => setEditForm({...editForm, ciudad: e.target.value})}
                          className="input-field" 
                          style={{ fontSize: '0.8rem', padding: '0.5rem' }}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem' }}>
                      <button onClick={handleSaveEdit} className="btn-primary" style={{ flex: 1, padding: '0.5rem' }}>Guardar</button>
                      <button onClick={() => setIsEditing(false)} className="btn-secondary" style={{ flex: 1, padding: '0.5rem' }}>Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                      <h3 style={{ fontSize: '1.5rem', fontWeight: 800, fontFamily: "'Plus Jakarta Sans', sans-serif", margin: 0 }}>{client.nombre}</h3>
                      {pendingSurvey?.hasPending && (
                        <motion.div
                          initial={{ scale: 0.9, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          style={{ 
                            padding: '0.3rem 0.8rem', 
                            background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)', 
                            borderRadius: '100px', 
                            fontSize: '0.65rem', 
                            fontWeight: 900,
                            color: 'white',
                            border: 'none',
                            cursor: 'default',
                            boxShadow: '0 4px 12px rgba(245, 158, 11, 0.2)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.4rem'
                          }}
                        >
                          ENCUESTA PENDIENTE
                        </motion.div>
                      )}
                      {client.registration_source && (
                        <span style={{ 
                          padding: '0.2rem 0.6rem', 
                          background: client.registration_source === 'Self' ? '#ecfdf5' : '#eff6ff', 
                          color: client.registration_source === 'Self' ? '#059669' : '#2563eb', 
                          borderRadius: '100px', 
                          fontSize: '0.6rem', 
                          fontWeight: 800,
                          border: `1px solid ${client.registration_source === 'Self' ? '#10b981' : '#3b82f6'}`
                        }}>
                          {client.registration_source.toUpperCase()}
                        </span>
                      )}
                    </div>
                    
                    {(() => {
                      const isCancelled = client.status === 'Cancelled' || contract?.status === 'Cancelled';
                      const isSuspended = contract?.status === 'Suspended' || (contract?.retry_count >= 90);
                      const isPendingRetry = contract?.status === 'Pending_Retry' || (client.status === 'Inactive' && !isCancelled && !isSuspended);
                      const isActive = activePlans.length > 0 && client.status === 'Active' && (contract?.status === 'Active' || contract?.status === 'Activo');

                      if (isCancelled) {
                        return (
                          <div style={{ marginBottom: '1rem' }}>
                            <span style={{ 
                              fontSize: '0.9rem', 
                              fontWeight: 900, 
                              padding: '0.65rem 1.25rem', 
                              borderRadius: '12px', 
                              background: '#dc2626',
                              color: 'white',
                              textTransform: 'uppercase',
                              boxShadow: '0 10px 15px -3px rgba(220, 38, 38, 0.35)',
                              letterSpacing: '0.05em',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.5rem'
                            }}>
                              ✕ CONTRATO CANCELADO
                            </span>
                            <p style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: '0.5rem', fontWeight: 700 }}>
                              Cancelado voluntariamente con código de seguridad. Tarjeta desvinculada.
                            </p>
                          </div>
                        );
                      }

                      if (isSuspended) {
                        return (
                          <div style={{ marginBottom: '1rem' }}>
                            <span style={{ 
                              fontSize: '0.85rem', 
                              fontWeight: 900, 
                              padding: '0.65rem 1.25rem', 
                              borderRadius: '12px', 
                              background: '#7f1d1d',
                              color: 'white',
                              textTransform: 'uppercase',
                              boxShadow: '0 10px 15px -3px rgba(127, 29, 29, 0.35)',
                              letterSpacing: '0.05em',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.5rem'
                            }}>
                              🛑 SUSPENDIDO POR MORA (90/90)
                            </span>
                            <p style={{ fontSize: '0.75rem', color: '#991b1b', marginTop: '0.5rem', fontWeight: 700 }}>
                              Se completaron los 90 reintentos automáticos sin éxito.
                            </p>
                          </div>
                        );
                      }

                      if (isPendingRetry) {
                        return (
                          <div style={{ marginBottom: '1rem' }}>
                            <span style={{ 
                              fontSize: '0.85rem', 
                              fontWeight: 900, 
                              padding: '0.65rem 1.25rem', 
                              borderRadius: '12px', 
                              background: '#d97706',
                              color: 'white',
                              textTransform: 'uppercase',
                              boxShadow: '0 10px 15px -3px rgba(217, 119, 6, 0.35)',
                              letterSpacing: '0.05em',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.5rem'
                            }}>
                              ⚠️ COBRO PENDIENTE ({contract?.retry_count || 1}/90)
                            </span>
                            <p style={{ fontSize: '0.75rem', color: '#b45309', marginTop: '0.5rem', fontWeight: 700 }}>
                              Tarjeta declinada. Sistema reintentando a diario (Intento {contract?.retry_count || 1} de 90).
                            </p>
                          </div>
                        );
                      }

                      if (isActive) {
                        return (
                          <span style={{ 
                            fontSize: '1rem', 
                            fontWeight: 900, 
                            padding: '0.75rem 1.5rem', 
                            borderRadius: '12px', 
                            background: '#10b981',
                            color: 'white',
                            textTransform: 'uppercase',
                            boxShadow: '0 10px 15px -3px rgba(16, 185, 129, 0.3)',
                            letterSpacing: '0.05em',
                            display: 'inline-block',
                            marginBottom: '1rem'
                          }}>
                            ✓ ACTIVO
                          </span>
                        );
                      }

                      return (
                        <span style={{ 
                          fontSize: '0.85rem', 
                          fontWeight: 800, 
                          padding: '0.6rem 1.2rem', 
                          borderRadius: '12px', 
                          background: '#f1f5f9',
                          color: '#64748b',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          display: 'inline-block',
                          marginBottom: '1rem',
                          border: '1px solid #cbd5e1'
                        }}>
                          ⚪ SIN SUSCRIPCIÓN ACTIVA
                        </span>
                      );
                    })()}
                    
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>ID: {client.cedula}</p>

                    <div style={{ background: 'var(--bg-canvas)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-subtle)', marginBottom: '1.5rem', textAlign: 'left' }}>
                      <p style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Estatus de Membresía</p>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <p style={{ fontSize: '0.875rem', fontWeight: 700 }}>{analytics?.daysAsMember || 0} Días Inscrito</p>
                          <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Desde: {analytics?.memberSince}</p>
                        </div>
                        <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--brand-accent)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Award size={20} />
                        </div>
                      </div>
                    </div>

                    <div className="grid-2">
                      <div className="stat-box" style={{ textAlign: 'left' }}>
                        <p className="stat-label">{t('profile.phone')}</p>
                        <p className="stat-value" style={{ fontSize: '0.875rem' }}>{client.telefono}</p>
                      </div>
                      <div className="stat-box" style={{ textAlign: 'left' }}>
                        <p className="stat-label">{t('profile.email')}</p>
                        <p className="stat-value" style={{ fontSize: '0.875rem', wordBreak: 'break-all', lineHeight: 1.2 }} title={client.email}>{client.email}</p>
                      </div>
                    </div>

                    <div style={{ background: 'var(--bg-canvas)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-subtle)', textAlign: 'left', marginTop: '1rem' }}>
                      <p style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Dirección</p>
                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                        <div style={{ color: 'var(--text-primary)', marginTop: '2px' }}><MapPin size={16} /></div>
                        <div>
                          <p style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '0.1rem' }}>
                            {client.calle || 'Sin calle'} {client.numero ? `#${client.numero}` : ''}
                          </p>
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {client.sector || 'Sin sector'}{client.ciudad ? `, ${client.ciudad}` : ''}
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

            <div className="surface-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                  <Award size={18} /> {t('profile.plan')}
                </h4>
                <button 
                  onClick={() => navigate('/contratos', { state: { clientCedula: client.cedula } })}
                  style={{ background: 'var(--text-primary)', color: 'white', border: 'none', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                  title="Agregar nuevo plan"
                >
                  +
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {activePlans.length > 0 ? (
                  activePlans.map(plan => {
                    const contract = contracts.find(c => c.plan_id === plan.id);
                    
                    // Usage calculation for the current cycle
                    const parseDate = (d) => {
                      if (!d) return 0;
                      if (d instanceof Date) return d.getTime();
                      const dateStr = String(d).endsWith('Z') ? String(d) : String(d).replace(' ', 'T') + 'Z';
                      const time = new Date(dateStr).getTime();
                      return isNaN(time) ? new Date(d).getTime() : time;
                    };
                    const lastBillingTime = parseDate(contract?.last_billed_date);
                    const threshold = lastBillingTime > 0 ? lastBillingTime - 60000 : 0;
                    const cycleVisits = visits.filter(v => parseDate(v.visited_at) >= threshold);
                    
                    const usageMap = {};
                    cycleVisits.forEach(v => {
                      let sList = v.servicios || [];
                      if (typeof sList === 'string') {
                        try { sList = JSON.parse(sList); } catch { sList = sList.split(',').map(x => x.trim()); }
                      }
                      if (Array.isArray(sList)) {
                        sList.forEach(s => {
                          if (typeof s === 'string') {
                            const cleanS = s.trim();
                            usageMap[cleanS] = (usageMap[cleanS] || 0) + 1;
                            const noNum = cleanS.replace(/^\d+\s*/, '').trim();
                            if (noNum && noNum !== cleanS) {
                              usageMap[noNum] = (usageMap[noNum] || 0) + 1;
                            }
                          }
                        });
                      }
                    });

                    // Snapshot & Promo Logic
                    const signedAt = new Date(contract?.created_at || contract?.signed_at);
                    const promoDuration = contract?.contract_promo_duration || 0;
                    const promoExpiry = new Date(signedAt);
                    promoExpiry.setMonth(promoExpiry.getMonth() + promoDuration);
                    const isPromoActive = promoDuration > 0 && new Date() < promoExpiry;

                    // Función para limpiar/parsear JSON de servicios
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

                    let effectiveServices = [];
                    try {
                      // Los nombres reales en la tabla 'contracts' son contract_services y contract_promo_services
                      const baseSnapshot = peel(contract?.contract_services) || [];
                      const promoSnapshot = peel(contract?.contract_promo_services) || [];
                      
                      const baseArray = Array.isArray(baseSnapshot) ? baseSnapshot : [];
                      const promoArray = Array.isArray(promoSnapshot) ? promoSnapshot : [];

                      if (isPromoActive) {
                        // Unificamos ambos: Base + Promo
                        effectiveServices = [...baseArray, ...promoArray];
                      } else {
                        // Solo base si no hay promo activa
                        effectiveServices = baseArray.length > 0 ? baseArray : (plan.services || []);
                      }
                    } catch (e) {
                      effectiveServices = plan.services || [];
                    }
                    
                    if (!Array.isArray(effectiveServices)) effectiveServices = [];

                    return (
                      <div key={plan.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div style={{ 
                          background: isPromoActive ? '#f0fdf4' : (contract?.status === 'Pending_Retry' ? '#fffbeb' : (contract?.status === 'Cancelled' ? '#fef2f2' : '#ecfdf5')), 
                          border: isPromoActive ? '1px solid #166534' : (contract?.status === 'Pending_Retry' ? '1px solid #f59e0b' : (contract?.status === 'Cancelled' ? '1px solid #fca5a5' : '1px solid #a7f3d0')), 
                          padding: '1rem', 
                          borderRadius: 'var(--radius-md)' 
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <p style={{ fontWeight: 700, color: isPromoActive ? '#166534' : (contract?.status === 'Pending_Retry' ? '#d97706' : (contract?.status === 'Cancelled' ? '#dc2626' : '#059669')), marginBottom: '0.25rem', fontSize: '0.9rem' }}>{plan.title}</p>
                            {isPromoActive && <span style={{ fontSize: '0.6rem', background: '#166534', color: 'white', padding: '0.2rem 0.5rem', borderRadius: '99px', fontWeight: 900 }}>PROMO ACTIVA</span>}
                            {contract?.status === 'Pending_Retry' && <span style={{ fontSize: '0.65rem', background: '#d97706', color: 'white', padding: '0.2rem 0.6rem', borderRadius: '99px', fontWeight: 900 }}>REINTENTO {contract.retry_count || 1}/90</span>}
                            {contract?.status === 'Cancelled' && <span style={{ fontSize: '0.65rem', background: '#dc2626', color: 'white', padding: '0.2rem 0.6rem', borderRadius: '99px', fontWeight: 900 }}>CANCELADO</span>}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', color: isPromoActive ? '#166534' : (contract?.status === 'Pending_Retry' ? '#b45309' : (contract?.status === 'Cancelled' ? '#991b1b' : '#059669')), fontWeight: 600, marginTop: '0.25rem' }}>
                            <span>{contract?.auto_billing_enabled ? 'Auto-cobro Activo' : 'Manual'}</span>
                            <span>{isPromoActive ? `Fin Promo: ${promoExpiry.toLocaleDateString()}` : (contract?.status === 'Pending_Retry' ? 'PAGO PENDIENTE (REINTENTANDO)' : (contract?.status === 'Cancelled' ? 'Contrato Cancelado' : 'Contrato Activo'))}</span>
                          </div>
                          {contract?.status === 'Pending_Retry' && (
                            <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px dashed #fcd34d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.7rem', color: '#92400e', fontWeight: 600 }}>¿Clienta en salón? Puedes cobrarle directamente:</span>
                              <button 
                                onClick={() => handleManualPayment(contract, plan)}
                                style={{ 
                                  background: '#059669', 
                                  color: 'white', 
                                  border: 'none', 
                                  padding: '0.35rem 0.75rem', 
                                  borderRadius: '6px', 
                                  fontSize: '0.7rem', 
                                  fontWeight: 800, 
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.3rem'
                                }}
                              >
                                💳 Cobrar y Reactivar
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Services included in this plan */}
                        {(contract?.status === 'Active' || contract?.status === 'Pending_Retry') && (
                          <div style={{ padding: '0.5rem 0' }}>
                            <p style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>
                              Servicios del Plan y Beneficios
                            </p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {(effectiveServices || []).filter(s => s && typeof s === 'string' && s.trim().length > 0).map((service, idx) => {
                              const lower = (service || '').toLowerCase();
                              let quota = 1;
                              let baseName = service;
                              let isUnlimited = false;

                              if (lower.includes('ilimitad')) {
                                isUnlimited = true;
                                baseName = service.replace(/ilimitad[oa]s?/i, '').trim();
                              } else {
                                const match = service.match(/^(\d+)\s*(.*)$/);
                                if (match) {
                                  quota = parseInt(match[1], 10);
                                  baseName = match[2] || service;
                                }
                              }

                              const currentUsage = usageMap[service] || usageMap[baseName] || usageMap[(baseName || '').trim()] || 0;
                              const percentage = isUnlimited ? 100 : Math.min(100, (currentUsage / quota) * 100);
                              const isBtnDisabled = (percentage >= 100 && !isUnlimited) || client.status === 'Cancelled' || contract?.status === 'Pending_Retry';

                              return (
                                <div key={idx} style={{ background: 'var(--bg-canvas)', padding: '0.75rem', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                                    <div>
                                      <span style={{ fontSize: '0.8rem', fontWeight: 700, display: 'block' }}>{baseName}</span>
                                      <span style={{ fontSize: '0.7rem', fontWeight: 800, color: percentage >= 100 && !isUnlimited ? '#ef4444' : 'var(--text-primary)' }}>
                                        {currentUsage} / {isUnlimited ? '∞' : quota} usados ({isUnlimited ? 'Ilimitados' : Math.max(0, quota - currentUsage)} disponibles)
                                      </span>
                                    </div>
                                    <button 
                                      onClick={() => startDiscountFlow(service)}
                                      disabled={isBtnDisabled}
                                      style={{ 
                                        padding: '0.4rem 0.75rem', 
                                        fontSize: '0.65rem', 
                                        fontWeight: 800, 
                                        background: isBtnDisabled ? '#f1f5f9' : 'var(--text-primary)',
                                        color: isBtnDisabled ? '#94a3b8' : 'white',
                                        border: 'none',
                                        borderRadius: '6px',
                                        cursor: isBtnDisabled ? 'not-allowed' : 'pointer',
                                        textTransform: 'uppercase'
                                      }}
                                    >
                                      {contract?.status === 'Pending_Retry' ? 'Suspendido' : 'Facturar'}
                                    </button>
                                  </div>
                                  <div style={{ height: '4px', background: '#e2e8f0', borderRadius: '2px', overflow: 'hidden' }}>
                                    <div style={{ 
                                      height: '100%', 
                                      width: `${percentage}%`, 
                                      background: percentage >= 100 && !isUnlimited ? '#ef4444' : 'var(--text-primary)',
                                      transition: 'width 0.3s ease'
                                    }}></div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      </div>
                    );
                  })
                ) : (
                  contracts.some(c => c.status === 'Cancelled') ? (
                    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '1.25rem', borderRadius: 'var(--radius-md)', textAlign: 'left' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <p style={{ fontWeight: 800, color: '#991b1b', margin: 0, fontSize: '0.9rem' }}>
                          {contracts.find(c => c.status === 'Cancelled')?.planTitle || 'Plan Beauty'}
                        </p>
                        <span style={{ fontSize: '0.65rem', background: '#dc2626', color: 'white', padding: '0.2rem 0.6rem', borderRadius: '99px', fontWeight: 900 }}>
                          ✕ CANCELADO
                        </span>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: '#b91c1c', margin: 0, lineHeight: 1.4 }}>
                        El cliente canceló voluntariamente su membresía mediante código de seguridad OTP. La tarjeta fue desvinculada y no se generarán más cobros automáticos.
                      </p>
                    </div>
                  ) : (
                    <div style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', padding: '1rem', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Sin planes activos</p>
                    </div>
                  )
                )}
              </div>

              {/* Payment Method Info */}
              <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                    <CreditCard size={18} /> Método de Pago
                  </h4>
                  <button 
                    onClick={openCardNetUpdater}
                    style={{ background: 'transparent', color: 'var(--text-secondary)', border: 'none', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Añadir/Cambiar
                  </button>
                </div>
                
                {cardInfo ? (
                  <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', padding: '1.25rem', borderRadius: '16px', color: 'white', position: 'relative', overflow: 'hidden', marginBottom: '1.5rem' }}>
                    <div style={{ position: 'absolute', top: '-10px', right: '-10px', opacity: 0.1 }}>
                      <CreditCard size={100} />
                    </div>
                    <p style={{ fontSize: '0.7rem', opacity: 0.6, fontWeight: 600, letterSpacing: '0.1em', marginBottom: '0.5rem' }}>TARJETA ACTIVA PRINCIPAL</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                      <div style={{ background: 'white', padding: '0.2rem 0.5rem', borderRadius: '4px', color: '#0f172a', fontWeight: 900, fontSize: '0.6rem' }}>
                        {cardInfo?.Brand?.toUpperCase() || 'CARD'}
                      </div>
                      <p style={{ fontSize: '1.1rem', fontWeight: 700, letterSpacing: '0.15em' }}>
                        •••• •••• •••• {cardInfo?.Last4 || '••••'}
                      </p>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                      <div>
                        <p style={{ fontSize: '0.5rem', opacity: 0.5, marginBottom: '0.2rem' }}>VENCE</p>
                        <p style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                          {cardInfo?.Expiration ? `${cardInfo.Expiration.slice(-2)}/${cardInfo.Expiration.slice(2, 4)}` : '--/--'}
                        </p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#10b981', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.6rem', fontWeight: 800 }}>
                        <ShieldCheck size={12} /> ACTIVA
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ background: 'var(--bg-canvas)', border: '1px dashed var(--border-subtle)', padding: '1.5rem', borderRadius: '16px', textAlign: 'center', marginBottom: '1.5rem' }}>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600, margin: 0 }}>
                      Sin tarjeta activa para cobros automáticos.
                    </p>
                  </div>
                )}

                {/* Gestionar Tarjetas Section */}
                <div style={{ marginTop: '1.5rem' }}>
                  <p style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '1rem', letterSpacing: '0.05em' }}>
                    Bóveda de Tarjetas Registradas
                  </p>
                  
                  {allCards.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {allCards.map(card => (
                        <div key={card.PaymentProfileId} style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '1rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                              <div style={{ background: 'var(--text-primary)', color: 'white', padding: '0.25rem 0.4rem', borderRadius: '4px', fontSize: '0.55rem', fontWeight: 900 }}>
                                {card.Brand}
                              </div>
                              <p style={{ fontSize: '0.85rem', fontWeight: 700 }}>•••• {card.Last4}</p>
                              {!card.Enable && <span style={{ fontSize: '0.6rem', background: '#fee2e2', color: '#991b1b', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: 800 }}>OFF</span>}
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                              <button 
                                onClick={() => handleChargeCard(card)}
                                style={{ background: '#3b82f6', border: 'none', color: 'white', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.6rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                              >
                                <DollarSign size={10} /> COBRAR
                              </button>
                              <button 
                                onClick={() => {
                                  setEditingCard(card.PaymentProfileId);
                                  setEditCardForm({ expiration: card.Expiration, enable: card.Enable });
                                }}
                                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
                              >
                                <Edit2 size={14} />
                              </button>
                              <button 
                                onClick={() => handleDeleteCard(card)}
                                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>

                          {editingCard === card.PaymentProfileId && (
                            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px dashed var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                              <div style={{ display: 'flex', gap: '1rem' }}>
                                <div style={{ flex: 1 }}>
                                  <label style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>Expiración (YYYYMM)</label>
                                  <input 
                                    type="text" 
                                    className="input-field" 
                                    style={{ fontSize: '0.8rem', padding: '0.5rem' }}
                                    value={editCardForm.expiration || ''}
                                    onChange={e => setEditCardForm({ ...editCardForm, expiration: e.target.value })}
                                    placeholder="202812"
                                  />
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1rem' }}>
                                  <input 
                                    type="checkbox" 
                                    checked={editCardForm.enable}
                                    onChange={e => setEditCardForm({ ...editCardForm, enable: e.target.checked })}
                                  />
                                  <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>Habilitada</span>
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button className="btn-primary" style={{ padding: '0.4rem 1rem', fontSize: '0.75rem' }} onClick={() => handleUpdateCard(card)}>Guardar</button>
                                <button className="btn-secondary" style={{ padding: '0.4rem 1rem', fontSize: '0.75rem' }} onClick={() => setEditingCard(null)}>Cancelar</button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: '1rem', textAlign: 'center', background: 'var(--bg-canvas)', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
                        No hay tarjetas registradas en la bóveda de este cliente.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Expediente Digital Section */}
            {contract && (contract.document_photo || contract.selfie_photo) && (
              <div className="card-surface" style={{ marginTop: '2rem' }}>
                <div className="card-header" style={{ padding: '1.25rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{ background: 'var(--bg-canvas)', padding: '0.5rem', borderRadius: '10px' }}>
                    <ShieldCheck size={20} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '0.875rem', fontWeight: 800, margin: 0 }}>Expediente Digital</h3>
                    <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: 0 }}>Identidad Verificada del Cliente</p>
                  </div>
                </div>
                
                <div style={{ padding: '1.25rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    {contract?.document_photo && (
                      <div>
                        <p style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Documento de Identidad</p>
                        <div style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border-subtle)', background: '#f8fafc' }}>
                          <img 
                           src={contract.document_photo} 
                           alt="Cédula" 
                           style={{ width: '100%', height: '140px', objectFit: 'cover', cursor: 'pointer' }} 
                           onClick={() => window.open(contract.document_photo, '_blank')} 
                          />
                        </div>
                      </div>
                    )}
                    {contract?.selfie_photo && (
                      <div>
                        <p style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Foto de Perfil (Selfie)</p>
                        <div style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border-subtle)', background: '#f8fafc' }}>
                          <img 
                           src={contract.selfie_photo} 
                           alt="Selfie" 
                           style={{ width: '100%', height: '140px', objectFit: 'cover', cursor: 'pointer' }} 
                           onClick={() => window.open(contract.selfie_photo, '_blank')} 
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div style={{ marginTop: '1.25rem', padding: '0.75rem', borderRadius: '10px', background: '#f0fdf4', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <ShieldCheck size={14} style={{ color: '#166534' }} />
                    <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#166534' }}>Contrato firmado y validado biométricamente</span>
                  </div>
                </div>
              </div>
            )}

            {/* Legal Status Alert */}
            {contracts.length === 0 && (
              <div style={{ background: '#fffbeb', border: '2px dashed #fcd34d', padding: '1.5rem', borderRadius: '16px', marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#b45309', fontWeight: 800 }}>
                  <ShieldCheck size={20} />
                  <span>Estado Legal Descubierto</span>
                </div>
                <p style={{ fontSize: '0.875rem', color: '#92400e', lineHeight: 1.5, fontWeight: 500 }}>
                  El cliente no ha firmado ningún contrato digital de acuerdos de Términos y Membresía del salón.
                </p>
                <button 
                  onClick={() => navigate('/contratos', { state: { clientCedula: client.cedula } })}
                  className="btn-primary" 
                  style={{ background: '#d97706', color: 'white', padding: '0.75rem 1.5rem', fontSize: '0.875rem', marginTop: '0.5rem' }}
                >
                  Iniciar Firma y Asignar Plan
                </button>
              </div>
            )}

            {contract && (contract.status === 'Active' || contract.status === 'Pending_Retry') && (
              <div className="surface-card" style={{ marginTop: '1.5rem', borderLeft: '4px solid #ef4444' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                  <h4 style={{ fontSize: '1rem', fontWeight: 800, margin: 0 }}>Gestión de Contrato</h4>
                  <div style={{ background: '#09090b', color: 'white', fontSize: '0.65rem', fontWeight: 800, padding: '0.25rem 0.6rem', borderRadius: '6px' }}>{contract.status.toUpperCase()}</div>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {activePlans.find(p => p.id === contract.plan_id)?.servicios?.map((s, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #f1f5f9' }}>
                      <p style={{ fontSize: '0.85rem', fontWeight: 700, margin: 0 }}>{s.title || s}</p>
                      <button 
                        onClick={() => startDiscountFlow(s.title || s)}
                        style={{ background: '#09090b', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer' }}
                      >
                        FACTURAR
                      </button>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px dashed #e2e8f0' }}>
                   <button 
                     onClick={handleRequestCancelCode}
                     style={{ 
                       width: '100%', 
                       background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)', 
                       color: '#991b1b', 
                       border: '1px solid #fecaca', 
                       padding: '1.2rem', 
                       borderRadius: '20px', 
                       fontSize: '0.85rem', 
                       fontWeight: 900, 
                       cursor: 'pointer',
                       letterSpacing: '1px',
                       transition: 'all 0.3s ease',
                       boxShadow: '0 4px 6px -1px rgba(153, 27, 27, 0.05)'
                     }}
                     onMouseEnter={(e) => {
                       e.currentTarget.style.transform = 'translateY(-2px)';
                       e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(153, 27, 27, 0.1)';
                     }}
                     onMouseLeave={(e) => {
                       e.currentTarget.style.transform = 'translateY(0)';
                       e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(153, 27, 27, 0.05)';
                     }}
                   >
                     CANCELAR MEMBRESÍA
                   </button>
                </div>
              </div>
            )}
          </div>

          {/* History & Payments */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="surface-card">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                {/* Historical List */}
                <div>
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1rem', fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, marginBottom: '1.5rem' }}>
                    <Calendar size={18} /> {t('profile.history')}
                  </h4>
                  <div className="history-list" style={{ maxHeight: '450px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                    {displayVisits.length > 0 ? (
                      displayVisits.map((v, i) => (
                        <div key={i} style={{ padding: '0.75rem 0', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                          <div style={{ width: '10px', height: '10px', background: '#cbd5e1', borderRadius: '50%', marginTop: '0.3rem', flexShrink: 0 }}></div>
                          <div>
                            <p style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748b', marginBottom: '0.2rem' }}>{new Date(v.visited_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}</p>
                            <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#09090b', lineHeight: 1.3 }}>{v.displayServices}</p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        {t('profile.history.empty')}
                      </div>
                    )}
                  </div>
                </div>

                {/* Behavioral Analytics */}
                <div style={{ borderLeft: '1px solid var(--border-subtle)', paddingLeft: '2rem' }}>
                   <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1rem', fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, marginBottom: '1.5rem' }}>
                    <TrendingUp size={18} /> Análisis de Comportamiento
                  </h4>
                  
                  {analytics ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      {/* Alerta de Riesgo - Prioridad Alta */}
                      <div style={{ 
                        background: analytics.riskColor + '15', 
                        padding: '1.25rem', 
                        borderRadius: '16px', 
                        border: `1px solid ${analytics.riskColor}40`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1rem'
                      }}>
                        <div style={{ background: analytics.riskColor, color: 'white', padding: '0.5rem', borderRadius: '10px' }}>
                          <AlertTriangle size={20} />
                        </div>
                        <div>
                          <p style={{ fontSize: '0.85rem', fontWeight: 800, color: analytics.riskColor }}>{analytics.riskLevel}</p>
                          <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                            {analytics.daysSinceLastVisit} días desde la última visita
                          </p>
                        </div>
                      </div>

                      <div className="grid-2" style={{ gap: '1rem' }}>
                        <div style={{ background: 'var(--bg-canvas)', padding: '1rem', borderRadius: '16px', border: '1px solid var(--border-subtle)' }}>
                          <p style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Frecuencia</p>
                          <p style={{ fontSize: '1rem', fontWeight: 800 }}>{analytics.frequencyType}</p>
                          <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Cada {analytics.avgInterval} días</p>
                        </div>
                        <div style={{ background: 'var(--bg-canvas)', padding: '1rem', borderRadius: '16px', border: '1px solid var(--border-subtle)' }}>
                          <p style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Tendencia</p>
                          <p style={{ fontSize: '1rem', fontWeight: 800, color: analytics.trend.includes('↑') ? '#10b981' : analytics.trend.includes('↓') ? '#ef4444' : 'var(--text-primary)' }}>
                            {analytics.trend}
                          </p>
                          <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Uso del servicio</p>
                        </div>
                      </div>

                      <div style={{ background: 'var(--bg-canvas)', padding: '1.25rem', borderRadius: '16px', border: '1px solid var(--border-subtle)' }}>
                        <p style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Visitas Mensuales</p>
                        <p style={{ fontSize: '1.75rem', fontWeight: 800 }}>{analytics.avgVisitsPerMonth}</p>
                        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Promedio de visitas al mes</p>
                      </div>

                      <div style={{ background: 'var(--text-primary)', padding: '1.25rem', borderRadius: '16px', color: 'white' }}>
                        <p style={{ fontSize: '0.65rem', fontWeight: 800, opacity: 0.7, textTransform: 'uppercase', marginBottom: '0.25rem' }}>Próxima Visita Estimada</p>
                        <p style={{ fontSize: '1.25rem', fontWeight: 800 }}>{analytics.predictedVisit}</p>
                        <p style={{ fontSize: '0.7rem', opacity: 0.6, fontWeight: 600 }}>Basado en patrones históricos</p>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      Necesitamos al menos 1 visita para generar estadísticas.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="surface-card" style={{ marginBottom: '1.5rem' }}>
              <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.25rem', fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, marginBottom: '1.5rem' }}>
                <FileSignature size={22} /> Documentos Legales y Contratos
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '250px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                {contracts.length > 0 ? contracts.map((c, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: '10px' }}>
                    <div>
                      <p style={{ fontWeight: 700, fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <FileSignature size={14} color="#64748b" /> Contrato #{c.id || c.contract_id || 'Digital'} - {c.planTitle || 'Plan Beauty'}
                      </p>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Firmado el: {new Date(c.created_at || c.signed_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div>
                      <span style={{ 
                        fontSize: '0.7rem', 
                        fontWeight: 800, 
                        background: c.status === 'Active' || c.status === 'Activo' ? '#d1fae5' : (c.status === 'Cancelled' ? '#fee2e2' : '#fef3c7'), 
                        color: c.status === 'Active' || c.status === 'Activo' ? '#059669' : (c.status === 'Cancelled' ? '#dc2626' : '#b45309'), 
                        padding: '0.25rem 0.5rem', 
                        borderRadius: '4px', 
                        border: `1px solid ${c.status === 'Active' || c.status === 'Activo' ? '#a7f3d0' : (c.status === 'Cancelled' ? '#fca5a5' : '#fde68a')}` 
                      }}>
                        {c.status === 'Active' || c.status === 'Activo' ? 'FIRMADO / ACTIVO' : (c.status === 'Cancelled' ? '✕ CANCELADO' : `⚠️ REINTENTO (${c.retry_count || 1}/90)`)}
                      </span>
                    </div>
                  </div>
                )) : (
                  <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                    El cliente no tiene contratos firmados.
                  </div>
                )}
              </div>
            </div>

            <div className="surface-card">
              <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.25rem', fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, marginBottom: '1.5rem' }}>
                <CreditCard size={22} /> {t('profile.finance')}
              </h4>
              <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
                <div className="stat-box">
                  <p className="stat-label">{t('profile.finance.ltv')}</p>
                  <p className="stat-value" style={{ fontSize: '1.5rem' }}>RD$ {totalSpent.toLocaleString('en-US', {minimumFractionDigits: 2})}</p>
                </div>
                <div className="stat-box">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <p className="stat-label">Próximo Corte</p>
                      <p className="stat-value" style={{ 
                        fontSize: '1.2rem', 
                        color: contract?.status === 'Active' ? '#059669' : 
                               contract?.status === 'Pending_Retry' ? '#d97706' : 
                               contract?.status === 'Suspended' ? '#dc2626' : 'var(--text-secondary)' 
                      }}>
                        {contract?.status === 'Pending_Retry' && contract?.next_retry_date ? (
                          <>
                            {(() => {
                              try {
                                const d = new Date(contract.next_retry_date);
                                return d.toLocaleString('es-DO', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  hour12: true
                                });
                              } catch (e) {
                                return contract.next_retry_date;
                              }
                            })()}
                            <span style={{ display: 'block', fontSize: '0.65rem', fontWeight: 800, marginTop: '0.2rem' }}>
                              REINTENTO {contract.retry_count}/5
                            </span>
                          </>
                        ) : contract?.next_billing_date ? (
                          <>
                            {(() => {
                              try {
                                const d = new Date(contract.next_billing_date);
                                if (isNaN(d.getTime()) && typeof contract.next_billing_date === 'string') {
                                  const [y, m, day] = contract.next_billing_date.split(/[-T ]/);
                                  return `${day}/${m}/${y}`;
                                }
                                return d.toLocaleDateString();
                              } catch (e) {
                                return contract.next_billing_date;
                              }
                            })()}
                            {contract?.status === 'Suspended' && (
                              <span style={{ display: 'block', fontSize: '0.65rem', fontWeight: 800 }}>SUSPENDIDO</span>
                            )}
                          </>
                        ) : 'No aplica'}
                      </p>
                    </div>
                    {contract && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <button onClick={() => handleChargeCard()} className="btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.75rem', borderRadius: '8px' }}>
                          Cobrar Tarjeta
                        </button>
                        <button 
                          onClick={() => handleManualPayment(contract, activePlans.find(p => p.id === contract?.plan_id))} 
                          className="btn-secondary" 
                          style={{ padding: '0.5rem 1rem', fontSize: '0.75rem', borderRadius: '8px' }}
                        >
                          Pagar Efectivo
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Payments History List */}
              <h4 style={{ fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '1rem' }}>Historial de Transacciones</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '250px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                {payments.length > 0 ? payments.map((p, i) => {
                  const isCash = p.method && p.method.includes('Efectivo');
                  return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: '12px' }}>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                      <div style={{ width: '36px', height: '36px', background: 'white', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                        {isCash ? <Banknote size={18} /> : <CreditCard size={18} />}
                      </div>
                      <div>
                        <p style={{ fontWeight: 700, fontSize: '0.875rem' }}>{p.description || (isCash ? 'Pago en Efectivo (Manual)' : 'Pago de suscripción (Automático)')}</p>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                          <span>{new Date(p.created_at).toLocaleDateString()}</span>
                          <span>•</span>
                          <span style={{ color: isCash ? '#059669' : '#2563eb', fontWeight: 700 }}>
                            {isCash ? 'Efectivo' : 'CardNet'}: {p.gateway_ref || p.id.split('-').pop().toUpperCase()}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontWeight: 800, fontSize: '0.9rem' }}>RD$ {parseFloat(p.amount).toLocaleString()}</p>
                      <div style={{ marginTop: '0.25rem' }}>
                        {p.status === 'Aprobado' ? (
                          <span style={{ fontSize: '0.6rem', fontWeight: 800, color: '#10b981' }}>COMPLETADO</span>
                        ) : (
                          <span style={{ fontSize: '0.6rem', fontWeight: 800, color: '#ef4444' }}>FALLIDO</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}) : (
                  <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                    Aún no hay transacciones registradas.
                  </div>
                )}
              </div>

              {/* Gift Cards History */}
              <h4 style={{ fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', margin: '2rem 0 1rem' }}>Tarjetas de Regalo Compradas</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '250px', overflowY: 'auto', paddingRight: '0.5rem', marginBottom: '2rem' }}>
                {giftCards.length > 0 ? giftCards.map((g, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: '12px' }}>
                    <div>
                      <p style={{ fontWeight: 800, fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: '0.2rem' }}>{g.code}</p>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Para: {g.recipient_name} • {new Date(g.created_at).toLocaleDateString()}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontWeight: 800, fontSize: '0.875rem', color: '#d4af37' }}>RD$ {parseFloat(g.balance).toLocaleString()}</p>
                      <span style={{ fontSize: '0.65rem', fontWeight: 800, color: g.status === 'Active' ? '#10b981' : '#64748b' }}>{g.status.toUpperCase()}</span>
                    </div>
                  </div>
                )) : (
                  <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                    No hay tarjetas de regalo compradas.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.5rem', background: 'white', padding: '1.25rem', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
            <div>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                Listado General de Clientes
              </h3>
              <p style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 500 }}>Búsqueda rápida y filtrado por estatus.</p>
            </div>
            
            <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
               <div style={{ display: 'flex', background: '#f1f5f9', padding: '0.35rem', borderRadius: '12px', border: '1px solid #e2e8f0', gap: '0.25rem' }}>
                  <button 
                    onClick={() => setStatusFilter('all')}
                    style={{ padding: '0.4rem 1rem', borderRadius: '8px', border: 'none', background: statusFilter === 'all' ? 'white' : 'transparent', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', color: statusFilter === 'all' ? '#0f172a' : '#64748b', boxShadow: statusFilter === 'all' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none', transition: 'all 0.2s ease' }}
                  >
                    Todos
                  </button>
                  <button 
                    onClick={() => setStatusFilter('active')}
                    style={{ padding: '0.4rem 1rem', borderRadius: '8px', border: 'none', background: statusFilter === 'active' ? 'white' : 'transparent', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', color: statusFilter === 'active' ? '#10b981' : '#64748b', boxShadow: statusFilter === 'active' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none', transition: 'all 0.2s ease' }}
                  >
                    Activos
                  </button>
                  <button 
                    onClick={() => setStatusFilter('pending')}
                    style={{ padding: '0.4rem 1rem', borderRadius: '8px', border: 'none', background: statusFilter === 'pending' ? 'white' : 'transparent', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', color: statusFilter === 'pending' ? '#d97706' : '#64748b', boxShadow: statusFilter === 'pending' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none', transition: 'all 0.2s ease' }}
                  >
                    Cobro Pendiente
                  </button>
                  <button 
                    onClick={() => setStatusFilter('cancelled')}
                    style={{ padding: '0.4rem 1rem', borderRadius: '8px', border: 'none', background: statusFilter === 'cancelled' ? 'white' : 'transparent', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', color: statusFilter === 'cancelled' ? '#dc2626' : '#64748b', boxShadow: statusFilter === 'cancelled' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none', transition: 'all 0.2s ease' }}
                  >
                    Cancelados
                  </button>
                  <button 
                    onClick={() => setStatusFilter('inactive')}
                    style={{ padding: '0.4rem 1rem', borderRadius: '8px', border: 'none', background: statusFilter === 'inactive' ? 'white' : 'transparent', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', color: statusFilter === 'inactive' ? '#64748b' : '#64748b', boxShadow: statusFilter === 'inactive' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none', transition: 'all 0.2s ease' }}
                  >
                    Sin Plan
                  </button>
                </div>

               <div className="search-input-wrapper" style={{ width: '280px', margin: 0, position: 'relative' }}>
                 <Search className="icon" size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                 <input 
                   placeholder="Filtrar por nombre o teléfono..." 
                   value={listFilter}
                   onChange={(e) => setListFilter(e.target.value)}
                   style={{ width: '100%', padding: '0.6rem 1rem 0.6rem 2.25rem', fontSize: '0.85rem', borderRadius: '10px', border: '1px solid #cbd5e1', background: '#f8fafc' }}
                 />
               </div>
            </div>
          </div>

          {(() => {
            const filteredList = allClients.filter(c => {
              const matchesSearch = !listFilter || 
                (c.nombre && c.nombre.toLowerCase().includes(listFilter.toLowerCase())) ||
                (c.telefono && String(c.telefono).includes(listFilter)) ||
                (c.cedula && String(c.cedula).includes(listFilter));
              
              if (!matchesSearch) return false;

              const isCancelled = c.status === 'Cancelled' || c.contract_status === 'Cancelled';
              const isPendingRetry = c.contract_status === 'Pending_Retry' || (c.status === 'Inactive' && !isCancelled);
              const isActive = (c.status === 'Active' || c.contract_status === 'Active' || c.contract_status === 'Activo') && c.planName && c.planName !== 'Sin Plan';

              if (statusFilter === 'active') return isActive;
              if (statusFilter === 'pending') return isPendingRetry;
              if (statusFilter === 'cancelled') return isCancelled;
              if (statusFilter === 'inactive') return !isActive && !isPendingRetry && !isCancelled;
              return true;
            });

            return (
              <div className="grid-3" style={{ gap: '1.5rem' }}>
                {filteredList.length > 0 ? filteredList.map(c => {
                  const isCancelled = c.status === 'Cancelled' || c.contract_status === 'Cancelled';
                  const isSuspended = c.contract_status === 'Suspended' || (c.retry_count >= 90);
                  const isPendingRetry = c.contract_status === 'Pending_Retry' || (c.status === 'Inactive' && !isCancelled && !isSuspended);
                  const isActive = (c.status === 'Active' || c.contract_status === 'Active' || c.contract_status === 'Activo') && c.planName && c.planName !== 'Sin Plan';

                  let topBarColor = '#cbd5e1';
                  let boxBg = '#f8fafc';
                  let boxBorder = '#e2e8f0';
                  let titleColor = '#64748b';
                  let titleText = 'MEMBRESÍA';
                  let valueColor = '#94a3b8';
                  let valueText = 'Sin Suscripción';

                  if (isCancelled) {
                    topBarColor = '#dc2626';
                    boxBg = '#fef2f2';
                    boxBorder = '#fecaca';
                    titleColor = '#dc2626';
                    titleText = '✕ ESTADO DE MEMBRESÍA';
                    valueColor = '#991b1b';
                    valueText = `✕ Cancelado (${c.planName || 'Plan Beauty'})`;
                  } else if (isSuspended) {
                    topBarColor = '#7f1d1d';
                    boxBg = '#fef2f2';
                    boxBorder = '#f87171';
                    titleColor = '#991b1b';
                    titleText = '🛑 ESTADO DE MEMBRESÍA';
                    valueColor = '#7f1d1d';
                    valueText = 'Suspendido por Mora';
                  } else if (isPendingRetry) {
                    topBarColor = '#f59e0b';
                    boxBg = '#fffbeb';
                    boxBorder = '#fde68a';
                    titleColor = '#d97706';
                    titleText = `⚠️ COBRO PENDIENTE (${c.retry_count || 1}/90)`;
                    valueColor = '#b45309';
                    valueText = `Reintentando: ${c.planName || 'Plan Beauty'}`;
                  } else if (isActive) {
                    topBarColor = '#10b981';
                    boxBg = '#f0fdf4';
                    boxBorder = '#bbf7d0';
                    titleColor = '#166534';
                    titleText = '✓ MEMBRESÍA ACTIVA';
                    valueColor = '#14532d';
                    valueText = `${c.planName}`;
                  }

                  return (
                    <div key={c.id} className="surface-card client-list-card" style={{ cursor: 'pointer', transition: 'all 0.2s ease', position: 'relative', overflow: 'hidden', border: '1px solid #f1f5f9', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }} onClick={() => selectClient(c)} onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0,0,0,0.1)'; }} onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.05)'; }}>
                      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '4px', background: topBarColor }}></div>
                      
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
                        <div style={{ width: '52px', height: '52px', borderRadius: '50%', background: isCancelled ? '#fee2e2' : (isPendingRetry ? '#fef3c7' : '#f8fafc'), border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isCancelled ? '#dc2626' : (isPendingRetry ? '#d97706' : '#0f172a'), fontSize: '1.25rem', fontWeight: 800, flexShrink: 0 }}>
                          {(c.nombre || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <h4 style={{ fontWeight: 800, fontSize: '1.1rem', color: '#09090b', marginBottom: '0.2rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.nombre}>{c.nombre}</h4>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>ID: {c.cedula}</p>
                            {c.registration_source && (
                              <span style={{ 
                                fontSize: '0.6rem', 
                                fontWeight: 800, 
                                color: c.registration_source === 'Self' ? '#10b981' : '#3b82f6',
                                background: c.registration_source === 'Self' ? '#f0fdf4' : '#eff6ff',
                                padding: '1px 5px',
                                borderRadius: '4px',
                                border: `1px solid ${c.registration_source === 'Self' ? '#bbf7d0' : '#bfdbfe'}`
                              }}>
                                {c.registration_source.toUpperCase()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div style={{ background: boxBg, padding: '0.85rem', borderRadius: '10px', marginBottom: '1.25rem', border: `1px solid ${boxBorder}` }}>
                        <p style={{ fontSize: '0.65rem', color: titleColor, fontWeight: 800, textTransform: 'uppercase', marginBottom: '0.25rem', letterSpacing: '0.05em' }}>{titleText}</p>
                        <p style={{ fontSize: '0.9rem', fontWeight: 800, color: valueColor }}>{valueText}</p>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', color: '#64748b' }}>
                          <Phone size={14} strokeWidth={2.5} style={{ color: '#94a3b8' }} /> <span style={{ fontWeight: 600 }}>{c.telefono}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', color: '#64748b' }}>
                          <Mail size={14} strokeWidth={2.5} style={{ color: '#94a3b8', flexShrink: 0 }} /> <span style={{ wordBreak: 'break-all', lineHeight: 1.2, fontWeight: 600 }}>{c.email}</span>
                        </div>
                      </div>

                      <div style={{ marginTop: '1.5rem', display: 'flex' }}>
                        <button className="btn-primary" style={{ width: '100%', padding: '0.75rem', fontSize: '0.75rem', background: '#09090b', color: 'white', borderRadius: '10px', fontWeight: 800, transition: 'all 0.2s ease' }}>Ver Historial Completo</button>
                      </div>
                    </div>
                  );
                }) : (
                  <div className="surface-card" style={{ gridColumn: 'span 3', padding: '4rem', textAlign: 'center' }}>
                    <Users size={48} style={{ margin: '0 auto 1.5rem', opacity: 0.2 }} />
                    <p>No se encontraron clientes con los filtros seleccionados.</p>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
      {/* Card Update Modal */}
      {isUpdatingCard && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="surface-card" 
            style={{ width: '100%', maxWidth: '500px', padding: '2.5rem', position: 'relative' }}
          >
            <button 
              onClick={() => setIsUpdatingCard(false)}
              style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
            >
              <Scissors size={20} style={{ transform: 'rotate(45deg)' }} /> {/* Using scissors as close icon for salon theme */}
            </button>

            <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
              <div style={{ width: '60px', height: '60px', background: 'var(--bg-canvas)', borderRadius: '50%', margin: '0 auto 1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>
                <CreditCard size={30} />
              </div>
              <h3 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Actualizar Tarjeta</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Vincula una nueva tarjeta para los cobros automáticos de <strong>{client.nombre}</strong>.</p>
            </div>

            <div style={{ background: 'var(--bg-canvas)', padding: '2rem', borderRadius: '16px', border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
               {useSimulatedModal ? (
                 <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                   <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', color: '#78350f', padding: '0.75rem', borderRadius: '8px', fontSize: '0.7rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                     ⚠️ Sandbox de CardNet offline. Modo de Simulación Local Activo.
                   </div>
                   
                   <div>
                     <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>MARCA DE LA TARJETA</label>
                     <select 
                       className="input-field" 
                       style={{ fontSize: '0.8rem', padding: '0.5rem', width: '100%' }}
                       id="mock_brand_select"
                       defaultValue="Visa"
                     >
                       <option value="Visa">Visa</option>
                       <option value="MasterCard">MasterCard</option>
                       <option value="Amex">American Express</option>
                     </select>
                   </div>

                   <div>
                     <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>NÚMERO DE TARJETA DE PRUEBAS</label>
                     <input 
                       type="text" 
                       className="input-field" 
                       style={{ fontSize: '0.8rem', padding: '0.5rem', width: '100%' }}
                       defaultValue="4000 1234 5678 9010"
                       disabled
                     />
                   </div>

                   <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                     <div>
                       <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>EXPIRACIÓN (YYYYMM)</label>
                       <input 
                         type="text" 
                         className="input-field" 
                         id="mock_exp_input"
                         style={{ fontSize: '0.8rem', padding: '0.5rem', width: '100%' }}
                         defaultValue="203012"
                       />
                     </div>
                     <div>
                       <label style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>CVV</label>
                       <input 
                         type="text" 
                         className="input-field" 
                         style={{ fontSize: '0.8rem', padding: '0.5rem', width: '100%' }}
                         defaultValue="123"
                         disabled
                       />
                     </div>
                   </div>

                   <button 
                     onClick={async () => {
                       try {
                         setIsProcessingCard(true);
                         setCardnetLog('');
                         const brand = document.getElementById("mock_brand_select").value;
                         const exp = document.getElementById("mock_exp_input").value;
                         const token = `mock_token_${brand.toLowerCase()}_${Date.now()}`;
                         
                         showNotification("Vinculando tarjeta de prueba localmente...");
                         const res = await dataService.updatePaymentMethod(client.id, token);
                         
                         if (res.success) {
                           showNotification("¡Tarjeta vinculada con éxito localmente!", "success");
                           setIsUpdatingCard(false);
                           setUseSimulatedModal(false);
                           await selectClient(client); // Refresh card info
                         } else {
                           throw new Error(res.error || "Error al vincular.");
                         }
                       } catch (e) {
                         setCardnetLog(e.message);
                       } finally {
                         setIsProcessingCard(false);
                       }
                     }}
                     className="btn-primary"
                     style={{ width: '100%', marginTop: '0.5rem', padding: '0.75rem', fontSize: '0.85rem' }}
                     disabled={isProcessingCard}
                   >
                     {isProcessingCard ? "VINCULANDO..." : "VINCULAR TARJETA DE PRUEBAS"}
                   </button>

                   {cardnetLog && (
                     <div style={{ marginTop: '0.5rem', padding: '1rem', background: '#fee2e2', color: '#991b1b', borderRadius: '8px', fontSize: '0.75rem' }}>
                        <strong>Error:</strong> {cardnetLog}
                      </div>
                   )}
                 </div>
               ) : isProcessingCard ? (
                 <p style={{ fontWeight: 600 }}>Cargando pasarela segura...</p>
               ) : (
                 <>
                   <form id="checkout_form_fake_profile">
                      <input type="hidden" id="PWToken" name="PWToken" />
                      <input type="hidden" id="SessionId" name="SessionId" />
                      <input type="hidden" id="UniqueID" name="UniqueID" />
                      <button id="btnCardNetUpdate" style={{ display: 'none' }}>Update</button>
                   </form>
                   <p style={{ fontSize: '0.875rem', marginBottom: '1rem' }}>Siga las instrucciones en la ventana emergente de CardNet.</p>
                   {cardnetLog && (
                     <div style={{ marginTop: '1rem', padding: '1rem', background: '#fee2e2', color: '#991b1b', borderRadius: '8px', fontSize: '0.75rem', textAlign: 'left' }}>
                        <strong>Error:</strong> {cardnetLog}
                      </div>
                   )}
                 </>
               )}
            </div>

            <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '1.5rem' }}>
              Esta operación no modifica sus planes actuales, solo cambia el método de cobro futuro.
            </p>
          </motion.div>
        </div>
      )}

      {/* Payment Confirmation Modal (Custom instead of Prompt) */}
      {showPaymentModal && pendingCharge && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '1rem' }}>
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            style={{ background: 'white', padding: '3rem', borderRadius: '24px', width: '100%', maxWidth: '450px', textAlign: 'center', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}
          >
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ width: '64px', height: '64px', background: '#f0f9ff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
                <CreditCard size={32} color="#0ea5e9" />
              </div>
              <h3 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>Confirmar Cobro</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                Se realizará el cobro del plan fijo a la tarjeta terminada en <strong>{pendingCharge.card.Last4}</strong>.
              </p>
            </div>

            <div style={{ background: '#f8fafc', padding: '1.5rem', borderRadius: '16px', border: '1px solid #e2e8f0', marginBottom: '2rem' }}>
               <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Monto a Facturar</p>
               <p style={{ fontSize: '2.5rem', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
                 RD$ {parseFloat(pendingCharge.amount).toLocaleString('en-US')}
               </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <button 
                onClick={confirmAndStartOTP}
                className="btn-primary"
                style={{ padding: '1.25rem', width: '100%', fontSize: '1rem', background: 'var(--text-primary)' }}
              >
                Confirmar y Generar Código
              </button>
              
              <button 
                onClick={() => { setShowPaymentModal(false); setPendingCharge(null); }}
                className="btn-secondary"
                style={{ padding: '1rem', width: '100%' }}
              >
                Cancelar
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* OTP Verification Modal */}
      {showOtpModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '1rem' }}>
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            style={{ background: 'white', padding: '3rem', borderRadius: '24px', width: '100%', maxWidth: '450px', textAlign: 'center', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}
          >
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ width: '64px', height: '64px', background: '#f8fafc', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
                <ShieldCheck size={32} color="var(--text-primary)" />
              </div>
              <h3 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>Verificar Consumo</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                Se ha enviado un código de seguridad al correo de <strong>{client.nombre}</strong>.
                Por favor, ingrésalo para descontar: <br/> <strong>{deductingService}</strong>.
              </p>
            </div>

            {/* Staff Selection Section */}
            {!pendingCharge && (
              <div style={{ marginBottom: '2rem', textAlign: 'left', background: '#f8fafc', padding: '1.5rem', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                <p style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#64748b', marginBottom: '1rem' }}>Asignar Staff:</p>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <label style={{ fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', display: 'block', marginBottom: '0.4rem' }}>PELUQUERA / ESTILISTA</label>
                    <select 
                      className="input-field" 
                      style={{ fontSize: '0.85rem', padding: '0.5rem' }}
                      value={selectedStaff.peluquera}
                      onChange={e => setSelectedStaff({...selectedStaff, peluquera: e.target.value})}
                    >
                      <option value="">Seleccionar Profesional</option>
                      {employees.filter(e => e.rol === 'Peluquera').map(e => (
                        <option key={e.id} value={e.nombre}>{e.nombre}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', display: 'block', marginBottom: '0.4rem' }}>LAVA PELO</label>
                    <select 
                      className="input-field" 
                      style={{ fontSize: '0.85rem', padding: '0.5rem' }}
                      value={selectedStaff.lavaPelo}
                      onChange={e => setSelectedStaff({...selectedStaff, lavaPelo: e.target.value})}
                    >
                      <option value="">Seleccionar Profesional</option>
                      {employees.filter(e => e.rol === 'Lava pelo').map(e => (
                        <option key={e.id} value={e.nombre}>{e.nombre}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.65rem', fontWeight: 800, color: '#94a3b8', display: 'block', marginBottom: '0.4rem' }}>MANICURISTA</label>
                    <select 
                      className="input-field" 
                      style={{ fontSize: '0.85rem', padding: '0.5rem' }}
                      value={selectedStaff.manicurista}
                      onChange={e => setSelectedStaff({...selectedStaff, manicurista: e.target.value})}
                    >
                      <option value="">Seleccionar Profesional</option>
                      {employees.filter(e => e.rol === 'Manicurista').map(e => (
                        <option key={e.id} value={e.nombre}>{e.nombre}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            <div style={{ marginBottom: '2rem' }}>
              <p style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#64748b', marginBottom: '1rem', textAlign: 'left' }}>Código de Seguridad:</p>
              <input 
                type="text" 
                maxLength="6"
                placeholder="0 0 0 0 0 0"
                value={otpValue}
                onChange={e => setOtpValue(e.target.value.replace(/\D/g, ''))}
                style={{ width: '100%', textAlign: 'center', letterSpacing: '0.5em', fontSize: '2rem', fontWeight: 800, padding: '1rem', border: '2px solid #e2e8f0', borderRadius: '12px', outline: 'none', transition: 'border-color 0.2s' }}
                onFocus={e => e.target.style.borderColor = 'var(--text-primary)'}
                onBlur={e => e.target.style.borderColor = '#e2e8f0'}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <button 
                onClick={handleVerifyOTP}
                disabled={isVerifying || otpValue.length < 6}
                className="btn-primary"
                style={{ padding: '1.25rem', width: '100%', fontSize: '1rem' }}
              >
                {isVerifying ? 'Verificando...' : 'Confirmar y Facturar'}
              </button>
              
              <button 
                onClick={() => setShowOtpModal(false)}
                className="btn-secondary"
                style={{ padding: '1rem', width: '100%' }}
              >
                Cancelar
              </button>

              <button 
                onClick={handleRequestAdminCode}
                style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline', marginTop: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', width: '100%' }}
              >
                <Smartphone size={14} />
                Solicitar código al administrador
              </button>
            </div>

            {(user?.role?.toLowerCase() === 'admin' || user?.role?.toLowerCase() === 'administrador') && (
              <div style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '1px dashed #e2e8f0' }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>Contingencia de Administrador:</p>
                {activeOtpCode ? (
                  <div style={{ background: '#f0f9ff', padding: '1rem', borderRadius: '8px', border: '1px solid #bae6fd' }}>
                    <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0369a1', letterSpacing: '0.1em' }}>{activeOtpCode}</span>
                    <p style={{ fontSize: '0.65rem', color: '#0369a1', marginTop: '0.25rem' }}>Dígale este código a la cajera.</p>
                  </div>
                ) : (
                  <button 
                    onClick={fetchActiveOTP}
                    style={{ background: 'none', border: 'none', color: 'var(--text-primary)', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Visualizar código enviado
                  </button>
                )}
              </div>
            )}
          </motion.div>
        </div>
      )}

      {/* Survey Modal */}
      {showSurveyModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '1.5rem' }}>
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            style={{ background: 'white', width: '100%', maxWidth: '700px', borderRadius: '32px', padding: '3rem', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 30px 60px -12px rgba(0, 0, 0, 0.3)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
              <div style={{ background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)', width: '70px', height: '70px', borderRadius: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', boxShadow: '0 10px 20px rgba(245, 158, 11, 0.2)' }}>
                <Award size={36} color="white" />
              </div>
              <h3 style={{ fontSize: '2rem', fontWeight: 900, color: '#1e293b', marginBottom: '0.75rem', letterSpacing: '-0.025em' }}>Tu Experiencia en Plan Beauty</h3>
              <p style={{ color: '#64748b', fontSize: '1rem', fontWeight: 500 }}>Ayúdanos a brindarte un servicio de excelencia cada día.</p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
              {/* Question List */}
              {[
                { id: 'q1', label: '1. ¿Qué tan satisfecha estás con el servicio recibido hoy?', icon: '✨' },
                { id: 'q2', label: '2. ¿Cómo calificarías el desempeño del personal (peluquera/lava pelo)?', icon: '👤' },
                { id: 'q3', label: '3. ¿Cómo calificarías el tiempo de espera?', icon: '⏳' },
                { id: 'q4', label: '4. ¿Cómo calificarías tu experiencia general en el salón?', icon: '⭐' },
                { id: 'q5', label: '5. ¿Qué tan probable es que nos recomiendes a una amiga o familiar?', icon: '🤝' },
              ].map((q, idx) => (
                <div key={q.id} style={{ background: '#f8fafc', padding: '1.75rem', borderRadius: '24px', border: '1px solid #f1f5f9' }}>
                  <p style={{ fontWeight: 800, fontSize: '1rem', marginBottom: '1.25rem', color: '#334155', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontSize: '1.25rem' }}>{q.icon}</span> {q.label}
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(11, 1fr)', gap: '6px' }}>
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                      <button
                        key={n}
                        onClick={() => setSurveyForm({ ...surveyForm, [q.id]: n })}
                        style={{ 
                          height: '45px', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          borderRadius: '12px', 
                          border: surveyForm[q.id] === n ? '2px solid #09090b' : '1px solid #e2e8f0', 
                          background: surveyForm[q.id] === n ? '#09090b' : 'white', 
                          color: surveyForm[q.id] === n ? 'white' : '#64748b', 
                          fontSize: '0.9rem', 
                          fontWeight: 800, 
                          cursor: 'pointer',
                          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                          boxShadow: surveyForm[q.id] === n ? '0 4px 12px rgba(0,0,0,0.15)' : 'none',
                          transform: surveyForm[q.id] === n ? 'scale(1.05)' : 'scale(1)'
                        }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.75rem', padding: '0 4px' }}>
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700 }}>Pobre</span>
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700 }}>Excelente</span>
                  </div>
                </div>
              ))}

              <div style={{ background: '#f8fafc', padding: '1.75rem', borderRadius: '24px', border: '1px solid #f1f5f9' }}>
                <p style={{ fontWeight: 800, fontSize: '1rem', marginBottom: '1.25rem', color: '#334155', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>📝</span> 6. ¿Tienes alguna sugerencia o comentario adicional?
                </p>
                <textarea 
                  value={surveyForm.q6}
                  onChange={e => setSurveyForm({ ...surveyForm, q6: e.target.value })}
                  placeholder="Escribe aquí tus sugerencias para ayudarnos a mejorar..."
                  style={{ width: '100%', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '1.25rem', minHeight: '120px', outline: 'none', fontSize: '0.95rem', fontWeight: 500, transition: 'border-color 0.2s', resize: 'vertical' }}
                  onFocus={e => e.target.style.borderColor = '#09090b'}
                  onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                />
              </div>

              <div style={{ display: 'flex', gap: '1.25rem', marginTop: '1rem' }}>
                <button 
                  onClick={handleSurveySubmit}
                  disabled={isSubmittingSurvey}
                  className="btn-primary" 
                  style={{ flex: 2, padding: '1.5rem', fontSize: '1.1rem', background: '#09090b', borderRadius: '18px' }}
                >
                  {isSubmittingSurvey ? 'Enviando...' : 'Enviar Calificación'}
                </button>
                <button 
                  onClick={() => setShowSurveyModal(false)}
                  className="btn-secondary" 
                  style={{ flex: 1, padding: '1.5rem', borderRadius: '18px' }}
                >
                  Cerrar
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Cancellation Verification Modal */}
      {actionModal.open && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)', zIndex: 2500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={{ width: '100%', maxWidth: '400px', background: 'white', padding: '2.5rem', borderRadius: '32px', textAlign: 'center' }}>
            <div style={{ width: '64px', height: '64px', background: '#fee2e2', color: '#ef4444', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
              <Scissors size={32} />
            </div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '0.5rem' }}>Confirmar Cancelación</h3>
            <p style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '2rem' }}>
              Se ha enviado un código al correo de <strong>{client.email}</strong> para autorizar la cancelación del contrato.
            </p>
            <input 
              type="text" maxLength="6" placeholder="000000"
              style={{ width: '100%', textAlign: 'center', fontSize: '2rem', fontWeight: 900, letterSpacing: '8px', padding: '1rem', borderRadius: '16px', border: '2px solid #f1f5f9', background: '#f8fafc', marginBottom: '2rem', outline: 'none' }}
              value={actionModal.code}
              onChange={(e) => setActionModal({ ...actionModal, code: e.target.value.replace(/\D/g, '') })}
            />
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button onClick={() => setActionModal({ open: false, type: null, code: '', loading: false })} style={{ flex: 1, padding: '1rem', borderRadius: '16px', border: '2px solid #f1f5f9', background: 'white', fontWeight: 800, cursor: 'pointer' }}>Volver</button>
              <button 
                onClick={handleConfirmCancel}
                style={{ flex: 1, padding: '1rem', borderRadius: '16px', border: 'none', background: '#ef4444', color: 'white', fontWeight: 800, cursor: 'pointer' }}
                disabled={actionModal.loading}
              >
                {actionModal.loading ? '...' : 'Confirmar'}
              </button>
            </div>

            {(user?.role?.toLowerCase() === 'admin' || user?.role?.toLowerCase() === 'administrador') && (
              <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px dashed #e2e8f0' }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>Acceso Administrativo:</p>
                {activeOtpCode ? (
                  <div style={{ background: '#f0f9ff', padding: '1rem', borderRadius: '12px', border: '1px solid #bae6fd' }}>
                    <span style={{ fontSize: '1.5rem', fontWeight: 900, color: '#0369a1', letterSpacing: '0.1em' }}>{activeOtpCode}</span>
                    <p style={{ fontSize: '0.65rem', color: '#0369a1', marginTop: '0.25rem' }}>Use este código si el cliente no puede ver su correo.</p>
                  </div>
                ) : (
                  <button 
                    onClick={fetchActiveOTP}
                    style={{ background: 'none', border: 'none', color: 'var(--text-primary)', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Visualizar código enviado
                  </button>
                )}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default ClientProfile;
