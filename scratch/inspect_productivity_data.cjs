const path = require('path');
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
dotenv.config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  // Load staff_records
  const [staffRows] = await pool.query(`
    SELECT sr.id, sr.nombre, sr.posicion, sr.localidad, sr.salon_id, sr.status, s.name as salon_name
    FROM staff_records sr
    LEFT JOIN salons s ON sr.salon_id = s.id
  `);

  const staffById = new Map();
  const staffByName = new Map();
  const normalizeName = (str) => String(str || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  for (const s of staffRows) {
    staffById.set(String(s.id), s);
    if (s.nombre) {
      staffByName.set(normalizeName(s.nombre), s);
    }
  }

  const resolveEmployee = (rawId, rawName, fallbackNames = []) => {
    if (rawId) {
      const cleanId = String(rawId).replace('EMP-', '').trim();
      if (staffById.has(cleanId)) return staffById.get(cleanId);
    }
    const candidates = [rawName, ...fallbackNames].filter(n => n && n !== 'N/A' && n !== 'Sin asignar');
    for (const cand of candidates) {
      const norm = normalizeName(cand);
      if (staffByName.has(norm)) return staffByName.get(norm);
      // Partial match if exact name not found
      for (const [k, v] of staffByName.entries()) {
        if (k.startsWith(norm) || norm.startsWith(k)) return v;
      }
      return { id: `NAME:${norm}`, nombre: cand.trim(), salon_id: null };
    }
    return null;
  };

  const aggregateVisits = async (fromDT, toDT, salonFilterId = 'all', serviceFilter = 'all') => {
    let sql = `
      SELECT id, servicios, items_detail, total, metodo_pago, empleado_peluquera, empleado_lava_pelo, empleado_manicurista, salon_id, visited_at
      FROM visits
      WHERE visited_at >= ? AND visited_at <= ?
        AND status NOT IN ('Anulado', 'Anulada', 'Cancelado', 'Cancelada', 'Pendiente', 'Procesando')
        AND (ncf_nota_credito IS NULL OR ncf_nota_credito = '')
    `;
    const params = [fromDT, toDT];
    if (salonFilterId !== 'all') {
      sql += ' AND salon_id = ?';
      params.push(salonFilterId);
    }
    const [visits] = await pool.query(sql, params);

    const empMap = new Map();
    const normServiceFilter = serviceFilter !== 'all' ? normalizeName(serviceFilter) : null;

    const matchesService = (svcName) => {
      if (!normServiceFilter) return true;
      const n = normalizeName(svcName).replace(/\s*\(plan beauty\)\s*/g, '').trim();
      return n === normServiceFilter || normalizeName(svcName) === normServiceFilter;
    };

    for (const v of visits) {
      const visitDate = v.visited_at ? new Date(v.visited_at).toISOString().split('T')[0] : null;
      const metodoPagoLower = String(v.metodo_pago || '').toLowerCase();
      let items = [];
      try {
        items = typeof v.items_detail === 'string' ? JSON.parse(v.items_detail || '[]') : (v.items_detail || []);
      } catch (_) { items = []; }

      if (!Array.isArray(items) || items.length === 0) {
        let srvList = [];
        try {
          srvList = typeof v.servicios === 'string' ? JSON.parse(v.servicios || '[]') : (v.servicios || []);
        } catch (_) { srvList = []; }
        if (Array.isArray(srvList) && srvList.length > 0) {
          const unitPrice = srvList.length > 0 ? Number(v.total || 0) / srvList.length : 0;
          items = srvList.map(sName => ({
            nombre: typeof sName === 'string' ? sName : (sName?.nombre || 'Servicio'),
            precioAplicado: unitPrice,
            cantidad: 1,
            isPlanWash: Number(v.total || 0) === 0 && metodoPagoLower.includes('plan beauty')
          }));
        }
      }

      for (const item of items) {
        const svcName = String(item.nombre || item.name || 'Servicio').trim();
        if (!matchesService(svcName)) continue;

        const emp = resolveEmployee(
          item.empleado_id,
          item.empleado_nombre || item.empleado,
          [v.empleado_peluquera, v.empleado_manicurista, v.empleado_lava_pelo]
        );
        if (!emp) continue;

        const empKey = String(emp.id);
        if (!empMap.has(empKey)) {
          empMap.set(empKey, {
            id: emp.id,
            empleado: emp.nombre,
            servicios_facturados: 0,
            lavados_membresia: 0,
            monto_generado: 0,
            visit_days: new Set()
          });
        }
        const rec = empMap.get(empKey);
        if (visitDate) rec.visit_days.add(visitDate);

        const qty = Math.max(1, Number(item.cantidad || 1));
        const rawPrice = Number(item.precioAplicado ?? item.precioBase ?? item.price ?? 0);
        const discount = Number(item.descuento || 0);
        const netAmount = Math.max(0, (rawPrice * qty) - discount);
        const svcLower = svcName.toLowerCase();

        const isPlanWash = Boolean(
          item.isPlanWash ||
          svcLower.includes('plan beauty') ||
          (netAmount === 0 && (svcLower.includes('lavado') || metodoPagoLower.includes('plan beauty')))
        );

        if (isPlanWash) {
          rec.lavados_membresia += qty;
        } else {
          rec.servicios_facturados += qty;
          rec.monto_generado += netAmount;
        }
      }
    }
    return empMap;
  };

  const currMap = await aggregateVisits('2026-10-01 00:00:00', '2026-10-31 23:59:59');
  const prevMap = await aggregateVisits('2026-09-01 00:00:00', '2026-09-30 23:59:59');

  // Attendance days in Oct 2026
  const [attRows] = await pool.query(`
    SELECT CAST(REPLACE(employee_id, 'EMP-', '') AS UNSIGNED) as emp_id,
           COUNT(DISTINCT CASE WHEN type = 'Check-In' THEN DATE(timestamp) END) as checkin_days,
           COUNT(DISTINCT DATE(timestamp)) as any_att_days
    FROM attendance
    WHERE timestamp >= '2026-10-01 00:00:00' AND timestamp <= '2026-10-31 23:59:59'
    GROUP BY CAST(REPLACE(employee_id, 'EMP-', '') AS UNSIGNED)
  `);
  const attByEmp = new Map();
  for (const r of attRows) {
    attByEmp.set(String(r.emp_id), Number(r.checkin_days || r.any_att_days || 0));
  }

  const rows = [];
  for (const [empKey, rec] of currMap.entries()) {
    const totalRealizados = rec.servicios_facturados + rec.lavados_membresia;
    if (totalRealizados === 0) continue;
    const attDays = attByEmp.get(empKey) || 0;
    const diasTrabajados = Math.max(attDays, rec.visit_days.size, 1);
    const prevRec = prevMap.get(empKey);
    const prevTotal = prevRec ? (prevRec.servicios_facturados + prevRec.lavados_membresia) : 0;
    const variacionPct = prevTotal > 0 ? Number((((totalRealizados - prevTotal) / prevTotal) * 100).toFixed(1)) : 0;

    rows.push({
      id: rec.id,
      empleado: rec.empleado,
      servicios_facturados: rec.servicios_facturados,
      lavados_membresia: rec.lavados_membresia,
      total_realizados: totalRealizados,
      dias_trabajados: diasTrabajados,
      servicios_por_dia: Number((totalRealizados / diasTrabajados).toFixed(1)),
      monto_generado: Math.round(rec.monto_generado),
      prev_total: prevTotal,
      variacion_pct: variacionPct
    });
  }

  rows.sort((a, b) => b.total_realizados - a.total_realizados || b.monto_generado - a.monto_generado);
  const teamTotalRealizados = rows.reduce((s, r) => s + r.total_realizados, 0);
  rows.forEach((r, idx) => {
    r.rank = idx + 1;
    r.participacion_pct = teamTotalRealizados > 0 ? Number(((r.total_realizados / teamTotalRealizados) * 100).toFixed(1)) : 0;
  });

  console.table(rows.slice(0, 15));
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
