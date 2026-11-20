#!/usr/bin/env bash
# Резервная копия базы Жеткіз 750. Запускается таймером jetkiz750-backup.timer каждый день в 04:00.
# Копия делается «на ходу» (сервер не останавливается), сжимается и хранится KEEP_DAYS дней.
# Если задан BACKUP_REMOTE (например, user@backup-host:/backups/jetkiz750), копия дополнительно
# отправляется по scp на другой сервер — храните копии не только на том же VPS.
set -euo pipefail

DB_FILE="${DB_FILE:-/var/lib/jetkiz750/data.sqlite}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/jetkiz750}"
KEEP_DAYS="${KEEP_DAYS:-30}"
# shellcheck disable=SC1091
[ -f /etc/jetkiz750-backup.env ] && . /etc/jetkiz750-backup.env

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
name="data-$(date +%Y%m%d-%H%M%S).sqlite"
sqlite3 "$DB_FILE" ".backup '$BACKUP_DIR/$name'"
# Проверяем, что копия читается
[ "$(sqlite3 "$BACKUP_DIR/$name" 'PRAGMA integrity_check;')" = "ok" ] || { echo "Копия повреждена: $name" >&2; exit 1; }
gzip -9 "$BACKUP_DIR/$name"
chmod 600 "$BACKUP_DIR/$name.gz"
echo "Резервная копия: $BACKUP_DIR/$name.gz"

if [ -n "${BACKUP_REMOTE:-}" ]; then
  scp -q -o BatchMode=yes "$BACKUP_DIR/$name.gz" "$BACKUP_REMOTE/" && echo "Отправлено на $BACKUP_REMOTE"
fi

find "$BACKUP_DIR" -name 'data-*.sqlite.gz' -mtime +"$KEEP_DAYS" -delete
