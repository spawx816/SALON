/**
 * Negative Fixture 10: Server entrypoint containing setInterval scheduler
 * Must trigger: PROHIBITED_SCHEDULER_IN_WEB_SERVER
 */
const express = require('express');
const app = express();

setInterval(() => {
  console.log('Running background task inside web server process');
}, 60000);

module.exports = app;

