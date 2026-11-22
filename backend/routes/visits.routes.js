const express = require('express');
const { createQuarantineGuard } = require('../middleware/quarantine.middleware.cjs');
const { createIdempotencyMiddleware } = require('../middleware/idempotency.middleware.cjs');
const { getBranchScope, isBranchAuthorized } = require('../middleware/rbac.middleware');
const { permissionMapGrants } = require('../domain/rbac_catalog');
const { buildCanonicalAppliedPayments } = require('../services/cash_register_aggregation.service');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(value) {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}

/**
 * Resuelve el UUID canónico de un producto de catálogo en una línea del carrito POS.
 * Separa identificadores temporales de UI (ej. Date.now()+Math.random()) de IDs persistidos.
 * Nunca fabrica un UUID arbitrario cuando falta la referencia real.
 */
function resolveCanonicalProductId(item) {
  if (!item || typeof item !== 'object') return null;
  const candidates = [item.product_id, item.service_id, item.id];
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null && isValidUuid(String(candidate))) {
      return String(candidate).trim();
    }
  }
  return null;
}

function createVisitsRouter(pool, helpers = {}) {
  const router = express.Router();
  const { sendSurveyEmail, inventoryService } = helpers;

  // Fail-Closed Quarantine Protection Guard on Visits
  router.use('/:id', createQuarantineGuard(pool, 'visits', 'id'));

  // Multi-Tenant Financial Idempotency Guard (charges, checkouts, voids)
  router.use(createIdempotencyMiddleware());

  // Helper: Generate sequential ticket number per branch within the tenant (atomic on last_sequence)
  const getNextTicketNumber = async (salonId = 1, tenantId = null) => {
    const cleanSalonId = String(salonId || '1');
    const prefix = (cleanSalonId === '2' || cleanSalonId === '4') ? 'VM' : 'SD';
    try {
      const [rows] = await pool.query(
        `INSERT INTO ticket_sequences (tenant_id, salon_id, prefix, last_sequence)
         VALUES (?, ?, ?, 1)
         ON CONFLICT (tenant_id, salon_id)
         DO UPDATE SET last_sequence = COALESCE(ticket_sequences.last_sequence, 0) + 1
         RETURNING last_sequence`,
        [tenantId, cleanSalonId, prefix]
      );
      const nextNum = parseInt(rows?.[0]?.last_sequence, 10) || 1;
      return `${prefix}-${String(nextNum).padStart(5, '0')}`;
    } catch (e) {
      // Fallback en caso de índice único legacy solo sobre salon_id
      try {
        const [upd] = await pool.query(
          `UPDATE ticket_sequences
           SET last_sequence = COALESCE(last_sequence, 0) + 1
           WHERE tenant_id = ? AND salon_id = ?
           RETURNING last_sequence`,
          [tenantId, cleanSalonId]
        );
        if (upd && upd.length > 0) {
          const nextNum = parseInt(upd[0].last_sequence, 10) || 1;
          return `${prefix}-${String(nextNum).padStart(5, '0')}`;
        }
      } catch (_) { }
      return `${prefix}-${Date.now().toString().slice(-5)}`;
    }
  };

  // Helper: Batch calculate and persist employee commissions for visits (O(1) database queries, no N+1)
  // Categoría -> Esquema/Regla -> Empleado -> Línea vendida -> Factura -> Comisión/Descuento persistido
  const processBatchVisitCommissions = async (visits, tenantId, dbConn = null) => {
    const db = dbConn || pool;
    try {
      if (!Array.isArray(visits) || visits.length === 0 || !tenantId) return { processed: 0, items: 0 };
      const resolvedTenantId = tenantId;

      const isInvalidEmployeeName = (n) => {
        if (!n) return true;
        const clean = String(n).trim().toLowerCase();
        return ['', 'no asignada', 'no asignado', 'sin asignar', 'n/a', 'none', 'null', 'undefined'].includes(clean);
      };

      const rawVisitIds = visits.filter((v) => v && v.id).map((v) => String(v.id));
      if (rawVisitIds.length === 0) return { processed: 0, items: 0 };

      // 0. Proteger comisiones ya liquidadas/pagadas: nunca sobreescribir visitas con status 'Pagado'/'Pagada'
      const phCheck = rawVisitIds.map(() => '?').join(', ');
      const [paidRows] = await db.query(
        `SELECT DISTINCT visit_id FROM employee_commissions_log
         WHERE tenant_id = ? AND visit_id IN (${phCheck}) AND (status IN ('Pagado', 'Pagada') OR payout_id IS NOT NULL)`,
        [resolvedTenantId, ...rawVisitIds]
      ).catch(() => [[]]);
      const lockedVisitIds = new Set((paidRows || []).map((r) => String(r.visit_id)));

      const preparedItems = [];
      const visitIds = [];

      for (const v of visits) {
        if (!v || !v.id) continue;
        const vid = String(v.id);
        if (lockedVisitIds.has(vid)) continue;
        visitIds.push(vid);

        let items = [];
        try {
          items = typeof v.items_detail === 'string' ? JSON.parse(v.items_detail) : (v.items_detail || []);
        } catch (_) {
          items = [];
        }
        if (!Array.isArray(items) || items.length === 0) continue;

        // Calcular subtotal bruto y descuentos por línea para distribuir cualquier descuento global de la factura
        let sumGross = 0;
        let sumLineDiscounts = 0;
        const normalizedLines = items.map((item) => {
          const qty = Math.max(1, Number(item.cantidad ?? item.qty ?? item.quantity ?? 1) || 1);
          const appliedUnit = Number(
            item.precioAplicado !== undefined
              ? item.precioAplicado
              : (item.precio !== undefined ? item.precio : (item.price !== undefined ? item.price : (item.precioBase || 0)))
          ) || 0;
          const baseUnit = Number(item.precioBase !== undefined ? item.precioBase : appliedUnit) || appliedUnit;
          const grossLine = Number((baseUnit * qty).toFixed(2));
          let lineDisc = Number(item.descuento || 0);
          if (lineDisc <= 0 && Number(item.descuentoPercent) > 0) {
            lineDisc = Number((grossLine * (Number(item.descuentoPercent) / 100)).toFixed(2));
          } else if (lineDisc <= 0 && appliedUnit < baseUnit) {
            lineDisc = Number(((baseUnit - appliedUnit) * qty).toFixed(2));
          }
          sumGross += grossLine;
          sumLineDiscounts += lineDisc;
          return { item, qty, baseUnit, appliedUnit, grossLine, lineDisc };
        });

        const visitTotalDiscount = Number(v.descuento || 0);
        const extraGlobalDiscount = Math.max(0, Number((visitTotalDiscount - sumLineDiscounts).toFixed(2)));

        for (const { item, qty, baseUnit, appliedUnit, grossLine, lineDisc } of normalizedLines) {
          let empIdRaw = item.empleado_id ?? item.colaboradorId ?? item.employee_id ?? item.stylist_id ?? null;
          let empNameRaw = item.empleado_nombre ?? item.empleado ?? item.colaboradorNombre ?? item.colaborador ?? item.employee_name ?? null;

          // Si empleado_id contiene el nombre por legado y no es numérico, conservarlo como nombre también
          if (!empNameRaw && empIdRaw && isNaN(Number(String(empIdRaw).replace('EMP-', '')))) {
            empNameRaw = String(empIdRaw);
          }

          // Fallback a empleado_peluquera de la visita cuando la línea no especificó colaborador individual
          if ((!empIdRaw || String(empIdRaw).trim() === '') && isInvalidEmployeeName(empNameRaw)) {
            if (!isInvalidEmployeeName(v.empleado_peluquera)) {
              empNameRaw = String(v.empleado_peluquera).trim();
            }
          }

          const cleanEmpId = empIdRaw ? String(empIdRaw).replace('EMP-', '').trim() : '';
          const cleanEmpName = !isInvalidEmployeeName(empNameRaw) ? String(empNameRaw).trim() : '';
          if (!cleanEmpId && !cleanEmpName) continue;

          const serviceName = String(item.nombre || item.service_name || item.servicio || item.name || 'Servicio').trim();
          const serviceId = item.service_id || item.product_id || (typeof item.id === 'string' && item.id.length > 20 ? item.id : null);
          const propGlobalDisc = sumGross > 0 && extraGlobalDiscount > 0
            ? Number(((grossLine / sumGross) * extraGlobalDiscount).toFixed(2))
            : 0;
          const commercialDiscount = Number((lineDisc + propGlobalDisc).toFixed(2));

          preparedItems.push({
            visitId: vid,
            ticketNumber: v.ticket_number || vid,
            visitedAt: v.visited_at || new Date(),
            salonId: v.salon_id || null,
            empIdRaw: cleanEmpId || null,
            empNameRaw: cleanEmpName || null,
            serviceId: serviceId ? String(serviceId) : null,
            serviceName,
            itemCategory: item.categoria || item.category || null,
            isPlanWash: Boolean(item.isPlanWash),
            isProductItem:
              String(item.tipo_item || item.item_type || '').toUpperCase() === 'PRODUCTO' ||
              Boolean(item.is_product) ||
              Boolean(item.product_id),
            unitPrice: baseUnit > 0 ? baseUnit : appliedUnit,
            grossLine,
            commercialDiscount,
            cantidad: qty,
            aplicaItbis: item.aplica_itbis === 1 || item.aplica_itbis === true ? 1 : 0,
            taxMode: item.tax_mode || 'exclusive'
          });
        }
      }

      if (visitIds.length === 0) {
        return { processed: 0, items: 0 };
      }

      // Query 1: Batch delete pending commissions for these unlocked visits
      const placeholders = visitIds.map(() => '?').join(', ');
      await db.query(
        `DELETE FROM employee_commissions_log WHERE tenant_id = ? AND status = 'Pendiente' AND visit_id IN (${placeholders})`,
        [resolvedTenantId, ...visitIds]
      );

      if (preparedItems.length === 0) {
        return { processed: visitIds.length, items: 0 };
      }

      // Query 2: Preload all tenant staff_records, services, commission_categories, commission_schemes, commission_scheme_rules, employee_commission_rules
      const [
        [staffRows],
        [serviceRows],
        [categoryRows],
        [schemeRows],
        [schemeRuleRows],
        [empRuleRows]
      ] = await Promise.all([
        db.query(
          `SELECT id, nombre, localidad, salon_id, status, commission_scheme_id, scheme_effective_date, tipo_salario
           FROM staff_records WHERE tenant_id = ?`,
          [resolvedTenantId]
        ),
        db.query(
          `SELECT id::text as id, COALESCE(nombre, name) as service_name, COALESCE(categoria, category, 'General') as categoria,
                  commission_category_id, item_type, COALESCE(genera_comision, 1) as genera_comision,
                  COALESCE(tipo_comision, 'Porcentaje') as tipo_comision, comision_valor, commission_percentage,
                  COALESCE(aplica_itbis, 0) as aplica_itbis, COALESCE(tax_rate, 0.1800) as tax_rate, COALESCE(tax_mode, 'exclusive') as tax_mode
           FROM services WHERE tenant_id = ?`,
          [resolvedTenantId]
        ),
        db.query(
          `SELECT id, nombre, porcentaje, COALESCE(tipo, 'Porcentaje') as tipo, COALESCE(estado, 'Activa') as estado
           FROM commission_categories WHERE tenant_id = ?`,
          [resolvedTenantId]
        ).catch(() => [[]]),
        db.query(
          `SELECT id, nombre, tipo, percentage, fixed_amount, COALESCE(estado, 'Activo') as estado
           FROM commission_schemes WHERE tenant_id = ?`,
          [resolvedTenantId]
        ).catch(() => [[]]),
        db.query(
          `SELECT * FROM commission_scheme_rules WHERE tenant_id = ? ORDER BY prioridad ASC, id ASC`,
          [resolvedTenantId]
        ).catch(() => [[]]),
        db.query(
          `SELECT * FROM employee_commission_rules WHERE tenant_id = ?`,
          [resolvedTenantId]
        ).catch(() => [[]])
      ]);

      const staffMapById = new Map();
      const staffMapByName = new Map();
      for (const s of (staffRows || [])) {
        staffMapById.set(String(s.id), s);
        if (s.nombre) staffMapByName.set(String(s.nombre).trim().toLowerCase(), s);
      }

      const serviceMapById = new Map();
      const serviceMapByName = new Map();
      for (const srv of (serviceRows || [])) {
        if (srv.id) serviceMapById.set(String(srv.id), srv);
        if (srv.service_name) serviceMapByName.set(String(srv.service_name).trim().toLowerCase(), srv);
      }

      const categoryMapById = new Map();
      const categoryMapByName = new Map();
      for (const cat of (categoryRows || [])) {
        const isCatActive = ['activa', 'activo', 'active', '1'].includes(String(cat.estado || 'Activa').trim().toLowerCase());
        if (!isCatActive) continue;
        categoryMapById.set(Number(cat.id), cat);
        if (cat.nombre) categoryMapByName.set(String(cat.nombre).trim().toLowerCase(), cat);
      }

      const schemeMapById = new Map();
      for (const sch of (schemeRows || [])) {
        const isSchActive = ['activo', 'activa', 'active', '1'].includes(String(sch.estado || 'Activo').trim().toLowerCase());
        if (isSchActive) schemeMapById.set(Number(sch.id), sch);
      }

      const rulesBySchemeId = new Map();
      for (const r of (schemeRuleRows || [])) {
        const sid = Number(r.scheme_id);
        if (!rulesBySchemeId.has(sid)) rulesBySchemeId.set(sid, []);
        rulesBySchemeId.get(sid).push(r);
      }

      const empRulesMap = new Map();
      for (const er of (empRuleRows || [])) {
        const key = `${String(er.employee_id).trim()}::${String(er.service_name || 'General').trim().toLowerCase()}`;
        empRulesMap.set(key, er);
      }

      const insertRows = [];
      for (const item of preparedItems) {
        let emp = null;
        if (item.empIdRaw && staffMapById.has(item.empIdRaw)) {
          emp = staffMapById.get(item.empIdRaw);
        } else if (item.empNameRaw && staffMapByName.has(item.empNameRaw.toLowerCase())) {
          emp = staffMapByName.get(item.empNameRaw.toLowerCase());
        } else if (item.empIdRaw && staffMapByName.has(item.empIdRaw.toLowerCase())) {
          emp = staffMapByName.get(item.empIdRaw.toLowerCase());
        }
        if (!emp) continue;

        const srvKey = item.serviceName.toLowerCase();
        const srv = (item.serviceId && serviceMapById.get(item.serviceId)) || serviceMapByName.get(srvKey) || null;
        const isProduct = item.isProductItem || (srv && String(srv.item_type || '').toUpperCase() === 'PRODUCTO');
        const categoryName = String(item.itemCategory || srv?.categoria || 'General').trim();
        const categoryKey = categoryName.toLowerCase();

        // Base neta del ítem después del descuento comercial y sin ITBIS
        let netAfterCommercialDisc = Math.max(0, Number((item.grossLine - item.commercialDiscount).toFixed(2)));
        const effectiveTaxMode = srv?.tax_mode || item.taxMode || 'exclusive';
        const effectiveItbis = item.aplicaItbis || (srv && Number(srv.aplica_itbis) === 1);
        const effectiveTaxRate = Number(srv?.tax_rate ?? 0.18) || 0.18;
        if (effectiveItbis && effectiveTaxMode === 'inclusive' && effectiveTaxRate > 0) {
          netAfterCommercialDisc = Number((netAfterCommercialDisc / (1 + effectiveTaxRate)).toFixed(2));
        }

        // Verificar esquema asignado al empleado y vigencia (scheme_effective_date)
        const empSchemeId = emp.commission_scheme_id ? Number(emp.commission_scheme_id) : null;
        let schemeIsEffective = true;
        if (empSchemeId && emp.scheme_effective_date) {
          const toCalendarDay = (val) => {
            if (!val) return null;
            if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val.trim())) {
              return val.trim().slice(0, 10);
            }
            const d = new Date(val);
            if (Number.isNaN(d.getTime())) return null;
            return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(d);
          };
          const visitDay = toCalendarDay(item.visitedAt);
          const effectiveDay = toCalendarDay(emp.scheme_effective_date);
          if (visitDay && effectiveDay && visitDay < effectiveDay) {
            schemeIsEffective = false;
          }
        }
        const activeScheme = empSchemeId && schemeIsEffective && schemeMapById.has(empSchemeId) ? schemeMapById.get(empSchemeId) : null;
        const schemeRules = activeScheme ? (rulesBySchemeId.get(activeScheme.id) || []) : [];

        // Clasificar reglas del esquema según prioridad canónica:
        // 1) Regla Especial (rule_type === 'especial' o regla con monto_ajuste > 0 para ese servicio)
        // 2) Excepción por Servicio (rule_type === 'servicio')
        // 3) Regla por Categoría (rule_type === 'categoria')
        let matchedSpecialRule = null;
        let matchedServiceRule = null;
        let matchedCategoryRule = null;

        for (const r of schemeRules) {
          const rType = String(r.rule_type || '').trim().toLowerCase();
          const rService = r.service_name ? String(r.service_name).trim().toLowerCase() : '';
          const rCategory = r.category_name ? String(r.category_name).trim().toLowerCase() : '';
          const hasAdjust = Number(r.monto_ajuste || 0) > 0 && (r.operacion === 'Restar' || r.operacion === 'Sumar');

          if (!matchedSpecialRule && rType === 'especial' && rService === srvKey) {
            matchedSpecialRule = r;
          } else if (!matchedSpecialRule && hasAdjust && rService === srvKey && (!rCategory || rCategory === categoryKey)) {
            matchedSpecialRule = r;
          }

          if (!matchedServiceRule && rType === 'servicio' && rService === srvKey) {
            matchedServiceRule = r;
          }

          if (!matchedCategoryRule && rType === 'categoria' && rCategory === categoryKey) {
            matchedCategoryRule = r;
          }
        }

        const empSpecificRule =
          empRulesMap.get(`${emp.id}::${srvKey}`) ||
          empRulesMap.get(`${emp.nombre}::${srvKey}`) ||
          null;

        let tipoComision = 'Porcentaje';
        let comisionValor = 0;
        let commissionRate = 0;
        let descuentoAplicado = item.commercialDiscount;
        let montoBase = netAfterCommercialDisc;
        let montoComision = 0;
        let appliedSchemeId = activeScheme ? activeScheme.id : null;
        let ruleDescription = '';

        const isFixedType = (t) => String(t || '').toLowerCase().includes('fijo');

        if (item.isPlanWash && item.grossLine <= 0) {
          // Canje de lavado incluido en membresía a RD$ 0.00
          tipoComision = 'Porcentaje';
          comisionValor = 0;
          commissionRate = 0;
          montoBase = 0;
          montoComision = 0;
          ruleDescription = 'Canje Membresía (RD$ 0.00)';
        } else if (matchedSpecialRule) {
          const op = String(matchedSpecialRule.operacion || 'Restar').trim();
          if (op === 'Contar') {
            tipoComision = 'Monto_Fijo';
            comisionValor = 0;
            commissionRate = 0;
            montoComision = 0;
            ruleDescription = `Regla Especial Meta (${matchedSpecialRule.cantidad_meta} serv. -> Bono RD$${Number(matchedSpecialRule.bono_monto || 0).toFixed(2)})`;
          } else {
            const unitAdjust = Number(matchedSpecialRule.monto_ajuste || 0);
            const totalAdjust = Number((unitAdjust * item.cantidad).toFixed(2));
            const pct = Number(matchedSpecialRule.porcentaje_comision ?? matchedSpecialRule.valor ?? 0);
            tipoComision = 'Porcentaje';
            comisionValor = pct;
            commissionRate = pct;
            if (op === 'Sumar') {
              montoBase = Math.max(0, Number((netAfterCommercialDisc + totalAdjust).toFixed(2)));
              ruleDescription = `Regla Especial (${activeScheme.nombre}: +RD$${totalAdjust.toFixed(2)} -> ${pct}%)`;
            } else {
              descuentoAplicado = Number((item.commercialDiscount + totalAdjust).toFixed(2));
              montoBase = Math.max(0, Number((netAfterCommercialDisc - totalAdjust).toFixed(2)));
              ruleDescription = `Regla Especial (${activeScheme.nombre}: -RD$${totalAdjust.toFixed(2)} -> ${pct}%)`;
            }
            montoComision = Number(((montoBase * pct) / 100).toFixed(2));
          }
        } else if (matchedServiceRule) {
          const val = Number(matchedServiceRule.valor ?? matchedServiceRule.porcentaje_comision ?? 0);
          if (isFixedType(matchedServiceRule.tipo_calculo)) {
            tipoComision = 'Monto_Fijo';
            comisionValor = val;
            commissionRate = 0;
            montoComision = Number((val * item.cantidad).toFixed(2));
            ruleDescription = `Excepción Servicio (${activeScheme.nombre}: RD$${val.toFixed(2)})`;
          } else {
            tipoComision = 'Porcentaje';
            comisionValor = val;
            commissionRate = val;
            montoComision = Number(((montoBase * val) / 100).toFixed(2));
            ruleDescription = `Excepción Servicio (${activeScheme.nombre}: ${val}%)`;
          }
        } else if (empSpecificRule) {
          const val = Number(empSpecificRule.comision_valor || 0);
          if (isFixedType(empSpecificRule.tipo_comision)) {
            tipoComision = 'Monto_Fijo';
            comisionValor = val;
            commissionRate = 0;
            montoComision = Number((val * item.cantidad).toFixed(2));
          } else {
            tipoComision = 'Porcentaje';
            comisionValor = val;
            commissionRate = val;
            montoComision = Number(((montoBase * val) / 100).toFixed(2));
          }
          ruleDescription = `Regla Individual (${emp.nombre})`;
        } else if (matchedCategoryRule) {
          const unitAdjust = Number(matchedCategoryRule.monto_ajuste || 0);
          const totalAdjust = unitAdjust > 0 ? Number((unitAdjust * item.cantidad).toFixed(2)) : 0;
          const op = String(matchedCategoryRule.operacion || 'Restar').trim();
          if (totalAdjust > 0) {
            if (op === 'Sumar') {
              montoBase = Math.max(0, Number((netAfterCommercialDisc + totalAdjust).toFixed(2)));
            } else {
              descuentoAplicado = Number((item.commercialDiscount + totalAdjust).toFixed(2));
              montoBase = Math.max(0, Number((netAfterCommercialDisc - totalAdjust).toFixed(2)));
            }
          }
          const val = Number(matchedCategoryRule.valor ?? matchedCategoryRule.porcentaje_comision ?? 0);
          if (isFixedType(matchedCategoryRule.tipo_calculo)) {
            tipoComision = 'Monto_Fijo';
            comisionValor = val;
            commissionRate = 0;
            montoComision = Number((val * item.cantidad).toFixed(2));
            ruleDescription = `Esquema ${activeScheme.nombre} · Categoría ${categoryName} (RD$${val.toFixed(2)})`;
          } else {
            tipoComision = 'Porcentaje';
            comisionValor = val;
            commissionRate = val;
            montoComision = Number(((montoBase * val) / 100).toFixed(2));
            ruleDescription = totalAdjust > 0
              ? `Esquema ${activeScheme.nombre} · Categoría ${categoryName} (${op === 'Sumar' ? '+' : '-'}RD$${totalAdjust.toFixed(2)} -> ${val}%)`
              : `Esquema ${activeScheme.nombre} · Categoría ${categoryName} (${val}%)`;
          }
        } else {
          // Prioridad 4: Categoría de comisión del catálogo -> Configuración del ítem -> Esquema general -> Default
          const linkedCat =
            (srv?.commission_category_id && categoryMapById.get(Number(srv.commission_category_id))) ||
            categoryMapByName.get(categoryKey) ||
            null;

          if (srv && Number(srv.genera_comision) === 0) {
            tipoComision = 'Porcentaje';
            comisionValor = 0;
            commissionRate = 0;
            montoComision = 0;
            ruleDescription = 'Sin comisión (Deshabilitado en catálogo)';
          } else if (linkedCat) {
            const catVal = Number(linkedCat.porcentaje || 0);
            if (isFixedType(linkedCat.tipo)) {
              tipoComision = 'Monto_Fijo';
              comisionValor = catVal;
              commissionRate = 0;
              montoComision = Number((catVal * item.cantidad).toFixed(2));
            } else {
              tipoComision = 'Porcentaje';
              comisionValor = catVal;
              commissionRate = catVal;
              montoComision = Number(((montoBase * catVal) / 100).toFixed(2));
            }
            ruleDescription = `Categoría Catálogo: ${linkedCat.nombre} (${isFixedType(linkedCat.tipo) ? `RD$${catVal}` : `${catVal}%`})`;
          } else if (srv && srv.comision_valor !== undefined && srv.comision_valor !== null && (Number(srv.comision_valor) > 0 || !isProduct)) {
            const srvVal = Number(srv.comision_valor || 0);
            if (isFixedType(srv.tipo_comision)) {
              tipoComision = 'Monto_Fijo';
              comisionValor = srvVal;
              commissionRate = 0;
              montoComision = Number((srvVal * item.cantidad).toFixed(2));
            } else {
              tipoComision = 'Porcentaje';
              comisionValor = srvVal;
              commissionRate = srvVal;
              montoComision = Number(((montoBase * srvVal) / 100).toFixed(2));
            }
            ruleDescription = `Catálogo: ${item.serviceName} (${isFixedType(srv.tipo_comision) ? `RD$${srvVal}` : `${srvVal}%`})`;
          } else if (activeScheme && Number(activeScheme.percentage || 0) > 0 && !isProduct) {
            const schPct = Number(activeScheme.percentage);
            tipoComision = 'Porcentaje';
            comisionValor = schPct;
            commissionRate = schPct;
            montoComision = Number(((montoBase * schPct) / 100).toFixed(2));
            ruleDescription = `Esquema General: ${activeScheme.nombre} (${schPct}%)`;
          } else {
            const fallbackPct = isProduct ? 0 : 15;
            tipoComision = 'Porcentaje';
            comisionValor = fallbackPct;
            commissionRate = fallbackPct;
            montoComision = Number(((montoBase * fallbackPct) / 100).toFixed(2));
            ruleDescription = isProduct
              ? 'Producto sin comisión configurada (0%)'
              : '⚠️ Fallback temporal (15%) — Sin regla configurada (pendiente decisión operador)';
          }
        }

        const commissionCents = Math.round(montoComision * 100);

        insertRows.push([
          resolvedTenantId,
          item.visitId,
          item.ticketNumber,
          Number(emp.id) || null,
          emp.nombre,
          item.serviceName,
          item.grossLine,
          item.grossLine,
          item.cantidad,
          descuentoAplicado,
          montoBase,
          tipoComision,
          comisionValor,
          commissionRate,
          montoComision,
          montoComision,
          commissionCents,
          'DOP',
          'Pendiente',
          emp.localidad || 'Principal',
          appliedSchemeId,
          ruleDescription,
          item.visitedAt
        ]);
      }

      // Query 4: Multi-row chunked INSERT (up to 150 rows per statement)
      const chunkSize = 150;
      for (let i = 0; i < insertRows.length; i += chunkSize) {
        const chunk = insertRows.slice(i, i + chunkSize);
        const rowPlaceholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const flatParams = chunk.flat();

        await db.query(
          `INSERT INTO employee_commissions_log (
             tenant_id, visit_id, ticket_number, employee_id, employee_name, service_name,
             service_price, precio_servicio, cantidad, descuento_aplicado, monto_base,
             tipo_comision, comision_valor, commission_rate, monto_comision, commission_amount,
             commission_cents, currency, status, localidad, scheme_id, rule_applied_description, created_at
           ) VALUES ${rowPlaceholders}`,
          flatParams
        );
      }

      return { processed: visitIds.length, items: insertRows.length };
    } catch (err) {
      if (dbConn) throw err;
      console.warn('[PROCESS BATCH COMMISSIONS WARN]:', err.message);
      return { error: err.message };
    }
  };

  // Single-visit helper delegates to the batch processor
  const processVisitCommissions = async (visitId, itemsDetailRaw, ticketNumber, visitedAt, tenantId, dbConn = null, extraVisitProps = {}) => {
    return processBatchVisitCommissions([{
      id: visitId,
      items_detail: itemsDetailRaw,
      ticket_number: ticketNumber,
      visited_at: visitedAt,
      ...extraVisitProps
    }], tenantId, dbConn);
  };

  // 1. GET /api/visits - List all visits for the authenticated tenant
  router.get('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { salon_id, status } = req.query;
      let query = `
        SELECT v.*,
               COALESCE(v.client_name, c.nombre, 'Cliente General') as resolved_client_name,
               COALESCE(c.cedula, v.rnc_cliente) as client_cedula,
               COALESCE(b.name, s.name, 'Sucursal Principal') as salon_name
        FROM visits v
        LEFT JOIN clients c ON v.client_id = c.id AND c.tenant_id = v.tenant_id
        LEFT JOIN branches b ON v.salon_id::text = b.id::text AND b.tenant_id = v.tenant_id
        LEFT JOIN salons s ON v.salon_id::text = s.id::text AND s.tenant_id = v.tenant_id
        WHERE v.tenant_id = ?
      `;
      const params = [tenantId];

      const scope = getBranchScope(req);
      if (!scope.allBranches) {
        if (salon_id && salon_id !== 'all') {
          if (!isBranchAuthorized(req, salon_id)) {
            return res.status(403).json({ error: 'No tienes acceso autorizado a la sucursal solicitada.', code: 'BRANCH_ACCESS_DENIED' });
          }
          query += ' AND v.salon_id::text = ?';
          params.push(String(salon_id));
        } else {
          if (scope.branchIds.length === 0) return res.json([]);
          const placeholders = scope.branchIds.map(() => '?').join(', ');
          query += ` AND v.salon_id::text IN (${placeholders})`;
          params.push(...scope.branchIds);
        }
      } else if (salon_id && salon_id !== 'all') {
        query += ' AND v.salon_id::text = ?';
        params.push(String(salon_id));
      }
      if (status) {
        query += ' AND v.status = ?';
        params.push(status);
      }

      query += ' ORDER BY v.visited_at DESC LIMIT 500';
      const [rows] = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      console.error('[VISITS GET ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 2. GET /api/visits/pending - Active open tickets in reception/POS for the authenticated tenant
  router.get('/pending', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { salon_id } = req.query;
      const scope = getBranchScope(req);

      if (salon_id && salon_id !== 'all' && !isBranchAuthorized(req, salon_id)) {
        return res.status(403).json({
          error: 'No tienes autorización para consultar tickets pendientes de esta sucursal.',
          code: 'BRANCH_ACCESS_DENIED'
        });
      }

      let query = `
        SELECT v.*,
               COALESCE(v.client_name, c.nombre, 'Cliente General') as client_name,
               c.cedula as client_cedula,
               c.telefono as client_phone
        FROM visits v
        LEFT JOIN clients c ON v.client_id::text = c.id::text AND c.tenant_id = v.tenant_id
        WHERE v.tenant_id = ? AND v.status IN ('Pendiente', 'Abierto', 'En Proceso', 'Pre-cuenta')
      `;
      const params = [tenantId];

      if (salon_id && salon_id !== 'all') {
        query += ' AND v.salon_id::text = ?';
        params.push(String(salon_id));
      } else if (!scope.allBranches && Array.isArray(scope.branchIds) && scope.branchIds.length > 0) {
        const ph = scope.branchIds.map(() => '?').join(', ');
        query += ` AND v.salon_id::text IN (${ph})`;
        params.push(...scope.branchIds.map(String));
      }

      query += ' ORDER BY v.visited_at DESC';
      const [rows] = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. GET /api/visits/client/:clientId - Visits for a specific client within the authenticated tenant
  router.get('/client/:clientId', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { clientId } = req.params;
      const cleanCedula = String(clientId).replace(/\D/g, '');
      const [rows] = await pool.query(`
        SELECT v.*, COALESCE(b.name, s.name, 'Sucursal Principal') as salon_name
        FROM visits v
        LEFT JOIN clients c ON v.client_id = c.id AND c.tenant_id = v.tenant_id
        LEFT JOIN branches b ON v.salon_id::text = b.id::text AND b.tenant_id = v.tenant_id
        LEFT JOIN salons s ON v.salon_id::text = s.id::text AND s.tenant_id = v.tenant_id
        WHERE v.tenant_id = ?
          AND (v.client_id = ?
           OR v.client_name = ?
           OR c.cedula = ?
           OR (LENGTH(?) >= 8 AND REPLACE(c.cedula, '-', '') = ?))
        ORDER BY v.visited_at DESC
      `, [tenantId, clientId, clientId, clientId, cleanCedula, cleanCedula]);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. POST /api/visits/ticket - Open a new pending ticket in reception within the authenticated tenant
  const isSpecialGuestOrEmpClientId = (cid) => {
    if (!cid) return true;
    const s = String(cid).trim().toUpperCase();
    return s === '' || s === 'INVITADO' || s === 'EMPLEADO' || s.startsWith('INVITADO') || s.startsWith('EMP-');
  };

  router.post('/ticket', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const {
        client_id,
        clientId,
        client_name,
        clientName,
        salon_id,
        salonId,
        servicios = [],
        items_detail = [],
        draft_data = {},
        total = 0,
        recepcionista,
        empleado_peluquera,
        empleadoPeluquera,
        empleado_lava_pelo = 'No asignada',
        empleado_manicurista = 'No asignada',
        notes,
        nota,
        client_request_id
      } = req.body || {};

      const targetSalon = String(salon_id || salonId || req.auth?.branchId || '1');
      if (!isBranchAuthorized(req, targetSalon)) {
        return res.status(403).json({
          error: 'No tienes autorización para crear tickets en esta sucursal.',
          code: 'BRANCH_ACCESS_DENIED'
        });
      }

      const targetClient = client_id || clientId || null;
      if (!isSpecialGuestOrEmpClientId(targetClient)) {
        const [clientRows] = await pool.query(
          'SELECT id FROM clients WHERE id::text = ? AND tenant_id = ? LIMIT 1',
          [String(targetClient), tenantId]
        );
        if (!clientRows || clientRows.length === 0) {
          return res.status(404).json({
            error: 'El cliente especificado no pertenece a esta empresa.',
            code: 'CLIENT_NOT_FOUND'
          });
        }
      }

      const reqIdemKey = String(req.headers['idempotency-key'] || client_request_id || '').trim();
      if (reqIdemKey) {
        const [existingDup] = await pool.query(
          `SELECT * FROM visits
           WHERE tenant_id = ? AND status IN ('Pendiente', 'Abierto', 'En Proceso', 'Pre-cuenta')
             AND draft_data->>'client_request_id' = ?
           ORDER BY visited_at DESC LIMIT 1`,
          [tenantId, reqIdemKey]
        );
        if (existingDup && existingDup.length > 0) {
          const row = existingDup[0];
          return res.status(200).json({
            success: true,
            id: row.id,
            ticket_number: row.ticket_number,
            ticketNumber: row.ticket_number,
            salon_id: row.salon_id,
            status: row.status,
            idempotent: true
          });
        }
      }

      const targetClientName = String(client_name || clientName || 'Cliente General').trim() || 'Cliente General';
      const actorName = String(req.auth?.name || req.auth?.email || recepcionista || 'Recepción').trim();
      const actorId = req.auth?.userId || req.user?.id || null;
      const targetPeluquera = empleado_peluquera || empleadoPeluquera || 'No asignada';
      const targetNota = nota !== undefined ? String(nota) : (notes !== undefined ? String(notes) : '');
      const numTotal = Number(total) || 0;
      const totalCents = Math.round(numTotal * 100);

      const safeDraftObj = (draft_data && typeof draft_data === 'object' && !Array.isArray(draft_data))
        ? { ...draft_data }
        : {};
      safeDraftObj.recepcionista = actorName;
      if (actorId) safeDraftObj.actor_id = String(actorId);
      if (reqIdemKey) safeDraftObj.client_request_id = reqIdemKey;

      const visitId = `VIS-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
      const ticketNumber = await getNextTicketNumber(targetSalon, tenantId);

      await pool.query(
        `INSERT INTO visits (
           id, tenant_id, ticket_number, client_id, client_name, salon_id,
           servicios, items_detail, draft_data, total, total_cents, currency, status,
           empleado_peluquera, empleado_lava_pelo, empleado_manicurista, nota, visited_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?, 'DOP', 'Pendiente', ?, ?, ?, ?, NOW())`,
        [
          visitId,
          tenantId,
          ticketNumber,
          targetClient,
          targetClientName,
          targetSalon,
          JSON.stringify(Array.isArray(servicios) ? servicios : []),
          JSON.stringify(Array.isArray(items_detail) ? items_detail : []),
          JSON.stringify(safeDraftObj),
          numTotal,
          totalCents,
          targetPeluquera,
          empleado_lava_pelo,
          empleado_manicurista,
          targetNota
        ]
      );

      res.status(201).json({
        success: true,
        id: visitId,
        ticket_number: ticketNumber,
        ticketNumber: ticketNumber,
        salon_id: targetSalon,
        status: 'Pendiente'
      });
    } catch (err) {
      console.error('[CREATE PENDING TICKET ERROR]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 5. PUT /api/visits/:id/draft - Update draft / pending ticket items and staff before checkout
  router.put('/:id/draft', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const {
        client_id,
        client_name,
        servicios,
        items_detail,
        draft_data,
        total,
        empleado_peluquera,
        empleado_lava_pelo,
        empleado_manicurista,
        notes,
        nota
      } = req.body || {};

      const [existingRows] = await pool.query(
        'SELECT id, status, salon_id, draft_data FROM visits WHERE id = ? AND tenant_id = ? LIMIT 1',
        [id, tenantId]
      );
      if (!existingRows || existingRows.length === 0) {
        return res.status(404).json({ error: 'Ticket no encontrado en esta empresa.', code: 'TICKET_NOT_FOUND' });
      }
      const existing = existingRows[0];
      if (existing.salon_id && !isBranchAuthorized(req, existing.salon_id)) {
        return res.status(403).json({ error: 'No tienes autorización para editar tickets de esta sucursal.', code: 'BRANCH_ACCESS_DENIED' });
      }
      const editableStatuses = new Set(['Pendiente', 'Abierto', 'En Proceso', 'Pre-cuenta']);
      if (!editableStatuses.has(String(existing.status || '').trim())) {
        return res.status(409).json({
          error: `Este ticket ya está en estado "${existing.status}" y no puede modificarse como borrador.`,
          code: 'TICKET_NOT_EDITABLE'
        });
      }

      let mergedDraftJson = null;
      if (draft_data !== undefined) {
        const prevDraft = (existing.draft_data && typeof existing.draft_data === 'object') ? existing.draft_data : {};
        const nextDraft = (typeof draft_data === 'string') ? JSON.parse(draft_data || '{}') : (draft_data || {});
        mergedDraftJson = JSON.stringify({ ...prevDraft, ...nextDraft });
      }

      const targetNota = nota !== undefined ? String(nota) : (notes !== undefined ? String(notes) : null);
      const numTotal = total !== undefined ? Number(total) : null;
      const totalCents = numTotal !== null && Number.isFinite(numTotal) ? Math.round(numTotal * 100) : null;

      await pool.query(
        `UPDATE visits SET
           client_id = COALESCE(?, client_id),
           client_name = COALESCE(?, client_name),
           servicios = COALESCE(?::jsonb, servicios),
           items_detail = COALESCE(?::jsonb, items_detail),
           draft_data = COALESCE(?::jsonb, draft_data),
           total = COALESCE(?, total),
           total_cents = COALESCE(?, total_cents),
           empleado_peluquera = COALESCE(?, empleado_peluquera),
           empleado_lava_pelo = COALESCE(?, empleado_lava_pelo),
           empleado_manicurista = COALESCE(?, empleado_manicurista),
           nota = COALESCE(?, nota)
         WHERE id = ? AND tenant_id = ? AND status IN ('Pendiente', 'Abierto', 'En Proceso', 'Pre-cuenta')`,
        [
          client_id !== undefined ? client_id : null,
          client_name !== undefined ? client_name : null,
          servicios !== undefined ? (typeof servicios === 'string' ? servicios : JSON.stringify(servicios)) : null,
          items_detail !== undefined ? (typeof items_detail === 'string' ? items_detail : JSON.stringify(items_detail)) : null,
          mergedDraftJson,
          numTotal,
          totalCents,
          empleado_peluquera !== undefined ? empleado_peluquera : null,
          empleado_lava_pelo !== undefined ? empleado_lava_pelo : null,
          empleado_manicurista !== undefined ? empleado_manicurista : null,
          targetNota,
          id,
          tenantId
        ]
      );

      res.json({ success: true, id, status: existing.status });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 6. POST /api/visits/precuenta - Save pre-bill thermal ticket state (NEVER consumes NCF, NEVER mutates invoiced visits)
  router.post('/precuenta', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id, ticket_id, servicios, items_detail, total } = req.body;
      const targetId = id || ticket_id;
      if (targetId) {
        const [existingRows] = await pool.query(
          'SELECT id, status, salon_id FROM visits WHERE id = ? AND tenant_id = ? LIMIT 1',
          [targetId, tenantId]
        );
        if (!existingRows || existingRows.length === 0) {
          return res.status(404).json({ error: 'Ticket no encontrado en esta empresa.', code: 'TICKET_NOT_FOUND' });
        }
        if (existingRows[0].salon_id && !isBranchAuthorized(req, existingRows[0].salon_id)) {
          return res.status(403).json({ error: 'No tienes autorización para modificar tickets de esta sucursal.', code: 'BRANCH_ACCESS_DENIED' });
        }
        const editableStatuses = new Set(['Pendiente', 'Abierto', 'En Proceso', 'Pre-cuenta']);
        if (!editableStatuses.has(String(existingRows[0].status || '').trim())) {
          return res.status(409).json({
            error: `Este ticket ya está en estado "${existingRows[0].status}" y no puede modificarse como precuenta.`,
            code: 'TICKET_NOT_EDITABLE'
          });
        }
        await pool.query(
          `UPDATE visits SET
             servicios = COALESCE(?, servicios),
             items_detail = COALESCE(?, items_detail),
             total = COALESCE(?, total),
             status = 'Pre-cuenta'
           WHERE id = ? AND tenant_id = ? AND status IN ('Pendiente', 'Abierto', 'En Proceso', 'Pre-cuenta')`,
          [
            servicios ? (typeof servicios === 'string' ? servicios : JSON.stringify(servicios)) : null,
            items_detail ? (typeof items_detail === 'string' ? items_detail : JSON.stringify(items_detail)) : null,
            total !== undefined ? Number(total) : null,
            targetId,
            tenantId
          ]
        );
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 7. POST /api/visits/:id/checkout - Complete POS Checkout, NCF assignment, Plan Beauty wash deduction & Commissions
  router.post('/:id/checkout', async (req, res) => {
    let txConn = null;
    let resolvedLocationId = null;
    const postCommitAlerts = [];
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const {
        client_id,
        client_name,
        salon_id = 1,
        servicios = [],
        items_detail = [],
        subtotal = 0,
        descuento = 0,
        total = 0,
        metodo_pago = 'Efectivo',
        pago_efectivo = 0,
        pago_tarjeta = 0,
        pago_transferencia = 0,
        ncf_type,
        rnc_cliente,
        rzn_soc_cliente,
        empleado_peluquera,
        empleado_lava_pelo,
        empleado_manicurista,
        recepcionista = 'Recepción',
        consume_wash = false,
        wash_count_to_consume = 0,
        cash_register_id = null,
        location_id = null
      } = req.body;

      // 1. Verificar autorización de sucursal
      if (!isBranchAuthorized(req, salon_id)) {
        return res.status(403).json({
          error: 'No tienes autorización para facturar en esta sucursal.',
          code: 'BRANCH_ACCESS_DENIED'
        });
      }

      // 2. Idempotencia natural y protección de tickets anulados
      const [existingRows] = await pool.query('SELECT * FROM visits WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      if (existingRows.length > 0 && String(existingRows[0].status || '').trim() === 'Anulado') {
        return res.status(409).json({
          error: 'No se puede facturar un ticket que fue anulado.',
          code: 'TICKET_VOIDED'
        });
      }
      if (existingRows.length > 0 && String(existingRows[0].status || '').trim() === 'Facturado') {
        return res.json({
          success: true,
          id,
          ticket_number: existingRows[0].ticket_number,
          ncf: existingRows[0].ncf || null,
          ncf_name: existingRows[0].ncf_name || null,
          status: 'Facturado',
          idempotent: true
        });
      }

      // 3. Validar integridad multi-tenant de client_id si es un cliente real (excluir invitados/empleados)
      if (!isSpecialGuestOrEmpClientId(client_id)) {
        const [clientRows] = await pool.query(
          'SELECT id FROM clients WHERE id::text = ? AND tenant_id = ? LIMIT 1',
          [String(client_id), tenantId]
        );
        if (!clientRows || clientRows.length === 0) {
          return res.status(404).json({
            error: 'El cliente especificado no pertenece a esta empresa.',
            code: 'CLIENT_NOT_FOUND'
          });
        }
      }

      // 4. Validar autorización de descuento manual (> 0) para actores no privilegiados
      const parsedDescuento = Number(descuento) || 0;
      if (parsedDescuento > 0) {
        const actorRole = String(req.auth?.role || req.user?.role || '').toLowerCase();
        const canApplyDiscount = actorRole === 'propietario' || actorRole === 'owner' || actorRole === 'admin' || Boolean(req.auth?.isSuperAdmin) || permissionMapGrants(req.auth?.permissions, 'pos.discounts.apply');
        if (!canApplyDiscount) {
          const providedPin = req.body?.admin_pin || req.body?.supervisor_pin || req.body?.pin || req.headers['x-admin-pin'];
          if (!providedPin) {
            return res.status(403).json({
              error: 'Se requiere autorización de administrador (PIN) para aplicar descuentos manuales.',
              code: 'DISCOUNT_PIN_REQUIRED'
            });
          }
          const [secRows] = await pool.query(
            'SELECT admin_pin, admin_pin_hash, active_otp_pin, otp_expires_at FROM security_settings WHERE tenant_id = ? LIMIT 1',
            [tenantId]
          );
          const sec = secRows && secRows[0] ? secRows[0] : null;
          const isOtpValid = Boolean(sec && sec.active_otp_pin && String(providedPin) === String(sec.active_otp_pin) && sec.otp_expires_at && new Date(sec.otp_expires_at) > new Date());
          let isMasterValid = false;
          const storedMaster = sec?.admin_pin_hash || sec?.admin_pin;
          if (storedMaster) {
            const { verifyPin } = require('../services/pin_security.service');
            const verifyRes = await verifyPin(String(providedPin), storedMaster);
            isMasterValid = verifyRes.matched;
          }
          if (!isMasterValid && !isOtpValid) {
            return res.status(401).json({
              error: 'PIN de administrador incorrecto para aplicar descuento.',
              code: 'INVALID_ADMIN_PIN'
            });
          }
        }
      }

      // 5. Validar que los colaboradores asignados en items_detail pertenezcan a la empresa
      const rawItemsForValidation = Array.isArray(items_detail) && items_detail.length > 0
        ? items_detail
        : (Array.isArray(servicios) ? servicios : []);
      for (const it of rawItemsForValidation) {
        const empIdRaw = it.empleado_id || it.colaboradorId || it.employee_id || it.stylist_id;
        if (empIdRaw && !isNaN(Number(String(empIdRaw).replace('EMP-', '').trim()))) {
          const cleanEmpId = String(empIdRaw).replace('EMP-', '').trim();
          const [empCheck] = await pool.query(
            'SELECT id FROM staff_records WHERE id::text = ? AND tenant_id = ? LIMIT 1',
            [cleanEmpId, tenantId]
          );
          if (!empCheck || empCheck.length === 0) {
            return res.status(404).json({
              error: 'El colaborador asignado no pertenece a esta empresa.',
              code: 'EMPLOYEE_NOT_FOUND'
            });
          }
        }
      }

      // 6. Validar caja abierta obligatoria dentro del tenant y sucursal (rechazar cerradas o inexistentes)
      let activeRegisterId = cash_register_id;
      if (activeRegisterId) {
        const [regCheck] = await pool.query(
          'SELECT id, status, branch_id, salon_id FROM cash_registers WHERE id::text = ? AND tenant_id = ? LIMIT 1',
          [String(activeRegisterId), tenantId]
        );
        if (!regCheck || regCheck.length === 0) {
          return res.status(404).json({
            error: 'La caja especificada no existe en esta empresa.',
            code: 'CASH_REGISTER_NOT_FOUND'
          });
        }
        const reg = regCheck[0];
        if (!isBranchAuthorized(req, reg.branch_id ?? reg.salon_id)) {
          return res.status(403).json({
            error: 'No tienes autorización para facturar en esta caja.',
            code: 'BRANCH_ACCESS_DENIED'
          });
        }
        if (String(reg.status || '').toLowerCase() !== 'abierta') {
          return res.status(409).json({
            error: 'No se pueden registrar ventas en una caja cerrada.',
            code: 'CASH_REGISTER_CLOSED'
          });
        }
      } else {
        const sid = String(salon_id || '1');
        const [regRows] = sid.length > 10
          ? await pool.query(
            "SELECT id FROM cash_registers WHERE tenant_id = ? AND status = 'Abierta' AND (branch_id::text = ? OR salon_id::text = ?) ORDER BY opened_at DESC LIMIT 1",
            [tenantId, sid, sid]
          )
          : await pool.query(
            "SELECT id FROM cash_registers WHERE tenant_id = ? AND status = 'Abierta' AND (salon_id::text = ? OR salon_id IS NULL) ORDER BY opened_at DESC LIMIT 1",
            [tenantId, sid]
          );
        if (regRows.length > 0) {
          activeRegisterId = regRows[0].id;
        } else if (process.env.NODE_ENV !== 'test' || req.body?.require_open_register !== false) {
          const [anyReg] = await pool.query(
            'SELECT id FROM cash_registers WHERE tenant_id = ? LIMIT 1',
            [tenantId]
          );
          if (anyReg.length > 0 || req.body?.require_open_register === true) {
            return res.status(400).json({
              error: 'Debe abrir una caja en esta sucursal antes de facturar.',
              code: 'CASH_REGISTER_REQUIRED'
            });
          }
        }
      }

      // Resolver ubicación de inventario de la sucursal ANTES de abrir la transacción (sin fallback a otra sucursal)
      const productLines = [];
      if (inventoryService) {
        const rawItems = Array.isArray(items_detail) && items_detail.length > 0
          ? items_detail
          : (Array.isArray(servicios) ? servicios : []);

        for (const [idx, it] of rawItems.entries()) {
          const isProduct = String(it.tipo_item || it.item_type || '').toUpperCase() === 'PRODUCTO' || it.is_product || Boolean(it.product_id);
          if (isProduct) {
            const pId = resolveCanonicalProductId(it);
            const q = Number(it.cantidad || it.qty || it.quantity || 1);
            if (!pId) {
              return res.status(400).json({
                error: 'Uno de los productos del carrito no tiene un identificador de catálogo válido. Retíralo y vuelve a seleccionarlo desde el catálogo.',
                code: 'INVALID_PRODUCT_ID',
                field: 'items_detail.product_id',
                line_index: idx
              });
            }
            if (q > 0) {
              productLines.push({ productId: pId, quantity: q, lineId: idx });
            }
          }
        }

        if (productLines.length > 0) {
          if (location_id) {
            if (!isValidUuid(String(location_id))) {
              return res.status(400).json({
                error: 'El identificador de ubicación de inventario es inválido.',
                code: 'INVALID_LOCATION_ID',
                field: 'location_id'
              });
            }
            resolvedLocationId = String(location_id).trim();
          } else {
            try {
              const branchLoc = await inventoryService.getDefaultLocation(tenantId, salon_id);
              resolvedLocationId = branchLoc?.id || null;
            } catch (locErr) {
              if (locErr.code === 'BRANCH_LOCATION_NOT_FOUND') {
                return res.status(404).json({ error: locErr.message, code: 'BRANCH_LOCATION_NOT_FOUND' });
              }
              throw locErr;
            }
          }
        }
      }

      let ticketNumber = existingRows[0]?.ticket_number;
      if (!ticketNumber) {
        ticketNumber = await getNextTicketNumber(salon_id, tenantId);
      }

      const serializedServices = typeof servicios === 'string' ? servicios : JSON.stringify(servicios);
      const serializedItems = typeof items_detail === 'string' ? items_detail : JSON.stringify(items_detail);

      // === TRANSACCIÓN ÚNICA ATÓMICA (STOCK + NCF + VENTA + MEMBRESÍA + COMISIONES) ===
      // Si el proceso cae (SIGKILL/corte) antes del COMMIT, PostgreSQL revierte todo automáticamente.
      if (typeof pool.getConnection === 'function') {
        txConn = await pool.getConnection();
        await txConn.query('BEGIN');
        await txConn.query("SET LOCAL lock_timeout = '5s'");
      }
      const db = txConn || pool;

      // Re-verificar idempotencia y anulación bajo bloqueo dentro de la transacción
      const [txExisting] = await db.query(
        'SELECT id, status, ticket_number, ncf, ncf_name FROM visits WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [id, tenantId]
      );
      if (txExisting.length > 0 && String(txExisting[0].status || '').trim() === 'Anulado') {
        if (txConn) await txConn.query('ROLLBACK');
        return res.status(409).json({
          error: 'No se puede facturar un ticket que fue anulado.',
          code: 'TICKET_VOIDED'
        });
      }
      if (txExisting.length > 0 && String(txExisting[0].status || '').trim() === 'Facturado') {
        if (txConn) await txConn.query('COMMIT');
        return res.json({
          success: true,
          id,
          ticket_number: txExisting[0].ticket_number,
          ncf: txExisting[0].ncf || null,
          ncf_name: txExisting[0].ncf_name || null,
          status: 'Facturado',
          idempotent: true
        });
      }

      // 7. Descuento atómico de inventario dentro de la MISMA transacción
      if (inventoryService && productLines.length > 0) {
        for (const line of productLines) {
          try {
            const dedRes = await inventoryService.recordSaleDeduction(tenantId, {
              productId: line.productId,
              locationId: resolvedLocationId,
              quantity: line.quantity,
              visitId: id,
              lineId: line.lineId,
              userId: req.auth?.userId || req.user?.id || null,
              userName: req.auth?.name || req.user?.name || recepcionista,
              txConn
            });
            if (dedRes && !dedRes.skipped && !dedRes.idempotent) {
              postCommitAlerts.push({ productId: line.productId, locationId: dedRes.location_id || resolvedLocationId });
            }
          } catch (invErr) {
            if (txConn) { try { await txConn.query('ROLLBACK'); } catch (_) { } }
            if (invErr.code === 'INSUFFICIENT_STOCK' || invErr.code === 'PRODUCT_ARCHIVED') {
              return res.status(400).json({
                error: invErr.message,
                code: invErr.code,
                product_id: line.productId
              });
            }
            if (invErr.code === 'NOT_FOUND') {
              return res.status(404).json({
                error: invErr.message,
                code: 'PRODUCT_NOT_FOUND',
                product_id: line.productId
              });
            }
            throw invErr;
          }
        }
      }

      // Hook controlado exclusivamente para pruebas de atomicidad/caída tras descuento de stock (requiere autorización explícita en entorno test)
      const allowTestFaultInjection =
        process.env.NODE_ENV === 'test' &&
        process.env.ALLOW_TEST_FAULT_INJECTION === 'true';
      if (allowTestFaultInjection && req.headers['x-test-fail-after-stock'] === 'true') {
        throw new Error('SIMULATED_PERSISTENCE_FAILURE_AFTER_STOCK');
      }
      if (allowTestFaultInjection && req.headers['x-test-abort-connection-after-stock'] === 'true' && txConn) {
        // Simular caída abrupta sin COMMIT ni catch-void: liberar/destruir conexión directamente (PG hace ROLLBACK automático)
        if (typeof txConn.release === 'function') {
          try { txConn.release(true); } catch (_) { try { txConn.release(); } catch (__) { } }
        }
        txConn = null;
        return res.status(503).json({ error: 'SIMULATED_PROCESS_CRASH_ABORT', code: 'SIMULATED_CRASH' });
      }

      // 8. Secuencia de comprobante atómica dentro de la transacción
      // Regla de producto:
      // - Comprobantes comerciales/NCF tradicionales (B01, B02, B14, B15, etc.) funcionan sin integración electrónica DGII.
      // - Comprobantes electrónicos e-CF (E31, E32, E33, E34, etc.) quedan bloqueados salvo que la integración e-CF esté contratada y habilitada.
      let assignedNcf = null;
      let assignedNcfName = null;
      const normalizedNcfType = String(ncf_type || '').trim().toUpperCase();
      const isElectronicType = /^E\d{2}$/i.test(normalizedNcfType);
      const dgiiEmissionEnabled =
        process.env.DGII_ENABLED === 'true' &&
        String(process.env.DGII_MODE || '').toLowerCase() !== 'disabled' &&
        String(process.env.DGII_ENV || '').toLowerCase() !== 'disabled';

      if (normalizedNcfType && normalizedNcfType !== 'NONE' && normalizedNcfType !== '00') {
        if (isElectronicType && !dgiiEmissionEnabled) {
          if (txConn) await txConn.query('ROLLBACK');
          return res.status(409).json({
            error: `La emisión de comprobantes electrónicos (${normalizedNcfType}) requiere la integración de facturación electrónica DGII contratada y habilitada por separado. Utilice un comprobante comercial/NCF tradicional (ej. B02, B01) o facture sin comprobante.`,
            code: 'NCF_ECF_INTEGRATION_REQUIRED',
            tipo_comprobante: normalizedNcfType,
          });
        }

        const [allTypeSeqs] = await db.query(
          `SELECT * FROM dgii_ncf_sequences
           WHERE tenant_id = ? AND tipo_comprobante = ?
           ORDER BY id ASC
           FOR UPDATE`,
          [tenantId, normalizedNcfType]
        );

        if (allTypeSeqs.length === 0) {
          if (txConn) await txConn.query('ROLLBACK');
          return res.status(409).json({
            error: `No existe una secuencia configurada para el comprobante ${normalizedNcfType}. Configure una secuencia válida o facture sin comprobante.`,
            code: 'NCF_SEQUENCE_NOT_CONFIGURED',
            tipo_comprobante: normalizedNcfType,
          });
        }

        const todayStr = new Date().toISOString().slice(0, 10);
        const activeSeqs = allTypeSeqs.filter((s) => s.estado === 'Activo' || s.estado === '1');
        const nonExpiredSeqs = activeSeqs.filter((s) => {
          if (!s.fecha_vencimiento) return true;
          const expStr = typeof s.fecha_vencimiento === 'string'
            ? s.fecha_vencimiento.slice(0, 10)
            : new Date(s.fecha_vencimiento).toISOString().slice(0, 10);
          return expStr >= todayStr;
        });
        const availableSeq = nonExpiredSeqs.find((s) => {
          const desde = Number(s.secuencia_desde || 1);
          const actual = Number(s.secuencia_actual || desde);
          const hasta = Number(s.secuencia_hasta || 0);
          return actual >= desde && actual <= hasta;
        });

        if (!availableSeq) {
          if (txConn) await txConn.query('ROLLBACK');
          if (activeSeqs.length > 0 && nonExpiredSeqs.length === 0) {
            return res.status(409).json({
              error: `La secuencia configurada para ${normalizedNcfType} está vencida. Registre una nueva secuencia vigente antes de facturar.`,
              code: 'NCF_SEQUENCE_EXPIRED',
              tipo_comprobante: normalizedNcfType,
            });
          }
          return res.status(409).json({
            error: `La secuencia configurada para ${normalizedNcfType} está agotada o inactiva. Registre un nuevo rango autorizado antes de facturar.`,
            code: 'NCF_SEQUENCE_EXHAUSTED',
            tipo_comprobante: normalizedNcfType,
          });
        }

        const nextNum = Number(availableSeq.secuencia_actual || availableSeq.secuencia_desde || 1);
        const maxNum = Number(availableSeq.secuencia_hasta || 0);
        const rawSerie = String(availableSeq.serie || availableSeq.tipo_comprobante || normalizedNcfType).trim().toUpperCase();
        const prefix = rawSerie.length <= 1 ? normalizedNcfType : rawSerie;
        const padLen = prefix.startsWith('E') ? 10 : 8;
        assignedNcf = `${prefix}${String(nextNum).padStart(padLen, '0')}`;
        assignedNcfName = availableSeq.nombre_comprobante || normalizedNcfType;

        const [dupNcf] = await db.query(
          'SELECT id FROM visits WHERE tenant_id = ? AND ncf = ? LIMIT 1',
          [tenantId, assignedNcf]
        );
        if (dupNcf.length > 0) {
          if (txConn) await txConn.query('ROLLBACK');
          return res.status(409).json({
            error: `El número de comprobante ${assignedNcf} ya fue asignado previamente en esta empresa.`,
            code: 'NCF_DUPLICATE_NUMBER',
            tipo_comprobante: normalizedNcfType,
          });
        }

        const newSecuenciaActual = nextNum + 1;
        const newCantidadUsada = Number(availableSeq.cantidad_usada || 0) + 1;
        const newEstado = (maxNum > 0 && newSecuenciaActual > maxNum) ? 'Agotado' : 'Activo';

        await db.query(
          `UPDATE dgii_ncf_sequences
           SET secuencia_actual = ?, cantidad_usada = ?, estado = ?
           WHERE id = ? AND tenant_id = ?`,
          [newSecuenciaActual, newCantidadUsada, newEstado, availableSeq.id, tenantId]
        );
      }

      // 9. Persistencia de la venta (visits) con unidades menores exactas y snapshot fiscal de ITBIS / Descuentos (Bloques 1 y 5)
      let parsedItemsList = [];
      try {
        parsedItemsList = typeof items_detail === 'string' ? JSON.parse(items_detail) : (Array.isArray(items_detail) ? items_detail : []);
      } catch (_) {
        parsedItemsList = [];
      }

      // Enriquecer cada ítem con su clasificación fiscal del catálogo si no viene explícita y calcular subtotal/descuento/ITBIS desde backend
      let computedGrossSubtotal = 0;
      let computedLineDiscounts = 0;
      let computedItbis = 0;
      let computedExclusiveItbis = 0;

      if (parsedItemsList.length > 0) {
        const [catalogTaxRows] = await db.query(
          `SELECT id::text as id, LOWER(TRIM(COALESCE(nombre, name, ''))) as lower_name,
                  COALESCE(aplica_itbis, 0) as aplica_itbis, COALESCE(tax_rate, 0.1800) as tax_rate,
                  COALESCE(tax_mode, 'exclusive') as tax_mode, COALESCE(categoria, category, 'General') as categoria,
                  item_type, COALESCE(activo, 1) as activo, COALESCE(is_active, TRUE) as is_active
           FROM services WHERE tenant_id = ?`,
          [tenantId]
        );
        const catById = new Map();
        const catByName = new Map();
        for (const row of (catalogTaxRows || [])) {
          catById.set(String(row.id), row);
          if (row.lower_name) catByName.set(row.lower_name, row);
        }

        // Bloquear venta de productos o servicios archivados en facturas nuevas
        for (const it of parsedItemsList) {
          const sId = it.service_id || it.product_id || (typeof it.id === 'string' && it.id.length > 20 ? it.id : null);
          const sName = String(it.nombre || it.service_name || it.servicio || it.name || '').trim().toLowerCase();
          const catMatch = (sId && catById.get(String(sId))) || (sName && catByName.get(sName)) || null;
          if (catMatch && (Number(catMatch.activo) === 0 || catMatch.is_active === false)) {
            if (txConn) { try { await txConn.query('ROLLBACK'); } catch (_) { } }
            return res.status(400).json({
              error: `El ítem "${it.nombre || it.name || catMatch.lower_name}" está archivado y no puede agregarse a una venta nueva.`,
              code: 'ITEM_ARCHIVED',
              service_id: catMatch.id,
            });
          }
        }

        parsedItemsList = parsedItemsList.map((it) => {
          const sId = it.service_id || it.product_id || (typeof it.id === 'string' && it.id.length > 20 ? it.id : null);
          const sName = String(it.nombre || it.service_name || it.servicio || it.name || '').trim().toLowerCase();
          const catMatch = (sId && catById.get(String(sId))) || (sName && catByName.get(sName)) || null;

          const qty = Math.max(1, Number(it.cantidad ?? it.qty ?? it.quantity ?? 1) || 1);
          const appliedPrice = Number(
            it.precioAplicado !== undefined
              ? it.precioAplicado
              : (it.precio !== undefined ? it.precio : (it.price !== undefined ? it.price : (it.precioBase || 0)))
          ) || 0;
          const basePrice = Number(it.precioBase !== undefined ? it.precioBase : appliedPrice) || appliedPrice;
          const lineGross = Number((appliedPrice * qty).toFixed(2));

          let lineDisc = Number(it.descuento || 0);
          if (lineDisc <= 0 && Number(it.descuentoPercent) > 0) {
            lineDisc = Number((lineGross * (Number(it.descuentoPercent) / 100)).toFixed(2));
          }

          const itemAppliesItbis = it.aplica_itbis !== undefined && it.aplica_itbis !== null
            ? (it.aplica_itbis === 1 || it.aplica_itbis === true ? 1 : 0)
            : (catMatch ? (Number(catMatch.aplica_itbis) === 1 ? 1 : 0) : 0);
          const itemTaxMode = String(it.tax_mode || catMatch?.tax_mode || (itemAppliesItbis === 1 ? 'exclusive' : 'exempt')).toLowerCase();
          const rawRateVal = it.tax_rate !== undefined && it.tax_rate !== null
            ? Number(it.tax_rate)
            : (catMatch?.tax_rate !== undefined && catMatch?.tax_rate !== null ? Number(catMatch.tax_rate) : 0.18);
          const normalizedRate = Number.isFinite(rawRateVal)
            ? (rawRateVal > 1 ? rawRateVal / 100 : Math.max(0, rawRateVal))
            : 0.18;
          const itemTaxRate = (itemAppliesItbis === 1 && itemTaxMode !== 'exempt' && itemTaxMode !== 'zero')
            ? normalizedRate
            : 0;

          computedGrossSubtotal += lineGross;
          computedLineDiscounts += lineDisc;

          return {
            ...it,
            precioBase: basePrice,
            precioAplicado: appliedPrice,
            cantidad: qty,
            descuento: lineDisc,
            aplica_itbis: itemAppliesItbis,
            tax_rate: itemTaxRate,
            tax_mode: itemTaxMode,
            categoria: it.categoria || catMatch?.categoria || 'General',
            item_type: it.item_type || it.tipo_item || catMatch?.item_type || 'SERVICIO'
          };
        });

        const rawReqDiscount = Number(descuento) || 0;
        const effectiveTotalDiscount = Math.max(rawReqDiscount, Number(computedLineDiscounts.toFixed(2)));
        const extraGlobalDisc = Math.max(0, Number((effectiveTotalDiscount - computedLineDiscounts).toFixed(2)));

        parsedItemsList = parsedItemsList.map((it) => {
          const lineGross = Number((it.precioAplicado * it.cantidad).toFixed(2));
          const propGlobal = computedGrossSubtotal > 0 && extraGlobalDisc > 0
            ? Number(((lineGross / computedGrossSubtotal) * extraGlobalDisc).toFixed(2))
            : 0;
          const lineNetAfterDisc = Math.max(0, Number((lineGross - (it.descuento || 0) - propGlobal).toFixed(2)));

          let lineTaxableBase = lineNetAfterDisc;
          let lineItbis = 0;
          if (it.aplica_itbis === 1 && !it.isPlanWash && lineNetAfterDisc > 0 && it.tax_rate > 0) {
            if (it.tax_mode === 'inclusive') {
              lineTaxableBase = Number((lineNetAfterDisc / (1 + it.tax_rate)).toFixed(2));
              lineItbis = Number((lineNetAfterDisc - lineTaxableBase).toFixed(2));
            } else {
              lineItbis = Number((lineNetAfterDisc * it.tax_rate).toFixed(2));
              computedExclusiveItbis += lineItbis;
            }
          }
          computedItbis += lineItbis;

          return {
            ...it,
            taxable_base: lineTaxableBase,
            itbis_amount: lineItbis
          };
        });
      }

      const finalSerializedItems = parsedItemsList.length > 0 ? JSON.stringify(parsedItemsList) : serializedItems;
      const numSubtotal = Number(subtotal) > 0 ? Number(subtotal) : Number(computedGrossSubtotal.toFixed(2));
      const numDescuento = parsedDescuento > 0 ? parsedDescuento : Number(computedLineDiscounts.toFixed(2));
      const numItbis = req.body?.itbis !== undefined && Number(req.body.itbis) > 0
        ? Number(req.body.itbis)
        : Number(computedItbis.toFixed(2));
      const additiveItbis = parsedItemsList.length > 0
        ? Number(computedExclusiveItbis.toFixed(2))
        : numItbis;
      const numTotal = Number(total) > 0
        ? Number(total)
        : Math.max(0, Number((numSubtotal - numDescuento + additiveItbis).toFixed(2)));

      const subtotalCents = Math.round(numSubtotal * 100);
      const discountCents = Math.round(numDescuento * 100);
      const itbisCents = Math.round(numItbis * 100);
      const totalCents = Math.round(numTotal * 100);
      const appliedPaymentsJson = JSON.stringify(
        buildCanonicalAppliedPayments({
          applied_payments: req.body?.applied_payments,
          pago_efectivo,
          pago_tarjeta,
          pago_transferencia,
          metodo_pago,
          total_cents: totalCents,
          total: numTotal,
        })
      );

      if (txExisting.length > 0) {
        await db.query(
          `UPDATE visits SET
             client_id = COALESCE(?, client_id),
             client_name = COALESCE(?, client_name),
             salon_id = COALESCE(?, salon_id),
             servicios = ?,
             items_detail = ?,
             subtotal = ?,
             subtotal_cents = ?,
             descuento = ?,
             discount_cents = ?,
             itbis = ?,
             itbis_cents = ?,
             total = ?,
             total_cents = ?,
             currency = 'DOP',
             metodo_pago = ?,
             applied_payments = ?::jsonb,
             ncf = COALESCE(?, ncf),
             ncf_type = COALESCE(?, ncf_type),
             ncf_name = COALESCE(?, ncf_name),
             rnc_cliente = COALESCE(?, rnc_cliente),
             rzn_soc_cliente = COALESCE(?, rzn_soc_cliente),
             empleado_peluquera = COALESCE(?, empleado_peluquera),
             empleado_lava_pelo = COALESCE(?, empleado_lava_pelo),
             empleado_manicurista = COALESCE(?, empleado_manicurista),
             cash_register_id = COALESCE(?, cash_register_id),
             status = 'Facturado',
             visited_at = NOW()
           WHERE id = ? AND tenant_id = ?`,
          [
            client_id || null,
            client_name || null,
            String(salon_id),
            serializedServices,
            finalSerializedItems,
            numSubtotal,
            subtotalCents,
            numDescuento,
            discountCents,
            numItbis,
            itbisCents,
            numTotal,
            totalCents,
            metodo_pago,
            appliedPaymentsJson,
            assignedNcf,
            ncf_type || null,
            assignedNcfName,
            rnc_cliente || null,
            rzn_soc_cliente || null,
            empleado_peluquera || null,
            empleado_lava_pelo || null,
            empleado_manicurista || null,
            activeRegisterId ? String(activeRegisterId) : null,
            id,
            tenantId
          ]
        );
      } else {
        await db.query(
          `INSERT INTO visits (
             id, tenant_id, ticket_number, client_id, client_name, salon_id,
             servicios, items_detail, subtotal, subtotal_cents, descuento, discount_cents, itbis, itbis_cents, total, total_cents, currency,
             metodo_pago, applied_payments,
             ncf, ncf_type, ncf_name, rnc_cliente, rzn_soc_cliente,
             empleado_peluquera, empleado_lava_pelo, empleado_manicurista,
             cash_register_id, status, visited_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DOP', ?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Facturado', NOW())`,
          [
            id,
            tenantId,
            ticketNumber,
            client_id || null,
            client_name || 'Cliente General',
            String(salon_id),
            serializedServices,
            finalSerializedItems,
            numSubtotal,
            subtotalCents,
            numDescuento,
            discountCents,
            numItbis,
            itbisCents,
            numTotal,
            totalCents,
            metodo_pago,
            appliedPaymentsJson,
            assignedNcf,
            ncf_type || null,
            assignedNcfName,
            rnc_cliente || null,
            rzn_soc_cliente || null,
            empleado_peluquera || 'No asignada',
            empleado_lava_pelo || 'No asignada',
            empleado_manicurista || 'No asignada',
            activeRegisterId ? String(activeRegisterId) : null
          ]
        );
      }

      // 10. Deduct Plan Beauty washes if applicable (fail-closed when quota is 0 or no active contract)
      const targetClientId = client_id || existingRows[0]?.client_id;
      const planWashItemsCount = parsedItemsList.reduce(
        (acc, it) => acc + (it && it.isPlanWash ? (Number(it.cantidad || 1) || 1) : 0),
        0
      );
      const washesToDeduct = Math.max(
        Number(wash_count_to_consume) || (consume_wash ? 1 : 0),
        planWashItemsCount
      );
      if (washesToDeduct > 0) {
        if (!targetClientId) {
          if (txConn) await txConn.rollback();
          return res.status(409).json({
            error: 'Se requiere una clienta con membresía Plan Beauty activa para consumir lavados del plan.',
            code: 'PLAN_WASH_QUOTA_EXHAUSTED',
            available: 0,
            requested: washesToDeduct
          });
        }
        const [contracts] = await db.query(
          "SELECT * FROM contracts WHERE client_id = ? AND tenant_id = ? AND status IN ('Active', 'Activo') ORDER BY signed_at DESC LIMIT 1 FOR UPDATE",
          [targetClientId, tenantId]
        );
        if (contracts.length === 0) {
          if (txConn) await txConn.rollback();
          return res.status(409).json({
            error: 'La clienta no cuenta con un contrato Plan Beauty activo.',
            code: 'PLAN_WASH_QUOTA_EXHAUSTED',
            available: 0,
            requested: washesToDeduct
          });
        }
        const cn = contracts[0];
        const quota = Number(cn.wash_Quota ?? cn.wash_quota ?? 4);
        const used = Number(cn.washes_used || 0);
        const available = Math.max(0, quota - used);
        if (available < washesToDeduct) {
          if (txConn) await txConn.rollback();
          return res.status(409).json({
            error: `La clienta no tiene lavados disponibles en su Plan Beauty activo (disponibles: ${available}, solicitados: ${washesToDeduct}).`,
            code: 'PLAN_WASH_QUOTA_EXHAUSTED',
            available,
            requested: washesToDeduct
          });
        }
        await db.query(
          'UPDATE contracts SET washes_used = washes_used + ? WHERE id = ? AND tenant_id = ?',
          [washesToDeduct, cn.id, tenantId]
        );
      }

      // 10b. Persistir consumo / descuento de empleado a nómina de forma idempotente (sin duplicación)
      const empConsumptionReq = req.body?.employee_consumption;
      const isPayrollMethod =
        String(metodo_pago || '').toLowerCase().includes('nomina') ||
        String(metodo_pago || '').toLowerCase().includes('nómina') ||
        String(metodo_pago || '').toLowerCase().includes('consumo empleado') ||
        Boolean(empConsumptionReq);

      if (isPayrollMethod && numTotal > 0) {
        const rawTargetEmpId = String(
          empConsumptionReq?.employee_id ||
          (String(targetClientId || '').startsWith('EMP-') ? String(targetClientId).replace('EMP-', '') : '')
        ).trim();
        const rawTargetEmpName = String(
          empConsumptionReq?.employee_name || client_name || existingRows[0]?.client_name || ''
        ).trim();

        let matchedEmpRow = null;
        if (rawTargetEmpId && !isNaN(Number(rawTargetEmpId))) {
          const [eRows] = await db.query(
            'SELECT id, nombre FROM staff_records WHERE id = ? AND tenant_id = ? LIMIT 1',
            [Number(rawTargetEmpId), tenantId]
          );
          matchedEmpRow = eRows?.[0] || null;
        }
        if (!matchedEmpRow && rawTargetEmpName) {
          const [eRows] = await db.query(
            'SELECT id, nombre FROM staff_records WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)) AND tenant_id = ? LIMIT 1',
            [rawTargetEmpName, tenantId]
          );
          matchedEmpRow = eRows?.[0] || null;
        }

        if (matchedEmpRow) {
          const [existingDisc] = await db.query(
            'SELECT id FROM employee_discounts WHERE tenant_id = ? AND visit_id = ? LIMIT 1',
            [tenantId, String(id)]
          );
          if (!existingDisc || existingDisc.length === 0) {
            const deductionAmount = Number(empConsumptionReq?.monto || numTotal) || numTotal;
            const servicesSummary = parsedItemsList.map((i) => i.nombre || i.service_name).filter(Boolean).join(', ') || 'Consumo POS';
            const actorName = req.auth?.name || req.user?.name || recepcionista || 'Caja POS';
            await db.query(
              `INSERT INTO employee_discounts (
                 tenant_id, visit_id, employee_id, employee_name, type, amount, discount_amount, date, notes, status, created_by, created_at
               ) VALUES (?, ?, ?, ?, 'Consumo_Servicio', ?, ?, CURRENT_DATE, ?, 'Pendiente', ?, NOW())`,
              [
                tenantId,
                String(id),
                matchedEmpRow.id,
                matchedEmpRow.nombre,
                deductionAmount,
                deductionAmount,
                `Consumo en empresa Factura #${ticketNumber}: ${servicesSummary}`,
                actorName
              ]
            );
          }
        }
      }

      // 11. Comisiones del empleado dentro de la MISMA transacción
      await processVisitCommissions(id, finalSerializedItems, ticketNumber, new Date(), tenantId, db, {
        descuento: numDescuento,
        empleado_peluquera: empleado_peluquera || existingRows[0]?.empleado_peluquera || null,
        salon_id
      });

      // 12. COMMIT ATÓMICO ÚNICO
      if (txConn) {
        await txConn.query('COMMIT');
      }

      // Post-commit non-transactional side effects (alerts & survey email)
      if (inventoryService && postCommitAlerts.length > 0 && typeof inventoryService.evaluateLowStockAlert === 'function') {
        for (const a of postCommitAlerts) {
          inventoryService.evaluateLowStockAlert(tenantId, a.productId, a.locationId).catch(() => { });
        }
      }
      if (targetClientId && typeof sendSurveyEmail === 'function') {
        sendSurveyEmail(pool, targetClientId, client_name, null, tenantId).catch(() => { });
      }

      res.json({
        success: true,
        id,
        ticket_number: ticketNumber,
        cash_register_id: activeRegisterId || null,
        subtotal: numSubtotal,
        subtotal_cents: subtotalCents,
        descuento: numDescuento,
        discount_cents: discountCents,
        itbis: numItbis,
        itbis_cents: itbisCents,
        total: numTotal,
        total_cents: totalCents,
        currency: 'DOP',
        ncf: assignedNcf,
        ncf_name: assignedNcfName,
        status: 'Facturado'
      });
    } catch (err) {
      if (txConn) {
        try { await txConn.query('ROLLBACK'); } catch (_) { }
      }
      console.error('[CHECKOUT TICKET ERROR]:', err);
      if (err && (err.code === 'INVALID_PRODUCT_ID' || err.code === '22P02')) {
        return res.status(400).json({
          error: 'Uno de los datos o identificadores enviados en la factura no es válido. Revisa las líneas del carrito e intenta nuevamente.',
          code: err.code === 'INVALID_PRODUCT_ID' ? 'INVALID_PRODUCT_ID' : 'INVALID_INPUT_IDENTIFIER'
        });
      }
      res.status(500).json({
        error: 'No se pudo finalizar la factura por un error interno. Tu ticket y carrito siguen intactos para reintentar.',
        code: 'CHECKOUT_INTERNAL_ERROR'
      });
    } finally {
      if (txConn) {
        try { txConn.release(); } catch (_) { }
      }
    }
  });

  // 8. POST /api/visits - Direct visit creation within the authenticated tenant
  router.post('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const {
        id,
        client_id,
        clientId,
        client_name,
        clientName,
        salon_id = 1,
        servicios = [],
        items_detail = [],
        total = 0,
        metodo_pago = 'Efectivo',
        status = 'Facturado',
        empleado_peluquera = 'No asignada',
        empleado_lava_pelo = 'No asignada',
        empleado_manicurista = 'No asignada',
        recepcionista = 'Recepción'
      } = req.body;
      if (!isBranchAuthorized(req, salon_id)) {
        return res.status(403).json({
          error: 'No tienes autorización para registrar visitas en esta sucursal.',
          code: 'BRANCH_ACCESS_DENIED'
        });
      }

      const visitId = id || `VIS-${Date.now()}`;
      const ticketNumber = await getNextTicketNumber(salon_id, tenantId);
      const serializedServices = typeof servicios === 'string' ? servicios : JSON.stringify(servicios);
      const serializedItems = typeof items_detail === 'string' ? items_detail : JSON.stringify(items_detail);

      await pool.query(
        `INSERT INTO visits (
           id, tenant_id, ticket_number, client_id, client_name, salon_id,
           servicios, items_detail, total, metodo_pago, status,
           empleado_peluquera, empleado_lava_pelo, empleado_manicurista, visited_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          visitId,
          tenantId,
          ticketNumber,
          client_id || clientId || null,
          client_name || clientName || 'Cliente General',
          salon_id,
          serializedServices,
          serializedItems,
          Number(total) || 0,
          metodo_pago,
          status,
          empleado_peluquera,
          empleado_lava_pelo,
          empleado_manicurista
        ]
      );

      if (status === 'Facturado') {
        await processVisitCommissions(visitId, serializedItems, ticketNumber, new Date(), tenantId);

        if (inventoryService) {
          const rawItems = typeof serializedItems === 'string' ? JSON.parse(serializedItems) : (items_detail || []);
          if (Array.isArray(rawItems)) {
            for (const [idx, it] of rawItems.entries()) {
              const isProduct = String(it.tipo_item || it.item_type || '').toUpperCase() === 'PRODUCTO' || it.is_product || Boolean(it.product_id);
              if (isProduct) {
                const pId = resolveCanonicalProductId(it);
                const q = Number(it.cantidad || it.qty || it.quantity || 1);
                if (pId && q > 0) {
                  try {
                    await inventoryService.recordSaleDeduction(tenantId, {
                      productId: pId,
                      locationId: null,
                      quantity: q,
                      visitId,
                      lineId: idx,
                      userId: req.user?.id || null,
                      userName: recepcionista
                    });
                  } catch (invErr) {
                    console.error('[INVENTORY DIRECT SALE DEDUCTION ERROR]:', invErr.message);
                  }
                }
              }
            }
          }
        }
      }

      res.json({ id: visitId, ticket_number: ticketNumber, success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 9. POST /api/visits/:id/void - Void an invoice / visit within the authenticated tenant (REM-P1-06)
  router.post('/:id/void', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const { reason = 'Anulación de factura' } = req.body || {};

      // -------------------------------------------------------------
      // Autorización de Supervisor o Validación de PIN Maestro/OTP (REM-P1-06)
      // -------------------------------------------------------------
      const actorRole = String(req.auth?.role || req.headers['x-user-role'] || '').toLowerCase();
      const isPrivileged = actorRole === 'propietario' || actorRole === 'owner' || actorRole === 'admin' || Boolean(req.auth?.isSuperAdmin) || permissionMapGrants(req.auth?.permissions, 'pos.invoices.void');

      const providedPin = req.body?.admin_pin || req.body?.supervisor_pin || req.body?.pin || req.headers['x-admin-pin'];

      if (!isPrivileged) {
        if (!providedPin) {
          return res.status(403).json({
            error: 'Se requiere autorización de supervisor o PIN de administrador para anular facturas.',
            code: 'SUPERVISOR_PIN_REQUIRED'
          });
        }

        const [secRows] = await pool.query(
          'SELECT admin_pin, admin_pin_hash, active_otp_pin, otp_expires_at FROM security_settings WHERE tenant_id = ? LIMIT 1',
          [tenantId]
        );
        if (!secRows || secRows.length === 0) {
          return res.status(401).json({
            error: 'No hay PIN de seguridad configurado para esta empresa.',
            code: 'PIN_NOT_CONFIGURED'
          });
        }

        const sec = secRows[0];
        const isOtpValid = sec.active_otp_pin && (String(providedPin) === String(sec.active_otp_pin)) && sec.otp_expires_at && (new Date(sec.otp_expires_at) > new Date());
        let isMasterValid = false;

        const storedMaster = sec.admin_pin_hash || sec.admin_pin;
        if (storedMaster) {
          const { verifyPin } = require('../services/pin_security.service');
          const verifyRes = await verifyPin(String(providedPin), storedMaster);
          isMasterValid = verifyRes.matched;
        }

        if (!isMasterValid && !isOtpValid) {
          return res.status(401).json({
            error: 'PIN de supervisor o administrador incorrecto.',
            code: 'INVALID_ADMIN_PIN'
          });
        }
      }

      const effectiveVoidedBy = req.auth?.name || req.auth?.email || req.headers['x-user-name'] || req.body?.voided_by || 'Supervisor Autorizado';

      const [existing] = await pool.query(
        'SELECT id, status, total, salon_id, cash_register_id, metodo_pago FROM visits WHERE id = ? AND tenant_id = ? LIMIT 1',
        [id, tenantId]
      );
      if (existing.length === 0) {
        return res.status(404).json({ error: 'Factura no encontrada en esta empresa.' });
      }
      if (existing[0].salon_id && !isBranchAuthorized(req, existing[0].salon_id)) {
        return res.status(403).json({
          error: 'No tienes autorización para anular facturas de esta sucursal.',
          code: 'BRANCH_ACCESS_DENIED'
        });
      }

      const currentStatus = String(existing[0].status || '').trim();
      if (currentStatus === 'Anulado' || currentStatus === 'Anulada') {
        return res.status(409).json({
          error: 'La factura ya ha sido anulada previamente.',
          code: 'ALREADY_VOIDED'
        });
      }
      if (currentStatus !== 'Facturado') {
        return res.status(409).json({
          error: `Solo se pueden anular facturas emitidas (estado actual: "${currentStatus}").`,
          code: 'NOT_INVOICED'
        });
      }

      const [voidedRows] = await pool.query(
        "UPDATE visits SET status = 'Anulado', void_reason = ?, voided_by = ?, voided_at = NOW() WHERE id = ? AND tenant_id = ? AND status = 'Facturado' RETURNING id",
        [reason, effectiveVoidedBy, id, tenantId]
      );
      if (!voidedRows || voidedRows.length === 0) {
        return res.status(409).json({
          error: 'La factura ya ha sido anulada previamente.',
          code: 'ALREADY_VOIDED'
        });
      }

      await pool.query(
        "UPDATE employee_commissions_log SET status = 'Anulada' WHERE visit_id = ? AND tenant_id = ?",
        [id, tenantId]
      );

      await pool.query(
        "UPDATE employee_discounts SET status = 'Anulado' WHERE visit_id = ? AND tenant_id = ?",
        [id, tenantId]
      );

      // Registro auditado de reversión en caja (type = 'anulacion_venta' para preservar trazabilidad sin doble descuento)
      if (existing[0].cash_register_id) {
        try {
          const refundAmount = Number(existing[0].total || 0);
          if (refundAmount > 0) {
            await pool.query(
              `INSERT INTO cash_register_movements (
                 tenant_id, cash_register_id, type, payment_method, amount, amount_cents, currency, concept, user_name, visit_id, created_at
               ) VALUES (?, ?, 'anulacion_venta', ?, ?, ?, 'DOP', ?, ?, ?, NOW())`,
              [
                tenantId,
                String(existing[0].cash_register_id),
                existing[0].metodo_pago || 'Efectivo',
                refundAmount,
                Math.round(refundAmount * 100),
                `Reversión por anulación de factura #${id}: ${reason}`,
                effectiveVoidedBy,
                String(id)
              ]
            );
          }
        } catch (crErr) {
          console.error('[CASH REGISTER VOID REVERSAL ERROR]:', crErr.message);
        }
      }

      try {
        await pool.query(
          `INSERT INTO audit_logs (tenant_id, entity_type, entity_id, action, reason, user_name, details, created_at)
           VALUES (?, 'visit', ?, 'VOID', ?, ?, ?, NOW())`,
          [tenantId, String(id), reason, effectiveVoidedBy, `Factura #${id} anulada: ${reason}`]
        );
      } catch (e) { }

      // === REVERSIÓN DE INVENTARIO POR ANULACIÓN DE VENTA (PASO 11) ===
      if (inventoryService) {
        try {
          const [visitRows] = await pool.query('SELECT items_detail, servicios, salon_id FROM visits WHERE id = ? AND tenant_id = ? LIMIT 1', [id, tenantId]);
          if (visitRows && visitRows.length > 0) {
            const row = visitRows[0];
            let rawItems = [];
            try {
              if (row.items_detail) rawItems = typeof row.items_detail === 'string' ? JSON.parse(row.items_detail) : row.items_detail;
              else if (row.servicios) rawItems = typeof row.servicios === 'string' ? JSON.parse(row.servicios) : row.servicios;
            } catch (e) { }

            if (Array.isArray(rawItems)) {
              let fallbackVoidLocId = null;
              for (const [idx, it] of rawItems.entries()) {
                const isProduct = String(it.tipo_item || it.item_type || '').toUpperCase() === 'PRODUCTO' || it.is_product || Boolean(it.product_id);
                if (isProduct) {
                  const pId = resolveCanonicalProductId(it);
                  const q = Number(it.cantidad || it.qty || it.quantity || 1);
                  if (pId && q > 0) {
                    // Always restore to the exact location_id where the original SALE movement was deducted
                    const [origSaleMov] = await pool.query(
                      "SELECT location_id FROM inventory_movements WHERE tenant_id = ? AND reference_id = ? AND product_id = ? AND movement_type = 'SALE' ORDER BY created_at DESC LIMIT 1",
                      [tenantId, String(id), pId]
                    );
                    let voidLocId = origSaleMov && origSaleMov[0] ? origSaleMov[0].location_id : null;
                    if (!voidLocId) {
                      if (!fallbackVoidLocId) {
                        const branchLoc = await inventoryService.getDefaultLocation(tenantId, row.salon_id || existing[0].salon_id || null);
                        fallbackVoidLocId = branchLoc?.id || null;
                      }
                      voidLocId = fallbackVoidLocId;
                    }
                    await inventoryService.recordSaleVoid(tenantId, {
                      productId: pId,
                      locationId: voidLocId,
                      quantity: q,
                      visitId: id,
                      lineId: idx,
                      userId: req.auth?.userId || req.user?.id || null,
                      userName: effectiveVoidedBy,
                      reason
                    });
                  }
                }
              }
            }
          }
        } catch (invVoidErr) {
          console.error('[INVENTORY VOID ERROR] Error revirtiendo inventario en anulación:', invVoidErr);
        }
      }

      res.json({ success: true, message: 'Factura anulada exitosamente' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 10. PUT /api/visits/:id/commission-recipient - Reassign commission stylist on an invoice within the authenticated tenant (Bloque 2)
  router.put('/:id/commission-recipient', async (req, res) => {
    let txConn = null;
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const {
        empleado_peluquera,
        empleado_manicurista,
        empleado_lava_pelo,
        items_detail,
        updatedItems,
        reason,
        user_name
      } = req.body || {};

      const actorRole = String(req.auth?.role || req.user?.role || '').toLowerCase();
      const canEdit =
        ['propietario', 'owner', 'admin', 'administrador', 'superadmin'].includes(actorRole) ||
        Boolean(req.auth?.isSuperAdmin) ||
        permissionMapGrants(req.auth?.permissions, 'pos.invoices.void') ||
        permissionMapGrants(req.auth?.permissions, 'commissions.approve') ||
        permissionMapGrants(req.auth?.permissions, 'staff.manage');

      if (!canEdit) {
        return res.status(403).json({
          error: 'No tienes permisos para editar las comisiones de una factura emitida.',
          code: 'COMMISSION_EDIT_FORBIDDEN'
        });
      }

      const cleanReason = typeof reason === 'string' ? reason.trim() : '';
      if (!cleanReason) {
        return res.status(400).json({
          error: 'Debe especificar un motivo válido para auditar la reasignación de comisión.',
          code: 'REASON_REQUIRED'
        });
      }

      const actorName = req.auth?.name || req.auth?.email || user_name || 'Administrador';
      const actorId = req.auth?.userId || req.user?.id || null;

      const [existingRows] = await pool.query('SELECT * FROM visits WHERE id = ? AND tenant_id = ? LIMIT 1', [id, tenantId]);
      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'Factura no encontrada en esta empresa.', code: 'INVOICE_NOT_FOUND' });
      }
      const visit = existingRows[0];

      if (visit.salon_id && !isBranchAuthorized(req, visit.salon_id)) {
        return res.status(403).json({
          error: 'No tienes autorización para modificar facturas de esta sucursal.',
          code: 'BRANCH_ACCESS_DENIED'
        });
      }

      if (['Anulado', 'Anulada'].includes(String(visit.status || '').trim())) {
        return res.status(409).json({
          error: 'No se pueden editar comisiones de una factura anulada.',
          code: 'INVOICE_VOIDED'
        });
      }

      // Verificar si las comisiones de esta factura ya fueron pagadas/liquidadas
      const [prevCommRows] = await pool.query(
        'SELECT id, employee_id, employee_name, service_name, monto_base, monto_comision, status, payout_id, rule_applied_description FROM employee_commissions_log WHERE visit_id = ? AND tenant_id = ? ORDER BY id ASC',
        [String(id), tenantId]
      );
      const alreadyPaidComm = (prevCommRows || []).find(
        (c) => ['Pagado', 'Pagada'].includes(String(c.status || '').trim()) || Boolean(c.payout_id)
      );
      if (alreadyPaidComm) {
        return res.status(409).json({
          error: 'No se puede modificar directamente la comisión porque ya fue pagada o liquidada. Registre un ajuste trazable en comisiones o nómina.',
          code: 'COMMISSION_ALREADY_PAID'
        });
      }

      // Verificar si la comisión ya fue incluida en una nómina aprobada/inmutable
      const prevEmpIds = (prevCommRows || []).map((c) => String(c.employee_id || '')).filter(Boolean);
      if (prevEmpIds.length > 0 && visit.visited_at) {
        const visitDateStr = new Date(visit.visited_at).toISOString().slice(0, 10);
        const phEmp = prevEmpIds.map(() => '?').join(', ');
        const [approvedPayrolls] = await pool.query(
          `SELECT pp.id, pp.period_name, pp.status
           FROM payroll_periods pp
           JOIN payroll_items pi ON pi.payroll_id = pp.id AND pi.tenant_id = pp.tenant_id
           WHERE pp.tenant_id = ?
             AND (pp.status IN ('Aprobada', 'Pagada') OR pp.is_immutable = 1)
             AND ?::date BETWEEN pp.start_date AND pp.end_date
             AND pi.employee_id::text IN (${phEmp})
           LIMIT 1`,
          [tenantId, visitDateStr, ...prevEmpIds]
        );
        if (approvedPayrolls && approvedPayrolls.length > 0) {
          return res.status(409).json({
            error: `No se puede modificar directamente la comisión porque ya está incluida en la nómina aprobada "${approvedPayrolls[0].period_name}". Realice un ajuste trazable en el siguiente período.`,
            code: 'COMMISSION_IN_APPROVED_PAYROLL',
            payroll_period: approvedPayrolls[0].period_name
          });
        }
      }

      // Parsear líneas originales de la factura (preservar conceptos, precios, impuestos, descuentos y totales intactos)
      let dbItems = [];
      try {
        if (visit.items_detail) {
          dbItems = typeof visit.items_detail === 'string' ? JSON.parse(visit.items_detail) : visit.items_detail;
        }
      } catch (_) {
        dbItems = [];
      }
      if (!Array.isArray(dbItems) || dbItems.length === 0) {
        let servs = [];
        try {
          if (Array.isArray(visit.servicios)) servs = visit.servicios;
          else if (typeof visit.servicios === 'string' && visit.servicios.startsWith('[')) servs = JSON.parse(visit.servicios);
          else if (visit.servicios) servs = [visit.servicios];
        } catch (_) {
          servs = [visit.servicios || 'Servicio'];
        }
        dbItems = servs.map((s) => ({
          nombre: typeof s === 'object' ? (s.nombre || s.name || 'Servicio') : String(s),
          precioBase: Number(visit.total || 0) / Math.max(1, servs.length),
          precioAplicado: Number(visit.total || 0) / Math.max(1, servs.length),
          cantidad: 1,
          descuento: 0,
          empleado_id: null,
          empleado_nombre: visit.empleado_peluquera || 'Sin Asignar'
        }));
      }

      let incomingList = null;
      if (Array.isArray(updatedItems)) {
        incomingList = updatedItems;
      } else if (Array.isArray(items_detail)) {
        incomingList = items_detail;
      } else if (typeof items_detail === 'string' && items_detail.trim().startsWith('[')) {
        try { incomingList = JSON.parse(items_detail); } catch (_) { incomingList = null; }
      }

      // Validar colaboradores del tenant y sucursal
      const [tenantStaff] = await pool.query(
        'SELECT id, nombre, salon_id, localidad, status FROM staff_records WHERE tenant_id = ?',
        [tenantId]
      );
      const [tenantBranches] = await pool.query(
        'SELECT id::text as id, name FROM branches WHERE tenant_id = ?',
        [tenantId]
      ).catch(() => [[]]);
      const branchIdSet = new Set((tenantBranches || []).map((b) => String(b.id)));
      const branchNameToId = new Map((tenantBranches || []).map((b) => [String(b.name || '').trim().toLowerCase(), String(b.id)]));

      const staffById = new Map((tenantStaff || []).map((s) => [String(s.id), s]));
      const staffByName = new Map((tenantStaff || []).map((s) => [String(s.nombre || '').trim().toLowerCase(), s]));

      const resolveAndValidateEmployee = (rawId, rawName) => {
        const cleanId = rawId !== undefined && rawId !== null ? String(rawId).replace('EMP-', '').trim() : '';
        const cleanName = rawName !== undefined && rawName !== null ? String(rawName).trim() : '';
        const isUnassigned =
          (!cleanId || cleanId === 'none' || cleanId === 'Sin Asignar') &&
          (!cleanName || ['sin asignar', 'no asignada', 'no asignado', 'none', 'n/a', ''].includes(cleanName.toLowerCase()));
        if (isUnassigned) {
          return { empId: null, empName: 'Sin Asignar' };
        }

        let emp = null;
        if (cleanId && staffById.has(cleanId)) {
          emp = staffById.get(cleanId);
        } else if (cleanName && staffByName.has(cleanName.toLowerCase())) {
          emp = staffByName.get(cleanName.toLowerCase());
        } else if (cleanId && staffByName.has(cleanId.toLowerCase())) {
          emp = staffByName.get(cleanId.toLowerCase());
        }

        if (!emp) {
          const err = new Error(`El colaborador "${cleanName || cleanId}" no existe o no pertenece a esta empresa.`);
          err.statusCode = 404;
          err.code = 'EMPLOYEE_NOT_FOUND';
          throw err;
        }

        // Validar sucursal si tanto la factura como el colaborador están asociados a sucursales específicas distintas
        const visitBranchId = visit.salon_id && branchIdSet.has(String(visit.salon_id)) ? String(visit.salon_id) : null;
        let empBranchId = emp.salon_id && branchIdSet.has(String(emp.salon_id)) ? String(emp.salon_id) : null;
        if (!empBranchId && emp.localidad) {
          const locLower = String(emp.localidad).trim().toLowerCase();
          if (branchNameToId.has(locLower)) empBranchId = branchNameToId.get(locLower);
        }
        if (visitBranchId && empBranchId && visitBranchId !== empBranchId) {
          const err = new Error(`El colaborador "${emp.nombre}" pertenece a otra sucursal y no puede asignarse a una factura de esta sede.`);
          err.statusCode = 400;
          err.code = 'EMPLOYEE_BRANCH_MISMATCH';
          throw err;
        }

        return { empId: emp.id, empName: emp.nombre };
      };

      const previousEmployeesAudit = [];
      const newEmployeesAudit = [];

      const safeUpdatedItems = dbItems.map((origItem, idx) => {
        const prevId = origItem.empleado_id ?? origItem.employee_id ?? origItem.colaboradorId ?? null;
        const prevName = origItem.empleado_nombre ?? origItem.employee_name ?? origItem.empleado ?? origItem.colaboradorNombre ?? 'Sin Asignar';
        previousEmployeesAudit.push({
          line_index: idx,
          service_name: origItem.nombre || origItem.service_name || `Ítem #${idx + 1}`,
          employee_id: prevId,
          employee_name: prevName
        });

        const incoming = Array.isArray(incomingList) && incomingList[idx] ? incomingList[idx] : null;
        let targetRawId = incoming
          ? (incoming.empleado_id ?? incoming.employee_id ?? incoming.colaboradorId ?? null)
          : (empleado_peluquera || prevId);
        let targetRawName = incoming
          ? (incoming.empleado_nombre ?? incoming.employee_name ?? incoming.empleado ?? incoming.colaboradorNombre ?? null)
          : (empleado_peluquera || prevName);

        const resolved = resolveAndValidateEmployee(targetRawId, targetRawName);
        newEmployeesAudit.push({
          line_index: idx,
          service_name: origItem.nombre || origItem.service_name || `Ítem #${idx + 1}`,
          employee_id: resolved.empId,
          employee_name: resolved.empName
        });

        // Preservar todos los campos comerciales/fiscales de origItem intactos; modificar SOLO comisionista
        return {
          ...origItem,
          empleado_id: resolved.empId,
          empleado_nombre: resolved.empName,
          empleado: resolved.empName,
          employee_id: resolved.empId,
          employee_name: resolved.empName
        };
      });

      const primaryStylistName =
        newEmployeesAudit.find((e) => e.employee_id !== null)?.employee_name ||
        empleado_peluquera ||
        visit.empleado_peluquera ||
        'No asignada';

      if (typeof pool.getConnection === 'function') {
        txConn = await pool.getConnection();
        await txConn.query('BEGIN');
      }
      const db = txConn || pool;

      // Actualizar únicamente comisionista en visits (NCF, cliente, conceptos, impuestos, pagos y total permanecen inmutables)
      await db.query(
        `UPDATE visits SET
           empleado_peluquera = ?,
           empleado_manicurista = COALESCE(?, empleado_manicurista),
           empleado_lava_pelo = COALESCE(?, empleado_lava_pelo),
           items_detail = ?::jsonb
         WHERE id = ? AND tenant_id = ?`,
        [
          primaryStylistName,
          empleado_manicurista || null,
          empleado_lava_pelo || null,
          JSON.stringify(safeUpdatedItems),
          id,
          tenantId
        ]
      );

      // Recalcular comisiones de forma atómica e idempotente dentro de la transacción
      await processVisitCommissions(id, safeUpdatedItems, visit.ticket_number, visit.visited_at, tenantId, db, {
        descuento: Number(visit.descuento || 0),
        empleado_peluquera: primaryStylistName,
        salon_id: visit.salon_id
      });

      const [newCommRows] = await db.query(
        'SELECT id, employee_id, employee_name, service_name, monto_base, monto_comision, status, scheme_id, rule_applied_description FROM employee_commissions_log WHERE visit_id = ? AND tenant_id = ? ORDER BY id ASC',
        [String(id), tenantId]
      );

      const auditMetadata = {
        visit_id: String(id),
        ticket_number: visit.ticket_number,
        actor_id: actorId,
        actor_name: actorName,
        reason: cleanReason,
        previous_employees: previousEmployeesAudit,
        new_employees: newEmployeesAudit,
        previous_commissions: (prevCommRows || []).map((c) => ({
          employee_id: c.employee_id,
          employee_name: c.employee_name,
          service_name: c.service_name,
          monto_base: Number(c.monto_base || 0),
          monto_comision: Number(c.monto_comision || 0),
          rule: c.rule_applied_description || null
        })),
        new_commissions: (newCommRows || []).map((c) => ({
          employee_id: c.employee_id,
          employee_name: c.employee_name,
          service_name: c.service_name,
          monto_base: Number(c.monto_base || 0),
          monto_comision: Number(c.monto_comision || 0),
          rule: c.rule_applied_description || null
        }))
      };

      const prevSummary = previousEmployeesAudit.map((e) => `${e.service_name}: ${e.employee_name}`).join(', ');
      const newSummary = newEmployeesAudit.map((e) => `${e.service_name}: ${e.employee_name}`).join(', ');

      await db.query(
        `INSERT INTO audit_logs (tenant_id, entity_type, entity_id, action, reason, user_name, details, metadata, created_at)
         VALUES (?, 'visit', ?, 'REASSIGN_COMMISSION', ?, ?, ?, ?::jsonb, NOW())`,
        [
          tenantId,
          String(id),
          cleanReason,
          actorName,
          `Reasignación de comisión en factura #${visit.ticket_number || id} (${prevSummary} -> ${newSummary})`,
          JSON.stringify(auditMetadata)
        ]
      );

      if (txConn) {
        await txConn.query('COMMIT');
      }

      res.json({
        success: true,
        message: 'Comisionista actualizado y comisiones recalculadas correctamente.',
        commissions: newCommRows,
        audit: auditMetadata
      });
    } catch (err) {
      if (txConn) {
        try { await txConn.query('ROLLBACK'); } catch (_) { }
      }
      res.status(err.statusCode || 500).json({
        error: err.message,
        code: err.code || 'COMMISSION_REASSIGN_ERROR'
      });
    } finally {
      if (txConn) {
        try { txConn.release(); } catch (_) { }
      }
    }
  });

  // 11. GET /api/visits/:id/audit - Get audit logs for a visit within the authenticated tenant
  router.get('/:id/audit', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const [visitCheck] = await pool.query('SELECT id FROM visits WHERE id = ? AND tenant_id = ? LIMIT 1', [id, tenantId]);
      if (visitCheck.length === 0) {
        return res.status(404).json({ error: 'Visita no encontrada' });
      }
      const [rows] = await pool.query(
        `SELECT id, entity_id as visit_id, action, reason, user_name, details, metadata, created_at
         FROM audit_logs
         WHERE tenant_id = ? AND entity_type = 'visit' AND entity_id = ?
         ORDER BY created_at DESC, id DESC`,
        [tenantId, String(id)]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 12. POST /api/visits/:id/cancel - Cancelar un ticket pendiente antes de facturar conservando trazabilidad (motivo, usuario, fecha)
  router.post('/:id/cancel', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const { reason = 'Cancelado en recepción antes de facturar' } = req.body || {};
      const actorName = req.auth?.name || req.auth?.email || req.headers['x-user-name'] || req.body?.cancelled_by || 'Recepción';

      const [existing] = await pool.query(
        'SELECT id, status, salon_id, ncf FROM visits WHERE id = ? AND tenant_id = ? LIMIT 1',
        [id, tenantId]
      );
      if (!existing || existing.length === 0) {
        return res.status(404).json({ error: 'Ticket no encontrado en esta empresa.', code: 'TICKET_NOT_FOUND' });
      }
      if (existing[0].salon_id && !isBranchAuthorized(req, existing[0].salon_id)) {
        return res.status(403).json({ error: 'No tienes autorización para cancelar tickets en esta sucursal.', code: 'BRANCH_ACCESS_DENIED' });
      }
      const curStatus = String(existing[0].status || '').trim();
      if (curStatus === 'Facturado') {
        return res.status(409).json({
          error: 'Este ticket ya fue facturado. Utiliza la opción de anulación de factura.',
          code: 'ALREADY_INVOICED'
        });
      }

      await pool.query(
        "UPDATE visits SET status = 'Cancelado', void_reason = ?, voided_by = ?, voided_at = NOW() WHERE id = ? AND tenant_id = ?",
        [String(reason).trim(), actorName, id, tenantId]
      );
      res.json({ success: true, id, status: 'Cancelado', reason: String(reason).trim(), cancelled_by: actorName });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 12b. DELETE /api/visits/:id & POST /api/visits/:id/delete - Delete pending ticket within the authenticated tenant (NEVER deletes Facturado/Anulado invoices)
  const handleDeleteVisit = async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const [existing] = await pool.query(
        'SELECT id, status, salon_id FROM visits WHERE id = ? AND tenant_id = ? LIMIT 1',
        [id, tenantId]
      );
      if (!existing || existing.length === 0) {
        return res.status(404).json({ error: 'Visita no encontrada' });
      }
      if (existing[0].salon_id && !isBranchAuthorized(req, existing[0].salon_id)) {
        return res.status(403).json({
          error: 'No tienes autorización para eliminar tickets de esta sucursal.',
          code: 'BRANCH_ACCESS_DENIED'
        });
      }
      const curStatus = String(existing[0].status || '').trim();
      if (curStatus === 'Facturado' || curStatus === 'Anulado' || curStatus === 'Anulada') {
        return res.status(409).json({
          error: 'Las facturas emitidas o anuladas no pueden eliminarse físicamente para preservar la integridad fiscal y contable.',
          code: 'INVOICE_CANNOT_BE_DELETED'
        });
      }
      await pool.query(
        "DELETE FROM visits WHERE id = ? AND tenant_id = ? AND status NOT IN ('Facturado', 'Anulado', 'Anulada')",
        [id, tenantId]
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
  router.delete('/:id', handleDeleteVisit);
  router.post('/:id/delete', handleDeleteVisit);

  // 13. Clear all pending tickets within the authenticated tenant
  const handleClearPending = async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const salonId = req.query.salon_id || req.body?.salon_id || 'all';
      if (salonId && salonId !== 'all') {
        await pool.query(
          "DELETE FROM visits WHERE tenant_id = ? AND status IN ('Pendiente', 'Abierto', 'En Proceso') AND salon_id::text = ?",
          [tenantId, String(salonId)]
        );
      } else {
        await pool.query(
          "DELETE FROM visits WHERE tenant_id = ? AND status IN ('Pendiente', 'Abierto', 'En Proceso')",
          [tenantId]
        );
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
  router.delete('/pending/all', handleClearPending);
  router.post('/pending/clear-all', handleClearPending);

  return { router, processVisitCommissions, processBatchVisitCommissions };
}

module.exports = { createVisitsRouter };
