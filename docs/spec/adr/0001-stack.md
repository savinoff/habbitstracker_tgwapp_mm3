# ADR 0001: Стек технологий

> **status:** accepted
> **date:** 2026-07-30
> **last_updated:** 2026-08-01
> **spec_version:** 0.3.1

## Context

Telegram Mini App для трекера привычек. Single-user, self-hosted на VPS пользователя, Docker + Portainer уже установлены. Главные ограничения: минимальные зависимости, минимальный бандл (мобильный интернет, Telegram), минимум движущихся частей в деплое.

## Decision

| Слой | Выбор |
|---|---|
| Mini App frontend | Vanilla JS + Vite + plain CSS |
| Backend runtime | Node.js >= 20 (один контейнер) |
| Web framework | Fastify |
| Database | SQLite (single file, WAL) |
| Telegram bot | `node-telegram-bot-api` |
| Scheduler | in-process `setInterval(60s)` с SQLite lock |
| Containers | Docker + docker-compose (managed by Portainer) |
| Reverse proxy + TLS | Caddy 2 + Let's Encrypt (ACME встроен) |
| Deploy | bare git repo + post-receive hook на VPS |
| CI | GitHub Actions (только `spec-check` в v0.1.0) |

## Consequences

### Positive
- Один язык (JS) на бэке и фронте — низкий порог входа.
- SQLite — ноль ops, бэкап одной командой, идеально для одного пользователя.
- Vanilla JS фронт — < 50 КБ бандл после gzip, загрузка в Telegram < 1 секунды.
- Bare-repo + hook — деплой это `git push`, без registry, без CI-сервера.
- Все секреты — в `.env` на VPS, в git не попадают.

### Negative
- Vanilla JS — больше ручного кода, нет готовых UI-компонентов. Для MVP с 3 экранами это приемлемо.
- SQLite — не для multi-tenant. Если продукт станет публичным — миграция на Postgres.
- Bare-repo hook — нет автоматического webhook от GitHub, разработчик триггерит деплой вручную (или добавим webhook в v0.2.0).
- Один контейнер api — scheduler и HTTP в одном процессе. Для нагрузок это плохо; для одного пользователя — норм.

### Neutral
- Fastify выбран вместо Express — лучше DX, встроенная валидация через JSON-schema.
- `node-telegram-bot-api` — не официальная, но де-факто стандарт. Альтернативы (grammY) пересмотрим при v0.2.0.

## Alternatives considered

- **React + Vite** — удобнее для UI, но +30–50 КБ и npm-зависимости. Отвергнут как overkill для 3 экранов.
- **PostgreSQL** — лишний контейнер, лишний backup-процесс. Не нужен при одном пользователе.
- **Python + FastAPI** — нормальный выбор, но Node позволяет шарить типы/утилиты между бэком и фронтом.
- **Webhook deploy от GitHub** — добавляет секрет, нужен публичный endpoint на VPS, риск. Для MVP — overkill, отложено.
- **Watchtower** — лишний контейнер, лишний вектор атаки, а hook и так пересобирает.
- **nginx + certbot** — original spec, replaced because two services (nginx + certbot) and renewal hooks add config surface for a single-service deployment.
- **Traefik** — Docker-native, but its dashboard and metrics are overkill for a single-user app.
- **Cloudflare Tunnel** — zero open ports, but adds dependency on a third-party service.

## Notes

При появлении multi-user (v0.2.0+) — пересмотреть SQLite → Postgres, Fastify → остаётся, scheduler — вынести в отдельный контейнер.
