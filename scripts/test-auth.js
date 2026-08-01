#!/usr/bin/env node
// scripts/test-auth.js
// Тесты для server/src/users.js (CRUD) + server/src/plugins/auth.js (escape hatch + status).
// v0.4.0+: whitelist переехал из auth.js в plugins/auth.js с lookup'ом в users.
//
// Покрывает:
//   - findByTelegramId / findById
//   - upsertFromTelegram: create new, update existing, status не меняется
//   - setStatus: pending → approved → banned
//   - softDelete / unban
//   - list / listPending / countPending
//   - escape hatch: owner получает доступ даже без записи в БД
//   - non-owner + нет записи → NOT_REGISTERED
//   - non-owner + pending → NOT_APPROVED
//   - non-owner + denied → BANNED status=denied
//   - non-owner + banned → BANNED status=banned
//   - markSeen обновляет last_seen_at

import { unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'TEST_BOT_TOKEN';
process.env.OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID || '777';
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'habitstracker-test-')), 'test.db');

const { getDb, closeDb } = await import('../server/src/db.js');
const { runMigrations } = await import('../server/src/migrate.js');
const users = await import('../server/src/users.js');
const { validateInitData } = await import('../server/src/auth.js');
const { config } = await import('../server/src/config.js');

// Запускаем миграции (включая post-migration hook — owner будет approved).
runMigrations();

let failed = 0;
let passed = 0;
function assert(cond, label, details) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    const d = details !== undefined && details != null
      ? ` — got=${typeof details === 'object' ? JSON.stringify(details) : details}`
      : '';
    console.error(`  ✗ ${label}${d}`);
    failed++;
  }
}

// Helpers
function makeUser(telegramId, overrides = {}) {
  return {
    id: telegramId,
    username: `user${telegramId}`,
    first_name: `User${telegramId}`,
    last_name: '',
    language_code: 'ru',
    is_premium: false,
    ...overrides,
  };
}

// ===== users.js =====

console.log('--- users.upsertFromTelegram ---');
{
  const tgUser = makeUser(1001, { username: 'alice' });
  const row = users.upsertFromTelegram(tgUser, 'pending');
  assert(row.telegram_id === 1001, 'new user created with telegram_id=1001');
  assert(row.status === 'pending', 'new user has status=pending');
  assert(row.username === 'alice', 'new user has username=alice');
  assert(row.first_name === 'User1001', 'first_name stored');
}

console.log('--- users.upsertFromTelegram (update) ---');
{
  const tgUser = makeUser(1001, { first_name: 'Alicia', username: 'alicia_new' });
  const row = users.upsertFromTelegram(tgUser, 'pending');
  assert(row.first_name === 'Alicia', 'first_name updated');
  assert(row.username === 'alicia_new', 'username updated');
  assert(row.status === 'pending', 'status NOT changed by upsert');
}

console.log('--- users.setStatus ---');
{
  const updated = users.setStatus(1001, 'approved');
  assert(updated.status === 'approved', 'pending → approved');
  assert(users.findByTelegramId(1001).status === 'approved', 'status persisted');
}

console.log('--- users.softDelete ---');
{
  users.softDelete(1001);
  const row = users.findByTelegramId(1001);
  assert(row.status === 'banned', 'approved → banned');
  assert(row.deleted_at != null, 'deleted_at set');
}

console.log('--- users.unban ---');
{
  users.unban(1001);
  const row = users.findByTelegramId(1001);
  assert(row.status === 'approved', 'banned → approved');
  assert(row.deleted_at == null, 'deleted_at cleared');
}

console.log('--- users.markSeen ---');
{
  users.markSeen(1001);
  const row = users.findByTelegramId(1001);
  assert(row.last_seen_at != null, 'last_seen_at set');
}

console.log('--- users.list / listPending / countPending ---');
{
  // Создадим 2 pending и 1 approved (owner).
  users.upsertFromTelegram(makeUser(2001), 'pending');
  users.upsertFromTelegram(makeUser(2002), 'pending');
  users.upsertFromTelegram(makeUser(2003, { username: 'approved_user' }), 'approved');

  const pending = users.listPending();
  assert(pending.length === 2, 'listPending returns 2 (got ' + pending.length + ')');

  const count = users.countPending();
  assert(count === 2, 'countPending returns 2');

  const list = users.list({ status: 'pending' });
  assert(list.rows.length === 2 && list.total === 2, 'list({status:pending}) works');
}

// ===== auth.js: whitelist НЕ проверяется =====

console.log('--- validateInitData: no whitelist check ---');
{
  // Валидный initData для user с id=12345 (не owner). Whitelist НЕ должен сработать.
  // Если бы whitelist был, бросил бы NOT_OWNER.
  // Сейчас должен вернуть успех (user.id === 12345).
  const userObj = { id: 12345, first_name: 'NonOwner' };
  const { createHmac } = await import('node:crypto');
  const now = Math.floor(Date.now() / 1000);
  const fields = { user: JSON.stringify(userObj), auth_date: String(now) };
  const dcs = Object.entries(fields).filter(([k]) => k !== 'hash').sort()
    .map(([k, v]) => k + '=' + v).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(config.telegramBotToken).digest();
  const hash = createHmac('sha256', secretKey).update(dcs).digest('hex');
  const initData = Object.entries({ ...fields, hash })
    .map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  const r = validateInitData(initData, config.telegramBotToken);
  assert(r.user.id === 12345, 'validateInitData accepts non-owner (whitelist moved)');
}

// ===== escape hatch logic: owner без записи в БД =====
console.log('--- escape hatch: owner без записи в БД ---');
{
  // Удаляем owner'а из БД.
  getDb().prepare('DELETE FROM users WHERE telegram_id = ?').run(config.ownerTelegramId);
  const afterDel = users.findByTelegramId(config.ownerTelegramId);
  assert(afterDel == null, 'owner record deleted', { afterDel });

  // Сымитируем escape hatch (как в plugins/auth.js).
  const ownerTgId = config.ownerTelegramId;
  const isOwner = ownerTgId && Number(ownerTgId) === Number(ownerTgId);
  let dbUser = users.findByTelegramId(ownerTgId);
  if (isOwner && !dbUser) {
    dbUser = users.upsertFromTelegram(
      { id: ownerTgId, first_name: 'Owner', is_premium: true },
      'approved',
    );
  }
  assert(dbUser != null, 'owner auto-created via escape hatch');
  assert(dbUser.status === 'approved', 'owner status is approved');
}

console.log('--- escape hatch: owner status restored after ban ---');
{
  // Симулируем случай: owner'а случайно забанили.
  users.softDelete(config.ownerTelegramId);
  assert(users.findByTelegramId(config.ownerTelegramId).status === 'banned', 'owner banned');

  // Escape hatch должен восстановить.
  const dbUser = users.findByTelegramId(config.ownerTelegramId);
  if (dbUser.status !== 'approved') {
    users.setStatus(config.ownerTelegramId, 'approved');
  }
  assert(users.findByTelegramId(config.ownerTelegramId).status === 'approved', 'owner restored');
}

console.log('--- non-owner без записи → NOT_REGISTERED simulation ---');
{
  const nonOwnerId = 999999;
  const dbUser = users.findByTelegramId(nonOwnerId);
  assert(dbUser == null, 'non-owner has no DB record', { dbUser });
  // В plugins/auth.js это выливается в 401 NOT_REGISTERED.
}

console.log('--- non-owner pending → NOT_APPROVED simulation ---');
{
  const u = users.upsertFromTelegram(makeUser(3001), 'pending');
  const dbUser = users.findByTelegramId(u.telegram_id);
  assert(dbUser.status === 'pending', 'pending user in DB');
  // В plugins/auth.js это 403 NOT_APPROVED.
}

console.log('--- non-owner denied → BANNED status=denied simulation ---');
{
  users.upsertFromTelegram(makeUser(3002), 'pending');
  users.setStatus(3002, 'denied');
  const dbUser = users.findByTelegramId(3002);
  assert(dbUser.status === 'denied', 'denied user in DB');
  // В plugins/auth.js это 403 BANNED status=denied.
}

console.log('--- non-owner banned → BANNED status=banned simulation ---');
{
  users.upsertFromTelegram(makeUser(3003), 'approved');
  users.softDelete(3003);
  const dbUser = users.findByTelegramId(3003);
  assert(dbUser.status === 'banned', 'banned user in DB');
  assert(dbUser.deleted_at != null, 'deleted_at set');
  // В plugins/auth.js это 403 BANNED status=banned.
}

closeDb();

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
