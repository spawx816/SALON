/**
 * Negative Fixture 12: Worker loading backend/.env
 * Must trigger: PROHIBITED_ENV_LOADING_IN_WORKER
 */
const dotenv = require('dotenv');
dotenv.config({ path: '../backend/.env' });

function runWorker() {
  // worker execution
}

module.exports = { runWorker };

