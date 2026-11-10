/**
 * Helper Server for Graceful Shutdown Tests
 * (backend/tests/helpers/shutdown_test_server.cjs)
 */

'use strict';

const express = require('express');
const http = require('http');
const { GracefulShutdownCoordinator } = require('../../utils/graceful_shutdown.coordinator.cjs');

const timeoutMs = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '3000', 10);
const coordinator = new GracefulShutdownCoordinator({ timeoutMs });

const app = express();
app.use(express.json());
app.use(coordinator.createMiddleware());

// In-flight slow request endpoint
app.get('/slow-operation', async (req, res) => {
  const delay = parseInt(req.query.delay || '800', 10);
  setTimeout(() => {
    res.json({ success: true, message: 'Operación lenta completada con éxito' });
  }, delay);
});

// Normal operation endpoint
app.post('/test-mutation', (req, res) => {
  res.json({ success: true, processed: true });
});

// Cleanup task
let cleanupExecuted = false;
coordinator.registerCleanupTask(async () => {
  if (process.env.SIMULATE_HANGING_CLEANUP === 'true') {
    // Hang forever to test force timeout
    await new Promise(() => {});
  }
  cleanupExecuted = true;
}, 'mock_db_pool_close');

const server = http.createServer(app);
coordinator.registerServer(server);
coordinator.attachProcessSignals();

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  if (process.send) {
    process.send({ event: 'listening', port });
  } else {
    console.log(`READY_PORT:${port}`);
  }
});

