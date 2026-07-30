// web/src/ui/home.js
// Главный экран: логика выбора формы по текущему времени и наличию записей.
//
// spec:06-ui-states.md#q2 — логика отображения
//   - В утреннем окне (04:00–12:00) без записи → пустая утренняя форма
//   - В утреннем окне с записью → превью + Edit
//   - В вечернем окне (18:00–23:59) без записи → пустая вечерняя форма
//   - В вечернем окне с записью → превью + Edit
//   - Вне обоих окон → последняя запись + ссылка на историю

import { getHistory, getSettings } from '../api.js';
import { renderMorningForm } from './morningForm.js';
import { renderEveningForm } from './eveningForm.js';
import { escapeHtml, haptic } from './forms.js';

const TZ_FALLBACK = 'UTC';

function localToday(tz) {
  // Используем Intl.DateTimeFormat как в server-side — node и браузер поддерживают одинаково.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function currentHour(tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: '2-digit' }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === 'hour')?.value || 0);
}

function inMorningWindow(hour) { return hour >= 4 && hour < 12; }
function inEveningWindow(hour) { return hour >= 18 && hour < 24; }

export async function renderHome(screen) {
  screen.innerHTML = `<div class="screen__placeholder"><p>Загружаю…</p></div>`;
  let tz = TZ_FALLBACK;
  let today;
  let history;
  try {
    const settings = await getSettings();
    if (settings?.data?.timezone) tz = settings.data.timezone;
  } catch { /* нет настроек — ок, дефолт */ }
  try {
    const hist = await getHistory(7);
    history = hist.data.days;
  } catch (err) {
    return renderError(screen, err);
  }
  today = localToday(tz);
  const todayEntry = history.find((d) => d.date === today) || { morning: null, evening: null };
  const hour = currentHour(tz);

  // Сценарий 1: утро.
  if (inMorningWindow(hour)) {
    if (todayEntry.morning) {
      renderMorningPreview(screen, todayEntry.morning, today);
    } else {
      renderMorningForm(screen, { localDate: today, existing: null, onSaved: () => renderHome(screen) });
    }
    return;
  }

  // Сценарий 2: вечер.
  if (inEveningWindow(hour)) {
    if (todayEntry.evening) {
      renderEveningPreview(screen, todayEntry.evening, today);
    } else {
      renderEveningForm(screen, { localDate: today, existing: null, onSaved: () => renderHome(screen) });
    }
    return;
  }

  // Сценарий 3: вне обоих окон — последняя запись + ссылка на историю.
  const lastWithData = [...history].reverse().find((d) => d.morning || d.evening);
  renderIdle(screen, lastWithData, today);
}

function renderError(screen, err) {
  screen.innerHTML = `
    <div class="screen__placeholder">
      <h2>Ошибка</h2>
      <p>${escapeHtml(err?.message || 'Не получилось загрузить данные')}</p>
    </div>
  `;
}

function renderMorningPreview(screen, record, date) {
  const note = record.intention ? `<p class="preview__note">«${escapeHtml(record.intention)}»</p>` : '';
  screen.innerHTML = `
    <section class="preview">
      <h2 class="preview__title">Сегодня утром ☀️</h2>
      <p class="preview__date">${escapeHtml(date)}</p>
      <div class="preview__grid">
        <div class="preview__cell"><span class="preview__num">${formatNum(record.sleep_hours)}</span><span class="preview__label">часов сна</span></div>
        <div class="preview__cell"><span class="preview__num">${record.sleep_quality}/5</span><span class="preview__label">качество</span></div>
        <div class="preview__cell"><span class="preview__num">${record.mood_morning}/5</span><span class="preview__label">настрой</span></div>
      </div>
      ${note}
      <button type="button" class="btn btn--secondary btn--block" id="edit-morning">Изменить</button>
    </section>
  `;
  document.getElementById('edit-morning').addEventListener('click', () => {
    haptic('light');
    renderMorningForm(screen, {
      localDate: date,
      existing: record,
      onSaved: () => renderHome(screen),
    });
  });
}

function renderEveningPreview(screen, record, date) {
  const best = record.best_memory ? `<p class="preview__note">«${escapeHtml(record.best_memory)}»</p>` : '';
  screen.innerHTML = `
    <section class="preview">
      <h2 class="preview__title">Сегодня вечером 🌙</h2>
      <p class="preview__date">${escapeHtml(date)}</p>
      <div class="preview__grid">
        <div class="preview__cell"><span class="preview__num">${record.smoked_count}</span><span class="preview__label">курил</span></div>
        <div class="preview__cell"><span class="preview__num">${escapeHtml(sugarLabel(record.ate_sugar))}</span><span class="preview__label">сладкое</span></div>
        <div class="preview__cell"><span class="preview__num">${record.did_sport ? 'да' : 'нет'}</span><span class="preview__label">спорт</span></div>
        <div class="preview__cell"><span class="preview__num">${record.mood_evening}/5</span><span class="preview__label">состояние</span></div>
      </div>
      ${best}
      <button type="button" class="btn btn--secondary btn--block" id="edit-evening">Изменить</button>
    </section>
  `;
  document.getElementById('edit-evening').addEventListener('click', () => {
    haptic('light');
    renderEveningForm(screen, {
      localDate: date,
      existing: record,
      onSaved: () => renderHome(screen),
    });
  });
}

function renderIdle(screen, lastEntry, today) {
  if (!lastEntry) {
    screen.innerHTML = `
      <div class="screen__placeholder">
        <h2>Здесь будет твой день</h2>
        <p>Заполни первый опрос, и он появится здесь.</p>
      </div>
    `;
    return;
  }
  screen.innerHTML = `
    <div class="screen__placeholder">
      <h2>Сейчас не время для опроса</h2>
      <p>Следующее окно: утро 04:00–12:00 или вечер 18:00–24:00 (в твоём часовом поясе).</p>
      <p><a href="#history" class="link">Посмотреть историю →</a></p>
    </div>
  `;
}

function sugarLabel(v) {
  return v === 'yes' ? 'да' : v === 'no' ? 'нет' : 'не помню';
}

function formatNum(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
