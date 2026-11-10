/**
 * DEPRECATED & SUPERSEDED MIGRATION - DO NOT EXECUTE
 * 
 * This legacy migration has been permanently disabled because it previously performed
 * an indiscriminate backfill with DEFAULT_TENANT_ID and hardcoded administrative credentials.
 * It is superseded by `backend/migrations/migrate_phase1_corrective.cjs`.
 */
console.error('\n❌ [FATAL SECURITY ERROR]: Esta migración (migrate_phase1_multitenant_isolation.cjs) ha sido OBSOLETA Y PERMANENTEMENTE DESHABILITADA (SUPERSEDED).');
console.error('Razón: Asignación indiscriminada de DEFAULT_TENANT_ID y credenciales inseguras.');
console.error('Acción: Utilice exclusivamente backend/migrations/migrate_phase1_corrective.cjs.\n');

if (require.main === module) {
  process.exit(1);
}

module.exports = {
  runMigration: async () => {
    throw new Error('MIGRATION_SUPERSEDED: migrate_phase1_multitenant_isolation.cjs está permanentemente deshabilitada.');
  }
};
