# 05. API

> **spec_version:** 0.3.0
> **status:** draft
> **last_updated:** 2026-08-01

## q1. Общие правила

- Базовый URL: `https://<your-domain>/api`
- Все запросы (кроме `/api/health`) требуют валидный Telegram `initData` в заголовке `X-Telegram-Init-Data` (см. `07-non-functional.md#q3`).
- Все ответы — JSON.
- Коды ошибок: `400` (валидация), `401` (невалидный `initData`), `404` (не найдено), `500` (внутренняя).
- Тело ошибки: `{ "error": { "code": "VALIDATION", "message": "...", "details": {...} } }`.
- Идемпотентные методы — да, мутации — POST (не PATCH/PUT, чтобы проще).

## q2. POST /api/surveys/morning

Сохранение / обновление утреннего опроса.

**Запрос:**
```json
{
  "date": "2026-07-30",
  "sleep_hours": 7.5,
  "sleep_quality": 4,
  "mood_morning": 4,
  "intention": "Закончить PR #42"
}
```

**Ответ 200:**
```json
{
  "ok": true,
  "data": {
    "id": 123,
    "local_date": "2026-07-30",
    "created_at": 1722350400,
    "updated_at": 1722350400
  }
}
```

## q3. POST /api/surveys/evening

Сохранение / обновление вечернего опроса.

**Запрос:**
```json
{
  "date": "2026-07-30",
  "smoked_count": 2,
  "ate_sugar": "yes",
  "did_sport": true,
  "sport_note": "Пробежка 30 мин",
  "mood_evening": 3,
  "best_memory": "Хороший разговор с Л."
}
```

**Ответ 200:** аналогично q2.

## q4. Валидация (на сервере)

| Поле | Правило |
|---|---|
| `date` | `YYYY-MM-DD`, валидная дата, не дальше +1 дня и не раньше -7 дней от `now_user_local` |
| `sleep_hours` | number, 0 ≤ x ≤ 14, шаг 0.5 (с точностью до float) |
| `sleep_quality` | integer, 1..5 |
| `mood_morning` | integer, 1..5 |
| `intention` | string, ≤ 200 символов после trim, NULL/"" допустим |
| `smoked_count` | integer, 0..50 |
| `ate_sugar` | enum: `yes` \| `no` \| `unsure` |
| `did_sport` | boolean |
| `sport_note` | string ≤ 100, NULL/"" допустим, **обязателен** если `did_sport=true`? — нет, опционален всегда |
| `mood_evening` | integer, 1..5 |
| `best_memory` | string ≤ 300, NULL/"" допустим |

Невалидное тело — `400` с `error.code = "VALIDATION"`.

## q5. GET /api/history?days=7

Получение списка дней с записями.

**Query:**
- `days` — integer ∈ {7, 30, -1}. `-1` = всё.

**Ответ 200:**
```json
{
  "ok": true,
  "data": {
    "days": [
      {
        "date": "2026-07-30",
        "morning": { "id": 1, "sleep_hours": 7.5, "sleep_quality": 4, "mood_morning": 4, "intention": "..." },
        "evening": { "id": 5, "smoked_count": 0, "ate_sugar": "no", "did_sport": true, "sport_note": null, "mood_evening": 4, "best_memory": "..." }
      },
      {
        "date": "2026-07-29",
        "morning": { "...": "..." },
        "evening": null
      }
    ]
  }
}
```

Ответ включает **все дни в запрошенном окне**, в т.ч. пустые (`morning: null, evening: null`) — это требование US-08 q6.

## q6. POST /api/settings

Обновление настроек пользователя.

**Запрос:**
```json
{
  "morning_hour_minute": "08:30",
  "evening_hour_minute": "22:15",
  "timezone": "Europe/Moscow"
}
```

**Ответ 200:**
```json
{
  "ok": true,
  "data": {
    "morning_hour_minute": "08:30",
    "evening_hour_minute": "22:15",
    "timezone": "Europe/Moscow"
  }
}
```

Валидация:
- `morning_hour_minute` — `^([0-1][0-9]|2[0-3]):[0-5][0-9]$`, в окне 04:00–11:59.
- `evening_hour_minute` — аналогично, в окне 18:00–23:59.
- `timezone` — строка из списка в `03-features/settings.md#q4`.

## q7. GET /api/settings

Возвращает текущие настройки (для гидратации UI на старте).

**Ответ 200:** аналогично `data` из q6 + `defaults_applied: boolean` (true, если пользователь ещё не менял настройки — т.е. всё дефолт).

## q8. GET /api/health

Liveness / readiness. **Без** авторизации.

**Ответ 200:**
```json
{ "ok": true, "data": { "status": "ok", "uptime_sec": 12345, "db_ok": true } }
```

## q9. Аутентификация (общий вид)

Каждый запрос Mini App содержит заголовок:
```
X-Telegram-Init-Data: <значение из window.Telegram.WebApp.initData>
```

Бэкенд:
1. Парсит query-string из `initData`.
2. Проверяет подпись HMAC-SHA256 с ключом `sha256(BOT_TOKEN)` (см. официальную доку Telegram).
3. Проверяет, что `auth_date` не старше 5 минут (защита от replay).
4. Достаёт `user.id` и сравнивает с `OWNER_TELEGRAM_ID` из `.env` (single-user whitelist).
5. Если всё ок — создаёт/обновляет запись в `users` (upsert).

Любой невалидный шаг → 401.

## q10. Статика и SPA fallback

Mini App (фронтенд из `web/dist`) **раздаётся самим Fastify-сервером** через
`@fastify/static`. Это позволяет деплоить одним контейнером и одним процессом
(без отдельного nginx для статики).

### Поведение

- `GET /` — отдаёт `web/dist/index.html`.
- `GET /assets/*` — отдаёт файлы из `web/dist/assets/*` (cache на 1 год, immutable).
- `GET /favicon.ico`, `/robots.txt` и прочие статические файлы из `web/dist/` — отдаются как есть.
- `GET /api/*` — идут в роуты API, **не** в static handler. Caddy проксирует всё равно на api, и api сам разруливает.
- **SPA fallback:** если `GET <любой путь без /api префикса>` не найден в `web/dist` — отдаём `index.html` (для клиентского роутинга). Это нужно, например, для `GET /history` (в URL строке Mini App), `/settings` и т.п.

### Конфигурация

- `STATIC_DIR` env-переменная (по умолчанию `''` — отключено, для дев-режима). В Docker-образе: `STATIC_DIR=/app/web/dist`.
- Если `STATIC_DIR` пустой или не существует — Fastify **не** регистрирует static plugin, всё идёт через обычные роуты (404 если нет).

### Почему не отдельный nginx

- На MVP — лишний контейнер/процесс. Один Fastify отдаёт и API, и статику.
- Caddy **всё равно** проксирует на api — он не знает, что api сам раздаёт статику.
- Если в будущем выделим статику в CDN — поменяем только этот раздел.

## q11. Связанные секции

- `04-data-model.md` — структура таблиц.
- `07-non-functional.md#q3` — детали валидации `initData`.
- `06-ui-states.md` — где эти API вызываются из UI.
