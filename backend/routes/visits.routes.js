const express = require('express');
const crypto = require('crypto');

/**
 * Creates the Visits and POS Ticketing Router
 * 
 * @param {import('mysql2/promise').Pool} pool 
 * @param {Object} deps
 * @param {Function} deps.transmitInvoiceDirectlyToDgii
 * @param {Function} deps.generateAndTransmitNotaCredito
 * @param {Function} deps.sendSurveyEmail
 */
function createVisitsRouter(pool, deps = {}) {
  const router = express.Router();
  const { transmitInvoiceDirectlyToDgii, generateAndTransmitNotaCredito, sendSurveyEmail } = deps;

  // Monotonic Ticket Sequence Generator (Never repeats or reuses numbers when tickets are deleted/cancelled)
  const getNextTicketNumber = async (salonId = 1, prefix = 'SD') => {
    const sId = parseInt(salonId) || 1;

    try {
      // 1. Ensure record exists in ticket_sequences
      await pool.query(`
        INSERT INTO ticket_sequences (salon_id, prefix, last_sequence)
        VALUES (?, ?, 0)
        ON DUPLICATE KEY UPDATE prefix = VALUES(prefix)
      `, [sId, prefix]);

      // 2. Find maximum numeric sequence in visits table to prevent collision with historical records
      const [maxRows] = await pool.query(
        `SELECT MAX(CAST(SUBSTRING_INDEX(ticket_number, '-', -1) AS UNSIGNED)) as max_num 
         FROM visits 
         WHERE salon_id = ? AND ticket_number LIKE ?`,
        [sId, `${prefix}-%`]
      );
      const maxInVisits = Number(maxRows[0]?.max_num) || 0;

      // 3. Get current sequence from ticket_sequences
      const [seqRows] = await pool.query('SELECT last_sequence FROM ticket_sequences WHERE salon_id = ?', [sId]);
      let currentSeq = Number(seqRows[0]?.last_sequence) || 0;

      let nextSeq = Math.max(currentSeq, maxInVisits) + 1;

      // 4. Update sequence table monotonically
      await pool.query('UPDATE ticket_sequences SET last_sequence = ? WHERE salon_id = ?', [nextSeq, sId]);

      return `${prefix}-${String(nextSeq).padStart(4, '0')}`;
    } catch (err) {
      console.error('[TICKET SEQUENCE ERROR]:', err);
      return `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
    }
  };

  // Robust visit commissions processor for assigned employees
  async function processVisitCommissions(visitId, itemsDetail, ticketNumber = null, createdAt = null) {
    try {
      let items = itemsDetail;
      if (typeof items === 'string') {
        try { items = JSON.parse(items); } catch(e) { items = []; }
      }
      if (!Array.isArray(items) || items.length === 0) return;

      let ticketNum = ticketNumber;
      if (!ticketNum) {
        const [vRows] = await pool.query('SELECT ticket_number, visited_at FROM visits WHERE id = ?', [visitId]);
        ticketNum = vRows[0]?.ticket_number || `TK-${visitId}`;
        if (!createdAt && vRows[0]?.visited_at) createdAt = vRows[0].visited_at;
      }

      for (const item of items) {
        // 1. Identify employee by id or name
        let empId = item.empleado_id || item.employee_id || item.empleado || item.employee;
        let empName = item.empleado_nombre || item.employee_name || item.empleado || item.employee || '';

        if (!empId && !empName) continue;
        if (empId === 'N/A' || empName === 'N/A') continue;

        const cleanEmpId = empId ? String(empId).replace('EMP-', '').replace('COMM-', '').trim() : '';

        const [empRows] = await pool.query(
          'SELECT id, nombre, localidad, salon_id, commission_scheme_id FROM staff_records WHERE id = ? OR id = ? OR nombre = ? LIMIT 1',
          [cleanEmpId || 0, empId || 0, empName || '']
        );

        let empLocalidad = '';
        let schemeId = null;

        if (empRows.length > 0) {
          empId = empRows[0].id;
          empName = empRows[0].nombre;
          empLocalidad = empRows[0].localidad || '';
          schemeId = empRows[0].commission_scheme_id || null;
        }

        if (!empId) continue;

        const rawServiceName = item.nombre || item.servicio || item.name || item.service_name || item.descripcion || item.description || 'Servicio';
        const cleanServiceName = rawServiceName.replace(/\s*\(Plan Beauty\)/i, '').replace(/\s*\(Adicional\)/i, '').trim();
        const serviceName = rawServiceName;

        // REGLA CRÍTICA: Si el empleado no tiene un esquema de comisiones asignado, NO se le calcula comisión
        if (!schemeId || isNaN(parseInt(schemeId, 10)) || parseInt(schemeId, 10) <= 0) {
          await pool.query(
            'DELETE FROM employee_commissions_log WHERE visit_id = ? AND employee_id = ? AND service_name = ? AND status = "Pendiente"',
            [visitId, empId, serviceName]
          );
          continue;
        }

        // Verificar que el esquema asignado exista y esté activo
        const [schemeInfo] = await pool.query(
          'SELECT id, nombre, estado FROM commission_schemes WHERE id = ?',
          [schemeId]
        );
        if (schemeInfo.length === 0 || schemeInfo[0].estado === 'Inactivo') {
          await pool.query(
            'DELETE FROM employee_commissions_log WHERE visit_id = ? AND employee_id = ? AND service_name = ? AND status = "Pendiente"',
            [visitId, empId, serviceName]
          );
          continue;
        }
        const schemeName = schemeInfo[0].nombre || 'Esquema';

        const price = parseFloat(item.precioAplicado !== undefined ? item.precioAplicado : (item.precio || item.precioBase || 0));
        const qty = parseInt(item.cantidad) || 1;
        const desc = parseFloat(item.descuento) || 0;

        // Calculate price after line discounts
        const finalLinePrice = Math.max(0, (price * qty) - desc);

        // Exclude ITBIS (18%) from base amount if applicable
        const appliesItbis = item.aplica_itbis === 1 || item.aplica_itbis === true;
        let baseAmt = finalLinePrice;
        if (appliesItbis && finalLinePrice > 0) {
          baseAmt = parseFloat((finalLinePrice / 1.18).toFixed(2));
        }

        let commissionType = 'Porcentaje';
        let commissionVal = 0.00;
        let ruleDesc = '';

        // Fetch service details (category)
        const [srvRows] = await pool.query(
          'SELECT categoria, genera_comision FROM services WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)) OR LOWER(TRIM(nombre)) = LOWER(TRIM(?)) OR id = ? LIMIT 1',
          [cleanServiceName, rawServiceName, item.service_id || '']
        );
        const srvData = srvRows[0] || {};
        const serviceCategory = (srvData.categoria || '').trim();

        if (srvData.genera_comision === 0) {
          commissionVal = 0;
          ruleDesc = 'Servicio no genera comisión';
        } else {
          const [schemeRules] = await pool.query(
            'SELECT * FROM commission_scheme_rules WHERE scheme_id = ? ORDER BY prioridad ASC, id ASC',
            [schemeId]
          );

          let ruleFound = false;

          // Prioridad 1: Regla específica por Servicio dentro del esquema del empleado
          const serviceRule = schemeRules.find(r => 
            r.rule_type === 'servicio' && 
            r.service_name && 
            (r.service_name.toLowerCase().trim() === cleanServiceName.toLowerCase().trim() || 
             r.service_name.toLowerCase().trim() === rawServiceName.toLowerCase().trim())
          );

          if (serviceRule) {
            commissionType = serviceRule.tipo_calculo === 'Monto_Fijo' ? 'Monto_Fijo' : 'Porcentaje';
            commissionVal = parseFloat(serviceRule.valor) || 0;
            ruleDesc = `Esquema (${schemeName}) - Servicio: ${serviceRule.service_name}`;
            ruleFound = true;
          }

          // Prioridad 2: Regla por Categoría dentro del esquema del empleado
          if (!ruleFound && serviceCategory) {
            const catRule = schemeRules.find(r => 
              r.rule_type === 'categoria' && 
              r.category_name && 
              (r.category_name.toLowerCase().trim() === serviceCategory.toLowerCase().trim())
            );
            if (catRule) {
              commissionType = catRule.tipo_calculo === 'Monto_Fijo' ? 'Monto_Fijo' : 'Porcentaje';
              commissionVal = parseFloat(catRule.valor) || 0;
              ruleDesc = `Esquema (${schemeName}) - Categoría: ${serviceCategory}`;
              ruleFound = true;
            }
          }

          // Prioridad 3: Regla General del Esquema
          if (!ruleFound) {
            const generalRule = schemeRules.find(r => 
              r.rule_type === 'general' || 
              (r.rule_type === 'categoria' && (r.category_name?.toLowerCase() === 'general' || r.category_name?.toLowerCase() === 'todos'))
            );
            if (generalRule) {
              commissionType = generalRule.tipo_calculo === 'Monto_Fijo' ? 'Monto_Fijo' : 'Porcentaje';
              commissionVal = parseFloat(generalRule.valor) || 0;
              ruleDesc = `Esquema (${schemeName}) - Regla General (${generalRule.valor}%)`;
              ruleFound = true;
            }
          }

          // Si el servicio no coincide con ninguna regla del esquema
          if (!ruleFound) {
            commissionVal = 0;
            ruleDesc = `Sin regla en esquema (${schemeName})`;
          }
        }

        let earnedCommission = 0;
        if (commissionVal > 0) {
          if (commissionType === 'Porcentaje') {
            earnedCommission = (baseAmt * commissionVal) / 100;
          } else {
            earnedCommission = commissionVal * qty;
          }
          earnedCommission = parseFloat(Number(earnedCommission).toFixed(2));
        }

        if (earnedCommission > 0) {
          const [existingLog] = await pool.query(
            'SELECT id, status, monto_comision, rule_applied_description, comision_valor FROM employee_commissions_log WHERE visit_id = ? AND employee_id = ? AND service_name = ?',
            [visitId, empId, serviceName]
          );

          if (existingLog.length === 0) {
            await pool.query(
              `INSERT INTO employee_commissions_log 
                (visit_id, ticket_number, employee_id, employee_name, service_name, precio_servicio, cantidad, descuento_aplicado, monto_base, tipo_comision, comision_valor, monto_comision, status, localidad, scheme_id, rule_applied_description, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?, ?, ?)`,
              [visitId, ticketNum, empId, empName, serviceName, price, qty, desc, baseAmt, commissionType, commissionVal, earnedCommission, empLocalidad, schemeId, ruleDesc, createdAt || new Date()]
            );
          } else if (existingLog[0].status === 'Pendiente') {
            const currentLog = existingLog[0];
            if (Number(currentLog.monto_comision) !== earnedCommission || currentLog.rule_applied_description !== ruleDesc || currentLog.comision_valor !== commissionVal) {
              await pool.query(
                `UPDATE employee_commissions_log SET 
                  tipo_comision = ?, 
                  comision_valor = ?, 
                  monto_comision = ?, 
                  monto_base = ?, 
                  scheme_id = ?, 
                  rule_applied_description = ? 
                 WHERE id = ?`,
                [commissionType, commissionVal, earnedCommission, baseAmt, schemeId, ruleDesc, currentLog.id]
              );
            }
          }
        } else {
          await pool.query(
            'DELETE FROM employee_commissions_log WHERE visit_id = ? AND employee_id = ? AND service_name = ? AND status = "Pendiente"',
            [visitId, empId, serviceName]
          );
        }
      }
    } catch (err) {
      console.error('[PROCESS VISIT COMMISSIONS ERROR]:', err);
    }
  }

  // Helper to atomically allocate the next DGII e-NCF sequence for an invoice/visit
  async function assignDgiiSequenceToVisit(visitId, requestedType = null, clientRnc = null, clientRazonSocial = null, totalAmount = 0, metodoPago = 'Efectivo') {
    try {
      const hasFiscalRnc = clientRnc && String(clientRnc).trim().length >= 9;
      const isTargetFiscal = (requestedType === 'E31' || requestedType === 'CREDITO_FISCAL' || hasFiscalRnc);
      const isPureCash = (metodoPago === 'Efectivo' || metodoPago === 'CASH' || metodoPago === 'efectivo');

      const isPlanRedemption = (
        (metodoPago && (metodoPago.toLowerCase().includes('plan') || metodoPago.toLowerCase().includes('canje') || metodoPago.toLowerCase().includes('membresía') || metodoPago.toLowerCase().includes('membresia'))) ||
        Number(totalAmount || 0) <= 0 ||
        requestedType === 'NONE' || requestedType === 'SIN_COMPROBANTE'
      ) && !isTargetFiscal;

      if (isPlanRedemption) {
        console.log(`ℹ️ [DGII CANJE PLAN BEAUTY]: Visita ${visitId} por RD$ ${totalAmount} con método '${metodoPago}' registrada SIN comprobante fiscal.`);
        await pool.query(
          "UPDATE visits SET ncf = NULL, ncf_type = 'NONE', ncf_name = 'Sin Comprobante Fiscal', codigo_seguridad_ecf = NULL, qr_code_url = NULL WHERE id = ?",
          [visitId]
        );
        return null;
      }

      if (!isTargetFiscal && isPureCash) {
        try {
          await pool.query('UPDATE company_ncf_counters SET cash_counter = cash_counter + 1 WHERE id = 1');
          const [counterRows] = await pool.query('SELECT cash_counter, cash_ratio FROM company_ncf_counters WHERE id = 1');
          const count = counterRows[0]?.cash_counter || 1;
          const ratio = counterRows[0]?.cash_ratio || 4;

          if (count % ratio === 0) {
            console.log(`ℹ️ [DGII CASH COUNTER]: Factura en Efectivo #${count} emitida SIN comprobante fiscal según regla 1 de cada ${ratio}.`);
            await pool.query(
              "UPDATE visits SET ncf = NULL, ncf_type = 'NONE', ncf_name = 'Sin Comprobante Fiscal', codigo_seguridad_ecf = NULL, qr_code_url = NULL WHERE id = ?",
              [visitId]
            );
            return null;
          }
        } catch (counterErr) {
          console.warn('⚠️ [DGII CASH COUNTER WARNING]:', counterErr.message);
        }
      }

      const targetType = (requestedType || (clientRnc ? 'E31' : 'E32')).toUpperCase();
      
      const [batches] = await pool.query(
        `SELECT * FROM dgii_ncf_sequences 
         WHERE estado = 'Activo' AND cantidad_usada < cantidad_aprobada 
         ORDER BY (tipo_comprobante = ?) DESC, (tipo_comprobante = 'E32') DESC, (tipo_comprobante = 'E31') DESC, id ASC 
         LIMIT 1`,
        [targetType]
      );

      if (batches.length === 0) {
        console.warn('[DGII NCF] No hay secuencias e-NCF activas con saldo disponible en dgii_ncf_sequences.');
        return null;
      }

      const seq = batches[0];
      const prefix = seq.tipo_comprobante || seq.numero_desde.slice(0, 3);
      const rawSeqStr = seq.numero_desde.slice(prefix.length);
      const startNum = parseInt(rawSeqStr, 10) || 1;
      const currentAssignedNum = startNum + seq.cantidad_usada;
      const encfNumber = prefix + String(currentAssignedNum).padStart(10, '0');

      const newCantidadUsada = seq.cantidad_usada + 1;
      const newSecuenciaActual = currentAssignedNum;
      const newEstado = newCantidadUsada >= seq.cantidad_aprobada ? 'Agotado' : 'Activo';

      await pool.query(
        `UPDATE dgii_ncf_sequences 
         SET cantidad_usada = ?, secuencia_actual = ?, estado = ?, updated_at = NOW() 
         WHERE id = ?`,
        [newCantidadUsada, newSecuenciaActual, newEstado, seq.id]
      );

      const securityCode = crypto.randomBytes(3).toString('hex').toUpperCase();
      const emisorRnc = '131917038';
      const totalFormatted = Number(totalAmount || 0).toFixed(2);
      const qrUrl = seq.tipo_comprobante === 'E32'
        ? `https://fc.dgii.gov.do/eCF/ConsultaTimbreFC?RncEmisor=${emisorRnc}&ENCF=${encfNumber}&MontoTotal=${totalFormatted}&CodigoSeguridad=${securityCode}`
        : `https://fc.dgii.gov.do/eCF/ConsultaTimbre?RncEmisor=${emisorRnc}&RncComprador=${clientRnc || ''}&ENCF=${encfNumber}&MontoTotal=${totalFormatted}&FechaEmision=02-10-2026&FechaFirma=02-10-2026&CodigoSeguridad=${securityCode}`;

      await pool.query(
        `UPDATE visits 
         SET ncf = ?, ncf_type = ?, ncf_name = ?, rnc_cliente = ?, rzn_soc_cliente = ?, codigo_seguridad_ecf = ?, qr_code_url = ? 
         WHERE id = ?`,
        [encfNumber, seq.tipo_comprobante, seq.nombre_comprobante, clientRnc || null, clientRazonSocial || null, securityCode, qrUrl, visitId]
      );

      console.log(`✅ [DGII e-NCF Asignado]: ${encfNumber} (${seq.nombre_comprobante}) para Factura/Visita ${visitId}.`);

      return {
        ncf: encfNumber,
        ncf_type: seq.tipo_comprobante,
        ncf_name: seq.nombre_comprobante,
        codigo_seguridad: securityCode,
        qr_code_url: qrUrl,
        secuencia_id: seq.id,
        cantidad_disponible: seq.cantidad_aprobada - newCantidadUsada
      };
    } catch (err) {
      console.error('[DGII NCF ASSIGN ERROR]:', err);
      return null;
    }
  }

  // Finalize checkout and mark as Facturado
  async function handleCheckoutVisit(req, res) {
    try {
      const id = req.params?.id || req.body?.ticketId || req.body?.id || `VIS-${Date.now()}`;
      const { 
        total, monto_recibido, devuelta, metodo_pago, items_detail, 
        client_id, client_name, salon_id, employee_consumption, gift_card_redemption,
        ncf_type, tipo_comprobante, rnc_cliente, rnc, rzn_soc_cliente, applied_payments
      } = req.body;

      const [existing] = await pool.query('SELECT id, ticket_number, servicios, ncf FROM visits WHERE id = ?', [id]);

      let serviceNames = [];
      if (Array.isArray(items_detail) && items_detail.length > 0) {
        serviceNames = items_detail.map(i => i.nombre || i.servicio || i.name || 'Servicio').filter(Boolean);
      } else if (req.body.servicios && Array.isArray(req.body.servicios)) {
        serviceNames = req.body.servicios;
      } else if (existing[0]?.servicios) {
        try {
          serviceNames = typeof existing[0].servicios === 'string' ? JSON.parse(existing[0].servicios) : existing[0].servicios;
        } catch (e) {
          serviceNames = [];
        }
      }

      let ticketNum = existing[0]?.ticket_number;
      if (!ticketNum) {
        ticketNum = await getNextTicketNumber(salon_id || 1, 'SD');
      }

      if (existing.length === 0) {
        await pool.query(
          `INSERT INTO visits 
            (id, ticket_number, client_id, client_name, total, monto_recibido, devuelta, metodo_pago, items_detail, servicios, salon_id, status, visited_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Facturado', NOW())`,
          [
            id,
            ticketNum,
            client_id || 'INVITADO',
            client_name || 'Cliente General',
            total || 0,
            monto_recibido || 0,
            devuelta || 0,
            metodo_pago || 'Efectivo',
            JSON.stringify(items_detail || []),
            JSON.stringify(serviceNames || []),
            salon_id || 1
          ]
        );
      } else {
        await pool.query(
          `UPDATE visits SET 
            status = 'Facturado', 
            total = ?, 
            monto_recibido = ?, 
            devuelta = ?, 
            metodo_pago = ?, 
            items_detail = ?, 
            servicios = ?,
            visited_at = NOW() 
           WHERE id = ?`,
          [total || 0, monto_recibido || 0, devuelta || 0, metodo_pago || 'Efectivo', JSON.stringify(items_detail || []), JSON.stringify(serviceNames || []), id]
        );
      }

      // Determine if it is a Plan Beauty redemption or zero-charge visit (NO fiscal receipt)
      const hasFiscalRnc = (rnc_cliente || rnc) && String(rnc_cliente || rnc).trim().length >= 9;
      const isPlanBeautyCanje = (
        (metodo_pago && (metodo_pago.toLowerCase().includes('plan') || metodo_pago.toLowerCase().includes('canje') || metodo_pago.toLowerCase().includes('membresía') || metodo_pago.toLowerCase().includes('membresia'))) ||
        Number(total || 0) <= 0 ||
        ncf_type === 'NONE' || tipo_comprobante === 'NONE' || ncf_type === 'SIN_COMPROBANTE'
      ) && !hasFiscalRnc;

      const isExplicitNoNcf = isPlanBeautyCanje || (ncf_type === 'NONE' || tipo_comprobante === 'NONE' || ncf_type === 'SIN_COMPROBANTE');

      let dgiiResult = null;
      if (!existing[0]?.ncf && !isExplicitNoNcf) {
        try {
          dgiiResult = await assignDgiiSequenceToVisit(
            id,
            ncf_type || tipo_comprobante,
            rnc_cliente || rnc,
            rzn_soc_cliente || client_name,
            total || 0,
            metodo_pago || 'Efectivo'
          );
          if (dgiiResult?.ncf && typeof transmitInvoiceDirectlyToDgii === 'function') {
            transmitInvoiceDirectlyToDgii(id).catch(e => console.warn('[DGII REALTIME AUTO-SEND NOTICE]:', e.message));
          }
        } catch (dgiiErr) {
          console.error('[DGII ASSIGN IN CHECKOUT FAILED]:', dgiiErr);
        }
      } else if (isExplicitNoNcf) {
        await pool.query(
          "UPDATE visits SET ncf = NULL, ncf_type = 'NONE', ncf_name = 'Sin Comprobante Fiscal', codigo_seguridad_ecf = NULL, qr_code_url = NULL WHERE id = ?",
          [id]
        );
      } else if (existing[0]?.ncf && typeof transmitInvoiceDirectlyToDgii === 'function') {
        transmitInvoiceDirectlyToDgii(id).catch(e => console.warn('[DGII REALTIME AUTO-SEND NOTICE]:', e.message));
      }

      // Record Gift Card Redemption if applicable
      if (gift_card_redemption && gift_card_redemption.code && gift_card_redemption.amount_redeemed > 0) {
        const [cards] = await pool.query('SELECT * FROM gift_cards WHERE code = ?', [gift_card_redemption.code]);
        if (cards.length > 0) {
          const card = cards[0];
          const redeemed = Number(gift_card_redemption.amount_redeemed);
          const newBalance = Math.max(0, Number(card.balance) - redeemed);
          const newStatus = newBalance <= 0 ? 'Redeemed' : 'Partially_Redeemed';

          await pool.query(
            'UPDATE gift_cards SET balance = ?, status = ?, used_at = NOW() WHERE id = ?',
            [newBalance, newStatus, card.id]
          );

          await pool.query(
            'INSERT INTO gift_card_logs (gift_card_id, amount_redeemed, balance_before, balance_after, created_at) VALUES (?, ?, ?, ?, NOW())',
            [card.id, redeemed, card.balance, newBalance]
          );
        }
      }

      // Record employee consumption for payroll deduction if applicable
      const isNominaPayment = metodo_pago === 'Nomina' || (Array.isArray(applied_payments) && applied_payments.some(p => p.method === 'Nomina' || p.method === 'Consumo Empleado' || p.method === 'Descuento Nómina'));

      if ((employee_consumption && employee_consumption.employee_id) || isNominaPayment) {
        const [vRows] = await pool.query('SELECT ticket_number, salon_id FROM visits WHERE id = ?', [id]);
        const ticketNum = vRows[0]?.ticket_number || `TK-${id}`;
        const branchId = salon_id || vRows[0]?.salon_id || 1;

        let empId = employee_consumption?.employee_id || client_id;
        let rawEmpId = parseInt(String(empId || '').replace('EMP-', '').replace('COMM-', '')) || 0;
        let empName = employee_consumption?.employee_name || client_name || 'Colaborador';

        if (rawEmpId) {
          const [st] = await pool.query('SELECT id, nombre, localidad FROM staff_records WHERE id = ? LIMIT 1', [rawEmpId]);
          if (st.length > 0) {
            empName = st[0].nombre || empName;
          }
        } else if (empName && empName !== 'Cliente General') {
          const [st] = await pool.query('SELECT id, nombre, localidad FROM staff_records WHERE nombre = ? LIMIT 1', [empName]);
          if (st.length > 0) {
            rawEmpId = st[0].id;
            empName = st[0].nombre;
          }
        }

        let serviceNames = [];
        if (employee_consumption?.servicios && Array.isArray(employee_consumption.servicios) && employee_consumption.servicios.length > 0) {
          serviceNames = employee_consumption.servicios;
        } else if (Array.isArray(items_detail) && items_detail.length > 0) {
          serviceNames = items_detail.map(i => i.nombre || i.servicio || i.name || 'Servicio');
        }

        const servicesStr = serviceNames.join(', ');
        const discountNotes = `Factura #${ticketNum}${servicesStr ? ` - Servicios: ${servicesStr}` : ''}`;
        const discountAmount = parseFloat(employee_consumption?.monto || total || 0);

        const consumptionId = 'CONS-' + Date.now();
        try {
          await pool.query(
            `INSERT INTO employee_consumptions (id, employee_id, employee_name, monto, servicios, visit_id, salon_id, created_at, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 'Pendiente_Nomina')`,
            [consumptionId, rawEmpId || empId || 'EMP', empName, discountAmount, JSON.stringify(serviceNames), id, branchId]
          );
        } catch (consErr) {
          console.error('[CHECKOUT CONSUMPTION ERROR]:', consErr.message);
        }

        try {
          await pool.query(
            `INSERT INTO employee_discounts (employee_id, employee_name, type, amount, date, notes, status, created_by, visit_id, created_at)
             VALUES (?, ?, 'Consumo_Servicio', ?, CURDATE(), ?, 'Pendiente', 'Caja POS (Nómina)', ?, NOW())`,
            [rawEmpId, empName, discountAmount, discountNotes, id]
          );
        } catch (discErr) {
          console.error('[CHECKOUT EMPLOYEE DISCOUNT ERROR]:', discErr.message);
        }
      }

      // Auto-calculate and record commissions per line-item for assigned employees
      if (Array.isArray(items_detail) && items_detail.length > 0) {
        await processVisitCommissions(id, items_detail);
      }

      // Auto-record sale movement into active cash register session
      const sId = salon_id || 1;
      let activeRegId = req.body.cash_register_id || null;
      if (!activeRegId) {
        const [openRegisters] = await pool.query(
          "SELECT id FROM cash_registers WHERE status = 'Abierta' AND (salon_id = ? OR salon_id IS NULL) ORDER BY opened_at DESC LIMIT 1",
          [sId]
        );
        if (openRegisters.length > 0) {
          activeRegId = openRegisters[0].id;
        } else {
          const [anyOpen] = await pool.query(
            "SELECT id FROM cash_registers WHERE status = 'Abierta' ORDER BY opened_at DESC LIMIT 1"
          );
          if (anyOpen.length > 0) activeRegId = anyOpen[0].id;
        }
      }

      if (activeRegId) {
        await pool.query('UPDATE visits SET cash_register_id = ? WHERE id = ?', [activeRegId, id]);

        if (Array.isArray(applied_payments) && applied_payments.length > 0) {
          for (const p of applied_payments) {
            const pAmt = parseFloat(p.amount) || 0;
            const pMethod = p.method || 'Efectivo';
            if (pAmt > 0 || pMethod.toLowerCase().includes('plan')) {
              await pool.query(
                `INSERT INTO cash_register_movements (cash_register_id, type, payment_method, amount, concept, visit_id, created_at)
                 VALUES (?, 'Ingreso_Venta', ?, ?, ?, ?, NOW())`,
                [activeRegId, pMethod, pAmt, `Cobro Factura #${ticketNum || id} (${pMethod})`, id]
              );
            }
          }
        } else {
          const rawMetodo = (metodo_pago || 'Efectivo').toString();

          if (rawMetodo.toLowerCase().includes('mixto')) {
            let ef = 0, tj = 0, tr = 0, gc = 0;
            const efMatch = rawMetodo.match(/Efectivo:\s*RD\$\s*([\d,.]+)/i);
            const tjMatch = rawMetodo.match(/Tarjeta:\s*RD\$\s*([\d,.]+)/i);
            const trMatch = rawMetodo.match(/Transferencia:\s*RD\$\s*([\d,.]+)/i);
            const gcMatch = rawMetodo.match(/Gift Card:\s*RD\$\s*([\d,.]+)/i);

            if (efMatch) ef = parseFloat(efMatch[1].replace(/,/g, '')) || 0;
            if (tjMatch) tj = parseFloat(tjMatch[1].replace(/,/g, '')) || 0;
            if (trMatch) tr = parseFloat(trMatch[1].replace(/,/g, '')) || 0;
            if (gcMatch) gc = parseFloat(gcMatch[1].replace(/,/g, '')) || 0;

            if (ef === 0 && tj === 0 && tr === 0 && gc === 0) {
              ef = Number(total || 0) / 2;
              tj = Number(total || 0) / 2;
            }

            if (ef > 0) {
              await pool.query(
                `INSERT INTO cash_register_movements (cash_register_id, type, payment_method, amount, concept, visit_id, created_at)
                 VALUES (?, 'Ingreso_Venta', 'Efectivo', ?, ?, ?, NOW())`,
                [activeRegId, ef, `Cobro Factura #${ticketNum || id} (Parte Efectivo)`, id]
              );
            }
            if (tj > 0) {
              await pool.query(
                `INSERT INTO cash_register_movements (cash_register_id, type, payment_method, amount, concept, visit_id, created_at)
                 VALUES (?, 'Ingreso_Venta', 'Tarjeta', ?, ?, ?, NOW())`,
                [activeRegId, tj, `Cobro Factura #${ticketNum || id} (Parte Tarjeta)`, id]
              );
            }
            if (tr > 0) {
              await pool.query(
                `INSERT INTO cash_register_movements (cash_register_id, type, payment_method, amount, concept, visit_id, created_at)
                 VALUES (?, 'Ingreso_Venta', 'Transferencia', ?, ?, ?, NOW())`,
                [activeRegId, tr, `Cobro Factura #${ticketNum || id} (Parte Transferencia)`, id]
              );
            }
            if (gc > 0) {
              await pool.query(
                `INSERT INTO cash_register_movements (cash_register_id, type, payment_method, amount, concept, visit_id, created_at)
                 VALUES (?, 'Ingreso_Venta', 'Gift Card', ?, ?, ?, NOW())`,
                [activeRegId, gc, `Cobro Factura #${ticketNum || id} (Parte Gift Card)`, id]
              );
            }
          } else {
            await pool.query(
              `INSERT INTO cash_register_movements (cash_register_id, type, payment_method, amount, concept, visit_id, created_at)
               VALUES (?, 'Ingreso_Venta', ?, ?, ?, ?, NOW())`,
              [activeRegId, rawMetodo, total || 0, `Cobro Factura #${ticketNum || id}`, id]
            );
          }
        }
      }

      const [finalVisitRows] = await pool.query('SELECT ncf, ncf_type, ncf_name, codigo_seguridad_ecf, qr_code_url FROM visits WHERE id = ?', [id]);
      const fv = finalVisitRows[0] || {};

      res.json({ 
        success: true, 
        ticketNumber: ticketNum || id,
        ncf: dgiiResult?.ncf || fv.ncf || null,
        ncf_type: dgiiResult?.ncf_type || fv.ncf_type || null,
        ncf_name: dgiiResult?.ncf_name || fv.ncf_name || null,
        codigo_seguridad: dgiiResult?.codigo_seguridad || fv.codigo_seguridad_ecf || null,
        qr_code_url: dgiiResult?.qr_code_url || fv.qr_code_url || null
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // Delete pending ticket / visit
  const handleDeleteVisit = async (req, res) => {
    try {
      const { id } = req.params;
      await pool.query('DELETE FROM visits WHERE id = ? AND status = "Pendiente"', [id]);
      res.json({ success: true, message: 'Ticket descartado exitosamente' });
    } catch (err) {
      console.error('[API DELETE VISIT ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  };

  // Delete all pending tickets / visits
  const handleClearAllPendingVisits = async (req, res) => {
    try {
      const salonId = req.query.salon_id || req.body?.salon_id;
      let query = 'DELETE FROM visits WHERE status = "Pendiente"';
      const params = [];
      if (salonId && salonId !== 'all') {
        query += ' AND salon_id = ?';
        params.push(salonId);
      }
      const [result] = await pool.query(query, params);
      res.json({ success: true, message: 'Todos los tickets pendientes fueron eliminados', affectedRows: result.affectedRows });
    } catch (err) {
      console.error('[API CLEAR ALL PENDING VISITS ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  };

  // --- ROUTES ---

  router.get('/', async (req, res) => {
    try {
      const [rows] = await pool.query('SELECT v.*, s.name as salon_name FROM visits v LEFT JOIN salons s ON v.salon_id = s.id ORDER BY v.visited_at DESC');
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/pending', async (req, res) => {
    try {
      const { salon_id } = req.query;
      let query = `
        SELECT v.*, COALESCE(s.name, 'Sucursal San Vicente de Paúl') as salon_name 
        FROM visits v 
        LEFT JOIN salons s ON v.salon_id = s.id 
        WHERE v.status = 'Pendiente'
      `;
      const params = [];
      if (salon_id && salon_id !== 'all') {
        query += ' AND (v.salon_id = ? OR v.salon_id IS NULL)';
        params.push(salon_id);
      }
      query += ' ORDER BY v.visited_at ASC';
      const [rows] = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/client/:clientId', async (req, res) => {
    try {
      const target = req.params.clientId;
      const [rows] = await pool.query(
        `SELECT v.*, COALESCE(s.name, 'Sucursal San Vicente de Paúl') as salon_name 
         FROM visits v 
         LEFT JOIN salons s ON v.salon_id = s.id 
         LEFT JOIN clients c ON (v.client_id = c.id OR LOWER(TRIM(v.client_name)) = LOWER(TRIM(c.nombre)))
         WHERE v.client_id = ? 
            OR LOWER(TRIM(v.client_name)) = LOWER(?) 
            OR c.id = ? 
            OR c.cedula = ?
            OR v.client_name LIKE ?
         ORDER BY v.visited_at DESC`,
        [target, target, target, target, `%${target}%`]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/ticket', async (req, res) => {
    try {
      const id = Date.now().toString();
      const { clientId, clientName, servicios, empleadoPeluquera, empleadoLavaPelo, empleadoManicurista, salon_id, draft_data } = req.body;
      const sId = salon_id || 1;

      const [salonRows] = await pool.query("SELECT name FROM salons WHERE id = ?", [sId]);
      const salonName = salonRows[0]?.name || 'Sucursal San Vicente de Paúl';

      let prefix = 'SD';
      const sNameLower = salonName.toLowerCase();
      if (sNameLower.includes('villa mella') || sNameLower.includes('mella')) {
        prefix = 'VM';
      } else if (sNameLower.includes('frailes')) {
        prefix = 'LF';
      } else if (sNameLower.includes('san vicente')) {
        prefix = 'SD';
      } else {
        prefix = salonName.split(' ').filter(w => w.length > 2).map(w => w[0]).join('').slice(0, 3).toUpperCase() || 'TK';
      }

      const ticketNumber = await getNextTicketNumber(sId, prefix);

      await pool.query(
        `INSERT INTO visits (id, client_id, client_name, servicios, draft_data, empleado_peluquera, empleado_lava_pelo, empleado_manicurista, salon_id, status, ticket_number, visited_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?, NOW())`,
        [id, clientId || 'INVITADO', clientName || 'Cliente General', JSON.stringify(servicios || []), JSON.stringify(draft_data || {}), empleadoPeluquera || 'N/A', empleadoLavaPelo || 'N/A', empleadoManicurista || 'N/A', sId, ticketNumber]
      );

      res.json({ id, ticketNumber, salonName, clientName: clientName || 'Cliente General', createdAt: new Date().toISOString(), success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/:id/draft', async (req, res) => {
    try {
      const { id } = req.params;
      const { draft_data, items_detail, total, servicios, empleado_peluquera, empleado_lava_pelo, empleado_manicurista } = req.body;

      await pool.query(
        `UPDATE visits SET 
          draft_data = ?, 
          items_detail = ?, 
          total = ?, 
          servicios = ?, 
          empleado_peluquera = ?, 
          empleado_lava_pelo = ?, 
          empleado_manicurista = ?
         WHERE id = ?`,
        [
          JSON.stringify(draft_data || {}),
          JSON.stringify(items_detail || []),
          total || 0.00,
          JSON.stringify(servicios || []),
          empleado_peluquera || 'N/A',
          empleado_lava_pelo || 'N/A',
          empleado_manicurista || 'N/A',
          id
        ]
      );

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/checkout', async (req, res) => {
    const visitId = req.body.ticketId || req.body.id || `VIS-${Date.now()}`;
    req.params = { id: visitId };
    return handleCheckoutVisit(req, res);
  });

  router.post('/:id/checkout', handleCheckoutVisit);

  router.post('/:id/void', async (req, res) => {
    try {
      const { id } = req.params;
      const { reason, voided_by } = req.body;

      if (!reason || !reason.trim()) {
        return res.status(400).json({ error: 'Debes proporcionar un motivo claro para la anulación de la factura.' });
      }

      const [visits] = await pool.query('SELECT * FROM visits WHERE id = ?', [id]);
      if (visits.length === 0) {
        return res.status(404).json({ error: 'Factura/Ticket no encontrado.' });
      }

      const visit = visits[0];

      if (visit.status === 'Anulado') {
        return res.status(400).json({ error: 'Esta factura ya se encuentra anulada.' });
      }

      const userWhoVoided = voided_by || 'Cajero/Admin';
      const voidReasonText = reason.trim();

      await pool.query(
        `UPDATE visits SET 
          status = 'Anulado', 
          void_reason = ?, 
          voided_by = ?, 
          voided_at = NOW() 
         WHERE id = ?`,
        [voidReasonText, userWhoVoided, id]
      );

      await pool.query(
        "UPDATE employee_commissions_log SET status = 'Anulada' WHERE (visit_id = ? OR ticket_number = ?) AND status != 'Anulada'",
        [id, visit.ticket_number || id]
      );

      try {
        await pool.query("UPDATE employee_consumptions SET status = 'Anulado' WHERE visit_id = ?", [id]);
      } catch(e) {}

      try {
        await pool.query(
          "UPDATE employee_discounts SET status = 'Anulado' WHERE (visit_id = ? OR notes LIKE ? OR notes LIKE ? OR notes LIKE ?)",
          [id, `%#${visit.ticket_number}%`, `%#${id}%`, `%${visit.ticket_number}%`]
        );
      } catch(e) {}

      const visitTotal = Number(visit.total || 0);
      if (visitTotal > 0) {
        let targetRegId = null;
        if (visit.cash_register_id) {
          const [existingReg] = await pool.query('SELECT id FROM cash_registers WHERE id = ?', [visit.cash_register_id]);
          if (existingReg.length > 0) targetRegId = existingReg[0].id;
        }
        if (!targetRegId && visit.salon_id) {
          const [openRegs] = await pool.query(
            "SELECT id FROM cash_registers WHERE salon_id = ? AND status = 'Abierta' ORDER BY opened_at DESC LIMIT 1",
            [visit.salon_id]
          );
          if (openRegs.length > 0) targetRegId = openRegs[0].id;
        }
        if (!targetRegId) {
          const [openRegs] = await pool.query("SELECT id FROM cash_registers WHERE status = 'Abierta' ORDER BY opened_at DESC LIMIT 1");
          if (openRegs.length > 0) targetRegId = openRegs[0].id;
        }

        if (targetRegId) {
          await pool.query(
            `INSERT INTO cash_register_movements (cash_register_id, type, payment_method, amount, concept, user_name, visit_id, created_at)
             VALUES (?, 'Anulacion_Venta', ?, ?, ?, ?, ?, NOW())`,
            [
              targetRegId,
              visit.metodo_pago || 'Efectivo',
              -Math.abs(visitTotal),
              `Anulación Factura ${visit.ticket_number || id} - ${voidReasonText}`,
              userWhoVoided,
              id
            ]
          );
        }
      }

      await pool.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, user_name, reason, metadata, created_at)
         VALUES ('invoice', ?, 'ANULAR_FACTURA', ?, ?, ?, NOW())`,
        [
          id,
          userWhoVoided,
          voidReasonText,
          JSON.stringify({
            ticket_number: visit.ticket_number || id,
            client_name: visit.client_name,
            total: visitTotal,
            metodo_pago: visit.metodo_pago
          })
        ]
      );

      let notaCreditoNcf = null;
      if (visit.ncf && typeof generateAndTransmitNotaCredito === 'function') {
        try {
          notaCreditoNcf = await generateAndTransmitNotaCredito(visit, voidReasonText, userWhoVoided);
        } catch (ncErr) {
          console.error('[DGII VOID NOTA CREDITO FAILED]:', ncErr);
        }
      }

      res.json({ 
        success: true, 
        message: 'Factura anulada correctamente con registro de auditoría.',
        ncf_nota_credito: notaCreditoNcf || null
      });
    } catch (err) {
      console.error('[API VOID VISIT ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/pending/all', handleClearAllPendingVisits);
  router.post('/pending/clear-all', handleClearAllPendingVisits);
  router.delete('/:id', handleDeleteVisit);
  router.post('/:id/delete', handleDeleteVisit);

  router.post('/', async (req, res) => {
    try {
      const id = Date.now().toString();
      const { clientId, clientName, servicios, empleadoPeluquera, empleadoManicurista, proximaFecha, autoReminder, salon_id } = req.body;
      const ticketNumber = await getNextTicketNumber(salon_id || 1, 'SD');
      await pool.query(
        "INSERT INTO visits (id, ticket_number, client_id, client_name, servicios, empleado_peluquera, empleado_manicurista, proxima_fecha, recordatorio_auto, salon_id, status, visited_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Facturado', NOW())",
        [id, ticketNumber, clientId, clientName, JSON.stringify(servicios || []), empleadoPeluquera, empleadoManicurista, proximaFecha || null, autoReminder ? 1 : 0, salon_id || 1]
      );

      const [clientData] = await pool.query('SELECT email FROM clients WHERE id = ?', [clientId]);
      if (clientData[0]?.email && typeof sendSurveyEmail === 'function') {
        sendSurveyEmail(clientId, clientName, clientData[0].email);
      }

      res.json({ id, ticketNumber, success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return { router, getNextTicketNumber, processVisitCommissions, assignDgiiSequenceToVisit, handleCheckoutVisit };
}

module.exports = {
  createVisitsRouter
};
