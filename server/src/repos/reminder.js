// server/src/repos/reminder.js
// Помощники для scheduler'а: проверка «уже отправлено?» + пометка факта отправки.
//
// spec:03-features/reminders.md#q3 — логика отправки и reminder_log
// spec:04-data-model.md#q5 — reminder_log table

import { getDb } from '../db.js';

const _stmt = {};
function stmts() {
  if (_stmt.allUsers) return _stmt;
  const db = getDb();
  _stmt.allUsers = db.prepare(`
    SELECT id, telegram_id, timezone, morning_reminder_time, evening_reminder_time
    FROM users
  `);
  _stmt.wasSent = db.prepare(`
    SELECT 1 AS sent FROM reminder_log
    WHERE user_id = @user_id AND kind = @kind AND local_date = @local_date
  `);
  _stmt.markSent = db.prepare(`
    INSERT INTO reminder_log (user_id, kind, local_date, sent_at)
    VALUES (@user_id, @kind, @local_date, @now)
  `);
  _stmt.eveningExists = db.prepare(`
    SELECT 1 AS e FROM evening_surveys
    WHERE user_id = @user_id AND local_date = @local_date
  `);
  return _stmt;
}

export function getAllUsersForReminders() {
  return stmts().allUsers.all();
}

export function wasSent({ userId, kind, localDate }) {
  return !!stmts().wasSent.get({ user_id: userId, kind, local_date: localDate });
}

export function markSent({ userId, kind, localDate }) {
  stmts().markSent.run({
    user_id: userId,
    kind,
    local_date: localDate,
    now: Math.floor(Date.now() / 1000),
  });
}

/**
 * Возвращает true, если вечерний опрос за этот локальный день уже заполнен.
 * Используется для решения «слать ли followup через 60 мин».
 */
export function eveningSurveyExists({ userId, localDate }) {
  return !!stmts().eveningExists.get({ user_id: userId, local_date: localDate });
}
