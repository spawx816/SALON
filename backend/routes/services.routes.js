const express = require('express');

/**
 * Catalog and Services Router module for Empresa Pro & Plan Beauty RD (Scoped by tenant_id)
 */
function createServicesRouter(pool) {
  const router = express.Router();

  const normalizeCatalogRow = (r) => {
    const rawType = String(r.item_type || r.tipo_item || '').trim().toUpperCase();
    const isProduct = rawType === 'PRODUCTO' || rawType === 'PRODUCT';
    const explicitAplica = r.aplica_itbis !== undefined && r.aplica_itbis !== null
      ? (Number(r.aplica_itbis) === 1 || r.aplica_itbis === true || String(r.aplica_itbis) === '1')
      : false;
    const rawMode = String(r.tax_mode || (explicitAplica ? 'exclusive' : 'exempt')).toLowerCase();
    const rawRate = r.tax_rate !== undefined && r.tax_rate !== null ? parseFloat(r.tax_rate) : (explicitAplica ? 0.18 : 0);
    const normRate = Number.isFinite(rawRate) ? (rawRate > 1 ? rawRate / 100 : Math.max(0, rawRate)) : 0.18;
    const effectiveRate = (explicitAplica && rawMode !== 'zero' && rawMode !== 'exempt') ? normRate : 0;
    return {
      ...r,
      nombre: r.nombre || r.name || 'Servicio',
      categoria: r.categoria || r.category || 'General',
      precio: parseFloat(r.precio ?? r.price ?? 0),
      costo: parseFloat(r.costo ?? 0),
      duracion: parseInt(r.duracion ?? r.duration_minutes ?? 30),
      activo: r.activo !== undefined && r.activo !== null ? r.activo : (r.is_active ? 1 : 0),
      item_type: isProduct ? 'PRODUCTO' : 'SERVICIO',
      tipo_item: isProduct ? 'Producto' : 'Servicio',
      sku: r.sku || null,
      barcode: r.barcode || null,
      unit_of_measure: r.unit_of_measure || 'unit',
      aplica_itbis: explicitAplica ? 1 : 0,
      tax_rate: effectiveRate,
      tax_mode: r.tax_mode || 'exclusive',
      min_stock: r.min_stock !== undefined && r.min_stock !== null ? parseFloat(r.min_stock) : 0,
      track_stock: r.track_stock !== undefined && r.track_stock !== null ? Boolean(r.track_stock) : isProduct,
      commission_category_id: r.commission_category_id !== undefined && r.commission_category_id !== null ? Number(r.commission_category_id) : null,
      commission_category_nombre: r.commission_category_nombre || null,
      commission_category_estado: r.commission_category_estado || null,
      current_stock: r.current_stock !== undefined && r.current_stock !== null ? parseFloat(r.current_stock) : 0,
      has_inventory_record: Boolean(r.has_inventory_record),
    };
  };

  /**
   * Resuelve el stock por producto del tenant y sucursal (branch_id / salon_id).
   * Si la sucursal tiene ubicaciones asignadas en inventory_locations, usa exclusivamente esas ubicaciones.
   * Si no tiene ubicación propia y solo existe la ubicación default del tenant, usa la ubicación default.
   */
  const attachBranchScopedStock = async (tenantId, rows, salonId = null) => {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const targetBranch = salonId && salonId !== 'all' && salonId !== 'Todas' ? String(salonId).trim() : null;

    let locationFilterIds = null;
    if (targetBranch) {
      const [locs] = await pool.query(
        'SELECT id, branch_id, is_default, name FROM inventory_locations WHERE tenant_id = ? AND COALESCE(is_active, TRUE) = TRUE ORDER BY is_default DESC, created_at ASC',
        [tenantId]
      ).catch(() => [[]]);
      if (Array.isArray(locs) && locs.length > 0) {
        const directMatches = locs.filter((l) => String(l.branch_id || '') === targetBranch);
        if (directMatches.length > 0) {
          locationFilterIds = directMatches.map((l) => l.id);
        } else {
          // Si hay una sola ubicación default sin branch_id explícito o de sucursal única
          const unassignedDefault = locs.filter((l) => !l.branch_id && l.is_default);
          if (unassignedDefault.length > 0 && locs.length === 1) {
            locationFilterIds = unassignedDefault.map((l) => l.id);
          } else if (locs.some((l) => l.branch_id)) {
            // Otras sucursales sí tienen ubicación pero esta sucursal aún no tiene stock registrado
            locationFilterIds = [];
          }
        }
      }
    }

    let stockRows = [];
    if (Array.isArray(locationFilterIds) && locationFilterIds.length === 0) {
      stockRows = [];
    } else if (Array.isArray(locationFilterIds) && locationFilterIds.length > 0) {
      const ph = locationFilterIds.map(() => '?').join(', ');
      const [sRows] = await pool.query(
        `SELECT product_id::text AS product_id, COALESCE(SUM(quantity), 0) AS qty, COUNT(*)::int AS rec_count
         FROM inventory_stock
         WHERE tenant_id = ? AND location_id IN (${ph})
         GROUP BY product_id`,
        [tenantId, ...locationFilterIds]
      ).catch(() => [[]]);
      stockRows = sRows || [];
    } else {
      const [sRows] = await pool.query(
        `SELECT product_id::text AS product_id, COALESCE(SUM(quantity), 0) AS qty, COUNT(*)::int AS rec_count
         FROM inventory_stock
         WHERE tenant_id = ?
         GROUP BY product_id`,
        [tenantId]
      ).catch(() => [[]]);
      stockRows = sRows || [];
    }

    const stockMap = new Map();
    for (const sr of stockRows) {
      stockMap.set(String(sr.product_id), {
        qty: parseFloat(sr.qty || 0),
        hasRecord: Number(sr.rec_count || 0) > 0,
      });
    }

    return rows.map((r) => {
      const entry = stockMap.get(String(r.id));
      return normalizeCatalogRow({
        ...r,
        current_stock: entry ? entry.qty : 0,
        has_inventory_record: entry ? entry.hasRecord : false,
      });
    });
  };

  const resolveCommissionCategory = async (tenantId, commissionCategoryId, fallbackExistingId = null, fallbackName = null) => {
    if (commissionCategoryId !== undefined && commissionCategoryId !== null && commissionCategoryId !== '') {
      const parsedId = parseInt(commissionCategoryId, 10);
      if (!Number.isInteger(parsedId) || parsedId <= 0) {
        return { error: 'La categoría seleccionada no es válida.', status: 400 };
      }
      const [rows] = await pool.query(
        'SELECT id, nombre, estado FROM commission_categories WHERE id = ? AND tenant_id = ? LIMIT 1',
        [parsedId, tenantId]
      );
      if (!rows || rows.length === 0) {
        return { error: 'La categoría seleccionada no existe en los esquemas de comisiones del negocio.', status: 400 };
      }
      const cat = rows[0];
      const isKeepingSameHistorical = fallbackExistingId && Number(fallbackExistingId) === Number(cat.id);
      const isActiveCat = ['activa', 'activo', 'active', '1', 'true'].includes(String(cat.estado || '').trim().toLowerCase());
      if (!isActiveCat && !isKeepingSameHistorical) {
        return { error: 'La categoría seleccionada está inactiva y no puede asignarse a nuevos ítems.', status: 400 };
      }
      return { id: cat.id, nombre: cat.nombre, estado: cat.estado };
    }
    if (fallbackExistingId) {
      const [rows] = await pool.query(
        'SELECT id, nombre, estado FROM commission_categories WHERE id = ? AND tenant_id = ? LIMIT 1',
        [fallbackExistingId, tenantId]
      );
      if (rows && rows.length > 0) {
        return { id: rows[0].id, nombre: rows[0].nombre, estado: rows[0].estado };
      }
    }
    if (fallbackName) {
      const [rows] = await pool.query(
        'SELECT id, nombre, estado FROM commission_categories WHERE tenant_id = ? AND LOWER(nombre) = LOWER(?) LIMIT 1',
        [tenantId, String(fallbackName).trim()]
      );
      if (rows && rows.length > 0 && ['activa', 'activo', 'active', '1', 'true'].includes(String(rows[0].estado || '').trim().toLowerCase())) {
        return { id: rows[0].id, nombre: rows[0].nombre, estado: rows[0].estado };
      }
    }
    return { error: 'Debes seleccionar una categoría activa configurada en Esquemas de comisiones.', status: 400 };
  };

  // Obtener lista de servicios y productos del catálogo canónico del tenant autenticado
  router.get('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { active_only, item_type, salon_id, branch_id } = req.query;
      let query = `
        SELECT s.*,
               cc.nombre AS commission_category_nombre,
               cc.estado AS commission_category_estado
        FROM services s
        LEFT JOIN commission_categories cc ON cc.id = s.commission_category_id AND cc.tenant_id = s.tenant_id
        WHERE s.tenant_id = ?
      `;
      const params = [tenantId];
      if (active_only === '1' || active_only === 'true') {
        query += ' AND COALESCE(s.activo, 1) = 1 AND COALESCE(s.is_active, TRUE) = TRUE';
      }
      if (item_type) {
        const normType = String(item_type).trim().toUpperCase() === 'PRODUCTO' ? 'PRODUCTO' : 'SERVICIO';
        query += " AND COALESCE(s.item_type, 'SERVICIO') = ?";
        params.push(normType);
      }
      query += ' ORDER BY COALESCE(s.categoria, s.category, \'General\') ASC, COALESCE(s.nombre, s.name, \'\') ASC';
      const [rows] = await pool.query(query, params);
      const hydrated = await attachBranchScopedStock(tenantId, rows, salon_id || branch_id || null);
      res.json(hydrated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Obtener los servicios más utilizados por sucursal dentro del tenant autenticado
  // IMPORTANTE: debe declararse ANTES de '/:id' para que 'top' no se interprete como UUID.
  router.get('/top', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { salon_id, limit = 20 } = req.query;
      const maxResults = parseInt(limit) || 20;

      let visitQuery = `
        SELECT servicios, items_detail 
        FROM visits 
        WHERE tenant_id = ? AND status = 'Facturado'
      `;
      const params = [tenantId];

      if (salon_id && salon_id !== 'all') {
        visitQuery += ' AND salon_id::text = ?';
        params.push(String(salon_id));
      }

      visitQuery += ' ORDER BY visited_at DESC LIMIT 500';

      const [visits] = await pool.query(visitQuery, params);
      const [activeServices] = await pool.query(
        'SELECT * FROM services WHERE tenant_id = ? AND COALESCE(activo, 1) = 1',
        [tenantId]
      );

      if (activeServices.length === 0) {
        return res.json([]);
      }

      const usageCounts = {};

      for (const v of visits) {
        if (v.items_detail) {
          try {
            const parsed = typeof v.items_detail === 'string' ? JSON.parse(v.items_detail) : v.items_detail;
            if (Array.isArray(parsed)) {
              for (const it of parsed) {
                const name = (it.nombre || it.name || '').trim().toLowerCase();
                const qty = parseInt(it.cantidad) || 1;
                if (name) {
                  usageCounts[name] = (usageCounts[name] || 0) + qty;
                }
              }
              continue;
            }
          } catch (e) {}
        }

        if (v.servicios) {
          try {
            const parsed = typeof v.servicios === 'string' ? JSON.parse(v.servicios) : v.servicios;
            if (Array.isArray(parsed)) {
              for (const s of parsed) {
                const name = String(s).trim().toLowerCase();
                if (name) {
                  usageCounts[name] = (usageCounts[name] || 0) + 1;
                }
              }
            }
          } catch (e) {
            const parts = String(v.servicios).split(',');
            for (const p of parts) {
              const name = p.trim().toLowerCase();
              if (name) {
                usageCounts[name] = (usageCounts[name] || 0) + 1;
              }
            }
          }
        }
      }

      const hydratedTop = await attachBranchScopedStock(tenantId, activeServices, salon_id || null);
      const scoredServices = hydratedTop.map(srv => {
        const srvName = srv.nombre || srv.name || 'Servicio';
        const key = srvName.trim().toLowerCase();
        return {
          ...srv,
          usage_count: usageCounts[key] || 0
        };
      });

      scoredServices.sort((a, b) => {
        if (b.usage_count !== a.usage_count) {
          return b.usage_count - a.usage_count;
        }
        return (a.nombre || '').localeCompare(b.nombre || '');
      });

      res.json(scoredServices.slice(0, maxResults));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Obtener servicio por ID dentro del tenant autenticado
  router.get('/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) {
        return res.status(404).json({ error: 'Servicio no encontrado en esta empresa.' });
      }
      const [rows] = await pool.query(
        `SELECT s.*,
                COALESCE((
                  SELECT SUM(st.quantity)
                  FROM inventory_stock st
                  WHERE st.product_id = s.id AND st.tenant_id = s.tenant_id
                ), 0) AS current_stock
         FROM services s
         WHERE s.id = ? AND s.tenant_id = ?`,
        [id, tenantId]
      );
      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'Servicio no encontrado en esta empresa.' });
      }
      res.json(normalizeCatalogRow(rows[0]));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Importación masiva de servicios (scoped al tenant autenticado)
  router.post('/bulk-import', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { items } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'No se enviaron servicios válidos para importar.' });
      }

      let imported = 0;
      let updated = 0;

      for (const item of items) {
        const nombre = String(item.nombre || item.name || '').trim();
        if (!nombre) continue;

        const categoria = String(item.categoria || item.category || 'Peluquería').trim();
        const subcategoria = String(item.subcategoria || 'General').trim();
        const precio = parseFloat(item.precio ?? item.price) || 0;
        const costo = parseFloat(item.costo ?? item.cost) || 0;
        const duracion = parseInt(item.duracion ?? item.duration) || 30;
        const activo = item.activo !== undefined ? (item.activo ? 1 : 0) : 1;

        const [existing] = await pool.query(
          'SELECT id FROM services WHERE LOWER(COALESCE(nombre, name)) = LOWER(?) AND tenant_id = ? LIMIT 1',
          [nombre, tenantId]
        );
        if (existing.length > 0) {
          await pool.query(
            'UPDATE services SET name = ?, categoria = ?, subcategoria = ?, precio = ?, price = ?, costo = ?, duracion = ?, duration_minutes = ?, activo = ?, is_active = ? WHERE id = ? AND tenant_id = ?',
            [nombre, categoria, subcategoria, precio, precio, costo, duracion, duracion, activo, Boolean(activo), existing[0].id, tenantId]
          );
          updated++;
        } else {
          await pool.query(
            'INSERT INTO services (tenant_id, name, nombre, categoria, subcategoria, precio, price, costo, duracion, duration_minutes, activo, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [tenantId, nombre, nombre, categoria, subcategoria, precio, precio, costo, duracion, duracion, activo, Boolean(activo)]
          );
          imported++;
        }
      }

      res.json({
        success: true,
        imported,
        updated,
        message: `Importación completada: ${imported} nuevos, ${updated} actualizados.`
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Crear nuevo producto o servicio en el Catálogo canónico del tenant autenticado
  router.post('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const {
        nombre, name, categoria, category, commission_category_id, subcategoria, precio, price, costo, cost,
        duracion, duration, activo, tipo_comision, comision_valor,
        item_type, tipo_item, sku, barcode, unit_of_measure, tax_rate, tax_mode, aplica_itbis, min_stock, track_stock
      } = req.body;
      const finalName = (nombre || name || '').trim();
      const rawPrice = precio !== undefined ? precio : price;
      if (!finalName || rawPrice === undefined) {
        return res.status(400).json({ error: 'Nombre y precio son obligatorios' });
      }

      const catResolution = await resolveCommissionCategory(
        tenantId,
        commission_category_id,
        null,
        categoria || category
      );
      if (catResolution.error) {
        return res.status(catResolution.status || 400).json({ error: catResolution.error, code: 'INVALID_COMMISSION_CATEGORY' });
      }

      const rawType = String(item_type || tipo_item || 'SERVICIO').trim().toUpperCase();
      const canonicalType = rawType === 'PRODUCTO' || rawType === 'PRODUCT' ? 'PRODUCTO' : 'SERVICIO';
      const parsedPrice = parseFloat(rawPrice) || 0;
      const parsedCost = parseFloat(costo !== undefined ? costo : cost) || 0;
      const parsedDuration = canonicalType === 'PRODUCTO'
        ? 0
        : (parseInt(duracion !== undefined ? duracion : duration) || 30);
      const isActive = activo !== undefined ? (activo ? 1 : 0) : 1;
      const cleanSku = sku ? String(sku).trim() : null;
      const cleanBarcode = barcode ? String(barcode).trim() : null;
      const cleanCategory = catResolution.nombre;

      if (cleanSku) {
        const [dupSku] = await pool.query(
          'SELECT id FROM services WHERE tenant_id = ? AND sku = ? LIMIT 1',
          [tenantId, cleanSku]
        );
        if (dupSku.length > 0) {
          return res.status(400).json({ error: 'Ya existe un ítem con ese SKU en tu catálogo.', code: 'UNIQUE_SKU_VIOLATION' });
        }
      }
      if (cleanBarcode) {
        const [dupBc] = await pool.query(
          'SELECT id FROM services WHERE tenant_id = ? AND barcode = ? LIMIT 1',
          [tenantId, cleanBarcode]
        );
        if (dupBc.length > 0) {
          return res.status(400).json({ error: 'Ya existe un ítem con ese código de barras en tu catálogo.', code: 'UNIQUE_BARCODE_VIOLATION' });
        }
      }

      const resolvedAplicaItbis = aplica_itbis !== undefined && aplica_itbis !== null
        ? (Number(aplica_itbis) === 1 || aplica_itbis === true || String(aplica_itbis) === '1' ? 1 : 0)
        : (tax_rate !== undefined && parseFloat(tax_rate) > 0 ? 1 : 0);
      const rawTaxMode = String(tax_mode || (resolvedAplicaItbis === 1 ? 'exclusive' : 'exempt')).toLowerCase();
      const resolvedTaxMode = ['inclusive', 'exclusive', 'zero', 'exempt'].includes(rawTaxMode) ? rawTaxMode : 'exclusive';
      const parsedCreateRate = tax_rate !== undefined && tax_rate !== null ? parseFloat(tax_rate) : (resolvedAplicaItbis === 1 ? 0.18 : 0);
      const normCreateRate = Number.isFinite(parsedCreateRate) ? (parsedCreateRate > 1 ? parsedCreateRate / 100 : Math.max(0, parsedCreateRate)) : 0.18;
      const resolvedTaxRate = (resolvedAplicaItbis === 1 && resolvedTaxMode !== 'zero' && resolvedTaxMode !== 'exempt')
        ? normCreateRate
        : 0;

      const [result] = await pool.query(
        `INSERT INTO services (
          tenant_id, name, nombre, categoria, category, commission_category_id, subcategoria,
          precio, price, costo, duracion, duration_minutes,
          activo, is_active, tipo_comision, comision_valor,
          item_type, sku, barcode, unit_of_measure, aplica_itbis, tax_rate, tax_mode, min_stock, track_stock
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        [
          tenantId,
          finalName,
          finalName,
          cleanCategory,
          cleanCategory,
          catResolution.id,
          subcategoria || 'General',
          parsedPrice,
          parsedPrice,
          parsedCost,
          parsedDuration,
          parsedDuration,
          isActive,
          Boolean(isActive),
          tipo_comision || 'Porcentaje',
          parseFloat(comision_valor) || 0,
          canonicalType,
          cleanSku,
          cleanBarcode,
          unit_of_measure || 'unit',
          resolvedAplicaItbis,
          resolvedTaxRate,
          resolvedTaxMode,
          min_stock !== undefined ? parseFloat(min_stock) || 0 : 0,
          canonicalType === 'PRODUCTO' ? (track_stock !== false) : false
        ]
      );
      const created = result[0] || {};
      res.status(201).json({
        ...normalizeCatalogRow(created),
        id: created.id || result.insertId,
        success: true,
        message: canonicalType === 'PRODUCTO' ? 'Producto creado en el catálogo' : 'Servicio creado exitosamente'
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Actualizar producto o servicio del Catálogo canónico del tenant autenticado
  router.put('/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const {
        nombre, name, categoria, category, commission_category_id, subcategoria, precio, price, costo, cost,
        duracion, duration, activo, tipo_comision, comision_valor,
        item_type, tipo_item, sku, barcode, unit_of_measure, tax_rate, tax_mode, aplica_itbis, min_stock, track_stock
      } = req.body;

      const [existingRows] = await pool.query(
        'SELECT * FROM services WHERE id = ? AND tenant_id = ? LIMIT 1',
        [id, tenantId]
      );
      if (!existingRows || existingRows.length === 0) {
        return res.status(404).json({ error: 'Ítem no encontrado en el catálogo' });
      }
      const existing = existingRows[0];
      const currentType = String(existing.item_type || 'SERVICIO').toUpperCase();
      const rawNextType = item_type !== undefined || tipo_item !== undefined
        ? String(item_type || tipo_item).trim().toUpperCase()
        : currentType;
      const nextType = rawNextType === 'PRODUCTO' || rawNextType === 'PRODUCT' ? 'PRODUCTO' : 'SERVICIO';

      // Impedir conversión de PRODUCTO a SERVICIO si tiene stock o movimientos históricos
      if (currentType === 'PRODUCTO' && nextType === 'SERVICIO') {
        const [stockHits] = await pool.query(
          'SELECT 1 FROM inventory_stock WHERE product_id = ? AND tenant_id = ? AND quantity <> 0 LIMIT 1',
          [id, tenantId]
        );
        const [movHits] = await pool.query(
          'SELECT 1 FROM inventory_movements WHERE product_id = ? AND tenant_id = ? LIMIT 1',
          [id, tenantId]
        );
        if ((stockHits && stockHits.length > 0) || (movHits && movHits.length > 0)) {
          return res.status(409).json({
            error: 'No puedes cambiar un producto a servicio porque tiene existencias o movimientos históricos en inventario.',
            code: 'CANNOT_CONVERT_PRODUCT_WITH_HISTORY'
          });
        }
      }

      const finalName = (nombre || name || existing.nombre || existing.name || '').trim();
      const parsedPrice = parseFloat(precio !== undefined ? precio : (price !== undefined ? price : existing.precio)) || 0;
      const parsedCost = parseFloat(costo !== undefined ? costo : (cost !== undefined ? cost : existing.costo)) || 0;
      const parsedDuration = nextType === 'PRODUCTO'
        ? 0
        : (parseInt(duracion !== undefined ? duracion : (duration !== undefined ? duration : existing.duracion)) || 30);
      const isActive = activo !== undefined ? (activo ? 1 : 0) : (existing.activo ?? 1);
      const catResolution = await resolveCommissionCategory(
        tenantId,
        commission_category_id,
        existing.commission_category_id,
        categoria || category || existing.categoria || existing.category
      );
      if (catResolution.error) {
        return res.status(catResolution.status || 400).json({ error: catResolution.error, code: 'INVALID_COMMISSION_CATEGORY' });
      }
      const cleanCategory = catResolution.nombre;
      const cleanSku = sku !== undefined ? (sku ? String(sku).trim() : null) : existing.sku;
      const cleanBarcode = barcode !== undefined ? (barcode ? String(barcode).trim() : null) : existing.barcode;

      if (cleanSku && cleanSku !== existing.sku) {
        const [dupSku] = await pool.query(
          'SELECT id FROM services WHERE tenant_id = ? AND sku = ? AND id <> ? LIMIT 1',
          [tenantId, cleanSku, id]
        );
        if (dupSku.length > 0) {
          return res.status(400).json({ error: 'Ya existe otro ítem con ese SKU.', code: 'UNIQUE_SKU_VIOLATION' });
        }
      }
      if (cleanBarcode && cleanBarcode !== existing.barcode) {
        const [dupBc] = await pool.query(
          'SELECT id FROM services WHERE tenant_id = ? AND barcode = ? AND id <> ? LIMIT 1',
          [tenantId, cleanBarcode, id]
        );
        if (dupBc.length > 0) {
          return res.status(400).json({ error: 'Ya existe otro ítem con ese código de barras.', code: 'UNIQUE_BARCODE_VIOLATION' });
        }
      }

      const resolvedAplicaItbis = aplica_itbis !== undefined && aplica_itbis !== null
        ? (Number(aplica_itbis) === 1 || aplica_itbis === true || String(aplica_itbis) === '1' ? 1 : 0)
        : (tax_rate !== undefined ? (parseFloat(tax_rate) > 0 ? 1 : 0) : (existing.aplica_itbis ?? 0));
      const rawUpdMode = tax_mode !== undefined ? String(tax_mode).toLowerCase() : String(existing.tax_mode || (resolvedAplicaItbis === 1 ? 'exclusive' : 'exempt')).toLowerCase();
      const resolvedTaxMode = ['inclusive', 'exclusive', 'zero', 'exempt'].includes(rawUpdMode) ? rawUpdMode : 'exclusive';
      const parsedUpdRate = tax_rate !== undefined && tax_rate !== null
        ? parseFloat(tax_rate)
        : (existing.tax_rate !== undefined && existing.tax_rate !== null ? parseFloat(existing.tax_rate) : 0.18);
      const normUpdRate = Number.isFinite(parsedUpdRate) ? (parsedUpdRate > 1 ? parsedUpdRate / 100 : Math.max(0, parsedUpdRate)) : 0.18;
      const resolvedTaxRate = (resolvedAplicaItbis === 1 && resolvedTaxMode !== 'zero' && resolvedTaxMode !== 'exempt')
        ? normUpdRate
        : 0;

      const [result] = await pool.query(
        `UPDATE services SET
          name=?, nombre=?, categoria=?, category=?, commission_category_id=?, subcategoria=?,
          precio=?, price=?, costo=?, duracion=?, duration_minutes=?,
          activo=?, is_active=?, tipo_comision=?, comision_valor=?,
          item_type=?, sku=?, barcode=?, unit_of_measure=?, aplica_itbis=?, tax_rate=?, tax_mode=?, min_stock=?, track_stock=?,
          updated_at=NOW()
         WHERE id=? AND tenant_id=?`,
        [
          finalName,
          finalName,
          cleanCategory,
          cleanCategory,
          catResolution.id,
          subcategoria || existing.subcategoria || 'General',
          parsedPrice,
          parsedPrice,
          parsedCost,
          parsedDuration,
          parsedDuration,
          isActive,
          Boolean(isActive),
          tipo_comision || existing.tipo_comision || 'Porcentaje',
          parseFloat(comision_valor !== undefined ? comision_valor : existing.comision_valor) || 0,
          nextType,
          cleanSku,
          cleanBarcode,
          unit_of_measure || existing.unit_of_measure || 'unit',
          resolvedAplicaItbis,
          resolvedTaxRate,
          resolvedTaxMode,
          min_stock !== undefined ? parseFloat(min_stock) || 0 : (existing.min_stock ?? 0),
          nextType === 'PRODUCTO' ? (track_stock !== undefined ? Boolean(track_stock) : (existing.track_stock ?? true)) : false,
          id,
          tenantId
        ]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Ítem no encontrado' });
      }
      res.json({ success: true, message: 'Catálogo actualizado exitosamente' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Alternar estado activo/inactivo del servicio
  router.patch('/:id/toggle-status', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      await pool.query(
        'UPDATE services SET activo = CASE WHEN COALESCE(activo, 1) = 1 THEN 0 ELSE 1 END, is_active = NOT COALESCE(is_active, true), updated_at = NOW() WHERE id = ? AND tenant_id = ?',
        [id, tenantId]
      );
      res.json({ success: true, message: 'Estado del servicio actualizado' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Eliminar o archivar ítem del Catálogo (archiva automáticamente si tiene historial/stock/movimientos)
  router.delete('/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;

      const [stockHits] = await pool.query(
        'SELECT 1 FROM inventory_stock WHERE product_id = ? AND tenant_id = ? LIMIT 1',
        [id, tenantId]
      );
      const [movHits] = await pool.query(
        'SELECT 1 FROM inventory_movements WHERE product_id = ? AND tenant_id = ? LIMIT 1',
        [id, tenantId]
      );
      const [invItemHits] = await pool.query(
        'SELECT 1 FROM invoice_items WHERE service_id = ? AND tenant_id = ? LIMIT 1',
        [id, tenantId]
      );

      if (
        (stockHits && stockHits.length > 0) ||
        (movHits && movHits.length > 0) ||
        (invItemHits && invItemHits.length > 0)
      ) {
        const [arch] = await pool.query(
          'UPDATE services SET is_active = FALSE, activo = 0, updated_at = NOW() WHERE id = ? AND tenant_id = ?',
          [id, tenantId]
        );
        const affected = arch?.rowCount ?? arch?.affectedRows ?? 0;
        if (affected === 0) {
          return res.status(404).json({ error: 'Ítem no encontrado en esta empresa.' });
        }
        return res.json({
          success: true,
          archived: true,
          message: 'El ítem tiene historial de stock o ventas; fue archivado en lugar de eliminarse.'
        });
      }

      const [result] = await pool.query('DELETE FROM services WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      const affected = result?.rowCount ?? result?.affectedRows ?? 0;
      if (affected === 0) {
        return res.status(404).json({ error: 'Servicio no encontrado en esta empresa.' });
      }
      res.json({ success: true, archived: false, message: 'Servicio eliminado exitosamente' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createServicesRouter };
