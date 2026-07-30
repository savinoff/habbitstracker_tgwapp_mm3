// server/src/bot/texts.js
// Тексты, которые бот отправляет пользователю. Вынесены отдельно, чтобы
// при изменении формулировок не лезть в обработчики.
//
// spec:03-features/reminders.md#q4 — тексты напоминаний
// spec:02-user-stories.md#US-01 — /start
// spec:02-user-stories.md#US-08 — /history

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
});
