/**
 * Utilidad para cargar dinámicamente el SDK de CardNet (PWCheckout) 
 * con la llave pública y dominio correctos (Sandbox o Producción) en tiempo de ejecución.
 */
let _inFlightLoadPromise = null;
let _inFlightScriptUrl = null;

function resolveCardnetBaseUrl(captureUrl = '') {
  const isProdCapture = captureUrl.includes("servicios.cardnet.com.do") && !captureUrl.includes("labservicios");
  try {
    if (captureUrl) {
      const parsed = new URL(captureUrl);
      const pathPrefix = parsed.pathname.split('/Capture')[0] || '/servicios/tokens/v1';
      return `${parsed.origin}${pathPrefix}`;
    }
  } catch {
    // Fallback below
  }
  return isProdCapture
    ? "https://servicios.cardnet.com.do/servicios/tokens/v1"
    : "https://labservicios.cardnet.com.do/servicios/tokens/v1";
}

export const loadCardNetScript = (publicKey, captureUrl = '') => {
  const baseUrl = resolveCardnetBaseUrl(captureUrl);
  const scriptUrl = `${baseUrl}/Scripts/PWCheckout.js?key=${publicKey}`;

  if (window.PWCheckout) {
    const currentScript = document.querySelector('script[src*="PWCheckout.js"]');
    const isSessionProd = captureUrl.includes("servicios.cardnet.com.do") && !captureUrl.includes("labservicios");
    const isScriptProd = currentScript && (currentScript.src.includes("tr-tsp.gtp-seglan.com") || (currentScript.src.includes("servicios.cardnet.com.do") && !currentScript.src.includes("labservicios")));

    if (isSessionProd === isScriptProd) {
      return Promise.resolve(window.PWCheckout);
    }
  }

  if (_inFlightLoadPromise && _inFlightScriptUrl === scriptUrl) {
    return _inFlightLoadPromise;
  }

  _inFlightScriptUrl = scriptUrl;
  _inFlightLoadPromise = new Promise((resolve, reject) => {
    const oldScript = document.querySelector('script[src*="PWCheckout.js"]');
    if (oldScript) {
      oldScript.remove();
      try { delete window.PWCheckout; } catch (_e) { /* ignore */ }
    }

    const script = document.createElement('script');
    script.src = scriptUrl;
    script.type = 'text/javascript';
    script.async = true;
    script.onload = () => {
      const checkInterval = setInterval(() => {
        if (window.PWCheckout) {
          clearInterval(checkInterval);
          _inFlightLoadPromise = null;
          resolve(window.PWCheckout);
        }
      }, 50);

      setTimeout(() => {
        clearInterval(checkInterval);
        _inFlightLoadPromise = null;
        if (window.PWCheckout) {
          resolve(window.PWCheckout);
        } else {
          reject(new Error("Tiempo de espera agotado al inicializar PWCheckout."));
        }
      }, 5000);
    };

    script.onerror = () => {
      _inFlightLoadPromise = null;
      reject(new Error("No se pudo cargar la pasarela de pagos seguros de CardNet Dominicana."));
    };

    document.head.appendChild(script);
  });

  return _inFlightLoadPromise;
};
