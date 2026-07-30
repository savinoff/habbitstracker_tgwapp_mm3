// server/src/routes/surveys.js
// POST /api/surveys/morning — issue #4
// POST /api/surveys/evening — issue #5
//
// spec:05-api.md#q2 — morning contract
// spec:05-api.md#q3 — evening contract
// spec:05-api.md#q4 — server-side validation
// spec:03-features/survey-morning.md — morning
// spec:03-features/survey-evening.md — evening
// spec:04-data-model#q3, q4 — таблицы

import { upsertMorningSurvey } from '../repos/morning.js';
import { upsertEveningSurvey } from '../repos/evening.js';
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

const eveningSchema = {
  body: {
    type: 'object',
    required: ['date', 'smoked_count', 'ate_sugar', 'did_sport', 'mood_evening'],
    additionalProperties: false,
    properties: {
      date: { type: 'string', minLength: 10, maxLength: 10 },
      smoked_count: { type: 'integer', minimum: 0, maximum: 50 },
      ate_sugar: { type: 'string', enum: ['yes', 'no', 'unsure'] },
      did_sport: { type: 'boolean' },
      sport_note: { type: 'string', maxLength: 100 },
      mood_evening: { type: 'integer', minimum: 1, maximum: 5 },
      best_memory: { type: 'string', maxLength: 300 },
    },
  },
};

/**
 * Общая валидация поля date: календарная дата YYYY-MM-DD в окне ±N дней от today UTC.
 * spec:05-api.md#q4
 * spec:03-features/survey-morning.md#q3
 *
 * @returns {string|null} текст ошибки или null, если ок.
 */
function validateDateWindow(dateStr) {
  if (typeof dateStr !== 'string' || !isValidCalendarDate(dateStr)) {
    return 'must be a valid YYYY-MM-DD calendar date';
  }
  const today = todayUtcDateString();
  const diff = daysBetween(today, dateStr);
  if (diff < -ALLOWED_DATE_OFFSET_DAYS.past) {
    return `must be within last ${ALLOWED_DATE_OFFSET_DAYS.past} days`;
  }
  if (diff > ALLOWED_DATE_OFFSET_DAYS.future) {
    return `must not be more than ${ALLOWED_DATE_OFFSET_DAYS.future} day in the future`;
  }
  return null;
}

/**
 * Нормализует текстовое поле: trim, пустая строка -> null, проверка maxLength.
 * Возвращает { ok, value, error } — value мутирует в null/trimmed.
 */
function normalizeText(field, value, maxLen) {
  if (value === undefined || value === null) return { ok: true, value: null };
  const trimmed = String(value).trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > maxLen) {
    return { ok: false, error: `must be at most ${maxLen} characters after trim` };
  }
  return { ok: true, value: trimmed };
}

/**
 * Убеждается, что у нас есть локальный пользователь, синхронизирует username/first_name.
 * Возвращает локального пользователя. Создаёт, если такого telegram_id ещё нет.
 */
function ensureLocalUser(tgUser) {
  const existing = findByTelegramId(tgUser.id);
  const username = tgUser.username ?? null;
  const first_name = tgUser.first_name ?? null;
  if (!existing) {
    return upsertUser({ telegram_id: tgUser.id, username, first_name });
  }
  if (existing.username !== username || existing.first_name !== first_name) {
    return upsertUser({
      telegram_id: tgUser.id,
      username,
      first_name,
      timezone: existing.timezone,
    });
  }
  return existing;
}

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
        const dateErr = validateDateWindow(body.date);
        if (dateErr) errors.push({ path: '/date', message: dateErr });

        if (typeof body.sleep_hours !== 'number') {
          errors.push({ path: '/sleep_hours', message: 'must be a number' });
        } else if (Math.abs(body.sleep_hours * 2 - Math.round(body.sleep_hours * 2)) > 1e-9) {
          errors.push({ path: '/sleep_hours', message: 'must be a multiple of 0.5' });
        }

        const intention = normalizeText('intention', body.intention, 200);
        if (!intention.ok) {
          errors.push({ path: '/intention', message: intention.error });
        } else {
          body.intention = intention.value;
        }
      }

      if (errors.length) {
        return reply.code(400).send({
          error: { code: 'VALIDATION', message: 'Invalid morning survey payload', details: errors },
        });
      }

      // 2. Upsert пользователя.
      const userRow = ensureLocalUser(req.user);

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

  // POST /api/surveys/evening
  // spec:05-api.md#q3 — contract
  // spec:03-features/survey-evening.md#q2 — поля
  // spec:03-features/survey-evening.md#q3 — идемпотентный upsert
  // spec:04-data-model#q4 — evening_surveys
  fastify.post(
    '/api/surveys/evening',
    { schema: eveningSchema, attachValidation: true },
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
        const dateErr = validateDateWindow(body.date);
        if (dateErr) errors.push({ path: '/date', message: dateErr });

        // spec:03-features/survey-evening.md#q2 — sport_note опционален,
        // но если did_sport=false — клиент всё равно может прислать sport_note,
        // и мы его примем (поле БД NULL-able). Не делаем cross-field валидацию,
        // чтобы клиент мог постепенно дозаполнять.

        const sportNote = normalizeText('sport_note', body.sport_note, 100);
        if (!sportNote.ok) {
          errors.push({ path: '/sport_note', message: sportNote.error });
        } else {
          body.sport_note = sportNote.value;
        }

        const bestMemory = normalizeText('best_memory', body.best_memory, 300);
        if (!bestMemory.ok) {
          errors.push({ path: '/best_memory', message: bestMemory.error });
        } else {
          body.best_memory = bestMemory.value;
        }
      }

      if (errors.length) {
        return reply.code(400).send({
          error: { code: 'VALIDATION', message: 'Invalid evening survey payload', details: errors },
        });
      }

      const userRow = ensureLocalUser(req.user);

      const row = upsertEveningSurvey({
        userId: userRow.id,
        localDate: body.date,
        smokedCount: body.smoked_count,
        ateSugar: body.ate_sugar,
        didSport: body.did_sport,
        sportNote: body.sport_note ?? null,
        moodEvening: body.mood_evening,
        bestMemory: body.best_memory ?? null,
      });

      return { ok: true, data: row };
    },
  );
}
