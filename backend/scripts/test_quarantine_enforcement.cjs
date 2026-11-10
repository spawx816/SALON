/**
 * Quarantine Enforcement Test Entrypoint
 * 
 * Executes strictly against synthetic replicas in isolated test sandbox.
 * Never operates on production data.
 */
const { runSyntheticQuarantineSuite } = require('./test_synthetic_quarantine_all7.cjs');

if (require.main === module) {
  runSyntheticQuarantineSuite()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[FATAL QUARANTINE ENFORCEMENT ERROR]:', err);
      process.exit(1);
    });
}

module.exports = { runSyntheticQuarantineSuite };
