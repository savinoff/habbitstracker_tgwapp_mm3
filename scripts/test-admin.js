#!/usr/bin/env node
// scripts/test-admin.js
// Тесты для /api/admin/* маршрутов и audit dual-write (v0.4.0+).
//
// Покрывает:
//   - audit.audit пишет в БД + файл
//   - audit.list фильтрует
//   - /api/admin/users — список, фильтр по status
//   - /api/admin/audit — журнал
//   - /api/admin/stats — сводка
//   - /api/admin/* требует owner

import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';

const tmp = mkdtempSync(join(tmpdir(), 'habitstracker-admin-'));
const dbPath = join(tmp, 'habits.db');
process.env.DATABASE_PATH = dbPath;
process.env.TELEGRAM_BOT_TOKEN = 'TEST_BOT_TOKEN';
process.env.OWNER_TELEGRAM_ID = '777';

let failed = 0;
let passed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function bad(label, why) { console.error(`  ✗ ${label}: ${why}`); failed++; }

const { getDb, closeDb } = await import('../server/src/db.js');
const { runMigrations } = await import('../server/src/migrate.js');
const audit = await import('../server/src/audit.js');
const users = await import('../server/src/users.js');

runMigrations();

// ===== audit.audit + audit.list =====
console.log('--- audit dual-write ---');
{
  audit.audit({ actor_id: null, action: 'start_received', target_id: 5001, details: { x: 1 } });
  audit.audit({ actor_id: 777, action: 'allow', target_id: 5001 });
  audit.audit({ actor_id: 777, action: 'deny', target_id: 5002, details: { reason: 'spam' } });

  // Файл должен существовать (audit.log в dirname(db)).
  const auditFile = join(tmp, 'audit.log');
  if (existsSync(auditFile)) {
    ok('audit file written');
    const lines = readFileSync(auditFile, 'utf8').split('\n').filter(Boolean);
    if (lines.length === 3) {
      ok('audit file has 3 lines');
    } else {
      bad('audit file lines', `expected 3, got ${lines.length}`);
    }
  } else {
    bad('audit file', 'not found at ' + join(tmp, 'audit.log'));
  }

  // БД.
  const all = audit.list({});
  if (all.total === 3 && all.items.length === 3) {
    ok('audit.list returns 3');
  } else {
    bad('audit.list total', JSON.stringify(all));
  }
  // Фильтр по action.
  const allows = audit.list({ action: 'allow' });
  if (allows.total === 1 && allows.items[0].target_id === 5001) {
    ok('audit.list filter by action');
  } else {
    bad('audit.list allow', JSON.stringify(allows));
  }
  // Фильтр по target_id.
  const t5002 = audit.list({ target_id: 5002 });
  if (t5002.total === 1 && t5002.items[0].action === 'deny') {
    ok('audit.list filter by target_id');
  } else {
    bad('audit.list target_id', JSON.stringify(t5002));
  }
}

// ===== Fastify app test (через inject) =====
console.log('--- /api/admin/* routes ---');
{
  // fastify в server/node_modules. Запускаем скрипт через `npm --prefix server exec` или NODE_PATH.
  // Здесь используем относительный импорт через динамический import() с прямым путём.
  const Fastify = (await import('../server/node_modules/fastify/fastify.js')).default;
  const adminRoutes = (await import('../server/src/routes/admin.js')).default;
  const userRoutes = (await import('../server/src/routes/users.js')).default;

  // Создадим несколько пользователей.
  users.upsertFromTelegram({ id: 777, first_name: 'Owner', is_premium: true }, 'approved');
  users.upsertFromTelegram({ id: 6001, first_name: 'P1' }, 'pending');
  users.upsertFromTelegram({ id: 6002, first_name: 'P2' }, 'pending');
  users.upsertFromTelegram({ id: 6003, first_name: 'A1' }, 'approved');
  users.softDelete(6003);  // → banned
  // Запись audit для admin
  audit.audit({ actor_id: 777, action: 'allow', target_id: 6001 });
  audit.audit({ actor_id: 777, action: 'deny', target_id: 6002 });

  function makeApp(isOwner) {
    const app = Fastify({ logger: false });
    // Мок для req.user — подменяем через preHandler.
    app.addHook('preHandler', async (req) => {
      req.user = { id: 777, _dbId: 1, isOwner, status: 'approved' };
    });
    // Отключим реальный authPlugin — мы тестируем только admin routes.
    // Но нам нужен setNotFoundHandler чтобы не падать.
    return app.register(adminRoutes).register(userRoutes).ready();
  }

  // ---- non-owner → 403 ----
  {
    const app = await makeApp(false);
    const res = await app.inject({ method: 'GET', url: '/api/admin/users' });
    if (res.statusCode === 403) {
      ok('GET /api/admin/users: non-owner → 403');
    } else {
      bad('non-owner /api/admin/users', `got ${res.statusCode} ${res.payload}`);
    }
    await app.close();
  }

  // ---- owner → 200 ----
  {
    const app = await makeApp(true);
    const res = await app.inject({ method: 'GET', url: '/api/admin/users' });
    if (res.statusCode === 200) {
      const body = JSON.parse(res.payload);
      if (body.ok && body.data && Array.isArray(body.data.rows)) {
        ok('GET /api/admin/users: owner returns users');
        // Должны быть 777, 6001, 6002, 6003.
        if (body.data.total >= 4) {
          ok('GET /api/admin/users: at least 4 users');
        } else {
          bad('total', `got ${body.data.total}`);
        }
      } else {
        bad('users payload', res.payload.slice(0, 200));
      }
    } else {
      bad('owner /api/admin/users', `got ${res.statusCode} ${res.payload}`);
    }

    // Фильтр по status=pending.
    const res2 = await app.inject({ method: 'GET', url: '/api/admin/users?status=pending' });
    const body2 = JSON.parse(res2.payload);
    if (body2.data.total === 2) {
      ok('GET /api/admin/users?status=pending: 2 results');
    } else {
      bad('filter pending', `got total=${body2.data.total}`);
    }

    // /api/admin/audit
    const res3 = await app.inject({ method: 'GET', url: '/api/admin/audit' });
    const body3 = JSON.parse(res3.payload);
    if (body3.ok && body3.data && body3.data.items && body3.data.items.length >= 5) {
      ok('GET /api/admin/audit: returns items');
    } else {
      bad('audit endpoint', `status=${res3.statusCode} body=${res3.payload.slice(0, 200)}`);
    }

    // /api/admin/stats
    const res4 = await app.inject({ method: 'GET', url: '/api/admin/stats' });
    const body4 = JSON.parse(res4.payload);
    if (body4.ok && body4.data && typeof body4.data.users_total === 'number') {
      ok('GET /api/admin/stats: returns breakdown');
      if (body4.data.users_pending === 2) {
        ok('stats: users_pending=2');
      } else {
        bad('stats pending', `got ${body4.data.users_pending}`);
      }
      if (body4.data.users_approved >= 1) {
        ok('stats: users_approved >= 1');
      } else {
        bad('stats approved', `got ${body4.data.users_approved}`);
      }
      if (body4.data.users_banned >= 1) {
        ok('stats: users_banned >= 1');
      } else {
        bad('stats banned', `got ${body4.data.users_banned}`);
      }
    } else {
      bad('stats endpoint', `status=${res4.statusCode} body=${res4.payload.slice(0, 200)}`);
    }

    await app.close();
  }

  // ---- /api/users/me (для non-owner и owner) ----
  console.log('--- /api/users/me ---');
  {
    // Создадим отдельный юзер (id 7001) для теста /api/users/me.
    users.upsertFromTelegram({ id: 7001, username: 'testme', first_name: 'TestMe' }, 'approved');
    const u = users.findByTelegramId(7001);

    const app = Fastify({ logger: false });
    app.addHook('preHandler', async (req) => {
      req.user = { id: 7001, _dbId: u.id, isOwner: false, status: 'approved' };
    });
    await app.register(userRoutes);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/users/me' });
    if (res.statusCode === 200) {
      const body = JSON.parse(res.payload);
      if (body.data.telegram_id === 7001 && body.data.is_owner === false && body.data.status === 'approved') {
        ok('GET /api/users/me: returns own profile');
      } else {
        bad('/api/users/me content', JSON.stringify(body));
      }
    } else {
      bad('/api/users/me', `status=${res.statusCode}`);
    }
    await app.close();
  }

  // ---- /api/users/me/settings (GET + POST) ----
  console.log('--- /api/users/me/settings ---');
  {
    const u = users.findByTelegramId(7001);
    const app = Fastify({ logger: false });
    app.addHook('preHandler', async (req) => {
      req.user = { id: 7001, _dbId: u.id, isOwner: false, status: 'approved' };
    });
    await app.register(userRoutes);
    await app.ready();

    // GET — дефолтные настройки.
    const res1 = await app.inject({ method: 'GET', url: '/api/users/me/settings' });
    if (res1.statusCode === 200) {
      const body = JSON.parse(res1.payload);
      if (body.data.tz === 'UTC' && body.data.onboarded_at === null) {
        ok('GET /api/users/me/settings: defaults, not onboarded');
      } else {
        bad('settings defaults', JSON.stringify(body));
      }
    } else {
      bad('GET settings', `status=${res1.statusCode}`);
    }

    // POST — задать tz (это онбординг).
    const res2 = await app.inject({
      method: 'POST', url: '/api/users/me/settings',
      payload: { tz: 'Europe/Moscow' },
    });
    if (res2.statusCode === 200) {
      const body = JSON.parse(res2.payload);
      if (body.data.tz === 'Europe/Moscow' && body.data.onboarded_at !== null) {
        ok('POST /api/users/me/settings: tz sets onboarded_at');
      } else {
        bad('POST settings result', JSON.stringify(body));
      }
    } else {
      bad('POST settings', `status=${res2.statusCode} ${res2.payload}`);
    }

    // POST — невалидный tz.
    const res3 = await app.inject({
      method: 'POST', url: '/api/users/me/settings',
      payload: { tz: 'Atlantis/Atlantis' },
    });
    if (res3.statusCode === 400) {
      ok('POST /api/users/me/settings: invalid tz → 400');
    } else {
      bad('POST invalid tz', `status=${res3.statusCode}`);
    }

    await app.close();
  }
}

closeDb();
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
