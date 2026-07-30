# 08. Deploy

> **spec_version:** 0.1.0
> **status:** draft
> **last_updated:** 2026-07-30

## q1. Целевая среда

- VPS пользователя (Ubuntu 22.04 или Debian 12).
- Docker + Docker Compose Plugin установлены.
- Portainer установлен и доступен (управление стэками).
- Домен привязан к IP VPS, A-запись указывает на сервер.
- TLS-сертификат — Let's Encrypt, обновляется автоматически.

## q2. Архитектура

```
   Internet
      │  HTTPS
      ▼
 ┌────────────┐
 │  Nginx     │  (контейнер nginx:alpine, серт от Let's Encrypt)
 │  :80, :443 │
 └─────┬──────┘
       │
       ├── /             →  web (статика Vite-билда)
       └── /api/, /webhook/  →  api (Fastify, :3000 внутри)
                                │
                                ▼
                          /var/lib/habitstracker/habits.db
                                │
                                ▼
                          /var/backups/habitstracker/  ← cron
```

Два сервиса в `docker-compose.yml`:
- `nginx` — reverse proxy + TLS termination + раздача `web/`.
- `api` — Node Fastify приложение, знает про Telegram, ходит в SQLite, шлёт напоминания.

Третий «сервис» — bare git-репозиторий + post-receive hook, см. q4.

## q3. Тома (volumes)

| Где | Что | Зачем |
|---|---|---|
| `/var/lib/habitstracker` | `habits.db` + `habits.db-wal` + `habits.db-shm` | данные |
| `/var/backups/habitstracker` | `habits-YYYY-MM-DD.db` | бэкапы |
| `/etc/letsencrypt` | сертификаты (если certbot в отдельном контейнере) | TLS |
| `/srv/habitstracker` | bare git repo | деплой |

В `docker-compose.yml` все они монтируются как `:ro` или `:rw` явно.

## q4. Деплой по git push

На VPS:
```bash
# один раз
mkdir -p /srv/habitstracker && cd /srv/habitstracker
git init --bare
git symbolic-ref HEAD refs/heads/main
```

В `hooks/post-receive`:
```bash
#!/bin/sh
GIT_WORK_TREE=/opt/habitstracker git checkout -f main
cd /opt/habitstracker
docker compose pull
docker compose build
docker compose up -d
```

Сделать `chmod +x hooks/post-receive`.

**Поток:**
1. Разработчик (Mavis) пушит в `main` (через PR, после ревью).
2. GitHub webhook → VPS bare repo → срабатывает `post-receive`.
3. Hook чекаутит код в `/opt/habitstracker/`, пересобирает образ, перезапускает контейнер.

Для v0.1.0 webhook **не** настраиваем — пользователь делает `ssh user@vps 'cd /srv/habitstracker && git pull'` (или запускает Portainer redeploy вручную). Это упрощает MVP. Webhook добавим позже (ADR или новый раздел).

## q5. Резервное копирование

Cron на хосте (не в контейнере):
```
# /etc/cron.d/habitstracker-backup
0 4 * * * root /usr/local/bin/habitstracker-backup.sh
```

Скрипт `/usr/local/bin/habitstracker-backup.sh`:
```bash
#!/bin/sh
set -e
TS=$(date +%F)
SRC=/var/lib/habitstracker/habits.db
DST=/var/backups/habitstracker/habits-${TS}.db
docker compose -f /opt/habitstracker/docker-compose.yml exec -T api \
  sqlite3 /var/lib/habitstracker/habits.db ".backup '/var/backups/habitstracker/habits-${TS}.db'"
# retention 30 дней
find /var/backups/habitstracker -name 'habits-*.db' -mtime +30 -delete
```

## q6. Локальная разработка

- `docker compose -f docker-compose.dev.yml up` — поднимает только api + web (без nginx).
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
- Триггер: `pull_request` в `main`, `push` в `main`.
- Шаги:
  1. `actions/checkout@v4`.
  2. `actions/setup-node@v4` with `node-version: 20`.
  3. `npm ci` (после добавления `package.json` в репо).
  4. `node scripts/spec-check.js` — падает, если код ссылается на несуществующие секции ТЗ.

Дополнительно (можно добавить в v0.2.0):
- Линтинг `web/`, `server/`.
- Тесты.

## q9. Переменные окружения

`.env` (на VPS, **не** в git):
```
TELEGRAM_BOT_TOKEN=...           # от @BotFather
OWNER_TELEGRAM_ID=...            # ваш telegram id (число)
WEBHOOK_URL=https://your-domain/webhook/telegram
APP_BASE_URL=https://your-domain
TZ=UTC                           # TZ контейнера (для логов)
```

`.env.example` (в git, без значений):
```
TELEGRAM_BOT_TOKEN=
OWNER_TELEGRAM_ID=
WEBHOOK_URL=
APP_BASE_URL=
TZ=UTC
```

## q10. Health-check

`GET /api/health` — используется Portainer'ом / Docker healthcheck.
- `interval: 30s`, `timeout: 3s`, `retries: 3`.
- Если 3 раза подряд не 200 — Portainer помечает контейнер unhealthy.

## q11. Связанные секции

- `07-non-functional.md#q6` — бэкапы.
- `07-non-functional.md#q7` — секреты.
- `00-vision.md#q9` — общая структура репо.
