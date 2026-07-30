// server/src/repos/morning.js
// Upsert утреннего опроса. Идемпотентность по (user_id, local_date) обеспечена
// UNIQUE-индексом в БД (см. 04-data-model.md#q3).
//
// spec:04-data-model#q3 — morning_surveys table
// spec:05-api.md#q2 — POST /api/surveys/morning contract
// spec:05-api.md#q4 — server-side validation
// spec:03-features/survey-morning.md#q3 — idempotent upsert

import { getDb } from '../db.js';

const _stmt = {};
function stmts() {
  if (_stmt.upsert) return _stmt;
  const db = getDb();
  _stmt.upsert = db.prepare(`
    INSERT INTO morning_surveys
      (user_id, local_date, sleep_hours, sleep_quality, mood_morning, intention, created_at, updated_at)
    VALUES
      (@user_id, @local_date, @sleep_hours, @sleep_quality, @mood_morning, @intention, @now, @now)
    ON CONFLICT(user_id, local_date) DO UPDATE SET
      sleep_hours   = excluded.sleep_hours,
      sleep_quality = excluded.sleep_quality,
      mood_morning  = excluded.mood_morning,
      intention     = excluded.intention,
      updated_at    = excluded.updated_at
    RETURNING id, local_date, created_at, updated_at
  `);
  return _stmt;
}

/**
 * @param {object} input
 * @param {number} input.userId
 * @param {string} input.localDate  YYYY-MM-DD (провалидировано на уровне роута)
 * @param {number} input.sleepHours
 * @param {number} input.sleepQuality
 * @param {number} input.moodMorning
 * @param {string|null} input.intention
 * @returns {{id:number, local_date:string, created_at:number, updated_at:number}}
 */
export function upsertMorningSurvey(input) {
  const now = Math.floor(Date.now() / 1000);
  return stmts().upsert.get({
    user_id: input.userId,
    local_date: input.localDate,
    sleep_hours: input.sleepHours,
    sleep_quality: input.sleepQuality,
    mood_morning: input.moodMorning,
    intention: input.intention,
    now,
  });
}
