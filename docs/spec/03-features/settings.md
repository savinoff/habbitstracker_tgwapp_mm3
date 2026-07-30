# Feature: Настройки (settings)

> **spec_version:** 0.1.0
> **status:** draft
> **last_updated:** 2026-07-30

## q1. Назначение

Экран настроек приложения. Позволяет менять время напоминаний, часовой пояс, сбрасывать на дефолтные.

## q2. Поля

| # | Поле | Тип | Дефолт | Ограничения |
|---|---|---|---|---|
| 1 | `morning_hour_minute` | string `HH:MM` | `09:00` | в окне 04:00–12:00 |
| 2 | `evening_hour_minute` | string `HH:MM` | `21:00` | в окне 18:00–23:59 |
| 3 | `timezone` | IANA TZ string | детект из Telegram `initData` или UTC | из фиксированного списка (см. q4) |
| 4 | `reset_button` | action | — | сбрасывает 1 и 2 на дефолт, НЕ меняет 3 |

## q3. Часовой пояс

- Источник по умолчанию: Telegram WebApp SDK предоставляет `initUnsafePayload.user.language_code` и можно взять из клиента `Intl.DateTimeFormat().resolvedOptions().timeZone`. Сервер берёт последний при первом запуске, **но** пользователь может переопределить вручную.
- При смене TZ — все будущие напоминания и фильтры истории (если бы были по TZ) считаются в новом поясе. Прошлые записи не пересчитываются (см. `03-features/reminders.md#q7`).

## q4. Список часовых поясов

В v0.1.0 — фиксированный короткий список популярных (≈ 20 штук), не полный IANA. Полный список тяжёл для UI, а пользователю он не нужен. Список:

```
UTC
Europe/Moscow
Europe/Kaliningrad
Europe/Samara
Europe/Kiev
Europe/Minsk
Europe/London
Europe/Berlin
Europe/Paris
Asia/Yekaterinburg
Asia/Novosibirsk
Asia/Krasnoyarsk
Asia/Irkutsk
Asia/Yakutsk
Asia/Vladivostok
Asia/Magadan
Asia/Kamchatka
Asia/Almaty
Asia/Tashkent
Asia/Tbilisi
Asia/Yerevan
America/New_York
America/Los_Angeles
```

Если нужно что-то ещё — пользователь может поменять TZ через переменную окружения `USER_TIMEZONE` на VPS, перезапустить контейнер, и всё (для v0.1.0 это техническая escape-hatch).

## q5. Сохранение

- POST `/api/settings` с телом `{morning_hour_minute, evening_hour_minute, timezone}`.
- Атомарно: либо все три обновились, либо ни одно.
- После сохранения — пользователь видит «Сохранено ✓» и возвращается на главный экран.

## q6. Связанные секции

- `03-features/reminders.md#q2` — где используется время.
- `04-data-model.md#q2` — таблица `users` (там лежит TZ) и `user_settings` (время напоминаний).
- `05-api.md#q6` — контракт API.
