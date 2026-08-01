# syntax=docker/dockerfile:1.7
# Multi-stage build: сборка web → статика в финальный образ (раздаётся nginx'ом рядом).

# ───── Stage 1: build web (Vite) ─────
FROM node:20-alpine AS web-build
WORKDIR /web
COPY web/package*.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ───── Stage 2: api deps ─────
FROM node:20-alpine AS api-deps
WORKDIR /app
COPY server/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# ───── Stage 3: runtime ─────
FROM node:20-alpine AS runtime
WORKDIR /app

# Системные пакеты: tini для корректного PID 1, sqlite3 для бэкапов через CLI.
RUN apk add --no-cache tini sqlite

ENV NODE_ENV=production
ENV PORT=3000
ENV STATIC_DIR=/app/web/dist

# api
COPY --from=api-deps /app/node_modules ./node_modules
COPY server/ ./server/
COPY scripts/ ./scripts/

# web (статика) — отдаётся самим Fastify через @fastify/static, см. server/src/index.js
# и docs/spec/05-api.md#q10. Раньше отдавалось nginx'ом, но мы убрали nginx в v0.2.0.
COPY --from=web-build /web/dist ./web/dist

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/src/index.js"]
