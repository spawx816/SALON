-- Migration: 20261110_create_tenant_branding.sql
-- Description: Multi-tenant isolated customizable branding and receipt configuration
-- Security: Strict foreign key with ON DELETE CASCADE and unique constraint per tenant.

CREATE TABLE IF NOT EXISTS tenant_branding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
    business_name VARCHAR(150) NOT NULL DEFAULT 'SalonPro',
    logo_url TEXT,
    logo_dark_url TEXT,
    favicon_url TEXT,
    primary_color VARCHAR(7) NOT NULL DEFAULT '#0f172a',
    secondary_color VARCHAR(7) NOT NULL DEFAULT '#d4af37',
    accent_color VARCHAR(7) NOT NULL DEFAULT '#3b82f6',
    background_color VARCHAR(7) NOT NULL DEFAULT '#f8fafc',
    surface_color VARCHAR(7) NOT NULL DEFAULT '#ffffff',
    text_color VARCHAR(7) NOT NULL DEFAULT '#0f172a',
    receipt_header VARCHAR(255),
    receipt_footer VARCHAR(255) DEFAULT '¡Gracias por preferirnos! ♡',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID
);

CREATE INDEX IF NOT EXISTS idx_tenant_branding_tenant_id ON tenant_branding(tenant_id);

