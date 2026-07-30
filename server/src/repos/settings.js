// server/src/repos/settings.js
// Чтение/обновление настроек пользователя: timezone, morning_reminder_time,
// evening_reminder_time.
//
// spec:03-features/settings.md#q2..q5 — поля, дефолты, reset
// spec:04-data-model.md#q2 — users table (после миграции 0002)

import { getDb } from '../db.js';

const DEFAULTS = Object.freeze({
  morning_reminder_time: '09:00',
  evening_reminder_time: '21:00',
  timezone: 'UTC',
});

const _stmt = {};
function stmts() {
  if (_stmt.update) return _stmt;
  const db = getDb();
  _stmt.update = db.prepare(`
    UPDATE users SET
      timezone = @timezone,
      morning_reminder_time = @morning_reminder_time,
      evening_reminder_time = @evening_reminder_time,
      updated_at = @now
    WHERE id = @id
  `);
  return _stmt;
}

export function getDefaults() {
  return { ...DEFAULTS };
}

/**
 * Обновляет настройки. Возвращает обновлённую запись пользователя.
 */
export function updateSettings({ userId, timezone, morningReminderTime, eveningReminderTime }) {
  const now = Math.floor(Date.now() / 1000);
  stmts().update.run({
    id: userId,
    timezone,
    morning_reminder_time: morningReminderTime,
    evening_reminder_time: eveningReminderTime,
    now,
  });
  return findById(userId);
}

export function findById(userId) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

/**
 * Возвращает текущие настройки + флаг defaults_applied:
 * true — пользователь не менял ничего (всё == DEFAULTS).
 */
export function getSettingsForUser(userRow) {
  const applied = (
    userRow.morning_reminder_time === DEFAULTS.morning_reminder_time &&
    userRow.evening_reminder_time === DEFAULTS.evening_reminder_time &&
    userRow.timezone === DEFAULTS.timezone
  );
  return {
    morning_hour_minute: userRow.morning_reminder_time,
    evening_hour_minute: userRow.evening_reminder_time,
    timezone: userRow.timezone,
    defaults_applied: applied,
  };
}
