const express = require('express');
const nodemailer = require('nodemailer');

function createCashRegistersRouter(pool) {
  const router = express.Router();

  // HELPER CENTRALIZADO PARA CÁLCULO FINANCIERO Y ARQUEO DE CAJA
  function calculateRegisterFinancials(movements = [], initialAmt = 0) {
    let efectivoTotal = 0;
    let tarjetaTotal = 0;
    let transferenciaTotal = 0;
    let giftCardTotal = 0;
    let consumoTotal = 0;
    let planBeautyTotal = 0;
    let otrosTotal = 0;

    let gastosTotal = 0;
    let prestamosTotal = 0;
    let retirosTotal = 0;
    let entradasTotal = 0;

    const listaGastos = [];
    const listaPrestamos = [];
    const listaRetiros = [];
    const listaEntradas = [];
    const listaAnulaciones = [];
    let countVentas = 0;

    movements.forEach(m => {
      const rawAmt = Math.abs(Number(m.amount) || 0);
      const isSale = m.type === 'Ingreso_Venta';
      const isVoid = m.type === 'Anulacion_Venta';

      if (isSale || isVoid) {
        const sign = isVoid ? -1 : 1;
        const signedAmt = sign * rawAmt;

        if (isSale) countVentas++;
        if (isVoid) {
          countVentas = Math.max(0, countVentas - 1);
          listaAnulaciones.push({
            concept: m.concept || 'Factura Anulada',
            payment_method: m.payment_method || 'Efectivo',
            amount: rawAmt
          });
        }

        const method = (m.payment_method || '').toLowerCase();
        if (method.includes('mixto')) {
          let ef = 0, tj = 0, tr = 0;
          const efMatch = m.payment_method.match(/Efectivo:\s*RD\$\s*([\d,.]+)/i);
          const tjMatch = m.payment_method.match(/Tarjeta:\s*RD\$\s*([\d,.]+)/i);
          const trMatch = m.payment_method.match(/Transferencia:\s*RD\$\s*([\d,.]+)/i);
          if (efMatch) ef = parseFloat(efMatch[1].replace(/,/g, '')) || 0;
          if (tjMatch) tj = parseFloat(tjMatch[1].replace(/,/g, '')) || 0;
          if (trMatch) tr = parseFloat(trMatch[1].replace(/,/g, '')) || 0;
          if (ef === 0 && tj === 0 && tr === 0) {
            ef = rawAmt / 2;
            tj = rawAmt / 2;
          }
          efectivoTotal += (ef * sign);
          tarjetaTotal += (tj * sign);
          transferenciaTotal += (tr * sign);
        } else if (method.includes('efectivo')) {
          efectivoTotal += signedAmt;
        } else if (method.includes('tarjeta')) {
          tarjetaTotal += signedAmt;
        } else if (method.includes('transferencia')) {
          transferenciaTotal += signedAmt;
        } else if (method.includes('gift card') || method.includes('gift_card') || method.includes('gift')) {
          giftCardTotal += signedAmt;
        } else if (method.includes('consumo') || method.includes('nomina') || method.includes('nómina') || method.includes('empleado')) {
          consumoTotal += signedAmt;
        } else if (method.includes('plan beauty') || method.includes('plan_beauty') || method.includes('plan')) {
          planBeautyTotal += signedAmt;
        } else {
          otrosTotal += signedAmt;
        }
      } else if (m.type === 'Gasto_Imprevisto') {
        gastosTotal += rawAmt;
        listaGastos.push({ concept: m.concept || 'Gasto no especificado', amount: rawAmt });
      } else if (m.type === 'Prestamo_Empleado') {
        prestamosTotal += rawAmt;
        gastosTotal += rawAmt;
        listaPrestamos.push({
          employee_name: m.employee_name || 'Colaboradora',
          concept: m.concept || 'Adelanto de nómina',
          amount: rawAmt
        });
      } else if (m.type === 'Retiro_Efectivo') {
        retirosTotal += rawAmt;
        listaRetiros.push({ concept: m.concept || 'Retiro de caja', amount: rawAmt });
      } else if (m.type === 'Entrada_Adicional') {
        entradasTotal += rawAmt;
        listaEntradas.push({ concept: m.concept || 'Ingreso adicional', amount: rawAmt });
      }
    });

    const totalFacturado = efectivoTotal + tarjetaTotal + transferenciaTotal + giftCardTotal + consumoTotal + otrosTotal;
    const montoEsperado = initialAmt + efectivoTotal + entradasTotal - gastosTotal - retirosTotal;

    return {
      efectivoTotal,
      tarjetaTotal,
      transferenciaTotal,
      giftCardTotal,
      consumoTotal,
      planBeautyTotal,
      otrosTotal,
      totalFacturado,
      gastosTotal,
      prestamosTotal,
      retirosTotal,
      entradasTotal,
      montoEsperado,
      countVentas,
      listaGastos,
      listaPrestamos,
      listaRetiros,
      listaEntradas,
      listaAnulaciones
    };
  }

  async function syncRegisterInvoicesAndMovements(registerId) {
    try {
      if (!registerId) return;
      const [regs] = await pool.query('SELECT * FROM cash_registers WHERE id = ?', [registerId]);
      if (!regs.length) return;
      const reg = regs[0];

      const openedAt = reg.opened_at || reg.created_at;
      const closedAt = reg.closed_at;

      let query = `
        SELECT v.* FROM visits v 
        WHERE (
            v.cash_register_id = ? 
            OR (
              (v.cash_register_id IS NULL OR v.cash_register_id = 0) 
              AND v.visited_at >= ?
              ${closedAt ? 'AND v.visited_at <= ?' : ''}
              AND (v.salon_id = ? OR v.salon_id IS NULL)
            )
          )
      `;
      const params = closedAt ? [registerId, openedAt, closedAt, reg.salon_id] : [registerId, openedAt, reg.salon_id];
      const [visits] = await pool.query(query, params);

      for (const v of visits) {
        if (v.cash_register_id !== registerId && (v.status === 'Facturado' || v.status === 'Anulado')) {
          await pool.query('UPDATE visits SET cash_register_id = ? WHERE id = ?', [registerId, v.id]);
        }

        const [saleMovements] = await pool.query(
          "SELECT id FROM cash_register_movements WHERE cash_register_id = ? AND visit_id = ? AND type = 'Ingreso_Venta'",
          [registerId, v.id]
        );

        const visitTotal = parseFloat(v.total) || 0;
        const ticketNum = v.ticket_number || v.id;
        const clientName = v.client_name || 'Cliente';
        const method = v.metodo_pago || 'Efectivo';

        if (saleMovements.length === 0 && v.status === 'Facturado') {
          await pool.query(
            `INSERT INTO cash_register_movements (cash_register_id, type, payment_method, amount, concept, user_name, visit_id, created_at)
             VALUES (?, 'Ingreso_Venta', ?, ?, ?, ?, ?, ?)`,
            [
              registerId,
              method,
              visitTotal,
              `Factura ${ticketNum} - ${clientName}`,
              'Cajero',
              v.id,
              v.visited_at || new Date()
            ]
          );
        }

        // Si la visita fue anulada y existe el ingreso en esta caja pero no la anulación, registrar la anulación
        if (v.status === 'Anulado' && saleMovements.length > 0) {
          const [voidMovements] = await pool.query(
            "SELECT id FROM cash_register_movements WHERE cash_register_id = ? AND visit_id = ? AND type = 'Anulacion_Venta'",
            [registerId, v.id]
          );
          if (voidMovements.length === 0) {
            await pool.query(
              `INSERT INTO cash_register_movements (cash_register_id, type, payment_method, amount, concept, user_name, visit_id, created_at)
               VALUES (?, 'Anulacion_Venta', ?, ?, ?, ?, ?, ?)`,
              [
                registerId,
                method,
                -Math.abs(visitTotal),
                `Anulación Factura ${ticketNum} - ${v.void_reason || 'Anulación de cobro'}`,
                v.voided_by || 'Cajero',
                v.id,
                v.voided_at || new Date()
              ]
            );
          }
        }
      }
    } catch (err) {
      console.error('[SYNC REGISTER MOVEMENTS ERROR]:', err);
    }
  }

  // FUNCIÓN AUXILIAR PARA EL ENVÍO AUTOMÁTICO Y SILENCIOSO DEL CORREO DE CIERRE DE CAJA
  async function sendCashRegisterCloseSummaryEmail(registerId, observacionesCierre = '') {
    try {
      const escapeHtmlSafe = (str) => {
        if (!str) return '';
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      };

      const [regs] = await pool.query('SELECT * FROM cash_registers WHERE id = ?', [registerId]);
      if (!regs || regs.length === 0) return;
      const reg = regs[0];

      let salonName = 'Abatte Peluquería';
      if (reg.salon_id) {
        try {
          const [salons] = await pool.query('SELECT name FROM salons WHERE id = ? LIMIT 1', [reg.salon_id]);
          if (salons && salons.length > 0 && salons[0].name) {
            salonName = `Abatte Peluquería - ${salons[0].name}`;
          }
        } catch (sErr) {
          console.error('[SALON FETCH ERROR]:', sErr.message);
        }
      }

      const [movements] = await pool.query(
        'SELECT * FROM cash_register_movements WHERE cash_register_id = ? ORDER BY created_at ASC',
        [registerId]
      );

      const initialAmt = parseFloat(reg.monto_inicial) || 0;
      const stats = calculateRegisterFinancials(movements, initialAmt);

      const efectivoTotal = stats.efectivoTotal;
      const tarjetaTotal = stats.tarjetaTotal;
      const transferenciaTotal = stats.transferenciaTotal;
      const giftCardTotal = stats.giftCardTotal;
      const consumoTotal = stats.consumoTotal;
      const planBeautyTotal = stats.planBeautyTotal;
      const otrosTotal = stats.otrosTotal;
      const gastosTotal = stats.gastosTotal;
      const prestamosTotal = stats.prestamosTotal;
      const retirosTotal = stats.retirosTotal;
      const entradasTotal = stats.entradasTotal;
      const listaGastos = stats.listaGastos;
      const listaPrestamos = stats.listaPrestamos;
      const listaRetiros = stats.listaRetiros;
      const listaEntradas = stats.listaEntradas;
      const listaAnulaciones = stats.listaAnulaciones;
      const countVentas = stats.countVentas;

      const totalFacturado = stats.totalFacturado;
      const montoEsperado = stats.montoEsperado;
      const finalAmt = parseFloat(reg.monto_final) || 0;
      const diff = parseFloat(reg.diferencia) || (finalAmt - montoEsperado);

      const fmtRD = (num) => 'RD$ ' + Number(num || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      
      const formatDateDO = (dateVal) => {
        if (!dateVal) return 'N/A';
        return new Date(dateVal).toLocaleString('es-DO', {
          timeZone: 'America/Santo_Domingo',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
      };

      const openedStr = formatDateDO(reg.opened_at);
      const closedStr = formatDateDO(reg.closed_at || new Date());
      const dateTodayStr = new Date().toLocaleDateString('es-DO', { timeZone: 'America/Santo_Domingo' });

      let diffStatusHtml = '';
      if (Math.abs(diff) < 0.01) {
        diffStatusHtml = '<span style="color: #16a34a; font-weight: 800; background: #dcfce7; padding: 4px 10px; border-radius: 6px;">✅ CUADRADA EXACTA (RD$ 0.00)</span>';
      } else if (diff > 0) {
        diffStatusHtml = `<span style="color: #0284c7; font-weight: 800; background: #e0f2fe; padding: 4px 10px; border-radius: 6px;">➕ SOBRANTE: +${fmtRD(diff)}</span>`;
      } else {
        diffStatusHtml = `<span style="color: #dc2626; font-weight: 800; background: #fee2e2; padding: 4px 10px; border-radius: 6px;">⚠️ FALTANTE: -${fmtRD(Math.abs(diff))}</span>`;
      }

      const [settingsRows] = await pool.query('SELECT * FROM email_settings LIMIT 1');
      const s = (settingsRows && settingsRows.length > 0) ? settingsRows[0] : {};

      const transporter = nodemailer.createTransport({
        host: s.smtp_host || 'smtp.hostinger.com',
        port: parseInt(s.smtp_port) || 465,
        secure: s.smtp_secure === 1 || parseInt(s.smtp_port) === 465,
        auth: {
          user: s.smtp_user || 'hola@planbeautyrd.com',
          pass: s.smtp_pass || 'z5!CIiplZ'
        }
      });

      const targetEmail = 'abatte.etereas@gmail.com';
      const registerNum = reg.register_number || `CAJA-#${reg.id}`;
      const obsText = (observacionesCierre || reg.observaciones || '').trim();

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; color: #1e293b;">
          <div style="max-width: 650px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
            <div style="background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); color: #ffffff; padding: 30px 24px; text-align: center;">
              <h1 style="margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 1px; color: #f472b6;">ABATTE PELUQUERÍA</h1>
              <h2 style="margin: 6px 0 0 0; font-size: 15px; font-weight: 400; color: #cbd5e1;">Reporte Oficial de Cierre y Arqueo de Caja</h2>
            </div>
            <div style="padding: 24px;">
              <div style="background: #f1f5f9; border-radius: 12px; padding: 16px; margin-bottom: 20px; font-size: 13px; line-height: 1.6;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                  <tr>
                    <td style="padding: 4px 0; color: #64748b;"><strong>Caja N°:</strong></td>
                    <td style="padding: 4px 0; text-align: right; font-weight: 700; color: #0f172a;">${escapeHtmlSafe(registerNum)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #64748b;"><strong>Responsable / Cajera:</strong></td>
                    <td style="padding: 4px 0; text-align: right; font-weight: 700; color: #0f172a;">${escapeHtmlSafe(reg.employee_name || 'Recepción')}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #64748b;"><strong>Sucursal:</strong></td>
                    <td style="padding: 4px 0; text-align: right; color: #0f172a;">${escapeHtmlSafe(salonName)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #64748b;"><strong>Apertura:</strong></td>
                    <td style="padding: 4px 0; text-align: right; color: #0f172a;">${openedStr}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #64748b;"><strong>Cierre:</strong></td>
                    <td style="padding: 4px 0; text-align: right; color: #0f172a;">${closedStr}</td>
                  </tr>
                </table>
              </div>

              <!-- CARD 1: VENTAS POR MÉTODO -->
              <div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin-bottom: 20px;">
                <div style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; margin-bottom: 14px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px;">💳 Resumen de Ventas Facturadas (${countVentas} Transacciones Activas)</div>
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                  <tr style="border-bottom: 1px dashed #e2e8f0;">
                    <td style="padding: 6px 0;">💵 Efectivo Neto</td>
                    <td style="padding: 6px 0; text-align: right; font-weight: 600;">${fmtRD(efectivoTotal)}</td>
                  </tr>
                  <tr style="border-bottom: 1px dashed #e2e8f0;">
                    <td style="padding: 6px 0;">💳 Tarjeta / Verifone Neto</td>
                    <td style="padding: 6px 0; text-align: right; font-weight: 600;">${fmtRD(tarjetaTotal)}</td>
                  </tr>
                  <tr style="border-bottom: 1px dashed #e2e8f0;">
                    <td style="padding: 6px 0;">📲 Transferencia Neta</td>
                    <td style="padding: 6px 0; text-align: right; font-weight: 600;">${fmtRD(transferenciaTotal)}</td>
                  </tr>
                  ${giftCardTotal > 0 ? `
                  <tr style="border-bottom: 1px dashed #e2e8f0;">
                    <td style="padding: 6px 0;">🎁 Gift Card / Bono</td>
                    <td style="padding: 6px 0; text-align: right; font-weight: 600;">${fmtRD(giftCardTotal)}</td>
                  </tr>` : ''}
                  ${consumoTotal > 0 ? `
                  <tr style="border-bottom: 1px dashed #e2e8f0;">
                    <td style="padding: 6px 0;">👥 Consumo Nómina / Empleado</td>
                    <td style="padding: 6px 0; text-align: right; font-weight: 600;">${fmtRD(consumoTotal)}</td>
                  </tr>` : ''}
                  ${planBeautyTotal > 0 ? `
                  <tr style="border-bottom: 1px dashed #e2e8f0;">
                    <td style="padding: 6px 0;">💎 Plan Beauty (Canjes)</td>
                    <td style="padding: 6px 0; text-align: right; font-weight: 600;">${fmtRD(planBeautyTotal)}</td>
                  </tr>` : ''}
                  ${otrosTotal > 0 ? `
                  <tr style="border-bottom: 1px dashed #e2e8f0;">
                    <td style="padding: 6px 0;">🏷️ Otros Métodos</td>
                    <td style="padding: 6px 0; text-align: right; font-weight: 600;">${fmtRD(otrosTotal)}</td>
                  </tr>` : ''}
                  <tr style="border-top: 2px solid #0f172a; font-weight: 800; font-size: 15px;">
                    <td style="padding: 10px 0; color: #0f172a;">TOTAL FACTURADO EN TURNO</td>
                    <td style="padding: 10px 0; text-align: right; color: #be185d;">${fmtRD(totalFacturado)}</td>
                  </tr>
                </table>
              </div>

              <!-- CARD ANULACIONES SI EXISTEN -->
              ${listaAnulaciones.length > 0 ? `
              <div style="border: 1px solid #fecaca; background: #fff5f5; border-radius: 12px; padding: 18px; margin-bottom: 20px;">
                <div style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #991b1b; margin-bottom: 10px; border-bottom: 1px solid #fee2e2; padding-bottom: 6px;">🚫 Facturas Anuladas Descontadas (${listaAnulaciones.length})</div>
                <ul style="list-style: none; padding: 0; margin: 0; font-size: 13px;">
                  ${listaAnulaciones.map(a => `<li style="padding: 6px 10px; background: #ffffff; border-radius: 6px; margin-bottom: 6px; border-left: 3px solid #dc2626; display: flex; justify-content: space-between;"><span>${escapeHtmlSafe(a.concept)} (${escapeHtmlSafe(a.payment_method)})</span><span style="font-weight: 700; color: #dc2626;">-${fmtRD(a.amount)}</span></li>`).join('')}
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
                    <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #e11d48;">-${fmtRD(gastosTotal)}</td>
                  </tr>` : ''}
                  ${prestamosTotal > 0 ? `
                  <tr style="border-bottom: 1px dashed #e2e8f0;">
                    <td style="padding: 6px 0;">👥 Préstamos a Colaboradoras:</td>
                    <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #e11d48;">-${fmtRD(prestamosTotal)}</td>
                  </tr>` : ''}
                  ${retirosTotal > 0 ? `
                  <tr style="border-bottom: 1px dashed #e2e8f0;">
                    <td style="padding: 6px 0;">🏦 Retiros de Efectivo:</td>
                    <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #e11d48;">-${fmtRD(retirosTotal)}</td>
                  </tr>` : ''}
                  ${entradasTotal > 0 ? `
                  <tr style="border-bottom: 1px dashed #e2e8f0;">
                    <td style="padding: 6px 0;">➕ Entradas Adicionales:</td>
                    <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #16a34a;">+${fmtRD(entradasTotal)}</td>
                  </tr>` : ''}
                </table>

                ${listaPrestamos.length > 0 ? `
                  <div style="font-size: 12px; font-weight: 700; color: #64748b; margin: 10px 0 6px 0;">Detalle de Préstamos:</div>
                  <ul style="list-style: none; padding: 0; margin: 0; font-size: 13px;">
                    ${listaPrestamos.map(p => `<li style="padding: 6px 10px; background: #f8fafc; border-radius: 6px; margin-bottom: 6px; border-left: 3px solid #f43f5e; display: flex; justify-content: space-between;"><span><strong>${escapeHtmlSafe(p.employee_name)}</strong>: ${escapeHtmlSafe(p.concept)}</span><span style="font-weight: 700; color: #be185d;">${fmtRD(p.amount)}</span></li>`).join('')}
                  </ul>
                ` : ''}

                ${listaGastos.length > 0 ? `
                  <div style="font-size: 12px; font-weight: 700; color: #64748b; margin: 10px 0 6px 0;">Detalle de Gastos:</div>
                  <ul style="list-style: none; padding: 0; margin: 0; font-size: 13px;">
                    ${listaGastos.map(g => `<li style="padding: 6px 10px; background: #f8fafc; border-radius: 6px; margin-bottom: 6px; border-left: 3px solid #e11d48; display: flex; justify-content: space-between;"><span>${escapeHtmlSafe(g.concept)}</span><span style="font-weight: 700; color: #e11d48;">${fmtRD(g.amount)}</span></li>`).join('')}
                  </ul>
                ` : ''}
              </div>` : ''}

              <!-- CARD 3: ARQUEO DE EFECTIVO -->
              <div style="background: #fdf2f8; border: 1px solid #fbcfe8; border-radius: 12px; padding: 18px; margin-bottom: 20px;">
                <div style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #9d174d; margin-bottom: 14px; border-bottom: 1px solid #fbcfe8; padding-bottom: 8px;">💵 Cuadre y Arqueo de Efectivo Físico</div>
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                  <tr>
                    <td style="padding: 5px 0;">(+) Fondo Inicial de Caja:</td>
                    <td style="padding: 5px 0; text-align: right; font-weight: 600;">${fmtRD(initialAmt)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 5px 0;">(+) Ventas Netas en Efectivo:</td>
                    <td style="padding: 5px 0; text-align: right; font-weight: 600;">+${fmtRD(efectivoTotal)}</td>
                  </tr>
                  ${entradasTotal > 0 ? `
                  <tr>
                    <td style="padding: 5px 0;">(+) Entradas Adicionales:</td>
                    <td style="padding: 5px 0; text-align: right; font-weight: 600; color: #16a34a;">+${fmtRD(entradasTotal)}</td>
                  </tr>` : ''}
                  ${(gastosTotal + prestamosTotal) > 0 ? `
                  <tr>
                    <td style="padding: 5px 0;">(-) Gastos y Préstamos:</td>
                    <td style="padding: 5px 0; text-align: right; font-weight: 600; color: #e11d48;">-${fmtRD(gastosTotal + prestamosTotal)}</td>
                  </tr>` : ''}
                  ${retirosTotal > 0 ? `
                  <tr>
                    <td style="padding: 5px 0;">(-) Retiros de Efectivo:</td>
                    <td style="padding: 5px 0; text-align: right; font-weight: 600; color: #e11d48;">-${fmtRD(retirosTotal)}</td>
                  </tr>` : ''}
                  <tr style="border-top: 1px solid #f472b6; font-weight: 700;">
                    <td style="padding: 8px 0; color: #475569;">(=) EFECTIVO ESPERADO EN CAJA:</td>
                    <td style="padding: 8px 0; text-align: right; color: #0f172a; font-size: 14px;">${fmtRD(montoEsperado)}</td>
                  </tr>
                  <tr style="border-top: 2px solid #be185d; font-weight: 800; font-size: 15px;">
                    <td style="padding: 8px 0; color: #0f172a;">(💵) EFECTIVO DECLARADO (CONTADO):</td>
                    <td style="padding: 8px 0; text-align: right; color: #0f172a;">${fmtRD(finalAmt)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0;">Resultado del Cuadre:</td>
                    <td style="padding: 8px 0; text-align: right;">${diffStatusHtml}</td>
                  </tr>
                </table>
              </div>

              <!-- CARD 4: OBSERVACIONES -->
              ${obsText ? `
                <div style="background: #fffbeb; border: 1px solid #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 8px; font-size: 13px; color: #92400e;">
                  <strong>📝 Observaciones registradas por la recepcionista:</strong><br/>
                  <span style="font-style: italic;">"${escapeHtmlSafe(obsText)}"</span>
                </div>
              ` : `
                <div style="font-size: 12px; color: #94a3b8; font-style: italic; text-align: center; margin-top: 10px;">
                  Sin observaciones adicionales registradas en el cierre.
                </div>
              `}
            </div>
            <div style="background: #f8fafc; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
              Enviado automáticamente por el Sistema POS & Gestión Salon Pro / Plan Beauty RD.<br/>
              Este correo es confidencial y para control administrativo interno.
            </div>
          </div>
        </body>
        </html>
      `;

      const mailOptions = {
        from: `"${s.smtp_from || 'Plan Beauty'}" <${s.smtp_user || 'hola@planbeautyrd.com'}>`,
        to: targetEmail,
        subject: `📊 Cierre de Caja #${registerNum} (${dateTodayStr}) - ${reg.employee_name || 'Recepción'} [${fmtRD(totalFacturado)}]`,
        html: htmlContent
      };

      console.log(`[SILENT CASH REGISTER CLOSE EMAIL] Enviando reporte de caja #${registerNum} a ${targetEmail}...`);
      const info = await transporter.sendMail(mailOptions);
      console.log(`[SILENT CASH REGISTER CLOSE EMAIL SUCCESS] Correo enviado a ${targetEmail}. MessageId: ${info.messageId}`);
    } catch (emailErr) {
      console.error('[SILENT CASH REGISTER CLOSE EMAIL ERROR]:', emailErr);
    }
  }

  // --- ROUTES ---

  router.get('/active', async (req, res) => {
    try {
      const { salon_id } = req.query;
      const [rows] = await pool.query(
        `SELECT cr.*, COALESCE(s.name, 'Sucursal San Vicente de Paúl') as salon_name 
         FROM cash_registers cr 
         LEFT JOIN salons s ON cr.salon_id = s.id 
         WHERE cr.salon_id = ? AND cr.status = 'Abierta' 
         ORDER BY cr.opened_at DESC LIMIT 1`,
        [salon_id || 1]
      );
      res.json(rows[0] || null);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/open', async (req, res) => {
    try {
      const { salon_id, employee_id, employee_name, monto_inicial } = req.body;
      // Check if open register exists for this salon
      const [existing] = await pool.query(
        `SELECT cr.*, COALESCE(s.name, 'Sucursal San Vicente de Paúl') as salon_name 
         FROM cash_registers cr 
         LEFT JOIN salons s ON cr.salon_id = s.id 
         WHERE cr.salon_id = ? AND cr.status = 'Abierta'`,
        [salon_id || 1]
      );
      if (existing.length > 0) {
        return res.json({ success: true, register: existing[0], message: 'Existe una caja abierta para esta jornada' });
      }

      // Unique Register Numbering format: CAJA-SD-YYYYMMDD-XXXX
      const dateCode = new Date().toISOString().slice(0,10).replace(/-/g,'');
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      const regNum = `CAJA-SD-${dateCode}-${randomSuffix}`;

      const [result] = await pool.query(
        "INSERT INTO cash_registers (register_number, employee_id, employee_name, salon_id, monto_inicial, opened_at, status) VALUES (?, ?, ?, ?, ?, NOW(), 'Abierta')",
        [regNum, employee_id || 'SYS', employee_name || 'Cajero', salon_id || 1, monto_inicial || 0.00]
      );

      const [newReg] = await pool.query(
        `SELECT cr.*, COALESCE(s.name, 'Sucursal San Vicente de Paúl') as salon_name 
         FROM cash_registers cr 
         LEFT JOIN salons s ON cr.salon_id = s.id 
         WHERE cr.id = ?`,
        [result.insertId]
      );

      res.json({ success: true, register: newReg[0], registerId: result.insertId, registerNumber: regNum });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:id/close', async (req, res) => {
    try {
      const { id } = req.params;
      const { monto_final, observaciones } = req.body;

      await syncRegisterInvoicesAndMovements(id);

      const [regs] = await pool.query('SELECT * FROM cash_registers WHERE id = ?', [id]);
      if (regs.length === 0) return res.status(404).json({ error: 'Caja no encontrada' });
      const reg = regs[0];

      const [movements] = await pool.query(
        'SELECT * FROM cash_register_movements WHERE cash_register_id = ?',
        [id]
      );

      const initialAmt = parseFloat(reg.monto_inicial) || 0;
      const stats = calculateRegisterFinancials(movements, initialAmt);

      const montoEsperado = stats.montoEsperado;
      const finalAmt = parseFloat(monto_final) || 0;
      const diff = finalAmt - montoEsperado;

      if (diff < -0.01) {
        return res.status(400).json({
          error: `⛔ NO SE PUEDE CERRAR LA CAJA CON UN FALTANTE DE EFECTIVO.\n\nEfectivo esperado: RD$ ${montoEsperado.toLocaleString('es-DO', { minimumFractionDigits: 2 })}\nEfectivo contado: RD$ ${finalAmt.toLocaleString('es-DO', { minimumFractionDigits: 2 })}\nFaltante: - RD$ ${Math.abs(diff).toLocaleString('es-DO', { minimumFractionDigits: 2 })}.\n\nPor favor revise los movimientos o cuadre la caja antes de cerrar.`
        });
      }

      await pool.query(
        `UPDATE cash_registers SET 
          status = 'Cerrada', 
          closed_at = NOW(), 
          monto_esperado = ?, 
          monto_final = ?, 
          gastos_turno = ?, 
          diferencia = ?, 
          observaciones = ? 
         WHERE id = ?`,
        [montoEsperado, finalAmt, stats.gastosTotal, diff, observaciones || '', id]
      );

      // REGISTRAR AUTOMÁTICAMENTE PRÉSTAMOS A EMPLEADAS COMO DESCUENTO EN NÓMINA
      let prestamosRegistrados = 0;
      try {
        const prestamoMovements = movements.filter(m => m.type === 'Prestamo_Empleado' && (Number(m.amount) > 0));
        for (const p of prestamoMovements) {
          let empId = p.employee_id ? parseInt(p.employee_id, 10) : null;
          let empName = p.employee_name;

          if (!empId && empName) {
            const [matched] = await pool.query('SELECT id, nombre FROM staff_records WHERE nombre = ? LIMIT 1', [empName.trim()]);
            if (matched && matched.length > 0) {
              empId = matched[0].id;
              empName = matched[0].nombre;
            }
          }

          if (empId) {
            const [existing] = await pool.query(
              `SELECT id FROM employee_discounts 
               WHERE (cash_register_movement_id = ? AND cash_register_movement_id IS NOT NULL) 
                  OR (employee_id = ? AND notes LIKE ? AND date = CURDATE())`,
              [p.id, empId, `%[Caja #${reg.register_number || id}%`]
            );

            if (!existing || existing.length === 0) {
              const noteDesc = `[Caja #${reg.register_number || id}] Préstamo de caja: ${p.concept || 'Adelanto registrado en cierre'}`;
              await pool.query(
                `INSERT INTO employee_discounts (employee_id, employee_name, type, amount, date, notes, status, created_by, cash_register_movement_id, created_at)
                 VALUES (?, ?, 'Prestamo', ?, CURDATE(), ?, 'Pendiente', ?, ?, NOW())`,
                [empId, empName || 'Colaborador', p.amount, noteDesc, reg.employee_name || 'Cierre de Caja', p.id]
              );
              prestamosRegistrados++;
            }
          }
        }
      } catch (discErr) {
        console.error('[CLOSE CASH REGISTER - PRESTAMO DISCOUNT SYNC ERROR]:', discErr);
      }

      // ENVÍO SILENCIOSO DEL RESUMEN DE CIERRE DE CAJA POR CORREO
      sendCashRegisterCloseSummaryEmail(id, observaciones).catch(emailErr => {
        console.error('[BACKGROUND CLOSE CASH EMAIL ERROR]:', emailErr);
      });

      res.json({
        success: true,
        message: 'Caja cerrada y arqueada exitosamente',
        summary: {
          montoEsperado,
          montoDeclarado: finalAmt,
          diferencia: diff,
          gastosTotal: stats.gastosTotal,
          prestamosRegistrados
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:id/movements', async (req, res) => {
    try {
      const { id } = req.params;
      await syncRegisterInvoicesAndMovements(id);
      const [movements] = await pool.query(
        'SELECT * FROM cash_register_movements WHERE cash_register_id = ? ORDER BY created_at DESC',
        [id]
      );

      const [regRows] = await pool.query('SELECT monto_inicial FROM cash_registers WHERE id = ?', [id]);
      const montoInicial = regRows[0] ? Number(regRows[0].monto_inicial) : 0;

      const stats = calculateRegisterFinancials(movements, montoInicial);

      res.json({
        movements,
        summary: {
          montoInicial,
          efectivoTotal: stats.efectivoTotal,
          tarjetaTotal: stats.tarjetaTotal,
          transferenciaTotal: stats.transferenciaTotal,
          giftCardTotal: stats.giftCardTotal,
          consumoTotal: stats.consumoTotal,
          planBeautyTotal: stats.planBeautyTotal,
          otrosTotal: stats.otrosTotal,
          gastosTotal: stats.gastosTotal,
          prestamosTotal: stats.prestamosTotal,
          retirosTotal: stats.retirosTotal,
          entradasTotal: stats.entradasTotal,
          montoEstimadoEnCaja: stats.montoEsperado
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:id/movements', async (req, res) => {
    try {
      const { id } = req.params;
      const { type, amount, concept, user_id, user_name, payment_method, employee_id, employee_name } = req.body;

      if (!type || !amount || Number(amount) <= 0) {
        return res.status(400).json({ error: 'Tipo y monto válido son requeridos.' });
      }

      try {
        const [result] = await pool.query(
          `INSERT INTO cash_register_movements (cash_register_id, type, payment_method, amount, concept, user_id, user_name, employee_id, employee_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [id, type, payment_method || 'Efectivo', amount, concept || '', user_id || 'SYS', user_name || 'Cajero', employee_id || null, employee_name || null]
        );
        res.json({ success: true, movementId: result.insertId, message: 'Movimiento registrado exitosamente' });
      } catch (colErr) {
        const [result] = await pool.query(
          `INSERT INTO cash_register_movements (cash_register_id, type, payment_method, amount, concept, user_id, user_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          [id, type, payment_method || 'Efectivo', amount, concept || '', user_id || 'SYS', user_name || 'Cajero']
        );
        res.json({ success: true, movementId: result.insertId, message: 'Movimiento registrado exitosamente' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:id/invoices', async (req, res) => {
    try {
      const { id } = req.params;
      await syncRegisterInvoicesAndMovements(id);
      const [reg] = await pool.query('SELECT * FROM cash_registers WHERE id = ?', [id]);
      if (!reg.length) return res.status(404).json({ error: 'Caja no encontrada' });

      const [visits] = await pool.query(`
        SELECT v.*, COALESCE(s.name, 'Sucursal San Vicente de Paúl') as salon_name 
        FROM visits v 
        LEFT JOIN salons s ON v.salon_id = s.id 
        WHERE (v.cash_register_id = ? OR v.id IN (SELECT DISTINCT visit_id FROM cash_register_movements WHERE cash_register_id = ?))
        ORDER BY v.visited_at DESC
      `, [id, id]);

      res.json(visits);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/', async (req, res) => {
    try {
      const { salon_id, status, start_date, end_date } = req.query;
      let query = `
        SELECT cr.*, COALESCE(s.name, 'Sucursal San Vicente de Paúl') as salon_name 
        FROM cash_registers cr 
        LEFT JOIN salons s ON cr.salon_id = s.id 
        WHERE 1=1
      `;
      const params = [];
      if (salon_id && salon_id !== 'all') {
        query += ' AND cr.salon_id = ?';
        params.push(salon_id);
      }
      if (status && status !== 'all') {
        query += ' AND cr.status = ?';
        params.push(status);
      }
      if (start_date && end_date) {
        query += ' AND cr.opened_at BETWEEN ? AND ?';
        params.push(`${start_date} 00:00:00`, `${end_date} 23:59:59`);
      }
      query += ' ORDER BY cr.opened_at DESC LIMIT 100';

      const [registers] = await pool.query(query, params);

      // Enrich with calculated stats for each register
      const enriched = await Promise.all(registers.map(async (reg) => {
        if (reg.status === 'Abierta') {
          await syncRegisterInvoicesAndMovements(reg.id);
        }
        const [movements] = await pool.query(
          'SELECT type, payment_method, amount FROM cash_register_movements WHERE cash_register_id = ?',
          [reg.id]
        );

        const montoInicial = Number(reg.monto_inicial) || 0;
        const stats = calculateRegisterFinancials(movements, montoInicial);

        return {
          ...reg,
          total_ventas: stats.totalFacturado,
          efectivo_total: stats.efectivoTotal,
          tarjeta_total: stats.tarjetaTotal,
          transferencia_total: stats.transferenciaTotal,
          gift_card_total: stats.giftCardTotal,
          consumo_total: stats.consumoTotal,
          plan_beauty_total: stats.planBeautyTotal,
          gastos_total: stats.gastosTotal,
          retiros_total: stats.retirosTotal,
          entradas_total: stats.entradasTotal,
          monto_esperado: Number(reg.monto_esperado) || stats.montoEsperado,
          count_invoices: stats.countVentas
        };
      }));

      res.json(enriched);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = {
  createCashRegistersRouter
};
