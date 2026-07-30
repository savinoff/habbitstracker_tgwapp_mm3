// server/src/routes/settings.js
// GET  /api/settings       — текущие настройки + defaults_applied
// POST /api/settings       — обновление
// POST /api/settings/reset — сброс времени на дефолт (TZ не трогает)
//
// spec:05-api.md#q6, q7
// spec:03-features/settings.md#q2..q6
// spec:04-data-model.md#q2

import { findByTelegramId, upsert as upsertUser } from '../repos/users.js';
import {
  getSettingsForUser,
  getDefaults,
  updateSettings,
  findById,
} from '../repos/settings.js';
import { ALLOWED_TIMEZONES, isAllowedTimezone } from '../constants/timezones.js';

const HHMM_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

function isInWindow(hhmm, fromHour, toHourInclusive) {
  const h = Number(hhmm.slice(0, 2));
  return h >= fromHour && h <= toHourInclusive;
}

const settingsSchema = {
  body: {
    type: 'object',
    required: ['morning_hour_minute', 'evening_hour_minute', 'timezone'],
    additionalProperties: false,
    properties: {
      morning_hour_minute: { type: 'string', minLength: 5, maxLength: 5 },
      evening_hour_minute: { type: 'string', minLength: 5, maxLength: 5 },
      timezone: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
};

export default async function settingsRoutes(fastify) {
  // GET /api/settings
  fastify.get('/api/settings', async (req, reply) => {
    const tgUser = req.user;
    let userRow = findByTelegramId(tgUser.id);

    // Если пользователь ещё не в БД (не вызывал /start), создаём с дефолтами.
    if (!userRow) {
      userRow = upsertUser({
        telegram_id: tgUser.id,
        username: tgUser.username ?? null,
        first_name: tgUser.first_name ?? null,
      });
    }

    return { ok: true, data: getSettingsForUser(userRow) };
  });

  // POST /api/settings
  fastify.post(
    '/api/settings',
    { schema: settingsSchema, attachValidation: true },
    async (req, reply) => {
      const vErr = req.validationError;
      const body = req.body;
      const errors = [];

      if (!body || typeof body !== 'object') {
        return reply.code(400).send({
          error: { code: 'VALIDATION', message: 'Request body must be a JSON object' },
        });
      }

      if (vErr && Array.isArray(vErr.validation)) {
        for (const e of vErr.validation) {
          const path = e.instancePath && e.instancePath.length > 0
            ? e.instancePath
            : '/' + (e.params?.missingProperty || '');
          errors.push({ path, message: e.message });
        }
      }

      if (!vErr) {
        if (!HHMM_RE.test(body.morning_hour_minute)) {
          errors.push({ path: '/morning_hour_minute', message: 'must match HH:MM (00:00-23:59)' });
        } else if (!isInWindow(body.morning_hour_minute, 4, 11)) {
          // 04:00–11:59 (12:00 — конец утреннего окна, по 03-features/reminders.md#q2)
          errors.push({ path: '/morning_hour_minute', message: 'morning must be in 04:00-11:59' });
        }

        if (!HHMM_RE.test(body.evening_hour_minute)) {
          errors.push({ path: '/evening_hour_minute', message: 'must match HH:MM (00:00-23:59)' });
        } else if (!isInWindow(body.evening_hour_minute, 18, 23)) {
          errors.push({ path: '/evening_hour_minute', message: 'evening must be in 18:00-23:59' });
        }

        if (typeof body.timezone !== 'string' || !isAllowedTimezone(body.timezone)) {
          errors.push({
            path: '/timezone',
            message: `must be one of the allowed IANA timezones (${ALLOWED_TIMEZONES.length} options)`,
          });
        }
      }

      if (errors.length) {
        return reply.code(400).send({
          error: { code: 'VALIDATION', message: 'Invalid settings payload', details: errors },
        });
      }

      // Upsert пользователя + апдейт настроек.
      const tgUser = req.user;
      let userRow = findByTelegramId(tgUser.id);
      if (!userRow) {
        userRow = upsertUser({
          telegram_id: tgUser.id,
          username: tgUser.username ?? null,
          first_name: tgUser.first_name ?? null,
        });
      }

      const updated = updateSettings({
        userId: userRow.id,
        timezone: body.timezone,
        morningReminderTime: body.morning_hour_minute,
        eveningReminderTime: body.evening_hour_minute,
      });

      return { ok: true, data: getSettingsForUser(updated) };
    },
  );

  // POST /api/settings/reset — время на дефолт, TZ не трогает.
  // spec:03-features/settings.md#q2 — reset_button
  fastify.post('/api/settings/reset', async (req) => {
    const tgUser = req.user;
    let userRow = findByTelegramId(tgUser.id);
    if (!userRow) {
      userRow = upsertUser({
        telegram_id: tgUser.id,
        username: tgUser.username ?? null,
        first_name: tgUser.first_name ?? null,
      });
    }
    const defaults = getDefaults();
    const updated = updateSettings({
      userId: userRow.id,
      timezone: userRow.timezone || defaults.timezone,
      morningReminderTime: defaults.morning_reminder_time,
      eveningReminderTime: defaults.evening_reminder_time,
    });
    return { ok: true, data: getSettingsForUser(updated) };
  });
}
