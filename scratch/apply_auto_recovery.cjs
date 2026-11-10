const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'backend', 'routes', 'visits.routes.js');
let raw = fs.readFileSync(filePath, 'utf8');
const isCrlf = raw.includes('\r\n');
let content = raw.replace(/\r\n/g, '\n');

// 1. In handleCheckoutVisit claim transition
const oldClaim = `        // Transición atómica exclusiva de Pendiente -> Procesando para evitar carreras simultáneas sobre la misma visita
        const [claimResult] = await pool.query(
          "UPDATE visits SET status = 'Procesando' WHERE id = ? AND status = 'Pendiente'",
          [id]
        );`;

const newClaim = `        // Transición atómica exclusiva de Pendiente (o Procesando sin NCF abandonado) -> Procesando
        const [claimResult] = await pool.query(
          \`UPDATE visits 
           SET status = 'Procesando' 
           WHERE id = ? 
             AND (status = 'Pendiente' OR (status = 'Procesando' AND ncf IS NULL AND visited_at < NOW() - INTERVAL 15 SECOND))\`,
          [id]
        );`;

if (content.includes(oldClaim)) {
  content = content.replace(oldClaim, newClaim);
  console.log('Updated claimResult query in handleCheckoutVisit');
} else {
  console.warn('oldClaim not found');
}

// 2. In router.get('/pending')
const oldPending = `  router.get('/pending', async (req, res) => {
    try {
      const { salon_id } = req.query;`;

const newPending = `  router.get('/pending', async (req, res) => {
    try {
      // Auto-recuperación de visitas abandonadas o interrumpidas en Procesando sin comprobante asignado
      try {
        await pool.query(
          "UPDATE visits SET status = 'Pendiente' WHERE status = 'Procesando' AND ncf IS NULL AND visited_at < NOW() - INTERVAL 15 SECOND"
        );
      } catch (autoRecErr) {
        console.warn('[AUTO-RECOVER PROCESANDO ERROR]:', autoRecErr.message);
      }

      const { salon_id } = req.query;`;

if (content.includes(oldPending)) {
  content = content.replace(oldPending, newPending);
  console.log('Updated router.get(/pending) with auto-recovery');
} else {
  console.warn('oldPending not found');
}

if (isCrlf) {
  content = content.replace(/\n/g, '\r\n');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Finished updating visits.routes.js for auto-recovery');

