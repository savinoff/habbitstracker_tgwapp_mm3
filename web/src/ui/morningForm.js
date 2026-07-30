// web/src/ui/morningForm.js
// Утренний опрос: 4 поля.
// spec:03-features/survey-morning.md#q2 — поля формы

import { emojiRow, slider, textarea, haptic, escapeHtml } from './forms.js';
import { saveMorningSurvey } from '../api.js';

const QUALITY_EMOJIS = [
  { value: 1, emoji: '😴', label: 'Очень плохо' },
  { value: 2, emoji: '😕', label: 'Плохо' },
  { value: 3, emoji: '😐', label: 'Нормально' },
  { value: 4, emoji: '🙂', label: 'Хорошо' },
  { value: 5, emoji: '😊', label: 'Отлично' },
];

const MOOD_EMOJIS = [
  { value: 1, emoji: '😞', label: 'Тяжело' },
  { value: 2, emoji: '😕', label: 'Так себе' },
  { value: 3, emoji: '😐', label: 'Нормально' },
  { value: 4, emoji: '🙂', label: 'Хорошо' },
  { value: 5, emoji: '😄', label: 'Отлично' },
];

/**
 * @param {HTMLElement} screen
 * @param {object} args
 * @param {string} args.localDate YYYY-MM-DD
 * @param {object|null} args.existing — текущая запись (или null для новой)
 * @param {() => void} args.onSaved
 * @param {() => void} args.onEdit
 */
export function renderMorningForm(screen, { localDate, existing, onSaved, onEdit }) {
  screen.innerHTML = `
    <form class="form" id="morning-form" novalidate>
      <h2 class="form__title">Утренний опрос</h2>
      <p class="form__date">${escapeHtml(formatHumanDate(localDate))}</p>
    </form>
  `;
  const form = screen.querySelector('#morning-form');

  const sleep = slider(form, 'sleep_hours', 'Сколько часов спал?', { min: 0, max: 14, step: 0.5, unit: 'ч' });
  const quality = emojiRow(form, 'sleep_quality', 'Качество сна', QUALITY_EMOJIS);
  const mood = emojiRow(form, 'mood_morning', 'Настрой с утра', MOOD_EMOJIS);
  const intention = textarea(form, 'intention', 'Намерение на день (опционально)', { maxLen: 200, placeholder: 'Что хочешь сделать сегодня?', rows: 2 });

  // Заполняем существующими значениями.
  if (existing) {
    sleep.setValue(existing.sleep_hours);
    quality.setValue(existing.sleep_quality);
    mood.setValue(existing.mood_morning);
    intention.setValue(existing.intention || '');
  } else {
    // Дефолты для новой формы.
    sleep.setValue(7.5);
    quality.setValue(3);
    mood.setValue(3);
  }

  // Кнопка "Сохранить" — Telegram MainButton.
  const tg = window.Telegram?.WebApp;
  if (tg?.MainButton) {
    tg.MainButton.setText(existing ? 'Сохранить изменения' : 'Сохранить утро');
    tg.MainButton.show();
    const handler = () => submit();
    tg.MainButton.onClick(handler);
    // Возврат: tg.BackButton закрывает Mini App.
    if (tg.BackButton) {
      tg.BackButton.show();
      tg.BackButton.onClick(() => tg.close());
    }
    // Cleanup: при уходе с экрана.
    const cleanup = () => {
      try { tg.MainButton.offClick(handler); } catch { /* ignore */ }
      tg.MainButton.hide();
      if (tg.BackButton) { tg.BackButton.hide(); tg.BackButton.offClick(() => tg.close()); }
    };
    window.addEventListener('hashchange', cleanup, { once: true });
  } else {
    // Fallback: обычная кнопка.
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--block';
    btn.textContent = existing ? 'Сохранить изменения' : 'Сохранить утро';
    btn.addEventListener('click', submit);
    form.appendChild(btn);
  }

  function setError(message) {
    let errEl = form.querySelector('.form__error');
    if (!errEl) {
      errEl = document.createElement('div');
      errEl.className = 'form__error error';
      form.appendChild(errEl);
    }
    errEl.textContent = message;
  }

  function clearError() {
    const errEl = form.querySelector('.form__error');
    if (errEl) errEl.remove();
  }

  async function submit() {
    clearError();
    const payload = {
      date: localDate,
      sleep_hours: sleep.getValue(),
      sleep_quality: quality.getValue(),
      mood_morning: mood.getValue(),
      intention: intention.getValue(),
    };
    if (payload.sleep_quality === null) return setError('Выбери качество сна');
    if (payload.mood_morning === null) return setError('Выбери настрой с утра');

    try {
      await saveMorningSurvey(payload);
      haptic('success');
      onSaved?.();
    } catch (err) {
      haptic('error');
      setError(err.message || 'Не получилось сохранить');
    }
  }
}

function formatHumanDate(ymd) {
  // ymd = YYYY-MM-DD. Превратим в "30 июля".
  const [y, m, d] = ymd.split('-').map(Number);
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  return `${d} ${months[m - 1]}`;
}
