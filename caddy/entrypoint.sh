#!/bin/sh
# caddy/entrypoint.sh
# Подставляет env-переменные в Caddyfile.tpl → /etc/caddy/Caddyfile,
# затем запускает caddy.
#
# spec:08-deploy.md#q9, q11

set -euo pipefail

if [ -z "${APP_BASE_URL:-}" ]; then
  echo "❌ APP_BASE_URL is not set"
  exit 1
fi
if [ -z "${CADDY_EMAIL:-}" ]; then
  echo "❌ CADDY_EMAIL is not set"
  exit 1
fi

# Делим APP_BASE_URL на хост: убираем протокол и trailing slash.
HOST=$(echo "$APP_BASE_URL" | sed -E 's|^https?://||; s|/$||')
echo "Caddy will serve: $HOST"

export APP_BASE_URL="$HOST"

envsubst < /etc/caddy/Caddyfile.tpl > /etc/caddy/Caddyfile
echo "Caddyfile generated:"
cat /etc/caddy/Caddyfile

# exec caddy — чтобы сигналы шли напрямую.
exec caddy run --config /etc/caddy/Caddyfile --adapter ""
