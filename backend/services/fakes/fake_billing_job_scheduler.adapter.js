/**
 * Adaptador Simulado de Programador de Tareas (FakeBillingJobSchedulerAdapter)
 * Permite ejecutar y auditar tareas programadas de dunning y facturación de forma sincrónica y determinista en tests.
 */

const crypto = require('crypto');
const { BillingJobSchedulerPort } = require('../billing_job_scheduler.port');

class FakeBillingJobSchedulerAdapter extends BillingJobSchedulerPort {
  constructor() {
    super();
    this.jobs = []; // Array of job records
    this.locks = new Map(); // lockKey -> expiresAt
    this.processedJobIds = new Set();
    this.idempotencyKeys = new Set();
  }

  async acquireLock(lockKey, ttlMs = 10000) {
    const now = Date.now();
    const existing = this.locks.get(lockKey);
    if (existing && existing > now) {
      return false; // Bloqueo activo por otro worker
    }
    this.locks.set(lockKey, now + ttlMs);
    return true;
  }

  async releaseLock(lockKey) {
    this.locks.delete(lockKey);
  }

  async scheduleJob({ jobType, tenantId, runAt, payload = {}, idempotencyKey }) {
    if (!jobType) throw new Error('jobType es obligatorio');
    if (!tenantId) throw new Error('tenantId es obligatorio');
    if (!idempotencyKey) throw new Error('idempotencyKey es obligatoria para scheduleJob');

    if (this.idempotencyKeys.has(idempotencyKey)) {
      // Ignorar duplicados de forma idempotente
      return { scheduled: false, reason: 'IDEMPOTENT_DUPLICATE', idempotencyKey };
    }

    this.idempotencyKeys.add(idempotencyKey);
    const jobId = `job_${crypto.randomBytes(8).toString('hex')}`;
    const jobRecord = {
      id: jobId,
      jobType,
      tenantId,
      runAt: runAt ? new Date(runAt) : new Date(),
      payload,
      idempotencyKey,
      status: 'pending',
      attempts: 0,
      createdAt: new Date()
    };

    this.jobs.push(jobRecord);
    return { scheduled: true, jobId, jobRecord };
  }

  async processPendingJobs(handlers = {}) {
    const now = new Date();
    const results = [];

    // Filtrar trabajos pendientes cuyo runAt <= now
    const pending = this.jobs.filter(j => j.status === 'pending' && j.runAt <= now);

    for (const job of pending) {
      const lockKey = `lock:job:${job.tenantId}:${job.jobType}:${job.idempotencyKey}`;
      const acquired = await this.acquireLock(lockKey, 5000);
      if (!acquired) {
        results.push({ jobId: job.id, status: 'locked_by_other' });
        continue;
      }

      try {
        job.attempts += 1;
        const handler = handlers[job.jobType];
        if (typeof handler === 'function') {
          const res = await handler(job.payload, job);
          job.status = 'completed';
          job.completedAt = new Date();
          this.processedJobIds.add(job.id);
          results.push({ jobId: job.id, status: 'completed', result: res });
        } else {
          job.status = 'no_handler';
          results.push({ jobId: job.id, status: 'no_handler' });
        }
      } catch (err) {
        job.status = 'failed';
        job.lastError = err.message;
        results.push({ jobId: job.id, status: 'failed', error: err.message });
      } finally {
        await this.releaseLock(lockKey);
      }
    }

    return results;
  }
}

module.exports = {
  FakeBillingJobSchedulerAdapter
};

