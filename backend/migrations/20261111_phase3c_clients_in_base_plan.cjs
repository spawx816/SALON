/**
 * Migration: 20261111_phase3c_clients_in_base_plan
 *
 * Cambio funcional limitado de la matriz de planes:
 *   - Clientes/CRM (`clients`) pasa a estar INCLUIDO en BASE y se conserva en PRO.
 *   - `memberships` y `marketing` continúan EXCLUIDOS en BASE (sin cambios).
 *
 * Alcance estricto (idempotente, re-ejecutable):
 *   - Solo catálogo global: saas_features, saas_plan_features y saas_plans (descripción / included_features legado).
 *   - NO toca tenants, tenant_subscriptions, overrides por tenant, clients, contracts ni ningún dato operativo.
 *   - NO crea overrides manuales: los tenants BASE existentes obtienen acceso vía el catálogo canónico
 *     (CANONICAL_PLAN_FEATURES), que es la fuente de verdad del servicio de entitlements.
 */

'use strict';

async function up(targetPool, targetSchema = 'public') {
  const conn = await targetPool.getConnection();
  try {
    const schema = targetSchema || 'public';
    await conn.query(`SET search_path TO "${schema}";`);

    console.log(`[MIGRATION 20261111_phase3c_clients_in_base_plan] Incluyendo Clientes/CRM en Plan BASE (esquema "${schema}")...`);

    // 1. Feature `clients`: ya no es exclusivo PRO (categoría 'core').
    await conn.query(`
      INSERT INTO saas_features (key, name, description, category)
      VALUES ('clients', 'Directorio CRM de Clientes', 'Fichas de clientes, historial de visitas y preferencias (incluido en BASE y PRO)', 'core')
      ON CONFLICT (key) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        category = EXCLUDED.category;
    `);

    // 2. Matriz canónica plan -> feature (única fuente de verdad en BD).
    const mappings = [
      ['BASE', 'clients', true],
      ['PRO', 'clients', true],
      // Se reafirman las exclusiones BASE para garantizar que la migración NUNCA habilite membresías ni marketing.
      ['BASE', 'memberships', false],
      ['BASE', 'marketing', false],
      ['PRO', 'memberships', true],
      ['PRO', 'marketing', true]
    ];
    for (const [planCode, featureKey, isIncluded] of mappings) {
      await conn.query(`
        INSERT INTO saas_plan_features (plan_code, feature_key, is_included)
        VALUES ($1, $2, $3)
        ON CONFLICT (plan_code, feature_key) DO UPDATE SET is_included = EXCLUDED.is_included;
      `, [planCode, featureKey, isIncluded]);
    }

    // 3. Descripciones comerciales y JSON legado `included_features` (solo clave `clients` en BASE).
    await conn.query(`
      UPDATE saas_plans
      SET description = 'POS, facturación DGII, cajas, directorio CRM de clientes, comisiones y nómina.'
      WHERE UPPER(code) = 'BASE';
    `);
    await conn.query(`
      UPDATE saas_plans
      SET description = 'Todo lo de Base + membresías recurrentes, contratos y marketing.'
      WHERE UPPER(code) = 'PRO';
    `);

    const colCheck = await conn.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'saas_plans' AND column_name = 'included_features'
      LIMIT 1;
    `, [schema]);
    const hasIncludedFeatures = Array.isArray(colCheck) && colCheck[0] && colCheck[0].length > 0;
    if (hasIncludedFeatures) {
      await conn.query(`
        UPDATE saas_plans
        SET included_features = COALESCE(included_features, '{}'::jsonb) || '{"clients": true}'::jsonb
        WHERE UPPER(code) IN ('BASE', 'PRO');
      `);
    }

    console.log('[MIGRATION 20261111_phase3c_clients_in_base_plan] Completada (idempotente, sin cambios en datos de tenants).');
  } finally {
    conn.release();
  }
}

module.exports = { up };

