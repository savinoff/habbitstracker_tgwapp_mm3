// server/src/bot/handlers.js
// Регистрирует обработчики команд бота.
//
// spec:02-user-stories.md#US-01..US-08
// spec:03-features/reminders.md#q4

import { upsert as upsertUser } from '../repos/users.js';
import { TEXTS } from './texts.js';
import { setMenuButton } from './menu.js';

export function registerHandlers(bot, { appBaseUrl, logger }) {
  // /start — приветствие + upsert пользователя + Menu Button
  // spec:02-user-stories.md#US-01
  bot.onText(/^\/start(?:@\w+)?$/, async (msg) => {
    const chatId = msg.chat.id;
    const from = msg.from || {};

    try {
      upsertUser({
        telegram_id: from.id,
        username: from.username ?? null,
        first_name: from.first_name ?? null,
      });

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
    } catch (err) {
      logger.error({ err, chatId }, 'failed to handle /start');
      try {
        await bot.sendMessage(chatId, TEXTS.genericError);
      } catch { /* swallow */ }
    }
  });

  // /history — сообщение с кнопкой Mini App, открывающей вкладку "История".
  // spec:02-user-stories.md#US-08
  // spec:03-features/history.md#q2 — deep-link #history
  bot.onText(/^\/history(?:@\w+)?$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!appBaseUrl) {
      // В dev без APP_BASE_URL покажем текстом.
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

  // Любой другой текст — короткая подсказка.
  // Не перегружаем пользователя; для MVP этого достаточно.
  bot.on('message', async (msg) => {
    const text = msg.text || '';
    if (text.startsWith('/')) return; // команды обрабатываются onText
    if (msg.chat.type !== 'private') return; // только в личке
    try {
      await bot.sendMessage(
        msg.chat.id,
        'Я понимаю только /start и /history. Нажми кнопку "Открыть трекер" для записи опросов.',
      );
    } catch { /* ignore */ }
  });

  // Ошибки polling.
  bot.on('polling_error', (err) => {
    logger.warn({ err: { code: err.code, message: err.message } }, 'bot polling error');
  });
}
