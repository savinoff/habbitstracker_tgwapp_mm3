// web/src/ui/forms.js
// Общие примитивы для форм опросов. spec:03-features/survey-morning.md#q2,
// spec:03-features/survey-evening.md#q2.
//
// Все функции принимают `formEl` (родительский <form>) и `name` (имя поля),
// возвращают ссылку на свой корневой DOM-элемент. Имя также используется
// для чтения/записи значения через getValue/setValue.

// ─── Emoji-row (1..5) ───
// options: [{ value: 1, emoji: '😞', label: 'Плохо' }, ...]
export function emojiRow(formEl, name, label, options) {
  const wrap = document.createElement('div');
  wrap.className = 'field field--emoji';
  wrap.innerHTML = `
    <label class="field__label">${escapeHtml(label)}</label>
    <div class="emoji-row" role="radiogroup" aria-label="${escapeHtml(label)}">
      ${options.map((o) => `
        <button type="button" class="emoji-btn" data-name="${name}" data-value="${o.value}" aria-label="${escapeHtml(o.label || '')}">
          <span class="emoji-btn__emoji">${o.emoji}</span>
        </button>
      `).join('')}
    </div>
  `;
  formEl.appendChild(wrap);
  const buttons = wrap.querySelectorAll('.emoji-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.setAttribute('aria-checked', 'false'));
      btn.setAttribute('aria-checked', 'true');
      haptic('light');
    });
  });
  return {
    el: wrap,
    getValue() {
      const sel = wrap.querySelector('.emoji-btn[aria-checked="true"]');
      return sel ? Number(sel.dataset.value) : null;
    },
    setValue(v) {
      buttons.forEach((b) => {
        if (Number(b.dataset.value) === v) b.setAttribute('aria-checked', 'true');
        else b.setAttribute('aria-checked', 'false');
      });
    },
  };
}

// ─── Chip-row (yes/no/unsure) ───
export function chipRow(formEl, name, label, options) {
  const wrap = document.createElement('div');
  wrap.className = 'field field--chips';
  wrap.innerHTML = `
    <label class="field__label">${escapeHtml(label)}</label>
    <div class="chip-row" role="radiogroup">
      ${options.map((o) => `
        <button type="button" class="chip" data-name="${name}" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</button>
      `).join('')}
    </div>
  `;
  formEl.appendChild(wrap);
  const buttons = wrap.querySelectorAll('.chip');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.setAttribute('aria-checked', 'false'));
      btn.setAttribute('aria-checked', 'true');
      haptic('light');
    });
  });
  return {
    el: wrap,
    getValue() {
      const sel = wrap.querySelector('.chip[aria-checked="true"]');
      return sel ? sel.dataset.value : null;
    },
    setValue(v) {
      buttons.forEach((b) => {
        if (b.dataset.value === v) b.setAttribute('aria-checked', 'true');
        else b.setAttribute('aria-checked', 'false');
      });
    },
  };
}

// ─── Stepper (int) ───
export function stepper(formEl, name, label, { min = 0, max = 50, step = 1, unit = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'field field--stepper';
  let value = min;
  wrap.innerHTML = `
    <label class="field__label">${escapeHtml(label)}</label>
    <div class="stepper">
      <button type="button" class="stepper__btn" data-delta="-${step}" aria-label="Меньше">−</button>
      <span class="stepper__value" data-name="${name}">${value}${unit ? ' ' + escapeHtml(unit) : ''}</span>
      <button type="button" class="stepper__btn" data-delta="${step}" aria-label="Больше">+</button>
    </div>
  `;
  formEl.appendChild(wrap);
  const valueEl = wrap.querySelector('.stepper__value');
  const update = () => {
    value = Math.max(min, Math.min(max, value));
    valueEl.textContent = `${value}${unit ? ' ' + escapeHtml(unit) : ''}`;
  };
  wrap.querySelectorAll('.stepper__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      value += Number(btn.dataset.delta);
      update();
      haptic('light');
    });
  });
  return {
    el: wrap,
    getValue() { return value; },
    setValue(v) { value = v; update(); },
  };
}

// ─── Slider (0..14, step 0.5) ───
export function slider(formEl, name, label, { min = 0, max = 14, step = 0.5, unit = 'ч' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'field field--slider';
  let value = min;
  wrap.innerHTML = `
    <label class="field__label">${escapeHtml(label)}</label>
    <div class="slider-row">
      <input type="range" class="slider" min="${min}" max="${max}" step="${step}" value="${value}" />
      <span class="slider__value" data-name="${name}">${formatNumber(value)} ${escapeHtml(unit)}</span>
    </div>
  `;
  formEl.appendChild(wrap);
  const input = wrap.querySelector('.slider');
  const valueEl = wrap.querySelector('.slider__value');
  input.addEventListener('input', () => {
    value = Number(input.value);
    valueEl.textContent = `${formatNumber(value)} ${escapeHtml(unit)}`;
  });
  return {
    el: wrap,
    getValue() { return value; },
    setValue(v) { value = v; input.value = String(v); valueEl.textContent = `${formatNumber(v)} ${escapeHtml(unit)}`; },
  };
}

// ─── Textarea (≤ maxLen) ───
export function textarea(formEl, name, label, { maxLen = 200, placeholder = '', rows = 2 } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'field field--textarea';
  wrap.innerHTML = `
    <label class="field__label">${escapeHtml(label)} <span class="field__count" data-name="${name}">0/${maxLen}</span></label>
    <textarea class="textarea" data-name="${name}" maxlength="${maxLen}" rows="${rows}" placeholder="${escapeHtml(placeholder)}"></textarea>
  `;
  formEl.appendChild(wrap);
  const ta = wrap.querySelector('.textarea');
  const count = wrap.querySelector('.field__count');
  const update = () => { count.textContent = `${ta.value.length}/${maxLen}`; };
  ta.addEventListener('input', update);
  return {
    el: wrap,
    getValue() {
      const v = ta.value.trim();
      return v.length > 0 ? v : null;
    },
    setValue(v) {
      ta.value = v || '';
      update();
    },
  };
}

// ─── Helpers ───

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatNumber(n) {
  // step=0.5 → 7.5; integer → 7
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function haptic(kind) {
  try {
    const tg = window.Telegram?.WebApp;
    if (!tg?.HapticFeedback) return;
    if (kind === 'light') tg.HapticFeedback.impactOccurred('light');
    else if (kind === 'success') tg.HapticFeedback.notificationOccurred('success');
    else if (kind === 'error') tg.HapticFeedback.notificationOccurred('error');
  } catch { /* ignore */ }
}

export { escapeHtml, haptic };
