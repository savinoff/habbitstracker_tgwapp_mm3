# 08. Deploy

> **spec_version:** 0.3.1
> **status:** draft
> **last_updated:** 2026-08-01

## q1. Целевая среда

- VPS пользователя (Ubuntu 22.04+ или Debian 12+).
- Docker + Docker Compose Plugin установлены.
- Portainer установлен и доступен (управление стэками).
- Домен привязан к IP VPS, A-запись указывает на сервер.
- TLS-сертификат — Let's Encrypt, выдаётся и обновляется автоматически (Caddy).
- **v0.3.0:** Если на хосте уже занят порт 443 другим сервисом (например, X-UI,
  Outline, nginx от провайдера) — Caddy работает на нестандартном внешнем
  порту `8443` (внутри контейнера — стандартный 443). Подробнее в q13.

## q2. Архитектура

```
   Internet
      │  HTTPS (TCP 80, 8443* или 443**)
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

\* **v0.3.0:** Внешний порт `8443` (вместо 443) — для случая, когда 443 на хосте
уже занят другим сервисом (X-UI, Outline, провайдерский nginx).
Внутри контейнера Caddy слушает на стандартном 443.
\** Если 443 на хосте свободен — проброс идёт `443:443` (поведение v0.2.0).

Два сервиса в `docker-compose.deploy.yml`:
- `caddy` — reverse proxy + ACME (Let's Encrypt) + раздача web/dist через проксирование на api.
- `api` — Node Fastify приложение, обслуживает и статику, и API.

Третий «сервис» — bare git-репозиторий + post-receive hook (см. q4).

## q3. Тома (volumes)

| Где | Что | Зачем |
|---|---|---|
| `/var/lib/habitstracker` | `habits.db` + `habits.db-wal` + `habits.db-shm` | данные |
| `/var/backups/habitstracker` | `habits-YYYY-MM-DD.db` | бэкапы |
| `~/srv/habitstracker.git` | bare git repo | деплой |
| `~/opt/habitstracker` | work tree с checkout'ом | деплой |
| `~/backups` (опционально) | локальные бэкапы если нет доступа к `/var/backups` | бэкапы |
| `caddy_data` (named volume) | `/data` внутри контейнера Caddy — сертификаты, конфиг | ACME state |
| `caddy_config` (named volume) | `/config` внутри контейнера Caddy | admin API state |

В `docker-compose.deploy.yml` бинд-маунты `/var/lib` и `/var/backups` примонтированы к api. Caddy-сертификаты лежат в named volume `caddy_data` (не в git, не в репозитории).

**v0.3.0:** Каталоги bare-repo и work tree по умолчанию лежат в `~` пользователя
(не `/srv` / `/opt`). Это снимает требование sudo для деплоя. Если у пользователя
есть root-доступ и хочется держать репо в `/srv/habitstracker.git` — это допустимо,
но не обязательно. Скрипты `setup-vps.sh` / `post-receive` ищут `~/srv` первым.

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
APP_BASE_URL=https://your-domain # FQDN, должен совпадать с ACME-сертификатом.
                                 # v0.3.0: если Caddy на нестандартном порту 8443,
                                 # APP_BASE_URL ДОЛЖЕН включать порт:
                                 # APP_BASE_URL=https://your-domain:8443
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

**Важно:** Caddyfile получает домен через `{$APP_BASE_URL}` (envsubst в entrypoint).
Смена домена не требует пересборки образа — достаточно перезапустить контейнер
(`docker compose up -d`). Это поведение v0.2.0 (шаблон Caddyfile + envsubst),
сохраняется в v0.3.0.

**v0.3.0:** `APP_BASE_URL` теперь **влияет** на `docker-compose.deploy.yml`
через переменную `APP_BASE_URL` (опционально, для автоматического выбора
проброса порта — см. q13). На MVP `docker-compose.deploy.yml` пробрасывает
`8443:443` всегда, а `APP_BASE_URL` указывает на полный URL с портом.

## q10. Health-check

`GET /api/health` — используется Docker healthcheck контейнера api.
- `interval: 30s`, `timeout: 3s`, `retries: 3`.
- Если 3 раза подряд не 200 — Docker помечает контейнер unhealthy.
- Caddy **не** проксирует health-check на api в общем виде — он отдаёт её как обычный API-запрос, что для нашего use-case нормально (api уже auth-free для `/api/health`).

## q11. Caddyfile

Файл `caddy/Caddyfile.tpl` (шаблон, подстановка через `envsubst` в entrypoint):
```
{
	email {$CADDY_EMAIL}
}

{$APP_BASE_URL} {
	encode zstd gzip
	reverse_proxy api:3000
}
```

Caddy при старте автоматически:
- ACME-регистрация через Let's Encrypt (email из `CADDY_EMAIL`).
- Получает сертификат для хоста из `APP_BASE_URL` (FQDN без протокола, порт не нужен — порт относится к сетевому слою, не к сертификату).
- Обновляет его автоматически (cron внутри Caddy).
- Проксирует весь трафик на api:3000.

**v0.3.0:** `APP_BASE_URL` парсится в entrypoint.sh: протокол `https://` и trailing
slash отрезаются, остаётся только FQDN. Порт `:8443` (если есть) отрезается для
Caddyfile, но сохраняется в `APP_BASE_URL` для использования ботом и webhook'ом.

## q12. Связанные секции

- `07-non-functional.md#q6` — бэкапы.
- `07-non-functional.md#q7` — секреты.
- `00-vision.md#q9` — общая структура репо.
- `adr/0001-stack.md` — выбор Caddy как reverse proxy.

## q13. Нестандартный внешний порт (v0.3.0)

### Зачем

В некоторых средах порт 443 на хосте уже занят — например:
- X-UI / 3x-ui (панель для Xray/VLESS/VMess прокси).
- Outline Shadowbox (VPN).
- Провайдерский nginx для control panel.
- Другой web-сервис пользователя.

Убивать чужой процесс нельзя. Решение — пробросить **Caddy** на нестандартный
порт снаружи (`8443`), а **внутри контейнера** оставить стандартный 443.

### Как это работает

`docker-compose.deploy.yml`:
```yaml
  caddy:
    ports:
      - "80:80"      # для ACME HTTP-01 challenge
      - "8443:443"   # Caddy слушает 443 внутри, наружу — 8443
```

### ACME через HTTP-01

Caddy при получении сертификата делает HTTP-01 challenge через порт 80:
- Let's Encrypt шлёт запрос на `http://<host>/.well-known/acme-challenge/<token>`.
- Порт 80 пробрасывается (`80:80`) — challenge проходит.
- Сертификат выдаётся на **FQDN без порта** (`:8443` к сертификату отношения не имеет).

То есть для ACME:
- Caddyfile: `<host>` (без `:8443`).
- Сертификат: на `<host>`.
- URL приложения: `https://<host>:8443`.

### Поведение в @BotFather

URL Mini App в @BotFather: `https://f.xdvs.ru:8443` (с портом).

Telegram принимает URL с портом в Bot API. Mini App открывается в WebView
Telegram-клиента, который поддерживает нестандартные порты. На 2026 год
работает в iOS/Android/Desktop. Старые версии клиентов (до 2024) могут
не открыть — но это редкость.

### Альтернативы (не реализованы в v0.3.0)

- **Cloudflare в front.** Перенести NS-записи на Cloudflare, включить
  проксирование (оранжевое облачко), SSL/TLS → Flexible. Тогда 443 не
  нужен, Caddy слушает только 80, Cloudflare выдаёт универсальный сертификат.
  Trade-off: трафик идёт через Cloudflare (задержка ~20-50 мс).
- **X-UI inbound → Caddy.** Настроить в X-UI проксирование с 443 на
  `127.0.0.1:8443` (Caddy). Тогда URL остаётся стандартный `https://f.xdvs.ru`,
  X-UI терминирует TLS. Trade-off: больше конфигурации, X-UI должен поддерживать
  ACME или иметь свой валидный сертификат.

### Диагностика

Если сертификат Let's Encrypt не получен:
```sh
docker logs habitstracker-caddy 2>&1 | grep -iE "(certificate|acme|challenge|error)"
# Типичные ошибки:
#  - "port 80 is not accessible" — UFW блокирует 80
#  - "DNS problem" — A-запись не указывает на IP
#  - "rate limit" — слишком много попыток за последний час
```

Если ошибка в UFW:
```sh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload
```

## q14. Deploy workflow (v0.3.0)

### Три способа задеплоить

**A. `scripts/redeploy.sh` (ручной, рекомендуемый для разработки)**

На сервере, в work tree:
```sh
cd ~/opt/habitstracker
~/opt/habitstracker/scripts/redeploy.sh            # деплой из main
~/opt/habitstracker/scripts/redeploy.sh --branch=feat/xxx
~/opt/habitstracker/scripts/redeploy.sh --no-build  # только рестарт
~/opt/habitstracker/scripts/redeploy.sh --logs      # показать логи после
```

Что делает:
1. `git fetch origin` (или указанная ветка).
2. `git reset --hard origin/<branch>`.
3. `docker compose build` (если не `--no-build`).
4. `docker compose up -d`.
5. Ждёт 30 сек, проверяет `/api/health`.

**B. `git push vps main` (через bare-repo + post-receive hook)**

Локально, на ноуте:
```sh
git remote add vps ssh://dim@f.xdvs.ru/srv/habitstracker
git push vps main
```

Что происходит:
1. Push в bare-repo на сервере.
2. Срабатывает `hooks/post-receive` (см. q4).
3. Hook делает `git fetch origin main` (bare-repo знает про GitHub).
4. Hook обновляет work tree в `~/opt/habitstracker`.
5. Hook запускает `docker compose build && up -d`.

**C. GitHub webhook → VPS (для будущего v0.4.0)**

GitHub шлёт POST на `https://f.xdvs.ru:8443/webhook/github` при push в main.
VPS ловит, делает fetch + redeploy. Сейчас **не реализовано** (лишний attack surface,
для single-user — overkill).

### Структура git-репо на сервере

```
~/srv/habitstracker.git   ← bare-repo
   └─ origin = https://github.com/savinoff/habbitstracker_tgwapp_mm3.git
   └─ hooks/post-receive   ← авто-deploy

~/opt/habitstracker       ← work tree
   └─ origin = ~/srv/habitstracker.git  (bare)
   └─ для pull из GitHub: scripts/redeploy.sh (временно переключает origin)
```

`setup-vps.sh` настраивает обе структуры. `origin` для work tree указывает на
bare-repo, а `origin` для **bare-repo** указывает на GitHub. Это позволяет
post-receive hook'у тянуть свежий код из GitHub после каждого push.

### Когда использовать какой способ

| Способ | Когда |
|---|---|
| `redeploy.sh` | Разработка, частые итерации, тестовые ветки |
| `git push vps main` | Деплой из ноута после merged PR в main |
| GitHub webhook | (Будущее) Полная автоматика без участия пользователя |

### Откат

```sh
# Откатить на предыдущий коммит (временно, до следующего redeploy):
cd ~/opt/habitstracker
git log --oneline -5          # найти нужный коммит
git reset --hard <commit-hash>
docker compose -f docker-compose.deploy.yml --env-file .env up -d --build
```

Для постоянного отката — откатить PR на GitHub, потом `redeploy.sh --branch=main`.
