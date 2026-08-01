# q1–qN. Multi-user (v0.4.0)

Эта секция описывает **v0.4.0 «Multi-user (manual approval)»** — расширение
с single-user (только owner через `OWNER_TELEGRAM_ID` в `.env`) до multi-user
с ручным одобрением заявок через бота.

См. также:
- `04-data-model.md` — таблица `users` (новая), миграции существующих таблиц.
- `05-api.md` — новые маршруты `/api/users/me`, `/api/users/me/settings`,
  `/api/admin/*`; изменённое поведение `validateInitData`.
- `07-non-functional.md#q3` — escape hatch через `OWNER_TELEGRAM_ID`.

## q1. Цель и ограничения

- Поддержать **до 10 пользователей** (owner + 9).
- Owner — единственный админ (escape hatch через `OWNER_TELEGRAM_ID`).
- Self-service onboarding: юзер `/start` боту → заявка → owner approve/deny.
- **Без функции «Поделиться»** (вынесена в v0.5+). Owner приглашает
  пользователей сам (знает их Telegram id).
- Данные — per-user (TZ, reminders, surveys). Никакой cross-user аналитики.

## q2. User lifecycle

```
[unknown] → /start → [pending] → /allow → [approved] → /revoke → [banned]
                                → /deny  → [denied]   → /allow → [approved]
```

`status` в `users`:
- `pending` — заявка отправлена, owner не решил.
- `approved` — одобрен, может логиниться в Mini App.
- `banned` — отозван (`/revoke`). Soft delete через `deleted_at`.
- `denied` — заявка отклонена (`/deny`). Финальный статус, можно только пересоздать через `/start`.

`deleted_at IS NOT NULL` AND `status='banned'` — мягкое удаление.
`/unban <id>` снимает `deleted_at` И `status='banned' → 'approved'`.

## q3. Команды бота

Только для owner (проверка по `OWNER_TELEGRAM_ID`, не по БД — escape hatch).
Все команды логируются в `audit_log`.

- `/allow <telegram_id>` — `pending|denied → approved`. Если не существует — `NOT_FOUND` в audit.
- `/deny <telegram_id>` — `pending → denied`.
- `/list_pending` — таблица pending заявок (id, @username, имя, дата, язык, is_premium, был ли раньше).
- `/list_users` — все approved/denied/banned с `deleted_at`.
- `/revoke <telegram_id>` — `approved → banned`, `deleted_at = now()`.
- `/unban <telegram_id>` — `banned → approved`, `deleted_at = NULL`.

`/start` для не-владельца: создаёт/обновляет заявку, шлёт owner уведомление.
`/start` для одобренного: шлёт owner info-уведомление «@user перезапустил бота».
`/start` для banned/denied: шлёт «Доступ закрыт, напиши owner @DimSav».

## q4. Данные заявки

`users` (изменение): добавляются колонки
```
last_name        TEXT    NULL
language_code    TEXT    NULL
is_premium       INTEGER NULL  -- 0/1
status           TEXT    NOT NULL DEFAULT 'pending'
                       CHECK in ('pending','approved','denied','banned')
deleted_at       INTEGER NULL   -- soft delete marker
last_seen_at     INTEGER NULL   -- обновляется при каждом login
onboarded_at     INTEGER NULL   -- NULL = не прошёл онбординг
```

Существующие колонки (`telegram_id`, `username`, `first_name`, `timezone`,
`morning_reminder_time`, `evening_reminder_time`, `created_at`, `updated_at`)
остаются без изменений.

`audit_log` (новая таблица):
```
id          INTEGER PK
ts          INTEGER NOT NULL
actor_id    INTEGER NULL  -- users.id (NULL = system)
action      TEXT    NOT NULL  -- allow, deny, revoke, unban, login_success, login_denied, start_received, ...
target_id   INTEGER NULL  -- users.id
request_ip  TEXT    NULL
user_agent  TEXT    NULL
request_id  TEXT    NULL
details     TEXT    NULL  -- JSON
```

`morning_surveys`, `evening_surveys` — **без изменений** (уже имеют `user_id`).
`reminder_log` — **без изменений**.

Никаких дополнительных миграций данных не требуется: вся существующая
`morning_surveys.user_id` и так указывает на твою (owner) запись в `users`.

## q5. validateInitData (escape hatch)

`auth.js#validateInitData(raw, botToken, opts)`:
- Если `opts.ownerTelegramId` совпадает с `user.id` из initData — **всегда** `OK`,
  даже если в БД нет записи. Это escape hatch.
- Иначе: запрос в БД, `SELECT status FROM users WHERE telegram_id = ?`.
  - Не найден → 401, code `NO_USER` (юзер ещё не `/start`).
  - `pending` → 403, code `NOT_APPROVED`, status `pending`.
  - `denied` → 403, code `BANNED`, status `denied`.
  - `banned` (deleted_at IS NOT NULL) → 403, code `BANNED`, status `banned`.
  - `approved` → OK, обновляем `last_seen_at`.

Параметр `ownerTelegramId` остаётся обязательным в config (для escape hatch).
Приложение **не падает** если owner не `/start` бот — он автоматически
создаётся при первом логине через Mini App с приоритетом escape hatch.

## q6. Per-user scheduler

`server/src/scheduler.js`:
- Тик раз в 60 сек (как было).
- Запрос: `SELECT u.telegram_id, u.status, s.reminder_time, s.reminder_enabled,
  s.morning_enabled, s.evening_enabled
  FROM users u
  JOIN user_settings s ON s.user_id = u.id
  WHERE u.status='approved' AND u.deleted_at IS NULL
  AND s.reminder_enabled=1
  AND strftime('%H:%M', datetime('now', s.tz || ' hours'), 'unixepoch') ...`
  (точная формула — см. реализацию, важна концепция: фильтр по `local_time(now, tz) ≈ reminder_time ± 5min`).
- Шлём каждому юзеру **в его TZ** reminder «Доброе утро! Открой Mini App: [ссылка]».
- `reminder_log`: одна строка на (user_id, date, type), `ON CONFLICT DO NOTHING`.

## q7. Daily owner reminder о pending

`server/src/scheduler.js`:
- Дополнительный тик раз в день в **локальном времени owner** (TZ берётся из
  `user_settings` где `user_id = owner_id`, или дефолт из `.env` `DEFAULT_TZ`).
- Если `SELECT count(*) FROM users WHERE status='pending' > 0` — owner'у в личку:
  «У тебя N нерассмотренных заявок. /list_pending».
- Если N=0 — молчим.

## q8. Web onboarding (обязательный)

`web/src/ui/onboarding.js` (новый):
- Показывается при первом входе, флаг `user_settings.onboarded_at IS NULL`.
- Экран 1: приветствие «Привет, {first_name}! Это трекер привычек...».
  Кнопка «Начать».
- Экран 2: выбор TZ (те же 23 варианта из `tz-list.js`). Без выбора не пускаем.
- POST `/api/users/me/settings` с `{tz}` → бэкенд ставит `tz`, `onboarded_at = now()`.

## q9. Web 403-экраны

`web/src/main.js`:
- При получении `403 {code: 'NOT_APPROVED'}` → экран «Заявка отправлена. Ждём одобрения. /start боту [ссылка]».
- При `403 {code: 'BANNED', status: 'banned'}` → «Доступ закрыт. Напиши owner @DimSav».
- При `403 {code: 'BANNED', status: 'denied'}` → «Заявка отклонена. Можно попробовать /start заново».
- Кнопка «Написать боту» во всех случаях → `tg.openTelegramLink('https://t.me/xdvsHTBot')`.

## q10. Аудит (двухканальный)

`server/src/audit.js` (новый):
- `audit({actor, action, target, request, details})` — пишет в обе стороны.
- В БД: `INSERT INTO audit_log (...)`.
- В файл: `data/audit.log` (JSON lines), structured, ротация daily, 30 дней retention.
- Pino logger получает `audit: true` фильтр.
- Файл `/data/audit.log` добавляется в `backup.sh` (бэкап вместе с SQLite).

## q11. Совместимость с v0.3.4

Миграция применяется автоматически при старте api:
1. `ALTER TABLE users` — добавляются колонки `last_name`, `language_code`, `is_premium`,
   `status` (default `'approved'` для уже существующей записи owner'а, чтобы не
   требовать от тебя `/start` сразу после деплоя), `deleted_at`, `last_seen_at`,
   `onboarded_at`. Существующая запись (owner) автоматически получает `status='approved'`.
2. Создаётся таблица `audit_log`.
3. `owner.id` сохраняется в памяти процесса для escape hatch + daily reminder.

После миграции: твои данные целы, ничего не потеряно, статус уже `approved`,
можно сразу работать. Никаких ручных шагов.

## q12. Что НЕ входит в v0.4.0

- «Поделиться» (deeplink для приглашений) — v0.5+.
- Группы/категории пользователей.
- Cross-user статистика.
- Multi-owner (несколько админов).
- 2FA, TOTP, magic links.
- OAuth login через Telegram Login Widget (web-вход без Mini App).

## q13. Acceptance criteria

- [ ] `OWNER_TELEGRAM_ID=90898219` в `.env` сохранён, обеспечивает escape hatch.
- [ ] Owner пишет `/start` боту → заявка `pending`. Owner `/allow` → `approved`.
- [ ] Жена пишет `/start` → заявка, owner получает уведомление со всеми полями
      (id, @username, имя, время, язык, is_premium, был ли раньше, start_param).
- [ ] Жена `/allow` → Mini App открывается, видит онбординг, выбирает TZ.
- [ ] После онбординга форма опроса работает, опрос сохраняется в `morning_surveys`
      с `user_id=женя`.
- [ ] Жена `/revoke` от owner → Mini App показывает 403-экран, опросы не сохраняются.
- [ ] Жена `/unban` → снова может логиниться.
- [ ] Owner `/deny <id>` для pending → статус `denied`. Заявка неактивна.
- [ ] Daily reminder в 10:00 owner'у: «У тебя 0 нерассмотренных заявок» (если 0) — молчание.
- [ ] Audit log содержит все admin-действия + login_success/login_denied для всех юзеров.
- [ ] Файл `data/audit.log` пишется, ротируется daily, 30 дней retention.
- [ ] `backup.sh` включает `data/audit.log`.
- [ ] Тесты: миграция (idempotent), auth (multi-user + escape), bot (commands), scheduler (TZ per-user).
- [ ] spec-check passes.
