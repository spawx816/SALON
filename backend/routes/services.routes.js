const express = require('express');

/**
 * Catalog and Services Router module for Salon Pro & Plan Beauty RD (Scoped by tenant_id)
 */
function createServicesRouter(pool) {
  const router = express.Router();

  // Obtener lista de servicios del tenant autenticado
  router.get('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { active_only } = req.query;
      let query = 'SELECT * FROM services WHERE tenant_id = ?';
      const params = [tenantId];
      if (active_only === '1' || active_only === 'true') {
        query += ' AND COALESCE(activo, 1) = 1';
      }
      query += ' ORDER BY COALESCE(categoria, category, \'General\') ASC, COALESCE(nombre, name, \'\') ASC';
      const [rows] = await pool.query(query, params);
      const normalized = rows.map(r => ({
        ...r,
        nombre: r.nombre || r.name || 'Servicio',
        categoria: r.categoria || r.category || 'General',
        precio: parseFloat(r.precio ?? r.price ?? 0),
        duracion: parseInt(r.duracion ?? r.duration_minutes ?? 30),
        activo: r.activo !== undefined && r.activo !== null ? r.activo : (r.is_active ? 1 : 0)
      }));
      res.json(normalized);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Obtener servicio por ID dentro del tenant autenticado
  router.get('/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const [rows] = await pool.query('SELECT * FROM services WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'Servicio no encontrado en este salón.' });
      }
      const r = rows[0];
      res.json({
        ...r,
        nombre: r.nombre || r.name || 'Servicio',
        categoria: r.categoria || r.category || 'General',
        precio: parseFloat(r.precio ?? r.price ?? 0),
        duracion: parseInt(r.duracion ?? r.duration_minutes ?? 30),
        activo: r.activo !== undefined && r.activo !== null ? r.activo : (r.is_active ? 1 : 0)
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Obtener los servicios más utilizados por sucursal dentro del tenant autenticado
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

      const scoredServices = activeServices.map(srv => {
        const srvName = srv.nombre || srv.name || 'Servicio';
        const key = srvName.trim().toLowerCase();
        return {
          ...srv,
          nombre: srvName,
          categoria: srv.categoria || srv.category || 'General',
          precio: parseFloat(srv.precio ?? srv.price ?? 0),
          duracion: parseInt(srv.duracion ?? srv.duration_minutes ?? 30),
          activo: srv.activo !== undefined && srv.activo !== null ? srv.activo : (srv.is_active ? 1 : 0),
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

  // Crear nuevo servicio en el tenant autenticado
  router.post('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { nombre, name, categoria, subcategoria, precio, price, costo, duracion, duration, activo, tipo_comision, comision_valor } = req.body;
      const finalName = (nombre || name || '').trim();
      const rawPrice = precio !== undefined ? precio : price;
      if (!finalName || rawPrice === undefined) {
        return res.status(400).json({ error: 'Nombre y precio son obligatorios' });
      }
      const parsedPrice = parseFloat(rawPrice) || 0;
      const parsedDuration = parseInt(duracion !== undefined ? duracion : duration) || 30;
      const isActive = activo !== undefined ? (activo ? 1 : 0) : 1;

      const [result] = await pool.query(
        'INSERT INTO services (tenant_id, name, nombre, categoria, subcategoria, precio, price, costo, duracion, duration_minutes, activo, is_active, tipo_comision, comision_valor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
        [
          tenantId,
          finalName,
          finalName,
          categoria || 'Peluquería',
          subcategoria || 'General',
          parsedPrice,
          parsedPrice,
          parseFloat(costo) || 0,
          parsedDuration,
          parsedDuration,
          isActive,
          Boolean(isActive),
          tipo_comision || 'Porcentaje',
          parseFloat(comision_valor) || 0
        ]
      );
      res.json({ id: result.insertId || result[0]?.id, success: true, message: 'Servicio creado exitosamente' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Actualizar servicio existente del tenant autenticado
  router.put('/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const { nombre, name, categoria, subcategoria, precio, costo, duracion, activo, tipo_comision, comision_valor } = req.body;
      const finalName = (nombre || name || '').trim();
      const parsedPrice = parseFloat(precio) || 0;
      const parsedDuration = parseInt(duracion) || 30;
      const isActive = activo ? 1 : 0;

      const [result] = await pool.query(
        'UPDATE services SET name=?, nombre=?, categoria=?, subcategoria=?, precio=?, price=?, costo=?, duracion=?, duration_minutes=?, activo=?, is_active=?, tipo_comision=?, comision_valor=? WHERE id=? AND tenant_id=?',
        [
          finalName,
          finalName,
          categoria,
          subcategoria || 'General',
          parsedPrice,
          parsedPrice,
          parseFloat(costo) || 0,
          parsedDuration,
          parsedDuration,
          isActive,
          Boolean(isActive),
          tipo_comision || 'Porcentaje',
          parseFloat(comision_valor) || 0,
          id,
          tenantId
        ]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Servicio no encontrado' });
      }
      res.json({ success: true, message: 'Servicio actualizado exitosamente' });
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
        'UPDATE services SET activo = CASE WHEN COALESCE(activo, 1) = 1 THEN 0 ELSE 1 END, is_active = NOT COALESCE(is_active, true) WHERE id = ? AND tenant_id = ?',
        [id, tenantId]
      );
      res.json({ success: true, message: 'Estado del servicio actualizado' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Eliminar servicio del tenant autenticado
  router.delete('/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const [result] = await pool.query('DELETE FROM services WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      const affected = result?.rowCount ?? result?.affectedRows ?? 0;
      if (affected === 0) {
        return res.status(404).json({ error: 'Servicio no encontrado en este salón.' });
      }
      res.json({ success: true, message: 'Servicio eliminado exitosamente' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createServicesRouter };
