// server/src/bot/menu.js
// Управление Menu Button бота: одна кнопка, открывающая Mini App.
//
// spec:02-user-stories.md#US-01 — /start
// spec:02-user-stories.md#US-08 — /history command
// spec:03-features/reminders.md#q4 — кнопка "Открыть трекер"

const MENU_BUTTON_TEXT = 'Открыть трекер';

/**
 * Устанавливает Menu Button для указанного chat_id (если задан APP_BASE_URL).
 * При ошибке логирует и не падает — кнопка настраивается best-effort.
 */
export async function setMenuButton(bot, chatId, appBaseUrl) {
  if (!appBaseUrl) {
    return; // в dev без APP_BASE_URL просто пропускаем
  }
  try {
    await bot.setChatMenuButton(chatId, {
      type: 'web_app',
      text: MENU_BUTTON_TEXT,
      web_app: { url: appBaseUrl },
    });
  } catch (err) {
    // Не критично — если упадёт настройка menu button, юзер всё равно
    // сможет открыть Mini App через inline-кнопку в приветственном сообщении.
    bot.logger?.warn?.({ err: { code: err.code, message: err.message }, chatId }, 'setChatMenuButton failed');
  }
}
