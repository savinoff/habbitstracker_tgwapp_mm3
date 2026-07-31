# syntax=docker/dockerfile:1.7
# Caddy 2 + наш Caddyfile. На сборке подставляем переменные через envsubst.
# На выходе — стандартный caddy:2-alpine с правильным конфигом.
#
# spec:08-deploy.md#q2, q11, q12

FROM alpine:3.20 AS envsubst
RUN apk add --no-cache gettext

FROM caddy:2-alpine

# envsubst из alpine-3.20 ставит переменные в Caddyfile.tpl
COPY --from=envsubst /usr/bin/envsubst /usr/local/bin/envsubst
COPY Caddyfile.tpl /etc/caddy/Caddyfile.tpl

# env_file принесёт APP_BASE_URL и CADDY_EMAIL в окружение. На старте контейнера
# делаем подстановку и кладём результат туда, где Caddy его читает.
# cmd.sh запускается ENTRYPOINT'ом caddy:2 (caddy run --config ...).
# Используем entrypoint-обёртку.
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Без HEALTHCHECK: ACME-челлендж идёт наружу, проверять изнутри сложно.
# Вместо этого полагаемся на то, что сам api имеет /api/health, и
# мониторим его снаружи (или из Portainer через status-страницу caddy).
# Но добавим простой TCP-чек, чтобы контейнер не считался healthy до старта.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:2019/metrics >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/entrypoint.sh"]
