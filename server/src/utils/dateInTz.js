// server/src/utils/dateInTz.js
// Утилита: локальная дата (YYYY-MM-DD) в указанном IANA TZ для заданного UTC-момента.
//
// Использует Intl.DateTimeFormat с timeZone и formatToParts, что точно
// учитывает DST и любые смещения. Дешевле, чем luxon/date-fns-tz.
//
// spec:03-features/reminders.md#q3 — расчёт в TZ пользователя
// spec:03-features/history.md#q3..q5 — диапазоны дат
// spec:03-features/settings.md#q3 — TZ пользователя

const FORMATTER_CACHE = new Map();

function formatterFor(tz) {
  let f = FORMATTER_CACHE.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    FORMATTER_CACHE.set(tz, f);
  }
  return f;
}

/**
 * Возвращает YYYY-MM-DD для данного Date в указанной TZ.
 */
export function dateInTz(date, tz) {
  // en-CA даёт формат YYYY-MM-DD естественно.
  return formatterFor(tz).format(date);
}

/**
 * Возвращает { hour, minute, weekday } для данного Date в указанной TZ.
 */
export function partsInTz(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
  const out = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type === 'hour') out.hour = Number(p.value);
    else if (p.type === 'minute') out.minute = Number(p.value);
    else if (p.type === 'weekday') out.weekday = p.value;
  }
  return out;
}

/**
 * Парсит YYYY-MM-DD в Date (UTC midnight), корректно.
 * JS Date.UTC имеет month 0-indexed, поэтому month-1.
 */
export function parseYmdUtc(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Сдвиг YYYY-MM-DD на delta дней (UTC-календарно). delta может быть отрицательным.
 */
export function shiftYmd(ymd, delta) {
  const d = parseYmdUtc(ymd);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Валидирует IANA TZ. Возвращает true, если Node смог создать для неё форматтер.
 */
export function isValidTimezone(tz) {
  if (typeof tz !== 'string' || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
