// server/src/repos/history.js
// Возвращает массив дней в окне с morning/evening записями (или null).
//
// spec:05-api.md#q5 — response shape (включая пустые дни)
// spec:03-features/history.md#q3..q7 — фильтры, пустые дни, p95
// spec:04-data-model#q3, q4 — таблицы morning_surveys / evening_surveys

import { getDb } from '../db.js';
import { parseYmdUtc } from '../utils/dateInTz.js';

/**
 * Возвращает объект записи morning (или null) в формате API.
 */
function rowToMorning(row) {
  if (!row) return null;
  return {
    id: row.m_id,
    sleep_hours: row.m_sleep_hours,
    sleep_quality: row.m_sleep_quality,
    mood_morning: row.mood_morning,
    intention: row.intention,
  };
}

function rowToEvening(row) {
  if (!row) return null;
  return {
    id: row.e_id,
    smoked_count: row.smoked_count,
    ate_sugar: row.ate_sugar,
    did_sport: row.did_sport === 1,
    sport_note: row.sport_note,
    mood_evening: row.mood_evening,
    best_memory: row.best_memory,
  };
}

const _stmt = {};
function stmts() {
  if (_stmt.window) return _stmt;
  const db = getDb();
  // Один запрос достаёт и morning, и evening через LEFT JOIN.
  // COALESCE выбирает non-null дату из любой таблицы.
  // spec:05-api.md#q5 — календарные дни из окна
  // spec:04-data-model#q3, q4 — UNIQUE(user_id, local_date) гарантирует ≤1 строки с каждой стороны
  _stmt.window = db.prepare(`
    SELECT
      COALESCE(m.local_date, e.local_date) AS local_date,
      m.id   AS m_id,   m.sleep_hours  AS m_sleep_hours, m.sleep_quality AS m_sleep_quality,
      m.mood_morning, m.intention,
      e.id   AS e_id,   e.smoked_count, e.ate_sugar, e.did_sport,
      e.sport_note, e.mood_evening, e.best_memory
    FROM morning_surveys m
    FULL OUTER JOIN evening_surveys e
      ON m.user_id = e.user_id AND m.local_date = e.local_date
    WHERE (m.user_id = @user_id OR e.user_id = @user_id)
      AND COALESCE(m.local_date, e.local_date) BETWEEN @from_date AND @to_date
    ORDER BY local_date ASC
  `);
  return _stmt;
}

/**
 * @param {object} args
 * @param {number} args.userId
 * @param {string} args.fromDate YYYY-MM-DD (inclusive, локальная дата)
 * @param {string} args.toDate   YYYY-MM-DD (inclusive)
 * @returns {Array<{date: string, morning: object|null, evening: object|null}>}
 */
export function getHistory({ userId, fromDate, toDate }) {
  const rows = stmts().window.all({ user_id: userId, from_date: fromDate, to_date: toDate });
  const byDate = new Map();
  for (const r of rows) {
    byDate.set(r.local_date, { morning: rowToMorning(r), evening: rowToEvening(r) });
  }

  // Спека требует ВСЕ дни в окне, включая пустые. Заполняем пропуски.
  const out = [];
  const cur = parseYmdUtc(fromDate);
  const end = parseYmdUtc(toDate);
  while (cur <= end) {
    const ymd = cur.toISOString().slice(0, 10);
    const entry = byDate.get(ymd) || { morning: null, evening: null };
    out.push({ date: ymd, ...entry });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}
