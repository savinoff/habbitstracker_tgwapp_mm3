// web/src/ui/settings.js
// Вкладка "Настройки": плейсхолдер для MVP-скелета.
// Полная реализация (форма времени/TZ, reset) — в #12.

export function renderSettings(screen) {
  screen.innerHTML = `
    <div class="screen__placeholder">
      <h2>Настройки</h2>
      <p>Здесь можно будет изменить время напоминаний и часовой пояс. UI приедет в следующих релизах.</p>
    </div>
  `;
}
