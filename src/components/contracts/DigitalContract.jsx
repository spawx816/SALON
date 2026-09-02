import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTranslation } from '../../context/LanguageContext';
import { useNotification } from '../../context/NotificationContext';
import { dataService } from '../../utils/dataService';
import { getCardNetErrorMessage } from '../../utils/cardnetErrors';
import { loadCardNetScript } from '../../utils/cardnetScriptLoader';
import { Search, ShieldCheck, Printer, FileText, Download, CheckCircle, AlertCircle, X, Camera, Smartphone, Info, UserCheck, User, FilePlus, Archive } from 'lucide-react';
import ClientRegistration from '../clients/ClientRegistration';

// Add Google Font for signature
if (typeof document !== 'undefined') {
  const fontLink = document.createElement('link');
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap';
  fontLink.rel = 'stylesheet';
  document.head.appendChild(fontLink);
}

const parseUA = (ua) => {
  if (!ua) return 'Desconocido';
  let os = 'Otro OS';
  if (ua.includes('Win')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('like Mac')) os = 'iOS';

  let browser = 'Otro';
  if (ua.includes('OPR') || ua.includes('Opera')) browser = 'Opera';
  else if (ua.includes('Edg')) browser = 'Edge';
  else if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Safari')) browser = 'Safari';
  else if (ua.includes('Firefox')) browser = 'Firefox';

  return `${os} - ${browser}`;
};

const DigitalContract = ({ initialClient = null, isModal = false, onContractCreated = null, onClose = null }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation();
  const { showNotification } = useNotification();

  // Permisos: Solo Admin o quienes tengan view_contracts
  const isAdmin = user?.role === 'admin' || user?.role_name === 'Administrador';
  const hasAccess = isAdmin || (user?.permissions && user?.permissions.view_contracts) || isModal;

  useEffect(() => {
    if (!hasAccess && !isModal) {
      navigate('/');
    }
  }, [hasAccess, navigate, isModal]);

  if (!hasAccess && !isModal) return null;
  const [step, setStep] = useState(0); 
  const [activeTab, setActiveTab] = useState('new'); // 'new' or 'archive'
  const [client, setClient] = useState(initialClient || null);
  const [plans, setPlans] = useState([]);
  const [allContracts, setAllContracts] = useState([]);
  const [filteredContracts, setFilteredContracts] = useState([]);
  const [archiveSearch, setArchiveSearch] = useState('');
  const [selectedContract, setSelectedContract] = useState(null);
  const [actionModal, setActionModal] = useState({ open: false, contract: null, type: null, code: '', loading: false });
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [searchCedula, setSearchCedula] = useState('');
  const [metadata, setMetadata] = useState({
    ip: 'Cargando...',
    device: '',
    date: new Date().toLocaleString(),
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone
  });
  const [cardnetLog, setCardnetLog] = useState('');
  const [savedToken, setSavedToken] = useState(null);
  const [idFront, setIdFront] = useState(null);
  const [selfie, setSelfie] = useState(null);
  const [isCardNetActive, setIsCardNetActive] = useState(false);

  // Client registration & edit form state
  const [clientFormData, setClientFormData] = useState({
    nombre: '',
    cedula: '',
    telefono: '',
    email: '',
    direccion: ''
  });
  const [savingClientData, setSavingClientData] = useState(false);

  // Autocomplete search suggestions state
  const [allClients, setAllClients] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    const load = async () => {
      setMetadata(prev => ({ ...prev, device: navigator.userAgent }));
      
      const p = await dataService.getPlans();
      setPlans(p);
      if (p.length > 0) setSelectedPlanId(p[0].id);

      // Fetch real public IP for metadata
      try {
        const ipRes = await fetch('https://api.ipify.org?format=json');
        if (ipRes.ok) {
          const ipData = await ipRes.json();
          setMetadata(prev => ({ ...prev, ip: ipData.ip }));
        }
      } catch (err) {
        console.warn("Could not fetch public IP:", err);
      }

      const [conts, clientsData] = await Promise.all([
        dataService.getContracts(),
        dataService.getClients()
      ]);

      setAllClients(clientsData || []);

      const enriched = conts.map(c => {
        const cl = clientsData.find(cli => cli.id === c.client_id);
        const pl = p.find(plan => plan.id === c.plan_id);
        return {
          ...c,
          clientName: cl?.nombre || 'Desconocido',
          clientCedula: cl?.cedula || 'N/A',
          planTitle: pl?.title || 'Plan Desconocido'
        };
      }).sort((a, b) => new Date(b.signed_at) - new Date(a.signed_at));

      setAllContracts(enriched);
      setFilteredContracts(enriched);

      // Auto-search if initialClient or cedula was passed
      if (initialClient) {
        setClient(initialClient);
        setSearchCedula(initialClient.cedula || initialClient.nombre || initialClient.name || '');
        const available = p.filter(pl => !(initialClient.active_plan_ids || []).includes(pl.id.toString()));
        if (available.length > 0) setSelectedPlanId(available[0].id);
      } else if (location.state?.clientCedula) {
        setSearchCedula(location.state.clientCedula);
        const found = await dataService.findClientByCedula(location.state.clientCedula);
        if (found) {
          setClient(found);
          const available = p.filter(pl => !(found.active_plan_ids || []).includes(pl.id.toString()));
          if (available.length > 0) setSelectedPlanId(available[0].id);
          else setSelectedPlanId('');
        }
      }
    };
    load();
  }, [location.state, initialClient]);

  useEffect(() => {
    if (initialClient) {
      setClient(initialClient);
      setSearchCedula(initialClient.cedula || initialClient.nombre || initialClient.name || '');
      setClientFormData({
        nombre: initialClient.nombre || initialClient.name || '',
        cedula: initialClient.cedula || '',
        telefono: initialClient.telefono || '',
        email: initialClient.email || '',
        direccion: initialClient.direccion || ''
      });
    }
  }, [initialClient]);

  useEffect(() => {
    if (client) {
      setClientFormData({
        nombre: client.nombre || client.name || '',
        cedula: client.cedula || '',
        telefono: client.telefono || '',
        email: client.email || '',
        direccion: client.direccion || ''
      });
    }
  }, [client]);

  const [signature, setSignature] = useState('');

  const handleSearchChange = (val) => {
    setSearchCedula(val);
    if (val.trim().length > 1) {
      const filtered = allClients.filter(c => 
        (c.nombre && c.nombre.toLowerCase().includes(val.toLowerCase())) ||
        (c.cedula && c.cedula.replace(/-/g, '').includes(val.replace(/-/g, '')))
      );
      setSuggestions(filtered.slice(0, 5));
      setShowSuggestions(true);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const selectClientSuggestion = async (c) => {
    setSearchCedula(c.cedula);
    setShowSuggestions(false);
    setClient(c);
    
    // Fetch live plans to validate active_plan_ids
    const found = await dataService.findClientByCedula(c.cedula);
    if (found) {
      setClient(found);
      const available = plans.filter(p => !(found.active_plan_ids || []).includes(p.id.toString()));
      if (available.length > 0) setSelectedPlanId(available[0].id);
      else setSelectedPlanId('');
    }
  };

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    setShowSuggestions(false);
    const found = await dataService.findClientByCedula(searchCedula);
    if (found) {
      setClient(found);
      const available = plans.filter(p => !(found.active_plan_ids || []).includes(p.id.toString()));
      if (available.length > 0) setSelectedPlanId(available[0].id);
      else setSelectedPlanId('');
    } else {
      showNotification(t('contract.step0.alert'), 'error');
    }
  };

  const handleFinish = async () => {
    if (!client?.id) return showNotification('Debes buscar un cliente primero.', 'error');
    if (!selectedPlanId) return showNotification('Debes seleccionar un plan.', 'error');
    const res = await dataService.saveContract({
      clientId: client.id,
      planId: selectedPlanId,
      signature_hash: signature || client.nombre,
      documentPhoto: idFront,
      selfiePhoto: selfie,
      ip_address: metadata.ip,
      deviceAgent: navigator.userAgent
    });
    showNotification(t('contract.alert.done'), 'success');
    if (onContractCreated) {
      onContractCreated(res);
    }
    if (isModal && onClose) {
      onClose();
      return;
    }
    setStep(0);
    setClient(null);
    setSearchCedula('');
  };

  const handleSaveClientAndContinue = async () => {
    if (!clientFormData.nombre.trim()) {
      showNotification('El nombre del cliente es obligatorio', 'error');
      return;
    }
    if (!clientFormData.cedula.trim()) {
      showNotification('El número de Cédula o Identificación es obligatorio para el contrato de membresía', 'error');
      return;
    }

    setSavingClientData(true);
    try {
      let updated = null;
      if (client && client.id) {
        updated = await dataService.updateClient(client.id, {
          ...client,
          nombre: clientFormData.nombre,
          cedula: clientFormData.cedula,
          telefono: clientFormData.telefono,
          email: clientFormData.email,
          direccion: clientFormData.direccion
        });
      } else {
        updated = await dataService.addClient({
          nombre: clientFormData.nombre,
          cedula: clientFormData.cedula,
          telefono: clientFormData.telefono,
          email: clientFormData.email,
          direccion: clientFormData.direccion
        });
      }
      const finalClient = updated || { ...client, ...clientFormData };
      setClient(finalClient);
      showNotification('Datos del cliente guardados exitosamente', 'success');
      setStep(1);
    } catch (err) {
      console.error('Error guardando datos del cliente:', err);
      setClient(prev => ({ ...prev, ...clientFormData }));
      setStep(1);
    } finally {
      setSavingClientData(false);
    }
  };

  const handleBiometricsContinue = () => {
    if (!idFront || !selfie) {
      return showNotification('Debes subir la foto de tu cédula y el selfie para continuar.', 'error');
    }
    setStep(2);
  };

  const completeContractWithToken = async (tokenId) => {
    try {
        if (!selectedPlanId) return showNotification('Debes seleccionar un plan.', 'error');
        
        console.log("[CONTRACT] Guardando contrato final en el backend...");
        showNotification("Procesando activación y cobro inicial...", "info");
        
        // Pequeño delay estratégico para propagación de token en CardNet
        await new Promise(resolve => setTimeout(resolve, 1500));

        const res = await dataService.saveContract({
          clientId: client?.id,
          planId: selectedPlanId,
          signature_hash: signature || client?.nombre,
          pwToken: tokenId, // Pasamos el One Time Token de CardNet al backend
          documentPhoto: idFront,
          selfiePhoto: selfie,
          ip_address: metadata.ip,
          deviceAgent: navigator.userAgent
        });

        if (res.error || !res.success) {
           throw new Error(res.error || "El servidor no pudo procesar la activación del contrato.");
        }

        showNotification("¡Suscripción y Pago Recurrente activados con éxito!", 'success');
        if (onContractCreated) {
          onContractCreated(res);
        }
        if (isModal && onClose) {
          onClose();
          return;
        }
        setStep(0);
        setClient(null);
        setSearchCedula('');
        setSavedToken(null);
        setSignature('');
    } catch (e) {
        console.error("[CONTRACT] Error al finalizar:", e);
        showNotification("Error al activar contrato: " + e.message, 'error');
        setSavedToken(null);
        setSignature('');
    }
  };

  const openCardNetIframe = async () => {
    try {
        // 1. Obtener Sesión
        const customer = await dataService.cardnetCreateCustomer(client?.email || "correo@default.com", client?.id);
        const uniqueId = customer.uniqueId || customer.UniqueID;
        if (!uniqueId) throw new Error("No se pudo obtener la sesión de CardNet.");

        const public_key = customer.publicKey || customer.PublicKey || "J_eHXPYlDo9wlFpFXjgalm_I56ONV7HQ";
        const capture_url = customer.captureUrl || customer.CaptureURL || "https://labservicios.cardnet.com.do/servicios/tokens/v1/Capture";

        // Cargar dinámicamente el SDK de CardNet del entorno correspondiente
        await loadCardNetScript(public_key, capture_url);

        if (typeof window.PWCheckout === 'undefined') return alert("Error: SDK CardNet no cargado.");

        // 2. Parche de Seguridad (Vigilante Asíncrono)
        const patchCardnet = setInterval(() => {
            if (window.PWCheckout && window.PWCheckout.Iframe && window.PWCheckout.Iframe.Close) {
                clearInterval(patchCardnet);
                const originalClose = window.PWCheckout.Iframe.Close;
                window.PWCheckout.Iframe.Close = function () {
                    console.log("[CardNet Parche] Intentando cerrar iframe...");
                    setIsCardNetActive(false);
                    if (!document.getElementById(window.PWCheckout.Iframe.frameId)) {
                        console.warn("[CardNet Parche] El Iframe ya no existe, ignorando cierre para evitar crash.");
                        return;
                    }
                    try {
                        originalClose.apply(this, arguments);
                        console.log("[CardNet Parche] Cierre ejecutado.");
                    } catch (err) {
                        console.error("[CardNet Parche] Error interno silenciado:", err);
                    }
                };
            }
        }, 100);

        // 3. Configurar Evento
        window.PWCheckout.Bind("tokenCreated", (token) => {
           setIsCardNetActive(false);
           if (token && token.TokenId) {
               setStep(4);
               setSavedToken(token.TokenId);
               
               // Limpiamos el vigilante si por alguna razón no se ejecutó
               clearInterval(patchCardnet);
               
               setTimeout(() => {
                 try { if (window.PWCheckout?.Iframe) window.PWCheckout.Iframe.Close(); } catch(e) {}
               }, 500);
            } else if (token && (token.error || token.ErrorMessage || token.ErrorCode)) {
               const friendlyMsg = getCardNetErrorMessage(token);
               showNotification(friendlyMsg, 'error');
               setCardnetLog(JSON.stringify(token, null, 2));
            }
        });
       
        // 4. Configurar Propiedades y Abrir
        window.PWCheckout.SetProperties({
            "name": "Suscripción PLAN BEAUTY",
            "email": client?.email || "correo@default.com",
            "button_label": "Asociar Tarjeta",
            "description": "Activación de Suscripción Recurrente",
            "currency": "DOP",
            "amount": "",
            "lang": "ESP",
            "form_id": "checkout_form_fake",
            "checkout_card": 1,
            "session_id": uniqueId,
            "autoSubmit": "false",
            "empty": "false",
            "merchant_number": customer.merchantNumber || customer.MerchantNumber || "349251841",
            "merchant_terminal": customer.merchantTerminal || customer.MerchantTerminal || "10311240"
         });

         let cleanCaptureUrl = capture_url;
         if (!cleanCaptureUrl.endsWith('/')) cleanCaptureUrl += '/';
         const finalUrl = `${cleanCaptureUrl}?key=${public_key}&session_id=${uniqueId}`;
         
         setIsCardNetActive(true);
         window.PWCheckout.OpenIframeCustom(finalUrl, uniqueId);

         // Actively enforce z-index for CardNet iframe elements
         const fixZIndex = setInterval(() => {
           document.querySelectorAll('iframe, div').forEach(el => {
             if (
               (el.id && el.id.toLowerCase().includes('pwcheckout')) ||
               (el.className && typeof el.className === 'string' && el.className.toLowerCase().includes('pwcheckout')) ||
               (el.src && el.src.toLowerCase().includes('cardnet'))
             ) {
               el.style.zIndex = '2147483647';
               el.style.position = 'fixed';
             }
           });
         }, 50);
         setTimeout(() => clearInterval(fixZIndex), 8000);

    } catch (err) {
       setIsCardNetActive(false);
       console.error("CardNet Error:", err);
       const friendlyMsg = getCardNetErrorMessage(err);
       showNotification(friendlyMsg, 'error');
    }
  };

  const handleImageUpload = (e, setter) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setter(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const UploadBox = ({ label, icon: Icon, state, setter, helperText }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <label style={{ fontSize: '0.875rem', fontWeight: 700 }}>{label}</label>
      <div 
        onClick={() => document.getElementById(`upload-${label}`).click()}
        style={{ 
          border: '2px dashed var(--border-subtle)', 
          borderRadius: 'var(--radius-lg)', 
          height: '220px',
          display: 'flex', 
          flexDirection: 'column',
          alignItems: 'center', 
          justifyContent: 'center', 
          cursor: 'pointer', 
          transition: 'all 0.2s',
          background: state ? 'var(--bg-canvas)' : 'transparent',
          overflow: 'hidden',
          position: 'relative'
        }}
        onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--text-primary)'}
        onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-subtle)'}
      >
        {state ? (
          <img src={state} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <>
            <Icon size={40} style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }} />
            <p style={{ fontSize: '0.875rem', fontWeight: 600 }}>{helperText}</p>
          </>
        )}
        <input 
          id={`upload-${label}`}
          type="file" 
          accept="image/*" 
          capture="environment"
          style={{ display: 'none' }} 
          onChange={(e) => (handleImageUpload(e, setter))}
        />
      </div>
    
    {/* Formulario oculto requerido por CardNet SDK */}
    <form id="form_1" style={{ display: 'none' }}>
        <input name="PWToken" type="hidden" id="PWToken" />
    </form>
    </div>
  );

  useEffect(() => {
    if (!archiveSearch) {
      setFilteredContracts(allContracts);
    } else {
      const lower = archiveSearch.toLowerCase();
      setFilteredContracts(allContracts.filter(c => 
        c.clientName.toLowerCase().includes(lower) || 
        c.clientCedula.includes(lower) ||
        c.planTitle.toLowerCase().includes(lower)
      ));
    }
  }, [archiveSearch, allContracts]);

  const handleRequestCode = async (contract, type) => {
    try {
      setActionModal({ ...actionModal, loading: true });
      await dataService.requestContractCode(contract.id, type);
      setActionModal({ open: true, contract, type, code: '', loading: false });
      showNotification(`Código de verificación enviado al correo de ${contract.clientName}`, 'info');
    } catch (err) {
      showNotification(err.message, 'error');
      setActionModal({ ...actionModal, loading: false });
    }
  };

  const handleConfirmAction = async () => {
    const { contract, type, code } = actionModal;
    if (!code || code.length < 6) return showNotification('Por favor ingrese el código de 6 dígitos.', 'error');
    
    try {
      setActionModal({ ...actionModal, loading: true });
      const res = await dataService.confirmContractAction(contract.id, code, type);
      
      if (type === 'cancellation') {
        showNotification('Contrato cancelado exitosamente.', 'success');
        // Refresh contracts
        const conts = await dataService.getContracts();
        setAllContracts(conts);
        setActionModal({ open: false, contract: null, type: null, code: '', loading: false });
      } else if (type === 'manual_billing') {
        // Now trigger the actual charge
        showNotification('Código verificado. Procesando cobro...', 'info');
        const chargeRes = await dataService.cardnetChargeProfile(
          res.contract.cardnet_customer_id,
          res.contract.cardnet_profile_id,
          res.contract.price,
          `Cobro Mensual - ${res.contract.planTitle}`,
          res.contract.client_id
        );
        
        if (chargeRes.Status === 'Approved' || chargeRes.ResponseCode === '00' || chargeRes.ResponseCode === 'TR005') {
          showNotification('Facturación completada con éxito.', 'success');
          setActionModal({ open: false, contract: null, type: null, code: '', loading: false });
        } else {
          showNotification('Error al procesar el cobro: ' + (chargeRes.ResponseMessage || 'Error desconocido'), 'error');
          setActionModal({ ...actionModal, loading: false });
        }
      }
    } catch (err) {
      showNotification(err.message, 'error');
      setActionModal({ ...actionModal, loading: false });
    }
  };

  const handlePrint = async (contract) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert("Por favor, permite las ventanas emergentes para imprimir el contrato.");
      return;
    }

    printWindow.document.write(`
      <html>
        <head>
          <title>Cargando Contrato...</title>
          <style>
            body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; color: #64748b; }
            .loader { text-align: center; }
          </style>
        </head>
        <body>
          <div class="loader">
            <h2>Cargando documento...</h2>
            <p>Por favor espera un momento.</p>
          </div>
        </body>
      </html>
    `);

    let fullContract = contract;
    if (!contract.document_photo && !contract.selfie_photo) {
      try {
        const fetched = await dataService.getContractById(contract.id);
        if (fetched) fullContract = fetched;
      } catch (err) {
        console.error("Error loading full contract for printing:", err);
      }
    }

    const signatureDate = new Date(fullContract.signed_at || fullContract.created_at);
    const dateStr = isNaN(signatureDate.getTime()) ? 'N/A' : signatureDate.toLocaleString();
    
    printWindow.document.open();
    printWindow.document.write(`
      <html>
        <head>
          <title>Contrato Digital - ${fullContract.clientName}</title>
          <link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap" rel="stylesheet">
          <style>
            body { font-family: 'Plus Jakarta Sans', sans-serif; padding: 60px; color: #1e293b; line-height: 1.6; max-width: 800px; margin: 0 auto; }
            .header { text-align: center; border-bottom: 3px solid #0f172a; padding-bottom: 25px; margin-bottom: 40px; }
            .header h1 { margin: 0; font-size: 24px; font-weight: 900; letter-spacing: 2px; color: #0f172a; }
            .header p { margin: 10px 0 0 0; font-size: 14px; color: #64748b; font-weight: 600; }
            
            .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 40px; background: #f8fafc; padding: 25px; border-radius: 12px; border: 1px solid #e2e8f0; }
            .section-title { font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
            .data-value { font-size: 15px; font-weight: 700; color: #0f172a; }
            
            .legal-text { font-size: 13px; color: #334155; text-align: justify; margin-bottom: 50px; }
            .legal-text p { margin-bottom: 15px; }
            .legal-text strong { color: #0f172a; }

            .signature-section { display: flex; flex-direction: column; align-items: center; margin-top: 60px; page-break-inside: avoid; }
            .signature-line { width: 300px; border-top: 2px solid #0f172a; margin-top: 10px; }
            .signature-name { font-family: 'Dancing Script', cursive; font-size: 42px; color: #0f172a; margin-bottom: -10px; }
            
            .footer { margin-top: 80px; font-size: 11px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 30px; }
            .photo-annex { margin-top: 40px; page-break-before: always; border-top: 2px solid #0f172a; padding-top: 30px; }
            .photo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; }
            .photo-item { text-align: center; border: 1px solid #e2e8f0; padding: 15px; border-radius: 12px; background: #fff; }
            .photo-item img { max-width: 100%; height: 220px; object-fit: contain; border-radius: 8px; }
            .photo-label { font-size: 10px; font-weight: 800; color: #64748b; text-transform: uppercase; margin-bottom: 10px; display: block; }

            @media print {
              body { padding: 20px; }
              .meta-grid { background: #fff !important; border: 1px solid #000; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>CONTRATO DIGITAL DE MEMBRESÍA</h1>
            <p>ABATTE PELUQUERÍA - ETEREAS S.R.L.</p>
          </div>
          
          <div class="meta-grid">
            <div>
              <div class="section-title">CLIENTE</div>
              <div class="data-value">${fullContract.clientName}</div>
              <div style="font-size: 13px; color: #64748b; font-weight: 600;">ID: ${fullContract.clientCedula}</div>
            </div>
            <div>
              <div class="section-title">PLAN Y FECHA</div>
              <div class="data-value">${fullContract.planTitle}</div>
              <div style="font-size: 13px; color: #64748b; font-weight: 600;">Firmado: ${dateStr}</div>
            </div>
            <div style="grid-column: span 2; border-top: 1px solid #e2e8f0; padding-top: 15px;">
              <div class="section-title">EVIDENCIA DIGITAL</div>
              <div style="font-size: 12px; color: #475569;">
                <strong>IP:</strong> ${fullContract.ip_address || 'N/A'} | 
                <strong>DISP:</strong> <span title="${fullContract.device_agent || ''}">${parseUA(fullContract.device_agent)}</span>
                ${fullContract.geolocation ? `| <strong>GPS:</strong> ${fullContract.geolocation}` : ''}
              </div>
            </div>
          </div>

          <div class="legal-text" style="text-align: justify; line-height: 1.5; font-size: 13px;">
            <p style="text-align: center; font-weight: 800; margin-bottom: 20px; font-size: 16px;">CONTRATO DE SUSCRIPCIÓN DE SERVICIOS DE BELLEZA</p>
            
            <p>Entre los subscritos, La empresa: <strong>ETEREAS S. R. L.</strong>, debidamente constituida de conformidad con las leyes de la Republica Dominicana, con Registro Nacional del Contribuyente No. 1-31-91703-8, con su domicilio social en la Av. San Vicente De Paul esquina Calle Puerto Rico, Alma Rosa I, Plaza El Poder, Local 1F, Santo Domingo Este, Municipio De La De Provincia Santo Domingo, quien en lo que sigue del presente contrato se denominara, <strong>LA COMPAÑIA</strong>, y de la otra parte la Sra. <strong>${fullContract.clientName}</strong>, Dominicana, mayor de edad, portadora de la cedula de identidad y electoral No. <strong>${fullContract.clientCedula}</strong>, domiciliada y residente en la Calle <strong>${fullContract.address || '______________________________________'}</strong>, No. <strong>${fullContract.house_number || '_______'}</strong>, Sector <strong>${fullContract.sector || '________________________'}</strong>, de <strong>${fullContract.ciudad || 'Santo Domingo'}</strong>, quien en lo que sigue del presente contrato se denominara <strong>EL CLIENTE</strong>.</p>

            <p><strong>1.0 - Objeto del Contrato.</strong> Este Contrato contiene los términos y condiciones del Servicio de Belleza, consistente en Lavado y Secado de Pelo que será prestado por LA COMPAÑÍA AL CLIENTE.</p>

            <p><strong>1.1- LA COMPANIA:</strong> ETEREAS S. R. L., la cual forma parte de la cadena: ABATTE PELUQUERIA, proveerá los servicios de lavado y secado de pelo a través de las localidades abierta al público como son:<br/>
            a) Inicialmente en la Sucursal Av. San Vicente de Paul.</p>

            <p><strong>1.2- Requisito para Contratar este Servicio:</strong> Es condición indispensable para poder adquirir y mantener el Servicio de Belleza bajo Suscripción, que El CLIENTE haya adquirido y suscrito contrato de lavado y secado de pelo, con LA COMPAÑIA.</p>

            <p><strong>1.3- EL CLIENTE acepta y elije el plan:</strong> <strong>${fullContract.planTitle}</strong> como su Servicio de Belleza, el plan incluye los beneficios siguientes: <strong>${Array.isArray(fullContract.contract_services) ? fullContract.contract_services.join(', ') : (fullContract.services || 'Servicios según plan')}</strong></p>

            <p><strong>1.4- El presente Contrato</strong> formará parte integral del plan de servicios que previamente haya elegido EL CLIENTE con LA COMPAÑÍA, según se describe a continuación:</p>

            <p><strong>2- Descripción del Servicio.</strong> LA COMPAÑIA conviene en proveer a EL CLIENTE el " Servicio de Belleza", que consiste en brindar el servicio de lavado y secado de pelo para todo el mes, mediante el cual el cliente podrá utilizar el servicio en una de nuestras localidades identificadas, abiertas al público y acorde con plan de su preferencia.</p>

            <p><strong>3- Características del Servicio.</strong> El "Servicio de Belleza" consiste proveer personas capacitadas y productos de clase mundial para el lavado y secado de pelo del CLIENTE, pero, no provee uso de producto de línea especializadas. El uso de marcas especializadas por elección es responsabilidad exclusiva del CLIENTE.</p>

            <p><strong>3.1- Disponibilidad del servicio.</strong> La disponibilidad del servicio de Lavado y Secado de pelo es de hasta un 99.9% al año, conforme a su disponibilidad operativa, pone a disposición de EL CLIENTE cuatro (04) servicios de lavados sencillos y secado cada Treinta (30) días calendario, con excepción de aquellas indisponibilidades producidas por fenómenos atmosféricos, accidentes, cualquier caso fortuito, o fuerza mayor.</p>

            <p><strong>3.2- El servicio.</strong> Es intransferible, ni acumulable, es decir; no se permite uso del servicio por parte de tercero, de igual forma, no se permite combinar múltiples servicios para compensarlo con cantidades de servicio no utilizado correspondiente a la presente suscripción.</p>

            <p><strong>3.3- Los costos derivados</strong> del uso de materiales o servicios no incluido en el plan elegido o contratado quedarán a cargo y a costo de EL CLIENTE.</p>

            <p><strong>3.4- La falta de pago</strong> produce por defecto la suspensión del servicio y su reactivación se producirá solo si EL CLIENTE ha realizado el pago total de todas las cuotas vencidas incluyendo la que corresponde al mes por adelantado. Ante el incumplimiento de pago LA COMPAÑÍA se reserva el derecho de cancelar el presente contrato bajo la más amplia reserva de acciones para garantizar el cumplimiento del presente contrato.</p>

            <p><strong>3.5- El servicio deberá ser utilizado</strong> por EL CLIENTE bajo condiciones normales de uso conforme a la naturaleza del plan contratado; en consecuencia, LA COMPAÑÍA podrá establecer límites razonables en la frecuencia de utilización del servicio, incluyendo un maximum de un (1) servicio por día, así como suspender o restringir su acceso cuando el uso exceda dichas condiciones.</p>

            <p><strong>Obligaciones del CLIENTE: EL CLIENTE deberá:</strong><br/>
            EL CLIENTE estará obligado al pago del servicio elegido en el presente contrato, condición indispensable para tener la disponibilidad del servicio en nuestros centros de atención al cliente.<br/>
            EL CLIENTE tendrá derecho, a hacer sin costo alguno en el plazo de un (1) mes, una cantidad máxima de <strong>${fullContract.max_services || '4 (cuatro)'}</strong> solicitudes de servicios en nuestros centros de atención al cliente según el plan contratado inicialmente. A partir de ahí, EL CLIENTE deberá pagar el valor adicional que LA COMPAÑÍA haya informado al momento de la solicitud efectuada por EL CLIENTE.<br/>
            EL CLIENTE podrá solicitar en cualquier momento el cambio a un plan superior. Dicho cambio será efectivo de inmediato, debiendo EL CLIENTE pagar la diferencia correspondiente al nuevo plan seleccionado al momento de la solicitud</p>

            <p><strong>4- Precio del Servicio:</strong> EL CLIENTE acuerda pagar a LA COMPAÑÍA por el servicio prestado, una renta mensual de <strong>RD$ ${parseFloat(fullContract.contract_price || fullContract.price || fullContract.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong> facturada por adelantado. Asimismo, EL CLIENTE acepta un cargo único de activación por renovación anual de <strong>RD$ 800.00</strong>, el cual será debitado automáticamente al cumplirse cada año de vigencia del contrato.</p>

            <p><strong>4.1- Forma de Pago:</strong> EL CLIENTE es responsable de la inscripción de una tarjeta de crédito al momento de la contratación del servicio para realizar el debito del servicio de forma recurrente y automática.</p>

            <p><strong>4.2- EL CLIENTE autoriza</strong> de manera expresa a LA COMPAÑÍA a realizar el cobro automático y recurrente de los montos correspondientes al plan contratado, incluyendo cargos de activación y renovaciones, mediante la tarjeta registrada al momento de la suscripción. EL CLIENTE será responsable de mantener un método de pago válido y con fondos disponibles; en caso de que un cobro no pueda ser procesado, LA COMPAÑÍA podrá realizar reintentos automáticos y/o suspender el servicio hasta tanto se regularice el pago, sin perjuicio de las acciones necesarias para el cobro de los montos adeudados.</p>

            <p><strong>4.3- Queda expresamente convenido</strong> entre las Partes que los precios y rentas estipulados en el presente Contrato podrán ser ajustados conforme el impacto que presente el índice de precio al consumidor.</p>

            <p><strong>4.4- Cancelación del servicio:</strong> Las partes acuerdan que EL CLIENTE reconoce que el plan contratado incluye tarifas preferenciales y beneficios promocionales otorgados por LA COMPAÑÍA; en caso de cancelación anticipada, LA COMPAÑÍA podrá recalcular los servicios efectivamente utilizados a su precio regular vigente al momento de la prestación, conforme a las tarifas publicadas por LA COMPAÑÍA, debiendo EL CLIENTE pagar la diferencia entre dicho valor y el monto pagado hasta la fecha, sin que esto constituya una penalidad sino la pérdida de los beneficios otorgados bajo el plan.<br/>
            Las partes acuerdan que, para la aplicación de las penalidades precedentemente enunciadas, el punto de partida del plazo de duración del contrato correrá a partir de la fecha de firma del contrato</p>

            <p><strong>4.5- Los pagos realizados</strong> por EL CLIENTE bajo el presente plan son anticipados y corresponden a la activación, reserva y disponibilidad del servicio, por lo que, una vez procesados, no son reembolsables bajo ninguna circunstancia; en consecuencia, la cancelación del servicio por parte de EL CLIENTE no dará lugar a devoluciones totales ni parciales de los montos ya pagados.</p>

            <p><strong>4.6- EL CLIENTE autoriza</strong> la captura de datos biométricos para garantizar su identidad y prevenir fraude electrónico; al mismo tiempo, aprueba y reconoce como bueno y valido la firma digital o electrónica en el uso del presente contrato.</p>

            <p><strong>4.7- EL CLIENTE es responsable</strong> de notificar si es alérgico algún producto de los utilizables para el lavado y secado del pelo; también, es responsable de la degradación que puedan sufrir los tintes o aplicaciones que tenga durante el proceso de lavado o secado, y además, por medio del presente contrato descarga de responsabilidad a LA COMPAÑÍA por cualquiera de los casos anteriormente señalados.</p>

            <p><strong>Obligaciones de LA COMPAÑÍA:</strong><br/>
            a) LA COMPAÑÍA entregará al CLIENTE el nombre del usuario y la contraseña de acceso a la web: www.Planbeautyrd.com para que el CLIENTE pueda realizar consultas sobre el estado del servicio EL CLIENTE de acuerdo al plan contratado de Servicio De Belleza bajo Suscripción señalado en el contrato.<br/>
            b) LA COMPAÑÍA entregará al CLIENTE acceso a visualizar en un portal un resumen de todos los servicios incluido dentro de su plan y la cantidad de servicios consumido dentro de su plan a la fecha.<br/>
            c) Mantener en estricta confidencialidad la información de usuario y contraseña de acceso al portal web, por lo cual es responsabilidad exclusiva del CLIENTE el uso y manejo de tal información. Para tales efectos EL CLIENTE luego de que LA COMPAÑÍA le haya suministrado el nombre de usuario y su respectiva clave de seguridad, deberá realizar el cambio de la clave para su personalización y garantía.</p>

            <p><strong>5- Duración y Terminación.</strong> El presente contrato tendrá una duración inicial de doce (12) meses contados a partir de su firma. Vencido dicho período, el contrato se renovará automáticamente por períodos iguales, salvo que EL CLIENTE notifique por escrito su intención de no renovar con al menos treinta (30) días de antelación a la fecha de vencimiento.</p>

            <p><strong>5.1- LA COMPAÑÍA aplicará</strong> un cargo de activación al momento de cada renovación del contrato, el cual será debitado automáticamente por el medio de pago autorizado por EL CLIENTE, conforme a las condiciones comerciales vigentes.</p>

            <p><strong>5.2- LA COMPAÑÍA se reserva el derecho</strong> de renovar o no el presente contrato con previa notificación de 30 días a EL CLIENTE.</p>

            <p><strong>5.3- Al momento de EL CLIENTE solicitar</strong> la cancelación del servicio LA COMPAÑÍA le estará notificando al cliente por escrito o por cualquier medio escrito o electrónico, en un plazo de Cinco (5) días, el valor que le será debitado de su tarjeta como ultimo pago.</p>

            <p><strong>6- Las partes acuerdan</strong> que para todo lo no previsto en el presente contrato se remiten al derecho del consumidor y posteriormente al Derecho común. Hecho y firmados en dos originales uno para cada una de las partes. En Santo Domingo Este, Municipio de la Provincia de Santo Domingo a los <strong>${new Date(fullContract.signed_at || Date.now()).getDate()}</strong> días del mes de <strong>${new Intl.DateTimeFormat('es-DO', {month: 'long'}).format(new Date(fullContract.signed_at || Date.now()))}</strong> del año <strong>${new Date(fullContract.signed_at || Date.now()).getFullYear()}</strong></p>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 50px; margin-top: 60px;">
            <div style="text-align: center;">
              <p style="font-weight: 800; font-size: 14px; margin-bottom: 40px;">Por LA COMPAÑÍA</p>
              <div style="border-top: 1px solid black; width: 200px; margin: 0 auto 10px;"></div>
              <p style="font-size: 11px;">ETEREAS S.R.L.</p>
            </div>
            <div style="text-align: center;">
              <p style="font-weight: 800; font-size: 14px; margin-bottom: 0px;">Por EL CLIENTE</p>
              <div style="font-family: 'Dancing Script', cursive; font-size: 32px; height: 50px; display: flex; alignItems: center; justifyContent: center;">
                ${(!fullContract.signature_hash || fullContract.signature_hash.includes('signed_') || fullContract.signature_hash.length > 30) ? fullContract.clientName : fullContract.signature_hash}
              </div>
              <div style="border-top: 1px solid black; width: 200px; margin: 0 auto 10px;"></div>
              <p style="font-size: 11px;">${fullContract.clientName}</p>
              <p style="font-size: 11px;">Cédula: ${fullContract.clientCedula}</p>
            </div>
          </div>

          ${(fullContract.document_photo || fullContract.selfie_photo) ? `
            <div class="photo-annex">
              <div class="header" style="border-bottom: 1px solid #e2e8f0; margin-bottom: 20px;">
                <h1>ANEXO DE SEGURIDAD Y BIOMETRÍA</h1>
                <p>EVIDENCIA FOTOGRÁFICA DE IDENTIDAD</p>
              </div>
              <div class="photo-grid">
                ${fullContract.document_photo ? `
                  <div class="photo-item">
                    <span class="photo-label">Cédula / Documento de Identidad</span>
                    <img src="${fullContract.document_photo}" />
                  </div>
                ` : ''}
                ${fullContract.selfie_photo ? `
                  <div class="photo-item">
                    <span class="photo-label">Selfie de Verificación</span>
                    <img src="${fullContract.selfie_photo}" />
                  </div>
                ` : ''}
              </div>
              <div style="margin-top: 30px; font-size: 11px; color: #64748b; text-align: center;">
                Este anexo forma parte integral del contrato firmado digitalmente bajo el ID: ${fullContract.id}
              </div>
            </div>
          ` : ''}

          <div class="footer">
            Este es un documento firmado digitalmente bajo la Ley No. 126-02 sobre Comercio Electrónico, Documentos y Firmas Digitales en la República Dominicana.
            <br/>Hash de Seguridad: ${fullContract.signature_hash?.substring(0, 8)}-${fullContract.id}
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(() => {
        printWindow.print();
    }, 1500);
  };

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', width: '100%', opacity: isCardNetActive ? 0.05 : 1, pointerEvents: isCardNetActive ? 'none' : 'auto', transition: 'opacity 0.2s ease' }}>
      {isModal ? (
        /* MODAL HEADER FOR EMBEDDED CONTRATO IN BILLING */
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: '#fdf2f8', border: '1px solid #fbcfe8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.35rem' }}>
              💎
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                Afiliación y Contrato Digital Plan Beauty
              </h2>
              <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Cliente: <strong style={{ color: 'var(--text-primary)' }}>{client?.nombre || initialClient?.nombre || 'Seleccione cliente'}</strong>
              </p>
            </div>
          </div>
          {onClose && (
            <button 
              type="button"
              onClick={onClose} 
              style={{ background: '#f1f5f9', border: 'none', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748b', transition: 'all 0.15s ease' }}
              title="Cerrar ventana"
            >
              <X size={18} />
            </button>
          )}
        </div>
      ) : (
        /* STANDARD PAGE HEADER & TABS */
        <>
          <div className="page-header" style={{ marginBottom: '2rem' }}>
            <div>
              <h2 className="page-title">{t('contract.title')}</h2>
              <p className="page-subtitle">{t('contract.subtitle')}</p>
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: '99px', color: 'var(--text-primary)' }}>
                <ShieldCheck size={18} />
                <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('contract.badge.secure')}</span>
              </div>
            </div>
          </div>

          <div style={{
            display: 'inline-flex',
            background: 'var(--bg-canvas)',
            padding: '6px',
            borderRadius: '16px',
            marginBottom: '2.5rem',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)'
          }}>
            <button 
              onClick={() => { setActiveTab('new'); setStep(0); }}
              style={{ 
                padding: '10px 24px',
                background: activeTab === 'new' ? 'var(--bg-surface)' : 'transparent',
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: 800,
                color: activeTab === 'new' ? 'var(--text-primary)' : 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: activeTab === 'new' ? '0 4px 12px rgba(0,0,0,0.05)' : 'none',
                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
              }}
            >
              <FilePlus size={16} style={{ color: activeTab === 'new' ? '#10b981' : 'var(--text-secondary)' }} />
              Nuevo Contrato
            </button>
            <button 
              onClick={() => setActiveTab('archive')}
              style={{ 
                padding: '10px 24px',
                background: activeTab === 'archive' ? 'var(--bg-surface)' : 'transparent',
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: 800,
                color: activeTab === 'archive' ? 'var(--text-primary)' : 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: activeTab === 'archive' ? '0 4px 12px rgba(0,0,0,0.05)' : 'none',
                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
              }}
            >
              <Archive size={16} style={{ color: activeTab === 'archive' ? '#3b82f6' : 'var(--text-secondary)' }} />
              Archivo de Contratos
            </button>
          </div>
        </>
      )}

      {activeTab === 'new' ? (
        <>
          {/* Progress Stepper */}
          {step > 0 && (
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '2.5rem' }}>
              {[1, 2, 3, 4].map(i => (
                <div 
                  key={i} 
                  style={{ 
                    flex: 1, height: '8px', borderRadius: '99px', transition: 'all 0.5s ease',
                    background: step >= i ? 'var(--text-primary)' : 'var(--bg-canvas)',
                    border: step >= i ? 'none' : '1px solid var(--border-subtle)'
                  }}
                />
              ))}
            </div>
          )}

          <div className="surface-card" style={{ padding: isModal ? '1.5rem' : '3rem', border: '1px solid var(--border-subtle)', borderRadius: '24px', boxShadow: '0 10px 30px -10px rgba(0,0,0,0.04)' }}>
            {step === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div>
              <h3 style={{ fontSize: '1.35rem', fontWeight: 900, display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--text-primary)', margin: '0 0 0.35rem 0' }}>
                <User size={22} style={{ color: 'var(--text-primary)' }} />
                {client ? 'Cliente Seleccionado para Afiliación' : t('contract.step0.title')}
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0, fontWeight: 550 }}>
                {client 
                  ? 'Verifica los datos del cliente y selecciona el plan para iniciar la validación biométrica y firma.'
                  : 'Escribe el nombre o cédula del cliente para seleccionarlo y asignarle un plan de suscripción.'}
              </p>
            </div>
            
            {!client && (
              <form onSubmit={handleSearch} style={{ display: 'flex', gap: '1rem', position: 'relative' }}>
                <div style={{ flexGrow: 1, position: 'relative' }}>
                  <div className="input-wrapper" style={{ margin: 0 }}>
                    <div className="input-icon" style={{ left: '16px' }}><Search size={18} /></div>
                    <input 
                      type="text" 
                      className="input-field" 
                      placeholder="Buscar por Cédula o Nombre del cliente..." 
                      value={searchCedula}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      onFocus={() => { if (searchCedula.trim().length > 1) setShowSuggestions(true); }}
                      required
                      style={{
                        height: '52px',
                        borderRadius: '14px',
                        border: '1px solid var(--border-subtle)',
                        background: 'var(--bg-canvas)',
                        fontSize: '0.95rem',
                        fontWeight: 600,
                        paddingLeft: '3rem',
                        transition: 'all 0.2s',
                      }}
                    />
                  </div>
                  
                  {/* Autocomplete Suggestion Dropdown */}
                  {showSuggestions && suggestions.length > 0 && (
                    <div style={{
                      position: 'absolute',
                      top: '58px',
                      left: 0,
                      right: 0,
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '14px',
                      boxShadow: '0 10px 30px rgba(0, 0, 0, 0.08)',
                      zIndex: 99,
                      overflow: 'hidden'
                    }}>
                      {suggestions.map((c) => (
                        <div 
                          key={c.id}
                          onClick={() => selectClientSuggestion(c)}
                          style={{
                            padding: '14px 20px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            borderBottom: '1px solid var(--border-subtle)',
                            transition: 'background 0.2s'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-canvas)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ 
                              width: '36px', height: '36px', borderRadius: '50%', background: 'var(--text-primary)', color: 'var(--bg-surface)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.8rem'
                            }}>
                              {c.nombre?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.925rem' }}>{c.nombre}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Cédula: {c.cedula}</div>
                            </div>
                          </div>
                          <span style={{
                            fontSize: '0.7rem',
                            background: c.status === 'Cancelled' ? 'rgba(239, 68, 68, 0.1)' : (c.status === 'Pending_Retry' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)'),
                            color: c.status === 'Cancelled' ? '#ef4444' : (c.status === 'Pending_Retry' ? '#d97706' : '#10b981'),
                            border: `1px solid ${c.status === 'Cancelled' ? '#fca5a5' : (c.status === 'Pending_Retry' ? '#fcd34d' : '#86efac')}`,
                            padding: '3px 10px',
                            borderRadius: '99px',
                            fontWeight: 800,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em'
                          }}>
                            {c.status === 'Cancelled' ? '✕ Cancelado' : (c.status === 'Pending_Retry' ? '⚠️ Cobro Pendiente' : '✓ Activo')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button 
                  type="submit" 
                  className="btn-primary" 
                  style={{ 
                    height: '52px',
                    borderRadius: '14px',
                    padding: '0 2.5rem',
                    fontSize: '0.9rem',
                    fontWeight: 800,
                    boxShadow: '0 4px 12px rgba(9, 9, 11, 0.15)',
                    transition: 'all 0.2s',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}
                >
                  <Search size={16} />
                  {t('contract.step0.btn')}
                </button>
              </form>
            )}

            {client && (
              <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ background: '#ffffff', padding: '1.25rem 1.5rem', borderRadius: '16px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 900, color: '#0f172a' }}>
                      Selecciona el Plan Beauty para {client.nombre || client.name}
                    </h4>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      Este plan será vinculado al contrato digital y la facturación recurrente.
                    </span>
                  </div>
                  <select 
                    value={selectedPlanId} 
                    onChange={(e) => setSelectedPlanId(e.target.value)} 
                    style={{ 
                      minWidth: '240px', 
                      cursor: 'pointer',
                      height: '44px',
                      borderRadius: '10px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.875rem',
                      fontWeight: 700,
                      padding: '0 12px',
                      background: '#ffffff'
                    }}
                  >
                    <option value="" disabled>Seleccionar Plan...</option>
                    {plans
                      .filter(p => !(client?.active_plan_ids || []).includes(p.id.toString()))
                      .map(p => (
                        <option key={p.id} value={p.id}>{p.title}</option>
                      ))
                    }
                  </select>
                </div>

                <ClientRegistration 
                  initialClient={client} 
                  onClientSaved={(savedClient) => { 
                    setClient(savedClient); 
                    setStep(1); 
                  }} 
                  submitButtonText="Guardar Datos y Continuar al Plan Beauty" 
                  isModal={true} 
                />
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Info size={24} />
                Verificación de Identidad
              </h3>
              <span style={{ color: '#ef4444', fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>* Obligatorio</span>
            </div>
            <div className="grid-2">
              <UploadBox 
                label="Cédula o Pasaporte (Frontal)" 
                icon={Camera} 
                state={idFront} 
                setter={setIdFront}
                helperText="Haga clic para subir o capturar"
              />
              <UploadBox 
                label="Foto de Perfil (Selfie)" 
                icon={Smartphone} 
                state={selfie} 
                setter={setSelfie}
                helperText="Validación Biométrica"
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid var(--border-subtle)' }}>
              <button onClick={() => setStep(0)} className="btn-secondary">{t('contract.btn.back')}</button>
              <button onClick={handleBiometricsContinue} className="btn-primary" style={{ padding: '1.25rem 3rem' }}>{t('contract.btn.continue')}</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <h3 style={{ fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <ShieldCheck size={24} />
              {t('contract.step1.title')}
            </h3>
            <div className="hide-scrollbar" style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', padding: '2.5rem', borderRadius: '24px', height: '400px', overflowY: 'auto', fontSize: '0.85rem', lineHeight: 1.8, color: '#334155', textAlign: 'justify', whiteSpace: 'pre-wrap' }}>
              <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                <h4 style={{ margin: 0, color: '#000', fontWeight: 900 }}>CONTRATO DE SUSCRIPCIÓN DE SERVICIOS DE BELLEZA</h4>
              </div>
              
              <p>Entre los subscritos, La empresa: <strong>ETEREAS S. R. L.</strong>, debidamente constituida de conformidad con las leyes de la Republica Dominicana, con Registro Nacional del Contribuyente No. 1-31-91703-8, con su domicilio social en la Av. San Vicente De Paul esquina Calle Puerto Rico, Alma Rosa I, Plaza El Poder, Local 1F, Santo Domingo Este, Municipio De La De Provincia Santo Domingo, quien en lo que sigue del presente contrato se denominara, <strong>LA COMPAÑIA</strong>, y de la otra parte la Sra. <strong>{client?.nombre || '________________'}</strong>, Dominicana, mayor de edad, portadora de la cedula de identidad y electoral No. <strong>{client?.cedula || '_______________'}</strong>, domiciliada y residente en la Calle <strong>{client?.calle || '________________'} No. {client?.numero || '___'}, Sector {client?.sector || '________________'}</strong>, de <strong>{client?.ciudad || '________________'}</strong> quien en lo que sigue del presente contrato se denominara <strong>EL CLIENTE</strong>.</p>

              <p><strong>1.0	-	Objeto del Contrato.</strong> Este Contrato contiene los términos y condiciones del Servicio de Belleza, consistente en Lavado y Secado de Pelo que será prestado por LA COMPAÑÍA AL CLIENTE.</p>

              <p><strong>1.1-	LA COMPANIA:</strong> ETEREAS S. R. L., la cual forma parte de la cadena: ABATTE PELUQUERIA, proveerá los servicios de lavado y secado de pelo a través de las localidades abierta al público como son:<br/>a)	Inicialmente en la Sucursal Av. San Vicente de Paul.</p>

              <p><strong>1.2-	Requisito para Contratar este Servicio:</strong> Es condición indispensable para poder adquirir y mantener el Servicio de Belleza bajo Suscripción, que El CLIENTE haya adquirido y suscrito contrato de lavado y secado de pelo, con LA COMPAÑÍA.</p>

              <p><strong>1.3-	EL CLIENTE acepta y elije el plan: {plans.find(p=>p.id === selectedPlanId)?.title || 'PLAN BEAUTY'}</strong> como su Servicio de Belleza.</p>

              <p><strong>1.4-	El presente Contrato formará parte integral del plan de servicios que previamente haya elegido EL CLIENTE con LA COMPAÑÍA, según se describe a continuación:</strong></p>

              <p><strong>2-	Descripción del Servicio.</strong> LA COMPAÑÍA conviene en proveer a EL CLIENTE el " Servicio de Belleza", que consiste en brindar el servicio de lavado y secado de pelo para todo el mes, mediante el cual el cliente podrá utilizar el servicio en una de nuestras localidades identificadas, abiertas al público y acorde con plan de su preferencia.</p>

              <p><strong>3-	Características del Servicio.</strong> El "Servicio de Belleza" consiste proveer personas capacitadas y productos de clase mundial para el lavado y secado de pelo del CLIENTE, pero, no provee uso de producto de línea especializadas. El uso de marcas especializadas por elección es responsabilidad exclusiva del CLIENTE.</p>

              <p><strong>3.1-	Disponibilidad del servicio.</strong> La disponibilidad del servicio de Lavado y Secado de pelo es de hasta un 99.9% al año, conforme a su disponibilidad operativa, pone a disposición de EL CLIENTE cuatro (04) servicios de lavados sencillos y secado cada Treinta (30) días calendario, con excepción de aquellas indisponibilidades producidas por fenómenos atmosféricos, accidentes, cualquier caso fortuito, o fuerza mayor.</p>

              <p><strong>3.2- El servicio.</strong> Es intransferible, ni acumulable, es decir; no se permite uso del servicio por parte de tercero, de igual forma, no se permite combinar múltiples servicios para compensarlo con cantidades de servicio no utilizado correspondiente a la presente suscripción.</p>

              <p><strong>3.3-	Los costos derivados del uso de materiales o servicios no incluido en el plan elegido o contratado quedarán a cargo y a costo de EL CLIENTE.</strong></p>

              <p><strong>3.4-	La falta de pago produce por defecto la suspensión del servicio y su reactivación se producirá solo si EL CLIENTE ha realizado el pago total de todas las cuotas vencidas incluyendo la que corresponde al mes por adelantado. Ante el incumplimiento de pago LA COMPAÑÍA se reserva el derecho de cancelar el presente contrato bajo la más amplia reserva de acciones para garantizar el cumplimiento del presente contrato.</strong></p>

              <p><strong>3.5-	El servicio deberá ser utilizado por EL CLIENTE bajo condiciones normales de uso conforme a la naturaleza del plan contratado; en consecuencia, LA COMPAÑÍA podrá establecer límites razonables en la frecuencia de utilización del servicio, incluyendo un máximo de un (1) servicio por día, así como suspender o restringir su acceso cuando el uso exceda dichas condiciones.</strong></p>

              <p><strong>Obligaciones del CLIENTE: EL CLIENTE deberá:</strong><br/>
              EL CLIENTE estará obligado al pago del servicio elegido en el presente contrato, condición indispensable para tener la disponibilidad del servicio en nuestros centros de atención al cliente.<br/>
              EL CLIENTE tendrá derecho, a hacer sin costo alguno en el plazo de un (1) mes, una cantidad máxima de 4 solicitudes de servicios en nuestros centros de atención al cliente según el plan contratado inicialmente. A partir de ahí, EL CLIENTE deberá pagar el valor adicional que LA COMPAÑÍA haya informado al momento de la solicitud efectuada por EL CLIENTE.<br/>
              EL CLIENTE podrá solicitar en cualquier momento el cambio a un plan superior. Dicho cambio será efectivo de inmediato, debiendo EL CLIENTE pagar la diferencia correspondiente al nuevo plan seleccionado al momento de la solicitud</p>

              <p><strong>4-	Precio del Servicio:</strong> EL CLIENTE acuerda pagar a LA COMPAÑÍA por el servicio prestado, una renta mensual de <strong>{plans.find(p=>p.id === selectedPlanId)?.price || '1,950'} PESOS DOMINICANOS CON 00/100 (RD$ {plans.find(p=>p.id === selectedPlanId)?.price || '1,950'}.00)</strong>. Todos los cargos de renta por los servicios contratados mediante el presente contrato serán facturados mensualmente por adelantado. Asimismo, EL CLIENTE acepta y autoriza un cargo de activación por renovación de contrato de <strong>RD$ 800.00 anual</strong>, el cual se cobrará automáticamente en cada aniversario de la firma.</p>

              <p><strong>4.1-	Forma de Pago:</strong> EL CLIENTE es responsable de la inscripción de una tarjeta de crédito al momento de la contratación del servicio para realizar el debito del servicio de forma recurrente y automática.</p>

              <p><strong>4.2-	EL CLIENTE autoriza de manera expresa a LA COMPAÑÍA a realizar el cobro automático y recurrente de los montos correspondientes al plan contratado, incluyendo cargos de activación y renovaciones, mediante la tarjeta registrada al momento de la suscripción. EL CLIENTE será responsable de mantener un método de pago válido y con fondos disponibles; en caso de que un cobro no pueda ser procesado, LA COMPAÑÍA podrá realizar reintentos automáticos y/o suspender el servicio hasta tanto se regularice el pago, sin perjuicio de las acciones necesarias para el cobro de los montos adeudados.</strong></p>

              <p><strong>4.3-	Queda expresamente convenido entre las Partes que los precios y rentas estipulados en el presente Contrato podrán ser ajustados conforme el impacto que presente el índice de precio al consumidor.</strong></p>

              <p><strong>4.4-	Cancelación del servicio:</strong> Las partes acuerdan que EL CLIENTE reconoce que el plan contratado incluye tarifas preferenciales y beneficios promocionales otorgados por LA COMPAÑÍA; en caso de cancelación anticipada, LA COMPAÑÍA podrá recalcular los servicios efectivamente utilizados a su precio regular vigente al momento de la prestación, conforme a las tarifas publicadas por LA COMPAÑÍA, debiendo EL CLIENTE pagar la diferencia entre dicho valor y el monto pagado hasta la fecha, sin que esto constituya una penalidad sino la pérdida de los beneficios otorgados bajo el plan.<br/>
              Las partes acuerdan que, para la aplicación de las penalidades precedentemente enunciadas, el punto de partida del plazo de duración del contrato correrá a partir de la fecha de firma del contrato</p>

              <p><strong>4.5-	Los pagos realizados por EL CLIENTE bajo el presente plan son anticipados y corresponden a la activación, reserva y disponibilidad del servicio, por lo que, una vez procesados, no son reembolsables bajo ninguna circunstancia; en consecuencia, la cancelación del servicio por parte de EL CLIENTE no dará lugar a devoluciones totales ni parciales de los montos ya pagados.</strong></p>

              <p><strong>4.6-	EL CLIENTE autoriza la captura de datos biométricos para garantizar su identidad y prevenir fraude electrónico; al mismo tiempo, aprueba y reconoce como bueno y valido la firma digital o electrónica en el uso del presente contrato.</strong></p>

              <p><strong>4.7-	EL CLIENTE es responsable de la degradación que puedan sufrir los tintes o aplicaciones que tenga durante el proceso de lavado o secado, y además, por medio del presente contrato descarga de responsabilidad a LA COMPAÑÍA por cualquiera de los casos anteriormente señalados.</strong></p>

              <p><strong>Obligaciones de LA COMPAÑÍA:</strong><br/>
              a) LA COMPAÑÍA entregará al CLIENTE el nombre del usuario y la contraseña de acceso a la web: www.Planbeautyrd.com para que el CLIENTE pueda realizar consultas sobre el estado del servicio EL CLIENTE de acuerdo al plan contratado de Servicio De Belleza bajo Suscripción señalado en el contrato.<br/>
              b) LA COMPAÑÍA entregará al CLIENTE acceso a visualizar en un portal un resumen de todos los servicios incluido dentro de su plan y la cantidad de servicios consumido dentro de su plan a la fecha.<br/>
              c) Mantener en estricta confidencialidad la información de usuario y contraseña de acceso al portal web, por lo cual es responsabilidad exclusiva del CLIENTE el uso y manejo de tal información. Para tales efectos EL CLIENTE luego de que LA COMPAÑÍA le haya suministrado el nombre de usuario y su respectiva clave de seguridad, deberá realizar el cambio de la clave para su personalización y garantía.</p>

              <p><strong>5-	 Duración y Terminación.</strong> El presente contrato tendrá una duración inicial de doce (12) meses contados a partir de su firma. Vencido dicho período, el contrato se renovará automáticamente por períodos iguales, salvo que EL CLIENTE notifique por escrito su intención de no renovar con al menos treinta (30) días de antelación a la fecha de vencimiento. En caso de no recibir dicha notificación, se entenderá que EL CLIENTE acepta la renovación, autorizando la continuidad del servicio y el cobro automático correspondiente bajo las condiciones vigentes al momento de la renovación.</p>

              <p><strong>5.1-	LA COMPAÑÍA aplicará un cargo de activación de RD$ 800.00 al momento de cada renovación anual del contrato, el cual será debitado automáticamente por el medio de pago autorizado por EL CLIENTE, conforme a las condiciones comerciales vigentes.</strong></p>

              <p><strong>5.2-	LA COMPAÑÍA se reserva el derecho de renovar o no el presente contrato con previa notificación de 30 días a EL CLIENTE.</strong></p>

              <p><strong>6-	 Las partes acuerdan que para todo lo no previsto en el presente contrato se remiten al derecho del consumidor y posteriormente al Derecho común. Hecho y firmados en dos originales uno para cada una de las partes. En Santo Domingo Este, Municipio de la Provincia de Santo Domingo a los {new Date().getDate()} días del mes de {new Date().toLocaleString('es-ES', {month:'long'})} del año {new Date().getFullYear()}</strong></p>
            </div>
            
            <div style={{ background: 'var(--bg-canvas)', borderRadius: 'var(--radius-lg)', padding: '2rem', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer' }}>
                <input type="checkbox" required style={{ width: '1.25rem', height: '1.25rem', accentColor: 'var(--text-primary)' }} />
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>El cliente acepta los términos y condiciones de la suscripción.</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer' }}>
                <input type="checkbox" required style={{ width: '1.25rem', height: '1.25rem', accentColor: 'var(--text-primary)' }} />
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>El cliente autoriza el cargo automático a su tarjeta vinculada.</span>
              </label>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem', paddingTop: '2rem', borderTop: '1px solid var(--border-subtle)' }}>
              <button onClick={() => setStep(1)} className="btn-secondary">{t('contract.btn.back')}</button>
              <button onClick={() => setStep(3)} className="btn-primary" style={{ padding: '1.25rem 3rem' }}>{t('contract.btn.accept')}</button>
            </div>
          </div>
        )}

        {/* EL PASO 3 NO SE DESMONTA, SOLO SE OCULTA PARA EVITAR CRASH DE REACT AL BORRAR DOM MUTADO POR CARDNET */}
        <div style={{ display: step === 3 ? 'flex' : 'none', flexDirection: 'column', gap: '2rem' }}>
            <h3 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Método de Pago (Configuración Recurrente)</h3>
            <p style={{ color: 'var(--text-secondary)' }}>
              Por favor vincula la tarjeta para los cargos mensuales del plan <strong>{plans.find(p => String(p.id) === String(selectedPlanId))?.title || 'Plan Beauty'}</strong>.
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center', background: 'var(--bg-canvas)', borderRadius: 'var(--radius-lg)', padding: '3rem', border: '1px solid var(--border-subtle)' }}>
               {/* AISLAMIENTO CRÍTICO: Evita que React explote cuando CardNet modifique el DOM */}
               <div dangerouslySetInnerHTML={{
                  __html: `
                    <form id="checkout_form_fake">
                      <input type="hidden" id="PWToken" name="PWToken" />
                      <input type="hidden" id="SessionId" name="SessionId" />
                      <input type="hidden" id="UniqueID" name="UniqueID" />
                    </form>
                  `
                }} /> 
                <button 
                    type="button"
                    id="btnCardNetCheckout"
                    className="btn-primary" 
                    style={{ padding: '1rem 3rem', fontSize: '1.125rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.75rem' }}
                    onClick={(e) => {
                       e.preventDefault();
                       setCardnetLog('');
                       openCardNetIframe();
                    }}
                 >
                   <ShieldCheck size={20} />
                   Configurar Tarjeta CardNet
                 </button>
               <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '1rem' }}>Conexión cifrada directa con CardNet Dominicana.</p>
            </div>

            {cardnetLog && (
              <div style={{ padding: '2rem', background: '#fee2e2', border: '1px solid #f87171', borderRadius: '16px', color: '#991b1b', fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div>
                  <p style={{ fontWeight: 800, marginBottom: '0.5rem', fontSize: '1rem' }}>Respuesta del Adquirente (Lab Mode):</p>
                  <p>Si el error es <strong>TR005</strong> o similar, pero ves un Token en el JSON, puedes continuar.</p>
                </div>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#fef2f2', padding: '1rem', borderRadius: '8px', border: '1px solid #fecaca', maxHeight: '200px', overflowY: 'auto' }}>
                  {cardnetLog}
                </pre>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button 
                    onClick={() => { setStep(4); setCardnetLog(''); }} 
                    className="btn-primary" 
                    style={{ background: '#991b1b', border: 'none', padding: '0.75rem 1.5rem' }}
                  >
                    Continuar a Firma (Bypass Manual)
                  </button>
                  <button 
                    onClick={() => setCardnetLog('')} 
                    className="btn-secondary" 
                    style={{ padding: '0.75rem 1.5rem' }}
                  >
                    Cerrar Detalle
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem', paddingTop: '2rem', borderTop: '1px solid var(--border-subtle)' }}>
              <button onClick={() => setStep(2)} className="btn-secondary">{t('contract.btn.back')}</button>
            </div>
        </div>

        {step === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
            <div style={{ textAlign: 'center' }}>
              <h3 style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: '0.5rem' }}>Firma y Activación Final</h3>
              <p style={{ color: 'var(--text-secondary)' }}>
                Al firmar, confirmas la suscripción al plan <strong>{plans.find(p => String(p.id) === String(selectedPlanId))?.title || 'Plan Beauty'}</strong> y autorizas los cargos recurrentes.
              </p>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '0.875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Firma Digital del Cliente</label>
                <button onClick={() => setSignature('')} style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Limpiar</button>
              </div>
              <div style={{ background: 'var(--bg-canvas)', borderRadius: 'var(--radius-lg)', height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--text-primary)', cursor: 'crosshair', position: 'relative', overflow: 'hidden', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05)' }}>
                <div style={{ position: 'absolute', top: '10px', right: '10px', fontSize: '0.65rem', fontWeight: 800, opacity: 0.3, textTransform: 'uppercase' }}>Documento Autenticado</div>
                {signature ? (
                   <span style={{ fontFamily: "'Dancing Script', cursive", fontSize: '3rem', color: 'var(--text-primary)' }}>{signature}</span>
                ) : (
                   <p style={{ color: 'var(--text-secondary)', fontWeight: 600, fontStyle: 'italic', opacity: 0.5 }}>Escriba su nombre completo para firmar legalmente</p>
                )}
              </div>
              <input 
                placeholder="Escriba su nombre aquí..." 
                style={{ textAlign: 'center', fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: '1.25rem', padding: '1rem', border: 'none', borderBottom: '1px solid var(--border-subtle)', background: 'transparent', outline: 'none', fontWeight: 600 }}
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
              />
            </div>

            <div style={{ background: 'var(--bg-canvas)', padding: '1.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', marginBottom: '1rem' }}>
              <p style={{ fontWeight: 800, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '1.25rem', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>Resumen de Cobro Inicial</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Mensualidad ({plans.find(p => String(p.id) === String(selectedPlanId))?.title}):</span>
                  <span style={{ fontWeight: 700 }}>RD$ {parseFloat(plans.find(p => String(p.id) === String(selectedPlanId))?.price || 0).toLocaleString()}</span>
                </div>
                {parseFloat(plans.find(p => String(p.id) === String(selectedPlanId))?.activation_fee || 0) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Cargo de Inscripción (Único):</span>
                    <span style={{ fontWeight: 700 }}>RD$ {parseFloat(plans.find(p => String(p.id) === String(selectedPlanId))?.activation_fee || 0).toLocaleString()}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>
                  <span style={{ fontWeight: 800 }}>Total a Pagar Hoy:</span>
                  <span style={{ fontWeight: 900, color: '#059669' }}>
                    RD$ {(parseFloat(plans.find(p => String(p.id) === String(selectedPlanId))?.price || 0) + parseFloat(plans.find(p => String(p.id) === String(selectedPlanId))?.activation_fee || 0)).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ background: 'var(--bg-canvas)', padding: '1.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <p style={{ fontWeight: 800, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '1rem', color: 'var(--text-secondary)' }}>Evidencia Digital & Token de Pago</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.75rem' }}>
                <div><span style={{ color: 'var(--text-secondary)' }}>IP:</span> <strong>{metadata.ip}</strong></div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Token CardNet:</span> <strong style={{ color: '#059669' }}>{savedToken ? 'Vinculado ✓' : 'No detectado'}</strong></div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Dispositivo:</span> <strong title={metadata.device}>{parseUA(metadata.device)}</strong></div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Cliente:</span> <strong>{client?.nombre}</strong></div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Fecha:</span> <strong>{new Date().toLocaleDateString()}</strong></div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem', paddingTop: '2rem', borderTop: '1px solid var(--border-subtle)' }}>
              <button onClick={() => setStep(3)} className="btn-secondary">{t('contract.btn.back')}</button>
              <button 
                onClick={() => {
                  if (!signature) return showNotification("Por favor escriba su nombre para firmar el contrato.", "error");
                  completeContractWithToken(savedToken);
                }} 
                className="btn-primary" 
                style={{ padding: '1.25rem 3rem' }}
                disabled={false}
              >
                FINALIZAR Y ACTIVAR PLAN
              </button>
            </div>
          </div>
        )}
        </div>
      </>
    ) : (
      <div className="surface-card" style={{ padding: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Búsqueda de Contratos Firmados</h3>
          <div className="search-input-wrapper" style={{ width: '400px' }}>
            <Search className="icon" size={18} />
            <input 
              placeholder="Buscar por cliente, cédula o plan..." 
              value={archiveSearch}
              onChange={(e) => setArchiveSearch(e.target.value)}
              style={{ padding: '0.75rem 1rem 0.75rem 2.5rem', width: '100%' }}
            />
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <th style={{ padding: '1rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)' }}>CLIENTE</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)' }}>PLAN</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)' }}>FECHA</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)' }}>ESTADO</th>
                <th style={{ padding: '1rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)', textAlign: 'right' }}>ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              {filteredContracts.length > 0 ? filteredContracts.map(contract => (
                <tr key={contract.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '1.25rem 1rem' }}>
                    <p style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.1rem' }}>{contract.clientName}</p>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>ID: {contract.clientCedula}</p>
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <span style={{ fontSize: '0.8rem', background: 'var(--bg-canvas)', padding: '0.25rem 0.75rem', borderRadius: '4px', fontWeight: 700, border: '1px solid var(--border-subtle)' }}>
                      {contract.planTitle}
                    </span>
                  </td>
                  <td style={{ padding: '1rem', fontSize: '0.85rem' }}>
                    {new Date(contract.signed_at).toLocaleDateString()}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <span style={{ 
                      fontSize: '0.65rem', 
                      fontWeight: 800, 
                      padding: '0.35rem 0.65rem', 
                      borderRadius: '6px',
                      background: contract.status === 'Active' || contract.status === 'Activo' ? '#dcfce7' : (contract.status === 'Pending_Retry' ? '#fffbeb' : (contract.status === 'Cancelled' ? '#fee2e2' : '#f1f5f9')),
                      color: contract.status === 'Active' || contract.status === 'Activo' ? '#166534' : (contract.status === 'Pending_Retry' ? '#b45309' : (contract.status === 'Cancelled' ? '#991b1b' : '#475569')),
                      border: `1px solid ${contract.status === 'Active' || contract.status === 'Activo' ? '#bbf7d0' : (contract.status === 'Pending_Retry' ? '#fde68a' : (contract.status === 'Cancelled' ? '#fecaca' : '#cbd5e1'))}`,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem'
                    }}>
                      {contract.status === 'Active' || contract.status === 'Activo' ? '✓ ACTIVO' : (contract.status === 'Pending_Retry' ? `⚠️ REINTENTO (${contract.retry_count || 1}/90)` : (contract.status === 'Cancelled' ? '✕ CANCELADO' : contract.status?.toUpperCase()))}
                    </span>
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button 
                        onClick={() => handlePrint(contract)}
                        className="btn-secondary" 
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.7rem' }}
                        title="Descargar Contrato"
                      >
                        <Download size={14} />
                      </button>
                      {(contract.status === 'Active' || contract.status === 'Activo' || contract.status === 'Pending_Retry') && (
                        <>
                          <button 
                            onClick={() => handleRequestCode(contract, 'manual_billing')}
                            style={{ padding: '0.4rem 0.8rem', fontSize: '0.7rem', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}
                          >
                            Facturar
                          </button>
                          <button 
                            onClick={() => handleRequestCode(contract, 'cancellation')}
                            style={{ padding: '0.4rem 0.8rem', fontSize: '0.7rem', background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}
                          >
                            Cancelar
                          </button>
                        </>
                      )}
                      <button 
                        onClick={async (e) => {
                          const targetBtn = e.currentTarget;
                          const originalLabel = targetBtn.innerText;
                          targetBtn.innerText = "Cargando...";
                          targetBtn.disabled = true;
                          try {
                            const fullContract = await dataService.getContractById(contract.id);
                            if (fullContract) {
                              setSelectedContract(fullContract);
                            } else {
                              setSelectedContract(contract);
                            }
                          } catch (err) {
                            console.error("Error loading contract photos:", err);
                            setSelectedContract(contract);
                          } finally {
                            if (targetBtn) {
                              targetBtn.innerText = originalLabel;
                              targetBtn.disabled = false;
                            }
                          }
                        }}
                        className="btn-primary" 
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.7rem' }}
                      >
                        Ver Detalle
                      </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan="4" style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    No se encontraron contratos registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )}

    {/* Contract Viewer Modal */}
    {selectedContract && (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
        <div className="surface-card" style={{ width: '100%', maxWidth: '850px', padding: '3rem', position: 'relative', maxHeight: '90vh', overflowY: 'auto' }}>
           <button 
            onClick={() => setSelectedContract(null)}
            style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '1.5rem' }}
          >
            ×
          </button>
          
          <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
            <ShieldCheck size={40} style={{ color: '#059669', marginBottom: '1rem' }} />
            <h3 style={{ fontSize: '1.75rem', fontWeight: 800 }}>Contrato Digital Firmado</h3>
            <p style={{ color: 'var(--text-secondary)' }}>Evidencia legal de membresía y términos aceptados.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '2rem', marginBottom: '2rem' }}>
            <div style={{ background: 'var(--bg-canvas)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
              <p style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '1rem' }}>Información del Contrato</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>CLIENTE</p>
                  <p style={{ fontWeight: 700 }}>{selectedContract.clientName || 'Cliente No Identificado'}</p>
                </div>
                <div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>PLAN CONTRATADO</p>
                  <p style={{ fontWeight: 700 }}>{selectedContract.planTitle || 'Plan Personalizado'}</p>
                </div>
                <div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>FECHA DE FIRMA</p>
                  <p style={{ fontWeight: 700 }}>{new Date(selectedContract.signed_at || selectedContract.created_at).toLocaleString()}</p>
                </div>
              </div>
            </div>
            
            <div style={{ background: 'var(--bg-canvas)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
              <p style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '1rem' }}>Evidencia Digital</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem' }}>
                <p><strong>IP:</strong> {selectedContract.ip_address || 'No capturada'}</p>
                <p style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={selectedContract.device_agent}>
                  <strong>DISP:</strong> {parseUA(selectedContract.device_agent)}
                </p>
                {selectedContract.geolocation && <p><strong>GPS:</strong> {selectedContract.geolocation}</p>}
                <p><strong>ID REGISTRO:</strong> {selectedContract.id}</p>
              </div>
            </div>
          </div>

          {(selectedContract.document_photo || selectedContract.selfie_photo) && (
            <div style={{ marginBottom: '2rem' }}>
              <p style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '1rem' }}>Documentación Fotográfica (Identidad)</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                {selectedContract.document_photo && (
                  <div style={{ borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border-subtle)', background: 'white' }}>
                    <p style={{ fontSize: '0.65rem', padding: '0.5rem', textAlign: 'center', background: 'var(--bg-canvas)', borderBottom: '1px solid var(--border-subtle)', fontWeight: 700 }}>CÉDULA / ID</p>
                    <img src={selectedContract.document_photo} alt="Cédula" style={{ width: '100%', height: '200px', objectFit: 'contain', cursor: 'zoom-in' }} onClick={(e) => window.open(selectedContract.document_photo, '_blank')} />
                  </div>
                )}
                {selectedContract.selfie_photo && (
                  <div style={{ borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border-subtle)', background: 'white' }}>
                    <p style={{ fontSize: '0.65rem', padding: '0.5rem', textAlign: 'center', background: 'var(--bg-canvas)', borderBottom: '1px solid var(--border-subtle)', fontWeight: 700 }}>SELFIE DE VERIFICACIÓN</p>
                    <img src={selectedContract.selfie_photo} alt="Selfie" style={{ width: '100%', height: '200px', objectFit: 'contain', cursor: 'zoom-in' }} onClick={(e) => window.open(selectedContract.selfie_photo, '_blank')} />
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{ background: 'var(--bg-canvas)', padding: '2rem', borderRadius: '16px', border: '1px solid var(--border-subtle)', marginBottom: '2rem' }}>
             <p style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '1.5rem', textAlign: 'center' }}>Cuerpo Legal y Firma de Aceptación</p>
             <div style={{ maxHeight: '300px', overflowY: 'auto', fontSize: '0.85rem', color: '#475569', padding: '1.5rem', background: 'white', borderRadius: '8px', border: '1px solid var(--border-subtle)', marginBottom: '2rem', textAlign: 'justify', lineHeight: '1.6' }}>
                <p style={{ fontWeight: 700, marginBottom: '1rem', borderBottom: '1px solid #eee', paddingBottom: '0.5rem' }}>CONTRATO DE SUSCRIPCIÓN DE SERVICIOS DE BELLEZA</p>
                <p><strong>1.0 OBJETO:</strong> Servicio de Belleza (Lavado y Secado) prestado por ETEREAS S.R.L. a favor de {selectedContract.clientName || 'EL CLIENTE'}.</p>
                <p><strong>2.0 SERVICIO:</strong> Lavado y secado para todo el mes en localidades identificadas (Sucursal San Vicente de Paul).</p>
                <p><strong>3.1 DISPONIBILIDAD:</strong> 99.9% al año, 4 servicios de lavados sencillos cada 30 días calendario.</p>
                <p><strong>4.2 COBRO AUTOMÁTICO:</strong> Autorización expresa de cobro recurrente mensual mediante tarjeta de crédito registrada.</p>
                <p><strong>4.5 NO REEMBOLSABLE:</strong> Los pagos son anticipados por reserva de disponibilidad y no admiten devoluciones.</p>
                <p><strong>5.0 DURACIÓN:</strong> 12 meses renovables automáticamente.</p>
                <p><strong>6.0 LEY:</strong> El cliente reconoce y acepta la firma digital bajo la Ley No. 126-02 de la Rep. Dom.</p>
             </div>
             <div style={{ textAlign: 'center' }}>
               <span style={{ fontFamily: "'Dancing Script', cursive", fontSize: '3.5rem', color: 'var(--text-primary)' }}>
                  {(selectedContract.signature_hash && selectedContract.signature_hash.length < 50 && !selectedContract.signature_hash.includes('data:image')) 
                    ? selectedContract.signature_hash 
                    : (selectedContract.clientName || 'Firma Digital')}
                </span>
               <div style={{ width: '250px', borderTop: '2px solid var(--text-primary)', margin: '0.5rem auto' }}></div>
               <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Firma Digital del Cliente</div>
             </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <button onClick={() => handlePrint(selectedContract)} className="btn-primary" style={{ flex: 1, padding: '1rem' }}>Descargar PDF</button>
            <button onClick={() => setSelectedContract(null)} className="btn-secondary" style={{ flex: 1, padding: '1rem' }}>Cerrar</button>
          </div>
        </div>
      </div>
    )}

    {/* Verification Modal for Cancellation/Billing */}
    {actionModal.open && (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1rem' }}>
        <div className="surface-card" style={{ width: '100%', maxWidth: '400px', padding: '2.5rem', textAlign: 'center' }}>
          <div style={{ width: '64px', height: '64px', background: actionModal.type === 'cancellation' ? '#fee2e2' : '#eff6ff', color: actionModal.type === 'cancellation' ? '#ef4444' : '#2563eb', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
            {actionModal.type === 'cancellation' ? <X size={32} /> : <FileText size={32} />}
          </div>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '0.5rem' }}>
            {actionModal.type === 'cancellation' ? 'Confirmar Cancelación' : 'Autorizar Facturación'}
          </h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '2rem' }}>
            Ingrese el código de 6 dígitos enviado al correo de <strong>{actionModal.contract.clientName}</strong>.
          </p>
          
          <input 
            type="text" 
            maxLength="6"
            placeholder="000000"
            style={{ width: '100%', textAlign: 'center', fontSize: '2rem', fontWeight: 900, letterSpacing: '8px', padding: '1rem', borderRadius: '12px', border: '2px solid var(--border-subtle)', marginBottom: '2rem', outline: 'none' }}
            value={actionModal.code}
            onChange={(e) => setActionModal({ ...actionModal, code: e.target.value.replace(/\D/g, '') })}
            disabled={actionModal.loading}
          />

          <div style={{ display: 'flex', gap: '1rem' }}>
            <button 
              onClick={() => setActionModal({ open: false, contract: null, type: null, code: '', loading: false })}
              className="btn-secondary" 
              style={{ flex: 1, padding: '1rem' }}
              disabled={actionModal.loading}
            >
              Cancelar
            </button>
            <button 
              onClick={handleConfirmAction}
              className="btn-primary" 
              style={{ flex: 1, padding: '1rem', background: actionModal.type === 'cancellation' ? '#ef4444' : '#09090b', border: 'none' }}
              disabled={actionModal.loading}
            >
              {actionModal.loading ? 'Procesando...' : 'Confirmar'}
            </button>
          </div>
        </div>
      </div>
    )}
    </div>
  );
};

export default DigitalContract;
