-- INDEPENDENT SCHEMA DDL DEFINITION
-- Generated for sandbox restoration testing

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."account_lockouts" (
  "id" SERIAL,
  "account_identifier" VARCHAR(150) NOT NULL,
  "reason" VARCHAR(255),
  "blocked_until" TIMESTAMP,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "attempts_count" integer DEFAULT 0,
  "strike_count" integer DEFAULT 0,
  "last_ip" VARCHAR(60)
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."appointments" (
  "id" VARCHAR(50) NOT NULL,
  "client_id" VARCHAR(100),
  "client_name" VARCHAR(150),
  "salon_id" VARCHAR(100) DEFAULT '1'::character varying,
  "date" VARCHAR(20) NOT NULL,
  "time" VARCHAR(20) NOT NULL,
  "services" text,
  "status" VARCHAR(30) DEFAULT 'Pendiente'::character varying,
  "notes" text,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."attendance" (
  "id" VARCHAR(50) NOT NULL,
  "employee_id" VARCHAR(100) NOT NULL,
  "timestamp" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "type" VARCHAR(30) NOT NULL,
  "photo" text,
  "geolocation" VARCHAR(100),
  "device_info" VARCHAR(255),
  "status" VARCHAR(30) DEFAULT 'Normal'::character varying,
  "lateness_minutes" integer DEFAULT 0,
  "extra_minutes" integer DEFAULT 0,
  "modified_by" VARCHAR(100),
  "modified_at" TIMESTAMP,
  "is_manual" smallint DEFAULT 0,
  "modification_reason" VARCHAR(255),
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."attendance_logs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "branch_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "type" VARCHAR(20) NOT NULL,
  "photo_url" text,
  "geolocation" VARCHAR(100),
  "device_info" VARCHAR(255),
  "lateness_minutes" integer DEFAULT 0,
  "extra_minutes" integer DEFAULT 0,
  "status" VARCHAR(20) DEFAULT 'Normal'::character varying,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."audit_logs" (
  "id" SERIAL,
  "action" VARCHAR(100),
  "details" text,
  "user_name" VARCHAR(255),
  "ip_address" VARCHAR(50),
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "entity_type" VARCHAR(100),
  "entity_id" VARCHAR(100),
  "reason" text,
  "metadata" jsonb,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."billing_codes" (
  "id" SERIAL,
  "contract_id" VARCHAR(100),
  "code" VARCHAR(20),
  "action_type" VARCHAR(50),
  "is_used" smallint DEFAULT 0,
  "expires_at" TIMESTAMP,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."blocked_ips" (
  "id" SERIAL,
  "ip_address" VARCHAR(100) NOT NULL,
  "reason" VARCHAR(255),
  "blocked_until" TIMESTAMP,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."branches" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "phone" VARCHAR(50),
  "address" text,
  "city" VARCHAR(100),
  "maps_url" text,
  "is_main" boolean DEFAULT false,
  "status" VARCHAR(20) DEFAULT 'active'::character varying,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "is_active" boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."cash_register_movements" (
  "id" SERIAL,
  "cash_register_id" VARCHAR(100) NOT NULL,
  "type" VARCHAR(50) NOT NULL,
  "payment_method" VARCHAR(100) DEFAULT 'Efectivo'::character varying,
  "amount" NUMERIC(12, 2) NOT NULL,
  "concept" text,
  "user_name" VARCHAR(255),
  "visit_id" VARCHAR(100),
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "user_id" VARCHAR(100),
  "employee_id" VARCHAR(100),
  "employee_name" VARCHAR(150),
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."cash_registers" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid,
  "branch_id" uuid,
  "name" VARCHAR(100),
  "status" VARCHAR(20) DEFAULT 'active'::character varying,
  "salon_id" VARCHAR(100) DEFAULT 1,
  "opened_by_name" VARCHAR(255),
  "closed_by_name" VARCHAR(255),
  "monto_inicial" NUMERIC(12, 2) DEFAULT 0.00,
  "monto_final" NUMERIC(12, 2),
  "observaciones" text,
  "opened_at" TIMESTAMP WITH TIME ZONE,
  "closed_at" TIMESTAMP WITH TIME ZONE,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "register_number" VARCHAR(100),
  "employee_id" VARCHAR(100),
  "employee_name" VARCHAR(255),
  "diferencia" NUMERIC(12, 2) DEFAULT 0.00
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."cash_shifts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "branch_id" uuid NOT NULL,
  "cash_register_id" uuid NOT NULL,
  "opened_by" uuid NOT NULL,
  "closed_by" uuid,
  "opening_amount" NUMERIC(12, 2) DEFAULT 0.00 NOT NULL,
  "closing_amount_cash" NUMERIC(12, 2),
  "expected_amount_cash" NUMERIC(12, 2),
  "difference_cash" NUMERIC(12, 2),
  "status" VARCHAR(20) DEFAULT 'open'::character varying,
  "opened_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "closed_at" TIMESTAMP WITH TIME ZONE,
  "notes" text
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."clients" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid,
  "branch_id" uuid,
  "name" VARCHAR(255),
  "phone" VARCHAR(50),
  "email" VARCHAR(255),
  "cedula_rnc" VARCHAR(50),
  "birthday" date,
  "address" text,
  "notes" text,
  "status" VARCHAR(20) DEFAULT 'active'::character varying,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "nombre" VARCHAR(255),
  "telefono" VARCHAR(50),
  "cedula" VARCHAR(50),
  "fecha_nacimiento" date,
  "calle" VARCHAR(255),
  "numero" VARCHAR(50),
  "sector" VARCHAR(255),
  "ciudad" VARCHAR(255),
  "frecuencia" VARCHAR(50) DEFAULT 'Mensual'::character varying,
  "salon_id" VARCHAR(100) DEFAULT 1,
  "cardnet_customer_id" VARCHAR(50),
  "registration_source" VARCHAR(50) DEFAULT 'Directo'::character varying,
  "password" VARCHAR(255),
  "must_change_password" smallint DEFAULT 0,
  "role_id" integer DEFAULT 3,
  "tipo" VARCHAR(50) DEFAULT 'client'::character varying,
  "direccion" text
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."commission_categories" (
  "id" SERIAL,
  "nombre" VARCHAR(100) NOT NULL,
  "porcentaje" NUMERIC(12, 2) DEFAULT 0.00,
  "tipo" VARCHAR(50) DEFAULT 'servicios'::character varying,
  "estado" VARCHAR(20) DEFAULT 'activo'::character varying,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."commission_payouts" (
  "id" SERIAL,
  "payout_number" VARCHAR(50) NOT NULL,
  "employee_id" VARCHAR(100) NOT NULL,
  "employee_name" VARCHAR(150) NOT NULL,
  "monto_total" NUMERIC(12, 2) DEFAULT 0 NOT NULL,
  "total_items" integer DEFAULT 0 NOT NULL,
  "metodo_pago" VARCHAR(50) DEFAULT 'Efectivo'::character varying,
  "notas" text,
  "usuario_liquidador" VARCHAR(100) DEFAULT 'Admin'::character varying,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."commission_scheme_rules" (
  "id" SERIAL,
  "scheme_id" integer NOT NULL,
  "rule_type" VARCHAR(50) DEFAULT 'general'::character varying,
  "service_name" VARCHAR(255),
  "category_name" VARCHAR(100),
  "porcentaje_comision" NUMERIC(12, 2) DEFAULT 0.00,
  "monto_ajuste" NUMERIC(12, 2) DEFAULT 0.00,
  "operacion" VARCHAR(50) DEFAULT 'Restar'::character varying,
  "valor" NUMERIC(12, 2) DEFAULT 0.00,
  "prioridad" integer DEFAULT 1,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "tipo_calculo" VARCHAR(50),
  "cantidad_meta" integer DEFAULT 0,
  "bono_monto" NUMERIC(12, 2) DEFAULT 0,
  "bono_tipo" VARCHAR(50),
  "periodo" VARCHAR(50),
  "repeticion" VARCHAR(50),
  "repeticion_limite" integer DEFAULT 0,
  "detalles_json" jsonb,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."commission_schemes" (
  "id" SERIAL,
  "service_name" VARCHAR(255),
  "percentage" NUMERIC(12, 2) DEFAULT 15.00,
  "fixed_amount" NUMERIC(12, 2) DEFAULT 0.00,
  "nombre" VARCHAR(150),
  "descripcion" text,
  "tipo" VARCHAR(50) DEFAULT 'porcentaje'::character varying,
  "estado" VARCHAR(50) DEFAULT 'Activo'::character varying,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."company_ncf_counters" (
  "id" SERIAL,
  "tipo_comprobante" VARCHAR(20) NOT NULL,
  "ultimo_numero" bigint DEFAULT 0,
  "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "cash_counter" integer DEFAULT 0,
  "cash_ratio" integer DEFAULT 4,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."contact_messages" (
  "id" SERIAL,
  "nombre" VARCHAR(150),
  "email" VARCHAR(150),
  "telefono" VARCHAR(50),
  "mensaje" text,
  "ip_address" VARCHAR(100),
  "status" VARCHAR(30) DEFAULT 'Pendiente'::character varying,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."contract_settings" (
  "id" SERIAL,
  "title" VARCHAR(255) DEFAULT 'CONTRATO DE SERVICIOS DE BELLEZA'::character varying,
  "company_name" VARCHAR(255) DEFAULT 'SALON PRO'::character varying,
  "company_rnc" VARCHAR(50) DEFAULT '1-31-98765-4'::character varying,
  "company_address" text,
  "renewal_fee" NUMERIC(12, 2) DEFAULT 800.00,
  "min_duration_months" integer DEFAULT 12,
  "notice_cancellation_days" integer DEFAULT 30,
  "content" text,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."contracts" (
  "id" VARCHAR(100) NOT NULL,
  "client_id" VARCHAR(100),
  "plan_id" VARCHAR(50),
  "signed_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "signature_data" text,
  "status" VARCHAR(50) DEFAULT 'Activo'::character varying,
  "card_token" VARCHAR(255),
  "cardnet_profile_id" VARCHAR(50),
  "retry_count" integer DEFAULT 0,
  "contract_price" NUMERIC(12, 2),
  "effective_price" NUMERIC(12, 2),
  "used_washes_this_cycle" integer DEFAULT 0,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "salon_id" VARCHAR(100) DEFAULT 1,
  "signature_hash" text,
  "ip_address" VARCHAR(50),
  "device_agent" text,
  "geolocation" VARCHAR(100),
  "payment_profile_id" VARCHAR(100),
  "contract_services" text,
  "contract_promo_services" text,
  "contract_promo_duration" VARCHAR(50),
  "last_billed_date" TIMESTAMP,
  "next_billing_date" TIMESTAMP,
  "next_retry_date" TIMESTAMP,
  "auto_billing_enabled" boolean DEFAULT true,
  "document_photo" text,
  "selfie_photo" text,
  "last_annual_fee_date" TIMESTAMP,
  "tenant_id" uuid,
  "plan_name" VARCHAR(255),
  "precio_mensual" NUMERIC(12, 2),
  "wash_quota" integer DEFAULT 4,
  "washes_used" integer DEFAULT 0,
  "current_period_start" TIMESTAMP WITH TIME ZONE,
  "current_period_end" TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."dgii_606_purchases" (
  "id" SERIAL,
  "periodo" VARCHAR(6) NOT NULL,
  "rnc_cedula" VARCHAR(20) NOT NULL,
  "tipo_id" integer DEFAULT 1,
  "tipo_bienes_servicios" VARCHAR(4) DEFAULT '02'::character varying,
  "proveedor" VARCHAR(255) NOT NULL,
  "ncf" VARCHAR(20) NOT NULL,
  "ncf_modificado" VARCHAR(20) DEFAULT ''::character varying,
  "fecha_factura" VARCHAR(10) NOT NULL,
  "fecha_pago" VARCHAR(10) DEFAULT ''::character varying,
  "tipo_compra" VARCHAR(50) DEFAULT 'Bienes'::character varying,
  "clasificacion_gasto" VARCHAR(255) DEFAULT '02 - Gastos por trabajos, suministros y servicios'::character varying,
  "monto_servicios" NUMERIC(12, 2) DEFAULT 0,
  "monto_bienes" NUMERIC(12, 2) DEFAULT 0,
  "total_facturado" NUMERIC(12, 2) DEFAULT 0 NOT NULL,
  "itbis_facturado" NUMERIC(12, 2) DEFAULT 0,
  "itbis_retenido" NUMERIC(12, 2) DEFAULT 0,
  "itbis_proporcionalidad" NUMERIC(12, 2) DEFAULT 0,
  "itbis_costo" NUMERIC(12, 2) DEFAULT 0,
  "itbis_adelantar" NUMERIC(12, 2) DEFAULT 0,
  "itbis_percibido" NUMERIC(12, 2) DEFAULT 0,
  "tipo_retencion_isr" VARCHAR(4) DEFAULT ''::character varying,
  "isr_retenido" NUMERIC(12, 2) DEFAULT 0,
  "isr_percibido" NUMERIC(12, 2) DEFAULT 0,
  "isc" NUMERIC(12, 2) DEFAULT 0,
  "otros_impuestos" NUMERIC(12, 2) DEFAULT 0,
  "propina_legal" NUMERIC(12, 2) DEFAULT 0,
  "forma_pago" VARCHAR(4) DEFAULT '02'::character varying,
  "estado" VARCHAR(20) DEFAULT 'Completa'::character varying,
  "errores_validacion" text,
  "notas" text,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."dgii_ncf_sequences" (
  "id" SERIAL,
  "tipo_comprobante" VARCHAR(20) NOT NULL,
  "nombre_comprobante" VARCHAR(100),
  "serie" VARCHAR(10) DEFAULT 'E'::character varying,
  "secuencia_desde" bigint DEFAULT 1,
  "secuencia_hasta" bigint DEFAULT 100000,
  "secuencia_actual" bigint DEFAULT 1,
  "cantidad_aprobada" bigint DEFAULT 100000,
  "cantidad_usada" bigint DEFAULT 0,
  "fecha_vencimiento" date,
  "estado" VARCHAR(20) DEFAULT 'Activo'::character varying,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "no_solicitud" VARCHAR(100),
  "no_autorizacion" VARCHAR(100),
  "numero_desde" VARCHAR(50),
  "numero_hasta" VARCHAR(50),
  "alerta_minima" integer DEFAULT 50,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."email_logs" (
  "id" SERIAL,
  "client_id" VARCHAR(100),
  "email_type" VARCHAR(100) NOT NULL,
  "recipient_email" VARCHAR(255) NOT NULL,
  "subject" VARCHAR(255) NOT NULL,
  "sent_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "opened" smallint DEFAULT 0,
  "opened_at" TIMESTAMP,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."email_settings" (
  "id" SERIAL,
  "smtp_host" VARCHAR(255),
  "smtp_port" integer DEFAULT 587,
  "smtp_user" VARCHAR(255),
  "smtp_pass" VARCHAR(255),
  "smtp_from" VARCHAR(255) DEFAULT 'SALON PRO'::character varying,
  "smtp_secure" integer DEFAULT 1,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."employee_commission_rules" (
  "id" SERIAL,
  "employee_id" VARCHAR(100) NOT NULL,
  "service_name" VARCHAR(150) DEFAULT 'General'::character varying NOT NULL,
  "tipo_comision" VARCHAR(50) DEFAULT 'Porcentaje'::character varying,
  "comision_valor" NUMERIC(12, 2) DEFAULT 0,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."employee_commissions_log" (
  "id" SERIAL,
  "employee_id" integer,
  "visit_id" VARCHAR(100),
  "ticket_number" VARCHAR(50),
  "service_name" VARCHAR(255),
  "service_price" NUMERIC(12, 2),
  "commission_rate" NUMERIC(12, 2),
  "commission_amount" NUMERIC(12, 2),
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "monto_comision" NUMERIC(12, 2) DEFAULT 0.00,
  "status" VARCHAR(50) DEFAULT 'Pendiente'::character varying,
  "employee_name" VARCHAR(255),
  "localidad" VARCHAR(150),
  "precio_servicio" NUMERIC(12, 2) DEFAULT 0.00,
  "cantidad" NUMERIC(12, 2) DEFAULT 1.00,
  "descuento_aplicado" NUMERIC(12, 2) DEFAULT 0.00,
  "monto_base" NUMERIC(12, 2) DEFAULT 0.00,
  "tipo_comision" VARCHAR(50) DEFAULT 'Porcentaje'::character varying,
  "comision_valor" NUMERIC(12, 2) DEFAULT 0.00,
  "scheme_id" integer,
  "rule_applied_description" text,
  "payout_id" VARCHAR(100),
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."employee_consumptions" (
  "id" SERIAL,
  "employee_id" integer,
  "visit_id" VARCHAR(100),
  "amount" NUMERIC(12, 2),
  "service_name" VARCHAR(255),
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "employee_name" VARCHAR(255),
  "monto" NUMERIC(12, 2),
  "servicios" jsonb,
  "salon_id" VARCHAR(100),
  "status" VARCHAR(50) DEFAULT 'Pendiente'::character varying,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."employee_discounts" (
  "id" SERIAL,
  "employee_id" integer,
  "visit_id" VARCHAR(100),
  "discount_amount" NUMERIC(12, 2),
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "employee_name" VARCHAR(255),
  "type" VARCHAR(100) DEFAULT 'Servicio'::character varying,
  "amount" NUMERIC(12, 2) DEFAULT 0.00,
  "date" date DEFAULT CURRENT_DATE,
  "notes" text,
  "status" VARCHAR(50) DEFAULT 'Pendiente'::character varying,
  "created_by" VARCHAR(150),
  "cash_register_movement_id" integer,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."employees" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "branch_id" uuid,
  "user_id" uuid,
  "name" VARCHAR(255) NOT NULL,
  "cedula" VARCHAR(30) NOT NULL,
  "phone" VARCHAR(50),
  "position" VARCHAR(100) DEFAULT 'Estilista'::character varying,
  "base_salary" NUMERIC(12, 2) DEFAULT 0.00,
  "default_commission_pct" NUMERIC(12, 2) DEFAULT 0.00,
  "hire_date" date,
  "work_days" text,
  "entry_time" time without time zone,
  "exit_time" time without time zone,
  "tolerance_minutes" integer DEFAULT 15,
  "status" VARCHAR(20) DEFAULT 'active'::character varying,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "nombre" VARCHAR(150),
  "rol" VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."expenses" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid,
  "salon_id" VARCHAR(100),
  "branch_id" VARCHAR(100),
  "concept" VARCHAR(255),
  "description" text,
  "category" VARCHAR(100) DEFAULT 'Operativo'::character varying,
  "amount" NUMERIC(12, 2) DEFAULT 0.00 NOT NULL,
  "date" date,
  "expense_date" date,
  "payment_method" VARCHAR(100) DEFAULT 'Efectivo'::character varying,
  "rnc_proveedor" VARCHAR(50),
  "ncf" VARCHAR(50),
  "created_by" VARCHAR(150),
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."gift_card_logs" (
  "id" SERIAL,
  "gift_card_id" integer,
  "visit_id" VARCHAR(100),
  "amount_used" NUMERIC(12, 2),
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "amount_redeemed" NUMERIC(12, 2) DEFAULT 0,
  "balance_before" NUMERIC(12, 2) DEFAULT 0,
  "balance_after" NUMERIC(12, 2) DEFAULT 0,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."gift_cards" (
  "id" SERIAL,
  "code" VARCHAR(50) NOT NULL,
  "initial_balance" NUMERIC(12, 2) NOT NULL,
  "current_balance" NUMERIC(12, 2) NOT NULL,
  "client_name" VARCHAR(255),
  "status" VARCHAR(20) DEFAULT 'Activa'::character varying,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP WITH TIME ZONE,
  "amount" NUMERIC(12, 2) DEFAULT 0,
  "balance" NUMERIC(12, 2) DEFAULT 0,
  "client_id" VARCHAR(100),
  "recipient_name" VARCHAR(150),
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."holidays" (
  "id" SERIAL,
  "date" date NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "type" VARCHAR(50) DEFAULT 'Oficial'::character varying,
  "rate_multiplier" NUMERIC(12, 2) DEFAULT 2.00,
  "is_active" smallint DEFAULT 1,
  "notes" text,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."invoice_items" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "invoice_id" uuid NOT NULL,
  "service_id" uuid,
  "stylist_id" uuid,
  "description" VARCHAR(255) NOT NULL,
  "quantity" integer DEFAULT 1,
  "unit_price" NUMERIC(12, 2) NOT NULL,
  "discount" NUMERIC(12, 2) DEFAULT 0.00,
  "total" NUMERIC(12, 2) NOT NULL,
  "commission_amount" NUMERIC(12, 2) DEFAULT 0.00
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."invoices" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "branch_id" uuid NOT NULL,
  "cash_shift_id" uuid,
  "client_id" uuid,
  "cashier_id" uuid NOT NULL,
  "invoice_number" VARCHAR(50) NOT NULL,
  "ncf" VARCHAR(50),
  "ncf_type" VARCHAR(20),
  "subtotal" NUMERIC(12, 2) NOT NULL,
  "discount_amount" NUMERIC(12, 2) DEFAULT 0.00,
  "tax_amount" NUMERIC(12, 2) DEFAULT 0.00,
  "total" NUMERIC(12, 2) NOT NULL,
  "payment_method" VARCHAR(50) NOT NULL,
  "payment_status" VARCHAR(30) DEFAULT 'paid'::character varying,
  "qr_code_url" text,
  "xml_signature" text,
  "notes" text,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."login_attempts" (
  "id" SERIAL,
  "email_or_cedula" VARCHAR(150),
  "ip_address" VARCHAR(100),
  "status" VARCHAR(50),
  "attempted_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."marketing_settings" (
  "id" SERIAL,
  "birthday_automation_enabled" boolean DEFAULT true,
  "birthday_discount" integer DEFAULT 15,
  "birthday_flyer_url" text,
  "birthday_email_subject" VARCHAR(255) DEFAULT '¡Feliz Cumpleaños! 🎉'::character varying,
  "birthday_email_template" text,
  "mass_email_template" text,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."membership_contracts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "branch_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "membership_plan_id" uuid NOT NULL,
  "status" VARCHAR(30) DEFAULT 'active'::character varying,
  "signed_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "signature_data" text,
  "client_selfie_url" text,
  "card_token" VARCHAR(255),
  "last_billed_at" TIMESTAMP WITH TIME ZONE,
  "next_billing_at" TIMESTAMP WITH TIME ZONE,
  "used_washes_this_cycle" integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."membership_plans" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "monthly_price" NUMERIC(12, 2) NOT NULL,
  "wash_limit_per_cycle" integer DEFAULT 4,
  "included_services" jsonb DEFAULT '[]'::jsonb,
  "status" VARCHAR(20) DEFAULT 'active'::character varying,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."payments" (
  "id" VARCHAR(100) NOT NULL,
  "client_id" VARCHAR(100),
  "plan_id" VARCHAR(50),
  "amount" NUMERIC(12, 2) NOT NULL,
  "method" VARCHAR(50) DEFAULT 'Efectivo'::character varying,
  "status" VARCHAR(50) DEFAULT 'Aprobado'::character varying,
  "gateway_ref" VARCHAR(255),
  "description" text,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "salon_id" VARCHAR(100) DEFAULT 1,
  "applied_by" VARCHAR(150),
  "cardnet_raw_response" jsonb,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."payroll_audit_logs" (
  "id" SERIAL,
  "payroll_id" integer NOT NULL,
  "employee_id" VARCHAR(100),
  "employee_name" VARCHAR(150),
  "field_name" VARCHAR(100),
  "old_value" VARCHAR(100),
  "new_value" VARCHAR(100),
  "action_type" VARCHAR(50),
  "reason" text,
  "user_name" VARCHAR(100) DEFAULT 'Administrador'::character varying,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."payroll_calculation_settings" (
  "id" SERIAL,
  "salario_mensual_base" NUMERIC(12, 2) DEFAULT 18421.00,
  "dias_laborables_mes" NUMERIC(12, 2) DEFAULT 23.83,
  "horas_jornada_completa" NUMERIC(12, 2) DEFAULT 8.00,
  "horas_media_jornada" NUMERIC(12, 2) DEFAULT 4.00,
  "recargo_horas_extras" NUMERIC(12, 2) DEFAULT 1.35,
  "recargo_feriado" NUMERIC(12, 2) DEFAULT 2.00,
  "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."payroll_concepts" (
  "id" SERIAL,
  "code" VARCHAR(50),
  "name" VARCHAR(150),
  "type" VARCHAR(50),
  "is_taxable" smallint DEFAULT 1,
  "is_active" smallint DEFAULT 1,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "activo" smallint DEFAULT 1,
  "tipo" VARCHAR(50),
  "nombre" VARCHAR(100),
  "formula_tipo" VARCHAR(50),
  "porcentaje" NUMERIC(12, 2) DEFAULT 0.00,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."payroll_items" (
  "id" SERIAL,
  "payroll_id" integer NOT NULL,
  "employee_id" VARCHAR(100) NOT NULL,
  "employee_name" VARCHAR(150) NOT NULL,
  "posicion" VARCHAR(100),
  "sucursal" VARCHAR(100),
  "departamento" VARCHAR(100),
  "salario_fijo" NUMERIC(12, 2) DEFAULT 0,
  "comisiones" NUMERIC(12, 2) DEFAULT 0,
  "feriados" NUMERIC(12, 2) DEFAULT 0,
  "horas_extras" NUMERIC(12, 2) DEFAULT 0,
  "otros_ingresos" NUMERIC(12, 2) DEFAULT 0,
  "total_ingresos" NUMERIC(12, 2) DEFAULT 0,
  "tss" NUMERIC(12, 2) DEFAULT 0,
  "servicios" NUMERIC(12, 2) DEFAULT 0,
  "prestamos" NUMERIC(12, 2) DEFAULT 0,
  "ausencias" NUMERIC(12, 2) DEFAULT 0,
  "tardanzas" NUMERIC(12, 2) DEFAULT 0,
  "otros_descuentos" NUMERIC(12, 2) DEFAULT 0,
  "total_descuentos" NUMERIC(12, 2) DEFAULT 0,
  "neto_pagar" NUMERIC(12, 2) DEFAULT 0,
  "detalles_json" text,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."payroll_periods" (
  "id" SERIAL,
  "period_name" VARCHAR(150) NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "total_empleados" integer DEFAULT 0,
  "total_neto" NUMERIC(12, 2) DEFAULT 0,
  "total_ingresos" NUMERIC(12, 2) DEFAULT 0,
  "total_descuentos" NUMERIC(12, 2) DEFAULT 0,
  "status" VARCHAR(50) DEFAULT 'En preparación'::character varying,
  "sucursal" VARCHAR(100) DEFAULT 'Todas'::character varying,
  "departamento" VARCHAR(100) DEFAULT 'Todos'::character varying,
  "is_immutable" smallint DEFAULT 0,
  "approved_by" VARCHAR(100),
  "approved_at" TIMESTAMP,
  "snapshot_json" text,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."payroll_records" (
  "id" SERIAL,
  "period_id" integer,
  "employee_id" VARCHAR(100),
  "employee_name" VARCHAR(150),
  "salon_id" VARCHAR(100),
  "base_salary" NUMERIC(12, 2) DEFAULT 0,
  "commissions" NUMERIC(12, 2) DEFAULT 0,
  "tips" NUMERIC(12, 2) DEFAULT 0,
  "bonuses" NUMERIC(12, 2) DEFAULT 0,
  "advances" NUMERIC(12, 2) DEFAULT 0,
  "discounts" NUMERIC(12, 2) DEFAULT 0,
  "tss_retention" NUMERIC(12, 2) DEFAULT 0,
  "isr_retention" NUMERIC(12, 2) DEFAULT 0,
  "net_salary" NUMERIC(12, 2) DEFAULT 0,
  "status" VARCHAR(50) DEFAULT 'Draft'::character varying,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."pending_surveys" (
  "id" VARCHAR(50) NOT NULL,
  "client_id" VARCHAR(100),
  "status" VARCHAR(30) DEFAULT 'Pending'::character varying,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."pending_tenant_reconciliations" (
  "id" SERIAL,
  "table_name" VARCHAR(100) NOT NULL,
  "record_id" VARCHAR(100) NOT NULL,
  "reason" VARCHAR(255) NOT NULL,
  "status" VARCHAR(50) DEFAULT 'unresolved'::character varying,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "resolved_at" TIMESTAMP WITH TIME ZONE,
  "resolved_tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."plans" (
  "id" VARCHAR(50) NOT NULL,
  "title" VARCHAR(100) NOT NULL,
  "price" NUMERIC(12, 2) NOT NULL,
  "activation_fee" NUMERIC(12, 2) DEFAULT 0.00,
  "discount" NUMERIC(12, 2) DEFAULT 0.00,
  "color" VARCHAR(30) DEFAULT 'blue'::character varying,
  "location" VARCHAR(100) DEFAULT 'Abatte Peluquería San Vicente'::character varying,
  "services" jsonb DEFAULT '[]'::jsonb,
  "promo_services" jsonb DEFAULT '[]'::jsonb,
  "promo_duration_months" integer DEFAULT 0,
  "usage_limits" jsonb DEFAULT '{"visits": 4, "services": "Ilimitados"}'::jsonb,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "tenant_id" uuid NOT NULL,
  "name" VARCHAR(255),
  "description" text,
  "features" jsonb
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."roles" (
  "id" SERIAL,
  "nombre" VARCHAR(100),
  "permisos" text,
  "description" text,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."saas_plans" (
  "id" SERIAL,
  "name" VARCHAR(100) NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "price" NUMERIC(12, 2) NOT NULL,
  "billing_cycle" VARCHAR(20) DEFAULT 'monthly'::character varying,
  "max_branches" integer DEFAULT 1,
  "max_employees" integer DEFAULT 5,
  "included_features" jsonb DEFAULT '{}'::jsonb,
  "is_active" boolean DEFAULT true,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "is_public" boolean DEFAULT true,
  "users_per_branch" integer DEFAULT 3,
  "extra_user_price" NUMERIC(12, 2) DEFAULT 15.00,
  "price_per_branch" NUMERIC(12, 2) DEFAULT 49.00,
  "description" text,
  "price_monthly" NUMERIC(12, 2),
  "price_yearly" NUMERIC(12, 2) DEFAULT 0,
  "slug" VARCHAR(100),
  "badge_text" VARCHAR(100),
  "is_featured" boolean DEFAULT false,
  "max_users" integer DEFAULT 5
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."salons" (
  "id" VARCHAR(100) NOT NULL,
  "name" VARCHAR(255),
  "address" text,
  "phone" VARCHAR(50),
  "maps_url" text,
  "tenant_id" uuid,
  "nombre" VARCHAR(255),
  "direccion" text,
  "telefono" VARCHAR(50),
  "status" VARCHAR(50) DEFAULT 'Active'::character varying
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."schedule_overrides" (
  "id" SERIAL,
  "employee_id" VARCHAR(100) NOT NULL,
  "date" date NOT NULL,
  "hora_entrada" VARCHAR(20),
  "hora_salida" VARCHAR(20),
  "reason" VARCHAR(255),
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "original_hora_entrada" VARCHAR(20),
  "original_hora_salida" VARCHAR(20),
  "new_hora_entrada" VARCHAR(20),
  "new_hora_salida" VARCHAR(20),
  "created_by" VARCHAR(150),
  "status" VARCHAR(50) DEFAULT 'Aprobado'::character varying,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."schema_migrations" (
  "version" VARCHAR(100) NOT NULL,
  "applied_at" TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "actor" VARCHAR(100) NOT NULL,
  "status" VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."security_audit_logs" (
  "id" SERIAL,
  "user_id" VARCHAR(100),
  "user_name" VARCHAR(150),
  "action" VARCHAR(100),
  "details" text,
  "ip_address" VARCHAR(100),
  "user_agent" text,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."security_requests" (
  "id" SERIAL,
  "client_name" VARCHAR(255),
  "client_id" integer,
  "service_name" VARCHAR(255),
  "staff_name" VARCHAR(255),
  "auth_code" VARCHAR(50),
  "type" VARCHAR(50),
  "status" VARCHAR(50) DEFAULT 'pending'::character varying,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP WITH TIME ZONE,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."security_settings" (
  "id" SERIAL,
  "max_login_attempts" integer DEFAULT 5,
  "lockout_duration_minutes" integer DEFAULT 30,
  "require_pin_for_discounts" boolean DEFAULT true,
  "session_timeout_minutes" integer DEFAULT 45,
  "ip_whitelist" text,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "active_otp_pin" VARCHAR(50),
  "otp_expires_at" TIMESTAMP,
  "admin_pin" VARCHAR(50) DEFAULT '1234'::character varying,
  "require_pin_for_settings" boolean DEFAULT true,
  "lockout_minutes" integer DEFAULT 30,
  "pin_notification_emails" VARCHAR(255),
  "max_failed_attempts" integer DEFAULT 5,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."service_categories" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "icon" VARCHAR(50),
  "sort_order" integer DEFAULT 0,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."services" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid,
  "category_id" uuid,
  "name" VARCHAR(255),
  "description" text,
  "price" NUMERIC(12, 2) NOT NULL,
  "duration_minutes" integer DEFAULT 45,
  "commission_percentage" NUMERIC(12, 2) DEFAULT 0.00,
  "is_active" boolean DEFAULT true,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "nombre" VARCHAR(255),
  "descripcion" text,
  "categoria" VARCHAR(100) DEFAULT 'General'::character varying,
  "precio" NUMERIC(12, 2),
  "activo" smallint DEFAULT 1,
  "genera_comision" smallint DEFAULT 1,
  "tipo_comision" VARCHAR(50) DEFAULT 'Porcentaje'::character varying,
  "comision_valor" NUMERIC(12, 2) DEFAULT 15.00,
  "aplica_itbis" smallint DEFAULT 0,
  "orden_visualizacion" integer DEFAULT 0,
  "imagen_url" text,
  "subcategoria" VARCHAR(100) DEFAULT 'General'::character varying,
  "costo" NUMERIC(12, 2) DEFAULT 0.00,
  "duracion" integer DEFAULT 30,
  "category" VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."staff_positions" (
  "id" SERIAL,
  "name" VARCHAR(100) NOT NULL,
  "description" VARCHAR(255),
  "base_salary" NUMERIC(12, 2) DEFAULT 0.00,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."staff_records" (
  "id" SERIAL,
  "nombre" VARCHAR(255) NOT NULL,
  "cedula" VARCHAR(50),
  "contacto" VARCHAR(50),
  "posicion" VARCHAR(100) DEFAULT 'Estilista'::character varying,
  "direccion" text,
  "localidad" VARCHAR(255),
  "fecha_entrada" date,
  "fecha_salida" date,
  "motivo_salida" text,
  "status" VARCHAR(50) DEFAULT 'Activo'::character varying,
  "profile_photo" text,
  "hora_entrada" time without time zone DEFAULT '08:00:00'::time without time zone,
  "hora_salida" time without time zone DEFAULT '18:00:00'::time without time zone,
  "dias_laborables" text DEFAULT 'Lunes a Sábado'::text,
  "tolerancia_minutos" integer DEFAULT 15,
  "salon_id" VARCHAR(100) DEFAULT 1,
  "email" VARCHAR(255),
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "commission_scheme_id" integer,
  "scheme_effective_date" date,
  "tipo_salario" VARCHAR(50) DEFAULT 'quincenal'::character varying,
  "salario_base" NUMERIC(12, 2) DEFAULT 0,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."surveys" (
  "id" VARCHAR(50) NOT NULL,
  "client_id" VARCHAR(100),
  "client_name" VARCHAR(150),
  "salon_id" VARCHAR(100) DEFAULT '1'::character varying,
  "salon_name" VARCHAR(150),
  "staff_peluquera" VARCHAR(150),
  "staff_lava_pelo" VARCHAR(150),
  "staff_manicurista" VARCHAR(150),
  "q1" integer,
  "q2" integer,
  "q3" integer,
  "q4" integer,
  "q5" integer,
  "q6" VARCHAR(50),
  "q7" VARCHAR(50),
  "q8" integer,
  "q9" text,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."tenant_settings" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "receipt_header" text,
  "receipt_footer" text DEFAULT '¡Gracias por preferirnos!'::text,
  "receipt_width" VARCHAR(10) DEFAULT '60mm'::character varying,
  "dgii_environment" VARCHAR(20) DEFAULT 'test'::character varying,
  "dgii_cert_encrypted" text,
  "dgii_cert_password_encrypted" text,
  "payment_gateway" VARCHAR(50),
  "gateway_merchant_id" VARCHAR(100),
  "gateway_api_key_encrypted" text,
  "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."tenant_subscriptions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "saas_plan_id" integer,
  "status" VARCHAR(30) DEFAULT 'active'::character varying,
  "started_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "current_period_end" TIMESTAMP WITH TIME ZONE NOT NULL,
  "cancel_at_period_end" boolean DEFAULT false,
  "payment_method" VARCHAR(50),
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."tenants" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "business_name" VARCHAR(255) NOT NULL,
  "legal_name" VARCHAR(255),
  "rnc" VARCHAR(20),
  "slug" VARCHAR(100) NOT NULL,
  "status" VARCHAR(30) DEFAULT 'active'::character varying,
  "email" VARCHAR(255) NOT NULL,
  "phone" VARCHAR(50),
  "country" VARCHAR(10) DEFAULT 'DO'::character varying,
  "currency" VARCHAR(10) DEFAULT 'DOP'::character varying,
  "logo_url" text,
  "primary_color" VARCHAR(20) DEFAULT '#0f172a'::character varying,
  "secondary_color" VARCHAR(20) DEFAULT '#d4af37'::character varying,
  "has_memberships" boolean DEFAULT false,
  "has_dgii_ecf" boolean DEFAULT false,
  "has_attendance_kiosk" boolean DEFAULT true,
  "has_payroll" boolean DEFAULT true,
  "trial_ends_at" TIMESTAMP WITH TIME ZONE,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "address" text,
  "website" text,
  "receipt_footer" text,
  "plan_id" integer,
  "licensed_branches" integer DEFAULT 1,
  "extra_user_seats" integer DEFAULT 0,
  "memberships_price" NUMERIC(12, 2) DEFAULT 29.00,
  "owner_name" VARCHAR(255),
  "owner_email" VARCHAR(255),
  "owner_phone" VARCHAR(50),
  "max_users" integer DEFAULT 5,
  "max_branches" integer DEFAULT 1,
  "modules_config" jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."ticket_sequences" (
  "id" SERIAL,
  "salon_id" VARCHAR(100) NOT NULL,
  "prefix" VARCHAR(20) DEFAULT 'SD'::character varying,
  "last_sequence" integer DEFAULT 0,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."user_sessions" (
  "id" VARCHAR(100) NOT NULL,
  "user_id" VARCHAR(100) NOT NULL,
  "user_name" VARCHAR(150),
  "role" VARCHAR(50),
  "salon_id" VARCHAR(100),
  "ip_address" VARCHAR(50),
  "user_agent" text,
  "device_info" VARCHAR(100),
  "is_active" integer DEFAULT 1,
  "last_activity" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."users" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid,
  "branch_id" uuid,
  "name" VARCHAR(255) NOT NULL,
  "email" VARCHAR(255) NOT NULL,
  "password_hash" VARCHAR(255) NOT NULL,
  "role" VARCHAR(50) NOT NULL,
  "phone" VARCHAR(50),
  "profile_photo" text,
  "admin_pin" VARCHAR(255),
  "is_active" boolean DEFAULT true,
  "last_login" TIMESTAMP WITH TIME ZONE,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "nombre" VARCHAR(150),
  "role_id" integer,
  "salon_id" VARCHAR(100),
  "hora_entrada" VARCHAR(50),
  "hora_salida" VARCHAR(50),
  "dias_laborables" VARCHAR(100),
  "tolerancia_minutos" integer DEFAULT 15,
  "tipo" VARCHAR(50) DEFAULT 'employee'::character varying,
  "password" VARCHAR(255),
  "username" VARCHAR(150),
  "estado" VARCHAR(50) DEFAULT 'Activo'::character varying
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."verification_codes" (
  "id" SERIAL,
  "client_id" VARCHAR(100),
  "code" VARCHAR(50),
  "is_used" integer DEFAULT 0,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP WITH TIME ZONE,
  "tenant_id" uuid
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}."visits" (
  "id" VARCHAR(100) NOT NULL,
  "client_id" VARCHAR(100),
  "client_name" VARCHAR(255),
  "servicios" jsonb DEFAULT '[]'::jsonb,
  "empleado_peluquera" VARCHAR(255),
  "empleado_manicurista" VARCHAR(255),
  "proxima_fecha" date,
  "recordatorio_auto" smallint DEFAULT 0,
  "total" NUMERIC(12, 2) DEFAULT 0.00,
  "subtotal" NUMERIC(12, 2) DEFAULT 0.00,
  "descuento" NUMERIC(12, 2) DEFAULT 0.00,
  "itbis" NUMERIC(12, 2) DEFAULT 0.00,
  "status" VARCHAR(50) DEFAULT 'Pendiente'::character varying,
  "metodo_pago" VARCHAR(100),
  "ticket_number" VARCHAR(50),
  "salon_id" VARCHAR(100) DEFAULT 1,
  "cash_register_id" VARCHAR(100),
  "nota" text,
  "ncf" VARCHAR(50),
  "ncf_type" VARCHAR(20),
  "void_reason" text,
  "voided_by" VARCHAR(255),
  "voided_at" TIMESTAMP WITH TIME ZONE,
  "visited_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "items_detail" jsonb DEFAULT '[]'::jsonb,
  "monto_recibido" NUMERIC(12, 2) DEFAULT 0.00,
  "devuelta" NUMERIC(12, 2) DEFAULT 0.00,
  "qr_code_url" text,
  "xml_signature" text,
  "secuencia_id" integer,
  "codigo_seguridad" VARCHAR(100),
  "rnc" VARCHAR(50),
  "rnc_cliente" VARCHAR(50),
  "rzn_soc_cliente" VARCHAR(255),
  "employee_consumption" NUMERIC(12, 2) DEFAULT 0.00,
  "gift_card_redemption" NUMERIC(12, 2) DEFAULT 0.00,
  "applied_payments" jsonb DEFAULT '[]'::jsonb,
  "draft_data" jsonb,
  "empleado_lava_pelo" VARCHAR(255),
  "ncf_nota_credito" VARCHAR(50),
  "nota_credito_motivo" text,
  "nota_credito_fecha" TIMESTAMP,
  "nota_credito_track_id" VARCHAR(100),
  "nota_credito_xml" text,
  "nota_credito_qr_url" text,
  "ncf_name" VARCHAR(150),
  "codigo_seguridad_ecf" VARCHAR(150),
  "tenant_id" uuid
);

ALTER TABLE {{SCHEMA}}."account_lockouts" ADD CONSTRAINT "account_lockouts_account_identifier_key" UNIQUE ("account_identifier");
ALTER TABLE {{SCHEMA}}."account_lockouts" ADD CONSTRAINT "account_lockouts_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."appointments" ADD CONSTRAINT "appointments_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."attendance" ADD CONSTRAINT "attendance_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."attendance_logs" ADD CONSTRAINT "attendance_logs_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."audit_logs" ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."billing_codes" ADD CONSTRAINT "billing_codes_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."blocked_ips" ADD CONSTRAINT "blocked_ips_ip_address_key" UNIQUE ("ip_address");
ALTER TABLE {{SCHEMA}}."blocked_ips" ADD CONSTRAINT "blocked_ips_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."branches" ADD CONSTRAINT "branches_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."cash_register_movements" ADD CONSTRAINT "cash_register_movements_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."cash_registers" ADD CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."cash_shifts" ADD CONSTRAINT "cash_shifts_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."clients" ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."commission_categories" ADD CONSTRAINT "commission_categories_nombre_key" UNIQUE ("nombre");
ALTER TABLE {{SCHEMA}}."commission_categories" ADD CONSTRAINT "commission_categories_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."commission_payouts" ADD CONSTRAINT "commission_payouts_payout_number_key" UNIQUE ("payout_number");
ALTER TABLE {{SCHEMA}}."commission_payouts" ADD CONSTRAINT "commission_payouts_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."commission_scheme_rules" ADD CONSTRAINT "commission_scheme_rules_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."commission_schemes" ADD CONSTRAINT "commission_schemes_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."company_ncf_counters" ADD CONSTRAINT "company_ncf_counters_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."company_ncf_counters" ADD CONSTRAINT "company_ncf_counters_tipo_comprobante_key" UNIQUE ("tipo_comprobante");
ALTER TABLE {{SCHEMA}}."contact_messages" ADD CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."contract_settings" ADD CONSTRAINT "contract_settings_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."contracts" ADD CONSTRAINT "contracts_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."dgii_606_purchases" ADD CONSTRAINT "dgii_606_purchases_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."dgii_ncf_sequences" ADD CONSTRAINT "dgii_ncf_sequences_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."email_logs" ADD CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."email_settings" ADD CONSTRAINT "email_settings_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."employee_commission_rules" ADD CONSTRAINT "employee_commission_rules_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."employee_commission_rules" ADD CONSTRAINT "unique_emp_service" UNIQUE ("employee_id", "service_name");
ALTER TABLE {{SCHEMA}}."employee_commissions_log" ADD CONSTRAINT "employee_commissions_log_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."employee_consumptions" ADD CONSTRAINT "employee_consumptions_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."employee_discounts" ADD CONSTRAINT "employee_discounts_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."employees" ADD CONSTRAINT "employees_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."expenses" ADD CONSTRAINT "expenses_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."gift_card_logs" ADD CONSTRAINT "gift_card_logs_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."gift_cards" ADD CONSTRAINT "gift_cards_code_key" UNIQUE ("code");
ALTER TABLE {{SCHEMA}}."gift_cards" ADD CONSTRAINT "gift_cards_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."holidays" ADD CONSTRAINT "holidays_date_key" UNIQUE ("date");
ALTER TABLE {{SCHEMA}}."holidays" ADD CONSTRAINT "holidays_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."invoice_items" ADD CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."invoices" ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."login_attempts" ADD CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."marketing_settings" ADD CONSTRAINT "marketing_settings_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."membership_contracts" ADD CONSTRAINT "membership_contracts_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."membership_plans" ADD CONSTRAINT "membership_plans_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."payments" ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."payroll_audit_logs" ADD CONSTRAINT "payroll_audit_logs_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."payroll_calculation_settings" ADD CONSTRAINT "payroll_calculation_settings_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."payroll_concepts" ADD CONSTRAINT "payroll_concepts_code_key" UNIQUE ("code");
ALTER TABLE {{SCHEMA}}."payroll_concepts" ADD CONSTRAINT "payroll_concepts_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."payroll_items" ADD CONSTRAINT "payroll_items_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."payroll_periods" ADD CONSTRAINT "payroll_periods_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."payroll_records" ADD CONSTRAINT "payroll_records_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."pending_surveys" ADD CONSTRAINT "pending_surveys_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."pending_tenant_reconciliations" ADD CONSTRAINT "pending_tenant_reconciliations_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."plans" ADD CONSTRAINT "plans_pkey" PRIMARY KEY ("tenant_id", "id");
ALTER TABLE {{SCHEMA}}."roles" ADD CONSTRAINT "roles_nombre_key" UNIQUE ("nombre");
ALTER TABLE {{SCHEMA}}."roles" ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."saas_plans" ADD CONSTRAINT "saas_plans_code_key" UNIQUE ("code");
ALTER TABLE {{SCHEMA}}."saas_plans" ADD CONSTRAINT "saas_plans_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."salons" ADD CONSTRAINT "salons_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."schedule_overrides" ADD CONSTRAINT "schedule_overrides_pkey" PRIMARY KEY ("id");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = '{{SCHEMA}}' AND t.relname = 'schema_migrations' AND c.contype = 'p'
  ) THEN
    ALTER TABLE {{SCHEMA}}."schema_migrations" ADD CONSTRAINT "schema_migrations_pkey" PRIMARY KEY ("version");
  END IF;
END $$;
ALTER TABLE {{SCHEMA}}."security_audit_logs" ADD CONSTRAINT "security_audit_logs_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."security_requests" ADD CONSTRAINT "security_requests_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."security_settings" ADD CONSTRAINT "security_settings_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."service_categories" ADD CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."services" ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."staff_positions" ADD CONSTRAINT "staff_positions_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."staff_records" ADD CONSTRAINT "staff_records_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."surveys" ADD CONSTRAINT "surveys_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."tenant_settings" ADD CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_key" UNIQUE ("tenant_id");
ALTER TABLE {{SCHEMA}}."tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."tenants" ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."tenants" ADD CONSTRAINT "tenants_slug_key" UNIQUE ("slug");
ALTER TABLE {{SCHEMA}}."ticket_sequences" ADD CONSTRAINT "ticket_sequences_salon_id_key" UNIQUE ("salon_id");
ALTER TABLE {{SCHEMA}}."user_sessions" ADD CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."users" ADD CONSTRAINT "uq_user_tenant_email" UNIQUE ("tenant_id", "email");
ALTER TABLE {{SCHEMA}}."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."verification_codes" ADD CONSTRAINT "verification_codes_pkey" PRIMARY KEY ("id");
ALTER TABLE {{SCHEMA}}."visits" ADD CONSTRAINT "visits_pkey" PRIMARY KEY ("id");

ALTER TABLE {{SCHEMA}}."appointments" ADD CONSTRAINT "fk_appointments_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."attendance" ADD CONSTRAINT "fk_attendance_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."attendance_logs" ADD CONSTRAINT "attendance_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."attendance_logs" ADD CONSTRAINT "attendance_logs_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES {{SCHEMA}}."employees"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."attendance_logs" ADD CONSTRAINT "attendance_logs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES {{SCHEMA}}."branches"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."audit_logs" ADD CONSTRAINT "fk_audit_logs_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."branches" ADD CONSTRAINT "fk_branches_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."branches" ADD CONSTRAINT "branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."cash_register_movements" ADD CONSTRAINT "fk_cash_register_movements_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."cash_registers" ADD CONSTRAINT "cash_registers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES {{SCHEMA}}."branches"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."cash_registers" ADD CONSTRAINT "fk_cash_registers_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."cash_registers" ADD CONSTRAINT "cash_registers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."cash_shifts" ADD CONSTRAINT "cash_shifts_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES {{SCHEMA}}."users"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."cash_shifts" ADD CONSTRAINT "cash_shifts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."cash_shifts" ADD CONSTRAINT "cash_shifts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES {{SCHEMA}}."branches"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."cash_shifts" ADD CONSTRAINT "cash_shifts_cash_register_id_fkey" FOREIGN KEY ("cash_register_id") REFERENCES {{SCHEMA}}."cash_registers"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."cash_shifts" ADD CONSTRAINT "cash_shifts_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES {{SCHEMA}}."users"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."clients" ADD CONSTRAINT "fk_clients_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."clients" ADD CONSTRAINT "clients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."clients" ADD CONSTRAINT "clients_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES {{SCHEMA}}."branches"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."commission_categories" ADD CONSTRAINT "fk_commission_categories_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."commission_payouts" ADD CONSTRAINT "fk_commission_payouts_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."commission_scheme_rules" ADD CONSTRAINT "fk_commission_scheme_rules_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."commission_schemes" ADD CONSTRAINT "fk_commission_schemes_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."company_ncf_counters" ADD CONSTRAINT "fk_company_ncf_counters_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."contract_settings" ADD CONSTRAINT "fk_contract_settings_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."contracts" ADD CONSTRAINT "fk_contracts_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."dgii_606_purchases" ADD CONSTRAINT "fk_dgii_606_purchases_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."dgii_ncf_sequences" ADD CONSTRAINT "fk_dgii_ncf_sequences_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."email_logs" ADD CONSTRAINT "fk_email_logs_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."email_settings" ADD CONSTRAINT "fk_email_settings_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."employee_commission_rules" ADD CONSTRAINT "fk_employee_commission_rules_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."employee_commissions_log" ADD CONSTRAINT "fk_employee_commissions_log_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."employee_consumptions" ADD CONSTRAINT "fk_employee_consumptions_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."employee_discounts" ADD CONSTRAINT "fk_employee_discounts_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES {{SCHEMA}}."users"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."employees" ADD CONSTRAINT "employees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."employees" ADD CONSTRAINT "employees_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES {{SCHEMA}}."branches"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."expenses" ADD CONSTRAINT "fk_expenses_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."gift_card_logs" ADD CONSTRAINT "fk_gift_card_logs_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."gift_cards" ADD CONSTRAINT "fk_gift_cards_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."holidays" ADD CONSTRAINT "fk_holidays_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."invoice_items" ADD CONSTRAINT "invoice_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES {{SCHEMA}}."services"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."invoice_items" ADD CONSTRAINT "invoice_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES {{SCHEMA}}."invoices"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."invoice_items" ADD CONSTRAINT "invoice_items_stylist_id_fkey" FOREIGN KEY ("stylist_id") REFERENCES {{SCHEMA}}."users"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."invoices" ADD CONSTRAINT "invoices_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES {{SCHEMA}}."users"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."invoices" ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."invoices" ADD CONSTRAINT "invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES {{SCHEMA}}."branches"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."invoices" ADD CONSTRAINT "invoices_cash_shift_id_fkey" FOREIGN KEY ("cash_shift_id") REFERENCES {{SCHEMA}}."cash_shifts"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."invoices" ADD CONSTRAINT "invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES {{SCHEMA}}."clients"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."marketing_settings" ADD CONSTRAINT "fk_marketing_settings_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."membership_contracts" ADD CONSTRAINT "membership_contracts_membership_plan_id_fkey" FOREIGN KEY ("membership_plan_id") REFERENCES {{SCHEMA}}."membership_plans"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."membership_contracts" ADD CONSTRAINT "membership_contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."membership_contracts" ADD CONSTRAINT "membership_contracts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES {{SCHEMA}}."branches"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."membership_contracts" ADD CONSTRAINT "membership_contracts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES {{SCHEMA}}."clients"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."membership_plans" ADD CONSTRAINT "membership_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."payments" ADD CONSTRAINT "fk_payments_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."payroll_audit_logs" ADD CONSTRAINT "fk_payroll_audit_logs_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."payroll_calculation_settings" ADD CONSTRAINT "fk_payroll_calculation_settings_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."payroll_concepts" ADD CONSTRAINT "fk_payroll_concepts_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."payroll_items" ADD CONSTRAINT "fk_payroll_items_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."payroll_periods" ADD CONSTRAINT "fk_payroll_periods_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."payroll_records" ADD CONSTRAINT "fk_payroll_records_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."pending_surveys" ADD CONSTRAINT "fk_pending_surveys_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."plans" ADD CONSTRAINT "fk_plans_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."roles" ADD CONSTRAINT "fk_roles_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."salons" ADD CONSTRAINT "fk_salons_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."salons" ADD CONSTRAINT "salons_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."schedule_overrides" ADD CONSTRAINT "fk_schedule_overrides_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."security_audit_logs" ADD CONSTRAINT "fk_security_audit_logs_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."security_requests" ADD CONSTRAINT "fk_security_requests_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."security_settings" ADD CONSTRAINT "fk_security_settings_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."service_categories" ADD CONSTRAINT "service_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."service_categories" ADD CONSTRAINT "fk_service_categories_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."services" ADD CONSTRAINT "fk_services_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."services" ADD CONSTRAINT "services_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES {{SCHEMA}}."service_categories"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."services" ADD CONSTRAINT "services_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."staff_positions" ADD CONSTRAINT "fk_staff_positions_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."staff_records" ADD CONSTRAINT "fk_staff_records_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."surveys" ADD CONSTRAINT "fk_surveys_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_saas_plan_id_fkey" FOREIGN KEY ("saas_plan_id") REFERENCES {{SCHEMA}}."saas_plans"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."tenants" ADD CONSTRAINT "tenants_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES {{SCHEMA}}."saas_plans"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."ticket_sequences" ADD CONSTRAINT "fk_ticket_sequences_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."user_sessions" ADD CONSTRAINT "fk_user_sessions_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."users" ADD CONSTRAINT "users_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES {{SCHEMA}}."branches"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."users" ADD CONSTRAINT "fk_users_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."verification_codes" ADD CONSTRAINT "fk_verification_codes_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;
ALTER TABLE {{SCHEMA}}."visits" ADD CONSTRAINT "fk_visits_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES {{SCHEMA}}."tenants"("id") ON DELETE CASCADE;

CREATE INDEX idx_appointments_tenant_id ON {{SCHEMA}}.appointments USING btree (tenant_id);
CREATE INDEX idx_attendance_tenant_id ON {{SCHEMA}}.attendance USING btree (tenant_id);
CREATE INDEX idx_attendance_logs_tenant_id ON {{SCHEMA}}.attendance_logs USING btree (tenant_id);
CREATE INDEX idx_attendance_tenant ON {{SCHEMA}}.attendance_logs USING btree (tenant_id);
CREATE INDEX idx_audit_logs_tenant_id ON {{SCHEMA}}.audit_logs USING btree (tenant_id);
CREATE INDEX idx_branches_tenant ON {{SCHEMA}}.branches USING btree (tenant_id);
CREATE INDEX idx_branches_tenant_id ON {{SCHEMA}}.branches USING btree (tenant_id);
CREATE INDEX idx_cash_register_movements_tenant_id ON {{SCHEMA}}.cash_register_movements USING btree (tenant_id);
CREATE INDEX idx_crm_register ON {{SCHEMA}}.cash_register_movements USING btree (cash_register_id);
CREATE INDEX idx_cash_registers_tenant_id ON {{SCHEMA}}.cash_registers USING btree (tenant_id);
CREATE INDEX idx_cash_shifts_tenant ON {{SCHEMA}}.cash_shifts USING btree (tenant_id);
CREATE INDEX idx_cash_shifts_tenant_id ON {{SCHEMA}}.cash_shifts USING btree (tenant_id);
CREATE INDEX idx_clients_tenant ON {{SCHEMA}}.clients USING btree (tenant_id);
CREATE INDEX idx_clients_tenant_id ON {{SCHEMA}}.clients USING btree (tenant_id);
CREATE INDEX idx_clients_tenant_phone ON {{SCHEMA}}.clients USING btree (tenant_id, phone);
CREATE INDEX idx_commission_categories_tenant_id ON {{SCHEMA}}.commission_categories USING btree (tenant_id);
CREATE INDEX idx_commission_payouts_tenant_id ON {{SCHEMA}}.commission_payouts USING btree (tenant_id);
CREATE INDEX idx_commission_scheme_rules_tenant_id ON {{SCHEMA}}.commission_scheme_rules USING btree (tenant_id);
CREATE INDEX idx_csr_scheme ON {{SCHEMA}}.commission_scheme_rules USING btree (scheme_id);
CREATE INDEX idx_commission_schemes_tenant_id ON {{SCHEMA}}.commission_schemes USING btree (tenant_id);
CREATE INDEX idx_company_ncf_counters_tenant_id ON {{SCHEMA}}.company_ncf_counters USING btree (tenant_id);
CREATE UNIQUE INDEX idx_company_ncf_counters_tenant_unique ON {{SCHEMA}}.company_ncf_counters USING btree (tenant_id);
CREATE INDEX idx_contract_settings_tenant_id ON {{SCHEMA}}.contract_settings USING btree (tenant_id);
CREATE UNIQUE INDEX idx_contract_settings_tenant_unique ON {{SCHEMA}}.contract_settings USING btree (tenant_id);
CREATE INDEX idx_contracts_client ON {{SCHEMA}}.contracts USING btree (client_id);
CREATE INDEX idx_contracts_tenant_id ON {{SCHEMA}}.contracts USING btree (tenant_id);
CREATE INDEX idx_dgii_606_purchases_tenant_id ON {{SCHEMA}}.dgii_606_purchases USING btree (tenant_id);
CREATE INDEX idx_dgii_ncf_sequences_tenant_id ON {{SCHEMA}}.dgii_ncf_sequences USING btree (tenant_id);
CREATE INDEX idx_email_logs_tenant_id ON {{SCHEMA}}.email_logs USING btree (tenant_id);
CREATE INDEX idx_email_settings_tenant_id ON {{SCHEMA}}.email_settings USING btree (tenant_id);
CREATE UNIQUE INDEX idx_email_settings_tenant_unique ON {{SCHEMA}}.email_settings USING btree (tenant_id);
CREATE INDEX idx_employee_commission_rules_tenant_id ON {{SCHEMA}}.employee_commission_rules USING btree (tenant_id);
CREATE INDEX idx_employee_commissions_log_tenant_id ON {{SCHEMA}}.employee_commissions_log USING btree (tenant_id);
CREATE INDEX idx_employee_consumptions_tenant_id ON {{SCHEMA}}.employee_consumptions USING btree (tenant_id);
CREATE INDEX idx_employee_discounts_tenant_id ON {{SCHEMA}}.employee_discounts USING btree (tenant_id);
CREATE INDEX idx_employees_tenant ON {{SCHEMA}}.employees USING btree (tenant_id);
CREATE INDEX idx_employees_tenant_id ON {{SCHEMA}}.employees USING btree (tenant_id);
CREATE INDEX idx_expenses_tenant ON {{SCHEMA}}.expenses USING btree (tenant_id);
CREATE INDEX idx_expenses_tenant_id ON {{SCHEMA}}.expenses USING btree (tenant_id);
CREATE INDEX idx_gift_card_logs_tenant_id ON {{SCHEMA}}.gift_card_logs USING btree (tenant_id);
CREATE INDEX idx_gift_cards_tenant_id ON {{SCHEMA}}.gift_cards USING btree (tenant_id);
CREATE INDEX idx_holidays_tenant_id ON {{SCHEMA}}.holidays USING btree (tenant_id);
CREATE INDEX idx_invoice_items_tenant ON {{SCHEMA}}.invoice_items USING btree (tenant_id);
CREATE INDEX idx_invoice_items_tenant_id ON {{SCHEMA}}.invoice_items USING btree (tenant_id);
CREATE INDEX idx_invoices_tenant ON {{SCHEMA}}.invoices USING btree (tenant_id);
CREATE INDEX idx_invoices_tenant_created ON {{SCHEMA}}.invoices USING btree (tenant_id, created_at);
CREATE INDEX idx_invoices_tenant_id ON {{SCHEMA}}.invoices USING btree (tenant_id);
CREATE INDEX idx_marketing_settings_tenant_id ON {{SCHEMA}}.marketing_settings USING btree (tenant_id);
CREATE UNIQUE INDEX idx_marketing_settings_tenant_unique ON {{SCHEMA}}.marketing_settings USING btree (tenant_id);
CREATE INDEX idx_membership_contracts_tenant ON {{SCHEMA}}.membership_contracts USING btree (tenant_id);
CREATE INDEX idx_membership_contracts_tenant_id ON {{SCHEMA}}.membership_contracts USING btree (tenant_id);
CREATE INDEX idx_membership_plans_tenant ON {{SCHEMA}}.membership_plans USING btree (tenant_id);
CREATE INDEX idx_membership_plans_tenant_id ON {{SCHEMA}}.membership_plans USING btree (tenant_id);
CREATE INDEX idx_payments_tenant_id ON {{SCHEMA}}.payments USING btree (tenant_id);
CREATE INDEX idx_payroll_audit_logs_tenant_id ON {{SCHEMA}}.payroll_audit_logs USING btree (tenant_id);
CREATE INDEX idx_payroll_calculation_settings_tenant_id ON {{SCHEMA}}.payroll_calculation_settings USING btree (tenant_id);
CREATE UNIQUE INDEX idx_payroll_calculation_settings_tenant_unique ON {{SCHEMA}}.payroll_calculation_settings USING btree (tenant_id);
CREATE INDEX idx_payroll_concepts_tenant_id ON {{SCHEMA}}.payroll_concepts USING btree (tenant_id);
CREATE INDEX idx_payroll_items_tenant_id ON {{SCHEMA}}.payroll_items USING btree (tenant_id);
CREATE INDEX idx_payroll_periods_tenant_id ON {{SCHEMA}}.payroll_periods USING btree (tenant_id);
CREATE INDEX idx_payroll_records_tenant_id ON {{SCHEMA}}.payroll_records USING btree (tenant_id);
CREATE INDEX idx_pending_surveys_tenant_id ON {{SCHEMA}}.pending_surveys USING btree (tenant_id);
CREATE UNIQUE INDEX uq_pending_rec_table_record ON {{SCHEMA}}.pending_tenant_reconciliations USING btree (table_name, record_id);
CREATE INDEX idx_plans_tenant_id ON {{SCHEMA}}.plans USING btree (tenant_id);
CREATE INDEX idx_roles_tenant_id ON {{SCHEMA}}.roles USING btree (tenant_id);
CREATE INDEX idx_salons_tenant_id ON {{SCHEMA}}.salons USING btree (tenant_id);
CREATE INDEX idx_schedule_overrides_tenant_id ON {{SCHEMA}}.schedule_overrides USING btree (tenant_id);
CREATE INDEX idx_security_audit_logs_tenant_id ON {{SCHEMA}}.security_audit_logs USING btree (tenant_id);
CREATE INDEX idx_security_requests_tenant_id ON {{SCHEMA}}.security_requests USING btree (tenant_id);
CREATE INDEX idx_security_settings_tenant_id ON {{SCHEMA}}.security_settings USING btree (tenant_id);
CREATE UNIQUE INDEX idx_security_settings_tenant_unique ON {{SCHEMA}}.security_settings USING btree (tenant_id);
CREATE INDEX idx_service_categories_tenant_id ON {{SCHEMA}}.service_categories USING btree (tenant_id);
CREATE INDEX idx_services_tenant ON {{SCHEMA}}.services USING btree (tenant_id);
CREATE INDEX idx_services_tenant_id ON {{SCHEMA}}.services USING btree (tenant_id);
CREATE INDEX idx_staff_positions_tenant_id ON {{SCHEMA}}.staff_positions USING btree (tenant_id);
CREATE UNIQUE INDEX idx_staff_positions_tenant_name ON {{SCHEMA}}.staff_positions USING btree (tenant_id, name);
CREATE INDEX idx_staff_records_tenant_id ON {{SCHEMA}}.staff_records USING btree (tenant_id);
CREATE INDEX idx_surveys_tenant_id ON {{SCHEMA}}.surveys USING btree (tenant_id);
CREATE INDEX idx_tenant_settings_tenant_id ON {{SCHEMA}}.tenant_settings USING btree (tenant_id);
CREATE INDEX idx_tenant_subscriptions_tenant_id ON {{SCHEMA}}.tenant_subscriptions USING btree (tenant_id);
CREATE INDEX idx_ticket_sequences_tenant_id ON {{SCHEMA}}.ticket_sequences USING btree (tenant_id);
CREATE UNIQUE INDEX idx_ticket_sequences_tenant_salon ON {{SCHEMA}}.ticket_sequences USING btree (tenant_id, salon_id);
CREATE INDEX idx_user_sessions_tenant_id ON {{SCHEMA}}.user_sessions USING btree (tenant_id);
CREATE INDEX idx_users_tenant ON {{SCHEMA}}.users USING btree (tenant_id);
CREATE INDEX idx_users_tenant_id ON {{SCHEMA}}.users USING btree (tenant_id);
CREATE INDEX idx_verification_codes_tenant_id ON {{SCHEMA}}.verification_codes USING btree (tenant_id);
CREATE INDEX idx_visits_salon ON {{SCHEMA}}.visits USING btree (salon_id);
CREATE INDEX idx_visits_tenant_id ON {{SCHEMA}}.visits USING btree (tenant_id);
CREATE INDEX idx_visits_ticket ON {{SCHEMA}}.visits USING btree (ticket_number);
CREATE INDEX idx_visits_visited_at ON {{SCHEMA}}.visits USING btree (visited_at);

-- QUARANTINE ENFORCEMENT FUNCTION & TRIGGERS (NATIVE DDL DEFINITION)
CREATE OR REPLACE FUNCTION {{SCHEMA}}.fn_enforce_quarantine_block()
RETURNS TRIGGER AS $$
DECLARE
  v_is_quarantined BOOLEAN := FALSE;
  v_authorized TEXT := 'false';
BEGIN
  BEGIN
    v_authorized := current_setting('salon.authorized_quarantine_resolution', true);
  EXCEPTION WHEN OTHERS THEN
    v_authorized := 'false';
  END;

  IF v_authorized = 'true' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM {{SCHEMA}}.pending_tenant_reconciliations 
    WHERE table_name = TG_TABLE_NAME 
      AND record_id = OLD.id::text 
      AND status = 'quarantined'
  ) INTO v_is_quarantined;

  IF v_is_quarantined THEN
    RAISE EXCEPTION 'QUARANTINE_VIOLATION: Record % in table % is quarantined in pending_tenant_reconciliations and cannot be updated, deleted, or reassigned without authorized resolution.', OLD.id, TG_TABLE_NAME;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_quarantine_salons
BEFORE UPDATE OR DELETE ON {{SCHEMA}}.salons
FOR EACH ROW EXECUTE FUNCTION {{SCHEMA}}.fn_enforce_quarantine_block();

CREATE TRIGGER trg_quarantine_cash_registers
BEFORE UPDATE OR DELETE ON {{SCHEMA}}.cash_registers
FOR EACH ROW EXECUTE FUNCTION {{SCHEMA}}.fn_enforce_quarantine_block();

CREATE TRIGGER trg_quarantine_visits
BEFORE UPDATE OR DELETE ON {{SCHEMA}}.visits
FOR EACH ROW EXECUTE FUNCTION {{SCHEMA}}.fn_enforce_quarantine_block();

CREATE TRIGGER trg_quarantine_ticket_sequences
BEFORE UPDATE OR DELETE ON {{SCHEMA}}.ticket_sequences
FOR EACH ROW EXECUTE FUNCTION {{SCHEMA}}.fn_enforce_quarantine_block();

