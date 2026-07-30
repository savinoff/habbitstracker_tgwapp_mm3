// web/src/ui/settings.js
// Экран "Настройки": время напоминаний, часовой пояс, reset.
//
// spec:03-features/settings.md — поля и UX
// spec:05-api.md#q6 — POST /api/settings contract

import { getSettings, updateSettings, resetSettings } from '../api.js';
import { timeField, selectField, escapeHtml, haptic } from './forms.js';
import { ALLOWED_TIMEZONES } from './tz-list.js';

export async function renderSettings(screen) {
  screen.innerHTML = `<div class="screen__placeholder"><p>Загружаю…</p></div>`;
  let current;
  try {
    const res = await getSettings();
    current = res.data;
  } catch (err) {
    screen.innerHTML = `<div class="error">${escapeHtml(err.message || 'Не получилось загрузить настройки')}</div>`;
    return;
  }

  const form = document.createElement('form');
  form.className = 'form';
  form.noValidate = true;
  form.innerHTML = `
    <h2 class="form__title">Настройки</h2>
    <p class="form__date">${current.defaults_applied ? 'Применены настройки по умолчанию' : 'Изменено вручную'}</p>
  `;
  screen.innerHTML = '';
  screen.appendChild(form);

  const morning = timeField(form, 'morning_hour_minute', 'Время утреннего напоминания', { minHour: 4, maxHour: 11 });
  const evening = timeField(form, 'evening_hour_minute', 'Время вечернего напоминания', { minHour: 18, maxHour: 23 });
  const tz = selectField(form, 'timezone', 'Часовой пояс', ALLOWED_TIMEZONES.map((z) => ({ value: z, label: z })));

  morning.setValue(current.morning_hour_minute);
  evening.setValue(current.evening_hour_minute);
  tz.setValue(current.timezone);

  // Кнопка reset.
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn btn--secondary btn--block';
  reset.textContent = 'Сбросить время на дефолтные';
  reset.addEventListener('click', async () => {
    haptic('light');
    try {
      await resetSettings();
      haptic('success');
      renderSettings(screen);
    } catch (err) {
      haptic('error');
      setError(form, err.message || 'Не получилось сбросить');
    }
  });
  form.appendChild(reset);

  // Telegram MainButton для сохранения.
  const tg = window.Telegram?.WebApp;
  if (tg?.MainButton) {
    tg.MainButton.setText('Сохранить настройки');
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
    btn.textContent = 'Сохранить настройки';
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
    const mWin = morning.isInWindow();
    if (!mWin.ok) return setError(`Утреннее время: ${mWin.message}`);
    const eWin = evening.isInWindow();
    if (!eWin.ok) return setError(`Вечернее время: ${eWin.message}`);
    const tzVal = tz.getValue();
    if (!tzVal) return setError('Выбери часовой пояс');

    try {
      await updateSettings({
        morning_hour_minute: morning.getValue(),
        evening_hour_minute: evening.getValue(),
        timezone: tzVal,
      });
      haptic('success');
      renderSettings(screen);
    } catch (err) {
      haptic('error');
      setError(err.message || 'Не получилось сохранить');
    }
  }
}
