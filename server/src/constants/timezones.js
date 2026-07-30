// server/src/constants/timezones.js
// Фиксированный список IANA TZ для UI (см. 03-features/settings.md#q4).
// Полный список IANA — слишком тяжёлый для mobile UI; 23 штук покрывают 95% случаев.
// spec:03-features/settings.md#q4

export const ALLOWED_TIMEZONES = Object.freeze([
  'UTC',
  'Europe/Moscow',
  'Europe/Kaliningrad',
  'Europe/Samara',
  'Europe/Kiev',
  'Europe/Minsk',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Asia/Yekaterinburg',
  'Asia/Novosibirsk',
  'Asia/Krasnoyarsk',
  'Asia/Irkutsk',
  'Asia/Yakutsk',
  'Asia/Vladivostok',
  'Asia/Magadan',
  'Asia/Kamchatka',
  'Asia/Almaty',
  'Asia/Tashkent',
  'Asia/Tbilisi',
  'Asia/Yerevan',
  'America/New_York',
  'America/Los_Angeles',
]);

export function isAllowedTimezone(tz) {
  return ALLOWED_TIMEZONES.includes(tz);
}
