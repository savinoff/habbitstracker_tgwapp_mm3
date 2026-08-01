// server/src/index.js
// Bootstrap Fastify: health, auth, surveys/history/settings routes, error-handler,
// статика из web/dist + SPA fallback, Telegram bot, scheduler, migrations.
//
// spec:00-vision.md#q8   — Node 20+ + Fastify
// spec:05-api.md#q1      — общие правила API
// spec:05-api.md#q8      — /api/health без auth
// spec:05-api.md#q9      — все остальные /api/* требуют initData
// spec:05-api.md#q10     — статика из web/dist + SPA fallback
// spec:07-non-functional.md#q4 — pino в stdout
// spec:08-deploy.md#q10  — healthcheck используется Docker'om
// spec:04-data-model.md#q6 — apply migrations on boot

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';
import { config } from './config.js';
import { logger } from './logger.js';
import { errorPlugin } from './plugins/error.js';
import { authPlugin } from './plugins/auth.js';
import healthRoutes from './routes/health.js';
import surveyRoutes from './routes/surveys.js';
import historyRoutes from './routes/history.js';
import settingsRoutes from './routes/settings.js';
import { startBot, stopBot } from './bot.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { runMigrations } from './migrate.js';
import { closeDb } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const build = async () => {
  const app = Fastify({
    loggerInstance: logger,
    disableRequestLogging: false,
    trustProxy: true,
  });

  // Единый error handler.
  await app.register(errorPlugin);

  // /api/health — без авторизации, должен быть доступен Docker healthcheck.
  await app.register(healthRoutes);

  // spec:05-api.md#q9 — auth для всех /api/* кроме health.
  await app.register(authPlugin);

  // spec:05-api.md#q2 — POST /api/surveys/morning.
  await app.register(surveyRoutes);

  // spec:05-api.md#q5 — GET /api/history?days=7|30|-1.
  await app.register(historyRoutes);

  // spec:05-api.md#q6, q7 — GET/POST /api/settings.
  await app.register(settingsRoutes);

  // spec:05-api.md#q10 — статика и SPA fallback.
  // ВАЖНО: регистрируем ПОСЛЕ всех API-роутов, чтобы /api/* не уходил в static.
  // Static-файлы отдаются с cache-control: immutable, чтобы Telegram WebView
  // не делал лишних запросов.
  //
  // SPA-fallback — сами регистрируем setNotFoundHandler (v7 не делает это сам):
  // для /api/* отдаём JSON 404, для всего остального — index.html.
  if (config.staticDir && existsSync(config.staticDir)) {
    await app.register(fastifyStatic, {
      root: pathResolve(config.staticDir),
      prefix: '/',
      index: ['index.html'],
      cacheControl: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 дней
      immutable: true,
    });

    // SPA fallback: для любого GET, который не /api/* и не нашёлся в static,
    // отдаём index.html. Регистрируется ПОСЛЕ static, поэтому static успевает
    // обработать реальные файлы раньше.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.url}` },
        });
      }
      return reply.sendFile('index.html');
    });

    logger.info({ staticDir: config.staticDir }, 'static + SPA fallback enabled');
  } else {
    logger.info({ staticDir: config.staticDir || '(unset)' }, 'static disabled');
  }

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
      stopScheduler();
      stopBot();
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

  // spec:02-user-stories.md#US-01, US-08 — Telegram bot.
  // Запускаем после успешного listen: если Telegram недоступен, API всё равно работает.
  let botInstance = null;
  try {
    botInstance = startBot();
  } catch (err) {
    logger.error({ err }, 'failed to start telegram bot; continuing without it');
  }

  // spec:03-features/reminders.md — in-process scheduler.
  // Стартует всегда; если бота нет, sendMessage просто залогируется и пойдёт дальше.
  startScheduler(botInstance);

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
