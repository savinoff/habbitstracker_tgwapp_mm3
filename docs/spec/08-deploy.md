# 08. Deploy

> **spec_version:** 0.2.0
> **status:** draft
> **last_updated:** 2026-07-31

## q1. Целевая среда

- VPS пользователя (Ubuntu 22.04 или Debian 12).
- Docker + Docker Compose Plugin установлены.
- Portainer установлен и доступен (управление стэками).
- Домен привязан к IP VPS, A-запись указывает на сервер.
- TLS-сертификат — Let's Encrypt, выдаётся и обновляется автоматически (Caddy).

## q2. Архитектура

```
   Internet
      │  HTTPS (TCP 80/443)
      ▼
 ┌────────────┐
 │   Caddy    │  (контейнер caddy:2-alpine, ACME + reverse proxy)
 │  :80, :443 │
 └─────┬──────┘
       │
       ├── /             →  api (Fastify, :3000 внутри) — отдаёт и статику web/dist, и /api
       └── /api/, /webhook/  →  api (тот же :3000)
                                │
                                ▼
                          /var/lib/habitstracker/habits.db
                                │
                                ▼
                          /var/backups/habitstracker/  ← cron
```

Два сервиса в `docker-compose.deploy.yml`:
- `caddy` — reverse proxy + ACME (Let's Encrypt) + раздача web/dist через проксирование на api.
- `api` — Node Fastify приложение, обслуживает и статику, и API.

Третий «сервис» — bare git-репозиторий + post-receive hook (см. q4).

## q3. Тома (volumes)

| Где | Что | Зачем |
|---|---|---|
| `/var/lib/habitstracker` | `habits.db` + `habits.db-wal` + `habits.db-shm` | данные |
| `/var/backups/habitstracker` | `habits-YYYY-MM-DD.db` | бэкапы |
| `/srv/habitstracker` | bare git repo | деплой |
| `/opt/habitstracker` | work tree с checkout'ом | деплой |
| `caddy_data` (named volume) | `/data` внутри контейнера Caddy — сертификаты, конфиг | ACME state |
| `caddy_config` (named volume) | `/config` внутри контейнера Caddy | admin API state |

В `docker-compose.deploy.yml` бинд-маунты `/var/lib` и `/var/backups` примонтированы к api. Caddy-сертификаты лежат в named volume `caddy_data` (не в git, не в репозитории).

## q4. Деплой по git push

На VPS (один раз):
```bash
mkdir -p /srv/habitstracker && cd /srv/habitstracker
git init --bare
git symbolic-ref HEAD refs/heads/main
```

В `hooks/post-receive`:
```bash
#!/bin/sh
GIT_WORK_TREE=/opt/habitstracker git checkout -f main
cd /opt/habitstracker
docker compose -f docker-compose.deploy.yml --env-file .env pull
docker compose -f docker-compose.deploy.yml --env-file .env build
docker compose -f docker-compose.deploy.yml --env-file .env up -d
```

Сделать `chmod +x hooks/post-receive`.

**Поток:**
1. Разработчик (Mavis) пушит в `main` (через PR, после ревью).
2. GitHub webhook → VPS bare repo → срабатывает `post-receive`.
3. Hook чекаутит код в `/opt/habitstracker/`, пересобирает образ, перезапускает контейнер.

Для v0.2.0 webhook **не** настраиваем — пользователь делает `ssh user@vps 'cd /srv/habitstracker && git pull'` (или запускает Portainer redeploy вручную). Это упрощает MVP. Webhook добавим позже (ADR или новый раздел).

## q5. Резервное копирование

Cron на хосте (не в контейнере):
```
# /etc/cron.d/habitstracker-backup
0 4 * * * root /opt/habitstracker/scripts/backup.sh >> /var/log/habitstracker-backup.log 2>&1
```

Скрипт `/opt/habitstracker/scripts/backup.sh`:
- Делает атомарный snapshot `habits.db` (через `sqlite3 .backup` или fallback на `better-sqlite3` через node).
- Сохраняет в `/var/backups/habitstracker/habits-YYYY-MM-DD.db`.
- Retention 30 дней (см. `scripts/backup.sh`).

Установка: `sudo /opt/habitstracker/scripts/install-backup-cron.sh`.

## q6. Локальная разработка

- `docker compose -f docker-compose.dev.yml up` — поднимает только api + web (без Caddy).
- `npm run dev` в `web/` — Vite dev-сервер с HMR.
- Telegram Mini App в dev-режиме подключается через `ngrok` (или другой туннель) — к домену, на который зарегистрирован бот.

## q7. Branch protection на GitHub

Настраивается на `main`:
- ✅ Require a pull request before merging.
- ✅ Require approvals: 1 (пока один разработчик — это self-approve через re-review; для начала можно 0).
- ✅ Require status checks to pass before merging: `spec-check`.
- ✅ Require linear history (запрет merge commits).
- ✅ Include administrators (запрет force push даже владельцу).
- ✅ Allow force pushes: false.
- ✅ Allow deletions: false.

## q8. CI: GitHub Actions

Файл `.github/workflows/spec-check.yml`:
- Триггер: `pull_request` в `main`, `push` в `main`, `workflow_dispatch`.
- Шаги:
  1. `actions/checkout@v4`.
  2. `actions/setup-node@v4` with `node-version: 20`.
  3. `npm ci` (после добавления `package.json` в репо).
  4. `node scripts/spec-check.js` — падает, если код ссылается на несуществующие секции ТЗ.
  5. `node scripts/test-db.js` — атомарность миграций.
  6. `node scripts/test-initdata.js` — HMAC-валидация initData.
  7. `node scripts/test-bot.js` — обработчики бота.
  8. `node scripts/test-scheduler.js` — scheduler tick.

Дополнительно (можно добавить в v0.3.0):
- Линтинг `web/`, `server/`.
- E2E через headless-браузер.

## q9. Переменные окружения

`.env` (на VPS, **не** в git):
```
TELEGRAM_BOT_TOKEN=...           # от @BotFather
OWNER_TELEGRAM_ID=...            # ваш telegram id (число)
APP_BASE_URL=https://your-domain # FQDN, должен совпадать с ACME-сертификатом
WEBHOOK_URL=https://your-domain/webhook/telegram # опционально, для webhook-режима бота
TZ=UTC                           # TZ контейнера (для логов)
CADDY_EMAIL=you@example.com      # email для ACME-регистрации (уведомления о сроке)
```

`.env.example` (в git, без значений):
```
TELEGRAM_BOT_TOKEN=
OWNER_TELEGRAM_ID=
APP_BASE_URL=
WEBHOOK_URL=
TZ=UTC
CADDY_EMAIL=
```

**Важно:** Caddyfile ссылается на домен через `{$APP_BASE_URL}` или прямой FQDN, заданный в `Caddyfile`. На MVP домен жёстко прописан в `Caddyfile` — смена домена требует изменения Caddyfile и пересборки. Альтернатива: использовать шаблон Caddyfile с подстановкой `${APP_BASE_URL}` через `envsubst` — добавим, если потребуется.

## q10. Health-check

`GET /api/health` — используется Docker healthcheck контейнера api.
- `interval: 30s`, `timeout: 3s`, `retries: 3`.
- Если 3 раза подряд не 200 — Docker помечает контейнер unhealthy.
- Caddy **не** проксирует health-check на api в общем виде — он отдаёт её как обычный API-запрос, что для нашего use-case нормально (api уже auth-free для `/api/health`).

## q11. Caddyfile

Файл `nginx/Caddyfile` (NB: имя каталога сохранено для совместимости с историей, но содержит Caddyfile):
```
{$APP_BASE_URL} {
  encode zstd gzip
  reverse_proxy api:3000
}
```

Caddy при старте автоматически:
- ACME-регистрация через Let's Encrypt (email из `CADDY_EMAIL`).
- Получает сертификат для `APP_BASE_URL`.
- Обновляет его автоматически (cron внутри Caddy).
- Проксирует весь трафик на api:3000.

## q12. Связанные секции

- `07-non-functional.md#q6` — бэкапы.
- `07-non-functional.md#q7` — секреты.
- `00-vision.md#q9` — общая структура репо.
- `adr/0001-stack.md` — выбор Caddy как reverse proxy.
