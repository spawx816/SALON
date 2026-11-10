/**
 * Standalone Billing Worker Service
 * (backend/workers/billing_worker.service.cjs)
 * 
 * Decoupled background execution engine for recurring SaaS subscriptions and salon billing.
 * Implements distributed locking, tenant isolation, dead-letter queuing, and exponential backoff.
 */

'use strict';

class BillingWorkerService {
  /**
   * @param {object} options
   * @param {import('../services/job_repository.service.cjs').InMemoryJobRepository} options.jobRepo
   * @param {import('../services/distributed_lock.service.cjs').InMemoryDistributedLock} options.distributedLock
   * @param {object} options.paymentGateway
   * @param {object} [options.clock]
   * @param {string} [options.workerId]
   */
  constructor({ jobRepo, distributedLock, paymentGateway, clock, workerId }) {
    if (!jobRepo || !distributedLock || !paymentGateway) {
      throw new Error('jobRepo, distributedLock y paymentGateway son obligatorios para BillingWorkerService.');
    }
    this.jobRepo = jobRepo;
    this.distributedLock = distributedLock;
    this.paymentGateway = paymentGateway;
    this.clock = clock || { now: () => new Date() };
    this.workerId = workerId || `worker_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.isProcessing = false;
  }

  /**
   * Processes a single batch of due jobs.
   * 
   * @returns {Promise<{ processed: number, succeeded: number, failed: number, locked: number }>}
   */
  async processBatch() {
    const dueJobs = await this.jobRepo.findDueJobs(50);
    const summary = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      locked: 0
    };

    for (const job of dueJobs) {
      const lockKey = `billing_job:${job.id}`;
      const acquired = await this.distributedLock.acquire(lockKey, 30000, this.workerId);

      if (!acquired) {
        summary.locked++;
        continue;
      }

      summary.processed++;
      try {
        await this.jobRepo.markProcessing(job.id);

        // Execute payment through payment gateway interface
        // Strictly sanitize: Never pass or log raw PAN/CVV
        const result = await this.paymentGateway.charge({
          tenantId: job.tenant_id,
          amountCents: job.payload?.amountCents || 0,
          currency: job.payload?.currency || 'DOP',
          cardToken: job.payload?.cardToken,
          idempotencyKey: job.idempotency_key || `job_tx_${job.id}`
        });

        if (result && result.success) {
          await this.jobRepo.markCompleted(job.id);
          summary.succeeded++;
        } else {
          throw new Error(result?.error || 'Rechazo de pasarela de pago');
        }
      } catch (err) {
        summary.failed++;
        // Calculate backoff: attempt 1 -> +60s, attempt 2 -> +300s, attempt 3 -> dead_letter
        const currentAttempts = job.attempts + 1;
        const backoffSeconds = currentAttempts === 1 ? 60 : 300;
        const nextRetryAt = new Date(new Date(this.clock.now()).getTime() + backoffSeconds * 1000);

        await this.jobRepo.markFailed(job.id, err.message, nextRetryAt);
      } finally {
        await this.distributedLock.release(lockKey, this.workerId);
      }
    }

    return summary;
  }
}

module.exports = {
  BillingWorkerService
};

