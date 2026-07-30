-- server/migrations/0001_init.sql
-- Initial schema for HabitsTracker. Mirrors docs/spec/04-data-model.md exactly.

-- spec:04-data-model#q2 — users
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

-- spec:04-data-model#q3 — morning_surveys
CREATE TABLE morning_surveys (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date      TEXT NOT NULL,
  sleep_hours     REAL NOT NULL,
  sleep_quality   INTEGER NOT NULL,
  mood_morning    INTEGER NOT NULL,
  intention       TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,

  UNIQUE(user_id, local_date)
);
CREATE INDEX idx_morning_user_date ON morning_surveys(user_id, local_date DESC);

-- spec:04-data-model#q4 — evening_surveys
CREATE TABLE evening_surveys (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date      TEXT NOT NULL,
  smoked_count    INTEGER NOT NULL,
  ate_sugar       TEXT NOT NULL,
  did_sport       INTEGER NOT NULL,
  sport_note      TEXT,
  mood_evening    INTEGER NOT NULL,
  best_memory     TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,

  UNIQUE(user_id, local_date)
);
CREATE INDEX idx_evening_user_date ON evening_surveys(user_id, local_date DESC);

-- spec:04-data-model#q5 — reminder_log
CREATE TABLE reminder_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  local_date      TEXT NOT NULL,
  sent_at         INTEGER NOT NULL,

  UNIQUE(user_id, kind, local_date)
);

-- spec:04-data-model#q6 — schema_migrations is created by the migration runner
-- (see server/src/migrate.js) before applying any migration, so we do not
-- create it here. The 0001_init migration only creates user/data tables.
