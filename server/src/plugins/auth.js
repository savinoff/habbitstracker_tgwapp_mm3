// server/src/plugins/auth.js
// Fastify hook, валидирующий X-Telegram-Init-Data на всех маршрутах /api/*,
// кроме явно публичных (например, /api/health).
//
// Используем onRequest (а не preHandler), чтобы запросы к несуществующим
// роутам тоже отклонялись как 401, а не уходили в 404 без проверки.
//
// spec:05-api.md#q9 — все запросы (кроме /api/health) требуют валидный initData
// spec:07-non-functional.md#q3 — TTL 5 мин, whitelist, без логирования initData

import fp from 'fastify-plugin';
import { validateInitData, ValidationError } from '../auth.js';
import { config } from '../config.js';

const PUBLIC_ROUTES = new Set(['/api/health']);

function isPublic(req) {
  // req.url может содержать query string, отрезаем.
  const path = req.url.split('?', 1)[0];
  // Разрешаем только точное совпадение с публичными маршрутами и под /static/...
  if (PUBLIC_ROUTES.has(path)) return true;
  // Любой не-/api/* путь — статика, без auth (для Mini App).
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

    try {
      const { user, auth_date } = validateInitData(raw, config.telegramBotToken, {
        maxAgeSec: config.initDataMaxAgeSec,
        ownerTelegramId: config.ownerTelegramId,
      });
      req.user = user;
      req.authDate = auth_date;
    } catch (err) {
      if (err instanceof ValidationError) {
        // Логируем БЕЗ raw initData, только code, чтобы не утёк payload.
        req.log.warn({ code: err.code }, 'initData rejected');
        reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: err.message },
        });
        return reply;
      }
      throw err;
    }
  });
}

// fastify-plugin снимает инкапсуляцию — хук будет действовать на все роуты,
// зарегистрированные в любом месте приложения, а не только внутри плагина.
export const authPlugin = fp(authPluginImpl, { name: 'authPlugin' });
