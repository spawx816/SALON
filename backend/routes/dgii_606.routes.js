const express = require('express');

/**
 * DGII 606 Compras y Gastos Router
 * Cumple con la Norma General 07-2018 y 05-2019 de la DGII (República Dominicana)
 * @param {import('mysql2/promise').Pool} pool
 */
function createDgii606Router(pool) {
  const router = express.Router();

  // Asegurar que la tabla exista
  const ensureTable = async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dgii_606_purchases (
        id INT AUTO_INCREMENT PRIMARY KEY,
        periodo VARCHAR(6) NOT NULL,
        rnc_cedula VARCHAR(20) NOT NULL,
        tipo_id INT NOT NULL DEFAULT 1,
        tipo_bienes_servicios VARCHAR(4) NOT NULL DEFAULT '02',
        proveedor VARCHAR(255) NOT NULL,
        ncf VARCHAR(20) NOT NULL,
        ncf_modificado VARCHAR(20) DEFAULT '',
        fecha_factura VARCHAR(10) NOT NULL,
        fecha_pago VARCHAR(10) DEFAULT '',
        tipo_compra VARCHAR(50) DEFAULT 'Bienes',
        clasificacion_gasto VARCHAR(255) DEFAULT '02 - Gastos por trabajos, suministros y servicios',
        monto_servicios DECIMAL(14,2) DEFAULT 0,
        monto_bienes DECIMAL(14,2) DEFAULT 0,
        total_facturado DECIMAL(14,2) NOT NULL DEFAULT 0,
        itbis_facturado DECIMAL(14,2) DEFAULT 0,
        itbis_retenido DECIMAL(14,2) DEFAULT 0,
        itbis_proporcionalidad DECIMAL(14,2) DEFAULT 0,
        itbis_costo DECIMAL(14,2) DEFAULT 0,
        itbis_adelantar DECIMAL(14,2) DEFAULT 0,
        itbis_percibido DECIMAL(14,2) DEFAULT 0,
        tipo_retencion_isr VARCHAR(4) DEFAULT '',
        isr_retenido DECIMAL(14,2) DEFAULT 0,
        isr_percibido DECIMAL(14,2) DEFAULT 0,
        isc DECIMAL(14,2) DEFAULT 0,
        otros_impuestos DECIMAL(14,2) DEFAULT 0,
        propina_legal DECIMAL(14,2) DEFAULT 0,
        forma_pago VARCHAR(4) DEFAULT '02',
        estado VARCHAR(20) DEFAULT 'Completa',
        errores_validacion TEXT DEFAULT NULL,
        notas TEXT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_periodo (periodo),
        INDEX idx_rnc (rnc_cedula),
        INDEX idx_ncf (ncf)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  };

  // Helper para determinar Tipo de Identificación (1 = RNC 9 dígitos, 2 = Cédula 11 dígitos, 3 = Pasaporte)
  const computeTipoId = (rnc) => {
    const clean = String(rnc || '').replace(/\D/g, '');
    if (clean.length === 9) return 1;
    if (clean.length === 11) return 2;
    return 3;
  };

  // Validación rigurosa de NCF
  const isValidNcfFormat = (ncf) => {
    if (!ncf) return false;
    const clean = String(ncf).trim().toUpperCase();
    if (clean === 'PENDIENTE') return false;

    // Formato Serie B (11 caracteres): B + 2 dígitos de tipo + 8 dígitos de secuencia
    const bRegex = /^B(01|02|03|04|11|12|13|14|15|16)\d{8}$/;
    // Formato e-CF Serie E (13 caracteres): E + 2 dígitos de tipo + 10 dígitos de secuencia
    const eRegex = /^E(31|32|33|34|41|43|44|45)\d{10}$/;

    return bRegex.test(clean) || eRegex.test(clean);
  };

  // Evaluación diagnóstica completa de un registro para la DGII
  const evaluateInvoiceCompliance = (row) => {
    const errors = [];
    const cleanRnc = String(row.rnc_cedula || '').replace(/\D/g, '');
    const cleanNcf = String(row.ncf || '').trim().toUpperCase();

    // 1. Validación de RNC / Cédula
    if (!cleanRnc) {
      errors.push('El RNC/Cédula es requerido.');
    } else if (row.tipo_id === 1 && cleanRnc.length !== 9) {
      errors.push('El RNC debe tener exactamente 9 dígitos numéricos.');
    } else if (row.tipo_id === 2 && cleanRnc.length !== 11) {
      errors.push('La Cédula debe tener exactamente 11 dígitos numéricos.');
    } else if (row.tipo_id === 3 && cleanRnc.length < 5) {
      errors.push('El Pasaporte debe tener al menos 5 caracteres.');
    }

    // 2. Validación de NCF
    if (!cleanNcf || cleanNcf === 'PENDIENTE') {
      errors.push('El NCF está pendiente o no fue especificado.');
    } else if (!isValidNcfFormat(cleanNcf)) {
      errors.push(`El formato del NCF (${cleanNcf}) no corresponde a una serie válida de la DGII (B01-B16 o E31-E45).`);
    }

    // 3. Validación de NCF Modificado (Obligatorio en Notas de Crédito / Débito)
    const isNotaCreditoODebito = cleanNcf.startsWith('B04') || cleanNcf.startsWith('B03') || cleanNcf.startsWith('E34') || cleanNcf.startsWith('E33');
    if (isNotaCreditoODebito && (!row.ncf_modificado || !isValidNcfFormat(row.ncf_modificado))) {
      errors.push('Las Notas de Crédito/Débito requieren un NCF Modificado válido.');
    }

    // 4. Validación de Fechas
    if (!row.fecha_factura) {
      errors.push('La fecha de la factura es obligatoria.');
    }
    const hasRetenciones = Number(row.itbis_retenido || 0) > 0 || Number(row.isr_retenido || 0) > 0;
    if (hasRetenciones && !row.fecha_pago) {
      errors.push('La fecha de pago es obligatoria cuando existen retenciones de ITBIS o ISR.');
    }

    // 5. Validación de Montos
    const totalFacturado = Number(row.total_facturado || 0);
    if (totalFacturado <= 0) {
      errors.push('El monto total facturado debe ser mayor a 0.');
    }

    // 6. Validación de Retención ISR vs Tipo
    if (Number(row.isr_retenido || 0) > 0 && !row.tipo_retencion_isr) {
      errors.push('Debe especificar el Tipo de Retención en ISR si hay monto retenido.');
    }

    const estado = errors.length === 0 ? 'Completa' : 'Revisar';
    return {
      estado,
      errores: errors
    };
  };

  // 1. GET /api/dgii/report-606 (Listado del período con filtros y diagnósticos)
  router.get('/', async (req, res) => {
    try {
      await ensureTable();
      const now = new Date();
      const defaultPeriodo = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
      const periodo = req.query.periodo || defaultPeriodo;
      const search = req.query.search ? String(req.query.search).trim().toLowerCase() : '';

      let query = `SELECT * FROM dgii_606_purchases WHERE periodo = ?`;
      const params = [periodo];

      if (search) {
        query += ` AND (LOWER(proveedor) LIKE ? OR LOWER(ncf) LIKE ? OR LOWER(rnc_cedula) LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      query += ` ORDER BY fecha_factura DESC, id DESC`;

      const [records] = await pool.query(query, params);

      let total_facturado = 0;
      let total_itbis = 0;
      let total_itbis_retenido = 0;
      let total_isr_retenido = 0;
      let total_monto_servicios = 0;
      let total_monto_bienes = 0;
      let total_isc = 0;
      let total_otros_impuestos = 0;
      let total_propina_legal = 0;
      let facturas_por_revisar = 0;

      const formattedRecords = records.map(r => {
        const compliance = evaluateInvoiceCompliance(r);
        if (compliance.estado === 'Revisar') facturas_por_revisar++;

        total_facturado += Number(r.total_facturado || 0);
        total_itbis += Number(r.itbis_facturado || 0);
        total_itbis_retenido += Number(r.itbis_retenido || 0);
        total_isr_retenido += Number(r.isr_retenido || 0);
        total_monto_servicios += Number(r.monto_servicios || 0);
        total_monto_bienes += Number(r.monto_bienes || 0);
        total_isc += Number(r.isc || 0);
        total_otros_impuestos += Number(r.otros_impuestos || 0);
        total_propina_legal += Number(r.propina_legal || 0);

        return {
          ...r,
          estado: compliance.estado,
          errores_validacion: compliance.errores
        };
      });

      res.json({
        success: true,
        header: {
          empresa: 'ETEREAS SRL',
          rnc: '131917038',
          periodo,
          cantidad_registros: records.length,
          facturas_por_revisar,
          fecha_impresion: new Date().toLocaleDateString('es-DO')
        },
        records: formattedRecords,
        totals: {
          total_facturado,
          total_itbis,
          total_itbis_retenido,
          total_isr_retenido,
          total_monto_servicios,
          total_monto_bienes,
          total_isc,
          total_otros_impuestos,
          total_propina_legal
        }
      });
    } catch (err) {
      console.error('Error fetching Reporte 606:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. GET /api/dgii/report-606/search-supplier/:rnc (Autocompletar proveedor previo)
  router.get('/search-supplier/:rnc', async (req, res) => {
    try {
      await ensureTable();
      const cleanRnc = String(req.params.rnc || '').replace(/\D/g, '');
      if (!cleanRnc) return res.json({ found: false });

      const [rows] = await pool.query(`
        SELECT proveedor, rnc_cedula, tipo_id, clasificacion_gasto, tipo_compra, forma_pago 
        FROM dgii_606_purchases 
        WHERE rnc_cedula = ? 
        ORDER BY id DESC 
        LIMIT 1
      `, [cleanRnc]);

      if (rows.length > 0) {
        return res.json({ found: true, supplier: rows[0] });
      }
      res.json({ found: false });
    } catch (err) {
      res.json({ found: false, error: err.message });
    }
  });

  // 3. POST /api/dgii/report-606 (Crear factura de compra)
  router.post('/', async (req, res) => {
    try {
      await ensureTable();
      const data = req.body;

      if (!data.rnc_cedula || !data.proveedor) {
        return res.status(400).json({ success: false, error: 'El RNC/Cédula y el nombre del Proveedor son obligatorios.' });
      }

      const cleanRnc = String(data.rnc_cedula).replace(/\D/g, '');
      const tipoId = data.tipo_id ? parseInt(data.tipo_id) : computeTipoId(cleanRnc);
      const cleanNcf = String(data.ncf || '').trim().toUpperCase();

      // Advertencia / Detección de NCF duplicado para el mismo proveedor
      if (cleanNcf && cleanNcf !== 'PENDIENTE') {
        const [dupRows] = await pool.query(
          `SELECT id FROM dgii_606_purchases WHERE rnc_cedula = ? AND ncf = ? LIMIT 1`,
          [cleanRnc, cleanNcf]
        );
        if (dupRows.length > 0 && !data.allow_duplicate) {
          return res.status(409).json({
            success: false,
            duplicate: true,
            error: `El NCF ${cleanNcf} ya fue registrado previamente para el RNC ${cleanRnc}.`
          });
        }
      }

      // Formatear fechas YYYY-MM-DD
      const fechaFactura = data.fecha_factura || new Date().toISOString().slice(0, 10);
      const fechaPago = data.fecha_pago || fechaFactura;

      // Período YYYYMM derivado de fecha_factura
      const periodo = data.periodo || fechaFactura.replace(/-/g, '').slice(0, 6);

      // Desglose de bienes y servicios
      const tipoCompra = data.tipo_compra || 'Bienes';
      const montoSinImpuestos = Number(data.monto_sin_impuestos || data.monto_bienes || data.monto_servicios || 0);
      let montoServicios = Number(data.monto_servicios || 0);
      let montoBienes = Number(data.monto_bienes || 0);

      if (tipoCompra === 'Bienes' && montoBienes === 0) {
        montoBienes = montoSinImpuestos;
      } else if (tipoCompra === 'Servicios' && montoServicios === 0) {
        montoServicios = montoSinImpuestos;
      } else if (tipoCompra === 'Ambos' && montoBienes === 0 && montoServicios === 0) {
        montoBienes = montoSinImpuestos;
      }

      const totalFacturado = montoServicios + montoBienes;
      const itbisFacturado = Number(data.itbis_facturado || 0);
      const itbisRetenido = Number(data.itbis_retenido || 0);
      const isrRetenido = Number(data.isr_retenido || 0);
      const isc = Number(data.isc || 0);
      const otrosImpuestos = Number(data.otros_impuestos || 0);
      const propinaLegal = Number(data.propina_legal || 0);
      const itbisProporcionalidad = Number(data.itbis_proporcionalidad || 0);
      const itbisCosto = Number(data.itbis_costo || 0);
      const itbisAdelantar = Number(data.itbis_adelantar || Math.max(0, itbisFacturado - itbisRetenido - itbisCosto));
      const itbisPercibido = Number(data.itbis_percibido || 0);
      const isrPercibido = Number(data.isr_percibido || 0);

      const recordToEvaluate = {
        rnc_cedula: cleanRnc,
        tipo_id: tipoId,
        ncf: cleanNcf,
        ncf_modificado: data.ncf_modificado,
        total_facturado: totalFacturado,
        fecha_factura: fechaFactura,
        fecha_pago: fechaPago,
        itbis_retenido: itbisRetenido,
        isr_retenido: isrRetenido,
        tipo_retencion_isr: data.tipo_retencion_isr
      };
      const compliance = evaluateInvoiceCompliance(recordToEvaluate);

      const [insertResult] = await pool.query(`
        INSERT INTO dgii_606_purchases (
          periodo, rnc_cedula, tipo_id, tipo_bienes_servicios, proveedor,
          ncf, ncf_modificado, fecha_factura, fecha_pago, tipo_compra,
          clasificacion_gasto, monto_servicios, monto_bienes, total_facturado,
          itbis_facturado, itbis_retenido, itbis_proporcionalidad, itbis_costo,
          itbis_adelantar, itbis_percibido, tipo_retencion_isr, isr_retenido,
          isr_percibido, isc, otros_impuestos, propina_legal, forma_pago, estado,
          errores_validacion, notas
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        periodo, cleanRnc, tipoId, data.tipo_bienes_servicios || '02', data.proveedor.trim(),
        cleanNcf, data.ncf_modificado ? String(data.ncf_modificado).trim().toUpperCase() : '',
        fechaFactura, fechaPago, tipoCompra,
        data.clasificacion_gasto || '02 - Gastos por trabajos, suministros y servicios',
        montoServicios, montoBienes, totalFacturado,
        itbisFacturado, itbisRetenido, itbisProporcionalidad, itbisCosto,
        itbisAdelantar, itbisPercibido, data.tipo_retencion_isr || '', isrRetenido,
        isrPercibido, isc, otrosImpuestos, propinaLegal, data.forma_pago || '02', compliance.estado,
        JSON.stringify(compliance.errores), data.notas || null
      ]);

      res.json({
        success: true,
        message: 'Factura registrada exitosamente en Reporte 606',
        id: insertResult.insertId,
        estado: compliance.estado
      });
    } catch (err) {
      console.error('Error saving 606 purchase:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. PUT /api/dgii/report-606/:id (Actualizar factura de compra)
  router.put('/:id', async (req, res) => {
    try {
      await ensureTable();
      const id = req.params.id;
      const data = req.body;

      const cleanRnc = data.rnc_cedula ? String(data.rnc_cedula).replace(/\D/g, '') : '';
      const tipoId = data.tipo_id ? parseInt(data.tipo_id) : computeTipoId(cleanRnc);
      const cleanNcf = data.ncf ? String(data.ncf).trim().toUpperCase() : '';

      const montoSinImpuestos = Number(data.monto_sin_impuestos || data.monto_bienes || data.monto_servicios || 0);
      let montoServicios = Number(data.monto_servicios || 0);
      let montoBienes = Number(data.monto_bienes || 0);
      const tipoCompra = data.tipo_compra || 'Bienes';

      if (tipoCompra === 'Bienes' && montoBienes === 0) {
        montoBienes = montoSinImpuestos;
      } else if (tipoCompra === 'Servicios' && montoServicios === 0) {
        montoServicios = montoSinImpuestos;
      }

      const totalFacturado = montoServicios + montoBienes;
      const itbisFacturado = Number(data.itbis_facturado || 0);
      const itbisRetenido = Number(data.itbis_retenido || 0);
      const isrRetenido = Number(data.isr_retenido || 0);
      const itbisCosto = Number(data.itbis_costo || 0);
      const itbisAdelantar = Number(data.itbis_adelantar || Math.max(0, itbisFacturado - itbisRetenido - itbisCosto));

      const fechaFactura = data.fecha_factura || new Date().toISOString().slice(0, 10);
      const fechaPago = data.fecha_pago || fechaFactura;

      const compliance = evaluateInvoiceCompliance({
        rnc_cedula: cleanRnc,
        tipo_id: tipoId,
        ncf: cleanNcf,
        ncf_modificado: data.ncf_modificado,
        total_facturado: totalFacturado,
        fecha_factura: fechaFactura,
        fecha_pago: fechaPago,
        itbis_retenido: itbisRetenido,
        isr_retenido: isrRetenido,
        tipo_retencion_isr: data.tipo_retencion_isr
      });

      await pool.query(`
        UPDATE dgii_606_purchases SET
          periodo = COALESCE(?, periodo),
          rnc_cedula = COALESCE(?, rnc_cedula),
          tipo_id = COALESCE(?, tipo_id),
          tipo_bienes_servicios = COALESCE(?, tipo_bienes_servicios),
          proveedor = COALESCE(?, proveedor),
          ncf = COALESCE(?, ncf),
          ncf_modificado = COALESCE(?, ncf_modificado),
          fecha_factura = COALESCE(?, fecha_factura),
          fecha_pago = COALESCE(?, fecha_pago),
          tipo_compra = COALESCE(?, tipo_compra),
          clasificacion_gasto = COALESCE(?, clasificacion_gasto),
          monto_servicios = ?,
          monto_bienes = ?,
          total_facturado = ?,
          itbis_facturado = ?,
          itbis_retenido = ?,
          itbis_proporcionalidad = COALESCE(?, itbis_proporcionalidad),
          itbis_costo = ?,
          itbis_adelantar = ?,
          itbis_percibido = COALESCE(?, itbis_percibido),
          tipo_retencion_isr = COALESCE(?, tipo_retencion_isr),
          isr_retenido = ?,
          isr_percibido = COALESCE(?, isr_percibido),
          isc = COALESCE(?, isc),
          otros_impuestos = COALESCE(?, otros_impuestos),
          propina_legal = COALESCE(?, propina_legal),
          forma_pago = COALESCE(?, forma_pago),
          estado = ?,
          errores_validacion = ?,
          notas = COALESCE(?, notas)
        WHERE id = ?
      `, [
        data.periodo, cleanRnc || null, tipoId, data.tipo_bienes_servicios, data.proveedor,
        cleanNcf || null, data.ncf_modificado, fechaFactura, fechaPago, tipoCompra,
        data.clasificacion_gasto, montoServicios, montoBienes, totalFacturado,
        itbisFacturado, itbisRetenido, data.itbis_proporcionalidad, itbisCosto,
        itbisAdelantar, data.itbis_percibido, data.tipo_retencion_isr, isrRetenido,
        data.isr_percibido, data.isc, data.otros_impuestos, data.propina_legal, data.forma_pago,
        compliance.estado, JSON.stringify(compliance.errores), data.notas, id
      ]);

      res.json({ success: true, message: 'Factura 606 actualizada correctamente', estado: compliance.estado });
    } catch (err) {
      console.error('Error updating 606 purchase:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5. POST /api/dgii/report-606/validate-period (Validación en lote de todo el período)
  router.post('/validate-period', async (req, res) => {
    try {
      await ensureTable();
      const periodo = req.body.periodo;
      const [records] = await pool.query(`SELECT * FROM dgii_606_purchases WHERE periodo = ?`, [periodo]);

      let completas = 0;
      let conErrores = 0;
      const diagnostics = [];

      for (const r of records) {
        const compliance = evaluateInvoiceCompliance(r);
        if (compliance.estado === 'Completa') {
          completas++;
        } else {
          conErrores++;
          diagnostics.push({
            id: r.id,
            proveedor: r.proveedor,
            ncf: r.ncf,
            errores: compliance.errores
          });
        }

        await pool.query(
          `UPDATE dgii_606_purchases SET estado = ?, errores_validacion = ? WHERE id = ?`,
          [compliance.estado, JSON.stringify(compliance.errores), r.id]
        );
      }

      res.json({
        success: true,
        periodo,
        total: records.length,
        completas,
        conErrores,
        diagnostics
      });
    } catch (err) {
      console.error('Error validating period 606:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 6. DELETE /api/dgii/report-606/:id (Eliminar factura)
  router.delete('/:id', async (req, res) => {
    try {
      await ensureTable();
      const id = req.params.id;
      await pool.query(`DELETE FROM dgii_606_purchases WHERE id = ?`, [id]);
      res.json({ success: true, message: 'Factura eliminada de Reporte 606' });
    } catch (err) {
      console.error('Error deleting 606 purchase:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 7. GET /api/dgii/report-606/export-txt (Descargar archivo TXT oficial DGII 606)
  router.get('/export-txt', async (req, res) => {
    try {
      await ensureTable();
      const periodo = req.query.periodo || `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}`;
      const [records] = await pool.query(`
        SELECT * FROM dgii_606_purchases 
        WHERE periodo = ? 
        ORDER BY fecha_factura ASC, id ASC
      `, [periodo]);

      const rncEmpresa = '131917038'; // RNC Oficial de ETEREAS SRL / Plan Beauty RD
      const cantidad = records.length;

      // Encabezado DGII: 606|RNC|YYYYMM|CANTIDAD
      let txtContent = `606|${rncEmpresa}|${periodo}|${cantidad}\r\n`;

      records.forEach(r => {
        const cleanRnc = String(r.rnc_cedula || '').replace(/\D/g, '');
        const tipoId = r.tipo_id || computeTipoId(cleanRnc);
        const tipoBienesServicios = String(r.tipo_bienes_servicios || '02').padStart(2, '0');
        const ncf = String(r.ncf || '').trim().toUpperCase();
        const ncfModificado = String(r.ncf_modificado || '').trim().toUpperCase();

        // Formato fechas YYYYMMDD
        const fComp = String(r.fecha_factura || '').replace(/-/g, '').slice(0, 8);
        const fPago = r.fecha_pago ? String(r.fecha_pago).replace(/-/g, '').slice(0, 8) : '';

        // Formateo numérico a 2 decimales sin comas
        const fmt = (val) => Number(val || 0).toFixed(2);

        const rowFields = [
          cleanRnc,
          tipoId,
          tipoBienesServicios,
          ncf,
          ncfModificado,
          fComp,
          fPago,
          fmt(r.monto_servicios),
          fmt(r.monto_bienes),
          fmt(r.total_facturado),
          fmt(r.itbis_facturado),
          fmt(r.itbis_retenido),
          fmt(r.itbis_proporcionalidad),
          fmt(r.itbis_costo),
          fmt(r.itbis_adelantar),
          fmt(r.itbis_percibido),
          r.tipo_retencion_isr ? String(r.tipo_retencion_isr).padStart(2, '0') : '',
          fmt(r.isr_retenido),
          fmt(r.isr_percibido),
          fmt(r.isc),
          fmt(r.otros_impuestos),
          fmt(r.propina_legal),
          String(r.forma_pago || '02').padStart(2, '0')
        ];

        txtContent += rowFields.join('|') + '\r\n';
      });

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=DGII_F_606_${periodo}.txt`);
      res.send(txtContent);
    } catch (err) {
      console.error('Error generating TXT 606:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = { createDgii606Router };
