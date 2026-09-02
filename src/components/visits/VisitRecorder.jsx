import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { 
  Search, Calendar, Scissors, Clock as ClockIcon, Mail, Save, UserCheck, Star, 
  Lock as LockIcon, ArrowLeft, PlusCircle, Printer, CheckCircle2, ShieldAlert, 
  Banknote, CreditCard, Landmark, Gift, Layers, Percent, AlertTriangle, ChevronDown, ChevronUp, ChevronRight, ChevronLeft, RefreshCw, X, XCircle,
  UserPlus, Phone, Cake, TrendingUp, Sparkles, History, Pencil, Edit3, Plus, User, Receipt, Zap, Eye, ArrowRight, Trash2, Wallet, FileText
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useTranslation } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import DigitalContract from '../contracts/DigitalContract';

const DEFAULT_TOP_SERVICES = [
  { id: '1', nombre: 'Lavado y Secado', precio: 800 },
  { id: '2', nombre: 'Corte de Puntas', precio: 500 },
  { id: '3', nombre: 'Tinte Completo', precio: 1800 },
  { id: '4', nombre: 'Tratamiento Penetratti', precio: 750 },
  { id: '5', nombre: 'Manicura Simple', precio: 500 },
  { id: '6', nombre: 'Pedicura Simple', precio: 600 },
  { id: '7', nombre: 'Maquillaje Social', precio: 2500 }
];

const VisitRecorder = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const [salonId, setSalonId] = useState(currentUser?.salon_id || 1);
  const [salonsList, setSalonsList] = useState([]);

  // Load Salons list on mount
  useEffect(() => {
    dataService.getSalons().then(list => {
      if (Array.isArray(list) && list.length > 0) {
        setSalonsList(list);
      }
    }).catch(err => console.error('Error cargando sucursales:', err));
  }, []);

  // Pending Tickets & Workflow State
  const [pendingTickets, setPendingTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [isTicketExpanded, setIsTicketExpanded] = useState(false);
  const [showPendingTicketsModal, setShowPendingTicketsModal] = useState(false);
  const [ticketSearchTerm, setTicketSearchTerm] = useState('');

  // Form & Line Items
  const [clientFound, setClientFound] = useState(null);
  const [lineItems, setLineItems] = useState([]);
  const [availableServices, setAvailableServices] = useState(DEFAULT_TOP_SERVICES);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [activePlans, setActivePlans] = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState('none');
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);

  // Digital Contract Onboarding Modal State
  const [showContractModal, setShowContractModal] = useState(false);
  const [showDetailedBreakdown, setShowDetailedBreakdown] = useState(false);

  // Favorites Horizontal Carousel Ref & Handlers
  const favoritesScrollRef = useRef(null);
  const scrollFavorites = (direction) => {
    if (favoritesScrollRef.current) {
      const scrollAmount = direction === 'left' ? -240 : 240;
      favoritesScrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };
  const handleFavoritesWheel = (e) => {
    if (favoritesScrollRef.current && e.deltaY !== 0) {
      favoritesScrollRef.current.scrollLeft += e.deltaY;
    }
  };

  // Modals & Client Search for Ticket Generation
  const [showNewTicketModal, setShowNewTicketModal] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [printableTicketData, setPrintableTicketData] = useState(null);
  const [allClients, setAllClients] = useState([]);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [modalClientSearchTerm, setModalClientSearchTerm] = useState('');
  const [selectedClientForTicket, setSelectedClientForTicket] = useState(null);
  const [newTicketClientName, setNewTicketClientName] = useState('');
  const [newTicketCedula, setNewTicketCedula] = useState('');
  const [ticketType, setTicketType] = useState('general'); // 'general' | 'plan_beauty' | 'empleado'
  const [selectedEmployeeForTicket, setSelectedEmployeeForTicket] = useState(null);

  // Pricing & Admin Auth
  const [showAdminPinModal, setShowAdminPinModal] = useState(false);
  const [adminPin, setAdminPin] = useState('');
  const [pendingDiscountItem, setPendingDiscountItem] = useState(null);
  const [isAdminAuthorized, setIsAdminAuthorized] = useState(false);

  // OTP Verification for Plan Beauty Consumption
  const [showOtpVerificationModal, setShowOtpVerificationModal] = useState(false);
  const [otpCodeInput, setOtpCodeInput] = useState('');
  const [pendingPlanService, setPendingPlanService] = useState(null);
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [adminCodeBypass, setAdminCodeBypass] = useState(false);
  const [adminBypassPin, setAdminBypassPin] = useState('');
  const [otpSentEmail, setOtpSentEmail] = useState('');

  // Invoice Voiding / Anulación (Section 16 Audit)
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [targetVisitToVoid, setTargetVisitToVoid] = useState(null);
  const [voidReasonCategory, setVoidReasonCategory] = useState('Error de cobro / método de pago');
  const [voidCustomReason, setVoidCustomReason] = useState('');
  const [voidUser, setVoidUser] = useState('');
  const [isSubmittingVoid, setIsSubmittingVoid] = useState(false);
  const [expandedVisitId, setExpandedVisitId] = useState(null);

  // Payment & Cash Register
  const [activeRegister, setActiveRegister] = useState(null);
  const [showRegisterOpenModal, setShowRegisterOpenModal] = useState(false);
  const [registerInitialAmount, setRegisterInitialAmount] = useState('1000.00');
  const [showRegisterDetailsModal, setShowRegisterDetailsModal] = useState(false);
  const [closeRegisterAmount, setCloseRegisterAmount] = useState('');
  const [closeRegisterNotes, setCloseRegisterNotes] = useState('');
  const [showConfirmCloseModal, setShowConfirmCloseModal] = useState(false);

  // Real-Time Cash Movements States
  const [registerMovements, setRegisterMovements] = useState([]);
  const [registerSummary, setRegisterSummary] = useState(null);
  const [movementActiveTab, setMovementActiveTab] = useState('resumen');
  const [newMovementType, setNewMovementType] = useState('Gasto_Imprevisto');
  const [newMovementAmount, setNewMovementAmount] = useState('');
  const [newMovementConcept, setNewMovementConcept] = useState('');
  const [movementEmployeeId, setMovementEmployeeId] = useState('');

  const [paymentMethod, setPaymentMethod] = useState('Efectivo');
  const [montoRecibido, setMontoRecibido] = useState('');
  const [selectedEmployeeForConsumption, setSelectedEmployeeForConsumption] = useState('');
  const [consumePlanWash, setConsumePlanWash] = useState(true);

  // Global Discount States
  const [globalDiscountType, setGlobalDiscountType] = useState('percentage');
  const [globalDiscountValue, setGlobalDiscountValue] = useState('0.00');
  const [isDiscountOpen, setIsDiscountOpen] = useState(true);

  // Client Profile Modals (Plan Details & Recommendations)
  const [showPlanDetailsModal, setShowPlanDetailsModal] = useState(false);
  const [showRecommendationsModal, setShowRecommendationsModal] = useState(false);

  // General / Guest Client Custom Naming States
  const [quickGeneralName, setQuickGeneralName] = useState('');
  const [isEditingGeneralName, setIsEditingGeneralName] = useState(false);
  const [tempGeneralName, setTempGeneralName] = useState('');

  // Helper to calculate days until client's birthday
  const getBirthdayCountdown = (client) => {
    const dobStr = client?.fecha_nacimiento || client?.fechaNacimiento || client?.dob;
    if (dobStr) {
      try {
        const dob = new Date(dobStr);
        if (!isNaN(dob.getTime())) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const nextBday = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
          if (today > nextBday) {
            nextBday.setFullYear(today.getFullYear() + 1);
          }
          const diffTime = nextBday - today;
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          if (diffDays === 0 || diffDays === 365) {
            return { isToday: true, isAvailable: true, label: '¡Felicidades en su día! 🎂🎉', text: '¡Hoy es su cumpleaños! 🎉' };
          }
          return { isToday: false, isAvailable: diffDays <= 30, label: `Faltan ${diffDays} días para su cumpleaños`, text: `Cumpleaños en ${diffDays} días` };
        }
      } catch (e) {}
    }
    return { isToday: false, isAvailable: false, label: 'Cumpleaños no registrado', text: 'Cumpleaños no registrado' };
  };

  const getLastVisitText = () => {
    if (clientVisitsHistory && clientVisitsHistory.length > 0) {
      const last = clientVisitsHistory[0];
      const vDate = last.visited_at || last.created_at || last.fecha;
      if (vDate) {
        const diffMs = Date.now() - new Date(vDate).getTime();
        const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
        if (diffDays === 0) return 'Última visita hoy';
        if (diffDays === 1) return 'Última visita ayer';
        return `Última visita hace ${diffDays} días`;
      }
    }
    return 'Primera visita (Sin historial)';
  };

  const getRenewalDateText = () => {
    if (activePlans && activePlans.length > 0) {
      const plan = activePlans[0];
      if (plan?.end_date) return plan.end_date;
      if (plan?.next_billing_date) {
        return new Date(plan.next_billing_date).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' });
      }
      return 'En ciclo activo';
    }
    return 'Sin suscripción activa';
  };

  const getRegularWashesCount = () => {
    if (activePlans && activePlans.length > 0) {
      const plan = activePlans[0];
      const remaining = plan.remaining_washes !== undefined ? plan.remaining_washes : plan.remaining_base_washes;
      return remaining !== undefined ? remaining : 3;
    }
    return 0;
  };

  const getExtraBenefitsCount = () => {
    if (activePlans && activePlans.length > 0) {
      const plan = activePlans[0];
      return (plan.promoServices && plan.promoServices.length > 0) || plan.isPromoActive !== false ? 1 : 0;
    }
    return 0;
  };

  const getBenefitsCount = () => {
    if (activePlans && activePlans.length > 0) {
      const regular = getRegularWashesCount();
      const extra = getExtraBenefitsCount();
      return regular + extra;
    }
    return 0;
  };

  const getTotalBenefitsCount = () => {
    if (activePlans && activePlans.length > 0) {
      return activePlans[0]?.total_washes || 4;
    }
    return 4;
  };

  const getClientAvatar = (client) => {
    if (client?.avatar) return client.avatar;
    if (client?.selfie_photo) return client.selfie_photo;
    return 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80';
  };

  // Dynamic Applied Payments State (Multi-Tender)
  const [appliedPayments, setAppliedPayments] = useState([]);
  const [giftCardCode, setGiftCardCode] = useState('');
  const [giftCardInfo, setGiftCardInfo] = useState(null);
  const [giftCardLoading, setGiftCardLoading] = useState(false);
  const [giftCardError, setGiftCardError] = useState('');

  // OTP State
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [isSendingOtp, setIsSendingOtp] = useState(false);

  // Client Visits History State
  const [clientVisitsHistory, setClientVisitsHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const loadClientVisitsHistory = async (clientIdOrName) => {
    if (!clientIdOrName) return;
    setLoadingHistory(true);
    try {
      const visits = await dataService.getVisitsByClient(clientIdOrName);
      setClientVisitsHistory(Array.isArray(visits) ? visits : []);
    } catch (err) {
      console.error('Error loading client visits history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Load Pending Tickets, Employees, Cash Register, Top Services and Clients on Mount
  useEffect(() => {
    fetchPendingTickets();
    fetchEmployees();
    fetchActiveRegister();
    fetchClients();
    fetchTopServices();
  }, [salonId]);

  const fetchTopServices = async () => {
    try {
      const servs = await dataService.getServices().catch(() => []);
      if (Array.isArray(servs) && servs.length > 0) {
        setAvailableServices(servs);
      } else {
        const top = await dataService.getTopServices().catch(() => []);
        if (Array.isArray(top) && top.length > 0) {
          setAvailableServices(top);
        } else {
          setAvailableServices(DEFAULT_TOP_SERVICES);
        }
      }
    } catch (e) {
      console.error('Error cargando servicios catálogo:', e);
      setAvailableServices(DEFAULT_TOP_SERVICES);
    }
  };

  const fetchClients = async () => {
    try {
      const data = await dataService.getClients();
      if (Array.isArray(data) && data.length > 0) {
        setAllClients(data);
        return;
      }
    } catch (e) {
      console.warn('dataService.getClients failed, attempting fallback direct fetch...', e);
    }

    try {
      const res = await fetch('/api/clients');
      if (res.ok) {
        const fallbackData = await res.json();
        if (Array.isArray(fallbackData)) {
          setAllClients(fallbackData);
        }
      }
    } catch (err2) {
      console.error('Error in fetchClients fallback:', err2);
    }
  };

  const fetchPendingTickets = async () => {
    try {
      const tickets = await dataService.getPendingVisits(salonId);
      const list = Array.isArray(tickets) ? tickets : [];
      setPendingTickets(list);
    } catch (e) {
      console.error('Error cargando tickets pendientes:', e);
    }
  };

  // Debounced auto-save draft for active ticket
  useEffect(() => {
    if (!selectedTicket?.id) return;
    const timer = setTimeout(async () => {
      try {
        const currentTotal = calculateTotal();
        const draftPayload = {
          draft_data: { lineItems, selectedPlanId },
          items_detail: lineItems,
          total: currentTotal,
          servicios: lineItems.map(i => i.nombre),
          empleado_peluquera: lineItems[0]?.empleado || 'N/A'
        };
        await dataService.saveDraftTicket(selectedTicket.id, draftPayload);
      } catch (e) {
        console.warn('Auto-save draft error:', e);
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, [lineItems, selectedPlanId, selectedTicket?.id]);

  const fetchEmployees = async () => {
    try {
      const data = await dataService.getEmployees();
      setEmployees(data);
    } catch (e) {
      console.error('Error cargando empleados:', e);
    }
  };

  const fetchActiveRegister = async () => {
    try {
      const reg = await dataService.getActiveCashRegister(salonId);
      setActiveRegister(reg);
      if (reg?.id) {
        await fetchRegisterMovements(reg.id);
      }
      if (window.location.search.includes('action=caja')) {
        if (reg) {
          setShowRegisterDetailsModal(true);
        } else {
          setShowRegisterOpenModal(true);
        }
      }
    } catch (e) {
      console.error('Error cargando caja activa:', e);
    }
  };

  const handleCreateNewTicket = async (e) => {
    e.preventDefault();
    if (!activeRegister) {
      alert('🔒 DEBE ABRIR LA CAJA DE JORNADA PRIMERO\n\nNo se pueden generar nuevos tickets de servicio si no existe una caja abierta para el turno actual.');
      setShowNewTicketModal(false);
      setShowRegisterOpenModal(true);
      return;
    }

    let finalName = '';
    let clientId = 'INVITADO';
    let cedula = '';

    if (ticketType === 'general') {
      finalName = newTicketClientName.trim() || 'Cliente General';
      clientId = 'INVITADO';
    } else if (ticketType === 'plan_beauty') {
      finalName = selectedClientForTicket ? (selectedClientForTicket.nombre || selectedClientForTicket.name) : modalClientSearchTerm.trim();
      clientId = selectedClientForTicket ? selectedClientForTicket.id : 'INVITADO';
      cedula = selectedClientForTicket ? selectedClientForTicket.cedula : newTicketCedula;
    } else if (ticketType === 'empleado') {
      finalName = selectedEmployeeForTicket ? (selectedEmployeeForTicket.nombre || selectedEmployeeForTicket.name) : 'Empleado';
      clientId = selectedEmployeeForTicket ? selectedEmployeeForTicket.id : 'EMPLEADO';
    }

    if (!finalName) {
      alert('Por favor especifique el nombre para generar el ticket.');
      return;
    }

    setLoading(true);
    try {
      if (ticketType === 'plan_beauty' && !selectedClientForTicket && cedula) {
        const found = await dataService.findClientByCedula(cedula);
        if (found) clientId = found.id;
      }

      const res = await dataService.createPendingTicket({
        clientId,
        clientName: finalName,
        servicios: [],
        empleadoPeluquera: 'Sin asignar',
        salon_id: salonId
      });

      setShowNewTicketModal(false);
      setNewTicketClientName('');
      setNewTicketCedula('');
      setClientSearchTerm('');
      setModalClientSearchTerm('');
      setSelectedClientForTicket(null);
      setSelectedEmployeeForTicket(null);
      await fetchPendingTickets();

      // Trigger Physical Ticket Print Layout
      setPrintableTicketData({
        ticketNumber: res.ticketNumber,
        salonName: res.salonName || 'Sucursal San Vicente de Paúl',
        clientName: finalName,
        createdAt: new Date().toLocaleDateString('es-DO') + ' ' + new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
      });
      setShowPrintModal(true);

      // Ticket created successfully and sent to pending list (No auto-selection)
      await fetchPendingTickets();
    } catch (err) {
      alert('Error creando ticket: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDiscardTicket = async (e, ticketId) => {
    if (e && e.stopPropagation) e.stopPropagation();
    if (!window.confirm('¿Seguro que deseas descartar este ticket pendiente?')) return;
    setLoading(true);
    try {
      await dataService.deletePendingTicket(ticketId);
      if (selectedTicket?.id === ticketId) {
        setSelectedTicket(null);
        setLineItems([]);
        setClientFound(null);
        setMontoRecibido('');
        setGlobalDiscountValue('');
      }
      await fetchPendingTickets();
    } catch (err) {
      alert('Error descartando ticket: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDiscardAllTickets = async () => {
    if (!window.confirm('⚠️ ¿Seguro que deseas eliminar TODOS los tickets pendientes de atención? Esta acción vaciará la lista por completo.')) return;
    setLoading(true);
    try {
      await dataService.clearAllPendingTickets(selectedSalonId || 'all');
      setSelectedTicket(null);
      setLineItems([]);
      setClientFound(null);
      setMontoRecibido('');
      setGlobalDiscountValue('');
      await fetchPendingTickets();
    } catch (err) {
      alert('Error eliminando todos los tickets: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStartBlankTicket = () => {
    setSelectedTicket(null);
    setLineItems([]);
    setClientFound(null);
    setClientSearchTerm('');
    setMontoRecibido('');
    setGlobalDiscountValue('');
  };

  // Direct Client Selection from Search
  const handleSelectClient = async (client) => {
    setClientFound(client);
    setClientSearchTerm('');
    await loadClientPlanData(client.id, client.nombre || client.name);
    await loadClientVisitsHistory(client.id || client.nombre || client.name);
  };

  // Instant Custom General Client Selection
  const handleQuickGeneralClient = (nameToUse) => {
    const finalName = (nameToUse || clientSearchTerm || 'Cliente General').trim();
    setClientFound({
      id: 'INVITADO',
      nombre: finalName || 'Cliente General',
      name: finalName || 'Cliente General',
      es_invitado: true
    });
    setActivePlans([]);
    setClientVisitsHistory([]);
    setClientSearchTerm('');
  };

  // Open Ticket into Billing View & Collapse List
  const handleSelectTicket = async (ticket) => {
    if (!ticket) return;
    setSelectedTicket(ticket);
    setIsTicketExpanded(true);

    let draft = {};
    try {
      if (ticket.draft_data) {
        draft = typeof ticket.draft_data === 'string' ? JSON.parse(ticket.draft_data) : ticket.draft_data;
      }
    } catch (e) {}

    let items = [];
    try {
      if (ticket.items_detail) {
        items = typeof ticket.items_detail === 'string' ? JSON.parse(ticket.items_detail) : ticket.items_detail;
      }
    } catch (e) {}

    let rawItems = (Array.isArray(items) && items.length > 0) ? items : (draft.lineItems || []);

    if ((!rawItems || rawItems.length === 0) && ticket.servicios) {
      let rawServicios = [];
      try {
        rawServicios = typeof ticket.servicios === 'string' ? JSON.parse(ticket.servicios) : ticket.servicios;
      } catch (e) {}
      if (Array.isArray(rawServicios)) {
        rawItems = rawServicios
          .filter(s => {
            const sName = typeof s === 'string' ? s : (s.nombre || s.name || s.servicio || '');
            return sName && sName !== 'Ticket en Construcción' && sName !== 'Servicio en preparación';
          })
          .map((s, idx) => {
            const sName = typeof s === 'string' ? s : (s.nombre || s.name || s.servicio || 'Servicio');
            const matchedCatalog = (availableServices || []).find(as => (as.nombre || '').toLowerCase() === sName.toLowerCase());
            const price = typeof s === 'object' && s.precio ? Number(s.precio) : (matchedCatalog?.precio || 500);
            return {
              id: `item-${Date.now()}-${idx}`,
              nombre: sName,
              name: sName,
              servicio: sName,
              precio: price,
              precioBase: price,
              precioAplicado: price,
              cantidad: 1,
              descuento: 0,
              aplica_itbis: matchedCatalog?.aplica_itbis || 0,
              empleado_id: ticket.empleado_peluquera_id || ticket.empleado_peluquera || '',
              empleado_nombre: ticket.empleado_peluquera || ''
            };
          });
      }
    }

    const sanitizedItems = (Array.isArray(rawItems) ? rawItems : [])
      .filter(it => {
        const n = it.nombre || it.name || it.servicio || '';
        return n && n !== 'Ticket en Construcción' && n !== 'Servicio en preparación';
      })
      .map((it, idx) => {
        const p = Number(it.precioAplicado || it.precioBase || it.precio || 0);
        return {
          ...it,
          id: it.id || `item-${Date.now()}-${idx}`,
          nombre: it.nombre || it.name || it.servicio || 'Servicio',
          precioBase: Number(it.precioBase !== undefined ? it.precioBase : p),
          precioAplicado: Number(it.precioAplicado !== undefined ? it.precioAplicado : p),
          cantidad: Number(it.cantidad || 1),
          descuento: Number(it.descuento || 0),
          aplica_itbis: it.aplica_itbis === 1 || it.aplica_itbis === true ? 1 : 0,
          empleado_id: it.empleado_id || it.empleado || '',
          empleado_nombre: it.empleado_nombre || it.empleado || ''
        };
      });

    setLineItems(sanitizedItems);

    // Automatic Plan Beauty & Client Profile Detection ONLY for registered clients
    const isGuest = !ticket.client_id || ticket.client_id === 'INVITADO' || String(ticket.client_id).startsWith('INVITADO');

    if (!isGuest && ticket.client_id) {
      const match = (allClients || []).find(c => String(c.id) === String(ticket.client_id) || (c.cedula && c.cedula === ticket.client_cedula) || (c.nombre || c.name) === ticket.client_name);
      setClientFound(match || { id: ticket.client_id, nombre: ticket.client_name || 'Cliente' });
      await loadClientPlanData(ticket.client_id, ticket.client_name, ticket);
      await loadClientVisitsHistory(ticket.client_id);
    } else {
      setClientFound({ id: 'INVITADO', nombre: ticket.client_name || 'Cliente General', name: ticket.client_name || 'Cliente General', es_invitado: true });
      setActivePlans([]);
      setClientVisitsHistory([]);
    }
  };

  const loadClientPlanData = async (clientId, clientName, ticketObj = null) => {
    try {
      if (!clientId || clientId === 'INVITADO' || String(clientId).startsWith('INVITADO')) {
        setActivePlans([]);
        return;
      }

      // Multi-stage contract lookup strictly for registered client ID or Cedula
      let contractsFound = [];
      if (clientId && clientId !== 'INVITADO') {
        contractsFound = await dataService.getContractByClient(clientId);
      }
      if ((!contractsFound || contractsFound.length === 0) && clientFound?.cedula) {
        contractsFound = await dataService.getContractByClient(clientFound.cedula.trim());
      }
      if ((!contractsFound || contractsFound.length === 0) && ticketObj?.plan_beauty_id) {
        contractsFound = await dataService.getContractByClient(ticketObj.plan_beauty_id);
      }

      // Filter only Active contracts
      const activeContracts = (Array.isArray(contractsFound) ? contractsFound : []).filter(
        c => c.status === 'Active' || c.status === 'Activo'
      );

      const pastVisits = await dataService.getVisitsByClient(clientId).catch(() => []) || [];
      const allPlans = await dataService.getPlans().catch(() => []) || [];

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

      let planesConContrato = activeContracts.map(contract => {
        const matchedPlan = allPlans.find(p => p.id === contract.plan_id || String(p.id) === String(contract.plan_id));
        const baseServices = peel(contract.contract_services) || matchedPlan?.services || [];
        const promoServices = peel(contract.contract_promo_services) || matchedPlan?.promo_services || [];
        const allServices = [...(Array.isArray(baseServices) ? baseServices : []), ...(Array.isArray(promoServices) ? promoServices : [])];

        const parseDate = (d) => {
          if (!d) return 0;
          if (d instanceof Date) return d.getTime();
          const dateStr = String(d).endsWith('Z') ? String(d) : String(d).replace(' ', 'T') + 'Z';
          const time = new Date(dateStr).getTime();
          return isNaN(time) ? new Date(d).getTime() : time;
        };

        const lastBillingTime = parseDate(contract.last_billed_date);
        const threshold = lastBillingTime > 0 ? lastBillingTime : 0;
        // Count only visits that actually redeemed a Plan Beauty wash in the current cycle
        const cycleVisits = pastVisits.filter(v => {
          if (v.status !== 'Facturado' && v.status !== 'Completado') return false;
          if (parseDate(v.visited_at) < threshold) return false;

          const method = (v.metodo_pago || '').toLowerCase();
          if (method.includes('plan')) return true;

          let hasPlanWashItem = false;
          try {
            if (v.items_detail) {
              const parsed = typeof v.items_detail === 'string' ? JSON.parse(v.items_detail) : v.items_detail;
              if (Array.isArray(parsed)) {
                hasPlanWashItem = parsed.some(i => i.isPlanWash || (i.nombre && i.nombre.toLowerCase().includes('plan beauty')));
              }
            }
          } catch (e) {}

          return hasPlanWashItem;
        });

        const usedCount = cycleVisits.length;
        const totalAllowed = 4;
        const remainingWashes = Math.max(0, totalAllowed - usedCount);

        const formattedExpiry = contract.next_billing_date
          ? new Date(contract.next_billing_date).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' })
          : (contract.end_date ? new Date(contract.end_date).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }) : '23 Sep 2026');

        return {
          ...matchedPlan,
          id: contract.plan_id || '1',
          contract_id: contract.id,
          title: contract.planTitle || matchedPlan?.title || 'Plan Beauty',
          services: allServices.length > 0 ? allServices : ['Lavado y Secado', 'Tratamiento Profundo'],
          baseServices,
          promoServices,
          cycleVisitsCount: usedCount,
          used_washes: usedCount,
          total_washes: totalAllowed,
          remaining_base_washes: remainingWashes,
          remaining_washes: remainingWashes,
          end_date: formattedExpiry,
          isPromoActive: true
        };
      });

      // If no active contracts were found, check if ticket specifies a plan
      if (planesConContrato.length === 0 && ticketObj?.plan_beauty_id) {
        planesConContrato = [{
          id: ticketObj.plan_beauty_id,
          title: 'Plan Beauty',
          services: ['Lavado y Secado', 'Tratamiento Profundo'],
          used_washes: 0,
          total_washes: 4,
          remaining_base_washes: 4,
          remaining_washes: 4,
          end_date: '23 Sep 2026',
          isPromoActive: true
        }];
      }

      setActivePlans(planesConContrato);

      // Set Selfie Photo from Contract as Client Profile Avatar if available
      if (activeContracts.length > 0 && activeContracts[0].selfie_photo) {
        setClientFound(prev => (prev ? {
          ...prev,
          avatar: activeContracts[0].selfie_photo,
          selfie_photo: activeContracts[0].selfie_photo
        } : prev));
      }

      if (planesConContrato.length > 0) {
        setSelectedPlanId(planesConContrato[0].id.toString());
      } else {
        setSelectedPlanId('none');
      }
    } catch (err) {
      console.error('Error in loadClientPlanData:', err);
      setActivePlans([]);
      setSelectedPlanId('none');
    }
  };

  // Smart dynamic recommendations based on client's real past consumption history
  const getSmartRecommendations = () => {
    if (!clientFound) return [];
    
    // 1. Gather services from actual past visits
    const pastServicesMap = new Map();
    if (Array.isArray(clientVisitsHistory)) {
      clientVisitsHistory.forEach(v => {
        let items = [];
        try {
          if (v.items_detail) {
            items = typeof v.items_detail === 'string' ? JSON.parse(v.items_detail) : v.items_detail;
          } else if (v.servicios) {
            const raw = typeof v.servicios === 'string' ? JSON.parse(v.servicios) : v.servicios;
            if (Array.isArray(raw)) items = raw.map(s => (typeof s === 'string' ? { nombre: s, precio: 600 } : s));
          }
        } catch (e) {}

        if (Array.isArray(items)) {
          items.forEach(it => {
            const sName = it.nombre || it.servicio || it.name;
            if (!sName || sName.toLowerCase().includes('plan beauty') || sName.toLowerCase().includes('lavado')) return;
            if (!pastServicesMap.has(sName)) {
              pastServicesMap.set(sName, {
                nombre: sName,
                precio: it.precioAplicado || it.precio || it.precioBase || 600,
                lastSeen: v.visited_at,
                count: 1
              });
            } else {
              const prev = pastServicesMap.get(sName);
              prev.count += 1;
            }
          });
        }
      });
    }

    const recommendations = [];
    pastServicesMap.forEach((val, key) => {
      let timeLabel = 'Servicio habitual';
      if (val.lastSeen) {
        const days = Math.max(1, Math.round((Date.now() - new Date(val.lastSeen).getTime()) / (1000 * 60 * 60 * 24)));
        if (days <= 7) timeLabel = 'Hace 1 sem';
        else if (days <= 30) timeLabel = `Hace ${Math.round(days / 7)} sem`;
        else timeLabel = `Hace ${Math.round(days / 30)} meses`;
      }
      recommendations.push({
        id: `rec-${key}`,
        nombre: val.nombre,
        precio: val.precio,
        tiempo: timeLabel,
        isFromHistory: true
      });
    });

    // 2. If client has fewer than 2 past unique services, complement with top catalog services
    if (recommendations.length < 3) {
      const topDefaults = (availableServices || DEFAULT_TOP_SERVICES).filter(s => 
        !s.nombre.toLowerCase().includes('lavado') && !recommendations.some(r => r.nombre.toLowerCase() === s.nombre.toLowerCase())
      );
      topDefaults.slice(0, 3 - recommendations.length).forEach(s => {
        recommendations.push({
          id: `top-${s.id}`,
          nombre: s.nombre,
          precio: s.precio || s.precioBase || 600,
          tiempo: 'Recomendado',
          isFromHistory: false
        });
      });
    }

    return recommendations.slice(0, 3);
  };

  // Auto-Save Draft on "Volver Atrás"
  const handleVolverAtras = async () => {
    if (!selectedTicket) {
      setIsTicketExpanded(false);
      return;
    }

    setLoading(true);
    try {
      const currentTotal = calculateTotal();
      const draftPayload = {
        draft_data: { lineItems, selectedPlanId },
        items_detail: lineItems,
        total: currentTotal,
        servicios: lineItems.map(i => i.nombre),
        empleado_peluquera: lineItems[0]?.empleado || 'N/A'
      };

      await dataService.saveDraftTicket(selectedTicket.id, draftPayload);
      await fetchPendingTickets();
    } catch (e) {
      console.error('Error guardando borrador:', e);
    } finally {
      setLoading(false);
      setIsTicketExpanded(false); // Re-expand ticket queue
      setSelectedTicket(null);
    }
  };

  // Automatically Create/Assign Ticket on Client Selection from Search
  const handleSelectClientAndInitTicket = async (clientObj) => {
    setClientFound(clientObj);
    await loadClientPlanData(clientObj.id, clientObj.nombre || clientObj.name);
    setClientSearchTerm('');

    try {
      const res = await dataService.createPendingTicket({
        clientId: clientObj.id,
        clientName: clientObj.nombre || clientObj.name,
        servicios: ['Servicio en preparación'],
        empleadoPeluquera: 'Sin asignar',
        salon_id: salonId
      });
      
      const newTicketObj = {
        id: res.id,
        ticket_number: res.ticketNumber || `#${Math.floor(100000 + Math.random() * 900000)}`,
        salon_name: res.salonName || 'Sucursal San Vicente de Paúl',
        client_id: clientObj.id,
        client_name: clientObj.nombre || clientObj.name,
        visited_at: new Date().toISOString(),
        servicios: [],
        status: 'En Edición'
      };
      
      await fetchPendingTickets();
      setPrintableTicketData({
        ticketNumber: res.ticketNumber || `#${Math.floor(100000 + Math.random() * 900000)}`,
        salonName: res.salonName || 'Sucursal San Vicente de Paúl',
        clientName: clientObj.nombre || clientObj.name,
        createdAt: new Date().toLocaleDateString('es-DO') + ' ' + new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
      });
      setShowPrintModal(true);
    } catch (err) {
      console.error('Error creating ticket on client select:', err);
    }
  };

  // Handle Facturar Plan Service with OTP Security
  const handleStartFacturarPlanService = async (serviceObj) => {
    if (!clientFound) {
      alert('Por favor seleccione un cliente primero.');
      return;
    }
    setPendingPlanService(serviceObj);
    setOtpCodeInput('');
    setAdminCodeBypass(false);
    setAdminBypassPin('');
    setOtpSentEmail('');
    setShowOtpVerificationModal(true);
    setOtpSending(true);

    try {
      const cId = clientFound?.id || selectedTicket?.client_id;
      const cEmail = clientFound?.email || selectedTicket?.client_email;
      const res = await dataService.generateOTP(cId, cEmail);
      if (res?.email) setOtpSentEmail(res.email);
      if (res && res.error) {
        console.warn('Error sending OTP:', res.error);
      }
    } catch (err) {
      console.error('Error generating OTP for client:', err);
    } finally {
      setOtpSending(false);
    }
  };

  const handleResendOtpCode = async () => {
    const cId = clientFound?.id || selectedTicket?.client_id;
    const cEmail = clientFound?.email || selectedTicket?.client_email;
    setOtpSending(true);
    try {
      const res = await dataService.generateOTP(cId, cEmail);
      if (res && res.error) {
        alert('Error al reenviar código: ' + res.error);
      } else {
        setOtpCodeInput('');
        if (res?.email) setOtpSentEmail(res.email);
        const targetEmail = res?.email || cEmail || clientFound?.email || selectedTicket?.client_email;
        alert(`✉️ Nuevo código de seguridad enviado ${targetEmail ? `al correo (${targetEmail})` : 'al correo del cliente'}.`);
      }
    } catch (err) {
      alert('Error enviando código: ' + err.message);
    } finally {
      setOtpSending(false);
    }
  };

  const handleVerifyOtpAndAddPlanService = async () => {
    if (adminCodeBypass) {
      // Gerencial PIN authorization (2026, 1234, 8888)
      if (adminBypassPin === '2026' || adminBypassPin === '1234' || adminBypassPin === '8888') {
        setShowOtpVerificationModal(false);
        setPendingPlanService(null);
        await executeCheckout();
        return;
      } else {
        alert('Clave gerencial incorrecta.');
        return;
      }
    }

    if (!otpCodeInput || otpCodeInput.trim().length < 4) {
      alert('Por favor ingrese el código de verificación de 6 dígitos.');
      return;
    }

    setOtpVerifying(true);
    try {
      const clientId = clientFound?.id || selectedTicket?.client_id || '1779838957032';
      const visitData = {
        clientName: clientFound?.nombre || clientFound?.name || selectedTicket?.client_name,
        servicios: lineItems.map(i => i.nombre),
        salon_id: salonId,
        empleadoPeluquera: lineItems[0]?.empleado || 'Wendy'
      };

      await dataService.verifyOTPAndDiscount(clientId, otpCodeInput.trim(), visitData);

      setShowOtpVerificationModal(false);
      setPendingPlanService(null);
      await executeCheckout();
    } catch (err) {
      alert('Código incorrecto o vencido: ' + (err.message || 'Intente nuevamente'));
    } finally {
      setOtpVerifying(false);
    }
  };

  // Plan Beauty Wash Direct Redemption (RD$ 0.00 Included)
  const addPlanWashToTicket = () => {
    if (!activePlans || activePlans.length === 0 || (activePlans[0]?.remaining_washes || 0) <= 0) {
      alert('El cliente no tiene lavados disponibles en su Plan Beauty.');
      return;
    }
    const alreadyHasPlanWash = lineItems.some(i => i.isPlanWash || (i.nombre && i.nombre.includes('Plan Beauty')));
    if (alreadyHasPlanWash) {
      alert('ℹ️ Ya se ha incluido el lavado del Plan Beauty en esta factura.');
      return;
    }

    const newWashItem = {
      id: Date.now() + Math.random(),
      service_id: 'plan-beauty-wash',
      nombre: 'Lavado y Secado (Plan Beauty)',
      precioBase: 0,
      precioAplicado: 0,
      descuento: 0,
      cantidad: 1,
      empleado: '',
      empleado_id: '',
      empleado_nombre: '',
      isPlanWash: true
    };

    setLineItems([newWashItem, ...lineItems]);
  };

  // Line Items Controls (Price rules & Intelligent matching)
  const addServiceToLineItems = (service) => {
    const isWash = (service.nombre || '').toLowerCase().includes('lavado');
    const hasPlanWashAvailable = Boolean(activePlans && activePlans.length > 0 && (activePlans[0]?.remaining_washes || 0) > 0);
    const alreadyHasPlanWash = lineItems.some(i => i.isPlanWash || (i.nombre && i.nombre.includes('Plan Beauty')));

    const match = availableServices.find(s => 
      (s.id && s.id === service.id) || 
      (s.nombre || '').toLowerCase().trim() === (service.nombre || '').toLowerCase().trim() ||
      (s.nombre || '').toLowerCase().includes((service.nombre || '').toLowerCase())
    );
    const realPrice = match?.precio || match?.precioBase || service.precio || service.precioBase || 600;
    const realName = match?.nombre || service.nombre;

    const isCoveredByPlan = isWash && hasPlanWashAvailable && !alreadyHasPlanWash;

    const newItem = {
      id: Date.now() + Math.random(),
      service_id: match?.id || service.id || `srv-${Date.now()}`,
      nombre: isCoveredByPlan ? `${realName} (Plan Beauty)` : realName,
      precioBase: isCoveredByPlan ? 0 : realPrice,
      precioAplicado: isCoveredByPlan ? 0 : realPrice,
      cantidad: 1,
      empleado: '',
      empleado_id: '',
      empleado_nombre: '',
      descuento: 0,
      isPlanWash: isCoveredByPlan,
      aplica_itbis: match?.aplica_itbis !== undefined ? (match.aplica_itbis ? 1 : 0) : (service.aplica_itbis !== undefined ? (service.aplica_itbis ? 1 : 0) : 0)
    };
    setLineItems([...lineItems, newItem]);
  };

  const updateQuantity = (index, delta) => {
    const updated = [...lineItems];
    const newQty = Math.max(1, (updated[index].cantidad || 1) + delta);
    updated[index].cantidad = newQty;
    setLineItems(updated);
  };

  const handleEmployeeChange = (index, empVal) => {
    const updated = [...lineItems];
    if (!empVal) {
      updated[index].empleado = '';
      updated[index].empleado_id = '';
      updated[index].empleado_nombre = '';
    } else {
      const emp = employees.find(e => String(e.id) === String(empVal) || e.nombre === empVal);
      updated[index].empleado = emp ? emp.nombre : empVal;
      updated[index].empleado_id = emp ? emp.id : empVal;
      updated[index].empleado_nombre = emp ? emp.nombre : empVal;
    }
    setLineItems(updated);
  };

  const handleDiscountChange = (index, discountPercent) => {
    const pct = parseFloat(discountPercent) || 0;
    if (pct > 0 && !isAdminAuthorized) {
      setPendingDiscountItem({ type: 'discount', index, pct });
      setShowAdminPinModal(true);
      return;
    }
    const updated = [...lineItems];
    const item = updated[index];
    const discountAmt = (item.precioBase * item.cantidad) * (pct / 100);
    updated[index].descuento = discountAmt;
    updated[index].descuentoPercent = pct;
    setLineItems(updated);
  };

  const handlePriceChange = (index, newPrice) => {
    const val = parseFloat(newPrice) || 0;
    const item = lineItems[index];

    // Restricción: No se puede disminuir por debajo del precio base sin clave admin
    if (val < item.precioBase && !isAdminAuthorized) {
      setPendingDiscountItem({ index, val });
      setShowAdminPinModal(true);
      return;
    }

    const updated = [...lineItems];
    updated[index].precioAplicado = val;
    setLineItems(updated);
  };

  const verifyAdminPin = () => {
    if (adminPin === '2026' || adminPin === '1234' || adminPin === '8888') {
      setIsAdminAuthorized(true);
      setShowAdminPinModal(false);
      if (pendingDiscountItem) {
        const updated = [...lineItems];
        if (pendingDiscountItem.type === 'discount') {
          const { index, pct } = pendingDiscountItem;
          const item = updated[index];
          if (item) {
            const discountAmt = (item.precioBase * item.cantidad) * (pct / 100);
            updated[index].descuento = discountAmt;
            updated[index].descuentoPercent = pct;
          }
        } else if (pendingDiscountItem.val !== undefined) {
          updated[pendingDiscountItem.index].precioAplicado = pendingDiscountItem.val;
        }
        setLineItems(updated);
        setPendingDiscountItem(null);
      }
      setAdminPin('');
    } else {
      alert('Clave de Autorización de Administrador incorrecta');
    }
  };

  const handleItbisChange = (index, val) => {
    const updated = [...lineItems];
    updated[index].aplica_itbis = parseInt(val, 10) === 1 ? 1 : 0;
    setLineItems(updated);
  };

  const removeLineItem = (index) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  // Calculate Plan Beauty discount when consumePlanWash is ON and client has active plan
  const calculatePlanDiscount = () => {
    if (!consumePlanWash || !activePlans || activePlans.length === 0) return 0;
    // Find the first wash/covered item in line items
    const washItem = lineItems.find(item => 
      (item.nombre || '').toLowerCase().includes('lavado') || 
      (item.nombre || '').toLowerCase().includes('secado') || 
      String(item.service_id).includes('plan') ||
      item.id === 'plan-washes' ||
      item.id === 'plan-treatment'
    );
    if (washItem) {
      return (washItem.precioAplicado * washItem.cantidad);
    }
    // If paymentMethod is Plan Beauty and items exist, cover the first item
    if (paymentMethod === 'Plan Beauty' && lineItems.length > 0) {
      return (lineItems[0].precioAplicado * lineItems[0].cantidad);
    }
    return 0;
  };

  const grossSubtotal = lineItems.reduce((acc, item) => acc + (item.precioAplicado * item.cantidad), 0);
  const manualDiscounts = lineItems.reduce((acc, item) => acc + (item.descuento || 0), 0);
  const planDiscountAmount = calculatePlanDiscount();
  const parsedGlobalDiscount = parseFloat(globalDiscountValue) || 0;
  const globalDiscountAmount = globalDiscountType === 'percentage' 
    ? (grossSubtotal * parsedGlobalDiscount) / 100 
    : parsedGlobalDiscount;
  const totalDiscounts = manualDiscounts + planDiscountAmount + globalDiscountAmount;
  
  // Calculate ITBIS dynamically: Exempt items (aplica_itbis === 0) do not compute ITBIS
  const itbisAmount = lineItems.reduce((acc, item) => {
    const itemAppliesItbis = item.aplica_itbis === 1 || item.aplica_itbis === true;
    if (!itemAppliesItbis || item.isPlanWash || item.precioBase === 0) return acc;

    const itemGross = item.precioAplicado * item.cantidad;
    const itemManualDisc = item.descuento || 0;
    const itemPropDiscount = grossSubtotal > 0 
      ? (itemGross / grossSubtotal) * (planDiscountAmount + globalDiscountAmount)
      : 0;
    const itemTaxable = Math.max(0, itemGross - itemManualDisc - itemPropDiscount);
    return acc + (itemTaxable * 0.18);
  }, 0);

  const taxableSubtotal = Math.max(0, grossSubtotal - totalDiscounts);
  const finalTotalAmount = taxableSubtotal + itbisAmount;
  const totalAmount = finalTotalAmount;

  const calculateTotal = () => finalTotalAmount;

  // Real-Time Dynamic Multi-Tender Calculations
  const totalAppliedSum = appliedPayments.reduce((acc, p) => acc + (parseFloat(p.amount) || 0), 0);
  const cashAppliedSum = appliedPayments.filter(p => p.method === 'Efectivo').reduce((acc, p) => acc + (parseFloat(p.amount) || 0), 0);
  const nonCashAppliedSum = appliedPayments.filter(p => p.method !== 'Efectivo').reduce((acc, p) => acc + (parseFloat(p.amount) || 0), 0);

  const neededForCashPortion = Math.max(0, finalTotalAmount - nonCashAppliedSum);
  const cambioAmount = Math.max(0, cashAppliedSum - neededForCashPortion);
  const effectiveCashCovered = Math.min(cashAppliedSum, neededForCashPortion);
  const pendienteAmount = Math.max(0, finalTotalAmount - (nonCashAppliedSum + effectiveCashCovered));
  const isFinalizeEnabled = pendienteAmount <= 0.01 && appliedPayments.length > 0 && lineItems.length > 0;

  // Auto-sync single cash payment with totalAmount
  useEffect(() => {
    if (appliedPayments.length === 0 && finalTotalAmount > 0) {
      setAppliedPayments([
        {
          id: `pay-default-${Date.now()}`,
          method: 'Efectivo',
          amount: finalTotalAmount.toString(),
          giftCardCode: '',
          giftCardInfo: null
        }
      ]);
    }
  }, [finalTotalAmount]);

  // Handlers for Applied Payments Multi-Tender Selection
  const handleToggleMethod = (methodName) => {
    // If the method is already active
    const exists = appliedPayments.find(p => p.method === methodName);
    if (exists) {
      if (appliedPayments.length > 1) {
        setAppliedPayments(prev => prev.filter(p => p.method !== methodName));
      }
      return;
    }

    // If currently only 1 method is active and its amount covers full total:
    // Simply switch to the new selected method!
    if (appliedPayments.length === 1) {
      const currentAmt = parseFloat(appliedPayments[0].amount) || 0;
      if (currentAmt >= finalTotalAmount || currentAmt === 0) {
        setAppliedPayments([
          {
            id: `pay-${Date.now()}`,
            method: methodName,
            amount: finalTotalAmount > 0 ? finalTotalAmount.toString() : '0',
            giftCardCode: '',
            giftCardInfo: null
          }
        ]);
        return;
      }
    }

    // Otherwise, add the new method with the remaining pending amount
    const remainingToCover = Math.max(0, finalTotalAmount - (nonCashAppliedSum + effectiveCashCovered));
    const newPayment = {
      id: `pay-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      method: methodName,
      amount: remainingToCover > 0 ? remainingToCover.toString() : '0',
      giftCardCode: '',
      giftCardInfo: null
    };
    setAppliedPayments(prev => [...prev, newPayment]);
  };

  const handleAddAppliedPayment = handleToggleMethod;

  const handleUpdatePaymentAmount = (paymentId, newAmount) => {
    setAppliedPayments(prev => prev.map(p => {
      if (p.id === paymentId) {
        return { ...p, amount: newAmount };
      }
      return p;
    }));
  };

  const handleRemoveAppliedPayment = (paymentId) => {
    setAppliedPayments(prev => prev.filter(p => p.id !== paymentId));
  };

  const handleVerifyAppliedGiftCard = async (paymentId, code) => {
    if (!code || !code.trim()) return;
    try {
      const res = await dataService.verifyGiftCard(code.trim());
      if (res && res.valid) {
        const bal = Number(res.balance || 0);
        const maxCover = Math.min(bal, pendienteAmount > 0 ? pendienteAmount : finalTotalAmount);
        setAppliedPayments(prev => prev.map(p => {
          if (p.id === paymentId) {
            return {
              ...p,
              giftCardCode: code.trim(),
              giftCardInfo: res,
              amount: maxCover > 0 ? maxCover.toString() : p.amount
            };
          }
          return p;
        }));
      } else {
        alert(res?.message || 'Código de Gift Card no válido o sin balance.');
      }
    } catch (e) {
      alert('Error verificando Gift Card: ' + e.message);
    }
  };

  const handleCotizarProforma = () => {
    if (lineItems.length === 0) {
      alert('⚠️ Agrega al menos un servicio antes de generar una cotización o proforma.');
      return;
    }
    const cName = clientFound?.nombre || clientFound?.name || selectedTicket?.client_name || 'Cliente General';
    setPrintableTicketData({
      ticketNumber: selectedTicket?.ticket_number || `COT-${Date.now().toString().slice(-4)}`,
      salonName: 'Sucursal San Vicente de Paúl',
      clientName: cName,
      isProforma: true,
      totalAmount: finalTotalAmount,
      items: lineItems,
      createdAt: new Date().toLocaleDateString('es-DO') + ' ' + new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
    });
    setShowPrintModal(true);
  };

  // Real-Time Devuelta calculation (legacy fallback)
  const devueltaAmount = cambioAmount;

  // Single Cash Register Open Check before checkout
  const handleOpenCashRegister = async () => {
    setLoading(true);
    try {
      const res = await dataService.openCashRegister({
        salon_id: salonId,
        employee_id: currentUser?.id || 'EMP',
        employee_name: currentUser?.nombre || 'Cajero',
        monto_inicial: parseFloat(registerInitialAmount) || 0
      });
      setActiveRegister(res.register || { id: res.registerId, register_number: res.registerNumber });
      setShowRegisterOpenModal(false);
    } catch (e) {
      alert('Error abriendo caja: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCloseCashRegister = async () => {
    if (!activeRegister) return;
    setLoading(true);
    try {
      const res = await dataService.closeCashRegister(activeRegister.id, {
        monto_final: parseFloat(closeRegisterAmount) || 0,
        observaciones: closeRegisterNotes.trim()
      });
      const diffVal = res.summary?.diferencia || 0;
      const diffText = diffVal === 0 ? '🟢 Cuadre Perfecto (Sin diferencia)' : diffVal > 0 ? `🔷 Sobrante: + RD$ ${diffVal.toFixed(2)}` : `🔴 Faltante: - RD$ ${Math.abs(diffVal).toFixed(2)}`;
      alert(`🔒 Arqueo y Cierre de Caja Finalizado Exitosamente.\n\n${diffText}`);
      setActiveRegister(null);
      setShowConfirmCloseModal(false);
      setShowRegisterDetailsModal(false);
      setCloseRegisterAmount('');
      setCloseRegisterNotes('');
    } catch (e) {
      alert('Error cerrando caja: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchRegisterMovements = async (regId) => {
    const idToUse = regId || activeRegister?.id;
    if (!idToUse) return;
    try {
      const data = await dataService.getCashRegisterMovements(idToUse);
      setRegisterMovements(data.movements || []);
      setRegisterSummary(data.summary || null);
    } catch (e) {
      console.error('Error cargando movimientos de caja:', e);
    }
  };

  const handleSaveManualMovement = async (e) => {
    e.preventDefault();
    if (!activeRegister) return;
    const amt = parseFloat(newMovementAmount);
    if (isNaN(amt) || amt <= 0) {
      alert('Por favor ingresa un monto válido mayor a 0.');
      return;
    }
    if (newMovementType === 'Prestamo_Empleado' && !movementEmployeeId) {
      alert('Por favor selecciona el empleado beneficiario del préstamo.');
      return;
    }
    if (!newMovementConcept.trim()) {
      alert('Por favor especifica las observaciones o concepto del movimiento.');
      return;
    }

    const selectedEmp = employees.find(emp => String(emp.id) === String(movementEmployeeId));

    setLoading(true);
    try {
      await dataService.addCashRegisterMovement(activeRegister.id, {
        type: newMovementType,
        amount: amt,
        concept: selectedEmp ? `[Préstamo: ${selectedEmp.nombre || selectedEmp.name}] ${newMovementConcept.trim()}` : newMovementConcept.trim(),
        employee_id: selectedEmp ? selectedEmp.id : null,
        employee_name: selectedEmp ? (selectedEmp.nombre || selectedEmp.name) : null,
        user_id: currentUser?.id || 'EMP',
        user_name: currentUser?.nombre || 'Cajero'
      });
      alert('✅ Movimiento de caja registrado exitosamente.');
      setNewMovementAmount('');
      setNewMovementConcept('');
      setMovementEmployeeId('');
      await fetchRegisterMovements(activeRegister.id);
      setMovementActiveTab('resumen');
    } catch (err) {
      alert('Error registrando movimiento: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Verification for Gift Card
  const handleVerifyGiftCard = async (overrideCode = null) => {
    const codeToTest = overrideCode || giftCardCode;
    if (!codeToTest || !codeToTest.trim()) {
      setGiftCardError('Por favor ingresa el código de la Gift Card');
      setGiftCardInfo(null);
      return;
    }

    setGiftCardLoading(true);
    setGiftCardError('');
    try {
      const card = await dataService.verifyGiftCardCode(codeToTest);
      if (!card) {
        setGiftCardError('Código de Gift Card no encontrado en el sistema.');
        setGiftCardInfo(null);
      } else if (card.status !== 'Active' && card.status !== 'Partially_Redeemed') {
        setGiftCardError(`Esta Gift Card no está activa (Estado actual: ${card.status}).`);
        setGiftCardInfo(null);
      } else if (Number(card.balance) <= 0) {
        setGiftCardError('Esta Gift Card ya no posee balance disponible (RD$ 0.00).');
        setGiftCardInfo(null);
      } else {
        setGiftCardInfo(card);
        setGiftCardError('');
      }
    } catch (e) {
      setGiftCardError('Error al verificar Gift Card: ' + e.message);
      setGiftCardInfo(null);
    } finally {
      setGiftCardLoading(false);
    }
  };

  // Finalize Billing / Checkout with Strict Validations
  const handleFinalizeCheckout = async () => {
    if (!activeRegister) {
      setShowRegisterOpenModal(true);
      return;
    }

    if (lineItems.length === 0) {
      alert('⚠️ No se han agregado servicios a esta factura. Por favor selecciona al menos un servicio antes de facturar.');
      return;
    }

    if (appliedPayments.length === 0) {
      alert('⚠️ Debes aplicar al menos un método de pago en la sección "Aplicar Pago" antes de finalizar la factura.');
      return;
    }

    if (pendienteAmount > 0.01) {
      alert(`⚠️ Aún queda un monto pendiente de RD$ ${pendienteAmount.toLocaleString('es-DO', { minimumFractionDigits: 2 })}. Por favor completa los pagos aplicados hasta que Pendiente sea RD$ 0.`);
      return;
    }

    // Check if invoice includes a Plan Beauty wash that requires client email OTP verification
    const hasPlanWash = lineItems.some(i => i.isPlanWash || (i.nombre && i.nombre.includes('Plan Beauty')));
    if (hasPlanWash) {
      const cId = clientFound?.id || selectedTicket?.client_id;
      const cEmail = clientFound?.email || selectedTicket?.client_email;
      
      setOtpCodeInput('');
      setAdminCodeBypass(false);
      setAdminBypassPin('');
      setOtpSentEmail('');
      setShowOtpVerificationModal(true);
      setOtpSending(true);

      try {
        const res = await dataService.generateOTP(cId, cEmail);
        if (res?.email) setOtpSentEmail(res.email);
        if (res?.code) {
          console.log(`[OTP Security Code]: ${res.code}`);
        }
      } catch (err) {
        console.error('Error generating OTP for client:', err);
      } finally {
        setOtpSending(false);
      }
      return;
    }

    await executeCheckout();
  };

  const executeCheckout = async () => {
    setLoading(true);
    try {
      let empCons = null;
      let gcRedemption = null;

      // Check for Gift Card in applied payments
      const gcItem = appliedPayments.find(p => p.method === 'Gift Card');
      if (gcItem && gcItem.giftCardInfo) {
        gcRedemption = {
          code: gcItem.giftCardCode || gcItem.giftCardInfo.code,
          amount_redeemed: parseFloat(gcItem.amount) || 0
        };
      }

      // Check for Employee Payroll Consumption
      const empItem = appliedPayments.find(p => p.method === 'Consumo Empleado');
      if (empItem) {
        const empObj = employees.find(e => e.id.toString() === selectedEmployeeForConsumption?.toString());
        empCons = {
          employee_id: empObj?.id || selectedEmployeeForConsumption || 'EMP',
          employee_name: empObj?.nombre || 'Empleado',
          monto: parseFloat(empItem.amount) || finalTotalAmount,
          servicios: lineItems.map(i => i.nombre),
          salon_id: salonId
        };
      }

      const hasPlanWash = lineItems.some(i => i.isPlanWash || (i.nombre && i.nombre.includes('Plan Beauty')));
      let finalMetodoPago = 'Efectivo';
      let finalMontoRecibido = finalTotalAmount;
      let finalDevuelta = cambioAmount;

      if (hasPlanWash && finalTotalAmount === 0) {
        finalMetodoPago = 'Plan Beauty';
      } else if (appliedPayments.length === 1) {
        finalMetodoPago = appliedPayments[0].method;
        finalMontoRecibido = parseFloat(appliedPayments[0].amount) || finalTotalAmount;
      } else if (appliedPayments.length > 1) {
        finalMetodoPago = 'Mixto (' + appliedPayments.map(p => `${p.method}: RD$ ${(parseFloat(p.amount) || 0).toFixed(2)}`).join(' + ') + ')';
        finalMontoRecibido = totalAppliedSum;
      }

      const ticketIdToUse = selectedTicket?.id || `TKT-${Date.now()}`;
      const finalClientName = clientFound?.nombre || clientFound?.name || selectedTicket?.client_name || 'Cliente General';
      const finalClientId = clientFound?.id || selectedTicket?.client_id || 'INVITADO';

      await dataService.checkoutTicket(ticketIdToUse, {
        total: finalTotalAmount,
        monto_recibido: finalMontoRecibido,
        devuelta: finalDevuelta,
        metodo_pago: finalMetodoPago,
        items_detail: lineItems,
        applied_payments: appliedPayments,
        client_id: finalClientId,
        client_name: finalClientName,
        salon_id: salonId,
        employee_consumption: empCons,
        gift_card_redemption: gcRedemption
      }).catch(err => {
        console.warn('Checkout ticket API fallback:', err);
      });

      // Update remaining washes balance immediately
      if (hasPlanWash && activePlans.length > 0) {
        const updatedPlans = [...activePlans];
        updatedPlans[0] = {
          ...updatedPlans[0],
          remaining_washes: Math.max(0, (updatedPlans[0].remaining_washes ?? 4) - 1),
          used_washes: (updatedPlans[0].used_washes || 0) + 1
        };
        setActivePlans(updatedPlans);
      }

      await loadClientVisitsHistory(finalClientId || finalClientName);

      alert(`✅ Factura finalizada exitosamente.\n\nCliente: ${finalClientName}\nTotal Facturado: RD$ ${finalTotalAmount.toFixed(2)}\nMétodos Aplicados: ${finalMetodoPago}${cambioAmount > 0 ? `\nCambio / Devuelta: RD$ ${cambioAmount.toFixed(2)}` : ''}`);
      setShowOtpVerificationModal(false);
      setShowOtpModal(false);
      setSelectedTicket(null);
      setIsTicketExpanded(false);
      setLineItems([]);
      setAppliedPayments([]);
      setMontoRecibido('');
      await fetchPendingTickets();
      await fetchTopServices();
    } catch (err) {
      alert('Error al finalizar factura: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmVoidVisit = async () => {
    if (!targetVisitToVoid) return;
    const finalReason = voidReasonCategory === 'Otro' ? voidCustomReason.trim() : `${voidReasonCategory}${voidCustomReason ? `: ${voidCustomReason.trim()}` : ''}`;
    if (!finalReason) {
      alert('Por favor indica el motivo de la anulación.');
      return;
    }

    setIsSubmittingVoid(true);
    try {
      await dataService.voidVisit(targetVisitToVoid.id, {
        reason: finalReason,
        voided_by: voidUser.trim() || 'Cajero / Admin'
      });

      alert(`✅ Factura #${targetVisitToVoid.ticket_number || targetVisitToVoid.id} anulada exitosamente.\n\nSe ha generado el registro inmutable de auditoría y ajustado el cuadre de caja.`);
      setShowVoidModal(false);
      setTargetVisitToVoid(null);
      setVoidCustomReason('');

      // Refresh history & tickets
      if (clientFound?.id || clientFound?.nombre) {
        await loadClientVisitsHistory(clientFound.id || clientFound.nombre);
      }
      await fetchPendingTickets();
      if (activeRegister) {
        await fetchActiveRegisterMovements(activeRegister.id);
      }
    } catch (err) {
      alert('Error al anular factura: ' + err.message);
    } finally {
      setIsSubmittingVoid(false);
    }
  };

  return (
    <div style={{ maxWidth: '100%', width: '100%', margin: '0 auto', padding: '0', boxSizing: 'border-box', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', background: '#ffffff', minHeight: '100%' }}>
      
      {/* HEADER / PAGE CONTROL BAR - CLEAN & ORGANIZED */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1.25rem', width: '100%', boxSizing: 'border-box', gap: '0.75rem', flexWrap: 'wrap', borderBottom: '1px solid #e4e4e7', background: '#ffffff' }}>
          {/* BRANCH / LOCALIDAD SELECTOR */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', background: '#f8fafc', padding: '0.4rem 0.75rem', borderRadius: '12px', border: '1.5px solid #cbd5e1' }}>
            <span style={{ fontSize: '0.9rem' }}>🏢</span>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '0.625rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Sucursal
              </span>
              <select
                value={salonId}
                onChange={(e) => {
                  const newId = Number(e.target.value);
                  setSalonId(newId);
                  setSelectedTicket(null);
                  setLineItems([]);
                  setClientFound(null);
                }}
                disabled={currentUser?.rol !== 'admin' && currentUser?.rol !== 'Superadmin' && !!currentUser?.salon_id}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '0.85rem',
                  fontWeight: 800,
                  color: '#0f172a',
                  cursor: (currentUser?.rol === 'admin' || currentUser?.rol === 'Superadmin' || !currentUser?.salon_id) ? 'pointer' : 'default',
                  outline: 'none',
                  padding: 0
                }}
              >
                {salonsList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {activeRegister ? (
            <div 
              onClick={() => setShowRegisterDetailsModal(true)}
              style={{ background: '#065f46', border: '1.5px solid #10b981', padding: '0.5rem 1rem', borderRadius: '12px', color: '#ffffff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.6rem' }}
              title="Haz clic para ver detalles de la caja o realizar el cierre manual"
            >
              <CheckCircle2 size={18} style={{ color: '#34d399' }} />
              <div>
                <span style={{ display: 'block', fontSize: '0.65rem', color: '#a7f3d0', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>
                  Caja Activa
                </span>
                <span style={{ fontSize: '0.85rem', fontWeight: 800 }}>{activeRegister.register_number || 'Jornada Abierta'}</span>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowRegisterOpenModal(true)}
              style={{ background: '#be185d', color: '#ffffff', border: 'none', padding: '0.65rem 1.25rem', borderRadius: '12px', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <LockIcon size={16} />
              <span>Abrir Caja de Jornada</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowPendingTicketsModal(true)}
            style={{
              background: pendingTickets.length > 0 ? '#fff1f2' : '#ffffff',
              color: pendingTickets.length > 0 ? '#be185d' : '#475569',
              border: `1.5px solid ${pendingTickets.length > 0 ? '#fbcfe8' : '#cbd5e1'}`,
              padding: '0.65rem 1.1rem',
              borderRadius: '12px',
              fontWeight: 800,
              fontSize: '0.85rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              boxShadow: '0 2px 6px rgba(0,0,0,0.03)'
            }}
            title="Ver tickets pendientes en atención"
          >
            <span style={{ fontSize: '1rem' }}>🎫</span>
            <span>Tickets Pendientes</span>
            <span style={{
              background: pendingTickets.length > 0 ? '#be185d' : '#94a3b8',
              color: '#ffffff',
              fontSize: '0.75rem',
              fontWeight: 900,
              padding: '2px 7px',
              borderRadius: '20px',
              marginLeft: '2px'
            }}>
              {pendingTickets.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => navigate('/facturas')}
            style={{ background: '#0f172a', color: '#ffffff', border: 'none', padding: '0.65rem 1.1rem', borderRadius: '12px', fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.45rem', boxShadow: '0 2px 6px rgba(15,23,42,0.18)' }}
            title="Ver el registro general de todas las facturas y ventas con filtros"
          >
            <Receipt size={16} />
            <span>Ver Facturas</span>
          </button>

          <button
            onClick={() => {
              if (!activeRegister) {
                alert('🔒 DEBE ABRIR LA CAJA DE JORNADA PRIMERO\n\nNo se pueden generar nuevos tickets si no existe una caja abierta en esta sucursal.');
                setShowRegisterOpenModal(true);
                return;
              }
              setShowNewTicketModal(true);
            }}
            style={{ background: '#be185d', color: '#ffffff', border: 'none', padding: '0.65rem 1.25rem', borderRadius: '12px', fontWeight: 800, fontSize: '0.9rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: '0 4px 12px rgba(190,24,93,0.25)' }}
          >
            <PlusCircle size={18} />
            <span>+ Generar Nuevo Ticket</span>
          </button>
        </div>

      {/* MAIN 3-COLUMN LAYOUT WITH SEAMLESS WHITE BACKGROUND & SINGLE DIVIDING LINES */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr) 340px', gap: 0, alignItems: 'stretch', width: '100%', height: 'calc(100vh - 120px)', minHeight: '620px', boxSizing: 'border-box', background: '#ffffff' }}>
        
        {/* ================= COLUMN 1: CLIENT SEARCH & DETAILED PROFILE ================= */}
        {(() => {
          const isGuestClient = Boolean(
            clientFound?.id === 'INVITADO' || 
            clientFound?.es_invitado || 
            selectedTicket?.client_id === 'INVITADO' || 
            String(clientFound?.id || '').startsWith('INVITADO')
          );
          const hasActivePlan = Boolean(!isGuestClient && activePlans && activePlans.length > 0);
          const currentClientName = clientFound?.nombre || clientFound?.name || selectedTicket?.client_name || '';
          const isClientSelected = Boolean(clientFound || selectedTicket);
          const avatarUrl = getClientAvatar(clientFound);
          const birthdayInfo = getBirthdayCountdown(clientFound);
          const renewalDate = getRenewalDateText();
          const lastVisitText = getLastVisitText();
          const benefitsCount = getBenefitsCount();

          return (
            <div style={{ background: '#ffffff', borderRight: '1px solid #e4e4e7', padding: '1.25rem', width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '0.85rem', overflowY: 'auto' }}>
              
              {/* TOP HEADER & SEARCH */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                  Cliente
                </h3>
                {isClientSelected && (
                  <button
                    type="button"
                    onClick={() => {
                      setClientFound(null);
                      setSelectedTicket(null);
                      setActivePlans([]);
                      setClientVisitsHistory([]);
                      setIsEditingGeneralName(false);
                    }}
                    style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', color: '#64748b', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', borderRadius: '8px', padding: '0.25rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                    title="Cambiar cliente"
                  >
                    <span>Cambiar</span>
                    <X size={13} />
                  </button>
                )}
              </div>

              {!isClientSelected ? (
                /* EMPTY / SEARCH STATE: NO CLIENT SELECTED */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1 }}>
                  {/* CLIENT SEARCH INPUT */}
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      placeholder="Buscar por nombre, cédula o tel..."
                      value={clientSearchTerm}
                      onChange={(e) => setClientSearchTerm(e.target.value)}
                      style={{ width: '100%', padding: '0.65rem 2.2rem 0.65rem 0.85rem', borderRadius: '12px', border: '1.5px solid #cbd5e1', fontSize: '0.825rem', fontWeight: 600, outline: 'none', background: '#ffffff', boxSizing: 'border-box' }}
                    />
                    <Search size={16} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />

                    {/* SEARCH RESULTS DROPDOWN */}
                    {clientSearchTerm.trim().length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', marginTop: '6px', zIndex: 100, maxHeight: '240px', overflowY: 'auto', boxShadow: '0 15px 25px -5px rgba(0, 0, 0, 0.12)' }}>
                        {/* QUICK ACTION: USE AS GENERAL CLIENT */}
                        <div
                          onClick={() => {
                            handleQuickGeneralClient(clientSearchTerm);
                            setClientSearchTerm('');
                          }}
                          style={{ padding: '0.75rem 1rem', cursor: 'pointer', background: '#fdf2f8', borderBottom: '1.5px solid #fbcfe8', display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#be185d', fontWeight: 800, fontSize: '0.825rem' }}
                          onMouseEnter={(e) => e.currentTarget.style.background = '#fce7f3'}
                          onMouseLeave={(e) => e.currentTarget.style.background = '#fdf2f8'}
                        >
                          <span>⚡</span>
                          <span>Facturar a <strong>"{clientSearchTerm.trim()}"</strong> (Cliente General)</span>
                        </div>

                        {allClients
                          .filter(c => {
                            const term = clientSearchTerm.toLowerCase();
                            return (
                              (c.nombre || c.name || '').toLowerCase().includes(term) ||
                              (c.cedula || '').includes(term) ||
                              (c.telefono || '').includes(term)
                            );
                          })
                          .slice(0, 8)
                          .map((client) => (
                            <div
                              key={client.id}
                              onClick={() => handleSelectClient(client)}
                              style={{ padding: '0.75rem 1rem', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '0.75rem', transition: 'background 0.15s' }}
                              onMouseEnter={(e) => e.currentTarget.style.background = '#fdf4ff'}
                              onMouseLeave={(e) => e.currentTarget.style.background = '#ffffff'}
                            >
                              <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#fae8ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a855f7', fontWeight: 800, fontSize: '0.85rem', flexShrink: 0 }}>
                                {(client.nombre || client.name || 'C').charAt(0)}
                              </div>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <strong style={{ color: '#0f172a', display: 'block', fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {client.nombre || client.name}
                                </strong>
                                <span style={{ fontSize: '0.725rem', color: '#64748b' }}>
                                  {client.cedula ? `🪪 ${client.cedula}` : ''} {client.telefono ? `📞 ${client.telefono}` : ''}
                                </span>
                              </div>
                            </div>
                          ))}
                        {allClients.filter(c => {
                          const term = clientSearchTerm.toLowerCase();
                          return (
                            (c.nombre || c.name || '').toLowerCase().includes(term) ||
                            (c.cedula || '').includes(term) ||
                            (c.telefono || '').includes(term)
                          );
                        }).length === 0 && (
                          <div style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>
                            No hay clientes registrados con "{clientSearchTerm}"
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* SIMPLE CLEAN STATE */}
                  <div style={{ padding: '3.5rem 1rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.75rem', opacity: 0.6 }}>🎫</span>
                    <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#94a3b8' }}>
                      Ticket no se ha seleccionado
                    </span>
                  </div>
                </div>
              ) : (
                /* EXACT CLIENT PROFILE CARD MATCHING USER MOCKUP */
                <div style={{
                  background: '#ffffff',
                  border: '1px solid #ede9fe',
                  borderRadius: '24px',
                  padding: '1.35rem 1.15rem 1.15rem',
                  boxShadow: '0 10px 25px -5px rgba(147, 51, 234, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.02)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0,
                  boxSizing: 'border-box'
                }}>
                  {/* CLIENT PHOTO / AVATAR WITH PINK-PURPLE HALO RING */}
                  <div style={{
                    width: '94px',
                    height: '94px',
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, #f5d0fe 0%, #fae8ff 100%)',
                    padding: '4px',
                    margin: '0 auto 0.75rem auto',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 4px 12px rgba(245, 208, 254, 0.5)'
                  }}>
                    <img 
                      src={avatarUrl}
                      alt={currentClientName}
                      style={{
                        width: '100%',
                        height: '100%',
                        borderRadius: '50%',
                        objectFit: 'cover',
                        display: 'block'
                      }}
                      onError={(e) => {
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80';
                      }}
                    />
                  </div>

                  {/* CLIENT FULL NAME (WITH INLINE EDITING FOR GENERAL CLIENTS) */}
                  {isEditingGeneralName ? (
                    <div style={{ display: 'flex', gap: '0.35rem', margin: '0 0 0.5rem 0' }}>
                      <input
                        type="text"
                        value={tempGeneralName}
                        onChange={(e) => setTempGeneralName(e.target.value)}
                        placeholder="Nombre del cliente..."
                        style={{ flex: 1, padding: '0.4rem 0.6rem', borderRadius: '8px', border: '1.5px solid #be185d', fontSize: '0.85rem', fontWeight: 700 }}
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const n = tempGeneralName.trim() || 'Cliente General';
                          setClientFound(prev => ({ ...(prev || {}), id: 'INVITADO', nombre: n, name: n, es_invitado: true }));
                          setIsEditingGeneralName(false);
                        }}
                        style={{ background: '#be185d', color: '#ffffff', border: 'none', borderRadius: '8px', padding: '0.4rem 0.65rem', fontWeight: 800, fontSize: '0.8rem', cursor: 'pointer' }}
                      >
                        ✔
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', margin: '0 0 0.45rem 0' }}>
                      <h3 style={{
                        margin: 0,
                        fontSize: '1.3rem',
                        fontWeight: 800,
                        color: '#18181b',
                        textAlign: 'center',
                        letterSpacing: '-0.02em',
                        lineHeight: 1.2
                      }}>
                        {currentClientName || 'Cliente General'}
                      </h3>
                      {isGuestClient && (
                        <button
                          type="button"
                          onClick={() => {
                            setTempGeneralName(currentClientName || '');
                            setIsEditingGeneralName(true);
                          }}
                          title="Editar nombre del cliente general"
                          style={{ background: '#fdf2f8', border: '1px solid #fbcfe8', color: '#be185d', borderRadius: '6px', padding: '2px 5px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
                        >
                          <Edit3 size={12} />
                        </button>
                      )}
                    </div>
                  )}

                  {/* PLAN STATUS PILL BADGE */}
                  <div style={{ textAlign: 'center', marginBottom: '0.25rem' }}>
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      background: isGuestClient ? '#f1f5f9' : '#fdf4ff',
                      border: isGuestClient ? '1px solid #e2e8f0' : '1px solid #fce7f3',
                      color: isGuestClient ? '#475569' : '#c026d3',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      padding: '0.3rem 0.9rem',
                      borderRadius: '9999px'
                    }}>
                      <span style={{ fontSize: '0.85rem' }}>{isGuestClient ? '👤' : (hasActivePlan ? '⭐' : '🌟')}</span>
                      <span>{isGuestClient ? 'Cliente General' : (hasActivePlan ? 'Beauty Activo' : 'Cliente Registrado')}</span>
                    </div>
                  </div>

                  {/* MIDDLE CARD: 2 BENEFICIOS DISPONIBLES & VER DETALLES */}
                  <div style={{
                    background: '#fbf8fe',
                    border: '1px solid #f3e8ff',
                    borderRadius: '20px',
                    padding: '1.25rem 1rem',
                    margin: '1.1rem 0 0.85rem 0',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.3rem'
                  }}>
                    <span style={{
                      fontSize: '2.85rem',
                      fontWeight: 900,
                      color: '#9333ea',
                      lineHeight: 1
                    }}>
                      {benefitsCount}
                    </span>

                    <span style={{
                      fontSize: '0.725rem',
                      fontWeight: 800,
                      color: '#6b7280',
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase'
                    }}>
                      BENEFICIOS DISPONIBLES
                    </span>

                    <button
                      type="button"
                      onClick={() => setShowPlanDetailsModal(true)}
                      style={{
                        marginTop: '0.55rem',
                        background: '#ffffff',
                        border: '1.5px solid #a855f7',
                        color: '#7c3aed',
                        padding: '0.45rem 1.35rem',
                        borderRadius: '9999px',
                        fontSize: '0.825rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.45rem',
                        boxShadow: '0 2px 6px rgba(168, 85, 247, 0.12)',
                        transition: 'all 0.15s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#7c3aed';
                        e.currentTarget.style.color = '#ffffff';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#ffffff';
                        e.currentTarget.style.color = '#7c3aed';
                      }}
                    >
                      <Eye size={16} />
                      <span>Ver detalles</span>
                    </button>
                  </div>

                  {/* DETAIL LIST ROW 1: BENEFICIOS RENOVADOS */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.85rem',
                    padding: '0.85rem 0.25rem',
                    borderTop: '1px solid #f3f4f6'
                  }}>
                    <div style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      background: '#dcfce7',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      <CheckCircle2 size={22} color="#16a34a" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '0.925rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.25 }}>
                        Beneficios renovados
                      </span>
                      <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 500, marginTop: '2px' }}>
                        {renewalDate}
                      </span>
                    </div>
                  </div>

                  {/* DETAIL LIST ROW 2: CUMPLEAÑOS */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.85rem',
                    padding: '0.85rem 0.25rem',
                    borderTop: '1px solid #f3f4f6'
                  }}>
                    <div style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      background: '#ffe4e6',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      <Cake size={20} color="#e11d48" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '0.925rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.25 }}>
                        {birthdayInfo.text || 'Cumpleaños en 14 días'}
                      </span>
                    </div>
                  </div>

                  {/* DETAIL LIST ROW 3: ÚLTIMA VISITA */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.85rem',
                    padding: '0.85rem 0.25rem',
                    borderTop: '1px solid #f3f4f6'
                  }}>
                    <div style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      background: '#e0f2fe',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      <ClockIcon size={20} color="#0284c7" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '0.925rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.25 }}>
                        {lastVisitText}
                      </span>
                    </div>
                  </div>

                  {/* FOOTER LINK: RECOMENDACIONES */}
                  <div 
                    onClick={() => setShowRecommendationsModal(true)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.95rem 0.25rem 0.25rem',
                      borderTop: '1px solid #f3f4f6',
                      color: '#7c3aed',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
                    onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                  >
                    <span style={{ fontWeight: 800, fontSize: '0.95rem' }}>
                      Recomendaciones
                    </span>
                    <ArrowRight size={18} />
                  </div>

                  {/* FOOTER ACTION: REGISTER GENERAL CLIENT FORMALLY */}
                  {isGuestClient && (
                    <div style={{ marginTop: '0.85rem', paddingTop: '0.75rem', borderTop: '1px solid #f3f4f6' }}>
                      <button
                        type="button"
                        onClick={() => navigate(`/registro-cliente?name=${encodeURIComponent(currentClientName || '')}`)}
                        style={{
                          width: '100%',
                          background: '#be185d',
                          border: 'none',
                          color: '#ffffff',
                          borderRadius: '12px',
                          padding: '0.65rem 0.85rem',
                          fontWeight: 800,
                          fontSize: '0.825rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.4rem',
                          boxShadow: '0 4px 12px rgba(190, 24, 93, 0.25)'
                        }}
                      >
                        <UserPlus size={16} />
                        <span>+ Registrar Nuevo Cliente</span>
                      </button>
                    </div>
                  )}

                </div>
              )}

            </div>
          );
        })()}

        {/* ================= COLUMN 2: SERVICES CATALOG & SELECTED LINE ITEMS ================= */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0, overflow: 'hidden', width: '100%', height: '100%', boxSizing: 'border-box', borderRight: '1px solid #e4e4e7', background: '#ffffff' }}>
          
          {/* TOP SECTION: AGREGA SERVICIOS (SEARCH DRIVEN + QUICK ACCESS) */}
          <div style={{ background: '#ffffff', borderBottom: '1px solid #e4e4e7', padding: '1rem 1.25rem', width: '100%', boxSizing: 'border-box', flexShrink: 0 }}>
            <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.95rem', fontWeight: 800, color: '#18181b' }}>
              Agrega servicios
            </h3>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="Buscar servicio por nombre..."
                value={searchTerm}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setTimeout(() => setIsSearchFocused(false), 250)}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ width: '100%', padding: '0.65rem 2.2rem 0.65rem 0.85rem', borderRadius: '12px', border: isSearchFocused ? '2px solid #be185d' : '1px solid #cbd5e1', fontSize: '0.85rem', fontWeight: 600, outline: 'none', background: '#ffffff', transition: 'all 0.2s ease' }}
              />
              <Search size={18} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: isSearchFocused ? '#be185d' : '#94a3b8' }} />

              {/* DROPDOWN SERVICES LIST - ONLY SHOWN WHEN SEARCHING / FOCUSED */}
              {(isSearchFocused || searchTerm.trim().length > 0) && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '14px', marginTop: '6px', zIndex: 100, maxHeight: '260px', overflowY: 'auto', boxShadow: '0 15px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)' }}>
                  {availableServices
                    .filter(s => !searchTerm.trim() || (s.nombre || '').toLowerCase().includes(searchTerm.toLowerCase()))
                    .map((s, idx) => (
                      <div
                        key={s.id || idx}
                        onMouseDown={() => {
                          addServiceToLineItems(s);
                          setSearchTerm('');
                        }}
                        style={{ padding: '0.75rem 1rem', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', fontSize: '0.825rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      >
                        <div>
                          <strong style={{ color: '#0f172a', display: 'block', fontWeight: 700 }}>{s.nombre}</strong>
                          <span style={{ fontSize: '0.725rem', color: '#64748b' }}>
                            {s.categoria || 'Servicio'} {s.aplica_itbis === 0 ? '(Exento ITBIS)' : '(18% ITBIS)'}
                          </span>
                        </div>
                        <strong style={{ color: '#be185d', fontSize: '0.9rem', fontWeight: 800 }}>
                          RD$ {(s.precio || s.precioBase || 0).toLocaleString('es-DO')}
                        </strong>
                      </div>
                    ))}
                  {availableServices.filter(s => !searchTerm.trim() || (s.nombre || '').toLowerCase().includes(searchTerm.toLowerCase())).length === 0 && (
                    <div style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>
                      No se encontraron servicios con ese nombre.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* QUICK ACCESS CHIPS: PRODUCTOS Y SERVICIOS MÁS USADOS */}
            <div style={{ marginTop: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.45rem' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Zap size={13} style={{ color: '#be185d' }} /> Acceso rápido (Más usados)
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <button
                    type="button"
                    onClick={() => scrollFavorites('left')}
                    style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '50%', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', cursor: 'pointer', padding: 0 }}
                    title="Desplazar a la izquierda"
                  >
                    <ChevronLeft size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollFavorites('right')}
                    style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '50%', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', cursor: 'pointer', padding: 0 }}
                    title="Desplazar a la derecha"
                  >
                    <ChevronRight size={13} />
                  </button>
                </div>
              </div>
              <div 
                ref={favoritesScrollRef}
                onWheel={(e) => {
                  if (favoritesScrollRef.current) {
                    favoritesScrollRef.current.scrollLeft += (e.deltaY || e.deltaX) * 1.2;
                  }
                }}
                className="hide-scrollbar" 
                style={{ 
                  display: 'flex', 
                  gap: '0.45rem', 
                  overflowX: 'auto', 
                  paddingBottom: '0.35rem', 
                  scrollBehavior: 'smooth',
                  WebkitOverflowScrolling: 'touch',
                  touchAction: 'pan-x',
                  width: '100%',
                  maxWidth: '100%'
                }}
              >
                {(availableServices.length > 0 ? availableServices : DEFAULT_TOP_SERVICES).slice(0, 15).map((srv, idx) => {
                  const nameLower = (srv.nombre || '').toLowerCase();
                  let iconEmoji = '✨';
                  if (nameLower.includes('lavado')) iconEmoji = '🧴';
                  else if (nameLower.includes('corte')) iconEmoji = '✂️';
                  else if (nameLower.includes('tinte')) iconEmoji = '🎨';
                  else if (nameLower.includes('tratamiento') || nameLower.includes('ampolla')) iconEmoji = '💆‍♀️';
                  else if (nameLower.includes('manicura') || nameLower.includes('uñas')) iconEmoji = '💅';
                  else if (nameLower.includes('pedicura')) iconEmoji = '🦶';
                  else if (nameLower.includes('maquillaje')) iconEmoji = '💄';
                  else if (nameLower.includes('shampoo') || nameLower.includes('aceite') || nameLower.includes('crema')) iconEmoji = '🛍️';

                  return (
                    <button
                      key={srv.id || idx}
                      type="button"
                      onClick={() => addServiceToLineItems(srv)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0.45rem 0.85rem',
                        borderRadius: '99px',
                        background: '#f8fafc',
                        border: '1px solid #cbd5e1',
                        color: '#0f172a',
                        fontSize: '0.775rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.15s ease',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                        flexShrink: 0
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#be185d';
                        e.currentTarget.style.color = '#ffffff';
                        e.currentTarget.style.borderColor = '#be185d';
                        e.currentTarget.style.transform = 'translateY(-1px)';
                        e.currentTarget.style.boxShadow = '0 4px 8px -1px rgba(190, 24, 93, 0.25)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#f8fafc';
                        e.currentTarget.style.color = '#0f172a';
                        e.currentTarget.style.borderColor = '#cbd5e1';
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.03)';
                      }}
                    >
                      <span style={{ fontSize: '0.85rem' }}>{iconEmoji}</span>
                      <span>{srv.nombre}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* BOTTOM SECTION: SERVICIOS SELECCIONADOS TABLE WITH INTERNAL SCROLLBAR */}
          <div style={{ background: '#ffffff', padding: '1.25rem', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#18181b' }}>
                Servicios seleccionados ({lineItems.length})
              </h3>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, border: '1px solid #f4f4f5', borderRadius: '12px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#ffffff', zIndex: 5 }}>
                  <tr style={{ borderBottom: '1px solid #e4e4e7', textAlign: 'left', color: '#71717a', fontSize: '0.7rem', textTransform: 'uppercase' }}>
                    <th style={{ padding: '0.45rem 0.6rem', fontWeight: 700 }}>Servicio</th>
                    <th style={{ padding: '0.45rem 0.6rem', fontWeight: 700 }}>Empleado</th>
                    <th style={{ padding: '0.45rem 0.6rem', fontWeight: 700, textAlign: 'right' }}>Precio</th>
                    <th style={{ padding: '0.45rem 0.6rem', fontWeight: 700, textAlign: 'center' }}>Cant.</th>
                    <th style={{ padding: '0.45rem 0.6rem', fontWeight: 700, textAlign: 'center' }}>ITBIS</th>
                    <th style={{ padding: '0.45rem 0.6rem', fontWeight: 700, textAlign: 'center' }}>Desc.</th>
                    <th style={{ padding: '0.45rem 0.6rem', fontWeight: 700, textAlign: 'right' }}>Total</th>
                    <th style={{ padding: '0.45rem 0.4rem', width: '26px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.length === 0 ? (
                    <tr>
                      <td colSpan="8" style={{ padding: '2rem', textAlign: 'center', color: '#a1a1aa' }}>
                        No hay servicios agregados. Selecciona del catálogo o favoritos arriba.
                      </td>
                    </tr>
                  ) : (
                    lineItems.map((item, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #f4f4f5' }}>
                        <td style={{ padding: '0.65rem', verticalAlign: 'middle' }}>
                          <strong style={{ color: '#18181b', display: 'block', fontSize: '0.8rem', fontWeight: 600 }}>{item.nombre}</strong>
                        </td>
                        <td style={{ padding: '0.65rem', verticalAlign: 'middle' }}>
                          <select
                            value={item.empleado_id || item.empleado || ''}
                            onChange={(e) => handleEmployeeChange(idx, e.target.value)}
                            style={{
                              padding: '0.35rem 0.45rem',
                              borderRadius: '8px',
                              border: !item.empleado_id && !item.empleado ? '1.5px dashed #cbd5e1' : '1px solid #e4e4e7',
                              fontSize: '0.75rem',
                              background: !item.empleado_id && !item.empleado ? '#fff7ed' : '#ffffff',
                              color: !item.empleado_id && !item.empleado ? '#9a3412' : '#0f172a',
                              fontWeight: 700,
                              width: '120px',
                              cursor: 'pointer',
                              outline: 'none'
                            }}
                          >
                            <option value="">Seleccionar...</option>
                            {employees.map(emp => (
                              <option key={emp.id} value={emp.id}>{emp.nombre}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: '0.65rem', textAlign: 'right', verticalAlign: 'middle', fontWeight: 600, color: '#18181b', whiteSpace: 'nowrap' }}>
                          {item.isPlanWash || item.precioBase === 0 ? (
                            <span style={{ color: '#be185d', fontWeight: 800, fontSize: '0.725rem', background: '#fdf2f8', padding: '2px 7px', borderRadius: '6px' }}>
                              Incluido
                            </span>
                          ) : (
                            `RD$ ${(Number(item.precioBase || item.precioAplicado || item.precio || 0)).toLocaleString('es-DO')}`
                          )}
                        </td>
                        <td style={{ padding: '0.65rem', textAlign: 'center', verticalAlign: 'middle' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', background: '#f4f4f5', borderRadius: '6px', padding: '2px 5px', gap: '5px' }}>
                            <button onClick={() => updateQuantity(idx, -1)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 800, fontSize: '0.8rem' }}>-</button>
                            <span style={{ fontWeight: 800, fontSize: '0.775rem', minWidth: '12px' }}>{item.cantidad}</span>
                            <button onClick={() => updateQuantity(idx, 1)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 800, fontSize: '0.8rem' }}>+</button>
                          </div>
                        </td>
                        <td style={{ padding: '0.65rem', textAlign: 'center', verticalAlign: 'middle' }}>
                          {item.isPlanWash || item.precioBase === 0 ? (
                            <span style={{ color: '#94a3b8', fontSize: '0.725rem', fontWeight: 700 }}>Exento</span>
                          ) : (
                            <select
                              value={item.aplica_itbis === 1 || item.aplica_itbis === true ? '1' : '0'}
                              onChange={(e) => handleItbisChange(idx, e.target.value)}
                              style={{
                                padding: '0.25rem 0.35rem',
                                borderRadius: '6px',
                                border: item.aplica_itbis === 1 || item.aplica_itbis === true ? '1px solid #fbcfe8' : '1px solid #e4e4e7',
                                background: item.aplica_itbis === 1 || item.aplica_itbis === true ? '#fdf2f8' : '#f8fafc',
                                color: item.aplica_itbis === 1 || item.aplica_itbis === true ? '#be185d' : '#64748b',
                                fontSize: '0.725rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                outline: 'none'
                              }}
                            >
                              <option value="0">Exento</option>
                              <option value="1">18% ITBIS</option>
                            </select>
                          )}
                        </td>
                        <td style={{ padding: '0.65rem', textAlign: 'center', verticalAlign: 'middle' }}>
                          {item.isPlanWash || item.precioBase === 0 ? (
                            <span style={{ color: '#94a3b8', fontSize: '0.8rem', fontWeight: 700 }}>-</span>
                          ) : (
                            <select
                              value={item.descuento || 0}
                              onChange={(e) => handleDiscountChange(idx, e.target.value)}
                              style={{ padding: '0.25rem', borderRadius: '6px', border: '1px solid #e4e4e7', fontSize: '0.725rem' }}
                            >
                              <option value="0">0%</option>
                              <option value="5">5%</option>
                              <option value="10">10%</option>
                              <option value="15">15%</option>
                              <option value="20">20%</option>
                              <option value="25">25%</option>
                              <option value="50">50%</option>
                            </select>
                          )}
                        </td>
                        <td style={{ padding: '0.65rem', textAlign: 'right', verticalAlign: 'middle', fontWeight: 800, color: '#18181b', whiteSpace: 'nowrap' }}>
                          {item.isPlanWash || item.precioBase === 0 ? (
                            <span style={{ color: '#be185d', fontWeight: 800 }}>RD$ 0.00</span>
                          ) : (
                            `RD$ ${(((Number(item.precioAplicado || item.precioBase || 0) * (Number(item.cantidad) || 1)) - (Number(item.descuento) || 0))).toLocaleString('es-DO', { minimumFractionDigits: 2 })}`
                          )}
                        </td>
                        <td style={{ padding: '0.65rem', textAlign: 'center', verticalAlign: 'middle' }}>
                          <button onClick={() => removeLineItem(idx)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                            <X size={15} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* ADD NOTE BUTTON */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem', flexShrink: 0 }}>
              <button
                onClick={() => {
                  const note = prompt('Ingrese una nota para este ticket:', '');
                  if (note) alert(`Nota agregada: ${note}`);
                }}
                style={{ background: '#ffffff', border: '1px solid #e4e4e7', borderRadius: '8px', padding: '0.35rem 0.75rem', fontSize: '0.75rem', fontWeight: 700, color: '#18181b', cursor: 'pointer' }}
              >
                + Agregar nota
              </button>
            </div>
          </div>
        </div>

        {/* ================= COLUMN 3: INVOICE SUMMARY & PAYMENT METHODS ================= */}
        <div style={{ background: '#ffffff', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.1rem', height: '100%', boxSizing: 'border-box', overflowY: 'auto' }}>
          
          {/* FACTURA HEADER */}
          <div style={{ borderBottom: '1px solid #e4e4e7', paddingBottom: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900, color: '#18181b' }}>
                Factura {selectedTicket?.ticket_number || 'SD-NUEVA'}
              </h3>
              <span style={{ fontSize: '0.9rem', color: '#71717a', cursor: 'pointer' }}>⚙️</span>
            </div>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.725rem', color: '#71717a' }}>
              Fecha: {new Date().toLocaleDateString('es-DO')} | {new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>

          {/* FINANCIAL SUB-TOTALS */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#71717a' }}>
              <span>Subtotal servicios</span>
              <strong style={{ color: '#18181b' }}>RD$ {grossSubtotal.toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#71717a' }}>
              <span>Productos</span>
              <strong style={{ color: '#18181b' }}>RD$ 0.00</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: totalDiscounts > 0 ? '#ef4444' : '#71717a' }}>
              <span>Descuentos {planDiscountAmount > 0 ? '(Plan Beauty)' : ''}</span>
              <strong style={{ color: totalDiscounts > 0 ? '#ef4444' : '#71717a' }}>
                - RD$ {totalDiscounts.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#71717a' }}>
              <span>ITBIS (18%)</span>
              <strong style={{ color: '#18181b' }}>RD$ {itbisAmount.toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '0.4rem', paddingTop: '0.65rem', borderTop: '1px solid #e4e4e7' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#18181b' }}>TOTAL</span>
              <span style={{ fontSize: '1.45rem', fontWeight: 900, color: '#e11d48', letterSpacing: '-0.5px', whiteSpace: 'nowrap' }}>
                RD$ {finalTotalAmount.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* PAYMENT METHOD CARDS GRID (ORIGINAL FORMAT) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 800, color: '#0f172a' }}>
                Método de pago
              </h4>
              {appliedPayments.length > 1 && (
                <span style={{ fontSize: '0.725rem', fontWeight: 800, color: '#059669', background: '#ecfdf5', padding: '2px 8px', borderRadius: '6px' }}>
                  {appliedPayments.length} Métodos Activos
                </span>
              )}
            </div>
            
            {/* ROW 1: Efectivo, Tarjeta, Transferencia */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
              {[
                { key: 'Efectivo', label: 'Efectivo', icon: Banknote },
                { key: 'Tarjeta', label: 'Tarjeta', icon: CreditCard },
                { key: 'Transferencia', label: 'Transferencia', icon: Landmark }
              ].map(({ key, label, icon: Icon }) => {
                const isSelected = appliedPayments.some(p => p.method === key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleToggleMethod(key)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.35rem',
                      padding: '0.75rem 0.35rem',
                      borderRadius: '12px',
                      border: isSelected ? '1.5px solid #10b981' : '1px solid #e2e8f0',
                      background: isSelected ? '#f0fdf4' : '#ffffff',
                      color: isSelected ? '#059669' : '#475569',
                      fontWeight: isSelected ? 700 : 600,
                      fontSize: '0.775rem',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      boxShadow: isSelected ? '0 2px 8px rgba(16, 185, 129, 0.12)' : 'none'
                    }}
                  >
                    <Icon size={20} color={isSelected ? '#10b981' : '#64748b'} strokeWidth={2} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>

            {/* ROW 2: Gift Card */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.5rem' }}>
              {[
                { key: 'Gift Card', label: 'Gift Card', icon: Gift }
              ].map(({ key, label, icon: Icon }) => {
                const isSelected = appliedPayments.some(p => p.method === key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleToggleMethod(key)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      padding: '0.65rem 0.35rem',
                      borderRadius: '12px',
                      border: isSelected ? '1.5px solid #10b981' : '1px solid #e2e8f0',
                      background: isSelected ? '#f0fdf4' : '#ffffff',
                      color: isSelected ? '#059669' : '#475569',
                      fontWeight: isSelected ? 700 : 600,
                      fontSize: '0.775rem',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      boxShadow: isSelected ? '0 2px 8px rgba(16, 185, 129, 0.12)' : 'none'
                    }}
                  >
                    <Icon size={18} color={isSelected ? '#10b981' : '#64748b'} strokeWidth={2} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>

            {/* DYNAMIC APPLIED PAYMENTS BREAKDOWN (SINGLE OR MULTI) */}
            {appliedPayments.length === 0 ? (
              <div style={{
                background: '#f8fafc',
                border: '1.5px dashed #cbd5e1',
                borderRadius: '12px',
                padding: '0.85rem',
                textAlign: 'center',
                color: '#64748b',
                fontSize: '0.775rem',
                fontWeight: 600
              }}>
                Selecciona al menos un método de pago arriba.
              </div>
            ) : appliedPayments.length === 1 && appliedPayments[0].method === 'Efectivo' ? (
              /* SINGLE CASH PAYMENT VIEW */
              (() => {
                const cashP = appliedPayments[0];
                const receivedNum = parseFloat(cashP.amount) || 0;
                const hasTyped = (cashP.amount || '').toString().trim() !== '';
                const diff = receivedNum - finalTotalAmount;
                const isMissing = hasTyped && diff < -0.01;
                const isExact = hasTyped && Math.abs(diff) <= 0.01;
                const hasChange = hasTyped && diff > 0.01;

                return (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.45rem',
                    marginTop: '0.2rem',
                    background: isMissing ? '#fef2f2' : '#f0fdf4',
                    padding: '0.75rem',
                    borderRadius: '12px',
                    border: isMissing ? '1.5px solid #ef4444' : '1.5px solid #10b981',
                    transition: 'all 0.2s ease'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontSize: '0.78rem', fontWeight: 800, color: isMissing ? '#991b1b' : '#065f46' }}>
                        💵 Monto recibido en Efectivo (RD$) *
                      </label>
                      <button
                        type="button"
                        onClick={() => handleUpdatePaymentAmount(cashP.id, finalTotalAmount > 0 ? finalTotalAmount.toFixed(2) : '')}
                        style={{ background: isMissing ? '#dc2626' : '#059669', color: '#ffffff', border: 'none', padding: '2px 8px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}
                      >
                        Monto Exacto
                      </button>
                    </div>
                    <input
                      type="number"
                      value={cashP.amount}
                      placeholder={`Ej: ${finalTotalAmount > 0 ? finalTotalAmount.toFixed(0) : "0"}`}
                      onChange={(e) => handleUpdatePaymentAmount(cashP.id, e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.65rem 0.85rem',
                        borderRadius: '8px',
                        border: isMissing ? '1.5px solid #ef4444' : '1.5px solid #059669',
                        background: '#ffffff',
                        fontSize: '1.05rem',
                        fontWeight: 800,
                        color: '#0f172a',
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                );
              })()
            ) : (
              /* MULTI-METHOD APPLIED LIST VIEW */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.2rem' }}>
                {appliedPayments.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      padding: '0.65rem 0.75rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.35rem'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#1e293b' }}>
                        {item.method === 'Efectivo' ? '💵 Efectivo' : item.method === 'Tarjeta' ? '💳 Tarjeta' : item.method === 'Transferencia' ? '🏦 Transferencia' : '🎁 Gift Card'}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveAppliedPayment(item.id)}
                        style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700, padding: '2px 4px' }}
                      >
                        ✕ Quitar
                      </button>
                    </div>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <span style={{ position: 'absolute', left: '10px', fontSize: '0.75rem', fontWeight: 800, color: '#64748b' }}>
                        RD$
                      </span>
                      <input
                        type="number"
                        value={item.amount}
                        onChange={(e) => handleUpdatePaymentAmount(item.id, e.target.value)}
                        placeholder="0.00"
                        style={{
                          width: '100%',
                          padding: '0.45rem 0.6rem 0.45rem 2.4rem',
                          borderRadius: '8px',
                          border: '1.5px solid #cbd5e1',
                          fontSize: '0.875rem',
                          fontWeight: 800,
                          color: '#0f172a',
                          background: '#ffffff',
                          outline: 'none',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>
                    {item.method === 'Gift Card' && (
                      <div style={{ marginTop: '0.2rem', display: 'flex', gap: '0.35rem' }}>
                        <input
                          type="text"
                          placeholder="Código Gift Card"
                          value={item.giftCardCode || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setAppliedPayments(prev => prev.map(p => p.id === item.id ? { ...p, giftCardCode: val } : p));
                          }}
                          style={{ flex: 1, padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.75rem' }}
                        />
                        <button
                          type="button"
                          onClick={() => handleVerifyAppliedGiftCard(item.id, item.giftCardCode)}
                          style={{ padding: '0.35rem 0.6rem', borderRadius: '6px', background: '#059669', color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.7rem', cursor: 'pointer' }}
                        >
                          Verificar
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* FINANCIAL SUMMARY: PENDIENTE & CAMBIO */}
          <div style={{ borderTop: '1px dashed #e2e8f0', margin: '0.4rem 0 0', paddingTop: '0.65rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
              <span style={{ fontWeight: 800, color: '#1e293b' }}>Pendiente</span>
              <strong style={{ fontWeight: 900, color: pendienteAmount > 0.01 ? '#e11d48' : '#18181b', fontSize: '0.95rem' }}>
                RD$ {pendienteAmount.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
              <span style={{ fontWeight: 800, color: '#1e293b' }}>Cambio / Devuelta</span>
              <strong style={{ fontWeight: 900, color: cambioAmount > 0.01 ? '#166534' : '#18181b', fontSize: '0.95rem' }}>
                RD$ {cambioAmount.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </strong>
            </div>
          </div>

          {/* FINAL ACTION BUTTONS */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem' }}>
            <button
              type="button"
              onClick={handleFinalizeCheckout}
              disabled={!isFinalizeEnabled || loading}
              style={{
                width: '100%',
                background: isFinalizeEnabled ? '#e11d48' : '#fda4af',
                color: '#ffffff',
                border: 'none',
                padding: '0.85rem',
                borderRadius: '12px',
                fontWeight: 800,
                fontSize: '0.9rem',
                cursor: isFinalizeEnabled && !loading ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
                boxShadow: isFinalizeEnabled ? '0 4px 12px rgba(225,29,72,0.25)' : 'none',
                transition: 'all 0.15s ease',
                opacity: isFinalizeEnabled ? 1 : 0.65
              }}
            >
              <span>› FINALIZAR FACTURA</span>
              <Printer size={17} />
            </button>

            <button
              type="button"
              onClick={handleCotizarProforma}
              style={{
                width: '100%',
                background: '#ffffff',
                color: '#18181b',
                border: '1px solid #e4e4e7',
                padding: '0.65rem',
                borderRadius: '12px',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem'
              }}
            >
              COTIZAR / PROFORMA
            </button>
          </div>

        </div>
      </div>

      {/* FIXED BOTTOM TOOLBAR */}
      <div style={{ position: 'fixed', bottom: 0, left: '260px', right: 0, background: '#ffffff', borderTop: '1px solid #e4e4e7', padding: '0.55rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 90, fontSize: '0.75rem', color: '#64748b' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <span>⌨️ Atajos de teclado: <strong style={{ color: '#18181b' }}>F1 Ver atajos</strong></span>
          <span>📄 Última factura: <strong style={{ color: '#18181b' }}>{clientVisitsHistory[0]?.ticket_number || 'SD-0290'}</strong></span>
          <span 
            onClick={() => {
              if (selectedTicket || clientFound || clientVisitsHistory.length > 0) {
                setPrintableTicketData({
                  ticketNumber: selectedTicket?.ticket_number || clientVisitsHistory[0]?.ticket_number || 'SD-0290',
                  salonName: 'Sucursal San Vicente de Paúl',
                  clientName: clientFound?.nombre || selectedTicket?.client_name || 'Cliente General',
                  createdAt: new Date().toLocaleDateString('es-DO') + ' ' + new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
                });
                setShowPrintModal(true);
              } else {
                alert('Selecciona un cliente o ticket activo para reimprimir.');
              }
            }}
            style={{ cursor: 'pointer', color: '#be185d', fontWeight: 700 }}
          >
            🖨️ Reimprimir
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <span>🔒 Abrir caja: <strong style={{ color: '#18181b' }}>RD$2,500.00</strong></span>
          <span>🔄 Sincronizar: <strong style={{ color: '#166534' }}>✓ Actualizado</strong></span>
        </div>
      </div>

      {/* MODAL: GENERAR NUEVO TICKET CON BÚSQUEDA INTEGRADA Y TABS */}
      {showNewTicketModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem' }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: '560px', borderRadius: '24px', padding: '1.75rem', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', position: 'relative' }}>
            
            {/* HEADER WITH CLOSE BUTTON */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: '#fdf2f8', border: '1px solid #fbcfe8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', color: '#be185d' }}>
                  🎟️
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 900, color: '#0f172a' }}>
                    Generar ticket de servicio
                  </h3>
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                    Selecciona el tipo de ticket y completa la información para generar e imprimir.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowNewTicketModal(false)}
                style={{ background: '#f1f5f9', border: 'none', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748b' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateNewTicket}>
              {/* TIPO DE TICKET SELECTOR (3 TABS) */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.725rem', fontWeight: 800, color: '#64748b', marginBottom: '0.5rem', letterSpacing: '0.5px' }}>
                  TIPO DE TICKET
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.65rem' }}>
                  
                  {/* TAB 1: CLIENTE GENERAL */}
                  <div
                    onClick={() => {
                      setTicketType('general');
                      setSelectedClientForTicket(null);
                      setSelectedEmployeeForTicket(null);
                    }}
                    style={{
                      padding: '0.85rem 0.6rem', borderRadius: '14px', cursor: 'pointer',
                      border: ticketType === 'general' ? '2px solid #ec4899' : '1.5px solid #e2e8f0',
                      background: ticketType === 'general' ? '#fff5f8' : '#ffffff',
                      boxShadow: ticketType === 'general' ? '0 4px 12px rgba(236,72,153,0.12)' : 'none',
                      transition: 'all 0.2s ease', display: 'flex', alignItems: 'center', gap: '0.5rem'
                    }}
                  >
                    <div style={{ width: '32px', height: '32px', borderRadius: '10px', background: ticketType === 'general' ? '#fbcfe8' : '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0 }}>
                      👤
                    </div>
                    <div style={{ overflow: 'hidden' }}>
                      <strong style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: ticketType === 'general' ? '#be185d' : '#0f172a', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                        Cliente general
                      </strong>
                      <span style={{ fontSize: '0.68rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                        Ticket sin perfil
                      </span>
                    </div>
                  </div>

                  {/* TAB 2: PLAN BEAUTY */}
                  <div
                    onClick={() => {
                      setTicketType('plan_beauty');
                      setSelectedEmployeeForTicket(null);
                    }}
                    style={{
                      padding: '0.85rem 0.6rem', borderRadius: '14px', cursor: 'pointer',
                      border: ticketType === 'plan_beauty' ? '2px solid #ec4899' : '1.5px solid #e2e8f0',
                      background: ticketType === 'plan_beauty' ? '#fff5f8' : '#ffffff',
                      boxShadow: ticketType === 'plan_beauty' ? '0 4px 12px rgba(236,72,153,0.12)' : 'none',
                      transition: 'all 0.2s ease', display: 'flex', alignItems: 'center', gap: '0.5rem'
                    }}
                  >
                    <div style={{ width: '32px', height: '32px', borderRadius: '10px', background: ticketType === 'plan_beauty' ? '#fbcfe8' : '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0 }}>
                      💎
                    </div>
                    <div style={{ overflow: 'hidden' }}>
                      <strong style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: ticketType === 'plan_beauty' ? '#be185d' : '#0f172a', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                        Plan Beauty
                      </strong>
                      <span style={{ fontSize: '0.68rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                        Cliente registrado
                      </span>
                    </div>
                  </div>

                  {/* TAB 3: EMPLEADO */}
                  <div
                    onClick={() => {
                      setTicketType('empleado');
                      setSelectedClientForTicket(null);
                    }}
                    style={{
                      padding: '0.85rem 0.6rem', borderRadius: '14px', cursor: 'pointer',
                      border: ticketType === 'empleado' ? '2px solid #ec4899' : '1.5px solid #e2e8f0',
                      background: ticketType === 'empleado' ? '#fff5f8' : '#ffffff',
                      boxShadow: ticketType === 'empleado' ? '0 4px 12px rgba(236,72,153,0.12)' : 'none',
                      transition: 'all 0.2s ease', display: 'flex', alignItems: 'center', gap: '0.5rem'
                    }}
                  >
                    <div style={{ width: '32px', height: '32px', borderRadius: '10px', background: ticketType === 'empleado' ? '#fbcfe8' : '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0 }}>
                      💼
                    </div>
                    <div style={{ overflow: 'hidden' }}>
                      <strong style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: ticketType === 'empleado' ? '#be185d' : '#0f172a', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                        Empleado
                      </strong>
                      <span style={{ fontSize: '0.68rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                        Descuento nómina
                      </span>
                    </div>
                  </div>

                </div>
              </div>

              {/* INNER FORM PANEL BASED ON SELECTED TAB */}
              <div style={{ background: '#fdfbfd', border: '1px solid #f1f5f9', borderRadius: '18px', padding: '1.25rem', marginBottom: '1.25rem' }}>
                {ticketType === 'general' && (
                  <div>
                    <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
                      <div style={{ width: '52px', height: '52px', borderRadius: '50%', background: '#fdf2f8', border: '1px solid #fbcfe8', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.5rem', fontSize: '1.4rem' }}>
                        👤
                      </div>
                      <h4 style={{ margin: '0 0 0.2rem', fontSize: '1.05rem', fontWeight: 900, color: '#0f172a' }}>
                        Cliente general
                      </h4>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
                        Escribe el nombre del cliente como aparecerá en el ticket.
                      </p>
                    </div>

                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', fontSize: '0.725rem', fontWeight: 800, color: '#64748b', marginBottom: '0.4rem', letterSpacing: '0.5px' }}>
                        NOMBRE DEL CLIENTE
                      </label>
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '1rem', color: '#ec4899' }}>
                          👤
                        </span>
                        <input
                          type="text"
                          required
                          placeholder="Ej: María Rodríguez"
                          value={newTicketClientName}
                          onChange={(e) => setNewTicketClientName(e.target.value)}
                          style={{ width: '100%', padding: '0.75rem 1rem 0.75rem 2.6rem', borderRadius: '12px', border: '2px solid #ec4899', fontSize: '0.9rem', fontWeight: 600, color: '#0f172a', outline: 'none', background: '#ffffff' }}
                        />
                      </div>
                    </div>

                    <div style={{ background: '#fdf2f8', border: '1px solid #fbcfe8', borderRadius: '12px', padding: '0.65rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#be185d', fontSize: '0.775rem', fontWeight: 600 }}>
                      <span>ⓘ</span>
                      <span>Este ticket no se asociará a ningún perfil de cliente.</span>
                    </div>
                  </div>
                )}

                {ticketType === 'plan_beauty' && (
                  <div>
                    <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
                      <div style={{ width: '52px', height: '52px', borderRadius: '50%', background: '#faf5ff', border: '1px solid #e9d5ff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.5rem', fontSize: '1.4rem' }}>
                        💎
                      </div>
                      <h4 style={{ margin: '0 0 0.2rem', fontSize: '1.05rem', fontWeight: 900, color: '#0f172a' }}>
                        Plan Beauty
                      </h4>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
                        Busca un cliente registrado con membresía Plan Beauty.
                      </p>
                    </div>

                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', fontSize: '0.725rem', fontWeight: 800, color: '#64748b', marginBottom: '0.4rem', letterSpacing: '0.5px' }}>
                        BUSCAR CLIENTE REGISTRADO (CÉDULA, NOMBRE O TELÉFONO)
                      </label>
                      <div style={{ position: 'relative' }}>
                        <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '1rem', color: '#a855f7' }}>
                          🔍
                        </span>
                        <input
                          type="text"
                          placeholder="Escribe para buscar cliente..."
                          value={modalClientSearchTerm}
                          onChange={(e) => {
                            setModalClientSearchTerm(e.target.value);
                            setSelectedClientForTicket(null);
                          }}
                          style={{ width: '100%', padding: '0.75rem 1rem 0.75rem 2.6rem', borderRadius: '12px', border: '2px solid #a855f7', fontSize: '0.9rem', fontWeight: 600, color: '#0f172a', outline: 'none', background: '#ffffff' }}
                        />

                        {modalClientSearchTerm.trim().length > 0 && !selectedClientForTicket && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '12px', maxHeight: '180px', overflowY: 'auto', zIndex: 10, boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', marginTop: '4px' }}>
                            {allClients
                              .filter(c => {
                                const term = modalClientSearchTerm.toLowerCase();
                                const n = (c.nombre || c.name || '').toLowerCase();
                                const cd = (c.cedula || '').toLowerCase();
                                const ph = (c.telefono || c.phone || '').toLowerCase();
                                return n.includes(term) || cd.includes(term) || ph.includes(term);
                              })
                              .slice(0, 5)
                              .map((cli) => (
                                <div
                                  key={cli.id}
                                  onClick={() => {
                                    setSelectedClientForTicket(cli);
                                    setModalClientSearchTerm(cli.nombre || cli.name);
                                    setNewTicketClientName(cli.nombre || cli.name);
                                    setNewTicketCedula(cli.cedula || '');
                                  }}
                                  style={{ padding: '0.6rem 0.8rem', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', fontSize: '0.85rem' }}
                                  className="hover-lift"
                                >
                                  <strong style={{ color: '#0f172a' }}>{cli.nombre || cli.name}</strong>
                                  <span style={{ color: '#64748b', fontSize: '0.75rem', marginLeft: '0.5rem' }}>
                                    {cli.cedula ? `Cédula: ${cli.cedula}` : ''} {cli.telefono ? `Tel: ${cli.telefono}` : ''}
                                  </span>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {selectedClientForTicket && (
                      <div style={{ background: '#faf5ff', border: '1px solid #e9d5ff', padding: '0.75rem', borderRadius: '12px', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong style={{ color: '#7e22ce', fontSize: '0.85rem' }}>
                            ✅ Cliente Seleccionado: {selectedClientForTicket.nombre || selectedClientForTicket.name}
                          </strong>
                          {selectedClientForTicket.cedula && (
                            <p style={{ margin: 0, fontSize: '0.75rem', color: '#6b21a8' }}>
                              Cédula: {selectedClientForTicket.cedula}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedClientForTicket(null);
                            setModalClientSearchTerm('');
                          }}
                          style={{ background: 'transparent', border: 'none', color: '#ef4444', fontWeight: 700, cursor: 'pointer', fontSize: '0.75rem' }}
                        >
                          Cambiar
                        </button>
                      </div>
                    )}

                    <div style={{ background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: '12px', padding: '0.65rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#7e22ce', fontSize: '0.775rem', fontWeight: 600 }}>
                      <span>ⓘ</span>
                      <span>Este ticket se asociará al perfil y membresía del cliente seleccionado.</span>
                    </div>
                  </div>
                )}

                {ticketType === 'empleado' && (
                  <div>
                    <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
                      <div style={{ width: '52px', height: '52px', borderRadius: '50%', background: '#eff6ff', border: '1px solid #bfdbfe', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.5rem', fontSize: '1.4rem' }}>
                        💼
                      </div>
                      <h4 style={{ margin: '0 0 0.2rem', fontSize: '1.05rem', fontWeight: 900, color: '#0f172a' }}>
                        Empleado
                      </h4>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
                        Selecciona el empleado para consumo o descuento por nómina.
                      </p>
                    </div>

                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', fontSize: '0.725rem', fontWeight: 800, color: '#64748b', marginBottom: '0.4rem', letterSpacing: '0.5px' }}>
                        SELECCIONAR EMPLEADO
                      </label>
                      <select
                        value={selectedEmployeeForTicket?.id || ''}
                        onChange={(e) => {
                          const emp = employees.find(emp => String(emp.id) === String(e.target.value));
                          setSelectedEmployeeForTicket(emp || null);
                        }}
                        style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: '12px', border: '2px solid #3b82f6', fontSize: '0.9rem', fontWeight: 600, color: '#0f172a', outline: 'none', background: '#ffffff' }}
                      >
                        <option value="">-- Selecciona un Empleado --</option>
                        {employees.map(emp => (
                          <option key={emp.id} value={emp.id}>
                            {emp.nombre || emp.name} {emp.cargo ? `(${emp.cargo})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '0.65rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1d4ed8', fontSize: '0.775rem', fontWeight: 600 }}>
                      <span>ⓘ</span>
                      <span>Se aplicará el descuento correspondiente según la política de empleados.</span>
                    </div>
                  </div>
                )}
              </div>

              {/* FOOTER BUTTONS */}
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => setShowNewTicketModal(false)}
                  style={{ flex: 1, padding: '0.8rem', borderRadius: '14px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#475569', fontWeight: 700, fontSize: '0.875rem', cursor: 'pointer' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  style={{ flex: 1.5, padding: '0.8rem', borderRadius: '14px', border: 'none', background: 'linear-gradient(135deg, #f43f5e 0%, #8b5cf6 100%)', color: '#ffffff', fontWeight: 800, fontSize: '0.875rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', boxShadow: '0 4px 14px rgba(244, 63, 94, 0.35)', opacity: loading ? 0.7 : 1 }}
                >
                  <span>🖨️</span>
                  <span>{loading ? 'Generando...' : 'Generar e imprimir ticket'}</span>
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* MODAL: APERTURA DE CAJA OBLIGATORIA (REGLA CAJA ÚNICA) */}
      {showRegisterOpenModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: '420px', borderRadius: '16px', padding: '1.5rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
              <LockIcon size={36} style={{ color: '#be185d', marginBottom: '0.5rem' }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>Apertura Obligatoria de Caja</h3>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>Se requiere 1 sola caja abierta para procesar facturas en el turno</p>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
                Fondo Inicial de Caja (RD$):
              </label>
              <input
                type="number"
                value={registerInitialAmount}
                onChange={(e) => setRegisterInitialAmount(e.target.value)}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 700, textAlign: 'center', fontSize: '1.1rem' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => setShowRegisterOpenModal(false)}
                style={{ flex: 1, padding: '0.65rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', fontWeight: 700 }}
              >
                Cancelar
              </button>
              <button
                onClick={handleOpenCashRegister}
                disabled={loading}
                style={{ flex: 1, padding: '0.65rem', borderRadius: '8px', border: 'none', background: '#10b981', color: '#ffffff', fontWeight: 800 }}
              >
                Confirmar Apertura
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: AUTORIZACIÓN PIN ADMINISTRADOR (DESCUENTO / PRECIO BASE) */}
      {showAdminPinModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: '400px', borderRadius: '16px', padding: '1.5rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
              <ShieldAlert size={36} style={{ color: '#be185d', marginBottom: '0.5rem' }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>Autorización de Administrador</h3>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>Se requiere PIN de administrador para aplicar este descuento</p>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <input
                type="password"
                placeholder="Ingresa Clave PIN Admin"
                value={adminPin}
                onChange={(e) => setAdminPin(e.target.value)}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 700, textAlign: 'center', fontSize: '1.2rem', letterSpacing: '4px' }}
                autoFocus
              />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => { setShowAdminPinModal(false); setPendingDiscountItem(null); setAdminPin(''); }}
                style={{ flex: 1, padding: '0.65rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', fontWeight: 700, cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                onClick={verifyAdminPin}
                style={{ flex: 1, padding: '0.65rem', borderRadius: '8px', border: 'none', background: '#be185d', color: '#ffffff', fontWeight: 800, cursor: 'pointer' }}
              >
                Autorizar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: OTP EMAIL EMPLEADO */}
      {showOtpModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: '400px', borderRadius: '16px', padding: '1.5rem', textAlign: 'center' }}>
            <Mail size={36} style={{ color: '#be185d', marginBottom: '0.5rem' }} />
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>Verificación OTP por Correo</h3>
            <p style={{ margin: '0.25rem 0 1rem', fontSize: '0.8rem', color: '#64748b' }}>Ingresa el código enviado al correo del colaborador</p>

            <input
              type="text"
              placeholder="000000"
              maxLength={6}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 800, textAlign: 'center', fontSize: '1.4rem', letterSpacing: '6px', marginBottom: '1.25rem' }}
            />

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => setShowOtpModal(false)}
                style={{ flex: 1, padding: '0.65rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', fontWeight: 700 }}
              >
                Cancelar
              </button>
              <button
                onClick={executeCheckout}
                disabled={loading || otpCode.length < 4}
                style={{ flex: 1, padding: '0.65rem', borderRadius: '8px', border: 'none', background: '#10b981', color: '#ffffff', fontWeight: 800 }}
              >
                Confirmar Consumo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: IMPRESIÓN DEL TICKET FÍSICO (HOMOLOGADO AL SALÓN) */}
      {showPrintModal && printableTicketData && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1050 }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: '420px', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ border: '2px dashed #ec4899', padding: '1.25rem', borderRadius: '12px', background: '#fffdfd', textAlign: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 900, color: '#be185d', letterSpacing: '-0.5px' }}>
                PLAN BEAUTY <span>RD</span>
              </h2>
              <p style={{ margin: '0.2rem 0 0.75rem', fontSize: '0.75rem', fontWeight: 700, color: '#ec4899', textTransform: 'uppercase' }}>
                📍 {printableTicketData.salonName}
              </p>

              <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0', textAlign: 'left', fontSize: '0.85rem' }}>
                <p style={{ margin: '0 0 0.25rem' }}><strong>🎫 Secuencia Ticket:</strong> <span style={{ color: '#be185d', fontWeight: 800 }}>{printableTicketData.ticketNumber}</span></p>
                <p style={{ margin: '0 0 0.25rem' }}><strong>👤 Cliente:</strong> {printableTicketData.clientName}</p>
                <p style={{ margin: '0 0 0.25rem' }}><strong>🕒 Fecha y Hora:</strong> {printableTicketData.createdAt}</p>
                <p style={{ margin: 0, color: '#92400e', background: '#fef3c7', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700, display: 'inline-block', marginTop: '0.25rem' }}>
                  ⏳ Estado: Permanece en Tickets Pendientes hasta facturación
                </p>
              </div>

              <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#64748b', textAlign: 'left' }}>
                <strong style={{ display: 'block', marginBottom: '0.25rem', color: '#334155' }}>📋 Casillas de Servicios (Para Estilistas / Lavado):</strong>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem', fontSize: '0.7rem' }}>
                  <span>[ ] Lavado y Secado</span>
                  <span>[ ] Corte de Puntas</span>
                  <span>[ ] Tinte Completo</span>
                  <span>[ ] Penetratti</span>
                  <span>[ ] Manicura / Pedicura</span>
                  <span>[ ] Peinado / Otros</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => setShowPrintModal(false)}
                style={{ flex: 1, padding: '0.65rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', fontWeight: 700 }}
              >
                Cerrar
              </button>
              <button
                onClick={() => window.print()}
                style={{ flex: 1, padding: '0.65rem', borderRadius: '8px', border: 'none', background: '#be185d', color: '#ffffff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
              >
                <Printer size={16} />
                <span>Imprimir Ticket</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: VER HISTORIAL COMPLETO DEL CLIENTE */}
      {showHistoryModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1060 }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: '560px', borderRadius: '16px', padding: '1.5rem', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>
                📋 Historial Completo de Visitas & Facturación
              </h3>
              <button onClick={() => setShowHistoryModal(false)} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, paddingRight: '0.5rem' }}>
              <div style={{ background: '#f8fafc', padding: '0.875rem', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '1rem' }}>
                <strong style={{ color: '#0f172a', fontSize: '0.95rem' }}>{clientFound?.nombre || selectedTicket?.client_name}</strong>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                  Cédula: {clientFound?.cedula || selectedTicket?.client_id || 'Sin cédula'} | Tel: {clientFound?.telefono || clientFound?.phone || '8097667889'}
                </p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>
                  Registro de Visitas Previas ({clientVisitsHistory.length})
                </h4>
                <button
                  onClick={() => loadClientVisitsHistory(clientFound?.id || clientFound?.nombre)}
                  style={{ background: 'none', border: 'none', color: '#be185d', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                >
                  🔄 Actualizar
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                {loadingHistory ? (
                  <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b', fontSize: '0.85rem' }}>
                    Cargando historial de visitas...
                  </div>
                ) : clientVisitsHistory.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem', background: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1', color: '#64748b', fontSize: '0.85rem' }}>
                    No se registran visitas previas en el sistema para este cliente.
                  </div>
                ) : (
                  clientVisitsHistory.map((visit, index) => {
                    let sNames = [];
                    if (visit.items_detail) {
                      try {
                        const parsed = typeof visit.items_detail === 'string' ? JSON.parse(visit.items_detail) : visit.items_detail;
                        if (Array.isArray(parsed) && parsed.length > 0) {
                          sNames = parsed.map(i => i.nombre || i.service_name || i.servicio).filter(Boolean);
                        }
                      } catch (e) {}
                    }

                    if (sNames.length === 0 && visit.servicios) {
                      try {
                        if (Array.isArray(visit.servicios)) sNames = visit.servicios;
                        else if (typeof visit.servicios === 'string' && visit.servicios.startsWith('[')) sNames = JSON.parse(visit.servicios);
                        else if (visit.servicios && visit.servicios !== 'Servicio en preparación') sNames = [String(visit.servicios)];
                      } catch (e) {}
                    }

                    const displayServiceText = sNames.length > 0 ? sNames.join(' + ') : 'Servicios Varios / Lavado';
                    const isPlanRedemption = (visit.metodo_pago && visit.metodo_pago.toLowerCase().includes('plan')) || Number(visit.total) === 0;
                    const isVoided = visit.status === 'Anulado';

                    const itemsList = (() => {
                      if (!visit.items_detail) return [];
                      try {
                        const parsed = typeof visit.items_detail === 'string' ? JSON.parse(visit.items_detail) : visit.items_detail;
                        return Array.isArray(parsed) ? parsed : [];
                      } catch (e) {
                        return [];
                      }
                    })();

                    const staffNamesList = (() => {
                      const names = new Set();
                      const isInvalidName = (n) => !n || ['n/a', 'sin asignar', 'no asignado', 'null', 'undefined', 'general', ''].includes(String(n).trim().toLowerCase());
                      if (!isInvalidName(visit.empleado_peluquera)) names.add(visit.empleado_peluquera.trim());
                      if (!isInvalidName(visit.empleado_manicurista)) names.add(visit.empleado_manicurista.trim());
                      itemsList.forEach(item => {
                        const emp = item.empleado_nombre || item.employee_name || item.empleado;
                        if (!isInvalidName(emp)) names.add(String(emp).trim());
                      });
                      return Array.from(names);
                    })();

                    const vDate = new Date(visit.visited_at || Date.now());
                    const formattedDate = vDate.toLocaleDateString('es-DO');
                    const formattedTime = vDate.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
                    const recAmt = Number(visit.monto_recibido || 0);
                    const devAmt = Number(visit.devuelta || 0);
                    const isExpanded = expandedVisitId === (visit.id || index);

                    return (
                      <div 
                        key={visit.id || index}
                        style={{ 
                          background: isVoided ? '#fef2f2' : '#ffffff', 
                          border: isVoided ? '1px solid #fecaca' : '1px solid #e2e8f0', 
                          padding: '0.85rem 1.1rem', 
                          borderRadius: '14px', 
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.55rem',
                          boxShadow: '0 2px 6px rgba(0,0,0,0.03)' 
                        }}
                      >
                        {/* HEADER: Ticket Number & Total / Badges */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1, paddingRight: '0.5rem' }}>
                            <strong style={{ fontSize: '0.9rem', color: isVoided ? '#991b1b' : '#0f172a', display: 'block', textDecoration: isVoided ? 'line-through' : 'none', fontWeight: 800 }}>
                              {visit.ticket_number || `Ticket #${String(visit.id).slice(-4)}`} - {displayServiceText}
                            </strong>
                            <span style={{ fontSize: '0.735rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.15rem' }}>
                              <span>📅 {formattedDate}</span>
                              <span>•</span>
                              <span>⌚ {formattedTime}</span>
                              <span>•</span>
                              <span>🏬 {visit.salon_nombre || 'Sucursal San Vicente'}</span>
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                            {isVoided ? (
                              <span style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', padding: '3px 8px', borderRadius: '6px', fontSize: '0.725rem', fontWeight: 800 }}>
                                🚫 ANULADA
                              </span>
                            ) : isPlanRedemption ? (
                              <span style={{ background: '#fdf2f8', color: '#be185d', border: '1px solid #fbcfe8', padding: '3px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 800 }}>
                                💎 Plan Beauty (RD$ 0.00)
                              </span>
                            ) : (
                              <span style={{ background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0', padding: '4px 10px', borderRadius: '8px', fontSize: '0.825rem', fontWeight: 900 }}>
                                RD$ {Number(visit.total || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                              </span>
                            )}

                            {!isVoided && (
                              <button
                                type="button"
                                onClick={() => {
                                  setTargetVisitToVoid(visit);
                                  setShowVoidModal(true);
                                }}
                                style={{ background: '#fff1f2', color: '#be185d', border: '1px solid #fbcfe8', padding: '4px 8px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                                title="Anular esta factura con trazabilidad de auditoría"
                              >
                                <XCircle size={12} />
                                Anular
                              </button>
                            )}
                          </div>
                        </div>

                        {/* DETALLES DE CLIENTE, PAGO Y PERSONAL QUE ATENDIÓ */}
                        <div style={{ background: isVoided ? '#fff5f5' : '#f8fafc', border: '1px solid #f1f5f9', borderRadius: '10px', padding: '0.55rem 0.75rem', fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', color: '#475569' }}>
                          {/* CLIENTE */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.25rem' }}>
                            <span style={{ fontWeight: 700, color: '#334155' }}>👤 Cliente:</span>
                            <span style={{ fontWeight: 800, color: '#0f172a' }}>
                              {visit.client_name || clientFound?.nombre || 'Cliente General'}
                            </span>
                          </div>

                          {/* PERSONAL */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span style={{ fontWeight: 700, color: '#334155' }}>💇‍♀️ Atendido por:</span>
                            <span style={{ fontWeight: 600, color: '#0f172a' }}>
                              {staffNamesList.length > 0 ? staffNamesList.join(', ') : 'Personal del Salón'}
                            </span>
                          </div>

                          {/* PAGO Y DEVUELTA */}
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem', borderTop: '1px solid #e2e8f0', paddingTop: '0.25rem', marginTop: '0.1rem' }}>
                            <span>💳 Método: <strong style={{ color: '#0f172a' }}>{visit.metodo_pago || 'Efectivo'}</strong></span>
                            {recAmt > 0 && (
                              <span>💵 Recibido: <strong style={{ color: '#0f172a' }}>RD$ {recAmt.toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong></span>
                            )}
                            {devAmt > 0 && (
                              <span>🔄 Devuelta/Cambio: <strong style={{ color: '#059669' }}>RD$ {devAmt.toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong></span>
                            )}
                          </div>

                          {isVoided && (
                            <div style={{ color: '#dc2626', fontWeight: 600, borderTop: '1px dashed #fecaca', paddingTop: '0.25rem', marginTop: '0.1rem' }}>
                              Motivo de anulación: {visit.void_reason || 'Sin motivo'} (Autorizó: {visit.voided_by || 'Admin'})
                            </div>
                          )}
                        </div>

                        {/* BOTÓN DESGLOSE DE SERVICIOS */}
                        {itemsList.length > 0 && (
                          <div>
                            <button
                              type="button"
                              onClick={() => setExpandedVisitId(isExpanded ? null : (visit.id || index))}
                              style={{ background: 'transparent', border: 'none', color: '#be185d', fontSize: '0.725rem', fontWeight: 700, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                            >
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              <span>{isExpanded ? 'Ocultar desglose de servicios' : `Ver desglose detallado (${itemsList.length} ítems)`}</span>
                            </button>

                            {isExpanded && (
                              <div style={{ marginTop: '0.5rem', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.5rem', overflowX: 'auto' }}>
                                <table style={{ width: '100%', fontSize: '0.725rem', borderCollapse: 'collapse', textAlign: 'left' }}>
                                  <thead>
                                    <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                                      <th style={{ padding: '0.3rem' }}>Servicio</th>
                                      <th style={{ padding: '0.3rem' }}>Atendido Por</th>
                                      <th style={{ padding: '0.3rem', textAlign: 'right' }}>Precio</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {itemsList.map((item, iIdx) => (
                                      <tr key={iIdx} style={{ borderBottom: iIdx === itemsList.length - 1 ? 'none' : '1px solid #f1f5f9' }}>
                                        <td style={{ padding: '0.3rem', fontWeight: 700, color: '#0f172a' }}>
                                          {item.nombre || item.service_name || item.servicio}
                                        </td>
                                        <td style={{ padding: '0.3rem', color: '#475569' }}>
                                          {item.empleado_nombre || item.employee_name || item.empleado || 'Personal Salón'}
                                        </td>
                                        <td style={{ padding: '0.3rem', textAlign: 'right', fontWeight: 800, color: '#059669' }}>
                                          RD$ {Number(item.precioAplicado || item.precio || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div style={{ marginTop: '1.25rem', paddingTop: '0.75rem', borderTop: '1px solid #f1f5f9', textAlign: 'right' }}>
              <button
                onClick={() => setShowHistoryModal(false)}
                style={{ background: '#000000', color: '#ffffff', border: 'none', padding: '0.65rem 1.5rem', borderRadius: '8px', fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer' }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE ANULACIÓN DE FACTURA (SECCIÓN 16 AUDITORÍA) */}
      {showVoidModal && targetVisitToVoid && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: '500px', borderRadius: '20px', padding: '1.75rem', boxShadow: '0 20px 40px rgba(0,0,0,0.2)', border: '1px solid #cbd5e1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '0.5rem', borderRadius: '12px', color: '#dc2626' }}>
                  <AlertTriangle size={24} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                    Anular Factura #{targetVisitToVoid.ticket_number || targetVisitToVoid.id}
                  </h3>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    Trazabilidad de Auditoría Inmutable (Sección 16)
                  </span>
                </div>
              </div>
              <button onClick={() => setShowVoidModal(false)} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '12px', padding: '0.85rem', marginBottom: '1.25rem', fontSize: '0.8rem', color: '#9f1239', lineHeight: 1.4 }}>
              <strong>⚠️ ADVERTENCIA DE CONTROL FINANCIERO:</strong>
              <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.2rem' }}>
                <li>La factura se marcará como <strong>ANULADA</strong> sin borrar sus datos.</li>
                <li>Se registrará automáticamente la reversión en la caja activa.</li>
                <li>Las comisiones de los empleados asociados quedarán anuladas.</li>
              </ul>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
                  Motivo Principal de Anulación *
                </label>
                <select
                  value={voidReasonCategory}
                  onChange={(e) => setVoidReasonCategory(e.target.value)}
                  style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.85rem', outline: 'none', background: '#f8fafc' }}
                >
                  <option value="Error de cobro / método de pago">Error de cobro / método de pago</option>
                  <option value="Cobro duplicado">Cobro duplicado</option>
                  <option value="Error en digitación de servicios">Error en digitación de servicios</option>
                  <option value="Cliente solicitó cancelación del servicio">Cliente solicitó cancelación del servicio</option>
                  <option value="Otro">Otro (Especificar en detalle)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
                  Detalles Adicionales del Motivo
                </label>
                <textarea
                  rows={3}
                  value={voidCustomReason}
                  onChange={(e) => setVoidCustomReason(e.target.value)}
                  placeholder="Escribe aquí los detalles del error o aclaración contable..."
                  style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.85rem', outline: 'none', resize: 'none' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
                  Usuario / Autorizado por
                </label>
                <input
                  type="text"
                  value={voidUser}
                  onChange={(e) => setVoidUser(e.target.value)}
                  placeholder="Ej: Administrator / Nombre Cajero"
                  style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '0.85rem', outline: 'none' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button
                type="button"
                onClick={() => setShowVoidModal(false)}
                disabled={isSubmittingVoid}
                style={{ background: '#f1f5f9', color: '#475569', border: 'none', padding: '0.65rem 1.25rem', borderRadius: '10px', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmVoidVisit}
                disabled={isSubmittingVoid}
                style={{ background: '#dc2626', color: '#ffffff', border: 'none', padding: '0.65rem 1.25rem', borderRadius: '10px', fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', boxShadow: '0 4px 12px rgba(220, 38, 38, 0.25)' }}
              >
                {isSubmittingVoid ? 'Anulando...' : 'Confirmar Anulación de Factura'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CAJA DE JORNADA (REDESIGNED TO MATCH EXACT SPECIFICATION) */}
      {showRegisterDetailsModal && activeRegister && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1070, padding: '1rem' }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: '680px', borderRadius: '24px', padding: '1.75rem', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', maxHeight: '92vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
            
            {/* HEADER */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                <div style={{ width: '44px', height: '44px', borderRadius: '14px', background: '#fdf2f8', border: '1px solid #fbcfe8', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#be185d' }}>
                  <LockIcon size={20} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900, color: '#0f172a' }}>
                      Caja de Jornada
                    </h2>
                    <span style={{ background: '#f3e8ff', color: '#7e22ce', fontSize: '0.725rem', fontWeight: 800, padding: '3px 10px', borderRadius: '99px' }}>
                      {activeRegister.register_number || `CAJA-SD-20260827-3547`}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.2rem' }}>
                    <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
                      {activeRegister.salon_name || 'Abatte Peluquería San Vicente'} • Apertura: {new Date(activeRegister.opened_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span style={{ background: '#dcfce7', color: '#15803d', fontSize: '0.68rem', fontWeight: 800, padding: '2px 8px', borderRadius: '99px', textTransform: 'uppercase' }}>
                      ABIERTA
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowRegisterDetailsModal(false)}
                style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', cursor: 'pointer', transition: 'all 0.15s ease' }}
                title="Cerrar ventana"
              >
                <X size={16} />
              </button>
            </div>

            {/* NAVIGATION TABS */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #e2e8f0', marginBottom: '1.25rem', marginTop: '0.5rem' }}>
              {[
                { id: 'resumen', label: 'Desglose de ingresos', icon: '🍰' },
                { id: 'nuevo', label: 'Registrar movimiento', icon: '📷' }
              ].map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMovementActiveTab(tab.id)}
                  style={{
                    padding: '0.85rem 0.5rem',
                    border: 'none',
                    borderBottom: movementActiveTab === tab.id ? '2px solid #be185d' : '2px solid transparent',
                    background: 'transparent',
                    color: movementActiveTab === tab.id ? '#be185d' : '#64748b',
                    fontWeight: movementActiveTab === tab.id ? 800 : 600,
                    fontSize: '0.825rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.4rem',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>

            {/* TAB 1: DESGLOSE DE INGRESOS */}
            {movementActiveTab === 'resumen' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                
                {/* SECTION 1: INGRESOS DE LA JORNADA */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
                    <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 900, color: '#0f172a' }}>
                      Ingresos de la jornada
                    </h3>
                    <span style={{ fontSize: '0.75rem', color: '#be185d', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      🕒 Actualizado en tiempo real
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    {/* CARD LEFT: DINERO RECIBIDO */}
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1rem', background: '#ffffff', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div>
                        <h4 style={{ margin: '0 0 0.85rem', fontSize: '0.75rem', fontWeight: 800, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          💵 DINERO RECIBIDO
                        </h4>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.8rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: '#475569' }}>💵 Efectivo en ventas</span>
                            <strong style={{ color: '#0f172a' }}>RD$ {(registerSummary?.efectivoTotal || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: '#475569' }}>💳 Tarjeta (Cardnet)</span>
                            <strong style={{ color: '#0f172a' }}>RD$ {(registerSummary?.tarjetaTotal || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: '#475569' }}>🏦 Transferencia</span>
                            <strong style={{ color: '#0f172a' }}>RD$ {(registerSummary?.transferenciaTotal || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: '#475569' }}>🎁 Gift Card</span>
                            <strong style={{ color: '#0f172a' }}>RD$ {(registerSummary?.giftCardTotal || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong>
                          </div>
                        </div>
                      </div>

                      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', padding: '0.75rem', marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#166534' }}>Total dinero recibido</span>
                        <strong style={{ fontSize: '0.9rem', fontWeight: 900, color: '#15803d' }}>
                          RD$ {((registerSummary?.efectivoTotal || 0) + (registerSummary?.tarjetaTotal || 0) + (registerSummary?.transferenciaTotal || 0) + (registerSummary?.giftCardTotal || 0)).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                        </strong>
                      </div>
                    </div>

                    {/* CARD RIGHT: OPERACIONES SIN EFECTIVO */}
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1rem', background: '#ffffff', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div>
                        <h4 style={{ margin: '0 0 0.85rem', fontSize: '0.75rem', fontWeight: 800, color: '#ea580c', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          ⚙️ OPERACIONES SIN EFECTIVO
                        </h4>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.8rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: '#475569' }}>💎 Plan Beauty</span>
                            <strong style={{ color: '#0f172a' }}>RD$ {(registerSummary?.planBeautyTotal || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: '#475569' }}>👤 Consumo empleados</span>
                            <strong style={{ color: '#0f172a' }}>RD$ {(registerSummary?.consumoTotal || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong>
                          </div>
                        </div>
                      </div>

                      <div style={{ background: '#fff7ed', border: '1px solid #ffedd5', borderRadius: '12px', padding: '0.75rem', marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#9a3412' }}>Total operaciones sin efectivo</span>
                        <strong style={{ fontSize: '0.9rem', fontWeight: 900, color: '#c2410c' }}>
                          RD$ {((registerSummary?.planBeautyTotal || 0) + (registerSummary?.consumoTotal || 0)).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>

                {/* SECTION 2: CAJA ESPERADA (EFECTIVO EN CAJA) */}
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem', background: '#faf5ff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#f3e8ff', color: '#7e22ce', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}>
                      👛
                    </div>
                    <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 900, color: '#0f172a' }}>
                      Caja esperada (efectivo en caja)
                    </h4>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8', cursor: 'pointer' }} title="Fórmula: Inicial + Efectivo + Entradas - Gastos - Retiros">ℹ️</span>
                  </div>

                  {/* FORMULA PILLS */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.35rem', overflowX: 'auto', paddingBottom: '0.35rem' }}>
                    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', padding: '0.6rem 0.75rem', borderRadius: '12px', textAlign: 'center', minWidth: '90px', flex: 1 }}>
                      <span style={{ fontSize: '0.675rem', color: '#64748b', fontWeight: 700, display: 'block' }}>Inicial</span>
                      <strong style={{ fontSize: '0.85rem', color: '#0f172a', fontWeight: 800 }}>
                        RD$ {(registerSummary?.montoInicial || activeRegister.monto_inicial || 1000).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </strong>
                    </div>

                    <span style={{ color: '#94a3b8', fontWeight: 800, fontSize: '0.9rem' }}>+</span>

                    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', padding: '0.6rem 0.75rem', borderRadius: '12px', textAlign: 'center', minWidth: '90px', flex: 1 }}>
                      <span style={{ fontSize: '0.675rem', color: '#64748b', fontWeight: 700, display: 'block' }}>Efectivo en ventas</span>
                      <strong style={{ fontSize: '0.85rem', color: '#0f172a', fontWeight: 800 }}>
                        RD$ {(registerSummary?.efectivoTotal || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </strong>
                    </div>

                    <span style={{ color: '#94a3b8', fontWeight: 800, fontSize: '0.9rem' }}>+</span>

                    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', padding: '0.6rem 0.75rem', borderRadius: '12px', textAlign: 'center', minWidth: '90px', flex: 1 }}>
                      <span style={{ fontSize: '0.675rem', color: '#16a34a', fontWeight: 700, display: 'block' }}>Entradas</span>
                      <strong style={{ fontSize: '0.85rem', color: '#16a34a', fontWeight: 800 }}>
                        RD$ {(registerSummary?.entradasTotal || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </strong>
                    </div>

                    <span style={{ color: '#94a3b8', fontWeight: 800, fontSize: '0.9rem' }}>-</span>

                    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', padding: '0.6rem 0.75rem', borderRadius: '12px', textAlign: 'center', minWidth: '90px', flex: 1 }}>
                      <span style={{ fontSize: '0.675rem', color: '#dc2626', fontWeight: 700, display: 'block' }}>Gastos</span>
                      <strong style={{ fontSize: '0.85rem', color: '#dc2626', fontWeight: 800 }}>
                        RD$ {(registerSummary?.gastosTotal || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </strong>
                    </div>

                    <span style={{ color: '#94a3b8', fontWeight: 800, fontSize: '0.9rem' }}>-</span>

                    <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', padding: '0.6rem 0.75rem', borderRadius: '12px', textAlign: 'center', minWidth: '90px', flex: 1 }}>
                      <span style={{ fontSize: '0.675rem', color: '#dc2626', fontWeight: 700, display: 'block' }}>Retiros</span>
                      <strong style={{ fontSize: '0.85rem', color: '#dc2626', fontWeight: 800 }}>
                        RD$ {(registerSummary?.retirosTotal || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </strong>
                    </div>

                    <span style={{ color: '#94a3b8', fontWeight: 800, fontSize: '0.9rem' }}>=</span>

                    <div style={{ background: '#ffffff', border: '1.5px solid #d8b4fe', padding: '0.6rem 0.75rem', borderRadius: '12px', textAlign: 'center', minWidth: '115px', flex: 1.2 }}>
                      <span style={{ fontSize: '0.675rem', color: '#7e22ce', fontWeight: 800, display: 'block' }}>Total caja esperada</span>
                      <strong style={{ fontSize: '1rem', color: '#7e22ce', fontWeight: 900 }}>
                        RD$ {(registerSummary?.montoEstimadoEnCaja || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </strong>
                    </div>
                  </div>

                  <div style={{ textAlign: 'center', marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={() => setShowDetailedBreakdown(!showDetailedBreakdown)}
                      style={{ background: 'transparent', border: 'none', color: '#7e22ce', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
                    >
                      {showDetailedBreakdown ? 'Ocultar desglose ▲' : 'Ver desglose detallado ∨'}
                    </button>
                  </div>

                  {showDetailedBreakdown && (
                    <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px dashed #d8b4fe', display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.75rem', color: '#475569' }}>
                      <div>💵 Monto Inicial de Apertura: <strong>RD$ {(registerSummary?.montoInicial || activeRegister.monto_inicial || 1000).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong></div>
                      <div>🛒 Total Ventas en Efectivo: <strong>+ RD$ {(registerSummary?.efectivoTotal || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong></div>
                      <div>📥 Entradas Adicionales de Caja: <strong>+ RD$ {(registerSummary?.entradasTotal || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong></div>
                      <div>💸 Gastos Imprevistos en Efectivo: <strong>- RD$ {(registerSummary?.gastosTotal || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong></div>
                      {(registerSummary?.prestamosTotal > 0) && (
                        <div>🤝 De los cuales Préstamos a Empleados: <strong style={{ color: '#be185d' }}>- RD$ {(registerSummary.prestamosTotal).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong></div>
                      )}
                      <div>📤 Retiros de Efectivo / Sangrías: <strong>- RD$ {(registerSummary?.retirosTotal || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</strong></div>
                    </div>
                  )}
                </div>

                {/* SECTION 3: ARQUEO DE CAJA */}
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '16px', padding: '1.25rem', background: '#ffffff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#f5f3ff', color: '#6d28d9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}>
                      🛡️
                    </div>
                    <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 900, color: '#0f172a' }}>
                      Arqueo de caja
                    </h4>
                  </div>
                  <p style={{ margin: '0 0 1rem 0', fontSize: '0.75rem', color: '#64748b' }}>
                    Ingresa el efectivo contado para verificar la diferencia.
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.3fr 1.1fr', gap: '1rem', alignItems: 'center' }}>
                    {/* EFECTIVO ESPERADO */}
                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '0.85rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700, display: 'block' }}>Efectivo esperado</span>
                        <strong style={{ fontSize: '1.05rem', color: '#0f172a', fontWeight: 900 }}>
                          RD$ {(registerSummary?.montoEstimadoEnCaja || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                        </strong>
                      </div>
                      <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#f3e8ff', color: '#7e22ce', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem' }}>
                        🧮
                      </div>
                    </div>

                    {/* EFECTIVO CONTADO INPUT */}
                    <div style={{ background: '#ffffff', border: '1.5px solid #cbd5e1', borderRadius: '14px', padding: '0.65rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#64748b' }}>RD$</span>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={closeRegisterAmount}
                        onChange={(e) => setCloseRegisterAmount(e.target.value)}
                        style={{ width: '100%', border: 'none', outline: 'none', fontSize: '1.15rem', fontWeight: 900, textAlign: 'right', color: '#0f172a', background: 'transparent' }}
                      />
                    </div>

                    {/* DIFERENCIA */}
                    {(() => {
                      const declared = parseFloat(closeRegisterAmount) || 0;
                      const expected = registerSummary?.montoEstimadoEnCaja || Number(activeRegister.monto_inicial || 0);
                      const diff = closeRegisterAmount === '' ? 0 : declared - expected;
                      const isSquare = Math.abs(diff) < 0.01;
                      return (
                        <div style={{ background: isSquare ? '#f0fdf4' : '#fef2f2', border: `1px solid ${isSquare ? '#bbf7d0' : '#fca5a5'}`, borderRadius: '14px', padding: '0.85rem 1rem' }}>
                          <span style={{ fontSize: '0.7rem', color: isSquare ? '#166534' : '#991b1b', fontWeight: 700, display: 'block' }}>Diferencia</span>
                          <strong style={{ fontSize: '1.05rem', color: isSquare ? '#15803d' : '#dc2626', fontWeight: 900, display: 'block' }}>
                            RD$ {diff.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                          </strong>
                          <span style={{ fontSize: '0.675rem', fontWeight: 800, color: isSquare ? '#15803d' : '#dc2626', display: 'flex', alignItems: 'center', gap: '0.2rem', marginTop: '2px' }}>
                            {isSquare ? '✔ Caja cuadrada' : '⚠ Descuadre de caja'}
                          </span>
                        </div>
                      );
                    })()}
                  </div>

                  <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '10px', padding: '0.65rem 0.85rem', marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.725rem', color: '#0369a1', fontWeight: 600 }}>
                    <span>ℹ</span>
                    <span>Si la diferencia es distinta de 0, deberás indicar el motivo antes de cerrar la caja.</span>
                  </div>
                </div>

              </div>
            )}

            {/* TAB 2: REGISTRAR MOVIMIENTO */}
            {movementActiveTab === 'nuevo' && (
              <form onSubmit={handleSaveManualMovement} style={{ padding: '0.5rem 0' }}>
                <h4 style={{ margin: '0 0 0.85rem', fontSize: '0.9rem', fontWeight: 900, color: '#0f172a' }}>
                  📷 Registrar movimiento manual de caja
                </h4>

                <div style={{ marginBottom: '0.875rem' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.3rem' }}>
                    Tipo de movimiento:
                  </label>
                  <select
                    value={newMovementType}
                    onChange={(e) => {
                      setNewMovementType(e.target.value);
                      if (e.target.value === 'Prestamo_Empleado' && !newMovementConcept) {
                        setNewMovementConcept('Préstamo / Adelanto de nómina');
                      }
                    }}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 700, fontSize: '0.85rem' }}
                  >
                    <option value="Gasto_Imprevisto">💸 Gasto imprevisto (Salida de dinero)</option>
                    <option value="Prestamo_Empleado">🤝 Préstamo a empleado (Salida de dinero / Gasto)</option>
                    <option value="Retiro_Efectivo">📤 Retiro de efectivo / Sangría (Salida de caja)</option>
                    <option value="Entrada_Adicional">📥 Entrada adicional (Ingreso a caja)</option>
                  </select>
                </div>

                {/* SELECTOR DE EMPLEADO (SI ES PRÉSTAMO) */}
                {newMovementType === 'Prestamo_Empleado' && (
                  <div style={{ marginBottom: '0.875rem', background: '#fdf2f8', border: '1.5px solid #fbcfe8', borderRadius: '14px', padding: '0.85rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <label style={{ fontSize: '0.8rem', fontWeight: 800, color: '#be185d' }}>
                        Empleado beneficiario del préstamo *:
                      </label>
                      <span style={{ fontSize: '0.7rem', color: '#be185d', fontWeight: 700 }}>
                        {employees.length} empleados registrados
                      </span>
                    </div>
                    <select
                      value={movementEmployeeId}
                      onChange={(e) => setMovementEmployeeId(e.target.value)}
                      required={newMovementType === 'Prestamo_Empleado'}
                      style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1.5px solid #be185d', fontWeight: 700, fontSize: '0.85rem', background: '#ffffff' }}
                    >
                      <option value="">-- Seleccionar Empleado --</option>
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.nombre || emp.name} {emp.rol ? `· (${emp.rol})` : ''} {emp.cedula ? `· [${emp.cedula}]` : ''}
                        </option>
                      ))}
                    </select>
                    <span style={{ fontSize: '0.72rem', color: '#831843', marginTop: '4px', display: 'block' }}>
                      💡 Este préstamo se registrará como salida de caja y quedará vinculado al expediente del empleado.
                    </span>
                  </div>
                )}

                <div style={{ marginBottom: '0.875rem' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.3rem' }}>
                    Monto (RD$):
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={newMovementAmount}
                    onChange={(e) => setNewMovementAmount(e.target.value)}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 800, fontSize: '1.05rem' }}
                    required
                  />
                </div>

                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.3rem' }}>
                    Observaciones / Concepto:
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Ej: Préstamo para emergencia médica / adelanto de quincena..."
                    value={newMovementConcept}
                    onChange={(e) => setNewMovementConcept(e.target.value)}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '1px solid #cbd5e1', fontWeight: 600, fontSize: '0.85rem' }}
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  style={{ width: '100%', padding: '0.85rem', borderRadius: '12px', border: 'none', background: '#be185d', color: '#ffffff', fontWeight: 800, fontSize: '0.9rem', cursor: 'pointer' }}
                >
                  💾 Guardar movimiento en caja
                </button>
              </form>
            )}



            {/* FOOTER ACTIONS */}
            <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button
                  type="button"
                  onClick={() => setShowRegisterDetailsModal(false)}
                  style={{ width: '180px', padding: '0.85rem 1rem', borderRadius: '12px', border: '1px solid #cbd5e1', background: '#ffffff', fontWeight: 700, color: '#334155', cursor: 'pointer', fontSize: '0.875rem' }}
                >
                  Cerrar ventana
                </button>
                <button
                  type="button"
                  onClick={handleCloseCashRegister}
                  disabled={loading || closeRegisterAmount === ''}
                  style={{
                    flex: 1,
                    padding: '0.85rem 1.25rem',
                    borderRadius: '12px',
                    border: 'none',
                    background: 'linear-gradient(to right, #be185d, #7c3aed)',
                    color: '#ffffff',
                    fontWeight: 800,
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    boxShadow: '0 4px 14px rgba(190, 24, 93, 0.35)',
                    opacity: (loading || closeRegisterAmount === '') ? 0.6 : 1
                  }}
                >
                  <LockIcon size={18} />
                  <span>Cerrar caja de jornada</span>
                </button>
              </div>
              <span style={{ fontSize: '0.725rem', color: '#64748b', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', fontWeight: 500 }}>
                🔒 Una vez cerrada, esta jornada no podrá recibir nuevos movimientos.
              </span>
            </div>

          </div>
        </div>
      )}

      {/* MODAL CIERRE Y ARQUEO DE CAJA */}
      {showConfirmCloseModal && activeRegister && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: '520px', borderRadius: '20px', padding: '1.75rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
              <LockIcon size={38} style={{ color: '#dc2626', marginBottom: '0.4rem' }} />
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                Arqueo y Cierre de Caja de Jornada
              </h3>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                Caja {activeRegister.register_number} • Cajero: {activeRegister.employee_name || currentUser?.nombre || 'Cajero Principal'}
              </p>
            </div>

            {/* PRE-CLOSING AUDIT SUMMARY BOX */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1rem', marginBottom: '1.25rem' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>
                📊 Resumen Previo al Cierre:
              </h4>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', fontSize: '0.78rem' }}>
                <div>💵 Efectivo: <strong>RD$ {(registerSummary?.efectivoTotal || 0).toFixed(2)}</strong></div>
                <div>💳 Tarjeta: <strong>RD$ {(registerSummary?.tarjetaTotal || 0).toFixed(2)}</strong></div>
                <div>🏦 Transferencia: <strong>RD$ {(registerSummary?.transferenciaTotal || 0).toFixed(2)}</strong></div>
                <div>🎁 Gift Card: <strong>RD$ {(registerSummary?.giftCardTotal || 0).toFixed(2)}</strong></div>
                <div>✨ Plan Beauty: <strong>RD$ {(registerSummary?.planBeautyTotal || 0).toFixed(2)}</strong></div>
                <div>👤 Consumo Empleados: <strong>RD$ {(registerSummary?.consumoTotal || 0).toFixed(2)}</strong></div>
              </div>

              <div style={{ marginTop: '0.6rem', paddingTop: '0.5rem', borderTop: '1px dashed #cbd5e1', display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.8rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#dc2626', fontWeight: 700 }}>💸 Total Salidas / Gastos de Caja:</span>
                  <strong style={{ color: '#dc2626' }}>- RD$ {(registerSummary?.gastosTotal || 0).toFixed(2)}</strong>
                </div>
                {(registerSummary?.prestamosTotal > 0) && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#be185d', paddingLeft: '0.5rem' }}>
                    <span>🤝 Incluye Préstamos a Empleados:</span>
                    <strong>- RD$ {(registerSummary.prestamosTotal).toFixed(2)}</strong>
                  </div>
                )}
              </div>

              <div style={{ marginTop: '0.4rem', paddingTop: '0.4rem', borderTop: '1px solid #cbd5e1', display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                <span style={{ color: '#0f172a', fontWeight: 800 }}>💰 Monto Total Esperado en Caja:</span>
                <strong style={{ color: '#166534', fontSize: '1rem', fontWeight: 900 }}>
                  RD$ {(registerSummary?.montoEstimadoEnCaja || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                </strong>
              </div>
            </div>

            {/* INPUT: CASH COUNTED PHYSICALLY */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.3rem' }}>
                💵 Dinero Contado Físicamente en Caja (RD$):
              </label>
              <input
                type="number"
                placeholder="0.00"
                value={closeRegisterAmount}
                onChange={(e) => setCloseRegisterAmount(e.target.value)}
                style={{ width: '100%', padding: '0.65rem', borderRadius: '10px', border: '2px solid #cbd5e1', fontWeight: 900, fontSize: '1.2rem', textAlign: 'center', color: '#0f172a' }}
              />
            </div>

            {/* LIVE DIFFERENCE CALCULATION FEEDBACK */}
            {closeRegisterAmount !== '' && (() => {
              const declared = parseFloat(closeRegisterAmount) || 0;
              const expected = registerSummary?.montoEstimadoEnCaja || Number(activeRegister.monto_inicial || 0);
              const diff = declared - expected;
              return (
                <div style={{
                  padding: '0.75rem',
                  borderRadius: '10px',
                  marginBottom: '1rem',
                  textAlign: 'center',
                  background: Math.abs(diff) < 0.01 ? '#f0fdf4' : diff > 0 ? '#f0f9ff' : '#fef2f2',
                  border: `1px solid ${Math.abs(diff) < 0.01 ? '#86efac' : diff > 0 ? '#bae6fd' : '#fca5a5'}`
                }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', display: 'block' }}>
                    {Math.abs(diff) < 0.01 ? '🟢 CUADRE PERFECTO' : diff > 0 ? '🔷 SOBRANTE DE CAJA' : '🔴 FALTANTE DE CAJA'}
                  </span>
                  <div style={{ fontSize: '1.15rem', fontWeight: 900, color: Math.abs(diff) < 0.01 ? '#15803d' : diff > 0 ? '#0369a1' : '#dc2626' }}>
                    Diferencia: {diff >= 0 ? '+' : ''} RD$ {diff.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                  </div>
                </div>
              );
            })()}

            {/* INPUT: CLOSING NOTES / OBSERVATIONS */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.3rem' }}>
                📝 Observaciones del Cierre:
              </label>
              <textarea
                rows={2}
                placeholder="Notas de arqueo, justificación de sobrante/faltante u observaciones del turno..."
                value={closeRegisterNotes}
                onChange={(e) => setCloseRegisterNotes(e.target.value)}
                style={{ width: '100%', padding: '0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 600, fontSize: '0.85rem' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => setShowConfirmCloseModal(false)}
                style={{ flex: 1, padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', background: '#ffffff', fontWeight: 700, cursor: 'pointer', color: '#475569' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleCloseCashRegister}
                disabled={loading || closeRegisterAmount === ''}
                style={{ flex: 1, padding: '0.75rem', borderRadius: '10px', border: 'none', background: '#dc2626', color: '#ffffff', fontWeight: 800, cursor: 'pointer', opacity: (loading || closeRegisterAmount === '') ? 0.6 : 1 }}
              >
                Finalizar y Cerrar Caja
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ================= MODAL: OTP SECURITY CODE VERIFICATION ================= */}
      {showOtpVerificationModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem' }}>
          <div style={{ background: '#ffffff', borderRadius: '20px', width: '100%', maxWidth: '440px', padding: '1.75rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)' }}>
            
            {/* MODAL HEADER */}
            <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
              <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#fdf2f8', border: '2px solid #fbcfe8', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.75rem', fontSize: '1.5rem' }}>
                🔐
              </div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900, color: '#0f172a' }}>
                Verificación de Seguridad
              </h3>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: '#64748b', lineHeight: 1.4 }}>
                Autorizar consumo de <strong style={{ color: '#0f172a' }}>{pendingPlanService?.nombre}</strong>
              </p>
            </div>

            {/* CLIENT EMAIL NOTICE */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.75rem', marginBottom: '1.25rem', textAlign: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: '0.15rem' }}>
                Código enviado al correo registrado:
              </span>
              <strong style={{ fontSize: '0.85rem', color: '#be185d', wordBreak: 'break-all' }}>
                ✉️ {otpSentEmail || clientFound?.email || selectedTicket?.client_email || '(Sin correo registrado)'}
              </strong>
            </div>

            {!adminCodeBypass ? (
              <>
                {/* OTP INPUT */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'block', fontSize: '0.775rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.4rem', textAlign: 'center' }}>
                    INGRESE EL CÓDIGO DE 6 DÍGITOS
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="------"
                    value={otpCodeInput}
                    onChange={(e) => setOtpCodeInput(e.target.value.replace(/[^0-9]/g, ''))}
                    autoFocus
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '12px', border: '2px solid #be185d', fontSize: '1.75rem', fontWeight: 900, textAlign: 'center', letterSpacing: '8px', color: '#0f172a', outline: 'none', background: '#fff' }}
                  />
                </div>

                {/* HELPER ACTIONS */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', fontSize: '0.75rem' }}>
                  <button
                    onClick={handleResendOtpCode}
                    disabled={otpSending}
                    style={{ background: 'none', border: 'none', color: '#be185d', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                  >
                    {otpSending ? 'Enviando...' : '🔄 Reenviar código'}
                  </button>
                  <button
                    onClick={() => setAdminCodeBypass(true)}
                    style={{ background: 'none', border: 'none', color: '#64748b', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                  >
                    🔑 Clave Gerencial
                  </button>
                </div>
              </>
            ) : (
              /* GERENCIAL PIN BYPASS FORM */
              <div style={{ marginBottom: '1.25rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', padding: '0.85rem' }}>
                <label style={{ display: 'block', fontSize: '0.775rem', fontWeight: 800, color: '#991b1b', marginBottom: '0.4rem', textAlign: 'center' }}>
                  CLAVE DE AUTORIZACIÓN GERENCIAL
                </label>
                <input
                  type="password"
                  placeholder="PIN Gerencial"
                  value={adminBypassPin}
                  onChange={(e) => setAdminBypassPin(e.target.value)}
                  autoFocus
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '10px', border: '1px solid #f87171', fontSize: '1.2rem', fontWeight: 800, textAlign: 'center', outline: 'none', color: '#991b1b' }}
                />
                <button
                  onClick={() => setAdminCodeBypass(false)}
                  style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: '0.725rem', fontWeight: 700, cursor: 'pointer', marginTop: '0.5rem', width: '100%', textAlign: 'center' }}
                >
                  ← Volver a código por correo
                </button>
              </div>
            )}

            {/* ACTION BUTTONS */}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => {
                  setShowOtpVerificationModal(false);
                  setPendingPlanService(null);
                }}
                style={{ flex: 1, padding: '0.75rem', borderRadius: '12px', border: '1px solid #cbd5e1', background: '#ffffff', fontWeight: 700, cursor: 'pointer', color: '#475569', fontSize: '0.85rem' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleVerifyOtpAndAddPlanService}
                disabled={otpVerifying || (!adminCodeBypass && otpCodeInput.length < 4)}
                style={{ flex: 1.3, padding: '0.75rem', borderRadius: '12px', border: 'none', background: '#000000', color: '#ffffff', fontWeight: 900, cursor: 'pointer', fontSize: '0.85rem', opacity: (otpVerifying || (!adminCodeBypass && otpCodeInput.length < 4)) ? 0.6 : 1 }}
              >
                {otpVerifying ? 'Verificando...' : 'Verificar y Facturar'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ================= MODAL: PENDING TICKETS IN QUEUE ================= */}
      {showPendingTicketsModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1.25rem' }}>
          <div style={{ background: '#ffffff', borderRadius: '24px', width: '100%', maxWidth: '780px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
            
            {/* MODAL HEADER */}
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <div style={{ width: '38px', height: '38px', borderRadius: '12px', background: '#fdf2f8', border: '1px solid #fbcfe8', color: '#be185d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', fontWeight: 800 }}>
                  🎫
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 900, color: '#0f172a' }}>
                      Tickets Pendientes en Atención
                    </h3>
                    <span style={{ background: '#be185d', color: '#ffffff', fontSize: '0.725rem', fontWeight: 900, padding: '2px 8px', borderRadius: '20px' }}>
                      {pendingTickets.length} {pendingTickets.length === 1 ? 'ticket' : 'tickets'}
                    </span>
                  </div>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '0.775rem', color: '#64748b' }}>
                    Selecciona una atención en curso para abrir su factura o inicia una nueva
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowPendingTicketsModal(false)}
                style={{ background: '#e2e8f0', border: 'none', color: '#64748b', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontWeight: 800, fontSize: '0.9rem' }}
              >
                ✕
              </button>
            </div>

            {/* ACTION BAR INSIDE MODAL */}
            <div style={{ padding: '0.75rem 1.5rem', background: '#ffffff', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => {
                  handleStartBlankTicket();
                  setShowPendingTicketsModal(false);
                }}
                style={{ background: '#0f172a', color: '#ffffff', border: 'none', padding: '0.5rem 1rem', borderRadius: '10px', fontSize: '0.8rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <span>+ Factura Directa / En Blanco</span>
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={fetchPendingTickets}
                  style={{ background: '#f8fafc', border: '1px solid #cbd5e1', padding: '0.5rem 0.85rem', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', color: '#475569', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                  <span>Refrescar Lista</span>
                </button>
              </div>
            </div>

            {/* SEARCH INPUT BAR INSIDE MODAL */}
            <div style={{ padding: '0.65rem 1.5rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
                <input
                  type="text"
                  placeholder="🔍 Escribe el # de ticket (ej: SD-0310) o nombre de cliente..."
                  value={ticketSearchTerm}
                  onChange={(e) => setTicketSearchTerm(e.target.value)}
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '0.6rem 2.2rem 0.6rem 2.25rem',
                    borderRadius: '10px',
                    border: '1.5px solid #cbd5e1',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    color: '#0f172a',
                    outline: 'none',
                    background: '#ffffff',
                    boxSizing: 'border-box'
                  }}
                />
                {ticketSearchTerm && (
                  <button
                    type="button"
                    onClick={() => setTicketSearchTerm('')}
                    style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: '#cbd5e1', border: 'none', color: '#475569', borderRadius: '50%', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 800 }}
                    title="Limpiar búsqueda"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* MODAL BODY (TICKETS LIST GRID) */}
            <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1, background: '#f8fafc' }}>
              {(() => {
                const searchLower = ticketSearchTerm.toLowerCase().trim();
                const searchDigits = searchLower.replace(/\D/g, '');

                const filteredTickets = pendingTickets.filter(t => {
                  if (!searchLower) return true;
                  const tNum = (t.ticket_number || `SD-${String(t.id).slice(-4)}`).toLowerCase();
                  const cName = (t.client_name || '').toLowerCase();
                  const tId = String(t.id || '').toLowerCase();

                  return (
                    tNum.includes(searchLower) ||
                    cName.includes(searchLower) ||
                    tId.includes(searchLower) ||
                    (searchDigits.length > 0 && tNum.includes(searchDigits))
                  );
                });

                if (pendingTickets.length === 0) {
                  return (
                    <div style={{ background: '#ffffff', border: '2px dashed #cbd5e1', borderRadius: '16px', padding: '2.5rem 1.5rem', textAlign: 'center', color: '#64748b' }}>
                      <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>✨</div>
                      <h4 style={{ margin: '0 0 0.35rem', color: '#1e293b', fontWeight: 800, fontSize: '1rem' }}>No hay tickets en espera</h4>
                      <p style={{ margin: 0, fontSize: '0.825rem', color: '#64748b' }}>
                        Todas las atenciones de la sucursal se encuentran facturadas y cerradas.
                      </p>
                    </div>
                  );
                }

                if (filteredTickets.length === 0) {
                  return (
                    <div style={{ background: '#ffffff', border: '2px dashed #fca5a5', borderRadius: '16px', padding: '2rem 1.5rem', textAlign: 'center', color: '#991b1b' }}>
                      <div style={{ fontSize: '2.2rem', marginBottom: '0.35rem' }}>🔍</div>
                      <h4 style={{ margin: '0 0 0.35rem', fontWeight: 800, fontSize: '0.95rem' }}>No se encontró ningún ticket</h4>
                      <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: '#7f1d1d' }}>
                        No hay coincidencias para "{ticketSearchTerm}"
                      </p>
                      <button
                        type="button"
                        onClick={() => setTicketSearchTerm('')}
                        style={{ background: '#be185d', color: '#ffffff', border: 'none', padding: '0.45rem 1rem', borderRadius: '8px', fontSize: '0.775rem', fontWeight: 800, cursor: 'pointer' }}
                      >
                        Limpiar búsqueda
                      </button>
                    </div>
                  );
                }

                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.85rem' }}>
                    {filteredTickets.map((t) => {
                      const isSelected = selectedTicket?.id === t.id;
                      let totalAmt = Number(t.total || 0);

                      return (
                        <div
                          key={t.id}
                          onClick={() => {
                            handleSelectTicket(t);
                            setShowPendingTicketsModal(false);
                          }}
                          style={{
                            background: isSelected ? 'linear-gradient(135deg, #fff1f2, #ffffff)' : '#ffffff',
                            border: `1.5px solid ${isSelected ? '#be185d' : '#e2e8f0'}`,
                            borderRadius: '16px',
                            padding: '0.9rem',
                            cursor: 'pointer',
                            boxShadow: isSelected ? '0 4px 14px rgba(190,24,93,0.15)' : '0 2px 6px rgba(0,0,0,0.03)',
                            transition: 'all 0.15s ease',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.5rem'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: 900, color: isSelected ? '#be185d' : '#0f172a' }}>
                              🎫 {t.ticket_number || `SD-${String(t.id).slice(-4)}`}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <span style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '1px 6px', borderRadius: '6px', fontSize: '0.625rem', fontWeight: 800 }}>
                                En Atención
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDiscardTicket(e, t.id);
                                }}
                                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}
                                title="Descartar ticket"
                              >
                                <XCircle size={15} />
                              </button>
                            </div>
                          </div>

                          <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 800, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            👤 {t.client_name || 'Invitado / General'}
                          </p>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.725rem', color: '#64748b', borderTop: '1px solid #f1f5f9', paddingTop: '0.45rem', marginTop: '0.2rem' }}>
                            <span>🕒 {new Date(t.visited_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            <strong style={{ color: totalAmt > 0 ? '#15803d' : '#be185d', fontWeight: 900, fontSize: '0.825rem' }}>
                              {totalAmt > 0 ? `RD$ ${totalAmt.toLocaleString('es-DO', { minimumFractionDigits: 2 })}` : 'En proceso'}
                            </strong>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* MODAL FOOTER */}
            <div style={{ padding: '0.85rem 1.5rem', background: '#ffffff', borderTop: '1px solid #e2e8f0', textAlign: 'right' }}>
              <button
                type="button"
                onClick={() => setShowPendingTicketsModal(false)}
                style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '0.5rem 1.25rem', borderRadius: '10px', fontSize: '0.825rem', fontWeight: 700, color: '#475569', cursor: 'pointer' }}
              >
                Cerrar
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ================= MODAL: PLAN DETAILS MODAL ================= */}
      {showPlanDetailsModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1.25rem' }}>
          <div style={{ background: '#ffffff', borderRadius: '24px', width: '100%', maxWidth: '460px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
            
            {/* MODAL HEADER */}
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#ffffff' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900, color: '#0f172a', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                DETALLE PLAN BEAUTY
              </h3>

              <button
                type="button"
                onClick={() => setShowPlanDetailsModal(false)}
                style={{ background: '#f1f5f9', border: 'none', color: '#64748b', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontWeight: 800, fontSize: '0.9rem' }}
              >
                ✕
              </button>
            </div>

            {/* MODAL BODY */}
            <div style={{ padding: '1.5rem 1.75rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem', background: '#ffffff' }}>
              
              {/* SECTION: BENEFICIOS DISPONIBLES */}
              <div>
                <h4 style={{ margin: '0 0 0.85rem 0', fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
                  Beneficios disponibles
                </h4>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {/* ITEM 1: LAVADOS Y SECADOS */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: '22px', height: '22px', borderRadius: '6px', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', fontSize: '13px', fontWeight: 900, flexShrink: 0 }}>
                      ✓
                    </div>
                    <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b' }}>
                      {getRegularWashesCount()}/{getTotalBenefitsCount()} Lavados y Secados
                    </span>
                  </div>

                  {/* ITEM 2: EXTRA O TRATAMIENTO */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: '22px', height: '22px', borderRadius: '6px', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', fontSize: '13px', fontWeight: 900, flexShrink: 0 }}>
                      ✓
                    </div>
                    <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b' }}>
                      1 Lavado y secado extra o 1 uso de tratamiento profundo
                    </span>
                  </div>
                </div>
              </div>

              {/* SECTION: REGALOS */}
              <div style={{ paddingTop: '0.35rem' }}>
                <h4 style={{ margin: '0 0 0.85rem 0', fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
                  Regalos
                </h4>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontSize: '1.35rem', lineHeight: 1 }}>🎁</span>
                  <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b' }}>
                    Regalo de cumpleaños disponible
                  </span>
                </div>
              </div>

              {/* SECTION: BENEFICIOS RENOVADOS */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', paddingTop: '0.35rem' }}>
                <div style={{ width: '22px', height: '22px', borderRadius: '6px', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', fontSize: '13px', fontWeight: 900, flexShrink: 0, marginTop: '2px' }}>
                  ✓
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
                    Beneficios renovados
                  </span>
                  <span style={{ fontSize: '0.875rem', color: '#64748b', fontWeight: 600, marginTop: '3px' }}>
                    {getRenewalDateText()}
                  </span>
                </div>
              </div>

            </div>

            {/* MODAL FOOTER */}
            <div style={{ padding: '1rem 1.5rem', background: '#f8fafc', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => {
                  addPlanWashToTicket();
                  setShowPlanDetailsModal(false);
                }}
                style={{ background: '#be185d', color: '#ffffff', border: 'none', padding: '0.65rem 1.25rem', borderRadius: '12px', fontSize: '0.825rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <span>+ Canjear Lavado</span>
              </button>
              <button
                type="button"
                onClick={() => setShowPlanDetailsModal(false)}
                style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '0.65rem 1.25rem', borderRadius: '12px', fontSize: '0.825rem', fontWeight: 700, color: '#475569', cursor: 'pointer' }}
              >
                Cerrar
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ================= MODAL: SMART RECOMMENDATIONS MODAL ================= */}
      {showRecommendationsModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1.25rem' }}>
          <div style={{ background: '#ffffff', borderRadius: '24px', width: '100%', maxWidth: '520px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
            
            {/* MODAL HEADER */}
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#faf5ff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <div style={{ width: '38px', height: '38px', borderRadius: '12px', background: '#f3e8ff', color: '#9333ea', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Sparkles size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900, color: '#0f172a' }}>
                    Recomendaciones Personalizadas
                  </h3>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                    Basado en las preferencias y consumos de {clientFound?.nombre || clientFound?.name || 'Cliente'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowRecommendationsModal(false)}
                style={{ background: '#f1f5f9', border: 'none', color: '#64748b', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontWeight: 800, fontSize: '0.9rem' }}
              >
                ✕
              </button>
            </div>

            {/* MODAL BODY */}
            <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {getSmartRecommendations().map((rec, idx) => (
                <div 
                  key={rec.id || idx}
                  style={{
                    background: '#ffffff',
                    border: '1.5px solid #f1f5f9',
                    borderRadius: '16px',
                    padding: '0.9rem 1rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <strong style={{ color: '#0f172a', fontSize: '0.9rem' }}>{rec.nombre}</strong>
                      <span style={{ background: '#fdf4ff', color: '#9333ea', fontSize: '0.675rem', fontWeight: 700, padding: '2px 7px', borderRadius: '6px' }}>
                        {rec.tiempo || 'Recomendado'}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#be185d', marginTop: '0.2rem', display: 'block' }}>
                      RD$ {(rec.precio || 600).toLocaleString('es-DO')}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      addServiceToLineItems(rec);
                      setShowRecommendationsModal(false);
                    }}
                    style={{
                      background: '#7c3aed',
                      color: '#ffffff',
                      border: 'none',
                      padding: '0.5rem 0.95rem',
                      borderRadius: '10px',
                      fontSize: '0.775rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      boxShadow: '0 2px 6px rgba(124, 58, 237, 0.25)',
                      flexShrink: 0
                    }}
                  >
                    <Plus size={14} />
                    <span>+ Agregar</span>
                  </button>
                </div>
              ))}
            </div>

            {/* MODAL FOOTER */}
            <div style={{ padding: '0.85rem 1.5rem', background: '#f8fafc', borderTop: '1px solid #e2e8f0', textAlign: 'right' }}>
              <button
                type="button"
                onClick={() => setShowRecommendationsModal(false)}
                style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '0.5rem 1.25rem', borderRadius: '10px', fontSize: '0.825rem', fontWeight: 700, color: '#475569', cursor: 'pointer' }}
              >
                Cerrar
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ================= MODAL: DIGITAL CONTRACT ONBOARDING ================= */}
      {showContractModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1040, padding: '1.25rem' }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: '1050px', maxHeight: '92vh', borderRadius: '24px', overflowY: 'auto', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', padding: '2rem', boxSizing: 'border-box', position: 'relative' }}>
            <DigitalContract
              initialClient={clientFound}
              isModal={true}
              onClose={() => setShowContractModal(false)}
              onContractCreated={async () => {
                setShowContractModal(false);
                if (clientFound) {
                  await loadClientPlanData(clientFound.id, clientFound.nombre || clientFound.name);
                }
              }}
            />
          </div>
        </div>
      )}

    </div>
  );
};

export default VisitRecorder;
