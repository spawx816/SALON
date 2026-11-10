/**
 * Canonical Schema Contract & Architecture Registry (95 Tables & 15 Migrations)
 * (backend/scripts/canonical_schema_contract.cjs)
 *
 * Source of truth for database schema compliance, multi-tenant isolation,
 * object catalogs, and relational integrity.
 */

'use strict';

const CANONICAL_MIGRATIONS = [
  '20261100_canonical_baseline_schema',
  '20261108_phase1_structural_multitenant',
  '20261108_phase1_historical_reconciliation',
  '20261108_phase1_quarantine_triggers',
  '20261108_phase1_verification_codes_hardening',
  '20261108_phase1_purge_plaintext_codes',
  '20261108_phase1_enforce_tenant_not_null',
  '20261109_phase2a_saas_commercial_and_entitlements',
  '20261109_phase2b_inventory_multitenant',
  '20261109_phase2d_saas_billing',
  '20261109_financial_minor_currency_units',
  '20261109_secure_admin_pin_hash',
  '20261110_create_tenant_branding',
  '20261110_phase2h_user_token_version',
  '20261110_job_nonces_and_strict_idempotency',
  '20261110_phase3b_storage_and_portability',
  '20261110_phase3b_p2p3_extensions'
];

// 13 Global / Control Plane / System Tables
const GLOBAL_SYSTEM_TABLES = [
  'account_lockouts',
  'billing_codes',
  'blocked_ips',
  'contact_messages',
  'data_retention_policies',
  'job_request_nonces',
  'login_attempts',
  'pending_tenant_reconciliations',
  'saas_features',
  'saas_plan_features',
  'saas_plans',
  'schema_migrations',
  'tenants'
];

// Approved Nullable Exemptions on tenant_id
const APPROVED_NULLABLE_EXEMPTIONS = {
  'audit_logs': 'System-level audit records before tenant resolution',
  'security_audit_logs': 'Control-plane security audits without tenant context',
  'user_sessions': 'Superadmin cross-tenant sessions without active tenant selection',
  'users': 'Superadmin users in control plane',
  'verification_codes': 'Pre-registration verification codes before tenant creation',
  'saas_webhook_events': 'Raw inbound gateway webhooks before tenant binding',
  'data_retention_runs': 'Global or system-level data retention runs before tenant scoping'
};

// 83 Tenant-Owned Tables
const TENANT_OWNED_TABLES = [
  'appointments',
  'attendance',
  'attendance_logs',
  'audit_logs',
  'branches',
  'cash_register_movements',
  'cash_registers',
  'cash_shifts',
  'clients',
  'commission_categories',
  'commission_payouts',
  'commission_scheme_rules',
  'commission_schemes',
  'company_ncf_counters',
  'contract_settings',
  'contracts',
  'data_retention_runs',
  'dgii_606_purchases',
  'dgii_ncf_sequences',
  'email_logs',
  'email_settings',
  'employee_commission_rules',
  'employee_commissions_log',
  'employee_consumptions',
  'employee_discounts',
  'employees',
  'expenses',
  'gift_card_logs',
  'gift_cards',
  'holidays',
  'idempotency_keys',
  'inventory_locations',
  'inventory_movements',
  'inventory_physical_session_items',
  'inventory_physical_sessions',
  'inventory_products',
  'inventory_purchase_order_items',
  'inventory_purchase_orders',
  'inventory_stock',
  'inventory_suppliers',
  'inventory_transfer_items',
  'inventory_transfers',
  'invoice_items',
  'invoices',
  'marketing_settings',
  'membership_contracts',
  'membership_plans',
  'payments',
  'payroll_audit_logs',
  'payroll_calculation_settings',
  'payroll_concepts',
  'payroll_items',
  'payroll_periods',
  'payroll_records',
  'pending_surveys',
  'plans',
  'private_files',
  'roles',
  'saas_billing_events',
  'saas_billing_jobs',
  'saas_invoice_counters',
  'saas_invoice_items',
  'saas_invoices',
  'saas_payment_methods',
  'saas_payments',
  'saas_refunds',
  'saas_webhook_events',
  'salons',
  'schedule_overrides',
  'security_audit_logs',
  'security_requests',
  'security_settings',
  'service_categories',
  'services',
  'staff_positions',
  'staff_records',
  'surveys',
  'tenant_branding',
  'tenant_exports',
  'tenant_feature_overrides',
  'tenant_settings',
  'tenant_subscription_events',
  'tenant_subscriptions',
  'ticket_sequences',
  'user_sessions',
  'users',
  'verification_codes',
  'visits'
];

const CANONICAL_101_TABLES = [
  ...GLOBAL_SYSTEM_TABLES,
  ...TENANT_OWNED_TABLES
].sort();

const CANONICAL_97_TABLES = CANONICAL_101_TABLES; // Compatibility alias
const CANONICAL_95_TABLES = CANONICAL_101_TABLES; // Compatibility alias
const CANONICAL_94_TABLES = CANONICAL_101_TABLES; // Compatibility alias

const CANONICAL_QUARANTINE_TRIGGERS = [
  { triggerName: 'trg_quarantine_salons', tableName: 'salons', functionName: 'fn_enforce_quarantine_block' },
  { triggerName: 'trg_quarantine_cash_registers', tableName: 'cash_registers', functionName: 'fn_enforce_quarantine_block' },
  { triggerName: 'trg_quarantine_visits', tableName: 'visits', functionName: 'fn_enforce_quarantine_block' },
  { triggerName: 'trg_quarantine_ticket_sequences', tableName: 'ticket_sequences', functionName: 'fn_enforce_quarantine_block' }
];

const CANONICAL_44_SEQUENCES = [
  'account_lockouts_id_seq',
  'audit_logs_id_seq',
  'billing_codes_id_seq',
  'blocked_ips_id_seq',
  'cash_register_movements_id_seq',
  'commission_categories_id_seq',
  'commission_payouts_id_seq',
  'commission_scheme_rules_id_seq',
  'commission_schemes_id_seq',
  'company_ncf_counters_id_seq',
  'contact_messages_id_seq',
  'contract_settings_id_seq',
  'dgii_606_purchases_id_seq',
  'dgii_ncf_sequences_id_seq',
  'email_logs_id_seq',
  'email_settings_id_seq',
  'employee_commission_rules_id_seq',
  'employee_commissions_log_id_seq',
  'employee_consumptions_id_seq',
  'employee_discounts_id_seq',
  'gift_card_logs_id_seq',
  'gift_cards_id_seq',
  'holidays_id_seq',
  'idempotency_keys_id_seq',
  'job_request_nonces_id_seq',
  'login_attempts_id_seq',
  'marketing_settings_id_seq',
  'payroll_audit_logs_id_seq',
  'payroll_calculation_settings_id_seq',
  'payroll_concepts_id_seq',
  'payroll_items_id_seq',
  'payroll_periods_id_seq',
  'payroll_records_id_seq',
  'pending_tenant_reconciliations_id_seq',
  'roles_id_seq',
  'saas_plans_id_seq',
  'schedule_overrides_id_seq',
  'security_audit_logs_id_seq',
  'security_requests_id_seq',
  'security_settings_id_seq',
  'staff_positions_id_seq',
  'staff_records_id_seq',
  'ticket_sequences_id_seq',
  'verification_codes_id_seq'
];

const CANONICAL_43_SEQUENCES = CANONICAL_44_SEQUENCES; // Compatibility alias

module.exports = {
  CANONICAL_MIGRATIONS,
  GLOBAL_SYSTEM_TABLES,
  TENANT_OWNED_TABLES,
  APPROVED_NULLABLE_EXEMPTIONS,
  CANONICAL_101_TABLES,
  CANONICAL_97_TABLES,
  CANONICAL_95_TABLES,
  CANONICAL_94_TABLES,
  CANONICAL_QUARANTINE_TRIGGERS,
  CANONICAL_44_SEQUENCES,
  CANONICAL_43_SEQUENCES
};

