# Changelog — Spec

Все значимые изменения в `docs/spec/`. Формат вдохновлён [Keep a Changelog](https://keepachangelog.com).

## [0.4.0] — 2026-08-01 — **Multi-user (manual approval)**

Расширение single-user (только owner) до multi-user с ручным одобрением
заявок через бота. До 10 пользователей. Owner — единственный админ.

### Added
- **09-multi-user.md** — новая секция (13 вопросов, от цели до acceptance criteria).
- **`users` table** (см. `04-data-model.md#q2`): добавлены `last_name`, `language_code`,
  `is_premium`, `status` (pending/approved/denied/banned), `updated_at`, `deleted_at`,
  `last_seen_at`. Удалён `timezone` (перенесён в `user_settings.tz`).
- **`audit_log` table** (см. `04-data-model.md#q7`): actor_id, action, target_id,
  request_ip, user_agent, request_id, details (JSON).
- **Bot commands** (только owner): `/allow <id>`, `/deny <id>`, `/list_pending`,
  `/list_users`, `/revoke <id>`, `/unban <id>`. Все логируются в `audit_log`.
- **`/start` flow**: pending → уведомление owner'у с max-инфой (id, @username, имя,
  время, язык, is_premium, был ли раньше, start_param). Approved re-`/start` →
  info-уведомление owner'у.
- **API `/api/users/me`, `/api/users/me/settings`** (GET/POST).
- **API `/api/admin/users`, `/api/admin/audit`, `/api/admin/stats`** (только owner).
- **Web onboarding**: приветствие + обязательный выбор TZ (из 23 вариантов).
  Без выбора TZ форма опроса заблокирована.
- **Web 403-экраны**: для `pending` / `denied` / `banned` — разные сообщения,
  кнопка «Написать боту».
- **Audit dual-write**: в `audit_log` (БД) + `data/audit.log` (файл, JSON lines,
  daily ротация, 30 дней retention).
- **Daily owner reminder** в 10:00 локального времени owner'а: «У тебя N
  нерассмотренных заявок» (если N>0).
- **Per-user scheduler**: reminder каждому в **его** TZ, по `user_settings.tz`.

### Changed
- **`05-api.md#q9`**: описание whitelist обновлено. Теперь: escape hatch через
  `OWNER_TELEGRAM_ID` (всегда OK), иначе — `SELECT users.status`.
- **`04-data-model.md#q1`**: soft-delete теперь **разрешён** (только для `users`).
- **`05-api.md#q9`**: HMAC-формула — `HMAC-SHA256("WebAppData", BOT_TOKEN)`
  (канонический алгоритм, см. v0.3.4).

### Migration
- Применяется автоматически при старте api (см. `09-multi-user.md#q11`).
- `users` и `audit_log` создаются.
- `user_settings` (если есть запись) привязывается к `users.telegram_id=OWNER_TELEGRAM_ID`.
- `morning_surveys` и `evening_surveys` — добавляется `user_id`, все записи → owner.
- Твои данные целы, ничего не потеряно.

### Security
- Все admin-команды логируются (actor, action, target, ts, request_id, status).
- 403-ответы для не-одобренных **не раскрывают** причину бана (только `status`).
- IP хранится только в `audit_log` (для аудита admin-действий, не для обычных логинов).

### Что НЕ входит (см. `09-multi-user.md#q12`)
- «Поделиться» (deeplink) — v0.5+.
- Multi-owner.
- 2FA, TOTP, OAuth.
- Cross-user аналитика.

## [0.3.4] — 2026-08-01 — 🎉 **ПЕРВАЯ РАБОЧАЯ ВЕРСИЯ В ПРОДЕ**

Mini App `HabitsTracker` заработала end-to-end в реальном Telegram WebView.
Форма утреннего опроса загружается у @DimSav в Telegram, `/api/morning/today`
отдаёт 200, HMAC валидация проходит, SPA fallback работает
(Caddy 8443 → Fastify:3000 → web/dist).

### Fixed (финальный правильный HMAC)
- **07-non-functional.md#q3** — `secret_key` правильно вычисляется как
  `HMAC-SHA256(key="WebAppData", msg=BOT_TOKEN)`. До этого **три недели** в
  проде `BAD_SIGNATURE` ломал каждый запрос, но тесты молчали: и
  `test-initdata.js`, и `auth.js` использовали одну и ту же сломанную формулу
  (`sha256(BOT_TOKEN)`), и тест проходил по «равенству двух одинаково кривых
  реализаций». Канонический алгоритм — по [официальной спеке](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app) и 10+ рабочим реализациям на StackOverflow.
- **`data_check_string` строится через `URLSearchParams`** (URL-decoded
  значения), `signature` НЕ фильтруется (он для third-party Ed25519,
  HMAC-проверке не нужен). Это **откат** PR #38 (где был raw-формат) — он
  оказался неправильным, несмотря на интуитивно «логичную» аргументацию.

### Уроки (тоже в changelog, чтоб не повторять)
- **Тесты должны проверять на НАСТОЯЩИХ данных, а не на синтетике, которую
  сами же сгенерили.** Сломанные HMAC-формулы совпадают только между собой.
- **Debug-логи в проде** (даже временные) окупаются за минуты — без
  `BAD_SIGNATURE_DEBUG` с `rawLen/dcsPrefix/computedPrefix` мы бы неделю
  гадали почему hash не сходится.
- **Всегда читать официальную спеку** (`https://core.telegram.org/bots/webapps#validating-data`)
  а не «интуитивно правильную» интерпретацию.

### Убрано
- Debug-ветки `debug/log-initdata`, `debug/bad-signature-logs` — удалены
  локально и с origin.
- 19+ локальных `feat/*` `docs/*` `fix/*` веток (были смёржены через
  squash-rebase) — почищены, остался только `main`.

## [0.3.3] — 2026-08-01

### Fixed
- **07-non-functional.md#q3** — `secret_key` = `HMAC-SHA256("WebAppData", bot_token)`
  (вместо `sha256(bot_token)`). Главная причина `BAD_SIGNATURE` в проде.

## [0.3.2] — 2026-08-01

### Fixed
- **07-non-functional.md#q3** — `data_check_string` строится по **raw**
  URL-encoded форме полей. **(ОТКАЗАНО в v0.3.4 — канонический алгоритм
  использует URL-decoded значения, не raw.)**

### Fixed
- **07-non-functional.md#q3** — `data_check_string` теперь строится по **raw**
  URL-encoded форме полей из initData. Раньше `server/src/auth.js` парсил
  initData через `URLSearchParams` (который декодирует значения) и собирал
  обратно — `user` поле вроде `{"photo_url":"https%3A%5C%2F%5C%2Ft.me..."}`
  превращалось в `{"photo_url":"https:\/\/t.me..."}`, и HMAC переставал
  совпадать с присланным `hash` (симптом: `BAD_SIGNATURE` при живом initData).
  Также добавлено исключение `signature` из `data_check_string` — на
  случай если Telegram Mini App его присылает вместе с `hash`.
- **07-non-functional.md#q3** — **критичный фикс HMAC**: `secret_key` теперь
  считается как `HMAC-SHA256(key="WebAppData", msg=BOT_TOKEN)`, а не
  `sha256(BOT_TOKEN)`. До этого момента **все** валидации Telegram Mini App
  в проде возвращали `BAD_SIGNATURE` — и тест в `test-initdata.js` проходил
  только потому, что и тест, и прод-код использовали одинаково неправильную
  формулу. Сейчас алгоритм совпадает с [официальной спекой](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).

## [0.3.1] — 2026-08-01

### Added
- **`scripts/redeploy.sh`** — ручной redeploy из GitHub. Тянет свежий код,
  пересобирает образы, перезапускает контейнеры, проверяет /api/health.
  Аргументы: `--branch=<name>`, `--no-build`, `--logs`, `--help`.
- **`08-deploy.md#q14`** — описание deploy workflow: три способа (redeploy.sh,
  git push через bare-repo hook, GitHub webhook для будущего).

### Changed
- **`hooks/post-receive`** — теперь bare-repo знает про GitHub (origin=GitHub),
  hook сам делает `git fetch origin` после push.
- **`scripts/setup-vps.sh`** — настраивает `origin` bare-repo на GitHub,
  чтобы hook мог тянуть свежий код.

## [0.3.0] — 2026-08-01

### Changed
- **08-deploy.md: Caddy может работать на нестандартном внешнем порту 8443.**
  Это нужно, когда 443 на хосте уже занят другим сервисом (X-UI, Outline,
  провайдерский nginx). Caddy внутри контейнера по-прежнему слушает 443,
  но наружу пробрасывается на 8443.
- **08-deploy.md: каталоги bare-repo и work tree по умолчанию в `~`**
  (`~/srv/habitstracker.git`, `~/opt/habitstracker`) — снимает требование
  sudo для деплоя. Если есть root — `/srv` и `/opt` тоже допустимы.
- **`docker-compose.deploy.yml`:** `ports: 443:443` → `8443:443`. ACME
  HTTP-01 challenge через 80 продолжает работать.

### Added
- **08-deploy.md: q13** — новый раздел про нестандартный порт: как работает
  ACME, что писать в `APP_BASE_URL`, как настроить @BotFather, диагностика.
- **08-deploy.md: альтернативы** — Cloudflare в front, X-UI inbound → Caddy.
- **`.env.example`:** примечание про `APP_BASE_URL` с портом `:8443`.

### Fixed
- (none)

### Removed
- (none)

### Security
- (unchanged from 0.2.0)

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
