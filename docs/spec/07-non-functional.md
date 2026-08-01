# 07. Non-Functional Requirements

> **spec_version:** 0.1.0
> **status:** draft
> **last_updated:** 2026-07-30

## q1. Производительность

- Mini App загружается < 1 МБ (gzipped) и интерактивен < 2 секунд на 3G.
- API ответ — < 200 мс для `GET /api/history?days=7` (p95).
- API ответ — < 100 мс для остальных запросов (p95).
- Планировщик напоминаний тикает раз в 60 секунд, сам тик < 50 мс.

## q2. Надёжность

- Single-user, single-instance — не партиционируем.
- SQLite в режиме WAL: `PRAGMA journal_mode=WAL;` (устойчивее к ребутам посреди записи).
- Бэкап — ежедневный cron, см. `08-deploy.md#q5`.
- При падении контейнера — Portainer auto-restart (настраивается).

## q3. Безопасность

- **Telegram `initData` валидация** на каждом запросе (см. `05-api.md#q9`). Алгоритм (по [официальной спеке](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)):
  1. Извлечь `hash` из query-string (это и есть подпись). Остальные поля, включая `signature` (Ed25519-подпись для third-party), парсятся через `URLSearchParams` (даёт URL-decoded значения).
  2. Собрать `data_check_string` — все поля кроме `hash`, отсортированные по ключу, через `\n`, формат `key=value` (с **decoded** значениями, потому что `URLSearchParams.get()` уже отдаёт декодированные).
  3. `secret_key = HMAC-SHA256(key="WebAppData", msg=BOT_TOKEN)` (вложенный HMAC, не простой sha256 от токена).
  4. `computed = hmac_sha256(secret_key, data_check_string)` (hex).
  5. Сравнить с `hash` (constant-time compare).
  6. Проверить, что `auth_date` не старше 5 минут (защита от повторного использования).
  7. **Whitelist** (v0.4.0+):
     - **Escape hatch**: `user.id == process.env.OWNER_TELEGRAM_ID` — всегда OK,
       даже если в БД нет записи. Создаёт `users (status='approved')` при первом логине.
     - **Иначе**: `SELECT status, deleted_at FROM users WHERE telegram_id = ?`.
       `pending|denied|banned` → 403, `approved` → OK.
     - Полный flow — см. `09-multi-user.md#q5`.
- **BOT_TOKEN и OWNER_TELEGRAM_ID** — только в `.env`, **никогда** в коде, **никогда** в git (`.gitignore` блокирует `.env`).
- **HTTPS** — обязателен (Let's Encrypt). Telegram шлёт `initData` только на HTTPS-страницы.
- **CORS** — `Access-Control-Allow-Origin` жёстко равен origin Mini App (наш собственный домен). Никакого `*`.
- **Rate limit** — 60 запросов/мин на пользователя (in-memory token bucket, достаточно для одного).
- **Логи** — не содержат `initData` целиком (только user.id и `auth_date`).
- **SQL injection** — все запросы через prepared statements (better-sqlite3).
- **XSS** — Telegram WebApp открывается в изолированном контексте, но всё равно: пользовательский ввод (`intention`, `sport_note`, `best_memory`) рендерится через `textContent`, не `innerHTML`.

## q4. Логирование

- Уровни: `info`, `warn`, `error`.
- Формат: `pino` JSON, в stdout.
- В Docker-контейнере — отдаётся через `docker logs`, не пишется в файл внутри контейнера (иначе потеряется при редеплое).
- Категории:
  - `http` — каждый запрос (без тела POST).
  - `reminder` — отправленные напоминания.
  - `telegram_api` — ошибки Bot API.
  - `migration` — применённые миграции.
  - `startup` / `shutdown`.

## q5. Аудит (для трейсинга изменений)

- Все коммиты в `main` — через PR (защита branch rules, см. `08-deploy.md#q7`).
- Связь код ↔ спека — маркеры `// spec:NN-filename#qN` (см. `README.md` в этом каталоге).
- Каждый PR проходит `spec-check` (GitHub Actions), валится если маркеры ссылаются на несуществующее.

## q6. Резервное копирование

- Ручной бэкап: `cp /var/lib/habitstracker/habits.db ./backup-$(date +%F).db` (US-12).
- Автоматический ежедневный бэкап — cron на хосте, см. `08-deploy.md#q5`.
- Хранилище бэкапов — локальная папка `/var/backups/habitstracker/`, retention 30 дней (чистится cron'ом).
- Бэкап создаётся через `sqlite3 habits.db ".backup '/path/to/backup.db'"` (атомарно даже под нагрузкой).

## q7. Секреты

- Все секреты — в `.env` (рядом с `docker-compose.yml` на VPS).
- В git — только `.env.example` с плейсхолдерами.
- CI (GitHub Actions) — секреты в `Settings → Secrets and variables → Actions`. Имена:
  - `TELEGRAM_BOT_TOKEN` (используется только на VPS, в Actions не нужен)
  - `OWNER_TELEGRAM_ID`
  - `DATABASE_URL` (опционально, для тестов)
- **Ротация:** токен Telegram меняется через @BotFather, после чего обновляется в `.env` и контейнер перезапускается.

## q8. Связанные секции

- `05-api.md#q9` — детальная аутентификация.
- `04-data-model.md` — что защищаем.
- `08-deploy.md` — где физически секреты.
