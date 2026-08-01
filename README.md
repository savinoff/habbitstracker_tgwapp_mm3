# HabitsTracker

Telegram Mini App — личный трекер привычек. Два опроса в день (утро + вечер), напоминания от бота, история, всё на своём VPS, никаких внешних сервисов.

![spec](https://img.shields.io/badge/spec-0.3.2-blue)
![status](https://img.shields.io/badge/license-MIT-green)
![status](https://img.shields.io/badge/deployed-2026--08--01-brightgreen)

## Что это

- 🌅 Утренний опрос: сон, настрой, намерение на день.
- 🌙 Вечерний опрос: курение, сладкое, спорт, состояние, лучшее воспоминание.
- ⏰ Настраиваемые напоминания (утро/вечер) в твоём часовом поясе.
- 📜 История: последние 7 / 30 / все дни.
- 🔒 Single-user, доступ только по валидированному `initData` Telegram.
- 🐳 Деплой одной командой: `git push` → bare-repo hook → Docker.
- 💾 SQLite, бэкап одной строкой.

## Стек

| Слой | Технология |
|---|---|
| Mini App | Vanilla JS + Vite + plain CSS |
| Backend | Node.js 20 + Fastify |
| DB | SQLite (WAL) |
| Bot | `node-telegram-bot-api` |
| Deploy | Docker + bare git repo + post-receive hook |
| CI | GitHub Actions (spec-check) |

См. [ADR 0001](docs/spec/adr/0001-stack.md).

## Структура

```
habitstracker/
├── docs/spec/         # single source of truth — ТЗ
├── server/            # Fastify backend (появится)
├── web/               # Vite Mini App (появится)
├── scripts/           # spec-check.js
├── .github/workflows/ # CI
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

## Quick start (локальная разработка)

```bash
git clone https://github.com/savinoff/habbitstracker_tgwapp_mm3.git
cd habitstracker
cp .env.example .env  # заполнить TELEGRAM_BOT_TOKEN, OWNER_TELEGRAM_ID
docker compose -f docker-compose.yml up        # dev: api + web
# или для production-сборки в одном контейнере:
docker compose -f docker-compose.deploy.yml up -d --build
```

## Quick start (прод-деплой на сервере)

```bash
# На сервере, после setup-vps.sh и заполнения .env:
cd ~/opt/habitstracker
bash scripts/redeploy.sh --logs      # деплой из main
```

## Деплой на VPS

Подробнее — в [docs/spec/08-deploy.md](docs/spec/08-deploy.md). Коротко:

1. **Подготовь VPS** (Ubuntu 22.04+ или Debian 12+):
   ```sh
   apt update && apt install -y docker.io docker-compose-v2 git
   systemctl enable --now docker
   ```

2. **Склонируй репо и настрой bare-repo** (один раз, **под обычным пользователем**):
   ```sh
   # bare-repo в ~/srv, work tree в ~/opt — без sudo
   git clone --bare https://github.com/savinoff/habbitstracker_tgwapp_mm3.git ~/srv/habitstracker.git
   git clone ~/srv/habitstracker.git ~/opt/habitstracker
   # впиши TELEGRAM_BOT_TOKEN, OWNER_TELEGRAM_ID, APP_BASE_URL, CADDY_EMAIL, WEBHOOK_URL в ~/opt/habitstracker/.env
   ```

3. **Установи ежедневный бэкап** (если есть root-доступ):
   ```sh
   sudo apt install -y sqlite3 cron
   bash ~/opt/habitstracker/scripts/install-backup-cron.sh
   ```

4. **Деплой** (с ноута через SSH):
   ```sh
   # на сервере (после клонирования)
   cd ~/opt/habitstracker
   bash scripts/redeploy.sh            # деплой из main
   # или:
   bash scripts/redeploy.sh --branch=feat/xxx
   bash scripts/redeploy.sh --no-build  # только рестарт без пересборки
   bash scripts/redeploy.sh --logs      # показать логи после
   bash scripts/redeploy.sh --help      # все опции
   ```

   **Альтернатива:** настроить bare-repo + post-receive hook, тогда деплой
   через `git push vps main` с ноута. Скрипт `setup-vps.sh` настраивает
   bare-repo с `origin = GitHub`, hook автоматически подтягивает свежий код
   и перезапускает контейнеры. Подробнее — [08-deploy.md#q14](docs/spec/08-deploy.md#q14).

5. **HTTPS — из коробки.** Caddy 2 поднимается в отдельном контейнере, при первом старте получает Let's Encrypt-сертификат для `APP_BASE_URL` (нужны DNS A-record и открытые 80 на VPS) и сам его обновляет. Никаких certbot-хуков.

6. **Если 443 на VPS занят** (X-UI, Outline и т.п.) — Caddy работает на `8443:443`.
   В `APP_BASE_URL` укажи `https://your-domain:8443` (с портом). Подробнее —
   [08-deploy.md#q13](docs/spec/08-deploy.md#q13).

## Спецификация

**Перед написанием кода прочитай [docs/spec/](docs/spec/) — это источник истины.**

Самые важные документы:
- [00-vision.md](docs/spec/00-vision.md) — зачем и для кого.
- [02-user-stories.md](docs/spec/02-user-stories.md) — что делать.
- [04-data-model.md](docs/spec/04-data-model.md) — структура БД.
- [05-api.md](docs/spec/05-api.md) — REST-контракты.
- [08-deploy.md](docs/spec/08-deploy.md) — как развернуть.

## Разработка

Все изменения ТЗ — коммит `docs(spec): ...`, сначала merge в `main`, потом код.

Любой код, реализующий фичу, содержит маркер ссылки на ТЗ:

```js
// spec:03-features/survey-morning.md#q2
function validateMorningSurvey(body) { ... }
```

`scripts/spec-check.js` (в CI) валит PR, если маркер ссылается на несуществующую секцию.

## Безопасность

- Все секреты — в `.env` (в git не попадают).
- Бэк валидирует `initData` от Telegram (HMAC-SHA256) на каждом запросе.
- Whitelist: только `OWNER_TELEGRAM_ID` может заходить.
- HTTPS обязателен.
- Подробности — [07-non-functional.md](docs/spec/07-non-functional.md#q3).

## Бэкап

```bash
# ручной
cp /var/lib/habitstracker/habits.db ~/backup-$(date +%F).db

# или атомарно (даже под нагрузкой)
docker compose exec api sqlite3 /var/lib/habitstracker/habits.db ".backup '/var/backups/habitstracker/habits-$(date +%F).db'"
```

Автоматический ежедневный бэкап — см. [08-deploy.md#q5](docs/spec/08-deploy.md#q5).

## Лицензия

[MIT](LICENSE).
