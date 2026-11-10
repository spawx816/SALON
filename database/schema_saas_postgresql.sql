-- ============================================================================
-- SALON PRO SAAS - ESQUEMA MULTI-TENANT NATIVO (POSTGRESQL)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. NÚCLEO SAAS & MULTI-TENANCY
-- ============================================================================

-- Tabla de Inquilinos / Negocios (Salones Clientes del SaaS)
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_name VARCHAR(255) NOT NULL,
    legal_name VARCHAR(255),
    rnc VARCHAR(20),
    slug VARCHAR(100) UNIQUE NOT NULL,
    status VARCHAR(30) DEFAULT 'active', -- trial, active, suspended, cancelled
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    country VARCHAR(10) DEFAULT 'DO',
    currency VARCHAR(10) DEFAULT 'DOP',
    logo_url TEXT,
    primary_color VARCHAR(20) DEFAULT '#0f172a',
    secondary_color VARCHAR(20) DEFAULT '#d4af37',
    
    -- Feature Flags / Módulos Add-on Contratados por el Salón
    has_memberships BOOLEAN DEFAULT FALSE, -- Add-on de Membresías Recurrentes
    has_dgii_ecf BOOLEAN DEFAULT FALSE,    -- Add-on de Facturación Electrónica DGII
    has_attendance_kiosk BOOLEAN DEFAULT TRUE, -- Kiosco con foto
    has_payroll BOOLEAN DEFAULT TRUE,      -- Módulo de nómina avanzada
    
    trial_ends_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Planes que vende tu SaaS (Starter, Pro, Enterprise)
CREATE TABLE IF NOT EXISTS saas_plans (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    price DECIMAL(12,2) NOT NULL,
    billing_cycle VARCHAR(20) DEFAULT 'monthly',
    max_branches INT DEFAULT 1,
    max_employees INT DEFAULT 5,
    included_features JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Suscripciones del Salón con la Plataforma SaaS
CREATE TABLE IF NOT EXISTS tenant_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    saas_plan_id INT REFERENCES saas_plans(id),
    status VARCHAR(30) DEFAULT 'active',
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    current_period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    payment_method VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Sucursales / Locales de cada Salón
CREATE TABLE IF NOT EXISTS branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    address TEXT,
    city VARCHAR(100),
    maps_url TEXT,
    is_main BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_branches_tenant ON branches(tenant_id);

-- Configuración Personalizada por Salón (Tickets, Pasarelas, Fiscal)
CREATE TABLE IF NOT EXISTS tenant_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID UNIQUE NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    receipt_header TEXT,
    receipt_footer TEXT DEFAULT '¡Gracias por preferirnos!',
    receipt_width VARCHAR(10) DEFAULT '60mm',
    
    -- Configuración DGII e-CF por Salón
    dgii_environment VARCHAR(20) DEFAULT 'test',
    dgii_cert_encrypted TEXT,
    dgii_cert_password_encrypted TEXT,
    
    -- Pasarela de Pago del Salón
    payment_gateway VARCHAR(50),
    gateway_merchant_id VARCHAR(100),
    gateway_api_key_encrypted TEXT,
    
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 2. USUARIOS, ROLES Y ACCESOS
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL solo para el SuperAdmin del SaaS
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL, -- superadmin, owner, manager, cashier, stylist
    phone VARCHAR(50),
    profile_photo TEXT,
    admin_pin VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_tenant_email UNIQUE(tenant_id, email)
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

-- ============================================================================
-- 3. CATÁLOGO DE SERVICIOS Y PRODUCTOS
-- ============================================================================

CREATE TABLE IF NOT EXISTS service_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    icon VARCHAR(50),
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    category_id UUID REFERENCES service_categories(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(12,2) NOT NULL,
    duration_minutes INT DEFAULT 45,
    commission_percentage DECIMAL(5,2) DEFAULT 0.00,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_services_tenant ON services(tenant_id);

-- ============================================================================
-- 4. CLIENTES
-- ============================================================================

CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(255),
    cedula_rnc VARCHAR(50),
    birthday DATE,
    address TEXT,
    notes TEXT,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_clients_tenant ON clients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_clients_tenant_phone ON clients(tenant_id, phone);

-- ============================================================================
-- 5. CAJAS Y TURNOS DE JORNADA (POS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS cash_registers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS cash_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    cash_register_id UUID NOT NULL REFERENCES cash_registers(id),
    opened_by UUID NOT NULL REFERENCES users(id),
    closed_by UUID REFERENCES users(id),
    opening_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    closing_amount_cash DECIMAL(12,2),
    expected_amount_cash DECIMAL(12,2),
    difference_cash DECIMAL(12,2),
    status VARCHAR(20) DEFAULT 'open',
    opened_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP WITH TIME ZONE,
    notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_tenant ON cash_shifts(tenant_id);

-- ============================================================================
-- 6. VENTAS, FACTURAS Y PRE-CUENTAS
-- ============================================================================

CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id),
    cash_shift_id UUID REFERENCES cash_shifts(id),
    client_id UUID REFERENCES clients(id),
    cashier_id UUID NOT NULL REFERENCES users(id),
    
    invoice_number VARCHAR(50) NOT NULL,
    ncf VARCHAR(50),
    ncf_type VARCHAR(20),
    
    subtotal DECIMAL(12,2) NOT NULL,
    discount_amount DECIMAL(12,2) DEFAULT 0.00,
    tax_amount DECIMAL(12,2) DEFAULT 0.00,
    total DECIMAL(12,2) NOT NULL,
    
    payment_method VARCHAR(50) NOT NULL,
    payment_status VARCHAR(30) DEFAULT 'paid',
    
    qr_code_url TEXT,
    xml_signature TEXT,
    
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_created ON invoices(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id),
    stylist_id UUID REFERENCES users(id),
    description VARCHAR(255) NOT NULL,
    quantity INT DEFAULT 1,
    unit_price DECIMAL(12,2) NOT NULL,
    discount DECIMAL(12,2) DEFAULT 0.00,
    total DECIMAL(12,2) NOT NULL,
    commission_amount DECIMAL(12,2) DEFAULT 0.00
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_tenant ON invoice_items(tenant_id);

-- ============================================================================
-- 7. RRHH, ASISTENCIA Y COMISIONES
-- ============================================================================

CREATE TABLE IF NOT EXISTS employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    cedula VARCHAR(30) NOT NULL,
    phone VARCHAR(50),
    position VARCHAR(100) DEFAULT 'Estilista',
    base_salary DECIMAL(12,2) DEFAULT 0.00,
    default_commission_pct DECIMAL(5,2) DEFAULT 0.00,
    hire_date DATE,
    work_days TEXT,
    entry_time TIME,
    exit_time TIME,
    tolerance_minutes INT DEFAULT 15,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_employees_tenant ON employees(tenant_id);

CREATE TABLE IF NOT EXISTS attendance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id),
    employee_id UUID NOT NULL REFERENCES employees(id),
    type VARCHAR(20) NOT NULL,
    photo_url TEXT,
    geolocation VARCHAR(100),
    device_info VARCHAR(255),
    lateness_minutes INT DEFAULT 0,
    extra_minutes INT DEFAULT 0,
    status VARCHAR(20) DEFAULT 'Normal',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_attendance_tenant ON attendance_logs(tenant_id);

-- ============================================================================
-- 8. MÓDULO ADD-ON: MEMBRESÍAS Y SUSCRIPCIONES (OPCIONAL POR SALÓN)
-- ============================================================================

CREATE TABLE IF NOT EXISTS membership_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    monthly_price DECIMAL(12,2) NOT NULL,
    wash_limit_per_cycle INT DEFAULT 4,
    included_services JSONB DEFAULT '[]'::jsonb,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_membership_plans_tenant ON membership_plans(tenant_id);

CREATE TABLE IF NOT EXISTS membership_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id),
    client_id UUID NOT NULL REFERENCES clients(id),
    membership_plan_id UUID NOT NULL REFERENCES membership_plans(id),
    status VARCHAR(30) DEFAULT 'active',
    signed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    signature_data TEXT,
    client_selfie_url TEXT,
    card_token VARCHAR(255),
    last_billed_at TIMESTAMP WITH TIME ZONE,
    next_billing_at TIMESTAMP WITH TIME ZONE,
    used_washes_this_cycle INT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_membership_contracts_tenant ON membership_contracts(tenant_id);
