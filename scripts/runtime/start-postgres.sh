#!/usr/bin/env bash
set -euo pipefail

: "${IMMORADAR_RUNTIME_HOME:?IMMORADAR_RUNTIME_HOME is required}"
: "${IMMORADAR_POSTGRES_PORT:?IMMORADAR_POSTGRES_PORT is required}"

# Postgres stops at startup when LC_ALL names a locale macOS can't load. C always loads.
export LC_ALL=C
export LANG=C
export LC_CTYPE=C

RUNTIME_ROOT="${IMMORADAR_RUNTIME_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BIN_DIR="${IMMORADAR_POSTGRES_BIN_DIR:-$RUNTIME_ROOT/infra/postgres/bin}"
DATA_DIR="$IMMORADAR_RUNTIME_HOME/postgres/data"
LOG_DIR="$IMMORADAR_RUNTIME_HOME/logs"

if [[ ! -x "$BIN_DIR/postgres" ]]; then
  echo "Postgres not found in $BIN_DIR. Install it with: brew install postgresql@17" >&2
  exit 1
fi

mkdir -p "$(dirname "$DATA_DIR")" "$LOG_DIR"

# initdb writes PG_VERSION before the cluster is finished, so a run killed midway would pass this
# check on every later start and Postgres would then refuse the folder. Building beside the data
# folder and moving the result into place means the folder only ever holds a finished cluster.
if [[ ! -f "$DATA_DIR/PG_VERSION" ]]; then
  BUILD_DIR="$DATA_DIR.initdb"
  rm -rf "$BUILD_DIR"
  rmdir "$DATA_DIR" 2>/dev/null || true
  if [[ -e "$DATA_DIR" ]]; then
    echo "$DATA_DIR has files but no Postgres cluster. Move them away and start again." >&2
    exit 1
  fi

  "$BIN_DIR/initdb" \
    --username=postgres \
    --auth=trust \
    --encoding=UTF8 \
    --locale=C \
    --pgdata="$BUILD_DIR" &
  INITDB_PID=$!

  # A stop signals this script, not initdb, so the trap passes it on. A signal ends `wait` early,
  # which is why it runs until initdb is gone.
  STOPPING=""
  trap 'STOPPING=1; kill -TERM "$INITDB_PID" 2>/dev/null || true' TERM INT QUIT
  while :; do
    INITDB_STATUS=0
    wait "$INITDB_PID" || INITDB_STATUS=$?
    kill -0 "$INITDB_PID" 2>/dev/null || break
  done
  trap - TERM INT QUIT

  if [[ -n "$STOPPING" ]]; then
    exit 1
  fi
  if [[ $INITDB_STATUS -ne 0 ]]; then
    exit "$INITDB_STATUS"
  fi
  mv "$BUILD_DIR" "$DATA_DIR"
fi

# Every client connects over TCP. Without a socket there is no lock file in /tmp that a stale PID
# can turn into a startup failure.
exec "$BIN_DIR/postgres" \
  -D "$DATA_DIR" \
  -h 127.0.0.1 \
  -p "$IMMORADAR_POSTGRES_PORT" \
  -c unix_socket_directories=
