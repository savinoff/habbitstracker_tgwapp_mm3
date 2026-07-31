#!/bin/bash
# scripts/install-backup-cron.sh
# Устанавливает cron-задачу для ежедневного бэкапа SQLite.
#
# Запускать ОДИН РАЗ от root на VPS, после setup-vps.sh.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "❌ Must run as root"
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "❌ sqlite3 CLI not found. Install:"
  echo "   apt-get install -y sqlite3"
  exit 1
fi

SCRIPT="/opt/habitstracker/scripts/backup.sh"
chmod +x "$SCRIPT"

# /etc/cron.d/habitstracker-backup
cat > /etc/cron.d/habitstracker-backup <<EOF
# HabitsTracker: ежедневный бэкап SQLite. См. spec/08-deploy.md#q5.
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

0 4 * * * root $SCRIPT >> /var/log/habitstracker-backup.log 2>&1
EOF

chmod 644 /etc/cron.d/habitstracker-backup

# Ensure cron is running.
if ! pgrep -x cron >/dev/null 2>&1 && ! pgrep -x crond >/dev/null 2>&1; then
  echo "⚠️  cron doesn't seem to be running. Start it:"
  echo "   systemctl enable --now cron   # Debian/Ubuntu"
fi

echo "✅ Backup cron installed: runs daily at 04:00"
echo "   Log: /var/log/habitstracker-backup.log"
echo "   Backups: /var/backups/habitstracker/  (retention 30 days)"
