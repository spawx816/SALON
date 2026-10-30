/**
 * Configuración oficial del Módulo de Inteligencia de Negocios
 * Catálogo vigente de 30 reportes aprobados (12 de octubre de 2026)
 * Basado en la Guía para el Desarrollador de Salon Pro & Plan Beauty RD
 */

export const BI_CATEGORIES = [
  {
    id: 'sales',
    name: 'Ventas y cobros',
    iconName: 'TrendingUp',
    description: 'Facturación, cobros, medios de pago, impuestos y análisis de compras',
    count: 13
  },
  {
    id: 'clients',
    name: 'Clientes',
    iconName: 'Users',
    description: 'Frecuencia, retención, canjes de membresía, inactividad y cumpleaños',
    count: 7
  },
  {
    id: 'memberships',
    name: 'Membresías',
    iconName: 'CreditCard',
    description: 'Cobros recurrentes, renovaciones contractuales y recuperación de fallidos',
    count: 5
  },
  {
    id: 'team',
    name: 'Equipo y nómina',
    iconName: 'UserCheck',
    description: 'Ingresos vs. comisiones, productividad, horas extras y asistencia',
    count: 5
  }
];

export const BI_REPORTS_BY_CATEGORY = {
  sales: [
    {
      id: 'sales_summary',
      name: 'Resumen de ventas y cobros',
      chartType: 'sales_evolution',
      description: 'Presenta facturación, total cobrado, cantidad de facturas válidas y ticket promedio.',
      note: 'Distingue las ventas del período de los pagos recibidos, incluidos cobros de facturas anteriores. Excluye facturas anuladas.'
    },
    {
      id: 'sales_by_product',
      name: 'Ventas por producto o servicio',
      chartType: 'bar',
      description: 'Muestra cantidades vendidas y monto generado por cada producto o servicio.',
      note: 'Permite identificar los ítems más vendidos y su participación en la facturación total.'
    },
    {
      id: 'sales_by_salon',
      name: 'Ventas por sucursal',
      chartType: 'bar',
      description: 'Compara las ventas de las sucursales e indica cuánto representa cada una sobre el total de la empresa.'
    },
    {
      id: 'sales_by_client',
      name: 'Ventas por cliente',
      chartType: 'bar',
      description: 'Detalla las ventas realizadas a cada cliente y permite identificar quiénes compran más y cuánto gastan.'
    },
    {
      id: 'payment_methods',
      name: 'Cobros por método de pago',
      chartType: 'donut',
      description: 'Desglosa los cobros recibidos en efectivo, tarjeta, transferencia y otros métodos con su participación.'
    },
    {
      id: 'accounts_receivable',
      name: 'Cuentas por cobrar',
      chartType: 'bar',
      description: 'Muestra saldos pendientes por cliente, facturas relacionadas y vencimientos para dar seguimiento a los cobros.'
    },
    {
      id: 'cancelled_tickets',
      name: 'Tickets cancelados',
      chartType: 'table_only',
      description: 'Detalla los tickets cancelados antes de facturar, con fecha, motivo y usuario responsable.'
    },
    {
      id: 'voided_invoices',
      name: 'Facturas anuladas',
      chartType: 'table_only',
      description: 'Registra las facturas anuladas, su monto, fecha, motivo y usuario responsable para facilitar su seguimiento.'
    },
    {
      id: 'applied_discounts',
      name: 'Descuentos aplicados',
      chartType: 'bar',
      description: 'Detalla descuentos por cliente y producto o servicio, con sus montos y el usuario que los autorizó.'
    },
    {
      id: 'cash_membership_payments',
      name: 'Pago en efectivo de membresía',
      chartType: 'table_only',
      description: 'Detalla pagos de membresías recibidos en efectivo: fecha, cliente, membresía, monto, sucursal y usuario receptor.'
    },
    {
      id: 'sales_itbis',
      name: 'ITBIS en ventas',
      chartType: 'bar',
      description: 'Presenta ventas gravadas y exentas, base imponible por tasa, ITBIS facturado, ajustes por notas de crédito y débito e ITBIS neto.',
      note: 'Cumple con el marco fiscal de la DGII. Evita duplicar el efecto de anulaciones y notas de crédito.'
    },
    {
      id: 'avg_spend_per_client',
      name: 'Consumo promedio por cliente',
      chartType: 'comparison',
      description: 'Muestra cuánto consume, en promedio, cada cliente único atendido durante el período.',
      note: 'Fórmula: Total facturado válido ÷ Clientes únicos atendidos. Distingue crecimiento por más personas de crecimiento por mayor ticket.'
    },
    {
      id: 'joint_purchases',
      name: 'Comportamiento de compra conjunta',
      chartType: 'bar',
      description: 'Identifica productos y servicios adquiridos juntos en una misma visita para diseño de paquetes y venta cruzada.'
    }
  ],

  clients: [
    {
      id: 'clients_summary',
      name: 'Resumen de clientes',
      chartType: 'bar',
      description: 'Muestra clientes únicos atendidos, cantidad de visitas, nuevos y recurrentes con desglose por sucursal.',
      note: 'Distingue clientes únicos de visitas. Un cliente con 4 visitas cuenta como 1 cliente y 4 visitas.'
    },
    {
      id: 'visit_frequency',
      name: 'Frecuencia de visitas',
      chartType: 'frequency_interactive',
      hasMembershipFilter: true,
      description: 'Agrupa clientes por cantidad de visitas (0, 1, 2, 3, 4 y 5+) con comparación porcentual y detalle interactivo.',
      alertInfo: 'Solo cuenta Lavado sencillo. Una visita cuenta una sola vez, aunque incluya varios servicios. Sin duplicados por servicios o facturas de la misma visita.',
      note: 'Base: clientes con membresía activa durante el período seleccionado. Abre por defecto con Clientes con 0 visitas.'
    },
    {
      id: 'inactive_clients',
      name: 'Clientes inactivos',
      chartType: 'table_only',
      hasDaysFilter: true,
      description: 'Identifica clientes que llevan un tiempo configurable sin visitar (última visita, días de ausencia y WhatsApp directo).'
    },
    {
      id: 'new_clients_followup',
      name: 'Seguimiento de clientes nuevos',
      chartType: 'bar',
      hasCohortWindowFilter: true,
      description: 'Evalúa el retorno dentro de un plazo configurable desde la primera visita (Regresó, Sin regreso hasta ahora, No regresó).'
    },
    {
      id: 'membership_redemptions',
      name: 'Canje de membresía',
      chartType: 'bar',
      description: 'Detalla beneficios utilizados por cliente, membresía, fecha y sucursal, incluyendo miembros con cero canjes.'
    },
    {
      id: 'client_birthdays',
      name: 'Cumpleaños de clientes',
      chartType: 'table_only',
      description: 'Lista los clientes que cumplen años en el período seleccionado, con datos de contacto para felicitaciones y campañas.'
    },
    {
      id: 'membership_cancellations',
      name: 'Cancelaciones de membresía',
      chartType: 'donut',
      hasReasonFilter: true,
      description: 'Detalla cliente, membresía, fecha efectiva, sucursal, motivo estandarizado, antigüedad, último lavado y contacto.',
      note: 'Suspensiones y cobros fallidos no se consideran cancelaciones de manera automática.'
    }
  ],

  memberships: [
    {
      id: 'memberships_summary',
      name: 'Resumen de membresías',
      chartType: 'bar',
      description: 'Muestra membresías por estado, nuevas altas, reactivaciones, cancelaciones e importe mensual contratado de las activas.',
      note: 'El importe mensual contratado representa proyección potencial, no dinero cobrado.'
    },
    {
      id: 'upcoming_charges',
      name: 'Próximos cobros',
      chartType: 'table_only',
      description: 'Lista cobros programados con cliente, membresía, sucursal, fecha y monto previsto para anticipar flujos.'
    },
    {
      id: 'recurring_charges_result',
      name: 'Resultado de cobros recurrentes',
      chartType: 'donut',
      description: 'Muestra cobros aprobados, rechazados y pendientes con tasa de éxito sobre cobros únicos.'
    },
    {
      id: 'declined_charges_recovery',
      name: 'Cobros rechazados y recuperación',
      chartType: 'table_only',
      description: 'Detalla días de atraso, reintentos, código real del procesador y distinción de cobros recuperados vs. pendientes.',
      note: 'Varios reintentos de una misma cuota representan una sola deuda; no se duplican obligaciones.'
    },
    {
      id: 'contracts_upcoming_renewal',
      name: 'Membresías próximas a renovación',
      chartType: 'table_only',
      hasHorizonFilter: true,
      description: 'Identifica contratos próximos a renovarse automáticamente (próximos 30, 60 o 90 días).'
    }
  ],

  team: [
    {
      id: 'income_vs_commissions',
      name: 'Ingresos vs. comisiones',
      chartType: 'bar',
      description: 'Compara ingresos y comisiones generadas, porcentaje sobre facturación y evolución para prevenir descalces.',
      note: 'Ingresos menos comisiones se rotula estrictamente como margen bruto antes de gastos fijos; no equivale a utilidad neta.'
    },
    {
      id: 'income_vs_payroll',
      name: 'Ingresos vs. nómina total',
      chartType: 'bar',
      description: 'Muestra cuánto representa la nómina por cada RD$100 de ingresos con desglose de sueldos, comisiones, bonos y horas extras.'
    },
    {
      id: 'employee_productivity',
      name: 'Productividad por empleado',
      chartType: 'bar',
      hasEmployeeFilter: true,
      description: 'Relaciona ingresos atribuibles, servicios realizados y unidades vendidas contra horas trabajadas.'
    },
    {
      id: 'overtime_vs_results',
      name: 'Horas extras vs. resultados',
      chartType: 'bar',
      description: 'Relaciona horas extras y su costo con la facturación y afluencia de las mismas fechas y horarios.'
    },
    {
      id: 'attendance_trends',
      name: 'Tendencias de asistencia',
      chartType: 'bar',
      hasEmployeeFilter: true,
      description: 'Muestra recurrencia de incidencias, horas de cobertura perdidas y distinción de ausencias justificadas vs. incumplimientos.'
    }
  ]
};

export const PERIOD_OPTIONS = [
  { id: 'this_month', label: 'Este mes' },
  { id: 'today', label: 'Hoy' },
  { id: 'yesterday', label: 'Ayer' },
  { id: 'this_week', label: 'Esta semana' },
  { id: 'last_month', label: 'Mes pasado' },
  { id: 'last_30_days', label: 'Últimos 30 días' },
  { id: 'this_year', label: 'Este año' },
  { id: 'custom', label: 'Personalizado' }
];

export const CANCELLATION_REASONS = [
  'Todos los motivos',
  'Precio / Costo',
  'Poco uso / Sin tiempo',
  'Inconformidad con el servicio',
  'Mudanza / Cambio de localidad',
  'Finanzas personales',
  'Otro motivo'
];

