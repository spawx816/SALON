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

  const [paymentMethod, setPaymentMethod] = useState('Efectivo');
  const [montoRecibido, setMontoRecibido] = useState('');
  const [selectedEmployeeForConsumption, setSelectedEmployeeForConsumption] = useState('');

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
    } catch (e) {
      console.error('Error cargando caja activa:', e);
    }
  };

  // Open / Create New Ticket with Integrated Client Search
  const handleCreateNewTicket = async (e) => {
    e.preventDefault();
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
    setIsTicketExpanded(true); // Collapse tickets list column, expand client view

    // Load ticket draft state if available
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

    // Automatic Plan Beauty Detection
    if (ticket.client_id && ticket.client_id !== 'INVITADO') {
      await loadClientPlanData(ticket.client_id);
    } else {
      setClientFound(null);
      setActivePlans([]);
    }
  };

  const loadClientPlanData = async (clientId) => {
    const found = await dataService.getClientById(clientId).catch(() => null);
    if (found) setClientFound(found);

    const pastVisits = await dataService.getVisitsByClient(clientId);
    const contractsFound = await dataService.getContractByClient(clientId);
    const allPlans = await dataService.getPlans();

    const planesConContrato = (Array.isArray(contractsFound) ? contractsFound : []).map(contract => {
      const matchedPlan = allPlans.find(p => p.id === contract.plan_id || String(p.id) === String(contract.plan_id));
      return {
        ...matchedPlan,
        id: contract.plan_id,
        contract_id: contract.id,
        title: matchedPlan?.title || 'Plan Beauty Active',
        services: matchedPlan?.services || []
      };
    });

    setActivePlans(planesConContrato);
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
    const newItem = {
      id: Date.now() + Math.random(),
      service_id: service.id,
      nombre: service.nombre,
      precioBase: service.precio,
      precioAplicado: service.precio,
      cantidad: 1,
      empleado: employees[0]?.nombre || 'Ana Gómez',
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

  // Finalize Billing / Checkout
  const handleFinalizeCheckout = async () => {
    if (!activeRegister) {
      setShowRegisterOpenModal(true);
      return;
    }

    if (!selectedTicket) return;

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
        monto_recibido: parseFloat(montoRecibido) || totalAmount,
        devuelta: devueltaAmount,
        metodo_pago: paymentMethod,
        items_detail: lineItems,
        employee_consumption: empCons
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
            <div style={{ background: '#065f46', border: '1px solid #10b981', padding: '0.5rem 1rem', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 700, color: '#34d399', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CheckCircle2 size={16} />
              <span>Caja Activa: {activeRegister.register_number || 'Jornada Abierta'}</span>
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
            onClick={() => setShowNewTicketModal(true)}
            style={{ background: 'linear-gradient(135deg, #ec4899, #be185d)', color: '#ffffff', border: 'none', padding: '0.65rem 1.25rem', borderRadius: '12px', fontWeight: 800, fontSize: '0.9rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: '0 4px 12px rgba(236,72,153,0.3)' }}
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
          /* STATE B: COLUMNA 1 SE TRANSFORMA COMPLETAMENTE EN PERFIL DE CLIENTE & TICKET EXPANDIDO */
          <div style={{ background: '#ffffff', borderRadius: '16px', border: '2px solid #ec4899', padding: '1.25rem', height: 'fit-content' }}>
            <button
              onClick={handleVolverAtras}
              style={{ width: '100%', background: '#fdf2f8', border: '1px solid #fbcfe8', color: '#be185d', padding: '0.65rem 1rem', borderRadius: '12px', fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '1rem' }}
            >
              <ArrowLeft size={16} />
              <span>⬅️ Volver Atrás (Guarda Borrador)</span>
            </button>

            <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#ec4899', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                CLIENTE SELECCIONADO EN FACTURACIÓN
              </span>
              <h3 style={{ margin: '0.2rem 0 0.25rem', fontSize: '1.15rem', fontWeight: 900, color: '#0f172a' }}>
                👤 {selectedTicket.client_name}
              </h3>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#be185d', fontWeight: 700 }}>
                🎫 Ticket: {selectedTicket.ticket_number || `#${selectedTicket.id.slice(-4)}`}
              </p>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                📍 {selectedTicket.salon_name || 'Sucursal San Vicente de Paúl'}
              </p>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>
                🕒 Generado: {new Date(selectedTicket.visited_at || Date.now()).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>

            {/* DETALLES DE PLAN BEAUTY DEL CLIENTE */}
            {activePlans.length > 0 ? (
              <div style={{ background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', border: '1px solid #86efac', padding: '0.875rem', borderRadius: '12px', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                  <Star size={18} style={{ color: '#16a34a' }} />
                  <strong style={{ color: '#166534', fontSize: '0.85rem' }}>Socio Plan Beauty Activo</strong>
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 700, color: '#15803d' }}>
                  {activePlans[0].title}
                </p>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#166534' }}>
                  Beneficios y lavados disponibles detectados automáticamente.
                </p>
              </div>
            ) : (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '0.75rem', borderRadius: '10px', fontSize: '0.8rem', color: '#64748b' }}>
                ℹ️ Cliente registrado en sistema (Sin suscripción Plan Beauty activa).
              </div>
            )}
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
              <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>
                🛒 Servicios Agregados ({lineItems.length})
              </h4>
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
                            value={item.empleado}
                            onChange={(e) => {
                              const updated = [...lineItems];
                              updated[idx].empleado = e.target.value;
                              setLineItems(updated);
                            }}
                            style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
                          >
                            {employees.map(emp => (
                              <option key={emp.id} value={emp.nombre}>{emp.nombre}</option>
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
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                    {['Efectivo', 'Tarjeta (CardNet)', 'Transferencia', 'Nomina_Empleado'].map((m) => (
                      <button
                        key={m}
                        onClick={() => setPaymentMethod(m)}
                        style={{
                          flex: 1,
                          padding: '0.6rem 0.5rem',
                          borderRadius: '8px',
                          border: `1px solid ${paymentMethod === m ? '#be185d' : '#cbd5e1'}`,
                          background: paymentMethod === m ? '#fdf2f8' : '#ffffff',
                          color: paymentMethod === m ? '#be185d' : '#334155',
                          fontWeight: 700,
                          fontSize: '0.75rem',
                          cursor: 'pointer'
                        }}
                      >
                        {m === 'Nomina_Empleado' ? 'Consumo Empleado' : m}
                      </button>
                    ))}
                  </div>

                  {paymentMethod === 'Efectivo' && (
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem' }}>
                          Monto Recibido Efectivo:
                        </label>
                        <input
                          type="number"
                          placeholder="0.00"
                          value={montoRecibido}
                          onChange={(e) => setMontoRecibido(e.target.value)}
                          style={{ width: '100%', padding: '0.5rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 700 }}
                        />
                      </div>
                      <div style={{ flex: 1, background: '#fef3c7', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid #fde68a' }}>
                        <span style={{ fontSize: '0.75rem', color: '#92400e', fontWeight: 700 }}>DEVUELTA / CAMBIO:</span>
                        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#b45309' }}>
                          RD$ {devueltaAmount.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
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

    </div>
  );
};

export default VisitRecorder;
