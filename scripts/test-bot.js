#!/usr/bin/env node
// scripts/test-bot.js
// Smoke-тест для бота: эмулируем сообщения через bot.processUpdate и проверяем,
// что /start upsert'ит пользователя и /history формирует правильный URL.
//
// Не требует настоящего Telegram-токена. Использует фейковый токен, бот
// пытается подключиться, polling завалится — мы не дожидаемся, проверяем
// только локальные обработчики.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'habitstracker-bot-'));
process.env.DATABASE_PATH = join(tmp, 'habits.db');
process.env.TELEGRAM_BOT_TOKEN = 'TEST_BOT_TOKEN';
process.env.OWNER_TELEGRAM_ID = '777';
process.env.APP_BASE_URL = 'https://example.com';

let failed = 0;
let passed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function bad(label, why) { console.error(`  ✗ ${label}: ${why}`); failed++; }

const { getDb, closeDb } = await import('../server/src/db.js');
const { runMigrations } = await import('../server/src/migrate.js');
runMigrations();

// Mock-бот: собирает вызовы в массив, не делает реальных запросов.
// Хранит массив onText-обработчиков (как реальный node-telegram-bot-api),
// а в onText(text) вызываются все, чей regex совпал.
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
      // Возвращает Promise<void>, который ждёт ВСЕ обработчики.
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
    fireEvent(ev, payload) {
      const tasks = (eventHandlers[ev] || []).map((eh) => eh(payload));
      return Promise.all(tasks).then(() => {});
    },
    sendMessage(...args) { calls.sendMessage.push(args); return Promise.resolve({}); },
    setChatMenuButton(...args) { calls.setChatMenuButton.push(args); return Promise.resolve(true); },
    stopPolling() {},
  };
}

const { registerHandlers } = await import('../server/src/bot/handlers.js');
const { getSettingsForUser } = await import('../server/src/repos/settings.js');

try {
  // --- /start нового пользователя (v0.4.0+) — pending, без menu button.
  const bot1 = makeMockBot();
  const errs = [];
  const noop = () => {};
  registerHandlers(bot1, { appBaseUrl: 'https://example.com', logger: { warn: noop, info: noop, error(e){errs.push(e.err?.message || e.err || JSON.stringify(e));} } });

  await bot1.fireText({
    chat: { id: 555, type: 'private' },
    from: { id: 555, username: 'alice', first_name: 'Alice' },
    text: '/start',
  });

  // Для pending-пользователя menu button НЕ ставится (нельзя открыть Mini App).
  if (bot1.calls.setChatMenuButton.length === 0) {
    ok('/start (new pending user): no menu button');
  } else {
    bad('/start (new pending user) menu', `expected 0, got ${bot1.calls.setChatMenuButton.length}`);
  }

  // sendMessage: pending welcome + owner notification.
  if (bot1.calls.sendMessage.length === 2) {
    const [toUser, userText] = bot1.calls.sendMessage[0];
    if (toUser === 555 && userText.includes('Заявка')) {
      ok('/start (new pending user): user notified about pending');
    } else {
      bad('/start (new pending user) text', JSON.stringify(bot1.calls.sendMessage[0]));
    }
    const [toOwner, ownerText] = bot1.calls.sendMessage[1];
    if (toOwner === 777 && ownerText.includes('Новая заявка')) {
      ok('/start (new pending user): owner notified');
    } else {
      bad('/start (new pending user) owner', JSON.stringify(bot1.calls.sendMessage[1]));
    }
  } else {
    bad('/start (new pending user) count', `expected 2, got ${bot1.calls.sendMessage.length} — calls: ${JSON.stringify(bot1.calls.sendMessage)} — errs: ${JSON.stringify(errs)}`);
  }

  // Пользователь в БД со status=pending.
  const db = getDb();
  const u = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(555);
  if (u && u.first_name === 'Alice' && u.username === 'alice' && u.status === 'pending') {
    ok('/start: user upserted in DB with status=pending');
  } else {
    bad('/start user upsert', JSON.stringify(u));
  }

  // --- /start БЕЗ APP_BASE_URL (dev) — menu button не вызывается, кнопки нет.
  const bot2 = makeMockBot();
  registerHandlers(bot2, { appBaseUrl: '', logger: { warn(){}, error(){} } });
  await bot2.fireText({
    chat: { id: 666, type: 'private' },
    from: { id: 666, first_name: 'Bob' },
    text: '/start',
  });
  if (bot2.calls.setChatMenuButton.length === 0) {
    ok('/start (no APP_BASE_URL): setChatMenuButton skipped');
  } else {
    bad('/start (no APP_BASE_URL)', 'setChatMenuButton was called');
  }
  if (bot2.calls.sendMessage[0]?.[2]?.reply_markup === undefined) {
    ok('/start (no APP_BASE_URL): no inline button');
  } else {
    bad('/start (no APP_BASE_URL) inline button', JSON.stringify(bot2.calls.sendMessage[0][2]));
  }

  // --- /history — URL должен оканчиваться на /#history
  const bot3 = makeMockBot();
  registerHandlers(bot3, { appBaseUrl: 'https://example.com', logger: { warn(){}, error(){} } });
  await bot3.fireText({
    chat: { id: 555, type: 'private' },
    text: '/history',
  });
  if (bot3.calls.sendMessage.length === 1) {
    const [chatId, text, opts] = bot3.calls.sendMessage[0];
    const url = opts?.reply_markup?.inline_keyboard?.[0]?.[0]?.web_app?.url;
    if (url === 'https://example.com/#history') {
      ok('/history: web_app url has #history deep-link');
    } else {
      bad('/history url', `got: ${url}`);
    }
  } else {
    bad('/history sendMessage', 'no message sent');
  }

  // --- /history БЕЗ APP_BASE_URL — текстовый fallback
  const bot4 = makeMockBot();
  registerHandlers(bot4, { appBaseUrl: '', logger: { warn(){}, error(){} } });
  await bot4.fireText({ chat: { id: 555, type: 'private' }, text: '/history' });
  if (bot4.calls.sendMessage[0]?.[1]?.includes('dev-режиме')) {
    ok('/history (no APP_BASE_URL): text fallback');
  } else {
    bad('/history fallback', JSON.stringify(bot4.calls.sendMessage[0]));
  }

  // --- Неизвестный текст в личке → подсказка
  const bot5 = makeMockBot();
  registerHandlers(bot5, { appBaseUrl: 'https://example.com', logger: { warn(){}, error(){} } });
  // Запускаем обработчик 'message' вручную, не onText.
  await bot5.fireEvent("message", {
    chat: { id: 555, type: 'private' },
    text: 'привет',
  });
  if (bot5.calls.sendMessage[0]?.[1]?.includes('/start')) {
    ok('unknown text in DM: helpful hint');
  } else {
    bad('unknown text', JSON.stringify(bot5.calls.sendMessage[0]));
  }

  // --- Не команда в группе → игнор
  const bot6 = makeMockBot();
  registerHandlers(bot6, { appBaseUrl: 'https://example.com', logger: { warn(){}, error(){} } });
  await bot6.fireEvent("message", { chat: { id: -100, type: 'group' }, text: 'hi' });
  if (bot6.calls.sendMessage.length === 0) {
    ok('non-private chat: ignored');
  } else {
    bad('non-private chat', 'should not reply');
  }

  // --- /start в группе с упоминанием @botname — должен сработать.
  // Для этого используем тот же bot5 и зовём onText с правильным text.
  const bot7 = makeMockBot();
  registerHandlers(bot7, { appBaseUrl: '', logger: { warn(){}, error(){} } });
  // onText regex сматчит /start или /start@anything
  await bot7.fireText({
    chat: { id: 555, type: 'private' },
    from: { id: 555, first_name: 'X' },
    text: '/start@somebot',
  });
  if (bot7.calls.sendMessage.length === 1) {
    ok('/start@botname: handled');
  } else {
    bad('/start@botname', 'not handled');
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
