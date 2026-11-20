const express = require('express');
const { getPrivateStorageAdapter } = require('../services/private_storage_adapter');

/**
 * Employees, Staff Records and Positions Router (Scoped strictly by tenant_id)
 */
function createEmployeesRouter(pool) {
  const router = express.Router();

  const parseDataUriBuffer = (dataUri) => {
    const match = String(dataUri || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) return null;
    return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
  };

  // GET /api/employees
  router.get('/', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: 'Contexto de empresa requerido.' });
      }

      const [rows] = await pool.query(`
        SELECT s.*, s.contacto as telefono, COALESCE(b.name, sal.name, s.localidad, 'Principal') as salon_name 
        FROM staff_records s
        LEFT JOIN branches b ON s.salon_id::text = b.id::text AND b.tenant_id = s.tenant_id
        LEFT JOIN salons sal ON s.salon_id::text = sal.id::text AND sal.tenant_id = s.tenant_id
        WHERE s.tenant_id = ?
        ORDER BY s.nombre ASC
      `, [tenantId]);
      const hydrated = (rows || []).map((row) => ({
        ...row,
        has_profile_photo: Boolean(row.profile_photo_file_id || row.profile_photo),
        profile_photo: row.profile_photo_file_id
          ? `/api/employees/${encodeURIComponent(row.id)}/photo?v=${encodeURIComponent(row.profile_photo_file_id)}`
          : (row.profile_photo || null),
      }));
      res.json(hydrated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/employees/:id/photo (stream decrypted employee photo scoped strictly by tenant_id)
  router.get('/:id/photo', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Contexto de empresa requerido.' });
      const [rows] = await pool.query(
        'SELECT profile_photo, profile_photo_file_id FROM staff_records WHERE id::text = ? AND tenant_id = ? LIMIT 1',
        [String(req.params.id), tenantId]
      );
      if (!rows || rows.length === 0) return res.status(404).end();
      const rec = rows[0];

      if (rec.profile_photo_file_id) {
        const storage = getPrivateStorageAdapter({ pool });
        const fileData = await storage.readFile({ tenantId, fileId: rec.profile_photo_file_id });
        res.setHeader('Content-Type', fileData.mimeType || 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=300');
        return res.send(fileData.buffer);
      }

      if (rec.profile_photo) {
        const parsed = parseDataUriBuffer(rec.profile_photo);
        if (parsed) {
          res.setHeader('Content-Type', parsed.mimeType);
          res.setHeader('Cache-Control', 'private, max-age=300');
          return res.send(parsed.buffer);
        }
      }
      return res.status(404).end();
    } catch (err) {
      console.error('[EMPLOYEE PHOTO READ ERROR]:', err.message);
      return res.status(404).end();
    }
  });

  // --- Gestión de Posiciones de Personal (staff_positions) ---
  router.get('/positions', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      let [rows] = await pool.query(
        'SELECT * FROM staff_positions WHERE tenant_id = ? ORDER BY name ASC',
        [tenantId]
      );
      if (rows.length === 0) {
        const defaultPositions = ['Estilista', 'Manicurista', 'Lava Pelo', 'Recepcionista', 'Maquillista', 'Encargada'];
        for (const pos of defaultPositions) {
          await pool.query(
            'INSERT INTO staff_positions (tenant_id, name) VALUES (?, ?) ON CONFLICT (tenant_id, name) DO NOTHING',
            [tenantId, pos]
          );
        }
        [rows] = await pool.query('SELECT * FROM staff_positions WHERE tenant_id = ? ORDER BY name ASC', [tenantId]);
      }
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/positions', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { name } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre de la posición es requerido' });
      const cleanName = name.trim();
      await pool.query(
        'INSERT INTO staff_positions (tenant_id, name) VALUES (?, ?) ON CONFLICT (tenant_id, name) DO NOTHING',
        [tenantId, cleanName]
      );
      const [rows] = await pool.query('SELECT * FROM staff_positions WHERE tenant_id = ? ORDER BY name ASC', [tenantId]);
      res.json({ success: true, positions: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/positions/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      const { name } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es requerido' });
      const cleanName = name.trim();

      const [oldPos] = await pool.query('SELECT name FROM staff_positions WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      if (oldPos.length === 0) {
        return res.status(404).json({ error: 'Posición no encontrada en esta empresa' });
      }
      await pool.query('UPDATE staff_positions SET name = ? WHERE id = ? AND tenant_id = ?', [cleanName, id, tenantId]);

      if (oldPos[0].name !== cleanName) {
        await pool.query('UPDATE staff_records SET posicion = ? WHERE posicion = ? AND tenant_id = ?', [cleanName, oldPos[0].name, tenantId]);
      }

      const [rows] = await pool.query('SELECT * FROM staff_positions WHERE tenant_id = ? ORDER BY name ASC', [tenantId]);
      res.json({ success: true, positions: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/positions/:id', async (req, res) => {
    try {
      const tenantId = req.tenantId;
      const { id } = req.params;
      await pool.query('DELETE FROM staff_positions WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      const [rows] = await pool.query('SELECT * FROM staff_positions WHERE tenant_id = ? ORDER BY name ASC', [tenantId]);
      res.json({ success: true, positions: rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/employees
  router.post('/', async (req, res) => {
    const { nombre, posicion, localidad, salon_id, status, cedula, telefono, contacto, direccion, email, fecha_entrada, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos, salario_base, tipo_salario, commission_scheme_id, scheme_effective_date, profile_photo } = req.body;
    try {
      const tenantId = req.tenantId;
      const cleanDate = fecha_entrada && fecha_entrada.trim() !== '' ? fecha_entrada : null;
      const cleanSchemeDate = scheme_effective_date && scheme_effective_date.trim() !== '' ? scheme_effective_date : null;
      const contactValue = contacto !== undefined ? contacto : (telefono !== undefined ? telefono : null);

      let profilePhotoFileId = null;
      if (typeof profile_photo === 'string' && profile_photo.startsWith('data:image/')) {
        const storage = getPrivateStorageAdapter({ pool });
        const saved = await storage.saveBase64({
          tenantId,
          category: 'profile_photo',
          base64Data: profile_photo,
        });
        profilePhotoFileId = saved.id;
      }

      const [result] = await pool.query(
        'INSERT INTO staff_records (tenant_id, nombre, posicion, localidad, salon_id, status, cedula, contacto, direccion, email, fecha_entrada, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos, salario_base, tipo_salario, commission_scheme_id, scheme_effective_date, profile_photo, profile_photo_file_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?) RETURNING id',
        [
          tenantId,
          nombre,
          posicion || 'Estilista',
          localidad || 'Principal',
          salon_id || 1,
          status || 'Activo',
          cedula || null,
          contactValue || null,
          direccion || null,
          email || null,
          cleanDate,
          hora_entrada || '09:00:00',
          hora_salida || '18:00:00',
          typeof dias_laborables === 'object' ? JSON.stringify(dias_laborables) : (dias_laborables || null),
          tolerancia_minutos !== undefined ? tolerancia_minutos : 15,
          parseFloat(salario_base) || 0,
          tipo_salario || 'fijo_mas_comision',
          commission_scheme_id || null,
          cleanSchemeDate,
          profilePhotoFileId
        ]
      );
      res.json({ id: result.insertId || result[0]?.id, profile_photo_file_id: profilePhotoFileId, success: true });
    } catch (err) {
      console.error('Error creating employee:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/employees/:id
  router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { nombre, posicion, localidad, salon_id, status, cedula, telefono, contacto, direccion, email, fecha_entrada, fecha_salida, motivo_salida, hora_entrada, hora_salida, dias_laborables, tolerancia_minutos, salario_base, tipo_salario, commission_scheme_id, scheme_effective_date, profile_photo } = req.body;
    try {
      const tenantId = req.tenantId;
      const cleanDate = fecha_entrada !== undefined ? (fecha_entrada && String(fecha_entrada).trim() !== '' ? (String(fecha_entrada).includes('T') ? String(fecha_entrada).split('T')[0] : fecha_entrada) : null) : undefined;
      const cleanExitDate = fecha_salida !== undefined ? (fecha_salida && String(fecha_salida).trim() !== '' ? (String(fecha_salida).includes('T') ? String(fecha_salida).split('T')[0] : fecha_salida) : null) : undefined;
      const cleanSchemeDate = scheme_effective_date !== undefined ? (scheme_effective_date && String(scheme_effective_date).trim() !== '' ? (String(scheme_effective_date).includes('T') ? String(scheme_effective_date).split('T')[0] : scheme_effective_date) : null) : undefined;
      const contactValue = contacto !== undefined ? contacto : telefono;

      let newProfilePhotoFileId = null;
      let shouldClearPhoto = false;
      if (typeof profile_photo === 'string' && profile_photo.startsWith('data:image/')) {
        const storage = getPrivateStorageAdapter({ pool });
        const saved = await storage.saveBase64({
          tenantId,
          category: 'profile_photo',
          base64Data: profile_photo,
        });
        newProfilePhotoFileId = saved.id;
      } else if (profile_photo === '') {
        shouldClearPhoto = true;
      }

      await pool.query(
        `UPDATE staff_records SET 
          nombre = COALESCE(?, nombre), 
          posicion = COALESCE(?, posicion), 
          localidad = COALESCE(?, localidad), 
          salon_id = COALESCE(?, salon_id), 
          status = COALESCE(?, status), 
          cedula = COALESCE(?, cedula), 
          contacto = COALESCE(?, contacto), 
          direccion = COALESCE(?, direccion),
          email = COALESCE(?, email), 
          fecha_entrada = COALESCE(?, fecha_entrada),
          fecha_salida = COALESCE(?, fecha_salida),
          motivo_salida = COALESCE(?, motivo_salida),
          hora_entrada = COALESCE(?, hora_entrada),
          hora_salida = COALESCE(?, hora_salida),
          dias_laborables = COALESCE(?, dias_laborables),
          tolerancia_minutos = COALESCE(?, tolerancia_minutos),
          salario_base = COALESCE(?, salario_base),
          tipo_salario = COALESCE(?, tipo_salario),
          commission_scheme_id = ?,
          scheme_effective_date = ?,
          profile_photo = CASE WHEN ? THEN NULL ELSE profile_photo END,
          profile_photo_file_id = CASE WHEN ? THEN ? WHEN ? THEN NULL ELSE profile_photo_file_id END
        WHERE id = ? AND tenant_id = ?`,
        [
          nombre ?? null,
          posicion ?? null,
          localidad ?? null,
          salon_id ?? null,
          status ?? null,
          cedula ?? null,
          contactValue ?? null,
          direccion ?? null,
          email !== undefined ? email : null,
          cleanDate !== undefined ? cleanDate : null,
          cleanExitDate !== undefined ? cleanExitDate : null,
          motivo_salida ?? null,
          hora_entrada ?? null,
          hora_salida ?? null,
          typeof dias_laborables === 'object' ? JSON.stringify(dias_laborables) : (dias_laborables ?? null),
          tolerancia_minutos ?? null,
          salario_base !== undefined && salario_base !== '' ? parseFloat(salario_base) : null,
          tipo_salario || null,
          commission_scheme_id !== undefined ? (commission_scheme_id || null) : null,
          cleanSchemeDate !== undefined ? cleanSchemeDate : null,
          Boolean(newProfilePhotoFileId || shouldClearPhoto),
          Boolean(newProfilePhotoFileId),
          newProfilePhotoFileId,
          shouldClearPhoto,
          id,
          tenantId
        ]
      );
      res.json({ success: true, profile_photo_file_id: newProfilePhotoFileId });
    } catch (err) {
      console.error('Error updating employee:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/employees/:id
  router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const tenantId = req.tenantId;
      await pool.query('DELETE FROM staff_records WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      res.json({ success: true });
    } catch (err) {
      console.error('Error deleting employee:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = {
  createEmployeesRouter
};
