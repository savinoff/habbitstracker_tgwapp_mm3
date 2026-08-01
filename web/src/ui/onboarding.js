// web/src/ui/onboarding.js
// Экран онбординга: приветствие + обязательный выбор TZ.
//
// spec:09-multi-user.md#q8 — онбординг (обязательный выбор TZ)
//
// Показывается только при первом входе (user.onboarded === false).
// После выбора TZ — блокирующая кнопка "Продолжить" вызывает POST
// /api/users/me/settings, бэкенд выставляет onboarded_at.
//
// spec:09-multi-user.md#q8 — onboarding (обязательный выбор TZ)
// spec:05-api.md#q12 — POST /api/users/me/settings

import { updateMySettings } from '../api.js';

const TIMEZONES = [
  ['Europe/Moscow', 'Москва (UTC+3)'],
  ['Europe/Kaliningrad', 'Калининград (UTC+2)'],
  ['Europe/Samara', 'Самара (UTC+4)'],
  ['Europe/Kiev', 'Киев (UTC+2/+3)'],
  ['Europe/Minsk', 'Минск (UTC+3)'],
  ['Europe/London', 'Лондон (UTC+0/+1)'],
  ['Europe/Berlin', 'Берлин (UTC+1/+2)'],
  ['Europe/Paris', 'Париж (UTC+1/+2)'],
  ['Asia/Yekaterinburg', 'Екатеринбург (UTC+5)'],
  ['Asia/Novosibirsk', 'Новосибирск (UTC+7)'],
  ['Asia/Krasnoyarsk', 'Красноярск (UTC+7)'],
  ['Asia/Irkutsk', 'Иркутск (UTC+8)'],
  ['Asia/Yakutsk', 'Якутск (UTC+9)'],
  ['Asia/Vladivostok', 'Владивосток (UTC+10)'],
  ['Asia/Magadan', 'Магадан (UTC+11)'],
  ['Asia/Kamchatka', 'Камчатка (UTC+12)'],
  ['Asia/Almaty', 'Алматы (UTC+6)'],
  ['Asia/Tashkent', 'Ташкент (UTC+5)'],
  ['Asia/Tbilisi', 'Тбилиси (UTC+4)'],
  ['Asia/Yerevan', 'Ереван (UTC+4)'],
  ['America/New_York', 'Нью-Йорк (UTC-5/-4)'],
  ['America/Los_Angeles', 'Лос-Анджелес (UTC-8/-7)'],
  ['UTC', 'UTC (UTC+0)'],
];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Рендерит онбординг. После успешного выбора TZ вызывает onComplete().
 *
 * @param {HTMLElement} root
 * @param {object} user — /api/users/me response (data)
 * @param {() => void} onComplete — callback после успешного сохранения
 */
export function renderOnboarding(root, user, onComplete) {
  const firstName = user?.first_name || 'друг';
  let selected = null;
  let saving = false;

  function render() {
    root.innerHTML = `
      <div class="onboarding">
        <h2>Привет, ${escapeHtml(firstName)}! 👋</h2>
        <p>Это <b>HabitsTracker</b> — твой дневник привычек. Каждое утро и вечер — короткий опрос (30 секунд). Чтобы напоминания приходили вовремя, выбери свой часовой пояс.</p>
        <p class="muted">Шаг 1 из 1: часовой пояс</p>
        <div class="tz-list" role="radiogroup" aria-label="Часовой пояс">
          ${TIMEZONES.map(([tz, label]) => `
            <label class="tz-row" data-tz="${escapeHtml(tz)}">
              <input type="radio" name="tz" value="${escapeHtml(tz)}" ${selected === tz ? 'checked' : ''}>
              <span>${escapeHtml(label)}</span>
            </label>
          `).join('')}
        </div>
        <button id="onb-continue" class="primary" ${selected ? '' : 'disabled'}>
          ${saving ? 'Сохраняю…' : 'Продолжить →'}
        </button>
      </div>
    `;

    root.querySelectorAll('.tz-row').forEach((row) => {
      row.addEventListener('click', (ev) => {
        ev.preventDefault();
        const tz = row.getAttribute('data-tz');
        selected = tz;
        render();
      });
    });

    const btn = root.querySelector('#onb-continue');
    if (btn && selected && !saving) {
      btn.addEventListener('click', async () => {
        saving = true;
        render();
        try {
          await updateMySettings({ tz: selected });
          if (onComplete) onComplete();
        } catch (err) {
          saving = false;
          render();
          const msg = err?.code ? `Ошибка: ${err.code} — ${err.message}` : `Ошибка: ${err.message}`;
          const errEl = document.createElement('div');
          errEl.className = 'error';
          errEl.textContent = msg;
          root.querySelector('.onboarding').appendChild(errEl);
        }
      });
    }
  }

  render();
}
