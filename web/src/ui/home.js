// web/src/ui/home.js
// Главный экран: плейсхолдер для MVP-скелета.
// Полная логика (выбор между morning/evening формой) — в #11.
//
// spec:06-ui-states.md#q2 — главный экран, логика отображения

export function renderHome(screen) {
  screen.innerHTML = `
    <div class="screen__placeholder">
      <h2>Главная</h2>
      <p>Здесь будет твой сегодняшний опрос. Скелет готов — формы приедут в следующих релизах.</p>
    </div>
  `;
}
