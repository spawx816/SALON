/**
 * Utilidad para cargar dinámicamente el SDK de CardNet (PWCheckout) 
 * con la llave pública y dominio correctos (Sandbox o Producción) en tiempo de ejecución.
 */
export const loadCardNetScript = (publicKey, captureUrl) => {
  return new Promise((resolve, reject) => {
    // Si ya existe la librería en el objeto global
    if (window.PWCheckout) {
      const currentScript = document.querySelector('script[src*="PWCheckout.js"]');
      const isSessionProd = captureUrl.includes("servicios.cardnet.com.do") && !captureUrl.includes("labservicios");
      const isScriptProd = currentScript && currentScript.src.includes("servicios.cardnet.com.do") && !currentScript.src.includes("labservicios");

      // Si el script ya cargado coincide con el entorno actual, resolver
      if (isSessionProd === isScriptProd) {
        console.log("[CARDNET SDK] Librería ya cargada y configurada para el entorno correcto.");
        resolve(window.PWCheckout);
        return;
      }
      
      console.warn("[CARDNET SDK] Conflicto de entorno. Recargando la librería para el entorno correcto...");
    }

    // Extraer URL base del SDK a partir de la URL de captura del backend
    // Ejemplo captureUrl: "https://servicios.cardnet.com.do/servicios/tokens/v1/Capture"
    // Queremos obtener: "https://servicios.cardnet.com.do/servicios/tokens/v1"
    const baseUrl = captureUrl.split('/Capture')[0] || "https://labservicios.cardnet.com.do/servicios/tokens/v1";
    const scriptUrl = `${baseUrl}/Scripts/PWCheckout.js?key=${publicKey}`;

    console.log("[CARDNET SDK] Iniciando carga dinámica:", scriptUrl);

    // Remover cualquier script previo para evitar interferencias
    const oldScript = document.querySelector('script[src*="PWCheckout.js"]');
    if (oldScript) {
      oldScript.remove();
      try { delete window.PWCheckout; } catch (e) {}
    }

    const script = document.createElement('script');
    script.src = scriptUrl;
    script.type = 'text/javascript';
    script.async = true;
    script.onload = () => {
      // Validar inicialización asíncrona de PWCheckout
      const checkInterval = setInterval(() => {
        if (window.PWCheckout) {
          clearInterval(checkInterval);
          console.log("[CARDNET SDK] Cargado e inicializado de manera exitosa.");
          resolve(window.PWCheckout);
        }
      }, 50);

      // Timeout de seguridad a los 5 segundos
      setTimeout(() => {
        clearInterval(checkInterval);
        if (window.PWCheckout) {
          resolve(window.PWCheckout);
        } else {
          reject(new Error("Tiempo de espera agotado al inicializar PWCheckout."));
        }
      }, 5000);
    };

    script.onerror = () => {
      reject(new Error("No se pudo cargar la pasarela de pagos seguros de CardNet Dominicana."));
    };

    document.head.appendChild(script);
  });
};
