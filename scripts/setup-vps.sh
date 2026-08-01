#!/bin/bash
# scripts/setup-vps.sh
# Первоначальная настройка VPS для деплоя HabitsTracker через bare-repo + hook.
#
# Запускать ОДИН РАЗ на свежем VPS от **обычного пользователя** (без sudo).
# Если есть root-доступ и хочется держать репо в /srv/habitstracker.git —
# установите HABITSTRACKER_SYSTEM_INSTALL=1 и запустите под root.
#
# Что делает:
#   1. Создаёт bare git repo в ~/srv/habitstracker.git (push-приёмник).
#   2. Создаёт work tree в ~/opt/habitstracker (сюда checkout'ится main).
#   3. Копирует hooks/post-receive в bare repo.
#   4. Копирует .env.example → .env (юзер заполняет руками).
#
# После успешного выполнения:
#   cd ~/opt/habitstracker
#   docker compose -f docker-compose.deploy.yml --env-file .env up -d --build
#
# spec:08-deploy.md#q1..q4, q13

set -euo pipefail

REPO_URL="https://github.com/savinoff/habbitstracker_tgwapp_mm3.git"
BRANCH="${HABITSTRACKER_BRANCH:-main}"

# Куда ставим. По умолчанию — в домашнюю директорию (без sudo).
# Если HABITSTRACKER_SYSTEM_INSTALL=1 и есть root — ставим в /srv и /opt.
if [ "${HABITSTRACKER_SYSTEM_INSTALL:-0}" = "1" ] && [ "$(id -u)" -eq 0 ]; then
  BARE_DIR="/srv/habitstracker.git"
  WORK_DIR="/opt/habitstracker"
  VPS_USER="${HABITSTRACKER_USER:-deploy}"
else
  BARE_DIR="$HOME/srv/habitstracker.git"
  WORK_DIR="$HOME/opt/habitstracker"
fi

# ─── sanity checks ───
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

# Проверим, что мы в группе docker (а не root).
if [ "$(id -u)" -ne 0 ]; then
  if ! id -nG | grep -qw docker; then
    echo "❌ User $(whoami) is not in 'docker' group. Add with:"
    echo "   sudo usermod -aG docker $(whoami)  # then re-login"
    exit 1
  fi
fi

# ─── 1. Bare git repo ───
if [ -d "$BARE_DIR" ]; then
  echo "✓ Bare repo already exists at $BARE_DIR — skipping init."
else
  echo "→ Creating bare repo at $BARE_DIR"
  mkdir -p "$(dirname "$BARE_DIR")"
  git clone --bare "$REPO_URL" "$BARE_DIR"
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
  mkdir -p "$(dirname "$WORK_DIR")"
  git clone "$BARE_DIR" "$WORK_DIR"
  git -C "$WORK_DIR" checkout "$BRANCH"
fi

# ─── 4. .env example ───
if [ ! -f "$WORK_DIR/.env" ] && [ -f "$WORK_DIR/.env.example" ]; then
  echo "→ Copying .env.example → .env (edit before first start!)"
  cp "$WORK_DIR/.env.example" "$WORK_DIR/.env"
  chmod 600 "$WORK_DIR/.env"
  echo "   ⚠️  Edit $WORK_DIR/.env and fill:"
  echo "      - TELEGRAM_BOT_TOKEN  (от @BotFather)"
  echo "      - OWNER_TELEGRAM_ID   (ваш telegram id, число)"
  echo "      - APP_BASE_URL        (https://f.xdvs.ru или https://f.xdvs.ru:8443)"
  echo "      - CADDY_EMAIL         (email для ACME/Let's Encrypt)"
  echo "      - WEBHOOK_URL         (https://f.xdvs.ru/webhook/telegram, опционально)"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit $WORK_DIR/.env with real values"
echo "  2. First start:"
echo "       cd $WORK_DIR"
echo "       docker compose -f docker-compose.deploy.yml --env-file .env up -d --build"
echo "  3. Verify health:"
echo "       docker ps  # should show 'healthy' for habitstracker-api"
echo "       curl -skI https://f.xdvs.ru:8443/api/health  # should be 200"
echo "  4. Set up backups: bash $WORK_DIR/scripts/install-backup-cron.sh (if you have root)"
echo "  5. Set up Mini App URL in @BotFather"
