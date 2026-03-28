#!/usr/bin/env bash
set -euo pipefail

RUNTIME_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="$RUNTIME_ROOT/bin/node"
MIGRATE_SCRIPT="$RUNTIME_ROOT/packages/db/dist/migrate.js"
PSQL_BIN="$RUNTIME_ROOT/infra/postgres/bin/psql"
CREATEDB_BIN="$RUNTIME_ROOT/infra/postgres/bin/createdb"

if [[ ! -x "$NODE_BIN" ]]; then
  echo "Node runtime not found: $NODE_BIN" >&2
  exit 1
fi

if [[ ! -f "$MIGRATE_SCRIPT" ]]; then
  echo "Migration script not found: $MIGRATE_SCRIPT" >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

TARGET_DATABASE="${DATABASE_URL##*/}"
ADMIN_DATABASE_URL="${DATABASE_URL%/*}/postgres"

if [[ -x "$PSQL_BIN" && -x "$CREATEDB_BIN" ]]; then
  if ! "$PSQL_BIN" "$ADMIN_DATABASE_URL" -tAc "SELECT 1 FROM pg_database WHERE datname = '$TARGET_DATABASE'" | grep -q 1; then
    "$CREATEDB_BIN" --maintenance-db="$ADMIN_DATABASE_URL" "$TARGET_DATABASE"
  fi
fi

cd "$RUNTIME_ROOT"
exec "$NODE_BIN" "$MIGRATE_SCRIPT"
