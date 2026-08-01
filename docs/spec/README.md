# Specification — `docs/spec/`

> **spec_version:** 0.3.1
> **status:** draft
> **last_updated:** 2026-08-01

Этот каталог — **single source of truth** для проекта. Любое изменение поведения приложения сначала отражается здесь (коммитом `docs(spec): ...`), затем в коде.

## Оглавление

- **[00-vision.md](00-vision.md)** — зачем, для кого, скоуп MVP
- **[01-personas.md](01-personas.md)** — целевой пользователь
- **[02-user-stories.md](02-user-stories.md)** — пользовательские истории + критерии приёмки
- **[03-features/](03-features/)**
  - [survey-morning.md](03-features/survey-morning.md) — утренний опрос
  - [survey-evening.md](03-features/survey-evening.md) — вечерний опрос
  - [reminders.md](03-features/reminders.md) — напоминания
  - [history.md](03-features/history.md) — история
  - [settings.md](03-features/settings.md) — настройки
- **[04-data-model.md](04-data-model.md)** — таблицы, поля, индексы
- **[05-api.md](05-api.md)** — REST-контракты
- **[06-ui-states.md](06-ui-states.md)** — экраны и состояния UI
- **[07-non-functional.md](07-non-functional.md)** — безопасность, перф, бэкапы
- **[08-deploy.md](08-deploy.md)** — инфраструктура и деплой
- **[CHANGELOG-spec.md](CHANGELOG-spec.md)** — история изменений ТЗ
- **[adr/](adr/)** — Architecture Decision Records

## Версионирование

Spec использует semver: `MAJOR.MINOR.PATCH`.

- `MAJOR` — breaking change в user-visible поведении или data model (требует миграции).
- `MINOR` — новая фича или новая секция.
- `PATCH` — уточнение, опечатка, без изменения поведения.

При изменении версии — обнови поле `spec_version` в **каждом** файле спеки и в этом README.

## Соглашения

### Нумерация секций

Внутри каждого .md секции нумеруются как `## qN. Заголовок`. Число `N` стабильно в пределах файла, пока секция существует. Если секция удаляется — её номер **не переиспользуется** (чтобы старые ссылки в коде не указывали на новое).

### Маркеры в коде

В коде ссылка на ТЗ делается комментарием вида:

```
// spec:03-features/survey-morning#q2   — поля формы
// spec:04-data-model#q3                 — таблица morning_surveys
```

Формат: `spec:<путь-без-md>#q<номер>`.

Скрипт `scripts/spec-check.js` (запускается в CI) парсит все `.md` из `docs/spec/`, собирает карту `(file, qN)`, и валит билд если:
- маркер в коде ссылается на несуществующий `(file, qN)`;
- секция в `.md` была переименована/удалена, а в коде осталась ссылка на старый номер.

### Conventional Commits

Используем conventional commits:

- `docs(spec): <что>` — изменение ТЗ.
- `feat(scope): <что>` — новая фича, в коде.
- `fix(scope): <что>` — баг-фикс.
- `chore: <что>` — инфраструктура, ci, рефакторинг без поведения.
- `refactor: <что>` — рефакторинг.

`scope` — короткий тег: `api`, `web`, `bot`, `db`, `reminder`, `settings`, `history`.

Пример хорошего коммита:
```
feat(reminder): morning scheduler tick

// spec:03-features/reminders.md#q3
// spec:04-data-model.md#q5
```

## Workflow изменения ТЗ

1. Создать ветку `spec/<короткое-имя>`.
2. Поменять файл(ы) в `docs/spec/`. Если меняется поведение — обязательно обновить раздел «Связанные секции».
3. Поднять `spec_version` (минимум PATCH).
4. В `CHANGELOG-spec.md` добавить запись.
5. Открыть PR → review → merge.
6. **После** merge спеки (или в том же PR) — открыть PR с кодом, который реализует изменение, со ссылками `// spec:...`.

Никакого кода без обновлённого ТЗ.
Никакого ТЗ без последующего кода (если только ТЗ не «откатывает» поведение — в этом случае код откатывается тоже).

## Конфликты и приоритет

Если код и ТЗ расходятся — побеждает ТЗ, код — баг. В PR с фиксом обязательно объяснить, когда именно код отстал.
