import React, { useState } from 'react';
import { ShieldCheck, CreditCard, AlertCircle } from 'lucide-react';
import { dataService } from '../utils/dataService';

const CardNetTest = () => {
  const [log, setLog] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionData, setSessionData] = useState(null);

  const addLog = (msg, data = null) => {
    const timestamp = new Date().toLocaleTimeString();
    const dataStr = data ? `\n${JSON.stringify(data, null, 2)}` : '';
    setLog(prev => `[${timestamp}] ${msg}${dataStr}\n\n` + prev);
    console.log(`[TEST CARDNET] ${msg}`, data || '');
  };

  const startTest = async () => {
    setLoading(true);
    setLog('');
    addLog("Iniciando prueba de conexión con CardNet...");

    try {
      if (typeof window.PWCheckout === 'undefined') {
        throw new Error("La librería de CardNet (PWCheckout) no está cargada en el index.html");
      }

      const testEmail = `test_${Math.floor(Math.random() * 10000)}@salonpro.com`;
      addLog(`Enviando petición de Customer con email: ${testEmail}`);

      // Usando el endpoint que arreglamos en server.js
      const res = await fetch('/api/cardnet/customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail, clientId: '999999' })
      });

      const customer = await res.json();
      
      if (!res.ok || customer.error) {
        addLog("ERROR: El backend rechazó la petición.", customer);
        return;
      }

      addLog("¡Éxito! Customer Creado en CardNet", customer);
      setSessionData(customer);

      const uniqueId = customer.uniqueId || customer.UniqueID || customer.fullResponse?.UniqueID;
      if (!uniqueId) {
        throw new Error("CardNet no devolvió el UniqueID necesario para el Iframe.");
      }

      addLog("Configurando Iframe de PWCheckout...");
      
      window.PWCheckout.Bind("tokenCreated", (token) => {
        addLog("🎉 ¡TOKEN RECIBIDO EXITOSAMENTE!", token);
        alert("¡Prueba superada! Tarjeta tokenizada con éxito.");
      });

      window.PWCheckout.Bind("onClose", () => {
        addLog("El usuario cerró la ventana de CardNet.");
      });

      addLog(`Abriendo Iframe con UniqueID: ${uniqueId}`);
      const captureUrl = customer.captureUrl || customer.fullResponse?.CaptureURL || "https://labservicios.cardnet.com.do/servicios/tokens/v1/Capture";
      const publicKey = customer.publicKey || customer.PublicKey || "J_eHXPYlDo9wlFpFXjgalm_I56ONV7HQ";
      let cleanCaptureUrl = captureUrl;
      if (!cleanCaptureUrl.endsWith('/')) cleanCaptureUrl += '/';
      window.PWCheckout.OpenIframeCustom(`${cleanCaptureUrl}?key=${publicKey}&session_id=${uniqueId}`, uniqueId);


    } catch (err) {
      addLog("ERROR CRÍTICO:", err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '3rem', maxWidth: '800px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: '#1e293b', color: 'white', padding: '2rem', borderRadius: '16px', marginBottom: '2rem' }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '1rem', margin: '0 0 1rem 0' }}>
          <ShieldCheck size={32} color="#d4af37" />
          Laboratorio de Pruebas CardNet
        </h1>
        <p style={{ margin: 0, opacity: 0.8 }}>
          Esta interfaz está aislada del sistema principal. Utiliza un correo aleatorio en cada prueba para evitar el error de "Email duplicado" y probar la ventana de pago en su estado más puro.
        </p>
      </div>

      <button 
        onClick={startTest} 
        disabled={loading}
        style={{ 
          width: '100%', padding: '1.5rem', background: '#09090b', color: 'white', 
          border: 'none', borderRadius: '12px', fontSize: '1.25rem', fontWeight: 'bold',
          cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem',
          boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)'
        }}
      >
        <CreditCard size={24} />
        {loading ? 'Procesando conexión...' : 'INICIAR PRUEBA DE PAGO'}
      </button>

      <div style={{ marginTop: '2rem' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <AlertCircle size={20} />
          Registro en Vivo (Consola)
        </h3>
        <pre style={{ 
          background: '#f8fafc', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0',
          height: '400px', overflowY: 'auto', fontSize: '0.85rem', whiteSpace: 'pre-wrap', color: '#334155'
        }}>
          {log || "Esperando para iniciar prueba..."}
        </pre>
      </div>
    </div>
  );
};

export default CardNetTest;
