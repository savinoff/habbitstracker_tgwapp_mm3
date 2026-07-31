#!/bin/bash
# scripts/setup-vps.sh
# Первоначальная настройка VPS для деплоя HabitsTracker через bare-repo + hook.
#
# Запускать ОДИН РАЗ на свежем VPS от root. Идемпотентен — повторный запуск
# не ломает, но и не пересоздаёт bare-репо (там могут быть ваши push'и).
#
# Что делает:
#   1. Создаёт bare git repo в /srv/habitstracker (push-приёмник).
#   2. Создаёт work tree в /opt/habitstracker (сюда checkout'ится main).
#   3. Копирует hooks/post-receive в bare repo.
#   4. Создаёт /var/lib/habitstracker (данные SQLite, бинд-маунт).
#   5. Создаёт /var/backups/habitstracker (для cron-бэкапа).
#   6. Первый clone репо в /opt/habitstracker.
#   7. Проверяет наличие docker / docker compose.
#
# После успешного выполнения:
#   git remote add vps ssh://USER@VPS/srv/habitstracker
#   git push vps main
# Hook автоматически соберёт и запустит контейнер.
#
# spec:08-deploy.md#q1..q4

set -euo pipefail

REPO_URL="https://github.com/savinoff/habbitstracker_tgwapp_mm3.git"
BRANCH="${HABITSTRACKER_BRANCH:-main}"
VPS_USER="${HABITSTRACKER_USER:-deploy}"

# Куда ставим.
BARE_DIR="/srv/habitstracker"
WORK_DIR="/opt/habitstracker"
DATA_DIR="/var/lib/habitstracker"
BACKUP_DIR="/var/backups/habitstracker"

# ─── sanity checks ───
if [ "$(id -u)" -ne 0 ]; then
  echo "❌ This script must run as root (sudo $0)"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ docker is not installed. Install Docker first:"
  echo "   https://docs.docker.com/engine/install/"
  exit 1
fi

# docker compose v2 — это подкоманда.
if ! docker compose version >/dev/null 2>&1; then
  echo "❌ 'docker compose' (v2) is not available. Install docker-compose-plugin."
  exit 1
fi

# ─── 1. Bare git repo ───
if [ -d "$BARE_DIR" ]; then
  echo "✓ Bare repo already exists at $BARE_DIR — skipping init."
else
  echo "→ Creating bare repo at $BARE_DIR"
  mkdir -p "$BARE_DIR"
  git init --bare "$BARE_DIR"
  git -C "$BARE_DIR" symbolic-ref HEAD "refs/heads/$BRANCH"
fi

# ─── 2. Hook ───
HOOK_SRC="$(cd "$(dirname "$0")/.." && pwd)/hooks/post-receive"
HOOK_DST="$BARE_DIR/hooks/post-receive"
if [ ! -f "$HOOK_SRC" ]; then
  echo "❌ Hook source not found: $HOOK_SRC"
  exit 1
fi
echo "→ Installing post-receive hook"
cp "$HOOK_SRC" "$HOOK_DST"
chmod +x "$HOOK_DST"

# ─── 3. Work tree + initial clone ───
if [ -d "$WORK_DIR/.git" ]; then
  echo "✓ Work tree already exists at $WORK_DIR — skipping clone."
else
  echo "→ Cloning into $WORK_DIR"
  mkdir -p "$WORK_DIR"
  git clone "$REPO_URL" "$WORK_DIR"
  git -C "$WORK_DIR" checkout "$BRANCH"
fi

# ─── 4. Data + backup dirs ───
echo "→ Creating data/backup directories"
mkdir -p "$DATA_DIR" "$BACKUP_DIR"
chown -R "$VPS_USER:$VPS_USER" "$DATA_DIR" "$BACKUP_DIR" 2>/dev/null || true
chmod 750 "$DATA_DIR" "$BACKUP_DIR"

# ─── 5. .env example ───
if [ ! -f "$WORK_DIR/.env" ] && [ -f "$WORK_DIR/.env.example" ]; then
  echo "→ Copying .env.example → .env (edit before first start!)"
  cp "$WORK_DIR/.env.example" "$WORK_DIR/.env"
  echo "   ⚠️  Edit $WORK_DIR/.env and fill:"
  echo "      - TELEGRAM_BOT_TOKEN"
  echo "      - OWNER_TELEGRAM_ID"
  echo "      - APP_BASE_URL  (https://your-domain)"
  echo "      - WEBHOOK_URL   (https://your-domain/webhook/telegram)"
fi

# ─── 6. First build & start ───
echo "→ Running first build (this may take a few minutes)"
cd "$WORK_DIR"
docker compose -f docker-compose.deploy.yml --env-file .env build
docker compose -f docker-compose.deploy.yml --env-file .env up -d

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit $WORK_DIR/.env with real TELEGRAM_BOT_TOKEN, OWNER_TELEGRAM_ID, APP_BASE_URL, WEBHOOK_URL"
echo "  2. Restart: cd $WORK_DIR && docker compose -f docker-compose.deploy.yml --env-file .env restart"
echo "  3. Set up backups: $WORK_DIR/scripts/install-backup-cron.sh"
echo "  4. Set up HTTPS: see https://github.com/savinoff/habbitstracker_tgwapp_mm3/issues/15 (or follow the README)"
