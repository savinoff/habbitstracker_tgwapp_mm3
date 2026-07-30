#!/usr/bin/env node
// scripts/test-scheduler.js
// Тесты scheduler.tick(): проверяем логику отправки, idempotency, followup.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'habitstracker-sched-'));
process.env.DATABASE_PATH = join(tmp, 'habits.db');
process.env.TELEGRAM_BOT_TOKEN = 'TEST';
process.env.OWNER_TELEGRAM_ID = '777';

let passed = 0;
let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function bad(label, why) { console.error(`  ✗ ${label}: ${why}`); failed++; }

const { getDb, closeDb } = await import('../server/src/db.js');
const { runMigrations } = await import('../server/src/migrate.js');
const { tick } = await import('../server/src/scheduler.js');
const { upsert: upsertUser } = await import('../server/src/repos/users.js');
const { dateInTz, partsInTz } = await import('../server/src/utils/dateInTz.js');

runMigrations();

function makeMockBot() {
  const sent = [];
  return {
    sent,
    sendMessage(chatId, text) { sent.push({ chatId, text }); return Promise.resolve({}); },
  };
}

function makeUser({ telegramId = 555, tz = 'UTC', morning = '09:00', evening = '21:00' } = {}) {
  return upsertUser({
    telegram_id: telegramId,
    username: `u${telegramId}`,
    first_name: `User${telegramId}`,
  });
}

try {
  // === 1. Создаём пользователя с morning=09:00, evening=21:00, tz=UTC.
  // Зафиксируем "сейчас" = 2026-07-30T09:00:00Z (UTC) и 2026-07-30T21:00:00Z.
  // Тик сравнивает hhmm текущего UTC со временем в настройках.

  // 1a. Утреннее напоминание в 09:00 UTC.
  {
    const u = makeUser();
    const db = getDb();
    db.prepare('UPDATE users SET morning_reminder_time=?, evening_reminder_time=?, timezone=? WHERE id=?')
      .run('09:00', '21:00', 'UTC', u.id);

    // Подменяем "now" на 09:00 UTC через прямой вызов Date.
    const realDate = globalThis.Date;
    globalThis.Date = class extends realDate {
      constructor(...args) { return args.length ? new realDate(...args) : new realDate('2026-07-30T09:00:30Z'); }
      static now() { return new realDate('2026-07-30T09:00:30Z').getTime(); }
    };
    try {
      const bot = makeMockBot();
      const count = await tick(bot);
      if (count === 1 && bot.sent.length === 1 && bot.sent[0].text === 'Доброе утро ☀️ Пора записать, как спал. Нажми кнопку ниже 👇') {
        ok('morning tick: sends reminder at 09:00 UTC');
      } else {
        bad('morning tick', `count=${count}, sent=${JSON.stringify(bot.sent)}`);
      }

      // Повторный тик не должен слать повторно.
      const bot2 = makeMockBot();
      const count2 = await tick(bot2);
      if (count2 === 0 && bot2.sent.length === 0) {
        ok('morning tick: idempotent (no second send)');
      } else {
        bad('morning tick idempotent', `count=${count2}, sent=${JSON.stringify(bot2.sent)}`);
      }
    } finally {
      globalThis.Date = realDate;
    }
  }

  // 1b. Вечернее напоминание в 21:00 UTC.
  {
    const db = getDb();
    // Чистим reminder_log для повторного использования user.
    const u = db.prepare('SELECT * FROM users WHERE telegram_id = 555').get();
    db.prepare('DELETE FROM reminder_log WHERE user_id = ?').run(u.id);

    const realDate = globalThis.Date;
    globalThis.Date = class extends realDate {
      constructor(...args) { return args.length ? new realDate(...args) : new realDate('2026-07-30T21:00:30Z'); }
      static now() { return new realDate('2026-07-30T21:00:30Z').getTime(); }
    };
    try {
      const bot = makeMockBot();
      const count = await tick(bot);
      if (count === 1 && bot.sent[0]?.text?.includes('вечерний отчёт')) {
        ok('evening tick: sends reminder at 21:00 UTC');
      } else {
        bad('evening tick', `count=${count}, sent=${JSON.stringify(bot.sent)}`);
      }
    } finally {
      globalThis.Date = realDate;
    }
  }

  // 2. Followup через 60 мин после evening.
  {
    const db = getDb();
    const u = db.prepare('SELECT * FROM users WHERE telegram_id = 555').get();
    db.prepare('DELETE FROM reminder_log WHERE user_id = ?').run(u.id);

    const realDate = globalThis.Date;
    globalThis.Date = class extends realDate {
      constructor(...args) { return args.length ? new realDate(...args) : new realDate('2026-07-30T22:00:30Z'); }
      static now() { return new realDate('2026-07-30T22:00:30Z').getTime(); }
    };
    try {
      // 2a. Без evening_survey → шлём followup.
      const bot = makeMockBot();
      const count = await tick(bot);
      if (count === 1 && bot.sent[0]?.text?.includes('Не забудь')) {
        ok('followup tick: sends when no evening_survey yet');
      } else {
        bad('followup when no survey', `count=${count}, sent=${JSON.stringify(bot.sent)}`);
      }

      // 2b. С evening_survey → НЕ шлём.
      db.prepare('DELETE FROM reminder_log WHERE user_id = ?').run(u.id);
      db.prepare(
        "INSERT INTO evening_surveys (user_id, local_date, smoked_count, ate_sugar, did_sport, mood_evening, created_at, updated_at) VALUES (?, '2026-07-30', 0, 'no', 0, 3, 0, 0)"
      ).run(u.id);
      const bot2 = makeMockBot();
      const count2 = await tick(bot2);
      if (count2 === 0 && bot2.sent.length === 0) {
        ok('followup tick: skipped when evening_survey already filled');
      } else {
        bad('followup when filled', `count=${count2}, sent=${JSON.stringify(bot2.sent)}`);
      }
    } finally {
      globalThis.Date = realDate;
    }
  }

  // 3. Тик в "неподходящее" время → ничего не шлёт.
  {
    const db = getDb();
    const u = db.prepare('SELECT * FROM users WHERE telegram_id = 555').get();
    db.prepare('DELETE FROM reminder_log WHERE user_id = ?').run(u.id);

    const realDate = globalThis.Date;
    globalThis.Date = class extends realDate {
      constructor(...args) { return args.length ? new realDate(...args) : new realDate('2026-07-30T15:00:00Z'); }
      static now() { return new realDate('2026-07-30T15:00:00Z').getTime(); }
    };
    try {
      const bot = makeMockBot();
      const count = await tick(bot);
      if (count === 0 && bot.sent.length === 0) {
        ok('idle tick: nothing sent at 15:00');
      } else {
        bad('idle tick', `count=${count}`);
      }
    } finally {
      globalThis.Date = realDate;
    }
  }

  // 4. User в другой TZ: morning=09:00 Europe/Moscow = 06:00 UTC.
  // Тик в 06:00 UTC должен сработать.
  {
    const u = makeUser({ telegramId: 666, tz: 'Europe/Moscow', morning: '09:00', evening: '21:00' });
    const db = getDb();
    db.prepare('UPDATE users SET morning_reminder_time=?, evening_reminder_time=?, timezone=? WHERE id=?')
      .run('09:00', '21:00', 'Europe/Moscow', u.id);

    const realDate = globalThis.Date;
    // 06:00 UTC = 09:00 Moscow
    globalThis.Date = class extends realDate {
      constructor(...args) { return args.length ? new realDate(...args) : new realDate('2026-07-30T06:00:30Z'); }
      static now() { return new realDate('2026-07-30T06:00:30Z').getTime(); }
    };
    try {
      const bot = makeMockBot();
      const count = await tick(bot);
      if (count === 1 && bot.sent[0]?.text?.includes('Доброе утро')) {
        ok('TZ-aware: morning=09:00 MSK fires at 06:00 UTC');
      } else {
        bad('TZ-aware morning', `count=${count}, sent=${JSON.stringify(bot.sent)}`);
      }
    } finally {
      globalThis.Date = realDate;
    }
  }

  // 5. bot=null — тик не падает.
  {
    const db = getDb();
    const u = db.prepare('SELECT * FROM users WHERE telegram_id = 555').get();
    db.prepare('DELETE FROM reminder_log WHERE user_id = ?').run(u.id);

    const realDate = globalThis.Date;
    globalThis.Date = class extends realDate {
      constructor(...args) { return args.length ? new realDate(...args) : new realDate('2026-07-30T09:00:30Z'); }
      static now() { return new realDate('2026-07-30T09:00:30Z').getTime(); }
    };
    try {
      const count = await tick(null);
      if (count === 1) {
        ok('null bot: tick completes without crashing');
      } else {
        bad('null bot', `count=${count}`);
      }
    } finally {
      globalThis.Date = realDate;
    }
  }

  // 6. Дата в локальной TZ: для UTC=2026-07-30T21:00:30Z, local_date='2026-07-30'.
  {
    const db = getDb();
    const u = db.prepare('SELECT * FROM users WHERE telegram_id = 555').get();
    db.prepare('DELETE FROM reminder_log WHERE user_id = ?').run(u.id);

    // Проверяем, что reminder_log получил local_date = '2026-07-30'.
    const realDate = globalThis.Date;
    globalThis.Date = class extends realDate {
      constructor(...args) { return args.length ? new realDate(...args) : new realDate('2026-07-30T21:00:30Z'); }
      static now() { return new realDate('2026-07-30T21:00:30Z').getTime(); }
    };
    try {
      await tick(makeMockBot());
      const log = db.prepare("SELECT * FROM reminder_log WHERE user_id = ? AND kind = 'evening'").get(u.id);
      if (log && log.local_date === '2026-07-30') {
        ok('local_date in reminder_log is user-local (UTC)');
      } else {
        bad('local_date in log', JSON.stringify(log));
      }
    } finally {
      globalThis.Date = realDate;
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
