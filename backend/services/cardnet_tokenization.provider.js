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

const SOFT_DECLINE_CODES = new Set(['51', '61', '65', '91', '96', 'TIMEOUT']);
const HARD_DECLINE_CODES = new Set(['05', '12', '13', '14', '41', '43', '54', '57', '58', '62', '63', '75', '78', '82']);

function classifyCardNetResponseCode(responseCode, responseMessage = '') {
  const code = String(responseCode || '').trim().toUpperCase();
  const msg = String(responseMessage || '').toLowerCase();

  if (code === '00') {
    return { approved: true, retriable: false, requiresAuthentication: false, category: 'approved' };
  }
  if (
    code === '3DS' ||
    code === 'AUTH_REQUIRED' ||
    msg.includes('3d') ||
    msg.includes('authentication') ||
    msg.includes('challenge')
  ) {
    return { approved: false, retriable: false, requiresAuthentication: true, category: 'auth_required' };
  }
  if (HARD_DECLINE_CODES.has(code)) {
    return { approved: false, retriable: false, requiresAuthentication: false, category: 'hard_decline' };
  }
  if (SOFT_DECLINE_CODES.has(code)) {
    return { approved: false, retriable: true, requiresAuthentication: false, category: 'soft_decline' };
  }
  return { approved: false, retriable: false, requiresAuthentication: false, category: 'hard_decline' };
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

  async getCustomerProfile(customerId) {
    this.assertReadyForCheckout();
    const safeId = encodeURIComponent(String(customerId || '').trim());
    if (!safeId) return null;
    const res = await this._fetchJson(`${this.baseUrl}/api/Customer/${safeId}`, {
      method: 'GET',
      headers: this._authHeaders(),
    });
    const customer = res.data?.Response || res.data;
    if (!customer) return null;
    const rawProfiles = Array.isArray(customer.PaymentProfiles) ? customer.PaymentProfiles : [];
    const paymentProfiles = rawProfiles
      .map((p) => {
        const expRaw = String(p.Expiration || '').trim();
        let expYear = null;
        let expMonth = null;
        if (/^\d{6}$/.test(expRaw)) {
          expYear = Number(expRaw.slice(0, 4));
          expMonth = Number(expRaw.slice(4, 6));
        }
        return {
          paymentProfileId: p.PaymentProfileId ? String(p.PaymentProfileId) : null,
          brand: p.Brand ? String(p.Brand).trim().toUpperCase() : null,
          last4: p.Last4 ? String(p.Last4).slice(-4) : null,
          expMonth,
          expYear,
          token: p.Token ? String(p.Token) : null,
          enabled: p.Enabled !== false,
        };
      })
      .filter((p) => p.token || p.paymentProfileId);
    return {
      customerId: String(customer.CustomerId || customerId),
      paymentProfiles,
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

    const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;
    const isWrapperOkCode = (c) => c === '0' || c === 0;
    const isWrapperOkMsg = (m) => typeof m === 'string' && m.trim().toUpperCase() === 'OK';

    const responseCode = isApproved
      ? (approvedStep?.ResponseCode || raw.ResponseCode || '00')
      : (
          lastStep?.ResponseCode ||
          errors[0]?.ErrorCode ||
          errors[0]?.Code ||
          (!isWrapperOkCode(raw.ResponseCode) ? raw.ResponseCode : null) ||
          raw.Transaction?.TransactionStatusId ||
          raw.ResponseCode ||
          null
        );

    const errorSummary = errors
      .map((e) => [e?.ErrorCode || e?.Code, e?.ErrorMessage || e?.Message || e?.Description].filter(Boolean).join(': '))
      .filter(Boolean)
      .join(' | ');
    const stepSummary = lastStep
      ? [lastStep.ResponseCode, lastStep.ResponseMessage || lastStep.Description || lastStep.Status].filter(Boolean).join(' - ')
      : '';
    const responseMessage = isApproved
      ? (raw.ResponseMessage || 'Transacción aprobada')
      : (
          errorSummary ||
          stepSummary ||
          (!isWrapperOkMsg(raw.ResponseMessage) ? raw.ResponseMessage : null) ||
          raw.Transaction?.Description ||
          raw.Transaction?.Status ||
          'Transacción rechazada por CardNet'
        );

    if (!isApproved) {
      console.warn('[CARDNET_PURCHASE_DECLINED]', JSON.stringify({
        orderNumber,
        httpStatus: res.status,
        wrapperCode: raw.ResponseCode ?? null,
        wrapperMsg: raw.ResponseMessage ?? null,
        txStatus: raw.Transaction?.Status ?? null,
        txStatusId: raw.Transaction?.TransactionStatusId ?? null,
        txDesc: raw.Transaction?.Description ?? null,
        steps: steps.map((s) => ({
          step: s?.Step || s?.Name || null,
          status: s?.Status || null,
          code: s?.ResponseCode ?? null,
          msg: s?.ResponseMessage || s?.Description || null,
        })),
        errors: errors.map((e) => ({
          code: e?.ErrorCode || e?.Code || null,
          msg: e?.ErrorMessage || e?.Message || e?.Description || null,
        })),
      }));
    }

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

    const classification = isApproved
      ? { approved: true, retriable: false, requiresAuthentication: false, category: 'approved' }
      : classifyCardNetResponseCode(responseCode, responseMessage);

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
      retriable: classification.retriable,
      requiresAuthentication: classification.requiresAuthentication,
      declineCategory: classification.category,
      rawSafeSummary: {
        transactionStatus: raw.Transaction?.Status || null,
        responseCode: responseCode ? String(responseCode) : null,
        hasErrors: errors.length > 0,
      },
    };
  }

  async queryTransaction({ transactionId }) {
    this.assertReadyForCheckout();
    const safeTxId = encodeURIComponent(String(transactionId || '').trim());
    if (!safeTxId) {
      return { found: false, approved: false, pending: false, status: 'not_found' };
    }

    const res = await this._fetchJson(`${this.baseUrl}/api/Purchase/${safeTxId}`, {
      method: 'GET',
      headers: this._authHeaders(),
    });
    if (res.status === 404) {
      return { found: false, approved: false, pending: false, status: 'not_found' };
    }

    const raw = res.data?.Response || res.data || {};
    const steps = Array.isArray(raw.Transaction?.Steps) ? raw.Transaction.Steps : [];
    const approvedStep = steps.find((s) => s.ResponseCode === '00');
    const isApproved =
      raw.Transaction?.Status === 'Approved' ||
      raw.ResponseCode === '00' ||
      Boolean(approvedStep);
    const responseCode =
      approvedStep?.ResponseCode ||
      raw.ResponseCode ||
      steps[0]?.ResponseCode ||
      null;
    const authorizationCode =
      approvedStep?.AuthorizationCode ||
      raw.AuthorizationCode ||
      raw.Transaction?.AuthorizationCode ||
      null;

    const classification = isApproved
      ? { approved: true, retriable: false, requiresAuthentication: false, category: 'approved' }
      : classifyCardNetResponseCode(responseCode, raw.ResponseMessage);

    return {
      found: res.ok,
      approved: Boolean(isApproved),
      pending: !res.ok && res.status >= 500,
      status: isApproved ? 'approved' : res.ok ? 'declined' : 'unknown',
      responseCode: responseCode ? String(responseCode) : null,
      authorizationCode: authorizationCode ? String(authorizationCode) : null,
      transactionId: raw.Transaction?.TransactionId || raw.TransactionId || String(transactionId),
      retrievalReferenceNumber: approvedStep?.RetrievalReferenceNumber || raw.RetrievalReferenceNumber || null,
      retriable: classification.retriable,
      requiresAuthentication: classification.requiresAuthentication,
      declineCategory: classification.category,
    };
  }
}

module.exports = {
  CardNetTokenizationProvider,
  maskCardNumber,
  classifyCardNetResponseCode,
};
