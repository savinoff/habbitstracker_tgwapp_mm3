#!/usr/bin/env node
// scripts/test-bot-admin.js
// Тесты admin-команд бота (v0.4.0+).
//
// spec:09-multi-user.md#q3 — /allow, /deny, /list_pending, /list_users, /revoke, /unban

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'habitstracker-bot-admin-'));
process.env.DATABASE_PATH = join(tmp, 'habits.db');
process.env.TELEGRAM_BOT_TOKEN = 'TEST_BOT_TOKEN';
process.env.OWNER_TELEGRAM_ID = '777';
process.env.APP_BASE_URL = '';

const { getDb, closeDb } = await import('../server/src/db.js');
const { runMigrations } = await import('../server/src/migrate.js');
const { registerHandlers } = await import('../server/src/bot/handlers.js');
const usersMod = await import('../server/src/users.js');

runMigrations();

let failed = 0;
let passed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function bad(label, why) { console.error(`  ✗ ${label}: ${why}`); failed++; }

// Mock-бот (как в test-bot.js). Передаёт match-результат regex в handler.
function makeMockBot() {
  const calls = { sendMessage: [], setChatMenuButton: [] };
  const textHandlers = [];
  const eventHandlers = {};
  return {
    calls,
    textHandlers,
    eventHandlers,
    onText(re, h) { textHandlers.push({ re, h }); },
    on(ev, h) { (eventHandlers[ev] = eventHandlers[ev] || []).push(h); },
    fireText(msg) {
      const tasks = [];
      for (const th of textHandlers) {
        if (th.re.test(msg.text)) {
          const m = th.re.exec(msg.text);
          tasks.push(th.h(msg, m));
        }
      }
      for (const eh of (eventHandlers.message || [])) tasks.push(eh(msg));
      return Promise.all(tasks).then(() => {});
    },
    sendMessage(...args) { calls.sendMessage.push(args); return Promise.resolve({}); },
    setChatMenuButton(...args) { calls.setChatMenuButton.push(args); return Promise.resolve(true); },
    stopPolling() {},
  };
}

const quietLogger = { warn() {}, error() {}, info() {} };

try {
  // ===== Бот-админ взаимодействует =====
  // owner = 777 (из OWNER_TELEGRAM_ID).
  // pending users: 1001, 1002.
  // approved user: 2001.
  // banned user: 3001 (soft-deleted).
  usersMod.upsertFromTelegram({ id: 1001, username: 'alice', first_name: 'Alice' }, 'pending');
  usersMod.upsertFromTelegram({ id: 1002, username: 'bob', first_name: 'Bob' }, 'pending');
  usersMod.upsertFromTelegram({ id: 2001, username: 'carol', first_name: 'Carol' }, 'approved');
  usersMod.upsertFromTelegram({ id: 3001, username: 'dan', first_name: 'Dan' }, 'approved');
  usersMod.softDelete(3001);

  // ===== /allow — owner approves pending =====
  {
    const bot = makeMockBot();
    registerHandlers(bot, { appBaseUrl: '', logger: quietLogger });
    await bot.fireText({
      chat: { id: 777, type: 'private' },
      from: { id: 777, is_bot: false, first_name: 'Owner' },
      text: '/allow 1001',
    });
    // Должно быть 2 sendMessage: подтверждение owner'у + уведомление юзеру 1001.
    if (bot.calls.sendMessage.length === 2) {
      const [toOwner] = bot.calls.sendMessage[0];
      const [toUser] = bot.calls.sendMessage[1];
      if (toOwner === 777 && bot.calls.sendMessage[0][1].includes('Одобрен(а)')) {
        ok('/allow: owner notified');
      } else {
        bad('/allow owner notification', JSON.stringify(bot.calls.sendMessage[0]));
      }
      if (toUser === 1001 && bot.calls.sendMessage[1][1].includes('Доступ открыт')) {
        ok('/allow: target user notified');
      } else {
        bad('/allow user notification', JSON.stringify(bot.calls.sendMessage[1]));
      }
    } else {
      bad('/allow sendMessage count', `expected 2, got ${bot.calls.sendMessage.length}`);
    }
    // Статус в БД?
    const u = usersMod.findByTelegramId(1001);
    if (u.status === 'approved') {
      ok('/allow: status updated to approved');
    } else {
      bad('/allow DB status', u.status);
    }
  }

  // ===== /allow — non-owner rejected (no sendMessage) =====
  {
    const bot = makeMockBot();
    registerHandlers(bot, { appBaseUrl: '', logger: quietLogger });
    await bot.fireText({
      chat: { id: 1001, type: 'private' },
      from: { id: 1001, is_bot: false },
      text: '/allow 1002',
    });
    if (bot.calls.sendMessage.length === 0) {
      ok('/allow from non-owner: silently rejected');
    } else {
      bad('/allow from non-owner', 'sendMessage was called');
    }
  }

  // ===== /deny — owner denies pending =====
  {
    const bot = makeMockBot();
    registerHandlers(bot, { appBaseUrl: '', logger: quietLogger });
    await bot.fireText({
      chat: { id: 777, type: 'private' },
      from: { id: 777, is_bot: false },
      text: '/deny 1002',
    });
    const u = usersMod.findByTelegramId(1002);
    if (u.status === 'denied') {
      ok('/deny: status updated to denied');
    } else {
      bad('/deny status', u.status);
    }
  }

  // ===== /list_pending =====
  {
    const bot = makeMockBot();
    registerHandlers(bot, { appBaseUrl: '', logger: quietLogger });
    // 1001 → approved (выше), 1002 → denied (выше). pending нет.
    await bot.fireText({
      chat: { id: 777, type: 'private' },
      from: { id: 777, is_bot: false },
      text: '/list_pending',
    });
    if (bot.calls.sendMessage[0][1].includes('Нет нерассмотренных')) {
      ok('/list_pending: empty list shows "no pending"');
    } else {
      bad('/list_pending', bot.calls.sendMessage[0][1].slice(0, 100));
    }
  }

  // ===== /list_users =====
  {
    const bot = makeMockBot();
    registerHandlers(bot, { appBaseUrl: '', logger: quietLogger });
    await bot.fireText({
      chat: { id: 777, type: 'private' },
      from: { id: 777, is_bot: false },
      text: '/list_users',
    });
    if (bot.calls.sendMessage[0][1].includes('Пользователей:')) {
      ok('/list_users: shows count');
    } else {
      bad('/list_users', bot.calls.sendMessage[0][1].slice(0, 100));
    }
  }

  // ===== /revoke — owner revokes approved user =====
  {
    const bot = makeMockBot();
    registerHandlers(bot, { appBaseUrl: '', logger: quietLogger });
    await bot.fireText({
      chat: { id: 777, type: 'private' },
      from: { id: 777, is_bot: false },
      text: '/revoke 2001',
    });
    const u = usersMod.findByTelegramId(2001);
    if (u.status === 'banned' && u.deleted_at !== null) {
      ok('/revoke: soft-deleted (status=banned, deleted_at set)');
    } else {
      bad('/revoke', JSON.stringify({ status: u.status, deleted_at: u.deleted_at }));
    }
  }

  // ===== /revoke — owner не может revoke'нуть себя =====
  {
    const bot = makeMockBot();
    registerHandlers(bot, { appBaseUrl: '', logger: quietLogger });
    await bot.fireText({
      chat: { id: 777, type: 'private' },
      from: { id: 777, is_bot: false },
      text: '/revoke 777',
    });
    if (bot.calls.sendMessage.some((m) => m[1].includes('Нельзя отозвать'))) {
      ok('/revoke: cannot revoke owner');
    } else {
      bad('/revoke self', JSON.stringify(bot.calls.sendMessage));
    }
  }

  // ===== /unban — restore banned user =====
  {
    const bot = makeMockBot();
    registerHandlers(bot, { appBaseUrl: '', logger: quietLogger });
    await bot.fireText({
      chat: { id: 777, type: 'private' },
      from: { id: 777, is_bot: false },
      text: '/unban 3001',
    });
    const u = usersMod.findByTelegramId(3001);
    if (u.status === 'approved' && u.deleted_at === null) {
      ok('/unban: restored to approved');
    } else {
      bad('/unban', JSON.stringify({ status: u.status, deleted_at: u.deleted_at }));
    }
  }

  // ===== /allow — invalid id =====
  {
    const bot = makeMockBot();
    registerHandlers(bot, { appBaseUrl: '', logger: quietLogger });
    await bot.fireText({
      chat: { id: 777, type: 'private' },
      from: { id: 777, is_bot: false },
      text: '/allow abc',
    });
    if (bot.calls.sendMessage[0][1].includes('Некорректный id')) {
      ok('/allow: invalid id rejected');
    } else {
      bad('/allow invalid id', bot.calls.sendMessage[0][1]);
    }
  }

  // ===== /allow — not found =====
  {
    const bot = makeMockBot();
    registerHandlers(bot, { appBaseUrl: '', logger: quietLogger });
    await bot.fireText({
      chat: { id: 777, type: 'private' },
      from: { id: 777, is_bot: false },
      text: '/allow 9999999',
    });
    if (bot.calls.sendMessage[0][1].includes('не найдено')) {
      ok('/allow: not-found user rejected');
    } else {
      bad('/allow not found', bot.calls.sendMessage[0][1]);
    }
  }

  // ===== /start — уведомление owner'у о новой заявке =====
  {
    const bot = makeMockBot();
    registerHandlers(bot, { appBaseUrl: '', logger: quietLogger });
    await bot.fireText({
      chat: { id: 5001, type: 'private' },
      from: { id: 5001, username: 'eve', first_name: 'Eve', is_premium: true, language_code: 'en' },
      text: '/start',
    });
    // sendMessage[0] — user (pending welcome).
    // sendMessage[1] — owner notification (new request).
    const ownerNotice = bot.calls.sendMessage.find((m) => m[0] === 777);
    if (ownerNotice && ownerNotice[1].includes('Новая заявка')) {
      ok('/start (new user): owner notified with details');
      if (ownerNotice[1].includes('eve') && ownerNotice[1].includes('5001') && ownerNotice[1].includes('premium')) {
        ok('/start notice: contains username, id, is_premium');
      } else {
        bad('/start notice content', ownerNotice[1].slice(0, 200));
      }
    } else {
      bad('/start notice', JSON.stringify(bot.calls.sendMessage));
    }
  }

  // ===== /start — повторный, для уже approved (уведомление owner'у) =====
  {
    // Создадим свежего approved пользователя для этого теста.
    usersMod.upsertFromTelegram({ id: 4001, username: 'reuser', first_name: 'ReUser' }, 'approved');
    const bot = makeMockBot();
    registerHandlers(bot, { appBaseUrl: '', logger: quietLogger });
    await bot.fireText({
      chat: { id: 4001, type: 'private' },
      from: { id: 4001, username: 'reuser', first_name: 'ReUser' },
      text: '/start',
    });
    const ownerNotice = bot.calls.sendMessage.find((m) => m[0] === 777);
    if (ownerNotice && ownerNotice[1].includes('перезапустил бота')) {
      ok('/start (approved re-start): owner notified');
    } else {
      bad('/start re-start', JSON.stringify(bot.calls.sendMessage));
    }
  }

} catch (err) {
  console.error('test crashed:', err);
  failed++;
} finally {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
