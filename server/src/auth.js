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
 * Сохраняет порядок параметров как в оригинале (нужен для совместимости,
 * хотя в data_check_string порядок задаётся сортировкой по ключу).
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
 *  - все поля кроме hash
 *  - отсортированы по ключу
 *  - формат: key=value (raw, без url-decode промежуточного)
 *  - объединены \n
 */
export function buildDataCheckString(entries) {
  return entries
    .filter(([k]) => k !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
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
  const dataCheckString = buildDataCheckString(entries);
  const secretKey = createHash('sha256').update(botToken).digest();
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
