# Changelog — Spec

Все значимые изменения в `docs/spec/`. Формат вдохновлён [Keep a Changelog](https://keepachangelog.com).

## [0.2.0] — 2026-07-31

### Changed
- **08-deploy.md: nginx + certbot → Caddy 2.** ACME (Let's Encrypt)
  встроен в Caddy, не нужен отдельный certbot-контейнер, нет
  renewal-хуков. Конфиг — один `Caddyfile` в 5 строк.
- **00-vision.md: стек.** Reverse proxy изменён на Caddy 2 +
  Let's Encrypt с обоснованием.
- **adr/0001-stack.md: добавлены альтернативы** — Traefik, Cloudflare
  Tunnel — с обоснованием, почему выбран Caddy.

### Added
- **08-deploy.md: q11 (Caddyfile), q12 (связанные секции).**
- **08-deploy.md: переменная `CADDY_EMAIL`** в `.env` / `.env.example`
  для ACME-регистрации.
- **08-deploy.md: named volumes `caddy_data` / `caddy_config`** для
  хранения сертификатов и admin-состояния Caddy.

### Fixed
- (none)

### Removed
- (none)

### Security
- (unchanged from 0.1.0)

## [0.1.0] — 2026-07-30

### Added
- Initial spec draft for **HabitsTracker** — Telegram Mini App.
- 00-vision.md — миссия, скоуп MVP/non-MVP, success criteria, зафиксированный стек.
- 01-personas.md — primary persona (Саша, 32, разработчик), anti-persona.
- 02-user-stories.md — 13 user stories с критериями приёмки (US-01..US-13).
- 03-features/survey-morning.md — утренний опрос, 4 поля, идемпотентность.
- 03-features/survey-evening.md — вечерний опрос, 6 полей, догоняющее напоминание.
- 03-features/reminders.md — расписание, тексты, scheduler, lock на случай multi-instance.
- 03-features/history.md — фильтры 7/30/all, раскрытие карточек, пустые дни.
- 03-features/settings.md — время напоминаний, TZ (фикс. список), reset.
- 04-data-model.md — таблицы `users`, `morning_surveys`, `evening_surveys`, `reminder_log`, `schema_migrations`.
- 05-api.md — REST-контракты 7 эндпоинтов, валидация полей, initData-аутентификация.
- 06-ui-states.md — карта экранов, состояния, Telegram WebApp API.
- 07-non-functional.md — перф, надёжность, безопасность (initData HMAC), логи, бэкапы, секреты.
- 08-deploy.md — архитектура, docker-compose, деплой через bare-repo, cron-бэкап, branch protection, GitHub Actions.
- adr/0001-stack.md — выбор стека (Node + Fastify + SQLite + Vanilla JS + Vite + Docker + bare-repo deploy).

### Fixed
- (none)

### Changed
- (none)

### Removed
- (none)

### Security
- Зафиксирована процедура валидации `initData` (HMAC-SHA256, 5-минутный TTL, whitelist по `OWNER_TELEGRAM_ID`).
- Зафиксировано хранение секретов только в `.env` (не в git, не в коде).
