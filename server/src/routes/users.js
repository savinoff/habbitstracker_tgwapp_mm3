// server/src/routes/users.js
// /api/users/me, /api/users/me/settings (v0.4.0+).
// Доступно для всех одобренных пользователей (включая owner).
//
// spec:05-api.md#q12 — /api/users/me, /api/users/me/settings
// spec:09-multi-user.md#q8 — онбординг (TZ обязателен)
// spec:09-multi-user.md#q9 — web 403-экраны (для FRONT в PR #5)

import * as users from '../users.js';
import { getDb } from '../db.js';

const TIMEZONES = [
  'UTC',
  'Europe/Moscow', 'Europe/Kaliningrad', 'Europe/Samara', 'Europe/Kiev', 'Europe/Minsk',
  'Europe/London', 'Europe/Berlin', 'Europe/Paris',
  'Asia/Yekaterinburg', 'Asia/Novosibirsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk',
  'Asia/Yakutsk', 'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka',
  'Asia/Almaty', 'Asia/Tashkent', 'Asia/Tbilisi', 'Asia/Yerevan',
  'America/New_York', 'America/Los_Angeles',
];

const TIME_RE = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;

function ok(data) { return { ok: true, data }; }

export default async function userRoutes(fastify) {
  // GET /api/users/me — профиль текущего пользователя.
  fastify.get('/api/users/me', async (req) => {
    const u = users.findById(req.user._dbId);
    if (!u) throw new Error('user not found in DB after auth');
    return ok({
      id: u.id,
      telegram_id: u.telegram_id,
      username: u.username,
      first_name: u.first_name,
      last_name: u.last_name,
      language_code: u.language_code,
      is_premium: Boolean(u.is_premium),
      status: u.status,
      is_owner: Boolean(req.user.isOwner),
      created_at: u.created_at,
      last_seen_at: u.last_seen_at,
      onboarded: u.onboarded_at !== null,
    });
  });

  // GET /api/users/me/settings — настройки пользователя.
  fastify.get('/api/users/me/settings', async (req) => {
    const u = users.findById(req.user._dbId);
    return ok({
      tz: u.timezone,
      morning_hour_minute: u.morning_reminder_time,
      evening_hour_minute: u.evening_reminder_time,
      onboarded_at: u.onboarded_at,
    });
  });

  // POST /api/users/me/settings — обновление (используется в онбординге и в Настройках).
  // spec:09-multi-user.md#q8 — если задан tz и onboarded_at IS NULL → выставляем.
  fastify.post('/api/users/me/settings', async (req, reply) => {
    const { tz, morning_hour_minute, evening_hour_minute } = req.body || {};

    // Валидация.
    if (tz != null && !TIMEZONES.includes(tz)) {
      reply.code(400);
      return { ok: false, error: { code: 'VALIDATION', message: `Unknown tz: ${tz}` } };
    }
    if (morning_hour_minute != null && !TIME_RE.test(morning_hour_minute)) {
      const h = Number(morning_hour_minute.slice(0, 2));
      if (h < 4 || h > 11) {
        reply.code(400);
        return { ok: false, error: { code: 'VALIDATION', message: 'morning_hour_minute must be in 04:00-11:59' } };
      }
    }
    if (evening_hour_minute != null && !TIME_RE.test(evening_hour_minute)) {
      const h = Number(evening_hour_minute.slice(0, 2));
      if (h < 18 || h > 23) {
        reply.code(400);
        return { ok: false, error: { code: 'VALIDATION', message: 'evening_hour_minute must be in 18:00-23:59' } };
      }
    }

    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    const u = users.findById(req.user._dbId);

    // Если был не онборжен и теперь задали tz — ставим onboarded_at.
    const newOnboardedAt = (u.onboarded_at == null && tz != null) ? now : u.onboarded_at;

    db.prepare(`
      UPDATE users SET
        timezone = COALESCE(?, timezone),
        morning_reminder_time = COALESCE(?, morning_reminder_time),
        evening_reminder_time = COALESCE(?, evening_reminder_time),
        onboarded_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      tz ?? null,
      morning_hour_minute ?? null,
      evening_hour_minute ?? null,
      newOnboardedAt,
      now,
      u.id,
    );

    const updated = users.findById(req.user._dbId);
    return ok({
      tz: updated.timezone,
      morning_hour_minute: updated.morning_reminder_time,
      evening_hour_minute: updated.evening_reminder_time,
      onboarded_at: updated.onboarded_at,
    });
  });

  // GET /api/users/timezones — список доступных TZ (для онбординга).
  fastify.get('/api/users/timezones', async () => ok({ timezones: TIMEZONES }));
}
