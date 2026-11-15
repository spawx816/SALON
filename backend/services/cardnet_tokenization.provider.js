/**
 * CardNet Dominicana — API de Tokenización / PWCheckout (servicios/tokens/v1)
 *
 * Flujo PCI-compliant:
 *   1. Backend: POST {baseUrl}/api/Customer -> { CustomerId, UniqueID, CaptureURL }
 *   2. Frontend: Carga {baseUrl}/Scripts/PWCheckout.js?key={PublicKey} y abre iframe seguro
 *      PWCheckout.OpenIframeCustom("{CaptureURL}/?key={PublicKey}&session_id={UniqueID}", UniqueID)
 *   3. CardNet emite evento `tokenCreated` con un token de un solo uso (OneTime / TrxToken)
 *   4. Backend: POST {baseUrl}/api/Purchase con TrxToken e importe calculado en servidor
 *
 * PCI DSS INVARIANT:
 * Etereas NUNCA recibe, procesa, registra ni almacena PAN completo, CVC/CVV ni PrivateKey en frontend.
 */

const PLACEHOLDER_REGEX = /dummy|000000|fake|placeholder|changeme/i;

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

class CardNetTokenizationProvider {
  constructor(options = {}) {
    const env = options.env || process.env;
    this.fetchImpl = options.fetchImpl || global.fetch;
    this.envName = String(env.CARDNET_ENV || 'STAGING').trim().toUpperCase();
    this.isProduction = ['PROD', 'PRODUCTION'].includes(this.envName);
    this.liveChargesEnabled = String(env.CARDNET_ENABLE_LIVE_CHARGES || '').toLowerCase() === 'true';

    this.baseUrl = String(
      options.baseUrl ||
        env.CARDNET_BASE_URL ||
        (this.isProduction
          ? 'https://servicios.cardnet.com.do/servicios/tokens/v1'
          : 'https://labservicios.cardnet.com.do/servicios/tokens/v1')
    ).replace(/\/+$/, '');

    this.publicKey = String(options.publicKey || env.CARDNET_PUBLIC_KEY || '').trim();
    this.privateKey = String(options.privateKey || env.CARDNET_PRIVATE_KEY || '').trim();
    this.merchantNumber = String(options.merchantNumber || env.CARDNET_MERCHANT_NUMBER || '').trim();
    this.merchantTerminal = String(options.merchantTerminal || env.CARDNET_TERMINAL_ID || '').trim();
    this.timeoutMs = Number(options.timeoutMs || env.CARDNET_TIMEOUT || 30000);
    this.publicBaseUrl = String(options.publicBaseUrl || env.PUBLIC_APP_URL || 'https://staging.etereasapp.com').replace(
      /\/+$/,
      ''
    );
  }

  getConfigurationStatus() {
    const missing = [];
    if (isMissingOrPlaceholder(this.baseUrl)) missing.push('CARDNET_BASE_URL');
    if (isMissingOrPlaceholder(this.publicKey)) missing.push('CARDNET_PUBLIC_KEY');
    if (isMissingOrPlaceholder(this.privateKey)) missing.push('CARDNET_PRIVATE_KEY');
    if (isMissingOrPlaceholder(this.merchantNumber)) missing.push('CARDNET_MERCHANT_NUMBER');
    if (isMissingOrPlaceholder(this.merchantTerminal)) missing.push('CARDNET_TERMINAL_ID');

    const blockedInProduction = this.isProduction && !this.liveChargesEnabled;

    return {
      provider: 'cardnet_tokenization',
      modality: 'CardNet Tokenización (servicios/tokens/v1 + PWCheckout)',
      environment: this.isProduction ? 'production' : 'sandbox',
      baseUrl: this.baseUrl,
      configured: missing.length === 0 && !blockedInProduction,
      blockedInProduction,
      recurringSupported: true,
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
        `Faltan credenciales oficiales de CardNet Tokenización: ${status.missingCredentials.join(', ')}`
      );
      err.code = 'CARDNET_CREDENTIALS_REQUIRED';
      err.statusCode = 503;
      err.requirements = status;
      throw err;
    }
  }

  _authHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Basic ${this.privateKey}`,
    };
  }

  async _fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        ...options,
        signal: controller.signal,
      });
      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { rawText: text };
      }
      return { ok: response.ok, status: response.status, data: json };
    } catch (err) {
      if (err?.name === 'AbortError') {
        const timeoutErr = new Error('Tiempo de espera agotado comunicando con CardNet.');
        timeoutErr.code = 'CARDNET_TIMEOUT';
        timeoutErr.statusCode = 504;
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async createCustomerSession({ email }) {
    this.assertReadyForCheckout();
    const safeEmail = String(email || '').trim();
    if (!safeEmail) {
      const err = new Error('Se requiere el correo del propietario para iniciar CardNet.');
      err.code = 'CUSTOMER_EMAIL_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    const res = await this._fetchJson(`${this.baseUrl}/api/Customer`, {
      method: 'POST',
      headers: this._authHeaders(),
      body: JSON.stringify({ Email: safeEmail, Enable: 'true' }),
    });

    let customer = res.data?.Response || res.data;

    // Si el correo ya existe en CardNet (ResponseCode 13), recuperar cliente existente
    const errors = res.data?.Errors || [];
    const alreadyExists =
      customer?.ResponseCode === '13' ||
      errors.some((e) => String(e?.ErrorCode) === '13') ||
      JSON.stringify(res.data || {}).toLowerCase().includes('already exists');

    if (alreadyExists) {
      const existingId = customer?.CustomerId || res.data?.CustomerId;
      if (existingId) {
        const getRes = await this._fetchJson(`${this.baseUrl}/api/Customer/${existingId}`, {
          method: 'GET',
          headers: this._authHeaders(),
        });
        customer = getRes.data?.Response || getRes.data;
      }
    }

    const uniqueId = customer?.UniqueID || customer?.uniqueId;
    const captureUrl = customer?.CaptureURL || customer?.captureUrl || `${this.baseUrl}/Capture`;
    const customerId = customer?.CustomerId || customer?.customerId;

    if (!uniqueId || !customerId) {
      const err = new Error(
        errors[0]?.Message || customer?.ResponseMessage || 'CardNet no devolvió UniqueID/CustomerId para abrir el checkout.'
      );
      err.code = 'CARDNET_SESSION_FAILED';
      err.statusCode = 502;
      throw err;
    }

    return {
      customerId: String(customerId),
      uniqueId: String(uniqueId),
      captureUrl: String(captureUrl),
      publicKey: this.publicKey,
    };
  }

  async purchaseWithToken({ trxToken, orderNumber, totalMinor, taxMinor = 0, currency = 'USD', description, clientIp }) {
    this.assertReadyForCheckout();
    if (!trxToken || typeof trxToken !== 'string') {
      const err = new Error('Token de tarjeta (trxToken) requerido.');
      err.code = 'INVALID_TRX_TOKEN';
      err.statusCode = 400;
      throw err;
    }

    const amountMinorNum = Number(totalMinor);
    if (!Number.isFinite(amountMinorNum) || amountMinorNum <= 0) {
      const err = new Error('El importe de la orden debe ser mayor a cero.');
      err.code = 'INVALID_AMOUNT';
      err.statusCode = 400;
      throw err;
    }

    const payload = {
      TrxToken: trxToken,
      Order: String(orderNumber).slice(0, 20),
      Amount: Math.round(amountMinorNum),
      Currency: String(currency || 'USD').toUpperCase(),
      Capture: true,
      Description: String(description || `Suscripción Etereas ${orderNumber}`).slice(0, 120),
      CustomerIP: String(clientIp || '127.0.0.1').slice(0, 45),
      MerchantNumber: this.merchantNumber,
      MerchantTerminal: this.merchantTerminal,
      DataDo: {
        Tax: String(Math.round(Number(taxMinor || 0))),
        Invoice: String(orderNumber).slice(0, 20),
      },
    };

    const res = await this._fetchJson(`${this.baseUrl}/api/Purchase`, {
      method: 'POST',
      headers: this._authHeaders(),
      body: JSON.stringify(payload),
    });

    const raw = res.data?.Response || res.data || {};
    const errors = Array.isArray(res.data?.Errors) ? res.data.Errors : [];
    const steps = Array.isArray(raw.Transaction?.Steps) ? raw.Transaction.Steps : [];
    const approvedStep = steps.find((s) => s.ResponseCode === '00');

    const isApproved =
      raw.Transaction?.Status === 'Approved' ||
      raw.ResponseCode === '00' ||
      Boolean(approvedStep);

    const responseCode =
      approvedStep?.ResponseCode ||
      raw.ResponseCode ||
      errors[0]?.ErrorCode ||
      steps[0]?.ResponseCode ||
      null;

    const responseMessage =
      raw.ResponseMessage ||
      errors[0]?.Message ||
      raw.Transaction?.Description ||
      (isApproved ? 'Transacción aprobada' : 'Transacción rechazada por CardNet');

    const authorizationCode =
      approvedStep?.AuthorizationCode ||
      raw.AuthorizationCode ||
      raw.Transaction?.AuthorizationCode ||
      null;

    const transactionId =
      raw.Transaction?.TransactionId ||
      raw.TransactionId ||
      null;

    const retrievalReferenceNumber =
      approvedStep?.RetrievalReferenceNumber ||
      raw.RetrievalReferenceNumber ||
      null;

    const returnedCurrency = raw.Currency || raw.Transaction?.Currency || null;
    const returnedAmountRaw = raw.Amount ?? raw.Transaction?.Amount ?? null;
    const currencyMatches =
      !returnedCurrency || String(returnedCurrency).toUpperCase() === payload.Currency;
    const amountMatches =
      returnedAmountRaw === null ||
      returnedAmountRaw === undefined ||
      Math.round(Number(returnedAmountRaw)) === payload.Amount;

    if (isApproved && (!currencyMatches || !amountMatches)) {
      const err = new Error('El monto o moneda confirmados por CardNet no coinciden con la orden.');
      err.code = 'PAYMENT_AMOUNT_MISMATCH';
      err.statusCode = 409;
      throw err;
    }

    return {
      approved: Boolean(isApproved),
      pending: false,
      status: isApproved ? 'approved' : 'declined',
      responseCode: responseCode ? String(responseCode) : null,
      responseMessage: String(responseMessage),
      authorizationCode: authorizationCode ? String(authorizationCode) : null,
      transactionId: transactionId ? String(transactionId) : null,
      retrievalReferenceNumber: retrievalReferenceNumber ? String(retrievalReferenceNumber) : null,
      cardBrand: raw.CardBrand || raw.Brand || null,
      maskedCard: maskCardNumber(raw.Last4 || raw.CardNumber),
      rawSafeSummary: {
        transactionStatus: raw.Transaction?.Status || null,
        responseCode: responseCode ? String(responseCode) : null,
        hasErrors: errors.length > 0,
      },
    };
  }
}

module.exports = {
  CardNetTokenizationProvider,
  maskCardNumber,
};
