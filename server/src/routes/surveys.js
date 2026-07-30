// server/src/routes/surveys.js
// POST /api/surveys/morning — утренний опрос (issue #4).
// POST /api/surveys/evening — приедет в issue #5.
//
// spec:05-api.md#q2 — request/response contract
// spec:05-api.md#q4 — server-side validation
// spec:03-features/survey-morning.md#q2 — поля формы
// spec:03-features/survey-morning.md#q3 — идемпотентный upsert
// spec:04-data-model#q3 — morning_surveys

import { upsertMorningSurvey } from '../repos/morning.js';
import { findByTelegramId, upsert as upsertUser } from '../repos/users.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_DATE_OFFSET_DAYS = { past: 7, future: 1 };

/**
 * Парсит YYYY-MM-DD и проверяет, что дата — реальная календарная дата,
 * а не, например, 2026-02-30.
 */
function isValidCalendarDate(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/**
 * Сравнение YYYY-MM-DD строк без учёта TZ (как календарных дат).
 */
function todayUtcDateString() {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

function daysBetween(fromYmd, toYmd) {
  const a = Date.UTC(...fromYmd.split('-').map(Number));
  const b = Date.UTC(...toYmd.split('-').map(Number));
  return Math.round((b - a) / 86400000);
}

const morningSchema = {
  body: {
    type: 'object',
    required: ['date', 'sleep_hours', 'sleep_quality', 'mood_morning'],
    additionalProperties: false,
    properties: {
      date: { type: 'string', minLength: 10, maxLength: 10 },
      sleep_hours: { type: 'number', minimum: 0, maximum: 14 },
      sleep_quality: { type: 'integer', minimum: 1, maximum: 5 },
      mood_morning: { type: 'integer', minimum: 1, maximum: 5 },
      intention: { type: 'string', maxLength: 200 },
    },
  },
};

export default async function surveyRoutes(fastify) {
  // POST /api/surveys/morning
  fastify.post(
    '/api/surveys/morning',
    { schema: morningSchema, attachValidation: true },
    async (req, reply) => {
      // 1. Кастомная валидация.
      // req.validationError присутствует, если JSON-schema не прошла (attachValidation: true).
      // Fastify по умолчанию НЕ отвечает 400, если attachValidation включён — это наша работа.
      const vErr = req.validationError;
      const body = req.body;
      const errors = [];

      // Если body пустое — schema-валидация нашла missing required. Конвертируем в 400.
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

      // Если body есть, но поля типа отсутствуют — schema-валидация об этом уже сказала.
      // Дальнейшие кастомные проверки делаем, только если schema прошла.
      if (!vErr) {
        if (typeof body.date !== 'string' || !isValidCalendarDate(body.date)) {
          errors.push({ path: '/date', message: 'must be a valid YYYY-MM-DD calendar date' });
        } else {
          // spec:05-api.md#q4 — не раньше -7 и не дальше +1 дня от now_user_local.
          // Для однользовательского MVP считаем «now_user_local» == today UTC;
          // когда появится полноценная TZ-логика (вместе с #7 settings) — пересчитаем.
          const today = todayUtcDateString();
          // diff > 0 если body.date в будущем, < 0 если в прошлом.
          const diff = daysBetween(today, body.date);
          if (diff < -ALLOWED_DATE_OFFSET_DAYS.past) {
            errors.push({ path: '/date', message: `must be within last ${ALLOWED_DATE_OFFSET_DAYS.past} days` });
          }
          if (diff > ALLOWED_DATE_OFFSET_DAYS.future) {
            errors.push({ path: '/date', message: `must not be more than ${ALLOWED_DATE_OFFSET_DAYS.future} day in the future` });
          }
        }

        if (typeof body.sleep_hours !== 'number') {
          errors.push({ path: '/sleep_hours', message: 'must be a number' });
        } else if (Math.abs(body.sleep_hours * 2 - Math.round(body.sleep_hours * 2)) > 1e-9) {
          errors.push({ path: '/sleep_hours', message: 'must be a multiple of 0.5' });
        }

        // intention: trim до null если пустая строка
        if (body.intention !== undefined && body.intention !== null) {
          const trimmed = String(body.intention).trim();
          if (trimmed.length === 0) {
            body.intention = null;
          } else if (trimmed.length > 200) {
            errors.push({ path: '/intention', message: 'must be at most 200 characters after trim' });
          } else {
            body.intention = trimmed;
          }
        }
      }

      if (errors.length) {
        return reply.code(400).send({
          error: { code: 'VALIDATION', message: 'Invalid morning survey payload', details: errors },
        });
      }

      // 2. Upsert пользователя (на случай, если бот ещё не вызвал /start).
      const tgUser = req.user;
      const existing = findByTelegramId(tgUser.id);
      if (!existing) {
        upsertUser({
          telegram_id: tgUser.id,
          username: tgUser.username ?? null,
          first_name: tgUser.first_name ?? null,
        });
      } else if (existing.username !== (tgUser.username ?? null) || existing.first_name !== (tgUser.first_name ?? null)) {
        // Поддерживаем актуальность username/first_name (могут меняться).
        upsertUser({
          telegram_id: tgUser.id,
          username: tgUser.username ?? null,
          first_name: tgUser.first_name ?? null,
          timezone: existing.timezone,
        });
      }
      const userRow = findByTelegramId(tgUser.id);

      // 3. Upsert опроса.
      const row = upsertMorningSurvey({
        userId: userRow.id,
        localDate: body.date,
        sleepHours: body.sleep_hours,
        sleepQuality: body.sleep_quality,
        moodMorning: body.mood_morning,
        intention: body.intention ?? null,
      });

      return { ok: true, data: row };
    },
  );
}
