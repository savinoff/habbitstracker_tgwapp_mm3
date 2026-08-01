// web/src/ui/forbidden.js
// Экраны для 403-ответов: pending, denied, banned, not_registered.
//
// spec:09-multi-user.md#q9 — web 403-экраны
//
// spec:09-multi-user.md#q9 — web 403-экраны

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function openBot() {
  // spec:09-multi-user.md#q9 — кнопка «Написать боту» через tg.openTelegramLink.
  const tg = window.Telegram?.WebApp;
  const url = 'https://t.me/xdvsHTBot';
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(url);
  } else {
    window.open(url, '_blank');
  }
}

/**
 * Рисует экран 403.
 *
 * @param {HTMLElement} root
 * @param {object} opts
 *   - code: 'NOT_REGISTERED' | 'NOT_APPROVED' | 'BANNED'
 *   - status: 'pending' | 'denied' | 'banned' (только для BANNED)
 *   - user?: object — для случая когда есть, но не в нужном статусе
 */
export function renderForbidden(root, opts) {
  let title;
  let message;
  let showBotButton = true;
  let showHomeButton = false;

  switch (opts.code) {
    case 'NOT_REGISTERED':
      title = 'Нужно /start боту';
      message = 'Чтобы получить доступ, открой бота @xdvsHTBot и нажми /start. После этого админ одобрит заявку.';
      showBotButton = true;
      break;
    case 'NOT_APPROVED':
      title = 'Заявка на рассмотрении';
      message = 'Админ получил твою заявку и скоро её рассмотрит. Я напишу в бот, когда доступ будет открыт.';
      showBotButton = true;
      break;
    case 'BANNED':
      if (opts.status === 'denied') {
        title = 'Заявка отклонена';
        message = 'К сожалению, твоя заявка была отклонена. Ты можешь попробовать ещё раз — напиши /start боту.';
      } else if (opts.status === 'banned') {
        title = 'Доступ закрыт';
        message = 'Твой доступ был отозван. Свяжись с @DimSav для уточнения.';
      } else {
        title = 'Доступ запрещён';
        message = opts.message || 'Нет доступа к приложению.';
      }
      break;
    default:
      title = 'Ошибка доступа';
      message = opts.message || 'Что-то пошло не так.';
  }

  const html = `
    <div class="forbidden">
      <div class="forbidden-icon">🔒</div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      <div class="forbidden-actions">
        ${showBotButton ? '<button id="fbb-bot" class="primary">Написать боту</button>' : ''}
      </div>
    </div>
  `;
  root.innerHTML = html;

  const botBtn = root.querySelector('#fbb-bot');
  if (botBtn) botBtn.addEventListener('click', openBot);
}
