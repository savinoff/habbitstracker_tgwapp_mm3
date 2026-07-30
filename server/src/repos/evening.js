// server/src/repos/evening.js
// Upsert вечернего опроса. Идемпотентность по (user_id, local_date).
//
// spec:04-data-model#q4 — evening_surveys table
// spec:05-api.md#q3 — POST /api/surveys/evening contract

import { getDb } from '../db.js';

const _stmt = {};
function stmts() {
  if (_stmt.upsert) return _stmt;
  const db = getDb();
  _stmt.upsert = db.prepare(`
    INSERT INTO evening_surveys
      (user_id, local_date, smoked_count, ate_sugar, did_sport, sport_note,
       mood_evening, best_memory, created_at, updated_at)
    VALUES
      (@user_id, @local_date, @smoked_count, @ate_sugar, @did_sport, @sport_note,
       @mood_evening, @best_memory, @now, @now)
    ON CONFLICT(user_id, local_date) DO UPDATE SET
      smoked_count = excluded.smoked_count,
      ate_sugar    = excluded.ate_sugar,
      did_sport    = excluded.did_sport,
      sport_note   = excluded.sport_note,
      mood_evening = excluded.mood_evening,
      best_memory  = excluded.best_memory,
      updated_at   = excluded.updated_at
    RETURNING id, local_date, created_at, updated_at
  `);
  return _stmt;
}

/**
 * @param {object} input
 * @param {number} input.userId
 * @param {string} input.localDate YYYY-MM-DD
 * @param {number}  input.smokedCount
 * @param {'yes'|'no'|'unsure'} input.ateSugar
 * @param {boolean} input.didSport
 * @param {string|null} input.sportNote
 * @param {number}  input.moodEvening
 * @param {string|null} input.bestMemory
 */
export function upsertEveningSurvey(input) {
  const now = Math.floor(Date.now() / 1000);
  return stmts().upsert.get({
    user_id: input.userId,
    local_date: input.localDate,
    smoked_count: input.smokedCount,
    ate_sugar: input.ateSugar,
    did_sport: input.didSport ? 1 : 0,
    sport_note: input.sportNote,
    mood_evening: input.moodEvening,
    best_memory: input.bestMemory,
    now,
  });
}
