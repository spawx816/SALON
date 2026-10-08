const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const DEFAULT_CONTRACT_BODY = `Entre los subscritos, La empresa: **{{EMPRESA_NOMBRE}}**, debidamente constituida de conformidad con las leyes de la Republica Dominicana, con Registro Nacional del Contribuyente No. **{{EMPRESA_RNC}}**, con su domicilio social en **{{EMPRESA_DIRECCION}}**, quien en lo que sigue del presente contrato se denominara, **LA COMPAÑIA**, y de la otra parte la Sra./Sr. **{{CLIENTE_NOMBRE}}**, Dominicana/o, mayor de edad, portadora de la cedula de identidad y electoral No. **{{CLIENTE_CEDULA}}**, domiciliada y residente en la Calle **{{CLIENTE_DIRECCION}} No. {{CLIENTE_NUMERO}}, Sector {{CLIENTE_SECTOR}}**, de **{{CLIENTE_CIUDAD}}**, quien en lo que sigue del presente contrato se denominara **EL CLIENTE**.

**1.0 - Objeto del Contrato.** Este Contrato contiene los términos y condiciones del Servicio de Belleza, consistente en Lavado y Secado de Pelo que será prestado por LA COMPAÑÍA AL CLIENTE.

**1.1- LA COMPANIA:** {{EMPRESA_NOMBRE}}, la cual forma parte de la cadena: ABATTE PELUQUERIA, proveerá los servicios de lavado y secado de pelo a través de las localidades abiertas al público como son:
a) Inicialmente en la Sucursal Av. San Vicente de Paul.

**1.2- Requisito para Contratar este Servicio:** Es condición indispensable para poder adquirir y mantener el Servicio de Belleza bajo Suscripción, que EL CLIENTE haya adquirido y suscrito contrato de lavado y secado de pelo, con LA COMPAÑIA.

**1.3- EL CLIENTE acepta y elije el plan:** **{{PLAN_NOMBRE}}** como su Servicio de Belleza, el plan incluye los beneficios siguientes: **{{PLAN_SERVICIOS}}**.

**1.4- El presente Contrato** formará parte integral del plan de servicios que previamente haya elegido EL CLIENTE con LA COMPAÑÍA, según se describe a continuación:

**2- Descripción del Servicio.** LA COMPAÑIA conviene en proveer a EL CLIENTE el "Servicio de Belleza", que consiste en brindar el servicio de lavado y secado de pelo para todo el mes, mediante el cual el cliente podrá utilizar el servicio en una de nuestras localidades identificadas, abiertas al público y acorde con plan de su preferencia.

**3- Características del Servicio.** El "Servicio de Belleza" consiste proveer personas capacitadas y productos de clase mundial para el lavado y secado de pelo del CLIENTE, pero no provee uso de producto de líneas especializadas. El uso de marcas especializadas por elección es responsabilidad exclusiva del CLIENTE.

**3.1- Disponibilidad del servicio.** La disponibilidad del servicio de Lavado y Secado de pelo es de hasta un 99.9% al año, conforme a su disponibilidad operativa, pone a disposición de EL CLIENTE cuatro (04) servicios de lavados sencillos y secado cada Treinta (30) días calendario, con excepción de aquellas indisponibilidades producidas por fenómenos atmosféricos, accidentes, cualquier caso fortuito, o fuerza mayor.

**3.2- El servicio.** Es intransferible, ni acumulable; es decir, no se permite el uso del servicio por parte de terceros, de igual forma, no se permite combinar múltiples servicios para compensarlo con cantidades de servicio no utilizado correspondiente a la presente suscripción.

**3.3- Los costos derivados** del uso de materiales o servicios no incluidos en el plan elegido o contratado quedarán a cargo y a costo de EL CLIENTE.

**3.4- La falta de pago** produce por defecto la suspensión del servicio y su reactivación se producirá solo si EL CLIENTE ha realizado el pago total de todas las cuotas vencidas incluyendo la que corresponde al mes por adelantado. Ante el incumplimiento de pago LA COMPAÑÍA se reserva el derecho de cancelar el presente contrato bajo la más amplia reserva de acciones para garantizar el cumplimiento del presente contrato.

**3.5- El servicio deberá ser utilizado** por EL CLIENTE bajo condiciones normales de uso conforme a la naturaleza del plan contratado; en consecuencia, LA COMPAÑÍA podrá establecer límites razonables en la frecuencia de utilización del servicio, incluyendo un máximo de un (1) servicio por día, así como suspender o restringir su acceso cuando el uso exceda dichas condiciones.

**Obligaciones del CLIENTE: EL CLIENTE deberá:**
- EL CLIENTE estará obligado al pago del servicio elegido en el presente contrato, condición indispensable para tener la disponibilidad del servicio en nuestros centros de atención al cliente.
- EL CLIENTE tendrá derecho a hacer, en el plazo de un (1) mes, una cantidad máxima de **{{PLAN_CUPO}}** solicitudes de servicios en nuestros centros de atención según el plan contratado inicialmente. A partir de ahí, EL CLIENTE deberá pagar el valor adicional que LA COMPAÑÍA haya informado al momento de la solicitud.
- EL CLIENTE podrá solicitar en cualquier momento el cambio a un plan superior. Dicho cambio será efectivo de inmediato, debiendo EL CLIENTE pagar la diferencia correspondiente al nuevo plan seleccionado al momento de la solicitud.

**4- Precio del Servicio:** EL CLIENTE acuerda pagar a LA COMPAÑÍA por el servicio prestado, una renta mensual de **RD$ {{PLAN_PRECIO}} PESOS DOMINICANOS CON 00/100**, facturados por adelantado. Asimismo, EL CLIENTE acepta y autoriza un cargo de activación por renovación de contrato de **RD$ {{CARGO_RENOVACION}} anual**, el cual se cobrará automáticamente en cada aniversario de la firma.

**4.1- Forma de Pago:** EL CLIENTE es responsable de la inscripción de una tarjeta de crédito al momento de la contratación del servicio para realizar el débito del servicio de forma recurrente y automática.

**4.2- EL CLIENTE autoriza** de manera expresa a LA COMPAÑÍA a realizar el cobro automático y recurrente de los montos correspondientes al plan contratado, incluyendo cargos de activación y renovaciones, mediante la tarjeta registrada al momento de la suscripción. EL CLIENTE será responsable de mantener un método de pago válido y con fondos disponibles; en caso de que un cobro no pueda ser procesado, LA COMPAÑÍA podrá realizar reintentos automáticos y/o suspender el servicio hasta tanto se regularice el pago, sin perjuicio de las acciones necesarias para el cobro de los montos adeudados.

**4.3- Queda expresamente convenido** entre las Partes que los precios y rentas estipulados en el presente Contrato podrán ser ajustados conforme el impacto que presente el índice de precio al consumidor.

**4.4- Cancelación del servicio:** Las partes acuerdan que EL CLIENTE reconoce que el plan contratado incluye tarifas preferenciales y beneficios promocionales otorgados por LA COMPAÑÍA; en caso de cancelación anticipada, LA COMPAÑÍA podrá recalcular los servicios efectivamente utilizados a su precio regular vigente al momento de la prestación, conforme a las tarifas publicadas por LA COMPAÑÍA, debiendo EL CLIENTE pagar la diferencia entre dicho valor y el monto pagado hasta la fecha, sin que esto constituya una penalidad sino la pérdida de los beneficios otorgados bajo el plan. Las partes acuerdan que, para la aplicación de las penalidades precedentemente enunciadas, el punto de partida del plazo de duración del contrato correrá a partir de la fecha de firma del contrato.

**4.5- Los pagos realizados** por EL CLIENTE bajo el presente plan son anticipados y corresponden a la activación, reserva y disponibilidad del servicio, por lo que, una vez procesados, no son reembolsables bajo ninguna circunstancia; en consecuencia, la cancelación del servicio por parte de EL CLIENTE no dará lugar a devoluciones totales ni parciales de los montos ya pagados.

**4.6- EL CLIENTE autoriza** la captura de datos biométricos para garantizar su identidad y prevenir fraude electrónico; al mismo tiempo, aprueba y reconoce como bueno y válido la firma digital o electrónica en el uso del presente contrato.

**4.7- EL CLIENTE es responsable** de notificar si es alérgico a algún producto de los utilizables para el lavado y secado del pelo; también, es responsable de la degradación que puedan sufrir los tintes o aplicaciones que tenga durante el proceso de lavado o secado, y además, por medio del presente contrato descarga de responsabilidad a LA COMPAÑÍA por cualquiera de los casos anteriormente señalados.

**Obligaciones de LA COMPAÑÍA:**
a) LA COMPAÑÍA entregará al CLIENTE el nombre de usuario y la contraseña de acceso a la web: www.Planbeautyrd.com para que el CLIENTE pueda realizar consultas sobre el estado del servicio de acuerdo al plan contratado.
b) LA COMPAÑÍA entregará al CLIENTE acceso a visualizar en un portal un resumen de todos los servicios incluidos dentro de su plan y la cantidad de servicios consumidos a la fecha.
c) Mantener en estricta confidencialidad la información de usuario y contraseña de acceso al portal web, por lo cual es responsabilidad exclusiva del CLIENTE el uso y manejo de tal información.

**5- Duración y Terminación.** El presente contrato tendrá una duración inicial de doce ({{DURACION_MESES}}) meses contados a partir de su firma. Vencido dicho período, el contrato se renovará automáticamente por períodos iguales, salvo que EL CLIENTE notifique por escrito su intención de no renovar con al menos treinta ({{DIAS_PREAVISO}}) días de antelación a la fecha de vencimiento. En caso de no recibir dicha notificación, se entenderá que EL CLIENTE acepta la renovación, autorizando la continuidad del servicio y el cobro automático correspondiente bajo las condiciones vigentes al momento de la renovación.

**5.1- LA COMPAÑÍA aplicará** un cargo de activación de RD$ {{CARGO_RENOVACION}} al momento de cada renovación anual del contrato, el cual será debitado automáticamente por el medio de pago autorizado por EL CLIENTE, conforme a las condiciones comerciales vigentes.

**5.2- LA COMPAÑÍA se reserva el derecho** de renovar o no el presente contrato con previa notificación de {{DIAS_PREAVISO}} días a EL CLIENTE.

**5.3- Al momento de EL CLIENTE solicitar** la cancelación del servicio LA COMPAÑÍA le estará notificando al cliente por escrito o por cualquier medio escrito o electrónico, en un plazo de Cinco (5) días, el valor que le será debitado de su tarjeta como último pago.

**6- Las partes acuerdan** que para todo lo no previsto en el presente contrato se remiten al derecho del consumidor y posteriormente al Derecho común. Hecho y firmado en dos originales uno para cada una de las partes. En Santo Domingo Este, Municipio de la Provincia de Santo Domingo a los {{DIA_FIRMA}} días del mes de {{MES_FIRMA}} del año {{ANIO_FIRMA}}.`;

const MAX_RETRY_COUNT = 90;

/**
 * Executes the automatic recurring subscription billing worker
 * 
 * @param {import('mysql2/promise').Pool} pool
 * @param {Object} helpers
 * @param {string} reqIp
 */
async function processSubscriptionsInternal(pool, helpers = {}, reqIp = "127.0.0.1") {
  const { CARDNET_CONFIG, getCardNetAuthHeaders, sendPaymentReceiptEmail, sendPaymentFailedEmail } = helpers;
  const results = { processed: 0, successful: 0, failed: 0, retries: 0, logs: [] };
  
  try {
    const [dueContracts] = await pool.query(`
      SELECT c.*, cl.nombre, cl.email, cl.cardnet_customer_id, 
             COALESCE(c.contract_price, p.price) as effective_price,
             p.title as plan_title, p.services as plan_services
      FROM contracts c
      JOIN clients cl ON c.client_id = cl.id
      JOIN plans p ON c.plan_id = p.id
      WHERE (
        (c.status IN ('Active', 'Activo') AND c.next_billing_date <= NOW())
        OR 
        (c.status IN ('Pending_Retry', 'Pending_Payment', 'Pendiente_Pago', 'Past_Due') 
         AND (c.next_retry_date <= NOW() OR (c.next_retry_date IS NULL AND c.next_billing_date <= NOW())) 
         AND (c.retry_count < ${MAX_RETRY_COUNT} OR c.retry_count IS NULL))
      )
      AND NOT EXISTS (
        SELECT 1 FROM payments py 
        WHERE py.client_id = c.client_id 
          AND DATE(py.created_at) = CURRENT_DATE()
      )
    `);

    console.log(`[CRON] Processing ${dueContracts.length} eligible contracts for billing/retry at ${new Date().toISOString()}...`);

    for (const contract of dueContracts) {
      results.processed++;
      const isRetry = contract.status === 'Pending_Retry' || contract.status === 'Pending_Payment' || contract.status === 'Pendiente_Pago' || contract.status === 'Past_Due';
      
      try {
        let chargeAmount = parseFloat(contract.effective_price);
        let annualFeeApplied = false;
        
        const baseDate = contract.last_annual_fee_date || contract.signed_at || contract.created_at;
        const lastAnnual = baseDate ? new Date(baseDate) : new Date();
        const daysSinceAnnual = (new Date() - lastAnnual) / (1000 * 60 * 60 * 24);
        
        if (daysSinceAnnual >= 365) {
          console.log(`[CRON] Aplicando cargo de RENOVACIÓN ANUAL (RD$ 800) para ${contract.nombre}`);
          chargeAmount += 800;
          annualFeeApplied = true;
        }

        const amountCents = Math.round(chargeAmount * 100);
        const purchasePayload = {
          TrxToken: contract.card_token || contract.payment_profile_id || contract.cardnet_profile_id,
          Order: `AUTO-${Date.now().toString().slice(-6)}`,
          Amount: amountCents,
          Currency: "DOP",
          Capture: true,
          Description: annualFeeApplied 
            ? `Mensualidad ${contract.plan_title} + Renovación Anual` 
            : `Mensualidad ${contract.plan_title} (Auto)`,
          CustomerIP: reqIp || "127.0.0.1",
          MerchantNumber: CARDNET_CONFIG.MERCHANT_NUMBER,
          MerchantTerminal: CARDNET_CONFIG.TERMINAL_ID,
          DataDo: { Tax: "0", Invoice: `INV-${Date.now().toString().slice(-6)}` }
        };

        const purchaseRes = await axios.post(
          `${CARDNET_CONFIG.BASE_URL}/api/Purchase`,
          purchasePayload,
          { headers: getCardNetAuthHeaders(), timeout: 15000 }
        );

        const purchaseResult = purchaseRes.data.Response || purchaseRes.data;
        const isApproved = purchaseResult.Transaction?.Status === "Approved" || purchaseResult.ResponseCode === "00";

        if (isApproved) {
          let servicesToReset = [];
          try {
            servicesToReset = typeof contract.plan_services === 'string' 
              ? JSON.parse(contract.plan_services) 
              : (contract.plan_services || []);
          } catch (e) {
            console.error("[CRON] Error parsing plan services:", e);
          }

          const recurrenceNum = CARDNET_CONFIG.ENV === 'PRODUCTION' ? 1 : 1;
          const recurrenceUnit = 'MONTH';

          const updateQuery = annualFeeApplied
            ? `UPDATE contracts SET status = "Active", retry_count = 0, next_retry_date = NULL, last_billed_date = NOW(), next_billing_date = DATE_ADD(NOW(), INTERVAL ${recurrenceNum} ${recurrenceUnit}), last_annual_fee_date = NOW(), contract_services = ? WHERE id = ?`
            : `UPDATE contracts SET status = "Active", retry_count = 0, next_retry_date = NULL, last_billed_date = NOW(), next_billing_date = DATE_ADD(NOW(), INTERVAL ${recurrenceNum} ${recurrenceUnit}), contract_services = ? WHERE id = ?`;

          await pool.query(updateQuery, [JSON.stringify(servicesToReset), contract.id]);
          await pool.query('UPDATE clients SET status = "Active" WHERE id = ?', [contract.client_id]);

          const gatewayRef = purchaseResult?.Transaction?.OrderNumber || purchaseResult?.Transaction?.RemoteId || `AUTO-${contract.id.slice(-4)}`;
          await pool.query(
            'INSERT INTO payments (id, client_id, plan_id, amount, method, status, gateway_ref, description, cardnet_raw_response, salon_id, applied_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [`PAY-AUTO-${Date.now()}-${contract.id.slice(-4)}`, contract.client_id, contract.plan_id, chargeAmount, 'CardNet_Auto', 'Aprobado', gatewayRef, annualFeeApplied ? `Mensualidad + Renovación Anual: ${contract.plan_title}` : `Cobro Mensual Recurrente: ${contract.plan_title}`, JSON.stringify(purchaseRes.data), contract.salon_id || 1, 'Auto-Billing Worker']
          );

          if (contract.email && sendPaymentReceiptEmail) {
            sendPaymentReceiptEmail(contract.client_id, contract.nombre, contract.email, chargeAmount, annualFeeApplied ? `Mensualidad + Renovación Anual: ${contract.plan_title}` : `Cobro Mensual Recurrente: ${contract.plan_title}`, gatewayRef);
          }

          results.successful++;
          results.logs.push(`[OK] ${contract.nombre} - ${contract.plan_title}`);
        } else {
          const declineError = new Error(purchaseResult.ResponseMessage || "Declinada");
          declineError.isDecline = true;
          throw declineError;
        }
      } catch (err) {
        const errorString = (
          err.message + ' ' + 
          (typeof err.response?.data === 'string' ? err.response.data : JSON.stringify(err.response?.data || ''))
        ).toLowerCase();

        const isSystemError = !err.isDecline && (
                               !err.response || 
                               [429, 500, 502, 503, 504].includes(err.response?.status) || 
                               err.code === 'ECONNABORTED' || 
                               err.code === 'ETIMEDOUT' || 
                               errorString.includes('timeout') ||
                               errorString.includes('network') ||
                               errorString.includes('unconditional drop overload') ||
                               errorString.includes('service unavailable')
        );

        const newRetryCount = (contract.retry_count || 0) + 1;
        const isMaxRetriesReached = newRetryCount >= MAX_RETRY_COUNT;
        const newStatus = isMaxRetriesReached ? 'Suspended' : 'Pending_Retry';
        
        const nextRetrySql = isMaxRetriesReached
          ? 'NULL'
          : `CONCAT(DATE(DATE_ADD(NOW(), INTERVAL 1 DAY)), ' 17:00:00')`;

        if (isSystemError) {
          console.warn(`[CRON] CardNet System Error charging ${contract.nombre} (Plan: ${contract.plan_title}) - Intento ${newRetryCount}/${MAX_RETRY_COUNT}: ${err.message}.`);

          await pool.query(
            `UPDATE contracts SET status = ?, retry_count = ?, next_retry_date = ${nextRetrySql} WHERE id = ?`,
            [newStatus, newRetryCount, contract.id]
          );

          if (isMaxRetriesReached) {
            await pool.query('UPDATE clients SET status = "Inactive" WHERE id = ?', [contract.client_id]);
            console.log(`[CRON] Contrato ${contract.id} de ${contract.nombre} SUSPENDIDO por ${MAX_RETRY_COUNT} errores de conexión consecutivos.`);
          }

          const paymentStatus = isMaxRetriesReached ? 'Suspendido' : `Error_Conexion - Intento ${newRetryCount}`;
          const paymentDescription = isMaxRetriesReached 
            ? `Contrato Suspendido tras ${MAX_RETRY_COUNT} Errores de Conexión CardNet` 
            : `Error de Conexión CardNet (Reintento diario ${newRetryCount}/${MAX_RETRY_COUNT} programado para mañana 5:00 PM)`;

          await pool.query(
            'INSERT INTO payments (id, client_id, plan_id, amount, method, status, description, cardnet_raw_response) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [`PAY-SYS-${Date.now()}-${contract.id.slice(-4)}`, contract.client_id, contract.plan_id, contract.effective_price, 'CardNet_Auto', paymentStatus, paymentDescription, JSON.stringify({ error: err.message, status: err.response?.status, attempt: newRetryCount })]
          );
        } else {
          console.warn(`[CRON] CardNet Real Decline charging ${contract.nombre} (Plan: ${contract.plan_title}) - Intento ${newRetryCount}/${MAX_RETRY_COUNT}: ${err.message}.`);

          await pool.query(
            `UPDATE contracts SET status = ?, retry_count = ?, next_retry_date = ${nextRetrySql} WHERE id = ?`,
            [newStatus, newRetryCount, contract.id]
          );

          await pool.query('UPDATE clients SET status = "Inactive" WHERE id = ?', [contract.client_id]);

          await pool.query(
            'INSERT INTO payments (id, client_id, plan_id, amount, method, status, description, cardnet_raw_response) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [`PAY-FAIL-${Date.now()}-${contract.id.slice(-4)}`, contract.client_id, contract.plan_id, contract.effective_price, 'CardNet_Auto', `Fallido - Intento ${newRetryCount}`, isMaxRetriesReached ? `Contrato Suspendido tras ${MAX_RETRY_COUNT} intentos fallidos (Declinado)` : `Intento Recurrente Fallido: ${contract.plan_title} (Declinado)`, JSON.stringify(err.response?.data || { error: err.message })]
          );

          if (contract.email && newRetryCount === 1 && sendPaymentFailedEmail) {
            sendPaymentFailedEmail(contract.client_id, contract.nombre, contract.email, contract.effective_price, err.message);
          }
        }

        results.failed++;
        if (isRetry) results.retries++;
        results.logs.push(`[FAIL] ${contract.nombre} - ${err.message} (Intento ${newRetryCount}/${MAX_RETRY_COUNT})`);
      }
    }

    return results;
  } catch (err) {
    console.error('[CRON ERROR]', err);
    throw err;
  }
}

/**
 * Creates and configures the Contracts and Subscription Management Router
 * 
 * @param {import('mysql2/promise').Pool} pool
 * @param {Object} helpers
 */
function createContractsRouter(pool, helpers = {}) {
  const router = express.Router();
  const { CARDNET_CONFIG, getCardNetAuthHeaders, sendPaymentReceiptEmail } = helpers;

  // === CONTRACT SETTINGS ===
  router.get('/settings/contract', async (req, res) => {
    try {
      const [rows] = await pool.query('SELECT * FROM contract_settings WHERE id = 1');
      if (rows.length > 0) {
        return res.json(rows[0]);
      }
      const defaultData = {
        id: 1,
        title: 'CONTRATO DE SUSCRIPCIÓN DE SERVICIOS DE BELLEZA',
        company_name: 'ETEREAS S. R. L.',
        company_rnc: '1-31-91703-8',
        company_address: 'Av. San Vicente De Paul esquina Calle Puerto Rico, Alma Rosa I, Plaza El Poder, Local 1F, Santo Domingo Este, Municipio De La Provincia Santo Domingo',
        renewal_fee: '800.00',
        min_duration_months: '12',
        notice_cancellation_days: '30',
        content: DEFAULT_CONTRACT_BODY
      };
      res.json(defaultData);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/settings/contract', async (req, res) => {
    const {
      title,
      company_name,
      company_rnc,
      company_address,
      renewal_fee,
      min_duration_months,
      notice_cancellation_days,
      content
    } = req.body;

    try {
      await pool.query(`
        INSERT INTO contract_settings (id, title, company_name, company_rnc, company_address, renewal_fee, min_duration_months, notice_cancellation_days, content)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          title = VALUES(title),
          company_name = VALUES(company_name),
          company_rnc = VALUES(company_rnc),
          company_address = VALUES(company_address),
          renewal_fee = VALUES(renewal_fee),
          min_duration_months = VALUES(min_duration_months),
          notice_cancellation_days = VALUES(notice_cancellation_days),
          content = VALUES(content)
      `, [
        title || 'CONTRATO DE SUSCRIPCIÓN DE SERVICIOS DE BELLEZA',
        company_name || 'ETEREAS S. R. L.',
        company_rnc || '1-31-91703-8',
        company_address || 'Av. San Vicente De Paul esquina Calle Puerto Rico, Alma Rosa I, Plaza El Poder, Local 1F, Santo Domingo Este, Municipio De La Provincia Santo Domingo',
        renewal_fee || '800.00',
        min_duration_months || '12',
        notice_cancellation_days || '30',
        content || DEFAULT_CONTRACT_BODY
      ]);

      res.json({ success: true, message: 'Configuración del contrato guardada exitosamente' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/settings/contract/reset', async (req, res) => {
    try {
      await pool.query(`
        INSERT INTO contract_settings (id, title, company_name, company_rnc, company_address, renewal_fee, min_duration_months, notice_cancellation_days, content)
        VALUES (1, 'CONTRATO DE SUSCRIPCIÓN DE SERVICIOS DE BELLEZA', 'ETEREAS S. R. L.', '1-31-91703-8', 'Av. San Vicente De Paul esquina Calle Puerto Rico, Alma Rosa I, Plaza El Poder, Local 1F, Santo Domingo Este, Municipio De La Provincia Santo Domingo', '800.00', '12', '30', ?)
        ON DUPLICATE KEY UPDATE
          title = VALUES(title),
          company_name = VALUES(company_name),
          company_rnc = VALUES(company_rnc),
          company_address = VALUES(company_address),
          renewal_fee = VALUES(renewal_fee),
          min_duration_months = VALUES(min_duration_months),
          notice_cancellation_days = VALUES(notice_cancellation_days),
          content = VALUES(content)
      `, [DEFAULT_CONTRACT_BODY]);

      res.json({ success: true, message: 'Plantilla de contrato restablecida a los valores predeterminados' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === CONTRACT LIST & QUERIES ===
  router.get('/contracts', async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT 
          c.id, c.client_id, c.plan_id, c.signed_at, c.signature_hash, c.status, 
          c.last_billed_date, c.next_billing_date, c.next_retry_date, 
          c.retry_count, c.card_token, c.cardnet_profile_id, 
          c.contract_services, c.contract_price, c.contract_promo_services, 
          c.contract_promo_duration, c.payment_profile_id, c.auto_billing_enabled, 
          c.last_annual_fee_date, c.ip_address, c.device_agent, 
          c.geolocation, c.salon_id,
          cl.nombre as clientName, 
          cl.cedula as clientCedula,
          cl.calle as address,
          cl.numero as house_number,
          cl.sector,
          p.title as planTitle,
          p.services as planServices,
          p.activation_fee
        FROM contracts c
        JOIN clients cl ON c.client_id = cl.id
        JOIN plans p ON c.plan_id = p.id
        ORDER BY c.signed_at DESC
      `);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/contracts/client/:clientId', async (req, res) => {
    try {
      const { clientId } = req.params;
      const cleanId = String(clientId || '').trim();
      if (!cleanId || cleanId.toUpperCase() === 'INVITADO' || cleanId.toLowerCase() === 'undefined' || cleanId.toLowerCase() === 'null') {
        return res.json([]);
      }
      const [rows] = await pool.query(
        `SELECT 
          c.*, 
          cl.nombre as clientName, 
          cl.cedula as clientCedula,
          cl.status as clientStatus,
          COALESCE(p.title, 'Plan Beauty') as planTitle,
          p.services as planServices,
          p.price as planPrice
         FROM contracts c
         LEFT JOIN clients cl ON (c.client_id = cl.id OR c.client_id = cl.cedula)
         LEFT JOIN plans p ON (c.plan_id = p.id OR CAST(c.plan_id AS CHAR) = CAST(p.id AS CHAR))
         WHERE c.client_id = ? 
            OR cl.id = ?
            OR cl.cedula = ?
            OR cl.nombre = ?
         ORDER BY c.id DESC`,
        [cleanId, cleanId, cleanId, cleanId]
      );
      res.json(rows);
    } catch (err) {
      console.error('[API ERROR] /api/contracts/client/:clientId:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/contracts/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const [rows] = await pool.query(
        `SELECT 
          c.*, 
          cl.nombre as clientName, 
          cl.cedula as clientCedula, 
          cl.calle as address, 
          cl.numero as house_number, 
          cl.sector as sector, 
          cl.ciudad as ciudad, 
          p.title as planTitle 
         FROM contracts c 
         LEFT JOIN clients cl ON c.client_id = cl.id 
         LEFT JOIN plans p ON c.plan_id = p.id 
         WHERE c.id = ?`,
        [id]
      );
      if (rows.length > 0) {
        res.json(rows[0]);
      } else {
        res.status(404).json({ error: 'Contrato no encontrado' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- CONTRACT ACTIONS (CANCEL & BILL) WITH CODES ---
  router.post('/contracts/:id/request-code', async (req, res) => {
    const { id } = req.params;
    const { actionType } = req.body;
    
    try {
      const [contracts] = await pool.query(`
        SELECT c.*, cl.nombre, cl.email 
        FROM contracts c 
        JOIN clients cl ON c.client_id = cl.id 
        WHERE c.id = ?`, [id]);
      
      if (contracts.length === 0) return res.status(404).json({ error: 'Contrato no encontrado.' });
      const contract = contracts[0];
      
      if (!contract.email) return res.status(400).json({ error: 'El cliente no tiene un correo electrónico asociado.' });

      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await pool.query(
        'INSERT INTO billing_codes (contract_id, code, action_type, expires_at) VALUES (?, ?, ?, ?)',
        [id, code, actionType, expiresAt]
      );

      const [settings] = await pool.query('SELECT * FROM email_settings LIMIT 1');
      const s = settings[0] || {};
      const transporter = nodemailer.createTransport({
        host: s.smtp_host, port: s.smtp_port, secure: s.smtp_port == 465,
        auth: { user: s.smtp_user, pass: s.smtp_pass }
      });

      const actionName = actionType === 'cancellation' ? 'Cancelación de Plan' : 'Confirmación de Facturación';
      
      await transporter.sendMail({
        from: `"${s.smtp_from || 'Abatte Peluquería'}" <${s.smtp_user}>`,
        to: contract.email,
        subject: `Código de Verificación - ${actionName}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 40px; border: 1px solid #eee; border-radius: 20px; background: #fff;">
            <h2 style="color: #09090b; text-align: center;">Verificación de Seguridad</h2>
            <p>Hola <strong>${escapeHtml(contract.nombre)}</strong>,</p>
            <p>Se ha solicitado una acción de <strong>${escapeHtml(actionName)}</strong> para tu contrato. Usa el siguiente código para autorizarla:</p>
            <div style="background: #f8fafc; padding: 30px; border-radius: 16px; margin: 30px 0; border: 1px solid #e2e8f0; text-align: center;">
              <span style="font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #09090b;">${code}</span>
            </div>
            <p style="color: #64748b; font-size: 0.85rem; text-align: center;">Este código expirará en 15 minutos.</p>
          </div>
        `
      });

      res.json({ success: true, message: 'Código enviado al cliente.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/contracts/:id/confirm-action', async (req, res) => {
    const { id } = req.params;
    const { code, actionType } = req.body;

    try {
      const [rows] = await pool.query(
        'SELECT id, expires_at FROM billing_codes WHERE contract_id = ? AND code = ? AND action_type = ? AND is_used = 0',
        [id, code, actionType]
      );

      if (rows.length === 0) return res.status(400).json({ error: 'Código inválido o expirado.' });

      const codeRecord = rows[0];
      const expiresAtTime = codeRecord.expires_at instanceof Date 
        ? codeRecord.expires_at.getTime() 
        : new Date(codeRecord.expires_at).getTime();

      if (Date.now() > expiresAtTime) {
        return res.status(400).json({ error: 'Código inválido o expirado.' });
      }

      await pool.query('UPDATE billing_codes SET is_used = 1 WHERE id = ?', [codeRecord.id]);

      if (actionType === 'cancellation') {
        const [contractRows] = await pool.query(`
          SELECT c.client_id, cl.nombre, cl.email, cl.cardnet_customer_id, c.payment_profile_id 
          FROM contracts c 
          JOIN clients cl ON c.client_id = cl.id 
          WHERE c.id = ?
        `, [id]);
        
        if (contractRows.length > 0) {
          const client = contractRows[0];

          if (client.cardnet_customer_id && client.payment_profile_id && !String(client.payment_profile_id).startsWith('mock_')) {
            try {
              console.log(`[CARDNET DELETION] Eliminando Perfil de Pago: ${client.payment_profile_id} para Cliente CardNet: ${client.cardnet_customer_id}`);
              await axios.post(
                `${CARDNET_CONFIG.BASE_URL}/api/Customer/${client.cardnet_customer_id}/PaymentProfileDelete`,
                { 
                  PaymentProfileID: client.payment_profile_id,
                  PaymentProfileId: client.payment_profile_id 
                },
                { headers: getCardNetAuthHeaders(), timeout: CARDNET_CONFIG.TIMEOUT }
              );
              console.log('[CARDNET DELETION] Tarjeta borrada de CardNet de forma segura.');
            } catch (cardnetErr) {
              console.error('[CARDNET DELETION] No se pudo borrar la tarjeta en CardNet, continuando limpieza local:', cardnetErr.response?.data || cardnetErr.message);
            }
          }

          await pool.query("UPDATE clients SET status = 'Cancelled', cardnet_customer_id = NULL WHERE id = ?", [client.client_id]);
          await pool.query(`
            UPDATE contracts 
            SET status = 'Cancelled', 
                auto_billing_enabled = 0, 
                payment_profile_id = NULL, 
                card_token = NULL, 
                document_photo = NULL, 
                selfie_photo = NULL, 
                signature_hash = NULL 
            WHERE id = ?
          `, [id]);
          
          console.log(`[CANCELLATION SUCCESS] Datos borrados de forma segura para cliente: ${client.client_id} (Contrato: ${id})`);
          
          if (client.email) {
            try {
              const [settings] = await pool.query('SELECT * FROM email_settings LIMIT 1');
              if (settings.length > 0) {
                const s = settings[0];
                const transporter = nodemailer.createTransport({
                  host: s.smtp_host, port: s.smtp_port, secure: s.smtp_port == 465,
                  auth: { user: s.smtp_user, pass: s.smtp_pass }
                });

                const subject = 'Esperamos verte pronto nuevamente';
                const bodyHtml = `
                  <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #fdf8f5; padding: 40px 15px; text-align: center;">
                    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 15px 35px rgba(74, 55, 40, 0.05); border: 1px solid #f3e8df; padding: 40px 30px; box-sizing: border-box; text-align: left;">
                      <div style="text-align: center; margin-bottom: 30px; border-bottom: 1px solid #f3e8df; padding-bottom: 20px;">
                        <h1 style="color: #000000; font-size: 24px; font-weight: 800; letter-spacing: 2px; margin: 0;">
                          PLAN<span style="color: #d4af37;">BEAUTY</span>RD
                        </h1>
                      </div>
                      <p style="font-size: 16px; color: #000000; font-weight: 700; margin-bottom: 20px;">
                        Hola ${client.nombre},
                      </p>
                      <p style="font-size: 15px; color: #4a3728; line-height: 1.7; margin-bottom: 18px;">
                        Hemos recibido la cancelación de tu membresía en <strong>PLAN BEAUTY</strong> y queremos agradecerte por habernos permitido acompañarte en tu rutina de belleza. ✨
                      </p>
                      <p style="font-size: 15px; color: #4a3728; line-height: 1.7; margin-bottom: 18px;">
                        En <strong>ABATTE PELUQUERIA</strong> siempre tendrás las puertas abiertas. Esperamos volver a verte muy pronto y seguir brindándote la experiencia que mereces.
                      </p>
                      <p style="font-size: 15px; color: #4a3728; line-height: 1.7; margin-bottom: 30px;">
                        Si deseas reactivar tu membresía en el futuro, solo debes pasar por el salón y con gusto te ayudaremos.
                      </p>
                      <p style="font-size: 15px; color: #000000; font-weight: 700; margin-bottom: 5px;">
                        Con cariño,
                      </p>
                      <p style="font-size: 15px; color: #d4af37; font-weight: 800; margin: 0;">
                        Equipo ABATTE PELUQUERIA
                      </p>
                    </div>
                  </div>
                `;

                await transporter.sendMail({
                  from: `"${s.smtp_from || 'PLAN BEAUTY'}" <${s.smtp_user}>`,
                  to: client.email,
                  subject: subject,
                  html: bodyHtml
                });
                console.log(`[CANCELLATION EMAIL] Sent cancellation notice to ${client.email}`);
              }
            } catch (mailErr) {
              console.error('[CANCELLATION EMAIL ERROR] Failed to send cancellation email:', mailErr.message);
            }
          }
        }
        return res.json({ success: true, message: 'Contrato cancelado exitosamente.' });
      } else if (actionType === 'manual_billing') {
        const [contractData] = await pool.query(`
          SELECT c.*, p.price, p.title as planTitle, cl.cardnet_customer_id 
          FROM contracts c 
          JOIN plans p ON c.plan_id = p.id 
          JOIN clients cl ON c.client_id = cl.id 
          WHERE c.id = ?`, [id]);
        
        const c = contractData[0];
        if (!c.cardnet_customer_id || !c.cardnet_profile_id) {
          return res.status(400).json({ error: 'El cliente no tiene un método de pago vinculado.' });
        }

        return res.json({ success: true, verified: true, contract: c });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === CONTRACT CREATION / ONBOARDING ===
  router.post('/contracts', async (req, res) => {
    try {
      const id = Date.now().toString();
      const { clientId, planId, signature_hash, pwToken } = req.body;

      const [clients] = await pool.query('SELECT * FROM clients WHERE id = ?', [clientId]);
      if (clients.length === 0) throw new Error('Client not found');
      const client = clients[0];

      const contractSalonId = parseInt(req.body.salon_id || req.body.salonId || client.salon_id || 1, 10);

      const [plans] = await pool.query('SELECT * FROM plans WHERE id = ?', [planId]);
      if (plans.length === 0) throw new Error('Plan not found');
      const plan = plans[0];

      const [existing] = await pool.query(
        "SELECT id FROM contracts WHERE client_id = ? AND plan_id = ? AND status != 'Cancelled'",
        [clientId, planId]
      );
      if (existing.length > 0) throw new Error('El cliente ya posee este plan contratado actualmente.');

      const cardnetCustomerId = client.cardnet_customer_id;
      if (!cardnetCustomerId) throw new Error("CardNet Customer ID not found.");

      let paymentProfileId = null;
      let persistentToken = pwToken; 

      const isProductionEnv = CARDNET_CONFIG.ENV === 'PRODUCTION';
      const isMockToken = !isProductionEnv && (!pwToken || pwToken === 'TOKEN_PENDING' || String(pwToken || '').startsWith('mock_'));

      if (isProductionEnv && (!pwToken || pwToken === 'TOKEN_PENDING' || String(pwToken || '').startsWith('mock_'))) {
        throw new Error("Se requiere una tarjeta de crédito/débito real y válida para activar una suscripción en producción.");
      }

      if (isMockToken) {
        paymentProfileId = `mock_profile_${Date.now()}`;
        persistentToken = pwToken || `mock_token_${Date.now()}`;
        console.log(`[CARDNET BYPASS] [ENTORNO TEST] Token simulado/contingencia detectado: ${persistentToken}`);
      }

      if (pwToken && !isMockToken) {
        try {
          console.log(`[CARDNET] Activando token: ${pwToken} para cliente: ${cardnetCustomerId}`);
          const activateRes = await axios.post(
            `${CARDNET_CONFIG.BASE_URL}/api/Customer/${cardnetCustomerId}/activate`,
            { Token: pwToken, ActivationCode: "" },
            { headers: getCardNetAuthHeaders(), timeout: CARDNET_CONFIG.TIMEOUT }
          );
          
          const custData = activateRes.data.Response || activateRes.data;
          const profiles = custData.PaymentProfiles || [];
          
          const match = profiles.find(p => p.Token === pwToken) || profiles[profiles.length - 1];

          if (match) {
            paymentProfileId = match.PaymentProfileId?.toString();
            persistentToken = match.Token;
            console.log('[CARDNET] OK - Perfil identificado:', paymentProfileId);
          }
        } catch (actErr) {
          console.warn('[CARDNET] Aviso en activación:', actErr.message);
        }

        if (!paymentProfileId) {
          try {
            const customerRes = await axios.get(
              `${CARDNET_CONFIG.BASE_URL}/api/Customer/${cardnetCustomerId}`,
              { headers: getCardNetAuthHeaders(), timeout: CARDNET_CONFIG.TIMEOUT }
            );
            const fullCust = customerRes.data.Response || customerRes.data;
            const profiles = fullCust.PaymentProfiles || [];
            const match = profiles.find(p => p.Token === pwToken) || profiles[profiles.length - 1];
            if (match) {
              paymentProfileId = match.PaymentProfileId?.toString();
              persistentToken = match.Token;
              console.log('[CARDNET] OK - Perfil recuperado tras consulta:', paymentProfileId);
            }
          } catch (fErr) {
            console.error('[CARDNET] Error crítico: No se pudo obtener el perfil de pago.');
          }
        }
      }

      if (!persistentToken) throw new Error("No se pudo determinar un token de pago válido.");

      const activationFee = parseFloat(plan.activation_fee || 0);
      const planPrice = parseFloat(plan.price || 0);
      const totalAmount = planPrice + activationFee;
      const finalAmountCents = Math.round(totalAmount * 100);

      console.log(`[CARDNET] Intentando cobro inicial: Plan (RD$ ${planPrice}) + Inscripción (RD$ ${activationFee}) = Total: RD$ ${totalAmount}`);

      let purchaseResult = null;
      let isApproved = false;

      if (isMockToken) {
        isApproved = true;
        purchaseResult = {
          Transaction: {
            Status: "Approved",
            OrderNumber: `CN-MOCK-${Date.now().toString().slice(-6)}`,
            RemoteId: `MOCK-${Date.now().toString().slice(-6)}`,
            Description: "Cobro Simulado por Contingencia"
          },
          ResponseCode: "00"
        };
        console.log("[CARDNET BYPASS] Aprobando cobro inicial simulado automáticamente.");
      } else {
        const purchasePayload = {
          TrxToken: persistentToken,
          Order: `ORD-${Date.now().toString().slice(-6)}`,
          Amount: finalAmountCents,
          Currency: "DOP",
          Capture: true,
          Description: activationFee > 0 
            ? `Inscripción + Primer Mes: ${plan.title}` 
            : `Activación de Plan: ${plan.title}`,
          CustomerIP: req.ip || "127.0.0.1",
          MerchantNumber: CARDNET_CONFIG.MERCHANT_NUMBER,
          MerchantTerminal: CARDNET_CONFIG.TERMINAL_ID,
          DataDo: { Tax: "0", Invoice: `INV-${id.slice(-6)}` }
        };

        console.log('[CARDNET] Payload de Cobro Inicial:', JSON.stringify(purchasePayload, null, 2));

        let attempts = 0;
        const maxAttempts = 2;

        while (attempts < maxAttempts && !isApproved) {
          attempts++;
          try {
            console.log(`[CARDNET] Intento de cobro #${attempts} para PLAN: ${plan.title}`);
            const purchaseRes = await axios.post(
              `${CARDNET_CONFIG.BASE_URL}/api/Purchase`,
              purchasePayload,
              { headers: getCardNetAuthHeaders(), timeout: 15000 }
            );

            purchaseResult = purchaseRes.data.Response || purchaseRes.data;
            if (purchaseRes.data.Errors && purchaseRes.data.Errors.length > 0) {
              purchaseResult = {
                ...purchaseResult,
                Errors: purchaseRes.data.Errors,
                ResponseCode: purchaseRes.data.Errors[0].ErrorCode,
                ResponseMessage: purchaseRes.data.Errors[0].Message
              };
            }
            console.log(`[CARDNET] Resultado Intento #${attempts}:`, JSON.stringify(purchaseResult, null, 2));

            isApproved = purchaseResult.Transaction?.Status === "Approved" || 
                         purchaseResult.ResponseCode === "00" ||
                         purchaseResult.Transaction?.Steps?.some(s => s.ResponseCode === "00");

            if (!isApproved && !isProductionEnv) {
               const desc = (purchaseResult.ResponseMessage || purchaseResult.Transaction?.Description || "").toUpperCase();
               if (desc.includes("TR005") || purchaseResult.ResponseCode === "TR005") {
                  console.log("[CARDNET] Detectado TR005 en Sandbox. Aplicando Bypass de Pruebas.");
                  isApproved = true;
               }
            }

            if (!isApproved && attempts < maxAttempts) {
              console.log("[CARDNET] Cobro declinado, reintentando en 1.5s...");
              await new Promise(resolve => setTimeout(resolve, 1500));
            }
          } catch (err) {
            console.error(`[CARDNET] Error en intento #${attempts}:`, err.message);
            if (attempts >= maxAttempts) {
              if (!isProductionEnv) {
                console.warn("[CARDNET] Servidor de CardNet inalcanzable. Aprobando cobro inicial por contingencia local.");
                isApproved = true;
                paymentProfileId = paymentProfileId || `mock_contingency_${Date.now()}`;
                purchaseResult = {
                  Transaction: {
                    Status: "Approved",
                    OrderNumber: `CN-CONT-${Date.now().toString().slice(-6)}`,
                    RemoteId: `CONT-${Date.now().toString().slice(-6)}`,
                    Description: "Aprobado por contingencia local (servidor de pruebas caído)"
                  },
                  ResponseCode: "00"
                };
              } else {
                console.error("[CARDNET] Servidor de CardNet inalcanzable en producción. Abortando cobro y guardado del contrato.");
                throw new Error("No se pudo conectar con CardNet para validar la tarjeta e iniciar la suscripción.");
              }
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        }
      }

      if (!isApproved) {
        const declineMsg = purchaseResult?.ResponseMessage || purchaseResult?.Transaction?.Description || (purchaseResult?.Errors && purchaseResult?.Errors[0]?.Message) || "Declinada por el banco";
        const payFailId = `PAY-FAIL-${Date.now()}`;
        try {
          await pool.query(
            'INSERT INTO payments (id, client_id, plan_id, amount, method, status, description, cardnet_raw_response, salon_id, applied_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              payFailId,
              clientId,
              planId,
              totalAmount,
              'CardNet',
              'Fallido - Intento Inicial',
              `Intento de Activación Declinado: ${plan.title} (${declineMsg})`,
              JSON.stringify(purchaseResult || { error: declineMsg }),
              client.salon_id || 1,
              'CardNet Gateway'
            ]
          );
        } catch (dbErr) {}

        if (cardnetCustomerId && paymentProfileId) {
          try {
            await axios.delete(
              `${CARDNET_CONFIG.BASE_URL}/api/Customer/${cardnetCustomerId}/PaymentProfile/${paymentProfileId}`,
              { headers: getCardNetAuthHeaders(), timeout: CARDNET_CONFIG.TIMEOUT }
            );
          } catch (delErr) {}
        }

        throw new Error(`El cobro inicial fue declinado: ${purchaseResult?.ResponseMessage || purchaseResult?.Transaction?.Description || "Error de conexión"}`);
      }

      const today = new Date();
      let nextBilling;
      if (CARDNET_CONFIG.ENV === 'PRODUCTION') {
        nextBilling = new Date(today);
        nextBilling.setMonth(nextBilling.getMonth() + 1);
      } else {
        nextBilling = new Date(today.getTime() + (1000 * 60 * 2));
      }
      const toLocalSqlString = (d) => {
        const tzOffset = d.getTimezoneOffset() * 60000;
        return new Date(d.getTime() - tzOffset).toISOString().slice(0, 19).replace('T', ' ');
      };
      
      const nextBillingStr = toLocalSqlString(nextBilling);
      const todayStr = toLocalSqlString(today);

      const getClientIp = (req) => {
        if (req.body.ip_address && req.body.ip_address !== 'Cargando...' && req.body.ip_address !== 'undefined') {
          return req.body.ip_address;
        }
        const forwarded = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.headers['remote-addr'];
        if (forwarded) return forwarded.split(',')[0].trim();
        return req.ip || req.socket.remoteAddress || '127.0.0.1';
      };

      const clientIp = getClientIp(req);
      const { documentPhoto, selfiePhoto, deviceAgent } = req.body;
      await pool.query(
        'INSERT INTO contracts (id, client_id, plan_id, contract_services, contract_price, contract_promo_services, contract_promo_duration, signature_hash, ip_address, device_agent, geolocation, payment_profile_id, card_token, last_billed_date, next_billing_date, salon_id, status, auto_billing_enabled, document_photo, selfie_photo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id, 
          clientId, 
          planId, 
          JSON.stringify(plan.services || []),
          plan.price,
          JSON.stringify(plan.promo_services || []),
          plan.promo_duration_months || 0,
          signature_hash, 
          clientIp, 
          deviceAgent || req.headers['user-agent'],
          req.body.geolocation || null,
          paymentProfileId, 
          persistentToken, 
          todayStr, 
          nextBillingStr, 
          contractSalonId,
          'Active',
          1,
          documentPhoto || null,
          selfiePhoto || null
        ]
      );

      const gatewayRef = purchaseResult?.Transaction?.OrderNumber || purchaseResult?.Transaction?.RemoteId || `CN-${id.slice(-6)}`;
      await pool.query(
        'INSERT INTO payments (id, client_id, plan_id, amount, method, status, gateway_ref, description, salon_id, applied_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [`PAY-INIT-${id}`, clientId, planId, totalAmount, 'CardNet_Recurring_Setup', 'Aprobado', gatewayRef, activationFee > 0 ? `Inscripción + Primer Mes: ${plan.title}` : `Activación de Plan: ${plan.title}`, contractSalonId, 'CardNet Gateway']
      );

      await pool.query('UPDATE clients SET status = "Active", salon_id = COALESCE(salon_id, ?) WHERE id = ?', [contractSalonId, clientId]);

      if (sendPaymentReceiptEmail) {
        sendPaymentReceiptEmail(clientId, client.nombre, client.email, totalAmount, activationFee > 0 ? `Inscripción + Primer Mes: ${plan.title}` : `Activación de Plan: ${plan.title}`, gatewayRef);
      }

      res.json({ success: true, paymentProfileId, purchaseResult });
    } catch (err) {
      console.error('Contract processing error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin Manual Payment & Contract Renewal
  router.post('/contracts/renew-manual', async (req, res) => {
    try {
      const { clientId, amount, appliedBy, salonId } = req.body;

      const [contracts] = await pool.query('SELECT * FROM contracts WHERE client_id = ?', [clientId]);
      if (contracts.length === 0) throw new Error('El cliente no tiene un contrato de suscripción válido.');

      const contract = contracts[0];

      const paymentId = `PAY-MANUAL-${Date.now()}`;
      await pool.query(
        'INSERT INTO payments (id, client_id, plan_id, amount, method, status, applied_by, salon_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [paymentId, clientId, contract.plan_id, amount, 'Efectivo/POS', 'Aprobado', appliedBy || 'Sistema', salonId || null]
      );

      try {
        const [cRows] = await pool.query('SELECT nombre, email FROM clients WHERE id = ?', [clientId]);
        if (cRows.length > 0 && cRows[0].email && sendPaymentReceiptEmail) {
          sendPaymentReceiptEmail(clientId, cRows[0].nombre, cRows[0].email, amount, 'Renovación Manual de Suscripción', paymentId);
        }
      } catch (e) {
        console.error('[EMAIL ERROR] Manual renewal receipt failed:', e.message);
      }

      const intervalUnit = CARDNET_CONFIG.ENV === 'PRODUCTION' ? 'MONTH' : 'HOUR';
      await pool.query(
        `UPDATE contracts SET last_billed_date = NOW(), next_billing_date = DATE_ADD(NOW(), INTERVAL 1 ${intervalUnit}), auto_billing_enabled = 1, status = "Active", retry_count = 0 WHERE client_id = ?`,
        [clientId]
      );
      await pool.query('UPDATE clients SET status = "Active" WHERE id = ?', [clientId]);

      const nextDate = new Date();
      nextDate.setMonth(nextDate.getMonth() + 1);
      const nextStr = nextDate.toISOString().slice(0, 19).replace('T', ' ');

      res.json({ success: true, nextBillingStr: nextStr });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === CRON / SUBSCRIPTION BILLING PROCESS ENDPOINTS ===
  router.post('/cron/process-subscriptions', async (req, res) => {
    try {
      const results = await processSubscriptionsInternal(pool, helpers, req.ip);
      res.json({ success: true, ...results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/subscriptions/process-now', async (req, res) => {
    try {
      const results = await processSubscriptionsInternal(pool, helpers, req.ip);
      res.json({ success: true, ...results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createContractsRouter, processSubscriptionsInternal };
