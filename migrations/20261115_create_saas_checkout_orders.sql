-- SaaS B2B Checkout Orders for Etereas Plan Principal & Add-ons (CardNet Hosted Checkout)
-- Strictly separated from B2C salon payments/invoices.
-- Never stores PAN, CVC/CVV, or raw card secrets.

CREATE TABLE IF NOT EXISTS saas_checkout_orders (
  id UUID PRIMARY KEY,
  order_number VARCHAR(20) NOT NULL UNIQUE,
  tenant_id UUID NOT NULL,
  invoice_id UUID NULL,
  created_by_user_id UUID NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'self_service',
  payment_link_token VARCHAR(96) NULL UNIQUE,
  plan_code VARCHAR(40) NOT NULL DEFAULT 'PRINCIPAL',
  branches_count INTEGER NOT NULL DEFAULT 1,
  extra_users_count INTEGER NOT NULL DEFAULT 0,
  memberships_addon_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  addon_branches_count INTEGER NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  subtotal_minor BIGINT NOT NULL DEFAULT 0,
  tax_minor BIGINT NOT NULL DEFAULT 0,
  total_minor BIGINT NOT NULL DEFAULT 0,
  billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly',
  status VARCHAR(32) NOT NULL DEFAULT 'pending_payment',
  gateway_provider VARCHAR(40) NOT NULL DEFAULT 'cardnet_hosted',
  cardnet_session_id VARCHAR(128) NULL,
  cardnet_session_key VARCHAR(256) NULL,
  cardnet_authorization_code VARCHAR(64) NULL,
  cardnet_reference VARCHAR(128) NULL,
  cardnet_response_code VARCHAR(16) NULL,
  cardnet_response_message VARCHAR(255) NULL,
  masked_card VARCHAR(32) NULL,
  auto_renew_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ NULL,
  activated_at TIMESTAMPTZ NULL,
  reconcile_attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saas_checkout_orders_tenant_status
  ON saas_checkout_orders (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_saas_checkout_orders_token
  ON saas_checkout_orders (payment_link_token)
  WHERE payment_link_token IS NOT NULL;
