// server/src/routes/health.js
// Liveness/readiness. Без авторизации, специально — нужен для Docker healthcheck.
//
// spec:05-api.md#q8 — контракт /api/health

import { config } from '../config.js';

const startedAt = Date.now();

export default async function healthRoutes(fastify) {
  fastify.get('/api/health', async () => {
    const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
    // db_ok станет осмысленным после issue #2 (SQLite). До этого — false.
    let dbOk = false;
    try {
      // Когда появится модуль db — заменим на прямой ping.
      // Сейчас — best-effort: проверим, что путь доступен.
      const { existsSync } = await import('node:fs');
      dbOk = existsSync(config.databasePath);
    } catch {
      dbOk = false;
    }
    return {
      ok: true,
      data: { status: 'ok', uptime_sec: uptimeSec, db_ok: dbOk },
    };
  });
}
