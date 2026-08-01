// server/src/users.js
// CRUD для таблицы `users`.
// v0.4.0+: единый модуль для всех операций с пользователями.
//
// spec:09-multi-user#q4 — users table
// spec:09-multi-user#q5 — validateInitData flow
// spec:04-data-model#q2 — users schema

import { getDb } from './db.js';

/** Normalize telegram_id to integer (telegram_id is always integer in schema). */
const TgId = (x) => Number(x);

/**
 * Найти пользователя по telegram_id. Возвращает row или undefined.
 */
export function findByTelegramId(telegramId) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(TgId(telegramId));
}

/**
 * Найти пользователя по внутреннему id. Возвращает row или undefined.
 */
export function findById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
}

/**
 * Создать или обновить пользователя из Telegram initData.
 * НЕ меняет status (это делает bot/admin команды).
 * Используется при /start (создаёт pending) и при login (обновляет кэш полей).
 *
 * @param {object} tgUser — распарсенный user из initData (id, username, first_name, ...)
 * @param {string} defaultStatus — 'pending' для /start, 'approved' для escape-hatch
 * @returns {object} — row из users
 */
export function upsertFromTelegram(tgUser, defaultStatus = 'pending') {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const tgId = TgId(tgUser.id);
  const existing = findByTelegramId(tgId);

  if (existing) {
    // Обновляем только кэш-поля из Telegram. НЕ трогаем status/deleted_at.
    db.prepare(`
      UPDATE users SET
        username = ?,
        first_name = ?,
        last_name = ?,
        language_code = ?,
        is_premium = ?,
        updated_at = ?
      WHERE telegram_id = ?
    `).run(
      tgUser.username ?? null,
      tgUser.first_name ?? null,
      tgUser.last_name ?? null,
      tgUser.language_code ?? null,
      tgUser.is_premium === true ? 1 : tgUser.is_premium === false ? 0 : null,
      now,
      tgId,
    );
    return findByTelegramId(tgId);
  }

  // Новая запись.
  db.prepare(`
    INSERT INTO users (
      telegram_id, username, first_name, last_name, language_code, is_premium,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tgId,
    tgUser.username ?? null,
    tgUser.first_name ?? null,
    tgUser.last_name ?? null,
    tgUser.language_code ?? null,
    tgUser.is_premium === true ? 1 : tgUser.is_premium === false ? 0 : null,
    defaultStatus,
    now,
    now,
  );
  return findByTelegramId(tgId);
}

/**
 * Обновить status пользователя (для /allow, /deny, /revoke, /unban).
 * @returns {object|null} — обновлённый row или null если не найден.
 */
export function setStatus(telegramId, newStatus) {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const r = db.prepare(`
    UPDATE users SET status = ?, updated_at = ? WHERE telegram_id = ?
  `).run(newStatus, now, TgId(telegramId));
  if (r.changes === 0) return null;
  return findByTelegramId(telegramId);
}

/**
 * Soft delete (revoke). Устанавливает deleted_at и status='banned'.
 */
export function softDelete(telegramId) {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const r = db.prepare(`
    UPDATE users SET status = 'banned', deleted_at = ?, updated_at = ?
    WHERE telegram_id = ?
  `).run(now, now, TgId(telegramId));
  if (r.changes === 0) return null;
  return findByTelegramId(telegramId);
}

/**
 * Unban. Снимает deleted_at, возвращает status='approved'.
 */
export function unban(telegramId) {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const r = db.prepare(`
    UPDATE users SET status = 'approved', deleted_at = NULL, updated_at = ?
    WHERE telegram_id = ?
  `).run(now, TgId(telegramId));
  if (r.changes === 0) return null;
  return findByTelegramId(telegramId);
}

/**
 * Обновить last_seen_at (вызывается при каждом успешном login).
 */
export function markSeen(telegramId) {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare('UPDATE users SET last_seen_at = ? WHERE telegram_id = ?').run(now, TgId(telegramId));
}

/**
 * Список пользователей с фильтром и пагинацией.
 * @param {object} opts — { status?, limit?, offset? }
 */
export function list({ status = null, limit = 50, offset = 0 } = {}) {
  const db = getDb();
  const where = status ? 'WHERE status = ?' : '';
  const params = status ? [status, limit, offset] : [limit, offset];
  const rows = db.prepare(`
    SELECT * FROM users ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params);
  const total = db.prepare(`SELECT count(*) AS c FROM users ${where}`)
    .get(...(status ? [status] : [])).c;
  return { rows, total, limit, offset };
}

/**
 * Количество pending заявок.
 */
export function countPending() {
  const db = getDb();
  return db.prepare(`SELECT count(*) AS c FROM users WHERE status = 'pending'`).get().c;
}

/**
 * Список pending заявок (для owner'а).
 */
export function listPending() {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM users WHERE status = 'pending'
    ORDER BY created_at ASC
  `).all();
}
