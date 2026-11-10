const path = require('path');
const mysql = require(path.join(__dirname, '..', 'backend', 'node_modules', 'mysql2', 'promise'));
const fs = require('fs');

const envPath = path.join(__dirname, '..', 'backend', '.env');
const env = fs.readFileSync(envPath, 'utf8').split('\n').reduce((acc, line) => {
  const [k, ...v] = line.trim().split('=');
  if (k && v.length) acc[k] = v.join('=');
  return acc;
}, {});

(async () => {
  const pool = mysql.createPool({
    host: env.DB_HOST,
    user: env.DB_USER,
    password: env.DB_PASSWORD || env.DB_PASS,
    database: env.DB_NAME,
    timezone: '-04:00'
  });

  // Call the exact logic from backend/routes/dgii.routes.js:
  const [rows] = await pool.query(`
    SELECT id, tipo_comprobante, nombre_comprobante, numero_desde, numero_hasta, 
           secuencia_actual, cantidad_aprobada, cantidad_usada, fecha_vencimiento, estado, alerta_minima
    FROM dgii_ncf_sequences
    WHERE estado = 'Activo'
    ORDER BY id ASC
  `);

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const availability = {
    E31: { tipo: 'E31', nombre: 'Factura de Crédito Fiscal Electrónico', disponibles: 0, isExhausted: true, alertLevel: 'exhausted', batches: [] },
    E32: { tipo: 'E32', nombre: 'Factura de Consumo Electrónica', disponibles: 0, isExhausted: true, alertLevel: 'exhausted', batches: [] },
    E34: { tipo: 'E34', nombre: 'Nota de Crédito Electrónica', disponibles: 0, isExhausted: true, alertLevel: 'exhausted', batches: [] },
    hasAlerts: false,
    alerts: []
  };

  for (const row of rows) {
    const tipo = row.tipo_comprobante;
    if (!availability[tipo]) continue;

    const isExpired = row.fecha_vencimiento ? new Date(row.fecha_vencimiento) < now : false;
    if (isExpired) continue;

    const prefix = tipo || row.numero_desde.slice(0, 3);
    const startNum = parseInt(row.numero_desde.slice(prefix.length), 10) || 1;
    const endNum = parseInt(row.numero_hasta.slice(prefix.length), 10) || (startNum + row.cantidad_aprobada - 1);
    const currentAssignedNum = startNum + row.cantidad_usada;

    if (currentAssignedNum <= endNum && row.cantidad_usada < row.cantidad_aprobada) {
      const batchAvailable = Math.min(row.cantidad_aprobada - row.cantidad_usada, endNum - currentAssignedNum + 1);
      availability[tipo].disponibles += Math.max(0, batchAvailable);
      availability[tipo].batches.push({
        id: row.id,
        disponibles: batchAvailable,
        secuencia_actual: row.secuencia_actual,
        cantidad_usada: row.cantidad_usada,
        cantidad_aprobada: row.cantidad_aprobada
      });
    }
  }

  for (const tipo of ['E31', 'E32', 'E34']) {
    const disp = availability[tipo].disponibles;
    availability[tipo].isExhausted = (disp <= 0);

    let level = 'none';
    let alertMsg = null;

    if (disp === 0) {
      level = 'exhausted';
      alertMsg = `⛔ ALERTA PERSISTENTE: Se agotaron los comprobantes fiscales de ${tipo} (${availability[tipo].nombre}). Facturación bloqueada para este tipo.`;
    } else if (disp <= 5) {
      level = 'critical_5';
      alertMsg = `🚨 Alerta Crítica: Quedan solo ${disp} secuencias autorizadas de ${tipo}. Bloqueo inminente al llegar a cero.`;
    } else if (disp <= 10) {
      level = 'warning_10';
      alertMsg = `⚠️ Advertencia: Quedan solo ${disp} secuencias autorizadas de ${tipo}. Favor notificar al administrador para solicitar nuevas secuencias a la DGII.`;
    } else if (disp <= 20) {
      level = 'warning_20';
      alertMsg = `ℹ️ Aviso: Quedan ${disp} secuencias autorizadas de ${tipo}.`;
    }

    availability[tipo].alertLevel = level;
    availability[tipo].message = alertMsg;
    if (level !== 'none') {
      availability.hasAlerts = true;
      availability.alerts.push({
        tipo,
        disponibles: disp,
        level,
        message: alertMsg
      });
    }
  }

  console.log('Complete Availability API Response:', JSON.stringify(availability, null, 2));

  await pool.end();
})();

