// server/src/routes/admin.js
// Admin-only API endpoints (v0.4.0+). Доступ только для owner.
//
// spec:05-api.md#q13 — /api/admin/users, /api/admin/audit, /api/admin/stats
// spec:09-multi-user.md#q4 — список пользователей
// spec:09-multi-user.md#q10 — audit log endpoint
// spec:09-multi-user.md#q11 — audit log backup

import * as users from '../users.js';
import * as audit from '../audit.js';
import { getDb } from '../db.js';
import { config } from '../config.js';

function ownerOnly(req, reply) {
  if (!req.user || !req.user.isOwner) {
    reply.code(403).send({
      error: { code: 'ADMIN_REQUIRED', message: 'This endpoint requires owner access' },
    });
    return false;
  }
  return true;
}

function parseInt0(s) {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function parseIntMax(s, def, max) {
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

export default async function adminRoutes(fastify) {
  // GET /api/admin/users — список пользователей с фильтром и пагинацией.
  fastify.get('/api/admin/users', async (req, reply) => {
    if (!ownerOnly(req, reply)) return;
    const { status, limit, offset } = req.query;
    const lim = parseIntMax(limit, 50, 200);
    const off = parseInt0(offset);
    const result = users.list({ status: status || null, limit: lim, offset: off });
    return { ok: true, data: result };
  });

  // GET /api/admin/audit — журнал аудита с фильтрами.
  fastify.get('/api/admin/audit', async (req, reply) => {
    if (!ownerOnly(req, reply)) return;
    const { action, actor_id, target_id, since_ts, limit, offset } = req.query;
    const lim = parseIntMax(limit, 100, 500);
    const off = parseInt0(offset);
    // since_ts default = 7 days ago.
    const sinceTs = since_ts != null
      ? Number(since_ts)
      : Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
    const result = audit.list({
      action: action || null,
      actor_id: actor_id != null ? Number(actor_id) : null,
      target_id: target_id != null ? Number(target_id) : null,
      since_ts: sinceTs,
      limit: lim,
      offset: off,
    });
    return { ok: true, data: { ...result, since_ts: sinceTs } };
  });

  // GET /api/admin/stats — сводка для UI админа.
  fastify.get('/api/admin/stats', async (req, reply) => {
    if (!ownerOnly(req, reply)) return;
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    const todayStart = now - (now % 86400);  // 00:00 UTC
    const tomorrowStart = todayStart + 86400;

    // users breakdown. status='banned' подразумевает deleted_at IS NOT NULL,
    // но считаем по статусу для простоты.
    const usersCount = db.prepare(`
      SELECT
        sum(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        sum(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
        sum(CASE WHEN status = 'denied' THEN 1 ELSE 0 END) AS denied,
        sum(CASE WHEN status = 'banned' THEN 1 ELSE 0 END) AS banned,
        count(*) AS total
      FROM users
    `).get();

    // surveys today (UTC date; UI конвертирует в локальную)
    const surveysToday = db.prepare(`
      SELECT
        (SELECT count(*) FROM morning_surveys WHERE created_at >= ?) AS morning,
        (SELECT count(*) FROM evening_surveys WHERE created_at >= ?) AS evening
    `).get(todayStart, todayStart);

    // reminders today
    const remindersToday = db.prepare(`
      SELECT count(*) AS c FROM reminder_log WHERE sent_at >= ?
    `).get(todayStart).c;

    return {
      ok: true,
      data: {
        users_total: usersCount.total || 0,
        users_pending: usersCount.pending || 0,
        users_approved: usersCount.approved || 0,
        users_denied: usersCount.denied || 0,
        users_banned: usersCount.banned || 0,
        surveys_today: { morning: surveysToday.morning || 0, evening: surveysToday.evening || 0 },
        reminders_sent_today: remindersToday,
      },
    };
  });
}
