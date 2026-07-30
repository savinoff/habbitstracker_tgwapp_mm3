// server/src/routes/health.js
// Liveness/readiness. Без авторизации, специально — нужен для Docker healthcheck.
//
// spec:05-api.md#q8 — контракт /api/health
// spec:08-deploy.md#q10 — healthcheck используется Docker'ом

import { getDb } from '../db.js';

const startedAt = Date.now();

let _pingStmt = null;
function ping() {
  if (!_pingStmt) _pingStmt = getDb().prepare('SELECT 1 AS ok');
  return _pingStmt.get();
}

export default async function healthRoutes(fastify) {
  fastify.get('/api/health', async () => {
    const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
    let dbOk = false;
    try {
      ping();
      dbOk = true;
    } catch {
      dbOk = false;
    }
    return {
      ok: true,
      data: { status: 'ok', uptime_sec: uptimeSec, db_ok: dbOk },
    };
  });
}
