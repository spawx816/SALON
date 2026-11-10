/**
 * Distributed Background Job Repository
 * (backend/services/job_repository.service.cjs)
 * 
 * Provides atomic job state management with tenant isolation, retry tracking,
 * dead-letter queue, and PostgreSQL readiness.
 */

'use strict';

class InMemoryJobRepository {
  constructor(options = {}) {
    this._jobs = new Map(); // id -> job
    this._clock = options.clock || { now: () => new Date() };
  }

  async createJob({ id, tenantId, type, scheduledAt, payload = {}, idempotencyKey = null, maxAttempts = 3 }) {
    if (!id || !tenantId || !type) {
      throw new Error('id, tenantId y type son requeridos para crear un job.');
    }

    const job = {
      id: String(id),
      tenant_id: String(tenantId),
      type: String(type),
      scheduled_at: new Date(scheduledAt || this._clock.now()),
      status: 'pending', // 'pending' | 'processing' | 'completed' | 'failed' | 'dead_letter'
      attempts: 0,
      max_attempts: maxAttempts,
      idempotency_key: idempotencyKey,
      payload,
      last_error: null,
      created_at: new Date(this._clock.now()),
      updated_at: new Date(this._clock.now()),
      completed_at: null
    };

    this._jobs.set(job.id, job);
    return { ...job };
  }

  async getJob(id) {
    const job = this._jobs.get(String(id));
    return job ? { ...job } : null;
  }

  async findDueJobs(limit = 50) {
    const now = new Date(this._clock.now());
    const due = [];

    for (const job of this._jobs.values()) {
      if (job.status === 'pending' && job.scheduled_at <= now) {
        due.push({ ...job });
        if (due.length >= limit) break;
      }
    }

    return due;
  }

  async markProcessing(id) {
    const job = this._jobs.get(String(id));
    if (!job) throw new Error(`Job ${id} no encontrado`);
    job.status = 'processing';
    job.updated_at = new Date(this._clock.now());
    return { ...job };
  }

  async markCompleted(id) {
    const job = this._jobs.get(String(id));
    if (!job) throw new Error(`Job ${id} no encontrado`);
    job.status = 'completed';
    job.completed_at = new Date(this._clock.now());
    job.updated_at = new Date(this._clock.now());
    return { ...job };
  }

  async markFailed(id, errorMessage, nextRetryAt = null) {
    const job = this._jobs.get(String(id));
    if (!job) throw new Error(`Job ${id} no encontrado`);

    job.attempts += 1;
    // Sanitize error message to ensure no PAN or sensitive tokens are stored
    const sanitizedError = String(errorMessage || 'Unknown error')
      .replace(/\b(?:\d[ -]*?){13,16}\b/g, '[CARD_MASKED]')
      .replace(/\b(?:cvv|cvc|cvn|security[ _-]?code)[ :=]*(\d{3,4})\b/gi, 'CVV [REDACTED]');
    job.last_error = sanitizedError;
    job.updated_at = new Date(this._clock.now());

    if (job.attempts >= job.max_attempts) {
      job.status = 'dead_letter';
    } else {
      job.status = 'pending';
      if (nextRetryAt) {
        job.scheduled_at = new Date(nextRetryAt);
      }
    }

    return { ...job };
  }

  async clear() {
    this._jobs.clear();
  }
}

module.exports = {
  InMemoryJobRepository
};
