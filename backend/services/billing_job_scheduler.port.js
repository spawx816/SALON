/**
 * Puerto del Programador de Tareas Asíncronas de Facturación (BillingJobSchedulerPort)
 * Desacopla la orquestación de reintentos, generación de facturas, vencimiento de gracia y dunning
 * del hilo de peticiones HTTP web.
 */

class BillingJobSchedulerPort {
  /**
   * Programa una tarea para ejecución futura o inmediata
   * @param {Object} params
   * @param {string} params.jobType - Tipo de trabajo (GENERATE_INVOICE, RETRY_CHARGE, CHECK_GRACE, etc.)
   * @param {string} params.tenantId - Tenant objetivo
   * @param {Date|string} params.runAt - Timestamp de ejecución
   * @param {Object} params.payload - Datos de contexto del trabajo
   * @param {string} params.idempotencyKey - Clave única de prevención de duplicados
   */
  async scheduleJob(params) {
    throw new Error('BillingJobSchedulerPort.scheduleJob debe ser implementado');
  }

  /**
   * Procesa las tareas pendientes despachando a los handlers registrados
   * @param {Object} handlers - Diccionario de funciones handler por jobType
   * @returns {Promise<Array>} Resumen de resultados de los trabajos ejecutados
   */
  async processPendingJobs(handlers) {
    throw new Error('BillingJobSchedulerPort.processPendingJobs debe ser implementado');
  }

  /**
   * Adquiere un bloqueo de concurrencia distribuido para evitar carreras entre workers
   * @param {string} lockKey
   * @param {number} ttlMs
   * @returns {Promise<boolean>}
   */
  async acquireLock(lockKey, ttlMs) {
    throw new Error('BillingJobSchedulerPort.acquireLock debe ser implementado');
  }

  /**
   * Libera un bloqueo de concurrencia
   * @param {string} lockKey
   */
  async releaseLock(lockKey) {
    throw new Error('BillingJobSchedulerPort.releaseLock debe ser implementado');
  }
}

module.exports = {
  BillingJobSchedulerPort
};

