#!/bin/bash
# scripts/backup.sh
# Ежедневный бэкап SQLite через .backup (атомарно даже под нагрузкой).
# Retention: 30 дней.
#
# Использует sqlite3 CLI, если есть. Если нет — fallback на better-sqlite3
# через node, чтобы backup работал даже на голом Node-окружении.
#
# Запускается через cron на хосте (см. scripts/install-backup-cron.sh).
#
# spec:07-non-functional.md#q6 — бэкапы
# spec:08-deploy.md#q5 — cron на хосте

set -euo pipefail

DATA_DIR="${HABITSTRACKER_DATA_DIR:-/var/lib/habitstracker}"
BACKUP_DIR="${HABITSTRACKER_BACKUP_DIR:-/var/backups/habitstracker}"
WORK_DIR="${HABITSTRACKER_WORK_DIR:-/opt/habitstracker}"
TS="$(date +%F)"
BACKUP_FILE="$BACKUP_DIR/habits-${TS}.db"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DATA_DIR/habits.db" ]; then
  echo "❌ Database not found: $DATA_DIR/habits.db"
  exit 1
fi

if command -v sqlite3 >/dev/null 2>&1; then
  # CLI path: атомарный .backup.
  sqlite3 "$DATA_DIR/habits.db" ".backup '$BACKUP_FILE'"
else
  # Fallback: используем better-sqlite3 из server/node_modules.
  if [ ! -d "$WORK_DIR/server/node_modules/better-sqlite3" ]; then
    echo "❌ sqlite3 CLI not found and better-sqlite3 not installed."
    echo "   apt-get install -y sqlite3   (or run on a host that has one)"
    exit 1
  fi
  env SRC="$DATA_DIR/habits.db" DST="$BACKUP_FILE" \
  node -e "
    const Database = require('better-sqlite3');
    const src = new Database(process.env.SRC, { readonly: true, fileMustExist: true });
    // backup() возвращает Promise<{ pages, remaining }>; не блокирует.
    src.backup(process.env.DST).then((res) => {
      console.log('backup: pages=' + res.pages);
      src.close();
    });
  "
fi

# Retention 30 дней.
find "$BACKUP_DIR" -name 'habits-*.db' -mtime +30 -delete

echo "backup: $BACKUP_FILE"
