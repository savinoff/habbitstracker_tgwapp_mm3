// server/src/index.js
// Bootstrap Fastify, подключает health и единый error-handler.
// Плагин initData-валидации и роуты surveys/history/settings приедут в следующих PR.
//
// spec:00-vision.md#q8  — Node 20+ + Fastify
// spec:05-api.md#q1     — общие правила API
// spec:05-api.md#q8     — /api/health без auth
// spec:07-non-functional.md#q4 — pino в stdout
// spec:08-deploy.md#q10 — healthcheck используется Docker'om
// spec:04-data-model.md#q6 — apply migrations on boot

import Fastify from 'fastify';
import { config } from './config.js';
import { logger } from './logger.js';
import { errorPlugin } from './plugins/error.js';
import healthRoutes from './routes/health.js';
import { runMigrations } from './migrate.js';
import { closeDb } from './db.js';

const build = () => {
  const app = Fastify({
    loggerInstance: logger,
    disableRequestLogging: false,
    trustProxy: true,
  });

  // Единый error handler.
  await app.register(errorPlugin);

  // /api/health — без авторизации, должен быть доступен Docker healthcheck.
  await app.register(healthRoutes);

  return app;
};

const start = async () => {
  let app;
  try {
    app = await build();
  } catch (err) {
    logger.fatal({ err }, 'failed to build app');
    process.exit(1);
  }

  const shutdown = async (signal) => {
    logger.info({ signal }, 'shutting down');
    try {
      await app.close();
      closeDb();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // spec:04-data-model.md#q6 — apply migrations on boot
  try {
    runMigrations();
  } catch (err) {
    logger.fatal({ err }, 'migrations failed; refusing to start');
    process.exit(1);
  }

  try {
    await app.listen({ host: config.host, port: config.port });
    logger.info({ port: config.port, host: config.host }, 'server listening');
  } catch (err) {
    logger.fatal({ err }, 'failed to listen');
    process.exit(1);
  }
};

start();
