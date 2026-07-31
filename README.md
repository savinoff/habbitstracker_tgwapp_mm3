# HabitsTracker

Telegram Mini App — личный трекер привычек. Два опроса в день (утро + вечер), напоминания от бота, история, всё на своём VPS, никаких внешних сервисов.

![status](https://img.shields.io/badge/spec-0.1.0-blue)
![status](https://img.shields.io/badge/license-MIT-green)
![status](https://img.shields.io/badge/mvp-in%20progress-orange)

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

## Quick start (после реализации кода)

```bash
git clone https://github.com/savinoff/habbitstracker_tgwapp_mm3.git
cd habitstracker
cp .env.example .env  # заполнить TELEGRAM_BOT_TOKEN, OWNER_TELEGRAM_ID
docker compose up -d
```

## Деплой на VPS

Подробнее — в [docs/spec/08-deploy.md](docs/spec/08-deploy.md). Коротко:

1. **Подготовь VPS** (Ubuntu 22.04+ или Debian 12+):
   ```sh
   apt update && apt install -y docker.io docker-compose-v2 git
   systemctl enable --now docker
   ```

2. **Склонируй репо и настрой bare-repo** (один раз):
   ```sh
   sudo /opt/habitstracker/scripts/setup-vps.sh
   # впиши TELEGRAM_BOT_TOKEN, OWNER_TELEGRAM_ID, APP_BASE_URL, WEBHOOK_URL в /opt/habitstracker/.env
   ```

3. **Установи ежедневный бэкап**:
   ```sh
   sudo apt install -y sqlite3 cron
   sudo /opt/habitstracker/scripts/install-backup-cron.sh
   ```

4. **Деплой через `git push`**:
   ```sh
   # локально:
   git remote add vps ssh://user@vps.example/srv/habitstracker
   git push vps main
   # на VPS автоматически: checkout → build → up -d
   ```

5. **HTTPS** — настрой nginx + Let's Encrypt (см. README, issue #15).

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
