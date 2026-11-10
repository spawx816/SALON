/**
 * Negative Fixture 11: Hostname conditioning on 'SPAWX'
 * Must trigger: PROHIBITED_HOSTNAME_REFERENCE
 */
const os = require('os');

function checkEnvironment() {
  if (os.hostname() === 'SPAWX') {
    return 'local-dev-bypass';
  }
  return 'standard';
}

module.exports = { checkEnvironment };

