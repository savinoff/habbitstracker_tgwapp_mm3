// server/src/bot/texts.js
// Тексты, которые бот отправляет пользователю. Вынесены отдельно, чтобы
// при изменении формулировок не лезть в обработчики.
//
// spec:03-features/reminders.md#q4 — тексты напоминаний
// spec:02-user-stories.md#US-01 — /start
// spec:02-user-stories.md#US-08 — /history
// spec:09-multi-user.md#q3 — admin-команды (v0.4.0+)

export const TEXTS = Object.freeze({
  startWelcome: (firstName) =>
    `Привет${firstName ? `, ${firstName}` : ''}! 👋\n` +
    `Я — HabitsTracker, твой дневник привычек. Буду присылать два напоминания в день — утром и вечером.\n\n` +
    `Нажми кнопку ниже, чтобы открыть приложение 👇`,

  startOpenButton: '🚀 Открыть трекер',

  historyReply: 'Открываю историю 👇',

  reminderMorning: 'Доброе утро ☀️ Пора записать, как спал. Нажми кнопку ниже 👇',
  reminderEvening: 'Привет 🌙 Как прошёл день? Запиши вечерний отчёт.',
  reminderFollowup: 'Не забудь про вечерний отчёт 🙂',

  genericError: 'Что-то пошло не так. Попробуй позже.',

  // v0.4.0+ — admin commands. spec:09-multi-user.md#q3

  // /start для разных статусов.
  startPending: (firstName) =>
    `Привет${firstName ? `, ${firstName}` : ''}! 👋\n` +
    `Заявка на доступ отправлена админу. Я напишу, когда одобрят.`,
  startApproved: 'Доступ уже открыт. Открывай 👇',
  startBanned: 'Доступ закрыт. Напиши @DimSav для уточнения.',
  startDenied: 'Заявка была отклонена. Попробуй позже.',

  // Уведомление админу о новой заявке.
  adminNewRequest: (u) =>
    `🆕 Новая заявка на доступ\n` +
    `👤 ${[u.first_name, u.last_name].filter(Boolean).join(' ') || '(без имени)'} ` +
    `(@${u.username || '—'}, id=${u.telegram_id})\n` +
    `📅 ${new Date(u.created_at * 1000).toLocaleString('ru-RU', { timeZone: u.timezone || 'UTC' })}\n` +
    `🌐 ${u.language_code || '—'}` +
    (u.is_premium ? ' • premium' : '') +
    (u.was_before ? ' • раньше был' : ' • новый') +
    `\n\n✅ /allow ${u.telegram_id}   ❌ /deny ${u.telegram_id}`,

  // Уведомление админу о повторном /start уже одобренного.
  adminRestart: (u) =>
    `ℹ️ ${[u.first_name, u.last_name].filter(Boolean).join(' ') || '(без имени)'} ` +
    `(@${u.username || '—'}, id=${u.telegram_id}) перезапустил бота.`,

  // /allow, /deny, /revoke, /unban — результаты.
  allowOk: (u) => `✅ Одобрен(а): @${u.username || '—'} (id=${u.telegram_id}). Открывай!`,
  denyOk: (u) => `❌ Отклонён(а): @${u.username || '—'} (id=${u.telegram_id}).`,
  revokeOk: (u) => `🚫 Отозван доступ: @${u.username || '—'} (id=${u.telegram_id}).`,
  unbanOk: (u) => `♻️ Восстановлен доступ: @${u.username || '—'} (id=${u.telegram_id}).`,

  // Ошибки команд.
  notFound: (id) => `Заявки/юзера с id=${id} не найдено.`,
  badState: (action, status) => `Невозможно: текущий статус='${status}' для ${action}.`,
  invalidId: (s) => `Некорректный id: '${s}'. Ожидается целое число.`,

  // /list_pending и /list_users.
  noPending: 'Нет нерассмотренных заявок. ✅',
  listHeader: (n) => `Заявок: ${n}\n`,
  listEntry: (u) =>
    `• ${[u.first_name, u.last_name].filter(Boolean).join(' ') || '(без имени)'} ` +
    `(@${u.username || '—'}, id=${u.telegram_id}, ` +
    `${new Date(u.created_at * 1000).toISOString().slice(0, 10)})` +
    (u.language_code ? ` [${u.language_code}]` : '') +
    (u.is_premium ? ' ★' : ''),

  // Daily owner reminder.
  dailyReminderHeader: (n) => `📬 У тебя ${n} нерассмотренных заявок. /list_pending для просмотра.`,
});

