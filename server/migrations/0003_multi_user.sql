-- server/migrations/0003_multi_user.sql
-- v0.4.0: multi-user (manual approval). Шаг 1 — расширение схемы.
-- spec:09-multi-user#q4 — users table extension
-- spec:09-multi-user#q11 — migration path from v0.3.4
-- spec:04-data-model.md#q2 — users table full definition

-- 1. Расширяем users (все колонки NULL/default — безопасно для существующей записи).
ALTER TABLE users ADD COLUMN last_name      TEXT;
ALTER TABLE users ADD COLUMN language_code  TEXT;
ALTER TABLE users ADD COLUMN is_premium     INTEGER;
ALTER TABLE users ADD COLUMN deleted_at     INTEGER;
ALTER TABLE users ADD COLUMN last_seen_at   INTEGER;
ALTER TABLE users ADD COLUMN onboarded_at   INTEGER;

-- 2. status: NOT NULL с default 'pending'. Для СУЩЕСТВУЮЩЕЙ записи (owner)
--    сразу ставим 'approved' в post-migration hook (см. server/src/migrate.js),
--    чтобы не требовать /start после деплоя.
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';

-- 3. Индексы для выборок по статусу (list_pending, list_users).
CREATE INDEX IF NOT EXISTS idx_users_status     ON users(status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at);

-- 4. Новая таблица audit_log.
-- spec:04-data-model#q7 — audit_log
CREATE TABLE audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              INTEGER NOT NULL,
  actor_id        INTEGER REFERENCES users(id),
  action          TEXT NOT NULL,
  target_id       INTEGER REFERENCES users(id),
  request_ip      TEXT,
  user_agent      TEXT,
  request_id      TEXT,
  details         TEXT
);
CREATE INDEX idx_audit_ts     ON audit_log(ts DESC);
CREATE INDEX idx_audit_actor  ON audit_log(actor_id, ts DESC);
CREATE INDEX idx_audit_target ON audit_log(target_id, ts DESC);
