import React, { useState, useEffect, useRef } from 'react';
import { Camera, ShieldCheck, ShieldAlert, Clock, User, ArrowLeft, ArrowRight, CheckCircle, RefreshCw, MapPin } from 'lucide-react';
import { dataService } from '../utils/dataService';
import { useTranslation } from '../context/LanguageContext';

// Umbral de distancia euclidiana para coincidencia de rostros.
// Un valor menor es más estricto (reduce falsos positivos de personas del mismo género).
// El valor por defecto de face-api es 0.60. Para máxima precisión ("lo más fiel posible")
// y evitar falsos positivos del mismo género, usamos 0.48 junto con el modelo SSD MobileNet V1.
const FACE_MATCH_THRESHOLD = 0.48;

const AttendanceKiosk = () => {
  const { t } = useTranslation();
  const [employees, setEmployees] = useState([]);
  const [salons, setSalons] = useState([]);
  const [kioskSalonId, setKioskSalonId] = useState(localStorage.getItem('kiosk_salon_id') || '');
  const [kioskActive, setKioskActive] = useState(localStorage.getItem('kiosk_active') === 'true');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [activationError, setActivationError] = useState('');
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [deactivateEmail, setDeactivateEmail] = useState('');
  const [deactivatePassword, setDeactivatePassword] = useState('');
  const [deactivateError, setDeactivateError] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [password, setPassword] = useState('');
  const [step, setStep] = useState(1); // 1: Selector, 2: Contraseña, 3: Cámara/Ponche, 4: Éxito
  const [punchType, setPunchType] = useState('Check-In'); // 'Check-In' o 'Check-Out'
  const [todayPunches, setTodayPunches] = useState([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // face-api states
  const [libraryLoaded, setLibraryLoaded] = useState(true);
  const [modelsLoaded, setModelsLoaded] = useState(true);
  const [matchingStatus, setMatchingStatus] = useState('idle'); // 'idle', 'matching', 'matched', 'mismatched', 'error'
  const [statusMessage, setStatusMessage] = useState('Cámara lista.');
  const [loading, setLoading] = useState(false);
  const [autoCountdown, setAutoCountdown] = useState(null); // null = idle, 3/2/1 = counting

  // Camera & Face recognition refs
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const isLoopActive = useRef(false);
  const loopTimeoutId = useRef(null);
  const referenceDescriptor = useRef(null);
  const countdownIntervalRef = useRef(null);
  
  // Stability trackers (hysteresis)
  const consecutiveMatchesRef = useRef(0);
  const consecutiveMismatchesRef = useRef(0);
  const isPunchingRef = useRef(false);

  // Load current time clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Refresh today's real punches from the lightweight endpoint
  const refreshTodayPunches = async () => {
    try {
      const res = await fetch('/api/attendance/today');
      const data = res.ok ? await res.json() : [];
      setTodayPunches(data);
    } catch {
      setTodayPunches([]);
    }
  };

  // Fetch employees and salons on mount
  useEffect(() => {
    const loadKioskData = async () => {
      try {
        const staff = await dataService.getEmployees();
        const users = await dataService.getUsers();
        const sal = await dataService.getSalons();
        
        // Filter system users: exclude admins and clients
        const systemStaff = (users || []).filter(u => {
          const role = (u.role_name || '').toLowerCase();
          return !role.includes('admin') && !role.includes('client') && u.status !== 'Inactivo';
        }).map(u => ({
          ...u,
          rol: u.role_name // Align property name with staff_records positions
        }));

        // Merge both lists, avoiding duplicate names to be safe
        const combined = [...(staff || [])];
        systemStaff.forEach(sysUser => {
          if (!combined.some(c => c.nombre.toLowerCase().trim() === sysUser.nombre.toLowerCase().trim())) {
            combined.push(sysUser);
          }
        });

        setEmployees(combined);
        setSalons(sal || []);

        // Load today's real punches (lightweight endpoint — no absent generation)
        await refreshTodayPunches();
      } catch (err) {
        console.error("Error loading kiosk data:", err);
      }
    };
    loadKioskData();
  }, []);

  // Start Camera
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      setMatchingStatus('error');
      setStatusMessage("No se pudo acceder a la cámara de la tableta.");
    }
  };

  // Stop Camera
  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject;
      const tracks = stream.getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  };

  // Verify PIN/Password on Kiosk
  const handleVerifyPassword = async (e) => {
    e.preventDefault();
    if (!selectedEmployee) return;

    try {
      const res = await dataService.verifyUserPassword(selectedEmployee.id, password);
      if (res && res.success) {
        setPassword('');
        setStep(3);
        setMatchingStatus('matching');
        setStatusMessage("Preparando cámara...");
        // Iniciar cámara de forma asíncrona
        setTimeout(() => {
          startCamera();
        }, 100);
      } else {
        alert("Contraseña o PIN incorrecto.");
      }
    } catch (err) {
      console.error(err);
      alert("Error al verificar contraseña.");
    }
  };

  const handleVideoPlay = () => {
    console.log("Webcam video started playing.");
    setMatchingStatus('matching');
    
    // Si el empleado no tiene foto registrada, no es necesario hacer cuenta regresiva biométrica
    if (!selectedEmployee || !selectedEmployee.profile_photo) {
      setStatusMessage("Cámara activa. Presione Confirmar Ponche.");
      return;
    }

    setStatusMessage("Posiciónese frente a la cámara...");
    
    // Iniciar cuenta regresiva para captura automática (3 segundos)
    setAutoCountdown(3);
    let count = 3;
    
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
    }
    
    countdownIntervalRef.current = setInterval(() => {
      count -= 1;
      setAutoCountdown(count);
      if (count <= 0) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
        setAutoCountdown(null);
        handlePunch();
      }
    }, 1000);
  };

  // Perform Clock-in or Clock-out
  const handlePunch = async () => {
    // Limpiar intervalo de captura automática si está corriendo
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setAutoCountdown(null);

    setLoading(true);
    setMatchingStatus('matching');
    setStatusMessage("Enviando foto al servidor para verificación facial...");

    try {
      // Capturar la imagen de la cámara actual con alta resolución para la precisión de Azure
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 640;
      tempCanvas.height = 480;
      const ctx = tempCanvas.getContext('2d');
      if (videoRef.current) {
        ctx.drawImage(videoRef.current, 0, 0, 640, 480);
      }
      const capturedPhoto = tempCanvas.toDataURL('image/jpeg', 0.85);

      // Obtener GPS con un timeout de seguridad de 3 segundos
      let gpsStr = null;
      try {
        if (navigator.geolocation) {
          const gpsPromise = new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3000, enableHighAccuracy: false });
          });
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('GPS Timeout')), 3000));
          
          const position = await Promise.race([gpsPromise, timeoutPromise]);
          gpsStr = `${position.coords.latitude},${position.coords.longitude}`;
        }
      } catch (e) {
        console.warn("GPS Location access denied or timed out:", e.message);
      }

      const payload = {
        employeeId: selectedEmployee.id,
        type: punchType,
        photo: capturedPhoto,
        geolocation: gpsStr,
        deviceInfo: navigator.userAgent
      };

      const res = await dataService.saveAttendancePunch(payload);
      if (res && res.success) {
        setMatchingStatus('matched');
        setStatusMessage("Identidad verificada con éxito.");
        stopCamera();
        // Refresh today's punches immediately so the badge updates correctly on next login
        await refreshTodayPunches();
        setStep(4);
      } else {
        setMatchingStatus('error');
        setStatusMessage(res?.error || 'Error al validar rostro.');
      }
    } catch (err) {
      setMatchingStatus('error');
      setStatusMessage('Error del sistema al procesar el ponche.');
      console.error("Error during punch action:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleActivateKiosk = async (e) => {
    e.preventDefault();
    setLoading(true);
    setActivationError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: adminPassword })
      });
      const data = await res.json();
      
      if (!res.ok) {
        setActivationError(data.error || 'Error de autenticación.');
        return;
      }
      
      const roleName = (data.role_name || '').toLowerCase();
      const isAuthorized = roleName.includes('admin') || roleName.includes('recep') || data.role === 'admin';
      
      if (!isAuthorized) {
        setActivationError('Acceso denegado. Se requiere un rol de Administrador o Recepcionista.');
        return;
      }
      
      if (!kioskSalonId) {
        setActivationError('Por favor selecciona una sucursal.');
        return;
      }
      
      localStorage.setItem('kiosk_active', 'true');
      localStorage.setItem('kiosk_salon_id', kioskSalonId);
      setKioskActive(true);
      setAdminEmail('');
      setAdminPassword('');
    } catch (err) {
      setActivationError('Error de red o servidor.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivateKiosk = async (e) => {
    e.preventDefault();
    setLoading(true);
    setDeactivateError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: deactivateEmail, password: deactivatePassword })
      });
      const data = await res.json();
      
      if (!res.ok) {
        setDeactivateError(data.error || 'Error de autenticación.');
        return;
      }
      
      const roleName = (data.role_name || '').toLowerCase();
      const isAuthorized = roleName.includes('admin') || roleName.includes('recep') || data.role === 'admin';
      
      if (!isAuthorized) {
        setDeactivateError('Acceso denegado. Se requiere un rol de Administrador o Recepcionista.');
        return;
      }
      
      localStorage.removeItem('kiosk_active');
      localStorage.removeItem('kiosk_salon_id');
      setKioskActive(false);
      setKioskSalonId('');
      setShowDeactivateModal(false);
      setDeactivateEmail('');
      setDeactivatePassword('');
    } catch (err) {
      setDeactivateError('Error de red o servidor.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelKiosk = () => {
    // Clear any running auto-capture countdown
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setAutoCountdown(null);
    consecutiveMatchesRef.current = 0;
    consecutiveMismatchesRef.current = 0;
    isPunchingRef.current = false;
    stopCamera();
    setSelectedEmployee(null);
    setMatchingStatus('idle');
    setStep(1);
  };

  // Auto-redirect to home screen after successful punch (hands-free)
  useEffect(() => {
    if (step === 4) {
      const redirectTimer = setTimeout(() => {
        handleCancelKiosk();
      }, 3500);
      return () => clearTimeout(redirectTimer);
    }
  }, [step]);

  const filteredEmployees = employees.filter(emp => {
    if (!kioskSalonId) return false;
    // Si el empleado no tiene sucursal asignada (es null o vacío), se considera Global y se muestra en todas!
    if (emp.salon_id === null || emp.salon_id === undefined || emp.salon_id === '') return true;
    return String(emp.salon_id) === String(kioskSalonId);
  });

  return (
    <div style={{ minHeight: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column', background: '#09090b', color: '#f8fafc', padding: '2rem 1.5rem', fontFamily: '"Plus Jakarta Sans", sans-serif' }}>
      
      {/* Kiosk Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1f1f23', paddingBottom: '1.5rem', marginBottom: '2.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 900, margin: 0, color: '#ffffff', letterSpacing: '-0.5px' }}>
            Kiosco de Asistencia
          </h2>
          <p style={{ fontSize: '0.85rem', color: '#a1a1aa', margin: '0.25rem 0 0 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>Poncheo biométrico rápido para personal</span>
            {kioskSalonId && (
              <>
                <span style={{ color: '#27272a' }}>•</span>
                <span style={{ color: '#10b981', fontWeight: 800 }}>📍 {salons.find(s => String(s.id) === String(kioskSalonId))?.name || 'Cargando...'}</span>
              </>
            )}
          </p>
        </div>
        
        {/* Real-time Clock */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: '#18181b', padding: '0.75rem 1.25rem', borderRadius: '12px', border: '1px solid #27272a' }}>
          <Clock size={20} color="#10b981" />
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 900, letterSpacing: '0.5px' }}>
              {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#71717a', textTransform: 'capitalize', fontWeight: 700 }}>
              {currentTime.toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'short' })}
            </div>
          </div>
        </div>
      </div>

      {/* Configuration View: Secure Activation for Kiosk */}
      {!kioskActive ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', maxWidth: '480px', width: '100%', margin: '2rem auto' }}>
          <div style={{ background: '#18181b', border: '1px solid #27272a', padding: '2.5rem 2rem', borderRadius: '24px', width: '100%', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)' }}>
            <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
              <ShieldCheck size={30} />
            </div>
            <h3 style={{ fontSize: '1.4rem', fontWeight: 900, marginBottom: '0.5rem', color: '#ffffff', textAlign: 'center', fontFamily: '"Plus Jakarta Sans", sans-serif' }}>Activar Kiosco</h3>
            <p style={{ fontSize: '0.8rem', color: '#a1a1aa', marginBottom: '2rem', textAlign: 'center', lineHeight: 1.4, fontFamily: '"Plus Jakarta Sans", sans-serif' }}>
              Ingresa tus credenciales de Administrador o Recepcionista para activar este dispositivo en una sucursal.
            </p>

            <form onSubmit={handleActivateKiosk} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ fontSize: '0.7rem', fontWeight: 800, color: '#a1a1aa', display: 'block', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Correo Electrónico</label>
                <input
                  type="email"
                  required
                  placeholder="ejemplo@correo.com"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  style={{
                    width: '100%', height: '48px', background: '#09090b', border: '1px solid #27272a',
                    borderRadius: '12px', padding: '0 1rem', color: 'white', fontSize: '0.9rem', outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.7rem', fontWeight: 800, color: '#a1a1aa', display: 'block', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contraseña</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  style={{
                    width: '100%', height: '48px', background: '#09090b', border: '1px solid #27272a',
                    borderRadius: '12px', padding: '0 1rem', color: 'white', fontSize: '0.9rem', outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.7rem', fontWeight: 800, color: '#a1a1aa', display: 'block', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sucursal del Kiosco</label>
                <select
                  required
                  value={kioskSalonId}
                  onChange={(e) => setKioskSalonId(e.target.value)}
                  style={{
                    width: '100%', height: '48px', background: '#09090b', border: '1px solid #27272a',
                    borderRadius: '12px', padding: '0 1rem', color: 'white', fontSize: '0.9rem', outline: 'none',
                    cursor: 'pointer', boxSizing: 'border-box'
                  }}
                >
                  <option value="" disabled>Selecciona una sucursal...</option>
                  {salons.map(s => (
                    <option key={s.id} value={s.id}>📍 {s.name}</option>
                  ))}
                </select>
              </div>

              {activationError && (
                <div style={{ color: '#ef4444', fontSize: '0.75rem', fontWeight: 700, background: 'rgba(239,68,68,0.1)', padding: '0.75rem', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.2)', textAlign: 'center' }}>
                  ⚠️ {activationError}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%', height: '50px', background: '#10b981', color: '#09090b', border: 'none',
                  borderRadius: '30px', fontWeight: 900, fontSize: '0.95rem', cursor: loading ? 'not-allowed' : 'pointer',
                  boxShadow: '0 8px 20px rgba(16,185,129,0.2)', marginTop: '0.5rem', transition: 'all 0.2s ease'
                }}
              >
                {loading ? '⏳ Validando...' : 'Activar Kiosco'}
              </button>
            </form>
          </div>
        </div>
      ) : (
        /* Step 1: Employee Selector */
        step === 1 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', maxWidth: '800px', width: '100%', margin: '0 auto' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '1.5rem', color: '#ffffff', textAlign: 'center' }}>
              Selecciona tu Nombre para Iniciar
            </h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1.25rem', flex: 1 }}>
              {filteredEmployees.map(emp => (
                <button
                  key={emp.id}
                  onClick={async () => {
                    setSelectedEmployee(emp);
                    // Determine next punch type based on the last chronological punch of today
                    const empPunches = todayPunches.filter(p => String(p.employee_id) === String(emp.id));
                    const lastPunch = empPunches[empPunches.length - 1];
                    const nextType = (!lastPunch || lastPunch.type === 'Check-Out') ? 'Check-In' : 'Check-Out';
                    setPunchType(nextType);
                    setStep(3);
                    setMatchingStatus('matching');
                    setStatusMessage("Iniciando cámara...");
                    startCamera();
                  }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '1.75rem 1rem',
                    background: '#18181b',
                    border: '1px solid #27272a',
                    borderRadius: '16px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    color: '#ffffff'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#10b981';
                    e.currentTarget.style.transform = 'translateY(-4px)';
                    e.currentTarget.style.background = '#27272a';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#27272a';
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.background = '#18181b';
                  }}
                >
                  <div style={{ width: '64px', height: '64px', borderRadius: '50%', overflow: 'hidden', background: '#27272a', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem', border: '2px solid #3f3f46' }}>
                    {emp.profile_photo ? (
                      <img src={emp.profile_photo} alt={emp.nombre} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <User size={30} color="#71717a" />
                    )}
                  </div>
                  <span style={{ fontSize: '0.95rem', fontWeight: 800, textAlign: 'center', wordBreak: 'break-word' }}>
                    {emp.nombre}
                  </span>
                  <span style={{ fontSize: '0.7rem', color: '#71717a', textTransform: 'uppercase', marginTop: '0.25rem', fontWeight: 700 }}>
                    {emp.rol || 'Empleado'}
                  </span>
                </button>
              ))}
            </div>

            <button
              onClick={() => {
                setShowDeactivateModal(true);
              }}
              style={{
                marginTop: '3rem',
                background: 'transparent',
                border: 'none',
                color: '#71717a',
                fontSize: '0.8rem',
                cursor: 'pointer',
                textDecoration: 'underline',
                alignSelf: 'center',
                fontWeight: 700
              }}
            >
              Cambiar de Sucursal (Configuración de Tablet)
            </button>
          </div>
        )
      )}

      {/* Step 2: Password/PIN Verification */}
      {step === 2 && selectedEmployee && (
        <div style={{ maxWidth: '400px', width: '100%', margin: 'auto', background: '#18181b', border: '1px solid #27272a', padding: '2.5rem', borderRadius: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)' }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', overflow: 'hidden', background: '#27272a', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', border: '2px solid #10b981' }}>
              {selectedEmployee.profile_photo ? (
                <img src={selectedEmployee.profile_photo} alt={selectedEmployee.nombre} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <User size={30} color="#71717a" />
              )}
            </div>
            <h4 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0 }}>{selectedEmployee.nombre}</h4>
            <p style={{ fontSize: '0.8rem', color: '#a1a1aa', margin: '0.25rem 0 0 0' }}>Ingresa tu contraseña de acceso</p>
          </div>

          <form onSubmit={handleVerifyPassword} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <input
              type="password"
              placeholder="Contraseña"
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                background: '#09090b',
                border: '1px solid #27272a',
                color: '#ffffff',
                height: '50px',
                borderRadius: '12px',
                padding: '0 1rem',
                fontSize: '1.1rem',
                textAlign: 'center',
                letterSpacing: '3px'
              }}
            />
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                onClick={handleCancelKiosk}
                style={{
                  height: '46px',
                  background: '#27272a',
                  color: '#f8fafc',
                  border: 'none',
                  borderRadius: '12px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Volver
              </button>
              <button
                type="submit"
                style={{
                  height: '46px',
                  background: '#10b981',
                  color: '#09090b',
                  border: 'none',
                  borderRadius: '12px',
                  fontWeight: 800,
                  cursor: 'pointer'
                }}
              >
                Ingresar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Step 3: Biometric Check-In/Check-Out Camera */}
      {step === 3 && selectedEmployee && (
        <div style={{ maxWidth: '520px', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, justifyContent: 'center' }}>

          {/* Employee info card — glassmorphism */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '1rem',
            background: 'rgba(24,24,27,0.8)', backdropFilter: 'blur(12px)',
            padding: '1rem 1.25rem', borderRadius: '20px',
            border: '1px solid rgba(255,255,255,0.07)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)'
          }}>
            {/* Avatar */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{
                width: '54px', height: '54px', borderRadius: '50%',
                overflow: 'hidden', background: '#27272a',
                border: `3px solid ${punchType === 'Check-In' ? '#10b981' : '#f59e0b'}`,
                boxShadow: `0 0 16px ${punchType === 'Check-In' ? 'rgba(16,185,129,0.4)' : 'rgba(245,158,11,0.4)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                {selectedEmployee.profile_photo
                  ? <img src={selectedEmployee.profile_photo} alt={selectedEmployee.nombre} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <User size={24} color="#71717a" />}
              </div>
            </div>

            {/* Name + mode */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: '0.65rem', color: '#71717a', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block' }}>Empleado Seleccionado</span>
              <span style={{ fontSize: '1rem', fontWeight: 900, color: '#fff', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedEmployee.nombre}</span>
            </div>

            {/* Mode badge — completely automated based on state */}
            {(() => {
              if (punchType === 'Check-Out') return (
                <div style={{ flexShrink: 0, background: 'rgba(245,158,11,0.15)', color: '#f59e0b', padding: '0.45rem 1rem', borderRadius: '50px', border: '1px solid rgba(245,158,11,0.3)', fontSize: '0.75rem', fontWeight: 900, letterSpacing: '0.03em' }}>
                  🚪 Salida
                </div>
              );
              return (
                <div style={{ flexShrink: 0, background: 'rgba(16,185,129,0.15)', color: '#10b981', padding: '0.45rem 1rem', borderRadius: '50px', border: '1px solid rgba(16,185,129,0.3)', fontSize: '0.75rem', fontWeight: 900, letterSpacing: '0.03em' }}>
                  ✅ Entrada
                </div>
              );
            })()}
          </div>

          {/* Camera frame */}
          <div style={{
            position: 'relative', width: '100%', aspectRatio: '4/3',
            background: '#0c0c0e', borderRadius: '28px', overflow: 'hidden',
            boxShadow: '0 32px 64px -12px rgba(0,0,0,0.7)',
            border: `2px solid ${matchingStatus === 'matched' ? 'rgba(16,185,129,0.5)' : (matchingStatus === 'mismatched' || matchingStatus === 'error') ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.07)'}`,
            transition: 'border-color 0.4s ease'
          }}>
            <video ref={videoRef} width="640" height="480" autoPlay muted playsInline onPlay={handleVideoPlay}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <canvas ref={canvasRef} width="640" height="480"
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />

            {/* Premium Error Overlay */}
            {matchingStatus === 'error' && (
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(9, 9, 11, 0.85)',
                backdropFilter: 'blur(8px)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: '2rem', textAlign: 'center', zIndex: 15
              }}>
                <ShieldAlert size={48} color="#ef4444" style={{ marginBottom: '1rem' }} />
                <h4 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#ffffff', margin: '0 0 0.5rem 0' }}>Biometría No Disponible</h4>
                <p style={{ fontSize: '0.82rem', color: '#a1a1aa', maxWidth: '340px', margin: 0, lineHeight: 1.5 }}>
                  Su foto de perfil es demasiado oscura o borrosa. Por favor, solicite al administrador actualizar su foto con mejor iluminación.
                </p>
              </div>
            )}

            {/* Corner bracket overlay — visual scan frame */}
            {['tl','tr','bl','br'].map(pos => {
              const isTop = pos.startsWith('t');
              const isLeft = pos.endsWith('l');
              return (
                <div key={pos} style={{
                  position: 'absolute',
                  top: isTop ? '12%' : 'auto', bottom: !isTop ? '12%' : 'auto',
                  left: isLeft ? '20%' : 'auto', right: !isLeft ? '20%' : 'auto',
                  width: '36px', height: '36px',
                  borderTop: isTop ? `3px solid ${matchingStatus === 'matched' ? '#10b981' : (matchingStatus === 'mismatched' || matchingStatus === 'error') ? '#ef4444' : '#3b82f6'}` : 'none',
                  borderBottom: !isTop ? `3px solid ${matchingStatus === 'matched' ? '#10b981' : (matchingStatus === 'mismatched' || matchingStatus === 'error') ? '#ef4444' : '#3b82f6'}` : 'none',
                  borderLeft: isLeft ? `3px solid ${matchingStatus === 'matched' ? '#10b981' : (matchingStatus === 'mismatched' || matchingStatus === 'error') ? '#ef4444' : '#3b82f6'}` : 'none',
                  borderRight: !isLeft ? `3px solid ${matchingStatus === 'matched' ? '#10b981' : (matchingStatus === 'mismatched' || matchingStatus === 'error') ? '#ef4444' : '#3b82f6'}` : 'none',
                  borderRadius: isTop && isLeft ? '8px 0 0 0' : isTop && !isLeft ? '0 8px 0 0' : !isTop && isLeft ? '0 0 0 8px' : '0 0 8px 0',
                  opacity: 0.85,
                  transition: 'border-color 0.4s ease',
                  pointerEvents: 'none',
                  zIndex: 10
                }} />
              );
            })}

            {/* Status pill — bottom of camera */}
            <div style={{
              position: 'absolute', bottom: '1rem', left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(9,9,11,0.88)', backdropFilter: 'blur(12px)',
              padding: autoCountdown !== null ? '0.55rem 1.4rem 0.55rem 0.8rem' : '0.6rem 1.2rem',
              borderRadius: '50px',
              border: `1px solid ${matchingStatus === 'matched' ? 'rgba(16,185,129,0.45)' : (matchingStatus === 'mismatched' || matchingStatus === 'error') ? 'rgba(239,68,68,0.35)' : 'rgba(59,130,246,0.3)'}`,
              display: 'flex', alignItems: 'center', gap: '0.6rem',
              whiteSpace: 'nowrap', zIndex: 20,
              boxShadow: matchingStatus === 'matched' ? '0 4px 20px rgba(16,185,129,0.2)' : '0 4px 20px rgba(0,0,0,0.4)',
              transition: 'all 0.3s ease'
            }}>
              {/* Countdown bubble or icon */}
              {autoCountdown !== null ? (
                <div style={{
                  width: '28px', height: '28px', borderRadius: '50%',
                  background: 'rgba(16,185,129,0.15)',
                  border: '2px solid #10b981',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.85rem', fontWeight: 900, color: '#10b981',
                  animation: 'pulse 1s ease infinite',
                  flexShrink: 0
                }}>
                  {autoCountdown}
                </div>
              ) : matchingStatus === 'matched'
                ? <ShieldCheck size={17} color="#10b981" />
                : (matchingStatus === 'mismatched' || matchingStatus === 'error')
                  ? <ShieldAlert size={17} color="#ef4444" />
                  : <RefreshCw size={15} color="#3b82f6" style={{ animation: 'spin 1.5s linear infinite' }} />}
              <span style={{
                fontSize: '0.78rem', fontWeight: 700,
                color: autoCountdown !== null ? '#10b981' : matchingStatus === 'matched' ? '#10b981' : (matchingStatus === 'mismatched' || matchingStatus === 'error') ? '#ef4444' : '#93c5fd'
              }}>
                {autoCountdown !== null
                  ? `Registrando en ${autoCountdown}...`
                  : statusMessage}
              </span>
            </div>

            {/* No photo warning — top bar */}
            {!selectedEmployee.profile_photo && (
              <div style={{ position: 'absolute', top: '1rem', left: '1rem', right: '1rem', background: 'rgba(120,53,15,0.9)', backdropFilter: 'blur(8px)', border: '1px solid #d97706', padding: '0.6rem 0.9rem', borderRadius: '12px', color: '#fef3c7', fontSize: '0.72rem', fontWeight: 600, textAlign: 'center', zIndex: 20 }}>
                ⚠️ Sin foto registrada — el ponche se validará sin biométrico.
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
            <button
              onClick={handleCancelKiosk}
              style={{
                flex: '0 0 auto',
                height: '54px',
                padding: '0 1.5rem',
                background: 'rgba(39,39,42,0.7)',
                color: '#a1a1aa',
                border: '1px solid #3f3f46',
                borderRadius: '50px',
                fontWeight: 700,
                fontSize: '0.9rem',
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
                transition: 'all 0.15s ease',
                fontFamily: '"Plus Jakarta Sans", sans-serif'
              }}
            >
              Cancelar
            </button>
            <button
              onClick={handlePunch}
              disabled={loading}
              style={{
                flex: 1,
                height: '54px',
                background: punchType === 'Check-In'
                  ? 'linear-gradient(135deg, #10b981, #059669)'
                  : 'linear-gradient(135deg, #f59e0b, #d97706)',
                color: '#09090b',
                border: 'none',
                borderRadius: '50px',
                fontWeight: 900,
                fontSize: '1rem',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
                boxShadow: punchType === 'Check-In' ? '0 8px 24px rgba(16,185,129,0.35)' : '0 8px 24px rgba(245,158,11,0.35)',
                transition: 'all 0.3s ease',
                fontFamily: '"Plus Jakarta Sans", sans-serif',
                letterSpacing: '-0.01em'
              }}
            >
              {loading ? '⏳ Procesando...' : `Confirmar ${punchType === 'Check-In' ? 'Entrada' : 'Salida'}`}
            </button>
          </div>

          {(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && (
            <button
              type="button"
              onClick={() => {
                setMatchingStatus('matched');
                setStatusMessage("Validación omitida (Modo Desarrollo/Testing)");
              }}
              style={{
                marginTop: '1.25rem',
                height: '40px',
                background: 'rgba(239, 68, 68, 0.1)',
                color: '#ef4444',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: '12px',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: 'pointer',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
              }}
            >
              🔧 Omitir Reconocimiento Facial (Solo en localhost para pruebas)
            </button>
          )}
        </div>
      )}

      {/* Step 4: Success Feedback Screen */}
      {step === 4 && selectedEmployee && (
        <div style={{ maxWidth: '420px', width: '100%', margin: 'auto', background: '#18181b', border: '1px solid #27272a', padding: '3.5rem 2rem', borderRadius: '32px', textAlign: 'center', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{
            width: '80px', height: '80px', borderRadius: '50%',
            background: 'rgba(16, 185, 129, 0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: '1.5rem', color: '#10b981',
            boxShadow: '0 0 30px rgba(16, 185, 129, 0.15)',
            animation: 'scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards'
          }}>
            <CheckCircle size={44} />
          </div>
          
          <h3 style={{ fontSize: '1.6rem', fontWeight: 900, marginBottom: '0.75rem', color: '#ffffff', letterSpacing: '-0.02em' }}>
            ¡Registro Exitoso!
          </h3>
          <p style={{ fontSize: '0.92rem', color: '#a1a1aa', margin: '0 0 2.5rem 0', lineHeight: 1.5 }}>
            Hola <strong style={{ color: '#ffffff' }}>{selectedEmployee.nombre}</strong>, tu registro de 
            <strong style={{ color: punchType === 'Check-In' ? '#10b981' : '#f59e0b' }}> {punchType === 'Check-In' ? 'Entrada' : 'Salida'}</strong> fue completado correctamente.
          </p>

          <button
            onClick={handleCancelKiosk}
            style={{
              width: '100%',
              height: '52px',
              background: '#09090b',
              color: '#ffffff',
              border: '1px solid #27272a',
              borderRadius: '50px',
              fontWeight: 800,
              fontSize: '0.9rem',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              fontFamily: '"Plus Jakarta Sans", sans-serif'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#10b981';
              e.currentTarget.style.background = '#18181b';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#27272a';
              e.currentTarget.style.background = '#09090b';
            }}
          >
            Volver al Inicio
          </button>

          <span style={{ fontSize: '0.75rem', color: '#71717a', marginTop: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', display: 'inline-block', animation: 'blink 1.2s infinite' }} />
            Redireccionando automáticamente en unos segundos...
          </span>
        </div>
      )}
      
      {/* Deactivate Kiosk Modal */}
      {showDeactivateModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(9,9,11,0.85)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, padding: '1rem'
        }}>
          <div style={{
            background: '#18181b', border: '1px solid #27272a',
            padding: '2rem 1.75rem', borderRadius: '24px', maxWidth: '400px', width: '100%',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)'
          }}>
            <h4 style={{ fontSize: '1.25rem', fontWeight: 900, color: 'white', margin: '0 0 0.5rem 0', fontFamily: '"Plus Jakarta Sans", sans-serif' }}>
              Desbloquear Quiosco
            </h4>
            <p style={{ fontSize: '0.8rem', color: '#a1a1aa', margin: '0 0 1.5rem 0', lineHeight: 1.4, fontFamily: '"Plus Jakarta Sans", sans-serif' }}>
              Para cambiar de sucursal o configurar el quiosco, introduce tus credenciales de Administrador o Recepcionista.
            </p>

            <form onSubmit={handleDeactivateKiosk} style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
              <div>
                <label style={{ fontSize: '0.68rem', fontWeight: 800, color: '#a1a1aa', display: 'block', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Correo Electrónico</label>
                <input
                  type="email"
                  required
                  placeholder="ejemplo@correo.com"
                  value={deactivateEmail}
                  onChange={(e) => setDeactivateEmail(e.target.value)}
                  style={{
                    width: '100%', height: '44px', background: '#09090b', border: '1px solid #27272a',
                    borderRadius: '10px', padding: '0 0.85rem', color: 'white', fontSize: '0.88rem', outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.68rem', fontWeight: 800, color: '#a1a1aa', display: 'block', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contraseña</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={deactivatePassword}
                  onChange={(e) => setDeactivatePassword(e.target.value)}
                  style={{
                    width: '100%', height: '44px', background: '#09090b', border: '1px solid #27272a',
                    borderRadius: '10px', padding: '0 0.85rem', color: 'white', fontSize: '0.88rem', outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {deactivateError && (
                <div style={{ color: '#ef4444', fontSize: '0.72rem', fontWeight: 700, background: 'rgba(239,68,68,0.08)', padding: '0.6rem', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.15)', textAlign: 'center' }}>
                  ⚠️ {deactivateError}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowDeactivateModal(false);
                    setDeactivateEmail('');
                    setDeactivatePassword('');
                    setDeactivateError('');
                  }}
                  style={{
                    height: '44px', background: '#27272a', color: '#a1a1aa', border: 'none',
                    borderRadius: '30px', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer'
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    height: '44px', background: '#ef4444', color: 'white', border: 'none',
                    borderRadius: '30px', fontWeight: 800, fontSize: '0.85rem', cursor: loading ? 'not-allowed' : 'pointer'
                  }}
                >
                  {loading ? '⏳ Validando...' : 'Desbloquear'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSS Animation Keyframes for Vladmandic spinner */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default AttendanceKiosk;
