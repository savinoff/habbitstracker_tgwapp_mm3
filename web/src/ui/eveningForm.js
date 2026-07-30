// web/src/ui/eveningForm.js
// Вечерний опрос: 6 полей.
// spec:03-features/survey-evening.md#q2 — поля формы

import { stepper, chipRow, emojiRow, textarea, haptic, escapeHtml } from './forms.js';
import { saveEveningSurvey } from '../api.js';

const SUGAR_CHIPS = [
  { value: 'yes', label: 'Да' },
  { value: 'no', label: 'Нет' },
  { value: 'unsure', label: 'Не помню' },
];

const SPORT_CHIPS = [
  { value: 'true', label: 'Да' },
  { value: 'false', label: 'Нет' },
];

const MOOD_EMOJIS = [
  { value: 1, emoji: '😞', label: 'Тяжело' },
  { value: 2, emoji: '😕', label: 'Так себе' },
  { value: 3, emoji: '😐', label: 'Нормально' },
  { value: 4, emoji: '🙂', label: 'Хорошо' },
  { value: 5, emoji: '😄', label: 'Отлично' },
];

export function renderEveningForm(screen, { localDate, existing, onSaved }) {
  screen.innerHTML = `
    <form class="form" id="evening-form" novalidate>
      <h2 class="form__title">Вечерний опрос</h2>
      <p class="form__date">${escapeHtml(formatHumanDate(localDate))}</p>
    </form>
  `;
  const form = screen.querySelector('#evening-form');

  const smoked = stepper(form, 'smoked_count', 'Сколько раз курил сегодня?', { min: 0, max: 50, step: 1, unit: 'раз' });
  const sugar = chipRow(form, 'ate_sugar', 'Ел сладкое?', SUGAR_CHIPS);
  const sport = chipRow(form, 'did_sport', 'Занимался спортом?', SPORT_CHIPS);
  const sportNote = textarea(form, 'sport_note', 'Что и сколько минут? (опционально)', { maxLen: 100, placeholder: 'Например, бег 30 мин', rows: 2 });
  const mood = emojiRow(form, 'mood_evening', 'Общее состояние за день', MOOD_EMOJIS);
  const best = textarea(form, 'best_memory', 'Лучшее воспоминание за день (опционально)', { maxLen: 300, placeholder: 'Что хорошего сегодня было?', rows: 3 });

  // Условное скрытие sport_note.
  function syncSportNote() {
    const v = sport.getValue();
    if (v === 'true') sportNote.el.classList.remove('hidden');
    else { sportNote.el.classList.add('hidden'); sportNote.setValue(null); }
  }
  sport.el.addEventListener('click', () => setTimeout(syncSportNote, 0));
  syncSportNote();

  if (existing) {
    smoked.setValue(existing.smoked_count);
    sugar.setValue(existing.ate_sugar);
    sport.setValue(String(existing.did_sport));
    sportNote.setValue(existing.sport_note || '');
    mood.setValue(existing.mood_evening);
    best.setValue(existing.best_memory || '');
    syncSportNote();
  } else {
    smoked.setValue(0);
    mood.setValue(3);
  }

  // Telegram MainButton.
  const tg = window.Telegram?.WebApp;
  if (tg?.MainButton) {
    tg.MainButton.setText(existing ? 'Сохранить изменения' : 'Сохранить вечер');
    tg.MainButton.show();
    const handler = () => submit();
    tg.MainButton.onClick(handler);
    if (tg.BackButton) {
      tg.BackButton.show();
      tg.BackButton.onClick(() => tg.close());
    }
    const cleanup = () => {
      try { tg.MainButton.offClick(handler); } catch { /* ignore */ }
      tg.MainButton.hide();
      if (tg.BackButton) { tg.BackButton.hide(); tg.BackButton.offClick(() => tg.close()); }
    };
    window.addEventListener('hashchange', cleanup, { once: true });
  } else {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--block';
    btn.textContent = existing ? 'Сохранить изменения' : 'Сохранить вечер';
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
    const sugarVal = sugar.getValue();
    const sportVal = sport.getValue();
    const moodVal = mood.getValue();
    if (!sugarVal) return setError('Ответь про сладкое');
    if (!sportVal) return setError('Ответь про спорт');
    if (moodVal === null) return setError('Выбери состояние');

    const payload = {
      date: localDate,
      smoked_count: smoked.getValue(),
      ate_sugar: sugarVal,
      did_sport: sportVal === 'true',
      sport_note: sportVal === 'true' ? sportNote.getValue() : null,
      mood_evening: moodVal,
      best_memory: best.getValue(),
    };
    try {
      await saveEveningSurvey(payload);
      haptic('success');
      onSaved?.();
    } catch (err) {
      haptic('error');
      setError(err.message || 'Не получилось сохранить');
    }
  }
}

function formatHumanDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  return `${d} ${months[m - 1]}`;
}
