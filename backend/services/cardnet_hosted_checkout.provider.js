/**
 * CardNet Dominicana — Integración con Pantalla (POST / Hosted Checkout)
 *
 * Documentación oficial: https://developers.cardnet.com.do/
 * Modalidad:
 *   1. POST {baseUrl}/sessions -> obtiene { SESSION, session-key }
 *   2. Navegador envía POST {baseUrl}/authorize con campo SESSION (CardNet captura tarjeta y 3DS)
 *   3. Verificación servidor-a-servidor: GET {baseUrl}/sessions/{SESSION}?sk={session-key} (antes de 30 min)
 *
 * PCI DSS INVARIANT:
 * Etereas NUNCA recibe, procesa, registra ni almacena PAN completo ni CVC/CVV.
 */

const PLACEHOLDER_REGEX = /dummy|000000|fake|placeholder|changeme/i;

const CURRENCY_NUMERIC_MAP = Object.freeze({
  DOP: '214',
  USD: '840',
});

function isMissingOrPlaceholder(value) {
  const str = String(value || '').trim();
  return !str || PLACEHOLDER_REGEX.test(str);
}

function maskCardNumber(raw) {
  const str = String(raw || '').trim();
  if (!str) return null;
  const digits = str.replace(/\D/g, '');
  if (digits.length >= 4) {
    return `****${digits.slice(-4)}`;
  }
  return str.slice(-8);
}

class CardNetHostedCheckoutProvider {
  constructor(options = {}) {
    const env = options.env || process.env;
    this.fetchImpl = options.fetchImpl || global.fetch;
    this.envName = String(env.CARDNET_ENV || 'STAGING').trim().toUpperCase();
    this.isProduction = ['PROD', 'PRODUCTION'].includes(this.envName);
    this.liveChargesEnabled = String(env.CARDNET_ENABLE_LIVE_CHARGES || '').toLowerCase() === 'true';

    this.baseUrl = String(
      options.baseUrl ||
        env.CARDNET_CHECKOUT_BASE_URL ||
        (this.isProduction ? 'https://ecommerce.cardnet.com.do' : 'https://lab.cardnet.com.do')
    ).replace(/\/+$/, '');

    this.merchantNumber = String(options.merchantNumber || env.CARDNET_MERCHANT_NUMBER || '').trim();
    this.merchantTerminal = String(options.merchantTerminal || env.CARDNET_TERMINAL_ID || '').trim();
    this.merchantName = String(options.merchantName || env.CARDNET_MERCHANT_NAME || '').trim();
    this.merchantType = String(options.merchantType || env.CARDNET_MERCHANT_TYPE || '').trim();
    this.acquiringInstitutionCode = String(
      options.acquiringInstitutionCode || env.CARDNET_ACQUIRING_INSTITUTION_CODE || ''
    ).trim();
    this.keyEncryptionKey = String(options.keyEncryptionKey || env.CARDNET_KEY_ENCRYPTION_KEY || '').trim();
    this.timeoutMs = Number(options.timeoutMs || env.CARDNET_TIMEOUT || 30000);
    this.publicBaseUrl = String(options.publicBaseUrl || env.PUBLIC_APP_URL || 'https://staging.etereasapp.com').replace(
      /\/+$/,
      ''
    );
  }

  getConfigurationStatus() {
    const missing = [];
    if (isMissingOrPlaceholder(this.merchantNumber)) missing.push('CARDNET_MERCHANT_NUMBER');
    if (isMissingOrPlaceholder(this.merchantTerminal)) missing.push('CARDNET_TERMINAL_ID');
    if (isMissingOrPlaceholder(this.merchantName)) missing.push('CARDNET_MERCHANT_NAME');
    if (isMissingOrPlaceholder(this.merchantType)) missing.push('CARDNET_MERCHANT_TYPE');
    if (isMissingOrPlaceholder(this.acquiringInstitutionCode)) missing.push('CARDNET_ACQUIRING_INSTITUTION_CODE');

    const blockedInProduction = this.isProduction && !this.liveChargesEnabled;

    return {
      provider: 'cardnet_hosted',
      modality: 'Integración con Pantalla (POST / Hosted Checkout + 3DSecure)',
      environment: this.isProduction ? 'production' : 'sandbox',
      baseUrl: this.baseUrl,
      configured: missing.length === 0 && !blockedInProduction,
      blockedInProduction,
      recurringSupported: false, // Requiere afiliación separada de Tokenización (Card on File)
      missingCredentials: missing,
    };
  }

  assertReadyForCheckout() {
    const status = this.getConfigurationStatus();
    if (status.blockedInProduction) {
      const err = new Error(
        'Los cobros reales en producción están deshabilitados hasta autorización expresa (CARDNET_ENABLE_LIVE_CHARGES).'
      );
      err.code = 'CARDNET_LIVE_CHARGES_DISABLED';
      err.statusCode = 503;
      err.requirements = status;
      throw err;
    }
    if (!status.configured) {
      const err = new Error(
        `Faltan credenciales oficiales de CardNet para iniciar el checkout: ${status.missingCredentials.join(', ')}`
      );
      err.code = 'CARDNET_CREDENTIALS_REQUIRED';
      err.statusCode = 503;
      err.requirements = status;
      throw err;
    }
  }

  async createSession({ orderNumber, transactionId, totalMinor, taxMinor = 0, currency = 'USD', returnUrl, cancelUrl, clientIp }) {
    this.assertReadyForCheckout();

    const currencyCode = CURRENCY_NUMERIC_MAP[String(currency || 'USD').toUpperCase()];
    if (!currencyCode) {
      const err = new Error(`Moneda no soportada para CardNet: ${currency}`);
      err.code = 'UNSUPPORTED_CURRENCY';
      err.statusCode = 400;
      throw err;
    }

    const amountMinorNum = Number(totalMinor);
    const taxMinorNum = Number(taxMinor || 0);
    if (!Number.isFinite(amountMinorNum) || amountMinorNum <= 0) {
      const err = new Error('El importe de la orden debe ser mayor a cero.');
      err.code = 'INVALID_AMOUNT';
      err.statusCode = 400;
      throw err;
    }

    const payload = {
      TransactionType: '0200',
      CurrencyCode: currencyCode,
      AcquiringInstitutionCode: this.acquiringInstitutionCode,
      MerchantType: this.merchantType,
      MerchantNumber: this.merchantNumber,
      MerchantTerminal: this.merchantTerminal,
      ReturnUrl: returnUrl || `${this.publicBaseUrl}/saas-checkout/retorno?order=${encodeURIComponent(orderNumber)}`,
      CancelUrl: cancelUrl || `${this.publicBaseUrl}/saas-checkout/retorno?order=${encodeURIComponent(orderNumber)}&cancelled=1`,
      PageLanguaje: 'ESP',
      OrdenId: String(orderNumber).slice(0, 20),
      TransactionId: String(transactionId || orderNumber).slice(0, 20),
      Tax: String(taxMinorNum),
      MerchantName: this.merchantName,
      Amount: String(amountMinorNum),
      ...(this.keyEncryptionKey ? { KeyEncriptionKey: this.keyEncryptionKey } : {}),
      ...(clientIp ? { Ipclient: String(clientIp).slice(0, 45) } : {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.SESSION || !data['session-key']) {
        const err = new Error(data.Message || data.error || `CardNet rechazó la creación de sesión (${response.status})`);
        err.code = 'CARDNET_SESSION_FAILED';
        err.statusCode = 502;
        throw err;
      }

      return {
        sessionId: String(data.SESSION),
        sessionKey: String(data['session-key']),
        authorizeUrl: `${this.baseUrl}/authorize`,
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        const timeoutErr = new Error('Tiempo de espera agotado al conectar con CardNet.');
        timeoutErr.code = 'CARDNET_TIMEOUT';
        timeoutErr.statusCode = 504;
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async verifySession({ sessionId, sessionKey, expectedOrderNumber, expectedAmountMinor, expectedCurrency }) {
    this.assertReadyForCheckout();

    if (!sessionId || !sessionKey) {
      const err = new Error('Falta SESSION o session-key para verificar la transacción en CardNet.');
      err.code = 'MISSING_SESSION_DATA';
      err.statusCode = 400;
      throw err;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = `${this.baseUrl}/sessions/${encodeURIComponent(sessionId)}?sk=${encodeURIComponent(sessionKey)}`;
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (response.status === 404) {
        return {
          outcome: 'expired',
          responseCode: 'SESSION_EXPIRED',
          message: 'La sesión de CardNet expiró (>30 minutos) o no fue encontrada.',
        };
      }

      if (!response.ok) {
        return {
          outcome: 'unknown_timeout',
          responseCode: `HTTP_${response.status}`,
          message: `Respuesta inesperada de CardNet (${response.status}); requiere conciliación.`,
        };
      }

      const data = await response.json().catch(() => ({}));
      const responseCode = String(data.ResponseCode ?? data.responseCode ?? '').trim();
      const returnedOrder = String(data.OrdenId ?? data.OrdenID ?? data.ordenId ?? '').trim();
      const returnedMerchant = String(data.MerchantNumber ?? data.merchantNumber ?? '').trim();
      const returnedAmountRaw = data.Amount ?? data.amount;
      const returnedCurrency = String(data.CurrencyCode ?? data.currencyCode ?? '').trim();
      const expectedCurrencyCode = CURRENCY_NUMERIC_MAP[String(expectedCurrency || 'USD').toUpperCase()];

      // Validaciones estrictas contra manipulación de orden, comercio, importe y moneda
      if (returnedOrder && expectedOrderNumber && returnedOrder !== String(expectedOrderNumber)) {
        return {
          outcome: 'invalid_verification',
          responseCode: 'ORDER_MISMATCH',
          message: 'El OrdenId devuelto por CardNet no coincide con la orden registrada.',
        };
      }

      if (returnedMerchant && returnedMerchant !== this.merchantNumber) {
        return {
          outcome: 'invalid_verification',
          responseCode: 'MERCHANT_MISMATCH',
          message: 'El comercio devuelto por CardNet no coincide con el comercio configurado.',
        };
      }

      if (returnedCurrency && expectedCurrencyCode && returnedCurrency !== expectedCurrencyCode) {
        return {
          outcome: 'invalid_verification',
          responseCode: 'CURRENCY_MISMATCH',
          message: 'La moneda devuelta por CardNet no coincide con la orden.',
        };
      }

      if (returnedAmountRaw !== undefined && returnedAmountRaw !== null && String(returnedAmountRaw).trim() !== '') {
        const returnedMinor = Number(returnedAmountRaw);
        if (!Number.isFinite(returnedMinor) || returnedMinor !== Number(expectedAmountMinor)) {
          return {
            outcome: 'invalid_verification',
            responseCode: 'AMOUNT_MISMATCH',
            message: 'El importe verificado en CardNet no coincide con el total calculado.',
          };
        }
      }

      const maskedCard = maskCardNumber(data.CreditCardNumber || data.MaskedCard || data.cardLast4);
      const authorizationCode = data.AuthorizationCode ? String(data.AuthorizationCode).trim() : null;
      const reference = data.RetrievalReferenceNumber || data.TransactionId || data.Reference || null;

      if (responseCode === '00') {
        return {
          outcome: 'approved',
          responseCode,
          authorizationCode,
          reference: reference ? String(reference).trim() : null,
          maskedCard,
          message: data.ResponseMessage || 'Transacción aprobada por CardNet.',
        };
      }

      return {
        outcome: 'declined',
        responseCode: responseCode || 'DECLINED',
        authorizationCode: null,
        reference: reference ? String(reference).trim() : null,
        maskedCard,
        message: data.ResponseMessage || `Transacción rechazada por CardNet (código ${responseCode || 'N/A'}).`,
      };
    } catch (err) {
      if (err.name === 'AbortError' || err.code === 'ECONNRESET' || err.code === 'ENOTFOUND' || err.type === 'system') {
        return {
          outcome: 'unknown_timeout',
          responseCode: 'TIMEOUT',
          message: 'Timeout o error de red consultando a CardNet; pendiente de conciliación.',
        };
      }
      return {
        outcome: 'unknown_timeout',
        responseCode: 'NETWORK_ERROR',
        message: `Error de comunicación con CardNet: ${err.message}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = {
  CardNetHostedCheckoutProvider,
  CURRENCY_NUMERIC_MAP,
  maskCardNumber,
};
