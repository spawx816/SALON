const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, '..', 'backend', 'routes', 'visits.routes.js');
let content = fs.readFileSync(targetFile, 'utf8');

// 1. Fix checkout cross-salon fallback
const checkoutTarget = `        if (openRegisters.length > 0) {
          activeRegId = openRegisters[0].id;
        } else {
          const [anyOpen] = await pool.query(
            "SELECT id FROM cash_registers WHERE status = 'Abierta' ORDER BY opened_at DESC LIMIT 1"
          );
          if (anyOpen.length > 0) activeRegId = anyOpen[0].id;
        }`;

const checkoutReplacement = `        if (openRegisters.length > 0) {
          activeRegId = openRegisters[0].id;
        }`;

// Normalize line endings for replacement
const normContent = content.replace(/\r\n/g, '\n');
const normCheckoutTarget = checkoutTarget.replace(/\r\n/g, '\n');
const normCheckoutReplacement = checkoutReplacement.replace(/\r\n/g, '\n');

if (!normContent.includes(normCheckoutTarget)) {
  console.error('ERROR: checkoutTarget not found in visits.routes.js');
  process.exit(1);
}

let patchedContent = normContent.replace(normCheckoutTarget, normCheckoutReplacement);

// 2. Fix void logic
const voidTarget = `      const visit = visits[0];

      if (visit.status === 'Anulado') {
        return res.status(400).json({ error: 'Esta factura ya se encuentra anulada.' });
      }

      const userWhoVoided = voided_by || 'Cajero/Admin';
      const voidReasonText = reason.trim();

      await pool.query(
        \`UPDATE visits SET 
          status = 'Anulado', 
          void_reason = ?, 
          voided_by = ?, 
          voided_at = NOW() 
         WHERE id = ?\`,
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
          [id, \`%#\${visit.ticket_number}%\`, \`%#\${id}%\`, \`%\${visit.ticket_number}%\`]
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
            \`INSERT INTO cash_register_movements (cash_register_id, type, payment_method, amount, concept, user_name, visit_id, created_at)
             VALUES (?, 'Anulacion_Venta', ?, ?, ?, ?, ?, NOW())\`,
            [
              targetRegId,
              visit.metodo_pago || 'Efectivo',
              -Math.abs(visitTotal),
              \`Anulación Factura \${visit.ticket_number || id} - \${voidReasonText}\`,
              userWhoVoided,
              id
            ]
          );
        }
      }`;

const voidReplacement = `      const visit = visits[0];

      if (visit.status === 'Anulado') {
        return res.status(400).json({ error: 'Esta factura ya se encuentra anulada.' });
      }

      const wasActuallyBilled = (visit.status === 'Facturado');
      const userWhoVoided = voided_by || 'Cajero/Admin';
      const voidReasonText = reason.trim();

      await pool.query(
        \`UPDATE visits SET 
          status = 'Anulado', 
          void_reason = ?, 
          voided_by = ?, 
          voided_at = NOW() 
         WHERE id = ?\`,
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
          [id, \`%#\${visit.ticket_number}%\`, \`%#\${id}%\`, \`%\${visit.ticket_number}%\`]
        );
      } catch(e) {}

      const visitTotal = Number(visit.total || 0);

      // Ajuste de cuadre de caja al anular:
      // REGLA OPERATIVA DE SEGURIDAD:
      // 1. Sólo se generan movimientos de Anulacion_Venta si la visita tuvo ingresos reales registrados (Ingreso_Venta) o fue previamente Facturada.
      //    Precuentas, borradores y visitas que nunca ingresaron dinero a caja NO deben restar dinero de la caja.
      // 2. Si existen Ingreso_Venta previos en cash_register_movements para esta visita, anularlos en SU MISMA CAJA.
      // 3. NUNCA cruzar movimientos a cajas de otras sucursales (salon_id distinto).
      const [existingIncomeMoves] = await pool.query(
        "SELECT id, cash_register_id, payment_method, amount FROM cash_register_movements WHERE visit_id = ? AND type = 'Ingreso_Venta'",
        [id]
      );

      const [existingVoidMoves] = await pool.query(
        "SELECT id, cash_register_id FROM cash_register_movements WHERE visit_id = ? AND type = 'Anulacion_Venta'",
        [id]
      );

      if (existingIncomeMoves.length > 0 && existingVoidMoves.length === 0) {
        for (const inc of existingIncomeMoves) {
          const incAmt = Math.abs(parseFloat(inc.amount) || 0);
          if (incAmt > 0) {
            await pool.query(
              \`INSERT INTO cash_register_movements (cash_register_id, type, payment_method, amount, concept, user_name, visit_id, created_at)
               VALUES (?, 'Anulacion_Venta', ?, ?, ?, ?, ?, NOW())\`,
              [
                inc.cash_register_id,
                inc.payment_method || 'Efectivo',
                -incAmt,
                \`Anulación Factura \${visit.ticket_number || id} - \${voidReasonText}\`,
                userWhoVoided,
                id
              ]
            );
          }
        }
      } else if (existingVoidMoves.length === 0 && wasActuallyBilled && visitTotal > 0) {
        let targetRegId = null;
        if (visit.cash_register_id) {
          const [regRow] = await pool.query('SELECT id, salon_id FROM cash_registers WHERE id = ?', [visit.cash_register_id]);
          if (regRow.length > 0 && (!visit.salon_id || regRow[0].salon_id === visit.salon_id)) {
            targetRegId = regRow[0].id;
          }
        }
        if (!targetRegId && visit.salon_id) {
          const [openRegs] = await pool.query(
            "SELECT id FROM cash_registers WHERE salon_id = ? AND status = 'Abierta' ORDER BY opened_at DESC LIMIT 1",
            [visit.salon_id]
          );
          if (openRegs.length > 0) targetRegId = openRegs[0].id;
        }

        if (targetRegId) {
          await pool.query(
            \`INSERT INTO cash_register_movements (cash_register_id, type, payment_method, amount, concept, user_name, visit_id, created_at)
             VALUES (?, 'Anulacion_Venta', ?, ?, ?, ?, ?, NOW())\`,
            [
              targetRegId,
              visit.metodo_pago || 'Efectivo',
              -Math.abs(visitTotal),
              \`Anulación Factura \${visit.ticket_number || id} - \${voidReasonText}\`,
              userWhoVoided,
              id
            ]
          );
        }
      }`;

const normVoidTarget = voidTarget.replace(/\r\n/g, '\n');
const normVoidReplacement = voidReplacement.replace(/\r\n/g, '\n');

if (!patchedContent.includes(normVoidTarget)) {
  console.error('ERROR: voidTarget not found in visits.routes.js');
  process.exit(1);
}

patchedContent = patchedContent.replace(normVoidTarget, normVoidReplacement);

fs.writeFileSync(targetFile, patchedContent, 'utf8');
console.log('Successfully patched backend/routes/visits.routes.js!');

