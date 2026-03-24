#!/usr/bin/env bash
# Daily PostgreSQL backup to local directory with 7-day retention.
# Intended to run via cron or launchd on the Mac mini.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/.immoradar-backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
DATABASE_URL="${DATABASE_URL:?DATABASE_URL must be set}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/immoradar_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup] Starting PostgreSQL backup at $(date)"
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE"
echo "[backup] Written: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# Prune old backups
find "$BACKUP_DIR" -name "immoradar_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete
REMAINING=$(find "$BACKUP_DIR" -name "immoradar_*.sql.gz" | wc -l | tr -d ' ')
echo "[backup] Retained $REMAINING backups (${RETENTION_DAYS}-day policy)"
