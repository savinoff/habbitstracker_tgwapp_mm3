// web/src/main.js
// Bootstrap Mini App: инициализирует Telegram WebApp SDK, проверяет /api/users/me
// (v0.4.0+), рендерит онбординг или 403-экран, либо активный таб.
//
// spec:06-ui-states.md#q1, q2, q8 — карта экранов, init, theme params
// spec:03-features/history.md#q2 — deep-link #history (issue #13)
// spec:03-features/settings.md (через хеш) — deep-link #settings
// spec:09-multi-user.md#q8 — onboarding (обязательный выбор TZ)
// spec:09-multi-user.md#q9 — web 403-экраны

import { initTabbar, selectTab, currentTab, hideTabbar, showTabbar } from './ui/tabbar.js';
import { renderHome } from './ui/home.js';
import { renderHistory } from './ui/history.js';
import { renderSettings } from './ui/settings.js';
import { renderOnboarding } from './ui/onboarding.js';
import { renderForbidden } from './ui/forbidden.js';
import { getHealth, getMe } from './api.js';

const RENDERERS = {
  home: renderHome,
  history: renderHistory,
  settings: renderSettings,
};

let _user = null;  // /api/users/me response.data

function applyTheme() {
  const tg = window.Telegram?.WebApp;
  if (!tg?.themeParams) return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(tg.themeParams)) {
    const cssVar = `--tg-theme-${camelToKebab(key)}`;
    if (value) root.style.setProperty(cssVar, value);
  }
}

function camelToKebab(s) {
  return s.replace(/([A-Z])/g, '-$1').toLowerCase();
}

function getInitialTab() {
  const hash = (window.location.hash || '').replace(/^#/, '');
  if (RENDERERS[hash]) return hash;
  const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
  if (startParam && RENDERERS[startParam]) return startParam;
  return 'home';
}

function showTab(tab) {
  const renderer = RENDERERS[tab] || renderHome;
  const screen = document.getElementById('screen');
  if (!screen) return;
  try {
    renderer(screen, _user);
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
  if (window.location.hash !== `#${tab}`) {
    history.replaceState(null, '', `#${tab}`);
  }
  showTab(tab);
}

function showOnboarding() {
  hideTabbar();
  const screen = document.getElementById('screen');
  if (!screen) return;
  renderOnboarding(screen, _user, () => {
    // После успешного сохранения TZ — перечитываем профиль и рендерим Home.
    _user = { ..._user, onboarded: true };
    showTabbar();
    switchTab(getInitialTab());
  });
}

function showForbidden(code, status, message) {
  hideTabbar();
  const screen = document.getElementById('screen');
  if (!screen) return;
  renderForbidden(screen, { code, status, message });
}

async function bootstrap() {
  const tg = window.Telegram?.WebApp;

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

  // Health-check в фоне.
  if (tg) {
    getHealth().catch(() => { /* dev без бэка — игнор */ });
  }

  // spec:09-multi-user.md#q5 — сначала проверяем профиль через /api/users/me.
  // Если 401/403 — рисуем соответствующий экран.
  // Если 200 и !onboarded — рисуем онбординг.
  // Иначе — обычный таб.
  try {
    const res = await getMe();
    _user = res.data;
    if (!_user.onboarded) {
      showOnboarding();
      return;
    }
  } catch (err) {
    if (err && err.status === 401 && err.code === 'NOT_REGISTERED') {
      showForbidden('NOT_REGISTERED');
      return;
    }
    if (err && err.status === 403) {
      showForbidden('BANNED', err.details?.status, err.message);
      return;
    }
    if (err && (err.status === 401 || err.status === 403)) {
      showForbidden('BANNED', null, err.message);
      return;
    }
    // Любая другая ошибка — показываем общую 403-страницу, чтобы юзер увидел что-то осмысленное.
    showForbidden('BANNED', null, err?.message || 'Ошибка загрузки профиля');
    return;
  }

  // Обычный flow: tab bar + активный таб.
  const initial = getInitialTab();
  selectTab(initial);
  history.replaceState(null, '', `#${initial}`);

  initTabbar((tab) => switchTab(tab));

  showTab(initial);

  // Слушаем изменения hash.
  window.addEventListener('hashchange', () => {
    const next = getInitialTab();
    if (next !== currentTab()) switchTab(next);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
