// server/src/bot.js
// Telegram-бот: long polling, обработчики /start и /history.
//
// spec:02-user-stories.md#US-01, US-08
// spec:03-features/reminders.md#q4 — тексты напоминаний (см. bot/texts.js)
// spec:00-vision.md#q8 — node-telegram-bot-api
// spec:08-deploy.md#q9 — TELEGRAM_BOT_TOKEN, APP_BASE_URL

import TelegramBot from 'node-telegram-bot-api';
import { config } from './config.js';
import { logger } from './logger.js';
import { registerHandlers } from './bot/handlers.js';

let _bot = null;

export function startBot() {
  if (_bot) return _bot;

  const opts = {
    // spec:07-non-functional.md#q3 — secret redaction в логах.
    // node-telegram-bot-api использует встроенный логгер; заменим на тихий,
    // чтобы не засорять pino-логи. Свои ошибки мы логируем сами.
  };

  _bot = new TelegramBot(config.telegramBotToken, { polling: true });

  registerHandlers(_bot, { appBaseUrl: config.appBaseUrl, logger });

  // spec:08-deploy.md#q4 — фиксируем запуск планировщика.
  logger.info(
    { username: '@' + (_bot.options.username || 'unknown') },
    'telegram bot started (long polling)',
  );

  return _bot;
}

export function stopBot() {
  if (!_bot) return;
  try {
    _bot.stopPolling();
  } catch (err) {
    logger.warn({ err }, 'error stopping bot polling');
  }
  _bot = null;
}
