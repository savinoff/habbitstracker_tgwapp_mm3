// server/src/bot/handlers.js
// Регистрирует обработчики команд бота.
//
// spec:02-user-stories.md#US-01..US-08
// spec:03-features/reminders.md#q4
// spec:09-multi-user.md#q3 — admin-команды (v0.4.0+)
// spec:09-multi-user.md#q10 — audit на admin-операции

import * as users from '../users.js';
import * as audit from '../audit.js';
import { config } from '../config.js';
import { TEXTS } from './texts.js';
import { setMenuButton } from './menu.js';

/**
 * Парсит положительное целое из строки. Возвращает число или null.
 */
function parseTgId(s) {
  if (!s || typeof s !== 'string') return null;
  const m = /^\d{1,20}$/.exec(s.trim());
  if (!m) return null;
  const n = Number(s.trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Форматирует пользователя для уведомления админу.
 */
function formatUserForAdmin(u) {
  return {
    telegram_id: u.telegram_id,
    username: u.username,
    first_name: u.first_name,
    last_name: u.last_name,
    language_code: u.language_code,
    is_premium: Boolean(u.is_premium),
    timezone: u.timezone,
    created_at: u.created_at,
    was_before: false,  // обновляется вызывающим кодом
  };
}

export function registerHandlers(bot, { appBaseUrl, logger }) {
  const ownerId = config.ownerTelegramId;

  // /start — спека 09-multi-user.md#q3.
  // Поведение зависит от текущего статуса пользователя:
  //   - не существует в БД: создаём pending, шлём owner'у заявку.
  //   - approved: re-start → уведомление owner'у, обычный приветственный текст.
  //   - pending: «ждём одобрения».
  //   - denied: «отклонено, попробуй позже».
  //   - banned (deleted_at IS NOT NULL): «доступ закрыт».
  bot.onText(/^\/start(?:@\w+)?$/, async (msg) => {
    const chatId = msg.chat.id;
    const from = msg.from || {};
    if (from.id == null) return;

    try {
      const existing = users.findByTelegramId(from.id);
      const tgUser = {
        id: from.id,
        username: from.username ?? null,
        first_name: from.first_name ?? null,
        last_name: from.last_name ?? null,
        language_code: from.language_code ?? null,
        is_premium: Boolean(from.is_premium),
      };

      let dbUser;
      if (existing) {
        if (existing.status === 'banned' || existing.deleted_at !== null) {
          await bot.sendMessage(chatId, TEXTS.startBanned);
          return;
        }
        if (existing.status === 'denied') {
          // Создаём новую заявку? Нет — denied — финальный статус.
          await bot.sendMessage(chatId, TEXTS.startDenied);
          return;
        }
        if (existing.status === 'approved') {
          // Re-start: уведомление owner'у, приветствие.
          if (ownerId && Number(ownerId) !== from.id) {
            try {
              await bot.sendMessage(
                Number(ownerId),
                TEXTS.adminRestart(existing),
              );
            } catch { /* owner может не запустить бота, не критично */ }
          }
          await sendApprovedGreeting(bot, chatId, from, appBaseUrl);
          return;
        }
        // status === 'pending': обновляем кэш полей, шлём «ждём».
        dbUser = users.upsertFromTelegram(tgUser, 'pending');
        await bot.sendMessage(chatId, TEXTS.startPending(from.first_name));
        return;
      }

      // Новый пользователь: создаём pending, шлём owner'у заявку.
      dbUser = users.upsertFromTelegram(tgUser, 'pending');
      logger.info(
        { telegramId: from.id, username: from.username },
        'new pending request created',
      );

      // Сначала отвечаем юзеру (он ждёт).
      await bot.sendMessage(chatId, TEXTS.startPending(from.first_name));

      // Потом уведомляем owner'а (если он есть и не сам).
      if (ownerId && Number(ownerId) !== from.id) {
        try {
          const noticeData = formatUserForAdmin(dbUser);
          noticeData.was_before = false;
          await bot.sendMessage(Number(ownerId), TEXTS.adminNewRequest(noticeData));
        } catch (err) {
          logger.warn({ err }, 'failed to notify owner about new request');
        }
      }
      // Audit: новая заявка (actor=null = system, target=requestor).
      audit.audit({
        actor_id: null,
        action: 'start_received',
        target_id: from.id,
        details: { status: 'pending', was_before: false },
      });
    } catch (err) {
      logger.error({ err, chatId }, 'failed to handle /start');
      try {
        await bot.sendMessage(chatId, TEXTS.genericError);
      } catch { /* swallow */ }
    }
  });

  // /history — без изменений. spec:09-multi-user.md (не в scope, US-08).
  bot.onText(/^\/history(?:@\w+)?$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!appBaseUrl) {
      await bot.sendMessage(chatId, 'История пока недоступна в dev-режиме (нет APP_BASE_URL).');
      return;
    }
    const url = `${appBaseUrl.replace(/\/$/, '')}/#history`;
    await bot.sendMessage(chatId, TEXTS.historyReply, {
      reply_markup: {
        inline_keyboard: [
          [{ text: TEXTS.startOpenButton, web_app: { url } }],
        ],
      },
    });
  });

  // ====== v0.4.0+ admin-команды (только owner) ======

  // /allow <id> — pending|denied|approved → approved. Если юзера нет — 404.
  bot.onText(/^\/allow(?:@\w+)?\s+(\S+)/, async (msg, match) => {
    if (!isOwner(msg.from, ownerId, logger)) return;
    const tgId = parseTgId(match[1]);
    if (tgId == null) {
      await bot.sendMessage(msg.chat.id, TEXTS.invalidId(match[1]));
      return;
    }
    const u = users.findByTelegramId(tgId);
    if (!u) {
      await bot.sendMessage(msg.chat.id, TEXTS.notFound(tgId));
      return;
    }
    // pending → approved, denied → approved (повторное рассмотрение).
    // approved → no-op (idempotent).
    // banned → нужно сначала /unban (двухшаговая операция).
    if (u.status === 'banned' || u.deleted_at !== null) {
      await bot.sendMessage(msg.chat.id, TEXTS.badState('allow', 'banned'));
      return;
    }
    if (u.status === 'approved') {
      await bot.sendMessage(msg.chat.id, `ℹ️ Уже одобрен(а): @${u.username || '—'} (id=${u.telegram_id}).`);
      return;
    }
    const updated = users.setStatus(tgId, 'approved');
    await bot.sendMessage(msg.chat.id, TEXTS.allowOk(updated));
    // Уведомляем пользователя.
    try {
      await bot.sendMessage(tgId, `✅ Доступ открыт! Открывай трекер: /start`);
    } catch { /* пользователь мог не писать боту */ }
    logger.info({ actorId: msg.from.id, targetId: tgId }, 'admin allow');
    audit.audit({
      actor_id: msg.from.id,
      action: 'allow',
      target_id: tgId,
    });
  });

  // /deny <id> — pending|approved → denied.
  bot.onText(/^\/deny(?:@\w+)?\s+(\S+)/, async (msg, match) => {
    if (!isOwner(msg.from, ownerId, logger)) return;
    const tgId = parseTgId(match[1]);
    if (tgId == null) {
      await bot.sendMessage(msg.chat.id, TEXTS.invalidId(match[1]));
      return;
    }
    const u = users.findByTelegramId(tgId);
    if (!u) {
      await bot.sendMessage(msg.chat.id, TEXTS.notFound(tgId));
      return;
    }
    if (u.status === 'denied') {
      await bot.sendMessage(msg.chat.id, `ℹ️ Уже отклонён(а): @${u.username || '—'} (id=${u.telegram_id}).`);
      return;
    }
    if (u.status === 'banned' || u.deleted_at !== null) {
      await bot.sendMessage(msg.chat.id, TEXTS.badState('deny', 'banned'));
      return;
    }
    const updated = users.setStatus(tgId, 'denied');
    await bot.sendMessage(msg.chat.id, TEXTS.denyOk(updated));
    try {
      await bot.sendMessage(tgId, `❌ Заявка отклонена.`);
    } catch { /* ignore */ }
    logger.info({ actorId: msg.from.id, targetId: tgId }, 'admin deny');
    audit.audit({
      actor_id: msg.from.id,
      action: 'deny',
      target_id: tgId,
    });
  });

  // /revoke <id> — approved → banned (soft delete).
  bot.onText(/^\/revoke(?:@\w+)?\s+(\S+)/, async (msg, match) => {
    if (!isOwner(msg.from, ownerId, logger)) return;
    const tgId = parseTgId(match[1]);
    if (tgId == null) {
      await bot.sendMessage(msg.chat.id, TEXTS.invalidId(match[1]));
      return;
    }
    if (Number(tgId) === Number(ownerId)) {
      await bot.sendMessage(msg.chat.id, '🚫 Нельзя отозвать доступ у owner\'а. Это escape hatch.');
      return;
    }
    const u = users.findByTelegramId(tgId);
    if (!u) {
      await bot.sendMessage(msg.chat.id, TEXTS.notFound(tgId));
      return;
    }
    if (u.status === 'banned' || u.deleted_at !== null) {
      await bot.sendMessage(msg.chat.id, `ℹ️ Уже отозван(а): @${u.username || '—'} (id=${u.telegram_id}).`);
      return;
    }
    const updated = users.softDelete(tgId);
    await bot.sendMessage(msg.chat.id, TEXTS.revokeOk(updated));
    logger.info({ actorId: msg.from.id, targetId: tgId }, 'admin revoke');
    audit.audit({
      actor_id: msg.from.id,
      action: 'revoke',
      target_id: tgId,
    });
  });

  // /unban <id> — banned → approved, deleted_at = NULL.
  bot.onText(/^\/unban(?:@\w+)?\s+(\S+)/, async (msg, match) => {
    if (!isOwner(msg.from, ownerId, logger)) return;
    const tgId = parseTgId(match[1]);
    if (tgId == null) {
      await bot.sendMessage(msg.chat.id, TEXTS.invalidId(match[1]));
      return;
    }
    const u = users.findByTelegramId(tgId);
    if (!u) {
      await bot.sendMessage(msg.chat.id, TEXTS.notFound(tgId));
      return;
    }
    if (u.status !== 'banned' && u.deleted_at === null) {
      await bot.sendMessage(msg.chat.id, `ℹ️ Не забанен(а): @${u.username || '—'} (id=${u.telegram_id}).`);
      return;
    }
    const updated = users.unban(tgId);
    await bot.sendMessage(msg.chat.id, TEXTS.unbanOk(updated));
    logger.info({ actorId: msg.from.id, targetId: tgId }, 'admin unban');
    audit.audit({
      actor_id: msg.from.id,
      action: 'unban',
      target_id: tgId,
    });
  });

  // /list_pending — все pending-заявки.
  bot.onText(/^\/list_pending(?:@\w+)?$/, async (msg) => {
    if (!isOwner(msg.from, ownerId, logger)) return;
    const pending = users.listPending();
    if (pending.length === 0) {
      await bot.sendMessage(msg.chat.id, TEXTS.noPending);
      return;
    }
    const lines = [TEXTS.listHeader(pending.length), ...pending.map(TEXTS.listEntry)];
    await bot.sendMessage(msg.chat.id, lines.join('\n'));
    logger.info({ actorId: msg.from.id, count: pending.length }, 'admin list_pending');
  });

  // /list_users — все (approved, banned, denied).
  bot.onText(/^\/list_users(?:@\w+)?$/, async (msg) => {
    if (!isOwner(msg.from, ownerId, logger)) return;
    const { rows } = users.list({ limit: 200 });
    if (rows.length === 0) {
      await bot.sendMessage(msg.chat.id, 'Нет пользователей.');
      return;
    }
    const lines = [`Пользователей: ${rows.length}\n`];
    for (const u of rows) {
      const flag = u.status === 'banned' ? '🚫' : u.status === 'approved' ? '✅' : u.status === 'pending' ? '⏳' : '❌';
      lines.push(`${flag} @${u.username || '—'} (id=${u.telegram_id}, ${u.status})`);
    }
    await bot.sendMessage(msg.chat.id, lines.join('\n'));
    logger.info({ actorId: msg.from.id, count: rows.length }, 'admin list_users');
  });

  // Любой другой текст — короткая подсказка.
  bot.on('message', async (msg) => {
    const text = msg.text || '';
    if (text.startsWith('/')) return;
    if (msg.chat.type !== 'private') return;
    try {
      await bot.sendMessage(
        msg.chat.id,
        'Я понимаю команды: /start, /history. Для админа: /allow, /deny, /list_pending, /list_users, /revoke, /unban.',
      );
    } catch { /* ignore */ }
  });

  bot.on('polling_error', (err) => {
    logger.warn({ err: { code: err.code, message: err.message } }, 'bot polling error');
  });
}

function isOwner(from, ownerId, logger) {
  if (!ownerId) return false;
  if (!from || Number(from.id) !== Number(ownerId)) {
    if (from && logger) {
      logger.warn({ fromId: from.id, ownerId }, 'non-owner tried admin command');
      // Audit неудачной admin-попытки (actor=from.id, target=null).
      try {
        audit.audit({
          actor_id: from.id,
          action: 'admin_denied',
          target_id: null,
          details: { reason: 'not_owner' },
        });
      } catch { /* ignore */ }
    }
    return false;
  }
  return true;
}

async function sendApprovedGreeting(bot, chatId, from, appBaseUrl) {
  await setMenuButton(bot, chatId, appBaseUrl);
  const opts = {};
  if (appBaseUrl) {
    opts.reply_markup = {
      inline_keyboard: [
        [{ text: TEXTS.startOpenButton, web_app: { url: appBaseUrl } }],
      ],
    };
  }
  await bot.sendMessage(chatId, TEXTS.startWelcome(from.first_name), opts);
}
