/**
 * Migration: 20261114_addon_branch_scoping
 * Adds branch-level scoping (`enabled_branch_ids`) and `updated_at` to `tenant_feature_overrides`
 * so the Suscripciones/Membresías B2C add-on is canonically tracked per tenant and enabled branches.
 */

exports.up = async function (conn) {
  await conn.query(`
    ALTER TABLE tenant_feature_overrides
    ADD COLUMN IF NOT EXISTS enabled_branch_ids JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
  `);
};

exports.down = async function () {
  // No-op to preserve audit & entitlement history
};
