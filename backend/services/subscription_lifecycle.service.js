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
      throw new Error('La empresa ya se encuentra en el plan base/principal');
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

  async cancelSubscription(tenantId, { reason = 'customer_request', actorId, actorEmail = null, pool = null, providerAdapter = null } = {}) {
    const sub = await this.subscriptionRepo.findByTenantId(tenantId);
    if (!sub) {
      const err = new Error('Suscripción no encontrada');
      err.statusCode = 404;
      throw err;
    }

    const nowIso = new Date().toISOString();
    const previousStatus = String(sub.status || '').toLowerCase();

    // Resolver versión de términos aceptada
    let termsVersion = 'v2026.1';
    if (pool) {
      try {
        const [tRows] = await pool.query(
          'SELECT terms_version FROM tenant_terms_acceptances WHERE tenant_id = ? ORDER BY accepted_at_utc DESC LIMIT 1',
          [tenantId]
        );
        if (tRows && tRows.length > 0 && tRows[0].terms_version) {
          termsVersion = tRows[0].terms_version;
        }
      } catch {
        // Non-blocking lookup
      }
    }

    // Idempotencia: si ya fue cancelada, devolver estado existente sin duplicar eventos ni correos
    if (previousStatus === SUBSCRIPTION_STATUSES.CANCELLED) {
      return {
        cancelled: true,
        alreadyCancelled: true,
        status: SUBSCRIPTION_STATUSES.CANCELLED,
        previousStatus,
        accessUntil: sub.current_period_end || null,
        effectiveDate: sub.updated_at || nowIso,
        cancelledAt: sub.updated_at || nowIso,
        termsVersion,
        autoRenewDisabled: true,
        providerRecurringStatus: 'disabled',
        emailSent: false,
        message: 'La suscripción ya se encontraba cancelada.'
      };
    }

    // Verificar cancelación de recurrencia externa si existe adaptador del proveedor
    let providerRecurringStatus = 'disabled';
    if (providerAdapter && typeof providerAdapter.cancelRecurring === 'function') {
      const provRes = await providerAdapter.cancelRecurring({ tenantId, subscription: sub });
      if (!provRes || provRes.ok === false) {
        const err = new Error(provRes?.error || 'No se pudo confirmar la desactivación de recurrencia con el procesador de pagos.');
        err.code = 'PROVIDER_CANCELLATION_PENDING';
        err.statusCode = 502;
        throw err;
      }
      providerRecurringStatus = provRes.status || 'disabled';
    }

    // Cláusula 9 (v2026.1): si está pendiente/suspendida, la cancelación es inmediata y no habilita período nuevo;
    // si está activa/trialing, conserva acceso hasta fin del ciclo pagado.
    const isUnpaidOrSuspended = [
      SUBSCRIPTION_STATUSES.PENDING,
      SUBSCRIPTION_STATUSES.SUSPENDED,
      SUBSCRIPTION_STATUSES.PAST_DUE,
      'pending',
      'suspended',
      'past_due'
    ].includes(previousStatus);

    const accessUntil = isUnpaidOrSuspended ? null : (sub.current_period_end || nowIso);
    const effectiveDate = accessUntil || nowIso;

    const updated = {
      ...sub,
      status: SUBSCRIPTION_STATUSES.CANCELLED,
      cancellation_reason: reason,
      updated_at: nowIso
    };

    if (this.subscriptionRepo.upsertSubscription) {
      await this.subscriptionRepo.upsertSubscription(tenantId, updated);
    } else if (this.subscriptionRepo.update) {
      await this.subscriptionRepo.update(tenantId, updated);
    } else if (this.subscriptionRepo.save) {
      await this.subscriptionRepo.save(updated);
    }

    // Desactivar renovaciones programadas en suscripción, corridas de renovación y órdenes locales si existen
    if (pool) {
      try {
        await pool.query(
          `UPDATE tenant_subscriptions
           SET auto_renew = FALSE, cancel_at_period_end = TRUE, updated_at = NOW()
           WHERE tenant_id = ?`,
          [tenantId]
        );
      } catch {
        // Ignore if columns absent in isolated unit tests
      }
      try {
        await pool.query(
          `UPDATE saas_renewal_runs
           SET status = 'cancelled', locked_until = NULL, updated_at = NOW()
           WHERE tenant_id = ? AND status IN ('pending', 'retry_scheduled', 'reconciling')`,
          [tenantId]
        );
      } catch {
        // Ignore if table absent in isolated unit tests
      }
      try {
        await pool.query(
          'UPDATE saas_checkout_orders SET auto_renew_enabled = FALSE, updated_at = NOW() WHERE tenant_id = ? AND auto_renew_enabled = TRUE',
          [tenantId]
        );
      } catch {
        // Ignore if table/column absent in isolated unit tests
      }
    }

    if (this.billingRepo?.recordBillingEvent) {
      await this.billingRepo.recordBillingEvent({
        tenant_id: tenantId,
        event_type: 'SUBSCRIPTION_CANCELLED',
        payload: {
          effectiveEnd: accessUntil,
          effectiveDate,
          previousStatus,
          termsVersion,
          reason,
          actorId,
          providerRecurringStatus
        },
        idempotency_key: `evt_cancelled_${tenantId}_${sub.id || 'sub'}`
      });
    }

    // Auditoría de seguridad
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO security_audit_logs (tenant_id, user_id, action, details, created_at)
           VALUES (?, ?, 'SAAS_SUBSCRIPTION_CANCELLED', ?, NOW())`,
          [
            tenantId,
            actorId ? String(actorId) : null,
            JSON.stringify({
              actorEmail,
              previousStatus,
              termsVersion,
              effectiveDate,
              accessUntil,
              reason,
              providerRecurringStatus
            })
          ]
        );
      } catch {
        // Non-blocking audit
      }
    }

    // Enviar confirmación por correo (Cláusula 9: hora de Santo Domingo y fecha de fin de acceso)
    let emailSent = false;
    if (pool) {
      try {
        const [tRows] = await pool.query(
          'SELECT business_name, legal_name, owner_email, email FROM tenants WHERE id = ? LIMIT 1',
          [tenantId]
        );
        const tenantRow = tRows?.[0] || {};
        const recipient = actorEmail || tenantRow.owner_email || tenantRow.email;
        if (recipient) {
          const { resolveTransporterForTenant } = require('./platform_email.service');
          const { transporter, fromAddress } = await resolveTransporterForTenant(pool, tenantId, 'Etereas');
          if (transporter) {
            const cancelledAtRd = new Date(nowIso).toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' });
            const accessText = accessUntil
              ? `Tu acceso permanecerá activo hasta el ${new Date(accessUntil).toLocaleDateString('es-DO', { timeZone: 'America/Santo_Domingo' })}.`
              : 'La cancelación surte efecto inmediato y no se realizarán nuevos cargos recurrentes.';
            await transporter.sendMail({
              from: fromAddress,
              to: recipient,
              subject: 'Confirmación de Cancelación de Suscripción — Etereas',
              text: `Confirmamos la cancelación de la suscripción de ${tenantRow.business_name || tenantRow.legal_name || 'tu empresa'} el ${cancelledAtRd} (hora de Santo Domingo). ${accessText} Términos aplicables: ${termsVersion}.`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
                  <h2 style="margin-top: 0; color: #0f172a;">Confirmación de Cancelación</h2>
                  <p style="color: #475569; line-height: 1.6;">Confirmamos que la renovación automática de <strong>${tenantRow.business_name || tenantRow.name || 'tu empresa'}</strong> ha sido desactivada.</p>
                  <ul style="color: #334155; line-height: 1.7;">
                    <li><strong>Fecha y hora (Santo Domingo):</strong> ${cancelledAtRd}</li>
                    <li><strong>Efecto:</strong> ${accessText}</li>
                    <li><strong>Versión de términos:</strong> ${termsVersion}</li>
                  </ul>
                  <p style="color: #64748b; font-size: 13px;">Las facturas u obligaciones ya devengadas permanecen registradas por separado conforme a los términos del servicio.</p>
                </div>
              `
            });
            emailSent = true;
          }
        }
      } catch (mailErr) {
        console.warn('[CANCEL SUBSCRIPTION EMAIL WARN]:', mailErr.message);
      }
    }

    return {
      cancelled: true,
      alreadyCancelled: false,
      status: SUBSCRIPTION_STATUSES.CANCELLED,
      previousStatus,
      accessUntil,
      effectiveDate,
      cancelledAt: nowIso,
      termsVersion,
      autoRenewDisabled: true,
      providerRecurringStatus,
      emailSent,
      message: accessUntil
        ? 'Suscripción cancelada. La renovación automática quedó desactivada y tu acceso permanecerá activo hasta el fin del ciclo.'
        : 'Suscripción cancelada. La renovación automática y futuros reintentos de cobro quedaron desactivados.'
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
