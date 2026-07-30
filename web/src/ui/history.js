// web/src/ui/history.js
// Экран "История": сегмент-контрол 7/30/Всё + карточки дней с раскрытием.
//
// spec:05-api.md#q5 — days array, включая пустые
// spec:03-features/history.md — UX

import { getHistory } from '../api.js';
import { segmentControl, escapeHtml, haptic } from './forms.js';

const PERIODS = [
  { value: 7, label: '7 дней' },
  { value: 30, label: '30 дней' },
  { value: -1, label: 'Всё' },
];

let _currentPeriod = 7;

export async function renderHistory(screen) {
  screen.innerHTML = `<div class="screen__placeholder"><p>Загружаю…</p></div>`;
  const controls = document.createElement('div');
  controls.className = 'screen__controls';
  screen.innerHTML = '';
  screen.appendChild(controls);

  let data;
  try {
    const res = await getHistory(_currentPeriod);
    data = res.data.days;
  } catch (err) {
    screen.innerHTML = `<div class="error">${escapeHtml(err.message || 'Не получилось загрузить')}</div>`;
    return;
  }

  // Повторно вставляем controls (screen был перезаписан).
  screen.insertBefore(controls, screen.firstChild);

  segmentControl(controls, PERIODS, _currentPeriod, (v) => {
    _currentPeriod = Number(v);
    renderHistory(screen);
  });

  if (data.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'screen__placeholder';
    empty.innerHTML = `
      <h2>Здесь будет твоя история</h2>
      <p>Заполни первый опрос — он появится здесь.</p>
    `;
    screen.appendChild(empty);
    return;
  }

  // Список карточек.
  const list = document.createElement('div');
  list.className = 'day-list';
  for (const day of data) {
    list.appendChild(renderDayCard(day));
  }
  screen.appendChild(list);
}

function renderDayCard(day) {
  const card = document.createElement('article');
  card.className = 'day-card';

  const { morning, evening } = day;
  const m = morning ? '✅' : (day.date ? '❌' : '—');
  const e = evening ? '✅' : (day.date ? '❌' : '—');

  const mPreview = morning
    ? `Сон ${formatNum(morning.sleep_hours)}ч · настрой ${morning.mood_morning}/5`
    : 'Пропущено';
  const ePreview = evening
    ? `Курил ${evening.smoked_count} · спорт ${evening.did_sport ? 'да' : 'нет'} · ${evening.mood_evening}/5`
    : 'Пропущено';

  card.innerHTML = `
    <header class="day-card__head">
      <span class="day-card__date">${escapeHtml(formatHumanDate(day.date))}</span>
    </header>
    <div class="day-card__row"><span class="day-card__icon">${m}</span><span class="day-card__label">Утро</span><span class="day-card__preview">${escapeHtml(mPreview)}</span></div>
    <div class="day-card__row"><span class="day-card__icon">${e}</span><span class="day-card__label">Вечер</span><span class="day-card__preview">${escapeHtml(ePreview)}</span></div>
    <div class="day-card__detail hidden" data-detail></div>
  `;
  card.addEventListener('click', () => toggleDetail(card, day));
  return card;
}

async function toggleDetail(card, day) {
  const detail = card.querySelector('[data-detail]');
  if (!detail.classList.contains('hidden')) {
    detail.classList.add('hidden');
    detail.innerHTML = '';
    return;
  }
  haptic('light');
  detail.innerHTML = renderDetailHTML(day);
  detail.classList.remove('hidden');
}

function renderDetailHTML(day) {
  const m = day.morning;
  const e = day.evening;
  const mBlock = m ? `
    <div class="detail-block">
      <h3>Утро</h3>
      <dl>
        <dt>Сон</dt><dd>${formatNum(m.sleep_hours)} ч</dd>
        <dt>Качество</dt><dd>${m.sleep_quality}/5</dd>
        <dt>Настрой</dt><dd>${m.mood_morning}/5</dd>
        ${m.intention ? `<dt>Намерение</dt><dd>${escapeHtml(m.intention)}</dd>` : ''}
      </dl>
      <a class="link" href="#edit-morning-${escapeHtml(day.date)}">Редактировать</a>
    </div>
  ` : `<p class="detail-empty">Утро: пропущено</p>`;
  const eBlock = e ? `
    <div class="detail-block">
      <h3>Вечер</h3>
      <dl>
        <dt>Курил</dt><dd>${e.smoked_count}</dd>
        <dt>Сладкое</dt><dd>${sugarLabel(e.ate_sugar)}</dd>
        <dt>Спорт</dt><dd>${e.did_sport ? 'да' : 'нет'}</dd>
        ${e.sport_note ? `<dt>Детали спорта</dt><dd>${escapeHtml(e.sport_note)}</dd>` : ''}
        <dt>Состояние</dt><dd>${e.mood_evening}/5</dd>
        ${e.best_memory ? `<dt>Лучшее воспоминание</dt><dd>${escapeHtml(e.best_memory)}</dd>` : ''}
      </dl>
      <a class="link" href="#edit-evening-${escapeHtml(day.date)}">Редактировать</a>
    </div>
  ` : `<p class="detail-empty">Вечер: пропущено</p>`;
  return mBlock + eBlock;
}

function sugarLabel(v) {
  return v === 'yes' ? 'да' : v === 'no' ? 'нет' : 'не помню';
}

function formatNum(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function formatHumanDate(ymd) {
  const [, m, d] = ymd.split('-').map(Number);
  const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const weekdays = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const dt = new Date(ymd + 'T00:00:00');
  return `${weekdays[dt.getDay()]}, ${d} ${months[m - 1]}`;
}
