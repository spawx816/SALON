'use strict';

const crypto = require('crypto');

const DOCUMENT_TYPES = Object.freeze([
  'ticket_turno',
  'ticket_venta',
  'factura_comercial',
  'comanda_restaurante',
]);

const ALLOWED_PAPER_WIDTHS = Object.freeze(['58mm', '80mm', 'A4']);
const ALLOWED_NUMBERING_MODES = Object.freeze(['daily_reset', 'continuous']);
const ALLOWED_ALIGNS = Object.freeze(['left', 'center', 'right']);
const ALLOWED_SIZES = Object.freeze(['sm', 'md', 'lg', 'xl']);

const ALLOWED_BLOCK_IDS = Object.freeze([
  'logo',
  'business_name',
  'turn_label',
  'turn_number',
  'datetime',
  'service',
  'observations',
  'customer',
  'items_table',
  'totals',
  'fiscal_info',
  'qr',
  'footer',
]);

const DEFAULT_TEMPLATES = Object.freeze({
  ticket_turno: {
    name: 'Ticket de Turno Estándar (Car Wash)',
    paper_width: '80mm',
    numbering_mode: 'daily_reset',
    timezone: 'America/Santo_Domingo',
    config_json: {
      monochrome: true,
      show_logo: true,
      logo_url: '',
      title_text: 'TU TURNO',
      footer_text: 'Gracias por preferirnos. Conserva este ticket.',
      blocks: [
        { id: 'logo', label: 'Logo de la empresa', visible: true, align: 'center', size: 'md' },
        { id: 'business_name', label: 'Nombre de la empresa', visible: true, align: 'center', size: 'lg' },
        { id: 'turn_label', label: 'Título del turno', visible: true, align: 'center', size: 'md' },
        { id: 'turn_number', label: 'Número de turno', visible: true, align: 'center', size: 'xl' },
        { id: 'datetime', label: 'Fecha y hora', visible: true, align: 'center', size: 'sm' },
        { id: 'service', label: 'Servicio', visible: true, align: 'left', size: 'md' },
        { id: 'observations', label: 'Observaciones', visible: true, align: 'left', size: 'sm' },
        { id: 'footer', label: 'Mensaje inferior', visible: true, align: 'center', size: 'sm' },
      ],
    },
  },
  ticket_venta: {
    name: 'Ticket de Venta / Pre-Cuenta POS',
    paper_width: '80mm',
    numbering_mode: 'continuous',
    timezone: 'America/Santo_Domingo',
    config_json: {
      monochrome: true,
      show_logo: true,
      logo_url: '',
      title_text: 'TICKET DE SERVICIOS',
      footer_text: '¡Gracias por preferirnos! ♡',
      checklist_mode: 'catalog_checklist',
      show_benefits_box: true,
      show_qr_menu: true,
      checklist_items: [],
      blocks: [
        { id: 'logo', label: 'Logo de la empresa', visible: true, align: 'center', size: 'md' },
        { id: 'business_name', label: 'Nombre de la empresa', visible: true, align: 'center', size: 'lg' },
        { id: 'datetime', label: 'Ticket No., fecha y hora', visible: true, align: 'left', size: 'sm' },
        { id: 'customer', label: 'Cliente y recepcionista', visible: true, align: 'left', size: 'sm' },
        { id: 'items_table', label: 'Listado de productos/servicios', visible: true, align: 'left', size: 'sm' },
        { id: 'totals', label: 'Caja TOTAL RD$', visible: true, align: 'right', size: 'md' },
        { id: 'qr', label: 'Código QR Menú', visible: true, align: 'center', size: 'sm' },
        { id: 'footer', label: 'Mensaje inferior', visible: true, align: 'center', size: 'sm' },
      ],
    },
  },
  factura_comercial: {
    name: 'Factura Comercial Estándar',
    paper_width: 'A4',
    numbering_mode: 'continuous',
    timezone: 'America/Santo_Domingo',
    config_json: {
      monochrome: false,
      show_logo: true,
      logo_url: '',
      title_text: 'FACTURA COMERCIAL',
      footer_text: 'Documento comercial emitido por el sistema.',
      blocks: [
        { id: 'logo', label: 'Logo de la empresa', visible: true, align: 'left', size: 'md' },
        { id: 'business_name', label: 'Datos de la empresa', visible: true, align: 'left', size: 'lg' },
        { id: 'fiscal_info', label: 'NCF y datos fiscales (datos reales)', visible: true, align: 'right', size: 'sm' },
        { id: 'datetime', label: 'Fecha de emisión', visible: true, align: 'left', size: 'sm' },
        { id: 'customer', label: 'Datos del cliente', visible: true, align: 'left', size: 'sm' },
        { id: 'items_table', label: 'Tabla de servicios/productos (datos reales)', visible: true, align: 'left', size: 'sm' },
        { id: 'totals', label: 'Subtotal, ITBIS y Total (datos reales)', visible: true, align: 'right', size: 'md' },
        { id: 'footer', label: 'Pie de factura', visible: true, align: 'center', size: 'sm' },
      ],
    },
  },
});

function stripUnsafeText(value, maxLen = 240) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim()
    .slice(0, maxLen);
}

function sanitizeLogoUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (/^\/(uploads|icon-|logo|apple-touch-icon|plan-beauty)/i.test(trimmed) && !trimmed.includes('..')) {
    return trimmed.slice(0, 300);
  }
  if (/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(trimmed) && trimmed.length <= 200000) {
    return trimmed;
  }
  return '';
}

function validateTimezone(tz) {
  const candidate = String(tz || 'America/Santo_Domingo').trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return 'America/Santo_Domingo';
  }
}

function resolveOperationalDate(timezone = 'America/Santo_Domingo', dateObj = new Date()) {
  const safeTz = validateTimezone(timezone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(dateObj);
  const map = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
}

function sanitizeTemplateConfig(rawConfig, documentType) {
  const baseDefault = DEFAULT_TEMPLATES[documentType] || DEFAULT_TEMPLATES.ticket_turno;
  const src = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const defaultBlocks = baseDefault.config_json.blocks;

  const incomingBlocks = Array.isArray(src.blocks) ? src.blocks : defaultBlocks;
  const seen = new Set();
  const sanitizedBlocks = [];

  for (const b of incomingBlocks) {
    if (!b || typeof b !== 'object') continue;
    const id = String(b.id || '').trim();
    if (!ALLOWED_BLOCK_IDS.includes(id) || seen.has(id)) continue;
    seen.add(id);
    const defBlock = defaultBlocks.find((d) => d.id === id) || { label: id, visible: true, align: 'left', size: 'md' };
    sanitizedBlocks.push({
      id,
      label: stripUnsafeText(b.label || defBlock.label, 80) || defBlock.label,
      visible: b.visible === undefined ? Boolean(defBlock.visible) : Boolean(b.visible),
      align: ALLOWED_ALIGNS.includes(b.align) ? b.align : defBlock.align,
      size: ALLOWED_SIZES.includes(b.size) ? b.size : defBlock.size,
    });
  }

  for (const defBlock of defaultBlocks) {
    if (!seen.has(defBlock.id)) {
      sanitizedBlocks.push({ ...defBlock });
    }
  }

  const sanitizedChecklist = Array.isArray(src.checklist_items)
    ? src.checklist_items
        .filter((it) => it && typeof it === 'object' && stripUnsafeText(it.name, 100))
        .slice(0, 30)
        .map((it) => ({
          id: stripUnsafeText(String(it.id || it.name), 80),
          name: stripUnsafeText(it.name, 100),
        }))
    : [];

  return {
    monochrome: src.monochrome === undefined ? Boolean(baseDefault.config_json.monochrome) : Boolean(src.monochrome),
    show_logo: src.show_logo === undefined ? Boolean(baseDefault.config_json.show_logo) : Boolean(src.show_logo),
    logo_url: sanitizeLogoUrl(src.logo_url),
    title_text: stripUnsafeText(src.title_text ?? baseDefault.config_json.title_text, 80),
    footer_text: stripUnsafeText(src.footer_text ?? baseDefault.config_json.footer_text, 240),
    checklist_mode: src.checklist_mode === 'cart_items' ? 'cart_items' : 'catalog_checklist',
    show_benefits_box: src.show_benefits_box === undefined ? true : Boolean(src.show_benefits_box),
    show_qr_menu: src.show_qr_menu === undefined ? true : Boolean(src.show_qr_menu),
    checklist_items: sanitizedChecklist,
    blocks: sanitizedBlocks,
  };
}

async function hasRestaurantOperationalData(pool) {
  try {
    const [rows] = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name IN ('restaurant_tables', 'restaurant_orders', 'kitchen_orders')
       LIMIT 1`
    );
    return Boolean(rows && rows.length > 0);
  } catch {
    return false;
  }
}

async function resolveActiveTemplate(pool, tenantId, documentType, branchId = null) {
  const safeType = DOCUMENT_TYPES.includes(documentType) ? documentType : 'ticket_turno';
  const def = DEFAULT_TEMPLATES[safeType] || DEFAULT_TEMPLATES.ticket_turno;

  try {
    const [rows] = await pool.query(
      `SELECT * FROM print_templates
       WHERE tenant_id = ?
         AND document_type = ?
         AND status = 'published'
         AND (branch_id = ? OR branch_id IS NULL)
       ORDER BY
         CASE WHEN branch_id = ? THEN 0 ELSE 1 END,
         is_default DESC,
         updated_at DESC
       LIMIT 1`,
      [tenantId, safeType, branchId || null, branchId || null]
    );
    if (rows && rows.length > 0) {
      const tpl = rows[0];
      return {
        id: tpl.id,
        name: tpl.name,
        document_type: tpl.document_type,
        paper_width: tpl.paper_width,
        numbering_mode: tpl.numbering_mode,
        timezone: validateTimezone(tpl.timezone),
        version: Number(tpl.published_version || tpl.version || 1),
        config_json: sanitizeTemplateConfig(tpl.published_config_json || tpl.config_json, safeType),
      };
    }
  } catch {
    // Fallback to default
  }

  return {
    id: null,
    name: def.name,
    document_type: safeType,
    paper_width: def.paper_width,
    numbering_mode: def.numbering_mode,
    timezone: def.timezone,
    version: 1,
    config_json: sanitizeTemplateConfig(def.config_json, safeType),
  };
}

async function issueTurnTicket(pool, {
  tenantId,
  branchId = 'default',
  serviceName = null,
  observations = null,
  customerLabel = null,
  idempotencyKey = null,
  actorUserId = null,
  now = new Date(),
}) {
  if (!tenantId) {
    const err = new Error('tenantId es obligatorio para emitir turno.');
    err.statusCode = 400;
    throw err;
  }

  const safeBranch = String(branchId || 'default').trim() || 'default';
  const safeIdemKey = idempotencyKey ? String(idempotencyKey).trim().slice(0, 120) : null;

  if (safeIdemKey) {
    const [existing] = await pool.query(
      'SELECT * FROM turn_tickets WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1',
      [tenantId, safeIdemKey]
    );
    if (existing && existing.length > 0) {
      return { ticket: existing[0], idempotentReplay: true };
    }
  }

  const activeTemplate = await resolveActiveTemplate(pool, tenantId, 'ticket_turno', safeBranch);
  const numberingMode = ALLOWED_NUMBERING_MODES.includes(activeTemplate.numbering_mode)
    ? activeTemplate.numbering_mode
    : 'daily_reset';
  const timezone = validateTimezone(activeTemplate.timezone);
  const operationalDate = numberingMode === 'continuous'
    ? 'CONTINUOUS'
    : resolveOperationalDate(timezone, now);

  const [counterRows] = await pool.query(
    `INSERT INTO turn_ticket_counters (tenant_id, branch_id, operational_date, last_number, updated_at)
     VALUES (?, ?, ?, 1, NOW())
     ON CONFLICT (tenant_id, branch_id, operational_date)
     DO UPDATE SET last_number = turn_ticket_counters.last_number + 1, updated_at = NOW()
     RETURNING last_number`,
    [tenantId, safeBranch, operationalDate]
  );

  const turnNumber = Number(counterRows?.[0]?.last_number || 1);
  const displayNumber = String(turnNumber).padStart(3, '0');
  const ticketId = crypto.randomUUID();
  const safeService = stripUnsafeText(serviceName, 200) || null;
  const safeObs = stripUnsafeText(observations, 500) || null;
  const safeCustomer = stripUnsafeText(customerLabel, 120) || null;

  const snapshot = {
    paper_width: activeTemplate.paper_width,
    numbering_mode: numberingMode,
    timezone,
    config_json: activeTemplate.config_json,
  };

  const [inserted] = await pool.query(
    `INSERT INTO turn_tickets (
       id, tenant_id, branch_id, operational_date, turn_number, display_number,
       numbering_mode, timezone, service_name, observations, customer_label,
       template_id, template_version, template_snapshot, idempotency_key,
       issued_by_user_id, issued_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     RETURNING *`,
    [
      ticketId,
      tenantId,
      safeBranch,
      operationalDate,
      turnNumber,
      displayNumber,
      numberingMode,
      timezone,
      safeService,
      safeObs,
      safeCustomer,
      activeTemplate.id || null,
      activeTemplate.version,
      JSON.stringify(snapshot),
      safeIdemKey,
      actorUserId ? String(actorUserId) : null,
    ]
  );

  return {
    ticket: inserted?.[0] || {
      id: ticketId,
      tenant_id: tenantId,
      branch_id: safeBranch,
      operational_date: operationalDate,
      turn_number: turnNumber,
      display_number: displayNumber,
      numbering_mode: numberingMode,
      timezone,
      service_name: safeService,
      observations: safeObs,
      customer_label: safeCustomer,
      template_id: activeTemplate.id || null,
      template_version: activeTemplate.version,
      template_snapshot: snapshot,
      issued_at: now.toISOString(),
    },
    idempotentReplay: false,
  };
}

module.exports = {
  DOCUMENT_TYPES,
  ALLOWED_PAPER_WIDTHS,
  ALLOWED_NUMBERING_MODES,
  DEFAULT_TEMPLATES,
  stripUnsafeText,
  sanitizeLogoUrl,
  validateTimezone,
  resolveOperationalDate,
  sanitizeTemplateConfig,
  hasRestaurantOperationalData,
  resolveActiveTemplate,
  issueTurnTicket,
};
