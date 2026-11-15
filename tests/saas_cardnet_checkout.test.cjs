const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { CardNetHostedCheckoutProvider } = require('../backend/services/cardnet_hosted_checkout.provider');
const { CardNetTokenizationProvider } = require('../backend/services/cardnet_tokenization.provider');
const { SaasCheckoutService, ORDER_STATUS } = require('../backend/services/saas_checkout.service');

/**
 * Pool en memoria mínimo para simular saas_checkout_orders y tenant_subscriptions
 */
function createInMemoryCheckoutPool() {
  const orders = new Map();
  const subscriptions = new Map();
  const events = [];

  return {
    orders,
    subscriptions,
    events,
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').trim();

      if (s.startsWith('SELECT * FROM saas_checkout_orders WHERE tenant_id = ? AND idempotency_key = ?')) {
        const [tenantId, key] = params;
        const found = [...orders.values()].filter((o) => o.tenant_id === tenantId && o.idempotency_key === key);
        return [found];
      }

      if (s.startsWith('SELECT * FROM saas_checkout_orders WHERE tenant_id = ? AND invoice_id = ?')) {
        const [tenantId, invoiceId] = params;
        const found = [...orders.values()].filter(
          (o) =>
            o.tenant_id === tenantId &&
            o.invoice_id === invoiceId &&
            ['pending_payment', 'processing'].includes(o.status) &&
            new Date(o.expires_at).getTime() > Date.now()
        );
        return [found];
      }

      if (s.startsWith('INSERT INTO saas_checkout_orders')) {
        const [
          id, order_number, tenant_id, invoice_id, created_by_user_id, source, payment_link_token,
          plan_code, branches_count, extra_users_count, memberships_addon_enabled, addon_branches_count,
          currency, subtotal_minor, tax_minor, total_minor, billing_cycle, status, idempotency_key,
          expires_at, metadata,
        ] = params;
        orders.set(id, {
          id,
          order_number,
          tenant_id,
          invoice_id,
          created_by_user_id,
          source,
          payment_link_token,
          plan_code,
          branches_count,
          extra_users_count,
          memberships_addon_enabled,
          addon_branches_count,
          currency,
          subtotal_minor,
          tax_minor,
          total_minor,
          billing_cycle,
          status,
          gateway_provider: 'cardnet_hosted',
          cardnet_session_id: null,
          cardnet_session_key: null,
          cardnet_authorization_code: null,
          cardnet_reference: null,
          cardnet_response_code: null,
          cardnet_response_message: null,
          masked_card: null,
          auto_renew_enabled: false,
          idempotency_key,
          expires_at,
          paid_at: null,
          activated_at: null,
          reconcile_attempts: 0,
          last_error: null,
          metadata,
          created_at: new Date(),
          updated_at: new Date(),
        });
        return [{ affectedRows: 1 }];
      }

      if (s.startsWith('SELECT * FROM saas_checkout_orders WHERE id = ? LIMIT 1')) {
        const o = orders.get(params[0]);
        return [o ? [{ ...o }] : []];
      }

      if (s.startsWith('SELECT * FROM saas_checkout_orders WHERE id = ? AND tenant_id = ? LIMIT 1')) {
        const [id, tenantId] = params;
        const o = orders.get(id);
        return [o && o.tenant_id === tenantId ? [{ ...o }] : []];
      }

      if (s.startsWith('SELECT * FROM saas_checkout_orders WHERE payment_link_token = ? AND tenant_id = ? LIMIT 1')) {
        const [token, tenantId] = params;
        const o = [...orders.values()].find((x) => x.payment_link_token === token && x.tenant_id === tenantId);
        return [o ? [{ ...o }] : []];
      }

      if (s.startsWith('SELECT * FROM saas_checkout_orders WHERE tenant_id = ? ORDER BY')) {
        const [tenantId] = params;
        return [[...orders.values()].filter((o) => o.tenant_id === tenantId).map((o) => ({ ...o }))];
      }

      if (s.startsWith('UPDATE saas_checkout_orders SET status = ?, cardnet_session_id = ?, cardnet_session_key = ?')) {
        const [status, sessionId, sessionKey, expiresAt, id, tenantId] = params;
        const o = orders.get(id);
        if (o && o.tenant_id === tenantId) {
          Object.assign(o, {
            status,
            cardnet_session_id: sessionId,
            cardnet_session_key: sessionKey,
            expires_at: expiresAt,
            updated_at: new Date(),
          });
        }
        return [{ affectedRows: 1 }];
      }

      if (s.startsWith('UPDATE saas_checkout_orders SET status = ?, paid_at =')) {
        const [status, authCode, ref, respCode, respMsg, maskedCard, id, tenantId] = params;
        const o = orders.get(id);
        if (o && o.tenant_id === tenantId) {
          Object.assign(o, {
            status,
            paid_at: o.paid_at || new Date(),
            cardnet_authorization_code: authCode,
            cardnet_reference: ref,
            cardnet_response_code: respCode,
            cardnet_response_message: respMsg,
            masked_card: maskedCard || o.masked_card,
            last_error: null,
          });
        }
        return [{ affectedRows: 1 }];
      }

      if (s.startsWith('UPDATE saas_checkout_orders SET status = ?, cardnet_response_code = ?, cardnet_response_message = ?, masked_card =')) {
        const [status, respCode, respMsg, maskedCard, id, tenantId] = params;
        const o = orders.get(id);
        if (o && o.tenant_id === tenantId && o.status !== 'approved') {
          Object.assign(o, { status, cardnet_response_code: respCode, cardnet_response_message: respMsg, masked_card: maskedCard || o.masked_card });
        }
        return [{ affectedRows: 1 }];
      }

      if (s.startsWith('UPDATE saas_checkout_orders SET status = ?, cardnet_response_code = ?, cardnet_response_message = ?, updated_at =')) {
        const [status, respCode, respMsg, id, tenantId] = params;
        const o = orders.get(id);
        if (o && o.tenant_id === tenantId && o.status !== 'approved') {
          Object.assign(o, { status, cardnet_response_code: respCode, cardnet_response_message: respMsg });
        }
        return [{ affectedRows: 1 }];
      }

      if (s.startsWith('UPDATE saas_checkout_orders SET status = ?, reconcile_attempts =')) {
        const [status, lastError, respCode, id, tenantId] = params;
        const o = orders.get(id);
        if (o && o.tenant_id === tenantId && o.status !== 'approved') {
          Object.assign(o, { status, reconcile_attempts: o.reconcile_attempts + 1, last_error: lastError, cardnet_response_code: respCode });
        }
        return [{ affectedRows: 1 }];
      }

      if (s.startsWith('UPDATE saas_checkout_orders SET status = ?, updated_at =')) {
        const [status, id, tenantId] = params;
        const o = orders.get(id);
        if (o && o.tenant_id === tenantId) {
          o.status = status;
        }
        return [{ affectedRows: 1 }];
      }

      if (s.startsWith('UPDATE saas_checkout_orders SET last_error = ?, cardnet_response_code = ?')) {
        const [lastError, respCode, id, tenantId] = params;
        const o = orders.get(id);
        if (o && o.tenant_id === tenantId) {
          Object.assign(o, { last_error: lastError, cardnet_response_code: respCode });
        }
        return [{ affectedRows: 1 }];
      }

      if (s.startsWith('UPDATE saas_checkout_orders SET activated_at = NOW()')) {
        const [id, tenantId] = params;
        const o = orders.get(id);
        if (o && o.tenant_id === tenantId) {
          o.activated_at = new Date();
          o.last_error = null;
        }
        return [{ affectedRows: 1 }];
      }

      if (s.startsWith('UPDATE saas_checkout_orders SET reconcile_attempts = reconcile_attempts + 1, last_error = ?')) {
        const [lastError, id, tenantId] = params;
        const o = orders.get(id);
        if (o && o.tenant_id === tenantId) {
          o.reconcile_attempts += 1;
          o.last_error = lastError;
        }
        return [{ affectedRows: 1 }];
      }

      if (s.startsWith('UPDATE tenant_subscriptions')) {
        const [planCode, tenantId] = params;
        subscriptions.set(tenantId, { tenant_id: tenantId, plan_code: planCode, status: 'active' });
        return [{ affectedRows: 1 }];
      }

      if (s.startsWith('INSERT INTO tenant_subscription_events')) {
        events.push(params);
        return [{ affectedRows: 1 }];
      }

      return [[]];
    },
  };
}

function makeSandboxEnv() {
  return {
    CARDNET_ENV: 'STAGING',
    CARDNET_MERCHANT_NUMBER: '349000001',
    CARDNET_TERMINAL_ID: '88800001',
    CARDNET_MERCHANT_NAME: 'ETEREAS SAAS TEST',
    CARDNET_MERCHANT_TYPE: '5999',
    CARDNET_ACQUIRING_INSTITUTION_CODE: '349',
    PUBLIC_APP_URL: 'https://staging.etereasapp.com',
  };
}

describe('CardNet Hosted Checkout & SaaS Subscription Activation', () => {
  let pool;

  beforeEach(() => {
    pool = createInMemoryCheckoutPool();
  });

  it('1. Bloquea checkout si faltan credenciales reales de CardNet o si live charges está desactivado en producción', async () => {
    const unconfigured = new CardNetHostedCheckoutProvider({
      env: { CARDNET_ENV: 'STAGING', CARDNET_MERCHANT_NUMBER: '000000000', CARDNET_TERMINAL_ID: '00000000' },
    });
    assert.equal(unconfigured.getConfigurationStatus().configured, false);
    assert.throws(() => unconfigured.assertReadyForCheckout(), { code: 'CARDNET_CREDENTIALS_REQUIRED' });

    const prodBlocked = new CardNetHostedCheckoutProvider({
      env: { ...makeSandboxEnv(), CARDNET_ENV: 'PRODUCTION', CARDNET_ENABLE_LIVE_CHARGES: 'false' },
    });
    assert.equal(prodBlocked.getConfigurationStatus().blockedInProduction, true);
    assert.throws(() => prodBlocked.assertReadyForCheckout(), { code: 'CARDNET_LIVE_CHARGES_DISABLED' });
  });

  it('2. Pago aprobado en sandbox activa la suscripción y el add-on sin almacenar PAN/CVC ni session-key en respuesta', async () => {
    let createCalls = 0;
    let verifyCalls = 0;
    let capturedAddonArgs = null;

    const provider = new CardNetHostedCheckoutProvider({
      env: makeSandboxEnv(),
      fetchImpl: async (url, init) => {
        if (url.endsWith('/sessions') && init.method === 'POST') {
          createCalls += 1;
          const body = JSON.parse(init.body);
          assert.equal(body.Amount, '19800'); // 1 sucursal US$99 + 1 add-on US$99 = US$198.00 (nunca US$149)
          assert.equal(body.CurrencyCode, '840');
          return {
            ok: true,
            status: 200,
            json: async () => ({ SESSION: 'sess_ok_1', 'session-key': 'sk_secret_1' }),
          };
        }
        if (url.includes('/sessions/sess_ok_1?sk=sk_secret_1')) {
          verifyCalls += 1;
          const o = [...pool.orders.values()][0];
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ResponseCode: '00',
              AuthorizationCode: 'AUTH123',
              RetrievalReferenceNumber: 'RRN999',
              OrdenId: o.order_number,
              MerchantNumber: '349000001',
              Amount: '19800',
              CurrencyCode: '840',
              CreditCardNumber: '411111******1111',
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    const service = new SaasCheckoutService({
      pool,
      cardnetProvider: provider,
      entitlementsService: {
        async setAddonStatus(tenantId, addonCode, opts) {
          capturedAddonArgs = { tenantId, addonCode, opts };
        },
      },
    });

    const order = await service.createOrder({
      tenantId: 'tenant-1',
      branchesCount: 1,
      wantsMembershipsAddon: true,
      addonBranchesCount: 1,
      idempotencyKey: 'idem-1',
    });

    assert.equal(order.total_minor, '19800');
    assert.equal(order.status, ORDER_STATUS.PENDING_PAYMENT);
    assert.equal(order.cardnet_session_key, undefined);

    const init = await service.initiateCardnetCheckout({ orderId: order.id, tenantId: 'tenant-1' });
    assert.equal(init.checkout.sessionId, 'sess_ok_1');
    assert.equal(createCalls, 1);

    // Doble clic: reutiliza sesión existente sin crear otra en CardNet
    const initDup = await service.initiateCardnetCheckout({ orderId: order.id, tenantId: 'tenant-1' });
    assert.equal(initDup.checkout.reusedSession, true);
    assert.equal(createCalls, 1);

    const finalRes = await service.verifyAndFinalizeOrder({ orderId: order.id, tenantId: 'tenant-1' });
    assert.equal(verifyCalls, 1);
    assert.equal(finalRes.activated, true);
    assert.equal(finalRes.order.status, ORDER_STATUS.APPROVED);
    assert.equal(finalRes.order.masked_card, '****1111');
    assert.equal(pool.subscriptions.get('tenant-1')?.status, 'active');
    assert.equal(capturedAddonArgs?.addonCode, 'memberships');

    // Notificación/verificación duplicada: idempotente, no vuelve a consultar CardNet
    const dupVerify = await service.verifyAndFinalizeOrder({ orderId: order.id, tenantId: 'tenant-1' });
    assert.equal(dupVerify.alreadyProcessed, true);
    assert.equal(verifyCalls, 1);
  });

  it('3. Rechazo y cancelación no activan la suscripción', async () => {
    const provider = new CardNetHostedCheckoutProvider({
      env: makeSandboxEnv(),
      fetchImpl: async (url, init) => {
        if (url.endsWith('/sessions') && init.method === 'POST') {
          return { ok: true, status: 200, json: async () => ({ SESSION: 'sess_dec', 'session-key': 'sk_dec' }) };
        }
        const o = [...pool.orders.values()][0];
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ResponseCode: '05',
            ResponseMessage: 'Fondos insuficientes',
            OrdenId: o.order_number,
            MerchantNumber: '349000001',
            Amount: '9900',
            CurrencyCode: '840',
          }),
        };
      },
    });

    const service = new SaasCheckoutService({ pool, cardnetProvider: provider });
    const order = await service.createOrder({ tenantId: 'tenant-2', branchesCount: 1, idempotencyKey: 'idem-dec' });
    await service.initiateCardnetCheckout({ orderId: order.id, tenantId: 'tenant-2' });

    const res = await service.verifyAndFinalizeOrder({ orderId: order.id, tenantId: 'tenant-2' });
    assert.equal(res.activated, false);
    assert.equal(res.order.status, ORDER_STATUS.DECLINED);
    assert.equal(pool.subscriptions.has('tenant-2'), false);
  });

  it('4. Rechaza manipulación de importe/comercio y aísla órdenes entre tenants', async () => {
    const provider = new CardNetHostedCheckoutProvider({
      env: makeSandboxEnv(),
      fetchImpl: async (url, init) => {
        if (url.endsWith('/sessions') && init.method === 'POST') {
          return { ok: true, status: 200, json: async () => ({ SESSION: 'sess_tamp', 'session-key': 'sk_tamp' }) };
        }
        const o = [...pool.orders.values()][0];
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ResponseCode: '00',
            OrdenId: o.order_number,
            MerchantNumber: '349000001',
            Amount: '100', // Importe manipulado!
            CurrencyCode: '840',
          }),
        };
      },
    });

    const service = new SaasCheckoutService({ pool, cardnetProvider: provider });
    const order = await service.createOrder({ tenantId: 'tenant-a', branchesCount: 1, idempotencyKey: 'idem-a' });
    await service.initiateCardnetCheckout({ orderId: order.id, tenantId: 'tenant-a' });

    // Aislamiento entre tenants
    const crossTenant = await service.getOrderForTenant(order.id, 'tenant-b');
    assert.equal(crossTenant, null);

    await assert.rejects(
      () => service.verifyAndFinalizeOrder({ orderId: order.id, tenantId: 'tenant-a' }),
      { code: 'AMOUNT_MISMATCH' }
    );
    assert.equal(pool.subscriptions.has('tenant-a'), false);
  });

  it('5. Timeout y falla interna tras cobro aprobado permiten conciliación sin volver a cobrar', async () => {
    let verifyMode = 'timeout';
    let shouldFailLifecycle = true;
    let verifyHits = 0;

    const provider = new CardNetHostedCheckoutProvider({
      env: makeSandboxEnv(),
      fetchImpl: async (url, init) => {
        if (url.endsWith('/sessions') && init.method === 'POST') {
          return { ok: true, status: 200, json: async () => ({ SESSION: 'sess_rec', 'session-key': 'sk_rec' }) };
        }
        verifyHits += 1;
        if (verifyMode === 'timeout') {
          const err = new Error('network timeout');
          err.name = 'AbortError';
          throw err;
        }
        const o = [...pool.orders.values()][0];
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ResponseCode: '00',
            AuthorizationCode: 'AUTH_REC',
            OrdenId: o.order_number,
            MerchantNumber: '349000001',
            Amount: '9900',
            CurrencyCode: '840',
          }),
        };
      },
    });

    const service = new SaasCheckoutService({
      pool,
      cardnetProvider: provider,
      lifecycleService: {
        async activateOrRenewAfterPayment({ tenantId, planCode }) {
          if (shouldFailLifecycle) throw new Error('DB deadlock transitorio');
          pool.subscriptions.set(tenantId, { tenant_id: tenantId, plan_code: planCode, status: 'active' });
        },
      },
    });

    const order = await service.createOrder({ tenantId: 'tenant-rec', branchesCount: 1, idempotencyKey: 'idem-rec' });
    await service.initiateCardnetCheckout({ orderId: order.id, tenantId: 'tenant-rec' });

    const r1 = await service.verifyAndFinalizeOrder({ orderId: order.id, tenantId: 'tenant-rec' });
    assert.equal(r1.order.status, ORDER_STATUS.UNKNOWN_TIMEOUT);
    assert.equal(r1.needsReconciliation, true);

    verifyMode = 'approved';
    const r2 = await service.verifyAndFinalizeOrder({ orderId: order.id, tenantId: 'tenant-rec' });
    assert.equal(r2.order.status, ORDER_STATUS.APPROVED);
    assert.equal(r2.activated, false);
    assert.equal(r2.needsReconciliation, true);
    assert.equal(verifyHits, 2);

    // Reconciliación final: completa activación sin volver a llamar a CardNet
    shouldFailLifecycle = false;
    const r3 = await service.verifyAndFinalizeOrder({ orderId: order.id, tenantId: 'tenant-rec' });
    assert.equal(r3.activated, true);
    assert.equal(verifyHits, 2);
    assert.equal(pool.subscriptions.get('tenant-rec')?.status, 'active');
  });

  it('6. CardNet Tokenización (PWCheckout): reutiliza sesión al cerrar/reabrir, cobra con importe del servidor y es idempotente', async () => {
    let customerCalls = 0;
    let purchaseCalls = 0;
    const tokProvider = new CardNetTokenizationProvider({
      env: {
        CARDNET_BASE_URL: 'https://labservicios.cardnet.com.do/servicios/tokens/v1',
        CARDNET_PUBLIC_KEY: 'pub_test_123',
        CARDNET_PRIVATE_KEY: 'priv_secret_never_leak',
        CARDNET_MERCHANT_NUMBER: '349000001',
        CARDNET_TERMINAL_ID: '10311240',
        CARDNET_ENV: 'STAGING',
      },
      fetchImpl: async (url, init) => {
        if (url.endsWith('/api/Customer')) {
          customerCalls += 1;
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              Response: {
                CustomerId: 777001,
                UniqueID: 'UI_sandbox_1',
                CaptureURL: 'https://labservicios.cardnet.com.do/servicios/tokens/v1/Capture',
              },
              Errors: [],
            }),
          };
        }
        if (url.endsWith('/api/Purchase')) {
          purchaseCalls += 1;
          const body = JSON.parse(init.body);
          assert.equal(body.Amount, 9900);
          assert.equal(body.TrxToken, 'trx_one_time_ok');
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              Response: {
                ResponseCode: '00',
                Transaction: { Status: 'Approved', TransactionId: 'TXN_TOK_1' },
                AuthorizationCode: 'AUTH_TOK',
                Brand: 'Visa',
                Last4: '4242',
              },
              Errors: [],
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    const service = new SaasCheckoutService({
      pool,
      cardnetProvider: new CardNetHostedCheckoutProvider({ env: {} }),
      tokenizationProvider: tokProvider,
      lifecycleService: {
        async activateOrRenewAfterPayment({ tenantId, planCode }) {
          pool.subscriptions.set(tenantId, { tenant_id: tenantId, plan_code: planCode, status: 'active' });
        },
      },
    });

    const order = await service.createOrder({ tenantId: 'tenant-tok', branchesCount: 1, idempotencyKey: 'idem-tok' });
    const init1 = await service.initiateCardnetCheckout({
      orderId: order.id,
      tenantId: 'tenant-tok',
      actorEmail: 'owner@empresa.com',
    });
    assert.equal(init1.checkout.mode, 'pwcheckout_iframe');
    assert.equal(init1.checkout.reusedSession, false);
    assert.equal(JSON.stringify(init1).includes('priv_secret_never_leak'), false);

    // Reapertura tras cerrar iframe sin pagar: debe reutilizar la sesión vigente sin llamar otra vez a /api/Customer
    const init2 = await service.initiateCardnetCheckout({
      orderId: order.id,
      tenantId: 'tenant-tok',
      actorEmail: 'owner@empresa.com',
    });
    assert.equal(init2.checkout.reusedSession, true);
    assert.equal(customerCalls, 1);

    // Cobro aprobado con TrxToken
    const paid1 = await service.chargeOrderWithToken({
      orderId: order.id,
      tenantId: 'tenant-tok',
      trxToken: 'trx_one_time_ok',
    });
    assert.equal(paid1.activated, true);
    assert.equal(paid1.order.status, ORDER_STATUS.APPROVED);
    assert.equal(pool.subscriptions.get('tenant-tok')?.status, 'active');

    // Doble envío / confirmación duplicada no vuelve a cobrar
    const paid2 = await service.chargeOrderWithToken({
      orderId: order.id,
      tenantId: 'tenant-tok',
      trxToken: 'trx_one_time_ok',
    });
    assert.equal(paid2.alreadyProcessed, true);
    assert.equal(purchaseCalls, 1);
  });

  it('7. CardNet Tokenización: rechazo y timeout no activan la empresa ni la suscripción', async () => {
    let mode = 'declined';
    const tokProvider = new CardNetTokenizationProvider({
      env: {
        CARDNET_BASE_URL: 'https://labservicios.cardnet.com.do/servicios/tokens/v1',
        CARDNET_PUBLIC_KEY: 'pub_test_123',
        CARDNET_PRIVATE_KEY: 'priv_secret_123',
        CARDNET_MERCHANT_NUMBER: '349000001',
        CARDNET_TERMINAL_ID: '10311240',
        CARDNET_ENV: 'STAGING',
      },
      fetchImpl: async (url) => {
        if (url.endsWith('/api/Customer')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              Response: { CustomerId: 777002, UniqueID: 'UI_sandbox_2', CaptureURL: 'https://labservicios.cardnet.com.do/servicios/tokens/v1/Capture' },
            }),
          };
        }
        if (url.endsWith('/api/Purchase')) {
          if (mode === 'timeout') {
            const err = new Error('aborted');
            err.name = 'AbortError';
            throw err;
          }
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              Response: { ResponseCode: '51', ResponseMessage: 'Fondos insuficientes', Transaction: { Status: 'Declined' } },
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    const service = new SaasCheckoutService({
      pool,
      cardnetProvider: new CardNetHostedCheckoutProvider({ env: {} }),
      tokenizationProvider: tokProvider,
    });

    const ordTimeout = await service.createOrder({ tenantId: 'tenant-to', branchesCount: 1 });
    await service.initiateCardnetCheckout({ orderId: ordTimeout.id, tenantId: 'tenant-to', actorEmail: 'to@empresa.com' });
    mode = 'timeout';
    await assert.rejects(
      () => service.chargeOrderWithToken({ orderId: ordTimeout.id, tenantId: 'tenant-to', trxToken: 'tok_to' }),
      { code: 'CARDNET_TIMEOUT' }
    );
    const savedTimeout = await service.getOrderForTenant(ordTimeout.id, 'tenant-to');
    assert.equal(savedTimeout.status, ORDER_STATUS.UNKNOWN_TIMEOUT);
    assert.equal(pool.subscriptions.has('tenant-to'), false);

    const ordDec = await service.createOrder({ tenantId: 'tenant-dec', branchesCount: 1 });
    await service.initiateCardnetCheckout({ orderId: ordDec.id, tenantId: 'tenant-dec', actorEmail: 'dec@empresa.com' });
    mode = 'declined';
    const decRes = await service.chargeOrderWithToken({ orderId: ordDec.id, tenantId: 'tenant-dec', trxToken: 'tok_dec' });
    assert.equal(decRes.activated, false);
    assert.equal(decRes.declined, true);
    assert.equal(decRes.order.status, ORDER_STATUS.DECLINED);
    assert.equal(pool.subscriptions.has('tenant-dec'), false);
  });
});
