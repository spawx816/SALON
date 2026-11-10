/**
 * Distributed Lock Service
 * (backend/services/distributed_lock.service.cjs)
 * 
 * Prevents split-brain worker execution across cluster instances or multi-process PM2.
 * Supports TTL lease expiration so crashed workers do not lock jobs permanently.
 */

'use strict';

class InMemoryDistributedLock {
  constructor(options = {}) {
    this._locks = new Map(); // key -> { ownerId, expiresAt }
    this._clock = options.clock || { now: () => new Date() };
  }

  async acquire(lockKey, ttlMs = 30000, ownerId = 'default_worker') {
    const key = String(lockKey);
    const now = new Date(this._clock.now()).getTime();
    const existing = this._locks.get(key);

    if (existing) {
      if (existing.expiresAt > now) {
        if (existing.ownerId === ownerId) {
          // Re-entrant / lease extension by same owner
          existing.expiresAt = now + ttlMs;
          return true;
        }
        // Lock currently held by another worker
        return false;
      }
      // Expired lease: allow reclaim
    }

    this._locks.set(key, {
      ownerId,
      expiresAt: now + ttlMs
    });
    return true;
  }

  async release(lockKey, ownerId = 'default_worker') {
    const key = String(lockKey);
    const existing = this._locks.get(key);
    if (!existing) return true;

    if (existing.ownerId === ownerId) {
      this._locks.delete(key);
      return true;
    }

    return false; // Cannot release lock owned by someone else
  }

  async isLocked(lockKey) {
    const key = String(lockKey);
    const now = new Date(this._clock.now()).getTime();
    const existing = this._locks.get(key);
    if (!existing) return false;
    if (existing.expiresAt <= now) {
      this._locks.delete(key);
      return false;
    }
    return true;
  }

  async clear() {
    this._locks.clear();
  }
}

module.exports = {
  InMemoryDistributedLock
};

