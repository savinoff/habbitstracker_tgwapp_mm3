# 04. Data Model

> **spec_version:** 0.4.0
> **status:** draft
> **last_updated:** 2026-08-01

Хранилище — SQLite. Схема миграций — `server/migrations/NNNN_name.sql`, применяется при старте бэкенда.

---

## q1. Соглашения

- Имена таблиц — `snake_case`, множественное число: `users`, `morning_surveys`, ...
- Первичный ключ — `id INTEGER PRIMARY KEY AUTOINCREMENT`.
- Временные метки — `INTEGER` (unix epoch, **UTC**, секунды). Конвертация в локальное время — на клиенте (или в presentation-слое бэка).
- Дата дня (`local_date`) — `TEXT` в формате `YYYY-MM-DD`, **локальная** дата пользователя. Хранится для удобства запросов и уникальных индексов.
- Soft-delete — **только для `users` через `deleted_at`**. Остальные таблицы — `DELETE`.
- Внешние ключи включены: `PRAGMA foreign_keys = ON;`.

## q2. Таблица `users`

```sql
CREATE TABLE users (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id            INTEGER NOT NULL UNIQUE,
  username               TEXT,
  first_name             TEXT,
  last_name              TEXT,
  language_code          TEXT,
  is_premium             INTEGER,                 -- 0/1/NULL
  timezone               TEXT NOT NULL DEFAULT 'UTC',
  morning_reminder_time  TEXT NOT NULL DEFAULT '09:00',  -- HH:MM
  evening_reminder_time  TEXT NOT NULL DEFAULT '21:00',  -- HH:MM
  status                 TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','approved','denied','banned')),
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  deleted_at             INTEGER,                 -- soft delete (status='banned')
  last_seen_at           INTEGER,                 -- обновляется при каждом login
  onboarded_at           INTEGER                  -- NULL = онбординг не пройден
);
CREATE UNIQUE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_users_status ON users(status, deleted_at);
```

Поля:
- `telegram_id` — ID пользователя в Telegram. Уникален.
- `username`, `first_name`, `last_name`, `language_code`, `is_premium` — кэш из Telegram, **не** доверенный (может меняться).
- `timezone` — IANA TZ. Per-user. Меняется через `/api/users/me/settings` (или на странице «Настройки»).
- `morning_reminder_time` / `evening_reminder_time` — `HH:MM`, в локальном времени пользователя (его TZ).
- `status` — `pending` / `approved` / `denied` / `banned`. См. `09-multi-user.md#q2`.
- `deleted_at` — soft delete marker. `banned = deleted_at IS NOT NULL`.
- `last_seen_at` — для UI «последний раз был 3 дня назад», и для daily-reminder owner'у.
- `onboarded_at` — NULL = пользователь не выбрал TZ (см. `09-multi-user.md#q8`); NULL → блокируем опросы, показываем онбординг.

## q3. Таблица `morning_surveys`

```sql
CREATE TABLE morning_surveys (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date      TEXT NOT NULL,           -- YYYY-MM-DD, локальная дата
  sleep_hours     REAL NOT NULL,           -- 0..14, шаг 0.5
  sleep_quality   INTEGER NOT NULL,        -- 1..5
  mood_morning    INTEGER NOT NULL,        -- 1..5
  intention       TEXT,                    -- до 200 символов, NULL допустим
  created_at      INTEGER NOT NULL,        -- UTC, момент первого сохранения
  updated_at      INTEGER NOT NULL,        -- UTC, момент последнего изменения

  UNIQUE(user_id, local_date)
);
CREATE INDEX idx_morning_user_date ON morning_surveys(user_id, local_date DESC);
```

Уникальный ключ `(user_id, local_date)` обеспечивает идемпотентность US-06 — повторный POST в тот же день попадает под `INSERT ... ON CONFLICT DO UPDATE`.

## q4. Таблица `evening_surveys`

```sql
CREATE TABLE evening_surveys (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date      TEXT NOT NULL,
  smoked_count    INTEGER NOT NULL,        -- 0..50
  ate_sugar       TEXT NOT NULL,           -- 'yes' | 'no' | 'unsure'
  did_sport       INTEGER NOT NULL,        -- 0 | 1 (boolean как int)
  sport_note      TEXT,                    -- до 100 символов
  mood_evening    INTEGER NOT NULL,        -- 1..5
  best_memory     TEXT,                    -- до 300 символов
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,

  UNIQUE(user_id, local_date)
);
CREATE INDEX idx_evening_user_date ON evening_surveys(user_id, local_date DESC);
```

## q5. Таблица `reminder_log`

```sql
CREATE TABLE reminder_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,           -- 'morning' | 'evening' | 'evening_followup'
  local_date      TEXT NOT NULL,
  sent_at         INTEGER NOT NULL,        -- UTC

  UNIQUE(user_id, kind, local_date)
);
```

- Уникальный ключ `(user_id, kind, local_date)` гарантирует, что в течение дня каждое напоминание отправляется **ровно один раз** (см. `03-features/reminders.md#q3`).
- Через 90 дней записи можно чистить (TODO: cron-чистка, не критично для MVP).

## q6. Таблица `schema_migrations`

```sql
CREATE TABLE schema_migrations (
  version         INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  applied_at      INTEGER NOT NULL
);
```

Стандартный паттерн — без ORM, руками.

## q7. Таблица `audit_log` (v0.4.0+)

```sql
CREATE TABLE audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              INTEGER NOT NULL,        -- UTC unix sec
  actor_id        INTEGER REFERENCES users(id),   -- NULL = system
  action          TEXT NOT NULL,           -- 'allow'|'deny'|'revoke'|'unban'|'login_success'|'login_denied'|'start_received'|...
  target_id       INTEGER REFERENCES users(id),
  request_ip      TEXT,
  user_agent      TEXT,
  request_id      TEXT,                    -- X-Request-Id
  details         TEXT                     -- JSON
);
CREATE INDEX idx_audit_ts ON audit_log(ts DESC);
CREATE INDEX idx_audit_actor ON audit_log(actor_id, ts DESC);
CREATE INDEX idx_audit_target ON audit_log(target_id, ts DESC);
```

Двухканальный аудит (см. `09-multi-user.md#q10`): каждое событие пишется и
сюда, и в `data/audit.log` (JSON lines, ротация daily, 30 дней retention).

## q8. ER-диаграмма (текстом)

```
users (1) ──< (N) morning_surveys
users (1) ──< (N) evening_surveys
users (1) ──< (N) reminder_log
users (1) ──< (N) audit_log      (actor_id)
users (1) ──< (N) audit_log      (target_id)
```

## q9. Что НЕ хранится

- Пароли / токены пользователя (аутентификация — Telegram `initData`).
- Refresh-токены.
- Согласия, версии политики конфиденциальности — пользователь один, доверие.
- **(v0.4.0+)** IP-адреса — теперь хранятся в `audit_log.request_ip` (для аудита admin-действий).

## q10. Связанные секции

- `05-api.md` — как модель используется в API.
- `07-non-functional.md#q6` — бэкапы.
- `08-deploy.md#q3` — где физически лежит файл.
- `09-multi-user.md` — v0.4.0+: пользователи, lifecycle, аудит.
