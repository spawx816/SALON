const express = require('express');

/**
 * Creates and configures the Express Router for Payroll & Regalías management.
 * @param {import('mysql2/promise').Pool} pool - Database connection pool
 * @returns {express.Router}
 */
function createPayrollRouter(pool) {
  const router = express.Router();

  // 1. Obtener lista de períodos de nómina (con sincronización automática de períodos en preparación)
  router.get('/periods', async (req, res) => {
    try {
      const [initialRows] = await pool.query(`
        SELECT id, status, is_immutable
        FROM payroll_periods
        ORDER BY id DESC
      `);

      // Punto 5: Sincronización automática en tiempo real de períodos no aprobados (En preparación)
      for (const p of initialRows) {
        if (p.status !== 'Aprobada' && p.is_immutable !== 1) {
          try {
            await syncDraftPeriodInPlace(pool, p.id);
          } catch (syncErr) {
            console.warn(`[AUTO-SYNC DRAFT PERIOD ${p.id} WARN]:`, syncErr.message);
          }
        }
      }

      const [rows] = await pool.query(`
        SELECT id, period_name, 
               DATE_FORMAT(start_date, '%Y-%m-%d') as start_date, 
               DATE_FORMAT(end_date, '%Y-%m-%d') as end_date,
               total_empleados, total_neto, total_ingresos, total_descuentos,
               status, sucursal, departamento, is_immutable,
               DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at,
               DATE_FORMAT(approved_at, '%Y-%m-%d %H:%i:%s') as approved_at,
               approved_by
        FROM payroll_periods 
        ORDER BY id DESC
      `);
      res.json(rows);
    } catch (err) {
      console.error('[PAYROLL PERIODS GET ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Helper para obtener o inicializar la configuración de cálculos de nómina
   */
  async function getCalculationSettings(pool) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS payroll_calculation_settings (
          id INT PRIMARY KEY DEFAULT 1,
          salario_mensual_base DECIMAL(12,2) DEFAULT 18421.00,
          dias_laborables_mes DECIMAL(6,2) DEFAULT 23.83,
          horas_jornada_completa DECIMAL(4,2) DEFAULT 8.00,
          horas_media_jornada DECIMAL(4,2) DEFAULT 4.00,
          recargo_horas_extras DECIMAL(5,2) DEFAULT 1.35,
          recargo_feriado DECIMAL(5,2) DEFAULT 1.00,
          tss_base_mode VARCHAR(30) DEFAULT 'solo_fijo',
          aplicar_retencion_isr TINYINT(1) DEFAULT 0,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);

      // Migraciones seguras en caso de tablas existentes
      try {
        await pool.query("ALTER TABLE payroll_calculation_settings ADD COLUMN recargo_feriado DECIMAL(5,2) DEFAULT 1.00");
      } catch (e) { }
      try {
        await pool.query("ALTER TABLE payroll_calculation_settings ADD COLUMN tss_base_mode VARCHAR(30) DEFAULT 'solo_fijo'");
      } catch (e) { }
      try {
        await pool.query("ALTER TABLE payroll_calculation_settings ADD COLUMN aplicar_retencion_isr TINYINT(1) DEFAULT 0");
      } catch (e) { }
      try {
        await pool.query("ALTER TABLE payroll_items ADD COLUMN descanso DECIMAL(12,2) DEFAULT 0.00 AFTER horas_extras");
      } catch (e) { }

      const [rows] = await pool.query('SELECT * FROM payroll_calculation_settings WHERE id = 1');
      if (rows.length === 0) {
        await pool.query(`
          INSERT INTO payroll_calculation_settings 
            (id, salario_mensual_base, dias_laborables_mes, horas_jornada_completa, horas_media_jornada, recargo_horas_extras, recargo_feriado, tss_base_mode, aplicar_retencion_isr)
          VALUES 
            (1, 18421.00, 23.83, 8.00, 4.00, 1.35, 1.00, 'solo_fijo', 0)
        `);
        return {
          salario_mensual_base: 18421.00,
          dias_laborables_mes: 23.83,
          horas_jornada_completa: 8.00,
          horas_media_jornada: 4.00,
          recargo_horas_extras: 1.35,
          recargo_feriado: 1.00,
          tss_base_mode: 'solo_fijo',
          aplicar_retencion_isr: 0
        };
      }
      return {
        salario_mensual_base: parseFloat(rows[0].salario_mensual_base || 18421.00),
        dias_laborables_mes: parseFloat(rows[0].dias_laborables_mes || 23.83),
        horas_jornada_completa: parseFloat(rows[0].horas_jornada_completa || 8.00),
        horas_media_jornada: parseFloat(rows[0].horas_media_jornada || 4.00),
        recargo_horas_extras: parseFloat(rows[0].recargo_horas_extras || 1.35),
        recargo_feriado: parseFloat(rows[0].recargo_feriado || 1.00),
        tss_base_mode: rows[0].tss_base_mode || 'solo_fijo',
        aplicar_retencion_isr: parseInt(rows[0].aplicar_retencion_isr || 0, 10)
      };
    } catch (e) {
      console.warn('[GET CALCULATION SETTINGS WARN]:', e.message);
      return {
        salario_mensual_base: 18421.00,
        dias_laborables_mes: 23.83,
        horas_jornada_completa: 8.00,
        horas_media_jornada: 4.00,
        recargo_horas_extras: 1.35,
        recargo_feriado: 1.00,
        tss_base_mode: 'solo_fijo',
        aplicar_retencion_isr: 0
      };
    }
  }

  /**
   * Helper para cálculo oficial de Retención de ISR para Asalariados (DGII República Dominicana).
   * Escala anualizada para asalariados (Ley 11-92 Código Tributario y Resoluciones DGII):
   * - Hasta RD$ 416,220.00 anuales (RD$ 34,685.00 mensuales o RD$ 17,342.50 quincenales): Exento (0%)
   * - De RD$ 416,220.01 a RD$ 624,329.00: 15% del excedente de RD$ 416,220.00
   * - De RD$ 624,329.01 a RD$ 867,123.00: RD$ 31,216.00 + 20% del excedente de RD$ 624,329.00
   * - Desde RD$ 867,123.01 en adelante: RD$ 79,776.00 + 25% del excedente de RD$ 867,123.00
   * 
   * @param {number} ingresosGravablesQuincenales - Total ingresos brutos sujetos a retención
   * @param {number} retencionTssQuincenal - Aporte a TSS del empleado deducible antes de ISR
   * @returns {number} Retención quincenal de ISR en RD$
   */
  function calculateDgiiIsrQuincenal(ingresosGravablesQuincenales, retencionTssQuincenal) {
    const baseQuincenal = Math.max(0, (ingresosGravablesQuincenales || 0) - (retencionTssQuincenal || 0));
    const baseAnual = baseQuincenal * 24;

    let isrAnual = 0;
    if (baseAnual <= 416220.00) {
      isrAnual = 0;
    } else if (baseAnual <= 624329.00) {
      isrAnual = (baseAnual - 416220.00) * 0.15;
    } else if (baseAnual <= 867123.00) {
      isrAnual = 31216.00 + ((baseAnual - 624329.00) * 0.20);
    } else {
      isrAnual = 79776.00 + ((baseAnual - 867123.00) * 0.25);
    }

    const isrQuincenal = Number((isrAnual / 24).toFixed(2));
    return isrQuincenal;
  }

  // 1.1 Obtener configuración de parámetros salariales y tarifas calculadas
  router.get('/settings/calculation-config', async (req, res) => {
    try {
      const cfg = await getCalculationSettings(pool);
      const salarioMensual = cfg.salario_mensual_base;
      const diasMes = cfg.dias_laborables_mes;
      const horasCompleta = cfg.horas_jornada_completa;
      const horasMedia = cfg.horas_media_jornada;
      const recargoExtras = cfg.recargo_horas_extras;
      const recargoFeriado = cfg.recargo_feriado;

      const salarioDiario = Number((salarioMensual / diasMes).toFixed(2));
      const salarioHora = Number((salarioDiario / horasCompleta).toFixed(2));
      const salarioMinuto = Number((salarioHora / 60).toFixed(4));

      const descuentoAusenciaDiaCompleto = Number((horasCompleta * salarioHora).toFixed(2));
      const descuentoAusenciaMedioDia = Number((horasMedia * salarioHora).toFixed(2));

      const tarifaHoraExtra = Number((salarioHora * recargoExtras).toFixed(2));
      const tarifaMinutoExtra = Number((tarifaHoraExtra / 60).toFixed(4));
      const tarifaHoraFeriado = Number((salarioHora * recargoFeriado).toFixed(2));
      const tarifaMinutoFeriado = Number((tarifaHoraFeriado / 60).toFixed(4));

      res.json({
        ...cfg,
        salario_diario: salarioDiario,
        salario_hora: salarioHora,
        salario_minuto: salarioMinuto,
        descuento_ausencia_dia_completo: descuentoAusenciaDiaCompleto,
        descuento_ausencia_medio_dia: descuentoAusenciaMedioDia,
        tarifa_hora_extra: tarifaHoraExtra,
        tarifa_minuto_extra: tarifaMinutoExtra,
        tarifa_hora_feriado: tarifaHoraFeriado,
        tarifa_minuto_feriado: tarifaMinutoFeriado
      });
    } catch (err) {
      console.error('[GET CALCULATION CONFIG ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 1.2 Guardar o actualizar configuración de parámetros salariales
  router.post('/settings/calculation-config', async (req, res) => {
    try {
      const {
        salario_mensual_base = 18421.00,
        dias_laborables_mes = 23.83,
        horas_jornada_completa = 8.00,
        horas_media_jornada = 4.00,
        recargo_horas_extras = 1.35,
        recargo_feriado = 1.00,
        tss_base_mode = 'solo_fijo',
        aplicar_retencion_isr = 0
      } = req.body;

      const sm = parseFloat(salario_mensual_base) || 18421.00;
      const dm = parseFloat(dias_laborables_mes) || 23.83;
      const hc = parseFloat(horas_jornada_completa) || 8.00;
      const hm = parseFloat(horas_media_jornada) || 4.00;
      const rhe = parseFloat(recargo_horas_extras) || 1.35;
      const rf = parseFloat(recargo_feriado) || 1.00;
      const tbm = String(tss_base_mode || 'solo_fijo');
      const ari = (aplicar_retencion_isr === 1 || aplicar_retencion_isr === true || aplicar_retencion_isr === '1') ? 1 : 0;

      await pool.query(`
        INSERT INTO payroll_calculation_settings 
          (id, salario_mensual_base, dias_laborables_mes, horas_jornada_completa, horas_media_jornada, recargo_horas_extras, recargo_feriado, tss_base_mode, aplicar_retencion_isr)
        VALUES 
          (1, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          salario_mensual_base = VALUES(salario_mensual_base),
          dias_laborables_mes = VALUES(dias_laborables_mes),
          horas_jornada_completa = VALUES(horas_jornada_completa),
          horas_media_jornada = VALUES(horas_media_jornada),
          recargo_horas_extras = VALUES(recargo_horas_extras),
          recargo_feriado = VALUES(recargo_feriado),
          tss_base_mode = VALUES(tss_base_mode),
          aplicar_retencion_isr = VALUES(aplicar_retencion_isr)
      `, [sm, dm, hc, hm, rhe, rf, tbm, ari]);

      const salarioDiario = Number((sm / dm).toFixed(2));
      const salarioHora = Number((salarioDiario / hc).toFixed(2));
      const salarioMinuto = Number((salarioHora / 60).toFixed(4));

      const descuentoAusenciaDiaCompleto = Number((hc * salarioHora).toFixed(2));
      const descuentoAusenciaMedioDia = Number((hm * salarioHora).toFixed(2));

      const tarifaHoraExtra = Number((salarioHora * rhe).toFixed(2));
      const tarifaMinutoExtra = Number((tarifaHoraExtra / 60).toFixed(4));
      const tarifaHoraFeriado = Number((salarioHora * rf).toFixed(2));
      const tarifaMinutoFeriado = Number((tarifaHoraFeriado / 60).toFixed(4));

      res.json({
        success: true,
        message: 'Configuración de tarifas salariales guardada exitosamente',
        config: {
          salario_mensual_base: sm,
          dias_laborables_mes: dm,
          horas_jornada_completa: hc,
          horas_media_jornada: hm,
          recargo_horas_extras: rhe,
          recargo_feriado: rf,
          tss_base_mode: tbm,
          aplicar_retencion_isr: ari,
          salario_diario: salarioDiario,
          salario_hora: salarioHora,
          salario_minuto: salarioMinuto,
          descuento_ausencia_dia_completo: descuentoAusenciaDiaCompleto,
          descuento_ausencia_medio_dia: descuentoAusenciaMedioDia,
          tarifa_hora_extra: tarifaHoraExtra,
          tarifa_minuto_extra: tarifaMinutoExtra,
          tarifa_hora_feriado: tarifaHoraFeriado,
          tarifa_minuto_feriado: tarifaMinutoFeriado
        }
      });
    } catch (err) {
      console.error('[POST CALCULATION CONFIG ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Catálogo de períodos históricos predeterminados
  const historicalPeriodsCatalog = {
    'p_sep_2': { id: 'p_sep_2', period_name: '2da quincena · Septiembre 2026', start_date: '2026-09-16', end_date: '2026-09-30', total_empleados: 42, total_neto: 715875, total_ingresos: 842350, total_descuentos: 126475, approved_at: '2026-09-30 16:32:00', approved_by: 'Elvys Rodriguez', status: 'Aprobada', sucursal: 'Todas', departamento: 'Todos', is_immutable: 1 },
    'p_sep_1': { id: 'p_sep_1', period_name: '1ra quincena · Septiembre 2026', start_date: '2026-09-01', end_date: '2026-09-15', total_empleados: 42, total_neto: 696900, total_ingresos: 818200, total_descuentos: 121300, approved_at: '2026-09-15 17:10:00', approved_by: 'Elvys Rodriguez', status: 'Aprobada', sucursal: 'Todas', departamento: 'Todos', is_immutable: 1 },
    'p_ago_2': { id: 'p_ago_2', period_name: '2da quincena · Agosto 2026', start_date: '2026-08-16', end_date: '2026-08-31', total_empleados: 41, total_neto: 689600, total_ingresos: 810400, total_descuentos: 120800, approved_at: '2026-08-31 16:18:00', approved_by: 'Elvys Rodriguez', status: 'Aprobada', sucursal: 'Todas', departamento: 'Todos', is_immutable: 1 },
    'p_ago_1': { id: 'p_ago_1', period_name: '1ra quincena · Agosto 2026', start_date: '2026-08-01', end_date: '2026-08-15', total_empleados: 41, total_neto: 674100, total_ingresos: 792500, total_descuentos: 118400, approved_at: '2026-08-15 16:05:00', approved_by: 'Elvys Rodriguez', status: 'Aprobada', sucursal: 'Todas', departamento: 'Todos', is_immutable: 1 },
    'p_jul_2': { id: 'p_jul_2', period_name: '2da quincena · Julio 2026', start_date: '2026-07-16', end_date: '2026-07-31', total_empleados: 40, total_neto: 664850, total_ingresos: 780100, total_descuentos: 115250, approved_at: '2026-07-31 15:50:00', approved_by: 'Elvys Rodriguez', status: 'Aprobada', sucursal: 'Todas', departamento: 'Todos', is_immutable: 1 },
    'p_jul_1': { id: 'p_jul_1', period_name: '1ra quincena · Julio 2026', start_date: '2026-07-01', end_date: '2026-07-15', total_empleados: 40, total_neto: 654925, total_ingresos: 771200, total_descuentos: 116275, approved_at: '2026-07-15 16:12:00', approved_by: 'Elvys Rodriguez', status: 'Aprobada', sucursal: 'Todas', departamento: 'Todos', is_immutable: 1 },
    'p_jun_2': { id: 'p_jun_2', period_name: '2da quincena · Junio 2026', start_date: '2026-06-16', end_date: '2026-06-30', total_empleados: 40, total_neto: 651200, total_ingresos: 765000, total_descuentos: 113800, approved_at: '2026-06-30 16:25:00', approved_by: 'Elvys Rodriguez', status: 'Aprobada', sucursal: 'Todas', departamento: 'Todos', is_immutable: 1 },
    'p_jun_1': { id: 'p_jun_1', period_name: '1ra quincena · Junio 2026', start_date: '2026-06-01', end_date: '2026-06-15', total_empleados: 39, total_neto: 642300, total_ingresos: 755200, total_descuentos: 112900, approved_at: '2026-06-15 15:45:00', approved_by: 'Elvys Rodriguez', status: 'Aprobada', sucursal: 'Todas', departamento: 'Todos', is_immutable: 1 },
    'p_may_2': { id: 'p_may_2', period_name: '2da quincena · Mayo 2026', start_date: '2026-05-16', end_date: '2026-05-31', total_empleados: 39, total_neto: 640100, total_ingresos: 752000, total_descuentos: 111900, approved_at: '2026-05-31 16:10:00', approved_by: 'Elvys Rodriguez', status: 'Aprobada', sucursal: 'Todas', departamento: 'Todos', is_immutable: 1 },
    'p_may_1': { id: 'p_may_1', period_name: '1ra quincena · Mayo 2026', start_date: '2026-05-01', end_date: '2026-05-15', total_empleados: 38, total_neto: 632500, total_ingresos: 742100, total_descuentos: 109600, approved_at: '2026-05-15 16:00:00', approved_by: 'Elvys Rodriguez', status: 'Aprobada', sucursal: 'Todas', departamento: 'Todos', is_immutable: 1 },
    'p_abr_2': { id: 'p_abr_2', period_name: '2da quincena · Abril 2026', start_date: '2026-04-16', end_date: '2026-04-30', total_empleados: 38, total_neto: 628900, total_ingresos: 738000, total_descuentos: 109100, approved_at: '2026-04-30 16:40:00', approved_by: 'Elvys Rodriguez', status: 'Aprobada', sucursal: 'Todas', departamento: 'Todos', is_immutable: 1 },
    'p_abr_1': { id: 'p_abr_1', period_name: '1ra quincena · Abril 2026', start_date: '2026-04-01', end_date: '2026-04-15', total_empleados: 37, total_neto: 619450, total_ingresos: 725900, total_descuentos: 106450, approved_at: '2026-04-15 15:55:00', approved_by: 'Elvys Rodriguez', status: 'Aprobada', sucursal: 'Todas', departamento: 'Todos', is_immutable: 1 },
    'p_mar_2': { id: 'p_mar_2', period_name: '2da quincena · Marzo 2026', start_date: '2026-03-16', end_date: '2026-03-31', total_empleados: 37, total_neto: 615000, total_ingresos: 720000, total_descuentos: 105000, approved_at: '2026-03-31 16:15:00', approved_by: 'Elvys Rodriguez', status: 'Aprobada', sucursal: 'Todas', departamento: 'Todos', is_immutable: 1 },
    'p_mar_1': { id: 'p_mar_1', period_name: '1ra quincena · Marzo 2026', start_date: '2026-03-01', end_date: '2026-03-15', total_empleados: 36, total_neto: 605200, total_ingresos: 708000, total_descuentos: 102800, approved_at: '2026-03-15 16:30:00', approved_by: 'Elvys Rodriguez', status: 'Aprobada', sucursal: 'Todas', departamento: 'Todos', is_immutable: 1 },
    'p_feb_2': { id: 'p_feb_2', period_name: '2da quincena · Febrero 2026', start_date: '2026-02-16', end_date: '2026-02-28', total_empleados: 36, total_neto: 598700, total_ingresos: 701200, total_descuentos: 102500, approved_at: '2026-02-28 16:00:00', approved_by: 'Elvys Rodriguez', status: 'Aprobada', sucursal: 'Todas', departamento: 'Todos', is_immutable: 1 },
    'p_feb_1': { id: 'p_feb_1', period_name: '1ra quincena · Febrero 2026', start_date: '2026-02-01', end_date: '2026-02-15', total_empleados: 35, total_neto: 589800, total_ingresos: 690500, total_descuentos: 100700, approved_at: '2026-02-15 15:50:00', approved_by: 'Elvys Rodriguez', status: 'Aprobada', sucursal: 'Todas', departamento: 'Todos', is_immutable: 1 },
    'p_ene_2': { id: 'p_ene_2', period_name: '2da quincena · Enero 2026', start_date: '2026-01-16', end_date: '2026-01-31', total_empleados: 35, total_neto: 582400, total_ingresos: 681400, total_descuentos: 99000, approved_at: '2026-01-31 16:20:00', approved_by: 'Elvys Rodriguez', status: 'Aprobada', sucursal: 'Todas', departamento: 'Todos', is_immutable: 1 },
    'p_ene_1': { id: 'p_ene_1', period_name: '1ra quincena · Enero 2026', start_date: '2026-01-01', end_date: '2026-01-15', total_empleados: 34, total_neto: 574250, total_ingresos: 671800, total_descuentos: 97550, approved_at: '2026-01-15 16:05:00', approved_by: 'Elvys Rodriguez', status: 'Aprobada', sucursal: 'Todas', departamento: 'Todos', is_immutable: 1 }
  };

  function generateSyntheticItems(periodInfo) {
    const seedStaff = [
      { id: '1', nombre: 'Ana Pérez', posicion: 'Estilista', sucursal: 'San Vicente', salario_fijo: 10000, comisiones: 4800, horas_extras: 600, feriados: 400, otros_ingresos: 0, tss: 591, servicios: 400, prestamos: 500, ausencias: 0, tardanzas: 0, otros_descuentos: 0 },
      { id: '2', nombre: 'Carlos Gómez', posicion: 'Barbero', sucursal: 'San Vicente', salario_fijo: 12000, comisiones: 6200, horas_extras: 800, feriados: 500, otros_ingresos: 0, tss: 709.2, servicios: 300, prestamos: 1000, ausencias: 0, tardanzas: 100, otros_descuentos: 0 },
      { id: '3', nombre: 'María López', posicion: 'Manicurista', sucursal: 'Villa Mella', salario_fijo: 9500, comisiones: 4100, horas_extras: 400, feriados: 350, otros_ingresos: 0, tss: 561.45, servicios: 250, prestamos: 0, ausencias: 0, tardanzas: 0, otros_descuentos: 0 },
      { id: '4', nombre: 'Luis Martínez', posicion: 'Recepción', sucursal: 'San Vicente', salario_fijo: 11000, comisiones: 1500, horas_extras: 500, feriados: 450, otros_ingresos: 0, tss: 650.1, servicios: 350, prestamos: 800, ausencias: 0, tardanzas: 0, otros_descuentos: 0 },
      { id: '5', nombre: 'Karla Ruiz', posicion: 'Estilista', sucursal: 'Villa Mella', salario_fijo: 10000, comisiones: 5200, horas_extras: 700, feriados: 400, otros_ingresos: 0, tss: 591, servicios: 500, prestamos: 0, ausencias: 0, tardanzas: 0, otros_descuentos: 0 },
      { id: '6', nombre: 'José Fernández', posicion: 'Soporte', sucursal: 'San Vicente', salario_fijo: 14000, comisiones: 800, horas_extras: 600, feriados: 600, otros_ingresos: 0, tss: 827.4, servicios: 200, prestamos: 1200, ausencias: 0, tardanzas: 0, otros_descuentos: 0 },
      { id: '7', nombre: 'Patricia Santos', posicion: 'Administración', sucursal: 'Villa Mella', salario_fijo: 16000, comisiones: 0, horas_extras: 0, feriados: 700, otros_ingresos: 0, tss: 945.6, servicios: 0, prestamos: 0, ausencias: 0, tardanzas: 0, otros_descuentos: 0 },
      { id: '8', nombre: 'David Peña', posicion: 'Barbero', sucursal: 'Villa Mella', salario_fijo: 11500, comisiones: 5900, horas_extras: 650, feriados: 450, otros_ingresos: 0, tss: 679.65, servicios: 300, prestamos: 600, ausencias: 0, tardanzas: 100, otros_descuentos: 0 },
      { id: '9', nombre: 'Sofía Castro', posicion: 'Estilista', sucursal: 'San Vicente', salario_fijo: 9800, comisiones: 4900, horas_extras: 500, feriados: 400, otros_ingresos: 0, tss: 579.18, servicios: 400, prestamos: 0, ausencias: 0, tardanzas: 0, otros_descuentos: 0 },
      { id: '10', nombre: 'Miguel Rojas', posicion: 'Mantenimiento', sucursal: 'Villa Mella', salario_fijo: 13000, comisiones: 0, horas_extras: 800, feriados: 550, otros_ingresos: 0, tss: 768.3, servicios: 0, prestamos: 500, ausencias: 0, tardanzas: 0, otros_descuentos: 0 }
    ];

    return seedStaff.map((emp, idx) => {
      const totIng = Number((emp.salario_fijo + emp.comisiones + emp.horas_extras + emp.feriados + emp.otros_ingresos).toFixed(2));
      const totDesc = Number((emp.tss + emp.servicios + emp.prestamos + emp.ausencias + emp.tardanzas + emp.otros_descuentos).toFixed(2));
      const neto = Number((totIng - totDesc).toFixed(2));
      return {
        id: `it_${periodInfo.id}_${idx + 1}`,
        payroll_id: periodInfo.id,
        employee_id: emp.id,
        employee_name: emp.nombre,
        posicion: emp.posicion,
        sucursal: emp.sucursal,
        departamento: emp.posicion,
        salario_fijo: emp.salario_fijo,
        comisiones: emp.comisiones,
        feriados: emp.feriados,
        horas_extras: emp.horas_extras,
        otros_ingresos: emp.otros_ingresos,
        total_ingresos: totIng,
        tss: emp.tss,
        servicios: emp.servicios,
        prestamos: emp.prestamos,
        ausencias: emp.ausencias,
        tardanzas: emp.tardanzas,
        otros_descuentos: emp.otros_descuentos,
        total_descuentos: totDesc,
        neto_pagar: neto,
        detalles_json: {
          conceptos_ingresos: [
            { id: 'c1', label: 'Salario fijo', monto: emp.salario_fijo },
            { id: 'c2', label: 'Comisiones', monto: emp.comisiones },
            { id: 'c3', label: 'Feriados', monto: emp.feriados },
            { id: 'c4', label: 'Horas extras', monto: emp.horas_extras },
            { id: 'c5', label: 'Otros ingresos', monto: emp.otros_ingresos }
          ],
          conceptos_descuentos: [
            { id: 'd1', label: 'TSS', monto: emp.tss },
            { id: 'd2', label: 'Servicios', monto: emp.servicios },
            { id: 'd3', label: 'Préstamos', monto: emp.prestamos },
            { id: 'd4', label: 'Ausencias', monto: emp.ausencias },
            { id: 'd5', label: 'Tardanzas', monto: emp.tardanzas },
            { id: 'd6', label: 'Otros desc.', monto: emp.otros_descuentos }
          ]
        }
      };
    });
  }

  /**
   * Sincroniza de forma 100% matemática y libre de duplicados los conceptos de ingresos,
   * conceptos de descuentos y desgloses de un item de nómina con los valores reales de sus columnas.
   */
  function syncDetallesJsonWithItem(item) {
    let det = typeof item.detalles_json === 'string' ? JSON.parse(item.detalles_json || '{}') : (item.detalles_json || {});
    det = det || {};
    det.conceptos_ingresos = Array.isArray(det.conceptos_ingresos) ? det.conceptos_ingresos : [];
    det.conceptos_descuentos = Array.isArray(det.conceptos_descuentos) ? det.conceptos_descuentos : [];
    det.desglose_descuentos = det.desglose_descuentos || {
      tardanzas: { items: [], total_minutos: 0, valor_minuto: 0, total_monto: 0 },
      ausencias: { items: [], total_monto: 0 },
      servicios: { items: [], total_monto: 0 },
      prestamos: { items: [], total_monto: 0 }
    };

    const salFijo = Number(parseFloat(item.salario_fijo || 0).toFixed(2));
    const comm = Number(parseFloat(item.comisiones || 0).toFixed(2));
    const fer = Number(parseFloat(item.feriados || 0).toFixed(2));
    const ext = Number(parseFloat(item.horas_extras || 0).toFixed(2));
    const desc = Number(parseFloat(item.descanso || 0).toFixed(2));
    const otrosIng = Number(parseFloat(item.otros_ingresos || 0).toFixed(2));

    const tss = Number(parseFloat(item.tss || 0).toFixed(2));
    const serv = Number(parseFloat(item.servicios || 0).toFixed(2));
    const prest = Number(parseFloat(item.prestamos || 0).toFixed(2));
    const aus = Number(parseFloat(item.ausencias || 0).toFixed(2));
    const tard = Number(parseFloat(item.tardanzas || 0).toFixed(2));
    const otrosDesc = Number(parseFloat(item.otros_descuentos || 0).toFixed(2));

    // 1. Conceptos de Ingresos
    const seenCustomIds = new Set();
    const customIngresos = [];
    for (const c of det.conceptos_ingresos) {
      if (c && c.custom && c.id && !seenCustomIds.has(c.id)) {
        seenCustomIds.add(c.id);
        customIngresos.push({ ...c, monto: Number(parseFloat(c.monto || 0).toFixed(2)) });
      }
    }
    let sumCustomIng = Number(customIngresos.reduce((s, c) => s + (parseFloat(c.monto) || 0), 0).toFixed(2));
    if (sumCustomIng > otrosIng && customIngresos.length > 0) {
      const match = customIngresos.find(c => Math.abs(parseFloat(c.monto) - otrosIng) < 0.01);
      if (match) {
        customIngresos.length = 0;
        customIngresos.push(match);
        sumCustomIng = match.monto;
      }
    }

    const c5Monto = Number(Math.max(0, otrosIng - sumCustomIng).toFixed(2));
    const c4Prev = det.conceptos_ingresos.find(c => c.id === 'c4');
    const cDescPrev = det.conceptos_ingresos.find(c => c.id === 'c_descanso');

    det.conceptos_ingresos = [
      { id: 'c1', label: 'Salario fijo', monto: salFijo },
      { id: 'c2', label: 'Comisiones', monto: comm },
      { id: 'c3', label: 'Feriados', monto: fer },
      { id: 'c4', label: ext > 0 ? (c4Prev?.label && c4Prev.label.includes('(') ? c4Prev.label : 'Horas extras') : 'Horas extras', monto: ext },
      { id: 'c_descanso', label: desc > 0 ? (cDescPrev?.label && cDescPrev.label.includes('(') ? cDescPrev.label : 'Descanso laborado') : 'Descanso', monto: desc },
      ...(c5Monto > 0 || customIngresos.length === 0 ? [{ id: 'c5', label: 'Otros ingresos / Bonos', monto: c5Monto }] : []),
      ...customIngresos
    ];

    // 2. Conceptos de Descuentos
    const seenCustomDescIds = new Set();
    const customDescuentos = [];
    for (const d of det.conceptos_descuentos) {
      if (d && d.custom && d.id && !seenCustomDescIds.has(d.id)) {
        seenCustomDescIds.add(d.id);
        customDescuentos.push({ ...d, monto: Number(parseFloat(d.monto || 0).toFixed(2)) });
      }
    }
    const sumCustomDesc = Number(customDescuentos.reduce((s, d) => s + (parseFloat(d.monto) || 0), 0).toFixed(2));
    const d6Monto = Number(Math.max(0, otrosDesc - sumCustomDesc).toFixed(2));

    const d1Prev = det.conceptos_descuentos.find(d => d.id === 'd1');
    const d5Prev = det.conceptos_descuentos.find(d => d.id === 'd5');
    const dIsr = det.conceptos_descuentos.find(d => d.id === 'd_isr');

    det.conceptos_descuentos = [
      { id: 'd1', label: d1Prev?.label || 'TSS (Ley 5.91%)', monto: tss },
      ...(dIsr ? [dIsr] : []),
      { id: 'd2', label: 'Servicios de Salón', monto: serv },
      { id: 'd3', label: 'Préstamos / Adelantos', monto: prest },
      { id: 'd4', label: 'Ausencias', monto: aus },
      { id: 'd5', label: tard > 0 ? (d5Prev?.label && d5Prev.label.includes('(') ? d5Prev.label : 'Tardanzas') : 'Tardanzas', monto: tard },
      ...(d6Monto > 0 || customDescuentos.length === 0 ? [{ id: 'd6', label: 'Otros descuentos', monto: d6Monto }] : []),
      ...customDescuentos
    ];

    // 3. Limpiar o ajustar desgloses si se eliminaron a 0
    if (aus === 0 && det.desglose_descuentos?.ausencias) {
      det.desglose_descuentos.ausencias.items = [];
      det.desglose_descuentos.ausencias.total_monto = 0;
    }
    if (tard === 0 && det.desglose_descuentos?.tardanzas) {
      det.desglose_descuentos.tardanzas.items = [];
      det.desglose_descuentos.tardanzas.total_monto = 0;
      det.desglose_descuentos.tardanzas.total_minutos = 0;
    }
    if (serv === 0 && det.desglose_descuentos?.servicios) {
      det.desglose_descuentos.servicios.items = [];
      det.desglose_descuentos.servicios.total_monto = 0;
    }
    if (prest === 0 && det.desglose_descuentos?.prestamos) {
      det.desglose_descuentos.prestamos.items = [];
      det.desglose_descuentos.prestamos.total_monto = 0;
    }

    item.detalles_json = det;
    return item;
  }

  /**
   * Punto 5: Sincroniza automáticamente en tiempo real un período de nómina en preparación
   * sin alterar jamás períodos aprobados/cerrados (is_immutable = 1 o status = 'Aprobada').
   * Conserva los IDs de payroll_items y cualquier concepto manual (custom: true).
   */
  async function syncDraftPeriodInPlace(pool, periodId) {
    const [periodRows] = await pool.query(`
      SELECT id, period_name,
             DATE_FORMAT(start_date, '%Y-%m-%d') as start_date,
             DATE_FORMAT(end_date, '%Y-%m-%d') as end_date,
             status, sucursal, departamento, is_immutable
      FROM payroll_periods WHERE id = ?
    `, [periodId]);
    if (periodRows.length === 0) return null;

    const period = periodRows[0];
    if (period.status === 'Aprobada' || period.is_immutable === 1) {
      return period;
    }

    const startDate = period.start_date ? String(period.start_date).split('T')[0] : '';
    const endDate = period.end_date ? String(period.end_date).split('T')[0] : '';
    if (!startDate || !endDate) return period;

    let staffQuery = "SELECT * FROM staff_records WHERE (status = 'Activo' OR status = 'Active' OR status IS NULL)";
    const staffParams = [];
    if (period.sucursal && period.sucursal !== 'Todas') {
      const sucLower = String(period.sucursal).toLowerCase();
      if (sucLower.includes('disponible')) {
        staffQuery += " AND (salon_id = 6 OR localidad LIKE '%disponible%')";
      } else if (sucLower.includes('villa mella') || sucLower.includes('mella')) {
        staffQuery += " AND (salon_id IN (2, 4) OR localidad LIKE '%mella%')";
      } else if (sucLower.includes('san vicente') || sucLower.includes('vicente')) {
        staffQuery += " AND (salon_id = 1 OR localidad LIKE '%vicente%')";
      } else {
        staffQuery += " AND (salon_id = ? OR localidad LIKE ?)";
        staffParams.push(period.sucursal, `%${period.sucursal}%`);
      }
    }
    if (period.departamento && period.departamento !== 'Todos') {
      staffQuery += " AND (posicion LIKE ?)";
      staffParams.push(`%${period.departamento}%`);
    }
    let [staffList] = await pool.query(staffQuery, staffParams);

    const [existingItems] = await pool.query('SELECT * FROM payroll_items WHERE payroll_id = ? ORDER BY id ASC', [periodId]);
    const existingByEmpId = new Map();
    for (const ex of existingItems) {
      existingByEmpId.set(String(ex.employee_id), ex);
      existingByEmpId.set(String(ex.employee_id).replace(/^EMP-/, ''), ex);
      if (ex.employee_name) existingByEmpId.set(ex.employee_name.toLowerCase().trim(), ex);
    }

    // Identificar qué colaboradores tienen ediciones manuales registradas en este período
    const [manualAuditRows] = await pool.query(
      "SELECT DISTINCT employee_id, field_name FROM payroll_audit_logs WHERE payroll_id = ? AND action_type = 'Edición Manual'",
      [periodId]
    );
    const manualFieldsByEmp = new Map();
    for (const r of manualAuditRows) {
      const empKey = String(r.employee_id).replace(/^EMP-/, '');
      if (!manualFieldsByEmp.has(empKey)) manualFieldsByEmp.set(empKey, new Set());
      manualFieldsByEmp.get(empKey).add(r.field_name);
    }

    if (staffList.length === 0 && existingItems.length > 0) {
      staffList = existingItems.map(it => ({
        id: it.employee_id,
        nombre: it.employee_name,
        posicion: it.posicion,
        localidad: it.sucursal,
        salario_base: it.salario_fijo ? parseFloat(it.salario_fijo) * 2 : 20000
      }));
    }

    const batchContext = await preloadPayrollBatchContext(pool, startDate, endDate);
    let sumTotalIngresos = 0;
    let sumTotalDescuentos = 0;
    let sumTotalNeto = 0;
    let totalCount = 0;

    for (const emp of staffList) {
      const itemData = await calculateEmployeePayrollValues(pool, emp, startDate, endDate, batchContext);
      const ex = existingByEmpId.get(String(emp.id))
        || existingByEmpId.get(String(emp.id).replace(/^EMP-/, ''))
        || (emp.nombre ? existingByEmpId.get(emp.nombre.toLowerCase().trim()) : null);

      if (ex) {
        let exDet = {};
        if (ex.detalles_json) {
          try {
            exDet = typeof ex.detalles_json === 'string' ? JSON.parse(ex.detalles_json || '{}') : (ex.detalles_json || {});
          } catch (e) { exDet = {}; }
        }

        const empKey = String(emp.id).replace(/^EMP-/, '');
        const empAuditSet = manualFieldsByEmp.get(empKey) || manualFieldsByEmp.get(String(emp.id)) || null;
        const isManuallyAdjusted = Boolean(
          exDet.manually_adjusted ||
          exDet.manual_override ||
          (exDet.manual_fields && exDet.manual_fields.length > 0) ||
          (empAuditSet && empAuditSet.size > 0)
        );

        // Si el volante de este empleado fue ajustado manualmente por el usuario, PRESERVAR sus valores guardados
        if (isManuallyAdjusted) {
          const fieldsToCheck = [
            'salario_fijo', 'comisiones', 'feriados', 'horas_extras', 'descanso', 'otros_ingresos',
            'tss', 'servicios', 'prestamos', 'ausencias', 'tardanzas', 'otros_descuentos'
          ];

          for (const f of fieldsToCheck) {
            const isFieldOverridden = (empAuditSet && empAuditSet.has(f)) ||
              (exDet.manual_fields && exDet.manual_fields.includes(f));

            if (isFieldOverridden && ex[f] !== undefined && ex[f] !== null) {
              itemData[f] = parseFloat(ex[f]) || 0;
            }
          }

          // Preservar conceptos manuales personalizados si los tenía
          if (exDet.conceptos_ingresos) {
            const customIng = (exDet.conceptos_ingresos || []).filter(c => c && c.custom);
            if (customIng.length > 0) {
              itemData.detalles_json.conceptos_ingresos = itemData.detalles_json.conceptos_ingresos || [];
              for (const ci of customIng) {
                if (!itemData.detalles_json.conceptos_ingresos.some(x => x.id === ci.id)) {
                  itemData.detalles_json.conceptos_ingresos.push(ci);
                }
              }
            }
          }
          if (exDet.conceptos_descuentos) {
            const customDesc = (exDet.conceptos_descuentos || []).filter(c => c && c.custom);
            if (customDesc.length > 0) {
              itemData.detalles_json.conceptos_descuentos = itemData.detalles_json.conceptos_descuentos || [];
              for (const cd of customDesc) {
                if (!itemData.detalles_json.conceptos_descuentos.some(x => x.id === cd.id)) {
                  itemData.detalles_json.conceptos_descuentos.push(cd);
                }
              }
            }
          }

          itemData.detalles_json.manually_adjusted = true;
          itemData.detalles_json.manual_fields = Array.from(new Set([
            ...(exDet.manual_fields || []),
            ...(empAuditSet ? Array.from(empAuditSet) : [])
          ]));

          itemData.total_ingresos = Number((
            parseFloat(itemData.salario_fijo || 0) +
            parseFloat(itemData.comisiones || 0) +
            parseFloat(itemData.feriados || 0) +
            parseFloat(itemData.horas_extras || 0) +
            parseFloat(itemData.descanso || 0) +
            parseFloat(itemData.otros_ingresos || 0)
          ).toFixed(2));

          itemData.total_descuentos = Number((
            parseFloat(itemData.tss || 0) +
            parseFloat(itemData.servicios || 0) +
            parseFloat(itemData.prestamos || 0) +
            parseFloat(itemData.ausencias || 0) +
            parseFloat(itemData.tardanzas || 0) +
            parseFloat(itemData.otros_descuentos || 0)
          ).toFixed(2));

          itemData.neto_pagar = Number(Math.max(0, itemData.total_ingresos - itemData.total_descuentos).toFixed(2));
          syncDetallesJsonWithItem(itemData);
        } else if (ex.detalles_json) {
          // Preservar conceptos manuales personalizados (custom: true) si fueron agregados en el borrador
          try {
            const customIng = (exDet.conceptos_ingresos || []).filter(c => c && c.custom);
            const customDesc = (exDet.conceptos_descuentos || []).filter(c => c && c.custom);
            if (customIng.length > 0) {
              itemData.detalles_json.conceptos_ingresos = itemData.detalles_json.conceptos_ingresos || [];
              for (const ci of customIng) {
                if (!itemData.detalles_json.conceptos_ingresos.some(x => x.id === ci.id)) {
                  itemData.detalles_json.conceptos_ingresos.push(ci);
                }
              }
              const extraIng = customIng.reduce((s, c) => s + (parseFloat(c.monto) || 0), 0);
              itemData.otros_ingresos = Number((parseFloat(itemData.otros_ingresos || 0) + extraIng).toFixed(2));
            }
            if (customDesc.length > 0) {
              itemData.detalles_json.conceptos_descuentos = itemData.detalles_json.conceptos_descuentos || [];
              for (const cd of customDesc) {
                if (!itemData.detalles_json.conceptos_descuentos.some(x => x.id === cd.id)) {
                  itemData.detalles_json.conceptos_descuentos.push(cd);
                }
              }
              const extraDesc = customDesc.reduce((s, c) => s + (parseFloat(c.monto) || 0), 0);
              itemData.otros_descuentos = Number((parseFloat(itemData.otros_descuentos || 0) + extraDesc).toFixed(2));
            }
            if (customIng.length > 0 || customDesc.length > 0) {
              itemData.total_ingresos = Number((
                itemData.salario_fijo + itemData.comisiones + itemData.feriados +
                itemData.horas_extras + (itemData.descanso || 0) + itemData.otros_ingresos
              ).toFixed(2));
              itemData.total_descuentos = Number((
                itemData.tss + itemData.servicios + itemData.prestamos +
                itemData.ausencias + itemData.tardanzas + itemData.otros_descuentos
              ).toFixed(2));
              itemData.neto_pagar = Number(Math.max(0, itemData.total_ingresos - itemData.total_descuentos).toFixed(2));
            }
            syncDetallesJsonWithItem(itemData);
          } catch (e) { }
        } else {
          syncDetallesJsonWithItem(itemData);
        }
      }

      if (ex) {
        await pool.query(`
          UPDATE payroll_items
          SET employee_name = ?, posicion = ?, sucursal = ?, departamento = ?,
              salario_fijo = ?, comisiones = ?, feriados = ?, horas_extras = ?, descanso = ?, otros_ingresos = ?, total_ingresos = ?,
              tss = ?, servicios = ?, prestamos = ?, ausencias = ?, tardanzas = ?, otros_descuentos = ?, total_descuentos = ?,
              neto_pagar = ?, detalles_json = ?
          WHERE id = ?
        `, [
          itemData.employee_name, itemData.posicion, itemData.sucursal, itemData.departamento,
          itemData.salario_fijo, itemData.comisiones, itemData.feriados, itemData.horas_extras, (itemData.descanso || 0), itemData.otros_ingresos, itemData.total_ingresos,
          itemData.tss, itemData.servicios, itemData.prestamos, itemData.ausencias, itemData.tardanzas, itemData.otros_descuentos, itemData.total_descuentos,
          itemData.neto_pagar, JSON.stringify(itemData.detalles_json),
          ex.id
        ]);
      } else {
        await pool.query(`
          INSERT INTO payroll_items (
            payroll_id, employee_id, employee_name, posicion, sucursal, departamento,
            salario_fijo, comisiones, feriados, horas_extras, descanso, otros_ingresos, total_ingresos,
            tss, servicios, prestamos, ausencias, tardanzas, otros_descuentos, total_descuentos,
            neto_pagar, detalles_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          periodId, itemData.employee_id, itemData.employee_name, itemData.posicion, itemData.sucursal, itemData.departamento,
          itemData.salario_fijo, itemData.comisiones, itemData.feriados, itemData.horas_extras, (itemData.descanso || 0), itemData.otros_ingresos, itemData.total_ingresos,
          itemData.tss, itemData.servicios, itemData.prestamos, itemData.ausencias, itemData.tardanzas, itemData.otros_descuentos, itemData.total_descuentos,
          itemData.neto_pagar, JSON.stringify(itemData.detalles_json)
        ]);
      }

      sumTotalIngresos += itemData.total_ingresos;
      sumTotalDescuentos += itemData.total_descuentos;
      sumTotalNeto += itemData.neto_pagar;
      totalCount++;
    }

    await pool.query(`
      UPDATE payroll_periods
      SET total_ingresos = ?, total_descuentos = ?, total_neto = ?, total_empleados = ?
      WHERE id = ? AND status != 'Aprobada' AND (is_immutable = 0 OR is_immutable IS NULL)
    `, [
      Number(sumTotalIngresos.toFixed(2)),
      Number(sumTotalDescuentos.toFixed(2)),
      Number(sumTotalNeto.toFixed(2)),
      totalCount,
      periodId
    ]);

    return {
      ...period,
      total_ingresos: Number(sumTotalIngresos.toFixed(2)),
      total_descuentos: Number(sumTotalDescuentos.toFixed(2)),
      total_neto: Number(sumTotalNeto.toFixed(2)),
      total_empleados: totalCount
    };
  }

  /**
   * Garantiza que incluso un item de nómina aprobado previamente cuente con `desglose_descuentos`
   * en memoria para el volante del empleado, cuadrando el total con el monto congelado del volante.
   */
  async function ensureItemDiscountBreakdown(pool, item, startDate, endDate) {
    const det = typeof item.detalles_json === 'string' ? JSON.parse(item.detalles_json || '{}') : (item.detalles_json || {});
    if (det && det.desglose_descuentos) {
      return { ...item, detalles_json: det };
    }
    try {
      const [staffRows] = await pool.query(
        "SELECT * FROM staff_records WHERE id = ? OR id = ? OR nombre = ? LIMIT 1",
        [item.employee_id, String(item.employee_id).replace(/^EMP-/, ''), item.employee_name || item.employee_id]
      );
      if (staffRows.length > 0) {
        const cfg = await getCalculationSettings(pool);
        const computed = await calculateEmployeePayrollValues(pool, staffRows[0], startDate, endDate, cfg);
        const breakdown = computed.detalles_json?.desglose_descuentos || {
          tardanzas: { items: [], total_minutos: 0, valor_minuto: 0, total_monto: 0 },
          ausencias: { items: [], total_monto: 0 },
          servicios: { items: [], total_monto: 0 },
          prestamos: { items: [], total_monto: 0 }
        };
        // Ajustar el total de cada desglose para coincidir exactamente con el importe congelado del volante
        const reconcileList = (section, targetAmt, amountField = 'monto') => {
          const target = Number(parseFloat(targetAmt || 0).toFixed(2));
          section.total_monto = target;
          if (section.items && section.items.length > 0) {
            const sum = Number(section.items.reduce((s, r) => s + (parseFloat(r[amountField]) || 0), 0).toFixed(2));
            const diff = Number((target - sum).toFixed(2));
            if (Math.abs(diff) > 0 && Math.abs(diff) <= 1.00) {
              const lastIdx = section.items.length - 1;
              section.items[lastIdx][amountField] = Number((parseFloat(section.items[lastIdx][amountField] || 0) + diff).toFixed(2));
            }
          }
        };
        reconcileList(breakdown.tardanzas, item.tardanzas, 'monto');
        reconcileList(breakdown.ausencias, item.ausencias, 'monto');
        reconcileList(breakdown.servicios, item.servicios, 'monto');
        reconcileList(breakdown.prestamos, item.prestamos, 'cuota_descontada');
        det.desglose_descuentos = breakdown;
      }
    } catch (e) {
      console.warn('[ENSURE DISCOUNT BREAKDOWN WARN]:', e.message);
    }
    return { ...item, detalles_json: det };
  }

  // 1.1 Obtener volante de pago individual para un empleado en un período específico (o en tiempo real para la tableta)
  router.get('/employee-slip', async (req, res) => {
    try {
      const { employee_id, start_date, end_date, period_id } = req.query;
      if (!employee_id) {
        return res.status(400).json({ error: 'employee_id es requerido' });
      }

      // Si se pasa un period_id numérico específico
      if (period_id && period_id !== 'live_draft') {
        const [periods] = await pool.query(
          "SELECT id, period_name, DATE_FORMAT(start_date, '%Y-%m-%d') as start_date, DATE_FORMAT(end_date, '%Y-%m-%d') as end_date, status, sucursal, is_immutable FROM payroll_periods WHERE id = ?",
          [period_id]
        );
        if (periods.length > 0) {
          let p = periods[0];
          // Punto 5: Si el período NO está aprobado, sincronizar automáticamente en tiempo real
          if (p.status !== 'Aprobada' && p.is_immutable !== 1) {
            p = (await syncDraftPeriodInPlace(pool, p.id)) || p;
          }
          const [items] = await pool.query(
            "SELECT * FROM payroll_items WHERE payroll_id = ? AND (employee_id = ? OR employee_id = ? OR employee_name = ?) LIMIT 1",
            [period_id, employee_id, `EMP-${employee_id}`, employee_id]
          );
          if (items.length > 0) {
            const enrichedItem = await ensureItemDiscountBreakdown(pool, items[0], p.start_date, p.end_date);
            return res.json({
              success: true,
              period: p,
              item: enrichedItem
            });
          }
        }
      }

      // Si se pasan fechas de inicio y fin (o buscar quincena)
      const startDate = start_date || new Date().toISOString().slice(0, 7) + '-01';
      const endDate = end_date || new Date().toISOString().slice(0, 10);

      // Buscar si existe un período en DB para estas fechas exactas
      const [existingPeriods] = await pool.query(
        "SELECT id, period_name, DATE_FORMAT(start_date, '%Y-%m-%d') as start_date, DATE_FORMAT(end_date, '%Y-%m-%d') as end_date, status, sucursal, is_immutable FROM payroll_periods WHERE start_date = ? AND end_date = ? ORDER BY id DESC LIMIT 1",
        [startDate, endDate]
      );

      if (existingPeriods.length > 0) {
        let p = existingPeriods[0];
        // Punto 5: Si el período está en preparación, sincronizar automáticamente en tiempo real
        if (p.status !== 'Aprobada' && p.is_immutable !== 1) {
          p = (await syncDraftPeriodInPlace(pool, p.id)) || p;
        }
        const [items] = await pool.query(
          "SELECT * FROM payroll_items WHERE payroll_id = ? AND (employee_id = ? OR employee_id = ? OR employee_name = ?) LIMIT 1",
          [p.id, employee_id, `EMP-${employee_id}`, employee_id]
        );
        if (items.length > 0) {
          const enrichedItem = await ensureItemDiscountBreakdown(pool, items[0], p.start_date, p.end_date);
          return res.json({
            success: true,
            period: p,
            item: enrichedItem
          });
        }
      }

      // Si no existe guardado en DB para este colaborador en este rango:
      // Calcular en tiempo real con datos verídicos (asistencia, comisiones, descansos, etc.)
      const [staffRows] = await pool.query(
        "SELECT * FROM staff_records WHERE id = ? OR id = ? OR nombre = ? LIMIT 1",
        [employee_id, String(employee_id).replace(/^EMP-/, ''), employee_id]
      );

      if (staffRows.length === 0) {
        return res.status(404).json({ error: 'Colaborador no encontrado' });
      }

      const emp = staffRows[0];
      const cfg = await getCalculationSettings(pool);
      const computed = await calculateEmployeePayrollValues(pool, emp, startDate, endDate, cfg);

      return res.json({
        success: true,
        period: {
          id: 'live_draft',
          period_name: `Corte ${startDate} al ${endDate}`,
          start_date: startDate,
          end_date: endDate,
          status: 'En curso (Borrador en vivo)'
        },
        item: computed
      });
    } catch (err) {
      console.error('[EMPLOYEE SLIP GET ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 2. Obtener detalle de un período con todos los empleados e items
  router.get('/periods/:id', async (req, res) => {
    try {
      const { id } = req.params;
      let periods = [];
      try {
        [periods] = await pool.query(`
          SELECT id, period_name, 
                 DATE_FORMAT(start_date, '%Y-%m-%d') as start_date, 
                 DATE_FORMAT(end_date, '%Y-%m-%d') as end_date,
                 total_empleados, total_neto, total_ingresos, total_descuentos,
                 status, sucursal, departamento, is_immutable,
                 DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at,
                 DATE_FORMAT(approved_at, '%Y-%m-%d %H:%i:%s') as approved_at,
                 approved_by
          FROM payroll_periods WHERE id = ?
        `, [id]);
      } catch (dbErr) {
        // Ignorar si el ID no es numérico para la consulta SQL
      }

      if (periods && periods.length > 0) {
        let periodRow = periods[0];
        // Punto 5: Si el período NO está aprobado ni cerrado, sincronizar automáticamente en tiempo real
        if (periodRow.status !== 'Aprobada' && periodRow.is_immutable !== 1) {
          try {
            const updatedPeriod = await syncDraftPeriodInPlace(pool, periodRow.id);
            if (updatedPeriod) periodRow = { ...periodRow, ...updatedPeriod };
          } catch (syncErr) {
            console.warn(`[AUTO-SYNC PERIOD DETAIL ${id} WARN]:`, syncErr.message);
          }
        }

        const [items] = await pool.query(`
          SELECT * FROM payroll_items 
          WHERE payroll_id = ? 
          ORDER BY id ASC
        `, [id]);

        return res.json({
          period: periodRow,
          items: items.map(item => ({
            ...item,
            detalles_json: typeof item.detalles_json === 'string' ? JSON.parse(item.detalles_json || '{}') : (item.detalles_json || {})
          }))
        });
      }

      // Si no existe en la base de datos (por ejemplo, períodos históricos precargados como p_sep_1, p_sep_2, etc.)
      if (historicalPeriodsCatalog[id]) {
        const periodInfo = historicalPeriodsCatalog[id];
        const items = generateSyntheticItems(periodInfo);
        return res.json({
          period: periodInfo,
          items: items
        });
      }

      // Fallback para cualquier ID con prefijo p_
      if (String(id).startsWith('p_')) {
        const fallbackInfo = {
          id: String(id),
          period_name: `Nómina histórica · ${id}`,
          start_date: '2026-01-01',
          end_date: '2026-01-15',
          total_empleados: 40,
          total_neto: 650000,
          total_ingresos: 765000,
          total_descuentos: 115000,
          status: 'Aprobada',
          sucursal: 'Todas',
          departamento: 'Todos',
          approved_at: '2026-09-30 16:32:00',
          approved_by: 'Elvys Rodriguez',
          is_immutable: 1
        };
        return res.json({
          period: fallbackInfo,
          items: generateSyntheticItems(fallbackInfo)
        });
      }

      res.status(404).json({ error: 'Período de nómina no encontrado' });
    } catch (err) {
      console.error('[PAYROLL PERIOD DETAIL ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Pre-carga y pre-indexa en memoria todo el contexto necesario para procesar
   * un lote completo de empleados sin hacer consultas SQL individuales en bucle.
   */
  async function preloadPayrollBatchContext(conn, startDate, endDate) {
    const [
      cfg,
      [periodHolidays],
      [commRows],
      [discountRows],
      [futureLoanRows],
      [overrides],
      [attPunches],
      [rawCommLogs],
      [specialRulesRows]
    ] = await Promise.all([
      getCalculationSettings(conn),
      conn.query(`
        SELECT DATE_FORMAT(date, '%Y-%m-%d') as holiday_date, name, rate_multiplier 
        FROM holidays 
        WHERE date BETWEEN ? AND ? AND is_active = 1
      `, [startDate, endDate]),
      conn.query(`
        SELECT employee_id, employee_name, COALESCE(SUM(monto_comision), 0) as total_comm 
        FROM employee_commissions_log 
        WHERE created_at >= ? AND created_at <= ?
          AND (status != 'Anulada' OR status IS NULL)
        GROUP BY employee_id, employee_name
      `, [`${startDate} 00:00:00`, `${endDate} 23:59:59`]),
      conn.query(`
        SELECT id, employee_id, employee_name, type, amount, notes, status, DATE_FORMAT(date, '%Y-%m-%d') as d_date
        FROM employee_discounts
        WHERE date BETWEEN ? AND ?
          AND (status != 'Anulado' OR status IS NULL)
      `, [startDate, endDate]),
      conn.query(`
        SELECT employee_id, employee_name, COALESCE(SUM(amount), 0) as future_pending
        FROM employee_discounts
        WHERE date > ?
          AND status = 'Pendiente'
          AND (LOWER(type) LIKE '%prestamo%' OR LOWER(type) LIKE '%préstamo%' OR LOWER(type) LIKE '%adelanto%' OR LOWER(type) LIKE '%anticipo%')
        GROUP BY employee_id, employee_name
      `, [endDate]),
      conn.query(`
        SELECT employee_id, DATE_FORMAT(date, '%Y-%m-%d') as dateStr, new_hora_entrada, new_hora_salida, reason 
        FROM schedule_overrides 
        WHERE date BETWEEN ? AND ? AND status = 'Activo'
      `, [startDate, endDate]),
      conn.query(`
        SELECT id, employee_id, type, status, lateness_minutes, extra_minutes, timestamp, 
               DATE_FORMAT(CONVERT_TZ(timestamp, '+00:00', '-04:00'), '%Y-%m-%d') as p_date
        FROM attendance
        WHERE (DATE(timestamp) BETWEEN ? AND ? OR DATE(CONVERT_TZ(timestamp, '+00:00', '-04:00')) BETWEEN ? AND ?)
        ORDER BY timestamp ASC
      `, [startDate, endDate, startDate, endDate]),
      conn.query(`
        SELECT employee_id, employee_name, service_name
        FROM employee_commissions_log
        WHERE created_at >= ? AND created_at <= ?
          AND (status != 'Anulada' OR status IS NULL)
      `, [`${startDate} 00:00:00`, `${endDate} 23:59:59`]),
      conn.query(`
        SELECT id, scheme_id, cantidad_meta, bono_monto, service_name
        FROM commission_scheme_rules
        WHERE rule_type = 'especial' AND operacion = 'Contar'
      `)
    ]);

    const schemeRulesMap = new Map();
    for (const r of (specialRulesRows || [])) {
      const k = String(r.scheme_id);
      if (!schemeRulesMap.has(k)) schemeRulesMap.set(k, []);
      schemeRulesMap.get(k).push(r);
    }

    const commMap = new Map();
    for (const c of commRows) {
      const val = parseFloat(c.total_comm || 0);
      if (c.employee_id) {
        commMap.set(String(c.employee_id), (commMap.get(String(c.employee_id)) || 0) + val);
        commMap.set(`EMP-${c.employee_id}`, (commMap.get(`EMP-${c.employee_id}`) || 0) + val);
      }
      if (c.employee_name) {
        const n = c.employee_name.toLowerCase().trim();
        commMap.set(n, (commMap.get(n) || 0) + val);
      }
    }

    const discMap = new Map();
    for (const d of discountRows) {
      const keys = [];
      if (d.employee_id) {
        keys.push(String(d.employee_id));
        keys.push(`EMP-${d.employee_id}`);
      }
      if (d.employee_name) {
        keys.push(d.employee_name.toLowerCase().trim());
      }
      for (const k of keys) {
        if (!discMap.has(k)) discMap.set(k, []);
        discMap.get(k).push(d);
      }
    }

    const futureLoansMap = new Map();
    for (const fl of (futureLoanRows || [])) {
      const val = parseFloat(fl.future_pending || 0);
      if (fl.employee_id) {
        futureLoansMap.set(String(fl.employee_id), (futureLoansMap.get(String(fl.employee_id)) || 0) + val);
        futureLoansMap.set(`EMP-${fl.employee_id}`, (futureLoansMap.get(`EMP-${fl.employee_id}`) || 0) + val);
      }
      if (fl.employee_name) {
        const n = fl.employee_name.toLowerCase().trim();
        futureLoansMap.set(n, (futureLoansMap.get(n) || 0) + val);
      }
    }

    const overrideMap = new Map();
    for (const o of overrides) {
      const keys = [String(o.employee_id)];
      const rawNum = String(o.employee_id).replace(/\D/g, '');
      if (rawNum) {
        keys.push(rawNum);
        keys.push(`EMP-${rawNum}`);
      }
      for (const k of keys) {
        if (!overrideMap.has(k)) overrideMap.set(k, []);
        overrideMap.get(k).push(o);
      }
    }

    const punchesMap = new Map();
    for (const p of attPunches) {
      const keys = [String(p.employee_id)];
      const rawNum = String(p.employee_id).replace(/\D/g, '');
      if (rawNum) {
        keys.push(rawNum);
        keys.push(`EMP-${rawNum}`);
      }
      for (const k of keys) {
        if (!punchesMap.has(k)) punchesMap.set(k, []);
        punchesMap.get(k).push(p);
      }
    }

    const commLogsMap = new Map();
    for (const l of rawCommLogs) {
      const keys = [];
      if (l.employee_id) {
        keys.push(String(l.employee_id));
        keys.push(`EMP-${l.employee_id}`);
      }
      if (l.employee_name) {
        keys.push(l.employee_name.toLowerCase().trim());
      }
      for (const k of keys) {
        if (!commLogsMap.has(k)) commLogsMap.set(k, []);
        commLogsMap.get(k).push(l);
      }
    }

    return {
      cfg,
      periodHolidays,
      commMap,
      discMap,
      futureLoansMap,
      overrideMap,
      punchesMap,
      commLogsMap,
      schemeRulesMap
    };
  }

  /**
   * Calcula de forma 100% real y automática todos los conceptos salariales,
   * comisiones (desde employee_commissions_log), descuentos por servicios y préstamos
   * (desde employee_discounts), horas extras/feriados y retención TSS para un empleado.
   */
  async function calculateEmployeePayrollValues(pool, emp, start_date, end_date, preloadedCfg = null, preloadedHolidays = null, batchContextParam = null) {
    const batchContext = (preloadedCfg && preloadedCfg.commMap) ? preloadedCfg : batchContextParam;
    const empId = String(emp.id);
    const empName = emp.nombre || 'Colaborador';
    const posicion = emp.posicion || 'Estilista';
    const sucursalEmp = emp.localidad || emp.salon_name || (emp.salon_id == 6 ? 'Disponibles (*)' : (emp.salon_id == 4 || emp.salon_id == 2 ? 'Abatte Peluquería Sirena Villa Mella' : 'Abatte Peluquería San Vicente'));

    // Salario fijo según configuración salarial del colaborador
    const tipoSalario = emp.tipo_salario || 'fijo_mas_comision';
    let baseMensual = parseFloat(emp.salario_base !== undefined && emp.salario_base !== null ? emp.salario_base : 0);

    let salarioFijo = 0;
    if (tipoSalario === 'comision_pura' || tipoSalario === 'solo_comisiones') {
      salarioFijo = 0.00;
    } else {
      if (baseMensual <= 0) {
        if (posicion.toLowerCase().includes('barbero')) baseMensual = 24000;
        else if (posicion.toLowerCase().includes('estilista')) baseMensual = 20000;
        else if (posicion.toLowerCase().includes('manicur')) baseMensual = 19000;
        else if (posicion.toLowerCase().includes('recep')) baseMensual = 22000;
        else if (posicion.toLowerCase().includes('admin')) baseMensual = 32000;
        else baseMensual = 20000;
      }
      salarioFijo = Number((baseMensual / 2).toFixed(2));
    }

    // 1. COMISIONES REALES (desde employee_commissions_log para el rango de fechas)
    let comisiones = 0.00;
    if (tipoSalario !== 'fijo_puro' && tipoSalario !== 'solo_fijo') {
      try {
        if (batchContext && batchContext.commMap) {
          const byId = batchContext.commMap.get(String(empId)) || 0;
          const byCode = batchContext.commMap.get(`EMP-${empId}`) || 0;
          const byName = batchContext.commMap.get(empName.toLowerCase().trim()) || 0;
          comisiones = Number(Math.max(byId, byCode, byName).toFixed(2));
        } else {
          const [commRows] = await pool.query(`
            SELECT COALESCE(SUM(monto_comision), 0) as total_comm 
            FROM employee_commissions_log 
            WHERE (employee_id = ? OR employee_id = ? OR employee_name = ?)
              AND created_at >= ? AND created_at <= ?
              AND (status != 'Anulada' OR status IS NULL)
          `, [empId, `EMP-${empId}`, empName, `${start_date} 00:00:00`, `${end_date} 23:59:59`]);
          comisiones = Number(parseFloat(commRows[0]?.total_comm || 0).toFixed(2));
        }
      } catch (e) {
        console.warn(`[COMMISSIONS CALC WARN for ${empName}]:`, e.message);
      }
    }

    // 2. DESCUENTOS REALES (desde employee_discounts para el rango de fechas)
    let serviciosConsumo = 0.00;
    let prestamosMonto = 0.00;
    let ausenciasMonto = 0.00;
    let tardanzasMonto = 0.00;
    let otrosDescuentos = 0.00;
    const descuentosItemsList = [];
    const serviciosDetalleList = [];
    const prestamosDetalleList = [];
    const manualAusenciasList = [];
    const manualTardanzasList = [];

    try {
      let discountRows = [];
      let futurePendingLoanBalance = 0;
      const numId = parseInt(String(empId || '').replace(/\D/g, ''), 10);
      const hasValidNumId = !isNaN(numId) && numId > 0;

      if (batchContext && batchContext.discMap) {
        discountRows = batchContext.discMap.get(String(empId))
          || (hasValidNumId ? batchContext.discMap.get(String(numId)) : null)
          || batchContext.discMap.get(`EMP-${empId}`)
          || batchContext.discMap.get(empName.toLowerCase().trim())
          || [];
        if (batchContext.futureLoansMap) {
          futurePendingLoanBalance = batchContext.futureLoansMap.get(String(empId))
            || (hasValidNumId ? batchContext.futureLoansMap.get(String(numId)) : null)
            || batchContext.futureLoansMap.get(`EMP-${empId}`)
            || batchContext.futureLoansMap.get(empName.toLowerCase().trim())
            || 0;
        }
      } else {
        const [rows] = await pool.query(`
          SELECT id, type, amount, notes, status, DATE_FORMAT(date, '%Y-%m-%d') as d_date
          FROM employee_discounts
          WHERE (${hasValidNumId ? 'employee_id = ? OR ' : ''}employee_name = ?)
            AND date BETWEEN ? AND ?
            AND (status != 'Anulado' OR status IS NULL)
        `, hasValidNumId ? [numId, empName, start_date, end_date] : [empName, start_date, end_date]);
        discountRows = rows;

        try {
          const [fRows] = await pool.query(`
            SELECT COALESCE(SUM(amount), 0) as future_pending
            FROM employee_discounts
            WHERE (${hasValidNumId ? 'employee_id = ? OR ' : ''}employee_name = ?)
              AND date > ?
              AND status = 'Pendiente'
              AND (LOWER(type) LIKE '%prestamo%' OR LOWER(type) LIKE '%préstamo%' OR LOWER(type) LIKE '%adelanto%' OR LOWER(type) LIKE '%anticipo%')
          `, hasValidNumId ? [numId, empName, end_date] : [empName, end_date]);
          futurePendingLoanBalance = parseFloat(fRows[0]?.future_pending || 0);
        } catch (fErr) { }
      }

      // Deduplicar por id en caso de múltiples llaves
      const seenDiscountIds = new Set();
      for (const d of discountRows) {
        if (d.id && seenDiscountIds.has(d.id)) continue;
        if (d.id) seenDiscountIds.add(d.id);

        const amt = Number(parseFloat(d.amount || 0).toFixed(2));
        const typeLower = (d.type || '').toLowerCase();
        if (typeLower.includes('servicio') || typeLower.includes('producto') || typeLower.includes('consumo')) {
          serviciosConsumo += amt;
          serviciosDetalleList.push({
            id: d.id,
            fecha: d.d_date || start_date,
            servicio_producto: d.notes || (typeLower.includes('producto') ? 'Consumo de producto' : 'Servicio de salón'),
            tipo: d.type || 'Consumo_Servicio',
            monto: amt
          });
        } else if (typeLower.includes('prestamo') || typeLower.includes('préstamo') || typeLower.includes('adelanto') || typeLower.includes('anticipo')) {
          prestamosMonto += amt;
          // Extraer saldo pendiente si viene indicado en notas (ej. "Saldo: 1500") o usar cuotas futuras pendientes
          let parsedSaldo = null;
          if (d.notes) {
            const m = String(d.notes).match(/saldo(?:\s*pendiente)?\s*[:=]?\s*(?:RD\$)?\s*([\d,]+(?:\.\d{1,2})?)/i);
            if (m && m[1]) {
              parsedSaldo = parseFloat(m[1].replace(/,/g, ''));
            }
          }
          prestamosDetalleList.push({
            id: d.id,
            fecha: d.d_date || start_date,
            concepto: d.notes ? `${d.type === 'Adelanto' ? 'Anticipo' : 'Préstamo'}: ${d.notes}` : (typeLower.includes('adelanto') || typeLower.includes('anticipo') ? 'Anticipo de sueldo' : 'Préstamo a empleado'),
            tipo: d.type || 'Prestamo',
            cuota_descontada: amt,
            saldo_pendiente: parsedSaldo !== null && !isNaN(parsedSaldo) ? Number(parsedSaldo.toFixed(2)) : Number(futurePendingLoanBalance.toFixed(2))
          });
        } else if (typeLower.includes('ausencia')) {
          ausenciasMonto += amt;
          manualAusenciasList.push({
            id: d.id,
            fecha: d.d_date || start_date,
            tipo: d.notes || 'Descuento manual por ausencia',
            horas: 8,
            monto: amt
          });
        } else if (typeLower.includes('tardanza')) {
          tardanzasMonto += amt;
          manualTardanzasList.push({
            id: d.id,
            fecha: d.d_date || start_date,
            horario: 'Ajuste manual',
            entrada: '—',
            salida: '—',
            minutos_descontados: 0,
            detalle_minutos: d.notes || 'Descuento manual por tardanza',
            valor_minuto: 0,
            monto: amt
          });
        } else {
          otrosDescuentos += amt;
        }

        descuentosItemsList.push({
          id: `d_db_${d.id}`,
          label: `${d.type || 'Descuento'}${d.notes ? ' - ' + d.notes : ''}`,
          monto: amt,
          db_id: d.id
        });
      }
    } catch (e) {
      console.warn(`[EMPLOYEE DISCOUNTS CALC WARN for ${empName}]:`, e.message);
    }

    // 3. ASISTENCIA: Ausencias y Tardanzas automáticas basadas en la configuración de tarifa base y minutos
    const cfg = (batchContext && batchContext.cfg) || (preloadedCfg && preloadedCfg.salario_mensual_base ? preloadedCfg : await getCalculationSettings(pool));
    const salarioBaseGarantizado = parseFloat(cfg.salario_mensual_base || 18421.00);
    const diasLaboralesMes = parseFloat(cfg.dias_laborables_mes || 23.83);
    const horasDiaCompleto = parseFloat(cfg.horas_jornada_completa || 8.00);
    const horasMediaJornada = parseFloat(cfg.horas_media_jornada || 4.00);
    const recargoHorasExtras = parseFloat(cfg.recargo_horas_extras || 1.35);
    const recargoFeriado = parseFloat(cfg.recargo_feriado || 1.00);

    // Unidades de cálculo: mensual -> diario (23.83) -> hora (8h) -> minutos (/ 60)
    // El valor de la unidad por minuto se rige estrictamente por el salario mensual base configurado
    // garantizado en la pantalla de configuración salarial (RD$ 18,421.00 por defecto)
    const empSalarioDiario = salarioBaseGarantizado / diasLaboralesMes;
    const empSalarioHora = empSalarioDiario / horasDiaCompleto;
    const empSalarioMinuto = empSalarioHora / 60;

    const salarioDiarioGarantizado = empSalarioDiario;
    const salarioHoraGarantizado = empSalarioHora;
    const salarioMinutoGarantizado = empSalarioMinuto;

    // Variables de horas extras, descansos, feriados y ausencias
    let feriados = 0.00;
    let horasExtras = 0.00;
    let descanso = 0.00;
    let totalOvertimeMins = 0;
    let totalDescansoMins = 0;
    let totalNetLatenessMins = 0;
    let ausenciasHorasDetalle = [...manualAusenciasList];
    let tardanzasDiasDetalle = [...manualTardanzasList];

    try {
      // Cargar sobreescrituras de horario para el colaborador en el período
      const overrideMap = new Map();
      if (batchContext && batchContext.overrideMap) {
        const oList = batchContext.overrideMap.get(String(empId)) || batchContext.overrideMap.get(empName) || [];
        oList.forEach(o => overrideMap.set(o.dateStr, o));
      } else {
        const [overrides] = await pool.query(
          "SELECT DATE_FORMAT(date, '%Y-%m-%d') as dateStr, new_hora_entrada, new_hora_salida, reason FROM schedule_overrides WHERE (employee_id = ? OR employee_id = ?) AND date BETWEEN ? AND ? AND status = 'Activo'",
          [empId, empName, start_date, end_date]
        );
        overrides.forEach(o => overrideMap.set(o.dateStr, o));
      }

      // Helper para determinar la duración y jornada programada de un día específico
      const getScheduledDurationSecs = (dateStr) => {
        const override = overrideMap.get(dateStr);
        if (override) {
          const hasValidWorkingHours = override.new_hora_entrada &&
            override.new_hora_entrada !== '00:00:00' &&
            override.new_hora_salida &&
            override.new_hora_salida !== '00:00:00';

          if (!hasValidWorkingHours) {
            return { secs: 0, hrs: 0, isWorking: false, entrada: null, salida: null };
          }
          const [h1, m1] = override.new_hora_entrada.split(':').map(Number);
          const [h2, m2] = override.new_hora_salida.split(':').map(Number);
          let secs = (h2 * 3600 + m2 * 60) - (h1 * 3600 + m1 * 60);
          if (secs <= 0) secs += 86400;
          return { secs, hrs: secs / 3600, isWorking: true, entrada: override.new_hora_entrada, salida: override.new_hora_salida };
        }

        const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const d = new Date(dateStr + 'T12:00:00');
        const dName = dayNames[d.getDay()];
        const normalizeDay = (s) => (s || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const normDName = normalizeDay(dName);

        if (emp.dias_laborables && emp.dias_laborables.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(emp.dias_laborables);
            const matchKey = Object.keys(parsed).find(k => normalizeDay(k).slice(0, 3) === normDName.slice(0, 3));
            const dayInfo = matchKey ? parsed[matchKey] : null;
            if (dayInfo && dayInfo.entrada && dayInfo.salida) {
              const [h1, m1] = dayInfo.entrada.split(':').map(Number);
              const [h2, m2] = dayInfo.salida.split(':').map(Number);
              let secs = (h2 * 3600 + m2 * 60) - (h1 * 3600 + m1 * 60);
              if (secs <= 0) secs += 86400;
              return { secs, hrs: secs / 3600, isWorking: true, entrada: dayInfo.entrada, salida: dayInfo.salida };
            } else {
              return { secs: 0, hrs: 0, isWorking: false, entrada: null, salida: null };
            }
          } catch (e) { }
        } else if (emp.hora_entrada && emp.hora_salida) {
          const workingDays = (emp.dias_laborables || '').split(',').map(s => normalizeDay(s));
          const isWorking = workingDays.length === 0 || workingDays.some(w => w.slice(0, 3) === normDName.slice(0, 3)) || (!emp.dias_laborables && normDName !== 'domingo');
          if (isWorking) {
            const [h1, m1] = emp.hora_entrada.split(':').map(Number);
            const [h2, m2] = emp.hora_salida.split(':').map(Number);
            let secs = (h2 * 3600 + m2 * 60) - (h1 * 3600 + m1 * 60);
            if (secs <= 0) secs += 86400;
            return { secs, hrs: secs / 3600, isWorking: true, entrada: emp.hora_entrada, salida: emp.hora_salida };
          } else {
            return { secs: 0, hrs: 0, isWorking: false, entrada: null, salida: null };
          }
        }

        return { secs: horasDiaCompleto * 3600, hrs: horasDiaCompleto, isWorking: normDName !== 'domingo', entrada: '08:00', salida: '17:00' };
      };

      let attPunches = [];
      if (batchContext && batchContext.punchesMap) {
        attPunches = batchContext.punchesMap.get(String(empId)) || batchContext.punchesMap.get(empName) || [];
      } else {
        const [rows] = await pool.query(`
          SELECT id, type, status, lateness_minutes, extra_minutes, timestamp,
                 DATE_FORMAT(CONVERT_TZ(timestamp, '+00:00', '-04:00'), '%Y-%m-%d') as p_date
          FROM attendance
          WHERE (employee_id = ? OR employee_id = ?) 
            AND (DATE(timestamp) BETWEEN ? AND ? OR DATE(CONVERT_TZ(timestamp, '+00:00', '-04:00')) BETWEEN ? AND ?)
          ORDER BY timestamp ASC
        `, [empId, empName, start_date, end_date, start_date, end_date]);
        attPunches = rows;
      }

      const getDRDateStr = (timestamp) => {
        if (!timestamp) return '';
        if (typeof timestamp === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(timestamp.trim())) {
          return timestamp.trim();
        }
        try {
          const d = new Date(timestamp);
          if (isNaN(d.getTime())) return String(timestamp).slice(0, 10);
          return d.toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' });
        } catch (e) {
          return String(timestamp).slice(0, 10);
        }
      };

      const formatMinsTo12h = (mins) => {
        const h24 = Math.floor(mins / 60) % 24;
        const m = mins % 60;
        const ampm = h24 >= 12 ? 'p. m.' : 'a. m.';
        const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
        return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
      };

      const punchesByDay = {};
      attPunches.forEach(p => {
        const dKey = getDRDateStr(p.timestamp) || p.p_date;
        if (!punchesByDay[dKey]) punchesByDay[dKey] = [];
        punchesByDay[dKey].push(p);
      });

      let totalCalculatedAusencias = 0;

      // 3.1 Procesar ponches reales por día (entradas, salidas, compensación neta, fin de semana y tolerancia)
      Object.keys(punchesByDay).sort().forEach(dateStr => {
        const dayPunches = punchesByDay[dateStr];
        const ins = dayPunches.filter(p => p.type === 'Check-In');
        const outs = dayPunches.filter(p => p.type === 'Check-Out');

        if (ins.length > 0) {
          const checkIn = ins[0];
          const checkOut = outs.length > 0 ? outs[outs.length - 1] : null;
          const daySched = getScheduledDurationSecs(dateStr);

          // Si trabajó en día de descanso semanal: Pago al 100% en categoría Descanso (hora regular)
          if (!daySched.isWorking) {
            if (checkOut) {
              const inDate = new Date(checkIn.timestamp);
              const outDate = new Date(checkOut.timestamp);
              const inH = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santo_Domingo', hour: 'numeric', hourCycle: 'h23' }).format(inDate), 10);
              const inM = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santo_Domingo', minute: 'numeric' }).format(inDate), 10);
              const outH = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santo_Domingo', hour: 'numeric', hourCycle: 'h23' }).format(outDate), 10);
              const outM = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santo_Domingo', minute: 'numeric' }).format(outDate), 10);
              const workedMins = Math.max(0, (outH * 60 + outM) - (inH * 60 + inM));
              // Tiempo trabajado en descanso semanal: se computa por separado en categoría "Descanso" al 100% regular
              totalDescansoMins += workedMins;
            }
            return;
          }

          let scheduledEntMins = 8 * 60;
          let scheduledSalMins = 17 * 60;
          if (daySched.entrada) {
            const [eh, em] = daySched.entrada.split(':').map(Number);
            scheduledEntMins = eh * 60 + em;
          }
          if (daySched.salida) {
            const [sh, sm] = daySched.salida.split(':').map(Number);
            scheduledSalMins = sh * 60 + sm;
          }

          const inDate = new Date(checkIn.timestamp);
          const inH = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santo_Domingo', hour: 'numeric', hourCycle: 'h23' }).format(inDate), 10);
          const inM = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santo_Domingo', minute: 'numeric' }).format(inDate), 10);
          const inClockMins = inH * 60 + inM;

          // Punto 1 y Regla de Tolerancia de Entrada (15 min):
          // - Si rawDelayMins <= 15: evita descuento de tardanza (tardanzaEntrada = 0), pero NO convierte esos minutos en tiempo trabajado.
          // - Si rawDelayMins > 15: se considera todo el retraso original sin restar 15 min.
          const rawDelayMins = Math.max(0, inClockMins - scheduledEntMins);
          const tardanzaEntrada = rawDelayMins > 15 ? rawDelayMins : 0;

          // Punto 2: Nueva regla de entradas anticipadas:
          // - Si llega 15 minutos o menos antes de su entrada asignada (rawEarlyMins <= 15), no se reconoce ese tiempo para pago (0).
          // - Si supera los 15 minutos (rawEarlyMins > 15), se reconoce TODO el tiempo anticipado sin restar 15 minutos.
          // - Sustituye la condición de que el salón esté abierto y aplica también antes de las 8:00 a. m.
          const rawEarlyMins = Math.max(0, scheduledEntMins - inClockMins);
          const earlyExtraMins = rawEarlyMins > 15 ? rawEarlyMins : 0;

          if (checkOut) {
            const outDate = new Date(checkOut.timestamp);
            const outDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santo_Domingo', weekday: 'short' }).format(outDate);
            const outHour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santo_Domingo', hour: 'numeric', hourCycle: 'h23' }).format(outDate), 10);
            const outMinute = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santo_Domingo', minute: 'numeric' }).format(outDate), 10);
            const outClockMins = outHour * 60 + outMinute;

            // Cierre oficial de salón según día de la semana (hora República Dominicana):
            // - Sábados: corte de cierre 6:00 PM (18:00 = 1080 min)
            // - Domingos: corte de cierre 5:00 PM (17:00 = 1020 min)
            // - Lunes a Viernes: corte de cierre 8:00 PM (20:00 = 1200 min)
            const closingCutoffMins = (outDay === 'Sat') ? (18 * 60) : (outDay === 'Sun') ? (17 * 60) : (20 * 60);

            let salidaAnticipada = 0;
            let isEarlyExit = false;
            let extraAtExit = 0;

            // Excepción de cierre oficial (Nota Punto 2: llegar temprano NO autoriza salir antes del horario asignado):
            if (scheduledSalMins > closingCutoffMins) {
              if (outClockMins >= closingCutoffMins) {
                salidaAnticipada = 0;
                isEarlyExit = false;
                extraAtExit = Math.max(0, outClockMins - scheduledSalMins);
              } else {
                salidaAnticipada = scheduledSalMins - outClockMins;
                isEarlyExit = true;
                extraAtExit = 0;
              }
            } else {
              if (outClockMins >= scheduledSalMins) {
                salidaAnticipada = 0;
                isEarlyExit = false;
                extraAtExit = outClockMins - scheduledSalMins;
              } else {
                salidaAnticipada = scheduledSalMins - outClockMins;
                isEarlyExit = true;
                extraAtExit = 0;
              }
            }

            // Punto 1: Completar la jornada antes de generar extras:
            // Antes de reconocer extras a la salida, el tiempo posterior a la salida (extraAtExit)
            // debe compensar la llegada tardía (rawDelayMins), incluso si estuvo dentro de los 15 min de tolerancia.
            const delayCompensatedAtExit = Math.min(rawDelayMins, extraAtExit);
            const netLateness = rawDelayMins > 15 ? Math.max(0, rawDelayMins - delayCompensatedAtExit) : 0;
            const dayDeductedMins = netLateness + salidaAnticipada;

            totalNetLatenessMins += dayDeductedMins;

            if (dayDeductedMins > 0) {
              const dayMonto = Number((dayDeductedMins * empSalarioMinuto).toFixed(2));
              const partes = [];
              if (netLateness > 0) partes.push(`Tardanza neta: ${netLateness}m`);
              if (salidaAnticipada > 0) partes.push(`Salida anticipada: ${salidaAnticipada}m`);
              tardanzasDiasDetalle.push({
                fecha: dateStr,
                horario: `${formatMinsTo12h(scheduledEntMins)} - ${formatMinsTo12h(scheduledSalMins)}`,
                entrada: formatMinsTo12h(inClockMins),
                salida: formatMinsTo12h(outClockMins),
                minutos_descontados: dayDeductedMins,
                detalle_minutos: partes.join(' + '),
                valor_minuto: Number(empSalarioMinuto.toFixed(4)),
                monto: dayMonto
              });
            }

            // Horas extras del día = entrada anticipada reconocida (>15m) + excedente a la salida tras completar jornada (rawDelayMins)
            const extraAfterExit = !isEarlyExit ? Math.max(0, extraAtExit - rawDelayMins) : 0;
            const dayOvertimeMins = earlyExtraMins + extraAfterExit;
            if (dayOvertimeMins > 0) {
              totalOvertimeMins += dayOvertimeMins;
            }
          } else {
            // Solo ponche de entrada (turno abierto o sin ponche de salida)
            // Regla oficial de Asistencia y Nómina: Si no hay ponche de salida, el turno está incompleto
            // Por tanto, NO se reconocen horas extras por entrada anticipada (no le resta ni le pone tiempo).
            totalNetLatenessMins += tardanzaEntrada;
            if (tardanzaEntrada > 0) {
              const dayMonto = Number((tardanzaEntrada * empSalarioMinuto).toFixed(2));
              tardanzasDiasDetalle.push({
                fecha: dateStr,
                horario: `${formatMinsTo12h(scheduledEntMins)} - ${formatMinsTo12h(scheduledSalMins)}`,
                entrada: formatMinsTo12h(inClockMins),
                salida: 'Sin salida',
                minutos_descontados: tardanzaEntrada,
                detalle_minutos: `Tardanza entrada: ${tardanzaEntrada}m`,
                valor_minuto: Number(empSalarioMinuto.toFixed(4)),
                monto: dayMonto
              });
            }
          }
        }
      });

      // 3.2 Determinar Ausencias en días laborables programados sin NINGÚN ponche (ni Entrada ni Salida)
      const curDateObj = new Date(start_date + 'T12:00:00');
      const endDateObj = new Date(end_date + 'T12:00:00');
      const nowDR = new Date();
      const todayDateStr = nowDR.toLocaleDateString('sv-SE', { timeZone: 'America/Santo_Domingo' });
      const nowDRHour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santo_Domingo', hour: 'numeric', hourCycle: 'h23' }).format(nowDR), 10);
      const nowDRMinute = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santo_Domingo', minute: 'numeric' }).format(nowDR), 10);
      const nowDRMins = nowDRHour * 60 + nowDRMinute;
      const hireDateStr = emp.fecha_entrada ? new Date(emp.fecha_entrada).toLocaleDateString('sv-SE', { timeZone: 'America/Santo_Domingo' }) : null;

      while (curDateObj <= endDateObj) {
        const dateStr = curDateObj.toISOString().slice(0, 10);
        if (dateStr <= todayDateStr && (!hireDateStr || dateStr >= hireDateStr)) {
          const daySched = getScheduledDurationSecs(dateStr);
          const dayPunches = punchesByDay[dateStr] || [];
          const ins = dayPunches.filter(p => p.type === 'Check-In');
          const outs = dayPunches.filter(p => p.type === 'Check-Out');

          // CRÍTICO: SOLO computar ausencia si NO existe NINGÚN ponche real (ni entrada ni salida)
          const hasRealPunch = ins.length > 0 || outs.length > 0;

          if (daySched.isWorking && !hasRealPunch) {
            // Punto 4: Confirmar ausencias durante un turno abierto:
            // Mientras la jornada de hoy siga abierta (nowDRMins < scheduledSalMins), la ausencia es provisional
            // y NO debe consolidarse todavía como descuento definitivo para pago.
            let isShiftClosed = dateStr < todayDateStr;
            if (dateStr === todayDateStr) {
              let scheduledSalMins = 17 * 60;
              if (daySched.salida) {
                const [sh, sm] = daySched.salida.split(':').map(Number);
                scheduledSalMins = sh * 60 + sm;
              }
              isShiftClosed = nowDRMins >= scheduledSalMins;
            }

            if (isShiftClosed) {
              const isHalfDay = daySched.hrs <= 5;
              const scheduledHrs = isHalfDay ? horasMediaJornada : horasDiaCompleto;
              const descuentoDia = Number((scheduledHrs * empSalarioHora).toFixed(2));
              totalCalculatedAusencias += descuentoDia;
              ausenciasHorasDetalle.push({
                fecha: dateStr,
                tipo: isHalfDay ? 'Medio Día (4 hrs)' : 'Día Completo (8 hrs)',
                horas: scheduledHrs,
                monto: descuentoDia
              });
            }
          }
        }
        curDateObj.setDate(curDateObj.getDate() + 1);
      }

      // Para colaboradores a comisión pura (sin salario fijo), no se descuentan ausencias ni tardanzas de un salario fijo inexistente
      const isComisionPura = tipoSalario === 'comision_pura' || tipoSalario === 'solo_comisiones' || salarioFijo === 0;

      if (!isComisionPura) {
        if (ausenciasHorasDetalle.length > 0) {
          // Punto 6: La suma del desglose debe coincidir exactamente con el importe del volante
          ausenciasMonto = Number(ausenciasHorasDetalle.reduce((acc, r) => acc + (parseFloat(r.monto) || 0), 0).toFixed(2));
        }
        if (tardanzasDiasDetalle.length > 0) {
          // Punto 6: La suma del desglose diario de tardanzas coincide exactamente con el importe del volante
          tardanzasMonto = Number(tardanzasDiasDetalle.reduce((acc, r) => acc + (parseFloat(r.monto) || 0), 0).toFixed(2));
        }
      } else {
        ausenciasHorasDetalle = [];
        tardanzasDiasDetalle = [];
      }
      if (totalOvertimeMins > 0) {
        horasExtras = Number((totalOvertimeMins * empSalarioMinuto * recargoHorasExtras).toFixed(2));
      }
      if (totalDescansoMins > 0) {
        // El descanso trabajado se paga al 100% (tarifa regular) porque el día ya está cubierto en el salario fijo
        descanso = Number((totalDescansoMins * empSalarioMinuto * 1.00).toFixed(2));
      }
    } catch (e) {
      console.warn(`[ATTENDANCE CALC WARN for ${empName}]:`, e.message);
    }

    // 4. FERIADOS desde asistencia y calendario oficial
    try {
      const periodHolidays = (batchContext && batchContext.periodHolidays)
        ? batchContext.periodHolidays
        : (preloadedHolidays !== null
          ? preloadedHolidays
          : (await pool.query(`
                SELECT DATE_FORMAT(date, '%Y-%m-%d') as holiday_date, name, rate_multiplier 
                FROM holidays 
                WHERE date BETWEEN ? AND ? AND is_active = 1
              `, [start_date, end_date]))[0]);

      if (periodHolidays.length > 0) {
        const holidayDates = new Set(periodHolidays.map(h => h.holiday_date));

        let holidayPunches = [];
        if (batchContext && batchContext.punchesMap) {
          const allEmpPunches = batchContext.punchesMap.get(String(empId)) || batchContext.punchesMap.get(empName) || [];
          holidayPunches = allEmpPunches.filter(p => holidayDates.has(p.p_date));
        } else {
          const [rows] = await pool.query(`
            SELECT id, type, timestamp, DATE_FORMAT(timestamp, '%Y-%m-%d') as punch_date
            FROM attendance
            WHERE (employee_id = ? OR employee_id = ?)
              AND DATE(timestamp) IN (?)
            ORDER BY timestamp ASC
          `, [empId, empName, Array.from(holidayDates)]);
          holidayPunches = rows;
        }

        const punchesByDate = {};
        holidayPunches.forEach(p => {
          const dt = p.punch_date || p.p_date;
          if (!punchesByDate[dt]) punchesByDate[dt] = [];
          punchesByDate[dt].push(p);
        });

        periodHolidays.forEach(h => {
          const dayPunches = punchesByDate[h.holiday_date] || [];
          const ins = dayPunches.filter(p => p.type === 'Check-In');
          const outs = dayPunches.filter(p => p.type === 'Check-Out');
          if (ins.length > 0) {
            const inTime = new Date(ins[0].timestamp).getTime();
            let outTime = outs.length > 0 ? new Date(outs[outs.length - 1].timestamp).getTime() : null;
            let workedHours = 0;
            if (outTime && outTime > inTime) {
              const mins = Math.floor((outTime - inTime) / 60000);
              workedHours = Number((mins / 60).toFixed(2));
            } else {
              workedHours = horasDiaCompleto;
            }

            const multiplier = parseFloat(recargoFeriado !== undefined ? recargoFeriado : (h.rate_multiplier || 1.00));
            const holidayPay = Number((workedHours * salarioHoraGarantizado * multiplier).toFixed(2));
            feriados += holidayPay;
          }
        });
        feriados = Number(feriados.toFixed(2));
      }
    } catch (hErr) { }

    let otrosIngresos = 0.00;
    const ingresosItemsList = [];

    // 4.1. EVALUAR REGLAS ESPECIALES POR VOLUMEN / META (operacion = 'Contar')
    if (emp.commission_scheme_id) {
      try {
        let countRules = [];
        if (batchContext && batchContext.schemeRulesMap) {
          countRules = batchContext.schemeRulesMap.get(String(emp.commission_scheme_id)) || [];
        } else {
          const [rows] = await pool.query(
            "SELECT * FROM commission_scheme_rules WHERE scheme_id = ? AND rule_type = 'especial' AND operacion = 'Contar'",
            [emp.commission_scheme_id]
          );
          countRules = rows;
        }
        for (const cr of countRules) {
          const targetCount = parseInt(cr.cantidad_meta) || 0;
          const bonusAmt = parseFloat(cr.bono_monto) || 0;
          if (targetCount > 0 && bonusAmt > 0 && cr.service_name) {
            let totalPerformed = 0;
            if (batchContext && batchContext.commLogsMap) {
              const logs = batchContext.commLogsMap.get(String(empId))
                || batchContext.commLogsMap.get(`EMP-${empId}`)
                || batchContext.commLogsMap.get(empName.toLowerCase().trim())
                || [];
              const sTarget = cr.service_name.toLowerCase();
              totalPerformed = logs.filter(l => l.service_name && l.service_name.toLowerCase().includes(sTarget)).length;
            } else {
              const [performed] = await pool.query(`
                SELECT COUNT(*) as count 
                FROM employee_commissions_log 
                WHERE (employee_id = ? OR employee_id = ? OR employee_name = ?)
                  AND service_name LIKE ?
                  AND created_at >= ? AND created_at <= ?
                  AND (status != 'Anulada' OR status IS NULL)
              `, [empId, `EMP-${empId}`, empName, `%${cr.service_name}%`, `${start_date} 00:00:00`, `${end_date} 23:59:59`]);
              totalPerformed = performed[0]?.count || 0;
            }

            if (totalPerformed >= targetCount) {
              otrosIngresos += bonusAmt;
              ingresosItemsList.push({
                id: `bono_meta_${cr.id}`,
                label: `Bono Meta: ${cr.service_name} (${totalPerformed}/${targetCount})`,
                monto: bonusAmt
              });
            }
          }
        }
      } catch (err) {
        console.warn(`[BONUS CONTAR CALC WARN for ${empName}]:`, err.message);
      }
    }
    otrosIngresos = Number(otrosIngresos.toFixed(2));

    // 5. TSS: Seguro Familiar de Salud (SFS 3.04%) + Pensión (AFP 2.87%) = 5.91% de ley
    let baseTss = 0.00;
    if (cfg.tss_base_mode === 'salario_definido') {
      // Opción 3: Salario Definido en configuración (RD$ 18,421.00 mensual base -> RD$ 9,210.50 quincenal)
      baseTss = Number((salarioBaseGarantizado / 2).toFixed(2));
    } else if (cfg.tss_base_mode === 'fijo_mas_comisiones') {
      // Opción 2: Salario Fijo + Comisiones por Servicios (Ley 87-01)
      baseTss = salarioFijo + comisiones;
    } else {
      // Opción 1: Solo Salario Fijo Ordinario (Práctica común)
      baseTss = salarioFijo;
    }
    const tss = baseTss > 0 ? Number((baseTss * 0.0591).toFixed(2)) : 0.00;

    // 5.1 RETENCIÓN ISR DGII (Si está habilitada en configuración de nómina)
    let isrRetencion = 0.00;
    if (cfg.aplicar_retencion_isr === 1 || cfg.aplicar_retencion_isr === true) {
      const ingresosGravables = salarioFijo + comisiones + horasExtras + descanso;
      isrRetencion = calculateDgiiIsrQuincenal(ingresosGravables, tss);
      if (isrRetencion > 0) {
        descuentosItemsList.push({
          id: 'd_isr_dgii',
          label: 'Retención ISR (DGII Asalariados)',
          monto: isrRetencion
        });
        otrosDescuentos = Number((otrosDescuentos + isrRetencion).toFixed(2));
      }
    }

    // Redondear a 2 decimales
    serviciosConsumo = Number(serviciosConsumo.toFixed(2));
    prestamosMonto = Number(prestamosMonto.toFixed(2));
    ausenciasMonto = Number(ausenciasMonto.toFixed(2));
    tardanzasMonto = Number(tardanzasMonto.toFixed(2));
    otrosDescuentos = Number(otrosDescuentos.toFixed(2));

    // Totales
    const totalIngresos = Number((salarioFijo + comisiones + feriados + horasExtras + descanso + otrosIngresos).toFixed(2));
    const totalDescuentos = Number((tss + serviciosConsumo + prestamosMonto + ausenciasMonto + tardanzasMonto + otrosDescuentos).toFixed(2));
    const netoPagar = Number(Math.max(0, totalIngresos - totalDescuentos).toFixed(2));

    return syncDetallesJsonWithItem({
      employee_id: empId,
      employee_name: empName,
      posicion: posicion,
      sucursal: sucursalEmp,
      departamento: posicion,
      salario_fijo: salarioFijo,
      comisiones: comisiones,
      feriados: feriados,
      horas_extras: horasExtras,
      descanso: descanso,
      otros_ingresos: otrosIngresos,
      total_ingresos: totalIngresos,
      tss: tss,
      servicios: serviciosConsumo,
      prestamos: prestamosMonto,
      ausencias: ausenciasMonto,
      tardanzas: tardanzasMonto,
      otros_descuentos: otrosDescuentos,
      total_descuentos: totalDescuentos,
      neto_pagar: netoPagar,
      detalles_json: {
        conceptos_ingresos: [
          { id: 'c1', label: 'Salario fijo', monto: salarioFijo },
          { id: 'c2', label: 'Comisiones', monto: comisiones },
          { id: 'c3', label: 'Feriados', monto: feriados },
          { id: 'c4', label: totalOvertimeMins > 0 ? `Horas extras (${Math.round(totalOvertimeMins / 60 * 10) / 10}h / ${totalOvertimeMins}m)` : 'Horas extras', monto: horasExtras },
          { id: 'c_descanso', label: totalDescansoMins > 0 ? `Descanso laborado (${Math.round(totalDescansoMins / 60 * 10) / 10}h / ${totalDescansoMins}m)` : 'Descanso', monto: descanso },
          { id: 'c5', label: 'Otros ingresos / Bonos', monto: otrosIngresos },
          ...ingresosItemsList
        ],
        conceptos_descuentos: [
          { id: 'd1', label: cfg.tss_base_mode === 'salario_definido' ? `TSS (Ley 5.91% Base General RD$ ${baseTss.toLocaleString('en-US', { minimumFractionDigits: 2 })})` : cfg.tss_base_mode === 'fijo_mas_comisiones' ? 'TSS (Ley 5.91% Sueldo+Comisión)' : 'TSS (Ley 5.91%)', monto: tss },
          ...(isrRetencion > 0 ? [{ id: 'd_isr', label: 'Retención ISR (DGII)', monto: isrRetencion }] : []),
          { id: 'd2', label: 'Servicios de Salón', monto: serviciosConsumo },
          { id: 'd3', label: 'Préstamos / Adelantos', monto: prestamosMonto },
          { id: 'd4', label: 'Ausencias', monto: ausenciasMonto },
          { id: 'd5', label: totalNetLatenessMins > 0 ? `Tardanzas netas (${totalNetLatenessMins}m)` : 'Tardanzas', monto: tardanzasMonto },
          { id: 'd6', label: 'Otros descuentos', monto: otrosDescuentos }
        ],
        desglose_descuentos: {
          tardanzas: {
            items: tardanzasDiasDetalle,
            total_minutos: totalNetLatenessMins,
            valor_minuto: Number(empSalarioMinuto.toFixed(4)),
            total_monto: tardanzasMonto
          },
          ausencias: {
            items: ausenciasHorasDetalle,
            total_monto: ausenciasMonto
          },
          servicios: {
            items: serviciosDetalleList,
            total_monto: serviciosConsumo
          },
          prestamos: {
            items: prestamosDetalleList,
            total_monto: prestamosMonto
          }
        }
      }
    });
  }

  // 3. Generar / Procesar Nómina Automática con Datos Reales (Con Transacción ACID)
  router.post('/generate', async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const {
        period_name,
        start_date,
        end_date,
        sucursal = 'Todas',
        departamento = 'Todos'
      } = req.body;

      if (!period_name || !start_date || !end_date) {
        conn.release();
        return res.status(400).json({ error: 'El nombre del período y las fechas de inicio y fin son obligatorios' });
      }

      await conn.beginTransaction();

      // 1. Obtener empleados activos
      let staffQuery = "SELECT * FROM staff_records WHERE (status = 'Activo' OR status = 'Active' OR status IS NULL)";
      const staffParams = [];
      if (sucursal && sucursal !== 'Todas') {
        const sucLower = String(sucursal).toLowerCase();
        if (sucLower.includes('disponible')) {
          staffQuery += " AND (salon_id = 6 OR localidad LIKE '%disponible%')";
        } else if (sucLower.includes('villa mella') || sucLower.includes('mella')) {
          staffQuery += " AND (salon_id IN (2, 4) OR localidad LIKE '%mella%')";
        } else if (sucLower.includes('san vicente') || sucLower.includes('vicente')) {
          staffQuery += " AND (salon_id = 1 OR localidad LIKE '%vicente%')";
        } else {
          staffQuery += " AND (salon_id = ? OR localidad LIKE ?)";
          staffParams.push(sucursal, `%${sucursal}%`);
        }
      }
      if (departamento && departamento !== 'Todos') {
        staffQuery += " AND (posicion LIKE ?)";
        staffParams.push(`%${departamento}%`);
      }
      let [staffList] = await conn.query(staffQuery, staffParams);

      if (staffList.length === 0) {
        const seedStaff = [
          { id: '1', nombre: 'Ana Pérez', posicion: 'Estilista', localidad: 'Abatte Peluquería San Vicente', salario_base: 20000.00 },
          { id: '2', nombre: 'Carlos Gómez', posicion: 'Barbero', localidad: 'Abatte Peluquería San Vicente', salario_base: 24000.00 },
          { id: '3', nombre: 'María López', posicion: 'Manicurista', localidad: 'Abatte Peluquería Sirena Villa Mella', salario_base: 19000.00 },
          { id: '4', nombre: 'Luis Martínez', posicion: 'Recepción', localidad: 'Abatte Peluquería San Vicente', salario_base: 22000.00 },
          { id: '5', nombre: 'Karla Ruiz', posicion: 'Estilista', localidad: 'Abatte Peluquería Sirena Villa Mella', salario_base: 20000.00 },
          { id: '6', nombre: 'José Fernández', posicion: 'Soporte', localidad: 'Abatte Peluquería San Vicente', salario_base: 28000.00 },
          { id: '7', nombre: 'Patricia Santos', posicion: 'Administración', localidad: 'Abatte Peluquería Sirena Villa Mella', salario_base: 32000.00 },
          { id: '8', nombre: 'David Peña', posicion: 'Barbero', localidad: 'Abatte Peluquería Sirena Villa Mella', salario_base: 23000.00 },
          { id: '9', nombre: 'Sofía Castro', posicion: 'Estilista', localidad: 'Abatte Peluquería San Vicente', salario_base: 19600.00 },
          { id: '10', nombre: 'Miguel Rojas', posicion: 'Mantenimiento', localidad: 'Abatte Peluquería Sirena Villa Mella', salario_base: 26000.00 }
        ];
        staffList = seedStaff;
      }

      // 2. Crear registro del período
      const [periodRes] = await conn.query(`
        INSERT INTO payroll_periods (period_name, start_date, end_date, sucursal, departamento, status)
        VALUES (?, ?, ?, ?, ?, 'En preparación')
      `, [period_name, start_date, end_date, sucursal, departamento]);
      const payrollId = periodRes.insertId;

      let sumTotalIngresos = 0;
      let sumTotalDescuentos = 0;
      let sumTotalNeto = 0;
      const generatedItems = [];

      // Pre-cargar configuración salarial, feriados, comisiones, descuentos, horario y ponches una sola vez para todo el lote
      const batchContext = await preloadPayrollBatchContext(conn, start_date, end_date);

      // 3. Procesar y calcular cada empleado de forma 100% real
      // 3. Procesar y calcular cada empleado de forma 100% real en memoria
      for (const emp of staffList) {
        const itemData = await calculateEmployeePayrollValues(pool, emp, start_date, end_date, batchContext);
        itemData.payroll_id = payrollId;
        generatedItems.push(itemData);

        sumTotalIngresos += itemData.total_ingresos;
        sumTotalDescuentos += itemData.total_descuentos;
        sumTotalNeto += itemData.neto_pagar;
      }

      if (generatedItems.length > 0) {
        const insertValues = generatedItems.map(itemData => [
          itemData.payroll_id, itemData.employee_id, itemData.employee_name, itemData.posicion, itemData.sucursal, itemData.departamento,
          itemData.salario_fijo, itemData.comisiones, itemData.feriados, itemData.horas_extras, (itemData.descanso || 0), itemData.otros_ingresos, itemData.total_ingresos,
          itemData.tss, itemData.servicios, itemData.prestamos, itemData.ausencias, itemData.tardanzas, itemData.otros_descuentos, itemData.total_descuentos,
          itemData.neto_pagar, JSON.stringify(itemData.detalles_json)
        ]);

        await conn.query(`
          INSERT INTO payroll_items (
            payroll_id, employee_id, employee_name, posicion, sucursal, departamento,
            salario_fijo, comisiones, feriados, horas_extras, descanso, otros_ingresos, total_ingresos,
            tss, servicios, prestamos, ausencias, tardanzas, otros_descuentos, total_descuentos,
            neto_pagar, detalles_json
          ) VALUES ?
        `, [insertValues]);

        const [insertedRows] = await conn.query('SELECT * FROM payroll_items WHERE payroll_id = ? ORDER BY id ASC', [payrollId]);
        generatedItems.length = 0;
        insertedRows.forEach(r => generatedItems.push({
          ...r,
          detalles_json: typeof r.detalles_json === 'string' ? JSON.parse(r.detalles_json || '{}') : (r.detalles_json || {})
        }));
      }

      // 4. Actualizar totales del período
      await conn.query(`
        UPDATE payroll_periods 
        SET total_ingresos = ?, total_descuentos = ?, total_neto = ?, total_empleados = ?
        WHERE id = ?
      `, [sumTotalIngresos, sumTotalDescuentos, sumTotalNeto, generatedItems.length, payrollId]);

      await conn.commit();

      res.json({
        success: true,
        payroll_id: payrollId,
        period: {
          id: payrollId,
          period_name,
          start_date,
          end_date,
          sucursal,
          departamento,
          status: 'En preparación',
          total_ingresos: sumTotalIngresos,
          total_descuentos: sumTotalDescuentos,
          total_neto: sumTotalNeto,
          total_empleados: generatedItems.length
        },
        items: generatedItems
      });
    } catch (err) {
      await conn.rollback();
      console.error('[PAYROLL GENERATE ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    } finally {
      conn.release();
    }
  });

  // 4. Guardar borrador / Actualizar items de nómina con Auditoría e Inmutabilidad (Con Transacción ACID)
  router.post('/save-draft', async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const { payroll_id, items, status = 'En preparación', reason = 'Ajuste de borrador', user_name = 'Administrador' } = req.body;
      if (!payroll_id || !Array.isArray(items)) {
        conn.release();
        return res.status(400).json({ error: 'payroll_id e items son requeridos' });
      }

      await conn.beginTransaction();

      // Validar inmutabilidad si la nómina ya fue aprobada
      const [periodRows] = await conn.query('SELECT status, is_immutable FROM payroll_periods WHERE id = ?', [payroll_id]);
      if (periodRows.length === 0) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ error: 'Período no encontrado' });
      }
      if (periodRows[0].status === 'Aprobada' || periodRows[0].is_immutable === 1) {
        await conn.rollback();
        conn.release();
        return res.status(403).json({ error: 'Esta nómina ya ha sido aprobada y es inmutable. No se pueden realizar modificaciones.' });
      }

      // Obtener items actuales para registrar cambios en auditoría
      const [currentDbItems] = await conn.query('SELECT * FROM payroll_items WHERE payroll_id = ?', [payroll_id]);
      const currentMap = {};
      currentDbItems.forEach(it => { currentMap[it.id] = it; });

      let sumTotalIngresos = 0;
      let sumTotalDescuentos = 0;
      let sumTotalNeto = 0;

      for (const it of items) {
        const totalIngresos = Number((
          parseFloat(it.salario_fijo || 0) +
          parseFloat(it.comisiones || 0) +
          parseFloat(it.feriados || 0) +
          parseFloat(it.horas_extras || 0) +
          parseFloat(it.descanso || 0) +
          parseFloat(it.otros_ingresos || 0)
        ).toFixed(2));

        const totalDescuentos = Number((
          parseFloat(it.tss || 0) +
          parseFloat(it.servicios || 0) +
          parseFloat(it.prestamos || 0) +
          parseFloat(it.ausencias || 0) +
          parseFloat(it.tardanzas || 0) +
          parseFloat(it.otros_descuentos || 0)
        ).toFixed(2));

        const netoPagar = Number((totalIngresos - totalDescuentos).toFixed(2));

        sumTotalIngresos += totalIngresos;
        sumTotalDescuentos += totalDescuentos;
        sumTotalNeto += netoPagar;

        // Auditoría: Detectar campos modificados
        const prev = currentMap[it.id];
        let hasModifiedFields = false;
        const modifiedFieldsList = [];
        if (prev) {
          const fieldsToCheck = [
            'salario_fijo', 'comisiones', 'feriados', 'horas_extras', 'descanso', 'otros_ingresos',
            'tss', 'servicios', 'prestamos', 'ausencias', 'tardanzas', 'otros_descuentos'
          ];

          for (const f of fieldsToCheck) {
            const oldVal = parseFloat(prev[f] || 0);
            const newVal = parseFloat(it[f] || 0);
            if (Math.abs(oldVal - newVal) > 0.009) {
              hasModifiedFields = true;
              modifiedFieldsList.push(f);
              await conn.query(`
                INSERT INTO payroll_audit_logs (payroll_id, employee_id, employee_name, field_name, old_value, new_value, action_type, reason, user_name)
                VALUES (?, ?, ?, ?, ?, ?, 'Edición Manual', ?, ?)
              `, [payroll_id, it.employee_id, it.employee_name, f, oldVal.toFixed(2), newVal.toFixed(2), reason, user_name]);
            }
          }
        }

        let detObj = typeof it.detalles_json === 'string' ? JSON.parse(it.detalles_json || '{}') : (it.detalles_json || {});
        if (hasModifiedFields || detObj.manually_adjusted || (detObj.manual_fields && detObj.manual_fields.length > 0)) {
          detObj.manually_adjusted = true;
          detObj.manual_fields = Array.from(new Set([...(detObj.manual_fields || []), ...modifiedFieldsList]));
        }
        it.detalles_json = detObj;
        syncDetallesJsonWithItem(it);

        await conn.query(`
          UPDATE payroll_items
          SET 
            salario_fijo = ?, comisiones = ?, feriados = ?, horas_extras = ?, descanso = ?, otros_ingresos = ?, total_ingresos = ?,
            tss = ?, servicios = ?, prestamos = ?, ausencias = ?, tardanzas = ?, otros_descuentos = ?, total_descuentos = ?,
            neto_pagar = ?, detalles_json = ?
          WHERE id = ? AND payroll_id = ?
        `, [
          it.salario_fijo, it.comisiones, it.feriados, it.horas_extras, (it.descanso || 0), it.otros_ingresos, totalIngresos,
          it.tss, it.servicios, it.prestamos, it.ausencias, it.tardanzas, it.otros_descuentos, totalDescuentos,
          netoPagar, JSON.stringify(detObj),
          it.id, payroll_id
        ]);
      }

      await conn.query(`
        UPDATE payroll_periods
        SET total_ingresos = ?, total_descuentos = ?, total_neto = ?, total_empleados = ?, status = ?
        WHERE id = ?
      `, [sumTotalIngresos, sumTotalDescuentos, sumTotalNeto, items.length, status, payroll_id]);

      await conn.commit();

      res.json({
        success: true,
        message: 'Nómina guardada como borrador correctamente',
        totals: {
          total_ingresos: sumTotalIngresos,
          total_descuentos: sumTotalDescuentos,
          total_neto: sumTotalNeto,
          total_empleados: items.length
        }
      });
    } catch (err) {
      await conn.rollback();
      console.error('[PAYROLL SAVE DRAFT ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    } finally {
      conn.release();
    }
  });

  // 5. Aplicar Concepto Masivo con Auditoría (Con Transacción ACID)
  router.post('/bulk-apply', async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const {
        payroll_id,
        item_ids,
        concept_key,
        concept_label,
        concept_type = 'Ingreso',
        amount,
        operation = 'add',
        reason = 'Aplicación masiva de concepto',
        user_name = 'Administrador'
      } = req.body;

      if (!payroll_id || !Array.isArray(item_ids) || item_ids.length === 0) {
        conn.release();
        return res.status(400).json({ error: 'payroll_id e item_ids requeridos' });
      }

      await conn.beginTransaction();

      const [periodRows] = await conn.query('SELECT status, is_immutable FROM payroll_periods WHERE id = ?', [payroll_id]);
      if (periodRows.length === 0) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ error: 'Período no encontrado' });
      }
      if (periodRows[0].status === 'Aprobada' || periodRows[0].is_immutable === 1) {
        await conn.rollback();
        conn.release();
        return res.status(403).json({ error: 'La nómina está aprobada y es inmutable' });
      }

      const valToAdd = parseFloat(amount) || 0;

      for (const itemId of item_ids) {
        const [itRows] = await conn.query('SELECT * FROM payroll_items WHERE id = ? AND payroll_id = ?', [itemId, payroll_id]);
        if (itRows.length > 0) {
          const item = itRows[0];
          let details = typeof item.detalles_json === 'string' ? JSON.parse(item.detalles_json || '{}') : (item.detalles_json || {});
          if (!details.conceptos_ingresos) details.conceptos_ingresos = [];
          if (!details.conceptos_descuentos) details.conceptos_descuentos = [];

          let oldVal = 0;
          let newVal = 0;

          if (concept_key && item[concept_key] !== undefined) {
            oldVal = parseFloat(item[concept_key] || 0);
            newVal = operation === 'add' ? (oldVal + valToAdd) : valToAdd;
            item[concept_key] = newVal;
          } else {
            const list = concept_type === 'Ingreso' ? details.conceptos_ingresos : details.conceptos_descuentos;
            const existIdx = list.findIndex(c => c.label.toLowerCase() === (concept_label || '').toLowerCase());
            if (existIdx >= 0) {
              oldVal = parseFloat(list[existIdx].monto || 0);
              newVal = operation === 'add' ? (oldVal + valToAdd) : valToAdd;
              list[existIdx].monto = newVal;
            } else {
              oldVal = 0;
              newVal = valToAdd;
              list.push({ id: `c_${Date.now()}_${Math.random()}`, label: concept_label || 'Concepto Extra', monto: newVal });
            }

            if (concept_type === 'Ingreso') {
              item.otros_ingresos = (parseFloat(item.otros_ingresos || 0) + (newVal - oldVal));
            } else {
              item.otros_descuentos = (parseFloat(item.otros_descuentos || 0) + (newVal - oldVal));
            }
          }

          const totalIng = Number((
            parseFloat(item.salario_fijo || 0) +
            parseFloat(item.comisiones || 0) +
            parseFloat(item.feriados || 0) +
            parseFloat(item.horas_extras || 0) +
            parseFloat(item.descanso || 0) +
            parseFloat(item.otros_ingresos || 0)
          ).toFixed(2));

          const totalDesc = Number((
            parseFloat(item.tss || 0) +
            parseFloat(item.servicios || 0) +
            parseFloat(item.prestamos || 0) +
            parseFloat(item.ausencias || 0) +
            parseFloat(item.tardanzas || 0) +
            parseFloat(item.otros_descuentos || 0)
          ).toFixed(2));

          const netoPagar = Number((totalIng - totalDesc).toFixed(2));

          item.total_ingresos = totalIng;
          item.total_descuentos = totalDesc;
          item.neto_pagar = netoPagar;
          item.detalles_json = details;
          item.detalles_json.manually_adjusted = true;
          const affectedField = concept_key || (concept_type === 'Ingreso' ? 'otros_ingresos' : 'otros_descuentos');
          item.detalles_json.manual_fields = Array.from(new Set([...(item.detalles_json.manual_fields || []), affectedField]));
          syncDetallesJsonWithItem(item);

          await conn.query(`
            UPDATE payroll_items
            SET 
              salario_fijo = ?, comisiones = ?, feriados = ?, horas_extras = ?, descanso = ?, otros_ingresos = ?, total_ingresos = ?,
              tss = ?, servicios = ?, prestamos = ?, ausencias = ?, tardanzas = ?, otros_descuentos = ?, total_descuentos = ?,
              neto_pagar = ?, detalles_json = ?
            WHERE id = ?
          `, [
            item.salario_fijo, item.comisiones, item.feriados, item.horas_extras, (item.descanso || 0), item.otros_ingresos, totalIng,
            item.tss, item.servicios, item.prestamos, item.ausencias, item.tardanzas, item.otros_descuentos, totalDesc,
            netoPagar, JSON.stringify(item.detalles_json), itemId
          ]);

          // Registrar en auditoría
          await conn.query(`
            INSERT INTO payroll_audit_logs (payroll_id, employee_id, employee_name, field_name, old_value, new_value, action_type, reason, user_name)
            VALUES (?, ?, ?, ?, ?, ?, 'Cambio Masivo', ?, ?)
          `, [payroll_id, item.employee_id, item.employee_name, concept_label || concept_key, oldVal.toFixed(2), newVal.toFixed(2), reason, user_name]);
        }
      }

      // Recalcular totales generales del período
      const [allIt] = await conn.query('SELECT total_ingresos, total_descuentos, neto_pagar FROM payroll_items WHERE payroll_id = ?', [payroll_id]);
      let totIng = 0, totDesc = 0, totNet = 0;
      allIt.forEach(r => {
        totIng += parseFloat(r.total_ingresos || 0);
        totDesc += parseFloat(r.total_descuentos || 0);
        totNet += parseFloat(r.neto_pagar || 0);
      });

      await conn.query(`
        UPDATE payroll_periods
        SET total_ingresos = ?, total_descuentos = ?, total_neto = ?
        WHERE id = ?
      `, [totIng, totDesc, totNet, payroll_id]);

      await conn.commit();

      res.json({ success: true, message: `Concepto aplicado exitosamente a ${item_ids.length} colaboradores` });
    } catch (err) {
      await conn.rollback();
      console.error('[PAYROLL BULK APPLY ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    } finally {
      conn.release();
    }
  });

  // 6. Aprobar Nómina con Inmutabilidad, Snapshot Congelado y Liquidación de Descuentos/Comisiones (Con Transacción ACID)
  router.post('/approve', async (req, res) => {
    const conn = await pool.getConnection();
    try {
      let { payroll_id, approved_by = 'Administrador' } = req.body;
      if (!payroll_id && req.body && typeof req.body === 'object') {
        if (req.body.id) payroll_id = req.body.id;
      }
      if (!payroll_id) {
        conn.release();
        return res.status(400).json({ error: 'payroll_id es requerido' });
      }

      await conn.beginTransaction();

      const [periodRows] = await conn.query(`
        SELECT id, period_name, 
               DATE_FORMAT(start_date, '%Y-%m-%d') as start_date, 
               DATE_FORMAT(end_date, '%Y-%m-%d') as end_date, 
               total_empleados, total_neto, total_ingresos, total_descuentos,
               status, sucursal, departamento, is_immutable,
               DATE_FORMAT(approved_at, '%Y-%m-%d %H:%i:%s') as approved_at,
               approved_by, snapshot_json
        FROM payroll_periods WHERE id = ?
      `, [payroll_id]);
      if (periodRows.length === 0) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ error: 'Período no encontrado' });
      }

      const period = periodRows[0];
      if (period.status === 'Aprobada' || period.is_immutable === 1) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: 'Esta nómina ya ha sido aprobada previamente' });
      }

      const startDate = period.start_date ? String(period.start_date).split('T')[0] : '';
      const endDate = period.end_date ? String(period.end_date).split('T')[0] : '';

      const [items] = await conn.query('SELECT * FROM payroll_items WHERE payroll_id = ? ORDER BY id ASC', [payroll_id]);

      const snapshot = {
        period: period,
        items: items.map(it => ({
          ...it,
          detalles_json: typeof it.detalles_json === 'string' ? JSON.parse(it.detalles_json || '{}') : (it.detalles_json || {})
        })),
        approved_at: new Date().toISOString(),
        approved_by: approved_by
      };

      // A. Congelar período como Aprobado e Inmutable
      await conn.query(`
        UPDATE payroll_periods 
        SET status = 'Aprobada', approved_at = NOW(), approved_by = ?, is_immutable = 1, snapshot_json = ?
        WHERE id = ?
      `, [approved_by, JSON.stringify(snapshot), payroll_id]);

      // B. Saldar automáticamente todos los descuentos aplicados en este período para los colaboradores de la nómina
      if (startDate && endDate && items.length > 0) {
        // En employee_discounts la columna employee_id es de tipo INT
        const numericEmpIds = Array.from(new Set(
          items
            .map(it => {
              const raw = String(it.employee_id || '').replace(/\D/g, '');
              return raw ? parseInt(raw, 10) : null;
            })
            .filter(id => id !== null && !isNaN(id) && id > 0)
        ));
        const empNames = Array.from(new Set(items.map(it => it.employee_name).filter(Boolean)));

        if (numericEmpIds.length > 0 || empNames.length > 0) {
          const discountConditions = [];
          const discountParams = [payroll_id, payroll_id, startDate, endDate];

          if (numericEmpIds.length > 0 && empNames.length > 0) {
            discountConditions.push('(employee_id IN (?) OR employee_name IN (?))');
            discountParams.push(numericEmpIds, empNames);
          } else if (numericEmpIds.length > 0) {
            discountConditions.push('employee_id IN (?)');
            discountParams.push(numericEmpIds);
          } else if (empNames.length > 0) {
            discountConditions.push('employee_name IN (?)');
            discountParams.push(empNames);
          }

          await conn.query(`
            UPDATE employee_discounts 
            SET status = 'Saldado', 
                notes = CASE 
                  WHEN notes IS NULL OR notes = '' THEN CONCAT('Liquidado en Nómina ID #', ?) 
                  ELSE CONCAT(notes, ' [Liquidado en Nómina ID #', ?, ']') 
                END
            WHERE date BETWEEN ? AND ? 
              AND (status != 'Anulado' OR status IS NULL) 
              AND status != 'Saldado'
              AND ${discountConditions.join(' AND ')}
          `, discountParams);
        }

        // C. Marcar comisiones del período como Pagadas para los colaboradores de la nómina
        // En employee_commissions_log la columna employee_id es VARCHAR(50)
        const commEmpIds = Array.from(new Set([
          ...numericEmpIds.map(String),
          ...numericEmpIds.map(id => `EMP-${id}`)
        ]));

        if (commEmpIds.length > 0 || empNames.length > 0) {
          const commConditions = [];
          const commParams = [`${startDate} 00:00:00`, `${endDate} 23:59:59`];

          if (commEmpIds.length > 0 && empNames.length > 0) {
            commConditions.push('(employee_id IN (?) OR employee_name IN (?))');
            commParams.push(commEmpIds, empNames);
          } else if (commEmpIds.length > 0) {
            commConditions.push('employee_id IN (?)');
            commParams.push(commEmpIds);
          } else if (empNames.length > 0) {
            commConditions.push('employee_name IN (?)');
            commParams.push(empNames);
          }

          await conn.query(`
            UPDATE employee_commissions_log 
            SET status = 'Pagada'
            WHERE created_at >= ? AND created_at <= ? 
              AND (status != 'Anulada' OR status IS NULL) 
              AND status != 'Pagada'
              AND ${commConditions.join(' AND ')}
          `, commParams);
        }
      }

      // D. Registrar en auditoría
      await conn.query(`
        INSERT INTO payroll_audit_logs (payroll_id, field_name, old_value, new_value, action_type, reason, user_name)
        VALUES (?, 'ESTADO_NOMINA', 'En preparación', 'Aprobada', 'Aprobación Definitiva', 'Nómina aprobada e inmutable. Descuentos saldados y comisiones liquidadas.', ?)
      `, [payroll_id, approved_by]);

      await conn.commit();

      res.json({
        success: true,
        message: 'Nómina aprobada exitosamente. Se han saldado los descuentos y liquidado las comisiones de los colaboradores para este período.'
      });
    } catch (err) {
      await conn.rollback();
      console.error('[PAYROLL APPROVE ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    } finally {
      conn.release();
    }
  });

  // 6.1 Sincronizar datos reales de comisiones y descuentos en tiempo real para un borrador (Con Transacción ACID)
  router.post('/periods/:id/sync-real-data', async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const { id } = req.params;

      await conn.beginTransaction();

      const [periodRows] = await conn.query(`
        SELECT id, period_name, 
               DATE_FORMAT(start_date, '%Y-%m-%d') as start_date, 
               DATE_FORMAT(end_date, '%Y-%m-%d') as end_date,
               total_empleados, total_neto, total_ingresos, total_descuentos,
               status, sucursal, departamento, is_immutable,
               DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at,
               DATE_FORMAT(approved_at, '%Y-%m-%d %H:%i:%s') as approved_at,
               approved_by
        FROM payroll_periods WHERE id = ?
      `, [id]);
      if (periodRows.length === 0) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ error: 'Período no encontrado' });
      }

      const period = periodRows[0];
      if (period.status === 'Aprobada' || period.is_immutable === 1) {
        await conn.rollback();
        conn.release();
        return res.status(403).json({ error: 'Esta nómina ya está aprobada y es inmutable' });
      }

      const startDate = period.start_date ? String(period.start_date).split('T')[0] : '';
      const endDate = period.end_date ? String(period.end_date).split('T')[0] : '';

      // Obtener lista de personal según filtros del período
      let staffQuery = "SELECT * FROM staff_records WHERE (status = 'Activo' OR status = 'Active' OR status IS NULL)";
      const staffParams = [];
      if (period.sucursal && period.sucursal !== 'Todas') {
        const sucLower = String(period.sucursal).toLowerCase();
        if (sucLower.includes('disponible')) {
          staffQuery += " AND (salon_id = 6 OR localidad LIKE '%disponible%')";
        } else if (sucLower.includes('villa mella') || sucLower.includes('mella')) {
          staffQuery += " AND (salon_id IN (2, 4) OR localidad LIKE '%mella%')";
        } else if (sucLower.includes('san vicente') || sucLower.includes('vicente')) {
          staffQuery += " AND (salon_id = 1 OR localidad LIKE '%vicente%')";
        } else {
          staffQuery += " AND (salon_id = ? OR localidad LIKE ?)";
          staffParams.push(period.sucursal, `%${period.sucursal}%`);
        }
      }
      if (period.departamento && period.departamento !== 'Todos') {
        staffQuery += " AND (posicion LIKE ?)";
        staffParams.push(`%${period.departamento}%`);
      }
      let [staffList] = await conn.query(staffQuery, staffParams);

      if (staffList.length === 0) {
        // Fallback a los items existentes en payroll_items
        const [existingItems] = await conn.query('SELECT * FROM payroll_items WHERE payroll_id = ?', [id]);
        staffList = existingItems.map(it => ({
          id: it.employee_id,
          nombre: it.employee_name,
          posicion: it.posicion,
          localidad: it.sucursal,
          salario_base: it.salario_fijo ? parseFloat(it.salario_fijo) * 2 : 20000
        }));
      }

      // Eliminar items previos y recalcular de forma 100% real
      await conn.query('DELETE FROM payroll_items WHERE payroll_id = ?', [id]);

      let sumTotalIngresos = 0;
      let sumTotalDescuentos = 0;
      let sumTotalNeto = 0;
      const generatedItems = [];
      // Pre-cargar configuración salarial, feriados, comisiones, descuentos, horario y ponches una sola vez para todo el lote
      const batchContext = await preloadPayrollBatchContext(conn, startDate, endDate);

      for (const emp of staffList) {
        const itemData = await calculateEmployeePayrollValues(pool, emp, startDate, endDate, batchContext);
        itemData.payroll_id = parseInt(id);
        generatedItems.push(itemData);

        sumTotalIngresos += itemData.total_ingresos;
        sumTotalDescuentos += itemData.total_descuentos;
        sumTotalNeto += itemData.neto_pagar;
      }

      if (generatedItems.length > 0) {
        const insertValues = generatedItems.map(itemData => [
          itemData.payroll_id, itemData.employee_id, itemData.employee_name, itemData.posicion, itemData.sucursal, itemData.departamento,
          itemData.salario_fijo, itemData.comisiones, itemData.feriados, itemData.horas_extras, (itemData.descanso || 0), itemData.otros_ingresos, itemData.total_ingresos,
          itemData.tss, itemData.servicios, itemData.prestamos, itemData.ausencias, itemData.tardanzas, itemData.otros_descuentos, itemData.total_descuentos,
          itemData.neto_pagar, JSON.stringify(itemData.detalles_json)
        ]);

        await conn.query(`
          INSERT INTO payroll_items (
            payroll_id, employee_id, employee_name, posicion, sucursal, departamento,
            salario_fijo, comisiones, feriados, horas_extras, descanso, otros_ingresos, total_ingresos,
            tss, servicios, prestamos, ausencias, tardanzas, otros_descuentos, total_descuentos,
            neto_pagar, detalles_json
          ) VALUES ?
        `, [insertValues]);

        const [insertedRows] = await conn.query('SELECT * FROM payroll_items WHERE payroll_id = ? ORDER BY id ASC', [id]);
        generatedItems.length = 0;
        insertedRows.forEach(r => generatedItems.push({
          ...r,
          detalles_json: typeof r.detalles_json === 'string' ? JSON.parse(r.detalles_json || '{}') : (r.detalles_json || {})
        }));
      }

      await conn.query(`
        UPDATE payroll_periods 
        SET total_ingresos = ?, total_descuentos = ?, total_neto = ?, total_empleados = ?
        WHERE id = ?
      `, [sumTotalIngresos, sumTotalDescuentos, sumTotalNeto, generatedItems.length, id]);

      await conn.query(`
        INSERT INTO payroll_audit_logs (payroll_id, field_name, old_value, new_value, action_type, reason, user_name)
        VALUES (?, 'SINCRONIZACION_DATOS', 'Anterior', 'Datos Reales', 'Sincronización', 'Sincronización automática de comisiones y descuentos en tiempo real', 'Administrador')
      `, [id]);

      await conn.commit();

      res.json({
        success: true,
        message: 'Datos reales de comisiones y descuentos sincronizados exitosamente',
        period: {
          ...period,
          total_ingresos: sumTotalIngresos,
          total_descuentos: sumTotalDescuentos,
          total_neto: sumTotalNeto,
          total_empleados: generatedItems.length
        },
        items: generatedItems
      });
    } catch (err) {
      await conn.rollback();
      console.error('[PAYROLL SYNC REAL DATA ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    } finally {
      conn.release();
    }
  });

  // 7. Consultar Historial de Auditoría de la Nómina
  router.get('/audit-logs/:payroll_id', async (req, res) => {
    try {
      const { payroll_id } = req.params;
      const [rows] = await pool.query(`
        SELECT * FROM payroll_audit_logs 
        WHERE payroll_id = ? 
        ORDER BY id DESC
      `, [payroll_id]);
      res.json(rows);
    } catch (err) {
      console.error('[PAYROLL AUDIT LOGS ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 8. Eliminar Período de Nómina (Protegido contra borrado de períodos aprobados con Transacción ACID)
  router.delete('/periods/:id', async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const { id } = req.params;

      await conn.beginTransaction();

      const [periods] = await conn.query('SELECT id, period_name, status, is_immutable FROM payroll_periods WHERE id = ?', [id]);
      if (periods.length > 0 && (periods[0].status === 'Aprobada' || periods[0].is_immutable === 1)) {
        await conn.rollback();
        conn.release();
        return res.status(403).json({ error: 'Esta nómina ya ha sido aprobada y es inmutable. No se puede eliminar para proteger el historial contable.' });
      }

      await conn.query('DELETE FROM payroll_items WHERE payroll_id = ?', [id]);
      await conn.query('DELETE FROM payroll_periods WHERE id = ?', [id]);

      await conn.commit();

      res.json({ success: true, message: 'Período de nómina eliminado correctamente' });
    } catch (err) {
      await conn.rollback();
      console.error('[PAYROLL DELETE ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    } finally {
      conn.release();
    }
  });

  // 9. Cálculo y Reporte de Regalías del Año (Salario de Navidad Ley 16-92 RD con Datos Históricos Reales)
  router.get('/regalias/:year', async (req, res) => {
    try {
      const year = parseInt(req.params.year) || new Date().getFullYear();

      let [staffList] = await pool.query("SELECT * FROM staff_records WHERE (status = 'Activo' OR status = 'Active' OR status IS NULL)");
      if (staffList.length === 0) {
        staffList = [
          { id: '1', nombre: 'Ana Pérez', posicion: 'Estilista', localidad: 'San Vicente', salario_base: 20000.00 },
          { id: '2', nombre: 'Carlos Gómez', posicion: 'Barbero', localidad: 'San Vicente', salario_base: 24000.00 },
          { id: '3', nombre: 'María López', posicion: 'Manicurista', localidad: 'Villa Mella', salario_base: 19000.00 },
          { id: '4', nombre: 'Luis Martínez', posicion: 'Recepción', localidad: 'San Vicente', salario_base: 22000.00 },
          { id: '5', nombre: 'Karla Ruiz', posicion: 'Estilista', localidad: 'Villa Mella', salario_base: 20000.00 },
          { id: '6', nombre: 'José Fernández', posicion: 'Soporte', localidad: 'San Vicente', salario_base: 28000.00 },
          { id: '7', nombre: 'Patricia Santos', posicion: 'Administración', localidad: 'Villa Mella', salario_base: 32000.00 },
          { id: '8', nombre: 'David Peña', posicion: 'Barbero', localidad: 'Villa Mella', salario_base: 23000.00 },
          { id: '9', nombre: 'Sofía Castro', posicion: 'Estilista', localidad: 'San Vicente', salario_base: 19600.00 },
          { id: '10', nombre: 'Miguel Rojas', posicion: 'Mantenimiento', localidad: 'Villa Mella', salario_base: 26000.00 }
        ];
      }

      // Consultar historial real de nóminas aprobadas del año agrupadas por colaborador y mes
      let approvedYearItems = [];
      try {
        const [rows] = await pool.query(`
          SELECT 
            i.employee_id,
            i.employee_name,
            MONTH(p.start_date) as mes_num,
            COALESCE(SUM(i.salario_fijo), 0) as total_fijo,
            COALESCE(SUM(i.comisiones), 0) as total_comisiones,
            COALESCE(SUM(i.horas_extras), 0) as total_horas_extras,
            COALESCE(SUM(i.feriados), 0) as total_feriados,
            COALESCE(SUM(i.otros_ingresos), 0) as total_otros_ingresos,
            COALESCE(SUM(i.total_ingresos), 0) as total_mes
          FROM payroll_items i
          JOIN payroll_periods p ON p.id = i.payroll_id
          WHERE (p.status = 'Aprobada' OR p.is_immutable = 1)
            AND YEAR(p.start_date) = ?
          GROUP BY i.employee_id, i.employee_name, MONTH(p.start_date)
        `, [year]);
        approvedYearItems = rows;
      } catch (dbErr) {
        console.warn('[REGALIAS APPROVED QUERY WARN]:', dbErr.message);
      }

      const itemsMap = new Map();
      approvedYearItems.forEach(r => {
        itemsMap.set(`${r.employee_id}_${r.mes_num}`, r);
        itemsMap.set(`${r.employee_name}_${r.mes_num}`, r);
      });

      const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      const regaliasList = [];
      let granTotalAcumulado = 0;
      let granTotalRegalias = 0;

      for (const emp of staffList) {
        const empId = String(emp.id);
        const empName = emp.nombre || 'Colaborador';
        const baseMensual = parseFloat(emp.salario_base || 20000.00);

        const desglose = [];
        let totalAcumulado = 0;
        let mesesTrabajados = 0;

        for (let m = 0; m < 12; m++) {
          const mesNum = m + 1;
          const matchReal = itemsMap.get(`${empId}_${mesNum}`) || itemsMap.get(`${empName}_${mesNum}`);

          if (matchReal) {
            const totFijo = parseFloat(matchReal.total_fijo || 0);
            const totComm = parseFloat(matchReal.total_comisiones || 0);
            const totExtras = parseFloat(matchReal.total_horas_extras || 0) + parseFloat(matchReal.total_feriados || 0);
            const totMes = parseFloat(matchReal.total_mes || (totFijo + totComm + totExtras));
            desglose.push({
              mes: meses[m],
              mes_numero: mesNum,
              salario_ordinario: totFijo,
              comisiones: totComm,
              horas_extras_feriados: totExtras,
              total_mes: totMes,
              origen: 'Real (Nómina Aprobada)'
            });
            totalAcumulado += totMes;
            mesesTrabajados++;
          } else {
            // Proyección realista con salario ordinario base para meses no liquidados aún
            const comisionEstimada = Math.round(baseMensual * 0.25);
            const salarioMes = baseMensual + comisionEstimada;
            desglose.push({
              mes: meses[m],
              mes_numero: mesNum,
              salario_ordinario: baseMensual,
              comisiones: comisionEstimada,
              horas_extras_feriados: 0,
              total_mes: salarioMes,
              origen: 'Proyección Salario Base'
            });
            totalAcumulado += salarioMes;
            mesesTrabajados++;
          }
        }

        const montoRegalia = Number((totalAcumulado / 12).toFixed(2));
        granTotalAcumulado += totalAcumulado;
        granTotalRegalias += montoRegalia;

        regaliasList.push({
          year,
          employee_id: empId,
          employee_name: empName,
          posicion: emp.posicion || 'Estilista',
          sucursal: emp.localidad || (emp.salon_id == 2 ? 'Villa Mella' : 'San Vicente'),
          salario_base_mensual: baseMensual,
          meses_trabajados: mesesTrabajados,
          total_acumulado_anual: totalAcumulado,
          monto_regalia: montoRegalia,
          desglose_mensual: desglose,
          status: 'Calculada'
        });
      }

      res.json({
        year,
        total_empleados: regaliasList.length,
        gran_total_acumulado: Number(granTotalAcumulado.toFixed(2)),
        gran_total_regalias: Number(granTotalRegalias.toFixed(2)),
        regalias: regaliasList
      });
    } catch (err) {
      console.error('[REGALIAS CALCULATION ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 10. Conceptos de Nómina
  router.get('/concepts', async (req, res) => {
    try {
      const [rows] = await pool.query('SELECT * FROM payroll_concepts WHERE activo = 1 ORDER BY id ASC');
      if (rows.length === 0) {
        return res.json([
          { id: 1, tipo: 'Ingreso', nombre: 'Salario fijo', formula_tipo: 'Fijo', porcentaje: 0 },
          { id: 2, tipo: 'Ingreso', nombre: 'Comisiones', formula_tipo: 'Variable', porcentaje: 0 },
          { id: 3, tipo: 'Ingreso', nombre: 'Feriados', formula_tipo: 'Fijo', porcentaje: 0 },
          { id: 4, tipo: 'Ingreso', nombre: 'Horas extras', formula_tipo: 'Variable', porcentaje: 0 },
          { id: 5, tipo: 'Ingreso', nombre: 'Otros ingresos', formula_tipo: 'Fijo', porcentaje: 0 },
          { id: 6, tipo: 'Descuento', nombre: 'TSS', formula_tipo: 'Porcentaje', porcentaje: 5.91 },
          { id: 7, tipo: 'Descuento', nombre: 'Servicios', formula_tipo: 'Variable', porcentaje: 0 },
          { id: 8, tipo: 'Descuento', nombre: 'Préstamos', formula_tipo: 'Fijo', porcentaje: 0 },
          { id: 9, tipo: 'Descuento', nombre: 'Ausencias', formula_tipo: 'Variable', porcentaje: 0 },
          { id: 10, tipo: 'Descuento', nombre: 'Tardanzas', formula_tipo: 'Variable', porcentaje: 0 },
          { id: 11, tipo: 'Descuento', nombre: 'Otros desc.', formula_tipo: 'Fijo', porcentaje: 0 }
        ]);
      }
      res.json(rows);
    } catch (err) {
      console.error('[PAYROLL CONCEPTS GET ERROR]:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createPayrollRouter };
