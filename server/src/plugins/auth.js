// server/src/plugins/auth.js
// Fastify hook, валидирующий X-Telegram-Init-Data на всех маршрутах /api/*,
// кроме явно публичных (например, /api/health).
//
// Используем onRequest (а не preHandler), чтобы запросы к несуществующим
// роутам тоже отклонялись как 401, а не уходили в 404 без проверки.
//
// spec:05-api.md#q9 — все запросы (кроме /api/health) требуют валидный initData
// spec:07-non-functional.md#q3 — TTL 5 мин, whitelist, без логирования initData
// spec:09-multi-user.md#q5 — escape hatch через OWNER_TELEGRAM_ID, иначе status из БД

import fp from 'fastify-plugin';
import { validateInitData, ValidationError } from '../auth.js';
import * as users from '../users.js';
import { config } from '../config.js';

const PUBLIC_ROUTES = new Set(['/api/health']);

function isPublic(req) {
  const path = req.url.split('?', 1)[0];
  if (PUBLIC_ROUTES.has(path)) return true;
  if (!path.startsWith('/api/')) return true;
  return false;
}

async function authPluginImpl(fastify) {
  fastify.addHook('onRequest', async (req, reply) => {
    if (isPublic(req)) return;

    const raw = req.headers['x-telegram-init-data'];
    if (!raw || typeof raw !== 'string') {
      reply.code(401).send({
        error: { code: 'UNAUTHORIZED', message: 'X-Telegram-Init-Data header required' },
      });
      return reply;
    }

    let user;
    try {
      const r = validateInitData(raw, config.telegramBotToken, {
        maxAgeSec: config.initDataMaxAgeSec,
      });
      user = r.user;
      req.authDate = r.auth_date;
    } catch (err) {
      if (err instanceof ValidationError) {
        req.log.warn({ code: err.code }, 'initData rejected');
        reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: err.message },
        });
        return reply;
      }
      throw err;
    }

    // spec:09-multi-user.md#q5 — whitelist через БД + escape hatch.
    const ownerId = config.ownerTelegramId;
    const isOwner = ownerId && Number(ownerId) === Number(user.id);

    let dbUser = users.findByTelegramId(user.id);

    if (isOwner) {
      // Escape hatch: owner всегда имеет доступ, даже если записи в БД нет.
      // Создаём запись со status='approved' при первом логине.
      if (!dbUser) {
        dbUser = users.upsertFromTelegram(user, 'approved');
        req.log.info({ telegramId: user.id }, 'owner auto-registered');
      } else if (dbUser.status !== 'approved') {
        // Восстанавливаем доступ (на случай если кто-то случайно revoke'нул owner'а).
        users.setStatus(user.id, 'approved');
        dbUser = users.findByTelegramId(user.id);
        req.log.warn({ telegramId: user.id }, 'owner status restored via escape hatch');
      }
    } else {
      // Не-owner. Должен быть в БД.
      if (!dbUser) {
        // Юзер ещё не /start бот. Не пускаем.
        req.log.info({ telegramId: user.id }, 'login denied: user not registered');
        reply.code(401).send({
          error: {
            code: 'NOT_REGISTERED',
            message: 'Send /start to the bot first',
          },
        });
        return reply;
      }
      if (dbUser.status === 'pending') {
        reply.code(403).send({
          error: {
            code: 'NOT_APPROVED',
            message: 'Your request is pending admin approval',
            status: 'pending',
          },
        });
        return reply;
      }
      if (dbUser.status === 'denied') {
        reply.code(403).send({
          error: {
            code: 'BANNED',
            message: 'Your request was denied. Send /start to re-apply.',
            status: 'denied',
          },
        });
        return reply;
      }
      if (dbUser.status === 'banned' || dbUser.deleted_at !== null) {
        reply.code(403).send({
          error: {
            code: 'BANNED',
            message: 'Access revoked. Contact admin.',
            status: 'banned',
          },
        });
        return reply;
      }
    }

    // approved (включая owner через escape hatch). Обновляем кэш и last_seen_at.
    users.upsertFromTelegram(user, dbUser.status);
    users.markSeen(user.id);
    dbUser = users.findByTelegramId(user.id);

    req.user = { ...user, _dbId: dbUser.id, isOwner: Boolean(isOwner), status: dbUser.status };
  });
}

export const authPlugin = fp(authPluginImpl, { name: 'authPlugin' });
