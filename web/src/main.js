// web/src/main.js
// Bootstrap Mini App: инициализирует Telegram WebApp SDK, рисует активный экран,
// вешает tab bar и deep-link через window.location.hash.
//
// spec:06-ui-states.md#q1, q2, q8 — карта экранов, init, theme params
// spec:03-features/history.md#q2 — deep-link #history (issue #13)
// spec:03-features/settings.md (через хеш) — deep-link #settings

import { initTabbar, selectTab, currentTab } from './ui/tabbar.js';
import { renderHome } from './ui/home.js';
import { renderHistory } from './ui/history.js';
import { renderSettings } from './ui/settings.js';
import { getHealth } from './api.js';

const RENDERERS = {
  home: renderHome,
  history: renderHistory,
  settings: renderSettings,
};

function applyTheme() {
  // spec:06-ui-states.md#q8 — theme params from Telegram.
  const tg = window.Telegram?.WebApp;
  if (!tg?.themeParams) return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(tg.themeParams)) {
    // tg-theme-bg-color, tg-theme-text-color, ...
    const cssVar = `--tg-theme-${camelToKebab(key)}`;
    if (value) root.style.setProperty(cssVar, value);
  }
}

function camelToKebab(s) {
  return s.replace(/([A-Z])/g, '-$1').toLowerCase();
}

function getInitialTab() {
  // spec:03-features/history.md#q2 — поддержка #history deep-link
  const hash = (window.location.hash || '').replace(/^#/, '');
  if (RENDERERS[hash]) return hash;
  return 'home';
}

function showTab(tab) {
  const renderer = RENDERERS[tab] || renderHome;
  const screen = document.getElementById('screen');
  if (!screen) return;
  try {
    renderer(screen);
  } catch (err) {
    console.error(`[main] failed to render ${tab}:`, err);
    screen.innerHTML = `<div class="error">Не получилось отобразить экран: ${escapeHtml(String(err.message))}</div>`;
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function switchTab(tab) {
  selectTab(tab);
  // Сохраняем в hash для перезагрузки и шаринга.
  if (window.location.hash !== `#${tab}`) {
    history.replaceState(null, '', `#${tab}`);
  }
  showTab(tab);
}

async function bootstrap() {
  const tg = window.Telegram?.WebApp;

  // spec:06-ui-states.md#q8 — init flow.
  if (tg) {
    try {
      tg.ready();
      tg.expand();
    } catch (err) {
      console.warn('[main] Telegram.WebApp init failed:', err);
    }
  } else {
    console.warn('[main] window.Telegram.WebApp is not present (probably opened in a regular browser)');
  }

  applyTheme();

  const initial = getInitialTab();
  selectTab(initial);
  history.replaceState(null, '', `#${initial}`);

  initTabbar((tab) => switchTab(tab));

  showTab(initial);

  // Слушаем изменения hash (например, deep-link от бота уже после init).
  window.addEventListener('hashchange', () => {
    const next = getInitialTab();
    if (next !== currentTab()) switchTab(next);
  });

  // Health-check в фоне (не критично, но помогает понять, что бэк жив).
  if (tg) {
    getHealth().catch(() => { /* dev без бэка — игнор */ });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
