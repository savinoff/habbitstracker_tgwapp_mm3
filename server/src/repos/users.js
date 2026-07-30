// server/src/repos/users.js
// CRUD-минимум для таблицы users. Используется auth'ом и surveys.
//
// spec:04-data-model#q2 — users table
// spec:05-api.md#q9 — auth кладёт user.id в БД через /start (issue #8)

import { getDb } from '../db.js';

const _stmt = {};
function stmts() {
  if (_stmt.findByTelegramId) return _stmt;
  const db = getDb();
  _stmt.findByTelegramId = db.prepare('SELECT * FROM users WHERE telegram_id = ?');
  _stmt.upsert = db.prepare(`
    INSERT INTO users (telegram_id, username, first_name, timezone, created_at, updated_at)
    VALUES (@telegram_id, @username, @first_name, @timezone, @now, @now)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username   = excluded.username,
      first_name = excluded.first_name,
      timezone   = excluded.timezone,
      updated_at = excluded.updated_at
  `);
  return _stmt;
}

export function findByTelegramId(telegramId) {
  return stmts().findByTelegramId.get(telegramId);
}

export function upsert({ telegram_id, username = null, first_name = null, timezone = 'UTC' }) {
  const now = Math.floor(Date.now() / 1000);
  stmts().upsert.run({ telegram_id, username, first_name, timezone, now });
  return findByTelegramId(telegram_id);
}
