# syntax=docker/dockerfile:1.7
# Caddy 2 + наш Caddyfile с подстановкой переменных через sed.
# Без multi-stage: caddy:2-alpine уже содержит sed и busybox.
#
# v0.3.0: убран multi-stage с alpine+envsubst, потому что:
# - caddy:2-alpine не содержит libintl.so.8
# - envsubst требует libintl
# - sed — POSIX-утилита, есть в caddy:2-alpine из коробки
#
# spec:08-deploy.md#q2, q11, q12

FROM caddy:2-alpine

# Подставляем переменные на старте контейнера через sed (см. entrypoint.sh).
# Без необходимости пересборки при смене домена — только .env и up -d.
COPY Caddyfile.tpl /etc/caddy/Caddyfile.tpl
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# HEALTHCHECK проверяет admin API Caddy.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:2019/metrics >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/entrypoint.sh"]
