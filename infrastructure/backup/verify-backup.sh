#!/usr/bin/env bash
# Verify the most recent backup can be restored to a temp database.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/.rei-backups/postgres}"
DATABASE_URL="${DATABASE_URL:?DATABASE_URL must be set}"
VERIFY_DB="rei_backup_verify_$$"

LATEST=$(ls -t "$BACKUP_DIR"/rei_*.sql.gz 2>/dev/null | head -1)
if [ -z "$LATEST" ]; then
  echo "[verify] ERROR: No backups found in $BACKUP_DIR"
  exit 1
fi

echo "[verify] Testing: $LATEST"

# Extract connection params from DATABASE_URL for createdb/dropdb
# Create temp database, restore, check table count, drop
DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:/]*\).*|\1|p')
DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
DB_USER=$(echo "$DATABASE_URL" | sed -n 's|.*://\([^:]*\):.*|\1|p')

export PGPASSWORD=$(echo "$DATABASE_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')

createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$VERIFY_DB"
trap 'dropdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" --if-exists "$VERIFY_DB"' EXIT

gunzip -c "$LATEST" | psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$VERIFY_DB" -q

TABLE_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$VERIFY_DB" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")

echo "[verify] Restored $TABLE_COUNT tables from backup"
if [ "$TABLE_COUNT" -lt 5 ]; then
  echo "[verify] WARNING: Expected at least 5 tables, got $TABLE_COUNT"
  exit 1
fi
echo "[verify] Backup verification PASSED"
