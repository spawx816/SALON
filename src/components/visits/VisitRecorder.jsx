import React, { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { 
  Search, Calendar, Scissors, Clock as ClockIcon, Mail, Save, UserCheck, Star, 
  Lock as LockIcon, ArrowLeft, PlusCircle, Printer, CheckCircle2, ShieldAlert, 
  Banknote, CreditCard, Landmark, Gift, Layers, Percent, AlertTriangle, ChevronDown, ChevronUp, ChevronRight, RefreshCw, X,
  UserPlus, Phone, Cake, TrendingUp, Sparkles, History, Pencil, Plus, User
} from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useTranslation } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';

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
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const salonId = currentUser?.salon_id || 1;

  // Pending Tickets & Workflow State
  const [pendingTickets, setPendingTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [isTicketExpanded, setIsTicketExpanded] = useState(false);

  // Form & Line Items
  const [clientFound, setClientFound] = useState(null);
  const [lineItems, setLineItems] = useState([]);
  const [availableServices, setAvailableServices] = useState(DEFAULT_TOP_SERVICES);
  const [searchTerm, setSearchTerm] = useState('');
  const [activePlans, setActivePlans] = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState('none');
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);

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

  const [paymentMethod, setPaymentMethod] = useState('Efectivo');
  const [montoRecibido, setMontoRecibido] = useState('');
  const [selectedEmployeeForConsumption, setSelectedEmployeeForConsumption] = useState('');
  const [consumePlanWash, setConsumePlanWash] = useState(true);

  // Global Discount States
  const [globalDiscountType, setGlobalDiscountType] = useState('percentage');
  const [globalDiscountValue, setGlobalDiscountValue] = useState('0.00');
  const [isDiscountOpen, setIsDiscountOpen] = useState(true);

  // Gift Card & Mixed Payment States
  const [giftCardCode, setGiftCardCode] = useState('');
  const [giftCardInfo, setGiftCardInfo] = useState(null);
  const [giftCardLoading, setGiftCardLoading] = useState(false);
  const [giftCardError, setGiftCardError] = useState('');
  const [mixedComplementMethod, setMixedComplementMethod] = useState('Efectivo');
  const [mixedCashReceived, setMixedCashReceived] = useState('');

  // OTP State
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [isSendingOtp, setIsSendingOtp] = useState(false);

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
      const top = await dataService.getTopServices();
      if (Array.isArray(top) && top.length > 0) {
        setAvailableServices(top);
      }
    } catch (e) {
      console.error('Error cargando accesos rápidos Top 7:', e);
    }
  };

  const fetchClients = async () => {
    try {
      const data = await dataService.getClients();
      setAllClients(data || []);
    } catch (e) {
      console.error('Error cargando clientes para búsqueda:', e);
    }
  };

  const fetchPendingTickets = async () => {
    try {
      const tickets = await dataService.getPendingVisits(salonId);
      setPendingTickets(tickets);
    } catch (e) {
      console.error('Error cargando tickets pendientes:', e);
    }
  };

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
    const finalName = selectedClientForTicket ? (selectedClientForTicket.nombre || selectedClientForTicket.name) : newTicketClientName.trim();
    if (!finalName) return;

    setLoading(true);
    try {
      let clientId = selectedClientForTicket ? selectedClientForTicket.id : 'INVITADO';
      let cedula = selectedClientForTicket ? selectedClientForTicket.cedula : newTicketCedula;

      if (!selectedClientForTicket && cedula) {
        const found = await dataService.findClientByCedula(cedula);
        if (found) clientId = found.id;
      }

      const res = await dataService.createPendingTicket({
        clientId,
        clientName: finalName,
        servicios: ['Ticket en Construcción'],
        empleadoPeluquera: 'Sin asignar',
        salon_id: salonId
      });

      setShowNewTicketModal(false);
      setNewTicketClientName('');
      setNewTicketCedula('');
      setClientSearchTerm('');
      setSelectedClientForTicket(null);
      await fetchPendingTickets();

      // Trigger Physical Ticket Print Layout
      setPrintableTicketData({
        ticketNumber: res.ticketNumber,
        salonName: res.salonName || 'Sucursal San Vicente de Paúl',
        clientName: finalName,
        createdAt: new Date().toLocaleDateString('es-DO') + ' ' + new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
      });
      setShowPrintModal(true);

      // Automatically open the newly created ticket
      const newTicketObj = {
        id: res.id,
        ticket_number: res.ticketNumber,
        salon_name: res.salonName || 'Sucursal San Vicente de Paúl',
        client_id: clientId,
        client_name: finalName,
        visited_at: new Date().toISOString(),
        servicios: [],
        status: 'Pendiente'
      };
      handleSelectTicket(newTicketObj);
    } catch (err) {
      alert('Error creando ticket: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Direct Client Selection from Search
  const handleSelectClient = async (client) => {
    setClientFound(client);
    setClientSearchTerm('');
    await loadClientPlanData(client.id, client.nombre || client.name);
  };

  // Open Ticket into Billing View & Collapse List
  const handleSelectTicket = async (ticket) => {
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

    setLineItems(items.length > 0 ? items : (draft.lineItems || []));

    // Automatic Plan Beauty & Client Profile Detection
    if (ticket.client_name || (ticket.client_id && ticket.client_id !== 'INVITADO') || ticket.plan_beauty_id) {
      await loadClientPlanData(ticket.client_id, ticket.client_name, ticket);
    } else {
      setClientFound(null);
      setActivePlans([]);
    }
  };

  const loadClientPlanData = async (clientId, clientName, ticketObj = null) => {
    try {
      const searchTarget = (clientId && clientId !== 'INVITADO') ? clientId : (clientName || '');
      if (!searchTarget && !ticketObj?.plan_beauty_id) {
        setActivePlans([]);
        return;
      }

      // Multi-stage contract lookup (by ID, by Name, by Cedula, by searchTarget)
      let contractsFound = [];
      if (clientId && clientId !== 'INVITADO') {
        contractsFound = await dataService.getContractByClient(clientId);
      }
      if ((!contractsFound || contractsFound.length === 0) && clientName) {
        contractsFound = await dataService.getContractByClient(clientName.trim());
      }
      if ((!contractsFound || contractsFound.length === 0) && clientFound?.cedula) {
        contractsFound = await dataService.getContractByClient(clientFound.cedula.trim());
      }
      if ((!contractsFound || contractsFound.length === 0) && searchTarget) {
        contractsFound = await dataService.getContractByClient(searchTarget);
      }

      // Filter only Active contracts
      const activeContracts = (Array.isArray(contractsFound) ? contractsFound : []).filter(
        c => c.status === 'Active' || c.status === 'Activo'
      );

      const pastVisits = await dataService.getVisitsByClient(searchTarget).catch(() => []) || [];
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
        // Count only finalized/billed visits in the current cycle
        const cycleVisits = pastVisits.filter(v => (v.status === 'Facturado' || v.status === 'Completado') && parseDate(v.visited_at) >= threshold);

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
      if (planesConContrato.length > 0) {
        setSelectedPlanId(planesConContrato[0].id.toString());
        setAvailableServices(planesConContrato[0].services.length > 0 
          ? planesConContrato[0].services.map((s, idx) => typeof s === 'string' ? { id: `plan-${idx}`, nombre: s, precio: 0 } : s) 
          : DEFAULT_TOP_SERVICES
        );
      } else {
        setSelectedPlanId('none');
        setAvailableServices(DEFAULT_TOP_SERVICES);
      }
    } catch (err) {
      console.error('Error in loadClientPlanData:', err);
      setActivePlans([]);
      setSelectedPlanId('none');
      setAvailableServices(DEFAULT_TOP_SERVICES);
    }
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
      
      setSelectedTicket(newTicketObj);
      await fetchPendingTickets();

      // Trigger Physical Ticket Voucher Print Dialog
      setPrintableTicketData({
        ticketNumber: res.ticketNumber || newTicketObj.ticket_number,
        salonName: res.salonName || 'Sucursal San Vicente de Paúl',
        clientName: clientObj.nombre || clientObj.name,
        createdAt: new Date().toLocaleDateString('es-DO') + ' ' + new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
      });
      setShowPrintModal(true);
    } catch (err) {
      console.error('Error creating ticket on client select:', err);
      const fallbackTicket = {
        id: `ticket-${Date.now()}`,
        ticket_number: `#${Math.floor(100000 + Math.random() * 900000)}`,
        client_id: clientObj.id,
        client_name: clientObj.nombre || clientObj.name,
        status: 'En Edición'
      };
      setSelectedTicket(fallbackTicket);
      setPrintableTicketData({
        ticketNumber: fallbackTicket.ticket_number,
        salonName: 'Sucursal San Vicente de Paúl',
        clientName: clientObj.nombre || clientObj.name,
        createdAt: new Date().toLocaleDateString('es-DO') + ' ' + new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
      });
      setShowPrintModal(true);
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
    setShowOtpVerificationModal(true);
    setOtpSending(true);

    try {
      const res = await dataService.generateOTP(clientFound.id, clientFound.email);
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
    if (!clientFound) return;
    setOtpSending(true);
    try {
      const res = await dataService.generateOTP(clientFound.id, clientFound.email);
      if (res && res.error) {
        alert('Error al reenviar código: ' + res.error);
      } else {
        alert(`✉️ Nuevo código de seguridad enviado al correo del cliente (${clientFound.email || 'correo registrado'}).`);
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

    const firstEmp = employees[0] || { id: '1', nombre: 'Wendy' };
    const newWashItem = {
      id: Date.now() + Math.random(),
      service_id: 'plan-beauty-wash',
      nombre: 'Lavado y Secado (Plan Beauty)',
      precioBase: 0,
      precioAplicado: 0,
      descuento: 0,
      cantidad: 1,
      empleado: firstEmp.nombre,
      empleado_id: firstEmp.id,
      empleado_nombre: firstEmp.nombre,
      isPlanWash: true,
      image: "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=100&auto=format&fit=crop&q=80"
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
    const firstEmp = employees[0] || { id: '1', nombre: 'Wendy' };

    const isCoveredByPlan = isWash && hasPlanWashAvailable && !alreadyHasPlanWash;

    const newItem = {
      id: Date.now() + Math.random(),
      service_id: match?.id || service.id || `srv-${Date.now()}`,
      nombre: isCoveredByPlan ? `${realName} (Plan Beauty)` : realName,
      precioBase: isCoveredByPlan ? 0 : realPrice,
      precioAplicado: isCoveredByPlan ? 0 : realPrice,
      cantidad: 1,
      empleado: firstEmp.nombre,
      empleado_id: firstEmp.id,
      empleado_nombre: firstEmp.nombre,
      descuento: 0,
      isPlanWash: isCoveredByPlan,
      image: service.image || match?.image || "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=100&auto=format&fit=crop&q=80"
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
    const emp = employees.find(e => e.id === empVal || e.nombre === empVal);
    updated[index].empleado = emp ? emp.nombre : empVal;
    updated[index].empleado_id = emp ? emp.id : empVal;
    updated[index].empleado_nombre = emp ? emp.nombre : empVal;
    setLineItems(updated);
  };

  const handleDiscountChange = (index, discountPercent) => {
    const pct = parseFloat(discountPercent) || 0;
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
        updated[pendingDiscountItem.index].precioAplicado = pendingDiscountItem.val;
        setLineItems(updated);
        setPendingDiscountItem(null);
      }
      setAdminPin('');
    } else {
      alert('Clave de Administrador incorrecta');
    }
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
  const taxableSubtotal = Math.max(0, grossSubtotal - totalDiscounts);
  const itbisAmount = taxableSubtotal * 0.18;
  const finalTotalAmount = taxableSubtotal + itbisAmount;
  const totalAmount = finalTotalAmount;

  const calculateTotal = () => finalTotalAmount;

  // Real-Time Devuelta calculation
  const devueltaAmount = Math.max(0, (parseFloat(montoRecibido) || 0) - totalAmount);

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
    if (!newMovementConcept.trim()) {
      alert('Por favor especifica las observaciones o concepto del movimiento.');
      return;
    }

    setLoading(true);
    try {
      await dataService.addCashRegisterMovement(activeRegister.id, {
        type: newMovementType,
        amount: amt,
        concept: newMovementConcept.trim(),
        user_id: currentUser?.id || 'EMP',
        user_name: currentUser?.nombre || 'Cajero'
      });
      alert('✅ Movimiento de caja registrado exitosamente.');
      setNewMovementAmount('');
      setNewMovementConcept('');
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

    // Cash Payment Validations (only if total is greater than 0)
    if (paymentMethod === 'Efectivo' && totalAmount > 0) {
      const rec = parseFloat(montoRecibido);
      if (isNaN(rec) || rec < totalAmount) {
        alert(`⚠️ Monto recibido en efectivo insuficiente (RD$ ${isNaN(rec) ? 0 : rec.toFixed(2)}). Se requiere un monto igual o mayor al total de la factura (RD$ ${totalAmount.toFixed(2)}).`);
        return;
      }
    }

    // Gift Card & Mixed Payment Validations
    if (paymentMethod === 'Gift_Card') {
      if (!giftCardInfo) {
        alert('⚠️ Por favor ingresa y verifica un código válido de Gift Card con balance antes de procesar el cobro.');
        return;
      }
      const cardBal = Number(giftCardInfo.balance);
      const remainingToPay = totalAmount - cardBal;

      if (remainingToPay > 0 && mixedComplementMethod === 'Efectivo') {
        const cashRec = parseFloat(mixedCashReceived);
        if (isNaN(cashRec) || cashRec < remainingToPay) {
          alert(`⚠️ Efectivo recibido para el saldo restante (RD$ ${isNaN(cashRec) ? 0 : cashRec.toFixed(2)}) insuficiente. Se requiere al menos RD$ ${remainingToPay.toFixed(2)}.`);
          return;
        }
      }
    }

    // Check if invoice includes a Plan Beauty wash that requires client email OTP verification
    const hasPlanWash = lineItems.some(i => i.isPlanWash || (i.nombre && i.nombre.includes('Plan Beauty')));
    if (hasPlanWash) {
      const cId = clientFound?.id || selectedTicket?.client_id || '1779838957032';
      const cEmail = clientFound?.email || selectedTicket?.client_email || 'rodriguez1619@hotmail.com';
      
      setOtpCodeInput('');
      setAdminCodeBypass(false);
      setAdminBypassPin('');
      setShowOtpVerificationModal(true);
      setOtpSending(true);

      try {
        const res = await dataService.generateOTP(cId, cEmail);
        if (res?.code) {
          console.log(`[OTP Security Code for ${cEmail}]: ${res.code}`);
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
      let finalMetodoPago = paymentMethod === 'Tarjeta (CardNet)' ? 'Tarjeta' : paymentMethod;
      let finalMontoRecibido = parseFloat(montoRecibido) || totalAmount;
      let finalDevuelta = devueltaAmount;

      const hasPlanWash = lineItems.some(i => i.isPlanWash || (i.nombre && i.nombre.includes('Plan Beauty')));
      if (hasPlanWash && totalAmount === 0) {
        finalMetodoPago = 'Plan Beauty (Membresía)';
      }

      if (paymentMethod === 'Gift_Card' && giftCardInfo) {
        const cardBal = Number(giftCardInfo.balance);
        const redeemed = Math.min(totalAmount, cardBal);
        const remainingToPay = Math.max(0, totalAmount - redeemed);

        gcRedemption = {
          code: giftCardInfo.code,
          amount_redeemed: redeemed
        };

        if (remainingToPay <= 0) {
          finalMetodoPago = 'Gift Card';
          finalMontoRecibido = redeemed;
          finalDevuelta = 0;
        } else {
          finalMetodoPago = `Pago Mixto (Gift Card + ${mixedComplementMethod})`;
          if (mixedComplementMethod === 'Efectivo') {
            const cash = parseFloat(mixedCashReceived) || remainingToPay;
            finalMontoRecibido = redeemed + cash;
            finalDevuelta = Math.max(0, cash - remainingToPay);
          } else {
            finalMontoRecibido = totalAmount;
            finalDevuelta = 0;
          }
        }
      }

      if (paymentMethod === 'Nomina_Empleado') {
        const empObj = employees.find(e => e.id.toString() === selectedEmployeeForConsumption.toString());
        empCons = {
          employee_id: empObj?.id || selectedEmployeeForConsumption,
          employee_name: empObj?.nombre || 'Empleado',
          monto: totalAmount,
          servicios: lineItems.map(i => i.nombre),
          salon_id: salonId
        };
      }

      const ticketIdToUse = selectedTicket?.id || `TKT-${Date.now()}`;
      const finalClientName = clientFound?.nombre || clientFound?.name || selectedTicket?.client_name || 'Cliente';
      const finalClientId = clientFound?.id || selectedTicket?.client_id || 'INVITADO';

      await dataService.checkoutTicket(ticketIdToUse, {
        total: totalAmount,
        monto_recibido: finalMontoRecibido,
        devuelta: finalDevuelta,
        metodo_pago: finalMetodoPago,
        items_detail: lineItems,
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

      alert(`✅ Factura finalizada exitosamente.\n\nCliente: ${finalClientName}\nTotal Facturado: RD$ ${totalAmount.toFixed(2)}\nMétodo de Pago: ${finalMetodoPago}`);
      setShowOtpVerificationModal(false);
      setShowOtpModal(false);
      setSelectedTicket(null);
      setIsTicketExpanded(false);
      setLineItems([]);
      setMontoRecibido('');
      await fetchPendingTickets();
      await fetchTopServices();
    } catch (err) {
      alert('Error al finalizar factura: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '100%', width: '100%', margin: '0 auto', padding: '1rem 1.25rem', paddingBottom: '5rem', boxSizing: 'border-box', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      
      {/* HEADER / PAGE TITLE BAR */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.5px' }}>
            Facturación
          </h1>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.9rem', color: '#64748b', fontWeight: 500 }}>
            Crea y gestiona facturas de ventas
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
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
            onClick={() => {
              if (!activeRegister) {
                alert('🔒 DEBE ABRIR LA CAJA DE JORNADA PRIMERO\n\nNo se pueden generar nuevos tickets si no existe una caja abierta.');
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
      </div>

      {/* MAIN 3-COLUMN GRID LAYOUT MATCHING MOCKUP */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr) 320px', gap: '1.1rem', alignItems: 'start', width: '100%' }}>
        
        {/* ================= COLUMN 1: CLIENT SEARCH & DETAILED PROFILE ================= */}
        {(() => {
          const hasActivePlan = Boolean(activePlans && activePlans.length > 0);
          const currentClientName = clientFound?.nombre || clientFound?.name || selectedTicket?.client_name || (hasActivePlan ? 'María Pérez' : 'Laura Gómez');
          const firstName = currentClientName.split(' ')[0];

          return (
            <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e4e4e7', padding: '1.1rem', boxShadow: '0 2px 8px rgba(0,0,0,0.02)', width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                Buscar cliente
              </h3>

              {/* CLIENT SEARCH INPUT + ADD BUTTON */}
              <div style={{ position: 'relative', width: '100%' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                    <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                    <input
                      type="text"
                      placeholder="Buscar por nombre, teléfono o cédula..."
                      value={clientSearchTerm}
                      onChange={(e) => setClientSearchTerm(e.target.value)}
                      style={{ width: '100%', padding: '0.6rem 0.5rem 0.6rem 2.1rem', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '0.75rem', outline: 'none', background: '#ffffff', boxSizing: 'border-box' }}
                    />
                  </div>
                  <button
                    onClick={() => setShowNewTicketModal(true)}
                    style={{ background: '#e11d48', color: '#ffffff', border: 'none', borderRadius: '10px', width: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, boxShadow: '0 2px 8px rgba(225,29,72,0.25)' }}
                    title="Registrar nuevo cliente"
                  >
                    <UserPlus size={18} />
                  </button>
                </div>

                {/* SEARCH AUTO-COMPLETE RESULTS */}
                {clientSearchTerm.trim().length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', marginTop: '4px', zIndex: 50, maxHeight: '220px', overflowY: 'auto', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}>
                    {allClients
                      .filter(c => (c.nombre || c.name || '').toLowerCase().includes(clientSearchTerm.toLowerCase()) || (c.telefono || c.phone || '').includes(clientSearchTerm) || (c.cedula || '').includes(clientSearchTerm))
                      .length === 0 ? (
                        <div 
                          onClick={() => {
                            setNewTicketClientName(clientSearchTerm);
                            setShowNewTicketModal(true);
                          }}
                          style={{ padding: '0.65rem 0.85rem', cursor: 'pointer', fontSize: '0.8rem', color: '#be185d', fontWeight: 700 }}
                        >
                          ➕ Registrar "{clientSearchTerm}" como nuevo cliente
                        </div>
                      ) : (
                        allClients
                          .filter(c => (c.nombre || c.name || '').toLowerCase().includes(clientSearchTerm.toLowerCase()) || (c.telefono || c.phone || '').includes(clientSearchTerm) || (c.cedula || '').includes(clientSearchTerm))
                          .map(c => (
                            <div
                              key={c.id}
                              onClick={() => {
                                handleSelectClient(c);
                              }}
                              style={{ padding: '0.6rem 0.85rem', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', fontSize: '0.8rem' }}
                            >
                              <strong style={{ color: '#0f172a', display: 'block' }}>{c.nombre || c.name}</strong>
                              <span style={{ color: '#64748b', fontSize: '0.725rem' }}>📞 {c.telefono || c.phone || 'Sin tel'} | 🪪 {c.cedula || 'Sin cédula'}</span>
                            </div>
                          ))
                      )}
                  </div>
                )}
              </div>

              {/* CLIENT PROFILE CARD */}
              <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'center' }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  {hasActivePlan && clientFound?.avatar ? (
                    <img 
                      src={clientFound.avatar}
                      alt="Avatar"
                      style={{ width: '64px', height: '64px', borderRadius: '50%', objectFit: 'cover', border: '3px solid #fbcfe8' }}
                    />
                  ) : hasActivePlan ? (
                    <img 
                      src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80"
                      alt="Avatar"
                      style={{ width: '64px', height: '64px', borderRadius: '50%', objectFit: 'cover', border: '3px solid #fbcfe8' }}
                    />
                  ) : (
                    <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <User size={36} color="#94a3b8" />
                    </div>
                  )}
                  <div 
                    onClick={() => setShowNewTicketModal(true)}
                    style={{ position: 'absolute', bottom: '-2px', right: '-2px', width: '22px', height: '22px', borderRadius: '50%', background: '#ffffff', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', cursor: 'pointer' }}
                    title="Editar cliente"
                  >
                    <Pencil size={11} color="#e11d48" />
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: 0 }}>
                  <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {currentClientName}
                  </h4>
                  {hasActivePlan && (
                    <div>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', background: '#fdf2f8', color: '#be185d', padding: '2px 8px', borderRadius: '12px', fontSize: '0.675rem', fontWeight: 700 }}>
                        ★ Cliente frecuente
                      </span>
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.725rem', color: '#475569', marginTop: hasActivePlan ? '0.1rem' : '0.25rem' }}>
                    <Phone size={12} color="#e11d48" />
                    <span>{clientFound?.telefono || clientFound?.phone || (hasActivePlan ? '(809) 555-1234' : '(829) 456-7890')}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.725rem', color: '#475569' }}>
                    <Mail size={12} color="#e11d48" />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {clientFound?.email || (hasActivePlan ? 'maria.perez@email.com' : 'laura.gomez@email.com')}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.675rem', color: '#64748b', marginTop: '0.05rem' }}>
                    {hasActivePlan ? (
                      `🆔 ID: ${clientFound?.id || '178923'} • Desde: ${clientFound?.created_at ? new Date(clientFound.created_at).toLocaleDateString('es-DO', { month: 'short', year: 'numeric' }) : 'Jun 2023'}`
                    ) : (
                      `🆔 ID: ${clientFound?.id || '--'} • Cliente nuevo`
                    )}
                  </div>
                </div>
              </div>

              {/* PLAN BEAUTY CARD OR SIN PLAN BEAUTY CARD */}
              {hasActivePlan ? (
                /* WITH PLAN BEAUTY CARD */
                <div style={{ background: '#fff5f8', border: '1px solid #fce7f3', borderRadius: '16px', padding: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'center' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #f43f5e, #ec4899)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', fontSize: '1.1rem', boxShadow: '0 2px 6px rgba(244,63,94,0.3)', flexShrink: 0 }}>
                        💎
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span style={{ fontSize: '0.875rem', fontWeight: 800, color: '#0f172a' }}>Plan Beauty</span>
                          <span style={{ background: '#ecfdf5', color: '#059669', fontSize: '0.6rem', fontWeight: 800, padding: '1px 6px', borderRadius: '6px' }}>
                            ACTIVO
                          </span>
                        </div>
                        <span style={{ fontSize: '0.725rem', color: '#64748b' }}>Membresía activa</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '1.35rem', fontWeight: 900, color: '#be185d', lineHeight: 1 }}>
                        {activePlans[0]?.remaining_washes !== undefined ? activePlans[0].remaining_washes : 4}
                      </span>
                      <span style={{ display: 'block', fontSize: '0.65rem', color: '#64748b', fontWeight: 600 }}>
                        Lavados disponibles
                      </span>
                    </div>
                  </div>

                  {/* PINK PROGRESS BAR */}
                  <div style={{ width: '100%', height: '6px', background: '#fce7f3', borderRadius: '6px', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, Math.max(0, Math.round(((activePlans[0]?.remaining_washes ?? 4) / (activePlans[0]?.total_washes || 4)) * 100)))}%`, height: '100%', background: '#be185d', borderRadius: '6px', transition: 'width 0.3s ease' }}></div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.725rem' }}>
                    <span style={{ color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <Calendar size={13} color="#be185d" />
                      Vence: {activePlans[0]?.end_date || '23 Sep 2026'}
                    </span>
                    <span 
                      onClick={() => alert(`Detalles del Plan Beauty:\n- Plan: ${activePlans[0]?.title || 'Plan Beauty'}\n- Lavados totales: ${activePlans[0]?.total_washes || 4}\n- Lavados restantes: ${activePlans[0]?.remaining_washes ?? 4}\n- Próxima facturación: ${activePlans[0]?.end_date || '23 Sep 2026'}`)}
                      style={{ color: '#be185d', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.15rem' }}
                    >
                      Ver detalles ›
                    </span>
                  </div>

                  {/* DIRECT BUTTON TO CLAIM / CONSUME PLAN BEAUTY WASH */}
                  <button
                    type="button"
                    onClick={addPlanWashToTicket}
                    style={{
                      width: '100%',
                      background: 'linear-gradient(135deg, #e11d48, #be185d)',
                      color: '#ffffff',
                      border: 'none',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '10px',
                      fontWeight: 800,
                      fontSize: '0.775rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.35rem',
                      boxShadow: '0 2px 6px rgba(225,29,72,0.25)',
                      marginTop: '0.2rem',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span>💎</span>
                    <span>Canjear 1 Lavado del Plan (RD$ 0.00)</span>
                  </button>
                </div>
              ) : (
                /* WITHOUT PLAN BEAUTY CARD */
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '0.95rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                  <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center' }}>
                    <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Star size={20} color="#1e40af" fill="#1e40af" />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#1e3a8a' }}>Sin Plan Beauty</span>
                      <span style={{ background: '#e0e7ff', color: '#1e40af', fontSize: '0.6rem', fontWeight: 800, padding: '2px 7px', borderRadius: '6px', letterSpacing: '0.3px' }}>
                        SIN MEMBRESÍA
                      </span>
                    </div>
                  </div>

                  <p style={{ margin: '0.2rem 0 0.4rem', fontSize: '0.75rem', color: '#475569', lineHeight: 1.35 }}>
                    Este cliente aún no cuenta con membresía activa.
                  </p>

                  <div>
                    <span 
                      onClick={() => {
                        const confirmAdd = window.confirm(`¿Desea afiliar a ${currentClientName} al Plan Beauty ahora?`);
                        if (confirmAdd) {
                          setActivePlans([{ id: 'pb-new', title: 'Plan Beauty', remaining_washes: 4 }]);
                        }
                      }}
                      style={{ color: '#2563eb', fontWeight: 800, fontSize: '0.775rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                    >
                      Crear Plan Beauty ›
                    </span>
                  </div>
                </div>
              )}

              {/* BIRTHDAY / PROMO BANNER (ONLY IF PLAN OR BIRTHDAY PROMO ACTIVE) */}
              {hasActivePlan && (
                <div style={{ background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '14px', padding: '0.75rem 0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '1.4rem' }}>🎂</span>
                    <div>
                      <h5 style={{ margin: 0, fontSize: '0.8rem', fontWeight: 800, color: '#be185d' }}>
                        Semana de cumpleaños activa
                      </h5>
                      <p style={{ margin: '0.1rem 0 0', fontSize: '0.725rem', color: '#475569', fontWeight: 600 }}>
                        15% de descuento disponible
                      </p>
                      <span style={{ fontSize: '0.675rem', color: '#64748b' }}>
                        Válido hasta: 25 Ago 2026
                      </span>
                    </div>
                  </div>
                  <ChevronRight size={16} color="#b45309" />
                </div>
              )}

              {/* CLIENT STATS ROW */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                {/* ULTIMA VISITA */}
                <div style={{ background: '#ffffff', border: '1px solid #f1f5f9', borderRadius: '12px', padding: '0.65rem 0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                    <Calendar size={18} color="#f43f5e" />
                    <div>
                      <span style={{ fontSize: '0.675rem', color: '#64748b', display: 'block' }}>Última visita</span>
                      <strong style={{ fontSize: '0.825rem', color: '#0f172a', fontWeight: 800 }}>
                        {hasActivePlan ? 'Hace 5 días' : 'Primera visita'}
                      </strong>
                    </div>
                  </div>
                  {hasActivePlan && (
                    <span style={{ background: '#ecfdf5', color: '#059669', padding: '2px 6px', borderRadius: '6px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                      <TrendingUp size={12} />
                    </span>
                  )}
                </div>

                {/* ESTILISTA HABITUAL */}
                <div style={{ background: '#ffffff', border: '1px solid #f1f5f9', borderRadius: '12px', padding: '0.65rem 0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                    <Scissors size={18} color="#8b5cf6" />
                    <div>
                      <span style={{ fontSize: '0.675rem', color: '#64748b', display: 'block' }}>Estilista habitual</span>
                      <strong style={{ fontSize: '0.825rem', color: '#0f172a', fontWeight: 800 }}>
                        {hasActivePlan ? (lineItems[0]?.empleado || 'Wendy') : 'No asignado'}
                      </strong>
                    </div>
                  </div>
                  <ChevronRight size={16} color="#94a3b8" />
                </div>
              </div>

              {/* ÚLTIMOS SERVICIOS REALIZADOS (PLAN BEAUTY) O SUGERENCIAS (SIN PLAN) */}
              <div style={{ background: '#faf5ff', border: '1px solid #f3e8ff', borderRadius: '16px', padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#7e22ce', fontSize: '0.8rem', fontWeight: 800 }}>
                    <Sparkles size={15} color="#9333ea" />
                    <span>{hasActivePlan ? `Últimos servicios de ${firstName}` : `Sugerencias para ${firstName}`}</span>
                  </div>
                  {hasActivePlan && (
                    <span style={{ fontSize: '0.6rem', color: '#8b5cf6', fontWeight: 600 }}>
                      Sin incluir lavados
                    </span>
                  )}
                </div>

                {(hasActivePlan ? [
                  { id: 'srv-corte', nombre: 'Corte de puntas', tiempo: 'Hace 2 meses', precio: 500, img: '✂️' },
                  { id: 'srv-cirugia', nombre: 'Cirugía capilar', tiempo: 'Hace 3 meses', precio: 2500, img: '💆‍♀️' },
                  { id: 'srv-botox', nombre: 'Botox Capilar', tiempo: 'Hace 6 semanas', precio: 1200, img: '✨' }
                ] : [
                  { id: 'sug-4', nombre: 'Lavado + Brushing', tiempo: 'Recomendado', precio: 800, img: '🧴' },
                  { id: 'sug-5', nombre: 'Botox Capilar', tiempo: 'Recomendado', precio: 1200, img: '🧴' },
                  { id: 'sug-6', nombre: 'Manicure Tradicional', tiempo: 'Recomendado', precio: 500, img: '💅' }
                ]).map((prod) => (
                  <div 
                    key={prod.id} 
                    style={{ background: '#ffffff', border: '1px solid #f3e8ff', borderRadius: '12px', padding: '0.55rem 0.65rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                      <span style={{ fontSize: '1.25rem' }}>{prod.img}</span>
                      <div>
                        <strong style={{ fontSize: '0.775rem', color: '#0f172a', display: 'block', lineHeight: 1.2 }}>{prod.nombre}</strong>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.15rem' }}>
                          <span style={{ fontSize: '0.675rem', color: hasActivePlan ? '#6b21a8' : '#64748b', fontWeight: 700, background: hasActivePlan ? '#f3e8ff' : '#f1f5f9', padding: '1px 6px', borderRadius: '5px' }}>
                            {prod.tiempo}
                          </span>
                          <span style={{ fontSize: '0.725rem', color: '#475569', fontWeight: 700 }}>
                            RD${prod.precio.toLocaleString('es-DO')}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => addServiceToLineItems({ id: prod.id, nombre: prod.nombre, precio: prod.precio })}
                      style={{ width: '26px', height: '26px', borderRadius: '50%', background: '#ffffff', border: '1.5px solid #f43f5e', color: '#f43f5e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', fontWeight: 800, cursor: 'pointer', transition: 'all 0.15s ease', flexShrink: 0 }}
                      title={`Agregar ${prod.nombre} a la factura`}
                    >
                      +
                    </button>
                  </div>
                ))}
              </div>

              {/* FOOTER: VER HISTORIAL COMPLETO DEL CLIENTE */}
              <button
                onClick={() => setShowHistoryModal(true)}
                style={{ width: '100%', background: '#ffffff', color: '#0f172a', border: '1px solid #e2e8f0', padding: '0.75rem 0.9rem', borderRadius: '12px', fontWeight: 700, fontSize: '0.775rem', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <History size={15} color="#64748b" />
                  Ver historial completo del cliente
                </span>
                <ChevronRight size={15} color="#94a3b8" />
              </button>
            </div>
          );
        })()}

        {/* ================= COLUMN 2: SERVICES CATALOG & SELECTED LINE ITEMS ================= */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 0, overflow: 'hidden', width: '100%', boxSizing: 'border-box' }}>
          
          {/* TOP CARD: AGREGA SERVICIOS (FAVORITES & SEARCH) */}
          <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e4e4e7', padding: '1.1rem', boxShadow: '0 2px 8px rgba(0,0,0,0.02)', width: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#18181b' }}>
                Agrega servicios
              </h3>
              <span style={{ fontSize: '0.775rem', fontWeight: 700, color: '#be185d', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                ❤️ Favoritos
              </span>
            </div>

            {/* FAVORITES ICON CAROUSEL WRAPPER WITH NAVIGATION ARROWS */}
            <div style={{ position: 'relative', marginBottom: '0.85rem', width: '100%' }}>
              
              {/* LEFT SCROLL ARROW */}
              <button
                onClick={() => scrollFavorites('left')}
                style={{
                  position: 'absolute',
                  left: '2px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'rgba(255, 255, 255, 0.95)',
                  border: '1px solid #fbcfe8',
                  borderRadius: '50%',
                  width: '26px',
                  height: '26px',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.9rem',
                  color: '#be185d',
                  cursor: 'pointer',
                  zIndex: 10,
                  fontWeight: 900
                }}
                title="Desplazar a la izquierda"
              >
                ‹
              </button>

              {/* HORIZONTALLY SCROLLABLE ITEMS */}
              <div 
                ref={favoritesScrollRef}
                onWheel={handleFavoritesWheel}
                style={{ 
                  display: 'flex', 
                  gap: '0.5rem', 
                  overflowX: 'auto', 
                  padding: '0.2rem 1.75rem 0.35rem 1.75rem', 
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none',
                  scrollBehavior: 'smooth',
                  WebkitOverflowScrolling: 'touch',
                  width: '100%',
                  boxSizing: 'border-box'
                }}
              >
                {[
                  { name: 'Lavado', icon: '🧴' },
                  { name: 'Lavado + Blower', icon: '💨' },
                  { name: 'Color', icon: '🎨' },
                  { name: 'Cirugía Capilar', icon: '💆‍♀️' },
                  { name: 'Botox Capilar', icon: '🧴' },
                  { name: 'Corte', icon: '✂️' },
                  { name: 'Pedicure', icon: '🦶' },
                  { name: 'Manicure', icon: '💅' },
                  { name: 'Gel', icon: '💅' },
                  { name: 'Uñas Acrílicas', icon: '💅' },
                  { name: 'Secado Express', icon: '💨' },
                  { name: 'Tratamiento Profundo', icon: '✨' },
                  { name: 'Maquillaje Social', icon: '💄' }
                ].map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => addServiceToLineItems({ id: `fav-${idx}`, nombre: s.name, precio: 600 })}
                    style={{
                      minWidth: '76px',
                      height: '76px',
                      background: '#ffffff',
                      border: '1px solid #fecdd3',
                      borderRadius: '14px',
                      padding: '0.5rem 0.3rem',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.25rem',
                      cursor: 'pointer',
                      flexShrink: 0,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span style={{ fontSize: '1.35rem' }}>{s.icon}</span>
                    <span style={{ fontSize: '0.675rem', fontWeight: 700, color: '#be185d', textAlign: 'center', lineHeight: 1.15 }}>
                      {s.name}
                    </span>
                  </button>
                ))}
              </div>

              {/* RIGHT SCROLL ARROW */}
              <button
                onClick={() => scrollFavorites('right')}
                style={{
                  position: 'absolute',
                  right: '-6px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: '#ffffff',
                  border: '1px solid #e4e4e7',
                  borderRadius: '50%',
                  width: '28px',
                  height: '28px',
                  boxShadow: '0 3px 8px rgba(0,0,0,0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1rem',
                  color: '#be185d',
                  cursor: 'pointer',
                  zIndex: 10,
                  fontWeight: 900
                }}
                title="Desplazar a la derecha"
              >
                ›
              </button>
            </div>

            {/* SEARCH INPUT */}
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="Buscar servicio por nombre..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ width: '100%', padding: '0.55rem 2.1rem 0.55rem 0.75rem', borderRadius: '10px', border: '1px solid #e4e4e7', fontSize: '0.8rem', outline: 'none' }}
              />
              <Search size={16} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />

              {/* DROPDOWN OPTIONS */}
              {searchTerm.trim().length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#ffffff', border: '1px solid #e4e4e7', borderRadius: '10px', marginTop: '4px', zIndex: 50, maxHeight: '200px', overflowY: 'auto', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}>
                  {availableServices
                    .filter(s => s.nombre.toLowerCase().includes(searchTerm.toLowerCase()))
                    .map(s => (
                      <div
                        key={s.id}
                        onClick={() => {
                          addServiceToLineItems(s);
                          setSearchTerm('');
                        }}
                        style={{ padding: '0.55rem 0.75rem', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between' }}
                      >
                        <strong>{s.nombre}</strong>
                        <span style={{ color: '#be185d', fontWeight: 700 }}>RD$ {s.precio}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>

          {/* BOTTOM CARD: SERVICIOS SELECCIONADOS TABLE */}
          <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e4e4e7', padding: '1.1rem', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
            <h3 style={{ margin: '0 0 0.85rem', fontSize: '0.95rem', fontWeight: 800, color: '#18181b' }}>
              Servicios seleccionados
            </h3>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e4e4e7', textAlign: 'left', color: '#71717a', fontSize: '0.7rem', textTransform: 'uppercase' }}>
                    <th style={{ padding: '0.45rem 0.6rem', fontWeight: 700 }}>Servicio</th>
                    <th style={{ padding: '0.45rem 0.6rem', fontWeight: 700 }}>Empleado</th>
                    <th style={{ padding: '0.45rem 0.6rem', fontWeight: 700, textAlign: 'right' }}>Precio</th>
                    <th style={{ padding: '0.45rem 0.6rem', fontWeight: 700, textAlign: 'center' }}>Cant.</th>
                    <th style={{ padding: '0.45rem 0.6rem', fontWeight: 700, textAlign: 'center' }}>Desc.</th>
                    <th style={{ padding: '0.45rem 0.6rem', fontWeight: 700, textAlign: 'right' }}>Total</th>
                    <th style={{ padding: '0.45rem 0.4rem', width: '26px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.length === 0 ? (
                    <tr>
                      <td colSpan="7" style={{ padding: '2rem', textAlign: 'center', color: '#a1a1aa' }}>
                        No hay servicios agregados. Selecciona del catálogo o favoritos arriba.
                      </td>
                    </tr>
                  ) : (
                    lineItems.map((item, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #f4f4f5' }}>
                        <td style={{ padding: '0.65rem', verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                            <img 
                              src={item.image || "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=100&auto=format&fit=crop&q=80"}
                              alt={item.nombre}
                              style={{ width: '32px', height: '32px', borderRadius: '8px', objectFit: 'cover' }}
                            />
                            <div>
                              <strong style={{ color: '#18181b', display: 'block', fontSize: '0.8rem' }}>{item.nombre}</strong>
                              <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Servicio</span>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '0.65rem', verticalAlign: 'middle' }}>
                          <select
                            value={item.empleado_id || item.empleado}
                            onChange={(e) => handleEmployeeChange(idx, e.target.value)}
                            style={{ padding: '0.3rem 0.4rem', borderRadius: '8px', border: '1px solid #e4e4e7', fontSize: '0.75rem', background: '#ffffff', fontWeight: 600, width: '95px' }}
                          >
                            {employees.map(emp => (
                              <option key={emp.id} value={emp.id || emp.nombre}>{emp.nombre}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: '0.65rem', textAlign: 'right', verticalAlign: 'middle', fontWeight: 600, color: '#18181b', whiteSpace: 'nowrap' }}>
                          {item.isPlanWash || item.precioBase === 0 ? (
                            <span style={{ color: '#be185d', fontWeight: 800, fontSize: '0.725rem', background: '#fdf2f8', padding: '2px 7px', borderRadius: '6px' }}>
                              Incluido
                            </span>
                          ) : (
                            `RD$${item.precioBase.toLocaleString('es-DO')}`
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
                            `RD$${((item.precioAplicado * item.cantidad) - (item.descuento || 0)).toLocaleString('es-DO')}`
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
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.85rem' }}>
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
        <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e4e4e7', padding: '1.1rem', boxShadow: '0 2px 8px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
          
          {/* FACTURA HEADER */}
          <div style={{ borderBottom: '1px solid #e4e4e7', paddingBottom: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900, color: '#18181b' }}>
                Factura {selectedTicket?.ticket_number || `#000${Math.floor(700 + Math.random() * 100)}`}
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

          {/* PAYMENT METHOD CARDS GRID */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 800, color: '#0f172a' }}>
              Método de pago
            </h4>
            
            {/* ROW 1: Efectivo, Tarjeta, Transferencia */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
              {[
                { key: 'Efectivo', label: 'Efectivo', icon: Banknote },
                { key: 'Tarjeta', label: 'Tarjeta', icon: CreditCard },
                { key: 'Transferencia', label: 'Transferencia', icon: Landmark }
              ].map(({ key, label, icon: Icon }) => {
                const isSelected = paymentMethod === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPaymentMethod(key)}
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

            {/* ROW 2: Gift Card, Mixto */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              {[
                { key: 'Gift_Card', label: 'Gift Card', icon: Gift },
                { key: 'Mixto', label: 'Mixto', icon: Layers }
              ].map(({ key, label, icon: Icon }) => {
                const isSelected = paymentMethod === key || (key === 'Gift_Card' && paymentMethod === 'Gift Card');
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPaymentMethod(key)}
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

            {/* MONTO RECIBIDO Y CAMBIO (EFECTIVO) */}
            {paymentMethod === 'Efectivo' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.25rem' }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569' }}>
                  Monto recibido (RD$)
                </label>
                <input
                  type="number"
                  value={montoRecibido}
                  placeholder={totalAmount > 0 ? totalAmount.toFixed(0) : "0"}
                  onChange={(e) => setMontoRecibido(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    borderRadius: '10px',
                    border: '1.5px solid #10b981',
                    background: '#ffffff',
                    fontSize: '0.95rem',
                    fontWeight: 700,
                    color: '#0f172a',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.15rem' }}>
                  <span style={{ fontSize: '0.825rem', fontWeight: 600, color: '#64748b' }}>Cambio (RD$)</span>
                  <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#059669' }}>
                    {devueltaAmount.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            )}

            {/* GIFT CARD CODE INPUT */}
            {(paymentMethod === 'Gift_Card' || paymentMethod === 'Gift Card') && (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.75rem' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.4rem' }}>
                  Código de Gift Card
                </label>
                <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.35rem' }}>
                  <input
                    type="text"
                    placeholder="Ej: GC-1234-PB"
                    value={giftCardCode}
                    onChange={(e) => setGiftCardCode(e.target.value)}
                    style={{ flex: 1, padding: '0.5rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.8rem', fontWeight: 600 }}
                  />
                  <button
                    type="button"
                    onClick={() => verifyGiftCard(giftCardCode)}
                    disabled={giftCardLoading || !giftCardCode.trim()}
                    style={{ padding: '0.5rem 0.8rem', borderRadius: '8px', background: '#059669', color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}
                  >
                    {giftCardLoading ? '...' : 'Verificar'}
                  </button>
                </div>
                {giftCardError && <p style={{ color: '#ef4444', fontSize: '0.7rem', margin: '0.2rem 0' }}>{giftCardError}</p>}
                {giftCardInfo && (
                  <div style={{ fontSize: '0.75rem', color: '#059669', fontWeight: 700, background: '#ecfdf5', padding: '0.4rem', borderRadius: '6px' }}>
                    ✓ Balance disponible: RD$ {Number(giftCardInfo.balance).toFixed(2)}
                  </div>
                )}
              </div>
            )}

            {/* MIXED PAYMENT CONTROLS */}
            {paymentMethod === 'Mixto' && (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.75rem' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '0.4rem' }}>
                  Combinación de Pagos
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                  <div>
                    <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Efectivo (RD$)</span>
                    <input
                      type="number"
                      placeholder="0.00"
                      value={mixedCashReceived}
                      onChange={(e) => setMixedCashReceived(e.target.value)}
                      style={{ width: '100%', padding: '0.45rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.8rem', fontWeight: 600, boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Segundo método</span>
                    <select
                      value={mixedComplementMethod}
                      onChange={(e) => setMixedComplementMethod(e.target.value)}
                      style={{ width: '100%', padding: '0.45rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.8rem', fontWeight: 600, background: '#fff', boxSizing: 'border-box' }}
                    >
                      <option value="Tarjeta">Tarjeta</option>
                      <option value="Transferencia">Transferencia</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* PLAN BEAUTY ACTIVE CONSUMPTION CARD (ONLY IF CLIENT HAS ACTIVE PLAN) */}
          {activePlans && activePlans.length > 0 && (
            <div style={{ background: '#f0fdf4', border: '1px solid #dcfce7', padding: '0.75rem', borderRadius: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <span style={{ fontSize: '0.775rem', fontWeight: 800, color: '#166534', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  💎 Plan Beauty Activo
                </span>
                <span style={{ fontSize: '0.7rem', color: '#15803d', fontWeight: 700 }}>
                  Lavados disponibles: {activePlans[0]?.remaining_washes || 3}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.725rem', color: '#166534' }}>
                <span>¿Desea consumir un lavado?</span>
                <label style={{ position: 'relative', display: 'inline-block', width: '36px', height: '20px', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={consumePlanWash}
                    onChange={(e) => setConsumePlanWash(e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0 }} 
                  />
                  <span style={{ position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0, background: consumePlanWash ? '#166534' : '#cbd5e1', borderRadius: '20px', transition: '0.2s' }}>
                    <span style={{ position: 'absolute', content: '""', height: '14px', width: '14px', left: consumePlanWash ? '19px' : '3px', bottom: '3px', background: '#ffffff', borderRadius: '50%', transition: '0.2s' }}></span>
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* APPLY DISCOUNT ACCORDION & PLAN REMINDER ALERT */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.75rem', background: '#ffffff', display: 'flex', flexDirection: 'column', gap: '0.65rem', width: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
            {/* Header Accordion */}
            <div 
              onClick={() => setIsDiscountOpen(!isDiscountOpen)}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none', width: '100%' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.825rem', fontWeight: 700, color: '#334155' }}>
                <Percent size={15} color="#475569" />
                <span>Aplicar descuento</span>
              </div>
              <ChevronDown 
                size={16} 
                color="#64748b" 
                style={{ transform: isDiscountOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }} 
              />
            </div>

            {/* Discount Inputs */}
            {isDiscountOpen && (
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', width: '100%', boxSizing: 'border-box' }}>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={globalDiscountValue}
                  onChange={(e) => setGlobalDiscountValue(e.target.value)}
                  placeholder="0.00"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    width: '100%',
                    padding: '0.55rem 0.65rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    color: '#0f172a',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
                <div style={{ position: 'relative', flexShrink: 0, width: '68px' }}>
                  <select
                    value={globalDiscountType}
                    onChange={(e) => setGlobalDiscountType(e.target.value)}
                    style={{
                      width: '100%',
                      appearance: 'none',
                      padding: '0.55rem 1.3rem 0.55rem 0.55rem',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      fontSize: '0.825rem',
                      fontWeight: 700,
                      color: '#334155',
                      cursor: 'pointer',
                      outline: 'none',
                      boxSizing: 'border-box',
                      textAlign: 'center'
                    }}
                  >
                    <option value="percentage">%</option>
                    <option value="amount">RD$</option>
                  </select>
                  <ChevronDown size={13} color="#64748b" style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                </div>
              </div>
            )}

            {/* Yellow/Amber Warning Alert Banner */}
            <div style={{
              background: '#fffbeb',
              border: '1px solid #fef3c7',
              borderRadius: '10px',
              padding: '0.65rem 0.8rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              width: '100%',
              boxSizing: 'border-box'
            }}>
              <AlertTriangle size={18} color="#d97706" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: '0.74rem', color: '#b45309', fontWeight: 600, lineHeight: 1.35 }}>
                Recuerda preguntar por los beneficios de su plan activo.
              </span>
            </div>
          </div>

          {/* FINAL ACTION BUTTONS */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <button
              onClick={handleFinalizeCheckout}
              disabled={loading || lineItems.length === 0}
              style={{
                width: '100%',
                background: '#e11d48',
                color: '#ffffff',
                border: 'none',
                padding: '0.8rem',
                borderRadius: '12px',
                fontWeight: 800,
                fontSize: '0.9rem',
                cursor: loading || lineItems.length === 0 ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
                boxShadow: '0 4px 12px rgba(225,29,72,0.25)'
              }}
            >
              <span>› FINALIZAR FACTURA</span>
              <Printer size={17} />
            </button>

            <button
              type="button"
              style={{
                width: '100%',
                background: '#ffffff',
                color: '#18181b',
                border: '1px solid #e4e4e7',
                padding: '0.65rem',
                borderRadius: '12px',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: 'pointer'
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
          <span>📄 Última factura: <strong style={{ color: '#18181b' }}>#000784</strong></span>
          <span 
            onClick={() => {
              if (selectedTicket || clientFound) {
                setPrintableTicketData({
                  ticketNumber: selectedTicket?.ticket_number || '#000785',
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

      {/* MODAL: GENERAR NUEVO TICKET CON BÚSQUEDA INTEGRADA DE CLIENTE */}
      {showNewTicketModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: '500px', borderRadius: '16px', padding: '1.5rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>🎟️ Generar Ticket de Servicio</h3>
            <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: '#64748b' }}>
              La búsqueda del cliente forma parte de la generación del ticket. Busca un cliente registrado o escribe el nombre.
            </p>

            <form onSubmit={handleCreateNewTicket}>
              {/* Búsqueda Predictiva de Cliente Integrada */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
                  🔍 Buscar Cliente Registrado (Cédula, Nombre o Teléfono):
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    placeholder="Escribe para buscar cliente..."
                    value={modalClientSearchTerm}
                    onChange={(e) => {
                      setModalClientSearchTerm(e.target.value);
                      setSelectedClientForTicket(null);
                    }}
                    style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 600 }}
                  />

                  {modalClientSearchTerm.trim().length > 0 && !selectedClientForTicket && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', maxHeight: '180px', overflowY: 'auto', zIndex: 10, boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}>
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

              {/* Indicador de cliente seleccionado o campo manual */}
              {selectedClientForTicket ? (
                <div style={{ background: '#f0fdf4', border: '1px solid #86efac', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ color: '#166534', fontSize: '0.85rem' }}>✅ Cliente Seleccionado: {selectedClientForTicket.nombre || selectedClientForTicket.name}</strong>
                    {selectedClientForTicket.cedula && (
                      <p style={{ margin: 0, fontSize: '0.75rem', color: '#15803d' }}>Cédula: {selectedClientForTicket.cedula}</p>
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
              ) : (
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
                    O escribe Nombre del Cliente (Invitado / General):
                  </label>
                  <input
                    type="text"
                    required={!selectedClientForTicket}
                    placeholder="Ej: Maria Rodriguez"
                    value={newTicketClientName}
                    onChange={(e) => setNewTicketClientName(e.target.value)}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 600 }}
                  />
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => setShowNewTicketModal(false)}
                  style={{ flex: 1, padding: '0.65rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', fontWeight: 700 }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  style={{ flex: 1, padding: '0.65rem', borderRadius: '8px', border: 'none', background: '#be185d', color: '#ffffff', fontWeight: 800 }}
                >
                  {loading ? 'Generando...' : 'Imprimir & Guardar'}
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

      {/* MODAL: AUTORIZACIÓN PIN ADMINISTRADOR (REDUCCIÓN PRECIO BASE) */}
      {showAdminPinModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: '400px', borderRadius: '16px', padding: '1.5rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
              <ShieldAlert size={36} style={{ color: '#be185d', marginBottom: '0.5rem' }} />
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>Autorización de Administrador</h3>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>Se requiere PIN para reducir precio por debajo de tarifa base</p>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <input
                type="password"
                placeholder="Ingresa Clave PIN Admin"
                value={adminPin}
                onChange={(e) => setAdminPin(e.target.value)}
                style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 700, textAlign: 'center', fontSize: '1.2rem', letterSpacing: '4px' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => { setShowAdminPinModal(false); setPendingDiscountItem(null); }}
                style={{ flex: 1, padding: '0.65rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', fontWeight: 700 }}
              >
                Cancelar
              </button>
              <button
                onClick={verifyAdminPin}
                style={{ flex: 1, padding: '0.65rem', borderRadius: '8px', border: 'none', background: '#be185d', color: '#ffffff', fontWeight: 800 }}
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
                  Cédula: {clientFound?.cedula || selectedTicket?.client_id} | Tel: {clientFound?.telefono || clientFound?.phone || '8293676453'}
                </p>
              </div>

              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>
                Registro de Visitas Previas
              </h4>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '0.75rem 1rem', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ fontSize: '0.85rem', color: '#0f172a', display: 'block' }}>Ticket SD-0042 - Lavado y Secado</strong>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>21/08/2026 - Sucursal San Vicente de Paúl</span>
                  </div>
                  <span style={{ background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 800 }}>
                    RD$ 800.00 (Facturado)
                  </span>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '0.75rem 1rem', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ fontSize: '0.85rem', color: '#0f172a', display: 'block' }}>Ticket SD-0028 - Plan Beauty Lavado Incluido</strong>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>14/08/2026 - Sucursal San Vicente de Paúl</span>
                  </div>
                  <span style={{ background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 800 }}>
                    Plan Beauty (RD$ 0.00)
                  </span>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '1.25rem', paddingTop: '0.75rem', borderTop: '1px solid #f1f5f9', textAlign: 'right' }}>
              <button
                onClick={() => setShowHistoryModal(false)}
                style={{ background: '#000000', color: '#ffffff', border: 'none', padding: '0.65rem 1.5rem', borderRadius: '8px', fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer' }}
              >
                Cerrar Historial
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: DETALLES DE CAJA Y MOVIMIENTOS EN TIEMPO REAL */}
      {showRegisterDetailsModal && activeRegister && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1070 }}>
          <div style={{ background: '#ffffff', width: '100%', maxWidth: '640px', borderRadius: '20px', padding: '1.5rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <CheckCircle2 size={24} style={{ color: '#10b981' }} />
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                    Caja de Jornada {activeRegister.register_number}
                  </h3>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {activeRegister.salon_name || 'Sucursal San Vicente de Paúl'} • Apertura: {new Date(activeRegister.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
              <button onClick={() => setShowRegisterDetailsModal(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                <X size={20} />
              </button>
            </div>

            {/* TAB SELECTION */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', background: '#f1f5f9', padding: '4px', borderRadius: '10px' }}>
              {[
                { id: 'resumen', label: '📊 Desglose de Ingresos' },
                { id: 'nuevo', label: '✍️ Registrar Movimiento' },
                { id: 'historial', label: '📋 Historial Movimientos' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setMovementActiveTab(tab.id)}
                  style={{
                    flex: 1,
                    padding: '0.5rem 0.75rem',
                    borderRadius: '8px',
                    border: 'none',
                    background: movementActiveTab === tab.id ? '#ffffff' : 'transparent',
                    color: movementActiveTab === tab.id ? '#be185d' : '#475569',
                    fontWeight: 800,
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    boxShadow: movementActiveTab === tab.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* TAB CONTENT */}
            <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.25rem' }}>
              {movementActiveTab === 'resumen' && (
                <div>
                  <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>
                    💰 Resumen en Tiempo Real por Método de Pago
                  </h4>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '0.75rem', borderRadius: '10px' }}>
                      <span style={{ fontSize: '0.7rem', color: '#166534', fontWeight: 800 }}>💵 EFECTIVO EN VENTAS:</span>
                      <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#15803d' }}>
                        RD$ {(registerSummary?.efectivoTotal || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </div>
                    </div>

                    <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', padding: '0.75rem', borderRadius: '10px' }}>
                      <span style={{ fontSize: '0.7rem', color: '#075985', fontWeight: 800 }}>💳 TARJETA (CARDNET):</span>
                      <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#0369a1' }}>
                        RD$ {(registerSummary?.tarjetaTotal || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </div>
                    </div>

                    <div style={{ background: '#faf5ff', border: '1px solid #e9d5ff', padding: '0.75rem', borderRadius: '10px' }}>
                      <span style={{ fontSize: '0.7rem', color: '#6b21a8', fontWeight: 800 }}>🏦 TRANSFERENCIA:</span>
                      <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#7e22ce' }}>
                        RD$ {(registerSummary?.transferenciaTotal || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </div>
                    </div>

                    <div style={{ background: '#fdf2f8', border: '1px solid #fbcfe8', padding: '0.75rem', borderRadius: '10px' }}>
                      <span style={{ fontSize: '0.7rem', color: '#9d174d', fontWeight: 800 }}>🎁 GIFT CARD:</span>
                      <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#be185d' }}>
                        RD$ {(registerSummary?.giftCardTotal || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </div>
                    </div>

                    <div style={{ background: '#fff7ed', border: '1px solid #ffedd5', padding: '0.75rem', borderRadius: '10px' }}>
                      <span style={{ fontSize: '0.7rem', color: '#9a3412', fontWeight: 800 }}>👤 CONSUMO EMPLEADOS:</span>
                      <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#c2410c' }}>
                        RD$ {(registerSummary?.consumoTotal || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </div>
                    </div>

                    <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '0.75rem', borderRadius: '10px' }}>
                      <span style={{ fontSize: '0.7rem', color: '#065f46', fontWeight: 800 }}>✨ PLAN BEAUTY:</span>
                      <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#047857' }}>
                        RD$ {(registerSummary?.planBeautyTotal || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>

                  <h4 style={{ margin: '1rem 0 0.5rem', fontSize: '0.85rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>
                    ⚙️ Movimientos Manuales Registrados
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
                    <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', padding: '0.5rem 0.75rem', borderRadius: '8px' }}>
                      <span style={{ fontSize: '0.65rem', color: '#991b1b', fontWeight: 800 }}>💸 GASTOS:</span>
                      <div style={{ fontSize: '0.95rem', fontWeight: 900, color: '#dc2626' }}>
                        - RD$ {(registerSummary?.gastosTotal || 0).toFixed(2)}
                      </div>
                    </div>
                    <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', padding: '0.5rem 0.75rem', borderRadius: '8px' }}>
                      <span style={{ fontSize: '0.65rem', color: '#9f1239', fontWeight: 800 }}>📤 RETIROS:</span>
                      <div style={{ fontSize: '0.95rem', fontWeight: 900, color: '#e11d48' }}>
                        - RD$ {(registerSummary?.retirosTotal || 0).toFixed(2)}
                      </div>
                    </div>
                    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '0.5rem 0.75rem', borderRadius: '8px' }}>
                      <span style={{ fontSize: '0.65rem', color: '#166534', fontWeight: 800 }}>📥 ENTRADAS:</span>
                      <div style={{ fontSize: '0.95rem', fontWeight: 900, color: '#16a34a' }}>
                        + RD$ {(registerSummary?.entradasTotal || 0).toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {/* ESTIMADO EN CAJA */}
                  <div style={{ background: '#0f172a', color: '#ffffff', padding: '1rem', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700, display: 'block' }}>ESTIMADO TOTAL EN CAJA FÍSICA:</span>
                      <span style={{ fontSize: '0.65rem', color: '#64748b' }}>Inicial ({registerSummary?.montoInicial || activeRegister.monto_inicial}) + Efectivo + Entradas - Gastos - Retiros</span>
                    </div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#34d399' }}>
                      RD$ {(registerSummary?.montoEstimadoEnCaja || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              )}

              {movementActiveTab === 'nuevo' && (
                <form onSubmit={handleSaveManualMovement}>
                  <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>
                    ✍️ Registrar Movimiento Manual de Caja
                  </h4>

                  <div style={{ marginBottom: '0.875rem' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
                      Tipo de Movimiento:
                    </label>
                    <select
                      value={newMovementType}
                      onChange={(e) => setNewMovementType(e.target.value)}
                      style={{ width: '100%', padding: '0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 800 }}
                    >
                      <option value="Gasto_Imprevisto">💸 Gasto Imprevisto (Salida de dinero)</option>
                      <option value="Retiro_Efectivo">📤 Retiro de Efectivo / Sangría (Salida de caja)</option>
                      <option value="Entrada_Adicional">📥 Entrada Adicional de Dinero (Ingreso a caja)</option>
                    </select>
                  </div>

                  <div style={{ marginBottom: '0.875rem' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
                      Monto del Movimiento (RD$):
                    </label>
                    <input
                      type="number"
                      placeholder="0.00"
                      value={newMovementAmount}
                      onChange={(e) => setNewMovementAmount(e.target.value)}
                      style={{ width: '100%', padding: '0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 800, fontSize: '1rem' }}
                    />
                  </div>

                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.25rem' }}>
                      Observaciones / Concepto del Movimiento:
                    </label>
                    <textarea
                      rows={3}
                      placeholder="Ej: Compra de insumos de limpieza de emergencia, retiro por seguridad a caja fuerte..."
                      value={newMovementConcept}
                      onChange={(e) => setNewMovementConcept(e.target.value)}
                      style={{ width: '100%', padding: '0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 600, fontSize: '0.85rem' }}
                    />
                  </div>

                  <div style={{ background: '#f8fafc', padding: '0.75rem', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: '1.25rem', fontSize: '0.75rem', color: '#64748b' }}>
                    👤 Registrado por: <strong>{currentUser?.nombre || activeRegister.employee_name || 'Cajero Principal'}</strong> | 🕒 Timestamp: <strong>{new Date().toLocaleTimeString()}</strong>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: 'none', background: '#be185d', color: '#ffffff', fontWeight: 800, fontSize: '0.9rem', cursor: 'pointer' }}
                  >
                    💾 Guardar Movimiento en Caja
                  </button>
                </form>
              )}

              {movementActiveTab === 'historial' && (
                <div>
                  <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>
                    📋 Historial de Movimientos de la Jornada ({registerMovements.length})
                  </h4>

                  {registerMovements.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', fontSize: '0.85rem' }}>
                      No hay movimientos registrados en esta sesión de caja.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {registerMovements.map(m => (
                        <div key={m.id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '0.75rem 1rem', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.2rem' }}>
                              <span style={{
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '0.65rem',
                                fontWeight: 800,
                                background: m.type === 'Ingreso_Venta' ? '#dcfce7' : m.type === 'Entrada_Adicional' ? '#dbeafe' : '#fef2f2',
                                color: m.type === 'Ingreso_Venta' ? '#15803d' : m.type === 'Entrada_Adicional' ? '#1e40af' : '#b91c1c'
                              }}>
                                {m.type === 'Ingreso_Venta' ? `Venta (${m.payment_method})` : m.type.replace('_', ' ')}
                              </span>
                              <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                                {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <span style={{ fontSize: '0.8rem', color: '#0f172a', fontWeight: 600 }}>{m.concept || 'Movimiento de Caja'}</span>
                            <span style={{ display: 'block', fontSize: '0.68rem', color: '#94a3b8' }}>Por: {m.user_name || 'Cajero'}</span>
                          </div>
                          <strong style={{ fontSize: '0.95rem', fontWeight: 900, color: m.type.includes('Gasto') || m.type.includes('Retiro') ? '#dc2626' : '#166534' }}>
                            {m.type.includes('Gasto') || m.type.includes('Retiro') ? '-' : '+'} RD$ {Number(m.amount).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                          </strong>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* FOOTER ACTIONS */}
            <div style={{ marginTop: '1.25rem', paddingTop: '0.75rem', borderTop: '1px solid #f1f5f9', display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => setShowRegisterDetailsModal(false)}
                style={{ flex: 1, padding: '0.75rem', borderRadius: '10px', border: '1px solid #cbd5e1', background: '#ffffff', fontWeight: 700, color: '#475569', cursor: 'pointer' }}
              >
                Cerrar Ventana
              </button>
              <button
                onClick={() => {
                  setShowRegisterDetailsModal(false);
                  setShowConfirmCloseModal(true);
                }}
                style={{ flex: 1, padding: '0.75rem', borderRadius: '10px', border: 'none', background: '#dc2626', color: '#ffffff', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
              >
                <LockIcon size={16} />
                <span>Cerrar Caja de Jornada</span>
              </button>
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

              <div style={{ marginTop: '0.6rem', paddingTop: '0.5rem', borderTop: '1px dashed #cbd5e1', display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                <span style={{ color: '#dc2626', fontWeight: 700 }}>💸 Total Gastos de la Jornada:</span>
                <strong style={{ color: '#dc2626' }}>- RD$ {(registerSummary?.gastosTotal || 0).toFixed(2)}</strong>
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
                ✉️ {clientFound?.email || 'melissa_rpt@hotmail.com'}
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

    </div>
  );
};

export default VisitRecorder;
