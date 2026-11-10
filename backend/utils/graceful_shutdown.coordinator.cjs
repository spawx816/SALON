/**
 * Graceful Shutdown Coordinator
 * (backend/utils/graceful_shutdown.coordinator.cjs)
 * 
 * Manages clean process termination upon SIGTERM, SIGINT, and unhandled errors.
 * Rejects new connections immediately, allows active transactions to drain,
 * and releases database connections and background tasks safely.
 */

'use strict';

class GracefulShutdownCoordinator {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || 5000;
    this.logger = options.logger || console;
    this.isShuttingDown = false;
    this.cleanupTasks = [];
    this.servers = [];
    this.activeRequests = 0;
  }

  registerServer(server) {
    if (server && typeof server.close === 'function') {
      this.servers.push(server);
    }
  }

  registerCleanupTask(fn, name = 'anonymous_cleanup') {
    if (typeof fn === 'function') {
      this.cleanupTasks.push({ fn, name });
    }
  }

  isDraining() {
    return this.isShuttingDown;
  }

  createMiddleware() {
    return (req, res, next) => {
      // Healthcheck response during draining
      if (req.path === '/health' || req.path === '/api/health') {
        if (this.isShuttingDown) {
          return res.status(503).json({
            status: 'draining',
            message: 'Servidor en proceso de parada controlada (Graceful Shutdown).'
          });
        }
        return res.status(200).json({ status: 'healthy' });
      }

      // Reject new operations during shutdown
      if (this.isShuttingDown) {
        res.setHeader('Connection', 'close');
        return res.status(503).json({
          error: 'Servidor apagándose. No se admiten nuevas peticiones.',
          code: 'SERVER_SHUTTING_DOWN'
        });
      }

      // Track in-flight active request
      this.activeRequests++;
      let closed = false;
      const done = () => {
        if (!closed) {
          closed = true;
          this.activeRequests = Math.max(0, this.activeRequests - 1);
        }
      };

      res.on('finish', done);
      res.on('close', done);
      next();
    };
  }

  async shutdown(signal = 'SIGTERM', exitProcess = true) {
    // Atomic check: Prevent executing shutdown twice
    if (this.isShuttingDown) {
      this.logger.log(`[SHUTDOWN] Señal ${signal} recibida mientras el apagado ya está en curso. Ignorando.`);
      return;
    }
    this.isShuttingDown = true;
    this.logger.log(`[SHUTDOWN] Iniciando parada controlada por señal: ${signal}...`);

    let forceExitTimer = null;
    if (exitProcess) {
      forceExitTimer = setTimeout(() => {
        this.logger.error(`[SHUTDOWN TIMEOUT] Tiempo límite de ${this.timeoutMs}ms excedido. Forzando salida.`);
        process.exit(1);
      }, this.timeoutMs);
      if (forceExitTimer.unref) forceExitTimer.unref();
    }

    // 1. Tell HTTP servers to stop accepting new TCP connections
    const serverClosePromises = this.servers.map(server => {
      return new Promise(resolve => {
        if (typeof server.closeIdleConnections === 'function') {
          server.closeIdleConnections();
        }
        server.close(resolve);
      });
    });

    // 2. Wait for active in-flight requests to complete
    const drainStart = Date.now();
    while (this.activeRequests > 0 && (Date.now() - drainStart) < this.timeoutMs) {
      await new Promise(r => setTimeout(r, 50));
    }
    this.logger.log(`[SHUTDOWN] Drenaje de peticiones finalizado (Activas restantes: ${this.activeRequests}).`);

    // Finalize server closing (close remaining keep-alive idle sockets)
    if (this.servers.length > 0) {
      for (const server of this.servers) {
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
      }
      await Promise.race([
        Promise.all(serverClosePromises),
        new Promise(r => setTimeout(r, 1000))
      ]);
    }

    // 3. Execute registered cleanup tasks (pools, adapters, workers)
    for (const task of this.cleanupTasks) {
      try {
        await task.fn();
        this.logger.log(`[SHUTDOWN] Tarea de limpieza completada: ${task.name}`);
      } catch (err) {
        this.logger.error(`[SHUTDOWN ERROR] Error en tarea ${task.name}:`, err.message);
      }
    }

    if (forceExitTimer) clearTimeout(forceExitTimer);
    this.logger.log('[SHUTDOWN] Parada controlada completada con éxito.');

    if (exitProcess) {
      process.exit(0);
    }
  }

  attachProcessSignals() {
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    // Cross-platform IPC bridge (essential for graceful testing on Windows OS where SIGTERM terminates abruptly)
    process.on('message', (msg) => {
      if (msg === 'SIGTERM' || msg === 'SIGINT') {
        this.shutdown(msg);
      }
    });
  }
}

module.exports = {
  GracefulShutdownCoordinator
};
