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
    count: 11
  },
  {
    id: 'clients',
    name: 'Clientes',
    iconName: 'Users',
    description: 'Frecuencia, retención, canjes de membresía, inactividad y cumpleaños',
    count: 6
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
      description: 'Presenta facturación, total cobrado, cantidad de facturas válidas y cuadro totalizado por sucursal.',
      note: 'Cuadro inferior consolidado por sucursal con facturación, participación, ticket promedio y anulaciones.'
    },
    {
      id: 'sales_by_product',
      name: 'Ventas por producto o servicio',
      chartType: 'bar',
      description: 'Cantidad de ventas realizadas según el servicio vendido y porcentaje de participación sobre el total del catálogo.',
      note: 'Permite identificar los ítems más vendidos y su participación en la facturación total.'
    },
    {
      id: 'sales_by_client',
      name: 'Ventas por cliente (Mayor consumo)',
      chartType: 'bar',
      description: 'Facturas de mayor consumo ordenadas de mayor a menor con desglose por cliente.',
      note: 'Ordenadas de mayor a menor según el monto total consumido en el período.'
    },
    {
      id: 'payment_methods',
      name: 'Cobros por método de pago',
      chartType: 'donut',
      description: 'Desglose exacto en 4 métodos: Tarjeta, Efectivo, Cardnet auto y Transferencia (distribuyendo pagos mixtos).',
      note: 'Los cobros mixtos se desglosan proporcionalmente en sus métodos individuales.'
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
      description: 'Totalizado arriba por sucursales y motivos, y abajo el detalle completo de tickets cancelados antes de facturar.'
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
      description: 'Distribución de descuento por sucursal y detalle de cada transacción: precio base, descuento, precio final y usuario.',
      note: 'Permite auditar el uso de descuentos y promociones especiales en caja.'
    },
    {
      id: 'cash_membership_payments',
      name: 'Pagos en efectivo',
      chartType: 'table_only',
      description: 'Detalla todos los pagos recibidos en efectivo en caja (suscripciones, membresías y ventas): fecha, cliente, monto, sucursal y usuario receptor.'
    },
    {
      id: 'sales_itbis',
      name: 'ITBIS en ventas',
      chartType: 'bar',
      description: 'Reporte totalizado por sucursal: ventas gravadas, exentas, base imponible e ITBIS facturado y neto.'
    },
    {
      id: 'joint_purchases',
      name: 'Comportamiento de compra conjunta',
      chartType: 'bar',
      description: 'Identifica productos y servicios adquiridos juntos en una misma visita y factura: combinaciones, visitas y % sobre la base.'
    }
  ],

  clients: [
    {
      id: 'clients_summary',
      name: 'Estado de clientes',
      chartType: 'bar',
      description: 'Muestra clientes activos, clientes con falta de pago, membresías canceladas y clientes regulares/ocasionales.',
      note: 'Incluye socias con falta de pago (mora / reintentos pendientes).'
    },
    {
      id: 'visit_frequency',
      name: 'Frecuencia de visitas',
      chartType: 'frequency_interactive',
      hasMembershipFilter: true,
      description: 'Cantidad real de clientes que estuvieron activas o usaron el servicio durante el período, aun si luego fueron suspendidas o canceladas.',
      alertInfo: 'Solo cuenta Lavado sencillo. Una visita cuenta una sola vez, aunque incluya varios servicios. Sin duplicados por servicios o facturas de la misma visita.'
    },
    {
      id: 'inactive_clients',
      name: 'Clientes inactivos',
      chartType: 'table_only',
      hasDaysFilter: true,
      description: 'Identifica clientes que llevan un tiempo configurable sin visitar (última visita, días de ausencia y WhatsApp directo).'
    },
    {
      id: 'membership_redemptions',
      name: 'Canjes de membresía',
      chartType: 'bar',
      description: 'Arriba cuadro por sucursal (canjes, cobros y precio promedio de lavado); abajo detalle por cliente con canjes hechos, disponibles y pendientes.',
      note: 'Fórmula de costo promedio: Cobros de membresía ÷ Canjes realizados.'
    },
    {
      id: 'client_birthdays',
      name: 'Cumpleaños de clientes',
      chartType: 'table_only',
      description: 'Organizados por fecha de cumpleaños (próximos a cumplir), total del mes y quién usó el descuento de cumpleaños (precio base vs pagado).'
    },
    {
      id: 'membership_cancellations',
      name: 'Cancelación de membresía',
      chartType: 'donut',
      hasReasonFilter: true,
      description: 'Reporte por sucursal y detallado con la fecha visible de cancelación, usuario que canceló, cliente y plan.',
      note: 'Registra cancelaciones definitivas con auditoría de usuario y sucursal.'
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

