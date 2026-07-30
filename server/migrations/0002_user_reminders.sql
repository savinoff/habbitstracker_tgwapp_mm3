-- server/migrations/0002_user_reminders.sql
-- Добавляем в users колонки для времени напоминаний.
-- spec:03-features/settings.md#q2 — поля
-- spec:04-data-model.md#q2 — users table

ALTER TABLE users ADD COLUMN morning_reminder_time TEXT NOT NULL DEFAULT '09:00';
ALTER TABLE users ADD COLUMN evening_reminder_time TEXT NOT NULL DEFAULT '21:00';
