// web/src/ui/tz-list.js
// Список IANA TZ, отображаемых в <select>. Должен совпадать с
// server/src/constants/timezones.js (ALLOWED_TIMEZONES).
//
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
