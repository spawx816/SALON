const express = require('express');

/**
 * Creates and configures the Express Router for Services & Items catalogue management.
 * @param {import('mysql2/promise').Pool} pool - Database connection pool
 * @returns {express.Router}
 */
function createServicesRouter(pool) {
  const router = express.Router();

  // 1. Importación masiva de ítems y catálogo
  router.post('/bulk-import', async (req, res) => {
    try {
      const { items } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'No se recibieron ítems válidos.' });
      }

      let insertedCount = 0;
      for (const item of items) {
        if (!item.nombre && !item.name) continue;
        const name = (item.nombre || item.name).trim();
        const desc = item.descripcion || item.description || '';
        const category = item.categoria || item.category || 'General';
        const price = parseFloat(item.precio || item.price || 0);
        const active = item.activo !== undefined ? (item.activo ? 1 : 0) : 1;
        const generaComision = item.genera_comision !== undefined ? (item.genera_comision ? 1 : 0) : 1;
        const tipoComision = item.tipo_comision || 'Porcentaje';
        const comisionValor = parseFloat(item.comision_valor || item.comision || 15);
        const aplicaItbis = item.aplica_itbis !== undefined ? (item.aplica_itbis ? 1 : 0) : 0;
        const orden = parseInt(item.orden_visualizacion || 0);

        await pool.query(
          `INSERT INTO services 
            (nombre, descripcion, categoria, precio, activo, genera_comision, tipo_comision, comision_valor, aplica_itbis, orden_visualizacion)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE 
            descripcion = VALUES(descripcion),
            categoria = VALUES(categoria),
            precio = VALUES(precio),
            activo = VALUES(activo),
            genera_comision = VALUES(genera_comision),
            tipo_comision = VALUES(tipo_comision),
            comision_valor = VALUES(comision_valor),
            aplica_itbis = VALUES(aplica_itbis),
            orden_visualizacion = VALUES(orden_visualizacion)`,
          [name, desc, category, price, active, generaComision, tipoComision, comisionValor, aplicaItbis, orden]
        );

        insertedCount++;
      }

      res.json({ success: true, count: insertedCount, message: `Se importaron ${insertedCount} ítems/servicios exitosamente.` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. Obtener lista de servicios
  router.get('/', async (req, res) => {
    try {
      const { active_only } = req.query;
      let query = 'SELECT * FROM services';
      if (active_only === '1') {
        query += ' WHERE activo = 1';
      }
      query += ' ORDER BY orden_visualizacion ASC, nombre ASC';

      let [rows] = await pool.query(query);

      // Si la tabla está vacía, inicializar con catálogo base
      if (rows.length === 0) {
        const initialServices = [
          { nombre: 'Lavado y Secado', categoria: 'Peluquería', precio: 500.00, genera_comision: 1, tipo_comision: 'Porcentaje', comision_valor: 15, orden_visualizacion: 1 },
          { nombre: 'Corte de Pelo Dama', categoria: 'Peluquería', precio: 800.00, genera_comision: 1, tipo_comision: 'Porcentaje', comision_valor: 20, orden_visualizacion: 2 },
          { nombre: 'Tinte Completo', categoria: 'Coloración', precio: 2200.00, genera_comision: 1, tipo_comision: 'Porcentaje', comision_valor: 20, orden_visualizacion: 3 },
          { nombre: 'Tratamiento Penetratti', categoria: 'Tratamientos', precio: 1500.00, genera_comision: 1, tipo_comision: 'Porcentaje', comision_valor: 15, orden_visualizacion: 4 },
          { nombre: 'Manicura Rusa', categoria: 'Uñas', precio: 650.00, genera_comision: 1, tipo_comision: 'Porcentaje', comision_valor: 30, orden_visualizacion: 5 },
          { nombre: 'Pedicura Spa', categoria: 'Uñas', precio: 850.00, genera_comision: 1, tipo_comision: 'Porcentaje', comision_valor: 30, orden_visualizacion: 6 }
        ];

        for (const s of initialServices) {
          await pool.query(
            `INSERT INTO services (nombre, categoria, precio, activo, genera_comision, tipo_comision, comision_valor, orden_visualizacion)
             VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
            [s.nombre, s.categoria, s.precio, s.genera_comision, s.tipo_comision, s.comision_valor, s.orden_visualizacion]
          );
        }
        [rows] = await pool.query(query);
      }

      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. Top Servicios más facturados / acceso rápido para POS
  router.get('/top', async (req, res) => {
    try {
      const { salon_id, limit = 20 } = req.query;

      const [activeServices] = await pool.query('SELECT * FROM services WHERE activo = 1 ORDER BY orden_visualizacion ASC, nombre ASC');

      if (activeServices.length === 0) {
        return res.json([]);
      }

      let visitsQuery = "SELECT items_detail, servicios FROM visits WHERE (status = 'Facturado' OR status = 'Completado')";
      const params = [];
      if (salon_id && salon_id !== 'all') {
        visitsQuery += " AND (salon_id = ? OR salon_id IS NULL OR salon_id = 0)";
        params.push(salon_id);
      }
      const [visits] = await pool.query(visitsQuery, params);
      const usageCounts = {};

      visits.forEach(v => {
        let items = [];
        try { 
          if (v.items_detail) items = typeof v.items_detail === 'string' ? JSON.parse(v.items_detail) : v.items_detail; 
        } catch(e){}
        
        if (Array.isArray(items) && items.length > 0) {
          items.forEach(item => {
            const sName = (item.servicio || item.nombre || item.name || '').trim().toLowerCase();
            if (sName) {
              usageCounts[sName] = (usageCounts[sName] || 0) + (parseInt(item.cantidad) || 1);
            }
          });
        } else if (v.servicios) {
          try {
            const raw = typeof v.servicios === 'string' ? JSON.parse(v.servicios) : v.servicios;
            if (Array.isArray(raw)) {
              raw.forEach(s => {
                const sName = (typeof s === 'string' ? s : (s.nombre || s.servicio || '')).trim().toLowerCase();
                if (sName) usageCounts[sName] = (usageCounts[sName] || 0) + 1;
              });
            }
          } catch (e) {}
        }
      });

      const priorityKeywords = [
        'lavado y secado', 'lavado', 'secado', 'corte de punta', 'corte', 'tratamiento', 
        'plancha', 'mascarilla', 'penetraitt', 'botox', 'tinte', 'retoque', 'manicura', 
        'pedicura', 'uñas', 'maquillaje', 'depilacion', 'alisado'
      ];

      const getPriorityScore = (name) => {
        const lower = (name || '').toLowerCase();
        for (let i = 0; i < priorityKeywords.length; i++) {
          if (lower.includes(priorityKeywords[i])) {
            return 1000 - (i * 10);
          }
        }
        return 0;
      };

      const sortedServices = [...activeServices].sort((a, b) => {
        const aName = (a.nombre || '').trim().toLowerCase();
        const bName = (b.nombre || '').trim().toLowerCase();
        const countA = usageCounts[aName] || 0;
        const countB = usageCounts[bName] || 0;

        if (countB !== countA) {
          return countB - countA;
        }
        return getPriorityScore(b.nombre) - getPriorityScore(a.nombre);
      });

      res.json(sortedServices.slice(0, parseInt(limit) || 20));
    } catch (err) {
      console.error('[TOP SERVICES ERROR]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 4. Crear nuevo servicio
  router.post('/', async (req, res) => {
    try {
      const {
        nombre, descripcion, categoria, precio, activo,
        genera_comision, tipo_comision, comision_valor,
        aplica_itbis, orden_visualizacion, imagen_url
      } = req.body;

      if (!nombre || !nombre.trim()) {
        return res.status(400).json({ error: 'El nombre del servicio es obligatorio.' });
      }

      const trimmedName = nombre.trim();
      const [existing] = await pool.query('SELECT id, nombre FROM services WHERE LOWER(TRIM(nombre)) = LOWER(?)', [trimmedName]);
      if (existing.length > 0) {
        return res.status(400).json({ error: `Ya existe un ítem registrado con el nombre "${existing[0].nombre}". No se permiten duplicados.` });
      }

      const [result] = await pool.query(
        `INSERT INTO services 
          (nombre, descripcion, categoria, precio, activo, genera_comision, tipo_comision, comision_valor, aplica_itbis, orden_visualizacion, imagen_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trimmedName,
          descripcion || '',
          categoria || 'General',
          parseFloat(precio) || 0,
          activo !== undefined ? (activo ? 1 : 0) : 1,
          genera_comision !== undefined ? (genera_comision ? 1 : 0) : 1,
          tipo_comision || 'Porcentaje',
          parseFloat(comision_valor) || 0,
          aplica_itbis !== undefined ? (aplica_itbis ? 1 : 0) : 0,
          parseInt(orden_visualizacion) || 0,
          imagen_url || ''
        ]
      );

      res.json({ success: true, serviceId: result.insertId, message: 'Servicio creado exitosamente' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5. Actualizar servicio existente
  router.put('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const {
        nombre, descripcion, categoria, precio, activo,
        genera_comision, tipo_comision, comision_valor,
        aplica_itbis, orden_visualizacion, imagen_url
      } = req.body;

      if (!nombre || !nombre.trim()) {
        return res.status(400).json({ error: 'El nombre del servicio es obligatorio.' });
      }

      const trimmedName = nombre.trim();
      const [existing] = await pool.query('SELECT id, nombre FROM services WHERE LOWER(TRIM(nombre)) = LOWER(?) AND id != ?', [trimmedName, id]);
      if (existing.length > 0) {
        return res.status(400).json({ error: `Ya existe otro ítem registrado con el nombre "${existing[0].nombre}". No se permiten duplicados.` });
      }

      await pool.query(
        `UPDATE services SET
          nombre = ?,
          descripcion = ?,
          categoria = ?,
          precio = ?,
          activo = ?,
          genera_comision = ?,
          tipo_comision = ?,
          comision_valor = ?,
          aplica_itbis = ?,
          orden_visualizacion = ?,
          imagen_url = ?
         WHERE id = ?`,
        [
          trimmedName,
          descripcion || '',
          categoria || 'General',
          parseFloat(precio) || 0,
          activo !== undefined ? (activo ? 1 : 0) : 1,
          genera_comision !== undefined ? (genera_comision ? 1 : 0) : 1,
          tipo_comision || 'Porcentaje',
          parseFloat(comision_valor) || 0,
          aplica_itbis !== undefined ? (aplica_itbis ? 1 : 0) : 0,
          parseInt(orden_visualizacion) || 0,
          imagen_url || '',
          id
        ]
      );

      res.json({ success: true, message: 'Servicio actualizado exitosamente' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 6. Activar / Desactivar servicio
  router.patch('/:id/toggle-status', async (req, res) => {
    try {
      const { id } = req.params;
      const [rows] = await pool.query('SELECT activo FROM services WHERE id = ?', [id]);
      if (rows.length === 0) return res.status(404).json({ error: 'Servicio no encontrado' });

      const newStatus = rows[0].activo === 1 ? 0 : 1;
      await pool.query('UPDATE services SET activo = ? WHERE id = ?', [newStatus, id]);

      res.json({ success: true, activo: newStatus, message: `Servicio ${newStatus === 1 ? 'activado' : 'desactivado'} exitosamente` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 7. Eliminar servicio (con protección de integridad histórica)
  router.delete('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const [srvRows] = await pool.query('SELECT * FROM services WHERE id = ?', [id]);
      if (srvRows.length === 0) return res.status(404).json({ error: 'Servicio no encontrado' });

      const serviceName = srvRows[0].nombre;

      // Verificar si ha sido facturado anteriormente
      const [usedInVisits] = await pool.query(
        `SELECT id FROM visits WHERE JSON_SEARCH(items_detail, 'one', ?) IS NOT NULL OR JSON_SEARCH(servicios, 'one', ?) IS NOT NULL LIMIT 1`,
        [serviceName, serviceName]
      );

      if (usedInVisits.length > 0) {
        // Soft delete para proteger facturación
        await pool.query('UPDATE services SET activo = 0 WHERE id = ?', [id]);
        return res.json({
          success: true,
          protected: true,
          message: 'El servicio ha sido facturado anteriormente. Para proteger la integridad histórica de las facturas, el ítem ha sido Desactivado en lugar de eliminado.'
        });
      }

      await pool.query('DELETE FROM services WHERE id = ?', [id]);
      res.json({ success: true, message: 'Servicio eliminado permanentemente.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createServicesRouter };
