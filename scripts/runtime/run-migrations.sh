#!/usr/bin/env bash
set -euo pipefail

RUNTIME_ROOT="${IMMORADAR_RUNTIME_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
POSTGRES_BIN_DIR="${IMMORADAR_POSTGRES_BIN_DIR:-$RUNTIME_ROOT/infra/postgres/bin}"
NODE_BIN="${IMMORADAR_NODE_BIN:-$RUNTIME_ROOT/bin/node}"
MIGRATE_SCRIPT="${IMMORADAR_MIGRATE_SCRIPT:-$RUNTIME_ROOT/packages/db/dist/migrate.js}"
PSQL_BIN="$POSTGRES_BIN_DIR/psql"
CREATEDB_BIN="$POSTGRES_BIN_DIR/createdb"
PG_ISREADY_BIN="$POSTGRES_BIN_DIR/pg_isready"
EXIT_POSTGRES_NOT_READY=70

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

retry_transient_postgres_command() {
  local deadline=$((SECONDS + 20))

  while true; do
    set +e
    local output
    output="$("$@" 2>&1)"
    local status=$?
    set -e

    if [[ $status -eq 0 ]]; then
      printf '%s\n' "$output"
      return 0
    fi

    if [[ $SECONDS -ge $deadline ]]; then
      printf '%s\n' "$output" >&2
      return $status
    fi

    if grep -qiE 'connection refused|could not connect|starting up|shutting down|no response|server closed the connection unexpectedly' <<<"$output"; then
      sleep 1
      continue
    fi

    printf '%s\n' "$output" >&2
    return $status
  done
}

wait_for_postgres() {
  local deadline=$((SECONDS + 20))

  while true; do
    if [[ -x "$PG_ISREADY_BIN" ]]; then
      if "$PG_ISREADY_BIN" -d "$ADMIN_DATABASE_URL" -U postgres -t 1 >/dev/null 2>&1; then
        return 0
      fi
    elif retry_transient_postgres_command "$PSQL_BIN" "$ADMIN_DATABASE_URL" -tAc "SELECT 1" >/dev/null; then
      return 0
    fi

    if [[ $SECONDS -ge $deadline ]]; then
      echo "Postgres did not become ready in time." >&2
      return 1
    fi

    sleep 1
  done
}

if [[ -x "$PSQL_BIN" && -x "$CREATEDB_BIN" ]]; then
  if ! wait_for_postgres; then
    exit "$EXIT_POSTGRES_NOT_READY"
  fi

  if ! retry_transient_postgres_command "$PSQL_BIN" "$ADMIN_DATABASE_URL" -tAc "SELECT 1 FROM pg_database WHERE datname = '$TARGET_DATABASE'" | grep -q 1; then
    # The server's default ctype is C, under which ILIKE folds only ASCII and keyword search
    # misses German words. Sorting stays bytewise.
    retry_transient_postgres_command "$CREATEDB_BIN" \
      --maintenance-db="$ADMIN_DATABASE_URL" \
      --template=template0 \
      --encoding=UTF8 \
      --lc-collate=C \
      --lc-ctype=en_US.UTF-8 \
      "$TARGET_DATABASE" >/dev/null
  fi
fi

cd "$RUNTIME_ROOT"
exec "$NODE_BIN" "$MIGRATE_SCRIPT"
