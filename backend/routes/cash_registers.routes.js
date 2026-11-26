const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { createQuarantineGuard } = require('../middleware/quarantine.middleware.cjs');
const { createIdempotencyMiddleware } = require('../middleware/idempotency.middleware.cjs');
const { getBranchScope, isBranchAuthorized } = require('../middleware/rbac.middleware');
const { getGlobalSmtpConfig, resolveTransporterForTenant } = require('../services/platform_email.service');
const { computeCanonicalRegisterSummary, aggregateRegisterSummary } = require('../services/cash_register_aggregation.service');

const escapeHtml = (v) => String(v ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const fmtMoney = (n) => `RD$ ${Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidRegisterUuid(id) {
  if (!id || typeof id !== 'string') return false;
  return UUID_REGEX.test(id.trim());
}

/**
 * Resolves a monetary field supporting canonical and legacy alias names,
 * rejecting contradictory values and rejecting missing/invalid/negative numbers.
 */
function resolveAliasedAmount(body, canonicalKey, aliasKey, errorCode, fieldLabel) {
  const safeBody = body && typeof body === 'object' ? body : {};
  const hasCanonical = safeBody[canonicalKey] !== undefined;
  const hasAlias = safeBody[aliasKey] !== undefined;

  if (!hasCanonical && !hasAlias) {
    return {
      ok: false,
      status: 400,
      code: errorCode,
      error: `El campo ${fieldLabel} (${canonicalKey} / ${aliasKey}) es obligatorio y no puede omitirse.`
    };
  }

  const parseNum = (raw) => {
    if (raw === null || raw === '' || typeof raw === 'boolean') return NaN;
    const n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
  };

  if (hasCanonical && hasAlias) {
    const n1 = parseNum(safeBody[canonicalKey]);
    const n2 = parseNum(safeBody[aliasKey]);
    if (Number.isNaN(n1) || Number.isNaN(n2)) {
      return {
        ok: false,
        status: 400,
        code: errorCode,
        error: `El campo ${fieldLabel} contiene un valor numérico inválido.`
      };
    }
    if (Math.abs(n1 - n2) > 0.001) {
      return {
        ok: false,
        status: 400,
        code: 'CONTRADICTORY_PAYLOAD_FIELDS',
        error: `Valores contradictorios entre '${canonicalKey}' (${n1}) y '${aliasKey}' (${n2}).`
      };
    }
  }

  const rawValue = hasCanonical ? safeBody[canonicalKey] : safeBody[aliasKey];
  const parsed = parseNum(rawValue);
  if (Number.isNaN(parsed) || parsed < 0) {
    return {
      ok: false,
      status: 400,
      code: errorCode,
      error: `El campo ${fieldLabel} debe ser un número válido mayor o igual a 0.`
    };
  }

  return { ok: true, value: parsed };
}

/**
 * Resolves a text field supporting canonical and legacy alias names,
 * rejecting contradictory non-empty values.
 */
function resolveAliasedText(body, canonicalKey, aliasKey) {
  const safeBody = body && typeof body === 'object' ? body : {};
  const hasCanonical = safeBody[canonicalKey] !== undefined && safeBody[canonicalKey] !== null;
  const hasAlias = safeBody[aliasKey] !== undefined && safeBody[aliasKey] !== null;

  if (hasCanonical && hasAlias) {
    const s1 = String(safeBody[canonicalKey]).trim();
    const s2 = String(safeBody[aliasKey]).trim();
    if (s1 !== '' && s2 !== '' && s1 !== s2) {
      return {
        ok: false,
        status: 400,
        code: 'CONTRADICTORY_PAYLOAD_FIELDS',
        error: `Valores contradictorios entre '${canonicalKey}' y '${aliasKey}'.`
      };
    }
    return { ok: true, value: s1 || s2 };
  }
  if (hasCanonical) return { ok: true, value: String(safeBody[canonicalKey]).trim() };
  if (hasAlias) return { ok: true, value: String(safeBody[aliasKey]).trim() };
  return { ok: true, value: '' };
}

function buildCanonicalRegisterDto(register, summary = null) {
  if (!register) return null;
  const openingBalance = summary?.opening_balance !== undefined
    ? Number(summary.opening_balance)
    : Number(register.monto_inicial ?? register.opening_balance ?? 0);
  const expectedCash = summary?.expected_cash !== undefined
    ? Number(summary.expected_cash)
    : (register.expected_balance_cents != null ? Number(register.expected_balance_cents) / 100 : openingBalance);
  const closingBalance = register.monto_final != null
    ? Number(register.monto_final)
    : (register.closing_balance_cents != null ? Number(register.closing_balance_cents) / 100 : null);
  const difference = register.diferencia != null
    ? Number(register.diferencia)
    : (register.difference_cents != null ? Number(register.difference_cents) / 100 : 0);
  const notes = register.observaciones ?? register.notes ?? '';

  const dto = {
    ...register,
    ...(summary || {}),
    id: register.id,
    registerId: register.id,
    register_number: register.register_number || `CAJA-${String(register.id).slice(0, 8).toUpperCase()}`,
    registerNumber: register.register_number || `CAJA-${String(register.id).slice(0, 8).toUpperCase()}`,
    status: register.status,
    opening_balance: openingBalance,
    monto_inicial: openingBalance,
    expected_balance: expectedCash,
    expected_cash: expectedCash,
    monto_esperado: expectedCash,
    closing_balance: closingBalance,
    monto_final: closingBalance,
    difference,
    diferencia: difference,
    notes,
    observaciones: notes,
  };
  return {
    ...dto,
    register: { ...dto },
    summary: summary ? { ...summary, diferencia: difference, difference } : undefined
  };
}

async function sendCashRegisterCloseEmail(pool, {
  tenantId,
  registerId,
  registerNumber,
  salonId,
  salonName: providedSalonName,
  openedAt,
  openedBy,
  closedBy,
  openingBalance,
  cashSales,
  ingresos,
  salidas,
  expectedBalance,
  closingBalance,
  difference,
  discrepancyReason,
  notes,
  summary = {},
}) {
  try {
    const [tenantRows] = await pool.query(
      'SELECT business_name, legal_name, owner_email, email FROM tenants WHERE id = ? LIMIT 1',
      [tenantId]
    );
    const tenant = tenantRows?.[0] || {};
    const businessName = tenant.business_name || tenant.legal_name || 'Etereas';

    let branchLabel = providedSalonName || '';
    if (!branchLabel && salonId) {
      const [bRows] = await pool.query(
        'SELECT name FROM branches WHERE id::text = ? AND tenant_id = ? LIMIT 1',
        [String(salonId), tenantId]
      ).catch(() => [[]]);
      if (bRows?.[0]?.name) {
        branchLabel = bRows[0].name;
      } else {
        const [sRows] = await pool.query(
          'SELECT name FROM salons WHERE id::text = ? AND tenant_id = ? LIMIT 1',
          [String(salonId), tenantId]
        ).catch(() => [[]]);
        if (sRows?.[0]?.name) branchLabel = sRows[0].name;
      }
    }
    const fullSalonName = branchLabel ? `${businessName} - ${branchLabel}` : businessName;

    const [adminUsers] = await pool.query(
      "SELECT email FROM users WHERE tenant_id = ? AND role IN ('propietario', 'admin') AND email IS NOT NULL AND email != ''",
      [tenantId]
    );

    const recipients = Array.from(new Set([
      ...(adminUsers || []).map((u) => String(u.email).trim().toLowerCase()),
      ...(tenant.owner_email ? [String(tenant.owner_email).trim().toLowerCase()] : []),
    ].filter(Boolean)));

    if (recipients.length === 0) return { sent: false, reason: 'no_recipients' };

    // Prioriza el SMTP global configurado por el Administrador de la plataforma
    let transporter = null;
    let fromAddress = null;
    const globalCfg = await getGlobalSmtpConfig(pool);
    if (globalCfg) {
      fromAddress = `"${globalCfg.fromName || 'Etereas'}" <${globalCfg.user}>`;
      transporter = nodemailer.createTransport({
        host: globalCfg.host,
        port: globalCfg.port,
        secure: globalCfg.secure,
        auth: { user: globalCfg.user, pass: globalCfg.pass },
        tls: { rejectUnauthorized: false },
      });
    } else {
      const resolved = await resolveTransporterForTenant(pool, tenantId, businessName);
      transporter = resolved.transporter;
      fromAddress = resolved.fromAddress;
    }

    if (!transporter || !fromAddress) return { sent: false, reason: 'no_smtp_configured' };

    const formatDateDO = (dateVal) => {
      if (!dateVal) return 'N/A';
      return new Date(dateVal).toLocaleString('es-DO', {
        timeZone: 'America/Santo_Domingo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    };

    const openedStr = formatDateDO(openedAt);
    const closedStr = formatDateDO(new Date());
    const dateTodayStr = new Date().toLocaleDateString('es-DO', { timeZone: 'America/Santo_Domingo' });

    const efectivoTotal = Number(summary.efectivoTotal ?? cashSales ?? 0);
    const tarjetaTotal = Number(summary.tarjetaTotal ?? 0);
    const transferenciaTotal = Number(summary.transferenciaTotal ?? 0);
    const giftCardTotal = Number(summary.giftCardTotal ?? 0);
    const consumoTotal = Number(summary.consumoTotal ?? 0);
    const planBeautyTotal = Number(summary.planBeautyTotal ?? 0);
    const otrosTotal = Number(summary.otrosTotal ?? 0);
    const totalFacturado = Number(summary.totalFacturado ?? (efectivoTotal + tarjetaTotal + transferenciaTotal + giftCardTotal + consumoTotal + planBeautyTotal + otrosTotal));
    const countVentas = Number(summary.countVentas ?? 0);

    const gastosTotal = Number(summary.gastosTotal ?? 0);
    const prestamosTotal = Number(summary.prestamosTotal ?? 0);
    const retirosTotal = Number(summary.retirosTotal ?? 0);
    const entradasTotal = Number(summary.entradasTotal ?? ingresos ?? 0);
    const devolucionesEfectivoTotal = Number(summary.devolucionesEfectivoTotal ?? 0);
    const gastosYPrestamosTotal = Number((gastosTotal + prestamosTotal).toFixed(2)) || Math.max(0, Number(salidas || 0) - retirosTotal);

    const listaGastos = Array.isArray(summary.listaGastos) ? summary.listaGastos : [];
    const listaPrestamos = Array.isArray(summary.listaPrestamos) ? summary.listaPrestamos : [];
    const listaAnulaciones = Array.isArray(summary.listaAnulaciones) ? summary.listaAnulaciones : [];

    const regNumLabel = registerNumber || `CAJA-#${String(registerId).slice(0, 8).toUpperCase()}`;
    const obsText = String(notes || '').trim();
    const diffNum = Number(difference || 0);

    let diffStatusHtml = '';
    if (Math.abs(diffNum) < 0.01) {
      diffStatusHtml = '<span style="color: #16a34a; font-weight: 800; background: #dcfce7; padding: 4px 10px; border-radius: 6px;">✅ CUADRADA EXACTA (RD$ 0.00)</span>';
    } else if (diffNum > 0) {
      diffStatusHtml = `<span style="color: #0284c7; font-weight: 800; background: #e0f2fe; padding: 4px 10px; border-radius: 6px;">➕ SOBRANTE: +${escapeHtml(fmtMoney(diffNum))}</span>`;
    } else {
      diffStatusHtml = `<span style="color: #dc2626; font-weight: 800; background: #fee2e2; padding: 4px 10px; border-radius: 6px;">⚠️ FALTANTE: -${escapeHtml(fmtMoney(Math.abs(diffNum)))}</span>`;
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; color: #1e293b;">
        <div style="max-width: 650px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
          <div style="background: #ffffff; padding: 26px 20px 18px 20px; text-align: center; border-bottom: 2px solid #0f172a;">
            <h1 style="margin: 0; font-size: 24px; font-weight: 900; letter-spacing: 1.5px; color: #000000 !important; text-transform: uppercase;">${escapeHtml(businessName)}</h1>
            <h2 style="margin: 6px 0 0 0; font-size: 13px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.8px;">Reporte Oficial de Cierre y Arqueo de Caja</h2>
          </div>
          <div style="padding: 24px;">
            <div style="background: #f1f5f9; border-radius: 12px; padding: 16px; margin-bottom: 20px; font-size: 13px; line-height: 1.6;">
              <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <tr>
                  <td style="padding: 4px 0; color: #64748b;"><strong>Caja N°:</strong></td>
                  <td style="padding: 4px 0; text-align: right; font-weight: 700; color: #0f172a;">${escapeHtml(regNumLabel)}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; color: #64748b;"><strong>Responsable / Cajera:</strong></td>
                  <td style="padding: 4px 0; text-align: right; font-weight: 700; color: #0f172a;">${escapeHtml(closedBy || openedBy || 'Recepción')}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; color: #64748b;"><strong>Sucursal:</strong></td>
                  <td style="padding: 4px 0; text-align: right; color: #0f172a;">${escapeHtml(fullSalonName)}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; color: #64748b;"><strong>Apertura:</strong></td>
                  <td style="padding: 4px 0; text-align: right; color: #0f172a;">${escapeHtml(openedStr)}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; color: #64748b;"><strong>Cierre:</strong></td>
                  <td style="padding: 4px 0; text-align: right; color: #0f172a;">${escapeHtml(closedStr)}</td>
                </tr>
              </table>
            </div>

            <!-- CARD 1: VENTAS POR MÉTODO -->
            <div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin-bottom: 20px;">
              <div style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; margin-bottom: 14px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px;">💳 Resumen de Ventas Facturadas (${countVentas} Transacciones Activas)</div>
              <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <tr style="border-bottom: 1px dashed #e2e8f0;">
                  <td style="padding: 6px 0;">💵 Efectivo Neto</td>
                  <td style="padding: 6px 0; text-align: right; font-weight: 600;">${escapeHtml(fmtMoney(efectivoTotal))}</td>
                </tr>
                <tr style="border-bottom: 1px dashed #e2e8f0;">
                  <td style="padding: 6px 0;">💳 Tarjeta / Verifone Neto</td>
                  <td style="padding: 6px 0; text-align: right; font-weight: 600;">${escapeHtml(fmtMoney(tarjetaTotal))}</td>
                </tr>
                <tr style="border-bottom: 1px dashed #e2e8f0;">
                  <td style="padding: 6px 0;">📲 Transferencia Neta</td>
                  <td style="padding: 6px 0; text-align: right; font-weight: 600;">${escapeHtml(fmtMoney(transferenciaTotal))}</td>
                </tr>
                ${giftCardTotal > 0 ? `
                <tr style="border-bottom: 1px dashed #e2e8f0;">
                  <td style="padding: 6px 0;">🎁 Gift Card / Bono</td>
                  <td style="padding: 6px 0; text-align: right; font-weight: 600;">${escapeHtml(fmtMoney(giftCardTotal))}</td>
                </tr>` : ''}
                ${consumoTotal > 0 ? `
                <tr style="border-bottom: 1px dashed #e2e8f0;">
                  <td style="padding: 6px 0;">👥 Consumo Nómina / Empleado</td>
                  <td style="padding: 6px 0; text-align: right; font-weight: 600;">${escapeHtml(fmtMoney(consumoTotal))}</td>
                </tr>` : ''}
                ${planBeautyTotal > 0 ? `
                <tr style="border-bottom: 1px dashed #e2e8f0;">
                  <td style="padding: 6px 0;">💎 Plan Beauty (Canjes)</td>
                  <td style="padding: 6px 0; text-align: right; font-weight: 600;">${escapeHtml(fmtMoney(planBeautyTotal))}</td>
                </tr>` : ''}
                ${otrosTotal > 0 ? `
                <tr style="border-bottom: 1px dashed #e2e8f0;">
                  <td style="padding: 6px 0;">🏷️ Otros Métodos</td>
                  <td style="padding: 6px 0; text-align: right; font-weight: 600;">${escapeHtml(fmtMoney(otrosTotal))}</td>
                </tr>` : ''}
                <tr style="border-top: 2px solid #0f172a; font-weight: 800; font-size: 15px;">
                  <td style="padding: 10px 0; color: #0f172a;">TOTAL FACTURADO EN TURNO</td>
                  <td style="padding: 10px 0; text-align: right; color: #be185d;">${escapeHtml(fmtMoney(totalFacturado))}</td>
                </tr>
              </table>
            </div>

            <!-- CARD ANULACIONES SI EXISTEN -->
            ${listaAnulaciones.length > 0 ? `
            <div style="border: 1px solid #fecaca; background: #fff5f5; border-radius: 12px; padding: 18px; margin-bottom: 20px;">
              <div style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #991b1b; margin-bottom: 10px; border-bottom: 1px solid #fee2e2; padding-bottom: 6px;">🚫 Facturas Anuladas Descontadas (${listaAnulaciones.length})</div>
              <ul style="list-style: none; padding: 0; margin: 0; font-size: 13px;">
                ${listaAnulaciones.map(a => `<li style="padding: 6px 10px; background: #ffffff; border-radius: 6px; margin-bottom: 6px; border-left: 3px solid #dc2626; display: flex; justify-content: space-between;"><span>${escapeHtml(a.concept || a.client_name || a.ticket_number || 'Factura')} (${escapeHtml(a.payment_method || a.metodo_pago || 'N/A')})</span><span style="font-weight: 700; color: #dc2626;">-${escapeHtml(fmtMoney(a.amount || a.total || 0))}</span></li>`).join('')}
              </ul>
            </div>` : ''}

            <!-- CARD 2: GASTOS, PRÉSTAMOS Y RETIROS -->
            ${(gastosTotal > 0 || prestamosTotal > 0 || retirosTotal > 0 || entradasTotal > 0) ? `
            <div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin-bottom: 20px;">
              <div style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; margin-bottom: 14px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px;">📉 Salidas, Préstamos y Entradas de Caja</div>
              <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 10px;">
                ${gastosTotal > 0 ? `
                <tr style="border-bottom: 1px dashed #e2e8f0;">
                  <td style="padding: 6px 0;">🔻 Gastos Imprevistos / Compras:</td>
                  <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #e11d48;">-${escapeHtml(fmtMoney(gastosTotal))}</td>
                </tr>` : ''}
                ${prestamosTotal > 0 ? `
                <tr style="border-bottom: 1px dashed #e2e8f0;">
                  <td style="padding: 6px 0;">👥 Préstamos a Colaboradoras:</td>
                  <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #e11d48;">-${escapeHtml(fmtMoney(prestamosTotal))}</td>
                </tr>` : ''}
                ${retirosTotal > 0 ? `
                <tr style="border-bottom: 1px dashed #e2e8f0;">
                  <td style="padding: 6px 0;">🏦 Retiros de Efectivo:</td>
                  <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #e11d48;">-${escapeHtml(fmtMoney(retirosTotal))}</td>
                </tr>` : ''}
                ${entradasTotal > 0 ? `
                <tr style="border-bottom: 1px dashed #e2e8f0;">
                  <td style="padding: 6px 0;">➕ Entradas Adicionales:</td>
                  <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #16a34a;">+${escapeHtml(fmtMoney(entradasTotal))}</td>
                </tr>` : ''}
              </table>

              ${listaPrestamos.length > 0 ? `
                <div style="font-size: 12px; font-weight: 700; color: #64748b; margin: 10px 0 6px 0;">Detalle de Préstamos:</div>
                <ul style="list-style: none; padding: 0; margin: 0; font-size: 13px;">
                  ${listaPrestamos.map(p => `<li style="padding: 6px 10px; background: #f8fafc; border-radius: 6px; margin-bottom: 6px; border-left: 3px solid #f43f5e; display: flex; justify-content: space-between;"><span><strong>${escapeHtml(p.employee_name || 'Colaborador')}</strong>: ${escapeHtml(p.concept || '')}</span><span style="font-weight: 700; color: #be185d;">${escapeHtml(fmtMoney(p.amount))}</span></li>`).join('')}
                </ul>
              ` : ''}

              ${listaGastos.length > 0 ? `
                <div style="font-size: 12px; font-weight: 700; color: #64748b; margin: 10px 0 6px 0;">Detalle de Gastos:</div>
                <ul style="list-style: none; padding: 0; margin: 0; font-size: 13px;">
                  ${listaGastos.map(g => `<li style="padding: 6px 10px; background: #f8fafc; border-radius: 6px; margin-bottom: 6px; border-left: 3px solid #e11d48; display: flex; justify-content: space-between;"><span>${escapeHtml(g.concept || '')}</span><span style="font-weight: 700; color: #e11d48;">${escapeHtml(fmtMoney(g.amount))}</span></li>`).join('')}
                </ul>
              ` : ''}
            </div>` : ''}

            <!-- CARD 3: ARQUEO DE EFECTIVO -->
            <div style="background: #fdf2f8; border: 1px solid #fbcfe8; border-radius: 12px; padding: 18px; margin-bottom: 20px;">
              <div style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #9d174d; margin-bottom: 14px; border-bottom: 1px solid #fbcfe8; padding-bottom: 8px;">💵 Cuadre y Arqueo de Efectivo Físico</div>
              <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <tr>
                  <td style="padding: 5px 0;">(+) Fondo Inicial de Caja:</td>
                  <td style="padding: 5px 0; text-align: right; font-weight: 600;">${escapeHtml(fmtMoney(openingBalance))}</td>
                </tr>
                <tr>
                  <td style="padding: 5px 0;">(+) Ventas Netas en Efectivo:</td>
                  <td style="padding: 5px 0; text-align: right; font-weight: 600;">+${escapeHtml(fmtMoney(efectivoTotal))}</td>
                </tr>
                ${entradasTotal > 0 ? `
                <tr>
                  <td style="padding: 5px 0;">(+) Entradas Adicionales:</td>
                  <td style="padding: 5px 0; text-align: right; font-weight: 600; color: #16a34a;">+${escapeHtml(fmtMoney(entradasTotal))}</td>
                </tr>` : ''}
                ${gastosYPrestamosTotal > 0 ? `
                <tr>
                  <td style="padding: 5px 0;">(-) Gastos y Préstamos:</td>
                  <td style="padding: 5px 0; text-align: right; font-weight: 600; color: #e11d48;">-${escapeHtml(fmtMoney(gastosYPrestamosTotal))}</td>
                </tr>` : ''}
                ${retirosTotal > 0 ? `
                <tr>
                  <td style="padding: 5px 0;">(-) Retiros de Efectivo:</td>
                  <td style="padding: 5px 0; text-align: right; font-weight: 600; color: #e11d48;">-${escapeHtml(fmtMoney(retirosTotal))}</td>
                </tr>` : ''}
                ${devolucionesEfectivoTotal > 0 ? `
                <tr>
                  <td style="padding: 5px 0;">(-) Devoluciones en Efectivo:</td>
                  <td style="padding: 5px 0; text-align: right; font-weight: 600; color: #e11d48;">-${escapeHtml(fmtMoney(devolucionesEfectivoTotal))}</td>
                </tr>` : ''}
                <tr style="border-top: 1px solid #f472b6; font-weight: 700;">
                  <td style="padding: 8px 0; color: #475569;">(=) EFECTIVO ESPERADO EN CAJA:</td>
                  <td style="padding: 8px 0; text-align: right; color: #0f172a; font-size: 14px;">${escapeHtml(fmtMoney(expectedBalance))}</td>
                </tr>
                <tr style="border-top: 2px solid #be185d; font-weight: 800; font-size: 15px;">
                  <td style="padding: 8px 0; color: #0f172a;">(💵) EFECTIVO DECLARADO (CONTADO):</td>
                  <td style="padding: 8px 0; text-align: right; color: #0f172a;">${escapeHtml(fmtMoney(closingBalance))}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;">Resultado del Cuadre:</td>
                  <td style="padding: 8px 0; text-align: right;">${diffStatusHtml}</td>
                </tr>
              </table>
            </div>

            ${discrepancyReason ? `
              <div style="background: #fef2f2; border: 1px solid #fecaca; border-left: 4px solid #dc2626; padding: 12px 16px; border-radius: 8px; font-size: 13px; color: #991b1b; margin-bottom: 14px;">
                <strong>⚠️ Motivo de diferencia reportado:</strong><br/>
                <span>${escapeHtml(discrepancyReason)}</span>
              </div>
            ` : ''}

            <!-- CARD 4: OBSERVACIONES -->
            ${obsText ? `
              <div style="background: #fffbeb; border: 1px solid #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 8px; font-size: 13px; color: #92400e;">
                <strong>📝 Observaciones registradas por la recepcionista:</strong><br/>
                <span style="font-style: italic;">"${escapeHtml(obsText)}"</span>
              </div>
            ` : `
              <div style="font-size: 12px; color: #94a3b8; font-style: italic; text-align: center; margin-top: 10px;">
                Sin observaciones adicionales registradas en el cierre.
              </div>
            `}
          </div>
          <div style="background: #f8fafc; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
            Enviado automáticamente por el Sistema POS &amp; Gestión ${escapeHtml(businessName)} / Etereas.<br/>
            Este correo es confidencial y para control administrativo interno.
          </div>
        </div>
      </body>
      </html>
    `;

    const text = [
      `${businessName} — Reporte Oficial de Cierre y Arqueo de Caja`,
      `Caja N°: ${regNumLabel} | Sucursal: ${fullSalonName}`,
      `Responsable / Cajera: ${closedBy || openedBy || 'Recepción'}`,
      `Apertura: ${openedStr} | Cierre: ${closedStr}`,
      `Total Facturado (${countVentas} transacciones): ${fmtMoney(totalFacturado)}`,
      `Efectivo Neto: ${fmtMoney(efectivoTotal)} | Tarjeta: ${fmtMoney(tarjetaTotal)} | Transferencia: ${fmtMoney(transferenciaTotal)}`,
      `Fondo inicial: ${fmtMoney(openingBalance)}`,
      `Entradas adicionales: +${fmtMoney(entradasTotal)}`,
      `Gastos y Préstamos: -${fmtMoney(gastosYPrestamosTotal)} | Retiros: -${fmtMoney(retirosTotal)}`,
      `Efectivo esperado: ${fmtMoney(expectedBalance)}`,
      `Efectivo declarado: ${fmtMoney(closingBalance)}`,
      `Diferencia: ${fmtMoney(diffNum)}`,
      discrepancyReason ? `Motivo diferencia: ${discrepancyReason}` : '',
      obsText ? `Observaciones: ${obsText}` : '',
    ].filter(Boolean).join('\n');

    await transporter.sendMail({
      from: fromAddress,
      to: recipients.join(', '),
      subject: `📊 Cierre de Caja #${regNumLabel} (${dateTodayStr}) - ${closedBy || openedBy || 'Recepción'} [${fmtMoney(totalFacturado)}]`,
      text,
      html,
    });

    return { sent: true, recipients_count: recipients.length };
  } catch (emailErr) {
    console.error('[CASH REGISTER CLOSE EMAIL ERROR]:', emailErr?.message || emailErr);
    return { sent: false, reason: 'send_failed' };
  }
}

/**
 * Cash Registers (Cajas de Jornada), Movements & Close Reports Router (Scoped strictly by tenant_id)
 */
function createCashRegistersRouter(pool) {
  const router = express.Router();

  // Fail-Closed Quarantine Protection Guard on Cash Registers
  router.use('/:id', createQuarantineGuard(pool, 'cash_registers', 'id'));

  // Financial Idempotency Guard (open, close, cash movements)
  router.use(createIdempotencyMiddleware());

  const ALLOWED_MANUAL_MOVEMENT_TYPES = new Set([
    'ingreso', 'in', 'entrada', 'entrada_adicional',
    'salida', 'gasto', 'gasto_imprevisto',
    'retiro', 'retiro_efectivo', 'sangria',
    'prestamo', 'prestamo_empleado',
    'devolucion', 'refund'
  ]);

  const resolveBranchIdForTenant = async (tenantId, requestedSalonId) => {
    if (requestedSalonId && String(requestedSalonId).length > 10 && requestedSalonId !== 'all') {
      const [bRows] = await pool.query('SELECT id FROM branches WHERE id::text = ? AND tenant_id = ? LIMIT 1', [String(requestedSalonId), tenantId]);
      if (bRows.length > 0) return { ok: true, branchId: bRows[0].id };
      return { ok: false, branchId: null };
    }
    const [bRows] = await pool.query('SELECT id FROM branches WHERE tenant_id = ? ORDER BY is_main DESC, created_at ASC LIMIT 1', [tenantId]);
    return { ok: true, branchId: bRows[0]?.id || null };
  };

  // 0. Listado de cajas con filtros (salon_id, status, start_date, end_date)
  router.get('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { salon_id, status, start_date, end_date } = req.query;

      let query = `
        SELECT cr.*,
               COALESCE(b.name, 'Sede Principal') as salon_name,
               COALESCE(cr.employee_name, cr.opened_by_name, 'Principal') as employee_name
        FROM cash_registers cr
        LEFT JOIN branches b ON b.id::text = cr.branch_id::text AND b.tenant_id = cr.tenant_id
        WHERE cr.tenant_id = ?
      `;
      const params = [tenantId];

      const scope = getBranchScope(req);
      if (!scope.allBranches) {
        if (salon_id && salon_id !== 'all') {
          if (!isBranchAuthorized(req, salon_id)) {
            return res.status(403).json({
              error: 'No tienes acceso autorizado a la sucursal solicitada.',
              code: 'BRANCH_ACCESS_DENIED'
            });
          }
          query += ' AND (cr.branch_id::text = ? OR cr.salon_id::text = ?)';
          params.push(String(salon_id), String(salon_id));
        } else {
          if (scope.branchIds.length === 0) {
            return res.json([]);
          }
          const placeholders = scope.branchIds.map(() => '?').join(', ');
          query += ` AND (cr.branch_id::text IN (${placeholders}) OR cr.salon_id::text IN (${placeholders}))`;
          params.push(...scope.branchIds, ...scope.branchIds);
        }
      } else if (salon_id && salon_id !== 'all') {
        query += ' AND (cr.branch_id::text = ? OR cr.salon_id::text = ?)';
        params.push(String(salon_id), String(salon_id));
      }
      if (status && status !== 'all') {
        query += ' AND cr.status = ?';
        params.push(String(status));
      }
      if (start_date && /^\d{4}-\d{2}-\d{2}$/.test(String(start_date))) {
        query += ' AND cr.opened_at >= ?::date';
        params.push(String(start_date));
      }
      if (end_date && /^\d{4}-\d{2}-\d{2}$/.test(String(end_date))) {
        query += " AND cr.opened_at < (?::date + INTERVAL '1 day')";
        params.push(String(end_date));
      }

      query += ' ORDER BY cr.opened_at DESC LIMIT 200';
      const [rows] = await pool.query(query, params);
      const filtered = scope.allBranches
        ? (rows || [])
        : (rows || []).filter((r) => isBranchAuthorized(req, r.branch_id ?? r.salon_id));

      if (filtered.length === 0) {
        return res.json([]);
      }

      // Enriquecer cada caja en lote con el resumen canónico (estrictamente por tenant_id y cash_register_id)
      const regIds = filtered.map((r) => String(r.id));
      const idPlaceholders = regIds.map(() => '?').join(', ');
      const [allVisits] = await pool.query(
        `SELECT id, cash_register_id, ticket_number, client_name, total, total_cents, metodo_pago, applied_payments, status, visited_at, ncf, void_reason, voided_at
         FROM visits
         WHERE tenant_id = ? AND cash_register_id::text IN (${idPlaceholders})`,
        [tenantId, ...regIds]
      );
      const [allMovs] = await pool.query(
        `SELECT id, cash_register_id, type, payment_method, amount, amount_cents, concept, user_name, created_at
         FROM cash_register_movements
         WHERE tenant_id = ? AND cash_register_id::text IN (${idPlaceholders})`,
        [tenantId, ...regIds]
      );

      const visitsByReg = new Map();
      (allVisits || []).forEach((v) => {
        const k = String(v.cash_register_id);
        if (!visitsByReg.has(k)) visitsByReg.set(k, []);
        visitsByReg.get(k).push(v);
      });
      const movsByReg = new Map();
      (allMovs || []).forEach((m) => {
        const k = String(m.cash_register_id);
        if (!movsByReg.has(k)) movsByReg.set(k, []);
        movsByReg.get(k).push(m);
      });

      const enriched = filtered.map((reg) => {
        const k = String(reg.id);
        const summary = aggregateRegisterSummary(reg, visitsByReg.get(k) || [], movsByReg.get(k) || []);
        return {
          ...reg,
          ...summary,
        };
      });

      res.json(enriched);
    } catch (err) {
      console.error('Error listing cash registers:', err);
      res.status(500).json({ error: 'Error consultando listado de cajas' });
    }
  });

  // 1. Obtener caja activa para una sucursal dentro del tenant autenticado
  router.get('/active', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { salon_id = 1 } = req.query;

      if (salon_id && salon_id !== 'all' && !isBranchAuthorized(req, salon_id)) {
        return res.status(403).json({
          error: 'No tienes autorización para consultar la caja de esta sucursal.',
          code: 'BRANCH_ACCESS_DENIED'
        });
      }

      let query = "SELECT * FROM cash_registers WHERE tenant_id = ? AND status = 'Abierta'";
      const params = [tenantId];

      if (salon_id && salon_id !== 'all') {
        const sid = String(salon_id);
        if (sid.length > 10) {
          query += " AND (branch_id::text = ? OR salon_id::text = ?)";
          params.push(sid, sid);
        } else {
          query += " AND (salon_id::text = ? OR salon_id IS NULL)";
          params.push(sid);
        }
      }
      query += " ORDER BY opened_at DESC LIMIT 1";

      const [rows] = await pool.query(query, params);
      if (rows.length === 0) {
        return res.json(null);
      }

      const register = rows[0];
      const { summary } = await computeCanonicalRegisterSummary(pool, tenantId, register);

      res.json(buildCanonicalRegisterDto(register, summary));
    } catch (err) {
      console.error('[CASH REGISTER ACTIVE ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 2. Abrir una nueva caja de jornada en el tenant autenticado (REM-P1-08 & Bloque 2 DTO Canónico)
  router.post('/open', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const body = req.body || {};
      const salon_id = body.salon_id ?? body.branch_id ?? 1;

      const amountCheck = resolveAliasedAmount(
        body,
        'opening_balance',
        'monto_inicial',
        'INVALID_OPENING_BALANCE',
        'monto inicial de apertura'
      );
      if (!amountCheck.ok) {
        return res.status(amountCheck.status).json({
          error: amountCheck.error,
          code: amountCheck.code
        });
      }

      const notesCheck = resolveAliasedText(body, 'notes', 'observaciones');
      if (!notesCheck.ok) {
        return res.status(notesCheck.status).json({
          error: notesCheck.error,
          code: notesCheck.code
        });
      }

      const openingBalance = amountCheck.value;
      const notes = notesCheck.value;

      if (!isBranchAuthorized(req, salon_id)) {
        return res.status(403).json({
          error: 'No tienes autorización para abrir cajas en esta sucursal.',
          code: 'BRANCH_ACCESS_DENIED'
        });
      }
      // Operador extraído estrictamente de req.auth para prevenir suplantación de identidad (REM-P1-08)
      const effectiveOpenedBy = req.auth?.name || req.auth?.email || req.headers['x-user-name'] || req.body?.opened_by || 'Recepción';

      const branchResolution = await resolveBranchIdForTenant(tenantId, salon_id);
      if (!branchResolution.ok) {
        return res.status(400).json({
          error: 'La sucursal especificada no pertenece a esta empresa.',
          code: 'INVALID_BRANCH'
        });
      }
      const branchId = branchResolution.branchId;
      const numericSalonId = (salon_id && !isNaN(Number(salon_id))) ? Number(salon_id) : 1;
      const openingBalanceCents = Math.round(openingBalance * 100);

      // Operación atómica con advisory lock por empresa+sucursal para impedir doble apertura concurrente
      const lockKey = `cash_open:${tenantId}:${branchId || numericSalonId}`;
      const conn = typeof pool.getConnection === 'function' ? await pool.getConnection() : null;
      let newId = null;
      let alreadyOpenId = null;
      try {
        if (conn) {
          await conn.beginTransaction();
          await conn.query('SELECT pg_advisory_xact_lock(hashtext(?))', [lockKey]);
          let checkQuery = "SELECT id FROM cash_registers WHERE tenant_id = ? AND status = 'Abierta'";
          const checkParams = [tenantId];
          if (branchId) {
            checkQuery += ' AND (branch_id::text = ? OR salon_id::text = ?)';
            checkParams.push(String(branchId), String(branchId));
          } else {
            checkQuery += ' AND (salon_id::text = ? OR salon_id IS NULL)';
            checkParams.push(String(numericSalonId));
          }
          checkQuery += ' LIMIT 1';
          const [existing] = await conn.query(checkQuery, checkParams);
          if (existing.length > 0) {
            alreadyOpenId = existing[0].id;
            await conn.rollback();
          } else {
            const [result] = await conn.query(
              `INSERT INTO cash_registers (tenant_id, branch_id, salon_id, monto_inicial, opening_balance_cents, opened_by_name, observaciones, status, opened_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'Abierta', NOW())
               RETURNING id`,
              [tenantId, branchId, numericSalonId, openingBalance, openingBalanceCents, effectiveOpenedBy, notes]
            );
            newId = result.insertId || result[0]?.id;
            await conn.commit();
          }
        } else {
          const [result] = await pool.query(
            `INSERT INTO cash_registers (tenant_id, branch_id, salon_id, monto_inicial, opening_balance_cents, opened_by_name, observaciones, status, opened_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'Abierta', NOW())
             RETURNING id`,
            [tenantId, branchId, numericSalonId, openingBalance, openingBalanceCents, effectiveOpenedBy, notes]
          );
          newId = result.insertId || result[0]?.id;
        }
      } catch (txErr) {
        if (conn) await conn.rollback().catch(() => { });
        throw txErr;
      } finally {
        if (conn) conn.release();
      }

      if (alreadyOpenId) {
        return res.status(400).json({
          error: 'Ya existe una caja abierta para esta sucursal. Ciérrala antes de abrir una nueva.',
          code: 'REGISTER_ALREADY_OPEN',
          register_id: alreadyOpenId
        });
      }
      const [created] = await pool.query('SELECT * FROM cash_registers WHERE id = ? AND tenant_id = ?', [newId, tenantId]);
      const createdReg = created[0] || {
        id: newId,
        tenant_id: tenantId,
        branch_id: branchId,
        salon_id: numericSalonId,
        status: 'Abierta',
        monto_inicial: openingBalance,
        opening_balance_cents: openingBalanceCents,
        opened_by_name: effectiveOpenedBy,
        observaciones: notes
      };
      const { summary } = await computeCanonicalRegisterSummary(pool, tenantId, createdReg);
      res.json(buildCanonicalRegisterDto(createdReg, summary));
    } catch (err) {
      console.error('[CASH REGISTER OPEN ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 3. Cerrar caja de jornada dentro del tenant autenticado (REM-P1-08 & REM-P2-02 & Addendum 2 & Bloque 2)
  router.post('/:id/close', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;

      if (!isValidRegisterUuid(id)) {
        return res.status(400).json({
          error: `Identificador de caja inválido ('${id}'). Debe ser un UUID válido.`,
          code: 'INVALID_REGISTER_ID'
        });
      }

      const body = req.body || {};
      const amountCheck = resolveAliasedAmount(
        body,
        'closing_balance',
        'monto_final',
        'INVALID_CLOSING_BALANCE',
        'monto final contado en caja'
      );
      if (!amountCheck.ok) {
        return res.status(amountCheck.status).json({
          error: amountCheck.error,
          code: amountCheck.code
        });
      }

      const notesCheck = resolveAliasedText(body, 'notes', 'observaciones');
      if (!notesCheck.ok) {
        return res.status(notesCheck.status).json({
          error: notesCheck.error,
          code: notesCheck.code
        });
      }

      const closing_balance = amountCheck.value;
      const notes = notesCheck.value;
      const {
        discrepancy_reason = '',
        double_confirmed = false,
        supervisor_pin = ''
      } = body;

      // Operador extraído estrictamente de req.auth para prevenir suplantación de identidad (REM-P1-08)
      const effectiveClosedBy = req.auth?.name || req.auth?.email || req.headers['x-user-name'] || req.body?.closed_by || 'Recepción';
      const closedByUserId = req.auth?.userId || req.auth?.id || null;

      const [rows] = await pool.query('SELECT * FROM cash_registers WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Caja no encontrada en esta empresa' });
      }

      const register = rows[0];
      const hasBranchScopeMetadata = req.auth?.allBranchesAccess !== undefined || req.auth?.authorizedBranchIds !== undefined || req.auth?.branchId !== undefined;
      const targetBranchOrSalon = register.branch_id ?? (hasBranchScopeMetadata ? register.salon_id : null);
      if (targetBranchOrSalon && !isBranchAuthorized(req, targetBranchOrSalon)) {
        return res.status(403).json({
          error: 'No tienes autorización para cerrar cajas de esta sucursal.',
          code: 'BRANCH_ACCESS_DENIED'
        });
      }
      if (String(register.status || '').toLowerCase() === 'cerrada') {
        return res.status(409).json({
          error: 'Esta caja ya se encuentra cerrada.',
          code: 'ALREADY_CLOSED',
          id: register.id,
          closed_at: register.closed_at
        });
      }

      const { summary: closeSummary } = await computeCanonicalRegisterSummary(pool, tenantId, register);
      const openingBalance = closeSummary.opening_balance;
      const ingresos = closeSummary.ingresos_manuales;
      const salidas = closeSummary.salidas_manuales;
      const cashSales = closeSummary.ventas_efectivo;
      const expectedBalanceCents = closeSummary.expected_cash_cents;
      const expectedBalance = expectedBalanceCents / 100;
      const actualClosing = Number(closing_balance) || 0;

      // Exact Minor Currency Units (Cents) calculation
      const actualClosingCents = Math.round(actualClosing * 100);
      const differenceCents = actualClosingCents - expectedBalanceCents;
      const difference = (differenceCents / 100);

      const correlationId = req.headers['x-correlation-id'] || req.correlationId || crypto.randomUUID();
      let supervisorUserId = null;
      let supervisorAuthorizedAt = null;
      let authorizationEventType = null;

      // REM-P2-02 & Addendum 2: Discrepancy checks
      if (differenceCents !== 0) {
        const trimmedReason = String(discrepancy_reason || '').trim();
        if (trimmedReason.length < 5) {
          return res.status(400).json({
            error: 'El motivo de la diferencia de arqueo es obligatorio (mínimo 5 caracteres).',
            code: 'DISCREPANCY_REASON_REQUIRED',
            difference_cents: differenceCents,
            expected_balance: expectedBalance,
            closing_balance: actualClosing
          });
        }

        if (double_confirmed !== true && double_confirmed !== 'true') {
          return res.status(400).json({
            error: 'Se requiere confirmación doble explícita ante discrepancia en caja.',
            code: 'DOUBLE_CONFIRMATION_REQUIRED',
            difference_cents: differenceCents,
            expected_balance: expectedBalance,
            closing_balance: actualClosing
          });
        }

        const thresholdCents = parseInt(process.env.CASH_DISCREPANCY_SUPERVISOR_THRESHOLD_CENTS || '10000', 10); // RD$ 100.00 default

        if (Math.abs(differenceCents) >= thresholdCents) {
          if (!supervisor_pin || String(supervisor_pin).trim() === '') {
            return res.status(403).json({
              error: 'La diferencia de arqueo excede el umbral permitido y requiere autorización obligatoria con PIN de supervisor.',
              code: 'SUPERVISOR_PIN_REQUIRED',
              difference_cents: differenceCents,
              threshold_cents: thresholdCents
            });
          }

          // Verify supervisor PIN against security_settings
          const [secRows] = await pool.query('SELECT admin_pin_hash FROM security_settings WHERE tenant_id = ? LIMIT 1', [tenantId]);
          const pinHash = secRows[0]?.admin_pin_hash;
          if (!pinHash) {
            return res.status(500).json({
              error: 'No se ha configurado el PIN administrativo en esta empresa.',
              code: 'PIN_NOT_CONFIGURED'
            });
          }

          const isPinValid = bcrypt.compareSync(String(supervisor_pin).trim(), pinHash);
          if (!isPinValid) {
            return res.status(401).json({
              error: 'PIN administrativo de supervisor inválido.',
              code: 'INVALID_ADMIN_PIN'
            });
          }

          // Lookup supervisor user
          const [supRows] = await pool.query(
            "SELECT id FROM users WHERE tenant_id = ? AND LOWER(role) IN ('propietario', 'owner', 'admin', 'supervisor') LIMIT 1",
            [tenantId]
          );
          supervisorUserId = supRows[0]?.id || null;
          supervisorAuthorizedAt = new Date();
          authorizationEventType = 'SUPERVISOR_PIN_THRESHOLD_EXCEEDED';
        } else {
          authorizationEventType = 'OPERATOR_DOUBLE_CONFIRMED_UNDER_THRESHOLD';
        }
      }

      const [updateRows] = await pool.query(
        `UPDATE cash_registers SET
           monto_final = ?,
           closing_balance_cents = ?,
           expected_balance_cents = ?,
           diferencia = ?,
           difference_cents = ?,
           difference_amount_cents = ?,
           discrepancy_reason = ?,
           supervisor_user_id = ?,
           supervisor_authorized_at = ?,
           authorization_event_type = ?,
           correlation_id = ?,
           closed_by = ?,
           closed_by_name = ?,
           observaciones = COALESCE(?, observaciones),
           status = 'Cerrada',
           closed_at = NOW()
         WHERE id = ? AND tenant_id = ? AND LOWER(COALESCE(status, '')) != 'cerrada'
         RETURNING id`,
        [
          actualClosing,
          actualClosingCents,
          expectedBalanceCents,
          difference,
          differenceCents,
          differenceCents,
          discrepancy_reason ? String(discrepancy_reason).trim() : null,
          supervisorUserId,
          supervisorAuthorizedAt,
          authorizationEventType,
          correlationId,
          effectiveClosedBy,
          effectiveClosedBy,
          notes || null,
          id,
          tenantId
        ]
      );

      if (!updateRows || updateRows.length === 0) {
        return res.status(409).json({
          error: 'Esta caja ya se encuentra cerrada.',
          code: 'ALREADY_CLOSED',
          id: register.id,
        });
      }

      const emailResult = await sendCashRegisterCloseEmail(pool, {
        tenantId,
        registerId: id,
        registerNumber: register.register_number || `CAJA-${String(id).slice(0, 8).toUpperCase()}`,
        salonId: register.branch_id || register.salon_id || null,
        salonName: register.salon_name || null,
        openedAt: register.opened_at,
        openedBy: register.opened_by_name || register.opened_by,
        closedBy: effectiveClosedBy,
        openingBalance,
        cashSales,
        ingresos,
        salidas,
        expectedBalance,
        closingBalance: actualClosing,
        difference,
        discrepancyReason: discrepancy_reason ? String(discrepancy_reason).trim() : null,
        notes: notes || null,
        summary: closeSummary,
      });

      const [closedRows] = await pool.query('SELECT * FROM cash_registers WHERE id = ? AND tenant_id = ? LIMIT 1', [id, tenantId]);
      const closedReg = closedRows[0] || {
        ...register,
        status: 'Cerrada',
        monto_final: actualClosing,
        closing_balance_cents: actualClosingCents,
        expected_balance_cents: expectedBalanceCents,
        diferencia: difference,
        difference_cents: differenceCents,
        observaciones: notes || register.observaciones || ''
      };
      const canonicalDto = buildCanonicalRegisterDto(closedReg, closeSummary);
      const report = {
        registerNumber: closedReg.register_number || `CAJA-${closedReg.id}`,
        employeeName: effectiveClosedBy,
        salonName: closedReg.salon_name || 'Sede Principal',
        openedAt: closedReg.opened_at,
        closedAt: closedReg.closed_at || new Date().toISOString(),
        initialAmt: openingBalance,
        finalAmt: actualClosing,
        montoEsperado: expectedBalance,
        diferencia: difference,
        observaciones: closedReg.observaciones || '',
        stats: closeSummary,
      };

      res.json({
        ...canonicalDto,
        success: true,
        id,
        closed_by: effectiveClosedBy,
        closed_by_user_id: closedByUserId,
        opening_balance: openingBalance,
        monto_inicial: openingBalance,
        cash_sales: cashSales,
        ingresos_manuales: ingresos,
        salidas_manuales: salidas,
        expected_balance: expectedBalance,
        expected_cash: expectedBalance,
        closing_balance: actualClosing,
        monto_final: actualClosing,
        difference,
        diferencia: difference,
        difference_amount_cents: differenceCents,
        discrepancy_reason: discrepancy_reason ? String(discrepancy_reason).trim() : null,
        notes: closedReg.observaciones || '',
        observaciones: closedReg.observaciones || '',
        supervisor_authorized: Boolean(supervisorUserId),
        authorization_event_type: authorizationEventType,
        correlation_id: correlationId,
        email_sent: Boolean(emailResult?.sent),
        report,
      });
    } catch (err) {
      console.error('[CASH REGISTER CLOSE ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 4. Reporte detallado de cierre de caja dentro del tenant autenticado (fuente canónica)
  router.get('/:id/close-report', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      if (!isValidRegisterUuid(id)) {
        return res.status(400).json({ error: `Identificador de caja inválido ('${id}').`, code: 'INVALID_REGISTER_ID' });
      }
      const [rows] = await pool.query(
        `SELECT cr.*, COALESCE(b.name, 'Sede Principal') AS salon_name
         FROM cash_registers cr
         LEFT JOIN branches b ON b.id::text = cr.branch_id::text AND b.tenant_id = cr.tenant_id
         WHERE cr.id = ? AND cr.tenant_id = ?`,
        [id, tenantId]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Caja no encontrada en esta empresa' });
      }
      const register = rows[0];
      if (!isBranchAuthorized(req, register.branch_id ?? register.salon_id)) {
        return res.status(403).json({ error: 'No tienes autorización para consultar esta caja.', code: 'BRANCH_ACCESS_DENIED' });
      }

      const { summary, visits, movements } = await computeCanonicalRegisterSummary(pool, tenantId, register);
      const facturadas = visits.filter((v) => String(v.status || '').toLowerCase() === 'facturado');

      const report = {
        registerNumber: register.register_number || `CAJA-${register.id}`,
        employeeName: register.closed_by_name || register.employee_name || register.opened_by_name || 'Recepción',
        salonName: register.salon_name || 'Sede Principal',
        openedAt: register.opened_at,
        closedAt: register.closed_at || null,
        initialAmt: summary.opening_balance,
        finalAmt: Number(register.monto_final ?? summary.expected_cash),
        montoEsperado: summary.expected_cash,
        diferencia: Number(register.diferencia ?? 0),
        observaciones: register.observaciones || '',
        stats: summary,
      };

      res.json({
        register: { ...register, ...summary },
        movements,
        visits: facturadas,
        summary,
        report,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5. Obtener movimientos y resumen canónico de una caja dentro del tenant autenticado
  router.get('/:id/movements', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      if (!isValidRegisterUuid(id)) {
        return res.status(400).json({ error: `Identificador de caja inválido ('${id}').`, code: 'INVALID_REGISTER_ID' });
      }
      const [regCheck] = await pool.query('SELECT * FROM cash_registers WHERE id = ? AND tenant_id = ? LIMIT 1', [id, tenantId]);
      if (regCheck.length === 0) {
        return res.status(404).json({ error: 'Caja no encontrada en esta empresa' });
      }
      const register = regCheck[0];
      if (!isBranchAuthorized(req, register.branch_id ?? register.salon_id)) {
        return res.status(403).json({ error: 'No tienes autorización para consultar esta caja.', code: 'BRANCH_ACCESS_DENIED' });
      }

      const { summary, movements } = await computeCanonicalRegisterSummary(pool, tenantId, register);

      res.json({
        movements,
        summary,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 6. Registrar movimiento manual en caja (Ingreso / Salida) dentro del tenant autenticado
  router.post('/:id/movements', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      if (!isValidRegisterUuid(id)) {
        return res.status(400).json({ error: `Identificador de caja inválido ('${id}').`, code: 'INVALID_REGISTER_ID' });
      }
      const {
        type = 'Salida',
        amount,
        concept,
        reason,
        payment_method = 'Efectivo',
        employee_id = null,
        employee_name = null,
      } = req.body;

      const normalizedType = String(type || '').trim().toLowerCase();
      if (!ALLOWED_MANUAL_MOVEMENT_TYPES.has(normalizedType)) {
        return res.status(400).json({
          error: `Tipo de movimiento inválido ('${type}').`,
          code: 'INVALID_MOVEMENT_TYPE'
        });
      }

      const [regCheck] = await pool.query(
        'SELECT id, status, branch_id, salon_id FROM cash_registers WHERE id = ? AND tenant_id = ? LIMIT 1',
        [id, tenantId]
      );
      if (regCheck.length === 0) {
        return res.status(404).json({ error: 'Caja no encontrada en esta empresa.' });
      }
      const reg = regCheck[0];
      if (!isBranchAuthorized(req, reg.branch_id ?? reg.salon_id)) {
        return res.status(403).json({
          error: 'No tienes autorización para registrar movimientos en esta sucursal.',
          code: 'BRANCH_ACCESS_DENIED'
        });
      }
      if (String(reg.status || '').toLowerCase() === 'cerrada') {
        return res.status(409).json({
          error: 'No se pueden registrar movimientos en una caja cerrada.',
          code: 'REGISTER_CLOSED'
        });
      }

      const numAmount = Number(amount);
      if (!Number.isFinite(numAmount) || numAmount <= 0) {
        return res.status(400).json({ error: 'El monto debe ser un número válido mayor a 0.', code: 'INVALID_MOVEMENT_AMOUNT' });
      }

      const rawConcept = String(concept || reason || 'Movimiento de caja').trim() || 'Movimiento de caja';
      const isLoanMovement = normalizedType.includes('prestamo');
      const isUnexpectedExpense =
        !isLoanMovement &&
        (normalizedType === 'gasto_imprevisto' || normalizedType === 'gasto' || normalizedType === 'salida');

      const finalConcept = isUnexpectedExpense
        ? (rawConcept.startsWith('[Gasto Imprevisto]') ? rawConcept : `[Gasto Imprevisto] ${rawConcept}`)
        : rawConcept;

      const amountCents = Math.round(numAmount * 100);
      const operatorId = req.auth?.id ? String(req.auth.id) : null;
      const operatorName = req.auth?.name || req.auth?.email || 'Recepción';
      const empIdVal = employee_id ? String(employee_id).trim() : null;
      const empNameVal = employee_name ? String(employee_name).trim() : null;

      const [result] = await pool.query(
        `INSERT INTO cash_register_movements (
           tenant_id, cash_register_id, type, payment_method, amount, amount_cents,
           concept, user_id, user_name, employee_id, employee_name, created_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         RETURNING id`,
        [tenantId, id, String(type).trim(), payment_method, numAmount, amountCents, finalConcept, operatorId, operatorName, empIdVal, empNameVal]
      );
      const movementId = result.insertId || result[0]?.id;

      // Sincronización automática: Gastos de caja diarios / Gastos imprevistos -> Egresos (con el mismo prefijo [Gasto Imprevisto])
      if (isUnexpectedExpense && movementId) {
        const branchRef = String(reg.branch_id || reg.salon_id || '');
        let branchName = '';
        if (branchRef) {
          const [bRows] = await pool.query(
            'SELECT name FROM branches WHERE id::text = ? AND tenant_id = ? LIMIT 1',
            [branchRef, tenantId]
          ).catch(() => [[]]);
          branchName = bRows?.[0]?.name || '';
        }
        await pool.query(
          `INSERT INTO expenses (
             tenant_id, salon_id, branch_id, salon_name,
             concept, concept_name, description, observation,
             category, amount, date, expense_date, payment_date,
             payment_method, account_name, reference, status, created_by, created_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Operativo', ?, CURRENT_DATE, CURRENT_DATE, CURRENT_DATE, ?, 'Caja Chica / Efectivo', ?, 'Registrado', ?, NOW())`,
          [
            tenantId,
            String(reg.salon_id || reg.branch_id || ''),
            branchRef,
            branchName,
            finalConcept,
            finalConcept,
            finalConcept,
            finalConcept,
            numAmount,
            payment_method || 'Efectivo',
            `CRM-${movementId}`,
            operatorName,
          ]
        ).catch((expErr) => {
          console.error('[CashRegister->Expenses] Error sincronizando gasto imprevisto a egresos:', expErr.message);
        });
      }

      // Préstamos a empleados: NO van a Egresos, se registran como descuento pendiente para Nómina
      if (isLoanMovement && empIdVal && /^\d+$/.test(empIdVal) && movementId) {
        await pool.query(
          `INSERT INTO employee_discounts (
             tenant_id, employee_id, employee_name, type, amount, discount_amount,
             date, notes, status, created_by, cash_register_movement_id, created_at
           )
           VALUES (?, ?, ?, 'Préstamo', ?, ?, CURRENT_DATE, ?, 'Pendiente', ?, ?, NOW())`,
          [tenantId, Number(empIdVal), empNameVal || 'Empleado', numAmount, numAmount, finalConcept, operatorName, movementId]
        ).catch((loanErr) => {
          console.error('[CashRegister->EmployeeDiscounts] Error registrando préstamo de empleado:', loanErr.message);
        });
      }

      res.json({
        success: true,
        id: movementId,
        message: 'Movimiento registrado correctamente'
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 7. Historial de cajas cerradas/abiertas del tenant autenticado (con scope de sucursal)
  router.get('/history', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { salon_id } = req.query;
      const scope = getBranchScope(req);
      let query = 'SELECT * FROM cash_registers WHERE tenant_id = ?';
      const params = [tenantId];

      if (!scope.allBranches) {
        if (salon_id && salon_id !== 'all') {
          if (!isBranchAuthorized(req, salon_id)) {
            return res.status(403).json({
              error: 'No tienes acceso autorizado a la sucursal solicitada.',
              code: 'BRANCH_ACCESS_DENIED'
            });
          }
          query += ' AND (salon_id::text = ? OR branch_id::text = ?)';
          params.push(String(salon_id), String(salon_id));
        } else {
          if (scope.branchIds.length === 0) return res.json([]);
          const placeholders = scope.branchIds.map(() => '?').join(', ');
          query += ` AND (branch_id::text IN (${placeholders}) OR salon_id::text IN (${placeholders}))`;
          params.push(...scope.branchIds, ...scope.branchIds);
        }
      } else if (salon_id && salon_id !== 'all') {
        query += ' AND (salon_id::text = ? OR branch_id::text = ?)';
        params.push(String(salon_id), String(salon_id));
      }

      query += ' ORDER BY opened_at DESC LIMIT 100';
      const [rows] = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 8. Facturas / visitas cobradas en una caja del tenant autenticado
  router.get('/:id/invoices', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      if (!isValidRegisterUuid(id)) {
        return res.status(400).json({ error: `Identificador de caja inválido ('${id}').`, code: 'INVALID_REGISTER_ID' });
      }
      const [regRows] = await pool.query('SELECT id, branch_id, salon_id FROM cash_registers WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      if (regRows.length === 0) {
        return res.status(404).json({ error: 'Caja no encontrada en esta empresa' });
      }
      if (!isBranchAuthorized(req, regRows[0].branch_id ?? regRows[0].salon_id)) {
        return res.status(403).json({ error: 'No tienes autorización para consultar las facturas de esta caja.', code: 'BRANCH_ACCESS_DENIED' });
      }
      const [rows] = await pool.query(`
        SELECT v.id, v.ticket_number, v.ticket_number as invoice_number, v.ncf, v.total, v.total_cents, v.metodo_pago, v.applied_payments, v.status, v.visited_at,
               COALESCE(c.nombre, v.client_name, 'Cliente General') as client_name
        FROM visits v
        LEFT JOIN clients c ON c.id::text = v.client_id::text AND c.tenant_id = v.tenant_id
        WHERE v.tenant_id = ? AND v.cash_register_id::text = ?
        ORDER BY v.visited_at DESC
        LIMIT 200
      `, [tenantId, String(id)]);
      res.json(rows || []);
    } catch (err) {
      console.error('Error fetching cash register invoices:', err);
      res.status(500).json({ error: 'Error consultando facturas de la caja' });
    }
  });

  return router;
}

module.exports = { createCashRegistersRouter };
