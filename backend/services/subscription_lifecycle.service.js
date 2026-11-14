/**
 * Servicio del Ciclo de Vida de Suscripciones SaaS (SubscriptionLifecycleService)
 * Gestiona la máquina de estados canónica (active, past_due, suspended, cancelled, expired),
 * las transiciones de plan, guardias de límites en downgrade y sincronización con Phase 2A.
 */

const {
  SAAS_PLANS,
  SUBSCRIPTION_STATUSES,
  DUNNING_POLICY
} = require('./saas_billing.constants');
const { DEFAULT_PLAN_LIMITS, LEGACY_PLAN_CODES } = require('./saas_catalog.constants');

class SubscriptionLifecycleService {
  constructor({
    subscriptionRepo,
    entitlementsRepo,
    billingRepo,
    billingService,
    jobScheduler,
    auditRepo
  }) {
    this.subscriptionRepo = subscriptionRepo;
    this.entitlementsRepo = entitlementsRepo;
    this.billingRepo = billingRepo;
    this.billingService = billingService;
    this.jobScheduler = jobScheduler;
    this.auditRepo = auditRepo;
  }

  async getSubscription(tenantId) {
    if (!tenantId) throw new Error('tenantId es obligatorio');
    const sub = await this.subscriptionRepo.findByTenantId(tenantId);
    if (!sub) return null;

    // Evaluación dinámica de expiración de gracia y fin de ciclo
    const now = typeof this.clock === 'function' ? this.clock() : new Date();
    let effectiveStatus = sub.status;

    if (sub.status === SUBSCRIPTION_STATUSES.PAST_DUE) {
      if (!sub.grace_period_until || new Date(sub.grace_period_until) <= now) {
        effectiveStatus = SUBSCRIPTION_STATUSES.SUSPENDED;
      }
    } else if (sub.status === SUBSCRIPTION_STATUSES.CANCELLED) {
      if (sub.current_period_end && new Date(sub.current_period_end) < now) {
        effectiveStatus = SUBSCRIPTION_STATUSES.EXPIRED;
      }
    } else if (sub.status === SUBSCRIPTION_STATUSES.ACTIVE) {
      if (sub.current_period_end && new Date(sub.current_period_end) < now) {
        effectiveStatus = SUBSCRIPTION_STATUSES.EXPIRED;
      }
    }

    return {
      ...sub,
      status: effectiveStatus,
      rawStatus: sub.status,
      isGraceActive: Boolean(sub.status === SUBSCRIPTION_STATUSES.PAST_DUE && sub.grace_period_until && new Date(sub.grace_period_until) > now)
    };
  }

  async handlePaymentFailure(tenantId, { invoiceId, failureCode, failureMessage }) {
    const sub = await this.subscriptionRepo.findByTenantId(tenantId);
    if (!sub) throw new Error(`Suscripción no encontrada para tenant: ${tenantId}`);

    const now = typeof this.clock === 'function' ? this.clock() : new Date();
    const graceUntil = new Date(now.getTime() + DUNNING_POLICY.GRACE_PERIOD_DAYS * 86400000);

    const updated = {
      ...sub,
      status: SUBSCRIPTION_STATUSES.PAST_DUE,
      grace_period_until: graceUntil.toISOString(),
      updated_at: now.toISOString()
    };

    if (this.subscriptionRepo.upsertSubscription) {
      await this.subscriptionRepo.upsertSubscription(tenantId, updated);
    } else if (this.subscriptionRepo.update) {
      await this.subscriptionRepo.update(tenantId, updated);
    } else if (this.subscriptionRepo.save) {
      await this.subscriptionRepo.save(updated);
    }

    // Programar trabajo de vencimiento de gracia
    if (this.jobScheduler) {
      await this.jobScheduler.scheduleJob({
        jobType: 'CHECK_GRACE_EXPIRATION',
        tenantId,
        runAt: graceUntil,
        payload: { tenantId, graceUntil: graceUntil.toISOString(), invoiceId },
        idempotencyKey: `grace_exp_${tenantId}_${graceUntil.getTime()}`
      });
    }

    // Registrar evento de auditoría
    if (this.billingRepo?.recordBillingEvent) {
      await this.billingRepo.recordBillingEvent({
        tenant_id: tenantId,
        event_type: 'SUBSCRIPTION_PAST_DUE',
        payload: { invoiceId, failureCode, failureMessage, graceUntil: graceUntil.toISOString() },
        idempotency_key: `evt_past_due_${tenantId}_${Date.now()}`
      });
    }

    return updated;
  }

  async handlePaymentSuccess(tenantId, { invoiceId, amountMinor, currency }) {
    const sub = await this.subscriptionRepo.findByTenantId(tenantId);
    if (!sub) return null;

    const now = typeof this.clock === 'function' ? this.clock() : new Date();
    const updated = {
      ...sub,
      status: SUBSCRIPTION_STATUSES.ACTIVE,
      grace_period_until: null,
      updated_at: now.toISOString()
    };

    if (this.subscriptionRepo.upsertSubscription) {
      await this.subscriptionRepo.upsertSubscription(tenantId, updated);
    } else if (this.subscriptionRepo.update) {
      await this.subscriptionRepo.update(tenantId, updated);
    } else if (this.subscriptionRepo.save) {
      await this.subscriptionRepo.save(updated);
    }

    if (this.billingRepo?.recordBillingEvent) {
      await this.billingRepo.recordBillingEvent({
        tenant_id: tenantId,
        event_type: 'SUBSCRIPTION_REACTIVATED',
        payload: { invoiceId, amountMinor: String(amountMinor), currency },
        idempotency_key: `evt_reactivated_${tenantId}_${Date.now()}`
      });
    }

    return updated;
  }

  async evaluateGraceExpiration(tenantId) {
    const sub = await this.subscriptionRepo.findByTenantId(tenantId);
    if (!sub) return null;

    if (sub.status === SUBSCRIPTION_STATUSES.PAST_DUE) {
      const now = typeof this.clock === 'function' ? this.clock() : new Date();
      if (!sub.grace_period_until || new Date(sub.grace_period_until) <= now) {
        const updated = {
          ...sub,
          status: SUBSCRIPTION_STATUSES.SUSPENDED,
          updated_at: now.toISOString()
        };
        if (this.subscriptionRepo.update) {
          await this.subscriptionRepo.update(tenantId, updated);
        } else if (this.subscriptionRepo.save) {
          await this.subscriptionRepo.save(updated);
        }

        if (this.billingRepo?.recordBillingEvent) {
          await this.billingRepo.recordBillingEvent({
            tenant_id: tenantId,
            event_type: 'SUBSCRIPTION_SUSPENDED_GRACE_EXPIRED',
            payload: { gracePeriodUntil: sub.grace_period_until },
            idempotency_key: `evt_suspended_${tenantId}_${Date.now()}`
          });
        }
        return updated;
      }
    }
    return sub;
  }

  async requestDowngrade(tenantId, { newPlan = LEGACY_PLAN_CODES.BASE, actorId }) {
    if (newPlan !== LEGACY_PLAN_CODES.BASE) {
      throw new Error('Solo se permite downgrade hacia Plan BASE');
    }

    const sub = await this.subscriptionRepo.findByTenantId(tenantId);
    if (!sub) throw new Error('Suscripción no encontrada');

    if (sub.plan_code === LEGACY_PLAN_CODES.BASE || sub.plan_code === SAAS_PLANS.PRINCIPAL) {
      throw new Error('El salón ya se encuentra en el plan base/principal');
    }

    // VALIDACIÓN ESTRICTA DE LÍMITES DE RECURSOS PARA DOWNGRADE:
    // Base/Principal permite máx 1 sucursal y 3 usuarios por defecto
    const branchCount = this.entitlementsRepo
      ? await this.entitlementsRepo.countResourceUsage(tenantId, 'branches')
      : 1;
    const userCount = this.entitlementsRepo
      ? await this.entitlementsRepo.countResourceUsage(tenantId, 'users')
      : 1;

    const baseLimits = DEFAULT_PLAN_LIMITS[SAAS_PLANS.PRINCIPAL] || { branches: 1, users: 3 };

    if (branchCount > baseLimits.branches || userCount > baseLimits.users) {
      const err = new Error(
        `No se puede realizar downgrade: recursos actuales exceden los límites permitidos. ` +
        `Sucursales: ${branchCount}/${baseLimits.branches}, Usuarios: ${userCount}/${baseLimits.users}. ` +
        `Desactive los recursos excedentes antes de proceder.`
      );
      err.code = 'RESOURCE_LIMIT_EXCEEDED';
      err.details = {
        currentBranches: branchCount,
        maxBranchesAllowed: baseLimits.branches,
        currentUsers: userCount,
        maxUsersAllowed: baseLimits.users
      };
      throw err;
    }

    // El downgrade se programa para ser efectivo al finalizar el período actual
    const updated = {
      ...sub,
      scheduled_downgrade_plan: LEGACY_PLAN_CODES.BASE,
      updated_at: new Date().toISOString()
    };

    if (this.subscriptionRepo.upsertSubscription) {
      await this.subscriptionRepo.upsertSubscription(tenantId, updated);
    } else if (this.subscriptionRepo.update) {
      await this.subscriptionRepo.update(tenantId, updated);
    } else if (this.subscriptionRepo.save) {
      await this.subscriptionRepo.save(updated);
    }

    if (this.billingRepo?.recordBillingEvent) {
      await this.billingRepo.recordBillingEvent({
        tenant_id: tenantId,
        event_type: 'DOWNGRADE_SCHEDULED',
        payload: { scheduledPlan: LEGACY_PLAN_CODES.BASE, effectiveAt: sub.current_period_end, actorId },
        idempotency_key: `evt_downgrade_sched_${tenantId}_${Date.now()}`
      });
    }

    return {
      scheduled: true,
      effectiveAt: sub.current_period_end,
      targetPlan: LEGACY_PLAN_CODES.BASE
    };
  }

  async cancelSubscription(tenantId, { reason = 'customer_request', actorId }) {
    const sub = await this.subscriptionRepo.findByTenantId(tenantId);
    if (!sub) throw new Error('Suscripción no encontrada');

    const updated = {
      ...sub,
      status: SUBSCRIPTION_STATUSES.CANCELLED,
      cancellation_reason: reason,
      updated_at: new Date().toISOString()
    };

    if (this.subscriptionRepo.upsertSubscription) {
      await this.subscriptionRepo.upsertSubscription(tenantId, updated);
    } else if (this.subscriptionRepo.update) {
      await this.subscriptionRepo.update(tenantId, updated);
    } else if (this.subscriptionRepo.save) {
      await this.subscriptionRepo.save(updated);
    }

    if (this.billingRepo?.recordBillingEvent) {
      await this.billingRepo.recordBillingEvent({
        tenant_id: tenantId,
        event_type: 'SUBSCRIPTION_CANCELLED',
        payload: { effectiveEnd: sub.current_period_end, reason, actorId },
        idempotency_key: `evt_cancelled_${tenantId}_${Date.now()}`
      });
    }

    return {
      cancelled: true,
      accessUntil: sub.current_period_end
    };
  }

  async extendGracePeriod(tenantId, { additionalDays = 5, reason, actorId }) {
    if (!reason) throw new Error('Motivo obligatorio para conceder prórroga de gracia');
    const sub = await this.subscriptionRepo.findByTenantId(tenantId);
    if (!sub) throw new Error('Suscripción no encontrada');

    const currentGrace = sub.grace_period_until ? new Date(sub.grace_period_until) : new Date();
    const newGrace = new Date(Math.max(Date.now(), currentGrace.getTime()) + Number(additionalDays) * 86400000);

    const updated = {
      ...sub,
      status: SUBSCRIPTION_STATUSES.PAST_DUE,
      grace_period_until: newGrace.toISOString(),
      updated_at: new Date().toISOString()
    };

    if (this.subscriptionRepo.upsertSubscription) {
      await this.subscriptionRepo.upsertSubscription(tenantId, updated);
    } else if (this.subscriptionRepo.update) {
      await this.subscriptionRepo.update(tenantId, updated);
    } else if (this.subscriptionRepo.save) {
      await this.subscriptionRepo.save(updated);
    }

    if (this.billingRepo?.recordBillingEvent) {
      await this.billingRepo.recordBillingEvent({
        tenant_id: tenantId,
        event_type: 'GRACE_PERIOD_EXTENDED',
        payload: { additionalDays, newGraceUntil: newGrace.toISOString(), reason, actorId },
        idempotency_key: `evt_grace_ext_${tenantId}_${Date.now()}`
      });
    }

    return updated;
  }
}

module.exports = {
  SubscriptionLifecycleService
};
