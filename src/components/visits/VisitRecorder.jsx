import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Search, Calendar, Scissors, Clock as ClockIcon, Mail, Save, UserCheck, Star, Lock as LockIcon } from 'lucide-react';
import { dataService } from '../../utils/dataService';
import { useTranslation } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';

const VisitRecorder = () => {
  const { register, handleSubmit, setValue, watch, reset } = useForm({
    defaultValues: {
      total: '0.00',
      servicios: []
    }
  });

  const selectedServices = watch('servicios') || [];
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  
  const [clientFound, setClientFound] = useState(null);
  const [availableServices, setAvailableServices] = useState([]);
  const [activePlans, setActivePlans] = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState('none');
  const [clientVisits, setClientVisits] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);

  // OTP States
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [fallbackCode, setFallbackCode] = useState('');
  const [pendingData, setPendingData] = useState(null);
  const [isSendingOtp, setIsSendingOtp] = useState(false);

  // Get currently active plan based on selection
  const activePlan = activePlans.find(p => p.id.toString() === selectedPlanId);

  // Calculate if all services in plan are already consumed
  const checkQuotaStatus = () => {
     if (!activePlan || availableServices.length === 0) return false;
     return availableServices.every(service => {
        let quota = 1;
        const lower = service.toLowerCase();
        if (lower.includes('ilimitad')) return false; 
        const match = service.match(/^(\d+)\s/);
        if (match) quota = parseInt(match[1], 10);
        const used = (activePlan.cycleVisits || []).filter(v => v.servicios?.includes(service)).length;
        return used >= quota;
     });
  };

  const isPlanExhausted = checkQuotaStatus();
  const isButtonDisabled = (activePlan && isPlanExhausted) || selectedServices.length === 0 || loading;

  React.useEffect(() => {
    const fetchEmps = async () => {
      const data = await dataService.getEmployees();
      setEmployees(data);
    };
    fetchEmps();
  }, []);

  const loadClientData = async (clientId) => {
    const pastVisits = await dataService.getVisitsByClient(clientId);
    const contractsFound = await dataService.getContractByClient(clientId);
    const allPlans = await dataService.getPlans();
    
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

    const planesConContrato = (Array.isArray(contractsFound) ? contractsFound : []).map(contract => {
      const matchedPlan = allPlans.find(p => p.id === contract.plan_id || String(p.id) === String(contract.plan_id));
      
      const baseServices = peel(contract.contract_services) || [];
      const promoServices = peel(contract.contract_promo_services) || [];
      
      // Combinamos ambos servicios para la vista de facturación
      const allServices = [...(Array.isArray(baseServices) ? baseServices : []), ...(Array.isArray(promoServices) ? promoServices : [])];
      
      // Lógica de filtrado por ciclo de facturación
      const parseDate = (d) => {
        if (!d) return 0;
        if (d instanceof Date) return d.getTime();
        const dateStr = String(d).endsWith('Z') ? String(d) : String(d).replace(' ', 'T') + 'Z';
        const time = new Date(dateStr).getTime();
        return isNaN(time) ? new Date(d).getTime() : time;
      };
      
      const lastBillingTime = parseDate(contract.last_billed_date);
      const threshold = lastBillingTime + 10000; // 10 segundos de margen
      
      return {
        ...matchedPlan,
        id: contract.plan_id,
        contract_id: contract.id,
        last_billed_date: contract.last_billed_date,
        title: matchedPlan?.title || 'Plan Personalizado',
        services: allServices,
        isPromoActive: parseInt(contract.contract_promo_duration, 10) > 0,
        // Solo guardamos las visitas de este ciclo para este contrato específico
        cycleVisits: pastVisits.filter(v => parseDate(v.visited_at) >= threshold)
      };
    });

    setActivePlans(planesConContrato);
    setClientVisits(pastVisits); // Mantenemos el histórico completo para info general
    
    if (planesConContrato.length > 0) {
      const selected = planesConContrato.find(p => p.id.toString() === selectedPlanId) || planesConContrato[0];
      setSelectedPlanId(selected.id.toString());
      setAvailableServices(selected.services || []);
    }
  };

  const formatCedula = (val) => {
    const clean = val.replace(/\D/g, ''); // Quitar todo lo que no sea número
    if (clean.length !== 11) return val; // Si no tiene 11 dígitos, devolver tal cual
    return `${clean.slice(0, 3)}-${clean.slice(3, 10)}-${clean.slice(10)}`;
  };

  const onSearch = async (e) => {
    e.preventDefault();
    const rawValue = e.target.elements[0].value;
    const cedula = formatCedula(rawValue);
    
    // Actualizar el valor visual en el input para que el usuario vea el formato correcto
    e.target.elements[0].value = cedula;

    setLoading(true);
    const found = await dataService.findClientByCedula(cedula);
    setLoading(false);
    
    if (found) {
      const isStaffAdmin = currentUser?.role === 'admin' || currentUser?.role_name === 'Administrador';
      const isGlobalUser = !currentUser?.salon_id; // Si no tiene salon_id, es global
      
      if (found.salon_id && found.salon_id !== currentUser?.salon_id && !isStaffAdmin && !isGlobalUser) {
         alert('Este cliente está registrado en otra sucursal.');
         setClientFound(null);
         setActivePlans([]);
         return;
      }
      
      if (found.status === 'Cancelled' || found.status === 'Inactivo') {
        alert('Este cliente tiene su contrato cancelado y no puede recibir servicios bajo membresía.');
        setClientFound(null);
        setActivePlans([]);
        return;
      }

      setClientFound(found);
      await loadClientData(found.id);
      setValue('total', '0.00');
    } else {
      alert('Cliente no encontrado.');
      setClientFound(null);
    }
  };

  // INITIATE OTP FLOW
  const onSubmit = async (data) => {
    if (!clientFound) return;
    
    // Prepare visit data
    const visitData = {
      ...data,
      clientId: clientFound.id,
      clientName: clientFound.nombre,
      salon_id: currentUser?.salon_id
    };

    setPendingData(visitData);
    setIsSendingOtp(true);
    
    try {
      const otpRes = await dataService.generateOTP(clientFound.id, clientFound.email);
      if (otpRes.success) {
        setFallbackCode(otpRes.code || ''); 
        setOtpCode(''); // Ensure input is empty
        setShowOtpModal(true);
      } else {
        alert("Error al enviar código: " + (otpRes.error || "Revisa la configuración de correo"));
      }
    } catch (err) {
      alert("Fallo al conectar con el servidor de seguridad.");
    } finally {
      setIsSendingOtp(false);
    }
  };

  // CONFIRM OTP AND SAVE VISIT
  const handleVerifyOtp = async () => {
    if (!otpCode || otpCode.length < 4) return alert("Ingresa un código válido");
    
    setLoading(true);
    try {
      const res = await dataService.verifyOTPAndDiscount(clientFound.id, otpCode, pendingData);
      if (res.success) {
        alert('Visita autorizada y registrada con éxito');
        setShowOtpModal(false);
        setOtpCode('');
        reset({ servicios: [], empleadoPeluquera: '', empleadoManicurista: '', empleadoLavaPelo: '' });
        // Clear client state to "close" the profile as requested
        setClientFound(null);
        setActivePlans([]);
        setSelectedPlanId('none');
      }
    } catch (err) {
      alert(err.message || "Código incorrecto");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', paddingBottom: '5rem' }}>
      <div className="page-header">
        <div>
          <h2 className="page-title">Facturación de Servicios</h2>
          <p className="page-subtitle">Gestión de consumos y seguridad de membresía.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 600 }}>
          <Calendar size={18} />
          <span>{new Date().toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</span>
        </div>
      </div>

      {/* Client Search */}
      <div className="surface-card" style={{ marginBottom: '2rem' }}>
        <form onSubmit={onSearch} style={{ display: 'flex', gap: '1rem', width: '100%' }}>
          <div className="search-input-wrapper">
            <Search className="icon" size={20} />
            <input placeholder="Buscar por Cédula / ID" required />
          </div>
          <button type="submit" disabled={loading} className="btn-primary" style={{ padding: '0 2.5rem' }}>
            {loading ? 'Buscando...' : 'Buscar Cliente'}
          </button>
        </form>

        {clientFound && (
          <div style={{ marginTop: '1.5rem', background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ width: '48px', height: '48px', background: '#09090b', color: 'white', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <UserCheck size={22} />
              </div>
              <div>
                <p style={{ fontWeight: 800, fontSize: '1.1rem', margin: 0 }}>{clientFound.nombre}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <p style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>ID: {clientFound.cedula}</p>
                  {activePlan && (
                    <span style={{ fontSize: '0.65rem', background: '#ecfdf5', color: '#059669', padding: '0.1rem 0.5rem', borderRadius: '6px', fontWeight: 800 }}>
                      {activePlan.title}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase', marginBottom: '0.25rem' }}>Última Visita</p>
              <p style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                {clientVisits.length > 0 
                  ? new Date(clientVisits[clientVisits.length - 1].visited_at).toLocaleDateString()
                  : 'Primera vez'}
              </p>
            </div>
          </div>
        )}

        {clientFound && activePlans.length > 0 && (
          <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid #f1f5f9' }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#64748b', marginBottom: '1rem' }}>Plan Seleccionado:</p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {activePlans.map(plan => (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => {
                    setSelectedPlanId(plan.id.toString());
                    setAvailableServices(plan.services || []);
                  }}
                  style={{
                    padding: '0.75rem 1.25rem',
                    borderRadius: '14px',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    background: selectedPlanId === plan.id.toString() ? '#09090b' : '#f8fafc',
                    color: selectedPlanId === plan.id.toString() ? 'white' : '#475569',
                    border: '1px solid ' + (selectedPlanId === plan.id.toString() ? '#09090b' : '#e2e8f0'),
                    boxShadow: selectedPlanId === plan.id.toString() ? '0 8px 15px rgba(0,0,0,0.1)' : 'none'
                  }}
                >
                  {plan.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {clientFound && (
        <form onSubmit={handleSubmit(onSubmit)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem' }}>
            {/* Services Section */}
            <div className="surface-card">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.25rem', fontWeight: 900, marginBottom: '0.5rem' }}>
                <Scissors size={22} color="#d4af37" /> Servicios Realizados
              </h3>
              <p style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '2rem', fontWeight: 500 }}>
                {activePlan ? (
                  <span>Visita bajo membresía: <strong style={{ color: '#09090b' }}>{activePlan.title}</strong></span>
                ) : (
                  <span style={{ color: '#ef4444' }}>Cobro regular (Sin membresía)</span>
                )}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem' }}>
                {availableServices.length > 0 ? availableServices.map(service => {
                  let quota = 1;
                  const lower = service.toLowerCase();
                  if (lower.includes('ilimitad')) {
                    quota = Infinity;
                  } else {
                    const match = service.match(/^(\d+)\s/);
                    if (match) quota = parseInt(match[1], 10);
                  }
                  const used = (activePlan?.cycleVisits || []).filter(v => v.servicios?.includes(service)).length;
                  const isExhausted = used >= quota;

                  return (
                    <label key={service} style={{ 
                      display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.25rem', 
                      background: isExhausted ? '#fef2f2' : '#f8fafc', 
                      border: isExhausted ? '1px solid #fca5a5' : '1px solid #e2e8f0', 
                      borderRadius: '18px', 
                      cursor: isExhausted ? 'not-allowed' : 'pointer', 
                      transition: 'all 0.2s',
                      opacity: isExhausted ? 0.7 : 1
                    }}>
                      <input type="checkbox" disabled={isExhausted} style={{ width: '20px', height: '20px', accentColor: '#09090b' }} value={service} {...register("servicios")} />
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: 700, color: isExhausted ? '#b91c1c' : '#09090b' }}>{service}</span>
                        {activePlan && (
                          <span style={{ fontSize: '0.75rem', color: isExhausted ? '#ef4444' : '#64748b', fontWeight: 600 }}>
                            {isExhausted ? '🚫 AGOTADO' : `Uso: ${used} / ${quota === Infinity ? '∞' : quota}`}
                          </span>
                        )}
                      </div>
                    </label>
                  );
                }) : (
                  <div style={{ padding: '1.5rem', background: '#fffbeb', borderRadius: '18px', color: '#b45309', fontWeight: 600, gridColumn: '1/-1' }}>
                    Sin servicios configurados.
                  </div>
                )}
              </div>
            </div>

            {/* Staff Section */}
            <div className="surface-card">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.25rem', fontWeight: 900, marginBottom: '2rem' }}>
                <UserCheck size={22} color="#d4af37" /> Empleados Asignados
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#94a3b8' }}>Peluquera / Estilista</label>
                  <select className="input-field" {...register("empleadoPeluquera")} defaultValue="">
                    <option value="" disabled>Seleccionar Profesional</option>
                    {employees.filter(e => e.rol === 'Peluquera').map(e => (
                      <option key={e.id} value={e.nombre}>{e.nombre}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#94a3b8' }}>Lava pelo</label>
                  <select className="input-field" {...register("empleadoLavaPelo")} defaultValue="">
                    <option value="" disabled>Seleccionar Profesional</option>
                    {employees.filter(e => e.rol === 'Lava pelo').map(e => (
                      <option key={e.id} value={e.nombre}>{e.nombre}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: '#94a3b8' }}>Manicurista</label>
                  <select className="input-field" {...register("empleadoManicurista")} defaultValue="">
                    <option value="" disabled>Seleccionar Profesional</option>
                    {employees.filter(e => e.rol === 'Manicurista').map(e => (
                      <option key={e.id} value={e.nombre}>{e.nombre}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div style={{ textAlign: 'center', padding: '2rem 0' }}>
              <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '1.5rem', fontWeight: 500 }}>
                Al procesar, se enviará un código de seguridad al correo del cliente.
              </p>
              <button 
                type="submit" 
                disabled={isButtonDisabled || isSendingOtp}
                className="btn-primary" 
                style={{ 
                  width: '100%', maxWidth: '400px', padding: '1.25rem', borderRadius: '20px',
                  display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', fontSize: '1.1rem'
                }}
              >
                {isSendingOtp ? <ClockIcon className="animate-spin" /> : <Save size={22} />}
                {isSendingOtp ? 'Enviando Código...' : (isPlanExhausted ? 'Plan Agotado' : 'Procesar Factura')}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* OTP VERIFICATION MODAL */}
      {showOtpModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem' }}>
          <div style={{ background: 'white', padding: '3rem', borderRadius: '40px', maxWidth: '450px', width: '100%', textAlign: 'center', boxShadow: '0 30px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ width: '72px', height: '72px', background: '#f8fafc', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 2rem' }}>
              <LockIcon size={32} color="#d4af37" />
            </div>
            <h2 style={{ fontSize: '1.75rem', fontWeight: 900, marginBottom: '1rem' }}>Seguridad</h2>
            <p style={{ color: '#64748b', marginBottom: '2.5rem', fontSize: '0.95rem', lineHeight: 1.6 }}>
              Hemos enviado un código a <strong>{clientFound?.email}</strong>.<br/>
              { (currentUser?.role === 'admin' || currentUser?.role_name === 'Administrador') ? 'Código de respaldo disponible para administrador.' : 'Pide al cliente el código para autorizar el servicio.'}
            </p>

            { (currentUser?.role === 'admin' || currentUser?.role_name === 'Administrador') && (
              <div style={{ background: '#fefce8', border: '1px dashed #facc15', padding: '1.25rem', borderRadius: '15px', marginBottom: '2rem' }}>
                 <p style={{ fontSize: '0.75rem', fontWeight: 800, color: '#a16207', textTransform: 'uppercase', marginBottom: '0.5rem' }}>🔐 Código de Respaldo (Solo Admin)</p>
                 <p style={{ fontSize: '2rem', fontWeight: 900, color: '#09090b', letterSpacing: '6px' }}>{fallbackCode}</p>
              </div>
            )}
            
            <input 
              type="text" 
              placeholder="Confirmar Código"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              style={{ width: '100%', textAlign: 'center', fontSize: '2rem', fontWeight: 900, letterSpacing: '8px', padding: '1rem', borderRadius: '20px', border: '2px solid #e2e8f0', marginBottom: '2.5rem', fontFamily: 'monospace' }}
            />
            
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button onClick={() => setShowOtpModal(false)} style={{ flex: 1, padding: '1.25rem', borderRadius: '18px', border: '1px solid #e2e8f0', background: 'white', fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
              <button 
                onClick={handleVerifyOtp} 
                disabled={loading || otpCode.length < 4}
                className="btn-primary" 
                style={{ flex: 2, padding: '1.25rem', borderRadius: '18px', fontWeight: 800 }}
              >
                {loading ? 'Verificando...' : 'Confirmar Visita'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VisitRecorder;
