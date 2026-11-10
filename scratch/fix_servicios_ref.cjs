const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'backend', 'routes', 'visits.routes.js');
let raw = fs.readFileSync(filePath, 'utf8');
const isCrlf = raw.includes('\r\n');
let content = raw.replace(/\r\n/g, '\n');

// 1. Destructure servicios from req.body as well
content = content.replace(
  'client_id, client_name, salon_id, employee_consumption, gift_card_redemption,',
  'client_id, client_name, salon_id, servicios, employee_consumption, gift_card_redemption,'
);

// 2. Replace lines with Array.isArray(servicios) with serviceNames
content = content.replace(
  'const hasPlanServiceInList = Array.isArray(servicios) && servicios.some(s => {',
  'const effectiveServiceList = Array.isArray(servicios) ? servicios : serviceNames;\n      const hasPlanServiceInList = Array.isArray(effectiveServiceList) && effectiveServiceList.some(s => {'
);

content = content.replace(
  '})) || (hasPlanServiceInList && (servicios.some(s => {',
  '})) || (hasPlanServiceInList && (effectiveServiceList.some(s => {'
);

// 3. In outer catch of handleCheckoutVisit: ensure status is reverted to Pendiente if stuck in Procesando
const oldOuterCatch = `    } catch (err) {
      console.error('[HANDLE CHECKOUT ERROR]:', err);
      res.status(500).json({ error: err.message });
    }`;

const newOuterCatch = `    } catch (err) {
      console.error('[HANDLE CHECKOUT ERROR]:', err);
      try {
        const idToRollback = req.params?.id || req.body?.ticketId || req.body?.id;
        if (idToRollback) {
          await pool.query("UPDATE visits SET status = 'Pendiente' WHERE id = ? AND status = 'Procesando'", [idToRollback]);
        }
      } catch (_) {}
      res.status(500).json({ error: err.message });
    }`;

content = content.replace(oldOuterCatch, newOuterCatch);

if (isCrlf) {
  content = content.replace(/\n/g, '\r\n');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully fixed servicios reference and added outer catch rollback.');

