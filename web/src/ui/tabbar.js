// web/src/ui/tabbar.js
// Tab bar: переключает вкладки, обновляет hash и aria-selected.

const TABS = ['home', 'history', 'settings'];

export function initTabbar(onChange) {
  const tabbar = document.getElementById('tabbar');
  if (!tabbar) return;
  tabbar.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    const tab = btn.dataset.tab;
    if (!TABS.includes(tab)) return;
    selectTab(tab);
    onChange?.(tab);
  });
}

export function selectTab(tab) {
  for (const btn of document.querySelectorAll('.tab')) {
    const isActive = btn.dataset.tab === tab;
    btn.setAttribute('aria-selected', String(isActive));
  }
}

export function currentTab() {
  const active = document.querySelector('.tab[aria-selected="true"]');
  return active?.dataset.tab || 'home';
}

// spec:09-multi-user.md#q8, q9 — скрыть/показать tab bar
// (для onboarding и 403-экранов таб-бар не нужен).
export function hideTabbar() {
  const tabbar = document.getElementById('tabbar');
  if (tabbar) tabbar.style.display = 'none';
}
export function showTabbar() {
  const tabbar = document.getElementById('tabbar');
  if (tabbar) tabbar.style.display = '';
}
