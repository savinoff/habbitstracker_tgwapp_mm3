// server/src/auth.js
// Pure validation of Telegram Mini App initData.
// No side effects, no logging of the raw payload (security).
//
// spec:05-api.md#q9 — алгоритм валидации
// spec:07-non-functional.md#q3 — TTL 5 min, whitelist, no logging of initData

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const MAX_USER_OBJ_BYTES = 4096;

/**
 * Парсит initData (query-string) в массив пар [key, value].
 * Значения возвращаются **декодированными** (URL-decoded) — для удобства
 * дальнейшей работы с `user` (JSON.parse) и проверки наличия полей.
 * Для data_check_string этого недостаточно: там нужна **raw** форма, см. buildDataCheckString.
 */
export function parseInitData(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new ValidationError('initData is empty', 'EMPTY');
  }
  // URLSearchParams умеет в повторяющиеся ключи и декодирование.
  const params = new URLSearchParams(raw);
  const out = [];
  for (const [k, v] of params) {
    out.push([k, v]);
  }
  if (out.length === 0) {
    throw new ValidationError('initData has no params', 'EMPTY');
  }
  return out;
}

/**
 * Собирает data_check_string по алгоритму Telegram:
 *  - все поля кроме hash и signature
 *  - отсортированы по ключу
 *  - формат: key=value в **raw** URL-encoded форме
 *  - объединены \n
 *
 * Принимает **исходную строку** initData, а не распарсенные entries.
 * Это критично: если пары пересобрать через URLSearchParams + key=value,
 * Telegram декодирует значения (например `https%3A%5C%2F` → `https:\/`)
 * и хеш перестаёт совпадать с присланным.
 *
 * spec:07-non-functional.md#q3 — оба поля (hash и signature) исключены.
 *   `hash` — это сама подпись, мы её проверяем отдельно.
 *   `signature` — клиентская подпись для Bot API, в HMAC не участвует.
 */
export function buildDataCheckString(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new ValidationError('initData is empty', 'EMPTY');
  }
  return raw
    .split('&')
    .filter((pair) => {
      const eq = pair.indexOf('=');
      const key = eq === -1 ? pair : pair.slice(0, eq);
      return key !== 'hash' && key !== 'signature';
    })
    .sort()
    .join('\n');
}

/**
 * Сравнение строк в constant time.
 * Чтобы избежать утечки по длине, длина хеша Telegram всегда 64 hex,
 * и мы режем до min длины после проверки равенства.
 */
function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Главная функция. Возвращает { user, auth_date } или бросает ValidationError.
 *
 * @param {string} raw        — значение заголовка X-Telegram-Init-Data
 * @param {string} botToken
 * @param {object} [opts]
 * @param {number} [opts.maxAgeSec=300]
 * @param {number} [opts.ownerTelegramId] — если задан, проверяет whitelist
 * @param {number} [opts.nowSec=Math.floor(Date.now()/1000)]
 */
export function validateInitData(raw, botToken, opts = {}) {
  const { maxAgeSec = 300, ownerTelegramId, nowSec = Math.floor(Date.now() / 1000) } = opts;

  if (!botToken) throw new ValidationError('botToken not configured', 'NO_BOT_TOKEN');

  const entries = parseInitData(raw);

  const map = Object.fromEntries(entries);
  const { hash, auth_date, user } = map;

  if (!hash) throw new ValidationError('hash missing', 'NO_HASH');
  if (!auth_date) throw new ValidationError('auth_date missing', 'NO_AUTH_DATE');
  if (!user) throw new ValidationError('user missing', 'NO_USER');

  // 1. Подпись.
  // buildDataCheckString получает raw строку чтобы сохранить URL-encoded форму полей.
  const dataCheckString = buildDataCheckString(raw);
  // spec:05-api.md#q9, https://core.telegram.org/bots/webapps#validating-data
  // secret_key = HMAC-SHA256(key="WebAppData", msg=bot_token) — не sha256(bot_token)!
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (!safeEqualHex(computed, hash)) {
    throw new ValidationError('signature mismatch', 'BAD_SIGNATURE');
  }

  // 2. TTL.
  const authSec = Number.parseInt(auth_date, 10);
  if (!Number.isFinite(authSec)) {
    throw new ValidationError('auth_date not a number', 'BAD_AUTH_DATE');
  }
  if (Math.abs(nowSec - authSec) > maxAgeSec) {
    throw new ValidationError('initData expired', 'EXPIRED');
  }

  // 3. user.
  let parsedUser;
  try {
    parsedUser = JSON.parse(user);
  } catch {
    throw new ValidationError('user not JSON', 'BAD_USER');
  }
  if (typeof parsedUser !== 'object' || parsedUser === null) {
    throw new ValidationError('user must be an object', 'BAD_USER');
  }
  if (JSON.stringify(parsedUser).length > MAX_USER_OBJ_BYTES) {
    throw new ValidationError('user too large', 'USER_TOO_LARGE');
  }
  if (typeof parsedUser.id !== 'number' && typeof parsedUser.id !== 'string') {
    throw new ValidationError('user.id missing', 'NO_USER_ID');
  }
  const userId = Number(parsedUser.id);
  if (!Number.isFinite(userId)) {
    throw new ValidationError('user.id not a number', 'BAD_USER_ID');
  }

  // 4. Whitelist.
  if (ownerTelegramId !== undefined && ownerTelegramId !== null) {
    if (Number(ownerTelegramId) !== userId) {
      throw new ValidationError('user not in whitelist', 'NOT_OWNER');
    }
  }

  return { user: { ...parsedUser, id: userId }, auth_date: authSec };
}

export class ValidationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.statusCode = 401;
  }
}
