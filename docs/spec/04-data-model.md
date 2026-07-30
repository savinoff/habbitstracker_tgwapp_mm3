# 04. Data Model

> **spec_version:** 0.1.0
> **status:** draft
> **last_updated:** 2026-07-30

Хранилище — SQLite. Схема миграций — `server/migrations/NNNN_name.sql`, применяется при старте бэкенда.

---

## q1. Соглашения

- Имена таблиц — `snake_case`, множественное число: `users`, `morning_surveys`, ...
- Первичный ключ — `id INTEGER PRIMARY KEY AUTOINCREMENT`.
- Временные метки — `INTEGER` (unix epoch, **UTC**, секунды). Конвертация в локальное время — на клиенте (или в presentation-слое бэка).
- Дата дня (`local_date`) — `TEXT` в формате `YYYY-MM-DD`, **локальная** дата пользователя. Хранится для удобства запросов и уникальных индексов.
- Soft-delete **не используется**. Удаление записи — `DELETE`.
- Внешние ключи включены: `PRAGMA foreign_keys = ON;`.

## q2. Таблица `users`

```sql
CREATE TABLE users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id     INTEGER NOT NULL UNIQUE,
  username        TEXT,
  first_name      TEXT,
  timezone        TEXT NOT NULL DEFAULT 'UTC',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_users_telegram_id ON users(telegram_id);
```

Поля:
- `telegram_id` — ID пользователя в Telegram. Уникален.
- `username`, `first_name` — кэш для удобства, **не** доверенный (может меняться).
- `timezone` — IANA TZ строка. Источник правды для всех time-расчётов.

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

## q7. ER-диаграмма (текстом)

```
users (1) ──< (N) morning_surveys
users (1) ──< (N) evening_surveys
users (1) ──< (N) reminder_log
```

## q8. Что НЕ хранится

- Пароли / токены пользователя (аутентификация — Telegram `initData`).
- Refresh-токены.
- IP-адреса (для MVP логи запросов достаточно на уровне Nginx, не в БД).
- Согласия, версии политики конфиденциальности — пользователь один, доверие.

## q9. Связанные секции

- `05-api.md` — как модель используется в API.
- `07-non-functional.md#q6` — бэкапы.
- `08-deploy.md#q3` — где физически лежит файл.
