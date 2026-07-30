// server/src/config.js
// Конфиг загружается из process.env (на проде — из .env на хосте через docker-compose env_file).
// На отсутствие обязательных переменных — падаем сразу на старте, чтобы контейнер не стартовал в невалидном виде.
//
// spec:08-deploy.md#q9 — список переменных
// spec:07-non-functional.md#q3 — секреты только из env

import dotenv from 'dotenv';

dotenv.config();

const required = (name) => {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
};

const optional = (name, fallback) => {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v;
};

const intEnv = (name, fallback) => {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`Env var ${name} must be an integer, got: ${v}`);
  return n;
};

export const config = Object.freeze({
  // spec:08-deploy.md#q9
  telegramBotToken: required('TELEGRAM_BOT_TOKEN'),
  ownerTelegramId: intEnv('OWNER_TELEGRAM_ID'),

  // spec:08-deploy.md#q9
  appBaseUrl: optional('APP_BASE_URL', ''),
  webhookUrl: optional('WEBHOOK_URL', ''),

  // прочее
  port: intEnv('PORT', 3000),
  host: optional('HOST', '0.0.0.0'),
  logLevel: optional('LOG_LEVEL', 'info'),
  databasePath: optional('DATABASE_PATH', '/data/habits.db'),
  staticDir: optional('STATIC_DIR', ''),

  // spec:07-non-functional.md#q3
  initDataMaxAgeSec: intEnv('INITDATA_MAX_AGE_SEC', 300),
});
