import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { 
  Search, Calendar, Scissors, Clock as ClockIcon, Mail, Save, UserCheck, Star, 
  Lock as LockIcon, ArrowLeft, PlusCircle, Printer, CheckCircle2, ShieldAlert, 
  Banknote, CreditCard, ChevronRight, RefreshCw, X
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
  const [activePlans, setActivePlans] = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState('none');
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);

  // Modals & Client Search for Ticket Generation
  const [showNewTicketModal, setShowNewTicketModal] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [printableTicketData, setPrintableTicketData] = useState(null);
  const [allClients, setAllClients] = useState([]);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [selectedClientForTicket, setSelectedClientForTicket] = useState(null);
  const [newTicketClientName, setNewTicketClientName] = useState('');
  const [newTicketCedula, setNewTicketCedula] = useState('');

  // Pricing & Admin Auth
  const [showAdminPinModal, setShowAdminPinModal] = useState(false);
  const [adminPin, setAdminPin] = useState('');
  const [pendingDiscountItem, setPendingDiscountItem] = useState(null);
  const [isAdminAuthorized, setIsAdminAuthorized] = useState(false);

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

  // Load Pending Tickets, Employees, Cash Register, and Clients on Mount
  useEffect(() => {
    fetchPendingTickets();
    fetchEmployees();
    fetchActiveRegister();
    fetchClients();
  }, [salonId]);

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
    const searchTarget = (clientId && clientId !== 'INVITADO') ? clientId : (clientName || '');
    if (!searchTarget && !ticketObj?.plan_beauty_id) return;

    let found = await dataService.getClientById(searchTarget).catch(() => null);
    if (!found) {
      const allC = await dataService.getClients().catch(() => []);
      const targetClean = String(searchTarget).trim().toLowerCase();
      found = allC.find(c => (c.nombre || c.name || '').trim().toLowerCase() === targetClean || c.cedula === searchTarget);
    }
    if (found) setClientFound(found);

    // Multi-stage contract lookup (searchTarget -> found.id -> found.cedula -> found.nombre)
    let contractsFound = await dataService.getContractByClient(searchTarget) || [];
    if ((!contractsFound || contractsFound.length === 0) && found) {
      if (found.id && found.id !== searchTarget) {
        contractsFound = await dataService.getContractByClient(found.id) || [];
      }
      if ((!contractsFound || contractsFound.length === 0) && found.cedula) {
        contractsFound = await dataService.getContractByClient(found.cedula) || [];
      }
      if ((!contractsFound || contractsFound.length === 0) && found.nombre) {
        contractsFound = await dataService.getContractByClient(found.nombre.trim()) || [];
      }
    }

    const pastVisits = await dataService.getVisitsByClient(searchTarget) || [];
    const allPlans = await dataService.getPlans();

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

    let planesConContrato = (Array.isArray(contractsFound) ? contractsFound : []).map(contract => {
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
      const threshold = lastBillingTime + 10000;
      const cycleVisits = pastVisits.filter(v => parseDate(v.visited_at) >= threshold);

      return {
        ...matchedPlan,
        id: contract.plan_id,
        contract_id: contract.id,
        title: contract.planTitle || matchedPlan?.title || 'Plan Beauty',
        services: allServices,
        baseServices,
        promoServices,
        cycleVisitsCount: cycleVisits.length,
        isPromoActive: parseInt(contract.contract_promo_duration || 0, 10) > 0
      };
    });

    // Fallback: If planesConContrato is empty but ticketObj or found indicates a Plan Beauty membership
    if (planesConContrato.length === 0 && (ticketObj?.plan_beauty_id || found?.status === 'Active')) {
      planesConContrato = [{
        id: ticketObj?.plan_beauty_id || '1',
        title: 'Plan Beauty',
        services: ['Lavado y secado ilimitados']
      }];
    }

    setActivePlans(planesConContrato);
    if (planesConContrato.length > 0) {
      setSelectedPlanId(planesConContrato[0].id.toString());
      setAvailableServices(planesConContrato[0].services.length > 0 
        ? planesConContrato[0].services.map((s, idx) => typeof s === 'string' ? { id: `plan-${idx}`, nombre: s, precio: 0 } : s) 
        : DEFAULT_TOP_SERVICES
      );
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

  // Line Items Controls (Price rules)
  const addServiceToLineItems = (service) => {
    const firstEmp = employees[0] || { id: 'EMP-1', nombre: 'Ana Gómez' };
    const newItem = {
      id: Date.now() + Math.random(),
      service_id: service.id,
      nombre: service.nombre,
      precioBase: service.precio,
      precioAplicado: service.precio,
      cantidad: 1,
      empleado: firstEmp.nombre,
      empleado_id: firstEmp.id,
      empleado_nombre: firstEmp.nombre,
      descuento: 0
    };
    setLineItems([...lineItems, newItem]);
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

  const calculateTotal = () => {
    return lineItems.reduce((acc, item) => acc + (item.precioAplicado * item.cantidad) - (item.descuento || 0), 0);
  };

  const totalAmount = calculateTotal();

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

    if (!selectedTicket) return;

    if (lineItems.length === 0) {
      alert('⚠️ No se han agregado servicios a este ticket. Por favor selecciona al menos un servicio antes de facturar.');
      return;
    }

    // Cash Payment Validations
    if (paymentMethod === 'Efectivo') {
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

    // Handle Employee Payroll OTP verification if payroll consumption selected
    if (paymentMethod === 'Nomina_Empleado') {
      if (!selectedEmployeeForConsumption) {
        alert('Por favor selecciona el empleado a cuyo salario se cargará este consumo.');
        return;
      }
      const empObj = employees.find(e => e.id.toString() === selectedEmployeeForConsumption.toString());
      if (empObj) {
        setIsSendingOtp(true);
        await dataService.sendEmployeeOtp({
          employeeId: empObj.id,
          employeeEmail: empObj.email || empObj.contacto,
          employeeName: empObj.nombre
        }).catch(() => {});
        setIsSendingOtp(false);
        setShowOtpModal(true);
        return;
      }
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

      await dataService.checkoutTicket(selectedTicket.id, {
        total: totalAmount,
        monto_recibido: finalMontoRecibido,
        devuelta: finalDevuelta,
        metodo_pago: finalMetodoPago,
        items_detail: lineItems,
        employee_consumption: empCons,
        gift_card_redemption: gcRedemption
      });

      alert('✅ Factura finalizada exitosamente.');
      setShowOtpModal(false);
      setSelectedTicket(null);
      setIsTicketExpanded(false);
      setLineItems([]);
      setMontoRecibido('');
      await fetchPendingTickets();
    } catch (err) {
      alert('Error al finalizar factura: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '1rem' }}>
      
      {/* HEADER / CASH REGISTER BADGE */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', background: '#0f172a', color: '#ffffff', padding: '1rem 1.5rem', borderRadius: '16px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, letterSpacing: '-0.5px' }}>
            Módulo de Facturación POS <span>SALON PRO</span>
          </h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#94a3b8' }}>
            Gestión de Tickets Pendientes y Ventas en Proceso
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {activeRegister ? (
            <div 
              onClick={() => setShowRegisterDetailsModal(true)}
              style={{ 
                background: '#065f46', 
                border: '2px solid #10b981', 
                padding: '0.5rem 1rem', 
                borderRadius: '12px', 
                fontSize: '0.85rem', 
                fontWeight: 800, 
                color: '#ffffff', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.6rem',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(16,185,129,0.25)',
                transition: 'all 0.2s'
              }}
              title="Haz clic para ver detalles de la caja o realizar el cierre manual de jornada"
            >
              <CheckCircle2 size={18} style={{ color: '#34d399' }} />
              <div>
                <span style={{ display: 'block', fontSize: '0.65rem', color: '#a7f3d0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  CAJA ACTIVA (VER DETALLES / CERRAR)
                </span>
                <span style={{ fontSize: '0.9rem', fontWeight: 900, color: '#ffffff' }}>
                  {activeRegister.register_number || 'Jornada Abierta'}
                </span>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowRegisterOpenModal(true)}
              style={{ background: '#be185d', color: '#ffffff', border: 'none', padding: '0.6rem 1.2rem', borderRadius: '12px', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <LockIcon size={16} />
              <span>Abrir Caja de Jornada</span>
            </button>
          )}

          <button
            onClick={() => {
              if (!activeRegister) {
                alert('🔒 DEBE ABRIR LA CAJA DE JORNADA PRIMERO\n\nNo se pueden generar nuevos tickets de atención si no existe una caja abierta para la jornada actual.');
                setShowRegisterOpenModal(true);
                return;
              }
              setShowNewTicketModal(true);
            }}
            style={{ 
              background: activeRegister ? 'linear-gradient(135deg, #ec4899, #be185d)' : '#64748b', 
              color: '#ffffff', 
              border: 'none', 
              padding: '0.65rem 1.25rem', 
              borderRadius: '12px', 
              fontWeight: 800, 
              fontSize: '0.9rem', 
              cursor: 'pointer', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.5rem', 
              boxShadow: activeRegister ? '0 4px 12px rgba(236,72,153,0.3)' : 'none',
              opacity: activeRegister ? 1 : 0.85
            }}
            title={activeRegister ? 'Generar nuevo ticket de servicio' : 'Debe abrir la caja antes de generar un nuevo ticket'}
          >
            <PlusCircle size={18} />
            <span>+ Generar Nuevo Ticket</span>
          </button>
        </div>
      </div>

      {/* MAIN TWO-COLUMN LAYOUT */}
      <div style={{ display: 'grid', gridTemplateColumns: selectedTicket ? '360px 1fr' : '360px 1fr', gap: '1.25rem', transition: 'all 0.3s ease' }}>
        
        {/* COLUMN 1: SWAPS BETWEEN PENDING TICKETS LIST AND SELECTED CLIENT EXPANDED PROFILE */}
        {!selectedTicket ? (
          /* STATE A: LISTADO DE TICKETS PENDIENTES DE LA SUCURSAL */
          <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '1.25rem', height: 'fit-content' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
                🎟️ Tickets Pendientes ({pendingTickets.length})
              </h3>
              <button onClick={fetchPendingTickets} style={{ background: 'transparent', border: 'none', color: '#ec4899', cursor: 'pointer' }}>
                <RefreshCw size={16} />
              </button>
            </div>

            {pendingTickets.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#94a3b8' }}>
                <ClockIcon size={32} style={{ margin: '0 auto 0.5rem', opacity: 0.5 }} />
                <p style={{ margin: 0, fontSize: '0.85rem' }}>No hay tickets pendientes en esta sucursal.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '600px', overflowY: 'auto' }}>
                {pendingTickets.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => handleSelectTicket(t)}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      borderRadius: '12px',
                      padding: '1rem',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
                    }}
                    className="hover-lift"
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem', alignItems: 'center' }}>
                      <span style={{ fontWeight: 800, fontSize: '0.85rem', color: '#be185d' }}>
                        🎫 {t.ticket_number || `#${t.id.slice(-4)}`}
                      </span>
                      <span style={{ fontSize: '0.7rem', background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: '12px', fontWeight: 800 }}>
                        PENDIENTE DE FACTURAR
                      </span>
                    </div>
                    <h4 style={{ margin: '0 0 0.25rem', fontSize: '0.95rem', fontWeight: 800, color: '#0f172a' }}>
                      👤 {t.client_name}
                    </h4>
                    {t.plan_beauty_id && (
                      <div style={{ background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '2px 8px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 800, marginBottom: '0.35rem', display: 'inline-block' }}>
                        ✨ Plan Beauty Activo
                      </div>
                    )}
                    <p style={{ margin: '0 0 0.35rem', fontSize: '0.75rem', color: '#ec4899', fontWeight: 700 }}>
                      📍 {t.salon_name || 'Sucursal San Vicente de Paúl'}
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: '#64748b', borderTop: '1px dashed #e2e8f0', paddingTop: '0.4rem', marginTop: '0.4rem' }}>
                      <span>🕒 {new Date(t.visited_at).toLocaleDateString('es-DO')} {new Date(t.visited_at).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}</span>
                      <ChevronRight size={16} style={{ color: '#be185d' }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* STATE B: COLUMNA 1 SE TRANSFORMA EN REPLICA EXACTA DE LA TARJETA DE CLIENTE */
          <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '1.25rem', height: 'fit-content', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
            
            {/* BOTÓN VOLVER ATRÁS */}
            <button
              onClick={handleVolverAtras}
              style={{ width: '100%', background: '#fdf2f8', border: '1px solid #fbcfe8', color: '#be185d', padding: '0.65rem 1rem', borderRadius: '12px', fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}
            >
              <ArrowLeft size={16} />
              <span>⬅️ Volver Atrás (Guarda Borrador)</span>
            </button>

            {/* HEADER CLIENTE CON AVATAR E ID (EXACTO A IMAGEN 1) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', marginBottom: '1.25rem' }}>
              <div style={{ width: '54px', height: '54px', borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', fontWeight: 800, color: '#0f172a', border: '1px solid #e2e8f0', flexShrink: 0 }}>
                {(clientFound?.nombre || selectedTicket.client_name || 'C').charAt(0).toUpperCase()}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 900, color: '#0f172a', lineHeight: 1.2 }}>
                  {clientFound?.nombre || selectedTicket.client_name}
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.25rem' }}>
                  <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
                    ID: {clientFound?.cedula || selectedTicket.client_id || '223-0027553-8'}
                  </span>
                  <span style={{ background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '1px 6px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 800 }}>
                    SELF
                  </span>
                </div>
              </div>
            </div>

            {/* MEMBRESÍA ACTIVA CAJA VERDE (EXACTO A IMAGEN 1) */}
            {(activePlans.length > 0 || selectedTicket?.plan_beauty_id) ? (
              <div style={{ background: '#f0fdf4', border: '1px solid #dcfce7', padding: '1rem 1.25rem', borderRadius: '14px', marginBottom: '1.25rem' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#166534', letterSpacing: '0.5px', textTransform: 'uppercase', display: 'block' }}>
                  MEMBRESÍA ACTIVA
                </span>
                <h4 style={{ margin: '0.2rem 0 0', fontSize: '1.1rem', fontWeight: 900, color: '#065f46' }}>
                  {activePlans[0]?.title || 'Plan Beauty'}
                </h4>
              </div>
            ) : (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '0.875rem 1rem', borderRadius: '14px', marginBottom: '1.25rem' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', display: 'block' }}>
                  ESTADO DE MEMBRESÍA
                </span>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', fontWeight: 600, color: '#475569' }}>
                  Sin suscripción Plan Beauty activa
                </p>
              </div>
            )}

            {/* DATOS DE CONTACTO (EXACTO A IMAGEN 1) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.25rem', fontSize: '0.875rem', color: '#334155', fontWeight: 600 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span style={{ color: '#94a3b8', fontSize: '1rem' }}>📞</span>
                <span>{clientFound?.telefono || clientFound?.phone || '8293676453'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span style={{ color: '#94a3b8', fontSize: '1rem' }}>✉️</span>
                <span>{clientFound?.email || 'melissa_rpt@hotmail.com'}</span>
              </div>
            </div>

            {/* BOTÓN NEGRO: VER HISTORIAL COMPLETO (EXACTO A IMAGEN 1) */}
            <button
              onClick={() => setShowHistoryModal(true)}
              style={{ width: '100%', background: '#000000', color: '#ffffff', border: 'none', padding: '0.8rem', borderRadius: '10px', fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer', textAlign: 'center' }}
            >
              Ver Historial Completo
            </button>
          </div>
        )}

        {/* COLUMN 2: POS SERVICES & BILLING EDITOR */}
        {selectedTicket ? (
          <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '1.5rem' }}>
            
            {/* CLIENT & TICKET BANNER */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '2px solid #f1f5f9', paddingBottom: '0.75rem' }}>
              <div>
                <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>Facturando Venta en Proceso:</span>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 900, color: '#0f172a' }}>
                  {selectedTicket.client_name} ({selectedTicket.ticket_number})
                </h3>
              </div>

              <div style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '0.4rem 0.875rem', borderRadius: '20px', fontWeight: 800, fontSize: '0.75rem' }}>
                EN CURSO DE FACTURACIÓN
              </div>
            </div>

            {/* AUTOMATIC PLAN BEAUTY BADGE */}
            {activePlans.length > 0 && (
              <div style={{ background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', border: '1px solid #86efac', padding: '0.875rem 1.25rem', borderRadius: '12px', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <Star size={22} style={{ color: '#16a34a' }} />
                  <div>
                    <strong style={{ color: '#166534', fontSize: '0.9rem' }}>Socio Plan Beauty Activo</strong>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#15803d' }}>
                      {activePlans[0].title} - Lavados y beneficios disponibles detectados automáticamente
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* TOP 7 ACCESOS RÁPIDOS & CATÁLOGO */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                ⚡ Accesos Rápidos Top 7 Servicios
              </h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {DEFAULT_TOP_SERVICES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => addServiceToLineItems(s)}
                    style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.5rem 0.875rem', fontSize: '0.85rem', fontWeight: 700, color: '#0f172a', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    className="hover-lift"
                  >
                    <span>+ {s.nombre}</span>
                    <span style={{ color: '#be185d', fontSize: '0.8rem' }}>RD$ {s.precio}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* LINE ITEMS TABLE (PRECIO EDITABLE CON RESTRICCIÓN DE DESCUENTO) */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>
                  🛒 Servicios Agregados ({lineItems.length})
                </h4>
                <span style={{ fontSize: '0.75rem', background: '#eff6ff', color: '#1d4ed8', padding: '3px 8px', borderRadius: '6px', fontWeight: 700, border: '1px solid #bfdbfe' }}>
                  💡 Cajero puede aumentar precio libremente • Descuentos requieren PIN Admin
                </span>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f1f5f9', color: '#334155', textAlign: 'left' }}>
                    <th style={{ padding: '10px 12px', borderRadius: '8px 0 0 8px' }}>Servicio</th>
                    <th style={{ padding: '10px 12px' }}>Estilista / Colaborador</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Precio Base</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Precio Aplicado (RD$)</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', borderRadius: '0 8px 8px 0' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                        No se han agregado servicios a este ticket. Selecciona de los accesos rápidos arriba.
                      </td>
                    </tr>
                  ) : (
                    lineItems.map((item, idx) => (
                      <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 700, color: '#0f172a' }}>{item.nombre}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <select
                            value={item.empleado_id || item.empleado}
                            onChange={(e) => {
                              const selectedVal = e.target.value;
                              const empObj = employees.find(emp => emp.id.toString() === selectedVal || emp.nombre === selectedVal);
                              const updated = [...lineItems];
                              updated[idx].empleado = empObj?.nombre || selectedVal;
                              updated[idx].empleado_id = empObj?.id || selectedVal;
                              updated[idx].empleado_nombre = empObj?.nombre || selectedVal;
                              setLineItems(updated);
                            }}
                            style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem', fontWeight: 700, color: '#0f172a' }}
                          >
                            {employees.map(emp => (
                              <option key={emp.id} value={emp.id}>{emp.nombre} ({emp.cargo || 'Colaborador'})</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: '#64748b' }}>
                          RD$ {item.precioBase}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          <input
                            type="number"
                            value={item.precioAplicado}
                            onChange={(e) => handlePriceChange(idx, e.target.value)}
                            style={{ width: '100px', textAlign: 'right', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 700, color: item.precioAplicado > item.precioBase ? '#be185d' : '#0f172a' }}
                          />
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <button onClick={() => removeLineItem(idx)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                            <X size={16} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* CHECKOUT & REAL-TIME DEVUELTA SECTION */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1.25rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1.5rem' }}>
                <div>
                  <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>
                    💳 Método de Pago
                  </h4>
                  <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                    {['Efectivo', 'Tarjeta (CardNet)', 'Transferencia', 'Gift_Card', 'Nomina_Empleado'].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPaymentMethod(m)}
                        style={{
                          flex: 1,
                          minWidth: '100px',
                          padding: '0.6rem 0.4rem',
                          borderRadius: '8px',
                          border: `1px solid ${paymentMethod === m ? '#be185d' : '#cbd5e1'}`,
                          background: paymentMethod === m ? '#fdf2f8' : '#ffffff',
                          color: paymentMethod === m ? '#be185d' : '#334155',
                          fontWeight: 700,
                          fontSize: '0.75rem',
                          cursor: 'pointer'
                        }}
                      >
                        {m === 'Nomina_Empleado' ? 'Consumo Empleado' : m === 'Gift_Card' ? '🎁 Gift Card' : m}
                      </button>
                    ))}
                  </div>

                  {/* GIFT CARD & PAGO MIXTO SECTION */}
                  {paymentMethod === 'Gift_Card' && (
                    <div style={{ background: '#ffffff', padding: '1rem', borderRadius: '12px', border: '1px solid #cbd5e1', marginBottom: '0.5rem' }}>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, color: '#334155', marginBottom: '0.35rem' }}>
                        🎟️ Código de Gift Card / Certificado:
                      </label>
                      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        <input
                          type="text"
                          placeholder="Ej: GC-123456"
                          value={giftCardCode}
                          onChange={(e) => {
                            setGiftCardCode(e.target.value.toUpperCase());
                            setGiftCardError('');
                          }}
                          style={{ flex: 1, padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 800, textTransform: 'uppercase', fontSize: '0.95rem' }}
                        />
                        <button
                          type="button"
                          onClick={() => handleVerifyGiftCard()}
                          disabled={giftCardLoading}
                          style={{ background: '#be185d', color: '#ffffff', border: 'none', borderRadius: '8px', padding: '0.55rem 1rem', fontWeight: 800, cursor: 'pointer', fontSize: '0.8rem' }}
                        >
                          {giftCardLoading ? 'Verificando...' : '🔍 Verificar Balance'}
                        </button>
                      </div>

                      {giftCardError && (
                        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', padding: '0.5rem 0.75rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.75rem' }}>
                          ❌ {giftCardError}
                        </div>
                      )}

                      {giftCardInfo && (
                        <div>
                          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '0.75rem', borderRadius: '10px', marginBottom: '0.75rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#166534' }}>
                                ✅ Gift Card Válida ({giftCardInfo.code})
                              </span>
                              <span style={{ fontSize: '0.95rem', fontWeight: 900, color: '#15803d' }}>
                                Balance: RD$ {Number(giftCardInfo.balance).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                          </div>

                          {/* PAGO COMPLETO O PAGO MIXTO */}
                          {Number(giftCardInfo.balance) >= totalAmount ? (
                            <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '0.75rem', borderRadius: '10px', color: '#065f46', fontSize: '0.85rem', fontWeight: 800 }}>
                              🎉 ¡Factura cubierta 100% por Gift Card!
                              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#047857', marginTop: '0.2rem' }}>
                                Saldo restante en tarjeta tras cobro: RD$ {(Number(giftCardInfo.balance) - totalAmount).toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                              </div>
                            </div>
                          ) : (
                            /* PAGO MIXTO REQUERIDO */
                            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', padding: '0.875rem', borderRadius: '12px' }}>
                              <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#92400e', marginBottom: '0.5rem' }}>
                                🔀 Pago Mixto Requerido (El balance no cubre el total):
                              </div>
                              <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                                <div style={{ flex: 1, background: '#ffffff', padding: '0.5rem', borderRadius: '6px', border: '1px solid #fef3c7' }}>
                                  <span style={{ color: '#78350f', display: 'block', fontSize: '0.7rem', fontWeight: 700 }}>Cubierto por Gift Card:</span>
                                  <strong style={{ color: '#166534', fontSize: '0.95rem' }}>RD$ {Number(giftCardInfo.balance).toFixed(2)}</strong>
                                </div>
                                <div style={{ flex: 1, background: '#ffffff', padding: '0.5rem', borderRadius: '6px', border: '1px solid #fef3c7' }}>
                                  <span style={{ color: '#78350f', display: 'block', fontSize: '0.7rem', fontWeight: 700 }}>Saldo Restante a Pagar:</span>
                                  <strong style={{ color: '#be185d', fontSize: '0.95rem' }}>RD$ {(totalAmount - Number(giftCardInfo.balance)).toFixed(2)}</strong>
                                </div>
                              </div>

                              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 800, color: '#78350f', marginBottom: '0.35rem' }}>
                                Seleccionar Método para el Saldo Restante (RD$ {(totalAmount - Number(giftCardInfo.balance)).toFixed(2)}):
                              </label>
                              <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem' }}>
                                {['Efectivo', 'Tarjeta (CardNet)', 'Transferencia'].map(m => (
                                  <button
                                    key={m}
                                    type="button"
                                    onClick={() => setMixedComplementMethod(m)}
                                    style={{
                                      flex: 1,
                                      padding: '0.4rem 0.5rem',
                                      borderRadius: '6px',
                                      border: mixedComplementMethod === m ? '2px solid #be185d' : '1px solid #cbd5e1',
                                      background: mixedComplementMethod === m ? '#fdf2f8' : '#ffffff',
                                      color: mixedComplementMethod === m ? '#be185d' : '#334155',
                                      fontWeight: 800,
                                      fontSize: '0.75rem',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    {m}
                                  </button>
                                ))}
                              </div>

                              {mixedComplementMethod === 'Efectivo' && (
                                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                                  <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: '#78350f', marginBottom: '0.2rem' }}>
                                      Efectivo Recibido para el Restante:
                                    </label>
                                    <input
                                      type="text"
                                      placeholder="0.00"
                                      value={mixedCashReceived}
                                      onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                                      onChange={(e) => {
                                        const val = e.target.value.replace(/[^0-9.]/g, '');
                                        const parts = val.split('.');
                                        if (parts.length > 2) return;
                                        setMixedCashReceived(val);
                                      }}
                                      style={{ width: '100%', padding: '0.45rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 800, fontSize: '0.9rem' }}
                                    />
                                  </div>
                                  <div style={{ flex: 1, background: '#ffffff', padding: '0.45rem', borderRadius: '6px', border: '1px solid #fde68a' }}>
                                    <span style={{ fontSize: '0.7rem', color: '#92400e', fontWeight: 800 }}>DEVUELTA EFECTIVO:</span>
                                    <div style={{ fontSize: '0.95rem', fontWeight: 900, color: (parseFloat(mixedCashReceived) || 0) >= (totalAmount - Number(giftCardInfo.balance)) ? '#15803d' : '#b45309' }}>
                                      {(parseFloat(mixedCashReceived) || 0) >= (totalAmount - Number(giftCardInfo.balance))
                                        ? `RD$ ${((parseFloat(mixedCashReceived) || 0) - (totalAmount - Number(giftCardInfo.balance))).toFixed(2)}`
                                        : `Falta RD$ ${((totalAmount - Number(giftCardInfo.balance)) - (parseFloat(mixedCashReceived) || 0)).toFixed(2)}`
                                      }
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {paymentMethod === 'Efectivo' && (
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem' }}>
                          Monto Recibido Efectivo (RD$):
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="Ej: 1000.00"
                          value={montoRecibido}
                          onKeyDown={(e) => {
                            if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
                          }}
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9.]/g, '');
                            const parts = val.split('.');
                            if (parts.length > 2) return;
                            setMontoRecibido(val);
                          }}
                          style={{
                            width: '100%',
                            padding: '0.55rem 0.75rem',
                            borderRadius: '8px',
                            border: `2px solid ${(parseFloat(montoRecibido) || 0) < totalAmount && totalAmount > 0 ? '#fca5a5' : '#cbd5e1'}`,
                            fontWeight: 800,
                            fontSize: '1rem',
                            outline: 'none'
                          }}
                        />
                      </div>
                      <div style={{ 
                        flex: 1, 
                        background: (parseFloat(montoRecibido) || 0) >= totalAmount ? '#f0fdf4' : '#fef3c7', 
                        padding: '0.5rem 0.75rem', 
                        borderRadius: '8px', 
                        border: `1px solid ${(parseFloat(montoRecibido) || 0) >= totalAmount ? '#86efac' : '#fde68a'}` 
                      }}>
                        <span style={{ fontSize: '0.75rem', color: (parseFloat(montoRecibido) || 0) >= totalAmount ? '#166534' : '#92400e', fontWeight: 800 }}>
                          {(parseFloat(montoRecibido) || 0) >= totalAmount ? '✅ DEVUELTA / CAMBIO:' : '⚠️ MONTO INSUFICIENTE:'}
                        </span>
                        <div style={{ fontSize: '1.1rem', fontWeight: 900, color: (parseFloat(montoRecibido) || 0) >= totalAmount ? '#15803d' : '#b45309' }}>
                          {(parseFloat(montoRecibido) || 0) >= totalAmount 
                            ? `RD$ ${devueltaAmount.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`
                            : `Falta RD$ ${(totalAmount - (parseFloat(montoRecibido) || 0)).toLocaleString('es-DO', { minimumFractionDigits: 2 })}`
                          }
                        </div>
                      </div>
                    </div>
                  )}

                  {paymentMethod === 'Nomina_Empleado' && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem' }}>
                        Seleccionar Empleado (Deducción Nómina con Hora):
                      </label>
                      <select
                        value={selectedEmployeeForConsumption}
                        onChange={(e) => setSelectedEmployeeForConsumption(e.target.value)}
                        style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                      >
                        <option value="">-- Seleccionar Colaborador --</option>
                        {employees.map(emp => (
                          <option key={emp.id} value={emp.id}>{emp.nombre} - {emp.posicion || 'Personal'}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <span style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 700 }}>TOTAL FACTURA:</span>
                    <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#10b981' }}>
                      RD$ {totalAmount.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                    </div>
                  </div>

                  <button
                    onClick={handleFinalizeCheckout}
                    disabled={loading || lineItems.length === 0}
                    style={{
                      width: '100%',
                      background: 'linear-gradient(135deg, #10b981, #059669)',
                      color: '#ffffff',
                      border: 'none',
                      padding: '0.875rem',
                      borderRadius: '12px',
                      fontWeight: 800,
                      fontSize: '1rem',
                      cursor: loading || lineItems.length === 0 ? 'not-allowed' : 'pointer',
                      boxShadow: '0 4px 14px rgba(16,185,129,0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem'
                    }}
                  >
                    <CheckCircle2 size={20} />
                    <span>FINALIZAR & FACTURAR</span>
                  </button>
                </div>
              </div>
            </div>

          </div>
        ) : (
          <div style={{ background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
            <Scissors size={48} style={{ margin: '0 auto 1rem', opacity: 0.4 }} />
            <h3 style={{ margin: 0, color: '#334155', fontWeight: 700 }}>Selecciona o Genera un Ticket para Iniciar la Facturación</h3>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>El flujo de facturación se administra a partir de los tickets pendientes de la sucursal.</p>
          </div>
        )}
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
                    value={clientSearchTerm}
                    onChange={(e) => {
                      setClientSearchTerm(e.target.value);
                      setSelectedClientForTicket(null);
                    }}
                    style={{ width: '100%', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 600 }}
                  />

                  {clientSearchTerm.trim().length > 0 && !selectedClientForTicket && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', maxHeight: '180px', overflowY: 'auto', zIndex: 10, boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}>
                      {allClients
                        .filter(c => {
                          const term = clientSearchTerm.toLowerCase();
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
                              setClientSearchTerm(cli.nombre || cli.name);
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
                      setClientSearchTerm('');
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
                PLAN BEAUTY <span>SALON PRO</span>
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

    </div>
  );
};

export default VisitRecorder;
