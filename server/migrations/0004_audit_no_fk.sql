-- server/migrations/0004_audit_no_fk.sql
-- v0.4.0: убираем FK с audit_log.actor_id и audit_log.target_id.
-- actor_id и target_id — это telegram_id (числа), не users.id.
-- Изначально был FK REFERENCES users(id), но это ломало запись при
-- audit (target_id = telegram_id не существует в users.id).
--
-- SQLite не поддерживает DROP CONSTRAINT напрямую, поэтому:
-- 1. Пересоздаём таблицу без FK.
-- 2. Копируем данные.
-- 3. Удаляем старую.
-- 4. Переименовываем новую.
--
-- ВАЖНО: эта миграция НЕ должна содержать BEGIN/COMMIT — migrate.js уже
-- оборачивает каждую миграцию в транзакцию.
--
-- spec:09-multi-user.md#q10 — audit dual-write
-- spec:04-data-model#q7 — audit_log

CREATE TABLE audit_log_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              INTEGER NOT NULL,
  actor_id        INTEGER,
  action          TEXT NOT NULL,
  target_id       INTEGER,
  request_ip      TEXT,
  user_agent      TEXT,
  request_id      TEXT,
  details         TEXT
);

INSERT INTO audit_log_new (id, ts, actor_id, action, target_id, request_ip, user_agent, request_id, details)
SELECT id, ts, actor_id, action, target_id, request_ip, user_agent, request_id, details
FROM audit_log;

DROP TABLE audit_log;
ALTER TABLE audit_log_new RENAME TO audit_log;

CREATE INDEX idx_audit_ts     ON audit_log(ts DESC);
CREATE INDEX idx_audit_actor  ON audit_log(actor_id, ts DESC);
CREATE INDEX idx_audit_target ON audit_log(target_id, ts DESC);
