#!/usr/bin/env bash
# Nightly consistent backup of the walkhome database (safe while walking —
# uses SQLite's online .backup). Add to cron:
#   0 3 * * * /home/pi/workspace/walkhome/deploy/backup.sh
set -euo pipefail

DB="${WALKHOME_DB:-/home/pi/workspace/walkhome/data/walkhome.db}"
DEST_DIR="${WALKHOME_BACKUP_DIR:-/home/pi/workspace/walkhome/data/backups}"
KEEP="${WALKHOME_BACKUP_KEEP:-14}"

mkdir -p "$DEST_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
sqlite3 "$DB" ".backup '$DEST_DIR/walkhome-$STAMP.db'"

# prune old backups
ls -1t "$DEST_DIR"/walkhome-*.db 2>/dev/null | tail -n "+$((KEEP + 1))" | xargs -r rm --
# VAPID keys (Web Push): losing them silently unsubscribes every device.
VAPID="$(dirname "$DB")/vapid.json"
[ -f "$VAPID" ] && cp -p "$VAPID" "$DEST_DIR/vapid-$STAMP.json" && \
  ls -1t "$DEST_DIR"/vapid-*.json 2>/dev/null | tail -n "+$((KEEP + 1))" | xargs -r rm --
echo "backup written: $DEST_DIR/walkhome-$STAMP.db"
