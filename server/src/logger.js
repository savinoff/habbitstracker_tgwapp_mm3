// server/src/logger.js
// Pino с JSON-выводом в stdout. Re-секреты на верхнем уровне —
// чтобы случайно залогированный объект не утёк токеном.
//
// spec:07-non-functional.md#q4 — формат pino JSON, в stdout
// spec:07-non-functional.md#q3 — не логируем initData целиком

import { pino } from 'pino';
import { config } from './config.js';

const redactPaths = [
  'req.headers["x-telegram-init-data"]',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.TELEGRAM_BOT_TOKEN',
  'TELEGRAM_BOT_TOKEN',
  'telegramBotToken',
  '*.telegramBotToken',
  'password',
  '*.password',
  'token',
  '*.token',
];

export const logger = pino({
  level: config.logLevel,
  redact: { paths: redactPaths, censor: '[redacted]' },
  base: { service: 'habitstracker-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
});
