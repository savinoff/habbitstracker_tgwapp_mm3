#!/bin/bash
# scripts/redeploy.sh
# Передеплой HabitsTracker из текущей ветки.
#
# Использование:
#   ./scripts/redeploy.sh                    # деплой из main (origin/main)
#   ./scripts/redeploy.sh --branch=feat/xxx  # деплой из другой ветки
#   ./scripts/redeploy.sh --no-build         # только рестарт, без пересборки
#   ./scripts/redeploy.sh --logs             # после деплоя показать логи
#
# Что делает:
#   1. Подтягивает свежий код из origin (или указанной ветки)
#   2. docker compose build (если не --no-build)
#   3. docker compose up -d
#   4. Ждёт 30 сек, проверяет /api/health
#   5. Показывает логи контейнеров
#
# Требования:
#   - Запускать от пользователя, который:
#     * в группе `docker` (id -nG | grep docker)
#     * может делать `git fetch` в ~/opt/habitstracker
#   - WORK_DIR должен быть work tree с remote origin = GitHub
#
# spec:08-deploy.md#q4 (post-receive hook), q6 (локальная разработка)

set -euo pipefail

# Дефолты
BRANCH="main"
DO_BUILD=1
SHOW_LOGS=0
WORK_DIR="${HABITSTRACKER_WORK_DIR:-$HOME/opt/habitstracker}"
REPO_URL="https://github.com/savinoff/habbitstracker_tgwapp_mm3.git"

# Разбор аргументов
for arg in "$@"; do
  case "$arg" in
    --branch=*)
      BRANCH="${arg#--branch=}"
      ;;
    --no-build)
      DO_BUILD=0
      ;;
    --logs)
      SHOW_LOGS=1
      ;;
    --help|-h)
      sed -n '2,16p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "❌ unknown argument: $arg"
      echo "   use --help"
      exit 2
      ;;
  esac
done

# ─── sanity checks ───
if [ ! -d "$WORK_DIR/.git" ]; then
  echo "❌ $WORK_DIR is not a git work tree"
  echo "   run scripts/setup-vps.sh first"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ docker is not installed"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "❌ 'docker compose' (v2) is not available"
  exit 1
fi

# Если запустили не из под пользователя в группе docker — проверим.
if [ "$(id -u)" -ne 0 ]; then
  if ! id -nG | grep -qw docker; then
    echo "❌ user $(whoami) is not in 'docker' group"
    echo "   fix: sudo usermod -aG docker $(whoami)  # then re-login"
    exit 1
  fi
fi

# ─── 1. git pull ───
echo "▶ redeploy: starting at $(date -Is)"
echo "  - work tree: $WORK_DIR"
echo "  - branch:    $BRANCH"
echo ""

cd "$WORK_DIR"

# Если origin — bare-repo (~/srv/...), настроим remote на GitHub.
# Это нужно, чтобы bare-repo не устаревал. Идемпотентно.
CURRENT_ORIGIN=$(git remote get-url origin 2>/dev/null || echo "")
if [ "$CURRENT_ORIGIN" = "$HOME/srv/habitstracker.git" ] || [ "$CURRENT_ORIGIN" = "/srv/habitstracker.git" ]; then
  echo "  - switching remote origin: bare-repo → GitHub"
  git remote set-url origin "$REPO_URL"
fi

echo "  - git fetch origin $BRANCH"
git fetch origin "$BRANCH" 2>&1 | sed 's/^/    /'

# Покажем что подтянется
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")
if [ "$LOCAL" = "$REMOTE" ]; then
  echo "  - already at $BRANCH ($LOCAL)"
  echo "  - nothing to pull"
else
  echo "  - local:  $LOCAL"
  echo "  - remote: $REMOTE"
  echo "  - git reset --hard origin/$BRANCH"
  git reset --hard "origin/$BRANCH" 2>&1 | sed 's/^/    /'
fi

# ─── 2. docker compose ───
cd "$WORK_DIR"

if [ ! -f .env ]; then
  echo "❌ $WORK_DIR/.env is missing"
  echo "   copy from .env.example and fill secrets"
  exit 1
fi

if [ "$DO_BUILD" = "1" ]; then
  echo ""
  echo "  - docker compose build"
  docker compose -f docker-compose.deploy.yml --env-file .env build 2>&1 | tail -10
fi

echo ""
echo "  - docker compose up -d"
docker compose -f docker-compose.deploy.yml --env-file .env up -d 2>&1 | tail -10

# ─── 3. health check ───
echo ""
echo "  - waiting 30s for health check..."
sleep 30

echo "  - GET https://localhost:8443/api/health"
HEALTH=$(curl -skI https://localhost:8443/api/health 2>&1 | head -1 || echo "(no response)")
echo "    $HEALTH"

# ─── 4. docker ps ───
echo ""
echo "  - docker ps (habitstracker)"
docker ps --filter "label=com.docker.compose.project=habitstracker" 2>/dev/null || docker ps | grep habitstracker

# ─── 5. logs (опционально) ───
if [ "$SHOW_LOGS" = "1" ]; then
  echo ""
  echo "  - tail of habitstracker-api"
  docker logs habitstracker-api --tail 20
  echo ""
  echo "  - tail of habitstracker-caddy"
  docker logs habitstracker-caddy --tail 20
fi

echo ""
echo "✅ redeploy finished at $(date -Is)"
echo "   open: https://$(grep APP_BASE_URL .env | cut -d= -f2 | sed 's|https\?://||; s|/$||')"
