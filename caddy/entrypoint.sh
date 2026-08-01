#!/bin/sh
# caddy/entrypoint.sh
# Подставляет env-переменные в Caddyfile.tpl → /etc/caddy/Caddyfile,
# затем запускает caddy.
#
# v0.3.0: используем sed вместо envsubst, потому что:
# - envsubst из alpine требует libintl.so.8
# - caddy:2-alpine не содержит libintl.so.8
# - ставить libintl в caddy-alpine — лишний 0.5 MB и пакет
# - sed — POSIX-утилита, есть в любом alpine
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
# Если в APP_BASE_URL был порт (например, f.xdvs.ru:8443) — отрезаем для Caddyfile,
# потому что сертификат выдаётся на FQDN без порта, а порт — это сетевой слой.
HOST=$(echo "$HOST" | sed -E 's|:[0-9]+$||')
echo "Caddy will serve: $HOST"

# Подставляем через sed (POSIX, без libintl).
# Используем разделитель `|`, чтобы не конфликтовать с URL (там `/`).
sed \
  -e "s|{\$APP_BASE_URL}|$HOST|g" \
  -e "s|{\$CADDY_EMAIL}|$CADDY_EMAIL|g" \
  /etc/caddy/Caddyfile.tpl > /etc/caddy/Caddyfile

echo "Generated Caddyfile:"
cat /etc/caddy/Caddyfile

# exec caddy — чтобы сигналы шли напрямую.
exec caddy run --config /etc/caddy/Caddyfile --adapter ""
